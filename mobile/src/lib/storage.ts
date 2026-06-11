/**
 * At-rest persistence — the iOS analogue of the desktop posture (DPAPI via
 * Electron safeStorage):
 *   - secrets (session code, cached Argon2id key, install id) → iOS Keychain
 *     via expo-secure-store
 *   - history JSON + image blobs → app sandbox files, AES-256-GCM-encrypted
 *     with a device-local key that lives in the Keychain
 *
 * This module is the only one that touches Expo storage APIs; everything
 * above it deals in plain values, so a V2 move to an App Group container
 * (Share Extension) only changes this file.
 */

import * as SecureStore from 'expo-secure-store';
import { File, Directory, Paths } from 'expo-file-system';
import { encryptBytes, decryptBytes, encryptJSON, decryptJSON, type Packet } from './crypto';
import { getRandomValues, randomUUID } from './random';
import { toBase64, fromBase64 } from './base64';

const KEYS = {
  code: 'klip.sessionCode',
  key: 'klip.sessionKey',
  localKey: 'klip.localKey',
  installId: 'klip.installId',
};

let cachedLocalKey: Uint8Array | null = null;

/** Device-local at-rest key — generated once, kept in the Keychain. */
async function localKey(): Promise<Uint8Array> {
  if (cachedLocalKey) return cachedLocalKey;
  const existing = await SecureStore.getItemAsync(KEYS.localKey);
  if (existing) {
    cachedLocalKey = fromBase64(existing);
    return cachedLocalKey;
  }
  const fresh = getRandomValues(new Uint8Array(32));
  await SecureStore.setItemAsync(KEYS.localKey, toBase64(fresh));
  cachedLocalKey = fresh;
  return fresh;
}

/** Stable per-install id — the `sid` that lets us drop our own replayed packets. */
export async function getInstallId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEYS.installId);
  if (existing) return existing;
  const id = randomUUID();
  await SecureStore.setItemAsync(KEYS.installId, id);
  return id;
}

export const session = {
  /** The Argon2id-derived key is cached so derivation runs once per pairing. */
  async save(code: string, key: Uint8Array): Promise<void> {
    await SecureStore.setItemAsync(KEYS.code, code);
    await SecureStore.setItemAsync(KEYS.key, toBase64(key));
  },
  async load(): Promise<{ code: string; key: Uint8Array } | null> {
    const code = await SecureStore.getItemAsync(KEYS.code);
    const key = await SecureStore.getItemAsync(KEYS.key);
    return code && key ? { code, key: fromBase64(key) } : null;
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS.code);
    await SecureStore.deleteItemAsync(KEYS.key);
  },
};

function blobDir(): Directory {
  const dir = new Directory(Paths.document, 'blobs');
  if (!dir.exists) dir.create();
  return dir;
}

/** Encrypted image blobs, one file per id; ids are referenced by history items. */
export const blobs = {
  async save(bytes: Uint8Array): Promise<string> {
    const id = randomUUID();
    const sealed = await encryptBytes(await localKey(), bytes);
    const file = new File(blobDir(), `${id}.json`);
    await file.write(JSON.stringify(sealed));
    return id;
  },
  async load(id: string): Promise<Uint8Array | null> {
    try {
      const sealed = JSON.parse(new File(blobDir(), `${id}.json`).textSync()) as Packet;
      return await decryptBytes(await localKey(), sealed);
    } catch {
      return null; // missing or corrupted blob — the row shows a placeholder
    }
  },
  async remove(id: string): Promise<void> {
    try {
      new File(blobDir(), `${id}.json`).delete();
    } catch {
      /* already gone */
    }
  },
};

/** The full history list, encrypted at rest as a single JSON file. */
export const historyFile = {
  async save(value: unknown): Promise<void> {
    const sealed = await encryptJSON(await localKey(), value);
    await new File(Paths.document, 'history.json').write(JSON.stringify(sealed));
  },
  async load(): Promise<unknown | null> {
    try {
      const sealed = JSON.parse(new File(Paths.document, 'history.json').textSync()) as Packet;
      return await decryptJSON(await localKey(), sealed);
    } catch {
      return null;
    }
  },
};

/** Non-secret preferences (relay URL, device name, auto-copy mode). */
export const prefs = {
  async save(value: unknown): Promise<void> {
    await new File(Paths.document, 'prefs.json').write(JSON.stringify(value));
  },
  async load(): Promise<unknown | null> {
    try {
      return JSON.parse(new File(Paths.document, 'prefs.json').textSync());
    } catch {
      return null;
    }
  },
};
