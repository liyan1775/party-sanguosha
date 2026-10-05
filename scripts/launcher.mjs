import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, '.runtime');
const sessionFile = path.join(runtime, 'session.json');
const lockFile = path.join(runtime, 'launcher.lock');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const noBrowser = process.argv.includes('--no-browser');
const entryMode = process.argv.includes('--lan') ? 'lan' : 'internet';
const portable = await readFile(path.join(root, 'portable.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => null);

async function runningSession(checkVersion = true) {
  try {
    const session = JSON.parse(await readFile(sessionFile, 'utf8'));
    const url = new URL(session.serverUrl);
    if (
      session.app !== 'party-sanguosha' ||
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.pathname !== '/server' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const health = await (
      await fetch(`${url.origin}/api/health`, { signal: AbortSignal.timeout(1000) })
    ).json();
    if (
      health.app !== session.app ||
      health.instanceId !== session.instanceId ||
      !health.ok ||
      (checkVersion && health.version !== pkg.version)
    )
      return null;
    return session;
  } catch {
    return null;
  }
}

async function openBrowser(url) {
  if (noBrowser) return;
  const child = spawn('explorer.exe', [url], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
}

async function acquireLock() {
  let announced = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const handle = await open(lockFile, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      return async () => {
        await handle.close();
        await unlink(lockFile).catch(() => {});
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await readFile(lockFile, 'utf8'));
        let alive = true;
        try {
          process.kill(owner.pid, 0);
        } catch (probe) {
          if (probe.code === 'ESRCH') alive = false;
        }
        if (!alive) {
          await unlink(lockFile);
          continue;
        }
      } catch {
        /* 第一个启动器可能正在写锁，等待即可。 */
      }
      if (!announced) {
        console.log('另一个启动窗口正在准备，请稍候……');
        announced = true;
      }
      await delay(1000);
    }
  }
  throw new Error('服务仍在准备中，请稍后再双击启动。日志位于 .runtime 文件夹。');
}

async function runNode(args) {
  const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`准备步骤失败（${code}），请查看窗口中的提示。`)),
    );
  });
}

async function prepare() {
  if (portable) {
    if (portable.version !== pkg.version)
      throw new Error('发行包版本不匹配，请重新解压完整发行包。');
    await readFile(path.join(root, 'dist/server/main.js'));
    await readFile(path.join(root, 'dist/web/index.html'));
    console.log('离线发行包已就绪。');
    return;
  }
  const lockHash = createHash('sha256')
    .update(await readFile(path.join(root, 'package-lock.json')))
    .digest('hex');
  const stampFile = path.join(runtime, 'dependencies.sha256');
  let installed = true;
  try {
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      const dependency = JSON.parse(
        await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'),
      );
      if (dependency.version !== version) installed = false;
    }
    const stamp = await readFile(stampFile, 'utf8').catch(() => lockHash);
    if (stamp.trim() !== lockHash) installed = false;
  } catch {
    installed = false;
  }
  if (!installed) {
    console.log('首次准备需要联网，正在安装本项目依赖……');
    const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    await runNode([npm, 'ci', '--no-audit', '--no-fund']);
  }
  await writeFile(stampFile, lockHash + '\n');
  console.log('正在检查无名杀资源，首次准备需要联网……');
  await runNode(['--use-env-proxy', path.join(root, 'scripts/prepare-noname-lab.mjs')]);
  console.log('正在准备页面与快速载入引擎……');
  await runNode([path.join(root, 'scripts/build.mjs')]);
}

