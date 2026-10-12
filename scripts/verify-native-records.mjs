import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

// Real selection/dealing, then an isolated native phaseDraw for 涉猎. No
// invented cards, pile order, damage, winner or altered skill implementation.
const root = fileURLToPath(new URL('../', import.meta.url));
const engine = new NativeNonameService(root);
const events = [];
const failedMatches = new Set();
let closedPollResponses = 0;
engine.subscribe((event) => {
  events.push(event);
  if (event.type === 'failed') failedMatches.add(engine.matchId(event.roomCode));
});
const party = createPartyServer({ webRoot: `${root}/dist/web`, port: 0, adapter: engine });
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const desktop = process.env.ENGINE_VERIFY_DESKTOP === '1';
const http = process.env.ENGINE_VERIFY_HTTP === '1';
const gesture = desktop ? 'click' : 'tap';
const output = `.runtime/native-records/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
await mkdir(output, { recursive: true });
const contexts = [],
  phones = [],
  frames = [],
  faults = [],
  missing = new Set();
let worker, computer;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function progress(value) {
  console.log(value);
  await writeFile(
    `${output}/progress.json`,
    JSON.stringify({ value, at: new Date().toISOString() }),
  );
}
async function page(phone = false) {
  const context = await browser.newContext(
    phone ? { viewport: { width: 844, height: 390 }, isMobile: !desktop, hasTouch: !desktop } : {},
  );
  contexts.push(context);
  if (phone && http)
    await context.addInitScript(() => sessionStorage.setItem('party_http_transport', '1'));
  if (!phone)
    await context.route('**/engine/runtime/mode.js', async (route) => {
      const response = await route.fetch(),
        source = await response.text();
      assert(source.includes('const seats = setup.seats.slice().randomSort();'));
      assert(source.includes('await game.phaseLoop(first);'));
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
  const value = await context.newPage();
  const poll = (target) => {
    const original = target.waitForFunction.bind(target);
    target.waitForFunction = (fn, arg, options) => original(fn, arg, { polling: 100, ...options });
  };
  poll(value);
  value.on('frameattached', poll);
  value.on('pageerror', (error) => faults.push(error.message));
  value.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    const poll = /^\/engine\/poll\/([\w-]+)$/.exec(path);
    // A deliberately interrupted match revokes its private polling endpoint;
    // record that expected rejection separately from missing game resources.
    if (response.status() === 403 && poll && failedMatches.has(poll[1])) {
      closedPollResponses++;
      return;
    }
    if (response.status() >= 400) missing.add(path);
  });
  return value;
}
async function request(phone, path, method, body) {
  return phone.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`${response.status}: ${path}`);
      return response.json();
    },
    { path, method, body },
  );
}
async function table(phone) {
  await phone.waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
  );
  return phone.frames().find((frame) => frame.url().includes('/engine/player/'));
}
const confirm = (frame) =>
  frame
    .locator('.control:not(.removing) > div')
    .filter({ hasText: /^确定$/ })
    .first();
try {
  await progress('real-selection-and-dealing');
  computer = await page();
  await computer.goto(`${base}/server`);
  await computer.waitForFunction(
    async () => (await (await fetch('/api/info')).json()).engine.ready,
  );
  for (let i = 0; i < 4; i++) phones.push(await page(true));
  await phones[0].goto(base);
  const created = await request(phones[0], '/api/rooms', 'POST', { nickname: '涉猎验证' });
  const code = created.room.code;
  await phones[0].goto(`${base}/join/${code}`);
  await request(phones[0], `/api/rooms/${code}`, 'PUT', {
    mode: 'versus',
    playerCount: 4,
    generalPreset: 'ol-doudizhu-s15',
    allowGeneralSelection: true,
    extensions: [],
  });
  for (let i = 1; i < 4; i++) {
    await phones[i].goto(`${base}/join/${code}`);
    await phones[i].locator('#nickname').fill(`记录验证${i}`);
    await phones[i].locator('#join-button')[gesture]();
  }
  for (const [i, general] of ['shen_lvmeng', 're_xuzhu', 're_zhaoyun', 're_guojia'].entries())
    await request(phones[i], `/api/rooms/${code}/me/general`, 'PUT', { general });
  for (const phone of phones) await phone.locator('#ready-button')[gesture]();
  await phones[0].locator('#start-button')[gesture]();
  for (const phone of phones) frames.push(await table(phone));
  worker = computer.frames().find((frame) => frame.url().includes('/engine/worker/'));
  await Promise.all(frames.map((frame) => chooseGeneral(frame, worker, { mouse: desktop })));
  await worker.waitForFunction(() => partyEngine.proof.started && partyEngine._status.paused);
  const matchId = party.lobby.get(code).snapshot().matchId;
  const runtime = engine.matches.get(matchId);
  assert.equal(await worker.evaluate(() => partyEngine.game.players[0].name), 'shen_lvmeng');
  const initialCount = await worker.evaluate(() => partyEngine.ui.cardPile.childElementCount);
  await phones[0].waitForFunction(
    (count) =>
      document
        .querySelector('#game-frame')
        .contentDocument.querySelector('#party-table-count')
        ?.textContent.endsWith(`剩余牌: ${count}`),
    initialCount,
  );

  await progress('native-shelie-and-rule-reconnection');
  await worker.evaluate(() => {
    const { game, lib, _status } = partyEngine;
    for (const timer of Object.values(lib.node.torespondtimeout)) clearTimeout(timer);
    lib.node.torespond = {};
    lib.node.torespondtimeout = {};
    _status.eventManager = new _status.eventManager.constructor();
    _status.eventManager.rootEvent = lib.element.GameEvent.initialGameEvent();
    _status.pauseManager = new _status.pauseManager.constructor();
    globalThis.partyRecordsProbe = { shown: [], shownIds: [], done: false };
    const show = lib.element.Player.prototype.showCards;
    lib.element.Player.prototype.showCards = function (cards, ...args) {
      if (this === game.players[0]) {
        partyRecordsProbe.shown = cards.map((card) => partyEngine.get.translation(card));
        partyRecordsProbe.shownIds = cards.map((card) => card.cardid);
      }
      return show.call(this, cards, ...args);
    };
    const event = new lib.element.GameEvent('partyRecordsFixture', false, _status.eventManager);
    event.player = game.players[0];
    event.setContent(async function (event) {
      await event.player.phaseDraw();
      partyRecordsProbe.done = true;
    });
    _status.eventManager.rootEvent = event;
    void event.start().catch((error) => {
      partyRecordsProbe.error = error.message;
    });
  });
  await frames[0].waitForFunction(
    () => partyEngine._status.event.name === 'chooseBool' && partyEngine._status.paused,
  );
  await confirm(frames[0])[gesture]();
  await frames[0].waitForFunction(
    () =>
      partyEngine._status.event.name === 'chooseButton' &&
      partyEngine._status.paused &&
      partyEngine.ui.dialog?.buttons?.length === 5,
  );
  const choice = await worker.evaluate(() => ({
    event: partyEngine._status.event.id,
    timers: Object.values(partyEngine.lib.node.torespondtimeout),
  }));
  const beforeRecovery = events.filter((event) => event.type === 'recovered').length;
  // Interrupt both local wires without replacing the authoritative iframe.
  runtime.host.terminate();
  runtime.clock.terminate();
  for (
    let i = 0;
    i < 100 && events.filter((event) => event.type === 'recovered').length === beforeRecovery;
    i++
  )
    await wait(100);
  assert(events.filter((event) => event.type === 'recovered').length > beforeRecovery);
  assert.equal(party.lobby.get(code).snapshot().phase, 'playing');
  assert.equal(party.lobby.get(code).snapshot().matchId, matchId);
  assert.deepEqual(
    await worker.evaluate(() => ({
      event: partyEngine._status.event.id,
      timers: Object.values(partyEngine.lib.node.torespondtimeout),
    })),
    choice,
    'same choice and original timeout IDs',
  );
  await wait(1500);
  for (let i = 0; i < phones.length; i++) frames[i] = await table(phones[i]);
  await frames[0].waitForFunction(
    () =>
      partyEngine._status.event.name === 'chooseButton' &&
      partyEngine._status.paused &&
      partyEngine.ui.dialog?.buttons?.length === 5,
  );
  const suits = await frames[0].evaluate(() => {
    const { ui, get } = partyEngine;
    for (const button of ui.dialog.buttons) button.dataset.qaSuit = get.suit(button.link);
    return [...new Set(ui.dialog.buttons.map((button) => get.suit(button.link)))];
  });
  for (const suit of suits)
    await frames[0]
      .locator(`.dialog:not(.removing) .button[data-qa-suit="${suit}"]`)
      .first()
      [gesture]();
  await confirm(frames[0])[gesture]();
  await worker.waitForFunction(() => partyRecordsProbe.done);
  const shown = await worker.evaluate(() => partyRecordsProbe.shown);
  assert.equal(shown.length, 5);
  const history = await request(phones[1], `/engine/history/${matchId}`, 'GET');
  assert(
    shown.every((face) => history.entries.some((entry) => entry.text.includes(face))),
    'all five native shown faces remain in the public journal',
  );
  assert(history.entries.some((entry) => entry.text.includes('涉猎')));
  for (const phone of phones) {
    await phone.locator('#match-records')[gesture]();
    await phone.waitForFunction(
      (faces) =>
        faces.every((face) =>
          document
            .querySelector('#match-records-dialog .observer-recent')
            ?.textContent.includes(face),
        ),
      shown,
    );
    await phone.getByRole('button', { name: '关闭本局记录' })[gesture]();
  }
  await phones[1].reload();
  frames[1] = await table(phones[1]);
  await phones[1].locator('#match-records')[gesture]();
  await phones[1].waitForFunction(
    (faces) =>
      faces.every((face) =>
        document
          .querySelector('#match-records-dialog .observer-recent')
          ?.textContent.includes(face),
      ),
    shown,
  );
  await phones[1].screenshot({ path: `${output}/records.png` });
  await phones[1].getByRole('button', { name: '关闭本局记录' })[gesture]();

  await progress('native-read-only-details');
  const position = await frames[1].evaluate(
    () => partyEngine.game.players.find((player) => player.name === 'shen_lvmeng').dataset.position,
  );
  const name = frames[1].locator(`.player[data-position="${position}"] .name`).first();
  if (desktop) await name.click({ button: 'right' });
  else {
    const touch = await phones[1].context().newCDPSession(phones[1]);
    const box = await name.boundingBox();
    assert(box);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await wait(650);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await wait(650);
  await frames[1].getByText('查看资料', { exact: true })[gesture]();
  await frames[1].locator('.charactercard').waitFor({ state: 'visible' });
  assert.equal(await frames[1].locator('.charactercard .ban, .charactercard .fav').count(), 0);
  await frames[1].locator('.charactercard .skillButton')[gesture]();
  await frames[1]
    .locator('.charactercard .characterskill > div')
    .filter({ hasText: /^涉猎$/ })
    .first()
    [gesture]();
  assert((await frames[1].locator('.charactercard .intro2').innerText()).includes('亮出五张牌'));
  assert.equal(await frames[1].evaluate(() => partyEngine.ui.click.configMenu), undefined);
  await phones[1].screenshot({ path: `${output}/details.png` });
  // Reloading the private view closes details without touching the rule iframe.
  await phones[1].reload();
  frames[1] = await table(phones[1]);
  const currentCount = await worker.evaluate(() => partyEngine.ui.cardPile.childElementCount);
  await frames[1].waitForFunction(
    () => partyEngine.game.me?.name && Object.keys(partyEngine.lib.playerOL).length === 4,
  );
  await phones[1].waitForFunction(
    (count) =>
      document
        .querySelector('#game-frame')
        .contentDocument.querySelector('#party-table-count')
        ?.textContent.endsWith(`剩余牌: ${count}`),
    currentCount,
  );
  const publicIds = await worker.evaluate(() => partyRecordsProbe.shownIds);
  for (const frame of frames)
    assert(
      await frame.evaluate(
        (shownIds) =>
          partyEngine.game.players
            .filter((player) => player !== partyEngine.game.me)
            .every((player) =>
              player
                .getCards('h')
                .every(
                  (card) =>
                    shownIds.includes(card.cardid) ||
                    card.isKnownBy(partyEngine.game.me) ||
                    card.name === 'party_unknown',
                ),
            ),
        publicIds,
      ),
      'Opponent hand faces must be concealed unless natively known or publicly shown by 涉猎',
    );

  await progress('actual-20-second-rule-outage');
  await worker.evaluate(() => {
    partyEngine.ruleSocket.connect = () => {};
  });
  runtime.host.terminate();
  await phones[0]
    .locator('#match-connection-title')
    .filter({ hasText: '电脑规则连接中断，正在恢复' })
    .waitFor({ state: 'visible' });
  assert.equal(party.lobby.get(code).snapshot().phase, 'playing');
  await phones[0]
    .locator('#match-connection-title')
    .filter({ hasText: '本局中断 · 未判胜负' })
    .waitFor({ state: 'visible', timeout: 25000 });
  assert.equal(party.lobby.get(code).snapshot().phase, 'finished');
  assert.equal(party.lobby.get(code).snapshot().matchFailure.code, 'worker-disconnected');
  assert.equal(party.lobby.get(code).snapshot().players.length, 4);
  for (const phone of phones) {
    assert(await phone.locator('#game-frame').count());
    await phone
      .locator('#match-connection-title')
      .filter({ hasText: '本局中断 · 未判胜负' })
      .waitFor({ state: 'visible' });
  }
  await phones[0].screenshot({ path: `${output}/interrupted.png` });
  const memberId = await frames[1].evaluate(() => partyEngine.game.me.playerid);
  await phones[1].locator('#rematch-button')[gesture]();
  assert.equal(party.lobby.get(code).snapshot().phase, 'finished');
  assert(
    party.lobby
      .get(code)
      .snapshot()
      .players.some((player) => player.id === memberId),
  );
  await phones[0].locator('#rematch-button')[gesture]();
  for (const phone of phones) await phone.locator('#ready-button').waitFor({ state: 'visible' });
  assert.equal(party.lobby.get(code).snapshot().phase, 'waiting');
  assert.deepEqual(faults, []);
  assert.deepEqual([...missing], []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        fixture: true,
        physicalPhone: false,
        browser: browser.version(),
        http,
        input: desktop ? 'mouse' : 'touch',
        actualDealing: true,
        nativeShelie: true,
        shownCardsRemembered: 5,
        refreshRetainsRecords: true,
        readOnlyDetails: true,
        sameWorkerRecovery: true,
        originalChoiceDeadlineRetained: true,
        actualOutageSeconds: 20,
        interruptedMatchRequiresExplicitReturn: true,
        concealedHands: true,
        closedPollResponses,
        faults,
        missing: [...missing],
      },
      null,
      2,
    ),
  );
  console.log('原生记录、只读资料和规则恢复验证通过', output);
} catch (error) {
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: error.stack,
        faults,
        missing: [...missing],
        progress: await worker
          ?.evaluate(() => ({
            event: partyEngine._status.event.name,
            errors: partyEngine.proof.errors,
          }))
          .catch(() => null),
      },
      null,
      2,
    ),
  );
  for (const [i, phone] of phones.entries())
    await phone.screenshot({ path: `${output}/failure-${i}.png` }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  engine.close();
  party.closeStreams();
  party.server.closeAllConnections();
  await new Promise((resolve) => party.server.close(resolve));
}
