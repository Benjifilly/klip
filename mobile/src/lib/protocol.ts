/**
 * Klip relay client — same JSON-over-WebSocket protocol as the desktop app
 * (client/electron/main.cjs is the reference):
 *
 *   outbound envelope  {type:'clip', v:1, mid, sid, data:{iv,ct}}
 *   chunked transfers  data:{iv,ct,fid,seq,tot}, 256 KiB slices, chunk mid "<mid>:<seq>"
 *   inner payloads     {v, kind:'text'|'image'|'file'|'presence'|'rotate', deviceName, ts, …}
 *
 * Pure TS with zero React Native imports: runs under Node in CI against the
 * real relay (mobile/test/protocol.test.ts) and inside Hermes unchanged.
 * Uses `globalThis.WebSocket` (RN provides one; Node tests shim `ws`).
 */

import { encryptBytes, decryptBytes, encryptJSON, decryptJSON, formatSessionCode, type Packet } from './crypto';
import { toBase64, fromBase64 } from './base64';
import { randomUUID } from './random';

const CLIP_FORMAT_VERSION = 1;
const CHUNK_BYTES = 256 * 1024;
const MAX_CHUNKS_PER_TRANSFER = 128; // mirrors the relay's cap
const MAX_INFLIGHT_TRANSFERS = 4; // scaled down for a phone (desktop: 8)
const MAX_INFLIGHT_CHUNK_BYTES = 32 * 1024 * 1024; // scaled down for a phone (desktop: 64 MiB)
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // same cap as desktop
const PRESENCE_INTERVAL_MS = 60_000;
const PRESENCE_TTL_MS = 150_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MID_MEMORY = 512;
const WS_OPEN = 1;

export type Status = 'disconnected' | 'connecting' | 'connected';

export type IncomingClip =
  | { kind: 'text'; text: string; deviceName: string; ts: number }
  | { kind: 'image'; png: Uint8Array; deviceName: string; ts: number }
  /** V1 shows files as a placeholder — the bytes are intentionally dropped. */
  | { kind: 'file'; name: string; deviceName: string; ts: number };

export interface PeerDevice {
  id: string;
  name: string;
  ts: number;
}

export interface RelayClientOptions {
  url: string;
  roomId: string;
  key: Uint8Array;
  installId: string;
  deviceName: string;
  onClip(clip: IncomingClip): void;
  /** Rotation is consent-based: the UI must ask before following. */
  onRotate(request: { code: string; deviceName: string }): void;
  onStatus(status: Status): void;
  onPeers(count: number): void;
  onPresence(devices: PeerDevice[]): void;
}

/** Plain ws:// is only acceptable on loopback/private LAN — desktop rule. */
export function isAllowedRelayUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return false;
  }
  if (url.protocol === 'wss:') return true;
  if (url.protocol !== 'ws:') return false;
  const host = url.hostname;
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  );
}

interface Transfer {
  tot: number;
  parts: Map<number, Uint8Array>;
  bytes: number;
  ts: number;
}

type ChunkData = Packet & { fid: string; seq: number; tot: number };

export class RelayClient {
  private readonly opts: RelayClientOptions;
  private ws: WebSocket | null = null;
  /** Bumped on every (re)connect/disconnect so stale socket events no-op. */
  private generation = 0;
  private seenMids = new Set<string>();
  private transfers = new Map<string, Transfer>();
  private inflightBytes = 0;
  private peers = new Map<string, { name: string; ts: number }>();
  private reconnectDelay = 1_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private closed = true;

  constructor(opts: RelayClientOptions) {
    this.opts = opts;
  }

  connect(): void {
    this.closed = false;
    this.teardownSocket();
    const gen = ++this.generation;
    this.opts.onStatus('connecting');

    const WS = (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket;
    let ws: WebSocket;
    try {
      ws = new WS(this.opts.url);
    } catch {
      this.opts.onStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (gen !== this.generation) return;
      this.reconnectDelay = 1_000;
      ws.send(JSON.stringify({ type: 'join', roomId: this.opts.roomId }));
    });
    ws.addEventListener('message', (event: MessageEvent) => {
      if (gen !== this.generation) return;
      this.onMessage(String(event.data)).catch(() => {
        /* malformed packet — ignore */
      });
    });
    ws.addEventListener('close', () => {
      if (gen !== this.generation) return;
      this.stopPresence();
      this.opts.onStatus('disconnected');
      if (!this.closed) this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      /* 'close' follows and drives the retry */
    });
  }

