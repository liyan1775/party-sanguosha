import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createPartyServer } from '../apps/server/src/server.js';
import { NativeNonameService } from '../packages/noname-adapter/src/service.js';
import type { TestContext } from 'node:test';
import type { MatchSetup } from '../packages/noname-adapter/src/index.js';

async function fixture(t: TestContext) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const engine = new NativeNonameService(root);
  const party = createPartyServer({ port: 0, webRoot: `${root}/apps/web`, adapter: engine });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => {
    engine.close();
    party.closeStreams();
    party.server.closeAllConnections();
    party.server.close();
  });
  const created = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '玩家' }),
  });
  const ownerCookie = created.headers.get('set-cookie')!.split(';')[0]!;
  const room = (await created.json()).room;
  const supervisor = await fetch(`${base}/engine/jobs`);
  const workerCookie = supervisor.headers.get('set-cookie')!.split(';')[0]!;
  const setup: MatchSetup = {
    roomCode: room.code,
    ownerPlayerId: room.ownerId,
    settings: { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
    seats: [
      { id: room.ownerId, nickname: '玩家', kind: 'human' },
      { id: 'bot-test', nickname: 'AI', kind: 'bot' },
    ],
    aiPolicy: 'strongest-native',
  };
  const started = engine.start(setup);
  void started.catch(() => {});
  const id = engine.matchId(room.code)!;
  const socket = (role: string, cookie = '', origin = base) =>
    new WebSocket(`${base.replace('http:', 'ws:')}/engine/socket/${id}/${role}`, {
      origin,
      headers: { Cookie: cookie },
    });
  return { base, engine, party, id, room, ownerCookie, workerCookie, started, socket };
}

test('引擎网关：玩家与规则宿主会话分离，拒绝陌生会话、跨源与越权操作', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await fetch(`${f.base}/engine/setup/${f.id}?role=worker`, {
        headers: { Cookie: f.ownerCookie },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(`${f.base}/engine/player/${f.id}`)).status, 403);
  for (const [role, cookie, origin] of [
    ['player', '', f.base],
    ['worker', f.ownerCookie, f.base],
    ['player', f.ownerCookie, 'http://example.invalid'],
  ]) {
    const denied = f.socket(role!, cookie, origin);
    denied.on('error', () => {});
    await new Promise<void>((resolve) => denied.once('error', () => resolve()));
  }
  const worker = f.socket('worker', f.workerCookie);
  await once(worker, 'open');
  const player = f.socket('player', f.ownerCookie);
  const connection = once(worker, 'message');
  await once(player, 'open');
  const connected = JSON.parse((await connection)[0].toString());
  assert.equal(connected.type, 'connect');
  assert.equal(connected.id, f.room.ownerId);
  const forwarded = once(worker, 'message');
  player.send(JSON.stringify(['init', 'native-version', { id: 'forged-other-seat' }]));
  const message = JSON.parse((await forwarded)[0].toString());
  assert.equal(message.id, f.room.ownerId);
  worker.send(JSON.stringify({ type: 'started' }));
  await f.started;
  const closed = once(player, 'close');
  player.send(JSON.stringify(['cardPile']));
  assert.equal((await closed)[0], 1008);
  worker.close();
});

test('引擎网关：房间之间不能读取对局设置或使用其他房间的套接字', async (t) => {
  const f = await fixture(t);
  const created = await fetch(`${f.base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '另一房主' }),
  });
  const otherCookie = created.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal(
    (
      await fetch(`${f.base}/engine/setup/${f.id}?role=player`, {
        headers: { Cookie: otherCookie },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(`${f.base}/engine/core/%2e%2e%5c%2e%2e%5c.env`)).status, 400);
  assert.equal(
    (await fetch(`${f.base}/engine/fs/writeFile?fileName=game/config.json`)).status,
    403,
  );
});
