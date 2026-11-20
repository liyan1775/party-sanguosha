// SPDX-License-Identifier: GPL-3.0-only
// Inspect frozen public client configuration without running client JavaScript.
import { enemySource, sourceNumbers } from './shanhetu-enemy-source.mjs';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, gunzipSync, inflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = resolve(root, process.argv[2] ?? '.local/research/shanhetu-20261107');
const research = JSON.parse(
  await readFile(resolve(root, 'config/research/ol-shanhetu-2026-11.json'), 'utf8'),
);
const reference = research.officialArchiveInspection;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const verify = (bytes, expected, label) => {
  assert.equal(bytes.length, expected.bytes, `${label}: unexpected size`);
  assert.equal(hash(bytes), expected.sha256, `${label}: frozen version mismatch`);
};
async function archive(source, filename, expectedUrl) {
  assert.equal(source.url, expectedUrl);
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(source.bytes) && source.bytes <= 8 * 1024 * 1024);
  const filenameOnDisk = resolve(folder, filename);
  let cached;
  try {
    cached = await readFile(filenameOnDisk);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (cached) {
    verify(cached, source, filename);
    return cached;
  }
  const response = await fetch(source.url, {
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok || !response.body) throw new Error(`${filename}: HTTP ${response.status}`);
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > source.bytes) throw new Error(`${filename}: upstream version changed`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  verify(bytes, source, filename);
  await writeFile(filenameOnDisk, bytes, { flag: 'wx' });
  return bytes;
}

// Read a named ZIP entry in memory. No archive path is ever extracted to disk.
// The fixed archives use a single disk, standard central directory and deflate.
function member(zip, name, maximumBytes) {
  const within = (offset, length) => {
    assert.ok(
      Number.isSafeInteger(offset) && offset >= 0 && offset + length <= zip.length,
      'ZIP range outside archive',
    );
  };
  let end = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65557); offset--) {
    if (
      zip.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + zip.readUInt16LE(offset + 20) === zip.length
    ) {
      end = offset;
      break;
    }
  }
  assert.ok(end >= 0, 'ZIP end record missing');
  assert.equal(zip.readUInt16LE(end + 4), 0, 'Multi-disk ZIP unsupported');
  assert.equal(zip.readUInt16LE(end + 6), 0, 'Multi-disk ZIP unsupported');
  const count = zip.readUInt16LE(end + 10);
  assert.equal(zip.readUInt16LE(end + 8), count);
  assert.ok(count > 0 && count < 65535, 'ZIP64 or empty archive unsupported');
  const centralSize = zip.readUInt32LE(end + 12);
  let cursor = zip.readUInt32LE(end + 16);
  const centralEnd = cursor + centralSize;
  within(cursor, centralSize);
  assert.ok(centralEnd <= end);
  let result;
  for (let index = 0; index < count; index++) {
    within(cursor, 46);
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const length = 46 + nameLength + extraLength + commentLength;
    within(cursor, length);
    assert.ok(cursor + length <= centralEnd);
    const entryName = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (entryName === name) {
      assert.equal(result, undefined, 'Duplicate named ZIP entry');
      const flags = zip.readUInt16LE(cursor + 8);
      assert.equal(flags & 1, 0, 'Encrypted ZIP entry unsupported');
      const method = zip.readUInt16LE(cursor + 10);
      const compressedSize = zip.readUInt32LE(cursor + 20);
      const size = zip.readUInt32LE(cursor + 24);
      assert.ok(size > 0 && size <= maximumBytes, 'ZIP member exceeds inspection bound');
      const local = zip.readUInt32LE(cursor + 42);
      within(local, 30);
      assert.equal(zip.readUInt32LE(local), 0x04034b50);
      assert.equal(zip.readUInt16LE(local + 6) & 1, 0);
      assert.equal(zip.readUInt16LE(local + 8), method);
      const localNameLength = zip.readUInt16LE(local + 26);
      const localExtraLength = zip.readUInt16LE(local + 28);
      within(local + 30, localNameLength + localExtraLength);
      assert.equal(zip.subarray(local + 30, local + 30 + localNameLength).toString('utf8'), name);
      const start = local + 30 + localNameLength + localExtraLength;
      within(start, compressedSize);
      assert.ok(start + compressedSize <= centralEnd);
      const compressed = zip.subarray(start, start + compressedSize);
      assert.ok(method === 0 || method === 8, 'Unsupported ZIP compression');
      result =
        method === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength: size });
      assert.equal(result.length, size);
      assert.equal(crc32(result), zip.readUInt32LE(cursor + 16), 'ZIP CRC mismatch');
    }
    cursor += length;
  }
  assert.equal(cursor, centralEnd);
  assert.ok(result, `ZIP member ${name} missing`);
  return result;
}

