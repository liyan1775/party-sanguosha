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
const lobbySelection = process.env.ENGINE_VERIFY_GENERAL_SELECTION === '1';
const testConflict = process.env.ENGINE_VERIFY_VERSUS_CONFLICT === '1';
async function page(mobile) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {},
  );
  const result = await context.newPage();
  await context.route('**/engine/runtime/mode.js', async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    const response = await route.fetch({ headers });
    const source = await response.text();
    let body = source
      .replace(
        'const seats = setup.seats.slice().randomSort();',
        'const seats = setup.seats.slice();',
      )
      .replace(
        'const roles = identities(setup.settings.mode, seats.length);',
        "const roles = identities(setup.settings.mode, seats.length); if (setup.settings.mode === 'identity') roles.sort((a, b) => (b === 'zhu') - (a === 'zhu'));",
      );
    if (process.env.ENGINE_VERIFY_VERSUS_TEAMMATES === '1')
      body = body.replace(
        'const seats = setup.seats.slice();',
        "const seats = setup.seats.slice(); if (setup.settings.mode === 'versus') { const humans = seats.filter(seat => seat.kind === 'human'); const middle = seats.filter(seat => seat !== humans[0] && seat !== humans[1]); seats.splice(0, 4, humans[0], ...middle, humans[1]); }",
      );
    if (process.env.ENGINE_VERIFY_SELECTION_GOD === '1' && !lobbySelection) {
      assert(source.includes('pool.randomRemove(count)'));
      body = body.replace(
        'pool.randomRemove(count)',
        "[game.players.indexOf(player) === 0 ? 'shen_zhaoyun' : 'shen_lvbu']",
      );
    }
    await route.fulfill({
      response,
      body,
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
      document.querySelector('.dialog:not(.removing) .button.character'),
    {},
    { timeout: 15000 },
  );
}
async function retainedTeammateChoice(frame, name) {
  await frame.waitForFunction((name) => {
    const buttons = [...document.querySelectorAll('.dialog:not(.removing) .button.character')];
    const taken = buttons.find((button) => button.link === name);
    return (
      buttons.length === 10 &&
      buttons.filter((button) => button.classList.contains('selectable')).length === 9 &&
      taken?.getAttribute('aria-disabled') === 'true' &&
      taken.querySelector('.party-general-status')?.textContent.includes('队友已选')
    );
  }, name);
  assert(
    await frame.evaluate(() => {
      const state = partyEngine.get.event().partyTeamChoice;
      if (!state.preference) return true;
      const first = document.querySelector('.dialog:not(.removing) .button.character');
      return (
        first?.link === state.preference &&
        first.querySelector('.party-general-status')?.textContent.includes('我的点将')
      );
    }),
    'the private point marker survives live updates and reconnects',
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
    const count =
      mode === 'identity'
        ? Number(process.env.ENGINE_VERIFY_IDENTITY_SEATS ?? 5)
        : { duel: 2, doudizhu: 3, versus: 4 }[mode];
    await request(owner, `/api/rooms/${code}`, 'PUT', {
      mode,
      playerCount: count,
      generalPreset: process.env.ENGINE_VERIFY_PRESET ?? 'beginner',
      allowGeneralSelection: lobbySelection,
      extensions: [],
    });
    await friend.goto(`${origin}/join/${code}`);
    const joined = await request(friend, `/api/rooms/${code}/players`, 'POST', {
      nickname: '等待选择测试',
    });
    await friend.reload();
    const opponents = [];
    if (mode === 'versus' && process.env.ENGINE_VERIFY_VERSUS_HUMANS === '4')
      for (const nickname of ['另一队前手', '另一队后手']) {
        const phone = await page(true);
        await phone.goto(`${origin}/join/${code}`);
        await request(phone, `/api/rooms/${code}/players`, 'POST', { nickname });
        await phone.reload();
        opponents.push(phone);
      }
    const phones = [owner, friend, ...opponents];
    if (count > phones.length)
      await request(owner, `/api/rooms/${code}/bots`, 'POST', { count: count - phones.length });
    const preferences = process.env.ENGINE_VERIFY_SELECTION_GENERALS
      ? process.env.ENGINE_VERIFY_SELECTION_GENERALS.split(',')
      : process.env.ENGINE_VERIFY_SELECTION_GOD === '1'
        ? ['shen_zhaoyun', 'shen_lvbu']
        : process.env.ENGINE_VERIFY_PRESET === 'advanced'
          ? ['re_sunquan', 're_liubei']
          : ['liubei', 'zhaoyun'];
    assert.equal(preferences.length, 2, 'selection probe needs two native general IDs');
    if (lobbySelection)
      for (const [index, phone] of [owner, friend].entries())
        await request(phone, `/api/rooms/${code}/me/general`, 'PUT', {
          general: preferences[index],
        });
    for (const phone of phones) {
      await phone.waitForFunction(() => !document.querySelector('#ready-button')?.disabled);
      await phone.locator('#ready-button').tap();
    }
    await owner.waitForFunction(() => !document.querySelector('#start-button').disabled);
    await owner.locator('#start-button').tap();
    let ownerFrame = await table(owner),
      friendFrame = await table(friend);
    const opponentFrames = await Promise.all(opponents.map(table));
    await choosing(ownerFrame);
    if (mode !== 'identity') await choosing(friendFrame);
    const matchId = party.lobby.get(code).snapshot().matchId;
    const worker = computer
      .frames()
      .find((frame) => frame.url().endsWith(`/engine/worker/${matchId}`));
    assert(worker);
    if (mode === 'identity') {
      assert.equal(await worker.evaluate(() => partyEngine.game.zhu.playerid), created.playerId);
      assert.equal(
        await friendFrame.locator('.dialog:not(.removing) .button.character:visible').count(),
        0,
        'other seats wait for the lord reveal',
      );
      const lords = await worker.evaluate(
        (friendPreference) =>
          partyEngine.proof.roster.filter(
            (name) => partyEngine.lib.character[name].isZhugong && name !== friendPreference,
          ),
        lobbySelection ? preferences[1] : null,
      );
      const lordOffers = await ownerFrame
        .locator('.dialog:not(.removing) .button.character')
        .evaluateAll((buttons) => buttons.map((button) => button.link));
      const scale = (process.env.ENGINE_VERIFY_PRESET ?? 'beginner') === 'beginner' ? 1 : 2;
      assert.equal(lordOffers.length, 5 * scale, 'lord candidate total follows room preset');
      assert.equal(
        lordOffers.filter((name) => lords.includes(name)).length,
        Math.min(lords.length, 3 * scale),
        'available native lords fill their category before random supplementation',
      );
      assert.equal(new Set(lordOffers).size, lordOffers.length);
    }
    await worker.evaluate(async () => {
      const { publicLogText } = await import('/engine/runtime/observer.js');
      const log = partyEngine.game.log;
      partyEngine.proof.observerNativeLogs = 0;
      partyEngine.game.log = function (...args) {
        if (publicLogText(args)) partyEngine.proof.observerNativeLogs++;
        return log.apply(this, args);
      };
      if (partyEngine.setup.settings.mode === 'versus') {
        const { game, get } = partyEngine;
        // Observe real native quantities only; no card values/deck/outcomes.
        partyEngine.proof.versus = { dealt: [], draws: [], deathDraws: [] };
        for (const player of game.players) {
          const directgain = player.directgain;
          player.directgain = function (cards, ...args) {
            if (get.event()?.name === 'gameDraw')
              partyEngine.proof.versus.dealt.push({ seat: this.seatNum, count: cards.length });
            return directgain.call(this, cards, ...args);
          };
          const phaseDraw = player.phaseDraw;
          player.phaseDraw = function (...args) {
            const event = phaseDraw.apply(this, args);
            partyEngine.proof.versus.draws.push({
              seat: this.seatNum,
              turn: game.phaseNumber,
              count: event.num,
            });
            return event;
          };
          const draw = player.draw;
          player.draw = function (...args) {
            const event = get.event();
            if (event?.name === 'versusDraw')
              partyEngine.proof.versus.deathDraws.push({
                count: typeof args[0] === 'number' ? args[0] : 1,
                sameSide: event.getParent('die').player.side === this.side,
              });
            return draw.apply(this, args);
          };
        }
      }
    });
    const delegatedChoice =
      mode === 'versus' &&
      (await ownerFrame.evaluate(() =>
        Boolean(partyEngine._status.event.partyTeamChoice?.aiTeammate),
      ));
    if (delegatedChoice)
      assert.deepEqual(
        await ownerFrame.evaluate(() => partyEngine._status.event.selectButton),
        [2, 2],
      );
    const offers = await ownerFrame
      .locator('.dialog:not(.removing) .button.character')
      .evaluateAll((buttons) => buttons.map((button) => button.link));
    if (mode === 'versus') {
      assert.equal(offers.length, 10, 'the original shared pool stays visible');
      await ownerFrame.waitForFunction(() =>
        document
          .querySelector('.dialog:not(.removing) .caption')
          ?.textContent.includes('你是 1 号位'),
      );
      if (process.env.ENGINE_VERIFY_VERSUS_TEAMMATES === '1') {
        const friendOffers = await friendFrame
          .locator('.dialog:not(.removing) .button.character')
          .evaluateAll((buttons) => buttons.map((button) => button.link));
        assert.equal(friendOffers.length, 10);
        assert(
          offers.every((name) => friendOffers.includes(name)),
          'teammates see the same ten generals before confirming',
        );
        if (opponentFrames.length === 2) {
          const otherOffers = await Promise.all(
            opponentFrames.map((frame) =>
              frame
                .locator('.dialog:not(.removing) .button.character')
                .evaluateAll((buttons) => buttons.map((button) => button.link)),
            ),
          );
          assert(otherOffers.every((pool) => pool.length === 10));
          assert(
            otherOffers[0].every((name) => otherOffers[1].includes(name)),
            'the other team also shares ten generals',
          );
          assert(
            offers.every((name) => !otherOffers[0].includes(name)),
            "teams cannot see or choose each other's pool",
          );
        }
      }
    }
    if (lobbySelection) {
      assert.equal(offers[0], preferences[0], 'lobby preference stays first, including if taken');
      if (mode === 'versus')
        await ownerFrame.waitForFunction((name) => {
          const point = [
            ...document.querySelectorAll('.dialog:not(.removing) .button.character'),
          ].find((button) => button.link === name);
          return point?.querySelector('.party-general-status')?.textContent.includes('我的点将');
        }, preferences[0]);
      assert.equal(
        await ownerFrame.evaluate(() => 'generalSelections' in partyEngine.setup),
        false,
      );
    }
    const oldTime = await ownerFrame.evaluate(() => performance.timeOrigin);
    const choiceDeadline = await worker.evaluate(
      (id) => partyEngine.lib.node.torespondtimeout[id],
      created.playerId,
    );
    const friendDeadline = await worker.evaluate(
      (id) => partyEngine.lib.node.torespondtimeout[id],
      joined.playerId,
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
        .locator('.dialog:not(.removing) .button.character')
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
        .locator('.dialog:not(.removing) .button.character')
        .evaluateAll((buttons) => buttons.map((button) => button.link)),
      offers,
    );
    const conflict = mode === 'versus' && testConflict;
    const crossPreferenceChoice = conflict && lobbySelection;
    const selectableOffers = await ownerFrame
      .locator('.dialog:not(.removing) .button.character.selectable')
      .evaluateAll((buttons) => buttons.map((button) => button.link));
    const chosenGeneral = crossPreferenceChoice ? preferences[1] : selectableOffers[0];
    assert(chosenGeneral, 'at least one unclaimed general is selectable');
    if (conflict) {
      assert.equal(process.env.ENGINE_VERIFY_VERSUS_TEAMMATES, '1');
      assert.equal(opponents.length, 2, 'keep the other team pending while retrying a duplicate');
      // Two genuine native UI confirmations choose the same shared general.
      // Hold the second outgoing result once to reproduce an in-flight race;
      // cards, AI decisions, damage and outcomes remain completely native.
      await friendFrame.evaluate((name) => {
        const { game } = partyEngine;
        const send = game.send;
        let delayed;
        game.send = function (command, ...args) {
          if (command === 'result' && args[0]?.links?.[0] === name) {
            delayed = () => send.call(game, command, ...args);
            game.send = send;
            return;
          }
          return send.call(this, command, ...args);
        };
        partyEngine.flushSharedConflict = () => {
          delayed();
          delete partyEngine.flushSharedConflict;
        };
      }, chosenGeneral);
      // Match the native link exactly; different generals can share a name.
      const conflictIndex = await friendFrame
        .locator('.dialog:not(.removing) .button.character')
        .evaluateAll(
          (buttons, name) => buttons.findIndex((button) => button.link === name),
          chosenGeneral,
        );
      assert(conflictIndex >= 0);
      await friendFrame
        .locator('.dialog:not(.removing) .button.character')
        .nth(conflictIndex)
        .tap();
      await friendFrame
        .locator('.control > div')
        .filter({ hasText: /^确定$/ })
        .first()
        .tap();
    }
    if (process.env.ENGINE_VERIFY_SELECTION_TIMEOUT === '1') {
      // Exercise the exact native timeout actions without waiting 65 seconds;
      // offers/rules/AI remain native, and no cards/HP/outcome are injected.
      await worker.evaluate((id) => {
        const player = partyEngine.lib.playerOL[id];
        player.unwait('ai');
        player.ws.ws.close();
      }, created.playerId);
    } else {
      const index = await ownerFrame
        .locator('.dialog:not(.removing) .button.character')
        .evaluateAll(
          (buttons, name) => buttons.findIndex((button) => button.link === name),
          chosenGeneral,
        );
      assert(index >= 0);
      await ownerFrame.locator('.dialog:not(.removing) .button.character').nth(index).tap();
      if (delegatedChoice) {
        await ownerFrame
          .locator('.dialog:not(.removing) .button.character.selectable:not(.selected)')
          .first()
          .tap();
        assert.equal(await ownerFrame.evaluate(() => partyEngine.ui.selected.buttons.length), 2);
      }
      await ownerFrame
        .locator('.control > div')
        .filter({ hasText: /^确定$/ })
        .first()
        .tap();
    }
    await worker.waitForFunction((id) => {
      const value = partyEngine.lib.node.torespond[id];
      return (
        (value && !value._noname_waiting && value !== '_noname_waiting') ||
        partyEngine.lib.playerOL[id].name
      );
    }, created.playerId);
    if (conflict) {
      await friendFrame.evaluate(() => partyEngine.flushSharedConflict());
      await choosing(friendFrame);
      const remaining = await friendFrame
        .locator('.dialog:not(.removing) .button.character')
        .evaluateAll((buttons) => buttons.map((button) => button.link));
      assert.equal(remaining.length, 10);
      assert(remaining.includes(chosenGeneral), 'the losing submission still sees the taken card');
      await retainedTeammateChoice(friendFrame, chosenGeneral);
      assert.equal(
        await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], joined.playerId),
        friendDeadline,
        'a conflicting result cannot extend the native deadline',
      );
    }
    const teammateVisible =
      mode === 'versus' &&
      process.env.ENGINE_VERIFY_VERSUS_TEAMMATES === '1' &&
      process.env.ENGINE_VERIFY_SELECTION_TIMEOUT !== '1';
    if (teammateVisible) {
      await friendFrame.waitForFunction(
        () =>
          document
            .querySelector('.dialog:not(.removing) .caption')
            ?.textContent.includes('队友是 1 号位（已选') && partyEngine._status.paused,
      );
      const remainingOffers = await friendFrame
        .locator('.dialog:not(.removing) .button.character')
        .evaluateAll((buttons) => buttons.map((button) => button.link));
      assert.equal(remainingOffers.length, 10);
      assert(remainingOffers.includes(chosenGeneral));
      await retainedTeammateChoice(friendFrame, chosenGeneral);
      assert(
        remainingOffers.every((name) => offers.includes(name)),
        'live update retains the entire original shared pool',
      );
      for (const frame of opponentFrames) {
        await choosing(frame);
        assert.match(
          await frame.locator('.dialog:not(.removing) .caption').first().textContent(),
          /正在选将/,
        );
        assert.equal(
          await frame.evaluate(
            (id) => Boolean(partyEngine.lib.playerOL[id].name),
            created.playerId,
          ),
          false,
          'opponents do not receive a confirmed general before the table reveal',
        );
      }
    }
    await owner.reload();
    ownerFrame = await table(owner);
    await ownerFrame.waitForFunction(() => partyEngine._status.gameStarted);
    assert.equal(
      await ownerFrame.locator('.dialog:not(.removing) .button.character:visible').count(),
      0,
      'completed choice is not replayed',
    );
    await friend.reload();
    friendFrame = await table(friend);
    await choosing(friendFrame);
    if (teammateVisible) {
      assert.match(
        await friendFrame.locator('.dialog:not(.removing) .caption').first().textContent(),
        /你是 4 号位，队友是 1 号位（已选/,
        'confirmed teammate survives native selection refresh without restarting the deadline',
      );
      const remainingOffers = await friendFrame
        .locator('.dialog:not(.removing) .button.character')
        .evaluateAll((buttons) => buttons.map((button) => button.link));
      assert.equal(remainingOffers.length, 10);
      assert(remainingOffers.includes(chosenGeneral));
      await retainedTeammateChoice(friendFrame, chosenGeneral);
      assert(
        remainingOffers.every((name) => offers.includes(name)),
        'refresh restores all ten cards and the taken marker',
      );
      assert.equal(
        await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], joined.playerId),
        friendDeadline,
        'teammate update and refresh retain original deadline',
      );
    }
    assert.equal(await friendFrame.evaluate(() => partyEngine.setup.playerId), joined.playerId);
    if (mode === 'identity')
      assert.equal(
        await friendFrame.locator('.dialog:not(.removing) .button.character').count(),
        (process.env.ENGINE_VERIFY_PRESET ?? 'beginner') === 'beginner' ? 3 : 6,
        'non-lord candidate total follows room preset',
      );
    if (lobbySelection) {
      const remainingOffers = await friendFrame
        .locator('.dialog:not(.removing) .button.character')
        .evaluateAll((buttons) => buttons.map((button) => button.link));
      if (mode !== 'versus' || remainingOffers.includes(preferences[1]))
        assert.equal(remainingOffers[0], preferences[1]);
      if (mode === 'identity') {
        assert.equal(
          await friendFrame.evaluate(() => partyEngine.game.zhu.name),
          preferences[0],
          'lord is visible while others choose',
        );
        assert.equal(remainingOffers.includes(preferences[0]), false);
      }
    }
    await friendFrame.locator('.dialog:not(.removing) .button.character.selectable').first().tap();
    if (delegatedChoice)
      await friendFrame
        .locator('.dialog:not(.removing) .button.character.selectable:not(.selected)')
        .first()
        .tap();
    await friendFrame
      .locator('.control > div')
      .filter({ hasText: /^确定$/ })
      .first()
      .tap();
    for (const [index, frame] of opponentFrames.entries()) {
      if (index > 0)
        await frame.waitForFunction(
          () =>
            document.querySelectorAll('.dialog:not(.removing) .button.character.selectable')
              .length === 9,
        );
      await frame.locator('.dialog:not(.removing) .button.character.selectable').first().tap();
      await frame
        .locator('.control > div')
        .filter({ hasText: /^确定$/ })
        .first()
        .tap();
    }
    let groupRecovered = false;
    for (
      let attempt = 0;
      attempt < 100 && !(await worker.evaluate(() => partyEngine.proof.started));
      attempt++
    ) {
      for (const frame of [ownerFrame, friendFrame, ...opponentFrames]) {
        const keep = frame.locator('#party-luck-cards button[data-action="keep"]');
        if (await keep.isVisible()) {
          await keep.tap();
          continue;
        }
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
          const expectedGroups = process.env.ENGINE_VERIFY_SELECTION_GROUPS?.split(',');
          if (expectedGroups)
            assert.deepEqual(
              groups.map((link) => link[2].slice(6)).sort(),
              expectedGroups.slice().sort(),
              'native faction choices follow the current roster',
            );
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
    if (crossPreferenceChoice) {
      assert.equal(
        await worker.evaluate((id) => partyEngine.lib.playerOL[id].name, created.playerId),
        preferences[1],
        "a human can select their teammate's lobby preference",
      );
      assert.equal(
        await worker.evaluate((id) => partyEngine.lib.playerOL[id].name, joined.playerId),
        preferences[0],
      );
    }
    assert.equal(
      await worker.evaluate(
        () => new Set(partyEngine.game.players.map((player) => player.name)).size,
      ),
      count,
    );
    if (process.env.ENGINE_VERIFY_SELECTION_GOD === '1')
      assert(groupRecovered, 'real native group selection reconnected');
    for (const frame of [ownerFrame, friendFrame, ...opponentFrames]) {
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
    if (mode === 'versus') {
      const quantities = await worker.evaluate(() => partyEngine.proof.versus);
      assert.deepEqual(quantities.dealt, [
        { seat: 1, count: 4 },
        { seat: 2, count: 4 },
        { seat: 3, count: 4 },
        { seat: 4, count: 5 },
      ]);
      assert.deepEqual(quantities.draws[0], { seat: 1, turn: 1, count: 1 });
      assert(quantities.draws.slice(1).every((draw) => draw.count === 2));
      assert(quantities.deathDraws.length > 0, 'natural death exercises native teammate reward');
      assert(quantities.deathDraws.every((draw) => draw.count === 1 && draw.sameSide));
      assert.equal(
        await worker.evaluate(() => new Set(partyEngine.game.players.map((p) => p.side)).size),
        1,
        'native completion leaves only the winning side',
      );
    }
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
    for (const phone of opponents) await request(phone, `/api/rooms/${code}/me`, 'DELETE');
    results.push({
      mode,
      seatAndOffersRetained: true,
      completedChoiceNotReplayed: true,
      realDealAndNaturalEnd: true,
      publicHistory: history.length,
      nativeLogCoverage: true,
      deadlineUnchanged: true,
      groupChoiceRecovered: groupRecovered,
      checkedFactionOptions: process.env.ENGINE_VERIFY_SELECTION_GROUPS?.split(','),
      timeoutNativeAI: process.env.ENGINE_VERIFY_SELECTION_TIMEOUT === '1',
      lobbyPointFirst: lobbySelection,
      lordFirstWithNativePool: mode === 'identity',
      identityCandidateCounts: mode === 'identity',
      versusNativeQuantities: mode === 'versus',
      confirmedTeammateRecovered: teammateVisible,
      sharedTeamPool: mode === 'versus',
      takenGeneralRetained: teammateVisible,
      aiTeammateDelegated: delegatedChoice,
      sharedGeneralConflictRecovered: conflict,
      sharedPreferenceExchange: crossPreferenceChoice,
      opponentsChoicePrivate: teammateVisible && opponents.length === 2,
    });
    console.log(mode, 'selection reconnect, native deal and natural end passed');
    await owner.context().close();
    await friend.context().close();
    for (const phone of opponents) await phone.context().close();
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
