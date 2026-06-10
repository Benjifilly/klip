'use strict';

/**
 * Klip — Electron main process.
 *
 * Everything sensitive happens here: clipboard polling, encryption/decryption
 * (see crypto.cjs) and the WebSocket link to the relay. The renderer is a pure
 * UI layer that talks to this process over a narrow, typed IPC surface
 * (see preload.cjs) — it never touches the network or the session key.
 *
 * At-rest security: settings, history and image blobs are encrypted with
 * Electron's safeStorage (DPAPI on Windows) before touching the disk, with a
 * transparent plaintext fallback/migration when OS encryption is unavailable.
 */

const {
  app, BrowserWindow, Tray, Menu, clipboard, ipcMain, nativeImage,
  globalShortcut, shell, safeStorage, screen, dialog, Notification,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const {
  deriveSessionKey,
  deriveRoomId,
  deriveFingerprint,
  encryptJSON,
  decryptJSON,
  encryptBytes,
  decryptBytes,
  generateSessionCode,
  formatSessionCode,
} = require('./crypto.cjs');
const { sanitizeFileName, isAllowedRelayUrl, PASTE_HELPER_SCRIPT } = require('./util.cjs');

const POLL_INTERVAL_MS = 700;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // PNG size cap for sync
const MAX_FILE_BYTES = 20 * 1024 * 1024; // hard cap — base64 + chunking stays within the relay's limits
const MAX_HISTORY = 200;
const MAX_RECONNECT_DELAY_MS = 30_000;
// Plaintext bytes per encrypted chunk; ciphertext+base64+JSON stays well
// under the relay's 512 KB frame cap.
const CHUNK_BYTES = 256 * 1024;
const CHUNK_TRANSFER_TTL_MS = 120_000;
const PALETTE_SIZE = { width: 380, height: 380 };
// Ctrl+C on a multi-selection in Explorer: send at most this many files.
const MAX_CLIPBOARD_FILES = 3;
/** Format version stamped on every payload — bump on incompatible changes. */
const CLIP_FORMAT_VERSION = 1;
// A malicious peer must not be able to balloon our memory with chunked
// transfers that never complete: cap how many are in flight and their total size.
const MAX_INFLIGHT_TRANSFERS = 8;
const MAX_INFLIGHT_CHUNK_BYTES = 64 * 1024 * 1024;
const MAX_CHUNKS_PER_TRANSFER = 128; // mirrors the relay's cap
// Encrypted presence announcements drive the "connected devices" list.
const PRESENCE_INTERVAL_MS = 60_000;
const PRESENCE_TTL_MS = 150_000;

let win = null;
let paletteWin = null;
let tray = null;
let ws = null;
let sessionKey = null;
let roomId = null;
let fingerprint = [];
let reconnectTimer = null;
let reconnectDelay = 1_000;
let saveHistoryTimer = null;
let clipboardClearTimer = null;
let status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
let peerCount = 0;
let paused = false;
let lastClipboardText = '';
let lastImageHash = '';
let lastFilesSig = '';
let history = [];
let quitting = false;
let trayBalloonShown = false;
/** Rotation requested by another device, waiting for the user's go-ahead. */
let pendingRotation = null; // { code, deviceName }
/** Other devices seen in the session: installId -> { name, ts } */
const peers = new Map();
let presenceTimer = null;
/** Global shortcuts that failed to register (conflict with another app). */
let shortcutErrors = [];
let inflightChunkBytes = 0;

/** Message ids we already handled (or sent), so relay replays don't duplicate. */
const seenMids = new Set();
/** In-flight chunked transfers: fid -> { tot, parts: Map<seq, Uint8Array>, bytes, ts } */
const incomingChunks = new Map();

const startHidden = process.argv.includes('--hidden');

const settings = {
  serverUrl: 'ws://localhost:8787',
  sessionCode: '',
  deviceName: os.hostname(),
  installId: '', // opaque per-install id, lets us drop our own replayed packets
  clipboardClearSeconds: 0, // 0 = never auto-clear
  autoStart: false,
  autoCopy: 'all', // 'all' | 'text' | 'off' — what received clips may write to the clipboard
  notifyOnReceive: false,
  syncText: true,
  syncImages: true,
  syncFiles: true,
  shortcutToggle: 'CommandOrControl+Shift+K',
  shortcutPalette: 'CommandOrControl+Shift+V',
};

// --- Encrypted-at-rest storage ------------------------------------------------

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const historyPath = () => path.join(app.getPath('userData'), 'history.json');
const blobDir = () => path.join(app.getPath('userData'), 'blobs');
const legacyBlobDir = () => path.join(app.getPath('userData'), 'images');

const canEncryptAtRest = () => safeStorage.isEncryptionAvailable();
const BLOB_MAGIC = Buffer.from('KLE1'); // marks safeStorage-encrypted blobs

function saveSecureJson(file, value) {
  try {
    const json = JSON.stringify(value);
    fs.writeFileSync(file, canEncryptAtRest() ? safeStorage.encryptString(json) : json);
  } catch {
    // Persistence is best-effort; sync keeps working without it.
  }
}

function loadSecureJson(file, fallback) {
  try {
    const buf = fs.readFileSync(file);
    const first = buf.length ? String.fromCharCode(buf[0]) : '';
    // Legacy plaintext files start with '{' or '['; encrypted blobs don't.
    const json = first === '{' || first === '[' ? buf.toString('utf8') : safeStorage.decryptString(buf);
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/** Encrypted blob store for image and file payloads. */
function saveBlob(id, buf) {
  try {
    fs.mkdirSync(blobDir(), { recursive: true });
    const data = canEncryptAtRest() ? Buffer.concat([BLOB_MAGIC, safeStorage.encryptBuffer(buf)]) : buf;
    fs.writeFileSync(path.join(blobDir(), `${id}.bin`), data);
  } catch { /* best-effort */ }
}

function loadBlob(id) {
  for (const dir of [blobDir(), legacyBlobDir()]) {
    try {
      const data = fs.readFileSync(path.join(dir, `${id}.bin`));
      if (data.length > 4 && data.subarray(0, 4).equals(BLOB_MAGIC)) {
        return safeStorage.decryptBuffer(data.subarray(4));
      }
      // Legacy blobs: encrypted without the magic prefix, or plaintext fallback.
      try { return safeStorage.decryptBuffer(data); } catch { return data; }
    } catch { /* try the next location */ }
  }
  return null;
}

function deleteEntryArtifacts(entry) {
  if (entry.type !== 'image' && entry.type !== 'file') return;
  for (const dir of [blobDir(), legacyBlobDir()]) {
    try { fs.unlinkSync(path.join(dir, `${entry.id}.bin`)); } catch { /* already gone */ }
  }
}

// --- State --------------------------------------------------------------------

function devicesList() {
  const now = Date.now();
  const others = [...peers.entries()]
    .map(([id, peer]) => ({
      id,
      name: peer.name,
      lastSeen: peer.ts,
      // "Online" = heard from it within one announce period (plus margin).
      online: now - peer.ts < PRESENCE_INTERVAL_MS + 30_000,
      self: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [
    {
      id: settings.installId,
      name: settings.deviceName,
      lastSeen: now,
      online: status === 'connected' && !paused,
      self: true,
    },
    ...others,
  ];
}

function getState() {
  return {
    status,
    peerCount,
    paused,
    sessionCode: settings.sessionCode,
    fingerprint,
    serverUrl: settings.serverUrl,
    deviceName: settings.deviceName,
    clipboardClearSeconds: settings.clipboardClearSeconds,
    autoStart: settings.autoStart,
    autoCopy: settings.autoCopy,
    notifyOnReceive: settings.notifyOnReceive,
    syncText: settings.syncText,
    syncImages: settings.syncImages,
    syncFiles: settings.syncFiles,
    shortcuts: { toggle: settings.shortcutToggle, palette: settings.shortcutPalette },
    shortcutErrors,
    atRestEncrypted: canEncryptAtRest(),
    pendingRotation,
    devices: devicesList(),
    history,
  };
}

function broadcastState() {
  const state = getState();
  for (const target of [win, paletteWin]) {
    if (target && !target.isDestroyed()) target.webContents.send('klip:state', state);
  }
  if (tray) {
    const trayState = paused ? 'paused' : status;
    const session = settings.sessionCode ? ` · ${peerCount} device${peerCount > 1 ? 's' : ''}` : '';
    tray.setToolTip(`Klip — ${trayState}${session}`);
    rebuildTrayMenu();
  }
}

function addHistory(entry) {
  history.unshift({ id: globalThis.crypto.randomUUID(), ts: Date.now(), pinned: false, ...entry });
  if (history.length > MAX_HISTORY) {
    // Evict oldest unpinned entries first.
    for (let i = history.length - 1; i >= 0 && history.length > MAX_HISTORY; i--) {
      if (!history[i].pinned) deleteEntryArtifacts(history.splice(i, 1)[0]);
    }
    while (history.length > MAX_HISTORY) deleteEntryArtifacts(history.pop());
  }
  clearTimeout(saveHistoryTimer);
  saveHistoryTimer = setTimeout(() => saveSecureJson(historyPath(), history), 1_000);
  broadcastState();
}

function addImageHistory(png, image, meta) {
  const id = globalThis.crypto.randomUUID();
  saveBlob(id, png);
  addHistory({
    id,
    type: 'image',
    thumb: image.resize({ height: 80 }).toDataURL(),
    bytes: png.length,
    ...meta,
  });
}

function addFileHistory(name, buf, meta) {
  const id = globalThis.crypto.randomUUID();
  saveBlob(id, buf);
  addHistory({ id, type: 'file', name, bytes: buf.length, ...meta });
}

function rememberMid(mid) {
  if (!mid || typeof mid !== 'string') return false; // nothing to dedupe on
  if (seenMids.has(mid)) return true;
  seenMids.add(mid);
  if (seenMids.size > 1_000) {
    for (const value of seenMids) {
      seenMids.delete(value);
      if (seenMids.size <= 500) break;
    }
  }
  return false;
}

// --- Relay connection ----------------------------------------------------------

function disconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) {
    ws.removeAllListeners();
    try { ws.close(); } catch { /* already closed */ }
    ws = null;
  }
}

function scheduleReconnect() {
  if (quitting || !settings.sessionCode || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
}

function connect() {
  if (!settings.sessionCode || !sessionKey || !roomId) return;
  disconnect();
  status = 'connecting';
  peerCount = 0;
  broadcastState();

  ws = new WebSocket(settings.serverUrl);
  ws.on('open', () => {
    reconnectDelay = 1_000;
    ws.send(JSON.stringify({ type: 'join', roomId }));
  });
  ws.on('message', (raw) => {
    onRelayMessage(raw).catch(() => { /* malformed packet — ignore */ });
  });
  ws.on('close', () => {
    status = 'disconnected';
    peerCount = 0;
    broadcastState();
    scheduleReconnect();
  });
  ws.on('error', () => { /* 'close' follows and drives the retry */ });
}

async function onRelayMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString('utf8'));
  } catch {
    return;
  }

  switch (msg.type) {
    case 'hello':
      // Relay greeting with its protocol version — nothing to do at v1.
      break;

    case 'joined':
      status = 'connected';
      broadcastState();
      announcePresence(true).catch(() => {});
      break;

    case 'peers':
      peerCount = Number(msg.count) || 0;
      prunePeers();
      broadcastState();
      break;

    case 'clip': {
      if (paused || !sessionKey || !msg.data) return;
      if (msg.sid && msg.sid === settings.installId) return; // our own packet, replayed
      if (rememberMid(msg.mid)) return; // already handled
      if (msg.data.fid !== undefined) return onChunk(msg.data);
      let item;
      try {
        item = await decryptJSON(sessionKey, msg.data);
      } catch {
        return; // wrong key or tampered packet — GCM auth failed
      }
      await applyIncoming(item);
      break;
    }

    default:
      break;
  }
}

function dropTransfer(fid) {
  const transfer = incomingChunks.get(fid);
  if (!transfer) return;
  inflightChunkBytes -= transfer.bytes;
  incomingChunks.delete(fid);
}

async function onChunk(data) {
  // Validate chunk metadata before paying for decryption.
  if (
    typeof data.fid !== 'string' || data.fid.length > 64 ||
    !Number.isInteger(data.seq) || !Number.isInteger(data.tot) ||
    data.seq < 0 || data.tot < 1 || data.tot > MAX_CHUNKS_PER_TRANSFER || data.seq >= data.tot
  ) {
    return;
  }
  let bytes;
  try {
    bytes = await decryptBytes(sessionKey, data);
  } catch {
    return;
  }
  let transfer = incomingChunks.get(data.fid);
  if (!transfer) {
    // A flood of never-completing transfers must not balloon our memory.
    if (incomingChunks.size >= MAX_INFLIGHT_TRANSFERS) return;
    transfer = { tot: data.tot, parts: new Map(), bytes: 0, ts: Date.now() };
    incomingChunks.set(data.fid, transfer);
  }
  if (data.tot !== transfer.tot || transfer.parts.has(data.seq)) return;
  transfer.parts.set(data.seq, bytes);
  transfer.bytes += bytes.length;
  inflightChunkBytes += bytes.length;
  if (inflightChunkBytes > MAX_INFLIGHT_CHUNK_BYTES) {
    dropTransfer(data.fid);
    return;
  }
  if (transfer.parts.size < transfer.tot) return;

  dropTransfer(data.fid);
  const ordered = [];
  for (let seq = 0; seq < transfer.tot; seq++) {
    const part = transfer.parts.get(seq);
    if (!part) return;
    ordered.push(part);
  }
  let item;
  try {
    item = JSON.parse(Buffer.concat(ordered).toString('utf8'));
  } catch {
    return;
  }
  await applyIncoming(item);
}

function notifyUser(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body, silent: true });
    notification.on('click', showWindow);
    notification.show();
  } catch { /* notifications are best-effort */ }
}

