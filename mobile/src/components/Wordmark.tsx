import { Text, StyleSheet } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { font } from '../lib/theme';

/** The Klip wordmark: Space Grotesk 700 with the soft gradient ink. */
export function Wordmark({ size = 30 }: { size?: number }) {
  const textStyle = [styles.text, { fontSize: size, lineHeight: size * 1.2 }];
  return (
    <MaskedView maskElement={<Text style={textStyle}>Klip</Text>}>
      <LinearGradient colors={['#c7d2fe', '#ddd6fe', '#f0abfc']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.4 }}>
        <Text style={[textStyle, styles.invisible]}>Klip</Text>
      </LinearGradient>
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  text: {
    fontFamily: font.display,
    color: '#ffffff',
  },
  invisible: {
    opacity: 0,
  },
});
