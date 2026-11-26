// SPDX-License-Identifier: GPL-3.0-only
import type {
  IdentityCounts,
  PublicCardTrackerSnapshot,
} from '../../../packages/shared/src/contracts.js';
import { element } from './ui.js';
import { ZIBAI_ICONS } from './zibai-theme.js';

type PublicSummary = {
  identityCounts?: IdentityCounts | null;
  actions?: { sequence: number; text: string }[];
  cardTracker?: PublicCardTrackerSnapshot;
};

const SUIT_SYMBOL: Record<string, string> = {
  spade: '♠',
  heart: '♥',
  club: '♣',
  diamond: '♦',
  none: '',
};

const RANK_TEXT = (n: number | null): string =>
  n == null ? '' : ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[n] ?? String(n));

/** Native AI control, public action ticker, and privacy-safe public card tracker drawer. */
export function bindMatchExperience() {
  const button = document.createElement('button');
  button.id = 'match-auto';
  button.className = 'button secondary';
  button.type = 'button';
  button.hidden = true;
  button.textContent = '主动托管';
  button.setAttribute('aria-pressed', 'false');
  element('#match-share').before(button);

  const trackerToggle = document.createElement('button');
  trackerToggle.id = 'match-tracker-toggle';
  trackerToggle.className = 'button secondary tracker-toggle-btn';
  trackerToggle.type = 'button';
  trackerToggle.hidden = true;
  trackerToggle.setAttribute('aria-expanded', 'false');
  trackerToggle.setAttribute('aria-controls', 'match-card-tracker');
  trackerToggle.innerHTML = `${ZIBAI_ICONS.tracker}<span>公开记牌器</span>`;
  element('#match-share').before(trackerToggle);

  const strip = document.createElement('section');
  strip.id = 'match-experience';
  strip.className = 'match-experience';
  strip.hidden = true;
  strip.innerHTML =
    '<span id="match-identities" hidden></span><details id="match-actions"><summary>最近动作<span id="match-last-action">等待出牌</span></summary><ol aria-label="最近三条公开动作"></ol></details><span id="match-control-state" role="status"></span>';
  element('.match-toolbar').after(strip);

  // Public card tracker scroll sits inside #game-frame-container so it rotates cleanly
  // with the portrait-to-landscape WeChat table container without extra coordinate math.
  const drawer = document.createElement('aside');
  drawer.id = 'match-card-tracker';
  drawer.className = 'party-tracker-drawer';
  drawer.hidden = true;
  drawer.setAttribute('aria-label', '公开记牌器');
  drawer.innerHTML = `
    <div class="tracker-rod top" aria-hidden="true"></div>
    <div class="tracker-scroll-body">
      <header class="tracker-header">
        <div>
          <strong id="tracker-title">公开记牌器</strong>
          <small id="tracker-meta">等待牌堆同步…</small>
        </div>
        <button id="tracker-close" type="button" class="tracker-close-btn" aria-label="收起公开记牌器">收起</button>
      </header>
      <div id="tracker-shuffle-note" class="tracker-shuffle-note" hidden></div>
      <div id="tracker-categories" class="tracker-categories"></div>
      <div class="tracker-recent-wrap">
        <span class="tracker-recent-title">最近公开明牌</span>
        <div id="tracker-recent" class="tracker-recent-list"></div>
      </div>
      <p class="tracker-privacy-note">仅统计本局已公开弃置与亮出展示的牌面，严守暗手牌与牌堆顺序隐私。</p>
    </div>
    <div class="tracker-rod bottom" aria-hidden="true"></div>`;
  const board = element('#game-frame-container');
  board.append(drawer);

  const counts = strip.querySelector<HTMLElement>('#match-identities')!;
  const actions = strip.querySelector<HTMLOListElement>('ol')!;
  const lastAction = strip.querySelector<HTMLElement>('#match-last-action')!;
  const status = strip.querySelector<HTMLElement>('#match-control-state')!;
  const trackerTitle = drawer.querySelector<HTMLElement>('#tracker-title')!;
  const trackerMeta = drawer.querySelector<HTMLElement>('#tracker-meta')!;
  const trackerShuffle = drawer.querySelector<HTMLElement>('#tracker-shuffle-note')!;
  const trackerCats = drawer.querySelector<HTMLElement>('#tracker-categories')!;
  const trackerRecent = drawer.querySelector<HTMLElement>('#tracker-recent')!;

  let matchId: string | null = null;
  let available = false,
    active = false,
    automatic = false,
    pending = false,
    ended = false,
    trackerOpen = false;
  let latestTracker: PublicCardTrackerSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function dockTracker(): void {
    drawer.style.removeProperty('top');
    drawer.style.removeProperty('max-height');
    const native = board.querySelector('iframe')?.contentDocument;
    if (!native || drawer.hidden) return;
    const width = drawer.offsetWidth;
    // Use the inner frame's coordinates. They stay unrotated even when the
    // outer WeChat table is rotated as a single surface.
    const left = (board.clientWidth - width) / 2 - 6;
    const right = left + width + 12;
    const blocking = Array.from(
      native.querySelectorAll(
        '#arena > .player, .party-seat-status[data-docked], #me .handcards .card, #control > .control:not(.removing)',
      ),
    )
      .flatMap((node) => {
        const visible =
          node.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ??
          native.defaultView?.getComputedStyle(node).visibility === 'visible';
        if (!visible) return [];
        const box = node.getBoundingClientRect();
        return box.right > left && box.left < right && box.width && box.height ? [box] : [];
      })
      .sort((a, b) => a.top - b.top);
    let start = 8;
    const gaps: { top: number; height: number }[] = [];
    for (const box of blocking) {
      if (box.top - 5 > start) gaps.push({ top: start, height: box.top - 5 - start });
      start = Math.max(start, box.bottom + 5);
    }
    gaps.push({ top: start, height: board.clientHeight - 8 - start });
    const limit = board.clientHeight * (board.clientHeight <= 440 ? 0.55 : 0.52);
    const gap =
      gaps.find((item) => item.height >= limit) ?? gaps.sort((a, b) => b.height - a.height)[0];
    if (gap && gap.height >= 56) {
      drawer.style.top = `${gap.top}px`;
      drawer.style.maxHeight = `${Math.min(gap.height, limit)}px`;
    }
  }
  const trackerLayout = new ResizeObserver(dockTracker);
  trackerLayout.observe(board);

  function renderTracker(): void {
    const hasTracker = Boolean(matchId && available && latestTracker);
    trackerToggle.hidden = !hasTracker;
    drawer.hidden = !hasTracker || !trackerOpen;
    trackerToggle.setAttribute('aria-expanded', String(!drawer.hidden));
    trackerToggle.classList.toggle('is-active', !drawer.hidden);
    if (!latestTracker) return;

    trackerTitle.textContent = `公开记牌 · ${latestTracker.pileName}`;
    trackerMeta.textContent = `余牌 ${latestTracker.deckCount} · 已公开 ${latestTracker.knownPublicCount} 张`;

    const flags: string[] = [];
    if (latestTracker.shuffledCount > 0)
      flags.push(`牌堆已洗牌 ${latestTracker.shuffledCount} 次，计数为累计已公开牌面`);
    if (latestTracker.unknownDiscards > 0)
      flags.push(`另有 ${latestTracker.unknownDiscards} 张暗弃牌未公开`);
    trackerShuffle.hidden = flags.length === 0;
    trackerShuffle.textContent = flags.join('；');

    trackerCats.replaceChildren();
    for (const item of latestTracker.categories) {
      const row = document.createElement('div');
      row.className = 'tracker-row';
      const top = document.createElement('div');
      top.className = 'tracker-row-top';
      const name = document.createElement('span');
      name.textContent = item.label;
      const num = document.createElement('b');
      num.textContent =
        item.templateTotal > 0 ? `${item.seen} / ${item.templateTotal}` : String(item.seen);
      top.append(name, num);
      const bar = document.createElement('div');
      bar.className = 'tracker-bar';
      const fill = document.createElement('i');
      const pct =
        item.templateTotal > 0
          ? Math.min(100, Math.round((item.seen / item.templateTotal) * 100))
          : 0;
      fill.style.width = `${pct}%`;
      bar.append(fill);
      row.append(top, bar);
      trackerCats.append(row);
    }

    trackerRecent.replaceChildren();
    const recent = latestTracker.recentRevealed.slice(-8).reverse();
    if (!recent.length) {
      const empty = document.createElement('span');
      empty.className = 'tracker-empty';
      empty.textContent = '暂无公开明牌';
      trackerRecent.append(empty);
    } else {
      for (const card of recent) {
        const chip = document.createElement('span');
        const red = card.suit === 'heart' || card.suit === 'diamond';
        chip.className = `tracker-card-chip${red ? ' is-red' : ''}`;
        chip.textContent = `${SUIT_SYMBOL[card.suit] ?? ''}${RANK_TEXT(card.number)} ${card.cardName}`;
        chip.title = `${card.actor ? `${card.actor} · ` : ''}${card.action}`;
        trackerRecent.append(chip);
      }
    }
  }

  function render(): void {
    strip.hidden = !matchId || !available;
    button.hidden = !matchId || !available || ended;
    button.disabled = !active || pending || ended;
    button.textContent = pending ? '正在切换…' : automatic ? '恢复手动操作' : '主动托管';
    button.setAttribute('aria-pressed', String(automatic));
    button.setAttribute('aria-busy', String(pending));
    renderTracker();
  }

  trackerToggle.onclick = () => {
    trackerOpen = !trackerOpen;
    renderTracker();
    dockTracker();
  };
  function closeTracker() {
    if (!trackerOpen) return;
    trackerOpen = false;
    renderTracker();
  }
  drawer.querySelector<HTMLButtonElement>('#tracker-close')!.onclick = () => {
    trackerOpen = false;
    renderTracker();
  };

  button.onclick = () => {
    const frame = document.querySelector<HTMLIFrameElement>('#game-frame');
    if (!active || ended || pending || !frame?.contentWindow) return;
    pending = true;
    status.textContent = '正在确认操作状态…';
    render();
    frame.contentWindow.postMessage(
      { type: automatic ? 'party-manual' : 'party-auto', matchId },
      location.origin,
    );
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = false;
      status.textContent = '操作状态尚未确认，请检查连接后重试。';
      render();
    }, 8000);
  };

  window.addEventListener('message', (event) => {
    const frame = document.querySelector<HTMLIFrameElement>('#game-frame');
    if (
      !matchId ||
      !available ||
      event.origin !== location.origin ||
      event.source !== frame?.contentWindow ||
      event.data?.matchId !== matchId
    )
      return;
    if (event.data.type === 'party-native-ended') {
      clearControl();
      render();
    }
    if (event.data.type === 'party-tracker-dismiss') closeTracker();
    if (event.data.type === 'party-control') {
      automatic = !ended && event.data.auto === true;
      pending = false;
      clearTimeout(timer);
      status.textContent = automatic && active ? '原生 AI 正在替你操作' : '';
      render();
    }
    if (event.data.type !== 'party-public-summary') return;
    const summary = event.data.summary as PublicSummary;
    if (!summary || typeof summary !== 'object') return;
    const roles = summary.identityCounts;
    counts.hidden =
      !roles ||
      !['zhu', 'zhong', 'fan', 'nei'].every(
        (role) =>
          Number.isSafeInteger(roles[role as keyof IdentityCounts]) &&
          roles[role as keyof IdentityCounts] >= 0 &&
          roles[role as keyof IdentityCounts] <= 8,
      );
    counts.textContent = counts.hidden
      ? ''
      : `剩余身份 · 主 ${roles!.zhu} 忠 ${roles!.zhong} 反 ${roles!.fan} 内 ${roles!.nei}`;
    counts.title = '开局身份人数减去已公开的阵亡身份，不显示在场角色的隐藏身份';
    if (Array.isArray(summary.actions)) {
      actions.replaceChildren();
      for (const item of summary.actions.slice(-3)) {
        if (!Number.isSafeInteger(item.sequence) || typeof item.text !== 'string') continue;
        const row = document.createElement('li');
        row.value = item.sequence;
        row.textContent = item.text.slice(0, 500);
        actions.append(row);
      }
      lastAction.textContent = actions.lastElementChild?.textContent ?? '等待出牌';
    }
    if (summary.cardTracker && typeof summary.cardTracker === 'object') {
      latestTracker = summary.cardTracker;
      renderTracker();
    }
  });

  function clearControl() {
    ended = true;
    automatic = pending = false;
    clearTimeout(timer);
    status.textContent = '';
    status.hidden = true;
  }
  window.addEventListener(
    'pagehide',
    () => {
      clearTimeout(timer);
      trackerLayout.disconnect();
    },
    { once: true },
  );
  return {
    context(id: string | null, playable: boolean, supported: boolean, finished: boolean) {
      if (id !== matchId) {
        ended = automatic = false;
        status.hidden = false;
        pending = false;
        trackerOpen = false;
        latestTracker = null;
        clearTimeout(timer);
        status.textContent = '';
        counts.hidden = true;
        actions.replaceChildren();
        lastAction.textContent = '等待出牌';
      }
      matchId = id;
      active = playable;
      available = supported;
      if (finished) clearControl();
      if (!active) {
        pending = false;
        clearTimeout(timer);
        status.textContent = '';
      }
      render();
    },
  };
}
