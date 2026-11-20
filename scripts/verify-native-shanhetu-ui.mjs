// SPDX-License-Identifier: GPL-3.0-only
// Actual mobile-sized journey with native battles. Isolated preview.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { ShanhetuBook } from '../apps/server/src/shanhetu-book.ts';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { shanhetuRecipe } from '../packages/noname-adapter/src/shanhetu.ts';
import { chooseGeneral } from './native-ui-actions.mjs';
import source from '../config/shanhetu-scenario.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));
const nightmareBook = process.env.SHANHETU_VERIFY_NIGHTMARE_BOOK;
const exploreBook = process.env.SHANHETU_VERIFY_EXPLORATION === '1';
const full = exploreBook || process.env.SHANHETU_VERIFY_FULL === '1';
const fullHard = full && process.env.SHANHETU_VERIFY_HARD === '1';
const fullMedium = full && (exploreBook || fullHard || process.env.SHANHETU_VERIFY_MEDIUM === '1');
const stopAfterExploration = exploreBook && !fullHard;
const fullNormal2 = full && !fullMedium && process.env.SHANHETU_VERIFY_NORMAL2 === '1';
const fullNormal3 = fullNormal2 && process.env.SHANHETU_VERIFY_NORMAL3 === '1';
const checkRestart = process.env.SHANHETU_VERIFY_RESTART === '1';
const nextOpening =
  (fullMedium || fullNormal2) && process.env.SHANHETU_VERIFY_BOOK_TACTIC !== 'inheritance'
    ? { name: '和光盟', id: 2219 }
    : { name: '传承', id: 2138 };
