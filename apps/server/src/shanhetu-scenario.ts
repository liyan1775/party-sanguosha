// SPDX-License-Identifier: GPL-3.0-only
import { randomInt } from 'node:crypto';
import source from '../../../config/shanhetu-scenario.json' with { type: 'json' };
import companionCatalog from '../../../config/shanhetu-companions.json' with { type: 'json' };
import bookRules from '../../../config/shanhetu-book.json' with { type: 'json' };
import inventory from '../../../config/native-character-inventory.json' with { type: 'json' };
import presets from '../../../config/roster-presets.json' with { type: 'json' };
import generals from '../../../config/general-catalog.json' with { type: 'json' };
import {
  shanhetuCards,
  shanhetuCompanion,
  shanhetuDifficulty,
  shanhetuGrowth,
  shanhetuTerrain,
} from '../../../packages/noname-adapter/src/shanhetu.js';
import type { ShanhetuCampaignCatalog, ShanhetuNode, ShanhetuReward } from './shanhetu-campaign.js';
import { AppError } from './errors.js';

export const shanhetuRestartWaitMs = source.restart.waitSeconds * 1000;
const gatedContent = new Set([
  ...bookRules.unlockMilestones.flatMap((milestone) => milestone.skills),
  ...bookRules.explorationGoals.filter((goal) => goal.target > 0).flatMap((goal) => goal.content),
]);
const openingIds = new Set(bookRules.tactics.map((tactic) => tactic.id));

function sample<T>(items: readonly T[], count: number): T[] {
  const remaining = [...items],
    selected: T[] = [];
  while (remaining.length && selected.length < count)
    selected.push(remaining.splice(randomInt(remaining.length), 1)[0]!);
  return selected;
}

