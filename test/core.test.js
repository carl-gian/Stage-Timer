'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSchedule, detectMeetingType, mondayKey } = require('../src/core/schedule');
const { StageTimer } = require('../src/core/timer');
const { getMeetingForWeek } = require('../src/core/feed');
const { StageService } = require('../src/core/service');
const { createServer } = require('../src/core/server');

const feedList = [
  {
    Date: '2026-10-26T00:00:00',
    Talks: [
      { TalkType: 100, Minutes: 4, IsStudentTalk: false },
      { TalkType: 101, Minutes: 3, IsStudentTalk: true },
      { TalkType: 300, Minutes: 12 },
      { TalkType: 301, Minutes: 8 },
    ],
  },
];

test('feed with camelCase keys (as published) is understood', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const camel = [
    { date: '2026-10-25T00:00:00', talks: [], songNumbers: [1] },
    { date: '2026-10-26T00:00:00', talks: [{ talkType: 100, minutes: 3, isStudentTalk: true }, { talkType: 300, minutes: 15, isStudentTalk: false }] },
  ];
  const ok = async () => ({ ok: true, text: async () => JSON.stringify(camel) });
  const r = await getMeetingForWeek({ cachePath: path.join(dir, 'f.json'), now: new Date(2026, 9, 27), fetchImpl: ok });
  assert.strictEqual(r.source, 'network');
  const s = buildSchedule({ type: 'midweek', meeting: r.meeting });
  assert.strictEqual(s.find((i) => i.key === 'ministry1').durationSecs, 180);
  assert.strictEqual(s.find((i) => i.key === 'ministry1').isStudentTalk, true);
  assert.strictEqual(s.find((i) => i.key === 'living1').durationSecs, 900);
});

test('week + meeting type detection', () => {
  assert.strictEqual(mondayKey(new Date(2026, 9, 28)), '2026-10-26'); // Wed
  assert.strictEqual(mondayKey(new Date(2026, 9, 25)), '2026-10-19'); // Sun belongs to previous Monday
  assert.strictEqual(detectMeetingType(new Date(2026, 9, 28)), 'midweek');
  assert.strictEqual(detectMeetingType(new Date(2026, 9, 31)), 'weekend');
  assert.strictEqual(detectMeetingType(new Date(2026, 10, 1)), 'weekend');
});

test('midweek schedule uses feed minutes', () => {
  const s = buildSchedule({ type: 'midweek', meeting: feedList[0] });
  const by = Object.fromEntries(s.map((i) => [i.key, i.durationSecs]));
  assert.strictEqual(by.ministry1, 240);
  assert.strictEqual(by.ministry2, 180);
  assert.strictEqual(by.ministry3, undefined);
  assert.strictEqual(by.living1, 720);
  assert.strictEqual(by.living2, 480);
  assert.strictEqual(by.study, 1800);
  assert.deepStrictEqual(s.map((i) => i.id), s.map((_, i) => i + 1));
});

test('schedule without feed falls back to defaults', () => {
  const s = buildSchedule({ type: 'midweek', meeting: null });
  assert.strictEqual(s.filter((i) => i.section === 'ministry').length, 4);
});

test('weekend schedules', () => {
  assert.deepStrictEqual(buildSchedule({ type: 'weekend' }).map((i) => i.durationSecs), [1800, 3600]);
  assert.strictEqual(buildSchedule({ type: 'weekend', circuitVisit: true }).length, 3);
});

test('timer start/stop/adjust/select with fake clock', () => {
  let t = 1000;
  const timer = new StageTimer({ now: () => t });
  timer.setSchedule(buildSchedule({ type: 'weekend' }));
  timer.start();
  t += 5000;
  assert.strictEqual(timer.elapsedMs(), 5000);
  timer.pause();
  t += 9000;
  assert.strictEqual(timer.elapsedMs(), 5000);
  timer.start();
  t += 1000;
  assert.strictEqual(timer.elapsedMs(), 6000);
  timer.adjust(60);
  assert.strictEqual(timer.snapshot().targetSecs, 1860);
  timer.adjust(-99999);
  assert.strictEqual(timer.snapshot().targetSecs, 10);
  timer.select(2);
  assert.strictEqual(timer.running, false);
  assert.strictEqual(timer.elapsedMs(), 0);
  assert.strictEqual(timer.select(99), false);
});

