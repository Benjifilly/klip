export type SyncStatus = 'disconnected' | 'connecting' | 'connected';

/** What received clips are allowed to write into the local clipboard. */
export type AutoCopyMode = 'all' | 'text' | 'off';

export interface ClipItem {
  id: string;
  type: 'text' | 'image' | 'file';
  text?: string;
  /** Sanitized file name, present on file items. */
  name?: string;
  /** Small data-URL preview, present on image items. */
  thumb?: string;
  /** Payload size in bytes, present on image and file items. */
  bytes?: number;
  deviceName: string;
  ts: number;
  direction: 'sent' | 'received';
  pinned: boolean;
}

/** A code rotation pushed by another device, awaiting the user's decision. */
export interface PendingRotation {
  code: string;
  deviceName: string;
}

export interface KlipState {
  status: SyncStatus;
  peerCount: number;
  paused: boolean;
  sessionCode: string;
  /** 4-emoji session fingerprint — identical on every paired device. */
  fingerprint: string[];
  serverUrl: string;
  deviceName: string;
  clipboardClearSeconds: number;
  autoStart: boolean;
  autoCopy: AutoCopyMode;
  notifyOnReceive: boolean;
  syncText: boolean;
  syncImages: boolean;
  syncFiles: boolean;
  shortcuts: { toggle: string; palette: string };
  /** Global shortcuts that failed to register (conflicts with other apps). */
  shortcutErrors: string[];
  /** False when the OS keychain is unavailable and files sit unencrypted on disk. */
  atRestEncrypted: boolean;
  pendingRotation: PendingRotation | null;
  /** Names of the other devices currently seen in the session. */
  devices: string[];
  history: ClipItem[];
}

export interface IpcResult {
  ok: boolean;
  error?: string;
}
