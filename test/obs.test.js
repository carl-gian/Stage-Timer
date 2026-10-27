'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ObsClient, authString } = require('../src/core/obs');
const { SceneSwitcher } = require('../src/core/sceneSwitcher');
const { StageService } = require('../src/core/service');
const { StageTimer } = require('../src/core/timer');
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
const sent = (obs) => obs.requests.filter((r) => r.type !== 'GetSceneList');
const types = (obs) => sent(obs).map((r) => r.type);
const at = (obs, type) => obs.requests.find((r) => r.type === type).at;

async function connected(fake, opts) {
  const client = new ObsClient();
  const switcher = new SceneSwitcher(client, opts);
  client.connect({ url: fake.url });
  await until(() => client.connected && switcher.scenes.length);
  return { client, switcher };
}

test('authentication string matches the obs-websocket documentation example', () => {
  const auth = authString('supersecretpassword', { challenge: '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=', salt: 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=' });
  assert.strictEqual(auth, '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=');
});

test('client: password handshake, wrong password stops retrying, drops reconnect', async () => {
  const fake = await startFakeObs({ password: 'secret' });
  const good = new ObsClient();
  good.connect({ url: fake.url, password: 'secret' });
  await until(() => good.connected);

  const bad = new ObsClient();
  bad.connect({ url: fake.url, password: 'nope' });
  await until(() => bad.state === 'auth-failed');
  await sleep(1300); // longer than the first retry delay
  assert.strictEqual(bad.state, 'auth-failed');
  bad.disconnect();

  fake.dropClients();
  await until(() => !good.connected);
  await until(() => good.connected, 5000);
  assert.deepStrictEqual(await good.request('GetStudioModeEnabled'), { studioModeEnabled: true });
  good.disconnect();
  await fake.close();
});

test('switch: Preview, wait, then Transition; short wait once the Bridge reacts', async () => {
  const fake = await startFakeObs({ bridge: true });
  const { client, switcher } = await connected(fake, { settleMs: 500 });
  assert.deepStrictEqual(switcher.scenes, ['A', 'B', 'C']);

  await switcher.switchTo('B');
  assert.deepStrictEqual(types(fake), ['GetStudioModeEnabled', 'GetCurrentProgramScene', 'SetCurrentPreviewScene', 'TriggerStudioModeTransition']);
  assert.deepStrictEqual(sent(fake)[2].data, { sceneName: 'B' });
  const gap = at(fake, 'TriggerStudioModeTransition') - at(fake, 'SetCurrentPreviewScene');
  assert.ok(gap >= 90 && gap < 400, `trigger should follow the Bridge's reaction closely, gap was ${gap}ms`);
  assert.strictEqual(fake.state.program, 'B');
  assert.strictEqual(switcher.last.outcome, 'sent');
  assert.strictEqual(switcher.problem, null);
  client.disconnect();
  await fake.close();
});

test('switch: with no reaction from the Bridge it waits the full settle time', async () => {
  const fake = await startFakeObs({ bridge: false });
  const { client, switcher } = await connected(fake, { settleMs: 300 });
  await switcher.switchTo('B');
  const gap = at(fake, 'TriggerStudioModeTransition') - at(fake, 'SetCurrentPreviewScene');
  assert.ok(gap >= 290, `expected the full 300ms wait, gap was ${gap}ms`);
  client.disconnect();
  await fake.close();
});

test('switch: scene already on air is left alone', async () => {
  const fake = await startFakeObs();
  const { client, switcher } = await connected(fake, { settleMs: 50 });
  await switcher.switchTo('A');
  assert.deepStrictEqual(types(fake), ['GetStudioModeEnabled', 'GetCurrentProgramScene']);
  assert.strictEqual(switcher.last.outcome, 'already-live');
  client.disconnect();
  await fake.close();
});

test('switch: reports Studio Mode off and unknown scenes without touching OBS', async () => {
  const fake = await startFakeObs({ studio: false });
  const { client, switcher } = await connected(fake, { settleMs: 50 });
  await switcher.switchTo('B');
  assert.match(switcher.problem, /Studio Mode/);
  assert.deepStrictEqual(types(fake), ['GetStudioModeEnabled']);

  fake.state.studio = true;
  await switcher.switchTo('Nope');
  assert.match(switcher.problem, /Nope/);
  await switcher.switchTo('B');
  assert.strictEqual(switcher.problem, null); // recovers on the next good switch
  client.disconnect();
  await fake.close();
});

test('switch: never overlaps transitions; only the latest queued scene runs', async () => {
  const fake = await startFakeObs({ bridge: true, transitionMs: 300 });
  const { client, switcher } = await connected(fake, { settleMs: 200 });
  const done = switcher.switchTo('B');
  switcher.switchTo('C');
  switcher.switchTo('A'); // replaces C
  await done;

  const previews = sent(fake).filter((r) => r.type === 'SetCurrentPreviewScene').map((r) => r.data.sceneName);
  assert.deepStrictEqual(previews, ['B', 'A']);
  const triggers = sent(fake).filter((r) => r.type === 'TriggerStudioModeTransition');
  assert.strictEqual(triggers.length, 2);
  assert.ok(triggers[1].at - triggers[0].at >= 290, 'second transition must wait for the first to end');
  assert.strictEqual(fake.state.program, 'A');
  client.disconnect();
  await fake.close();
});

test('switch: not connected is reported, not thrown', async () => {
  const switcher = new SceneSwitcher(new ObsClient());
  await switcher.switchTo('B');
  assert.match(switcher.problem, /Not connected/);
});

test('timer: part-start fires when a part begins, not when it resumes', () => {
  let t = 0;
  const timer = new StageTimer({ now: () => t });
  timer.setSchedule(buildSchedule({ type: 'weekend' }));
  const started = [];
  timer.on('part-start', (p) => started.push(p.key));
  timer.start();
  t += 1000;
  timer.pause();
  timer.start(); // resume
  assert.deepStrictEqual(started, ['public']);
  timer.reset();
  timer.start(); // restarted from zero
  timer.finish();
  timer.start(); // next part
  assert.deepStrictEqual(started, ['public', 'public', 'watchtower']);
});

test('settings: OBS values are validated and scene choices are saved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const service = new StageService({ dataDir: dir, now: () => new Date(2026, 9, 31) });
  const s = () => service.settings;
  assert.strictEqual(s().obsEnabled, false);

  await service.updateSettings({ obsUrl: ' localhost:4455 ', obsSettleMs: 99999 });
  assert.strictEqual(s().obsUrl, 'ws://localhost:4455');
  assert.strictEqual(s().obsSettleMs, 2000);
  await service.updateSettings({ obsUrl: 'ws://', obsSettleMs: 'abc' });
  assert.strictEqual(s().obsUrl, 'ws://localhost:4455');
  assert.strictEqual(s().obsSettleMs, 2000);

  service.assignScene({ meetingType: 'weekend', key: 'public', scene: 'FULL STAGE ---- (odd  spacing)' });
  service.assignScene({ meetingType: 'nonsense', key: 'public', scene: 'X' });
  service.assignScene({ meetingType: 'midweek', key: 'bad key!', scene: 'X' });
  assert.deepStrictEqual(s().obsScenes, { weekend: { public: 'FULL STAGE ---- (odd  spacing)' } });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).obsScenes, s().obsScenes);
  service.assignScene({ meetingType: 'weekend', key: 'public', scene: '' });
  assert.deepStrictEqual(s().obsScenes.weekend, {});
});

