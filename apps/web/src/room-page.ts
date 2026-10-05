import {
  GENERAL_PRESETS,
  MODES,
  findMode,
  type MembershipResult,
  type ModeId,
  type RoomInfo,
  type RoomView,
  type SessionView,
} from '../../../packages/shared/src/contracts.js';
import {
  action,
  api,
  app,
  connection,
  disable,
  element,
  frame,
  message,
  perform,
  watchEvents,
} from './ui.js';
import { bindQr, qrMarkup } from './qr.js';
import { bindGeneralGuide, guideButton } from './general-guide.js';
import { createAssetPreloader } from './engine-preloader.js';
import { createLanConnection } from './lan-client.js';

export function showRoomPage(initial: RoomInfo, initialSession: SessionView): void {
  let room = initial.room;
  const session = { ...initialSession };
  let events: { close(): void } | undefined;
  let settingsDirty = false;
  let draftMode: ModeId = room.settings.mode;
  let wasOwner = false;
  let qrBound = false;
  let matchId: string | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let horizontalTable = sessionStorage.getItem('party_table_view') !== 'portrait';
  let localConnection: ReturnType<typeof createLanConnection>;
  let localMatchAttempt: string | null = null;
  const roomPath = `/api/rooms/${room.code}`;

  frame(
    'room-layout',
    '朋友已经在等你',
    '人到齐，就开局。',
    '房主也是桌上的一位玩家。每位入座的朋友都可以分享房间邀请。',
    `
    <section id="match-panel" class="match-panel" hidden><div class="match-toolbar"><strong id="match-label">正在选将</strong><span id="orientation-hint" class="orientation-hint" hidden>请横着握手机</span><button id="match-orientation" class="button secondary" type="button" hidden>竖屏显示</button><button id="match-sound" class="button secondary" type="button" aria-pressed="false">开启声音</button><button id="match-share" class="button secondary" type="button">房间二维码</button><button id="rematch-button" class="button primary" type="button" hidden>回到房间，准备下一局</button><span id="finished-hint" hidden>请等房主返回房间</span></div><div id="game-frame-container"><div id="game-frame-mount"></div><div id="match-loading" class="match-loading" role="status" aria-live="polite" hidden><strong id="match-loading-status">正在准备对局…</strong><progress id="match-loading-progress" max="6" value="0" aria-label="对局载入步骤"></progress><p id="match-loading-detail">第 1 / 6 步 · 首次进入需要载入游戏资源</p></div></div></section>
    <div class="room-grid">
      <section class="panel welcome-panel"><div class="panel-heading"><h2>这一桌</h2><span class="tag" id="player-room-code"></span></div><div class="game-summary"><span id="summary-mode" class="summary-mode"></span><span id="summary-details"></span></div><p id="summary-preset" class="hint"></p>${guideButton}
        <div id="other-room" class="message" hidden>你已经在另一间房，请先回去离开。<a id="other-room-link" href="/">返回原房间</a></div>
        <form id="join-form"><label for="nickname">怎么称呼你</label><input id="nickname" name="nickname" placeholder="输入昵称，朋友才认得你" autocomplete="nickname" maxlength="32" required /><p class="hint">昵称 1–16 个字，无需注册账号。</p><button id="join-button" class="button primary full-width" type="submit">入座</button></form>
        <div id="my-seat" hidden><p class="my-seat-label" id="my-role"></p><h3 id="my-nickname"></h3><button id="ready-button" class="button primary full-width" type="button">我准备好了</button><button id="share-button" class="button secondary full-width" type="button">展示房间二维码</button><div id="owner-start" hidden><button id="start-button" class="button primary full-width" type="button" disabled>开始对局</button></div><button id="leave-button" class="button text-button full-width" type="button">离开房间</button><p id="owner-leave-hint" class="hint" hidden>离开后房主交接给下一位真人；最后一位真人离开会关闭房间。</p></div>
      </section>
      <section class="panel players-panel"><div class="panel-heading"><h2>等朋友到齐</h2><span id="player-counter" class="tag muted"></span></div><p id="seat-count" class="hint seat-count"></p><div id="bot-controls" class="bot-controls" hidden><button id="add-bot" class="button secondary" type="button">添加 1 个 AI</button><button id="fill-bots" class="button subtle" type="button">用 AI 补满空位</button><p class="hint">AI 自动准备，使用无名杀完整原生决策。</p></div><ul id="players" class="players"></ul><p id="waiting-text" class="waiting-text"></p><p id="owner-status" class="hint"></p><p id="engine-status" class="hint engine-status"></p></section>
      <details id="settings-panel" class="panel settings-panel" hidden><summary><span>房主设置</span><small>玩法 · 武将 · 扩展</small></summary><div class="settings-body"><div class="mode-grid">${MODES.map((mode) => `<button type="button" class="mode-card" data-mode="${mode.id}" aria-pressed="false"><span class="mode-mark">${mode.id === 'identity' ? '主' : mode.id === 'doudizhu' ? '地' : mode.id === 'versus' ? '盟' : '决'}</span><strong>${mode.name}</strong><small>${mode.minPlayers === mode.maxPlayers ? mode.minPlayers : '5–8'} 席</small></button>`).join('')}</div><p id="mode-description" class="mode-description"></p><div class="field-row"><label for="player-count">总席位（含 AI）<select id="player-count"></select></label><label for="general-preset">武将范围<select id="general-preset">${GENERAL_PRESETS.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join('')}</select></label></div><p id="preset-description" class="hint"></p><div class="extensions"><h3>扩展包</h3><p class="hint">暂无已接入的扩展包</p></div><button id="save-settings" class="button secondary full-width" type="button">保存房间设置</button><p id="settings-state" class="hint"></p></div></details>
    </div>
    <dialog id="share-dialog" aria-labelledby="share-title"><div class="panel-heading"><h2 id="share-title">扫码直接进入本房间</h2><button id="close-share" class="close-dialog" type="button" aria-label="关闭房间二维码">×</button></div><p class="room-code">房间 <strong>${room.code}</strong></p>${qrMarkup('本房间邀请二维码', '微信扫一扫 · 直接进入这张牌桌')}</dialog>`,
  );
  bindGeneralGuide(() => room.settings.generalPreset);
  const preloadStatus = document.createElement('p');
  preloadStatus.id = 'engine-preload';
  preloadStatus.className = 'hint';
  preloadStatus.setAttribute('role', 'status');
  element('.welcome-panel').appendChild(preloadStatus);
  const preloader = createAssetPreloader(preloadStatus);
  const networkStatus = document.createElement('span');
  networkStatus.id = 'match-network';
  networkStatus.className = 'match-network';
  networkStatus.textContent = '网络检测中';
  networkStatus.title = '最近一次手机到电脑服务的往返延迟，游戏动画不计入';
  element('.match-toolbar').insertBefore(networkStatus, element('#orientation-hint'));

  const owner = () => session.roomCode === room.code && session.playerId === room.ownerId;
  const refresh = () => renderRoom(room);
  function resizeTable(): void {
    const panel = element('#match-panel');
    const portrait = window.innerWidth < window.innerHeight;
    const rotated = portrait && horizontalTable;
    panel.classList.toggle('rotated-table', rotated);
    panel.style.setProperty('--table-width', `${window.innerHeight}px`);
    panel.style.setProperty('--table-height', `${window.innerWidth}px`);
    element('#match-orientation').hidden = !portrait;
    element('#match-orientation').textContent = horizontalTable ? '竖屏显示' : '横屏牌桌';
    element('#orientation-hint').hidden = !rotated;
  }
  element('#match-orientation').addEventListener('click', () => {
    horizontalTable = !horizontalTable;
    sessionStorage.setItem('party_table_view', horizontalTable ? 'landscape' : 'portrait');
    resizeTable();
  });
  window.addEventListener('resize', resizeTable);
  element('#match-sound').addEventListener('click', () => {
    const frame = document.querySelector<HTMLIFrameElement>('#game-frame');
    const engine = (
      frame?.contentWindow as
        | (Window & {
            partyEngine?: {
              audio?: { toggle(): Promise<void>; setEnabled?(enabled: boolean): Promise<void> };
            };
          })
        | null
    )?.partyEngine;
    const audio = engine?.audio;
    if (audio?.setEnabled)
      void audio.setEnabled(element('#match-sound').getAttribute('aria-pressed') !== 'true');
    else void audio?.toggle();
  });
  function reconnectGame(): void {
    if (reconnectTimer || !matchId || !['starting', 'playing'].includes(room.phase)) return;
    element('#match-label').textContent = '连接中断，正在恢复原座位…';
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = undefined;
        void api<RoomInfo>(roomPath)
          .then((info) => {
            renderRoom(info.room);
            const frame = document.querySelector<HTMLIFrameElement>('#game-frame');
            if (
              frame &&
              matchId === info.room.matchId &&
              ['starting', 'playing'].includes(info.room.phase)
            ) {
              element('#match-loading').hidden = false;
              frame.src = `/engine/player/${matchId}`;
            }
          })
          .catch(reconnectGame);
      },
      Math.min(5000, 1000 * ++reconnectAttempt),
    );
  }
  window.addEventListener('message', (event) => {
    const frame = document.querySelector<HTMLIFrameElement>('#game-frame');
    if (
      event.origin !== location.origin ||
      event.source !== frame?.contentWindow ||
      event.data?.matchId !== matchId
    )
      return;
    if (event.data.type === 'party-disconnected') reconnectGame();
    if (event.data.type === 'party-network') {
      const data = event.data;
      const milliseconds = Number.isFinite(data.rtt) ? `${Math.round(data.rtt)} ms` : '';
      networkStatus.textContent = data.unstable
        ? `网络不稳${milliseconds ? ` · ${milliseconds}` : ''}`
        : `${data.route === 'lan' ? '局域网直连' : data.route === 'internet' ? '公网' : '局域网'} · ${milliseconds || '检测中'}${data.rtt >= 600 ? ' · 稍慢' : ''}`;
      networkStatus.classList.toggle('slow-network', data.unstable || data.rtt >= 600);
      networkStatus.dataset.route = data.route;
      networkStatus.dataset.rtt = String(data.rtt ?? '');
    }
    if (event.data.type === 'party-loading') {
      element('#match-loading').hidden = event.data.failed || event.data.step === 6;
      element('#match-loading-status').textContent = event.data.message;
      element('#match-loading-detail').textContent = event.data.detail;
      element<HTMLProgressElement>('#match-loading-progress').value = event.data.step;
    }
    if (event.data.type === 'party-audio') {
      const button = element('#match-sound');
      button.textContent = event.data.enabled ? '声音开' : event.data.muted ? '声音关' : '开启声音';
      button.setAttribute('aria-pressed', String(event.data.enabled));
    }
    if (event.data.type === 'party-connected') {
      element('#match-loading').hidden = true;
      reconnectAttempt = 0;
      refresh();
    }
  });
  window.addEventListener('pagehide', () => clearTimeout(reconnectTimer), { once: true });

  function setDraftMode(modeId: ModeId, count: number): void {
    draftMode = modeId;
    const mode = findMode(modeId)!;
    app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      const selected = button.dataset.mode === modeId;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const select = element<HTMLSelectElement>('#player-count');
    select.replaceChildren();
    for (let value = mode.minPlayers; value <= mode.maxPlayers; value++)
      select.add(new Option(`${value} 席`, String(value)));
    select.value = String(
      count >= mode.minPlayers && count <= mode.maxPlayers ? count : mode.minPlayers,
    );
    select.disabled = mode.minPlayers === mode.maxPlayers || room.phase !== 'waiting';
    element('#mode-description').textContent = mode.description;
    preloader.update(
      Boolean(room.engine.preload) && room.phase === 'waiting',
      element<HTMLSelectElement>('#general-preset').value,
      draftMode,
    );
  }

  function presetDescription(): void {
    const selected = element<HTMLSelectElement>('#general-preset').value;
    element('#preset-description').textContent =
      GENERAL_PRESETS.find((preset) => preset.id === selected)?.description ?? '';
    preloader.update(Boolean(room.engine.preload) && room.phase === 'waiting', selected, draftMode);
  }

  function renderRoom(snapshot: RoomView): void {
    // 旧 HTTP 响应晚于 SSE 到达时，仍使用较新的在线和权限状态。
    if (snapshot.revision < room.revision) return;
    room = snapshot;
    preloader.update(
      Boolean(room.engine.preload) && room.phase === 'waiting',
      settingsDirty
        ? element<HTMLSelectElement>('#general-preset').value
        : room.settings.generalPreset,
      settingsDirty ? draftMode : room.settings.mode,
    );
    const me =
      session.roomCode === room.code
        ? room.players.find((player) => player.id === session.playerId)
        : undefined;
    if (session.roomCode === room.code && session.playerId && !me) {
      session.playerId = null;
      session.roomCode = null;
      element<HTMLDialogElement>('#share-dialog').close();
      message(
        room.phase === 'closed'
          ? '房间已关闭，请返回主页。'
          : '你的座位已被房主移除，可以重新入座或返回主页。',
      );
      qrBound = false;
    }
    const isOwner = owner();
    if (!me && localConnection) {
      localConnection.close();
      localConnection = undefined;
      Object.assign(window, { partyLan: undefined });
    }
    if (
      me &&
      initial.entry?.mode === 'internet' &&
      room.engine.preload &&
      (!localConnection ||
        (localConnection.closed && room.matchId && room.matchId !== localMatchAttempt))
    ) {
      localConnection = createLanConnection(room.code);
      localMatchAttempt = room.matchId;
      Object.assign(window, { partyLan: localConnection });
    }
    const waiting = room.phase === 'waiting';
    const inMatch = Boolean(
      me && room.matchId && ['starting', 'playing', 'finished'].includes(room.phase),
    );
    element('#match-panel').hidden = !inMatch;
    app.classList.toggle('in-match', inMatch);
    document.body.classList.toggle('playing-match', inMatch);
    resizeTable();
    element('#match-label').textContent =
      room.phase === 'finished'
        ? '本局已结束'
        : room.phase === 'starting'
          ? '正在选将'
          : `${findMode(room.settings.mode)!.name} · ${room.code}`;
    element('#rematch-button').hidden = room.phase !== 'finished' || !isOwner;
    element('#finished-hint').hidden = room.phase !== 'finished' || isOwner;
    if (inMatch && room.matchId !== matchId) {
      const frame = document.createElement('iframe');
      frame.id = 'game-frame';
      frame.title = '三国杀对局';
      frame.allow = 'autoplay';
      frame.src = `/engine/player/${room.matchId}`;
      element('#game-frame-mount').replaceChildren(frame);
      element('#match-loading').hidden = false;
      element('#match-sound').textContent = '开启声音';
      matchId = room.matchId;
    } else if (!inMatch && matchId) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      element('#game-frame-mount').replaceChildren();
      element('#match-loading').hidden = true;
      matchId = null;
    }
    if (isOwner !== wasOwner) {
      settingsDirty = false;
      if (isOwner) element<HTMLDetailsElement>('#settings-panel').open = true;
      wasOwner = isOwner;
    }
    const humans = room.players.filter((player) => player.kind === 'human');
    const bots = room.players.filter((player) => player.kind === 'bot');
    const readyHumans = humans.filter((player) => player.online && player.ready).length;
    const empty = room.settings.playerCount - room.players.length;
    const mode = findMode(room.settings.mode)!;
    const preset = GENERAL_PRESETS.find((entry) => entry.id === room.settings.generalPreset)!;
    element('#player-counter').textContent =
      `${room.players.length} / ${room.settings.playerCount} 席`;
    element('#seat-count').textContent = `${humans.length} 位真人 · ${bots.length} 个 AI`;
    element('#player-room-code').textContent = room.code;
    element('#summary-mode').textContent = mode.name;
    element('#summary-details').textContent = `${room.settings.playerCount} 席 · ${preset.name}`;
    element('#summary-preset').textContent = preset.description;
    element('#engine-status').textContent = room.engine.message;
    const roomOwner = room.players.find((player) => player.id === room.ownerId);
    element('#owner-status').textContent = roomOwner
      ? `房主：${roomOwner.nickname}${roomOwner.online ? '' : ' · 暂时离线，等待重新连接'}`
      : '房间已关闭';
    element('#waiting-text').textContent = waiting
      ? `${readyHumans} / ${humans.length} 位真人已准备，${empty} 个空位；AI 自动准备。`
      : room.phase === 'closed'
        ? '这张牌桌已散，返回主页可以另开一局。'
        : '对局正在启动或进行中，房间设置已锁定。';

    element('#join-form').hidden =
      Boolean(me) || Boolean(session.roomCode && session.roomCode !== room.code) || !waiting;
    element('#other-room').hidden = !session.roomCode || session.roomCode === room.code;
    if (session.roomCode)
      element<HTMLAnchorElement>('#other-room-link').href = `/join/${session.roomCode}`;
    element('#my-seat').hidden = !me;
    disable(element('#join-button'), empty <= 0 || !waiting);
    if (me) {
      element('#my-nickname').textContent = me.nickname;
      element('#my-role').textContent = isOwner ? '你是房主，也参加这一局' : '已为你留好座位';
      const ready = element<HTMLButtonElement>('#ready-button');
      ready.textContent = me.ready ? '已准备 · 点击取消' : '我准备好了';
      ready.classList.toggle('is-ready', me.ready);
      disable(ready, !me.online || !waiting);
    }
    element('#owner-start').hidden = !isOwner;
    element('#owner-leave-hint').hidden = !isOwner;
    element('#bot-controls').hidden = !isOwner;
    element('#settings-panel').hidden = !isOwner;
    disable(element('#add-bot'), empty === 0 || !waiting);
    disable(element('#fill-bots'), empty === 0 || !waiting);
    disable(element('#leave-button'), !waiting);
    disable(
      element('#start-button'),
      !isOwner ||
        !room.engine.ready ||
        !waiting ||
        empty !== 0 ||
        readyHumans !== humans.length ||
        settingsDirty,
    );
    if (!settingsDirty) {
      setDraftMode(room.settings.mode, room.settings.playerCount);
      element<HTMLSelectElement>('#general-preset').value = room.settings.generalPreset;
      presetDescription();
    }
    element('#settings-state').textContent = settingsDirty
      ? '设置尚未保存，请点击保存房间设置。'
      : '修改玩法或增减席位后，真人需要重新准备。缩小房间时会自动移除多余 AI。';
    element<HTMLSelectElement>('#general-preset').disabled = !waiting;
    disable(element('#save-settings'), !waiting);
    app
      .querySelectorAll<HTMLButtonElement>('[data-mode]')
      .forEach((button) => disable(button, !waiting));
    if (me && !qrBound) {
      bindQr(initial.joinUrls, room.code, initial.entry);
      qrBound = true;
    }

    const list = element<HTMLUListElement>('#players');
    list.replaceChildren();
    for (let index = 0; index < room.settings.playerCount; index++) {
      const player = room.players[index];
      const item = document.createElement('li');
      item.className = `seat ${player ? player.kind : 'empty'}`;
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent =
        player?.kind === 'bot' ? 'AI' : player ? String(index + 1).padStart(2, '0') : '＋';
      const name = document.createElement('strong');
      name.textContent = player
        ? player.nickname +
          (player.id === room.ownerId ? '（房主）' : '') +
          (player.id === session.playerId ? '（你）' : '')
        : '虚位以待';
      const status = document.createElement('span');
      status.className = `seat-state ${player?.ready ? 'ready' : ''}`;
      status.textContent = player
        ? player.kind === 'bot'
          ? '自动准备'
          : !player.online
            ? '已断开'
            : player.ready
              ? '已准备'
              : '待准备'
        : '等朋友 / AI';
      item.append(avatar, name, status);
      if (isOwner && player && player.id !== room.ownerId) {
        const button = document.createElement('button');
        button.className = 'remove-player';
        button.type = 'button';
        button.textContent = '移除';
        button.setAttribute('aria-label', `移除 ${player.nickname}`);
        disable(button, !waiting);
        action(
          button,
          async () => {
            renderRoom(await api<RoomView>(`${roomPath}/players/${player.id}`, 'DELETE'));
          },
          refresh,
        );
        item.append(button);
      }
      list.append(item);
    }
    if (room.phase === 'closed') {
      events?.close();
      connection(false, '房间已关闭');
    }
  }

  function connectEvents(): void {
    events?.close();
    events = watchEvents(
      `${roomPath}/events`,
      'room',
      (snapshot) => renderRoom(snapshot as RoomView),
      initial.entry.mode === 'internet',
    );
  }

  element<HTMLFormElement>('#join-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void perform(
      element('#join-button'),
      async () => {
        const joined = await api<MembershipResult>(`${roomPath}/players`, 'POST', {
          nickname: element<HTMLInputElement>('#nickname').value,
        });
        session.playerId = joined.playerId;
        session.roomCode = room.code;
        renderRoom(joined.room);
        refresh();
        connectEvents();
        renderRoom((await api<RoomInfo>(roomPath)).room);
      },
      refresh,
    );
  });
  action(
    element('#ready-button'),
    async () => {
      const me = room.players.find((player) => player.id === session.playerId);
      renderRoom(await api<RoomView>(`${roomPath}/me/ready`, 'PUT', { ready: !me?.ready }));
    },
    refresh,
  );
  action(
    element('#leave-button'),
    async () => {
      await api(`${roomPath}/me`, 'DELETE');
      location.assign('/');
    },
    refresh,
  );
  action(
    element('#start-button'),
    async () => {
      renderRoom(await api<RoomView>(`${roomPath}/start`, 'POST'));
    },
    refresh,
  );
  action(
    element('#add-bot'),
    async () => {
      renderRoom(await api<RoomView>(`${roomPath}/bots`, 'POST', { count: 1 }));
    },
    refresh,
  );
  action(
    element('#fill-bots'),
    async () => {
      renderRoom(
        await api<RoomView>(`${roomPath}/bots`, 'POST', {
          count: room.settings.playerCount - room.players.length,
        }),
      );
    },
    refresh,
  );
  async function shareRoom() {
    element<HTMLDialogElement>('#share-dialog').showModal();
    try {
      const current = await api<RoomInfo>(roomPath);
      bindQr(current.joinUrls, room.code, current.entry ?? initial.entry);
    } catch {
      bindQr([], room.code, {
        ...initial.entry,
        status: 'unavailable',
        message: '邀请入口暂时无法连接，请稍后再试。',
      });
    }
  }
  element('#share-button').addEventListener('click', () => void shareRoom());
  element('#match-share').addEventListener('click', () => void shareRoom());
  action(
    element('#rematch-button'),
    async () => {
      renderRoom(await api<RoomView>(`${roomPath}/rematch`, 'POST', {}));
    },
    refresh,
  );
  element('#close-share').addEventListener('click', () =>
    element<HTMLDialogElement>('#share-dialog').close(),
  );
  const markDirty = () => {
    settingsDirty = true;
    refresh();
  };
  app.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) =>
    button.addEventListener('click', () => {
      setDraftMode(
        button.dataset.mode as ModeId,
        Number(element<HTMLSelectElement>('#player-count').value),
      );
      markDirty();
    }),
  );
  element('#player-count').addEventListener('change', markDirty);
  element('#general-preset').addEventListener('change', () => {
    presetDescription();
    markDirty();
  });
  action(
    element('#save-settings'),
    async () => {
      const updated = await api<RoomView>(roomPath, 'PUT', {
        mode: draftMode,
        playerCount: Number(element<HTMLSelectElement>('#player-count').value),
        generalPreset: element<HTMLSelectElement>('#general-preset').value,
        extensions: [],
      });
      settingsDirty = false;
      renderRoom(updated);
      message('房间设置已保存，请真人玩家重新准备。', true);
    },
    refresh,
  );
  renderRoom(room);
  connectEvents();
}
