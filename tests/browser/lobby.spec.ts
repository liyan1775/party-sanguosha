import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RoomView } from '../../packages/shared/src/contracts.js';
import { createPartyServer } from '../../apps/server/src/server.js';

async function withLobby(
  browser: Browser,
  scenario: (fixture: {
    party: ReturnType<typeof createPartyServer>;
    base: string;
    page: (desktop?: boolean) => Promise<Page>;
  }) => Promise<void>,
) {
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../../dist/web/', import.meta.url)),
    publicUrl: 'http://192.168.1.100:3000',
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  const base = `http://127.0.0.1:${address.port}`;
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  try {
    await scenario({
      party,
      base,
      page: async (desktop = false) => {
        const context = await browser.newContext({
          viewport: desktop ? { width: 1440, height: 1050 } : { width: 390, height: 844 },
          isMobile: !desktop,
          hasTouch: !desktop,
        });
        contexts.push(context);
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        return page;
      },
    });
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
    party.closeStreams();
    party.server.closeAllConnections();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  }
}

async function createRoom(page: Page, base: string, nickname: string): Promise<string> {
  await page.goto(base + '/');
  await page.getByLabel('怎么称呼你').fill(nickname);
  await page.getByRole('button', { name: '创建房间并入座' }).click();
  await expect(page.locator('#my-role')).toHaveText('你是房主，也参加这一局');
  return page.url().split('/').at(-1)!;
}

