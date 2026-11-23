// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { RoomStore } from '../apps/server/src/room.js';
import { createPartyServer } from '../apps/server/src/server.js';
import { shanhetuRecipe } from '../packages/noname-adapter/src/shanhetu.js';
import type {
  EngineAdapter,
  EngineEvent,
  MatchSetup,
} from '../packages/noname-adapter/src/index.js';

// Deliberately held adapter acknowledgments; no claim of native playability.
function fixtureEngine(hold = true) {
  const ids = new Map<string, string>(),
    requests: MatchSetup[] = [];
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  const listeners = new Set<(event: EngineEvent) => void>();
  const engine: EngineAdapter = {
    status: () => ({ id: 'noname', ready: true, shanhetu: true, message: '领域夹具' }),
    matchId: (code) => ids.get(code) ?? null,
    start(setup) {
      requests.push(structuredClone(setup));
      ids.set(setup.roomCode, randomUUID());
      return hold
        ? new Promise<void>((resolve, reject) => {
            pending.set(setup.roomCode, { resolve, reject });
          })
        : Promise.resolve();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    release(code) {
      ids.delete(code);
      pending.get(code)?.reject(new Error('Released'));
      pending.delete(code);
    },
  };
  return {
    engine,
    requests,
    emit(event: EngineEvent) {
      for (const listener of listeners) listener(event);
    },
    confirm(code: string) {
      pending.get(code)?.resolve();
      pending.delete(code);
    },
  };
}
const settings = {
  mode: 'shanhetu',
  playerCount: 1,
  generalPreset: 'beginner',
  allowGeneralSelection: false,
  extensions: [],
};
function action(room: RoomStore, index = 0) {
  const view = room.snapshot().shanhetu!;
  return { runId: view.id, revision: view.revision, actionId: view.actions[index]!.id };
}
async function prepare(engine: EngineAdapter) {
  const room = new RoomStore(engine),
    owner = room.join('出征者');
  room.connect(owner.token);
  room.updateSettings(settings, owner.token);
  room.setReady(owner.token, true);
  await room.start(owner.token);
  return { room, owner };
}

test('山河图房主权威、能力门禁与单人席位；原生确认前仍在starting，重复请求不重复启动', async () => {
  const f = fixtureEngine();
  const unavailable = new RoomStore({
    ...f.engine,
    status: () => ({ id: 'noname', ready: true, message: '旧服务' }),
  });
  const oldOwner = unavailable.join('旧服务');
  assert.throws(() => unavailable.updateSettings(settings, oldOwner.token), /尚未开放山河图/);
  unavailable.consoleClose();
  const { room, owner } = await prepare(f.engine);
  try {
    assert.equal(f.requests.length, 0, 'Creating a journey is not starting a native battle');
    assert.equal(room.snapshot().players.length, 1);
    assert.equal(room.snapshot().shanhetu?.phase, 'selection');
    assert.throws(() => room.updateSettings(settings, owner.token), /房间已关闭|对局正在启动/);
    await assert.rejects(room.shanhetuAction('another-room-session', action(room)), /房主/);
    const chosen = action(room);
    await room.shanhetuAction(owner.token, {
      ...chosen,
      hero: { hp: 1000 },
      effects: [{ kind: 'coins', amount: 99999 }],
    });
    assert(room.snapshot().shanhetu!.hero!.hp < 1000);
    assert.equal(room.snapshot().shanhetu!.coins, 0);
    const enter = action(room);
    const launching = room.shanhetuAction(owner.token, enter);
    void launching.catch(() => {});
    assert.equal(room.snapshot().phase, 'starting');
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0]!.settings.mode, 'shanhetu');
    assert.equal(f.requests[0]!.seats.length, 1, 'Only the adapter may expand NPCs');
    await room.shanhetuAction(owner.token, enter);
    assert.equal(f.requests.length, 1);
    f.confirm(room.code);
    await launching;
    assert.equal(room.snapshot().phase, 'playing');
    const setup = f.requests[0]!,
      ticket = setup.shanhetu!,
      matchId = room.snapshot().matchId!;
    const result = {
      runId: ticket.runId,
      nodeId: ticket.nodeId,
      battleId: ticket.battleId,
      outcome: 'victory' as const,
      hero: ticket.hero!,
      defeatedEnemies: shanhetuRecipe(ticket.battleId).enemies.length,
    };
    f.emit({ type: 'ended', roomCode: room.code, matchId: 'old-instance', shanhetu: result });
    assert.equal(room.snapshot().phase, 'playing');
    f.emit({ type: 'ended', roomCode: room.code, matchId, shanhetu: result });
    assert.equal(room.snapshot().phase, 'finished');
    const reward = action(room),
      settled = room.snapshot().shanhetu!;
    assert.equal(settled.phase, 'reward');
    await assert.rejects(room.shanhetuAction(owner.token, reward), /先回到征程/);
    f.emit({ type: 'ended', roomCode: room.code, matchId, shanhetu: result });
    assert.deepEqual(room.snapshot().shanhetu, settled);
    room.returnToWaiting(owner.token);
    assert.equal(room.snapshot().matchId, null);
    assert.deepEqual(room.snapshot().shanhetu, settled, 'Native return keeps the journey');
    await room.shanhetuAction(owner.token, reward);
    const after = room.snapshot().shanhetu!;
    await room.shanhetuAction(owner.token, reward);
    assert.deepEqual(room.snapshot().shanhetu, after);
    assert.throws(() => room.endShanhetu(owner.token, { runId: 'old-run' }), /征程已改变/);
    room.endShanhetu(owner.token, { runId: after.id });
    assert.equal(room.snapshot().shanhetu, undefined);
    assert.equal(room.snapshot().phase, 'waiting');
  } finally {
    room.consoleClose();
  }
});

