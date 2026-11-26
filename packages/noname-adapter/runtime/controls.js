// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get, _status } from 'noname';
import { sharesHandWith } from './privacy.js';
import { confirmationLift, landlordRole, selectionSummary } from './control-presentation.js';

function visibleRect(node) {
  if (!node?.isConnected) return null;
  const visible =
    node.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ??
    (getComputedStyle(node).visibility === 'visible' && !node.closest('[hidden], .hidden'));
  if (!visible) return null;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

const rectangles = (nodes) => Array.from(nodes, visibleRect).filter(Boolean);
const overlaps = (a, b, gap = 0) =>
  a.left < b.right + gap &&
  a.right > b.left - gap &&
  a.top < b.bottom + gap &&
  a.bottom > b.top - gap;
const boxAt = (left, top, width, height) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
const inViewport = (box, inset) =>
  box.left >= inset &&
  box.top >= inset &&
  box.right <= innerWidth - inset &&
  box.bottom <= innerHeight - inset;
const nativeControls = () =>
  rectangles([
    ui.control,
    ui.confirm,
    ...document.querySelectorAll('#control, .control:not(.removing)'),
  ]);
const popups = () =>
  rectangles(
    document.querySelectorAll(
      '#window :is(.dialog, .popped, .tip, .prompt, .popup-container, .menubg, .party-basket-menu)',
    ),
  );

// Native controls can be inserted, hidden or animated without a new game
// selection. Follow those geometry changes without measuring a settled table.
function watchTableGeometry(update, { active = () => true, badge = false } = {}) {
  const landmarks =
    '#window, #arena, #me, #handcards1, #handcards2, #system > *, #control, .control, .control > *, .player, .card.selected, .dialog, .popped, .tip, .prompt, .popup-container, .menubg, .party-basket-menu';
  const seatDetails =
    '.player > :is(.avatar, .avatar2, .name, .name2, .nameol, .nickname, .group, .identity, .hp, .equips, .count, .party-basket)';
  const relevant = (node) => node?.matches?.(landmarks) || (badge && node?.matches?.(seatDetails));
  const moving = new Map();
  let frame;
  let disposed = false;
  const observed = new Set();
  const ro = new ResizeObserver(schedule);
  function measure() {
    frame = undefined;
    for (const node of [ui.window, ui.arena, ui.control, document.getElementById('me')]) {
      if (node && !observed.has(node)) {
        ro.observe(node);
        observed.add(node);
      }
    }
    for (const node of observed) {
      if (node.isConnected) continue;
      ro.unobserve(node);
      observed.delete(node);
    }
    update();
    const now = performance.now();
    for (const [node, motions] of moving) {
      for (const [key, deadline] of motions) if (now >= deadline) motions.delete(key);
      if (!node.isConnected || !motions.size) moving.delete(node);
    }
    if (moving.size && active()) schedule();
  }
  function schedule() {
    if (!disposed && frame === undefined && !document.hidden)
      frame = requestAnimationFrame(measure);
  }
  const observer = new MutationObserver((records) => {
    if (!active()) return;
    for (const { target, type, attributeName, oldValue, addedNodes, removedNodes } of records) {
      if (
        target.nodeType !== Node.ELEMENT_NODE ||
        target.closest('#party-selection-layer, .party-seat-status')
      )
        continue;
      if (type === 'attributes') {
        if (attributeName === 'aria-hidden' && !relevant(target)) continue;
        if (oldValue === target.getAttribute(attributeName)) continue;
        if (
          relevant(target) ||
          ui.selected.cards.includes(target) ||
          (attributeName === 'class' &&
            target.matches('.card') &&
            /(?:^|\s)selected(?:\s|$)/.test(oldValue ?? ''))
        ) {
          schedule();
          return;
        }
      } else if (
        (relevant(target) && target !== ui.window && target !== ui.arena) ||
        [...addedNodes, ...removedNodes].some(relevant)
      ) {
        schedule();
        return;
      }
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-position', 'data-number'],
  });
  const transitions = ['transitionrun', 'transitionend', 'transitioncancel'];
  function motion(event) {
    if (!relevant(event.target)) return;
    const key = event.propertyName;
    if (event.type === 'transitionrun') {
      if (
        !/^(transform|translate|scale|opacity|visibility|top|left|right|bottom|width|height|margin|padding|inset|zoom)/.test(
          key,
        )
      )
        return;
      if (!moving.has(event.target)) moving.set(event.target, new Map());
      moving.get(event.target).set(key, performance.now() + 3000);
    } else moving.get(event.target)?.delete(key);
    if (active()) schedule();
  }
  for (const type of transitions) document.addEventListener(type, motion, true);
  window.addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', schedule);
  lib.hooks.checkEnd.push(schedule);
  lib.hooks.uncheckEnd.push(schedule);
  window.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      ro.disconnect();
      for (const type of transitions) document.removeEventListener(type, motion, true);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('resize', schedule);
    },
    { once: true },
  );
  schedule();
}

