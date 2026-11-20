// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShanhetuBook } from '../apps/server/src/shanhetu-book.js';
import { createShanhetuScenario } from '../apps/server/src/shanhetu-scenario.js';
import { ShanhetuCampaign } from '../apps/server/src/shanhetu-campaign.js';

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
  assert.equal(oldPool.rewards.filter((reward) => reward.id.startsWith('skill-')).length, 11);
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
  assert.deepEqual(book.record(key, result), { victories: 3, unlocked: ['连营'] });
  assert.deepEqual(book.record(key, result), { victories: 3, unlocked: ['连营'] });
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
  assert.deepEqual(reopened.record(key, retreat), { victories: 4, unlocked: ['拒关'] });
  assert.throws(() => reopened.unlockedForRun(key, 2), /普通1/);
  assert.deepEqual(
    reopened.record(key, { ...result, runId: 'native-win-1', outcome: 'victory', victories: 11 }),
    { victories: 11, unlocked: ['烈刃', '绝情'] },
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
  assert.deepEqual([...book.unlockedForRun(key, 2)], [3268, 3016]);
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
    { victories: 4, unlocked: ['拒关'] },
  );
  assert.equal(JSON.parse(await readFile(path, 'utf8')).schemaVersion, 2);
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
