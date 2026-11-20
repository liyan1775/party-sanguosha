import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  prepareCardPile,
  validateCardPile,
  shanhetuCardPile,
} from '../packages/noname-adapter/runtime/card-pile.js';

const presets = JSON.parse(
  await readFile(new URL('../config/roster-presets.json', import.meta.url), 'utf8'),
).presets;
const inventory = JSON.parse(
  await readFile(new URL('../config/native-card-inventory.json', import.meta.url), 'utf8'),
);
function nativeTemplate(preset: any): any {
  const entries = inventory.packs
    .filter((pack: any) => preset.cardPile.packs.includes(pack.id))
    .flatMap((pack: any) => pack.cards)
    .flatMap((card: any) =>
      Array.from({ length: card.count }, () => ['spade', 1, card.id, card.nature]),
    );
  return {
    config: { cards: [...preset.cardPile.packs] },
    card: { ...Object.fromEntries(entries.map((card: any) => [card[2], {}])), list: entries },
  };
}

test('所有将池按批准的108/160组合构造；去木牛保留原生规则及其他模板条目', () => {
  for (const preset of presets) {
    const lib = nativeTemplate(preset);
    const original = [...lib.card.list];
    const definitions = lib.card.jiu;
    prepareCardPile(lib, preset);
    assert.equal(lib.card.list.length, preset.id === 'beginner' ? 108 : 160);
    assert.equal(
      lib.card.list.some((card: any) => card[2] === 'muniu'),
      false,
    );
    assert.equal(
      lib.card.list.some((card: any) => card[2] === 'jiu'),
      preset.id !== 'beginner',
    );
    assert(lib.card.list.every((card: any) => original.includes(card)));
    assert.equal(lib.card.jiu, definitions);
    prepareCardPile(lib, preset);
    assert.equal(lib.card.list.length, preset.cardPile.cardCount);
  }
});

test('未经确认的牌包、木牛或张数、缺失定义拒绝开局', () => {
  const preset = presets.find((item: any) => item.id === 'advanced');
  for (const patch of [
    { packs: ['standard', 'extra', 'zhulu'] },
    { excludedCards: [] },
    { cardCount: 161 },
  ])
    assert.throws(
      () => validateCardPile({ ...preset, cardPile: { ...preset.cardPile, ...patch } }),
      /不一致/,
    );
  assert.throws(() => validateCardPile({ ...preset, cardPile: undefined }), /缺少/);
  assert.throws(
    () => validateCardPile({ ...preset, definitionPacks: { cards: ['standard'] } }),
    /定义包/,
  );
  for (const failure of ['count', 'definition', 'enabled-pack']) {
    const lib = nativeTemplate(preset);
    if (failure === 'count') lib.card.list.pop();
    if (failure === 'definition') delete lib.card.huogong;
    if (failure === 'enabled-pack') lib.config.cards = ['standard'];
    const before = lib.card.list;
    assert.throws(() => prepareCardPile(lib, preset), /不符合|未载入|不一致/);
    assert.equal(lib.card.list, before, '失败时不改原模板');
  }
});

test('山河图独立牌堆不随武将档位变化，保留军争基本牌并删除全部装备', () => {
  for (const original of presets) {
    const preset = {
      ...original,
      ruleset: 'shanhetu-s5',
      cardPile: structuredClone(shanhetuCardPile),
      definitionPacks: { ...original.definitionPacks, cards: ['standard', 'extra'] },
    };
    const lib = nativeTemplate(preset);
    const entries = [...lib.card.list];
    for (const id of shanhetuCardPile.excludedCards) lib.card[id].type = 'equip';
    prepareCardPile(lib, preset);
    assert.equal(lib.card.list.length, 135);
    assert(lib.card.list.every((card: any) => lib.card[card[2]].type !== 'equip'));
    assert(lib.card.list.some((card: any) => card[2] === 'jiu'));
    assert(lib.card.list.some((card: any) => card[2] === 'sha' && card[3] === 'fire'));
    assert(lib.card.list.some((card: any) => card[2] === 'sha' && card[3] === 'thunder'));
    assert(lib.card.list.every((card: any) => entries.includes(card)));
    prepareCardPile(lib, preset);
    assert.equal(lib.card.list.length, 135);
    assert.equal(original.cardPile.cardCount, original.id === 'beginner' ? 108 : 160);
    assert.throws(() => validateCardPile({ ...preset, ruleset: undefined }), /不一致/);
    assert.throws(() => validateCardPile({ ...preset, ruleset: 'unknown' }), /未经确认/);
    const invalid = nativeTemplate(preset);
    invalid.card.sha.type = 'equip';
    const before = invalid.card.list;
    assert.throws(() => prepareCardPile(invalid, preset), /不得包含装备/);
    assert.equal(invalid.card.list, before);
  }
});
