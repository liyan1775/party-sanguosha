// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get, _status } from 'noname';
import { connectRuleHost } from './relay.js';
import { broadcastCharacterInit } from './privacy.js';

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
    cardPack: [...lib.config.cards],
    banned: [],
    bannedcards: setup.cardPilePolicy ? [...setup.preset.cardPile.excludedCards] : [],
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
  if (setup.rosterPolicy)
    return setup.preset.characters.filter(
      (name) => lib.character[name] && !lib.filter.characterDisabled(name),
    );
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

/** Reserve lobby preferences before drawing private or team-shared offers. */
export function generalChoices(setup, pool, players = game.players) {
  const identity = setup.settings.mode === 'identity';
  const landlord = setup.settings.mode === 'doudizhu';
  const scale = setup.settings.generalPreset === 'beginner' ? 1 : 2;
  const choiceCount = Math.min(identity ? 3 * scale : 5, Math.floor(pool.length / players.length));
  if (choiceCount < 1) throw new Error('武将白名单为空');
  if (
    landlord &&
    pool.length < players.reduce((count, player) => count + (player === game.zhu ? 10 : 6), 0)
  )
    throw new Error('斗地主武将候选不足');
  const preferences = setup.settings.allowGeneralSelection ? (setup.generalSelections ?? {}) : {};
  const reserved = new Set();
  for (const [id, name] of Object.entries(preferences)) {
    if (
      !setup.seats.some((seat) => seat.id === id && seat.kind === 'human') ||
      !pool.includes(name) ||
      reserved.has(name)
    )
      throw new Error('无效的大厅点将');
    reserved.add(name);
  }
  pool = pool.filter((name) => !reserved.has(name));
  if (setup.settings.mode === 'versus') {
    const teams = new Map();
    if (players.length !== 4 || players.some((player) => typeof player.side !== 'boolean'))
      throw new Error('2v2 队伍配置无效');
    for (const player of players) {
      if (teams.has(player.side)) continue;
      const members = players.filter((other) => other.side === player.side);
      if (members.length !== 2) throw new Error('2v2 队伍配置无效');
      const preferred = members.map((member) => preferences[member.playerid]).filter(Boolean);
      const candidates = [...preferred, ...pool.randomRemove(10 - preferred.length)];
      if (candidates.length !== 10) throw new Error('2v2 队伍武将候选不足');
      teams.set(player.side, candidates);
    }
    return players.map((player) => {
      const preference = preferences[player.playerid];
      const shared = teams.get(player.side);
      // Both teammates can choose either preference. Only the display order
      // differs, so a person's lobby preference remains their first button.
      const candidates = preference
        ? [preference, ...shared.filter((name) => name !== preference)]
        : shared.slice();
      return [
        player,
        {
          createDialog: ['从队伍将池选择一名武将', [candidates, 'character']],
          forced: true,
          selectButton: 1,
          // Pinned online modes supply this AI explicitly. The generic native
          // chooseButton defaults to a constant and always takes the first card.
          ai: () => Math.random(),
          // Keep the original ten visible, including a lobby preference an AI
          // teammate claimed before the phone's dialog opened. This private
          // state is part of the original request, so refresh restores labels.
          partyTeamChoice: { preference: preference ?? null, taken: null },
          filterButton: function (button) {
            const state = get.event().partyTeamChoice;
            const taken = button.link === state.taken;
            const labels = [];
            if (button.link === state.preference) labels.push('我的点将');
            if (taken) labels.push('队友已选');
            if (state.aiTeammate) {
              const selected = ui.selected.buttons.indexOf(button);
              if (selected >= 0) labels.push(selected === 0 ? '自己' : 'AI 队友');
            }
            button.classList.toggle('party-team-taken', taken);
            button.setAttribute('aria-disabled', String(taken));
            button.style.filter = taken ? 'grayscale(1)' : '';
            let badge = button.querySelector('.party-general-status');
            if (labels.length) {
              if (!badge) {
                badge = document.createElement('div');
                badge.className = 'party-general-status';
                badge.style.cssText =
                  'position:absolute;left:1px;right:1px;bottom:2px;z-index:3;padding:2px;border-radius:4px;background:#17231fee;color:#fff;font:12px/16px system-ui;text-align:center;white-space:pre-line;pointer-events:none';
                button.appendChild(badge);
              }
              const text = labels.join('\n');
              if (badge.textContent !== text) badge.textContent = text;
            } else badge?.remove();
            return !taken;
          },
        },
      ];
    });
  }
  return players.map((player) => {
    const preference = preferences[player.playerid];
    if (identity && player === game.zhu) {
      const lords = pool.filter((name) => lib.character[name].isZhugong);
      const ordinary = pool.filter((name) => !lib.character[name].isZhugong);
      const lordCount = 3 * scale - (preference && lib.character[preference].isZhugong ? 1 : 0);
      const candidates = [
        ...(preference ? [preference] : []),
        ...lords.randomRemove(Math.min(lordCount, lords.length)).sort(lib.sort.character),
      ];
      // Keep the agreed total even when other seats reserved the usual lords.
      // A preference occupies its own category's slot; it never adds a button.
      candidates.push(...ordinary.randomRemove(5 * scale - candidates.length));
      if (candidates.length !== 5 * scale) throw new Error('主公武将候选不足');
      return [
        player,
        ['主公先选择一名武将', [candidates, 'character']],
        true,
        1,
        () => Math.random(),
      ];
    }
    const count = landlord ? (player === game.zhu ? 10 : 6) : choiceCount;
    const candidates = preference
      ? [preference, ...pool.randomRemove(count - 1)]
      : pool.randomRemove(count);
    if (candidates.length !== count) throw new Error('武将候选不足');
    return [
      player,
      [
        landlord
          ? player === game.zhu
            ? '地主：选择一名武将（10名候选）'
            : '农民：选择一名武将（6名候选）'
          : '选择一名武将',
        [candidates, 'character'],
      ],
      true,
      1,
      () => Math.random(),
    ];
  });
}

