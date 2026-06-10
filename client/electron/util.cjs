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

/**
 * Script for the persistent PowerShell focus/paste helper (win32 only).
 * Protocol, one command per stdin line:
 *   get            → prints the current foreground window handle (decimal)
 *   focus <hwnd>   → re-activates that window
 *   paste <hwnd>   → re-activates it (when non-zero), then sends Ctrl+V
 * The keybd_event(VK_MENU) pulse is the documented workaround for the
 * SetForegroundWindow lock on background processes.
 */
const PASTE_HELPER_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  'Add-Type -Namespace W -Name U -MemberDefinition',
  '\'[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
  '[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);\';',
  'function Activate([long]$h) {',
  '  if ($h -eq 0) { return }',
  '  [W.U]::keybd_event(164, 0, 0, [UIntPtr]::Zero);',
  '  [W.U]::keybd_event(164, 0, 2, [UIntPtr]::Zero);',
  '  [void][W.U]::SetForegroundWindow([IntPtr]$h);',
  '  Start-Sleep -Milliseconds 60;',
  '}',
  'while ($null -ne ($line = [Console]::In.ReadLine())) {',
  '  if ($line -eq \'get\') { [Console]::Out.WriteLine([W.U]::GetForegroundWindow().ToInt64()); }',
  '  elseif ($line.StartsWith(\'focus \')) { $h = 0L; if ([long]::TryParse($line.Substring(6).Trim(), [ref]$h)) { Activate $h } }',
  '  elseif ($line.StartsWith(\'paste\')) {',
  '    $h = 0L; [void][long]::TryParse($line.Substring(5).Trim(), [ref]$h);',
  '    Activate $h;',
  '    [System.Windows.Forms.SendKeys]::SendWait(\'^v\');',
  '  }',
  '}',
].join(' ');

module.exports = { sanitizeFileName, isAllowedRelayUrl, PASTE_HELPER_SCRIPT };
