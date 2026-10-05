import {
  findMode,
  type MembershipResult,
  type RoomSummary,
  type ServerInfo,
  type SessionView,
} from '../../../packages/shared/src/contracts.js';
import { action, api, connection, element, frame, perform, watchEvents } from './ui.js';
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
