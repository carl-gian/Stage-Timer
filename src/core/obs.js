'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

// obs-websocket v5 event categories we listen to: Config | Scenes | Transitions | Ui
const SUBSCRIPTIONS = (1 << 1) | (1 << 2) | (1 << 4) | (1 << 10);
const RETRY_MS = [1000, 2000, 5000];
const AUTH_FAILED = 4009;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('base64');
const authString = (password, { salt, challenge }) => sha256(sha256(password + salt) + challenge);

/**
 * Minimal obs-websocket v5 client (JSON over the built-in WebSocket, no dependencies).
 * Keeps itself connected while a config is set, and emits:
 *   'state' (state, message)   state: off | connecting | connected | waiting | auth-failed
 *   'ready'                    identified, requests can be sent
 *   'event' (type, data)       an OBS event
 */
class ObsClient extends EventEmitter {
  constructor({ WebSocketImpl = globalThis.WebSocket, requestTimeoutMs = 5000 } = {}) {
    super();
    this.WebSocketImpl = WebSocketImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.state = 'off';
    this.message = '';
    this.cfg = null; // {url, password} while we should be connected
    this.ws = null;
    this.pending = new Map(); // requestId -> {resolve, reject, timer}
    this.nextId = 1;
    this.attempt = 0;
    this.retryTimer = null;
  }

  get connected() {
    return this.state === 'connected';
  }

  /** Start (or re-point) the connection. Does nothing if already on this config. */
  connect({ url, password = '' }) {
    if (this.cfg && this.cfg.url === url && this.cfg.password === password && this.state !== 'off') return;
    this._teardown();
    this.cfg = { url, password };
    this.attempt = 0;
    this._open();
  }

  disconnect() {
    this._teardown();
    this.cfg = null;
    this._setState('off', '');
  }

  /** Sends a request; resolves with responseData. Rejects with err.code = OBS request status code. */
  request(requestType, requestData) {
    if (!this.connected) return Promise.reject(new Error('Not connected to OBS'));
    const requestId = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS did not answer ${requestType}`));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, ...(requestData ? { requestData } : {}) } }));
    });
  }

  /**
   * Resolves true when an OBS event of this type arrives (false on timeout, if one is given).
   * Register it BEFORE sending the request that causes the event: it can arrive ahead of the response.
   */
  waitFor(type, timeoutMs = 0) {
    let finish;
    const promise = new Promise((resolve) => {
      let timer = null;
      const onEvent = (t) => t === type && finish(true);
      finish = (value) => {
        clearTimeout(timer);
        this.off('event', onEvent);
        resolve(value);
      };
      this.on('event', onEvent);
      if (timeoutMs > 0) timer = setTimeout(() => finish(false), timeoutMs);
    });
    return { promise, cancel: () => finish(false) };
  }

  _setState(state, message) {
    if (this.state === state && this.message === message) return;
    this.state = state;
    this.message = message;
    this.emit('state', state, message);
  }

  _teardown() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null; // handlers ignore sockets that are no longer current
    if (ws) {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    this._failPending(new Error('Connection closed'));
  }

  _failPending(err) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  _open() {
    if (!this.WebSocketImpl) {
      this._setState('waiting', 'This version of Node has no WebSocket support');
      return;
    }
    this._setState('connecting', 'Connecting to OBS…');
    let ws;
    try {
      ws = new this.WebSocketImpl(this.cfg.url, 'obswebsocket.json');
    } catch {
      this._setState('waiting', `“${this.cfg.url}” is not a valid address`);
      return; // no retry: the address has to change first
    }
    this.ws = ws;
    ws.onmessage = (e) => ws === this.ws && this._onMessage(ws, e.data);
    ws.onerror = () => {}; // 'close' always follows and carries the outcome
    ws.onclose = (e) => {
      if (ws !== this.ws) return;
      this.ws = null;
      this._failPending(new Error('Connection to OBS closed'));
      if (e.code === AUTH_FAILED) {
        this._setState('auth-failed', this.cfg.password ? 'OBS rejected the password' : 'OBS needs a password');
        return; // retrying would only repeat the failure
      }
      this._setState('waiting', 'Can’t reach OBS. Is it open, with the WebSocket server turned on?');
      this.retryTimer = setTimeout(() => this._open(), RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)]);
      this.retryTimer.unref?.();
    };
  }

  _onMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const d = msg.d || {};
    switch (msg.op) {
      case 0: { // Hello
        const identify = { rpcVersion: 1, eventSubscriptions: SUBSCRIPTIONS };
        if (d.authentication) identify.authentication = authString(this.cfg.password, d.authentication);
        ws.send(JSON.stringify({ op: 1, d: identify }));
        break;
      }
      case 2: // Identified
        this.attempt = 0;
        this._setState('connected', 'Connected to OBS');
        this.emit('ready');
        break;
      case 5: // Event
        this.emit('event', d.eventType, d.eventData || {});
        break;
      case 7: { // RequestResponse
        const p = this.pending.get(d.requestId);
        if (!p) break;
        this.pending.delete(d.requestId);
        clearTimeout(p.timer);
        const status = d.requestStatus || {};
        if (status.result) p.resolve(d.responseData || {});
        else p.reject(Object.assign(new Error(status.comment || `OBS refused ${d.requestType} (code ${status.code})`), { code: status.code }));
        break;
      }
      default:
    }
  }
}

module.exports = { ObsClient, authString };
