import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { hexToBytes } from '@noble/hashes/utils';
import { setArgon2Backend } from '../lib/crypto';
import { HASH_WASM_UMD } from '../lib/hash-wasm-umd';

/**
 * Invisible WebView that runs Argon2id with hash-wasm — the exact module the
 * desktop app uses. WKWebView has WebAssembly + JIT; Hermes has neither, and
 * the pure-JS fallback takes minutes for a 64 MiB derivation. Measured here:
 * this path is near-native (hundreds of ms).
 *
 * Mounted once at the root layout; registers itself as the crypto module's
 * Argon2 backend. If anything goes wrong (load failure, timeout), the backend
 * rejects and `deriveSessionKey` falls back to pure JS — slow, never broken.
 */

const DERIVE_TIMEOUT_MS = 30_000;

interface Pending {
  resolve(key: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>
${HASH_WASM_UMD}
window.__derive = function (id, password, salt, params) {
  hashwasm.argon2id({
    password: password,
    salt: salt,
    iterations: params.t,
    memorySize: params.m,
    parallelism: params.p,
    hashLength: params.dkLen,
    outputType: 'hex',
  }).then(function (hex) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, ok: true, hex: hex }));
  }).catch(function (error) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, ok: false, error: String(error) }));
  });
};
window.ReactNativeWebView.postMessage(JSON.stringify({ ready: true }));
</script></body></html>`;

export function Argon2WebView() {
  const webviewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef(new Map<number, Pending>());
  const queueRef = useRef<string[]>([]);
  const nextIdRef = useRef(1);

  useEffect(() => {
    const pending = pendingRef.current;

    setArgon2Backend((code, salt, params) => {
      return new Promise<Uint8Array>((resolve, reject) => {
        const id = nextIdRef.current++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('argon2 webview timed out'));
        }, DERIVE_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        const js = `window.__derive(${id}, ${JSON.stringify(code)}, ${JSON.stringify(salt)}, ${JSON.stringify(params)}); true;`;
        if (readyRef.current) {
          webviewRef.current?.injectJavaScript(js);
        } else {
          queueRef.current.push(js);
        }
      });
    });

    return () => {
      setArgon2Backend(null);
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error('argon2 webview unmounted'));
      }
      pending.clear();
    };
  }, []);

  function onMessage(event: WebViewMessageEvent) {
    let msg: { ready?: boolean; id?: number; ok?: boolean; hex?: string; error?: string };
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.ready) {
      readyRef.current = true;
      for (const js of queueRef.current) webviewRef.current?.injectJavaScript(js);
      queueRef.current = [];
      return;
    }
    if (typeof msg.id !== 'number') return;
    const entry = pendingRef.current.get(msg.id);
    if (!entry) return;
    pendingRef.current.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok && typeof msg.hex === 'string') {
      try {
        entry.resolve(hexToBytes(msg.hex));
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error('bad hex from webview'));
      }
    } else {
      entry.reject(new Error(msg.error ?? 'argon2 webview failed'));
    }
  }

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webviewRef}
        source={{ html: HTML }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={onMessage}
        // A crashed/killed webview must not strand pairing: drop ready state
        // so new requests queue, and let the timeout + pure-JS fallback cover
        // anything in flight.
        onContentProcessDidTerminate={() => {
          readyRef.current = false;
          webviewRef.current?.reload();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
    overflow: 'hidden',
  },
});