function notifyReceived(deviceName, what) {
  if (!settings.notifyOnReceive) return;
  // Never put clip content in a system notification — only its type.
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return;
  notifyUser('Klip', `${deviceName} sent ${what}.`);
}

async function applyIncoming(item) {
  if (!item || typeof item !== 'object') return;
  // Packets from a future, incompatible client version are skipped whole.
  if (Number.isInteger(item.v) && item.v > CLIP_FORMAT_VERSION) return;
  const deviceName = String(item.deviceName || 'Unknown device').slice(0, 64);

  if (item.kind === 'presence') {
    const id = String(item.id ?? '').slice(0, 64);
    if (!id || id === settings.installId) return;
    if (item.bye) {
      // Graceful goodbye — drop the device immediately instead of waiting
      // for its presence entry to expire.
      if (peers.delete(id)) broadcastState();
      return;
    }
    const previous = peers.get(id);
    peers.set(id, { name: deviceName, ts: Date.now() });
    // A newcomer says hello; answer so it learns we exist too.
    if (item.hello) announcePresence(false).catch(() => {});
    if (!previous || previous.name !== deviceName) broadcastState();
    return;
  }

  if (item.kind === 'rotate') {
    const code = formatSessionCode(item.code);
    if (!code || code === settings.sessionCode) return;
    // Never follow silently: anyone holding the code could otherwise move
    // every device to a session they control without a trace.
    pendingRotation = { code, deviceName };
    notifyUser('Klip — session rotated', `${deviceName} rotated the session code. Open Klip to switch.`);
    broadcastState();
    return;
  }

  if (item.kind === 'image') {
    if (typeof item.png !== 'string') return;
    const png = Buffer.from(item.png, 'base64');
    if (!png.length || png.length > MAX_IMAGE_BYTES) return;
    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) return;
    if (settings.autoCopy === 'all') setClipboardImageSilently(image, png);
    addImageHistory(png, image, { deviceName, direction: 'received' });
    notifyReceived(deviceName, 'an image');
    return;
  }

  if (item.kind === 'file') {
    if (typeof item.data !== 'string') return;
    const buf = Buffer.from(item.data, 'base64');
    if (!buf.length || buf.length > MAX_FILE_BYTES) return;
    // Never written to disk in plaintext, never executed, never auto-opened:
    // the file sits encrypted in the blob store until the user clicks "Save".
    addFileHistory(sanitizeFileName(item.name), buf, { deviceName, direction: 'received' });
    notifyReceived(deviceName, 'a file');
    return;
  }

  // 'text', or legacy packets without a kind field.
  if (typeof item.text !== 'string' || !item.text) return;
  if (settings.autoCopy !== 'off') setClipboardSilently(item.text);
  addHistory({ type: 'text', text: item.text, deviceName, direction: 'received' });
  notifyReceived(deviceName, 'a clip');
}

