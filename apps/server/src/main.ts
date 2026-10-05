import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_ID, APP_VERSION, type ExtensionInfo } from '../../../packages/shared/src/contracts.js';
import { createPartyServer } from './server.js';
import { findHomeUrls, isLoopbackPortOccupied } from './network.js';
import { NativeNonameService } from '../../../packages/noname-adapter/src/service.js';
import { managePublicEntry } from './public-tunnel.js';

const root = process.env.PARTY_PROJECT_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
const preferredPort = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535)
  throw new Error('PORT 需要是 1–65535 之间的端口。');
const publicUrl = process.env.PUBLIC_URL;
const entryMode = process.env.PARTY_NETWORK ?? 'internet';
if (!['internet', 'lan'].includes(entryMode))
  throw new Error('PARTY_NETWORK 需要是 internet 或 lan。');
if (entryMode === 'internet' && publicUrl)
  throw new Error('跨网络启动会自动生成地址，请移除 PUBLIC_URL，或使用局域网启动。');
const extensions = JSON.parse(
  await readFile(path.join(root, 'config/extensions.json'), 'utf8'),
) as ExtensionInfo[];
if (!Array.isArray(extensions) || extensions.length !== 0)
  throw new Error('扩展接入尚未完成，config/extensions.json 当前应保持空列表。');
findHomeUrls(preferredPort, publicUrl);
const party = createPartyServer({
  webRoot: path.join(root, 'dist/web'),
  port: preferredPort,
  ...(publicUrl ? { publicUrl } : {}),
  extensions,
  adapter: new NativeNonameService(root),
  entryMode: entryMode as 'internet' | 'lan',
});
let port = preferredPort;
while (true) {
  try {
    if (await isLoopbackPortOccupied(port))
      throw Object.assign(new Error('Loopback port occupied'), { code: 'EADDRINUSE' });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        party.server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        party.server.off('error', onError);
        resolve();
      };
      party.server.once('error', onError);
      party.server.once('listening', onListening);
      party.server.listen(port, process.env.BIND_HOST ?? '0.0.0.0');
    });
    break;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    if (
      process.env.PARTY_AUTO_PORT === '1' &&
      !publicUrl &&
      port < Math.min(65535, preferredPort + 20)
    ) {
      console.log(`端口 ${port} 被其他程序使用，尝试下一个端口。`);
      port++;
    } else throw new Error(`端口 ${port} 已被占用，请修改 .env 中的 PORT。没有终止其他程序。`);
  }
}
const serverUrl = `http://127.0.0.1:${port}/server`;
const homeUrls = findHomeUrls(port, publicUrl);
const runtime = path.resolve(root, process.env.PARTY_RUNTIME_DIR ?? '.runtime');
const runtimeWithin = path.relative(path.join(root, '.runtime'), runtime);
if (runtimeWithin.startsWith('..') || path.isAbsolute(runtimeWithin))
  throw new Error('运行文件必须位于本项目 .runtime 内。');
await mkdir(runtime, { recursive: true });
const temporarySession = path.join(runtime, `session-${process.pid}.json`);
await writeFile(
  temporarySession,
  JSON.stringify(
    {
      app: APP_ID,
      version: APP_VERSION,
      instanceId: party.instanceId,
      controlToken: party.controlToken,
      pid: process.pid,
      serverUrl,
      entryMode,
      homeUrls,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
  { mode: 0o600 },
);
await rename(temporarySession, path.join(runtime, 'session.json'));
console.log(
  `\n聚会三国杀 v${APP_VERSION}\n电脑服务页：${serverUrl}\n${homeUrls.length ? homeUrls.map((url) => `局域网玩家主页：${url}`).join('\n') : '尚未检测到局域网 IPv4 地址，请连接 Wi-Fi 或开启电脑热点。'}\n${entryMode === 'internet' ? '正在额外准备公网入口；局域网可立即扫码，公网状态不影响本地牌桌。\n' : ''}玩家扫码进入主页后自行建房，电脑不占席位。\n保持电脑服务页开启，由手机房主开始对局。\n`,
);
if (entryMode === 'internet') {
  const internet = managePublicEntry({
    root,
    runtime,
    port,
    instanceId: party.instanceId,
    hasRooms: () => party.lobby.list().length > 0,
    update: party.setInternetEntry,
  });
  party.setInternetRetry(() => void internet.start());
  party.server.once('close', internet.close);
  void internet.start();
}
process.once('SIGINT', party.stop);
process.once('SIGTERM', party.stop);
