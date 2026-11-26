// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.js';
import type { MembershipResult, RoomInfo } from '../../packages/shared/src/contracts.js';
import type { ShanhetuCampaignView } from '../../packages/shared/src/shanhetu.js';

test('山河图择将台在三种视口独立显示技能，并提交所选的合法势力', async ({ browser }) => {
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../../dist/web/', import.meta.url)),
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
  });
  try {
    const created = await context.request.post(`${base}/api/rooms`, {
      data: { nickname: '择将验证' },
    });
    expect(created.ok()).toBe(true);
    const { room } = (await created.json()) as MembershipResult;
    const infoUrl = `${base}/api/rooms/${room.code}`;
    const initial = (await (await context.request.get(infoUrl)).json()) as RoomInfo;
    const candidate = (general: string, label: string, group: string, skill: string) => ({
      id: `${general}-${group}`,
      general,
      label,
      group,
      kind: 'hero' as const,
      cost: 0,
      description: `${general === 'caocao' ? '4/5' : general === 'shencaocao' ? '3/6' : '4/4'}体力`,
      skills: [{ name: skill, description: '完整技能文本<br>第二行' }],
    });
    const journey: ShanhetuCampaignView = {
      id: 'draft-run',
      revision: 1,
      scenario: '诸侯伐董 · 普通1',
      difficulty: 1,
      phase: 'selection',
      chapter: 1,
      days: 0,
      coins: 0,
      skillSlots: 2,
      hero: null,
      initialTactics: ['勤勉'],
      openingPackage: '过牌续航包',
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
      completedNodes: 0,
      victories: 0,
      lastBattle: null,
      actions: [
        candidate('caocao', '曹操', 'wei', '奸雄'),
        candidate('shencaocao', '神曹操', 'shu', '归心'),
        candidate('shencaocao', '神曹操', 'wei', '归心'),
        candidate('zhaoyun', '赵云', 'shu', '龙胆'),
        candidate('sunquan', '孙权', 'wu', '制衡'),
        candidate('lvbu', '吕布', 'qun', '无双'),
      ],
    };
    let roomView: RoomInfo['room'] = {
      ...initial.room,
      settings: { ...initial.room.settings, mode: 'shanhetu', playerCount: 1 },
      shanhetu: journey,
    };
    const page = await context.newPage();
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() === 404) failures.push(new URL(response.url()).pathname);
    });
    await page.route(infoUrl, (route) => route.fulfill({ json: { ...initial, room: roomView } }));
    await page.route(`${infoUrl}/events*`, (route) =>
      route.fulfill(
        new URL(route.request().url()).searchParams.get('transport') === 'poll'
          ? { json: roomView }
          : {
              contentType: 'text/event-stream',
              body: `event: room\ndata: ${JSON.stringify(roomView)}\n\n`,
            },
      ),
    );
    const submissions: unknown[] = [];
    await page.route(`${infoUrl}/shanhetu/action`, (route) => {
      submissions.push(route.request().postDataJSON());
      roomView = {
        ...roomView,
        shanhetu: {
          ...journey,
          revision: journey.revision + 1,
          phase: 'reward',
          actions: [
            { id: 'skill', kind: 'reward', cost: 0, label: '额外技能', description: '奖励' },
          ],
        },
      };
      return route.fulfill({ json: roomView });
    });
    await page.goto(`${base}/join/${room.code}`);
    const draft = page.locator('.shanhetu-draft');
    const confirm = draft.locator('#shanhetu-confirm');
    await expect(draft).toBeVisible();
    await expect(draft.locator('.hd-self')).toHaveText('诸侯伐董 · 普通1 · 择将出征');
    const tactic = draft.getByRole('button', { name: '初始战法 · 勤勉', exact: true });
    await expect(tactic).toBeVisible();
    await expect(draft.locator('.hd-seats')).toContainText('过牌续航包');
    await expect(draft.locator('#shanhetu-options [data-general]')).toHaveCount(5);
    await expect(confirm).toBeDisabled();
    await draft.locator('[data-general="caocao"]').click();
    await expect(confirm).toHaveText('确认出战：曹操');
    await expect(draft.locator('#shanhetu-draft-skills .hd-skills')).toContainText('奸雄');
    await expect(draft.locator('[data-general="caocao"] .hd-card-meta')).toHaveText('魏 · 4/5');
    await expect(draft.locator('[data-general="shencaocao"] .hd-card-meta')).toHaveText('神 · 3/6');
    await expect(draft.locator('[data-general="zhaoyun"] .hd-card-meta')).toHaveText('蜀 · 4');
    await tactic.click();
    const popup = draft.getByRole('dialog', { name: '初始战法' });
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('你始终跳过你的判定阶段');
    await popup.getByRole('button', { name: '返回候选', exact: true }).click();
    await expect(popup).toBeHidden();
    await expect(draft.locator('[data-general="caocao"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(confirm).toHaveText('确认出战：曹操');
    expect(submissions).toEqual([]);

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 844, height: 390 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      if (viewport.width < viewport.height) {
        await expect(draft.locator('.hd-scroll')).toBeHidden();
        const show = draft.getByRole('button', { name: '查看技能', exact: true });
        await show.tap();
        await expect(show).toBeHidden();
        const back = draft.getByRole('button', { name: '返回候选', exact: true });
        await expect(back).toHaveCount(1);
        await expect(back).toBeFocused();
        await expect(draft.locator('.hd-pool')).toBeHidden();
        await expect(draft.locator('.hd-scroll-heading h3')).toContainText('曹操');
        await expect(draft.locator('.hd-detail-selection')).toHaveText('待确认：曹操');
      }
      await expect(draft.locator('.hd-scroll')).toBeVisible();
      const layout = await draft.evaluate((root) => {
        const bounds = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
        const head = bounds('.hd-header');
        const pool = bounds('.hd-pool');
        const skills = bounds('.hd-scroll');
        const footer = bounds('.hd-actions');
        const card = bounds('.hd-card');
        const buttons = [...root.querySelectorAll('.hd-actions button')].filter(
          (button) => button.getClientRects().length,
        );
        const portrait = root.classList.contains('detail-open');
        return {
          separated:
            skills.bottom <= footer.top &&
            (portrait
              ? head.bottom <= skills.top
              : head.bottom <= pool.top && pool.right <= skills.left),
          usable:
            (portrait || pool.height >= 100) &&
            skills.height >= 100 &&
            footer.bottom <= innerHeight + 1,
          intact: portrait || Math.abs(card.width / card.height - 2 / 3) < 0.035,
          operationsVisible: buttons.every((button) => {
            const control = button.getBoundingClientRect();
            return (
              control.left >= footer.left - 1 &&
              control.right <= footer.right + 1 &&
              control.top >= footer.top &&
              control.bottom <= innerHeight + 1
            );
          }),
          noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        };
      });
      expect(layout, `${viewport.width}×${viewport.height}`).toEqual({
        separated: true,
        usable: true,
        intact: true,
        operationsVisible: true,
        noHorizontalOverflow: true,
      });
    }
    await page.keyboard.press('Escape');
    const caocao = draft.locator('[data-general="caocao"]');
    await expect(caocao).toBeFocused();
    // The opening tactic can also be opened from the skill page. Closing returns to the candidates.
    await draft.getByRole('button', { name: '查看技能', exact: true }).tap();
    await expect(draft.locator('.hd-scroll')).toBeVisible();
    await tactic.tap();
    await expect(popup).toBeVisible();
    await popup.getByRole('button', { name: '返回候选', exact: true }).tap();
    await expect(draft.locator('.hd-scroll')).toBeHidden();
    await expect(caocao).toBeFocused();
    await expect(caocao).toHaveAttribute('aria-pressed', 'true');
    await expect(confirm).toHaveText('确认出战：曹操');
    await draft.locator('[data-general="shencaocao"]').tap();
    await expect(confirm).toBeDisabled();
    await draft
      .getByRole('group', { name: '选择出征势力' })
      .getByRole('button', { name: '魏' })
      .tap();
    await expect(confirm).toHaveText('确认出战：神曹操');
    expect(submissions).toEqual([]);
    await confirm.tap();
    await expect(draft).toBeHidden();
    await expect(page.locator('#shanhetu-options')).toContainText('额外技能');
    expect(submissions).toEqual([
      { runId: journey.id, revision: journey.revision, actionId: 'shencaocao-wei' },
    ]);
    expect(failures).toEqual([]);
  } finally {
    await context.close();
    party.closeStreams();
    party.server.closeAllConnections();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  }
});
