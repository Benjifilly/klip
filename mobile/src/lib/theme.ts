/**
 * Klip design tokens — the mobile mirror of docs/design.md.
 * Components only use these tokens, never raw palette values, so this file is
 * the single place the identity is defined on iOS (like the `@theme` block on
 * desktop).
 */

export const colors = {
  // Accent (indigo ramp + hot end of the brand gradient)
  klip200: '#e0e7ff',
  klip300: '#c7d2fe',
  klip400: '#818cf8',
  klip500: '#6366f1',
  klip600: '#4f46e5',
  klipPop: '#a855f7',

  // Zinc surfaces
  bg: '#09090b', // zinc-950 — app background
  card: '#18181b', // zinc-900 — cards/popovers
  border: '#27272a', // zinc-800 — 1px borders
  borderHover: '#3f3f46', // zinc-700

  // Text
  text: '#f4f4f5', // zinc-100
  textDim: '#a1a1aa', // zinc-400 — informative text (AA floor)
  textFaint: '#71717a', // zinc-500 — decorative/duplicated hints only
  textGhost: '#52525b', // zinc-600

  // Status
  ok: '#34d399', // emerald-400 — connected/copied
  warn: '#fbbf24', // amber-400 — paused/warnings/rotation
  danger: '#f87171', // red-400 — errors/destructive

  // Accent tints (opacity over klip-500, not lighter hues)
  tint15: 'rgba(99, 102, 241, 0.15)',
  tint25: 'rgba(99, 102, 241, 0.25)',
  tint30: 'rgba(99, 102, 241, 0.30)',
  warnTint: 'rgba(251, 191, 36, 0.10)',
  warnBorder: 'rgba(251, 191, 36, 0.40)',
  dangerBorder: 'rgba(248, 113, 113, 0.40)',
} as const;

export const radius = {
  sm: 8, // small chips/buttons
  md: 12, // controls and list items
  lg: 16, // cards and modals
} as const;

export const font = {
  display: 'SpaceGrotesk_700Bold', // headings, wordmark
  mono: 'Menlo', // session codes, URLs (ui-monospace equivalent on iOS)
} as const;