// --- Presence -------------------------------------------------------------------

/**
 * Encrypted presence announcements: each device periodically broadcasts its
 * name so the UI can show *which* devices are connected, not just how many.
 * The relay only ever sees ciphertext, like every other packet.
 * `bye` is a graceful goodbye sent when leaving a session.
 */
async function announcePresence(hello, bye = false) {
  if (!sessionKey) return;
  await sendEncrypted({
    kind: 'presence',
    id: settings.installId,
    name: settings.deviceName,
    hello: Boolean(hello),
    bye: Boolean(bye),
    ts: Date.now(),
  });
}

function prunePeers() {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  let changed = false;
  for (const [id, peer] of peers) {
    if (peer.ts < cutoff) {
      peers.delete(id);
      changed = true;
    }
  }
  return changed;
}

function startPresenceLoop() {
  clearInterval(presenceTimer);
  presenceTimer = setInterval(() => {
    if (status === 'connected' && !paused) announcePresence(false).catch(() => {});
    if (prunePeers()) broadcastState();
  }, PRESENCE_INTERVAL_MS);
}

/** Encrypt a payload and send it, chunking transparently when it's large. */
async function sendEncrypted(payload) {
  if (!sessionKey || !ws || ws.readyState !== WebSocket.OPEN) return;
  const versioned = { v: CLIP_FORMAT_VERSION, ...payload };
  const mid = globalThis.crypto.randomUUID();
  const bytes = Buffer.from(JSON.stringify(versioned), 'utf8');

  if (bytes.length <= CHUNK_BYTES) {
    rememberMid(mid);
    const data = await encryptJSON(sessionKey, versioned);
    ws.send(JSON.stringify({ type: 'clip', v: CLIP_FORMAT_VERSION, mid, sid: settings.installId, data }));
    return;
  }

  const tot = Math.ceil(bytes.length / CHUNK_BYTES);
  const fid = globalThis.crypto.randomUUID();
  for (let seq = 0; seq < tot; seq++) {
    const slice = bytes.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES);
    const data = await encryptBytes(sessionKey, slice);
    const chunkMid = `${mid}:${seq}`;
    rememberMid(chunkMid);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'clip', v: CLIP_FORMAT_VERSION, mid: chunkMid, sid: settings.installId, data: { ...data, fid, seq, tot } }));
  }
}

