import type { ObserverState, ObserverLogPage } from '../../../packages/shared/src/contracts.js';
import { patchAttr, patchHidden, patchText } from './console-dom.js';

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
const boardSignatures = new WeakMap<HTMLElement, string>();

function mergeLogPage(view: LogView, page: ObserverLogPage): boolean {
  const first = Math.max(view.first, page.first);
  const total = Math.max(view.total, page.total);
  let changed = first !== view.first || total !== view.total;
  if (first > view.first) {
    for (const sequence of view.entries.keys()) if (sequence < first) view.entries.delete(sequence);
  }
  view.first = first;
  view.total = total;
  for (const { sequence, text } of page.entries) {
    if (sequence < first || view.entries.get(sequence) === text) continue;
    view.entries.set(sequence, text);
    changed = true;
  }
  return changed;
}

/** The same numbered public journal can be read by an authenticated seated player. */
export function renderObserverLog(
  target: HTMLElement,
  page: ObserverLogPage,
  load: (before: number) => Promise<ObserverLogPage>,
): void {
  let view = logViews.get(target);
  if (!view || view.matchId !== page.matchId) {
    view = {
      matchId: page.matchId,
      entries: new Map(),
      total: 0,
      first: 1,
      loading: false,
      error: '',
      complete: true,
    };
    logViews.set(target, view);
  }
  const changed = mergeLogPage(view, page);
  if (target.dataset.matchId === page.matchId && target.firstElementChild && !changed) return;
  target.dataset.matchId = page.matchId;
  renderLog(target, view, load);
}

function renderLog(
  target: HTMLElement,
  view: LogView,
  load?: (before: number) => Promise<ObserverLogPage>,
  scrollToStart = false,
) {
  if (!target.firstElementChild) {
    target.innerHTML = `<h3></h3>
      <button type="button" class="button secondary observer-earlier" hidden>查看更早记录</button>
      <button type="button" class="button secondary observer-retry" hidden>重试读取缺失记录</button>
      <p class="hint"></p><ol class="observer-recent" tabindex="-1" aria-label="本局公开事件记录"></ol>`;
  }
  const earlier = target.querySelector<HTMLButtonElement>('.observer-earlier')!;
  const retry = target.querySelector<HTMLButtonElement>('.observer-retry')!;
  const list = target.querySelector<HTMLOListElement>('.observer-recent')!;
  const position = list.scrollTop;
  const atEnd = list.scrollHeight - list.clientHeight - position < 30;
  patchText(
    target.querySelector('h3')!,
    `${view.complete ? '本局公开记录' : '最近公开动作'} · ${view.total} 条`,
  );
  const entries = [...view.entries].sort(([a], [b]) => a - b);
  const first = entries[0]?.[0] ?? view.total + 1;
  const gap = entries.find(
    ([sequence], index) => index > 0 && sequence > entries[index - 1]![0] + 1,
  )?.[0];
  async function readPage(before: number, scrollToStart: boolean) {
    if (!load || view.loading) return;
    view.loading = true;
    view.error = '';
    renderLog(target, view, load);
    try {
      const page = await load(before);
      if (
        page.matchId !== view.matchId ||
        target.dataset.matchId !== view.matchId ||
        !target.isConnected
      )
        return;
      const size = view.entries.size;
      mergeLogPage(view, page);
      if (view.entries.size <= size && before > view.first)
        view.error = '记录暂未同步，请重试读取。';
    } catch (error) {
      view.error = error instanceof Error ? error.message : '读取记录失败，请重试。';
    } finally {
      view.loading = false;
      if (target.isConnected && target.dataset.matchId === view.matchId)
        renderLog(target, view, load, scrollToStart && !view.error);
    }
  }
  const hasEarlier = Boolean(load && first > view.first);
  const hasRetry = Boolean(gap && (view.error || (view.loading && !retry.hidden)));
  // Keep a busy control focusable. When its action disappears, only move focus
  // if the reader is still on that control at the time the response arrives.
  if (
    (!hasEarlier && document.activeElement === earlier) ||
    (!hasRetry && document.activeElement === retry)
  )
    list.focus({ preventScroll: true });
  patchHidden(earlier, !hasEarlier);
  patchHidden(retry, !hasRetry);
  patchAttr(earlier, 'aria-disabled', String(view.loading));
  patchAttr(retry, 'aria-disabled', String(view.loading));
  patchText(earlier, view.loading ? '正在读取…' : '查看更早记录');
  earlier.onclick = () => {
    if (hasEarlier) void readPage(first, true);
  };
  retry.onclick = () => {
    if (hasRetry && gap) void readPage(gap, false);
  };
  patchText(
    target.querySelector<HTMLElement>('.hint')!,
    view.error ||
      (view.first > 1
        ? '本局超过 10000 条，最早记录已释放；下方编号保留原顺序。'
        : first > 1
          ? '按发生顺序显示，点击「查看更早记录」可回看本局开头。'
          : '按发生顺序记录；暗手牌只显示数量，私人选择不展示。'),
  );
  entries.forEach(([sequence, text], index) => {
    const item =
      (list.children[index] as HTMLLIElement | undefined) ?? document.createElement('li');
    if (item.value !== sequence) item.value = sequence;
    patchText(item, text);
    if (!item.parentNode) list.append(item);
  });
  while (list.childElementCount > entries.length) list.lastElementChild!.remove();
  // Keep a reader's position when live updates arrive; follow new events only
  // when already at the end. Older pages remain available after every poll.
  list.scrollTop = scrollToStart ? 0 : atEnd ? list.scrollHeight : position;
  // Console polling may skip multiple preview batches. Fill middle gaps from
  // the server journal too, not just the entries preceding the first row.
  if (gap && load && !view.loading && !view.error) void readPage(gap, false);
}

