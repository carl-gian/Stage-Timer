'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { UpdateManager } = require('../src/core/updates');
const { StageService } = require('../src/core/service');

/** Stands in for electron-updater's autoUpdater. */
class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.installed = null;
  }
  async checkForUpdates() {
    this.checks++;
    this.emit('checking-for-update');
    if (this.next) return this.next();
  }
  quitAndInstall(...args) {
    this.installed = args;
  }
}

test('updates: dev runs and other platforms report that updates are unavailable', async () => {
  const m = new UpdateManager({ updater: null, reason: 'Updates only work in the installed app.' });
  assert.deepStrictEqual([m.status().state, m.status().message], ['unsupported', 'Updates only work in the installed app.']);
  await m.check(); // harmless
  assert.strictEqual(m.install(), false);
  m.start();
  m.stop();
});

test('updates: checking, downloading and ready; installing is quiet and restarts the app', async () => {
  const u = new FakeUpdater();
  const m = new UpdateManager({ updater: u });
  assert.strictEqual(u.autoDownload, true);
  assert.strictEqual(u.autoInstallOnAppQuit, true);

  u.next = async () => {
    u.emit('update-available', { version: '1.2.0' });
    u.emit('download-progress', { percent: 41.6 });
  };
  await m.check();
  assert.deepStrictEqual([m.status().state, m.status().version, m.status().percent], ['downloading', '1.2.0', 42]);
  await m.check(); // already downloading: not asked again
  assert.strictEqual(u.checks, 1);
  assert.strictEqual(m.install(), false); // nothing downloaded yet

  u.emit('update-downloaded', { version: '1.2.0' });
  assert.strictEqual(m.status().state, 'ready');
  u.emit('error', new Error('network down')); // a later failed check does not lose the download
  assert.strictEqual(m.status().state, 'ready');
  assert.strictEqual(m.install(), true);
  assert.deepStrictEqual(u.installed, [true, true]);
});

test('updates: never restarts while the timer is running', () => {
  const u = new FakeUpdater();
  let running = true;
  const m = new UpdateManager({ updater: u, isBusy: () => running });
  u.emit('update-downloaded', { version: '1.2.0' });
  assert.strictEqual(m.install(), false);
  assert.strictEqual(u.installed, null);
  running = false;
  assert.strictEqual(m.install(), true);
});

test('updates: up to date, and failures are reported plainly', async () => {
  const u = new FakeUpdater();
  const m = new UpdateManager({ updater: u });
  u.next = async () => u.emit('update-not-available', {});
  await m.check();
  assert.strictEqual(m.status().state, 'current');
  assert.ok(m.status().checkedAt);

  u.next = async () => {
    u.emit('error', new Error('getaddrinfo ENOTFOUND github.com\n    at somewhere'));
    throw new Error('rejected too');
  };
  await m.check(); // never throws
  assert.deepStrictEqual([m.status().state, m.status().message], ['error', 'getaddrinfo ENOTFOUND github.com']);
  u.next = async () => u.emit('update-not-available', {});
  await m.check(); // can recover
  assert.strictEqual(m.status().state, 'current');
});

test('settings: automatic updates default on and can be turned off', async () => {
  const service = new StageService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'st-')) });
  assert.strictEqual(service.settings.autoUpdate, true);
  await service.updateSettings({ autoUpdate: false });
  assert.strictEqual(service.settings.autoUpdate, false);
  await service.updateSettings({ autoUpdate: true });
  assert.strictEqual(service.settings.autoUpdate, true);
});

test('settings: start hidden defaults on, and only a new install counts as first run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const first = new StageService({ dataDir: dir });
  assert.deepStrictEqual([first.firstRun, first.settings.startHidden], [true, true]);
  await first.updateSettings({ startHidden: false });
  const again = new StageService({ dataDir: dir });
  assert.deepStrictEqual([again.firstRun, again.settings.startHidden], [false, false]);
});
