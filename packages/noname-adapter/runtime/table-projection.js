// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get, _status } from 'noname';

// Runs ONLY in a local, authenticated seat mirror on the server computer.
// The rule executor's native serialization has already applied privacy.js.
// Project explicit visible fields; never serialize native events or storage.
export function installTableProjection() {
  const { setup } = globalThis.partyEngine;
  const swap = game.$elementSwap;
  game.$elementSwap = function (first, second, duration, ...args) {
    if (duration !== 0) return swap.call(this, first, second, duration, ...args);
    if (!document.contains(first) || !document.contains(second))
      return Promise.reject(new Error('移动牌区已失效'));
    if (first === second) return Promise.resolve();
    // Upstream's zero-duration Promise.all evaluates the second destination
    // after moving the first adjacent card, restoring the original order.
    // Swap UI nodes atomically; native filterMove and moved/results stay intact.
    const a = document.createTextNode(''),
      b = document.createTextNode('');
    first.replaceWith(a);
    second.replaceWith(b);
    a.replaceWith(second);
    b.replaceWith(first);
    return Promise.resolve();
  };
  const modernSwap = game.$swapElement;
  game.$swapElement = function (first, second, duration, ...args) {
    return duration === 0
      ? game.$elementSwap(first, second, 0)
      : modernSwap.call(this, first, second, duration, ...args);
  };
  const epoch = crypto.randomUUID();
  const keys = new WeakMap();
  let nextKey = 0;
  let revision = 0;
  let choice = 0;
  let previousEvent;
  let actions = new Map();
  let previous = '';
  let result = '';
  let timer;
  const events = [];
  globalThis.partyEngine.present = (event) => {
    events.push(event);
    if (events.length > 32) events.shift();
    schedule();
  };
  const key = (node) => {
    if (!keys.has(node)) keys.set(node, `n${++nextKey}`);
    return keys.get(node);
  };
  const plain = (value) => {
    const span = document.createElement('span');
    span.innerHTML = typeof value === 'string' ? value : '';
    return span.textContent.trim();
  };
  const visible = (node) => {
    if (!node?.isConnected) return false;
    for (let parent = node; parent && parent !== document.body; parent = parent.parentElement) {
      if (
        parent.hidden ||
        parent.classList.contains('hidden') ||
        parent.classList.contains('removing') ||
        parent.style.display === 'none'
      )
        return false;
    }
    return true;
  };
  const disabled = (node) =>
    node.classList.contains('disabled') || node.parentElement?.classList.contains('disabled');
  const selected = (node) =>
    node.classList.contains('selected') || node.classList.contains('glow2');
  const actionable = (node) =>
    visible(node) && !disabled(node) && (node.classList.contains('selectable') || selected(node));
  function action(node, enabled, run, validate = () => visible(node) && !disabled(node)) {
    if (!enabled) return '';
    const id = key(node);
    actions.set(id, { run, validate });
    return id;
  }
  function touch(node, from) {
    const rect = node.getBoundingClientRect();
    const origin = from ?? node;
    const start = origin.getBoundingClientRect();
    const at = (target, bounds) =>
      new Touch({
        identifier: 1,
        target,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      });
    const point = at(node, rect),
      first = at(origin, start);
    // Seat mirrors are laid out outside the visible desktop. Native move UI
    // still validates filterMove, but browser hit testing cannot see that frame.
    // Resolve only this synchronous gesture to the already validated DOM node.
    const hitTest = document.elementFromPoint;
    document.elementFromPoint = () => node;
    try {
      if (!lib.config.touchscreen) {
        const options = {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: point.clientX,
          clientY: point.clientY,
        };
        origin.dispatchEvent(
          new MouseEvent('mousedown', {
            ...options,
            clientX: first.clientX,
            clientY: first.clientY,
          }),
        );
        if (from) node.dispatchEvent(new MouseEvent('mousemove', options));
        node.dispatchEvent(new MouseEvent('mouseup', options));
      } else {
        origin.dispatchEvent(
          new TouchEvent('touchstart', {
            bubbles: true,
            touches: [first],
            targetTouches: [first],
            changedTouches: [first],
          }),
        );
        if (from)
          node.dispatchEvent(
            new TouchEvent('touchmove', {
              bubbles: true,
              touches: [point],
              targetTouches: [point],
              changedTouches: [point],
            }),
          );
        node.dispatchEvent(
          new TouchEvent('touchend', {
            bubbles: true,
            touches: [],
            targetTouches: [],
            changedTouches: [point],
          }),
        );
      }
    } finally {
      document.elementFromPoint = hitTest;
    }
  }
  const portrait = (name) =>
    setup.mobilePortraits?.[name] ??
    (/^[\w-]+$/.test(name ?? '') ? `${setup.assetBase}image/character/${name}.jpg` : '');
  function card(node, interactive = false, button = false) {
    const link = button ? node.link : node;
    const actual = Array.isArray(link) ? { name: link[2], nature: link[3] } : link;
    const known =
      actual &&
      typeof actual === 'object' &&
      actual.name &&
      actual.name !== 'party_unknown' &&
      !node.classList.contains('blank') &&
      !node.classList.contains('infohidden');
    const moving =
      button && _status.event?.name === 'chooseToMove_new' && node.closest('.item-container');
    const moveEnabled = () => moving && visible(node) && !_status.event?.dialog?.isBusy;
    const enabled =
      interactive &&
      !node.classList.contains('noclick') &&
      (moveEnabled() ||
        actionable(node) ||
        (button &&
          visible(node) &&
          !disabled(node) &&
          typeof _status.event?.custom?.replace?.button === 'function'));
    const name = known ? actual.name : '';
    const nature =
      name === 'sha'
        ? String(actual.nature ?? '')
            .split('|')
            .map((value) => ({ fire: '火', thunder: '雷', ice: '冰' })[value] ?? '')
            .join('')
        : '';
    const picture =
      known && /^[\w-]+$/.test(name) ? `${setup.assetBase}image/card/${name}.png` : '';
    return {
      key: key(node),
      action: action(
        node,
        enabled,
        () => {
          if (moving) return node.click();
          const from =
            _status.event?.name?.startsWith('chooseToMove') && ui.selected.guanxing_buttons?.[0];
          if (from && from !== node) touch(node, from);
          else (button ? ui.click.button : ui.click.card).call(node);
        },
        () =>
          moveEnabled() ||
          actionable(node) ||
          (button &&
            visible(node) &&
            !disabled(node) &&
            typeof _status.event?.custom?.replace?.button === 'function'),
      ),
      kind: 'card',
      label: known ? nature + plain(get.translation(name)) : '暗牌',
      detail: known ? plain(get.translation(`${name}_info`)) : '',
      image: picture,
      suit: known ? ({ heart: '♥', diamond: '♦', spade: '♠', club: '♣' }[actual.suit] ?? '') : '',
      number: known
        ? String({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[actual.number] ?? actual.number ?? '')
        : '',
      enabled,
      selected: selected(node),
    };
  }
  function button(node) {
    if (node.classList.contains('card')) return card(node, true, true);
    const isGeneral = node.classList.contains('character');
    const custom = typeof _status.event?.custom?.replace?.button === 'function';
    const enabled =
      visible(node) &&
      !disabled(node) &&
      !node.classList.contains('noclick') &&
      (actionable(node) || custom);
    const name = typeof node.link === 'string' ? node.link : '';
    return {
      key: key(node),
      action: action(
        node,
        enabled,
        () => ui.click.button.call(node),
        () => actionable(node) || (custom && visible(node) && !disabled(node)),
      ),
      kind: isGeneral ? 'general' : 'text',
      label: isGeneral ? plain(get.translation(name)) : node.textContent.trim(),
      detail: isGeneral
        ? (lib.character[name]?.skills ?? [])
            .map(
              (skill) =>
                `${plain(get.translation(skill))}：${plain(get.translation(`${skill}_info`))}`,
            )
            .join('\n')
        : '',
      image: isGeneral ? portrait(name) : '',
      suit: '',
      number: '',
      enabled,
      selected: selected(node),
    };
  }
  function control(node) {
    const enabled = visible(node) && !disabled(node);
    const link = typeof node.link === 'string' ? node.link : '';
    return {
      key: key(node),
      action: action(node, enabled, () => ui.click.control.call(node)),
      kind: 'control',
      label:
        link === 'ok'
          ? _status.event?.name === 'chooseToUse'
            ? '使用'
            : '确定'
          : link === 'cancel'
            ? _status.event?.name === 'chooseToUse' &&
              !ui.selected.cards.length &&
              !ui.selected.targets.length
              ? '结束出牌'
              : _status.event?.name === 'chooseBool'
                ? '不发动'
                : '取消'
            : node.textContent.trim(),
      detail: plain(get.translation(`${link}_info`)),
      image: '',
      suit: '',
      number: '',
      enabled,
      selected: false,
    };
  }
  const over = game.over;
  game.over = function (value, ...args) {
    result = value === true ? '你赢了' : value === false ? '本局失利' : '本局已结束';
    const returned = over.call(this, value, ...args);
    schedule();
    return returned;
  };
  function snapshot() {
    if (previousEvent !== _status.event) {
      previousEvent = _status.event;
      choice++;
    }
    actions = new Map();
    const choosing = Boolean(_status.paused && _status.event?.isMine?.() && !_status.over);
    const skillNodes = [ui.skills, ui.skills2, ui.skills3].filter(visible);
    const players = [...game.players, ...game.dead].map((player) => ({
      id: player.playerid,
      nickname: player.node.nameol?.textContent || player.nickname || '',
      general: player.isUnseen?.() ? '未亮将' : plain(get.translation(player.name)),
      image: player.isUnseen?.() ? '' : portrait(player.name),
      identity: player.node.identity?.textContent?.trim() || '身份未公开',
      hp: player.hp,
      maxHp: player.maxHp,
      armor: player.hujia,
      handCount: player.countCards('h'),
      dead: Boolean(player.isDead()),
      linked: Boolean(player.isLinked()),
      turned: Boolean(player.isTurnedOver()),
      current: _status.currentPhase === player,
      selected: selected(player),
      action: action(
        player,
        choosing && actionable(player),
        () => ui.click.target.call(player),
        () => actionable(player),
      ),
      equipment: player.getCards('e').map((node) => card(node, choosing && player === game.me)),
      judgments: player.getCards('j').map((node) => card(node)),
      // Native visible mark labels only; never call mark intros on private storage.
      marks: [...(player.node.marks?.children ?? [])]
        .map((node) => ({ label: node.textContent.trim(), detail: '' }))
        .filter((mark) => mark.label),
      // Only the disclosed general's static skills, never another seat's
      // runtime skill/storage list (which may include private transformations).
      abilities: player.isUnseen?.()
        ? []
        : (lib.character[player.name]?.skills ?? []).map((skill) => ({
            label: plain(get.translation(skill)),
            detail: plain(get.translation(`${skill}_info`)).slice(0, 2000),
          })),
    }));
    const dialogs = [...document.querySelectorAll('.dialog')].filter(visible).map((dialog) => {
      const modernMove =
        _status.event?.name === 'chooseToMove_new' && _status.event.dialog === dialog;
      const zones = modernMove
        ? [...(dialog.itemContainers ?? [])].filter((_, index) => index > 0 && index % 2 === 0)
        : [...dialog.querySelectorAll('.buttons.guanxing')];
      const pools = [...dialog.querySelectorAll('.buttons')].filter(
        (node) => !zones.includes(node) && node.querySelector('.button.card'),
      );
      const groups = pools.length >= 2 ? pools : [];
      const groupLabels = new Set(groups.map((node) => node.previousElementSibling));
      const text = [...dialog.querySelectorAll('.caption, .text')]
        .filter((node) => !node.closest('.button') && !groupLabels.has(node))
        .map((node) => node.textContent.trim())
        .filter(Boolean)
        .join('\n');
      return {
        key: key(dialog),
        text,
        items: [...dialog.querySelectorAll('.button')]
          // Keep a flattened fallback for an already-running v0.6.0 Node
          // sanitizer, which knows items but not the new optional groups.
          .filter((node) => !zones.some((zone) => zone.contains(node)))
          .map(button),
        groups: groups.map((group) => ({
          label: group.previousElementSibling?.textContent?.trim() || '牌区',
          items: [...group.querySelectorAll('.button')].map(button),
        })),
        zones: zones.map((zone) => ({
          label: zone.previousElementSibling?.textContent?.trim() || '牌区',
          action: action(
            zone,
            choosing,
            () => (modernMove ? zone.click() : touch(zone)),
            () => visible(zone) && (!modernMove || !_status.event?.dialog?.isBusy),
          ),
          items: [...zone.querySelectorAll('.button')].map((node) => card(node, choosing, true)),
        })),
      };
    });
    const controls = [...(ui.control?.children ?? [])]
      .filter((node) => visible(node) && !skillNodes.includes(node))
      .flatMap((node) => [...node.children].map(control));
    const name = game.me?.name;
    const ownSkills = game.me?.getSkills?.(null, false, false) ?? lib.character[name]?.skills ?? [];
    const abilities = ownSkills
      .filter((skill) => lib.translate[`${skill}_info`])
      .map((skill) => ({
        label: plain(get.translation(skill)),
        detail: plain(get.translation(`${skill}_info`)),
      }));
    const autoAction = action(
      ui.auto ?? document.body,
      !_status.over && Boolean(game.me?.name),
      () => ui.click.auto('forced'),
      () => !_status.over && Boolean(game.me?.name),
    );
    return {
      epoch,
      choice,
      playerId: setup.playerId,
      round: game.roundNumber || 0,
      phase: _status.event?.name ?? '',
      prompt: dialogs.map((dialog) => dialog.text).join('\n'),
      choosing,
      auto: Boolean(_status.auto),
      over: Boolean(_status.over),
      result,
      players,
      hand: game.me?.getCards('hs')?.map((node) => card(node, choosing)) ?? [],
      controls,
      skills: skillNodes.flatMap((node) => [...node.children].map(control)),
      dialogs,
      played: [...(ui.thrown ?? [])]
        .filter(visible)
        .slice(-6)
        .map((node) => card(node)),
      abilities,
      autoAction,
      events: events.slice(),
    };
  }
  function publish() {
    timer = undefined;
    if (game.ws?.readyState !== WebSocket.OPEN) return;
    const state = snapshot();
    // Keep native socket and phone queue limits. Large general pools retain all
    // choices and their labels; trim explanations before dropping any choice.
    const allItems = [
      ...state.hand,
      ...state.controls,
      ...state.skills,
      ...state.played,
      ...state.players.flatMap((player) => [...player.equipment, ...player.judgments]),
      ...state.dialogs.flatMap((dialog) => [
        ...dialog.items,
        ...dialog.groups.flatMap((group) => group.items),
        ...dialog.zones.flatMap((zone) => zone.items),
      ]),
    ];
    for (const item of allItems) item.detail = item.detail.slice(0, 2000);
    for (const dialog of state.dialogs) dialog.text = dialog.text.slice(0, 5000);
    state.prompt = state.prompt.slice(0, 4000);
    let encoded = JSON.stringify(state);
    if (new TextEncoder().encode(encoded).length > 110000) {
      for (const item of allItems) item.detail = '';
      for (const player of state.players)
        for (const ability of player.abilities) ability.detail = '';
      encoded = JSON.stringify(state);
    }
    while (state.events.length && new TextEncoder().encode(encoded).length > 125000) {
      // Transient effects yield to legal choices and the authoritative state.
      state.events.shift();
      encoded = JSON.stringify(state);
    }
    if (new TextEncoder().encode(encoded).length > 125000) {
      // A custom UI outside the declared model must fail visibly, never silently
      // close a native socket and let offline AI decide without phone feedback.
      parent.postMessage({ type: 'party-view-failed', matchId: setup.id }, location.origin);
      return;
    }
    if (encoded === previous) return;
    previous = encoded;
    game.ws.send(
      JSON.stringify(['tableView', { ...state, presentedAt: Date.now(), revision: ++revision }]),
    );
  }
  function schedule() {
    if (!timer) timer = setTimeout(publish, 35);
  }
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
  });
  const interval = setInterval(schedule, 500);
  const nativeMessage = game.ws.onmessage;
  game.ws.onmessage = function (event) {
    const { data } = event;
    let packet;
    try {
      packet = JSON.parse(data);
    } catch {
      return;
    }
    if (packet.type !== 'tableAction') return nativeMessage.call(this, event);
    // Refresh validity against the current native event and DOM, not just the
    // last phone snapshot. A duplicate confirm cannot act on the next choice.
    snapshot();
    const entry = actions.get(packet.action);
    if (packet.epoch !== epoch || packet.choice !== choice || !entry?.validate()) {
      previous = '';
      schedule();
      return;
    }
    actions.delete(packet.action);
    _status.clicked = false;
    entry.run();
    _status.clicked = false;
    previous = '';
    schedule();
  };
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(interval);
      clearTimeout(timer);
    },
    { once: true },
  );
  schedule();
}
