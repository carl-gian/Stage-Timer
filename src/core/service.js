'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { StageTimer } = require('./timer');
const { getMeetingForWeek, DEFAULT_FEED_URL } = require('./feed');
const { buildSchedule, detectMeetingType, mondayKey } = require('./schedule');
const { ObsClient } = require('./obs');
const { SceneSwitcher, DEFAULT_SETTLE_MS } = require('./sceneSwitcher');
const { buildReport, ReportStore, REPORT_AFTER } = require('./report');

const MEETING_TYPES = ['midweek', 'weekend'];
const RAISE_SECS = 45; // how long a Zoom raised hand stays on the speaker's screen
const NAMED_SECS = 90; // after a name is sent, the raised hand stays for a minute and a half
const CANCELLED_SECS = 5; // how long "cancelled" stays after Cancel
const TYPING_GRACE_MS = 5000; // typing is assumed to have stopped when no signal has come for this long
const MAX_HOLD_MS = 3 * 60 * 1000; // the most one raise hand can be held while typing
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // 24-hour HH:MM, as saved

const randomPin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');
const NO_NETWORK = async () => { throw new Error('not downloading now'); }; // for a quick load from the saved copy

/** Owns settings, the schedule and the timer. UI-agnostic so it also runs headless. */
class StageService extends EventEmitter {
  constructor({ dataDir, now = () => new Date(), fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket }) {
    super();
    this.dataDir = dataDir;
    this.nowDate = now;
    this.fetchImpl = fetchImpl;
    fs.mkdirSync(dataDir, { recursive: true });
    this.settingsPath = path.join(dataDir, 'settings.json');
    this.cachePath = path.join(dataDir, 'feed.json');

    this.firstRun = !fs.existsSync(this.settingsPath); // nothing saved yet: a brand-new install
    this.settings = {
      port: 80, // preferred; falls back to 4580 if unavailable
      hostname: 'stage', // reachable as stage.local on the same network
      pin: randomPin(),
      localNoPin: true, // OBS on this computer doesn't need the PIN
      meetingMode: 'auto', // auto | midweek | weekend
      circuitVisit: false,
      closingSecs: 30,
      adaptiveMode: 'none', // none | oneWay | twoWay
      feedUrl: DEFAULT_FEED_URL,
      obsEnabled: false, // optional: switch OBS scenes when a part starts
      obsUrl: 'ws://localhost:4455',
      obsPassword: '',
      obsSettleMs: DEFAULT_SETTLE_MS, // pause between Preview and Transition
      obsScenes: {}, // { midweek: { partKey: sceneName }, weekend: { ... } }
      displayScreen: '', // '' = open the display in the browser; otherwise the id of the monitor to show it fullscreen on
      startHidden: true, // launch into the tray without opening the window
      autoUpdate: true, // download new versions in the background (installed when the app is quit)
      obsCounselScenes: {}, // per-part counseling scene, same shape as obsScenes
      obsCounselScene: '', // scene after a ministry student talk is stopped (counsel is given); empty = use the default
      obsDefaultScene: '', // scene to show when a part is stopped (empty = leave OBS alone)
      zoomRaiseHand: true, // the "ZOOM Raise Hand" button and screen; can be turned off
      showClock: false, // current time on the control page, and on the display between parts
      clockFormat: '12h', // 12h | 24h
      theme: 'auto', // auto (follow Windows) | light | dark: control page and settings window
      startTimes: { midweek: '', weekend: '' }, // when the meeting starts (HH:MM); empty = work it out from the first part
      startOverride: { key: '', time: '' }, // a different start time for one meeting only (key = which meeting and week)
      ...this._readSettings(),
    };
    for (const k of ['obsScenes', 'obsCounselScenes']) if (!this.settings[k] || typeof this.settings[k] !== 'object') this.settings[k] = {};
    this._cleanStartTimes();
    this._saveSettings();

    this.timer = new StageTimer({ now: () => Date.now(), closingSecs: this.settings.closingSecs, adaptiveMode: this.settings.adaptiveMode });
    this.timer.planner.startProvider = () => {
      const b = this.baseStart();
      return b ? b.ms : null;
    };
    this.raise = null; // Zoom raised hand on the speaker's screen: { mode: 'hand' | 'unmute' | 'cancelled', endsAt }
    this._raiseTimer = null;
    this.status = { source: 'none', loading: false };

    this.obs = new ObsClient({ WebSocketImpl });
    this.switcher = new SceneSwitcher(this.obs, { settleMs: this.settings.obsSettleMs });
    this.switcher.on('change', () => this.emit('obs'));
    this.timer.on('part-start', (part) => this._onPartStart(part));
    this.timer.on('part-finish', (part) => this._onPartFinish(part));

    this.reports = new ReportStore(path.join(dataDir, 'reports'));
    this.latestReport = this.reports.list()[0] || null;
  }

