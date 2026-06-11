/**
 * Crypto-grade randomness that works everywhere this code runs:
 * Node 20+ and browsers expose `globalThis.crypto`; Hermes does not, so the
 * app falls back to expo-crypto (kept out of the import graph in Node tests).
 */

type CryptoLike = {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): string;
};

const fromGlobal = (globalThis as { crypto?: CryptoLike }).crypto;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const impl: CryptoLike = fromGlobal?.getRandomValues ? fromGlobal : require('expo-crypto');

export function getRandomValues<T extends ArrayBufferView>(array: T): T {
  return impl.getRandomValues(array);
}

export function randomUUID(): string {
  return impl.randomUUID();
}
