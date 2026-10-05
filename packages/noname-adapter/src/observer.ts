import type { ObserverState } from '../../shared/src/contracts.js';
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
          equipment: Array.isArray(player.equipment)
            ? player.equipment.slice(0, 12).map((entry) => text(entry))
            : [],
          judgments: Array.isArray(player.judgments)
            ? player.judgments.slice(0, 12).map((entry) => text(entry))
            : [],
        },
      ];
    }),
    recent: data.recent.slice(-12).map((entry) => text(entry, 200)),
  };
}
