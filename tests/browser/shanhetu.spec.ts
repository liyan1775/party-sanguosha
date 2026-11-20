// SPDX-License-Identifier: GPL-3.0-only
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.js';
import type { MembershipResult, RoomInfo } from '../../packages/shared/src/contracts.js';
import type { ShanhetuCampaignView } from '../../packages/shared/src/shanhetu.js';

test('山河图手机集市及构筑显示实际得失、余额和重复随身牌（界面夹具）', async ({ browser }) => {
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../../dist/web/', import.meta.url)),
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({
    viewport: { width: 320, height: 780 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const created = await context.request.post(`${base}/api/rooms`, {
      data: { nickname: '试用玩家' },
    });
    expect(created.ok()).toBe(true);
    const membership = (await created.json()) as MembershipResult;
    const { code } = membership.room;
    const infoUrl = `${base}/api/rooms/${code}`;
    const initial = (await (await context.request.get(infoUrl)).json()) as RoomInfo;
    const journey: ShanhetuCampaignView = {
      id: 'test-journey',
      revision: 1,
      scenario: '诸侯伐董',
      difficulty: 1,
      phase: 'choice',
      chapter: 1,
      days: 3,
      coins: 350,
      skillSlots: 2,
      hero: { general: 'caocao', group: 'wei', hp: 4, maxHp: 4 },
      heroName: '曹操',
      build: {
        skills: [],
        tactics: [],
        initialCards: 0,
        draw: 0,
        armor: 0,
        extraSha: 0,
        handLimit: 0,
        cards: [4004, 4062, 4062],
      },
      companions: [],
      node: { id: 'shop', name: '集市', kind: 'shop', description: '选择商品。' },
      actions: [
        {
          id: 'replace',
          label: '购入青龙偃月刀',
          description: '一张【杀】被【闪】抵消后，可以再使用一张【杀】。',
          replacement: [{ name: '青釭剑', description: '使用【杀】时无视目标的防具。' }],
          cost: 250,
          kind: 'buy',
          offer: { kind: 'equipment', rarity: 2 },
        },
        {
          id: 'unaffordable',
          label: '无中生有',
          description: '摸两张牌。',
          cost: 450,
          kind: 'buy',
        },
      ],
      completedNodes: 2,
      victories: 2,
      lastBattle: null,
    };
    const room = {
      ...initial.room,
      settings: { ...initial.room.settings, mode: 'shanhetu' as const },
      shanhetu: journey,
    };
    const page = await context.newPage();
    await page.route(infoUrl, (route) => route.fulfill({ json: { ...initial, room } }));
    await page.route(`${infoUrl}/events*`, (route) =>
      route.fulfill({
        ...(new URL(route.request().url()).searchParams.get('transport') === 'poll'
          ? { json: room }
          : {
              contentType: 'text/event-stream',
              body: `event: room\ndata: ${JSON.stringify(room)}\n\n`,
            }),
      }),
    );
    await page.goto(`${base}/join/${code}`);
    const panel = page.locator('#shanhetu-panel');
    await expect(panel).toBeVisible();
    const replace = panel.getByRole('button', { name: /购入青龙偃月刀/ });
    await expect(replace).toContainText('可以再使用一张【杀】');
    await expect(replace).toContainText('将失去 · 青釭剑');
    await expect(replace).toContainText('无视目标的防具');
    await expect(replace).toContainText('购买后余 100 铜币');
    await replace.tap();
    await expect(panel.locator('#shanhetu-confirm')).toBeEnabled();
    await expect(panel.locator('.shanhetu-tray-meta')).toHaveText('购买后余 100 铜币');
    await panel.getByRole('button', { name: /无中生有/ }).tap();
    await expect(panel.locator('#shanhetu-confirm')).toHaveText('还差 100 铜币');
    await expect(panel.locator('#shanhetu-confirm')).toBeDisabled();
    await panel.getByRole('button', { name: '本局构筑' }).tap();
    const build = page.getByRole('dialog', { name: '本局构筑' });
    await expect(build.getByText('武器栏 · 青釭剑')).toBeVisible();
    await expect(build.getByText('杀 ×2')).toBeVisible();
    await build.getByRole('button', { name: '关闭' }).tap();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 780 });
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
  } finally {
    await context.close();
    party.closeStreams();
    party.server.closeAllConnections();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  }
});
