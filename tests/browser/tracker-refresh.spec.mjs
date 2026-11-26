// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

test('公开记牌器只更新变化的分区，收起时保留最新快照', async ({ page }) => {
  const bundle = await build({
    entryPoints: ['apps/web/src/match-experience.ts'],
    bundle: true,
    globalName: 'experience',
    write: false,
  });
  await page.route('http://tracker.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main id="app"><div class="match-toolbar"><button id="match-share"></button></div><div id="game-frame-container" style="width:800px;height:360px"><iframe id="game-frame"></iframe></div></main>',
    }),
  );
  await page.goto('http://tracker.test/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const observed = await page.evaluate(() => {
    const view = experience.bindMatchExperience();
    const context = () => view.context('first', true, true, false);
    window.switchTrackerMatch = () => {
      view.context('second', true, true, false);
      dispatchEvent(
        new MessageEvent('message', {
          source: document.querySelector('#game-frame').contentWindow,
          origin: location.origin,
          data: { type: 'party-public-summary', matchId: 'second', summary },
        }),
      );
    };
    context();
    const get = (id) => document.querySelector(id);
    const cards = get('#tracker-categories');
    const recent = get('#tracker-recent');
    const actions = get('#match-actions ol');
    const toggle = get('#match-tracker-toggle');
    const close = get('#tracker-close');
    const tracker = {
      pileName: '标准',
      deckCount: 90,
      knownPublicCount: 1,
      unknownDiscards: 0,
      shuffledCount: 0,
      categories: [{ key: 'sha', label: '杀', seen: 1, templateTotal: 30 }],
      recentRevealed: [
        { seq: 1, cardName: '杀', suit: 'heart', number: 1, actor: '甲', action: 'use' },
      ],
    };
    const summary = { cardTracker: tracker, actions: [{ sequence: 1, text: '甲出杀' }] };
    const send = () =>
      dispatchEvent(
        new MessageEvent('message', {
          source: get('#game-frame').contentWindow,
          origin: location.origin,
          data: {
            type: 'party-public-summary',
            matchId: 'first',
            summary: structuredClone(summary),
          },
        }),
      );
    send();
    const lazy = !cards.childElementCount && !recent.childElementCount;
    toggle.click();
    const row = cards.firstChild,
      chip = recent.firstChild,
      action = actions.firstChild;
    close.focus();
    tracker.deckCount--;
    send();
    context();
    const stable =
      row === cards.firstChild &&
      chip === recent.firstChild &&
      action === actions.firstChild &&
      document.activeElement === close &&
      get('#tracker-meta').textContent.includes('89');
    tracker.categories[0].seen++;
    send();
    const categoryChanged =
      cards.textContent.includes('2 / 30') &&
      chip === recent.firstChild &&
      action === actions.firstChild;
    const latestRow = cards.firstChild;
    close.click();
    tracker.recentRevealed.push({ ...tracker.recentRevealed[0], seq: 2, cardName: '闪' });
    summary.actions.push({ sequence: 2, text: '乙出闪' });
    send();
    const deferred =
      chip === recent.firstChild && get('#match-last-action').textContent === '乙出闪';
    toggle.click();
    const reopened =
      recent.firstChild.textContent.includes('闪') &&
      cards.firstChild === latestRow &&
      Boolean(get('#match-card-tracker').style.maxHeight);
    return { lazy, stable, categoryChanged, deferred, reopened };
  });
  expect(observed).toEqual({
    lazy: true,
    stable: true,
    categoryChanged: true,
    deferred: true,
    reopened: true,
  });
  const drawer = page.locator('#match-card-tracker');
  const toggle = page.locator('#match-tracker-toggle');
  await page.addStyleTag({
    content: `
    #game-frame-container {position:relative}
    #game-frame {width:100%; height:100%; border:0}
    #match-card-tracker {position:absolute;left:50%;transform:translateX(-50%);width:260px}
    .tracker-scroll-body {height:80px;overflow:auto}
    .tracker-privacy-note {height:400px}
  `,
  });
  const frame = page.frameLocator('#game-frame');
  await frame.locator('body').evaluate((body) => {
    const tray = document.createElement('section');
    tray.id = 'party-farmer-hand';
    tray.style.cssText = 'position:absolute;left:300px;top:0;width:170px;height:95px';
    body.append(tray);
  });
  await expect(drawer).toHaveCSS('top', '100px');
  const hand = frame.locator('#party-farmer-hand');
  await hand.evaluate((node) => {
    node.style.top = '20px';
    node.style.height = '105px';
  });
  await expect(drawer).toHaveCSS('top', '130px');
  const close = page.locator('#tracker-close');
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(drawer).toHaveCSS('top', '130px');
  await hand.evaluate((node) => {
    node.hidden = true;
  });
  await expect(drawer).toHaveCSS('top', '8px');
  const scroll = drawer.locator('.tracker-scroll-body');
  await scroll.evaluate((node) => {
    node.scrollTop = 180;
  });
  expect(await scroll.evaluate((node) => node.scrollTop)).toBe(180);
  await page.evaluate(() => window.switchTrackerMatch());
  await toggle.click();
  expect(await scroll.evaluate((node) => node.scrollTop)).toBe(0);
  await hand.evaluate((node) => {
    node.hidden = false;
    node.style.cssText = 'position:absolute;inset:0';
    const control = document.createElement('div');
    control.id = 'control';
    control.innerHTML =
      '<button class="control" style="position:absolute;inset:0 0 auto;height:105px">确认</button>';
    node.ownerDocument.body.append(control);
  });
  await expect(drawer).toHaveCSS('max-height', '96px');
  expect(parseFloat(await drawer.evaluate((node) => node.style.top))).toBeGreaterThanOrEqual(105);
  await close.click();
  await expect(drawer).toBeHidden();
});
