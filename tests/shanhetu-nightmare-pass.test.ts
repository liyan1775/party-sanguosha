// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function fixture() {
  const source = await readFile(
    new URL('../packages/noname-adapter/runtime/shanhetu-nightmare-pass.js', import.meta.url),
    'utf8',
  );
  const lib: any = {
    skill: {},
    translate: {},
    playerOL: {},
    filter: { cardDiscardable: () => true },
  };
  const game: any = { phaseNumber: 0 };
  const status: any = {};
  const get: any = {
    rand: () => 0,
    position: (card: any) => card.zone,
    color: (card: any) => card.color,
    suit: (card: any) => card.suit,
    prompt2: () => '',
  };
  const helpers = vm.runInNewContext(
    source.replace(/^import .*;$/gm, '').replace(/^export /gm, '') +
      '\ninstallNightmarePassSkills(() => {}); [collectNightmarePassState, restoreNightmarePassState]',
    { lib, game, get, _status: status },
  );
  return {
    lib,
    get,
    status,
    helpers,
    skill: (id: string | number) => lib.skill['party_shanhetu_nm_' + id],
  };
}

function choice(result: object) {
  return {
    set() {
      return this;
    },
    async forResult() {
      return result;
    },
  };
}

test('凶镬的三种处置只执行抽中的一项，杀绝只取仍在处理区或弃牌堆的致伤牌', async () => {
  const { get, skill } = await fixture();
  const owner: any = {
    marks: 0,
    gained: [] as any[],
    countMark() {
      return this.marks;
    },
    addMark(id: string, count: number) {
      this.marks += count;
    },
    async gain(cards: any[]) {
      this.gained = [...cards];
    },
  };
  const target: any = {
    hp: 0,
    flag: 1,
    damageCount: 0,
    lost: 0,
    countMark() {
      return this.flag;
    },
    hasMark() {
      return this.flag > 0;
    },
    addMark() {},
    addTempSkill() {},
    markAuto() {},
    removeMark() {
      this.flag = 0;
    },
    getCards(zone: string) {
      return { randomGet: () => zone };
    },
    async damage() {
      this.damageCount++;
    },
    async loseHp() {
      this.lost++;
    },
  };
  await skill('852_start').content({}, {}, owner);
  assert.equal(owner.marks, 3);
  for (const roll of [0, 1, 2]) {
    get.rand = () => roll;
    target.flag = 1;
    assert(skill('852_resolve').filter({ player: target }, owner));
    await skill('852_resolve').content({}, { player: target }, owner);
    assert.equal(target.flag, 0);
  }
  assert.equal(target.damageCount, 1);
  assert.equal(target.lost, 1);
  assert.deepEqual(owner.gained, ['h', 'e']);
  assert(!skill(853).filter({ player: target }, owner));
  target.hp = -1;
  assert(skill(853).filter({ player: target }, owner));
  owner.marks = 2;
  const cause = { name: 'damage', cards: [{ zone: 'o' }, { zone: 'd' }, { zone: 'h' }] };
  await skill(853).content({ name: '杀绝' }, { getParent: () => cause }, owner);
  assert.equal(owner.marks, 3);
  assert.deepEqual(owner.gained, cause.cards.slice(0, 2));
});

test('函谷关铁骑完整弃置同色牌可响应，凤魄只按目标方片手牌增加首次杀或决斗的效果', async () => {
  const { skill, status } = await fixture();
  const cards = [
    { color: 'red', suit: 'diamond' },
    { color: 'black', suit: 'club' },
    { color: 'red', suit: 'heart' },
  ];
  const actor: any = {
    judge: () => choice({ color: 'red' }),
    chooseControl: () => choice({ control: '增加伤害', index: 1 }),
    logSkill() {},
  };
  let spent: any[] = [],
    pay = true;
  const target: any = {
    hp: 3,
    addTempSkill() {},
    getCards: (_zone: string, filter: any) => cards.filter(filter),
    countCards: (zone: string, filter: any) => (zone === 'h' ? cards.filter(filter).length : 0),
    chooseBool: () => choice({ bool: pay }),
    discard: async (chosen: any[]) => {
      spent = chosen;
    },
  };
  const use = { card: { name: 'sha' }, directHit: new Set(), baseDamage: 1 };
  const trigger = { card: use.card, target, targets: [target], getParent: () => use };
  await skill(14122).content({}, trigger, actor);
  assert.deepEqual(spent, [cards[0], cards[2]]);
  assert.equal(use.directHit.size, 0);
  pay = false;
  await skill(14122).content({}, trigger, actor);
  assert(use.directHit.has(target));
  status.currentPhase = actor;
  actor.getHistory = () => [use];
  assert(skill(266).filter(trigger, actor));
  await skill(266).content({}, trigger, actor);
  assert.equal(use.baseDamage, 2);
  actor.getHistory = () => [{ card: { name: 'juedou' } }, use];
  assert(!skill(266).filter(trigger, actor));
});

test('诗怨按体力的三档分别计次，余威只在其他群雄的回合提高上限', async () => {
  const { skill, status } = await fixture();
  const actor: any = {
    hp: 3,
    storage: {},
    drawn: [] as number[],
    hasSkill: () => true,
    addTempSkill() {},
    async draw(number: number) {
      this.drawn.push(number);
    },
  };
  const other = { hp: 1, group: 'wei' };
  status.currentPhase = other;
  for (const hp of [1, 3, 5]) {
    other.hp = hp;
    assert(skill(3050).filter({ player: other }, actor));
    await skill(3050).content({}, { player: other }, actor);
    assert(!skill(3050).filter({ player: other }, actor));
  }
  other.group = 'qun';
  assert(skill(3050).filter({ player: other }, actor));
  await skill(3050).content({}, { player: other }, actor);
  assert.deepEqual(actor.drawn, [1, 2, 3, 3]);
  assert(!skill(3050).filter({ player: other }, actor));
  for (const [id, threshold] of [
    [3385, 5],
    [3386, 8],
  ] as const) {
    assert(!skill(id).filter({}, { hp: threshold, isDamaged: () => true }));
    assert(skill(id).filter({}, { hp: threshold - 1, isDamaged: () => true }));
  }
});
