import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.js';
import { NativeNonameService } from '../../packages/noname-adapter/src/service.js';

test('主页与待机房间在后台逐项预加载，切换档位只补新增素材，不执行引擎', async ({ browser }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const party = createPartyServer({
    port: 0,
    webRoot: `${root}/dist/web`,
    adapter: new NativeNonameService(root),
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const assets = [
    `/engine/bundle/noname-${'a'.repeat(64)}.js`,
    `/engine/core/${'b'.repeat(40)}/layout/default/layout.css`,
  ];
  const additional = `/engine/core/${'b'.repeat(40)}/character/tw.js`;
  let active = 0,
    maximum = 0;
  const requested: string[] = [];
  const faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  await page.route('**/engine/preload?*', async (route) => {
    const advanced = new URL(route.request().url()).searchParams.get('preset') === 'advanced';
    await route.fulfill({ json: { assets: advanced ? [...assets, additional] : assets } });
  });
  await page.route(/\/engine\/(?:bundle\/noname-a+\.js|core\/b+\/)/, async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      contentType: 'text/javascript',
      body: 'throw new Error("Preloading must not execute this resource");',
    });
    active--;
  });
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator('#nickname').fill('预加载测试');
    await expect(page.locator('#engine-preload')).toContainText('本局通用素材已准备好');
    await expect(page.locator('#nickname')).toHaveValue('预加载测试');
    expect(maximum).toBe(1);
    expect(requested).toEqual(assets);
    expect(faults).toEqual([]);
    await page.locator('#create-button').tap();
    await expect(page.locator('#ready-button')).toBeVisible();
    await expect(page.locator('#engine-preload')).toContainText('本局通用素材已准备好');
    const before = requested.length;
    if (!(await page.locator('#general-preset').isVisible()))
      await page.locator('#settings-panel summary').tap();
    await page.locator('#general-preset').selectOption('advanced');
    await expect(page.locator('#engine-preload')).toContainText('本局通用素材已准备好');
    await expect.poll(() => requested.slice(before)).toEqual([additional]);
    expect(maximum).toBe(1);
    expect(faults).toEqual([]);
    expect(await page.locator('#game-frame').count()).toBe(0);
  } finally {
    await context.close();
    party.stop();
  }
});
