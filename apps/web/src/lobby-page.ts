// SPDX-License-Identifier: GPL-3.0-only
import {
  GENERAL_PRESETS,
  QUICK_PLAY_PRESETS,
  findMode,
  type MembershipResult,
  type QuickPlayPresetId,
  type QuickPlayRequest,
  type RoomSummary,
  type ServerInfo,
  type SessionView,
} from '../../../packages/shared/src/contracts.js';
import { api, connection, element, rememberNickname, savedNickname, watchEvents } from './ui.js';
import { stagePreferences, stageShell } from './stage-shell.js';
import { bindGeneralGuide } from './general-guide.js';
import { bindLobbyRosters } from './custom-rosters.js';
import { createAssetPreloader } from './engine-preloader.js';
import { arrowIcon, modeIcon } from './lobby-art.js';

const modes = [
  ['identity-6', '经典身份', '5–8 人', '主忠反内'],
  ['doudizhu-3', '欢乐斗地主', '3 人', '农民互看手牌'],
  ['versus-2v2', '2v2 对抗', '4 人', '双人配合 · 队友互看手牌'],
  ['duel-2', '1v1 单挑', '2 人', '单将决胜'],
  ['college-4', '高校联赛', '4 人', '赛事将池与练习'],
  ['shanhetu-solo', '山河图', '单人', '三章十四城'],
] as const;

const joinable = (room: RoomSummary) =>
  room.phase === 'waiting' && room.humanCount + room.botCount < room.playerCount;

const roomHref = (code: string) => `/join/${encodeURIComponent(code)}`;

function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function createRoomList() {
  const list = element('#room-list');
  const total = element('#room-total');
  const empty = element('#empty-rooms');
  const emptyTitle = element('#empty-room-title');
  const emptyHint = element('#empty-room-hint');
  const entries = new Map<string, HTMLElement>();
  return (rooms: RoomSummary[], onlyJoinable: boolean, currentRoom: string | null) => {
    setText(total, `${rooms.length} 桌`);
    const visible = rooms.filter((room) => !onlyJoinable || joinable(room));
    empty.hidden = visible.length > 0;
    const noAvailableRooms = onlyJoinable && rooms.length > 0;
    setText(emptyTitle, noAvailableRooms ? '暂时没有空座。' : '还没有朋友的房间。');
    setText(
      emptyHint,
      noAvailableRooms ? '切回全部房间，看看朋友在哪一桌。' : '朋友开桌后会在这里出现。',
    );
    const focusedRow = document.activeElement?.closest('.room-list-item');
    const visibleCodes = new Set(visible.map((room) => room.code));
    for (const [code, entry] of entries) {
      if (!visibleCodes.has(code)) {
        if (entry === focusedRow)
          element('[data-room-filter][aria-pressed="true"]').focus({ preventScroll: true });
        entry.remove();
        entries.delete(code);
      }
    }
    const rows = visible.map((room) => {
      let item = entries.get(room.code);
      if (!item) {
        item = document.createElement('li');
        item.className = 'room-list-item';
        item.dataset.roomCode = room.code;
        item.innerHTML =
          '<span class="room-emblem"></span><div class="room-description"><strong></strong><p></p><span class="room-number"></span></div><div class="room-availability"><span class="room-state"></span><a class="button secondary room-link"></a></div>';
        entries.set(room.code, item);
      }
      const emblem = item.querySelector<HTMLElement>('.room-emblem')!;
      if (emblem.dataset.mode !== room.mode) {
        emblem.innerHTML = modeIcon(room.mode);
        emblem.dataset.mode = room.mode;
      }
      setText(item.querySelector('strong')!, `${room.ownerNickname}的房间`);
      setText(
        item.querySelector('p')!,
        `${findMode(room.mode)?.name} · ${room.rosterName ?? GENERAL_PRESETS.find((preset) => preset.id === room.generalPreset)?.name ?? '房间指定将池'} · ${room.humanCount + room.botCount}/${room.playerCount} 席`,
      );
      setText(item.querySelector('.room-number')!, `房间 ${room.code}`);
      const state = item.querySelector<HTMLElement>('.room-state')!;
      state.classList.toggle('available', joinable(room));
      setText(
        state,
        joinable(room)
          ? `还差 ${room.playerCount - room.humanCount - room.botCount} 位`
          : room.phase === 'waiting'
            ? '已满席'
            : room.phase === 'finished'
              ? '已结算'
              : '对局中',
      );
      const link = item.querySelector<HTMLAnchorElement>('a')!;
      setText(
        link,
        room.code === currentRoom
          ? '回到原座'
          : !currentRoom && joinable(room)
            ? '加入'
            : '查看房间',
      );
      const href = roomHref(room.code);
      if (link.getAttribute('href') !== href) link.href = href;
      return item;
    });
    let next: HTMLElement | null = null;
    for (const item of rows.reverse()) {
      if (item !== focusedRow && (item.parentNode !== list || item.nextSibling !== next))
        list.insertBefore(item, next);
      next = item;
    }
  };
}

