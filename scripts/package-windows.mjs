import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { clientArt } from './client-art.mjs';
import { verifyBuildManifest, writeBuildManifest } from './build-manifest.mjs';

if (
  process.platform !== 'win32' ||
  process.arch !== 'x64' ||
  process.versions.node.split('.')[0] !== '24'
)
  throw new Error('Build this release with Windows x64 Node.js 24.');
const root = fileURLToPath(new URL('../', import.meta.url));
const duplicatedArt = new Set(clientArt.map((file) => resolve(root, 'apps/web/src/assets', file)));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json')));
const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
const connector = JSON.parse(await readFile(resolve(root, 'config/public-connector.json')));
const releaseRoot = resolve(root, '.runtime/releases');
const starter = process.argv.includes('--starter');
const { portraits } = JSON.parse(await readFile(resolve(root, 'config/shanhetu-portraits.json')));
const portraitMiB = (
  portraits.reduce((total, portrait) => total + portrait.bytes, 0) / 1048576
).toFixed(1);
const name = starter
  ? `party-sanguosha-v${pkg.version}-windows-x64-setup`
  : `聚会三国杀-v${pkg.version}-Windows-x64`;
const packageEntries = [
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
  'LICENSE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'playwright.config.ts',
  '.prettierrc.json',
  '.prettierignore',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.env.example',
  '启动聚会三国杀.cmd',
  '无黑框启动聚会三国杀.vbs',
  '启动局域网聚会三国杀.cmd',
  '停止聚会三国杀.cmd',
];

function includeInPackage(source) {
  if (duplicatedArt.has(source)) return false;
  if (source === resolve(root, 'packages/noname-adapter/runtime/assets')) return false;
  if (relative(resolve(root, '.github/workflows'), source) === 'pages.yml') return false;
  return !starter || !relative(resolve(root, 'dist'), source).match(/^engine(?:[\\/]|$)/);
}
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
function compress(folder, archive) {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Compress-Archive -LiteralPath ' +
        quote(folder) +
        ' -DestinationPath ' +
        quote(archive) +
        ' -Force',
    ],
    { stdio: 'inherit' },
  );
}

