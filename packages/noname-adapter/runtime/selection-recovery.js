// SPDX-License-Identifier: GPL-3.0-only
import { lib, get } from 'noname';
import { withChoiceDisclosure, replayPublicDialogs } from './privacy.js';

/** Retain unresolved native choices privately until their original deadline. */
export function installSelectionRecovery() {
  const pending = new Map();
  const dialogs = new Map();
  const closing = new Set();
  const selecting = () => !globalThis.partyEngine.proof.started;
  let sendingChoice;
  const choiceSend = lib.element.GameEvent.prototype.send;
  lib.element.GameEvent.prototype.send = function (...args) {
    const previous = sendingChoice;
    sendingChoice = this;
    try {
      return choiceSend.apply(this, args);
    } finally {
      sendingChoice = previous;
    }
  };
  const playerSend = lib.element.Player.prototype.send;
  lib.element.Player.prototype.send = function (...args) {
    // Some native skills (e.g. Huashen) create a private videoId dialog first,
    // then chooseButton references only that ID. Arena reinit omits these nodes.
    // Retain only the actor-addressed native creation/update calls, bounded and
    // removed by their original closeDialog; never read storage or broadcasts.
    if (args[0] === 'closeDialog') dialogs.get(this.playerid)?.delete(args[1]);
    if (typeof args[0] === 'function' && typeof args.at(-1) === 'number') {
      const source = String(args[0]);
      const id = args.at(-1);
      let own = dialogs.get(this.playerid);
      if (/ui\.create\.dialog/.test(source) && /\.videoId\s*=/.test(source)) {
        if (!own) dialogs.set(this.playerid, (own = new Map()));
        own.set(id, [args]);
        if (own.size > 8) own.delete(own.keys().next().value);
      } else if (/get\.idDialog\s*\(/.test(source) && own?.has(id)) {
        const frames = own.get(id);
        frames.push(args);
        if (frames.length > 16) frames.splice(1, 1);
      }
    }
    const ownChoice = sendingChoice?.player === this && args[1] === sendingChoice.name;
    const event = ownChoice ? undefined : get.event();
    const directChallenge =
      event?.name === 'chooseButtonOL' &&
      ['reguhuo_guess', 'old_guhuo_guess'].some((name) => event.getParent?.(name)?.name === name) &&
      args.length === 5 &&
      Array.isArray(args[1]);
    const originalHuashen =
      ['huashen', 'huashen_cost'].includes(event?.name) &&
      event.player === this &&
      args.length === 4 &&
      args[1] === this &&
      Array.isArray(args[2]) &&
      typeof args[3] === 'boolean' &&
      typeof args[0] === 'function' &&
      /player2\.storage\.huashen\.owned/.test(String(args[0])) &&
      args[2].every((id) => Object.hasOwn(this.storage.huashen?.owned ?? {}, id));
    if (
      typeof args[0] === 'function' &&
      (ownChoice ||
        directChallenge ||
        originalHuashen ||
        // Native startup and 蛊惑 challenges send chooseButtonOL directly.
        // Other dialog updates must not replace an outstanding choice.
        (selecting() && event?.name === 'chooseButtonOL' && Array.isArray(args[1])))
    )
      pending.set(this.playerid, { args, event: ownChoice ? sendingChoice : undefined });
    return playerSend.apply(this, args);
  };
  const unwait = lib.element.Player.prototype.unwait;
  lib.element.Player.prototype.unwait = function (result) {
    // Client.close normally resolves an outstanding request to AI immediately.
    // Allow reconnection until the ORIGINAL native deadline, including private
    // skill dialogs now that human choices run on the phone again.
    // Its timeout still calls unwait('ai'); reconnects never extend that timer.
    if (closing.has(this) && pending.has(this.playerid)) return;
    pending.delete(this.playerid);
    return unwait.call(this, result);
  };
  const close = lib.element.Client.prototype.close;
  lib.element.Client.prototype.close = function (...args) {
    const player = lib.playerOL[this.id];
    if (player) closing.add(player);
    try {
      return close.apply(this, args);
    } finally {
      closing.delete(player);
    }
  };
  const restoreYanxi = (player, event) => {
    const parent = event?.getParent?.('yanxi');
    const id = event?._set?.findLast(
      (entry) => entry[0] === 'dialog' && typeof entry[1] === 'number',
    )?.[1];
    const dialog = typeof id === 'number' ? get.idDialog?.(id) : undefined;
    if (
      event?.name !== 'chooseButton' ||
      parent?.name !== 'yanxi' ||
      event.player !== parent.player ||
      parent.partyShownYanxiCards?.length !== 3 ||
      typeof id !== 'number' ||
      !dialog?.isConnected ||
      (event.dialog !== id && event.dialog !== dialog)
    )
      return false;
    // Native 宴戏 broadcasts this public pool, then its actor chooses by ID.
    // Arena reinit omits the dialog. Restore only its three published cards,
    // for both the actor and other reconnecting seats while it remains open.
    playerSend.call(
      player,
      function (cards, id, actor, target, choosing) {
        const dialog = get.idDialog(id) ?? ui.create.dialog('宴戏', cards);
        dialog.videoId = id;
        dialog.content.firstChild.textContent = choosing
          ? '猜猜哪张是' + get.translation(target) + '的手牌？'
          : get.translation(actor) + '对' + get.translation(target) + '发动了【宴戏】';
      },
      parent.partyShownYanxiCards,
      id,
      parent.player,
      parent.target,
      player === parent.player,
    );
    return true;
  };
  const replay = (player) => {
    const waiting = lib.node.torespond[player?.playerid];
    const request = pending.get(player?.playerid);
    if (
      !player?.ws ||
      lib.playerOL[player.playerid] !== player ||
      !request ||
      (waiting !== '_noname_waiting' && !waiting?._noname_waiting)
    )
      return false;
    // Reuse the original callback, arguments and encoded parent, rather than
    // rebuilding from a parent that advanced. This also retries a conflicting
    // shared-pool submission without a second wait()/pause() or deadline.
    const send = () => {
      for (const [id, frames] of dialogs.get(player.playerid) ?? [])
        if (get.idDialog(id)?.isConnected)
          for (const frame of frames.slice()) playerSend.apply(player, frame);
      restoreYanxi(player, request.event);
      // Native huogong broadcasts its public showCards dialog, then waits for
      // an actor-only discard with prompt=false. Arena reinit omits that DOM.
      // Restore only its still-open, already-known single displayed card;
      // preserve the native video ID so the original closeDialog removes it.
      const parent = request.event?.getParent?.('huogong');
      if (
        request.event?.name === 'chooseToDiscard' &&
        parent?.name === 'huogong' &&
        parent.player === player &&
        parent.cards2?.length === 1 &&
        parent.cards2[0].isKnownBy?.(player) &&
        typeof parent.videoId === 'number' &&
        get.idDialog?.(parent.videoId)?.isConnected
      )
        playerSend.call(
          player,
          function (cards, id) {
            if (!get.idDialog(id)) ui.create.dialog('火攻：对方展示的牌', cards).videoId = id;
          },
          parent.cards2,
          parent.videoId,
        );
      playerSend.apply(player, request.args);
    };
    if (request.event) withChoiceDisclosure(request.event, send);
    else send();
    return true;
  };
  const reinited = lib.message.server.reinited;
  lib.message.server.reinited = function (...args) {
    reinited.apply(this, args);
    const player = lib.playerOL[this.id];
    // reinit loads the mode asynchronously. Replay only after the phone has
    // reconstructed its own arena, and only if the same choice remains pending.
    if (player?.ws === this) {
      replayPublicDialogs(player);
      if (!replay(player)) restoreYanxi(player, get.event());
    }
  };
  return { replay };
}
