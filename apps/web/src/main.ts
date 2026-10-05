import type { RoomInfo, ServerInfo, SessionView } from '../../../packages/shared/src/contracts.js';
import { api, app } from './ui.js';
import { showHomePage } from './lobby-page.js';
import { showServerPage } from './console-page.js';
import { showRoomPage } from './room-page.js';

async function initialize(): Promise<void> {
  // 清除旧原型 /host 链接迁移后留下的 fragment；服务器页不再有房主能力。
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const [info, session] = await Promise.all([
    api<ServerInfo>('/api/info'),
    api<SessionView>('/api/me'),
  ]);
  info.entry ??= { mode: 'lan', status: 'ready', message: '手机连接同一 Wi-Fi 或电脑热点后扫码。' };
  if (location.pathname === '/server') showServerPage(info);
  else if (location.pathname.startsWith('/join/')) {
    const code = location.pathname.split('/').at(-1)!;
    const room = await api<RoomInfo>(`/api/rooms/${code}`);
    room.entry ??= info.entry;
    showRoomPage(room, session);
  } else showHomePage(info, session);
}

void initialize().catch((error: unknown) => {
  app.className = 'error-page';
  app.replaceChildren();
  const heading = document.createElement('h1');
  heading.textContent = '暂时没找到牌桌';
  const text = document.createElement('p');
  text.textContent =
    error instanceof Error ? error.message : '连接暂时不可用，请确认手机联网，电脑仍在运行。';
  const retry = document.createElement('button');
  retry.className = 'button primary';
  retry.textContent = '重新连接';
  retry.addEventListener('click', () => location.reload());
  const home = document.createElement('a');
  home.className = 'button secondary';
  home.href = '/';
  home.textContent = '返回主页';
  app.append(heading, text, retry, home);
});
