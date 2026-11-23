// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { enemySource, sourceNumbers } from './shanhetu-enemy-source.mjs';

const config = (name) => new URL('../config/shanhetu-' + name + '.json', import.meta.url);
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const battles = await read(config('battles'));
const cards = await read(config('cards'));
const npc = await read(config('npc-skills'));
async function frozen(name, sha) {
  const file = await readFile(
    new URL('../.local/research/shanhetu-20261107/' + name + '.json', import.meta.url),
  );
  assert.equal(createHash('sha256').update(file).digest('hex'), sha);
  return JSON.parse(file);
}
const data = (await frozen('official-hd_roguelike', battles.source.decodedSha256)).Root;
const spells = (await frozen('official-cha_spell', npc.sourceDecodedSha256)).GameSpells.spell;
const cardDefinitions = (await frozen('sys_playcard', cards.cardDefinitions.decodedSha256))
  .GamePlayCards.card;
const native = {
  231: ['sp', 'naman'],
  1238: ['sp2', 'xinfu_dianhu'],
  406: ['yijiang', 'zhichi'],
  830: ['shenhua', 'drlt_xiongluan'],
  3189: ['refresh', 'reweimu'],
  3190: ['refresh', 'reluanwu'],
  9019: ['refresh', 'rewansha'],
};
const custom = new Set([
  354, 3150, 3379, 14052, 14057, 14062, 14071, 14101, 14109, 14112, 14131, 14132,
]);
function skill(id) {
  let item = npc.skills.find((entry) => entry.id === id);
  if (item) {
    if (native[id])
      [item.implementation, item.nativeId] = ['native-' + native[id][0], native[id][1]];
    return item;
  }
  const source = spells.find((entry) => entry.a === id);
  assert(source?.o && (native[id] || custom.has(id)), 'Unreviewed NPC skill ' + id);
  const [pack, nativeId] = native[id] ?? [];
  item = {
    id,
    nativeId: nativeId ?? 'party_shanhetu_ly_' + id,
    name: source.c,
    description: source.o
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replaceAll('&nbsp;', ' ')
      .trim(),
    implementation: pack ? 'native-' + pack : 'scenario-specific',
  };
  npc.skills.push(item);
  return item;
}
function equipment(id, nativeId) {
  const card = cardDefinitions.find((entry) => entry.a === id);
  assert(card?.c === 3);
  return {
    id,
    name: card.b,
    nativeId,
    suit: cards.cardDefinitions.suits[card.g],
    number: card.f,
    range: card.h,
    spellId: card.m,
    ...(card.d === 2 ? { subtype: 'equip2' } : {}),
  };
}
const { enemyFacts } = enemySource(npc, cardDefinitions, cards.cardDefinitions.suits);
const bossIds = [2635, 22635, 2669, 22669];
const info = {
  307: { reinforcement: 'dragon-guard', nativePortrait: 'huanggai' },
  458: {},
  587: { reinforcement: 'dragon-guard', nativePortrait: 'xusheng' },
  484: { nativePortrait: 'jiaxu' },
  415: { reinforcement: 'spearman', nativePortrait: 'zhangxiu' },
};
for (const id of bossIds) {
  const fight = data.Fight.find((entry) => entry.fightID === id);
  const rows = data.General.filter((row) => row.a === fight.Ggroup);
  // Put the spearman before Jia Xu in the turn order so that the takeover
  // cannot also grant the next ordinary phase when it begins on Jia Xu's turn.
  if (id === 2669 || id === 22669) rows.reverse();
  const enemies = rows.map((row) => {
    for (const suffix of ['v', 'getspell_ZD', 'getspell_KN', 'getspell_EM']) {
      for (const id of sourceNumbers(row[suffix])) skill(id);
    }
    const body = {
      ...enemyFacts({ ...row, equip_ZD: undefined }, id < 20000, id < 20000, id < 20000),
      ...info[row.b],
      group: row.a === 2635 || row.a === 22635 ? 'wu' : 'qun',
      sex: 'male',
    };
    if (id < 20000 && row.equip_ZD) {
      const equipId = Number(row.equip_ZD);
      assert([20631, 20632, 20633].includes(equipId));
      body.medium = { ...body.medium, equipment: [equipment(equipId, 'guilongzhanyuedao')] };
    }
    return body;
  });
  const recipe = {
    id,
    name: data.Text.find((row) => String(row.ID) === fight.name).text,
    groupId: fight.Ggroup,
    ...(id > 20000 ? { maximumDifficulty: 1 } : {}),
    definitionPacks: [],
    enemies,
  };
  const index = battles.battles.findIndex((entry) => entry.id === id);
  if (index < 0) battles.battles.push(recipe);
  else battles.battles[index] = recipe;
}

function inferno(row) {
  const bonus = {};
  const attributes = {
    hp: 'hp',
    maxhp: 'maxHp',
    exshatimes: 'extraSha',
    getarmor: 'armorRecovery',
  };
  for (const entry of String(row.att_LY ?? '')
    .split(';')
    .filter(Boolean)) {
    const [name, raw] = entry.split(',');
    assert(attributes[name] && Number.isSafeInteger(Number(raw)), 'Unreviewed NPC stat ' + name);
    bonus[attributes[name]] = Number(raw);
  }
  const ids = sourceNumbers(row.getspell_LY);
  if (ids.length) {
    bonus.skills = ids.map((id) => skill(id).nativeId);
    bonus.sourceSkills = ids;
  }
  const removed = [...String(row.getspell_LY ?? '').matchAll(/_(\d+)/g)].map((match) =>
    Number(match[1]),
  );
  if (removed.length) bonus.removeSourceSkills = removed;
  if (row.equip_LY) {
    assert.equal(row.equip_LY, '20746');
    bonus.equipment = [equipment(20746, 'huxinjing')];
  }
  return bonus;
}
for (const battle of battles.battles) {
  const rows = data.General.filter((row) => row.a === battle.groupId);
  const packs = new Set(battle.definitionPacks);
  for (const form of battle.enemies) {
    const row = rows.find((row) => row.b === form.generalId && row.c === form.name);
    assert(row, battle.id + ' ' + form.name);
    if (battle.id < 20000 && !(battle.maximumDifficulty < 21)) {
      const bonus = inferno(row);
      if (Object.keys(bonus).length) form.inferno = bonus;
      if (form.nextForm) {
        const { nextForm } = form;
        nextForm.difficulties = [
          ...new Set([
            ...nextForm.difficulties,
            ...sourceNumbers(row.CanStage).filter((id) => id >= 21 && id <= 25),
          ]),
        ];
        const next = data.General.find((row) => row.a === nextForm.sourceGroupId);
        assert.equal(next.b, nextForm.generalId);
        const stageBonus = inferno(next);
        if (Object.keys(stageBonus).length) nextForm.inferno = stageBonus;
      }
    }
    for (const body of form.nextForm ? [form, form.nextForm] : [form]) {
      for (const id of [
        ...body.sourceSkills,
        ...[body.medium, body.hard, body.nightmare, body.inferno].flatMap(
          (bonus) => bonus?.sourceSkills ?? [],
        ),
      ]) {
        const pack = skill(id).implementation.match(/^native-(.+)$/)?.[1];
        if (pack) packs.add(pack);
      }
    }
  }
  battle.definitionPacks = [...packs];
}
battles.source.scope = '普通至炼狱各五档配方，含累计档级变化、第二形态及固定席位援军。';
for (const [name, value] of [
  ['battles', battles],
  ['npc-skills', npc],
]) {
  await writeFile(config(name), JSON.stringify(value, null, 2) + '\n');
}