// --- Clipboard ------------------------------------------------------------------

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

/**
 * Password managers (KeePass, Bitwarden, 1Password…) tag their copies with
 * Windows clipboard formats that ask monitoring tools to look away. Honor
 * them: a copied password must never enter the history or leave the machine.
 * The presence of the exclusion format is the signal; the history/cloud flags
 * are a DWORD where 0 means "opt out".
 */
function clipboardMarkedSensitive() {
  if (process.platform !== 'win32') return false;
  try {
    if (clipboard.has('ExcludeClipboardContentFromMonitorProcessing')) return true;
    for (const format of ['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard']) {
      if (!clipboard.has(format)) continue;
      const flag = clipboard.readBuffer(format);
      if (flag.length >= 4 && flag.readUInt32LE(0) === 0) return true;
    }
  } catch { /* unreadable flag — treat as not sensitive */ }
  return false;
}

/**
 * Files copied in Explorer (Ctrl+C) land on the clipboard as CF_HDROP:
 * a 20-byte DROPFILES header (path-list offset at byte 0, Unicode flag at
 * byte 16) followed by a double-null-terminated UTF-16LE list of paths.
 */
function readClipboardFilePaths() {
  if (process.platform !== 'win32') return [];
  let buf;
  try {
    buf = clipboard.readBuffer('CF_HDROP');
  } catch {
    buf = null;
  }
  if (buf && buf.length >= 20) {
    const pFiles = buf.readUInt32LE(0);
    // ANSI path lists (fWide=0) don't occur on modern Windows.
    if (buf.readUInt32LE(16) !== 0 && pFiles < buf.length) {
      const paths = [];
      let off = pFiles;
      while (off + 1 < buf.length) {
        let end = off;
        while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2;
        if (end === off) break; // double null — end of the list
        paths.push(buf.toString('utf16le', off, end));
        off = end + 2;
      }
      if (paths.length) return paths;
    }
  }
  // Some apps (browsers included) publish a single path as FileNameW instead.
  try {
    const single = clipboard.readBuffer('FileNameW');
    if (single && single.length >= 4) {
      let end = 0;
      while (end + 1 < single.length && single.readUInt16LE(end) !== 0) end += 2;
      const p = single.toString('utf16le', 0, end);
      if (p && /^[a-zA-Z]:[\\/]|^\\\\/.test(p)) return [p];
    }
  } catch { /* format absent */ }
  return [];
}

// --- Paste injection ---------------------------------------------------------

let pasteHelper = null;
let helperStdoutBuffer = '';
let pendingForegroundResolve = null;
/** Window that had focus right before the palette opened (decimal HWND). */
let lastForegroundHwnd = '0';

/**
 * Persistent helper for focus + paste (script in util.cjs). Hiding a
 * frameless always-on-top window does NOT reliably hand focus back to the
 * previous app on Windows, so we capture the foreground HWND *before* the
 * palette opens (`get`) and have the helper explicitly re-activate it before
 * pasting (`paste <hwnd>`) or on dismiss (`focus <hwnd>`).
 * Spawned once and kept alive so a paste from the palette is instant — no
 * PowerShell cold start on the hot path.
 */
function ensurePasteHelper() {
  if (process.platform !== 'win32') return null;
  if (pasteHelper && pasteHelper.exitCode === null) return pasteHelper;
  helperStdoutBuffer = '';
  pasteHelper = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', PASTE_HELPER_SCRIPT,
  ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  pasteHelper.stdout.on('data', (chunk) => {
    helperStdoutBuffer += chunk.toString('utf8');
    let nl;
    while ((nl = helperStdoutBuffer.indexOf('\n')) !== -1) {
      const line = helperStdoutBuffer.slice(0, nl).trim();
      helperStdoutBuffer = helperStdoutBuffer.slice(nl + 1);
      if (pendingForegroundResolve) {
        pendingForegroundResolve(line);
        pendingForegroundResolve = null;
      }
    }
  });
  pasteHelper.on('error', () => { pasteHelper = null; });
  return pasteHelper;
}

function helperWrite(command) {
  const helper = ensurePasteHelper();
  if (!helper) return false;
  try {
    helper.stdin.write(`${command}\n`);
    return true;
  } catch {
    pasteHelper = null; // helper died — the next call respawns it
    return false;
  }
}

/** Ask the helper which window is foreground right now ('0' if unknown). */
function captureForegroundWindow() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingForegroundResolve = null;
      resolve('0');
    }, 250);
    pendingForegroundResolve = (line) => {
      clearTimeout(timer);
      resolve(/^\d+$/.test(line) ? line : '0');
    };
    if (!helperWrite('get')) {
      clearTimeout(timer);
      pendingForegroundResolve = null;
      resolve('0');
    }
  });
}

