import type { IpcResult, KlipState } from './types';

declare global {
  interface Window {
    klip: {
      getState: () => Promise<KlipState>;
      generateCode: () => Promise<string>;
      joinSession: (code: string) => Promise<IpcResult>;
      leaveSession: () => Promise<IpcResult>;
      rotateSession: () => Promise<IpcResult & { code?: string }>;
      copyItem: (text: string) => Promise<IpcResult>;
      copyEntry: (id: string) => Promise<IpcResult>;
      pasteEntry: (id: string) => Promise<IpcResult>;
      sendFile: (filePath: string) => Promise<IpcResult>;
      attachFile: () => Promise<IpcResult>;
      saveFile: (id: string) => Promise<IpcResult>;
      getPathForFile: (file: File) => string;
      togglePin: (id: string) => Promise<IpcResult>;
      clearHistory: () => Promise<IpcResult>;
      deleteItem: (id: string) => Promise<IpcResult>;
      setPaused: (paused: boolean) => Promise<IpcResult>;
      openUrl: (url: string) => Promise<IpcResult>;
      setServerUrl: (url: string) => Promise<IpcResult>;
      setDeviceName: (name: string) => Promise<IpcResult>;
      setClipboardClear: (seconds: number) => Promise<IpcResult>;
      setAutoStart: (enabled: boolean) => Promise<IpcResult>;
      paletteHide: () => Promise<IpcResult>;
      windowControl: (action: 'minimize' | 'maximize' | 'close') => Promise<IpcResult>;
      onState: (callback: (state: KlipState) => void) => () => void;
      onWindowState: (callback: (state: { maximized: boolean }) => void) => () => void;
      onPaletteOpen: (callback: () => void) => () => void;
    };
  }
}

export {};
