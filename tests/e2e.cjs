'use strict';

/**
 * End-to-end test, no Electron required:
 *   1. Argon2id key derivation + AES-GCM round-trip through the real crypto module.
 *   2. Session fingerprint is stable and session-specific.
 *   3. The ciphertext sent over the wire must not contain the plaintext.
 *   4. Decryption with the wrong key must fail (GCM authentication).
 *   5. The relay forwards packets to room members only — never across rooms,
 *      never back to the sender.
 *   6. Chunked transfers: chunk metadata (fid/seq/tot) and mid/sid survive the relay.
 *   7. Store-and-forward: a device joining late catches up on buffered ciphertext.
 *
 * Run with: npm test
 */

const assert = require('node:assert');
const WebSocket = require('ws');
const { createRelay } = require('../server/src/index.js');
const kc = require('../client/electron/crypto.cjs');

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

/** Collect `count` clip messages; attach BEFORE triggering the sends. */
function collectClips(ws, count, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const got = [];
    const timer = setTimeout(
      () => reject(new Error(`timeout: got ${got.length}/${count} clips`)),
      timeoutMs,
    );
    function onMessage(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'clip') return;
      got.push(msg);
      if (got.length === count) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(got);
      }
    }
    ws.on('message', onMessage);
  });
}

(async () => {
  // 1. Crypto round-trip (Argon2id derivation + AES-256-GCM)
  const code = kc.generateSessionCode();
  assert.match(code, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  const key = await kc.deriveSessionKey(code);
  const payload = { kind: 'text', text: 'secret-clipboard-text', deviceName: 'laptop', ts: Date.now() };
  const sealed = await kc.encryptJSON(key, payload);
  assert.deepStrictEqual(await kc.decryptJSON(key, sealed), payload);

  // Binary path used by chunked transfers
  const blob = new Uint8Array(200 * 1024);
  globalThis.crypto.getRandomValues(blob.subarray(0, 65536));
  const sealedBytes = await kc.encryptBytes(key, blob);
  assert.deepStrictEqual(await kc.decryptBytes(key, sealedBytes), blob);
  console.log('✓ Argon2id + AES-256-GCM round-trip (JSON and raw bytes)');

  // 2. Fingerprint: 4 emojis, deterministic, session-specific
  const fp1 = await kc.deriveFingerprint(code);
  const fp2 = await kc.deriveFingerprint(code.toUpperCase());
  const fpOther = await kc.deriveFingerprint(kc.generateSessionCode());
  assert.strictEqual(fp1.length, 4);
  assert.deepStrictEqual(fp1, fp2, 'fingerprint must be stable across formatting');
  assert.notDeepStrictEqual(fp1, fpOther, 'different sessions must fingerprint differently');
  console.log(`✓ session fingerprint is stable and unique (${fp1.join('')})`);

  // 3. Wire format must not leak plaintext
  assert.ok(
    !JSON.stringify(sealed).includes('secret-clipboard-text'),
    'ciphertext must not contain the plaintext',
  );
  console.log('✓ ciphertext leaks nothing readable');

  // 4. Wrong key must fail authentication
  const otherKey = await kc.deriveSessionKey(kc.generateSessionCode());
  await assert.rejects(kc.decryptJSON(otherKey, sealed));
  console.log('✓ wrong key is rejected (GCM auth)');

  // 5. Relay: A -> B within a room; C, in another room, must receive nothing
  const relay = createRelay();
  const port = await relay.listen(0);
  const roomId = await kc.deriveRoomId(code);
  const otherRoomId = await kc.deriveRoomId(kc.generateSessionCode());
  assert.notStrictEqual(roomId, otherRoomId);

  const [a, b, c] = await Promise.all([connect(port), connect(port), connect(port)]);
  a.send(JSON.stringify({ type: 'join', roomId }));
  await nextMessage(a, 'joined');
  b.send(JSON.stringify({ type: 'join', roomId }));
  await nextMessage(b, 'joined');
  c.send(JSON.stringify({ type: 'join', roomId: otherRoomId }));
  await nextMessage(c, 'joined');

  let aGotClipBack = false;
  let cGotClip = false;
  a.on('message', (raw) => { if (JSON.parse(raw.toString()).type === 'clip') aGotClipBack = true; });
  c.on('message', (raw) => { if (JSON.parse(raw.toString()).type === 'clip') cGotClip = true; });

  const received = collectClips(b, 1);
  a.send(JSON.stringify({ type: 'clip', mid: 'mid-1', sid: 'sender-a', data: sealed }));
  const [relayed] = await received;
  const decrypted = await kc.decryptJSON(key, relayed.data);
  assert.strictEqual(decrypted.text, payload.text);
  assert.strictEqual(relayed.mid, 'mid-1', 'mid must survive the relay');
  assert.strictEqual(relayed.sid, 'sender-a', 'sid must survive the relay');
  console.log('✓ relay delivers encrypted clips to room members');

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.strictEqual(cGotClip, false, 'clip must not leak across rooms');
  assert.strictEqual(aGotClipBack, false, 'clip must not echo back to the sender');
  console.log('✓ room isolation and no sender echo');

  // 6. Chunked transfer metadata survives the relay
  const chunks = await Promise.all(
    [0, 1, 2].map((seq) => kc.encryptBytes(key, blob.subarray(seq * 64 * 1024, (seq + 1) * 64 * 1024))),
  );
  const chunksReceived = collectClips(b, 3);
  chunks.forEach((data, seq) => {
    a.send(JSON.stringify({
      type: 'clip',
      mid: `mid-chunk-${seq}`,
      sid: 'sender-a',
      data: { ...data, fid: 'file-1', seq, tot: 3 },
    }));
  });
  const relayedChunks = await chunksReceived;
  const reassembled = Buffer.concat(
    await Promise.all(
      relayedChunks
        .sort((x, y) => x.data.seq - y.data.seq)
        .map((msg) => kc.decryptBytes(key, msg.data)),
    ),
  );
  assert.deepStrictEqual(new Uint8Array(reassembled.subarray(0, 192 * 1024)), blob.subarray(0, 192 * 1024));
  assert.ok(relayedChunks.every((msg) => msg.data.fid === 'file-1' && msg.data.tot === 3));
  console.log('✓ chunked transfers reassemble after the relay');

  // 7. Store-and-forward: a late joiner catches up on buffered ciphertext
  const d = await connect(port);
  const replayed = collectClips(d, 4); // 1 clip + 3 chunks were buffered above
  d.send(JSON.stringify({ type: 'join', roomId }));
  await nextMessage(d, 'joined');
  const replayedMsgs = await replayed;
  assert.ok(replayedMsgs.some((msg) => msg.mid === 'mid-1'), 'replayed packets keep their mid');
  assert.strictEqual((await kc.decryptJSON(key, replayedMsgs.find((m) => m.mid === 'mid-1').data)).text, payload.text);
  console.log('✓ store-and-forward replays buffered ciphertext to late joiners');

  for (const ws of [a, b, c, d]) ws.terminate();
  await relay.close();
  console.log('\nAll e2e checks passed.');
  process.exit(0);
})().catch((err) => {
  console.error('✗ e2e failed:', err);
  process.exit(1);
});
