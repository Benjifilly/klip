'use strict';

/**
 * Unit tests for the security-sensitive helpers and the relay's input
 * validation & abuse limits. No Electron required.
 *
 * Run with: npm test (runs before the e2e suite)
 */

const assert = require('node:assert');
const WebSocket = require('ws');
const { createRelay, PROTOCOL_VERSION } = require('../server/src/index.js');
const { sanitizeFileName, isAllowedRelayUrl } = require('../client/electron/util.cjs');
const { formatSessionCode, generateSessionCode } = require('../client/electron/crypto.cjs');

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws, type, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${type}"`)), timeoutMs);
    function onMessage(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== type) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(msg);
    }
    ws.on('message', onMessage);
  });
}

(async () => {
  // --- sanitizeFileName ---------------------------------------------------
  assert.strictEqual(sanitizeFileName('report.pdf'), 'report.pdf');
  assert.strictEqual(sanitizeFileName('..\\..\\evil.exe'), '_.._evil.exe'); // separators gone, no traversal
  assert.strictEqual(sanitizeFileName('a/b/c.txt'), 'a_b_c.txt');
  assert.strictEqual(sanitizeFileName('con<>:"|?*.txt'), 'con_______.txt');
  assert.strictEqual(sanitizeFileName('  .hidden  '), 'hidden');
  assert.strictEqual(sanitizeFileName(''), 'file');
  assert.strictEqual(sanitizeFileName(null), 'file');
  assert.strictEqual(sanitizeFileName('...'), 'file');
  // Control characters (NUL, ESC, DEL-1) become underscores.
  assert.strictEqual(sanitizeFileName(`a${String.fromCharCode(0)}b${String.fromCharCode(27)}c`), 'a_b_c');
  assert.strictEqual(sanitizeFileName('x'.repeat(300)).length, 120);
  console.log('✓ sanitizeFileName neutralizes hostile names');

  // --- isAllowedRelayUrl ----------------------------------------------------
  for (const ok of [
    'wss://relay.example.com',
    'wss://klip-relay.fly.dev',
    'ws://localhost:8787',
    'ws://127.0.0.1:8787',
    'ws://[::1]:8787',
    'ws://10.1.2.3:8787',
    'ws://192.168.1.10:8787',
    'ws://172.16.0.1:8787',
    'ws://172.31.255.255:8787',
    'ws://nas.local:8787',
  ]) {
    assert.strictEqual(isAllowedRelayUrl(ok), true, `${ok} should be allowed`);
  }
  for (const bad of [
    'ws://8.8.8.8:8787',
    'ws://example.com:8787',
    'ws://172.32.0.1:8787', // just outside the 172.16/12 private block
    'ws://172.15.0.1:8787',
    'ws://1270.0.0.1:8787',
    'https://example.com',
    'http://localhost:8787',
    'not a url',
    '',
  ]) {
    assert.strictEqual(isAllowedRelayUrl(bad), false, `${bad} should be rejected`);
  }
  console.log('✓ isAllowedRelayUrl only lets ws:// through on loopback/LAN');

  // --- formatSessionCode ----------------------------------------------------
  const generated = generateSessionCode();
  assert.strictEqual(formatSessionCode(generated), generated, 'generated codes round-trip');
  assert.strictEqual(formatSessionCode(generated.replace(/-/g, '')), generated, 'dashes are optional');
  assert.strictEqual(formatSessionCode(` ${generated.toUpperCase()} `), generated, 'case/whitespace-insensitive');
  for (const weak of ['benjamin', 'test-123', 'aaaa-bbbb-cccc', 'a'.repeat(17), '', null, 'xxxx-xxxx-xxxx-xxx!']) {
    assert.strictEqual(formatSessionCode(weak), null, `"${weak}" must be rejected`);
  }
  console.log('✓ formatSessionCode rejects weak human-chosen codes');

  // --- Relay: hello greeting + protocol version -----------------------------
  const relay = createRelay({ maxRoomMembers: 2, maxRooms: 2 });
  const port = await relay.listen(0);
  const roomA = 'a'.repeat(64);

  // The greeting fires the moment the socket opens — listen from construction.
  const hello = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => reject(new Error('timeout waiting for hello')), 3000);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      resolve({ ws, msg: JSON.parse(raw.toString()) });
    });
    ws.on('error', reject);
  });
  const a = hello.ws;
  assert.strictEqual(hello.msg.type, 'hello', 'first message must be the hello greeting');
  assert.strictEqual(hello.msg.v, PROTOCOL_VERSION, 'relay must announce its protocol version');
  console.log('✓ relay greets with hello + protocol version');

  a.send(JSON.stringify({ type: 'join', roomId: roomA }));
  await nextMessage(a, 'joined');

  // --- Relay: chunk validation ----------------------------------------------
  const badChunks = [
    { fid: 'x', seq: -1, tot: 3 },
    { fid: 'x', seq: 3, tot: 3 },
    { fid: 'x', seq: 0, tot: 0 },
    { fid: 'x', seq: 0, tot: 129 }, // above MAX_CHUNKS
    { fid: 'x', seq: 0.5, tot: 3 },
    { fid: 42, seq: 0, tot: 3 },
    { fid: 'y'.repeat(65), seq: 0, tot: 3 },
  ];
  for (const meta of badChunks) {
    const expectError = nextMessage(a, 'error');
    a.send(JSON.stringify({ type: 'clip', data: { iv: 'aW4=', ct: 'Y3Q=', ...meta } }));
    const err = await expectError;
    assert.strictEqual(err.error, 'invalid chunk', `chunk ${JSON.stringify(meta)} must be rejected`);
  }
  console.log('✓ relay rejects malformed chunk metadata');

  // --- Relay: v field forwarded, unknown fields dropped ----------------------
  const b = await connect(port);
  b.send(JSON.stringify({ type: 'join', roomId: roomA }));
  await nextMessage(b, 'joined');
  const clipAtB = nextMessage(b, 'clip');
  a.send(JSON.stringify({ type: 'clip', v: 1, mid: 'm1', data: { iv: 'aW4=', ct: 'Y3Q=', evil: 'x' } }));
  const fwd = await clipAtB;
  assert.strictEqual(fwd.v, 1, 'v must survive the relay');
  assert.strictEqual(fwd.data.evil, undefined, 'unknown payload fields must be dropped');
  console.log('✓ relay forwards the protocol version and strips unknown fields');

  // --- Relay: room member cap ------------------------------------------------
  const c = await connect(port);
  const full = nextMessage(c, 'error');
  c.send(JSON.stringify({ type: 'join', roomId: roomA }));
  assert.strictEqual((await full).error, 'room is full', 'third member must be rejected (cap=2)');
  console.log('✓ relay enforces the room member cap');

  // --- Relay: global room cap ------------------------------------------------
  c.send(JSON.stringify({ type: 'join', roomId: 'b'.repeat(64) }));
  await nextMessage(c, 'joined');
  const d = await connect(port);
  const serverFull = nextMessage(d, 'error');
  d.send(JSON.stringify({ type: 'join', roomId: 'c'.repeat(64) }));
  assert.strictEqual((await serverFull).error, 'server is full', 'room #3 must be rejected (cap=2)');
  console.log('✓ relay enforces the global room cap');

  for (const ws of [a, b, c, d]) ws.terminate();
  await relay.close();

  // --- Relay: per-IP connection cap -------------------------------------------
  const relay2 = createRelay({ maxConnsPerIp: 2 });
  const port2 = await relay2.listen(0);
  const e = await connect(port2);
  const f = await connect(port2);
  const closed = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port2}`);
    const timer = setTimeout(() => reject(new Error('timeout waiting for close')), 3000);
    ws.on('close', (code) => { clearTimeout(timer); resolve(code); });
    ws.on('error', reject);
  });
  assert.strictEqual(closed, 1013, 'third connection from the same IP must be turned away');
  console.log('✓ relay enforces the per-IP connection cap');

  for (const ws of [e, f]) ws.terminate();
  await relay2.close();

  console.log('\nAll unit checks passed.');
  process.exit(0);
})().catch((err) => {
  console.error('✗ unit tests failed:', err);
  process.exit(1);
});
