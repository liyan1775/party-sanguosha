import type {
  ObserverState,
  ObserverLogPage,
  PublicCardCategory,
  PublicCardTrackerSnapshot,
  PublicMatchAward,
  PublicMatchPlayerStats,
  PublicMatchSummary,
} from '../../shared/src/contracts.js';
import type { CardPile } from '../runtime/card-pile.js';
import inventory from '../../../config/native-card-inventory.json' with { type: 'json' };
import type { MatchSetup } from './index.js';

const cardGroups = [
  ['sha', '杀', ['sha']],
  ['shan', '闪', ['shan']],
  ['tao', '桃', ['tao']],
  ['jiu', '酒', ['jiu']],
  ['wuxie', '无懈', ['wuxie']],
  ['aoe', '群攻', ['nanman', 'wanjian']],
  ['control', '顺/拆', ['shunshou', 'guohe']],
  ['delay', '乐/兵', ['lebu', 'bingliang']],
  ['juedou', '决斗', ['juedou']],
  ['wuzhong', '无中生有', ['wuzhong']],
] as const;
const pileNames = { standard108: '标准108', military160: '军争160', shanhetu135: '山河图135' };

export function publicCardTemplate(pile: CardPile) {
  const pileId = Object.hasOwn(pileNames, pile.id)
    ? (pile.id as keyof typeof pileNames)
    : 'unknown';
  const cards = inventory.packs
    .filter((pack) => pileId !== 'unknown' && pile.packs.includes(pack.id))
    .flatMap((pack) => pack.cards)
    .filter((card) => !pile.excludedCards.includes(card.id));
  return {
    pileId,
    pileName: pileId === 'unknown' ? '未知牌堆' : pileNames[pileId],
    totalCards: pileId === 'unknown' ? 0 : pile.cardCount,
    categories: cardGroups.map(([key, label, ids]) => ({
      key,
      label,
      templateTotal: cards.reduce(
        (sum, card) => sum + ((ids as readonly string[]).includes(card.id) ? card.count : 0),
        0,
      ),
    })),
    cardKeys: Object.fromEntries(
      cardGroups.flatMap(([key, , ids]) => ids.map((id) => [id, key] as const)),
    ) as Record<string, PublicCardCategory>,
  } as const;
}

type CardTemplate = ReturnType<typeof publicCardTemplate>;
const nonnegative = (value: unknown, limit = 1_000_000): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= limit;
const shortText = (value: unknown, length: number) =>
  typeof value === 'string'
    ? [...value.replace(/[\p{Cc}\p{Cf}]/gu, '')].slice(0, length).join('')
    : '';

function sanitizeCardTracker(
  value: PublicCardTrackerSnapshot | undefined,
  template: CardTemplate,
  deckCount: number,
): PublicCardTrackerSnapshot | undefined {
  if (
    !value ||
    value.pileId !== template.pileId ||
    value.deckCount !== deckCount ||
    !nonnegative(value.epoch) ||
    value.epoch < 1 ||
    !nonnegative(value.shuffledCount) ||
    !nonnegative(value.knownPublicCount) ||
    !nonnegative(value.unknownDiscards) ||
    !Array.isArray(value.categories) ||
    value.categories.length !== template.categories.length ||
    !Array.isArray(value.recentRevealed)
  )
    return;
  const { cardKeys: _cardKeys, ...pile } = template;
  const categories = pile.categories.map((category, index) => {
    const entry = value.categories[index];
    return {
      ...category,
      seen:
        entry?.key === category.key && nonnegative(entry.seen, value.knownPublicCount)
          ? entry.seen
          : 0,
    };
  });
  if (categories.reduce((total, category) => total + category.seen, 0) > value.knownPublicCount)
    return;
  let lastSeq = 0;
  const recentRevealed = value.recentRevealed.slice(-12).flatMap((entry) => {
    if (
      !entry ||
      !nonnegative(entry.seq, value.knownPublicCount) ||
      entry.seq <= lastSeq ||
      !['spade', 'heart', 'club', 'diamond', 'none'].includes(entry.suit) ||
      !['use', 'respond', 'discard', 'judge', 'show'].includes(entry.action)
    )
      return [];
    const cardName = shortText(entry.cardName, 10);
    if (!cardName) return [];
    lastSeq = entry.seq;
    return [
      {
        seq: entry.seq,
        cardName,
        suit: entry.suit,
        number: nonnegative(entry.number, 13) && entry.number > 0 ? entry.number : null,
        action: entry.action,
        actor: shortText(entry.actor, 16),
      },
    ];
  });
  const snapshot = {
    ...pile,
    epoch: value.epoch,
    deckCount,
    shuffledCount: value.shuffledCount,
    knownPublicCount: value.knownPublicCount,
    unknownDiscards: value.unknownDiscards,
    categories,
    recentRevealed,
  };
  return Buffer.byteLength(JSON.stringify(snapshot)) < 2048 ? snapshot : undefined;
}

