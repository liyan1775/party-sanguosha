import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type {
  EngineAdapter,
  EngineEvent,
  MatchSetup,
} from '../packages/noname-adapter/src/index.js';
import { NonameAdapter } from '../packages/noname-adapter/src/index.js';
import { RoomStore } from '../apps/server/src/room.js';
import { LobbyStore } from '../apps/server/src/lobby.js';
import { AppError } from '../apps/server/src/errors.js';
import { findHomeUrls, findJoinUrls, isLoopbackPortOccupied } from '../apps/server/src/network.js';
import { ROOM_IDLE_GRACE_MS } from '../packages/shared/src/contracts.js';

function fakeEngine(start: (setup: MatchSetup) => Promise<void> = async () => {}): EngineAdapter {
  return { status: () => ({ id: 'noname', ready: true, message: 'test engine' }), start };
}
function ownedRoom(engine = fakeEngine()) {
  const room = new RoomStore(engine);
  const owner = room.join('赵云');
  return { room, owner };
}
function code(expected: string) {
  return (error: unknown) => error instanceof AppError && error.code === expected;
}

test('无效建房不遗留引擎订阅；关闭最后真人的房间释放订阅', () => {
  const listeners = new Set<(event: EngineEvent) => void>();
  const engine: EngineAdapter = {
    ...fakeEngine(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const lobby = new LobbyStore(engine);
  for (let i = 0; i < 5; i++) assert.throws(() => lobby.create(''), code('INVALID_NICKNAME'));
  assert.equal(listeners.size, 0);
  const owner = lobby.create('房主');
  assert.equal(listeners.size, 1);
  owner.room.leave(owner.token);
  assert.equal(listeners.size, 0);
});

test('局间最后真人离线满10分钟自动关房；AI、观战及状态广播不续期，其他房间保持', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const listeners = new Set<(event: EngineEvent) => void>();
  const released: string[] = [];
  const lobby = new LobbyStore({
    ...fakeEngine(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    release: (roomCode) => released.push(roomCode),
  });
  const owner = lobby.create('待回收');
  const member = lobby.join(owner.room.code, '朋友');
  owner.room.addBots(3, owner.token);
  const disconnectOwner = owner.room.connect(owner.token);
  const disconnectMember = owner.room.connect(member.token);
  const other = lobby.create('另桌');
  other.room.connect(other.token);
  disconnectOwner();
  assert.equal(owner.room.snapshot().idleCloseAt, null);
  t.mock.timers.tick(1000);
  disconnectMember();
  const deadline = Date.now() + ROOM_IDLE_GRACE_MS;
  assert.equal(owner.room.snapshot().idleCloseAt, deadline);
  const disconnectSpectator = owner.room.connect();
  owner.room.poll('unseated-observer');
  for (const listener of listeners) listener({ type: 'status' });
  assert.equal(owner.room.snapshot().idleCloseAt, deadline);
  lobby.sweep(deadline - 1);
  assert.equal(lobby.list().length, 2);
  lobby.sweep(deadline);
  assert.equal(owner.room.snapshot().phase, 'closed');
  assert.equal(owner.room.snapshot().players.length, 0);
  assert.deepEqual(released, [owner.room.code]);
  assert.equal(listeners.size, 1);
  assert.throws(() => lobby.get(owner.room.code), code('ROOM_NOT_FOUND'));
  assert.deepEqual(lobby.session(member.token), { roomCode: null, playerId: null });
  assert.equal(lobby.get(other.room.code).snapshot().ownerId, other.playerId);
  const revision = owner.room.snapshot().revision;
  disconnectSpectator();
  disconnectMember();
  assert.equal(owner.room.snapshot().revision, revision);
  const next = lobby.create('新房', owner.token);
  assert.equal(next.token, owner.token);
  assert.notEqual(next.playerId, owner.playerId);
});

test('SSE和HTTP租约共同保留在线；回房取消旧回收，重新离线再给完整10分钟', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const lobby = new LobbyStore(fakeEngine());
  const owner = lobby.create('房主');
  const firstTab = owner.room.connect(owner.token);
  const secondTab = owner.room.connect(owner.token);
  owner.room.poll(owner.token);
  firstTab();
  secondTab();
  lobby.sweep();
  assert.equal(owner.room.snapshot().idleCloseAt, null);
  t.mock.timers.tick(30000);
  lobby.sweep();
  const oldDeadline = Date.now() + ROOM_IDLE_GRACE_MS;
  assert.equal(owner.room.snapshot().idleCloseAt, oldDeadline);
  t.mock.timers.tick(ROOM_IDLE_GRACE_MS - 1000);
  owner.room.poll(owner.token);
  assert.equal(owner.room.snapshot().idleCloseAt, null);
  t.mock.timers.tick(1000);
  lobby.sweep();
  assert.equal(lobby.list().length, 1);
  t.mock.timers.tick(29000);
  lobby.sweep();
  const newDeadline = Date.now() + ROOM_IDLE_GRACE_MS;
  assert.equal(owner.room.snapshot().idleCloseAt, newDeadline);
  const reconnect = owner.room.connect(owner.token);
  lobby.sweep(newDeadline);
  assert.equal(owner.room.snapshot().idleCloseAt, null);
  t.mock.timers.tick(2000);
  reconnect();
  const lastDeadline = Date.now() + ROOM_IDLE_GRACE_MS;
  assert.equal(owner.room.snapshot().idleCloseAt, lastDeadline);
  lobby.sweep(lastDeadline - 1);
  assert.equal(lobby.list().length, 1);
  lobby.sweep(lastDeadline);
  assert.equal(lobby.list().length, 0);
});

test('选将和进行中的无人牌局不回收；长时间离线的牌局结算后才开始10分钟保留', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  let confirm!: () => void;
  let emit!: (event: EngineEvent) => void;
  let released = 0;
  const lobby = new LobbyStore({
    ...fakeEngine(
      () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
    ),
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
    release: () => {
      released++;
    },
  });
  const owner = lobby.create('房主');
  owner.room.addBots(4, owner.token);
  const disconnect = owner.room.connect(owner.token);
  owner.room.setReady(owner.token, true);
  const starting = owner.room.start(owner.token);
  disconnect();
  t.mock.timers.tick(ROOM_IDLE_GRACE_MS * 2);
  lobby.sweep();
  assert.equal(owner.room.snapshot().phase, 'starting');
  assert.equal(owner.room.snapshot().idleCloseAt, null);
  confirm();
  await starting;
  t.mock.timers.tick(ROOM_IDLE_GRACE_MS * 2);
  lobby.sweep();
  assert.equal(owner.room.snapshot().phase, 'playing');
  assert.equal(released, 0);
  emit({ type: 'ended', roomCode: owner.room.code });
  const deadline = Date.now() + ROOM_IDLE_GRACE_MS;
  assert.equal(owner.room.snapshot().phase, 'finished');
  assert.equal(owner.room.snapshot().idleCloseAt, deadline);
  lobby.sweep(deadline - 1);
  assert.equal(lobby.list().length, 1);
  lobby.sweep(deadline);
  assert.equal(lobby.list().length, 0);
  assert.equal(released, 1);
});

