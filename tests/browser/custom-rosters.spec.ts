import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.js';
import type { EngineAdapter } from '../../packages/noname-adapter/src/index.js';

// Real lobby, ownership cookie and roster persistence API; no native game is executed here.
async function fixture(
  browser: Browser,
  run: (base: string, page: () => Promise<Page>) => Promise<void>,
) {
  const adapter: EngineAdapter = {
    status: () => ({
      id: 'noname',
      ready: true,
      doudizhuPractice: true,
      message: '界面协议夹具，不执行游戏',
    }),
    start: async () => {},
  };
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../../dist/web/', import.meta.url)),
    adapter,
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  try {
    await run(base, async () => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('dialog', (dialog) => void dialog.accept());
      return page;
    });
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
    party.closeStreams();
    party.server.closeAllConnections();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  }
}
async function create(page: Page, base: string, nickname: string) {
  await page.goto(base);
  await page.locator('#nickname').fill(nickname);
  await page.locator('#create-button').click();
  await expect(page.locator('#my-role')).toContainText('你是房主');
  await page.locator('[data-mode="duel"]').click();
  await expect(page.locator('#summary-mode')).toContainText('单挑');
  await expect(page.locator('#custom-rosters-open')).toBeEnabled();
  return page.url().split('/').at(-1)!;
}
async function open(page: Page) {
  await page.locator('#custom-rosters-open').click();
  await expect(page.locator('#custom-rosters-status')).not.toHaveText('正在处理…');
  await expect(page.locator('#custom-rosters-new')).toBeEnabled();
}
async function copyStandard(page: Page) {
  await page.locator('#custom-rosters-copy-preset').selectOption('preset:beginner');
  await page.locator('#custom-rosters-copy-built-in').click();
  await expect(page.locator('#custom-rosters-count')).toContainText('已选 27 将');
  await expect(page.locator('#custom-rosters-save')).toBeEnabled();
}

test('自定义将池：复制保存即时应用、版本冻结、图鉴点将和切回内置（真实大厅API）', async ({
  browser,
}) => {
  await fixture(browser, async (base, pageFactory) => {
    const page = await pageFactory();
    const code = await create(page, base, '自定义房主');
    await open(page);
    await copyStandard(page);
    const name = '<img src=x>朋友常用将';
    await page.locator('#custom-rosters-name').fill(name);
    await page.locator('#custom-rosters-save-use').click();
    await expect(page.locator('#custom-rosters-dialog')).not.toBeVisible();
    await expect(page.locator('#summary-details')).toContainText(name);
    const room = async () =>
      (await (await page.request.get(`${base}/api/rooms/${code}`)).json()).room;
    const first = await room();
    expect(first.settings.customRoster.revision).toBe(1);
    await page.locator('#general-guide').click();
    await expect(page.locator('#guide-count')).toContainText('27 / 27');
    await expect(page.locator('#guide-source')).toContainText('自定义名单');
    await page.locator('#guide-close').click();
    await page.locator('#allow-general-selection').check();
    await expect(page.locator('#summary-selection')).toContainText('点将已开放');
    expect((await room()).settings.customRoster).toEqual(first.settings.customRoster);
    await page.locator('#general-pick').click();
    await expect(page.locator('#guide-count')).toContainText('27 / 27');
    await expect(page.locator('#guide-preset')).toBeDisabled();
    await page.locator('#guide-close').click();
    await open(page);
    // The editor keeps its saved version available without a page reload.
    await page.locator('#custom-rosters-name').fill('朋友常用将第二版');
    await page.locator('#custom-rosters-query').fill('zhenji');
    await page.locator('[data-general="zhenji"] input').uncheck();
    await page.locator('#custom-rosters-save').click();
    await expect(page.locator('#custom-rosters-draft')).toContainText('第 2 版');
    expect((await room()).settings.customRoster.revision).toBe(1);
    await page.locator('#custom-rosters-close').click();
    await page.locator('#general-guide').click();
    await expect(page.locator('#guide-count')).toContainText('27 / 27');
    await page.locator('#guide-close').click();
    await open(page);
    await page.locator('#custom-rosters-save-use').click();
    await expect(page.locator('#summary-details')).toContainText('朋友常用将第二版');
    expect((await room()).settings.customRoster.revision).toBe(2);
    await page.locator('#general-guide').click();
    await expect(page.locator('#guide-count')).toContainText('26 / 26');
    await page.locator('#guide-close').click();
    await page.locator('#general-preset').selectOption('advanced');
    await expect.poll(async () => (await room()).settings.customRoster ?? null).toBeNull();
    await expect(page.locator('#summary-details')).toContainText('经典进阶96将');
    await page.locator('[data-mode="college"]').click();
    await expect(page.locator('#general-preset')).toBeDisabled();
    await expect(page.locator('#custom-rosters-open')).toBeDisabled();
  });
});

