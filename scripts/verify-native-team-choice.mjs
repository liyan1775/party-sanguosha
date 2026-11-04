import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const party = createPartyServer({
  webRoot: `${root}/dist/web`,
  port: 0,
  adapter: new NativeNonameService(root),
});
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const output = `.runtime/native-team-choice/${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(output, { recursive: true });
const errors = [],
  missing = new Set(),
  contexts = [],
  results = [];
const http = process.env.ENGINE_VERIFY_HTTP === '1';
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
async function table(page) {
  await page.waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
  );
  const frame = page.frames().find((frame) => frame.url().includes('/engine/player/'));
  await frame.waitForFunction(
    () =>
      partyEngine.game.onlineID &&
      partyEngine.game.me?.playerid === partyEngine.game.onlineID &&
      partyEngine.game.players.length === 4,
  );
  return frame;
}
const choosing = (frame) =>
  frame.waitForFunction(
    () => partyEngine._status.event?.name === 'chooseButton' && partyEngine._status.paused,
  );
const offers = (frame) =>
  frame.evaluate(() => partyEngine.ui.dialog.buttons.map((button) => button.link));
try {
  const computer = await page(false);
  await computer.goto(`${base}/server`);
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
    const frames = await Promise.all(phones.map(table));
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
        await frame
          .locator('.control:not(.removing) > div')
          .filter({ hasText: /^确定$/ })
          .first()
          .tap();
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
        await frame
          .locator('.control:not(.removing) > div')
          .filter({ hasText: /^确定$/ })
          .first()
          .tap();
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
    if (humans === 1) {
      // The injected worker-only timeout does not run the phone's timer UI.
      // Restore that phone to its real dealt state before testing presentation.
      await phones[0].reload();
      frames[0] = await table(phones[0]);
    }
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
      await phones[index].screenshot({ path: `${output}/team-hand-${humans}-${index}.png` });
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
    // A real native target inquiry with synthetic text/material setup. The
    // engine owns the choice, its target legality, timer and cancellation.
    await worker.evaluate((id) => {
      const { game, lib, _status } = partyEngine;
      _status.eventManager = new _status.eventManager.constructor();
      _status.eventManager.rootEvent = lib.element.GameEvent.initialGameEvent();
      _status.pauseManager = new _status.pauseManager.constructor();
      const event = new lib.element.GameEvent('partyTeamHandFixture', false, _status.eventManager);
      event.player = lib.playerOL[id];
      event.setContent(async function (event) {
        await event.player
          .chooseTarget(
            '技能询问：请选择另一名角色，或取消；队友手牌仅供查看',
            (_card, player, target) => player !== target,
          )
          .forResult();
      });
      _status.eventManager.rootEvent = event;
      globalThis.partyTeamInquiryDone = false;
      void event.start().then(() => {
        globalThis.partyTeamInquiryDone = true;
      });
    }, ownerId);
    await frames[0].waitForFunction(
      () => partyEngine._status.event.name === 'chooseTarget' && partyEngine._status.paused,
    );
    await wait(350);
    const overlap = await frames[0].locator('#party-farmer-hand').evaluate((node) => {
      if (node.hidden) return false;
      const r = node.getBoundingClientRect();
      return [...document.querySelectorAll('.dialog .content, .prompt, #control')].some((n) => {
        const s = getComputedStyle(n),
          p = n.getBoundingClientRect();
        return (
          s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          p.width &&
          p.height &&
          r.left < p.right &&
          r.right > p.left &&
          r.top < p.bottom &&
          r.bottom > p.top
        );
      });
    });
    assert.equal(overlap, false, '队友牌条不能遮挡原生技能询问');
    assert.equal(await frames[0].evaluate(() => partyEngine.ui.selected.targets.length), 0);
    await phones[0].screenshot({ path: `${output}/team-hand-inquiry-${humans}.png` });
    await frames[0].evaluate(() => partyEngine.ui.click.cancel());
    await worker.waitForFunction(() => globalThis.partyTeamInquiryDone);
    await frames[0].locator('#party-farmer-hand').waitFor();
    await phones[0].reload();
    frames[0] = await table(phones[0]);
    await frames[0].locator('#party-farmer-hand').waitFor();
    results.push({
      humans,
      orderedPair: humans === 2,
      timeoutNativeAi: humans === 1,
      samePoolAndDeadlineAfterRefresh: humans === 2,
      fourUniqueGenerals: true,
      readOnlyTeamHandAndInquiry: true,
      teamHandRestoredOnReload: true,
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
        browser: browser.version(),
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
