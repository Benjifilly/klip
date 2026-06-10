import type { KlipState } from './types';

export interface StatusMeta {
  dot: string;
  label: string;
}

export function statusMeta(state: Pick<KlipState, 'status' | 'paused'>): StatusMeta {
  if (state.paused) return { dot: 'bg-amber-400', label: 'Paused' };
  switch (state.status) {
    case 'connected':
      return { dot: 'bg-emerald-400', label: 'Connected' };
    case 'connecting':
      return { dot: 'bg-amber-400 animate-pulse', label: 'Connecting…' };
    default:
      return { dot: 'bg-zinc-600', label: 'Offline' };
  }
}
