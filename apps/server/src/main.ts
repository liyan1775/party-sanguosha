import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ExtensionInfo } from '../../../packages/shared/src/contracts.js';
import { createPartyServer } from './server.js';
import { findJoinUrls } from './network.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT 需要是 1–65535 之间的端口。');
const publicUrl = process.env.PUBLIC_URL;
const extensions = JSON.parse(
  await readFile(path.join(root, 'config/extensions.json'), 'utf8'),
) as ExtensionInfo[];
if (!Array.isArray(extensions) || extensions.length !== 0)
  throw new Error('扩展接入尚未完成，config/extensions.json 当前应保持空列表。');
// 在监听端口前验证显式的对外地址，避免运行一个无法扫码访问的实例。
findJoinUrls(port, '000000', publicUrl);
const party = createPartyServer({
  webRoot: path.join(root, 'dist/web'),
  port,
  ...(publicUrl ? { publicUrl } : {}),
  extensions,
});
await new Promise<void>((resolve, reject) => {
  party.server.once('error', reject);
  party.server.listen(port, process.env.BIND_HOST ?? '0.0.0.0', resolve);
}).catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') throw new Error(`端口 ${port} 已被占用，请修改 PORT。`);
  throw error;
});
const hostUrl = `http://127.0.0.1:${port}/host#${party.hostSecret}`;
const joinUrls = findJoinUrls(port, party.room.code, publicUrl);
const runtime = path.join(root, '.runtime');
await mkdir(runtime, { recursive: true });
await writeFile(
  path.join(runtime, 'session.json'),
  JSON.stringify(
    {
      pid: process.pid,
      hostUrl,
      joinUrls,
      roomCode: party.room.code,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
  { mode: 0o600 },
);
console.log(
  `\n聚会三国杀 · 扫码房间 v0.1.0\n电脑房主：${hostUrl}\n${joinUrls.length ? joinUrls.map((url) => `玩家入口：${url}`).join('\n') : '尚未检测到局域网 IPv4 地址，请连接 Wi-Fi 或开启电脑热点。'}\n当前可测试扫码入座与准备，无名杀对局尚未接入。\n`,
);
const stop = () => {
  party.closeStreams();
  party.server.close();
  party.server.closeIdleConnections();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