function installSeatBadges() {
  const { settings, shanhetu } = globalThis.partyEngine.setup;
  const landmarkSelector =
    ':scope > :is(.avatar, .avatar2, .name, .name2, .nameol, .nickname, .group, .identity, .hp, .equips, .count, .party-basket)';
  function sync() {
    if (document.hidden || !ui.arena || !lib.configOL.gameStarted) return;
    const players = [...game.players, ...game.dead];
    const obstacles = [
      ...rectangles(players),
      ...players.flatMap((player) => rectangles(player.querySelectorAll(landmarkSelector))),
      ...nativeControls(),
      ...rectangles(
        document.querySelectorAll('#system > *, #me .card.selected, #party-selected-preview'),
      ),
    ];
    for (const player of players) {
      if (!player.isConnected) continue;
      const identity = player.node?.identity;
      const label = landlordRole(settings.mode, player.identity);
      if (label && identity?.firstElementChild) {
        identity.dataset.partyLandlordRole = player.identity;
        if (identity.firstElementChild.textContent !== label)
          identity.firstElementChild.textContent = label;
      }
      let bar = player.querySelector(':scope > .party-seat-status');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'party-seat-status';
        const turn = document.createElement('span');
        turn.className = 'party-turn-badge';
        turn.textContent = '回合中';
        bar.append(turn);
        player.append(bar);
      }
      if (!shanhetu && Number.isInteger(player.seatNum)) {
        let seat = bar.querySelector('.party-seat-number');
        if (!seat) {
          seat = document.createElement('span');
          seat.className = 'party-seat-number';
          bar.prepend(seat);
        }
        const text = `${player.seatNum}号位`;
        if (seat.textContent !== text) seat.textContent = text;
      }
      const face = visibleRect(player);
      const { left, top, width, height } = bar.getBoundingClientRect();
      const safe = (x, y) => {
        const area = boxAt(x, y, width, height);
        return inViewport(area, 4) && !obstacles.some((other) => overlaps(area, other, 2));
      };
      let dock;
      if (face && width && height) {
        const cx = clamp(face.left + (face.width - width) / 2, 4, innerWidth - width - 4);
        const cy = face.top + (face.height - height) / 2;
        // Prefer the outside top edge. Seats against the screen edge use the
        // outside bottom edge or a side, never painted over the portrait.
        dock = [
          [cx, face.top - height - 6],
          [cx, face.bottom + 6],
          [face.right + 6, face.top + 6],
          [face.left - width - 6, face.top + 6],
          [face.right + 6, cy],
          [face.left - width - 6, cy],
          [cx, face.top - height - 21],
          [cx, face.bottom + 21],
        ].find(([x, y]) => safe(x, y));
      }
      bar.toggleAttribute('data-docked', Boolean(dock));
      if (!dock) continue;
      const [x, y] = dock;
      // Move by the viewport delta in the player's own scaled coordinate system.
      if (Math.abs(x - left) > 0.35)
        bar.style.left = `${(parseFloat(bar.style.left) || 0) + (x - left) / (width / bar.offsetWidth)}px`;
      if (Math.abs(y - top) > 0.35)
        bar.style.top = `${(parseFloat(bar.style.top) || 0) + (y - top) / (height / bar.offsetHeight)}px`;
      obstacles.push(boxAt(x, y, width, height));
    }
  }
  watchTableGeometry(sync, { badge: true });
}

