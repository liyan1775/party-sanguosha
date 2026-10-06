// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get, _status } from 'noname';
import { connectRuleHost } from './relay.js';

function configure(setup) {
  const mode = setup.settings.mode === 'duel' ? 'single' : setup.settings.mode;
  _status.connectMode = true;
  _status.mode = mode === 'single' ? 'dianjiang' : mode === 'versus' ? '2v2' : 'normal';
  const packs = lib.config.characters;
  Object.assign(lib.configOL, {
    mode,
    number: setup.seats.length,
    player_number: setup.seats.length,
    single_mode: 'dianjiang',
    versus_mode: '2v2',
    identity_mode: 'normal',
    doudizhu_mode: 'normal',
    double_character: false,
    characterPack: packs,
    cardPack: ['standard'],
    banned: [],
    bannedcards: [],
    choose_timeout: '60',
    observe: false,
    feiyang_version: 'online',
    enhance_dizhu: 'none',
    enhance_nongmin: 'default',
    replacetwo: false,
    replace_handcard: true,
    olfeiyang_four: false,
    choose_group: true,
  });
}
function roster(setup) {
  const names = new Set(setup.preset.additionalCharacters);
  for (const pack of setup.preset.completePacks)
    for (const name of Object.keys(lib.characterPack[pack] ?? {})) names.add(name);
  for (const [pack, groups] of Object.entries(setup.preset.packGroups)) {
    for (const group of groups)
      for (const name of lib.characterSort[pack]?.[group] ?? []) names.add(name);
  }
  return [...names].filter((name) => lib.character[name] && !lib.filter.characterDisabled(name));
}
function identities(mode, count) {
  if (mode === 'versus') return Array(count).fill('zhong');
  if (mode === 'identity')
    return {
      5: ['zhu', 'zhong', 'fan', 'fan', 'nei'],
      6: ['zhu', 'zhong', 'fan', 'fan', 'fan', 'nei'],
      7: ['zhu', 'zhong', 'zhong', 'fan', 'fan', 'fan', 'nei'],
      8: ['zhu', 'zhong', 'zhong', 'fan', 'fan', 'fan', 'fan', 'nei'],
    }[count].randomSort();
  return Array.from({ length: count }, (_, index) => (index === 0 ? 'zhu' : 'fan'));
}
async function start() {
  const { setup, proof } = globalThis.partyEngine;
  // Native loadConfig resets duration to 500; apply the room's pace afterwards
  // on both the rule worker and phones, without changing any AI decisions.
  lib.config.duration = setup.settings.generalPreset === 'beginner' ? 1000 : 500;
  if (setup.role !== 'worker') {
    lib.config.auto_confirm = false;
    // Off-screen computer mirrors cannot wait for browser animation frames.
    // Native chooseToMove keeps its filters and result, with instant DOM moves.
    if (setup.tableView) lib.config.animation_choose_to_move = false;
    // This native list disables automatic frequent-skill acceptance for human
    // choices, including both the first and repeated Luoshen questions.
    lib.config.autoskilllist = Object.keys(lib.skill);
  }
  for (const [name, path] of Object.entries(setup.portraitAliases))
    if (lib.character[name]) lib.character[name].img = path;
  for (const [name, path] of Object.entries(setup.mobilePortraits ?? {}))
    // Native avatar backgrounds prepend assetURL even inside their fallback
    // array, so use a path relative to the versioned core directory.
    if (lib.character[name]) lib.character[name].img = path.replace('/engine/', '../../');
  const allowed = new Set(roster(setup));
  proof.roster = [...allowed];
  // This also keeps transformation/AI candidate lists inside the room's preset.
  for (const name of Object.keys(lib.character)) if (!allowed.has(name)) delete lib.character[name];
  lib.group = lib.group.filter((group) => ['wei', 'shu', 'wu', 'qun', 'shen'].includes(group));
  lib.init.onfree();
  if (setup.role !== 'worker') {
    // Native init replaces the startup event stack. Load the projector before
    // opening the socket so no await can keep start() alive after init arrives.
    const project = setup.tableView
      ? (await import('./table-projection.js')).installTableProjection
      : null;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const playerUrl = setup.tableView
      ? `${scheme}//${location.host}/engine/socket/${setup.id}/view?seat=${setup.playerId}`
      : `${scheme}//${location.host}/engine/socket/${setup.id}/player`;
    if (setup.playerPolling) {
      const { connectPlayer } = await import('./player-transport.js');
      connectPlayer(game, playerUrl);
    } else game.connect(playerUrl);
    if (project) project();
    const close = game.ws.onclose;
    game.ws.onclose = function (event) {
      close.call(this, event);
      if (!_status.over && event.code !== 1008 && event.reason !== '已在另一页面继续对局')
        parent.postMessage(
          { type: setup.tableView ? 'party-view-failed' : 'party-disconnected', matchId: setup.id },
          location.origin,
        );
    };
    game.ws.onerror = () => {};
    return;
  }
  configure(setup);
  // A running older Node service may still serve newly built pages. Its
  // runtime allowlist has no recovery module; enable only with explicit setup.
  if (setup.selectionRecovery) {
    const { installSelectionRecovery } = await import('./selection-recovery.js');
    installSelectionRecovery();
  }
  game.onlineroom = true;
  lib.node ??= {};
  game.createServer();
  game.connectPlayers = [];
  game.prepareArena(setup.seats.length);
  game.me = ui.create.player();
  game.me.playerid = 'rule-worker';
  game.me.nickname = '电脑服务';
  game.me.identity = 'zhong';
  game.me.side = true;
  game.me.hideTimer = () => {};
  game.me.showTimer = () => {};
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
    const player = lib.playerOL[this.id];
    if (player && lib.configOL.gameStarted) {
      player.ws = this;
      player.isAuto = false;
      this.send(
        'reinit',
        lib.configOL,
        get.arenaState(),
        game.getState?.() ?? {},
        location.host,
        null,
        _status.onreconnect,
        _status.cardtag,
        _status.postReconnect,
      );
    } else this.send('init', this.id, lib.configOL, location.host, false, setup.id);
  };
  await connectRuleHost();
  proof.hostReady = true;
  await connected;
  _status.waitingForPlayer = false;
  // A random seat order also randomizes landlord/first action in open modes.
  const seats = setup.seats.slice().randomSort();
  const roles = identities(setup.settings.mode, seats.length);
  for (let index = 0; index < seats.length; index++) {
    const seat = seats[index],
      player = game.players[index];
    player.playerid = seat.id;
    player.nickname = seat.nickname;
    player.setNickname();
    player.identity = roles[index];
    player.side = setup.settings.mode === 'versus' ? index === 0 || index === 3 : index % 2 === 0;
    player.ai.shown = player.identity === 'zhu' || setup.settings.mode !== 'identity' ? 1 : 0;
    player.identityShown = player.ai.shown === 1;
    if (player.identity === 'zhu') {
      game.zhu = player;
      player.isZhu = true;
    }
    if (seat.kind === 'human') player.ws = lib.node.clients.find((client) => client.id === seat.id);
    lib.playerOL[seat.id] = player;
  }
  lib.configOL.gameStarted = true;
  game.broadcast('gameStart');
  for (const player of game.players) {
    const map = game.players.map((current) => ({
      id: current.playerid,
      nickname: current.nickname,
      identity:
        setup.settings.mode === 'identity' && current !== player && !current.identityShown
          ? 'unknown'
          : current.identity,
      shown: current.identityShown,
      side: current.side,
    }));
    player.send(
      function (map, config, variant) {
        lib.configOL = config;
        _status.mode = variant;
        ui.create.players(map.length);
        ui.create.me();
        game.me.playerid = game.onlineID;
        const ordered = map.slice();
        while (ordered[0].id !== game.onlineID) ordered.push(ordered.shift());
        ordered.forEach((seat, index) => {
          const current = game.players[index];
          current.playerid = seat.id;
          current.nickname = seat.nickname;
          current.setNickname();
          current.identity = seat.identity;
          current.identityShown = seat.shown;
          current.ai.shown = seat.shown ? 1 : 0;
          current.side = seat.side;
          current.setIdentity(seat.identity);
          if (seat.identity === 'zhu') {
            game.zhu = current;
            current.isZhu = true;
          }
          lib.playerOL[seat.id] = current;
        });
        if (config.mode === 'versus')
          for (const current of game.players) {
            current.node.identity.firstChild.textContent =
              current.side === game.me.side ? '友' : '敌';
            current.node.identity.dataset.color = `${current.side}zhu`;
          }
      },
      map,
      lib.configOL,
      _status.mode,
    );
  }
  if (setup.settings.mode === 'duel') {
    game.fan = game.players[1];
    game.zhu.enemy = game.fan;
    game.fan.enemy = game.zhu;
    game.broadcast(
      function (zhuId, fanId) {
        game.zhu = lib.playerOL[zhuId];
        game.fan = lib.playerOL[fanId];
        game.zhu.enemy = game.fan;
        game.fan.enemy = game.zhu;
      },
      game.zhu.playerid,
      game.fan.playerid,
    );
  }
  if (setup.settings.mode === 'versus') {
    _status.firstAct = game.players[0];
    _status.onreconnect = [
      function () {
        for (const current of [...game.players, ...game.dead]) {
          current.node.identity.firstChild.textContent =
            current.side === game.me.side ? '友' : '敌';
          current.node.identity.dataset.color = `${current.side}zhu`;
        }
      },
    ];
  }
  const pool = roster(setup);
  const choiceCount = Math.min(5, Math.floor(pool.length / seats.length));
  if (choiceCount < 1) throw new Error('武将白名单为空');
  const choices = game.players.map((player) => [
    player,
    ['选择一名武将', [pool.randomRemove(choiceCount), 'character']],
    true,
    1,
  ]);
  const offers = new Map(choices.map((choice) => [choice[0].playerid, choice[1][1][0].slice()]));
  const selected = await game.players[0].chooseButtonOL(choices).forResult();
  for (const [player, ...args] of choices) {
    // Native chooseButtonOL returns the sentinel on timeout/disconnect rather
    // than a button result. Finish that seat through the native button AI.
    if (selected[player.playerid] === 'ai') {
      const automatic = player.chooseButton(...args);
      // A late reconnect may already have rebound player.ws. The expired
      // choice must still finish through native AI, without asking it again.
      automatic.isOnline = () => false;
      selected[player.playerid] = await automatic.forResult();
    }
  }
  for (const player of game.players) {
    const name = selected[player.playerid]?.links?.[0];
    if (!name || !offers.get(player.playerid).includes(name)) throw new Error('无效的武将选择');
    game.broadcastAll(
      function (id, name) {
        lib.playerOL[id].init(name);
      },
      player.playerid,
      name,
    );
  }
  for (const player of game.players) {
    const groups = get.selectGroup(player.name);
    if (groups.length > 1) {
      player._groupChosen = get.selectGroup(player.name, true);
      const result = await player
        .chooseButton(
          ['请选择你的势力', [groups.map((group) => ['', '', `group_${group}`]), 'vcard']],
          true,
        )
        .set('ai', () => Math.random())
        .set('direct', true)
        .forResult();
      const group = result.links?.[0]?.[2]?.slice(6);
      if (!groups.includes(group)) throw new Error('无效的势力选择');
      await player.changeGroup(group);
    }
  }
  if (['identity', 'doudizhu'].includes(setup.settings.mode)) {
    if (setup.settings.mode === 'doudizhu' || !game.zhu.isInitFilter('noZhuHp'))
      game.broadcastAll(function (id) {
        const player = lib.playerOL[id];
        player.maxHp++;
        player.hp++;
        player.update();
      }, game.zhu.playerid);
  }
  if (setup.settings.mode === 'doudizhu') {
    game.broadcastAll(function (id) {
      lib.playerOL[id].addSkill(['feiyang', 'bahu']);
    }, game.zhu.playerid);
  }
  if (setup.settings.mode === 'identity') {
    // Native identity death handling needs the lord skills and shown flags.
    game.zhu.isZhu = true;
    game.zhu.identityShown = true;
  }
  _status.videoInited = true;
  game.syncState();
  _status.event.trigger('gameStart');
  const first = setup.settings.mode === 'versus' ? game.players[0] : game.zhu;
  await game.gameDraw(
    first,
    setup.settings.mode === 'versus' ? (player) => (player === first.previous ? 5 : 4) : 4,
  );
  proof.started = true;
  globalThis.partyEngine.signal('started');
  await game.phaseLoop(first);
}

