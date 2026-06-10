'use strict';

/**
 * Klip relay server.
 *
 * A deliberately tiny WebSocket relay: clients join a "room" identified by an
 * opaque 64-char hex id (a salted hash of the session code, computed
 * client-side), and every `clip` packet is forwarded verbatim to the other
 * members of the room.
 *
 * Privacy guarantees, by construction:
 *   - Payloads are AES-256-GCM ciphertext produced on the client. The relay
 *     never receives the session code, the derived key, or any plaintext.
 *   - Nothing about payload content is ever logged.
 *   - Store-and-forward (catch-up replay for reconnecting devices) buffers
 *     ciphertext only, in memory, for a short TTL. Disable with
 *     KLIP_REPLAY_MAX=0.
 *
 * Wire format additions (v2):
 *   - `mid` (string) — client-generated message id so receivers can dedupe
 *     replayed packets.
 *   - `sid` (string) — opaque per-install sender id so a client can drop its
 *     own packets coming back through replay.
 *   - `data.fid/seq/tot` — chunked transfer metadata for payloads larger than
 *     one frame (images). Each chunk is independently encrypted.
 *   - `v` (int) — protocol version of the packet, forwarded verbatim. The
 *     relay greets every connection with `{type:'hello', v}` so clients can
 *     detect a relay that is too old or too new for them.
 */

const http = require('http');
const { WebSocketServer } = require('ws');

/** Version announced in the `hello` greeting and accepted in packets. */
const PROTOCOL_VERSION = 1;

const DEFAULTS = {
  port: Number(process.env.PORT) || 8787,
  maxPayloadBytes: 512 * 1024,
  heartbeatIntervalMs: 30_000,
  // Generous enough for a chunked image/file burst, still a meaningful cap.
  rateLimit: { windowMs: 10_000, maxMessages: 300 },
  // Catch-up buffer: last N forwarded packets per room, replayed to (re)joining
  // devices while younger than the TTL. Ciphertext only, memory-capped.
  replayMax: Number(process.env.KLIP_REPLAY_MAX ?? 128),
  replayMaxBytes: Number(process.env.KLIP_REPLAY_MAX_BYTES ?? 8 * 1024 * 1024),
  replayTtlMs: Number(process.env.KLIP_REPLAY_TTL_MS ?? 120_000),
  // Global limits — keep one abusive client (or many) from exhausting memory.
  maxRooms: Number(process.env.KLIP_MAX_ROOMS ?? 512),
  maxRoomMembers: Number(process.env.KLIP_MAX_ROOM_MEMBERS ?? 10),
  maxConnsPerIp: Number(process.env.KLIP_MAX_CONNS_PER_IP ?? 32),
  replayGlobalMaxBytes: Number(process.env.KLIP_REPLAY_GLOBAL_MAX_BYTES ?? 64 * 1024 * 1024),
  // Per-IP limits only make sense on the real client address. Behind a
  // reverse proxy the socket address is the proxy's, so trust the
  // x-forwarded-for header there (auto-detected on Fly.io).
  trustProxy: process.env.KLIP_TRUST_PROXY
    ? process.env.KLIP_TRUST_PROXY !== '0'
    : Boolean(process.env.FLY_APP_NAME),
};

const ROOM_ID_RE = /^[a-f0-9]{64}$/;
const MAX_CHUNKS = 128;

