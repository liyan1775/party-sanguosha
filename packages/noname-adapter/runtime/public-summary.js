// SPDX-License-Identifier: GPL-3.0-only
import { lib, game } from 'noname';

/** The starting distribution minus publicly revealed deaths; no living roles. */
export function remainingIdentities(mode, seatCount, players) {
  if (mode !== 'identity') return null;
  const distribution = {
    5: [1, 1, 2, 1],
    6: [1, 1, 3, 1],
    7: [1, 2, 3, 1],
    8: [1, 2, 4, 1],
  }[seatCount];
  if (!distribution) return null;
  const labels = { 主公: 'zhu', 忠臣: 'zhong', 反贼: 'fan', 内奸: 'nei' };
  const counts = Object.fromEntries(
    ['zhu', 'zhong', 'fan', 'nei'].map((role, index) => [role, distribution[index]]),
  );
  for (const player of players) {
    if (!player.dead) continue;
    const role = labels[player.identity];
    if (role) counts[role] = Math.max(0, counts[role] - 1);
  }
  return counts;
}

/** Forward only the existing public projection, never an arena or choice. */
export function installPublicSummary() {
  const engine = globalThis.partyEngine;
  if (engine.setup.role !== 'worker') {
    engine.showPublicSummary = (summary) => {
      parent.postMessage(
        { type: 'party-public-summary', matchId: engine.setup.id, summary },
        location.origin,
      );
    };
    return;
  }
  let latest = null,
    key = '',
    lastSequence = 0;
  const actions = [];
  const display = function (summary) {
    globalThis.partyEngine.showPublicSummary?.(summary);
  };
  engine.publishPublicSummary = (state) => {
    state.identityCounts = remainingIdentities(
      engine.setup.settings.mode,
      engine.setup.seats.length,
      state.players,
    );
    for (const [offset, text] of state.recent.entries()) {
      const sequence = state.logStart + offset;
      if (sequence <= lastSequence) continue;
      if (
        !/进入了?.*阶段/.test(text) &&
        /使用了|打出了|弃置了|置入了弃牌堆|发动了|判定|展示了|亮出/.test(text)
      ) {
        actions.push({ sequence, text });
        if (actions.length > 3) actions.shift();
      }
      lastSequence = sequence;
    }
    const summary = {
      identityCounts: state.identityCounts,
      actions: actions.slice(),
      ...(Number.isSafeInteger(state.deckCount) ? { deckCount: state.deckCount } : {}),
    };
    const nextKey = JSON.stringify(summary);
    latest = summary;
    if (key === nextKey) return;
    key = nextKey;
    game.broadcast(display, summary);
  };
  const reinited = lib.message.server.reinited;
  lib.message.server.reinited = function (...args) {
    const result = reinited.apply(this, args);
    const player = lib.playerOL[this.id];
    if (latest && player?.ws === this) player.send(display, latest);
    return result;
  };
}
