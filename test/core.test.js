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
  for (const page of ['/display', '/control', '/dock', '/steward.css', '/art.js']) assert.strictEqual((await fetch(base + page)).status, 200);
  const font = await fetch(base + '/noto-sans.woff2');
  assert.strictEqual(font.headers.get('content-type'), 'font/woff2');
  await server.close();
});

test('a new day: the right meeting is loaded, but never while a part is running or paused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  let today = new Date(2026, 9, 31, 12); // Saturday
  const offline = async () => { throw new Error('offline'); };
  const service = new StageService({ dataDir: dir, now: () => today, fetchImpl: offline });
  await service.loadSchedule();
  assert.strictEqual(service.timer.meta.meetingType, 'weekend');

  service.timer.select(2);
  today = new Date(2026, 10, 1, 12); // Sunday: still the weekend meeting, left as it is
  await service.refreshForToday();
  assert.strictEqual(service.timer.currentId, 2);

  today = new Date(2026, 10, 2, 12); // Monday: midweek, but a part is under way
  service.timer.start();
  await service.refreshForToday();
  assert.strictEqual(service.timer.meta.meetingType, 'weekend');
  await new Promise((r) => setTimeout(r, 20)); // some time on the clock before the pause
  service.timer.pause();
  await service.refreshForToday();
  assert.strictEqual(service.timer.meta.meetingType, 'weekend');
  service.timer.reset();
  await service.refreshForToday();
  assert.strictEqual(service.timer.meta.meetingType, 'midweek');

  // Midweek chosen by hand: a new week still brings that week's parts.
  await service.updateSettings({ meetingMode: 'midweek' });
  service.timer.select(3);
  today = new Date(2026, 10, 3, 12); // Tuesday, same week
  await service.refreshForToday();
  assert.strictEqual(service.timer.currentId, 3);
  today = new Date(2026, 10, 9, 12); // next Monday
  await service.refreshForToday();
  assert.strictEqual(service.timer.currentId, 1);
});

test('a new day switches meeting at once, and the week downloads after', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  let today = new Date(2026, 9, 25, 12); // Sunday
  let release;
  const slow = () => new Promise((resolve) => (release = () => resolve({ ok: true, text: async () => JSON.stringify(feedList) })));
  const service = new StageService({ dataDir: dir, now: () => today, fetchImpl: slow });
  await service.loadSchedule();
  assert.strictEqual(service.timer.meta.meetingType, 'weekend');

  today = new Date(2026, 9, 26, 12); // Monday: switch without waiting for the download
  await service.refreshForToday();
  assert.strictEqual(service.timer.meta.meetingType, 'midweek');
  assert.strictEqual(service.timer.meta.scheduleSource, 'pending');
  const quick = service.timer.items;
  release();
  await service.pendingDownload;
  assert.strictEqual(service.timer.meta.scheduleSource, 'network');
  assert.notStrictEqual(service.timer.items, quick); // this week's downloaded parts replaced the stand-ins
});

test('a downloaded week never replaces the parts once one is under way', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  let today = new Date(2026, 9, 25, 12);
  let release;
  const slow = () => new Promise((resolve) => (release = () => resolve({ ok: true, text: async () => JSON.stringify(feedList) })));
  const service = new StageService({ dataDir: dir, now: () => today, fetchImpl: slow });
  await service.loadSchedule();
  today = new Date(2026, 9, 26, 12);
  await service.refreshForToday();
  const before = service.timer.items;
  service.timer.select(before[1].id);
  service.timer.start();
  release();
  await service.pendingDownload;
  assert.strictEqual(service.timer.items, before);
  assert.strictEqual(service.timer.running, true);
  assert.strictEqual(service.timer.meta.scheduleSource, 'none'); // the control page offers "Try again"
});

test('current-time clock: off by default, 12- or 24-hour, sent to the pages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const service = new StageService({ dataDir: dir, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepStrictEqual(service.snapshot().clock, { show: false, format: '12h' });

  await service.updateSettings({ showClock: true, clockFormat: '24h' });
  assert.deepStrictEqual(service.snapshot().clock, { show: true, format: '24h' });
  await service.updateSettings({ clockFormat: 'sundial', showClock: 'yes' });
  assert.deepStrictEqual(service.snapshot().clock, { show: false, format: '24h' });
});

test('theme: follows Windows by default, can be light or dark, sent to the pages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const service = new StageService({ dataDir: dir, fetchImpl: async () => { throw new Error('offline'); } });
  assert.strictEqual(service.snapshot().theme, 'auto');
  await service.updateSettings({ theme: 'dark' });
  assert.strictEqual(service.snapshot().theme, 'dark');
  await service.updateSettings({ theme: 'purple' });
  assert.strictEqual(service.settings.theme, 'dark');
});

