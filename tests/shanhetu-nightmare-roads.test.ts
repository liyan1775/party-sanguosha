// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function fixture() {
  const source = await readFile(
    new URL('../packages/noname-adapter/runtime/shanhetu-nightmare-roads.js', import.meta.url),
    'utf8',
  );
  const lib: any = { skill: {}, translate: {}, playerOL: {} };
  const game: any = {
    broadcastAll: (fn: Function, ...args: any[]) => fn(...args),
    broadcast: () => {},
    checkMod: () => 'unchanged',
  };
  const get: any = {
    autoViewAs: (card: any) => card,
    type2: (card: any) => card.type,
    suit: (card: any) => card.suit,
    damageEffect: () => -1,
  };
  const api = vm.runInNewContext(
    source.replace(/^import .*;$/gm, '').replace(/^export /gm, '') +
      '\ninstallNightmareRoadSkills(()=>{}); ({collect:collectNightmareRoadState,restore:restoreNightmareRoadState});',
    { lib, game, get },
  );
  function actor(id: string) {
    const player: any = {
      playerid: id,
      storage: {},
      skills: [],
      awakenedSkills: [],
      hasSkill: (key: string) => player.skills.includes(key),
      getStorage: (key: string) => player.storage[key] ?? [],
      countMark: (key: string) => player.storage[key] ?? 0,
      addMark: (key: string, n: number) => {
        player.storage[key] = (player.storage[key] ?? 0) + n;
      },
      removeMark: (key: string, n: number) => {
        player.storage[key] -= n;
      },
      addSkill: (key: string) => {
        if (!player.skills.includes(key)) player.skills.push(key);
      },
      markSkill: () => {},
      isIn: () => true,
      removeSkill: (key: string) => {
        player.skills = player.skills.filter((id: string) => id !== key);
        delete player.storage[key];
      },
    };
    return (lib.playerOL[id] = player);
  }
  return {
    game,
    get,
    lib,
    api,
    actor,
    skill: (id: number, extra = '') => lib.skill['party_shanhetu_nm_' + id + extra],
  };
}
const choice = (result: any) => ({
  set() {
    return this;
  },
  forResult: async () => result,
});
const plain = (value: any) => JSON.parse(JSON.stringify(value));

test('动荡让张燕紧接正在执行的回合，调度器收尾后先于已有额外回合', async () => {
  const { actor, skill } = await fixture();
  const zhang = actor('zhang');
  const previousExtra = { name: 'phase', skill: 'pending-extra' };
  const next: object[] = [];
  let jumped = -1;
  const activePhase = {
    parent: { next },
    phaseList: ['phaseDraw', 'phaseUse', 'phaseDiscard'],
    num: 1,
    goto: (step: number) => (jumped = step),
  };
  next.push(activePhase, previousExtra);
  const activeUse = { all_excluded: false };
  const activeAction = { skipped: false };
  const parents: Record<string, unknown> = {
    phase: activePhase,
    useCard: activeUse,
    phaseUse: activeAction,
  };
  const stage = { getParent: (name: string) => parents[name] };
  zhang.insertPhase = (skill: string, first: boolean) => {
    const inserted = { name: 'phase', player: zhang, skill };
    if (first) next.unshift(inserted);
    else next.push(inserted);
    return inserted;
  };
  const runningTurn = next[0];
  await skill(3382).content({}, stage, zhang);
  assert.equal(activeUse.all_excluded, true);
  assert.equal(activeAction.skipped, true);
  assert.equal(activePhase.num, activePhase.phaseList.length);
  assert.equal(jumped, 11);
  // The pinned scheduler consumes its initial next[0] only after awaiting it.
  assert.equal(next.shift(), runningTurn);
  assert.deepEqual(next, [
    { name: 'phase', player: zhang, skill: 'party_shanhetu_nm_3382' },
    previousExtra,
  ]);
});

