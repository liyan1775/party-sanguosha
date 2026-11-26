// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from '@playwright/test';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.ts';
import { NativeNonameService } from '../../packages/noname-adapter/src/service.ts';
import { chooseGeneral, completeDoudizhuPregame } from '../../scripts/native-ui-actions.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = join(root, '.runtime/gameplay-fix-evidence-20261125');
const flightEvidence = join(root, '.runtime/sgs-flight-evidence-20261125');
const polish = join(root, '.runtime/playtest-fixes-evidence-20261125');
const photo = (page, name) => page.screenshot({ path: join(evidence, `${name}.png`) });
const confirmed = (frame) =>
  frame.locator('.control:not(.removing)').getByText('确定', { exact: true }).last();

async function followGift(page, frame, name, button, compact = false) {
  const prop = frame.locator(`.party-emotion[data-emotion="${name}"]`);
  await page.bringToFront();
  // Sample a real rendered frame after the network broadcast. Only then freeze
  // what was observed for an exact, reproducible screenshot.
  await frame.evaluate(
    ({ name, compact }) => {
      window.partyFlight = new Promise((resolve) => {
        const timeout = performance.now() + 6000;
        const samples = [];
        const changes = [];
        const long = [];
        const perf = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) long.push([e.startTime, e.duration]);
        });
        perf.observe({ entryTypes: ['longtask'] });
        const clocks = [];
        let framesSeen = 0;
        const gift = '.party-emotion[data-emotion=' + name + ']';
        const selector = gift + '[data-phase="flight"]';
        const changesObserver = new MutationObserver((entries) => {
          for (const entry of entries) {
            if (entry.target.matches?.(gift))
              changes.push(['phase', performance.now(), entry.target.dataset.phase]);
            for (const n of entry.removedNodes)
              if (n.matches?.(gift)) changes.push(['removed', performance.now()]);
            for (const n of entry.addedNodes) {
              if (!n.matches?.(selector)) continue;
              const a = n.getAnimations()[0];
              changes.push([
                'added',
                performance.now(),
                a?.currentTime,
                a?.effect?.getTiming().duration,
              ]);
              void a?.finished.then(
                () => changes.push(['finished', performance.now(), a.currentTime]),
                () => changes.push(['cancelled', performance.now(), a.currentTime]),
              );
            }
          }
        });
        changesObserver.observe(document.querySelector('#window'), {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-phase'],
        });
        function sample() {
          framesSeen++;
          const node = document.querySelector(selector);
          const animation = node?.getAnimations()[0];
          const time = Number(animation?.currentTime);
          if (node && clocks.length < 85)
            clocks.push([performance.now(), animation?.currentTime ?? null]);
          if (animation && Number.isFinite(time)) samples.push(time);
          if (!animation || time < (compact ? 95 : 165)) {
            if (performance.now() >= timeout) {
              changesObserver.disconnect();
              perf.disconnect();
              return resolve({
                failure: { framesSeen, changes, samples, clocks, long, hidden: document.hidden },
              });
            }
            requestAnimationFrame(sample);
            return;
          }
          const center = (node) => {
            const r = node.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          };
          const { game, ui, lib } = partyEngine;
          const seat = (id) => {
            const player = lib.playerOL[id] ?? game.players.find((p) => p.playerid === id);
            const avatar = player.node.avatar;
            return avatar?.offsetWidth && avatar.offsetHeight && avatar.checkVisibility()
              ? avatar
              : player;
          };
          const notice = document.querySelector('.party-emotion-notice');
          const from = center(seat(notice.dataset.from));
          const target = center(seat(notice.dataset.to));
          const actual = center(node);
          const board = ui.window.getBoundingClientRect();
          const scaleX = board.width / ui.window.offsetWidth;
          const scaleY = board.height / ui.window.offsetHeight;
          const keyframes = animation.effect.getKeyframes();
          const end = new DOMMatrix(keyframes.at(-1).transform);
          const apex = new DOMMatrix(keyframes[4].transform);
          const landing = { x: from.x + end.e * scaleX, y: from.y + end.f * scaleY };
          const lift = (end.f / 2 - apex.f) * scaleY;
          const activeTrails = [
            ...document.querySelectorAll('[data-effect="trail-petal"], [data-effect="wind"]'),
          ].filter((p) => Number(getComputedStyle(p).opacity) > 0);
          for (const particle of activeTrails) particle.getAnimations()[0].pause();
          animation.pause();
          changesObserver.disconnect();
          perf.disconnect();
          resolve({
            time,
            frameIntervalsMs: samples.slice(1).map((t, i) => t - samples[i]),
            from,
            target,
            actual,
            landing,
            lift,
            scaleX,
            scaleY,
            keyframes: keyframes.length,
            transition: getComputedStyle(node).transitionProperty,
            pointer: getComputedStyle(node).pointerEvents,
            duration: animation.effect.getTiming().duration,
            trails: activeTrails.length,
            reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          });
        }
        requestAnimationFrame(sample);
      });
    },
    { name, compact },
  );
  // The receiver stays foreground while the sender uses the actual basket handler.
  await button.evaluate((node) => node.click());
  const mid = await frame.evaluate(() => window.partyFlight);
  expect(mid?.failure, name + ': no live flight frame').toBeUndefined();
  expect(mid).not.toBeNull();
  expect(mid.reduced).toBe(true);
  const duration = { flower: 480, egg: 440, wine: 460, shoe: 330 }[name];
  expect(mid.duration).toBe(compact ? Math.round(duration * 0.69) : duration);
  expect(mid.time).toBeGreaterThanOrEqual(compact ? 95 : 165);
  expect(mid.time).toBeLessThanOrEqual(compact ? 185 : 240);
  expect(mid.keyframes).toBe(9);
  expect(mid.transition).toBe('none');
  expect(mid.pointer).toBe('none');
  expect(mid.lift).toBeGreaterThan(8);
  expect(Math.abs(mid.landing.x - mid.target.x)).toBeLessThanOrEqual(12 * mid.scaleX + 1);
  expect(Math.abs(mid.landing.y - mid.target.y)).toBeLessThanOrEqual(12 * mid.scaleY + 1);
  const t = mid.time / mid.duration;
  const x = mid.from.x + (mid.landing.x - mid.from.x) * t;
  const straightY = mid.from.y + (mid.landing.y - mid.from.y) * t;
  expect(straightY - mid.actual.y).toBeGreaterThan(6);
  expect(Math.abs(mid.actual.x - x)).toBeLessThan(3);
  expect(Math.abs(mid.actual.y - (straightY - 4 * mid.lift * t * (1 - t)))).toBeLessThan(4);
  for (const point of [mid.from, mid.landing])
    expect(Math.hypot(mid.actual.x - point.x, mid.actual.y - point.y)).toBeGreaterThan(25);
  if (!compact && ['flower', 'shoe'].includes(name)) expect(mid.trails).toBeGreaterThanOrEqual(2);
  if (compact) expect(mid.trails).toBe(0);
  await expect(prop.locator('img')).toBeVisible();
  await page.screenshot({
    path: join(
      flightEvidence,
      `${compact ? 'app-compact' : 'os-reduced-motion'}-${name}-flight.png`,
    ),
  });

  const hit = await prop.evaluate(
    (node) =>
      new Promise((resolve) => {
        node.getAnimations()[0].play();
        document
          .querySelectorAll('.party-emotion-particle')
          .forEach((p) => p.getAnimations()[0]?.play());
        function sample() {
          if (!node.isConnected) return resolve(null);
          if (node.dataset.phase === 'flight') return requestAnimationFrame(sample);
          const animation = node.getAnimations()[0];
          const frames = animation.effect.getKeyframes();
          const seen = [...document.querySelectorAll('.party-emotion-particle')].map(
            (p) => p.dataset.effect,
          );
          const notice = document.querySelector('.party-emotion-notice');
          const target = partyEngine.lib.playerOL[notice.dataset.to];
          const shake = target?.node.avatar
            .getAnimations()
            .find((a) => a.effect.getKeyframes().some((frame) => frame.translate));
          animation.pause();
          let drip;
          if (node.dataset.prop === 'egg-splat' && animation.effect.getTiming().duration === 900) {
            const centerY = () => {
              const box = node.getBoundingClientRect();
              return box.top + box.height / 2;
            };
            animation.currentTime = 0;
            const start = centerY();
            animation.currentTime = 800;
            drip = {
              delta: centerY() - start,
              opacity: Number(getComputedStyle(node).opacity),
            };
          }
          animation.currentTime = Math.min(175, Number(animation.effect.getTiming().duration) / 2);
          document.querySelectorAll('.party-emotion-particle').forEach((p) => {
            const effect = p.getAnimations()[0];
            if (!effect) return;
            effect.pause();
            effect.currentTime = 165;
          });
          resolve({
            prop: node.dataset.prop,
            duration: animation.effect.getTiming().duration,
            transforms: frames.map((f) => f.transform),
            finalOpacity: frames.at(-1).opacity,
            drip,
            seen,
            shake: shake?.effect.getKeyframes().map((f) => f.translate) ?? [],
          });
        }
        requestAnimationFrame(sample);
      }),
  );
  expect(hit).not.toBeNull();
  expect(hit.prop).toBe(name === 'egg' ? 'egg-splat' : name);
  expect(hit.finalOpacity).toBe('0');
  if (compact) {
    expect(hit.seen).toHaveLength(0);
    expect(hit.duration).toBe(260);
  } else {
    const effects = {
      egg: { shell: 3, foam: 3 },
      flower: { halo: 1, petal: 8 },
      shoe: { star: 4, dust: 3 },
      wine: { halo: 1, drop: 9 },
    }[name];
    for (const [kind, count] of Object.entries(effects))
      expect(hit.seen.filter((effect) => effect === kind)).toHaveLength(count);
    if (name === 'egg') {
      expect(hit.duration).toBe(900);
      expect(hit.transforms.at(-1)).toContain('translateY(28px)');
      expect(hit.drip.delta).toBeGreaterThan(12 * mid.scaleY);
      expect(hit.drip.opacity).toBeLessThan(0.5);
    }
    if (name === 'wine') expect(hit.transforms[1]).toContain('rotate(55deg)');
    if (name === 'egg' || name === 'shoe') {
      const offset = name === 'egg' ? 4 : 7;
      expect(hit.shake.map(parseFloat)).toEqual([0, -offset, offset, -offset * 0.45, 0]);
    }
  }
  if (!compact)
    await page.screenshot({ path: join(flightEvidence, `os-reduced-motion-${name}-impact.png`) });
  await prop.evaluateAll((nodes) => {
    for (const node of nodes) node.getAnimations()[0]?.play();
  });
  await expect(prop).toHaveCount(0);
  return { mid, hit };
}

