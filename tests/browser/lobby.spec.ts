import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RoomView } from '../../packages/shared/src/contracts.js';
import { createPartyServer } from '../../apps/server/src/server.js';
import { createPublicGateway } from '../../apps/server/src/public-gateway.js';

async function withLobby(
  browser: Browser,
  scenario: (fixture: {
    party: ReturnType<typeof createPartyServer>;
    base: string;
    publicBase: string;
    gateway: ReturnType<typeof createPublicGateway> | null;
    page: (desktop?: boolean) => Promise<Page>;
  }) => Promise<void>,
  internet = false,
) {
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../../dist/web/', import.meta.url)),
    publicUrl: 'http://192.168.1.100:3000',
    entryMode: internet ? 'internet' : 'lan',
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  const base = `http://127.0.0.1:${address.port}`;
  const gateway = internet ? createPublicGateway(address.port) : null;
  if (gateway) await new Promise<void>((resolve) => gateway.server.listen(0, '127.0.0.1', resolve));
  const ingress = gateway?.server.address();
  const publicBase =
    ingress && typeof ingress === 'object' ? `http://127.0.0.1:${ingress.port}` : base;
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  try {
    await scenario({
      party,
      base,
      publicBase,
      gateway,
      page: async (desktop = false) => {
        const context = await browser.newContext({
          viewport: desktop ? { width: 1440, height: 1050 } : { width: 390, height: 844 },
          isMobile: !desktop,
          hasTouch: !desktop,
        });
        contexts.push(context);
        if (internet)
          await context.addInitScript(() => {
            Object.defineProperty(AbortSignal, 'any', { value: undefined });
            Object.defineProperty(AbortSignal, 'timeout', { value: undefined });
          });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        return page;
      },
    });
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
    gateway?.close();
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

async function checkQr(page: Page, roomCode?: string, prefix = ''): Promise<string> {
  await expect(page.locator(`#${prefix}qr`)).toBeVisible();
  await expect
    .poll(() =>
      page.locator(`#${prefix}qr`).evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  const url = await page.locator(`#${prefix}join-url`).inputValue();
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

test('电脑控制台管理两桌，安全显示昵称、移除等待席位和关闭指定房间，不占玩家席位', async ({
  browser,
}) => {
  await withLobby(browser, async ({ party, base, page }) => {
    const computer = await page(true);
    const owner = await page();
    const friend = await page();
    const other = await page();
    await computer.goto(base + '/server');
    const code = await createRoom(owner, base, '<img src=x>');
    await joinRoom(friend, base, code, '朋友');
    const otherCode = await createRoom(other, base, '另一桌');
    await expect(computer.locator('#room-total')).toHaveText('2 间');
    await expect(computer.locator('#console-room-title')).toContainText('<img src=x>');
    expect(await computer.locator('#console-room-title img').count()).toBe(0);
    const session = await computer.request.get(base + '/api/me');
    expect(await session.json()).toEqual({ playerId: null, roomCode: null });
    computer.on('dialog', (dialog) => void dialog.accept());
    await computer
      .locator('.console-player')
      .filter({ hasText: '朋友' })
      .getByRole('button', { name: '移除席位' })
      .click();
    await expect(friend.locator('#my-seat')).toBeHidden();
    expect(party.lobby.get(code).snapshot().players.length).toBe(1);
    await computer.getByRole('button', { name: '关闭房间', exact: true }).click();
    await expect(computer.locator('#room-total')).toHaveText('1 间');
    await expect(owner.locator('#connection')).toHaveText('房间已关闭');
    expect(party.lobby.get(otherCode).snapshot().players.length).toBe(1);
    await mkdir('.runtime/previews', { recursive: true });
    await computer.screenshot({ path: '.runtime/previews/service-console.png', fullPage: true });
  });
});

test('双码电脑页立即提供局域网，公网等待验证；公网手机 HTTP 更新、交接和中断保留原码', async ({
  browser,
}) => {
  await withLobby(
    browser,
    async ({ party, base, publicBase, page }) => {
      const computer = await page(true);
      await computer.goto(base + '/server');
      expect(await checkQr(computer)).toBe('http://192.168.1.100:3000/');
      await expect(computer.locator('#internet-qr')).toBeHidden();
      await expect(computer.locator('#entry-status')).toContainText('正在准备');
      const publicUrl = 'https://browser-party.trycloudflare.com/';
      party.setInternetEntry('ready', '跨网络可扫码', publicUrl);
      await expect(computer.locator('#internet-join-url')).toHaveValue(publicUrl);
      await checkQr(computer, undefined, 'internet-');
      await expect(computer.locator('#internet-network-address')).toBeHidden();
      const owner = await page();
      const code = await createRoom(owner, publicBase, '公网房主');
      const friend = await page();
      await joinRoom(friend, publicBase, code, '其他网络朋友');
      await friend.locator('#ready-button').click();
      await expect(owner.locator('#players')).toContainText('已准备');
      await friend.locator('#share-button').click();
      expect(await checkQr(friend, code)).toBe(new URL(`/join/${code}`, publicUrl).href);
      await expect(friend.locator('#save-qr')).toHaveAttribute('href', /\/api\/qr\.png/);
      await friend.locator('#close-share').click();
      await owner.locator('#leave-button').click();
      await expect(friend.locator('#my-role')).toHaveText('你是房主，也参加这一局');
      party.setInternetEntry('unavailable', '公网连接中断');
      expect(await checkQr(computer)).toBe('http://192.168.1.100:3000/');
      await expect(computer.locator('#internet-join-url')).toHaveValue(publicUrl);
      await checkQr(computer, undefined, 'internet-');
      await expect(computer.locator('#internet-qr-hint')).toContainText('原码保留');
      await friend.locator('#share-button').click();
      expect(await checkQr(friend, code)).toBe(new URL(`/join/${code}`, publicUrl).href);
      await expect(friend.locator('#qr-hint')).toContainText('原码保留');
      await friend.locator('#close-share').click();
      party.setInternetEntry('ready', '原入口恢复', publicUrl);
      await expect(computer.locator('#internet-join-url')).toHaveValue(publicUrl);
      await friend.reload();
      await expect(friend.locator('#my-role')).toHaveText('你是房主，也参加这一局');
      await expect(friend.locator('#ready-button')).toBeEnabled();
      const popup = await page();
      await popup.goto(`${publicBase}/join/${code}`);
      await friend.locator('#leave-button').click();
      await expect(popup.locator('#connection')).toHaveText('房间已关闭');
    },
    true,
  );
});

test('四个局域网成员与一个公网成员同桌，切断公网后局域网仍可入座、设置和准备，两码不重载', async ({
  browser,
}) => {
  await withLobby(
    browser,
    async ({ party, base, publicBase, gateway, page }) => {
      const publicUrl = 'https://mixed-party.trycloudflare.com/';
      party.setInternetEntry('ready', '跨网络可扫码', publicUrl);
      const computer = await page(true);
      let qrRequests = 0;
      computer.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/qr.svg') qrRequests++;
      });
      await computer.goto(base + '/server');
      const lanQr = await checkQr(computer);
      expect(await checkQr(computer, undefined, 'internet-')).toBe(publicUrl);
      const owner = await page();
      const code = await createRoom(owner, base, '局域网房主');
      const locals = [owner];
      for (let index = 1; index < 4; index++) {
        const local = await page();
        await joinRoom(local, base, code, `同 Wi-Fi ${index}`);
        locals.push(local);
      }
      const remote = await page();
      await joinRoom(remote, publicBase, code, '另一家 Wi-Fi');
      await expect(owner.locator('#player-counter')).toHaveText('5 / 5 席');
      expect((await owner.request.get(base + '/api/info').then((r) => r.json())).entry.access).toBe(
        'lan',
      );
      expect(
        (await remote.request.get(publicBase + '/api/info').then((r) => r.json())).entry.access,
      ).toBe('internet');
      party.setInternetEntry('unavailable', '跨网络入口暂时中断，局域网继续可用');
      gateway!.close();
      await expect(computer.locator('#entry-status')).toContainText('暂时中断');
      expect(await checkQr(computer)).toBe(lanQr);
      expect(await checkQr(computer, undefined, 'internet-')).toBe(publicUrl);
      await owner.getByLabel('武将范围').selectOption('advanced');
      await owner.getByRole('button', { name: '保存房间设置' }).click();
      await expect(locals[1]!.locator('#summary-details')).toContainText('进阶档');
      await locals.pop()!.getByRole('button', { name: '离开房间', exact: true }).click();
      const replacement = await page();
      await joinRoom(replacement, base, code, '断公网后入座');
      locals.push(replacement);
      for (const local of locals) await local.locator('#ready-button').click();
      await expect
        .poll(
          () =>
            party.lobby
              .get(code)
              .snapshot()
              .players.filter((player) => player.ready).length,
        )
        .toBe(4);
      await replacement.locator('#share-button').click();
      expect(new URL(await checkQr(replacement, code)).hostname).toBe('192.168.1.100');
      await replacement
        .locator('#network-address')
        .selectOption(new URL(`/join/${code}`, publicUrl).href);
      await expect(replacement.locator('#qr-hint')).toContainText('原码保留');
      for (let index = 0; index < 3; index++) await computer.locator('#refresh-address').click();
      expect(qrRequests, '控制台状态刷新不重复下载相同二维码').toBe(2);
      await mkdir('.runtime/previews', { recursive: true });
      await computer.screenshot({ path: '.runtime/previews/hybrid-console.png', fullPage: true });
    },
    true,
  );
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

test('局外图鉴可查看两档技能、筛选和搜索，保持成员在线与房主设置', async ({ browser }) => {
  await withLobby(browser, async ({ party, base, page }) => {
    const phone = await page();
    await phone.goto(base + '/');
    await phone.getByRole('button', { name: '武将图鉴 · 查看技能' }).click();
    await expect(phone.locator('#guide-count')).toHaveText('显示 33 / 33 位武将');
    await phone.getByLabel('查找武将或技能').fill('龙胆');
    await expect(phone.locator('.guide-entry')).toHaveCount(1);
    await phone.locator('.guide-entry summary').click();
    await expect(phone.locator('.guide-entry dd')).toContainText('将【杀】当做【闪】');
    await phone.getByRole('button', { name: '关闭武将图鉴' }).click();
    const code = await createRoom(phone, base, '图鉴房主');
    await phone.getByLabel('武将范围').selectOption('advanced');
    await phone.getByRole('button', { name: '保存房间设置' }).click();
    const member = await page();
    await joinRoom(member, base, code, '学技能');
    await member.getByRole('button', { name: '武将图鉴 · 查看技能' }).click();
    await expect(member.locator('#guide-count')).toHaveText('显示 156 / 156 位武将');
    await member.getByLabel('势力', { exact: true }).selectOption('shen');
    await expect(member.locator('#guide-count')).toHaveText('显示 12 / 156 位武将');
    await member.getByLabel('查找武将或技能').fill('不存在的武将');
    await expect(member.locator('#guide-count')).toContainText('没有找到');
    expect(
      party.lobby
        .get(code)
        .snapshot()
        .players.every((player) => player.online),
    ).toBe(true);
    expect(party.lobby.get(code).snapshot().settings.generalPreset).toBe('advanced');
    await member.screenshot({ path: '.runtime/previews/general-guide-search.png' });
    await member.getByLabel('查找武将或技能').fill('神吕布');
    await member.locator('.guide-entry summary').click();
    await expect(member.locator('.guide-entry dl')).toContainText('无双（关联技能）');
    await member.screenshot({ path: '.runtime/previews/general-guide.png' });
    await member.getByRole('button', { name: '关闭武将图鉴' }).click();
    await expect(member.getByRole('button', { name: '我准备好了' })).toBeEnabled();
  });
});
