// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get, _status } from 'noname';

/** Room-authenticated commands; native one-player death must not bypass consent. */
export function installSurrender() {
  const engine = globalThis.partyEngine;
  ui.create.giveup = () => {};
  if (engine.setup.role !== 'worker') {
    if (engine.setup.tableView) return;
    engine.showSurrender = (state) => {
      engine.surrenderState = state;
      parent.postMessage(
        { type: 'party-surrender-state', matchId: engine.setup.id, state },
        location.origin,
      );
    };
    window.addEventListener('message', (event) => {
      if (
        event.origin !== location.origin ||
        event.source !== parent ||
        event.data?.matchId !== engine.setup.id ||
        event.data.type !== 'party-surrender-action' ||
        _status.over
      )
        return;
      game.send('partySurrender', event.data.action, event.data.epoch ?? '');
    });
    return;
  }

  const humans = engine.setup.seats.filter((seat) => seat.kind === 'human');
  const kind = engine.setup.settings.mode === 'identity' ? 'end' : 'surrender';
  const cooldowns = new Map();
  let active = false;
  let vote = null;
  let timer;
  let lastSignature = '';
  let notice = '';
  let settlement;
  engine.surrenderProof = { endSends: 0, captured: false, endedReinit: 0 };
  const living = () => game.players.filter((player) => !player.isDead());
  const team = (player) => {
    switch (engine.setup.settings.mode) {
      case 'doudizhu':
        return player.identity === 'zhu' ? 'landlord' : 'farmers';
      case 'versus':
        return player.side;
      default:
        return player.playerid;
    }
  };
  const voters = (initiator) =>
    humans.filter(
      (seat) =>
        kind === 'end' ||
        living().some((player) => player.playerid === seat.id && team(player) === team(initiator)),
    );
  const signature = () =>
    JSON.stringify([
      living()
        .map((player) => player.playerid)
        .sort(),
      humans.map((seat) => (cooldowns.get(seat.id) ?? 0) > Date.now()),
    ]);
  const state = (id) => ({
    kind,
    available:
      active &&
      !_status.over &&
      (kind === 'end' || living().some((player) => player.playerid === id)),
    cooldownMs: Math.max(0, (cooldowns.get(id) ?? 0) - Date.now()),
    notice,
    vote: vote
      ? {
          epoch: vote.epoch,
          initiator: humans.find((seat) => seat.id === vote.initiator)?.nickname ?? '',
          remainingMs: Math.max(0, vote.deadline - Date.now()),
          eligible: vote.voters.some((seat) => seat.id === id),
          voted: vote.approved.has(id),
          participants: vote.voters.map((seat) => ({
            id: seat.id,
            nickname: seat.nickname,
            approved: vote.approved.has(seat.id),
          })),
        }
      : null,
  });
  const send = (id) =>
    lib.playerOL[id]?.send(function (state) {
      globalThis.partyEngine.showSurrender?.(state);
    }, state(id));
  const publish = () => {
    lastSignature = signature();
    for (const seat of humans) send(seat.id);
  };
  const cancel = (reason) => {
    if (!vote) return;
    vote = null;
    notice = reason;
    game.log(reason);
    publish();
  };
  const finish = () => {
    const current = vote;
    if (!current || _status.over) return;
    const initiator = lib.playerOL[current.initiator];
    // Determine results explicitly without fake deaths, death skills or changes
    // to HP/cards. Native game.over and reinit both use this authoritative result.
    if (kind === 'end') {
      game.checkOnlineResult = () => null;
      game.showIdentity?.();
      notice = '全体真人同意，本局提前结束，不判胜负。';
    } else {
      const losingTeam = team(initiator);
      game.checkOnlineResult = (player) => team(player) !== losingTeam;
      notice = '本方存活真人同意投降，对方获胜。';
    }
    active = false;
    vote = null;
    game.log(notice);
    publish();
    // Native ended reinit restores only state.over, without the result dialog.
    // Retain this approved ending's native presentation privately, through the
    // same privacy serializer; nothing enters the lobby or observer projection.
    const prototype = lib.element.Player.prototype;
    const sendPlayer = prototype.send;
    prototype.send = function (...args) {
      engine.surrenderProof.endSends++;
      if (args[0] === game.over && _status.over) {
        settlement = { html: args[1], poptips: args[3] };
        engine.surrenderProof.captured = true;
      }
      return sendPlayer.apply(this, args);
    };
    try {
      game.over(kind === 'end' ? '全体同意 · 提前结束（不判胜负）' : '投降结束 · 对方获胜');
    } finally {
      prototype.send = sendPlayer;
    }
  };
  const reconcile = () => {
    if (!active || _status.over) return;
    if (vote) {
      if (Date.now() >= vote.deadline) return cancel('投票超时，本局继续。');
      const initiator = lib.playerOL[vote.initiator];
      const current =
        initiator &&
        voters(initiator)
          .map((seat) => seat.id)
          .sort();
      if (JSON.stringify(current) !== JSON.stringify(vote.voters.map((seat) => seat.id).sort()))
        return cancel('投票期间存活队友变化，请重新商议；本局继续。');
    }
    if (signature() !== lastSignature) publish();
  };
  lib.message.server.giveup = () => {};
  lib.message.server.partySurrender = function (action, epoch) {
    const player = lib.playerOL[this.id];
    if (
      !active ||
      _status.over ||
      player?.ws !== this ||
      this.closed ||
      !humans.some((seat) => seat.id === this.id)
    )
      return;
    reconcile();
    if (action === 'request') {
      if (
        epoch !== '' ||
        vote ||
        !state(this.id).available ||
        (cooldowns.get(this.id) ?? 0) > Date.now()
      )
        return send(this.id);
      cooldowns.set(this.id, Date.now() + 60000);
      notice = '';
      vote = {
        epoch: get.id(),
        initiator: this.id,
        deadline: Date.now() + 30000,
        voters: voters(player),
        approved: new Set([this.id]),
      };
      game.log(player, kind === 'end' ? '发起提前结束投票' : '发起本方投降投票');
    } else {
      if (
        !vote ||
        epoch !== vote.epoch ||
        !vote.voters.some((seat) => seat.id === this.id) ||
        !['approve', 'reject'].includes(action)
      )
        return send(this.id);
      if (action === 'reject') return cancel('有玩家选择继续，本局继续。');
      vote.approved.add(this.id);
    }
    if (vote.voters.every((seat) => vote.approved.has(seat.id))) finish();
    else publish();
  };
  const reinited = lib.message.server.reinited;
  lib.message.server.reinited = function (...args) {
    reinited.apply(this, args);
    if (lib.playerOL[this.id]?.ws === this) {
      reconcile();
      send(this.id);
      if (_status.over) engine.surrenderProof.endedReinit++;
      if (_status.over && settlement) {
        const player = lib.playerOL[this.id];
        // Use the worker's native method, just as the original ending does.
        // A reinit client's game.over may belong to its connect-mode sandbox.
        player.send(function () {
          // Client presentation only: the worker already ended this match.
          _status.over = false;
        });
        player.send(game.over, settlement.html, game.checkOnlineResult(player), settlement.poptips);
      }
    }
  };
  lib.onover.push(() => {
    active = false;
    vote = null;
    clearInterval(timer);
    publish();
  });
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  return () => {
    active = true;
    publish();
    timer = setInterval(reconcile, 1000);
  };
}
