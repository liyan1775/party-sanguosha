// SPDX-License-Identifier: GPL-3.0-only
// Real native battles across the curated map. No room API/UI acceptance claim.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { createPartyServer } from '../apps/server/src/server.ts';
import { ShanhetuCampaign } from '../apps/server/src/shanhetu-campaign.ts';
import { createShanhetuScenario } from '../apps/server/src/shanhetu-scenario.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hero = process.env.SHANHETU_CAMPAIGN_HERO ?? 'caocao';
const output = `${root}/.runtime/shanhetu-campaign-native/${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${hero}-${randomUUID().slice(0, 8)}`;
await mkdir(output, { recursive: true });
const catalog = createShanhetuScenario([hero]);
if (process.env.SHANHETU_CAMPAIGN_REGION) {
  assert(['2', '4'].includes(process.env.SHANHETU_CAMPAIGN_REGION));
  catalog.initialRegion = `region-${process.env.SHANHETU_CAMPAIGN_REGION}`;
}
const campaign = new ShanhetuCampaign(catalog);
const adapter = new NativeNonameService(root);
assert(adapter.status().preload);
const party = createPartyServer({
  webRoot: `${root}/dist/web`,
  port: 0,
  adapter,
  rosterDirectory: `${output}/rosters`,
});
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${party.server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const computer = await browser.newPage();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const phone = await context.newPage();
const errors = [],
  missing = new Set(),
  results = [],
  progression = [];
for (const page of [computer, phone]) {
  page.on('pageerror', (error) => errors.push(String(error.stack)));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /\b(?:TypeError|SyntaxError|ReferenceError):/.test(message.text())
    )
      errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/engine/'))
      missing.add(new URL(response.url()).pathname);
  });
}
let code, ownerId;
const events = [];
const unsubscribe = adapter.subscribe((event) => {
  if (event.type === 'status') return;
  events.push(event);
  if (event.type === 'ended' && event.shanhetu?.runId === campaign.view().id)
    assert(campaign.settle(event.matchId, event.shanhetu));
});
const act = (action) => {
  assert(action);
  const view = campaign.view();
  progression.push({
    phase: view.phase,
    chapter: view.chapter,
    days: view.days,
    region: view.map?.name,
    action: action.label,
    coins: view.coins,
  });
  return campaign.act({ runId: view.id, revision: view.revision, actionId: action.id });
};
const priority = (action) => {
  if (/摸牌|青囊|英姿|闭月|当头一棒|护甲|八卦阵|仁王盾/.test(action.label)) return 10;
  if (/苦肉/.test(action.label)) return -10;
  if (action.label === '放弃本次奖励') return -1;
  return 0;
};
async function battle(ticket) {
  const before = campaign.view();
  const starting = adapter.start({
    roomCode: code,
    ownerPlayerId: ownerId,
    settings: {
      mode: 'identity',
      playerCount: 1,
      generalPreset: 'beginner',
      allowGeneralSelection: false,
      extensions: [],
    },
    seats: [{ id: ownerId, nickname: '征程验证', kind: 'human' }],
    aiPolicy: 'strongest-native',
    shanhetu: ticket,
  });
  void starting.catch(() => {});
  const matchId = adapter.matchId(code);
  campaign.bindMatch(ticket, matchId);
  await phone.goto(`${origin}/engine/player/${matchId}`);
  await computer.waitForFunction(
    (id) =>
      [...document.querySelectorAll('.engine-worker')].some(
        (frame) => frame.src.endsWith(id) && frame.contentWindow?.partyEngine?.proof.hostReady,
      ),
    matchId,
    { timeout: 120000 },
  );
  const worker = computer
    .frames()
    .find((frame) => frame.url().endsWith(`/engine/worker/${matchId}`));
  await chooseGeneral(phone.mainFrame(), worker);
  await starting;
  const opening = await worker.evaluate(() => ({
    general: partyEngine.game.zhu.name1,
    actors: partyEngine.proof.shanhetu.actors,
    pile: partyEngine.lib.card.list.length,
    rarities: partyEngine.setup.shanhetuGrowth.tactics.every(
      (tactic) =>
        partyEngine.lib.zhanfa.getRarity(tactic.nativeId, true) ===
        ['common', 'rare', 'epic', 'legend'][tactic.rarity - 1],
    ),
    skills: partyEngine.setup.shanhetu.build.skills.every((id) =>
      partyEngine.game.zhu.hasSkill(
        partyEngine.setup.shanhetuGrowth.skills.find((skill) => skill.id === id).nativeId,
      ),
    ),
    tactics: partyEngine.setup.shanhetu.build.tactics.every((id) =>
      partyEngine.game.zhu.hasZhanfa(
        partyEngine.setup.shanhetuGrowth.tactics.find((tactic) => tactic.id === id).nativeId,
      ),
    ),
  }));
  assert.equal(opening.general, hero);
  assert.equal(opening.pile, 135);
  assert(opening.skills && opening.tactics);
  assert(opening.rarities);
  const enemies = await worker.evaluate(() =>
    partyEngine.game.players
      .filter((player) => player.side === false)
      .flatMap((player) => player.getCards('h').map((card) => card.cardid)),
  );
  assert.equal(
    await phone.evaluate(
      (ids) =>
        partyEngine.game.players
          .filter((player) => player.side === false)
          .flatMap((player) => player.getCards('h'))
          .some((card) => ids.includes(card.cardid) && card.name !== 'party_unknown'),
      enemies,
    ),
    false,
  );
  await phone.reload();
  await phone.waitForFunction(
    () => globalThis.partyEngine?.game.me?.name1 && partyEngine.proof.booted,
    {},
    { timeout: 120000 },
  );
  assert.equal(await phone.evaluate(() => partyEngine.game.me.name1), hero);
  assert.equal(adapter.matchId(code), matchId);
  await phone.waitForFunction(
    () => {
      const { setup, game } = partyEngine;
      return (
        setup.shanhetu.build.skills.every((id) =>
          game.me.hasSkill(setup.shanhetuGrowth.skills.find((skill) => skill.id === id).nativeId),
        ) &&
        setup.shanhetu.build.tactics.every((id) =>
          game.me.hasZhanfa(
            setup.shanhetuGrowth.tactics.find((tactic) => tactic.id === id).nativeId,
          ),
        )
      );
    },
    {},
    { timeout: 5000 },
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
  const deadline = Date.now() + 240000;
  while (!events.some((event) => event.type === 'ended' && event.matchId === matchId)) {
    assert(!events.some((event) => event.type === 'failed' && event.matchId === matchId));
    assert(Date.now() < deadline, 'Native campaign battle timed out');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const ended = events.find((event) => event.type === 'ended' && event.matchId === matchId);
  const result = {
    ...ended.shanhetu,
    chapter: before.chapter,
    days: before.days,
    region: before.map.name,
    kind: before.node.kind,
    opening,
    concealedEnemyHands: true,
    refreshed: true,
  };
  results.push(result);
  await phone.screenshot({ path: `${output}/battle-${results.length}.png` });
  console.log(
    `Chapter ${before.chapter} ${before.map.name} ${ticket.battleId}: ${ended.shanhetu.outcome}`,
  );
}
try {
  await computer.goto(`${origin}/server`);
  await phone.goto(origin);
  const response = await context.request.post(`${origin}/api/rooms`, {
    data: { nickname: '征程验证' },
  });
  assert.equal(response.status(), 201);
  const created = await response.json();
  code = created.room.code;
  ownerId = created.playerId;
  for (let step = 0; step < 150; step++) {
    const view = campaign.view();
    if (['won', 'lost'].includes(view.phase)) break;
    let selected;
    if (view.phase === 'selection') selected = view.actions[0];
    else if (view.phase === 'reward')
      selected = [...view.actions].sort((a, b) => priority(b) - priority(a))[0];
    else if (view.phase === 'choice') {
      if (view.node.kind === 'shop')
        selected =
          view.actions.find((action) => action.cost <= view.coins && priority(action) > 0) ??
          view.actions.find((action) => action.label === '离开集市');
      else if (view.node.kind === 'camp')
        selected = view.actions.find(
          (action) =>
            action.label ===
            (view.hero.hp < view.hero.maxHp || view.hero.maxHp < 5
              ? '体力上限+1'
              : '摸牌阶段摸牌+1'),
        );
      else selected = [...view.actions].sort((a, b) => priority(b) - priority(a))[0];
    } else if (view.phase === 'map') {
      selected = view.actions.find((action) => action.label.startsWith('前往'));
      if (!selected) {
        const available = view.map.locations.filter((location) => location.status === 'available');
        const location =
          available.find((location) => location.kind === 'boss') ??
          available.find((location) => location.kind === 'camp') ??
          available.find((location) => location.kind === 'event') ??
          available.find((location) => location.kind === 'shop') ??
          available[0];
        selected = view.actions.find((action) => action.id === location.actionId);
      }
    }
    const result = act(selected);
    if (result.battle) await battle(result.battle);
  }
  assert(['won', 'lost'].includes(campaign.view().phase));
  assert.equal(errors.length, 0);
  assert.equal(missing.size, 0);
  const won = campaign.view().phase === 'won';
  if (won) assert.equal(results.filter((result) => result.kind === 'boss').length, 3);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        scope:
          'Curated normal-1 source map, direct adapter integration; no room UI or physical phone acceptance',
        physicalPhone: false,
        won,
        results,
        progression,
        final: campaign.view(),
        errors,
        missing: [...missing],
      },
      null,
      2,
    ),
  );
  assert(
    won || process.env.SHANHETU_REQUIRE_VICTORY === '0',
    'Natural defeat observed before campaign victory',
  );
  console.log(`Native map campaign ${won ? 'won' : 'lost'}: ${output}`);
} catch (error) {
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: String(error.stack),
        events,
        errors,
        missing: [...missing],
        results,
        progression,
        final: campaign.view(),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  unsubscribe();
  if (code) adapter.release(code);
  await browser.close();
  const closed = once(party.server, 'close');
  party.stop();
  party.server.closeAllConnections();
  await closed;
}
