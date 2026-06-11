/**
 * Klip E2EE — mobile implementation, byte-compatible with
 * client/electron/crypto.cjs (the reference module).
 *
 * Hermes has no WebAssembly and no `crypto.subtle`, so the desktop module
 * (hash-wasm + WebCrypto) can't run here. This is the same v2 scheme on
 * @noble primitives instead:
 *
 *   sessionCode ──Argon2id(64 MiB, t=3, salt="klip/v2/key")──▶ AES-256-GCM key (stays on device)
 *   sessionCode ──SHA-256("klip/v2/room:" + code)───────────▶ roomId          (sent to the relay)
 *   sessionCode ──SHA-256("klip/v2/fingerprint:" + code)────▶ 4-emoji fingerprint (shown in the UI)
 *
 * Every constant below is the wire/interop contract — verified against the
 * desktop module by mobile/test/crypto.interop.test.ts. Never change one
 * side alone.
 *
 * Functions stay async even where @noble is synchronous so the interface
 * matches the desktop module (and survives a future swap of the Argon2id
 * backend if pure-JS derivation proves too slow on older iPhones).
 */

import { argon2id } from '@noble/hashes/argon2';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils';
import { gcm } from '@noble/ciphers/aes';
import { getRandomValues } from './random';
import { toBase64, fromBase64 } from './base64';

const KEY_SALT = 'klip/v2/key';
const ROOM_SALT = 'klip/v2/room';
const FINGERPRINT_SALT = 'klip/v2/fingerprint';
const IV_BYTES = 12;

const ARGON2 = { t: 3, m: 64 * 1024, p: 1, dkLen: 32 }; // 64 MiB, mirrors hash-wasm params

// No i, l, o, 0, 1 — codes are meant to be read aloud or typed on a phone.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // 31 chars

// 64 visually distinct emojis → 6 bits each. Same table as desktop.
export const FINGERPRINT_EMOJIS = [
  '🦊', '🐼', '🦁', '🐸', '🐙', '🦋', '🐳', '🦜',
  '🌵', '🍀', '🌻', '🍄', '🌙', '⭐', '🌈', '⚡',
  '🍉', '🍋', '🍇', '🍒', '🥑', '🌮', '🍩', '🧁',
  '⚽', '🎲', '🎸', '🎯', '🎁', '🎈', '🧩', '🪁',
  '🚀', '🚲', '⛵', '🎡', '🗼', '🏰', '⛺', '🌋',
  '🔑', '🔔', '💎', '🧲', '🔭', '⏰', '💡', '📌',
  '✂️', '🧦', '🎒', '👑', '🦄', '🐝', '🐢', '🦖',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤',
];

export interface Packet {
  iv: string;
  ct: string;
}

export function normalizeCode(code: unknown): string {
  return String(code ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Validate and canonicalize a session code. Only the generated shape is
 * accepted (16 chars, dashes optional on input) — same rule as desktop.
 */
export function formatSessionCode(raw: unknown): string | null {
  const code = normalizeCode(raw).replace(/-/g, '');
  if (!/^[a-z0-9]{16}$/.test(code)) return null;
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
}

/** ~79 bits of entropy, rejection sampling to avoid modulo bias. */
export function generateSessionCode(): string {
  const chars: string[] = [];
  while (chars.length < 16) {
    const buf = getRandomValues(new Uint8Array(32));
    for (const byte of buf) {
      if (byte >= 248) continue; // 248 = 8 * 31 → keep the distribution uniform
      chars.push(CODE_ALPHABET[byte % CODE_ALPHABET.length]);
      if (chars.length === 16) break;
    }
  }
  const s = chars.join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

/**
 * Pluggable Argon2id backend. Hermes has no JIT: the pure-JS fallback below
 * takes minutes for 64 MiB. The app registers a WebView-based backend at
 * startup (hash-wasm inside WKWebView — the exact desktop implementation,
 * near-native speed); Node tests run with no backend and use @noble, whose
 * equivalence to hash-wasm is proven by the interop suite.
 */
type Argon2Backend = (normalizedCode: string, saltUtf8: string, params: typeof ARGON2) => Promise<Uint8Array>;

let argon2Backend: Argon2Backend | null = null;

export function setArgon2Backend(backend: Argon2Backend | null): void {
  argon2Backend = backend;
}

/**
 * Derive the AES-256-GCM session key. Only runs at pairing; the result is
 * cached in the Keychain. Falls back to pure JS (slow but correct) when the
 * WebView backend is unavailable or fails.
 */
export async function deriveSessionKey(sessionCode: string): Promise<Uint8Array> {
  const code = normalizeCode(sessionCode);
  if (argon2Backend) {
    try {
      const key = await argon2Backend(code, KEY_SALT, ARGON2);
      if (key.length === ARGON2.dkLen) return key;
    } catch {
      /* fall through to the pure-JS path */
    }
  }
  // Leading yield lets the UI paint a (native) spinner before the JS thread blocks.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return argon2id(utf8ToBytes(code), utf8ToBytes(KEY_SALT), ARGON2);
}

/** Opaque room id shared with the relay. Reveals nothing about the key. */
export async function deriveRoomId(sessionCode: string): Promise<string> {
  return bytesToHex(sha256(utf8ToBytes(`${ROOM_SALT}:${normalizeCode(sessionCode)}`)));
}

/** 4-emoji fingerprint — identical on every device in the same session. */
export async function deriveFingerprint(sessionCode: string): Promise<string[]> {
  const digest = sha256(utf8ToBytes(`${FINGERPRINT_SALT}:${normalizeCode(sessionCode)}`));
  const [b0, b1, b2] = digest;
  const indices = [b0 >> 2, ((b0 & 3) << 4) | (b1 >> 4), ((b1 & 15) << 2) | (b2 >> 6), b2 & 63];
  return indices.map((i) => FINGERPRINT_EMOJIS[i]);
}

/** Encrypt raw bytes → base64 {iv, ct} (GCM tag appended to ct, like WebCrypto). */
export async function encryptBytes(key: Uint8Array, bytes: Uint8Array): Promise<Packet> {
  const iv = getRandomValues(new Uint8Array(IV_BYTES));
  return { iv: toBase64(iv), ct: toBase64(gcm(key, iv).encrypt(bytes)) };
}

/** Decrypt {iv, ct}; throws on a wrong key or tampered packet (GCM auth). */
export async function decryptBytes(key: Uint8Array, packet: Packet): Promise<Uint8Array> {
  return gcm(key, fromBase64(packet.iv)).decrypt(fromBase64(packet.ct));
}

export async function encryptJSON(key: Uint8Array, value: unknown): Promise<Packet> {
  return encryptBytes(key, utf8ToBytes(JSON.stringify(value)));
}

export async function decryptJSON(key: Uint8Array, packet: Packet): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await decryptBytes(key, packet)));
}
