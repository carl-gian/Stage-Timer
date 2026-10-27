'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { StageTimer } = require('./timer');
const { getMeetingForWeek, DEFAULT_FEED_URL } = require('./feed');
const { buildSchedule, detectMeetingType } = require('./schedule');
const { ObsClient } = require('./obs');
const { SceneSwitcher, DEFAULT_SETTLE_MS } = require('./sceneSwitcher');
const { buildReport, ReportStore, REPORT_AFTER } = require('./report');

const MEETING_TYPES = ['midweek', 'weekend'];

const randomPin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

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
      startHidden: true, // launch into the tray without opening the window
      autoUpdate: true, // download new versions in the background (installed when the app is quit)
      obsCounselScenes: {}, // per-part counseling scene, same shape as obsScenes
      obsCounselScene: '', // scene after a ministry student talk is stopped (counsel is given); empty = use the default
      obsDefaultScene: '', // scene to show when a part is stopped (empty = leave OBS alone)
      ...this._readSettings(),
    };
    for (const k of ['obsScenes', 'obsCounselScenes']) if (!this.settings[k] || typeof this.settings[k] !== 'object') this.settings[k] = {};
    this._saveSettings();

    this.timer = new StageTimer({ now: () => Date.now(), closingSecs: this.settings.closingSecs, adaptiveMode: this.settings.adaptiveMode });
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
    return { ...this.timer.snapshot(), obs, report: this.latestReport };
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

  /** Builds the schedule for the current meeting type (downloading the feed for midweek). */
  async loadSchedule({ force = false } = {}) {
    const type = this.meetingType;
    this.status = { ...this.status, loading: true };
    let meeting = null;
    let source = 'n/a';
    let error;

    if (type === 'midweek') {
      const r = await getMeetingForWeek({
        feedUrl: this.settings.feedUrl,
        cachePath: this.cachePath,
        now: this.nowDate(),
        fetchImpl: this.fetchImpl,
        force,
      });
      meeting = r.meeting;
      source = meeting ? r.source : 'none';
      error = r.error;
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
  }

  async updateSettings(patch) {
    const allowed = ['port', 'pin', 'localNoPin', 'meetingMode', 'circuitVisit', 'closingSecs', 'feedUrl', 'adaptiveMode', 'hostname', 'obsEnabled', 'obsUrl', 'obsPassword', 'obsSettleMs', 'obsDefaultScene', 'obsCounselScene', 'autoUpdate', 'startHidden'];
    const before = { ...this.settings };
    for (const k of allowed) if (k in patch) this.settings[k] = patch[k];

    this.settings.port = Math.min(65535, Math.max(1, parseInt(this.settings.port, 10) || before.port));
    this.settings.closingSecs = Math.min(600, Math.max(0, parseInt(this.settings.closingSecs, 10) || 0));
    this.settings.hostname = String(this.settings.hostname || '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(this.settings.hostname)) this.settings.hostname = before.hostname;
    if (!/^\d{4,8}$/.test(String(this.settings.pin))) this.settings.pin = before.pin;
    this.settings.pin = String(this.settings.pin);
    if (!['none', 'oneWay', 'twoWay'].includes(this.settings.adaptiveMode)) this.settings.adaptiveMode = before.adaptiveMode;

    this.settings.autoUpdate = this.settings.autoUpdate !== false;
    this.settings.startHidden = this.settings.startHidden !== false;
    this.settings.obsEnabled = this.settings.obsEnabled === true;
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
