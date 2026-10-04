import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral, playOneAction } from './native-ui-actions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const party = process.env.ENGINE_VERIFY_EXISTING_URL
  ? null
  : createPartyServer({
      webRoot: `${root}/dist/web`,
      port: 0,
      adapter: new NativeNonameService(root),
    });
if (party) await new Promise((resolve) => party.server.listen(0, '0.0.0.0', resolve));
const port = party
  ? party.server.address().port
  : Number(new URL(process.env.ENGINE_VERIFY_EXISTING_URL).port);
const lan = Object.values(networkInterfaces())
  .flat()
  .find(
    (address) =>
      address?.family === 'IPv4' &&
      !address.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address),
  )?.address;
assert(lan, 'LAN IPv4 is required');
const origin = process.env.ENGINE_VERIFY_EXISTING_URL ?? `http://${lan}:${port}`;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const faults = [],
  missing = new Set(),
  external = new Set(),
  contexts = [];
const artifactRoot = `.runtime/native-runtime/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
await mkdir(artifactRoot, { recursive: true });

async function page(mobile) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } : {},
  );
  contexts.push(context);
  await context.route('**/*', async (route) => {
    if (![origin, `http://127.0.0.1:${port}`].includes(new URL(route.request().url()).origin)) {
      external.add(route.request().url());
      await route.abort();
    } else if (
      process.env.ENGINE_VERIFY_GOD_FIXTURE === '1' &&
      route.request().url().includes('/engine/setup/')
    ) {
      const response = await route.fetch();
      const setup = await response.json();
      setup.preset = {
        completePacks: [],
        packGroups: { extra: [] },
        additionalCharacters: ['shen_zhaoyun', 'shen_lvbu'],
      };
      await route.fulfill({ response, json: setup });
    } else await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    faults.push(String(error));
    console.log('browser error:', String(error).slice(0, 300));
  });
  page.on('dialog', async (dialog) => {
    faults.push(dialog.message());
    console.log('unexpected dialog:', dialog.message().slice(0, 150));
    await dialog.dismiss();
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/api/me')) {
      missing.add(new URL(response.url()).pathname);
      console.log('HTTP', response.status(), new URL(response.url()).pathname);
    }
  });
  return page;
}
const results = [];
try {
  const computer = await page(false);
  await computer.goto(`http://127.0.0.1:${port}/server`);
  const modes = process.env.ENGINE_VERIFY_MODES?.split(',') ?? [
    'duel',
    'identity',
    'doudizhu',
    'versus',
  ];
  for (const mode of modes) {
    const phone = await page(true);
    const phones = [phone];
    await phone.goto(origin);
    const created = await phone.evaluate(async () => {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: '玩家 <测试>' }),
      });
      return response.json();
    });
    const code = created.room.code;
    await phone.goto(`${origin}/join/${code}`);
    await phone.waitForFunction(
      () =>
        document.querySelector('#ready-button') &&
        !document.querySelector('#ready-button').disabled,
    );
    const playerCount =
      mode === 'identity'
        ? Number(process.env.ENGINE_VERIFY_IDENTITY_SEATS ?? 5)
        : { duel: 2, doudizhu: 3, versus: 4 }[mode];
    const humanCount = Math.min(playerCount, Number(process.env.ENGINE_VERIFY_HUMANS ?? 1));
    await phone.evaluate(
      async ({ code, mode, playerCount, preset }) => {
        const base = `/api/rooms/${code}`;
        for (const [path, method, body] of [
          [base, 'PUT', { mode, playerCount, generalPreset: preset, extensions: [] }],
        ]) {
          const response = await fetch(path, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!response.ok) throw new Error(await response.text());
        }
      },
      { code, mode, playerCount, preset: process.env.ENGINE_VERIFY_PRESET ?? 'beginner' },
    );
    for (let index = 1; index < humanCount; index++) {
      const friend = await page(true);
      phones.push(friend);
      await friend.goto(`${origin}/join/${code}`);
      await friend.locator('#nickname').fill(`朋友 ${index}`);
      await friend.locator('#join-button').tap();
      await friend.locator('#ready-button').waitFor({ state: 'visible' });
    }
    if (playerCount > humanCount)
      await phone.evaluate(
        async ({ code, count }) => {
          const response = await fetch(`/api/rooms/${code}/bots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count }),
          });
          if (!response.ok) throw new Error(await response.text());
        },
        { code, count: playerCount - humanCount },
      );
    for (const participant of phones) {
      await participant.waitForFunction(() => !document.querySelector('#ready-button').disabled);
      await participant.locator('#ready-button').tap();
    }
    await phone.locator('#start-button').waitFor({ state: 'visible' });
    await phone.waitForFunction(() => !document.querySelector('#start-button').disabled);
    await phone.locator('#start-button').tap();
    await phone.locator('#game-frame').waitFor({ state: 'visible', timeout: 15000 });
    await phone.waitForFunction(() =>
      document
        .querySelector('#game-frame')
        ?.contentWindow?.location.pathname.startsWith('/engine/player/'),
    );
    const gameFrame = phone.frames().find((frame) => frame.url().includes('/engine/player/'));
    assert(gameFrame);
    const currentMatch = gameFrame.url().split('/').at(-1);
    await computer.waitForFunction(
      (id) =>
        [...document.querySelectorAll('.engine-worker')].some(
          (frame) => frame.src.endsWith(id) && frame.contentWindow?.partyEngine?.proof.hostReady,
        ),
      currentMatch,
      { timeout: 20000 },
    );
    const worker = computer
      .frames()
      .find((frame) => frame.url().endsWith(`/engine/worker/${currentMatch}`));
    assert(worker);
    const gameFrames = [];
    for (const participant of phones) {
      await participant.waitForFunction(() =>
        document
          .querySelector('#game-frame')
          ?.contentWindow?.location.pathname.startsWith('/engine/player/'),
      );
      gameFrames.push(
        participant.frames().find((frame) => frame.url().includes('/engine/player/')),
      );
    }
    await Promise.all(gameFrames.map((frame) => chooseGeneral(frame, worker)));
    await worker.waitForFunction(() => partyEngine.proof.started, {}, { timeout: 25000 });
    await gameFrame
      .locator('.dialog .button.character')
      .first()
      .waitFor({ state: 'detached', timeout: 5000 });
    // Let the native selection/deal transition finish before measuring the UI.
    await gameFrame.waitForTimeout(750);
    const initial = await gameFrame.evaluate(() => {
      const { game } = partyEngine;
      return {
        ownCards: game.me.getCards('h').filter((card) => card.name !== 'party_unknown').length,
        concealedValues: game.players
          .filter((player) => player !== game.me)
          .flatMap((player) => player.getCards('h'))
          .filter(
            (card) => card.name !== 'party_unknown' || card.suit !== 'none' || card.number !== 0,
          ).length,
        identities: game.players.map((player) => ({
          self: player === game.me,
          identity: player.identity,
          shown: player.identityShown,
        })),
        secure: isSecureContext,
        ownId: game.me.playerid,
        layout: {
          viewport: [innerWidth, innerHeight],
          zoom: game.documentZoom,
          body: [document.body.offsetWidth, document.body.offsetHeight],
          bodyOrigin: [
            document.body.getBoundingClientRect().x,
            document.body.getBoundingClientRect().y,
          ],
          arenaClass: partyEngine.ui.arena.className,
          arenaOrigin: [
            partyEngine.ui.arena.getBoundingClientRect().x,
            partyEngine.ui.arena.getBoundingClientRect().y,
          ],
          players: game.players.map((player) => {
            const rect = player.getBoundingClientRect();
            return {
              self: player === game.me,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          }),
        },
      };
    });
    assert.equal(initial.secure, false);
    assert.equal(initial.ownId, created.playerId);
    assert(initial.ownCards > 0, 'own hand is visible');
    assert.equal(initial.concealedValues, 0, 'opponent concealed values are filtered');
    for (const player of initial.layout.players) {
      assert(player.x >= -1 && player.y >= -1, 'player portrait stays inside the viewport');
      assert(
        player.x + player.width <= initial.layout.viewport[0] + 1,
        'portrait fits horizontally',
      );
      assert(
        player.y + player.height <= initial.layout.viewport[1] + 1,
        'portrait fits vertically',
      );
    }
    const encodedPrivacy = await worker.evaluate((playerId) => {
      const { lib, game, get } = partyEngine;
      const viewer = lib.playerOL[playerId];
      const hidden = game.players
        .filter((player) => player !== viewer)
        .flatMap((player) => player.getCards('h'))
        .find((card) => !card.isKnownBy(viewer));
      const own = viewer.getCards('h')[0];
      if (!hidden || !own) throw new Error('Privacy probe requires real concealed and owned cards');
      const original = [hidden.name, hidden.suit, hidden.number];
      // Native GameEvent.send encodes its parent before entering Client.send.
      const event =
        '_noname_event:' +
        JSON.stringify({
          hidden: get.cardInfoOL(hidden),
          raw: get.cardInfo(hidden),
          own: get.cardInfoOL(own),
          states: game.getState?.() ?? {},
        });
      const client = viewer.ws;
      const send = client.ws.send;
      let captured;
      client.ws.send = (payload) => {
        captured = JSON.parse(payload);
      };
      try {
        client.send('privacy-probe', event);
      } finally {
        client.ws.send = send;
      }
      const encoded = JSON.parse(captured[1].slice('_noname_event:'.length));
      const hiddenInfo = JSON.parse(encoded.hidden.slice('_noname_card:'.length));
      const ownInfo = JSON.parse(encoded.own.slice('_noname_card:'.length));
      return {
        encodedHiddenMasked:
          hiddenInfo[1] === 'none' && hiddenInfo[2] === 0 && hiddenInfo[3] === 'party_unknown',
        rawHiddenMasked:
          encoded.raw[0] === 'none' && encoded.raw[1] === 0 && encoded.raw[2] === 'party_unknown',
        ownVisible: ownInfo[3] === own.name && ownInfo[1] === own.suit && ownInfo[2] === own.number,
        sourceUnchanged: original.every(
          (value, index) => value === [hidden.name, hidden.suit, hidden.number][index],
        ),
        identitiesMasked:
          partyEngine.setup.settings.mode !== 'identity' ||
          Object.entries(encoded.states).every(
            ([id, state]) =>
              id === viewer.playerid ||
              lib.playerOL[id]?.identityShown ||
              state.identity === 'unknown',
          ),
      };
    }, created.playerId);
    for (const [check, passed] of Object.entries(encodedPrivacy)) assert(passed, check);
    const seatProof = await worker.evaluate(() => ({
      count: partyEngine.game.players.length,
      hostInSeats: partyEngine.game.players.includes(partyEngine.game.me),
      chars: partyEngine.game.players.map((player) => player.name),
      rosterLength: partyEngine.proof.roster.length,
      additionalPresent: partyEngine.setup.preset.additionalCharacters.every((name) =>
        partyEngine.proof.roster.includes(name),
      ),
      ...(partyEngine.setup.settings.mode === 'doudizhu'
        ? {
            landlord: {
              hp: partyEngine.game.zhu.maxHp,
              characterHp: partyEngine.get.character(partyEngine.game.zhu.name).maxHp,
              feiyang: partyEngine.game.zhu.hasSkill('feiyang'),
              bahu: partyEngine.game.zhu.hasSkill('bahu'),
            },
          }
        : {}),
    }));
    assert.equal(seatProof.hostInSeats, false);
    assert.equal(seatProof.count, playerCount);
    assert.equal(
      seatProof.rosterLength,
      process.env.ENGINE_VERIFY_GOD_FIXTURE === '1'
        ? 2
        : process.env.ENGINE_VERIFY_PRESET === 'advanced'
          ? 156
          : 33,
    );
    assert(seatProof.additionalPresent);
    if (mode === 'doudizhu') {
      assert.equal(seatProof.landlord.hp, seatProof.landlord.characterHp + 1);
      assert(seatProof.landlord.feiyang && seatProof.landlord.bahu);
    }
    await phone.screenshot({ path: `${artifactRoot}/${mode}-playing.png` });
    if (process.env.ENGINE_VERIFY_MANUAL === '1') await playOneAction(gameFrames, worker);
    if (process.env.ENGINE_VERIFY_RECONNECT) {
      if (process.env.ENGINE_VERIFY_RECONNECT === 'socket') {
        await gameFrame.evaluate(() => {
          globalThis.partyReconnectOld = true;
          partyEngine.game.ws.close();
        });
        await phone.waitForFunction(
          () =>
            document.querySelector('#game-frame')?.contentWindow?.partyEngine &&
            !document.querySelector('#game-frame').contentWindow.partyReconnectOld,
        );
      } else await phone.reload();
      await phone.waitForFunction(
        () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.game.me?.playerid,
      );
      const resumed = phone.frames().find((frame) => frame.url().includes('/engine/player/'));
      await resumed.waitForFunction(
        () =>
          partyEngine.game.me?.name &&
          Object.keys(partyEngine.lib.playerOL).length >= partyEngine.setup.seats.length,
        {},
        { timeout: 20000 },
      );
      const reconnectProof = await resumed.evaluate(() => ({
        ownId: partyEngine.game.me.playerid,
        ownHand: partyEngine.game.me.getCards('h').map((card) => card.name),
        hiddenLeak: partyEngine.game.players
          .filter((player) => player !== partyEngine.game.me)
          .flatMap((player) => player.getCards('h'))
          .some((card) => card.name !== 'party_unknown'),
      }));
      assert.equal(reconnectProof.ownId, created.playerId);
      assert.equal(reconnectProof.hiddenLeak, false);
      console.log(mode, 'same-seat refresh reconnected');
    }
    const activeGames = phones.map((participant) =>
      participant.frames().find((frame) => frame.url().includes('/engine/player/')),
    );
    await worker.evaluate(() => {
      partyEngine.lib.config.game_speed = 'vvfast';
    });
    for (const activeGame of activeGames) {
      await activeGame.evaluate(() => {
        partyEngine.lib.config.game_speed = 'vvfast';
      });
      await activeGame.evaluate(() => partyEngine.ui.click.auto());
    }
    for (
      let elapsed = 0;
      elapsed < 360 && !(await worker.evaluate(() => partyEngine.proof.ended));
      elapsed += 20
    ) {
      await worker
        .waitForFunction(() => partyEngine.proof.ended, {}, { timeout: 20000 })
        .catch((error) => {
          if (error.name !== 'TimeoutError') throw error;
        });
      if (!(await worker.evaluate(() => partyEngine.proof.ended)))
        console.log(
          mode,
          'native turn progress',
          await worker.evaluate(() => ({
            turns: partyEngine.game.phaseNumber,
            alive: partyEngine.game.players.length,
            errors: partyEngine.proof.errors,
          })),
        );
    }
    assert(await worker.evaluate(() => partyEngine.proof.ended), 'native game must finish');
    await phone.locator('#rematch-button').waitFor({ state: 'visible', timeout: 5000 });
    const ended = await worker.evaluate(() => ({
      errors: partyEngine.proof.errors,
      alive: partyEngine.game.players.length,
      hostInSeats: [...partyEngine.game.players, ...partyEngine.game.dead].includes(
        partyEngine.game.me,
      ),
      cardUses: partyEngine.game.getAllGlobalHistory('useCard').length,
    }));
    assert(ended.cardUses > 0);
    assert.equal(ended.hostInSeats, false);
    assert.deepEqual(ended.errors, []);
    await phone.locator('#rematch-button').tap();
    await phone.locator('#game-frame').waitFor({ state: 'detached' });
    if (process.env.ENGINE_VERIFY_SECOND_ROUND === '1') {
      for (const participant of phones) await participant.locator('#ready-button').tap();
      await phone.waitForFunction(() => !document.querySelector('#start-button').disabled);
      await phone.locator('#start-button').tap();
      await phone.waitForFunction(() =>
        document
          .querySelector('#game-frame')
          ?.contentWindow?.location.pathname.startsWith('/engine/player/'),
      );
      const secondId = phone
        .frames()
        .find((frame) => frame.url().includes('/engine/player/'))
        .url()
        .split('/')
        .at(-1);
      assert.notEqual(secondId, currentMatch);
      await computer.waitForFunction(
        (id) =>
          [...document.querySelectorAll('.engine-worker')].some(
            (frame) => frame.src.endsWith(id) && frame.contentWindow?.partyEngine?.proof.hostReady,
          ),
        secondId,
      );
      const nextWorker = computer
        .frames()
        .find((frame) => frame.url().endsWith(`/engine/worker/${secondId}`));
      const nextFrames = phones.map((participant) =>
        participant.frames().find((frame) => frame.url().includes('/engine/player/')),
      );
      await Promise.all(nextFrames.map((frame) => chooseGeneral(frame, nextWorker)));
      await nextWorker.waitForFunction(() => partyEngine.proof.started);
      await nextWorker.evaluate(() => {
        partyEngine.lib.config.game_speed = 'vvfast';
      });
      for (const frame of nextFrames)
        await frame.evaluate(() => {
          partyEngine.lib.config.game_speed = 'vvfast';
          partyEngine.ui.click.auto();
        });
      for (
        let elapsed = 0;
        elapsed < 360 && !(await nextWorker.evaluate(() => partyEngine.proof.ended));
        elapsed += 20
      ) {
        await nextWorker
          .waitForFunction(() => partyEngine.proof.ended, {}, { timeout: 20000 })
          .catch((error) => {
            if (error.name !== 'TimeoutError') throw error;
          });
      }
      assert(await nextWorker.evaluate(() => partyEngine.proof.ended));
      await phone.locator('#rematch-button').tap();
      await phone.locator('#game-frame').waitFor({ state: 'detached' });
      console.log(mode, 'second native game completed in the same room');
    }
    await phone.locator('#leave-button').tap();
    for (const friend of phones.slice(1)) await friend.locator('#leave-button').tap();
    results.push({ mode, initial, encodedPrivacy, seatProof, ended });
    console.log(mode, 'completed native game and returned to lobby');
  }
  assert.deepEqual(faults, []);
  assert.deepEqual([...missing], []);
  assert.deepEqual([...external], []);
  const parameters = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith('ENGINE_VERIFY_')),
  );
  const variant = [
    process.env.ENGINE_VERIFY_PRESET ?? 'beginner',
    process.env.ENGINE_VERIFY_MODES?.replaceAll(',', '-') ?? 'all-modes',
    `${process.env.ENGINE_VERIFY_IDENTITY_SEATS ?? 5}seats`,
    `${process.env.ENGINE_VERIFY_HUMANS ?? 1}humans`,
    process.env.ENGINE_VERIFY_MANUAL === '1' ? 'touch' : 'auto',
    process.env.ENGINE_VERIFY_SECOND_ROUND === '1' ? 'rematch' : '',
    process.env.ENGINE_VERIFY_RECONNECT ? `reconnect-${process.env.ENGINE_VERIFY_RECONNECT}` : '',
    process.env.ENGINE_VERIFY_GOD_FIXTURE === '1' ? 'god-fixture' : '',
    party ? 'source' : 'portable',
  ]
    .filter(Boolean)
    .join('-');
  await writeFile(
    `${artifactRoot}/result-${variant}.json`,
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        parameters,
        results,
        missing: [...missing],
        external: [...external],
      },
      null,
      2,
    ),
  );
  console.log(`Verified artifacts: ${artifactRoot}`);
} catch (error) {
  for (const context of contexts)
    for (const page of context.pages())
      for (const frame of page.frames()) {
        if (frame.url().includes('/engine/'))
          console.log(
            'native diagnostic',
            await frame
              .evaluate(() =>
                globalThis.partyEngine
                  ? {
                      role: partyEngine.setup.role,
                      configMode: partyEngine.lib.config.mode,
                      splash: partyEngine.get.config('show_splash'),
                      allModes: partyEngine.lib.config.all.mode,
                      booted: partyEngine.proof.booted,
                      errors: partyEngine.proof.errors,
                      event: partyEngine._status.event?.name,
                      importedMode: Object.keys(partyEngine.lib.imported.mode ?? {}),
                    }
                  : 'not booted',
              )
              .catch(() => 'closed'),
          );
      }
  for (let i = 0; i < contexts.length; i++)
    for (const page of contexts[i].pages())
      await page.screenshot({ path: `${artifactRoot}/failure-${i}.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  party?.stop();
}
