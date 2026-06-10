export type SyncStatus = 'disconnected' | 'connecting' | 'connected';

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
  history: ClipItem[];
}

export interface IpcResult {
  ok: boolean;
  error?: string;
}
