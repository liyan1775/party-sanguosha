// SPDX-License-Identifier: GPL-3.0-only
import { lib, get, _status } from 'noname';

let discloseChoice = (_event, send) => send();
/** Reuse the native choice's narrow disclosure scope when replaying its request. */
export function withChoiceDisclosure(event, send) {
  return discloseChoice(event, send);
}

/** Keep authoritative cards intact; redact while serializing for each receiver. */
export function installPrivacy() {
  lib.card.party_unknown = { type: 'unknown', enable: false, fullskin: false };
  lib.translate.party_unknown = '未知牌';
  const initCard = lib.element.Card.prototype.init;
  lib.element.Card.prototype.init = function (...args) {
    const concealed = this.classList.contains('party-concealed');
    const result = initCard.apply(this, args);
    if (this.name === 'party_unknown') this.classList.add('party-concealed', 'infohidden');
    else if (concealed) this.classList.remove('party-concealed', 'infohidden');
    return result;
  };
  let receiver;
  let addressedTo;
  let choiceDisclosure;
  discloseChoice = function (event, send) {
    const previous = choiceDisclosure;
    const cards = new Set();
    const add = (value, depth = 0) => {
      if (get.itemtype(value) === 'card') cards.add(value);
      else if (Array.isArray(value) && depth < 8) for (const item of value) add(item, depth + 1);
    };
    // These native APIs explicitly present face-up materials to their actor.
    // Read ONLY the declared choice, never its parent, target's whole hand or
    // private storage. Native blank buttons (顺手/过河/拼点) stay concealed.
    if (
      ['chooseButton', 'choosePlayerCard', 'discardPlayerCard', 'gainPlayerCard'].includes(
        event.name,
      )
    ) {
      const dialog = typeof event.dialog === 'number' ? get.idDialog?.(event.dialog) : event.dialog;
      for (const button of dialog?.buttons ?? [])
        if (!['blank', 'infohidden'].some((name) => button.classList.contains(name)))
          add(button.link);
    } else if (['chooseToMove', 'chooseToMove_new'].includes(event.name)) add(event.list);
    else if (event.name === 'viewCards') add(event.cards);
    choiceDisclosure = { player: event.player, cards };
    try {
      return send();
    } finally {
      choiceDisclosure = previous;
    }
  };
  const choiceSend = lib.element.GameEvent?.prototype.send;
  if (choiceSend)
    lib.element.GameEvent.prototype.send = function (...args) {
      return withChoiceDisclosure(this, () => choiceSend.apply(this, args));
    };
  const send = lib.element.Client.prototype.send;
  lib.element.Client.prototype.send = function (...args) {
    const previous = receiver;
    receiver = lib.playerOL?.[this.id];
    try {
      return send.apply(this, args);
    } finally {
      receiver = previous;
    }
  };
  const playerSend = lib.element.Player.prototype.send;
  lib.element.Player.prototype.send = function (...args) {
    const previous = addressedTo;
    addressedTo = this;
    try {
      return playerSend.apply(this, args);
    } finally {
      addressedTo = previous;
    }
  };
  for (const name of ['$compare', '$compareMultiple']) {
    const compare = lib.element.Player.prototype[name];
    lib.element.Player.prototype[name] = function (card, targets, cards, ...args) {
      // Selection stays private until the native comparison animation starts.
      // Only its declared materials become public, never the ordering zone.
      const event = get.event();
      if (event)
        event.partyShownCompareCards = [
          ...(event.partyShownCompareCards ?? []),
          card,
          ...(Array.isArray(cards) ? cards : [cards]),
        ];
      return compare.call(this, card, targets, cards, ...args);
    };
  }
  function visible(card) {
    if (!receiver || _status.over) return true;
    const position = get.position(card, true);
    if (card.isKnownBy(receiver) || ['e', 'j', 'd'].includes(position)) return true;
    if (
      addressedTo === receiver &&
      choiceDisclosure?.player === receiver &&
      choiceDisclosure.cards.has(card)
    )
      return true;
    // Native use/respond animation is broadcast BEFORE moving the physical
    // materials out of the hand. Reveal that declared card, not its whole hand.
    // Ordering ('o') is also used by private 观星, so it is not globally public.
    let event = get.event();
    const seen = new Set();
    for (let depth = 0; event && depth < 32 && !seen.has(event); depth++) {
      seen.add(event);
      if (event.partyShownCompareCards?.includes(card)) return true;
      if (
        ['useCard', 'respond', 'discard', 'showCards'].includes(event.name) &&
        event.cards?.includes(card)
      )
        return true;
      // 五谷丰登 draws before the ordering move. Its native useCard parent
      // explicitly records the publicly displayed pool, unlike private 观星.
      if (
        event.name === 'useCard' &&
        event.card?.name === 'wugu' &&
        event.wuguShownCards?.includes(card)
      )
        return true;
      // 界赵云's 涯角 publicly flips this one deck card before it is moved.
      // Keep this exact native skill boundary; generic event.card stays private.
      if (event.name === 'reyajiao' && event.card === card) return true;
      // The flipped result is in player.judging, not event.card (the delayed
      // trick being judged). After judging.shift(), callbacks use result.card.
      if (
        event.name === 'judge' &&
        (event.player?.judging?.includes(card) || event.result?.card === card)
      )
        return true;
      event = event.getParent?.();
    }
    const owner = get.owner(card);
    // Private choices such as 观星 explicitly send unowned cards to their actor.
    // This does not permit that actor to see another player's concealed hand.
    return !owner && addressedTo === receiver;
  }
  const infoOL = get.cardInfoOL;
  get.cardInfoOL = function (card) {
    return visible(card)
      ? infoOL.call(this, card)
      : '_noname_card:' + JSON.stringify([card.cardid, 'none', 0, 'party_unknown', '']);
  };
  const info = get.cardInfo;
  get.cardInfo = function (card) {
    return visible(card) ? info.call(this, card) : ['none', 0, 'party_unknown', '', card.cardid];
  };
  const stringify = get.stringifiedResult;
  function privateState(item) {
    if (get.mode() !== 'identity' || item?.constructor !== Object) return item;
    let sanitized;
    for (const [id, state] of Object.entries(item)) {
      const player = lib.playerOL?.[id];
      if (player && player !== receiver && !player.identityShown && state?.identity) {
        sanitized ??= { ...item };
        sanitized[id] = {
          ...state,
          identity: 'unknown',
          shown: 0,
          identityNode: ['猜', 'unknown'],
        };
      }
    }
    return sanitized ?? item;
  }
  function wireValue(item, depth = 0) {
    if (depth > 32) return item;
    if (typeof item === 'string') {
      if (item.startsWith('_noname_card:')) {
        const id = JSON.parse(item.slice(13))[0];
        const card = lib.cardOL?.[id];
        return card && !visible(card) ? get.cardInfoOL(card) : item;
      }
      for (const prefix of ['_noname_event:', '_noname_vcard:', '_noname_func:']) {
        if (!item.startsWith(prefix)) continue;
        const body = item.slice(prefix.length);
        if (!['{', '['].includes(body[0])) return item;
        return prefix + JSON.stringify(wireValue(JSON.parse(body), depth + 1));
      }
      return item;
    }
    if (Array.isArray(item)) {
      const card = item.length === 5 && typeof item[4] === 'string' && lib.cardOL?.[item[4]];
      if (card && !visible(card)) return get.cardInfo(card);
      return item.map((value) => wireValue(value, depth + 1));
    }
    if (item?.constructor === Object)
      return Object.fromEntries(
        Object.entries(privateState(item)).map(([key, value]) => [
          key,
          wireValue(value, depth + 1),
        ]),
      );
    return item;
  }
  get.stringifiedResult = function (item, ...args) {
    if (receiver && !_status.over) {
      // Native choice events pre-serialize their parent before Client.send.
      // Revisit those encoded values inside the actual recipient context too.
      if (typeof item === 'string') item = wireValue(item);
      else if (
        Array.isArray(item) &&
        item.length === 5 &&
        typeof item[4] === 'string' &&
        lib.cardOL?.[item[4]] &&
        !visible(lib.cardOL[item[4]])
      )
        item = get.cardInfo(lib.cardOL[item[4]]);
      else item = privateState(item);
    }
    return stringify.call(this, item, ...args);
  };
}
