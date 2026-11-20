// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { finalJourneyReport, recordJourneyDecision } from '../apps/server/src/shanhetu-ending.js';
import {
  ShanhetuCampaign,
  type ShanhetuCampaignCatalog,
} from '../apps/server/src/shanhetu-campaign.js';
import type { ShanhetuBattleSetup } from '../packages/noname-adapter/src/shanhetu.js';
import type { ShanhetuBattleResult } from '../packages/shared/src/shanhetu.js';

// A small integration fixture, deliberately not advertised as the S5 map.
function catalog(): ShanhetuCampaignCatalog {
  return {
    id: 'campaign-test',
    name: '征程状态测试',
    entries: ['first'],
    candidates: ['caocao'],
    initialCoins: 0,
    initialSkillSlots: 2,
    rewards: [
      {
        id: 'draw',
        name: '摸牌Ⅰ',
        description: '摸牌数+1',
        effects: [{ kind: 'tactic', amount: 2059 }],
      },
      {
        id: 'cards',
        name: '携带手牌',
        description: '初始手牌+2',
        effects: [{ kind: 'initial-cards', amount: 2 }],
      },
      {
        id: 'skill',
        name: '苦肉',
        description: '额外技能',
        effects: [{ kind: 'skill', amount: 3297 }],
      },
    ],
    nodes: [
      {
        id: 'first',
        name: '落单禁军',
        description: '战斗',
        kind: 'battle',
        chapter: 1,
        duration: 1,
        battleId: 22498,
        coins: 200,
        rewardGroups: [{ count: 1, rewards: ['draw'] }],
        next: ['camp', 'shop'],
      },
      {
        id: 'camp',
        name: '营地',
        description: '休整',
        kind: 'camp',
        chapter: 1,
        duration: 1,
        choices: [
          {
            id: 'heal',
            label: '休整',
            description: '回复1点体力',
            cost: 0,
            effects: [{ kind: 'heal', amount: 1 }],
          },
        ],
        next: ['shop'],
      },
      {
        id: 'shop',
        name: '集市',
        description: '购买',
        kind: 'shop',
        chapter: 1,
        duration: 0,
        products: [
          { rewardId: 'cards', price: 100 },
          { rewardId: 'skill', price: 1000 },
        ],
        nextPriceIncrease: 100,
        next: ['boss'],
      },
      {
        id: 'boss',
        name: '暗夺天子',
        description: '首领测试',
        kind: 'boss',
        chapter: 2,
        duration: 1,
        battleId: 22298,
        unlockSkillSlots: 3,
        next: [],
      },
    ],
  };
}
function choose(campaign: ShanhetuCampaign, label: string) {
  const view = campaign.view();
  const action = view.actions.find((action) => action.label === label);
  assert(action, `Missing action ${label}`);
  const input = { runId: view.id, revision: view.revision, actionId: action.id };
  return { input, ...campaign.act(input) };
}
function victory(ticket: ShanhetuBattleSetup, hp = 2): ShanhetuBattleResult {
  return {
    runId: ticket.runId,
    nodeId: ticket.nodeId,
    battleId: ticket.battleId,
    outcome: 'victory',
    hero: { general: 'caocao', group: 'wei', hp, maxHp: 4 },
    defeatedEnemies: ticket.battleId === 22498 ? 1 : 2,
  };
}
function firstWin(campaign: ShanhetuCampaign) {
  const first = choose(campaign, '落单禁军');
  assert(first.battle);
  campaign.bindMatch(first.battle, 'match-1');
  assert(campaign.settle('match-1', victory(first.battle)));
  return first;
}

test('奇遇选择只加一次战功，重开仍打所选阵容，胜后发钱并保留跨商店的累计收入', () => {
  const route = catalog();
  route.recordEndings = true;
  route.restartLimit = 1;
  route.difficulty = 6;
  route.nodes[1]!.kind = 'event';
  route.nodes[1]!.choices = [
    {
      id: 'elite',
      decisionId: 127302,
      label: '迂回包抄',
      description: '',
      cost: 0,
      effects: [],
      encounter: { battleId: 12225, coins: 300 },
    },
  ];
  const campaign = new ShanhetuCampaign(route);
  firstWin(campaign);
  choose(campaign, '摸牌Ⅰ');
  choose(campaign, '营地');
  const chosen = choose(campaign, '迂回包抄');
  assert(chosen.battle);
  assert.equal(chosen.battle.battleId, 12225);
  assert.equal(campaign.view().coins, 200);
  assert.equal(campaign.view().finalReport, undefined);
  assert.equal(campaign.act(chosen.input).duplicate, true);
  campaign.bindMatch(chosen.battle, 'event');
  const restarted = campaign.restart('event');
  assert.equal(restarted.battleId, 12225);
  campaign.bindMatch(restarted, 'retry');
  assert(campaign.settle('retry', { ...victory(restarted), defeatedEnemies: 1 }));
  choose(campaign, '集市');
  choose(campaign, '携带手牌');
  choose(campaign, '离开集市');
  const last = choose(campaign, '暗夺天子').battle!;
  campaign.bindMatch(last, 'boss');
  assert(campaign.settle('boss', victory(last)));
  assert.equal(campaign.view().coins, 400);
  assert.deepEqual(campaign.view().finalReport, {
    title: '大获全胜',
    earnedCoins: 500,
    reputation: 0,
    strategy: 0,
    merit: 10,
    trade: 0,
  });
});

