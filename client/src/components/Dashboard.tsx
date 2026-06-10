import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { ClipItem, KlipState } from '../types';
import { statusMeta } from '../status';

type Filter = 'all' | 'links' | 'received' | 'sent';

const FILTERS: { id: Filter; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Everything' },
  { id: 'links', label: 'Links', title: 'Links only' },
  { id: 'received', label: '↓', title: 'Received only' },
  { id: 'sent', label: '↑', title: 'Sent only' },
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

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
    </svg>
  );
}

interface ItemProps {
  item: ClipItem;
  index: number;
  copied: boolean;
  onCopy: (item: ClipItem) => void;
}

function HistoryItem({ item, index, copied, onCopy }: ItemProps) {
  const received = item.direction === 'received';
  const link = item.type === 'text' && isUrl(item.text ?? '');

  return (
    <li
      className={`group animate-rise rounded-xl border bg-zinc-900/50 p-3.5 transition-colors hover:bg-zinc-900/80 ${
        item.pinned ? 'border-indigo-500/30 hover:border-indigo-500/50' : 'border-zinc-800/80 hover:border-zinc-700'
      }`}
    >
      {item.type === 'image' ? (
        <img
          src={item.thumb}
          alt="Clipboard image"
          draggable={false}
          className="max-h-20 rounded-lg border border-zinc-800"
        />
      ) : item.type === 'file' ? (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-400">
            <FileIcon />
          </span>
          <span className="truncate text-sm font-medium text-zinc-200">{item.name}</span>
        </div>
      ) : (
        <p className="line-clamp-3 break-words whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
          {item.text}
        </p>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
              received ? 'bg-indigo-500/15 text-indigo-300' : 'bg-zinc-800 text-zinc-500'
            }`}
            title={received ? 'Received' : 'Sent'}
          >
            {received ? '↓' : '↑'}
          </span>
          <span className="truncate">
            {item.deviceName} · {timeAgo(item.ts)}
          </span>
          {link && (
            <span className="shrink-0 rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
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
            <kbd className="opacity-0 transition-opacity group-hover:opacity-100">Ctrl+{index + 1}</kbd>
          )}
          {link && (
            <button
              onClick={() => window.klip.openUrl((item.text ?? '').trim())}
              className="rounded-lg bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-300 opacity-0 transition-all hover:bg-zinc-700 group-hover:opacity-100"
              title="Open in browser"
            >
              Open
            </button>
          )}
          {item.type === 'file' ? (
            <button
              onClick={() => window.klip.saveFile(item.id)}
              className="rounded-lg bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-300 opacity-0 transition-all hover:bg-zinc-700 group-hover:opacity-100"
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
                  : 'bg-zinc-800 text-zinc-300 opacity-0 hover:bg-zinc-700 group-hover:opacity-100'
              }`}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          )}
          <button
            onClick={() => window.klip.togglePin(item.id)}
            className={`rounded-lg p-1.5 transition-all ${
              item.pinned
                ? 'bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25'
                : 'bg-zinc-800 text-zinc-500 opacity-0 hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100'
            }`}
            title={item.pinned ? 'Unpin' : 'Pin — survives "Clear all"'}
            aria-label={item.pinned ? 'Unpin item' : 'Pin item'}
          >
            <PinIcon filled={item.pinned} />
          </button>
          <button
            onClick={() => window.klip.deleteItem(item.id)}
            className="rounded-lg bg-zinc-800 p-1.5 text-zinc-500 opacity-0 transition-all hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
            title="Delete"
            aria-label="Delete item"
          >
            <TrashIcon />
          </button>
        </span>
      </div>
    </li>
  );
}

