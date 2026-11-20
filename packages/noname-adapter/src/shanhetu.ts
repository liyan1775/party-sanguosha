// SPDX-License-Identifier: GPL-3.0-only
import battles from '../../../config/shanhetu-battles.json' with { type: 'json' };
import scenario from '../../../config/shanhetu-scenario.json' with { type: 'json' };
import growth from '../../../config/shanhetu-growth.json' with { type: 'json' };
import npcSkills from '../../../config/shanhetu-npc-skills.json' with { type: 'json' };
import carryCards from '../../../config/shanhetu-cards.json' with { type: 'json' };
import companionCatalog from '../../../config/shanhetu-companions.json' with { type: 'json' };
import portraitCatalog from '../../../config/shanhetu-portraits.json' with { type: 'json' };
import nativeCharacters from '../../../config/native-character-inventory.json' with { type: 'json' };
import type { MatchSetup } from './index.js';
import type {
  ShanhetuBattleResult,
  ShanhetuHeroState,
  ShanhetuBattleBuild,
} from '../../shared/src/shanhetu.js';
export type { ShanhetuBattleBuild } from '../../shared/src/shanhetu.js';

export interface ShanhetuBattleSetup {
  runId: string;
  nodeId: string;
  battleId: number;
  difficulty?: number;
  /** Completed travel months before entering this battle. Frozen on restart. */
  elapsedMonths?: number;
  chapter?: number;
  terrainId?: number;
  /** First battle offers these native characters; subsequent battles use hero. */
  candidates: string[];
  hero?: ShanhetuHeroState;
  build?: ShanhetuBattleBuild;
  companionIds?: number[];
}

interface ShanhetuNpcCard {
  id: number;
  name: string;
  nativeId: string;
  suit: string;
  number: number;
}
interface ShanhetuNpcEquipment extends ShanhetuNpcCard {
  range: number;
  spellId: number;
  subtype?: string;
}

interface ShanhetuNpcBonus {
  hp?: number;
  draw?: number;
  maxHp?: number;
  startingCards?: number;
  skills?: string[];
  sourceSkills?: number[];
  removeSourceSkills?: number[];
  equipment?: ShanhetuNpcEquipment[];
  hand?: ShanhetuNpcCard[];
}

interface ShanhetuNpcForm {
  generalId: number;
  name: string;
  group?: string;
  sex?: string;
  hp: number;
  maxHp: number;
  armor: number;
  armorRecovery?: number;
  draw: number;
  startingCards: number;
  extraSha: number;
  skills: string[];
  sourceSkills: number[];
  fixedEquipment?: ShanhetuNpcEquipment[];
  fixedHand?: ShanhetuNpcCard[];
  medium?: ShanhetuNpcBonus;
  hard?: ShanhetuNpcBonus;
  nightmare?: ShanhetuNpcBonus;
}
interface ShanhetuEncounterRecipe {
  id: number;
  name: string;
  groupId: number;
  minimumDifficulty?: number;
  maximumDifficulty?: number;
  definitionPacks: string[];
  enemies: (ShanhetuNpcForm & {
    nextForm?: ShanhetuNpcForm & { sourceGroupId: number; difficulties: number[] };
  })[];
}
const recipes: ShanhetuEncounterRecipe[] = battles.battles;
const portraitPaths = new Map(
  portraitCatalog.portraits.flatMap(({ generalId, names, sha256 }) =>
    names.map((name) => [`${generalId}/${name}`, `image/shanhetu/${sha256}.png`] as const),
  ),
);

function withPortrait<T extends { generalId: number; name: string }>(actor: T) {
  // OL reuses one general ID for several differently illustrated event NPCs.
  const portrait = portraitPaths.get(`${actor.generalId}/${actor.name}`);
  if (!portrait) throw new Error(`缺少${actor.name}的山河图立绘`);
  return { ...actor, portrait };
}

const validId = (value: unknown) => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const groups = ['wei', 'shu', 'wu', 'qun', 'shen', 'jin'];
export const shanhetuCompanionLimit = 4;

