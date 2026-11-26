import { expect, test as base } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPartyServer } from '../../apps/server/src/server.js';
import { prepareReplacement } from '../../scripts/launcher-upgrade.mjs';

interface ProgressServer {
  url: string;
  update(patch: { step: number; percent: number; stageTitle: string }): void;
  pushLog(line: string): void;
  setReady(redirectUrl: string, notice?: string): void;
  setFailed(errorMessage: string): void;
  close(): Promise<void>;
}

const {
  startProgressServer,
}: {
  startProgressServer(options: { runtimeDir: string; entryMode: string }): Promise<ProgressServer>;
} = await import(new URL('../../scripts/launcher-progress.mjs', import.meta.url).href);

const test = base.extend<{ progress: ProgressServer }>({
  progress: async ({}, use) => {
    const runtimeDir = await mkdtemp(path.join(tmpdir(), 'party-launcher-browser-'));
    try {
      const progress = await startProgressServer({ runtimeDir, entryMode: 'lan' });
      try {
        await use(progress);
      } finally {
        await progress.close();
      }
    } finally {
      await rm(runtimeDir, { recursive: true, force: true });
    }
  },
});

test('启动页跟随真实进度，在本机服务就绪后自动跳转', async ({ page, progress }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 800 });
  const destination = createServer((request, response) => {
    response.writeHead(request.url === '/server' ? 200 : 404, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end('<h1>聚会三国杀 · 联机与观战</h1>');
  });
  try {
    await new Promise<void>((resolve, reject) => {
      destination.once('error', reject);
      destination.listen(0, '127.0.0.1', resolve);
    });
    const address = destination.address();
    if (!address || typeof address === 'string') throw new Error('No loopback address');
    const serverUrl = `http://127.0.0.1:${address.port}/server`;
    const faults: string[] = [];
    page.on('pageerror', (fault) => faults.push(fault.message));

    await page.goto(progress.url);
    await expect(page.getByRole('heading', { name: '聚会三国杀', exact: true })).toBeVisible();
    await expect(page.getByText('本机启动 · 局域网联机')).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(238, 244, 243)');
    await expect(page.locator('#logs')).toBeHidden();

    progress.update({ step: 2, percent: 25, stageTitle: '正在准备游戏资源…' });
    progress.pushLog('校验固定资源 50 / 100');
    await expect(page.getByRole('progressbar', { name: '启动进度' })).toHaveJSProperty('value', 50);
    await expect(page.locator('[aria-current="step"]')).toHaveText('2. 准备资源');
    await page.getByText('启动日志', { exact: true }).click();
    await expect(page.locator('#logs')).toHaveText('校验固定资源 50 / 100');
    await page.screenshot({ path: testInfo.outputPath('launcher-progress-day.png') });

    progress.setReady(serverUrl);
    await expect(page).toHaveURL(serverUrl);
    await expect(page.getByRole('heading', { name: '聚会三国杀 · 联机与观战' })).toBeVisible();
    expect(faults).toEqual([]);
  } finally {
    destination.closeAllConnections();
    await new Promise<void>((resolve) => destination.close(() => resolve()));
  }
});

test('窄屏夜间启动失败停留原页，显示原因、日志与重试方法', async ({ page, progress }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(progress.url);
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(8, 16, 23)');
  await expect(page.locator('#err')).toBeHidden();

  progress.pushLog('资源下载未完成');
  progress.setFailed('模拟网络中断');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('启动未完成：模拟网络中断');
  await expect(alert).toContainText('双击原启动入口重试');
  await expect(alert).toContainText('.runtime/server-error.log');
  await expect(page.locator('#go')).toBeHidden();
  await page.getByText('启动日志', { exact: true }).click();
  await expect(page.locator('#logs')).toHaveText('资源下载未完成');
  await expect(page).toHaveURL(progress.url);
  expect(await page.locator('html').evaluate((root) => root.scrollWidth)).toBe(320);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('launcher-progress-night.png'),
  });
});

