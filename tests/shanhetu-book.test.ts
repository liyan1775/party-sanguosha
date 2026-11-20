// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShanhetuBook } from '../apps/server/src/shanhetu-book.js';
import { createShanhetuScenario } from '../apps/server/src/shanhetu-scenario.js';
import { ShanhetuCampaign } from '../apps/server/src/shanhetu-campaign.js';
import { shanhetuRecipe } from '../packages/noname-adapter/src/shanhetu.js';

test('胜场自动解锁，败北和撤军记录已赢的战斗，重复结算只记一次', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'party-shanhetu-book-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cookie = 'browser-credential-for-the-book';
  const key = ShanhetuBook.profileKey(cookie);
  const book = new ShanhetuBook(directory);
  assert.equal(book.view(key).victories, 0);
  assert.deepEqual(
    book.view(key).difficulties.map((rule) => rule.unlocked),
    [true, ...Array<boolean>(14).fill(false)],
  );
  const oldPool = createShanhetuScenario(['caocao'], book.unlockedForRun(key, 1));
  assert.equal(oldPool.rewards.filter((reward) => reward.id.startsWith('skill-')).length, 12);
  assert.equal(oldPool.rewards.filter((reward) => reward.id.startsWith('tactic-')).length, 19);
  assert.equal(oldPool.rewards.filter((reward) => reward.id.startsWith('card-')).length, 95);
  for (const id of ['skill-3225', 'skill-3091', 'card-4012']) {
    assert(oldPool.rewards.some((reward) => reward.id === id));
  }
  assert(!oldPool.rewards.some((reward) => reward.id === 'skill-3016'));
  assert.throws(() => book.unlockedForRun(key, 2), /普通1/);
  assert.throws(() => book.unlockedForRun(key, 6), /普通1/);
  const result = {
    runId: 'native-loss',
    outcome: 'defeat' as const,
    hero: '关羽',
    difficulty: 1,
    victories: 3,
  };
  assert.deepEqual(book.record(key, result), { victories: 3, unlocked: ['连营', '弱袭'] });
  assert.deepEqual(book.record(key, result), { victories: 3, unlocked: ['连营', '弱袭'] });
  const reopened = new ShanhetuBook(directory);
  assert.equal(reopened.view(key).victories, 3);
  assert.equal(reopened.view(key).recent.length, 1);
  assert.throws(() => reopened.unlockedForRun(key, 2), /普通1/);
  const newPool = createShanhetuScenario(['caocao'], reopened.unlockedForRun(key, 1));
  assert.deepEqual(
    newPool.rewards
      .map((reward) => reward.id)
      .filter((id) => !oldPool.rewards.some((reward) => reward.id === id)),
    ['skill-3016'],
  );
  assert(!oldPool.rewards.some((reward) => reward.id === 'skill-3016'));

  const retreat = { ...result, runId: 'native-retreat', outcome: 'retreat' as const, victories: 4 };
  assert.deepEqual(reopened.record(key, retreat), { victories: 4, unlocked: ['拒关', '卫境'] });
  assert.throws(() => reopened.unlockedForRun(key, 2), /普通1/);
  assert.deepEqual(
    reopened.record(key, { ...result, runId: 'native-win-1', outcome: 'victory', victories: 11 }),
    { victories: 11, unlocked: ['烈刃', '绝情', '智愚'] },
  );
  assert.equal(reopened.view(key).victories, 18);
  assert.equal(reopened.view(key).difficulties[1]?.unlocked, true);
  assert.equal(reopened.view(key).difficulties[5]?.unlocked, true);
  assert.throws(() => reopened.unlockedForRun(key, 7), /中等1/);
  assert(
    reopened.view(key).milestones.every((step) => step.skills.every((skill) => skill.unlocked)),
  );
  assert.equal(reopened.view(ShanhetuBook.profileKey('other-browser')).victories, 0);
  for (const difficulty of [2, 3, 4]) {
    assert.throws(
      () => reopened.unlockedForRun(key, difficulty + 1),
      new RegExp(`普通${difficulty}`),
    );
    reopened.record(key, { ...result, runId: `won-${difficulty}`, outcome: 'victory', difficulty });
    assert.equal(reopened.view(key).difficulties[difficulty]?.unlocked, true);
  }
  assert.throws(() => reopened.unlockedForRun(key, 11), /中等1/);
  for (const difficulty of [6, 7, 8, 9, 11, 12, 13, 14]) {
    assert.throws(() => reopened.unlockedForRun(key, difficulty + 1));
    reopened.record(key, { ...result, runId: `won-${difficulty}`, outcome: 'victory', difficulty });
    assert.equal(reopened.view(key).difficulties[difficulty]?.unlocked, true);
  }
  const profile = await readFile(join(directory, `${key}.json`), 'utf8');
  assert(!profile.includes(cookie));
});