export function adaptMode(mode) {
  mode.startBefore = () => {};
  mode.start = start;
  if (mode.name === 'identity') {
    const dieAfter = mode.element.player.dieAfter;
    mode.element.player.dieAfter = function (...args) {
      // Upstream assumes every client already holds the hidden identity. Our
      // clients only receive it when it becomes public, so assign it explicitly
      // before the native reveal and refresh the earlier death animation label.
      game.broadcast(
        function (player, identity) {
          player.identity = identity;
          player.setIdentity(identity);
          if (player.node.dieidentity)
            player.node.dieidentity.textContent = get.translation(`${identity}2`);
          else player.$dieAfter();
        },
        this,
        this.identity,
      );
      return dieAfter.apply(this, args);
    };
    mode.game.partyShowIdentityBase = mode.game.showIdentity;
    mode.game.showIdentity = function (...args) {
      if (globalThis.partyEngine.setup.role === 'worker')
        game.broadcast(
          function (identities) {
            for (const [id, identity] of identities) {
              const player = lib.playerOL[id];
              player.identity = identity;
              player.identityShown = true;
              player.ai.shown = 1;
              player.setIdentity(identity);
              player.node.identity.classList.remove('guessing');
            }
          },
          [...game.players, ...game.dead].map((player) => [player.playerid, player.identity]),
        );
      // This wrapper can itself be sent by native broadcastAll. Use a game
      // property, not a closure variable that is absent on the receiving phone.
      return game.partyShowIdentityBase.apply(this, args);
    };
  }
  if (mode.name === 'single')
    mode.game.checkResult = function () {
      if (game.players.length === 1) game.over();
    };
  return mode;
}
