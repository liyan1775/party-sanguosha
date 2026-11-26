import { test, expect, type Page } from '@playwright/test';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.js';
import { NativeNonameService } from '../../packages/noname-adapter/src/service.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const obsoleteCopy = /兹白|客厅剧场|客厅迎宾|客厅大屏|白衣素绡|素绡|玄泉|玉魁/;

async function capture(page: Page, name: string, fullPage = true): Promise<void> {
  const evidence = process.env.E2E_RETURN_EVIDENCE;
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, name), fullPage, animations: 'disabled' });
}

async function serve() {
  const party = createPartyServer({
    port: 0,
    webRoot: path.join(root, 'dist/web'),
    publicUrl: 'http://192.168.1.100:3000',
    entryMode: 'internet',
    adapter: new NativeNonameService(root),
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address() as AddressInfo;
  return {
    party,
    base: `http://127.0.0.1:${address.port}`,
    async close() {
      const closed = once(party.server, 'close');
      party.stop();
      party.server.closeAllConnections();
      await closed;
    },
  };
}

test('日夜大厅、390×844 准备房与双码联机页实拍', async ({ browser }) => {
  const service = await serve();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const spectator = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  try {
    const consolePage = await spectator.newPage();
    service.party.setInternetEntry(
      'ready',
      '跨网络可扫码',
      'https://return-evidence-party.trycloudflare.com/',
    );
    await consolePage.goto(`${service.base}/server`);
    await expect(consolePage.locator('#console-keepalive')).toHaveText('对局进行中请保持本页开启', {
      timeout: 15000,
    });

    const roomHost = await phone.newPage();
    const response = await phone.request.post(`${service.base}/api/rooms/preset`, {
      data: {
        nickname: '江东子弟',
        presetId: 'versus-2v2',
        fillBots: false,
        requireUnseated: true,
        requestId: 'qp-return-evidence',
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    const { room } = await response.json();
    await roomHost.goto(`${service.base}/join/${room.code}`);
    await expect(roomHost.locator('#start-button')).toBeVisible();
    await expect(roomHost.locator('body')).not.toContainText(obsoleteCopy);
    await expect(roomHost.locator('.room-prep-rules')).not.toHaveAttribute('open', '');
    await expect(roomHost.locator('#general-guide')).toBeVisible();
    await expect(roomHost.locator('#ready-button')).toBeInViewport({ ratio: 1 });
    await expect(roomHost.locator('#start-button')).toBeInViewport({ ratio: 1 });
    await expect(roomHost.getByRole('button', { name: '+ 添加原生 AI' })).toHaveCount(3);
    await capture(roomHost, 'room-open-seats-390x844.png', false);
    await roomHost.getByRole('button', { name: '一键补满 AI' }).click();
    await expect(roomHost.locator('#players .bot')).toHaveCount(3);
    await capture(roomHost, 'room-preparation-390x844.png', false);
    await roomHost.locator('#ready-button').click();
    await expect(roomHost.locator('#start-button')).toBeEnabled();
    await capture(roomHost, 'room-ready-390x844.png', false);
    await roomHost.locator('#theme-toggle').click();
    await expect(roomHost.locator('html')).toHaveAttribute('data-theme', 'night');
    await capture(roomHost, 'room-ready-night-390x844.png', false);
    await roomHost.locator('#theme-toggle').click();

    const home = await desktop.newPage();
    await home.goto(service.base);
    await expect(home.locator('#nickname')).toBeVisible();
    await expect(home.locator('body')).not.toContainText(obsoleteCopy);
    await capture(home, 'lobby-desktop-day.png');
    await home.locator('#theme-toggle').click();
    await expect(home.locator('html')).toHaveAttribute('data-theme', 'night');
    await capture(home, 'lobby-desktop-night.png');

    await roomHost.close();
    await phone.clearCookies();
    const mobileHome = await phone.newPage();
    await mobileHome.goto(service.base);
    await expect(mobileHome.locator('#nickname')).toBeVisible();
    await expect(mobileHome.locator('body')).not.toContainText(obsoleteCopy);
    await expect(mobileHome.getByRole('heading', { name: '朋友的房间' })).toBeInViewport();
    await capture(mobileHome, 'lobby-mobile-day-390x844.png', false);
    await mobileHome.locator('#theme-toggle').click();
    await expect(mobileHome.locator('html')).toHaveAttribute('data-theme', 'night');
    await capture(mobileHome, 'lobby-mobile-night-390x844.png', false);

    await expect(consolePage.locator('#qr')).toBeVisible();
    await expect(consolePage.locator('#internet-qr')).toBeVisible();
    await expect
      .poll(() =>
        consolePage
          .locator('#qr, #internet-qr')
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    await expect(consolePage.locator('#console-players .return-console-seat')).toHaveCount(4);
    await expect(consolePage.locator('#slow-stat')).toBeHidden();
    await expect(consolePage.locator('body')).not.toContainText(obsoleteCopy);
    await expect(consolePage.locator('html')).toHaveAttribute('data-theme', 'day');
    await capture(consolePage, 'server-day.png');
    await consolePage.locator('#theme-toggle').click();
    await expect(consolePage.locator('html')).toHaveAttribute('data-theme', 'night');
    await capture(consolePage, 'server-night.png');
  } finally {
    await Promise.all([desktop.close(), phone.close(), spectator.close()]);
    await service.close();
  }
});

test('启动进度页：浏览器实时显示失败，并按就绪状态自动进入联机页', async ({ page, browser }) => {
  const { startProgressServer } = await import(
    new URL('../../scripts/launcher-progress.mjs', import.meta.url).href
  );
  const runtime = path.join(root, '.runtime');
  await mkdir(runtime, { recursive: true });
  const runtimeDir = await mkdtemp(path.join(runtime, 'launcher-evidence-'));
  const service = await serve();
  const progress = await startProgressServer({ runtimeDir, version: '1.0.0', entryMode: 'lan' });
  try {
    progress.update({ step: 2, percent: 46, stageTitle: '正在校验本地资源…' });
    progress.pushLog('校验固定资源 25 / 100');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(progress.url);
    await expect(page.locator('#stage')).toHaveText('正在校验本地资源…');
    await expect(page.locator('body')).not.toContainText(obsoleteCopy);
    await capture(page, 'launcher-progress-day.png');
    await page.emulateMedia({ colorScheme: 'dark' });
    await capture(page, 'launcher-progress-night.png');

    progress.setFailed('模拟网络中断');
    await expect(page.getByText(/启动未完成.*模拟网络中断/)).toBeVisible();
    await expect(page).toHaveURL(progress.url);
    await capture(page, 'launcher-progress-failed.png');

    const ready = await browser.newPage();
    try {
      progress.update({ state: 'running', error: null, stageTitle: '正在等待引擎就绪…' });
      await ready.goto(progress.url);
      await expect(ready.locator('#stage')).toHaveText('正在等待引擎就绪…');
      progress.setReady(`${service.base}/server`);
      await expect(ready).toHaveURL(`${service.base}/server`);
      await expect(ready.locator('#theme-toggle')).toBeVisible();
    } finally {
      await ready.close();
    }
  } finally {
    await progress.close();
    await service.close();
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