const output = `${root}/.runtime/shanhetu-ui/${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
await mkdir(output, { recursive: true });
const adapter = new NativeNonameService(root);
assert(adapter.status().preload && adapter.status().shanhetu);
const party = createPartyServer({
  port: 0,
  webRoot: `${root}/dist/web`,
  adapter,
  rosterDirectory: `${output}/rosters`,
  shanhetuDirectory: `${output}/book`,
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
if (nightmareBook) {
  // Transfer only a prior test run's durable achievements. The room, browser and campaign are new.
  const seed = await readFile(nightmareBook, 'utf8');
  const saved = JSON.parse(seed);
  assert.equal(saved.scenarioId, 5);
  assert(saved.profile.receipts.some((r) => r.outcome === 'victory' && r.difficulty === 11));
  const credential = randomBytes(32).toString('base64url');
  await mkdir(output + '/book', { recursive: true });
  await writeFile(output + '/book/' + ShanhetuBook.profileKey(credential) + '.json', seed, {
    flag: 'wx',
  });
  await context.addCookies([
    {
      name: 'party_shanhetu_book',
      value: credential,
      url: origin,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
}
const phone = await context.newPage();
const errors = [],
  missing = new Set(),
  events = [],
  checks = { battles: [], recruits: [], purchases: [] };
const exploredCities = new Set();
for (const page of [phone, computer]) {
  page.on('pageerror', (error) => errors.push(String(error.stack)));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /\b(?:TypeError|SyntaxError|ReferenceError):/.test(message.text())
    )
      errors.push(message.text());
  });
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && /^\/(engine\/|assets\/shanhetu-)/.test(path)) missing.add(path);
  });
}
const unsubscribe = adapter.subscribe((event) => {
  if (event.type !== 'status') events.push(event);
});
let room;
const wait = async (condition, message, timeout = 120000) => {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    assert(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
const shot = async (name) => phone.screenshot({ path: `${output}/${name}.png` });
const journey = () => room.snapshot().shanhetu;
const nightmareHeroes = [
  'mb_shen_machao',
  'shen_taishici',
  're_xusheng',
  'mb_caomao',
  'shen_ganning',
  'shen_guojia',
];
const preferredHero = (picks) =>
  [
    ...(nightmareBook ? nightmareHeroes : []),
    'machao',
    'zhaoyun',
    'caocao',
    'zhangfei',
    'huaxiong',
    'guanyu',
    'sunquan',
  ].find((id) => picks.includes(id)) ?? picks[0];
async function select(action) {
  assert(action, 'No usable journey action');
  const { revision } = journey();
  await phone.locator(`#shanhetu-panel [data-action-id="${action.id}"]`).tap();
  await expect(phone.locator('#shanhetu-confirm')).toBeEnabled();
  await phone.locator('#shanhetu-confirm').tap();
  await wait(() => journey().revision > revision, `Action not applied: ${action.label}`);
}
function locationAction(kind) {
  const view = journey();
  const location = view.map.locations.find(
    (location) => location.actionId && location.kind === kind,
  );
  return view.actions.find((action) => action.id === location?.actionId);
}
function recruitmentAction() {
  const view = journey();
  const region = source.regions.find((region) => `region-${region.id}` === view.map.regionId);
  const locationId = `city-${region.locations[source.localSampling.recruitmentIndex].id}`;
  const location = view.map.locations.find((location) => location.id === locationId);
  return view.actions.find((action) => action.id === location?.actionId);
}
async function battle(general, restart = false) {
  await wait(() => !!room.snapshot().matchId, 'No native match allocated');
  const matchId = room.snapshot().matchId;
  const { id: runId, companions, chapter, node, map, difficulty } = journey();
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
  const playerFrame = () =>
    phone.frames().find((frame) => frame.url().includes(`/engine/player/${matchId}`));
  await expect(phone.locator('#game-frame')).toBeVisible();
  await phone.waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
    {},
    { timeout: 120000 },
  );
  await chooseGeneral(playerFrame(), worker);
  await wait(
    () => room.snapshot().phase === 'playing',
    'Real native initialization was not acknowledged',
  );
  if (restart) {
    const old = journey();
    const button = phone.locator('#shanhetu-restart');
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    await expect(button).toBeEnabled({ timeout: 40000 });
    const dialog = phone.locator('#shanhetu-end-dialog');
    await button.tap();
    await dialog.getByRole('button', { name: '继续本关', exact: true }).tap();
    assert.equal(room.snapshot().matchId, matchId);
    await button.tap();
    await dialog.getByRole('button', { name: '确认重开', exact: true }).tap();
    await wait(
      () => room.snapshot().matchId && room.snapshot().matchId !== matchId,
      'No fresh native match after restart',
    );
    const next = journey();
    assert.equal(next.restartsLeft, 9);
    for (const field of ['id', 'days', 'coins', 'hero', 'build', 'companions', 'node'])
      assert.deepEqual(next[field], old[field]);
    assert(!events.some((event) => event.type === 'ended' && event.matchId === matchId));
    checks.restart = { cooldownSeconds: 30, restartsLeft: 9, freshMatch: true };
    return battle(general);
  }
  const opening = await worker.evaluate(() => {
    const { game, setup, proof, lib } = partyEngine;
    return {
      general: game.zhu.name1,
      battleId: setup.shanhetu.battleId,
      difficulty: setup.shanhetu.difficulty,
      chapter: setup.shanhetu.chapter,
      terrain: setup.shanhetuTerrain?.id ?? null,
      activeTerrain:
        setup.shanhetuTerrain == null ||
        game.players.every((player) => player.hasSkill('party_shanhetu_terrain')),
      elapsedMonths: setup.shanhetu.elapsedMonths,
      npcCount: proof.shanhetu.actors.length - 1,
      enemies: setup.shanhetuRecipe.enemies.length,
      enemyOpening: setup.shanhetuRecipe.enemies.map((enemy, index) => {
        const id = `shanhetu-enemy-${index}`;
        const actor = proof.shanhetu.actors.find((actor) => actor.id === id);
        return {
          hp: actor.hp,
          maxHp: actor.maxHp,
          armor: actor.armor,
          cards: actor.initialCards,
          equipment: actor.equipment,
          skills: enemy.skills.filter((skill) => lib.playerOL[id].hasSkill(skill)),
        };
      }),
      growthSkills: (setup.shanhetu.build?.skills ?? []).every((id) =>
        game.zhu.hasSkill(setup.shanhetuGrowth.skills.find((skill) => skill.id === id).nativeId),
      ),
      companions: setup.shanhetuCompanions.map((companion) => {
        const id = `shanhetu-companion-${companion.id}`;
        const actor = proof.shanhetu.actors.find((actor) => actor.id === id);
        const player = lib.playerOL[id];
        const fixed = companion.fixedHand?.map(
          (card) => `${card.nativeId}/${card.suit}/${card.number}`,
        );
        const started = player._start_cards?.map(
          (card) => `${card.name}/${card.suit}/${card.number}`,
        );
        return {
          id: companion.id,
          fullHealth: actor.hp === companion.maxHp && actor.maxHp === companion.maxHp,
          handDealt: fixed
            ? JSON.stringify(fixed.sort()) === JSON.stringify(started?.sort())
            : actor.initialCards === companion.startingCards,
          fixedHand: !!fixed,
          side: player.side,
          correctSkills: companion.skills.every((skill) => player.hasSkill(skill.nativeId)),
        };
      }),
    };
  });
  assert.equal(opening.general, general);
  assert.equal(opening.difficulty, difficulty);
  assert.equal(opening.chapter, chapter);
  assert.equal(opening.terrain, map.terrain?.id ?? null);
  assert(opening.activeTerrain);
  const region = source.regions.find((item) => `region-${item.id}` === map.regionId);
  const ids =
    difficulty >= 11
      ? node.kind === 'boss'
        ? region.hardBossIds
        : region.hardBattleIds
      : difficulty > 1
        ? node.kind === 'boss'
          ? region.regularBossIds
          : region.regularBattleIds
        : node.kind === 'boss'
          ? region.bossIds
          : region.battleIds;
  assert(ids.includes(opening.battleId));
  const rules = source.difficulties.find((rule) => rule.id === difficulty);
  const byEquipmentName = (left, right) => left.name.localeCompare(right.name);
  assert.deepEqual(
    opening.enemyOpening.map((actor) => ({
      ...actor,
      equipment: actor.equipment.toSorted(byEquipmentName),
    })),
    shanhetuRecipe(opening.battleId, difficulty, opening.elapsedMonths, chapter).enemies.map(
      (enemy) => ({
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        armor: enemy.armor,
        cards: enemy.startingCards + (enemy.fixedHand?.length ?? 0),
        equipment: (enemy.fixedEquipment ?? [])
          .map(({ nativeId: name, suit, number }) => ({
            name,
            suit,
            number,
          }))
          .toSorted(byEquipmentName),
        skills: enemy.skills,
      }),
    ),
  );
  assert(opening.growthSkills);
  assert.equal(opening.npcCount, opening.enemies + companions.length);
  assert.deepEqual(
    opening.companions.map((companion) => companion.id),
    companions,
  );
  assert(
    opening.companions.every(
      (companion) =>
        companion.fullHealth && companion.handDealt && companion.side && companion.correctSkills,
    ),
  );
  assert.equal(room.snapshot().players.length, 1);
  const concealed = async () => {
    const hidden = await worker.evaluate(() => {
      const { game } = partyEngine;
      return game.players
        .filter((player) => player !== game.zhu)
        .flatMap((player) => player.getCards('h').map((card) => card.cardid));
    });
    assert(hidden.length > 0);
    assert(
      await playerFrame().evaluate((ids) => {
        const { game, lib } = partyEngine;
        const npcs = game.players.filter((player) => player !== game.me);
        return (
          npcs
            .flatMap((player) => player.getCards('h'))
            .every((card) => !ids.includes(card.cardid) || card.name === 'party_unknown') &&
          ids.every((id) => !lib.cardOL[id] || lib.cardOL[id].name === 'party_unknown')
        );
      }, hidden),
      'A private NPC card appeared on the phone',
    );
  };
  await concealed();
  await phone.reload();
  await phone.waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.game.me?.name1,
    {},
    { timeout: 120000 },
  );
  assert.equal(await playerFrame().evaluate(() => partyEngine.game.me.name1), general);
  assert.equal(room.snapshot().matchId, matchId);
  assert(
    await playerFrame().evaluate(() => {
      const { game, lib, setup } = partyEngine;
      return (
        (!setup.shanhetuTerrain || game.me.hasSkill('party_shanhetu_terrain')) &&
        (setup.shanhetu.build?.skills ?? []).every((id) =>
          game.me.hasSkill(setup.shanhetuGrowth.skills.find((skill) => skill.id === id).nativeId),
        ) &&
        setup.shanhetuCompanions.every((companion) => {
          const actor = lib.playerOL[`shanhetu-companion-${companion.id}`];
          return (
            actor?.side === game.me.side &&
            companion.skills.every((skill) => actor.hasSkill(skill.nativeId))
          );
        })
      );
    }),
  );
  await concealed();
  if (journey().initialTactics.includes('博闻Ⅰ')) {
    const marked = () =>
      playerFrame().evaluate(() => {
        const { game } = partyEngine;
        return game.me.hasZhanfa('zf_bowen') && Boolean(game.me.marks.zhanfa?.isConnected);
      });
    await expect.poll(marked).toBe(true);
    assert(await worker.evaluate(() => partyEngine.game.zhu.hasZhanfa('zf_bowen')));
    checks.exploration.restored = true;
  }
  if (
    !checks.battles.length ||
    companions.length > (checks.battles.at(-1)?.opening.companions.length ?? 0)
  )
    await shot(`native-${checks.battles.length + 1}-refreshed`);
  await worker.evaluate(() => {
    partyEngine.lib.config.game_speed = 'vvfast';
    partyEngine.lib.config.duration = 100;
    partyEngine.game.broadcast(function () {
      partyEngine.lib.config.game_speed = 'vvfast';
      partyEngine.lib.config.duration = 100;
      if (!partyEngine._status.auto) partyEngine.ui.click.auto();
    });
  });
  const trace = [];
  let sampling = false;
  const observe = async () => {
    if (sampling || room.snapshot().phase !== 'playing') return;
    sampling = true;
    try {
      const summary = await worker.evaluate(() => {
        const { game, _status, lib } = partyEngine;
        return {
          round: game.roundNumber,
          turn: game.phaseNumber,
          event: _status.event?.name,
          active: lib.translate[_status.currentPhase?.name1] ?? null,
          seats: game.players.map((seat) => ({
            general: lib.translate[seat.name1],
            hp: seat.hp,
            maxHp: seat.maxHp,
          })),
        };
      });
      const auto = await playerFrame().evaluate(() => Boolean(partyEngine._status.auto));
      trace.push({ observed: new Date().toISOString(), ...summary, auto });
      await writeFile(
        `${output}/native-progress-${matchId}.json`,
        JSON.stringify({ difficulty, chapter, encounter: node.name, trace }, null, 2),
      );
    } catch {
      // The result can close the native frame while a sample is in flight.
    } finally {
      sampling = false;
    }
  };
  const monitor = difficulty >= 16 ? setInterval(observe, 30000) : undefined;
  try {
    await wait(
      () => room.snapshot().phase === 'finished',
      'Native settlement not received',
      difficulty >= 16 ? 600000 : 120000,
    );
  } finally {
    clearInterval(monitor);
  }
  const ended = events.find((event) => event.type === 'ended' && event.matchId === matchId);
  assert(ended?.shanhetu, 'No authenticated PVE settlement');
  const { outcome, defeatedEnemies } = ended.shanhetu;
  if (exploreBook && outcome === 'victory' && chapter === 2 && node.kind === 'boss')
    exploredCities.add(map.name);
  if (journey().initialTactics.includes('博闻Ⅰ')) {
    const gains = await worker.evaluate(() => {
      const { game, get, lib } = partyEngine;
      const skill = lib.zhanfa.getSkill('zf_bowen');
      return game.zhu
        .getAllHistory('gain')
        .filter((gain) => gain.getParent(skill)?.name === skill)
        .map((gain) => gain.cards.length === 1 && get.type2(gain.cards[0]) === 'trick');
    });
    assert(gains.length > 0 && gains.every(Boolean), '博闻Ⅰ did not obtain a native trick card');
    checks.exploration.trickGains = gains.length;
  }
  if (outcome === 'victory') assert.equal(defeatedEnemies, opening.enemies);
  const nativeHero = ended.shanhetu.hero;
  const expectedRecovery =
    outcome === 'victory' && !rules.preserveHp
      ? Math.min(nativeHero.maxHp - nativeHero.hp, source.victoryRecovery[node.kind])
      : 0;
  assert.equal(journey().hero.hp, nativeHero.hp + expectedRecovery);
  assert.equal(journey().lastBattle.recoveredHp ?? 0, expectedRecovery);
  const npcSkillUses = await worker.evaluate(() => {
    const { lib, setup } = partyEngine;
    return setup.shanhetuRecipe.enemies.map((enemy, index) => {
      const player = lib.playerOL[`shanhetu-enemy-${index}`];
      const observed = [
        ...enemy.skills,
        ...(enemy.nextForm?.skills ?? []),
        'chixueqingfeng',
        'fangtian_skill',
        'wushuangfangtianji_skill',
        'party_shanhetu_inferno_halberd_skill',
      ];
      return player
        .getAllHistory('useSkill')
        .map((event) => event.skill)
        .filter((skill) => observed.includes(skill));
    });
  });
  const secondForms = await worker.evaluate(() => {
    const { lib, setup } = partyEngine;
    return setup.shanhetuRecipe.enemies.flatMap((_, index) => {
      const player = lib.playerOL[`shanhetu-enemy-${index}`];
      return player.name1.endsWith('_stage2') ? [lib.translate[player.name1]] : [];
    });
  });
  checks.battles.push({
    runId,
    difficulty,
    chapter,
    node: node.name,
    kind: node.kind,
    outcome,
    defeatedEnemies,
    nativeHp: nativeHero.hp,
    settledHp: journey().hero.hp,
    opening,
    npcSkillUses,
    secondForms,
  });
  if (nightmareBook) await writeFile(`${output}/progress.json`, JSON.stringify(checks, null, 2));
  console.log(
    `${rules.name}, chapter ${chapter} ${map.name} ${node.name}: ${outcome}, ${companions.length} companions`,
  );
  const returnLabel = ['won', 'lost'].includes(journey().phase) ? '查看结局' : '继续征程';
  await expect(phone.locator('#rematch-button')).toHaveText(returnLabel);
  const nativeReturn = phone.frameLocator('#game-frame').locator('#party-return-room');
  await expect(nativeReturn).toHaveText(returnLabel);
  if (returnLabel === '查看结局' && !checks.endingReturnRestored) {
    await phone.reload();
    await expect(phone.locator('#rematch-button')).toHaveText(returnLabel);
    await expect(nativeReturn).toHaveText(returnLabel, { timeout: 120000 });
    assert.equal(room.snapshot().matchId, matchId);
    checks.endingReturnRestored = true;
  }
  await nativeReturn.tap();
  await expect(phone.locator('#shanhetu-panel')).toBeVisible();
  await expect(phone.locator('#game-frame')).toHaveCount(0);
  return outcome;
}
function nightmareUpgrade(actions) {
  // Choose only from visible offers. Round armor and damage persist across battles.
  const priorities = [
    /护甲Ⅱ|当头一棒Ⅱ/,
    /护甲Ⅰ|当头一棒|摸牌Ⅱ|远击技|弱袭|当先/,
    /摸牌|起始手牌|起手牌|体力上限|英姿|称象|卫境|青囊|八卦阵|白银狮子/,
    /护甲|咆哮|无中生有|连弩|淬血|倾国/,
  ];
  for (const pattern of priorities) {
    const offer = actions.find((action) => pattern.test(action.label));
    if (offer) return offer;
  }
}
async function playRemainingRoute(general, allowDefeat = false, stopAfterSecondChapter = false) {
  const { id: runId, difficulty } = journey();
  const shopsVisited = new Set();
  let refreshedShop = false;
  let bought = false;
  let capturedShop = false;
  let capturedCamp = false;
  for (let step = 0; step < 120; step++) {
    const view = journey();
    if (stopAfterSecondChapter && exploredCities.size >= 2) return true;
    if (view.phase === 'won' || view.phase === 'lost') break;
    if (view.phase === 'reward') {
      const reward = view.actions.find((action) =>
        /摸牌|狂骨|当头一棒|无中生有|狭路相逢/.test(action.label),
      );
      await select(
        (difficulty >= 16 ? nightmareUpgrade(view.actions) : undefined) ??
          reward ??
          view.actions[0],
      );
    } else if (view.phase === 'choice') {
      if (view.node.kind === 'shop') {
        if (!capturedShop) {
          await shot(`shop-${difficulty}`);
          capturedShop = true;
        }
        const affordable = view.actions.filter(
          (action) => action.kind === 'buy' && action.cost <= view.coins,
        );
        const purchase = difficulty >= 16 ? nightmareUpgrade(affordable) : !bought && affordable[0];
        if (purchase) {
          await select(purchase);
          assert.equal(journey().coins, view.coins - purchase.cost);
          checks.purchases.push({ runId, label: purchase.label, cost: purchase.cost });
          bought = true;
          continue;
        }
        const refresh = view.actions.find(
          (action) => action.cost === 0 && action.label.includes('刷新'),
        );
        if (refresh && (difficulty >= 16 || !refreshedShop)) {
          await select(refresh);
          refreshedShop = true;
        } else await select(view.actions.find((action) => action.label === '离开集市'));
      } else if (view.node.kind === 'camp') {
        if (!capturedCamp) {
          await shot(`camp-${difficulty}`);
          capturedCamp = true;
        }
        await select(view.actions.find((action) => action.label === '体力上限+1'));
      } else {
        const recruit = [...view.actions]
          .sort((a, b) => b.cost - a.cost)
          .find((action) => action.cost <= view.coins && action.description.includes('队友'));
        if (recruit) await shot(`event-${difficulty}-${view.chapter}`);
        await select(
          recruit ??
            (difficulty >= 16 ? nightmareUpgrade(view.actions) : undefined) ??
            view.actions.find((action) => /^获得\d+铜币$/.test(action.description)) ??
            view.actions[0],
        );
        if (journey().phase === 'battle') await battle(general);
        if (recruit) {
          assert.equal(journey().coins, view.coins - recruit.cost);
          assert.equal(journey().companions.length, view.companions.length + 1);
          checks.recruits.push({
            runId,
            difficulty,
            chapter: view.chapter,
            label: recruit.label,
            cost: recruit.cost,
          });
          await phone.getByRole('button', { name: '本局构筑', exact: true }).tap();
          const build = phone.getByRole('dialog', { name: '本局构筑' });
          await expect(build).toContainText(recruit.label.split(' · ').at(-1));
          await shot(`recruit-${difficulty}-${view.chapter}`);
          await build.getByRole('button', { name: '关闭', exact: true }).tap();
        }
      }
    } else {
      assert.equal(view.phase, 'map');
      const destinations = view.actions.filter((action) => action.kind === 'region');
      const destination =
        (difficulty > 16
          ? destinations.find((action) => /颍川郡|荥阳|河内|酸枣/.test(action.label))
          : difficulty === 16
            ? destinations.find((action) => /函谷关|崤函道/.test(action.label))
            : fullHard && difficulty === 11
              ? destinations.find((action) => /颍川郡|荥阳|河内|酸枣/.test(action.label))
              : fullMedium && difficulty === 6
                ? destinations.find((action) => /伊阙关|小平津/.test(action.label))
                : undefined) ?? destinations[0];
      if (destination) {
        await expect(phone.locator('.shanhetu-route')).toBeVisible();
        if (([6, 11].includes(difficulty) || difficulty >= 16) && view.chapter === 1) {
          const visibleCities = difficulty >= 16 ? 14 : difficulty === 11 ? 12 : 8;
          await phone.setViewportSize({ width: 320, height: 780 });
          const fit = await phone.locator('.shanhetu-route').evaluate((route, visibleCities) => {
            const cities = [...route.querySelectorAll('.shanhetu-route-city')];
            return (
              cities.length === visibleCities &&
              cities.every((city) => {
                const name = city.querySelector('strong').getBoundingClientRect();
                const frame = city.getBoundingClientRect();
                return name.left >= frame.left && name.right <= frame.right;
              }) &&
              document.documentElement.scrollWidth <= innerWidth + 1
            );
          }, visibleCities);
          assert(fit, `All ${visibleCities} cities fit on the narrow route map`);
          if (difficulty >= 11) {
            await expect(phone.locator('.shanhetu-route-terrain').first()).toBeVisible();
            const terrain = view.map.regions.filter((region) => region.actionId && region.terrain);
            for (const region of terrain) {
              const option = phone.locator('.shanhetu-route-comparison > div').filter({
                hasText: region.name,
              });
              await expect(option).toContainText(region.terrain.description);
            }
          }
          await shot(`branch-${difficulty}-320`);
          await phone.setViewportSize({ width: 390, height: 844 });
          if (difficulty >= 16) checks.narrowNightmareRoute = true;
          else if (difficulty === 11) checks.narrowHardRoute = true;
          else checks.narrowMediumRoute = true;
        }
        await shot(`branch-${difficulty}-${view.chapter}`);
        await select(destination);
      } else {
        const shop = shopsVisited.has(view.chapter) ? undefined : locationAction('shop');
        const action =
          locationAction('boss') ??
          recruitmentAction() ??
          locationAction('camp') ??
          shop ??
          locationAction('battle') ??
          locationAction('event');
        await select(action);
        if (action === shop) shopsVisited.add(view.chapter);
        if (journey().phase === 'battle') await battle(general);
      }
    }
  }
  if (allowDefeat && journey().phase === 'lost') return false;
  const battles = checks.battles.filter((item) => item.runId === runId);
  const recruits = checks.recruits.filter((item) => item.runId === runId);
  assert.equal(journey().phase, 'won', 'Journey did not end in a natural victory');
  assert(journey().finalReport?.title);
  await expect(
    phone.getByRole('heading', { name: journey().finalReport.title, exact: true }),
  ).toBeVisible();
  (checks.endings ??= []).push({ difficulty, ...journey().finalReport });
  assert.equal(
    battles.filter((item) => item.kind === 'boss' && item.outcome === 'victory').length,
    3,
  );
  if (difficulty < 16) {
    assert.equal(recruits.length, 3);
    assert(battles.some((item) => item.opening.companions.length >= 3));
  }
  assert.equal(
    journey().bookAward.victories,
    battles.filter((item) => item.outcome === 'victory').length,
  );
  await shot(`full-journey-${difficulty}`);
  return true;
}

