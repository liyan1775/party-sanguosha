// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import source from '../config/shanhetu-scenario.json' with { type: 'json' };
import companions from '../config/shanhetu-companions.json' with { type: 'json' };
import { createShanhetuScenario } from '../apps/server/src/shanhetu-scenario.js';
import { ShanhetuCampaign } from '../apps/server/src/shanhetu-campaign.js';
import { shanhetuRecipe } from '../packages/noname-adapter/src/shanhetu.js';
import type { ShanhetuBattleSetup } from '../packages/noname-adapter/src/shanhetu.js';

test('普通1地图目录按原城池绑定内容及坐标，不跨城补敌或把高难分路开放', () => {
  const catalog = createShanhetuScenario([
    'caocao',
    'guanyu',
    'zhangfei',
    'zhaoyun',
    'machao',
    'liubei',
  ]);
  assert.equal(catalog.candidates.length, 5);
  assert.equal(new Set(catalog.candidates).size, 5);
  assert(
    catalog.candidates.every((id) => catalog.heroChoices!.some((hero) => hero.general === id)),
  );
  assert(['region-2', 'region-4'].includes(catalog.initialRegion!));
  const admitted = source.regions.filter((region) => region.openDifficulty === 1);
  assert.deepEqual(
    catalog.regions!.map((region) => region.id),
    ['region-1', 'region-2', 'region-4', 'region-5', 'region-8', 'region-10'],
  );
  for (const region of catalog.regions!) {
    const original = source.regions.find((item) => `region-${item.id}` === region.id)!;
    assert.equal(region.bossAt, [4, 6, 7][region.chapter - 1]);
    assert.deepEqual(
      region.next,
      original.next
        .filter((id) => admitted.some((target) => target.id === id))
        .map((id) => `region-${id}`),
    );
    const recruitment = original.locations[source.localSampling.recruitmentIndex]!;
    const encounter = catalog.nodes.find((node) => node.id === `city-${recruitment.id}`)!;
    const event = companions.events.find(
      (event) =>
        event.poolIds.some((id) => id === recruitment.poolId) &&
        encounter.choices?.[0]?.id === `option-${event.options[0]!.id}`,
    );
    assert(event, `${region.name} must offer a source-bound recruitment event`);
    assert.deepEqual(
      encounter.choices?.map((option) => option.cost),
      [0, 400, 0],
    );
    for (const id of region.nodes) {
      const node = catalog.nodes.find((node) => node.id === id)!;
      if (node.kind === 'boss') assert(original.bossIds.some((id) => id === node.battleId));
      if (node.kind === 'battle') assert(original.battleIds.includes(node.battleId!));
      if (node.kind !== 'shop') {
        const city = original.locations.find((city) => `city-${city.id}` === id)!;
        assert.deepEqual(node.position, { x: city.x, y: city.y });
      }
    }
  }
  const campaign = new ShanhetuCampaign(catalog);
  const opening = campaign.view();
  campaign.act({ runId: opening.id, revision: opening.revision, actionId: opening.actions[0]!.id });
  assert.deepEqual(
    campaign.view().map?.regions,
    admitted.map((region) => ({
      id: `region-${region.id}`,
      name: region.name,
      chapter: region.chapter,
      next: region.next
        .filter((id) => admitted.some((target) => target.id === id))
        .map((id) => `region-${id}`),
      completed: false,
    })),
  );
  assert.throws(() => createShanhetuScenario(['caocao', 'unreviewed']));
});

test('普通2在相同城市使用原表常规配方，难度只增量应用至敌军', () => {
  const catalog = createShanhetuScenario(['caocao'], undefined, 2);
  const campaign = new ShanhetuCampaign(catalog);
  assert.equal(campaign.view().difficulty, 2);
  for (const region of catalog.regions!) {
    const original = source.regions.find((item) => `region-${item.id}` === region.id)!;
    for (const node of catalog.nodes.filter((node) => region.nodes.includes(node.id))) {
      if (node.kind === 'boss') assert(original.regularBossIds.includes(node.battleId!));
      if (node.kind === 'battle') assert(original.regularBattleIds.includes(node.battleId!));
      if (node.battleId) {
        const base = shanhetuRecipe(node.battleId);
        assert.deepEqual(
          shanhetuRecipe(node.battleId, 2).enemies,
          base.enemies.map((enemy) => ({
            ...enemy,
            hp: enemy.hp + 1,
            maxHp: enemy.maxHp + 1,
            startingCards: enemy.startingCards + 1,
          })),
        );
      }
    }
  }
  const act = () => {
    const view = campaign.view();
    return campaign.act({ runId: view.id, revision: view.revision, actionId: view.actions[0]!.id });
  };
  act();
  const ticket = act().battle!;
  assert.equal(ticket.difficulty, 2);
  assert.deepEqual(ticket.hero, { general: 'caocao', group: 'wei', hp: 4, maxHp: 4 });
  assert.throws(() => campaign.bindMatch({ ...ticket, difficulty: 1 }, 'wrong-rules'));
  assert.throws(() => createShanhetuScenario(['caocao'], undefined, 21));
});