/**
 * Opt-in hygiene: wipe the clipboard N seconds after Klip touched it (or saw a
 * local copy), unless something else was copied since.
 */
function scheduleClipboardClear(stillCurrent) {
  clearTimeout(clipboardClearTimer);
  const seconds = Number(settings.clipboardClearSeconds) || 0;
  if (seconds <= 0) return;
  clipboardClearTimer = setTimeout(() => {
    try {
      if (stillCurrent()) {
        clipboard.clear();
        lastClipboardText = '';
        lastImageHash = '';
      }
    } catch { /* clipboard busy — skip */ }
  }, seconds * 1_000);
}

/** Write text to the clipboard without the watcher re-broadcasting it. */
function setClipboardSilently(text) {
  lastClipboardText = text;
  clipboard.writeText(text);
  scheduleClipboardClear(() => clipboard.readText() === text);
}

/** Write an image to the clipboard without the watcher re-broadcasting it. */
function setClipboardImageSilently(image, png) {
  const hash = sha1(png);
  lastImageHash = hash;
  clipboard.writeImage(image);
  scheduleClipboardClear(() => {
    const current = clipboard.readImage();
    return !current.isEmpty() && sha1(current.toPNG()) === hash;
  });
}

async function onLocalCopy(text) {
  addHistory({ type: 'text', text, deviceName: settings.deviceName, direction: 'sent' });
  scheduleClipboardClear(() => clipboard.readText() === text);
  await sendEncrypted({ kind: 'text', text, deviceName: settings.deviceName, ts: Date.now() });
}

async function onLocalImageCopy(png, image) {
  addImageHistory(png, image, { deviceName: settings.deviceName, direction: 'sent' });
  scheduleClipboardClear(() => {
    const current = clipboard.readImage();
    return !current.isEmpty() && sha1(current.toPNG()) === sha1(png);
  });
  await sendEncrypted({ kind: 'image', png: png.toString('base64'), deviceName: settings.deviceName, ts: Date.now() });
}

function startClipboardWatcher() {
  lastClipboardText = clipboard.readText();
  lastFilesSig = readClipboardFilePaths().join('\n');
  setInterval(() => {
    if (paused) return;

    // A copy tagged by a password manager is swallowed whole: remember it so
    // it never syncs, not even after the next poll, and capture nothing.
    const sensitive = clipboardMarkedSensitive();

    // Files first: Explorer AND browsers put a file list on the clipboard
    // alongside a text fallback (a path or URL) — when a file list exists,
    // the file is what the user copied, so the text must not win.
    const files = readClipboardFilePaths();
    if (files.length) {
      const sig = files.join('\n');
      if (sig === lastFilesSig) return;
      lastFilesSig = sig;
      // Swallow the text/image fallbacks of this same copy so the next poll
      // doesn't sync them as separate clips.
      lastClipboardText = clipboard.readText();
      const fallbackImage = clipboard.readImage();
      lastImageHash = fallbackImage.isEmpty() ? '' : sha1(fallbackImage.toPNG());
      if (sensitive || !settings.syncFiles) return;
      for (const file of files.slice(0, MAX_CLIPBOARD_FILES)) {
        sendFileFromPath(file).catch(() => { /* folder or oversized — skip */ });
      }
      return;
    }

    // Then text: apps like Excel expose cells as both text and image, and
    // the text representation is what users expect to sync.
    const text = clipboard.readText();
    if (text) {
      if (text === lastClipboardText) return;
      lastClipboardText = text;
      if (sensitive || !settings.syncText) return;
      if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) return;
      onLocalCopy(text).catch(() => {});
      return;
    }

    if (clipboard.availableFormats().some((format) => format.startsWith('image/'))) {
      const image = clipboard.readImage();
      if (image.isEmpty()) return;
      const png = image.toPNG();
      const hash = sha1(png);
      if (hash === lastImageHash) return;
      lastImageHash = hash;
      if (sensitive || !settings.syncImages) return;
      if (png.length > MAX_IMAGE_BYTES) return;
      onLocalImageCopy(png, image).catch(() => {});
    }
  }, POLL_INTERVAL_MS);

  // Drop chunked transfers that never completed (sender vanished mid-image).
  setInterval(() => {
    const cutoff = Date.now() - CHUNK_TRANSFER_TTL_MS;
    for (const [fid, transfer] of incomingChunks) {
      if (transfer.ts < cutoff) dropTransfer(fid);
    }
  }, 30_000);
}

function setPaused(value) {
  paused = Boolean(value);
  // Swallow whatever was copied while paused so resuming doesn't broadcast it.
  if (!paused) {
    lastClipboardText = clipboard.readText();
    lastFilesSig = readClipboardFilePaths().join('\n');
    const image = clipboard.readImage();
    lastImageHash = image.isEmpty() ? '' : sha1(image.toPNG());
  }
  broadcastState();
}

// --- Session --------------------------------------------------------------------

async function joinSession(rawCode) {
  // Only machine-generated codes are accepted: the roomId is a plain hash of
  // the code, so a weak human-chosen code could be enumerated offline.
  const code = formatSessionCode(rawCode);
  if (!code) {
    throw new Error('Invalid code — Klip codes look like xxxx-xxxx-xxxx-xxxx.');
  }
  sessionKey = await deriveSessionKey(code);
  roomId = await deriveRoomId(code);
  fingerprint = await deriveFingerprint(code);
  settings.sessionCode = code;
  pendingRotation = null;
  peers.clear();
  saveSecureJson(settingsPath(), settings);
  reconnectDelay = 1_000;
  connect();
}

async function leaveSession() {
  // Best-effort goodbye so the other devices drop us from their list now
  // instead of when our presence entry expires.
  try { await announcePresence(false, true); } catch { /* socket already down */ }
  disconnect();
  sessionKey = null;
  roomId = null;
  fingerprint = [];
  settings.sessionCode = '';
  pendingRotation = null;
  peers.clear();
  saveSecureJson(settingsPath(), settings);
  status = 'disconnected';
  peerCount = 0;
  broadcastState();
}

