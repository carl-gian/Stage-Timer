'use strict';

const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, nativeImage } = require('electron');
const QRCode = require('qrcode');
const { StageService } = require('./core/service');
const { createServer } = require('./core/server');

let service, server, win, tray;
let serverError = null;
let quitting = false;
const qrCache = new Map();

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

async function startServer() {
  serverError = null;
  if (server) await server.close();
  server = createServer(service);
  try {
    await server.start(service.settings.port);
  } catch (err) {
    serverError = err.code === 'EADDRINUSE' ? `Ports ${service.settings.port} and 4580 are both in use. Choose another port.` : String(err.message);
  }
}

async function qrFor(text) {
  if (!qrCache.has(text)) qrCache.set(text, await QRCode.toDataURL(text, { margin: 1, width: 180, color: { dark: '#0b0e14', light: '#ffffff' } }));
  return qrCache.get(text);
}

async function info() {
  const s = service.settings;
  const urls = server.urls();
  return {
    settings: s,
    urls,
    qr: await qrFor(urls.control),
    serverError,
    port: server.port,
    friendlyName: server.friendlyName,
    meetingType: service.meetingType,
    schedule: { source: service.timer.meta.scheduleSource, error: service.timer.meta.scheduleError, count: service.timer.items.length },
    timer: { running: service.timer.running, talk: service.timer.current && service.timer.current.name },
    version: app.getVersion(),
  };
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 480,
    minHeight: 560,
    title: 'Stage Timer',
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'renderer', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Closing the window keeps the timer server running in the tray.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => (win = null));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('Stage Timer');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Stage Timer', click: showWindow },
      { label: 'Open display in browser', click: () => shell.openExternal(server.urls().displayLocal) },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]),
  );
  tray.on('click', showWindow);
}

app.whenReady().then(async () => {
  service = new StageService({ dataDir: app.getPath('userData') });
  await service.loadSchedule();
  await startServer();
  service.on('open-settings', showWindow); // from the OBS dock's gear button
  createTray();
  createWindow();

  ipcMain.handle('info', info);
  ipcMain.handle('update-settings', async (_e, patch) => {
    const { port: oldPort, hostname: oldHost } = service.settings;
    await service.updateSettings(patch);
    if (service.settings.port !== oldPort || service.settings.hostname !== oldHost || serverError) await startServer();
    return info();
  });
  ipcMain.handle('regenerate-pin', async () => {
    await service.regeneratePin();
    return info();
  });
  ipcMain.handle('refresh-schedule', async () => {
    await service.loadSchedule({ force: true });
    return info();
  });
  ipcMain.handle('copy', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('open', (_e, url) => {
    if (/^http:\/\/(localhost|\d+\.\d+\.\d+\.\d+):\d+\//.test(url)) shell.openExternal(url);
  });
});

app.on('activate', showWindow); // macOS dock click
app.on('before-quit', () => { quitting = true; });
// Stay alive in the tray when all windows are closed (window close is intercepted anyway).
app.on('window-all-closed', () => {});
