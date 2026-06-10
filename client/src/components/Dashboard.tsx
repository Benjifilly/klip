import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Clipboard,
  Copy,
  FileText,
  Image as ImageIcon,
  MonitorSmartphone,
  Paperclip,
  Pin,
  Search,
  Trash2,
} from 'lucide-react';
import QRCode from 'qrcode';
import type { ClipItem, KlipState } from '../types';
import { statusMeta } from '../status';
import { useDialogA11y } from '../useDialogA11y';

type Filter = 'all' | 'links' | 'images' | 'files' | 'received' | 'sent';

const FILTERS: { id: Filter; label: ReactNode; title: string }[] = [
  { id: 'all', label: 'All', title: 'Everything' },
  { id: 'links', label: 'Links', title: 'Links only' },
  { id: 'images', label: <ImageIcon size={12} aria-hidden />, title: 'Images only' },
  { id: 'files', label: <FileText size={12} aria-hidden />, title: 'Files only' },
  { id: 'received', label: <ArrowDown size={12} aria-hidden />, title: 'Received only' },
  { id: 'sent', label: <ArrowUp size={12} aria-hidden />, title: 'Sent only' },
];

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const isUrl = (text: string) => /^https?:\/\/\S+$/.test(text.trim());

interface ItemProps {
  item: ClipItem;
  index: number;
  copied: boolean;
  onCopy: (item: ClipItem) => void;
}

/* Hover-revealed actions also surface on keyboard focus (group-focus-within). */
const reveal = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100';