  /** Timer snapshot plus the little OBS and report status the control page shows. */
  snapshot() {
    const mt = this.timer.meta.meetingType;
    const obs = {
      enabled: this.settings.obsEnabled,
      problem: this.obsProblem,
      scenes: this.switcher.scenes, // for the control page's scene pickers
      assigned: this.settings.obsScenes[mt] || {},
      counsel: this.settings.obsCounselScenes[mt] || {},
    };
    const clock = { show: this.settings.showClock, format: this.settings.clockFormat };
    return { ...this.timer.snapshot(), obs, report: this.latestReport, base: this.baseStart(), raise: this.raise, raiseEnabled: this.settings.zoomRaiseHand, clock, theme: this.settings.theme };
  }

  _setRaise(mode, secs) {
    clearTimeout(this._raiseTimer);
    clearTimeout(this._typingTimer);
    this._raiseTimer = this._typingTimer = null;
    this._heldMs = 0; // how long this raise hand has been held for typing
    this.raise = mode ? { mode, endsAt: Date.now() + secs * 1000, totalSecs: secs } : null;
    if (mode) this._armRaise(secs * 1000);
    this.emit('raise');
  }

  _armRaise(ms) {
    clearTimeout(this._raiseTimer);
    this._raiseTimer = setTimeout(() => this._setRaise(null), ms);
    this._raiseTimer.unref();
  }

  /** Shows "Zoom raise hand" on the speaker's screen; it goes away by itself after 45 seconds. */
  raiseHand() {
    if (!this.settings.zoomRaiseHand) return;
    this._setRaise('hand', RAISE_SECS);
  }

  /** Asks the conductor to tell the person to unmute. Keeps the time that is left. */
  raiseUnmute() {
    if (!this.raise || this.raise.mode === 'cancelled') return;
    this.raise = { ...this.raise, mode: 'unmute' };
    this.emit('raise');
  }