test('current-time clock text', () => {
  const ST = require('../web/client.js');
  assert.deepStrictEqual(ST.clockTime(new Date(2026, 9, 31, 19, 5), '12h'), { time: '7:05', ampm: 'PM' });
  assert.deepStrictEqual(ST.clockTime(new Date(2026, 9, 31, 0, 30), '12h'), { time: '12:30', ampm: 'AM' });
  assert.deepStrictEqual(ST.clockTime(new Date(2026, 9, 31, 12, 0), '12h'), { time: '12:00', ampm: 'PM' });
  assert.deepStrictEqual(ST.clockTime(new Date(2026, 9, 31, 19, 5), '24h'), { time: '19:05', ampm: '' });
  assert.deepStrictEqual(ST.clockTime(new Date(2026, 9, 31, 7, 5), '24h'), { time: '07:05', ampm: '' });
});

test('network: status and refresh work, with or without a friendly name', async () => {
  const service = new StageService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), now: () => new Date('2026-10-28T19:00:00') });
  const server = createServer(service, { mdns: false });
  const port = await server.start(45815);
  const base = `http://127.0.0.1:${port}`;
  const info = await (await fetch(base + '/api/network')).json();
  assert.strictEqual(info.name, null); // no announcing in tests
  assert.ok(Array.isArray(info.addresses));
  const again = await (await fetch(base + '/api/network/refresh', { method: 'POST' })).json();
  assert.strictEqual(again.port, port);
  assert.strictEqual((await server.refreshNetwork()).name, null);
  await server.close();
});

test('start time: set per meeting type, overridden for one meeting, and used as the base', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const wed = new Date('2026-10-28T18:40:00'); // a Wednesday
  const service = new StageService({ dataDir: dir, now: () => wed });
  assert.strictEqual(service.baseStart(), null); // nothing set: worked out from the first part, as before

  await service.updateSettings({ startTimes: { midweek: '19:00' } });
  await service.updateSettings({ startTimes: { weekend: 'soon' } }); // junk is dropped, the other one is kept
  assert.deepStrictEqual(service.settings.startTimes, { midweek: '19:00', weekend: '' });
  const b = service.baseStart();
  assert.deepStrictEqual([b.time, b.source, b.ms], ['19:00', 'set', new Date('2026-10-28T19:00:00').getTime()]);
  assert.strictEqual(service.snapshot().base.time, '19:00');

  assert.strictEqual(service.setStartOverride('25:99'), false);
  assert.strictEqual(service.setStartOverride('19:30'), true);
  assert.deepStrictEqual([service.baseStart().time, service.baseStart().source], ['19:30', 'override']);

  const next = new StageService({ dataDir: dir, now: () => new Date('2026-11-04T18:40:00') }); // the next week
  assert.deepStrictEqual([next.baseStart().time, next.baseStart().source], ['19:00', 'set']);
  const same = new StageService({ dataDir: dir, now: () => new Date('2026-10-28T18:50:00') }); // restarted the same day
  assert.strictEqual(same.baseStart().time, '19:30');
  assert.strictEqual(same.setStartOverride(''), true);
  assert.strictEqual(same.baseStart().time, '19:00');
});

test('start time: adaptive timing measures from the set start, not from when the first part was pressed', async () => {
  const { StageTimer } = require('../src/core/timer');
  const items = buildSchedule({ type: 'midweek', meeting: null }).map((i, n) => ({ id: n + 1, ...i }));
  let nowMs = new Date('2026-10-28T19:45:00').getTime(); // 45 minutes after a 7:00 start
  const timer = new StageTimer({ now: () => nowMs, adaptiveMode: 'twoWay' });
  timer.planner.startProvider = () => new Date('2026-10-28T19:00:00').getTime();
  timer.setSchedule(items, { meetingType: 'midweek' });
  const living = items.find((i) => i.key === 'living1');
  timer.select(living.id);
  const it = timer.items.find((i) => i.id === living.id);
  assert.ok(it.adaptedSecs > it.durationSecs, 'ahead of schedule: the part is lengthened'); // no first part was ever started
});

