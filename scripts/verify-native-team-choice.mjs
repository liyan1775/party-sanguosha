import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output =
  process.env.E2E_TEAM_EVIDENCE ??
  `.runtime/native-team-choice/${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(output, { recursive: true });
const party = createPartyServer({
  webRoot: `${root}/dist/web`,
  rosterDirectory: `${output}/rosters`,
  shanhetuDirectory: `${output}/shanhetu`,
  port: 0,
  publicUrl: 'http://192.168.1.100:3000',
  adapter: new NativeNonameService(root),
});
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const errors = [],
  missing = new Set(),
  contexts = [],
  results = [];
const http = process.env.ENGINE_VERIFY_HTTP === '1';
const idleBaseline = process.env.E2E_TEAM_IDLE_BASELINE === '1';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function page(mobile) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : {},
  );
  contexts.push(context);
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
          .replace('await game.phaseLoop(first);', 'await game.pause();'),
      });
    });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
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
const choosing = (frame) =>
  frame.waitForFunction(
    () => partyEngine._status.event?.name === 'chooseButton' && partyEngine._status.paused,
  );
const offers = (frame) =>
  frame.evaluate(() => partyEngine.ui.dialog.buttons.map((button) => button.link));

async function assertAttached(frame) {
  await frame.locator('#party-farmer-hand').waitFor();
  const layout = await frame.locator('#party-farmer-hand').evaluate(async (tray) => {
    // Native seats and their marks finish entrance transitions after first deal.
    await new Promise((resolve) => setTimeout(resolve, 650));
    const button = document.querySelector('#party-farmer-hand-toggle');
    const mate = button.parentElement;
    const seat = mate.getBoundingClientRect();
    const panel = tray.getBoundingClientRect();
    const bounds = [
      button,
      ...[...mate.querySelectorAll('.hp, .equips, .judges, .marks')].flatMap((node) => [
        node,
        ...node.children,
      ]),
    ].flatMap((node) => {
      const r = node.getBoundingClientRect();
      return r.width &&
        r.height &&
        getComputedStyle(node).visibility === 'visible' &&
        !node.closest('[hidden], .hidden')
        ? [r]
        : [];
    });
    bounds.push(seat);
    const center = (seat.left + seat.right) / 2;
    const direction =
      center < innerWidth * 0.3 ? 'right' : center >= innerWidth * 0.7 ? 'left' : 'below';
    const gaps = {
      right: panel.left - Math.max(...bounds.map((r) => r.right)),
      left: Math.min(...bounds.map((r) => r.left)) - panel.right,
      below: panel.top - Math.max(...bounds.map((r) => r.bottom)),
      above: Math.min(...bounds.map((r) => r.top)) - panel.bottom,
    };
    const beside = panel.bottom > seat.top && panel.top < seat.bottom;
    const under = panel.right > seat.left && panel.left < seat.right;
    return {
      direction,
      actual: Object.keys(gaps).find(
        (side) =>
          gaps[side] >= 4 && gaps[side] <= 8 && (['right', 'left'].includes(side) ? beside : under),
      ),
      gaps,
      panel: panel.toJSON(),
      seat: seat.toJSON(),
      bounded:
        panel.left >= 7 &&
        panel.top >= 7 &&
        panel.right <= innerWidth - 7 &&
        panel.bottom <= innerHeight - 7,
    };
  });
  assert(layout.bounded && layout.actual, JSON.stringify(layout));
  return layout;
}

async function swipeRotated(phone, frame) {
  await phone.locator('#match-panel.rotated-table').waitFor();
  const iframe = await phone.locator('#game-frame').boundingBox();
  const list = frame.locator('.party-farmer-cards');
  const clip = await list.evaluate((node) => node.getBoundingClientRect().toJSON());
  assert(await list.evaluate((node) => node.scrollWidth > node.clientWidth));
  const session = await phone.context().newCDPSession(phone);
  try {
    for (let swipe = 0; swipe < 6; swipe++) {
      const x = iframe.x + iframe.width - clip.top - clip.height / 2;
      const y = iframe.y + clip.right - 10;
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 6; step++)
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: y - ((clip.width - 20) * step) / 6 }],
        });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
  } finally {
    await session.detach();
  }
  assert(
    await list.evaluate((node) => {
      const clip = node.getBoundingClientRect();
      const last = node.lastElementChild.getBoundingClientRect();
      return node.scrollLeft > 0 && last.right <= clip.right + 1 && last.left >= clip.left - 1;
    }),
    '90° 横转后实际触控滑到末张',
  );
}

async function verifyMovingInquiry(phone, frame) {
  const viewport = await phone.locator('#game-frame').boundingBox();
  const point = await frame.locator('#party-farmer-hand').evaluate(async (tray) => {
    const box = tray.getBoundingClientRect();
    const target = document.createElement('button');
    target.id = 'moving-inquiry';
    target.className = 'prompt';
    target.style.cssText =
      'position:fixed!important;left:0!important;top:0!important;width:50px!important;height:30px!important;z-index:5;transition:none!important';
    document.body.append(target);
    const start = target.getBoundingClientRect();
    const scale = start.width / 50;
    const dx = (box.left + box.width / 2 - start.left - start.width / 2) / scale;
    const dy = (box.top + box.height / 2 - start.top - start.height / 2) / scale;
    const style = document.createElement('style');
    style.id = 'moving-inquiry-style';
    style.textContent = `@keyframes inquiryTravel {
      0%,55% {transform: translate(0px,0px)}
      85%,100% {transform: translate(${dx}px,${dy}px)}
    }`;
    document.head.append(style);
    target.onclick = () => (target.dataset.clicked = 'yes');
    target.style.animation = 'inquiryTravel 1.5s linear forwards';
    const animation = target.getAnimations()[0];
    await animation.ready;
    while (animation.currentTime < 1300) await new Promise(requestAnimationFrame);
    const moved = target.getBoundingClientRect();
    const x = moved.left + moved.width / 2;
    const y = moved.top + moved.height / 2;
    if (animation.currentTime >= 1500 || document.elementFromPoint(x, y) !== target)
      throw new Error('1.5秒询问在825ms后移入牌条，动画结束前首击位置必须已让出');
    return { x, y };
  });
  await phone.touchscreen.tap(viewport.x + point.x, viewport.y + point.y);
  assert.equal(await frame.locator('#moving-inquiry').getAttribute('data-clicked'), 'yes');
  await frame.evaluate(() => {
    document.getElementById('moving-inquiry').remove();
    document.getElementById('moving-inquiry-style').remove();
  });
  await frame.locator('#party-farmer-hand').waitFor();
}

async function sampleIdleHand(frame, mode) {
  const layer = frame.locator('#party-farmer-layer');
  await layer.evaluate(() => new Promise((resolve) => setTimeout(resolve, 800)));
  const sample = await layer.evaluate(async (node) => {
    const read = node.getBoundingClientRect;
    let passes = 0;
    node.getBoundingClientRect = function () {
      passes++;
      return read.call(this);
    };
    try {
      const start = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      return { milliseconds: Math.round(performance.now() - start), passes };
    } finally {
      delete node.getBoundingClientRect;
    }
  });
  console.log('team-hand-idle-layout', JSON.stringify({ mode, idleBaseline, ...sample }));
  if (!idleBaseline)
    assert.equal(sample.passes, 0, `静置牌桌不应轮询布局：${JSON.stringify(sample)}`);
  return sample;
}

async function verifyDistantInquiry(frame) {
  const hiddenAt = await frame.locator('#party-farmer-hand').evaluate(async (tray) => {
    const nextFrame = () => new Promise(requestAnimationFrame);
    const panel = tray.getBoundingClientRect();
    const probe = document.createElement('div');
    probe.className = 'prompt';
    const left = panel.left > innerWidth / 2 ? 2 : innerWidth - 12;
    probe.style.cssText = `position:fixed;left:${left}px;top:2px;width:8px;height:8px;pointer-events:none;transition:none`;
    document.body.append(probe);
    try {
      await nextFrame();
      const actual = probe.getBoundingClientRect();
      const current = tray.getBoundingClientRect();
      if (
        tray.hidden ||
        (actual.left < current.right + 6 &&
          actual.right > current.left - 6 &&
          actual.top < current.bottom + 6 &&
          actual.bottom > current.top - 6)
      ) {
        throw new Error('远处询问夹具未与已展开牌条分离');
      }
      const failures = [];
      for (let tick = 0; tick < 10; tick++) {
        probe.style.color = tick % 2 ? 'red' : 'blue';
        probe.classList.toggle('highlight');
        await new Promise(queueMicrotask);
        if (tray.hidden) failures.push(tick);
        await nextFrame();
      }
      return failures;
    } finally {
      probe.remove();
    }
  });
  assert.deepEqual(hiddenAt, [], '远处询问改变颜色或高亮时不应先隐藏队友牌条');
}

async function startNativeInquiry(worker, id) {
  await worker.evaluate((id) => {
    const { lib, _status } = partyEngine;
    _status.eventManager = new _status.eventManager.constructor();
    _status.eventManager.rootEvent = lib.element.GameEvent.initialGameEvent();
    _status.pauseManager = new _status.pauseManager.constructor();
    const event = new lib.element.GameEvent('partyTeamHandFixture', false, _status.eventManager);
    event.player = lib.playerOL[id];
    event.setContent(async function (event) {
      globalThis.partyTeamInquiryResult = await event.player
        .chooseTarget('请选择另一名角色', (_card, player, target) => player !== target)
        .forResult();
    });
    _status.eventManager.rootEvent = event;
    globalThis.partyTeamInquiryDone = false;
    void event.start().then(() => {
      globalThis.partyTeamInquiryDone = true;
    });
  }, id);
}

async function verifyRegularInquiry(phone, frame, worker, id, humans) {
  await startNativeInquiry(worker, id);
  await frame.waitForFunction(
    () => partyEngine._status.event?.name === 'chooseTarget' && partyEngine._status.paused,
  );
  const tray = frame.locator('#party-farmer-hand');
  const overlap = await tray.evaluate(async (node) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (node.hidden) return false;
    const panel = node.getBoundingClientRect();
    return [...document.querySelectorAll('.dialog, .dialog .content, .prompt, #control > *')].some(
      (target) => {
        const bounds = target.getBoundingClientRect();
        return (
          !target.closest('[hidden], .hidden') &&
          getComputedStyle(target).visibility === 'visible' &&
          bounds.width &&
          bounds.height &&
          panel.left < bounds.right &&
          panel.right > bounds.left &&
          panel.top < bounds.bottom &&
          panel.bottom > bounds.top
        );
      },
    );
  });
  assert.equal(overlap, false, '队友牌条不能遮挡原生技能询问');
  await frame.evaluate(() => {
    const blocking = document.createElement('div');
    blocking.id = 'party-inquiry-layout-probe';
    blocking.className = 'dialog';
    blocking.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
    document.body.append(blocking);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await tray.isVisible(), false);
  assert.equal(await frame.evaluate(() => partyEngine.ui.selected.targets.length), 0);
  await frame.locator('.player.selectable').first().tap();
  const confirm = frame.locator('.control:not(.removing) > div').filter({ hasText: /^确定$/ });
  await confirm.waitFor();
  await wait(450);
  await phone.screenshot({ path: `${output}/team-hand-inquiry-${humans}.png` });
  if (humans === 4) {
    await phone.setViewportSize({ width: 1280, height: 720 });
    // Native updatexr defers its deviceZoom conversion by 500 ms on resize.
    // Set the requested zoom after that conversion, as a player would.
    await frame.waitForFunction(
      () =>
        document.documentElement.offsetWidth >= 900 &&
        partyEngine.game.deviceZoom === 1 &&
        !partyEngine.ui._updatexr,
      undefined,
      { timeout: 8000 },
    );
    const priorZoom = await frame.evaluate(() => {
      const previous = partyEngine.game.documentZoom;
      partyEngine.game.documentZoom = 0.85;
      partyEngine.ui.updatez();
      return previous;
    });
    await frame.waitForFunction(
      () => {
        const { game, ui } = partyEngine;
        const entering = ui.control
          .getAnimations({ subtree: true })
          .some(
            (animation) =>
              animation.playState === 'running' &&
              Number.isFinite(animation.effect?.getComputedTiming().endTime),
          );
        return game.documentZoom === 0.85 && !ui._updatexr && !entering;
      },
      undefined,
      { timeout: 8000 },
    );
    const sample = await confirm.evaluate(async (button) => {
      const positions = new Set();
      let clearance = Infinity;
      for (let i = 0; i < 60; i++) {
        await new Promise(requestAnimationFrame);
        if (partyEngine.game.documentZoom !== 0.85 || partyEngine.ui._updatexr)
          throw new Error('确认栏60帧必须全程处于0.85缩放及已完成的原生布局');
        positions.add(button.getBoundingClientRect().top);
        const bottom = Math.max(
          ...[partyEngine.ui.control, ...button.parentElement.children].map(
            (node) => node.getBoundingClientRect().bottom,
          ),
        );
        const hands = [...document.querySelectorAll('#me .handcards, #me .handcards .card')]
          .filter((node) =>
            node.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
          )
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width && rect.height);
        if (!hands.length) throw new Error('确认栏验收必须有真实的手牌边界');
        clearance = Math.min(clearance, ...hands.map((rect) => rect.top - bottom));
      }
      return { positions: [...positions], clearance };
    });
    console.log('team-confirm-stability', JSON.stringify(sample));
    assert.equal(sample.positions.length, 1, '触控确认栏在60个静止帧中不得上下跳位');
    assert(sample.clearance >= 12, `触控确认栏距手牌应至少12像素，实测${sample.clearance}`);
    await confirm.tap();
    await frame.evaluate((previous) => {
      partyEngine.game.documentZoom = previous;
      partyEngine.ui.updatez();
    }, priorZoom);
  } else {
    await confirm.tap();
  }
  await worker.waitForFunction(() => globalThis.partyTeamInquiryDone);
  assert(await worker.evaluate(() => globalThis.partyTeamInquiryResult.bool));
  await frame.locator('#party-inquiry-layout-probe').evaluate((node) => node.remove());
  await tray.waitFor();
}

async function verifyFirstConfirm(phone, frame, worker, label, variant) {
  await phone.locator('#match-panel.rotated-table').waitFor();
  const tray = frame.locator('#party-farmer-hand');
  await tray.waitFor();
  const id = await frame.evaluate(() => partyEngine.game.me.playerid);
  await startNativeInquiry(worker, id);
  await frame.waitForFunction(
    () => partyEngine._status.event?.name === 'chooseTarget' && partyEngine._status.paused,
  );
  const target = frame.locator('.player.selectable').first();
  const targetId = await target.evaluate((node) => node.playerid);
  await target.tap();
  const confirm = frame.locator('.control:not(.removing) > div').filter({ hasText: /^确定$/ });
  await confirm.waitFor();
  await confirm.evaluate((button, variant) => {
    const control = button.parentElement;
    const popup = document.createElement('div');
    popup.id = 'party-first-tap-probe';
    popup.className = 'popup-container';
    popup.style.cssText =
      'position:fixed;inset:auto;width:64px;height:36px;z-index:48;transform-origin:top left;transition:none;animation:none;visibility:visible;pointer-events:auto';
    control.style.cssText =
      'position:absolute;inset:0;display:block;width:100%;height:100%;box-sizing:border-box;transform:none!important;transition:none;animation:none;visibility:inherit!important;opacity:1!important;pointer-events:auto!important;margin:0;padding:0';
    button.style.cssText =
      'position:absolute;inset:0;display:grid;place-items:center;width:100%;height:100%;box-sizing:border-box;transform:none!important;transition:none;animation:none;visibility:inherit!important;pointer-events:auto!important;margin:0;padding:0';
    for (const other of control.children) if (other !== button) other.hidden = true;
    popup.append(control);
    window.partyFirstTapProbe = { popup, button };
    if (variant === 'visibility') {
      popup.style.visibility = 'hidden';
      document.querySelector('#party-farmer-layer').before(popup);
    }
  }, variant);
  await tray.waitFor();
  const iframe = await phone.locator('#game-frame').boundingBox();
  const shown = await tray.evaluate(async (node, variant) => {
    const { popup, button } = window.partyFirstTapProbe;
    const panel = node.getBoundingClientRect();
    const layer = node.parentElement;
    const base = layer.getBoundingClientRect();
    const hitX = (panel.left + panel.right) / 2;
    const hitY = (panel.top + panel.bottom) / 2;
    const overTrayBefore = node.contains(document.elementFromPoint(hitX, hitY));
    popup.style.transform = layer.style.transform;
    const nativeScale = (layer.offsetWidth / 100) * (partyEngine.game.documentZoom || 1);
    popup.style.left = `${((hitX - base.left) * 100) / base.width / nativeScale - 32 / nativeScale}px`;
    popup.style.top = `${((hitY - base.top) * 100) / base.height / nativeScale - 18 / nativeScale}px`;
    if (variant === 'insertion') layer.before(popup);
    else popup.style.visibility = 'visible';
    await new Promise((resolve) => queueMicrotask(resolve));
    const hit = document.elementFromPoint(hitX, hitY);
    const overConfirmAfter = button.contains(hit);
    return {
      hitX,
      hitY,
      overTrayBefore,
      tuckedBeforeFrame: node.hidden,
      overConfirmAfter,
      ...(overConfirmAfter
        ? {}
        : {
            stack: document
              .elementsFromPoint(hitX, hitY)
              .map((target) => target.id || target.className),
            fixture: [button, button.parentElement, popup].map((target) => {
              const { pointerEvents, visibility, zIndex, opacity } = getComputedStyle(target);
              return {
                pointerEvents,
                visibility,
                zIndex,
                opacity,
                bounds: target.getBoundingClientRect().toJSON(),
              };
            }),
          }),
    };
  }, variant);
  assert(
    shown.overTrayBefore && shown.tuckedBeforeFrame && shown.overConfirmAfter,
    JSON.stringify(shown),
  );
  await phone.touchscreen.tap(iframe.x + iframe.width - shown.hitY, iframe.y + shown.hitX);
  await worker.waitForFunction(() => globalThis.partyTeamInquiryDone, undefined, { timeout: 5000 });
  assert.deepEqual(
    await worker.evaluate(() => ({
      accepted: globalThis.partyTeamInquiryResult.bool,
      target: globalThis.partyTeamInquiryResult.targets?.[0]?.playerid,
    })),
    { accepted: true, target: targetId },
  );
  await frame.evaluate(() => {
    window.partyFirstTapProbe.popup.remove();
    delete window.partyFirstTapProbe;
  });
  await tray.waitFor();
  await frame.locator('.party-farmer-cards').evaluate((node) => {
    node.scrollLeft = 0;
  });
  assert.equal(await frame.locator('.party-farmer-card').count(), 10);
  await swipeRotated(phone, frame);
  await phone.screenshot({ path: `${output}/${label}-${variant}-restored-last-card.png` });
  return { variant, tuckedBeforeFrame: true, firstTapAccepted: true, restoredAndSwipedTo: 10 };
}

async function assertHandPrivate(frame, ids) {
  assert(
    await frame.evaluate(
      (ids) =>
        ids.every(
          (id) =>
            !partyEngine.lib.cardOL[id] || partyEngine.lib.cardOL[id].name === 'party_unknown',
        ),
      ids,
    ),
    '对手的客户端不能解码同队私有明牌',
  );
}

async function assertObserverPrivate(computer, address, code, matchId, ids, teams) {
  const spectator = await page(true);
  try {
    await spectator.goto(address);
    await spectator.locator('#spectator-panel').waitFor();
    assert.equal(await spectator.locator('#game-frame').count(), 0);
    const refused = await spectator.request.get(`${base}/engine/setup/${matchId}?role=player`);
    assert.equal(refused.status(), 403);
    const publicView = await request(computer, '/api/console', 'GET');
    const observed = publicView.rooms.find((entry) => entry.room.code === code);
    assert(observed?.observer);
    if (teams) {
      const seats = observed.observer.players;
      assert.deepEqual(
        seats.map((seat) => seat.identity),
        seats.map((seat) => teams[seat.id]),
      );
      assert.deepEqual(Object.values(teams).sort(), ['红队', '红队', '蓝队', '蓝队']);
      const rows = spectator.locator('#spectator-table .observer-seat');
      await rows.nth(3).waitFor();
      for (const seat of seats) {
        const row = rows.filter({
          has: spectator.getByRole('heading', { name: seat.nickname, exact: true }),
        });
        assert((await row.innerText()).includes(teams[seat.id]), '访客应能看到该席真实的红蓝队别');
      }
    }
    const publicJson = JSON.stringify(observed);
    assert(!publicJson.match(/"cardid"|"handCards"|"farmerHands"/i));
    assert(ids.every((id) => !publicJson.includes(JSON.stringify(String(id)))));
  } finally {
    await spectator.close();
  }
}

async function verifyLandlord(computer) {
  const phones = await Promise.all(Array.from({ length: 3 }, () => page(true)));
  const [owner] = phones;
  await owner.goto(base);
  const { room } = await request(owner, '/api/rooms', 'POST', { nickname: '地主验证' });
  const { code, ownerId } = room;
  const api = `/api/rooms/${code}`;
  const address = `${base}/join/${code}`;
  await owner.goto(address);
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
  const directions = [];
  for (const [index, frame] of frames.slice(1).entries()) {
    await frame.locator('#party-farmer-hand-toggle').tap();
    const layout = await assertAttached(frame);
    assert.equal(layout.actual, layout.direction, JSON.stringify(layout));
    directions.push(layout.actual);
    const phone = phones[index + 1];
    await phone.setViewportSize({ width: 844, height: 390 });
    await assertAttached(frame);
    await phone.screenshot({ path: `${output}/doudizhu-teammate-${layout.actual}.png` });
    await phone.setViewportSize({ width: 390, height: 844 });
  }
  assert.deepEqual(new Set(directions), new Set(['left', 'right']));
  const farmer = frames[1];
  const mateId = await farmer
    .locator('#party-farmer-hand-toggle')
    .evaluate((n) => n.parentElement.playerid);
  const privateCards = await worker.evaluate((id) => {
    const { game, lib } = partyEngine;
    const mate = lib.playerOL[id];
    const samples = ['nanman', 'jiedao', 'wugu', 'shunshou', 'lebu', 'shan'];
    const suits = ['spade', 'heart', 'club', 'diamond'];
    mate.directgain(
      samples.map((name, index) => game.createCard(name, suits[index % 4], 13 - index)),
    );
    return mate.getCards('h').map((c) => c.cardid);
  }, mateId);
  const longNames = ['南蛮入侵', '借刀杀人', '五谷丰登', '顺手牵羊', '乐不思蜀'];
  await farmer.waitForFunction((names) => {
    const cards = [...document.querySelectorAll('.party-farmer-card-name')];
    return (
      cards.length === 10 && names.every((name) => cards.some((card) => card.textContent === name))
    );
  }, longNames);
  const readable = await farmer.locator('.party-farmer-card').evaluateAll((cards, names) => {
    const long = cards.filter((card) => names.includes(card.lastElementChild.textContent));
    return long.map((card) => {
      const rank = card.firstElementChild.getBoundingClientRect();
      const label = card.lastElementChild;
      const box = card.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(label);
      const rows = [...range.getClientRects()];
      return {
        name: label.textContent,
        twoRows: rows.length === 2,
        fits: rows.every(
          (row) =>
            row.top >= rank.bottom - 1 &&
            row.bottom <= box.bottom &&
            row.left >= box.left &&
            row.right <= box.right,
        ),
      };
    });
  }, longNames);
  for (const name of longNames)
    assert(
      readable.some((row) => row.name === name && row.twoRows && row.fits),
      JSON.stringify(readable),
    );
  await swipeRotated(phones[1], farmer);
  await phones[1].screenshot({ path: `${output}/doudizhu-rotated-last-card.png` });
  const idleLayout = await sampleIdleHand(farmer, 'doudizhu');
  const firstConfirm = [];
  if (!idleBaseline) {
    for (const variant of ['insertion', 'visibility'])
      firstConfirm.push(await verifyFirstConfirm(phones[1], farmer, worker, 'doudizhu', variant));
  }
  await phones[1].setViewportSize({ width: 844, height: 390 });
  const normalLayout = await assertAttached(farmer);
  assert.equal(normalLayout.actual, normalLayout.direction);
  if (!idleBaseline) {
    await verifyMovingInquiry(phones[1], farmer);
    await sampleIdleHand(farmer, 'doudizhu-after-long-inquiry');
  }
  await phones[1].screenshot({ path: `${output}/doudizhu-teammate-landscape.png` });
  await farmer.locator('.party-farmer-cards').evaluate((node) => {
    node.scrollLeft = 0;
  });
  await phones[1].screenshot({ path: `${output}/doudizhu-long-card-names.png` });
  await farmer.evaluate(() => {
    partyEngine.game.documentZoom = 0.85;
    partyEngine.ui.updatez();
  });
  const scaled = await assertAttached(farmer);
  assert.equal(scaled.actual, scaled.direction);
  assert.equal(await frames[0].locator('#party-farmer-hand-toggle').count(), 0);
  await assertHandPrivate(frames[0], privateCards);
  await assertObserverPrivate(computer, address, code, roomState().matchId, privateCards);
  await phones[1].reload();
  const rejoined = await table(phones[1], 3);
  await assertAttached(rejoined);
  assert.equal(await rejoined.locator('.party-farmer-card').count(), 10);
  await computer.locator('.observer-board .observer-seat').nth(2).waitFor();
  await computer.locator('#qr').waitFor();
  await computer.locator('#internet-qr').waitFor();
  await computer.screenshot({ path: `${output}/server-native-observer.png`, fullPage: true });
  party.lobby.get(code).consoleClose();
  for (const phone of phones) await phone.close();
  return {
    directions,
    rotatedSwipeToLastOf: privateCards.length,
    longNames,
    nativeZoom: 0.85,
    landlordAndObserverPrivate: true,
    idleLayout,
    firstConfirm,
  };
}
try {
  const computer = await page(false);
  await computer.setViewportSize({ width: 1440, height: 1152 });
  party.setInternetEntry('ready', '跨网络可扫码', 'https://team-table-evidence.trycloudflare.com/');
  await computer.goto(`${base}/server`);
  const landlord = await verifyLandlord(computer);
  for (const humans of [4, 2, 1]) {
    const phones = [];
    for (let index = 0; index < humans; index++) phones.push(await page(true));
    await phones[0].goto(base);
    const created = await request(phones[0], '/api/rooms', 'POST', { nickname: '队友选将验证' });
    const code = created.room.code;
    await phones[0].goto(`${base}/join/${code}`);
    await request(phones[0], `/api/rooms/${code}`, 'PUT', {
      mode: 'versus',
      playerCount: 4,
      generalPreset: 'beginner',
      allowGeneralSelection: true,
      extensions: [],
    });
    for (const [index, phone] of phones.slice(1).entries()) {
      await phone.goto(`${base}/join/${code}`);
      await phone.locator('#nickname').fill(`队友验证${index + 1}`);
      await phone.locator('#join-button').tap();
    }
    if (humans < 4)
      await request(phones[0], `/api/rooms/${code}/bots`, 'POST', { count: 4 - humans });
    for (const [index, phone] of phones.entries()) {
      await request(phone, `/api/rooms/${code}/me/general`, 'PUT', {
        general: ['liubei', 'zhaoyun', 'caocao', 'sunquan'][index],
      });
    }
    for (const phone of phones) {
      await phone.waitForFunction(() => !document.querySelector('#ready-button')?.disabled);
      await phone.locator('#ready-button').tap();
    }
    await phones[0].waitForFunction(() => !document.querySelector('#start-button')?.disabled);
    await phones[0].locator('#start-button').tap();
    const frames = await Promise.all(phones.map((phone) => table(phone)));
    await Promise.all(frames.map(choosing));
    const matchId = party.lobby.get(code).snapshot().matchId;
    const worker = computer
      .frames()
      .find((frame) => frame.url().endsWith(`/engine/worker/${matchId}`));
    const selectionIds = await worker.evaluate(() => ({
      humans: partyEngine.setup.seats
        .filter((seat) => seat.kind === 'human')
        .map((seat) => seat.id),
      waiting: Object.keys(partyEngine.lib.node.torespond),
    }));
    assert.deepEqual(new Set(selectionIds.waiting), new Set(selectionIds.humans));
    const ownerId = await frames[0].evaluate(() => partyEngine.game.me.playerid);
    const deadline = await worker.evaluate(
      (id) => partyEngine.lib.node.torespondtimeout[id],
      ownerId,
    );
    const original = await offers(frames[0]);
    assert.equal(original.length, 10);
    assert.deepEqual(
      await frames[0].evaluate(() => partyEngine._status.event.selectButton),
      humans === 4 ? [1, 1] : [2, 2],
    );
    const selected = [];
    if (humans === 4) {
      for (const frame of frames) {
        await frame
          .locator('.dialog .button.character.selectable:not(.unselectable)')
          .first()
          .tap();
        const id = await frame.evaluate(() => partyEngine.game.me.playerid);
        const name = await frame.evaluate(() => partyEngine.ui.selected.buttons[0].link);
        selected.push({ id, pair: [name] });
        await frame.locator('.hero-draft .hd-primary').tap();
      }
    } else if (humans === 2) {
      assert.equal(new Set([...original, ...(await offers(frames[1]))]).size, 20);
      await phones[0].reload();
      frames[0] = await table(phones[0]);
      await choosing(frames[0]);
      assert.deepEqual(await offers(frames[0]), original);
      assert.equal(
        await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], ownerId),
        deadline,
      );
      for (const frame of frames) {
        const pair = (await offers(frame)).slice(0, 2);
        for (const [index, name] of pair.entries()) {
          await frame.evaluate((name) => {
            partyEngine.ui.dialog.buttons.find((button) => button.link === name).dataset.teamProbe =
              'selected';
          }, name);
          await frame.locator('[data-team-probe="selected"].selectable:not(.selected)').tap();
          assert.equal(
            await frame.evaluate(() => partyEngine.ui.selected.buttons.length),
            index + 1,
          );
          assert.equal(
            await worker.evaluate(() => partyEngine.game.players.every((player) => !player.name)),
            true,
          );
        }
        assert.equal(
          await frame.locator('.party-general-status').filter({ hasText: /自己/ }).count(),
          1,
        );
        assert.equal(
          await frame
            .locator('.party-general-status')
            .filter({ hasText: /AI 队友/ })
            .count(),
          1,
        );
        const id = await frame.evaluate(() => partyEngine.game.me.playerid);
        selected.push({ id, pair });
        await frame.locator('.hero-draft .hd-primary').tap();
      }
    } else {
      // Exercise the same authoritative timeout callback, leaving its native
      // AI algorithm and original candidate pool intact.
      await worker.evaluate((id) => {
        clearTimeout(partyEngine.lib.node.torespondtimeout[id]);
        partyEngine.lib.playerOL[id].unwait('ai');
      }, ownerId);
    }
    for (const frame of frames) {
      await frame.locator('#party-luck-cards button[data-action="keep"]').waitFor();
      await frame.locator('#party-luck-cards button[data-action="keep"]').tap();
    }
    await worker.waitForFunction(() => partyEngine.proof.started, {}, { polling: 100 });
    assert.equal(
      await worker.evaluate(
        (selected) =>
          selected.every(({ id, pair }) => {
            const own = partyEngine.lib.playerOL[id];
            const ally = partyEngine.game.players.find(
              (player) => player !== own && player.side === own.side,
            );
            return own.name === pair[0] && (pair.length === 1 || ally.name === pair[1]);
          }),
        selected,
      ),
      true,
    );
    const dealt = await worker.evaluate(() => ({
      unique: new Set(partyEngine.game.players.map((player) => player.name)).size,
      counts: partyEngine.game.players.map((player) => player.countCards('h')),
    }));
    assert.equal(dealt.unique, 4);
    assert.deepEqual(dealt.counts, [4, 4, 4, 5]);
    for (const frame of frames) {
      const badges = frame.locator('.party-seat-number');
      await badges.last().waitFor({ state: 'attached' });
      assert.deepEqual((await badges.allTextContents()).sort(), [
        '1号位',
        '2号位',
        '3号位',
        '4号位',
      ]);
    }
    if (humans === 1) {
      // The injected worker-only timeout does not run the phone's timer UI.
      // Restore that phone to its real dealt state before testing presentation.
      await phones[0].reload();
      frames[0] = await table(phones[0]);
    }
    const layouts = [];
    for (const [index, frame] of frames.entries()) {
      const mateId = await worker.evaluate(
        (id) => {
          const own = partyEngine.lib.playerOL[id];
          return partyEngine.game.players.find((p) => p !== own && p.side === own.side).playerid;
        },
        await frame.evaluate(() => partyEngine.game.me.playerid),
      );
      await frame.locator('#party-farmer-hand-toggle').waitFor();
      assert.equal(
        await frame.locator('#party-farmer-hand-toggle').evaluate((n) => n.parentElement.playerid),
        mateId,
      );
      if (!(await frame.locator('#party-farmer-hand').isVisible()))
        await frame.locator('#party-farmer-hand-toggle').tap();
      await wait(350);
      if (!(await frame.locator('#party-farmer-hand').isVisible()))
        console.log(
          'hand-layout',
          await frame.evaluate(() => ({
            w: innerWidth,
            h: innerHeight,
            nodes: [...document.querySelectorAll('.player,.dialog,.prompt,#control')].map((n) => ({
              cls: n.className,
              visibility: getComputedStyle(n).visibility,
              display: getComputedStyle(n).display,
              r: n.getBoundingClientRect().toJSON(),
            })),
          })),
        );
      await frame.locator('#party-farmer-hand').waitFor();
      const layout = await assertAttached(frame);
      layouts.push(layout);
      if (layout.direction === 'below' && layout.actual === 'below')
        await phones[index].screenshot({ path: `${output}/versus-opposite-teammate.png` });
      const count = await worker.evaluate(
        (id) => partyEngine.lib.playerOL[id].countCards('h'),
        mateId,
      );
      assert.equal(await frame.locator('.party-farmer-card').count(), count);
      const clipped = await frame.locator('.party-farmer-cards').evaluate((node) => ({
        position: getComputedStyle(node).position,
        overflow: getComputedStyle(node).overflowX,
        width: node.getBoundingClientRect().width,
        parent: node.parentElement.getBoundingClientRect().width,
        client: node.clientWidth,
        scroll: node.scrollWidth,
      }));
      assert.equal(clipped.position, 'relative');
      assert.equal(clipped.overflow, 'auto');
      assert(clipped.width < clipped.parent, '滚动牌列必须受外层牌条约束');
      if (index === 0 && clipped.scroll > clipped.client + 1) {
        await phones[index].setViewportSize({ width: 844, height: 390 });
        const scrollBox = await frame.locator('.party-farmer-cards').boundingBox();
        const session = await phones[index].context().newCDPSession(phones[index]);
        for (let swipe = 0; swipe < 3; swipe++) {
          const x = scrollBox.x + scrollBox.width - 12,
            y = scrollBox.y + scrollBox.height / 2;
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x, y }],
          });
          for (let step = 1; step <= 6; step++)
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: x - ((scrollBox.width - 24) * step) / 6, y }],
            });
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await wait(150);
        }
        await session.detach();
        const scrolled = await frame.locator('.party-farmer-cards').evaluate((n) => {
          const clip = n.getBoundingClientRect(),
            last = n.lastElementChild.getBoundingClientRect();
          return {
            left: n.scrollLeft,
            lastVisible: last.left < clip.right && last.right > clip.left,
          };
        });
        assert(scrolled.left > 0 && scrolled.lastVisible, '模拟触屏横滑后能查看末张队友牌');
        await phones[index].screenshot({ path: `${output}/team-hand-scrolled-${humans}.png` });
      }
      assert(!(await frame.locator('#party-farmer-hand').textContent()).includes('未知牌'));
      const sourceHands = await worker.evaluate(
        (id) => {
          const own = partyEngine.lib.playerOL[id];
          return partyEngine.game.players
            .filter((p) => p !== own)
            .map((p) => ({
              id: p.playerid,
              ally: p.side === own.side,
              cards: p
                .getCards('h')
                .map((c) => ({ id: c.cardid, name: c.name, suit: c.suit, number: c.number })),
            }));
        },
        await frame.evaluate(() => partyEngine.game.me.playerid),
      );
      assert(
        await frame.evaluate(
          (hands) =>
            hands.every((p) =>
              p.cards.every((c) => {
                const card = partyEngine.lib.cardOL[c.id];
                return p.ally
                  ? card?.name === c.name && card.suit === c.suit && card.number === c.number
                  : !card || card.name === 'party_unknown';
              }),
            ),
          sourceHands,
        ),
        '同队当前h牌面一致，对手手牌隐藏',
      );
      assert.equal(
        await frame.locator('#party-farmer-hand .card, #party-farmer-hand .selectable').count(),
        0,
      );
      await phones[index].screenshot({ path: `${output}/team-hand-${humans}-${index}.png` });
    }
    let firstConfirm;
    let idleLayout;
    if (humans === 4) {
      await phones[0].setViewportSize({ width: 844, height: 390 });
      const wing = await assertAttached(frames[0]);
      assert(['left', 'right'].includes(wing.actual), JSON.stringify(wing));
      await phones[0].screenshot({ path: `${output}/versus-wing-teammate.png` });
      // The normal 1/4 and 2/3 team layout puts the ally on a wing.
      // Exercise the opposite visual position on the same dealt native table;
      // swap only the client DOM positions, leaving the seats and hands intact.
      const restore = await frames[0].evaluate(() => {
        const mate = document.querySelector('#party-farmer-hand-toggle').parentElement;
        const opposite = partyEngine.game.players.find((player) => {
          if (player === mate || player === partyEngine.game.me) return false;
          const rect = player.getBoundingClientRect();
          return Math.abs((rect.left + rect.right) / 2 - innerWidth / 2) < innerWidth * 0.2;
        });
        const original = [mate, opposite].map((player) => [
          player.playerid,
          player.dataset.position,
        ]);
        [mate.dataset.position, opposite.dataset.position] = [
          opposite.dataset.position,
          mate.dataset.position,
        ];
        return original;
      });
      // Give the separate query/confirm row and own hand their normal spacing.
      await phones[0].setViewportSize({ width: 844, height: 480 });
      const oppositeLayout = await assertAttached(frames[0]);
      assert.equal(oppositeLayout.direction, 'below', JSON.stringify(oppositeLayout));
      assert.equal(oppositeLayout.actual, 'below', JSON.stringify(oppositeLayout));
      await phones[0].screenshot({ path: `${output}/versus-opposite-teammate.png` });
      layouts.push({ ...oppositeLayout, visualPositionFixture: true });
      await frames[0].evaluate((original) => {
        for (const [id, position] of original)
          partyEngine.lib.playerOL[id].dataset.position = position;
      }, restore);
      await assertAttached(frames[0]);
      await verifyRegularInquiry(phones[0], frames[0], worker, ownerId, humans);
      await phones[0].setViewportSize({ width: 390, height: 844 });
      const { privateCards, opponents, teams } = await worker.evaluate((id) => {
        const { game, lib } = partyEngine;
        const player = lib.playerOL[id];
        const mate = game.players.find(
          (candidate) => candidate !== player && candidate.side === player.side,
        );
        mate.directgain(
          Array.from({ length: 10 - mate.countCards('h') }, (_, index) =>
            game.createCard('shan', 'heart', 13 - index),
          ),
        );
        return {
          privateCards: mate.getCards('h').map((card) => card.cardid),
          opponents: game.players
            .filter((candidate) => candidate.side !== player.side)
            .map((candidate) => candidate.playerid),
          teams: Object.fromEntries(
            game.players.map((p) => [p.playerid, p.side ? '蓝队' : '红队']),
          ),
        };
      }, ownerId);
      await frames[0].waitForFunction(
        () => document.querySelectorAll('.party-farmer-card').length === 10,
      );
      await assertAttached(frames[0]);
      idleLayout = await sampleIdleHand(frames[0], 'versus');
      firstConfirm = [];
      if (!idleBaseline) {
        await verifyDistantInquiry(frames[0]);
        for (const variant of ['insertion', 'visibility'])
          firstConfirm.push(
            await verifyFirstConfirm(phones[0], frames[0], worker, 'versus', variant),
          );
      }
      for (const frame of frames) {
        if (opponents.includes(await frame.evaluate(() => partyEngine.game.me.playerid)))
          await assertHandPrivate(frame, privateCards);
      }
      await assertObserverPrivate(
        computer,
        `${base}/join/${code}`,
        code,
        matchId,
        privateCards,
        teams,
      );
    } else {
      await verifyRegularInquiry(phones[0], frames[0], worker, ownerId, humans);
    }
    await phones[0].reload();
    frames[0] = await table(phones[0]);
    await assertAttached(frames[0]);
    if (humans === 4) assert.equal(await frames[0].locator('.party-farmer-card').count(), 10);
    results.push({
      humans,
      orderedPair: humans === 2,
      timeoutNativeAi: humans === 1,
      samePoolAndDeadlineAfterRefresh: humans === 2,
      fourUniqueGenerals: true,
      readOnlyTeamHandAndInquiry: true,
      teamHandRestoredOnReload: true,
      ...(firstConfirm ? { firstConfirm, idleLayout, opponentsAndObserverPrivate: true } : {}),
      layouts,
      handCounts: dealt.counts,
    });
    await phones[0].screenshot({ path: `${output}/dealt-${humans}.png` });
    // End this isolated fixture through its private adapter, never a user's room.
    party.lobby.get(code).consoleClose();
    for (const phone of phones) await phone.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual([...missing], []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        physicalPhone: false,
        fixture: true,
        http,
        idleBaseline,
        browser: browser.version(),
        landlord,
        results,
        errors,
        missing: [...missing],
      },
      null,
      2,
    ),
  );
  console.log('2v2真人代选AI：有序双选、同池同期限恢复、超时原生AI、四席真实发牌通过。', output);
} catch (error) {
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify({ error: error.message, errors, missing: [...missing], results }, null, 2),
  );
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  party.closeStreams();
  party.server.closeAllConnections();
  await new Promise((resolve) => party.server.close(resolve));
}