await mkdir(folder, { recursive: true });
const configArchive = await archive(
  reference,
  'ol-Config.sgs',
  'https://web.sanguosha.com/220/h5_2/res/config/Config.sgs',
);
const clientArchive = await archive(
  reference.client,
  'ol-sgsGame_a.sgs',
  'https://web.sanguosha.com/220/h5_2/sgsGame_a.sgs',
);
assert.equal(reference.zipMember, 'hd_roguelike.sgs');
assert.equal(reference.client.zipMember, 'sgsGame_a.sgs');
const encoded = member(configArchive, reference.zipMember, 8 * 1024 * 1024);
const clientBytes = member(clientArchive, reference.client.zipMember, 32 * 1024 * 1024);
verify(encoded, { bytes: reference.memberBytes, sha256: reference.memberSha256 }, 'encoded table');
verify(
  clientBytes,
  { bytes: reference.client.memberBytes, sha256: reference.client.memberSha256 },
  'public client source',
);
// This exact public method uses two literal byte arrays and CFB with a
// 16-byte segment. Read only that syntax; do not eval or import the bundle.
const decoder = clientBytes
  .toString('utf8')
  .match(
    /InitOfb\(\)\{var t=new Uint8Array\(\[([\d,]+)\]\);this\.jofb=new aesjs\.ModeOfOperation\.cfb\(\[([\d,]+)\],t,16\)\}/,
  );
