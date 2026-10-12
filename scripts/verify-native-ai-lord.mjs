import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

// Each attempt owns a random-port server. The shipped engine, roster, seating,
// identity shuffle, candidate generation and Math.random scoring are untouched.
// Observe private candidates only inside the rule iframe; never persist them,
// identities, hands, session credentials, frames or chosen general IDs.
const root = fileURLToPath(new URL('../', import.meta.url));
const presets = JSON.parse(await readFile(`${root}/config/roster-presets.json`, 'utf8'));
const output = `.runtime/native-ai-lord/${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const results = [];
let stage = 'setup';
let diagnostics;

async function request(phone, path, method = 'POST', body) {
  return phone.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error('isolated fixture request failed');
      return response.json();
    },
    { path, method, body },
  );
}

async function attempt(preset) {
  const engine = new NativeNonameService(root);
  const party = createPartyServer({ webRoot: `${root}/dist/web`, port: 0, adapter: engine });
  await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  assert.notEqual(party.server.address().port, 3001);
  const base = `http://127.0.0.1:${party.server.address().port}`;
  const computerContext = await browser.newContext();
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  let pageErrors = 0;
  try {
    await computerContext.addInitScript(() => {
      let engine;
      Object.defineProperty(globalThis, 'partyEngine', {
        configurable: true,
        get: () => engine,
        set(value) {
          engine = value;
          if (value.setup.role !== 'worker') return;
          const { lib, game, get, setup, proof } = value;
          let lord;
          let candidates;
          let aiLord;
          const dealt = new Set();
          const prototype = lib.element.Player.prototype;
          const choose = prototype.chooseButtonOL;
          prototype.chooseButtonOL = function (...args) {
            const entry = args[0]?.find(([player]) => player === game.zhu);
            if (entry) {
              lord = entry[0];
              const dialog = entry[1].createDialog ?? entry[1];
              candidates = dialog[1][0].slice();
              aiLord = setup.seats.find((seat) => seat.id === lord.playerid)?.kind === 'bot';
            }
            return choose.apply(this, args);
          };
          const gain = prototype.directgain;
          prototype.directgain = function (cards, ...args) {
            if (get.event()?.name === 'gameDraw' && cards.length > 0) dealt.add(this.playerid);
            return gain.call(this, cards, ...args);
          };
          globalThis.partyLordProbe = {
            sample() {
              const selected = lord?.name;
              return {
                aiLord,
                legal: !!selected && candidates?.includes(selected) === true,
                notFirst: !!selected && candidates?.[0] !== selected,
                realDeal: proof.started && dealt.size === 8,
                fullPool:
                  proof.roster.length === setup.preset.characters.length &&
                  proof.roster.every((name) => setup.preset.characters.includes(name)),
                // This publicly revealed general enters only the in-memory Set
                // below to count distinct results; it is removed before output.
                selected: proof.started ? selected : undefined,
              };
            },
          };
        },
      });
    });
    const computer = await computerContext.newPage();
    const phone = await phoneContext.newPage();
    computer.on('pageerror', () => pageErrors++);
    phone.on('pageerror', () => pageErrors++);
    stage = `${preset}:room`;
    await computer.goto(`${base}/server`);
    await phone.goto(base);
    const created = await request(phone, '/api/rooms', 'POST', { nickname: '主公选将验证' });
    const code = created.room.code;
    await phone.goto(`${base}/join/${code}`);
    await request(phone, `/api/rooms/${code}`, 'PUT', {
      mode: 'identity',
      playerCount: 8,
      generalPreset: preset,
      allowGeneralSelection: false,
      extensions: [],
    });
    await request(phone, `/api/rooms/${code}/bots`, 'POST', { count: 7 });
    await phone.waitForFunction(() => !document.querySelector('#ready-button')?.disabled);
    await phone.locator('#ready-button').tap();
    await phone.waitForFunction(() => !document.querySelector('#start-button').disabled);
    await phone.locator('#start-button').tap();
    stage = `${preset}:native-selection`;
    await phone.waitForFunction(
      () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
      {},
      { timeout: 60000 },
    );
    const frame = phone.frames().find((frame) => frame.url().includes('/engine/player/'));
    const matchId = party.lobby.get(code).snapshot().matchId;
    const worker = computer
      .frames()
      .find((frame) => frame.url().endsWith(`/engine/worker/${matchId}`));
    assert(worker);
    await worker.waitForFunction(() => !!globalThis.partyLordProbe);
    await chooseGeneral(frame, worker);
    stage = `${preset}:native-deal`;
    await worker.waitForFunction(() => partyEngine.proof.started, {}, { timeout: 30000 });
    await phone.waitForFunction(
      () => {
        const engine = document.querySelector('#game-frame')?.contentWindow?.partyEngine;
        return engine?._status.gameStarted && engine.game.me?.countCards('h') > 0;
      },
      {},
      { timeout: 15000 },
    );
    const sample = await worker.evaluate(() => partyLordProbe.sample());
    const workerErrors = await worker.evaluate(() => partyEngine.proof.errors.length);
    const phoneErrors = await frame.evaluate(() => partyEngine.proof.errors.length);
    diagnostics = { ...sample, pageErrors, workerErrors, phoneErrors };
    delete diagnostics.selected;
    assert.equal(pageErrors + workerErrors + phoneErrors, 0, 'native errors must be absent');
    assert.equal(sample.realDeal, true, 'all eight native seats really received initial cards');
    assert.equal(sample.fullPool, true, 'production roster must be complete');
    assert.equal(sample.legal, true, 'selection must belong to the unmodified native offer');
    return sample;
  } finally {
    // Stop this isolated service only, after real dealing; never touch 3001.
    party.stop();
    await phoneContext.close();
    await computerContext.close();
  }
}

try {
  for (const preset of ['advanced', 'ol-doudizhu-s15']) {
    const chosen = new Set();
    let samples = 0;
    let skippedHumanLords = 0;
    let nonFirst = false;
    // Keep natural role assignment. A human-lord attempt is dealt normally but
    // is not an AI sample; never override the assignment or selection scoring.
    for (let index = 0; samples < 4 && index < 20; index++) {
      const sample = await attempt(preset);
      if (!sample.aiLord) {
        skippedHumanLords++;
        continue;
      }
      samples++;
      chosen.add(sample.selected);
      nonFirst ||= sample.notFirst;
      console.log(
        JSON.stringify({ preset, aiSamples: samples, legal: sample.legal, realDeal: true }),
      );
    }
    assert.equal(samples, 4, 'four real AI-lord deals are required per pool');
    const result = {
      preset,
      poolCount: presets.presets.find((item) => item.id === preset).characters.length,
      aiSamples: samples,
      skippedHumanLords,
      allAILords: true,
      allLegal: true,
      allRealDealt: true,
      fullProductionPool: true,
      distinctSelections: chosen.size,
      anyNonFirst: nonFirst,
    };
    results.push(result);
    assert(chosen.size > 1, 'AI lord must not always select the same general');
    assert(nonFirst, 'AI lord must not always select its first candidate');
    chosen.clear();
  }
  const result = {
    browser: 'desktop Edge with mobile viewport; isolated local WebSocket',
    mode: 'identity',
    seats: 8,
    productionSeatingAndAI: true,
    results,
    errors: [],
  };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, ...result }));
} catch {
  await writeFile(
    `${output}/result.json`,
    JSON.stringify({ results, failedStage: stage, diagnostics }, null, 2),
  );
  // Native errors can contain private values. Keep diagnostics aggregate-only.
  console.error(JSON.stringify({ output, failedStage: stage, diagnostics }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