export function shanhetuDifficulty(id: unknown) {
  return scenario.difficulties.find((difficulty) => difficulty.id === id);
}

export function shanhetuTerrain(id: unknown) {
  return scenario.terrains.find((terrain) => terrain.id === id);
}

export function shanhetuCompanion(id: number) {
  return companionCatalog.companions.find((companion) => companion.id === id);
}

export function shanhetuBattleCompanions(battle: ShanhetuBattleSetup) {
  return (battle.companionIds ?? []).map((id) => {
    const companion = shanhetuCompanion(id);
    if (!companion) throw new Error('尚未接入的山河图队友');
    return withPortrait(companion);
  });
}

/** Fail before releasing an existing table. NPC seats never enter RoomStore. */
export function prepareShanhetuBattle(setup: MatchSetup, characters: string[]): MatchSetup {
  const battle = setup.shanhetu;
  if (!battle) {
    if (setup.settings.mode === 'shanhetu') throw new Error('缺少山河图征程战斗票据');
    return setup;
  }
  const recipe = recipes.find((item) => item.id === battle.battleId);
  const rules = shanhetuDifficulty(battle.difficulty === undefined ? 1 : battle.difficulty);
  if (
    battle.companionIds !== undefined &&
    (!Array.isArray(battle.companionIds) || battle.companionIds.length > shanhetuCompanionLimit)
  )
    throw new Error('无效的山河图队友名单');
  const companions = shanhetuBattleCompanions(battle);
  if (
    !['identity', 'shanhetu'].includes(setup.settings.mode) ||
    setup.settings.playerCount !== 1 ||
    setup.seats.length !== 1 ||
    setup.seats[0]?.kind !== 'human' ||
    setup.seats[0].id !== setup.ownerPlayerId ||
    setup.doudizhu ||
    setup.customRoster ||
    !validId(battle.runId) ||
    !validId(battle.nodeId) ||
    !recipe ||
    !rules ||
    rules.id < (recipe.minimumDifficulty ?? 1) ||
    (recipe.maximumDifficulty !== undefined && rules.id > recipe.maximumDifficulty) ||
    (battle.elapsedMonths !== undefined && !integer(battle.elapsedMonths, 0, 1000)) ||
    (battle.chapter !== undefined && !integer(battle.chapter, 1, 3)) ||
    (battle.terrainId !== undefined &&
      (rules.id < scenario.terrainDifficulty || !shanhetuTerrain(battle.terrainId))) ||
    recipe.enemies.length + companions.length + 1 > 8 ||
    new Set(companions.map((companion) => companion.generalId)).size !== companions.length ||
    !Array.isArray(battle.candidates) ||
    battle.candidates.length < 1 ||
    battle.candidates.length > 10 ||
    new Set(battle.candidates).size !== battle.candidates.length ||
    battle.candidates.some((id) => !characters.includes(id)) ||
    (battle.build &&
      (['initialCards', 'draw', 'armor', 'extraSha', 'handLimit'].some(
        (key) => !integer(battle.build![key as keyof ShanhetuBattleBuild], 0, 100),
      ) ||
        !Array.isArray(battle.build.skills) ||
        battle.build.skills.length > 3 ||
        new Set(battle.build.skills).size !== battle.build.skills.length ||
        battle.build.skills.some((id) => !growth.skills.some((skill) => skill.id === id)) ||
        !Array.isArray(battle.build.tactics) ||
        battle.build.tactics.length > growth.tactics.length ||
        new Set(battle.build.tactics).size !== battle.build.tactics.length ||
        battle.build.tactics.some((id) => !growth.tactics.some((tactic) => tactic.id === id)) ||
        (battle.build.cards !== undefined &&
          (!Array.isArray(battle.build.cards) ||
            battle.build.cards.length > 100 ||
            battle.build.cards.some((id) => !carryCards.cards.some((card) => card.id === id)))))) ||
    (battle.hero &&
      (!battle.candidates.includes(battle.hero.general) ||
        !groups.includes(battle.hero.group) ||
        !integer(battle.hero.hp, 1, 1000) ||
        !integer(battle.hero.maxHp, battle.hero.hp, 1000)))
  )
    throw new Error('无效或尚未接入的山河图战斗');
  return {
    ...setup,
    generalSelections: {},
    seats: [
      ...setup.seats,
      ...recipe.enemies.map((enemy, index) => ({
        id: `shanhetu-enemy-${index}`,
        nickname: enemy.name,
        kind: 'bot' as const,
      })),
      ...companions.map((companion) => ({
        id: `shanhetu-companion-${companion.id}`,
        nickname: companion.name,
        kind: 'bot' as const,
      })),
    ],
  };
}