/** Text-only public data: observers never select a participating viewpoint. */
export function renderObserver(
  target: HTMLElement,
  state: ObserverState | null,
  matchId: string | null = null,
  load?: (before: number) => Promise<ObserverLogPage>,
): void {
  const tracker = state?.cardTracker;
  // Delivery timestamps and effects are independent of this text-only public board.
  const signature = JSON.stringify([
    matchId,
    Boolean(load),
    state?.ended,
    state?.round,
    state?.deckCount,
    state?.identityCounts,
    state?.currentPlayerId,
    state?.players,
    state?.recent,
    state?.logStart,
    state?.logFirst,
    state?.logTotal,
    tracker && [
      tracker.pileName,
      tracker.deckCount,
      tracker.knownPublicCount,
      tracker.shuffledCount,
      tracker.unknownDiscards,
      tracker.categories,
    ],
  ]);
  if (target.firstElementChild && boardSignatures.get(target) === signature) return;
  boardSignatures.set(target, signature);
  const oldLog = target.querySelector<HTMLElement>('.observer-log');
  if (!state) {
    logViews.delete(target);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '选将发牌后，这里会同步公开牌桌。观战不占玩家席位。';
    target.replaceChildren(hint);
    return;
  }
  const heading = document.createElement('p');
  heading.className = 'observer-round';
  heading.textContent = `${state.ended ? '本局已结束' : state.round ? `第 ${state.round} 轮` : '选将与发牌中'} · 公开视角`;
  if (state.deckCount !== undefined) heading.textContent += ` · 牌堆剩余 ${state.deckCount} 张`;
  if (state.identityCounts) {
    const counts = state.identityCounts;
    heading.textContent += ` · 剩余身份：主 ${counts.zhu} 忠 ${counts.zhong} 反 ${counts.fan} 内 ${counts.nei}`;
    heading.title = '按开局身份人数减去已公开的阵亡身份，不显示在场玩家的隐藏身份';
  }
  const spotlightText = [...state.recent]
    .reverse()
    .find((line) =>
      /造成.*点.*伤害|阵亡|发动了|使用了【(南蛮入侵|万箭齐发|桃园结义|决斗|过河拆桥|顺手牵羊|火攻|杀|雷杀|火杀)】/.test(
        line,
      ),
    );
  let spotlight: HTMLElement | null = null;
  if (spotlightText) {
    spotlight = document.createElement('div');
    spotlight.className = 'observer-spotlight';
    const badge = document.createElement('span');
    badge.className = 'observer-spotlight-tag';
    badge.textContent = '实况高光';
    const copy = document.createElement('strong');
    copy.textContent = spotlightText;
    spotlight.append(badge, copy);
  }
  let trackerBox: HTMLElement | null = null;
  if (state.cardTracker) {
    const ct = state.cardTracker;
    trackerBox = document.createElement('section');
    trackerBox.className = 'observer-tracker';
    trackerBox.setAttribute('aria-label', '公开记牌统计');
    const title = document.createElement('div');
    title.className = 'observer-tracker-head';
    const strong = document.createElement('strong');
    strong.textContent = `公开记牌 · ${ct.pileName}`;
    const meta = document.createElement('span');
    meta.textContent = `牌堆余 ${ct.deckCount} 张 · 已公开 ${ct.knownPublicCount} 张${ct.shuffledCount > 0 ? ` · 已洗牌 ${ct.shuffledCount} 次` : ''}${ct.unknownDiscards > 0 ? ` · 暗弃 ${ct.unknownDiscards}` : ''}`;
    title.append(strong, meta);
    const grid = document.createElement('div');
    grid.className = 'observer-tracker-grid';
    for (const cat of ct.categories) {
      const cell = document.createElement('div');
      cell.className = 'observer-tracker-cell';
      const label = document.createElement('span');
      label.textContent = cat.label;
      const count = document.createElement('b');
      count.textContent =
        cat.templateTotal > 0 ? `${cat.seen}/${cat.templateTotal}` : String(cat.seen);
      cell.append(label, count);
      grid.append(cell);
    }
    trackerBox.append(title, grid);
  }
  const board = document.createElement('div');
  board.className = 'observer-board';
  for (const player of state.players) {
    const currentTurn = !state.ended && state.currentPlayerId === player.id;
    const seat = document.createElement('article');
    seat.className = `observer-seat${player.dead ? ' is-dead' : ''}${currentTurn ? ' is-active' : ''}`;
    const name = document.createElement('h3');
    name.textContent = player.nickname;
    const general = document.createElement('strong');
    general.className = 'observer-general';
    general.textContent = player.general;
    const status = document.createElement('p');
    status.textContent = `${player.identity} · ${player.dead ? '已阵亡' : currentTurn ? '当前回合' : '在场'}${player.linked ? ' · 连环' : ''}${player.turnedOver ? ' · 翻面' : ''}`;
    const control = document.createElement('p');
    control.className = 'observer-control';
    control.textContent = player.controller
      ? {
          human: '玩家手动操作',
          auto: state.ended ? '' : '玩家开启托管',
          reconnecting: '连接中断 · 等待重连',
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
  const children: HTMLElement[] = [heading];
  if (spotlight) children.push(spotlight);
  children.push(board);
  if (trackerBox) children.push(trackerBox);
  if (log === oldLog) {
    for (const node of Array.from(target.children)) if (node !== log) node.remove();
    log.before(...children);
  } else {
    target.replaceChildren(...children, log);
  }
  renderLog(log, view, state.logStart === undefined ? undefined : load);
}
