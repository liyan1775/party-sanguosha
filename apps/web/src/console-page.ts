// SPDX-License-Identifier: GPL-3.0-only
import {
  findMode,
  GENERAL_PRESETS,
  type ConsoleInfo,
  type ConsoleRoom,
  type PublicMatchSummary,
  type ServerInfo,
} from '../../../packages/shared/src/contracts.js';
import { patchAttr, patchHidden, patchText } from './console-dom.js';
import {
  consoleInvitesMarkup,
  consoleNetworkMarkup,
  createConsoleInvites,
} from './console-invites.js';
import {
  consoleObserverMarkup,
  createConsoleObserver,
  publicSpotlight,
} from './console-observer.js';
import { startEngineSupervisor } from './engine-supervisor.js';
import { renderMatchPosterDataUrl } from './party-poster.js';
import { stagePreferences, stageShell, type StageShell } from './stage-shell.js';
import { api, element, watchEvents } from './ui.js';

const phases = {
  waiting: '等待玩家',
  starting: '选将中',
  playing: '对局中',
  finished: '已结算',
  closed: '已关闭',
};
const routes = { local: '局域网', lan: '局域网直连', direct: '跨网络直连', internet: '公网' };

const roomsMarkup = `<section id="console-manage" class="return-console-panel return-console-rooms" aria-labelledby="console-rooms-title">
  <div class="return-console-panel-head">
    <h2 id="console-rooms-title">房间列表</h2>
    <div class="return-console-overview" aria-label="服务概况">
      <span><strong id="room-total">0 间</strong></span>
      <span><strong id="online-total">0 人</strong>在线</span>
      <span><strong id="match-total">0 局</strong>对局</span>
      <span id="slow-stat" hidden><strong id="slow-total">0 个</strong>较慢的连接</span>
    </div>
  </div>
  <div class="return-console-room-list">
    <ul id="room-list" class="room-list"></ul>
    <p id="empty-rooms" class="hint">朋友扫码开房后，牌桌会出现在这里。</p>
    <p id="console-status" class="hint" role="status">正在同步房间…</p>
  </div>
</section>`;

const manageMarkup = `<section id="console-manage-room" class="return-console-block return-console-manage-bar" aria-label="房间管理" hidden>
    <p id="console-room-settings" class="hint"></p>
    <div id="console-actions" class="return-console-actions">
      <button id="console-reset-room" class="button secondary" type="button" hidden></button>
      <button id="console-close-room" class="button secondary" type="button">关闭房间</button>
    </div>
    <section id="console-confirm" class="return-console-confirm" aria-label="确认房间操作" hidden>
      <p id="console-confirm-warning"></p>
      <div class="return-console-actions">
        <button id="console-confirm-cancel" class="button secondary" type="button" aria-describedby="console-confirm-warning">取消</button>
        <button id="console-confirm-apply" class="button primary" type="button" aria-describedby="console-confirm-warning">确认操作</button>
      </div>
    </section>
  </section>`;

const posterMarkup = `<section id="console-poster-panel" class="return-console-block return-console-poster" aria-label="聚会战绩海报" hidden>
  <p class="hint">本海报仅含公开战绩，不含暗手牌或邀请链接。</p>
  <p id="console-poster-error" class="hint" role="status" hidden></p>
  <div class="poster-preview-wrap" id="console-poster-preview" hidden>
    <img id="party-poster-img" alt="聚会战绩海报" />
  </div>
  <div class="poster-actions">
    <a id="party-poster-download" class="button primary" download="聚会战绩海报.png" hidden>下载高清 PNG</a>
  </div>
</section>`;

type RoomCommand = {
  room: ConsoleRoom['room'];
  method: 'POST' | 'DELETE';
  suffix: string;
  warning: string;
};

function resetLabel(room: ConsoleRoom['room']): string {
  if (room.shanhetu) return '结束征程并回房';
  if (room.phase === 'finished') return '回房准备下一局';
  return '结束对局并回房';
}

function ownerName(room: ConsoleRoom['room']): string {
  return room.players.find((player) => player.id === room.ownerId)?.nickname ?? '朋友';
}

function roomTitle(room: ConsoleRoom['room']): string {
  return `${ownerName(room)}的房间 · ${room.code}`;
}

function roomPhase(room: ConsoleRoom['room']): string {
  return room.shanhetu && room.phase === 'waiting' ? '山河图征程中' : phases[room.phase];
}