test('开局失败释放本次引擎并撤销准备，不能沿用失败前的确认直接重试', async () => {
  let released = 0;
  const { room, owner } = ownedRoom({
    ...fakeEngine(async () => {
      throw new Error('资源不可用');
    }),
    release: () => {
      released++;
    },
  });
  room.addBots(4, owner.token);
  room.connect(owner.token);
  room.setReady(owner.token, true);
  await assert.rejects(room.start(owner.token), code('ENGINE_START_FAILED'));
  assert.equal(room.snapshot().phase, 'waiting');
  assert.equal(room.session(owner.token)?.ready, false);
  assert.equal(released, 1);
  await assert.rejects(room.start(owner.token), code('PLAYERS_NOT_READY'));
});

test('取消的开局即使迟到成功也返回取消，不能把下一次开局误报成功', async () => {
  let confirm!: () => void;
  const { room, owner } = ownedRoom(
    fakeEngine(
      () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
    ),
  );
  room.addBots(4, owner.token);
  room.connect(owner.token);
  room.setReady(owner.token, true);
  const starting = room.start(owner.token);
  room.consoleReset();
  confirm();
  await assert.rejects(starting, code('MATCH_CANCELLED'));
  assert.equal(room.snapshot().phase, 'waiting');
});

test('结算后成员能直接离房，房主离开时交接并释放旧局，最后真人关闭房间', async () => {
  let emit!: (event: EngineEvent) => void;
  let released = 0;
  const engine: EngineAdapter = {
    ...fakeEngine(),
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
    release: () => {
      released++;
    },
  };
  const lobby = new LobbyStore(engine);
  const owner = lobby.create('房主');
  const first = lobby.join(owner.room.code, '先离开');
  const successor = lobby.join(owner.room.code, '接班');
  owner.room.addBots(2, owner.token);
  for (const player of [owner, first, successor]) {
    owner.room.connect(player.token);
    owner.room.setReady(player.token, true);
  }
  await owner.room.start(owner.token);
  emit({ type: 'ended', roomCode: owner.room.code });
  owner.room.leave(first.token);
  assert.equal(owner.room.snapshot().phase, 'finished');
  assert.equal(released, 0);
  assert.deepEqual(lobby.session(first.token), { roomCode: null, playerId: null });
  owner.room.leave(owner.token);
  assert.equal(owner.room.snapshot().phase, 'waiting');
  assert.equal(owner.room.snapshot().ownerId, successor.playerId);
  assert.equal(released, 1);
  assert.equal(owner.room.session(successor.token)?.ready, false);
  owner.room.leave(successor.token);
  assert.equal(lobby.list().length, 0);
});

