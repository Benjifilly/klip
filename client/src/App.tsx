import { useEffect, useState } from 'react';
import { Pause, Play, Settings } from 'lucide-react';
import type { KlipState } from './types';
import { accelKeys, statusMeta } from './status';
import Pairing from './components/Pairing';
import Dashboard from './components/Dashboard';
import SettingsPanel from './components/SettingsPanel';

/** Windows-style caption buttons, drawn by us instead of the native frame. */
function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!window.klip) return;
    return window.klip.onWindowState((state) => setMaximized(state.maximized));
  }, []);

  const base = 'no-drag flex h-10 w-11 items-center justify-center transition-colors';

  return (
    <div className="flex items-stretch self-stretch">
      <button
        onClick={() => window.klip.windowControl('minimize')}
        className={`${base} text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100`}
        title="Minimize"
        aria-label="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        onClick={() => window.klip.windowControl('maximize')}
        className={`${base} text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100`}
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
            <path d="M2.5 2.5V.5h7v7h-2" />
            <rect x=".5" y="2.5" width="7" height="7" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
            <rect x=".5" y=".5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button
        onClick={() => window.klip.windowControl('close')}
        className={`${base} text-zinc-400 hover:bg-[#e81123] hover:text-white`}
        title="Close — Klip keeps running in the tray"
        aria-label="Close to tray"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<KlipState | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let unsubscribe = () => {};
    if (window.klip) {
      window.klip.getState().then(setState);
      unsubscribe = window.klip.onState(setState);
    }
    return unsubscribe;
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowSettings(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setShowSettings((value) => !value);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!window.klip) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Klip must run inside Electron — use <code className="mx-1 text-klip-300">npm run dev</code>
      </div>
    );
  }

  if (!state) return <div className="h-screen bg-zinc-950" />;

  const status = statusMeta(state);
  const statusTooltip = state.sessionCode
    ? `${status.label} · ${Math.max(state.peerCount, 1)} device${state.peerCount > 1 ? 's' : ''}`
    : status.label;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100 antialiased">
      {/* Ambient glow behind the whole app */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-72 bg-[radial-gradient(70%_100%_at_50%_0%,color-mix(in_srgb,var(--color-klip-500)_10%,transparent),transparent_70%)]"
      />

      <header className="titlebar-drag relative z-20 shrink-0 border-b border-zinc-900/80">
        <div className="flex h-10 items-center justify-between pl-3.5">
          <div className="flex items-center gap-2" title={statusTooltip}>
            <h1 className="wordmark text-sm">Klip</h1>
            <span
              className={`h-2 w-2 rounded-full ring-2 ring-zinc-950 ${status.dot}`}
              role="status"
              aria-label={statusTooltip}
            />
          </div>

          <div className="flex items-center">
            {state.sessionCode && (
              <button
                onClick={() => window.klip.setPaused(!state.paused)}
                className={`no-drag rounded-lg p-1.5 transition-colors hover:bg-zinc-900 ${
                  state.paused ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title={state.paused ? 'Resume sync' : 'Pause sync'}
                aria-label={state.paused ? 'Resume sync' : 'Pause sync'}
              >
                {state.paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
              </button>
            )}
            <button
              onClick={() => setShowSettings((value) => !value)}
              className={`no-drag rounded-lg p-1.5 transition-colors hover:bg-zinc-900 hover:text-zinc-200 ${
                showSettings ? 'text-klip-400' : 'text-zinc-400'
              }`}
              title="Settings (Ctrl+,)"
              aria-label="Settings"
              aria-expanded={showSettings}
            >
              <Settings size={15} aria-hidden />
            </button>
            <div className="mx-1.5 h-4 w-px bg-zinc-800" aria-hidden />
            <WindowControls />
          </div>
        </div>
      </header>

      {showSettings && <SettingsPanel state={state} onClose={() => setShowSettings(false)} />}

      <main className="relative z-10 flex-1 overflow-y-auto px-5 pb-6">
        {state.sessionCode ? <Dashboard state={state} /> : <Pairing />}
      </main>

      <footer className="relative z-10 flex shrink-0 items-center justify-center gap-2.5 border-t border-zinc-900/80 px-4 py-1 text-[10px] text-zinc-400">
        <span>
          {accelKeys(state.shortcuts.toggle).map((key, i) => (
            <span key={key}>
              {i > 0 && '+'}
              <kbd>{key}</kbd>
            </span>
          ))}{' '}
          show/hide
        </span>
        <span>
          {accelKeys(state.shortcuts.palette).map((key, i) => (
            <span key={key}>
              {i > 0 && '+'}
              <kbd>{key}</kbd>
            </span>
          ))}{' '}
          quick paste
        </span>
        {state.sessionCode && (
          <span>
            <kbd>Ctrl</kbd>+<kbd>F</kbd> search
          </span>
        )}
      </footer>
    </div>
  );
}
