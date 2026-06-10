import { useEffect, useMemo, useRef, useState } from 'react';
import { Clipboard } from 'lucide-react';
import type { ClipItem, KlipState } from '../types';

/**
 * Quick-paste palette: a small always-on-top window summoned with
 * Ctrl+Shift+V. Type to filter, ↑/↓ + Enter (or click) to paste straight into
 * the app you were typing in, Ctrl+Enter to copy only, Esc to close.
 */
export default function Palette() {
  const [state, setState] = useState<KlipState | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // The window itself is transparent; only our rounded card is visible.
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, []);

  useEffect(() => {
    if (!window.klip) return;
    window.klip.getState().then(setState);
    const offState = window.klip.onState(setState);
    const offOpen = window.klip.onPaletteOpen(() => {
      setQuery('');
      setSelected(0);
      // rAF fires before Windows finishes handing focus to the window — the
      // input would render without a caret. A short delay is reliable.
      setTimeout(() => inputRef.current?.focus(), 60);
    });
    return () => {
      offState();
      offOpen();
    };
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Files can't be pasted with Ctrl+V — they live in the main window only.
    const all = (state?.history ?? []).filter((item) => item.type !== 'file');
    const filtered = q
      ? all.filter(
          (item) =>
            (item.text ?? '').toLowerCase().includes(q) ||
            item.deviceName.toLowerCase().includes(q) ||
            (item.type === 'image' && 'image'.includes(q)),
        )
      : all;
    return filtered.slice(0, 9);
  }, [state, query]);

  useEffect(() => {
    setSelected((value) => Math.min(value, Math.max(items.length - 1, 0)));
  }, [items]);

  function act(item: ClipItem, copyOnly: boolean) {
    if (copyOnly) {
      window.klip.copyEntry(item.id);
      window.klip.paletteHide();
    } else {
      // Hides the palette, restores focus to the previous app, sends Ctrl+V.
      window.klip.pasteEntry(item.id);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.klip.paletteHide();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((value) => Math.min(value + 1, items.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((value) => Math.max(value - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = items[selected];
        if (item) act(item, event.ctrlKey || event.metaKey);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, selected]);

  if (!window.klip) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/95 text-zinc-100 antialiased shadow-2xl shadow-black/60">
      <div className="border-b border-zinc-900 p-2.5">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Quick paste — type to filter…"
          spellCheck={false}
          role="combobox"
          aria-label="Quick paste — type to filter the history"
          aria-expanded={items.length > 0}
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-activedescendant={items[selected] ? `palette-opt-${items[selected].id}` : undefined}
          className="w-full rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 outline-none transition-colors focus:border-klip-500"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <div className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-900 text-zinc-500">
              <Clipboard size={15} aria-hidden />
            </div>
            <p className="text-xs text-zinc-400">
              {state?.history.length ? 'No matches.' : 'Nothing in the history yet.'}
            </p>
          </div>
        ) : (
          <ul id="palette-list" role="listbox" aria-label="Recent clips" className="flex flex-col gap-0.5">
            {items.map((item, index) => (
              <li key={item.id} role="presentation">
                <button
                  id={`palette-opt-${item.id}`}
                  role="option"
                  aria-selected={index === selected}
                  onClick={(event) => act(item, event.ctrlKey || event.metaKey)}
                  onMouseEnter={() => setSelected(index)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    index === selected ? 'bg-klip-500/15' : ''
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                      index === selected ? 'bg-klip-500/30 text-klip-200' : 'bg-zinc-900 text-zinc-500'
                    }`}
                  >
                    {index + 1}
                  </span>
                  {item.type === 'image' ? (
                    <>
                      <img src={item.thumb} alt="" draggable={false} className="h-7 shrink-0 rounded border border-zinc-800" />
                      <span className="truncate text-xs text-zinc-400">Image · {item.deviceName}</span>
                    </>
                  ) : (
                    <span className="truncate text-xs text-zinc-200">{item.text}</span>
                  )}
                  {item.pinned && <span className="ml-auto shrink-0 text-[10px] text-klip-400">pinned</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-center gap-2.5 border-t border-zinc-900 px-3 py-1 text-[10px] text-zinc-400">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> paste</span>
        <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> copy</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  );
}