test('没有PVE结果的旧胜者协议只能中断；主动结束阻止旧启动回调与旧结果进入新征程', async () => {
  const f = fixtureEngine();
  const { room, owner } = await prepare(f.engine);
  try {
    await room.shanhetuAction(owner.token, action(room));
    const launch = room.shanhetuAction(owner.token, action(room));
    void launch.catch(() => {});
    f.confirm(room.code);
    await launch;
    f.emit({
      type: 'ended',
      roomCode: room.code,
      matchId: room.snapshot().matchId!,
      winner: 'landlord',
    });
    assert.equal(room.snapshot().matchFailure?.code, 'protocol-error');
    assert.equal(room.snapshot().shanhetu?.phase, 'interrupted');
    assert.equal(room.snapshot().shanhetu?.coins, 0);
    room.returnToWaiting(owner.token);
    const oldRun = room.snapshot().shanhetu!.id;
    const retry = room.shanhetuAction(owner.token, action(room));
    void retry.catch(() => {});
    assert.equal(room.snapshot().phase, 'starting');
    room.endShanhetu(owner.token, { runId: oldRun });
    await assert.rejects(retry, /已结束这次开局/);
    assert.equal(room.snapshot().phase, 'waiting');
    assert.equal(room.snapshot().shanhetu, undefined);
    room.setReady(owner.token, true);
    await room.start(owner.token);
    assert.notEqual(room.snapshot().shanhetu?.id, oldRun);
    assert.throws(() => room.endShanhetu(owner.token, { runId: oldRun }), /征程已改变/);
    assert.equal(room.snapshot().idleCloseAt, null);
  } finally {
    room.consoleClose();
  }
});

test('重开等待真实开局后的30秒，沿用本关与成长，十次限额及旧结果由服务器约束', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const f = fixtureEngine(false);
  const { room, owner } = await prepare(f.engine);
  t.after(() => room.consoleClose());
  await room.shanhetuAction(owner.token, action(room));
  await room.shanhetuAction(owner.token, action(room));
  const original = room.snapshot().shanhetu!;
  const match = room.snapshot().matchId!;
  const request = { runId: original.id, matchId: match };
  assert.equal(original.restartAt, Date.now() + 30000);
  await assert.rejects(room.restartShanhetu(owner.token, request), /30秒/);
  assert.equal(f.requests.length, 1);
  const first = f.requests[0]!.shanhetu!;
  for (let i = 0; i < 10; i++) {
    t.mock.timers.tick(30000);
    const matchId = room.snapshot().matchId!;
    await room.restartShanhetu(owner.token, { ...request, matchId });
    const next = room.snapshot().shanhetu!;
    assert.notEqual(room.snapshot().matchId, matchId);
    assert.equal(next.restartsLeft, 9 - i);
    assert.equal(next.days, original.days);
    assert.equal(next.coins, original.coins);
    assert.deepEqual(next.hero, original.hero);
    assert.deepEqual(next.build, original.build);
    const ticket = f.requests.at(-1)!.shanhetu!;
    assert.equal(ticket.battleId, first.battleId);
    assert.notEqual(ticket.nodeId, first.nodeId);
  }
  f.emit({
    type: 'ended',
    roomCode: room.code,
    matchId: match,
    shanhetu: {
      runId: first.runId,
      nodeId: first.nodeId,
      battleId: first.battleId,
      hero: first.hero!,
      outcome: 'victory',
      defeatedEnemies: shanhetuRecipe(first.battleId).enemies.length,
    },
  });
  assert.equal(room.snapshot().phase, 'playing');
  assert.equal(room.snapshot().shanhetu!.phase, 'battle');
  await assert.rejects(room.restartShanhetu(owner.token, request), /本关已改变/);
  t.mock.timers.tick(30000);
  await assert.rejects(
    room.restartShanhetu(owner.token, { ...request, matchId: room.snapshot().matchId! }),
    /用完/,
  );
  assert.equal(f.requests.length, 11);
});