export function showHomePage(info: ServerInfo, session: SessionView): void {
  const stage = stageShell(
    'home',
    '聚会三国杀 · 模式大厅',
    `
    <header class="sgs-home-head">
      <div class="sgs-home-brand"><span class="seal" aria-hidden="true">杀</span><h1>聚会三国杀</h1></div>
      <div class="sgs-nickname">
        <label for="nickname">昵称</label>
        <input id="nickname" name="nickname" placeholder="怎么称呼你" autocomplete="nickname" maxlength="32" aria-describedby="nickname-hint" />
        <p id="nickname-hint" role="status" hidden>请先填个昵称，马上开房</p>
      </div>
      <nav class="sgs-home-tools" aria-label="大厅功能">
        <button id="general-guide" class="pref-token" type="button">武将图鉴</button>
        <button id="lobby-rosters" class="pref-token" type="button">自定义将池</button>
        ${stagePreferences()}
      </nav>
    </header>
    <aside id="current-room" class="sgs-current-room" hidden>
      <strong id="current-room-label"></strong>
      <a id="return-room" href="/">返回我的房间 <span aria-hidden="true">→</span></a>
    </aside>
    <section id="lobby-actions" class="sgs-lobby-panel" aria-labelledby="mode-title">
      <div class="sgs-lobby-heading">
        <div><h2 id="mode-title">模式大厅</h2><p id="home-status">选择玩法，即可开房入座</p></div>
        <label class="sgs-bot-toggle"><input id="quick-fill-bots" type="checkbox" /> 空位自动补 AI</label>
      </div>
      <div id="new-room-actions" class="sgs-mode-grid">
        ${modes
          .map(
            ([id, title, players, description]) => `
          <button class="sgs-mode${id === 'identity-6' || id === 'doudizhu-3' || id === 'versus-2v2' ? ' is-core' : ''}" type="button" data-quick-preset="${id}" data-mode="${QUICK_PLAY_PRESETS[id].mode}"
            ${id === 'shanhetu-solo' && !info.engine.shanhetu ? 'disabled' : ''}>
            <span class="sgs-mode-mark">${modeIcon(QUICK_PLAY_PRESETS[id].mode)}</span>
            <span class="sgs-mode-players">${players}</span>
            <strong>${id === 'shanhetu-solo' ? '山河图<span class="sgs-mode-subtitle">诸侯伐董</span>' : title}</strong>
            <span class="sgs-mode-description">${id === 'shanhetu-solo' && !info.engine.shanhetu ? '当前服务未开放' : description}</span>
            <span class="sgs-mode-arrow">${arrowIcon}</span>
          </button>`,
          )
          .join('')}
      </div>
      <p id="engine-preload" class="hint" role="status" hidden></p>
    </section>
    <section id="friends-rooms" class="sgs-lobby-panel" aria-labelledby="friends-title">
      <div class="sgs-lobby-heading"><h2 id="friends-title">朋友的房间</h2><span id="connection" class="connection online" role="status">服务在线</span></div>
      <div class="room-filters" role="group" aria-label="筛选房间">
        <button type="button" data-room-filter="all" aria-pressed="true" aria-controls="room-list">全部房间</button>
        <button type="button" data-room-filter="joinable" aria-pressed="false" aria-controls="room-list">可加入</button>
        <span id="room-total" class="room-total">0 桌</span>
      </div>
      <ul id="room-list" class="room-list"></ul>
      <div id="empty-rooms" class="empty-rooms">
        <span class="empty-symbol" aria-hidden="true">${modeIcon('identity')}</span>
        <h3 id="empty-room-title"></h3><p id="empty-room-hint"></p>
      </div>
    </section>
  `,
  );

  bindGeneralGuide();
  bindLobbyRosters();
  const preloader = createAssetPreloader(
    element('#engine-preload'),
    sessionStorage.getItem('party_lightweight_verification') === '1',
  );
  preloader.update(Boolean(info.engine.preload));

  const nickname = element<HTMLInputElement>('#nickname');
  const nicknameHint = element('#nickname-hint');
  nickname.value = savedNickname();
  nickname.addEventListener('input', () => {
    if (nickname.value.trim()) {
      nicknameHint.hidden = true;
      nickname.removeAttribute('aria-invalid');
    }
    rememberNickname(nickname.value);
  });
  const actions = element('#new-room-actions');
  const fillBots = element<HTMLInputElement>('#quick-fill-bots');
  const currentRoom = element('#current-room');
  const returnLink = element<HTMLAnchorElement>('#return-room');
  const quickButtons = [...actions.querySelectorAll<HTMLButtonElement>('[data-quick-preset]')];
  const internet = (info.entry.access ?? info.entry.mode) === 'internet';
  let rooms = info.rooms;
  let roomListSignature = JSON.stringify(rooms);
  let onlyJoinable = false;
  let busy = false;
  let leaving = false;
  let sessionDirty = false;
  let checkingSession = false;
  let sessionRequest = 0;
  let lastSessionCheck = Date.now();
  const roomList = createRoomList();
  const renderList = () => roomList(rooms, onlyJoinable, session.roomCode);

  function renderSession() {
    const code = session.roomCode;
    const focused = document.activeElement;
    if (code) {
      returnLink.href = roomHref(code);
      setText(element('#current-room-label'), `你正在 ${code} 号房`);
    }
    currentRoom.hidden = !code;
    actions.hidden = Boolean(code);
    fillBots.parentElement!.hidden = Boolean(code);
    setText(
      element('#home-status'),
      code ? '返回原房间，或离开原座后再开房' : '选择玩法，即可开房入座',
    );
    if (code && actions.contains(focused)) returnLink.focus({ preventScroll: true });
    else if (!code && focused === returnLink) nickname.focus({ preventScroll: true });
  }
  renderSession();
  renderList();

  const filters = document.querySelectorAll<HTMLButtonElement>('[data-room-filter]');
  for (const button of filters) {
    button.addEventListener('click', () => {
      stage.sound.play('click');
      onlyJoinable = button.dataset.roomFilter === 'joinable';
      for (const filter of filters) filter.setAttribute('aria-pressed', String(filter === button));
      renderList();
    });
  }

  async function refreshSession() {
    lastSessionCheck = Date.now();
    const request = ++sessionRequest;
    const updated = await api<SessionView>('/api/me');
    if (request === sessionRequest && updated.roomCode !== session.roomCode) {
      session = updated;
      renderSession();
      renderList();
    }
    return session.roomCode;
  }

  function leaveFor(href: string, label: string) {
    if (leaving) return;
    leaving = true;
    preloader.update(false);
    stage.leaving(label);
    window.setTimeout(() => location.assign(href), 80);
  }

  function followRoom(event: MouseEvent, link: HTMLAnchorElement) {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    event.preventDefault();
    if (!busy && !leaving) {
      stage.sound.play('click');
      leaveFor(link.href, '正在进入房间…');
    }
  }
  returnLink.addEventListener('click', (event) => followRoom(event, returnLink));
  element('#room-list').addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a.room-link');
    if (link) followRoom(event, link);
  });

  async function createRoom(button: HTMLButtonElement, presetId: QuickPlayPresetId) {
    if (busy || leaving || session.roomCode) return;
    stage.sound.play('click');
    const name = nickname.value.trim();
    if (!name) {
      nicknameHint.hidden = false;
      nickname.setAttribute('aria-invalid', 'true');
      nickname.focus();
      return;
    }
    busy = true;
    const solo = presetId === 'shanhetu-solo';
    for (const control of quickButtons) control.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    try {
      const occupied = await refreshSession();
      if (occupied) {
        leaveFor(roomHref(occupied), '正在返回原房间…');
        return;
      }
      const request: QuickPlayRequest = {
        nickname: name,
        presetId,
        fillBots: !solo && fillBots.checked,
        requireUnseated: true,
        requestId: `qp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      const created = await api<MembershipResult>('/api/rooms/preset', 'POST', request);
      stage.sound.play('success');
      leaveFor(roomHref(created.room.code), solo ? '正在前往山河图…' : '正在入席…');
    } catch (error) {
      const occupied = await refreshSession().catch(() => null);
      if (occupied) leaveFor(roomHref(occupied), '正在返回原房间…');
      else stage.toast(error instanceof Error ? error.message : '操作失败，请重试。');
    } finally {
      busy = false;
      for (const control of quickButtons) control.removeAttribute('aria-disabled');
      button.removeAttribute('aria-busy');
      if (sessionDirty) void syncSession();
    }
  }

  for (const button of quickButtons)
    button.addEventListener(
      'click',
      () => void createRoom(button, button.dataset.quickPreset as QuickPlayPresetId),
    );

  async function syncSession() {
    sessionDirty = true;
    if (checkingSession || busy || leaving) return;
    checkingSession = true;
    try {
      while (sessionDirty && !busy && !leaving) {
        sessionDirty = false;
        await refreshSession().catch(() => {});
      }
    } finally {
      checkingSession = false;
    }
  }
  window.addEventListener('focus', () => void syncSession());
  connection(true, '服务在线');
  watchEvents(
    '/api/events',
    'lobby',
    (updatedRooms) => {
      const signature = JSON.stringify(updatedRooms);
      const changed = signature !== roomListSignature;
      if (changed) {
        roomListSignature = signature;
        rooms = updatedRooms as RoomSummary[];
        renderList();
      }
      if (changed || !internet || Date.now() - lastSessionCheck >= 30000) void syncSession();
    },
    internet,
  );
}