async function checkQr(page: Page, roomCode?: string): Promise<string> {
  await expect(page.locator('#qr')).toBeVisible();
  await expect
    .poll(() => page.locator('#qr').evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const url = await page.locator('#join-url').inputValue();
  expect(new URL(url).pathname).toBe(roomCode ? `/join/${roomCode}` : '/');
  expect(new URL(url).hash).toBe('');
  return url;
}

async function joinRoom(page: Page, base: string, code: string, nickname: string): Promise<void> {
  await page.goto(`${base}/join/${code}`);
  await page.getByLabel('怎么称呼你').fill(nickname);
  await page.getByRole('button', { name: '入座', exact: true }).click();
  await expect(page.getByRole('button', { name: '我准备好了' })).toBeEnabled();
}

test('电脑只展示主页码，手机建房参赛，任意成员展示直达房间码，2v2 四真人准备', async ({
  browser,
}) => {
  await withLobby(browser, async ({ party, base, page }) => {
    const computer = await page(true);
    await computer.goto(base + '/server');
    await checkQr(computer);
    expect(party.lobby.list()).toHaveLength(0);
    expect(await computer.getByRole('button', { name: '创建房间并入座' }).count()).toBe(0);
    expect(await computer.getByRole('button', { name: '保存房间设置' }).count()).toBe(0);
    const owner = await page();
    const code = await createRoom(owner, base, '诸葛亮');
    const room = party.lobby.get(code);
    expect(room.snapshot().players).toHaveLength(1);
    expect(
      await computer.request.get(base + '/api/me').then((response) => response.json()),
    ).toEqual({ playerId: null, roomCode: null });
    await owner.getByRole('button', { name: /2v2/ }).click();
    await owner.getByRole('button', { name: '保存房间设置' }).click();
    await owner.getByRole('button', { name: '展示房间二维码' }).click();
    await checkQr(owner, code);
    await owner.getByRole('button', { name: '关闭房间二维码' }).click();
    const phones = [owner];
    for (const nickname of ['赵云', '黄忠', '<b>乔</b>']) {
      const phone = await page();
      if (nickname === '赵云') {
        let requests = 0;
        let stale: RoomView | undefined;
        const unsubscribe = room.subscribe((snapshot) => {
          if (!stale && snapshot.players.length === 2 && !snapshot.players[1]?.online)
            stale = snapshot;
        });
        await phone.route(`**/api/rooms/${code}`, async (route) => {
          if (route.request().method() === 'GET' && ++requests === 2 && stale) {
            const response = await route.fetch();
            const data = await response.json();
            await expect(phone.getByRole('button', { name: '我准备好了' })).toBeEnabled();
            await route.fulfill({ response, json: { ...data, room: stale } });
            unsubscribe();
          } else await route.continue();
        });
      }
      await joinRoom(phone, base, code, nickname);
      await phone.getByRole('button', { name: '展示房间二维码' }).click();
      await checkQr(phone, code);
      expect(await phone.getByRole('button', { name: '添加 1 个 AI' }).isVisible()).toBe(false);
      await phone.getByRole('button', { name: '关闭房间二维码' }).click();
      expect(
        await phone.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      phones.push(phone);
    }
    for (const phone of phones) await phone.getByRole('button', { name: '我准备好了' }).click();
    await expect(owner.locator('#player-counter')).toHaveText('4 / 4 席');
    await expect(owner.getByRole('button', { name: '开始对局' })).toBeDisabled();
    await expect(phones[3]!.locator('#my-nickname')).toHaveText('<b>乔</b>');
    expect(await phones[3]!.locator('#my-nickname b').count()).toBe(0);
    await owner.reload();
    await expect(owner.locator('#my-role')).toHaveText('你是房主，也参加这一局');
    expect(room.snapshot().players).toHaveLength(4);
    await owner.getByRole('button', { name: '我准备好了' }).click();
    await expect
      .poll(() => room.snapshot().players.filter((player) => player.ready).length)
      .toBe(4);
    await owner.getByLabel('武将范围').selectOption('advanced');
    await owner.getByRole('button', { name: '保存房间设置' }).click();
    await expect(phones[1]!.locator('#summary-details')).toHaveText('4 席 · 进阶档');
    expect(room.snapshot().players.some((player) => player.ready)).toBe(false);
    const response = await phones[1]!.request.put(`${base}/api/rooms/${code}`, {
      data: { mode: 'identity', playerCount: 8, generalPreset: 'beginner', extensions: [] },
    });
    expect(response.status()).toBe(403);
    await owner.getByRole('button', { name: '移除 黄忠', exact: true }).click();
    await expect(phones[2]!.getByRole('button', { name: '入座', exact: true })).toBeVisible();
    await expect(owner.locator('#player-counter')).toHaveText('3 / 4 席');
    await mkdir(fileURLToPath(new URL('../../.runtime/previews/', import.meta.url)), {
      recursive: true,
    });
    await computer.screenshot({ path: '.runtime/previews/server.png', fullPage: true });
    await owner.screenshot({ path: '.runtime/previews/owner.png', fullPage: true });
    await phones[1]!.getByRole('button', { name: '展示房间二维码' }).click();
    await phones[1]!.screenshot({ path: '.runtime/previews/member-qr.png', fullPage: true });
  });
});

test('手机房主为 5/8 席补 AI、修改玩法裁掉多余 AI，真人准备与权限受约束', async ({ browser }) => {
  await withLobby(browser, async ({ party, base, page }) => {
    const owner = await page();
    const code = await createRoom(owner, base, '刘备');
    const friend = await page();
    await joinRoom(friend, base, code, '关羽');
    await owner.getByRole('button', { name: '用 AI 补满空位' }).click();
    await expect(owner.locator('#seat-count')).toHaveText('2 位真人 · 3 个 AI');
    await expect(owner.getByRole('button', { name: '添加 1 个 AI' })).toBeDisabled();
    for (const phone of [owner, friend])
      await phone.getByRole('button', { name: '我准备好了' }).click();
    const waiting = await page();
    await waiting.goto(`${base}/join/${code}`);
    await expect(waiting.getByRole('button', { name: '入座', exact: true })).toBeDisabled();
    await owner.getByLabel('总席位（含 AI）').selectOption('8');
    await owner.getByRole('button', { name: '保存房间设置' }).click();
    await expect(friend.getByRole('button', { name: '我准备好了' })).toBeVisible();
    await owner.getByRole('button', { name: '用 AI 补满空位' }).click();
    await expect(owner.locator('#seat-count')).toHaveText('2 位真人 · 6 个 AI');
    expect(
      party.lobby
        .get(code)
        .snapshot()
        .players.filter((seat) => seat.kind === 'bot')
        .every((seat) => seat.ready && seat.online),
    ).toBe(true);
    const rejected = await friend.request.post(`${base}/api/rooms/${code}/bots`, {
      data: { count: 1 },
    });
    expect(rejected.status()).toBe(403);
    await owner.getByRole('button', { name: /斗地主/ }).click();
    await owner.getByRole('button', { name: '保存房间设置' }).click();
    await expect(owner.locator('#seat-count')).toHaveText('2 位真人 · 1 个 AI');
    await owner.getByRole('button', { name: '移除 AI 01', exact: true }).click();
    await expect(waiting.getByRole('button', { name: '入座', exact: true })).toBeEnabled();
    await waiting.getByLabel('怎么称呼你').fill('张飞');
    await waiting.getByRole('button', { name: '入座', exact: true }).click();
    await expect(owner.locator('#seat-count')).toHaveText('3 位真人 · 0 个 AI');
    await expect(owner.getByRole('button', { name: '开始对局' })).toBeDisabled();
    expect(await owner.getByLabel('AI 智力', { exact: true }).count()).toBe(0);
  });
});

test('房主离开由真人接任，两间房独立，空房关闭后旧邀请可返回主页', async ({ browser }) => {
  await withLobby(browser, async ({ party, base, page }) => {
    const owner = await page();
    const code = await createRoom(owner, base, '刘备');
    const friend = await page();
    await joinRoom(friend, base, code, '关羽');
    const other = await page();
    const otherCode = await createRoom(other, base, '曹操');
    const attempt = await other.request.post(`${base}/api/rooms/${code}/bots`, {
      data: { count: 1 },
    });
    expect(attempt.status()).toBe(403);
    await owner.getByRole('button', { name: '离开房间', exact: true }).click();
    await expect(owner.getByRole('button', { name: '创建房间并入座' })).toBeVisible();
    await expect(friend.locator('#my-role')).toHaveText('你是房主，也参加这一局');
    await friend.getByRole('button', { name: '添加 1 个 AI' }).click();
    await friend.reload();
    await expect(friend.locator('#my-role')).toHaveText('你是房主，也参加这一局');
    expect(party.lobby.get(otherCode).snapshot().players).toHaveLength(1);
    await friend.getByRole('button', { name: '离开房间', exact: true }).click();
    await expect(friend.getByRole('button', { name: '创建房间并入座' })).toBeVisible();
    expect(party.lobby.list()).toHaveLength(1);
    await owner.goto(`${base}/join/${code}`);
    await expect(owner.getByText('暂时没找到牌桌')).toBeVisible();
    await owner.getByRole('link', { name: '返回主页', exact: true }).click();
    await expect(owner.getByRole('button', { name: '创建房间并入座' })).toBeVisible();
  });
});
