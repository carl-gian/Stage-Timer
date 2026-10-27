'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { StageTimer } = require('./timer');
const { getMeetingForWeek, DEFAULT_FEED_URL } = require('./feed');
const { buildSchedule, detectMeetingType } = require('./schedule');

const randomPin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

/** Owns settings, the schedule and the timer. UI-agnostic so it also runs headless. */
class StageService extends EventEmitter {
  constructor({ dataDir, now = () => new Date(), fetchImpl = fetch }) {
    super();
    this.dataDir = dataDir;
    this.nowDate = now;
    this.fetchImpl = fetchImpl;
    fs.mkdirSync(dataDir, { recursive: true });
    this.settingsPath = path.join(dataDir, 'settings.json');
    this.cachePath = path.join(dataDir, 'feed.json');

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
      ...this._readSettings(),
    };
    this._saveSettings();

    this.timer = new StageTimer({ now: () => Date.now(), closingSecs: this.settings.closingSecs, adaptiveMode: this.settings.adaptiveMode });
    this.status = { source: 'none', loading: false };
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
    const allowed = ['port', 'pin', 'localNoPin', 'meetingMode', 'circuitVisit', 'closingSecs', 'feedUrl', 'adaptiveMode', 'hostname'];
    const before = { ...this.settings };
    for (const k of allowed) if (k in patch) this.settings[k] = patch[k];

    this.settings.port = Math.min(65535, Math.max(1, parseInt(this.settings.port, 10) || before.port));
    this.settings.closingSecs = Math.min(600, Math.max(0, parseInt(this.settings.closingSecs, 10) || 0));
    this.settings.hostname = String(this.settings.hostname || '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(this.settings.hostname)) this.settings.hostname = before.hostname;
    if (!/^\d{4,8}$/.test(String(this.settings.pin))) this.settings.pin = before.pin;
    this.settings.pin = String(this.settings.pin);
    if (!['none', 'oneWay', 'twoWay'].includes(this.settings.adaptiveMode)) this.settings.adaptiveMode = before.adaptiveMode;
    this._saveSettings();

    this.timer.setClosingSecs(this.settings.closingSecs);
    this.timer.setAdaptiveMode(this.settings.adaptiveMode);
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
