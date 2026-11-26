import { test, expect, type Frame, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.js';
import { NativeNonameService } from '../../packages/noname-adapter/src/service.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const phoneOptions = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function serve(testInfo: TestInfo, adapter?: NativeNonameService) {
  const party = createPartyServer({
    port: 0,
    webRoot: `${root}/dist/web`,
    ...(adapter ? { adapter } : {}),
    rosterDirectory: testInfo.outputPath('rosters'),
    shanhetuDirectory: testInfo.outputPath('shanhetu'),
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  return {
    base: `http://127.0.0.1:${address.port}`,
    async close() {
      const closed = new Promise<void>((resolve) => party.server.once('close', resolve));
      party.stop();
      party.server.closeAllConnections();
      await closed;
    },
  };
}

test('切换档位取消正在下载的素材和清单，离开准备房取消当前流', async ({ browser }, testInfo) => {
  const adapter = new NativeNonameService(root);
  const status = adapter.status.bind(adapter);
  adapter.status = () => ({ ...status(), preload: true });
  const original = adapter.handle.bind(adapter);
  const bundle = `/engine/bundle/noname-${'a'.repeat(64)}.js`;
  const stale = `/engine/core/${'b'.repeat(40)}/layout/default/layout.css`;
  const began: string[] = [];
  const cancelled: string[] = [];
  let bundleCount = 0;
  let staleCount = 0;
  function stream(response: ServerResponse, label: string, type: string, chunk: string) {
    began.push(label);
    response.on('close', () => {
      if (!response.writableFinished) cancelled.push(label);
    });
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.write(chunk);
  }
  adapter.handle = async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/engine/preload') {
      if (url.searchParams.get('preset') === 'advanced') {
        stream(response, 'advanced manifest', 'application/json', '{"assets":[');
      } else {
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({ assets: [bundle, stale] }));
      }
      return true;
    }
    if (url.pathname === bundle) {
      stream(response, `bundle ${++bundleCount}`, 'text/javascript', ' '.repeat(65536));
      return true;
    }
    if (url.pathname === stale) {
      staleCount++;
      response.writeHead(200, { 'Content-Type': 'text/css' });
      response.end();
      return true;
    }
    return original(request, response);
  };
  const server = await serve(testInfo, adapter);
  const context = await browser.newContext(phoneOptions);
  try {
    const page = await context.newPage();
    const created = await page.request.post(`${server.base}/api/rooms`, {
      data: { nickname: '断流测试' },
    });
    await expect(created).toBeOK();
    const { room } = await created.json();
    await page.goto(`${server.base}/join/${room.code}`);
    await expect.poll(() => began).toEqual(['bundle 1']);
    const preset = page.locator('#general-preset');
    await expect(preset).toBeVisible();
    await preset.selectOption('advanced');
    await expect.poll(() => cancelled).toEqual(['bundle 1']);
    await expect.poll(() => began).toEqual(['bundle 1', 'advanced manifest']);
    await preset.selectOption('beginner');
    await expect.poll(() => cancelled).toEqual(['bundle 1', 'advanced manifest']);
    await expect.poll(() => began).toEqual(['bundle 1', 'advanced manifest', 'bundle 2']);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect.poll(() => cancelled).toEqual(['bundle 1', 'advanced manifest', 'bundle 2']);
    expect(staleCount).toBe(0);
  } finally {
    await context.close();
    await server.close();
  }
});

test('日夜画卷首屏只请求当前主题，切换后逐渐替换原图', async ({ browser }, testInfo) => {
  const server = await serve(testInfo);
  const dayContext = await browser.newContext(phoneOptions);
  const nightContext = await browser.newContext(phoneOptions);
  const artSelector = '.zibai-backdrop img';
  function requests(page: Page) {
    const artwork = new Set<string>();
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (/\/assets\/zibai-(day|night)\.webp$/.test(path)) artwork.add(path);
    });
    return artwork;
  }
  async function expectArtwork(page: Page, theme: string) {
    const artwork = page.locator(artSelector);
    await expect(artwork).toHaveCount(1);
    await expect(artwork).toHaveAttribute('src', new RegExp(`zibai-${theme}\\.webp`));
    await expect
      .poll(() => artwork.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  }
  try {
    const day = await dayContext.newPage();
    const dayRequests = requests(day);
    await day.goto(server.base);
    await expectArtwork(day, 'day');
    expect([...dayRequests]).toEqual(['/assets/zibai-day.webp']);
    await day.locator('#theme-toggle').tap();
    await expect(day.locator(`${artSelector}[src*="zibai-night"]`)).toBeVisible();
    await expectArtwork(day, 'night');
    expect([...dayRequests]).toEqual(['/assets/zibai-day.webp', '/assets/zibai-night.webp']);

    await nightContext.addInitScript(() => localStorage.setItem('party_zibai_theme', 'night'));
    const night = await nightContext.newPage();
    const nightRequests = requests(night);
    await night.goto(server.base);
    await expectArtwork(night, 'night');
    expect([...nightRequests]).toEqual(['/assets/zibai-night.webp']);
  } finally {
    await Promise.all([dayContext.close(), nightContext.close()]);
    await server.close();
  }
});

