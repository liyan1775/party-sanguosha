import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

if (
  process.platform !== 'win32' ||
  process.arch !== 'x64' ||
  process.versions.node.split('.')[0] !== '24'
)
  throw new Error('Build this release with Windows x64 Node.js 24.');
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json')));
const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
const connector = JSON.parse(await readFile(resolve(root, 'config/public-connector.json')));
const releaseRoot = resolve(root, '.runtime/releases');
const name = `聚会三国杀-v${pkg.version}-Windows-x64`;
await mkdir(releaseRoot, { recursive: true });
// Always package a fresh directory: a previously tested copy may have cookies,
// local configuration or an instance shutdown token in its .runtime folder.
const staging = await mkdtemp(resolve(releaseRoot, '.package-'));
const target = resolve(staging, name);
const within = relative(releaseRoot, target);
if (within.startsWith('..') || isAbsolute(within)) throw new Error('Invalid release path');
await mkdir(target, { recursive: true });
execFileSync(
  process.execPath,
  ['--use-env-proxy', resolve(root, 'scripts/prepare-noname-lab.mjs')],
  { cwd: root, stdio: 'inherit' },
);
execFileSync(process.execPath, [resolve(root, 'scripts/build.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
execFileSync(
  process.execPath,
  ['--use-env-proxy', resolve(root, 'scripts/prepare-public-connector.mjs')],
  { cwd: root, stdio: 'inherit' },
);
for (const entry of [
  'dist',
  'apps',
  'packages',
  'config',
  'docs',
  'extensions',
  'notices',
  'scripts',
  'tests',
  '.github',
  'README.md',
  'AGENTS.md',
  'CHANGELOG.md',
  'THIRD_PARTY_NOTICES.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'playwright.config.ts',
  '.prettierrc.json',
  '.gitignore',
  '.env.example',
  '启动聚会三国杀.cmd',
  '启动局域网聚会三国杀.cmd',
  '停止聚会三国杀.cmd',
]) {
  await cp(resolve(root, entry), resolve(target, entry), { recursive: true });
}
await cp(
  resolve(root, `.local/noname/${candidate.tag}`),
  resolve(target, `.local/noname/${candidate.tag}`),
  { recursive: true },
);
const connectorPath = `.local/connector/${connector.version}/${process.platform}-${process.arch}`;
await mkdir(resolve(target, connectorPath), { recursive: true });
await cp(
  resolve(root, connectorPath, 'cloudflared.exe'),
  resolve(target, connectorPath, 'cloudflared.exe'),
);
const runtime = resolve(target, '.local/runtime');
await mkdir(runtime, { recursive: true });
await cp(process.execPath, resolve(runtime, 'node.exe'));
const nodeLicenseCache = resolve(root, '.local/licenses', `node-${process.version}-LICENSE.txt`);
let nodeLicense = await readFile(resolve(dirname(process.execPath), 'LICENSE')).catch(() =>
  readFile(nodeLicenseCache).catch(() => null),
);
let licenseFailure;
for (let attempt = 0; !nodeLicense && attempt < 3; attempt++) {
  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw new Error('Cannot retrieve the matching Node.js license');
    nodeLicense = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    licenseFailure = error;
    if (attempt < 2) await delay(1000 * (attempt + 1));
  }
}
if (!nodeLicense) throw licenseFailure;
await mkdir(dirname(nodeLicenseCache), { recursive: true });
await writeFile(nodeLicenseCache, nodeLicense);
await writeFile(resolve(runtime, 'node-LICENSE.txt'), nodeLicense);
const meta = JSON.parse(await readFile(resolve(root, '.runtime/server-build-meta.json')));
const bundledPackages = new Set(
  Object.keys(meta.inputs)
    .filter((input) => input.includes('node_modules/'))
    .map(
      (input) =>
        input
          .split('node_modules/')
          .at(-1)
          .match(/^(@[^/]+\/[^/]+|[^/]+)/)[0],
    ),
);
for (const name of bundledPackages) {
  const moduleRoot = resolve(root, 'node_modules', name);
  const files = ['LICENSE', 'license', 'LICENSE.txt', 'LICENSE-MIT', 'LICENSE.md'];
  let license;
  for (const file of files) {
    license = await readFile(resolve(moduleRoot, file)).catch(() => null);
    if (license) break;
  }
  if (!license) throw new Error(`Bundled package license missing: ${name}`);
  const folder = resolve(target, 'notices/npm', name);
  await mkdir(folder, { recursive: true });
  await writeFile(resolve(folder, 'LICENSE.txt'), license);
  await cp(resolve(moduleRoot, 'package.json'), resolve(folder, 'package.json'));
}
await cp(
  resolve(root, 'node_modules/ws/LICENSE'),
  resolve(target, 'packages/noname-adapter/licenses/ws-MIT.txt'),
);
await cp(
  resolve(root, 'node_modules/qrcode/license'),
  resolve(target, 'packages/noname-adapter/licenses/qrcode-MIT.txt'),
);
await writeFile(
  resolve(target, 'portable.json'),
  `${JSON.stringify(
    {
      version: pkg.version,
      node: process.version,
      nodeSha256: createHash('sha256')
        .update(await readFile(process.execPath))
        .digest('hex'),
      noname: candidate.tag,
      commit: candidate.commit,
      connector: {
        version: connector.version,
        sha256: connector.artifacts[`${process.platform}-${process.arch}`].sha256,
      },
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  resolve(target, '开始使用.txt'),
  '1. 解压完整文件夹。\r\n2. 双击“启动聚会三国杀.cmd”，等待跨网络二维码。电脑保持联网、页面开启并避免休眠。\r\n3. 手机用各自 Wi-Fi 或流量扫码，由一个玩家填写昵称开房，无需安装软件或配置网络。\r\n4. 房主设置玩法、添加 AI，真人准备后开始对局。微信锁定竖屏时横着握手机，可用按钮切回竖屏。\r\n5. 聚会结束后双击“停止聚会三国杀.cmd”，下次启动重新分享二维码。\r\n此包包含运行环境、固定联网组件和游戏资源，无需安装 Node.js 或另下载组件。临时公网服务需要互联网。\r\n没有互联网时，双击“启动局域网聚会三国杀.cmd”，所有手机连接同一 Wi-Fi 或电脑热点。两种入口共用一个本地服务实例，切换前先停止。\r\n',
);
const archive = resolve(releaseRoot, `${name}.zip`);
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -LiteralPath ${quote(target)} -DestinationPath ${quote(archive)} -Force`,
  ],
  { stdio: 'inherit' },
);
const bytes = await readFile(archive);
await writeFile(
  `${archive}.sha256`,
  `${createHash('sha256').update(bytes).digest('hex')}  ${name}.zip\n`,
);
const cleanupPath = resolve(staging);
const cleanupWithin = relative(releaseRoot, cleanupPath);
if (!cleanupWithin || cleanupWithin.startsWith('..') || isAbsolute(cleanupWithin))
  throw new Error('Invalid package staging cleanup path');
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Remove-Item -LiteralPath ${quote(cleanupPath)} -Recurse -Force`,
  ],
  { stdio: 'inherit' },
);
console.log(`Created ${archive} (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)`);
