# Klip

[![CI](https://github.com/Benjifilly/klip/actions/workflows/ci.yml/badge.svg)](https://github.com/Benjifilly/klip/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-36-9feaf9.svg?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![E2EE](https://img.shields.io/badge/E2EE-AES--256--GCM%20%2B%20Argon2id-a855f7.svg)](#security-model)

**Instant, end-to-end encrypted clipboard sync between your devices — anywhere in the world.**

Copy on your desktop, paste on your laptop. Klip watches your clipboard, encrypts everything locally with AES-256-GCM, and relays the ciphertext in real time over WebSockets to every device in your session. The relay server never sees your data — only opaque encrypted packets.

<p align="center">
  <img src="docs/dashboard.png" alt="Klip dashboard — session card with emoji fingerprint, search and synced history" width="390" />
  &nbsp;&nbsp;
  <img src="docs/quick-paste.png" alt="Quick-paste palette summoned anywhere with Ctrl+Shift+V" width="330" />
</p>

- ⚡ **Instant** — WebSocket push, no polling a cloud API
- 🔒 **End-to-end encrypted** — AES-256-GCM, key derived on-device with Argon2id; local history is encrypted at rest too
- 🖼️ **Text, links, images & files** — screenshots and files (≤ 20 MB) sync as transparently chunked, individually encrypted packets
- ⌨️ **Quick-paste palette** — `Ctrl+Shift+V` anywhere pops your recent clips at the cursor and pastes straight into the app you were typing in
- 🌍 **Works anywhere** — Wi-Fi, 4G/5G, public networks; all it needs is one outbound WebSocket
- 🪶 **Self-hostable** — the relay is a single tiny Node.js file (one dependency)
- 🖥️ **Lives in your tray** — close the window, sync keeps running

## How it works

```
   Device A                        Relay server                       Device B
┌─────────────┐                ┌─────────────────┐                ┌─────────────┐
│ clipboard   │                │                 │                │ clipboard   │
│   watcher   │   encrypted    │  rooms (Map)    │   encrypted    │  injection  │
│      │      │    packet      │                 │    packet      │      ▲      │
│  AES-256-   │ ─────────────▶ │  roomId ──▶ ws  │ ────────────▶ │  AES-256-   │
│  GCM encrypt│   WebSocket    │  (relay only,   │   WebSocket    │  GCM decrypt│
│             │                │   no plaintext) │                │             │
└─────────────┘                └─────────────────┘                └─────────────┘
```

### Security model

The shared **session code** (e.g. `kx3m-9p2w-7qrt-c4vn`, ~79 bits of entropy) never leaves your devices. Three independent, domain-separated values are derived from it:

| Derivation                                        | Output                  | Who sees it           |
| ------------------------------------------------- | ----------------------- | --------------------- |
| `Argon2id(code, salt="klip/v2/key", 64 MiB, t=3)` | AES-256-GCM session key | **Your devices only** |
| `SHA-256("klip/v2/room:" + code)`                 | 64-char hex room id     | The relay (opaque)    |
| `SHA-256("klip/v2/fingerprint:" + code)`          | 4-emoji fingerprint     | Shown in the UI       |

- Every clipboard packet is `{ iv, ct }` — a fresh 96-bit IV and AES-GCM ciphertext (content + device name + timestamp all encrypted together). Large payloads (images) are split into chunks, each independently encrypted.
- GCM authentication means a tampered packet, or one encrypted with a different code, is silently rejected.
- Argon2id's memory-hardness (64 MiB per guess) makes brute-forcing a code from a room id infeasible, even on GPUs.
- The **session fingerprint** (4 emojis next to the code) is identical on every paired device — a glance confirms you're in the right session.
- **At rest:** settings, history and image blobs are encrypted with the OS keychain (DPAPI on Windows) via Electron `safeStorage` before touching the disk.
- **Clipboard hygiene:** optional auto-clear wipes the clipboard N seconds after a copy (Settings), and **Rotate code** moves every connected device to a fresh code in one click.
- The relay validates shapes, rate-limits, caps payload size, and forwards. It logs nothing about content. Its catch-up buffer (see below) holds ciphertext only, in memory, for 2 minutes — disable with `KLIP_REPLAY_MAX=0`.
- The renderer process is fully sandboxed (`contextIsolation`, no Node integration); crypto and networking live in the Electron main process behind a narrow IPC bridge.
- The client refuses plain `ws://` for anything that isn't localhost or a LAN address — internet relays must be `wss://` so metadata (room id, timing) is protected in transit too.

**Threat model notes:** anyone who learns your session code can join your session — treat it like a password (codes are machine-generated and never reused). Rotation pushes the new code under the _old_ key, so it refreshes a leaked code but does not evict someone who already holds the current key — for that, leave the session and create a fresh one out-of-band.

## Repository layout

```
klip/
├── server/                  # Relay server (Node.js + ws, 1 dependency)
│   ├── src/index.js         #   rooms, heartbeat, rate limiting, /healthz
│   └── Dockerfile
├── client/                  # Desktop app (Electron + React + Tailwind v4)
│   ├── electron/
│   │   ├── main.cjs         #   clipboard watcher, WebSocket, tray, IPC
│   │   ├── preload.cjs      #   the only main<->renderer bridge
│   │   └── crypto.cjs       #   E2EE module (isomorphic Web Crypto)
│   ├── src/                 #   React UI (dark dashboard, history, pairing)
│   └── assets/              #   app & tray icons
└── tests/e2e.cjs            # crypto round-trip + relay isolation tests
```

## Getting started

Requires **Node.js ≥ 20**.

```bash
git clone https://github.com/Benjifilly/klip.git
cd klip
npm install        # installs server + client (npm workspaces)
npm test           # e2e: crypto round-trip, GCM auth, room isolation
```

### 1. Start everything

```bash
npm run dev    # relay (:8787) + desktop app, in one command
```

Or separately: `npm run dev:server` and `npm run dev:client` in two terminals.
Vite serves the UI on `127.0.0.1:5173` and Electron opens once it's up — the UI is Electron-only (opening it in a regular browser shows a notice instead).

### 2. Pair and test

1. In the app, click **Create a new session** — a code like `kx3m-9p2w-7qrt-c4vn` is generated and you're connected.
2. On a second device (or a second instance), choose **Join** and enter the same code. The relay URL in Settings must point at the same server (`ws://<your-ip>:8787` on a LAN).
3. Copy any text on one device → it appears in the other device's history and clipboard within a second.

To verify E2EE empirically: watch the relay traffic (e.g. Wireshark on `:8787`) — you'll only ever see base64 `iv`/`ct` blobs.

### 3. Shortcuts & tray

| Shortcut       | Action                                          |
| -------------- | ----------------------------------------------- |
| `Ctrl+Shift+K` | Show / hide the window — works system-wide      |
| `Ctrl+Shift+V` | **Quick-paste palette** at the cursor — global  |
| `Ctrl+F`       | Search the history                              |
| `Ctrl+1` … `9` | Copy the nth visible item back to the clipboard |
| `Ctrl+,`       | Open settings                                   |

In the palette: type to filter, `↑`/`↓` to navigate, `Enter` **pastes directly** into the app you came from (`Ctrl+Enter` copies without pasting), `Esc` dismisses.

**Files:** copy a file in Explorer (`Ctrl+C`), drop it on the window, or click the 📎 button — it's sent to your devices. Received files stay encrypted in Klip's store until you click **Save** — they are never auto-written to disk, never executed. Limits: 20 MB per file, 3 files per copy, names sanitized on arrival.

**History:** click any item to copy it back to the clipboard (files open the Save dialog instead); hover for Open / Save / Pin / Delete.

Closing the window doesn't quit: Klip keeps syncing from the **system tray** (the `^` overflow area next to the clock). The tray menu shows the sync status, your five most recent clips for one-click re-copy, the quick-paste palette, and a **Pause sync** toggle. Pin a clip (📌 on hover) and it survives **Clear all** and history pruning.

## Production

### Deploy the relay

The relay is stateless — run it anywhere:

```bash
# Docker
docker build -t klip-relay ./server
docker run -p 8787:8787 klip-relay
```

For internet exposure, terminate TLS in front (Caddy, nginx, or a PaaS like Fly.io/Render that gives you `wss://` for free), then set the relay URL in the app's Settings to `wss://relay.yourdomain.com`.

```nginx
# nginx WebSocket proxy
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;
}
```

`GET /healthz` returns `{"ok":true,"rooms":N}` for liveness probes, and `GET /metrics` exposes Prometheus counters (rooms, connections, forwarded/replayed packets) — never payload content.

To verify a deployed relay end-to-end (TLS, WebSocket upgrade, room join):

```bash
node tests/ws-probe.cjs wss://your-relay.example.com   # prints "joined" within a second
```

One-click deploys: `server/fly.toml` (Fly.io) and `render.yaml` (Render blueprint) are included; both give you `wss://` out of the box. CI runs `npm test` and the client build on every push (`.github/workflows/ci.yml`).

### Package the desktop app

```bash
npm run dist:client   # NSIS installer in client/release/
```

## Roadmap

**Features**

- [ ] **Mobile** — the crypto module is isomorphic (Web Crypto + WASM Argon2id) and the protocol is plain JSON over WebSocket, so a companion PWA or React Native app only needs to reimplement the clipboard layer
- [x] Images (chunked, same E2EE envelope) — arbitrary files are next
- [x] Files (chunked, same E2EE envelope; 20 MB cap, sanitized names, saved only on explicit user action)
- [x] Quick-paste palette — global `Ctrl+Shift+V` popup at the cursor, arrow keys + Enter
- [x] Pinned / favorite clips
- [x] Auto-start on login (toggle in Settings)
- [x] QR-code pairing — the session code renders as a `klip://join` QR for the future mobile app

**Security**

- [x] Local history, settings and image blobs encrypted at rest (Electron `safeStorage` / DPAPI)
- [x] Session fingerprint — 4 emojis derived from the code, identical on every paired device
- [x] Clipboard auto-clear — wipe the clipboard N seconds after a copy (Settings)
- [x] One-click key rotation — pushes a fresh code to every connected device
- [x] Argon2id (64 MiB, t=3) instead of PBKDF2 for key derivation

**Backend**

- [x] Store-and-forward — last N _encrypted_ packets per room (2 min TTL) so reconnecting devices catch up; `KLIP_REPLAY_MAX=0` disables
- [x] `/metrics` Prometheus endpoint (rooms, connections, forwarded/replayed counters) — never payload content
- [x] CI (GitHub Actions: `npm test` + client build) and one-click deploy manifests (`server/fly.toml`, `render.yaml`)
- [x] Client-side: plain `ws://` is refused for non-local relays — `wss://` everywhere else

## Contributing

PRs welcome. Keep the relay dependency-light, never log payload content, and run `npm test` before submitting.

## License

[MIT](LICENSE)
