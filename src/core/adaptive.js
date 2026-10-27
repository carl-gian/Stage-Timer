'use strict';

// Port of OnlyT's AdaptiveTimerService. When the meeting runs early or late, the time
// difference is shared out across the remaining adaptive parts in proportion to their length.
//
// Modes:  'none'    - never change durations
//         'oneWay'  - only shorten parts when running late
//         'twoWay'  - shorten when late, lengthen when there is time in hand

const SMALLEST_DEVIATION_SECS = 15;
const LARGEST_DEVIATION_SECS = 15 * 60;
const MIN_PART_SECS = 10;

// Parts whose start fixes the meeting's start time (see nearest15Before).
const STARTERS = { midweek: ['opening', 'treasures'], weekend: ['public'] };

// Song between sections isn't in the part list; OnlyT skips it when judging over/under-run.
const INTERVAL_SONG_SECS = { living1: 3.5 * 60, watchtower: 5 * 60 };

/** Same rounding as OnlyT: minutes 46-59 -> :45, 31-45 -> :30, 16-30 -> :15, else :00. */
function nearest15Before(ms) {
  const d = new Date(ms);
  const m = d.getMinutes();
  const min = m > 45 ? 45 : m > 30 ? 30 : m > 15 ? 15 : 0;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), min, 0, 0).getTime();
}

const endOffset = (it) => it.startOffsetSecs + it.originalSecs;

/** Planned time for `item` and everything after it, including gaps (changeovers) between parts. */
function remainingProgramSecs(items, item) {
  let total = 0;
  let started = false;
  items.forEach((it, i) => {
    if (it.id === item.id) started = true;
    if (!started) return;
    total += it.durationSecs;
    if (i < items.length - 1) total += items[i + 1].startOffsetSecs - endOffset(it);
  });
  return total;
}

function secsToPlannedEnd(items, meetingStartMs, nowMs) {
  const end = meetingStartMs + endOffset(items[items.length - 1]) * 1000;
  return (end - nowMs) / 1000;
}

/** New duration (secs) for `item`, or null if it should stay as planned. */
function adaptedSecs({ items, item, mode, meetingStartMs, nowMs }) {
  if (!item || !items.length || mode === 'none' || !item.allowAdaptive || meetingStartMs == null) return null;

  const timeLeft = secsToPlannedEnd(items, meetingStartMs, nowMs);
  const required = remainingProgramSecs(items, item);
  const deviation = timeLeft - required;

  if (!(Math.abs(deviation) > SMALLEST_DEVIATION_SECS && Math.abs(deviation) <= LARGEST_DEVIATION_SECS)) return null;
  if (mode !== 'twoWay' && timeLeft >= required) return null; // time in hand, but we only shorten

  let adaptiveTotal = 0;
  let started = false;
  for (const it of items) {
    if (it.id === item.id) started = true;
    if (started && it.allowAdaptive) adaptiveTotal += it.durationSecs;
  }
  if (adaptiveTotal <= 0) return null;

  const share = item.durationSecs / adaptiveTotal;
  return Math.max(MIN_PART_SECS, Math.round(item.durationSecs + deviation * share));
}

/** Seconds ahead (+) / behind (-) of the planned end of the meeting, or null if not significant. */
function overrunSecs({ items, item, mode, meetingStartMs, nowMs }) {
  if (!item || !items.length || mode === 'none' || meetingStartMs == null) return null;
  const timeLeft = secsToPlannedEnd(items, meetingStartMs, nowMs);
  const required = remainingProgramSecs(items, item) + (INTERVAL_SONG_SECS[item.key] || 0);
  const deviation = timeLeft - required;
  const mins = Math.abs(deviation) / 60;
  return mins >= 2 && mins <= 20 ? Math.round(deviation) : null; // beyond 20 min is probably a mistake
}

class AdaptivePlanner {
  constructor({ mode = 'none', type = 'midweek' } = {}) {
    this.mode = mode;
    this.type = type;
    this.meetingStartMs = null;
  }

  reset(type) {
    if (type) this.type = type;
    this.meetingStartMs = null;
  }

  /** Call when a part is actually started: the first part of the meeting pins the start time. */
  noteStart(item, nowMs) {
    if (this.meetingStartMs == null && (STARTERS[this.type] || []).includes(item.key)) {
      this.meetingStartMs = nearest15Before(nowMs);
    }
  }

  evaluate(items, item, nowMs) {
    const args = { items, item, mode: this.mode, meetingStartMs: this.meetingStartMs, nowMs };
    return { adaptedSecs: adaptedSecs(args), overrunSecs: overrunSecs(args) };
  }
}

module.exports = { AdaptivePlanner, adaptedSecs, overrunSecs, nearest15Before, remainingProgramSecs };
