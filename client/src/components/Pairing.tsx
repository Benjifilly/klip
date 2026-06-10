import { useState } from 'react';
import appIcon from '../../assets/icon.png';

const FEATURES = [
  {
    label: 'Instant',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 3 14h7l-1 8 11-12h-7l1-8z" />
      </svg>
    ),
  },
  {
    label: 'E2E encrypted',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    label: 'Anywhere',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
];

export default function Pairing() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function createSession() {
    setBusy(true);
    setError('');
    const fresh = await window.klip.generateCode();
    const result = await window.klip.joinSession(fresh);
    if (!result.ok) setError(result.error ?? 'Could not create the session.');
    setBusy(false);
  }

  async function joinSession(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    const result = await window.klip.joinSession(code);
    if (!result.ok) setError(result.error ?? 'Could not join the session.');
    setBusy(false);
  }

  return (
    <div className="animate-rise mx-auto mt-10 flex max-w-sm flex-col gap-6 pb-4">
      <div className="relative mx-auto">
        <div
          aria-hidden
          className="absolute -inset-6 rounded-full bg-indigo-500/20 blur-2xl"
        />
        <img src={appIcon} alt="Klip" draggable={false} className="relative h-16 w-16" />
      </div>

      <div className="text-center">
        <h2 className="font-display text-xl font-semibold tracking-tight">Link your devices</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Create a session on one device, then enter the same code on the others.
          Everything you copy is end-to-end encrypted — the relay never sees your data.
        </p>
      </div>

      <button
        onClick={createSession}
        disabled={busy}
        className="brand-gradient rounded-2xl px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? 'Working…' : 'Create a new session'}
      </button>

      <div className="flex items-center gap-3 text-xs text-zinc-600">
        <div className="h-px flex-1 bg-zinc-800" />
        or join an existing one
        <div className="h-px flex-1 bg-zinc-800" />
      </div>

      <form onSubmit={joinSession} className="flex gap-2">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="xxxx-xxxx-xxxx-xxxx"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-center font-mono text-sm tracking-wider text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-50"
        >
          Join
        </button>
      </form>

      {error && <p className="text-center text-sm text-red-400">{error}</p>}

      <div className="mt-2 grid grid-cols-3 gap-2">
        {FEATURES.map((feature) => (
          <div
            key={feature.label}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-2 py-3"
          >
            <span className="text-indigo-400">{feature.icon}</span>
            <span className="text-[11px] text-zinc-500">{feature.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