test('stop finishes the part and lines up the next one', () => {
  let t = 0;
  const timer = new StageTimer({ now: () => t });
  timer.setSchedule(buildSchedule({ type: 'weekend' }));
  timer.finish(); // nothing started yet: stays put
  assert.strictEqual(timer.currentId, 1);

  timer.start();
  t += 61000;
  timer.finish();
  assert.strictEqual(timer.items[0].completedSecs, 61);
  assert.strictEqual(timer.currentId, 2);
  assert.strictEqual(timer.running, false);
  assert.strictEqual(timer.elapsedMs(), 0);

  // pausing keeps the part; stopping a paused part also finishes it
  timer.start();
  t += 10000;
  timer.pause();
  assert.strictEqual(timer.currentId, 2);
  timer.finish();
  assert.strictEqual(timer.items[1].completedSecs, 10);
  assert.strictEqual(timer.currentId, 2); // last part: stays, ready to go again
});

test('feed: network, cache, stale fallback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const cachePath = path.join(dir, 'feed.json');
  const now = new Date(2026, 9, 28);
  let calls = 0;
  const ok = async () => (calls++, { ok: true, text: async () => JSON.stringify(feedList) });
  const bad = async () => { throw new Error('offline'); };

  let r = await getMeetingForWeek({ cachePath, now, fetchImpl: ok });
  assert.strictEqual(r.source, 'network');
  r = await getMeetingForWeek({ cachePath, now, fetchImpl: ok });
  assert.strictEqual(r.source, 'cache');
  assert.strictEqual(calls, 1);
  r = await getMeetingForWeek({ cachePath, now, fetchImpl: bad, force: true });
  assert.strictEqual(r.source, 'stale-cache');
  assert.ok(r.meeting);
  r = await getMeetingForWeek({ cachePath: path.join(dir, 'none.json'), now, fetchImpl: bad });
  assert.strictEqual(r.source, 'none');
});

test('http api: PIN, commands, state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const ok = async () => ({ ok: true, text: async () => JSON.stringify(feedList) });
  const service = new StageService({ dataDir: dir, now: () => new Date(2026, 9, 28), fetchImpl: ok });
  service.settings.localNoPin = false;
  await service.loadSchedule();
  const server = createServer(service, { mdns: false });
  const port = await server.start(45811);
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body, pin) =>
    fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(pin ? { 'x-pin': pin } : {}) }, body: JSON.stringify(body || {}) });

  assert.strictEqual((await post('/api/timer/start')).status, 401);
  assert.strictEqual((await post('/api/timer/start', {}, service.settings.pin)).status, 200);
  assert.strictEqual((await (await fetch(base + '/api/state')).json()).running, true);
  await post('/api/timer/adjust', { deltaSeconds: 30 }, service.settings.pin);
  assert.strictEqual((await (await post('/api/timer/stop', {}, service.settings.pin)).json()).currentId, 2);
  const conn = await fetch(base + '/api/connect', { headers: { 'x-pin': service.settings.pin } });
  const info = await conn.json();
  assert.ok(info.qr.includes('<svg') && info.pin === service.settings.pin && info.control.endsWith('/control'));
  assert.strictEqual((await fetch(base + '/api/connect')).status, 401);
  await post('/api/timer/select', { talkId: 3 }, service.settings.pin);
  const st = await (await fetch(base + '/api/state')).json();
  assert.strictEqual(st.currentId, 3);
  assert.strictEqual(st.running, false);
  for (const page of ['/display', '/control', '/dock']) assert.strictEqual((await fetch(base + page)).status, 200);
  await server.close();
});