if (process.argv.includes('--art-check')) {
  const archiveRoot = resolve(root, '.runtime');
  const scratch = await mkdtemp(resolve(archiveRoot, 'package-art-check-'));
  const within = relative(archiveRoot, scratch);
  if (!within || within.startsWith('..') || isAbsolute(within))
    throw new Error('Invalid art audit path');
  try {
    const files = clientArt.map((file) => 'dist/web/assets/' + file);
    const atlas = 'apps/web/src/assets/shanhetu/shanhetu-icons-atlas.json';
    const runtimeArt = 'dist/runtime/assets';
    for (const kind of ['props', 'tables']) {
      for (const name of await readdir(resolve(root, runtimeArt, kind))) {
        if (name.endsWith('.webp')) files.push(runtimeArt + '/' + kind + '/' + name);
      }
    }
    if (
      files.length !== 25 ||
      packageEntries.includes('.runtime') ||
      [...duplicatedArt].some(includeInPackage) ||
      includeInPackage(resolve(root, 'packages/noname-adapter/runtime/assets'))
    )
      throw new Error('Unexpected package art layout');
    const staged = resolve(scratch, 'art');
    let rawBytes = 0;
    let webBytes = 0;
    for (const file of [...files, atlas]) {
      if (!packageEntries.includes(file.split('/')[0]) || !includeInPackage(resolve(root, file)))
        throw new Error('Missing package entry: ' + file);
      const source = resolve(root, file);
      const bytes = (await stat(source)).size;
      if (file.endsWith('.webp')) {
        rawBytes += bytes;
        if (file.startsWith('dist/web/')) webBytes += bytes;
      }
      await mkdir(dirname(resolve(staged, file)), { recursive: true });
      await cp(source, resolve(staged, file));
    }
    const archive = resolve(scratch, 'art.zip');
    compress(staged, archive);
    console.log(
      JSON.stringify(
        {
          webFiles: clientArt.length,
          runtimeFiles: files.length - clientArt.length,
          webBytes,
          runtimeBytes: rawBytes - webBytes,
          artZipBytes: (await stat(archive)).size,
          sourceWebpDuplicates: 0,
          mastersIncluded: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
  process.exit(0);
}
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
for (const entry of packageEntries) {
  await cp(resolve(root, entry), resolve(target, entry), {
    recursive: true,
    filter: includeInPackage,
  });
}
const build = await verifyBuildManifest(root);
if (!build) throw new Error('Cannot package an unverified build');
await writeBuildManifest(target, build.sourceId);
if (starter) {
  const copied = new Set();
  async function copyTool(name, from = resolve(root, 'package.json'), optional = false) {
    let manifest;
    for (const location of createRequire(from).resolve.paths(name) ?? []) {
      const candidate = resolve(location, name, 'package.json');
      if (await readFile(candidate).catch(() => null)) {
        manifest = candidate;
        break;
      }
    }
    if (!manifest && optional) return;
    if (!manifest) throw new Error(`Missing starter build tool: ${name}`);
    if (copied.has(name)) return;
    copied.add(name);
    const tool = JSON.parse(await readFile(manifest));
    if (optional && (tool.os?.includes('!win32') || (tool.os && !tool.os.includes('win32'))))
      return;
    if (optional && tool.cpu && !tool.cpu.includes('x64')) return;
    await cp(dirname(manifest), resolve(target, 'node_modules', name), { recursive: true });
    for (const dependency of Object.keys(tool.dependencies ?? {}))
      await copyTool(dependency, manifest);
    for (const dependency of Object.keys(tool.optionalDependencies ?? {}))
      await copyTool(dependency, manifest, true);
  }
  await copyTool('esbuild');
  await copyTool('sharp');
  await copyTool('ws');
} else {
  await cp(
    resolve(root, `.local/noname/${candidate.tag}`),
    resolve(target, `.local/noname/${candidate.tag}`),
    { recursive: true },
  );
}
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
      resources: starter ? 'download-pinned-upstream' : 'bundled-invited-test',
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
  `聚会三国杀 v${pkg.version} ${starter ? 'Windows 启动包' : '受邀测试包'}\r\n\r\n${starter ? `首次使用时，电脑需能访问 GitHub、release-assets.githubusercontent.com 和 raw.githubusercontent.com。启动器会从无名杀固定版本分段下载所需文件，校验的游戏文件约 441 MiB。《山河图》还会从 web.sanguosha.com 下载约 ${portraitMiB} MiB 的牌桌立绘。实际流量因分段和重试而异。请保持网络可用。浏览器会自动打开可视化启动进度页，下载或解压中断后再次双击可断点补齐。完成后资源保存在本机，局域网游玩不依赖公网。\r\n\r\n` : ''}1. 解压完整文件夹（更新版本时保留 data/shanhetu 与 data/rosters 即可延续全部山河册和自选将池进度）。\r\n2. 推荐双击“无黑框启动聚会三国杀.vbs”（或“启动聚会三国杀.cmd”），浏览器会秒开可视化进度页，就绪后自动进入联机与观战页，同时提供局域网码与跨网公网码。电脑保持联网、页面开启并避免休眠。\r\n3. 同 Wi-Fi 手机扫局域网码；其他网络等公网码就绪后再扫。首页填好昵称即可点击模式开房，或直接从朋友的房间列表加入；电脑端可切换房间公开观战并导出战绩海报。\r\n4. 微信锁定竖屏时横着握手机即可自然横屏打牌，点击顶部朝向按钮可切换竖屏/横屏；出牌保持无名杀原生点选操作，右上角可随时拉出公开记牌器。\r\n5. 结算后回原房，再准备开第二局。聚会结束双击“停止聚会三国杀.cmd”；重启会清空房间，需要重新分享公网码。\r\n\r\n此包包含运行环境和固定联网组件${starter ? '，游戏资源首次从上游自动下载' : '及游戏资源'}，无需安装 Node.js、Git 或其他开发工具。临时公网服务需要互联网。\r\n没有互联网时，双击“启动局域网聚会三国杀.cmd”，所有手机连接同一 Wi-Fi 或电脑热点。两种入口共用一个本地服务实例，切换前先停止。\r\n\r\n试用反馈见 docs/beta-testing.md；版本规范见 docs/versioning.md。不要分享 .runtime/session.json、cookie 或私人牌面。\r\n自有代码 GPL-3.0-only，源码及构建脚本随包附带；第三方图片、音频等另见 THIRD_PARTY_NOTICES.md。${starter ? '本包不包含上游游戏图片、音频和字体；首次使用时从上游固定版本获取。素材保留原权属。' : '本包供受邀验收，资源公开分发依据仍待核对。'}\r\n`,
);
const archive = resolve(releaseRoot, `${name}.zip`);

compress(target, archive);
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