function QrModal({ state, onClose }: { state: KlipState; onClose: () => void }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    const uri = `klip://join?code=${encodeURIComponent(state.sessionCode)}&relay=${encodeURIComponent(state.serverUrl)}`;
    QRCode.toDataURL(uri, { width: 232, margin: 1, color: { dark: '#09090b', light: '#ffffff' } }).then(setSrc);
  }, [state.sessionCode, state.serverUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="animate-rise flex flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="font-display text-sm font-semibold text-zinc-200">Scan to join this session</h3>
        {src && <img src={src} alt="Session QR code" className="rounded-xl" draggable={false} />}
        <code className="font-mono text-xs tracking-wide text-indigo-300">{state.sessionCode}</code>
        <p className="max-w-60 text-center text-[11px] leading-relaxed text-zinc-500">
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
    for (const file of Array.from(event.dataTransfer.files).slice(0, 5)) {
      const filePath = window.klip.getPathForFile(file);
      window.klip.sendFile(filePath).then((result) => {
        if (!result.ok) reportFileError(result.error ?? 'Could not send the file.');
      });
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = state.history.filter((item) => {
      if (filter === 'links' && !(item.type === 'text' && isUrl(item.text ?? ''))) return false;
      if (filter === 'received' && item.direction !== 'received') return false;
      if (filter === 'sent' && item.direction !== 'sent') return false;
      if (
        q &&
        !(item.text ?? '').toLowerCase().includes(q) &&
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
      rotateTimer.current = window.setTimeout(() => setConfirmRotate(false), 3000);
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
      {dropping && (
        <div className="pointer-events-none absolute -inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-indigo-500/60 bg-zinc-950/80 backdrop-blur-[1px]">
          <p className="font-display text-sm font-semibold text-indigo-300">
            Drop to send — max 20 MB per file
          </p>
        </div>
      )}
      <div className="rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900/90 to-zinc-900/40 px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">Session</p>
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label} · {Math.max(state.peerCount, 1)} device{state.peerCount > 1 ? 's' : ''}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="truncate font-mono text-sm tracking-wide text-indigo-300">{state.sessionCode}</code>
          <button
            onClick={copyCode}
            className={`shrink-0 rounded-md px-1.5 text-xs transition-colors ${
              codeCopied ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-200'
            }`}
            title="Copy session code"
          >
            {codeCopied ? '✓ copied' : '⧉'}
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
        <div className="mt-2.5 flex items-center gap-2 border-t border-zinc-800/60 pt-2.5">
          <button
            onClick={() => setShowQr(true)}
            className="rounded-lg bg-zinc-800/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            QR code
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
            className="ml-auto rounded-lg px-2.5 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            Leave
          </button>
        </div>
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
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600">
            <SearchIcon />
          </span>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search history…"
            spellCheck={false}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 py-2 pl-9 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none transition-colors focus:border-indigo-500"
          />
        </div>
        <div className="flex shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/60 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              title={f.title}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                filter === f.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
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
          className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5 text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-200"
        >
          <PaperclipIcon />
        </button>
      </div>

      {fileError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2 text-xs text-red-300">
          {fileError}
        </div>
      )}

      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="font-display flex items-center gap-2 text-sm font-semibold text-zinc-300">
            History
            {state.history.length > 0 && (
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                {visible.length === state.history.length ? state.history.length : `${visible.length}/${state.history.length}`}
              </span>
            )}
          </h2>
          {state.history.length > 0 && (
            <button
              onClick={() => window.klip.clearHistory()}
              className="text-[11px] text-zinc-600 transition-colors hover:text-zinc-300"
              title="Pinned clips are kept"
            >
              Clear all
            </button>
          )}
        </div>

        {state.history.length === 0 ? (
          <div className="animate-rise rounded-2xl border border-dashed border-zinc-800 py-14 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-zinc-600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="2" width="8" height="4" rx="1" />
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              </svg>
            </div>
            <p className="text-sm text-zinc-500">Nothing here yet.</p>
            <p className="mt-1 text-xs text-zinc-600">
              Copy text, take a screenshot, or drop a file — it appears here and on your other devices, instantly.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 py-10 text-center">
            <p className="text-sm text-zinc-500">No matches.</p>
            <button
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
              className="mt-1 text-xs text-indigo-400 transition-colors hover:text-indigo-300"
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
    </div>
  );
}
