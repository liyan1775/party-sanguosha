// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from '@playwright/test';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createPartyServer } from '../../apps/server/src/server.ts';
import { NativeNonameService } from '../../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from '../../scripts/native-ui-actions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = join(root, '.runtime/batch1b-evidence-20261125');

async function isolatedParty() {
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(join(evidence, 'party-'));
  const party = createPartyServer({
    port: 0,
    webRoot: join(root, 'dist/web'),
    adapter: new NativeNonameService(root),
    rosterDirectory: join(scratch, 'rosters'),
    shanhetuDirectory: join(scratch, 'shanhetu'),
  });
  await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${party.server.address().port}`,
    async close() {
      const closed = once(party.server, 'close');
      party.stop();
      party.server.closeAllConnections();
      await closed;
      await rm(scratch, { recursive: true, force: true });
    },
  };
}

function watch(page) {
  const faults = [];
  page.on('pageerror', (error) => faults.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') faults.push(`${message.location().url} ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() === 404) faults.push(response.url());
  });
  return faults;
}

test('Batch 1B 大厅六枚玉印尺寸稳定、强缓存与移动端取证', async ({ browser }) => {
  const party = await isolatedParty();
  try {
    for (const [name, options] of [
      ['desktop', { viewport: { width: 1280, height: 900 } }],
      ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ]) {
      const context = await browser.newContext(options);
      try {
        const page = await context.newPage();
        const faults = watch(page);
        const images = new Map();
        page.on('response', (response) => {
          if (response.url().includes('/assets/emblems/')) images.set(response.url(), response);
          if (/art-masters|\.runtime|\bmaster[.-]/.test(response.url()))
            faults.push(response.url());
        });
        let release;
        const waiting = new Promise((resolve) => (release = resolve));
        await page.route('**/assets/emblems/**', async (route) => {
          await waiting;
          await route.continue();
        });
        await page.goto(party.base, { waitUntil: 'domcontentloaded' });
        const emblems = page.locator('.sgs-mode-mark img');
        await expect(emblems).toHaveCount(6);
        const boxes = await emblems.evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().toJSON()),
        );
        release();
        await expect.poll(() => images.size).toBe(6);
        await expect
          .poll(() =>
            emblems.evaluateAll((nodes) =>
              nodes.map((node) => [node.naturalWidth, node.naturalHeight]),
            ),
          )
          .toEqual(Array.from({ length: 6 }, () => [128, 128]));
        expect(
          await emblems.evaluateAll((nodes) =>
            nodes.map((node) => node.getBoundingClientRect().toJSON()),
          ),
        ).toEqual(boxes);
        for (const [url, response] of images) {
          expect(url).toMatch(/\.webp\?v=[a-f0-9]{64}$/);
          expect(response.status()).toBe(200);
          expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
        }
        await page.screenshot({ path: join(evidence, `lobby-${name}-day.png`), fullPage: true });
        await page.getByRole('button', { name: '切换日间或夜间' }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
        const nightArt = page.locator('img[src*="night.webp"]');
        await expect(nightArt).toBeVisible();
        await nightArt.evaluate((node) => Promise.all(node.getAnimations().map((a) => a.finished)));
        await page.screenshot({ path: join(evidence, `lobby-${name}-night.png`), fullPage: true });
        expect(faults).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await party.close();
  }
});

test('Batch 1B 真发牌后换桌、菜篮冷首投、连击、屏蔽和原生选目标', async ({ browser }) => {
  test.setTimeout(180000);
  const party = await isolatedParty();
  const contexts = [];
  const context = async (options) => {
    const result = await browser.newContext(options);
    contexts.push(result);
    return result;
  };
  let releaseFlower;
  const coldFlower = new Promise((resolve) => (releaseFlower = resolve));
  try {
    const consoleContext = await context({});
    await consoleContext.route('**/engine/runtime/mode.js', async (route) => {
      const response = await route.fetch();
      const code = await response.text();
      expect(code).toContain('await game.phaseLoop(first);');
      await route.fulfill({
        response,
        body: code.replace('await game.phaseLoop(first);', 'await game.pause();'),
      });
    });
    const computer = await consoleContext.newPage();
    const desktopContext = await context({ viewport: { width: 1280, height: 800 } });
    const mobileContext = await context({
      viewport: { width: 844, height: 390 },
      screen: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    await desktopContext.route('**/prop-flower.webp', async (route) => {
      await coldFlower;
      await route.continue();
    });
    const desktop = await desktopContext.newPage();
    const phone = await mobileContext.newPage();
    const faults = [watch(computer), watch(desktop), watch(phone)];
    const tableRequests = [new Set(), new Set()];
    const pages = [desktop, phone];
    for (const [i, page] of pages.entries())
      page.on('response', (response) => {
        if (/\/table-\w+\.webp$/.test(response.url())) {
          tableRequests[i].add(new URL(response.url()).pathname.split('/').at(-1));
          expect(response.status()).toBe(200);
        }
      });
    await computer.goto(`${party.base}/server`);
    const opened = await desktop.request.post(`${party.base}/api/rooms`, {
      data: { nickname: '青玉' },
    });
    expect(opened.ok()).toBe(true);
    const {
      room: { code },
    } = await opened.json();
    const settings = await desktop.request.put(`${party.base}/api/rooms/${code}`, {
      data: { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
    });
    expect(settings.ok()).toBe(true);
    const joinUrl = `${party.base}/join/${code}`;
    await Promise.all(pages.map((page) => page.goto(joinUrl)));
    await phone.locator('#nickname').fill('朱漆');
    await phone.locator('#join-button').tap();
    await Promise.all([
      desktop.locator('#ready-button').click(),
      phone.locator('#ready-button').tap(),
    ]);
    await desktop.locator('#start-button').click();
    await expect
      .poll(() => computer.frames().some((frame) => frame.url().includes('/engine/worker/')))
      .toBe(true);
    const worker = computer.frames().find((frame) => frame.url().includes('/engine/worker/'));
    const frames = await Promise.all(
      pages.map(async (page) => {
        await page.waitForFunction(
          () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
        );
        return page.frames().find((frame) => frame.url().includes('/engine/player/'));
      }),
    );
    await Promise.all(frames.map((frame, i) => chooseGeneral(frame, worker, { mouse: i === 0 })));
    await worker.waitForFunction(() => partyEngine.proof.started && partyEngine._status.paused);
    for (const frame of frames)
      await frame.waitForFunction(() => partyEngine.game.me?.countCards('h') >= 4);
    for (const requests of tableRequests) expect([...requests]).toEqual(['table-chibi.webp']);
    const [frame, receiver] = frames;
    await frame.locator('html').evaluate((node) => (node.dataset.batch1b = 'same-frame'));
    for (const skin of ['jade', 'palace', 'bamboo', 'chibi']) {
      const image =
        skin === 'chibi'
          ? undefined
          : desktop.waitForResponse((r) => r.url().endsWith(`table-${skin}.webp`));
      await desktop.locator('#match-table-skin').selectOption(skin);
      await expect(frame.locator('#window')).toHaveCSS(
        'background-image',
        new RegExp(`table-${skin}\\.webp`),
      );
      if (image) expect((await image).ok()).toBe(true);
      await desktop.screenshot({ path: join(evidence, `table-desktop-${skin}.png`) });
    }
    await expect(frame.locator('html')).toHaveAttribute('data-batch1b', 'same-frame');
    expect([...tableRequests[1]]).toEqual(['table-chibi.webp']);
    await phone.screenshot({ path: join(evidence, 'table-mobile-landscape.png') });

    const basket = frame.locator('.party-basket').first();
    await basket.click();
    const menu = frame.getByRole('group', { name: '菜篮子' });
    await expect(menu.getByRole('button')).toHaveCount(4);
    const flower = menu.getByRole('button', { name: '鲜花' });
    await flower.click();
    await expect(
      frame.locator('.party-emotion[data-emotion="flower"] .party-emotion-fallback'),
    ).toBeVisible();
    releaseFlower();
    await expect(
      frame.locator('.party-emotion[data-emotion="flower"][data-phase="impact"] img'),
    ).toBeVisible();
    await desktop.screenshot({ path: join(evidence, 'basket-flower-impact.png') });
    await expect(frame.locator('.party-emotion')).toHaveCount(0);
    await expect
      .poll(() => flower.locator('img').evaluate((image) => image.naturalWidth))
      .toBe(128);
    await desktop.screenshot({ path: join(evidence, 'basket-open.png') });
    await flower.click();
    await expect(receiver.locator('.party-emotion-combo')).toHaveText('×2');
    const bigScreenCombo = computer
      .locator('.observer-seat')
      .filter({ hasText: '朱漆' })
      .locator('.observer-gift-combo');
    await expect(bigScreenCombo).toHaveText('×2');
    await computer.screenshot({ path: join(evidence, 'basket-combo-big-screen.png') });
    await expect(menu).toBeVisible();
    const egg = menu.getByRole('button', { name: '鸡蛋' });
    // The first click may be intentionally throttled if it immediately follows a flower.
    await expect
      .poll(async () => {
        await egg.click();
        return receiver.locator('.party-emotion[data-prop="egg-splat"] img').count();
      })
      .toBeGreaterThan(0);
    await expect(frame.locator('.party-emotion[data-prop="egg-splat"] img').last()).toHaveAttribute(
      'src',
      /prop-egg-splat\.webp$/,
    );
    await desktop.screenshot({ path: join(evidence, 'basket-egg-combo.png') });
    await frame.locator('body').press('Escape');
    await expect(menu).toBeHidden();

    await phone.locator('#stage-more').tap();
    await phone.locator('#stage-tools #match-emotions').tap();
    await phone.getByRole('button', { name: '关闭比赛工具' }).tap();
    await expect(receiver.locator('html')).toHaveAttribute('data-table-emotions', 'off');
    await expect(receiver.locator('.party-basket').first()).toBeHidden();
    await expect(
      receiver.locator('.party-emotion, .party-emotion-combo, .party-emotion-notice'),
    ).toHaveCount(0);
    await receiver.evaluate(() => {
      const { game } = partyEngine;
      const play = game.playAudio;
      window.partyArtAudio = 0;
      game.playAudio = function (...args) {
        if (args[0] === 'effect' && args[1]?.startsWith('throw_')) window.partyArtAudio++;
        return play.apply(this, args);
      };
    });
    await basket.click();
    await expect
      .poll(async () => {
        await menu.getByRole('button', { name: '美酒' }).click();
        return frame.locator('.party-emotion[data-emotion="wine"]').count();
      })
      .toBeGreaterThan(0);
    await expect(
      receiver.locator('.party-emotion, .party-emotion-combo, .party-emotion-notice'),
    ).toHaveCount(0);
    expect(await receiver.evaluate(() => window.partyArtAudio)).toBe(0);
    await desktop.locator('#match-emotions').click();
    await expect(basket).toBeHidden();
    await desktop.locator('#match-emotions').click();
    await expect(basket).toBeVisible();
    await basket.click();
    await expect(menu).toBeVisible();

    const actorId = await frame.evaluate(() => partyEngine.game.me.playerid);
    const receiverId = await receiver.evaluate(() => partyEngine.game.me.playerid);
    await worker.evaluate((id) => {
      const { game, _status } = partyEngine;
      const actor = game.players.find((seat) => seat.playerid === id);
      game.resume();
      const proof = game.createEvent('partyArtChoice');
      proof.setContent(async () => {
        const result = await actor
          .chooseTarget('选择一名其他角色', true, (_card, player, target) => player !== target)
          .forResult();
        window.partyArtChoice = result.targets[0].playerid;
      });
      _status.eventManager.rootEvent = proof;
      void proof.start().catch((error) => {
        window.partyArtFailure = error.message;
      });
    }, actorId);
    const target = frame.locator('#arena .player.selectable').first();
    await expect(target).toBeVisible({ timeout: 10000 });
    await expect(basket).toBeHidden();
    await expect(menu).toBeHidden();
    await target.click();
    await frame
      .locator('.control:not(.removing)')
      .getByText('确定', { exact: true })
      .first()
      .click();
    await worker.waitForFunction(() => window.partyArtChoice || window.partyArtFailure);
    expect(await worker.evaluate(() => window.partyArtFailure)).toBeUndefined();
    expect(await worker.evaluate(() => window.partyArtChoice)).toBe(receiverId);
    expect(await worker.evaluate(() => partyEngine.proof.errors)).toEqual([]);
    expect(faults.flat()).toEqual([]);
  } finally {
    releaseFlower();
    try {
      await party.close();
    } finally {
      await Promise.all(contexts.map((item) => item.close()));
    }
  }
});
