import {
  GENERAL_PRESETS,
  MODES,
  findMode,
  type ApiError,
  type ModeId,
  type RoomView,
  type ServerInfo,
  type SessionView,
} from '../../../packages/shared/src/contracts.js';

const app = document.querySelector<HTMLElement>('#app')!;
let info: ServerInfo;
let session: SessionView;
let room: RoomView;
let events: EventSource | undefined;
let settingsDirty = false;
let draftMode: ModeId = 'identity';
const hostPage = location.pathname === '/host';

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const result = app.querySelector<T>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: T | ApiError = await response.json();
  if (!response.ok) throw new Error((data as ApiError).error?.message ?? '连接失败，请稍后再试。');
  return data as T;
}

function message(text: string, success = false): void {
  const target = element('#message');
  target.textContent = text;
  target.classList.toggle('success', success);
  target.hidden = !text;
}

function action(button: HTMLButtonElement, callback: () => Promise<void>): void {
  button.addEventListener('click', () => {
    void perform(button, callback);
  });
}

async function perform(button: HTMLButtonElement, callback: () => Promise<void>): Promise<void> {
  button.disabled = true;
  message('');
  try {
    await callback();
  } catch (error) {
    message(error instanceof Error ? error.message : '操作失败，请重试。');
  } finally {
    button.disabled = false;
    renderRoom(room);
  }
}

function buildPage(): void {
  app.className = hostPage ? 'host-layout' : 'player-layout';
  app.innerHTML = `
    <header class="masthead"><a class="brand" href="/" aria-label="聚会三国杀首页"><span class="seal">杀</span><span>聚会三国杀<small>一桌朋友，一场好戏</small></span></a><span id="connection" class="connection">正在连接</span></header>
    <section class="intro"><p class="eyebrow">${hostPage ? '房主的牌桌' : '朋友已经在等你'}</p><h1>${hostPage ? '人到齐，就开局。' : '就差你入座了。'}</h1><p>${hostPage ? '选好玩法，让朋友连接同一个 Wi-Fi，扫码入座。' : '连上同一个 Wi-Fi，取个昵称，一起上桌。'}</p></section>
    <div id="message" class="message" role="alert" hidden></div>
    <div class="table-layout">
      ${
        hostPage
          ? `
        <section class="panel invite-panel"><div class="panel-heading"><h2>扫码入座</h2><span class="tag">局域网</span></div><div class="qr-frame"><img id="qr" alt="玩家加入房间的二维码" hidden /><p id="qr-placeholder">正在确认局域网地址…</p></div><p class="qr-caption">微信扫一扫 · 无需安装</p><div class="room-code">房间 <strong id="room-code"></strong></div><label class="field-label" for="network-address">玩家入口地址</label><select id="network-address" aria-label="选择玩家入口地址"></select><div class="copy-row"><input id="join-url" aria-label="玩家邀请链接" readonly /><button id="copy-link" class="button subtle" type="button">复制</button></div><p class="hint">有多个网卡时，选择与手机同一个 Wi-Fi 的地址。扫码打不开时，可复制链接到手机浏览器。</p></section>
        <section class="panel settings-panel"><div class="panel-heading"><h2>这一局，怎么玩</h2><span class="tag muted">房主设置</span></div><div class="mode-grid">${MODES.map((mode) => `<button type="button" class="mode-card" data-mode="${mode.id}" aria-pressed="false"><span class="mode-mark">${mode.id === 'identity' ? '主' : mode.id === 'doudizhu' ? '地' : mode.id === 'versus' ? '盟' : '决'}</span><strong>${mode.name}</strong><small>${mode.minPlayers === mode.maxPlayers ? mode.minPlayers : '5–8'} 人</small></button>`).join('')}</div><p id="mode-description" class="mode-description"></p><div class="field-row"><label for="player-count">参与人数<select id="player-count"></select></label><label for="general-preset">武将范围<select id="general-preset">${GENERAL_PRESETS.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join('')}</select></label></div><p id="preset-description" class="hint"></p><div class="extensions"><h3>扩展包</h3><p class="hint">暂无已接入的扩展包</p></div><button id="save-settings" class="button secondary full-width" type="button">保存房间设置</button><p id="settings-state" class="hint">修改模式或武将范围后，玩家需要重新准备。</p></section>`
          : `
        <section class="panel welcome-panel"><div class="panel-heading"><h2 id="room-title">朋友的牌桌</h2><span class="tag" id="player-room-code"></span></div><div class="game-summary"><span id="summary-mode" class="summary-mode"></span><span id="summary-details"></span></div><p id="summary-preset" class="hint"></p><form id="join-form"><label for="nickname">怎么称呼你</label><input id="nickname" name="nickname" placeholder="输入昵称，朋友才认得你" autocomplete="nickname" maxlength="32" required /><p class="hint">昵称 1–16 个字，无需注册账号。</p><button id="join-button" class="button primary full-width" type="submit">入座</button></form><div id="my-seat" hidden><p class="my-seat-label">已为你留好座位</p><h3 id="my-nickname"></h3><button id="ready-button" class="button primary full-width" type="button">我准备好了</button><button id="leave-button" class="button text-button full-width" type="button">离开房间</button></div></section>`
      }
      <section class="panel players-panel"><div class="panel-heading"><h2>等朋友到齐</h2><span id="player-counter" class="tag muted"></span></div><ul id="players" class="players"></ul><p id="waiting-text" class="waiting-text"></p>${hostPage ? '<button id="start-button" class="button primary full-width" type="button" disabled>开始对局</button><p id="engine-status" class="hint engine-status"></p>' : '<p class="hint">准备后请保持页面开启，房主会安排开局。</p>'}</section>
    </div><footer>扫码房间原型 · 当前可以入座与准备，对局功能尚未开放</footer>`;

  if (hostPage) bindHost();
  else bindPlayer();
}

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
  for (let value = mode.minPlayers; value <= mode.maxPlayers; value++) {
    const option = new Option(`${value} 人`, String(value));
    select.add(option);
  }
  select.value = String(
    count >= mode.minPlayers && count <= mode.maxPlayers ? count : mode.minPlayers,
  );
  select.disabled = mode.minPlayers === mode.maxPlayers;
  element('#mode-description').textContent = mode.description;
}