test('困难档开启四座原版城池，全场地形与月份按战斗票据冻结', () => {
  for (const difficulty of [10, 11, 12, 13, 14, 15]) {
    const catalog = createShanhetuScenario(['caocao'], undefined, difficulty);
    assert.equal(catalog.regions!.length, difficulty === 10 ? 8 : 12);
    assert.deepEqual(
      [...new Set(catalog.regions!.flatMap((region) => region.terrain?.id ?? []))].sort(),
      difficulty === 10 ? [] : [13273, 13274, 13275, 13276, 13277, 13278],
    );
    if (difficulty === 10) continue;
    for (const [id, next, terrain] of [
      [7, [12], 13275],
      [11, [], 13275],
      [12, [], 13278],
      [13, [11, 12], 13277],
    ] as const) {
      const region = catalog.regions!.find((region) => region.id === `region-${id}`)!;
      const raw = source.regions.find((region) => region.id === id)!;
      assert.deepEqual(
        region.next,
        next.map((id) => `region-${id}`),
      );
      assert.equal(region.terrain?.id, terrain);
      for (const node of catalog.nodes.filter((node) => region.nodes.includes(node.id))) {
        if (node.kind === 'boss') assert(raw.hardBossIds.includes(node.battleId!));
        if (node.kind === 'battle') assert(raw.hardBattleIds.includes(node.battleId!));
      }
    }
  }
  const catalog = createShanhetuScenario(['caocao'], undefined, 11);
  catalog.initialRegion = 'region-2';
  const campaign = new ShanhetuCampaign(catalog);
  const act = (label?: string) => {
    const view = campaign.view();
    const action =
      view.actions.find((action) => action.label === label) ??
      view.actions.find((action) => action.label === '离开集市') ??
      view.actions[0]!;
    return campaign.act({ runId: view.id, revision: view.revision, actionId: action.id });
  };
  act();
  for (let count = 0; count < 60 && campaign.view().map?.regionId !== 'region-12'; count++) {
    const next = campaign.view().chapter === 1 ? '前往颍川郡' : '前往酸枣';
    const { battle } = act(next);
    if (!battle) continue;
    const matchId = `fixture-${count}`;
    campaign.bindMatch(battle, matchId);
    assert(
      campaign.settle(matchId, {
        runId: battle.runId,
        nodeId: battle.nodeId,
        battleId: battle.battleId,
        outcome: 'victory',
        hero: battle.hero!,
        defeatedEnemies: shanhetuRecipe(battle.battleId, 11).enemies.length,
      }),
    );
  }
  assert.equal(campaign.view().map?.terrain?.id, 13278);
  const { battle } = act();
  assert.equal(battle?.chapter, 3);
  assert.equal(battle?.terrainId, 13278);
  assert.throws(() => campaign.bindMatch({ ...battle!, terrainId: 13275 }, 'wrong-terrain'));
  assert.throws(() => campaign.bindMatch({ ...battle!, chapter: 2 }, 'wrong-chapter'));
  campaign.bindMatch(battle!, 'official-terrain');
});

