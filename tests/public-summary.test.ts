import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sanitizeObserver } from '../packages/noname-adapter/src/observer.js';
import type { MatchSetup } from '../packages/noname-adapter/src/index.js';

async function runtime(native: unknown = {}) {
  const source = (
    await readFile(
      new URL('../packages/noname-adapter/runtime/public-summary.js', import.meta.url),
      'utf8',
    )
  ).replace(
    "import { lib, game } from 'noname';",
    'const {lib, game} = globalThis.summaryFixture;',
  );
  Object.assign(globalThis, { summaryFixture: native });
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`
  );
}

test('身份余量只按公开阵亡扣减，五至八人开局构成正确，活人隐藏身份不会影响输出', async () => {
  const { remainingIdentities } = await runtime();
  for (const [seats, initial] of [
    [5, [1, 1, 2, 1]],
    [6, [1, 1, 3, 1]],
    [7, [1, 2, 3, 1]],
    [8, [1, 2, 4, 1]],
  ] as const) {
    assert.deepEqual(Object.values(remainingIdentities('identity', seats, [])), initial);
    const players = [
      { identity: '反贼', dead: true },
      { identity: '内奸', dead: false },
      { identity: '身份未公开', dead: false },
    ];
    const counts = remainingIdentities('identity', seats, players);
    assert.equal(counts.fan, initial[2] - 1);
    assert.equal(counts.nei, 1);
    players[1]!.identity = '主公';
    assert.deepEqual(remainingIdentities('identity', seats, players), counts);
  }
  assert.equal(remainingIdentities('doudizhu', 3, []), null);
});

test('公开摘要维持三条动作、同序号去重和刷新恢复，不能发给未绑定原席位', async (t) => {
  const sent: unknown[] = [];
  const player: any = { send: (_display: unknown, summary: unknown) => sent.push(summary) };
  const native: any = {
    lib: { playerOL: { actor: player }, message: { server: { reinited() {} } } },
    game: { broadcast: (_display: unknown, summary: unknown) => sent.push(summary) },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'partyEngine');
  const engine: any = {
    setup: { role: 'worker', settings: { mode: 'identity' }, seats: Array(8) },
  };
  Object.defineProperty(globalThis, 'partyEngine', { value: engine, configurable: true });
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'summaryFixture');
    if (previous) Object.defineProperty(globalThis, 'partyEngine', previous);
    else Reflect.deleteProperty(globalThis, 'partyEngine');
  });
  (await runtime(native)).installPublicSummary();
  const state = {
    players: [],
    deckCount: 73,
    recent: [
      '甲使用了杀',
      '乙进入摸牌阶段',
      '乙打出了闪',
      '甲发动了技能',
      '丙弃置了桃',
      '丁进入了判定阶段',
    ],
    logStart: 1,
  };
  engine.publishPublicSummary(state);
  const summary: any = sent[0];
  assert.deepEqual(
    summary.actions.map((entry: any) => entry.sequence),
    [3, 4, 5],
  );
  assert.deepEqual(summary.identityCounts, { zhu: 1, zhong: 2, fan: 4, nei: 1 });
  engine.publishPublicSummary(state);
  assert.equal(sent.length, 1);
  const client = { id: 'actor' };
  native.lib.message.server.reinited.call(client);
  assert.equal(sent.length, 1);
  player.ws = client;
  native.lib.message.server.reinited.call(client);
  assert.deepEqual(sent[1], summary);
});

test('观察者身份数字白名单不透传额外字段，非法数字拒绝，其他模式不接收身份分布', () => {
  const setup: MatchSetup = {
    roomCode: 'ABC123',
    ownerPlayerId: 'a',
    seats: [{ id: 'a', nickname: '甲', kind: 'human' }],
    settings: {
      mode: 'identity',
      playerCount: 8,
      generalPreset: 'advanced',
      extensions: [],
      allowGeneralSelection: false,
    },
    aiPolicy: 'strongest-native',
  };
  const input: any = {
    players: [],
    recent: [],
    identityCounts: { zhu: 1, zhong: 2, fan: 4, nei: 1, hidden: 'SECRET' },
  };
  assert(!JSON.stringify(sanitizeObserver(input, setup)).includes('SECRET'));
  input.identityCounts.fan = 99;
  assert.equal(sanitizeObserver(input, setup)!.identityCounts, undefined);
  input.identityCounts.fan = 4;
  setup.settings.mode = 'duel';
  assert.equal(sanitizeObserver(input, setup)!.identityCounts, undefined);
});
