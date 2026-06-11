import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Check, FileText, Image as ImageIcon, Link2, Pin, Type } from 'lucide-react-native';
import { useKlip } from '../lib/store';
import { blobs } from '../lib/storage';
import { toBase64 } from '../lib/base64';
import { colors, radius } from '../lib/theme';
import type { HistoryItem } from '../lib/history';

/** Decrypt an image blob into a data: URI for display (cached per row). */
function useBlobUri(blobId?: string): string | null {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!blobId) return;
    let alive = true;
    blobs.load(blobId).then((bytes) => {
      if (alive && bytes) setUri(`data:image/png;base64,${toBase64(bytes)}`);
    });
    return () => {
      alive = false;
    };
  }, [blobId]);
  return uri;
}

function ago(ts: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

const looksLikeLink = (text?: string) => !!text && /^https?:\/\/\S+$/i.test(text.trim());

function KindIcon({ item }: { item: HistoryItem }) {
  const props = { color: colors.klip400, size: 15, strokeWidth: 2 } as const;
  if (item.kind === 'image') return <ImageIcon {...props} />;
  if (item.kind === 'file-placeholder') return <FileText {...props} color={colors.textFaint} />;
  if (looksLikeLink(item.text)) return <Link2 {...props} />;
  return <Type {...props} />;
}

export function ClipRow({ item }: { item: HistoryItem }) {
  const copyItem = useKlip((state) => state.copyItem);
  const togglePin = useKlip((state) => state.togglePin);
  const removeItem = useKlip((state) => state.removeItem);
  const [copied, setCopied] = useState(false);
  const uri = useBlobUri(item.kind === 'image' ? item.blobId : undefined);

  function showActions() {
    Alert.alert('Clip', undefined, [
      { text: item.pinned ? 'Unpin' : 'Pin', onPress: () => togglePin(item.id) },
      { text: 'Delete', style: 'destructive', onPress: () => removeItem(item.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function onPress() {
    if (item.kind === 'file-placeholder') return;
    await copyItem(item);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <Animated.View entering={FadeInDown.duration(250)}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={onPress}
        onLongPress={showActions}>
        <View style={styles.kindBadge}>
          <KindIcon item={item} />
        </View>
        <View style={styles.body}>
          {item.kind === 'text' && (
            <Text style={[styles.text, looksLikeLink(item.text) && styles.link]} numberOfLines={2}>
              {item.text}
            </Text>
          )}
          {item.kind === 'image' &&
            (uri ? (
              <Image source={{ uri }} style={styles.image} contentFit="cover" transition={150} />
            ) : (
              <Text style={styles.placeholder}>image…</Text>
            ))}
          {item.kind === 'file-placeholder' && (
            <Text style={styles.placeholder}>{item.fileName} — file sync isn’t supported on iOS yet</Text>
          )}
          <View style={styles.meta}>
            {item.pinned && <Pin color={colors.klip300} size={11} strokeWidth={2} />}
            <Text style={styles.metaText}>
              {item.direction === 'sent' ? 'sent' : `from ${item.deviceName}`} · {ago(item.ts)}
            </Text>
            {copied && (
              <View style={styles.copied}>
                <Check color={colors.ok} size={11} strokeWidth={2.5} />
                <Text style={styles.copiedText}>Copied</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    marginBottom: 8,
  },
  rowPressed: {
    borderColor: colors.klip500,
    backgroundColor: colors.tint15,
  },
  kindBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.tint15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  body: {
    flex: 1,
    gap: 6,
  },
  text: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  link: {
    color: colors.klip300,
  },
  image: {
    height: 110,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  placeholder: {
    color: colors.textFaint,
    fontSize: 14,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    color: colors.textFaint,
    fontSize: 12,
  },
  copied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  copiedText: {
    color: colors.ok,
    fontSize: 12,
  },
});
