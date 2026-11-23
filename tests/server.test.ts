import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartyServer } from '../apps/server/src/server.js';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import type {
  EngineAdapter,
  EngineEvent,
  MatchSetup,
} from '../packages/noname-adapter/src/index.js';
import { completedPublicMatch, sanitizeObserver } from '../packages/noname-adapter/src/observer.js';
import type { PublicMatchSummary } from '../packages/shared/src/contracts.js';

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

async function fixture(t: TestContext, adapter?: EngineAdapter) {
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../apps/web/', import.meta.url)),
    publicUrl: 'http://192.168.1.100:3000',
    ...(adapter ? { adapter } : {}),
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

test('HTTP 快捷开桌只发布完整预设，原会话并发重试只建一次，复用与冲突保留原房号', async (t) => {
  const adapter: EngineAdapter = {
    status: () => ({ id: 'noname', ready: true, message: '', shanhetu: true }),
    async start() {},
  };
  const { party, request } = await fixture(t, adapter);
  const cookie = (await request('/api/me')).headers.get('set-cookie')!.split(';')[0]!;
  const notices: ReturnType<typeof party.lobby.list>[] = [];
  t.after(party.lobby.subscribe((rooms) => notices.push(rooms)));
  const quick = (presetId: string, requestId: string, fillBots = false, session = cookie) =>
    request(
      '/api/rooms/preset',
      'POST',
      { nickname: '快捷房主', presetId, requestId, fillBots },
      session,
    );
  const raced = await Promise.all([
    quick('doudizhu-3', 'once', true),
    quick('doudizhu-3', 'once', true),
  ]);
  assert.deepEqual(raced.map((response) => response.status).sort(), [200, 201]);
  const [first, second] = await Promise.all(raced.map((response) => response.json()));
  assert.equal(first.room.code, second.room.code);
  assert.equal(first.playerId, second.playerId);
  assert.deepEqual(notices, [
    [
      {
        code: first.room.code,
        ownerNickname: '快捷房主',
        mode: 'doudizhu',
        playerCount: 3,
        humanCount: 1,
        botCount: 2,
        phase: 'waiting',
      },
    ],
  ]);
  assert.deepEqual(await (await request('/api/events?transport=poll')).json(), notices[0]);
  const solo = await quick('shanhetu-solo', 'solo', true);
  assert.equal(solo.status, 200);
  const switched = await solo.json();
  assert.equal(switched.room.code, first.room.code);
  assert.equal(switched.playerId, first.playerId);
  assert.equal(switched.room.settings.mode, 'shanhetu');
  assert.equal(switched.room.players.length, 1);
  const college = await (await quick('college-4', 'college')).json();
  assert.equal(college.room.settings.collegeFormat, 'quick');
  assert.equal(college.room.settings.generalPreset, 'ol-college-2026');
  assert.equal((await quick('constructor', 'bad')).status, 400);
  const retry = await (await quick('doudizhu-3', 'once', true)).json();
  assert.equal(retry.room.settings.mode, 'college', '迟到重试不会重新应用之前的设置');
  const path = `/api/rooms/${first.room.code}`;
  const friend = await request(`${path}/players`, 'POST', { nickname: '朋友' });
  assert.equal(friend.status, 201);
  const friendCookie = friend.headers.get('set-cookie')!.split(';')[0]!;
  for (const session of [cookie, friendCookie]) {
    const conflict = await quick('identity-6', 'busy', true, session);
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.roomCode, first.room.code);
  }
  assert.equal(party.lobby.list()[0]!.humanCount, 2);
  assert.equal(party.lobby.list()[0]!.mode, 'college');
  assert.equal((await request('/api/rooms', 'POST', { nickname: '快捷房主' }, cookie)).status, 409);
});

test('HTTP 快捷山河图不可用时，大厅和原房间均保持原状', async (t) => {
  const { party, request, create } = await fixture(t);
  const body = { nickname: '旅人', presetId: 'shanhetu-solo', requestId: 'restricted' };
  const notices: unknown[] = [];
  t.after(party.lobby.subscribe((rooms) => notices.push(rooms)));
  assert.equal((await request('/api/rooms/preset', 'POST', body)).status, 503);
  assert.deepEqual(notices, []);
  assert.deepEqual(party.lobby.list(), []);
  const owner = await create('房主');
  assert.equal((await request('/api/rooms/preset', 'POST', body, owner.cookie)).status, 503);
  assert.equal(notices.length, 1);
  assert.equal(party.lobby.list()[0]!.mode, 'identity');
  assert.equal(party.lobby.list()[0]!.ownerNickname, '房主');
});

