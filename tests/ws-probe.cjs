'use strict';
// One-shot probe: does a real WebSocket round-trip work against the deployed relay?
const WebSocket = require('ws');

const url = process.argv[2] || 'wss://klip-relay.fly.dev';
const roomId = 'a'.repeat(64);
const started = Date.now();

const ws = new WebSocket(url);
ws.on('open', () => {
  console.log(`open after ${Date.now() - started}ms`);
  ws.send(JSON.stringify({ type: 'join', roomId }));
});
ws.on('message', (raw) => {
  console.log('message:', raw.toString());
  // The relay greets with `hello` first; keep listening until the join settles.
  let type = '';
  try { type = JSON.parse(raw.toString()).type; } catch { /* not json */ }
  if (type === 'joined' || type === 'error') ws.close();
});
ws.on('close', (code, reason) => {
  console.log('close:', code, reason.toString());
  process.exit(0);
});
ws.on('error', (err) => {
  console.error('error:', err.message);
  process.exit(1);
});
setTimeout(() => {
  console.error('timeout after 15s');
  process.exit(2);
}, 15_000);
