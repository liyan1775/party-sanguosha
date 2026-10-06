import type { ObserverState, ObserverLogPage } from '../../shared/src/contracts.js';
import type { MatchSetup } from './index.js';

/** Whitelist a deliberately small public view, never accept native state/storage. */
export function sanitizeObserver(value: unknown, setup: MatchSetup): ObserverState | null {
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
  return {
    updatedAt: Date.now(),
    round: count(data.round),
    ended: data.ended === true,
    currentPlayerId: setup.seats.some((seat) => seat.id === data.currentPlayerId)
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
            : player.controller && ['human', 'auto', 'offline'].includes(player.controller)
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

/** Per-match public text only. Previews stay small; earlier pages are local-only. */
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
