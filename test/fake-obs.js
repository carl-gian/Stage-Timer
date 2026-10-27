'use strict';

// A tiny stand-in for OBS's obs-websocket v5 server, just enough to test the client and the scene switcher.
// With `bridge: true` it also imitates the EMEET-OBS Bridge: it changes the transition shortly after Preview changes.

const http = require('http');
const crypto = require('crypto');
const { authString } = require('../src/core/obs');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]);
  return Buffer.concat([head, payload]);
}

/** Pulls complete client frames (always masked) out of `buf`; returns [frames, rest]. */
function parseFrames(buf) {
  const out = [];
  for (;;) {
    if (buf.length < 2) break;
    let len = buf[1] & 127;
    let off = 2;
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
    if (buf.length < off + 4 + len) break;
    const mask = buf.subarray(off, off + 4);
    const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    out.push({ opcode: buf[0] & 15, data });
    buf = buf.subarray(off + 4 + len);
  }
  return [out, buf];
}

async function startFakeObs({ password = '', scenes = ['A', 'B', 'C'], program = 'A', studio = true, bridge = false, transitionMs = 150, bridgeDelayMs = 20 } = {}) {
  const state = { program, preview: program, studio, scenes };
  const requests = []; // {type, data, at}
  const sockets = new Set();
  const salt = crypto.randomBytes(16).toString('base64');
  const challenge = crypto.randomBytes(16).toString('base64');

  const emit = (eventType, eventData = {}) => {
    for (const s of sockets) if (s.identified) s.write(frame(1, Buffer.from(JSON.stringify({ op: 5, d: { eventType, eventIntent: 1, eventData } }))));
  };

  const answer = (socket, type, id, ok, data, code = 100, comment) =>
    socket.write(frame(1, Buffer.from(JSON.stringify({ op: 7, d: { requestType: type, requestId: id, requestStatus: { result: ok, code, comment }, responseData: data } }))));

  const handlers = {
    GetSceneList: () => ({ currentProgramSceneName: state.program, scenes: state.scenes.map((sceneName, i) => ({ sceneName, sceneIndex: state.scenes.length - 1 - i })).reverse() }),
    GetStudioModeEnabled: () => ({ studioModeEnabled: state.studio }),
    GetCurrentProgramScene: () => ({ sceneName: state.program, currentProgramSceneName: state.program }),
    SetCurrentPreviewScene: ({ sceneName }) => {
      if (!state.scenes.includes(sceneName)) throw Object.assign(new Error('No scene was found by that name.'), { code: 600 });
      state.preview = sceneName;
      emit('CurrentPreviewSceneChanged', { sceneName });
      if (bridge) setTimeout(() => emit('CurrentSceneTransitionChanged', { transitionName: 'Fade to Black' }), bridgeDelayMs);
      return {};
    },
    TriggerStudioModeTransition: () => {
      emit('SceneTransitionStarted', { transitionName: 'Fade' });
      setTimeout(() => {
        state.program = state.preview;
        emit('CurrentProgramSceneChanged', { sceneName: state.program });
        emit('SceneTransitionEnded', { transitionName: 'Fade' });
      }, transitionMs);
      return {};
    },
  };

  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: obswebsocket.json\r\n\r\n`);
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});

    const closeWith = (code) => {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(code);
      socket.end(frame(8, b));
    };
    const hello = { obsWebSocketVersion: '5.5.0', rpcVersion: 1 };
    if (password) hello.authentication = { challenge, salt };
    socket.write(frame(1, Buffer.from(JSON.stringify({ op: 0, d: hello }))));

    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      let frames;
      [frames, buf] = parseFrames(Buffer.concat([buf, chunk]));
      for (const f of frames) {
        if (f.opcode === 8) return socket.end(frame(8, Buffer.alloc(0)));
        if (f.opcode !== 1) continue;
        const { op, d } = JSON.parse(f.data.toString());
        if (op === 1) {
          if (password && d.authentication !== authString(password, { salt, challenge })) return closeWith(4009);
          socket.identified = true;
          socket.write(frame(1, Buffer.from(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))));
        } else if (op === 6) {
          requests.push({ type: d.requestType, data: d.requestData, at: Date.now() });
          try {
            answer(socket, d.requestType, d.requestId, true, handlers[d.requestType](d.requestData || {}));
          } catch (err) {
            answer(socket, d.requestType, d.requestId, false, undefined, err.code || 400, err.message);
          }
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    state,
    requests,
    emit,
    dropClients: () => sockets.forEach((s) => s.destroy()),
    close: () => new Promise((resolve) => {
      sockets.forEach((s) => s.destroy());
      server.close(resolve);
    }),
  };
}

module.exports = { startFakeObs };
