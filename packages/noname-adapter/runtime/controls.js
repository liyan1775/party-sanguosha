// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get, _status } from 'noname';

/** Restore native declarative filter data without treating JSON as function text. */
export function installNativeFilterDecoding() {
  if (globalThis.partyEngine.setup.role === 'worker') return;
  const parsed = get.parsedResult;
  get.parsedResult = function (value, ...args) {
    if (typeof value === 'string' && value.startsWith('_noname_func:[')) {
      // v1.11.6 encodes get.filter's _filter_args as JSON, but infoFuncOL
      // sanitizes that array as function source and returns a no-op. Rebuild
      // exactly the worker's original condition/index with the native factory.
      // Other functions retain the native parser; inbound code is still denied.
      try {
        const recipe = JSON.parse(value.slice(13));
        if (
          Array.isArray(recipe) &&
          recipe.length === 2 &&
          Number.isSafeInteger(recipe[1]) &&
          recipe[1] >= 0
        )
          return get.filter.apply(this, parsed.call(this, recipe, ...args));
      } catch {
        // Malformed recipes retain the native rejection behavior.
      }
    }
    return parsed.call(this, value, ...args);
  };
}

/** Native character details are a read-only reference, never a configuration route. */
export function installReadOnlyCharacterDetails() {
  const restrict = () => {
    lib.config.show_favourite = false;
    lib.config.change_skin = false;
  };
  // lib.config is initialized by boot, after these hooks are installed.
  const intro = get.nodeintro;
  get.nodeintro = function (...args) {
    restrict();
    return intro.apply(this, args);
  };
  const details = ui.click.charactercard;
  ui.click.charactercard = function (name, source, _edit, ...args) {
    restrict();
    if (!_status.dragged) _status.removePop?.();
    const result = details.call(this, name, source, true, ...args);
    for (const node of document.querySelectorAll('.charactercard .ban, .charactercard .fav'))
      node.remove();
    return result;
  };
}

/** An equipment card must not consume a click intended for its selectable owner. */
export function installEquipmentTargetSelection() {
  if (globalThis.partyEngine.setup.role !== 'player') return;
  const card = ui.click.card;
  ui.click.card = function (...args) {
    const owner = this.parentNode?.classList.contains('equips') ? this.closest('.player') : null;
    if (
      owner?.classList.contains('selectable') &&
      !this.classList.contains('selectable') &&
      typeof _status.event?.custom?.replace?.card !== 'function'
    )
      return ui.click.target.apply(owner, args);
    // Native selectable equipment (e.g. Renxin's cost) retains card selection.
    return card.apply(this, args);
  };
}

/** Use the native public count, never inspect or serialize the card pile. */
export function installDeckCounter() {
  const { role, tableView } = globalThis.partyEngine.setup;
  if (role === 'worker') {
    let observer;
    let lastCount;
    const publish = () => {
      if (!lib.configOL.gameStarted || !ui.cardPile) return;
      const count = ui.cardPile.childElementCount;
      if (count === lastCount) return;
      lastCount = count;
      // Native get.cards may update before its callers finish moving cards,
      // and an initial deal need not issue a final round-number update. Publish
      // the settled public size after the actual pile mutation, never its top
      // card, card IDs, contents or order.
      game.broadcastAll(
        function (round, count) {
          ui.updateRoundNumber(round, count);
        },
        game.roundNumber,
        count,
      );
    };
    const observe = () => {
      observer?.disconnect();
      if (!ui.cardPile) return;
      observer = new MutationObserver(publish);
      observer.observe(ui.cardPile, { childList: true });
    };
    const arena = ui.create.arena;
    ui.create.arena = function (...args) {
      const result = arena.apply(this, args);
      observe();
      return result;
    };
    observe();
    window.addEventListener('pagehide', () => observer?.disconnect(), { once: true });
    return;
  }
  if (role !== 'player' || tableView) return;
  const show = () => {
    if (!ui.cardPileNumber) return;
    ui.cardPileNumber.id = 'party-table-count';
    ui.cardPileNumber.style.display = '';
  };
  const arena = ui.create.arena;
  ui.create.arena = function (...args) {
    const result = arena.apply(this, args);
    show();
    return result;
  };
  const update = ui.updateRoundNumber;
  ui.updateRoundNumber = function (round, count, ...args) {
    const result = update.call(this, round, count, ...args);
    show();
    return result;
  };
}

