'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StageService } = require('../src/core/service');
const { StageTimer } = require('../src/core/timer');
const { createServer } = require('../src/core/server');
const { buildSchedule } = require('../src/core/schedule');
const { startFakeObs } = require('./fake-obs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await sleep(10);
  }
}
const feed = async () => ({ ok: true, text: async () => JSON.stringify([{ Date: '2026-10-26T00:00:00', Talks: [] }]) });

/** A midweek service with a controllable clock: run(key, seconds) times a whole part and stops it. */
async function midweek() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  let tick = 0; // distinct report ids even though the wall clock is fixed
  const service = new StageService({ dataDir: dir, now: () => new Date(2026, 9, 28, 19, 30, tick++), fetchImpl: feed });
  await service.loadSchedule();
  let t = 0;
  service.timer.now = () => t;
  const run = (key, seconds, { adjust = 0 } = {}) => {
    service.timer.select(service.timer.items.find((i) => i.key === key).id);
    if (adjust) service.timer.adjust(adjust);
    service.timer.start();
    t += seconds * 1000;
    service.timer.finish();
  };
  return { dir, service, run };
}

test('timer: stopping a part announces it and remembers the target it was timed against', () => {
  let t = 0;
  const timer = new StageTimer({ now: () => t });
  timer.setSchedule(buildSchedule({ type: 'weekend' }));
  const finished = [];
  timer.on('part-finish', (p) => finished.push([p.key, p.completedSecs, p.completedTargetSecs]));
  timer.finish(); // nothing started: nothing to announce
  timer.start();
  timer.adjust(60);
  t += 1900000;
  timer.finish();
  assert.deepStrictEqual(finished, [['public', 1900, 1860]]);
});

test('report: over and under are measured against the target the clock counted to', async () => {
  const { service, run } = await midweek();
  run('opening', 70); // 1:00 planned -> 10 s over
  run('treasures', 580, { adjust: 30 }); // 10:00 planned, extended to 10:30 -> 50 s under
  run('digging', 600); // exactly on time
  const r = service.makeReport();

  const by = Object.fromEntries(r.parts.map((p) => [p.key, p]));
  assert.deepStrictEqual([by.opening.plannedSecs, by.opening.actualSecs, by.opening.diffSecs], [60, 70, 10]);
  assert.deepStrictEqual([by.treasures.plannedSecs, by.treasures.targetSecs, by.treasures.actualSecs, by.treasures.diffSecs], [600, 630, 580, -50]);
  assert.strictEqual(by.digging.diffSecs, 0);
  assert.strictEqual(by.reading.actualSecs, null); // not timed yet
  assert.strictEqual(by.reading.diffSecs, null);
  assert.deepStrictEqual(
    { timed: r.totals.timedParts, over: r.totals.overParts, under: r.totals.underParts, onTime: r.totals.onTimeParts, net: r.totals.diffSecs, actual: r.totals.actualSecs },
    { timed: 3, over: 1, under: 1, onTime: 1, net: -40, actual: 1250 },
  );
  assert.strictEqual(r.trigger, null);
});

test('report: made when the Bible Study is stopped, not for Concluding Comments, and remembered', async () => {
  const { dir, service, run } = await midweek();
  run('opening', 60);
  run('living1', 900);
  assert.strictEqual(service.reports.list().length, 0);
  assert.strictEqual(service.snapshot().report, null);

  let announced = 0;
  service.on('report', () => announced++);
  run('study', 1850); // 50 s over
  assert.strictEqual(announced, 1);
  const [only] = service.reports.list();
  const saved = service.reports.get(only.id);
  assert.strictEqual(saved.trigger, 'Congregation Bible Study');
  assert.strictEqual(saved.parts.find((p) => p.key === 'study').diffSecs, 50);
  assert.strictEqual(saved.totals.timedParts, 3);
  assert.strictEqual(service.snapshot().report.id, only.id);

  run('concluding', 180);
  assert.strictEqual(service.reports.list().length, 1);

  const reopened = new StageService({ dataDir: dir, fetchImpl: feed });
  assert.strictEqual(reopened.snapshot().report.id, only.id);
});

test('report: the Watchtower Study makes one on the weekend', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const service = new StageService({ dataDir: dir, now: () => new Date(2026, 9, 31, 10, 0, 0), fetchImpl: feed });
  await service.loadSchedule();
  let t = 0;
  service.timer.now = () => t;
  service.timer.start();
  t += 1800000;
  service.timer.finish(); // Public Talk
  assert.strictEqual(service.reports.list().length, 0);
  service.timer.start();
  t += 3500000;
  service.timer.finish(); // Watchtower Study, 100 s under
  const [r] = service.reports.list();
  assert.strictEqual(r.meetingType, 'weekend');
  assert.strictEqual(service.reports.get(r.id).trigger, 'Watchtower Study');
  assert.strictEqual(r.diffSecs, -100);
});

