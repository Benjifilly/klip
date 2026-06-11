# Klip — Design language

The reference for keeping every Klip surface (desktop today, iOS tomorrow)
visually and behaviorally consistent. The desktop implementation of these
tokens lives in `client/src/index.css` (`@theme` block) — components only use
the `klip-*` tokens, never a raw palette name, so this file + that block are
the only places the identity is defined.

## Color

| Token        | Value     | Use                                            |
| ------------ | --------- | ---------------------------------------------- |
| `klip-200`   | `#e0e7ff` | Text on accent-tinted chips (selected states)  |
| `klip-300`   | `#c7d2fe` | Accent text (session code, links, labels)      |
| `klip-400`   | `#818cf8` | Active icons, focus rings, secondary accent    |
| `klip-500`   | `#6366f1` | Primary accent (buttons, borders, selection)   |
| `klip-600`   | `#4f46e5` | Pressed/darker accent                          |
| `klip-pop`   | `#a855f7` | Hot end of the brand gradient                  |

Surfaces are zinc: `zinc-950` app background, `zinc-900` cards/popovers,
`zinc-800` 1px borders. Status colors: emerald (connected/copied), amber
(paused/warnings/rotation), red (errors/destructive).

Accent tints use opacity, not lighter hues: `klip-500/15` chip backgrounds,
`klip-500/25` hover, `klip-500/30` borders.

**Contrast rules (WCAG AA):** informative text is `zinc-400` or brighter and
at least 11px; `zinc-500` is reserved for decorative/duplicated hints;
anything interactive shows a visible focus ring (`klip-400`, 2px) unless an
input swaps its border color instead.

## Typography

- **Display** (`font-display`): Space Grotesk Variable, bundled locally —
  headings, wordmark, empty-state titles.
- **Body**: system stack (Segoe UI on Windows).
- **Mono**: ui-monospace / Cascadia Mono — session codes, URLs, `kbd` hints.
- The wordmark is `.wordmark`: Space Grotesk 700 with the soft gradient ink
  (`#c7d2fe → #ddd6fe → #f0abfc`).

## Shape & depth

- Radii: `rounded-xl` (12px) for controls and list items, `rounded-2xl`
  (16px) for cards and modals, `rounded-lg` (8px) for small chips/buttons.
- Borders are always 1px zinc-800 (zinc-700 on hover); no heavy shadows
  except popovers/modals (`shadow-2xl shadow-black/60`).
- Signature ambient glow: a radial `klip-500` at 10% opacity bleeding from
  the top of the window.

## Motion

- `animate-rise`: 250ms ease-out, 6px translate + fade — list items, modals.
- Status dot pulses (`animate-pulse`) only while connecting.
- Everything respects `prefers-reduced-motion: reduce` (animations and
  transitions are disabled globally).

## Iconography

- **lucide** icons everywhere in the UI (13–18px, stroke 2).
- Emojis are reserved for the **session fingerprint** (a deliberate,
  functional choice: 4 emojis are instantly comparable across devices).
- The native window caption glyphs (min/max/close) are custom 10px SVGs that
  match Windows metrics.

## Voice

Short, factual, lowercase-calm. Hints explain *consequences*, not mechanics
("Pinned clips are kept", "share it like a password"). Security copy never
overpromises: rotation "asks devices to follow — it does not evict them".

## iOS notes (V1 shipped in `mobile/`, June 2026)

- iOS cannot watch the clipboard in the background — the V1 app is a
  foreground app (explicit "Send clipboard" button, live receive while open,
  relay replay catch-up on return). The **Share Extension** ("Send to Klip")
  and an optional custom keyboard wait for V2: they require an EAS dev build
  and a paid Apple account; V1 runs entirely in Expo Go. No desktop parity is
  promised, by design.
- Hermes has no WebAssembly and no `crypto.subtle`, so `crypto.cjs` could not
  run as-is: `mobile/src/lib/crypto.ts` re-implements the v2 scheme on
  `@noble` primitives, with byte-compatibility enforced by an interop test
  that runs both modules side by side (`mobile/test/crypto.interop.test.ts`).
- Argon2id (64 MiB, t=3) runs in pure JS at pairing only, behind a native
  spinner; the derived key is cached in the Keychain. The measured time is
  shown in Settings — if it lands above ~10 s on a real device, the fallback
  is hash-wasm inside an invisible WKWebView (which does have WebAssembly).
- Tokens live in `mobile/src/lib/theme.ts` (plain StyleSheet — NativeWind was
  skipped for boot-risk on new RN versions). Emojis remain reserved for the
  session fingerprint.
- Pairing scans the desktop QR (`klip://join?code=…&relay=…`) with the same
  confirmation rule as the desktop deep link: never join silently, show the
  code + fingerprint + relay first. Universal Links wait for V2 (associated
  domains need a paid Apple account).