test('各档新奇遇按实际选项记录声望、智谋或商才', () => {
  for (const eventId of [1906, 1907, 1933, 1934, 1954, 1955, 1956, 1957]) {
    const skillBag = eventId === 1954 || eventId === 1955;
    for (const [index, attribute, amount] of [
      [1, skillBag ? 'strategy' : 'reputation', skillBag ? 10 : 1],
      [2, 'strategy', 10],
      [3, 'trade', 10],
    ] as const) {
      const initial = { earnedCoins: 0, reputation: 0, strategy: 0, merit: 0, trade: 0 };
      const stats = { ...initial };
      recordJourneyDecision(stats, eventId * 100 + index);
      assert.deepEqual(stats, { ...initial, [attribute]: amount });
    }
  }
});

test('三章结局按难度、声望、属性和累计铜币判定', () => {
  const stats = { earnedCoins: 4000, reputation: 0, strategy: 30, merit: 15, trade: 60 };
  for (const difficulty of [1, 6, 11])
    assert.equal(finalJourneyReport(difficulty, true, stats).title, '大获全胜');
  recordJourneyDecision(stats, 179901);
  recordJourneyDecision(stats, 126901);
  recordJourneyDecision(stats, 179803);
  assert.equal(finalJourneyReport(1, true, stats).title, '水到渠成');
  assert.equal(finalJourneyReport(6, true, stats).title, '从龙之功');
  assert.equal(finalJourneyReport(11, true, stats).title, '居功至伟');
  assert.equal(finalJourneyReport(11, true, { ...stats, earnedCoins: 3999 }).title, '大获全胜');
  assert.equal(finalJourneyReport(2, true, stats).title, '大获全胜');
  recordJourneyDecision(stats, 148401);
  assert.equal(finalJourneyReport(1, true, stats).title, '大获全胜');
  assert.equal(finalJourneyReport(6, false, stats).title, '折戟沉沙');
});

test('权威征程冻结奖励／路线，购买扣款一次，下一战继承成长和体力，末首领才通关', () => {
  const source = catalog();
  const campaign = new ShanhetuCampaign(source);
  source.nodes[0]!.coins = 9999;
  const first = firstWin(campaign);
  assert.equal(campaign.view().coins, 200);
  assert.equal(campaign.view().phase, 'reward');
  assert.equal(campaign.settle('match-1', victory(first.battle!)), false);
  const reward = choose(campaign, '摸牌Ⅰ');
  assert.deepEqual(campaign.view().build.tactics, [2059]);
  assert.equal(campaign.view().phase, 'map');
  assert.deepEqual(campaign.act(reward.input), { duplicate: true, battle: null });
  choose(campaign, '营地');
  choose(campaign, '休整');
  assert.equal(campaign.view().hero?.hp, 3);
  choose(campaign, '集市');
  const costly = campaign.view().actions.find((action) => action.label === '苦肉')!;
  const before = campaign.view();
  assert.throws(
    () => campaign.act({ runId: before.id, revision: before.revision, actionId: costly.id }),
    /铜币不足/,
  );
  assert.deepEqual(campaign.view(), before);
  const purchase = choose(campaign, '携带手牌');
  assert.equal(campaign.view().coins, 100);
  assert.equal(campaign.view().build.initialCards, 2);
  assert(!campaign.view().actions.some((action) => action.label === '携带手牌'));
  assert.equal(campaign.view().actions.find((action) => action.label === '苦肉')?.cost, 1100);
  assert(campaign.act(purchase.input).duplicate);
  assert.equal(campaign.view().coins, 100);
  choose(campaign, '离开集市');
  const boss = choose(campaign, '暗夺天子');
  assert(boss.battle);
  assert.equal(boss.battle.hero?.hp, 3);
  assert.deepEqual(boss.battle.build?.tactics, [2059]);
  assert.equal(boss.battle.build?.initialCards, 2);
  assert.equal(campaign.view().days, 1, 'Chapter change resets elapsed days');
  campaign.bindMatch(boss.battle, 'match-2');
  assert(campaign.settle('match-2', victory(boss.battle)));
  assert.equal(campaign.view().phase, 'won');
  assert.equal(campaign.view().skillSlots, 3);
  assert.equal(campaign.view().completedNodes, 4);
  assert.equal(campaign.view().actions.length, 0);
});