test('困难额外起始牌、源技能替换、二阶段装备及第三章护甲回复各自生效', () => {
  const enemies = shanhetuRecipe(2659, 11, 0, 2).enemies;
  assert.deepEqual(
    enemies.map((enemy) => enemy.fixedHand?.map((card) => card.id)),
    [[20811], [20812]],
  );
  assert(enemies.every((enemy) => enemy.startingCards === 5 && enemy.extraSha === 1));
  assert.deepEqual(shanhetuRecipe(2647, 11).enemies[0]!.sourceSkills, [3159, 877]);
  const stage = shanhetuRecipe(2644, 14).enemies[0]!.nextForm!;
  assert.deepEqual(
    stage.fixedEquipment?.map((card) => card.id),
    [20611, 20616, 20621],
  );
  assert(stage.sourceSkills.includes(14130));
  const hard = shanhetuRecipe(2676, 15, 0, 3).enemies[0]!;
  assert.deepEqual(
    [hard.hp, hard.startingCards, hard.draw, hard.extraSha, hard.armor, hard.armorRecovery],
    [6, 9, 6, 2, 3, 1],
  );
  assert.equal(shanhetuRecipe(2676, 15, 0, 2).enemies[0]!.armorRecovery, undefined);
  assert(
    shanhetuRecipe(2655, 11).enemies.some((enemy) =>
      enemy.fixedEquipment?.some((card) => card.id === 20876),
    ),
  );
  const zhangYan = shanhetuRecipe(2653, 16).enemies[0]!.nextForm!;
  assert(zhangYan.skills.includes('party_shanhetu_nm_3382'));
  assert(zhangYan.fixedEquipment?.some((card) => card.id === 20777));
});

test('中等档开启两条原表分路，敌军应用月份、人数及武将的中等配置', () => {
  for (const difficulty of [6, 7, 8, 9, 10]) {
    const catalog = createShanhetuScenario(['caocao'], undefined, difficulty);
    for (const [from, to, firstBoss] of [
      [2, 6, 2652],
      [4, 9, 2664],
    ] as const) {
      const entrance = catalog.regions!.find((region) => region.id === `region-${from}`)!;
      assert(entrance.next.includes(`region-${to}`));
      const branch = catalog.regions!.find((region) => region.id === `region-${to}`)!;
      assert.deepEqual(branch.next, ['region-10']);
      const boss = catalog.nodes.find((node) => node.id === branch.boss)!;
      assert(boss.battleId! >= firstBoss && boss.battleId! <= firstBoss + 3);
      assert.equal(boss.victoryRecovery, 0);
    }
  }
  const niujiao = shanhetuRecipe(2653, 6, 10).enemies[0]!;
  assert.deepEqual([niujiao.hp, niujiao.maxHp, niujiao.draw, niujiao.startingCards], [5, 5, 4, 7]);
  assert.deepEqual(niujiao.sourceSkills, [3231]);
  assert.deepEqual(niujiao.nextForm?.sourceSkills, [3292, 14039]);
  const army = shanhetuRecipe(2654, 6, 10).enemies;
  assert.deepEqual(
    army.map(({ hp, startingCards, draw }) => [hp, startingCards, draw]),
    [
      [4, 5, 3],
      [5, 5, 3],
      [4, 5, 3],
    ],
  );
  assert.deepEqual(
    shanhetuRecipe(2644, 6).enemies[0]?.nextForm?.fixedEquipment?.map((card) => card.id),
    [20611, 20616],
  );
  assert.equal(shanhetuRecipe(2664, 6, 10).enemies[0]?.hp, 9);
  assert.equal(shanhetuRecipe(2664, 6, 4).enemies[0]?.hp, 8);
});

test('战后回复、跨战体力与经过月份在原生结算和重开票据中一致', () => {
  for (const difficulty of [1, 6]) {
    const { regions, initialRegion, ...catalog } = createShanhetuScenario(
      ['caocao'],
      undefined,
      difficulty,
    );
    const region = regions!.find((region) => region.id === initialRegion)!;
    const nodes = catalog.nodes.filter((node) => region.nodes.includes(node.id));
    const first = nodes.find((node) => node.kind === 'battle')!;
    const boss = nodes.find((node) => node.kind === 'boss')!;
    const campaign = new ShanhetuCampaign({
      ...catalog,
      entries: [first.id],
      nodes: [
        { ...first, duration: 4, rewardGroups: [], next: [boss.id] },
        { ...boss, rewardGroups: [], next: [] },
      ],
    });
    const advance = () => {
      const { id, revision, actions } = campaign.view();
      return campaign.act({ runId: id, revision, actionId: actions[0]!.id }).battle;
    };
    const settle = (battle: ShanhetuBattleSetup, matchId: string) => {
      campaign.bindMatch(battle, matchId);
      assert(
        campaign.settle(matchId, {
          runId: battle.runId,
          nodeId: battle.nodeId,
          battleId: battle.battleId,
          hero: { ...battle.hero!, hp: 1 },
          outcome: 'victory',
          defeatedEnemies: shanhetuRecipe(battle.battleId).enemies.length,
        }),
      );
    };
    advance();
    const opening = advance()!;
    assert.equal(opening.elapsedMonths, 0);
    settle(opening, 'opening');
    assert.equal(campaign.view().lastBattle?.recoveredHp, difficulty === 1 ? 1 : undefined);
    const closing = advance()!;
    assert.equal(closing.hero?.hp, difficulty === 1 ? 2 : 1);
    assert.equal(closing.elapsedMonths, 4);
    campaign.bindMatch(closing, 'old-closing');
    const restart = campaign.restart('old-closing');
    assert.equal(restart.elapsedMonths, 4);
    assert.deepEqual(restart.hero, closing.hero);
    settle(restart, 'closing');
    assert.equal(campaign.view().hero?.hp, difficulty === 1 ? 3 : 1);
  }
});

