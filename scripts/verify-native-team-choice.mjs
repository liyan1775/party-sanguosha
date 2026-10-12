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
  return page.frames().find((frame) => frame.url().includes('/engine/player/'));
}
const choosing = (frame) =>
  frame.waitForFunction(
    () => partyEngine._status.event.name === 'chooseButton' && partyEngine._status.paused,
  );
const offers = (frame) =>
  frame.evaluate(() => partyEngine.ui.dialog.buttons.map((button) => button.link));
try {
  const computer = await page(false);
  await computer.goto(`${base}/server`);
  for (const humans of [2, 1]) {
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
    if (humans === 2) {
      await phones[1].goto(`${base}/join/${code}`);
      await phones[1].locator('#nickname').fill('另一队验证');
      await phones[1].locator('#join-button').tap();
    }
    await request(phones[0], `/api/rooms/${code}/bots`, 'POST', { count: 4 - humans });
    for (const [index, phone] of phones.entries()) {
      await request(phone, `/api/rooms/${code}/me/general`, 'PUT', {
        general: index ? 'zhaoyun' : 'liubei',
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
      [2, 2],
    );
    const selected = [];
    if (humans === 2) {
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
            return own.name === pair[0] && ally.name === pair[1];
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
    results.push({
      humans,
      orderedPair: humans === 2,
      timeoutNativeAi: humans === 1,
      samePoolAndDeadlineAfterRefresh: humans === 2,
      fourUniqueGenerals: true,
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