test('zoom raise hand: shows for 45 seconds, then Cancel, Stop and the unmute alert', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const service = new StageService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'st-')) });
  const events = [];
  service.on('raise', () => events.push(service.raise && service.raise.mode));

  assert.strictEqual(service.snapshot().raise, null);
  service.raiseHand();
  assert.strictEqual(service.snapshot().raise.mode, 'hand');
  assert.strictEqual(service.raise.endsAt - Date.now(), 45000);
  t.mock.timers.tick(44999);
  assert.strictEqual(service.raise.mode, 'hand');
  t.mock.timers.tick(1);
  assert.strictEqual(service.raise, null); // gone by itself after 45 s

  service.raiseHand(); // the unmute alert keeps the same 45 seconds
  t.mock.timers.tick(10000);
  const endsAt = service.raise.endsAt;
  service.raiseUnmute();
  assert.deepStrictEqual([service.raise.mode, service.raise.endsAt], ['unmute', endsAt]);
  t.mock.timers.tick(35000);
  assert.strictEqual(service.raise, null);

  service.raiseHand(); // Cancel: "cancelled" for 5 seconds, then the timer
  service.raiseCancel();
  assert.strictEqual(service.raise.mode, 'cancelled');
  t.mock.timers.tick(4999);
  assert.strictEqual(service.raise.mode, 'cancelled');
  t.mock.timers.tick(1);
  assert.strictEqual(service.raise, null);

  service.raiseHand(); // Stop: straight back to the timer
  service.raiseStop();
  assert.strictEqual(service.raise, null);

  service.raiseUnmute(); // nothing showing: nothing to do
  service.raiseCancel();
  assert.strictEqual(service.raise, null);
  service.raiseHand();
  service.raiseCancel();
  service.raiseUnmute(); // already cancelled: the alert does not bring it back
  assert.strictEqual(service.raise.mode, 'cancelled');
  assert.deepStrictEqual(events.slice(0, 3), ['hand', null, 'hand']);
});

test('zoom raise hand: the controller commands work over the API', async () => {
  const service = new StageService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'st-')) });
  const server = createServer(service, { mdns: false });
  const port = await server.start(45816);
  const base = `http://127.0.0.1:${port}`;
  const state = async () => (await fetch(base + '/api/state')).json();
  const post = (cmd) => fetch(`${base}/api/timer/${cmd}`, { method: 'POST', headers: { 'x-pin': service.settings.pin } });
  await post('raiseHand');
  assert.strictEqual((await state()).raise.mode, 'hand');
  await post('raiseUnmute');
  assert.strictEqual((await state()).raise.mode, 'unmute');
  await post('raiseCancel');
  assert.strictEqual((await state()).raise.mode, 'cancelled');
  await post('raiseHand');
  await post('raiseStop');
  assert.strictEqual((await state()).raise, null);
  await server.close();
});

test('zoom raise hand: can be turned off, and turning it off clears one that is showing', async () => {
  const service = new StageService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'st-')) });
  assert.strictEqual(service.settings.zoomRaiseHand, true); // on by default
  assert.strictEqual(service.snapshot().raiseEnabled, true);
  service.raiseHand();
  await service.updateSettings({ zoomRaiseHand: false });
  assert.strictEqual(service.raise, null);
  assert.strictEqual(service.snapshot().raiseEnabled, false);
  service.raiseHand(); // the button is gone, and the command does nothing
  assert.strictEqual(service.raise, null);
  await service.updateSettings({ zoomRaiseHand: true });
  service.raiseHand();
  assert.strictEqual(service.raise.mode, 'hand');
  service.raiseStop();
});

test('zoom raise hand: the name of the person is shown and starts the 45 seconds again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const service = new StageService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'st-')) });
  assert.strictEqual(service.raiseName('Maria'), false); // nothing showing: nowhere to put a name
  service.raiseHand();
  t.mock.timers.tick(30000);
  assert.strictEqual(service.raiseName('  Maria   Santos  '), true);
  assert.deepStrictEqual([service.raise.mode, service.raise.name], ['hand', 'Maria Santos']);
  assert.strictEqual(service.raise.endsAt - Date.now(), 45000); // a full 45 seconds again
  t.mock.timers.tick(44999);
  assert.strictEqual(service.raise.name, 'Maria Santos');
  service.raiseUnmute(); // the name stays on the alert
  assert.deepStrictEqual([service.raise.mode, service.raise.name], ['unmute', 'Maria Santos']);
  assert.strictEqual(service.raiseName('   '), false); // an empty name changes nothing
  assert.strictEqual(service.raiseName('x'.repeat(100)), true);
  assert.strictEqual(service.raise.name.length, 60);
  t.mock.timers.tick(45000);
  assert.strictEqual(service.raise, null);
  service.raiseHand();
  service.raiseName('Jose');
  service.raiseCancel(); // "cancelled" has no name, and a name can't be added to it
  assert.strictEqual(service.raise.name, undefined);
  assert.strictEqual(service.raiseName('Jose'), false);
});
