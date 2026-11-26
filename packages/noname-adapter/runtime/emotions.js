// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get, _status } from 'noname';

const names = { flower: '鲜花', egg: '鸡蛋', wine: '美酒', shoe: '草鞋' };
const assets = [...Object.keys(names), 'egg-splat', 'basket'];
const assetUrl = (name) => `/engine/runtime/assets/props/prop-${name}.webp`;
const interval = 90;
const playerName = (player) => player.nickname || get.translation(player.name);
const enabled = () => document.documentElement.dataset.tableEmotions !== 'off';
const reducedMotion = () => document.documentElement.dataset.motion === 'reduced';
const validEmotion = (name) => Object.prototype.hasOwnProperty.call(names, name);
const animate = (node, frames, options) => Element.prototype.animate?.call(node, frames, options);
const scatter = (radius) => (Math.random() * 2 - 1) * radius;

const trajectories = {
  flower: { duration: 480, rise: 78, spin: 215 },
  egg: { duration: 440, rise: 98, spin: 310 },
  wine: { duration: 460, rise: 44, spin: 48 },
  shoe: { duration: 330, rise: 48, spin: -540 },
};
const maxNodes = 72;
const maxDecorations = 48;
const animationWatchdog = 5000;
const spriteSize = 68;

function prop(name) {
  const image = new Image(128, 128);
  image.alt = '';
  image.decoding = 'async';
  image.src = assetUrl(name);
  return image;
}

