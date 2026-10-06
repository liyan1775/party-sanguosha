import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.js';
import type { TableState, TableItem } from '../../packages/shared/src/table.js';

const item = (key: string, label: string, action = ''): TableItem => ({
  key,
  label,
  action,
  kind: 'card',
  detail: '原生卡牌说明',
  image: '',
  suit: '♥',
  number: '7',
  selected: false,
  enabled: Boolean(action),
});
const state = (): TableState => ({
  epoch: 'epoch',
  revision: 1,
  choice: 2,
  playerId: 'me',
  round: 2,
  phase: 'chooseToUse',
  prompt: '出牌阶段，请选择牌与目标',
  choosing: true,
  auto: false,
  over: false,
  result: '',
  autoAction: 'auto',
  players: Array.from({ length: 8 }, (_, index) => ({
    id: index ? `seat-${index}` : 'me',
    nickname: index ? `朋友${index}` : '<img src=x onerror=alert(1)>',
    general: index ? '赵云' : '甄姬',
    image: '',
    identity: index ? '身份未公开' : '主公',
    hp: 3,
    maxHp: 4,
    armor: 0,
    handCount: 4,
    dead: false,
    linked: false,
    turned: false,
    current: index === 0,
    selected: false,
    action: index === 1 ? 'target' : '',
    equipment: [],
    judgments: [],
    marks: [],
    abilities: [],
  })),
  hand: [
    item('bagua', '八卦阵', 'select'),
    item('sha', '杀', 'select-sha'),
    ...Array.from({ length: 18 }, (_, i) => item(`card-${i}`, '闪')),
  ],
  controls: [{ ...item('use', '使用', 'use'), kind: 'control' }],
  skills: [],
  dialogs: [],
  played: [],
  abilities: [{ label: '洛神', detail: '准备阶段，你可以判定。' }],
});
async function withTable(
  page: Page,
  run: (data: { state: TableState; actions: string[]; send: () => void }) => Promise<void>,
) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const party = createPartyServer({ port: 0, webRoot: `${root}/dist/web` });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const data = state(),
    actions: string[] = [],
    errors: string[] = [];
  let socket: WebSocketRoute;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/engine/table/mock', async (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: await readFile(`${root}/dist/web/table.html`, 'utf8'),
    }),
  );
  await page.route('**/engine/table-setup/mock', (route) =>
    route.fulfill({
      json: {
        id: 'mock',
        playerId: 'me',
        assetBase: '/engine/core/test/',
        playerStreaming: false,
        playerNetwork: 'lan',
      },
    }),
  );
  await page.routeWebSocket('**/engine/socket/mock/player*', (ws) => {
    socket = ws;
    ws.send(JSON.stringify(['table', data]));
    ws.onMessage((message) => {
      const packet = JSON.parse(String(message));
      actions.push(packet[3]);
      if (packet[3] === 'select') data.hand[0]!.selected = true;
      if (packet[3] === 'use') {
        data.hand.shift();
        data.choosing = false;
        data.controls = [];
      }
      data.revision++;
      ws.send(JSON.stringify(['table', data]));
    });
  });
  try {
    await page.goto(`http://127.0.0.1:${address.port}/engine/table/mock`);
    await expect(page.locator('#hand .table-item')).toHaveCount(20);
    await run({ state: data, actions, send: () => socket.send(JSON.stringify(['table', data])) });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    party.closeStreams();
    party.server.closeAllConnections();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  }
}

