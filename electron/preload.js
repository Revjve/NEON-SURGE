'use strict';

// Minimal, explicit bridge between the sandboxed game page and the Electron shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neonDesktop', {
  platform: process.platform,
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  minimize: () => ipcRenderer.send('window:minimize'),
  quit: () => ipcRenderer.send('app:quit'),
  onFullscreenChange: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
  },
});