function installTrackerDismissal(matchId) {
  const close = () =>
    parent.postMessage({ type: 'party-tracker-dismiss', matchId }, location.origin);
  let wasChoosing = false;
  const observer = new MutationObserver(() => {
    if (!ui.arena) return;
    const choosing = Boolean(ui.arena.querySelector('.player:is(.selectable, .selected)'));
    if (choosing && !wasChoosing) close();
    wasChoosing = choosing;
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        event.target?.closest?.('#arena .player:is(.selectable,.selected)') ||
        event.target?.matches?.('#window, #window > .background, #arena, #arena > .background')
      )
        close();
    },
    { capture: true },
  );
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}

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

/** A later target of a singleCard action depends on every preceding target. */
export function installDependentTargetSelection() {
  if (globalThis.partyEngine.setup.role !== 'player') return;
  const target = ui.click.target;
  ui.click.target = function (...args) {
    const event = _status.event;
    const info = event?.name === 'chooseToUse' && get.info(get.card());
    const selected = ui.selected.targets.slice();
    const index = selected.indexOf(this);
    const result = target.apply(this, args);
    if (
      index >= 0 &&
      info?.singleCard &&
      typeof info.filterAddedTarget === 'function' &&
      typeof event.custom?.replace?.target !== 'function' &&
      !ui.selected.targets.includes(this)
    ) {
      // Native deselection leaves the former second target in slot one. Its
      // added-target filter cannot prove it is a legal first target (借刀).
      // Retain the card and earlier targets; clear only dependent selections.
      for (const dependent of selected.slice(index + 1)) {
        dependent.classList.remove('selected');
        ui.selected.targets.remove(dependent);
        dependent.unprompt();
      }
      game.check();
    }
    return result;
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
    // Native reinit omits game.roundNumber. The reconnect callback restores
    // its public display; skills such as 宗护 must use that same actual round.
    if (Number.isSafeInteger(round) && round >= 0) game.roundNumber = round;
    const result = update.call(this, round, count, ...args);
    show();
    return result;
  };
}

/** A temporary skill choice must not overlap a retained public card pool. */
export function installDialogFocus() {
  if (globalThis.partyEngine.setup.role === 'worker') return;
  const prototype = lib.element.Dialog.prototype;
  let preview,
    signature = '';
  const showWugu = () => {
    const pool = ui.dialogs?.find(
      (dialog) => dialog.static && dialog !== ui.dialog && dialog._args?.includes('五谷丰登'),
    );
    const responding =
      !_status.over && (_status.event?.type === 'wuxie' || get.event?.()?.type === 'wuxie');
    if (!pool || !responding || !pool.buttons?.length) {
      preview?.remove();
      preview = undefined;
      signature = '';
      return;
    }
    if (!preview) {
      preview = document.createElement('section');
      preview.id = 'party-wugu-preview';
      preview.setAttribute('aria-label', '五谷丰登剩余展示牌，只读');
      for (const event of ['click', 'mousedown', 'touchstart', 'touchmove', 'touchend', 'wheel'])
        preview.addEventListener(event, (event) => event.stopPropagation());
      document.body.append(preview);
    }
    preview.style.zoom = String(1 / (game.documentZoom || 1));
    preview.style.width = `${Math.min(520, innerWidth - (innerWidth > 600 ? 240 : 24))}px`;
    const cards = pool.buttons
      .map((button) => button.link)
      .filter((card) => card?.name && card.name !== 'party_unknown');
    const next = JSON.stringify(cards.map((c) => [c.cardid, c.name, c.suit, c.number, c.nature]));
    if (next === signature) return;
    signature = next;
    const title = document.createElement('strong');
    title.textContent = `五谷丰登 · 剩余${cards.length}张 · 仅查看`;
    const list = document.createElement('div');
    for (const card of cards) {
      const item = document.createElement('span');
      if (['heart', 'diamond'].includes(card.suit)) item.className = 'is-red';
      const suit = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' }[card.suit] ?? '';
      const rank = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[card.number] ?? card.number;
      item.textContent = `${suit}${rank ?? ''} ${get.translation(card.nature ?? '')}${get.translation(card.name)}`;
      list.append(item);
    }
    preview.replaceChildren(title, list);
  };
  const update = () => {
    const hasBackground = ui.dialogs?.some((dialog) => dialog !== ui.dialog && dialog.static);
    for (const dialog of ui.dialogs ?? []) {
      dialog.classList.toggle(
        'party-background-dialog',
        dialog !== ui.dialog && Boolean(dialog.static) && !ui.dialog?.peaceDialog,
      );
      dialog.classList.toggle(
        'party-focused-dialog',
        dialog === ui.dialog && hasBackground && !dialog.peaceDialog,
      );
    }
    showWugu();
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
  const timer = setInterval(showWugu, 100);
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(timer);
      preview?.remove();
    },
    { once: true },
  );
}