/** Exact recipe only; callers cannot supply arbitrary NPC skills or stats. */
export function shanhetuRecipe(battleId: number, difficulty = 1, elapsedMonths = 0, chapter = 1) {
  const recipe = recipes.find((item) => item.id === battleId);
  const rules = shanhetuDifficulty(difficulty);
  if (
    !recipe ||
    !rules ||
    difficulty < (recipe.minimumDifficulty ?? 1) ||
    difficulty > (recipe.maximumDifficulty ?? Infinity)
  )
    throw new Error('尚未接入的山河图遭遇或难度');
  const result = structuredClone(recipe);
  const growth = scenario.monthlyGrowth as Record<number, number[][]>;
  const monthly = growth[difficulty]?.[elapsedMonths] ?? growth[0]?.[elapsedMonths];
  const chapterGrowth = scenario.chapterGrowth as Record<number, number[][]>;
  const chapterStats = chapterGrowth[rules.tier]?.[chapter - 1];
  const rank = scenario.fights.find((fight) => fight.id === battleId)?.enemyRank ?? 3;
  const rates = (scenario.enemyCountRates as Record<number, Record<number, number[]>>)[rank]![
    result.enemies.length
  ]!;
  // The OL enemy preview rounds a positive fraction below one up to one.
  const [enemyHp, enemyCards, enemyDraw, enemySha, enemyArmor, enemyArmorRecovery] = [
    rules.enemyHp,
    rules.enemyCards,
    rules.enemyDraw,
    rules.enemyExtraSha,
    rules.enemyArmor,
    rules.enemyArmorRecovery,
  ].map((value, index) => {
    const scaled =
      ((value + (monthly?.[index] ?? 0) + (chapterStats?.[index] ?? 0)) * rates[index]!) / 100;
    return scaled > 0 && scaled < 1 ? 1 : Math.floor(scaled);
  });
  for (const enemy of result.enemies) {
    if (enemy.nextForm && !enemy.nextForm.difficulties.includes(difficulty)) delete enemy.nextForm;
    for (const form of enemy.nextForm ? [enemy, enemy.nextForm] : [enemy]) {
      form.hp += enemyHp!;
      form.maxHp += enemyHp!;
      form.startingCards += enemyCards!;
      form.draw += enemyDraw!;
      form.extraSha += enemySha!;
      form.armor += enemyArmor!;
      if (enemyArmorRecovery) form.armorRecovery = enemyArmorRecovery;
      if (rules.tier >= 2 && form.medium) applyNpcBonus(form, form.medium);
      if (rules.tier >= 3 && form.hard) applyNpcBonus(form, form.hard);
      if (rules.tier >= 4 && form.nightmare) applyNpcBonus(form, form.nightmare);
      delete form.nightmare;
      delete form.medium;
      delete form.hard;
    }
  }
  return {
    ...result,
    enemies: result.enemies.map(({ nextForm, ...enemy }) => ({
      ...withPortrait(enemy),
      ...(nextForm && { nextForm: withPortrait(nextForm) }),
    })),
  };
}