test('转交只允许局间的房主交给本房在线真人，保留席位并重新准备', async () => {
  const { room, owner } = ownedRoom();
  const member = room.join('在线朋友');
  const absent = room.join('离线朋友');
  room.connect(owner.token);
  room.connect(member.token);
  room.addBots(2, owner.token);
  room.setReady(owner.token, true);
  room.setReady(member.token, true);
  const bot = room.snapshot().players.find((player) => player.kind === 'bot')!;
  for (const token of [undefined, member.token, ownedRoom().owner.token])
    assert.throws(() => room.transferOwnership(member.playerId, token), code('OWNER_REQUIRED'));
  for (const id of [null, owner.playerId, bot.id, 'other-room-player'])
    assert.throws(() => room.transferOwnership(id, owner.token), code('INVALID_SUCCESSOR'));
  assert.throws(
    () => room.transferOwnership(absent.playerId, owner.token),
    code('SUCCESSOR_OFFLINE'),
  );
  room.transferOwnership(member.playerId, owner.token);
  assert.equal(room.snapshot().ownerId, member.playerId);
  assert.equal(room.snapshot().players.length, 5);
  assert.equal(room.session(owner.token)?.ready, false);
  assert.equal(room.session(member.token)?.ready, false);
  assert.throws(() => room.addBots(1, owner.token), code('OWNER_REQUIRED'));
  room.removePlayer(absent.playerId, member.token);
  room.addBots(1, member.token);
  room.setReady(owner.token, true);
  room.setReady(member.token, true);
  await room.start(member.token);
  assert.throws(() => room.transferOwnership(owner.playerId, member.token), code('ROOM_LOCKED'));
  assert.throws(() => room.claimOwnership(member.playerId, owner.token), code('ROOM_LOCKED'));
});

test('离线房主保留60秒；在线成员显式接任且旧房主仍在席位，过期与跨房请求拒绝', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const { room, owner } = ownedRoom();
  const member = room.join('接班');
  const rival = room.join('另一位');
  const disconnect = room.connect(owner.token);
  room.connect(member.token);
  room.connect(rival.token);
  disconnect();
  const claimAt = room.snapshot().ownerClaimAt!;
  assert.equal(claimAt, 1060000);
  assert.throws(
    () => room.claimOwnership(owner.playerId, member.token, claimAt - 1),
    code('OWNER_RESERVED'),
  );
  for (const token of [undefined, ownedRoom().owner.token])
    assert.throws(
      () => room.claimOwnership(owner.playerId, token, claimAt),
      code('PLAYER_REQUIRED'),
    );
  room.claimOwnership(owner.playerId, member.token, claimAt);
  assert.equal(room.snapshot().ownerId, member.playerId);
  assert.equal(room.session(owner.token)?.id, owner.playerId);
  assert.throws(
    () => room.claimOwnership(owner.playerId, rival.token, claimAt),
    code('OWNER_CHANGED'),
  );
  assert.throws(() => room.updateSettings({}, owner.token), code('OWNER_REQUIRED'));
  room.connect(owner.token);
  assert.equal(room.snapshot().ownerId, member.playerId);
});

