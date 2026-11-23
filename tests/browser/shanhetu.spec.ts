// SPDX-License-Identifier: GPL-3.0-only
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createPartyServer } from '../../apps/server/src/server.js';
import type { MembershipResult, RoomInfo } from '../../packages/shared/src/contracts.js';
import type { ShanhetuCampaignView } from '../../packages/shared/src/shanhetu.js';

test('狭屏卷轴切换双境、查看行军风险并在闭市前二次确认（界面夹具）', async ({ browser }) => {
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
    const membership = (await (
      await context.request.post(`${base}/api/rooms`, { data: { nickname: '行军玩家' } })
    ).json()) as MembershipResult;
    const infoUrl = `${base}/api/rooms/${membership.room.code}`;
    const initial = (await (await context.request.get(infoUrl)).json()) as RoomInfo;
    const journey: ShanhetuCampaignView = {
      id: 'scroll-journey',
      revision: 4,
      scenario: '诸侯伐董',
      difficulty: 21,
      phase: 'map',
      chapter: 2,
      days: 5,
      coins: 420,
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
      },
      companions: [],
      node: null,
      completedNodes: 4,
      victories: 3,
      lastBattle: null,
      actions: [
        { id: 'enter-fight', label: '西凉军', description: '准备迎战。', cost: 0, kind: 'enter' },
        {
          id: 'enter-market',
          label: '官道集市',
          description: '商贩正在等候。',
          cost: 0,
          kind: 'enter',
        },
      ],
      map: {
        regionId: 'dagu',
        name: '大谷关',
        bossAt: 6,
        marketClosing: true,
        regions: [{ id: 'dagu', name: '大谷关', chapter: 2, next: [], completed: false }],
        locations: [
          {
            id: 'fort',
            name: '英武壮志',
            kind: 'boss',
            x: 30,
            y: 284,
            duration: 0,
            unlockDay: 6,
            status: 'locked',
          },
          {
            id: 'fight',
            name: '西凉军',
            kind: 'battle',
            x: 290,
            y: 28,
            duration: 1,
            unlockDay: 0,
            risk: '较高 · 3名敌人',
            rewardTypes: ['铜币', '战法'],
            terrainEffect: '全场摸牌阶段多摸一张牌',
            status: 'available',
            actionId: 'enter-fight',
          },
          {
            id: 'market',
            name: '官道集市',
            kind: 'shop',
            x: -260,
            y: 110,
            duration: 0,
            unlockDay: 3,
            status: 'available',
            actionId: 'enter-market',
          },
          {
            id: 'camp',
            name: '军营',
            kind: 'camp',
            x: -70,
            y: -85,
            duration: 1,
            unlockDay: 0,
            status: 'completed',
          },
        ],
      },
    };
    const room = {
      ...initial.room,
      settings: { ...initial.room.settings, mode: 'shanhetu' as const },
      shanhetu: journey,
    };
    const page = await context.newPage();
    const submitted: unknown[] = [];
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
    await page.route(`${infoUrl}/shanhetu/action`, (route) => {
      submitted.push(route.request().postDataJSON());
      return route.fulfill({ json: room });
    });
    await page.goto(`${base}/join/${membership.room.code}`);
    const panel = page.locator('#shanhetu-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.shanhetu-market-warning')).toHaveText(
      '再推 1 日首领现身，未逛集市将自动关闭！',
    );
    await expect(panel.locator('progress')).toHaveClass('is-market-warning');
    await expect(panel.locator('[data-choice-key="market"] .shanhetu-pin-seal')).toHaveText('将关');
    await expect(panel.locator('.shanhetu-scroll-rod')).toHaveCount(2);
    await expect(panel.locator('.shanhetu-march-lines path')).toHaveCount(3);
    const html = page.locator('html');
    await html.evaluate((node) => node.setAttribute('data-theme', 'day'));
    const day = await panel.evaluate((node) => getComputedStyle(node).backgroundColor);
    await html.evaluate((node) => node.setAttribute('data-theme', 'night'));
    await expect(panel).not.toHaveCSS('background-color', day);
    await panel.getByRole('button', { name: '全屏看图' }).tap();
    await expect(panel.locator('.shanhetu-map')).toHaveClass(/is-focused/);
    const fight = panel.getByRole('button', { name: /西凉军/ });
    expect((await fight.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await fight.tap();
    const preview = panel.locator('.shanhetu-map-focus-detail');
    await expect(preview).toContainText('较高 · 3名敌人');
    await expect(preview).toContainText('预计获得 铜币、战法');
    await expect(preview).toContainText('地形 全场摸牌阶段多摸一张牌');
    await expect(preview).toContainText('耗时 1 日');
    await page.keyboard.press('Escape');
    await expect(panel.locator('.shanhetu-map')).not.toHaveClass(/is-focused/);
    await panel.locator('#shanhetu-confirm').tap();
    const warning = page.getByRole('dialog', { name: '集市即将关闭' });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: '继续看图' }).tap();
    await expect(warning).toBeHidden();
    expect(submitted).toHaveLength(0);
    await panel.locator('#shanhetu-confirm').tap();
    await warning.getByRole('button', { name: '继续行军' }).tap();
    await expect
      .poll(() => submitted)
      .toEqual([{ runId: journey.id, revision: 4, actionId: 'enter-fight' }]);
    expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  } finally {
    await context.close();
    party.closeStreams();
    party.server.closeAllConnections();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  }
});