/** One real teammate chooses an ordered pair; AI-only teams keep native AI. */
export function delegateVersusChoices(setup, batch) {
  const delegated = new Map();
  const isHuman = (player) =>
    setup.seats.some((seat) => seat.id === player.playerid && seat.kind === 'human');
  for (const [player, params] of batch) {
    if (!isHuman(player)) continue;
    const teammate = batch.find(([other]) => other !== player && other.side === player.side)?.[0];
    if (!teammate || isHuman(teammate)) continue;
    params.selectButton = 2;
    params.partyTeamChoice.aiTeammate = teammate.playerid;
    delegated.set(teammate.playerid, player.playerid);
  }
  return { requested: batch.filter(([player]) => !delegated.has(player.playerid)), delegated };
}

/** Atomically claim shared generals, keeping the other native choice pending. */
export function trackVersusChoices(batch, replayChoice) {
  const confirmed = new Map();
  const restore = [];
  const title = (player) => {
    const teammate = batch.find(([other]) => other !== player && other.side === player.side)?.[0];
    const name = confirmed.get(teammate?.playerid);
    const params = batch.find(([current]) => current === player)?.[1];
    if (params?.partyTeamChoice.aiTeammate)
      return `你是 ${player.seatNum} 号位，AI 队友是 ${teammate.seatNum} 号位 · 先选自己，再选 AI 队友，最后点确定`;
    return `从队伍将池选择一名武将 · 你是 ${player.seatNum} 号位，队友是 ${teammate.seatNum} 号位${name ? `（已选${get.translation(name)}）` : '（正在选将）'}`;
  };
  const claim = (player, result) => {
    const params = batch.find(([current]) => current === player)?.[1];
    const offer = params?.createDialog[1][0];
    const name = result?.links?.[0];
    if (
      confirmed.has(player.playerid) ||
      result?.bool === false ||
      !Array.isArray(result?.links) ||
      result?.links?.length !== params?.selectButton ||
      new Set(result?.links).size !== params?.selectButton ||
      !result.links.every((name) => offer.includes(name) && name !== params.partyTeamChoice.taken)
    )
      return false;
    confirmed.set(player.playerid, name);
    if (params.partyTeamChoice.aiTeammate)
      confirmed.set(params.partyTeamChoice.aiTeammate, result.links[1]);
    for (const [teammate, otherParams] of batch) {
      if (teammate === player || teammate.side !== player.side) continue;
      // Only availability changes. The original pool and preference stay
      // visible and valid; recovery retains this exact native parameter object.
      otherParams.partyTeamChoice.taken = name;
      const dialog = otherParams.createDialog;
      dialog[0] = title(teammate);
      teammate.send(
        function (text, name) {
          const event = get.event();
          if (event?.name !== 'chooseButton' || !event.dialog?.querySelector('.button.character'))
            return;
          event.partyTeamChoice.taken = name;
          event.createDialog[0] = text;
          const caption = event.dialog.querySelector('.caption');
          if (caption) caption.textContent = text;
          // Unselect the now unavailable general, including a tentative click.
          // The worker still rejects stale submissions already in flight.
          if (ui.selected.buttons.some((button) => button.link === name)) game.uncheck('button');
          game.check();
        },
        dialog[0],
        name,
      );
    }
    return true;
  };
  const replay = (player) => {
    if (replayChoice) return replayChoice(player);
    // Compatibility with an older service that cannot load recovery: resend
    // this startup request without another native wait() or a new deadline.
    const args = batch.find(([current]) => current === player).slice(1);
    player.send(function (args) {
      const next = game.me.chooseButton(...args);
      next.complexSelect = true;
      game.resume();
    }, args);
  };
  for (const [player, params] of batch) {
    const dialog = params.createDialog;
    dialog[0] = title(player);
    for (const method of ['unwait', 'tempUnwait', 'chooseButton']) {
      const descriptor = Object.getOwnPropertyDescriptor(player, method);
      const original = player[method];
      restore.push(() => {
        if (descriptor) Object.defineProperty(player, method, descriptor);
        else delete player[method];
      });
      if (method === 'unwait')
        player.unwait = function (result) {
          const waiting = lib.node.torespond[this.playerid];
          if (waiting !== '_noname_waiting' && !waiting?._noname_waiting) return;
          // Subsequent god-group choices and native timeout/close handling keep
          // their original behavior. Tentative tempResult never calls unwait.
          if (confirmed.has(this.playerid) || result === 'ai') return original.call(this, result);
          if (!claim(this, result)) return replay(this);
          return original.call(this, result);
        };
      else if (method === 'tempUnwait')
        player.tempUnwait = function (result) {
          // Native tempUnwait invokes the wait callback without a final result.
          // Shared generals can only be claimed by a confirmed submission.
          if (confirmed.has(this.playerid)) return original.call(this, result);
        };
      else
        player.chooseButton = function (...args) {
          const choice = original.apply(this, args);
          if (args[0] !== params) return choice;
          const forResult = choice.forResult;
          choice.forResult = async function (...resultArgs) {
            let result = await forResult.apply(this, resultArgs);
            if (claim(player, result)) return result;
            // A native local AI can finish alongside its teammate. Retry with
            // the remaining pool and the same native decision, never a random
            // replacement or another request to an expired human connection.
            const automatic = original.apply(player, args);
            automatic.isOnline = () => false;
            result = await automatic.forResult();
            if (!claim(player, result)) throw new Error('无效的队伍武将选择');
            return result;
          };
          return choice;
        };
    }
  }
  return () => restore.forEach((reset) => reset());
}