test('普通3到5解封四个源首领的第二形态，基础与第二形态分别叠加原难度数值', () => {
  for (const [id, nextId, baseHp, stageHp] of [
    [2644, 264401, 5, 5],
    [2645, 264501, 4, 3],
    [2670, 267001, 4, 5],
    [2671, 267101, 4, 5],
  ] as const) {
    for (const difficulty of [1, 2])
      assert.equal(shanhetuRecipe(id, difficulty).enemies[0]?.nextForm, undefined);
    for (const [difficulty, hp, cards, draw] of [
      [3, 1, 6, 2],
      [4, 1, 6, 3],
      [5, 2, 7, 4],
    ] as const) {
      const enemy = shanhetuRecipe(id, difficulty).enemies[0]!;
      const stage = enemy.nextForm!;
      assert.equal(stage.sourceGroupId, nextId);
      for (const [form, base] of [
        [enemy, baseHp],
        [stage, stageHp],
      ] as const) {
        assert.deepEqual(
          [form.hp, form.maxHp, form.startingCards, form.draw, form.extraSha],
          [base + hp, base + hp, cards, draw, 1],
        );
      }
    }
  }
});

// Authoritative progression fixtures: these results are not native win evidence.
test('广成／虎牢三条普通1路线都走完4／6／7门槛、选路、营地、奇遇、集市和三首领', () => {
  for (const path of [
    [2, 1, 10],
    [4, 5, 10],
    [4, 8, 10],
  ]) {
    const catalog = createShanhetuScenario(['caocao']);
    catalog.initialRegion = `region-${path[0]}`;
    const campaign = new ShanhetuCampaign(catalog);
    let battles = 0,
      bosses = 0;
    const visitedKinds = new Set<string>();
    const act = (id: string) => {
      const view = campaign.view();
      return campaign.act({ runId: view.id, revision: view.revision, actionId: id });
    };
    const settle = (battle: ShanhetuBattleSetup) => {
      assert.deepEqual(battle.companionIds ?? [], campaign.view().companions);
      const matchId = `native-fixture-${battles++}`;
      campaign.bindMatch(battle, matchId);
      assert(
        campaign.settle(matchId, {
          runId: battle.runId,
          nodeId: battle.nodeId,
          battleId: battle.battleId,
          outcome: 'victory',
          hero: battle.hero!,
          defeatedEnemies: shanhetuRecipe(battle.battleId).enemies.length,
        }),
      );
    };
    assert.equal(campaign.view().phase, 'selection');
    act(campaign.view().actions[0]!.id);
    assert.equal(campaign.view().hero?.general, 'caocao');
    for (const [index, regionId] of path.entries()) {
      assert.equal(campaign.view().map?.regionId, `region-${regionId}`);
      assert.equal(campaign.view().days, 0);
      let campDone = false,
        eventDone = false,
        recruitDone = false,
        shopDone = false,
        cleared = false;
      const recruitment = source.regions.find((region) => region.id === regionId)!.locations[
        source.localSampling.recruitmentIndex
      ]!;
      for (let step = 0; step < 40 && !cleared; step++) {
        const view = campaign.view();
        if (view.phase === 'reward') {
          const reward =
            view.actions.find((action) => action.label !== '放弃本次奖励') ?? view.actions[0]!;
          act(reward.id);
          continue;
        }
        assert.equal(view.phase, 'map');
        const available = view.map!.locations.filter((location) => location.status === 'available');
        assert(available.length > 0);
        const boss = available.find((location) => location.kind === 'boss');
        if (view.days < view.map!.bossAt) assert.equal(boss, undefined);
        else assert.equal(available.length, 1, 'Reached threshold exposes only the boss');
        const selected =
          boss ??
          (!campDone ? available.find((location) => location.kind === 'camp') : undefined) ??
          (!recruitDone
            ? available.find((location) => location.id === `city-${recruitment.id}`)
            : undefined) ??
          (!eventDone ? available.find((location) => location.kind === 'event') : undefined) ??
          (!shopDone ? available.find((location) => location.kind === 'shop') : undefined) ??
          available[0]!;
        visitedKinds.add(selected.kind);
        const entered = act(selected.actionId!);
        if (entered.battle) {
          settle(entered.battle);
          if (selected.kind === 'boss') {
            bosses++;
            cleared = true;
          }
        } else if (selected.kind === 'camp') {
          campDone = true;
          act(campaign.view().actions[0]!.id);
        } else if (selected.kind === 'event') {
          if (selected.id === `city-${recruitment.id}`) {
            recruitDone = true;
            const offer = campaign.view();
            const elite = offer.actions.find((action) => action.cost === 400)!;
            if (elite.cost > offer.coins) {
              assert.throws(() => act(elite.id), /铜币不足/);
              assert.deepEqual(campaign.view(), offer);
            }
            const action = elite.cost <= offer.coins ? elite : offer.actions[0]!;
            const input = { runId: offer.id, revision: offer.revision, actionId: action.id };
            campaign.act(input);
            assert.equal(campaign.view().coins, offer.coins - action.cost);
            assert.equal(campaign.view().companions.length, index + 1);
            assert(campaign.act(input).duplicate);
            assert.equal(campaign.view().coins, offer.coins - action.cost);
            continue;
          }
          eventDone = true;
          const money = campaign
            .view()
            .actions.find((action) => /^获得\d+铜币$/.test(action.description))!;
          assert(money);
          act(money.id);
        } else if (selected.kind === 'shop') {
          shopDone = true;
          act(campaign.view().actions.find((action) => action.label === '离开集市')!.id);
          assert.equal(campaign.view().days, view.days, 'Shop does not consume an extra day');
        }
      }
      assert(cleared);
      assert(recruitDone);
      while (campaign.view().phase === 'reward') {
        const view = campaign.view();
        act(
          (view.actions.find((action) => action.label !== '放弃本次奖励') ?? view.actions[0]!).id,
        );
      }
      assert.equal(campaign.view().skillSlots, 3, 'First chapter unlocks the third extra slot');
      if (index < 2) {
        const next = source.regions.find((region) => region.id === path[index + 1])!;
        const action = campaign
          .view()
          .actions.find((action) => action.label === `前往${next.name}`)!;
        assert(action);
        act(action.id);
      }
    }
    assert.equal(campaign.view().phase, 'won');
    assert.equal(campaign.view().actions.length, 0);
    assert.equal(bosses, 3);
    assert(visitedKinds.has('event') && visitedKinds.has('camp') && visitedKinds.has('shop'));
    assert(
      (campaign.view().build.cards?.length ?? 0) > 0,
      'Mandatory first boss card reward carried forward',
    );
  }
});