assert.ok(decoder, 'Public configuration decoder changed');
assert.equal(hash(decoder[0]), reference.decoderMethodSha256, 'Public decoder method mismatch');
const array = (text) => {
  const values = JSON.parse(`[${text}]`);
  assert.equal(values.length, 16);
  assert.ok(values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255));
  return Buffer.from(values);
};
const decipher = createDecipheriv('aes-128-cfb', array(decoder[2]), array(decoder[1]));
decipher.setAutoPadding(false);
const compressed = Buffer.concat([decipher.update(encoded), decipher.final()]);
const decoded = gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
verify(
  decoded,
  { bytes: reference.decodedBytes, sha256: reference.decodedSha256 },
  'decoded public configuration',
);
const data = JSON.parse(decoded.toString('utf8'));
const spellReference = research.additionalOfficialTables.spell;
assert.equal(spellReference.zipMember, 'cha_spell.sgs');
const spellEncoded = member(configArchive, spellReference.zipMember, 8 * 1024 * 1024);
const spellDecipher = createDecipheriv('aes-128-cfb', array(decoder[2]), array(decoder[1]));
spellDecipher.setAutoPadding(false);
const spellDecoded = gunzipSync(
  Buffer.concat([spellDecipher.update(spellEncoded), spellDecipher.final()]),
  { maxOutputLength: 16 * 1024 * 1024 },
);
verify(
  spellDecoded,
  { bytes: spellReference.decodedBytes, sha256: spellReference.decodedSha256 },
  'public skill descriptions',
);
const spells = JSON.parse(spellDecoded.toString('utf8')).GameSpells.spell;
assert.equal(spells.length, spellReference.spellCount);
const carry = JSON.parse(await readFile(resolve(root, 'config/shanhetu-cards.json'), 'utf8'));
const cardEncoded = member(configArchive, carry.cardDefinitions.zipMember, 8 * 1024 * 1024);
const cardDecipher = createDecipheriv('aes-128-cfb', array(decoder[2]), array(decoder[1]));
cardDecipher.setAutoPadding(false);
const cardDecoded = gunzipSync(
  Buffer.concat([cardDecipher.update(cardEncoded), cardDecipher.final()]),
  { maxOutputLength: 16 * 1024 * 1024 },
);
verify(
  cardDecoded,
  { bytes: carry.cardDefinitions.decodedBytes, sha256: carry.cardDefinitions.decodedSha256 },
  'public card definitions',
);
assert.equal(carry.sourceDecodedSha256, reference.decodedSha256);
const cardDefinitions = JSON.parse(cardDecoded.toString('utf8')).GamePlayCards.card;
for (const card of carry.cards) {
  const row = data.Root.Card.find((row) => row.id === card.id);
  assert.ok(row, `Carry card ${card.id} missing`);
  const definition = cardDefinitions.find((item) => item.a === row.cardid);
  assert.ok(definition, `Carry card definition ${row.cardid} missing`);
  assert.deepEqual(
    {
      cardId: row.cardid,
      rarity: row.level,
      price: row.money,
      equipmentSlot: row.isequip || 0,
      autoEquip: row.autoequip === 1,
      name: definition.b,
      suit: carry.cardDefinitions.suits[definition.g],
      number: definition.f,
      spellId: definition.m,
    },
    {
      cardId: card.cardId,
      rarity: card.rarity,
      price: card.price,
      equipmentSlot: card.equipmentSlot,
      autoEquip: card.autoEquip,
      name: card.name,
      suit: card.suit,
      number: card.number,
      spellId: card.spellId,
    },
    `Carry card ${card.id} source differs`,
  );
}
const tableCounts = Object.fromEntries(
  Object.entries(data.Root).map(([name, rows]) => {
    assert.ok(Array.isArray(rows), `Unexpected source table ${name}`);
    return [name, rows.length];
  }),
);
assert.deepEqual(tableCounts, reference.tableCounts);
const integrated = JSON.parse(
  await readFile(resolve(root, 'config/shanhetu-battles.json'), 'utf8'),
);
assert.equal(integrated.source.decodedSha256, reference.decodedSha256);
assert.deepEqual(
  integrated.battles.map((battle) => battle.id),
  research.implementation.battleIds,
);
const scenario = JSON.parse(await readFile(resolve(root, 'config/shanhetu-scenario.json'), 'utf8'));
const difficultyIds = scenario.difficulties.map((rule) => rule.id);
assert.deepEqual(
  difficultyIds,
  Array.from({ length: 20 }, (_, index) => index + 1),
);
const hardProgression = research.implementation.hardProgression;
assert.deepEqual(difficultyIds.slice(10, 15), hardProgression.difficultyIds);
assert.deepEqual(
  difficultyIds.slice(15),
  research.implementation.nightmareProgression.difficultyIds,
);
assert.deepEqual(
  scenario.regions.filter((region) => region.openDifficulty === 16).map((region) => region.id),
  research.implementation.nightmareProgression.addedRegions,
);
assert.deepEqual(
  integrated.battles.filter((battle) => battle.maximumDifficulty === 10).map((battle) => battle.id),
  hardProgression.withheldBattleIds,
);
const stageGroupIds = integrated.battles
  .flatMap((battle) => battle.enemies.flatMap((enemy) => enemy.nextForm?.sourceGroupId ?? []))
  .sort((left, right) => left - right);
assert.deepEqual(
  stageGroupIds,
  [
    ...research.implementation.normalStages.groupIds,
    ...research.implementation.mediumProgression.addedStageGroupIds,
    ...research.implementation.nightmareProgression.addedStageGroupIds,
  ].sort((left, right) => left - right),
);
const npcSkills = JSON.parse(
  await readFile(resolve(root, 'config/shanhetu-npc-skills.json'), 'utf8'),
);
assert.equal(npcSkills.sourceDecodedSha256, spellReference.decodedSha256);
assert.deepEqual(
  npcSkills.skills.map((skill) => skill.id),
  research.implementation.npcSkillIds,
);
const normalized = (value) =>
  String(value)
    .normalize('NFKC')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&nbsp;', '')
    .replace(/[^\p{L}\p{N}]/gu, '');
