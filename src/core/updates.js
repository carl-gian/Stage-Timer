'use strict';

const { EventEmitter } = require('events');

const FIRST_CHECK_MS = 15 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps the app up to date from its GitHub releases (via electron-updater, passed in so it can be faked).
 *
 * This app sits on stage during a meeting, so it never restarts by itself: new versions download quietly
 * in the background and are installed when the app is quit, or when the user chooses "Restart and update".
 *
 * status().state: unsupported | idle | checking | current | downloading | ready | error
 */
class UpdateManager extends EventEmitter {
  constructor({ updater, reason = '', isEnabled = () => true, isBusy = () => false }) {
    super();
    this.updater = updater;
    this.isEnabled = isEnabled; // the "update automatically" setting
    this.isBusy = isBusy; // true while the timer is running: never restart then
    this.s = { state: updater ? 'idle' : 'unsupported', message: updater ? '' : reason, version: null, percent: 0, checkedAt: null };
    this.timers = [];
    if (updater) this._attach(updater);
  }

  status() {
    return { ...this.s };
  }

  _set(patch) {
    this.s = { ...this.s, ...patch };
    this.emit('change');
  }

  _attach(u) {
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true; // quitting the app installs a downloaded update
    u.logger = null;
    u.on('checking-for-update', () => this._set({ state: 'checking', message: '' }));
    u.on('update-available', (info) => this._set({ state: 'downloading', version: info.version, percent: 0 }));
    u.on('update-not-available', () => this._set({ state: 'current', checkedAt: Date.now() }));
    u.on('download-progress', (p) => this._set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
    u.on('update-downloaded', (info) => this._set({ state: 'ready', version: info.version, percent: 100 }));
    u.on('error', (err) => {
      if (this.s.state === 'ready') return; // a downloaded update stays available whatever a later check says
      this._set({ state: 'error', message: String((err && err.message) || err).split('\n')[0].slice(0, 200), checkedAt: Date.now() });
    });
  }

  /** Checks shortly after launch, then every few hours, when "update automatically" is on. */
  start() {
    if (!this.updater) return;
    const auto = () => this.isEnabled() && this.check();
    const first = setTimeout(auto, FIRST_CHECK_MS);
    const repeat = setInterval(auto, CHECK_EVERY_MS);
    this.timers.push(first, repeat);
    for (const t of this.timers) t.unref?.();
  }

  stop() {
    this.timers.forEach((t) => (clearTimeout(t), clearInterval(t)));
    this.timers = [];
  }

  async check() {
    if (!this.updater || ['checking', 'downloading', 'ready'].includes(this.s.state)) return;
    try {
      await this.updater.checkForUpdates();
    } catch {
      /* reported through the 'error' event */
    }
  }

  /** Quits and installs a downloaded update. Returns false if there is none, or the timer is running. */
  install() {
    if (this.s.state !== 'ready' || this.isBusy()) return false;
    this.updater.quitAndInstall(true, true); // silent installer, then start the app again
    return true;
  }
}

module.exports = { UpdateManager, FIRST_CHECK_MS, CHECK_EVERY_MS };
