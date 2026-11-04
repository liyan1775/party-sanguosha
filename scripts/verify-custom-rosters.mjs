// SPDX-License-Identifier: GPL-3.0-only
// Run after npm run build: node --import tsx scripts/verify-custom-rosters.mjs
// E2E_BROWSER_CHANNEL=msedge, ENGINE_VERIFY_MODES=duel,doudizhu,versus,identity
// ENGINE_VERIFY_PRESET=beginner|advanced, ENGINE_VERIFY_HUMANS=1|2
// Uses an isolated ephemeral service; never touches the running party instance.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { RosterLibrary } from '../apps/server/src/roster-library.ts';
import { chooseGeneral, completeDoudizhuPregame } from './native-ui-actions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}/.runtime/custom-rosters/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
await mkdir(output, { recursive: true });
const modes = process.env.ENGINE_VERIFY_MODES?.split(',') ?? [
  'duel',
  'doudizhu',
  'versus',
  'identity',
];
assert(modes.every((mode) => ['duel', 'doudizhu', 'versus', 'identity'].includes(mode)));
const preset = process.env.ENGINE_VERIFY_PRESET ?? 'beginner';
const humans = Number(process.env.ENGINE_VERIFY_HUMANS ?? 1);
assert(['beginner', 'advanced'].includes(preset));
assert([1, 2].includes(humans));
const expectedPile = preset === 'beginner' ? 108 : 160;
const crossGeneral = preset === 'beginner' ? 're_zhangliao' : 'caocao';
const adapter = new NativeNonameService(root);
assert(adapter.status().preload, 'Verified fixed native engine resources are required');
const party = createPartyServer({
  webRoot: `${root}/dist/web`,
  port: 0,
  adapter,
  rosterDirectory: `${output}/library`,
});
await new Promise((done) => party.server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${party.server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const faults = [],
  missing = new Set();
const results = [];
async function page(mobile = false) {
  const context = await browser.newContext(
    mobile
      ? {
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
          userAgent:
            'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.50',
        }
      : {},
  );
  const view = await context.newPage();
  view.on('pageerror', () => faults.push('pageerror'));
  view.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /\b(?:TypeError|SyntaxError|ReferenceError):/.test(message.text())
    )
      faults.push('native-error');
  });
  view.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && path.startsWith('/engine/')) missing.add(path);
  });
  return view;
}
async function api(phone, path, method = 'GET', body) {
  return phone.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(`Custom roster API failed (${response.status}) at ${path.split('?')[0]}`);
      return response.json();
    },
    { path, method, body },
  );
}
async function workerFor(computer, phone) {
  await phone.waitForFunction(
    () =>
      document
        .querySelector('#game-frame')
        ?.contentWindow?.location.pathname.startsWith('/engine/player/'),
    {},
    { timeout: 120000 },
  );
  const frame = phone.frames().find((frame) => frame.url().includes('/engine/player/'));
  const id = frame.url().split('/').at(-1);
  await computer.waitForFunction(
    (id) =>
      [...document.querySelectorAll('.engine-worker')].some(
        (frame) => frame.src.endsWith(id) && frame.contentWindow?.partyEngine?.proof.hostReady,
      ),
    id,
    { timeout: 120000 },
  );
  return {
    frame,
    id,
    worker: computer.frames().find((frame) => frame.url().endsWith(`/engine/worker/${id}`)),
  };
}
async function privateHandProof(frame, worker) {
  const viewer = await frame.evaluate(() => partyEngine.game.me.playerid);
  const ids = await worker.evaluate((viewer) => {
    const player = partyEngine.lib.playerOL[viewer];
    return partyEngine.game.players
      .filter((other) => other !== player)
      .filter(
        (other) =>
          !(
            partyEngine.setup.farmerHandSharing &&
            (partyEngine.setup.settings.mode === 'versus'
              ? other.side === player.side
              : player.identity === 'fan' && other.identity === 'fan')
          ),
      )
      .flatMap((other) => other.getCards('h'))
      .filter((card) => !card.isKnownBy(player))
      .map((card) => card.cardid);
  }, viewer);
  const proof = await frame.evaluate(
    (ids) => ({
      ownCards: partyEngine.game.me.getCards('h').filter((card) => card.name !== 'party_unknown')
        .length,
      hiddenCards: partyEngine.game.players
        .filter((player) => player !== partyEngine.game.me)
        .flatMap((player) => player.getCards('h'))
        .filter((card) => ids.includes(card.cardid)).length,
      exposedValues: partyEngine.game.players
        .filter((player) => player !== partyEngine.game.me)
        .flatMap((player) => player.getCards('h'))
        .filter(
          (card) =>
            ids.includes(card.cardid) &&
            (card.name !== 'party_unknown' || card.suit !== 'none' || card.number !== 0),
        ).length,
    }),
    ids,
  );
  assert(proof.ownCards > 0, 'client receives its own real dealt hand');
  assert.equal(proof.exposedValues, 0, 'opponent private names/suits/numbers remain concealed');
  if (humans === 2 && modes.length === 1 && modes[0] === 'duel')
    assert(proof.hiddenCards > 0, 'both independent clients contain concealed opponent cards');
  return proof;
}
async function finishNative(phones, worker, frames) {
  await worker.evaluate(() => {
    partyEngine.lib.config.game_speed = 'vvfast';
    partyEngine.lib.config.duration = 100;
  });
  await Promise.all(
    frames.map((frame) =>
      frame.evaluate(() => {
        partyEngine.lib.config.game_speed = 'vvfast';
        partyEngine.lib.config.duration = 100;
        if (!partyEngine._status.auto) partyEngine.ui.click.auto();
      }),
    ),
  );
  // Only native AI and animation settings change; cards, skills, HP and winner stay authoritative.
  await worker.waitForFunction(() => partyEngine.proof.ended, {}, { timeout: 600000 });
  const proof = await worker.evaluate(() => ({
    ended: partyEngine.proof.ended,
    turns: partyEngine.game.phaseNumber,
    errors: partyEngine.proof.errors.length,
    cardUses: [...partyEngine.game.players, ...partyEngine.game.dead].reduce(
      (sum, player) => sum + player.getAllHistory('useCard').length,
      0,
    ),
  }));
  assert(proof.ended);
  assert.equal(proof.errors, 0);
  assert(proof.cardUses > 0);
  await phones[0].locator('#rematch-button').waitFor({ state: 'visible', timeout: 20000 });
  return proof;
}
try {
  const computer = await page();
  await computer.goto(`${origin}/server`);
  const presets = JSON.parse(await readFile(`${root}/config/roster-presets.json`, 'utf8')).presets;
  // Inherit the original preset's deck/rules and add one reviewed cross-preset native ID.
  const characters = [...presets.find((entry) => entry.id === preset).characters, crossGeneral];
  for (const mode of modes) {
    const phone = await page(true);
    const phones = [phone];
    await phone.goto(origin);
    await phone.locator('#nickname').fill('自定义将池验收');
    await phone.locator('#create-button').tap();
    await phone.waitForURL(/\/join\/[A-F0-9]{6}$/);
    const code = new URL(phone.url()).pathname.split('/').at(-1);
    await phone.locator('#ready-button').waitFor();
    const saved = (
      await api(phone, `/api/rooms/${code}/rosters`, 'POST', {
        name: `自定义跨池-${mode}`,
        basePreset: preset,
        characters,
      })
    ).roster;
    assert.equal(saved.revision, 1);
    const ref = { id: saved.id, revision: saved.revision };
    const persisted = new RosterLibrary(`${output}/library`).resolve(ref.id, ref.revision);
    assert.deepEqual(
      persisted.characters,
      characters,
      'saved pool survives an independent library reload',
    );
    const playerCount = { duel: 2, doudizhu: 3, versus: 4, identity: 5 }[mode];
    await api(phone, `/api/rooms/${code}`, 'PUT', {
      mode,
      playerCount,
      generalPreset: preset,
      customRoster: ref,
      allowGeneralSelection: true,
      extensions: [],
    });
    for (let index = 1; index < humans; index++) {
      const friend = await page(true);
      phones.push(friend);
      await friend.goto(`${origin}/join/${code}`);
      await friend.locator('#nickname').fill(`独立真人${index + 1}`);
      await friend.locator('#join-button').tap();
      await friend.locator('#ready-button').waitFor();
    }
    const seats = await Promise.all(phones.map((participant) => api(participant, '/api/me')));
    assert.equal(
      new Set(seats.map((seat) => seat.playerId)).size,
      humans,
      'independent browser contexts own distinct player sessions',
    );
    if (playerCount > humans)
      await api(phone, `/api/rooms/${code}/bots`, 'POST', { count: playerCount - humans });
    await api(phone, `/api/rooms/${code}/me/general`, 'PUT', { general: crossGeneral });
    const preload = await api(
      phone,
      `/engine/preload?preset=${preset}&mode=${mode}&roster=${ref.id}&revision=${ref.revision}`,
    );
    assert(preload.assets.some((path) => path.endsWith('/character/refresh.js')));
    const rounds = [];
    for (let round = 1; round <= 2; round++) {
      for (const participant of phones) {
        await participant.waitForFunction(() => !document.querySelector('#ready-button')?.disabled);
        await participant.locator('#ready-button').tap();
      }
      await phone.waitForFunction(() => !document.querySelector('#start-button')?.disabled);
      await phone.locator('#start-button').tap();
      let pregameRestored = false;
      if (mode === 'doudizhu') {
        await phone.locator('#doudizhu-panel').waitFor({ state: 'visible' });
        // AI bidders may finish immediately; either the owner's bid or choice is stable.
        await phone.waitForFunction(() =>
          [
            ...document.querySelectorAll(
              '#doudizhu-bids button, .doudizhu-seat button[data-general]',
            ),
          ].some((button) => !button.disabled && button.getClientRects().length),
        );
        const before = await api(phone, `/api/rooms/${code}/me/doudizhu`);
        await phone.reload();
        await phone.locator('#doudizhu-panel').waitFor({ state: 'visible' });
        const after = await api(phone, `/api/rooms/${code}/me/doudizhu`);
        assert.deepEqual(after.seats, before.seats);
        assert.equal(after.preparation.deadline, before.preparation.deadline);
        pregameRestored = true;
        await completeDoudizhuPregame(phones, code);
      }
      let { frame, id, worker } = await workerFor(computer, phone);
      const effective = await worker.evaluate(() => ({
        characters: partyEngine.setup.preset.characters,
        pile: partyEngine.setup.preset.cardPile.cardCount,
        ref: partyEngine.setup.settings.customRoster,
        customDigest: partyEngine.setup.customRoster.digest,
      }));
      assert.deepEqual(effective.characters, characters);
      assert.equal(effective.pile, expectedPile);
      assert.deepEqual(effective.ref, ref);
      assert.equal(effective.customDigest, persisted.digest);
      const selectionRecovery = await Promise.all(
        phones.map(async (participant) => {
          let { frame: client } = await workerFor(computer, participant);
          if (mode !== 'doudizhu') {
            await client.waitForFunction(
              () =>
                partyEngine._status.event?.name === 'chooseButton' && partyEngine._status.paused,
              {},
              { timeout: 120000 },
            );
            const candidates = await client
              .locator('.dialog:not(.removing) .button.character')
              .evaluateAll((buttons) => buttons.map((button) => button.link).sort());
            assert(candidates.length > 0);
            assert(candidates.every((id) => characters.includes(id)));
            if (participant === phone)
              assert(
                candidates.includes(crossGeneral),
                'lobby cross-preset preference remains in the real native candidate offer',
              );
            await participant.reload();
            ({ frame: client } = await workerFor(computer, participant));
            await client.waitForFunction(
              () =>
                partyEngine._status.event?.name === 'chooseButton' && partyEngine._status.paused,
              {},
              { timeout: 30000 },
            );
            const restored = await client
              .locator('.dialog:not(.removing) .button.character')
              .evaluateAll((buttons) => buttons.map((button) => button.link).sort());
            assert.deepEqual(
              restored,
              candidates,
              'reconnect must preserve the original candidate offer',
            );
            if (participant === phone && mode === 'duel') {
              const buttons = client.locator('.dialog:not(.removing) .button.character.selectable');
              const index = await buttons.evaluateAll(
                (buttons, general) => buttons.findIndex((button) => button.link === general),
                crossGeneral,
              );
              assert(index >= 0, 'cross-preset native character remains selectable');
              await buttons.nth(index).tap();
              await client
                .locator('.control:not(.removing) > div')
                .filter({ hasText: /^确定$/ })
                .first()
                .tap();
            }
          }
          await chooseGeneral(client, worker);
          return true;
        }),
      );
      pregameRestored ||= selectionRecovery.every(Boolean);
      await worker.waitForFunction(() => partyEngine.proof.started, {}, { timeout: 120000 });
      let frames = (
        await Promise.all(phones.map((participant) => workerFor(computer, participant)))
      ).map((result) => result.frame);
      await Promise.all(
        frames.map((client) =>
          client.waitForFunction(
            () => partyEngine.game.me?.name && partyEngine.game.me.countCards('h') > 0,
          ),
        ),
      );
      const before = await Promise.all(
        frames.map((client) =>
          client.evaluate(() => ({
            seat: partyEngine.game.me.playerid,
            general: partyEngine.game.me.name,
            match: partyEngine.setup.id,
          })),
        ),
      );
      const privacyBefore = await Promise.all(
        frames.map((client) => privateHandProof(client, worker)),
      );
      const selected = await worker.evaluate(() =>
        partyEngine.game.players.map((player) => player.name),
      );
      assert(selected.every((id) => characters.includes(id)));
      if (mode === 'duel')
        assert.equal(
          before[0].general,
          crossGeneral,
          'real UI selected the added cross-preset character',
        );
      for (const [index, participant] of phones.entries())
        await participant.screenshot({
          path: `${output}/${mode}-${round}-client${index + 1}-dealt.png`,
        });
      await Promise.all(phones.map((participant) => participant.reload()));
      frames = (
        await Promise.all(phones.map((participant) => workerFor(computer, participant)))
      ).map((result) => result.frame);
      await Promise.all(
        frames.map((client) =>
          client.waitForFunction(
            () => partyEngine.game.me?.name && partyEngine.game.ws.readyState === 1,
            {},
            { timeout: 30000 },
          ),
        ),
      );
      const after = await Promise.all(
        frames.map((client) =>
          client.evaluate(() => ({
            seat: partyEngine.game.me.playerid,
            general: partyEngine.game.me.name,
            match: partyEngine.setup.id,
          })),
        ),
      );
      assert.deepEqual(after, before, 'dealt native seat and selected general must recover');
      const privacyAfter = await Promise.all(
        frames.map((client) => privateHandProof(client, worker)),
      );
      const proof = await finishNative(phones, worker, frames);
      for (const [index, participant] of phones.entries())
        await participant.screenshot({
          path: `${output}/${mode}-${round}-client${index + 1}-settlement.png`,
        });
      for (const participant of [...phones.slice(1), phone]) {
        await participant.frameLocator('#game-frame').locator('#party-return-room').tap();
        await participant.locator('#game-frame').waitFor({ state: 'detached' });
      }
      await phone.locator('#ready-button').waitFor();
      rounds.push({
        round,
        matchChanged: round === 1 || id !== rounds[0].matchId,
        matchId: id,
        pregameRestored,
        dealt: true,
        restored: true,
        poolSize: effective.characters.length,
        humanClients: humans,
        cardPileCount: expectedPile,
        lobbyPreferenceOffered: true,
        crossPresetCharacterPlayed: mode === 'duel',
        privacyBefore,
        privacyAfter,
        ...proof,
      });
      if (round === 2) assert.notEqual(rounds[0].matchId, id);
    }
    results.push({ mode, rounds });
    for (const participant of phones) await participant.locator('#leave-button').tap();
    await Promise.all(phones.map((participant) => participant.context().close()));
    console.log(
      `${mode}: custom pool saved via API, native selection/deal/recovery and two natural settlements passed`,
    );
  }
  assert.equal(faults.length, 0, 'browser and native execution errors');
  assert.equal(missing.size, 0, 'engine resource failures');
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        browser: browser.version(),
        physicalPhone: false,
        preset,
        humanClients: humans,
        persistedLibraryReload: true,
        savedWithoutServiceRestart: true,
        faults: faults.length,
        missing: missing.size,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`Custom roster evidence: ${output}`);
} finally {
  await browser.close();
  const closed = once(party.server, 'close');
  party.stop();
  party.server.closeAllConnections();
  await closed;
}