async function resourceTimings(view: Page | Frame, paths: string[], initiator?: string) {
  return view.evaluate(
    ({ paths, initiator }) =>
      paths.map((path) => {
        const url = new URL(path, location.origin).href;
        const entry = (performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[])
          .filter((item) => !initiator || item.initiatorType === initiator)
          .at(-1);
        return {
          path,
          transferred: entry?.transferSize ?? -1,
          decoded: entry?.decodedBodySize ?? 0,
        };
      }),
    { paths, initiator },
  );
}

test('自定义将池温完素材后，真实发牌复用同一浏览器缓存中的引擎和小图', async ({
  browser,
}, testInfo) => {
  test.setTimeout(150000);
  const adapter = new NativeNonameService(root);
  if (!adapter.status().preload) {
    adapter.close();
    test.skip(true, '需要已经准备好的固定原生引擎');
  }
  const server = await serve(testInfo, adapter);
  const computer = await browser.newContext();
  const player = await browser.newContext(phoneOptions);
  try {
    await player.addInitScript(() => performance.setResourceTimingBufferSize(4096));
    const supervisor = await computer.newPage();
    await supervisor.goto(`${server.base}/server`);
    await expect.poll(() => adapter.status().ready, { timeout: 20000 }).toBe(true);
    const page = await player.newPage();
    const created = await page.request.post(`${server.base}/api/rooms`, {
      data: { nickname: '缓存验收' },
    });
    await expect(created).toBeOK();
    const { room } = await created.json();
    const roomApi = `${server.base}/api/rooms/${room.code}`;
    const general = 're_zhangliao';
    const saved = await page.request.post(`${roomApi}/rosters`, {
      data: {
        name: '跨池缓存验收',
        basePreset: 'beginner',
        characters: ['caocao', 'liubei', 'sunquan', 'guanyu', 'zhangfei', general],
      },
    });
    await expect(saved).toBeOK();
    const { roster } = await saved.json();
    const settings = await page.request.put(roomApi, {
      data: {
        mode: 'duel',
        playerCount: 2,
        generalPreset: 'beginner',
        customRoster: { id: roster.id, revision: roster.revision },
        allowGeneralSelection: true,
        extensions: [],
      },
    });
    await expect(settings).toBeOK();
    await expect(await page.request.post(`${roomApi}/bots`, { data: { count: 1 } })).toBeOK();
    await expect(await page.request.put(`${roomApi}/me/general`, { data: { general } })).toBeOK();
    const manifest = await page.request.get(
      `${server.base}/engine/preload?preset=beginner&mode=duel&roster=${roster.id}&revision=${roster.revision}`,
    );
    await expect(manifest).toBeOK();
    const { assets }: { assets: string[] } = await manifest.json();
    const soundEffects = assets.filter((path) => path.includes('/audio/'));
    expect(soundEffects).toHaveLength(6);
    for (const path of soundEffects)
      expect(path).toMatch(/\/audio\/card\/(male|female)\/(sha|shan|jiu)\.mp3$/);
    const { characters }: { characters: Record<string, string> } = JSON.parse(
      await readFile(`${root}/dist/engine/portraits/manifest.json`, 'utf8'),
    );
    const bundle = assets.find((path) => path.startsWith('/engine/bundle/'));
    const portrait = assets.find(
      (path) => path.startsWith('/engine/portraits/') && path.endsWith(`/${characters[general]}`),
    );
    if (!bundle || !portrait) throw new Error('自定义将池没有对应版本的引擎和手机小图');
    const expected = [bundle, portrait];

    await page.goto(`${server.base}/join/${room.code}`);
    await expect(page.locator('#engine-preload')).toContainText('本局通用素材已准备好', {
      timeout: 55000,
    });
    const warmed = await resourceTimings(page, expected, 'fetch');
    expect(
      warmed.every(({ decoded, transferred }) => decoded > 0 && transferred > 0),
      JSON.stringify(warmed),
    ).toBe(true);

    await page.locator('#ready-button').tap();
    await page.locator('#start-button').tap();
    await expect
      .poll(() => page.frames().some((frame) => frame.url().includes('/engine/player/')), {
        timeout: 20000,
      })
      .toBe(true);
    const frame = page.frames().find((view) => view.url().includes('/engine/player/'))!;
    const candidates = frame.locator('.dialog:not(.removing) .button.character.selectable');
    await expect(candidates.first()).toBeVisible({ timeout: 40000 });
    const candidate = await candidates.evaluateAll(
      (buttons, general) =>
        buttons.findIndex((button) => (button as HTMLElement & { link?: string }).link === general),
      general,
    );
    expect(candidate).toBeGreaterThanOrEqual(0);
    await candidates.nth(candidate).tap();
    await frame.locator('.hero-draft .hd-primary').tap();
    await frame.waitForFunction(() => {
      const native = window as Window & {
        partyEngine?: { game: { me?: { countCards(position: string): number } } };
      };
      return (native.partyEngine?.game.me?.countCards('h') ?? 0) > 0;
    });
    await expect
      .poll(async () => (await resourceTimings(frame, expected)).map((item) => item.transferred))
      .toEqual([0, 0]);
    const opened = await resourceTimings(frame, expected);
    expect(opened.every(({ decoded }) => decoded > 0)).toBe(true);
    console.log('native-preload-cache', JSON.stringify({ warmed, opened }));
    await testInfo.attach('native-preload-cache', {
      body: JSON.stringify({ warmed, opened }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await Promise.all([player.close(), computer.close()]);
    await server.close();
  }
});