/** Whitelist a deliberately small public view, never accept native state/storage. */
export function sanitizeObserver(
  value: unknown,
  setup: MatchSetup,
  template?: CardTemplate,
): ObserverState | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as ObserverState;
  if (!Array.isArray(data.players) || data.players.length > 8 || !Array.isArray(data.recent))
    return null;
  const text = (value: unknown, limit = 100) =>
    typeof value === 'string' ? value.slice(0, limit) : '';
  const count = (value: unknown, max = 1000) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(-100, Math.min(max, Math.round(value)))
      : 0;
  const deckCount = nonnegative(data.deckCount, 10000) ? data.deckCount : undefined;
  const cardTracker =
    template && deckCount !== undefined
      ? sanitizeCardTracker(data.cardTracker, template, deckCount)
      : undefined;
  const updatedAt = Date.now();
  const giftCombos =
    !data.ended && Array.isArray(data.giftCombos) && data.giftCombos.length <= 8
      ? data.giftCombos.flatMap((gift) => {
          if (
            !gift ||
            !setup.seats.some((seat) => seat.id === gift.targetId) ||
            !Number.isSafeInteger(gift.count) ||
            gift.count < 2 ||
            gift.count > 99 ||
            !Number.isSafeInteger(gift.at) ||
            gift.at <= updatedAt - 3500 ||
            gift.at > updatedAt
          )
            return [];
          const { targetId, count, at } = gift;
          return [{ targetId, count, at }];
        })
      : [];
  return {
    updatedAt,
    round: count(data.round),
    ended: data.ended === true,
    ...(setup.settings.mode === 'identity' &&
    data.identityCounts &&
    ['zhu', 'zhong', 'fan', 'nei'].every(
      (role) =>
        Number.isSafeInteger(
          data.identityCounts![role as keyof NonNullable<ObserverState['identityCounts']>],
        ) &&
        data.identityCounts![role as keyof NonNullable<ObserverState['identityCounts']>] >= 0 &&
        data.identityCounts![role as keyof NonNullable<ObserverState['identityCounts']>] <= 8,
    )
      ? {
          identityCounts: {
            zhu: data.identityCounts.zhu,
            zhong: data.identityCounts.zhong,
            fan: data.identityCounts.fan,
            nei: data.identityCounts.nei,
          },
        }
      : {}),
    ...(deckCount !== undefined ? { deckCount } : {}),
    ...(cardTracker ? { cardTracker } : {}),
    ...(giftCombos.length ? { giftCombos } : {}),
    currentPlayerId:
      data.ended !== true && setup.seats.some((seat) => seat.id === data.currentPlayerId)
        ? data.currentPlayerId
        : null,
    players: data.players.flatMap((player) => {
      const seat = setup.seats.find((seat) => seat.id === player?.id);
      if (!seat) return [];
      return [
        {
          id: seat.id,
          nickname: seat.nickname,
          general: text(player.general),
          identity: text(player.identity),
          hp: count(player.hp),
          maxHp: count(player.maxHp),
          armor: count(player.armor),
          handCount: Math.max(0, count(player.handCount)),
          dead: player.dead === true,
          linked: player.linked === true,
          turnedOver: player.turnedOver === true,
          ...(seat.kind === 'bot'
            ? { controller: 'bot' as const }
            : player.controller &&
                ['human', 'auto', 'offline', 'reconnecting'].includes(player.controller)
              ? { controller: player.controller }
              : {}),
          equipment: Array.isArray(player.equipment)
            ? player.equipment.slice(0, 12).map((entry) => text(entry))
            : [],
          judgments: Array.isArray(player.judgments)
            ? player.judgments.slice(0, 12).map((entry) => text(entry))
            : [],
        },
      ];
    }),
    recent: data.recent.slice(-100).map((entry) => text(entry, 500)),
    ...(Number.isSafeInteger(data.logStart) &&
    Number.isSafeInteger(data.logTotal) &&
    data.logStart! >= 1 &&
    data.logTotal! >= 0 &&
    data.logTotal === data.logStart! + data.recent.length - 1
      ? {
          logStart: data.logStart! + Math.max(0, data.recent.length - 100),
          logTotal: data.logTotal,
        }
      : {}),
  };
}