test('service: starting a part sends its scene; resuming, unassigned parts and a disabled link do nothing', async () => {
  const fake = await startFakeObs({ bridge: true, transitionMs: 50 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const service = new StageService({ dataDir: dir, now: () => new Date(2026, 9, 31) }); // a Saturday: weekend meeting
  await service.loadSchedule();
  service.assignScene({ meetingType: 'weekend', key: 'public', scene: 'B' });

  // link off: starting does nothing
  service.timer.start();
  await sleep(100);
  assert.strictEqual(fake.requests.length, 0);
  service.timer.reset();

  await service.updateSettings({ obsEnabled: true, obsUrl: fake.url, obsSettleMs: 100 });
  await until(() => service.obs.connected);
  assert.strictEqual(service.snapshot().obs.problem, null);

  service.timer.start();
  await until(() => types(fake).includes('TriggerStudioModeTransition'));
  await until(() => !service.switcher.busy);
  assert.strictEqual(fake.state.program, 'B');

  const count = fake.requests.length;
  service.timer.pause();
  service.timer.start(); // resume
  service.timer.finish(); // on to the Watchtower Study, which has no scene
  service.timer.start();
  await sleep(300);
  assert.strictEqual(fake.requests.length, count);

  await service.updateSettings({ obsEnabled: false });
  assert.strictEqual(service.obs.state, 'off');
  assert.strictEqual(service.snapshot().obs.problem, null);
  await fake.close();
});

test('service: control page is told when OBS cannot be reached', async () => {
  const fake = await startFakeObs();
  const url = fake.url;
  await fake.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const service = new StageService({ dataDir: dir, now: () => new Date(2026, 9, 31) });
  await service.updateSettings({ obsEnabled: true, obsUrl: url });
  await until(() => service.obs.state === 'waiting');
  const obs = service.snapshot().obs;
  assert.strictEqual(obs.enabled, true);
  assert.match(obs.problem, /reach OBS/);
  service.stopObs();
});
