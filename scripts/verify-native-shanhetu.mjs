// SPDX-License-Identifier: GPL-3.0-only
// Isolated real-engine probe. No public mode/room settings or live-service restart.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { ShanhetuCampaign } from '../apps/server/src/shanhetu-campaign.ts';
import { chooseGeneral } from './native-ui-actions.mjs';
import {
  shanhetuBattleCompanions,
  shanhetuRecipe,
} from '../packages/noname-adapter/src/shanhetu.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}/.runtime/shanhetu-native/${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.env.SHANHETU_VERIFY_ENCOUNTER ?? process.env.SHANHETU_VERIFY_BOSS ?? 'core'}-${randomUUID().slice(0, 8)}`;
await mkdir(output, { recursive: true });
const adapter = new NativeNonameService(root);
assert(adapter.status().preload, 'Complete fixed native resources are required');
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
const faults = [];
const missing = new Set();
for (const page of [computer, phone]) {
  page.on('pageerror', (error) => faults.push(String(error.stack)));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /\b(?:TypeError|SyntaxError|ReferenceError):/.test(message.text())
    )
      faults.push(message.text());
  });
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && path.startsWith('/engine/')) missing.add(path);
  });
}
const events = [];
const boss = process.env.SHANHETU_VERIFY_ENCOUNTER ?? process.env.SHANHETU_VERIFY_BOSS;
const bossIds = {
  lvbu: 22644,
  liru: 22668,
  dongzhuo: 22671,
  taishici: 22632,
  lijue: 22636,
  yujin: 22648,
  yuanshao: 22660,
  youxia: 22481,
  xinping: 22489,
  jiaoshi: 22495,
  'youxia-normal': 2481,
  'xinping-normal': 2489,
  'jiaoshi-normal': 2495,
  'lijue-normal': 2636,
  'lvbu-normal': 2644,
  'ambush-normal': 2298,
  'rage-stage': 2644,
  'shengui-stage': 2645,
  'dongzhuo-nightmare-stage': 2687,
  'niufu-stage': 2670,
  'dongmin-stage': 2671,
};
const numbered = boss && /^\d{4,5}$/.test(boss);
assert(!boss || numbered || Object.hasOwn(bossIds, boss));
const finalBattleId = numbered ? Number(boss) : boss ? bossIds[boss] : 22298;
const stages = boss?.endsWith('-stage');
const normal =
  ['lijue-normal', 'lvbu-normal', 'ambush-normal'].includes(boss) ||
  (numbered && finalBattleId < 20000);
const minimumDifficulty =
  (finalBattleId >= 2684 && finalBattleId <= 2687) ||
  (finalBattleId >= 2640 && finalBattleId <= 2643)
    ? 16
    : stages
      ? 3
      : normal
        ? 2
        : 1;
const difficulty = Number(process.env.SHANHETU_VERIFY_DIFFICULTY ?? minimumDifficulty);
if (stages) assert(difficulty >= 3 && difficulty <= 20);
const finalChapter = Number(process.env.SHANHETU_VERIFY_CHAPTER ?? 2);
const finalTerrain = Number(process.env.SHANHETU_VERIFY_TERRAIN ?? 0);
assert([2, 3].includes(finalChapter));
const withGrowth = process.env.SHANHETU_BOSS_GROWTH !== '0';
const withCarry = process.env.SHANHETU_VERIFY_CARRY === '1';
const withAlly = stages || process.env.SHANHETU_VERIFY_COMPANION === '1';
const statusProbe = process.env.SHANHETU_VERIFY_STATUS;
assert(
  !statusProbe ||
    (statusProbe === 'poison' && [2633, 22633].includes(finalBattleId)) ||
    (statusProbe === 'axe' && [2646, 22646].includes(finalBattleId)) ||
    (statusProbe === 'pojun' && withAlly && [2646, 22646].includes(finalBattleId)) ||
    (statusProbe === 'zhouxuan' && difficulty >= 11 && finalBattleId === 2673),
);
const campHp = withAlly ? 5 : 1;
// Synthetic short route exercises authoritative progression, not the S5 map.
const campaign = new ShanhetuCampaign({
  id: 'native-integration-fixture',
  name: '山河图原生接入验证',
  difficulty,
  entries: ['first'],
  initialCoins: 0,
  initialSkillSlots: 2,
  ...(withAlly ? { openingCompanions: [997103] } : {}),
  candidates:
    boss === 'dongzhuo' ? ['huaxiong'] : ['caocao', 'guanyu', 'zhangfei', 'zhaoyun', 'machao'],
  rewards: [
    {
      id: 'initial',
      name: '初始手牌+2',
      description: '原生起手牌成长验证',
      effects: withGrowth ? [{ kind: 'initial-cards', amount: 2 }] : [],
    },
  ],
  nodes: [
    {
      id: 'first',
      name: '落单禁军',
      description: '固定新手阵容',
      kind: 'battle',
      chapter: 1,
      duration: 1,
      battleId: 22498,
      coins: 200,
      rewardGroups: [{ count: 1, rewards: ['initial'] }],
      next: ['camp'],
    },
    {
      id: 'camp',
      name: '验证营地',
      description: '验证成长应用，不是正式事件配方',
      kind: 'camp',
      chapter: 1,
      duration: 1,
      choices: [
        {
          id: 'growth',
          label: '取得验证成长',
          description: '核对成长与原生战法叠加',
          cost: 0,
          effects: [
            ...(withGrowth
              ? [
                  { kind: 'max-hp', amount: campHp },
                  { kind: 'draw', amount: 1 },
                  { kind: 'armor', amount: 2 },
                  { kind: 'hand-limit', amount: 3 },
                  { kind: 'skill', amount: 3297 },
                  { kind: 'tactic', amount: 2030 },
                  { kind: 'tactic', amount: 2059 },
                  { kind: 'tactic', amount: 2010 },
                  ...(stages ? [{ kind: 'extra-sha', amount: 1 }] : []),
                ]
              : []),
            ...(withCarry
              ? [
                  { kind: 'card', amount: 4062 },
                  { kind: 'card', amount: 4138 },
                  { kind: 'card', amount: 4004 },
                  { kind: 'card', amount: 4014 },
                ]
              : []),
          ],
        },
      ],
      next: ['last'],
    },
    {
      id: 'last',
      name: '终点验证',
      description: '固定新手阵容；作为验证路线终点',
      kind: 'boss',
      chapter: finalChapter,
      duration: 1,
      battleId: finalBattleId,
      next: [],
    },
  ],
});
function campaignAction(label) {
  const view = campaign.view();
  const action = view.actions.find((action) => action.label === label);
  assert(action, `Campaign action ${label} is available`);
  return campaign.act({ runId: view.id, revision: view.revision, actionId: action.id });
}