test('城内不可循环领奖、首领不能绕过，断开的城图和不可能的计日条件拒绝', () => {
  const sourceCatalog = createShanhetuScenario(['caocao']);
  for (const edit of [
    (catalog: typeof sourceCatalog) => {
      catalog.regions![0]!.next = ['unknown'];
    },
    (catalog: typeof sourceCatalog) => {
      catalog.regions![0]!.bossAt = 30;
    },
    (catalog: typeof sourceCatalog) => {
      catalog.regions![0]!.boss = catalog.regions![0]!.nodes[0]!;
    },
    (catalog: typeof sourceCatalog) => {
      catalog.nodes.forEach((node) => {
        node.unlockDay = 5;
      });
    },
  ]) {
    const invalid = structuredClone(sourceCatalog);
    edit(invalid);
    assert.throws(() => new ShanhetuCampaign(invalid));
  }
});
test('奇遇展示的战法、技能和牌来自指定品质池，只有领钱选项会发铜币', () => {
  const options = new Map(
    source.events.flatMap((event) => event.options.map((option) => [option.id, option] as const)),
  );
  const kinds = ['', '', 'tactic', 'skill', 'card', 'equipment'];
  let checked = 0;
  for (let sample = 0; sample < 12; sample++) {
    const catalog = createShanhetuScenario(['caocao'], undefined, 11);
    for (const node of catalog.nodes) {
      for (const choice of node.choices ?? []) {
        const original = options.get(choice.decisionId ?? 0);
        if (!original) continue;
        if (!original.rewardGroup) {
          assert.deepEqual(choice.effects, [{ kind: 'coins', amount: original.coins }]);
          continue;
        }
        const group = source.rewardGroups.find((entry) => entry.id === original.rewardGroup)!;
        const effect = choice.effects[0]!;
        const reward = catalog.rewards.find((entry) =>
          entry.effects.some((item) => item.kind === effect.kind && item.amount === effect.amount),
        );
        assert(reward?.offer, `奇遇 ${choice.id} 未生成实际奖励`);
        assert.equal(reward.offer.kind, kinds[group.category]);
        assert(group.rarities.includes(reward.offer.rarity));
        assert(choice.label.endsWith(` · ${reward.name}`));
        checked++;
      }
    }
  }
  assert(checked > 0);
});