function updatePresetDescription(): void {
  const selected = element<HTMLSelectElement>('#general-preset').value;
  element('#preset-description').textContent =
    GENERAL_PRESETS.find((preset) => preset.id === selected)?.description ?? '';
}

function bindHost(): void {
  const network = element<HTMLSelectElement>('#network-address');
  for (const url of info.joinUrls) {
    const parsed = new URL(url);
    network.add(new Option(parsed.host, url));
  }
  const updateQr = () => {
    const url = network.value;
    const image = element<HTMLImageElement>('#qr');
    element<HTMLInputElement>('#join-url').value = url;
    image.hidden = !url;
    if (url) image.src = `/api/qr.svg?url=${encodeURIComponent(url)}`;
    element('#qr-placeholder').hidden = Boolean(url);
    if (!url)
      element('#qr-placeholder').textContent =
        '电脑暂未连接局域网，请连接 Wi-Fi 或开启热点后重启服务。';
  };
  network.addEventListener('change', updateQr);
  updateQr();
  action(element('#copy-link'), async () => {
    const input = element<HTMLInputElement>('#join-url');
    if (!input.value) throw new Error('暂时没有可用的局域网地址。');
    if (!navigator.clipboard) {
      input.focus();
      input.select();
      message('邀请链接已选中，请手动复制。', true);
      return;
    }
    await navigator.clipboard.writeText(input.value);
    message('玩家邀请链接已复制。', true);
  });
  const markDirty = () => {
    settingsDirty = true;
    element('#settings-state').textContent = '设置尚未保存，请点击保存房间设置。';
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
    updatePresetDescription();
    markDirty();
  });
  action(element('#save-settings'), async () => {
    const updated = await api<RoomView>('/api/room', 'PUT', {
      mode: draftMode,
      playerCount: Number(element<HTMLSelectElement>('#player-count').value),
      generalPreset: element<HTMLSelectElement>('#general-preset').value,
      extensions: [],
    });
    settingsDirty = false;
    renderRoom(updated);
    message('房间设置已保存，请朋友重新准备。', true);
  });
  action(element('#start-button'), async () => {
    renderRoom(await api<RoomView>('/api/room/start', 'POST'));
  });
}

function bindPlayer(): void {
  const form = element<HTMLFormElement>('#join-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void perform(element('#join-button'), async () => {
      const result = await api<{ playerId: string }>('/api/players', 'POST', {
        code: room.code,
        nickname: element<HTMLInputElement>('#nickname').value,
      });
      session.playerId = result.playerId;
      connectEvents();
      renderRoom((await api<ServerInfo>('/api/info')).room);
    });
  });
  action(element('#ready-button'), async () => {
    const me = room.players.find((player) => player.id === session.playerId);
    await api('/api/me/ready', 'PUT', { ready: !me?.ready });
  });
  action(element('#leave-button'), async () => {
    await api('/api/me', 'DELETE');
    session.playerId = null;
    connectEvents();
    renderRoom((await api<ServerInfo>('/api/info')).room);
  });
}

