import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import { Monitor, Settings } from 'lucide-react-native';
import { useKlip } from '../lib/store';
import { colors } from '../lib/theme';
import { Fingerprint } from './Fingerprint';
import { Wordmark } from './Wordmark';

const DOT_COLOR: Record<string, string> = {
  connected: colors.ok,
  connecting: colors.warn,
  disconnected: colors.textGhost,
};

export function StatusHeader() {
  const status = useKlip((state) => state.status);
  const fingerprint = useKlip((state) => state.fingerprint);
  const devices = useKlip((state) => state.devices);
  const peerCount = useKlip((state) => state.peerCount);

  const statusLabel =
    status === 'connected'
      ? peerCount > 1
        ? `${peerCount - 1} other device${peerCount > 2 ? 's' : ''} online`
        : 'connected — no other devices'
      : status;

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Wordmark size={30} />
        <Link href="/settings" asChild>
          <Pressable hitSlop={12} accessibilityLabel="Settings" style={styles.gearButton}>
            <Settings color={colors.textDim} size={19} strokeWidth={2} />
          </Pressable>
        </Link>
      </View>
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: DOT_COLOR[status] }]} />
        <Text style={styles.statusText}>{statusLabel}</Text>
        <Fingerprint emojis={fingerprint} />
      </View>
      {devices.length > 0 && (
        <View style={styles.devicesRow}>
          <Monitor color={colors.textFaint} size={13} strokeWidth={2} />
          <Text style={styles.devices} numberOfLines={1}>
            {devices.map((device) => device.name).join(' · ')}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 16,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gearButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: colors.textDim,
    fontSize: 13,
  },
  devicesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  devices: {
    color: colors.textFaint,
    fontSize: 12,
    flexShrink: 1,
  },
});
