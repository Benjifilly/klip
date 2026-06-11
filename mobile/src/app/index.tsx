import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, FlatList, Pressable, Text, TextInput, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { ClipboardList, ClipboardPaste, Image as ImageIcon, RefreshCw, Search } from 'lucide-react-native';
import { useKlip } from '../lib/store';
import { fromBase64 } from '../lib/base64';
import { colors, radius } from '../lib/theme';
import { ClipRow } from '../components/ClipRow';
import { StatusHeader } from '../components/StatusHeader';
import { Glow } from '../components/Glow';
import { GradientButton } from '../components/GradientButton';
import { ui } from '../components/ui';

export default function Home() {
  const code = useKlip((state) => state.code);
  const history = useKlip((state) => state.history);
  const sendClipboard = useKlip((state) => state.sendClipboard);
  const sendImage = useKlip((state) => state.sendImage);
  const pendingRotation = useKlip((state) => state.pendingRotation);
  const acceptRotation = useKlip((state) => state.acceptRotation);
  const dismissRotation = useKlip((state) => state.dismissRotation);

  const [query, setQuery] = useState('');
  const [hasContent, setHasContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);

  // hasString/hasImage don't read the clipboard, so no iOS paste banner here;
  // the banner appears once on the actual read — expected and honest.
  const refreshClipboardHint = useCallback(async () => {
    try {
      setHasContent((await Clipboard.hasStringAsync()) || (await Clipboard.hasImageAsync()));
    } catch {
      /* hint only */
    }
  }, []);

  useEffect(() => {
    refreshClipboardHint();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshClipboardHint();
    });
    return () => sub.remove();
  }, [refreshClipboardHint]);

  if (!code) return <Redirect href="/pairing" />;

  const shown = query
    ? history.filter((item) => (item.text ?? item.fileName ?? '').toLowerCase().includes(query.toLowerCase()))
    : history;

  async function onSend() {
    setBusy(true);
    try {
      const what = await sendClipboard();
      if (what === 'empty') Alert.alert('Clipboard is empty');
    } catch (error) {
      Alert.alert('Could not send', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
      refreshClipboardHint();
    }
  }

  async function onSendPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', base64: true, quality: 0.8 });
    const base64 = result.assets?.[0]?.base64;
    if (!base64) return;
    try {
      await sendImage(fromBase64(base64));
    } catch (error) {
      Alert.alert('Could not send', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async function onAcceptRotation() {
    setSwitching(true);
    try {
      await acceptRotation();
    } catch (error) {
      Alert.alert('Could not switch', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <View style={ui.screenRoot}>
      <Glow />
      <SafeAreaView style={ui.screen}>
        <StatusHeader />

        {pendingRotation && (
          <View style={styles.rotation}>
            <View style={styles.rotationHead}>
              <RefreshCw color={colors.warn} size={14} strokeWidth={2} />
              <Text style={styles.rotationText}>
                {pendingRotation.deviceName} rotated the session code. Switch to the new session?
              </Text>
            </View>
            <View style={styles.rotationActions}>
              <Pressable hitSlop={8} onPress={dismissRotation} disabled={switching}>
                <Text style={ui.dim}>Ignore</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={onAcceptRotation} disabled={switching}>
                <Text style={styles.rotationSwitch}>{switching ? 'Switching…' : 'Switch'}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.sendArea}>
          {hasContent ? (
            <GradientButton
              label={busy ? 'Sending…' : 'Send clipboard'}
              onPress={onSend}
              disabled={busy}
              icon={<ClipboardPaste color="#ffffff" size={17} strokeWidth={2} />}
            />
          ) : (
            <Pressable disabled={busy} style={ui.buttonGhost} onPress={onSend}>
              <View style={styles.ghostContent}>
                <ClipboardPaste color={colors.textDim} size={17} strokeWidth={2} />
                <Text style={ui.buttonGhostText}>{busy ? 'Sending…' : 'Send clipboard'}</Text>
              </View>
            </Pressable>
          )}
        </View>

        <View style={styles.toolbar}>
          <View style={styles.searchWrap}>
            <Search color={colors.textGhost} size={15} strokeWidth={2} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search"
              placeholderTextColor={colors.textGhost}
              value={query}
              onChangeText={setQuery}
            />
          </View>
          <Pressable
            style={({ pressed }) => [styles.photoButton, pressed && styles.photoPressed]}
            onPress={onSendPhoto}
            accessibilityLabel="Send a photo">
            <ImageIcon color={colors.textDim} size={17} strokeWidth={2} />
          </Pressable>
        </View>

        <FlatList
          data={shown}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ClipRow item={item} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ClipboardList color={colors.textGhost} size={28} strokeWidth={1.5} />
              <Text style={styles.emptyText}>Copy something on another device — it appears here.</Text>
            </View>
          }
          contentContainerStyle={shown.length === 0 ? styles.emptyContainer : undefined}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  rotation: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    backgroundColor: colors.warnTint,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  rotationHead: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  rotationText: {
    color: colors.warn,
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  rotationActions: {
    flexDirection: 'row',
    gap: 20,
    marginLeft: 22,
  },
  rotationSwitch: {
    color: colors.warn,
    fontWeight: '600',
    fontSize: 14,
  },
  sendArea: {
    marginBottom: 12,
  },
  ghostContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  toolbar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  photoButton: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 13,
    justifyContent: 'center',
  },
  photoPressed: {
    borderColor: colors.klip500,
  },
  empty: {
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    color: colors.textFaint,
    textAlign: 'center',
    fontSize: 14,
    maxWidth: 240,
    lineHeight: 20,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
});
