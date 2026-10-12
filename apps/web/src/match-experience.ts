import type { IdentityCounts } from '../../../packages/shared/src/contracts.js';
import { element } from './ui.js';

type PublicSummary = {
  identityCounts?: IdentityCounts | null;
  actions?: { sequence: number; text: string }[];
};

/** Native AI control and a small, persistent view of already public actions. */
export function bindMatchExperience() {
  const button = document.createElement('button');
  button.id = 'match-auto';
  button.className = 'button secondary';
  button.type = 'button';
  button.hidden = true;
  button.textContent = '主动托管';
  button.setAttribute('aria-pressed', 'false');
  element('#match-share').before(button);
  const strip = document.createElement('section');
  strip.id = 'match-experience';
  strip.className = 'match-experience';
  strip.hidden = true;
  strip.innerHTML =
    '<span id="match-identities" hidden></span><details id="match-actions"><summary>最近动作<span id="match-last-action">等待出牌</span></summary><ol aria-label="最近三条公开动作"></ol></details><span id="match-control-state" role="status"></span>';
  element('.match-toolbar').after(strip);
  const counts = strip.querySelector<HTMLElement>('#match-identities')!;
  const actions = strip.querySelector<HTMLOListElement>('ol')!;
  const lastAction = strip.querySelector<HTMLElement>('#match-last-action')!;
  const status = strip.querySelector<HTMLElement>('#match-control-state')!;
  let matchId: string | null = null;
  let available = false,
    active = false,
    automatic = false,
    pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function render(): void {
    strip.hidden = !matchId || !available;
    button.hidden = !matchId || !available;
    button.disabled = !active || pending;
    button.textContent = pending ? '正在切换…' : automatic ? '恢复手动操作' : '主动托管';
    button.setAttribute('aria-pressed', String(automatic));
    button.setAttribute('aria-busy', String(pending));
  }
  button.onclick = () => {
    const frame = document.querySelector<HTMLIFrameElement>('#game-frame');
    if (!active || pending || !frame?.contentWindow) return;
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
    if (event.data.type === 'party-control') {
      automatic = event.data.auto === true;
      pending = false;
      clearTimeout(timer);
      status.textContent = automatic ? '原生 AI 正在替你操作' : '';
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
  });
  window.addEventListener('pagehide', () => clearTimeout(timer), { once: true });
  return {
    context(id: string | null, playable: boolean, supported: boolean) {
      if (id !== matchId) {
        automatic = false;
        pending = false;
        clearTimeout(timer);
        status.textContent = '';
        counts.hidden = true;
        actions.replaceChildren();
        lastAction.textContent = '等待出牌';
      }
      matchId = id;
      active = playable;
      available = supported;
      render();
    },
  };
}
