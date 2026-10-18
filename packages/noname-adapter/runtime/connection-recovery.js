// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, _status } from 'noname';

/** A bounded transport grace; existing native decision deadlines never move. */
export function installConnectionRecovery() {
  const engine = globalThis.partyEngine;
  if (engine.setup.role !== 'worker') {
    if (engine.setup.controlVersions) {
      engine.controlVersion = 0;
      const send = game.send;
      game.send = function (command, ...args) {
        // The same ordered channel carries the toggle before its native AI result.
        // Advance locally too; do not wait for a round-trip acknowledgement.
        if (['auto', 'unauto'].includes(command)) engine.controlVersion++;
        if (['result', 'tempResult'].includes(command))
          args[0] = {
            partyControlVersion: engine.controlVersion,
            partyNativeResult: args[0],
          };
        return send.call(this, command, ...args);
      };
    }
    engine.showControlState = (state) => {
      if (engine.setup.controlVersions && Number.isSafeInteger(state.controlVersion))
        engine.controlVersion = Math.max(engine.controlVersion, state.controlVersion);
      _status.auto = state.auto === true;
      ui.auto?.classList.toggle('glow', _status.auto);
      ui.arena?.classList.toggle('auto', _status.auto);
      window.parent.postMessage(
        { type: 'party-control', matchId: engine.setup.id, ...state },
        location.origin,
      );
    };
    window.addEventListener('message', (event) => {
      if (
        event.origin === location.origin &&
        event.source === parent &&
        event.data?.matchId === engine.setup.id &&
        ['party-manual', 'party-auto'].includes(event.data.type) &&
        !_status.over
      ) {
        const automatic = event.data.type === 'party-auto';
        if (_status.auto !== automatic) ui.click.auto('forced');
        else game.send(automatic ? 'auto' : 'unauto');
      }
    });
    return;
  }
  const interrupted = new Map();
  const grace = new Map();
  const closed = new WeakSet();
  const versions = new Map();
  const report = (client, recovered = false) => {
    const player = lib.playerOL[client.id];
    if (!player) return;
    // The rejoining arena is constructed asynchronously. Send player references
    // only after reinited, never to the newly opened but still empty phone.
    if (recovered)
      game.broadcast(
        function (player, auto) {
          player.setNickname(player.nickname + (auto ? ' · 托管' : ''));
        },
        player,
        player.isAuto === true,
      );
    const interruption = interrupted.get(client.id);
    client.send(
      function (state) {
        globalThis.partyEngine.showControlState?.(state);
      },
      {
        auto: player.isAuto === true,
        ...(engine.setup.controlVersions ? { controlVersion: versions.get(client.id) ?? 0 } : {}),
        recovered,
        offline: interruption?.expired === true,
        awaySeconds: interruption ? Math.floor((Date.now() - interruption.at) / 1000) : 0,
      },
    );
    if (recovered) interrupted.delete(client.id);
  };
  const reinited = lib.message.server.reinited;
  lib.message.server.reinited = function (...args) {
    // The phone has reconstructed its arena. Restore its version before the
    // selection-recovery wrapper replays a choice that can answer immediately.
    report(this, interrupted.has(this.id));
    return reinited.apply(this, args);
  };
  for (const name of ['auto', 'unauto']) {
    const original = lib.message.server[name];
    lib.message.server[name] = function (...args) {
      if (engine.setup.controlVersions) {
        if (lib.playerOL[this.id]?.ws !== this || this.closed) return;
        versions.set(this.id, (versions.get(this.id) ?? 0) + 1);
      }
      original.apply(this, args);
      report(this);
    };
  }
  if (engine.setup.controlVersions)
    for (const name of ['result', 'tempResult']) {
      const original = lib.message.server[name];
      lib.message.server[name] = function (result, ...args) {
        if (
          lib.playerOL[this.id]?.ws !== this ||
          this.closed ||
          !result ||
          typeof result !== 'object' ||
          !Object.hasOwn(result, 'partyNativeResult') ||
          result.partyControlVersion !== (versions.get(this.id) ?? 0)
        )
          return;
        // Native tempResult may be an array or a general ID; forced choices
        // may return the literal 'ai'. Preserve every native value's shape.
        return original.call(this, result.partyNativeResult, ...args);
      };
    }
  // A probe travels through the same authenticated relay and native executor.
  lib.message.server.partyPing = function (id) {
    if (Number.isSafeInteger(id) && id > 0) this.send('partyPong', id);
  };
  const cancel = (socket) => {
    clearTimeout(grace.get(socket));
    grace.delete(socket);
  };
  const close = (socket) => {
    if (!socket || closed.has(socket)) return;
    cancel(socket);
    closed.add(socket);
    socket.interrupted = false;
    socket.handlers.close?.();
  };
  return {
    disconnect(socket) {
      if (!socket || closed.has(socket) || grace.has(socket)) return;
      const client = lib.node.clients.find((client) => client.ws === socket && !client.closed);
      if (!client) return;
      const player = lib.playerOL[client.id];
      if (!player || _status.over) return close(socket);
      socket.interrupted = true;
      interrupted.set(client.id, { at: Date.now(), expired: false });
      player.setNickname(player.nickname + ' · 等待重连');
      game.broadcast(function (player) {
        player.setNickname(player.nickname + ' · 等待重连');
      }, player);
      grace.set(
        socket,
        setTimeout(() => {
          grace.delete(socket);
          interrupted.get(client.id).expired = true;
          close(socket);
        }, 20000),
      );
    },
    resume(socket) {
      if (!socket?.interrupted || !grace.has(socket)) return false;
      cancel(socket);
      socket.interrupted = false;
      socket.send(JSON.stringify(['opened']));
      return true;
    },
    close,
  };
}