async function observeBossStage(worker) {
  await worker.evaluate(() => {
    const { game, lib, proof, shanhetuOutcome, ui } = partyEngine;
    const skill = lib.skill.party_shanhetu_stage;
    const transform = skill.content;
    const shaUses = (player) =>
      player.countAllHistory('useCard', (use) => use.card?.name === 'sha');
    skill.content = async function (event, trigger, player) {
      const from = player.name1;
      const hand = player.getCards('h');
      const judgments = player.getCards('j');
      const previousWeapon = player.getEquip(1);
      const uses = shaUses(player);
      await transform(event, trigger, player);
      const preserved = (before, after) =>
        before.length === after.length && before.every((card) => after.includes(card));
      proof.bossStage = {
        id: player.playerid,
        from,
        to: player.name1,
        hp: player.hp,
        maxHp: player.maxHp,
        armor: player.hujia,
        trigger: event.triggername,
        name: lib.translate[player.name1],
        shaLimit: game.checkMod({ name: 'sha' }, player, 1, 'cardUsable', player),
        skills: [...player.skills],
        gear: player.getCards('e').map(({ name, suit, number }) => ({ name, suit, number })),
        handRetained: preserved(hand, player.getCards('h')),
        judgmentsRetained: preserved(judgments, player.getCards('j')),
        shaUses: uses,
        cardUses: player.countAllHistory('useCard'),
        historyRetained: uses === shaUses(player),
        sameSeat: lib.playerOL[player.playerid] === player && game.players.includes(player),
        stillInBattle: shanhetuOutcome() === null && !player.isDead() && player.side === false,
        replacesWeapon: !!previousWeapon && previousWeapon !== player.getEquip(1),
        oldWeaponInPile:
          !!previousWeapon && [ui.cardPile, ui.discardPile].includes(previousWeapon.parentNode),
      };
      // Hold the test just after the natural transition so a real reload can
      // inspect the same public form before later combat changes its cards.
      await new Promise((resolve) => {
        partyEngine.resumeStageProbe = resolve;
      });
    };
  });
}

async function verifySeatPortrait(id, portrait) {
  // Read the visible avatar, including the native reinit path for a second form.
  const expected = await phone.evaluate(
    (path) => new URL(partyEngine.setup.assetBase + path, location.href).href,
    portrait,
  );
  await phone.waitForFunction(
    ({ id, expected }) => {
      const avatar = globalThis.partyEngine?.lib.playerOL[id]?.node.avatar;
      return avatar && getComputedStyle(avatar).backgroundImage.includes(expected);
    },
    { id, expected },
  );
  assert(
    await phone.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return image.naturalWidth > 0 && image.naturalHeight > 0;
    }, expected),
  );
}

