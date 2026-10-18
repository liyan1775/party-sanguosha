import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}/.runtime/college-matrix/${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(output, { recursive: true });
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { desktopSimulation: true, cases: [] };
report.httpFallback = process.env.COLLEGE_VERIFY_HTTP === '1';
const errors = [];
const api = async (user, path, method = 'GET', data) => {
  const response = await user.context.request.fetch(base + path, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  assert(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
};
try {
  await host.goto(base + '/server');
  await host.waitForFunction(
    async () => (await (await fetch('/api/info')).json()).engine.ready,
    null,
    { timeout: 60000 },
  );
  const cases = [
    { name: 'two-humans-same-team', humans: [0, 2], landlord: 0 },
    { name: 'two-humans-opposing-teams', humans: [0, 1], landlord: 2 },
    { name: 'three-humans', humans: [0, 1, 2], landlord: 1 },
    { name: 'four-humans', humans: [0, 1, 2, 3], landlord: 0 },
    { name: 'ordinary-beginner', mode: 'doudizhu', humans: [0], landlord: 0 },
  ];
  for (const item of cases) {
    const users = [];
    try {
      for (let index = 0; index < item.humans.length; index++) {
        const context = await browser.newContext({
          viewport: { width: 844, height: 390 },
          isMobile: true,
          hasTouch: true,
        });
        const page = await context.newPage();
        if (report.httpFallback)
          await context.addInitScript(() => sessionStorage.setItem('party_http_transport', '1'));
        page.on('pageerror', (error) => errors.push(String(error)));
        users.push({ context, page, slot: item.humans[index] });
      }
      const owner = users[0];
      const created = await api(owner, '/api/rooms', 'POST', { nickname: '矩阵房主' });
      const code = created.room.code;
      owner.id = created.playerId;
      await api(owner, `/api/rooms/${code}`, 'PUT', {
        mode: item.mode ?? 'college',
        playerCount: item.mode ? 3 : 4,
        generalPreset: item.mode ? 'beginner' : 'ol-college-2026',
        extensions: [],
        ...(item.mode ? {} : { collegeFormat: 'standard' }),
      });
      for (const user of users.slice(1))
        user.id = (
          await api(user, `/api/rooms/${code}/players`, 'POST', {
            nickname: `矩阵玩家${user.slot}`,
          })
        ).playerId;
      await api(owner, `/api/rooms/${code}/bots`, 'POST', {
        count: (item.mode ? 3 : 4) - users.length,
      }).catch((error) => {
        if (!item.mode && users.length === 4) return;
        throw error;
      });
      if (!item.mode) {
        for (const user of users.slice(1))
          await api(owner, `/api/rooms/${code}/team`, 'PUT', {
            playerId: user.id,
            position: user.slot,
          });
      }
      for (const user of users) {
        await user.page.goto(base + `/join/${code}`);
        await user.page.locator('#my-seat').waitFor();
      }
      const room = async () => (await api(owner, `/api/rooms/${code}`)).room;
      for (const user of users)
        await api(user, `/api/rooms/${code}/me/ready`, 'PUT', { ready: true });
      await api(owner, `/api/rooms/${code}/start`, 'POST', {});
      const registered = (await room()).players;
      const wanted = registered[item.landlord].id;
      const until = Date.now() + 120000;
      while (Date.now() < until) {
        const state = await room();
        if (state.matchId) break;
        for (const user of users) {
          const v = await api(user, `/api/rooms/${code}/me/doudizhu`);
          if (v.preparation.phase === 'bidding') {
            const seat = v.seats.find((s) => s.id === v.preparation.bidSeatId);
            if (!seat) continue;
            await api(user, `/api/rooms/${code}/me/doudizhu`, 'POST', {
              id: v.preparation.id,
              phaseId: v.preparation.phaseId,
              seatId: seat.id,
              revision: seat.revision,
              action: 'bid',
              bid: seat.id === wanted ? v.maxBid : 0,
            });
          } else if (v.preparation.phase === 'choosing') {
            for (const seat of v.seats.filter((s) => !s.locked)) {
              const fresh = await api(user, `/api/rooms/${code}/me/doudizhu`);
              await api(user, `/api/rooms/${code}/me/doudizhu`, 'POST', {
                id: fresh.preparation.id,
                phaseId: fresh.preparation.phaseId,
                seatId: seat.id,
                revision: seat.revision,
                action: 'choose',
                general: seat.candidates[0],
              });
            }
          }
        }
        await wait(100);
      }
      const started = await room();
      assert(started.matchId);
      if (!item.mode) assert.equal(started.doudizhu.landlordId, wanted);
      const id = started.matchId;
      const worker = () => host.frames().find((f) => f.url().includes(`/engine/worker/${id}`));
      for (let i = 0; i < 600 && !worker(); i++) await wait(100);
      assert(worker());
      const active = users.filter((u) =>
        Object.values(started.doudizhu.controllers).includes(u.id),
      );
      const standby = users.filter((u) => !active.includes(u));
      for (const user of standby) {
        await user.page.locator('#spectator-panel').waitFor();
        assert.equal(await user.page.locator('#game-frame').count(), 0);
        const response = await user.context.request.get(`${base}/engine/setup/${id}?role=player`);
        assert.equal(response.status(), 403);
      }
      for (const user of active) {
        for (
          let i = 0;
          i < 600 && !user.page.frames().some((f) => f.url().includes(`/engine/player/${id}`));
          i++
        )
          await wait(100);
        const frame = user.page.frames().find((f) => f.url().includes(`/engine/player/${id}`));
        assert(frame);
        user.frame = frame;
        await frame.waitForFunction(() => globalThis.partyEngine?.proof.booted, null, {
          timeout: 120000,
        });
      }
      // Actual native group choices and luck controls, without changing the rules.
      for (let i = 0; i < 900; i++) {
        if ((await room()).phase === 'playing') break;
        for (const user of active) {
          const frame = user.frame;
          const keep = frame.locator('#party-luck-cards button[data-action="keep"]:enabled');
          if (await keep.isVisible()) {
            await keep.tap();
            continue;
          }
          const button = frame
            .locator('.dialog:not(.removing) .button.selectable:not(.selected)')
            .first();
          if (await button.isVisible()) await button.tap();
          const confirm = frame
            .locator('.control:not(.removing)>div')
            .filter({ hasText: /^确定$/ })
            .first();
          if (await confirm.isVisible()) await confirm.tap();
        }
        await wait(100);
      }
      const playing = await room();
      assert.equal(playing.phase, 'playing');
      assert(!playing.matchFailure);
      const proof = await worker().evaluate(() => ({
        started: partyEngine.proof.started,
        errors: partyEngine.proof.errors,
        mode: partyEngine.setup.settings.mode,
        players: partyEngine.game.players.map((p) => ({
          id: p.playerid,
          identity: p.identity,
          general: p.name,
          start: p._start_cards.length,
        })),
      }));
      assert(proof.started);
      assert.equal(proof.players.length, 3);
      assert(proof.players.every((p) => p.start === 4));
      assert.equal(proof.errors.length, 0);
      for (const user of active) {
        const own = await user.frame.evaluate(() => ({
          id: partyEngine.game.me.playerid,
          role: partyEngine.game.me.identity,
        }));
        if (own.role === 'fan') {
          await user.frame.locator('#party-farmer-hand-toggle').waitFor({ timeout: 10000 });
          await user.frame.locator('#party-farmer-hand-toggle').tap();
          const actual = await user.frame.locator('.party-farmer-card').allTextContents();
          assert(actual.length > 0);
          assert(actual.every((text) => !text.includes('未知')));
          if (item.name === 'two-humans-opposing-teams') {
            const beforeId = own.id;
            await user.frame.evaluate(() => partyEngine.game.ws.close(4000, '验收农民手牌恢复'));
            for (let i = 0; i < 200; i++) {
              const next = user.page.frames().find((f) => f.url().includes(`/engine/player/${id}`));
              if (next && next !== user.frame) {
                user.frame = next;
                break;
              }
              await wait(100);
            }
            await user.frame.waitForFunction(
              () =>
                globalThis.partyEngine?.game.me?.identity === 'fan' &&
                document.querySelector('#party-farmer-hand'),
              null,
              { timeout: 20000 },
            );
            assert.equal(await user.frame.evaluate(() => partyEngine.game.me.playerid), beforeId);
          }
        } else assert.equal(await user.frame.locator('#party-farmer-hand').count(), 0);
        const clientSetup = await api(user, `/engine/setup/${id}?role=player`);
        assert.equal(clientSetup.doudizhu, undefined);
        assert.equal(clientSetup.generalSelections, undefined);
      }
      await owner.page.screenshot({ path: `${output}/${item.name}.png` });
      if (!item.mode) {
        // Exercise real resignation with bench consent; classify as resignation.
        const initiator = active.find((u) => started.doudizhu.controllers[wanted] === u.id);
        for (const user of users) await api(user, `/engine/surrender/${id}`);
        await wait(500);
        await api(initiator, `/engine/surrender/${id}`, 'POST', { action: 'request', epoch: '' });
        let vote;
        for (let i = 0; i < 50; i++) {
          vote = await api(initiator, `/engine/surrender/${id}`);
          if (vote.vote || (await room()).phase === 'finished') break;
          await wait(100);
        }
        if (vote.vote) {
          const expected = users
            .filter(
              (u) =>
                item.humans.findIndex((slot) => slot === u.slot) >= 0 &&
                u.slot % 2 === item.landlord % 2,
            )
            .map((u) => u.id)
            .sort();
          assert.deepEqual(vote.vote.participants.map((p) => p.id).sort(), expected);
          if (standby.some((u) => expected.includes(u.id)))
            assert.equal((await room()).phase, 'playing');
          for (const user of users.filter((u) => expected.includes(u.id) && u !== initiator)) {
            // A benched member has no native iframe. Use the real room dialog
            // to verify its authenticated HTTP vote is reachable from the UI.
            await user.page.locator('#surrender-dialog').waitFor({ state: 'visible' });
            await user.page.locator('#surrender-confirm').tap();
          }
        }
        for (let i = 0; i < 80 && (await room()).phase !== 'finished'; i++) await wait(100);
        assert.equal((await room()).phase, 'finished');
        assert(!(await room()).matchFailure);
      }
      report.cases.push({
        name: item.name,
        passed: true,
        activeHumans: active.length,
        standbyHumans: standby.length,
        landlordId: wanted,
        nativePlayers: proof.players,
        termination: item.mode ? 'deal-only' : 'explicit-consent-resignation',
      });
      console.log(JSON.stringify(report.cases.at(-1)));
      party.lobby.get(code).consoleClose();
    } finally {
      for (const user of users) await user.context.close();
    }
  }
  assert.equal(errors.length, 0);
  report.errors = errors;
  report.passed = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  report.errors = errors;
  throw error;
} finally {
  await writeFile(output + '/result.json', JSON.stringify(report, null, 2) + '\n');
  console.log('Matrix evidence: ' + output);
  await browser.close();
  party.closeStreams();
  party.server.closeAllConnections();
  party.server.close();
}