/** A temporary skill choice must not overlap a retained public card pool. */
export function installDialogFocus() {
  if (globalThis.partyEngine.setup.role === 'worker') return;
  const prototype = lib.element.Dialog.prototype;
  const update = () => {
    const hasBackground = ui.dialogs.some((dialog) => dialog !== ui.dialog && dialog.static);
    for (const dialog of ui.dialogs) {
      dialog.classList.toggle(
        'party-background-dialog',
        dialog !== ui.dialog && Boolean(dialog.static) && !ui.dialog?.peaceDialog,
      );
      dialog.classList.toggle(
        'party-focused-dialog',
        dialog === ui.dialog && hasBackground && !dialog.peaceDialog,
      );
    }
  };
  for (const method of ['open', 'close']) {
    const original = prototype[method];
    prototype[method] = function (...args) {
      const result = original.apply(this, args);
      if (method === 'close') this.classList.add('party-background-dialog');
      update();
      return result;
    };
  }
}

export function installHumanConfirmation() {
  if (globalThis.partyEngine.setup.role !== 'worker') {
    const isRuleBackup = (event, info) =>
      event.isMine() &&
      ['chooseToUse', 'chooseToRespond'].includes(event.name) &&
      event._backupevent === event.skill &&
      info?.sourceSkill &&
      get.info(info.sourceSkill)?.chooseButton;
    const cancel = ui.click.cancel;
    ui.click.cancel = function (...args) {
      const event = _status.event;
      if (
        isRuleBackup(event, get.info(event.skill)) &&
        !event.norestore &&
        typeof event.custom?.replace?.confirm !== 'function'
      ) {
        // Native skill cancellation only marks the phase confirm as removing.
        // A recreated choice can reuse its same "c" state forever, leaving its
        // children over the restored skill controls. Close it through the
        // native lifecycle before restoring/rechecking the original choice.
        ui.confirm?.close();
      }
      return cancel.apply(this, args);
    };
    // The upstream hook also auto-confirms skills tagged direct even when the
    // config is off. Keep its other check hooks; human selections require OK.
    lib.hooks.checkEnd = lib.hooks.checkEnd.filter((hook) => hook.name !== 'autoConfirm');
    lib.hooks.checkEnd.push(function openSkillChoice(event, { ok }) {
      const info = get.info(event.skill);
      // A chooseButton skill's first result only opens its option picker. It
      // has no card/target materials yet; waiting for OK leaves every hand card
      // grey under the generic skill description. Keep final use/response and
      // option/material selections on the normal explicit-confirm path.
      if (
        ok &&
        event.isMine() &&
        ['chooseToUse', 'chooseToRespond'].includes(event.name) &&
        info?.chooseButton &&
        !info.viewAs &&
        get.noSelected()
      ) {
        ui.confirm?.close();
        if (event.skillDialog === true) event.skillDialog = false;
        event.dialog?.close?.();
        event.endButton?.close();
        delete event.endButton;
        // Return this navigation result to the rule worker. Running the native
        // factory on the phone would submit _sendskill containing executable
        // code, which the inbound gateway deliberately rejects.
        event.finish();
        ui.click.ok();
      } else if (isRuleBackup(event, info)) {
        // Recreated phase choices set fakeforce again, suppressing native
        // Cancel. Retain the native skill restore route before a final action.
        ui.create.confirm(ok ? 'oc' : 'c');
      }
    });
  }
}

