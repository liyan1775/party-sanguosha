// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from '@playwright/test';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.ts';
import { NativeNonameService } from '../../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from '../../scripts/native-ui-actions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = join(root, '.runtime/playtest-fixes-evidence-20261125');
const small = { width: 844, height: 390 };
const wide = { width: 1280, height: 800 };
const photo = (page, name) => page.screenshot({ path: join(evidence, `${name}.png`) });

async function preview(native, use) {
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(join(evidence, 'party-'));
  const party = createPartyServer({
    port: 0,
    webRoot: join(root, 'dist/web'),
    ...(native ? { adapter: new NativeNonameService(root) } : {}),
    rosterDirectory: join(scratch, 'rosters'),
    shanhetuDirectory: join(scratch, 'book'),
  });
  await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  try {
    await use(`http://127.0.0.1:${party.server.address().port}`);
  } finally {
    const closed = once(party.server, 'close');
    party.stop();
    party.server.closeAllConnections();
    await closed;
    await rm(scratch, { recursive: true, force: true });
  }
}

async function room(page, base, mode, playerCount) {
  const result = await page.request.post(base + '/api/rooms', {
    data: { nickname: '江上青玉' },
  });
  expect(result.status()).toBe(201);
  const { room } = await result.json();
  const url = `${base}/api/rooms/${room.code}`;
  expect(
    (
      await page.request.put(url, {
        data: { mode, playerCount, generalPreset: 'beginner', extensions: [] },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`${base}/join/${room.code}`);
  return url;
}

async function contrast(locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate((node) => {
    const rgba = (css) => css.match(/[\d.]+/g).map(Number);
    const blend = (top, bottom) =>
      bottom.map((c, i) => (top[3] ?? 1) * top[i] + (1 - (top[3] ?? 1)) * c);
    const layers = [];
    for (let el = node; el; el = el.parentElement)
      layers.unshift(rgba(getComputedStyle(el).backgroundColor));
    const bg = layers.reduce((base, top) => blend(top, base), [255, 255, 255]);
    const fg = blend(rgba(getComputedStyle(node).color), bg);
    const luma = (rgb) =>
      rgb
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const [low, high] = [luma(fg), luma(bg)].sort((a, b) => a - b);
    return (high + 0.05) / (low + 0.05);
  });
}

test('日夜图鉴、将池与房主设置可读，无邀请时不显示空控件，横屏等待房能准备开局', async ({
  browser,
}) => {
  await preview(true, async (base) => {
    const page = await browser.newPage({ viewport: wide });
    try {
      await page.goto(base);
      await expect(page.locator('.empty-rooms h3')).toBeVisible();
      await page.locator('#theme-toggle').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
      expect(await contrast(page.locator('.empty-rooms h3'))).toBeGreaterThanOrEqual(4.5);
      await photo(page, 'night-empty-lobby');
      const url = await room(page, base, 'versus', 4);
      await page.locator('#general-guide').click();
      await page.locator('#guide-search').fill('龙胆');
      const dragon = page.locator('.guide-entry').filter({ hasText: '赵云' }).first();
      await dragon.locator('summary').click();
      const detail = dragon.locator('dd').first();
      expect(await contrast(detail)).toBeGreaterThanOrEqual(4.5);
      expect(await contrast(dragon.locator('dt').first())).toBeGreaterThanOrEqual(4.5);
      await dragon.locator('img').evaluate((image) => image.decode());
      await photo(page, 'night-guide-dragon');
      await page.locator('#guide-close').click();
      const settings = page.locator('#settings-panel');
      if (!(await settings.evaluate((n) => n.open))) await settings.locator('summary').click();
      const setting = settings.locator('label[for="player-count"]');
      expect(await contrast(setting)).toBeGreaterThanOrEqual(4.5);
      await photo(page, 'night-room-settings');
      await page.locator('#custom-rosters-open').click();
      await page.locator('#custom-rosters-new').click();
      await page.locator('#custom-rosters-query').fill('赵云');
      const general = page.locator('.custom-roster-general').filter({ hasText: '赵云' }).first();
      await general.locator('summary').click();
      expect(await contrast(general.locator('dd').first())).toBeGreaterThanOrEqual(4.5);
      await general.locator('img').evaluate((image) => image.decode());
      await photo(page, 'night-roster-zhaoyun');
      await general
        .locator('dd')
        .first()
        .evaluate((node) => node.scrollIntoView({ block: 'center' }));
      await photo(page, 'night-roster-skill-detail');
      await page.locator('#custom-rosters-dialog').evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.setViewportSize({ width: 390, height: 844 });
      const heading = page.locator('#custom-rosters-title');
      const close = page.locator('#custom-rosters-close');
      const [h, c] = await Promise.all([heading.boundingBox(), close.boundingBox()]);
      expect(c.x).toBeGreaterThan(h.x);
      expect(c.y).toBeLessThan(h.y + h.height);
      await photo(page, 'portrait-roster-close');
      await close.click();
      await page.locator('#theme-toggle').click();
      await page.locator('#general-guide').click();
      const dayDragon = page.locator('.guide-entry').filter({ hasText: '赵云' }).first();
      if (!(await dayDragon.evaluate((n) => n.open))) await dayDragon.locator('summary').click();
      expect(await contrast(dayDragon.locator('dd').first())).toBeGreaterThanOrEqual(4.5);
      await page.locator('#guide-close').click();
      await page.setViewportSize(small);
      if (await settings.evaluate((n) => n.open)) await settings.locator('summary').click();
      await page.locator('#fill-bots').click();
      await expect(page.locator('.remove-player')).toHaveCount(3);
      await expect(page.getByRole('link', { name: '返回大厅', exact: true })).toHaveCount(1);
      for (const button of await page.locator('.remove-player').all()) {
        expect(
          await button.evaluate((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getClientRects().length;
          }),
        ).toBe(1);
      }
      await expect(page.locator('#ready-button')).toBeInViewport();
      await expect(page.locator('#start-button')).toBeInViewport();
      await photo(page, 'landscape-waiting-room');
      await page.route(url, async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: { ...(await res.json()), joinUrls: [] } });
      });
      await page.reload();
      await page.locator('#share-button').click();
      await expect(page.locator('#qr-placeholder')).toBeVisible();
      for (const selector of ['#qr-caption', '#network-address', '#join-url', '#copy-link'])
        await expect(page.locator(selector)).toBeHidden();
      await photo(page, 'invite-unavailable');
    } finally {
      await page.close();
    }
  });
});