async function eggVolley(page, frame, button, sender) {
  await frame.evaluate(() => {
    window.partyVolley = new Promise((resolve) => {
      const timeout = performance.now() + 6000;
      function sample() {
        const eggs = [
          ...document.querySelectorAll('.party-emotion[data-emotion="egg"][data-phase="flight"]'),
        ];
        if (eggs.length < 5) {
          if (performance.now() > timeout) return resolve(null);
          requestAnimationFrame(sample);
          return;
        }
        resolve(
          eggs.map((egg) => {
            const a = egg.getAnimations()[0];
            const time = Number(a.currentTime);
            a.pause();
            return {
              time,
              endpoint: a.effect.getKeyframes().at(-1).transform,
              apex: a.effect.getKeyframes()[4].transform,
            };
          }),
        );
      }
      requestAnimationFrame(sample);
    });
  });
  await button.evaluate(async (node) => {
    // Real basket click handlers and real network broadcasts, with steady
    // timing so Playwright's per-click actionability does not pace the volley.
    for (let i = 0; i < 5; i++) {
      if (i) await new Promise((resolve) => setTimeout(resolve, 98));
      node.click();
    }
  });
  const volley = await frame.evaluate(() => window.partyVolley);
  expect(volley).toHaveLength(5);
  expect(volley.every(({ time }) => time >= 0 && time < 440)).toBe(true);
  expect(new Set(volley.map((egg) => egg.endpoint)).size).toBe(5);
  expect(new Set(volley.map((egg) => egg.apex)).size).toBe(5);
  const combo = frame.locator('.party-emotion-combo');
  await expect(combo).toHaveText('×5');
  await expect(combo).toHaveAttribute('data-high', 'true');
  const separated = await combo.evaluate((badge) => {
    const b = badge.getBoundingClientRect();
    return [...document.querySelectorAll('.identity > div, .party-seat-number')]
      .filter((n) => n.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
      .every((n) => {
        const a = n.getBoundingClientRect();
        return b.left >= a.right || b.right <= a.left || b.top >= a.bottom || b.bottom <= a.top;
      });
  });
  expect(separated).toBe(true);
  await page.screenshot({ path: join(flightEvidence, 'os-reduced-motion-egg-volley.png') });
  await frame
    .locator('.party-emotion[data-emotion=egg][data-phase=flight]')
    .evaluateAll((nodes) => {
      for (const node of nodes) node.getAnimations()[0]?.play();
    });
  const bigCombo = sender
    .locator('.observer-seat')
    .filter({ hasText: '青砚' })
    .locator('.observer-gift-combo');
  await expect(bigCombo).toHaveText('×5');
  await expect(bigCombo).toHaveAttribute('data-high', 'true');
  await expect(bigCombo).toHaveCSS('animation-name', 'observer-gift-bump');
  await expect(combo).toHaveCount(0);
  return volley;
}

async function seatGeometry(frame) {
  return frame.evaluate(() => {
    const all = [...partyEngine.game.players];
    const rect = (node) => node.getBoundingClientRect().toJSON();
    const visible = (node) =>
      node.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
      rect(node).width &&
      rect(node).height;
    const area = (a, b) =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return all.map((player) => {
      const seat = player.querySelector('.party-seat-number');
      const turn = player.querySelector('.party-turn-badge');
      const boxes = [seat, turn].filter((n) => n && visible(n)).map(rect);
      const landmarks = all
        .flatMap((portrait) => [
          portrait,
          ...portrait.querySelectorAll(
            ':scope > :is(.avatar, .avatar2, .name, .name2, .nameol, .nickname, .group, .identity, .hp, .equips)',
          ),
        ])
        .filter(visible)
        .map(rect);
      return {
        label: seat?.textContent,
        visible: Boolean(seat && visible(seat)),
        turn: Boolean(turn && visible(turn)),
        faceTop: rect(player).top,
        badgeTop: boxes[0]?.top,
        clipped: boxes.some(
          (b) => b.left < 0 || b.top < 0 || b.right > innerWidth || b.bottom > innerHeight,
        ),
        overlap: Math.max(
          0,
          ...boxes.flatMap((b) => landmarks.map((l) => area(b, l))),
          boxes.length === 2 ? area(...boxes) : 0,
        ),
      };
    });
  });
}

test('真实三人牌桌精修：座次回合、赤兔确认、四道具飞行及命中', async ({ browser }) => {
  test.setTimeout(150000);
  await mkdir(flightEvidence, { recursive: true });
  await mkdir(evidence, { recursive: true });
  await mkdir(polish, { recursive: true });
  const scratch = await mkdtemp(join(evidence, 'party-'));
  const party = createPartyServer({
    port: 0,
    webRoot: join(root, 'dist/web'),
    adapter: new NativeNonameService(root),
    rosterDirectory: join(scratch, 'rosters'),
    shanhetuDirectory: join(scratch, 'shanhetu'),
  });
  await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${party.server.address().port}`;
  const contexts = [];
  const context = async (options) => {
    const result = await browser.newContext(options);
    contexts.push(result);
    return result;
  };
  try {
    const host = await context({});
    await host.route('**/engine/runtime/mode.js', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      expect(source).toContain('await game.phaseLoop(first);');
      // Real draft and deal, then stop the natural loop for deterministic native actions.
      await route.fulfill({
        response,
        body: source.replace('await game.phaseLoop(first);', 'await game.pause();'),
      });
    });
    const computer = await host.newPage();
    await computer.emulateMedia({ reducedMotion: 'reduce' });
    await computer.goto(base + '/server');
    const desktop = await (
      await context({ viewport: { width: 1280, height: 800 }, hasTouch: true })
    ).newPage();
    const mobile = {
      viewport: { width: 844, height: 390 },
      screen: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    };
    const phone = await (await context(mobile)).newPage();
    const third = await (await context(mobile)).newPage();
    const pages = [desktop, phone, third];
    await Promise.all(pages.map((page) => page.emulateMedia({ reducedMotion: 'reduce' })));
    const faults = [];
    for (const page of [computer, ...pages]) {
      page.on('pageerror', (error) => faults.push(error.message));
      page.on('response', (response) => {
        if (response.status() === 404) faults.push(response.url());
      });
    }
    const created = await desktop.request.post(base + '/api/rooms', {
      data: { nickname: '临江听风' },
    });
    expect(created.ok()).toBe(true);
    const {
      room: { code },
    } = await created.json();
    const settings = await desktop.request.put(`${base}/api/rooms/${code}`, {
      data: { mode: 'doudizhu', playerCount: 3, generalPreset: 'beginner', extensions: [] },
    });
    expect(settings.ok()).toBe(true);
    await Promise.all(pages.map((page) => page.goto(`${base}/join/${code}`)));
    for (const [page, nickname] of [
      [phone, '青砚'],
      [third, '流云'],
    ]) {
      await page.locator('#nickname').fill(nickname);
      await page.locator('#join-button').tap();
    }
    for (const page of pages) await page.locator('#ready-button').tap();
    await desktop.locator('#start-button').click();
    await completeDoudizhuPregame(pages, code);
    await expect
      .poll(() => computer.frames().some((f) => f.url().includes('/engine/worker/')))
      .toBe(true);
    const worker = computer.frames().find((f) => f.url().includes('/engine/worker/'));
    const frames = await Promise.all(
      pages.map(async (page) => {
        await page.waitForFunction(
          () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
        );
        return page.frames().find((f) => f.url().includes('/engine/player/'));
      }),
    );
    await Promise.all(frames.map((frame) => chooseGeneral(frame, worker)));
    await worker.waitForFunction(() => partyEngine.proof.started && partyEngine._status.paused);
    for (const frame of frames)
      await frame.waitForFunction(() => partyEngine.game.me?.countCards('h') >= 4);
    for (const [i, frame] of frames.entries()) {
      const roles = frame.locator('#arena .player > .identity[data-party-landlord-role]');
      await expect(roles).toHaveCount(3);
      expect((await roles.allTextContents()).sort()).toEqual(['农民', '农民', '地主']);
      expect(
        await roles.evaluateAll((nodes) =>
          nodes.every((node) => node.dataset.partyLandlordRole === node.parentElement.identity),
        ),
      ).toBe(true);
      if (i < 2)
        await pages[i].screenshot({
          path: join(polish, i === 0 ? 'doudizhu-roles-desktop.png' : 'doudizhu-roles-844x390.png'),
        });
    }
    const [, receiver] = frames;
    await expect(receiver.locator('html')).toHaveAttribute('data-motion', 'full');
    await Promise.all(pages.map((page) => page.locator('#match-table-skin').selectOption('jade')));
    const ids = await Promise.all(
      frames.map((frame) => frame.evaluate(() => partyEngine.game.me.playerid)),
    );
    const senderIndex = await receiver.evaluate((ids) => {
      const x = (index) => partyEngine.lib.playerOL[ids[index]].getBoundingClientRect().left;
      // Capture the cross-table route even when the initial seats were shuffled.
      return x(0) > x(2) ? 0 : 2;
    }, ids);
    const sender = frames[senderIndex];
    const basket = sender.getByRole('button', { name: '向青砚打开菜篮子' });
    if (senderIndex === 0) await desktop.setViewportSize({ width: 844, height: 390 });
    await basket.click();
    const menu = sender.getByRole('group', { name: '菜篮子' });
    await expect(menu.locator('.party-emotion-choice img').first()).toHaveCSS('width', '37px');
    await expect(menu.getByRole('button', { name: '美酒' })).toHaveCSS(
      'background-color',
      'rgb(55, 80, 69)',
    );
    await pages[senderIndex].screenshot({ path: join(polish, 'basket-844x390.png') });
    const flowerButton = menu.getByRole('button', { name: '鲜花' });
    await phone.bringToFront();
    // The first frame also warms this Edge process's compositor. Verify it
    // creates a full flight before taking live frame measurements.
    await receiver.evaluate(() => {
      window.partyColdFlight = new Promise((resolve) => {
        const board = document.querySelector('#window');
        const observer = new MutationObserver(() => {
          const node = board.querySelector('.party-emotion[data-phase=flight]');
          const effect = node?.getAnimations()[0]?.effect;
          if (!effect) return;
          observer.disconnect();
          resolve({ frames: effect.getKeyframes().length, duration: effect.getTiming().duration });
        });
        observer.observe(board, { childList: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, 3500);
      });
    });
    await flowerButton.evaluate((node) => node.click());
    const coldFlight = await receiver.evaluate(() => window.partyColdFlight);
    expect(coldFlight).toEqual({ frames: 9, duration: 480 });
    await expect(receiver.locator('.party-emotion-notice')).toHaveCount(0);
    const flight = {};
    for (const [name, label] of [
      ['flower', '鲜花'],
      ['egg', '鸡蛋'],
      ['wine', '美酒'],
      ['shoe', '草鞋'],
    ]) {
      flight[name] = await followGift(
        phone,
        receiver,
        name,
        menu.getByRole('button', { name: label }),
      );
    }
    await expect(receiver.locator('.party-emotion-combo')).toHaveCount(0);
    const volley = await eggVolley(
      phone,
      receiver,
      menu.getByRole('button', { name: '鸡蛋' }),
      computer,
    );
    const motionToggle = phone.locator('#match-motion');
    const tools = phone.locator('#stage-tools');
    if (!(await motionToggle.isVisible())) await phone.locator('#stage-more').tap();
    await motionToggle.tap();
    await expect(receiver.locator('html')).toHaveAttribute('data-motion', 'reduced');
    if (await tools.isVisible()) await phone.getByRole('button', { name: '关闭比赛工具' }).tap();
    const compact = await followGift(
      phone,
      receiver,
      'flower',
      menu.getByRole('button', { name: '鲜花' }),
      true,
    );
    await expect(receiver.locator('.party-emotion-combo')).toHaveCount(0);
    if (!(await motionToggle.isVisible())) await phone.locator('#stage-more').tap();
    await motionToggle.tap();
    await expect(receiver.locator('html')).toHaveAttribute('data-motion', 'full');
    if (await tools.isVisible()) await phone.getByRole('button', { name: '关闭比赛工具' }).tap();
    await expect(receiver.locator('.party-emotion-notice')).toHaveCount(0);
    const wine = menu.getByRole('button', { name: '美酒' });
    await wine.click();
    // Separate the two clicks by more than the per-player rate limit.
    await new Promise((resolve) => setTimeout(resolve, 260));
    await wine.click();
    const combo = receiver.locator('.party-emotion-combo');
    await expect(combo).toHaveText('×2');
    expect(
      await combo.evaluate((node) => {
        const identity =
          partyEngine.game.me.node.identity.firstElementChild.getBoundingClientRect();
        const b = node.getBoundingClientRect();
        return Math.max(
          b.left - identity.right,
          identity.left - b.right,
          b.top - identity.bottom,
          identity.top - b.bottom,
        );
      }),
    ).toBeGreaterThanOrEqual(0);
    await phone.screenshot({ path: join(polish, 'basket-combo-844x390.png') });
    // Model the visibility event Edge fires when this client moves to the background.
    const hiddenCleanup = await receiver.evaluate(() => {
      const selector =
        '.party-emotion, .party-emotion-particle, .party-emotion-combo, .party-emotion-notice';
      const before = document.querySelectorAll(selector).length;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      const after = document.querySelectorAll(selector).length;
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      return { before, after };
    });
    expect(hiddenCleanup.before).toBeGreaterThan(0);
    expect(hiddenCleanup.after).toBe(0);
    await sender.locator('body').press('Escape');
    if (senderIndex === 0) await desktop.setViewportSize({ width: 1280, height: 800 });
    await expect(receiver.locator('.party-emotion-combo')).toHaveCount(0);

    // Run a real native chooseToUse for the landlord, with a reproducible card
    // instead of hoping the opening deal includes a particular suit and rank.
    const actorId = await worker.evaluate(() => partyEngine.game.zhu.playerid);
    const actorIndex = ids.indexOf(actorId);
    expect(actorIndex).toBeGreaterThanOrEqual(0);
    const actor = frames[actorIndex];
    const actorPage = pages[actorIndex];
    await worker.evaluate((id) => {
      const { game, lib, _status } = partyEngine;
      const player = lib.playerOL[id];
      game.broadcastAll(function (actor) {
        _status.currentPhase = actor;
        for (const p of game.players) p.classList.toggle('glow_phase', p === actor);
      }, player);
      const card = game.createCard('chitu', 'heart', 5);
      player.directgain([card]);
      window.partyFixCard = card.cardid;
      game.resume();
      const event = game.createEvent('partyFixEquipment');
      event.player = player;
      event.setContent(async () => {
        const result = await player.chooseToUse().set('type', 'phase').forResult();
        window.partyFixOutcome = {
          used: result.bool,
          equipped: player.getCards('e').includes(card),
        };
      });
      _status.eventManager.rootEvent = event;
      void event.start().catch((error) => {
        window.partyFixOutcome = { error: error.message };
      });
    }, actorId);
    for (const frame of frames) {
      await expect(frame.locator('.party-seat-number:visible')).toHaveCount(3);
      await expect(frame.locator('.party-turn-badge:visible')).toHaveCount(1);
      await expect(
        frame.locator('.party-seat-status:has(.party-turn-badge:visible) .party-seat-number'),
      ).toHaveText('1号位');
    }
    const badgeProof = [];
    for (const [index, frame] of frames.entries()) {
      const geometry = await seatGeometry(frame);
      expect(geometry).toHaveLength(3);
      expect(
        geometry.filter((seat) => !seat.visible || seat.clipped || seat.overlap !== 0),
      ).toEqual([]);
      badgeProof.push(geometry);
      if (index < 2)
        await photo(pages[index], index === 0 ? 'seat-status-desktop' : 'seat-status-mobile');
    }
    const cardId = await worker.evaluate(() => window.partyFixCard);
    await actor.waitForFunction((id) => partyEngine.lib.cardOL[id]?.matches('.selectable'), cardId);
    await actor.evaluate((id) => {
      partyEngine.lib.cardOL[id].dataset.gameplayFixCard = 'true';
    }, cardId);
    await actor.locator('[data-gameplay-fix-card]').tap({ position: { x: 8, y: 18 } });
    const confirm = confirmed(actor);
    await expect(confirm).toBeVisible();
    const preview = actor.locator('#party-selected-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('♥5 赤兔');
    const geometry = await confirm.evaluate((button) => {
      const preview = document.querySelector('#party-selected-preview').getBoundingClientRect();
      return [document.querySelector('#control'), partyEngine.ui.confirm, button].map((node) => {
        const b = node.getBoundingClientRect();
        const area =
          Math.max(0, Math.min(preview.right, b.right) - Math.max(preview.left, b.left)) *
          Math.max(0, Math.min(preview.bottom, b.bottom) - Math.max(preview.top, b.top));
        return { area, gap: Math.max(b.top - preview.bottom, preview.top - b.bottom) };
      });
    });
    for (const rect of geometry) {
      expect(rect.area).toBe(0);
      expect(rect.gap).toBeGreaterThanOrEqual(10);
    }
    await photo(actorPage, 'selected-red-hare-confirm');
    await confirm.tap();
    await worker.waitForFunction(() => window.partyFixOutcome);
    const outcome = await worker.evaluate(() => window.partyFixOutcome);
    expect(outcome).toEqual({ used: true, equipped: true });
    expect(faults).toEqual([]);
    await writeFile(
      join(flightEvidence, 'edge-flight-geometry.json'),
      JSON.stringify({ coldFlight, flight, compact, volley }, null, 2),
    );
    await writeFile(
      join(evidence, 'edge-geometry.json'),
      JSON.stringify({ flight, badgeProof, geometry, outcome }, null, 2),
    );
  } finally {
    const closed = once(party.server, 'close');
    party.stop();
    party.server.closeAllConnections();
    await closed;
    await Promise.all(contexts.map((item) => item.close()));
    await rm(scratch, { recursive: true, force: true });
  }
});
