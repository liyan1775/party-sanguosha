// SPDX-License-Identifier: GPL-3.0-only
import { randomInt, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import recruitText from '../../../config/shanhetu-companion-text.json' with { type: 'json' };
import { shanhetuSynergyNames } from '../../../packages/shared/src/shanhetu.js';
import type { ShanhetuBattleSetup } from '../../../packages/noname-adapter/src/shanhetu.js';
import {
  shanhetuGrowth,
  shanhetuRecipe,
  shanhetuCards,
  shanhetuBaseSkills,
  shanhetuCompanion,
  shanhetuCompanionLimit,
} from '../../../packages/noname-adapter/src/shanhetu.js';
import type {
  ShanhetuBattleBuild,
  ShanhetuBattleResult,
  ShanhetuCampaignView,
  ShanhetuHeroState,
  ShanhetuSynergyTag,
  ShanhetuTerrain,
} from '../../../packages/shared/src/shanhetu.js';
import { AppError } from './errors.js';
import { openingPackage, synergyTags, tacticFamilies } from './shanhetu-build.js';
import { finalJourneyReport, recordJourneyDecision, type JourneyStats } from './shanhetu-ending.js';

export type ShanhetuEffect = {
  kind:
    | 'coins'
    | 'heal'
    | 'max-hp'
    | 'initial-cards'
    | 'draw'
    | 'armor'
    | 'extra-sha'
    | 'hand-limit'
    | 'skill-slot'
    | 'skill'
    | 'card'
    | 'tactic'
    | 'companion';
  amount: number;
};
export interface ShanhetuReward {
  id: string;
  name: string;
  description: string;
  effects: ShanhetuEffect[];
  offer?: ShanhetuCampaignView['actions'][number]['offer'];
}
export interface ShanhetuNode {
  id: string;
  name: string;
  description: string;
  kind: 'battle' | 'boss' | 'event' | 'camp' | 'shop';
  chapter: number;
  duration: number;
  next: string[];
  battleId?: number;
  victoryRecovery?: number;
  coins?: number;
  /** Each category freezes one independent choice; no client supplies rewards. */
  rewardGroups?: { count: number; rewards: string[]; allowSkip?: boolean; skipCoins?: number }[];
  choices?: {
    id: string;
    decisionId?: number;
    encounter?: ShanhetuNodeBattle;
    offer?: ShanhetuReward['offer'];
    label: string;
    description: string;
    cost: number;
    effects: ShanhetuEffect[];
  }[];
  products?: { rewardId: string; price: number }[];
  /** Explicit admitted refresh pool; source weights are a separate content policy. */
  refreshPool?: { rewardId: string; price: number }[];
  offerCount?: number;
  freeRefreshes?: number;
  refreshPrice?: number;
  nextPriceIncrease?: number;
  unlockSkillSlots?: number;
  position?: { x: number; y: number };
  unlockDay?: number;
}
type ShanhetuNodeBattle = Pick<
  ShanhetuNode,
  'coins' | 'rewardGroups' | 'victoryRecovery' | 'unlockSkillSlots'
> & { battleId: number };
export interface ShanhetuRegion {
  id: string;
  name: string;
  chapter: number;
  bossAt: number;
  terrain?: ShanhetuTerrain;
  nodes: string[];
  boss: string;
  next: string[];
}
export interface ShanhetuCampaignCatalog {
  id: string;
  name: string;
  difficulty?: number;
  recordEndings?: boolean;
  entries: string[];
  nodes: ShanhetuNode[];
  rewards: ShanhetuReward[];
  candidates: string[];
  initialCoins: number;
  initialSkillSlots: number;
  restartLimit?: number;
  heroChoices?: (ShanhetuHeroState & { name: string; description: string; portrait?: string })[];
  openingCompanions?: number[];
  openingTactics?: string[];
  openingBattleTactic?: number;
  openingPackageId?: string;
  openingRewards?: ShanhetuNode['rewardGroups'];
  regions?: ShanhetuRegion[];
  initialRegion?: string;
}
type Action = ShanhetuCampaignView['actions'][number] & {
  target?: string;
  decisionId?: number;
  encounter?: ShanhetuNodeBattle;
  effects?: ShanhetuEffect[];
  replaceSkill?: number;
  replaceTactic?: number;
  recycleIndex?: number;
};

type RewardGroup = NonNullable<ShanhetuNode['rewardGroups']>[number];
type MarketDraft = { credits: number[]; addedCardCreditLimit: number; refund: number };
type BattleHighlight = NonNullable<NonNullable<ShanhetuCampaignView['highlight']>['battle']>;
const recruitDescriptions: Record<string, string> = recruitText;
const rewardRerollPrice = 80;

const emptyBuild = (): ShanhetuBattleBuild => ({
  initialCards: 0,
  draw: 0,
  armor: 0,
  extraSha: 0,
  handLimit: 0,
  skills: [],
  tactics: [],
  cards: [],
});
const bounded = (value: unknown, min = 0, max = 1000000): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

/** Trusted catalog, authoritative actions and summaries; never native battle saves. */
export class ShanhetuCampaign {
  private readonly catalog: ShanhetuCampaignCatalog;
  private readonly state: ShanhetuCampaignView;
  private readonly growth: ReturnType<typeof shanhetuGrowth>;
  private readonly cards: ReturnType<typeof shanhetuCards>;
  private actions: Action[] = [];
  private consumedActions = new Map<string, number>();
  private pendingGroups: RewardGroup[] = [];
  private activeReward:
    { group: RewardGroup; selected: ShanhetuReward[]; rerolled: boolean } | undefined;
  private cardCredits: number[] = [];
  private battleStartedAt: number | undefined;
  private battleMs = 0;
  private bestBattle?: { rank: number; view: BattleHighlight };
  private pendingTicket: ShanhetuBattleSetup | null = null;
  private eventBattle: ShanhetuNodeBattle | undefined;
  private matchId: string | null = null;
  private shopPurchases = new Set<string>();
  private shopOffers: NonNullable<ShanhetuNode['products']> = [];
  private shopPurchaseCount = 0;
  private shopRefreshCount = 0;
  private currentRegionId: string | null = null;
  private visitedNodes = new Set<string>();
  private readonly defeatedBosses: { regionId: string; battleId: number }[] = [];
  private elapsedMonths = 0;
  private readonly stats: JourneyStats = {
    earnedCoins: 0,
    reputation: 0,
    strategy: 0,
    merit: 0,
    trade: 0,
  };

  constructor(
    catalog: ShanhetuCampaignCatalog,
    private readonly clock = () => performance.now(),
  ) {
    this.catalog = structuredClone(catalog);
    this.growth = shanhetuGrowth();
    this.cards = shanhetuCards();
    this.validateCatalog();
    const pack = openingPackage(this.catalog.openingPackageId);
    const tactics = [catalog.openingBattleTactic, pack?.tacticId].filter(
      (id): id is number => id !== undefined,
    );
    this.state = {
      id: randomUUID(),
      revision: 0,
      scenario: catalog.name,
      difficulty: catalog.difficulty ?? 1,
      phase: 'map',
      chapter: 1,
      days: 0,
      coins: catalog.initialCoins,
      skillSlots: catalog.initialSkillSlots,
      ...(catalog.restartLimit !== undefined ? { restartsLeft: catalog.restartLimit } : {}),
      hero: null,
      build: {
        ...emptyBuild(),
        tactics: [...new Set(tactics)],
        cards: pack ? [pack.cardId] : [],
      },
      companions: [...(this.catalog.openingCompanions ?? [])],
      ...(pack ? { openingPackage: pack.name } : {}),
      ...(this.catalog.openingTactics?.length
        ? { initialTactics: [...this.catalog.openingTactics] }
        : {}),
      node: null,
      actions: [],
      completedNodes: 0,
      victories: 0,
      lastBattle: null,
    };
    if (pack) this.cardCredits = [0];
    if (this.catalog.heroChoices?.length) {
      this.state.phase = 'selection';
      this.actions = this.catalog.heroChoices.map((hero) => ({
        ...this.action('hero', hero.name, hero.description),
        general: hero.general,
        group: hero.group,
        ...(hero.portrait ? { portrait: hero.portrait } : {}),
      }));
    } else this.beginRoute();
  }

  view(): ShanhetuCampaignView {
    const terminal = this.state.phase === 'won' || this.state.phase === 'lost';
    return structuredClone({
      ...this.state,
      ...(terminal && this.catalog.recordEndings
        ? {
            finalReport: finalJourneyReport(
              this.state.difficulty,
              this.state.phase === 'won',
              this.stats,
              this.state.difficulty >= 16 ? this.battleMs : undefined,
              this.state.difficulty >= 16 ? this.state.victories : undefined,
            ),
          }
        : {}),
      ...(terminal ? { highlight: this.highlight() } : {}),
      ...(this.activeReward && this.state.node ? { rerollUsed: this.activeReward.rerolled } : {}),
      ...(this.state.hero
        ? {
            heroName:
              this.catalog.heroChoices?.find((hero) => hero.general === this.state.hero!.general)
                ?.name ?? '征战者',
          }
        : {}),
      actions: this.actions.map(
        ({
          id,
          kind,
          label,
          description,
          cost,
          general,
          group,
          offer,
          portrait,
          replacement,
          synergyTags,
          resonance,
          stackFormula,
          effectDelta,
          skills,
          recruitLabel,
          refund,
        }) => ({
          id,
          kind,
          label,
          description,
          cost,
          ...(general ? { general, group } : {}),
          ...(portrait ? { portrait } : {}),
          ...(offer ? { offer } : {}),
          ...(replacement ? { replacement } : {}),
          ...(synergyTags ? { synergyTags } : {}),
          ...(resonance ? { resonance } : {}),
          ...(stackFormula ? { stackFormula } : {}),
          ...(effectDelta ? { effectDelta } : {}),
          ...(skills ? { skills } : {}),
          ...(recruitLabel ? { recruitLabel } : {}),
          ...(refund ? { refund } : {}),
        }),
      ),
      ...(this.currentRegionId ? { map: this.mapView() } : {}),
    });
  }

  bossVictories() {
    return structuredClone(this.defeatedBosses);
  }

  private node(): ShanhetuNode {
    const node = this.catalog.nodes.find((node) => node.id === this.state.node?.id);
    if (!node) throw new Error('征程节点缺失');
    return node;
  }

  /** RoomStore must authenticate the owner before invoking this method. */
  isDuplicate(input: unknown): boolean {
    if (!input || typeof input !== 'object') return false;
    const { runId, revision, actionId } = input as Record<string, unknown>;
    return (
      runId === this.state.id &&
      typeof actionId === 'string' &&
      bounded(revision, 0, Number.MAX_SAFE_INTEGER) &&
      this.consumedActions.get(actionId) === revision
    );
  }

  /** RoomStore must authenticate the owner before invoking this method. */
  act(input: unknown): { duplicate: boolean; battle: ShanhetuBattleSetup | null } {
    if (!input || typeof input !== 'object')
      throw new AppError(400, 'INVALID_CAMPAIGN_ACTION', '请选择当前征程中的操作。');
    const { runId, revision, actionId } = input as Record<string, unknown>;
    if (
      typeof runId !== 'string' ||
      typeof actionId !== 'string' ||
      !bounded(revision, 0, Number.MAX_SAFE_INTEGER)
    )
      throw new AppError(400, 'INVALID_CAMPAIGN_ACTION', '征程操作编号或版本无效。');
    if (runId !== this.state.id)
      throw new AppError(409, 'CAMPAIGN_CHANGED', '征程已更新，请刷新后继续。');
    if (this.consumedActions.get(actionId) === revision) return { duplicate: true, battle: null };
    if (revision !== this.state.revision)
      throw new AppError(409, 'CAMPAIGN_CHANGED', '征程已更新，请查看当前选项。');
    const action = this.actions.find((action) => action.id === actionId);
    if (!action)
      throw new AppError(409, 'CAMPAIGN_ACTION_EXPIRED', '该选项已失效，请查看当前征程。');
    if (this.state.coins < action.cost) throw new AppError(409, 'NOT_ENOUGH_COINS', '铜币不足。');
    // Plan the redraw and inventory changes before publishing any part of the action.
    const redrawn = action.kind === 'reroll' ? this.redrawReward() : undefined;
    const next = structuredClone(this.state);
    const cardCount = action.effects?.filter((effect) => effect.kind === 'card').length ?? 0;
    const market: MarketDraft = {
      credits: [...this.cardCredits],
      addedCardCreditLimit:
        action.kind === 'buy' ? Math.floor(action.cost / Math.max(1, cardCount)) : Infinity,
      refund: 0,
    };
    next.coins -= action.cost;
    if (action.replaceSkill !== undefined) {
      const slot = next.build.skills.indexOf(action.replaceSkill);
      if (slot < 0) throw new AppError(409, 'REWARD_UNAVAILABLE', '待替换技能已改变。');
      next.build.skills.splice(slot, 1);
    }
    if (action.replaceTactic !== undefined) {
      const index = next.build.tactics.indexOf(action.replaceTactic);
      if (index < 0) throw new AppError(409, 'REWARD_UNAVAILABLE', '待锻造战法已改变。');
      next.build.tactics.splice(index, 1);
    }
    if (action.recycleIndex !== undefined) {
      const index = action.recycleIndex;
      if (!market.credits[index] || next.build.cards?.[index] === undefined)
        throw new AppError(409, 'REWARD_UNAVAILABLE', '待回收的随身牌已改变。');
      market.refund = market.credits.splice(index, 1)[0]!;
      next.build.cards.splice(index, 1);
    }
    for (const effect of action.effects ?? []) this.applyEffect(next, effect, market);
    const earned = next.coins - (this.state.coins - action.cost);
    next.coins += market.refund;
    if (!bounded(next.coins, 0, 1_000_000_000))
      throw new AppError(409, 'REWARD_UNAVAILABLE', '铜币已达上限。');
    this.cardCredits = market.credits;
    this.stats.earnedCoins += earned;
    if (action.decisionId !== undefined) recordJourneyDecision(this.stats, action.decisionId);
    Object.assign(this.state, next);
    this.consumedActions.set(action.id, this.state.revision);
    if (this.consumedActions.size > 256)
      this.consumedActions.delete(this.consumedActions.keys().next().value!);
    this.state.revision++;
    let battle: ShanhetuBattleSetup | null = null;
    if (action.kind === 'hero') {
      const hero = this.catalog.heroChoices!.find(
        (hero) => hero.general === action.general && hero.group === action.group,
      )!;
      this.state.hero = {
        general: hero.general,
        group: hero.group,
        hp: hero.hp,
        maxHp: hero.maxHp,
      };
      this.pendingGroups = structuredClone(this.catalog.openingRewards ?? []);
      this.reward();
    } else if (action.kind === 'region') this.enterRegion(action.target!);
    else if (action.kind === 'enter') battle = this.enter(action.target!);
    else if (action.kind === 'reward' || action.kind === 'skip') this.reward();
    else if (redrawn) {
      this.activeReward = { group: this.activeReward!.group, selected: redrawn, rerolled: true };
      this.showReward();
    } else if (action.kind === 'choice' && action.encounter) {
      this.eventBattle = action.encounter;
      battle = this.battle();
    } else if (action.kind === 'choice' || action.kind === 'leave') this.complete();
    else if (action.kind === 'buy') {
      this.shopPurchases.add(action.target!);
      this.shopPurchaseCount++;
      this.shop();
    } else if (action.kind === 'forge' || action.kind === 'recycle') this.shop();
    else if (action.kind === 'refresh') {
      this.shopRefreshCount++;
      this.shopPurchases.clear();
      const pool = structuredClone(this.node().refreshPool!);
      this.shopOffers = [];
      while (pool.length && this.shopOffers.length < (this.node().offerCount ?? 4)) {
        const product = pool.splice(randomInt(pool.length), 1)[0]!;
        const reward = this.catalog.rewards.find((reward) => reward.id === product.rewardId)!;
        if (this.rewardVariants(reward).length) this.shopOffers.push(product);
      }
      this.shop();
    } else if (action.kind === 'retry') battle = this.battle();
    return { duplicate: false, battle: battle ? structuredClone(battle) : null };
  }

  private beginRoute(): void {
    if (this.catalog.regions) this.enterRegion(this.catalog.initialRegion!);
    else this.route(this.catalog.entries);
  }

  private region(): ShanhetuRegion {
    return this.catalog.regions!.find((region) => region.id === this.currentRegionId)!;
  }

  private enterRegion(id: string): void {
    const region = this.catalog.regions!.find((region) => region.id === id)!;
    this.currentRegionId = id;
    this.state.chapter = region.chapter;
    this.state.days = 0;
    this.state.node = null;
    this.routeRegion();
  }

  private routeRegion(): void {
    const region = this.region();
    this.route(
      this.state.days >= region.bossAt
        ? [region.boss]
        : region.nodes.filter((id) => {
            const node = this.catalog.nodes.find((node) => node.id === id)!;
            return (
              id !== region.boss &&
              !this.visitedNodes.has(id) &&
              (node.unlockDay ?? 0) <= this.state.days
            );
          }),
    );
  }

  private mapView(): NonNullable<ShanhetuCampaignView['map']> {
    const region = this.region();
    return {
      regionId: region.id,
      name: region.name,
      bossAt: region.bossAt,
      marketClosing:
        this.state.days < region.bossAt &&
        region.bossAt - this.state.days <= 1 &&
        region.nodes.some(
          (id) =>
            this.catalog.nodes.some((node) => node.id === id && node.kind === 'shop') &&
            !this.visitedNodes.has(id),
        ),
      ...(region.terrain ? { terrain: region.terrain } : {}),
      locations: region.nodes.map((id) => {
        const node = this.catalog.nodes.find((node) => node.id === id)!;
        const action = this.actions.find(
          (action) => action.kind === 'enter' && action.target === id,
        );
        return {
          id,
          name: node.name,
          kind: node.kind,
          x: node.position?.x ?? 0,
          y: node.position?.y ?? 0,
          duration: node.duration,
          unlockDay: id === region.boss ? region.bossAt : (node.unlockDay ?? 0),
          status: this.visitedNodes.has(id) ? 'completed' : action ? 'available' : 'locked',
          ...this.mapPreview(node, region),
          ...(action ? { actionId: action.id } : {}),
        };
      }),
      regions: this.catalog.regions!.map(({ id, name, chapter, next, boss, terrain }) => {
        const action = this.actions.find(
          (action) => action.kind === 'region' && action.target === id,
        );
        return {
          id,
          name,
          chapter,
          next,
          completed: this.visitedNodes.has(boss),
          ...(terrain ? { terrain } : {}),
          ...(action ? { actionId: action.id } : {}),
        };
      }),
    };
  }

  /** Bind synchronously when EngineAdapter allocates its new match instance. */
  bindMatch(ticket: ShanhetuBattleSetup, id: string): void {
    if (
      this.state.phase !== 'battle' ||
      this.matchId ||
      !this.pendingTicket ||
      ticket.runId !== this.state.id ||
      ticket.nodeId !== this.pendingTicket.nodeId ||
      ticket.battleId !== this.pendingTicket.battleId ||
      ticket.difficulty !== this.pendingTicket.difficulty ||
      ticket.elapsedMonths !== this.pendingTicket.elapsedMonths ||
      ticket.chapter !== this.pendingTicket.chapter ||
      ticket.terrainId !== this.pendingTicket.terrainId ||
      !id
    )
      throw new Error('征程与原生战斗实例不一致');
    this.matchId = id;
    this.battleStartedAt = this.clock();
  }

  private closeBattleClock(): void {
    if (this.battleStartedAt === undefined) return;
    this.battleMs += Math.max(0, this.clock() - this.battleStartedAt);
    this.battleStartedAt = undefined;
  }

  restart(id: string): ShanhetuBattleSetup {
    if (this.state.phase !== 'battle' || id !== this.matchId || !this.pendingTicket)
      throw new AppError(409, 'CAMPAIGN_CHANGED', '本关已改变，请查看当前征程。');
    const remaining = this.state.restartsLeft ?? 0;
    if (!remaining) throw new AppError(409, 'NO_RESTARTS_LEFT', '本次征程的重开次数已用完。');
    this.closeBattleClock();
    this.state.restartsLeft = remaining - 1;
    this.state.revision++;
    return structuredClone(this.battle());
  }

  settle(id: string, result: ShanhetuBattleResult): boolean {
    if (
      this.state.phase !== 'battle' ||
      id !== this.matchId ||
      !this.pendingTicket ||
      result.runId !== this.state.id ||
      result.nodeId !== this.pendingTicket.nodeId ||
      result.battleId !== this.pendingTicket.battleId
    )
      return false;
    const ticket = this.pendingTicket;
    const enemies = shanhetuRecipe(
      ticket.battleId,
      ticket.difficulty,
      ticket.elapsedMonths,
      ticket.chapter,
    ).enemies.length;
    if (
      !this.catalog.candidates.includes(result.hero?.general) ||
      !['wei', 'shu', 'wu', 'qun', 'shen', 'jin'].includes(result.hero.group) ||
      !bounded(result.hero.maxHp, 1, 1000) ||
      !bounded(result.hero.hp, -1000, result.hero.maxHp) ||
      (this.pendingTicket.hero && result.hero.general !== this.pendingTicket.hero.general) ||
      !bounded(result.defeatedEnemies, 0, enemies) ||
      (result.outcome === 'victory'
        ? result.hero.hp <= 0 || result.defeatedEnemies !== enemies
        : result.outcome !== 'defeat' || result.hero.hp > 0)
    )
      return false;
    this.closeBattleClock();
    this.recordBattleHighlight(ticket, result);
    const encounter = this.eventBattle ?? this.node();
    const recoveredHp =
      result.outcome === 'victory'
        ? Math.min(encounter.victoryRecovery ?? 0, result.hero.maxHp - result.hero.hp)
        : 0;
    this.state.hero = {
      general: result.hero.general,
      group: result.hero.group,
      hp: result.hero.hp + recoveredHp,
      maxHp: result.hero.maxHp,
    };
    this.state.lastBattle = {
      outcome: result.outcome,
      matchId: id,
      ...(recoveredHp > 0 ? { recoveredHp } : {}),
    };
    this.pendingTicket = null;
    this.matchId = null;
    this.state.revision++;
    if (result.outcome === 'defeat') {
      this.state.phase = 'lost';
      this.actions = [];
      return true;
    }
    this.state.victories++;
    if (this.currentRegionId && this.node().kind === 'boss') {
      this.defeatedBosses.push({ regionId: this.currentRegionId, battleId: ticket.battleId });
    }
    this.state.coins += encounter.coins ?? 0;
    this.stats.earnedCoins += encounter.coins ?? 0;
    if (encounter.unlockSkillSlots)
      this.state.skillSlots = Math.max(this.state.skillSlots, encounter.unlockSkillSlots);
    this.pendingGroups = structuredClone(encounter.rewardGroups ?? []);
    this.reward();
    return true;
  }

  /** Failure is not a defeat or victory and never grants a reward. */
  interrupt(id: string | null): boolean {
    if (this.state.phase !== 'battle' || id !== this.matchId) return false;
    this.closeBattleClock();
    this.matchId = null;
    this.state.phase = 'interrupted';
    this.state.revision++;
    this.actions = [
      this.action('retry', '重新挑战本关', '原战斗已中断；重新建立本关战斗，沿用开战前成长。'),
    ];
    return true;
  }

  private enter(id: string): ShanhetuBattleSetup | null {
    const node = this.catalog.nodes.find((node) => node.id === id)!;
    this.eventBattle = undefined;
    if (node.chapter !== this.state.chapter) this.state.days = 0;
    this.state.chapter = node.chapter;
    this.state.node = {
      id: node.id,
      name: node.name,
      kind: node.kind,
      description: node.description,
    };
    this.state.days += node.duration;
    if (node.kind === 'battle' || node.kind === 'boss') return this.battle();
    if (node.kind === 'shop') {
      this.shopPurchases.clear();
      this.shopOffers = structuredClone(node.products ?? []);
      this.shopPurchaseCount = 0;
      this.shopRefreshCount = 0;
      this.shop();
    } else {
      this.state.phase = 'choice';
      const seen = new Set<string>();
      this.actions = (node.choices ?? []).flatMap((choice) => {
        const decision: JourneyStats = {
          earnedCoins: 0,
          reputation: 0,
          strategy: 0,
          merit: 0,
          trade: 0,
        };
        if (choice.decisionId !== undefined) recordJourneyDecision(decision, choice.decisionId);
        const key = JSON.stringify([
          choice.label.trim(),
          choice.description.trim(),
          choice.cost,
          this.rewardKey(choice.effects),
          choice.encounter,
          decision,
        ]);
        if (seen.has(key)) return [];
        seen.add(key);
        const recruit = choice.effects.find((effect) => effect.kind === 'companion');
        const companion = recruit && shanhetuCompanion(recruit.amount);
        const variants = this.rewardVariants({
          id: choice.id,
          name: choice.label,
          description: choice.description,
          effects: choice.effects,
        });
        return variants.map((variant) => ({
          ...this.action('choice', variant.name, variant.description, choice.cost),
          ...(choice.offer ? { offer: choice.offer } : {}),
          effects: structuredClone(choice.effects),
          ...(choice.decisionId === undefined ? {} : { decisionId: choice.decisionId }),
          ...(choice.encounter ? { encounter: choice.encounter } : {}),
          ...(variant.replaceSkill === undefined ? {} : { replaceSkill: variant.replaceSkill }),
          ...(variant.replacement ? { replacement: variant.replacement } : {}),
          ...(companion
            ? {
                recruitLabel: choice.cost ? `${choice.cost} 铜币精英队友` : '免费普通队友',
                skills: companion.skills.map((skill) => ({
                  name: skill.name,
                  description: recruitDescriptions[skill.nativeId]!,
                })),
              }
            : {}),
          ...this.describeEffects(choice.effects, variant.replaceSkill),
        }));
      });
    }
    return null;
  }

  private battle(): ShanhetuBattleSetup {
    this.state.phase = 'battle';
    this.actions = [];
    this.matchId = null;
    const terrain = this.catalog.regions ? this.region().terrain : undefined;
    this.pendingTicket = {
      runId: this.state.id,
      nodeId: `${this.node().id}-${randomUUID()}`,
      battleId: this.eventBattle?.battleId ?? this.node().battleId!,
      difficulty: this.state.difficulty,
      elapsedMonths: this.elapsedMonths,
      chapter: this.state.chapter,
      ...(terrain ? { terrainId: terrain.id } : {}),
      candidates: [...this.catalog.candidates],
      ...(this.state.hero ? { hero: structuredClone(this.state.hero) } : {}),
      build: structuredClone(this.state.build),
      ...(this.state.companions.length ? { companionIds: [...this.state.companions] } : {}),
    };
    return this.pendingTicket;
  }

  private route(ids: string[]): void {
    this.state.phase = ids.length ? 'map' : 'won';
    this.actions = ids.map((id) => {
      const node = this.catalog.nodes.find((node) => node.id === id)!;
      return { ...this.action('enter', node.name, node.description), target: node.id };
    });
  }

  private complete(): void {
    this.state.completedNodes++;
    const node = this.node();
    this.elapsedMonths += node.duration;
    this.visitedNodes.add(node.id);
    if (!this.catalog.regions) return this.route(this.node().next);
    const region = this.region();
    if (this.node().id !== region.boss) return this.routeRegion();
    this.state.phase = region.next.length ? 'map' : 'won';
    this.actions = region.next.map((id) => {
      const next = this.catalog.regions!.find((region) => region.id === id)!;
      return {
        ...this.action(
          'region',
          `前往${next.name}`,
          [
            `第${next.chapter}章 · ${next.name}`,
            next.terrain ? `${next.terrain.name} · 全场${next.terrain.description}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        ),
        target: id,
      };
    });
  }

  private reward(): void {
    this.activeReward = undefined;
    while (this.pendingGroups.length) {
      const group = this.pendingGroups.shift()!;
      const selected = this.pickRewards(this.legalRewards(group), group.count);
      if (!selected.length && group.allowSkip === false) continue;
      this.activeReward = { group, selected, rerolled: false };
      this.showReward();
      return;
    }
    if (this.state.node) this.complete();
    else this.beginRoute();
  }

  private pickRewards(pool: ShanhetuReward[], count: number): ShanhetuReward[] {
    const remaining = [...pool];
    const selected: ShanhetuReward[] = [];
    while (remaining.length && selected.length < count)
      selected.push(remaining.splice(randomInt(remaining.length), 1)[0]!);
    return selected;
  }

  private legalRewards(group: RewardGroup): ShanhetuReward[] {
    const distinct = new Map<string, ShanhetuReward[]>();
    for (const id of new Set(group.rewards)) {
      const reward = this.catalog.rewards.find((item) => item.id === id)!;
      if (!this.rewardVariants(reward).length) continue;
      const key = this.rewardKey(reward.effects);
      const matches = distinct.get(key) ?? [];
      matches.push(reward);
      distinct.set(key, matches);
    }
    return [...distinct.values()].map((matches) => matches[randomInt(matches.length)]!);
  }

  private alternateRewards(active: NonNullable<ShanhetuCampaign['activeReward']>) {
    const shown = new Set(active.selected.map((reward) => this.rewardKey(reward.effects)));
    return this.legalRewards(active.group).filter(
      (reward) => !shown.has(this.rewardKey(reward.effects)),
    );
  }

  private redrawReward() {
    const active = this.activeReward;
    const available =
      active && !active.rerolled && this.state.node ? this.alternateRewards(active) : [];
    if (!active || !available.length)
      throw new AppError(409, 'REWARD_UNAVAILABLE', '本组奖励没有新的可选项。');
    const selected = this.pickRewards(available, active.group.count);
    selected.push(...this.pickRewards(active.selected, active.group.count - selected.length));
    return selected;
  }

  private showReward(): void {
    const active = this.activeReward!;
    this.state.phase = 'reward';
    this.actions = active.selected.flatMap((reward) =>
      this.rewardVariants(reward).map((variant) => ({
        ...this.action('reward', variant.name, variant.description),
        ...(reward.offer ? { offer: reward.offer } : {}),
        effects: structuredClone(reward.effects),
        ...(variant.replaceSkill === undefined ? {} : { replaceSkill: variant.replaceSkill }),
        ...(variant.replacement ? { replacement: variant.replacement } : {}),
        ...this.describeEffects(reward.effects, variant.replaceSkill),
      })),
    );
    if (active.group.allowSkip !== false) {
      const coins = active.group.skipCoins ?? 0;
      this.actions.push({
        ...this.action(
          'skip',
          '放弃本次奖励',
          coins ? `获得${coins}铜币，继续征程。` : '继续征程。',
        ),
        effects: coins ? [{ kind: 'coins', amount: coins }] : [],
      });
    }
    if (this.state.node && !active.rerolled && this.alternateRewards(active).length)
      this.actions.push(
        this.action(
          'reroll',
          '重随奖励',
          '每组限一次，至少换出一项全新的奖励。',
          rewardRerollPrice,
        ),
      );
  }

  private rewardKey(effects: ShanhetuEffect[]): string {
    return JSON.stringify(
      effects
        .map(({ kind, amount }) => {
          if (kind === 'card') {
            const card = this.cards.find((item) => item.id === amount)!;
            const distinction = this.cardDistinction(card);
            return JSON.stringify([
              kind,
              card.nativeId,
              card.nature ?? '',
              card.autoEquip,
              distinction?.key,
            ]);
          }
          if (kind === 'skill')
            return JSON.stringify([
              kind,
              this.growth.skills.find((skill) => skill.id === amount)!.nativeId,
            ]);
          return JSON.stringify([kind, amount]);
        })
        .sort(),
    );
  }

  private cardDistinction(card: ReturnType<typeof shanhetuCards>[number]) {
    const base = this.state.hero ? shanhetuBaseSkills(this.state.hero.general) : [];
    const extra = this.growth.skills.filter((skill) => this.state.build.skills.includes(skill.id));
    const skills = [...base, ...extra.map((skill) => skill.nativeId)];
    const cardColor = card.suit === 'heart' || card.suit === 'diamond' ? '红色' : '黑色';
    if (card.nativeId === 'sha') {
      if (
        (this.state.build.tactics.includes(2010) || skills.includes('new_rewusheng')) &&
        card.suit === 'diamond'
      )
        return { key: 'diamond', note: '方片杀可受当前技能或战法的距离加成。' };
      if (this.state.build.tactics.includes(2009) && card.suit === 'spade')
        return { key: 'spade', note: '黑桃杀可受偷袭的次数加成。' };
    }
    if (
      skills.some((id) =>
        ['guicai', 'guidao', 'tiandu', 'leiji', 'reguicai', 'reguidao'].includes(id),
      )
    )
      return {
        key: `${card.suit}-${card.number}`,
        note: '当前武将的判定相关技能可用到牌的花色或点数。',
      };
    if (
      skills.some((id) =>
        [
          'wusheng',
          'new_rewusheng',
          'rewusheng',
          'qixi',
          'qingguo',
          'zhiyu',
          'kanpo',
          'jijiu',
          'longhun',
        ].includes(id),
      )
    )
      return { key: cardColor, note: `${cardColor}牌，可以与当前构筑的颜色相关技能配合。` };
    return undefined;
  }

  private shop(): void {
    this.state.phase = 'choice';
    const node = this.node();
    this.actions = this.shopOffers.flatMap((product) => {
      const reward = this.catalog.rewards.find((reward) => reward.id === product.rewardId)!;
      if (this.shopPurchases.has(reward.id)) return [];
      return this.rewardVariants(reward).map((variant) => ({
        ...this.action(
          'buy',
          variant.name,
          variant.description,
          product.price + this.shopPurchaseCount * (node.nextPriceIncrease ?? 0),
        ),
        ...(reward.offer ? { offer: reward.offer } : {}),
        target: reward.id,
        ...this.describeEffects(reward.effects, variant.replaceSkill),
        effects: structuredClone(reward.effects),
        ...(variant.replaceSkill === undefined ? {} : { replaceSkill: variant.replaceSkill }),
        ...(variant.replacement ? { replacement: variant.replacement } : {}),
      }));
    });
    for (const family of tacticFamilies) {
      const [[id, value], [upgrade, upgraded]] = family.levels;
      if (!this.state.build.tactics.includes(id) || this.state.build.tactics.includes(upgrade))
        continue;
      const old = this.growth.tactics.find((tactic) => tactic.id === id)!;
      const next = this.growth.tactics.find((tactic) => tactic.id === upgrade)!;
      const base = family.levels.reduce(
        (sum, [level, bonus]) => sum + (this.state.build.tactics.includes(level) ? bonus : 0),
        0,
      );
      const effects: ShanhetuEffect[] = [{ kind: 'tactic', amount: upgrade }];
      this.actions.push({
        ...this.action('forge', `锻造 · ${next.name}`, next.description, family.forgePrice),
        offer: { kind: 'tactic', rarity: next.rarity },
        effects,
        replaceTactic: id,
        replacement: [{ name: old.name, description: old.description }],
        ...this.describeEffects(effects, undefined, id),
        stackFormula: `替换${old.name}（+${value}）→ ${family.effect} +${base} → +${base - value + upgraded}`,
        effectDelta: `${family.effect} +${upgraded - value}`,
      });
    }
    const seenCards = new Map<number, Set<number>>();
    this.state.build.cards?.forEach((id, index) => {
      const refund = this.cardCredits[index];
      if (!refund || seenCards.get(id)?.has(refund)) return;
      const amounts = seenCards.get(id) ?? new Set<number>();
      amounts.add(refund);
      seenCards.set(id, amounts);
      const card = this.cards.find((item) => item.id === id)!;
      this.actions.push({
        ...this.action('recycle', `回收 · ${card.name}`, '移除一份随身牌或装备，换取铜币。'),
        recycleIndex: index,
        refund,
        offer: { kind: card.autoEquip ? 'equipment' : 'card', rarity: card.rarity },
        effectDelta: `回收 +${refund} 铜币`,
      });
    });
    if (node.refreshPool?.length) {
      const free = this.shopRefreshCount < (node.freeRefreshes ?? 0);
      const price = free ? 0 : (node.refreshPrice ?? 100);
      this.actions.push(
        this.action(
          'refresh',
          free ? '免费刷新集市' : `刷新集市（${price}铜币）`,
          free ? '重新抽取商品，本次免费。' : '重新抽取商品，保留本章购买涨价。',
          price,
        ),
      );
    }
    this.actions.push(this.action('leave', '离开集市', '保留铜币，继续征程。'));
  }

  private rewardVariants(reward: ShanhetuReward): {
    name: string;
    description: string;
    replaceSkill?: number;
    replacement?: Action['replacement'];
  }[] {
    if (this.eligible(reward.effects)) {
      const equipment = this.cards.filter(
        (card) => card.autoEquip && this.state.build.cards?.includes(card.id),
      );
      const replaced = new Map<number, { name: string; description: string }>();
      for (const effect of reward.effects) {
        if (effect.kind !== 'card') continue;
        const card = this.cards.find((item) => item.id === effect.amount);
        if (!card?.autoEquip) continue;
        const old = equipment.find((item) => item.equipmentSlot === card.equipmentSlot);
        if (old && old.id !== card.id)
          replaced.set(old.id, { name: old.name, description: old.description ?? '' });
      }
      return [
        {
          name: reward.name,
          description: reward.description,
          ...(replaced.size ? { replacement: [...replaced.values()] } : {}),
        },
      ];
    }
    const skills = reward.effects.filter((effect) => effect.kind === 'skill');
    if (
      skills.length !== 1 ||
      this.state.build.skills.length < this.state.skillSlots ||
      this.state.build.skills.includes(skills[0]!.amount)
    )
      return [];
    const definitions = this.growth.skills;
    return this.state.build.skills
      .filter((id) => this.eligible(reward.effects, id))
      .map((id) => {
        const old = definitions.find((skill) => skill.id === id)!;
        return {
          name: `${reward.name}（替换${old.name}）`,
          description: reward.description,
          replaceSkill: id,
          replacement: [{ name: old.name, description: old.description }],
        };
      });
  }

  private eligible(effects: ShanhetuEffect[], replaceSkill?: number): boolean {
    try {
      const state = structuredClone(this.state);
      if (replaceSkill !== undefined)
        state.build.skills = state.build.skills.filter((id) => id !== replaceSkill);
      for (const effect of effects) this.applyEffect(state, effect);
      return true;
    } catch {
      return false;
    }
  }

  private applyEffect(
    state: ShanhetuCampaignView,
    effect: ShanhetuEffect,
    market?: MarketDraft,
  ): void {
    const build = state.build;
    const fail = () => {
      throw new AppError(409, 'REWARD_UNAVAILABLE', '此项成长目前无法取得，请选择其他选项。');
    };
    switch (effect.kind) {
      case 'coins':
        state.coins += effect.amount;
        break;
      case 'heal':
        if (!state.hero) return fail();
        state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + effect.amount);
        break;
      case 'max-hp':
        if (!state.hero) return fail();
        state.hero.maxHp += effect.amount;
        state.hero.hp += effect.amount;
        break;
      case 'skill-slot':
        state.skillSlots = Math.min(3, state.skillSlots + effect.amount);
        break;
      case 'skill':
        if (build.skills.includes(effect.amount) || build.skills.length >= state.skillSlots)
          return fail();
        if (
          state.hero &&
          shanhetuBaseSkills(state.hero.general).includes(
            this.growth.skills.find((skill) => skill.id === effect.amount)!.nativeId,
          )
        )
          return fail();
        build.skills.push(effect.amount);
        break;
      case 'tactic':
        if (build.tactics.includes(effect.amount)) return fail();
        build.tactics.push(effect.amount);
        break;
      case 'companion': {
        const companion = shanhetuCompanion(effect.amount);
        if (
          !companion ||
          state.companions.length >= shanhetuCompanionLimit ||
          state.companions.some((id) => shanhetuCompanion(id)?.generalId === companion.generalId)
        )
          return fail();
        state.companions.push(companion.id);
        break;
      }
      case 'card': {
        const card = this.cards.find((card) => card.id === effect.amount);
        if (!card || (build.cards?.length ?? 0) >= 100) return fail();
        build.cards ??= [];
        if (card.autoEquip) {
          // Starting equipment replaces the previous item in the same slot.
          const oldIndex = build.cards.findIndex((id) => {
            const previous = this.cards.find((item) => item.id === id)!;
            return previous.autoEquip && previous.equipmentSlot === card.equipmentSlot;
          });
          if (oldIndex >= 0) {
            if (card.id === build.cards[oldIndex]) return fail();
            build.cards.splice(oldIndex, 1);
            if (market) market.refund += market.credits.splice(oldIndex, 1)[0]!;
          }
        }
        build.cards.push(card.id);
        if (market)
          market.credits.push(Math.floor(Math.min(card.price, market.addedCardCreditLimit) / 2));
        break;
      }
      case 'initial-cards':
        build.initialCards += effect.amount;
        break;
      case 'draw':
        build.draw += effect.amount;
        break;
      case 'armor':
        build.armor += effect.amount;
        break;
      case 'extra-sha':
        build.extraSha += effect.amount;
        break;
      case 'hand-limit':
        build.handLimit += effect.amount;
        break;
    }
    if (
      !bounded(state.coins, 0, 1000000000) ||
      !bounded(state.hero?.maxHp ?? 1, 1, 1000) ||
      [build.initialCards, build.draw, build.armor, build.extraSha, build.handLimit].some(
        (value) => !bounded(value, 0, 100),
      )
    )
      fail();
  }

  private action(kind: Action['kind'], label: string, description: string, cost = 0): Action {
    return { id: randomUUID(), kind, label, description, cost };
  }

  private validOpeningPackage(id: string): boolean {
    const pack = openingPackage(id);
    return (
      !!pack &&
      this.growth.tactics.some((tactic) => tactic.id === pack.tacticId) &&
      this.cards.some((card) => card.id === pack.cardId)
    );
  }

  private nameEffect(effect: ShanhetuEffect): string | undefined {
    if (effect.kind === 'companion') return shanhetuCompanion(effect.amount)?.name;
    if (effect.kind === 'skill')
      return this.growth.skills.find(({ id }) => id === effect.amount)?.name;
    if (effect.kind === 'tactic')
      return this.growth.tactics.find(({ id }) => id === effect.amount)?.name;
    if (effect.kind === 'card') return this.cards.find(({ id }) => id === effect.amount)?.name;
    return undefined;
  }

  private buildEffects(): ShanhetuEffect[] {
    const { tactics, skills, cards } = this.state.build;
    return [
      ...tactics.map((amount): ShanhetuEffect => ({ kind: 'tactic', amount })),
      ...skills.map((amount): ShanhetuEffect => ({ kind: 'skill', amount })),
      ...(cards ?? []).map((amount): ShanhetuEffect => ({ kind: 'card', amount })),
      ...this.state.companions.map((amount): ShanhetuEffect => ({ kind: 'companion', amount })),
    ];
  }

  private describeEffects(
    effects: ShanhetuEffect[],
    replaceSkill?: number,
    replaceTactic?: number,
  ): Pick<Action, 'synergyTags' | 'resonance' | 'stackFormula' | 'effectDelta' | 'refund'> {
    const cardFor = (id: number) => this.cards.find((card) => card.id === id);
    const tagsFor = ({ kind, amount }: ShanhetuEffect): readonly ShanhetuSynergyTag[] =>
      synergyTags(kind, amount, cardFor(amount));
    const tags = [
      ...new Set(effects.flatMap((effect): readonly ShanhetuSynergyTag[] => tagsFor(effect))),
    ];
    const build = this.buildEffects().filter(
      ({ kind, amount }) =>
        !(kind === 'skill' && replaceSkill === amount) &&
        !(kind === 'tactic' && replaceTactic === amount) &&
        !(
          kind === 'card' &&
          cardFor(amount)?.autoEquip &&
          effects.some(
            (effect) =>
              effect.kind === 'card' &&
              cardFor(effect.amount)?.autoEquip &&
              cardFor(effect.amount)?.equipmentSlot === cardFor(amount)?.equipmentSlot,
          )
        ),
    );
    const connections = tags.flatMap((tag) => {
      const matches = [
        ...new Set(
          build
            .filter((effect) => tagsFor(effect).includes(tag))
            .map((effect) => this.nameEffect(effect)),
        ),
      ];
      return matches.length
        ? [shanhetuSynergyNames[tag] + ' · 与' + matches.slice(0, 3).join('、') + '联动']
        : [];
    });
    const formulas: string[] = [];
    const deltas: string[] = [];
    let refund = 0;
    for (const effect of effects) {
      if (effect.kind === 'tactic') {
        const family = tacticFamilies.find(({ levels }) =>
          levels.some(([id]) => id === effect.amount),
        );
        if (!family) continue;
        const value = family.levels.find(([id]) => id === effect.amount)![1];
        const matches = family.levels.filter(([id]) => this.state.build.tactics.includes(id));
        const previous = matches.reduce((sum, [, bonus]) => sum + bonus, 0);
        const names = matches.map(([id, bonus]) => {
          const name = this.nameEffect({ kind: 'tactic', amount: id });
          return name + '（+' + bonus + '）';
        });
        if (names.length)
          formulas.push(
            '与已有' + names.join('、') + '完全叠加 → ' + family.effect + ' +' + (previous + value),
          );
        deltas.push(family.effect + ' +' + value);
      }
      if (effect.kind === 'card') {
        const card = cardFor(effect.amount)!;
        const distinction = this.cardDistinction(card);
        if (distinction) deltas.push(distinction.note);
        if (!card.autoEquip) continue;
        const index =
          this.state.build.cards?.findIndex((id) => {
            const old = cardFor(id);
            return old?.autoEquip && old.equipmentSlot === card.equipmentSlot;
          }) ?? -1;
        if (index < 0) continue;
        const credit = this.cardCredits[index] ?? 0;
        refund += credit;
        formulas.push(
          '将替换' +
            cardFor(this.state.build.cards![index]!)?.name +
            (credit ? '并回收 +' + credit + ' 铜币' : ''),
        );
      }
    }
    return {
      ...(tags.length ? { synergyTags: tags } : {}),
      ...(connections.length ? { resonance: connections.join('；') } : {}),
      ...(formulas.length ? { stackFormula: formulas.join('；') } : {}),
      ...(deltas.length ? { effectDelta: deltas.join('；') } : {}),
      ...(refund ? { refund } : {}),
    };
  }

  private mapPreview(node: ShanhetuNode, region: ShanhetuRegion) {
    const terrainEffect = region.terrain
      ? region.terrain.name + ' · ' + region.terrain.description
      : '无特殊战场地形';
    let risk = '无直接战斗';
    let rewardTypes: string[] = [];
    if (node.kind === 'battle' || node.kind === 'boss') {
      const recipe = shanhetuRecipe(
        node.battleId!,
        this.state.difficulty,
        this.elapsedMonths,
        node.chapter,
      );
      const upfront = recipe.enemies.filter((enemy) => !enemy.reinforcement);
      const totalHp = upfront.reduce((sum, enemy) => sum + enemy.maxHp, 0);
      risk = [
        node.kind === 'boss' ? '首领' : '守军',
        `开场 ${upfront.length} 名敌将 / 合计 ${totalHp} 体力上限`,
        ...(upfront.length < recipe.enemies.length ? ['战中可能增援'] : []),
      ].join(' · ');
      rewardTypes = (node.rewardGroups ?? []).flatMap((group) => {
        const categories = new Set(
          group.rewards.map(
            (id) => this.catalog.rewards.find((reward) => reward.id === id)?.offer?.kind,
          ),
        );
        const names = { skill: '额外技能', tactic: '战法', card: '随身牌', equipment: '装备' };
        return [...categories].flatMap((kind) => (kind ? [names[kind]] : []));
      });
      if (node.coins) rewardTypes.unshift(node.coins + ' 铜币');
      if (!rewardTypes.length) rewardTypes.push('推进征程');
    } else if (node.kind === 'camp') {
      rewardTypes = ['体力上限或每场摸牌'];
    } else if (node.kind === 'shop') {
      rewardTypes = ['购买、锻造与回收'];
    } else {
      if (node.choices?.some((choice) => choice.encounter)) risk = '奇遇可能触发交战';
      rewardTypes = node.choices?.some((choice) =>
        choice.effects.some((effect) => effect.kind === 'companion'),
      )
        ? ['招募队友或领取铜币']
        : ['按选择获得铜币或构筑奖励'];
    }
    return { risk, rewardTypes: [...new Set(rewardTypes)], terrainEffect };
  }

  private recordBattleHighlight(ticket: ShanhetuBattleSetup, result: ShanhetuBattleResult): void {
    const { defeatedEnemies, outcome, hero } = result;
    const rank =
      (outcome === 'victory' ? 10_000 : 0) +
      (this.node().kind === 'boss' ? 1_000 : 0) +
      defeatedEnemies * 10 +
      (1 - Math.max(0, hero.hp) / hero.maxHp);
    if (!this.bestBattle || rank >= this.bestBattle.rank) {
      const encounterName = this.catalog.nodes.find(
        (node) => node.battleId === ticket.battleId,
      )?.name;
      this.bestBattle = {
        rank,
        view: {
          name: encounterName ?? this.node().name,
          defeatedEnemies,
          remainingHp: hero.hp,
          victory: outcome === 'victory',
        },
      };
    }
  }

  private highlight(): NonNullable<ShanhetuCampaignView['highlight']> {
    const build = this.buildEffects().flatMap((effect) => this.nameEffect(effect) ?? []);
    return {
      build: [...new Set(build)].slice(0, 8),
      ...(this.bestBattle ? { battle: this.bestBattle.view } : {}),
    };
  }

  private validateCatalog(): void {
    const c = this.catalog;
    const ids = new Set(c.nodes.map((node) => node.id));
    const rewards = new Set(c.rewards.map((reward) => reward.id));
    const { growth, cards } = this;
    const invalidGroups = (groups: ShanhetuNode['rewardGroups'] = []) =>
      groups.length > 10 ||
      groups.some(
        (group) =>
          !bounded(group.count, 1, 10) ||
          !group.rewards.length ||
          (group.allowSkip !== undefined && typeof group.allowSkip !== 'boolean') ||
          (group.skipCoins !== undefined &&
            (!bounded(group.skipCoins) || (group.skipCoins > 0 && group.allowSkip === false))) ||
          group.rewards.some((id) => !rewards.has(id)),
      );
    const effects = (list: ShanhetuEffect[]) =>
      list.every(
        (effect) =>
          [
            'coins',
            'heal',
            'max-hp',
            'initial-cards',
            'draw',
            'armor',
            'extra-sha',
            'hand-limit',
            'skill-slot',
            'skill',
            'tactic',
            'card',
            'companion',
          ].includes(effect.kind) &&
          bounded(effect.amount, 0, effect.kind === 'companion' ? 1000000 : 100000) &&
          (effect.kind !== 'skill' || growth.skills.some((skill) => skill.id === effect.amount)) &&
          (effect.kind !== 'tactic' ||
            growth.tactics.some((tactic) => tactic.id === effect.amount)) &&
          (effect.kind !== 'card' || cards.some((card) => card.id === effect.amount)) &&
          (effect.kind !== 'companion' || !!shanhetuCompanion(effect.amount)),
      );
    if (
      !c.nodes.length ||
      c.nodes.length > 256 ||
      ids.size !== c.nodes.length ||
      rewards.size !== c.rewards.length ||
      c.rewards.length > 1000 ||
      (!c.entries.length && !c.regions) ||
      c.entries.some((id) => !ids.has(id)) ||
      !c.candidates.length ||
      c.candidates.length > 10 ||
      new Set(c.candidates).size !== c.candidates.length ||
      !bounded(c.initialCoins) ||
      !bounded(c.initialSkillSlots, 1, 3) ||
      (c.restartLimit !== undefined && !bounded(c.restartLimit, 0, 10)) ||
      (c.openingCompanions?.length ?? 0) > 1 ||
      (c.openingPackageId !== undefined && !this.validOpeningPackage(c.openingPackageId)) ||
      (c.openingBattleTactic !== undefined &&
        !growth.tactics.some((tactic) => tactic.id === c.openingBattleTactic)) ||
      c.openingCompanions?.some((id) => !shanhetuCompanion(id)) ||
      (c.openingRewards?.length && !c.heroChoices) ||
      invalidGroups(c.openingRewards) ||
      (c.heroChoices !== undefined &&
        (!c.heroChoices.length ||
          c.heroChoices.length > 40 ||
          new Set(c.heroChoices.map((hero) => `${hero.general}:${hero.group}`)).size !==
            c.heroChoices.length ||
          c.heroChoices.some(
            (hero) =>
              !c.candidates.includes(hero.general) ||
              !hero.name ||
              !['wei', 'shu', 'wu', 'qun', 'jin', 'shen'].includes(hero.group) ||
              !bounded(hero.hp, 1, 1000) ||
              !bounded(hero.maxHp, hero.hp, 1000),
          ))) ||
      c.rewards.some((reward) => !effects(reward.effects)) ||
      c.nodes.some(
        (node) =>
          !/^[\w-]{1,40}$/.test(node.id) ||
          !node.name ||
          !['battle', 'boss', 'event', 'camp', 'shop'].includes(node.kind) ||
          !bounded(node.chapter, 1, 3) ||
          !bounded(node.duration, 0, 100) ||
          (node.unlockDay !== undefined && !bounded(node.unlockDay, 0, 100)) ||
          (node.position !== undefined &&
            (!bounded(node.position.x, -2000, 2000) || !bounded(node.position.y, -2000, 2000))) ||
          node.next.some((id) => !ids.has(id)) ||
          (node.coins !== undefined && !bounded(node.coins)) ||
          (node.victoryRecovery !== undefined && !bounded(node.victoryRecovery, 0, 100)) ||
          (node.unlockSkillSlots !== undefined && !bounded(node.unlockSkillSlots, 1, 3)) ||
          (node.nextPriceIncrease !== undefined && !bounded(node.nextPriceIncrease)) ||
          (node.freeRefreshes !== undefined && !bounded(node.freeRefreshes, 0, 10)) ||
          (node.refreshPrice !== undefined && !bounded(node.refreshPrice)) ||
          (node.offerCount !== undefined && !bounded(node.offerCount, 1, 10)) ||
          (node.kind === 'battle' || node.kind === 'boss'
            ? !bounded(node.battleId, 1)
            : node.battleId !== undefined) ||
          invalidGroups(node.rewardGroups) ||
          (node.choices ?? []).some(
            (choice) =>
              !bounded(choice.cost) ||
              !effects(choice.effects) ||
              (choice.decisionId !== undefined && !bounded(choice.decisionId, 1)) ||
              (choice.encounter !== undefined &&
                (node.kind !== 'event' ||
                  !bounded(choice.encounter.battleId, 1) ||
                  (choice.encounter.coins !== undefined && !bounded(choice.encounter.coins)) ||
                  (choice.encounter.victoryRecovery !== undefined &&
                    !bounded(choice.encounter.victoryRecovery, 0, 100)) ||
                  invalidGroups(choice.encounter.rewardGroups))),
          ) ||
          ((node.kind === 'event' || node.kind === 'camp') && !node.choices?.length) ||
          [...(node.products ?? []), ...(node.refreshPool ?? [])].some(
            (product) => !rewards.has(product.rewardId) || !bounded(product.price),
          ) ||
          new Set(node.products?.map((item) => item.rewardId)).size !==
            (node.products?.length ?? 0) ||
          new Set(node.refreshPool?.map((item) => item.rewardId)).size !==
            (node.refreshPool?.length ?? 0),
      )
    )
      throw new Error('无效的山河图征程配置');
    for (const node of c.nodes) {
      if (node.battleId !== undefined) shanhetuRecipe(node.battleId, c.difficulty, 0, node.chapter);
      for (const choice of node.choices ?? [])
        if (choice.encounter)
          shanhetuRecipe(choice.encounter.battleId, c.difficulty, 0, node.chapter);
      if (!c.regions && !node.next.length && node.kind !== 'boss')
        throw new Error('征程必须以首领结束');
    }
    if (c.regions) return this.validateRegions();
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error('征程路线不能循环发放奖励');
      if (visited.has(id)) return;
      visiting.add(id);
      const current = c.nodes.find((node) => node.id === id)!;
      for (const next of current.next) {
        if (c.nodes.find((node) => node.id === next)!.chapter < current.chapter)
          throw new Error('征程章节不能倒退');
        visit(next);
      }
      visiting.delete(id);
      visited.add(id);
    };
    c.entries.forEach(visit);
    if (visited.size !== ids.size) throw new Error('征程包含不可抵达的节点');
  }

  private validateRegions(): void {
    const regions = this.catalog.regions!;
    const ids = new Set(regions.map((region) => region.id));
    const initial = regions.find((region) => region.id === this.catalog.initialRegion);
    const assigned = regions.flatMap((region) => region.nodes);
    if (
      !regions.length ||
      regions.length > 14 ||
      ids.size !== regions.length ||
      !initial ||
      initial.chapter !== 1 ||
      assigned.length !== this.catalog.nodes.length ||
      new Set(assigned).size !== assigned.length ||
      regions.some(
        (region) =>
          !/^[\w-]{1,40}$/.test(region.id) ||
          !region.name ||
          !bounded(region.chapter, 1, 3) ||
          !bounded(region.bossAt, 1, 30) ||
          !region.nodes.includes(region.boss) ||
          (!region.next.length && region.chapter !== 3) ||
          region.next.some(
            (id) =>
              !ids.has(id) ||
              regions.find((region) => region.id === id)!.chapter !== region.chapter + 1,
          ) ||
          region.nodes.some((id) => {
            const node = this.catalog.nodes.find((node) => node.id === id);
            return (
              !node ||
              node.chapter !== region.chapter ||
              node.next.length > 0 ||
              (node.kind === 'boss') !== (node.id === region.boss)
            );
          }) ||
          region.nodes
            .filter((id) => id !== region.boss)
            .reduce(
              (days, id) =>
                days + (this.catalog.nodes.find((node) => node.id === id)?.duration ?? 0),
              0,
            ) < region.bossAt,
      )
    )
      throw new Error('无效的山河图城间路线');
    // Prove each region can reach its boss even when zero-day shops are left
    // until last. No unlock rule may leave a route without a legal next step.
    for (const region of regions) {
      const nodes = region.nodes
        .map((id) => this.catalog.nodes.find((node) => node.id === id)!)
        .filter((node) => node.id !== region.boss);
      let days = 0;
      const pending = new Set(nodes);
      while (days < region.bossAt) {
        const available = [...pending].filter((node) => (node.unlockDay ?? 0) <= days);
        if (!available.length) throw new Error('山河图城内路线无法到达首领');
        for (const node of available) {
          pending.delete(node);
          days += node.duration;
        }
      }
    }
  }
}
