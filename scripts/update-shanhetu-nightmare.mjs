// SPDX-License-Identifier: GPL-3.0-only
// Rebuild tier-four modifiers on the currently admitted S5 recipes after editing a lower tier.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { enemySource, sourceNumbers } from './shanhetu-enemy-source.mjs';

const root = new URL('../', import.meta.url);
const config = (path) => new URL('config/' + path, root);
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const write = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
async function frozen(name, digest) {
  const bytes = await readFile(
    new URL('.local/research/shanhetu-20261107/' + name + '.json', root),
  );
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  return JSON.parse(bytes);
}
const battles = await read(config('shanhetu-battles.json'));
const scenario = await read(config('shanhetu-scenario.json'));
const npc = await read(config('shanhetu-npc-skills.json'));
const cards = await read(config('shanhetu-cards.json'));
const research = await read(config('research/ol-shanhetu-2026-11.json'));
const data = (await frozen('official-hd_roguelike', battles.source.decodedSha256)).Root;
const spells = (await frozen('official-cha_spell', npc.sourceDecodedSha256)).GameSpells.spell;
const cardDefinitions = (await frozen('sys_playcard', cards.cardDefinitions.decodedSha256))
  .GamePlayCards.card;
const bossIds = [2640, 2641, 2642, 2643, 2684, 2685, 2686, 2687];
const tiers = [16, 17, 18, 19, 20];
const restoredBosses = [2651, 2653, 2655];
const admittedSkills = new Set([
  51, 719, 3084, 3382, 68, 76, 266, 282, 301, 374, 375, 411, 466, 604, 605, 665, 826, 852, 853, 875,
  939, 952, 1324, 3050, 3051, 3052, 3121, 3123, 3229, 3296, 3314, 3385, 3386, 3513, 14046, 14055,
  14060, 14069, 14075, 14122, 14128, 14206, 14207, 14208, 14210, 14211, 14212, 14213, 14214,
]);
const nativeSkills = {
  51: ['standard', 'tiandu'],
  719: ['refresh', 'reguicai'],
  3084: ['yingbian', 'weishu'],
  68: ['standard', 'lijian'],
  76: ['shenhua', 'hongyan'],
  282: ['sp', 'juesi'],
  301: ['extra', 'wushen'],
  374: ['sp', 'fuqi'],
  375: ['sp', 'jiaozi'],
  411: ['yijiang', 'huilei'],
  466: ['shenhua', 'buqu'],
  604: ['sp', 'tianming'],
  605: ['sp', 'mizhao'],
  826: ['shenhua', 'drlt_zhengu'],
  875: ['refresh', 'reluoshen'],
  952: ['sp', 'daoshu'],
  3051: ['xianding', 'dushi'],
  3121: ['sp', 'qiongshou'],
  3123: ['sp', 'olzhuiji'],
  3229: ['sp', 'rekenshang'],
};
const relatedPacks = { 3314: 'sp', 14210: 'shenhua', 14213: 'standard' };
const female = new Set(['马云騄', '巧笑董姬', '闭月仙伶']);
const shu = new Set(['马超', '马云騄']);
function addSkills(row, fields) {
  for (const key of fields) {
    for (const id of sourceNumbers(row[key])) {
      const previous = npc.skills.find((skill) => skill.id === id);
      const native = nativeSkills[id];
      if (previous) {
        if (native) {
          previous.nativeId = native[1];
          previous.implementation = 'native-' + native[0];
        }
        continue;
      }
      assert(admittedSkills.has(id), 'Unreviewed NPC skill ' + id);
      const spell = spells.find((skill) => skill.a === id);
      assert(spell?.o);
      npc.skills.push({
        id,
        nativeId:
          native?.[1] ?? (id === 939 ? 'party_shanhetu_paoxiao939' : 'party_shanhetu_nm_' + id),
        name: spell.c,
        description: spell.o
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]*>/g, '')
          .replaceAll('&nbsp;', ' ')
          .trim(),
        implementation: native ? 'native-' + native[0] : 'scenario-specific',
      });
    }
  }
}
const { enemyFacts, enemyBonus } = enemySource(npc, cardDefinitions, cards.cardDefinitions.suits);
const traits = (row) => ({
  group: shu.has(row.c) ? 'shu' : 'qun',
  sex: female.has(row.c) ? 'female' : 'male',
});
function bossForm(row) {
  addSkills(row, ['v', 'getspell_ZD', 'getspell_KN', 'getspell_EM']);
  return { ...enemyFacts(row, true, true, true), ...traits(row) };
}
for (const id of bossIds) {
  const fight = data.Fight.find((fight) => fight.fightID === id);
  const enemies = data.General.filter((row) => row.a === fight.Ggroup).map((row) => {
    const body = bossForm(row);
    if (row.w) {
      const [stage, count] = sourceNumbers(row.w);
      assert.equal(count, 1);
      const next = data.General.filter((item) => item.a === stage);
      assert.equal(next.length, 1);
      assert.equal(next[0].inStage, 2);
      body.nextForm = {
        sourceGroupId: stage,
        difficulties: tiers.filter((d) => sourceNumbers(row.CanStage).includes(d)),
        ...bossForm(next[0]),
      };
    }
    return body;
  });
  const recipe = {
    id,
    name: data.Text.find((row) => String(row.ID) === fight.name).text,
    groupId: fight.Ggroup,
    minimumDifficulty: 16,
    definitionPacks: [],
    enemies,
  };
  const index = battles.battles.findIndex((battle) => battle.id === id);
  if (index === -1) battles.battles.push(recipe);
  else battles.battles[index] = recipe;
}