test('旧档保留难度前置和已研习进阶技能，只有明确记录的首领胜场折入进度', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'party-shanhetu-book-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = ShanhetuBook.profileKey('legacy');
  const path = join(directory, `${key}.json`);
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      scenarioId: 5,
      profile: {
        revision: 5,
        learned: [1, 5],
        slots: [null, null, 1, null, null, null],
        receipts: [
          { runId: 'old-win', hero: '刘备', outcome: 'victory', albums: 10, finishedAt: 100 },
          {
            runId: 'old-defeat',
            hero: '孙权',
            difficulty: 2,
            outcome: 'defeat',
            albums: 0,
            finishedAt: 101,
          },
        ],
      },
    }),
  );
  const book = new ShanhetuBook(directory);
  assert.deepEqual([...book.unlockedForRun(key, 2)], [3268, 3016, 2360, 3040, 2303]);
  assert.equal(book.view(key).victories, 3);
  assert.deepEqual(
    book.view(key).recent.map((item) => [item.difficulty, item.outcome, item.historic]),
    [
      [2, 'defeat', true],
      [1, 'victory', true],
    ],
  );
  assert.throws(() => book.unlockedForRun(key, 3), /普通2/);
  assert.deepEqual(
    book.record(key, {
      runId: 'new-defeat',
      hero: '刘备',
      difficulty: 2,
      outcome: 'defeat',
      victories: 4,
    }),
    { victories: 4, unlocked: ['拒关', '卫境'] },
  );
  assert.equal(JSON.parse(await readFile(path, 'utf8')).schemaVersion, 3);
  const reopened = new ShanhetuBook(directory);
  assert.deepEqual(reopened.view(key), book.view(key));
});

test('和光盟、传承从首次出征可选，每次只生效一项原初始战法', () => {
  const alliance = new ShanhetuCampaign(createShanhetuScenario(['caocao'], undefined, 1, 2219));
  assert.deepEqual(alliance.view().initialTactics, ['和光盟']);
  assert.equal(alliance.view().companions.length, 1);
  assert([997019, 997024, 997025].includes(alliance.view().companions[0]!));
  const campaign = new ShanhetuCampaign(createShanhetuScenario(['caocao'], undefined, 1, 2138));
  const act = (index: number) => {
    const view = campaign.view();
    return campaign.act({
      runId: view.id,
      revision: view.revision,
      actionId: view.actions[index]!.id,
    });
  };
  assert.deepEqual(campaign.view().initialTactics, ['传承']);
  assert.equal(campaign.view().companions.length, 0);
  act(0);
  assert.equal(campaign.view().phase, 'reward');
  assert.equal(campaign.view().actions.length, 3);
  assert(campaign.view().actions.every((action) => action.kind === 'reward'));
  act(0);
  assert.equal(campaign.view().phase, 'map');
  assert.equal(campaign.view().completedNodes, 0);
  assert.equal(campaign.view().days, 0);
  assert.equal(act(0).battle!.build!.skills.length, 1);
  assert.throws(() => createShanhetuScenario(['caocao'], undefined, 1, [2219, 2138]), /初始战法/);
});

