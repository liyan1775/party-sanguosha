import {
  findMode,
  type MembershipResult,
  type RoomSummary,
  type ServerInfo,
  type SessionView,
} from '../../../packages/shared/src/contracts.js';
import { action, api, connection, element, frame, perform, watchEvents } from './ui.js';
import { bindQr, qrMarkup } from './qr.js';
import { startEngineSupervisor } from './engine-supervisor.js';
import { bindGeneralGuide, guideButton } from './general-guide.js';
import { createAssetPreloader } from './engine-preloader.js';

function roomList(rooms: RoomSummary[], serverPage: boolean): void {
  const list = element('#room-list');
  list.replaceChildren();
  element('#empty-rooms').hidden = rooms.length > 0;
  element('#room-total').textContent = `${rooms.length} 间`;
  for (const room of rooms) {
    const item = document.createElement('li');
    item.className = 'room-list-item';
    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = `${room.ownerNickname}的房间`;
    const description = document.createElement('p');
    description.textContent = `${findMode(room.mode)?.name} · ${room.humanCount} 真人 + ${room.botCount} AI / ${room.playerCount} 席 · ${room.code}`;
    details.append(name, description);
    const label = document.createElement(serverPage ? 'span' : 'a');
    const canJoin = room.phase === 'waiting' && room.humanCount + room.botCount < room.playerCount;
    label.textContent = canJoin ? '加入房间' : room.phase === 'waiting' ? '已满' : '对局中';
    label.className = serverPage ? 'tag muted' : 'button secondary room-link';
    if (label instanceof HTMLAnchorElement) label.href = `/join/${room.code}`;
    if (serverPage && canJoin) label.textContent = '等朋友';
    item.append(details, label);
    list.append(item);
  }
}

const listMarkup = `<section class="panel rooms-panel"><div class="panel-heading"><h2>朋友的房间</h2><span id="room-total" class="tag muted"></span></div><ul id="room-list" class="room-list"></ul><p id="empty-rooms" class="empty-rooms">还没有牌桌。第一位朋友可以先开一间。</p></section>`;

export function showServerPage(info: ServerInfo): void {
  const internet = info.entry.mode === 'internet';
  frame(
    'server-layout',
    '电脑已就位',
    '扫这里，上桌。',
    '电脑负责开服。朋友扫码进入主页，自己创建房间、邀请同伴。',
    `
    <div class="server-grid"><section class="panel invite-panel"><div class="panel-heading"><h2>扫码进入主页</h2><span id="entry-label" class="tag">${internet ? '跨网络' : '局域网'}</span></div><p id="entry-status" class="hint" role="status"></p>${qrMarkup('玩家主页二维码', '微信扫一扫 · 进入聚会三国杀主页')}<button id="refresh-address" class="button text-button full-width" type="button">${internet ? '刷新连接状态' : '刷新局域网地址'}</button></section>
    <div class="server-details"><section class="panel"><h2>开一桌，只需三步</h2><ol class="steps"><li><strong>${internet ? '朋友各自联网' : '连上同一个 Wi-Fi'}</strong><p>${internet ? '家里 Wi-Fi、外地网络或手机流量均可，无需安装软件或设置路由器。' : '也可以让手机连接这台电脑的热点。'}</p></li><li><strong>扫码，由玩家建房</strong><p>填写昵称，创建房间的玩家成为房主并参加这一局。</p></li><li><strong>分享房间，等朋友到齐</strong><p>房间内每位玩家都能展示邀请二维码，房主可以用 AI 补足人数。</p></li></ol><p class="hint">整局请让电脑保持运行、页面开启${internet ? '、联网' : ''}，并避免休眠。聚会结束后，双击「停止聚会三国杀」。</p></section>${listMarkup}</div></div>`,
  );
  function renderEntry(updated: ServerInfo) {
    element('#entry-status').textContent = updated.entry.message;
    bindQr(updated.homeUrls, undefined, updated.entry);
  }
  renderEntry(info);
  roomList(info.rooms, true);
  connection(true, '服务在线');
  action(element('#refresh-address'), async () => {
    renderEntry(await api<ServerInfo>('/api/info'));
  });
  watchEvents('/api/events', 'lobby', (rooms) => roomList(rooms as RoomSummary[], true));
  if (internet) {
    let checking = false;
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void api<ServerInfo>('/api/info')
        .then(renderEntry)
        .catch(() => {
          renderEntry({
            ...info,
            homeUrls: [],
            entry: {
              mode: 'internet',
              status: 'unavailable',
              message: '电脑服务已停止，请重新双击启动。',
            },
          });
        })
        .finally(() => {
          checking = false;
        });
    }, 2000);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  }
  startEngineSupervisor();
}

export function showHomePage(info: ServerInfo, session: SessionView): void {
  frame(
    'player-layout home-layout',
    '朋友的聚会大厅',
    '找张桌，一起玩。',
    '自己开房，或者加入朋友的房间。无需注册账号。',
    `
    <section id="current-room" class="panel current-room" hidden><h2>你的座位还在</h2><p class="hint">刷新、回到主页后，可以继续返回原房间。</p><a id="return-room" class="button primary full-width" href="/">返回我的房间</a></section>
    <section class="panel" id="create-panel"><div class="panel-heading"><h2>我来开一桌</h2><span class="tag">你是房主</span></div><form id="create-form"><label for="nickname">怎么称呼你</label><input id="nickname" name="nickname" placeholder="输入昵称，朋友才认得你" autocomplete="nickname" maxlength="32" required /><p class="hint">创建后你会自动入座，可以设置玩法、武将范围和 AI。昵称 1–16 个字。</p><button id="create-button" class="button primary full-width" type="submit">创建房间并入座</button></form></section>
    <section class="panel guide-panel"><h2>上桌前看看</h2><p class="hint">新手档和进阶档的武将、技能都可以在这里查看。</p>${guideButton}<p id="engine-preload" class="hint" role="status" hidden></p></section>${listMarkup}`,
  );
  bindGeneralGuide();
  createAssetPreloader(element('#engine-preload')).update(Boolean(info.engine.preload));
  const renderSession = () => {
    element('#current-room').hidden = !session.roomCode;
    element('#create-panel').hidden = Boolean(session.roomCode);
    if (session.roomCode)
      element<HTMLAnchorElement>('#return-room').href = `/join/${session.roomCode}`;
  };
  renderSession();
  roomList(info.rooms, false);
  element<HTMLFormElement>('#create-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void perform(element('#create-button'), async () => {
      const created = await api<MembershipResult>('/api/rooms', 'POST', {
        nickname: element<HTMLInputElement>('#nickname').value,
      });
      location.assign(`/join/${created.room.code}`);
    });
  });
  watchEvents(
    '/api/events',
    'lobby',
    (rooms) => {
      roomList(rooms as RoomSummary[], false);
      void api<SessionView>('/api/me')
        .then((updated) => {
          session = updated;
          renderSession();
        })
        .catch(() => {});
    },
    info.entry.mode === 'internet',
  );
}