/** Identity alone reveals the lord before asking the remaining seats. */
export async function selectGenerals(setup, pool, initialize, replayChoice) {
  const initialized = new Set();
  const choose = async (batch) => {
    const { requested, delegated } =
      setup.settings.mode === 'versus'
        ? delegateVersusChoices(setup, batch)
        : { requested: batch, delegated: new Map() };
    const restore =
      setup.settings.mode === 'versus' ? trackVersusChoices(batch, replayChoice) : () => {};
    try {
      const selected = await game.players[0].chooseButtonOL(requested).forResult();
      for (const [player, ...args] of requested) {
        // Keep the upstream button AI for offline/expired human and bot choices.
        // A late reconnect must not ask an already expired choice again.
        if (selected[player.playerid] === 'ai') {
          const automatic = player.chooseButton(...args);
          automatic.isOnline = () => false;
          selected[player.playerid] = await automatic.forResult();
        }
      }
      for (const [teammate, controller] of delegated) {
        const pair = selected[controller];
        if (
          !Array.isArray(pair?.links) ||
          pair.links.length !== 2 ||
          new Set(pair.links).size !== 2
        )
          throw new Error('无效的 AI 队友武将选择');
        selected[teammate] = { bool: true, links: [pair.links[1]] };
        selected[controller] = { ...pair, links: [pair.links[0]] };
      }
      for (const [player, ...args] of batch) {
        const name = selected[player.playerid]?.links?.[0];
        const dialog = args[0].createDialog ?? args[0];
        if (!name || !dialog[1][0].includes(name) || initialized.has(name))
          throw new Error('无效的武将选择');
        initialized.add(name);
        await initialize(player, name);
      }
    } finally {
      restore();
    }
  };
  if (setup.settings.mode === 'identity') {
    await choose(generalChoices(setup, pool, [game.zhu]));
    // Only the chosen lord is removed; unused lord offers return to the pool.
    // Lobby preferences of the remaining seats stay reserved throughout.
    const remaining = {
      ...setup,
      generalSelections: Object.fromEntries(
        Object.entries(setup.generalSelections ?? {}).filter(([id]) => id !== game.zhu.playerid),
      ),
    };
    await choose(
      generalChoices(
        remaining,
        pool.filter((name) => !initialized.has(name)),
        game.players.filter((player) => player !== game.zhu),
      ),
    );
  } else await choose(generalChoices(setup, pool));
}

