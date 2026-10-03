import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { EngineAdapter, MatchSetup } from '../packages/noname-adapter/src/index.js';
import { NonameAdapter } from '../packages/noname-adapter/src/index.js';
import { RoomStore } from '../apps/server/src/room.js';
import { AppError } from '../apps/server/src/errors.js';
import { findJoinUrls } from '../apps/server/src/network.js';

function fakeEngine(start: (setup: MatchSetup) => Promise<void> = async () => {}): EngineAdapter {
  return { status: () => ({ id: 'noname', ready: true, message: 'test engine' }), start };
}

test('身份局限制 5–8 人，其余模式固定人数，禁止未知武将档', () => {
  const room = new RoomStore(fakeEngine());
  for (const [mode, playerCount] of [
    ['identity', 8],
    ['doudizhu', 3],
    ['versus', 4],
    ['duel', 2],
  ] as const) {
    room.updateSettings({ mode, playerCount, generalPreset: 'beginner', extensions: [] });
    assert.equal(room.snapshot().settings.playerCount, playerCount);
  }
  for (const [mode, playerCount] of [
    ['identity', 4],
    ['identity', 9],
    ['doudizhu', 4],
    ['versus', 2],
    ['duel', 3],
  ] as const) {
    assert.throws(
      () => room.updateSettings({ mode, playerCount, generalPreset: 'beginner', extensions: [] }),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_MODE',
    );
  }
  assert.throws(() =>
    room.updateSettings({ mode: 'duel', playerCount: 2, generalPreset: 'all', extensions: [] }),
  );
});

test('刷新重进使用同一会话，房间满员仍能恢复自己的座位，公开数据不含 token', () => {
  const room = new RoomStore(fakeEngine());
  room.updateSettings({ mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] });
  const first = room.join(room.code, '赵云');
  room.join(room.code, '关羽');
  assert.equal(room.join(room.code, '赵云重进', first.token).playerId, first.playerId);
  assert.equal(room.snapshot().players.length, 2);
  assert.throws(
    () => room.join(room.code, '张飞'),
    (error: unknown) => error instanceof AppError && error.code === 'ROOM_FULL',
  );
  assert.equal(JSON.stringify(room.snapshot()).includes(first.token), false);
  assert.throws(
    () => room.join('OLD123', '张飞'),
    (error: unknown) => error instanceof AppError && error.code === 'ROOM_NOT_FOUND',
  );
});

test('电脑主控不占玩家席位，多标签不会因关闭其中一个就变成离线', () => {
  const room = new RoomStore(fakeEngine());
  const disconnectHost = room.connect(undefined, true);
  assert.equal(room.snapshot().players.length, 0);
  assert.equal(room.snapshot().hostOnline, true);
  const player = room.join(room.code, '小乔');
  const disconnectA = room.connect(player.token);
  const disconnectB = room.connect(player.token);
  room.setReady(player.token, true);
  disconnectA();
  disconnectA();
  assert.equal(room.session(player.token)?.online, true);
  disconnectB();
  assert.equal(room.session(player.token)?.online, false);
  assert.equal(room.session(player.token)?.ready, false);
  disconnectHost();
  assert.equal(room.snapshot().hostOnline, false);
});

test('修改武将范围撤销准备，切换为小房间前必须移出多余玩家', () => {
  const room = new RoomStore(fakeEngine());
  const players = ['赵云', '关羽', '张飞'].map((name) => room.join(room.code, name));
  players.forEach((player) => {
    room.connect(player.token);
    room.setReady(player.token, true);
  });
  room.updateSettings({
    mode: 'identity',
    playerCount: 5,
    generalPreset: 'advanced',
    extensions: [],
  });
  assert.equal(
    room.snapshot().players.some((player) => player.ready),
    false,
  );
  assert.throws(
    () =>
      room.updateSettings({
        mode: 'duel',
        playerCount: 2,
        generalPreset: 'advanced',
        extensions: [],
      }),
    (error: unknown) => error instanceof AppError && error.code === 'TOO_MANY_PLAYERS',
  );
  room.removePlayer(players[2]!.playerId);
  room.updateSettings({ mode: 'duel', playerCount: 2, generalPreset: 'advanced', extensions: [] });
  assert.equal(room.snapshot().settings.mode, 'duel');
});

test('真实适配器未接入时必须拒绝开局，不能假装进入游戏', async () => {
  const room = new RoomStore(new NonameAdapter());
  await assert.rejects(
    room.start(),
    (error: unknown) => error instanceof AppError && error.code === 'ENGINE_NOT_READY',
  );
  assert.equal(room.snapshot().phase, 'waiting');
});

test('开局等待引擎确认、禁止并发和配置修改，失败时恢复房间', async () => {
  let rejectStart: (error: Error) => void = () => {};
  const room = new RoomStore(
    fakeEngine(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectStart = reject;
        }),
    ),
  );
  room.updateSettings({ mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] });
  room.connect(undefined, true);
  for (const name of ['赵云', '关羽']) {
    const player = room.join(room.code, name);
    room.connect(player.token);
    room.setReady(player.token, true);
  }
  const starting = room.start();
  assert.equal(room.snapshot().phase, 'starting');
  assert.throws(() =>
    room.updateSettings({
      mode: 'duel',
      playerCount: 2,
      generalPreset: 'advanced',
      extensions: [],
    }),
  );
  await assert.rejects(
    room.start(),
    (error: unknown) => error instanceof AppError && error.code === 'ROOM_LOCKED',
  );
  rejectStart(new Error('engine disconnected'));
  await assert.rejects(
    starting,
    (error: unknown) => error instanceof AppError && error.code === 'ENGINE_START_FAILED',
  );
  assert.equal(room.snapshot().phase, 'waiting');
});

test('人数、准备和电脑主控均满足后才将确认的对局设为 playing', async () => {
  let received: MatchSetup | undefined;
  const room = new RoomStore(
    fakeEngine(async (setup) => {
      received = setup;
    }),
  );
  room.updateSettings({ mode: 'duel', playerCount: 2, generalPreset: 'advanced', extensions: [] });
  await assert.rejects(
    room.start(),
    (error: unknown) => error instanceof AppError && error.code === 'HOST_OFFLINE',
  );
  room.connect(undefined, true);
  await assert.rejects(
    room.start(),
    (error: unknown) => error instanceof AppError && error.code === 'PLAYERS_NOT_READY',
  );
  for (const name of ['赵云', '关羽']) {
    const player = room.join(room.code, name);
    room.connect(player.token);
    room.setReady(player.token, true);
  }
  await room.start();
  assert.equal(room.snapshot().phase, 'playing');
  assert.equal(received?.settings.generalPreset, 'advanced');
  assert.equal(received?.playerIds.length, 2);
});

test('进阶档只开放阴、雷分组和指定的 12 神将，避免误启用整个包', async () => {
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

test('显式邀请地址包含房号，拒绝手机无法访问的回环地址', () => {
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
    assert.throws(() => findJoinUrls(3000, 'ABC123', address));
});
