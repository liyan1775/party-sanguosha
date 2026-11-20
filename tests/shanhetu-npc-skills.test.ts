// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import definitions from '../config/shanhetu-npc-skills.json' with { type: 'json' };

// Rule branch tests of our adapter code, not a substitute for native games.
async function fixture() {
  const modules = await Promise.all(
    [
      'shanhetu-medium.js',
      'shanhetu-hard.js',
      'shanhetu-nightmare-pass.js',
      'shanhetu-nightmare-roads.js',
      'shanhetu-nightmare-final.js',
      'shanhetu-nightmare-gear.js',
      'shanhetu-terrain.js',
      'shanhetu-skills.js',
    ].map((name) =>
      readFile(new URL(`../packages/noname-adapter/runtime/${name}`, import.meta.url), 'utf8'),
    ),
  );
  const source = modules
    .join('\n')
    .replace(/^import .*;$/gm, '')
    .replace(/^export /gm, '');
  const native = Object.fromEntries(
    definitions.skills.flatMap((skill) =>
      [
        ...(skill.implementation === 'scenario-specific' ? [] : [skill.nativeId]),
        ...('inherits' in skill ? [skill.inherits!] : []),
      ].map((id) => [id, {}]),
    ),
  );
  const lib: any = {
    skill: { ...native },
    card: {},
    translate: {},
    filter: { cardDiscardable: () => true },
  };
  let ordered: any[] = [];
  const game = {
    roundNumber: 3,
    finishCard() {},
    filterPlayer: (filter: (player: any) => boolean) =>
      Object.assign(ordered.filter(filter), {
        sortBySeat() {
          return this;
        },
      }),
    hasPlayer: (filter: (player: any) => boolean) => ordered.some(filter),
  };
  const get: any = {
    type2: (card: any) => card.type,
    color: (card: any) => card.color,
    distance: (from: unknown, to: unknown) => (from === to ? 0 : 4),
  };
  const ui = { selected: { cards: [] as any[] } };
  const context = vm.createContext({ lib, game, get, ui });
  vm.runInContext(
    `${source}\ninstallShanhetuNpcSkills(${JSON.stringify(definitions.skills)});\n` +
      `installShanhetuNormalWeapons(new Set(['party_shanhetu_thunder_blade', 'party_shanhetu_xingtian_axe', 'party_shanhetu_duanhun']));\n` +
      `installShanhetuHardGear(new Set(['party_shanhetu_iron_guard', 'party_shanhetu_fire_lute', 'party_shanhetu_kunlun_mirror']));`,
    context,
  );
  return {
    lib,
    native,
    get,
    ui,
    terrain(id: number) {
      vm.runInContext(
        `installShanhetuTerrain({ id: ${id}, name: '地形', description: '地形效果' })`,
        context,
      );
      return lib.skill.party_shanhetu_terrain;
    },
    setPlayers: (players: any[]) => {
      ordered = players;
    },
  };
}

test('幽燕双骑的咆哮仅计自己的杀，下次杀伤害结算一次并在本回合结束清除', async () => {
  const { lib } = await fixture();
  const skill = lib.skill.party_shanhetu_paoxiao939;
  const charged = lib.skill.party_shanhetu_paoxiao939_charge;
  let marks = 0,
    expiry: unknown;
  const player = {
    addTempSkill(_name: string, duration: unknown) {
      expiry = duration;
    },
    addMark(_name: string, n: number) {
      marks += n;
    },
    countMark() {
      return marks;
    },
    removeSkill() {
      marks = 0;
    },
  };
  assert.equal(skill.mod.cardUsable({ name: 'sha' }), Infinity);
  assert.equal(skill.mod.cardUsable({ name: 'juedou' }), undefined);
  assert.deepEqual([...skill.trigger.player], ['shaMiss', 'eventNeutralized']);
  assert.equal(charged.trigger.source, 'damageBegin1');
  const attack = { card: { name: 'sha' }, num: 1 };
  assert(skill.filter(attack));
  await skill.content({}, attack, player);
  assert.equal((expiry as { global: string }).global, 'phaseAfter');
  assert(!charged.filter({ card: { name: 'juedou' } }, player));
  assert(charged.filter(attack, player));
  await charged.content({}, attack, player);
  assert.equal(attack.num, 2);
  assert(!charged.filter(attack, player));
});