/** Keep OL's turn-one reduction in the native phaseDraw path. */
export async function initialDraw(setup) {
  const versus = setup.settings.mode === 'versus';
  const first = versus ? game.players[0] : game.zhu;
  if (versus) _status.first_less = true;
  await game.gameDraw(first, versus ? (player) => (player === first.previousSeat ? 5 : 4) : 4);
  return first;
}
// Older WebKit gives module-level async declarations Function.prototype, so the
// native instanceof check sends them through the legacy step-script parser.
// An async expression retains AsyncFunction.prototype on the same browsers.
const start = async function start() {
  const { setup, proof } = globalThis.partyEngine;
  // A pre-policy Node service may still run existing matches. It has neither
  // these modules in its allowlist nor a roster snapshot, so require its flag.
  if (setup.rosterPolicy) {
    const { validateNativeRoster } = await import('./roster-policy.js');
    validateNativeRoster(lib, setup.preset);
  }
  if (setup.cardPilePolicy) {
    const { prepareCardPile } = await import('./card-pile.js');
    prepareCardPile(lib, setup.preset);
  }
  // Native loadConfig resets duration to 500; apply the room's pace afterwards
  // on both the rule worker and phones, without changing any AI decisions.
  lib.config.duration = 1000;
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
  const groups = ['wei', 'shu', 'wu', 'qun', 'shen'];
  if ([...allowed].some((name) => lib.character[name]?.group === 'jin')) groups.push('jin');
  lib.group = lib.group.filter((group) => groups.includes(group));
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
      if (this.pageLeaving) return;
      close.call(this, event);
      if (!_status.over && event.code !== 1008 && event.reason !== '已在另一页面继续对局')
        parent.postMessage(
          { type: setup.tableView ? 'party-view-failed' : 'party-disconnected', matchId: setup.id },
          location.origin,
        );
      else if (!_status.over && !setup.tableView)
        parent.postMessage(
          {
            type: 'party-connection-ended',
            matchId: setup.id,
            reason: event.reason || '对局连接已失效，请确认当前房间或手动重连。',
          },
          location.origin,
        );
    };
    game.ws.onerror = () => {};
    return;
  }
  configure(setup);
  let selectionRecovery;
  // A running older Node service may still serve newly built pages. Its
  // runtime allowlist has no recovery module; enable only with explicit setup.
  if (setup.selectionRecovery) {
    const { installSelectionRecovery } = await import('./selection-recovery.js');
    selectionRecovery = installSelectionRecovery();
  }
  if (setup.connectionRecovery) {
    const { installConnectionRecovery } = await import('./connection-recovery.js');
    globalThis.partyEngine.connectionRecovery = installConnectionRecovery();
  }
  const offerLuckCards = setup.luckCards
    ? (await import('./luck-cards.js')).installLuckCards()
    : null;
  const enableSurrender = setup.surrender
    ? (await import('./surrender.js')).installSurrender()
    : null;
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
      player.isAuto = setup.connectionRecovery === true && player.isAuto === true;
      player.setNickname(player.nickname + (player.isAuto ? ' · 托管' : ''));
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
    if (setup.settings.mode === 'versus') player.seatNum = index + 1;
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
      function (map, config, variant, pile, natures) {
        lib.configOL = config;
        _status.mode = variant;
        // prepareArena creates the pile before phones connect. Its native
        // broadcast has no recipients then; first entry needs the same public
        // card-name/nature catalog that native reinit already restores.
        lib.inpile = pile;
        lib.inpile_nature = natures;
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
      lib.inpile,
      lib.inpile_nature,
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
  await selectGenerals(
    setup,
    roster(setup),
    async (player, name) => {
      broadcastCharacterInit(player, name);
      if (
        setup.settings.mode === 'identity' &&
        player === game.zhu &&
        !player.isInitFilter('noZhuHp')
      )
        game.broadcastAll(function (id) {
          const lord = lib.playerOL[id];
          lord.maxHp++;
          lord.hp++;
          lord.update();
        }, player.playerid);
      const groups = get.selectGroup(name);
      if (groups.length > 1) {
        player._groupChosen = get.selectGroup(name, true);
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
    },
    selectionRecovery?.replay,
  );
  if (setup.settings.mode === 'doudizhu') {
    game.broadcastAll(function (id) {
      const lord = lib.playerOL[id];
      lord.maxHp++;
      lord.hp++;
      lord.update();
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
  const first = await initialDraw(setup);
  if (offerLuckCards) await offerLuckCards();
  proof.started = true;
  globalThis.partyEngine.signal('started');
  enableSurrender?.();
  await game.phaseLoop(first);
};

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