test('轻量渲染占位：八席、手牌滚动、安全昵称、先选再确认和结算回房入口', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 350 });
  await withTable(page, async ({ state, actions, send }) => {
    await expect(page.locator('#self .player-nickname')).toContainText('<img src=x');
    await expect(page.locator('#self img')).toHaveCount(0);
    await expect(page.locator('#opponents .player-seat')).toHaveCount(7);
    await page.locator('#hand button').first().click();
    await expect(page.locator('#hand button').first()).toHaveAttribute('aria-pressed', 'true');
    expect(actions).toEqual(['select']);
    await page.locator('#controls button').click();
    await expect(page.locator('#hand .table-item')).toHaveCount(19);
    expect(actions).toEqual(['select', 'use']);
    const dimensions = await page
      .locator('#hand')
      .evaluate((node) => ({ width: node.clientWidth, content: node.scrollWidth }));
    expect(dimensions.content).toBeGreaterThan(dimensions.width);
    await page.locator('#abilities-button').click();
    await expect(page.locator('#detail-dialog')).toContainText('洛神');
    await page.locator('#close-detail').click();
    state.over = true;
    state.result = '你赢了';
    state.revision++;
    send();
    await expect(page.locator('#return-room')).toBeVisible();
    await expect(page.locator('#result-title')).toHaveText('你赢了');
    await mkdir(`${fileURLToPath(new URL('../../', import.meta.url))}/.runtime/previews`, {
      recursive: true,
    });
    await page.screenshot({ path: '.runtime/previews/lightweight-eight-seats.png' });
  });
});

test('轻量渲染占位：竖屏选择池与移动牌区可滚动，提示和确认保持可见', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await withTable(page, async ({ state, send }) => {
    state.prompt = '请选择一名武将';
    state.dialogs = [
      {
        key: 'choices',
        text: '请选择一名武将',
        items: Array.from({ length: 30 }, (_, index) => ({
          ...item(`general-${index}`, '赵云', `general-${index}`),
          kind: 'general',
        })),
        zones: [],
      },
    ];
    state.revision++;
    send();
    await expect(page.locator('#choice-panel')).toBeVisible();
    await expect(page.locator('#controls button')).toBeVisible();
    const scroll = await page
      .locator('#choice-content')
      .evaluate((node) => node.scrollHeight > node.clientHeight);
    expect(scroll).toBe(true);
    state.dialogs = [
      {
        key: 'move',
        text: '选择牌，然后点要移入的牌区',
        items: [],
        zones: [
          { label: '牌堆顶', action: 'top', items: [item('move-card', '杀', 'move-card')] },
          { label: '牌堆底', action: 'bottom', items: [] },
        ],
      },
    ];
    state.revision++;
    send();
    await expect(page.getByRole('button', { name: '牌堆底 · 移到此区' })).toBeVisible();
  });
});

test('轻量分组选择：自己的手牌与目标手牌各占一行，牌面和花色可见，单独提交选牌', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 312 });
  await withTable(page, async ({ state, actions, send }) => {
    state.phase = 'chooseButton';
    state.dialogs = [
      {
        key: 'poxi',
        text: '',
        items: [
          item('own', '杀', 'own'),
          { ...item('target', '桃', 'target-card'), suit: '♦', number: '3' },
        ],
        zones: [],
        groups: [
          { label: '你的手牌', items: [item('own', '杀', 'own')] },
          {
            label: '曹操的手牌',
            items: [{ ...item('target', '桃', 'target-card'), suit: '♦', number: '3' }],
          },
        ],
      },
    ];
    state.revision++;
    send();
    await expect(page.locator('#choice-panel')).toBeVisible();
    const groups = page.locator('.choice-group');
    await expect(groups).toHaveCount(2);
    await expect(page.locator('#choice-content .table-item')).toHaveCount(2);
    await expect(groups.nth(0).locator('h3')).toHaveText('你的手牌');
    await expect(groups.nth(1).locator('h3')).toHaveText('曹操的手牌');
    await expect(groups.nth(1).getByRole('button', { name: '桃 ♦3' })).toBeVisible();
    expect(
      await groups.nth(1).evaluate((node) => node.getBoundingClientRect().top),
    ).toBeGreaterThan(await groups.nth(0).evaluate((node) => node.getBoundingClientRect().top));
    await groups.nth(1).getByRole('button', { name: '桃 ♦3' }).click();
    expect(actions).toEqual(['target-card']);
    state.dialogs[0]!.groups![0]!.items.push(
      ...Array.from({ length: 19 }, (_, i) => item(`large-${i}`, '杀')),
    );
    state.revision++;
    send();
    await expect(groups.nth(0).locator('.table-item')).toHaveCount(20);
    expect(
      await groups
        .nth(0)
        .locator('.choice-options')
        .evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    await page.locator('.choice-section').evaluateAll(async (nodes) => {
      await Promise.all(
        nodes.flatMap((node) => node.getAnimations()).map((animation) => animation.finished),
      );
    });
    const pane = await page.locator('#choice-content').boundingBox();
    const lowerCard = await groups.nth(1).getByRole('button', { name: '桃 ♦3' }).boundingBox();
    expect(lowerCard!.y + lowerCard!.height).toBeLessThanOrEqual(pane!.y + pane!.height);
    // An old running server removes optional groups; the flattened pool still works.
    delete state.dialogs[0]!.groups;
    state.revision++;
    send();
    await expect(page.locator('.choice-group')).toHaveCount(0);
    await expect(page.locator('#choice-content .table-item')).toHaveCount(2);
    await expect(
      page.locator('#choice-content').getByRole('button', { name: '桃 ♦3' }),
    ).toBeVisible();
    state.dialogs = [
      { key: 'target-prompt', text: '请选择魄袭的目标。\n'.repeat(6), items: [], zones: [] },
    ];
    state.players[3]!.action = 'target';
    state.revision++;
    send();
    await expect(page.locator('#choice-panel')).toHaveClass(/prompt-only/);
    await page.locator('#opponents [data-player-id="seat-3"] .player-face').click();
    expect(actions).toEqual(['target-card', 'target']);
  });
});