test('report: web page and API', async () => {
  const { service, run } = await midweek();
  run('study', 1800);
  const server = createServer(service, { mdns: false });
  const port = await server.start(45813);
  const base = `http://127.0.0.1:${port}`;

  const latest = await (await fetch(`${base}/api/report`)).json();
  assert.strictEqual(latest.trigger, 'Congregation Bible Study');
  assert.strictEqual((await fetch(`${base}/api/report?id=${latest.id}`)).status, 200);
  assert.strictEqual((await fetch(`${base}/api/report?id=..%2Fsettings`)).status, 404); // no wandering outside the reports folder
  assert.strictEqual((await fetch(`${base}/api/report?id=nope`)).status, 404);
  assert.strictEqual((await (await fetch(`${base}/api/reports`)).json()).length, 1);
  assert.strictEqual((await fetch(`${base}/report`)).status, 200);
  assert.strictEqual((await (await fetch(`${base}/api/state`)).json()).report.id, latest.id);

  const made = await fetch(`${base}/api/timer/report`, { method: 'POST' }); // host computer: no PIN needed
  assert.strictEqual(made.status, 200);
  assert.strictEqual((await (await fetch(`${base}/api/reports`)).json()).length, 2);
  await server.close();
});

test('default scene: stopping a part shows it, unless it is already on air or none is set', async () => {
  const fake = await startFakeObs({ bridge: true, transitionMs: 50, program: 'A' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const service = new StageService({ dataDir: dir, now: () => new Date(2026, 9, 31, 10, 0, 0), fetchImpl: feed }); // weekend
  await service.loadSchedule();
  const triggers = () => fake.requests.filter((r) => r.type === 'TriggerStudioModeTransition').length;

  await service.updateSettings({ obsEnabled: true, obsUrl: fake.url, obsSettleMs: 100 });
  await until(() => service.obs.connected);
  service.timer.start();
  service.timer.finish(); // no default scene yet
  await sleep(300);
  assert.strictEqual(fake.requests.filter((r) => r.type === 'SetCurrentPreviewScene').length, 0);

  await service.updateSettings({ obsDefaultScene: 123 }); // not a scene name: ignored
  assert.strictEqual(service.settings.obsDefaultScene, '');
  await service.updateSettings({ obsDefaultScene: 'C' });
  service.timer.start();
  service.timer.finish(); // stopping the Watchtower Study: default scene, and a report too
  await until(() => triggers() === 1 && fake.state.program === 'C');
  assert.strictEqual(service.reports.list().length, 1);

  service.timer.start();
  service.timer.finish(); // C is already on air
  await sleep(300);
  assert.strictEqual(triggers(), 1);

  await service.updateSettings({ obsEnabled: false });
  await fake.close();
});

test('pdf: file names, never overwriting, and the saved path is remembered', async () => {
  const { pdfName } = require('../src/core/report');
  const { uniquePath } = require('../src/pdf');
  assert.strictEqual(pdfName({ meetingType: 'midweek', createdAt: new Date(2026, 9, 27, 20, 5).toISOString() }), 'MIDWEEK Time Report 10-27-2026.pdf');
  assert.strictEqual(pdfName({ meetingType: 'weekend', createdAt: new Date(2026, 0, 4, 11, 0).toISOString() }), 'WEEKEND Time Report 01-04-2026.pdf');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const first = uniquePath(dir, 'MIDWEEK Time Report 10-27-2026.pdf');
  assert.strictEqual(path.basename(first), 'MIDWEEK Time Report 10-27-2026.pdf');
  fs.writeFileSync(first, 'x');
  assert.strictEqual(path.basename(uniquePath(dir, 'MIDWEEK Time Report 10-27-2026.pdf')), 'MIDWEEK Time Report 10-27-2026 (2).pdf');

  const { service, run } = await midweek();
  let announced;
  service.on('report', (r) => (announced = r));
  run('study', 1800);
  assert.strictEqual(announced.id, service.latestReport.id); // the event carries the report, for the PDF writer
  service.attachPdf(announced.id, first);
  assert.strictEqual(service.reports.list()[0].pdfPath, first);
  assert.strictEqual(service.reports.get(announced.id).totals.timedParts, 1); // rest of the report untouched
});
