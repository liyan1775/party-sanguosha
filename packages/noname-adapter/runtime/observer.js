// SPDX-License-Identifier: GPL-3.0-only
import { game, get, _status } from 'noname';

/** Public observer projection; no hand faces, deck, choice arguments or storage. */
export function publicObserverState(recent = []) {
  const players = [...game.players, ...game.dead];
  return {
    round: game.roundNumber || 0,
    currentPlayerId: _status.currentPhase?.playerid ?? null,
    ended: !!_status.over,
    players: players.map((player) => ({
      id: player.playerid,
      nickname: player.nickname,
      general: player.isUnseen?.(0)
        ? '未亮将'
        : get.translation(player.name1 || player.name || '未选将'),
      identity:
        _status.over || player.identityShown || player.isZhu || player.isDead()
          ? get.translation(`${player.identity}2`)
          : '身份未公开',
      hp: player.hp,
      maxHp: player.maxHp,
      armor: player.hujia || 0,
      handCount: player.countCards('h'),
      dead: player.isDead(),
      linked: player.isLinked(),
      turnedOver: player.isTurnedOver(),
      equipment: player.getCards('e').map((card) => get.translation(card.name)),
      judgments: player.getCards('j').map((card) => get.translation(card.viewAs || card.name)),
    })),
    recent,
  };
}

export function installObserver(publish) {
  const recent = [];
  const recorded = new WeakSet();
  let last = '';
  function update() {
    if (!globalThis.partyEngine.proof.started) return;
    let event = get.event();
    for (let depth = 0; event && depth < 20; depth++, event = event.getParent?.()) {
      if (
        !['useCard', 'respond'].includes(event.name) ||
        !event.card ||
        !event.player ||
        !event.cards?.length ||
        recorded.has(event)
      )
        continue;
      // Record only after the materials have left the concealed hand. Merely
      // constructing a useCard event does not make a private decision public.
      if (event.cards.some((card) => get.position(card, true) === 'h')) continue;
      recorded.add(event);
      recent.push(
        `${event.player.nickname} · ${event.name === 'respond' ? '响应' : '使用'}${get.translation(event.card.name)}`,
      );
      if (recent.length > 12) recent.shift();
    }
    const state = publicObserverState(recent.slice());
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    publish(state);
  }
  const timer = setInterval(update, 500);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  return update;
}
