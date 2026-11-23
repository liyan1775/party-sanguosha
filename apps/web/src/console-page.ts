// SPDX-License-Identifier: GPL-3.0-only
import {
  findMode,
  GENERAL_PRESETS,
  type ConsoleInfo,
  type ConsoleRoom,
  type ObserverLogPage,
  type ServerInfo,
} from '../../../packages/shared/src/contracts.js';
import { action, api, connection, element, frame, message, watchEvents } from './ui.js';
import { bindQr, isInternetInvite, qrMarkup } from './qr.js';
import { startEngineSupervisor } from './engine-supervisor.js';
import { renderObserver } from './observer-view.js';
import { openPosterDialog } from './party-poster.js';
import { ZIBAI_ICONS } from './zibai-theme.js';

const phases = {
  waiting: '等待玩家',
  starting: '选将中',
  playing: '对局中',
  finished: '已结算',
  closed: '已关闭',
};
const routes = { local: '局域网', lan: '局域网直连', direct: '跨网络直连', internet: '公网' };

export function showServerPage(info: ServerInfo): void {
  const internet = info.entry.mode === 'internet';
  frame(
    'server-layout console-layout',
    '兹白双境 · 客厅大屏与本机服务控制台',
    '一扫入席。<br /><span>好戏开场。</span>',
    '把入口分享给朋友，余下的交给这一桌。<br />玩家在自己的手机上建房、准备和开局，大屏自动同步公开实况与战绩海报。',
    `
    <div class="console-mode-bar">
      <section class="console-stats" aria-label="服务概况">
        <div><span>房间</span><strong id="room-total">0 间</strong></div>
        <div><span>在线真人</span><strong id="online-total">0 人</strong></div>
        <div><span>进行中的对局</span><strong id="match-total">0 局</strong></div>
        <div><span>较慢的连接</span><strong id="slow-total">0 个</strong></div>
      </section>
      <button id="stage-mode-toggle" class="button primary stage-toggle-btn" type="button" aria-pressed="false">${ZIBAI_ICONS.stage}<span>进入客厅大屏剧场</span></button>
    </div>
    <div class="server-grid console-grid"><section class="panel invite-panel"><div class="panel-heading"><h2>同 Wi-Fi 扫这个码</h2><span class="tag">局域网直连</span></div><p class="hint">同 Wi-Fi 或电脑热点的朋友直接连接本机。</p>${qrMarkup('局域网玩家主页二维码', '同 Wi-Fi · 直接进入聚会三国杀主页')}<button id="refresh-address" class="button text-button full-width" type="button">刷新连接状态</button></section>
    <section id="internet-invite" class="panel invite-panel" ${internet ? '' : 'hidden'}><div class="panel-heading"><h2>其他网络扫这个码</h2><span class="tag">跨网络</span></div><p id="entry-status" class="hint" role="status"></p>${qrMarkup('跨网络玩家主页二维码', '其他 Wi-Fi / 手机流量 · 进入同一个大厅', 'internet-')}</section>
    <section class="panel console-rooms"><div class="panel-heading"><h2>全部房间</h2><span class="tag muted">仅本机管理</span></div><ul id="room-list" class="room-list"></ul><p id="empty-rooms" class="empty-rooms">还没有牌桌。朋友扫码后即可创建房间。</p><p id="console-status" class="hint" role="status"></p></section></div>
    <p class="hint console-keepalive-note">两种入口的朋友可以加入同一间房。整局保持电脑开机、页面开启，并避免休眠；跨网络玩家还需要电脑联网。结束后双击「停止聚会三国杀」。</p>
    <section id="console-room" class="panel console-room" hidden>
      <div class="panel-heading"><div><p class="eyebrow">客厅实况与公开观战</p><h2 id="console-room-title"></h2></div><span id="console-room-phase" class="tag"></span></div>
      <p id="console-room-settings" class="hint"></p>
      <section id="console-mvp" class="console-mvp-showcase" hidden aria-label="上局聚会 MVP 颁奖"></section>
      <div id="console-players" class="console-players"></div>
      <div id="console-actions" class="console-actions"></div>
      <p class="hint">公开观战只显示已亮出的身份、体力、手牌数量、装备和公开动作。</p>
      <div id="observer-view"></div>
    </section>`,
    '<div class="console-hero-note"><span class="hero-note-line"></span><p>两种网络<br /><strong>同一张桌</strong></p><small>同 Wi-Fi / 手机流量<br />大屏实况 · 趣味海报</small></div>',
  );
  let rooms: ConsoleRoom[] = [];
  let selected = '';
  let checking = false;
  let refreshing = false;
  let stopped = false;
  let lastRooms = '';
  let stageMode = false;

  const stageToggle = element<HTMLButtonElement>('#stage-mode-toggle');
  stageToggle.addEventListener('click', () => {
    stageMode = !stageMode;
    document.body.classList.toggle('party-stage-active', stageMode);
    stageToggle.setAttribute('aria-pressed', String(stageMode));
    stageToggle.innerHTML = `${ZIBAI_ICONS.stage}<span>${stageMode ? '退出客厅剧场' : '进入客厅大屏剧场'}</span>`;
  });

  function renderEntry(updated: ServerInfo) {
    element('#entry-status').textContent = updated.entry.message;
    bindQr(
      updated.homeUrls.filter((url) => !isInternetInvite(url)),
      undefined,
      {
        mode: 'lan',
        status: updated.homeUrls.length ? 'ready' : updated.entry.status,
        message: updated.entry.message,
      },
    );
    if (internet)
      bindQr(updated.homeUrls.filter(isInternetInvite), undefined, updated.entry, 'internet-');
  }
  renderEntry(info);
  connection(true, '服务在线');

  function commandButton(
    label: string,
    entry: ConsoleRoom,
    method: string,
    suffix: string,
    warning: string,
  ) {
    const button = document.createElement('button');
    button.className = 'button secondary';
    button.textContent = label;
    action(button, async () => {
      if (!confirm(warning)) return;
      await api(`/api/console/rooms/${entry.room.code}${suffix}`, method, undefined, {
        'X-Party-Revision': String(entry.room.revision),
      });
      message('操作已完成。', true);
      lastRooms = '';
      await refresh();
    });
    return button;
  }

  function renderMvpShowcase(entry: ConsoleRoom): void {
    const box = element('#console-mvp');
    const summary = entry.room.lastMatchSummary;
    box.replaceChildren();
    box.hidden = !summary;
    if (!summary) return;

    const head = document.createElement('div');
    head.className = 'mvp-head';
    const titleWrap = document.createElement('div');
    const kicker = document.createElement('p');
    kicker.className = 'eyebrow';
    kicker.textContent = `上局公开名场面 · 共 ${summary.rounds} 轮`;
    const h3 = document.createElement('h3');
    h3.textContent = summary.winnerLabel || '本局已结算';
    titleWrap.append(kicker, h3);

    const posterBtn = document.createElement('button');
    posterBtn.type = 'button';
    posterBtn.className = 'button primary mvp-poster-btn';
    posterBtn.innerHTML = `${ZIBAI_ICONS.poster}<span>生成战绩海报</span>`;
    posterBtn.addEventListener('click', () => openPosterDialog(summary, entry.room.code));
    head.append(titleWrap, posterBtn);

    const grid = document.createElement('div');
    grid.className = 'mvp-awards-grid';
    for (const award of summary.awards.slice(0, 4)) {
      const card = document.createElement('article');
      card.className = 'mvp-award-card';
      const badge = document.createElement('span');
      badge.className = 'mvp-award-title';
      badge.textContent = award.title;
      const holder = document.createElement('strong');
      holder.textContent = `${award.holderNickname}${award.generalName ? ` · ${award.generalName}` : ''}`;
      const detail = document.createElement('p');
      detail.textContent = award.detail;
      card.append(badge, holder, detail);
      grid.append(card);
    }
    box.append(head, grid);
  }

  function renderDetail() {
    const entry = rooms.find((entry) => entry.room.code === selected);
    element('#console-room').hidden = !entry;
    if (!entry) return;
    const { room } = entry;
    const owner = room.players.find((player) => player.id === room.ownerId);
    element('#console-room-title').textContent =
      `${owner?.nickname ?? '朋友'}的房间 · ${room.code}`;
    element('#console-room-phase').textContent =
      room.shanhetu && room.phase === 'waiting' ? '山河图征程中' : phases[room.phase];
    element('#console-room-settings').textContent =
      `${findMode(room.settings.mode)?.name} · ${room.settings.playerCount} 席 · ${GENERAL_PRESETS.find((preset) => preset.id === room.settings.generalPreset)?.name} · ${room.settings.allowGeneralSelection ? '点将开放' : '点将关闭'}`;
    renderMvpShowcase(entry);
    const players = element('#console-players');
    players.replaceChildren();
    for (const player of room.players) {
      const row = document.createElement('div');
      row.className = 'console-player';
      const name = document.createElement('strong');
      name.textContent = `${player.nickname}${player.id === room.ownerId ? ' · 房主' : ''}`;
      const status = document.createElement('span');
      const network = entry.networks.find((network) => network.playerId === player.id);
      const current = network && Date.now() - network.updatedAt < 30000;
      const returned = Boolean(
        room.phase === 'finished' && room.returnedPlayerIds?.includes(player.id),
      );
      status.textContent =
        player.kind === 'bot'
          ? '原生 AI'
          : `${player.online ? (returned ? '已回房待房主' : player.ready ? '在线 · 已准备' : '在线') : '离线'}${current ? ` · ${routes[network.route]} · ${network.transport.toUpperCase()} · ${network.rtt ?? '—'} ms${network.unstable ? ' · 不稳' : ''}` : ''}`;
      row.append(name, status);
      if (room.phase === 'waiting' && !room.shanhetu)
        row.append(
          commandButton(
            '移除席位',
            entry,
            'DELETE',
            `/players/${player.id}`,
            `移除「${player.nickname}」？若移除房主，房主会交接给下一位真人。`,
          ),
        );
      players.append(row);
    }
    const actions = element('#console-actions');
    actions.replaceChildren();
    if (room.shanhetu || ['starting', 'playing', 'finished'].includes(room.phase))
      actions.append(
        commandButton(
          room.shanhetu
            ? '结束征程并回房'
            : room.phase === 'finished'
              ? '回房准备下一局'
              : '结束对局并回房',
          entry,
          'POST',
          '/reset',
          room.shanhetu
            ? '结束本次山河图征程并回房？本次征程的进度与成长将清除，席位保留。'
            : '结束这次对局并让所有玩家回到房间？当前对局将结束，席位保留，真人需要重新准备。',
        ),
      );
    actions.append(
      commandButton(
        '关闭房间',
        entry,
        'DELETE',
        '',
        `关闭房间 ${room.code}？所有玩家将离开，本局无法继续。`,
      ),
    );
    renderObserver(element('#observer-view'), entry.observer, room.matchId, (before) =>
      api<ObserverLogPage>(
        `/api/console/rooms/${room.code}/log?match=${encodeURIComponent(room.matchId ?? '')}&before=${before}`,
      ),
    );
  }
  function render() {
    if (!rooms.some((entry) => entry.room.code === selected)) selected = rooms[0]?.room.code ?? '';
    element('#room-total').textContent = `${rooms.length} 间`;
    element('#online-total').textContent =
      `${rooms.flatMap((entry) => entry.room.players).filter((player) => player.kind === 'human' && player.online).length} 人`;
    element('#match-total').textContent =
      `${rooms.filter((entry) => ['starting', 'playing'].includes(entry.room.phase)).length} 局`;
    element('#slow-total').textContent =
      `${rooms.flatMap((entry) => entry.networks).filter((network) => Date.now() - network.updatedAt < 30000 && (network.unstable || (network.rtt ?? 0) >= 600)).length} 个`;
    const list = element('#room-list');
    list.replaceChildren();
    element('#empty-rooms').hidden = rooms.length > 0;
    for (const entry of rooms) {
      const room = entry.room;
      const item = document.createElement('li');
      item.className = 'room-list-item';
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = `${room.players.find((player) => player.id === room.ownerId)?.nickname ?? '朋友'}的房间`;
      const summary = document.createElement('p');
      summary.textContent = `${findMode(room.settings.mode)?.name} · ${room.players.length} / ${room.settings.playerCount} 席 · ${room.code} · ${phases[room.phase]}`;
      details.append(name, summary);
      const view = document.createElement('button');
      view.className = `button ${selected === room.code ? 'primary' : 'secondary'}`;
      view.textContent = '查看 / 观战';
      view.addEventListener('click', () => {
        selected = room.code;
        render();
        element('#console-room').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      item.append(details, view);
      list.append(item);
    }
    renderDetail();
  }
  async function refresh() {
    if (refreshing || stopped) return;
    refreshing = true;
    try {
      const data = await api<ConsoleInfo>('/api/console');
      const key = JSON.stringify(data.rooms);
      if (key !== lastRooms) {
        rooms = data.rooms;
        lastRooms = key;
        render();
      }
      element('#console-status').textContent = '房间状态自动更新 · 管理操作需要确认';
    } catch (error) {
      element('#console-status').textContent =
        error instanceof Error ? error.message : '控制台暂时无法连接';
    } finally {
      refreshing = false;
    }
  }
  async function refreshEntry() {
    if (checking || stopped) return;
    checking = true;
    try {
      renderEntry(await api<ServerInfo>('/api/info'));
    } catch {
      renderEntry({
        ...info,
        homeUrls: [],
        entry: {
          mode: info.entry.mode,
          status: 'unavailable',
          message: '电脑服务已停止，请重新双击启动。',
        },
      });
    } finally {
      checking = false;
    }
  }
  action(element('#refresh-address'), async () => {
    await refreshEntry();
    await refresh();
  });
  watchEvents('/api/events', 'lobby', () => {
    void refresh();
  });
  const timer = setInterval(() => {
    void refresh();
    if (internet) void refreshEntry();
  }, 1500);
  window.addEventListener(
    'pagehide',
    () => {
      stopped = true;
      clearInterval(timer);
      document.body.classList.remove('party-stage-active');
    },
    { once: true },
  );
  void refresh();
  startEngineSupervisor();
}
