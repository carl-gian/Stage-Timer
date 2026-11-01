'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createFirewall } = require('../src/firewall');

const RULE_OUT = (port, extra = '') => `Rule Name: Stage Timer\nEnabled: Yes\nDirection: In\nProtocol: TCP\nLocalPort: ${port}\nAction: Allow\n${extra}`;

test('firewall: does nothing and runs nothing outside Windows', async () => {
  let ran = 0;
  const fw = createFirewall({ platform: 'darwin', exec: async () => { ran++; return {}; } });
  assert.strictEqual(fw.supported, false);
  assert.strictEqual(await fw.status(80), 'unknown');
  assert.strictEqual((await fw.open(80)).ok, false);
  assert.strictEqual(ran, 0);
});

test('firewall: status reads the rule for this port', async () => {
  const say = (stdout, error = null) => createFirewall({ platform: 'win32', exec: async () => ({ error, stdout }) });
  assert.strictEqual(await say(RULE_OUT(80)).status(80), 'open');
  assert.strictEqual(await say(RULE_OUT(4580)).status(80), 'closed');
  assert.strictEqual(await say('No rules match the specified criteria.', new Error('exit 1')).status(80), 'closed');
  assert.strictEqual(await say('', new Error('netsh missing')).status(80), 'unknown');
});

test('firewall: opening asks Windows for permission, adds both rules, and checks the result', async () => {
  const calls = [];
  let added = false;
  const exec = async (file, args) => {
    calls.push([file, args]);
    if (file === 'powershell.exe') { added = true; return { error: null, stdout: '' }; }
    return { error: null, stdout: added ? RULE_OUT(80) : 'No rules match the specified criteria.' };
  };
  const fw = createFirewall({ platform: 'win32', exec });
  assert.deepStrictEqual(await fw.open(80), { ok: true });
  const ps = calls.find(([f]) => f === 'powershell.exe')[1].join(' ');
  assert.match(ps, /-Verb RunAs/);
  assert.match(ps, /localport=80 /);
  assert.match(ps, /protocol=UDP localport=5353/);
});

test('firewall: a cancelled permission prompt is reported, and a bad port is refused', async () => {
  const fw = createFirewall({ platform: 'win32', exec: async () => ({ error: new Error('cancelled'), stdout: '' }) });
  const r = await fw.open(80);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /cancelled/);
  assert.strictEqual((await fw.open('80; calc')).ok, false);
});