  /** Graceful leave: best-effort presence `bye`, then close. */
  async disconnect(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      await this.sendPresence(false, true);
    } catch {
      /* bye is best-effort */
    }
    this.stopPresence();
    this.generation++;
    this.teardownSocket();
    this.opts.onStatus('disconnected');
  }

  async sendText(text: string): Promise<void> {
    if (!text) return;
    await this.sendEncrypted({ kind: 'text', text, deviceName: this.opts.deviceName, ts: Date.now() });
  }

  async sendImage(png: Uint8Array): Promise<void> {
    if (!png.length) throw new Error('empty image');
    if (png.length > MAX_IMAGE_BYTES) throw new Error('image too large (4 MiB max)');
    await this.sendEncrypted({ kind: 'image', png: toBase64(png), deviceName: this.opts.deviceName, ts: Date.now() });
  }

  // --- internals ----------------------------------------------------------

  private teardownSocket(): void {
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  /** Returns true when the mid was already seen (drop the packet). */
  private rememberMid(mid: unknown): boolean {
    if (typeof mid !== 'string' || !mid) return false;
    if (this.seenMids.has(mid)) return true;
    this.seenMids.add(mid);
    if (this.seenMids.size > MID_MEMORY) {
      const oldest = this.seenMids.values().next().value;
      if (oldest !== undefined) this.seenMids.delete(oldest);
    }
    return false;
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: { type?: string; count?: unknown; sid?: unknown; mid?: unknown; data?: Packet & Partial<ChunkData> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'joined':
        this.opts.onStatus('connected');
        this.startPresence();
        this.sendPresence(true).catch(() => {});
        return;

      case 'peers':
        this.opts.onPeers(Number(msg.count) || 0);
        this.prunePeers();
        return;

      case 'clip': {
        if (!msg.data) return;
        if (typeof msg.sid === 'string' && msg.sid === this.opts.installId) return; // our own packet, replayed
        if (this.rememberMid(msg.mid)) return; // already handled
        if (msg.data.fid !== undefined) return this.onChunk(msg.data as ChunkData);
        let item: unknown;
        try {
          item = await decryptJSON(this.opts.key, msg.data);
        } catch {
          return; // wrong key or tampered packet — GCM auth failed
        }
        this.applyIncoming(item);
        return;
      }

      default:
        return; // hello, left, error, pong — nothing to do at v1
    }
  }

  private async onChunk(data: ChunkData): Promise<void> {
    // Validate chunk metadata before paying for decryption.
    if (
      typeof data.fid !== 'string' || data.fid.length > 64 ||
      !Number.isInteger(data.seq) || !Number.isInteger(data.tot) ||
      data.seq < 0 || data.tot < 1 || data.tot > MAX_CHUNKS_PER_TRANSFER || data.seq >= data.tot
    ) {
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = await decryptBytes(this.opts.key, data);
    } catch {
      return;
    }
    let transfer = this.transfers.get(data.fid);
    if (!transfer) {
      // A flood of never-completing transfers must not balloon our memory.
      if (this.transfers.size >= MAX_INFLIGHT_TRANSFERS) return;
      transfer = { tot: data.tot, parts: new Map(), bytes: 0, ts: Date.now() };
      this.transfers.set(data.fid, transfer);
    }
    if (data.tot !== transfer.tot || transfer.parts.has(data.seq)) return;
    transfer.parts.set(data.seq, bytes);
    transfer.bytes += bytes.length;
    this.inflightBytes += bytes.length;
    if (this.inflightBytes > MAX_INFLIGHT_CHUNK_BYTES) {
      this.dropTransfer(data.fid);
      return;
    }
    if (transfer.parts.size < transfer.tot) return;

    this.dropTransfer(data.fid);
    let total = 0;
    for (let seq = 0; seq < transfer.tot; seq++) total += transfer.parts.get(seq)?.length ?? 0;
    const joined = new Uint8Array(total);
    let offset = 0;
    for (let seq = 0; seq < transfer.tot; seq++) {
      const part = transfer.parts.get(seq);
      if (!part) return;
      joined.set(part, offset);
      offset += part.length;
    }
    let item: unknown;
    try {
      item = JSON.parse(new TextDecoder().decode(joined));
    } catch {
      return;
    }
    this.applyIncoming(item);
  }

  private dropTransfer(fid: string): void {
    const transfer = this.transfers.get(fid);
    if (!transfer) return;
    this.inflightBytes -= transfer.bytes;
    this.transfers.delete(fid);
  }

  private applyIncoming(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Record<string, unknown>;
    // Packets from a future, incompatible client version are skipped whole.
    if (Number.isInteger(item.v) && (item.v as number) > CLIP_FORMAT_VERSION) return;
    const deviceName = String(item.deviceName ?? 'Unknown device').slice(0, 64);
    const ts = typeof item.ts === 'number' && Number.isFinite(item.ts) ? item.ts : Date.now();

    if (item.kind === 'presence') {
      const id = String(item.id ?? '').slice(0, 64);
      if (!id || id === this.opts.installId) return;
      if (item.bye) {
        if (this.peers.delete(id)) this.emitPresence();
        return;
      }
      const previous = this.peers.get(id);
      this.peers.set(id, { name: deviceName, ts: Date.now() });
      // A newcomer says hello; answer so it learns we exist too.
      if (item.hello) this.sendPresence(false).catch(() => {});
      if (!previous || previous.name !== deviceName) this.emitPresence();
      return;
    }

    if (item.kind === 'rotate') {
      const code = formatSessionCode(item.code);
      if (!code) return;
      // Never follow silently: anyone holding the code could otherwise move
      // every device to a session they control without a trace.
      this.opts.onRotate({ code, deviceName });
      return;
    }

    if (item.kind === 'image') {
      if (typeof item.png !== 'string') return;
      const png = fromBase64(item.png);
      if (!png.length || png.length > MAX_IMAGE_BYTES) return;
      this.opts.onClip({ kind: 'image', png, deviceName, ts });
      return;
    }

    if (item.kind === 'file') {
      const name = String(item.name ?? 'file').slice(0, 128);
      this.opts.onClip({ kind: 'file', name, deviceName, ts });
      return;
    }

    // 'text', or legacy packets without a kind field.
    if (typeof item.text === 'string' && item.text) {
      this.opts.onClip({ kind: 'text', text: item.text, deviceName, ts });
    }
  }

  /** Encrypt a payload and send it, chunking transparently when it's large. */
  private async sendEncrypted(payload: Record<string, unknown>): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return;
    const versioned = { v: CLIP_FORMAT_VERSION, ...payload };
    const mid = randomUUID();
    const bytes = new TextEncoder().encode(JSON.stringify(versioned));

    if (bytes.length <= CHUNK_BYTES) {
      this.rememberMid(mid);
      const data = await encryptJSON(this.opts.key, versioned);
      ws.send(JSON.stringify({ type: 'clip', v: CLIP_FORMAT_VERSION, mid, sid: this.opts.installId, data }));
      return;
    }

    const tot = Math.ceil(bytes.length / CHUNK_BYTES);
    if (tot > MAX_CHUNKS_PER_TRANSFER) throw new Error('payload too large');
    const fid = randomUUID();
    for (let seq = 0; seq < tot; seq++) {
      const slice = bytes.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES);
      const data = await encryptBytes(this.opts.key, slice);
      const chunkMid = `${mid}:${seq}`;
      this.rememberMid(chunkMid);
      if (!this.ws || this.ws.readyState !== WS_OPEN) return;
      this.ws.send(
        JSON.stringify({ type: 'clip', v: CLIP_FORMAT_VERSION, mid: chunkMid, sid: this.opts.installId, data: { ...data, fid, seq, tot } }),
      );
    }
  }

  /**
   * Encrypted presence announcements — the relay only ever sees ciphertext.
   * `hello` asks others to answer; `bye` is a graceful goodbye.
   */
  private async sendPresence(hello: boolean, bye = false): Promise<void> {
    await this.sendEncrypted({
      kind: 'presence',
      id: this.opts.installId,
      name: this.opts.deviceName,
      hello,
      bye,
      ts: Date.now(),
    });
  }

  private startPresence(): void {
    this.stopPresence();
    this.presenceTimer = setInterval(() => {
      this.sendPresence(false).catch(() => {});
      this.prunePeers();
    }, PRESENCE_INTERVAL_MS);
  }

  private stopPresence(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
  }

  private prunePeers(): void {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (peer.ts < cutoff) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPresence();
  }

  private emitPresence(): void {
    this.opts.onPresence([...this.peers].map(([id, peer]) => ({ id, name: peer.name, ts: peer.ts })));
  }
}