test('热重启拒绝打断大厅点将，确认接受后等待退出与新版健康才跳转', async ({
  page,
  progress,
}, testInfo) => {
  const old = createPartyServer({ webRoot: path.resolve('dist/web'), port: 0 });
  const next = createServer((request, response) => {
    if (request.url === '/api/health') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: true, instanceId: 'replacement-fixture' }));
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<h1>新版联机页已就绪</h1>');
    }
  });
  const listen = async (server: typeof next) => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No loopback address');
    return 'http://127.0.0.1:' + address.port;
  };
  const close = async (server: typeof next) => {
    const done = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await done;
  };
  const oldUrl = await listen(old.server);
  const oldClose = once(old.server, 'close');
  let releaseExit!: () => void;
  const exitGate = new Promise<void>((resolve) => {
    releaseExit = resolve;
  });
  let update: Promise<unknown> | undefined;
  try {
    const created = await page.request.post(oldUrl + '/api/rooms', {
      data: { nickname: '热重启回归玩家' },
    });
    expect(created.status()).toBe(201);
    const { room } = await created.json();
    const roomUrl = oldUrl + '/api/rooms/' + room.code;
    const settings = {
      mode: 'identity',
      playerCount: 5,
      generalPreset: 'beginner',
      extensions: [],
    };
    expect(
      (
        await page.request.put(roomUrl, { data: { ...settings, allowGeneralSelection: true } })
      ).ok(),
    ).toBe(true);
    const before = await page.request.get(roomUrl + '/me/general');
    expect(before.ok()).toBe(true);
    const choice = (await before.json()).available[0] as string;
    expect(
      (await page.request.put(roomUrl + '/me/general', { data: { general: choice } })).ok(),
    ).toBe(true);
    const health = await (await page.request.get(oldUrl + '/api/health')).json();
    expect(health).toMatchObject({ conditionalShutdown: true, shutdownPolicy: 2, stopping: false });
    const session = {
      serverUrl: oldUrl + '/server',
      pid: process.pid,
      health,
      controlToken: old.controlToken,
    };
    const stage = async () => 'verified-fixture';
    const refused = await prepareReplacement(session, {
      stage,
      wait: async () => {
        throw new Error('Busy must not enter wait-for-exit');
      },
    });
    expect(refused).toMatchObject({
      status: 'busy',
      message: expect.stringContaining('已开放点将'),
    });
    expect(await (await page.request.get(roomUrl + '/me/general')).json()).toMatchObject({
      selected: choice,
    });
    expect(
      (
        await page.request.put(roomUrl, { data: { ...settings, allowGeneralSelection: false } })
      ).ok(),
    ).toBe(true);

    await page.goto(progress.url);
    update = prepareReplacement(session, {
      stage,
      onAccepted() {
        progress.update({ step: 3, percent: 90, stageTitle: '正在等待旧服务安全退出…' });
      },
      wait: async () => {
        await oldClose;
        await exitGate;
      },
    }).then(async (state) => {
      expect(state).toEqual({ status: 'ready', candidate: 'verified-fixture' });
      const newUrl = await listen(next);
      expect(await (await page.request.get(newUrl + '/api/health')).json()).toEqual({
        ok: true,
        instanceId: 'replacement-fixture',
      });
      progress.setReady(newUrl + '/server');
      await expect(page).toHaveURL(newUrl + '/server');
    });
    await expect(page.getByText('正在等待旧服务安全退出…')).toBeVisible();
    await expect(page).toHaveURL(progress.url);
    await expect(page.locator('#go')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('launcher-upgrade-waiting.png') });
    releaseExit();
    await update;
    await expect(page.getByRole('heading', { name: '新版联机页已就绪' })).toBeVisible();
  } finally {
    releaseExit();
    await update?.catch(() => {});
    await close(old.server);
    await close(next);
  }
});

test('遗留服务给无黑框启动显示手动停启说明，仍可直接打开旧联机页', async ({ page, progress }) => {
  const oldUrl = 'http://127.0.0.1:1024/server';
  const result = await prepareReplacement(
    { serverUrl: oldUrl, pid: 100, controlToken: 'fixture', health: {} },
    {
      stage: async () => {
        throw new Error('Legacy service must not be staged for automatic shutdown');
      },
    },
  );
  expect(result.status).toBe('manual');
  if (result.status !== 'manual') throw new Error('Expected a manual instruction');
  await page.goto(progress.url);
  progress.setReady(oldUrl, result.message);
  await expect(page.getByRole('heading', { name: '保留正在运行的服务' })).toBeVisible();
  await expect(page.getByText(/原服务继续运行.*停止聚会三国杀.*再双击启动/)).toBeVisible();
  await expect(page.getByRole('link', { name: /进入联机与观战/ })).toHaveAttribute('href', oldUrl);
  await expect(page).toHaveURL(progress.url);
});