export function installEmotions() {
  const setup = globalThis.partyEngine.setup;
  if (setup.role === 'worker') {
    lib.element.Player.prototype.$throwEmotion = function (target, name) {
      if (validEmotion(name)) globalThis.partyEngine.observeGift?.(this, target);
    };
    const last = new WeakMap();
    lib.message.server.throwEmotion = function (target, name) {
      const player = lib.playerOL[this.id];
      if (
        !player ||
        player.ws !== this ||
        ![...game.players, ...game.dead].includes(target) ||
        target === player ||
        !validEmotion(name) ||
        Date.now() - (last.get(player) ?? 0) < interval
      )
        return;
      last.set(player, Date.now());
      player.throwEmotion(target, name);
    };
    return;
  }

  const images = new Map();
  function prepare(name) {
    if (images.has(name)) return images.get(name);
    const image = prop(name);
    const decoded = image.decode().then(
      () => image,
      () => {
        images.delete(name);
      },
    );
    images.set(name, decoded);
    return decoded;
  }
  let warmed = false;
  function warm() {
    if (warmed) return;
    warmed = true;
    const preload = () => {
      if (document.hidden || !enabled()) {
        warmed = false;
        return;
      }
      for (const name of assets) void prepare(name);
    };
    if (window.requestIdleCallback) window.requestIdleCallback(preload, { timeout: 1000 });
    else setTimeout(preload, 400);
  }

  const nodes = new Map();
  const sounds = new Map();
  const decorations = new Set();
  const shakes = new Map();
  const streaks = new Map();
  let notice;
  let menuTarget;
  let menu;
  let menuStatus;
  let sentAt = -Infinity;
  let cooling;
  const remove = (node) => {
    clearTimeout(nodes.get(node));
    nodes.delete(node);
    decorations.delete(node);
    for (const animation of node.getAnimations?.() ?? []) animation.cancel();
    node.remove();
  };
  function expire(node, duration) {
    clearTimeout(nodes.get(node));
    nodes.set(
      node,
      setTimeout(() => remove(node), duration),
    );
  }
  function show(node, x, y, duration, decorative = false) {
    if (decorative && decorations.size >= maxDecorations) remove(decorations.values().next().value);
    while (nodes.size >= maxNodes) {
      remove(decorations.values().next().value ?? nodes.keys().next().value);
    }
    if (decorative) decorations.add(node);
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    ui.window.append(node);
    expire(node, duration);
  }
  function closeMenu() {
    if (menu) menu.hidden = true;
    menuTarget = undefined;
    clearTimeout(cooling);
    if (menuStatus) menuStatus.textContent = '';
  }
  function clearShakes() {
    for (const animation of shakes.values()) animation.cancel();
    shakes.clear();
  }
  function clear() {
    closeMenu();
    for (const node of nodes.keys()) remove(node);
    for (const [sound, timer] of sounds) {
      clearTimeout(timer);
      sound.pause();
    }
    sounds.clear();
    clearShakes();
    streaks.clear();
    notice = undefined;
  }
  function targetSelection() {
    const event = _status.event;
    return (
      Boolean(_status.imchoosing && event?.name === 'chooseTarget' && event.isMine?.()) ||
      Boolean(ui.arena?.querySelector('.player:is(.selectable, .selected)'))
    );
  }
  function blocked(target) {
    return (
      !enabled() ||
      !target?.isConnected ||
      target.matches('.disabled, [aria-disabled="true"]') ||
      targetSelection()
    );
  }
  function send(target, name, status) {
    if (blocked(target) || !lib.configOL?.gameStarted || target === game.me) return;
    if (Date.now() - sentAt < interval) {
      if (status) {
        status.textContent = '稍候再送';
        clearTimeout(cooling);
        cooling = setTimeout(() => (status.textContent = ''), 500);
      }
      return;
    }
    sentAt = Date.now();
    if (game.online) game.send('throwEmotion', target, name);
    else game.me.throwEmotion(target, name);
  }
  function stopGesture(event) {
    event.stopPropagation();
  }
  function stopGameGestures(button) {
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'touchend', 'contextmenu'])
      button.addEventListener(type, stopGesture);
  }
  function giftButton(name, target, status) {
    const button = document.createElement('button');
    button.className = 'party-emotion-choice';
    button.dataset.emotion = name;
    button.type = 'button';
    button.append(prop(name), names[name]);
    stopGameGestures(button);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      send(target(), name, status);
    });
    return button;
  }
  function viewport() {
    const base = ui.window.getBoundingClientRect();
    return {
      base,
      scaleX: base.width / ui.window.offsetWidth || 1,
      scaleY: base.height / ui.window.offsetHeight || 1,
    };
  }
  function point(node, space = viewport()) {
    // Use one coordinate system for native zoom, portrait anchors and sprites.
    const bounds = node.getBoundingClientRect();
    const { base, scaleX, scaleY } = space;
    return {
      x: (bounds.left - base.left + bounds.width / 2) / scaleX,
      y: (bounds.top - base.top + bounds.height / 2) / scaleY,
      bottom: (bounds.bottom - base.top) / scaleY,
      top: (bounds.top - base.top) / scaleY,
      left: (bounds.left - base.left) / scaleX,
      right: (bounds.right - base.left) / scaleX,
    };
  }
  function visibleAvatar(player) {
    const avatar = player.node?.avatar;
    const bounds = avatar?.getBoundingClientRect();
    return bounds?.width && bounds.height && avatar.checkVisibility?.() !== false ? avatar : null;
  }
  function seatPoint(player, space) {
    const avatar = visibleAvatar(player);
    const anchor = point(avatar ?? player, space);
    // The shake is presentation-only. It must not move the next projectile's anchor.
    if (avatar && shakes.has(avatar)) {
      const translation = parseFloat(getComputedStyle(avatar).translate);
      if (Number.isFinite(translation)) anchor.x -= translation;
    }
    return anchor;
  }
  function positionMenu(target) {
    const { x, top, bottom } = point(target);
    const { offsetWidth: width, offsetHeight: height } = ui.window;
    const { offsetWidth: w, offsetHeight: h } = menu;
    menu.style.left = `${Math.max(6, Math.min(x - w / 2, width - w - 6))}px`;
    menu.style.top = `${bottom + h + 10 < height ? bottom + 4 : Math.max(6, top - h - 4)}px`;
  }
  function openMenu(target) {
    if (blocked(target)) return;
    if (menuTarget === target) {
      closeMenu();
      return;
    }
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'party-basket-menu';
      menu.setAttribute('role', 'group');
      menu.setAttribute('aria-label', '菜篮子');
      const title = document.createElement('strong');
      title.className = 'party-basket-title';
      title.textContent = '菜篮子';
      const choices = document.createElement('div');
      choices.className = 'party-basket-items';
      menuStatus = document.createElement('span');
      menuStatus.className = 'party-basket-cooldown';
      menuStatus.setAttribute('role', 'status');
      for (const name of Object.keys(names))
        choices.append(giftButton(name, () => menuTarget, menuStatus));
      menu.append(title, choices, menuStatus);
      ui.window.append(menu);
    }
    closeMenu();
    menuTarget = target;
    menu.hidden = false;
    positionMenu(target);
  }

  const baskets = new Map();
  let refreshFrame;
  function syncSeats() {
    refreshFrame = undefined;
    bindSeats();
    if (!ui.window || !lib.configOL?.gameStarted || !game.me?.name) return;
    if (enabled()) warm();
    if (setup.tableView) return;
    syncTarget();
    const seats = new Set([...game.players, ...game.dead].filter((p) => p !== game.me && p.name));
    for (const [player, basket] of baskets) {
      if (seats.has(player) && basket.isConnected) continue;
      basket.remove();
      baskets.delete(player);
    }
    if (!enabled()) return;
    for (const target of seats) {
      if (baskets.has(target)) continue;
      const basket = document.createElement('button');
      basket.className = 'party-basket';
      basket.type = 'button';
      basket.setAttribute('aria-label', `向${playerName(target)}打开菜篮子`);
      basket.append(prop('basket'));
      stopGameGestures(basket);
      basket.addEventListener('click', (event) => {
        event.stopPropagation();
        openMenu(target);
      });
      target.append(basket);
      baskets.set(target, basket);
    }
  }
  function schedule() {
    if (refreshFrame === undefined && !document.hidden)
      refreshFrame = requestAnimationFrame(syncSeats);
  }
  function syncTarget() {
    if (!ui.window || setup.tableView) return;
    const selecting = targetSelection();
    ui.window.classList.toggle('party-choosing-target', selecting);
    if (
      menuTarget &&
      (selecting ||
        !enabled() ||
        !menuTarget.isConnected ||
        menuTarget.matches('.disabled, [aria-disabled="true"]'))
    )
      closeMenu();
  }
  // Arena children and the players themselves are the only seat inputs.
  // Hand cards, clock ticks, avatar descendants and our own particles cannot
  // invalidate seats or the target-selection state.
  let arena;
  let observedSeats = [];
  const seatObserver = new MutationObserver(syncTarget);
  const seatTree = new MutationObserver((changes) => {
    if (
      changes.some(({ addedNodes, removedNodes }) =>
        [...addedNodes, ...removedNodes].some((node) => node.matches?.('.player')),
      )
    )
      schedule();
  });
  function bindSeats() {
    const next = setup.tableView ? [] : [...game.players, ...game.dead];
    if (
      arena !== ui.arena ||
      next.length !== observedSeats.length ||
      next.some((player, index) => player !== observedSeats[index])
    ) {
      arena = ui.arena;
      observedSeats = next;
      seatTree.disconnect();
      seatObserver.disconnect();
      if (arena && !setup.tableView) seatTree.observe(arena, { childList: true });
      for (const player of next) {
        seatObserver.observe(player, {
          attributes: true,
          attributeFilter: ['class', 'aria-disabled'],
        });
      }
    }
  }
  const lifecycle = new MutationObserver((changes) => {
    if (
      arena !== ui.arena ||
      !lib.configOL?.gameStarted ||
      changes.some(({ addedNodes, removedNodes }) =>
        [...addedNodes, ...removedNodes].some(
          (node) =>
            node.matches?.('.player, #arena, #window') ||
            (node.matches?.('.avatar, .name, .identity') && node.parentElement?.matches('.player')),
        ),
      )
    )
      schedule();
  });
  lifecycle.observe(document.body, { childList: true, subtree: true });
  // Filters on chooseToUse also exist when the hand is completely unselected.
  // Native checks are useful as a signal, not as evidence of a target picker.
  const onCheck = () => {
    syncTarget();
    if (
      arena !== ui.arena ||
      (!setup.tableView && !baskets.size) ||
      observedSeats.length !== (setup.tableView ? 0 : game.players.length + game.dead.length)
    )
      schedule();
  };
  lib.hooks.checkEnd.push(onCheck);
  lib.hooks.uncheckEnd.push(onCheck);
  const preferences = new MutationObserver(() => {
    if (!enabled()) clear();
    else if (reducedMotion()) {
      for (const node of decorations) remove(node);
      clearShakes();
    }
    schedule();
  });
  preferences.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-table-emotions', 'data-motion'],
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear();
    else schedule();
  });
  window.addEventListener('resize', closeMenu);
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (menuTarget && !event.target.closest?.('.party-basket, .party-basket-menu')) closeMenu();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !menuTarget) return;
      const basket = baskets.get(menuTarget);
      closeMenu();
      basket?.focus();
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );
  window.addEventListener(
    'pagehide',
    () => {
      clear();
      lifecycle.disconnect();
      seatTree.disconnect();
      seatObserver.disconnect();
      lib.hooks.checkEnd.splice(lib.hooks.checkEnd.indexOf(onCheck), 1);
      lib.hooks.uncheckEnd.splice(lib.hooks.uncheckEnd.indexOf(onCheck), 1);
      preferences.disconnect();
      cancelAnimationFrame(refreshFrame);
    },
    { once: true },
  );
  schedule();

  if (!setup.tableView) {
    const intro = ui.click.intro;
    ui.click.intro = function (...args) {
      // The native intro also scans optional skin directories. Portraits here
      // use the project's fixed catalog.
      const changeSkin = lib.config.change_skin;
      const skins = lib.skin;
      let dialog;
      try {
        lib.config.change_skin = false;
        lib.skin = undefined;
        dialog = intro.apply(this, args);
      } finally {
        lib.config.change_skin = changeSkin;
        lib.skin = skins;
      }
      const target = this.closest?.('.player');
      if (target && dialog) {
        for (const button of ui.throwEmotion ?? []) {
          if (dialog.contains(button) && validEmotion(button.link)) {
            const replacement = giftButton(button.link, () => target);
            replacement.classList.add('menubutton');
            button.replaceWith(replacement);
          }
        }
      }
      return dialog;
    };
  }

  function drawProp(node, name) {
    node.dataset.prop = name;
    const fallback = document.createElement('span');
    fallback.className = 'party-emotion-fallback';
    fallback.textContent = names[name]?.[0] ?? '蛋';
    node.replaceChildren(fallback);
    void prepare(name).then((image) => {
      if (image && nodes.has(node) && node.dataset.prop === name)
        node.replaceChildren(image.cloneNode());
    });
  }
  function spark(kind, x, y, frames, duration, delay = 0) {
    const node = document.createElement('span');
    node.className = 'party-emotion-particle';
    node.dataset.effect = kind;
    node.setAttribute('aria-hidden', 'true');
    show(node, x, y, duration + delay + 50, true);
    animate(node, frames, { duration, delay, fill: 'forwards' });
  }
  function burst(name, at) {
    if (name === 'flower' || name === 'wine') {
      spark(
        'halo',
        at.x,
        at.y,
        [
          { transform: 'translate(-50%, -50%) scale(.34)', opacity: 0.96 },
          { transform: 'translate(-50%, -50%) scale(1.15)', opacity: 0.66, offset: 0.36 },
          { transform: 'translate(-50%, -50%) scale(1.62)', opacity: 0 },
        ],
        520,
      );
    }
    const count = { egg: 6, flower: 8, shoe: 7, wine: 9 }[name];
    const start = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const angle = start + (i * 2 * Math.PI) / count;
      const x =
        name === 'wine' ? 14 + Math.random() * 44 : Math.cos(angle) * (30 + Math.random() * 20);
      const y = Math.sin(angle) * 27 - 17;
      const kind = {
        egg: i % 2 ? 'shell' : 'foam',
        flower: 'petal',
        shoe: i % 2 ? 'dust' : 'star',
        wine: 'drop',
      }[name];
      spark(
        kind,
        at.x,
        at.y,
        [
          { transform: 'scale(.35)', opacity: 1 },
          {
            transform: `translate(${x}px,${y}px) rotate(75deg) scale(1.12)`,
            opacity: 1,
            offset: 0.34,
            easing: 'ease-in',
          },
          {
            transform: `translate(${x * 1.48}px,${y + 39}px) rotate(155deg) scale(.35)`,
            opacity: 0,
          },
        ],
        (name === 'flower' ? 640 : 430) + Math.random() * 100,
        name === 'wine' ? 50 + i * 9 : 0,
      );
    }
  }
  function shake(target, amount) {
    const avatar = visibleAvatar(target);
    if (!avatar) return;
    shakes.get(avatar)?.cancel();
    // Individual translate leaves the seat, its click handlers and badges in place.
    const animation = animate(
      avatar,
      [0, -amount, amount, -amount * 0.45, 0].map((x) => ({ translate: `${x}px 0px` })),
      { duration: 160 },
    );
    if (!animation) return;
    shakes.set(avatar, animation);
    const done = () => {
      if (shakes.get(avatar) === animation) shakes.delete(avatar);
    };
    void animation.finished.then(done, done);
  }
  function impact(node, name, at, target, compact) {
    const duration = impactDuration(name, compact);
    node.dataset.phase = 'impact';
    if (name === 'egg') drawProp(node, 'egg-splat');
    const frames = {
      egg: [
        { transform: 'translateY(0) scale(1.20)', opacity: 1, easing: 'ease-in' },
        { transform: 'translateY(4px) scale(1.13)', opacity: 1, offset: 0.33, easing: 'ease-in' },
        { transform: 'translateY(28px) scale(1.02)', opacity: 0 },
      ],
      flower: [
        { transform: 'scale(.75)', opacity: 1, easing: 'ease-out' },
        { transform: 'scale(1.48)', opacity: 1, offset: 0.25 },
        { transform: 'scale(1.18)', opacity: 1, offset: 0.63 },
        { transform: 'scale(1.18)', opacity: 0 },
      ],
      wine: [
        { transform: 'rotate(0deg) scale(1.02)', opacity: 1 },
        { transform: 'rotate(55deg) scale(1.14)', opacity: 1, offset: 0.28 },
        { transform: 'rotate(55deg) scale(.96)', opacity: 0 },
      ],
      shoe: [
        { transform: 'translateX(-5px) rotate(-19deg) scale(1.18)', opacity: 1 },
        { transform: 'translateX(6px) rotate(8deg) scale(1.02)', opacity: 1, offset: 0.24 },
        { transform: 'translateX(0) scale(.78)', opacity: 0 },
      ],
    };
    const animation = animate(
      node,
      compact
        ? [
            { transform: 'scale(1.06)', opacity: 1 },
            { transform: 'scale(1)', opacity: 0 },
          ]
        : frames[name],
      { duration, fill: 'forwards' },
    );
    // A delayed render must not spend the hit's time budget before it lands.
    // Normal removal follows the compositor; the timer is just a watchdog.
    expire(node, animation ? animationWatchdog : duration + 70);
    if (animation)
      void animation.finished.then(
        () => remove(node),
        () => {},
      );
    if (compact) return;
    if (name === 'egg' || name === 'shoe') shake(target, name === 'egg' ? 4 : 7);
    burst(name, at);
  }
  const impactDuration = (name, compact) =>
    compact ? 260 : { egg: 900, flower: 520, wine: 510, shoe: 360 }[name];

  function fly(node, name, from, to, target, halfWidth, halfHeight, compact) {
    const { duration, rise, spin } = trajectories[name];
    const travel = compact ? Math.round(duration * 0.69) : duration;
    const landing = { x: to.x + scatter(compact ? 4 : 12), y: to.y + scatter(compact ? 4 : 12) };
    const dx = landing.x - from.x;
    const dy = landing.y - from.y;
    const lift = Math.max(
      0,
      Math.min(
        (compact ? rise * 0.45 : rise) + scatter(compact ? 4 : 16),
        (from.y + landing.y) / 2 - halfHeight,
      ),
    );
    // Quadratic B?zier with a lifted control point: horizontal travel is
    // linear, vertical velocity accelerates into the landing.
    const position = (t) => ({ x: dx * t, y: dy * t - 4 * lift * t * (1 - t) });
    const transform = (t) => {
      const { x, y } = position(t);
      const scale =
        t <= 0.5
          ? 0.68 + (compact ? 0.36 : 0.54) * Math.sin(t * Math.PI)
          : 1.02 + (compact ? 0.02 : 0.2) * Math.sin(t * Math.PI);
      const rotation = compact ? 0 : spin * t;
      return `translate(${x}px,${y}px) rotate(${rotation}deg) scale(${scale})`;
    };
    const finish = () => {
      if (!nodes.has(node)) return;
      node.style.left = `${landing.x - halfWidth}px`;
      node.style.top = `${landing.y - halfHeight}px`;
      node.style.transform = 'none';
      impact(node, name, landing, target, compact || reducedMotion());
    };
    node.style.transform = transform(0);
    const animation = animate(
      node,
      Array.from({ length: 9 }, (_, index) => ({ transform: transform(index / 8) })),
      { duration: travel, fill: 'both' },
    );
    if (animation) {
      void animation.finished.then(
        () => {
          animation.cancel();
          finish();
        },
        () => {},
      );
    } else {
      const began = performance.now();
      function tick(now) {
        if (!nodes.has(node)) return;
        const t = Math.max(0, Math.min(1, (now - began) / travel));
        if (t === 1) finish();
        else {
          node.style.transform = transform(t);
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
    }
    if (compact) return;
    if (name === 'flower') {
      for (const ms of [75, 165, 255, 345, 435]) {
        const { x, y } = position(ms / travel);
        spark(
          'trail-petal',
          from.x + x,
          from.y + y,
          [
            { opacity: 0.98, transform: 'rotate(-25deg) scale(.82)' },
            {
              opacity: 0.83,
              transform: `translate(${scatter(12)}px,8px) rotate(44deg)`,
              offset: 0.32,
            },
            {
              opacity: 0,
              transform: `translate(${scatter(16) - Math.sign(dx) * 12}px,32px) rotate(155deg) scale(.45)`,
            },
          ],
          490,
          ms,
        );
      }
    } else if (name === 'shoe') {
      for (const ms of [64, 129]) {
        const t = ms / travel;
        const { x, y } = position(t);
        const angle = (Math.atan2(dy - 4 * lift * (1 - 2 * t), dx) * 180) / Math.PI;
        spark(
          'wind',
          from.x + x,
          from.y + y,
          [
            { opacity: 0.9, transform: `translate(-50%,-50%) rotate(${angle}deg) scaleX(1)` },
            { opacity: 0, transform: `translate(-50%,-50%) rotate(${angle}deg) scaleX(.45)` },
          ],
          215,
          ms,
        );
      }
    }
  }
  lib.element.Player.prototype.$throwEmotion = function (target, name) {
    if (
      !validEmotion(name) ||
      !target ||
      !ui.window ||
      !enabled() ||
      document.hidden ||
      globalThis.partyEngine.deliveryAge > 3000
    )
      return;
    const compact = reducedMotion();
    const space = viewport();
    const from = seatPoint(this, space);
    const to = seatPoint(target, space);
    const previous = streaks.get(target);
    const count =
      previous?.from === this && Date.now() - previous.at < 2500
        ? Math.min(99, previous.count + 1)
        : 1;
    if (previous?.badge) remove(previous.badge);
    const badge = count > 1 ? document.createElement('span') : undefined;
    if (badge) {
      badge.className = 'party-emotion-combo';
      if (count >= 5) badge.dataset.high = 'true';
      badge.textContent = `×${count}`;
      show(badge, 0, 0, 2500);
      const w = badge.offsetWidth;
      const h = badge.offsetHeight;
      const seat = point(target, space);
      const obstacles = [
        ...ui.window.querySelectorAll('.identity > div, .party-seat-status, .party-seat-number'),
      ]
        .filter(
          (node) =>
            node.offsetWidth &&
            node.offsetHeight &&
            (node.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true),
        )
        .map((mark) => point(mark, space));
      // Include the full pop envelope, and never fall back to a blocked corner.
      const clearance = Math.ceil(Math.max(w, h) * 0.16) + 4;
      const positions = [
        [to.x - w / 2, seat.top - h - clearance],
        [seat.left - w - clearance, to.y - h / 2],
        [seat.right + clearance, to.y - h / 2],
        [to.x - w / 2, seat.bottom + clearance],
        [to.x - w / 2, to.y - h / 2],
      ].map(([x, y]) => [
        Math.max(clearance, Math.min(x, ui.window.offsetWidth - w - clearance)),
        Math.max(clearance, Math.min(y, ui.window.offsetHeight - h - clearance)),
      ]);
      const spot = positions.find(([x, y]) =>
        obstacles.every(
          (mark) =>
            x + w + clearance <= mark.left ||
            x >= mark.right + clearance ||
            y + h + clearance <= mark.top ||
            y >= mark.bottom + clearance,
        ),
      );
      const [x, y] = spot ?? positions[0];
      if (!spot) badge.hidden = true;
      badge.style.left = `${x}px`;
      badge.style.top = `${y}px`;
      if (!compact && !badge.hidden)
        animate(
          badge,
          [
            { transform: 'scale(.68)', opacity: 0.7 },
            { transform: 'scale(1.31)', opacity: 1 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 250 },
        );
    }
    streaks.set(target, { from: this, count, at: Date.now(), badge });
    if (notice) remove(notice);
    notice = document.createElement('div');
    notice.className = 'party-emotion-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = `${playerName(this)} → ${playerName(target)}：${names[name]}${count > 1 ? ` ×${count}` : ''}`;
    notice.dataset.from = this.playerid;
    notice.dataset.to = target.playerid;
    notice.dataset.count = String(count);
    show(notice, 8, 8, 2500);

    const node = document.createElement('div');
    node.className = 'party-emotion';
    node.dataset.emotion = name;
    node.dataset.phase = 'flight';
    node.setAttribute('aria-hidden', 'true');
    const { scaleX, scaleY } = space;
    const halfWidth = spriteSize / (2 * scaleX);
    const halfHeight = spriteSize / (2 * scaleY);
    node.style.width = `${halfWidth * 2}px`;
    node.style.height = `${halfHeight * 2}px`;
    show(node, from.x - halfWidth, from.y - halfHeight, animationWatchdog);
    drawProp(node, name);
    fly(node, name, from, to, target, halfWidth, halfHeight, compact);
    if (lib.config.background_audio) {
      const sound = game.playAudio('effect', `throw_${name}${get.rand(1, 2)}`);
      if (sound) {
        clearTimeout(sounds.get(sound));
        sounds.set(
          sound,
          setTimeout(() => sounds.delete(sound), 2500),
        );
      }
    }
  };
}
