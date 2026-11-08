'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dns = require('dns');
const QRCode = require('qrcode');
const { advertise } = require('./mdns');

const WEB_DIR = path.join(__dirname, '..', '..', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const PAGES = { '/': 'control.html', '/control': 'control.html', '/dock': 'control.html', '/display': 'display.html', '/report': 'report.html' };

const isLoopback = (addr = '') => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

function createServer(service, { mdns: useMdns = true } = {}) {
  const clients = new Set();
  let port = null; // the port we ended up on
  let mdns = null;
  let seenAddresses = ''; // the network addresses the friendly name was announced with
  let netWatch = null;
  const failures = new Map(); // ip -> {count, since}

  const send = (res, code, body) => {
    const json = JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(json);
  };

  const pinRequired = (req) => !(service.settings.localNoPin && isLoopback(req.socket.remoteAddress));

  function authorised(req, res) {
    if (!pinRequired(req)) return true;
    const ip = req.socket.remoteAddress;
    const f = failures.get(ip);
    if (f && Date.now() - f.since < 60000 && f.count >= 5) {
      send(res, 429, { error: 'Too many wrong PINs. Wait a minute.' });
      return false;
    }
    if (safeEqual(req.headers['x-pin'] || '', service.settings.pin)) {
      failures.delete(ip);
      return true;
    }
    const fresh = f && Date.now() - f.since < 60000 ? f : { count: 0, since: Date.now() };
    fresh.count++;
    failures.set(ip, fresh);
    send(res, 401, { error: 'Wrong PIN' });
    return false;
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 4096) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  const broadcast = () => {
    const msg = `data: ${JSON.stringify(service.snapshot())}\n\n`;
    for (const c of clients) c.write(msg);
  };
  service.timer.on('change', broadcast);
  service.on('obs', broadcast);
  service.on('report', broadcast);
  service.on('raise', broadcast);
  // Heartbeat: keeps connections alive and re-syncs clocks of any client that drifted.
  const heartbeat = setInterval(() => clients.size && broadcast(), 1000);

  const commands = {
    start: () => service.timer.start(),
    pause: () => service.timer.pause(),
    stop: () => service.timer.finish(),
    reset: () => service.timer.reset(),
    select: (b) => service.timer.select(Number(b.talkId)),
    switch: (b) => service.timer.switchTo(b.mode === 'start' ? 'start' : 'finish', b.talkId == null ? undefined : Number(b.talkId)),
    adjust: (b) => service.timer.adjust(Number(b.deltaSeconds) || 0),
    refresh: () => service.loadSchedule({ force: true }),
    report: () => service.makeReport(),
    raiseHand: () => service.raiseHand(),
    raiseUnmute: () => service.raiseUnmute(),
    raiseName: (b) => service.raiseName(b.name),
    raiseTyping: (b) => service.raiseTyping(b.on === true),
    raiseCancel: () => service.raiseCancel(),
    raiseStop: () => service.raiseStop(),
    startAt: (b) => service.setStartOverride(b.time),
    scene: (b) => service.setPartScene({ key: String(b.key), scene: b.scene, kind: b.kind }),
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-pin', 'Access-Control-Allow-Methods': 'GET,POST' });
      return res.end();
    }

    if (req.method === 'GET' && p === '/api/state') return send(res, 200, service.snapshot());
    if (req.method === 'GET' && p === '/api/whoami') return send(res, 200, { pinRequired: pinRequired(req), local: isLoopback(req.socket.remoteAddress) });

    if (req.method === 'GET' && p === '/api/reports') return send(res, 200, service.reports.list());
    if (req.method === 'GET' && p === '/api/report') {
      // ?id=<report id>, or the newest report when no id is given
      const id = url.searchParams.get('id') || (service.latestReport && service.latestReport.id);
      const report = id && service.reports.get(id);
      return report ? send(res, 200, report) : send(res, 404, { error: 'No such report' });
    }

    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(`data: ${JSON.stringify(service.snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'GET' && p === '/api/connect') {
      if (!authorised(req, res)) return;
      const u = urls();
      const qr = await QRCode.toString(u.control, { type: 'svg', margin: 1, color: { dark: '#0b0e14', light: '#ffffff' } });
      return send(res, 200, { control: u.control, display: u.display, pin: service.settings.pin, qr });
    }

    if (req.method === 'POST' && p === '/api/app/settings') {
      // Opens the settings window on the host computer; only from that computer.
      if (!isLoopback(req.socket.remoteAddress)) return send(res, 403, { error: 'Only available on the host computer' });
      if (!authorised(req, res)) return;
      service.emit('open-settings');
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p === '/api/network') {
      if (!authorised(req, res)) return;
      return send(res, 200, await networkInfo());
    }
    if (req.method === 'POST' && p === '/api/network/refresh') {
      if (!authorised(req, res)) return;
      return send(res, 200, await refreshNetwork());
    }

    if (req.method === 'POST' && p === '/api/auth') {
      return authorised(req, res) && send(res, 200, { ok: true });
    }

    const m = req.method === 'POST' && p.match(/^\/api\/timer\/(\w+)$/);
    if (m && commands[m[1]]) {
      if (!authorised(req, res)) return;
      const body = await readBody(req);
      await commands[m[1]](body);
      return send(res, 200, service.snapshot());
    }

    if (req.method === 'GET') {
      const file = PAGES[p] || (/^\/[\w.-]+\.(css|js|png|svg|woff2)$/.test(p) ? p.slice(1) : null);
      if (file) {
        try {
          const data = fs.readFileSync(path.join(WEB_DIR, file));
          res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache' });
          return res.end(data);
        } catch {
          /* fall through to 404 */
        }
      }
    }
    send(res, 404, { error: 'Not found' });
  });

  function urls() {
    const ip = lanAddresses()[0];
    const host = mdns ? mdns.hostname : ip || 'localhost';
    const suffix = port && port !== 80 ? `:${port}` : '';
    const base = `http://${host}${suffix}`;
    const local = `http://localhost${suffix}`;
    return {
      display: `${base}/display`,
      control: `${base}/control`,
      dock: `${local}/dock`,
      displayLocal: `${local}/display`,
      controlLocal: `${local}/control`,
      reportLocal: `${local}/report`,
      ipDisplay: ip ? `http://${ip}${suffix}/display` : null,
    };
  }

  function startMdns() {
    try {
      mdns = advertise({ hostname: service.settings.hostname, port, onError: () => {} });
    } catch {
      mdns = null; // no friendly name; the IP link still works
    }
    seenAddresses = lanAddresses().join();
  }

  /** What other devices will find: the friendly name, this computer's addresses, and whether the name leads here. */
  async function networkInfo() {
    const addresses = lanAddresses();
    const name = mdns ? mdns.hostname : null;
    let resolves = 'unknown'; // 'here' | 'elsewhere' | 'unknown'
    if (name) {
      try {
        const r = await Promise.race([dns.promises.lookup(name, { family: 4 }), new Promise((_, no) => setTimeout(no, 2500))]);
        resolves = addresses.includes(r.address) ? 'here' : 'elsewhere';
      } catch {
        resolves = 'unknown';
      }
    }
    return { name, addresses, resolves, port };
  }

  /** Announces the friendly name again, with the addresses this computer has now (after Wi-Fi changes, sleep, a new IP). */
  async function refreshNetwork() {
    if (!useMdns || port === null) return networkInfo();
    if (mdns) await mdns.stop();
    mdns = null;
    startMdns();
    return networkInfo();
  }

  function tryListen(p) {
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once('error', onError);
      server.listen(p, '0.0.0.0', () => {
        server.off('error', onError);
        resolve();
      });
    });
  }

  return {
    /** Listens on the preferred port (80 gives clean links) and falls back to 4580 if it is taken. */
    async start(preferred) {
      const candidates = [...new Set([preferred, 4580])];
      let lastErr;
      for (const p of candidates) {
        try {
          await tryListen(p);
          port = p;
          break;
        } catch (err) {
          lastErr = err;
          if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
        }
      }
      if (port === null) throw lastErr;

      if (!useMdns) return port;
      startMdns();
      // A new Wi-Fi network or IP address would leave the announced name pointing at the old one: announce again.
      netWatch = setInterval(() => {
        if (lanAddresses().join() !== seenAddresses) refreshNetwork().catch(() => {});
      }, 10 * 1000);
      netWatch.unref();
      return port;
    },
    async close() {
      clearInterval(heartbeat);
      clearInterval(netWatch);
      service.timer.off('change', broadcast);
      service.off('obs', broadcast);
      service.off('report', broadcast);
      service.off('raise', broadcast);
      for (const c of clients) c.end();
      if (mdns) await mdns.stop();
      mdns = null;
      return new Promise((resolve) => (server.listening ? server.close(resolve) : resolve()));
    },
    get listening() {
      return server.listening;
    },
    get port() {
      return port;
    },
    get friendlyName() {
      return mdns ? mdns.hostname : null;
    },
    urls,
    refreshNetwork,
    networkInfo,
  };
}

module.exports = { createServer, lanAddresses };