async function seatGeometry(frame, count) {
  const seats = frame.locator('.party-seat-number:visible');
  await expect(seats).toHaveCount(count);
  expect((await seats.allTextContents()).sort()).toEqual(
    Array.from({ length: count }, (_, i) => `${i + 1}号位`),
  );
  return frame.evaluate(() => {
    const visible = (node) =>
      node.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const boxes = (selector) =>
      [...document.querySelectorAll(selector)]
        .filter(visible)
        .map((n) => n.getBoundingClientRect().toJSON());
    const labels = boxes('.party-seat-number');
    const faces = boxes(
      '#arena > .player, #arena .player > :is(.avatar,.identity,.hp,.count,.name,.nameol,.equips,.party-basket)',
    );
    const overlaps = (a, b) =>
      Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
      Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    return labels.map((box, i) => ({
      ...box,
      clear:
        box.left >= 0 &&
        box.right <= innerWidth &&
        box.top >= 0 &&
        box.bottom <= innerHeight &&
        !faces.some((face) => overlaps(face, box)) &&
        !labels.some((other, j) => j !== i && overlaps(other, box)),
    }));
  });
}

test('真实八席：确认与七张手牌有净距，选将后座号完整，记牌器展开仍能命中右侧吕蒙', async ({
  browser,
}) => {
  test.setTimeout(150000);
  await preview(true, async (base) => {
    const host = await browser.newContext();
    const mobile = await browser.newContext({ viewport: small, hasTouch: true, isMobile: true });
    try {
      await host.route('**/engine/runtime/mode.js', async (route) => {
        const response = await route.fetch();
        const code = await response.text();
        expect(code).toContain('await game.phaseLoop(first);');
        await route.fulfill({
          response,
          body: code.replace('await game.phaseLoop(first);', 'await game.pause();'),
        });
      });
      const pc = await host.newPage();
      await pc.goto(base + '/server');
      const page = await mobile.newPage();
      await room(page, base, 'identity', 8);
      await page.locator('#fill-bots').tap();
      await page.locator('#ready-button').tap();
      await page.locator('#start-button').tap();
      await page.waitForFunction(
        () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
      );
      await expect
        .poll(() => pc.frames().some((f) => f.url().includes('/engine/worker/')))
        .toBe(true);
      const worker = pc.frames().find((f) => f.url().includes('/engine/worker/'));
      const frame = page.frames().find((f) => f.url().includes('/engine/player/'));
      await chooseGeneral(frame, worker);
      await worker.waitForFunction(() => partyEngine.proof.started && partyEngine._status.paused);
      await expect(page.locator('#match-tracker-toggle')).toBeVisible();
      const phoneSeats = await seatGeometry(frame, 8);
      expect(phoneSeats.every((b) => b.clear)).toBe(true);
      await photo(page, 'identity-eight-seats-844x390');
      await page.setViewportSize(wide);
      const desktopSeats = await seatGeometry(frame, 8);
      expect(desktopSeats.every((b) => b.clear)).toBe(true);
      await photo(page, 'identity-eight-seats-desktop');
      await page.setViewportSize(small);
      for (const selector of [
        '#match-label',
        '#match-table-skin',
        '#match-tracker-toggle',
        '#match-share',
        '#stage-more',
      ])
        await expect(page.locator('.match-toolbar').locator(selector)).toBeInViewport({
          ratio: 0.99,
        });
      await expect(page.locator('.match-toolbar')).toHaveCSS('background-color', 'rgb(16, 46, 39)');
      await expect(page.locator('#match-experience')).toHaveCSS(
        'background-color',
        'rgb(20, 45, 40)',
      );
      await page.locator('#stage-more').tap();
      for (const selector of ['#match-auto', '#match-restore', '#match-volume'])
        await expect(page.locator('#stage-tools').locator(selector)).toBeVisible();
      await photo(page, 'landscape-more-tools');
      await page.getByRole('button', { name: '关闭比赛工具' }).tap();
      const rightmost = await frame.evaluate(() => {
        const { game } = partyEngine;
        return game.players
          .filter((p) => p !== game.me)
          .sort(
            (a, b) =>
              b.getBoundingClientRect().right - a.getBoundingClientRect().right ||
              b.getBoundingClientRect().top - a.getBoundingClientRect().top,
          )[0].playerid;
      });
      const actor = await frame.evaluate(() => {
        const { game } = partyEngine;
        const send = game.send;
        window.partySubmissions = 0;
        game.send = function (...args) {
          if (args[0] === 'result') window.partySubmissions++;
          return send.apply(this, args);
        };
        return game.me.playerid;
      });
      await worker.evaluate(
        async ({ actor, rightmost }) => {
          const { game, lib, _status } = partyEngine;
          const player = lib.playerOL[actor];
          // Test fixture only: use native replication and the real chooseToUse
          // event after ordinary draft and deal. No injected DOM or fake targets.
          const { broadcastCharacterInit } = await import('/engine/runtime/privacy.js');
          if (lib.playerOL[rightmost].name !== 'lvmeng')
            broadcastCharacterInit(lib.playerOL[rightmost], 'lvmeng');
          const trick = game.createCard('lebu', 'club', 1);
          const next = game.createCard('guohe', 'spade', 2);
          const material = game.createCard('wanjian', 'heart', 1);
          player.directgain([trick, next, material]);
          player.addSkill('wusheng');
          game.broadcast(function (player) {
            player.addSkill('wusheng');
          }, player);
          window.partyChoiceFixture = [trick, next, material].map((c) => c.cardid);
          game.resume();
          const event = game.createEvent('partyFixSevenCards');
          event.player = player;
          event.setContent(async () => {
            const result = await player.chooseToUse().set('type', 'phase').forResult();
            window.partyChoiceOutcome = {
              used: result.bool,
              card: result.card?.name,
              targets: result.targets?.map((p) => p.playerid),
            };
            await player.chooseToUse().set('type', 'phase').forResult();
          });
          _status.eventManager.rootEvent = event;
          void event.start().catch((error) => {
            window.partyChoiceOutcome = { error: error.message };
          });
        },
        { actor, rightmost },
      );
      const ids = await worker.evaluate(() => window.partyChoiceFixture);
      await frame.waitForFunction(
        (id) => partyEngine.lib.cardOL[id]?.matches('.selectable'),
        ids[0],
      );
      await frame.evaluate(
        ({ ids, rightmost }) => {
          ids.forEach((id, i) => {
            partyEngine.lib.cardOL[id].dataset.polishCard = i;
          });
          partyEngine.lib.playerOL[rightmost].dataset.polishTarget = 'true';
        },
        { ids, rightmost },
      );
      const hand = frame.locator('#me .handcards .card:visible');
      await expect(hand).toHaveCount(7);
      const card = (i) => frame.locator(`[data-polish-card="${i}"]`);
      const target = frame.locator('[data-polish-target]');
      await expect(target.locator(':scope > .name:not(.name2)')).toContainText(/吕\s*蒙/);
      const tracker = page.locator('#match-card-tracker');
      const toggle = page.locator('#match-tracker-toggle');
      await toggle.tap();
      await expect(tracker).toBeVisible();
      await card(0).tap({ position: { x: 6, y: 15 } });
      await expect(tracker).toBeHidden();
      await toggle.tap();
      await expect(tracker).toBeVisible();
      const [drawer, seat] = await Promise.all([tracker.boundingBox(), target.boundingBox()]);
      expect(drawer.x + drawer.width).toBeLessThan(seat.x);
      const point = { x: seat.x + seat.width / 2, y: seat.y + seat.height / 2 };
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point)).toBe(
        'game-frame',
      );
      await photo(page, 'tracker-open-right-seat-844x390');
      await page.touchscreen.tap(point.x, point.y);
      await expect(target).toHaveClass(/\bselected\b/);
      await expect(tracker).toBeHidden();
      const confirm = frame
        .locator('#control .control:not(.removing) > div')
        .filter({ hasText: /^确定$/ })
        .last();
      await expect(confirm).toBeVisible();
      const clear = () =>
        frame.evaluate(() => {
          const { ui } = partyEngine;
          const rect = (n) => n.getBoundingClientRect();
          const hands = [...document.querySelectorAll('#me .handcards .card')].filter((c) =>
            c.checkVisibility(),
          );
          const area = (a, b) =>
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          return hands.map((c) => ({
            selected: c.classList.contains('selected'),
            intersection: Math.max(
              ...[ui.control, ui.confirm, ...ui.confirm.children].map((n) =>
                area(rect(n), rect(c)),
              ),
            ),
            gap:
              rect(c).top -
              Math.max(
                ...[ui.control, ui.confirm, ...ui.confirm.children].map((n) => rect(n).bottom),
              ),
          }));
        });
      await expect
        .poll(async () => (await clear()).every((c) => c.intersection === 0 && c.gap >= 10))
        .toBe(true);
      const clearance = await clear();
      expect(clearance.filter((c) => c.selected)).toHaveLength(1);
      await photo(page, 'confirm-seven-cards-844x390');
      const neighbor = await card(1).boundingBox();
      const edge = await card(1).evaluate((node) => {
        const b = node.getBoundingClientRect();
        for (const y of [3, 6, 9]) {
          for (let x = 4; x < b.width - 4; x += 2) {
            if (node.contains(document.elementFromPoint(b.left + x, b.top + y))) return { x, y };
          }
        }
        return null;
      });
      expect(edge).not.toBeNull();
      await page.touchscreen.tap(neighbor.x + edge.x, neighbor.y + edge.y);
      expect(await frame.evaluate(() => window.partySubmissions)).toBe(0);
      expect(await worker.evaluate(() => window.partyChoiceOutcome ?? null)).toBeNull();
      await photo(page, 'neighbor-edge-no-submit');
      if (await card(1).evaluate((n) => n.classList.contains('selected')))
        await card(1).tap({ position: { x: 6, y: 15 } });
      if (!(await card(0).evaluate((n) => n.classList.contains('selected'))))
        await card(0).tap({ position: { x: 6, y: 15 } });
      if (!(await target.evaluate((n) => n.classList.contains('selected')))) await target.tap();
      await expect(confirm).toBeVisible();
      await page.setViewportSize(wide);
      await expect
        .poll(async () => (await clear()).every((c) => c.intersection === 0 && c.gap >= 10))
        .toBe(true);
      const desktopClearance = await clear();
      await photo(page, 'confirm-seven-cards-desktop');
      await page.setViewportSize(small);
      await confirm.tap();
      await worker.waitForFunction(() => window.partyChoiceOutcome);
      const outcome = await worker.evaluate(() => window.partyChoiceOutcome);
      expect(outcome).toEqual({ used: true, card: 'lebu', targets: [rightmost] });
      const skill = frame
        .locator('#control .control:not(.removing) > div')
        .filter({ hasText: /^武圣$/ });
      await skill.tap({ timeout: 10000 });
      await card(2).tap({ position: { x: 6, y: 15 }, timeout: 10000 });
      await frame.locator('#arena > .player.selectable').first().tap({ timeout: 10000 });
      await expect(frame.locator('#party-selected-preview')).toContainText(
        '武圣 · 杀（♥A 万箭齐发） → ',
      );
      await expect(frame.locator('#party-selected-preview')).toBeVisible();
      await photo(page, 'wusheng-conversion-844x390');
      await writeFile(
        join(evidence, 'edge-eight-seats.json'),
        JSON.stringify(
          {
            phoneSeats,
            desktopSeats,
            clearance,
            desktopClearance,
            rightSeat: '吕蒙',
            targetPoint: point,
            submittedOnlyAfterConfirm: true,
          },
          null,
          2,
        ),
      );
    } finally {
      await Promise.all([host.close(), mobile.close()]);
    }
  });
});

