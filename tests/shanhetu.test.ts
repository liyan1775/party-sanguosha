// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import type { MatchSetup } from '../packages/noname-adapter/src/index.js';
import {
  prepareShanhetuBattle,
  sanitizeShanhetuResult,
} from '../packages/noname-adapter/src/shanhetu.js';

function setup(): MatchSetup {
  return {
    roomCode: 'ABCDEF',
    ownerPlayerId: 'owner',
    settings: {
      mode: 'identity',
      playerCount: 1,
      generalPreset: 'beginner',
      allowGeneralSelection: false,
      extensions: [],
    },
    seats: [{ id: 'owner', nickname: '真人', kind: 'human' }],
    aiPolicy: 'strongest-native',
    shanhetu: { runId: 'journey-1', nodeId: 'node-1', battleId: 22298, candidates: ['caocao'] },
  };
}
function result() {
  return {
    runId: 'journey-1',
    nodeId: 'node-1',
    battleId: 22298,
    outcome: 'victory',
    hero: { general: 'caocao', group: 'wei', hp: 2, maxHp: 4 },
    defeatedEnemies: 2,
  };
}

test('山河图敌军由固定遭遇生成，不改变报名席位或允许客户端传入阵容', () => {
  const input = setup();
  const prepared = prepareShanhetuBattle(input, ['caocao']);
  assert.equal(input.seats.length, 1);
  assert.equal(prepared.seats.length, 3);
  assert.equal(prepared.seats.filter((seat) => seat.kind === 'human').length, 1);
  assert.equal(prepared.ownerPlayerId, 'owner');
  assert.deepEqual(
    prepared.seats.slice(1).map((seat) => seat.nickname),
    ['沮授', '高干'],
  );
  for (const edit of [
    (value: MatchSetup) => {
      value.shanhetu!.battleId = 99999;
    },
    (value: MatchSetup) => {
      value.shanhetu!.difficulty = 16;
    },
    (value: MatchSetup) => {
      value.shanhetu!.candidates = ['unapproved'];
    },
    (value: MatchSetup) => {
      value.seats.push({ id: 'intruder', nickname: '别人', kind: 'human' });
    },
    (value: MatchSetup) => {
      value.seats[0]!.kind = 'bot';
    },
    (value: MatchSetup) => {
      value.ownerPlayerId = 'other';
    },
    (value: MatchSetup) => {
      value.shanhetu!.hero = { general: 'caocao', group: 'wei', hp: 5, maxHp: 4 };
    },
  ]) {
    const invalid = setup();
    edit(invalid);
    assert.throws(() => prepareShanhetuBattle(invalid, ['caocao']));
  }
  const ordinary = setup();
  delete ordinary.shanhetu;
  assert.equal(prepareShanhetuBattle(ordinary, []), ordinary);
});

test('PVE结算限定征程、节点及战斗；活着且敌军全灭才接受胜利', () => {
  const current = setup();
  for (const patch of [
    { runId: 'other-run' },
    { nodeId: 'old-node' },
    { battleId: 22498 },
    { defeatedEnemies: 1 },
    { defeatedEnemies: 3 },
    { outcome: 'anything' },
    { hero: { ...result().hero, hp: 0 } },
    { hero: { ...result().hero, general: 'unapproved' } },
    { hero: { ...result().hero, maxHp: Infinity } },
    { hero: { ...result().hero, group: '<img>' } },
    { outcome: 'defeat' },
  ])
    assert.equal(sanitizeShanhetuResult({ ...result(), ...patch }, current), null);
  assert.deepEqual(sanitizeShanhetuResult(result(), current), result());
  const defeat = {
    ...result(),
    outcome: 'defeat',
    defeatedEnemies: 0,
    hero: { ...result().hero, hp: -1 },
  };
  assert.deepEqual(sanitizeShanhetuResult(defeat, current), defeat);
});

test('原表帮手只扩充原生席位，禁止同一帮手的两个版本及未知编号', () => {
  const input = setup();
  input.shanhetu!.companionIds = [997103, 997011];
  const prepared = prepareShanhetuBattle(input, ['caocao']);
  assert.equal(input.seats.length, 1);
  assert.deepEqual(
    prepared.seats.slice(3).map(({ id, nickname, kind }) => [id, nickname, kind]),
    [
      ['shanhetu-companion-997103', '曹昂', 'bot'],
      ['shanhetu-companion-997011', '荀彧', 'bot'],
    ],
  );
  assert.deepEqual(sanitizeShanhetuResult(result(), prepared), result());
  for (const ids of [[997103, 997003], [997003, 997005, 997011, 997015, 997016], [997020]]) {
    input.shanhetu!.companionIds = ids;
    assert.throws(() => prepareShanhetuBattle(input, ['caocao']));
  }
});

test('战后摘要剥离原生状态及所有额外字段，不传播手牌或牌堆', () => {
  const incoming = {
    ...result(),
    hero: { ...result().hero, cards: ['secret'], storage: { private: true } },
    pile: ['secret'],
    native: { everything: true },
    token: 'secret',
  };
  assert.deepEqual(sanitizeShanhetuResult(incoming, setup()), result());
  assert.equal(sanitizeShanhetuResult(null, setup()), null);
  const ordinary = setup();
  delete ordinary.shanhetu;
  assert.equal(sanitizeShanhetuResult(incoming, ordinary), null);
});

test('征程成长仅接明确核对的技能／战法；负数、重复、超槽与未知ID拒绝', () => {
  const input = setup();
  input.shanhetu!.build = {
    initialCards: 2,
    draw: 1,
    armor: 2,
    extraSha: 0,
    handLimit: 3,
    skills: [3297],
    tactics: [2030, 2059, 2010],
    cards: [4062, 4062, 4004],
  };
  assert.equal(prepareShanhetuBattle(input, ['caocao']).seats.length, 3);
  for (const patch of [
    { skills: [3297, 3297] },
    { skills: [3001] },
    { skills: [3297, 3297, 3297, 3297] },
    { tactics: [9999] },
    { tactics: [2059, 2059] },
    { cards: [999999] },
    { cards: Array(101).fill(4062) },
    { cards: '4062' },
    { draw: -1 },
    { armor: NaN },
    { initialCards: 1000 },
  ]) {
    const invalid = structuredClone(input);
    Object.assign(invalid.shanhetu!.build!, patch);
    assert.throws(() => prepareShanhetuBattle(invalid, ['caocao']));
  }
});