function renderRoom(snapshot: RoomView): void {
  // HTTP 响应可能晚于更新的 SSE 消息到达，不允许旧快照覆盖在线状态。
  if (room && room.code === snapshot.code && snapshot.revision < room.revision) return;
  room = snapshot;
  const mode = findMode(room.settings.mode)!;
  const preset = GENERAL_PRESETS.find((entry) => entry.id === room.settings.generalPreset)!;
  element('#player-counter').textContent =
    `${room.players.length} / ${room.settings.playerCount} 人`;
  const list = element<HTMLUListElement>('#players');
  list.replaceChildren();
  for (let index = 0; index < room.settings.playerCount; index++) {
    const player = room.players[index];
    const item = document.createElement('li');
    item.className = `seat ${player ? '' : 'empty'}`;
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = player ? String(index + 1).padStart(2, '0') : '＋';
    const name = document.createElement('strong');
    name.textContent = player
      ? player.nickname + (player.id === session.playerId ? '（你）' : '')
      : '虚位以待';
    const status = document.createElement('span');
    status.className = `seat-state ${player?.ready ? 'ready' : ''}`;
    status.textContent = player
      ? player.online
        ? player.ready
          ? '已准备'
          : '待准备'
        : '已断开'
      : '等朋友';
    item.append(avatar, name, status);
    if (hostPage && player) {
      const button = document.createElement('button');
      button.className = 'remove-player';
      button.type = 'button';
      button.textContent = '移出';
      button.setAttribute('aria-label', `移出 ${player.nickname}`);
      action(button, async () => {
        await api(`/api/players/${player.id}`, 'DELETE');
      });
      item.append(button);
    }
    list.append(item);
  }
  const readyCount = room.players.filter((player) => player.online && player.ready).length;
  element('#waiting-text').textContent =
    `${readyCount} 位朋友已准备，${room.settings.playerCount - room.players.length} 个座位等你们坐满。`;
  if (hostPage) {
    element('#room-code').textContent = room.code;
    if (!settingsDirty) {
      setDraftMode(room.settings.mode, room.settings.playerCount);
      element<HTMLSelectElement>('#general-preset').value = room.settings.generalPreset;
      updatePresetDescription();
      element('#settings-state').textContent = '修改模式或武将范围后，玩家需要重新准备。';
    }
    element<HTMLButtonElement>('#start-button').disabled =
      !room.engine.ready ||
      room.phase !== 'waiting' ||
      readyCount !== room.settings.playerCount ||
      !room.hostOnline;
    element('#engine-status').textContent = room.engine.message;
  } else {
    element('#player-room-code').textContent = `房间 ${room.code}`;
    element('#summary-mode').textContent = mode.name;
    element('#summary-details').textContent = `${room.settings.playerCount} 人 · ${preset.name}`;
    element('#summary-preset').textContent = preset.description;
    const me = room.players.find((player) => player.id === session.playerId);
    element('#join-form').hidden = Boolean(me);
    element('#my-seat').hidden = !me;
    element<HTMLButtonElement>('#join-button').disabled =
      room.players.length >= room.settings.playerCount || room.phase !== 'waiting';
    if (me) {
      element('#my-nickname').textContent = me.nickname;
      const ready = element<HTMLButtonElement>('#ready-button');
      ready.textContent = me.ready ? '已准备 · 点击取消' : '我准备好了';
      ready.classList.toggle('is-ready', me.ready);
      ready.disabled = !me.online || room.phase !== 'waiting';
    }
  }
}

function connectEvents(): void {
  events?.close();
  events = new EventSource(`/api/events?room=${room.code}`);
  const indicator = element('#connection');
  events.addEventListener('open', () => {
    indicator.textContent = '已连接牌桌';
    indicator.classList.add('online');
  });
  events.addEventListener('room', (event) => {
    renderRoom(JSON.parse((event as MessageEvent<string>).data) as RoomView);
  });
  events.addEventListener('error', () => {
    indicator.textContent = '连接断开，正在重连';
    indicator.classList.remove('online');
  });
}

async function initialize(): Promise<void> {
  if (hostPage && location.hash.length > 1) {
    const secret = location.hash.slice(1);
    history.replaceState(null, '', location.pathname);
    await api('/api/host-session', 'POST', { secret });
  }
  [info, session] = await Promise.all([api<ServerInfo>('/api/info'), api<SessionView>('/api/me')]);
  const invitedCode = location.pathname.startsWith('/join/')
    ? location.pathname.split('/').at(-1)
    : undefined;
  if (invitedCode && invitedCode !== info.room.code)
    throw new Error('这张邀请已失效，请重新扫描电脑上的二维码。');
  if (hostPage && !session.host)
    throw new Error('请使用电脑终端中显示的房主链接进入，普通玩家链接没有房主权限。');
  room = info.room;
  buildPage();
  renderRoom(room);
  connectEvents();
}

void initialize().catch((error: unknown) => {
  app.className = 'error-page';
  app.replaceChildren();
  const heading = document.createElement('h1');
  heading.textContent = '暂时没找到牌桌';
  const text = document.createElement('p');
  text.textContent =
    error instanceof Error ? error.message : '无法连接电脑，请确认连接了同一个 Wi-Fi。';
  const button = document.createElement('button');
  button.className = 'button primary';
  button.textContent = '重新连接';
  button.addEventListener('click', () => location.reload());
  app.append(heading, text, button);
});
