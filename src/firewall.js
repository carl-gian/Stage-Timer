'use strict';

const { execFile } = require('child_process');

const RULE = 'Stage Timer';
const RULE_DISCOVERY = 'Stage Timer discovery';

const run = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 120000 }, (error, stdout) => resolve({ error, stdout: String(stdout || '') }));
  });

/**
 * Windows Firewall access for other devices: an inbound rule for the timer's port (and for the "stage.local"
 * name announcements). Only Windows needs this; elsewhere `supported` is false and nothing is run.
 * `exec(file, args)` is replaceable for tests.
 */
function createFirewall({ platform = process.platform, exec = run } = {}) {
  const supported = platform === 'win32';

  /** 'open' | 'closed' | 'unknown' for this TCP port. */
  async function status(port) {
    if (!supported) return 'unknown';
    const { error, stdout } = await exec('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${RULE}`]);
    if (error && !/No rules match/i.test(stdout)) return 'unknown';
    if (/No rules match/i.test(stdout)) return 'closed';
    const ports = [...stdout.matchAll(/LocalPort:\s*(.+)/gi)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    const enabled = /Enabled:\s*Yes/i.test(stdout) && /Action:\s*Allow/i.test(stdout);
    return enabled && ports.includes(String(port)) ? 'open' : 'closed';
  }

  /** Asks Windows for permission (the UAC prompt) and adds the rules. Resolves { ok, error? }. */
  async function open(port) {
    if (!supported) return { ok: false, error: 'Only needed on Windows' };
    const p = parseInt(port, 10);
    if (!(p >= 1 && p <= 65535)) return { ok: false, error: 'Bad port' };
    const netsh = 'netsh advfirewall firewall';
    const script = [
      `${netsh} delete rule name="${RULE}"`,
      `${netsh} delete rule name="${RULE_DISCOVERY}"`,
      `${netsh} add rule name="${RULE}" dir=in action=allow protocol=TCP localport=${p} profile=any`,
      `${netsh} add rule name="${RULE_DISCOVERY}" dir=in action=allow protocol=UDP localport=5353 profile=any`,
    ].join(' & ');
    const { error } = await exec('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Start-Process -FilePath cmd.exe -ArgumentList '/c ${script}' -Verb RunAs -Wait -WindowStyle Hidden`,
    ]);
    if (error) return { ok: false, error: 'Windows did not allow the change (the permission prompt was cancelled).' };
    const ok = (await status(p)) === 'open';
    return ok ? { ok } : { ok, error: 'The rule could not be confirmed. Try again.' };
  }

  return { supported, status, open };
}

module.exports = { createFirewall };
