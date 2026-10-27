'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { advertise } = require('./mdns');

const WEB_DIR = path.join(__dirname, '..', '..', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PAGES = { '/': 'control.html', '/control': 'control.html', '/dock': 'control.html', '/display': 'display.html' };

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
    const msg = `data: ${JSON.stringify(service.timer.snapshot())}\n\n`;
    for (const c of clients) c.write(msg);
  };
  service.timer.on('change', broadcast);
  // Heartbeat: keeps connections alive and re-syncs clocks of any client that drifted.
  const heartbeat = setInterval(() => clients.size && broadcast(), 1000);

  const commands = {
    start: () => service.timer.start(),
    pause: () => service.timer.pause(),
    stop: () => service.timer.finish(),
    reset: () => service.timer.reset(),
    select: (b) => service.timer.select(Number(b.talkId)),
    adjust: (b) => service.timer.adjust(Number(b.deltaSeconds) || 0),
    refresh: () => service.loadSchedule({ force: true }),
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-pin', 'Access-Control-Allow-Methods': 'GET,POST' });
      return res.end();
    }

    if (req.method === 'GET' && p === '/api/state') return send(res, 200, service.timer.snapshot());
    if (req.method === 'GET' && p === '/api/whoami') return send(res, 200, { pinRequired: pinRequired(req), local: isLoopback(req.socket.remoteAddress) });

    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(`data: ${JSON.stringify(service.timer.snapshot())}\n\n`);
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

    if (req.method === 'POST' && p === '/api/auth') {
      return authorised(req, res) && send(res, 200, { ok: true });
    }

    const m = req.method === 'POST' && p.match(/^\/api\/timer\/(\w+)$/);
    if (m && commands[m[1]]) {
      if (!authorised(req, res)) return;
      const body = await readBody(req);
      await commands[m[1]](body);
      return send(res, 200, service.timer.snapshot());
    }

    if (req.method === 'GET') {
      const file = PAGES[p] || (/^\/[\w.-]+\.(css|js|png|svg)$/.test(p) ? p.slice(1) : null);
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
      ipDisplay: ip ? `http://${ip}${suffix}/display` : null,
    };
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

      const hostname = service.settings.hostname;
      if (!useMdns) return port;
      try {
        mdns = advertise({ hostname, port, onError: () => {} });
      } catch {
        mdns = null; // no friendly name; the IP link still works
      }
      return port;
    },
    async close() {
      clearInterval(heartbeat);
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
  };
}

module.exports = { createServer, lanAddresses };
