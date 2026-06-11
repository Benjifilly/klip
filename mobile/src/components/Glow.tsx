import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * Signature ambient glow — a klip-500 wash bleeding from the top of the
 * screen (the mobile take on the desktop's radial glow).
 */
export function Glow() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={['rgba(99, 102, 241, 0.16)', 'rgba(168, 85, 247, 0.05)', 'rgba(99, 102, 241, 0)']}
      locations={[0, 0.55, 1]}
      style={styles.glow}
    />
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 280,
  },
});
