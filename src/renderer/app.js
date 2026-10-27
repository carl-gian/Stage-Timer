'use strict';

const $ = (id) => document.getElementById(id);
let data = null;
let editing = false;

const SOURCE = { network: 'Downloaded just now', cache: 'Loaded from saved copy', 'stale-cache': 'Offline — using saved copy', none: 'Couldn’t download — using default times', 'n/a': 'Fixed times (no download needed)' };

const AD_DESC = {
  none: 'Parts always use their planned time',
  oneWay: 'Running late? Later parts get shorter',
  twoWay: 'Late: shorter. Early: longer',
};

function paint(d) {
  data = d;
  const ok = !d.serverError;
  $('status').textContent = ok ? 'Running' : 'Not running';
  $('status').classList.toggle('bad', !ok);
  $('err').textContent = d.serverError || '';
  $('sub').textContent = d.timer.talk ? `Now: ${d.timer.talk}${d.timer.running ? ' (running)' : ''}` : 'Ready';
  $('uDisplay').textContent = d.urls.display;
  $('uControl').textContent = d.urls.control;
  $('uDock').textContent = d.urls.dock;
  $('qr').src = d.qr;
  $('pin').textContent = d.settings.pin;
  document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === d.settings.meetingMode));
  $('mtDesc').textContent = `Today: ${d.meetingType === 'weekend' ? 'weekend' : 'midweek'} meeting` + (d.settings.meetingMode === 'auto' ? ' (detected from the day)' : '');
  document.querySelectorAll('#adaptive button').forEach((b) => b.classList.toggle('on', b.dataset.v === d.settings.adaptiveMode));
  $('adDesc').textContent = AD_DESC[d.settings.adaptiveMode] || '';
  $('circuit').checked = d.settings.circuitVisit;
  $('localNoPin').checked = d.settings.localNoPin;
  $('schedDesc').textContent = `${d.schedule.count} parts · ${SOURCE[d.schedule.source] || ''}`;
  $('hostDesc').textContent = d.friendlyName ? `Other devices open ${d.friendlyName}` : 'Not available on this network — use the IP link';
  $('portDesc').textContent = `Running on port ${d.port}` + (d.port !== d.settings.port ? ` (${d.settings.port} was unavailable)` : '');
  if (!editing) {
    $('port').value = d.settings.port;
    $('hostname').value = d.settings.hostname;
  }
  paintObs(d);
  paintReports(d);
  paintUpdate(d);
}

function paintUpdate(d) {
  const u = d.update;
  $('verLine').textContent = `Version ${d.version}`;
  $('startHidden').checked = d.settings.startHidden;
  $('autoUpdate').checked = d.settings.autoUpdate;
  const text = {
    unsupported: u.message,
    idle: '',
    checking: 'Checking for updates…',
    current: 'You have the latest version.',
    downloading: `Downloading version ${u.version}… ${u.percent}%`,
    ready: d.timer.running ? `Version ${u.version} is ready. Stop the timer to restart and update.` : `Version ${u.version} is ready. It installs when you quit, or restart now.`,
    error: `Couldn’t check for updates. ${u.message}`,
  }[u.state];
  $('updDesc').textContent = text || '';
  $('updDesc').classList.toggle('bad-text', u.state === 'error');
  $('checkUpd').style.display = u.state === 'ready' || u.state === 'unsupported' ? 'none' : '';
  $('checkUpd').disabled = u.state === 'checking' || u.state === 'downloading';
  $('installUpd').style.display = u.state === 'ready' ? '' : 'none';
  $('installUpd').disabled = d.timer.running;
}

let partsKey = '';

