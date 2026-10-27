'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildSchedule } = require('../src/core/schedule');
const { StageTimer } = require('../src/core/timer');
const { AdaptivePlanner, nearest15Before } = require('../src/core/adaptive');

const at = (h, m, s = 0) => new Date(2026, 9, 28, h, m, s).getTime();
const midweek = () => buildSchedule({ type: 'midweek', meeting: null });
const byKey = (items, k) => items.find((i) => i.key === k);

// Meeting starts 18:00 -> living part 1 is due at 18:51:40, meeting ends 19:40.
function evalAt(mode, nowMs, key = 'living1') {
  const items = midweek();
  const p = new AdaptivePlanner({ mode, type: 'midweek' });
  p.noteStart(byKey(items, 'opening'), at(18, 5));
  return p.evaluate(items, byKey(items, key), nowMs);
}

test('start time snaps back to the nearest quarter hour', () => {
  assert.strictEqual(nearest15Before(at(18, 5)), at(18, 0));
  assert.strictEqual(nearest15Before(at(18, 20)), at(18, 15));
  assert.strictEqual(nearest15Before(at(18, 35)), at(18, 30));
  assert.strictEqual(nearest15Before(at(18, 50)), at(18, 45));
});

test('running 4 min late shortens a living part in proportion', () => {
  // adaptive parts from living1: 900 + 1800 + 180 = 2880 s -> living1 takes 900/2880 of the 240 s
  assert.strictEqual(evalAt('oneWay', at(18, 55, 40)).adaptedSecs, 825);
  assert.strictEqual(evalAt('twoWay', at(18, 55, 40)).adaptedSecs, 825);
});

test('running early only lengthens in two-way mode', () => {
  assert.strictEqual(evalAt('oneWay', at(18, 47, 40)).adaptedSecs, null);
  assert.strictEqual(evalAt('twoWay', at(18, 47, 40)).adaptedSecs, 975);
});

test('no change when off, on time, wildly out, or part is not adaptive', () => {
  assert.strictEqual(evalAt('none', at(18, 55, 40)).adaptedSecs, null);
  assert.strictEqual(evalAt('twoWay', at(18, 51, 50)).adaptedSecs, null); // 10 s off
  assert.strictEqual(evalAt('twoWay', at(19, 20)).adaptedSecs, null); // > 15 min out
  assert.strictEqual(evalAt('twoWay', at(18, 40), 'reading').adaptedSecs, null);
});

test('overrun is reported between 2 and 20 minutes, allowing for the interval song', () => {
  assert.strictEqual(evalAt('oneWay', at(18, 55, 40)).overrunSecs, -450);
  assert.strictEqual(evalAt('oneWay', at(18, 48, 10)).overrunSecs, null); // on time as the interval song begins
  assert.strictEqual(evalAt('none', at(18, 55, 40)).overrunSecs, null);
});

test('without a meeting start time nothing is adapted', () => {
  const items = midweek();
  const p = new AdaptivePlanner({ mode: 'twoWay', type: 'midweek' });
  p.noteStart(byKey(items, 'living1'), at(18, 55, 40)); // not a "starter" part
  assert.strictEqual(p.evaluate(items, byKey(items, 'living1'), at(18, 55, 40)).adaptedSecs, null);
});

test('timer: start of opening pins the meeting, later part adapts on select', () => {
  let now = at(18, 5);
  const timer = new StageTimer({ now: () => now, adaptiveMode: 'oneWay' });
  timer.setSchedule(midweek(), { meetingType: 'midweek' });
  timer.start();
  now += 60000;
  timer.pause();

  now = at(18, 55, 40);
  const id = byKey(timer.items, 'living1').id;
  timer.select(id);
  assert.strictEqual(timer.snapshot().targetSecs, 825);
  assert.strictEqual(timer.snapshot().overrunSecs, -450);

  // planned time changes recalc from the planned value (no compounding)
  timer.adjust(60);
  assert.strictEqual(byKey(timer.items, 'living1').durationSecs, 960);
  const t1 = timer.snapshot().targetSecs;
  timer.adjust(0);
  assert.strictEqual(timer.snapshot().targetSecs, t1);

  // once running, the target is frozen apart from manual adjustments
  timer.start();
  const running = timer.snapshot().targetSecs;
  now += 600000;
  timer.adjust(30);
  assert.strictEqual(timer.snapshot().targetSecs, running + 30);
});
