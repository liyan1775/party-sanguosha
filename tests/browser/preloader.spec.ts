import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.js';
import { NativeNonameService } from '../../packages/noname-adapter/src/service.js';

test('默认原生兼容旧服务：逐项预加载，切换档位只补新增素材，不执行引擎', async ({ browser }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const engine = new NativeNonameService(root);
  expect(engine.status().lightweight).toBe(false);
  // A running v0.6.2 can serve the newly built web assets without losing rooms.
  const status = engine.status.bind(engine);
  engine.status = () => ({ ...status(), lightweight: true });
  const party = createPartyServer({
    port: 0,
    webRoot: `${root}/dist/web`,
    adapter: engine,
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

test('显式旧轻量回归：只准备界面脚本和样式，切换档位不下载原生引擎', async ({ browser }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const engine = new NativeNonameService(root);
  const party = createPartyServer({ port: 0, webRoot: `${root}/dist/web`, adapter: engine });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => sessionStorage.setItem('party_lightweight_verification', '1'));
  const page = await context.newPage();
  const requested: string[] = [],
    manifests: string[] = [],
    faults: string[] = [];
  page.on('pageerror', (error) => faults.push(error.message));
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  await page.route('**/engine/preload?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('client')).toBe('light');
    manifests.push(url.searchParams.get('preset') ?? '');
    // Even an older or malformed manifest must not warm the native bundle.
    await route.fulfill({
      json: {
        assets: [
          '/assets/table.js',
          '/assets/table.css',
          `/engine/bundle/noname-${'a'.repeat(64)}.js`,
        ],
      },
    });
  });
  await page.route('**/assets/table.*', async (route) =>
    route.fulfill({
      contentType: 'text/plain',
      body: 'throw new Error("Preloading must not execute this resource");',
    }),
  );
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator('#nickname').fill('轻量预加载');
    await expect(page.locator('#engine-preload')).toContainText('本局通用素材已准备好');
    await page.locator('#create-button').tap();
    await expect(page.locator('#ready-button')).toBeVisible();
    await expect(page.locator('#engine-preload')).toContainText('本局通用素材已准备好');
    if (!(await page.locator('#general-preset').isVisible()))
      await page.locator('#settings-panel summary').tap();
    await page.locator('#general-preset').selectOption('advanced');
    await expect.poll(() => manifests.includes('advanced')).toBe(true);
    await expect(page.locator('#engine-preload')).toContainText('本局通用素材已准备好');
    expect(
      requested.filter(
        (path) => path.startsWith('/engine/bundle/') || path.startsWith('/engine/core/'),
      ),
    ).toEqual([]);
    expect(new Set(requested.filter((path) => path.startsWith('/assets/table.')))).toEqual(
      new Set(['/assets/table.js', '/assets/table.css']),
    );
    expect(faults).toEqual([]);
  } finally {
    await context.close();
    party.stop();
  }
});