/** Separate native OK/Cancel touch targets, including reused confirm controls. */
export function installTouchConfirmation() {
  if (globalThis.partyEngine.setup.role !== 'player' || globalThis.partyEngine.setup.tableView)
    return;
  const touch = matchMedia('(pointer: coarse)').matches;
  const style = document.createElement('style');
  style.id = 'party-touch-confirm-style';
  style.textContent = `
    #control[data-party-confirm-dock] {
      translate: 0 var(--party-confirm-lift, 0px);
      transition: none !important;
    }
    #control > .party-touch-confirm {
      display: inline-flex; padding: 0; overflow: visible;
      height: auto; min-height: var(--party-confirm-height, 48px);
      background: transparent !important; box-shadow: none !important;
      border: none !important;
    }
    #control > .party-touch-confirm > div {
      display: inline-flex; align-items: center; justify-content: center;
      box-sizing: border-box; min-width: var(--party-confirm-width, 80px);
      min-height: var(--party-confirm-height, 48px); padding: 8px 16px;
      font-size: var(--party-confirm-font, 18px); line-height: 1.3;
      border: 1px solid #87958a; border-radius: 8px;
      background: #f4f0e8; color: #283b34; text-shadow: none;
      box-shadow: 0 1px 3px #0003;
    }
    #control > .party-touch-confirm > div + div {
      margin-left: var(--party-confirm-gap, 20px);
    }
    #control > .party-touch-confirm > .party-confirm-ok {
      background: #e6ca88; border-color: #9e803b; color: #27342a;
    }
  `;
  document.head.append(style);
  let frame;
  let dock;
  let lift = 0;
  const clearDock = () => {
    dock?.removeAttribute('data-party-confirm-dock');
    dock?.style.removeProperty('--party-confirm-lift');
    dock = undefined;
    lift = 0;
  };
  const place = () => {
    const parent = ui.control;
    const confirm = ui.confirm;
    if (dock && dock !== parent) clearDock();
    if (!parent?.isConnected || !confirm?.isConnected || confirm.classList.contains('removing')) {
      clearDock();
      return false;
    }
    const hand = rectangles(document.querySelectorAll('#me .handcards, #me .handcards .card'));
    const bounds = parent.getBoundingClientRect();
    const scale = bounds.width / parent.offsetWidth || game.documentZoom || 1;
    // A freshly created confirm initially has zero opacity but already has a
    // hit box. Measure its entire group and its children before first paint.
    const bottom = Math.max(
      bounds.bottom,
      confirm.getBoundingClientRect().bottom,
      ...Array.from(confirm.children, (button) => button.getBoundingClientRect().bottom),
    );
    const next = confirmationLift(bottom, Math.min(...hand.map((rect) => rect.top)), lift, scale);
    if (next !== lift || dock !== parent) {
      dock = parent;
      dock.setAttribute('data-party-confirm-dock', '');
      dock.style.setProperty('--party-confirm-lift', `${-next}px`);
      lift = next;
    }
    return true;
  };
  const track = () => {
    frame = place() ? requestAnimationFrame(track) : undefined;
  };
  const size = () => {
    const control = ui.confirm;
    if (!touch || !control) return;
    control.classList.add('party-touch-confirm');
    // Native replace() sums child widths without their margins. Clear that
    // cached width so native updatec() positions the full separated group.
    control.style.removeProperty('width');
    const zoom =
      Number.isFinite(game.documentZoom) && game.documentZoom > 0 ? game.documentZoom : 1;
    for (const [key, pixels] of [
      ['width', 80],
      ['height', 48],
      ['gap', 20],
      ['font', 18],
    ])
      control.style.setProperty(`--party-confirm-${key}`, `${Math.ceil(pixels / zoom)}px`);
    for (const button of control.children)
      button.classList.toggle('party-confirm-ok', button.link === 'ok');
  };
  const update = ui.updatec;
  ui.updatec = function (...args) {
    size();
    const result = update.apply(this, args);
    if (frame === undefined) track();
    else place();
    return result;
  };
  const zoom = ui.updatez;
  ui.updatez = function (...args) {
    const result = zoom.apply(this, args);
    if (ui.control) ui.updatec();
    return result;
  };
  const confirm = ui.create.confirm;
  ui.create.confirm = function (...args) {
    const result = confirm.apply(this, args);
    ui.updatec();
    return result;
  };
  window.addEventListener('resize', () => {
    requestAnimationFrame(() => {
      if (ui.control) ui.updatec();
    });
  });
  window.addEventListener(
    'pagehide',
    () => {
      cancelAnimationFrame(frame);
      clearDock();
    },
    { once: true },
  );
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
      globalThis.partyEngine.setup.farmerHandSharing &&
      event?.player === this &&
      ['chooseToUse', 'chooseToRespond', 'chooseCard', 'chooseToDiscard'].includes(event.name) &&
      Array.isArray(result?.cards) &&
      result.cards.some((card) => {
        if (get.itemtype(card) !== 'card') return false;
        const owner = get.owner(card);
        return (
          owner &&
          sharesHandWith(this, owner) &&
          owner.getCards('h').includes(card) &&
          !event.cards?.includes(card)
        );
      })
    )
      return false;
    if (
      result &&
      typeof result === 'object' &&
      event?.player === this &&
      ['chooseToUse', 'chooseToRespond'].includes(event.name)
    ) {
      if (result.bool && result.skill === 'olzonghu_backup') {
        const rule = lib.skill.olzonghu_backup;
        const [min, max] = get.select(rule?.selectCard);
        const cards = result.cards;
        const targets = result.targets;
        if (
          rule?.sourceSkill !== 'olzonghu' ||
          !Number.isSafeInteger(min) ||
          min < 1 ||
          min !== max ||
          !Array.isArray(cards) ||
          cards.length !== min ||
          new Set(cards).size !== min ||
          !cards.every((card) => this.getCards('he').includes(card)) ||
          !Array.isArray(targets) ||
          targets.length !== 1 ||
          !game.players.includes(targets[0]) ||
          !rule.filterTarget(result.card, this, targets[0]) ||
          this.hasSkill('olzonghu_used')
        )
          // Selection recovery resends the original choice without a new wait
          // or deadline. Never let native precontent give zero/foreign cards.
          return false;
      }
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
      ((info?.sourceSkill &&
        typeof lib.skill[info.sourceSkill]?.chooseButton?.backup === 'function') ||
        // 宗护's paid second stage is a native subskill, not a factory backup.
        // Its broadcast viewAs is lost on reinit, so retain this accepted rule.
        (choice.skill === 'olzonghu_backup2' &&
          choice._backupevent === choice.skill &&
          choice.norestore &&
          ['sha', 'shan'].includes(info?.viewAs?.name)));
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
            if (Number.isSafeInteger(extra.round)) game.roundNumber = extra.round;
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
            // A native factory may read public round state. Keep its original
            // value on both reinit and a rejected stale material submission.
            if (Number.isSafeInteger(game?.roundNumber)) extra.round = game.roundNumber;
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
  installTouchConfirmation();
  installEquipmentTargetSelection();
  installDependentTargetSelection();
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
    installSeatBadges();
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
      const setup = globalThis.partyEngine.setup;
      installTrackerDismissal(setup.id);
      let returnLabel = setup.shanhetu ? '继续征程' : '回到房间';
      let journeySettled = false;
      let notifiedEnded = false;
      const returnFromTable = () => {
        parent.postMessage({ type: 'party-return-room', matchId: setup.id }, location.origin);
      };
      // Online settlement may execute a serialized native function, or reinit
      // may set over directly. Observe its real dialog instead of only wrapping
      // game.over/lib.onover; neither intercepts all native ending paths.
      updateSettlement = () => {
        const nativeSettlement = _status.over && ui.dialog?.isConnected;
        if (_status.over && !notifiedEnded) {
          notifiedEnded = true;
          document.documentElement.setAttribute('data-party-settled', '');
          parent.postMessage({ type: 'party-native-ended', matchId: setup.id }, location.origin);
        }
        if (
          (nativeSettlement || journeySettled) &&
          ui.control?.isConnected &&
          !ui.partyReturnRoom?.isConnected
        ) {
          globalThis.partyEngine.proof.ended = true;
          ui.partyReturnRoom = ui.create.control(returnLabel, returnFromTable);
          ui.partyReturnRoom.id = 'party-return-room';
        }
      };
      window.addEventListener('message', (event) => {
        if (
          event.source !== parent ||
          event.origin !== location.origin ||
          event.data?.type !== 'party-finished' ||
          event.data.matchId !== setup.id
        )
          return;
        document.documentElement.setAttribute('data-party-settled', '');
        if (!setup.shanhetu || !['ending', 'continue'].includes(event.data.shanhetuReturn)) return;
        // An ended native reinit may rebuild the seats without replaying the result dialog.
        journeySettled = true;
        const label = event.data.shanhetuReturn === 'ending' ? '查看结局' : '继续征程';
        if (label !== returnLabel) {
          returnLabel = label;
          if (ui.partyReturnRoom?.isConnected) ui.partyReturnRoom.replace(label, returnFromTable);
        }
        updateSettlement();
      });
      parent.postMessage({ type: 'party-settlement-ready', matchId: setup.id }, location.origin);
    }
    const feedback = document.createElement('div');
    feedback.id = 'party-action-status';
    feedback.setAttribute('role', 'status');
    feedback.hidden = true;
    feedback.style.cssText =
      'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:100;pointer-events:none;background:var(--zt-panel-dark,#12242c);color:#fffaf0;border:1px solid var(--zt-gold,#e0be75);padding:6px 14px;border-radius:4px;font:600 13px system-ui';
    document.body.appendChild(feedback);

    // Anti-misclick read-only badge: shows currently selected cards without altering native click-to-play.
    const selectedPreview = document.createElement('div');
    selectedPreview.id = 'party-selected-preview';
    selectedPreview.setAttribute('aria-live', 'polite');
    selectedPreview.hidden = true;
    const selectionLayer = document.createElement('div');
    selectionLayer.id = 'party-selection-layer';
    selectionLayer.append(selectedPreview);
    document.body.appendChild(selectionLayer);
    const suitMap = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
    const rankMap = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
    const syncSelectedPreview = () => {
      if (_status.over || !ui.selected?.cards?.length) {
        selectedPreview.hidden = true;
        return;
      }
      const names = ui.selected.cards.slice(0, 4).map((card) => {
        const suit = suitMap[card.suit] ?? '';
        const num = rankMap[card.number] ?? (card.number ? String(card.number) : '');
        const nat = card.nature ? get.translation(card.nature) : '';
        return `${suit}${num} ${nat}${get.translation(card.name)}`;
      });
      const extra = ui.selected.cards.length > 4 ? ` 等 ${ui.selected.cards.length} 张` : '';
      const targets = (ui.selected.targets ?? [])
        .slice(0, 2)
        .map((t) => get.translation(t.name) || t.nickname || '')
        .filter(Boolean);
      const event = _status.event;
      const info = event?.skill && get.info(event.skill);
      const converted = info?.viewAs && get.card();
      const text = selectionSummary(
        names,
        extra,
        targets,
        ui.selected.targets.length > 2,
        converted && get.translation(info.sourceSkill || event.skill),
        converted &&
          `${converted.nature ? get.translation(converted.nature) : ''}${get.translation(converted.name)}`,
      );
      if (selectedPreview.textContent !== text) selectedPreview.textContent = text;
      selectedPreview.hidden = false;
      const layer = selectionLayer.getBoundingClientRect();
      const scaleX = layer.width / selectionLayer.offsetWidth;
      const scaleY = layer.height / selectionLayer.offsetHeight;
      const density = String(clamp(1 / scaleY, 0.75, 2.2));
      if (selectedPreview.style.getPropertyValue('--party-preview-density') !== density)
        selectedPreview.style.setProperty('--party-preview-density', density);
      const { width, height } = selectedPreview.getBoundingClientRect();
      const controls = nativeControls();
      const hand = visibleRect(document.getElementById('me'));
      const raised = rectangles(ui.selected.cards);
      const boardObstacles = [
        ...raised,
        ...popups(),
        ...rectangles(
          document.querySelectorAll('#arena .player, .party-seat-status[data-docked], #system > *'),
        ),
        ...(hand ? [hand] : []),
      ];
      const obstacles = [...controls, ...boardObstacles];
      const top = Math.min(
        ...controls.map((rect) => rect.top),
        hand?.top ?? Infinity,
        ...raised.map((rect) => rect.top),
      );
      const left = (innerWidth - width) / 2;
      const safetyBand = Math.min(96, innerHeight / 4);
      // Try the top edge, then the first free line beneath any overlay in
      // the top band. This also follows native toolbar wrapping on resize.
      const topDocks = [
        8,
        ...obstacles
          .filter((obstacle) => obstacle.left < left + width && obstacle.right > left)
          .map((obstacle) => obstacle.bottom + (controls.includes(obstacle) ? 15 : 4))
          .filter((candidate) => candidate >= 8 && candidate + height <= safetyBand)
          .sort((a, b) => a - b),
      ];
      const candidates = [top - height - 15, ...topDocks];
      let y = candidates.find((candidate) => {
        const area = boxAt(left, candidate, width, height);
        return (
          inViewport(area, 6) &&
          controls.every(
            (control) => area.bottom + 14 <= control.top || area.top >= control.bottom + 14,
          ) &&
          obstacles.every((obstacle) => !overlaps(area, obstacle, 3))
        );
      });
      let x = left;
      if (y === undefined) {
        // On a short eight-seat table the top row is full, and safe confirm
        // docking can leave no line above the buttons. Use the side of the
        // real controls rather than the empty, pointer-transparent #control row.
        const buttons = rectangles(document.querySelectorAll('#control > .control:not(.removing)'));
        const lanes = [
          left,
          innerWidth - width - 9,
          9,
          ...buttons.flatMap((control) => [control.right + 15, control.left - width - 15]),
        ];
        const rows = [
          (hand?.top ?? innerHeight) - height - 6,
          ...buttons.map((control) => control.top + (control.height - height) / 2),
          ...boardObstacles.map((obstacle) => obstacle.bottom + 4),
        ];
        for (const row of rows) {
          const lane = lanes.find((lane) => {
            const area = boxAt(lane, row, width, height);
            return (
              inViewport(area, 6) &&
              buttons.every((control) => !overlaps(area, control, 14)) &&
              boardObstacles.every((obstacle) => !overlaps(area, obstacle, 3))
            );
          });
          if (lane !== undefined) {
            x = lane;
            y = row;
            break;
          }
        }
      }
      selectedPreview.style.visibility = y === undefined ? 'hidden' : '';
      if (y === undefined) return;
      selectedPreview.style.left = `${(x - layer.left) / scaleX}px`;
      selectedPreview.style.top = `${(y - layer.top) / scaleY}px`;
    };
    watchTableGeometry(syncSelectedPreview, {
      active: () => !selectedPreview.hidden || Boolean(ui.selected?.cards?.length),
    });
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
