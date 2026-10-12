// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get, _status } from 'noname';

let discloseChoice = (_event, send) => send();
let publicRendering;
const publicExpansions = new WeakMap();
const publicDialogs = new Map();

/** Card arguments are declarations; opaque parents/storage are not materials. */
function declaredCards(values) {
  const cards = new Set();
  const visit = (value, depth = 0) => {
    if (get.itemtype?.(value) === 'card') cards.add(value);
    else if (Array.isArray(value) && depth < 8) {
      const card = value.length === 5 && typeof value[4] === 'string' && lib.cardOL?.[value[4]];
      if (card) cards.add(card);
      else for (const item of value) visit(item, depth + 1);
    } else if (typeof value === 'string' && value.startsWith('_noname_card:')) {
      try {
        const card = lib.cardOL?.[JSON.parse(value.slice(13))[0]];
        if (card) cards.add(card);
      } catch {
        // Leave malformed native values to the original serializer/parser.
      }
    }
  };
  visit(values);
  return cards;
}

/** Retain only card pools actually created by a native public broadcast. */
function rememberPublicDialogs(args) {
  if (args[0] === 'closeDialog') return publicDialogs.delete(args[1]);
  if (
    typeof args[0] !== 'function' ||
    !/ui\.create\.dialog/.test(String(args[0])) ||
    !/\.videoId\s*=/.test(String(args[0])) ||
    !get.idDialog
  )
    return;
  const cards = declaredCards(args.slice(1));
  for (const id of args.slice(1)) {
    if (!Number.isSafeInteger(id)) continue;
    const dialog = get.idDialog(id);
    if (
      !dialog?.isConnected ||
      !dialog.buttons?.length ||
      !dialog.buttons.every(
        (button) =>
          cards.has(button.link) &&
          publicCardVisible(button.link) &&
          !['blank', 'infohidden'].some((name) => button.classList.contains(name)),
      )
    )
      continue;
    for (const [key, value] of publicDialogs)
      if (!value.dialog.isConnected) publicDialogs.delete(key);
    publicDialogs.set(id, { dialog, cards });
    if (publicDialogs.size > 16) publicDialogs.delete(publicDialogs.keys().next().value);
  }
}

/** Rebuild current public pools before replaying a recipient's original choice. */
export function replayPublicDialogs(player) {
  for (const [id, { dialog, cards }] of publicDialogs) {
    if (!dialog.isConnected) {
      publicDialogs.delete(id);
      continue;
    }
    const buttons = dialog.buttons ?? [];
    if (
      !buttons.length ||
      !buttons.every(
        (button) =>
          cards.has(button.link) &&
          publicCardVisible(button.link) &&
          !['blank', 'infohidden'].some((name) => button.classList.contains(name)),
      )
    )
      continue;
    player.send(
      function (cards, id, caption, isStatic) {
        if (get.idDialog(id)?.isConnected) return;
        const dialog = ui.create.dialog('公开牌池', cards, isStatic);
        dialog.videoId = id;
        dialog.content.firstChild.textContent = caption;
      },
      buttons.map((button) => button.link),
      id,
      String(dialog.content?.firstChild?.textContent ?? '公开牌池').slice(0, 500),
      dialog.static === true,
    );
  }
}