for (const battle of battles.battles) {
  const restoreHard = restoredBosses.includes(battle.id);
  if (restoreHard) delete battle.maximumDifficulty;
  if (battle.id > 20000 || (battle.maximumDifficulty ?? 20) < 16) continue;
  const group = data.General.filter((row) => row.a === battle.groupId);
  assert.equal(battle.enemies.length, group.length);
  for (const [i, actor] of battle.enemies.entries()) {
    const row = group[i];
    const forms = [[actor, row]];
    if (actor.nextForm) {
      const form = actor.nextForm;
      const all = new Set([
        ...form.difficulties,
        ...sourceNumbers(row.CanStage).filter((d) => d <= 20 && (restoreHard || tiers.includes(d))),
      ]);
      const regions = scenario.regions.filter((region) =>
        region.regularBossIds.includes(battle.id),
      );
      const first = regions.length
        ? Math.min(...regions.map((region) => region.openDifficulty))
        : 2;
      form.difficulties = [...all]
        .filter((difficulty) => difficulty >= first)
        .sort((a, b) => a - b);
      forms.push([form, data.General.find((r) => r.a === form.sourceGroupId)]);
    }
    for (const [body, source] of forms) {
      assert.equal(source.b, body.generalId);
      if (restoreHard) {
        addSkills(source, ['getspell_KN']);
        const hard = enemyBonus(source, 'KN');
        if (Object.keys(hard).length) body.hard = hard;
      }
      addSkills(source, ['getspell_EM']);
      const bonus = enemyBonus(source, 'EM');
      if (Object.keys(bonus).length) body.nightmare = bonus;
      if (battle.id === 2653 && !battle.definitionPacks.includes('xianding')) {
        battle.definitionPacks.push('xianding');
      }
      const ids = [
        ...body.sourceSkills,
        ...[body.medium, body.hard, body.nightmare].flatMap((bonus) => bonus?.sourceSkills ?? []),
      ];
      for (const skillId of ids) {
        const skill = npc.skills.find((skill) => skill.id === skillId);
        const pack = skill.implementation.match(/^native-(.+)$/)?.[1];
        for (const dependency of [pack, relatedPacks[skillId]]) {
          if (dependency && !battle.definitionPacks.includes(dependency))
            battle.definitionPacks.push(dependency);
        }
      }
    }
  }
}
battles.source.scope =
  '普通1新手、普通2至5、中等、困难、噩梦各五档的已接入配方，含累计档级变化与第二形态。';
research.implementation.nightmareProgression = {
  difficultyIds: tiers,
  addedRegions: [3, 14],
  addedBossIds: bossIds,
  addedStageGroupIds: [268701],
  restoredUpperTierBossIds: restoredBosses,
  openingAnnouncement: 'https://www.sanguosha.com/news/20261014_1695_1010',
};
research.implementation.hardProgression.withheldBattleIds = [];
research.implementation.battleIds = battles.battles.map((battle) => battle.id);
research.implementation.npcSkillIds = npc.skills.map((skill) => skill.id);
await write(config('shanhetu-battles.json'), battles);
await write(config('shanhetu-npc-skills.json'), npc);
await write(config('research/ol-shanhetu-2026-11.json'), research);
