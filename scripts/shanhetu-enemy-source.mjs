// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';

export const sourceNumbers = (value) =>
  String(value ?? '')
    .split(';')
    .map(Number)
    .filter(Boolean);
const knownEquipment = {
  20511: 'qinggang',
  20521: 'zhangba',
  20671: 'party_shanhetu_nm_card_20671',
  20761: 'party_shanhetu_nm_card_20761',
  20846: 'party_shanhetu_nm_card_20846',
  20847: 'party_shanhetu_nm_card_20847',
  20861: 'party_shanhetu_nm_card_20861',
  20876: 'party_shanhetu_nm_card_20876',
  20546: 'fangtian',
  20666: 'chixueqingfeng',
  20611: 'wushuangfangtianji',
  20656: 'party_shanhetu_inferno_halberd',
  20871: 'party_shanhetu_soul_cutter',
  20766: 'party_shanhetu_xingtian_axe',
  20856: 'party_shanhetu_thunder_blade',
  20616: 'shufazijinguan',
  20636: 'guofengyupao',
  20836: 'party_shanhetu_duanhun',
  20501: 'zhuge',
  20571: 'baiyin',
  20618: 'shufazijinguan',
  20621: 'hongmianbaihuapao',
  20626: 'linglongshimandai',
  20631: 'guilongzhanyuedao',
  20641: 'party_shanhetu_fire_lute',
  20661: 'xuwangzhimian',
  20721: 'heiguangkai',
  20722: 'heiguangkai',
  20723: 'heiguangkai',
  20741: 'sanlve',
  20841: 'party_shanhetu_kunlun_mirror',
  20866: 'party_shanhetu_iron_guard',
};
export function enemySource(npcSkills, cardDefinitions, suits) {
  function enemyEquipment(value) {
    const slots = { 1: 'equip1', 2: 'equip2', 9: 'equip5' };
    return sourceNumbers(value).map((id) => {
      const card = cardDefinitions.find((card) => card.a === id);
      const nativeId = knownEquipment[id];
      assert(
        card && nativeId && card.c === 3 && slots[card.d],
        `Starting NPC equipment ${id} needs review`,
      );
      return {
        id,
        name: card.b,
        nativeId,
        suit: suits[card.g],
        number: card.f,
        range: card.h,
        spellId: card.m,
        ...(card.d === 1 ? {} : { subtype: slots[card.d] }),
      };
    });
  }
  function enemySkillIds(ids) {
    return ids.map((id) => {
      const skill = npcSkills.skills.find((skill) => skill.id === id);
      assert.ok(skill, `NPC skill ${id} requires review`);
      return skill.nativeId;
    });
  }
  function enemyBonus(row, suffix) {
    const outcome = {};
    const fields = { hp: 'hp', maxhp: 'maxHp', cardnum: 'startingCards', draw: 'draw' };
    for (const entry of String(row[`att_${suffix}`] ?? '')
      .split(';')
      .filter(Boolean)) {
      const [key, value] = entry.split(',');
      assert(fields[key] && Number.isSafeInteger(Number(value)));
      outcome[fields[key]] = Number(value);
    }
    const skillString = row[`getspell_${suffix}`];
    const added = sourceNumbers(skillString);
    if (added.length) {
      outcome.skills = enemySkillIds(added);
      outcome.sourceSkills = added;
    }
    const removed = String(skillString ?? '')
      .split(';')
      .filter((id) => id.startsWith('_'))
      .map((id) => Number(id.slice(1)));
    if (removed.length) outcome.removeSourceSkills = removed;
    const equipment = enemyEquipment(row[`equip_${suffix}`]);
    if (equipment.length) outcome.equipment = equipment;
    const hand = sourceNumbers(row[`carddesc_${suffix}`]).map((id) => {
      const card = cardDefinitions.find((card) => card.a === id);
      assert([20811, 20812].includes(id) && card?.c === 1 && card.m === 1);
      return {
        id,
        name: card.b,
        nativeId: 'sha',
        suit: suits[card.g],
        number: card.f,
      };
    });
    if (hand.length) outcome.hand = hand;
    assert(!row[`getzhanfa_${suffix}`]);
    return outcome;
  }
  function enemyFacts(row, includeMedium, includeHard, includeNightmare) {
    assert.ok(!row.s || row.s === '0', 'Starting enemy hand needs explicit review');
    assert.equal(row.n, 0, 'Native NPC base armor recovery needs review');
    assert.equal(row.o, 5, 'Native NPC armor recovery cap differs');
    const equipment = enemyEquipment(row.t);
    const sourceSkills = sourceNumbers(row.v);
    assert.deepEqual(enemyBonus(row, 'PT'), {});
    for (const chapter of [2, 3]) {
      for (const field of ['getcard', 'getspell', 'getequip']) assert(!row[field + '_' + chapter]);
    }
    const medium = includeMedium ? enemyBonus(row, 'ZD') : {};
    const hard = includeHard ? enemyBonus(row, 'KN') : {};
    const nightmare = includeNightmare ? enemyBonus(row, 'EM') : {};
    return {
      generalId: row.b,
      name: row.c,
      hp: row.k,
      maxHp: row.l,
      armor: row.m,
      draw: row.p,
      startingCards: row.q,
      extraSha: row.r,
      skills: enemySkillIds(sourceSkills),
      sourceSkills,
      ...(equipment.length ? { fixedEquipment: equipment } : {}),
      ...(Object.keys(medium).length ? { medium } : {}),
      ...(Object.keys(hard).length ? { hard } : {}),
      ...(Object.keys(nightmare).length ? { nightmare } : {}),
    };
  }
  return { enemyFacts, enemyBonus };
}
