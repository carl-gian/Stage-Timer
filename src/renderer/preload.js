'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stage', {
  info: () => ipcRenderer.invoke('info'),
  update: (patch) => ipcRenderer.invoke('update-settings', patch),
  regeneratePin: () => ipcRenderer.invoke('regenerate-pin'),
  assignScene: (key, scene) => ipcRenderer.invoke('assign-scene', key, scene),
  makeReport: () => ipcRenderer.invoke('make-report'),
  openReportPdf: (id) => ipcRenderer.invoke('open-report-pdf', id),
  openReportsFolder: () => ipcRenderer.invoke('open-reports-folder'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  refreshSchedule: () => ipcRenderer.invoke('refresh-schedule'),
  copy: (t) => ipcRenderer.invoke('copy', t),
  open: (u) => ipcRenderer.invoke('open', u),
});
