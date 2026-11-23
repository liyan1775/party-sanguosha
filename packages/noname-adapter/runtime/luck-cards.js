// SPDX-License-Identifier: GPL-3.0-only
import { lib, game, ui, get } from 'noname';

export function installLuckCards() {
  const engine = globalThis.partyEngine;
  if (engine.setup.role !== 'worker') {
    let timer;
    let panel;
    engine.showLuckCards = (state) => {
      clearInterval(timer);
      panel?.remove();
      panel = null;
      engine.luckState = state;
      if (!state.active) return;
      panel = document.createElement('section');
      panel.id = 'party-luck-cards';
      panel.style.cssText =
        'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:100;width:max-content;max-width:92%;padding:12px 18px;border:1.5px solid var(--zt-gold,#c59a42);border-radius:5px;background:var(--zt-panel,#fffefb);color:var(--zt-ink,#132430);box-shadow:0 14px 36px rgba(0,0,0,.32);text-align:center;font:14px/1.6 system-ui';
      const title = document.createElement('strong');
      title.style.cssText =
        'display:block;line-height:1.5;font-family:"Songti SC",STSong,SimSun,serif;font-size:16px;color:var(--zt-gold,#b88b35)';
      title.textContent = state.done ? '已保留起手牌，等待其他玩家' : '手气卡 · 可整手重抽';
      const countdown = document.createElement('div');
      countdown.style.cssText =
        'position:static;display:block;line-height:1.5;font-size:12.5px;opacity:.82';
      const deadline = performance.now() + state.remainingMs;
      const update = () => {
        countdown.textContent = `剩余 ${Math.max(0, Math.ceil((deadline - performance.now()) / 1000))} 秒 · 超时保留当前手牌`;
      };
      update();
      timer = setInterval(update, 250);
      panel.append(title, countdown);
      if (!state.done) {
        for (const [action, label] of [
          ['refresh', `刷新手牌（剩余 ${state.remaining} 次）`],
          ['keep', '保留手牌'],
        ]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.action = action;
          button.textContent = label;
          button.style.cssText =
            action === 'refresh'
              ? 'min-height:42px;margin:8px 5px 0;padding:8px 16px;border:1px solid var(--zt-gold-hi,#e2c276);border-radius:4px;background:linear-gradient(168deg,var(--zt-jade,#1f7d72),#114c45);color:#fffaf0;font:700 14px/1 system-ui;cursor:pointer'
              : 'min-height:42px;margin:8px 5px 0;padding:8px 16px;border:1px solid var(--zt-gold,#b88b35);border-radius:4px;background:transparent;color:var(--zt-ink,#132430);font:700 14px/1 system-ui;cursor:pointer';
          button.onclick = () => {
            for (const control of panel.querySelectorAll('button')) control.disabled = true;
            game.send('partyLuck', state.epoch, state.revision, action);
          };
          panel.append(button);
        }
      }
      document.body.append(panel);
    };
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    return;
  }
  let phase;
  const send = (player) => {
    const state = phase?.players.get(player.playerid);
    if (!state) return;
    player.send(
      function (state) {
        globalThis.partyEngine.showLuckCards?.(state);
      },
      {
        active: true,
        epoch: phase.epoch,
        revision: state.revision,
        remaining: state.remaining,
        done: state.done,
        remainingMs: Math.max(0, phase.deadline - Date.now()),
      },
    );
  };
  const finish = () => {
    if (!phase) return;
    const current = phase;
    phase = null;
    clearTimeout(current.timer);
    for (const [id, state] of current.players)
      lib.playerOL[id]?.send(
        function (state) {
          globalThis.partyEngine.showLuckCards?.(state);
        },
        { ...state, active: false, epoch: current.epoch },
      );
    current.resolve();
  };
  lib.message.server.partyLuck = function (epoch, revision, action) {
    const player = lib.playerOL[this.id];
    const state = phase?.players.get(this.id);
    if (!state || player?.ws !== this) return;
    if (Date.now() >= phase.deadline) return finish();
    if (
      state.done ||
      epoch !== phase.epoch ||
      revision !== state.revision ||
      !['refresh', 'keep'].includes(action)
    )
      return send(player);
    state.revision++;
    if (action === 'keep') state.done = true;
    else if (state.remaining > 0) {
      state.remaining--;
      const old = player.getCards('h');
      const cards = get.cards(old.length);
      // Remove the original hidden hand while it is still hidden. Return those
      // entities randomly to the deck, without a public discard or skill trigger.
      game.broadcastAll(
        function (player, cards) {
          for (const card of cards) {
            card.removeGaintag(true);
            card.remove();
          }
          player.update();
        },
        player,
        old,
      );
      for (const card of old) {
        card.fix();
        card.clearKnowers();
        ui.cardPile.insertBefore(
          card,
          ui.cardPile.childNodes[get.rand(0, ui.cardPile.childNodes.length)] ?? null,
        );
      }
      player.directgain(cards);
      player._start_cards = player.getCards('h');
      if (state.remaining === 0) state.done = true;
    }
    if ([...phase.players.values()].every((player) => player.done)) finish();
    else send(player);
  };
  const reinited = lib.message.server.reinited;
  lib.message.server.reinited = function (...args) {
    reinited.apply(this, args);
    const player = lib.playerOL[this.id];
    if (player?.ws === this) send(player);
  };
  return () =>
    new Promise((resolve) => {
      const players = new Map(
        game.players
          .filter((player) =>
            engine.setup.seats.some((seat) => seat.id === player.playerid && seat.kind === 'human'),
          )
          .map((player) => [player.playerid, { remaining: 3, revision: 0, done: false }]),
      );
      if (!players.size) return resolve();
      phase = { epoch: get.id(), deadline: Date.now() + 30000, players, resolve };
      phase.timer = setTimeout(finish, 30000);
      for (const id of players.keys()) send(lib.playerOL[id]);
    });
}