test('跨征程、过期动作与旧战斗不能推进；中断明确重建战斗、不加钱、不重用节点票据', () => {
  const campaign = new ShanhetuCampaign(catalog());
  const other = new ShanhetuCampaign(catalog());
  const foreign = other.view();
  assert.throws(
    () => campaign.act({ runId: campaign.view().id, actionId: 'missing-revision' }),
    /编号或版本无效/,
  );
  assert.throws(
    () =>
      campaign.act({
        runId: foreign.id,
        revision: foreign.revision,
        actionId: foreign.actions[0]!.id,
      }),
    /征程已更新/,
  );
  const first = choose(campaign, '落单禁军');
  assert(first.battle);
  assert.equal(campaign.interrupt('stale-match'), false);
  campaign.bindMatch(first.battle, 'match-1');
  assert.equal(campaign.settle('other-match', victory(first.battle)), false);
  assert.equal(
    campaign.settle('match-1', { ...victory(first.battle), nodeId: 'other-node' }),
    false,
  );
  assert.equal(campaign.view().coins, 0);
  assert(campaign.interrupt('match-1'));
  assert.equal(campaign.view().phase, 'interrupted');
  assert.equal(campaign.view().coins, 0);
  const retry = choose(campaign, '重新挑战本关');
  assert(retry.battle);
  assert.notEqual(retry.battle.nodeId, first.battle.nodeId);
  assert.equal(retry.battle.battleId, first.battle.battleId);
  assert.equal(campaign.settle('match-1', victory(first.battle)), false);
  campaign.bindMatch(retry.battle, 'match-2');
  assert(campaign.settle('match-2', victory(retry.battle)));
  const oldView = campaign.view();
  choose(campaign, '摸牌Ⅰ');
  assert.throws(
    () => campaign.act({ runId: oldView.id, revision: oldView.revision, actionId: 'fake' }),
    /征程已更新/,
  );
  const copy = campaign.view();
  copy.build.tactics.push(9999);
  copy.hero!.hp = 999;
  assert.equal(campaign.view().hero?.hp, 2);
  assert.deepEqual(campaign.view().build.tactics, [2059]);
});

test('败北结束征程，不能靠回放胜利、购买或重试复活', () => {
  const campaign = new ShanhetuCampaign(catalog());
  const first = choose(campaign, '落单禁军');
  assert(first.battle);
  campaign.bindMatch(first.battle, 'match-1');
  assert(
    campaign.settle('match-1', {
      ...victory(first.battle),
      outcome: 'defeat',
      hero: { ...victory(first.battle).hero, hp: 0 },
    }),
  );
  assert.equal(campaign.view().phase, 'lost');
  assert.equal(campaign.view().coins, 0);
  assert.equal(campaign.view().actions.length, 0);
  assert.equal(campaign.interrupt('match-1'), false);
  assert.equal(campaign.settle('match-1', victory(first.battle)), false);
  assert(campaign.act(first.input).duplicate);
  assert.equal(campaign.view().phase, 'lost');
});

test('内容缺项、未知技能、循环刷奖励及无首领终局在创建征程前拒绝', () => {
  const invalids = [
    (c: ShanhetuCampaignCatalog) => {
      c.nodes[0]!.battleId = 99999;
    },
    (c: ShanhetuCampaignCatalog) => {
      c.rewards[0]!.effects = [{ kind: 'skill', amount: 9999 }];
    },
    (c: ShanhetuCampaignCatalog) => {
      c.nodes[2]!.next = ['first'];
    },
    (c: ShanhetuCampaignCatalog) => {
      c.nodes[3]!.kind = 'battle';
    },
    (c: ShanhetuCampaignCatalog) => {
      c.nodes[0]!.next = ['unknown'];
    },
    (c: ShanhetuCampaignCatalog) => {
      c.nodes[2]!.products![0]!.price = -1;
    },
  ];
  for (const change of invalids) {
    const c = catalog();
    change(c);
    assert.throws(() => new ShanhetuCampaign(c));
  }
});