test('山河图手机开局流派、战利品、招募全文和 PNG 高光卡（界面夹具）', async ({ browser }) => {
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../../dist/web/', import.meta.url)),
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  try {
    const created = await context.request.post(`${base}/api/rooms`, {
      data: { nickname: '试用 <b>玩家</b>' },
    });
    expect(created.ok()).toBe(true);
    const { room: membershipRoom } = (await created.json()) as MembershipResult;
    const infoUrl = `${base}/api/rooms/${membershipRoom.code}`;
    const initial = (await (await context.request.get(infoUrl)).json()) as RoomInfo;
    const reward: ShanhetuCampaignView = {
      id: 'wave-2a',
      revision: 1,
      scenario: '诸侯伐董',
      difficulty: 21,
      phase: 'reward',
      chapter: 1,
      days: 1,
      coins: 480,
      skillSlots: 2,
      hero: { general: 'caocao', group: 'wei', hp: 2, maxHp: 4 },
      heroName: '曹操',
      openingPackage: '爆发首杀包',
      build: {
        skills: [],
        tactics: [],
        initialCards: 0,
        draw: 0,
        armor: 0,
        extraSha: 0,
        handLimit: 0,
      },
      companions: [],
      node: { id: 'hostile', name: '黄巾余众', kind: 'battle', description: '' },
      completedNodes: 1,
      victories: 1,
      lastBattle: { outcome: 'victory', matchId: 'battle-1' },
      actions: [
        {
          id: 'burst',
          kind: 'reward',
          cost: 0,
          label: '当头一棒Ⅱ',
          description: '每轮首杀额外造成2点伤害。',
          offer: { kind: 'tactic', rarity: 2 },
          synergyTags: ['burst'],
          resonance: '已有当头一棒Ⅰ，强化每轮首杀。',
          stackFormula: '当头一棒Ⅰ(+1) + 当头一棒Ⅱ(+2) → 每轮首杀 +3',
        },
        { id: 'reroll', kind: 'reroll', label: '重随奖励', description: '限重随一次。', cost: 80 },
      ],
    };
    let room: RoomInfo['room'] = {
      ...initial.room,
      engine: { ...initial.room.engine, ready: true, shanhetu: true },
      players: initial.room.players.map((player) => ({ ...player, online: true })),
      settings: { ...initial.room.settings, mode: 'shanhetu', playerCount: 1 },
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
    await page.route(`${infoUrl}/shanhetu/book`, (route) =>
      route.fulfill({
        json: {
          revision: 1,
          victories: 0,
          goals: [],
          milestones: [],
          recent: [],
          difficulties: [
            { id: 21, name: '炼狱1', unlocked: true, description: '炼狱增益', unlockText: '' },
            { id: 22, name: '炼狱2', unlocked: false, description: '', unlockText: '通关炼狱1' },
          ],
        },
      }),
    );
    await page.route(`${infoUrl}/start`, async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        difficulty: 21,
        openingTactic: { tactic: null, package: 'burst' },
      });
      room = { ...room, shanhetu: reward };
      await route.fulfill({ json: room });
    });
    await page.route(`${infoUrl}/shanhetu/action`, async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        runId: 'wave-2a',
        revision: 1,
        actionId: 'reroll',
      });
      room = {
        ...room,
        shanhetu: {
          ...reward,
          revision: 2,
          coins: 400,
          rerollUsed: true,
          actions: [reward.actions[0]!],
        },
      };
      await route.fulfill({ json: room });
    });

    const url = `${base}/join/${membershipRoom.code}`;
    await page.goto(url);
    await expect(page.locator('#shanhetu-difficulty')).toHaveValue('21');
    await expect(page.locator('#shanhetu-difficulty option[value="22"]')).toBeDisabled();
    await page.getByRole('button', { name: /爆发首杀包/ }).tap();
    await expect(page.getByRole('button', { name: /爆发首杀包/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#start-button')).toBeEnabled();
    await page.locator('#start-button').tap();
    const panel = page.locator('#shanhetu-panel');
    const confirm = panel.locator('#shanhetu-confirm');
    await expect(panel.getByText('流派共振')).toBeVisible();
    await expect(panel.getByText(/每轮首杀 \+3/)).toBeVisible();
    await panel.getByRole('button', { name: '重随奖励 · 80 铜币' }).tap();
    await expect(confirm).toHaveText('重随 · 80 铜币');
    await confirm.tap();
    await expect(panel.getByText('本组奖励已重随一次')).toBeVisible();
    await expect(panel.getByRole('button', { name: /重随奖励/ })).toHaveCount(0);

    room.shanhetu = {
      ...reward,
      revision: 3,
      phase: 'choice',
      node: { id: 'recruit', name: '招贤', kind: 'event', description: '寻找同行队友。' },
      actions: [
        {
          id: 'elite',
          kind: 'choice',
          cost: 400,
          label: '曹昂',
          description: '招募曹昂。',
          recruitLabel: '400 铜币精英队友',
          skills: [
            { name: '慷忾', description: '当一名角色成为【杀】的目标后，你可以摸一张牌。' },
            { name: '卫戍', description: '锁定技，你于摸牌阶段外摸牌后，令一名角色摸一张牌。' },
          ],
        },
      ],
    };
    await page.reload();
    await panel.getByText('查看全部技能（2）').tap();
    await expect(panel.getByText(/当一名角色成为【杀】的目标后/)).toBeVisible();
    await expect(panel.getByText(/锁定技，你于摸牌阶段外/)).toBeVisible();
    await panel.getByRole('button', { name: /曹昂.*400 铜币精英队友/ }).tap();
    await expect(confirm).toHaveText('招募 · 400 铜币精英队友');

    room.shanhetu = {
      ...reward,
      revision: 4,
      phase: 'won',
      actions: [],
      highlight: {
        build: ['爆发首杀包', '当头一棒Ⅱ'],
        battle: { name: '大谷关 · 英武壮志', defeatedEnemies: 3, remainingHp: 2, victory: true },
      },
      finalReport: {
        title: '震古烁今',
        earnedCoins: 480,
        reputation: 1,
        strategy: 30,
        merit: 20,
        trade: 0,
        battleSeconds: 980,
      },
      bookAward: { victories: 10, unlocked: ['炼狱2'] },
    };
    await page.reload();
    const recap = panel.getByRole('heading', { name: '征程高光复盘卡' });
    await expect(recap).toBeVisible();
    await expect(panel.getByText('试用 <b>玩家</b> · 曹操')).toBeVisible();
    await expect(panel.getByText(/大谷关 · 英武壮志 · 取胜/)).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await panel.getByRole('button', { name: '保存征程高光卡（PNG）' }).tap();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('山河图-征程高光.png');
    const png = await readFile((await download.path())!);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(1080);
  } finally {
    await context.close();
    party.closeStreams();
    party.server.closeAllConnections();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  }
});

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
          refund: 100,
          effectDelta: '将替换青釭剑并回收 +100 铜币',
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
        {
          id: 'forge',
          label: '锻造当头一棒Ⅰ',
          description: '升级至当头一棒Ⅱ。',
          cost: 180,
          kind: 'forge',
          stackFormula: '每轮首杀 +1 → 每轮首杀 +2',
        },
        {
          id: 'recycle',
          label: '回收随身杀',
          description: '回收一份随身牌。',
          cost: 0,
          refund: 50,
          kind: 'recycle',
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
    await expect(replace).toContainText('将替换青釭剑并回收 +100 铜币');
    await expect(replace).toContainText('购买后余 200 铜币');
    await replace.tap();
    await expect(panel.locator('#shanhetu-confirm')).toBeEnabled();
    await expect(panel.locator('.shanhetu-tray-meta')).toHaveText('购买后余 200 铜币');
    await panel.getByRole('button', { name: /无中生有/ }).tap();
    await expect(panel.locator('#shanhetu-confirm')).toHaveText('还差 100 铜币');
    await expect(panel.locator('#shanhetu-confirm')).toBeDisabled();
    await panel.getByRole('button', { name: /锻造当头一棒Ⅰ/ }).tap();
    await expect(panel.locator('#shanhetu-confirm')).toHaveText('锻造 · 180 铜币');
    await expect(panel.locator('.shanhetu-tray-meta')).toHaveText('锻造后余 170 铜币');
    await panel.getByRole('button', { name: /回收随身杀/ }).tap();
    await expect(panel.locator('#shanhetu-confirm')).toHaveText('确认回收 +50 铜币');
    await expect(panel.locator('.shanhetu-tray-meta')).toHaveText('回收后余 400 铜币');
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