test('地形用实际出牌阶段历史计上限，河流在手牌上限计算后封顶', async () => {
  const { get, terrain } = await fixture();
  const previous = {};
  const phase = { player: {} };
  const cards = Array.from({ length: 9 }, () => ({ getParent: () => phase }));
  const source = Object.assign(phase.player, {
    countHistory: (type: string, filter: (event: unknown) => boolean) =>
      [...cards, { getParent: () => previous }].filter(filter).length,
  });
  const event = { getParent: () => phase };
  get.event = () => event;
  const forest = terrain(13274);
  assert.equal(forest.mod.cardEnabled({}, source), undefined);
  assert.equal(forest.filter(event, source), false);
  cards.push(event);
  assert.equal(forest.filter(event, source), false);
  cards.push({ getParent: () => phase });
  assert.equal(forest.mod.cardEnabled({}, source), false);
  assert.equal(forest.filter(event, source), true);
  get.event = () => ({ getParent: () => previous });
  assert.equal(forest.mod.cardEnabled({}, source), undefined);
  const river = terrain(13276);
  assert.equal(river.mod.maxHandcardFinal(source, 7), 7);
  assert.equal(river.mod.maxHandcardFinal(source, 12), 8);
});

test('铁甲胄用损耗护甲后的致命条件，在销毁装备后防住当前及本回合伤害', async () => {
  const { lib } = await fixture();
  const guard = lib.skill.party_shanhetu_iron_guard;
  const iron = {};
  const actions: unknown[] = [];
  const player = {
    hp: 1,
    hujia: 1,
    hasSkillTag: () => false,
    getEquip: () => iron,
    loseToDiscardpile: async (card: unknown) => actions.push(card),
    addTempSkill: (skill: string, expire: unknown) => actions.push([skill, expire]),
  };
  assert.equal(guard.filter({ num: 1 }, player), false);
  assert.equal(guard.filter({ num: 1, nohujia: true }, player), true);
  assert.equal(guard.filter({ num: 2 }, player), true);
  const root = { cancel: () => actions.push('cancelled') };
  await guard.content({ name: 'iron' }, root, player);
  assert.equal(actions[0], iron);
  assert.equal(actions[1], 'cancelled');
  assert.equal(
    JSON.stringify(actions[2]),
    JSON.stringify(['party_shanhetu_iron_guard_immune', { global: 'phaseAfter' }]),
  );
  await lib.skill.party_shanhetu_iron_guard_immune.content({}, root);
  assert.equal(actions[3], 'cancelled');
});

test('专版强袭按本轮已计入的次数加伤，空手发动支付体力，弃武器不再扣体力', async () => {
  const { lib } = await fixture();
  const skill = lib.skill.party_shanhetu_qiangxi;
  const damage: number[] = [];
  let hp = 4;
  let uses = 1;
  const player = {
    countRoundHistory(key: string, predicate: (event: { skill: string }) => boolean) {
      assert.equal(key, 'useSkill');
      assert(predicate({ skill: 'party_shanhetu_qiangxi' }));
      return uses;
    },
    async loseHp() {
      hp--;
    },
  };
  const target = {
    isIn: () => true,
    async damage(amount: number) {
      damage.push(amount);
    },
  };
  assert.equal(skill.usable, 2);
  await skill.content({ name: 'party_shanhetu_qiangxi', target, cards: [] }, {}, player);
  uses = 2;
  await skill.content(
    { name: 'party_shanhetu_qiangxi', target, cards: [{ name: 'weapon' }] },
    {},
    player,
  );
  assert.equal(hp, 3);
  assert.deepEqual(damage, [1, 2]);
});

test('无脏替换额定摸牌，伏骑禁止其他角色响应，骄恣按轮数及最多手牌判定', async () => {
  const { lib, setPlayers } = await fixture();
  const wuzang = lib.skill.party_shanhetu_wuzang;
  const draw = { num: 3, numFixed: false };
  await wuzang.content({ name: 'party_shanhetu_wuzang' }, draw, { hp: 13 });
  assert.deepEqual(draw, { num: 6, numFixed: true });
  assert.equal(wuzang.filter(draw), false);
  assert.equal(wuzang.mod.maxHandcardFinal(), 0);
  const player = { countCards: () => 3 };
  const opponent = { countCards: () => 3 };
  const moreCards = { countCards: () => 4 };
  setPlayers([player, opponent]);
  const called: unknown[] = [];
  const fuqi = lib.skill.party_shanhetu_fuqi;
  await fuqi.content(
    { name: 'party_shanhetu_fuqi' },
    { directHit: { addArray: (list: unknown[]) => called.push(...list) } },
    player,
  );
  assert.deepEqual(called, [opponent]);
  assert.equal(fuqi.mod.wuxieRespondable(null, player, opponent, opponent), false);
  assert.equal(fuqi.mod.wuxieRespondable(null, player, opponent, player), undefined);
  const jiaozi = lib.skill.party_shanhetu_jiaozi;
  assert(jiaozi.filter(null, player));
  const damage = { num: 1 };
  await jiaozi.content({ name: 'party_shanhetu_jiaozi' }, damage);
  assert.equal(damage.num, 4);
  setPlayers([player, opponent, moreCards]);
  assert(!jiaozi.filter(null, player));
});

