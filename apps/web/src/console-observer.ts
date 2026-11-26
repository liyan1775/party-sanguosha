import type {
  ConsoleRoom,
  ObserverLogPage,
  ObserverState,
} from '../../../packages/shared/src/contracts.js';
import { patchAttr, patchHidden, patchText } from './console-dom.js';
import { api } from './ui.js';

export const consoleObserverMarkup = `<section id="observer-view" aria-label="公开观战">
  <p id="console-observer-empty" class="hint">开局后可在这里看牌桌与公开记录。</p>
  <div id="console-observer-main" hidden>
    <p class="observer-round"></p>
    <div class="observer-board"></div>
    <section class="observer-tracker" aria-label="公开记牌统计" hidden>
      <div class="observer-tracker-head"><strong></strong><span></span></div>
      <div class="observer-tracker-grid"></div>
    </section>
    <section class="observer-log">
      <h3></h3>
      <button type="button" class="button secondary observer-earlier" hidden>查看更早记录</button>
      <button type="button" class="button secondary observer-retry" hidden>重试读取缺失记录</button>
      <p class="hint"></p>
      <ol class="observer-recent" aria-label="本局公开事件记录"></ol>
    </section>
  </div>
</section>`;

export function publicSpotlight(state: ObserverState | null): string {
  const recent = state?.recent ?? [];
  return (
    [...recent]
      .reverse()
      .find((line) =>
        /造成.*点.*伤害|阵亡|发动了|使用了【(南蛮入侵|万箭齐发|桃园结义|决斗|过河拆桥|顺手牵羊|火攻|杀|雷杀|火杀)】/.test(
          line,
        ),
      ) ??
    recent.at(-1) ??
    ''
  );
}

type LogView = {
  code: string;
  matchId: string | null;
  entries: Map<number, string>;
  total: number;
  first: number;
  paged: boolean;
  busy: boolean;
  error: string;
};

