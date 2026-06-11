/**
 * RelayClient against the real relay (in-process, like tests/e2e.cjs) with a
 * "desktop" peer speaking through the reference crypto module — proves the
 * mobile client interoperates end-to-end: join, text both ways, chunked
 * images, own-packet dedupe, rotate-as-consent.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { RelayClient, isAllowedRelayUrl, type IncomingClip, type Status } from '../src/lib/protocol';
import { deriveSessionKey, generateSessionCode } from '../src/lib/crypto';

const require_ = createRequire(import.meta.url);
const { createRelay } = require_('../../server/src/index.js');
const kc = require_('../../client/electron/crypto.cjs');

type Relay = { listen(port?: number): Promise<number>; close(): Promise<void> };

let relay: Relay;
let port: number;
let code: string;
let key: Uint8Array;
let roomId: string;
let desktopKey: unknown;

/**
 * Each test gets a fresh room: the relay's store-and-forward buffer replays
 * recent ciphertext to every newcomer (by design), which would leak clips
 * across tests sharing a room. The key can be shared — rooms only isolate
 * relay routing, and deriveRoomId interop is covered by the crypto suite.
 */
function freshRoomId(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const WS = () => (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket;

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

function makeClient(installId: string) {
  const events = {
    clips: [] as IncomingClip[],
    rotates: [] as { code: string; deviceName: string }[],
    statuses: [] as Status[],
    peerCounts: [] as number[],
  };
  const client = new RelayClient({
    url: `ws://127.0.0.1:${port}`,
    roomId,
    key,
    installId,
    deviceName: 'iPhone',
    onClip: (c) => events.clips.push(c),
    onRotate: (r) => events.rotates.push(r),
    onStatus: (s) => events.statuses.push(s),
    onPeers: (n) => events.peerCounts.push(n),
    onPresence: () => {},
  });
  return { client, events };
}

/** A raw "desktop" peer: real WS + the reference crypto module. */
async function makeDesktopPeer() {
  const ws = new (WS())(`ws://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const joined = new Promise<void>((resolve) => {
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (JSON.parse(String(ev.data)).type === 'joined') resolve();
    });
  });
  ws.send(JSON.stringify({ type: 'join', roomId }));
  await joined;
  return ws;
}

beforeAll(async () => {
  relay = createRelay();
  port = await relay.listen(0);
  code = generateSessionCode();
  key = await deriveSessionKey(code);
  desktopKey = await kc.deriveSessionKey(code);
});

beforeEach(() => {
  roomId = freshRoomId();
});

afterAll(async () => {
  await relay.close();
});

describe('isAllowedRelayUrl', () => {
  it('accepts wss anywhere, ws only on loopback/LAN', () => {
    expect(isAllowedRelayUrl('wss://klip-relay.fly.dev')).toBe(true);
    expect(isAllowedRelayUrl('ws://127.0.0.1:8787')).toBe(true);
    expect(isAllowedRelayUrl('ws://192.168.1.20:8787')).toBe(true);
    expect(isAllowedRelayUrl('ws://evil.example.com')).toBe(false);
    expect(isAllowedRelayUrl('https://example.com')).toBe(false);
    expect(isAllowedRelayUrl('not a url')).toBe(false);
  });
});

describe('RelayClient', () => {
  it('connects, joins, and reports connected', async () => {
    const { client, events } = makeClient('ios-status');
    client.connect();
    await until(() => events.statuses.includes('connected'));
    await client.disconnect();
    expect(events.statuses[events.statuses.length - 1]).toBe('disconnected');
  });

  it('round-trips text with a desktop-format peer, both directions', async () => {
    const { client, events } = makeClient('ios-text');
    client.connect();
    await until(() => events.statuses.includes('connected'));

    const peer = await makeDesktopPeer();
    const got: Record<string, unknown>[] = [];
    peer.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type !== 'clip' || msg.data.fid !== undefined) return;
      void (kc.decryptJSON(desktopKey, msg.data) as Promise<Record<string, unknown>>).then((item) => got.push(item));
    });

    const data = await kc.encryptJSON(desktopKey, {
      v: 1, kind: 'text', text: 'from desktop', deviceName: 'PC', ts: Date.now(),
    });
    peer.send(JSON.stringify({ type: 'clip', v: 1, mid: 'm-text-1', sid: 'desktop-1', data }));
    await until(() => events.clips.length === 1);
    expect(events.clips[0]).toMatchObject({ kind: 'text', text: 'from desktop', deviceName: 'PC' });

    await client.sendText('from iOS');
    await until(() => got.some((item) => item.kind === 'text'));
    const text = got.find((item) => item.kind === 'text');
    expect(text).toMatchObject({ kind: 'text', text: 'from iOS', deviceName: 'iPhone' });

    peer.close();
    await client.disconnect();
  });

  it('reassembles chunked images between two mobile clients; own packets are dropped', async () => {
    const a = makeClient('ios-a');
    const b = makeClient('ios-b');
    a.client.connect();
    b.client.connect();
    await until(() => a.events.statuses.includes('connected') && b.events.statuses.includes('connected'));

    // Big enough that the JSON payload spans several 256 KiB chunks.
    const png = new Uint8Array(600 * 1024).map((_, i) => (i * 7) % 256);
    await a.client.sendImage(png);

    await until(() => b.events.clips.length === 1, 15_000);
    const clip = b.events.clips[0];
    expect(clip.kind).toBe('image');
    if (clip.kind === 'image') {
      expect(clip.png.length).toBe(png.length);
      expect(Array.from(clip.png.slice(0, 16))).toEqual(Array.from(png.slice(0, 16)));
    }
    expect(a.events.clips.length).toBe(0); // sender never re-applies its own clip

    await a.client.disconnect();
    await b.client.disconnect();
  });

  it('surfaces rotate as a consent request, never auto-follows', async () => {
    const { client, events } = makeClient('ios-rotate');
    client.connect();
    await until(() => events.statuses.includes('connected'));

    const peer = await makeDesktopPeer();
    const fresh = generateSessionCode();
    const data = await kc.encryptJSON(desktopKey, {
      v: 1, kind: 'rotate', code: fresh, deviceName: 'PC', ts: Date.now(),
    });
    peer.send(JSON.stringify({ type: 'clip', v: 1, mid: 'm-rotate-1', sid: 'desktop-1', data }));

    await until(() => events.rotates.length === 1);
    expect(events.rotates[0]).toEqual({ code: fresh, deviceName: 'PC' });
    expect(events.clips.length).toBe(0);

    peer.close();
    await client.disconnect();
  });

  it('skips packets from a future clip-format version', async () => {
    const { client, events } = makeClient('ios-future');
    client.connect();
    await until(() => events.statuses.includes('connected'));

    const peer = await makeDesktopPeer();
    const data = await kc.encryptJSON(desktopKey, {
      v: 999, kind: 'text', text: 'from the future', deviceName: 'PC', ts: Date.now(),
    });
    peer.send(JSON.stringify({ type: 'clip', v: 1, mid: 'm-future-1', sid: 'desktop-1', data }));
    const probe = await kc.encryptJSON(desktopKey, {
      v: 1, kind: 'text', text: 'probe', deviceName: 'PC', ts: Date.now(),
    });
    peer.send(JSON.stringify({ type: 'clip', v: 1, mid: 'm-future-2', sid: 'desktop-1', data: probe }));

    await until(() => events.clips.length === 1);
    expect(events.clips[0]).toMatchObject({ kind: 'text', text: 'probe' });

    peer.close();
    await client.disconnect();
  });
});
