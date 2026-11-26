// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get, _status } from 'noname';
import {
  isConcealedDiscard,
  markPublicLogCards,
  publicCardVisible,
  rememberDiscardVisibility,
} from './privacy.js';

/** Only cards already disclosed to everyone, never private ordering/skill data. */
export function observerCardVisible(card) {
  return publicCardVisible(card);
}
function controller(player) {
  const seat = globalThis.partyEngine?.setup?.seats?.find((seat) => seat.id === player.playerid);
  if (seat?.kind === 'bot') return 'bot';
  if (!player.ws || player.ws.closed) return 'offline';
  if (player.ws.ws?.interrupted) return 'reconnecting';
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
  markPublicLogCards(args);
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

function publicIdentity(player) {
  if (globalThis.partyEngine?.setup?.settings?.mode === 'versus') {
    if (typeof player.side !== 'boolean') return '阵营待定';
    return player.side ? '蓝队' : '红队';
  }
  return player.identityShown || player.isZhu
    ? get.translation(`${player.identity}2`)
    : '身份未公开';
}

/** Public observer projection; no hand faces, deck, choice arguments or storage. */
export function publicObserverState(recent = []) {
  const players = [...game.players, ...game.dead];
  return {
    round: game.roundNumber || 0,
    currentPlayerId: _status.over ? null : (_status.currentPhase?.playerid ?? null),
    ended: !!_status.over,
    ...(ui?.cardPile ? { deckCount: ui.cardPile.childElementCount } : {}),
    players: players.map((player) => ({
      id: player.playerid,
      nickname: player.nickname,
      general: player.isUnseen?.(0)
        ? '未亮将'
        : get.translation(player.name1 || player.name || '未选将'),
      identity: publicIdentity(player),
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

export function createPublicCardTracker(template) {
  const { cardKeys, ...pile } = template;
  const seen = new WeakSet();
  const counts = new Map();
  const recent = [];
  let knownPublicCount = 0;
  let unknownDiscards = 0;
  let epoch = 0;
  let latest;
  let previous;
  function reveal(card, action, player) {
    if (
      get.itemtype(card) !== 'card' ||
      card.isViewAsCard ||
      seen.has(card) ||
      !publicCardVisible(card) ||
      card.name === 'party_unknown'
    )
      return;
    seen.add(card);
    const key = Object.hasOwn(cardKeys, card.name) ? cardKeys[card.name] : null;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    recent.push({
      seq: ++knownPublicCount,
      cardName: [...get.translation(card.name).replace(/<[^>]*>/g, '')].slice(0, 10).join(''),
      suit: ['spade', 'heart', 'club', 'diamond'].includes(card.suit) ? card.suit : 'none',
      number:
        Number.isInteger(card.number) && card.number >= 1 && card.number <= 13 ? card.number : null,
      actor: [...(player?.nickname ?? '')].slice(0, 16).join(''),
      action,
    });
    if (recent.length > 12) recent.shift();
  }
  function discarded(card, player, concealed) {
    if (get.itemtype(card) !== 'card' || card.isViewAsCard) return;
    rememberDiscardVisibility(card, concealed);
    if (concealed) unknownDiscards++;
    else reveal(card, 'discard', player);
  }
  function snapshot(deckCount, shuffledCount) {
    const key = [deckCount, shuffledCount, knownPublicCount, unknownDiscards].join('/');
    if (previous !== key) {
      previous = key;
      latest = {
        epoch: ++epoch,
        ...pile,
        deckCount,
        shuffledCount,
        knownPublicCount,
        unknownDiscards,
        categories: pile.categories.map((category) => ({
          ...category,
          seen: counts.get(category.key) ?? 0,
        })),
        recentRevealed: recent.slice(),
      };
      // Shorten display text only if needed, keeping the latest twelve
      // sequence numbers and card faces within the public snapshot budget.
      const encoder = new TextEncoder();
      for (const limit of [6, 3, 1]) {
        if (encoder.encode(JSON.stringify(latest)).length < 2048) break;
        latest.recentRevealed = latest.recentRevealed.map((entry) => ({
          ...entry,
          actor: [...entry.actor].slice(0, limit).join(''),
          cardName: [...entry.cardName].slice(0, Math.max(limit, 3)).join(''),
        }));
      }
    }
    return latest;
  }
  return { reveal, discarded, snapshot };
}

function trackPublicLogCards(tracker, args, event) {
  const [actor, verb, detail] = args;
  const player = event?.player ?? (get.itemtype(actor) === 'player' ? actor : undefined);
  if (!event) return;
  if (['useCard', 'respond'].includes(event.name)) {
    const index = args.indexOf(event.name === 'useCard' ? '使用了' : '打出了');
    if (index >= 1 && args[index + 1] === event.card) {
      const declared = args[index + 3];
      const action = event.name === 'useCard' ? 'use' : 'respond';
      for (const card of event.cards ?? []) {
        if (
          card === event.card ||
          (Array.isArray(declared) && declared.includes(card)) ||
          (event.cards.length === 1 && event.card?.isCard === true)
        )
          tracker.reveal(card, action, player);
      }
      return;
    }
  }
  if (event.name === 'judge' && verb === '的判定结果为' && detail === event.result?.card)
    tracker.reveal(detail, 'judge', player);
  if (['亮出了', '展示了', '明置了'].includes(verb) && Array.isArray(detail)) {
    for (const card of detail) {
      if (event.hiddencards?.includes(card) || event.hiddenCards?.includes(card)) continue;
      tracker.reveal(card, 'show', player);
    }
  }
}

function installDiscardTracking(tracker) {
  const pile = ui?.discardPile;
  if (!pile) return;
  for (const method of ['appendChild', 'insertBefore']) {
    const original = pile[method];
    pile[method] = function (card, ...args) {
      const moved = card.parentNode !== this;
      const concealed = moved && isConcealedDiscard(card);
      const result = original.call(this, card, ...args);
      if (moved && card.parentNode === this)
        tracker.discarded(card, get.event()?.player, concealed);
      return result;
    };
  }
}

function publicMatchStats() {
  const totals = new Map();
  const highlights = [];
  let firstKill;
  function stats(player) {
    const id = player?.playerid;
    if (!id) return null;
    if (!totals.has(id))
      totals.set(id, {
        playerId: id,
        damageDealt: 0,
        damageTaken: 0,
        kills: 0,
        cardsUsed: 0,
        skillsTriggered: 0,
        disruptCount: 0,
      });
    return totals.get(id);
  }
  function highlight(kind, actor, target, amount) {
    highlights.push({ kind, actor: actor?.playerid, target: target.playerid, amount });
    const priority = (entry) => (entry.kind === 'kill' ? 100 + entry.amount : entry.amount);
    highlights.sort((a, b) => priority(b) - priority(a));
    if (highlights.length > 4) highlights.pop();
  }
  function record(args, event) {
    const [player, verb, source, suffix] = args;
    if (get.itemtype(player) !== 'player') return;
    const targetStats = stats(player);
    if (!targetStats) return;
    if (
      event?.name === 'damage' &&
      event.player === player &&
      typeof verb === 'string' &&
      verb.startsWith('受到了') &&
      verb.endsWith('伤害') &&
      Number.isSafeInteger(event.num) &&
      event.num > 0
    ) {
      targetStats.damageTaken += event.num;
      const sourceStats = stats(event.source);
      if (sourceStats) sourceStats.damageDealt += event.num;
      if (event.num >= 2) highlight('damage', event.source, player, event.num);
    } else if (
      event?.name === 'die' &&
      event.player === player &&
      verb === '被' &&
      suffix === '杀害'
    ) {
      const killer = stats(source);
      if (killer) {
        firstKill ??= killer.playerId;
        highlight('kill', source, player, ++killer.kills);
      }
    } else if (
      event?.name === 'useCard' &&
      args.includes('使用了') &&
      args[args.indexOf('使用了') + 1] === event.card
    ) {
      targetStats.cardsUsed++;
      if (['guohe', 'shunshou'].includes(event.card?.name)) targetStats.disruptCount++;
    } else if (
      args
        .slice(1)
        .some(
          (arg, index) =>
            typeof arg === 'string' &&
            arg.endsWith('发动了') &&
            typeof args[index + 2] === 'string' &&
            args[index + 2].startsWith('【'),
        )
    ) {
      targetStats.skillsTriggered++;
    }
  }
  return {
    record,
    snapshot: () => ({ players: [...totals.values()], highlights: highlights.slice(), firstKill }),
  };
}

export function installObserver(publish) {
  const giftStreaks = new Map();
  globalThis.partyEngine.observeGift = (sender, target) => {
    if (_status.over || !sender?.playerid || !target?.playerid) return;
    const targetId = target.playerid;
    const at = Date.now();
    const last = giftStreaks.get(targetId);
    const count = last?.sender === sender && at - last.at < 2500 ? last.count + 1 : 1;
    giftStreaks.set(targetId, { sender, count: Math.min(count, 99), at });
  };
  const recent = [],
    controls = new Map();
  let total = 0,
    last = '',
    ended = false;
  let announcedShuffles = 0;
  let drawn = false;
  const template = globalThis.partyEngine.setup.cardTrackerTemplate;
  const tracker = template && createPublicCardTracker(template);
  if (tracker) installDiscardTracking(tracker);
  const statistics = publicMatchStats();
  // Native game.over sends itself to players. Leave that function intact
  // and observe only the exact public title of the rule host's result dialog.
  const dialog = ui?.create?.dialog;
  if (dialog)
    ui.create.dialog = function (...args) {
      if (_status.over && ['平局', '游戏平局', '战斗平局'].includes(args[0])) drawn = true;
      return dialog.apply(this, args);
    };
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
        next === 'reconnecting'
          ? '连接中断，等待原座位重连'
          : next === 'offline'
            ? globalThis.partyEngine.proof.started
              ? '断线，后续选择由原生 AI 接管'
              : '断线，保留未完成选择至原截止时间'
            : next === 'auto'
              ? '开启原生托管'
              : ['offline', 'reconnecting'].includes(before)
                ? '重新连接，恢复手动操作'
                : '恢复手动操作';
      record(`${playerLabel(player)} · ${label}`);
    }
  }
  function update() {
    controlChanges();
    if (!lib.configOL.gameStarted) return;
    const shuffledCount = game.shuffleNumber ?? 0;
    if (shuffledCount > announcedShuffles) {
      announcedShuffles = shuffledCount;
      record(`已洗牌（本局第 ${shuffledCount} 次）`);
    }
    if (_status.over && !ended) {
      ended = true;
      record('本局结束');
    }
    const state = {
      ...publicObserverState(recent.slice()),
      logStart: total - recent.length + 1,
      logTotal: total,
    };
    const now = Date.now();
    const giftCombos = [];
    for (const [targetId, gift] of giftStreaks) {
      if (now - gift.at >= 3500 || state.ended) giftStreaks.delete(targetId);
      else if (gift.count > 1) giftCombos.push({ targetId, count: gift.count, at: gift.at });
    }
    if (giftCombos.length) state.giftCombos = giftCombos;
    if (tracker && Number.isSafeInteger(state.deckCount))
      state.cardTracker = tracker.snapshot(state.deckCount, shuffledCount);
    if (state.ended) {
      const mode = globalThis.partyEngine.setup.settings?.mode;
      const winners =
        drawn || mode === 'shanhetu'
          ? []
          : [...game.players, ...game.dead]
              .filter((player) =>
                mode === 'duel' ? !player.isDead() : game.checkOnlineResult?.(player) === true,
              )
              .map((player) => player.playerid);
      state.settlement = { ...statistics.snapshot(), drawn, winners };
    }
    const key = JSON.stringify(state);
    if (key === last) return;
    if (!globalThis.partyEngine.ruleSocket || globalThis.partyEngine.ruleSocket.readyState === 1)
      last = key;
    publish(state);
  }
  const log = game.log;
  game.log = function (...args) {
    const text = publicLogText(args);
    if (lib.configOL.gameStarted && !_status.over) {
      const event = get.event();
      if (tracker) trackPublicLogCards(tracker, args, event);
      statistics.record(args, event);
    }
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
