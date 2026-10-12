import type { ModeId, SurrenderState } from '../../../packages/shared/src/contracts.js';
import { element } from './ui.js';

/** Kept outside the rotated native canvas so confirmation stays readable. */
export function bindSurrenderDialog(mode: () => ModeId) {
  const button = document.createElement('button');
  button.id = 'match-surrender';
  button.type = 'button';
  button.className = 'button secondary';
  button.hidden = true;
  button.textContent = '投降';
  element('#match-share').after(button);
  const status = document.createElement('span');
  status.id = 'surrender-notice';
  status.className = 'hint';
  status.hidden = true;
  status.setAttribute('role', 'status');
  button.after(status);
  const dialog = document.createElement('dialog');
  dialog.id = 'surrender-dialog';
  dialog.className = 'surrender-dialog';
  dialog.setAttribute('aria-labelledby', 'surrender-title');
  dialog.innerHTML = `<div class="panel-heading"><h2 id="surrender-title"></h2><button id="surrender-close" class="close-dialog" type="button" aria-label="关闭投降窗口">×</button></div><p id="surrender-detail"></p><ul id="surrender-voters"></ul><p id="surrender-countdown" class="hint" role="status" aria-live="polite"></p><div class="surrender-actions"><button id="surrender-confirm" class="button primary" type="button"></button><button id="surrender-reject" class="button secondary" type="button">继续游戏</button></div><p class="hint">投票期间牌局继续。离线、托管或未点击均不算同意；30秒未通过即取消。发起后60秒才能再次发起。</p>`;
  element('#match-panel').after(dialog);
  const find = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>(id)!;
  const confirm = find<HTMLButtonElement>('#surrender-confirm');
  const reject = find<HTMLButtonElement>('#surrender-reject');
  const rules = dialog.lastElementChild as HTMLElement;
  let state: SurrenderState | null = null;
  let matchId: string | null = null;
  let enabled = false;
  let connected = true;
  let pending = false;
  let voteDeadline = 0;
  let cooldownDeadline = 0;
  let seenEpoch = '';
  let previousVote = '';
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastNotice = '';
  const close = () => dialog.close();
  const send = (action: 'request' | 'approve' | 'reject') => {
    const frame = document.querySelector<HTMLIFrameElement>('#game-frame');
    if (!enabled || !connected || pending || !matchId || !frame?.contentWindow) return;
    pending = true;
    frame.contentWindow.postMessage(
      { type: 'party-surrender-action', matchId, action, epoch: state?.vote?.epoch ?? '' },
      location.origin,
    );
    render();
  };
  const render = () => {
    const vote = state?.vote;
    const end = state?.kind === 'end';
    const duel = mode() === 'duel';
    rules.hidden = duel;
    const cooldown = Math.max(0, Math.ceil((cooldownDeadline - performance.now()) / 1000));
    button.hidden = !enabled || !state?.available;
    button.textContent = vote ? '查看结束投票' : end ? '提前结束' : '投降';
    button.disabled = !connected || pending;
    find('#surrender-title').textContent = vote
      ? end
        ? '提前结束投票'
        : '本方投降投票'
      : end
        ? '提前结束这局？'
        : '确认本方认输？';
    find('#surrender-detail').textContent = vote
      ? `${vote.initiator} 发起${end ? '提前结束' : '本方认输'}。${end ? '须所有真人同意，结束后不判胜负。' : '须本方所有存活真人同意，AI自动同意；通过后对方获胜。'}`
      : end
        ? '身份局须所有真人（含已阵亡玩家）明确同意。通过后本局结束，不判胜负，不需要公开身份来组队投票。'
        : duel
          ? '确认后本局立即结束，你将认输，对方获胜。'
          : '须本方所有存活真人同意，AI自动同意。通过后本方失败、对方获胜。';
    find('#surrender-voters').replaceChildren(
      ...(vote?.participants ?? []).map((participant) => {
        const row = document.createElement('li');
        row.textContent = `${participant.nickname} · ${participant.approved ? '已同意' : '等待确认'}`;
        return row;
      }),
    );
    find('#surrender-countdown').textContent = pending
      ? '正在等待牌桌确认…'
      : !connected
        ? '连接尚未恢复，请先恢复牌桌。'
        : vote
          ? `剩余 ${Math.max(0, Math.ceil((voteDeadline - performance.now()) / 1000))} 秒${vote.voted ? ' · 你已同意，可选择继续游戏撤回本次投票' : vote.eligible ? ' · 请明确选择' : ' · 对方正在商议'}。`
          : cooldown
            ? `还需 ${cooldown} 秒才能再次发起。`
            : state?.notice || '';
    confirm.hidden = Boolean(vote && (!vote.eligible || vote.voted));
    confirm.textContent = vote
      ? end
        ? '同意结束'
        : '同意投降'
      : end
        ? '发起结束投票'
        : duel
          ? '确认投降'
          : '发起投降投票';
    confirm.disabled =
      !enabled || !state?.available || !connected || pending || (!vote && cooldown > 0);
    reject.textContent = vote?.eligible ? '不同意，继续游戏' : '继续游戏';
    reject.disabled = pending || (Boolean(vote?.eligible) && !connected);
  };
  const open = () => {
    render();
    if (!dialog.open) dialog.showModal();
  };
  button.onclick = open;
  find('#surrender-close').onclick = close;
  confirm.onclick = () => send(state?.vote ? 'approve' : 'request');
  reject.onclick = () => {
    if (state?.vote?.eligible) send('reject');
    else close();
  };
  const interval = setInterval(() => {
    if (dialog.open) render();
  }, 500);
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(interval);
      clearTimeout(noticeTimer);
    },
    { once: true },
  );
  return {
    context(id: string | null, available: boolean, isConnected: boolean) {
      if (id !== matchId) {
        state = null;
        seenEpoch = '';
        previousVote = '';
        pending = false;
        lastNotice = '';
        status.hidden = true;
        clearTimeout(noticeTimer);
        close();
      }
      matchId = id;
      enabled = available;
      connected = isConnected;
      if (!enabled) close();
      render();
      if (enabled && state?.vote?.eligible && state.vote.epoch !== seenEpoch) {
        seenEpoch = state.vote.epoch;
        open();
      }
    },
    update(next: SurrenderState) {
      state = next;
      pending = false;
      cooldownDeadline = performance.now() + next.cooldownMs;
      voteDeadline = performance.now() + (next.vote?.remainingMs ?? 0);
      const epoch = next.vote?.epoch ?? '';
      if (previousVote && !epoch) close();
      previousVote = epoch;
      if (next.notice && next.notice !== lastNotice) {
        lastNotice = next.notice;
        status.textContent = next.notice;
        status.hidden = false;
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => {
          status.hidden = true;
        }, 10000);
      }
      render();
      if (enabled && next.vote?.eligible && epoch !== seenEpoch) {
        seenEpoch = epoch;
        open();
      }
    },
  };
}
