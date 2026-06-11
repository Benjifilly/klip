import { Text, View, StyleSheet } from 'react-native';
import { colors, radius } from '../lib/theme';

/**
 * The 4-emoji session fingerprint — identical on every paired device, so a
 * glance confirms two devices share a session. Emojis are reserved for this
 * (a deliberate, functional choice — see docs/design.md).
 */
export function Fingerprint({ emojis }: { emojis: string[] }) {
  if (!emojis.length) return null;
  return (
    <View style={styles.chip} accessibilityLabel={`Session fingerprint: ${emojis.join(' ')}`}>
      <Text style={styles.emojis}>{emojis.join(' ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    backgroundColor: colors.tint15,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  emojis: {
    fontSize: 16,
  },
});
