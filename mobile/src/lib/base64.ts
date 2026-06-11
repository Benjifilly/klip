/**
 * Pure-JS base64 — Hermes has neither `btoa`/`atob` nor `Buffer`, and the
 * wire format ({iv, ct} packets) is base64 on both sides.
 */

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REV = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHA.length; i++) REV[ALPHA.charCodeAt(i)] = i;

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    parts.push(
      ALPHA[b0 >> 2],
      ALPHA[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)],
      b1 === undefined ? '=' : ALPHA[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)],
      b2 === undefined ? '=' : ALPHA[b2 & 63],
    );
  }
  return parts.join('');
}

export function fromBase64(b64: string): Uint8Array {
  let clean = '';
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    if (c < 128 && REV[c] !== -1) clean += b64[i];
  }
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const c2 = i + 2 < clean.length ? REV[clean.charCodeAt(i + 2)] : 0;
    const c3 = i + 3 < clean.length ? REV[clean.charCodeAt(i + 3)] : 0;
    const n = (REV[clean.charCodeAt(i)] << 18) | (REV[clean.charCodeAt(i + 1)] << 12) | (c2 << 6) | c3;
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
