// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, get, ui, _status } from 'noname';
import { sharesHandWith } from './privacy.js';

const attachments = '.hp, .equips, .judges, .marks';
// The native #control wrapper spans the table even when empty. Its visible
// children are the actual action targets.
const inquiries =
  '.dialog, .dialog .content, .prompt, .control, #control > *, .popup-container, #party-wugu-preview';
const tableLabels = '.party-turn-badge, #party-table-count';
const geometryTransition =
  /^(transform|translate|scale|rotate|opacity|visibility|width|height|top|right|bottom|left|inset|margin|padding)(-|$)/;
const gap = 6;

function visibleRect(node) {
  if (!node?.isConnected) return;
  // Native nodes can fade in from opacity 0 while already intercepting clicks.
  if (getComputedStyle(node).visibility !== 'visible' || node.closest('[hidden], .hidden')) return;
  const rect = node.getBoundingClientRect();
  if (rect.width && rect.height) return rect;
}

function adjacentPlacement(seat, anchor, areas, widthLimit) {
  const leftEdge = 8,
    rightEdge = innerWidth - 8,
    topEdge = 8,
    bottomEdge = innerHeight - 8;
  const centerX = (seat.left + seat.right) / 2;
  const centerY = (seat.top + seat.bottom) / 2;
  const offsetX = centerX - innerWidth / 2;
  const inward = offsetX < 0 ? 'right' : 'left';
  const outward = inward === 'right' ? 'left' : 'right';
  const directions =
    Math.abs(offsetX) >= innerWidth / 5
      ? [inward, 'below', 'above', outward]
      : centerY < innerHeight / 2
        ? ['below', inward, outward, 'above']
        : ['above', inward, outward, 'below'];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  for (const side of directions) {
    const horizontal = side === 'right' || side === 'left';
    const edge = side === 'right' ? anchor.right + gap : anchor.left - gap;
    const maxWidth = Math.floor(
      Math.min(
        widthLimit,
        horizontal ? (side === 'right' ? rightEdge - edge : edge - leftEdge) : rightEdge - leftEdge,
      ),
    );
    const widths = [
      maxWidth,
      ...areas.map((area) =>
        Math.floor(side === 'right' ? area.left - gap - edge : edge - area.right - gap),
      ),
      200,
      146,
      108,
    ].sort((a, b) => b - a);
    for (const width of new Set(widths)) {
      if (width < 108 || width > maxWidth) continue;
      for (const height of [86, 74]) {
        const top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - height;
        const left = side === 'right' ? edge : edge - width;
        const min = horizontal
          ? Math.max(topEdge, seat.top + 12 - height)
          : Math.max(leftEdge, seat.left + 12 - width);
        const max = horizontal
          ? Math.min(bottomEdge - height, seat.bottom - 12)
          : Math.min(rightEdge - width, seat.right - 12);
        if (min > max) continue;
        const ideal = clamp(horizontal ? centerY - height / 2 : centerX - width / 2, min, max);
        const offsets = [
          ideal,
          ...areas.flatMap((area) =>
            horizontal
              ? [area.top - gap - height, area.bottom + gap]
              : [area.left - gap - width, area.right + gap],
          ),
        ].sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal));
        for (const offset of offsets) {
          if (offset < min || offset > max) continue;
          const x = horizontal ? left : offset;
          const y = horizontal ? offset : top;
          if (x < leftEdge || x + width > rightEdge || y < topEdge || y + height > bottomEdge)
            continue;
          if (
            areas.some(
              (area) =>
                x < area.right + gap &&
                x + width > area.left - gap &&
                y < area.bottom + gap &&
                y + height > area.top - gap,
            )
          )
            continue;
          return { x, y, width, height };
        }
      }
    }
  }
}

