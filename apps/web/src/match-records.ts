import type { ObserverLogPage } from '../../../packages/shared/src/contracts.js';
import { api, element } from './ui.js';
import { renderObserverLog } from './observer-view.js';

type HistoryPage = ObserverLogPage & { deckCount: number | null };

export function bindMatchRecords() {
  const button = document.createElement('button');
  button.id = 'match-records';
  button.className = 'button secondary';
  button.type = 'button';
  button.textContent = '本局记录';
  button.hidden = true;
  element('#match-share').before(button);
  const dialog = document.createElement('dialog');
  dialog.id = 'match-records-dialog';
  dialog.className = 'match-records-dialog';
  dialog.setAttribute('aria-labelledby', 'match-records-title');
  dialog.innerHTML =
    '<div class="panel-heading"><h2 id="match-records-title">本局记录</h2><button class="close-dialog" type="button" aria-label="关闭本局记录">×</button></div><p class="hint">已公开的展示牌、用牌、判定与技能过程可在这里回看。记录中的牌面是当时的信息，牌局仍在继续。</p><p id="match-records-error" class="message" role="status" hidden></p><section class="observer-log"></section>';
  element('#match-panel').after(dialog);
  const log = dialog.querySelector<HTMLElement>('.observer-log')!;
  const error = dialog.querySelector<HTMLElement>('#match-records-error')!;
  let matchId: string | null = null;
  let enabled = false;
  let loading = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    dialog.close();
    clearTimeout(timer);
  };
  const read = async (id: string, before?: number) => {
    const page = await api<HistoryPage>(
      `/engine/history/${id}${before ? `?before=${before}` : ''}`,
    );
    if (id !== matchId || page.matchId !== id)
      throw new Error('这份记录已属于上一局，请重新打开。');
    return page;
  };
  async function refresh(): Promise<void> {
    if (!matchId || loading || !enabled || !dialog.open) return;
    const id = matchId,
      current = generation;
    loading = true;
    try {
      const page = await read(id);
      if (current !== generation || !dialog.open) return;
      error.hidden = true;
      renderObserverLog(log, page, (before) => read(id, before));
    } catch (cause) {
      if (current === generation && dialog.open) {
        error.textContent = cause instanceof Error ? cause.message : '记录暂未同步，正在重试。';
        error.hidden = false;
      }
    } finally {
      if (current === generation) {
        loading = false;
        if (dialog.open) timer = setTimeout(() => void refresh(), 2000);
      }
    }
  }
  button.onclick = () => {
    if (!dialog.open) dialog.showModal();
    clearTimeout(timer);
    void refresh();
  };
  dialog.querySelector<HTMLButtonElement>('.close-dialog')!.onclick = close;
  dialog.addEventListener('close', () => clearTimeout(timer));
  window.addEventListener('pagehide', close, { once: true });
  return {
    context(id: string | null, available: boolean) {
      if (id !== matchId) {
        generation++;
        loading = false;
        log.replaceChildren();
        error.hidden = true;
        close();
      }
      matchId = id;
      enabled = available;
      button.hidden = !id || !available;
      if (!available) close();
    },
  };
}