test('自定义将池：跨来源勾选、容量错误保留已保存草稿、手机操作可达（真实大厅API）', async ({
  browser,
}) => {
  await fixture(browser, async (base, pageFactory) => {
    const page = await pageFactory();
    await create(page, base, '手机编辑');
    await open(page);
    await page.locator('#custom-rosters-new').click();
    await page
      .locator('#custom-rosters-name')
      .fill('中文长名称测试朋友们每个月都能自己选的自定义名单');
    await page.locator('#custom-rosters-save').click();
    await expect(page.locator('#custom-rosters-status')).toContainText('至少选择一名');
    await page.locator('#custom-rosters-query').fill('caocao');
    await page.locator('[data-general="caocao"] input').check();
    await page.locator('#custom-rosters-query').fill('sxrm_caocao');
    await page.locator('[data-general="sxrm_caocao"] input').check();
    await page.locator('#custom-rosters-selected').check();
    await page.locator('#custom-rosters-query').fill('');
    await expect(page.locator('#custom-rosters-count')).toContainText('已选 2 将');
    await expect(page.locator('#custom-rosters-generals article')).toHaveCount(2);
    await page.locator('[data-general="sxrm_caocao"] details').click();
    await expect(page.locator('[data-general="sxrm_caocao"]')).toContainText('枯心');
    for (const size of [
      { width: 390, height: 844 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(size);
      await expect(page.locator('#custom-rosters-save-use')).toBeInViewport();
      expect(
        await page
          .locator('#custom-rosters-dialog')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
    // One character is a valid saved draft, but cannot be applied to a two-seat game.
    // A removed item immediately leaves the selected-only list, so click and
    // assert the resulting list instead of asking uncheck() to reread a detached input.
    await page.locator('[data-general="sxrm_caocao"] input').click();
    await expect(page.locator('#custom-rosters-count')).toContainText('已选 1 将');
    await page.locator('#custom-rosters-save-use').click();
    await expect(page.locator('#custom-rosters-status')).toContainText(/不足|至少|需要/);
    await expect(page.locator('#custom-rosters-name')).toHaveValue(
      '中文长名称测试朋友们每个月都能自己选的自定义名单',
    );
    await expect(page.locator('#custom-rosters-count')).toContainText('已选 1 将');
    await expect(page.locator('#custom-rosters-draft')).toContainText('已保存第 1 版');
  });
});

test('自定义将池：他人名单只能复制、旧服务404不显示入口（真实大厅API）', async ({ browser }) => {
  await fixture(browser, async (base, pageFactory) => {
    const owner = await pageFactory();
    await create(owner, base, '原作者');
    await open(owner);
    await copyStandard(owner);
    await owner.locator('#custom-rosters-name').fill('他人公开名单');
    await owner.locator('#custom-rosters-save').click();
    await expect(owner.locator('#custom-rosters-status')).toContainText('名单已保存');
    const guest = await pageFactory();
    await create(guest, base, '另一位房主');
    await open(guest);
    const card = guest.locator('.custom-roster-card').filter({ hasText: '他人公开名单' });
    await expect(card).toContainText('当前入口只能复制');
    await expect(guest.locator('#custom-rosters-library')).toContainText(
      '名单保存在电脑；原浏览器和入口保留编辑权，换入口可复制继续编辑。',
    );
    await expect(card.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
    await expect(card.getByRole('button', { name: '归档', exact: true })).toHaveCount(0);
    await expect(card.getByRole('button', { name: '用于本房间', exact: true })).toHaveCount(0);
    await card.getByRole('button', { name: '复制', exact: true }).click();
    await expect(guest.locator('#custom-rosters-name')).toHaveValue('他人公开名单（副本）');
    await expect(guest.locator('#custom-rosters-count')).toContainText('已选 27 将');
    await owner.locator('#custom-rosters-back').click();
    await owner
      .locator('.custom-roster-card')
      .filter({ hasText: '他人公开名单' })
      .getByRole('button', { name: '归档', exact: true })
      .click();
    await expect(owner.locator('#custom-rosters-status')).toContainText('已归档');
    await expect(owner.locator('.custom-roster-card')).toHaveCount(0);
    await owner.locator('#custom-rosters-archived').check();
    await expect(owner.locator('.custom-roster-card')).toContainText('已归档');
    const legacy = await pageFactory();
    await legacy.route('**/api/rosters', (route) =>
      route.fulfill({ status: 404, json: { error: { message: '旧服务' } } }),
    );
    await legacy.goto(base);
    await legacy.locator('#nickname').fill('旧服务');
    await legacy.locator('#create-button').click();
    await expect(legacy.locator('#my-role')).toContainText('你是房主');
    await expect(legacy.locator('#custom-rosters-open')).toBeHidden();
  });
});

test('自定义将池：房主转移立即禁写并保留草稿，服务端拒绝旧房主提交', async ({ browser }) => {
  await fixture(browser, async (base, pageFactory) => {
    const owner = await pageFactory();
    const code = await create(owner, base, '原房主');
    const friend = await pageFactory();
    await friend.goto(`${base}/join/${code}`);
    await friend.locator('#nickname').fill('接任朋友');
    await friend.locator('#join-button').click();
    await expect(friend.locator('#my-seat')).toBeVisible();
    await open(owner);
    await copyStandard(owner);
    await owner.locator('#custom-rosters-name').fill('房主变更前的草稿');
    const snapshot = (await (await owner.request.get(`${base}/api/rooms/${code}`)).json()).room;
    const next = snapshot.players.find(
      (player: { id: string }) => player.id !== snapshot.ownerId,
    ).id;
    expect(
      (
        await owner.request.put(`${base}/api/rooms/${code}/owner`, { data: { playerId: next } })
      ).ok(),
    ).toBe(true);
    await expect(owner.locator('#custom-rosters-status')).toContainText('房主已变化');
    await expect(owner.locator('#custom-rosters-save')).toBeDisabled();
    await expect(owner.locator('#custom-rosters-save-use')).toBeDisabled();
    await expect(owner.locator('#custom-rosters-name')).toHaveValue('房主变更前的草稿');
    const denied = await owner.request.post(`${base}/api/rooms/${code}/rosters`, {
      data: { name: '旧房主伪造', basePreset: 'beginner', characters: ['caocao'] },
    });
    expect(denied.ok()).toBe(false);
    await owner.locator('#custom-rosters-close').click();
    await expect(friend.locator('#custom-rosters-open')).toBeEnabled();
  });
});
