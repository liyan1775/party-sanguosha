// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const native = (id: number) => `party_shanhetu_nm_card_${id}`;
const source = await readFile(
  new URL('../packages/noname-adapter/runtime/shanhetu-nightmare-gear.js', import.meta.url),
  'utf8',
);

function fixture(ids: number[]) {
  const lib = {
    card: {} as Record<string, any>,
    skill: {} as Record<string, any>,
    translate: {},
    filter: {
      targetEnabled2: (_card: unknown, _actor: unknown, target: { allowed: boolean }) =>
        target.allowed,
      targetInRange: (_card: unknown, _actor: unknown, target: { inRange: boolean }) =>
        target.inRange,
    },
  };
  const registered: string[] = [];
  const records: string[] = [];
  const players: any[] = [];
  const game = {
    finishCard: (name: string) => registered.push(name),
    finishSkill(name: string) {
      lib.skill[name] = { ...lib.skill[lib.skill[name].inherit], ...lib.skill[name] };
    },
    log: () => {},
    hasNature: (card: { nature: string }, nature: string) => card.nature === nature,
    hasPlayer: (predicate: (actor: unknown) => boolean) => players.some(predicate),
    filterPlayer(predicate: (actor: unknown) => boolean) {
      const found = players.filter(predicate);
      return Object.assign(found, { randomGet: () => found[0] });
    },
    broadcastAll: (callback: (...args: any[]) => void, ...args: any[]) => callback(...args),
  };
  lib.skill.sanshou = {
    trigger: { player: 'damageBegin4' },
    content: (event: { invoked: boolean }) => (event.invoked = true),
  };
  const context = vm.createContext({
    lib,
    game,
    get: {
      attitude: () => -1,
      translation: () => '装备者',
      color: (card: { color: string }) => card.color,
      info: (skill: string) => (skill === 'internal' ? { charlotte: true } : {}),
      is: { locked: (skill: string) => skill === 'locked' },
    },
    record: (name: string) => records.push(name),
  });
  vm.runInContext(
    `Array.prototype.randomGet = function () { return this[0] };\n${source
      .replace(/^import .*;$/gm, '')
      .replace(
        /^export /gm,
        '',
      )}\ninstallNightmareGear(new Set(${JSON.stringify(ids.map(native))}), record)`,
    context,
  );
  return { lib, game, players, registered, records, context };
}

test('螭纹玉佩两种花色共用效果，满血且可改摸牌才加二，受伤时出牌阶段结束回血', async () => {
  const { lib, registered } = fixture([20846, 20847]);
  assert.deepEqual(registered, [20846, 20847].map(native));
  let recovered = 0;
  const healthy = { isHealthy: () => true, isDamaged: () => false };
  const hurt = { isHealthy: () => false, isDamaged: () => true, recover: () => recovered++ };
  for (const id of registered) {
    assert.equal(lib.card[id].subtype, 'equip5');
    const skill = lib.skill[id];
    assert.equal(skill.filter({ name: 'phaseUse' }, healthy), false);
    assert.equal(skill.filter({ name: 'phaseUse' }, hurt), true);
    assert.equal(skill.filter({ name: 'phaseDraw', numFixed: true }, healthy), false);
    assert.equal(skill.filter({ name: 'phaseDraw' }, hurt), false);
    const draw = { name: 'phaseDraw', num: 2 };
    assert.equal(skill.filter(draw, healthy), true);
    await skill.content({ name: id }, draw, healthy);
    assert.equal(draw.num, 4);
    await skill.content({ name: id }, { name: 'phaseUse' }, hurt);
  }
  assert.equal(recovered, 2);
});

test('三首作为独立防具复用同名原生技能的受伤时机和规则', async () => {
  const { lib, registered, records } = fixture([20776]);
  const id = native(20776);
  assert.deepEqual(registered, [id]);
  assert.equal(lib.card[id].subtype, 'equip2');
  assert.equal(lib.card[id].skills[0], id);
  assert.equal(lib.skill[id].equipSkill, true);
  assert.equal(lib.skill[id].trigger.player, 'damageBegin4');
  const event = { name: id, invoked: false };
  await lib.skill[id].content(event, {}, {});
  assert.equal(event.invoked, true);
  assert.deepEqual(records, [id]);
});

test('鸾凤和鸣剑只响应雷火杀，目标放弃弃牌才令装备者摸牌', async () => {
  const { lib } = fixture([20671]);
  const id = native(20671);
  const skill = lib.skill[id];
  assert.equal(lib.card[id].distance.attackFrom, -2);
  assert.equal(skill.filter({ card: { name: 'sha', nature: 'ice' } }), false);
  assert.equal(skill.filter({ card: { name: 'sha', nature: 'thunder' } }), true);
  assert.equal(skill.filter({ card: { name: 'sha', nature: 'fire' } }), true);
  let draws = 0;
  const picker = (bool: boolean) => ({
    chooseToDiscard: (position: string) => {
      assert.equal(position, 'he');
      return { forResult: async () => ({ bool }) };
    },
  });
  const user = { draw: async () => draws++ };
  await skill.content({ name: id }, { target: picker(true) }, user);
  await skill.content({ name: id }, { target: picker(false) }, user);
  assert.equal(draws, 1);
});