/** Keep native chooseButton factories and their generated rules on the worker. */
export function installRuleSkillChoices() {
  if (globalThis.partyEngine.setup.role !== 'worker') return;
  const unwait = lib.element.Player.prototype.unwait;
  lib.element.Player.prototype.unwait = function (result) {
    // Also protect workers loaded by an older running Node service. This is a
    // server-only native field; accepting even plain data could replace rules.
    if (result && typeof result === 'object' && Object.hasOwn(result, '_sendskill')) {
      this.ws?.close();
      return;
    }
    const event = get.event?.();
    if (
      result &&
      typeof result === 'object' &&
      event?.player === this &&
      ['chooseToUse', 'chooseToRespond'].includes(event.name)
    ) {
      // A phone can cancel a backup and choose another skill/card. Match native
      // UI.ok's restore before the worker handles its next navigation/result.
      if (event._backup) event.restore();
      const info = lib.skill[result.skill];
      if (
        info?.chooseButton &&
        !info.viewAs &&
        !lib.filter.filterEnable(event, this, result.skill)
      ) {
        this.ws?.close();
        return;
      }
    }
    return unwait.call(this, result);
  };
  const dialogs = new WeakMap();
  const recipes = new WeakMap();
  const backupChoice = lib.element.GameEvent.prototype.backup;
  lib.element.GameEvent.prototype.backup = function (skill) {
    const source = lib.skill[skill]?.sourceSkill;
    const options = lib.skill[source]?.chooseButton;
    if (this.buttoned === source && typeof options?.backup === 'function')
      recipes.set(this, {
        skill,
        source,
        input: options.chooseControl ? this._result : this._result.links,
      });
    return backupChoice.call(this, skill);
  };
  let adding = 0;
  // Native chooseButton factories pass a live DOM dialog, which cannot travel
  // through native serialization. Retain its declared native construction
  // operations; never serialize DOM, inspect hands or rerun a phone factory.
  const prototype = lib.element.Dialog?.prototype;
  for (const name of ['add', 'addText', 'addSmall', 'addAuto', 'addNewRow']) {
    if (!prototype?.[name]) continue;
    const add = prototype[name];
    prototype[name] = function (...args) {
      if (!adding) {
        const operations = dialogs.get(this) ?? [];
        operations.push([name, args]);
        dialogs.set(this, operations);
      }
      adding++;
      try {
        return add.apply(this, args);
      } finally {
        adding--;
      }
    };
  }
  const sendChoice = lib.element.GameEvent.prototype.send;
  lib.element.GameEvent.prototype.send = function (...args) {
    const choice = this;
    const info = choice.skill && lib.skill[choice.skill];
    const parent = choice.getParent?.();
    const picker =
      ['chooseButton', 'chooseControl'].includes(choice.name) &&
      ['chooseToUse', 'chooseToRespond'].includes(parent?.name) &&
      lib.skill[parent.buttoned]?.chooseButton &&
      dialogs.has(choice.dialog);
    const backup =
      ['chooseToUse', 'chooseToRespond'].includes(choice.name) &&
      choice._backup &&
      info?.sourceSkill &&
      typeof lib.skill[info.sourceSkill]?.chooseButton?.backup === 'function';
    // Pinned xinxuanhuo captures its designated target in a local target2.
    // Native function text loses that binding on a phone. Evaluate the exact
    // worker rule and carry only its one public player reference; keep the
    // authoritative closure intact and leave all other filters alone.
    let designatedTargets;
    if (
      choice.name === 'chooseToUse' &&
      parent?.name === 'xinxuanhuo' &&
      typeof choice.filterTarget === 'function' &&
      [
        'filterTarget(card,player,target){returntarget===target2;}',
        'filterTarget(card,player2,target3){returntarget3===target2;}',
      ].includes(Function.prototype.toString.call(choice.filterTarget).replace(/\s+/g, ''))
    ) {
      const allowed = game.players.filter((target) =>
        choice.filterTarget({ name: 'sha', isCard: true }, choice.player, target),
      );
      if (allowed.length === 1) designatedTargets = allowed;
    }
    if (choice.player && (picker || backup || designatedTargets)) {
      // Preserve the native request shape (including its event name) so the
      // privacy scope and selection recovery retain this actor-only request.
      // The rule is taken ONLY from the worker's native factory, never a phone.
      const player = choice.player;
      const ownSend = Object.getOwnPropertyDescriptor(player, 'send');
      const sendPlayer = player.send;
      player.send = function (...values) {
        if (typeof values[0] === 'function' && values[1] === choice.name) {
          const callback = values[0];
          values[0] = function (name, args, set, parent, skills, extra, apply) {
            if (extra.recipe) {
              // Rebuild the pinned native factory with the worker's accepted
              // choice. Sending function text loses captured links/player
              // variables (e.g. 智绝); the worker still owns the actual rule.
              game.me.applySkills(skills);
              const next = game.me[name].apply(game.me, args);
              for (const [key, value] of set) next.set(key, value);
              next._modparent = parent;
              const previous = _status.eventManager.tempEvent;
              _status.eventManager.tempEvent = next;
              try {
                const { skill, source, input } = extra.recipe;
                lib.skill[skill] = lib.skill[source].chooseButton.backup(input, game.me);
                lib.skill[skill].sourceSkill = source;
              } finally {
                _status.eventManager.tempEvent = previous;
              }
              if (next._backupevent) next.backup(next._backupevent);
              game.resume();
              return;
            }
            if (extra.rule) lib.skill[extra.rule[0]] = extra.rule[1];
            if (extra.dialog) {
              const dialog = ui.create.dialog('hidden');
              for (const [method, values] of extra.dialog.operations)
                dialog[method].apply(dialog, values);
              dialog.noforcebutton = extra.dialog.noforcebutton;
              dialog.forcebutton = extra.dialog.forcebutton;
              if (name === 'chooseButton') args = [dialog];
              else set = [...set, ['dialog', dialog]];
            }
            apply(name, args, set, parent, skills);
          };
          const extra = {};
          values[3] = [...(values[3] ?? [])];
          if (designatedTargets) {
            values[3].push(
              ['partyDesignatedTargets', designatedTargets],
              [
                'filterTarget',
                function (card, player, target) {
                  return get.event().partyDesignatedTargets?.includes(target) === true;
                },
              ],
            );
          }
          if (backup) {
            const recipe = recipes.get(choice);
            if (recipe?.skill === choice.skill) extra.recipe = recipe;
            else extra.rule = [choice.skill, info];
            values[3].push(['_backupevent', choice.skill]);
            if (typeof choice.openskilldialog === 'string')
              values[3].push(['openskilldialog', choice.openskilldialog]);
          }
          if (picker) {
            extra.dialog = {
              operations: dialogs.get(choice.dialog).slice(),
              noforcebutton: Boolean(choice.dialog.noforcebutton),
              forcebutton: Boolean(choice.dialog.forcebutton),
            };
            values[3].push(['type', choice.type]);
          }
          values.push(extra, callback);
        }
        return sendPlayer.apply(this, values);
      };
      try {
        return sendChoice.apply(this, args);
      } finally {
        if (ownSend) Object.defineProperty(player, 'send', ownSend);
        else delete player.send;
      }
    }
    return sendChoice.apply(this, args);
  };
}