test('原生动作表现：稳定节点、正常半秒飞牌、选择不中断、重复/过期/刷新不补播、精简偏好保留', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await withTable(page, async ({ state, send }) => {
    await page.locator('#hand [data-key="bagua"]').focus();
    await page.evaluate(
      () =>
        ((window as Window & { savedCard?: Element | null }).savedCard = document.querySelector(
          '#hand [data-key="bagua"]',
        )),
    );
    state.hand[0]!.selected = true;
    state.revision++;
    send();
    await expect(page.locator('#hand [data-key="bagua"]')).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page.evaluate(
        () =>
          (window as Window & { savedCard?: Element | null }).savedCard ===
          document.querySelector('#hand [data-key="bagua"]'),
      ),
    ).toBe(true);
    await expect(page.locator('#hand [data-key="bagua"]')).toBeFocused();
    const at = Date.now();
    state.presentedAt = at;
    state.events = [
      {
        id: 1,
        at,
        kind: 'use',
        source: 'me',
        targets: ['seat-1'],
        count: 1,
        amount: 0,
        nature: '',
        label: '杀',
        cards: [{ label: '杀', suit: '♠', number: '7', image: '', nature: '' }],
      },
    ];
    state.revision++;
    send();
    await expect(page.locator('#table')).toHaveAttribute('data-presentation-id', '1');
    await expect(page.locator('.motion-card')).toHaveCount(1);
    expect(
      await page.evaluate(() =>
        document
          .getAnimations()
          .some((animation) => Number(animation.effect?.getTiming().duration) >= 500),
      ),
    ).toBe(true);
    await page.locator('#hand [data-key="bagua"]').click();
    await expect(page.locator('#hand [data-key="bagua"]')).toHaveAttribute('aria-pressed', 'true');
    state.revision++;
    send();
    await expect(page.locator('.motion-card')).toHaveCount(1);
    await expect(page.locator('.motion-card')).toHaveCount(0);
    state.events.push({ ...state.events[0]!, id: 2, at: Date.now() - 5000 });
    state.presentedAt = Date.now();
    state.revision++;
    send();
    await expect(page.locator('#table')).toHaveAttribute('data-presentation-id', '1');
    await expect(page.locator('.motion-card')).toHaveCount(0);
    state.events.push({ ...state.events[0]!, id: 3, at: Date.now() });
    state.presentedAt = Date.now();
    state.revision++;
    send();
    await expect(page.locator('#table')).toHaveAttribute('data-presentation-id', '3');
    await expect(page.locator('.motion-card')).toHaveCount(1);
    await page.locator('#motion-button').click();
    await expect(page.locator('#motion-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.motion-card')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#hand .table-item')).toHaveCount(20);
    await expect(page.locator('#motion-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.motion-card')).toHaveCount(0);
  });
});
