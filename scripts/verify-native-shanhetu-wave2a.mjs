// SPDX-License-Identifier: GPL-3.0-only
// Headless desktop/phone-viewport acceptance against the pinned native engine.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { shanhetuRecipe } from '../packages/noname-adapter/src/shanhetu.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scenarios = [
  {
    battleId: 2635,
    difficulty: 2,
    chapter: 2,
    skill: 'party_shanhetu_ly_14101',
    kind: 'dragon-guard',
    companions: [997103, 997105, 997110, 997116],
  },
  {
    battleId: 2669,
    difficulty: 2,
    chapter: 3,
    skill: 'party_shanhetu_spearman_entry',
    kind: 'spearman',
    companions: [],
  },
  {
    battleId: 2637,
    difficulty: 24,
    chapter: 2,
    skill: 'party_shanhetu_inferno_damage',
    companions: [],
  },
];
const output = `${root}/.runtime/shanhetu-native/${new Date().toISOString().replaceAll(/[:.]/g, '-')}-wave2a`;
await mkdir(output, { recursive: true });
const adapter = new NativeNonameService(root);
assert(adapter.status().preload, 'Complete fixed native resources are required');
const party = createPartyServer({
  webRoot: `${root}/dist/web`,
  port: 0,
  adapter,
  shanhetuDirectory: `${output}/book`,
  rosterDirectory: `${output}/rosters`,
});
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${party.server.address().port}`;
let browser;
const results = [];
const faults = [];
const missing = new Set();
const events = [];
const browserErrors = [];
let computer;
const unsubscribe = adapter.subscribe((event) => {
  if (event.type !== 'status') events.push(event);
});

async function assertMirror(phone, worker, matchId, reopen = true) {
  const truth = await worker.evaluate(() => {
    const { game, lib } = partyEngine;
    return Object.values(lib.playerOL)
      .filter((player) => player.side === false)
      .map((player) => ({
        id: player.playerid,
        alive: player.isAlive(),
        reserved: !!player.dataset.shanhetuReserve,
        name: player.name1,
        cards: player.getCards('h').map((card) => ({
          id: card.cardid,
          known: card.isKnownBy(game.zhu),
        })),
        canTarget: game.zhu.canUse({ name: 'sha', isCard: true }, player, false),
      }));
  });
  assert(
    truth
      .filter(({ reserved }) => reserved)
      .every(({ canTarget, cards }) => !canTarget && !cards.length),
  );
  if (reopen) await phone.reload();
  await phone.waitForFunction(
    (truth) =>
      truth.every(({ id, reserved, name }) => {
        const player = globalThis.partyEngine?.lib.playerOL?.[id];
        return player?.name1 === name && !!player.dataset.shanhetuReserve === reserved;
      }),
    truth,
    { timeout: 60000 },
  );
  const confidential = await phone.evaluate((truth) => {
    const { game, lib } = partyEngine;
    return truth.every(({ id, reserved, cards }) => {
      const player = lib.playerOL[id];
      return (
        (!reserved ||
          (!player.isIn() && !game.me.canUse({ name: 'sha', isCard: true }, player, false))) &&
        cards.every(
          ({ id, known }) => known || !lib.cardOL[id] || lib.cardOL[id].name === 'party_unknown',
        )
      );
    });
  }, truth);
  assert(confidential, 'Active enemy private cards and dormant targeting remain protected');
  assert(phone.url().endsWith(`/engine/player/${matchId}`));
  return {
    reserves: truth.filter(({ reserved }) => reserved).length,
    privateCardsChecked: truth.flatMap(({ cards }) => cards).filter(({ known }) => !known).length,
  };
}

function observePage(page) {
  page.on('pageerror', (error) => faults.push(String(error.stack)));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
      if (/\b(?:TypeError|ReferenceError|SyntaxError):/.test(message.text()))
        faults.push(message.text());
    }
  });
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && path.startsWith('/engine/')) missing.add(path);
  });
}

try {
  browser = await chromium.launch({
    ...(process.argv[2]
      ? { executablePath: process.argv[2] }
      : { channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge' }),
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  computer = await browser.newPage();
  observePage(computer);
  await computer.goto(`${origin}/server`);
  await expect.poll(() => adapter.status().ready, { timeout: 30000 }).toBe(true);
  for (const fixture of scenarios.filter(
    ({ battleId }) =>
      !process.env.SHANHETU_VERIFY_ENCOUNTER ||
      Number(process.env.SHANHETU_VERIFY_ENCOUNTER) === battleId,
  )) {
    const { companions, skill, kind, ...encounter } = fixture;
    const recipe = shanhetuRecipe(encounter.battleId, encounter.difficulty, 0, encounter.chapter);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const phone = await context.newPage();
    observePage(phone);
    const response = await context.request.post(`${origin}/api/rooms`, {
      data: { nickname: '山河验收' },
    });
    assert.equal(response.status(), 201);
    const { room, playerId } = await response.json();
    const starting = adapter.start({
      roomCode: room.code,
      ownerPlayerId: playerId,
      settings: {
        mode: 'shanhetu',
        playerCount: 1,
        generalPreset: 'beginner',
        allowGeneralSelection: false,
        extensions: [],
      },
      seats: [{ id: playerId, nickname: '山河验收', kind: 'human' }],
      aiPolicy: 'strongest-native',
      shanhetu: {
        ...encounter,
        runId: 'wave2a',
        nodeId: 'probe',
        candidates: ['caocao', 'guanyu', 'zhaoyun'],
        companionIds: companions,
      },
    });
    void starting.catch(() => {});
    const matchId = adapter.matchId(room.code);
    assert(matchId);
    await phone.goto(`${origin}/engine/player/${matchId}`);
    const hostReady = computer.waitForFunction(
      (id) =>
        [...document.querySelectorAll('.engine-worker')].some(
          (element) =>
            element.src.endsWith(id) && element.contentWindow?.partyEngine?.proof.hostReady,
        ),
      matchId,
      { timeout: 60000 },
    );
    await Promise.race([hostReady, starting]);
    await hostReady;
    const worker = computer
      .frames()
      .find((frame) => frame.url().endsWith(`/engine/worker/${matchId}`));
    assert(worker);
    console.log(`${encounter.battleId}: worker ready`);
    await worker.evaluate((skill) => {
      const { game, lib, proof } = partyEngine;
      proof.probeTakeovers = [];
      lib.skill.probe_shanhetu_takeovers = {
        trigger: { global: 'phaseBeforeStart' },
        forced: true,
        popup: false,
        charlotte: true,
        filter: (event, player) => player === game.zhu && event.skill === 'party_shanhetu_nm_3382',
        async content(event, trigger) {
          proof.probeTakeovers.push(trigger.player.playerid);
        },
      };
      game.addGlobalSkill('probe_shanhetu_takeovers');
      const effect = lib.skill[skill];
      const content = effect.content;
      effect.content = async function (...args) {
        await content.apply(this, args);
        if (!proof.probeTriggered) {
          await new Promise((resume) => {
            partyEngine.resumeWave2 = resume;
            proof.probeTriggered = true;
          });
        }
      };
    }, skill);
    await chooseGeneral(phone.mainFrame(), worker);
    await starting;
    await worker.waitForFunction(() => !!partyEngine.proof.shanhetu?.actors?.[0]?.initialCards);
    const opening = await worker.evaluate(() => partyEngine.proof.shanhetu.actors);
    assert.equal(opening.length, 1 + recipe.enemies.length + companions.length);
    assert(opening.length <= 8);
    for (const [index, enemy] of recipe.enemies.entries())
      assert.equal(opening[index + 1].initialCards, enemy.reinforcement ? 0 : enemy.startingCards);
    const reservedAtOpening = await assertMirror(phone, worker, matchId);
    assert.equal(
      reservedAtOpening.reserves,
      recipe.enemies.filter(({ reinforcement }) => reinforcement).length,
    );
    await worker.evaluate(() => {
      partyEngine.lib.config.game_speed = 'vvfast';
      partyEngine.lib.config.duration = 100;
      partyEngine.game.broadcast(function () {
        partyEngine.lib.config.game_speed = 'vvfast';
        partyEngine.lib.config.duration = 100;
        if (!partyEngine._status.auto) partyEngine.ui.click.auto();
      });
    });
    await worker.waitForFunction(
      () => partyEngine.proof.probeTriggered || partyEngine._status.over,
      {},
      { timeout: 90000 },
    );
    assert(
      await worker.evaluate(() => partyEngine.proof.probeTriggered),
      'Real skill must trigger during native combat',
    );
    const afterEffect = await assertMirror(phone, worker, matchId);
    if (kind) assert.equal(afterEffect.reserves, reservedAtOpening.reserves - 1);
    await phone.screenshot({ path: `${output}/${encounter.battleId}-restored.png` });
    await worker.evaluate(() => {
      partyEngine.game.broadcast(function () {
        partyEngine.lib.config.game_speed = 'vvfast';
        partyEngine.lib.config.duration = 100;
        if (!partyEngine._status.auto) partyEngine.ui.click.auto();
      });
      partyEngine.resumeWave2();
      delete partyEngine.resumeWave2;
    });
    await expect
      .poll(
        () => events.find((event) => event.type === 'ended' && event.matchId === matchId)?.shanhetu,
        { timeout: 150000 },
      )
      .toBeTruthy();
    const ended = events.find(
      (event) => event.type === 'ended' && event.matchId === matchId,
    ).shanhetu;
    assert.equal(ended.battleId, encounter.battleId);
    assert.equal(ended.hero.general, opening[0].general);
    if (ended.outcome === 'victory') assert.equal(ended.defeatedEnemies, recipe.enemies.length);
    const effects = await worker.evaluate(() => ({
      reinforcement: partyEngine.proof.shanhetuReinforcements ?? [],
      inferno: partyEngine.proof.shanhetuInfernoHits ?? [],
      takeovers: partyEngine.proof.probeTakeovers,
    }));
    if (kind) assert(effects.reinforcement.some((entry) => entry.kind === kind));
    if (kind === 'dragon-guard')
      assert(effects.reinforcement.every((entry) => entry.handSize === 5));
    if (kind === 'spearman') {
      assert.equal(effects.reinforcement.length, 1);
      assert.deepEqual(effects.takeovers, [effects.reinforcement[0].id]);
    }
    if (encounter.difficulty === 24)
      assert(effects.inferno.length > 0 && effects.inferno.every(({ bonus }) => bonus === 2));
    results.push({
      ...encounter,
      actors: opening.length,
      reservedAtOpening,
      afterEffect,
      effects,
      outcome: ended.outcome,
    });
    console.log(
      `${encounter.battleId}: ${ended.outcome}, ${opening.length} seats, original engine settled naturally`,
    );
    adapter.release(room.code);
    await context.close();
  }
  assert(results.length > 0);
  assert.deepEqual(faults, []);
  assert.deepEqual([...missing], []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify({ physicalPhone: false, results }, null, 2),
  );
  console.log(`Native Wave 2A evidence: ${output}`);
} catch (error) {
  const workerDetails = await Promise.all(
    (computer?.frames() ?? [])
      .filter((frame) => frame.url().includes('/engine/worker/'))
      .map((frame) =>
        frame
          .evaluate(() => ({
            loading: document.querySelector('#loading-detail')?.textContent,
            proof: globalThis.partyEngine?.proof,
            event: globalThis.partyEngine?._status.event?.name,
          }))
          .catch(() => undefined),
      ),
  );
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: String(error.stack),
        results,
        faults,
        browserErrors,
        missing: [...missing],
        events,
        workerDetails,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  unsubscribe();
  if (browser) await browser.close();
  const closed = once(party.server, 'close');
  party.stop();
  party.server.closeAllConnections();
  await closed;
}