/**
 * One-click key rotation: push the fresh code to current peers under the old
 * key (the relay's replay buffer covers recently-offline devices), then switch.
 */
async function rotateSession() {
  if (!settings.sessionCode || !sessionKey) throw new Error('No active session.');
  const fresh = generateSessionCode();
  await sendEncrypted({ kind: 'rotate', code: fresh, deviceName: settings.deviceName, ts: Date.now() });
  await joinSession(fresh);
  return fresh;
}

// --- Windows, palette & tray ------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 400,
    minHeight: 520,
    show: !startHidden,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    // The renderer draws the entire titlebar, window controls included.
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    win.loadURL('http://127.0.0.1:5173');
  }

  const sendWindowState = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('klip:window-state', { maximized: win.isMaximized() });
    }
  };
  win.on('maximize', sendWindowState);
  win.on('unmaximize', sendWindowState);

  // Closing the window minimizes to the tray; sync keeps running.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
    if (!trayBalloonShown && tray && process.platform === 'win32') {
      trayBalloonShown = true;
      tray.displayBalloon({
        icon: path.join(__dirname, '..', 'assets', 'icon.png'),
        title: 'Klip is still running',
        content: 'Clipboard sync stays active in the tray. Press Ctrl+Shift+K to reopen the window.',
      });
    }
  });
}

function createPaletteWindow() {
  paletteWin = new BrowserWindow({
    ...PALETTE_SIZE,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    paletteWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'palette' });
  } else {
    paletteWin.loadURL('http://127.0.0.1:5173/#palette');
  }

  paletteWin.on('blur', () => { if (paletteWin && !paletteWin.isDestroyed()) paletteWin.hide(); });
  paletteWin.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    paletteWin.hide();
  });
}

async function togglePalette() {
  if (!paletteWin || paletteWin.isDestroyed()) createPaletteWindow();
  if (paletteWin.isVisible()) {
    paletteWin.hide();
    return;
  }
  // Capture who has focus NOW — once the palette shows it's too late, and
  // Windows won't reliably give focus back when a frameless window hides.
  lastForegroundHwnd = await captureForegroundWindow();
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const x = Math.round(Math.min(Math.max(cursor.x - PALETTE_SIZE.width / 2, area.x), area.x + area.width - PALETTE_SIZE.width));
  const y = Math.round(Math.min(Math.max(cursor.y - 24, area.y), area.y + area.height - PALETTE_SIZE.height));
  paletteWin.setPosition(x, y);
  paletteWin.webContents.send('klip:state', getState());
  paletteWin.show();
  paletteWin.focus();
  // Frameless transparent windows don't reliably hand keyboard focus to the
  // page on show — force it before asking the renderer to focus the input.
  paletteWin.webContents.focus();
  paletteWin.webContents.send('klip:palette-open');
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  else {
    win.show();
    win.focus();
  }
}

function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

/** Windows menus treat `&` as a mnemonic; flatten + escape + truncate clip text. */
function trayClipLabel(entry) {
  if (entry.type === 'image') return `Image — ${entry.deviceName}`;
  if (entry.type === 'file') return `File — ${String(entry.name ?? 'file').replace(/&/g, '&&').slice(0, 40)}`;
  const flat = String(entry.text ?? '').replace(/\s+/g, ' ').trim().replace(/&/g, '&&');
  return flat.length > 45 ? `${flat.slice(0, 45)}…` : flat || '(empty)';
}