async function chooseNextHero() {
  const general = preferredHero(journey().actions.map((action) => action.general));
  await select(journey().actions.find((action) => action.general === general));
  if (journey().initialTactics?.includes('传承')) {
    assert.equal(journey().phase, 'reward');
    assert.equal(journey().actions.length, 3);
    await select(journey().actions[0]);
    assert.equal(journey().build.skills.length, 1);
    checks.book.startingSkill = journey().build.skills[0];
  }
  if (journey().initialTactics.includes('和光盟')) assert.equal(journey().companions.length, 1);
  return general;
}

async function playNightmareJourneys(difficultyInput, chooseOpening, startJourney) {
  const preset = process.env.SHANHETU_VERIFY_NIGHTMARE_PRESET ?? 'mobile-college-2026';
  await phone.getByRole('button', { name: '房间设置', exact: true }).tap();
  await phone.locator('#general-preset').selectOption(preset);
  await wait(
    () => room.snapshot().settings.generalPreset === preset,
    'Nightmare preset was not applied',
  );
  await phone.getByRole('button', { name: '返回出征', exact: true }).tap();
  const first = Number(process.env.SHANHETU_VERIFY_NIGHTMARE_FIRST ?? 16);
  const last = Number(process.env.SHANHETU_VERIFY_NIGHTMARE_LAST ?? 20);
  assert(
    Number.isInteger(first) && Number.isInteger(last) && first >= 16 && last <= 20 && first <= last,
  );
  checks.nightmare = { first, last, preset, attempts: [], clears: [] };
  const snapshot = () => writeFile(`${output}/progress.json`, JSON.stringify(checks, null, 2));
  const profile = async () =>
    (await context.request.get(`${origin}/api/rooms/${room.code}/shanhetu/book`)).json();
  for (let difficulty = first; difficulty <= last; difficulty++) {
    await expect(difficultyInput.locator(`option[value="${difficulty}"]`)).toBeEnabled();
    if (difficulty < 20)
      await expect(difficultyInput.locator(`option[value="${difficulty + 1}"]`)).toBeDisabled();
    let cleared = false;
    for (let attempt = 0; attempt < 80 && !cleared; attempt++) {
      await difficultyInput.selectOption(String(difficulty));
      await expect(phone.locator('#shanhetu-difficulty-hint')).toContainText('函谷关');
      await chooseOpening(2219);
      await startJourney();
      await expect(phone.locator('#shanhetu-options [data-general]').first()).toBeVisible();
      assert.equal(new Set(journey().actions.map((action) => action.general)).size, 5);
      const hero = await chooseNextHero();
      const start = journey();
      console.log(`${difficulty}, draft ${attempt + 1}: ${hero}, ${start.map.name}`);
      assert.equal(start.difficulty, difficulty);
      if (
        (difficulty === 16 && start.map.regionId !== 'region-2') ||
        !nightmareHeroes.includes(hero)
      ) {
        await phone.locator('#shanhetu-end').tap();
        await phone
          .locator('#shanhetu-end-dialog')
          .getByRole('button', { name: '结束并回房', exact: true })
          .tap();
        await wait(() => !journey(), 'Retreat did not return to room');
        checks.nightmare.attempts.push({
          difficulty,
          runId: start.id,
          initialRegion: start.map.regionId,
          hero,
          outcome: 'retreat',
        });
        await snapshot();
        continue;
      }
      await select(locationAction('battle'));
      const outcome = await battle(hero, !checks.restart && checkRestart);
      if (outcome === 'victory') cleared = await playRemainingRoute(hero, true);
      checks.nightmare.attempts.push({
        difficulty,
        runId: start.id,
        initialRegion: start.map.regionId,
        hero,
        outcome: journey().phase,
      });
      if (cleared) {
        const bosses = checks.battles.filter((b) => b.runId === start.id && b.kind === 'boss');
        assert.equal(bosses.length, 3);
        if (difficulty === 16) {
          assert([2640, 2641, 2642, 2643].includes(bosses[1].opening.battleId));
          assert([2684, 2685, 2686, 2687].includes(bosses[2].opening.battleId));
          assert.equal(bosses[1].opening.terrain, 13278);
          assert.equal(bosses[2].opening.terrain, null);
        }
        checks.nightmare.clears.push({
          difficulty,
          runId: start.id,
          bosses: bosses.map((b) => b.opening.battleId),
          ending: journey().finalReport.title,
        });
      }
      await phone.locator('#shanhetu-end').tap();
      await wait(() => !journey(), 'Nightmare terminal journey stayed open');
      const record = (await profile()).recent[0];
      assert.equal(record.difficulty, difficulty);
      assert.equal(record.outcome, cleared ? 'victory' : 'defeat');
      await snapshot();
    }
    assert(cleared, `No natural victory on difficulty ${difficulty}; retained individual attempts`);
    if (difficulty < 20)
      await expect(difficultyInput.locator(`option[value="${difficulty + 1}"]`)).toBeEnabled();
  }
  assert.equal(errors.length, 0);
  assert.equal(missing.size, 0);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        scope:
          'Natural nightmare campaigns from a copied prior clear, mobile-sized desktop browser',
        physicalPhone: false,
        checks,
        errors,
        missing: [...missing],
      },
      null,
      2,
    ),
  );
  console.log(`Nightmare UI campaign verification passed: ${output}`);
}

