import { useEffect, useState } from 'react';
import type { KlipState } from './types';
import { statusMeta } from './status';
import Pairing from './components/Pairing';
import Dashboard from './components/Dashboard';
import SettingsPanel from './components/SettingsPanel';
import appIcon from '../assets/icon.png';

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1.5" />
      <rect x="14" y="4" width="4" height="16" rx="1.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 4.5a1.5 1.5 0 0 1 2.27-1.29l12 7.5a1.5 1.5 0 0 1 0 2.58l-12 7.5A1.5 1.5 0 0 1 7 19.5z" />
    </svg>
  );
}

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
        <svg width="10" height="10" viewBox="0 0 10 10">
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
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M2.5 2.5V.5h7v7h-2" />
            <rect x=".5" y="2.5" width="7" height="7" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
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
        <svg width="10" height="10" viewBox="0 0 10 10">
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
        Klip must run inside Electron — use <code className="mx-1 text-indigo-300">npm run dev</code>
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
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-72 bg-[radial-gradient(70%_100%_at_50%_0%,rgba(99,102,241,0.10),transparent_70%)]"
      />

      <header className="titlebar-drag relative z-20 shrink-0 border-b border-zinc-900/80">
        <div className="flex h-10 items-center justify-between pl-3.5">
          <div className="flex items-center gap-2" title={statusTooltip}>
            <span className="relative">
              <img src={appIcon} alt="" className="h-5 w-5" draggable={false} />
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-zinc-950 ${status.dot}`}
              />
            </span>
            <h1 className="wordmark text-sm">Klip</h1>
          </div>

          <div className="flex items-center">
            {state.sessionCode && (
              <button
                onClick={() => window.klip.setPaused(!state.paused)}
                className={`no-drag rounded-lg p-1.5 transition-colors hover:bg-zinc-900 ${
                  state.paused ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-500 hover:text-zinc-200'
                }`}
                title={state.paused ? 'Resume sync' : 'Pause sync'}
                aria-label={state.paused ? 'Resume sync' : 'Pause sync'}
              >
                {state.paused ? <PlayIcon /> : <PauseIcon />}
              </button>
            )}
            <button
              onClick={() => setShowSettings((value) => !value)}
              className={`no-drag rounded-lg p-1.5 transition-colors hover:bg-zinc-900 hover:text-zinc-200 ${
                showSettings ? 'text-indigo-400' : 'text-zinc-500'
              }`}
              title="Settings (Ctrl+,)"
              aria-label="Settings"
            >
              <GearIcon />
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

      <footer className="relative z-10 flex shrink-0 items-center justify-center gap-3 border-t border-zinc-900/80 px-4 py-1.5 text-[10px] text-zinc-600">
        <span>
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> show/hide
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> quick paste
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
