// SPDX-License-Identifier: GPL-3.0-only

/** Campaign summary only: no hands, identities, pile order or native state. */
export interface ShanhetuHeroState {
  general: string;
  group: string;
  hp: number;
  maxHp: number;
}

export interface ShanhetuBattleBuild {
  initialCards: number;
  draw: number;
  armor: number;
  extraSha: number;
  handLimit: number;
  skills: number[];
  tactics: number[];
  /** Catalog IDs of starting cards/equipment, never physical card references. */
  cards?: number[];
}

export interface ShanhetuExpeditionAward {
  victories: number;
  unlocked: string[];
}

export interface ShanhetuTerrain {
  id: number;
  name: string;
  description: string;
}

export const shanhetuSynergyNames = {
  burst: '爆发首杀',
  draw: '过牌续航',
  defense: '铁壁防反',
  ally: '队友协同',
} as const;

export type ShanhetuSynergyTag = keyof typeof shanhetuSynergyNames;

export const shanhetuOpeningPackages = [
  { id: 'burst', name: '爆发首杀包', description: '当头一棒 · 随身携带一张杀' },
  { id: 'draw', name: '过牌续航包', description: '摸牌Ⅰ · 随身携带一张无中生有' },
  { id: 'defense', name: '铁壁防反包', description: '护甲Ⅰ · 随身携带一张闪' },
] as const;

export interface ShanhetuFinalReport {
  title: string;
  earnedCoins: number;
  reputation: number;
  strategy: number;
  merit: number;
  trade: number;
  battleSeconds?: number;
  victories?: number;
}

export interface ShanhetuCampaignView {
  id: string;
  revision: number;
  scenario: string;
  difficulty: number;
  phase: 'selection' | 'map' | 'battle' | 'reward' | 'choice' | 'won' | 'lost' | 'interrupted';
  chapter: number;
  days: number;
  coins: number;
  skillSlots: number;
  hero: ShanhetuHeroState | null;
  heroName?: string;
  build: ShanhetuBattleBuild;
  /** Recruited companion catalog IDs, independent of room seats and battle state. */
  companions: number[];
  initialTactics?: string[];
  openingPackage?: string;
  rerollUsed?: boolean;
  highlight?: {
    build: string[];
    battle?: { name: string; defeatedEnemies: number; remainingHp: number; victory: boolean };
  };
  restartsLeft?: number;
  restartAt?: number;
  bookAward?: ShanhetuExpeditionAward | { pending: true };
  finalReport?: ShanhetuFinalReport;
  node: { id: string; name: string; kind: string; description: string } | null;
  actions: {
    id: string;
    kind:
      | 'hero'
      | 'region'
      | 'enter'
      | 'reward'
      | 'skip'
      | 'choice'
      | 'buy'
      | 'refresh'
      | 'reroll'
      | 'forge'
      | 'recycle'
      | 'leave'
      | 'retry';
    label: string;
    description: string;
    cost: number;
    refund?: number;
    general?: string;
    group?: string;
    portrait?: string;
    offer?: { kind: 'skill' | 'tactic' | 'card' | 'equipment'; rarity: number };
    replacement?: { name: string; description: string }[];
    synergyTags?: ShanhetuSynergyTag[];
    resonance?: string;
    stackFormula?: string;
    effectDelta?: string;
    skills?: { name: string; description: string }[];
    recruitLabel?: string;
  }[];
  map?: {
    regionId: string;
    name: string;
    bossAt: number;
    marketClosing?: boolean;
    terrain?: ShanhetuTerrain;
    locations: {
      id: string;
      name: string;
      kind: string;
      x: number;
      y: number;
      duration: number;
      unlockDay: number;
      risk?: string;
      rewardTypes?: string[];
      terrainEffect?: string;
      status: 'available' | 'completed' | 'locked';
      actionId?: string;
    }[];
    regions: {
      id: string;
      name: string;
      chapter: number;
      next: string[];
      completed: boolean;
      terrain?: ShanhetuTerrain;
      actionId?: string;
    }[];
  };
  completedNodes: number;
  victories: number;
  lastBattle: { outcome: 'victory' | 'defeat'; matchId: string; recoveredHp?: number } | null;
}

/** Accepted exclusively from the authenticated native rule executor. */
export interface ShanhetuBattleResult {
  runId: string;
  nodeId: string;
  battleId: number;
  outcome: 'victory' | 'defeat';
  hero: ShanhetuHeroState;
  defeatedEnemies: number;
}

export interface ShanhetuBookView {
  revision: number;
  victories: number;
  difficulties: {
    id: number;
    name: string;
    description: string;
    unlockText: string;
    unlocked: boolean;
  }[];
  milestones: {
    victories: number;
    lesson: string;
    skills: { id: number; name: string; description: string; unlocked: boolean }[];
  }[];
  goals: {
    label: string;
    progress: number;
    target: number;
    cities: string[];
    content: {
      id: number;
      name: string;
      description: string;
      use: 'opening' | 'skill' | 'tactic';
      unlocked: boolean;
    }[];
  }[];
  recent: {
    hero: string;
    difficulty: number;
    outcome: 'victory' | 'defeat' | 'retreat';
    victories: number;
    historic?: boolean;
    ending?: string;
    newUnlocks?: string[];
    finishedAt: number;
  }[];
}