test('两趟征程的第二章关底分别记功，重开、重复回执和领奖前撤军都按实际结果结算', () => {
  const book = new ShanhetuBook();
  const key = ShanhetuBook.profileKey('two-cities');
  function journey(city: number, hulaoFight: number) {
    const catalog = createShanhetuScenario(['caocao'], book.unlockedForRun(key, 1), 1, 2360);
    catalog.initialRegion = 'region-4';
    for (const region of catalog.regions!) {
      const opening = catalog.nodes.find((node) => node.id === region.nodes[0])!;
      opening.duration = region.bossAt;
      opening.rewardGroups = [];
    }
    const hulao = catalog.regions!.find((region) => region.id === 'region-4')!;
    const boss = catalog.nodes.find((node) => node.id === hulao.boss)!;
    boss.battleId = hulaoFight;
    boss.rewardGroups = [];
    const campaign = new ShanhetuCampaign(catalog);
    const act = (id = campaign.view().actions[0]!.id) => {
      const { id: runId, revision } = campaign.view();
      return campaign.act({ runId, revision, actionId: id });
    };
    const win = (restart = false) => {
      let ticket = act().battle!;
      assert.deepEqual(ticket.build!.tactics, [2360]);
      campaign.bindMatch(ticket, 'first-instance');
      if (restart) {
        ticket = campaign.restart('first-instance');
        campaign.bindMatch(ticket, 'replacement');
      }
      const match = restart ? 'replacement' : 'first-instance';
      const result = {
        runId: ticket.runId,
        nodeId: ticket.nodeId,
        battleId: ticket.battleId,
        hero: ticket.hero!,
        outcome: 'victory' as const,
        defeatedEnemies: shanhetuRecipe(ticket.battleId).enemies.length,
      };
      assert(!campaign.settle(match, { ...result, defeatedEnemies: result.defeatedEnemies - 1 }));
      if (restart) assert(!campaign.settle('first-instance', result));
      assert(campaign.settle(match, result));
      assert(!campaign.settle(match, result));
    };
    act();
    win();
    assert.deepEqual(campaign.bossVictories(), []);
    win(true);
    const cityAction = campaign
      .view()
      .map!.regions.find((region) => region.id === `region-${city}`)!;
    act(cityAction.actionId!);
    win();
    assert.equal(campaign.bossVictories().length, 1);
    win();
    assert.equal(campaign.view().phase, 'reward');
    const result = {
      runId: campaign.view().id,
      difficulty: 1,
      hero: '曹操',
      outcome: 'retreat' as const,
      victories: campaign.view().victories,
      bossVictories: campaign.bossVictories(),
    };
    const award = book.record(key, result);
    assert.deepEqual(book.record(key, result), award);
    return award;
  }
  const battleGoal = (id: number) =>
    book.view(key).goals.find((goal) => goal.content.some((item) => item.id === id))!;
  assert.throws(
    () => createShanhetuScenario(['caocao'], book.unlockedForRun(key, 1), 1, 2303),
    /尚未解锁/,
  );
  const before = createShanhetuScenario(['caocao'], book.unlockedForRun(key, 1));
  assert(before.rewards.some((item) => item.id === 'skill-3040'));
  assert(!journey(5, 22646).unlocked.includes('淬血Ⅱ'));
  assert.equal(battleGoal(2249).progress, 1);
  assert.deepEqual(battleGoal(2249).cities, ['轘辕关']);
  assert(journey(5, 22644).unlocked.includes('淬血Ⅱ'));
  assert.equal(battleGoal(2249).progress, 1);
  assert(journey(8, 22645).unlocked.includes('博闻Ⅰ'));
  assert.equal(battleGoal(2249).progress, 2);
  assert.deepEqual(battleGoal(2249).cities, ['轘辕关', '孟津']);
  assert.equal(book.view(key).victories, 12);
  assert.equal(
    before.rewards.some((item) => item.id === 'tactic-2049'),
    false,
  );
  for (const opening of [2303, 2249]) {
    const next = createShanhetuScenario(['caocao'], book.unlockedForRun(key, 1), 1, opening);
    assert.deepEqual(new ShanhetuCampaign(next).view().build.tactics, [opening]);
    assert(next.rewards.some((item) => item.id === 'tactic-2049'));
    assert(
      !next.rewards.some((item) => ['tactic-2360', 'tactic-2303', 'tactic-2249'].includes(item.id)),
    );
  }
});

test('第二版山河册从已证胜场补开新内容，未记录的征途不推定吕布或第二章城池', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'party-shanhetu-book-v2-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = ShanhetuBook.profileKey('v2-without-route');
  const path = join(directory, `${key}.json`);
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 2,
      scenarioId: 5,
      profile: {
        revision: 1,
        legacySkills: [],
        receipts: [
          {
            runId: 'old',
            hero: '曹操',
            finishedAt: 1,
            outcome: 'victory',
            difficulty: 1,
            victories: 36,
            unlocked: [3016, 3253, 3268, 3177],
          },
        ],
      },
    }),
  );
  const book = new ShanhetuBook(directory);
  const unlocked = book.unlockedForRun(key, 2);
  for (const id of [2360, 3040, 2303, 3218, 3178, 2100, 3086]) assert(unlocked.has(id));
  for (const id of [2249, 2049]) assert(!unlocked.has(id));
  const next = createShanhetuScenario(['caocao'], unlocked);
  for (const id of ['skill-3040', 'skill-3218', 'skill-3178', 'tactic-2100', 'skill-3086'])
    assert(next.rewards.some((reward) => reward.id === id));
  assert.deepEqual(
    book.record(key, {
      runId: 'next',
      hero: '曹操',
      outcome: 'defeat',
      difficulty: 2,
      victories: 1,
      bossVictories: [{ regionId: 'region-4', battleId: 2645 }],
    }),
    { victories: 1, unlocked: ['淬血Ⅱ'] },
  );
  assert.equal(new ShanhetuBook(directory).view(key).recent[0]!.newUnlocks?.[0], '淬血Ⅱ');
});
