import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = process.env.ROUND2_STAGE ?? 'after';
assert(['before', 'after'].includes(stage));
const output = root + '/.runtime/perf-client-round2-20261126/' + stage;
const source =
  stage === 'before'
    ? output + '/../baseline-dist'
    : (process.env.ROUND2_BUILD_DIR ?? root + '/dist');
const build = output + '/instrumented';
await mkdir(build, { recursive: true });
for (const directory of ['web', 'runtime', 'engine'])
  await cp(source + '/' + directory, build + '/' + directory, { recursive: true });
const emotions = build + '/runtime/emotions.js';
const original = await readFile(emotions, 'utf8');
const marker = 'function syncSeats() {';
assert(original.includes(marker));
await writeFile(
  emotions,
  original.replace(
    marker,
    marker + 'if (globalThis.round2Probe.active) globalThis.round2Probe.seats++;',
  ),
);
const party = createPartyServer({
  webRoot: build + '/web',
  port: 0,
  adapter: new NativeNonameService(root, undefined, build),
  rosterDirectory: output + '/rosters',
  shanhetuDirectory: output + '/book',
});
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + party.server.address().port;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  executablePath: process.env.ROUND2_EDGE_PATH,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const errors = [];
const missing = new Set();
const http = process.env.ENGINE_VERIFY_HTTP === '1';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function page(mobile) {
  const context = await browser.newContext(
    mobile
      ? {
          viewport: { width: 390, height: 844 },
          hasTouch: true,
          isMobile: true,
          reducedMotion: 'reduce',
        }
      : {},
  );
  if (http && mobile)
    await context.addInitScript(() => sessionStorage.setItem('party_http_transport', '1'));
  if (!mobile)
    await context.route('**/engine/runtime/mode.js', async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      const source = await response.text();
      assert(
        source.includes('const seats = setup.seats.slice().randomSort();'),
        `unexpected mode source: ${response.status()} ${source.slice(0, 80)}`,
      );
      await route.fulfill({
        response,
        body: source
          .replace(
            'const seats = setup.seats.slice().randomSort();',
            'const seats = setup.seats.slice();',
          )
          .replace(
            'await game.phaseLoop(first);',
            'first.directgain([game.createCard("guohe", "spade", 3)]); await game.phaseLoop(first);',
          ),
      });
    });
  await context.addInitScript(() => {
    const p = (globalThis.round2Probe = {
      rects: 0,
      previewRects: 0,
      seats: 0,
      frames: [],
      long: [],
      active: false,
    });
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (p.active) {
        p.rects++;
        if (this.id === 'party-selection-layer') p.previewRects++;
      }
      return original.call(this);
    };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) p.long.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: true });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error('page error', error.stack);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('page console', message.text().slice(0, 300));
  });
  page.on('response', (response) => {
    if (response.status() >= 400) missing.add(new URL(response.url()).pathname);
  });
  return page;
}
async function request(page, path, method, body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${response.status}: ${path}`);
      return response.json();
    },
    { path, method, body },
  );
}
async function table(page, count = 4) {
  await page.waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
  );
  const frame = page.frames().find((frame) => frame.url().includes('/engine/player/'));
  await frame.waitForFunction(
    (count) =>
      partyEngine.game.onlineID &&
      partyEngine.game.me?.playerid === partyEngine.game.onlineID &&
      partyEngine.game.players.length === count,
    count,
  );
  return frame;
}
async function verifyLandlord(computer) {
  const phones = await Promise.all(Array.from({ length: 3 }, () => page(true)));
  const [owner] = phones;
  await owner.goto(base);
  const lobby = await timings(owner);
  const { room } = await request(owner, '/api/rooms', 'POST', { nickname: '地主验证' });
  const { code, ownerId } = room;
  const api = `/api/rooms/${code}`;
  const address = `${base}/join/${code}`;
  await owner.goto(address);
  await timings(owner, true);
  await request(owner, api, 'PUT', {
    mode: 'doudizhu',
    playerCount: 3,
    generalPreset: 'beginner',
    extensions: [],
  });
  for (const [index, phone] of phones.slice(1).entries()) {
    await phone.goto(address);
    await phone.locator('#nickname').fill(`农民${index + 1}`);
    await phone.locator('#join-button').tap();
  }
  for (const phone of phones) await request(phone, api + '/me/ready', 'PUT', { ready: true });
  await request(owner, api + '/start', 'POST', {});
  const roomState = () => party.lobby.get(code).snapshot();
  for (let step = 0; step < 12 && !roomState().matchId; step++) {
    for (const phone of phones) {
      if (roomState().matchId) break;
      const { preparation, seats, maxBid } = await request(phone, api + '/me/doudizhu', 'GET');
      const seat =
        preparation.phase === 'bidding'
          ? seats.find((seat) => seat.id === preparation.bidSeatId)
          : seats.find((seat) => !seat.locked);
      if (!seat) continue;
      await request(phone, api + '/me/doudizhu', 'POST', {
        id: preparation.id,
        phaseId: preparation.phaseId,
        seatId: seat.id,
        revision: seat.revision,
        ...(preparation.phase === 'bidding'
          ? { action: 'bid', bid: seat.id === ownerId ? maxBid : 0 }
          : { action: 'choose', general: seat.candidates[0] }),
      });
    }
  }
  assert(roomState().matchId);
  assert.equal(roomState().doudizhu.landlordId, ownerId);
  const frames = await Promise.all(phones.map((phone) => table(phone, 3)));
  for (const frame of frames)
    await frame.locator('#party-luck-cards button[data-action="keep"]').tap();
  const worker = computer
    .frames()
    .find((f) => f.url().endsWith(`/engine/worker/${roomState().matchId}`));
  await worker.waitForFunction(() => partyEngine.proof.started);
  for (const frame of frames) {
    const roles = frame.locator('#arena .player > .identity[data-party-landlord-role]');
    await roles.last().waitFor({ state: 'attached' });
    assert.deepEqual((await roles.allTextContents()).sort(), ['农民', '农民', '地主']);
  }

  const frame = frames[0];
  const active = () =>
    frame.waitForFunction(
      () => {
        const { _status, ui } = partyEngine;
        return (
          _status.imchoosing &&
          _status.event?.type === 'phase' &&
          _status.event.isMine() &&
          _status.event.filterTarget &&
          !ui.selected.cards.length
        );
      },
      null,
      { timeout: 25000 },
    );
  try {
    await active();
  } catch (cause) {
    for (const side of [worker, ...frames])
      console.log(
        await side.evaluate(() => {
          const { game, _status, ui } = partyEngine;
          let e = _status.event;
          return {
            role: partyEngine.setup.role,
            event: e?.name,
            type: e?.type,
            choice: _status.imchoosing,
            mine: e?.isMine(),
            player: e?.player?.name,
            me: game.me?.name,
            cards: ui.selected.cards.length,
            parent: e?.getParent()?.name,
          };
        }),
      );
    throw cause;
  }
  const tableEntry = await timings(owner, false, frame);
  await wait(750);
  const basket = frame.locator('.party-basket').first();
  const visible = await basket.isVisible();
  const sample = async (tag, action) => {
    await frame.evaluate(() => {
      const p = globalThis.round2Probe;
      p.rects = p.previewRects = p.seats = 0;
      p.frames = [];
      p.long = [];
      p.active = true;
      let last;
      function measure(now) {
        if (!p.active) return;
        if (last !== undefined) p.frames.push(now - last);
        last = now;
        requestAnimationFrame(measure);
      }
      requestAnimationFrame(measure);
    });
    const cdp = await owner.context().newCDPSession(owner);
    await cdp.send('Performance.enable');
    const metrics = async () =>
      Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
      );
    const before = await metrics();
    await action?.();
    await wait(2200);
    const after = await metrics();
    const counters = await frame.evaluate(() => {
      const { rects, previewRects, seats, frames, long } = globalThis.round2Probe;
      globalThis.round2Probe.active = false;
      return {
        rects,
        previewRects,
        seats,
        frameMax: Math.max(0, ...frames),
        framesOver50: frames.filter((n) => n > 50).length,
        long,
      };
    });
    await cdp.detach();
    return {
      tag,
      ...counters,
      layouts: after.LayoutCount - before.LayoutCount,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
    };
  };
  const idle = await sample('idle');
  const burst = await sample('five eggs, incoming', () =>
    worker.evaluate(async () => {
      const { game, lib } = partyEngine;
      const to = game.zhu;
      const from = game.players.find((p) => p !== to);
      for (let i = 0; i < 5; i++) {
        from.throwEmotion(to, 'egg');
        await new Promise((r) => setTimeout(r, 115));
      }
    }),
  );
  assert.equal(await frame.locator('.party-emotion-notice').getAttribute('data-count'), '5');
  // Use the actual engine hand card, independent of theme text representation.
  const tapGuohe = async () => {
    const cards = frame.locator('#me .card');
    const index = await cards.evaluateAll((nodes) =>
      nodes.findIndex((n) => n.name === 'guohe' && n.classList.contains('selectable')),
    );
    assert(index >= 0, 'known legal dismantle card');
    await cards.nth(index).tap();
    return cards.nth(index);
  };
  const selected = await tapGuohe();
  await frame.locator('#arena .player.selectable').first().waitFor();
  assert.equal(await basket.isVisible(), false);
  await wait(650);
  const stableSelection = await sample('stable selected');
  await writeFile(
    output + '/samples.json',
    JSON.stringify({ lobby, tableEntry, idle, burst, stableSelection }, null, 2),
  );
  await selected.tap();
  await active();
  assert.equal(visible, stage === 'after', 'initial idle phase basket visibility');
  if (stage === 'after') {
    assert(visible, 'basket available in own phase before selecting cards');
    assert(await basket.isVisible(), 'cancel immediately restores basket');
    await basket.tap();
    for (const prop of ['egg', 'flower']) {
      // Arm the animation sampler before tapping. A locator round-trip can
      // otherwise resolve after the middle of this 440–480 ms animation.
      await frame.evaluate((name) => {
        globalThis.round2Flight = new Promise((resolve) => {
          const deadline = performance.now() + 3500;
          let node, midpoint;
          function tick() {
            node ??= document.querySelector(
              '.party-emotion[data-phase="flight"][data-emotion="' + name + '"]',
            );
            const animation = node?.getAnimations()[0];
            const timing = animation?.effect?.getComputedTiming();
            if (
              node?.dataset.phase === 'flight' &&
              timing?.progress > 0.23 &&
              timing.progress < 0.86
            )
              midpoint ??= { progress: timing.progress, duration: timing.duration };
            if (node?.dataset.phase === 'impact') return resolve(midpoint);
            if (performance.now() >= deadline) return resolve(null);
            requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        });
      }, prop);
      await frame.locator('.party-basket-menu [data-emotion=' + prop + ']').tap();
      const animation = await frame.evaluate(() => globalThis.round2Flight);
      assert(animation, 'visible flight midpoint and impact: ' + prop);
      assert.equal(
        animation.duration,
        prop === 'egg' ? 440 : 480,
        'full motion despite OS reduced-motion',
      );
    }
    await tapGuohe();
    const target = frame.locator('#arena .player.selectable').first();
    await target.waitFor();
    assert.equal(await basket.isVisible(), false);
    assert.equal(await frame.locator('.party-basket-menu').isVisible(), false);
    await target.tap();
    console.log(
      'native confirmation',
      await frame.evaluate(() =>
        [...document.querySelectorAll('.control:not(.removing) > div')].map((n) => n.textContent),
      ),
    );
    await frame
      .locator('.control:not(.removing) > div')
      .filter({ hasText: /^确定$/ })
      .tap({ timeout: 4500 });
    await worker.waitForFunction(
      () =>
        partyEngine._status.event?.name === 'choosePlayerCard' ||
        partyEngine.game.getGlobalHistory('useCard').some((e) => e.card?.name === 'guohe'),
    );
  }
  party.lobby.get(code).consoleClose();
  return { lobby, tableEntry, idle, burst, stableSelection, ownPhaseBasket: visible };
}
async function timings(page, reset = false, frame) {
  if (reset) {
    await page.evaluate(() => performance.clearResourceTimings());
    return;
  }
  await wait(450);
  const summarize = (target) =>
    target.evaluate(() => {
      const resources = performance.getEntriesByType('resource');
      const navigation = performance.getEntriesByType('navigation');
      const entries = [...navigation, ...resources];
      return {
        bytes: entries.reduce((a, e) => a + e.transferSize, 0),
        requests: entries.length,
        network: entries.filter((e) => e.transferSize > 0).length,
        largest: entries
          .filter((e) => e.transferSize > 0)
          .sort((a, b) => b.transferSize - a.transferSize)
          .slice(0, 8)
          .map((e) => [new URL(e.name).pathname, e.transferSize]),
        long: globalThis.round2Probe.long,
      };
    });
  return frame ? { parent: await summarize(page), frame: await summarize(frame) } : summarize(page);
}
try {
  const computer = await page(false);
  await computer.goto(base + '/server');
  const result = await verifyLandlord(computer);
  assert.deepEqual(errors, []);
  await writeFile(
    output + '/result.json',
    JSON.stringify({ ...result, missing: [...missing] }, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
  await new Promise((resolve) => party.server.close(resolve));
}
