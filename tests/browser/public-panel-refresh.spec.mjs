import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

let bundle;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: [
        "export { bindRoomSpectator } from './apps/web/src/room-spectator.ts';",
        "export { bindMatchRecords } from './apps/web/src/match-records.ts';",
        "export { bindSurrenderDialog } from './apps/web/src/surrender-dialog.ts';",
      ].join('\n'),
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'panels',
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.route('http://panels.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>.observer-recent{height:40px;overflow:auto}</style><main id="app"><div class="room-grid"></div><section id="match-panel"><button id="match-share"></button></section></main>',
    }),
  );
  await page.goto('http://panels.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.requests = [];
    window.fetch = (path) => new Promise((resolve) => window.requests.push({ path, resolve }));
  });
});

async function reply(page, url, body) {
  await expect
    .poll(() =>
      page.evaluate((path) => window.requests.some((request) => request.path === path), url),
    )
    .toBe(true);
  await page.evaluate(
    ({ url, body }) => {
      const index = window.requests.findIndex((request) => request.path === url);
      window.requests.splice(index, 1)[0].resolve({ ok: true, json: async () => body });
    },
    { url, body },
  );
}

test('公开观战后台轮询保留牌桌、分页焦点和刷新按钮，手动刷新及新局势仍有反馈', async ({ page }) => {
  const url = '/engine/observe/m1?room=1234';
  const state = {
    round: 2,
    ended: false,
    currentPlayerId: null,
    updatedAt: 1,
    players: [],
    deckCount: 42,
    recent: ['摸牌'],
    logStart: 20,
    logTotal: 20,
    logFirst: 1,
  };
  const observation = { matchId: 'm1', roomCode: '1234', observer: state };
  await page.evaluate(() => {
    panels
      .bindRoomSpectator('1234')
      .context({ matchId: 'm1', phase: 'playing', engine: { publicSpectating: true } }, true);
  });
  await reply(page, url, observation);
  const deck = page.locator('#spectator-deck');
  const button = page.locator('#spectator-refresh');
  const earlier = page.locator('#spectator-table .observer-earlier');
  await expect(deck).toHaveText('牌堆剩余 42 张');
  await earlier.focus();
  await page.evaluate(() => {
    window.originalBoard = document.querySelector('.observer-board');
    window.refreshLabels = [];
    const refresh = document.querySelector('#spectator-refresh');
    new MutationObserver(() => window.refreshLabels.push(refresh.textContent)).observe(refresh, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  for (let timestamp = 2; timestamp <= 3; timestamp++) {
    await expect.poll(() => page.evaluate(() => window.requests.length)).toBe(1);
    await expect(button).toBeEnabled();
    await expect(button).toHaveText('刷新观战');
    await reply(page, url, { ...observation, observer: { ...state, updatedAt: timestamp } });
    await expect(earlier).toBeFocused();
    expect(await page.evaluate(() => window.originalBoard.isConnected)).toBe(true);
  }
  expect(await page.evaluate(() => window.refreshLabels)).toEqual([]);
  const changed = {
    ...observation,
    observer: { ...state, deckCount: 41, recent: ['摸牌', '使用了【杀】'], logTotal: 21 },
  };
  await reply(page, url, changed);
  await expect(deck).toHaveText('牌堆剩余 41 张');
  await expect(page.locator('.observer-spotlight')).toContainText('使用了【杀】');
  await expect(earlier).toBeFocused();
  await button.click();
  await expect(button).toHaveText('正在同步…');
  await reply(page, url, changed);
  await expect(button).toHaveText('刷新观战');
});

for (const spectator of [true, false]) {
  test(`${spectator ? '公开观战' : '本局记录'}翻页时保留键盘焦点，迟到响应尊重已移出的焦点`, async ({
    page,
  }) => {
    const url = spectator ? '/engine/observe/m1?room=1234' : '/engine/history/m1';
    const before = (sequence) => url + (spectator ? '&' : '?') + 'before=' + sequence;
    const history = {
      matchId: 'm1',
      first: 1,
      total: 6,
      entries: [{ sequence: 6, text: '动作6' }],
    };
    await page.evaluate((spectator) => {
      if (spectator) {
        panels
          .bindRoomSpectator('1234')
          .context({ matchId: 'm1', phase: 'playing', engine: { publicSpectating: true } }, true);
      } else {
        panels.bindMatchRecords().context('m1', true);
        document.querySelector('#match-records').click();
      }
    }, spectator);
    await reply(
      page,
      url,
      spectator
        ? {
            ...history,
            roomCode: '1234',
            observer: {
              ended: false,
              round: 2,
              players: [],
              recent: ['动作6'],
              logStart: 6,
              logFirst: 1,
              logTotal: 6,
            },
          }
        : history,
    );
    const earlier = page.getByRole('button', { name: '查看更早记录' });
    const control = page.locator('.observer-earlier');
    const list = page.locator('.observer-recent');
    const external = page.locator(spectator ? '#spectator-refresh' : '.close-dialog');
    async function older(first, last) {
      return reply(page, before(last + 1), {
        ...history,
        roomCode: '1234',
        entries: Array.from({ length: last - first + 1 }, (_, index) => ({
          sequence: first + index,
          text: `动作${first + index}`,
        })),
      });
    }
    await earlier.focus();
    await earlier.press('Enter');
    await expect(control).toHaveAttribute('aria-disabled', 'true');
    await expect(control).toBeFocused();
    await control.press('Enter');
    expect(
      await page.evaluate(
        (path) => window.requests.filter((request) => request.path === path).length,
        before(6),
      ),
    ).toBe(1);
    await older(4, 5);
    await expect(list.locator('li')).toHaveCount(3);
    await expect(earlier).toBeFocused();

    await earlier.press('Enter');
    await external.focus();
    await older(2, 3);
    await expect(list.locator('li')).toHaveCount(5);
    await expect(external).toBeFocused();

    await earlier.focus();
    await earlier.press('Enter');
    await older(1, 1);
    await expect(control).toBeHidden();
    await expect(list).toBeFocused();
    await expect(list.locator('li')).toHaveCount(6);
  });
}

test('公开记录轮询保持节点、焦点和滚动，追加、修订、截断及翻页后同步最新记录', async ({ page }) => {
  const url = '/engine/history/m1';
  const entries = Array.from({ length: 25 }, (_, index) => ({
    sequence: index + 10,
    text: `动作 ${index + 10}`,
  }));
  const history = { matchId: 'm1', total: 34, first: 1, entries };
  await page.evaluate(() => panels.bindMatchRecords().context('m1', true));
  await page.locator('#match-records').click();
  await reply(page, url, history);
  const log = page.locator('.observer-log');
  const earlier = log.locator('.observer-earlier');
  await earlier.focus();
  await log.evaluate((node) => {
    const list = node.querySelector('ol');
    list.scrollTop = 25;
    window.originalList = list;
    window.originalEarlier = node.querySelector('button');
  });
  await reply(page, url, { ...history, deckCount: 41 });
  expect(
    await log.evaluate((node) => [
      window.originalList === node.querySelector('ol'),
      window.originalEarlier === document.activeElement,
      window.originalList.scrollTop,
    ]),
  ).toEqual([true, true, 25]);
  await reply(page, url, {
    ...history,
    total: 35,
    entries: [...entries, { sequence: 35, text: '新出牌' }],
  });
  await expect(log.locator('li').last()).toHaveText('新出牌');
  await expect(earlier).toBeFocused();
  expect(await log.locator('ol').evaluate((node) => node.scrollTop)).toBe(25);
  await earlier.click();
  await reply(page, url + '?before=10', {
    matchId: 'm1',
    total: 35,
    first: 1,
    entries: Array.from({ length: 9 }, (_, index) => ({
      sequence: index + 1,
      text: `更早动作 ${index + 1}`,
    })),
  });
  await expect(log.locator('li')).toHaveCount(35);
  await reply(page, url, {
    ...history,
    total: 35,
    first: 4,
    entries: [{ sequence: 35, text: '已校正的新出牌' }],
  });
  await expect(log.locator('li')).toHaveCount(32);
  await expect(log.locator('li').first()).toHaveText('更早动作 4');
  await expect(log.locator('li').last()).toHaveText('已校正的新出牌');
});

test('投票倒计时及重复状态只更新变化内容，投票人新增、同意、移除立即反映', async ({ page }) => {
  await page.evaluate(() => {
    window.voteDialog = panels.bindSurrenderDialog(() => 'versus');
    voteDialog.context('m1', true, true);
    window.state = {
      available: true,
      cooldownMs: 0,
      vote: {
        epoch: 'v1',
        eligible: true,
        voted: false,
        initiator: '甲',
        remainingMs: 30000,
        participants: [{ nickname: '甲', approved: false }],
      },
    };
    voteDialog.update(state);
    window.initialParticipant = document.querySelector('#surrender-voters li');
    window.voterWrites = 0;
    new MutationObserver((records) => {
      window.voterWrites += records.length;
    }).observe(document.querySelector('#surrender-voters'), {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  const reject = page.locator('#surrender-reject');
  await reject.focus();
  await expect(page.locator('#surrender-countdown')).toContainText(/剩余 2[89] 秒/);
  await page.evaluate(() => voteDialog.update(structuredClone(state)));
  expect(
    await page.evaluate(() => [window.voterWrites, window.initialParticipant.isConnected]),
  ).toEqual([0, true]);
  await expect(reject).toBeFocused();
  await page.evaluate(() => {
    state.vote.participants[0].approved = true;
    state.vote.participants.push({ nickname: '乙', approved: false });
    voteDialog.update(state);
  });
  await expect(page.locator('#surrender-voters li')).toHaveText(['甲 · 已同意', '乙 · 等待确认']);
  await page.evaluate(() => {
    state.vote.participants.shift();
    voteDialog.update(state);
    voteDialog.context('m1', true, false);
  });
  await expect(page.locator('#surrender-voters li')).toHaveText(['乙 · 等待确认']);
  await expect(page.locator('#surrender-confirm')).toBeDisabled();
});
