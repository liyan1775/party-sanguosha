// SPDX-License-Identifier: GPL-3.0-only
import { lib, get, _status } from 'noname';

/** Keep authoritative cards intact; redact while serializing for each receiver. */
export function installPrivacy() {
  lib.card.party_unknown = { type: 'unknown', enable: false, fullskin: false };
  lib.translate.party_unknown = '未知牌';
  let receiver;
  let addressedTo;
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
  function visible(card) {
    if (!receiver || _status.over) return true;
    const position = get.position(card, true);
    if (card.isKnownBy(receiver) || ['e', 'j', 'd'].includes(position)) return true;
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