test('炎狱最多进行三次红色判定，蔽日只按实际回复量摸牌', async () => {
  const { lib, get } = await fixture();
  const yanyu = lib.skill.party_shanhetu_yanyu;
  const card = { position: 'd' };
  get.position = (card: { position: string }) => card.position;
  const player = { isIn: () => true, gain: async (card: unknown) => gained.push(card) };
  const gained: unknown[] = [];
  const hurts: unknown[][] = [];
  const target = {
    isIn: () => true,
    judge: () => ({ forResult: async () => ({ color: 'red', card }) }),
    damage: async (...args: unknown[]) => hurts.push(args),
  };
  await yanyu.content({ name: 'party_shanhetu_yanyu' }, { player: target }, player);
  assert.deepEqual(
    hurts,
    Array.from({ length: 3 }, () => [1, 'fire', player]),
  );
  assert.deepEqual(gained, [card, card, card]);
  const biri = lib.skill.party_shanhetu_biri;
  let canceled = false;
  let drew = 0;
  const state = {
    hp: 3,
    recover: async (amount: number) => (state.hp = Math.min(4, state.hp + amount)),
    draw: async (count: number) => (drew += count),
  };
  const damage = {
    num: 2,
    hasNature: (nature: string) => nature === 'fire',
    cancel: () => {
      canceled = true;
    },
  };
  assert(biri.filter(damage));
  await biri.content({ name: 'party_shanhetu_biri' }, damage, state);
  assert(canceled);
  assert.equal(state.hp, 4);
  assert.equal(drew, 1);
});

test('神速按本次与本回合已跳的阶段加伤，末次翻面且使用原生杀', async () => {
  const { lib } = await fixture();
  const skill = lib.skill.party_shanhetu_shensu;
  const pending: string[] = [];
  const targets: unknown[] = [];
  const damage: number[] = [];
  const enemy = { isIn: () => true };
  let flipped = false;
  const player = {
    getHistory: () => pending,
    skip: (phase: string) => pending.push(phase),
    async turnOver() {
      flipped = true;
    },
    useCard(card: { name: string }, target: unknown, addCount: boolean) {
      assert.equal(card.name, 'sha');
      assert.equal(addCount, false);
      targets.push(target);
      return {
        set(key: string, value: number) {
          assert.equal(key, 'baseDamage');
          damage.push(value);
        },
      };
    },
  };
  await skill.content(
    { targets: [enemy] },
    { name: 'phaseJudge', cancel: () => pending.push('phaseJudge') },
    player,
  );
  await skill.content(
    { targets: [enemy] },
    { name: 'phaseUse', cancel: () => pending.push('phaseUse') },
    player,
  );
  await skill.content(
    { targets: [enemy] },
    { name: 'phaseDiscard', cancel: () => pending.push('phaseDiscard') },
    player,
  );
  assert.deepEqual(damage, [3, 4, 5]);
  assert.deepEqual(targets, [enemy, enemy, enemy]);
  assert(flipped);
});

test('雷震按实际使用手牌记次，充能不叠加，由下一张杀消耗', async () => {
  const { lib } = await fixture();
  const boost = lib.skill.party_shanhetu_thunder_blade_skill;
  const meter = lib.skill.party_shanhetu_thunder_charge;
  const blade: any = {};
  const event = { cards: [{ name: 'sha' }], card: { name: 'sha' }, baseDamage: 1 };
  const player = {
    playerid: 'enemy',
    getEquip: () => blade,
    hasHistory(key: string, filter: (loss: any) => boolean) {
      assert.equal(key, 'lose');
      assert(!filter({ type: 'discard', hs: [{}], getParent: () => event }));
      assert(!filter({ type: 'use', hs: [], getParent: () => event }));
      return filter({ type: 'use', hs: [{}], getParent: () => event });
    },
  };
  assert(meter.filter(event, player));
  for (let i = 0; i < 2; i++) await meter.content({}, event, player);
  assert(!boost.filter(event, player));
  for (let i = 0; i < 4; i++) await meter.content({}, event, player);
  assert(boost.filter(event, player));
  assert(!boost.filter({ card: { name: 'jiu' } }, player));
  await boost.content({}, event, player);
  assert.equal(event.baseDamage, 2);
  assert(!boost.filter(event, player));
});