async function reloadBossStage(worker, matchId, stage, before, next) {
  assert.equal(stage.name, next.name);
  assert.notEqual(stage.to, stage.from);
  assert(
    stage.sameSeat &&
      stage.stillInBattle &&
      stage.handRetained &&
      stage.judgmentsRetained &&
      stage.historyRetained,
  );
  assert.equal(stage.oldWeaponInPile, false);
  assert.deepEqual([stage.hp, stage.maxHp, stage.armor], [next.hp, next.maxHp, next.armor]);
  assert.equal(stage.shaLimit, 1 + next.extraSha);
  assert(next.skills.every((skill) => stage.skills.includes(skill)));
  assert(
    before.skills.every((skill) => next.skills.includes(skill) || !stage.skills.includes(skill)),
  );
  const byName = (left, right) => left.name.localeCompare(right.name);
  assert.deepEqual(
    stage.gear.toSorted(byName),
    (next.fixedEquipment ?? [])
      .map(({ nativeId: name, suit, number }) => ({ name, suit, number }))
      .sort(byName),
  );
  assert(!events.some((event) => event.type === 'ended' && event.matchId === matchId));
  await verifySeatPortrait(stage.id, next.portrait);
  const hand = await worker.evaluate((id) => {
    const { lib, game } = partyEngine;
    return lib.playerOL[id]
      .getCards('h')
      .map((card) => ({ id: card.cardid, alreadyKnown: card.isKnownBy(game.zhu) }));
  }, stage.id);
  await phone.reload();
  await phone.waitForFunction(
    ({ id, to, hp, maxHp, gear, skills }) => {
      const actor = globalThis.partyEngine?.lib.playerOL?.[id];
      return (
        actor?.name1 === to &&
        actor.hp === hp &&
        actor.maxHp === maxHp &&
        actor.side === false &&
        skills.every((skill) => actor.hasSkill(skill)) &&
        gear.every(({ name, suit, number }) =>
          actor
            .getCards('e')
            .some((card) => card.name === name && card.suit === suit && card.number === number),
        )
      );
    },
    { ...stage, skills: next.skills },
    { timeout: 120000 },
  );
  await verifySeatPortrait(stage.id, next.portrait);
  const tags = await phone.evaluate(
    (id) => ({
      hero: partyEngine.game.me.node.identity.firstChild.textContent,
      enemy: partyEngine.lib.playerOL[id].node.identity.firstChild.textContent,
    }),
    stage.id,
  );
  assert.deepEqual(tags, { hero: '你', enemy: '敌' });
  const visibility = await phone.evaluate((cards) => {
    const { lib } = partyEngine;
    const disclosed = cards.filter(
      ({ id }) => lib.cardOL[id] && lib.cardOL[id].name !== 'party_unknown',
    );
    return {
      previouslyKnown: disclosed.filter(({ alreadyKnown }) => alreadyKnown).length,
      hiddenDisclosed: disclosed.filter(({ alreadyKnown }) => !alreadyKnown).length,
    };
  }, hand);
  assert.equal(visibility.hiddenDisclosed, 0, 'Refresh must not reveal an unknown hand card');
  await phone.screenshot({ path: `${output}/second-form-refreshed.png` });
  await worker.evaluate(() => {
    partyEngine.game.broadcast(function () {
      partyEngine.lib.config.game_speed = 'vvfast';
      partyEngine.lib.config.duration = 100;
      if (!partyEngine._status.auto) partyEngine.ui.click.auto();
    });
    partyEngine.resumeStageProbe();
    delete partyEngine.resumeStageProbe;
  });
  return { ...stage, refreshed: true, concealed: true, visibility, tags };
}
async function observeBossStatus(worker, key) {
  await worker.evaluate((key) => {
    const { game, lib, proof } = partyEngine;
    const expansion = ['pojun', 'zhouxuan'].includes(key);
    const [effect, mark] =
      key === 'poison'
        ? ['party_shanhetu_envenom', 'party_shanhetu_poison']
        : key === 'axe'
          ? ['party_shanhetu_xingtian_axe_skill', 'party_shanhetu_xingtian_ban']
          : key === 'zhouxuan'
            ? ['party_shanhetu_zhouxuan', 'party_shanhetu_zhouxuan']
            : ['repojun', 'repojun2'];
    const native = lib.skill[effect];
    if (key === 'axe') {
      const decide = native.cost;
      native.cost = async function (event, trigger, player) {
        if (trigger.target !== game.zhu) return decide(event, trigger, player);
        const choose = player.chooseToDiscard;
        // The isolated probe accepts this optional effect once it is legal.
        // Native selection and discard still pay the full cost.
        player.chooseToDiscard = function (...args) {
          return choose.apply(this, args).set('forced', true);
        };
        try {
          await decide(event, trigger, player);
        } finally {
          delete player.chooseToDiscard;
        }
      };
    }
    if (key === 'zhouxuan') {
      const decide = native.cost;
      native.cost = async function (event, trigger, player) {
        const choose = player.chooseCard;
        player.chooseCard = function (...args) {
          return choose.apply(this, args).set('forced', true);
        };
        try {
          await decide(event, trigger, player);
        } finally {
          delete player.chooseCard;
        }
      };
    }
    const apply = native.content;
    native.content = async function (event, trigger, player) {
      await apply(event, trigger, player);
      const target =
        key === 'poison' ? trigger.player : key === 'zhouxuan' ? player : trigger.target;
      if (proof.bossStatus || !target?.isIn() || !target.hasSkill(mark)) return;
      if (expansion ? target === game.zhu : target !== game.zhu) return;
      const cards = expansion
        ? target.getExpansions(mark)
        : game.filterPlayer((npc) => npc.side === false).flatMap((npc) => npc.getCards('h'));
      const observed = cards.map((card) => ({ id: card.cardid, known: card.isKnownBy(game.zhu) }));
      if (expansion && !observed.some((card) => !card.known)) return;
      proof.bossStatus = {
        mark,
        actorId: target.playerid,
        observed,
        ...(expansion ? { expansionCount: cards.length } : {}),
        responseBlocked:
          game.checkMod({ name: 'shan' }, target, true, 'cardRespondable', target) === false,
        armorDisabled: target.hasSkillTag('unequip2'),
      };
      await new Promise((resolve) => {
        partyEngine.resumeBossStatusProbe = resolve;
      });
    };
  }, key);
}