test('真实单挑自然结算：两位玩家和电脑大屏同步清除托管与当前回合', async ({ browser }) => {
  test.setTimeout(150000);
  await preview(true, async (base) => {
    const pc = await browser.newPage({ viewport: wide });
    const player = await browser.newPage({ viewport: wide, hasTouch: true });
    const guest = await browser.newPage({ viewport: small, hasTouch: true, isMobile: true });
    try {
      await pc.goto(base + '/server');
      const url = await room(player, base, 'duel', 2);
      await guest.goto(player.url());
      await guest.locator('#nickname').fill('临江客');
      await guest.locator('#join-button').tap();
      await Promise.all([player, guest].map((page) => page.locator('#ready-button').tap()));
      await player.locator('#start-button').tap();
      await expect
        .poll(() => pc.frames().some((f) => f.url().includes('/engine/worker/')))
        .toBe(true);
      const worker = pc.frames().find((f) => f.url().includes('/engine/worker/'));
      const frames = await Promise.all(
        [player, guest].map(async (page) => {
          await page.waitForFunction(
            () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
          );
          return page.frames().find((f) => f.url().includes('/engine/player/'));
        }),
      );
      await Promise.all(frames.map((frame) => chooseGeneral(frame, worker)));
      await expect(player.locator('#match-auto')).toBeEnabled();
      await expect(frames[0].locator('.party-seat-number:visible')).toHaveCount(2);
      await expect(pc.locator('.observer-board .observer-seat.is-active')).toHaveCount(1);
      await worker.evaluate(() => {
        partyEngine.lib.config.game_speed = 'vvfast';
        partyEngine.lib.config.duration = 100;
        partyEngine.game.broadcast(function () {
          partyEngine.lib.config.game_speed = 'vvfast';
          partyEngine.lib.config.duration = 100;
        });
      });
      await player.locator('#match-auto').tap();
      await expect(player.locator('#match-control-state')).toHaveText('原生 AI 正在替你操作');
      await guest.locator('#stage-more').tap();
      await guest.locator('#stage-tools #match-auto').tap();
      await guest.getByRole('button', { name: '关闭比赛工具' }).tap();
      await expect(guest.locator('#match-control-state')).toHaveText('原生 AI 正在替你操作');
      for (const [i, page] of [player, guest].entries()) {
        await expect(page.locator('#match-label')).toHaveText('本局已结束', { timeout: 105000 });
        await expect(page.locator('#match-auto')).toBeHidden();
        await expect(page.locator('#match-control-state')).toBeHidden();
        await expect(frames[i].locator('.party-turn-badge:visible')).toHaveCount(0);
        await expect(frames[i].locator('#party-return-room')).toBeVisible();
        await photo(page, `duel-natural-settlement-${i === 0 ? 'desktop' : '844x390'}`);
      }
      await expect(pc.locator('.observer-round')).toContainText('本局已结束');
      await expect(pc.locator('.observer-board .observer-seat.is-active')).toHaveCount(0);
      await expect(pc.locator('.observer-board')).not.toContainText(/当前回合|玩家开启托管/);
      await photo(pc, 'duel-computer-observer-settlement');
      const state = await (await player.request.get(url)).json();
      expect(state.room.phase).toBe('finished');
      await player.locator('#rematch-button').tap();
      await expect(player.locator('#ready-button')).toBeVisible();
    } finally {
      await Promise.all([pc.context().close(), player.context().close(), guest.context().close()]);
    }
  });
});