test('刑天装备禁制，用牌、响应和救援受同一回合标记限制', async () => {
  const { lib } = await fixture();
  const restriction = lib.skill.party_shanhetu_xingtian_ban;
  for (const key of ['cardEnabled', 'cardEnabled2', 'cardRespondable', 'cardSavable'])
    assert.equal(restriction.mod[key](), false);
  assert.equal(restriction.ai.unequip2, true);
});

test('暴怒战神沿用本场累计用杀，无双同时按使用和应对决斗的方向增加响应', async () => {
  const { lib, get } = await fixture();
  const uses = ['sha', 'sha', 'juedou', 'sha', 'sha', 'sha', 'sha'];
  const warrior = {
    playerid: 'boss',
    hasSkill: (id: string) => id === 'party_shanhetu_fixed_distance',
    countAllHistory: (kind: string, filter: (event: { card: { name: string } }) => boolean) => {
      assert.equal(kind, 'useCard');
      return uses.filter((name) => filter({ card: { name } })).length;
    },
  };
  const hero = { playerid: 'hero', hasSkill: () => false };
  assert.equal(get.distance(warrior, hero), 1);
  assert.equal(get.distance(warrior, hero, 'attack'), 1);
  assert.equal(get.distance(warrior, hero, 'raw'), 4);
  assert.equal(get.distance(warrior, warrior), 0);
  assert.equal(get.distance(hero, warrior), 4);
  const skill = lib.skill.party_shanhetu_battle_wushuang;
  const sha: any = { directHit: [], customArgs: { hero: { shanRequired: 2 } } };
  const attack = { player: warrior, target: hero, card: { name: 'sha' }, getParent: () => sha };
  assert(skill.filter(attack, warrior));
  await skill.content({}, attack, warrior);
  assert.equal(sha.customArgs.hero.shanRequired, 6, '五张基础响应与额外的一张叠加');
  sha.directHit.push(hero);
  assert.equal(skill.filter(attack, warrior), false);
  for (const [source, target] of [
    [hero, warrior],
    [warrior, hero],
  ]) {
    const duel: any = { customArgs: {} };
    await skill.content(
      {},
      { player: source, target, card: { name: 'juedou' }, getParent: () => duel },
      warrior,
    );
    assert.equal(duel.customArgs[target!.playerid].shaReq.hero, 5);
  }
  uses.splice(1);
  sha.directHit.length = 0;
  assert.equal(skill.filter(attack, warrior), false);
});

test('董旻的盾弓只防止超过三点的部分，牛辅的纵掠保留可选发动', async () => {
  const { lib } = await fixture();
  const skill = lib.skill.party_shanhetu_dungong;
  const damage = { num: 6 };
  assert.equal(skill.filter({ num: 3 }), false);
  assert(skill.filter(damage));
  await skill.content({}, damage);
  assert.equal(damage.num, 3);
  assert.equal(lib.skill.party_shanhetu_zonglve.inherit, 'olzonglve');
  assert.equal(lib.skill.party_shanhetu_zonglve.forced, false);
});
function actor(hand: string[], choice = 0) {
  const player: any = {
    hand: hand.map((type, index) => ({ type, index })),
    equipment: ['equipment'],
    controls: 0,
    discards: [] as number[],
    damages: [] as number[],
    countCards: () => player.hand.length,
    hasCard: (filter: (card: any) => boolean) => player.hand.some(filter),
    getCards: (zone: string) => {
      assert.equal(zone, 'h');
      return [...player.hand];
    },
    isIn: () => true,
    chooseControl: () => {
      player.controls++;
      const action = { set: () => action, forResult: async () => ({ index: choice }) };
      return action;
    },
    chooseToDiscard: (zone: string, forced: boolean, count: number) => {
      assert.equal(zone, 'h');
      assert(forced);
      assert.equal(count, 1);
      const action = {
        set: (key: string, filter: (card: any) => boolean) => {
          assert.equal(key, 'filterCard');
          const card = player.hand.find(filter);
          assert(card);
          player.hand.splice(player.hand.indexOf(card), 1);
          player.discards.push(1);
          return Promise.resolve();
        },
      };
      return action;
    },
    discard: async (cards: any[]) => {
      player.discards.push(cards.length);
      player.hand = player.hand.filter((card: any) => !cards.includes(card));
    },
    damage: async (amount: number, nature: string) => {
      assert.equal(nature, 'fire');
      player.damages.push(amount);
    },
  };
  return player;
}

