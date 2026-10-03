import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_ID, APP_VERSION, type ExtensionInfo } from '../../../packages/shared/src/contracts.js';
import { createPartyServer } from './server.js';
import { findHomeUrls, isLoopbackPortOccupied } from './network.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const preferredPort = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535)
  throw new Error('PORT 需要是 1–65535 之间的端口。');
const publicUrl = process.env.PUBLIC_URL;
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
const runtime = path.join(root, '.runtime');
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
  `\n聚会三国杀 v${APP_VERSION}\n电脑服务页：${serverUrl}\n${homeUrls.length ? homeUrls.map((url) => `玩家主页：${url}`).join('\n') : '尚未检测到局域网 IPv4 地址，请连接 Wi-Fi 或开启电脑热点。'}\n玩家扫码进入主页后自行建房，电脑不占席位。\n当前可测试大厅与 AI 席位，无名杀对局及 AI 出牌尚未接入。\n`,
);
process.once('SIGINT', party.stop);
process.once('SIGTERM', party.stop);