for (const skill of npcSkills.skills) {
  const source = spells.find((row) => row.a === skill.id);
  assert.ok(source, `NPC skill ${skill.id} missing`);
  assert.equal(source.c, skill.name);
  if (skill.sourceTextSha256) {
    assert.match(skill.implementation, /^native-/);
    assert.equal(hash(source.o), skill.sourceTextSha256);
    continue;
  }
  assert.equal(
    normalized(source.o),
    normalized(skill.description),
    `NPC skill ${skill.id} wording differs`,
  );
}
const { enemyFacts } = enemySource(npcSkills, cardDefinitions, carry.cardDefinitions.suits);
for (const battle of integrated.battles) {
  const fight = data.Root.Fight.find((row) => row.fightID === battle.id);
  assert.equal(fight?.Ggroup, battle.groupId, 'Integrated battle group changed');
  const generals = data.Root.General.filter((row) => row.a === battle.groupId);
  const forms = battle.enemies.flatMap((enemy) =>
    enemy.nextForm ? [enemy, enemy.nextForm] : [enemy],
  );
  for (const form of forms) {
    const ids = [
      ...form.sourceSkills,
      ...(form.medium?.sourceSkills ?? []),
      ...(form.hard?.sourceSkills ?? []),
      ...(form.nightmare?.sourceSkills ?? []),
    ];
    for (const id of ids) {
      const skill = npcSkills.skills.find((skill) => skill.id === id);
      const pack = skill?.implementation.match(/^native-(.+)$/)?.[1];
      if (pack)
        assert(
          battle.definitionPacks.includes(pack),
          `Fight ${battle.id} must load ${pack} for skill ${id}`,
        );
    }
  }
  const regions = scenario.regions.filter((region) => region.regularBossIds.includes(battle.id));
  const minimum = regions.length ? Math.min(...regions.map((region) => region.openDifficulty)) : 2;
  const maximum = battle.maximumDifficulty ?? difficultyIds.at(-1);
  const includeHard = battle.id < 20000 && maximum >= 15;
  const includeNightmare = battle.id < 20000 && maximum >= 16;
  const profileDifficulties =
    battle.id > 20000
      ? [1]
      : difficultyIds.filter((id) => id >= Math.max(2, minimum) && id <= maximum);
  assert.equal(generals.length, battle.enemies.length);
  for (const [index, row] of generals.entries()) {
    const { group, sex, nextForm, ...facts } = battle.enemies[index];
    assert.deepEqual(
      enemyFacts(row, battle.id < 20000, includeHard, includeNightmare),
      facts,
      `Integrated source recipe ${battle.id} differs`,
    );
    const stageDifficulties = sourceNumbers(row.CanStage).filter((id) =>
      profileDifficulties.includes(id),
    );
    if (!stageDifficulties.length) {
      assert.equal(nextForm, undefined);
      continue;
    }
    const [stageId, link] = sourceNumbers(row.w);
    const stage = data.Root.General.filter((entry) => entry.a === stageId);
    assert(
      row.inStage === 1 &&
        link === 1 &&
        stage.length === 1 &&
        stage[0].inStage === 2 &&
        !stage[0].w,
    );
    assert(nextForm, `Missing reviewed stage ${stageId}`);
    const { group: nextGroup, sex: nextSex, ...nextFacts } = nextForm;
    assert.deepEqual(nextFacts, {
      sourceGroupId: stageId,
      difficulties: stageDifficulties,
      ...enemyFacts(stage[0], true, includeHard, includeNightmare),
    });
  }
}
const growth = JSON.parse(await readFile(resolve(root, 'config/shanhetu-growth.json'), 'utf8'));
assert.equal(growth.sourceDecodedSha256, reference.decodedSha256);
for (const tactic of growth.tactics) {
  const original = data.Root.Tactics.find((row) => row.plot === tactic.id);
  assert.ok(original);
  assert.deepEqual(
    {
      name: original.plotname,
      description: original.plotdesc,
      rarity: original.level,
      price: original.money,
    },
    {
      name: tactic.name,
      description: tactic.description,
      rarity: tactic.rarity,
      price: tactic.price,
    },
    `Integrated tactic ${tactic.id} differs`,
  );
}
for (const skill of growth.skills) {
  const original = data.Root.Spell.find((row) => row.id === skill.id);
  assert.ok(original);
  assert.deepEqual(
    { spellId: original.spellid, rarity: original.level, price: original.money },
    { spellId: skill.spellId, rarity: skill.rarity, price: skill.price },
    `Integrated skill ${skill.id} differs`,
  );
  const text = spells.find((row) => row.a === skill.spellId);
  assert.ok(text);
  assert.deepEqual(
    { name: text.c, description: text.o },
    { name: skill.name, description: skill.description },
    `Official skill description ${skill.spellId} differs`,
  );
}
assert.equal(scenario.sourceDecodedSha256, reference.decodedSha256);
assert.deepEqual(
  scenario.difficulties,
  data.Root.DifficultySelection.filter(
    (row) => Number(row.seasonID) === scenario.scenarioId && difficultyIds.includes(row.difID),
  ).map((row) => {
    for (const field of ['otherad', 'killGetCard'])
      assert.equal(row[field], 0, `Difficulty ${row.difID} requires modifier ${field}`);
    return {
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
    };
  }),
);
assert.deepEqual(scenario.chapterThresholds, [4, 6, 7]);
for (const row of data.Root.EnemyGrowth.filter((row) =>
  [0, ...difficultyIds].includes(row.diffnum),
)) {
  assert.deepEqual(scenario.monthlyGrowth[row.diffnum][row.moon], [
    row.hp,
    Number(row.cardnum),
    row.draw,
    row.exshatimes,
    row.armor,
    row.getarmor,
  ]);
  for (const field of ['hp1', 'draw1', 'otherad']) assert(!row[field]);
}
for (const row of data.Root.EnemyNumGrowth) {
  assert.deepEqual(scenario.enemyCountRates[row.type][row.num], [
    row.hp,
    row.cardnum,
    row.draw,
    row.exshatimes,
    row.armor,
    row.getarmor,
  ]);
}
assert(!data.Root.EnemyShow?.length, 'Location wait growth requires review');
for (const row of data.Root.EnemyDiffGrowth.filter((row) => row.diffnum <= 4)) {
  assert(!row.otherad);
  assert.deepEqual(scenario.chapterGrowth[row.diffnum][row.chap - 1], [
    row.hp,
    row.cardnum,
    row.draw,
    row.exshatimes,
    row.armor ?? 0,
    row.getarmor ?? 0,
  ]);
}
assert.equal(scenario.terrainDifficulty, Number(data.Root.Common[0].scenespellneeddiff));
assert.deepEqual(
  scenario.terrains.map(({ id }) => id),
  hardProgression.terrainSpellIds,
);
for (const { id, name, description } of scenario.terrains) {
  const original = spells.find((row) => row.a === id);
  assert.deepEqual([name, description], [original.c, original.o]);
}
assert.deepEqual(scenario.restart, {
  limit: data.Root.Common[0].reopen,
  waitSeconds: data.Root.Common[0].surrendertime,
});
const sourceText = (value) =>
  String(data.Root.Text.find((row) => String(row.ID) === String(value))?.text ?? value)
    .replace(/<[^>]*>/g, '')
    .trim();