test('金乌落日弓需要本人出牌阶段单次失去两张以上手牌，弃置等量目标牌', async () => {
  const { lib, players } = fixture([20761]);
  const id = native(20761);
  const skill = lib.skill[id];
  assert.equal(lib.card[id].distance.attackFrom, -8);
  const victim = { countDiscardableCards: () => 3 };
  players.push(victim);
  const actor = {
    chooseTarget: () => {
      const choice = { set: () => choice, forResult: async () => ({ targets: [victim] }) };
      return choice;
    },
    logSkill: () => {},
    discardPlayerCard: (...args: unknown[]) => args,
  };
  const loss = (n: number, who: unknown) => ({
    getl: () => ({ hs: Array(n) }),
    getParent: () => ({ player: who }),
  });
  assert.equal(skill.filter(loss(1, actor), actor), false);
  assert.equal(skill.filter(loss(2, victim), actor), false);
  assert.equal(skill.filter(loss(4, actor), actor), false);
  assert.equal(skill.filter(loss(2, actor), actor), true);
  let discarded: unknown[] = [];
  actor.discardPlayerCard = (...args) => (discarded = args);
  await skill.content({ name: id }, loss(2, actor), actor);
  assert.deepEqual(discarded, [victim, 'he', 2, true]);
});

test('暗器飞刃只压制可见非锁定技，同一回合不重复压制同一目标，恢复只携带被压制技能', async () => {
  const { lib, context } = fixture([20861]);
  const id = native(20861);
  const skill = lib.skill[id];
  const status = `${id}_disabled`;
  let expires: unknown;
  const target = {
    storage: {} as Record<string, string[]>,
    disabledSkills: {} as Record<string, string[]>,
    getSkills: () => vm.runInContext("['locked', 'internal', 'normal']", context),
    addTempSkill: (_status: string, until: unknown) => (expires = until),
    disableSkill: (key: string, name: string) => (target.disabledSkills[name] = [key]),
    enableSkill: (key: string) => {
      assert.equal(key, status);
      delete target.disabledSkills.normal;
    },
  };
  const uses: { skill: string; targets: unknown[] }[] = [];
  const actor = {
    getHistory: (_kind: string, filter: (event: any) => boolean) => uses.filter(filter),
  };
  assert.equal(skill.filter({ player: target }, actor), true);
  await skill.content({ name: id }, { player: target });
  assert.deepEqual(target.disabledSkills, { normal: [status] });
  assert.equal((expires as { player: string }).player, 'phaseAfter');
  Object.assign(context, { target });
  const restored = vm.runInContext('collectNightmareGearState(target).join()', context);
  assert.equal(restored, 'normal');
  lib.skill[status].onremove(target, status);
  assert.deepEqual(target.disabledSkills, {});
  assert.equal(target.storage[status], undefined);
  lib.skill.normal = {};
  vm.runInContext('restoreNightmareGearState(target, ["normal", "missing"])', context);
  assert.deepEqual(target.disabledSkills, { normal: [status] });
  lib.skill[status].onremove(target, status);
  uses.push({ skill: id, targets: [target] });
  assert.equal(skill.filter({ player: target }, actor), false);
});

test('妖刀赤瞳只转移到合法且在攻击距离内的其他目标，替代目标不会重复判定', async () => {
  const { lib, players } = fixture([20876]);
  const id = native(20876);
  const skill = lib.skill[id];
  const original = { allowed: true, inRange: true };
  const far = { allowed: true, inRange: false };
  const invalid = { allowed: false, inRange: true };
  const legal = { allowed: true, inRange: true };
  const actor = {
    judge: () => ({ forResult: async () => ({ color: 'black' }) }),
    line: (target: unknown) => assert.equal(target, legal),
  };
  players.push(actor, original, far, invalid, legal);
  const use = {
    card: { name: 'sha', color: 'black' },
    targets: [original],
    triggeredTargets2: {
      remove: (target: unknown) => assert.equal(target, original),
    },
  };
  const trigger = { card: use.card, target: original, getParent: () => use };
  assert.equal(skill.filter(trigger), true);
  await skill.content({ name: id }, trigger, actor);
  assert.deepEqual(use.targets, [legal]);
  assert.equal(skill.filter({ ...trigger, target: legal }), false);
  const damage = lib.skill[`${id}_damage`];
  const hit = { card: use.card, notLink: () => true, num: 1 };
  assert.equal(damage.filter(hit), true);
  await damage.content({}, hit);
  assert.equal(hit.num, 2);
  assert.equal(damage.filter({ ...hit, notLink: () => false }), false);
});
