import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Keyboard, ScanLine, ShieldCheck } from 'lucide-react-native';
import { useKlip } from '../lib/store';
import { formatSessionCode, deriveFingerprint } from '../lib/crypto';
import { parseJoinLink } from '../lib/deeplink';
import { colors, radius, font } from '../lib/theme';
import { Fingerprint } from '../components/Fingerprint';
import { Glow } from '../components/Glow';
import { GradientButton } from '../components/GradientButton';
import { Wordmark } from '../components/Wordmark';
import { ui } from '../components/ui';

type Phase =
  | { name: 'choose' }
  | { name: 'scan' }
  | { name: 'type'; value: string; error: string | null }
  | { name: 'confirm'; code: string; relay: string | null; emojis: string[] }
  | { name: 'deriving' }
  | { name: 'error'; message: string };

export default function Pairing() {
  const [phase, setPhase] = useState<Phase>({ name: 'choose' });
  const [permission, requestPermission] = useCameraPermissions();
  const join = useKlip((state) => state.join);

  // Both paths (QR and typed code) converge here: joining is always gated on
  // an explicit confirmation, the same rule as the desktop deep link.
  async function confirm(code: string, relay: string | null) {
    setPhase({ name: 'confirm', code, relay, emojis: await deriveFingerprint(code) });
  }

  async function doJoin(code: string, relay: string | null) {
    setPhase({ name: 'deriving' });
    try {
      await join(code, relay ?? undefined);
      router.replace('/');
    } catch (error) {
      setPhase({ name: 'error', message: error instanceof Error ? error.message : 'Could not join the session.' });
    }
  }

  return (
    <View style={ui.screenRoot}>
      <Glow />
      <SafeAreaView style={ui.screen}>
        <View style={styles.hero}>
          <Wordmark size={40} />
          <Text style={styles.tagline}>Your clipboard, on every device — end-to-end encrypted.</Text>
        </View>

        {phase.name === 'choose' && (
          <Animated.View entering={FadeInDown.duration(250)} style={styles.stack}>
            <Pressable
              style={({ pressed }) => [styles.optionCard, pressed && styles.optionPressed]}
              onPress={async () => {
                if (!permission?.granted) {
                  const result = await requestPermission();
                  if (!result.granted) return;
                }
                setPhase({ name: 'scan' });
              }}>
              <View style={styles.optionIcon}>
                <ScanLine color={colors.klip400} size={20} strokeWidth={2} />
              </View>
              <View style={styles.optionBody}>
                <Text style={styles.optionTitle}>Scan the desktop QR</Text>
                <Text style={styles.optionHint}>Open Klip on your desktop and show the session QR.</Text>
              </View>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.optionCard, pressed && styles.optionPressed]}
              onPress={() => setPhase({ name: 'type', value: '', error: null })}>
              <View style={styles.optionIcon}>
                <Keyboard color={colors.klip400} size={20} strokeWidth={2} />
              </View>
              <View style={styles.optionBody}>
                <Text style={styles.optionTitle}>Type the code</Text>
                <Text style={styles.optionHint}>Codes look like kx3m-9p2w-7qrt-c4vn.</Text>
              </View>
            </Pressable>
          </Animated.View>
        )}

        {phase.name === 'scan' && (
          <View style={styles.scanArea}>
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                const link = parseJoinLink(data);
                if (link) confirm(link.code, link.relay);
              }}
            />
            <Pressable style={[ui.buttonGhost, styles.gapTop]} onPress={() => setPhase({ name: 'choose' })}>
              <Text style={ui.buttonGhostText}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {phase.name === 'type' && (
          <Animated.View entering={FadeInDown.duration(250)} style={styles.stack}>
            <TextInput
              style={[ui.input, ui.mono, styles.codeInput]}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="xxxx-xxxx-xxxx-xxxx"
              placeholderTextColor={colors.textGhost}
              value={phase.value}
              onChangeText={(value) => setPhase({ name: 'type', value, error: null })}
              onSubmitEditing={() => {
                const code = formatSessionCode(phase.value);
                if (code) confirm(code, null);
              }}
            />
            {phase.error && <Text style={ui.error}>{phase.error}</Text>}
            <GradientButton
              label="Continue"
              onPress={() => {
                const code = formatSessionCode(phase.value);
                if (!code) {
                  setPhase({ ...phase, error: 'Not a Klip code — codes look like kx3m-9p2w-7qrt-c4vn.' });
                } else {
                  confirm(code, null);
                }
              }}
            />
            <Pressable style={ui.buttonGhost} onPress={() => setPhase({ name: 'choose' })}>
              <Text style={ui.buttonGhostText}>Back</Text>
            </Pressable>
          </Animated.View>
        )}

        {phase.name === 'confirm' && (
          <Animated.View entering={FadeInDown.duration(250)} style={[ui.card, styles.stack, styles.confirmCard]}>
            <View style={styles.confirmHead}>
              <ShieldCheck color={colors.klip400} size={20} strokeWidth={2} />
              <Text style={styles.confirmTitle}>Join this session?</Text>
            </View>
            <Text style={[ui.dim, styles.confirmWarning]}>
              Everything you copy will be shared with the devices on this session.
            </Text>
            <View style={styles.codeChip}>
              <Text style={ui.mono}>{phase.code}</Text>
            </View>
            <View style={styles.fingerprintRow}>
              <Fingerprint emojis={phase.emojis} />
              <Text style={ui.faint}>same emojis on every paired device</Text>
            </View>
            {phase.relay && <Text style={ui.faint}>Relay: {phase.relay}</Text>}
            <View style={styles.row}>
              <Pressable style={[ui.buttonGhost, styles.flex]} onPress={() => setPhase({ name: 'choose' })}>
                <Text style={ui.buttonGhostText}>Cancel</Text>
              </Pressable>
              <View style={styles.flex}>
                <GradientButton label="Join" onPress={() => doJoin(phase.code, phase.relay)} />
              </View>
            </View>
          </Animated.View>
        )}

        {phase.name === 'deriving' && (
          <View style={styles.deriving}>
            <ActivityIndicator size="large" color={colors.klip500} />
            <Text style={ui.dim}>Deriving the encryption key…</Text>
            <Text style={[ui.faint, styles.derivingHint]}>
              Argon2id, 64 MiB — happens once per pairing, the key never leaves this device.
            </Text>
          </View>
        )}

        {phase.name === 'error' && (
          <Animated.View entering={FadeInDown.duration(250)} style={styles.stack}>
            <Text style={ui.error}>{phase.message}</Text>
            <Pressable style={ui.buttonGhost} onPress={() => setPhase({ name: 'choose' })}>
              <Text style={ui.buttonGhostText}>Try again</Text>
            </Pressable>
          </Animated.View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginTop: 48,
    marginBottom: 12,
    gap: 10,
  },
  tagline: {
    color: colors.textDim,
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 280,
  },
  stack: {
    marginTop: 24,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  flex: {
    flex: 1,
  },
  gapTop: {
    marginTop: 16,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
  },
  optionPressed: {
    borderColor: colors.klip500,
    backgroundColor: colors.tint15,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.tint15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionBody: {
    flex: 1,
    gap: 3,
  },
  optionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  optionHint: {
    color: colors.textFaint,
    fontSize: 13,
  },
  scanArea: {
    flex: 1,
    marginTop: 24,
    marginBottom: 16,
  },
  camera: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  codeInput: {
    textAlign: 'center',
    fontSize: 17,
  },
  confirmCard: {
    gap: 14,
  },
  confirmHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  confirmTitle: {
    fontFamily: font.display,
    fontSize: 20,
    color: colors.text,
  },
  confirmWarning: {
    lineHeight: 20,
  },
  codeChip: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.tint30,
    backgroundColor: colors.tint15,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  fingerprintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deriving: {
    marginTop: 96,
    alignItems: 'center',
    gap: 12,
  },
  derivingHint: {
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 17,
  },
});
