// SPDX-License-Identifier: GPL-3.0-only
// The mode delegates cards, skills, AI, responses, turns and death to Noname.
// Its adapter-specific setup gives every seat to a phone or native AI.
import { lib, game, ui, get, _status } from 'noname';
import singleMode from '/mode/single.js';
import { connectRuleHost } from '/party-relay.js';
import { installPrivacy } from '/party-privacy.js';

export const type = 'mode';
export default function () {
  const mode = singleMode();
  mode.name = 'party_duel_lab';
  mode.start = async function () {
    const { setup, proof } = globalThis.partyEngineLab;
    lib.init.onfree();
    if (setup.role !== 'rule-host') {
      game.connect(`ws://${location.host}/relay?id=${setup.role}`);
      return;
    }
    _status.connectMode = true;
    _status.mode = 'dianjiang';
    Object.assign(lib.configOL, {
      mode: 'party_duel_lab',
      number: 2,
      player_number: 2,
      single_mode: 'dianjiang',
      double_character: false,
      characterPack: ['standard'],
      cardPack: ['standard'],
      banned: [],
      bannedcards: [],
      choose_timeout: '60',
      observe: false,
    });
    game.onlineroom = true;
    lib.node ??= {};
    game.createServer();
    game.prepareArena(2);
    // A detached native Player supplies the engine's viewpoint API without
    // belonging to game.players / game.dead or taking a participant's seat.
    game.me = ui.create.player();
    game.me.playerid = 'rule-host';
    game.me.nickname = '规则执行宿主';
    // Native timer broadcasts reference a participant ID; this viewpoint has
    // no counterpart on phones and therefore must not broadcast a player timer.
    game.me.hideTimer = () => {};
    game.me.showTimer = () => {};
    installPrivacy();
    game.getVideoName = () => ['聚会单挑验证', '单武将'];
    game.addRecord = () => {};
    const connected = new Promise((resolve) => {
      game.updateWaiting = () => {
        if (
          setup.seats
            .filter((seat) => seat.kind === 'human')
            .every((seat) =>
              lib.node.clients.some((client) => client.id === seat.id && client.inited),
            )
        )
          resolve();
      };
    });
    _status.waitingForPlayer = true;
    lib.message.server.init = function (version) {
      const seat = setup.seats.find((seat) => seat.id === this.id && seat.kind === 'human');
      if (!seat || version !== lib.versionOL) {
        this.ws.close();
        return;
      }
      this.nickname = seat.nickname;
      this.avatar = 'caocao';
      this.send('init', this.id, lib.configOL, location.host, false, 'lab');
    };
    await connectRuleHost();
    proof.hostReady = true;
    await connected;
    _status.waitingForPlayer = false;
    for (let index = 0; index < setup.seats.length; index++) {
      const seat = setup.seats[index];
      const player = game.players[index];
      player.playerid = seat.id;
      player.nickname = seat.nickname;
      player.setNickname();
      if (seat.kind === 'human')
        player.ws = lib.node.clients.find((client) => client.id === seat.id);
      lib.playerOL[seat.id] = player;
    }
    lib.configOL.gameStarted = true;
    game.broadcast('gameStart');
    const map = setup.seats.map((seat) => [seat.id, seat.nickname]);
    game.broadcast(
      function (map, config) {
        lib.configOL = config;
        ui.create.players(2);
        ui.create.me();
        game.me.playerid = game.onlineID;
        const ordered = map.slice();
        while (ordered[0][0] !== game.onlineID) ordered.push(ordered.shift());
        ordered.forEach(([id, nickname], index) => {
          const player = game.players[index];
          player.playerid = id;
          player.nickname = nickname;
          player.setNickname();
          lib.playerOL[id] = player;
        });
        _status.mode = 'dianjiang';
      },
      map,
      lib.configOL,
    );
    game.broadcastAll(
      function (ids) {
        const first = lib.playerOL[ids[0]],
          second = lib.playerOL[ids[1]];
        first.identity = 'zhu';
        second.identity = 'fan';
        first.enemy = second;
        second.enemy = first;
        first.showIdentity();
        second.showIdentity();
      },
      setup.seats.map((seat) => seat.id),
    );
    const pool = Object.keys(lib.characterPack.standard).filter(
      (name) => !lib.filter.characterDisabled(name),
    );
    const choices = game.players.map((player) => [
      player,
      ['选择一名武将', [pool.randomRemove(5), 'character']],
      true,
      1,
    ]);
    const selected = await game.players[0].chooseButtonOL(choices).forResult();
    for (const player of game.players) {
      const name = selected[player.playerid]?.links?.[0];
      if (!name) throw new Error(`Native character choice missing for ${player.playerid}`);
      game.broadcastAll(
        function (id, name) {
          lib.playerOL[id].init(name);
        },
        player.playerid,
        name,
      );
    }
    game.syncState();
    _status.videoInited = true;
    const event = _status.event;
    event.trigger('gameStart');
    await game.gameDraw(game.zhu, 4);
    proof.started = true;
    await game.phaseLoop(game.zhu);
  };
  mode.game.checkResult = function () {
    if (game.players.length === 1) game.over();
  };
  return mode;
}