function createRelay(options = {}) {
  const cfg = { ...DEFAULTS, ...options };

  /** @type {Map<string, Set<import('ws').WebSocket>>} roomId -> members */
  const rooms = new Map();
  /** @type {Map<string, {entries: Array<{ts: number, out: string}>, bytes: number}>} roomId -> recent ciphertext packets */
  const buffers = new Map();
  /** @type {Map<string, number>} client ip -> open connections */
  const connsPerIp = new Map();

  const metrics = { forwarded: 0, replayed: 0 };
  let replayBytesTotal = 0;

  function bufferedCount() {
    let total = 0;
    for (const buffer of buffers.values()) total += buffer.entries.length;
    return total;
  }

  function clientIp(req) {
    if (cfg.trustProxy) {
      const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      res.end([
        '# HELP klip_rooms Active rooms.',
        '# TYPE klip_rooms gauge',
        `klip_rooms ${rooms.size}`,
        '# HELP klip_connections Open WebSocket connections.',
        '# TYPE klip_connections gauge',
        `klip_connections ${wss.clients.size}`,
        '# HELP klip_messages_forwarded_total Clip packets forwarded.',
        '# TYPE klip_messages_forwarded_total counter',
        `klip_messages_forwarded_total ${metrics.forwarded}`,
        '# HELP klip_messages_replayed_total Clip packets replayed to (re)joining devices.',
        '# TYPE klip_messages_replayed_total counter',
        `klip_messages_replayed_total ${metrics.replayed}`,
        '# HELP klip_buffered_messages Ciphertext packets currently held for replay.',
        '# TYPE klip_buffered_messages gauge',
        `klip_buffered_messages ${bufferedCount()}`,
        '# HELP klip_replay_bytes Total bytes held in replay buffers.',
        '# TYPE klip_replay_bytes gauge',
        `klip_replay_bytes ${replayBytesTotal}`,
        '',
      ].join('\n'));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, maxPayload: cfg.maxPayloadBytes });

  function send(ws, obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  function broadcastPeers(roomId) {
    const members = rooms.get(roomId);
    if (!members) return;
    const out = JSON.stringify({ type: 'peers', count: members.size });
    for (const peer of members) {
      if (peer.readyState === peer.OPEN) peer.send(out);
    }
  }

  function pruneBuffer(roomId) {
    const buffer = buffers.get(roomId);
    if (!buffer) return [];
    const cutoff = Date.now() - cfg.replayTtlMs;
    while (buffer.entries.length && buffer.entries[0].ts < cutoff) {
      const dropped = buffer.entries.shift().out.length;
      buffer.bytes -= dropped;
      replayBytesTotal -= dropped;
    }
    if (buffer.entries.length === 0) buffers.delete(roomId);
    return buffer.entries;
  }

  /** Keep the sum of all replay buffers under the global memory budget. */
  function evictReplayGlobal() {
    while (replayBytesTotal > cfg.replayGlobalMaxBytes) {
      const next = buffers.entries().next();
      if (next.done) {
        replayBytesTotal = 0; // bookkeeping drifted — resync
        return;
      }
      const [roomId, buffer] = next.value;
      const entry = buffer.entries.shift();
      if (entry) {
        buffer.bytes -= entry.out.length;
        replayBytesTotal -= entry.out.length;
      }
      if (buffer.entries.length === 0) buffers.delete(roomId);
    }
  }

  function joinRoom(ws, roomId) {
    leaveRoom(ws);
    let members = rooms.get(roomId);
    if (!members) {
      members = new Set();
      rooms.set(roomId, members);
    }
    members.add(ws);
    ws.roomId = roomId;
  }

  function leaveRoom(ws) {
    const roomId = ws.roomId;
    if (!roomId) return;
    ws.roomId = null;
    const members = rooms.get(roomId);
    if (!members) return;
    members.delete(ws);
    if (members.size === 0) rooms.delete(roomId); // replay buffer outlives the room until its TTL
    else broadcastPeers(roomId);
  }

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    const open = (connsPerIp.get(ip) ?? 0) + 1;
    if (open > cfg.maxConnsPerIp) {
      ws.close(1013, 'too many connections');
      return;
    }
    connsPerIp.set(ip, open);

    ws.isAlive = true;
    ws.roomId = null;
    ws.msgWindowStart = Date.now();
    ws.msgCount = 0;

    send(ws, { type: 'hello', v: PROTOCOL_VERSION });

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => { /* 'close' follows */ });
    ws.on('close', () => {
      leaveRoom(ws);
      const remaining = (connsPerIp.get(ip) ?? 1) - 1;
      if (remaining <= 0) connsPerIp.delete(ip);
      else connsPerIp.set(ip, remaining);
    });

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return ws.close(1003, 'binary frames not supported');

      const now = Date.now();
      if (now - ws.msgWindowStart > cfg.rateLimit.windowMs) {
        ws.msgWindowStart = now;
        ws.msgCount = 0;
      }
      if (++ws.msgCount > cfg.rateLimit.maxMessages) {
        return ws.close(1008, 'rate limit exceeded');
      }

      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return send(ws, { type: 'error', error: 'invalid json' });
      }

      switch (msg.type) {
        case 'join': {
          if (typeof msg.roomId !== 'string' || !ROOM_ID_RE.test(msg.roomId)) {
            return send(ws, { type: 'error', error: 'invalid roomId' });
          }
          const members = rooms.get(msg.roomId);
          if (members && members.size >= cfg.maxRoomMembers && !members.has(ws)) {
            return send(ws, { type: 'error', error: 'room is full' });
          }
          if (!members && rooms.size >= cfg.maxRooms) {
            return send(ws, { type: 'error', error: 'server is full' });
          }
          joinRoom(ws, msg.roomId);
          send(ws, { type: 'joined', roomId: msg.roomId });
          // Catch the newcomer up on what it missed (ciphertext only).
          for (const entry of pruneBuffer(msg.roomId)) {
            if (ws.readyState === ws.OPEN) {
              ws.send(entry.out);
              metrics.replayed += 1;
            }
          }
          broadcastPeers(msg.roomId);
          break;
        }

        case 'leave': {
          leaveRoom(ws);
          send(ws, { type: 'left' });
          break;
        }

        case 'clip': {
          if (!ws.roomId) return send(ws, { type: 'error', error: 'not in a room' });
          const data = msg.data;
          if (!data || typeof data.iv !== 'string' || typeof data.ct !== 'string') {
            return send(ws, { type: 'error', error: 'invalid payload' });
          }
          // Forward only the fields we expect — drop anything else.
          const fwd = { type: 'clip', data: { iv: data.iv, ct: data.ct }, ts: Date.now() };
          if (Number.isInteger(msg.v) && msg.v >= 0 && msg.v <= 1_000) fwd.v = msg.v;
          if (typeof msg.mid === 'string' && msg.mid.length <= 80) fwd.mid = msg.mid;
          if (typeof msg.sid === 'string' && msg.sid.length <= 64) fwd.sid = msg.sid;
          if (data.fid !== undefined) {
            if (
              typeof data.fid !== 'string' || data.fid.length > 64 ||
              !Number.isInteger(data.seq) || !Number.isInteger(data.tot) ||
              data.seq < 0 || data.tot < 1 || data.tot > MAX_CHUNKS || data.seq >= data.tot
            ) {
              return send(ws, { type: 'error', error: 'invalid chunk' });
            }
            fwd.data.fid = data.fid;
            fwd.data.seq = data.seq;
            fwd.data.tot = data.tot;
          }
          const out = JSON.stringify(fwd);
          for (const peer of rooms.get(ws.roomId)) {
            if (peer !== ws && peer.readyState === peer.OPEN) {
              peer.send(out);
              metrics.forwarded += 1;
            }
          }
          if (cfg.replayMax > 0) {
            let buffer = buffers.get(ws.roomId);
            if (!buffer) {
              buffer = { entries: [], bytes: 0 };
              buffers.set(ws.roomId, buffer);
            }
            buffer.entries.push({ ts: fwd.ts, out });
            buffer.bytes += out.length;
            replayBytesTotal += out.length;
            // Evict oldest packets when over the count or memory budget.
            while (
              buffer.entries.length > cfg.replayMax ||
              (buffer.bytes > cfg.replayMaxBytes && buffer.entries.length > 1)
            ) {
              const dropped = buffer.entries.shift().out.length;
              buffer.bytes -= dropped;
              replayBytesTotal -= dropped;
            }
            evictReplayGlobal();
          }
          break;
        }

        case 'ping':
          send(ws, { type: 'pong' });
          break;

        default:
          send(ws, { type: 'error', error: 'unknown message type' });
      }
    });
  });

  // Terminate dead connections so empty rooms get cleaned up, and expire
  // replay buffers past their TTL.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
    for (const roomId of [...buffers.keys()]) pruneBuffer(roomId);
  }, cfg.heartbeatIntervalMs);

  return {
    server,
    wss,
    rooms,
    buffers,
    listen(port = cfg.port) {
      return new Promise((resolve) => {
        server.listen(port, () => resolve(server.address().port));
      });
    },
    close() {
      return new Promise((resolve) => {
        clearInterval(heartbeat);
        for (const client of wss.clients) client.terminate();
        wss.close(() => server.close(() => resolve()));
      });
    },
  };
}

if (require.main === module) {
  const relay = createRelay();
  // ws forwards http server errors to the WebSocketServer, so listen there.
  relay.wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[klip-relay] port ${err.port} is already in use — is another relay still running?`);
      process.exit(1);
    }
    throw err;
  });
  relay.listen().then((port) => {
    console.log(`[klip-relay] listening on :${port} — payloads are end-to-end encrypted, nothing readable passes through here`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`[klip-relay] ${signal} received, shutting down`);
      relay.close().then(() => process.exit(0));
    });
  }
}

module.exports = { createRelay, PROTOCOL_VERSION };