function applyNpcBonus(form: ShanhetuNpcForm, bonus: ShanhetuNpcBonus) {
  form.hp += bonus.hp ?? 0;
  form.draw += bonus.draw ?? 0;
  form.maxHp += bonus.maxHp ?? 0;
  form.startingCards += bonus.startingCards ?? 0;
  if (bonus.skills) form.skills.push(...bonus.skills);
  if (bonus.sourceSkills) form.sourceSkills.push(...bonus.sourceSkills);
  if (bonus.removeSourceSkills) {
    form.skills = form.skills.filter(
      (_, index) => !bonus.removeSourceSkills!.includes(form.sourceSkills[index]!),
    );
    form.sourceSkills = form.sourceSkills.filter((id) => !bonus.removeSourceSkills!.includes(id));
  }
  if (bonus.equipment) form.fixedEquipment = [...(form.fixedEquipment ?? []), ...bonus.equipment];
  if (bonus.hand) form.fixedHand = [...(form.fixedHand ?? []), ...bonus.hand];
}

export function shanhetuGrowth() {
  return structuredClone(growth);
}
export function shanhetuDefinitionPacks(): string[] {
  return [
    ...new Set([
      ...recipes.flatMap((battle) => battle.definitionPacks),
      ...growth.skills.map((skill) => skill.definitionPack),
      ...companionCatalog.companions.flatMap((companion) => companion.definitionPacks),
    ]),
  ];
}
export function shanhetuEquipmentPacks(recipe?: ShanhetuEncounterRecipe): string[] {
  const encounters = recipe ? [recipe] : recipes;
  const hasBlackArmor = encounters.some((battle) =>
    battle.enemies.some((enemy) =>
      [enemy, enemy.nextForm].some((form) =>
        [
          ...(form?.fixedEquipment ?? []),
          ...(form?.medium?.equipment ?? []),
          ...(form?.hard?.equipment ?? []),
          ...(form?.nightmare?.equipment ?? []),
        ].some((card) => card.nativeId === 'heiguangkai'),
      ),
    ),
  );
  return hasBlackArmor ? ['yingbian'] : [];
}
export function shanhetuCards() {
  return structuredClone(carryCards.cards);
}
export function shanhetuBaseSkills(general: string): string[] {
  return (
    nativeCharacters.characters
      .find((entry) => entry.id === general)
      ?.skills.map((skill) => skill.id) ?? []
  );
}
export function shanhetuNpcSkills(recipe: ShanhetuEncounterRecipe) {
  const ids = recipe.enemies.flatMap((enemy) => [
    ...enemy.sourceSkills,
    ...(enemy.nextForm?.sourceSkills ?? []),
  ]);
  return structuredClone(npcSkills.skills.filter((skill) => ids.includes(skill.id)));
}

export function sanitizeShanhetuResult(
  value: unknown,
  setup: MatchSetup,
): ShanhetuBattleResult | null {
  if (!setup.shanhetu || !value || typeof value !== 'object') return null;
  const expected = setup.shanhetu;
  const result = value as ShanhetuBattleResult;
  const hero = result.hero;
  const count = shanhetuRecipe(
    expected.battleId,
    expected.difficulty,
    expected.elapsedMonths,
    expected.chapter,
  ).enemies.length;
  if (
    result.runId !== expected.runId ||
    result.nodeId !== expected.nodeId ||
    result.battleId !== expected.battleId ||
    !hero ||
    !expected.candidates.includes(hero.general) ||
    (expected.hero && expected.hero.general !== hero.general) ||
    !groups.includes(hero.group) ||
    !integer(hero.maxHp, 1, 1000) ||
    !integer(hero.hp, -1000, hero.maxHp) ||
    !integer(result.defeatedEnemies, 0, count) ||
    (result.outcome === 'victory'
      ? hero.hp <= 0 || result.defeatedEnemies !== count
      : result.outcome !== 'defeat' || hero.hp > 0)
  )
    return null;
  return {
    runId: expected.runId,
    nodeId: expected.nodeId,
    battleId: expected.battleId,
    outcome: result.outcome,
    hero: { general: hero.general, group: hero.group, hp: hero.hp, maxHp: hero.maxHp },
    defeatedEnemies: result.defeatedEnemies,
  };
}
