import { useState } from 'react';
import type { KlipState } from '../types';

interface Props {
  state: KlipState;
  onClose: () => void;
}

const CLEAR_OPTIONS = [
  { value: 0, label: 'Never' },
  { value: 15, label: 'After 15 seconds' },
  { value: 30, label: 'After 30 seconds' },
  { value: 60, label: 'After 1 minute' },
  { value: 300, label: 'After 5 minutes' },
];

/** Styled dropdown — the native <select> popup can't be themed. */
function Select({
  value,
  options,
  onChange,
}: {
  value: number;
  options: { value: number; label: string }[];
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((state) => !state)}
        className={`flex w-full items-center justify-between rounded-xl border bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none transition-colors ${
          open ? 'border-indigo-500' : 'border-zinc-800 hover:border-zinc-700'
        }`}
      >
        {current.label}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <ul className="animate-rise absolute z-20 mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-xl shadow-black/50">
            {options.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                    option.value === value
                      ? 'bg-indigo-500/15 text-indigo-300'
                      : 'text-zinc-300 hover:bg-zinc-900'
                  }`}
                >
                  {option.label}
                  {option.value === value && <span className="text-[10px]">✓</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const SHORTCUTS: { action: string; keys: string[] }[] = [
  { action: 'Show / hide Klip (global)', keys: ['Ctrl', 'Shift', 'K'] },
  { action: 'Quick-paste palette (global)', keys: ['Ctrl', 'Shift', 'V'] },
  { action: 'Search history', keys: ['Ctrl', 'F'] },
  { action: 'Copy item 1–9', keys: ['Ctrl', '1…9'] },
  { action: 'Settings', keys: ['Ctrl', ','] },
];

export default function SettingsPanel({ state, onClose }: Props) {
  const [serverUrl, setServerUrl] = useState(state.serverUrl);
  const [deviceName, setDeviceName] = useState(state.deviceName);
  const [clearSeconds, setClearSeconds] = useState(state.clipboardClearSeconds);
  const [autoStart, setAutoStart] = useState(state.autoStart);
  const [error, setError] = useState('');

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const result = await window.klip.setServerUrl(serverUrl);
    if (!result.ok) {
      setError(result.error ?? 'Invalid server URL.');
      return;
    }
    await window.klip.setDeviceName(deviceName);
    await window.klip.setClipboardClear(clearSeconds);
    await window.klip.setAutoStart(autoStart);
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <form
        onSubmit={save}
        className="animate-rise absolute right-3 top-12 z-40 flex max-h-[calc(100vh-7rem)] w-80 flex-col gap-3 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl shadow-black/60"
      >
        <h2 className="font-display text-sm font-semibold text-zinc-200">Settings</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">Relay server URL</span>
          <input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="wss://relay.example.com"
            spellCheck={false}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 outline-none transition-colors focus:border-indigo-500"
          />
          <span className="text-[10px] leading-relaxed text-zinc-600">
            Plain <code>ws://</code> is only accepted for localhost and LAN addresses.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">This device's name</span>
          <input
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            placeholder="My laptop"
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none transition-colors focus:border-indigo-500"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">Auto-clear clipboard</span>
          <Select value={clearSeconds} options={CLEAR_OPTIONS} onChange={setClearSeconds} />
          <span className="text-[10px] leading-relaxed text-zinc-600">
            Clipboard hygiene for passwords: wipe the clipboard after a delay, unless something new was copied.
          </span>
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-400">Start with Windows</span>
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(event) => setAutoStart(event.target.checked)}
            className="h-4 w-4 accent-indigo-500"
          />
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="border-t border-zinc-800 pt-3">
          <p className="mb-2 text-xs font-medium text-zinc-400">Keyboard shortcuts</p>
          <ul className="flex flex-col gap-1.5">
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.action} className="flex items-center justify-between text-[11px] text-zinc-500">
                <span>{shortcut.action}</span>
                <span className="flex items-center gap-0.5">
                  {shortcut.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-indigo-500 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-400"
          >
            Save
          </button>
        </div>
      </form>
    </>
  );
}