test('重连取消接任资格；HTTP离线从原租约到期计算，失效准备不能趁清理间隙开局', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const { room, owner } = ownedRoom();
  const member = room.join('朋友');
  room.connect(member.token);
  room.addBots(3, owner.token);
  room.poll(owner.token);
  room.setReady(owner.token, true);
  room.setReady(member.token, true);
  t.mock.timers.tick(30001);
  await assert.rejects(room.start(owner.token), code('PLAYERS_NOT_READY'));
  assert.equal(room.snapshot().ownerClaimAt, 1090000);
  room.poll(owner.token);
  assert.equal(room.snapshot().ownerClaimAt, null);
  assert.throws(() => room.claimOwnership(owner.playerId, member.token), code('OWNER_RESERVED'));
});

test('规则端中断不静默回房：恢复期锁原局，失败无胜负，房主显式回房后才能再准备', async () => {
  let emit: (event: EngineEvent) => void = () => {};
  const engine: EngineAdapter = {
    ...fakeEngine(),
    matchId: () => 'original-match',
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
  };
  const { room, owner } = ownedRoom(engine);
  room.updateSettings(
    { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
    owner.token,
  );
  const friend = room.join('朋友');
  room.connect(owner.token);
  room.connect(friend.token);
  room.setReady(owner.token, true);
  room.setReady(friend.token, true);
  await room.start(owner.token);
  emit({ type: 'recovering', roomCode: room.code, deadline: 20000 });
  assert.equal(room.snapshot().phase, 'playing');
  assert.equal(room.snapshot().matchRecovery?.deadline, 20000);
  emit({ type: 'recovered', roomCode: room.code });
  assert.equal(room.snapshot().matchRecovery, undefined);
  emit({ type: 'failed', roomCode: room.code, code: 'worker-disconnected' });
  assert.equal(room.snapshot().phase, 'finished');
  assert.equal(room.snapshot().matchFailure?.code, 'worker-disconnected');
  assert.equal(room.snapshot().matchId, 'original-match');
  assert.equal(room.snapshot().players.length, 2);
  await assert.rejects(room.start(owner.token), code('ROOM_LOCKED'));
  assert.throws(() => room.returnToWaiting(friend.token), code('OWNER_REQUIRED'));
  room.returnToWaiting(owner.token);
  assert.equal(room.snapshot().phase, 'waiting');
  assert.equal(room.snapshot().matchFailure, undefined);
  assert(room.snapshot().players.every((player) => !player.ready));
});

test('服务不预建房间，玩家建房自动成为参赛房主，会话不能同时占两间房', () => {
  const lobby = new LobbyStore(fakeEngine());
  assert.deepEqual(lobby.list(), []);
  assert.throws(() => lobby.create(''), code('INVALID_NICKNAME'));
  assert.equal(lobby.list().length, 0);
  const first = lobby.create('赵云');
  const second = lobby.create('小乔');
  assert.notEqual(first.room.code, second.room.code);
  assert.equal(first.room.snapshot().ownerId, first.playerId);
  assert.equal(first.room.snapshot().players[0]?.kind, 'human');
  assert.deepEqual(lobby.session(first.token), {
    roomCode: first.room.code,
    playerId: first.playerId,
  });
  assert.throws(() => lobby.create('赵云', first.token), code('ALREADY_IN_ROOM'));
  assert.throws(() => lobby.join(second.room.code, '赵云', first.token), code('ALREADY_IN_ROOM'));
  assert.throws(() => lobby.get('OLD123'), code('ROOM_NOT_FOUND'));
  assert.equal(lobby.join(first.room.code, '赵云', first.token).playerId, first.playerId);
});

test('身份局限制 5–8 总席位，其余模式固定人数，禁止未知武将档与扩展', () => {
  const { room, owner } = ownedRoom();
  for (const [mode, playerCount] of [
    ['identity', 8],
    ['doudizhu', 3],
    ['versus', 4],
    ['duel', 2],
  ] as const) {
    room.updateSettings(
      { mode, playerCount, generalPreset: 'beginner', extensions: [] },
      owner.token,
    );
    assert.equal(room.snapshot().settings.playerCount, playerCount);
  }
  for (const [mode, playerCount] of [
    ['identity', 4],
    ['identity', 9],
    ['doudizhu', 4],
    ['versus', 2],
    ['duel', 3],
  ] as const)
    assert.throws(
      () =>
        room.updateSettings(
          { mode, playerCount, generalPreset: 'beginner', extensions: [] },
          owner.token,
        ),
      code('INVALID_MODE'),
    );
  assert.throws(
    () =>
      room.updateSettings(
        { mode: 'duel', playerCount: 2, generalPreset: 'all', extensions: [] },
        owner.token,
      ),
    code('INVALID_PRESET'),
  );
  assert.throws(
    () =>
      room.updateSettings(
        { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: ['unknown'] },
        owner.token,
      ),
    code('UNSUPPORTED_EXTENSION'),
  );
});

test('只有本房间玩家房主能设置、添加 AI、移人和开局，不能移除自己', async () => {
  const { room, owner } = ownedRoom();
  const friend = room.join('关羽');
  const stranger = ownedRoom().owner;
  for (const token of [undefined, friend.token, stranger.token]) {
    assert.throws(() => room.updateSettings({}, token), code('OWNER_REQUIRED'));
    assert.throws(() => room.addBots(1, token), code('OWNER_REQUIRED'));
    assert.throws(() => room.removePlayer(friend.playerId, token), code('OWNER_REQUIRED'));
    await assert.rejects(room.start(token), code('OWNER_REQUIRED'));
  }
  assert.throws(
    () => room.removePlayer(owner.playerId, owner.token),
    code('OWNER_CANNOT_KICK_SELF'),
  );
});

test('满房仍能恢复本人及房主身份，公开数据不含会话 token', () => {
  const { room, owner } = ownedRoom();
  room.updateSettings(
    { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
    owner.token,
  );
  room.join('关羽');
  assert.equal(room.join('赵云重进', owner.token).playerId, owner.playerId);
  assert.equal(room.snapshot().players.length, 2);
  assert.equal(room.snapshot().ownerId, owner.playerId);
  assert.throws(() => room.join('张飞'), code('ROOM_FULL'));
  assert.equal(JSON.stringify(room.snapshot()).includes(owner.token), false);
  assert.throws(() => room.join('\u0000坏昵称'), code('INVALID_NICKNAME'));
});

test('大厅点将默认关闭、按真人会话保留且不重复，更换档位或关闭后清除', () => {
  const { room, owner } = ownedRoom();
  const friend = room.join('朋友');
  const other = ownedRoom().owner;
  const settings = { mode: 'identity', playerCount: 5, generalPreset: 'beginner', extensions: [] };
  assert.equal(room.snapshot().settings.allowGeneralSelection, false);
  assert.throws(
    () => room.setGeneralChoice(owner.token, 'zhaoyun'),
    code('GENERAL_SELECTION_DISABLED'),
  );
  assert.throws(
    () => room.updateSettings({ ...settings, allowGeneralSelection: true }, friend.token),
    code('OWNER_REQUIRED'),
  );
  for (const value of [null, 'true', 1])
    assert.throws(
      () => room.updateSettings({ ...settings, allowGeneralSelection: value }, owner.token),
      code('INVALID_GENERAL_SELECTION'),
    );
  room.updateSettings({ ...settings, allowGeneralSelection: true }, owner.token);
  assert.equal(room.generalChoice(owner.token).available.length, 27);
  for (const token of [undefined, other.token])
    assert.throws(() => room.setGeneralChoice(token, 'zhaoyun'), code('PLAYER_REQUIRED'));
  for (const general of [undefined, 1, '', 'shen_zhaoyun', 'not_a_general'])
    assert.throws(() => room.setGeneralChoice(owner.token, general), code('INVALID_GENERAL'));
  room.connect(owner.token);
  room.connect(friend.token);
  room.setReady(owner.token, true);
  room.setReady(friend.token, true);
  room.setGeneralChoice(owner.token, 'zhaoyun');
  assert(room.snapshot().players.every((player) => !player.ready));
  assert.equal(room.generalChoice(owner.token).selected, 'zhaoyun');
  assert.equal(room.generalChoice(friend.token).available.includes('zhaoyun'), false);
  assert.throws(() => room.setGeneralChoice(friend.token, 'zhaoyun'), code('GENERAL_TAKEN'));
  assert.equal(JSON.stringify(room.snapshot()).includes('zhaoyun'), false);
  const revision = room.snapshot().revision;
  room.setGeneralChoice(owner.token, 'zhaoyun');
  assert.equal(room.snapshot().revision, revision);
  room.updateSettings(settings, owner.token);
  assert.equal(
    room.generalChoice(owner.token).selected,
    'zhaoyun',
    'older setting payload preserves the switch',
  );
  room.setGeneralChoice(owner.token, null);
  room.setGeneralChoice(friend.token, 'zhaoyun');
  room.leave(friend.token);
  assert.equal(room.generalChoice(owner.token).available.length, 27);
  room.setGeneralChoice(owner.token, 'caocao');
  room.updateSettings({ ...settings, generalPreset: 'advanced' }, owner.token);
  assert.equal(room.generalChoice(owner.token).selected, null);
  assert.equal(room.generalChoice(owner.token).available.length, 96);
  assert.throws(() => room.setGeneralChoice(owner.token, 'shen_zhaoyun'), code('INVALID_GENERAL'));
  room.setGeneralChoice(owner.token, 'caoang');
  room.updateSettings(
    { ...settings, generalPreset: 'advanced', allowGeneralSelection: false },
    owner.token,
  );
  room.updateSettings(
    { ...settings, generalPreset: 'advanced', allowGeneralSelection: true },
    owner.token,
  );
  assert.equal(room.generalChoice(owner.token).selected, null);
});

test('点将只交给本房真实引擎启动配置，对局开始后不能改点将', async () => {
  let received: MatchSetup | undefined;
  const { room, owner } = ownedRoom(
    fakeEngine(async (setup) => {
      received = setup;
    }),
  );
  room.updateSettings(
    {
      mode: 'duel',
      playerCount: 2,
      generalPreset: 'beginner',
      extensions: [],
      allowGeneralSelection: true,
    },
    owner.token,
  );
  room.addBots(1, owner.token);
  room.setGeneralChoice(owner.token, 'zhaoyun');
  room.connect(owner.token);
  room.setReady(owner.token, true);
  await room.start(owner.token);
  assert.deepEqual(received?.generalSelections, { [owner.playerId]: 'zhaoyun' });
  assert.equal(received?.settings.allowGeneralSelection, true);
  assert.throws(() => room.setGeneralChoice(owner.token, null), code('ROOM_LOCKED'));
});

test('匿名电脑连接不占席位；多标签与刷新断线保留房主，最后连接关闭撤销准备', () => {
  const { room, owner } = ownedRoom();
  const disconnectComputer = room.connect();
  assert.equal(room.snapshot().players.length, 1);
  const disconnectA = room.connect(owner.token);
  const disconnectB = room.connect(owner.token);
  room.setReady(owner.token, true);
  disconnectA();
  disconnectA();
  assert.equal(room.session(owner.token)?.online, true);
  disconnectB();
  assert.equal(room.session(owner.token)?.online, false);
  assert.equal(room.session(owner.token)?.ready, false);
  assert.equal(room.snapshot().ownerId, owner.playerId);
  room.connect(owner.token);
  assert.equal(room.snapshot().ownerId, owner.playerId);
  disconnectComputer();
});

test('5 人与 8 人身份局用 AI 补足席位，AI 自动准备，满房添加失败且没有智力参数', () => {
  const { room, owner } = ownedRoom();
  room.join('关羽');
  room.connect(owner.token);
  room.setReady(owner.token, true);
  room.addBots(3, owner.token);
  assert.equal(room.snapshot().players.length, 5);
  assert.equal(room.session(owner.token)?.ready, false);
  assert.ok(
    room
      .snapshot()
      .players.filter((player) => player.kind === 'bot')
      .every((player) => player.ready && player.online),
  );
  assert.throws(() => room.addBots(1, owner.token), code('ROOM_FULL'));
  assert.throws(() => room.addBots(-1, owner.token), code('INVALID_BOT_COUNT'));
  room.updateSettings(
    { mode: 'identity', playerCount: 8, generalPreset: 'beginner', extensions: [] },
    owner.token,
  );
  room.addBots(3, owner.token);
  assert.equal(room.snapshot().players.filter((player) => player.kind === 'bot').length, 6);
  assert.equal(room.snapshot().players.length, 8);
  const bot = room.snapshot().players.find((player) => player.kind === 'bot')!;
  assert.throws(() => room.setReady(bot.id, false), code('PLAYER_REQUIRED'));
  assert.equal('difficulty' in room.snapshot().settings, false);
});

test('缩小房间自动裁掉多余 AI、保留真人；玩法与席位变化撤销真人准备', () => {
  const { room, owner } = ownedRoom();
  const friend = room.join('关羽');
  room.addBots(3, owner.token);
  for (const player of [owner, friend]) {
    room.connect(player.token);
    room.setReady(player.token, true);
  }
  room.updateSettings(
    { mode: 'doudizhu', playerCount: 3, generalPreset: 'advanced', extensions: [] },
    owner.token,
  );
  assert.equal(room.snapshot().players.length, 3);
  assert.equal(room.snapshot().players.filter((player) => player.kind === 'bot').length, 1);
  assert.ok(
    room
      .snapshot()
      .players.filter((player) => player.kind === 'human')
      .every((player) => !player.ready),
  );
  room.setReady(owner.token, true);
  room.removePlayer(friend.playerId, owner.token);
  assert.equal(room.session(owner.token)?.ready, false);
  room.join('张飞');
  room.removePlayer(
    room.snapshot().players.find((player) => player.kind === 'bot')!.id,
    owner.token,
  );
  room.join('马超');
  assert.throws(
    () =>
      room.updateSettings(
        { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
        owner.token,
      ),
    code('TOO_MANY_PLAYERS'),
  );
});

test('房主显式离开交接给下一位真人；最后真人离开关闭房间和 AI 并失效旧邀请', () => {
  const lobby = new LobbyStore(fakeEngine());
  const owner = lobby.create('赵云');
  const friend = lobby.join(owner.room.code, '小乔');
  owner.room.addBots(3, owner.token);
  const disconnect = owner.room.connect(owner.token);
  owner.room.leave(owner.token);
  assert.equal(owner.room.snapshot().ownerId, friend.playerId);
  assert.throws(() => owner.room.addBots(1, owner.token), code('OWNER_REQUIRED'));
  owner.room.removePlayer(
    owner.room.snapshot().players.find((seat) => seat.kind === 'bot')!.id,
    friend.token,
  );
  const revision = owner.room.snapshot().revision;
  disconnect();
  assert.equal(owner.room.snapshot().revision, revision);
  friend.room.leave(friend.token);
  assert.equal(friend.room.snapshot().phase, 'closed');
  assert.equal(friend.room.snapshot().players.length, 0);
  assert.equal(lobby.list().length, 0);
  assert.deepEqual(lobby.session(friend.token), { playerId: null, roomCode: null });
  assert.throws(() => lobby.get(friend.room.code), code('ROOM_NOT_FOUND'));
});

test('真实适配器未接入时，补满 AI 也必须拒绝开局', async () => {
  const { room, owner } = ownedRoom(new NonameAdapter());
  room.addBots(4, owner.token);
  room.connect(owner.token);
  room.setReady(owner.token, true);
  await assert.rejects(room.start(owner.token), code('ENGINE_NOT_READY'));
  assert.equal(room.snapshot().phase, 'waiting');
});

test('开局等待引擎确认，锁定重复开局、AI、离开、移人与设置；失败恢复', async () => {
  let rejectStart: (error: Error) => void = () => {};
  const { room, owner } = ownedRoom(
    fakeEngine(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        }),
    ),
  );
  room.updateSettings(
    { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
    owner.token,
  );
  room.addBots(1, owner.token);
  room.connect(owner.token);
  room.setReady(owner.token, true);
  const starting = room.start(owner.token);
  assert.equal(room.snapshot().phase, 'starting');
  assert.throws(() => room.updateSettings({}, owner.token), code('ROOM_LOCKED'));
  assert.throws(() => room.addBots(1, owner.token), code('ROOM_LOCKED'));
  assert.throws(() => room.leave(owner.token), code('ROOM_LOCKED'));
  assert.throws(
    () => room.removePlayer(room.snapshot().players[1]!.id, owner.token),
    code('ROOM_LOCKED'),
  );
  await assert.rejects(room.start(owner.token), code('ROOM_LOCKED'));
  rejectStart(new Error('engine disconnected'));
  await assert.rejects(starting, code('ENGINE_START_FAILED'));
  assert.equal(room.snapshot().phase, 'waiting');
});

test('混合席位与固定原生 AI 策略传给引擎，所有真人在线准备才可开局', async () => {
  let received: MatchSetup | undefined;
  const { room, owner } = ownedRoom(
    fakeEngine(async (setup) => {
      received = setup;
    }),
  );
  room.addBots(4, owner.token);
  await assert.rejects(room.start(owner.token), code('PLAYERS_NOT_READY'));
  room.connect(owner.token);
  room.setReady(owner.token, true);
  await room.start(owner.token);
  assert.equal(room.snapshot().phase, 'playing');
  assert.equal(received?.ownerPlayerId, owner.playerId);
  assert.equal(received?.seats.length, 5);
  assert.equal(received?.seats.filter((seat) => seat.kind === 'human').length, 1);
  assert.equal(received?.seats.filter((seat) => seat.kind === 'bot').length, 4);
  assert.equal(received?.aiPolicy, 'strongest-native');
  assert.equal(JSON.stringify(received).includes(owner.token), false);
});

test('经典进阶只授权96个原生ID，加载依赖不会开放整包或神将', async () => {
  const config = JSON.parse(
    await readFile(new URL('../config/roster-presets.json', import.meta.url), 'utf8'),
  );
  const advanced = config.presets.find((preset: { id: string }) => preset.id === 'advanced');
  assert.equal(advanced.name, '经典进阶96将');
  assert.equal(new Set(advanced.characters).size, 96);
  assert.deepEqual(advanced.enabledPacks, ['refresh', 'shenhua', 'sp', 'yijiang']);
  assert.deepEqual(advanced.completePacks, []);
  assert.deepEqual(advanced.packGroups, {});
  assert.deepEqual(advanced.additionalCharacters, []);
  assert.equal(
    advanced.characters.some((id: string) => id.startsWith('shen_')),
    false,
  );
});

test('原生结束后只有房主能回房，释放旧局并重置真人准备，保留席位再次开始', async () => {
  let notify: (event: EngineEvent) => void = () => {};
  let released = '',
    starts = 0;
  const adapter: EngineAdapter = {
    status: () => ({ id: 'noname', ready: true, message: 'test engine' }),
    start: async () => {
      starts++;
    },
    subscribe: (listener) => {
      notify = listener;
      return () => {};
    },
    release: (code) => {
      released = code;
    },
  };
  const { room, owner } = ownedRoom(adapter);
  room.updateSettings(
    { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
    owner.token,
  );
  const friend = room.join('朋友');
  room.connect(owner.token);
  room.connect(friend.token);
  room.setReady(owner.token, true);
  room.setReady(friend.token, true);
  await room.start(owner.token);
  assert.throws(() => room.returnToWaiting(owner.token), code('MATCH_NOT_FINISHED'));
  notify({ type: 'ended', roomCode: room.code });
  assert.equal(room.snapshot().phase, 'finished');
  assert.throws(() => room.returnToWaiting(friend.token), code('OWNER_REQUIRED'));
  room.returnToWaiting(owner.token);
  assert.equal(released, room.code);
  assert.equal(room.snapshot().phase, 'waiting');
  assert.equal(room.snapshot().players.length, 2);
  assert(room.snapshot().players.every((player) => !player.ready));
  room.setReady(owner.token, true);
  room.setReady(friend.token, true);
  await room.start(owner.token);
  assert.equal(starts, 2);
});

test('电脑主页地址与玩家直达房间地址分开，拒绝回环地址和带额外内容的地址', () => {
  assert.deepEqual(findHomeUrls(3000, 'http://192.168.1.100:3000'), ['http://192.168.1.100:3000/']);
  assert.deepEqual(findJoinUrls(3000, 'ABC123', 'http://192.168.1.100:3000'), [
    'http://192.168.1.100:3000/join/ABC123',
  ]);
  for (const address of [
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://0.0.0.0:3000',
    'file:///tmp',
    'http://192.168.1.100/path',
    'http://192.168.1.100?secret=yes',
  ])
    assert.throws(() => findHomeUrls(3000, address));
});

test('启动检查能识别只监听回环的其他程序，结束监听后端口可用', async () => {
  const other = createServer();
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  const address = other.address();
  assert.ok(address && typeof address === 'object');
  try {
    assert.equal(await isLoopbackPortOccupied(address.port), true);
  } finally {
    await new Promise<void>((resolve) => other.close(() => resolve()));
  }
  assert.equal(await isLoopbackPortOccupied(address.port), false);
});
