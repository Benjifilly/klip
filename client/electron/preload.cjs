'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/**
 * The only bridge between the renderer (pure UI) and the main process.
 * The renderer never sees the session key, the WebSocket, or Node APIs.
 */
contextBridge.exposeInMainWorld('klip', {
  getState: () => ipcRenderer.invoke('klip:get-state'),
  generateCode: () => ipcRenderer.invoke('klip:generate-code'),
  joinSession: (code) => ipcRenderer.invoke('klip:join-session', code),
  leaveSession: () => ipcRenderer.invoke('klip:leave-session'),
  rotateSession: () => ipcRenderer.invoke('klip:rotate-session'),
  copyItem: (text) => ipcRenderer.invoke('klip:copy-item', text),
  copyEntry: (id) => ipcRenderer.invoke('klip:copy-entry', id),
  pasteEntry: (id) => ipcRenderer.invoke('klip:paste-entry', id),
  /**
   * Send files dropped onto the window. The path extraction stays in the
   * preload on purpose: the page can only hand us File objects from a real
   * drop event — it has no API that takes an arbitrary filesystem path, so a
   * compromised renderer can't use Klip as a file-exfiltration channel.
   */
  sendDroppedFiles: (files) =>
    Promise.all(
      [...files]
        .filter((file) => file instanceof File)
        .map((file) => ipcRenderer.invoke('klip:send-file', webUtils.getPathForFile(file))),
    ),
  attachFile: () => ipcRenderer.invoke('klip:attach-file'),
  saveFile: (id) => ipcRenderer.invoke('klip:save-file', id),
  togglePin: (id) => ipcRenderer.invoke('klip:toggle-pin', id),
  clearHistory: () => ipcRenderer.invoke('klip:clear-history'),
  deleteItem: (id) => ipcRenderer.invoke('klip:delete-item', id),
  setPaused: (paused) => ipcRenderer.invoke('klip:set-paused', paused),
  openUrl: (url) => ipcRenderer.invoke('klip:open-url', url),
  setServerUrl: (url) => ipcRenderer.invoke('klip:set-server-url', url),
  setDeviceName: (name) => ipcRenderer.invoke('klip:set-device-name', name),
  setClipboardClear: (seconds) => ipcRenderer.invoke('klip:set-clipboard-clear', seconds),
  setAutoStart: (enabled) => ipcRenderer.invoke('klip:set-auto-start', enabled),
  setAutoCopy: (mode) => ipcRenderer.invoke('klip:set-auto-copy', mode),
  setNotifyOnReceive: (enabled) => ipcRenderer.invoke('klip:set-notify-on-receive', enabled),
  setSyncKinds: (kinds) => ipcRenderer.invoke('klip:set-sync-kinds', kinds),
  setShortcuts: (shortcuts) => ipcRenderer.invoke('klip:set-shortcuts', shortcuts),
  resolveRotation: (accept) => ipcRenderer.invoke('klip:resolve-rotation', accept),
  paletteHide: () => ipcRenderer.invoke('klip:palette-hide'),
  windowControl: (action) => ipcRenderer.invoke('klip:window-control', action),
  onState: (callback) => subscribe('klip:state', callback),
  onWindowState: (callback) => subscribe('klip:window-state', callback),
  onPaletteOpen: (callback) => subscribe('klip:palette-open', callback),
});
