import type { RoomView } from '../../../packages/shared/src/contracts.js';
import { element } from './ui.js';

/** A single match surface; all decisions still go through the existing room/native controls. */
export function bindCollegeStage(end: HTMLButtonElement, vote: HTMLButtonElement) {
  const panel = element('#match-panel');
  const toolbar = element('.match-toolbar');
  const heading = document.createElement('div');
  heading.className = 'stage-heading';
  heading.hidden = true;
  heading.innerHTML = '<strong id="college-score"></strong><span id="college-progress"></span>';
  toolbar.prepend(heading);
  const role = document.createElement('span');
  role.id = 'stage-role';
  role.hidden = true;
  heading.after(role);
  const more = document.createElement('button');
  more.id = 'stage-more';
  more.type = 'button';
  more.className = 'button secondary';
  more.textContent = '更多';
  more.hidden = true;
  toolbar.append(more);
  const dialog = document.createElement('dialog');
  dialog.id = 'stage-tools';
  dialog.setAttribute('aria-labelledby', 'stage-tools-title');
  dialog.innerHTML =
    '<div class="panel-heading"><h2 id="stage-tools-title">比赛工具</h2><button class="close-dialog" type="button" aria-label="关闭比赛工具">×</button></div><div class="stage-tools-grid"></div><div class="stage-tools-status"></div>';
  panel.after(dialog);
  const tools = dialog.querySelector<HTMLElement>('.stage-tools-grid')!;
  const diagnostics = dialog.querySelector<HTMLElement>('.stage-tools-status')!;
  const relocated: { node: HTMLElement; home: Comment; target: HTMLElement }[] = [];
  for (const selector of [
    '#match-sound',
    '.match-volume',
    '#match-share',
    '#match-records',
    '#match-restore',
    '#match-surrender',
    '#match-leave',
    '#owner-transfer-row',
    '#owner-claim-row',
  ]) {
    const node = element(selector),
      home = document.createComment('match tool');
    node.before(home);
    relocated.push({ node, home, target: tools });
  }
  for (const selector of ['#match-network', '#match-experience', '#surrender-notice']) {
    const node = element(selector),
      home = document.createComment('match status');
    node.before(home);
    relocated.push({ node, home, target: diagnostics });
  }
  tools.append(vote, end);
  const network = element('#match-network');
  const networkChanges = new MutationObserver(() => {
    const slow = network.classList.contains('slow-network');
    more.dataset.networkSlow = String(slow);
    more.title = slow ? (network.textContent ?? '网络较慢') : '比赛工具';
    more.setAttribute('aria-label', slow ? `更多比赛工具，${network.textContent}` : '更多比赛工具');
  });
  networkChanges.observe(network, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  window.addEventListener('pagehide', () => networkChanges.disconnect(), { once: true });
  more.onclick = () => dialog.showModal();
  dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  tools.addEventListener('click', (event) => {
    if ((event.target as Element).closest('button')) dialog.close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  const rest = document.createElement('section');
  rest.id = 'college-rest';
  rest.hidden = true;
  rest.innerHTML =
    '<div class="college-rest-card"><p class="stage-eyebrow">高校联赛练习</p><h2 id="college-rest-title"></h2><p id="college-rest-score"></p><p id="college-rest-next"></p><ul id="college-rest-players" aria-label="本场队伍与准备状态"></ul><div class="college-rest-actions"><button id="college-ready" class="button primary" type="button"></button><button id="college-start" class="button primary" type="button">开始下一局</button><button id="college-back" class="button secondary" type="button">回到房间设置</button></div><p id="college-rest-hint" role="status"></p><details id="college-results"><summary>本场赛果</summary><ol></ol></details></div>';
  element('#game-frame-container').append(rest);
  const ready = rest.querySelector<HTMLButtonElement>('#college-ready')!;
  const start = rest.querySelector<HTMLButtonElement>('#college-start')!;
  const back = rest.querySelector<HTMLButtonElement>('#college-back')!;
  ready.onclick = () => element<HTMLButtonElement>('#ready-button').click();
  start.onclick = () => element<HTMLButtonElement>('#start-button').click();
  back.onclick = () => end.click();
  let compact = false,
    rosterKey = '',
    resultsKey = '';
  function move(enabled: boolean) {
    if (enabled === compact) return;
    compact = enabled;
    for (const { node, home, target } of relocated)
      if (enabled) target.append(node);
      else home.after(node);
    if (!enabled) dialog.close();
  }
  return {
    context(
      room: RoomView,
      memberId: string | null,
      native: boolean,
      standby: boolean,
      active: boolean,
    ) {
      const college = room.settings.mode === 'college';
      const enabled = active && (college || (!!room.doudizhu && !room.matchId));
      move(enabled);
      panel.classList.toggle('practice-stage', enabled);
      panel.classList.toggle('college-stage', enabled && college);
      panel.classList.toggle('stage-finished', enabled && room.phase === 'finished');
      heading.hidden = role.hidden = more.hidden = !enabled;
      element('#match-label').hidden = enabled;
      element('#orientation-hint').classList.toggle('stage-secondary', enabled);
      const s = room.series,
        owner = room.ownerId === memberId;
      const resting =
        enabled &&
        college &&
        !!s &&
        !native &&
        !standby &&
        ['waiting', 'finished'].includes(room.phase);
      rest.hidden = !resting;
      end.hidden =
        !enabled || !college || !owner || !s || !['waiting', 'finished'].includes(room.phase);
      element('#game-frame-mount').hidden = enabled && !native;
      element('#match-sound').hidden = enabled && !native;
      element('.match-volume').hidden = enabled && !native;
      network.hidden = enabled && !native;
      if (enabled && !native) {
        element('#match-restore').hidden = true;
        more.dataset.networkSlow = 'false';
      }
      if (enabled && !native) element('#match-loading').hidden = true;
      const last = s?.results?.at(-1);
      if (!enabled) return;
      if (room.phase === 'finished') element('#match-auto').hidden = true;
      element('#finished-hint').hidden = true;
      element('#college-score').textContent = s
        ? `A ${s.scores[0]} : ${s.scores[1]} B`
        : '斗地主练习';
      const next = (s?.completedGames ?? 0) + (room.phase === 'finished' || resting ? 0 : 1);
      element('#college-progress').textContent = s
        ? `${s.format === 'quick' ? '快速' : '标准'} · ${room.matchFailure ? '本局中断 · 未计分' : s.finished ? '整场结束' : room.phase === 'finished' && last ? `本局${last.winner === 0 ? 'A' : 'B'}队 +${last.points} · ${s.completedGames}/${s.maxGames}局` : resting ? `已完成 ${s.completedGames}/${s.maxGames} 局` : `第 ${next}${next > s.maxGames ? '（加赛）' : `/${s.maxGames}`} 局`} · 抢${s.targetScore}分`
        : '先看候选 → 叫分 → 选将';
      const mine = room.players.find((p) => p.id === memberId);
      const actual = Object.entries(room.doudizhu?.controllers ?? {}).find(
        ([, id]) => id === memberId,
      )?.[0];
      const proxy = !!actual && actual !== memberId;
      const team = s?.teams[0].includes(memberId ?? '') ? 'A队' : 'B队';
      const automatic = element('#match-auto').getAttribute('aria-pressed') === 'true';
      role.textContent = resting
        ? `${team} · ${mine?.nickname ?? ''}`
        : standby
          ? `${team} · 本局待命`
          : actual
            ? `${college ? `${team} · ` : ''}${(room.doudizhu?.activeSeatIds.indexOf(actual) ?? -1) + 1}号位·${actual === room.doudizhu?.landlordId ? '地主' : '农民'}${proxy ? ' · 代理AI队友' : ''} · ${room.matchFailure ? '本局中断' : room.phase === 'finished' ? '本局结束' : automatic ? '托管中' : '你来操作'}`
            : `${college ? `${team} · ` : ''}赛前准备`;
      role.classList.toggle('is-proxy', proxy);
      role.classList.toggle('is-automatic', automatic && room.phase === 'playing');
      if (!resting || !s) return;
      rest.querySelector('#college-rest-title')!.textContent = s.finished
        ? `${s.winner === 0 ? 'A' : 'B'}队赢得整场`
        : '整场休息';
      rest.querySelector('#college-rest-score')!.textContent = room.matchFailure
        ? '本局中断 · 未计分'
        : last
          ? `第${last.game}局 · ${last.winner === 0 ? 'A' : 'B'}队 +${last.points}分`
          : s.completedGames
            ? `已完成 ${s.completedGames} 局`
            : '本场尚未计分';
      rest.querySelector('#college-rest-next')!.textContent = s.finished
        ? `共完成 ${s.completedGames} 局`
        : `下一局 ${room.players[s.firstBidIndex]?.nickname ?? '首叫席位'} 首叫${s.completedGames >= s.maxGames ? ' · 同分加赛' : ''}`;
      const roster = JSON.stringify(
        room.players.map((p, i) => [p.id, p.nickname, p.ready, p.online, i]),
      );
      if (roster !== rosterKey) {
        rosterKey = roster;
        const list = rest.querySelector('#college-rest-players')!;
        list.replaceChildren();
        for (const [i, p] of room.players.entries()) {
          const row = document.createElement('li');
          row.dataset.team = i % 2 ? 'b' : 'a';
          row.textContent = `${i % 2 ? 'B' : 'A'}${i + 1} ${p.nickname} · ${p.kind === 'bot' ? 'AI已准备' : !p.online ? '离线' : p.ready ? '已准备' : '未准备'}`;
          list.append(row);
        }
      }
      ready.hidden = start.hidden = s.finished;
      ready.textContent = mine?.ready ? '已准备 · 取消' : '准备下一局';
      ready.disabled = element<HTMLButtonElement>('#ready-button').disabled;
      start.hidden ||= !owner;
      start.disabled = element<HTMLButtonElement>('#start-button').disabled;
      back.hidden = !owner || !s.finished;
      rest.querySelector('#college-rest-hint')!.textContent = s.finished
        ? owner
          ? '回到房间可调整队伍与赛制。'
          : '等待房主结束本场练习。'
        : room.phase === 'finished'
          ? owner
            ? '请先进入休息区。'
            : '等待房主进入休息区；原队伍和比分保留。'
          : owner
            ? '全员准备后，由你开始下一局。'
            : '准备后等待房主开局。';
      if (room.phase === 'finished' && !owner) {
        ready.disabled = true;
        ready.textContent = '等待房主进入休息区';
      }
      const key = JSON.stringify(s.results ?? []);
      if (key !== resultsKey) {
        resultsKey = key;
        const list = rest.querySelector('#college-results ol')!;
        list.replaceChildren();
        for (const r of s.results ?? []) {
          const row = document.createElement('li');
          row.textContent = `第${r.game}局 · ${r.winner === 0 ? 'A' : 'B'}队 +${r.points}分`;
          list.append(row);
        }
      }
      rest.querySelector<HTMLElement>('#college-results')!.hidden = !s.results?.length;
    },
  };
}
