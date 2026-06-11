/**
 * App state (zustand) — owns the RelayClient lifecycle and glues protocol,
 * storage and clipboard together. This is the RN-facing integration layer;
 * the pieces it composes (crypto, protocol, history) are pure and tested
 * under Node.
 */

import { create } from 'zustand';
import { AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { RelayClient, isAllowedRelayUrl, type Status, type IncomingClip, type PeerDevice } from './protocol';
import { deriveSessionKey, deriveRoomId, deriveFingerprint, formatSessionCode } from './crypto';
import { addItem, type HistoryItem } from './history';
import { session, blobs, historyFile, prefs as prefsFile, getInstallId } from './storage';
import { toBase64, fromBase64 } from './base64';
import { randomUUID } from './random';

export const DEFAULT_RELAY = 'wss://klip-relay.fly.dev';

export interface Prefs {
  relayUrl: string;
  deviceName: string;
  /** Mirrors desktop semantics: all | text | off ("history only"). */
  autoCopy: 'all' | 'text' | 'off';
}

interface KlipState {
  hydrated: boolean;
  status: Status;
  code: string | null;
  fingerprint: string[];
  peerCount: number;
  devices: PeerDevice[];
  history: HistoryItem[];
  prefs: Prefs;
  pendingRotation: { code: string; deviceName: string } | null;
  /** Measured Argon2id time — the go/no-go signal for the WebView plan B. */
  lastDeriveMs: number | null;

  hydrate(): Promise<void>;
  join(code: string, relayUrl?: string): Promise<void>;
  leave(): Promise<void>;
  sendClipboard(): Promise<'text' | 'image' | 'empty'>;
  sendImage(png: Uint8Array): Promise<void>;
  copyItem(item: HistoryItem): Promise<void>;
  togglePin(id: string): void;
  removeItem(id: string): void;
  setPrefs(partial: Partial<Prefs>): void;
  acceptRotation(): Promise<void>;
  dismissRotation(): void;
}

let client: RelayClient | null = null;

export const useKlip = create<KlipState>((set, get) => {
  function persistHistory(): void {
    historyFile.save(get().history).catch(() => {
      /* persistence is best-effort; the session stays usable */
    });
  }

  function applyAdd(item: HistoryItem): void {
    const { kept, deletedBlobIds } = addItem(get().history, item);
    for (const blobId of deletedBlobIds) blobs.remove(blobId).catch(() => {});
    set({ history: kept });
    persistHistory();
  }

  async function onClip(clip: IncomingClip): Promise<void> {
    const { prefs } = get();
    if (clip.kind === 'image') {
      const blobId = await blobs.save(clip.png);
      if (prefs.autoCopy === 'all') {
        await Clipboard.setImageAsync(toBase64(clip.png)).catch(() => {});
      }
      applyAdd({
        id: randomUUID(), kind: 'image', blobId,
        deviceName: clip.deviceName, direction: 'received', ts: clip.ts, pinned: false,
      });
      return;
    }
    if (clip.kind === 'file') {
      applyAdd({
        id: randomUUID(), kind: 'file-placeholder', fileName: clip.name,
        deviceName: clip.deviceName, direction: 'received', ts: clip.ts, pinned: false,
      });
      return;
    }
    if (prefs.autoCopy !== 'off') {
      await Clipboard.setStringAsync(clip.text).catch(() => {});
    }
    applyAdd({
      id: randomUUID(), kind: 'text', text: clip.text,
      deviceName: clip.deviceName, direction: 'received', ts: clip.ts, pinned: false,
    });
  }

  async function buildClient(relayUrl: string, code: string, key: Uint8Array): Promise<void> {
    const [roomId, installId] = await Promise.all([deriveRoomId(code), getInstallId()]);
    await client?.disconnect();
    client = new RelayClient({
      url: relayUrl,
      roomId,
      key,
      installId,
      deviceName: get().prefs.deviceName,
      onClip: (clip) => {
        onClip(clip).catch(() => {});
      },
      onRotate: (request) => set({ pendingRotation: request }),
      onStatus: (status) => set({ status }),
      onPeers: (peerCount) => set({ peerCount }),
      onPresence: (devices) => set({ devices }),
    });
    client.connect();
  }

  // iOS kills the socket in the background; reconnect on return to foreground
  // and let the relay's 2-minute replay buffer fill the gap.
  AppState.addEventListener('change', (state) => {
    if (state === 'active' && get().code && get().status === 'disconnected') {
      client?.connect();
    }
  });

  return {
    hydrated: false,
    status: 'disconnected',
    code: null,
    fingerprint: [],
    peerCount: 0,
    devices: [],
    history: [],
    prefs: { relayUrl: DEFAULT_RELAY, deviceName: 'iPhone', autoCopy: 'text' },
    pendingRotation: null,
    lastDeriveMs: null,

    async hydrate() {
      try {
        const [saved, storedPrefs, storedHistory] = await Promise.all([
          session.load(),
          prefsFile.load(),
          historyFile.load(),
        ]);
        if (storedPrefs && typeof storedPrefs === 'object') {
          set({ prefs: { ...get().prefs, ...(storedPrefs as Partial<Prefs>) } });
        }
        if (Array.isArray(storedHistory)) {
          set({ history: storedHistory as HistoryItem[] });
        }
        if (saved) {
          set({ code: saved.code, fingerprint: await deriveFingerprint(saved.code) });
          await buildClient(get().prefs.relayUrl, saved.code, saved.key);
        }
      } finally {
        set({ hydrated: true });
      }
    },

    async join(rawCode, relayUrl) {
      const code = formatSessionCode(rawCode);
      if (!code) throw new Error('Not a Klip code — codes look like kx3m-9p2w-7qrt-c4vn.');
      const url = (relayUrl ?? get().prefs.relayUrl).trim();
      if (!isAllowedRelayUrl(url)) {
        throw new Error('The relay must be wss:// (plain ws:// is only allowed on your LAN).');
      }
      const t0 = Date.now();
      const key = await deriveSessionKey(code); // slow: pure-JS Argon2id, once per pairing
      set({ lastDeriveMs: Date.now() - t0 });
      await session.save(code, key);
      if (relayUrl) get().setPrefs({ relayUrl: url });
      set({ code, fingerprint: await deriveFingerprint(code), pendingRotation: null });
      await buildClient(url, code, key);
    },

    async leave() {
      await client?.disconnect();
      client = null;
      await session.clear();
      for (const item of get().history) {
        if (item.blobId) await blobs.remove(item.blobId);
      }
      set({ code: null, fingerprint: [], history: [], peerCount: 0, devices: [], status: 'disconnected' });
      await historyFile.save([]);
    },

    async sendClipboard() {
      if (await Clipboard.hasImageAsync()) {
        const image = await Clipboard.getImageAsync({ format: 'png' });
        const data = image?.data?.replace(/^data:image\/\w+;base64,/, '');
        if (data) {
          await get().sendImage(fromBase64(data));
          return 'image';
        }
      }
      const text = await Clipboard.getStringAsync();
      if (!text) return 'empty';
      await client?.sendText(text);
      applyAdd({
        id: randomUUID(), kind: 'text', text,
        deviceName: get().prefs.deviceName, direction: 'sent', ts: Date.now(), pinned: false,
      });
      return 'text';
    },

    async sendImage(png) {
      await client?.sendImage(png); // throws when > 4 MiB — surfaced by the UI
      const blobId = await blobs.save(png);
      applyAdd({
        id: randomUUID(), kind: 'image', blobId,
        deviceName: get().prefs.deviceName, direction: 'sent', ts: Date.now(), pinned: false,
      });
    },

    async copyItem(item) {
      if (item.kind === 'text' && item.text) {
        await Clipboard.setStringAsync(item.text);
      } else if (item.kind === 'image' && item.blobId) {
        const png = await blobs.load(item.blobId);
        if (png) await Clipboard.setImageAsync(toBase64(png));
      }
    },

    togglePin(id) {
      set((state) => ({
        history: state.history.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)),
      }));
      persistHistory();
    },

    removeItem(id) {
      const victim = get().history.find((item) => item.id === id);
      if (victim?.blobId) blobs.remove(victim.blobId).catch(() => {});
      set((state) => ({ history: state.history.filter((item) => item.id !== id) }));
      persistHistory();
    },

    setPrefs(partial) {
      set((state) => ({ prefs: { ...state.prefs, ...partial } }));
      prefsFile.save(get().prefs).catch(() => {});
    },

    async acceptRotation() {
      const pending = get().pendingRotation;
      if (!pending) return;
      set({ pendingRotation: null });
      await get().join(pending.code); // re-derives the key (seconds — UI shows progress)
    },

    dismissRotation() {
      set({ pendingRotation: null });
    },
  };
});
