// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, _status } from 'noname';

export function installControls() {
  let updateSettlement = () => {};
  if (globalThis.partyEngine.setup.role !== 'worker') {
    // The upstream hook also auto-confirms skills tagged direct even when the
    // config is off. Keep its other check hooks; human selections require OK.
    lib.hooks.checkEnd = lib.hooks.checkEnd.filter((hook) => hook.name !== 'autoConfirm');
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