async function start() {
  let session = await runningSession();
  if (session) {
    if (session.entryMode !== entryMode)
      throw new Error(
        '本目录已有另一种连接方式在运行。结束牌桌后先双击停止，再打开需要的启动入口。',
      );
    if (entryMode === 'internet') {
      const origin = new URL(session.serverUrl).origin;
      const info = await (
        await fetch(`${origin}/api/info`, { signal: AbortSignal.timeout(3000) })
      ).json();
      if (info.entry?.status === 'unavailable')
        await fetch(`${origin}/api/internet/retry`, {
          method: 'POST',
          headers: { 'X-Party-Control': session.controlToken },
          signal: AbortSignal.timeout(3000),
        });
    }
    console.log('服务已在运行，打开电脑二维码页面。');
    await openBrowser(session.serverUrl);
    console.log(session.serverUrl);
    return;
  }
  const release = await acquireLock();
  try {
    session = await runningSession();
    if (session && session.entryMode !== entryMode)
      throw new Error(
        '本目录已有另一种连接方式在运行。结束牌桌后先双击停止，再打开需要的启动入口。',
      );
    if (!session) {
      if (await runningSession(false))
        throw new Error('旧版本服务仍在运行。请先双击停止，再双击启动以加载新版本。');
      await prepare();
      const stdout = openSync(path.join(runtime, 'server.log'), 'a');
      const stderr = openSync(path.join(runtime, 'server-error.log'), 'a');
      const child = spawn(
        process.execPath,
        ['--use-env-proxy', '--env-file-if-exists=.env', 'dist/server/main.js'],
        {
          cwd: root,
          detached: true,
          windowsHide: true,
          stdio: ['ignore', stdout, stderr],
          env: {
            ...process.env,
            PARTY_AUTO_PORT: '1',
            PARTY_PROJECT_ROOT: root,
            PARTY_NETWORK: entryMode,
            NO_PROXY: [process.env.NO_PROXY, 'localhost', '127.0.0.1', '::1']
              .filter(Boolean)
              .join(','),
          },
        },
      );
      closeSync(stdout);
      closeSync(stderr);
      let startupError;
      let exited = false;
      child.once('error', (error) => {
        startupError = error;
      });
      child.once('exit', () => {
        exited = true;
      });
      child.unref();
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (startupError) throw startupError;
          if (exited) throw new Error('服务未能启动，请查看 .runtime/server-error.log。');
          session = await runningSession();
          if (session) break;
          await delay(200);
        }
        if (!session) throw new Error('等待启动超时，请查看 .runtime/server-error.log 后再试。');
      } catch (error) {
        // 只清理本次启动器刚创建的进程，绝不按端口杀掉其他服务。
        if (!exited) child.kill();
        throw error;
      }
    }
    console.log(
      entryMode === 'internet'
        ? '服务已启动，局域网二维码可立即使用，正在额外准备公网入口。两种网络可以加入同一间房。'
        : '局域网服务已启动。手机连接同一 Wi-Fi，扫描电脑上的主页二维码。',
    );
    console.log(session.serverUrl);
    await openBrowser(session.serverUrl);
  } finally {
    await release();
  }
}

async function stop() {
  const session = await runningSession(false);
  if (!session) {
    console.log('本项目服务没有运行，无需停止。');
    return;
  }
  const url = new URL(session.serverUrl);
  const response = await fetch(`${url.origin}/api/shutdown`, {
    method: 'POST',
    headers: { 'X-Party-Control': session.controlToken },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('停止失败，请查看服务日志。');
  for (let attempt = 0; attempt < 25; attempt++) {
    if (!(await runningSession(false))) {
      console.log('聚会三国杀服务已停止。');
      return;
    }
    await delay(200);
  }
  throw new Error('服务仍在结束连接，请稍后再试。');
}

try {
  if (process.versions.node.split('.')[0] !== '24')
    throw new Error('请安装 Node.js 24.x，或使用包含运行环境的发行包。');
  await mkdir(runtime, { recursive: true });
  if (process.argv.includes('--stop')) {
    const release = await acquireLock();
    try {
      await stop();
    } finally {
      await release();
    }
  } else await start();
} catch (error) {
  console.error(`\n未完成：${error.message}\n启动说明见 README.md；运行日志在 .runtime 文件夹。`);
  process.exitCode = 1;
}
