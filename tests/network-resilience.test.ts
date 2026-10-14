import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createPartyServer } from '../apps/server/src/server.js';
import { NativeNonameService } from '../packages/noname-adapter/src/service.js';

async function fixture(t: TestContext, native = false) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const engine = native ? new NativeNonameService(root) : undefined;
  const party = createPartyServer({
    port: 0,
    webRoot: `${root}/apps/web`,
    ...(engine ? { adapter: engine } : {}),
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => {
    party.stop();
    party.server.closeAllConnections();
  });
  return { party, engine, base, port: address.port };
}

test('异常升级地址被拒绝，不退出后台或影响下一次 HTTP 请求', async (t) => {
  const { base, port } = await fixture(t, true);
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  const closed = once(socket, 'close');
  socket.write(
    `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
  );
  socket.resume();
  await closed;
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('公网连通性连接的超限帧只关闭该连接，服务仍可访问', async (t) => {
  const { base } = await fixture(t);
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/api/realtime-check`);
  socket.on('error', () => {});
  t.after(() => socket.terminate());
  await once(socket, 'open');
  const closed = once(socket, 'close');
  socket.send('x'.repeat(65));
  const [code] = await closed;
  assert.equal(code, 1009);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('原生玩家连接的超限帧不影响后台及规则连接', async (t) => {
  const { base, engine } = await fixture(t, true);
  assert(engine);
  const created = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '测试玩家' }),
  });
  const Cookie = created.headers.get('set-cookie')!.split(';')[0]!;
  const { room } = await created.json();
  const started = engine.start({
    roomCode: room.code,
    ownerPlayerId: room.ownerId,
    settings: {
      mode: 'duel',
      playerCount: 2,
      generalPreset: 'beginner',
      allowGeneralSelection: false,
      extensions: [],
    },
    seats: [
      { id: room.ownerId, nickname: '测试玩家', kind: 'human' },
      { id: 'test-ai', nickname: 'AI', kind: 'bot' },
    ],
    aiPolicy: 'strongest-native',
  });
  void started.catch(() => {});
  const id = engine.matchId(room.code);
  const workerCookie = (await fetch(`${base}/engine/jobs`)).headers
    .get('set-cookie')!
    .split(';')[0]!;
  const worker = new WebSocket(`${base.replace('http:', 'ws:')}/engine/socket/${id}/worker`, {
    origin: base,
    headers: { Cookie: workerCookie },
  });
  worker.on('error', () => {});
  t.after(() => worker.terminate());
  await once(worker, 'open');
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/engine/socket/${id}/player`, {
    origin: base,
    headers: { Cookie },
  });
  socket.on('error', () => {});
  t.after(() => socket.terminate());
  await once(socket, 'open');
  const closed = once(socket, 'close');
  socket.send('x'.repeat(131073));
  const [code] = await closed;
  assert.equal(code, 1009);
  assert.equal(worker.readyState, WebSocket.OPEN);
  assert.equal(engine.matchId(room.code), id);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