test('独立来源的咒雪与铁炮分别按座位和使用者回合消退，公开恢复不带牌', async () => {
  const { actor, skill, api } = await fixture();
  const one = actor('one'),
    two = actor('two'),
    victim = actor('victim'),
    attacker = actor('enemy');
  const ice = skill(14060),
    seal = skill(14060, '_seal');
  await ice.content({}, { player: victim }, one);
  await ice.content({}, { player: victim }, two);
  await ice.content({}, { player: victim }, two);
  assert.deepEqual(plain(api.collect(victim)), {
    snow: [
      ['one', 1],
      ['two', 1],
    ],
  });
  assert(seal.filter({ player: two }, victim));
  assert(!seal.filter({ player: attacker }, victim));
  assert.equal(seal.mod.maxHandcardFinal(victim, 10), 0);
  assert(seal.subSkill.armor.filter({ num: 1 }));
  assert(!seal.subSkill.armor.filter({ num: -1 }));
  await seal.content({}, { player: one }, victim);
  assert.deepEqual(plain(api.collect(victim)), { snow: [['two', 1]] });
  const mirror = actor('mirror');
  api.restore(mirror, api.collect(victim));
  assert.deepEqual(plain(api.collect(mirror)), { snow: [['two', 1]] });
  await seal.content({}, { player: two }, victim);
  assert.equal(api.collect(victim), undefined);
  api.restore(mirror, undefined);
  assert.equal(api.collect(mirror), undefined);
  const counter = skill(14075),
    range = skill(14075, '_distance');
  let hit = true;
  for (const shooter of [one, one, two]) {
    let used: any;
    shooter.canUse = () => true;
    shooter.useCard = (card: any) => (used = { card });
    shooter.hasHistory = (_type: string, correct: Function) =>
      hit && correct({ card: used.card, getParent: () => used });
    await counter.content({ cards: [{}] }, { source: victim }, shooter);
  }
  hit = false;
  await counter.content({ cards: [{}] }, { source: victim }, one);
  assert.equal(range.mod.globalFrom(victim, one, 2), 4);
  assert.equal(range.mod.globalFrom(victim, two, 2), 3);
  assert.equal(range.mod.globalFrom(victim, attacker, 2), 2);
  await range.content({}, { player: one }, victim);
  assert.equal(range.mod.globalFrom(victim, one, 2), 2);
  assert.equal(range.mod.globalFrom(victim, two, 2), 3);
});

test('恶臭按牌叠蛇毒，准备阶段消一枚；恶意仅给满血开局的第一张杀', async () => {
  const { actor, skill, game } = await fixture();
  const owner = actor('owner'),
    victim = actor('victim');
  const odor = skill(1324),
    poison = skill(1324, '_snake');
  assert(!odor.filter({ player: owner, card: { name: 'tao' } }, owner));
  for (const name of ['tao', 'jiu']) {
    const use = { player: victim, card: { name } };
    assert(odor.filter(use, owner));
    await odor.content({}, use);
  }
  const key = 'party_shanhetu_nm_1324_snake';
  let cost = 0,
    loss = 0;
  victim.chooseToDiscard = (_zone: string, count: number) => {
    cost = count;
    return choice({ bool: count === 1 });
  };
  victim.loseHp = (n: number) => (loss += n);
  await poison.content({}, null, victim);
  assert.equal(cost, 2);
  assert.equal(loss, 2);
  assert.equal(victim.countMark(key), 1);
  await poison.content({}, null, victim);
  assert.equal(cost, 1);
  assert.equal(loss, 2);
  assert(!victim.hasSkill(key));
  const evil = skill(3296),
    ready = skill(3296, '_ready');
  owner.hp = 3;
  owner.maxHp = 4;
  assert(!evil.filter({}, owner));
  owner.hp = 4;
  assert(evil.filter({}, owner));
  owner.addTempSkill = owner.addSkill;
  await evil.content({}, null, owner);
  owner.hp = 2;
  game.players = [owner, victim];
  assert(ready.filter({ card: { name: 'sha' } }));
  assert(!ready.filter({ card: { name: 'juedou' } }));
  let direct: any[] = [];
  await ready.content(
    {},
    {
      directHit: {
        addArray: (targets: any[]) => {
          direct = targets;
        },
      },
    },
    owner,
  );
  assert(direct.includes(victim));
  assert(!owner.hasSkill('party_shanhetu_nm_3296_ready'));
});