/** Freeze the map and each location's offers at embarkation. */
export function createShanhetuScenario(
  characters: string[],
  unlocked: ReadonlySet<number> = new Set(),
  difficulty = 1,
  openingTactic: unknown = null,
): ShanhetuCampaignCatalog {
  const rules = shanhetuDifficulty(difficulty);
  if (!rules) throw new Error('尚未接入的山河图难度');
  if (
    openingTactic !== null &&
    (typeof openingTactic !== 'number' || !openingIds.has(openingTactic))
  )
    throw new AppError(400, 'INVALID_OPENING_TACTIC', '请选择本次征程的初始战法。');
  if (
    typeof openingTactic === 'number' &&
    gatedContent.has(openingTactic) &&
    !unlocked.has(openingTactic)
  )
    throw new AppError(409, 'OPENING_TACTIC_LOCKED', '这项初始战法尚未解锁，请查看山河册。');
  const allowed = new Set(presets.presets.flatMap((preset) => preset.characters));
  if (
    !characters.length ||
    new Set(characters).size !== characters.length ||
    characters.some((id) => !allowed.has(id))
  )
    throw new Error('山河图选将范围无效');
  const candidates = sample(characters, Math.min(5, characters.length));
  const heroChoices = candidates.flatMap((id) => {
    const general = inventory.characters.find((general) => general.id === id)!;
    const details = generals.characters.find((general) => general.id === id)!;
    const [hp, maxHp = hp] = String(general.hp).split('/').map(Number);
    if (!hp || !maxHp) throw new Error('缺少原生武将体力');
    return (general.group === 'shen' ? ['wei', 'shu', 'wu', 'qun'] : [general.group]).map(
      (group) => ({
        general: id,
        name: general.name,
        portrait: details.portrait,
        group,
        hp,
        maxHp,
        description: `${({ wei: '魏', shu: '蜀', wu: '吴', qun: '群', shen: '神', jin: '晋' } as Record<string, string>)[group]} · ${hp}/${maxHp}体力\n${details.skills.map((skill) => `${skill.name}：${skill.description}`).join('\n')}`,
      }),
    );
  });
  const growth = shanhetuGrowth(),
    cards = shanhetuCards();
  const entries = [
    ...growth.tactics.map((tactic) => ({
      ...tactic,
      category: 2,
      rewardId: `tactic-${tactic.id}`,
    })),
    ...growth.skills.map((skill) => ({ ...skill, category: 3, rewardId: `skill-${skill.id}` })),
    ...cards.map((card) => ({
      ...card,
      category: card.autoEquip ? 5 : 4,
      rewardId: `card-${card.id}`,
      description: [
        card.description,
        `每场开局${card.autoEquip ? '装备' : '获得'}${card.name}，${({ spade: '黑桃', heart: '红桃', club: '梅花', diamond: '方片' } as Record<string, string>)[card.suit]} ${card.number}，进入弃牌堆时销毁。`,
      ]
        .filter(Boolean)
        .join('\n'),
    })),
  ].filter(
    (entry) => !openingIds.has(entry.id) && (!gatedContent.has(entry.id) || unlocked.has(entry.id)),
  );
  const rewards: ShanhetuReward[] = entries.map((entry) => ({
    id: entry.rewardId,
    name: entry.name,
    description: entry.description,
    offer: {
      kind:
        entry.category === 2
          ? 'tactic'
          : entry.category === 3
            ? 'skill'
            : entry.category === 5
              ? 'equipment'
              : 'card',
      rarity: entry.rarity,
    },
    effects: [
      {
        kind: entry.category === 2 ? 'tactic' : entry.category === 3 ? 'skill' : 'card',
        amount: entry.id,
      },
    ],
  }));
  const rewardGroup = (id: number): NonNullable<ShanhetuNode['rewardGroups']>[number] => {
    const group = source.rewardGroups.find((group) => group.id === id)!;
    const pool = entries.filter(
      (entry) => entry.category === group.category && group.rarities.includes(entry.rarity),
    );
    if (!pool.length) throw new Error(`奖励类别尚未接入：${id}`);
    return {
      count: group.count,
      rewards: pool.map((entry) => entry.rewardId),
      allowSkip: group.allowSkip,
      skipCoins: group.skipCoins,
    };
  };
  const nodes: ShanhetuNode[] = [];
  const encounterFor = (battleId: number, kind: 'battle' | 'boss') => {
    const battle = source.fights.find((fight) => fight.id === battleId)!;
    return {
      name: battle.name,
      description: battle.description,
      battleId,
      coins: battle.coins,
      rewardGroups: battle.rewardGroups.map(rewardGroup),
      victoryRecovery: rules.preserveHp ? 0 : source.victoryRecovery[kind],
      ...(battle.unlockSkillSlot ? { unlockSkillSlots: 3 } : {}),
    };
  };
  const regions: NonNullable<ShanhetuCampaignCatalog['regions']> = [];
  const availableRegions = source.regions.filter((region) => region.openDifficulty <= difficulty);
  for (const region of availableRegions) {
    const nodeIds: string[] = [];
    const bosses =
      rules.tier >= 3
        ? region.hardBossIds
        : difficulty === 1
          ? region.bossIds
          : region.regularBossIds;
    const battles =
      rules.tier >= 3
        ? region.hardBattleIds
        : difficulty === 1
          ? region.battleIds
          : region.regularBattleIds;
    const terrain =
      difficulty >= source.terrainDifficulty ? shanhetuTerrain(region.terrain) : undefined;
    for (const [index, location] of region.locations.entries()) {
      const kind = source.localSampling.layout[index] as ShanhetuNode['kind'];
      const id = `city-${location.id}`;
      const base = {
        id,
        kind,
        chapter: region.chapter,
        duration: kind === 'boss' ? 0 : kind === 'battle' ? source.localSampling.battleDays : 1,
        unlockDay: index === 0 || !source.localSampling.openingBattleGate ? 0 : 1,
        position: { x: location.x, y: location.y },
        next: [] as string[],
      };
      nodeIds.push(id);
      if (kind === 'battle' || kind === 'boss') {
        const battleId = sample(kind === 'boss' ? bosses : battles, 1)[0]!;
        nodes.push({ ...base, ...encounterFor(battleId, kind) });
      } else if (kind === 'event') {
        const recruitment =
          index === source.localSampling.recruitmentIndex
            ? sample(
                companionCatalog.events.filter((event) =>
                  event.poolIds.some((poolId) => poolId === location.poolId),
                ),
                1,
              )[0]
            : undefined;
        if (recruitment) {
          nodes.push({
            ...base,
            name: recruitment.name,
            description: recruitment.description,
            duration: recruitment.duration,
            choices: recruitment.options.map((option) => {
              const companion = option.companionId ? shanhetuCompanion(option.companionId) : null;
              return {
                id: `option-${option.id}`,
                decisionId: option.id,
                label: companion ? `${option.label} · ${companion.name}` : option.label,
                description: companion
                  ? `${companion.elite ? '精英' : '普通'}队友 · ${companion.maxHp}体力\n${companion.skills.map((skill) => skill.name).join('、')}\n每场参战时重新发牌并回满体力。`
                  : `获得${option.coins}铜币`,
                cost: option.cost,
                effects: [
                  companion
                    ? { kind: 'companion', amount: companion.id }
                    : { kind: 'coins', amount: option.coins },
                ],
              };
            }),
          });
          continue;
        }
        const event = sample(
          [...source.events, ...source.combatEvents].filter(
            (event) => location.poolId !== null && event.poolIds.includes(location.poolId),
          ),
          1,
        )[0]!;
        if (!('description' in event)) {
          nodes.push({
            ...base,
            name: event.name,
            duration: event.duration,
            description: '选择应对方式。',
            choices: event.options.map((option) => {
              const battleId = difficulty === 1 ? option.noviceFight : option.fight;
              const encounter = battleId ? encounterFor(battleId, 'battle') : undefined;
              return {
                id: `option-${option.id}`,
                decisionId: option.id,
                label: option.label,
                cost: 0,
                description: encounter
                  ? `${encounter.description} · 胜利可获${encounter.coins}铜币和战后奖励`
                  : `获得${option.coins}铜币`,
                effects: encounter ? [] : [{ kind: 'coins' as const, amount: option.coins }],
                ...(encounter ? { encounter } : {}),
              };
            }),
          });
          continue;
        }
        nodes.push({
          ...base,
          name: event.name,
          description: event.description,
          duration: event.duration,
          choices: event.options.map((option) => {
            const offeredId = option.rewardGroup
              ? sample(rewardGroup(option.rewardGroup).rewards, 1)[0]
              : null;
            const selected = offeredId ? rewards.find((reward) => reward.id === offeredId)! : null;
            const optionLabel = [193302, 193402].includes(option.id) ? '带走装备' : option.label;
            return {
              id: `option-${option.id}`,
              decisionId: option.id,
              label: `${optionLabel} · ${selected?.name ?? `${option.coins}铜币`}`,
              description: selected?.description ?? `获得${option.coins}铜币`,
              ...(selected?.offer ? { offer: selected.offer } : {}),
              cost: 0,
              effects: selected ? selected.effects : [{ kind: 'coins', amount: option.coins }],
            };
          }),
        });
      } else if (kind === 'camp') {
        nodes.push({
          ...base,
          name: '安营扎寨',
          description: '忽见一湖边平坦之所，你决定安营扎寨。',
          choices: source.camp.map((bonus) => ({
            id: `camp-${bonus.id}`,
            label: bonus.name,
            description: bonus.description,
            cost: 0,
            effects: [{ kind: bonus.effect as 'max-hp' | 'draw', amount: bonus.amount }],
          })),
        });
      } else throw new Error('未接入的地图节点类别');
    }
    const shopId = `shop-${region.id}`;
    nodeIds.push(shopId);
    const pool = entries.map((entry) => ({ rewardId: entry.rewardId, price: entry.price }));
    nodes.push({
      id: shopId,
      name: '集市',
      description: '消耗铜币购买构筑，每次购买后其余商品涨价。',
      kind: 'shop',
      chapter: region.chapter,
      duration: source.localSampling.shopDuration,
      next: [],
      unlockDay: source.localSampling.shopUnlockDay,
      position: { x: 500, y: -290 },
      products: sample(pool, source.shop.itemCount),
      refreshPool: pool,
      offerCount: source.shop.itemCount,
      nextPriceIncrease: source.shop.nextPriceIncrease,
      freeRefreshes: source.shop.freeRefreshes,
      refreshPrice: source.shop.refreshPrice,
    });
    regions.push({
      id: `region-${region.id}`,
      name: region.name,
      chapter: region.chapter,
      bossAt: region.bossAt,
      ...(terrain ? { terrain } : {}),
      nodes: nodeIds,
      boss: `city-${region.locations.at(-1)!.id}`,
      next: region.next
        .filter((id) => availableRegions.some((target) => target.id === id))
        .map((id) => `region-${id}`),
    });
  }
  return {
    id: `ol-s5-difficulty-${rules.id}`,
    name: `${source.name} · ${rules.name}`,
    difficulty: rules.id,
    recordEndings: true,
    entries: [],
    initialCoins: 0,
    initialSkillSlots: 2,
    restartLimit: source.restart.limit,
    candidates,
    heroChoices,
    ...(openingTactic === 2219
      ? {
          openingCompanions: sample(
            bookRules.specialCompanions.flatMap(({ id, weight }) => Array<number>(weight).fill(id)),
            1,
          ),
        }
      : {}),
    ...(openingTactic === 2138
      ? {
          openingRewards: [
            {
              count: 3,
              allowSkip: false,
              rewards: entries
                .filter((entry) => entry.category === 3 && entry.rarity === 2)
                .map((entry) => entry.rewardId),
            },
          ],
        }
      : {}),
    openingTactics: bookRules.tactics
      .filter((tactic) => tactic.id === openingTactic)
      .map((tactic) => tactic.name),
    ...(typeof openingTactic === 'number' &&
    growth.tactics.some((tactic) => tactic.id === openingTactic)
      ? { openingBattleTactic: openingTactic }
      : {}),
    initialRegion: `region-${sample(source.initialRegions, 1)[0]}`,
    regions,
    nodes,
    rewards,
  };
}