  /** Shows who is raising their hand, big on the speaker's screen. It then stays for 90 seconds from now. */
  raiseName(name) {
    if (!this.raise || this.raise.mode === 'cancelled') return false;
    const who = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!who) return false;
    const mode = this.raise.mode;
    this._setRaise(mode, NAMED_SECS);
    this.raise = { ...this.raise, name: who };
    return true;
  }

  /**
   * The operator is typing a name: hold the raise hand's countdown so the screen cannot vanish mid-name.
   * The control page repeats this every couple of seconds; if it stops (phone locked, Wi-Fi gone) the countdown
   * carries on, and one raise hand is never held for longer than 3 minutes in total.
   */
  raiseTyping(on) {
    const r = this.raise;
    if (!r || r.mode === 'cancelled') return;
    if (on) {
      clearTimeout(this._typingTimer);
      if (!r.paused) {
        if (this._heldMs >= MAX_HOLD_MS) return;
        clearTimeout(this._raiseTimer);
        this.raise = { ...r, paused: true, remainingMs: Math.max(0, r.endsAt - Date.now()) };
        this._pausedAt = Date.now();
        this.emit('raise');
      }
      const budget = MAX_HOLD_MS - this._heldMs - (Date.now() - this._pausedAt);
      this._typingTimer = setTimeout(() => this.raiseTyping(false), Math.max(0, Math.min(TYPING_GRACE_MS, budget)));
      this._typingTimer.unref();
    } else if (r.paused) {
      clearTimeout(this._typingTimer);
      this._heldMs += Date.now() - this._pausedAt;
      const { paused, remainingMs, ...rest } = r;
      this.raise = { ...rest, endsAt: Date.now() + remainingMs };
      this._armRaise(remainingMs);
      this.emit('raise');
    }
  }

  /** "Zoom raise hand cancelled" for 5 seconds, then back to the timer. */
  raiseCancel() {
    if (this.raise && this.raise.mode !== 'cancelled') this._setRaise('cancelled', CANCELLED_SECS);
  }

  /** Straight back to the timer. */
  raiseStop() {
    if (this.raise) this._setRaise(null);
  }

  /** Keeps only valid HH:MM start times. */
  _cleanStartTimes() {
    const st = this.settings.startTimes && typeof this.settings.startTimes === 'object' ? this.settings.startTimes : {};
    this.settings.startTimes = Object.fromEntries(MEETING_TYPES.map((t) => [t, TIME_RE.test(String(st[t])) ? String(st[t]) : '']));
    const ov = this.settings.startOverride;
    this.settings.startOverride = ov && typeof ov === 'object' && TIME_RE.test(String(ov.time)) && typeof ov.key === 'string' ? { key: ov.key, time: ov.time } : { key: '', time: '' };
  }

  /**
   * The start time everything is measured from: { time: 'HH:MM', source: 'override' | 'set', ms } for today, or null when
   * none was set (the start is then worked out from the first part, as before).
   */
  baseStart() {
    const ov = this.settings.startOverride;
    const type = this.meetingType;
    let time = '';
    let source = null;
    if (ov.time && ov.key === this._scheduleKey()) {
      time = ov.time;
      source = 'override';
    } else if (this.settings.startTimes[type]) {
      time = this.settings.startTimes[type];
      source = 'set';
    }
    if (!time) return null;
    const [h, m] = time.split(':').map(Number);
    const d = this.nowDate();
    return { time, source, ms: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime() };
  }

  /** A start time for this meeting only ('' puts back the saved one). */
  setStartOverride(time) {
    const t = String(time ?? '');
    if (t !== '' && !TIME_RE.test(t)) return false;
    this.settings.startOverride = t ? { key: this._scheduleKey(), time: t } : { key: '', time: '' };
    this._saveSettings();
    this.timer.refreshPlan();
    this.emit('settings');
    return true;
  }

  /** Writes an over/under report for every part timed so far. `trigger` is the part it follows (null = on request). */
  makeReport(trigger = null) {
    const report = buildReport({
      items: this.timer.items,
      meetingType: this.timer.meta.meetingType,
      circuitVisit: !!this.timer.meta.circuitVisit,
      trigger: trigger && trigger.name,
      createdAt: this.nowDate(),
    });
    this.reports.save(report);
    this.latestReport = this.reports.list()[0];
    this.emit('report', report);
    return report;
  }

  /** Remembers where a report's PDF copies were saved (the last one is the one the app opens). */
  attachPdf(id, pdfPaths) {
    const report = this.reports.get(id);
    if (!report) return;
    this.reports.save({ ...report, pdfPaths, pdfPath: pdfPaths[pdfPaths.length - 1] });
    this.latestReport = this.reports.list()[0];
  }

  get obsProblem() {
    if (!this.settings.obsEnabled) return null;
    return this.obs.connected ? this.switcher.problem : this.obs.message;
  }

  /** Everything the settings window needs about the OBS link. */
  obsInfo() {
    const { state, message } = this.obs;
    return { state, message, problem: this.switcher.problem, scenes: this.switcher.scenes, last: this.switcher.last };
  }

  /** Connects to (or disconnects from) OBS to match the settings. Safe to call repeatedly. */
  startObs() {
    this.switcher.settleMs = this.settings.obsSettleMs;
    if (this.settings.obsEnabled) this.obs.connect({ url: this.settings.obsUrl, password: this.settings.obsPassword });
    else this.obs.disconnect();
  }

  stopObs() {
    this.obs.disconnect();
  }

  /** Remembers which OBS scene a part uses (kind 'scene') or uses for its counsel (kind 'counsel'); an empty scene clears it. */
  assignScene({ meetingType, key, scene, kind = 'scene' }) {
    if (!MEETING_TYPES.includes(meetingType) || !/^\w+$/.test(String(key))) return;
    const field = kind === 'counsel' ? 'obsCounselScenes' : 'obsScenes';
    const forType = { ...this.settings[field][meetingType] };
    if (typeof scene === 'string' && scene && scene.length <= 256) forType[key] = scene;
    else delete forType[key];
    this.settings[field] = { ...this.settings[field], [meetingType]: forType };
    this._saveSettings();
    this.emit('settings');
    this.emit('obs'); // the control page shows the choice
  }

  /**
   * Changing scenes from the control page, even mid-part. If the part is under way, a new scene for it goes on air
   * straight away; otherwise it is simply remembered for when the part starts.
   */
  setPartScene({ key, scene, kind }) {
    const meetingType = this.timer.meta.meetingType;
    this.assignScene({ meetingType, key, scene, kind: kind === 'counsel' ? 'counsel' : 'scene' });
    const cur = this.timer.current;
    const underway = this.timer.running || this.timer.elapsedMs() > 0;
    if (kind !== 'counsel' && scene && this.settings.obsEnabled && cur && cur.key === key && underway) this.switcher.switchTo(scene);
  }

  _onPartStart(part) {
    if (!this.settings.obsEnabled || !part) return;
    const scene = (this.settings.obsScenes[this.timer.meta.meetingType] || {})[part.key];
    if (scene) this.switcher.switchTo(scene);
  }

  _onPartFinish(part) {
    if (REPORT_AFTER.has(part.key)) this.makeReport(part);
    if (!this.settings.obsEnabled) return;
    // After a student talk in Apply Yourself to the Field Ministry the counsel is given, which has its own scene.
    const own = (this.settings.obsCounselScenes[this.timer.meta.meetingType] || {})[part.key];
    const counsel = part.section === 'ministry' && part.isStudentTalk && (own || this.settings.obsCounselScene);
    const scene = counsel || this.settings.obsDefaultScene;
    if (scene) this.switcher.switchTo(scene);
  }

  _readSettings() {
    try {
      return JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
    } catch {
      return {};
    }
  }

  _saveSettings() {
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
  }

  get meetingType() {
    const m = this.settings.meetingMode;
    return m === 'midweek' || m === 'weekend' ? m : detectMeetingType(this.nowDate());
  }

  /**
   * Builds the schedule for the current meeting type (downloading the feed for midweek).
   * `offline`: use only the saved copy or default times, never wait for a download; returns `needsDownload` when
   * this week's parts should still be fetched. `onlyIf`: checked once the download is done; false leaves the parts alone.
   */
  async loadSchedule({ force = false, offline = false, onlyIf = null } = {}) {
    const type = this.meetingType;
    this.loadedFor = this._scheduleKey();
    this.status = { ...this.status, loading: true };
    let meeting = null;
    let source = 'n/a';
    let error;
    let needsDownload = false;

    if (type === 'midweek') {
      const r = await getMeetingForWeek({
        feedUrl: this.settings.feedUrl,
        cachePath: this.cachePath,
        now: this.nowDate(),
        fetchImpl: offline ? NO_NETWORK : this.fetchImpl,
        force,
      });
      meeting = r.meeting;
      source = meeting ? r.source : 'none';
      error = r.error;
      if (offline && r.source !== 'cache') {
        needsDownload = true;
        source = 'pending';
        error = undefined;
      }
    }

    if (onlyIf && !onlyIf()) {
      this.status = { ...this.status, loading: false };
      return { skipped: true };
    }

    const items = buildSchedule({ type, meeting, circuitVisit: this.settings.circuitVisit });
    this.status = { source, error, loading: false };
    this.timer.setSchedule(items, {
      meetingType: type,
      circuitVisit: this.settings.circuitVisit,
      scheduleSource: source,
      scheduleError: error || null,
    });
    this.emit('settings');
    return { needsDownload };
  }

  /** Which meeting and week the schedule is for: a change means a different set of parts. */
  _scheduleKey() {
    return `${this.meetingType} ${mondayKey(this.nowDate())}`;
  }

  _underway() {
    return this.timer.running || this.timer.elapsedMs() > 0;
  }

  /**
   * Called every few seconds: the app can stay in the tray for days, so when the day brings a different meeting or a
   * new week, that schedule is loaded. Never while a part is running or paused; it is tried again on the next call.
   * The switch happens at once with what is saved here; this week's parts are downloaded after, if needed.
   */
  async refreshForToday() {
    if (this.status.loading || this._scheduleKey() === this.loadedFor) return;
    if (this._underway()) return;
    const { needsDownload } = await this.loadSchedule({ offline: true });
    if (needsDownload) this.pendingDownload = this._downloadWeek(this.loadedFor);
  }

  /** Downloads the week and swaps its parts in, unless a part has started meanwhile or the day moved on. */
  async _downloadWeek(key) {
    const r = await this.loadSchedule({ onlyIf: () => this._scheduleKey() === key && !this._underway() });
    if (r.skipped && this._scheduleKey() === key) {
      // A part started while downloading: keep the default times; the control page offers "Try again"
      this.status = { ...this.status, source: 'none' };
      this.timer.meta.scheduleSource = 'none';
      this.emit('settings');
    }
  }

  async updateSettings(patch) {
    const allowed = ['port', 'pin', 'localNoPin', 'meetingMode', 'circuitVisit', 'closingSecs', 'feedUrl', 'adaptiveMode', 'hostname', 'obsEnabled', 'obsUrl', 'obsPassword', 'obsSettleMs', 'obsDefaultScene', 'obsCounselScene', 'autoUpdate', 'startHidden', 'showClock', 'clockFormat', 'theme', 'displayScreen', 'startTimes', 'zoomRaiseHand'];
    const before = { ...this.settings };
    for (const k of allowed) if (k in patch) this.settings[k] = patch[k];
    if (patch.startTimes && typeof patch.startTimes === 'object') this.settings.startTimes = { ...before.startTimes, ...patch.startTimes };

    this.settings.port = Math.min(65535, Math.max(1, parseInt(this.settings.port, 10) || before.port));
    this.settings.closingSecs = Math.min(600, Math.max(0, parseInt(this.settings.closingSecs, 10) || 0));
    this.settings.hostname = String(this.settings.hostname || '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(this.settings.hostname)) this.settings.hostname = before.hostname;
    if (!/^\d{4,8}$/.test(String(this.settings.pin))) this.settings.pin = before.pin;
    this.settings.pin = String(this.settings.pin);
    if (!['none', 'oneWay', 'twoWay'].includes(this.settings.adaptiveMode)) this.settings.adaptiveMode = before.adaptiveMode;

    this.settings.autoUpdate = this.settings.autoUpdate !== false;
    this.settings.startHidden = this.settings.startHidden !== false;
    this.settings.displayScreen = /^\d{1,12}$/.test(String(this.settings.displayScreen ?? '')) ? String(this.settings.displayScreen) : '';
    this.settings.obsEnabled = this.settings.obsEnabled === true;
    this.settings.zoomRaiseHand = this.settings.zoomRaiseHand !== false;
    if (!this.settings.zoomRaiseHand) this.raiseStop(); // turned off while showing: back to the timer
    this.settings.showClock = this.settings.showClock === true;
    if (!['12h', '24h'].includes(this.settings.clockFormat)) this.settings.clockFormat = before.clockFormat;
    if (!['auto', 'light', 'dark'].includes(this.settings.theme)) this.settings.theme = before.theme;
    this.settings.obsPassword = String(this.settings.obsPassword ?? '');
    const url = String(this.settings.obsUrl ?? '').trim();
    const withScheme = /^wss?:\/\//i.test(url) ? url : `ws://${url}`;
    this.settings.obsUrl = /^wss?:\/\/[^\s/]+\S*$/i.test(withScheme) ? withScheme : before.obsUrl;
    const settle = parseInt(this.settings.obsSettleMs, 10);
    this.settings.obsSettleMs = Number.isFinite(settle) ? Math.min(2000, Math.max(0, settle)) : before.obsSettleMs;
    const fallback = this.settings.obsDefaultScene;
    this.settings.obsDefaultScene = typeof fallback === 'string' && fallback.length <= 256 ? fallback : before.obsDefaultScene;
    const counsel = this.settings.obsCounselScene;
    this.settings.obsCounselScene = typeof counsel === 'string' && counsel.length <= 256 ? counsel : before.obsCounselScene;
    this._cleanStartTimes();
    this._saveSettings();

    this.timer.setClosingSecs(this.settings.closingSecs);
    this.timer.setAdaptiveMode(this.settings.adaptiveMode);
    this.startObs();
    if (before.meetingMode !== this.settings.meetingMode || before.circuitVisit !== this.settings.circuitVisit) {
      await this.loadSchedule();
    }
    this.emit('settings', before);
  }

  regeneratePin() {
    return this.updateSettings({ pin: randomPin() });
  }
}

module.exports = { StageService };