test('噩梦五档延续旧路线并按原门槛增加函谷关和崤函道', () => {
  const difficultyIds = [16, 17, 18, 19, 20];
  assert.deepEqual(
    source.difficulties.slice(15).map((d) => [d.prerequisite, d.albums, d.preserveHp]),
    [11, 16, 17, 18, 19].map((p) => [p, 20, true]),
  );
  for (const difficulty of difficultyIds) {
    const catalog = createShanhetuScenario(['caocao'], undefined, difficulty);
    assert.equal(catalog.regions!.length, 14);
    const region = (id: number) => catalog.regions!.find((r) => r.id === `region-${id}`)!;
    assert.deepEqual(region(2).next, ['region-1', 'region-6', 'region-3', 'region-7']);
    assert.deepEqual(region(3).next, ['region-14']);
    assert.deepEqual(region(14).next, []);
    assert.equal(region(3).terrain?.id, 13278);
    assert.equal(region(14).terrain, undefined);
    assert.equal(region(3).bossAt, 6);
    assert.equal(region(14).bossAt, 7);
    for (const [id, bossIds] of [
      [3, [2640, 2641, 2642, 2643]],
      [14, [2684, 2685, 2686, 2687]],
    ] as const) {
      const original = source.regions.find((r) => r.id === id)!;
      assert.deepEqual(original.hardBossIds, bossIds);
      const selected = catalog.nodes.find((n) => n.id === region(id).boss)!;
      assert(original.hardBossIds.includes(selected.battleId!));
    }
  }
  assert.throws(() => shanhetuRecipe(2687, 15));
  assert.throws(() => shanhetuRecipe(2640, 21));
});

test('噩梦对既有敌人及同席第二形态叠加第四档配方', () => {
  const opening = shanhetuRecipe(2498, 16, 0, 1).enemies[0]!;
  assert.deepEqual(opening.sourceSkills, [370, 993, 3121]);
  assert.equal(opening.startingCards - shanhetuRecipe(2498, 11, 0, 1).enemies[0]!.startingCards, 3);
  const general = shanhetuRecipe(2639, 16, 0, 1).enemies[0]!;
  assert(general.sourceSkills.includes(375));
  const fight = shanhetuRecipe(12225, 16, 0, 2).enemies[0]!;
  assert(fight.sourceSkills.includes(711));
  assert(fight.fixedEquipment?.some((card) => card.id === 20571));
  for (const difficulty of [16, 17, 18, 19, 20]) {
    const form = shanhetuRecipe(2687, difficulty, 16, 3).enemies[0]!;
    assert.equal(form.name, '改朝罪魁');
    assert(form.skills.length > 0);
    assert.equal(form.nextForm?.name, '篡天恶魂');
    assert.deepEqual(form.nextForm?.sourceSkills, [14214, 111]);
    assert(form.nextForm?.fixedEquipment?.some((c) => c.id === 20626));
  }
});