test('山河图HTTP只接受本房会话和当前席位；电脑／访客／跨房会话不能选将或结束征程', async (t) => {
  const f = fixtureEngine(false);
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../dist/web', import.meta.url)),
    adapter: f.engine,
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(party.server.address() as { port: number }).port}`;
  t.after(async () => {
    const closed = once(party.server, 'close');
    party.stop();
    party.server.closeAllConnections();
    await closed;
  });
  const create = async (nickname: string) => {
    const response = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    });
    return {
      cookie: response.headers.get('set-cookie')!.split(';')[0]!,
      data: await response.json(),
    };
  };
  const owner = await create('房主'),
    stranger = await create('另一桌');
  const path = `/api/rooms/${owner.data.room.code}`;
  const request = (
    suffix: string,
    body: unknown,
    cookie = owner.cookie,
    expected = owner.data.playerId,
    method = 'POST',
  ) =>
    fetch(base + path + suffix, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Party-Player': expected },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await request('', settings, owner.cookie, owner.data.playerId, 'PUT')).status, 200);
  const book = await request('/shanhetu/book', null, owner.cookie, owner.data.playerId, 'GET');
  assert.equal(book.status, 200);
  assert.equal((await book.json()).victories, 0);
  assert(book.headers.get('set-cookie')?.startsWith('party_shanhetu_book='));
  assert.equal(
    (await request('/shanhetu/book', null, stranger.cookie, stranger.data.playerId, 'GET')).status,
    403,
  );
  const room = party.lobby.get(owner.data.room.code);
  room.connect(owner.cookie.slice('party_player='.length));
  for (const invalid of [null, '2', 26])
    assert.equal((await request('/start', { difficulty: invalid })).status, 400);
  for (const openingTactic of ['2219', 3225, [2219, 2138]])
    assert.equal((await request('/start', { openingTactic })).status, 400);
  for (const difficulty of [2, 6, 11, 21, 25]) {
    const locked = await request('/start', { difficulty, outcome: 'victory' });
    assert.equal(locked.status, 409);
    assert.equal((await locked.json()).error.code, 'DIFFICULTY_LOCKED');
  }
  assert.equal(room.snapshot().shanhetu, undefined);
  assert.equal((await request('/start', undefined)).status, 200);
  assert.equal(room.snapshot().shanhetu?.difficulty, 1);
  assert.equal(
    (await request('/shanhetu/book', { operation: 'equip', slot: 0, nodeId: null, revision: 0 }))
      .status,
    404,
  );
  const first = action(room),
    before = room.snapshot().shanhetu;
  for (const cookie of ['', stranger.cookie]) {
    const response = await request(
      '/shanhetu/action',
      first,
      cookie,
      cookie ? stranger.data.playerId : 'visitor',
    );
    assert([403, 409].includes(response.status));
    const end = await request(
      '/shanhetu/end',
      { runId: first.runId },
      cookie,
      cookie ? stranger.data.playerId : 'visitor',
    );
    assert([403, 409].includes(end.status));
  }
  assert.equal((await request('/shanhetu/action', first, owner.cookie, 'stale-seat')).status, 409);
  assert.deepEqual(room.snapshot().shanhetu, before);
  assert.equal(
    (await request('/shanhetu/action', { ...first, winner: 'victory', coins: 10000 })).status,
    200,
  );
  assert.equal(room.snapshot().shanhetu?.coins, 0);
  assert.equal(f.requests.length, 0);
  assert.equal((await request('/shanhetu/end', { runId: first.runId })).status, 200);
  assert.equal(room.snapshot().shanhetu, undefined);
});
