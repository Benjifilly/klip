# Klip iOS (V1) — Design

**Date:** 2026-06-11 · **Status:** approved (design validated by Benji in session)

## Goal

A companion iOS app for Klip: pair with an existing session (QR or code), send the
iPhone clipboard (text + images) to the session, receive clips live into an
encrypted history, copy them back with a tap. Same E2EE guarantees as desktop:
the relay only ever sees `{iv, ct}` blobs.

## Hard constraints

- **Dev machine is Windows; no Mac; no paid Apple Developer account.** Benji has
  an iPhone for testing. Therefore V1 must run inside **Expo Go** (free App
  Store app, loads the JS bundle from `npx expo start --tunnel` on the PC).
- Expo Go ⇒ **pure JS + Expo SDK modules only**. No custom native code, no
  Share Extension, no TestFlight in V1.
- Hermes has **no WebAssembly and no `crypto.subtle`** ⇒ `client/electron/crypto.cjs`
  (hash-wasm) cannot run as-is. The mobile crypto module is a re-implementation
  with identical parameters and wire format (see Crypto).
- iOS forbids background clipboard monitoring (already documented in
  `docs/design.md`). The app is foreground-only; no desktop parity promised.

## Architecture

New npm workspace `mobile/` in the monorepo (root `package.json` gains the
workspace entry; Metro is configured for the workspace layout).

```
mobile/
  app/                      # expo-router screens
    index.tsx               #   history / home (redirects to pairing when no session)
    pairing.tsx             #   join by QR scan or typed code
    settings.tsx            #   relay URL, device name, auto-copy
  src/lib/crypto.ts         # v2 derivations + AES-256-GCM (@noble), isomorphic (runs in Node for tests)
  src/lib/protocol.ts       # relay client: connect/join/clip/chunk/presence/rotate, pure TS, no RN imports
  src/lib/store.ts          # zustand state + encrypted persistence
  src/lib/clipboard.ts      # thin wrapper over expo-clipboard (the only iOS-specific layer)
  src/components/           # UI pieces (clip rows, fingerprint, status dot)
  test/                     # vitest: crypto interop vs crypto.cjs, protocol against the real relay
```

Stack: Expo (latest SDK) + TypeScript, expo-router, **NativeWind** (Tailwind
classes reusing the `docs/design.md` tokens: zinc-950 surfaces, `klip-500`
accent, Space Grotesk via expo-font), **zustand** for state.

`crypto.ts` and `protocol.ts` are deliberately free of React Native imports so
they run under Node in CI.

## Crypto (interop is the contract)

Same v2 scheme, byte-for-byte compatible with `crypto.cjs`:

| Derivation | Parameters |
| --- | --- |
| Session key | Argon2id(code, salt=`klip/v2/key`, 64 MiB, t=3, p=1, len=32) → AES-256-GCM key |
| Room id | SHA-256(`klip/v2/room:` + code) → hex |
| Fingerprint | SHA-256(`klip/v2/fingerprint:` + code) → first 3 bytes → 4×6 bits → same 64-emoji table |
| Packet | `{iv: b64(12 bytes), ct: b64(ciphertext+GCM tag)}` |

Implementation: `@noble/hashes` (argon2id, sha256) + `@noble/ciphers`
(aes-256-gcm), random IVs via `expo-crypto` `getRandomValues` (polyfilled for
Node tests). Code generation/validation (31-char alphabet, 16 chars,
`xxxx-xxxx-xxxx-xxxx`) is ported identically.

**Interop test (CI, no device needed):** a vitest suite derives key/roomId/
fingerprint from the same code with `crypto.cjs` (hash-wasm) and `crypto.ts`
(@noble) and asserts equality, then round-trips encryption both directions.

**Risk #1 — Argon2id in pure JS on the phone.** 64 MiB / t=3 under Hermes may
take long (possibly 10 s+ on older iPhones). Mitigations, in order:
1. Derivation happens **only at pairing**, behind a progress spinner; the
   derived key is cached in the iOS Keychain (expo-secure-store) and reused on
   every launch.