const availableRegions = data.Root.Chapter.filter(
  (row) => row.seasonID === scenario.scenarioId && row.openDiff <= Math.max(...difficultyIds),
);
assert.deepEqual(
  scenario.regions.map((region) => region.id),
  availableRegions.map((region) => region.uniqueID),
);
assert.deepEqual(
  scenario.regions.filter((region) => region.openDifficulty === 11).map((region) => region.id),
  hardProgression.addedRegions,
);
assert(
  hardProgression.addedBattleIds.every((id) => scenario.fights.some((fight) => fight.id === id)),
);
for (const region of scenario.regions) {
  const original = availableRegions.find((row) => row.uniqueID === region.id);
  assert.equal(region.name, original.chaptername);
  assert.equal(region.chapter, original.chapter);
  assert.equal(region.openDifficulty, original.openDiff);
  assert.equal(region.bossAt, scenario.chapterThresholds[region.chapter - 1]);
  assert.deepEqual(
    region.next,
    String(original.canGoTo ?? '')
      .split(';')
      .map(Number)
      .filter((id) => availableRegions.some((region) => region.uniqueID === id)),
  );
  assert.deepEqual(
    region.locations,
    String(original.location)
      .split(';')
      .map(Number)
      .map((id) => {
        const row = data.Root.Level.find((row) => row.cityID === id);
        const [x, y] = row.citycoordinate.split(',').map(Number);
        return { id, x, y, poolId: row.universalfight ?? null };
      }),
  );
  const pool = data.Root.UniversalGroup.filter((row) => row.fightID === region.locations[0].poolId);
  assert(
    [...region.battleIds, ...region.regularBattleIds].every((id) =>
      pool.some((row) => row.fightgroup === id),
    ),
    'Ordinary encounter crossed source cities',
  );
  const boss = data.Root.Level.find((row) => row.cityID === original.bosslocation);
  assert.equal(region.terrain, Number(boss.scenespell) || null);
  for (const { id } of region.locations) {
    const row = data.Root.Level.find((location) => location.cityID === id);
    assert.equal(Number(row.scenespell) || null, region.terrain);
    assert(!row.spellTarget);
  }
  const bossIds = String(boss.eventfight).split(';').map(Number);
  assert(
    region.regularBossIds.length &&
      [...region.bossIds, ...region.regularBossIds].every((id) => bossIds.includes(id)),
  );
  for (const [newbie, regular, hard] of [
    [region.battleIds, region.regularBattleIds, region.hardBattleIds],
    [region.bossIds, region.regularBossIds, region.hardBossIds],
  ]) {
    if (newbie.length)
      assert(
        newbie.every((id) =>
          regular.some(
            (normal) =>
              data.Root.Fight.find((fight) => fight.fightID === normal)?.NewbieGroup === id,
          ),
        ),
      );
    assert(regular.every((id) => integrated.battles.some((battle) => battle.id === id)));
    assert(hard.length);
    assert.deepEqual(
      hard,
      regular.filter((id) => !hardProgression.withheldBattleIds.includes(id)),
    );
  }
}
const decisionFights = new Set();
for (const event of scenario.combatEvents) {
  const original = data.Root.Adventure.find((row) => row.ID === event.id);
  assert.equal(event.name, sourceText(original.chapname));
  assert.equal(event.duration, original.duration);
  assert.deepEqual(
    event.poolIds,
    data.Root.UniversalGroup.filter((row) => row.premisegroup === event.id).map(
      (row) => row.fightID,
    ),
  );
  for (const [index, option] of event.options.entries()) {
    const choice = data.Root.Choose.find((row) => row.effectID === original[`effect${index + 1}`]);
    assert.equal(option.id, choice.effectID);
    assert.equal(option.label, sourceText(original[`option${index + 1}`]));
    if (choice.type === 7) {
      assert.equal(option.fight, Number(choice.event1));
      assert.equal(
        option.noviceFight,
        data.Root.Fight.find((row) => row.fightID === option.fight).NewbieGroup,
      );
      decisionFights.add(option.fight);
      decisionFights.add(option.noviceFight);
    } else assert.equal(option.coins, Number(choice.getnum));
  }
}
for (const fight of scenario.fights) {
  const original = data.Root.Fight.find((row) => row.fightID === fight.id);
  assert.deepEqual(fight, {
    id: original.fightID,
    enemyRank: scenario.regions.some((region) =>
      [...region.bossIds, ...region.regularBossIds].includes(fight.id),
    )
      ? 1
      : original.iselite
        ? 2
        : 3,
    name: sourceText(original.name),
    description: decisionFights.has(fight.id)
      ? `迎战${data.Root.General.filter((actor) => actor.a === original.Ggroup)
          .map((actor) => actor.c)
          .join('、')}`
      : sourceText(String(original.text).split(';')[0]),
    coins: original.itemgroup ?? 0,
    rewardGroups: String(original.reward ?? '')
      .split(';')
      .map(Number)
      .filter(Boolean),
    unlockSkillSlot: original.rewarditem === '1007',
  });
}
for (const event of scenario.events) {
  const original = data.Root.Adventure.find((row) => row.ID === event.id);
  assert.deepEqual(
    event.poolIds,
    data.Root.UniversalGroup.filter((row) => row.premisegroup === event.id).map(
      (row) => row.fightID,
    ),
  );
  assert.equal(event.name, sourceText(original.chapname));
  assert.equal(event.description, sourceText(original.text));
  assert.equal(event.duration, original.duration);
  for (const [index, option] of event.options.entries()) {
    const effect = data.Root.Choose.find((row) => row.effectID === original[`effect${index + 1}`]);
    assert.deepEqual(option, {
      id: effect.effectID,
      label: sourceText(original[`option${index + 1}`]),
      rewardGroup: effect.gettype === '2' ? Number(effect.getitem) : null,
      coins: effect.gettype === '1' && effect.getitem === '1000' ? Number(effect.getnum) : 0,
    });
  }
}
const recruitment = JSON.parse(
  await readFile(resolve(root, 'config/shanhetu-companions.json'), 'utf8'),
);
assert.equal(recruitment.sourceDecodedSha256, reference.decodedSha256);
for (const event of recruitment.events) {
  const original = data.Root.Adventure.find((row) => row.ID === event.id);
  assert.equal(event.name, sourceText(original.chapname));
  assert.equal(event.description, sourceText(original.text));
  assert.equal(event.duration, original.duration);
  assert(event.poolIds.length > 0, `Recruitment ${event.id} has no source pool`);
  assert.deepEqual(
    event.poolIds,
    data.Root.UniversalGroup.filter((row) => row.premisegroup === event.id).map(
      (row) => row.fightID,
    ),
  );
  assert.equal(event.options.length, 3);
  for (const [index, option] of event.options.entries()) {
    const effect = data.Root.Choose.find((row) => row.effectID === original[`effect${index + 1}`]);
    const recruit = effect.gettype === '3';
    assert.equal(effect.type, 1);
    assert.equal(effect.gettype, index < 2 ? '3' : '1');
    if (recruit) assert.equal(effect.getnum, '1');
    else assert.equal(effect.getitem, '1000');
    if (effect.lostnum) assert.equal(effect.lostitem, '1000');
    assert.deepEqual(option, {
      id: effect.effectID,
      label: sourceText(original[`option${index + 1}`]),
      cost: Number(effect.lostnum ?? 0),
      coins: recruit ? 0 : Number(effect.getnum),
      companionId: recruit ? Number(effect.getitem) : null,
    });
    if (recruit)
      assert.equal(
        recruitment.companions.find((row) => row.id === option.companionId).elite,
        index === 1,
      );
  }
}
for (const companion of recruitment.companions) {
  const original = data.Root.General.find((row) => row.a === companion.id);
  assert.deepEqual(
    [
      companion.generalId,
      companion.name,
      companion.hp,
      companion.maxHp,
      companion.armor,
      companion.draw,
      companion.startingCards,
      companion.extraSha,
    ],
    [
      original.b,
      original.c,
      original.k,
      original.l,
      original.m,
      original.p,
      original.q,
      original.r,
    ],
  );
  assert.deepEqual(
    companion.skills.map((skill) => skill.id),
    original.v.split(';').map(Number),
  );
  for (const skill of companion.skills)
    assert.equal(skill.name, spells.find((row) => row.a === skill.id).c);
  const fixedHand = String(original.s ?? '')
    .split(';')
    .map(Number)
    .filter(Boolean);
  assert.deepEqual(
    (companion.fixedHand ?? []).map((card) => card.id),
    fixedHand,
  );
  for (const card of companion.fixedHand ?? []) {
    const original = cardDefinitions.find((row) => row.a === card.id);
    assert.deepEqual(
      [card.suit, card.number, card.nativeId],
      [
        carry.cardDefinitions.suits[original.g],
        original.f,
        { Sha: 'sha', Shan: 'shan', Jiu: 'jiu', WanJianQiFa: 'wanjian' }[original.p],
      ],
    );
  }
}
const book = JSON.parse(await readFile(resolve(root, 'config/shanhetu-book.json'), 'utf8'));
assert.equal(book.sourceDecodedSha256, reference.decodedSha256);
const bookNodes = data.Root.saijitianfu.filter((row) => row.seasonID === book.scenarioId);
assert.equal(book.scenarioId, scenario.scenarioId);
assert.deepEqual(
  book.slots,
  data.Root.saijilevel.map((row) => ({ rarity: row.addFirstCard, spent: row.point })),
);
for (const node of book.nodes) {
  const row = bookNodes.find((row) => row.tfid === node.id);
  assert.deepEqual(node, {
    id: row.tfid,
    plot: row.plot,
    cost: row.cost,
    requires: String(row.preposition ?? '')
      .split(';')
      .map(Number)
      .filter(Boolean),
  });
}
for (const tactic of book.tactics) {
  const row = data.Root.Tactics.find((row) => row.plot === tactic.id);
  assert.deepEqual(tactic, {
    id: row.plot,
    name: row.plotname,
    description: row.plotdesc,
    rarity: row.level,
  });
}
assert.deepEqual(
  book.specialCompanions,
  data.Root.Tactics.find((row) => row.plot === 2219)
    .strpra.split(';')
    .map((entry) => {
      const [id, weight] = entry.split(',').map(Number);
      return { id, weight };
    }),
);
assert(
  book.specialCompanions.every(
    ({ id, weight }) =>
      !weight ||
      recruitment.companions.some(
        (companion) => companion.id === id && companion.fixedHand?.length,
      ),
  ),
);
const admittedGrowth = new Set(
  [...growth.skills, ...growth.tactics, ...carry.cards].map((item) => item.id),
);
assert.deepEqual(
  book.lockedPlots,
  bookNodes.filter((row) => admittedGrowth.has(row.plot)).map((row) => row.plot),
);
for (const group of scenario.rewardGroups) {
  const row = data.Root.RewardGroup.find((row) => row.reward === group.id);
  assert.deepEqual(group, {
    id: row.reward,
    name: row.rewarddesc,
    category: Number(row.type),
    rarities: row.allreward.split(',').map(Number),
    count: row.pra1,
    allowSkip: row.type !== '4',
    skipCoins: row.abandonmoney ?? 0,
    random: row.random,
  });
}
assert.deepEqual(scenario.shop, {
  itemCount: data.Root.Shop[0].itemnum,
  nextPriceIncrease: data.Root.Shop[0].nextmoneyup,
  freeRefreshes: Number(data.Root.Common[0].shoprefresh.split(';')[0]),
  refreshPrice: Number(data.Root.Common[0].shoprefresh.split(';')[1]),
});
const report = {
  schemaVersion: 1,
  status: 'research-only-public-config-not-runtime-support',
  configSha256: reference.sha256,
  clientSha256: reference.client.sha256,
  decodedSha256: reference.decodedSha256,
  decoderMethodSha256: hash(decoder[0]),
  tableCounts,
  integratedBattleIds: integrated.battles.map((battle) => battle.id),
  integratedDifficultyIds: difficultyIds,
  integratedStageGroupIds: stageGroupIds,
  integratedTacticIds: growth.tactics.map((tactic) => tactic.id),
  integratedSkillIds: growth.skills.map((skill) => skill.id),
  integratedNpcSkillIds: npcSkills.skills.map((skill) => skill.id),
  integratedCarryCardIds: carry.cards.map((card) => card.id),
  integratedRegionIds: scenario.regions.map((region) => region.id),
  integratedEventIds: scenario.events.map((event) => event.id),
  integratedCompanionEventIds: recruitment.events.map((event) => event.id),
  integratedCompanionIds: recruitment.companions.map((companion) => companion.id),
  integratedBookNodeIds: book.nodes.map((node) => node.id),
  primarySkillDescriptions: { count: spells.length, sha256: hash(spellDecoded) },
  chapterThresholds: data.Root.ChapterCS.filter((row) => Number(row.seasonID) === 5).map((row) => ({
    chapter: row.chapter,
    days: row.chapterday,
    bossAt: row.apptime,
  })),
  regions: data.Root.Chapter.filter((row) => row.seasonID === 5).map((row) => ({
    id: row.uniqueID,
    name: row.chaptername,
    chapter: row.chapter,
    minimumDifficulty: row.openDiff,
    next: String(row.canGoTo ?? '')
      .split(/[;,]/)
      .filter(Boolean)
      .map(Number),
    locations: String(row.location).split(';').map(Number),
    bossLocation: row.bosslocation,
  })),
  limitation:
    'Public configuration does not establish server-side randomness or every combat effect.',
};
assert.equal(report.regions.length, 14);
assert.deepEqual(report.chapterThresholds, reference.season5ChapterThresholds);
assert.deepEqual(report.regions, reference.season5Regions);
await writeFile(resolve(folder, 'official-hd_roguelike.json'), decoded);
await writeFile(resolve(folder, 'official-cha_spell.json'), spellDecoded);
await mkdir(resolve(root, '.runtime/shanhetu-research'), { recursive: true });
await writeFile(
  resolve(root, '.runtime/shanhetu-research/official-config.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
