import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown, TriangleAlert } from 'lucide-react';
import type { AutoCopyMode, KlipState } from '../types';
import { accelKeys } from '../status';
import { useDialogA11y } from '../useDialogA11y';

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

const AUTO_COPY_OPTIONS: { value: AutoCopyMode; label: string }[] = [
  { value: 'all', label: 'Text and images' },
  { value: 'text', label: 'Text only' },
  { value: 'off', label: 'Never — history only' },
];

/**
 * Styled dropdown — the native <select> popup can't be themed. Implements the
 * listbox keyboard pattern: ↑/↓ to move, Enter/Space to pick, Esc to close.
 */
function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useRef(`select-${Math.random().toString(36).slice(2, 8)}`).current;
  const current = options.find((option) => option.value === value) ?? options[0];

  function openList() {
    setActive(Math.max(options.findIndex((option) => option.value === value), 0));
    setOpen(true);
  }

  function pick(option: { value: T; label: string }) {
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(options[active]);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        className={`flex w-full items-center justify-between rounded-xl border bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none transition-colors ${
          open ? 'border-klip-500' : 'border-zinc-800 hover:border-zinc-700'
        }`}
      >
        {current.label}
        <ChevronDown
          size={12}
          aria-hidden
          className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="animate-rise absolute z-20 mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-xl shadow-black/50"
          >
            {options.map((option, index) => (
              <li key={String(option.value)} role="presentation">
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => pick(option)}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                    option.value === value
                      ? 'bg-klip-500/15 text-klip-300'
                      : index === active
                        ? 'bg-zinc-900 text-zinc-200'
                        : 'text-zinc-300 hover:bg-zinc-900'
                  }`}
                >
                  {option.label}
                  {option.value === value && <Check size={10} aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Custom animated checkbox: the brand color fades in while the tick draws
 * itself (stroke-dashoffset) with a small pop; unchecking plays it backwards.
 * A real (visually hidden) <input> underneath keeps keyboard & SR behavior.
 */
function Checkbox({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <span className="relative inline-flex h-4.5 w-4.5 shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0"
      />
      <span
        aria-hidden
        className={`flex h-full w-full items-center justify-center rounded-md border transition-all duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-klip-400 ${
          checked
            ? 'animate-pop border-klip-500 bg-klip-500 shadow-sm shadow-klip-500/40'
            : 'border-zinc-700 bg-zinc-950 peer-hover:border-zinc-500'
        }`}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.5 5 9l4.5-5.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="12"
            strokeDashoffset={checked ? 0 : 12}
            className="transition-[stroke-dashoffset] duration-200 ease-out"
          />
        </svg>
      </span>
    </span>
  );
}

/** Press the desired combination inside the field to record a global shortcut. */
function ShortcutInput({ value, onChange, label }: { value: string; onChange: (accel: string) => void; label: string }) {
  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Tab') return; // keep keyboard navigation working
    event.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
    if (!event.ctrlKey && !event.altKey && !event.metaKey) return; // a modifier is required
    let key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (key === ' ') key = 'Space';
    if (!/^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/.test(key)) return;
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    parts.push(key);
    onChange(parts.join('+'));
  }

  return (
    <input
      value={accelKeys(value).join('+')}
      onKeyDown={onKeyDown}
      onChange={() => {}}
      aria-label={`${label} shortcut — press the new key combination`}
      title="Click, then press the new key combination"
      spellCheck={false}
      className="w-36 cursor-pointer rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-center font-mono text-[11px] text-zinc-200 outline-none transition-colors focus:border-klip-500"
    />
  );
}

export default function SettingsPanel({ state, onClose }: Props) {
  const [serverUrl, setServerUrl] = useState(state.serverUrl);
  const [deviceName, setDeviceName] = useState(state.deviceName);
  const [clearSeconds, setClearSeconds] = useState(state.clipboardClearSeconds);
  const [autoStart, setAutoStart] = useState(state.autoStart);
  const [autoCopy, setAutoCopy] = useState<AutoCopyMode>(state.autoCopy);
  const [notifyOnReceive, setNotifyOnReceive] = useState(state.notifyOnReceive);
  const [syncKinds, setSyncKinds] = useState({
    text: state.syncText,
    images: state.syncImages,
    files: state.syncFiles,
  });
  const [shortcuts, setShortcuts] = useState(state.shortcuts);
  const [error, setError] = useState('');
  const dialogRef = useDialogA11y<HTMLFormElement>(onClose);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const urlResult = await window.klip.setServerUrl(serverUrl);
    if (!urlResult.ok) {
      setError(urlResult.error ?? 'Invalid server URL.');
      return;
    }
    const shortcutResult = await window.klip.setShortcuts(shortcuts);
    if (!shortcutResult.ok) {
      setError(shortcutResult.error ?? 'Could not register the shortcuts.');
      return;
    }
    await window.klip.setDeviceName(deviceName);
    await window.klip.setClipboardClear(clearSeconds);
    await window.klip.setAutoStart(autoStart);
    await window.klip.setAutoCopy(autoCopy);
    await window.klip.setNotifyOnReceive(notifyOnReceive);
    await window.klip.setSyncKinds(syncKinds);
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <form
        ref={dialogRef}
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="animate-rise absolute right-3 top-12 z-40 flex max-h-[calc(100vh-7rem)] w-80 flex-col gap-3 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl shadow-black/60"
      >
        <h2 className="font-display text-sm font-semibold text-zinc-200">Settings</h2>

        {!state.atRestEncrypted && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
            <TriangleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              OS keychain unavailable — settings and history are stored <strong>unencrypted</strong> on this
              disk. Sync stays end-to-end encrypted.
            </span>
          </div>
        )}

        {state.shortcutErrors.length > 0 && (
          <div role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
            {state.shortcutErrors.join(' ')}
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">Relay server URL</span>
          <input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="wss://relay.example.com"
            spellCheck={false}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 outline-none transition-colors focus:border-klip-500"
          />
          <span className="text-[11px] leading-relaxed text-zinc-500">
            Plain <code>ws://</code> is only accepted for localhost and LAN addresses.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">This device's name</span>
          <input
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            placeholder="My laptop"
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none transition-colors focus:border-klip-500"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">Write received clips to the clipboard</span>
          <Select value={autoCopy} options={AUTO_COPY_OPTIONS} onChange={setAutoCopy} label="Write received clips to the clipboard" />
          <span className="text-[11px] leading-relaxed text-zinc-500">
            “History only” keeps remote clips out of your clipboard until you copy them yourself.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400">Auto-clear clipboard</span>
          <Select value={clearSeconds} options={CLEAR_OPTIONS} onChange={setClearSeconds} label="Auto-clear clipboard" />
          <span className="text-[11px] leading-relaxed text-zinc-500">
            Clipboard hygiene: wipe the clipboard after a delay, unless something new was copied. Copies
            tagged by password managers are never captured at all.
          </span>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-zinc-400">Send from this device</legend>
          <div className="flex items-center gap-4">
            {(
              [
                ['text', 'Text'],
                ['images', 'Images'],
                ['files', 'Files'],
              ] as const
            ).map(([kind, label]) => (
              <label key={kind} className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300">
                <Checkbox
                  checked={syncKinds[kind]}
                  onChange={(checked) => setSyncKinds((value) => ({ ...value, [kind]: checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-400">Notify when a clip arrives</span>
          <Checkbox checked={notifyOnReceive} onChange={setNotifyOnReceive} />
        </label>

        <label className="flex cursor-pointer items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-400">Start with Windows</span>
          <Checkbox checked={autoStart} onChange={setAutoStart} />
        </label>

        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

        <div className="border-t border-zinc-800 pt-3">
          <p className="mb-2 text-xs font-medium text-zinc-400">Keyboard shortcuts</p>
          <ul className="flex flex-col gap-1.5">
            <li className="flex items-center justify-between text-xs text-zinc-400">
              <span>Show / hide Klip (global)</span>
              <ShortcutInput
                value={shortcuts.toggle}
                onChange={(accel) => setShortcuts((value) => ({ ...value, toggle: accel }))}
                label="Show / hide Klip"
              />
            </li>
            <li className="flex items-center justify-between text-xs text-zinc-400">
              <span>Quick-paste palette (global)</span>
              <ShortcutInput
                value={shortcuts.palette}
                onChange={(accel) => setShortcuts((value) => ({ ...value, palette: accel }))}
                label="Quick-paste palette"
              />
            </li>
            {(
              [
                ['Search history', ['Ctrl', 'F']],
                ['Copy item 1–9', ['Ctrl', '1…9']],
                ['Settings', ['Ctrl', ',']],
              ] as const
            ).map(([action, keys]) => (
              <li key={action} className="flex items-center justify-between text-xs text-zinc-400">
                <span>{action}</span>
                <span className="flex items-center gap-0.5">
                  {keys.map((key) => (
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
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-klip-500 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-klip-400"
          >
            Save
          </button>
        </div>
      </form>
    </>
  );
}
