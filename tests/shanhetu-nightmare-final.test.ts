// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function fixture() {
  const source = await readFile(
    new URL('../packages/noname-adapter/runtime/shanhetu-nightmare-final.js', import.meta.url),
    'utf8',
  );
  const lib: any = { skill: {}, translate: {} };
  const game: any = { players: [], dead: [], roundNumber: 1 };
  const ui: any = { discardPile: {}, selected: { buttons: [] } };
  const get: any = {
    color: (card: any) => card.color,
    suit: (card: any) => card.suit,
    position: (card: any) => card.position,
    type: (card: any) => card.type,
    translation: (input: any) => String(input),
    attitude: () => -1,
  };
  const uses: string[] = [];
  const projection = vm.runInNewContext(
    source.replace(/^import .*;$/gm, '').replace(/^export /gm, '') +
      '\ninstallNightmareFinalSkills(record); ({collect:collectNightmareFinalState,restore:restoreNightmareFinalState});',
    { lib, game, ui, get, record: (use: string) => uses.push(use) },
  );
  return { lib, game, ui, get, uses, projection, skill: (id: number) => lib.skill['party_shanhetu_nm_' + id] };
}

test('终章恢复只处理当前演员受规则改变的公开技能，不改同名普通武将',async()=>{
  const {projection}=await fixture();
  function actor(ids:string[]) {
    const skills=new Set(ids);
    const storage:Record<string,number>={};
    return {skills,storage,hasSkill:(id:string)=>skills.has(id),addSkill:(id:string)=>skills.add(id),
      addTempSkill:(id:string)=>skills.add(id),removeSkill:(id:string)=>skills.delete(id),
      countMark:(id:string)=>storage[id]??0,markSkill(){},unmarkSkill(){}};
  }
  const prefix='party_shanhetu_nm_';
  const drunk={skills:[prefix+14210,'benghuai']};
  const changed=actor([prefix+14210,'zaiqi',prefix+14209]);
  const summary=projection.collect(changed,drunk);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)),{silenced:true,lostBenghuai:true,zaiqi:true});
  const mirror=actor(drunk.skills);projection.restore(mirror,summary,drunk);
  assert.deepEqual([...mirror.skills].sort(),[...changed.skills].sort());
  const soul={skills:[prefix+14214,'benghuai']};
  const transformed=actor(soul.skills);transformed.storage[prefix+14214]=3;
  const angry=projection.collect(transformed,soul);
  assert.deepEqual(JSON.parse(JSON.stringify(angry)),{rage:3});
  projection.restore(mirror,angry,soul);assert.equal(mirror.storage[prefix+14214],3);
  const hero=actor(['benghuai','liuli']);
  projection.restore(hero,summary,undefined);
  assert(hero.skills.has('benghuai'));assert(hero.skills.has('liuli'));assert(!hero.skills.has('zaiqi'));
});

function selection(result: any) {
  return {
    set() {
      return this;
    },
    forResult: async () => result,
  };
}

test('观变计算实际人数，首轮结束或发动凶逆、封赏后失去；凶逆需要交足五张同花色牌', async () => {
  const { skill, game } = await fixture();
  game.players = [1, 2, 3];
  game.dead = [4];
  assert.equal(skill(3513).mod.globalTo({}, {}, 2), 6);
  assert.equal(skill(3513).mod.globalFrom({}, {}, 2), 6);
  assert.equal(skill(3513).mod.maxHandcard({}, 5), 9);
  assert(skill(3513).filter({}, {}, 'roundEnd'));
  game.roundNumber = 2;
  assert(!skill(3513).filter({}, {}, 'roundEnd'));
  for (const id of [14206, 14207])
    assert(skill(3513).trigger.player.includes('party_shanhetu_nm_' + id + 'After'));
  const players = [true, false].map((pays) => ({
    hpLost: 0,
    isIn: () => true,
    chooseToDiscard(zone: string, count: number) {
      assert.equal(zone, 'he');
      assert.equal(count, 5);
      return selection({ bool: pays });
    },
    async loseMaxHp() {
      this.hpLost++;
    },
  }));
  game.filterPlayer = () => Object.assign(players, { sortBySeat: () => players });
  await skill(14206).content({ cards: [{ suit: 'heart' }] }, null, {});
  assert.deepEqual(
    players.map((p) => p.hpLost),
    [0, 1],
  );
});