async function verifyJourneys() {
  await computer.goto(`${origin}/server`);
  await wait(() => adapter.status().ready, 'Computer supervisor did not become ready');
  await phone.goto(origin);
  const response = await context.request.post(`${origin}/api/rooms`, {
    data: { nickname: '山河出征者' },
  });
  assert.equal(response.status(), 201);
  const created = await response.json();
  room = party.lobby.get(created.room.code);
  await phone.goto(`${origin}/join/${room.code}`);
  if (!(await phone.locator('#settings-panel').evaluate((panel) => panel.open)))
    await phone.locator('#settings-panel summary').tap();
  await phone.locator('[data-mode="shanhetu"]').tap();
  await wait(() => room.snapshot().settings.mode === 'shanhetu', 'Mode setting not saved');
  await expect(phone.locator('#shanhetu-launch')).toBeVisible();
  await expect(phone.locator('#start-button')).toHaveText('择将出征');
  await expect(phone.locator('#owner-transfer')).toBeHidden();
  await expect(phone.locator('#ready-button')).toBeHidden();
  const difficulty = phone.locator('#shanhetu-difficulty');
  const normal2 = difficulty.locator('option[value="2"]');
  const medium1 = difficulty.locator('option[value="6"]');
  const hard1 = difficulty.locator('option[value="11"]');
  const bookUrl = `${origin}/api/rooms/${room.code}/shanhetu/book`;
  const book = phone.getByRole('dialog', { name: '山河册' });
  const openBook = () => phone.getByRole('button', { name: '山河册', exact: true }).tap();
  const closeBook = () => book.getByRole('button', { name: '关闭', exact: true }).tap();
  const chooseOpening = (id) => phone.locator(`[data-opening-tactic="${id}"]`).tap();
  const bowen = phone.locator('[data-opening-tactic="2249"]');
  const bowenGoal = book
    .locator('.shanhetu-milestones > li')
    .filter({ has: phone.getByText('博闻Ⅰ', { exact: true }) });
  const startJourney = async () => {
    await expect(phone.locator('#start-button')).toBeEnabled();
    await phone.locator('#start-button').tap();
  };
  if (nightmareBook) return playNightmareJourneys(difficulty, chooseOpening, startJourney);
  await expect(difficulty).toHaveValue('1');
  await expect(normal2).toBeDisabled();
  await expect(medium1).toBeDisabled();
  await expect(hard1).toBeDisabled();
  await shot('00-launch');
  await phone.setViewportSize({ width: 1280, height: 850 });
  await shot('00-launch-desktop');
  await phone.setViewportSize({ width: 390, height: 844 });
  await openBook();
  if (exploreBook) {
    await expect(bowen).toBeDisabled();
    await expect(bowenGoal).toContainText('0/2');
  }
  await expect(book.getByRole('progressbar', { name: '下一项解锁进度' })).toHaveAttribute(
    'value',
    '0',
  );
  await expect(book).toContainText('再胜 3 场，连营加入奖励池。');
  await closeBook();
  await phone.getByRole('button', { name: '房间设置', exact: true }).tap();
  await expect(phone.locator('#settings-panel')).toBeVisible();
  await phone.getByRole('button', { name: '返回出征', exact: true }).tap();
  if (full) await chooseOpening(2219);
  await startJourney();
  await expect(phone.locator('#shanhetu-panel')).toBeVisible();
  await expect(phone.locator('#shanhetu-options [data-general]')).toHaveCount(5);
  await shot('01-selection');
  const initial = room.snapshot().shanhetu;
  checks.runId = initial.id;
  const picks = await phone
    .locator('#shanhetu-options [data-general]')
    .evaluateAll((buttons) => buttons.map((button) => button.dataset.general));
  const general = preferredHero(picks);
  await phone.locator(`#shanhetu-options [data-general="${general}"]`).first().tap();
  await shot('02-selection-detail');
  await phone.locator('#shanhetu-confirm').tap();
  await wait(() => room.snapshot().shanhetu.phase === 'map', 'Hero choice not applied');
  await expect(phone.locator('.shanhetu-map')).toBeVisible();
  await expect(phone.locator('.shanhetu-pin.available[aria-pressed=true]')).toHaveCount(1);
  await expect(phone.locator('#shanhetu-confirm')).toBeEnabled();
  await expect(phone.locator('.shanhetu-map-days')).toContainText('距首领 4 日');
  await expect(phone.locator('.shanhetu-map-days')).toContainText('集市在行军满 3 日后开放');
  await expect(phone.locator('.shanhetu-tray-meta')).toContainText('耗时 1 日');
  checks.mapLayout = await phone.locator('#match-panel').evaluate((panel) => ({
    transformed: getComputedStyle(panel).transform !== 'none',
    width: panel.getBoundingClientRect().width,
    viewport: innerWidth,
    overflow: panel.scrollWidth > panel.clientWidth + 1,
  }));
  assert.equal(checks.mapLayout.transformed, false);
  assert(checks.mapLayout.width <= checks.mapLayout.viewport + 1);
  assert.equal(checks.mapLayout.overflow, false);
  await shot('03-map');
  await phone.getByRole('button', { name: '章间路线', exact: true }).tap();
  await expect(phone.locator('.shanhetu-route')).toBeVisible();
  await expect(phone.locator('.shanhetu-route-city')).toHaveCount(6);
  await shot('03-routes');
  await phone.getByRole('button', { name: '本城地图', exact: true }).tap();
  await phone.setViewportSize({ width: 320, height: 620 });
  assert(
    await phone
      .locator('#match-panel')
      .evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1),
  );
  await shot('03-map-narrow');
  const spotDetails = phone.getByRole('button', { name: '查看地点详情' });
  if (journey().actions[0].description.length > 20) {
    await spotDetails.tap();
    const spot = phone.getByRole('dialog', { name: journey().actions[0].label });
    const story = journey()
      .actions[0].description.replace(/<[^>]+>/g, ' ')
      .replaceAll('&nbsp;', ' ');
    await expect(spot.locator('.shanhetu-story')).toHaveText(story);
    await shot('03-map-spot-narrow');
    await spot.getByRole('button', { name: '关闭', exact: true }).tap();
  }
  await phone.setViewportSize({ width: 390, height: 844 });
  checks.general = general;
  assert.equal(room.snapshot().shanhetu.hero.general, general);
  await select(locationAction('battle'));
  assert.equal(
    await battle(general, checkRestart),
    'victory',
    'First encounter ended in a natural defeat',
  );
  assert.equal(journey().phase, 'reward');
  await shot('06-reward');
  await select(journey().actions[0]);
  await wait(() => room.snapshot().shanhetu.phase === 'map', 'Reward did not return to map');
  const saved = room.snapshot().shanhetu;
  assert(
    saved.build.skills.length + saved.build.tactics.length + (saved.build.cards?.length ?? 0) > 0,
  );
  await phone.reload();
  await expect(phone.locator('#shanhetu-panel')).toBeVisible();
  assert.deepEqual(room.snapshot().shanhetu, saved);
  checks.campaignRefresh = true;
  checks.rewardsApplied = true;
  if (full) {
    await playRemainingRoute(general);
    checks.fullJourney = true;
  }
  await phone.locator('#shanhetu-end').tap();
  if (!full) {
    const dialog = phone.locator('#shanhetu-end-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '继续征程', exact: true }).tap();
    assert.equal(journey().id, initial.id);
    await phone.locator('#shanhetu-end').tap();
    await dialog.getByRole('button', { name: '结束并回房', exact: true }).tap();
  }
  await wait(() => !journey(), 'Journey was not ended');
  await expect(phone.locator('#shanhetu-launch')).toBeVisible();
  const firstVictories = checks.battles.filter((item) => item.outcome === 'victory').length;
  const profile = () => context.request.get(bookUrl).then((response) => response.json());
  await phone.reload();
  await expect(phone.locator('#shanhetu-launch')).toBeVisible();
  await openBook();
  await expect(book.locator('.shanhetu-book-score strong')).toHaveText(String(firstVictories));
  if (exploreBook) {
    await expect(bowen).toBeDisabled();
    await expect(bowenGoal).toContainText('1/2');
    for (const city of exploredCities) await expect(bowenGoal).toContainText(city);
  }
  const firstRecord = await profile();
  assert.equal(firstRecord.victories, firstVictories);
  assert.equal(firstRecord.recent[0].outcome, full ? 'victory' : 'retreat');
  assert.equal(firstRecord.milestones[0].skills[0].unlocked, firstVictories >= 3);
  await shot('07-book');
  await closeBook();
  checks.book = {
    victories: firstVictories,
    persistent: true,
    milestones: firstRecord.milestones.map((step) =>
      step.skills.map((skill) => [skill.name, skill.unlocked]),
    ),
  };

  if (full) {
    await expect(normal2).toBeEnabled();
    await expect(medium1).toBeEnabled();
    checks.unlockedNormal2 = true;
    if (fullNormal2) {
      await difficulty.selectOption('2');
      await expect(phone.locator('#shanhetu-difficulty-hint')).toContainText('初始手牌+1');
    }
    if (fullMedium) {
      await difficulty.selectOption('6');
      await expect(phone.locator('#shanhetu-difficulty-hint')).toContainText('战后保留当前体力');
    }
  }
  await chooseOpening(nextOpening.id);
  await startJourney();
  await expect(phone.locator('#shanhetu-options [data-general]')).toHaveCount(5);
  assert.notEqual(journey().id, initial.id);
  assert.equal(journey().difficulty, fullMedium ? 6 : fullNormal2 ? 2 : 1);
  assert.deepEqual(journey().initialTactics, [nextOpening.name]);
  checks.newJourney = true;
  const nextGeneral = await chooseNextHero();
  await select(locationAction('battle'));
  checks.book.firstEncounter = await battle(nextGeneral);
  if (nextOpening.id === 2219) assert(checks.battles.at(-1).opening.companions[0].fixedHand);
  if (fullMedium) {
    checks.mediumAttempts = [];
    let hero = nextGeneral;
    let opening = checks.book.firstEncounter;
    for (let attempt = 0; attempt < 3 && !checks.fullMedium; attempt++) {
      if (attempt > 0) {
        await difficulty.selectOption('6');
        await chooseOpening(nextOpening.id);
        await startJourney();
        await expect(phone.locator('#shanhetu-options [data-general]')).toHaveCount(5);
        hero = await chooseNextHero();
        await select(locationAction('battle'));
        opening = await battle(hero);
      }
      if (opening === 'victory')
        checks.fullMedium = await playRemainingRoute(hero, true, stopAfterExploration);
      checks.mediumAttempts.push({ runId: journey().id, outcome: journey().phase });
      const terminal = ['won', 'lost'].includes(journey().phase);
      await phone.locator('#shanhetu-end').tap();
      if (!terminal)
        await phone
          .locator('#shanhetu-end-dialog')
          .getByRole('button', { name: '结束并回房', exact: true })
          .tap();
      await wait(() => !journey(), 'Medium terminal journey stayed open');
    }
    assert(checks.fullMedium, 'Three natural medium-1 attempts did not clear the journey');
    assert(
      checks.battles.some(
        (item) =>
          item.difficulty === 6 &&
          item.kind === 'boss' &&
          [2652, 2653, 2654, 2655, 2664, 2665, 2666, 2667].includes(item.opening.battleId),
      ),
    );
    if (!stopAfterExploration) {
      await expect(difficulty.locator('option[value="7"]')).toBeEnabled();
      assert.deepEqual(
        (await profile()).recent
          .filter((receipt) => receipt.outcome === 'victory')
          .map((receipt) => receipt.difficulty),
        [6, 1],
      );
    }
  }
  if (fullNormal2) {
    assert.equal(checks.book.firstEncounter, 'victory', 'Normal 2 opened with a natural defeat');
    await playRemainingRoute(nextGeneral);
    checks.fullNormal2 = true;
    await phone.locator('#shanhetu-end').tap();
    await wait(() => !journey(), 'Normal 2 terminal journey stayed open');
    assert.deepEqual(
      (await profile()).recent.map((receipt) => [receipt.difficulty, receipt.outcome]),
      [
        [2, 'victory'],
        [1, 'victory'],
      ],
    );
  }

  if (fullHard) {
    await expect(hard1).toBeEnabled();
    await expect(difficulty.locator('option[value="12"]')).toBeDisabled();
    checks.hardAttempts = [];
    for (let attempt = 0; attempt < 3 && !checks.fullHard; attempt++) {
      await difficulty.selectOption('11');
      await expect(phone.locator('#shanhetu-difficulty-hint')).toContainText('护甲回复');
      await chooseOpening(2219);
      await startJourney();
      await expect(phone.locator('#shanhetu-options [data-general]')).toHaveCount(5);
      assert.equal(journey().difficulty, 11);
      const hero = await chooseNextHero();
      await select(locationAction('battle'));
      if ((await battle(hero)) === 'victory')
        checks.fullHard = await playRemainingRoute(hero, true);
      checks.hardAttempts.push({ runId: journey().id, outcome: journey().phase });
      await phone.locator('#shanhetu-end').tap();
      await wait(() => !journey(), 'Hard terminal journey stayed open');
    }
    assert(checks.fullHard, 'Three natural hard-1 attempts did not clear the journey');
    assert(checks.narrowHardRoute);
    assert(
      checks.battles.some(
        (item) =>
          item.difficulty === 11 &&
          item.chapter === 3 &&
          item.kind === 'boss' &&
          item.opening.terrain,
      ),
    );
    await expect(difficulty.locator('option[value="12"]')).toBeEnabled();
  }

  if (fullNormal3) {
    await expect(difficulty.locator('option[value="3"]')).toBeEnabled();
    await expect(difficulty.locator('option[value="4"]')).toBeDisabled();
    checks.normal3Attempts = [];
    for (let attempt = 0; attempt < 3 && !checks.fullNormal3; attempt++) {
      await difficulty.selectOption('3');
      await expect(phone.locator('#shanhetu-difficulty-hint')).toContainText('第二形态');
      await chooseOpening(2219);
      await startJourney();
      await expect(phone.locator('#shanhetu-options [data-general]')).toHaveCount(5);
      assert.equal(journey().difficulty, 3);
      assert.deepEqual(journey().initialTactics, ['和光盟']);
      const hero = await chooseNextHero();
      await select(locationAction('battle'));
      if ((await battle(hero)) === 'victory')
        checks.fullNormal3 = await playRemainingRoute(hero, true);
      checks.normal3Attempts.push({ runId: journey().id, outcome: journey().phase });
      await phone.locator('#shanhetu-end').tap();
      await wait(() => !journey(), 'Normal 3 terminal journey stayed open');
    }
    assert(checks.fullNormal3, 'Three natural normal-3 attempts did not clear the journey');
    await expect(difficulty.locator('option[value="4"]')).toBeEnabled();
    const savedProfile = await profile();
    assert(savedProfile.milestones.every((step) => step.skills.every((skill) => skill.unlocked)));
    assert.deepEqual(
      savedProfile.recent
        .filter((receipt) => receipt.outcome === 'victory')
        .map((receipt) => receipt.difficulty),
      [3, 2, 1],
    );
  }
  if (exploreBook) {
    assert(exploredCities.size >= 2);
    await expect(bowen).toBeEnabled();
    await openBook();
    await expect(bowenGoal).toContainText('2/2');
    for (const city of exploredCities) await expect(bowenGoal).toContainText(city);
    await shot('book-exploration');
    await closeBook();
    await difficulty.selectOption('1');
    await chooseOpening(2249);
    await startJourney();
    await expect(phone.locator('#shanhetu-options [data-general]')).toHaveCount(5);
    assert.deepEqual(journey().initialTactics, ['博闻Ⅰ']);
    checks.exploration = { cities: [...exploredCities] };
    const hero = await chooseNextHero();
    await select(locationAction('battle'));
    checks.exploration.outcome = await battle(hero);
  }
  assert.equal(errors.length, 0);
  assert.equal(missing.size, 0);
  assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        scope: exploreBook
          ? 'Isolated native exploration unlock and bowen opening through mobile-sized UI'
          : fullHard
            ? 'Isolated normal-1, medium-1 and hard-1 journeys through mobile-sized UI'
            : fullMedium
              ? 'Isolated full normal-1 and medium-1 journeys through mobile-sized UI'
              : fullNormal3
                ? 'Isolated normal-1 to 3 full journeys through mobile-sized UI'
                : fullNormal2
                  ? 'Isolated normal-1 and 2 full journeys through mobile-sized UI'
                  : full
                    ? 'Isolated full normal-1 journey through mobile-sized UI'
                    : 'Isolated first native encounter through mobile-sized UI',
        physicalPhone: false,
        checks,
        errors,
        missing: [...missing],
      },
      null,
      2,
    ),
  );
  console.log(`Shanhetu page/native loop passed: ${output}`);
}
try {
  await verifyJourneys();
} catch (error) {
  await shot('failure').catch(() => {});
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: String(error.stack),
        checks,
        errors,
        missing: [...missing],
        room: room?.snapshot(),
        events,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  unsubscribe();
  if (room) adapter.release(room.code);
  await browser.close();
  const closed = once(party.server, 'close');
  party.stop();
  party.server.closeAllConnections();
  await closed;
}
