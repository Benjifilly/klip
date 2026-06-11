import type { ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius } from '../lib/theme';

/** Primary CTA on the brand gradient (klip-500 → klip-pop). */
export function GradientButton({
  label,
  onPress,
  disabled = false,
  icon,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.wrap, (pressed || disabled) && styles.dimmed]}>
      <LinearGradient
        colors={[colors.klip500, colors.klipPop]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}>
        <View style={styles.content}>
          {icon}
          <Text style={styles.label}>{label}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  dimmed: {
    opacity: 0.8,
  },
  gradient: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 15,
  },
});
