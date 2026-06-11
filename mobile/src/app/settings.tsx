import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { ChevronLeft, Eye, EyeOff, LogOut } from 'lucide-react-native';
import { useKlip } from '../lib/store';
import { isAllowedRelayUrl } from '../lib/protocol';
import { colors, radius, font } from '../lib/theme';
import { Fingerprint } from '../components/Fingerprint';
import { Glow } from '../components/Glow';
import { ui } from '../components/ui';

const AUTO_COPY = [
  { value: 'all', label: 'Everything' },
  { value: 'text', label: 'Text only' },
  { value: 'off', label: 'History only' },
] as const;

export default function Settings() {
  const prefs = useKlip((state) => state.prefs);
  const setPrefs = useKlip((state) => state.setPrefs);
  const code = useKlip((state) => state.code);
  const fingerprint = useKlip((state) => state.fingerprint);
  const leave = useKlip((state) => state.leave);
  const lastDeriveMs = useKlip((state) => state.lastDeriveMs);

  const [relay, setRelay] = useState(prefs.relayUrl);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  function applyRelay() {
    const value = relay.trim();
    if (!isAllowedRelayUrl(value)) {
      setRelayError('Must be wss:// (plain ws:// is only allowed on your LAN).');
      return;
    }
    setRelayError(null);
    if (value !== prefs.relayUrl) setPrefs({ relayUrl: value });
  }

  function confirmLeave() {
    Alert.alert('Leave session?', 'The history on this phone will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await leave();
          router.replace('/pairing');
        },
      },
    ]);
  }

  return (
    <View style={ui.screenRoot}>
      <Glow />
      <SafeAreaView style={ui.screen}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.titleRow}>
            <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backButton}>
              <ChevronLeft color={colors.textDim} size={20} strokeWidth={2} />
            </Pressable>
            <Text style={styles.title}>Settings</Text>
          </View>

          <Text style={ui.sectionLabel}>Connection</Text>
          <View style={[ui.card, styles.section]}>
            <Text style={styles.fieldLabel}>Relay URL</Text>
            <TextInput
              style={[ui.input, ui.mono]}
              autoCapitalize="none"
              autoCorrect={false}
              value={relay}
              onChangeText={(value) => {
                setRelay(value);
                setRelayError(null);
              }}
              onBlur={applyRelay}
              placeholder="wss://klip-relay.example.com"
              placeholderTextColor={colors.textGhost}
            />
            {relayError && <Text style={ui.error}>{relayError}</Text>}
            <Text style={ui.faint}>Applies on next reconnect. All payloads stay end-to-end encrypted.</Text>

            <Text style={[styles.fieldLabel, styles.fieldGap]}>This device’s name</Text>
            <TextInput
              style={ui.input}
              value={prefs.deviceName}
              onChangeText={(deviceName) => setPrefs({ deviceName })}
              maxLength={64}
            />
          </View>

          <Text style={ui.sectionLabel}>Clipboard</Text>
          <View style={[ui.card, styles.section]}>
            <Text style={styles.fieldLabel}>Put received clips in the clipboard</Text>
            <View style={styles.segmented}>
              {AUTO_COPY.map((option) => {
                const active = prefs.autoCopy === option.value;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.segment, active && styles.segmentActive]}
                    onPress={() => setPrefs({ autoCopy: option.value })}>
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={ui.faint}>“History only” keeps received clips out of your clipboard until you tap them.</Text>
          </View>

          {code && (
            <>
              <Text style={ui.sectionLabel}>Session</Text>
              <View style={[ui.card, styles.section]}>
                <View style={styles.codeRow}>
                  <Text style={ui.mono}>{reveal ? code : '••••-••••-••••-••••'}</Text>
                  <Pressable hitSlop={8} onPress={() => setReveal(!reveal)} accessibilityLabel={reveal ? 'Hide code' : 'Show code'}>
                    {reveal ? (
                      <EyeOff color={colors.textFaint} size={17} strokeWidth={2} />
                    ) : (
                      <Eye color={colors.textFaint} size={17} strokeWidth={2} />
                    )}
                  </Pressable>
                </View>
                <Fingerprint emojis={fingerprint} />
                <Text style={ui.faint}>Share the code like a password — anyone holding it can join.</Text>
                <Pressable style={styles.leaveButton} onPress={confirmLeave}>
                  <LogOut color={colors.danger} size={15} strokeWidth={2} />
                  <Text style={styles.leaveText}>Leave session</Text>
                </Pressable>
              </View>
            </>
          )}

          <Text style={styles.footer}>
            Klip iOS {Constants.expoConfig?.version ?? 'dev'} · protocol v1
            {lastDeriveMs !== null ? ` · key derivation ${(lastDeriveMs / 1000).toFixed(1)}s on this device` : ''}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 48,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    marginBottom: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: font.display,
    fontSize: 26,
    color: colors.text,
  },
  section: {
    gap: 10,
    marginBottom: 8,
  },
  fieldLabel: {
    color: colors.textDim,
    fontSize: 13,
  },
  fieldGap: {
    marginTop: 8,
  },
  segmented: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentActive: {
    borderColor: colors.tint30,
    backgroundColor: colors.tint25,
  },
  segmentText: {
    color: colors.textDim,
    fontSize: 13,
  },
  segmentTextActive: {
    color: colors.klip200,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    paddingVertical: 12,
    marginTop: 4,
  },
  leaveText: {
    color: colors.danger,
    fontSize: 15,
  },
  footer: {
    color: colors.textGhost,
    fontSize: 12,
    marginTop: 24,
  },
});
