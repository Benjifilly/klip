/**
 * Interop suite: mobile/src/lib/crypto.ts (@noble, pure JS — Hermes has no
 * WebAssembly so hash-wasm can't run there) must be byte-compatible with the
 * desktop reference module client/electron/crypto.cjs (hash-wasm + WebCrypto).
 * Every derivation and packet format is the wire contract between the apps.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  generateSessionCode,
  formatSessionCode,
  deriveSessionKey,
  deriveRoomId,
  deriveFingerprint,
  encryptJSON,
  decryptJSON,
  decryptBytes,
} from '../src/lib/crypto';

const require_ = createRequire(import.meta.url);
const kc = require_('../../client/electron/crypto.cjs');

describe('crypto interop with client/electron/crypto.cjs', () => {
  const code = 'kx3m-9p2w-7qrt-c4vn';

  it('derives the same room id and fingerprint as the desktop module', async () => {
    expect(await deriveRoomId(code)).toBe(await kc.deriveRoomId(code));
    expect(await deriveFingerprint(code)).toEqual(await kc.deriveFingerprint(code));
  });

  it('desktop decrypts what mobile encrypts', async () => {
    const mobileKey = await deriveSessionKey(code);
    const desktopKey = await kc.deriveSessionKey(code);
    const payload = { kind: 'text', text: 'héllo from iOS 📱', deviceName: 'iPhone', ts: 1718000000000 };
    expect(await kc.decryptJSON(desktopKey, await encryptJSON(mobileKey, payload))).toEqual(payload);
  });

  it('mobile decrypts what desktop encrypts (JSON and raw bytes)', async () => {
    const mobileKey = await deriveSessionKey(code);
    const desktopKey = await kc.deriveSessionKey(code);
    const payload = { kind: 'text', text: 'from desktop', deviceName: 'PC', ts: 1 };
    expect(await decryptJSON(mobileKey, await kc.encryptJSON(desktopKey, payload))).toEqual(payload);
    const blob = new Uint8Array(64 * 1024).map((_, i) => i % 251);
    expect(await decryptBytes(mobileKey, await kc.encryptBytes(desktopKey, blob))).toEqual(blob);
  });

  it('rejects tampered ciphertext (GCM auth)', async () => {
    const key = await deriveSessionKey(code);
    const sealed = await encryptJSON(key, { x: 1 });
    const bad = { ...sealed, ct: sealed.ct.slice(0, -4) + 'AAAA' };
    await expect(decryptJSON(key, bad)).rejects.toThrow();
  });

  it('generates valid codes that the desktop validator accepts', () => {
    const fresh = generateSessionCode();
    expect(fresh).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(kc.formatSessionCode(fresh)).toBe(fresh);
    expect(formatSessionCode(' KX3M9P2W 7QRTC4VN ')).toBe(code);
    expect(formatSessionCode('benjamin')).toBeNull();
  });
});
