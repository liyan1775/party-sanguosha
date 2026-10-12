import {
  MATCH_FAILURE_MESSAGES,
  type ObserverLogPage,
  type ObserverState,
  type RoomView,
} from '../../../packages/shared/src/contracts.js';
import { api, element } from './ui.js';
import { renderObserver } from './observer-view.js';

type PublicObservation = ObserverLogPage & {
  roomCode: string;
  observer: ObserverState | null;
};

/** Late arrivals read the public projection without ever opening a player channel. */
export function bindRoomSpectator(roomCode: string) {
  const panel = document.createElement('section');
  panel.id = 'spectator-panel';
  panel.className = 'panel spectator-panel';
  panel.hidden = true;
  panel.innerHTML =
    '<div class="panel-heading"><h2>公开观战</h2><span id="spectator-status" class="tag muted" role="status"></span></div><p class="hint">本局已开场，先在这里观战。观战不占席位；下一局回到等待房间后可填写昵称入座。</p><p id="spectator-deck" class="hint" hidden></p><p id="spectator-error" class="message" role="status" hidden></p><button id="spectator-refresh" class="button secondary" type="button">刷新观战</button><div id="spectator-table"></div>';
  element('.room-grid').before(panel);
  const status = panel.querySelector<HTMLElement>('#spectator-status')!;
  const count = panel.querySelector<HTMLElement>('#spectator-deck')!;
  const error = panel.querySelector<HTMLElement>('#spectator-error')!;
  const board = panel.querySelector<HTMLElement>('#spectator-table')!;
  const button = panel.querySelector<HTMLButtonElement>('#spectator-refresh')!;
  let matchId: string | null = null;
  let generation = 0;
  let loading = false;
  let available = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let snapshot: RoomView | undefined;

  async function read(id: string, before?: number): Promise<PublicObservation> {
    const query = new URLSearchParams({ room: roomCode });
    if (before !== undefined) query.set('before', String(before));
    const page = await api<PublicObservation>(
      `/engine/observe/${id}?${query}`,
      'GET',
      undefined,
      {},
      8000,
    );
    if (id !== matchId || page.matchId !== id || page.roomCode !== roomCode)
      throw new Error('这份观战记录已属于上一局，请重新读取。');
    return page;
  }
  function label(): void {
    status.textContent = snapshot?.matchFailure
      ? '本局中断 · 未判胜负'
      : snapshot?.matchRecovery
        ? '正在恢复电脑规则连接'
        : snapshot?.phase === 'finished'
          ? '本局已结束'
          : snapshot?.phase === 'starting'
            ? '选将与发牌中'
            : '正在对局';
  }
  async function refresh(): Promise<void> {
    clearTimeout(timer);
    if (!matchId || !available || loading || panel.hidden || stopped) return;
    const id = matchId;
    const current = generation;
    loading = true;
    button.disabled = true;
    button.textContent = '正在同步…';
    try {
      const page = await read(id);
      if (current !== generation || stopped) return;
      error.hidden = !snapshot?.matchFailure;
      error.textContent = snapshot?.matchFailure
        ? MATCH_FAILURE_MESSAGES[snapshot.matchFailure.code]
        : '';
      count.hidden = page.observer?.deckCount === undefined;
      count.textContent = `牌堆剩余 ${page.observer?.deckCount ?? 0} 张`;
      renderObserver(board, page.observer, id, (before) => read(id, before));
      label();
    } catch (cause) {
      if (current === generation && !stopped) {
        error.hidden = false;
        error.textContent = cause instanceof Error ? cause.message : '观战暂未同步，正在重试。';
      }
    } finally {
      if (current === generation && !stopped) {
        loading = false;
        button.disabled = false;
        button.textContent = '刷新观战';
        if (!document.hidden && !panel.hidden && available)
          timer = setTimeout(() => void refresh(), 1600);
      }
    }
  }
  button.addEventListener('click', () => void refresh());
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden) void refresh();
  });
  window.addEventListener(
    'pagehide',
    () => {
      stopped = true;
      generation++;
      clearTimeout(timer);
    },
    { once: true },
  );
  return {
    context(room: RoomView, unseated: boolean): void {
      snapshot = room;
      const id =
        unseated && ['starting', 'playing', 'finished'].includes(room.phase) ? room.matchId : null;
      const newlyAvailable = !available && Boolean(room.engine.publicSpectating);
      available = Boolean(room.engine.publicSpectating);
      panel.hidden = !id;
      label();
      if (id !== matchId) {
        generation++;
        clearTimeout(timer);
        loading = false;
        matchId = id;
        count.hidden = true;
        error.hidden = true;
        button.disabled = false;
        board.replaceChildren();
        if (id) {
          renderObserver(board, null);
          if (available) void refresh();
        }
      }
      button.hidden = !available;
      if (id && newlyAvailable) void refresh();
      if (id && !available) {
        error.hidden = false;
        error.textContent = '电脑服务更新并重启后，可在这里查看公开牌桌。';
      }
    },
  };
}