test('山河义释只防止直接杀伤害并取得目标区域一张牌，不替换为新版减伤夺装备', async () => {
  const { lib } = await fixture();
  const skill = lib.skill.party_shanhetu_yishi;
  const player = {
    gainPlayerCard: async (...args: any[]) => {
      calls.push(args);
    },
  };
  const calls: any[][] = [];
  const target = { isIn: () => true, countGainableCards: () => 1 };
  let cancelled = false;
  const event = {
    card: { name: 'sha' },
    player: target,
    notLink: () => true,
    cancel: () => {
      cancelled = true;
    },
  };
  assert(skill.filter(event, player));
  assert(!skill.filter({ ...event, card: { name: 'juedou' } }, player));
  assert(!skill.filter({ ...event, notLink: () => false }, player));
  assert(!skill.filter({ ...event, player: { ...target, countGainableCards: () => 0 } }, player));
  await skill.content({}, event, player);
  assert(cancelled);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![0], target);
  assert.equal(calls[0]![1], 'hej');
  assert.equal(calls[0]![2], true);
});

test('山河图专版灭计不收发动者费用，只弃一张锦囊或目标全部手牌，保留装备', async () => {
  const { lib, native } = await fixture();
  for (const [id, skill] of Object.entries(native)) assert.equal(lib.skill[id], skill);
  const owner = actor(['trick', 'basic']);
  const target = actor(['basic', 'trick', 'basic']);
  const skill = lib.skill.party_shanhetu_mieji;
  await skill.content({ target }, null, owner);
  assert.equal(owner.hand.length, 2);
  assert.equal(target.hand.length, 2);
  assert(target.hand.every((card: any) => card.type === 'basic'));
  assert.deepEqual(target.equipment, ['equipment']);
  const all = actor(['trick', 'basic'], 1);
  await skill.content({ target: all }, null, owner);
  assert.deepEqual(all.discards, [2]);
  assert.equal(all.hand.length, 0);
  assert.deepEqual(all.equipment, ['equipment']);
  const noTrick = actor(['basic', 'basic']);
  await skill.content({ target: noTrick }, null, owner);
  assert.equal(noTrick.controls, 0);
  assert.deepEqual(noTrick.discards, [2]);
  assert.equal(skill.filterTarget(null, owner, actor([])), false);
});

test('焚城空手仍可选择弃置全部（0张），不补造弃牌或伤害事件', async () => {
  const { lib, setPlayers } = await fixture();
  const owner = actor(['basic', 'basic', 'basic']);
  const empty = actor([], 0);
  setPlayers([owner, empty]);
  await lib.skill.party_shanhetu_fencheng.content({ target: empty }, null, owner);
  assert.equal(empty.controls, 1);
  assert.deepEqual(empty.discards, []);
  assert.deepEqual(empty.damages, []);
});

test('焚城以当前手牌数的绝对差造成火伤，同量时不创建0伤害事件', async () => {
  const { lib, setPlayers } = await fixture();
  const owner = actor(['basic', 'basic']);
  const more = actor(['basic', 'basic', 'trick', 'trick', 'basic'], 1);
  const same = actor(['basic', 'trick'], 1);
  const empty = actor([], 1);
  setPlayers([more, same, owner, empty]);
  await lib.skill.party_shanhetu_fencheng.content({ target: more }, null, owner);
  assert.deepEqual(more.damages, [3]);
  assert.deepEqual(same.damages, []);
  assert.deepEqual(empty.damages, [2]);
  assert.deepEqual(more.discards, []);
  assert.equal(owner.controls, 0);
});

