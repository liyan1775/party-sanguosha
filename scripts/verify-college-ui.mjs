import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}/.runtime/college-ui/${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(output, { recursive: true });
const party = createPartyServer({
  port: 0,
  webRoot: `${root}/dist/web`,
  adapter: new NativeNonameService(root),
});
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const report = { desktopMobileSimulation: true, captures: [], checks: [] };
const errors = [],
  users = [];
let code;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(user, path, method = 'GET', data) {
  const response = await user.context.request.fetch(base + path, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.json();
}
async function capture(user, name, width = 844, height = 390) {
  await user.page.setViewportSize({ width, height });
  await user.page.screenshot({ path: `${output}/${name}.png` });
  report.captures.push(name);
}
async function bounded(user, selector) {
  const result = await user.page.locator(selector).evaluate((node) => {
    const r = node.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      w: innerWidth,
      h: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
  assert(
    result.left >= -1 &&
      result.top >= -1 &&
      result.right <= result.w + 1 &&
      result.bottom <= result.h + 1,
    `${selector} outside viewport: ${JSON.stringify(result)}`,
  );
  assert(result.documentHeight <= result.h + 1, 'match must not scroll the lobby');
  return result;
}
try {
  const host = await browser.newPage();
  host.on('pageerror', (e) => errors.push(String(e)));
  await host.goto(base + '/server');
  await host.waitForFunction(
    async () => (await (await fetch('/api/info')).json()).engine.ready,
    null,
    { timeout: 60000 },
  );
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    users.push({ context, page });
  }
  const owner = users[0];
  const created = await api(owner, '/api/rooms', 'POST', { nickname: '练习房主' });
  code = created.room.code;
  owner.id = created.playerId;
  const path = `/api/rooms/${code}`;
  const room = async () => (await api(owner, path)).room;
  await api(owner, path, 'PUT', {
    mode: 'college',
    playerCount: 4,
    generalPreset: 'ol-college-2026',
    collegeFormat: 'quick',
    extensions: [],
  });
  for (const [i, user] of users.slice(1).entries())
    user.id = (
      await api(user, path + '/players', 'POST', { nickname: `练习朋友${i + 1}` })
    ).playerId;
  await api(owner, path + '/bots', 'POST', { count: 1 });
  const bot = (await room()).players.find((p) => p.kind === 'bot');
  await api(owner, path + '/team', 'PUT', { playerId: bot.id, position: 2 });
  for (const user of users) {
    await user.page.goto(base + `/join/${code}`);
    await user.page.locator('#my-seat').waitFor();
    await api(user, path + '/me/ready', 'PUT', { ready: true });
  }
  await api(owner, path + '/start', 'POST', {});
  await owner.page.waitForFunction(
    () =>
      document.querySelectorAll('[data-general] img').length === 8 &&
      [...document.querySelectorAll('[data-general] img')].every((i) => i.naturalWidth > 0),
  );
  await bounded(owner, '#doudizhu-panel');
  await capture(owner, '01-bidding-landscape');
  await capture(owner, '02-bidding-portrait-rotated', 390, 844);
  await owner.page.locator('#match-orientation').tap();
  await capture(owner, '03-bidding-portrait-upright', 390, 844);
  await bounded(owner, '#doudizhu-panel');
  let snapshot = await room();
  const wanted = snapshot.players[1].id;
  while (snapshot.doudizhu.phase === 'bidding') {
    const actor = snapshot.doudizhu.bidSeatId;
    const user = actor === bot.id ? owner : users.find((u) => u.id === actor);
    assert(user);
    const control = user.page
      .locator('#doudizhu-bids button')
      .filter({ hasText: actor === wanted ? '叫 4 倍' : '不叫' });
    await control.waitFor();
    await bounded(user, '#doudizhu-bids button:last-child');
    await control.tap();
    for (let i = 0; i < 60; i++) {
      const next = await room();
      if (next.doudizhu.bids.length > snapshot.doudizhu.bids.length) {
        snapshot = next;
        break;
      }
      await wait(100);
    }
  }
  await owner.page.locator('#doudizhu-confirm').waitFor();
  await owner.page.locator('.doudizhu-seat:not([hidden]) [data-general]').first().tap();
  await bounded(owner, '#doudizhu-confirm');
  await capture(owner, '04-choosing-portrait-upright', 390, 844);
  await owner.page.locator('#doudizhu-show-detail').tap();
  await capture(owner, '05-skills-portrait-drawer', 390, 844);
  await owner.page.locator('#doudizhu-close-detail').tap();
  await capture(owner, '06-choosing-landscape');
  const slot = await owner.page
    .locator('.doudizhu-seat:not([hidden]) [data-general]')
    .first()
    .elementHandle();
  const firstBox = await bounded(owner, '#doudizhu-confirm');
  await owner.page.locator('.doudizhu-seat:not([hidden]) [data-general]').nth(1).tap();
  assert(await slot.evaluate((node) => node.isConnected), 'candidate slot survives selection');
  assert.deepEqual(await bounded(owner, '#doudizhu-confirm'), firstBox, 'fixed confirm geometry');
  const before = await api(owner, path + '/me/doudizhu');
  await owner.page.locator('#doudizhu-replace').tap();
  await owner.page.waitForFunction(() =>
    document.querySelector('#doudizhu-quota').textContent.includes('1 次'),
  );
  const replaced = await api(owner, path + '/me/doudizhu');
  assert.equal(replaced.preparation.deadline, before.preparation.deadline);
  assert.equal(replaced.seats.find((s) => s.id === bot.id).replacementsLeft, 2);
  await owner.page.locator('.doudizhu-seat:not([hidden]) [data-general]').first().tap();
  await owner.page.locator('#doudizhu-confirm').tap();
  await owner.page.waitForFunction(
    (id) =>
      document.querySelector('.draft-task[aria-pressed=true]')?.getAttribute('data-seat') === id,
    bot.id,
  );
  await capture(owner, '07-auto-next-ai-task');
  await capture(owner, '08-small-landscape', 667, 375);
  await bounded(owner, '#doudizhu-confirm');
  await owner.page.reload();
  await owner.page.waitForFunction(
    (id) =>
      document.querySelector('.draft-task[aria-pressed=true]')?.getAttribute('data-seat') === id,
    bot.id,
  );
  const recovered = await api(owner, path + '/me/doudizhu');
  assert.deepEqual(recovered, await api(owner, path + '/me/doudizhu'));
  assert.equal(recovered.preparation.deadline, before.preparation.deadline);
  for (const user of users) {
    const view = await api(user, path + '/me/doudizhu');
    for (const seat of view.seats.filter((s) => !s.locked)) {
      await user.page.locator(`.draft-task[data-seat="${seat.id}"]`).tap();
      await user.page.locator('.doudizhu-seat:not([hidden]) [data-general]').first().tap();
      await user.page.locator('#doudizhu-confirm').tap();
    }
  }
  for (let i = 0; i < 150; i++) {
    snapshot = await room();
    if (snapshot.matchId) break;
    await wait(100);
  }
  assert(snapshot.matchId);
  await host.waitForFunction(
    (id) =>
      [...document.querySelectorAll('iframe')].some(
        (f) =>
          f.src.includes('/engine/worker/' + id) && f.contentWindow?.partyEngine?.proof.hostReady,
      ),
    snapshot.matchId,
    { timeout: 120000 },
  );
  const worker = host.frames().find((f) => f.url().includes('/engine/worker/' + snapshot.matchId));
  console.log('Pregame UI and recovery checks passed; connecting native players.');
  await Promise.all(
    users.slice(0, 2).map(async (user) => {
      await user.page.waitForFunction(
        () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
        null,
        { timeout: 120000 },
      );
      user.frame = user.page.frames().find((f) => f.url().includes('/engine/player/'));
      await chooseGeneral(user.frame, worker);
    }),
  );
  await worker.waitForFunction(() => partyEngine.proof.started, null, { timeout: 120000 });
  await owner.page.setViewportSize({ width: 844, height: 390 });
  await owner.frame.locator('#party-farmer-hand-toggle').waitFor();
  const anchor = await owner.frame
    .locator('#party-farmer-hand-toggle')
    .evaluate((el) => el.parentElement.playerid);
  assert.equal(anchor, bot.id, 'hand entry belongs to the actual teammate avatar');
  await capture(owner, '09-farmer-table-collapsed');
  await owner.frame.locator('#party-farmer-hand-toggle').tap();
  await owner.frame.locator('#party-farmer-hand').waitFor();
  const placement = await owner.frame.locator('#party-farmer-hand').evaluate((node) => {
    const r = node.getBoundingClientRect();
    const protectedNodes = [
      ...partyEngine.game.players,
      ...partyEngine.game.dead,
      partyEngine.ui.handcards1Container,
      ...(partyEngine.ui.controls ?? []),
    ].filter((el) => el?.isConnected);
    return {
      box: { x: r.x, y: r.y, width: r.width, height: r.height },
      overlaps: protectedNodes.filter((el) => {
        const p = el.getBoundingClientRect();
        return (
          p.width &&
          p.height &&
          r.left < p.right &&
          r.right > p.left &&
          r.top < p.bottom &&
          r.bottom > p.top
        );
      }).length,
    };
  });
  assert.equal(
    placement.overlaps,
    0,
    'read-only cards cannot cover native avatars, own cards or controls',
  );
  assert.equal(
    await owner.frame.locator('#party-farmer-hand .card, #party-farmer-hand .selectable').count(),
    0,
  );
  await capture(owner, '10-farmer-table-expanded');
  await capture(owner, '11-farmer-table-small', 667, 375);
  await users[2].page
    .locator('#spectator-table .observer-seat')
    .first()
    .waitFor({ timeout: 15000 });
  assert.equal(await users[2].page.locator('#game-frame').count(), 0);
  assert.equal(await users[2].page.locator('.observer-seat').count(), 3);
  await capture(users[2], '12-standby-landscape');
  await capture(users[2], '13-standby-portrait-rotated', 390, 844);
  await owner.page.locator('#stage-more').tap();
  await capture(owner, '14-more-tools');
  await owner.page.getByRole('button', { name: '关闭比赛工具' }).tap();
  // A real unanimous resignation checks both the standby dialog and the public score.
  for (const user of users) await api(user, `/engine/surrender/${snapshot.matchId}`);
  await wait(500);
  await api(users[1], `/engine/surrender/${snapshot.matchId}`, 'POST', {
    action: 'request',
    epoch: '',
  });
  await users[2].page.locator('#surrender-dialog').waitFor();
  await users[2].page.locator('#surrender-confirm').tap();
  for (let i = 0; i < 100 && (await room()).phase !== 'finished'; i++) await wait(100);
  snapshot = await room();
  assert.equal(snapshot.phase, 'finished');
  assert.equal(snapshot.series.completedGames, 1);
  assert.deepEqual(snapshot.series.results, [{ game: 1, winner: 0, points: 4 }]);
  await owner.page.locator('#rematch-button').waitFor();
  await owner.frame.waitForFunction(
    () =>
      !document.querySelector('#party-farmer-hand') &&
      !document.querySelector('#party-farmer-hand-toggle'),
  );
  await capture(owner, '15-round-ended-short', 667, 375);
  await bounded(owner, '#stage-more');
  await bounded(owner, '#rematch-button');
  await capture(owner, '16-round-ended-portrait', 390, 844);
  await bounded(owner, '#stage-more');
  await bounded(owner, '#rematch-button');
  await owner.page.locator('#rematch-button').tap();
  await owner.page.locator('#college-rest').waitFor();
  await owner.page.setViewportSize({ width: 844, height: 390 });
  await bounded(owner, '#college-ready');
  await capture(owner, '17-series-intermission');
  assert((await owner.page.locator('#college-rest-score').textContent()).includes('A队 +4分'));
  for (const user of users) await user.page.locator('#college-ready').tap();
  await owner.page.locator('#college-start').tap();
  await owner.page.locator('#doudizhu-panel').waitFor();
  assert.equal((await room()).series.completedGames, 1);
  report.checks.push(
    'bounded bidding/selection in rotated portrait, upright portrait and short landscape',
    'stable candidate slots and fixed confirm',
    'separate replacement quotas and unchanged recovery deadline',
    'own task automatically advances to AI teammate',
    'real native deal and read-only hand view anchored to teammate',
    'standby uses only three public seats without native player channel',
    'unanimous resignation scores once, shared intermission and next game',
  );
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error.stack ?? error);
  report.errors = errors;
  report.diagnostics = [];
  for (const page of browser.contexts().flatMap((context) => context.pages())) {
    for (const f of page.frames().filter((f) => /\/engine\/(player|worker)\//.test(f.url()))) {
      report.diagnostics.push(
        await f
          .evaluate(() => ({
            role: partyEngine.setup.role,
            proof: partyEngine.proof,
            event: partyEngine._status.event?.name,
            paused: partyEngine._status.paused,
            dialog: partyEngine.ui.dialog?.textContent?.slice(0, 300),
            controls: partyEngine.ui.controls?.map((c) => c.textContent),
            own: partyEngine.game.me?.identity,
          }))
          .catch((e) => ({ error: String(e) })),
      );
    }
  }
  throw error;
} finally {
  await writeFile(output + '/result.json', JSON.stringify(report, null, 2) + '\n');
  if (code) party.lobby.get(code).consoleClose();
  await browser.close();
  party.stop();
  console.log('College UI evidence: ' + output);
}
