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

export interface ShanhetuFinalReport {
  title: string;
  earnedCoins: number;
  reputation: number;
  strategy: number;
  merit: number;
  trade: number;
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
      | 'leave'
      | 'retry';
    label: string;
    description: string;
    cost: number;
    general?: string;
    group?: string;
    portrait?: string;
    offer?: { kind: 'skill' | 'tactic' | 'card' | 'equipment'; rarity: number };
  }[];
  map?: {
    regionId: string;
    name: string;
    bossAt: number;
    terrain?: ShanhetuTerrain;
    locations: {
      id: string;
      name: string;
      kind: string;
      x: number;
      y: number;
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
  recent: {
    hero: string;
    difficulty: number;
    outcome: 'victory' | 'defeat' | 'retreat';
    victories: number;
    historic?: boolean;
    ending?: string;
    finishedAt: number;
  }[];
}