const statKeys = [
  'damageDealt',
  'damageTaken',
  'kills',
  'cardsUsed',
  'skillsTriggered',
  'disruptCount',
] as const;
type SummaryPlayer = PublicMatchSummary['players'][number];
type PublicSettlement = {
  drawn?: unknown;
  winners?: unknown[];
  firstKill?: unknown;
  players?: (Partial<PublicMatchPlayerStats> & { playerId?: unknown })[];
  highlights?: { kind?: unknown; actor?: unknown; target?: unknown; amount?: unknown }[];
};

export function publicMatchAwards(
  players: SummaryPlayer[],
  firstKill?: string,
  winner?: string,
): PublicMatchAward[] {
  const awards: PublicMatchAward[] = [];
  const award = (title: string, player: SummaryPlayer | undefined, detail: string) => {
    if (player)
      awards.push({
        title,
        holderNickname: player.nickname,
        generalName: player.generalName,
        detail,
      });
  };
  const most = (key: keyof PublicMatchPlayerStats) =>
    players.reduce<SummaryPlayer | undefined>(
      (best, player) => (player[key] > (best?.[key] ?? 0) ? player : best),
      undefined,
    );
  const output = most('damageDealt');
  if (output) award('全场输出王', output, `造成 ${output.damageDealt} 点公开伤害`);
  award(
    '一血奇迹',
    players.find((player) => player.playerId === firstKill),
    '完成本局首次击杀',
  );
  const disrupt = most('disruptCount');
  if (disrupt)
    award('拆迁大队长', disrupt, `公开使用顺手牵羊或过河拆桥 ${disrupt.disruptCount} 次`);
  const skills = most('skillsTriggered');
  if (skills) award('技能大师', skills, `公开发动技能 ${skills.skillsTriggered} 次`);
  award(
    '天选常胜',
    players.find((player) => player.playerId === winner),
    '赢得本局',
  );
  if (awards.length < 2) {
    const survivor = players.find((player) => player.alive);
    award('坚持到底', survivor, '存活至本局结算');
    if (awards.length < 2)
      award('聚会搭档', players.find((player) => player !== survivor) ?? survivor, '参与本局对战');
    if (awards.length < 2) award('有约必到', players[1] ?? players[0], '入座完成本局');
  }
  return awards.slice(0, 4);
}