test('封赏只取本回合仍在弃牌堆的同花色牌，出牌次数和濒死触发独立', async () => {
  const { skill, game, ui, get } = await fixture();
  const cards = [
    { suit: 'heart', position: 'd' },
    { suit: 'heart', position: 'd' },
    { suit: 'spade', position: 'd' },
    { suit: 'club', position: 'h' },
  ];
  game.checkGlobalHistory = (type: string, fn: Function) => {
    assert.equal(type, 'cardMove');
    fn({ name: 'lose', position: ui.discardPile, cards });
    fn({ name: 'cardsDiscard', cards: [cards[0]] });
    fn({ name: 'lose', position: {}, cards: [{}] });
  };
  const owner: any = {
    hasSkill: () => true,
    chooseButtonTarget(options: any) {
      assert.equal(options.createDialog[1].length, 3);
      ui.selected.buttons = [{ link: cards[0] }];
      assert(options.filterButton({ link: cards[1] }));
      assert(!options.filterButton({ link: cards[2] }));
      return selection({ bool: true, links: cards.slice(0, 2), targets: [beneficiary] });
    },
    addTempSkill(id: string) {
      calls.push(id);
    },
    hasUseTarget: () => true,
    async chooseUseTarget(wine: any, forced: boolean, addCount: boolean) {
      assert.equal(wine.name, 'jiu');
      assert(forced);
      assert.equal(addCount, false);
      calls.push('jiu');
    },
  };
  let beneficiary: any = owner;
  const calls: string[] = [];
  owner.gain = async (gained: any[]) => {
    assert.equal(gained.length, 2);
    calls.push('gain');
  };
  assert(!skill(14207).filter({ name: 'chooseToUse' }, owner));
  assert(skill(14207).filter({ name: 'dying' }, owner));
  await skill(14207).content({}, null, owner);
  assert.deepEqual(calls, ['party_shanhetu_nm_14207_used', 'gain']);
  calls.length = 0;
  beneficiary = { gain: owner.gain };
  await skill(14207).content({}, { name: 'dying' }, owner);
  assert.deepEqual(calls, ['gain', 'jiu']);
  assert.equal(get.position(cards[3]), 'h');
});

test('执柄按同一角色本回合第3、6、9张黑牌触发，止息保留打出操作', async () => {
  const { skill } = await fixture();
  const black: any[] = [];
  const triggered: number[] = [];
  const effects: any[] = [];
  const user = {
    getHistory: (_type: string, filter: Function) => black.filter((use) => filter(use)),
    loseHp: () => effects.push('lose'),
    addTempSkill: (id: string, until: string) => effects.push([id, until]),
  };
  const lord = {
    countCards: () => 13,
    chooseToDiscard: (zone: string, n: number, forced: boolean) => effects.push([zone, n, forced]),
  };
  for (let n = 1; n <= 12; n++) {
    const use = { player: user, card: { color: 'black' } };
    black.push(use);
    if (skill(14208).filter(use, lord)) {
      triggered.push(n);
      await skill(14208).content({}, use, lord);
    }
  }
  assert.deepEqual(triggered, [3, 6, 9]);
  assert.deepEqual(effects, ['lose', ['h', 4, true], ['party_shanhetu_nm_14209', 'phaseAfter']]);
  assert(!skill(14208).filter(black[2], user));
  assert(!skill(14209).mod.cardEnabled());
  assert(!skill(14209).mod.cardSavable());
  assert.equal(skill(14209).mod.cardRespondable, undefined);
  let drawn = 0;
  await skill(14208).content({}, black[5], {
    countCards: () => 7,
    draw: (n: number) => {
      drawn = n;
    },
  });
  assert.equal(drawn, 2);
});

