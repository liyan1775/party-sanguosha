import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { createPublicGateway } from '../apps/server/src/public-gateway.ts';

// Real native selection/deal, isolated from any running party. Never persist
// private offers, hands, identities, native frames or session credentials.
const root = fileURLToPath(new URL('../', import.meta.url));
const engine = new NativeNonameService(root);
const party = createPartyServer({
  webRoot: `${root}/dist/web`,
  port: 0,
  adapter: engine,
  ...(process.env.ENGINE_VERIFY_SELECTION_PUBLIC === '1' ? { entryMode: 'internet' } : {}),
});
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const gateway =
  process.env.ENGINE_VERIFY_SELECTION_PUBLIC === '1'
    ? createPublicGateway(party.server.address().port)
    : null;
if (gateway) {
  await new Promise((resolve) => gateway.server.listen(0, '127.0.0.1', resolve));
  party.setInternetEntry('ready', '测试公网代理', 'https://selection.trycloudflare.com/');
}
const origin = gateway ? `http://127.0.0.1:${gateway.server.address().port}` : base;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const output = `.runtime/native-selection/${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(output, { recursive: true });
const errors = [],
  results = [];
async function page(mobile) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {},
  );
  const result = await context.newPage();
  if (process.env.ENGINE_VERIFY_SELECTION_GOD === '1')
    await context.route('**/engine/runtime/mode.js', async (route) => {
      const headers = { ...route.request().headers() };
      delete headers['if-none-match'];
      delete headers['if-modified-since'];
      const response = await route.fetch({ headers });
      const source = await response.text();
      assert(source.includes('pool.randomRemove(choiceCount)'));
      await route.fulfill({
        response,
        body: source.replace(
          'pool.randomRemove(choiceCount)',
          "[game.players.indexOf(player) === 0 ? 'shen_zhaoyun' : 'shen_lvbu']",
        ),
      });
    });
  if (process.env.ENGINE_VERIFY_SELECTION_HTTP === '1')
    await context.route('**/engine/setup/**', async (route) => {
      const response = await route.fetch();
      const setup = await response.json();
      setup.playerPolling = true;
      setup.playerStreaming = false;
      await route.fulfill({ response, json: setup });
    });
  result.on('pageerror', (error) => errors.push(error.message));
  result.on('dialog', async (dialog) => {
    errors.push(`unexpected native ${dialog.type()}`);
    await dialog.dismiss();
  });
  if (gateway)
    await context.addInitScript(() => {
      Object.defineProperty(window, 'RTCPeerConnection', { value: undefined });
    });
  return result;
}
async function table(phone) {
  await phone.waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
    {},
    { timeout: 60000 },
  );
  return phone.frames().find((frame) => frame.url().includes('/engine/player/'));
}
async function choosing(frame) {
  await frame.waitForFunction(
    () =>
      partyEngine._status.event?.name === 'chooseButton' &&
      partyEngine._status.paused &&
      document.querySelector('.dialog .button.character'),
    {},
    { timeout: 15000 },
  );
}
async function request(phone, path, method = 'POST', body) {
  return phone.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error(`fixture request failed: ${response.status}`);
      return response.json();
    },
    { path, method, body },
  );
}
try {
  const computer = await page(false);
  await computer.goto(`${base}/server`);
  for (const mode of process.env.ENGINE_VERIFY_MODES?.split(',') ?? [
    'duel',
    'identity',
    'doudizhu',
    'versus',
  ]) {
    const owner = await page(true),
      friend = await page(true);
    await owner.goto(origin);
    const created = await request(owner, '/api/rooms', 'POST', { nickname: '选将恢复测试' });
    const code = created.room.code;
    await owner.goto(`${origin}/join/${code}`);
    const count = { duel: 2, identity: 5, doudizhu: 3, versus: 4 }[mode];
    await request(owner, `/api/rooms/${code}`, 'PUT', {
      mode,
      playerCount: count,
      generalPreset: process.env.ENGINE_VERIFY_PRESET ?? 'beginner',
      extensions: [],
    });
    await friend.goto(`${origin}/join/${code}`);
    const joined = await request(friend, `/api/rooms/${code}/players`, 'POST', {
      nickname: '等待选择测试',
    });
    await friend.reload();
    if (count > 2) await request(owner, `/api/rooms/${code}/bots`, 'POST', { count: count - 2 });
    for (const phone of [owner, friend]) {
      await phone.waitForFunction(() => !document.querySelector('#ready-button')?.disabled);
      await phone.locator('#ready-button').tap();
    }
    await owner.waitForFunction(() => !document.querySelector('#start-button').disabled);
    await owner.locator('#start-button').tap();
    let ownerFrame = await table(owner),
      friendFrame = await table(friend);
    await choosing(ownerFrame);
    await choosing(friendFrame);
    const matchId = party.lobby.get(code).snapshot().matchId;
    const worker = computer
      .frames()
      .find((frame) => frame.url().endsWith(`/engine/worker/${matchId}`));
    assert(worker);
    await worker.evaluate(async () => {
      const { publicLogText } = await import('/engine/runtime/observer.js');
      const log = partyEngine.game.log;
      partyEngine.proof.observerNativeLogs = 0;
      partyEngine.game.log = function (...args) {
        if (publicLogText(args)) partyEngine.proof.observerNativeLogs++;
        return log.apply(this, args);
      };
    });
    const offers = await ownerFrame
      .locator('.dialog .button.character')
      .evaluateAll((buttons) => buttons.map((button) => button.link));
    const oldTime = await ownerFrame.evaluate(() => performance.timeOrigin);
    const choiceDeadline = await worker.evaluate(
      (id) => partyEngine.lib.node.torespondtimeout[id],
      created.playerId,
    );
    // A physical native socket close (or poll DELETE) must retain the pending
    // selection during its original deadline and rebuild the same phone seat.
    await ownerFrame.evaluate(() => partyEngine.game.ws.close());
    await owner.waitForFunction(
      (before) =>
        document.querySelector('#game-frame')?.contentWindow?.performance.timeOrigin > before,
      oldTime,
      { timeout: 15000 },
    );
    ownerFrame = await table(owner);
    await choosing(ownerFrame);
    assert.equal(
      await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], created.playerId),
      choiceDeadline,
      'reconnect retains original deadline',
    );
    assert.deepEqual(
      await ownerFrame
        .locator('.dialog .button.character')
        .evaluateAll((buttons) => buttons.map((button) => button.link)),
      offers,
    );
    assert.equal(await ownerFrame.evaluate(() => partyEngine.setup.playerId), created.playerId);
    assert.equal(party.lobby.get(code).snapshot().matchId, matchId);
    // Repeat with a whole-page refresh, then complete only this player's choice.
    await owner.reload();
    ownerFrame = await table(owner);
    await choosing(ownerFrame);
    assert.deepEqual(
      await ownerFrame
        .locator('.dialog .button.character')
        .evaluateAll((buttons) => buttons.map((button) => button.link)),
      offers,
    );
    if (process.env.ENGINE_VERIFY_SELECTION_TIMEOUT === '1') {
      // Exercise the exact native timeout actions without waiting 65 seconds;
      // offers/rules/AI remain native, and no cards/HP/outcome are injected.
      await worker.evaluate((id) => {
        const player = partyEngine.lib.playerOL[id];
        player.unwait('ai');
        player.ws.ws.close();
      }, created.playerId);
    } else {
      await ownerFrame.locator('.dialog .button.character').first().tap();
      await ownerFrame
        .locator('.control > div')
        .filter({ hasText: /^确定$/ })
        .first()
        .tap();
    }
    await worker.waitForFunction((id) => {
      const value = partyEngine.lib.node.torespond[id];
      return value && !value._noname_waiting && value !== '_noname_waiting';
    }, created.playerId);
    await owner.reload();
    ownerFrame = await table(owner);
    await ownerFrame.waitForFunction(() => partyEngine._status.gameStarted);
    assert.equal(
      await ownerFrame.locator('.dialog .button.character:visible').count(),
      0,
      'completed choice is not replayed',
    );
    await friend.reload();
    friendFrame = await table(friend);
    await choosing(friendFrame);
    assert.equal(await friendFrame.evaluate(() => partyEngine.setup.playerId), joined.playerId);
    await friendFrame.locator('.dialog .button.character').first().tap();
    await friendFrame
      .locator('.control > div')
      .filter({ hasText: /^确定$/ })
      .first()
      .tap();
    let groupRecovered = false;
    for (
      let attempt = 0;
      attempt < 100 && !(await worker.evaluate(() => partyEngine.proof.started));
      attempt++
    ) {
      for (const frame of [ownerFrame, friendFrame]) {
        let groupFrame = frame;
        let buttons = groupFrame
          .locator('.dialog:not(.removing)')
          .filter({ hasText: '请选择你的势力' })
          .locator('.button');
        if (
          !(await buttons.first().isVisible()) ||
          !(await groupFrame.evaluate(
            () => partyEngine._status.event?.name === 'chooseButton' && partyEngine._status.paused,
          ))
        )
          continue;
        if (process.env.ENGINE_VERIFY_SELECTION_GOD === '1' && !groupRecovered) {
          const participant = frame === ownerFrame ? owner : friend;
          // The visible dialog can precede the actual native pause/wait state.
          // Disconnect an outstanding choice, rather than its opening transition.
          await frame.waitForFunction(
            () => partyEngine._status.event?.name === 'chooseButton' && partyEngine._status.paused,
          );
          const playerId = await frame.evaluate(() => partyEngine.setup.playerId);
          await worker.waitForFunction((id) => {
            const waiting = partyEngine.lib.node.torespond[id];
            return waiting === '_noname_waiting' || waiting?._noname_waiting;
          }, playerId);
          const groupDeadline = await worker.evaluate(
            (id) => partyEngine.lib.node.torespondtimeout[id],
            playerId,
          );
          const groups = await buttons.evaluateAll((items) => items.map((item) => item.link));
          const before = await frame.evaluate(() => performance.timeOrigin);
          await frame.evaluate(() => partyEngine.game.ws.close());
          await participant.waitForFunction(
            (before) =>
              document.querySelector('#game-frame')?.contentWindow?.performance.timeOrigin > before,
            before,
          );
          groupFrame = await table(participant);
          buttons = groupFrame
            .locator('.dialog:not(.removing)')
            .filter({ hasText: '请选择你的势力' })
            .locator('.button');
          await buttons.first().waitFor({ state: 'visible' });
          assert.deepEqual(
            await buttons.evaluateAll((items) => items.map((item) => item.link)),
            groups,
          );
          assert.equal(
            await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], playerId),
            groupDeadline,
            'group reconnect retains original deadline',
          );
          if (participant === owner) ownerFrame = groupFrame;
          else friendFrame = groupFrame;
          groupRecovered = true;
        }
        // A reloaded rotated iframe and native dialog animate separately.
        // Wait for the choice and opening transition, then use real touch;
        // never force-click through an occluding table.
        await groupFrame
          .waitForFunction(() => {
            const dialog = [...document.querySelectorAll('.dialog:not(.removing)')].find((node) =>
              node.textContent.includes('请选择你的势力'),
            );
            return (
              partyEngine._status.event?.name === 'chooseButton' &&
              partyEngine._status.paused &&
              dialog &&
              !dialog.style.transitionProperty
            );
          })
          .catch(async (error) => {
            console.log(
              'group replay diagnostic',
              await groupFrame.evaluate(() => ({
                event: partyEngine._status.event?.name,
                paused: partyEngine._status.paused,
                choosing: partyEngine._status.imchoosing,
                dialogs: [...document.querySelectorAll('.dialog:not(.menu):not(.removing)')].map(
                  (node) => ({
                    className: node.className,
                    transition: node.style.transitionProperty,
                  }),
                ),
                errorCount: partyEngine.proof.errors.length,
              })),
            );
            await groupFrame.page().screenshot({ path: `${output}/group-replay-failure.png` });
            throw error;
          });
        await buttons
          .first()
          .tap({ timeout: 5000 })
          .catch(async (error) => {
            await groupFrame.page().screenshot({ path: `${output}/group-click-failure.png` });
            console.log(
              'group layout diagnostic',
              await groupFrame.evaluate(() => {
                const button =
                  [...document.querySelectorAll('.dialog .button')].find((node) =>
                    node.textContent.includes('魏'),
                  ) ?? document.querySelector('.dialog .button');
                const rect = button?.getBoundingClientRect();
                return {
                  event: partyEngine._status.event?.name,
                  paused: partyEngine._status.paused,
                  dialogParents: [...document.querySelectorAll('.dialog')].map((node) => ({
                    parent: node.parentElement?.id,
                    className: node.className,
                    zIndex: getComputedStyle(node).zIndex,
                  })),
                  point: rect
                    ? {
                        x: rect.x + rect.width / 2,
                        y: rect.y + rect.height / 2,
                        stack: document
                          .elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
                          .slice(0, 6)
                          .map((node) => `${node.tagName}#${node.id}.${node.className}`),
                      }
                    : null,
                };
              }),
            );
            throw error;
          });
        await groupFrame
          .locator('.control > div')
          .filter({ hasText: /^确定$/ })
          .first()
          .tap();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await worker.waitForFunction(() => partyEngine.proof.started, {}, { timeout: 20000 });
    if (process.env.ENGINE_VERIFY_SELECTION_GOD === '1')
      assert(groupRecovered, 'real native group selection reconnected');
    for (const frame of [ownerFrame, friendFrame]) {
      await frame.waitForFunction(() => partyEngine.game.me?.countCards('h') > 0);
      await frame.evaluate(() => {
        partyEngine.lib.config.game_speed = 'vvfast';
        partyEngine.lib.config.duration = 100;
        if (!partyEngine._status.auto) partyEngine.ui.click.auto('forced');
      });
    }
    await worker.evaluate(() => {
      partyEngine.lib.config.game_speed = 'vvfast';
      partyEngine.lib.config.duration = 100;
    });
    await worker.waitForFunction(() => partyEngine.proof.ended, {}, { timeout: 150000 });
    const preview = engine.observe(code).observer;
    assert(preview.logTotal > 12, 'public history exceeds the old twelve-action limit');
    const history = [];
    let before;
    do {
      const page = engine.observerLog(code, matchId, before);
      assert(page);
      history.unshift(...page.entries);
      before = page.entries[0]?.sequence;
    } while (before && before > 1);
    assert.equal(history.length, preview.logTotal);
    assert(history.length >= (await worker.evaluate(() => partyEngine.proof.observerNativeLogs)));
    assert.deepEqual(
      history.map((entry) => entry.sequence),
      Array.from({ length: history.length }, (_, index) => index + 1),
    );
    assert(history.some((entry) => entry.text.includes('摸')));
    assert(history.some((entry) => entry.text.includes('伤害') || entry.text.includes('体力')));
    assert.equal(history.at(-1).text, '本局结束');
    // Reload the computer only after natural completion to verify journal
    // persistence and paging in a fresh console. It must not lose past events.
    const read = await computer.evaluate(
      async (path) => (await fetch(path)).json(),
      `/api/console/rooms/${code}/log?match=${matchId}`,
    );
    assert.equal(read.total, history.length);
    const freshConsole = await computer.context().newPage();
    await freshConsole.goto(`${base}/server`);
    await freshConsole.waitForFunction(() =>
      document.querySelector('.observer-log h3')?.textContent.includes('条'),
    );
    await freshConsole.close();
    await computer.waitForFunction(() =>
      document.querySelector('.observer-round')?.textContent.includes('本局已结束'),
    );
    await computer.screenshot({ path: `${output}/${mode}-public-final.png`, fullPage: true });
    assert.equal(party.lobby.get(code).snapshot().matchId, matchId);
    assert.deepEqual(await worker.evaluate(() => partyEngine.proof.errors), []);
    await owner.locator('#rematch-button').tap();
    await owner.locator('#game-frame').waitFor({ state: 'detached' });
    await owner.waitForFunction(() => !document.querySelector('#leave-button').disabled);
    await request(owner, `/api/rooms/${code}/me`, 'DELETE');
    await request(friend, `/api/rooms/${code}/me`, 'DELETE');
    results.push({
      mode,
      seatAndOffersRetained: true,
      completedChoiceNotReplayed: true,
      realDealAndNaturalEnd: true,
      publicHistory: history.length,
      nativeLogCoverage: true,
      deadlineUnchanged: true,
      groupChoiceRecovered: groupRecovered,
      timeoutNativeAI: process.env.ENGINE_VERIFY_SELECTION_TIMEOUT === '1',
    });
    console.log(mode, 'selection reconnect, native deal and natural end passed');
    await owner.context().close();
    await friend.context().close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        browser: 'desktop Edge with mobile viewport',
        transport: gateway
          ? process.env.ENGINE_VERIFY_SELECTION_HTTP === '1'
            ? 'public proxy HTTP'
            : 'public proxy stream/poll'
          : 'LAN WebSocket',
        results,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ output, results }));
} finally {
  await browser.close();
  gateway?.close();
  party.stop();
}
