'use strict';

/**
 * Klip end-to-end encryption module — AES-256-GCM via the Web Crypto API,
 * key derivation via Argon2id (hash-wasm, pure WASM).
 *
 * Isomorphic on purpose: `globalThis.crypto` exists in browsers, in the
 * Electron renderer AND in Node >= 20 (Electron main process), and hash-wasm
 * runs in all of them too, so this exact file runs everywhere a Klip client
 * might live (desktop today, web/mobile tomorrow).
 *
 * Key design (v2):
 *   sessionCode ──Argon2id(64 MiB, t=3, salt="klip/v2/key")──▶ AES-256-GCM key (stays on device)
 *   sessionCode ──SHA-256("klip/v2/room:" + code)───────────▶ roomId          (sent to the relay)
 *   sessionCode ──SHA-256("klip/v2/fingerprint:" + code)────▶ 4-emoji fingerprint (shown in the UI)
 *
 * The derivations are domain-separated: knowing the roomId tells the relay
 * nothing about the encryption key, and the session code itself is never
 * transmitted. Generated codes carry ~79 bits of entropy, and Argon2id's
 * memory-hardness (64 MiB per guess) makes brute-forcing a code from a
 * roomId infeasible even on GPU farms.
 */

const { argon2id } = require('hash-wasm');

const subtle = globalThis.crypto.subtle;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const KEY_SALT = 'klip/v2/key';
const ROOM_SALT = 'klip/v2/room';
const FINGERPRINT_SALT = 'klip/v2/fingerprint';
const IV_BYTES = 12;

const ARGON2 = {
  iterations: 3,
  memorySize: 64 * 1024, // KiB → 64 MiB per derivation
  parallelism: 1,
  hashLength: 32,
};

// No i, l, o, 0, 1 — codes are meant to be read aloud or typed on a phone.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // 31 chars

// 64 visually distinct emojis → 6 bits each. Two devices showing the same
// 4-emoji sequence are provably in the same session.
const FINGERPRINT_EMOJIS = [
  '🦊', '🐼', '🦁', '🐸', '🐙', '🦋', '🐳', '🦜',
  '🌵', '🍀', '🌻', '🍄', '🌙', '⭐', '🌈', '⚡',
  '🍉', '🍋', '🍇', '🍒', '🥑', '🌮', '🍩', '🧁',
  '⚽', '🎲', '🎸', '🎯', '🎁', '🎈', '🧩', '🪁',
  '🚀', '🚲', '⛵', '🎡', '🗼', '🏰', '⛺', '🌋',
  '🔑', '🔔', '💎', '🧲', '🔭', '⏰', '💡', '📌',
  '✂️', '🧦', '🎒', '👑', '🦄', '🐝', '🐢', '🦖',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤',
];

function bytesToBase64(bytes) {
  const arr = new Uint8Array(bytes);
  if (typeof Buffer !== 'undefined') return Buffer.from(arr).toString('base64');
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function normalizeCode(code) {
  return String(code ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Validate and canonicalize a session code. Only the generated shape is
 * accepted (16 chars, dashes optional on input): the roomId is a plain hash
 * of the code, so a human-chosen code like "benjamin" could be enumerated
 * offline and its room joined. Returns the canonical xxxx-xxxx-xxxx-xxxx
 * form, or null when the input is not a Klip code.
 */
function formatSessionCode(raw) {
  const code = normalizeCode(raw).replace(/-/g, '');
  if (!/^[a-z0-9]{16}$/.test(code)) return null;
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
}

/**
 * Generate a human-friendly session code: 16 chars over a 31-char alphabet
 * (~79 bits of entropy), grouped as xxxx-xxxx-xxxx-xxxx.
 * Uses rejection sampling to avoid modulo bias.
 */
function generateSessionCode() {
  const chars = [];
  while (chars.length < 16) {
    const buf = new Uint8Array(32);
    globalThis.crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= 248) continue; // 248 = 8 * 31 → keep the distribution uniform
      chars.push(CODE_ALPHABET[byte % CODE_ALPHABET.length]);
      if (chars.length === 16) break;
    }
  }
  const s = chars.join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

/** Derive the AES-256-GCM session key from the shared code. Never leaves the device. */
async function deriveSessionKey(sessionCode) {
  const code = normalizeCode(sessionCode);
  const raw = await argon2id({
    password: code,
    salt: textEncoder.encode(KEY_SALT),
    ...ARGON2,
    outputType: 'binary',
  });
  return subtle.importKey('raw', raw, 'AES-GCM', false /* non-extractable */, ['encrypt', 'decrypt']);
}

/** Derive the opaque room id shared with the relay. Reveals nothing about the key. */
async function deriveRoomId(sessionCode) {
  const code = normalizeCode(sessionCode);
  const digest = await subtle.digest('SHA-256', textEncoder.encode(`${ROOM_SALT}:${code}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive a 4-emoji session fingerprint. Every device in the same session
 * shows the same sequence — a glance is enough to confirm the pairing.
 */
async function deriveFingerprint(sessionCode) {
  const code = normalizeCode(sessionCode);
  const digest = new Uint8Array(
    await subtle.digest('SHA-256', textEncoder.encode(`${FINGERPRINT_SALT}:${code}`)),
  );
  const [b0, b1, b2] = digest;
  const indices = [b0 >> 2, ((b0 & 3) << 4) | (b1 >> 4), ((b1 & 15) << 2) | (b2 >> 6), b2 & 63];
  return indices.map((i) => FINGERPRINT_EMOJIS[i]);
}

/**
 * Encrypt raw bytes (used for chunked transfers of large payloads).
 * @returns {Promise<{iv: string, ct: string}>} base64 IV + ciphertext (incl. GCM auth tag)
 */
async function encryptBytes(key, bytes) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: bytesToBase64(iv), ct: bytesToBase64(ciphertext) };
}

/**
 * Decrypt a `{iv, ct}` packet to raw bytes. Rejects if the key is wrong or
 * the packet was tampered with (GCM authentication failure).
 */
async function decryptBytes(key, packet) {
  const iv = base64ToBytes(packet.iv);
  const ciphertext = base64ToBytes(packet.ct);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
}

/** Encrypt any JSON-serializable value. */
async function encryptJSON(key, value) {
  return encryptBytes(key, textEncoder.encode(JSON.stringify(value)));
}

/** Decrypt a `{iv, ct}` packet produced by `encryptJSON`. */
async function decryptJSON(key, packet) {
  return JSON.parse(textDecoder.decode(await decryptBytes(key, packet)));
}

module.exports = {
  generateSessionCode,
  normalizeCode,
  formatSessionCode,
  deriveSessionKey,
  deriveRoomId,
  deriveFingerprint,
  encryptBytes,
  decryptBytes,
  encryptJSON,
  decryptJSON,
};
