/**
 * Shared style primitives — the Klip look (docs/design.md) expressed once:
 * 12px-radius controls, 16px cards, 1px zinc borders, accent = klip-500.
 */

import { StyleSheet } from 'react-native';
import { colors, radius, font } from '../lib/theme';

export const ui = StyleSheet.create({
  /** Outermost view of a screen — owns the background; hosts the Glow. */
  screenRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  /** SafeAreaView content wrapper — transparent so the Glow shows through. */
  screen: {
    flex: 1,
    paddingHorizontal: 20,
  },
  title: {
    fontFamily: font.display,
    fontSize: 30,
    color: colors.text,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 18,
  },
  buttonPrimary: {
    borderRadius: radius.md,
    backgroundColor: colors.klip500,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  buttonPrimaryText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 15,
  },
  buttonGhost: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  buttonGhostText: {
    color: colors.textDim,
    fontSize: 15,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 15,
  },
  mono: {
    fontFamily: font.mono,
    color: colors.klip300,
    fontSize: 15,
  },
  dim: {
    color: colors.textDim,
    fontSize: 14,
  },
  faint: {
    color: colors.textFaint,
    fontSize: 12,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
  },
});
