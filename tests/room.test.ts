import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { EngineAdapter, MatchSetup } from '../packages/noname-adapter/src/index.js';
import { NonameAdapter } from '../packages/noname-adapter/src/index.js';
import { RoomStore } from '../apps/server/src/room.js';
import { LobbyStore } from '../apps/server/src/lobby.js';
import { AppError } from '../apps/server/src/errors.js';
import { findHomeUrls, findJoinUrls, isLoopbackPortOccupied } from '../apps/server/src/network.js';

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

test('进阶档只开放阴、雷分组和指定的 12 神将', async () => {
  const config = JSON.parse(
    await readFile(new URL('../config/roster-presets.json', import.meta.url), 'utf8'),
  );
  const advanced = config.presets.find((preset: { id: string }) => preset.id === 'advanced');
  assert.deepEqual(advanced.completePacks, ['refresh']);
  assert.deepEqual(advanced.packGroups.shenhua, ['shenhua_yin', 'shenhua_lei']);
  assert.equal(new Set(advanced.additionalCharacters).size, 12);
  assert.equal(advanced.completePacks.includes('extra'), false);
  assert.equal(advanced.completePacks.includes('shenhua'), false);
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