/** One public-card policy for player serialization, journals and observers. */
function publicCardDisclosure(card) {
  const position = get.position(card, true);
  if (['e', 'j', 'd'].includes(position)) return true;
  if (card._knowers?.includes('everyone') || get.is?.shownCard?.(card)) return true;
  if (publicRendering?.disclosed.has(card)) return true;
  // A public expansion stays public on recovery, but this grants no access to
  // another expansion, a later private placement, a hand or the draw pile.
  if (
    position === 'x' &&
    publicExpansions.has(card) &&
    publicExpansions.get(card) === get.owner(card)
  )
    return true;
  // Native virtual equipment/judgments keep their physical public materials
  // in ui.special. Recover only materials attached to the visible virtual card.
  if (
    position === 's' &&
    [...(game?.players ?? []), ...(game?.dead ?? [])].some((player) =>
      ['equips', 'judges'].some((zone) =>
        player.vcardsMap?.[zone]?.some(
          (virtual) => !lib.card[virtual.name]?.blankCard && virtual.cards?.includes(card),
        ),
      ),
    )
  )
    return true;
  const seen = new Set();
  for (let event = get.event(), depth = 0; event && depth < 32 && !seen.has(event); depth++) {
    seen.add(event);
    if (event.partyShownCompareCards?.includes(card)) return true;
    if (event.name === 'yanxi' && event.partyShownYanxiCards?.includes(card)) return true;
    if (event.partyShownGuhuoCards?.includes(card)) return true;
    // A use/respond ancestor contains the bluff during challenges too.
    if (
      ['reguhuo_guess', 'old_guhuo_guess', 'guhuo_guess'].includes(event.name) &&
      event._trigger?.cards?.includes(card)
    )
      return false;
    if (
      ['equip', 'addJudge', 'gain', 'addToExpansion', 'lose'].includes(event.name) &&
      event.visible === true &&
      event.cards?.includes(card)
    )
      return true;
    if (
      ['useCard', 'respond', 'discard', 'showCards', 'recast'].includes(event.name) &&
      event.cards?.includes(card)
    )
      return true;
    if (
      event.name === 'loseAsync' &&
      event.visible === true &&
      ((['discard', 'addToExpansion'].includes(event.type) &&
        event.lose_list?.some((entry) => Array.isArray(entry[1]) && entry[1].includes(card))) ||
        (event.type === 'gain' &&
          event.gain_list?.some((entry) => Array.isArray(entry[1]) && entry[1].includes(card))))
    )
      return true;
    if (event.name === 'loseToDiscardpile' && !event.blank && event.cards?.includes(card))
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
}

export function publicCardVisible(card) {
  return publicCardDisclosure(card) === true;
}
/** Reuse the native choice's narrow disclosure scope when replaying its request. */
export function withChoiceDisclosure(event, send) {
  return discloseChoice(event, send);
}

function initCharacter(id, name, concealed) {
  if (concealed) {
    lib.character[name] = get.convertedCharacter(concealed);
    lib.translate[name] = '未亮将';
  }
  lib.playerOL[id].init(name);
}

function hiddenCharacterName(id, index = 0) {
  return `party_hidden_${id}${index ? '_secondary' : ''}`;
}

function concealedCharacter(group, hujia = 0) {
  return {
    sex: 'male',
    group,
    hp: 1,
    maxHp: 1,
    hujia,
    skills: [],
    hasHiddenSkill: true,
    img: 'image/character/default_silhouette_male.jpg',
  };
}

/** The owner and rule executor initialize the native character unchanged. */
export function broadcastCharacterInit(player, name) {
  return game.broadcastAll(initCharacter, player.playerid, name, null);
}

/** 宴戏 explicitly publishes these three cards, including two returned to the pile. */
export function markPublicLogCards(args) {
  const event = get.event();
  if (
    event?.name === 'yanxi' &&
    args.length === 3 &&
    args[0] === event.player &&
    args[1] === '展示了' &&
    Array.isArray(args[2]) &&
    args[2].length === 3 &&
    args[2].every((card) => get.itemtype(card) === 'card')
  )
    event.partyShownYanxiCards = args[2].slice();
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
  const clearKnowers = lib.element.Card.prototype.clearKnowers;
  if (clearKnowers)
    lib.element.Card.prototype.clearKnowers = function (...args) {
      publicExpansions.delete(this);
      return clearKnowers.apply(this, args);
    };
  const expansion = lib.element.Player.prototype.$addToExpansion;
  if (expansion)
    lib.element.Player.prototype.$addToExpansion = function (cards, ...args) {
      const event = get.event();
      const check = args[2] === undefined ? true : args[2];
      const existing = check ? this.getCards('x') : [];
      for (const card of cards ?? []) {
        // Native duplicate placements do not move the card or change its secrecy.
        if (existing.includes(card)) continue;
        publicExpansions.delete(card);
        if (
          event?.visible === true &&
          ((event.name === 'addToExpansion' &&
            event.player === this &&
            event.cards?.includes(card)) ||
            (event.name === 'loseAsync' &&
              event.type === 'addToExpansion' &&
              event.lose_list?.some(([player, cards]) => player === this && cards.includes(card))))
        )
          publicExpansions.set(card, this);
      }
      return expansion.call(this, cards, ...args);
    };
  for (const name of ['$addVirtualEquip', '$addVirtualJudge']) {
    const render = lib.element.Player.prototype[name];
    if (!render) continue;
    lib.element.Player.prototype[name] = function (virtual, cards, ...args) {
      const previous = publicRendering;
      publicRendering = lib.card[virtual?.name]?.blankCard
        ? undefined
        : { player: this, virtual, cards, disclosed: new Set() };
      try {
        return render.call(this, virtual, cards, ...args);
      } finally {
        publicRendering = previous;
      }
    };
  }
  let receiver;
  let addressedTo;
  let addressedCards;
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
    else if (
      event.name === 'chooseControl' &&
      event.getParent?.()?.name === 'clanjieli' &&
      Array.isArray(event.dialog)
    )
      add(event.dialog);
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
      if (args[0] === 'reinit' && args[2]?.players) {
        // Native Player.getState omits storage. Reconnect both native versions even
        // when no pending choice will send a later get.skillState snapshot.
        const huashen = Object.fromEntries(
          Object.keys(args[2].players).flatMap((id) => {
            const player = lib.playerOL?.[id];
            const storage = player?.storage?.rehuashen;
            return storage ? [[id, player === receiver ? storage : publicHuashen(storage)]] : [];
          }),
        );
        if (Object.keys(huashen).length) args[2] = { ...args[2], partyRehuashen: huashen };
        const original = Object.fromEntries(
          Object.keys(args[2].players).flatMap((id) => {
            const player = lib.playerOL?.[id];
            const storage = player?.storage?.huashen;
            return storage
              ? [[id, player === receiver ? storage : publicOriginalHuashen(storage)]]
              : [];
          }),
        );
        if (Object.keys(original).length) args[2] = { ...args[2], partyHuashen: original };
      }
      // v1.11.6 rehuashen.drawCharacter broadcasts real character IDs even
      // though only the owner executes its animation. Match that exact native
      // callback and its declared list, never arbitrary character selections.
      const [callback, player, characters] = args;
      if (
        receiver &&
        !_status.over &&
        callback === initCharacter &&
        player !== receiver.playerid &&
        lib.character?.[characters]?.hasHiddenSkill
      ) {
        // A synthetic mirror-only definition reproduces the native unseen
        // shell, without the real name, hidden skills or unrevealed base HP.
        args[2] = hiddenCharacterName(player);
        args[3] = concealedCharacter(
          lib.character[characters].group,
          lib.character[characters].hujia ?? 0,
        );
      }
      if (
        receiver &&
        !_status.over &&
        player !== receiver &&
        typeof callback === 'function' &&
        /["']huashen_card_["']/.test(Function.prototype.toString.call(callback)) &&
        Array.isArray(characters) &&
        characters.every(
          (name) =>
            player?.storage?.rehuashen?.character?.includes(name) ||
            Object.hasOwn(player?.storage?.huashen?.owned ?? {}, name),
        )
      )
        args[2] = characters.map(() => 'unknown');
      return send.apply(this, args);
    } finally {
      receiver = previous;
    }
  };
  const playerSend = lib.element.Player.prototype.send;
  lib.element.Player.prototype.send = function (...args) {
    const previous = addressedTo;
    const previousCards = addressedCards;
    addressedTo = this;
    addressedCards = declaredCards(args.slice(1));
    try {
      return playerSend.apply(this, args);
    } finally {
      addressedTo = previous;
      addressedCards = previousCards;
    }
  };
  if (game?.log) {
    const log = game.log;
    game.log = function (...args) {
      markPublicLogCards(args);
      return log.apply(this, args);
    };
  }
  const broadcastAll = game?.broadcastAll;
  const broadcast = game?.broadcast;
  if (broadcast)
    game.broadcast = function (...args) {
      const result = broadcast.apply(this, args);
      rememberPublicDialogs(args);
      return result;
    };
  if (broadcastAll)
    game.broadcastAll = function (...args) {
      const event = get.event();
      // The pinned native renderers broadcast a newly created display card,
      // which is distinct from their already-public physical cost materials.
      if (
        publicRendering &&
        typeof args[0] === 'function' &&
        args[1] === publicRendering.player &&
        get.itemtype(args[2]) === 'card' &&
        typeof args[3] === 'boolean' &&
        args[4] === publicRendering.virtual &&
        args[5] === publicRendering.cards
      )
        publicRendering.disclosed.add(args[2]);
      // Two native 于吉 versions flip an existing copy without showCards or a new
      // card argument. Publish exactly its one material at the native flip,
      // after every challenge; keep the copy visually face down until native
      // animation removes infohidden. Other broadcasts grant no disclosure.
      const bluffNode =
        event?.name === 'old_guhuo_guess'
          ? 'old_guhuoNode'
          : event?.name === 'guhuo_guess'
            ? 'guhuoNode'
            : undefined;
      if (
        bluffNode &&
        args.length === 2 &&
        typeof args[0] === 'function' &&
        args[1] === event.onEnd01 &&
        typeof args[1] === 'function' &&
        new RegExp(`_status\\.${bluffNode}\\.listenTransition\\(onEnd,\\s*300\\)`).test(
          String(args[0]),
        ) &&
        event._trigger?.cards?.length === 1 &&
        get.itemtype(event._trigger.cards[0]) === 'card'
      ) {
        const card = event._trigger.cards[0];
        event.partyShownGuhuoCards = [card];
        broadcastAll.call(
          this,
          function (card, player, nodeKey) {
            const previous = _status[nodeKey];
            const node = (_status[nodeKey] = card.copy('thrown'));
            node.classList.add('infohidden');
            if (previous?.isConnected) {
              node.classList.add('center');
              node.style.cssText = previous.style.cssText;
              previous.replaceWith(node);
              const index = ui.thrown.indexOf(previous);
              if (index >= 0) ui.thrown[index] = node;
            } else {
              // Arena reinit omits this transient face-down animation node.
              node.style.transform = 'perspective(600px) rotateY(180deg) translateX(0)';
              player.$throwordered2(node);
            }
          },
          card,
          event.player,
          bluffNode,
        );
        game.log(event.player, '展示了', [card]);
      }
      const result = broadcastAll.apply(this, args);
      rememberPublicDialogs(args);
      return result;
    };
  const showCharacter = lib.element.Player.prototype.$showCharacter;
  if (showCharacter)
    lib.element.Player.prototype.$showCharacter = function (index, ...args) {
      const revealed = [0, 1]
        .filter((value) => index === value || index === 2)
        .map((value) => [value, hiddenCharacter(this, value)])
        .filter((entry) => entry[1]);
      if (revealed.length)
        game.broadcast(
          function (player, entries) {
            for (const [value, name] of entries) {
              player[value ? 'name2' : 'name1'] = name;
              if (player.skin) player.skin[value ? 'name2' : 'name'] = name;
              player.node[value ? 'avatar2' : 'avatar'].setBackground(name, 'character');
              player.node[value ? 'name2' : 'name'].innerHTML = get.slimName(name);
            }
          },
          this,
          revealed,
        );
      // Native $showCharacter alone changes HP, skills, groups and classes.
      // No re-init or rule state reset is performed on any player.
      return showCharacter.call(this, index, ...args);
    };
  const reinit = lib.message?.client?.reinit;
  if (reinit)
    lib.message.client.reinit = function (config, state, ...args) {
      // A refreshed mirror has never received the initial synthetic definition.
      // Reconstruct only the declared unseen shell before native reinit calls
      // player.init(name1); no hidden character or hidden skill is needed.
      for (const [id, player] of Object.entries(state?.players ?? {}))
        for (const index of [0, 1]) {
          const name = player[index ? 'name2' : 'name1'];
          if (player[index ? 'unseen2' : 'unseen'] && name === hiddenCharacterName(id, index)) {
            lib.character[name] = get.convertedCharacter(
              concealedCharacter(player.group, player.hujia ?? 0),
            );
            lib.translate[name] = '未亮将';
          }
        }
      if ((state?.partyRehuashen || state?.partyHuashen) && !args[2]) {
        const onreconnect = Array.isArray(args[3]) ? args[3].slice() : null;
        args[3] = [
          function () {
            // The native loadModeAsync callback invokes this only after all
            // players are rebuilt, before game.loop and the reinited reply.
            // This is local mirror restoration, with no authoritative change,
            // broadcast, new choice, wait or deadline extension.
            for (const [key, values] of [
              ['rehuashen', state.partyRehuashen],
              ['huashen', state.partyHuashen],
            ])
              for (const [id, storage] of Object.entries(values ?? {})) {
                const player = lib.playerOL?.[id];
                if (!player || storage?.constructor !== Object) continue;
                player.storage[key] = storage;
                if (storage.current && !player.tempname.includes(storage.current))
                  player.tempname.push(storage.current);
                player.markSkill(key, null, null, true);
              }
            if (onreconnect?.length) return onreconnect[0].apply(this, onreconnect.slice(1));
          },
        ];
      }
      return reinit.call(this, config, state, ...args);
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
    if (card.isKnownBy(receiver)) return true;
    if (
      addressedTo === receiver &&
      choiceDisclosure?.player === receiver &&
      choiceDisclosure.cards.has(card)
    )
      return true;
    const disclosure = publicCardDisclosure(card);
    if (disclosure !== undefined) return disclosure;
    const owner = get.owner(card);
    // Only explicit unowned card arguments inherit recipient authorization.
    // Opaque event parents and another skill's storage do not inherit it.
    return !owner && addressedTo === receiver && addressedCards?.has(card) === true;
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
  function publicHuashen(storage) {
    return {
      character: Array.isArray(storage.character) ? storage.character.map(() => 'unknown') : [],
      choosed: [],
      map: {},
      current: storage.current,
      current2: storage.current2,
    };
  }
  function publicOriginalHuashen(storage) {
    return {
      owned: Object.fromEntries(
        Object.keys(storage.owned ?? {}).map((_, index) => [`unknown_${index}`, []]),
      ),
      choosed: [],
      current: storage.current,
      current2: storage.current2,
    };
  }
  function hiddenCharacter(player, index) {
    const name = player[index ? 'name2' : 'name1'];
    return lib.character?.[name]?.hasHiddenSkill && player.isUnseen?.(index) ? name : undefined;
  }
  function publicCharacterState(player, state) {
    if (state?.constructor !== Object) return state;
    const hidden = [hiddenCharacter(player, 0), hiddenCharacter(player, 1)];
    if (!hidden.some(Boolean)) return state;
    const projected = { ...state };
    for (const [index, name] of hidden.entries()) {
      if (!name) continue;
      const key = index ? 'name2' : 'name1';
      if (key in projected) projected[key] = hiddenCharacterName(player.playerid, index);
      if (projected.name === name) projected.name = 'unknown';
    }
    // Only native skills belonging to a still-concealed character are secret.
    // Publicly acquired skills and an already revealed other general stay.
    const secretSkills = new Set(
      hidden.flatMap((name) => (name ? (lib.character[name].skills ?? []) : [])),
    );
    const publicSkills = new Set(player.skills ?? []);
    for (const key of ['hiddenSkills', 'invisibleSkills'])
      if (Array.isArray(projected[key]))
        projected[key] = projected[key].filter(
          (skill) => !secretSkills.has(skill) || publicSkills.has(skill),
        );
    if (projected.storage && ('rawHp' in projected.storage || 'rawMaxHp' in projected.storage)) {
      projected.storage = { ...projected.storage };
      delete projected.storage.rawHp;
      delete projected.storage.rawMaxHp;
    }
    return projected;
  }
  function privateState(item) {
    if (item?.constructor !== Object) return item;
    // markSkill broadcasts this live object directly, separately from a
    // player snapshot. Preserve its public count and active transformation.
    for (const player of Object.values(lib.playerOL ?? {})) {
      if (player === receiver) continue;
      if (item === player.storage?.rehuashen) return publicHuashen(item);
      if (item === player.storage?.huashen) return publicOriginalHuashen(item);
    }
    let sanitized;
    const eventPlayer =
      typeof item.player === 'string' && item.player.startsWith('_noname_player:')
        ? lib.playerOL?.[item.player.slice(15)]
        : item.player;
    if (
      ['reguhuo_guess', 'old_guhuo_guess', 'guhuo_guess'].includes(item.name) &&
      eventPlayer !== receiver &&
      'fake' in item
    ) {
      sanitized = { ...item };
      delete sanitized.fake;
    }
    for (const [id, state] of Object.entries(item)) {
      const player = lib.playerOL?.[id];
      if (!player || player === receiver) continue;
      const publicState = publicCharacterState(player, state);
      if (publicState !== state) {
        sanitized ??= { ...item };
        sanitized[id] = publicState;
      }
      if (get.mode() === 'identity' && !player.identityShown && state?.identity) {
        sanitized ??= { ...item };
        sanitized[id] = {
          ...(sanitized[id] ?? state),
          identity: 'unknown',
          shown: 0,
          identityNode: ['猜', 'unknown'],
        };
      }
      // skillState carries storage for every seat on choices and reconnects;
      // the same projection also handles already-encoded snapshot objects.
      if (state?.storage?.rehuashen) {
        sanitized ??= { ...item };
        sanitized[id] = {
          ...(sanitized[id] ?? state),
          storage: { ...state.storage, rehuashen: publicHuashen(state.storage.rehuashen) },
        };
      }
      if (state?.storage?.huashen) {
        sanitized ??= { ...item };
        const projected = sanitized[id] ?? state;
        sanitized[id] = {
          ...projected,
          storage: { ...projected.storage, huashen: publicOriginalHuashen(state.storage.huashen) },
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
  const eventInfo = get.eventInfoOL;
  if (eventInfo)
    get.eventInfoOL = function (...args) {
      const result = eventInfo.apply(this, args);
      return receiver && !_status.over ? wireValue(result) : result;
    };
}
