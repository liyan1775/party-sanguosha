// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, get, _status } from 'noname';
import { observerCardVisible } from './observer.js';

/** Capture native publication/animation calls. Never inspect a hand or storage. */
export function installTablePresentation() {
  const setup = globalThis.partyEngine.setup;
  let sequence = 0,
    current,
    currentTurn;
  const logged = new WeakSet(),
    active = new Set();
  function capture(run) {
    try {
      run();
    } catch {
      // Presentation failures must not interrupt the original rules or actions.
    }
  }
  const plain = (value) =>
    String(value ?? '')
      .replace(/<[^>]*>/g, '')
      .slice(0, 160);
  function face(card) {
    const known = card?.name && card.name !== 'party_unknown';
    return {
      label: known
        ? (card.name === 'sha'
            ? String(card.nature ?? '')
                .split('|')
                .map((nature) => ({ fire: '火', thunder: '雷', ice: '冰' })[nature] ?? '')
                .join('')
            : '') + plain(get.translation(card.name))
        : '暗牌',
      suit: known ? ({ spade: '♠', heart: '♥', club: '♣', diamond: '♦' }[card.suit] ?? '') : '',
      number: known
        ? String(({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[card.number] ?? card.number) || '')
        : '',
      nature: known ? plain(card.nature) : '',
      image:
        known && /^[\w-]+$/.test(card.name) ? `${setup.assetBase}image/card/${card.name}.png` : '',
    };
  }
  function emit(
    kind,
    player,
    {
      targets = [],
      cards = [],
      count = 0,
      label = '',
      amount = 0,
      nature = '',
      virtual = false,
    } = {},
  ) {
    if (!player?.playerid) return;
    const id = ++sequence,
      at = Date.now();
    for (const seat of setup.seats) {
      if (seat.kind !== 'human') continue;
      const receiver = lib.playerOL?.[seat.id];
      if (!receiver?.ws || receiver.ws.closed) continue;
      const event = {
        id,
        at,
        kind,
        source: player.playerid,
        targets: targets.filter((target) => target?.playerid).map((target) => target.playerid),
        count,
        label: plain(label),
        amount,
        nature: plain(nature),
        cards: cards.slice(0, 8).map((card) => {
          // A public virtual use/respond is identified only at game.log.
          // Drawn unowned cards must NOT inherit addressed-to visibility.
          const visible =
            virtual ||
            card.isKnownBy?.(receiver) ||
            observerCardVisible(card) ||
            (kind === 'draw' && receiver === player);
          return face(visible ? card : null);
        }),
      };
      receiver.send(function (event) {
        globalThis.partyEngine?.present?.(event);
      }, event);
    }
  }
  function turn() {
    if (!_status.currentPhase || _status.over) return;
    const event = get.event();
    const parent = event?.name === 'phase' ? event : event?.getParent?.('phase');
    const phase = parent?.name === 'phase' ? parent : undefined;
    if (_status.currentPhase === current && (!phase || phase === currentTurn)) return;
    current = _status.currentPhase;
    if (phase) currentTurn = phase;
    emit('turn', current, { label: '回合开始' });
  }
  function wrap(name, record) {
    const original = lib.element.Player.prototype[name];
    if (typeof original !== 'function') return;
    lib.element.Player.prototype[name] = function (...args) {
      if (!active.has(name)) {
        active.add(name);
        try {
          capture(() => {
            turn();
            record.call(this, ...args);
          });
          return original.apply(this, args);
        } finally {
          active.delete(name);
        }
      }
      return original.apply(this, args);
    };
  }
  wrap('$draw', function (value) {
    const cards = Array.isArray(value) ? value : get.itemtype(value) === 'card' ? [value] : [];
    const count = typeof value === 'number' ? value : cards.length;
    if (count > 0) emit('draw', this, { cards, count, label: `摸${count}张牌` });
  });
  wrap('$throw', function (value) {
    let event = get.event();
    for (let depth = 0; event && depth < 16; depth++, event = event.getParent?.()) {
      if (['useCard', 'respond'].includes(event.name)) return;
    }
    const cards = Array.isArray(value) ? value : get.itemtype(value) === 'card' ? [value] : [];
    const count = typeof value === 'number' ? value : cards.length;
    if (count > 0) emit('throw', this, { cards, count, label: '弃牌' });
  });
  wrap('$damage', function (source) {
    emit('damage', this, { targets: source?.playerid ? [source] : [], label: '受伤' });
  });
  wrap('$damagepop', function (amount, nature) {
    if (typeof amount === 'string' && (active.has('logSkill') || amount === '回合开始')) return;
    if (typeof amount === 'number' || typeof amount === 'string')
      emit(typeof amount === 'number' ? 'health' : 'popup', this, {
        amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : 0,
        label: typeof amount === 'number' && amount > 0 ? `+${amount}` : plain(amount),
        nature,
      });
  });
  wrap('logSkill', function (name, targets) {
    const skill = Array.isArray(name) ? name[0] : name;
    if (lib.translate[skill])
      emit('skill', this, {
        label: get.translation(skill),
        targets: Array.isArray(targets) ? targets : targets ? [targets] : [],
      });
  });
  wrap('$die', function () {
    emit('death', this, { label: '阵亡' });
  });
  const log = game.log;
  game.log = function (...args) {
    capture(() => {
      turn();
      const event = get.event();
      if (
        event &&
        ['useCard', 'respond'].includes(event.name) &&
        event.card?.name &&
        args.includes(event.card) &&
        !logged.has(event)
      ) {
        logged.add(event);
        emit(event.name === 'useCard' ? 'use' : 'respond', event.player, {
          targets: event.targets ?? [],
          cards: [event.card],
          count: 1,
          label: get.translation(event.card.name),
          nature: event.card.nature,
          virtual: true,
        });
      }
    });
    return log.apply(this, args);
  };
  const timer = setInterval(() => capture(turn), 100);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
}
