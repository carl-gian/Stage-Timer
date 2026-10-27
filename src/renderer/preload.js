'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stage', {
  info: () => ipcRenderer.invoke('info'),
  update: (patch) => ipcRenderer.invoke('update-settings', patch),
  regeneratePin: () => ipcRenderer.invoke('regenerate-pin'),
  refreshSchedule: () => ipcRenderer.invoke('refresh-schedule'),
  copy: (t) => ipcRenderer.invoke('copy', t),
  open: (u) => ipcRenderer.invoke('open', u),
});
