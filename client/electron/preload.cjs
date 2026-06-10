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
  sendFile: (filePath) => ipcRenderer.invoke('klip:send-file', filePath),
  attachFile: () => ipcRenderer.invoke('klip:attach-file'),
  saveFile: (id) => ipcRenderer.invoke('klip:save-file', id),
  // Sandboxed renderers can't see file paths; this is the blessed Electron way.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  togglePin: (id) => ipcRenderer.invoke('klip:toggle-pin', id),
  clearHistory: () => ipcRenderer.invoke('klip:clear-history'),
  deleteItem: (id) => ipcRenderer.invoke('klip:delete-item', id),
  setPaused: (paused) => ipcRenderer.invoke('klip:set-paused', paused),
  openUrl: (url) => ipcRenderer.invoke('klip:open-url', url),
  setServerUrl: (url) => ipcRenderer.invoke('klip:set-server-url', url),
  setDeviceName: (name) => ipcRenderer.invoke('klip:set-device-name', name),
  setClipboardClear: (seconds) => ipcRenderer.invoke('klip:set-clipboard-clear', seconds),
  setAutoStart: (enabled) => ipcRenderer.invoke('klip:set-auto-start', enabled),
  paletteHide: () => ipcRenderer.invoke('klip:palette-hide'),
  windowControl: (action) => ipcRenderer.invoke('klip:window-control', action),
  onState: (callback) => subscribe('klip:state', callback),
  onWindowState: (callback) => subscribe('klip:window-state', callback),
  onPaletteOpen: (callback) => subscribe('klip:palette-open', callback),
});