test('必选随身牌、放弃技能铜币、满槽替换及同槽装备替换均由冻结选项执行', () => {
  const source = catalog();
  source.rewards.push(
    {
      id: 'carry',
      name: '随身牌',
      description: '两杀与青釭剑',
      effects: [
        { kind: 'card', amount: 4062 },
        { kind: 'card', amount: 4062 },
        { kind: 'card', amount: 4004 },
      ],
    },
    {
      id: 'replacement',
      name: '当先',
      description: '替换技能',
      effects: [{ kind: 'skill', amount: 3091 }],
    },
    {
      id: 'weapon',
      name: '麒麟弓',
      description: '替换青釭剑',
      effects: [{ kind: 'card', amount: 4008 }],
    },
  );
  source.nodes[0]!.rewardGroups = [
    { count: 1, rewards: ['carry'], allowSkip: false },
    { count: 1, rewards: ['skill'], allowSkip: true, skipCoins: 50 },
  ];
  source.nodes[1]!.choices![0]!.effects = [
    { kind: 'skill', amount: 3297 },
    { kind: 'skill', amount: 3021 },
  ];
  source.nodes[2]!.products = [
    { rewardId: 'replacement', price: 100 },
    { rewardId: 'weapon', price: 0 },
  ];
  const campaign = new ShanhetuCampaign(source);
  firstWin(campaign);
  assert.equal(campaign.view().actions.length, 1, 'Mandatory card reward cannot be skipped');
  choose(campaign, '随身牌');
  assert.deepEqual(campaign.view().build.cards, [4062, 4062, 4004]);
  const skipped = choose(campaign, '放弃本次奖励');
  assert.equal(campaign.view().coins, 250);
  assert(campaign.act(skipped.input).duplicate);
  assert.equal(campaign.view().coins, 250);
  choose(campaign, '营地');
  choose(campaign, '休整');
  assert.deepEqual(campaign.view().build.skills, [3297, 3021]);
  choose(campaign, '集市');
  const equipment = campaign.view().actions.find((action) => action.label === '麒麟弓')!;
  assert.equal(equipment.replacement?.[0]?.name, '青釭剑');
  assert.match(equipment.replacement![0]!.description, /防具/);
  assert.deepEqual(campaign.view().build.cards, [4062, 4062, 4004]);
  assert(campaign.view().actions.some((action) => action.label === '当先（替换苦肉）'));
  assert.match(
    campaign.view().actions.find((action) => action.label === '当先（替换苦肉）')!.replacement![0]!
      .description,
    /失去1点体力/,
  );
  assert(campaign.view().actions.some((action) => action.label === '当先（替换奇袭）'));
  const replaced = choose(campaign, '当先（替换苦肉）');
  assert.deepEqual(campaign.view().build.skills, [3021, 3091]);
  assert.equal(campaign.view().coins, 150);
  assert(campaign.act(replaced.input).duplicate);
  assert.equal(campaign.view().coins, 150);
  assert(!campaign.view().actions.some((action) => action.label.startsWith('当先')));
  choose(campaign, '麒麟弓');
  assert.deepEqual(campaign.view().build.cards, [4062, 4062, 4008]);
  choose(campaign, '离开集市');
  const next = choose(campaign, '暗夺天子');
  assert.deepEqual(next.battle?.build?.cards, [4062, 4062, 4008]);
  assert.deepEqual(next.battle?.build?.skills, [3021, 3091]);
});

test('集市首次免费刷新，后续扣100；购买涨价跨刷新保留，重复请求不重扣', () => {
  const source = catalog();
  source.nodes[0]!.coins = 1000;
  const shop = source.nodes[2]!;
  shop.products = [{ rewardId: 'cards', price: 100 }];
  shop.refreshPool = [{ rewardId: 'cards', price: 100 }];
  shop.offerCount = 4;
  shop.freeRefreshes = 1;
  shop.refreshPrice = 100;
  const campaign = new ShanhetuCampaign(source);
  firstWin(campaign);
  choose(campaign, '摸牌Ⅰ');
  choose(campaign, '集市');
  const free = choose(campaign, '免费刷新集市');
  assert.equal(campaign.view().coins, 1000);
  assert(campaign.act(free.input).duplicate);
  choose(campaign, '携带手牌');
  assert.equal(campaign.view().coins, 900);
  assert.equal(campaign.view().build.initialCards, 2);
  const refresh = choose(campaign, '刷新集市（100铜币）');
  assert.equal(campaign.view().coins, 800);
  assert.equal(campaign.view().actions.find((action) => action.label === '携带手牌')?.cost, 200);
  assert(campaign.act(refresh.input).duplicate);
  assert.equal(campaign.view().coins, 800);
  choose(campaign, '携带手牌');
  assert.equal(campaign.view().coins, 600);
  assert.equal(campaign.view().build.initialCards, 4);
  const before = campaign.view();
  assert.throws(
    () =>
      campaign.act({
        runId: before.id,
        revision: before.revision - 1,
        actionId: before.actions[0]!.id,
        effects: [{ kind: 'coins', amount: 999999 }],
      }),
    /征程已更新/,
  );
  assert.deepEqual(campaign.view(), before);
});
