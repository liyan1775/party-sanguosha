import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

// An isolated desktop fixture: retain the full advanced transformation roster,
// constrain only the two actual character offers, and prepare public equipment
// to exercise native 勇进/旋风. The failure injection never enters the product.
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
const output = `.runtime/native-recovery/${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(output, { recursive: true });
const faults = [];
const deadline = setTimeout(() => void browser.close(), 150000);
async function page(mobile) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {},
  );
  await context.route('**/engine/runtime/mode.js', async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    const response = await route.fetch({ headers });
    const original = await response.text();
    assert(original.includes('pool.randomRemove(choiceCount)'));
    await route.fulfill({
      response,
      body: original.replace(
        'pool.randomRemove(choiceCount)',
        "[player.ws ? 're_zuoci' : 'xin_lingtong']",
      ),
    });
  });
  const result = await context.newPage();
  result.on('pageerror', (error) => {
    if (error.message !== 'party runtime recovery fixture') faults.push(error.message);
  });
  result.on('dialog', async (dialog) => {
    const message = dialog.message().split('\n')[0].slice(0, 160);
    faults.push(`${dialog.type()}: ${message}`);
    console.log('unexpected native dialog', dialog.type(), message);
    await dialog.dismiss();
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
async function publicState(frame) {
  return frame.evaluate(() =>
    [...partyEngine.game.players, ...partyEngine.game.dead]
      .map((player) => ({
        id: player.playerid,
        hp: player.hp,
        dead: player.isDead(),
        equipment: player
          .getCards('e')
          .map((card) => card.name)
          .sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
try {
  const computer = await page(false);
  await computer.goto(`${base}/server`);
  const phone = await page(true);
  let loads = 0;
  phone.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/engine/player/')) loads++;
  });
  await phone.goto(base);
  const created = await phone.evaluate(async () =>
    (
      await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: '牌桌恢复测试' }),
      })
    ).json(),
  );
  const code = created.room.code;
  await phone.goto(`${base}/join/${code}`);
  await phone.evaluate(async (code) => {
    for (const [path, method, body] of [
      [
        `/api/rooms/${code}`,
        'PUT',
        { mode: 'duel', playerCount: 2, generalPreset: 'advanced', extensions: [] },
      ],
      [`/api/rooms/${code}/bots`, 'POST', { count: 1 }],
    ]) {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Could not configure isolated test room');
    }
  }, code);
  await phone.waitForFunction(() => !document.querySelector('#ready-button').disabled);
  await phone.locator('#ready-button').tap();
  await phone.waitForFunction(() => !document.querySelector('#start-button').disabled);
  await phone.locator('#start-button').tap();
  let frame = await table(phone);
  await computer.waitForFunction(() =>
    [...document.querySelectorAll('.engine-worker')].some(
      (frame) => frame.contentWindow?.partyEngine?.proof.booted,
    ),
  );
  const worker = computer.frames().find((frame) => frame.url().includes('/engine/worker/'));
  await chooseGeneral(frame, worker);
  await worker.waitForFunction(() => partyEngine.proof.started);
  await frame.waitForFunction(() => partyEngine.game.me?.countCards('h') > 0);
  const originalMatch = party.lobby.get(code).snapshot().matchId;
  assert.equal(await frame.evaluate(() => partyEngine.game.me.name), 're_zuoci');
  assert.equal(
    await worker.evaluate(() => partyEngine.game.players.find((player) => !player.ws).name),
    'xin_lingtong',
  );
  // An exception after the real deal must rebuild only the phone.
  const firstLoads = loads;
  const firstTime = await frame.evaluate(() => performance.timeOrigin);
  await frame.evaluate(() => {
    setTimeout(() => {
      throw new Error('party runtime recovery fixture');
    }, 0);
  });
  await phone.waitForFunction(
    (before) => {
      const win = document.querySelector('#game-frame')?.contentWindow;
      return win?.performance.timeOrigin > before && win.partyEngine?.game.me?.name === 're_zuoci';
    },
    firstTime,
    { timeout: 30000 },
  );
  frame = await table(phone);
  assert(loads > firstLoads, 'runtime error reloaded the phone');
  assert.equal(party.lobby.get(code).snapshot().matchId, originalMatch);
  assert.equal(await frame.evaluate(() => partyEngine.setup.playerId), created.playerId);
  console.log('runtime exception restored the same native seat');
  // Gameplay choices now survive the injected disconnect. Wait for the replay
  // (e.g. native Huashen) before toggling auto, rather than toggling during reinit.
  await frame
    .waitForFunction(() => partyEngine._status.imchoosing && partyEngine._status.paused)
    .catch(async (error) => {
      console.log(
        'replayed choice diagnostic',
        await frame.evaluate(() => ({
          event: partyEngine._status.event?.name,
          paused: partyEngine._status.paused,
          paused2: partyEngine._status.paused2,
          choosing: partyEngine._status.imchoosing,
          auto: partyEngine._status.auto,
          dialogs: document.querySelectorAll('.dialog:not(.menu):not(.removing)').length,
          buttons: document.querySelectorAll('.dialog:not(.menu):not(.removing) .button').length,
          errorCount: partyEngine.proof.errors.length,
        })),
      );
      console.log(
        'rule choice diagnostic',
        await worker.evaluate(() => ({
          event: partyEngine._status.event?.name,
          paused: partyEngine._status.paused,
          waiting: Object.values(partyEngine.lib.node.torespond).filter(
            (value) => value === '_noname_waiting' || value?._noname_waiting,
          ).length,
        })),
      );
      await phone.screenshot({ path: `${output}/replayed-choice-failure.png` });
      throw error;
    });
  // Stop native updates at the real 勇进 animation; lobby SSE and RTT continue.
  await frame.evaluate(() => {
    const socket = partyEngine.game.ws;
    const receive = socket.onmessage;
    socket.onmessage = function (event) {
      if (event.data.includes('$fullscreenpop') && event.data.includes('勇进'))
        globalThis.partyIgnoredNativeFrames = 1;
      if (globalThis.partyIgnoredNativeFrames) {
        globalThis.partyIgnoredNativeFrames++;
        return;
      }
      return receive.call(this, event);
    };
    partyEngine.lib.config.game_speed = 'vvfast';
    partyEngine.lib.config.duration = 100;
    if (!partyEngine._status.auto) partyEngine.ui.click.auto('forced');
  });
  await worker.waitForFunction(
    () => partyEngine.game.players.find((player) => player.name === 're_zuoci')?.isAuto,
  );
  await worker.evaluate(() => {
    const { game, lib } = partyEngine;
    lib.config.game_speed = 'vvfast';
    lib.config.duration = 100;
    const probe = game.createEvent('partyYongjinRecoveryFixture', false);
    probe.setContent(async function () {
      const { game, lib } = globalThis.partyEngine;
      const ling = game.players.find((player) => player.name === 'xin_lingtong');
      const zuo = game.players.find((player) => player.name === 're_zuoci');
      await zuo.equip(game.createCard('dawan', 'spade', 13));
      await ling.equip(game.createCard('jueying', 'spade', 5));
      await zuo.equip(game.createCard('zhuge', 'club', 1));
      ling.hp = 1;
      ling.update();
      await ling.useSkill('yongjin');
      globalThis.partyEngine.proof.recoveryYongjinComplete = true;
    });
  });
  await frame
    .waitForFunction(() => globalThis.partyIgnoredNativeFrames > 0, {}, { timeout: 60000 })
    .catch(async (error) => {
      console.log(
        'fixture status',
        await worker.evaluate(() => ({
          event: partyEngine._status.event?.name,
          skill: partyEngine._status.event?.skill,
          parent: partyEngine._status.event?.getParent()?.name,
          paused: partyEngine._status.paused,
          skillCompleted: !!partyEngine.proof.recoveryYongjinComplete,
          ended: partyEngine.proof.ended,
          errorCount: partyEngine.proof.errors.length,
          waiting: Object.values(partyEngine.lib.node.torespond).filter(
            (value) => value === '_noname_waiting' || value?._noname_waiting,
          ).length,
        })),
      );
      await phone.screenshot({ path: `${output}/fixture-failure.png` });
      throw error;
    });
  console.log('native updates intentionally interrupted at yongjin');
  const stalledTime = await frame.evaluate(() => performance.timeOrigin);
  await worker.waitForFunction(() => partyEngine.proof.recoveryYongjinComplete);
  await phone.screenshot({ path: `${output}/stalled-table.png` });
  await worker.waitForFunction(() => partyEngine.proof.ended, {}, { timeout: 90000 });
  console.log('rule worker completed the native game');
  const finalState = await publicState(worker);
  assert(
    finalState.some((player) => player.dead),
    'native game ended after a real death',
  );
  await phone.waitForFunction(
    (before) => {
      const win = document.querySelector('#game-frame')?.contentWindow;
      return win?.performance.timeOrigin > before && win.partyEngine?.game.me?.name === 're_zuoci';
    },
    stalledTime,
    { timeout: 30000 },
  );
  frame = await table(phone);
  await frame.waitForFunction(() => partyEngine._status.gameStarted);
  await phone.waitForTimeout(1500);
  assert.deepEqual(
    await publicState(frame),
    finalState,
    'fresh native reinit restores final HP and equipment',
  );
  assert.equal(await frame.evaluate(() => partyEngine.setup.playerId), created.playerId);
  assert.equal(party.lobby.get(code).snapshot().matchId, originalMatch);
  assert.equal(await computer.locator('.engine-worker').count(), 1);
  assert.deepEqual(faults, []);
  await phone.screenshot({ path: `${output}/synchronized-final.png` });
  const result = {
    browser: 'desktop Edge with mobile viewport',
    fixture: 'prepared equipment and HP; native yongjin/xuanfeng; suppressed player updates',
    runtimeErrorRecovered: true,
    sameSeatAndMatch: true,
    nativeYongjinCompleted: true,
    finalNativeStateRestored: true,
    pageErrors: faults,
  };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  await phone.locator('#rematch-button').tap();
  await phone.waitForFunction(() => !document.querySelector('#game-frame'));
  console.log(JSON.stringify({ output, ...result }));
} finally {
  clearTimeout(deadline);
  await browser.close();
  party.stop();
}
