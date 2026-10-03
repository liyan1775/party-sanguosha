import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RoomView } from '../../packages/shared/src/contracts.js';
import { createPartyServer } from '../../apps/server/src/server.js';

test('电脑展示二维码，四部手机入座准备，刷新保持席位，换武将档撤销准备', async ({ browser }) => {
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../../dist/web/', import.meta.url)),
    publicUrl: 'http://192.168.1.100:3000',
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  const base = `http://127.0.0.1:${address.port}`;
  const contexts = [];
  const consoleErrors: string[] = [];
  try {
    const hostContext = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    contexts.push(hostContext);
    const host = await hostContext.newPage();
    host.on('pageerror', (error) => consoleErrors.push(error.message));
    await host.goto(`${base}/host#${party.hostSecret}`);
    await expect(host.getByText('已连接牌桌')).toBeVisible();
    await expect(host.locator('#qr')).toBeVisible();
    await expect
      .poll(() => host.locator('#qr').evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect(party.room.snapshot().players).toHaveLength(0);
    await host.getByRole('button', { name: /2v2/ }).click();
    await host.getByRole('button', { name: '保存房间设置' }).click();
    const phones = [];
    for (const nickname of ['诸葛亮', '赵云', '黄忠', '<b>乔</b>']) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      contexts.push(context);
      const phone = await context.newPage();
      phone.on('pageerror', (error) => consoleErrors.push(error.message));
      if (nickname === '诸葛亮') {
        // 模拟入座后的旧 HTTP 快照晚于在线 SSE 到达，复现首次联测的竞争问题。
        let infoRequests = 0;
        let joinedSnapshot: RoomView | undefined;
        const unsubscribe = party.room.subscribe((snapshot) => {
          if (!joinedSnapshot && snapshot.players.length === 1 && !snapshot.players[0]?.online) {
            joinedSnapshot = snapshot;
          }
        });
        await phone.route('**/api/info', async (route) => {
          if (++infoRequests === 2 && joinedSnapshot) {
            const response = await route.fetch();
            const data = await response.json();
            await expect(phone.getByRole('button', { name: '我准备好了' })).toBeEnabled();
            await route.fulfill({ response, json: { ...data, room: joinedSnapshot } });
            unsubscribe();
          } else {
            await route.continue();
          }
        });
      }
      await phone.goto(`${base}/join/${party.room.code}`);
      await phone.getByLabel('怎么称呼你').fill(nickname);
      await phone.getByRole('button', { name: '入座', exact: true }).click();
      await expect(phone.getByRole('button', { name: '我准备好了' })).toBeEnabled();
      await phone.getByRole('button', { name: '我准备好了' }).click();
      await expect(phone.getByRole('button', { name: '已准备 · 点击取消' })).toBeVisible();
      expect(
        await phone.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      phones.push(phone);
    }
    await expect(host.locator('#player-counter')).toHaveText('4 / 4 人');
    await expect(host.getByRole('button', { name: '开始对局' })).toBeDisabled();
    await expect(phones[3]!.locator('#my-nickname')).toHaveText('<b>乔</b>');
    expect(await phones[3]!.locator('#my-nickname b').count()).toBe(0);
    await phones[0]!.reload();
    await expect(phones[0]!.getByRole('button', { name: '我准备好了' })).toBeEnabled();
    expect(party.room.snapshot().players).toHaveLength(4);
    await phones[0]!.getByRole('button', { name: '我准备好了' }).click();
    await expect
      .poll(() => party.room.snapshot().players.filter((player) => player.ready).length)
      .toBe(4);
    await host.getByLabel('武将范围').selectOption('advanced');
    await host.getByRole('button', { name: '保存房间设置' }).click();
    await expect(phones[0]!.locator('#summary-details')).toHaveText('4 人 · 进阶档');
    await expect(phones[0]!.getByRole('button', { name: '我准备好了' })).toBeEnabled();
    expect(party.room.snapshot().players.some((player) => player.ready)).toBe(false);
    await host.getByRole('button', { name: '移出 黄忠', exact: true }).click();
    await expect(phones[2]!.getByRole('button', { name: '入座', exact: true })).toBeVisible();
    await expect(host.locator('#player-counter')).toHaveText('3 / 4 人');
    await mkdir(fileURLToPath(new URL('../../.runtime/previews/', import.meta.url)), {
      recursive: true,
    });
    await host.screenshot({ path: '.runtime/previews/host.png', fullPage: true });
    await phones[0]!.screenshot({ path: '.runtime/previews/player.png', fullPage: true });
    const response = await phones[0]!.request.put(`${base}/api/room`, {
      data: { mode: 'identity', playerCount: 8, generalPreset: 'beginner', extensions: [] },
    });
    expect(response.status()).toBe(403);
    expect(consoleErrors).toEqual([]);
    expect((party.room.snapshot() as RoomView).engine.ready).toBe(false);
  } finally {
    for (const context of contexts) await context.close();
    party.closeStreams();
    party.server.closeAllConnections();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  }
});
