// SPDX-License-Identifier: GPL-3.0-only
import { lib, get } from 'noname';
import { withChoiceDisclosure } from './privacy.js';

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
    if (
      typeof args[0] === 'function' &&
      (ownChoice ||
        // Native startup chooseButtonOL sends its request directly. Other
        // private dialog updates must never replace an outstanding choice.
        (selecting() && get.event()?.name === 'chooseButtonOL' && Array.isArray(args[1])))
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
  const reinited = lib.message.server.reinited;
  lib.message.server.reinited = function (...args) {
    reinited.apply(this, args);
    const player = lib.playerOL[this.id];
    const waiting = lib.node.torespond[this.id];
    const request = pending.get(this.id);
    // reinit loads the mode asynchronously. Replay only after the phone has
    // reconstructed its own arena, and only if the same choice remains pending.
    if (
      player?.ws === this &&
      request &&
      (waiting === '_noname_waiting' || waiting?._noname_waiting)
    ) {
      // Reuse the original callback, arguments and encoded parent, rather than
      // rebuilding from a parent that has advanced during reinit. Serialization
      // still passes through privacy.js and the same actor's choice scope.
      // No second wait()/pause() call replaces the native deadline/event stack.
      const replay = () => {
        // Clone the sequence: replayed native sends must not append to it.
        for (const [id, frames] of dialogs.get(this.id) ?? [])
          if (get.idDialog(id)?.isConnected)
            for (const frame of frames.slice()) playerSend.apply(player, frame);
        playerSend.apply(player, request.args);
      };
      if (request.event) withChoiceDisclosure(request.event, replay);
      else replay();
    }
  };
}
