'use strict';

const { EventEmitter } = require('events');
const { AdaptivePlanner } = require('./adaptive');

/**
 * Timestamp-based timer: elapsed time is derived from the clock, never from tick counts,
 * so it cannot drift. Clients are sent {elapsedMs, running, serverNow} and extrapolate.
 */
class StageTimer extends EventEmitter {
  constructor({ now = () => Date.now(), closingSecs = 30, adaptiveMode = 'none' } = {}) {
    super();
    this.now = now;
    this.closingSecs = closingSecs;
    this.items = [];
    this.currentId = null;
    this.base = 0; // ms accumulated while stopped
    this.startedAt = null; // ms timestamp while running
    this.meta = {};
    this.planner = new AdaptivePlanner({ mode: adaptiveMode });
    this.overrunSecs = null;
  }

  get running() {
    return this.startedAt !== null;
  }

  get current() {
    return this.items.find((i) => i.id === this.currentId) || null;
  }

  elapsedMs() {
    return this.base + (this.running ? this.now() - this.startedAt : 0);
  }

  /** Duration the clock counts to: the adapted value if there is one, else the planned one. */
  actualSecs(item) {
    return item.adaptedSecs ?? item.durationSecs;
  }

  setSchedule(items, meta = {}) {
    this.items = items.map((i) => ({ completedSecs: null, ...i }));
    this.meta = meta;
    this.base = 0;
    this.startedAt = null;
    this.currentId = items.length ? items[0].id : null;
    this.planner.reset(meta.meetingType);
    this.overrunSecs = null;
    this._refreshAdaptive();
    this._changed();
  }

  setAdaptiveMode(mode) {
    this.planner.mode = mode;
    this._refreshAdaptive();
    this._changed();
  }

  /** Recompute the current part's adapted duration (only before it has started running). */
  _refreshAdaptive({ starting = false, withOverrun = false } = {}) {
    const cur = this.current;
    if (!cur || this.running || this.base > 0) return;
    if (starting) this.planner.noteStart(cur, this.now());
    const r = this.planner.evaluate(this.items, cur, this.now());
    cur.adaptedSecs = r.adaptedSecs;
    // Like OnlyT, over/under-run is judged when the next part is lined up (the interval song is still to come).
    if (withOverrun) this.overrunSecs = r.overrunSecs;
  }

  select(id) {
    if (!this.items.some((i) => i.id === id)) return false;
    this.startedAt = null;
    this.base = 0;
    this.currentId = id;
    this._refreshAdaptive({ withOverrun: true });
    this._changed();
    return true;
  }

  start() {
    if (!this.current || this.running) return;
    this._refreshAdaptive({ starting: true });
    this.startedAt = this.now();
    this._changed();
  }

  pause() {
    if (!this.running) return;
    this.base = this.elapsedMs();
    this.startedAt = null;
    this._changed();
  }

  /** Stop = this part is done: remember how long it took and line up the next part. */
  finish() {
    const cur = this.current;
    if (!cur || (!this.running && this.base === 0)) return;
    cur.completedSecs = Math.round(this.elapsedMs() / 1000);
    this.startedAt = null;
    this.base = 0;
    const next = this.items[this.items.indexOf(cur) + 1];
    if (next) this.select(next.id);
    else this._changed();
  }

  reset() {
    this.base = 0;
    this.startedAt = null;
    this._changed();
  }

  /** Lengthen / shorten the current part. Never goes below 10 seconds. */
  adjust(deltaSecs) {
    const cur = this.current;
    if (!cur) return;
    cur.durationSecs = Math.max(10, cur.durationSecs + Math.round(deltaSecs));
    if (this.running || this.base > 0) {
      // already under way: just move the target by the same amount
      if (cur.adaptedSecs != null) cur.adaptedSecs = Math.max(10, cur.adaptedSecs + Math.round(deltaSecs));
    } else {
      this._refreshAdaptive();
    }
    this._changed();
  }

  setClosingSecs(secs) {
    this.closingSecs = secs;
    this._changed();
  }

  snapshot() {
    const cur = this.current;
    return {
      serverNow: this.now(),
      running: this.running,
      elapsedMs: this.elapsedMs(),
      closingSecs: this.closingSecs,
      currentId: this.currentId,
      targetSecs: cur ? this.actualSecs(cur) : 0,
      overrunSecs: this.overrunSecs,
      adaptiveMode: this.planner.mode,
      talk: cur ? { id: cur.id, name: cur.name, section: cur.sectionTitle } : null,
      items: this.items,
      ...this.meta,
    };
  }

  _changed() {
    this.emit('change', this.snapshot());
  }
}

module.exports = { StageTimer };