async function reloadBossStatus(worker, key) {
  await worker.waitForFunction(
    () => partyEngine.proof.bossStatus || partyEngine._status.over,
    {},
    {
      timeout: 150000,
    },
  );
  const snapshot = await worker.evaluate(() => partyEngine.proof.bossStatus);
  assert(snapshot, 'The target boss status must occur before settlement');
  await phone.reload();
  const client = await phone.waitForFunction(
    ({ mark, actorId, expansionCount }) => {
      const engine = globalThis.partyEngine;
      const actor = engine?.lib.playerOL?.[actorId];
      if (expansionCount !== undefined)
        return actor?.getExpansions(mark).length === expansionCount && Boolean(actor.marks[mark]);
      return actor?.hasSkill(mark) && Boolean(actor.marks[mark]);
    },
    { mark: snapshot.mark, actorId: snapshot.actorId, expansionCount: snapshot.expansionCount },
    { timeout: 60000 },
  );
  await client.dispose();
  const mirrored = await phone.evaluate(({ mark, actorId, observed }) => {
    const { game, lib } = partyEngine;
    const actor = lib.playerOL[actorId];
    return {
      markVisible: Boolean(actor.marks[mark]),
      expansionCount: actor.getExpansions(mark).length,
      privateDisclosures: observed.filter(
        ({ id, known }) => !known && lib.cardOL[id] && lib.cardOL[id].name !== 'party_unknown',
      ).length,
      responseBlocked:
        game.checkMod({ name: 'shan' }, actor, true, 'cardRespondable', actor) === false,
      armorDisabled: actor.hasSkillTag('unequip2'),
    };
  }, snapshot);
  assert.equal(mirrored.privateDisclosures, 0);
  if (key === 'axe') {
    assert(snapshot.responseBlocked && snapshot.armorDisabled);
    assert(mirrored.responseBlocked && mirrored.armorDisabled);
  }
  if (snapshot.expansionCount !== undefined)
    assert.equal(mirrored.expansionCount, snapshot.expansionCount);
  await worker.evaluate(() => {
    partyEngine.game.broadcast(function () {
      partyEngine.lib.config.game_speed = 'vvfast';
      partyEngine.lib.config.duration = 100;
      if (!partyEngine._status.auto) partyEngine.ui.click.auto();
    });
    partyEngine.resumeBossStatusProbe();
    delete partyEngine.resumeBossStatusProbe;
  });
  return {
    skill: snapshot.mark,
    refreshed: true,
    acceptedOptionalEffect: ['axe', 'zhouxuan'].includes(key),
    unknownCardsChecked: snapshot.observed.filter((card) => !card.known).length,
    ...mirrored,
  };
}