2. Measured on Benji's iPhone at milestone 1 (a timing screen in the dev
   build). If unacceptable (> ~10 s), **plan B**: run hash-wasm inside an
   invisible `react-native-webview` (WKWebView has WebAssembly + crypto.subtle;
   the webview is supported in Expo Go) used only for derivation. The crypto
   module keeps the same interface either way.

## Protocol client

Same relay, same JSON over `wss://` (plain `ws://` allowed only for
localhost/private-LAN addresses, mirroring the desktop rule).

- Connect → relay sends `{type:'hello', v}` → send `{type:'join', roomId}` →
  `{type:'joined'}` → announce presence. Relay replays its 2-minute catch-up
  buffer automatically on join.
- Outbound envelope: `{type:'clip', v:1, mid: uuid, sid: installId, data}`.
  Payloads whose serialized JSON ≤ 256 KiB are one packet
  (`data = {iv, ct}`); larger ones are split into ≤128 chunks of 256 KiB,
  each independently encrypted: `data = {iv, ct, fid, seq, tot}`, chunk
  `mid = "<mid>:<seq>"`.
- Inbound: drop own `sid`, dedupe by `mid` (LRU), reassemble chunks with the
  same caps as desktop (128 chunks/transfer, bounded in-flight transfers and
  bytes — scaled down for a phone: 4 transfers / 32 MiB).
- Inner payload kinds (all encrypted, all carry `v`, `deviceName`, `ts`):
  - `text {text}` → history + optional auto-copy
  - `image {png: b64}` (≤ 4 MiB) → history; copy / save to Photos on demand
  - `file` → V1 placeholder row "file sync isn't supported on iOS yet"
  - `presence {id, name, hello, bye}` → device list (60 s loop, 150 s TTL,
    answer `hello`, honor `bye`)
  - `rotate {code}` → **never follow silently**: same consent dialog as
    desktop, showing the requesting device name
- Packets with `item.v >` known version are skipped whole. GCM failures are
  silently dropped (wrong key / tampering).
- Reconnect: exponential backoff (1 s → 30 s) while the app is foreground;
  on `AppState` → active, reconnect immediately (replay covers the gap).

## UX (3 screens, Klip design language)

**Pairing** — "Join a session": scan the desktop QR (expo-camera) which already
encodes `klip://join?code=…&relay=…`, or type the code. Shows the 4-emoji
fingerprint + relay host and asks for confirmation before joining (same rule
as the desktop deep link). Spinner with progress during key derivation.
Creating a session from the phone reuses the same generator (parity, cheap).

**History / home** — status dot + fingerprint + peer-device names; search;
clip list (text + images + placeholders) with sender and relative time; tap =
copy (text → clipboard, image → clipboard via `setImageAsync`); long-press =
share sheet / save image to Photos / delete. Prominent **"Send clipboard"**
button: highlighted when `hasStringAsync`/`hasImageAsync` says there is
content (these checks don't trigger the iOS paste banner; the banner appears
once on the actual read — expected and honest). A second action sends a photo
from the library (expo-image-picker).

**Settings** — relay URL (wss enforced for non-local), device name, auto-copy
received clips (`all` / `text` / `off`, mirroring desktop semantics), leave
session (sends presence `bye`, wipes local state). Footer: app version +
protocol version.

## Storage & security posture

- Session code + cached derived key + install id: **expo-secure-store** (iOS
  Keychain — the at-rest analogue of DPAPI on desktop).
- History: capped (200 items; images stored as encrypted blobs via
  expo-file-system, 50 MiB budget, oldest evicted). Encrypted at rest with a
  device-local AES key kept in the Keychain — same posture as desktop.
- Received images are never auto-saved to Photos; saving is an explicit action
  (matches the desktop "files are never auto-written" rule).
- No clip content in any notification (V1 has no notifications at all).

## Out of scope (V1)