test('藏心受伤先公开展示三张牌，按实际弃置红桃减伤，摸牌阶段单独摸取', async () => {
  const { actor, skill, game, get, lib } = await fixture();
  const cards = [{ suit: 'heart' }, { suit: 'heart' }, { suit: 'club' }];
  const order: string[] = [];
  const owner = actor('owner');
  get.bottomCards = (n: number, keep: boolean) => {
    assert.equal(n, 3);
    assert(keep);
    return cards;
  };
  lib.skill.olcangxin = { filter: (event: any) => event.first };
  const hidden = skill(3314);
  assert(!hidden.filter({ first: false }, owner, 'damageBegin4'));
  owner.showCards = (revealed: any[]) => {
    assert.equal(revealed, cards);
    order.push('show');
  };
  owner.chooseButton = () => {
    order.push('choose');
    return choice({ bool: true, links: [cards[0], cards[2]] });
  };
  game.cardsDiscard = (discarded: any[]) => {
    assert.equal(discarded.length, 2);
    order.push('discard');
  };
  const damage = { num: 3 };
  await hidden.content({ triggername: 'damageBegin4' }, damage, owner);
  assert.deepEqual(order, ['show', 'choose', 'discard']);
  assert.equal(damage.num, 2);
  owner.draw = (n: number) => order.push('draw' + n);
  await hidden.content({ triggername: 'phaseDrawBegin' }, null, owner);
  assert.deepEqual(order.slice(-2), ['show', 'draw2']);
});

test('双魂仅有存活友方时复位，逞凶按轮次，篡朝仅排除该目标并切换阴阳', async () => {
  const { actor, skill, game } = await fixture();
  const owner = actor('owner'),
    ally = actor('ally');
  const name = 'party_shanhetu_nm_14046';
  owner.hp = 0;
  owner.maxHp = 7;
  owner.side = ally.side = true;
  const events: any[] = [];
  let living = [owner, ally];
  game.hasPlayer = (filter: Function) => living.some((x) => filter(x));
  owner.awakenSkill = (id: string) => owner.awakenedSkills.push(id);
  owner.restoreSkill = () => {
    owner.awakenedSkills = [];
  };
  owner.isLinked = owner.isTurnedOver = () => true;
  owner.link = owner.turnOver = (state: boolean) => events.push(state);
  owner.recoverTo = owner.drawTo = (n: number) => events.push(n);
  assert(skill(14046).filter({}, owner));
  await skill(14046).content({}, null, owner);
  assert.deepEqual(events, [false, false, 7, 7]);
  assert(!owner.awakenedSkills.includes(name));
  living = [owner];
  await skill(14046).content({}, null, owner);
  assert(!skill(14046).filter({}, owner));
  const hit = { num: 1 };
  game.roundNumber = 1;
  await skill(14055).content({}, hit);
  assert.equal(hit.num, 2);
  game.roundNumber = 2;
  await skill(14055).content({}, hit);
  assert.equal(hit.num, 1);
  game.roundNumber = 0;
  assert(!skill(14055).filter(hit));
  const excluded: any[] = [];
  const use = {
    excluded: Object.assign(excluded, { add: (target: any) => excluded.push(target) }),
  };
  const card = { type: 'basic' };
  const trigger = { card, getParent: () => use };
  const conversion = skill(14069);
  owner.changeZhuanhuanji = (id: string) => {
    owner.storage[id] = !owner.storage[id];
  };
  assert(conversion.filter(trigger, owner));
  await conversion.content({}, trigger, owner);
  assert(excluded.includes(owner));
  assert(!excluded.includes(ally));
  assert(!conversion.filter(trigger, owner));
  excluded.length = 0;
  card.type = 'trick';
  assert(conversion.filter(trigger, owner));
  await conversion.content({}, trigger, owner);
  assert(!owner.storage.party_shanhetu_nm_14069);
});