export function installControls() {
  let updateSettlement = () => {};
  installNativeFilterDecoding();
  installHumanConfirmation();
  installEquipmentTargetSelection();
  installRuleSkillChoices();
  installDialogFocus();
  installReadOnlyCharacterDetails();
  installDeckCounter();
  if (globalThis.partyEngine.setup.role === 'worker') {
    const reinited = lib.message.server.reinited;
    lib.message.server.reinited = function (...args) {
      const result = reinited.apply(this, args);
      const player = lib.playerOL[this.id];
      if (player?.ws === this)
        player.send(
          function (current, active, round, count) {
            _status.currentPhase = current;
            for (const player of [...game.players, ...game.dead])
              player.classList.toggle('glow_phase', active && player === current);
            ui.updateRoundNumber(round, count);
          },
          _status.currentPhase ?? null,
          !_status.over && Boolean(_status.currentPhase?.classList.contains('glow_phase')),
          game.roundNumber,
          ui.cardPile.childElementCount,
        );
      return result;
    };
  }
  if (globalThis.partyEngine.setup.role !== 'worker') {
    const init = lib.element.Player.prototype.init;
    lib.element.Player.prototype.init = function (...args) {
      const result = init.apply(this, args);
      if (!this.querySelector('.party-turn-badge')) {
        const badge = document.createElement('div');
        badge.className = 'party-turn-badge';
        badge.textContent = '回合中';
        this.append(badge);
      }
      return result;
    };
  }
  // The scaled native canvas is a fixed viewport. overflow:hidden still lets
  // focus/scrollIntoView move #window and crop the arena after choosing a general.
  // Dialogs and hand areas keep their own scrolling containers.
  const viewportStyle = document.createElement('style');
  viewportStyle.textContent =
    'html, body, #window { overflow: clip !important; } #party-action-status[hidden] { display: none !important; }';
  document.head.appendChild(viewportStyle);
  // Upstream uses innerHTML here. A lobby nickname is plain text everywhere.
  lib.element.Player.prototype.setNickname = function (value) {
    this.node.nameol.textContent = (value || this.nickname || '').slice(0, 16);
    return this;
  };
  // All room configuration and lifecycle belongs to the authenticated lobby.
  game.reload = () => {};
  game.addRecord = () => {};
  game.getVideoName = () => ['聚会三国杀', '局域网对局'];
  // Native menu construction assigns this callback again during boot. A fixed
  // accessor closes gesture/keyboard routes as well as the visible button.
  Object.defineProperty(ui.click, 'configMenu', {
    configurable: false,
    get: () => undefined,
    set: () => {},
  });
  Object.defineProperty(ui.click, 'connectMenu', {
    configurable: false,
    get: () => undefined,
    set: () => {},
  });
  ui.click.cardPile = () => {};
  const hideMenus = () => {
    for (const key of [
      'config',
      'config2',
      'replay',
      'exit',
      'pause',
      'cardPileButton',
      'deckMonitor',
      'roomInfo',
      'chatButton',
    ])
      ui[key]?.hide?.();
    for (const selector of ['#config', '#exit', '#pause', '.menubutton.round']) {
      document.querySelectorAll(selector).forEach((node) => {
        node.style.display = 'none';
      });
    }
  };
  new MutationObserver(() => {
    hideMenus();
    updateSettlement();
  }).observe(document.body, { childList: true, subtree: true });
  if (globalThis.partyEngine.setup.role === 'player') {
    if (!globalThis.partyEngine.setup.tableView) {
      // Online settlement may execute a serialized native function, or reinit
      // may set over directly. Observe its real dialog instead of only wrapping
      // game.over/lib.onover; neither intercepts all native ending paths.
      updateSettlement = () => {
        if (_status.over && ui.dialog?.isConnected && !ui.partyReturnRoom?.isConnected) {
          globalThis.partyEngine.proof.ended = true;
          ui.partyReturnRoom = ui.create.control('回到房间', () => {
            parent.postMessage(
              { type: 'party-return-room', matchId: globalThis.partyEngine.setup.id },
              location.origin,
            );
          });
          ui.partyReturnRoom.id = 'party-return-room';
        }
      };
    }
    const feedback = document.createElement('div');
    feedback.id = 'party-action-status';
    feedback.setAttribute('role', 'status');
    feedback.hidden = true;
    feedback.style.cssText =
      'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:100;pointer-events:none;background:#172723dd;color:#fff;padding:6px 12px;border-radius:8px;font:14px system-ui';
    document.body.appendChild(feedback);
    let timer;
    let showTimer;
    const clearFeedback = () => {
      feedback.hidden = true;
      clearTimeout(timer);
      clearTimeout(showTimer);
    };
    const send = game.send;
    game.send = function (...args) {
      if (args[0] === 'result') {
        feedback.textContent = '已提交操作，等待牌桌更新…';
        clearFeedback();
        showTimer = setTimeout(() => {
          feedback.hidden = false;
        }, 350);
        timer = setTimeout(() => {
          feedback.hidden = true;
        }, 3000);
      }
      return send.apply(this, args);
    };
    window.addEventListener('party-table-update', clearFeedback);
    window.addEventListener('party-action-ack', clearFeedback);
    window.addEventListener('pagehide', clearFeedback, { once: true });
  }
}