Share Extension, custom keyboard, file send/receive, push notifications,
background sync, Universal Links, App Store distribution. All deferred to V2
(requires paid Apple account + EAS dev builds); nothing in V1's structure has
to be redone for them — the storage layer is behind an interface that can move
to an App Group container later.

## Testing

- **CI (Node, no device):** crypto interop suite vs `crypto.cjs`; protocol
  client driven against the real relay (`server/src/index.js`) like
  `tests/e2e.cjs` does — join, text round-trip, chunked image round-trip,
  presence, rotate-consent, dedupe/replay.
- **Manual on iPhone (Expo Go):** Argon2id timing (first), QR pairing against
  the desktop app, live text/image sync both directions, replay catch-up after
  backgrounding, paste-banner behavior, auto-copy modes.
- Root `npm test` is extended to run the mobile suite.

## Implementation deviations (recorded post-build, 2026-06-11)

- **NativeWind dropped** in favor of plain StyleSheet over
  `mobile/src/lib/theme.ts` (same tokens). The template came up on Expo
  SDK 56 / RN 0.85 (one month old); NativeWind v4 has broken on each recent
  RN bump and v5 is pre-release — not worth the boot risk in Expo Go.
- Template layout puts router screens in `mobile/src/app/` (SDK 56 default),
  not `mobile/app/`.
- `history.addItem` returns `{kept, deletedBlobIds}` so the store can reclaim
  evicted blob files.
- Protocol tests use one fresh relay room per test: the relay's
  store-and-forward buffer (by design) replays recent ciphertext to
  newcomers, which leaks clips across tests sharing a room.
- Bonus discovered in SDK 56: expo-crypto now ships native AES-GCM
  (`aesEncryptAsync`) — a future perf option for image chunks, kept out of V1
  to preserve the single @noble code path proven by the interop suite.
- **Downgraded SDK 56 → 54 (same day):** the App Store Expo Go only supports
  SDK 54 (Apple approval backlog since May 2026) and the SDK 56 TestFlight
  beta is at its 10 000-tester cap, so Benji's iPhone refused the SDK 56
  bundle with "project is incompatible with this version of Expo Go".
  `npx expo install expo@^54.0.0 --fix` + clean reinstall; `reactCompiler`
  experiment and `predictiveBackGestureEnabled` (SDK 56 template leftovers)
  removed. All code is API-compatible (the file-system object API is the
  SDK 54 default). Re-bump when the store build moves.
- **Plan B activated (same day):** on-device testing confirmed pure-JS
  Argon2id is unusable under Hermes (no JIT — minutes, not seconds).
  Implemented as designed: hash-wasm (the desktop module, embedded as a
  string by `scripts/embed-hash-wasm.cjs`) runs inside an invisible
  `react-native-webview` mounted at the root layout; `crypto.ts` exposes
  `setArgon2Backend()` and falls back to @noble pure JS on WebView
  failure/timeout. Node tests still exercise the @noble path, whose
  equivalence to hash-wasm the interop suite proves.
- **Metro react pinning:** the workspace root hoists the desktop client's
  React; `mobile/metro.config.js` redirects every `react` specifier to the
  app's own copy (a `resolveRequest` wrapper — `disableHierarchicalLookup`
  was tried first and broke transitive deps like reanimated's `semver`).
- **Design pass:** lucide-react-native icons (13–18px stroke 2, per
  design.md), gradient wordmark (masked-view + expo-linear-gradient), ambient
  top glow, brand-gradient CTA, reanimated FadeInDown entrances (auto-disabled
  with reduced motion), card-based pairing options and settings sections.

## Milestones

1. **Workspace + crypto interop** — `mobile/` scaffold boots in Expo Go;
   `crypto.ts` passes the interop suite; Argon2id timing measured on device.
2. **Protocol client** — Node tests green against the local relay.
3. **UI V1** — pairing (QR + code), history, settings, wired to the store.
4. **Polish + manual test pass** — design tokens, error states, README +
   design.md updates, full device checklist.
