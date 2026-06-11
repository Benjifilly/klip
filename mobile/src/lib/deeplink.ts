/**
 * Parser for the pairing payload the desktop QR encodes:
 *   klip://join?code=…&relay=…
 * Query parsing is manual — Hermes' URL implementation lacks searchParams.
 * A relay that fails the wss/LAN rule is dropped (the app keeps its default)
 * rather than rejecting the whole link, mirroring the desktop behavior.
 */

import { formatSessionCode } from './crypto';
import { isAllowedRelayUrl } from './protocol';

export function parseJoinLink(raw: string): { code: string; relay: string | null } | null {
  const match = /^klip:\/\/join\/?\?(.+)$/i.exec(String(raw ?? '').trim());
  if (!match) return null;

  const params = new Map<string, string>();
  for (const pair of match[1].split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    try {
      params.set(decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1)));
    } catch {
      /* malformed escape — skip this pair */
    }
  }

  const code = formatSessionCode(params.get('code'));
  if (!code) return null;

  const relayRaw = (params.get('relay') ?? '').trim();
  const relay = relayRaw && /^wss?:\/\/.+/i.test(relayRaw) && isAllowedRelayUrl(relayRaw) ? relayRaw : null;

  return { code, relay };
}