function paintObs(d) {
  const { obs, settings } = d;
  $('obsOn').checked = settings.obsEnabled;
  $('obsBody').style.display = settings.obsEnabled ? '' : 'none';

  let status = obs.message;
  if (obs.state === 'connected') {
    status = obs.problem || (obs.last ? `Connected. Last sent: ${obs.last.scene}` + (obs.last.outcome === 'already-live' ? ' (already on air)' : '') : 'Connected');
  }
  $('obsStatus').textContent = status;
  $('obsStatus').classList.toggle('bad-text', obs.state !== 'connected' || !!obs.problem);

  for (const [id, value] of [['obsUrl', settings.obsUrl], ['obsPassword', settings.obsPassword], ['obsSettle', settings.obsSettleMs]]) {
    if (document.activeElement !== $(id)) $(id).value = value;
  }

  $('obsHint').textContent = `Scene for each part of the ${d.meetingType === 'weekend' ? 'weekend' : 'midweek'} meeting. Use Meeting type above to set up the other one.`;

  // Rebuilding while a menu is open would close it, so only rebuild when something changed.
  const assigned = settings.obsScenes[d.meetingType] || {};
  const key = JSON.stringify([d.parts, obs.scenes, assigned, settings.obsDefaultScene, settings.obsCounselScene]);
  if (key === partsKey || document.activeElement.tagName === 'SELECT') return;
  partsKey = key;
  $('obsParts').textContent = '';
  const addRow = (label, hint, current, onPick) => {
    const row = document.createElement('div');
    row.className = 'row';
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    const b = document.createElement('b');
    b.textContent = label;
    lbl.append(b);
    if (hint) {
      const span = document.createElement('span');
      span.textContent = hint;
      lbl.append(span);
    }
    const select = document.createElement('select');
    const names = [...obs.scenes];
    if (current && !names.includes(current)) names.push(current);
    select.add(new Option('None', ''));
    for (const name of names) select.add(new Option(obs.scenes.length && !obs.scenes.includes(name) ? `${name} (not in OBS)` : name, name));
    select.value = current;
    select.onchange = () => onPick(select.value);
    row.append(lbl, select);
    $('obsParts').append(row);
  };
  addRow('When a part is stopped', 'Shown after you press Stop. None leaves OBS as it is.', settings.obsDefaultScene || '', (scene) => save({ obsDefaultScene: scene }));
  if (d.meetingType === 'midweek') addRow('Counseling in Apply Yourself', 'Shown after a student talk in the ministry section is stopped. None uses the scene above.', settings.obsCounselScene || '', (scene) => save({ obsCounselScene: scene }));
  for (const part of d.parts) addRow(part.name, '', assigned[part.key] || '', (scene) => window.stage.assignScene(part.key, scene).then(paint));
}

let reportsKey = '';

function paintReports(d) {
  $('reportDesc').textContent = d.reports.length ? '' : 'No reports yet';
  const key = JSON.stringify(d.reports);
  if (key === reportsKey) return;
  reportsKey = key;
  $('reports').textContent = '';
  for (const r of d.reports) {
    const row = document.createElement('div');
    row.className = 'row';
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    const b = document.createElement('b');
    b.textContent = new Date(r.createdAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const span = document.createElement('span');
    const net = Math.abs(r.diffSecs);
    const mins = `${Math.floor(net / 60)}:${String(net % 60).padStart(2, '0')}`;
    span.textContent = `${r.meetingType === 'weekend' ? 'Weekend' : 'Midweek'} · ${r.diffSecs === 0 ? 'on time' : r.diffSecs > 0 ? `${mins} over` : `${mins} under`} overall`;
    lbl.append(b, span);
    const open = document.createElement('button');
    open.textContent = 'Open';
    open.onclick = () => window.stage.open(`${data.urls.reportLocal}?id=${encodeURIComponent(r.id)}`);
    row.append(lbl);
    if (r.pdfPath) {
      const pdf = document.createElement('button');
      pdf.textContent = 'PDF';
      pdf.onclick = () => window.stage.openReportPdf(r.id);
      row.append(pdf);
    }
    row.append(open);
    $('reports').append(row);
  }
}

const refresh = () => window.stage.info().then(paint);
const save = (patch) => window.stage.update(patch).then(paint);

document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => {
  window.stage.copy(data.urls[b.dataset.copy]);
  const t = b.textContent; b.textContent = 'Copied ✓'; setTimeout(() => (b.textContent = t), 1200);
}));
document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => window.stage.open(data.urls[b.dataset.open])));
document.querySelectorAll('#mode button').forEach((b) => (b.onclick = () => save({ meetingMode: b.dataset.v })));
document.querySelectorAll('#adaptive button').forEach((b) => (b.onclick = () => save({ adaptiveMode: b.dataset.v })));
$('circuit').onchange = (e) => save({ circuitVisit: e.target.checked });
$('localNoPin').onchange = (e) => save({ localNoPin: e.target.checked });
$('obsOn').onchange = (e) => save({ obsEnabled: e.target.checked });
for (const [id, field] of [['obsUrl', 'obsUrl'], ['obsPassword', 'obsPassword'], ['obsSettle', 'obsSettleMs']]) $(id).onchange = () => save({ [field]: $(id).value });
$('startHidden').onchange = (e) => save({ startHidden: e.target.checked });
$('autoUpdate').onchange = (e) => save({ autoUpdate: e.target.checked });
$('checkUpd').onclick = () => window.stage.checkUpdate().then(paint);
$('installUpd').onclick = () => window.stage.installUpdate();
$('openReports').onclick = () => window.stage.openReportsFolder();
$('makeReport').onclick = () => window.stage.makeReport().then(paint);
$('newPin').onclick = () => window.stage.regeneratePin().then(paint);
$('refresh').onclick = () => { $('schedDesc').textContent = 'Downloading…'; window.stage.refreshSchedule().then(paint); };
for (const id of ['port', 'hostname']) {
  $(id).onfocus = () => (editing = true);
  $(id).onblur = () => { editing = false; };
  $(id).onchange = () => save({ [id]: $(id).value });
}

refresh();
setInterval(refresh, 2000);