/** Client-only presentation. Only its expanded preference survives a reload. */
export function installFarmerHandView() {
  let cards = [],
    mateId = '',
    nickname = '',
    button,
    layer,
    tray,
    list,
    heading;
  let expanded = sessionStorage.getItem('party_farmer_hand_open') === '1';
  let disposed = false;
  let cardsDirty = false;
  let layoutFrame = 0;
  let appliedZoom;
  let touchScale = 1;
  let knownInquiries = [];
  const motions = new Map();
  const style = document.createElement('style');
  style.textContent = `
    .party-farmer-toggle{position:absolute;left:50%;bottom:-26px;transform:translateX(-50%);min-width:88px;max-width:168px;height:24px;padding:1px 9px;border:1px solid rgba(220,186,114,.72);border-radius:4px;background:rgba(12,30,30,.86);color:#f3e6c8;font:600 11.5px/20px system-ui;white-space:nowrap;cursor:pointer;z-index:8;box-shadow:0 3px 10px rgba(0,0,0,.35);backdrop-filter:blur(4px)}
    .party-farmer-toggle[aria-expanded=true]{background:linear-gradient(168deg,#1f7d72,#124a44);color:#fffaf0;border-color:#e8c97a}
    #party-farmer-layer{position:fixed;left:0;top:0;width:100px;height:100px;z-index:48;transform-origin:top left;pointer-events:none;overflow:visible;transition:none}
    #party-farmer-hand {
      position: absolute;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      padding: 4px 5px 5px;
      border: 1px solid #b09058;
      border-radius: 5px;
      background: linear-gradient(155deg, #24433eea, #0b2422f5 72%);
      color: #f4ead2;
      box-shadow: inset 0 0 0 2px #dbc18b24, 0 5px 14px #020c0aa6;
      backdrop-filter: blur(5px);
      font: 11px/1.2 system-ui, sans-serif;
      pointer-events: auto;
      transition: none;
    }
    #party-farmer-hand[hidden] { display: none; }
    #party-farmer-hand header {
      display: flex;
      flex: 0 0 17px;
      align-items: center;
      gap: 8px;
      margin: 0 0 3px;
      padding: 0;
    }
    #party-farmer-hand strong {
      flex: 1;
      min-width: 0;
      padding-inline: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #f3dda7;
      font-size: 11px;
      font-weight: 700;
    }
    #party-farmer-hand button {
      background: #122b27;
      border: 1px solid #b09058;
      border-radius: 2px;
      color: #f3e6c8;
      padding: 0 5px;
      font: 600 10.5px/14px system-ui, sans-serif;
      cursor: pointer;
    }
    .party-farmer-cards {
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex: 1 1 auto;
      gap: 4px;
      width: 100%;
      min-width: 0;
      min-height: 0;
      overflow: auto hidden;
      scrollbar-width: thin;
      scrollbar-color: #c8a46899 transparent;
      overscroll-behavior: contain;
      touch-action: none;
    }
    .party-farmer-card {
      box-sizing: border-box;
      position: relative;
      display: grid;
      grid-template-rows: 12px minmax(0, 1fr);
      flex: 0 0 43px;
      padding: 2px 2px 3px;
      border: 1px solid #b39765;
      border-radius: 3px;
      background: linear-gradient(145deg, #fff8e7, #eddbb6);
      color: #2c3029;
      box-shadow: inset 0 0 0 1px #fff9e4, inset 0 -2px #be965d66;
      pointer-events: none;
      text-shadow: none;
    }
    .party-farmer-card-top {
      color: #242b28;
      font: 700 11px/1 system-ui, sans-serif;
      letter-spacing: .015em;
      white-space: nowrap;
    }
    .party-farmer-card.is-red .party-farmer-card-top { color: #9b2c24; }
    .party-farmer-card-name {
      align-self: center;
      justify-self: center;
      text-align: center;
      font: 700 12px/1.08 'Songti SC', STSong, SimSun, 'Microsoft YaHei', serif;
      overflow-wrap: anywhere;
    }
    .party-farmer-card-name.is-four-character {
      max-width: 2.1em;
    }
  `;
  document.head.append(style);
  function stop(event) {
    event.stopPropagation();
  }
  function ensure() {
    const mate = lib.playerOL?.[mateId];
    if (!mate?.isConnected) return false;
    if (!button) {
      button = document.createElement('button');
      button.id = 'party-farmer-hand-toggle';
      button.type = 'button';
      button.className = 'party-farmer-toggle';
      button.setAttribute('aria-controls', 'party-farmer-hand');
      for (const event of ['click', 'mousedown', 'touchstart', 'touchend'])
        button.addEventListener(event, stop);
      button.addEventListener('click', () => {
        expanded = !expanded;
        sessionStorage.setItem('party_farmer_hand_open', expanded ? '1' : '0');
        if (!expanded) setPlacement();
        scheduleLayout();
      });
      tray = document.createElement('section');
      tray.id = 'party-farmer-hand';
      tray.hidden = true;
      tray.setAttribute('aria-label', '队友手牌，只读');
      const header = document.createElement('header');
      heading = document.createElement('strong');
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '收起';
      close.setAttribute('aria-label', '收起队友手牌');
      close.onclick = () => {
        expanded = false;
        sessionStorage.setItem('party_farmer_hand_open', '0');
        setPlacement();
        button.focus();
      };
      header.append(heading, close);
      list = document.createElement('div');
      list.className = 'party-farmer-cards';
      list.tabIndex = 0;
      list.setAttribute('aria-label', '队友牌列，可横向滚动');
      let swipe;
      list.addEventListener('touchstart', (event) => {
        const touch = event.touches[0];
        swipe =
          event.touches.length === 1
            ? { x: touch.clientX, scroll: list.scrollLeft, id: touch.identifier, scale: touchScale }
            : undefined;
      });
      list.addEventListener(
        'touchmove',
        (event) => {
          const touch = event.touches[0];
          if (!swipe || event.touches.length !== 1 || touch.identifier !== swipe.id) return;
          event.preventDefault();
          // CSS rotation belongs to the parent page. Touch coordinates received
          // here are already local to the iframe, including in forced landscape.
          list.scrollLeft = swipe.scroll + (swipe.x - touch.clientX) / swipe.scale;
        },
        { passive: false },
      );
      for (const event of ['touchend', 'touchcancel'])
        list.addEventListener(event, () => (swipe = undefined));
      tray.append(header, list);
      for (const event of [
        'click',
        'mousedown',
        'pointerdown',
        'pointerup',
        'touchstart',
        'touchmove',
        'touchend',
        'touchcancel',
        'wheel',
        'keydown',
      ])
        tray.addEventListener(event, stop);
      layer = document.createElement('div');
      layer.id = 'party-farmer-layer';
      layer.append(tray);
      document.body.append(layer);
    }
    const moved = button.parentNode !== mate;
    if (moved) mate.append(button);
    return { moved, mate };
  }
  function renderCards() {
    if (cardsDirty) {
      const contents = document.createDocumentFragment();
      for (const card of cards) {
        const item = document.createElement('span');
        item.className = `party-farmer-card${['heart', 'diamond'].includes(card.suit) ? ' is-red' : ''}`;
        const suit = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' }[card.suit] ?? '';
        const rank = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[card.number] ?? card.number;
        const top = document.createElement('span');
        top.className = 'party-farmer-card-top';
        top.textContent = `${suit}${rank == null ? '' : ` ${rank}`}`;
        const name = document.createElement('span');
        name.className = 'party-farmer-card-name';
        name.textContent = `${get.translation(card.nature ?? '')}${get.translation(card.name)}`;
        name.classList.toggle('is-four-character', name.textContent.length === 4);
        item.append(top, name);
        contents.append(item);
      }
      list.replaceChildren(contents);
      cardsDirty = false;
    }
    const label = `${nickname} · ${cards.length}张`;
    if (heading.textContent !== label) heading.textContent = label;
  }
  function measure(mate) {
    knownInquiries = [
      ...new Set([...(ui.controls ?? []), ...document.querySelectorAll(inquiries)]),
    ];
    const anchorNodes = [
      button,
      ...[...mate.querySelectorAll(attachments)].flatMap((node) => [node, ...node.children]),
    ];
    const obstacles = [
      ...game.players,
      ...game.dead,
      ui.handcards1Container,
      ui.handcards2Container,
      ...knownInquiries,
      ...document.querySelectorAll(tableLabels),
    ];
    const rects = new Map(
      [...new Set([mate, ...anchorNodes, ...obstacles])].map((node) => [node, visibleRect(node)]),
    );
    const origin = layer.getBoundingClientRect();
    const seat = rects.get(mate);
    const scaleX = origin.width / 100;
    const scaleY = origin.height / 100;
    if (!seat || !scaleX || !scaleY) return;
    const anchor = anchorNodes.reduce((bounds, node) => {
      const rect = rects.get(node);
      return rect
        ? {
            left: Math.min(bounds.left, rect.left),
            right: Math.max(bounds.right, rect.right),
            top: Math.min(bounds.top, rect.top),
            bottom: Math.max(bounds.bottom, rect.bottom),
          }
        : bounds;
    }, seat);
    const areas = [...new Set(obstacles)].map((node) => rects.get(node)).filter(Boolean);
    areas.push(anchor);
    const box = adjacentPlacement(
      seat,
      anchor,
      areas,
      Math.min(344, Math.max(128, cards.length * 47 + 10)),
    );
    if (box)
      return {
        left: (box.x - origin.left) / scaleX,
        top: (box.y - origin.top) / scaleY,
        width: box.width / scaleX,
        height: box.height / scaleY,
        scaleX,
      };
  }
  function tuck() {
    if (!tray || tray.hidden) return;
    tray.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }
  function setPlacement(placement) {
    if (placement) {
      const { scaleX, ...bounds } = placement;
      touchScale = scaleX;
      for (const [key, value] of Object.entries(bounds)) {
        const css = `${value}px`;
        if (tray.style[key] !== css) tray.style[key] = css;
      }
    }
    if (tray.hidden !== !placement) tray.hidden = !placement;
    const tucked = expanded && tray.hidden;
    const caption = tucked ? `手牌${cards.length}张 · 暂收起` : `队友手牌 ${cards.length}张`;
    if (button.textContent !== caption) {
      button.textContent = caption;
      if (expanded) scheduleLayout();
    }
    const title = tucked
      ? '当前询问或牌桌空间不足，结束后自动展开队友手牌'
      : `${nickname}的手牌 · 只读`;
    if (button.title !== title) button.title = title;
    const aria = String(!tray.hidden);
    if (button.getAttribute('aria-expanded') !== aria) button.setAttribute('aria-expanded', aria);
  }
  function position() {
    if (_status.over) return clear();
    const view = ensure();
    if (!view) return tuck();
    const zoom = game.documentZoom || 1;
    if (view.moved || appliedZoom !== zoom) {
      appliedZoom = zoom;
      button.style.zoom = String(1 / zoom);
      layer.style.transform = `scale(${1 / zoom})`;
      renderCards();
      setPlacement();
      if (expanded) scheduleLayout();
      return;
    }
    const placement = expanded ? measure(view.mate) : undefined;
    renderCards();
    setPlacement(placement);
  }
  globalThis.partyEngine.updateFarmerHands = (incoming, id, name) => {
    if (mateId !== id) {
      tuck();
      button?.remove();
      list?.replaceChildren();
    }
    cards = incoming;
    mateId = id;
    nickname = name;
    cardsDirty = true;
    if (mateId) scheduleLayout();
  };
  const scheduleLayout = () => {
    if (!mateId || disposed || layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      position();
      const now = performance.now();
      for (const [node, active] of motions) {
        if (!node.isConnected) {
          motions.delete(node);
          continue;
        }
        for (const [name, until] of active) if (now >= until) active.delete(name);
        if (!active.size) motions.delete(node);
      }
      if (expanded && motions.size) scheduleLayout();
    });
  };
  const owned = (node) => layer?.contains(node) || button?.contains(node);
  const inquiryTarget = (node) =>
    node.closest(inquiries) || knownInquiries.some((control) => node.contains(control));
  const handContainers = () => [ui.handcards1Container, ui.handcards2Container];
  const layoutTarget = (node) =>
    node === document.body ||
    node === ui.window ||
    node === ui.arena ||
    handContainers().includes(node) ||
    node.matches(`.player, ${tableLabels}`) ||
    (button?.parentElement?.contains(node) && node.closest(attachments));
  const includes = (node, selector) =>
    node.nodeType === Node.ELEMENT_NODE && (node.matches(selector) || node.querySelector(selector));
  const observer = new MutationObserver((changes) => {
    if (!mateId || (!expanded && button?.isConnected)) return;
    let layout = false;
    let yieldToInquiry = false;
    for (const { target, type, attributeName, oldValue, addedNodes, removedNodes } of changes) {
      if (target.nodeType !== Node.ELEMENT_NODE || owned(target)) continue;
      if (type === 'attributes') {
        if (oldValue === target.getAttribute(attributeName)) continue;
        yieldToInquiry ||= inquiryTarget(target);
        layout ||= layoutTarget(target);
      } else {
        const nodes = [...addedNodes, ...removedNodes].filter((node) => !owned(node));
        if (nodes.some((node) => includes(node, inquiries))) yieldToInquiry = true;
        if (nodes.some((node) => node.nodeType === Node.ELEMENT_NODE)) {
          yieldToInquiry ||= target.id === 'control' || target.closest(inquiries);
          layout ||=
            target.closest(attachments) ||
            handContainers().includes(target) ||
            nodes.some((node) => includes(node, `.player, ${attachments}, ${tableLabels}`));
        }
      }
      if (yieldToInquiry) break;
    }
    if (yieldToInquiry) tuck();
    if (yieldToInquiry || layout) scheduleLayout();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-position', 'id', 'open', 'aria-hidden'],
  });
  const resize = () => {
    if (expanded) tuck();
    scheduleLayout();
  };
  const motionEvents = [
    'transitionrun',
    'transitionend',
    'transitioncancel',
    'animationstart',
    'animationend',
    'animationcancel',
  ];
  const trackMotion = (event) => {
    if (!expanded || !mateId || owned(event.target) || event.pseudoElement) return;
    const name = event.propertyName ?? event.animationName;
    const starting = event.type === 'transitionrun' || event.type === 'animationstart';
    if (starting) {
      if (event.propertyName && !geometryTransition.test(name)) return;
      const inquiry = inquiryTarget(event.target);
      if (!inquiry && !layoutTarget(event.target)) return;
      if (inquiry) tuck();
      if (!motions.has(event.target)) motions.set(event.target, new Map());
      motions.get(event.target).set(name, performance.now() + 700);
    } else if (!motions.get(event.target)?.delete(name)) return;
    scheduleLayout();
  };
  window.addEventListener('resize', resize);
  for (const event of motionEvents) document.addEventListener(event, trackMotion, true);
  const clear = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(layoutFrame);
    observer.disconnect();
    motions.clear();
    knownInquiries = [];
    window.removeEventListener('resize', resize);
    for (const event of motionEvents) document.removeEventListener(event, trackMotion, true);
    cards = [];
    mateId = '';
    nickname = '';
    button?.remove();
    tray?.replaceChildren();
    layer?.remove();
    style.remove();
    button = layer = tray = list = heading = undefined;
    delete globalThis.partyEngine.updateFarmerHands;
    window.removeEventListener('message', finish);
  };
  const finish = (event) => {
    if (
      event.origin === location.origin &&
      event.source === parent &&
      event.data?.type === 'party-finished' &&
      event.data.matchId === globalThis.partyEngine.setup.id
    )
      clear();
  };
  window.addEventListener('message', finish);
  lib.onover.push(clear);
  window.addEventListener('pagehide', clear, { once: true });
}

