# Klip iOS

The iOS companion app for [Klip](../README.md) — pair with a session, send the
iPhone clipboard (text + images), receive clips live into an encrypted
history. Same E2EE wire format as desktop: the relay only ever sees
`{iv, ct}` blobs.

Built with Expo so it runs in **Expo Go** — no Mac, no paid Apple Developer
account needed to develop and test on a real iPhone.

> **⚠ Why SDK 54 (June 2026):** the App Store build of Expo Go only supports
> SDK 54 — Apple has been sitting on the SDK 55/56 builds since early May,
> Expo moved SDK 56 distribution to a TestFlight beta, and that beta is full
> (10 000-tester cap). So this project is pinned to **SDK 54** to match the
> App Store Expo Go. Bump it (`npx expo install expo@latest --fix`) once the
> store version moves — see
> https://expo.dev/changelog/expo-go-and-app-store-may-2026.

## Run it on your iPhone

1. Install **Expo Go** from the App Store.
2. On the PC:

   ```bash
   npm install            # repo root — mobile/ is an npm workspace
   cd mobile
   npx expo start --tunnel
   ```

3. Scan the terminal QR with the iPhone camera → the app opens in Expo Go.
4. In the desktop Klip app, create a session and show the QR; in the iOS app,
   **Scan the desktop QR** (or type the code), check the 4-emoji fingerprint
   matches, confirm. Pairing runs Argon2id (64 MiB) in pure JS — expect a
   spinner for a few seconds, once per pairing. The measured time shows up in
   Settings.

`--tunnel` works from any network; on a shared Wi-Fi plain `npx expo start`
is faster.

## What works (V1)

- QR / code pairing with explicit confirmation + emoji fingerprint
- Send clipboard (text & images ≤ 4 MiB) — foreground only, by iOS design
- Receive text/images live; auto-copy modes `Everything` / `Text only` /
  `History only` (same semantics as desktop)
- Encrypted-at-rest history (Keychain-held key), pinning, search
- Reconnect on foreground + the relay's 2-minute replay buffer for catch-up
- Rotation consent — a rotate pushed by another device asks before switching
- Incoming files show a placeholder (no file sync on iOS yet)

## What waits for V2 (paid Apple account + EAS dev build)

- **Share Extension** ("Send to Klip" from any app's share sheet)
- File send/receive, push notifications, Universal Links, TestFlight/App Store

## Architecture notes

- `src/lib/crypto.ts` — same v2 derivations as `client/electron/crypto.cjs`
  on `@noble` primitives (Hermes has no WebAssembly / `crypto.subtle`).
  Byte-compatibility is enforced by `test/crypto.interop.test.ts`, which runs
  both implementations side by side in Node.
- `src/lib/protocol.ts` — the relay client (clip/chunk/presence/rotate,
  dedupe, backoff). Pure TS; `test/protocol.test.ts` drives it against the
  real relay (`server/src/index.js`) in-process.
- `src/lib/storage.ts` — the only file touching Expo storage APIs (Keychain
  via expo-secure-store, encrypted blobs via expo-file-system); a V2 move to
  an App Group container only changes this file.
- Styling is plain StyleSheet over `src/lib/theme.ts`, the mobile mirror of
  the [design tokens](../docs/design.md). (NativeWind was considered and
  skipped: its v4 line has broken on each recent React Native bump and v5 is
  pre-release — not worth the boot risk.)
- **Argon2id runs in an invisible WebView** (`src/components/Argon2WebView.tsx`):
  Hermes has no JIT or WebAssembly, so the pure-JS derivation takes minutes —
  WKWebView runs hash-wasm (the exact desktop module, embedded as a string by
  `scripts/embed-hash-wasm.cjs`) at near-native speed. If the WebView fails
  or times out, `deriveSessionKey` falls back to pure JS: slow, never broken.
- `metro.config.js` pins every `react` import to this app's copy — the
  desktop client hoists a different React to the workspace root, and two
  Reacts in one bundle crash at runtime (`expo-doctor`'s duplicate-react
  warning is this, handled).

## Tests

```bash
npm test               # repo root: desktop unit + e2e, then this suite
npm run test --workspace mobile   # just the mobile suite (vitest)
```
