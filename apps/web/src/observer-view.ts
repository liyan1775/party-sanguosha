import type { ObserverState, ObserverLogPage } from '../../../packages/shared/src/contracts.js';

type LogView = {
  matchId: string | null;
  entries: Map<number, string>;
  total: number;
  first: number;
  loading: boolean;
  error: string;
  complete: boolean;
};
const logViews = new WeakMap<HTMLElement, LogView>();

function renderLog(
  target: HTMLElement,
  view: LogView,
  load?: (before: number) => Promise<ObserverLogPage>,
  focusEarlier = false,
  scroll?: { position: number; atEnd: boolean },
) {
  const old = target.querySelector('.observer-recent');
  const position = scroll?.position ?? old?.scrollTop ?? 0;
  const atEnd = scroll?.atEnd ?? (!old || old.scrollHeight - old.clientHeight - position < 30);
  target.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = `${view.complete ? '本局公开记录' : '最近公开动作'} · ${view.total} 条`;
  const entries = [...view.entries].sort(([a], [b]) => a - b);
  const first = entries[0]?.[0] ?? view.total + 1;
  const gap = entries.find(
    ([sequence], index) => index > 0 && sequence > entries[index - 1]![0] + 1,
  )?.[0];
  async function readPage(before: number, focusEarlier: boolean) {
    if (!load || view.loading) return;
    view.loading = true;
    view.error = '';
    renderLog(target, view, load);
    try {
      const page = await load(before);
      if (page.matchId !== view.matchId || !target.isConnected) return;
      const size = view.entries.size;
      for (const entry of page.entries) view.entries.set(entry.sequence, entry.text);
      view.first = page.first;
      view.total = Math.max(view.total, page.total);
      for (const sequence of view.entries.keys())
        if (sequence < view.first) view.entries.delete(sequence);
      if (view.entries.size <= size && before > view.first)
        view.error = '记录暂未同步，请重试读取。';
    } catch (error) {
      view.error = error instanceof Error ? error.message : '读取记录失败，请重试。';
    } finally {
      view.loading = false;
      if (target.isConnected) renderLog(target, view, load, focusEarlier && !view.error);
    }
  }
  if (load && first > view.first) {
    const earlier = document.createElement('button');
    earlier.className = 'button secondary observer-earlier';
    earlier.textContent = view.loading ? '正在读取…' : '查看更早记录';
    earlier.disabled = view.loading;
    earlier.addEventListener('click', () => void readPage(first, true));
    target.append(earlier);
  }
  if (gap && view.error) {
    const retry = document.createElement('button');
    retry.className = 'button secondary';
    retry.textContent = '重试读取缺失记录';
    retry.addEventListener('click', () => void readPage(gap, false));
    target.append(retry);
  }
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    view.error ||
    (view.first > 1
      ? '本局超过 10000 条，最早记录已释放；下方编号保留原顺序。'
      : first > 1
        ? '按发生顺序显示，点击「查看更早记录」可回看本局开头。'
        : '按发生顺序记录；暗手牌只显示数量，私人选择不展示。');
  const list = document.createElement('ol');
  list.className = 'observer-recent';
  list.setAttribute('aria-label', '本局公开事件记录');
  for (const [sequence, text] of entries) {
    const item = document.createElement('li');
    item.value = sequence;
    item.textContent = text;
    list.append(item);
  }
  target.prepend(heading);
  target.append(hint, list);
  // Keep a reader's position when live updates arrive; follow new events only
  // when already at the end. Older pages remain available after every poll.
  list.scrollTop = focusEarlier ? 0 : atEnd ? list.scrollHeight : position;
  // Console polling may skip multiple preview batches. Fill middle gaps from
  // the server journal too, not just the entries preceding the first row.
  if (gap && load && !view.loading && !view.error) void readPage(gap, false);
}

/** Text-only public data: a console never selects a participating viewpoint. */
export function renderObserver(
  target: HTMLElement,
  state: ObserverState | null,
  matchId: string | null = null,
  load?: (before: number) => Promise<ObserverLogPage>,
): void {
  const oldLog = target.querySelector<HTMLElement>('.observer-log');
  const oldList = oldLog?.querySelector('.observer-recent');
  const scroll =
    oldList && oldLog?.dataset.matchId === (matchId ?? '')
      ? {
          position: oldList.scrollTop,
          atEnd: oldList.scrollHeight - oldList.clientHeight - oldList.scrollTop < 30,
        }
      : undefined;
  target.replaceChildren();
  if (!state) {
    logViews.delete(target);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '选将发牌后，这里会同步公开牌桌。观战不占玩家席位。';
    target.append(hint);
    return;
  }
  const heading = document.createElement('p');
  heading.className = 'observer-round';
  heading.textContent = `${state.ended ? '本局已结束' : state.round ? `第 ${state.round} 轮` : '选将与发牌中'} · 公开视角`;
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
    const control = document.createElement('p');
    control.className = 'observer-control';
    control.textContent = player.controller
      ? {
          human: '玩家手动操作',
          auto: '玩家开启托管',
          offline: state.ended
            ? '玩家断线'
            : state.round
              ? '玩家断线 · 原生 AI 接管'
              : '玩家断线 · 等待选将恢复',
          bot: '原生 AI 席位',
        }[player.controller]
      : '';
    const hp = document.createElement('p');
    hp.textContent = player.maxHp
      ? `体力 ${player.hp} / ${player.maxHp}${player.armor ? ` · 护甲 ${player.armor}` : ''} · 手牌 ${player.handCount} 张`
      : '等待选将与发牌';
    const equipment = document.createElement('p');
    equipment.textContent = `装备：${player.equipment.join('、') || '无'}`;
    const judgment = document.createElement('p');
    judgment.textContent = `判定区：${player.judgments.join('、') || '无'}`;
    seat.append(name, general, status, control, hp, equipment, judgment);
    board.append(seat);
  }
  let view = logViews.get(target);
  if (!view || view.matchId !== matchId) {
    view = {
      matchId,
      entries: new Map(),
      total: 0,
      first: 1,
      loading: false,
      error: '',
      complete: state.logStart !== undefined,
    };
    logViews.set(target, view);
  }
  const start = state.logStart ?? 1;
  if (state.logStart === undefined) view.entries.clear();
  for (const [offset, text] of state.recent.entries()) view.entries.set(start + offset, text);
  view.total = state.logTotal ?? state.recent.length;
  view.first = state.logFirst ?? 1;
  for (const sequence of view.entries.keys())
    if (sequence < view.first) view.entries.delete(sequence);
  const log =
    oldLog && oldLog.dataset.matchId === (matchId ?? '')
      ? oldLog
      : document.createElement('section');
  log.className = 'observer-log';
  log.dataset.matchId = matchId ?? '';
  target.append(heading, board, log);
  renderLog(log, view, state.logStart === undefined ? undefined : load, false, scroll);
}