test('酒池判黑色手牌与酒杀伤害；肉林对双方的杀累加闪数；闭月按手牌和上限处理', async () => {
  const { skill } = await fixture();
  const owner: any = { hasSkill: (id: string) => id === 'benghuai' };
  assert.equal(skill(14210).filterCard({ color: 'black' }, owner), true);
  assert.equal(skill(14210).filterCard({ color: 'red' }, owner), false);
  assert.equal(skill(14210).mod.cardUsable({ name: 'jiu' }), Infinity);
  const transform = skill(14210).subSkill.change;
  const hit = { card: { name: 'sha' }, getParent: () => ({ jiu: true }) };
  assert(transform.filter(hit, owner));
  assert(!transform.filter({ ...hit, getParent: () => ({ jiu: false }) }, owner));
  owner.changeSkills = (add: string[], remove: string[]) => {
    assert.equal(add[0], 'zaiqi');
    assert.equal(remove[0], 'benghuai');
  };
  await transform.content({}, hit, owner);
  const target = { playerid: 'victim' },
    args: any = {};
  const use = {
    card: { name: 'sha' },
    player: owner,
    target,
    getParent: () => ({ customArgs: args }),
  };
  assert(skill(14211).filter(use));
  await skill(14211).content({}, use);
  assert.equal(args.victim.shanRequired, 2);
  await skill(14211).content({}, use);
  assert.equal(args.victim.shanRequired, 3);
  let hand = 0;
  const details: any[] = [];
  const moon = {
    countCards: () => hand,
    getHandcardLimit: () => 7,
    drawTo: (n: number) => details.push(n),
    addTempSkill: (id: string, until: any) => details.push([id, until.player]),
  };
  await skill(14213).content({}, null, moon);
  hand = 2;
  await skill(14213).content({}, null, moon);
  assert.deepEqual(details, [7, ['liuli', 'phaseBeginStart']]);
});

test('连诛用目标当前体力；利驭用实际取得的牌数设定决斗基础伤害；神怒每次受伤只增一枚', async () => {
  const { skill, game } = await fixture();
  const transfers: number[] = [];
  const owner: any = { async give() {}, draw: (n: number) => transfers.push(n) };
  const target: any = {
    hp: 3,
    chooseToDiscard: (zone: string, n: number) => {
      assert.equal(n, 3);
      return selection({ bool: false });
    },
  };
  await skill(14212).content({ target, cards: [{ color: 'red' }] }, null, owner);
  await skill(14212).content({ target, cards: [{ color: 'black' }] }, null, owner);
  assert.deepEqual(transfers, [3]);
  let cards = [{ type: 'equip' }, { type: 'basic' }],
    duelDamage = 0,
    victimDraws = 0;
  let move: any;
  owner.gain = (list: any[], from: any, mode: string) => {
    assert.equal(mode, 'giveAuto');
    return (move = { cards: list });
  };
  owner.getHistory = (_type: string, filter: Function) => (filter(move) ? [move] : []);
  owner.useCard = () => ({
    set: (key: string, n: number) => {
      assert.equal(key, 'baseDamage');
      duelDamage = n;
    },
  });
  const victim = {
    countGainableCards: (_owner: any, zone: string) => (zone === 'h' ? cards.length : 0),
    getGainableCards: () => cards,
    isIn: () => true,
    draw: () => victimDraws++,
    chooseTarget: () => selection({ bool: true, targets: [{}] }),
  };
  game.hasPlayer = () => true;
  await skill(14128).content({}, { player: victim }, owner);
  assert.equal(duelDamage, 2);
  cards = [{ type: 'basic' }];
  await skill(14128).content({}, { player: victim }, owner);
  assert.equal(victimDraws, 1);
  let rage = 0;
  const soul = {
    countMark: () => rage,
    addMark: (_id: string, n: number) => (rage += n),
    removeMark: (_id: string, n: number) => (rage -= n),
    draw: (n: number) => transfers.push(n),
  };
  const injury = { num: 3, source: { hp: 2 } };
  assert.equal(skill(14214).trigger.player, 'damage');
  await skill(14214).content({ triggername: 'damage' }, injury, soul);
  await skill(14214).content({ triggername: 'damage' }, { num: 4 }, soul);
  assert.deepEqual(transfers, [3, 2]);
  assert.equal(rage, 2);
  const outgoing = { num: 1 };
  await skill(14214).content({ triggername: 'damageBegin1' }, outgoing, soul);
  assert.equal(outgoing.num, 3);
  assert.equal(rage, 2);
  await skill(14214).content({ triggername: 'damageSource' }, outgoing, soul);
  assert.equal(rage, 0);
});
