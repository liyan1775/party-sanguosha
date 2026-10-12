import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { APP_VERSION } from '../packages/shared/src/contracts.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const party = createPartyServer({
  webRoot: `${root}/dist/web`,
  port: 0,
  adapter: new NativeNonameService(root),
});
await new Promise((resolve) => party.server.listen(0, '0.0.0.0', resolve));
const port = party.server.address().port;
const lan = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;
assert(lan, 'LAN IPv4 is required');
const base = `http://${lan}:${port}`;
const output = `.runtime/native-surrender/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const errors = [],
  missing = new Set(),
  results = [];
const http = process.env.ENGINE_VERIFY_HTTP === '1';
const current = (page) => page.frames().find((frame) => frame.url().includes('/engine/player/'));
async function phonePage() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  if (http) await context.addInitScript(() => sessionStorage.setItem('party_http_transport', '1'));
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  watch(page);
  return page;
}
function watch(page) {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /(?:TypeError|ReferenceError|SyntaxError):/.test(message.text())
    )
      errors.push(message.text());
  });
  page.on('dialog', async (dialog) => {
    errors.push(dialog.message());
    await dialog.dismiss();
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/api/me'))
      missing.add(new URL(response.url()).pathname);
  });
}
async function request(page) {
  await page.locator('#match-surrender').tap();
  await expect(page.locator('#surrender-dialog')).toBeVisible();
  await page.locator('#surrender-confirm').tap();
}
async function voteState(page) {
  return current(page).evaluate(() => partyEngine.surrenderState);
}
async function send(page, action, epoch = '') {
  await current(page).evaluate(
    ({ action, epoch }) => partyEngine.game.send('partySurrender', action, epoch),
    { action, epoch },
  );
}
async function waitVote(page, exists) {
  await current(page).waitForFunction(
    (exists) => Boolean(partyEngine.surrenderState?.vote) === exists,
    exists,
    { timeout: 35000 },
  );
}
async function resumeVote(page, epoch) {
  if (await page.locator('#surrender-dialog').isVisible())
    await page.locator('#surrender-close').tap();
  const remaining = (await voteState(page)).vote.remainingMs;
  const previousFrame = current(page);
  await Promise.all([
    page.waitForEvent('framenavigated', { predicate: (frame) => frame === previousFrame }),
    page.locator('#match-restore').tap(),
  ]);
  await expect
    .poll(
      async () => {
        try {
          return (await voteState(page))?.vote?.epoch;
        } catch {
          return '';
        }
      },
      { timeout: 20000 },
    )
    .toBe(epoch);
  const state = await voteState(page);
  assert(state.vote.remainingMs <= remaining + 100, 'reinit retains original deadline');
  assert.equal(state.vote.voted, false, 'reinit must not consent for a human');
  // Closing the outer dialog before manually restoring the iframe is retained;
  // the same vote remains available from the toolbar without a duplicate popup.
  if (!(await page.locator('#surrender-dialog').isVisible()))
    await page.locator('#match-surrender').tap();
  await expect(page.locator('#surrender-dialog')).toBeVisible();
}
try {
  const computer = await browser.newPage();
  watch(computer);
  await computer.goto(`http://127.0.0.1:${port}/server`);
  await expect
    .poll(async () => (await (await computer.request.get(`${base}/api/info`)).json()).engine.ready)
    .toBe(true);
  for (const mode of process.env.ENGINE_VERIFY_MODES?.split(',') ?? [
    'duel',
    'doudizhu',
    'versus',
    'identity',
  ]) {
    const seats = { duel: 2, doudizhu: 3, versus: 4, identity: 5 }[mode];
    const count = Math.min(seats, Number(process.env.ENGINE_VERIFY_HUMANS ?? seats));
    const phones = [await phonePage()];
    const owner = phones[0];
    await owner.goto(base);
    const created = await owner.evaluate(async () =>
      (
        await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: '房主 <投票>' }),
        })
      ).json(),
    );
    const code = created.room.code;
    await owner.goto(`${base}/join/${code}`);
    await owner.evaluate(
      async ({ code, mode, seats }) => {
        const response = await fetch(`/api/rooms/${code}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            playerCount: seats,
            generalPreset: 'beginner',
            allowGeneralSelection: false,
            extensions: [],
          }),
        });
        if (!response.ok) throw new Error(await response.text());
      },
      { code, mode, seats },
    );
    for (let index = 1; index < count; index++) {
      const page = await phonePage();
      phones.push(page);
      await page.goto(`${base}/join/${code}`);
      await page.locator('#nickname').fill(`朋友 ${index}`);
      await page.locator('#join-button').tap();
      await expect(page.locator('#ready-button')).toBeVisible();
    }
    if (count < seats)
      await owner.evaluate(
        async ({ code, count }) => {
          const response = await fetch(`/api/rooms/${code}/bots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count }),
          });
          if (!response.ok) throw new Error(await response.text());
        },
        { code, count: seats - count },
      );
    for (const page of phones) {
      await expect(page.locator('#ready-button')).toBeEnabled();
      await page.locator('#ready-button').tap();
    }
    await expect(owner.locator('#start-button')).toBeEnabled();
    await owner.locator('#start-button').tap();
    await expect(owner.locator('#game-frame')).toBeVisible();
    const id = party.lobby.get(code).snapshot().matchId;
    const workerElement = computer.locator(`iframe[src*='/engine/worker/${id}']`);
    await expect(workerElement).toBeAttached();
    const worker = computer.frames().find((frame) => frame.url().includes(`/engine/worker/${id}`));
    assert(worker);
    for (const page of phones) await expect(page.locator('#game-frame')).toBeVisible();
    await Promise.all(phones.map((page) => chooseGeneral(current(page), worker)));
    await worker.waitForFunction(() => partyEngine.proof.started);
    for (const page of phones) await expect(page.locator('#match-surrender')).toBeVisible();
    const originalSeats = party.lobby
      .get(code)
      .snapshot()
      .players.map((player) => player.id);
    const ids = await Promise.all(
      phones.map((page) => current(page).evaluate(() => partyEngine.setup.playerId)),
    );
    console.log(mode, 'real native selection/deal ready;', count, 'humans;', http ? 'HTTP' : 'WS');
    const stillPlaying = async () => {
      assert.equal(party.lobby.get(code).snapshot().phase, 'playing');
      assert.equal(await worker.evaluate(() => partyEngine._status.over), false);
    };
    let initiator = owner;
    // For open-team modes choose a two-human side. No hidden identity is returned.
    if (count > 1 && mode === 'doudizhu') {
      const farmerIds = await worker.evaluate(() =>
        partyEngine.game.players
          .filter((player) => player.identity === 'fan')
          .map((player) => player.playerid),
      );
      initiator = phones[ids.findIndex((id) => farmerIds.includes(id))];
    }
    await initiator.locator('#match-surrender').tap();
    await initiator.locator('#surrender-reject').tap();
    await stillPlaying();
    await current(initiator).evaluate(() => partyEngine.game.send('giveup', partyEngine.game.me));
    await stillPlaying();
    const proof = {
      mode,
      humans: count,
      transport: http ? 'http' : 'websocket',
      confirmationCancel: true,
      legacyBypassRejected: true,
    };
    if (mode === 'duel' || count === 1) {
      await request(initiator);
    } else {
      await request(initiator);
      await waitVote(initiator, true);
      const first = (await voteState(initiator)).vote;
      const voters = phones.filter((_page, index) =>
        first.participants.some((voter) => voter.id === ids[index]),
      );
      const teammate = voters.find((page) => page !== initiator);
      assert(teammate, 'two humans must consent');
      await send(initiator, 'approve', first.epoch);
      const enemy = phones.find((page) => !voters.includes(page));
      if (enemy) {
        await send(enemy, 'approve', first.epoch);
        proof.enemyVoteRejected = true;
      }
      await stillPlaying();
      assert.equal(
        (await voteState(initiator)).vote.participants.filter((entry) => entry.approved).length,
        1,
      );
      await initiator.screenshot({ path: `${output}/${mode}-vote.png` });
      if (mode === 'identity') {
        assert(
          !/identity|"side"/.test(JSON.stringify(first)),
          'identity quorum is independent of hidden roles',
        );
        const revealed = await worker.evaluate(
          () => partyEngine.game.players.filter((player) => player.identityShown).length,
        );
        await teammate.locator('#surrender-reject').tap();
        await waitVote(initiator, false);
        assert.equal(
          await worker.evaluate(
            () => partyEngine.game.players.filter((player) => player.identityShown).length,
          ),
          revealed,
        );
        proof.hiddenRolesPreservedBeforeAgreement = true;
      } else if (mode === 'versus') {
        await resumeVote(teammate, first.epoch);
        proof.reconnectDeadlinePreserved = true;
        await waitVote(initiator, false);
        await stillPlaying();
        assert.match((await voteState(initiator)).notice, /超时/);
        proof.realThirtySecondTimeout = true;
      } else {
        await teammate.locator('#surrender-reject').tap();
        await waitVote(initiator, false);
        proof.teammateRejection = true;
      }
      await send(initiator, 'request');
      await stillPlaying();
      assert.equal(
        (await voteState(initiator)).vote,
        null,
        'cooldown cannot be bypassed by a raw command',
      );
      proof.cooldownEnforced = true;
      await request(teammate);
      await waitVote(initiator, true);
      const next = (await voteState(initiator)).vote;
      assert.notEqual(next.epoch, first.epoch);
      await send(initiator, 'approve', first.epoch);
      await stillPlaying();
      assert.equal((await voteState(initiator)).vote.voted, false);
      proof.oldVoteRejected = true;
      if (mode === 'identity') {
        const another = voters.find((page) => page !== teammate && page !== initiator);
        await resumeVote(another, next.epoch);
        proof.reconnectDeadlinePreserved = true;
      }
      for (const page of voters.filter((page) => page !== teammate)) {
        await expect(page.locator('#surrender-dialog')).toBeVisible();
        await page.locator('#surrender-confirm').tap();
      }
    }
    await expect.poll(() => party.lobby.get(code).snapshot().phase).toBe('finished');
    await worker.waitForFunction(() => partyEngine.proof.ended && partyEngine._status.over);
    const ending = await worker.evaluate(() => {
      const { game, proof } = partyEngine;
      return {
        wins: [...game.players, ...game.dead].filter(
          (player) => game.checkOnlineResult(player) === true,
        ).length,
        losses: [...game.players, ...game.dead].filter(
          (player) => game.checkOnlineResult(player) === false,
        ).length,
        unranked: [...game.players, ...game.dead].filter(
          (player) => game.checkOnlineResult(player) === null,
        ).length,
        errors: proof.errors,
        dead: game.dead.length,
      };
    });
    assert.deepEqual(ending.errors, []);
    assert.equal(ending.dead, 0, 'surrender does not manufacture death triggers');
    if (mode === 'identity') assert.equal(ending.unranked, seats);
    else {
      assert(ending.wins > 0);
      assert(ending.losses > 0);
    }
    for (const page of phones) {
      await expect(page.frameLocator('#game-frame').locator('#party-return-room')).toBeVisible();
      const text = await current(page).evaluate(
        () => partyEngine.ui.dialog?.content?.textContent ?? '',
      );
      if (mode === 'identity')
        assert(
          text.includes('不判胜负') && !text.includes('战斗胜利') && !text.includes('战斗失败'),
        );
      else assert(/战斗胜利|战斗失败/.test(text), `native settlement: ${text.slice(0, 100)}`);
      await expect(page.locator('#surrender-dialog')).not.toBeVisible();
    }
    // Ended reinit must retain the same winner/loser or unranked result.
    const originalTitle = await current(initiator).evaluate(
      () => partyEngine.ui.dialog?.content?.firstElementChild?.textContent,
    );
    console.log(mode, 'ending snapshot:', await worker.evaluate(() => partyEngine.surrenderProof));
    const previousFrame = current(initiator);
    await Promise.all([
      initiator.waitForEvent('framenavigated', { predicate: (frame) => frame === previousFrame }),
      initiator.locator('#match-restore').tap(),
    ]);
    await expect(initiator.frameLocator('#game-frame').locator('#party-return-room')).toBeVisible({
      timeout: 15000,
    });
    assert.equal(
      await current(initiator).evaluate(
        () => partyEngine.ui.dialog?.content?.firstElementChild?.textContent,
      ),
      originalTitle,
    );
    proof.endedReinitResultPreserved = true;
    await owner.screenshot({ path: `${output}/${mode}-settlement.png` });
    for (const page of phones.slice(1)) {
      await page.frameLocator('#game-frame').locator('#party-return-room').tap();
      await expect(page.locator('#game-frame')).toHaveCount(0);
      await expect(page.locator('#waiting-return')).toBeVisible();
    }
    await owner.frameLocator('#game-frame').locator('#party-return-room').tap();
    await expect(owner.locator('#ready-button')).toBeEnabled();
    assert.equal(party.lobby.get(code).snapshot().phase, 'waiting');
    assert.deepEqual(
      party.lobby
        .get(code)
        .snapshot()
        .players.map((player) => player.id),
      originalSeats,
    );
    proof.originalRoomAndSeatsPreserved = true;
    results.push({ ...proof, ending });
    console.log(mode, 'surrender/end, native settlement, reinit and return passed');
    for (const page of phones) await page.context().close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual([...missing], []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        version: APP_VERSION,
        physicalPhone: false,
        browser: browser.version(),
        results,
        errors,
        missing: [...missing],
      },
      null,
      2,
    ),
  );
  console.log('verified:', output);
} catch (error) {
  const diagnostics = [];
  for (const context of browser.contexts())
    for (const page of context.pages())
      for (const frame of page.frames()) {
        if (!/\/engine\/(worker|player)\//.test(frame.url())) continue;
        diagnostics.push(
          await frame
            .evaluate(() => ({
              role: partyEngine.setup.role,
              over: partyEngine._status.over,
              booted: partyEngine.proof.booted,
              surrenderProof: partyEngine.surrenderProof,
              replay: partyEngine.surrenderReplay,
              receivedState: !!partyEngine.surrenderState,
              hasDialog: !!partyEngine.ui.dialog?.isConnected,
              returnRoom: !!partyEngine.ui.partyReturnRoom?.isConnected,
            }))
            .catch(() => ({ closed: true })),
        );
      }
  let index = 0;
  for (const context of browser.contexts())
    for (const page of context.pages())
      await page.screenshot({ path: `${output}/failure-${index++}.png` }).catch(() => {});
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      { error: String(error.stack), diagnostics, results, errors, missing: [...missing] },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  party.stop();
}
