import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral, playOneAction } from './native-ui-actions.mjs';
import { verifyLuckCards } from './native-connection-luck-probes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}/.runtime/college-runtime/${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(output, { recursive: true });
process.env.PARTY_EXPERIENCE_OUTPUT = output;
const engine = new NativeNonameService(root);
const party = createPartyServer({ port: 0, webRoot: `${root}/dist/web`, adapter: engine });
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const hostContext = await browser.newContext();
const host = await hostContext.newPage();
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
});
const phone = await context.newPage();
const errors = [];
const report = { base, output, desktopSimulation: true, games: [] };
phone.on('pageerror', (error) => errors.push(String(error)));
host.on('pageerror', (error) => errors.push(String(error)));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Native animation speed only; do not change AI, cards, HP, choices or outcomes.
const fast = async (frame) =>
  frame.evaluate(() => {
    partyEngine.lib.config.game_speed = 'vvfast';
    partyEngine.lib.config.duration = 100;
  });
async function api(path, method = 'GET', data) {
  const response = await context.request.fetch(base + path, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  assert(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
async function snapshot(code) {
  return (await api(`/api/rooms/${code}`)).room;
}
async function pregame(code, targetRole) {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    const room = await snapshot(code);
    if (room.matchFailure) throw new Error('Native match failed: ' + room.matchFailure.code);
    if (room.matchId) return room;
    const view = await api(`/api/rooms/${code}/me/doudizhu`);
    if (view.preparation.phase === 'bidding') {
      const seat = view.seats.find((s) => s.id === view.preparation.bidSeatId);
      if (seat) {
        const own = room.ownerId === seat.id;
        const pass =
          targetRole === 'farmers' ||
          (targetRole === 'ai-landlord' && own) ||
          (targetRole === 'human-landlord' && !own);
        const label = pass ? '不叫' : `叫 ${view.maxBid} 倍`;
        const control = phone.locator('#doudizhu-bids button').filter({ hasText: label }).first();
        if ((await control.isVisible()) && (await control.isEnabled())) await control.tap();
      }
    } else if (view.preparation.phase === 'choosing') {
      for (const seat of view.seats.filter((s) => !s.locked)) {
        const section = phone.locator(`.doudizhu-seat[data-seat="${seat.id}"]`);
        const pick = section.locator('button[data-general]').first();
        if ((await pick.isVisible()) && (await pick.isEnabled())) {
          await pick.tap();
          const confirm = phone.locator('#doudizhu-confirm');
          if ((await confirm.isVisible()) && (await confirm.isEnabled())) await confirm.tap();
        }
      }
    }
    await wait(300);
  }
  throw new Error('Pregame did not reach a native match');
}
try {
  await host.goto(base + '/server');
  await host.waitForFunction(
    async () => {
      const r = await fetch('/api/info');
      return (await r.json()).engine.ready;
    },
    null,
    { timeout: 60000 },
  );
  console.log('Isolated native service ready.');
  const created = await api('/api/rooms', 'POST', { nickname: '高校练习真人' });
  const code = created.room.code;
  await phone.goto(base + `/join/${code}`);
  await phone.locator('[data-mode="college"]').tap();
  await phone.locator('#college-format').selectOption('quick');
  for (let i = 0; i < 80; i++) {
    if ((await snapshot(code)).settings.collegeFormat === 'quick') break;
    await wait(200);
  }
  assert.equal((await snapshot(code)).settings.collegeFormat, 'quick');
  await phone.locator('#fill-bots').tap();
  const seen = new Set();
  let inspectedLuck = false;
  const limit = Number(process.env.COLLEGE_VERIFY_GAMES ?? 8);
  for (let index = 0; index < limit; index++) {
    await phone.locator(index ? '#college-ready' : '#ready-button').tap();
    await phone.locator(index ? '#college-start' : '#start-button').tap();
    const room = await pregame(
      code,
      index === 0 ? 'ai-landlord' : index === 1 ? 'human-landlord' : 'farmers',
    );
    const id = room.matchId;
    console.log(
      JSON.stringify({
        stage: 'native-loading',
        game: index + 1,
        landlordIsAi: room.doudizhu.landlordId !== room.ownerId,
      }),
    );
    const worker = () => host.frames().find((f) => f.url().includes(`/engine/worker/${id}`));
    for (let i = 0; i < 600 && !worker(); i++) await wait(100);
    assert(worker(), 'worker iframe');
    await worker().waitForFunction(() => globalThis.partyEngine?.proof.hostReady, null, {
      timeout: 120000,
    });
    assert.equal(await worker().evaluate(() => partyEngine.proof.roster.length), 92);
    await fast(worker());
    let frame = () => phone.frames().find((f) => f.url().includes(`/engine/player/${id}`));
    for (let i = 0; i < 400 && !frame(); i++) await wait(100);
    assert(frame(), 'human or controlled AI native frame');
    await frame().waitForFunction(() => globalThis.partyEngine?.proof.booted, null, {
      timeout: 120000,
    });
    await fast(frame());
    await chooseGeneral(
      frame(),
      worker(),
      !inspectedLuck
        ? {
            onLuck: async (f, w) => {
              inspectedLuck = true;
              return verifyLuckCards(f, w);
            },
          }
        : {},
    );
    const started = await snapshot(code);
    assert.equal(started.phase, 'playing');
    assert(
      await worker().evaluate(() =>
        ['feiyang', 'bahu', 'qiangyi'].every((skill) =>
          partyEngine.game.zhu.skills.includes(skill),
        ),
      ),
    );
    const native = await frame().evaluate(() => ({
      id: partyEngine.setup.playerId,
      role: partyEngine.game.me.identity,
      hands: partyEngine.game.me.countCards('h'),
      errors: partyEngine.proof.errors,
    }));
    assert.equal(native.errors.length, 0);
    const type =
      native.role === 'fan'
        ? 'farmers'
        : native.id === room.ownerId
          ? 'human-landlord'
          : 'ai-landlord';
    seen.add(type);
    if (type === 'ai-landlord') {
      assert.notEqual(native.id, room.ownerId);
      assert.equal(started.doudizhu.controllers[native.id], room.ownerId);
    }
    if (type === 'farmers') {
      await frame().locator('#party-farmer-hand-toggle').waitFor({ timeout: 10000 });
      const visible = await frame().locator('.party-farmer-card').count();
      assert(visible > 0);
    } else assert.equal(await frame().locator('#party-farmer-hand').count(), 0);
    const playerSetup = await api(`/engine/setup/${id}?role=player`);
    assert.equal(playerSetup.doudizhu, undefined);
    await phone.screenshot({ path: `${output}/game-${index + 1}-${type}.png` });
    // Complete a required native target such as 先辅 through the real UI.
    const name = await frame().evaluate(() => partyEngine._status.event?.name);
    if (name === 'chooseTarget') {
      const target = frame().locator('.player.selectable:not(.selected)').first();
      if (await target.isVisible()) {
        await target.tap();
        const confirm = frame()
          .locator('.control > div')
          .filter({ hasText: /^确定$/ })
          .first();
        if (await confirm.isVisible()) await confirm.tap();
      }
    }
    const manual =
      type === 'ai-landlord' && !report.games.some((g) => g.type === 'ai-landlord' && g.manual);
    if (manual) await playOneAction([frame()], worker(), { resolveMandatory: true });
    await frame().evaluate(() => {
      if (!partyEngine._status.auto) partyEngine.ui.click.auto();
    });
    const began = Date.now();
    let done;
    let heartbeat = Date.now();
    while (Date.now() - began < 480000) {
      done = await snapshot(code);
      if (done.phase === 'finished') break;
      if (done.matchFailure) throw new Error('Native failure: ' + done.matchFailure.code);
      if (Date.now() - heartbeat > 30000) {
        heartbeat = Date.now();
        console.log(
          JSON.stringify(
            await worker().evaluate(() => ({
              stage: 'native-progress',
              round: partyEngine.game.roundNumber,
              event: partyEngine._status.event?.name,
              actions: [...partyEngine.game.players, ...partyEngine.game.dead].reduce(
                (n, p) => n + p.getAllHistory('useCard').length,
                0,
              ),
              errors: partyEngine.proof.errors,
            })),
          ),
        );
      }
      await wait(1000);
    }
    assert.equal(done.phase, 'finished', 'native natural settlement');
    assert(!done.matchFailure);
    const endProof = await worker().evaluate(() => ({
      started: partyEngine.proof.started,
      ended: partyEngine.proof.ended,
      errors: partyEngine.proof.errors,
      actions: [...partyEngine.game.players, ...partyEngine.game.dead].reduce(
        (n, p) => n + p.getAllHistory('useCard').length,
        0,
      ),
      players: [...partyEngine.game.players, ...partyEngine.game.dead].map((p) => ({
        id: p.playerid,
        general: p.name,
        identity: p.identity,
        dead: p.isDead(),
      })),
    }));
    assert(endProof.started && endProof.ended);
    assert.equal(endProof.errors.length, 0);
    assert(endProof.actions > 0);
    assert.equal(
      done.series.completedGames,
      (report.games.at(-1)?.seriesId === done.series.id ? report.games.at(-1).completedGames : 0) +
        1,
    );
    const entry = {
      id,
      type,
      manual,
      elapsedMs: Date.now() - began,
      actions: endProof.actions,
      seriesId: done.series.id,
      completedGames: done.series.completedGames,
      scores: done.series.scores,
      seriesFinished: done.series.finished,
      players: endProof.players,
    };
    report.games.push(entry);
    console.log(
      JSON.stringify({
        game: index + 1,
        type,
        actions: entry.actions,
        scores: entry.scores,
        seriesFinished: entry.seriesFinished,
      }),
    );
    await phone.locator('#rematch-button').tap();
    for (let i = 0; i < 80 && (await snapshot(code)).phase !== 'waiting'; i++) await wait(100);
    const waiting = await snapshot(code);
    assert.equal(waiting.phase, 'waiting');
    assert.deepEqual(waiting.series.scores, done.series.scores);
    if (done.series.finished) {
      report.completedSeries = true;
      if (seen.has('ai-landlord') && seen.has('farmers')) break;
    }
  }
  assert(report.completedSeries, 'a whole quick series must reach its natural end');
  assert(seen.has('ai-landlord'), 'controlled AI landlord case');
  assert(seen.has('farmers'), 'mixed farmer case');
  report.errors = errors;
  assert.equal(errors.length, 0);
  report.passed = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  report.errors = errors;
  report.diagnostics = [];
  for (const page of [host, phone])
    for (const f of page.frames().filter((f) => /\/engine\/(worker|player)\//.test(f.url())))
      report.diagnostics.push(
        await f
          .evaluate(() => ({
            role: partyEngine.setup.role,
            mode: partyEngine.setup.settings.mode,
            playerId: partyEngine.setup.playerId,
            proof: partyEngine.proof,
            event: partyEngine._status.event?.name,
            paused: partyEngine._status.paused,
            online: partyEngine.game.online,
            onlineID: partyEngine.game.onlineID,
            round: partyEngine.game.roundNumber,
            eventPlayer: partyEngine._status.event?.player?.playerid,
            actions: [...partyEngine.game.players, ...partyEngine.game.dead].reduce(
              (n, p) => n + p.getAllHistory('useCard').length,
              0,
            ),
            players: partyEngine.game.players.map((p) => ({
              id: p.playerid,
              identity: p.identity,
              general: p.name,
              online: p.isOnline(),
              hp: p.hp,
              hand: p.countCards('h'),
            })),
          }))
          .catch((e) => ({ error: String(e) })),
      );
  await phone.screenshot({ path: output + '/failure.png' }).catch(() => {});
  throw error;
} finally {
  await writeFile(output + '/result.json', JSON.stringify(report, null, 2) + '\n');
  console.log('College native evidence: ' + output);
  await browser.close();
  party.closeStreams();
  party.server.closeAllConnections();
  party.server.close();
}