const unsubscribe = adapter.subscribe((event) => {
  if (event.type !== 'status') events.push(event);
  if (event.type === 'ended' && event.shanhetu?.runId === campaign.view().id) {
    assert(
      campaign.settle(event.matchId, event.shanhetu),
      'Only the active bound native result advances progression',
    );
    assert.equal(
      campaign.settle(event.matchId, event.shanhetu),
      false,
      'Duplicate native results grant nothing',
    );
  }
});
const results = [];
let roomCode;
try {
  await computer.goto(`${origin}/server`);
  await expect.poll(() => adapter.status().ready, { timeout: 30000 }).toBe(true);
  console.log('Isolated computer supervisor opened');
  await phone.goto(origin);
  const createdResponse = await context.request.post(`${origin}/api/rooms`, {
    data: { nickname: '山河验证' },
  });
  assert.equal(createdResponse.status(), 201);
  const created = await createdResponse.json();
  roomCode = created.room.code;
  const ownerPlayerId = created.playerId;
  const base = {
    roomCode,
    ownerPlayerId,
    settings: {
      mode: 'identity',
      playerCount: 1,
      generalPreset: 'beginner',
      allowGeneralSelection: false,
      extensions: [],
    },
    seats: [{ id: ownerPlayerId, nickname: '山河验证', kind: 'human' }],
    aiPolicy: 'strongest-native',
  };
  const testDefeat = !boss && process.env.SHANHETU_VERIFY_DEFEAT !== '0';
  const battleCount = testDefeat ? 8 : 2;
  for (let index = 0; index < battleCount; index++) {
    const battleId = index === 0 ? 22498 : index === 1 ? finalBattleId : 22298;
    const fixture = {
      runId: 'native-defeat-fixture',
      nodeId: `encounter-${index}`,
      battleId,
      candidates: ['caocao', 'guanyu', 'zhangfei', 'zhaoyun', 'machao'],
      ...(index > 0
        ? {
            hero:
              index === 1 ? results[0].hero : { general: 'caocao', group: 'wei', hp: 1, maxHp: 1 },
          }
        : {}),
    };
    let shanhetu;
    if (index === 0) shanhetu = campaignAction('落单禁军').battle;
    else if (index === 1) {
      assert.equal(campaign.view().phase, 'reward');
      assert.equal(campaign.view().coins, 200);
      campaignAction('初始手牌+2');
      campaignAction('验证营地');
      campaignAction('取得验证成长');
      shanhetu = campaignAction('终点验证').battle;
      assert.deepEqual(
        shanhetu.hero,
        withGrowth
          ? {
              ...results[0].hero,
              hp: results[0].hero.hp + campHp,
              maxHp: results[0].hero.maxHp + campHp,
            }
          : results[0].hero,
      );
    } else shanhetu = fixture;
    assert(shanhetu);
    const recipe = shanhetuRecipe(
      battleId,
      shanhetu.difficulty,
      shanhetu.elapsedMonths,
      shanhetu.chapter,
    );
    // Terrain is prescribed by the real route. This synthetic route injects only the test terrain.
    const terrainId = index === 1 ? finalTerrain : 0;
    const starting = adapter.start({
      ...base,
      shanhetu: terrainId ? { ...shanhetu, terrainId } : shanhetu,
    });
    // Keep failures observed while the phone connects to the pending worker.
    void starting.catch(() => {});
    const matchId = adapter.matchId(roomCode);
    assert(matchId);
    if (index < 2) campaign.bindMatch(shanhetu, matchId);
    await phone.goto(`${origin}/engine/player/${matchId}`);
    console.log(`PVE ${battleId}: connecting native worker and player`);
    const hostReady = computer.waitForFunction(
      (id) =>
        [...document.querySelectorAll('.engine-worker')].some(
          (element) =>
            element.src.endsWith(id) && element.contentWindow?.partyEngine?.proof.hostReady,
        ),
      matchId,
      { timeout: 120000 },
    );
    await Promise.race([hostReady, starting]);
    await hostReady;
    const worker = computer
      .frames()
      .find((frame) => frame.url().endsWith(`/engine/worker/${matchId}`));
    assert(worker);
    console.log(`PVE ${battleId}: native host ready, choosing general`);
    if (index === 0) {
      await phone.waitForFunction(
        () =>
          globalThis.partyEngine?._status.event?.name === 'chooseButton' &&
          partyEngine._status.paused,
        {},
        { timeout: 60000 },
      );
      const candidates = await phone
        .locator('.dialog:not(.removing) .button.character')
        .evaluateAll((buttons) => buttons.map((button) => button.link));
      assert.equal(candidates.length, shanhetu.candidates.length);
      await phone.reload();
      await phone.waitForFunction(
        () =>
          globalThis.partyEngine?._status.event?.name === 'chooseButton' &&
          partyEngine._status.paused,
        {},
        { timeout: 60000 },
      );
      assert.deepEqual(
        await phone
          .locator('.dialog:not(.removing) .button.character')
          .evaluateAll((buttons) => buttons.map((button) => button.link)),
        candidates,
      );
      assert.equal(adapter.matchId(roomCode), matchId);
    }
    await worker.evaluate(() => {
      partyEngine.proof.drawCounts = [];
      partyEngine.lib.skill.probe_shanhetu_draws = {
        trigger: { global: 'phaseDrawEnd' },
        forced: true,
        popup: false,
        charlotte: true,
        filter(event, player) {
          return player === partyEngine.game.zhu;
        },
        async content(event, trigger) {
          if (partyEngine.proof.drawCounts.length < 32) {
            const actor = trigger.player;
            partyEngine.proof.drawCounts.push({
              id: actor.playerid,
              general: actor.name1,
              num: trigger.num,
              fixed: !!trigger.numFixed,
              hp: actor.hp,
              skills: [...actor.skills],
              crown: !!actor.getEquip('xuwangzhimian'),
              opponents: partyEngine.game.countPlayer((target) => target.side !== actor.side),
            });
          }
        },
      };
      partyEngine.game.addGlobalSkill('probe_shanhetu_draws');
    });
    await chooseGeneral(phone.mainFrame(), worker);
    await starting;
    await phone.waitForFunction(() => partyEngine.proof.booted && partyEngine.game.me?.name1);
    const initial = await worker.evaluate(() => ({
      roster: partyEngine.proof.roster,
      actors: partyEngine.setup.seats
        .map((seat) => partyEngine.lib.playerOL[seat.id])
        .map((player) => ({
          id: player.playerid,
          general: player.name1,
          side: player.side,
          isLord: player.isZhu,
          maxHp: player.maxHp,
          handCount: player.countCards('h'),
        })),
    }));
    const enemyCount = recipe.enemies.length;
    assert.equal(initial.actors.length, 1 + enemyCount + (shanhetu.companionIds?.length ?? 0));
    const seats = [...recipe.enemies, ...shanhetuBattleCompanions(shanhetu)];
    for (const [i, actor] of seats.entries()) {
      await verifySeatPortrait(initial.actors[i + 1].id, actor.portrait);
    }
    const pile = await worker.evaluate(() => ({
      ruleset: partyEngine.setup.preset.ruleset,
      count: partyEngine.lib.card.list.length,
      packs: partyEngine.lib.config.cards,
      containsEquipment: partyEngine.lib.card.list.some(
        (entry) => partyEngine.lib.card[entry[2]].type === 'equip',
      ),
      equipmentInChoices: partyEngine.lib.inpile.some(
        (name) => partyEngine.lib.card[name]?.type === 'equip',
      ),
      hasJiu: partyEngine.lib.inpile.includes('jiu'),
    }));
    assert.equal(pile.ruleset, 'shanhetu-s5');
    assert.equal(pile.count, 135);
    assert.deepEqual(pile.packs, ['standard', 'extra']);
    assert.equal(pile.containsEquipment, false);
    assert.equal(pile.equipmentInChoices, false);
    assert.equal(pile.hasJiu, true);
    assert(initial.actors.every((actor, i) => actor.side === (i === 0 || i > enemyCount)));
    assert(initial.actors.every((actor) => !actor.isLord));
    assert(initial.roster.every((name) => !name.startsWith('party_shanhetu_npc_')));
    const opening = await worker.evaluate(() => partyEngine.proof.shanhetu.actors);
    assert.equal(
      opening[0].initialCards,
      (index === 1 && withGrowth ? 6 : 4) + (index === 1 && withCarry ? 2 : 0),
    );
    let carryOpening;
    if (index === 1 && withCarry) {
      carryOpening = await worker.evaluate(() => {
        const cards = partyEngine.game.zhu
          .getCards('he')
          .filter((card) => card._partyShanhetuCarry);
        partyEngine._carryProbe = cards;
        return cards.map((card) => ({
          id: card._partyShanhetuCarry,
          name: card.name,
          suit: card.suit,
          number: card.number,
          zone: partyEngine.get.position(card),
          destroyedAt: card.destroyed,
        }));
      });
      assert.deepEqual(
        carryOpening.map((card) => card.id).sort((a, b) => a - b),
        [4004, 4014, 4062, 4138],
      );
      assert(carryOpening.every((card) => card.destroyedAt === 'discardPile'));
      assert(
        carryOpening
          .filter((card) => [4004, 4014].includes(card.id))
          .every((card) => card.zone === 'e'),
      );
    }
    assert(
      opening.slice(1, enemyCount + 1).every((enemy, index) => {
        const form = recipe.enemies[index];
        return enemy.initialCards === form.startingCards + (form.fixedHand?.length ?? 0);
      }),
    );
    const fixedHands = await worker.evaluate(() => {
      const { lib, setup } = partyEngine;
      return setup.shanhetuRecipe.enemies.map((enemy, i) => {
        const hand = lib.playerOL[`shanhetu-enemy-${i}`]._start_cards ?? [];
        return (enemy.fixedHand ?? []).every((item) =>
          hand.some(
            (card) =>
              card.name === item.nativeId &&
              card.suit === item.suit &&
              card.number === item.number &&
              card.destroyed === 'discardPile',
          ),
        );
      });
    });
    assert(fixedHands.every(Boolean), 'Opening bonus cards match their original card instances');
    const byEquipmentName = (left, right) => left.name.localeCompare(right.name);
    const openingGear = recipe.enemies.map((enemy) =>
      (enemy.fixedEquipment ?? []).map(({ nativeId: name, suit, number }) => ({
        name,
        suit,
        number,
      })),
    );
    assert.deepEqual(
      opening.slice(1, enemyCount + 1).map((actor) => actor.equipment.toSorted(byEquipmentName)),
      openingGear.map((cards) => cards.toSorted(byEquipmentName)),
    );
    assert.deepEqual(
      opening.slice(1, enemyCount + 1).map(({ hp, maxHp, armor }) => ({ hp, maxHp, armor })),
      recipe.enemies.map(({ hp, maxHp, armor }) => ({ hp, maxHp, armor })),
    );
    if (index === 1 && withGrowth) {
      const tacticLogCount = () =>
        phone.evaluate(
          () =>
            [...partyEngine.ui.sidebar.children].filter((row) =>
              row.textContent.includes('获得战法'),
            ).length,
        );
      await expect.poll(tacticLogCount).toBe(shanhetu.build.tactics.length);
      await expect
        .poll(() => phone.evaluate(() => partyEngine.ui.arenalog.textContent.includes('获得战法')))
        .toBe(false);
      assert.equal(await tacticLogCount(), shanhetu.build.tactics.length);
      const build = await worker.evaluate(() => {
        const player = partyEngine.game.zhu;
        return {
          armor: partyEngine.proof.shanhetu.actors[0].armor,
          hp: partyEngine.proof.shanhetu.actors[0].hp,
          maxHp: player.maxHp,
          handLimit: player.getHandcardLimit(),
          extraSkill: player.hasSkill('kurou'),
          tactics: ['zf_ershengsan', 'zf_mopai', 'zf_guandaozhiji'].every((id) =>
            player.hasZhanfa(id),
          ),
        };
      });
      assert.equal(build.armor, 2);
      assert.equal(build.hp, results[0].hero.hp + campHp);
      assert.equal(build.maxHp, results[0].hero.maxHp + campHp);
      assert.equal(build.handLimit, build.hp + 3);
      assert(build.extraSkill && build.tactics);
    }
    const enemyCardIds = await worker.evaluate(() =>
      partyEngine.game.players
        .filter((player) => player.side === false)
        .flatMap((player) => player.getCards('h'))
        .map((card) => card.cardid),
    );
    const leaked = await phone.evaluate(
      (ids) =>
        partyEngine.game.players
          .filter((player) => player.side === false)
          .flatMap((player) => player.getCards('h'))
          .some((card) => ids.includes(card.cardid) && card.name !== 'party_unknown'),
      enemyCardIds,
    );
    assert.equal(leaked, false, 'Enemy hands must remain concealed');
    if (index < 2) {
      await phone.reload();
      await phone.waitForFunction(
        () => globalThis.partyEngine?.game.me?.name1 && partyEngine.proof.booted,
        {},
        { timeout: 120000 },
      );
      assert.equal(
        await phone.evaluate(() => partyEngine.game.me.name1),
        initial.actors[0].general,
      );
      assert.equal(adapter.matchId(roomCode), matchId);
      for (const [i, equipment] of openingGear.entries()) {
        if (!equipment.length) continue;
        await phone.waitForFunction(
          ({ id, equipment }) => {
            const actual = partyEngine.lib.playerOL[id]?.getCards('e');
            return equipment.every(({ name, suit, number }) =>
              actual?.some(
                (card) => card.name === name && card.suit === suit && card.number === number,
              ),
            );
          },
          { id: `shanhetu-enemy-${i}`, equipment },
        );
      }
      if (index === 1 && withGrowth) {
        const restored = await phone.evaluate(() => ({
          extraSkill: partyEngine.game.me.hasSkill('kurou'),
          tactics: ['zf_ershengsan', 'zf_mopai', 'zf_guandaozhiji'].every((id) =>
            partyEngine.game.me.hasZhanfa(id),
          ),
          limit: partyEngine.game.me.getHandcardLimit(),
          hp: partyEngine.game.me.hp,
        }));
        await writeFile(`${output}/restored-growth.json`, JSON.stringify(restored, null, 2));
        assert(restored.extraSkill && restored.tactics, 'Native growth survives player reinit');
        assert.equal(restored.limit, restored.hp + 3);
      }
      if (index === 1 && withCarry) {
        // Native reinit moves physical equipment through ui.special with a
        // 500 ms removing animation. Wait for native rendering to finish.
        await phone.waitForFunction(
          () => !partyEngine.game.me.node.equips.querySelector('.removing'),
          {},
          { timeout: 5000 },
        );
        const restored = await phone.evaluate(() =>
          partyEngine.game.me.getCards('he').map((card) => ({
            name: card.name,
            suit: card.suit,
            number: card.number,
            zone: partyEngine.get.position(card),
          })),
        );
        const current = await worker.evaluate(() =>
          partyEngine._carryProbe.map((card) => ({
            id: card._partyShanhetuCarry,
            name: card.name,
            suit: card.suit,
            number: card.number,
            zone: partyEngine.get.position(card),
            destroyed: !!card._selfDestroyed,
            owned: partyEngine.get.owner(card) === partyEngine.game.zhu,
          })),
        );
        const equipment = await phone.evaluate(() => ({
          dom: [...partyEngine.game.me.node.equips.children].map((card) => ({
            name: card.name,
            id: card.cardid,
            classes: card.className,
            zone: partyEngine.get.position(card),
          })),
          virtual: partyEngine.game.me.getVCards('e').map((card) => ({
            name: card.name,
            cards: card.cards?.map((card) => ({
              name: card.name,
              id: card.cardid,
              zone: partyEngine.get.position(card),
            })),
          })),
          config: partyEngine.lib.configOL.mode,
        }));
        await writeFile(
          `${output}/carry-restored.json`,
          JSON.stringify({ opening: carryOpening, restored, current, equipment }, null, 2),
        );
        assert(
          current
            .filter((card) => card.owned && !card.destroyed)
            .every((card) =>
              restored.some(
                (item) =>
                  item.name === card.name &&
                  item.suit === card.suit &&
                  item.number === card.number &&
                  item.zone === card.zone,
              ),
            ),
          'Current owned carry card faces and equipment survive native reinit',
        );
      }
    }
    const stagedEnemy = recipe.enemies.find((enemy) => enemy.nextForm);
    if (stagedEnemy) await observeBossStage(worker);
    if (index === 1 && statusProbe) await observeBossStatus(worker, statusProbe);
    await worker.evaluate(() => {
      partyEngine.lib.config.game_speed = 'vvfast';
      partyEngine.lib.config.duration = 100;
      partyEngine.game.broadcast(function () {
        partyEngine.lib.config.game_speed = 'vvfast';
        partyEngine.lib.config.duration = 100;
        if (!partyEngine._status.auto) partyEngine.ui.click.auto();
      });
    });
    let stage;
    if (stagedEnemy) {
      await worker.waitForFunction(
        () => partyEngine.proof.bossStage || partyEngine._status.over,
        {},
        { timeout: 180000 },
      );
      const transformed = await worker.evaluate(() => partyEngine.proof.bossStage);
      assert(transformed, 'Native combat ended before the first form was defeated');
      stage = await reloadBossStage(
        worker,
        matchId,
        transformed,
        stagedEnemy,
        stagedEnemy.nextForm,
      );
    }
    const bossStatus =
      index === 1 && statusProbe ? await reloadBossStatus(worker, statusProbe) : undefined;
    const beganAt = Date.now();
    while (!events.some((event) => event.type === 'ended' && event.matchId === matchId)) {
      assert(!events.some((event) => event.type === 'failed'), 'Native PVE failed');
      if (Date.now() - beganAt > 180000) throw new Error('Natural PVE settlement timed out');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const ended = events.find((event) => event.type === 'ended' && event.matchId === matchId);
    assert.equal(ended.shanhetu.runId, shanhetu.runId);
    assert.equal(ended.shanhetu.nodeId, shanhetu.nodeId);
    assert.equal(ended.shanhetu.battleId, battleId);
    assert.equal(ended.shanhetu.hero.general, initial.actors[0].general);
    const npcSkills = await worker.evaluate(() => {
      const { setup, lib } = partyEngine;
      return setup.shanhetuRecipe.enemies.map((enemy, i) => {
        const player = lib.playerOL[`shanhetu-enemy-${i}`];
        const characterSkills = lib.character[player.name1].skills;
        return {
          general: player.name1,
          requiredSkillsPresent: (player.name1.endsWith('_stage2')
            ? enemy.nextForm.skills
            : enemy.skills
          ).every((skill) => characterSkills.includes(skill)),
          used: player
            .getAllHistory('useSkill')
            .map((event) => event.skill)
            .filter(
              (skill) => enemy.skills.includes(skill) || enemy.nextForm?.skills.includes(skill),
            ),
          shaNeedsTwoResponses: player
            .getAllHistory('useCard')
            .some(
              (event) =>
                event.card?.name === 'sha' &&
                event.customArgs?.[setup.ownerPlayerId]?.shanRequired === 2,
            ),
        };
      });
    });
    assert(npcSkills.every((npc) => npc.requiredSkillsPresent));
    const npcActions = await worker.evaluate(() => partyEngine.proof.shanhetuNpcUses ?? []);
    const stageEffects = stage
      ? await worker.evaluate(() => {
          const { game, lib, proof } = partyEngine;
          const boss = lib.playerOL[proof.bossStage.id];
          const attacks = boss
            .getAllHistory('useCard')
            .slice(proof.bossStage.cardUses)
            .filter((use) => use.card?.name === 'sha');
          return {
            attackTargets: attacks.map((use) => use.targets.length),
            responses: attacks.flatMap((use) =>
              use.targets.map((target) => use.customArgs[target.playerid]?.shanRequired ?? 1),
            ),
            halberdRecoveries: game
              .getAllGlobalHistory(
                'everything',
                (event) =>
                  event.name === 'recover' && event.getParent()?.name === 'shanhetuHalberdRecovery',
              )
              .map((event) => event.num),
          };
        })
      : undefined;
    const weaponUses = await worker.evaluate(() =>
      partyEngine.setup.shanhetuRecipe.enemies.map((enemy, i) => {
        const player = partyEngine.lib.playerOL[`shanhetu-enemy-${i}`];
        return player
          .getAllHistory('useSkill')
          .map((event) => event.skill)
          .filter(
            (skill) =>
              ['chixueqingfeng', 'fangtian_skill', 'wushuangfangtianji_skill'].includes(skill) ||
              [...(enemy.fixedEquipment ?? []), ...(enemy.nextForm?.fixedEquipment ?? [])].some(
                ({ nativeId }) => skill === `${nativeId}_skill`,
              ),
          );
      }),
    );
    const fenchengRounds = npcActions
      .filter((use) => use.skill === 'party_shanhetu_fencheng')
      .map((use) => use.round);
    assert(
      fenchengRounds.every((round, index) => index === 0 || round - fenchengRounds[index - 1] >= 2),
      'Fencheng must respect two actual native rounds',
    );
    const drawCounts = await worker.evaluate(() => partyEngine.proof.drawCounts);
    const armorRecovery = await worker.evaluate(
      () => partyEngine.proof.shanhetuArmorRecovery ?? [],
    );
    if (recipe.enemies.some((enemy) => enemy.armorRecovery > 0 && enemy.armor < 5)) {
      assert(armorRecovery.length, 'Hard chapter-3 enemy must recover armor in the native loop');
      for (const event of armorRecovery) {
        const enemy = recipe.enemies[Number(event.id.split('-').at(-1))];
        assert.equal(event.after, Math.min(event.before + enemy.armorRecovery, 5));
      }
    }
    let carryAfter;
    if (index === 1 && withCarry) {
      carryAfter = await worker.evaluate(() =>
        partyEngine._carryProbe.map((card) => ({
          id: card._partyShanhetuCarry,
          destroyed: !!card._selfDestroyed,
          circulating:
            card.parentNode === partyEngine.ui.discardPile ||
            card.parentNode === partyEngine.ui.cardPile,
        })),
      );
      assert(
        carryAfter.some((card) => card.destroyed),
        'At least one carry card must be naturally used/discarded',
      );
      assert(
        carryAfter.every((card) => !card.circulating),
        'No carry instance enters the circular deck',
      );
    }
    assert(
      drawCounts.some(
        (draw) =>
          draw.id === ownerPlayerId &&
          draw.num === (index === 1 && withGrowth ? 4 : 2) + (terrainId === 13278 ? 2 : 0),
      ),
      'Native phaseDraw must apply build and tactic together',
    );
    assert(
      drawCounts
        .filter((draw) => draw.id.startsWith('shanhetu-enemy-'))
        .every((draw) => {
          const enemy = recipe.enemies[Number(draw.id.split('-').at(-1))];
          const form = draw.general.endsWith('_stage2') ? enemy.nextForm : enemy;
          if (draw.skills.includes('party_shanhetu_wuzang'))
            return draw.num === Math.max(5, Math.floor(draw.hp / 2));
          const expected =
            form.draw +
            (draw.skills.includes('reyingzi') ? 1 : 0) +
            (draw.crown ? 2 : 0) +
            (draw.skills.includes('party_shanhetu_might') ? draw.opponents : 0) +
            (terrainId === 13278 && !draw.fixed ? 2 : 0);
          return (
            draw.num === expected ||
            (draw.num === 0 && draw.skills.includes('party_shanhetu_luoyi')) ||
            (draw.skills.includes('juguan') && draw.num === expected + 2) ||
            (draw.skills.includes('new_retuxi') && draw.num >= 0 && draw.num < expected)
          );
        }),
      'NPC phaseDraw must use its original recipe and actual skill modifiers',
    );
    results.push({
      ...ended.shanhetu,
      initialActors: initial.actors.length,
      refreshed: index < 2,
      selectionRefreshed: index === 0,
      concealedEnemyHands: true,
      growthApplied: index === 1 && withGrowth,
      phaseDrawCounts: drawCounts,
      terrainId,
      armorRecovery,
      npcSkills,
      npcActions,
      difficulty,
      stage,
      stageEffects,
      bossStatus,
      openingGear,
      weaponUses,
      pile,
      carryOpening,
      carryAfter,
    });
    await phone.screenshot({ path: `${output}/battle-${index}-ended.png` });
    console.log(
      `PVE ${battleId}: ${ended.shanhetu.outcome}, ${initial.actors.length} actors, native settlement received`,
    );
    if (ended.shanhetu.outcome !== 'victory') break;
  }
  assert(results.length >= 2, 'Two consecutive real encounters must complete');
  assert.equal(results[0].outcome, 'victory');
  if (!boss) assert.equal(results[1].outcome, 'victory');
  if (testDefeat)
    assert(
      results.some((result) => result.outcome === 'defeat'),
      'A natural defeat must be observed',
    );
  assert.equal(faults.length, 0, 'Browser errors observed');
  assert.equal(missing.size, 0, 'Engine resource failures observed');
  assert.equal(results[1].hero.general, results[0].hero.general);
  assert.equal(campaign.view().phase, results[1].outcome === 'victory' ? 'won' : 'lost');
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        scope: 'Internal native PVE integration, not complete Shanhetu or phone/WeChat acceptance',
        physicalPhone: false,
        boss: boss ?? null,
        defeatFixture: testDefeat
          ? 'Separate one-HP/one-max-HP campaign summaries, no in-battle HP or deck changes'
          : null,
        results,
        campaign: campaign.view(),
        faults,
        missing: [...missing],
      },
      null,
      2,
    ),
  );
  console.log(`Native Shanhetu probe passed: ${output}`);
} catch (error) {
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: String(error.stack),
        faults,
        missing: [...missing],
        events,
        results,
        workerProofs: await Promise.all(
          computer
            .frames()
            .filter((frame) => frame.url().includes('/engine/worker/'))
            .map((frame) =>
              frame
                .evaluate(() => ({
                  proof: globalThis.partyEngine?.proof,
                  event: globalThis.partyEngine?._status.event?.name,
                  mode: globalThis.partyEngine?.lib.config.mode,
                  allModes: globalThis.partyEngine?.lib.config.all?.mode,
                  importedModes: Object.keys(globalThis.partyEngine?.lib.imported?.mode ?? {}),
                  loading: document.querySelector('#loading-detail')?.textContent,
                }))
                .catch(() => null),
            ),
        ),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  unsubscribe();
  if (roomCode) adapter.release(roomCode);
  await browser.close();
  const closed = once(party.server, 'close');
  party.stop();
  party.server.closeAllConnections();
  await closed;
}
