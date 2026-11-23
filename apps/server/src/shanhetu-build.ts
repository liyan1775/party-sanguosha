// SPDX-License-Identifier: GPL-3.0-only
import { shanhetuOpeningPackages } from '../../../packages/shared/src/shanhetu.js';
import type { ShanhetuSynergyTag } from '../../../packages/shared/src/shanhetu.js';

type OpeningPackage = (typeof shanhetuOpeningPackages)[number];
type OpeningPackageBuild = OpeningPackage & { tacticId: number; cardId: number };
const openingBuilds = {
  burst: { tacticId: 2036, cardId: 4062 },
  draw: { tacticId: 2059, cardId: 4138 },
  defense: { tacticId: 2069, cardId: 4070 },
} satisfies Record<OpeningPackage['id'], { tacticId: number; cardId: number }>;

export function openingPackage(id: unknown): OpeningPackageBuild | undefined {
  const pack = shanhetuOpeningPackages.find((item) => item.id === id);
  return pack && { ...pack, ...openingBuilds[pack.id] };
}

// The pinned native engine registers each rank as a distinct additive skill.
export const tacticFamilies: {
  effect: string;
  levels: readonly [
    readonly [number, number],
    readonly [number, number],
    ...Array<readonly [number, number]>,
  ];
  forgePrice: number;
}[] = [
  {
    effect: '每轮首杀伤害',
    levels: [
      [2036, 1],
      [2037, 2],
    ],
    forgePrice: 200,
  },
  {
    effect: '摸牌阶段摸牌数',
    levels: [
      [2059, 1],
      [2060, 2],
    ],
    forgePrice: 200,
  },
  {
    effect: '手牌上限',
    levels: [
      [2132, 1],
      [2133, 2],
      [2135, 5],
    ],
    forgePrice: 100,
  },
  {
    effect: '每轮开始时获得护甲',
    levels: [
      [2069, 1],
      [2070, 2],
    ],
    forgePrice: 200,
  },
  {
    effect: '每回合使用酒的次数',
    levels: [
      [2108, 1],
      [2109, 2],
    ],
    forgePrice: 400,
  },
];

const tacticTags: Partial<Record<number, ShanhetuSynergyTag[]>> = {
  2030: ['draw'],
  2059: ['draw'],
  2010: ['burst'],
  2009: ['burst'],
  2002: ['defense'],
  2003: ['defense'],
  2132: ['draw'],
  2133: ['draw'],
  2135: ['draw'],
  2060: ['draw'],
  2108: ['burst'],
  2109: ['burst'],
  2036: ['burst'],
  2037: ['burst'],
  2129: ['burst'],
  2069: ['defense'],
  2070: ['defense'],
  2028: ['defense'],
  2007: ['burst', 'ally'],
  2360: ['defense'],
  2303: ['burst'],
  2249: ['draw'],
  2049: ['burst', 'draw'],
  2100: ['burst'],
};

const skillTags: Partial<Record<number, ShanhetuSynergyTag[]>> = {
  3297: ['draw'],
  3021: ['burst'],
  3049: ['defense', 'ally'],
  3134: ['defense'],
  3145: ['burst'],
  3264: ['burst'],
  3271: ['draw'],
  3025: ['burst'],
  3225: ['draw'],
  3016: ['draw', 'ally'],
  3106: ['defense'],
  3091: ['burst'],
  3253: ['burst', 'draw'],
  3268: ['burst', 'draw'],
  3177: ['burst'],
  3040: ['defense'],
  3218: ['burst', 'defense'],
  3178: ['defense', 'draw'],
  3086: ['defense', 'draw'],
};

const cardTags: Partial<Record<string, ShanhetuSynergyTag[]>> = {
  sha: ['burst'],
  jiu: ['burst'],
  juedou: ['burst'],
  huogong: ['burst'],
  nanman: ['burst'],
  wanjian: ['burst'],
  tiesuo: ['burst'],
  jiedao: ['burst'],
  guohe: ['burst', 'defense'],
  wuzhong: ['draw'],
  shunshou: ['draw'],
  wugu: ['draw', 'ally'],
  taoyuan: ['defense', 'ally'],
  tao: ['defense', 'ally'],
  shan: ['defense'],
  wuxie: ['defense', 'ally'],
  lebu: ['defense'],
  bingliang: ['defense'],
  shandian: ['burst'],
};

export function synergyTags(
  kind: string,
  id: number,
  card?: { nativeId: string; equipmentSlot?: number | null },
) {
  if (kind === 'tactic') return tacticTags[id] ?? [];
  if (kind === 'skill') return skillTags[id] ?? [];
  if (kind === 'companion') return ['ally'] as const;
  if (kind !== 'card' || !card) return [];
  if (card.equipmentSlot === 1) return ['burst'] as const;
  if (card.equipmentSlot) return ['defense'] as const;
  return cardTags[card.nativeId] ?? [];
}