export function createConsoleObserver(target: HTMLElement) {
  const find = <T extends HTMLElement = HTMLElement>(selector: string) =>
    target.querySelector<T>(selector)!;
  const empty = find('#console-observer-empty');
  const main = find('#console-observer-main');
  const board = find('.observer-board');
  const round = find('.observer-round');
  const tracker = find('.observer-tracker');
  const trackerGrid = find('.observer-tracker-grid');
  const trackerTitle = find('.observer-tracker-head strong');
  const trackerMeta = find('.observer-tracker-head span');
  const log = find('.observer-log');
  const heading = find('.observer-log h3');
  const hint = find('.observer-log .hint');
  const list = find<HTMLOListElement>('.observer-recent');
  const earlier = find<HTMLButtonElement>('.observer-earlier');
  const retry = find<HTMLButtonElement>('.observer-retry');
  const rows = new Map<number, HTMLLIElement>();
  const seats = new Map<string, HTMLElement>();
  const categories = new Map<string, HTMLElement>();
  let view: LogView | undefined;
  let firstRow = 1;
  let middleGap: number | undefined;

  function patchJournal(scrollToStart = false) {
    if (!view) return;
    const position = list.scrollTop;
    const atEnd = list.scrollHeight - list.clientHeight - position < 30;
    patchText(heading, `${view.paged ? '本局公开记录' : '最近公开动作'} · ${view.total} 条`);
    for (const [sequence, node] of rows) {
      if (view.entries.has(sequence)) continue;
      node.remove();
      rows.delete(sequence);
    }
    const sequences = [...view.entries.keys()].sort((left, right) => left - right);
    firstRow = sequences[0] ?? view.total + 1;
    middleGap = sequences.find(
      (sequence, index) => index > 0 && sequence > sequences[index - 1]! + 1,
    );
    let next: ChildNode | null = null;
    for (let index = sequences.length - 1; index >= 0; index--) {
      const sequence = sequences[index]!;
      let row = rows.get(sequence);
      if (!row) {
        row = document.createElement('li');
        row.value = sequence;
        rows.set(sequence, row);
        list.insertBefore(row, next);
      }
      patchText(row, view.entries.get(sequence)!);
      next = row;
    }
    if (list.clientHeight)
      list.scrollTop = scrollToStart ? 0 : atEnd ? list.scrollHeight : position;

    const hasEarlier = view.paged && Boolean(view.matchId) && firstRow > view.first;
    patchHidden(earlier, !hasEarlier && document.activeElement !== earlier);
    patchAttr(earlier, 'aria-disabled', String(!hasEarlier || view.busy));
    patchText(earlier, !hasEarlier ? '已到本局开头' : view.busy ? '正在读取…' : '查看更早记录');
    const canRetry = Boolean(middleGap && view.error);
    patchHidden(retry, !canRetry && document.activeElement !== retry);
    patchAttr(retry, 'aria-disabled', String(!canRetry || view.busy));
    patchText(
      hint,
      view.error ||
        (view.first > 1
          ? '本局超过 10000 条，最早记录已释放；下方编号保留原顺序。'
          : hasEarlier
            ? '按发生顺序显示，点击「查看更早记录」可回看本局开头。'
            : '按发生顺序记录；暗手牌只显示数量，私人选择不展示。'),
    );
    if (middleGap && !view.busy && !view.error && view.paged && view.matchId)
      void readPage(middleGap, false);
  }

  function prune(journal: LogView) {
    for (const sequence of journal.entries.keys())
      if (sequence < journal.first) journal.entries.delete(sequence);
  }

  async function readPage(before: number, scrollToStart: boolean) {
    const journal = view;
    if (!journal?.matchId || !journal.paged || journal.busy || before <= journal.first) return;
    journal.busy = true;
    journal.error = '';
    patchJournal();
    try {
      const page = await api<ObserverLogPage>(
        `/api/console/rooms/${encodeURIComponent(journal.code)}/log?match=${encodeURIComponent(journal.matchId)}&before=${before}`,
      );
      if (view !== journal) return;
      if (page.matchId !== journal.matchId) throw new Error('牌局已变更，记录暂未同步。');
      const added = page.entries.some((entry) => !journal.entries.has(entry.sequence));
      for (const entry of page.entries) journal.entries.set(entry.sequence, entry.text);
      journal.total = Math.max(journal.total, page.total);
      journal.first = Math.max(journal.first, page.first);
      prune(journal);
      if (!added && before > journal.first) journal.error = '记录暂未同步，请重试读取。';
    } catch (error) {
      journal.error = error instanceof Error ? error.message : '读取记录失败，请重试。';
    } finally {
      journal.busy = false;
      if (view === journal) patchJournal(scrollToStart && !journal.error);
    }
  }

  earlier.addEventListener('click', () => {
    if (earlier.getAttribute('aria-disabled') !== 'true') void readPage(firstRow, true);
  });
  retry.addEventListener('click', () => {
    if (middleGap && retry.getAttribute('aria-disabled') !== 'true')
      void readPage(middleGap, false);
  });

  function patchPublicBoard(state: ObserverState) {
    const active = new Set(state.players.map((player) => player.id));
    for (const [id, node] of seats) {
      if (active.has(id)) continue;
      node.remove();
      seats.delete(id);
    }
    for (const player of state.players) {
      let seat = seats.get(player.id);
      if (!seat) {
        seat = document.createElement('article');
        seat.className = 'observer-seat';
        seat.innerHTML =
          '<h3></h3><strong class="observer-general"></strong><p></p><p class="observer-control"></p><p></p><p></p><p></p>';
        board.append(seat);
        seats.set(player.id, seat);
      }
      const current = !state.ended && state.currentPlayerId === player.id;
      seat.classList.toggle('is-active', current);
      seat.classList.toggle('is-dead', player.dead);
      const labels = [
        player.nickname,
        player.general,
        `${player.identity} · ${player.dead ? '已阵亡' : current ? '当前回合' : '在场'}${player.linked ? ' · 连环' : ''}${player.turnedOver ? ' · 翻面' : ''}`,
        player.controller
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
          : '',
        player.maxHp
          ? `体力 ${player.hp} / ${player.maxHp}${player.armor ? ` · 护甲 ${player.armor}` : ''} · 手牌 ${player.handCount} 张`
          : '等待选将与发牌',
        `装备：${player.equipment.join('、') || '无'}`,
        `判定区：${player.judgments.join('、') || '无'}`,
      ];
      labels.forEach((label, index) => patchText(seat!.children[index] as HTMLElement, label));
      const badge = seat.querySelector<HTMLElement>('.observer-gift-combo');
      const combo = state.giftCombos?.find(({ targetId }) => targetId === player.id);
      const remaining = combo ? combo.at + 3500 - Date.now() : 0;
      if (!combo || remaining <= 0) {
        badge?.remove();
      } else if (badge?.dataset.at !== String(combo.at)) {
        badge?.remove();
        const next = document.createElement('span');
        next.className = 'observer-gift-combo';
        next.dataset.at = String(combo.at);
        if (combo.count >= 5) next.dataset.high = 'true';
        next.textContent = `×${combo.count}`;
        next.setAttribute('aria-label', `互动连击 ${combo.count} 次`);
        seat.append(next);
        setTimeout(() => next.remove(), remaining);
      }
    }

    const counts = state.identityCounts;
    const dealt = state.players.length > 0 && state.players.every((player) => player.maxHp > 0);
    const stage = state.ended
      ? '本局已结束'
      : state.round
        ? `第 ${state.round} 轮`
        : dealt
          ? '已发牌'
          : '选将与发牌中';
    patchText(
      round,
      `${stage} · 公开视角${state.deckCount === undefined || state.cardTracker ? '' : ` · 牌堆剩余 ${state.deckCount} 张`}${counts ? ` · 剩余身份：主 ${counts.zhu} 忠 ${counts.zhong} 反 ${counts.fan} 内 ${counts.nei}` : ''}`,
    );
    const cards = state.cardTracker;
    patchHidden(tracker, !cards);
    if (!cards) return;
    patchText(trackerTitle, `公开记牌 · ${cards.pileName}`);
    patchText(
      trackerMeta,
      `牌堆余 ${cards.deckCount} 张 · 已公开 ${cards.knownPublicCount} 张${cards.shuffledCount ? ` · 已洗牌 ${cards.shuffledCount} 次` : ''}${cards.unknownDiscards ? ` · 暗弃 ${cards.unknownDiscards}` : ''}`,
    );
    const keys = new Set<string>(cards.categories.map(({ key }) => key));
    for (const [key, node] of categories) {
      if (keys.has(key)) continue;
      node.remove();
      categories.delete(key);
    }
    for (const category of cards.categories) {
      let cell = categories.get(category.key);
      if (!cell) {
        cell = document.createElement('div');
        cell.className = 'observer-tracker-cell';
        cell.innerHTML = '<span></span><b></b>';
        trackerGrid.append(cell);
        categories.set(category.key, cell);
      }
      patchText(cell.firstElementChild as HTMLElement, category.label);
      patchText(
        cell.lastElementChild as HTMLElement,
        category.templateTotal > 0
          ? `${category.seen}/${category.templateTotal}`
          : String(category.seen),
      );
    }
  }

  return (entry: ConsoleRoom | undefined) => {
    const state = entry?.observer;
    patchHidden(empty, Boolean(state));
    patchHidden(main, !state);
    if (!entry || !state) {
      view = undefined;
      return;
    }
    const { code, matchId } = entry.room;
    if (!view || view.code !== code || view.matchId !== matchId) {
      view = {
        code,
        matchId,
        entries: new Map(),
        total: 0,
        first: 1,
        paged: false,
        busy: false,
        error: '',
      };
      list.replaceChildren();
      rows.clear();
      log.dataset.matchId = matchId ?? '';
    }
    patchPublicBoard(state);
    view.paged = state.logStart !== undefined;
    if (!view.paged) view.entries.clear();
    for (const [offset, text] of state.recent.entries())
      view.entries.set((state.logStart ?? 1) + offset, text);
    view.total = view.paged
      ? Math.max(view.total, state.logTotal ?? state.recent.length)
      : state.recent.length;
    view.first = Math.max(view.first, state.logFirst ?? 1);
    prune(view);
    patchJournal();
  };
}
