# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

**Pinned to SDK 54 on purpose** (2026-06): the App Store Expo Go only runs
SDK 54 (Apple approval backlog; the SDK 56 TestFlight beta is full). Do not
bump the SDK until the App Store Expo Go moves past 54.

## Klip mobile — working notes

- This workspace is the iOS companion of Klip (see `../docs/design.md` and
  `../docs/superpowers/specs/2026-06-11-klip-ios-design.md`).
- **Interop is the contract**: `src/lib/crypto.ts` must stay byte-compatible
  with `../client/electron/crypto.cjs`, and `src/lib/protocol.ts` with the
  protocol in `../client/electron/main.cjs`. Never change one side alone;
  `test/crypto.interop.test.ts` and `test/protocol.test.ts` enforce it.
- `src/lib/{crypto,protocol,history,deeplink,base64}.ts` are pure TS with no
  React Native imports — they run under Node in CI. Keep them that way.
- Must keep running in **Expo Go** (no custom native modules) until the EAS
  V2: no Mac / paid Apple account available.
- Commands: `npm test` (vitest), `npm run lint` (expo lint, ESLint 9 — the
  root's ESLint 10 is incompatible with eslint-config-expo), `npx tsc
  --noEmit`, `npx expo start --tunnel` to run on the iPhone.
- Styling: plain StyleSheet over `src/lib/theme.ts` tokens (no NativeWind —
  deliberate, see the spec's deviations section).
