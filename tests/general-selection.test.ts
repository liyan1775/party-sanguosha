import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  GENERAL_PRESETS,
  matchStartTimeout,
  type GeneralPresetId,
} from '../packages/shared/src/contracts.js';

async function fixture(t: TestContext, count = 8, preset: GeneralPresetId = 'beginner') {
  const players = Array.from({ length: count }, (_, index) => ({
    playerid: `seat-${index}`,
    seatNum: index + 1,
    side: index === 0 || index === 3,
  }));
  const pool = Array.from(
    { length: GENERAL_PRESETS.find((entry) => entry.id === preset)!.characterCount },
    (_, index) => `general-${index}`,
  );
  const character = Object.fromEntries(
    pool.map((name, index) => [name, { isZhugong: index < (preset === 'beginner' ? 3 : 6) }]),
  );
  const game = { players, zhu: players[2] };
  const status = { connectMode: true };
  const lib = {
    character,
    sort: { character: (a: string, b: string) => a.localeCompare(b) },
    node: { torespond: {} as Record<string, unknown> },
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'nativeGeneralFixture');
  Object.defineProperty(globalThis, 'nativeGeneralFixture', {
    configurable: true,
    value: {
      game,
      lib,
      get: { translation: (name: string) => name },
      _status: status,
    },
  });
  const randomRemove = Object.getOwnPropertyDescriptor(Array.prototype, 'randomRemove');
  Object.defineProperty(Array.prototype, 'randomRemove', {
    configurable: true,
    value(this: unknown[], count: number) {
      return this.splice(0, count);
    },
  });
  t.after(() => {
    if (before) Object.defineProperty(globalThis, 'nativeGeneralFixture', before);
    else Reflect.deleteProperty(globalThis, 'nativeGeneralFixture');
    if (randomRemove) Object.defineProperty(Array.prototype, 'randomRemove', randomRemove);
    else Reflect.deleteProperty(Array.prototype, 'randomRemove');
  });
  const source = (
    await readFile(new URL('../packages/noname-adapter/runtime/mode.js', import.meta.url), 'utf8')
  )
    .replace(
      "import { lib, game, ui, get, _status } from 'noname';",
      'const { lib, game, get, _status } = globalThis.nativeGeneralFixture;',
    )
    .replace("import { connectRuleHost } from './relay.js';", '')
    .replace(
      "import { broadcastCharacterInit } from './privacy.js';",
      'const broadcastCharacterInit = () => { throw new Error("selection fixture does not initialize native players"); };',
    );
  const runtime = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`
  );
  const setup = {
    settings: { mode: 'identity', generalPreset: preset, allowGeneralSelection: true },
    seats: players.map((player, index) => ({
      id: player.playerid,
      kind: index === count - 1 ? 'bot' : 'human',
    })),
    generalSelections: {} as Record<string, string>,
  };
  return { ...runtime, game, lib, status, players, pool, character, setup };
}

test('2v2 发牌保留 4/4/4/5 并在进入首回合前开启原生先手少摸；其他模式不受影响', async (t) => {
  const f = await fixture(t, 4);
  f.setup.settings.mode = 'versus';
  const first = f.players[0]!;
  Reflect.set(first, 'previousSeat', f.players[3]);
  Reflect.set(f.game, 'gameDraw', async (player: unknown, count: (player: unknown) => number) => {
    assert.equal(player, first);
    assert.equal(Reflect.get(f.status, 'first_less'), true);
    assert.deepEqual(f.players.map(count), [4, 4, 4, 5]);
  });
  assert.equal(await f.initialDraw(f.setup), first);
  Reflect.deleteProperty(f.status, 'first_less');
  f.setup.settings.mode = 'identity';
  Reflect.set(f.game, 'gameDraw', async (player: unknown, count: number) => {
    assert.equal(player, f.game.zhu);
    assert.equal(count, 4);
    assert.equal(Reflect.get(f.status, 'first_less'), undefined);
  });
  assert.equal(await f.initialDraw(f.setup), f.game.zhu);
});

test('2v2 两档各队共享十将，队间不重叠；点将加入本队共同池、本人排首位', async (t) => {
  for (const preset of ['beginner', 'advanced'] as const)
    await t.test(preset, async (t) => {
      const f = await fixture(t, 4, preset);
      f.setup.settings.mode = 'versus';
      f.setup.generalSelections = {
        'seat-0': f.pool.at(-1)!,
        'seat-1': f.pool.at(-2)!,
        'seat-2': f.pool.at(-3)!,
      };
      const batch = f.generalChoices(f.setup, f.pool);
      const offers = batch.map((choice: any[]) => choice[1].createDialog[1][0]);
      assert(offers.every((offer: string[]) => offer.length === 10));
      assert.deepEqual(new Set(offers[0]), new Set(offers[3]));
      assert.deepEqual(new Set(offers[1]), new Set(offers[2]));
      assert.equal(new Set([...offers[0], ...offers[1]]).size, 20);
      for (const [index, player] of f.players.entries()) {
        const preference = f.setup.generalSelections[player.playerid];
        if (preference) assert.equal(offers[index][0], preference);
      }
      assert(offers[1].includes(f.setup.generalSelections['seat-2']));
      assert(offers[2].includes(f.setup.generalSelections['seat-1']));
      assert(!offers[0].includes(f.setup.generalSelections['seat-1']));
      assert.notEqual(
        offers[0],
        offers[3],
        'separate arrays allow a teammate claim without losing the confirmed candidate',
      );
      assert.throws(
        () => f.generalChoices({ ...f.setup, generalSelections: {} }, f.pool.slice(0, 19)),
        /队伍武将候选不足/,
      );
    });
});

test('2v2 仅真正的 AI 队友交给真人选择，两个候选有明确顺序；真人离线仍是自己的选择', async (t) => {
  const f = await fixture(t, 4);
  f.setup.settings.mode = 'versus';
  const batch = f.generalChoices(f.setup, f.pool);
  const plan = f.delegateVersusChoices(f.setup, batch);
  assert.deepEqual([...plan.delegated], [['seat-3', 'seat-0']]);
  assert.deepEqual(
    plan.requested.map(([player]: any[]) => player.playerid),
    ['seat-0', 'seat-1', 'seat-2'],
  );
  assert.equal(batch[0][1].selectButton, 2);
  assert.equal(batch[0][1].partyTeamChoice.aiTeammate, 'seat-3');
  assert(batch.slice(1).every(([, params]: any[]) => params.selectButton === 1));
  const allBots = {
    ...f.setup,
    seats: f.setup.seats.map((seat: any) => ({ ...seat, kind: 'bot' })),
  };
  const botPlan = f.delegateVersusChoices(allBots, f.generalChoices(allBots, f.pool));
  assert.equal(botPlan.requested.length, 4);
  assert.equal(botPlan.delegated.size, 0);
  const allHumans = {
    ...f.setup,
    seats: f.setup.seats.map((seat: any) => ({ ...seat, kind: 'human' })),
  };
  assert.equal(
    f.delegateVersusChoices(allHumans, f.generalChoices(allHumans, f.pool)).delegated.size,
    0,
  );
});

test('2v2 已选点将保留在十将池，只有可选状态改变；同将冲突保留原等待，势力不受影响', async (t) => {
  const f = await fixture(t, 4);
  f.setup.settings.mode = 'versus';
  const deliveries: { to: string; args: any[] }[] = [];
  let tentativeResolutions = 0;
  const originals = f.players.map((player: { playerid: string }, index: number) => {
    Object.assign(player, {
      seatNum: index + 1,
      side: index === 0 || index === 3,
      send: (...args: any[]) => deliveries.push({ to: player.playerid, args }),
      unwait: (result: unknown) => {
        Reflect.deleteProperty(f.lib.node.torespond, player.playerid);
        return result;
      },
      tempUnwait: () => tentativeResolutions++,
      chooseButton: (params: any) => {
        const dialog = params.createDialog ?? params;
        return { forResult: async () => ({ bool: true, links: [dialog[1][0][0]] }) };
      },
    });
    return {
      unwait: Reflect.get(player, 'unwait'),
      tempUnwait: Reflect.get(player, 'tempUnwait'),
      chooseButton: Reflect.get(player, 'chooseButton'),
    };
  });
  f.setup.generalSelections = { 'seat-0': 'general-26' };
  const batch = f.generalChoices(f.setup, f.pool);
  const firstOffer = batch[0][1].createDialog[1][0][0];
  const originalOffers = batch.map(([, params]: any[]) => params.createDialog[1][0].slice());
  const replays: string[] = [];
  const cleanup = f.trackVersusChoices(batch, (player: { playerid: string }) =>
    replays.push(player.playerid),
  );
  assert.match(batch[0][1].createDialog[0], /你是 1 号位，队友是 4 号位/);
  // Unsolicited, declined and invalid results must not disclose anything.
  Reflect.get(f.players[0]!, 'unwait').call(f.players[0], { links: [firstOffer] });
  Reflect.get(f.players[0]!, 'tempUnwait').call(f.players[0], { bool: true, links: [firstOffer] });
  assert.equal(
    tentativeResolutions,
    0,
    'tentative choice cannot resolve a shared-pool wait callback',
  );
  for (const result of [{ bool: false, links: [firstOffer] }, { links: ['outside-roster'] }]) {
    const waiting = Object.assign(() => {}, { _noname_waiting: true });
    f.lib.node.torespond['seat-0'] = waiting;
    Reflect.get(f.players[0]!, 'unwait').call(f.players[0], result);
    assert.equal(
      f.lib.node.torespond['seat-0'],
      waiting,
      'rejected result must not resolve or replace the original wait',
    );
  }
  assert.deepEqual(replays, ['seat-0', 'seat-0']);
  assert.equal(deliveries.length, 0);
  f.lib.node.torespond['seat-0'] = '_noname_waiting';
  Reflect.get(f.players[0]!, 'unwait').call(f.players[0], { bool: true, links: [firstOffer] });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]!.to, 'seat-3');
  assert.equal(
    deliveries[0]!.args.length,
    3,
    'send only a title and confirmed name, never offers or preference maps',
  );
  assert.equal(deliveries[0]!.args[1], batch[3][1].createDialog[0]);
  assert.match(batch[3][1].createDialog[0], new RegExp(`已选${firstOffer}`));
  assert.equal(batch[3][1].partyTeamChoice.taken, firstOffer);
  assert.equal(batch[0][1].partyTeamChoice.preference, firstOffer);
  assert.deepEqual(
    batch.map(([, params]: any[]) => params.createDialog[1][0]),
    originalOffers,
    'both original ten-general pools stay visible, including a claimed preference',
  );
  assert(
    batch[0][1].createDialog[1][0].includes(firstOffer),
    'keep the confirmed choice valid during initialization',
  );
  assert(!batch[1][1].createDialog[0].includes(firstOffer));
  f.lib.node.torespond['seat-3'] = '_noname_waiting';
  Reflect.get(f.players[3]!, 'unwait').call(f.players[3], { bool: true, links: [firstOffer] });
  assert.equal(f.lib.node.torespond['seat-3'], '_noname_waiting');
  assert.equal(replays.at(-1), 'seat-3');
  assert.equal(deliveries.length, 1, 'a duplicate cannot disclose a second confirmation');
  const ai = Reflect.get(f.players[2]!, 'chooseButton').call(f.players[2], batch[2][1]);
  const result = await ai.forResult();
  assert.equal(deliveries[1]!.to, 'seat-1');
  assert.match(deliveries[1]!.args[1], new RegExp(result.links[0]));
  const group = ['请选择你的势力', [[['', '', 'group_wei']], 'vcard']];
  const groupResult = await Reflect.get(f.players[0]!, 'chooseButton')
    .call(f.players[0], group)
    .forResult();
  assert.deepEqual(
    groupResult.links,
    [['', '', 'group_wei']],
    'god-group choice keeps its native result',
  );
  f.lib.node.torespond['seat-0'] = '_noname_waiting';
  Reflect.get(f.players[0]!, 'unwait').call(f.players[0], groupResult);
  assert.equal(f.lib.node.torespond['seat-0'], undefined);
  cleanup();
  for (const [index, player] of f.players.entries()) {
    assert.equal(Reflect.get(player, 'unwait'), originals[index]!.unwait);
    assert.equal(Reflect.get(player, 'tempUnwait'), originals[index]!.tempUnwait);
    assert.equal(Reflect.get(player, 'chooseButton'), originals[index]!.chooseButton);
  }
});

test('2v2 原生 AI 同时选中同将时，从剩余共同池用原生 AI 重选而不请求超时真人', async (t) => {
  const f = await fixture(t, 4);
  f.setup.settings.mode = 'versus';
  const calls: string[] = [];
  for (const player of f.players)
    Object.assign(player, {
      send() {},
      unwait() {},
      chooseButton(params: any) {
        const name = params.createDialog[1][0].find(
          (candidate: string) => candidate !== params.partyTeamChoice.taken,
        );
        calls.push(player.playerid);
        const event = {
          isOnline: () => true,
          forResult: async () => {
            if (calls.filter((id) => id === player.playerid).length > 1)
              assert.equal(event.isOnline(), false);
            return { bool: true, links: [name] };
          },
        };
        return event;
      },
    });
  const batch = f.generalChoices(f.setup, f.pool);
  const cleanup = f.trackVersusChoices(batch);
  t.after(cleanup);
  const first = Reflect.get(f.players[0]!, 'chooseButton').call(f.players[0], ...batch[0].slice(1));
  const fourth = Reflect.get(f.players[3]!, 'chooseButton').call(
    f.players[3],
    ...batch[3].slice(1),
  );
  const a = await first.forResult();
  const b = await fourth.forResult();
  assert.notEqual(a.links[0], b.links[0]);
  assert.equal(calls.filter((id) => id === 'seat-3').length, 2);
});

test('点将排在第一候选、随机填满且不重复，非法档位、AI 点将和重复偏好拒绝', async (t) => {
  const f = await fixture(t, 3);
  f.setup.settings.mode = 'doudizhu';
  f.setup.generalSelections = { 'seat-0': 'general-26', 'seat-1': 'general-1' };
  const choices = f.generalChoices(f.setup, f.pool);
  assert.equal(choices[0][1][1][0][0], 'general-26');
  assert.equal(choices[1][1][1][0][0], 'general-1');
  const offers = choices.flatMap((choice: any[]) => choice[1][1][0]);
  assert.equal(offers.length, 22);
  assert.equal(new Set(offers).size, 22);
  assert.deepEqual(
    choices.map((choice: any[]) => choice[1][1][0].length),
    [6, 6, 10],
  );
  for (const preferences of [
    { 'seat-0': 'other-tier' },
    { 'seat-7': 'general-26' },
    { 'seat-0': 'general-1', 'seat-1': 'general-1' },
  ])
    assert.throws(
      () => f.generalChoices({ ...f.setup, generalSelections: preferences }, f.pool),
      /无效的大厅点将/,
    );
  const disabled = f.generalChoices(
    { ...f.setup, settings: { mode: 'doudizhu', allowGeneralSelection: false } },
    f.pool,
  );
  assert.equal(disabled[0][1][1][0][0], 'general-0');
});

test('斗地主每档地主十名、农民各六名；候选不重叠，主公默认评分不会固定选排序首名', async (t) => {
  for (const preset of GENERAL_PRESETS)
    await t.test(preset.id, async (t) => {
      const f = await fixture(t, 3, preset.id);
      f.setup.settings.mode = 'doudizhu';
      const batch = f.generalChoices(f.setup, f.pool);
      assert.deepEqual(
        batch.map(([, dialog]: any[]) => dialog[1][0].length),
        [6, 6, 10],
      );
      assert.equal(new Set(batch.flatMap(([, dialog]: any[]) => dialog[1][0])).size, 22);
      assert.throws(() => f.generalChoices(f.setup, f.pool.slice(0, 21)), /斗地主武将候选不足/);
      t.mock.method(Math, 'random', () => 0.37);
      for (const choice of batch) assert.equal(choice[4](), 0.37);
      f.setup.settings.mode = 'identity';
      assert.equal(f.generalChoices(f.setup, f.pool, [f.game.zhu])[0][4](), 0.37);
    });
});

test('主公常备将加随机将，点将占随机名额或常备将移到首位，尊重他人保留', async (t) => {
  const f = await fixture(t);
  let offers = f.generalChoices(f.setup, f.pool, [f.game.zhu])[0][1][1][0];
  assert.deepEqual(offers, ['general-0', 'general-1', 'general-2', 'general-3', 'general-4']);
  f.setup.generalSelections = { 'seat-2': 'general-26' };
  offers = f.generalChoices(f.setup, f.pool, [f.game.zhu])[0][1][1][0];
  assert.deepEqual(offers, ['general-26', 'general-0', 'general-1', 'general-2', 'general-3']);
  f.setup.generalSelections = { 'seat-2': 'general-1', 'seat-0': 'general-0' };
  offers = f.generalChoices(f.setup, f.pool, [f.game.zhu])[0][1][1][0];
  assert.deepEqual(offers, ['general-1', 'general-2', 'general-3', 'general-4', 'general-5']);
});

test('新手五至八席身份局，常备主公将全被他人点将时主公候选仍多于其他人', async (t) => {
  for (const count of [5, 6, 7, 8])
    await t.test(`${count} 席`, async (t) => {
      const f = await fixture(t, count);
      f.setup.generalSelections = {
        'seat-0': 'general-0',
        'seat-1': 'general-1',
        'seat-3': 'general-2',
      };
      const lordOffers = f.generalChoices(f.setup, f.pool, [f.game.zhu])[0][1][1][0];
      assert.equal(lordOffers.length, 5);
      assert(
        lordOffers.every(
          (name: string) => !Object.values(f.setup.generalSelections).includes(name),
        ),
      );
      const others = f.generalChoices(
        f.setup,
        f.pool.filter((name: string) => name !== lordOffers[0]),
        f.players.filter((player: { playerid: string }) => player !== f.game.zhu),
      );
      for (const [player, [, [offers]]] of others) {
        assert.equal(offers.length, 3);
        assert(lordOffers.length > offers.length, 'lord offers remain greater after reservations');
        const preference = f.setup.generalSelections[player.playerid];
        if (preference) assert.equal(offers[0], preference);
      }
      const offers = others.flatMap((choice: any[]) => choice[1][1][0]);
      assert.equal(new Set(offers).size, offers.length);
      assert(!offers.includes(lordOffers[0]));
    });
});

test('进阶身份主公十名含六名常备将、其余六名，主公点将始终占位且首选不丢', async (t) => {
  const f = await fixture(t, 8, 'advanced');
  for (const preference of [null, 'general-5', 'general-47']) {
    f.setup.generalSelections = preference ? { 'seat-2': preference } : {};
    const offers = f.generalChoices(f.setup, f.pool, [f.game.zhu])[0][1][1][0];
    assert.equal(offers.length, 10);
    assert.equal(offers.filter((name: string) => f.character[name].isZhugong).length, 6);
    assert.equal(new Set(offers).size, 10);
    if (preference) assert.equal(offers[0], preference);
  }
  f.setup.generalSelections = {};
  const others = f.generalChoices(
    f.setup,
    f.pool.filter((name: string) => name !== 'general-0'),
    f.players.filter((player: { playerid: string }) => player !== f.game.zhu),
  );
  assert(others.every((choice: any[]) => choice[1][1][0].length === 6));
  const offers = others.flatMap((choice: any[]) => choice[1][1][0]);
  assert.equal(new Set(offers).size, 42);
  f.setup.generalSelections = {
    'seat-0': 'general-0',
    'seat-1': 'general-1',
    'seat-3': 'general-2',
    'seat-4': 'general-3',
    'seat-5': 'general-4',
    'seat-6': 'general-5',
    'seat-2': 'general-47',
  };
  const supplemented = f.generalChoices(f.setup, f.pool, [f.game.zhu])[0][1][1][0];
  assert.equal(supplemented.length, 10);
  assert.equal(supplemented[0], 'general-47');
  assert(supplemented.every((name: string) => !f.character[name]!.isZhugong));
  assert.equal(new Set(supplemented).size, 10);
});

test('身份局先展示主公才发其余候选，未选主公候选可再分配，超时仍走原生 AI', async (t) => {
  const f = await fixture(t);
  const initialized: string[] = [];
  const batches: string[][] = [];
  const allOffers: string[][] = [];
  Reflect.set(f.players[0]!, 'chooseButtonOL', (batch: any[][]) => ({
    forResult: async () => {
      if (batches.length) assert.deepEqual(initialized, ['general-0']);
      batches.push(batch.map(([player]) => player.playerid));
      allOffers.push(...batch.map((choice) => choice[1][1][0]));
      return Object.fromEntries(
        batch.map(([player, dialog]) => [
          player.playerid,
          player === f.game.zhu ? { links: [dialog[1][0][0]] } : 'ai',
        ]),
      );
    },
  }));
  for (const player of f.players)
    Reflect.set(player, 'chooseButton', (dialog: any[]) => {
      const event = {
        isOnline: () => true,
        forResult: async () => {
          assert.equal(event.isOnline(), false, 'expired reconnect cannot reopen the request');
          return { links: [dialog[1][0][0]] };
        },
      };
      return event;
    });
  await f.selectGenerals(f.setup, f.pool, async (_player: unknown, name: string) => {
    initialized.push(name);
  });
  assert.deepEqual(batches[0], ['seat-2']);
  assert.equal(batches[1]!.length, 7);
  assert(allOffers.slice(1).flat().includes('general-1'), 'unused lord candidates return');
  assert.equal(new Set(initialized).size, 8);
});

test('选将启动上限容纳两段身份选择、八个神将势力与30秒手气卡期限', () => {
  const settings = {
    mode: 'identity' as const,
    playerCount: 8,
    generalPreset: 'advanced' as const,
    allowGeneralSelection: true,
    extensions: [],
  };
  assert.equal(matchStartTimeout(settings, 8), 800000);
  assert.equal(matchStartTimeout({ ...settings, generalPreset: 'beginner' }, 8), 280000);
});

test('官方将池沿用身份主公10将/其他6将及神将期限，候选互不重复', async (t) => {
  for (const preset of GENERAL_PRESETS.filter((entry) => entry.official))
    await t.test(preset.id, async (t) => {
      const f = await fixture(t, 8, preset.id);
      const lord = f.generalChoices(f.setup, f.pool, [f.game.zhu])[0][1][1][0];
      assert.equal(lord.length, 10);
      const otherPlayers = f.players.filter(
        (player: { playerid: string }) => player !== f.game.zhu,
      );
      const choices = f.generalChoices(
        f.setup,
        f.pool.filter((name: string) => name !== lord[0]),
        otherPlayers,
      );
      const offers = choices.map((choice: any[]) => choice[1][1][0]);
      assert(offers.every((offer: string[]) => offer.length === 6));
      assert.equal(new Set(offers.flat()).size, 42);
      assert.equal(
        matchStartTimeout(
          { ...f.setup.settings, mode: 'identity', playerCount: 8, extensions: [] },
          8,
        ),
        800000,
      );
    });
});
