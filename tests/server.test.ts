import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartyServer } from '../apps/server/src/server.js';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';

async function fixture(t: TestContext) {
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../apps/web/', import.meta.url)),
    publicUrl: 'http://192.168.1.100:3000',
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    party.closeStreams();
    party.server.closeAllConnections();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  });
  const address = party.server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (route: string, method = 'GET', body?: unknown, cookie = '', origin?: string) =>
    fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', cookie, ...(origin ? { origin } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const create = async (nickname: string) => {
    const response = await request('/api/rooms', 'POST', { nickname });
    assert.equal(response.status, 201);
    assert.match(response.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
    return {
      cookie: response.headers.get('set-cookie')!.split(';')[0]!,
      data: await response.json(),
    };
  };
  return { party, base, request, create };
}

test('HTTP：玩家创建房间、房主参赛、跨房间权限隔离与 AI 管理', async (t) => {
  const { party, request, create } = await fixture(t);
  const initial = await (await request('/api/info')).json();
  assert.equal(initial.rooms.length, 0);
  assert.equal(initial.homeUrls[0], 'http://192.168.1.100:3000/');
  assert.equal(initial.engine.ready, false);
  assert.equal(JSON.stringify(initial).includes(party.controlToken), false);
  const owner = await create('赵云');
  const other = await create('小乔');
  const roomPath = `/api/rooms/${owner.data.room.code}`;
  assert.equal(owner.data.room.ownerId, owner.data.playerId);
  assert.equal(owner.data.room.players.length, 1);
  assert.equal(owner.data.room.players[0].kind, 'human');
  const join = await request(`${roomPath}/players`, 'POST', { nickname: '关羽' });
  const friendCookie = join.headers.get('set-cookie')!.split(';')[0]!;
  const friend = await join.json();
  for (const cookie of ['', friendCookie, other.cookie]) {
    assert.equal((await request(roomPath, 'PUT', {}, cookie)).status, 403);
    assert.equal((await request(`${roomPath}/bots`, 'POST', { count: 1 }, cookie)).status, 403);
    assert.equal((await request(`${roomPath}/start`, 'POST', undefined, cookie)).status, 403);
    assert.equal(
      (await request(`${roomPath}/players/${friend.playerId}`, 'DELETE', undefined, cookie)).status,
      403,
    );
  }
  assert.equal(
    (await request('/api/rooms', 'POST', { nickname: '赵云' }, owner.cookie)).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/api/rooms/${other.data.room.code}/players`,
        'POST',
        { nickname: '赵云' },
        owner.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        roomPath,
        'PUT',
        { mode: 'identity', playerCount: 8, generalPreset: 'advanced', extensions: [] },
        owner.cookie,
      )
    ).status,
    200,
  );
  assert.equal((await request(`${roomPath}/bots`, 'POST', { count: 6 }, owner.cookie)).status, 200);
  assert.equal((await request(`${roomPath}/players`, 'POST', { nickname: '张飞' })).status, 409);
  assert.equal((await request(`${roomPath}/bots`, 'POST', { count: 1 }, owner.cookie)).status, 409);
  assert.equal((await request(`${roomPath}/start`, 'POST', undefined, owner.cookie)).status, 503);
  assert.equal(
    (await request(roomPath, 'PUT', {}, owner.cookie, 'http://other-site.invalid')).status,
    403,
  );
  assert.equal((await request(`${roomPath}/me/ready`, 'PUT', { ready: true })).status, 401);
  const room = party.lobby.get(owner.data.room.code).snapshot();
  const bot = room.players.find((player) => player.kind === 'bot')!;
  assert.equal(
    (await request(`${roomPath}/players/${bot.id}`, 'DELETE', undefined, owner.cookie)).status,
    200,
  );
  assert.equal(
    (await request(`${roomPath}/players/${friend.playerId}`, 'DELETE', undefined, owner.cookie))
      .status,
    200,
  );
  assert.deepEqual(await (await request('/api/me', 'GET', undefined, friendCookie)).json(), {
    playerId: null,
    roomCode: null,
  });
  assert.equal((await request(`${roomPath}/bots`, 'POST', { count: 1 }, friendCookie)).status, 403);
  assert.equal(party.lobby.get(other.data.room.code).snapshot().players.length, 1);
  assert.equal(JSON.stringify(room).includes(owner.cookie.slice('party_player='.length)), false);
});

test('HTTP：主页二维码、所有成员的房间二维码、邀请失效与本机控制文件隔离', async (t) => {
  const { party, base, request, create } = await fixture(t);
  const owner = await create('赵云');
  const roomPath = `/api/rooms/${owner.data.room.code}`;
  const joined = await request(`${roomPath}/players`, 'POST', { nickname: '关羽' });
  const friendCookie = joined.headers.get('set-cookie')!.split(';')[0]!;
  const data = await joined.json();
  const homeQr = await request(
    `/api/qr.svg?url=${encodeURIComponent('http://192.168.1.100:3000/')}`,
  );
  assert.equal(homeQr.status, 200);
  const qrPath = `/api/qr.svg?room=${data.room.code}&url=${encodeURIComponent(data.joinUrls[0])}`;
  for (const cookie of [owner.cookie, friendCookie]) {
    const response = await request(qrPath, 'GET', undefined, cookie);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<svg/);
  }
  assert.equal((await request(qrPath)).status, 403);
  assert.equal(
    (await request(`/api/qr.svg?url=${encodeURIComponent(base + '/server#secret')}`)).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/api/qr.svg?room=${data.room.code}&url=${encodeURIComponent('https://other-site.invalid/')}`,
        'GET',
        undefined,
        friendCookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request('/api/rooms/OLD123/players', 'POST', { nickname: '赵云' })).status,
    404,
  );
  assert.equal((await request('/api/shutdown', 'POST')).status, 403);
  assert.equal((await request('/api/host-session', 'POST', { secret: 'old-secret' })).status, 404);
  for (const route of [
    '/.env',
    '/.runtime/session.json',
    '/config/noname-candidate.json',
    '/.local/noname/v1.11.6/index.html',
  ])
    assert.equal((await request(route)).status, 404);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/server')).status, 200);
  const migrated = await fetch(base + '/host', { redirect: 'manual' });
  assert.equal(migrated.status, 302);
  assert.equal(migrated.headers.get('location'), '/server');
  assert.equal((await fetch(base + '/api/rooms', { method: 'POST', body: '{bad' })).status, 400);
  assert.equal((await request('/api/rooms', 'POST', { nickname: 'x'.repeat(5000) })).status, 413);
  await request(`${roomPath}/me`, 'DELETE', undefined, owner.cookie);
  assert.equal(party.lobby.get(data.room.code).snapshot().ownerId, data.playerId);
  assert.equal((await request(qrPath, 'GET', undefined, owner.cookie)).status, 403);
  await request(`${roomPath}/me`, 'DELETE', undefined, friendCookie);
  assert.equal((await request(roomPath)).status, 404);
  assert.equal((await request(qrPath, 'GET', undefined, friendCookie)).status, 404);
});

test('HTTP：只有持有当前实例本机控制凭据才能停止服务', async (t) => {
  const { party, base } = await fixture(t);
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.app, 'party-sanguosha');
  assert.equal(health.instanceId, party.instanceId);
  assert.equal(JSON.stringify(health).includes(party.controlToken), false);
  const rejected = await fetch(base + '/api/shutdown', {
    method: 'POST',
    headers: { 'X-Party-Control': 'wrong-token' },
  });
  assert.equal(rejected.status, 403);
  const stopped = await fetch(base + '/api/shutdown', {
    method: 'POST',
    headers: { 'X-Party-Control': party.controlToken },
  });
  assert.equal(stopped.status, 200);
  assert.equal(party.server.listening, false);
});
