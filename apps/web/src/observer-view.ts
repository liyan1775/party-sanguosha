import type { ObserverState } from '../../../packages/shared/src/contracts.js';

/** Text-only public data: a console never selects a participating viewpoint. */
export function renderObserver(target: HTMLElement, state: ObserverState | null): void {
  target.replaceChildren();
  if (!state) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '选将发牌后，这里会同步公开牌桌。观战不占玩家席位。';
    target.append(hint);
    return;
  }
  const heading = document.createElement('p');
  heading.className = 'observer-round';
  heading.textContent = `${state.ended ? '本局已结束' : `第 ${state.round} 轮`} · 公开视角`;
  const board = document.createElement('div');
  board.className = 'observer-board';
  for (const player of state.players) {
    const seat = document.createElement('article');
    seat.className = `observer-seat${player.dead ? ' is-dead' : ''}${state.currentPlayerId === player.id ? ' is-active' : ''}`;
    const name = document.createElement('h3');
    name.textContent = player.nickname;
    const general = document.createElement('strong');
    general.className = 'observer-general';
    general.textContent = player.general;
    const status = document.createElement('p');
    status.textContent = `${player.identity} · ${player.dead ? '已阵亡' : state.currentPlayerId === player.id ? '当前回合' : '在场'}${player.linked ? ' · 连环' : ''}${player.turnedOver ? ' · 翻面' : ''}`;
    const hp = document.createElement('p');
    hp.textContent = `体力 ${player.hp} / ${player.maxHp}${player.armor ? ` · 护甲 ${player.armor}` : ''} · 手牌 ${player.handCount} 张`;
    const equipment = document.createElement('p');
    equipment.textContent = `装备：${player.equipment.join('、') || '无'}`;
    const judgment = document.createElement('p');
    judgment.textContent = `判定区：${player.judgments.join('、') || '无'}`;
    seat.append(name, general, status, hp, equipment, judgment);
    board.append(seat);
  }
  const recent = document.createElement('ol');
  recent.className = 'observer-recent';
  for (const text of state.recent.slice().reverse()) {
    const item = document.createElement('li');
    item.textContent = text;
    recent.append(item);
  }
  target.append(heading, board, recent);
}
