import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartyServer } from '../apps/server/src/server.js';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';

test('HTTP：入座前建立浏览器会话，并发建房只占一间，离房后的迟到响应不清空新席位身份', async (t) => {
  const { party, base, request, create } = await fixture(t);
  const identity = await request('/api/me');
  const cookie = identity.headers.get('set-cookie')!.split(';')[0]!;
  assert.match(cookie, /^party_player=/);
  assert.deepEqual(await identity.json(), { roomCode: null, playerId: null });
  const raced = await Promise.all([
    request('/api/rooms', 'POST', { nickname: '同一浏览器A' }, cookie),
    request('/api/rooms', 'POST', { nickname: '同一浏览器B' }, cookie),
  ]);
  assert.deepEqual(raced.map((response) => response.status).sort(), [201, 409]);
  assert.equal(party.lobby.list().length, 1);
  const created = await raced.find((response) => response.status === 201)!.json();
  assert.equal(
    raced
      .find((response) => response.status === 201)!
      .headers.get('set-cookie')!
      .split(';')[0],
    cookie,
  );
  const left = await request(`/api/rooms/${created.room.code}/me`, 'DELETE', undefined, cookie);
  assert.equal(left.status, 200);
  assert.equal(left.headers.get('set-cookie'), null);
  const other = await create('另一桌');
  const path = `/api/rooms/${other.data.room.code}`;
  const joins = await Promise.all([
    request(`${path}/players`, 'POST', { nickname: '换房' }, cookie),
    request(`${path}/players`, 'POST', { nickname: '重复入座' }, cookie),
  ]);
  assert(joins.every((response) => response.status === 201));
  const memberships = await Promise.all(joins.map((response) => response.json()));
  assert.equal(memberships[0].playerId, memberships[1].playerId);
  assert.equal(party.lobby.get(other.data.room.code).snapshot().players.length, 2);
  party.lobby
    .get(other.data.room.code)
    .removePlayer(memberships[0].playerId, other.cookie.slice('party_player='.length));
  const rejoined = await (
    await request(`${path}/players`, 'POST', { nickname: '重新入座' }, cookie)
  ).json();
  assert.notEqual(rejoined.playerId, memberships[0].playerId);
  const staleLeave = await fetch(base + `${path}/me`, {
    method: 'DELETE',
    headers: { Cookie: cookie, 'X-Party-Player': memberships[0].playerId },
  });
  assert.equal(staleLeave.status, 409);
  assert.equal(
    (await (await request('/api/me', 'GET', undefined, cookie)).json()).playerId,
    rejoined.playerId,
  );
  const forged = 'party_player=not-a-server-issued-identity';
  const issued = await request('/api/me', 'GET', undefined, forged);
  assert.notEqual(issued.headers.get('set-cookie')!.split(';')[0], forged);
});

test('HTTP：转交和离线接任逐次验证本房会话，旧房主和过期点击不能操作', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const { party, request, create } = await fixture(t);
  const owner = await create('房主');
  const stranger = await create('另一桌');
  const path = `/api/rooms/${owner.data.room.code}`;
  const joined = await request(`${path}/players`, 'POST', { nickname: '接任者' });
  const memberCookie = joined.headers.get('set-cookie')!.split(';')[0]!;
  const member = await joined.json();
  const room = party.lobby.get(owner.data.room.code);
  room.connect(owner.cookie.slice('party_player='.length));
  const disconnectMember = room.connect(memberCookie.slice('party_player='.length));
  for (const cookie of ['', stranger.cookie, memberCookie])
    assert.equal(
      (await request(`${path}/owner`, 'PUT', { playerId: member.playerId }, cookie)).status,
      403,
    );
  for (const cookie of ['', stranger.cookie])
    assert.equal(
      (await request(`${path}/owner/claim`, 'POST', { ownerId: owner.data.playerId }, cookie))
        .status,
      401,
    );
  assert.equal(
    (await request(`${path}/owner/claim`, 'POST', { ownerId: owner.data.playerId }, memberCookie))
      .status,
    409,
  );
  assert.equal(
    (await request(`${path}/owner`, 'PUT', { playerId: member.playerId }, owner.cookie)).status,
    200,
  );
  assert.equal((await request(`${path}/bots`, 'POST', { count: 1 }, owner.cookie)).status, 403);
  assert.equal(
    (await request(`${path}/owner/claim`, 'POST', { ownerId: owner.data.playerId }, owner.cookie))
      .status,
    409,
  );
  disconnectMember();
  t.mock.timers.tick(60000);
  assert.equal(
    (
      await request(
        `${path}/owner/claim`,
        'POST',
        { ownerId: member.playerId },
        owner.cookie,
        'http://other.invalid',
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(`${path}/owner/claim`, 'POST', { ownerId: member.playerId }, owner.cookie))
      .status,
    200,
  );
  assert.equal(room.snapshot().ownerId, owner.data.playerId);
  assert.equal(room.session(memberCookie.slice('party_player='.length))?.id, member.playerId);
});

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

test('HTTP：大厅点将按本房会话授权，同时争抢只保留一份，公开快照不含偏好', async (t) => {
  const { request, create } = await fixture(t);
  const owner = await create('房主');
  const other = await create('另一桌');
  const path = `/api/rooms/${owner.data.room.code}`;
  const join = await request(`${path}/players`, 'POST', { nickname: '朋友' });
  const friendCookie = join.headers.get('set-cookie')!.split(';')[0]!;
  const settings = {
    mode: 'identity',
    playerCount: 5,
    generalPreset: 'beginner',
    extensions: [],
    allowGeneralSelection: true,
  };
  for (const cookie of ['', friendCookie, other.cookie])
    assert.equal((await request(path, 'PUT', settings, cookie)).status, 403);
  assert.equal((await request(`${path}/me/general`, 'GET', undefined, owner.cookie)).status, 409);
  assert.equal((await request(path, 'PUT', settings, owner.cookie)).status, 200);
  for (const cookie of ['', other.cookie]) {
    assert.equal((await request(`${path}/me/general`, 'GET', undefined, cookie)).status, 401);
    assert.equal(
      (await request(`${path}/me/general`, 'PUT', { general: 'zhaoyun' }, cookie)).status,
      401,
    );
  }
  assert.equal(
    (await request(`${path}/me/general`, 'PUT', { general: 'shen_zhaoyun' }, owner.cookie)).status,
    400,
  );
  const raced = await Promise.all(
    [owner.cookie, friendCookie].map((cookie) =>
      request(`${path}/me/general`, 'PUT', { general: 'zhaoyun' }, cookie),
    ),
  );
  assert.deepEqual(raced.map((response) => response.status).sort(), [200, 409]);
  const choices = await Promise.all(
    [owner.cookie, friendCookie].map(async (cookie) =>
      (await request(`${path}/me/general`, 'GET', undefined, cookie)).json(),
    ),
  );
  assert.equal(choices.filter((choice) => choice.selected === 'zhaoyun').length, 1);
  assert.equal(JSON.stringify(await (await request(path)).json()).includes('zhaoyun'), false);
  const winner = [owner.cookie, friendCookie][
    raced.findIndex((response) => response.status === 200)
  ]!;
  assert.equal((await request(`${path}/me/general`, 'PUT', { general: null }, winner)).status, 200);
  assert.equal(
    (await request(`${path}/me/general`, 'GET', undefined, friendCookie)).headers.get(
      'cache-control',
    ),
    'no-store',
  );
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