export function showServerPage(info: ServerInfo): void {
  const stage = stageShell(
    'console',
    '聚会三国杀 · 联机与观战',
    `<div class="return-console">
      <header class="return-console-head">
        <div class="return-console-brand">
          <span class="seal" aria-hidden="true">杀</span>
          <div>
            <h1>聚会三国杀 <span>· 联机与观战</span></h1>
            <p id="console-keepalive" class="return-console-badge" role="status"></p>
          </div>
        </div>
        ${stagePreferences()}
      </header>
      <div class="return-console-grid">
        <aside class="return-console-panel return-console-entry" aria-labelledby="console-entry-title">
          <h2 id="console-entry-title">联机扫码</h2>
          <p class="hint">同 Wi-Fi 或异地扫码，都能坐同一桌。</p>
          ${consoleInvitesMarkup}
          ${consoleNetworkMarkup}
          <span id="connection" class="connection" role="status">服务在线</span>
        </aside>
        <div class="return-console-tables">
          ${roomsMarkup}
          <section class="return-console-panel return-console-current" aria-labelledby="console-stage-kicker">
            <h2 id="console-stage-kicker">公开观战</h2>
            <p id="console-empty" class="hint">有房间后，在列表选择一桌即可查看席位与公开战况。</p>
            <div id="console-room" hidden>
              <header class="return-console-room-head">
                <h3 id="console-room-title"></h3>
                <span id="console-room-phase" class="tag"></span>
              </header>
              <div id="console-players" class="return-console-seats" aria-label="牌桌席位"></div>
              <section id="console-live" class="return-console-block return-console-live" hidden aria-label="当前回合">
                <h3>牌桌动向</h3>
                <p id="console-highlight"></p>
              </section>
              ${consoleObserverMarkup}
              <section id="console-mvp" class="return-console-block console-mvp-showcase" hidden aria-label="上局公开战绩">
                <p id="console-mvp-kicker" class="eyebrow"></p>
                <h3 id="console-winner"></h3>
                <div class="mvp-awards-grid" id="console-awards"></div>
              </section>
              <h3 id="console-no-result" hidden>本局已结算</h3>
              <div class="return-console-actions" id="console-award-actions" hidden>
                <button id="console-replay-awards" class="button secondary" type="button">回看上局颁奖</button>
                <button id="console-skip-awards" class="button secondary" type="button" hidden>跳过颁奖</button>
                <button id="console-poster" class="button primary mvp-poster-btn" type="button" aria-controls="console-poster-panel" aria-expanded="false">导出聚会战绩海报 PNG</button>
              </div>
              ${posterMarkup}
              ${manageMarkup}
            </div>
          </section>
        </div>
      </div>
    </div>`,
  );

  startEngineSupervisor();

  let rooms: ConsoleRoom[] = [];
  let selected = '';
  let roomRequest: Promise<void> | undefined;
  let entryRequest: Promise<void> | undefined;
  let stopped = false;
  let firstSnapshot = true;
  let roomSnapshotSignature = '';
  const seenHumans = new Map<string, Set<string>>();
  const announcedAwards = new Set<string>();
  let replayMatch = '';
  let playingAwards = '';
  let awardTimer: ReturnType<typeof setTimeout> | undefined;

  const confirmPane = element('#console-confirm');
  const cancelAction = element<HTMLButtonElement>('#console-confirm-cancel');
  const applyAction = element<HTMLButtonElement>('#console-confirm-apply');
  let pendingCommand: { command: RoomCommand; opener: HTMLButtonElement } | undefined;
  cancelAction.addEventListener('click', () => clearCommand(true));
  confirmPane.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && applyAction.getAttribute('aria-busy') !== 'true') {
      event.preventDefault();
      clearCommand(true);
    }
  });
  const poster = element<HTMLButtonElement>('#console-poster');
  const posterPanel = element('#console-poster-panel');
  let posterMatch = '';
  poster.addEventListener('click', preparePoster);
  const invites = createConsoleInvites(stage);
  const patchObserver = createConsoleObserver(element('#observer-view'));
  const seats = element('#console-players');
  const awards = element('#console-mvp');
  const skip = element<HTMLButtonElement>('#console-skip-awards');
  const seatCards: HTMLElement[] = [];
  const roomRows = new Map<string, { row: HTMLElement; button: HTMLButtonElement }>();
  let paintedAwards = '';

  const current = () => rooms.find(({ room }) => room.code === selected);
  element('#console-replay-awards').addEventListener('click', () => {
    const entry = current();
    const summary = entry?.room.lastMatchSummary;
    if (!summary || !entry) return;
    stage.sound.play('click');
    replayMatch = summary.matchId;
    renderCenter(entry);
    playAwards(summary.matchId);
  });
  skip.addEventListener('click', () => {
    if (!playingAwards && !replayMatch) return;
    stage.sound.play('click');
    element('#console-replay-awards').focus({ preventScroll: true });
    replayMatch = '';
    stopAwards();
    renderCenter(current());
  });

  function preparePoster() {
    const { room } = current() ?? {};
    const summary = room?.lastMatchSummary;
    if (!summary || !room) return;
    stage.sound.play('click');
    if (!posterPanel.hidden) {
      closePoster();
      return;
    }
    posterMatch = summary.matchId;
    posterPanel.hidden = false;
    poster.setAttribute('aria-expanded', 'true');
    const preview = element('#console-poster-preview');
    const errorBox = element('#console-poster-error');
    const image = element<HTMLImageElement>('#party-poster-img');
    const download = element<HTMLAnchorElement>('#party-poster-download');
    preview.hidden = download.hidden = errorBox.hidden = true;
    try {
      const dataUrl = renderMatchPosterDataUrl(summary, room.code);
      image.src = dataUrl;
      download.href = dataUrl;
      download.download = `聚会三国杀-${room.code}-战绩海报.png`;
      preview.hidden = download.hidden = false;
    } catch (error) {
      patchText(errorBox, error instanceof Error ? error.message : '海报生成失败，请重试。');
      errorBox.hidden = false;
    }
  }

  function closePoster() {
    posterMatch = '';
    patchHidden(posterPanel, true);
    patchAttr(poster, 'aria-expanded', 'false');
  }

  function stopAwards() {
    clearTimeout(awardTimer);
    if (playingAwards) awards.removeAttribute('data-celebrating');
    playingAwards = '';
    patchAttr(skip, 'aria-disabled', String(!replayMatch));
    patchHidden(skip, !replayMatch && document.activeElement !== skip);
  }

  function playAwards(matchId: string) {
    stopAwards();
    playingAwards = matchId;
    awards.dataset.celebrating = 'true';
    skip.hidden = false;
    skip.setAttribute('aria-disabled', 'false');
    awardTimer = setTimeout(stopAwards, 5000);
  }

  function patchAwards(summary: PublicMatchSummary) {
    if (summary.matchId === paintedAwards) return;
    paintedAwards = summary.matchId;
    patchText(element('#console-mvp-kicker'), `公开战绩 · 共 ${summary.rounds} 轮`);
    patchText(element('#console-winner'), summary.winnerLabel || '本局已结算');
    const items = summary.awards.slice(0, 4).map((award) => {
      const card = document.createElement('article');
      card.className = 'mvp-award-card';
      card.innerHTML = '<span class="mvp-award-title"></span><strong></strong><p></p>';
      patchText(card.querySelector('span')!, award.title);
      patchText(
        card.querySelector('strong')!,
        `${award.holderNickname}${award.generalName ? ` · ${award.generalName}` : ''}`,
      );
      patchText(card.querySelector('p')!, award.detail);
      return card;
    });
    element('#console-awards').replaceChildren(...items);
  }

  function patchStageSeats(
    room: ConsoleRoom['room'],
    arrivals: Set<string>,
    networks: ConsoleRoom['networks'],
    now: number,
  ) {
    const canRemove = room.phase === 'waiting' && !room.shanhetu;
    for (let index = 0; index < room.settings.playerCount; index++) {
      let card = seatCards[index];
      if (!card) {
        card = document.createElement('div');
        card.className = 'return-console-seat';
        card.innerHTML =
          '<span></span><strong></strong><small></small><button type="button" class="button subtle return-console-seat-remove" hidden>移除席位</button>';
        const seatCard = card;
        const removeButton = seatCard.querySelector<HTMLButtonElement>(
          '.return-console-seat-remove',
        )!;
        bindCommand(removeButton, () => {
          const activeRoom = current()?.room;
          const playerId = seatCard.dataset.playerId;
          const occupant = activeRoom?.players.find((item) => item.id === playerId);
          if (!activeRoom || !occupant || activeRoom.phase !== 'waiting' || activeRoom.shanhetu)
            return;
          return {
            room: activeRoom,
            method: 'DELETE',
            suffix: `/players/${encodeURIComponent(occupant.id)}`,
            warning: `移除「${occupant.nickname}」？若移除房主，房主会交接给下一位真人。`,
          };
        });
        seatCards.push(card);
        seats.append(card);
      }
      patchHidden(card, false);
      const player = room.players[index];
      const seatKey = player ? `${room.code}/${player.id}` : '';
      if (card.dataset.seatKey !== seatKey) {
        card.classList.remove('is-arriving');
        card.dataset.seatKey = seatKey;
      }
      card.dataset.playerId = player?.id ?? '';
      card.classList.toggle('console-player', Boolean(player));
      patchAttr(card, 'data-kind', player?.kind ?? 'empty');
      patchText(card.querySelector('span')!, `${index + 1} 号席`);
      patchText(
        card.querySelector('strong')!,
        player ? `${player.nickname}${player.id === room.ownerId ? ' · 房主' : ''}` : '空席',
      );
      const network = player ? networks.find((net) => net.playerId === player.id) : undefined;
      const recent = network && now - network.updatedAt < 30000;
      const returned =
        player && room.phase === 'finished' && room.returnedPlayerIds?.includes(player.id);
      patchText(
        card.querySelector('small')!,
        !player
          ? '等朋友入席'
          : player.kind === 'bot'
            ? '原生 AI'
            : !player.online
              ? '暂离'
              : `${returned ? '已回房' : player.ready ? '已准备' : '在线'}${recent ? ` · ${routes[network.route]} ${network.rtt ?? '—'}ms` : ''}`,
      );
      const removeButton = card.querySelector<HTMLButtonElement>('.return-console-seat-remove')!;
      const showRemove = Boolean(player) && canRemove;
      patchHidden(removeButton, !showRemove && document.activeElement !== removeButton);
      patchAttr(removeButton, 'aria-disabled', String(!showRemove));
      if (player?.kind === 'human' && arrivals.has(player.id)) {
        const arrivingCard = card;
        arrivingCard.classList.add('is-arriving');
        setTimeout(() => {
          if (arrivingCard.dataset.seatKey === seatKey)
            arrivingCard.classList.remove('is-arriving');
        }, 1700);
      }
    }
    for (const card of seatCards.slice(room.settings.playerCount)) patchHidden(card, true);
  }

  function renderCenter(entry: ConsoleRoom | undefined, arrivals = new Set<string>()) {
    patchHidden(element('#console-empty'), Boolean(entry));
    patchHidden(element('#console-room'), !entry);
    const room = entry?.room;
    const live = room?.phase === 'starting' || room?.phase === 'playing';
    const summary = live ? undefined : room?.lastMatchSummary;
    if (posterMatch && posterMatch !== summary?.matchId) closePoster();
    if (replayMatch !== summary?.matchId) replayMatch = '';
    const settled = room?.phase === 'finished';
    const showAwards = Boolean(summary);
    if (!showAwards || playingAwards !== summary?.matchId) stopAwards();
    const spotlight = live ? publicSpotlight(entry?.observer ?? null) : '';
    patchHidden(element('#console-live'), !spotlight);
    patchHidden(element('#console-no-result'), !settled || showAwards);
    patchHidden(seats, live || settled);
    patchHidden(awards, !showAwards);
    patchHidden(element('#console-award-actions'), !summary);
    if (!entry || !room) return;
    patchText(element('#console-room-title'), roomTitle(room));
    patchText(element('#console-room-phase'), roomPhase(room));
    if (showAwards && summary) {
      patchAwards(summary);
      if (settled && !announcedAwards.has(summary.matchId)) {
        announcedAwards.add(summary.matchId);
        playAwards(summary.matchId);
      }
    }
    if (spotlight) patchText(element('#console-highlight'), spotlight);
    if (!live && !settled) patchStageSeats(room, arrivals, entry.networks, Date.now());
  }

  function clearCommand(restore = false) {
    const opener = pendingCommand?.opener;
    pendingCommand = undefined;
    confirmPane.hidden = true;
    if (restore) {
      const target = opener?.getClientRects().length ? opener : roomRows.get(selected)?.button;
      target?.focus({ preventScroll: true });
    }
  }

  function bindCommand(button: HTMLButtonElement, getCommand: () => RoomCommand | undefined) {
    button.addEventListener('click', () => {
      if (
        applyAction.getAttribute('aria-busy') === 'true' ||
        button.getAttribute('aria-disabled') === 'true'
      )
        return;
      const command = getCommand();
      if (!command) return;
      stage.sound.play('click');
      pendingCommand = { command, opener: button };
      patchText(element('#console-confirm-warning'), command.warning);
      confirmPane.hidden = false;
      cancelAction.focus();
    });
  }

  runButton(stage, applyAction, async () => {
    const pending = pendingCommand;
    if (!pending) return;
    const { command } = pending;
    try {
      await api(
        `/api/console/rooms/${encodeURIComponent(command.room.code)}${command.suffix}`,
        command.method,
        undefined,
        { 'X-Party-Revision': String(command.room.revision) },
      );
      stage.toast('操作已完成。', true);
      stage.sound.play('success');
      if (roomRequest) await roomRequest;
      await refresh();
    } finally {
      if (pendingCommand === pending) clearCommand(true);
    }
  });

  function patchManagement(entry: ConsoleRoom | undefined) {
    const now = Date.now();
    const networks = rooms.flatMap(({ networks }) => networks);
    patchText(element('#room-total'), `${rooms.length} 间`);
    patchText(
      element('#online-total'),
      `${rooms.flatMap(({ room }) => room.players).filter((player) => player.kind === 'human' && player.online).length} 人`,
    );
    patchText(
      element('#match-total'),
      `${rooms.filter(({ room }) => room.phase === 'starting' || room.phase === 'playing').length} 局`,
    );
    const slowCount = networks.filter(
      (net) => now - net.updatedAt < 30000 && (net.unstable || (net.rtt ?? 0) >= 600),
    ).length;
    patchText(element('#slow-total'), `${slowCount} 个`);
    patchHidden(element('#slow-stat'), slowCount === 0);
    patchHidden(element('#empty-rooms'), rooms.length > 0);
    const codes = new Set(rooms.map(({ room }) => room.code));
    for (const [code, row] of roomRows) {
      if (codes.has(code)) continue;
      row.row.remove();
      roomRows.delete(code);
    }
    for (const { room } of rooms) {
      let item = roomRows.get(room.code);
      if (!item) {
        const row = document.createElement('li');
        row.className = 'room-list-item';
        row.innerHTML =
          '<div><strong></strong><p></p></div><button type="button" class="button">查看 / 观战</button>';
        const button = row.querySelector('button')!;
        button.addEventListener('click', () => {
          if (selected === room.code) return;
          stage.sound.play('click');
          clearCommand();
          closePoster();
          selected = room.code;
          renderCenter(current());
          patchManagement(current());
        });
        item = { row, button };
        roomRows.set(room.code, item);
        element('#room-list').append(row);
      }
      patchText(item.row.querySelector('strong')!, `${ownerName(room)}的房间`);
      patchText(
        item.row.querySelector('p')!,
        `${findMode(room.settings.mode)?.name} · ${room.players.length} / ${room.settings.playerCount} 席 · ${room.code} · ${roomPhase(room)}`,
      );
      item.button.classList.toggle('primary', selected === room.code);
      item.button.classList.toggle('secondary', selected !== room.code);
      patchAttr(item.button, 'aria-pressed', String(selected === room.code));
    }

    const room = entry?.room;
    patchHidden(element('#console-manage-room'), !room);
    patchObserver(entry);
    if (!room || !entry) return;
    patchText(
      element('#console-room-settings'),
      `${findMode(room.settings.mode)?.name} · ${room.settings.playerCount} 席 · ${room.roster?.name ?? GENERAL_PRESETS.find((preset) => preset.id === room.settings.generalPreset)?.name} · ${room.settings.allowGeneralSelection ? '点将开放' : '点将关闭'}`,
    );
    const reset = element('#console-reset-room');
    const canReset =
      room.shanhetu ||
      room.phase === 'starting' ||
      room.phase === 'playing' ||
      room.phase === 'finished';
    patchHidden(reset, !canReset && document.activeElement !== reset);
    patchAttr(reset, 'aria-disabled', String(!canReset));
    patchText(reset, resetLabel(room));
  }

  function acceptSnapshot(data: ConsoleInfo) {
    const now = Date.now();
    const signature = JSON.stringify(
      data.rooms.map(({ room: { serverTime: _serverTime, ...room }, observer, networks }) => [
        room,
        observer,
        networks,
        networks.map(({ updatedAt }) => now - updatedAt < 30000),
      ]),
    );
    if (signature === roomSnapshotSignature) return;
    roomSnapshotSignature = signature;
    const { scrollX, scrollY } = window;
    rooms = data.rooms;
    if (!rooms.some(({ room }) => room.code === selected)) selected = rooms[0]?.room.code ?? '';
    if (pendingCommand && pendingCommand.command.room.code !== selected) clearCommand();
    const entry = current();
    const arrivals = new Set<string>();
    for (const { room } of rooms) {
      const seen = seenHumans.get(room.code) ?? new Set<string>();
      seenHumans.set(room.code, seen);
      for (const player of room.players) {
        if (player.kind !== 'human' || seen.has(player.id)) continue;
        if (!firstSnapshot && room.code === selected && room.phase === 'waiting')
          arrivals.add(player.id);
        seen.add(player.id);
      }
    }
    firstSnapshot = false;
    renderCenter(entry, arrivals);
    patchManagement(entry);
    if (arrivals.size) stage.sound.play('seat');
    if (window.scrollX !== scrollX || window.scrollY !== scrollY)
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
  }

  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (roomRequest) return roomRequest;
    roomRequest = (async () => {
      const status = element('#console-status');
      try {
        const data = await api<ConsoleInfo>('/api/console');
        if (stopped) return;
        acceptSnapshot(data);
        patchText(status, '');
      } catch (error) {
        if (!stopped)
          patchText(status, error instanceof Error ? error.message : '暂时无法更新房间');
      } finally {
        roomRequest = undefined;
      }
    })();
    return roomRequest;
  }

  function renderEntry(updated: ServerInfo) {
    invites.patch(updated);
    patchText(
      element('#console-keepalive'),
      updated.engine.ready ? '对局进行中请保持本页开启' : '正在等待牌桌服务 · 请保持本页开启',
    );
  }

  function refreshEntry(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (entryRequest) return entryRequest;
    entryRequest = (async () => {
      try {
        const updated = await api<ServerInfo>('/api/info');
        if (!stopped) renderEntry(updated);
      } catch {
        if (stopped) return;
        invites.unavailable();
        patchText(element('#console-keepalive'), '电脑服务暂未响应 · 请保持本页开启');
      } finally {
        entryRequest = undefined;
      }
    })();
    return entryRequest;
  }

  bindCommand(element('#console-reset-room'), () => {
    const room = current()?.room;
    if (!room) return;
    return {
      room,
      method: 'POST',
      suffix: '/reset',
      warning: room.shanhetu
        ? '结束本次山河图征程并回房？本次征程的进度与成长将清除，席位保留。'
        : '结束这次对局并让所有玩家回到房间？席位保留，真人需要重新准备。',
    };
  });
  bindCommand(element('#console-close-room'), () => {
    const room = current()?.room;
    if (!room) return;
    return {
      room,
      method: 'DELETE',
      suffix: '',
      warning: `关闭房间 ${room.code}？所有玩家将离开，本局无法继续。`,
    };
  });
  runButton(stage, element('#refresh-address'), async () => {
    await Promise.all([refreshEntry(), refresh()]);
  });
  renderEntry(info);
  watchEvents('/api/events', 'lobby', () => void refresh());
  const timer = setInterval(() => {
    void refresh();
    void refreshEntry();
  }, 1500);
  window.addEventListener(
    'pagehide',
    () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(awardTimer);
    },
    { once: true },
  );
  void refresh();
}

function runButton(stage: StageShell, button: HTMLButtonElement, work: () => Promise<void>) {
  button.addEventListener('click', async () => {
    if (
      button.getAttribute('aria-busy') === 'true' ||
      button.getAttribute('aria-disabled') === 'true'
    )
      return;
    stage.sound.play('click');
    button.setAttribute('aria-busy', 'true');
    try {
      await work();
    } catch (error) {
      stage.toast(error instanceof Error ? error.message : '操作失败，请重试。');
    } finally {
      button.removeAttribute('aria-busy');
    }
  });
}
