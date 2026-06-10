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

## iOS notes (for the future mobile client)

- iOS cannot watch the clipboard in the background. The iOS app is therefore
  designed as: foreground app + **Share Extension** ("Send to Klip") +
  optionally a custom keyboard to paste from history. Do not promise desktop
  parity.
- The crypto module is isomorphic (Web Crypto + WASM Argon2id) and the
  protocol is JSON over WebSocket with a `v` field and a relay `hello` —
  a new client only reimplements the clipboard layer.
- **To measure before building:** Argon2id 64 MiB derivation time on a
  low-end iPhone (hash-wasm under WKWebView/JavaScriptCore). Derivation only
  happens at join, so a pairing spinner is acceptable, but it must be tested.
- Deep links: desktop registers `klip://join?code=…&relay=…` (behind a
  confirmation dialog). iOS should use Universal Links with the same query
  shape and the same confirmation rule.
