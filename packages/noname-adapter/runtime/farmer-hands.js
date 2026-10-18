// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, get, ui, _status } from 'noname';

/** Client-only presentation. Only its expanded preference survives a reload. */
export function installFarmerHandView() {
  let cards = [],
    mateId = '',
    nickname = '',
    button,
    tray,
    list,
    heading;
  let expanded = sessionStorage.getItem('party_farmer_hand_open') === '1';
  let disposed = false;
  const style = document.createElement('style');
  style.textContent = `
    .party-farmer-toggle{position:absolute;left:50%;bottom:-27px;transform:translateX(-50%);min-width:94px;max-width:180px;height:25px;padding:2px 7px;border:1px solid #d5bb80;border-radius:4px;background:#1a3229f2;color:#f3e3bb;font:12px/20px system-ui;white-space:nowrap;cursor:pointer;z-index:8}
    .party-farmer-toggle[aria-expanded=true]{background:#546043}
    #party-farmer-hand{position:fixed;z-index:48;box-sizing:border-box;padding:5px 8px;border:1px solid #a8b28a;border-radius:5px;background:#172e26f7;color:#f2e9cc;box-shadow:0 3px 10px #0006;font:12px/1.3 system-ui;pointer-events:auto}
    #party-farmer-hand[hidden]{display:none}
    #party-farmer-hand header{display:flex;align-items:center;gap:10px;height:19px;margin-bottom:4px}
    #party-farmer-hand strong{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:400}
    #party-farmer-hand button{background:none;border:0;color:#f2e9cc;padding:0 3px;font:12px system-ui;cursor:pointer}
    .party-farmer-cards{display:flex;gap:5px;overflow:auto;height:calc(100% - 23px);scrollbar-width:thin;overscroll-behavior:contain}
    .party-farmer-card{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:3px;flex-shrink:0;min-width:56px;max-width:96px;height:100%;padding:3px 6px;background:#f3ead4;border:1px solid #cfbb8c;border-radius:3px;color:#273529;font-size:12px;pointer-events:none}
    .party-farmer-card.is-red{color:#9b332d}
  `;
  document.head.append(style);
  function stop(event) {
    event.stopPropagation();
  }
  function ensure() {
    const mate = lib.playerOL[mateId];
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
        position();
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
        position();
        button.focus();
      };
      header.append(heading, close);
      list = document.createElement('div');
      list.className = 'party-farmer-cards';
      tray.append(header, list);
      for (const event of ['click', 'mousedown', 'touchstart', 'touchend'])
        tray.addEventListener(event, stop);
      document.body.append(tray);
    }
    if (button.parentNode !== mate) mate.append(button);
    return true;
  }
  function position() {
    if (disposed) return;
    if (_status.over) {
      clear();
      return;
    }
    if (!mateId || !ensure()) {
      if (tray) tray.hidden = true;
      return;
    }
    button.textContent = `队友手牌 ${cards.length}张`;
    button.title = `${nickname}的手牌 · 只读`;
    heading.textContent = `${nickname} · 只读 ${cards.length}张`;
    // Native scales body with CSS zoom. Fixed geometry is measured in viewport
    // pixels, so cancel that zoom before applying a safe, non-overlapping box.
    const zoom = game.documentZoom || 1;
    tray.style.zoom = String(1 / zoom);
    button.style.fontSize = `${12 / zoom}px`;
    button.style.height = `${26 / zoom}px`;
    button.style.lineHeight = `${20 / zoom}px`;
    button.style.minWidth = `${94 / zoom}px`;
    button.style.bottom = `${-29 / zoom}px`;
    // The native dialog and target/skill choice always have priority. Reopen
    // only after it closes, without resetting a choice or extending its timer.
    const choosing =
      !!ui.dialog?.isConnected &&
      !ui.dialog.hidden &&
      getComputedStyle(ui.dialog).display !== 'none';
    tray.hidden = !expanded || choosing;
    button.setAttribute('aria-expanded', String(!tray.hidden));
    if (tray.hidden) return;
    const hand = ui.handcards1Container?.getBoundingClientRect();
    const protectedAreas = [...game.players, ...game.dead]
      .filter((p) => p.isConnected)
      .map((p) => p.getBoundingClientRect());
    if (hand?.height) protectedAreas.push(hand);
    for (const control of ui.controls ?? [])
      if (control.isConnected) protectedAreas.push(control.getBoundingClientRect());
    const w = innerWidth,
      h = innerHeight;
    let placement;
    for (const height of [88, 62]) {
      for (const width of [Math.min(440, w - 24), Math.min(280, w - 24)]) {
        const xs = [(w - width) / 2, 12, w - width - 12];
        const ys = [
          Math.max(8, (hand?.top ?? h - 100) - height - 7),
          8,
          Math.max(8, h / 2 - height / 2),
        ];
        for (const top of ys)
          for (const left of xs) {
            if (
              placement ||
              top + height > h - 5 ||
              protectedAreas.some(
                (r) =>
                  r.width &&
                  r.height &&
                  left < r.right + 3 &&
                  left + width > r.left - 3 &&
                  top < r.bottom + 3 &&
                  top + height > r.top - 3,
              )
            )
              continue;
            placement = { left, top, width, height };
          }
      }
    }
    if (placement)
      for (const [key, value] of Object.entries(placement)) tray.style[key] = `${value}px`;
    else tray.hidden = true;
    button.setAttribute('aria-expanded', String(!tray.hidden));
  }
  globalThis.partyEngine.updateFarmerHands = (incoming, id, name) => {
    cards = incoming;
    mateId = id;
    nickname = name;
    if (!ensure()) return;
    list.replaceChildren();
    for (const card of cards) {
      const item = document.createElement('span');
      item.className = `party-farmer-card${['heart', 'diamond'].includes(card.suit) ? ' is-red' : ''}`;
      const suit = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' }[card.suit] ?? '';
      const rank = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[card.number] ?? card.number;
      item.textContent = `${suit}${rank ?? ''} ${get.translation(card.nature ?? '')}${get.translation(card.name)}`;
      list.append(item);
    }
    position();
  };
  const timer = setInterval(position, 250);
  const clear = () => {
    disposed = true;
    clearInterval(timer);
    cards = [];
    mateId = '';
    nickname = '';
    button?.remove();
    tray?.replaceChildren();
    tray?.remove();
    button = tray = list = heading = undefined;
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

/** Same-game farmer hands are private read-only data, never public-card markers. */
export function installFarmerHands() {
  const signatures = new Map();
  const publish = () => {
    if (_status.over) return;
    for (const seat of globalThis.partyEngine.setup.seats.filter((s) => s.kind === 'human')) {
      const player = lib.playerOL[seat.id];
      if (player?.identity !== 'fan') continue;
      const mate = [...game.players, ...game.dead].find(
        (p) => p !== player && p.identity === 'fan',
      );
      if (!mate) continue;
      const cards = mate.getCards('h');
      const signature =
        `${mate.playerid}:` +
        cards.map((c) => `${c.cardid}/${c.name}/${c.suit}/${c.number}/${c.nature}`).join(',');
      if (signatures.get(seat.id) === signature) continue;
      signatures.set(seat.id, signature);
      player.send(
        function (cards, mateId, nickname) {
          globalThis.partyEngine.updateFarmerHands?.(cards, mateId, nickname);
        },
        cards,
        mate.playerid,
        mate.nickname,
      );
    }
  };
  const reinited = lib.message.server.reinited;
  lib.message.server.reinited = function (...args) {
    const result = reinited.apply(this, args);
    signatures.delete(this.id);
    publish();
    return result;
  };
  const timer = setInterval(publish, 500);
  publish();
  lib.onover.push(() => clearInterval(timer));
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
}