/** Same-game team hands are private read-only data, never public-card markers. */
export function installFarmerHands() {
  const setup = globalThis.partyEngine.setup;
  const humans = new Set(
    setup.seats.filter((seat) => seat.kind === 'human').map((seat) => seat.id),
  );
  const signatures = new Map();
  const zones = new Map();
  const touched = new Set();
  let disposed = false;
  let queued = false;
  function publish(recipients, touched) {
    if (disposed || _status.over) return;
    const players = [...game.players, ...game.dead];
    const hands = new Map();
    for (const id of recipients) {
      const player = lib.playerOL[id];
      if (!player?.ws || player.ws.closed) continue;
      const prior = signatures.get(id);
      const mate = players.find((candidate) => sharesHandWith(player, candidate, setup));
      if (touched && prior?.mate === mate && !touched.has(mate)) continue;
      if (!mate && !prior) continue;
      if (mate && !hands.has(mate)) {
        const cards = mate.getCards('h');
        const signature = JSON.stringify([
          mate.nickname,
          cards.map(({ cardid, name, suit, number, nature }) => [
            cardid,
            name,
            suit,
            number,
            nature,
          ]),
        ]);
        hands.set(mate, { cards, signature });
      }
      const hand = hands.get(mate);
      if (prior?.mate === mate && prior.signature === hand?.signature) continue;
      player.send(
        function (cards, mateId, nickname) {
          globalThis.partyEngine.updateFarmerHands?.(cards, mateId, nickname);
        },
        hand?.cards ?? [],
        mate?.playerid ?? '',
        mate?.nickname ?? '',
      );
      if (mate) signatures.set(id, { mate, signature: hand.signature });
      else signatures.delete(id);
    }
  }
  const handClassChanged = (card, oldValue) => {
    const previous = (oldValue ?? '').split(/\s+/);
    return ['removing', 'glows'].some(
      (name) => previous.includes(name) !== card.classList.contains(name),
    );
  };
  function handChanged(owner) {
    if (!owner || disposed) return;
    touched.add(owner);
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      publish(humans, touched);
      touched.clear();
    });
  }
  const observer = new MutationObserver((changes) => {
    for (const { target, type, attributeName, oldValue } of changes) {
      const card = target.closest('.card');
      const owner = zones.get(target) ?? zones.get(card?.parentElement);
      if (!owner || touched.has(owner)) continue;
      if (
        attributeName === 'class' &&
        (!card || target !== card || !handClassChanged(card, oldValue))
      )
        continue;
      if (type === 'childList' || oldValue !== target.getAttribute(attributeName))
        handChanged(owner);
    }
  });
  function observeHands() {
    for (const player of [...game.players, ...game.dead]) {
      for (const zone of [player.node.handcards1, player.node.handcards2]) {
        if (!zone || zones.has(zone)) continue;
        zones.set(zone, player);
        observer.observe(zone, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ['class', 'data-card-name', 'data-nature'],
        });
      }
    }
  }
  const reinited = lib.message.server.reinited;
  const setNature = game.setNature;
  const updateNature = function (card, ...args) {
    const oldNature = card?.nature;
    const result = setNature.call(this, card, ...args);
    if (oldNature !== card?.nature) handChanged(zones.get(card?.parentElement));
    return result;
  };
  const resend = function (...args) {
    const result = reinited.apply(this, args);
    if (humans.has(this.id)) {
      signatures.delete(this.id);
      observeHands();
      publish([this.id]);
    }
    return result;
  };
  lib.message.server.reinited = resend;
  game.setNature = updateNature;
  observeHands();
  publish(humans);
  const clear = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    signatures.clear();
    zones.clear();
    touched.clear();
    if (lib.message.server.reinited === resend) lib.message.server.reinited = reinited;
    if (game.setNature === updateNature) game.setNature = setNature;
    window.removeEventListener('pagehide', clear);
  };
  lib.onover.push(clear);
  window.addEventListener('pagehide', clear, { once: true });
}