function HistoryItem({ item, index, copied, onCopy }: ItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const received = item.direction === 'received';
  const link = item.type === 'text' && isUrl(item.text ?? '');

  // Measure whether line-clamp actually truncates (and re-measure on resize),
  // so "Show more" only appears when there is really more to show.
  useEffect(() => {
    const el = textRef.current;
    if (!el || item.type !== 'text') return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.text, item.type, expanded]);

  return (
    <li
      className={`group animate-rise rounded-xl border bg-zinc-900/50 p-3.5 transition-colors hover:bg-zinc-900/80 ${
        item.pinned ? 'border-klip-500/30 hover:border-klip-500/50' : 'border-zinc-800/80 hover:border-zinc-700'
      }`}
    >
      <button
        type="button"
        onClick={() => onCopy(item)}
        title={item.type === 'file' ? 'Click to save to disk' : 'Click to copy'}
        className="block w-full cursor-pointer rounded-md text-left"
      >
        {item.type === 'image' ? (
          <img
            src={item.thumb}
            alt={`Clipboard image from ${item.deviceName}`}
            draggable={false}
            className="max-h-20 rounded-lg border border-zinc-800"
          />
        ) : item.type === 'file' ? (
          <span className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-400">
              <FileText size={16} aria-hidden />
            </span>
            <span className="truncate text-sm font-medium text-zinc-200">{item.name}</span>
          </span>
        ) : (
          /*
           * Collapsed: ~3.5 lines, the partial 4th fading to transparent via
           * mask-image (works on any background — nothing is painted on top).
           * Expanding animates max-height; past ~290px it scrolls internally.
           */
          <span
            ref={textRef}
            className={`block break-words whitespace-pre-wrap text-sm leading-relaxed text-zinc-200 transition-[max-height] duration-300 ease-out ${
              expanded ? 'overflow-y-auto pr-1' : 'overflow-hidden'
            } ${
              !expanded && clamped
                ? '[mask-image:linear-gradient(to_bottom,black_58%,transparent_97%)]'
                : ''
            }`}
            style={{ maxHeight: expanded ? '18rem' : '5.6em' }}
          >
            {item.text}
          </span>
        )}
      </button>
      {(clamped || expanded) && item.type === 'text' && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-klip-400 transition-colors hover:text-klip-300"
        >
          {expanded ? 'Show less' : 'Show more'}
          <ChevronDown
            size={11}
            aria-hidden
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-400">
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${
              received ? 'bg-klip-500/15 text-klip-300' : 'bg-zinc-800 text-zinc-400'
            }`}
            title={received ? 'Received' : 'Sent'}
          >
            {received ? <ArrowDown size={10} aria-label="Received" /> : <ArrowUp size={10} aria-label="Sent" />}
          </span>
          <span className="truncate">
            {item.deviceName} · {timeAgo(item.ts)}
          </span>
          {link && (
            <span className="shrink-0 rounded-md bg-klip-500/15 px-1.5 py-0.5 text-[10px] font-medium text-klip-300">
              link
            </span>
          )}
          {(item.type === 'image' || item.type === 'file') && (
            <span className="shrink-0 rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
              {(item.bytes ?? 0) >= 1024 * 1024
                ? `${((item.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`
                : `${Math.max(1, Math.round((item.bytes ?? 0) / 1024))} KB`}
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-1">
          {index < 9 && item.type !== 'file' && (
            <kbd className={`transition-opacity ${reveal}`}>Ctrl+{index + 1}</kbd>
          )}
          {link && (
            <button
              onClick={() => window.klip.openUrl((item.text ?? '').trim())}
              className={`rounded-lg bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-300 transition-all hover:bg-zinc-700 ${reveal}`}
              title="Open in browser"
            >
              Open
            </button>
          )}
          {item.type === 'file' ? (
            <button
              onClick={() => window.klip.saveFile(item.id)}
              className={`rounded-lg bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-300 transition-all hover:bg-zinc-700 ${reveal}`}
              title="Save to disk"
            >
              Save
            </button>
          ) : (
            <button
              onClick={() => onCopy(item)}
              className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-all ${
                copied
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : `bg-zinc-800 text-zinc-300 hover:bg-zinc-700 ${reveal}`
              }`}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          )}
          <button
            onClick={() => window.klip.togglePin(item.id)}
            className={`rounded-lg p-1.5 transition-all ${
              item.pinned
                ? 'bg-klip-500/15 text-klip-300 hover:bg-klip-500/25'
                : `bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 ${reveal}`
            }`}
            title={item.pinned ? 'Unpin' : 'Pin — survives "Clear all"'}
            aria-label={item.pinned ? 'Unpin item' : 'Pin item'}
          >
            <Pin size={12} fill={item.pinned ? 'currentColor' : 'none'} aria-hidden />
          </button>
          <button
            onClick={() => window.klip.deleteItem(item.id)}
            className={`rounded-lg bg-zinc-800 p-1.5 text-zinc-400 transition-all hover:bg-red-500/15 hover:text-red-400 ${reveal}`}
            title="Delete"
            aria-label="Delete item"
          >
            <Trash2 size={12} aria-hidden />
          </button>
        </span>
      </div>
    </li>
  );
}

/**
 * Devices panel: who is in the session (from encrypted presence packets),
 * with freshness, plus the only management actions a shared-key E2EE design
 * allows — renaming this device and rotating the code to shake off intruders.
 */
function DevicesModal({ state, onClose }: { state: KlipState; onClose: () => void }) {
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Devices in this session"
        className="animate-rise flex w-80 flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="font-display flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <MonitorSmartphone size={15} aria-hidden className="text-klip-400" />
          Devices in this session
        </h3>

        <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {state.devices.map((device) => (
            <li
              key={device.id}
              className="flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 px-3 py-2"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${device.online ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                title={device.online ? 'Online' : 'Offline'}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-200">{device.name}</span>
                <span className="block text-[10px] text-zinc-500">
                  {device.self
                    ? 'This device — rename it in Settings'
                    : device.online
                      ? 'Online'
                      : `Last seen ${timeAgo(device.lastSeen)}`}
                </span>
              </span>
              {device.self && (
                <span className="shrink-0 rounded-md bg-klip-500/15 px-1.5 py-0.5 text-[10px] font-medium text-klip-300">
                  you
                </span>
              )}
            </li>
          ))}
        </ul>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          Devices announce themselves through encrypted packets — the relay can't see this list. If a
          device you don't recognize shows up, <strong className="font-medium text-zinc-400">rotate the
          code</strong> and create a fresh session out-of-band if it follows.
        </p>

        <button
          onClick={onClose}
          className="self-end rounded-lg bg-zinc-800 px-4 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function QrModal({ state, onClose }: { state: KlipState; onClose: () => void }) {
  const [src, setSrc] = useState('');
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose);

  useEffect(() => {
    const uri = `klip://join?code=${encodeURIComponent(state.sessionCode)}&relay=${encodeURIComponent(state.serverUrl)}`;
    QRCode.toDataURL(uri, { width: 232, margin: 1, color: { dark: '#09090b', light: '#ffffff' } }).then(setSrc);
  }, [state.sessionCode, state.serverUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Session QR code"
        className="animate-rise flex flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="font-display text-sm font-semibold text-zinc-200">Scan to join this session</h3>
        {src && <img src={src} alt="Session QR code" className="rounded-xl" draggable={false} />}
        <code className="font-mono text-xs tracking-wide text-klip-300">{state.sessionCode}</code>
        <p className="max-w-60 text-center text-xs leading-relaxed text-zinc-400">
          Anyone scanning this joins your session — share it like a password.
        </p>
        <button
          onClick={onClose}
          className="mt-1 rounded-lg bg-zinc-800 px-4 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default function Dashboard({ state }: { state: KlipState }) {
  const [codeCopied, setCodeCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showQr, setShowQr] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [fileError, setFileError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef(0);
  const rotateTimer = useRef(0);
  const errorTimer = useRef(0);
  const status = statusMeta(state);

  function reportFileError(message: string) {
    setFileError(message);
    window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setFileError(''), 5000);
  }

  async function attachFile() {
    const result = await window.klip.attachFile();
    if (!result.ok) reportFileError(result.error ?? 'Could not send the file.');
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDropping(false);
    window.klip.sendDroppedFiles(Array.from(event.dataTransfer.files).slice(0, 5)).then((results) => {
      const failed = results.find((result) => !result.ok);
      if (failed) reportFileError(failed.error ?? 'Could not send the file.');
    });
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = state.history.filter((item) => {
      if (filter === 'links' && !(item.type === 'text' && isUrl(item.text ?? ''))) return false;
      if (filter === 'images' && item.type !== 'image') return false;
      if (filter === 'files' && item.type !== 'file') return false;
      if (filter === 'received' && item.direction !== 'received') return false;
      if (filter === 'sent' && item.direction !== 'sent') return false;
      if (
        q &&
        !(item.text ?? '').toLowerCase().includes(q) &&
        !(item.name ?? '').toLowerCase().includes(q) &&
        !item.deviceName.toLowerCase().includes(q) &&
        !(item.type === 'image' && 'image'.includes(q))
      ) {
        return false;
      }
      return true;
    });
    // Pinned clips float to the top, newest-first within each group.
    return [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [state.history, query, filter]);

  function copyItem(item: ClipItem) {
    if (item.type === 'file') {
      window.klip.saveFile(item.id);
      return;
    }
    window.klip.copyEntry(item.id);
    setCopiedId(item.id);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopiedId(null), 1400);
  }

  async function copyCode() {
    await window.klip.copyItem(state.sessionCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }

  function rotate() {
    if (!confirmRotate) {
      setConfirmRotate(true);
      window.clearTimeout(rotateTimer.current);
      rotateTimer.current = window.setTimeout(() => setConfirmRotate(false), 5000);
      return;
    }
    window.clearTimeout(rotateTimer.current);
    setConfirmRotate(false);
    window.klip.rotateSession();
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (mod && /^[1-9]$/.test(event.key)) {
        const item = visible[Number(event.key) - 1];
        if (item) {
          event.preventDefault();
          copyItem(item);
        }
      } else if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  return (
    <div
      className="relative mt-4 flex flex-col gap-4"
      onDragOver={(event) => {
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      {/* Screen-reader announcements: copy feedback and file errors. */}
      <div role="status" aria-live="polite" className="sr-only">
        {fileError || (copiedId ? 'Copied to clipboard' : '')}
      </div>

      {dropping && (
        <div className="pointer-events-none absolute -inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-klip-500/60 bg-zinc-950/80 backdrop-blur-[1px]">
          <p className="font-display text-sm font-semibold text-klip-300">
            Drop to send — max 20 MB per file
          </p>
        </div>
      )}

      {state.pendingRotation && (
        <div className="animate-rise flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300">
          <span>
            <strong>{state.pendingRotation.deviceName}</strong> rotated the session code. Switch to the new
            session?
          </span>
          <span className="flex shrink-0 gap-2">
            <button
              onClick={() => window.klip.resolveRotation(true)}
              className="rounded-lg bg-amber-500/20 px-2.5 py-1 font-semibold transition-colors hover:bg-amber-500/30"
            >
              Switch
            </button>
            <button
              onClick={() => window.klip.resolveRotation(false)}
              className="rounded-lg px-2 py-1 transition-colors hover:text-amber-100"
            >
              Ignore
            </button>
          </span>
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900/90 to-zinc-900/40 px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-400">Session</p>
          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden />
            {status.label} · {Math.max(state.peerCount, 1)} device{state.peerCount > 1 ? 's' : ''}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="truncate font-mono text-sm tracking-wide text-klip-300">{state.sessionCode}</code>
          <button
            onClick={copyCode}
            className={`shrink-0 rounded-md p-1 text-xs transition-colors ${
              codeCopied ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Copy session code"
            aria-label="Copy session code"
          >
            {codeCopied ? '✓ copied' : <Copy size={12} aria-hidden />}
          </button>
          {state.fingerprint.length > 0 && (
            <span
              className="ml-auto shrink-0 cursor-default text-sm tracking-wide"
              title="Session fingerprint — every paired device shows the same four emojis. If they differ, you are not in the same session."
            >
              {state.fingerprint.join('')}
            </span>
          )}
        </div>
        {state.devices.length > 1 && (
          <button
            onClick={() => setShowDevices(true)}
            className="mt-1.5 block max-w-full truncate text-left text-xs text-zinc-400 transition-colors hover:text-zinc-200"
            title="Manage the devices in this session"
          >
            Connected with: {state.devices.filter((device) => !device.self).map((device) => device.name).join(', ')}
          </button>
        )}
        <div className="mt-2.5 flex items-center gap-2 border-t border-zinc-800/60 pt-2.5">
          <button
            onClick={() => setShowQr(true)}
            className="rounded-lg bg-zinc-800/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            QR code
          </button>
          <button
            onClick={() => setShowDevices(true)}
            className="rounded-lg bg-zinc-800/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            title="Devices in this session"
          >
            Devices
          </button>
          <button
            onClick={rotate}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
              confirmRotate
                ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'
            }`}
            title="Generate a fresh code and move every connected device to it"
          >
            {confirmRotate ? 'Confirm rotate?' : 'Rotate code'}
          </button>
          <button
            onClick={() => window.klip.leaveSession()}
            className="ml-auto rounded-lg px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            Leave
          </button>
        </div>
        {confirmRotate && (
          <p className="mt-2 text-xs leading-relaxed text-amber-300/80">
            Rotation refreshes a leaked code, but anyone already holding the current one is asked to
            follow — it does not evict them. To truly start clean, leave and create a new session.
          </p>
        )}
      </div>

      {state.paused && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-300">
          <span>Sync is paused — nothing is sent or received.</span>
          <button
            onClick={() => window.klip.setPaused(false)}
            className="font-semibold transition-colors hover:text-amber-100"
          >
            Resume
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden>
            <Search size={13} />
          </span>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search history…"
            aria-label="Search history"
            spellCheck={false}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 py-2 pl-9 pr-3 text-xs text-zinc-200 placeholder:text-zinc-500 outline-none transition-colors focus:border-klip-500"
          />
        </div>
        <div className="flex shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/60 p-0.5" role="group" aria-label="Filter history">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              title={f.title}
              aria-label={f.title}
              aria-pressed={filter === f.id}
              className={`flex items-center rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                filter === f.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={attachFile}
          title="Send a file to your devices (max 20 MB) — or drop one anywhere"
          aria-label="Send a file"
          className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
        >
          <Paperclip size={13} aria-hidden />
        </button>
      </div>

      {fileError && (
        <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2 text-xs text-red-300">
          {fileError}
        </div>
      )}

      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="font-display flex items-center gap-2 text-sm font-semibold text-zinc-300">
            History
            {state.history.length > 0 && (
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                {visible.length === state.history.length ? state.history.length : `${visible.length}/${state.history.length}`}
              </span>
            )}
          </h2>
          {state.history.length > 0 && (
            <button
              onClick={() => window.klip.clearHistory()}
              className="text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
              title="Pinned clips are kept"
            >
              Clear all
            </button>
          )}
        </div>

        {state.history.length === 0 ? (
          <div className="animate-rise rounded-2xl border border-dashed border-zinc-800 py-14 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-zinc-500">
              <Clipboard size={18} aria-hidden />
            </div>
            <p className="text-sm text-zinc-400">Nothing here yet.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Copy text, take a screenshot, or drop a file — it appears here and on your other devices, instantly.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 py-10 text-center">
            <p className="text-sm text-zinc-400">No matches.</p>
            <button
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
              className="mt-1 text-xs text-klip-400 transition-colors hover:text-klip-300"
            >
              Reset search & filters
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((item, index) => (
              <HistoryItem
                key={item.id}
                item={item}
                index={index}
                copied={copiedId === item.id}
                onCopy={copyItem}
              />
            ))}
          </ul>
        )}
      </section>

      {showQr && <QrModal state={state} onClose={() => setShowQr(false)} />}
      {showDevices && <DevicesModal state={state} onClose={() => setShowDevices(false)} />}
    </div>
  );
}
