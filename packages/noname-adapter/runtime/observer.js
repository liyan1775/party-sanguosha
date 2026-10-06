// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, get, _status } from 'noname';

/** Only cards already disclosed to everyone, never private ordering/skill data. */
export function observerCardVisible(card) {
  if (['e', 'j', 'd'].includes(get.position(card, true))) return true;
  if (card._knowers?.includes('everyone') || get.is.shownCard(card)) return true;
  const seen = new Set();
  for (let event = get.event(), depth = 0; event && depth < 32 && !seen.has(event); depth++) {
    seen.add(event);
    if (event.partyShownCompareCards?.includes(card)) return true;
    if (
      ['useCard', 'respond', 'discard', 'showCards'].includes(event.name) &&
      event.cards?.includes(card)
    )
      return true;
    if (
      event.name === 'useCard' &&
      event.card?.name === 'wugu' &&
      event.wuguShownCards?.includes(card)
    )
      return true;
    if (event.name === 'reyajiao' && event.card === card) return true;
    if (
      event.name === 'judge' &&
      (event.player?.judging?.includes(card) || event.result?.card === card)
    )
      return true;
    event = event.getParent?.();
  }
  return false;
}
function controller(player) {
  const seat = globalThis.partyEngine?.setup?.seats?.find((seat) => seat.id === player.playerid);
  if (seat?.kind === 'bot') return 'bot';
  if (!player.ws || player.ws.closed) return 'offline';
  return player.isAuto ? 'auto' : 'human';
}
function playerLabel(player) {
  const name =
    globalThis.partyEngine.setup.seats.find((seat) => seat.id === player.playerid)?.nickname ??
    player.nickname;
  const general = !player.isUnseen?.(0) && (player.name1 || player.name);
  return `${name}${general ? `（${get.translation(general)}）` : ''}`;
}
/** Native game.log is the publication boundary; project its arguments explicitly. */
export function publicLogText(args) {
  function valueText(value) {
    const type = get.itemtype(value);
    if (type === 'player') return playerLabel(value);
    if (type === 'players') return value.map(playerLabel).join('、');
    if (type === 'cards') return value.map(valueText).join('、');
    if (type === 'card') return observerCardVisible(value) ? get.translation(value) : '暗牌';
    // Virtual card names are public only when the native use/respond log emits
    // the declared card. Do not translate arbitrary objects or their storage.
    if (value && typeof value === 'object') {
      const event = get.event();
      if (['useCard', 'respond'].includes(event?.name) && event.card === value)
        return get.translation(value.name);
      return '';
    }
    if (typeof value === 'number') return String(value);
    if (typeof value !== 'string') return '';
    // All final DOM text uses textContent. Nicknames above stay literal.
    return get.translation(value.replace(/^#[rygb]/, '')).replace(/<[^>]*>/g, '');
  }
  return args.map(valueText).join('').trim().slice(0, 500);
}

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
      controller: controller(player),
      equipment: player.getCards('e').map((card) => get.translation(card.name)),
      judgments: player.getCards('j').map((card) => get.translation(card.viewAs || card.name)),
    })),
    recent,
  };
}

export function installObserver(publish) {
  const recent = [],
    controls = new Map();
  let total = 0,
    last = '',
    ended = false;
  function record(text) {
    if (!text) return;
    recent.push(text);
    total++;
    // Keep previews inside the gateway's 128 KiB native frame limit, even
    // with long escaped text. Earlier batches remain in the Node journal.
    if (recent.length > 32) recent.shift();
    // Flush synchronous bursts before they overrun the next timer batch.
    if (total % 32 === 0) update();
  }
  function controlChanges() {
    for (const player of [...game.players, ...game.dead]) {
      const next = controller(player),
        before = controls.get(player.playerid);
      controls.set(player.playerid, next);
      if (!before || before === next || next === 'bot' || _status.over) continue;
      const label =
        next === 'offline'
          ? globalThis.partyEngine.proof.started
            ? '断线，后续选择由原生 AI 接管'
            : '断线，保留未完成选择至原截止时间'
          : next === 'auto'
            ? '开启原生托管'
            : before === 'offline'
              ? '重新连接，恢复手动操作'
              : '恢复手动操作';
      record(`${playerLabel(player)} · ${label}`);
    }
  }
  function update() {
    controlChanges();
    if (!lib.configOL.gameStarted) return;
    if (_status.over && !ended) {
      ended = true;
      record('本局结束');
    }
    const state = {
      ...publicObserverState(recent.slice()),
      logStart: total - recent.length + 1,
      logTotal: total,
    };
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    publish(state);
  }
  const log = game.log;
  game.log = function (...args) {
    const text = publicLogText(args);
    const result = log.apply(this, args);
    record(text);
    return result;
  };
  const close = lib.element.Client.prototype.close;
  lib.element.Client.prototype.close = function (...args) {
    const result = close.apply(this, args);
    controlChanges();
    return result;
  };
  for (const name of ['init', 'reinited', 'auto', 'unauto']) {
    const original = lib.message.server[name];
    if (!original) continue;
    lib.message.server[name] = function (...args) {
      const result = original.apply(this, args);
      controlChanges();
      return result;
    };
  }
  const timer = setInterval(update, 500);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  return update;
}
