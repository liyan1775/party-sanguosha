import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { LAUNCH_LOCK_TIMEOUT_MS, waitForStartup } from './launcher-readiness.mjs';
import { startProgressServer } from './launcher-progress.mjs';
import { proofFile } from '../packages/noname-adapter/src/resource-proof.mjs';
import {
  createBuildSnapshot,
  readBuildManifest,
  sourceFingerprint,
  verifyBuildManifest,
} from './build-manifest.mjs';
import {
  isCurrentBuild,
  prepareReplacement,
  readRunningSession,
  waitForProcessExit,
} from './launcher-upgrade.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, '.runtime');
const sessionFile = path.join(runtime, 'session.json');
const lockFile = path.join(runtime, 'launcher.lock');
const progressFile = path.join(runtime, 'launcher-progress.json');
const builds = path.join(runtime, 'builds');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const noBrowser = process.argv.includes('--no-browser');
const entryMode = process.argv.includes('--lan') ? 'lan' : 'internet';
const portable = await readFile(path.join(root, 'portable.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => null);

const runningSession = () => readRunningSession(sessionFile);

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
  const started = Date.now();
  while (Date.now() - started < LAUNCH_LOCK_TIMEOUT_MS) {
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

async function activeProgressUrl() {
  try {
    const info = JSON.parse(await readFile(progressFile, 'utf8'));
    const url = new URL(info.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return null;
    try {
      process.kill(info.pid, 0);
    } catch (probe) {
      if (probe.code === 'ESRCH') return null;
    }
    const res = await fetch(`${url.origin}/api/status`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function runNode(args, onLine, proofToken = '', buildDir = '') {
  const child = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, PARTY_STARTUP_PROOF: proofToken, PARTY_BUILD_DIR: buildDir },
    stdio: onLine ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (onLine && child.stdout && child.stderr) {
    let bufOut = '';
    let bufErr = '';
    const flush = (chunk, target, isErr) => {
      const text = chunk.toString('utf8');
      if (isErr) process.stderr.write(text);
      else process.stdout.write(text);
      const merged = target + text;
      const lines = merged.split(/\r?\n/);
      const tail = lines.pop() ?? '';
      for (const line of lines) onLine(line);
      return tail;
    };
    child.stdout.on('data', (chunk) => {
      bufOut = flush(chunk, bufOut, false);
    });
    child.stderr.on('data', (chunk) => {
      bufErr = flush(chunk, bufErr, true);
    });
    child.once('close', () => {
      if (bufOut.trim()) onLine(bufOut);
      if (bufErr.trim()) onLine(bufErr);
    });
  }
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`准备步骤失败（${code}），请查看窗口中的提示。`)),
    );
  });
}

async function prepare(progress, proofToken, useDirectory) {
  const log = (line) => progress?.pushLog(line);
  let directory;
  if (portable) {
    if (portable.version !== pkg.version)
      throw new Error('发行包版本不匹配，请重新解压完整发行包。');
    directory = await createBuildSnapshot(root, path.join(root, 'dist'));
    useDirectory(directory);
    if (portable.resources === 'download-pinned-upstream') {
      progress?.update({
        step: 2,
        percent: 22,
        stageTitle: '正在准备与校验游戏资源与山河图立绘…',
      });
      console.log('正在检查本机游戏资源，首次使用会下载无名杀资源和三国杀 OL 山河图立绘。');
      await runNode(
        ['--use-env-proxy', path.join(root, 'scripts/prepare-portable.mjs')],
        log,
        proofToken,
        directory,
      );
    }
    progress?.update({ step: 3, percent: 86, stageTitle: '发行包资源已就绪，正在唤醒本机服务…' });
    console.log('发行包已就绪。');
  } else {
    await prepareSource(progress);
    await mkdir(builds, { recursive: true });
    directory = await mkdtemp(path.join(builds, 'build-'));
    useDirectory(directory);
    progress?.update({ step: 3, percent: 78, stageTitle: '正在构建页面与本机服务…' });
    console.log('正在准备页面与快速载入引擎……');
    await runNode([path.join(root, 'scripts/build.mjs'), '--out-dir', directory], log);
  }
  progress?.update({ step: 3, percent: 88, stageTitle: '正在校验新版运行快照…' });
  const manifest = await verifiedEngineBuild(directory);
  if (!manifest) throw new Error('新版运行快照校验失败，没有停止正在运行的服务。');
  await runNode(['--check', path.join(directory, 'server/main.js')], log);
  return { directory, manifest };
}

async function verifiedEngineBuild(directory) {
  const manifest = await verifyBuildManifest(root, directory);
  if (!manifest) return null;
  const requiredFiles = [
    'engine/noname.js',
    'web/index.html',
    'web/app.js',
    'web/style.css',
    'runtime/index.html',
    'runtime/bootstrap.js',
    'server/main.js',
  ];
  const files = await Promise.all(
    requiredFiles.map((file) => stat(path.join(directory, file)).catch(() => null)),
  );
  if (files.some((file) => !file?.isFile() || file.size === 0)) return null;
  const engine = await readFile(path.join(directory, 'engine/manifest.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  return engine?.bytes === files[0].size ? manifest : null;
}

async function prepareSource(progress) {
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
    progress?.update({ step: 1, percent: 18, stageTitle: '首次准备需要联网，正在安装依赖…' });
    console.log('首次准备需要联网，正在安装本项目依赖……');
    const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    await runNode([npm, 'ci', '--no-audit', '--no-fund'], (line) => progress?.pushLog(line));
  }
  await writeFile(stampFile, lockHash + '\n');
  progress?.update({ step: 2, percent: 34, stageTitle: '正在校验固定无名杀引擎与立绘资源…' });
  console.log('正在检查无名杀资源，首次准备需要联网……');
  await runNode(['--use-env-proxy', path.join(root, 'scripts/prepare-noname-lab.mjs')], (line) =>
    progress?.pushLog(line),
  );
}

async function reuse(session, message, progress) {
  if (entryMode === 'internet') {
    const origin = new URL(session.serverUrl).origin;
    try {
      const info = await (
        await fetch(`${origin}/api/info`, { signal: AbortSignal.timeout(3000) })
      ).json();
      if (info.entry?.status === 'unavailable')
        await fetch(`${origin}/api/internet/retry`, {
          method: 'POST',
          headers: { 'X-Party-Control': session.controlToken },
          signal: AbortSignal.timeout(3000),
        });
    } catch {
      // Retrying the optional public connection must not prevent reopening the page.
    }
  }
  console.log(message);
  if (progress) {
    progress.pushLog(message);
    progress.setReady(session.serverUrl, message);
    await delay(3000);
  } else await openBrowser(session.serverUrl);
  console.log(session.serverUrl);
}

function previousBuildDirectory(session) {
  if (typeof session?.buildDir !== 'string' || !path.isAbsolute(session.buildDir)) return null;
  const directory = path.resolve(session.buildDir);
  return path.dirname(directory) === builds ? directory : null;
}

async function alreadyCurrent(session) {
  if (session.health.stopping) return false;
  const installed = await readBuildManifest(root, previousBuildDirectory(session) ?? undefined);
  if (!portable)
    return isCurrentBuild(session.health, pkg.version, installed, await sourceFingerprint(root));
  const distribution = await readBuildManifest(root);
  return (
    isCurrentBuild(session.health, pkg.version, installed, distribution?.sourceId) &&
    distribution &&
    (portable.resources === 'download-pinned-upstream' ||
      distribution.buildId === installed.buildId)
  );
}

async function launch(candidate, proofToken, version, progress) {
  const { directory, manifest } = candidate;
  const stdout = openSync(path.join(runtime, 'server.log'), 'a');
  const stderr = openSync(path.join(runtime, 'server-error.log'), 'a');
  let child;
  try {
    child = spawn(
      process.execPath,
      ['--use-env-proxy', '--env-file-if-exists=.env', path.join(directory, 'server/main.js')],
      {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', stdout, stderr],
        env: {
          ...process.env,
          PARTY_AUTO_PORT: '1',
          PARTY_PROJECT_ROOT: root,
          PARTY_BUILD_DIR: directory,
          PARTY_NETWORK: entryMode,
          PARTY_STARTUP_PROOF: proofToken,
          NO_PROXY: [process.env.NO_PROXY, 'localhost', '127.0.0.1', '::1']
            .filter(Boolean)
            .join(','),
        },
      },
    );
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
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
    console.log('正在启动本机服务；首次资源校验可能需要几十秒，请保持此窗口开启……');
    return await waitForStartup({
      check: async () => {
        const current = await runningSession();
        return current?.pid === child.pid &&
          !current.health.stopping &&
          current.health.engineAssetsReady === true &&
          isCurrentBuild(current.health, version, manifest)
          ? current
          : null;
      },
      assertAlive: () => {
        if (startupError) throw startupError;
        if (exited) throw new Error('服务未能启动，请查看 .runtime/server-error.log。');
      },
      onProgress: (seconds) => {
        const note = `仍在启动本机服务（已等待${seconds}秒），首次运行可能较慢……`;
        console.log(note);
        progress?.pushLog(note);
      },
    });
  } catch (error) {
    // Only terminate this exact child, never a process identified by port.
    if (!exited && child.pid) {
      child.kill();
      await waitForProcessExit(child.pid);
    }
    throw error;
  }
}

async function start() {
  if (!noBrowser) {
    const existingProgress = await activeProgressUrl();
    if (existingProgress) {
      console.log('启动准备正在进行中，打开可视化进度页。');
      await openBrowser(existingProgress);
      return;
    }
  }
  const release = await acquireLock();
  let progress = null;
  let stageDirectory;
  let launchAttempted = false;
  const proofToken =
    portable?.resources === 'download-pinned-upstream' ? randomBytes(32).toString('hex') : '';
  try {
    const current = await runningSession();
    if (current && current.entryMode !== entryMode)
      throw new Error(
        '本目录已有另一种连接方式在运行。结束牌桌后先双击停止，再打开需要的启动入口。',
      );
    if (current && (await alreadyCurrent(current))) {
      await reuse(current, '当前版本服务已在运行，打开电脑二维码页面。');
      return;
    }
    const showProgress = async () => {
      if (noBrowser || progress) return;
      progress = await startProgressServer({
        runtimeDir: runtime,
        version: pkg.version,
        entryMode,
      }).catch(() => null);
      if (progress) await openBrowser(progress.url).catch(() => {});
    };
    let prior;
    const replacement = await prepareReplacement(current, {
      stage: async () => {
        await showProgress();
        const candidate = await prepare(progress, proofToken, (directory) => {
          stageDirectory = directory;
        });
        const directory = previousBuildDirectory(current);
        if (directory) {
          const manifest = await verifiedEngineBuild(directory).catch(() => null);
          if (manifest && manifest.buildId === current.health.buildId)
            prior = { directory, manifest };
        }
        if (current && !current.health.stopping && !prior)
          throw new Error('无法校验旧服务的备用构建，原服务继续运行。未执行自动停机。');
        return candidate;
      },
      onAccepted: () => {
        const note = '新版已校验，旧服务正在退出。退出后将启动新版，不会打开旧联机页。';
        console.log(note);
        progress?.update({ step: 3, percent: 90, stageTitle: '正在等待旧服务安全退出…' });
        progress?.pushLog(note);
      },
      wait: (pid) => waitForProcessExit(pid, { attempts: 600 }),
    });
    if (replacement.status !== 'ready') {
      await showProgress();
      await reuse(current, `暂缓自动更新：${replacement.message}`, progress);
      return;
    }
    progress?.update({
      step: 3,
      percent: 92,
      stageTitle: '正在启动本机规则服务…',
      detail: '资源校验和联机入口就绪后自动打开联机与观战页。',
    });
    launchAttempted = true;
    let session;
    try {
      session = await launch(replacement.candidate, proofToken, pkg.version, progress);
    } catch (error) {
      if (!prior) throw error;
      if (await runningSession()) throw error;
      const note = '新版未能启动，正在重新启动已保留的上一版。原内存房间不会恢复。';
      console.log(note);
      progress?.pushLog(note);
      session = await launch(prior, '', current.health.version, progress);
      await reuse(session, '已恢复上一版服务。请查看运行日志后再次尝试更新。', progress);
      return;
    }
    console.log(
      entryMode === 'internet'
        ? '服务已启动，局域网二维码可立即使用，正在额外准备公网入口。两种网络可以加入同一间房。'
        : '局域网服务已启动。手机连接同一 Wi-Fi，扫描电脑上的主页二维码。',
    );
    console.log(session.serverUrl);
    if (progress) {
      progress.setReady(session.serverUrl);
      await delay(1800);
    } else {
      await openBrowser(session.serverUrl);
    }
  } catch (error) {
    if (progress) {
      progress.setFailed(error instanceof Error ? error.message : String(error));
      await delay(3000);
    }
    throw error;
  } finally {
    if (progress) await progress.close().catch(() => {});
    if (proofToken) await unlink(path.join(root, proofFile)).catch(() => {});
    if (!launchAttempted && stageDirectory && path.dirname(stageDirectory) === builds) {
      const [actualBuildRoot, actualStage] = await Promise.all(
        [builds, stageDirectory].map((directory) => realpath(directory).catch(() => null)),
      );
      if (actualBuildRoot && actualStage && path.dirname(actualStage) === actualBuildRoot)
        await rm(actualStage, { recursive: true, force: true }).catch(() => {});
    }
    await release();
  }
}

async function stop() {
  const session = await runningSession();
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
  await response.arrayBuffer();
  await waitForProcessExit(session.pid);
  console.log('聚会三国杀服务已停止。');
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
