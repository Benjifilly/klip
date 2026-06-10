'use strict';

/**
 * Pure helpers shared by the Electron main process and the test suite.
 * Nothing in here may require('electron') — tests run under plain Node.
 */

/**
 * Make an attacker-supplied file name safe to show and to pass to a save
 * dialog: path separators, reserved Windows characters and ASCII control
 * characters become '_', leading/trailing dots and spaces are stripped.
 */
function sanitizeFileName(name) {
  const clean = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\s\S]/g, (ch) => (ch.charCodeAt(0) < 32 ? '_' : ch))
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  return clean || 'file';
}

/** Plain ws:// is only acceptable on loopback/LAN — the internet gets TLS. */
function isAllowedRelayUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'wss:') return true;
  if (url.protocol !== 'ws:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.local')
  );
}

module.exports = { sanitizeFileName, isAllowedRelayUrl };
