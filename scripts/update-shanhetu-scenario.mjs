// SPDX-License-Identifier: GPL-3.0-only
// Curated scenario integration catalog. No script is run at startup.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(
  resolve(root, '.local/research/shanhetu-20261107/official-hd_roguelike.json'),
);
const sha = createHash('sha256').update(source).digest('hex');
assert.equal(sha, '0e116ac3091748127e104878e01daddaf6cdb847d5b4f2cafa836a4223accca2');
const data = JSON.parse(source).Root;
const spellSource = await readFile(
  resolve(root, '.local/research/shanhetu-20261107/official-cha_spell.json'),
);
assert.equal(
  createHash('sha256').update(spellSource).digest('hex'),
  '0286c6c209ae91ecaac29d3f2e31c985a7c8a11c0423066ec0d1c97ab7b5536b',
);
const spells = JSON.parse(spellSource).GameSpells.spell;
const recipes = JSON.parse(
  await readFile(resolve(root, 'config/shanhetu-battles.json'), 'utf8'),
).battles;
const text = (value) =>
  String(data.Text.find((row) => String(row.ID) === String(value))?.text ?? value)
    .replace(/<[^>]*>/g, '')
    .trim();
const difficulties = data.DifficultySelection.filter(
  (row) => Number(row.seasonID) === 5 && row.isopen === 1 && row.bdif <= 3,
).map((row) => ({
  id: row.difID,
  name: row.sdifname,
  tier: row.bdif,
  prerequisite: row.preID ?? null,
  unlockText: row.unlockdesc?.split('\n')[0] ?? '',
  description: row.bdesc ?? '',
  preserveHp: row.hpsave === 1,
  enemyHp: row.hp,
  enemyCards: row.cardnum,
  enemyDraw: row.draw,
  enemyExtraSha: row.skill,
  enemyArmor: row.armor,
  enemyArmorRecovery: row.getarmor,
  albums: row.reward2,
}));
const chapters = data.Chapter.filter(
  (row) => row.seasonID === 5 && row.openDiff <= difficulties.at(-1).id,
);
// The client keys EnemyGrowth by elapsed month and exact difficulty.
const monthlyGrowth = Object.fromEntries(
  [0, ...difficulties.map((rule) => rule.id)].map((id) => [
    id,
    data.EnemyGrowth.filter((row) => row.diffnum === id).map((row, index) => {
      assert.equal(row.moon, index);
      assert(!row.hp1 && !row.draw1 && !row.otherad);
      return [row.hp, Number(row.cardnum), row.draw, row.exshatimes, row.armor, row.getarmor];
    }),
  ]),
);
const chapterGrowth = Object.fromEntries(
  [1, 2, 3].map((tier) => [
    tier,
    data.EnemyDiffGrowth.filter((row) => row.diffnum === tier).map((row, index) => {
      assert.equal(row.chap, index + 1);
      assert(!row.otherad);
      return [row.hp, row.cardnum, row.draw, row.exshatimes, row.armor ?? 0, row.getarmor ?? 0];
    }),
  ]),
);
const enemyCountRates = Object.fromEntries(
  [1, 2, 3].map((rank) => [
    rank,
    Object.fromEntries(
      data.EnemyNumGrowth.filter((row) => Number(row.type) === rank).map((row) => [
        row.num,
        [row.hp, row.cardnum, row.draw, row.exshatimes, row.armor, row.getarmor],
      ]),
    ),
  ]),
);
const regions = chapters.map((row) => {
  const locations = String(row.location)
    .split(';')
    .map(Number)
    .map((id) => {
      const level = data.Level.find((level) => level.cityID === id);
      const [x, y] = level.citycoordinate.split(',').map(Number);
      return { id, x, y, poolId: level.universalfight ?? null };
    });
  const pool = data.UniversalGroup.filter((item) => item.fightID === locations[0].poolId);
  const battleIds = recipes
    .filter((battle) => battle.id > 20000 && pool.some((item) => item.fightgroup === battle.id))
    .map((battle) => battle.id);
  const regularBattleIds = recipes
    .filter((battle) => battle.id < 20000 && pool.some((item) => item.fightgroup === battle.id))
    .map((battle) => battle.id);
  if (row.openDiff === 1) assert(battleIds.length);
  assert(regularBattleIds.length);
  const bossLocation = data.Level.find((level) => level.cityID === row.bosslocation);
  const terrain = Number(bossLocation.scenespell) || null;
  assert(
    locations.every(({ id }) => {
      const level = data.Level.find((level) => level.cityID === id);
      return (Number(level.scenespell) || null) === terrain && !level.spellTarget;
    }),
  );
  const sourceBossIds = bossLocation.eventfight.split(';').map(Number);
  const regularBossIds = sourceBossIds.filter(
    (id) => id < 20000 && recipes.some((recipe) => recipe.id === id),
  );
  const bossIds =
    row.openDiff === 1
      ? regularBossIds.map((id) => data.Fight.find((fight) => fight.fightID === id).NewbieGroup)
      : [];
  assert(regularBossIds.length);
  const supportedOnHard = (id) =>
    (recipes.find((recipe) => recipe.id === id).maximumDifficulty ?? 15) >= 15;
  const hardBossIds = regularBossIds.filter(supportedOnHard);
  const hardBattleIds = regularBattleIds.filter(supportedOnHard);
  assert(hardBossIds.length && hardBattleIds.length, `Incomplete hard route ${row.chaptername}`);
  assert(
    bossIds.every((id) => sourceBossIds.includes(id) && recipes.some((recipe) => recipe.id === id)),
  );
  return {
    id: row.uniqueID,
    name: row.chaptername,
    chapter: row.chapter,
    openDifficulty: row.openDiff,
    terrain,
    bossAt: data.ChapterCS.find(
      (chapter) => Number(chapter.seasonID) === 5 && chapter.chapter === row.chapter,
    ).apptime,
    next: String(row.canGoTo ?? '')
      .split(';')
      .map(Number)
      .filter((id) => chapters.some((chapter) => chapter.uniqueID === id)),
    bossIds,
    battleIds,
    regularBossIds,
    regularBattleIds,
    hardBossIds,
    hardBattleIds,
    locations,
  };
});
const battleIds = new Set(
  regions.flatMap((region) => [
    ...region.battleIds,
    ...region.bossIds,
    ...region.regularBattleIds,
    ...region.regularBossIds,
  ]),
);
const combatEvents = [1269, 1273].map((id) => {
  const row = data.Adventure.find((event) => event.ID === id);
  const options = [1, 2, 3].map((index) => {
    const effect = data.Choose.find((choice) => choice.effectID === row[`effect${index}`]);
    assert(!effect.losttype && !effect.lostitem);
    const option = { id: effect.effectID, label: text(row[`option${index}`]) };
    if (effect.type === 7) {
      const fight = data.Fight.find((item) => item.fightID === Number(effect.event1));
      for (const fightId of [fight.fightID, fight.NewbieGroup]) {
        assert(
          recipes.some((recipe) => recipe.id === fightId),
          'Missing decision encounter',
        );
        battleIds.add(fightId);
      }
      return { ...option, fight: fight.fightID, noviceFight: fight.NewbieGroup, coins: 0 };
    }
    assert(effect.type === 1 && effect.gettype === '1' && effect.getitem === '1000');
    return { ...option, fight: null, noviceFight: null, coins: Number(effect.getnum) };
  });
  return {
    id,
    name: text(row.chapname),
    duration: row.duration,
    poolIds: data.UniversalGroup.filter((pool) => pool.premisegroup === id).map(
      (pool) => pool.fightID,
    ),
    options,
  };
});
const choiceFights = new Set(
  combatEvents.flatMap((event) =>
    event.options.flatMap((option) => [option.fight, option.noviceFight]).filter(Boolean),
  ),
);
const fights = [...battleIds].map((id) => {
  const row = data.Fight.find((row) => row.fightID === id);
  const boss = regions.some((region) => [...region.bossIds, ...region.regularBossIds].includes(id));
  return {
    id,
    enemyRank: boss ? 1 : row.iselite ? 2 : 3,
    name: text(row.name),
    description: choiceFights.has(id)
      ? `迎战${recipes
          .find((recipe) => recipe.id === id)
          .enemies.map((enemy) => enemy.name)
          .join('、')}`
      : text(String(row.text).split(';')[0]),
    coins: row.itemgroup ?? 0,
    rewardGroups: String(row.reward ?? '')
      .split(';')
      .map(Number)
      .filter(Boolean),
    unlockSkillSlot: row.rewarditem === '1007',
  };
});
const events = [1798, 1799, 1900, 1928, 1929, 1930, 1951, 1952, 1953, 1956, 1957].map((id) => {
  const row = data.Adventure.find((row) => row.ID === id);
  const options = [1, 2, 3].map((index) => {
    const effect = data.Choose.find((choice) => choice.effectID === row[`effect${index}`]);
    assert.equal(effect.type, 1);
    assert(['1', '2'].includes(effect.gettype));
    assert(!effect.losttype && !effect.lostitem, 'Costs need explicit review');
    return {
      id: effect.effectID,
      label: text(row[`option${index}`]),
      rewardGroup: effect.gettype === '2' ? Number(effect.getitem) : null,
      coins: effect.gettype === '1' && effect.getitem === '1000' ? Number(effect.getnum) : 0,
    };
  });
  return {
    id,
    name: text(row.chapname),
    description: text(row.text),
    duration: row.duration,
    poolIds: data.UniversalGroup.filter((pool) => pool.premisegroup === id).map(
      (pool) => pool.fightID,
    ),
    options,
  };
});
const rewardIds = new Set([
  ...fights.flatMap((fight) => fight.rewardGroups),
  ...events.flatMap((event) => event.options.map((option) => option.rewardGroup).filter(Boolean)),
]);
const rewardGroups = [...rewardIds].map((id) => {
  const row = data.RewardGroup.find((row) => row.reward === id);
  assert(row);
  return {
    id,
    name: row.rewarddesc,
    category: Number(row.type),
    rarities: row.allreward.split(',').map(Number),
    count: row.pra1,
    allowSkip: row.type !== '4',
    skipCoins: row.abandonmoney ?? 0,
    random: row.random,
  };
});
const output = {
  schemaVersion: 1,
  status: 'internal-normal-medium-hard-map-integration',
  sourceDecodedSha256: sha,
  scenarioId: 5,
  name: '诸侯伐董',
  difficulties,
  monthlyGrowth,
  chapterGrowth,
  enemyCountRates,
  terrainDifficulty: Number(data.Common[0].scenespellneeddiff),
  terrains: [...new Set(regions.map((region) => region.terrain).filter((id) => id !== null))]
    .sort((left, right) => left - right)
    .map((id) => {
      const spell = spells.find((row) => row.a === id);
      return { id, name: spell.c, description: spell.o };
    }),
  victoryRecovery: { battle: 1, boss: 2 },
  initialRegions: [2, 4],
  chapterThresholds: [4, 6, 7],
  restart: { limit: data.Common[0].reopen, waitSeconds: data.Common[0].surrendertime },
  localSampling: {
    scope:
      '城间连边、门槛、地点坐标和内容原表直接核对；城内分配及抽样属于接入策略，尚非官方服务器随机实现',
    layout: ['battle', 'event', 'battle', 'event', 'battle', 'event', 'camp', 'boss'],
    recruitmentIndex: 3,
    battleDays: 1,
    openingBattleGate: true,
    shopUnlockDay: 3,
    shopDuration: 0,
    weights: '已接入且属于当前城池的配方内均匀抽样；不以其他城敌人代替',
    exclusions:
      '未接入的完整遭遇、隐藏属性／结局、其他队友、山河册后续节点与高难度仍须继续；不推定公开空条件表的含义',
  },
  shop: { itemCount: 4, nextPriceIncrease: 100, freeRefreshes: 1, refreshPrice: 100 },
  camp: [
    {
      id: 1,
      name: '体力上限+1',
      description: '体力上限+1且回复等量体力',
      effect: 'max-hp',
      amount: 1,
    },
    {
      id: 5,
      name: '摸牌阶段摸牌+1',
      description: '此后每场战斗摸牌阶段多摸1张',
      effect: 'draw',
      amount: 1,
    },
  ],
  regions,
  fights,
  events,
  combatEvents,
  rewardGroups,
};
await writeFile(
  resolve(root, 'config/shanhetu-scenario.json'),
  JSON.stringify(output, null, 2) + '\n',
);
console.log(
  `Curated campaign map: ${regions.length} regions, ${fights.length} fights, ${events.length} events`,
);
