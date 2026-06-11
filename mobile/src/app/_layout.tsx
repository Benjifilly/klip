import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { useKlip } from '../lib/store';
import { colors } from '../lib/theme';
import { Argon2WebView } from '../components/Argon2WebView';

export default function Layout() {
  const [fontsLoaded] = useFonts({ SpaceGrotesk_700Bold });
  const hydrate = useKlip((state) => state.hydrate);
  const hydrated = useKlip((state) => state.hydrated);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      {/* Fast Argon2id (hash-wasm in WKWebView) — must be mounted app-wide. */}
      <Argon2WebView />
      {fontsLoaded && hydrated && (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
      )}
    </View>
  );
}