test('山河斗缠按体力上限逐张获得决斗，不足逐张加范围与出杀且不套普通版人数上限', async () => {
  const { lib, get } = await fixture();
  const cards = [
    { name: 'juedou', id: 1 },
    { name: 'juedou', id: 2 },
  ];
  get.cardPile2 = (filter: (card: any) => boolean) => cards.find(filter);
  let mark = 0;
  const gained: number[] = [];
  const player = {
    maxHp: 4,
    gain: async (card: any) => {
      gained.push(card.id);
      cards.splice(cards.indexOf(card), 1);
    },
    addMark: (id: string, count: number) => {
      assert.equal(id, 'party_shanhetu_douchan');
      mark += count;
    },
    countMark: () => mark,
  };
  const skill = lib.skill.party_shanhetu_douchan;
  await skill.content({}, null, player);
  assert.deepEqual(gained, [1, 2]);
  assert.equal(mark, 2);
  await skill.content({}, null, player);
  assert.equal(mark, 6);
  assert.equal(skill.mod.attackRange(player, 1), 7);
  assert.equal(skill.mod.cardUsable({ name: 'sha' }, player, 1), 7);
  assert.equal(skill.mod.cardUsable({ name: 'tao' }, player, 1), undefined);
});

test('山河狼袭可选体力不大于自身的其他角色，随机伤害只取1或2', async () => {
  const { lib, get, setPlayers } = await fixture();
  const owner: any = { hp: 4 },
    smaller = { hp: 3 },
    larger = { hp: 5 };
  setPlayers([owner, smaller, larger]);
  const skill = lib.skill.party_shanhetu_langxi;
  assert(skill.filter({}, owner));
  setPlayers([owner, larger]);
  assert.equal(skill.filter({}, owner), false);
  get.prompt2 = () => '狼袭';
  owner.chooseTarget = (
    prompt: string,
    filter: (card: null, player: any, target: any) => boolean,
  ) => {
    assert.equal(filter(null, owner, owner), false);
    assert.equal(filter(null, owner, smaller), true);
    assert.equal(filter(null, owner, larger), false);
    const action = {
      set: () => action,
      forResult: async () => ({ bool: true, targets: [smaller] }),
    };
    return action;
  };
  const cost: any = { skill: 'party_shanhetu_langxi' };
  await skill.cost(cost, null, owner);
  assert.equal(cost.result.targets[0], smaller);
  const damage: number[] = [];
  get.rand = (min: number, max: number) => {
    assert.equal(min, 1);
    assert.equal(max, 2);
    return damage.length ? 1 : 2;
  };
  const target = {
    damage: async (amount: number, source: any) => {
      assert.equal(source, owner);
      damage.push(amount);
    },
  };
  await skill.content({ targets: [target] }, null, owner);
  await skill.content({ targets: [target] }, null, owner);
  assert.deepEqual(damage, [2, 1]);
});

test('山河乱击可配不同花色的同色手牌，镇军不漏掉全场空手但有装备的准备阶段', async () => {
  const { lib, ui, setPlayers } = await fixture();
  const heart = { color: 'red', suit: 'heart' },
    diamond = { color: 'red', suit: 'diamond' };
  const spade = { color: 'black', suit: 'spade' };
  const luanji = lib.skill.party_shanhetu_luanji;
  assert(luanji.filterCard(heart));
  ui.selected.cards = [heart];
  assert(luanji.filterCard(diamond));
  assert.equal(luanji.filterCard(spade), false);
  const equipmentOnly = { countCards: (zone: string) => (zone === 'he' ? 1 : 0) };
  const empty = { countCards: () => 0 };
  setPlayers([empty, equipmentOnly]);
  assert(lib.skill.party_shanhetu_zhenjun.filter());
  setPlayers([empty]);
  assert.equal(lib.skill.party_shanhetu_zhenjun.filter(), false);
});

test('洛阳董卓的暴虐按其他群势力角色伤害触发，独立于房主和敌我阵营', async () => {
  const { lib } = await fixture();
  const skill = lib.skill.party_shanhetu_baonue;
  const dongzhuo = { group: 'qun', side: false };
  assert.equal(skill.zhuSkill, false);
  assert(skill.filter({ source: { group: 'qun', side: true }, num: 1 }, dongzhuo));
  assert(!skill.filter({ source: dongzhuo, num: 1 }, dongzhuo));
  assert(!skill.filter({ source: { group: 'wei' }, num: 1 }, dongzhuo));
  assert(!skill.filter({ source: { group: 'qun' }, num: 0 }, dongzhuo));
});