test('HTTP 回房确认严格按房间入座授权，公开摘要在回房后保留至下一局', async (t) => {
  let setup: MatchSetup | undefined;
  let matchId: string | null = null;
  let summary: PublicMatchSummary | undefined;
  let sequence = 0;
  const listeners = new Set<(event: EngineEvent) => void>();
  const adapter: EngineAdapter & { completedSummary(): PublicMatchSummary | undefined } = {
    status: () => ({ id: 'noname', ready: true, message: '' }),
    async start(value) {
      setup = value;
      matchId = `match-${++sequence}`;
    },
    matchId: () => matchId,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    release() {
      matchId = null;
      summary = undefined;
    },
    completedSummary: () => summary,
  };
  const { party, request, create } = await fixture(t, adapter);
  const owner = await create('甲');
  const outsider = await create('外桌');
  const path = `/api/rooms/${owner.data.room.code}`;
  const configure = await request(
    path,
    'PUT',
    {
      mode: 'duel',
      playerCount: 2,
      generalPreset: 'beginner',
      extensions: [],
    },
    owner.cookie,
  );
  assert.equal(configure.status, 200);
  const joined = await request(`${path}/players`, 'POST', { nickname: '乙' });
  const friendCookie = joined.headers.get('set-cookie')!.split(';')[0]!;
  const friend = await joined.json();
  const room = party.lobby.get(owner.data.room.code);
  for (const cookie of [owner.cookie, friendCookie]) t.after(room.connect(cookie.split('=')[1]));
  const start = async () => {
    for (const cookie of [owner.cookie, friendCookie])
      assert.equal((await request(`${path}/me/ready`, 'PUT', { ready: true }, cookie)).status, 200);
    assert.equal((await request(`${path}/start`, 'POST', undefined, owner.cookie)).status, 200);
  };
  const confirm = (cookie: string) => request(`${path}/return-confirm`, 'POST', undefined, cookie);
  assert.equal((await confirm(friendCookie)).status, 409);
  await start();
  const busy = await request(
    '/api/rooms/preset',
    'POST',
    { nickname: '甲', presetId: 'versus-2v2' },
    owner.cookie,
  );
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).error.roomCode, room.code);
  assert.equal((await confirm(friendCookie)).status, 409);
  const observer = sanitizeObserver(
    {
      ended: true,
      round: 3,
      recent: ['SECRET_LOG'],
      deck: 'SECRET_DECK',
      players: [
        {
          id: owner.data.playerId,
          general: '赵云',
          identity: '身份未公开',
          hand: 'SECRET_HAND',
          hiddenIdentity: 'SECRET_ROLE',
        },
        { id: friend.playerId, general: '关羽', identity: '反贼', dead: true },
      ],
    },
    setup!,
  );
  summary = completedPublicMatch(
    observer,
    {
      wins: ['SECRET'],
      winners: [owner.data.playerId],
      firstKill: owner.data.playerId,
      players: [
        { playerId: owner.data.playerId, kills: 1, damageDealt: 2, invite: 'SECRET_INVITE' },
      ],
      highlights: [
        {
          kind: 'kill',
          actor: owner.data.playerId,
          target: friend.playerId,
          amount: 1,
          text: 'SECRET',
        },
      ],
    },
    setup!,
    matchId!,
    100,
  );
  for (const emit of listeners) emit({ type: 'ended', roomCode: room.code, matchId: matchId! });
  assert.deepEqual(room.snapshot().returnedPlayerIds, []);
  for (const cookie of ['', outsider.cookie]) assert.equal((await confirm(cookie)).status, 401);
  assert.equal(
    (
      await request(
        `/api/rooms/${outsider.data.room.code}/return-confirm`,
        'POST',
        undefined,
        friendCookie,
      )
    ).status,
    401,
  );
  const marked = await (await confirm(friendCookie)).json();
  assert.deepEqual(marked.returnedPlayerIds, [friend.playerId]);
  assert.equal((await (await confirm(friendCookie)).json()).revision, marked.revision);
  assert.equal((await request(`${path}/rematch`, 'POST', undefined, friendCookie)).status, 403);
  const consolePage = await request('/server');
  const consoleCookie = consolePage.headers.get('set-cookie')!.split(';')[0]!;
  const rematch = await request(`${path}/rematch`, 'POST', undefined, owner.cookie);
  assert.equal(rematch.status, 200);
  const waiting = await rematch.json();
  assert.equal(waiting.phase, 'waiting');
  assert.equal(waiting.returnedPlayerIds, undefined);
  assert.equal(waiting.matchId, null);
  assert.deepEqual(waiting.lastMatchSummary, marked.lastMatchSummary);
  assert.deepEqual(waiting.lastMatchSummary.highlights, ['甲击杀乙']);
  assert.equal(waiting.lastMatchSummary.players[0].identityLabel, undefined);
  assert.equal(waiting.lastMatchSummary.players[1].identityLabel, '反贼');
  assert(!/SECRET|https?:/.test(JSON.stringify(waiting.lastMatchSummary)));
  const consoleResponse = await request('/api/console', 'GET', undefined, consoleCookie);
  assert.equal(consoleResponse.status, 200);
  const detail = (await consoleResponse.json()).rooms.find(
    (entry: { room: { code: string } }) => entry.room.code === room.code,
  );
  assert.deepEqual(detail.room.lastMatchSummary, waiting.lastMatchSummary);
  await start();
  assert.equal(room.snapshot().lastMatchSummary, undefined);
});

test('HTTP 同源白名单提供两张兹白 WebP，不开放任意素材路径', async (t) => {
  const { request } = await fixture(t);
  for (const name of ['day', 'night']) {
    const url = `/assets/zibai-${name}.webp`;
    const head = await request(url, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'image/webp');
    assert.equal(head.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(head.headers.get('cache-control'), 'public, max-age=3600');
    const file = Buffer.from(await (await request(url)).arrayBuffer());
    assert.equal(file.toString('ascii', 8, 12), 'WEBP');
  }
  assert.equal((await request('/assets/zibai-other.webp')).status, 404);
});

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