export function completedPublicMatch(
  state: ObserverState | null,
  value: unknown,
  setup: MatchSetup,
  matchId: string,
  finishedAt: number,
): PublicMatchSummary | undefined {
  if (!state?.ended) return;
  const settlement: PublicSettlement = value && typeof value === 'object' ? value : {};
  const players = state.players.map((player): SummaryPlayer => {
    const raw = Array.isArray(settlement.players)
      ? settlement.players.find((entry) => entry?.playerId === player.id)
      : undefined;
    const stats = Object.fromEntries(
      statKeys.map((key) => {
        const value = raw?.[key];
        return [key, nonnegative(value) ? value : 0];
      }),
    ) as unknown as PublicMatchPlayerStats;
    return {
      playerId: player.id,
      nickname: player.nickname,
      generalName: player.general,
      ...(player.identity && player.identity !== '身份未公开'
        ? { identityLabel: player.identity }
        : {}),
      alive: !player.dead,
      ...stats,
    };
  });
  const playerFor = (id: unknown) => players.find((player) => player.playerId === id);
  const winners = Array.isArray(settlement.winners)
    ? players.filter((player) => settlement.winners!.includes(player.playerId))
    : [];
  let winnerLabel = '本局结束';
  if (settlement.drawn === true) winnerLabel = '平局';
  else if (winners.length) {
    const first = winners.find((player) => player.alive) ?? winners[0]!;
    if (setup.settings.mode === 'identity') {
      if (winners.some((player) => player.identityLabel === '主公')) winnerLabel = '主忠方获胜';
      else if (first.identityLabel === '反贼') winnerLabel = '反贼获胜';
      else if (first.identityLabel === '内奸') winnerLabel = '内奸获胜';
      else winnerLabel = `${first.nickname}获胜`;
    } else winnerLabel = `${winners.map((player) => player.nickname).join('、')}获胜`;
  }
  const highlights = Array.isArray(settlement.highlights)
    ? settlement.highlights.slice(0, 4).flatMap((entry) => {
        const target = playerFor(entry?.target);
        const actor = playerFor(entry?.actor);
        if (!target || !nonnegative(entry?.amount)) return [];
        if (entry.kind === 'kill' && actor)
          return [
            `${actor.nickname}击杀${target.nickname}${entry.amount > 1 ? `，本局第 ${entry.amount} 次击杀` : ''}`,
          ];
        if (entry.kind === 'damage' && entry.amount >= 2)
          return [
            actor
              ? `${actor.nickname}对${target.nickname}造成 ${entry.amount} 点伤害`
              : `${target.nickname}受到 ${entry.amount} 点伤害`,
          ];
        return [];
      })
    : [];
  return {
    matchId,
    mode: setup.settings.mode,
    finishedAt,
    rounds: Math.max(0, state.round),
    winnerLabel,
    players,
    highlights,
    awards: publicMatchAwards(
      players,
      playerFor(settlement.firstKill)?.playerId,
      settlement.drawn === true
        ? undefined
        : (winners.find((player) => player.alive) ?? winners[0])?.playerId,
    ),
  };
}

/** Per-match public text only; shared by authorized history and public spectating. */
export class ObserverJournal {
  private entries: ObserverLogPage['entries'] = [];
  private total = 0;
  static readonly limit = 10000;

  append(state: ObserverState): void {
    if (state.logStart === undefined || state.logTotal === undefined) return;
    for (const [offset, text] of state.recent.entries()) {
      const sequence = state.logStart + offset;
      if (sequence <= this.total) continue;
      this.entries.push({ sequence, text });
      this.total = sequence;
    }
    if (this.entries.length > ObserverJournal.limit)
      this.entries.splice(0, this.entries.length - ObserverJournal.limit);
    state.logFirst = this.entries[0]?.sequence ?? 1;
  }

  page(matchId: string, before = this.total + 1): ObserverLogPage {
    return {
      matchId,
      total: this.total,
      first: this.entries[0]?.sequence ?? 1,
      entries: this.entries.filter((entry) => entry.sequence < before).slice(-100),
    };
  }
}