function rebuildTrayMenu() {
  if (!tray) return;
  const statusLabel = !settings.sessionCode
    ? 'No session'
    : paused
      ? 'Paused'
      : `${status[0].toUpperCase()}${status.slice(1)}${peerCount > 1 ? ` · ${peerCount} devices` : ''}`;
  const recent = history.slice(0, 5).map((entry) => ({
    label: trayClipLabel(entry),
    click: () => { if (entry.type === 'file') showWindow(); else copyEntry(entry.id); },
  }));

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: 'Open Klip', accelerator: settings.shortcutToggle, click: showWindow },
    { label: 'Quick paste', accelerator: settings.shortcutPalette, click: togglePalette },
    { label: 'Recent clips', enabled: recent.length > 0, submenu: recent },
    { label: 'Pause sync', type: 'checkbox', checked: paused, click: (item) => setPaused(item.checked) },
    { type: 'separator' },
    { label: 'Quit Klip', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  if (icon.isEmpty()) {
    // Fall back to the app icon so the tray entry is never invisible.
    icon = nativeImage
      .createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'))
      .resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  tray.setToolTip('Klip');
  rebuildTrayMenu();
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

// --- History actions ----------------------------------------------------------------

/** Put a history entry (text or image) back into the clipboard. */
function copyEntry(id) {
  const entry = history.find((item) => item.id === id);
  if (!entry) return { ok: false, error: 'Item not found.' };
  if (entry.type === 'file') {
    return { ok: false, error: 'Files cannot be copied — use Save.' };
  }
  if (entry.type === 'image') {
    const png = loadBlob(entry.id);
    if (!png) return { ok: false, error: 'Image data is missing.' };
    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) return { ok: false, error: 'Image data is corrupted.' };
    setClipboardImageSilently(image, png);
    return { ok: true };
  }
  if (typeof entry.text === 'string' && entry.text) setClipboardSilently(entry.text);
  return { ok: true };
}

/**
 * Palette flow: copy the entry, hide the palette, then have the helper
 * re-activate the window that was focused before the palette opened and
 * synthesize Ctrl+V there — we never rely on Windows restoring focus itself.
 */
function pasteEntry(id) {
  const result = copyEntry(id);
  if (!result.ok) return result;
  if (paletteWin && !paletteWin.isDestroyed()) paletteWin.hide();
  // A short beat for the hide to land, then the helper does focus + Ctrl+V.
  setTimeout(() => helperWrite(`paste ${lastForegroundHwnd}`), 80);
  return { ok: true };
}

async function sendFileFromPath(filePath) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) throw new Error('Not a regular file.');
  if (stats.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large — the limit is ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`);
  }
  const buf = fs.readFileSync(filePath);
  const name = sanitizeFileName(path.basename(filePath));
  addFileHistory(name, buf, { deviceName: settings.deviceName, direction: 'sent' });
  await sendEncrypted({ kind: 'file', name, data: buf.toString('base64'), deviceName: settings.deviceName, ts: Date.now() });
}

// --- Global shortcuts -------------------------------------------------------------

const ACCEL_MODIFIERS = new Set([
  'CommandOrControl', 'CmdOrCtrl', 'Ctrl', 'Control', 'Alt', 'AltGr', 'Shift', 'Super', 'Meta',
]);

/** Accelerator shape check: at least one modifier + one plain key. */
function isValidAccelerator(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  const parts = value.split('+');
  if (parts.length < 2) return false;
  const key = parts.pop();
  if (!parts.every((part) => ACCEL_MODIFIERS.has(part))) return false;
  return /^([A-Za-z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/.test(key);
}

/** (Re)register the two global shortcuts, surfacing conflicts instead of failing silently. */
function registerShortcuts() {
  globalShortcut.unregisterAll();
  shortcutErrors = [];
  const bind = (accelerator, handler, label) => {
    try {
      if (globalShortcut.register(accelerator, handler)) return;
    } catch { /* malformed accelerator — falls through to the error below */ }
    shortcutErrors.push(`${label} (${accelerator.replace('CommandOrControl', 'Ctrl')}) could not be registered — another app may already use it.`);
  };
  bind(settings.shortcutToggle, toggleWindow, 'Show/hide Klip');
  bind(settings.shortcutPalette, togglePalette, 'Quick paste');
}

// --- Deep link (klip://join) --------------------------------------------------------

function extractDeepLink(argv) {
  return argv.find((arg) => typeof arg === 'string' && arg.startsWith('klip://'));
}

/**
 * klip://join?code=…&relay=… — pairing in one click (QR codes already emit
 * this URI). Joining is gated on an explicit confirmation: any webpage can
 * trigger a protocol launch, and silently joining an attacker's session would
 * hand them everything the user copies from then on.
 */
async function handleDeepLink(url) {
  if (!url) return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  const action = (parsed.hostname || parsed.pathname.replace(/\//g, '')).toLowerCase();
  if (parsed.protocol !== 'klip:' || action !== 'join') return;
  const code = formatSessionCode(parsed.searchParams.get('code') ?? '');
  if (!code) return;
  const relay = (parsed.searchParams.get('relay') ?? '').trim();
  const useRelay = relay && /^wss?:\/\/.+/.test(relay) && isAllowedRelayUrl(relay) ? relay : '';

  showWindow();
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Join session', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Klip',
    message: 'Join this session?',
    detail: `Everything you copy will be shared with the devices on this session.\n\nCode: ${code}${useRelay ? `\nRelay: ${useRelay}` : ''}`,
  });
  if (response !== 0) return;
  if (useRelay) {
    settings.serverUrl = useRelay;
    saveSecureJson(settingsPath(), settings);
  }
  try {
    await joinSession(code);
  } catch { /* invalid code — ignore */ }
}

// --- IPC ------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('klip:get-state', () => getState());
  ipcMain.handle('klip:generate-code', () => generateSessionCode());

  ipcMain.handle('klip:join-session', async (_event, code) => {
    try {
      await joinSession(String(code ?? ''));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('klip:leave-session', async () => {
    await leaveSession();
    return { ok: true };
  });

  ipcMain.handle('klip:rotate-session', async () => {
    try {
      const code = await rotateSession();
      return { ok: true, code };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // User's verdict on a rotation initiated by another device.
  ipcMain.handle('klip:resolve-rotation', async (_event, accept) => {
    const rotation = pendingRotation;
    pendingRotation = null;
    if (!accept || !rotation) {
      broadcastState();
      return { ok: true };
    }
    try {
      await joinSession(rotation.code);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('klip:copy-item', (_event, text) => {
    if (typeof text === 'string' && text) setClipboardSilently(text);
    return { ok: true };
  });

  ipcMain.handle('klip:copy-entry', (_event, id) => copyEntry(String(id ?? '')));

  ipcMain.handle('klip:paste-entry', (_event, id) => pasteEntry(String(id ?? '')));

  ipcMain.handle('klip:send-file', async (_event, filePath) => {
    try {
      await sendFileFromPath(String(filePath ?? ''));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('klip:attach-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Send a file to your devices',
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { ok: true };
    try {
      await sendFileFromPath(filePaths[0]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('klip:save-file', async (_event, id) => {
    const entry = history.find((item) => item.id === id);
    if (!entry || entry.type !== 'file') return { ok: false, error: 'File not found.' };
    const data = loadBlob(entry.id);
    if (!data) return { ok: false, error: 'File data is missing.' };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: sanitizeFileName(entry.name),
    });
    if (canceled || !filePath) return { ok: true };
    try {
      fs.writeFileSync(filePath, data);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('klip:toggle-pin', (_event, id) => {
    const entry = history.find((item) => item.id === id);
    if (entry) {
      entry.pinned = !entry.pinned;
      saveSecureJson(historyPath(), history);
      broadcastState();
    }
    return { ok: true };
  });

  ipcMain.handle('klip:clear-history', () => {
    const kept = history.filter((entry) => entry.pinned);
    for (const entry of history) {
      if (!entry.pinned) deleteEntryArtifacts(entry);
    }
    history = kept;
    saveSecureJson(historyPath(), history);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('klip:delete-item', (_event, id) => {
    const entry = history.find((item) => item.id === id);
    if (entry) {
      deleteEntryArtifacts(entry);
      history = history.filter((item) => item.id !== id);
      saveSecureJson(historyPath(), history);
      broadcastState();
    }
    return { ok: true };
  });

  ipcMain.handle('klip:set-paused', (_event, value) => {
    setPaused(value);
    return { ok: true };
  });

  ipcMain.handle('klip:open-url', (_event, url) => {
    const value = String(url ?? '').trim();
    if (!/^https?:\/\/\S+$/.test(value)) return { ok: false, error: 'Not a valid http(s) URL.' };
    shell.openExternal(value);
    return { ok: true };
  });

  ipcMain.handle('klip:set-server-url', (_event, url) => {
    const value = String(url ?? '').trim();
    if (!/^wss?:\/\/.+/.test(value)) {
      return { ok: false, error: 'Server URL must start with ws:// or wss://' };
    }
    if (!isAllowedRelayUrl(value)) {
      return { ok: false, error: 'Plain ws:// is only allowed on localhost or your LAN — use wss:// for anything else.' };
    }
    settings.serverUrl = value;
    saveSecureJson(settingsPath(), settings);
    if (settings.sessionCode) {
      reconnectDelay = 1_000;
      connect();
    }
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('klip:set-device-name', (_event, name) => {
    const value = String(name ?? '').trim().slice(0, 64);
    if (value) {
      settings.deviceName = value;
      saveSecureJson(settingsPath(), settings);
      announcePresence(false).catch(() => {});
      broadcastState();
    }
    return { ok: true };
  });

  ipcMain.handle('klip:set-auto-copy', (_event, mode) => {
    if (!['all', 'text', 'off'].includes(mode)) return { ok: false, error: 'Invalid mode.' };
    settings.autoCopy = mode;
    saveSecureJson(settingsPath(), settings);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('klip:set-notify-on-receive', (_event, value) => {
    settings.notifyOnReceive = Boolean(value);
    saveSecureJson(settingsPath(), settings);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('klip:set-sync-kinds', (_event, kinds) => {
    if (!kinds || typeof kinds !== 'object') return { ok: false, error: 'Invalid value.' };
    settings.syncText = Boolean(kinds.text);
    settings.syncImages = Boolean(kinds.images);
    settings.syncFiles = Boolean(kinds.files);
    saveSecureJson(settingsPath(), settings);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('klip:set-shortcuts', (_event, shortcuts) => {
    const toggle = String(shortcuts?.toggle ?? '');
    const palette = String(shortcuts?.palette ?? '');
    if (!isValidAccelerator(toggle) || !isValidAccelerator(palette) || toggle === palette) {
      return { ok: false, error: 'Invalid shortcut — combine Ctrl/Alt/Shift with a key.' };
    }
    settings.shortcutToggle = toggle;
    settings.shortcutPalette = palette;
    saveSecureJson(settingsPath(), settings);
    registerShortcuts();
    broadcastState();
    return shortcutErrors.length ? { ok: false, error: shortcutErrors.join(' ') } : { ok: true };
  });

  ipcMain.handle('klip:set-clipboard-clear', (_event, seconds) => {
    const value = Math.min(Math.max(Math.floor(Number(seconds) || 0), 0), 600);
    settings.clipboardClearSeconds = value;
    saveSecureJson(settingsPath(), settings);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('klip:set-auto-start', (_event, value) => {
    settings.autoStart = Boolean(value);
    app.setLoginItemSettings({ openAtLogin: settings.autoStart, args: ['--hidden'] });
    saveSecureJson(settingsPath(), settings);
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('klip:palette-hide', () => {
    if (paletteWin && !paletteWin.isDestroyed() && paletteWin.isVisible()) {
      paletteWin.hide();
      // Esc / copy-only: hand focus back to the app the user came from.
      setTimeout(() => helperWrite(`focus ${lastForegroundHwnd}`), 60);
    }
    return { ok: true };
  });

  ipcMain.handle('klip:window-control', (_event, action) => {
    if (!win || win.isDestroyed()) return { ok: false };
    switch (action) {
      case 'minimize':
        win.minimize();
        break;
      case 'maximize':
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
        break;
      case 'close':
        win.close(); // hides to the tray, sync keeps running
        break;
      default:
        return { ok: false };
    }
    return { ok: true };
  });
}

// --- Bootstrap --------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('app.klip.desktop'); // taskbar/tray identity on Windows

  // klip://join deep links — pairing in one click (always behind a confirm dialog).
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('klip', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('klip');
  }

  app.on('second-instance', (_event, argv) => {
    showWindow();
    handleDeepLink(extractDeepLink(argv)).catch(() => {});
  });

  app.whenReady().then(async () => {
    Object.assign(settings, loadSecureJson(settingsPath(), {}));
    history = loadSecureJson(historyPath(), []);
    if (!Array.isArray(history)) history = [];
    // Migrate pre-v2 entries and re-save both files encrypted at rest.
    history = history.map((entry) => ({ type: 'text', pinned: false, ...entry }));
    if (!settings.installId) settings.installId = globalThis.crypto.randomUUID();
    saveSecureJson(settingsPath(), settings);
    saveSecureJson(historyPath(), history);

    registerIpc();
    createWindow();
    createPaletteWindow();
    createTray();
    startClipboardWatcher();
    startPresenceLoop();
    ensurePasteHelper(); // warm it up so the first palette paste is instant
    registerShortcuts();

    // Packaged builds check GitHub releases for updates; failures are silent
    // (no release published yet, offline, …) and never block startup.
    if (app.isPackaged) {
      try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      } catch { /* updater not bundled in this build */ }
    }

    // Resume the previous session, if any.
    if (settings.sessionCode) {
      try {
        await joinSession(settings.sessionCode);
      } catch {
        settings.sessionCode = '';
      }
    }

    // App launched by clicking a klip:// link.
    handleDeepLink(extractDeepLink(process.argv)).catch(() => {});
  });

  app.on('window-all-closed', () => { /* keep running in the tray */ });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('before-quit', () => {
    quitting = true;
    disconnect();
    if (pasteHelper) {
      try { pasteHelper.kill(); } catch { /* already gone */ }
    }
  });
}
