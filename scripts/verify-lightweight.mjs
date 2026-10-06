import assert from 'node:assert/strict';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { createPublicGateway } from '../apps/server/src/public-gateway.ts';
import { verifyPrivateChoices } from './native-private-choices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const engine = new NativeNonameService(root);
const party = createPartyServer({ port: 0, webRoot: `${root}/dist/web`, adapter: engine });
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const gateway =
  process.env.LIGHT_VERIFY_PUBLIC === '1' ? createPublicGateway(party.server.address().port) : null;
if (gateway) {
  await new Promise((resolve) => gateway.server.listen(0, '127.0.0.1', resolve));
  party.setInternetEntry('ready', '轻量牌桌测试代理', 'https://lightweight.trycloudflare.com/');
}
const origin = gateway ? `http://127.0.0.1:${gateway.server.address().port}` : base;
const output = `.runtime/lightweight/${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const contexts = [],
  errors = [],
  missing = [],
  results = [];
async function page(mobile) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {},
  );
  contexts.push(context);
  if (mobile)
    await context.addInitScript(() =>
      sessionStorage.setItem('party_lightweight_verification', '1'),
    );
  if (process.env.LIGHT_VERIFY_HTTP === '1')
    await context.addInitScript(() => sessionStorage.setItem('party_http_transport', '1'));
  if (gateway)
    await context.addInitScript(() =>
      Object.defineProperty(window, 'RTCPeerConnection', { value: undefined }),
    );
  if (!mobile)
    await context.addInitScript(() => {
      window.partyViewFaults = [];
      window.addEventListener('message', (event) => {
        if (event.origin === location.origin && event.data?.type === 'party-view-failed')
          window.partyViewFaults.push(
            event.source?.partyEngine?.proof?.errors?.map((error) => error.slice(0, 3000)) ?? [],
          );
      });
    });
  if (
    (process.env.LIGHT_VERIFY_TARGETED === '1' ||
      process.env.LIGHT_VERIFY_MOVE === '1' ||
      process.env.LIGHT_VERIFY_PRIVATE ||
      process.env.LIGHT_VERIFY_GOD === '1') &&
    !mobile
  )
    await context.route('**/engine/runtime/mode.js', async (route) => {
      const headers = { ...route.request().headers() };
      delete headers['if-none-match'];
      delete headers['if-modified-since'];
      const response = await route.fetch({ headers });
      const source = await response.text();
      const hero = process.env.LIGHT_VERIFY_PRIVATE
        ? process.env.LIGHT_VERIFY_PRIVATE === 'poxi'
          ? 'shen_ganning'
          : 'shen_lvmeng'
        : process.env.LIGHT_VERIFY_GOD === '1'
          ? 'shen_zhaoyun'
          : process.env.LIGHT_VERIFY_MOVE === '1'
            ? 'zhugeliang'
            : 'zhenji';
      const opponent = process.env.LIGHT_VERIFY_GOD === '1' ? 'shen_lvbu' : 'caocao';
      await route.fulfill({
        response,
        body: source
          .replace(
            'pool.randomRemove(choiceCount)',
            `[game.players.indexOf(player) === 0 ? '${hero}' : '${opponent}']`,
          )
          .replace(
            'const seats = setup.seats.slice().randomSort();',
            'const seats = setup.seats.slice();',
          ),
      });
    });
  const result = await context.newPage();
  result.on('pageerror', (error) => errors.push(error.message));
  result.on('response', (response) => {
    if (response.status() >= 400) missing.push(new URL(response.url()).pathname);
  });
  return result;
}
async function request(page, path, method = 'POST', body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`fixture request ${response.status}: ${path}`);
      return response.json();
    },
    { path, method, body },
  );
}
const frame = (phone) => phone.frames().find((frame) => frame.url().includes('/engine/table/'));
async function startRoom(phone, code) {
  // This request outlives a test page refresh during the real selection phase.
  // Playwright's API client does not apply Chromium's localhost exception for
  // Secure cookies. Keep the same browser seat on the loopback public fixture.
  const cookies = await phone.context().cookies();
  const response = await phone.request.post(new URL(`/api/rooms/${code}/start`, phone.url()).href, {
    headers: {
      Origin: new URL(phone.url()).origin,
      Cookie: cookies
        .filter((cookie) => cookie.name === 'party_player')
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; '),
    },
    data: {},
    timeout: 190000,
  });
  assert(response.ok(), `start returned ${response.status()}: ${await response.text()}`);
}
async function choose(phone) {
  await phone.waitForFunction(
    () =>
      document
        .querySelector('#game-frame')
        ?.contentWindow?.partyTable?.state?.dialogs.some((dialog) =>
          dialog.items.some((item) => item.kind === 'general' && item.enabled),
        ),
    null,
    { timeout: 60000 },
  );
  const table = frame(phone);
  await table.locator('.choice-options .general.selectable').first().tap();
  await table.locator('.choice-options .general.selected').waitFor();
  await table
    .locator('#controls button')
    .filter({ hasText: /^确定$/ })
    .tap();
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await table.evaluate(() => ({
      hand: partyTable.state.hand.length,
      group: partyTable.state.prompt.includes('势力'),
      choosing: partyTable.state.choosing,
    }));
    if (current.hand) return;
    if (current.group && current.choosing) {
      await table.locator('.choice-options .table-item.selectable').first().tap();
      await table
        .locator('#controls button')
        .filter({ hasText: /^确定$/ })
        .tap();
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
try {
  const desktop = await page(false);
  await desktop.goto(base + '/server');
  await desktop.waitForFunction(async () => (await (await fetch('/api/info')).json()).engine.ready);
  for (const mode of process.env.LIGHT_VERIFY_MODE
    ? [process.env.LIGHT_VERIFY_MODE]
    : ['duel', 'doudizhu', 'versus', 'identity']) {
    const count =
      mode === 'identity'
        ? Number(process.env.LIGHT_VERIFY_SEATS ?? 5)
        : { duel: 2, doudizhu: 3, versus: 4 }[mode];
    const humanCount = Number(process.env.LIGHT_VERIFY_HUMANS ?? 2);
    assert(humanCount >= 2 && humanCount <= count);
    const phones = await Promise.all(Array.from({ length: humanCount }, () => page(true)));
    const requests = [];
    for (const phone of phones)
      phone.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await phones[0].goto(origin + '/');
    const joined = await request(phones[0], '/api/rooms', 'POST', { nickname: '轻量甲' });
    const code = joined.room.code;
    await request(phones[0], `/api/rooms/${code}`, 'PUT', {
      mode,
      playerCount: count,
      generalPreset: process.env.LIGHT_VERIFY_ADVANCED === '1' ? 'advanced' : 'beginner',
      extensions: [],
    });
    for (let i = 1; i < phones.length; i++) {
      await phones[i].goto(origin + `/join/${code}`);
      await request(phones[i], `/api/rooms/${code}/players`, 'POST', { nickname: `轻量成员${i}` });
    }
    if (count > humanCount)
      await request(phones[0], `/api/rooms/${code}/bots`, 'POST', { count: count - humanCount });
    for (const phone of phones) {
      await phone.goto(origin + `/join/${code}`);
      await phone.waitForFunction(() => !document.querySelector('#ready-button')?.disabled);
      await phone.locator('#ready-button').tap();
    }
    await phones[0].waitForFunction(() => !document.querySelector('#start-button')?.disabled);
    const start = startRoom(phones[0], code);
    void start.catch(() => {});
    await Promise.race([
      phones[0].waitForFunction(
        () =>
          document
            .querySelector('#game-frame')
            ?.contentWindow?.partyTable?.state?.dialogs.some((dialog) =>
              dialog.items.some((item) => item.kind === 'general' && item.enabled),
            ),
        null,
        { timeout: 60000 },
      ),
      start.then(() => new Promise(() => {})),
    ]);
    const offer = await frame(phones[0]).evaluate(() => ({
      epoch: partyTable.state.epoch,
      choice: partyTable.state.choice,
      options: partyTable.state.dialogs.flatMap((dialog) => dialog.items.map((item) => item.key)),
    }));
    await phones[0].reload();
    await phones[0].waitForFunction(
      () =>
        document
          .querySelector('#game-frame')
          ?.contentWindow?.partyTable?.state?.dialogs.some((dialog) =>
            dialog.items.some((item) => item.kind === 'general' && item.enabled),
          ),
      null,
      { timeout: 60000 },
    );
    assert.deepEqual(
      await frame(phones[0]).evaluate(() => ({
        epoch: partyTable.state.epoch,
        choice: partyTable.state.choice,
        options: partyTable.state.dialogs.flatMap((dialog) => dialog.items.map((item) => item.key)),
      })),
      offer,
    );
    await Promise.all(phones.map(choose));
    await start;
    const worker = desktop.frames().find((frame) => frame.url().includes('/engine/worker/'));
    assert(worker);
    await worker.waitForFunction(() => partyEngine.proof.started);
    console.log(`${mode}: 真实选将与发牌完成`);
    for (const phone of phones)
      await frame(phone).waitForFunction(() => partyTable.state.hand.length > 0);
    assert(
      !requests.some((path) => /\/engine\/(bundle|core|runtime)\/.+\.js$/.test(path)),
      'phone must never load engine modules',
    );
    assert(
      !requests.some((path) => /\/engine\/core\/.+\.css$/.test(path)),
      'phone must never load native styles',
    );
    await phones[0].screenshot({ path: `${output}/${mode}-table.png` });
    await phones[0].setViewportSize({ width: 844, height: 390 });
    await phones[0].screenshot({ path: `${output}/${mode}-landscape.png` });
    await phones[0].setViewportSize({ width: 390, height: 844 });
    if (process.env.LIGHT_VERIFY_MOVE === '1') {
      const first = frame(phones[0]);
      await first.waitForFunction(
        () => partyTable.state.choosing && partyTable.state.prompt.includes('观星'),
      );
      await first
        .locator('#controls button')
        .filter({ hasText: /^确定$/ })
        .tap();
      await first.waitForFunction(() =>
        partyTable.state.dialogs.some((dialog) => dialog.zones.length >= 2),
      );
      const total = await first.evaluate(
        () =>
          partyTable.state.dialogs.flatMap((dialog) => dialog.zones.flatMap((zone) => zone.items))
            .length,
      );
      const order = await first.evaluate(() =>
        partyTable.state.dialogs
          .find((dialog) => dialog.zones.length >= 2)
          .zones[0].items.map((item) => item.key),
      );
      assert(order.length >= 2);
      await first.locator('.move-zone .card').first().tap();
      await first.locator('.move-zone .card.selected').waitFor();
      await first.locator('.move-zone .card').nth(1).tap();
      await first.waitForFunction((order) => {
        const items = partyTable.state.dialogs.find((dialog) => dialog.zones.length >= 2)?.zones[0]
          .items;
        return items?.[0]?.key === order[1] && items?.[1]?.key === order[0];
      }, order);
      await first.locator('.move-zone .card').first().tap();
      await first.locator('.move-zone .card.selected').waitFor();
      await first.locator('.move-zone').nth(1).locator('.move-destination').tap();
      await first.waitForFunction(() =>
        partyTable.state.dialogs.some((dialog) => dialog.zones[1]?.items.length === 1),
      );
      assert.equal(
        await first.evaluate(
          () =>
            partyTable.state.dialogs.flatMap((dialog) => dialog.zones.flatMap((zone) => zone.items))
              .length,
        ),
        total,
      );
      await first
        .locator('#controls button')
        .filter({ hasText: /^确定$/ })
        .tap();
      await first.waitForFunction(
        () => !partyTable.state.dialogs.some((dialog) => dialog.zones.length >= 2),
      );
      console.log('真实观星选牌、交换顺序、移区与确认通过');
    }
    if (process.env.LIGHT_VERIFY_TARGETED === '1') {
      const first = frame(phones[0]);
      await first.waitForFunction(
        () => partyTable.state.choosing && partyTable.state.prompt.includes('洛神'),
      );
      const before = await worker.evaluate(
        () => partyEngine.game.getGlobalHistory('cardMove').length,
      );
      // Targeted fixture adds public test cards without modifying deck order,
      // card rules, damage, AI decisions or the winner.
      await worker.evaluate(
        ({ id, before }) => {
          const { game, lib } = partyEngine;
          const player = lib.playerOL[id];
          const cards = [
            game.createCard('bagua', 'club', 2),
            game.createCard('wuzhong', 'heart', 7),
            game.createCard('tao', 'heart', 3),
            game.createCard('sha', 'spade', 7),
          ];
          player.hp = Math.max(1, player.maxHp - 1);
          player.update();
          player.directgain(cards);
          partyEngine.confirmProbe = { used: 0, before };
          const useCard = player.useCard;
          player.useCard = function (...args) {
            partyEngine.confirmProbe.used++;
            return useCard.apply(this, args);
          };
        },
        { id: joined.playerId, before },
      );
      const mirror = desktop
        .frames()
        .find(
          (frame) =>
            frame.url().includes('/engine/view/') &&
            new URL(frame.url()).searchParams.get('seat') === joined.playerId,
        );
      await mirror.waitForFunction(() =>
        partyEngine.game.me.getCards('h').some((card) => card.name === 'bagua'),
      );
      await first
        .locator('#controls button')
        .filter({ hasText: /^不发动$/ })
        .tap();
      await first.waitForFunction(
        () => partyTable.state.phase === 'chooseToUse' && partyTable.state.choosing,
      );
      for (const name of ['八卦阵', '无中生有', '桃']) {
        await first
          .locator('#hand .table-item.selectable')
          .filter({ hasText: name })
          .last()
          .waitFor();
        const used = await worker.evaluate(() => partyEngine.confirmProbe.used);
        await first.locator('#hand .table-item').filter({ hasText: name }).last().tap();
        await first.locator('#hand .table-item.selected').filter({ hasText: name }).waitFor();
        assert.equal(
          await worker.evaluate(() => partyEngine.confirmProbe.used),
          used,
          'selection must not use the card',
        );
        await first
          .locator('#controls button')
          .filter({ hasText: /^使用$/ })
          .tap();
        await worker.waitForFunction((used) => partyEngine.confirmProbe.used > used, used);
        await first.waitForFunction(
          () => partyTable.state.phase === 'chooseToUse' && partyTable.state.choosing,
        );
      }
      const used = await worker.evaluate(() => partyEngine.confirmProbe.used);
      await first.locator('#hand .table-item.selectable').filter({ hasText: '杀' }).last().tap();
      await first.locator('#hand .table-item.selected').waitFor();
      assert.equal(await worker.evaluate(() => partyEngine.confirmProbe.used), used);
      await first.locator('#opponents .selectable-seat .player-face').first().tap();
      await first.locator('#opponents .selected-seat').waitFor();
      assert.equal(
        await worker.evaluate(() => partyEngine.confirmProbe.used),
        used,
        'choosing a target must not submit',
      );
      await first
        .locator('#controls button')
        .filter({ hasText: /^使用$/ })
        .tap();
      await worker.waitForFunction((used) => partyEngine.confirmProbe.used > used, used);
      console.log('洛神取消、装备/锦囊/基本牌与目标先选后确认通过');
    }
    if (process.env.LIGHT_VERIFY_PRIVATE)
      await verifyPrivateChoices({
        kind: process.env.LIGHT_VERIFY_PRIVATE,
        desktop,
        worker,
        phones,
        playerId: joined.playerId,
        output,
      });
    // Refresh must preserve the native seat, hand and pending selection.
    const id = await frame(phones[0]).evaluate(() => partyTable.state.playerId);
    await phones[0].reload();
    await phones[0].waitForFunction(
      () =>
        document.querySelector('#game-frame')?.contentWindow?.partyTable?.state?.hand.length > 0,
      null,
      { timeout: 60000 },
    );
    assert.equal(await frame(phones[0]).evaluate(() => partyTable.state.playerId), id);
    for (const phone of phones)
      await frame(phone).evaluate(() => {
        const seen = new Set((partyTable.state.events ?? []).map((event) => event.id));
        window.partyMotionProbe = { kinds: {}, played: 0, last: '' };
        setInterval(() => {
          for (const event of partyTable.state.events ?? []) {
            if (seen.has(event.id)) continue;
            seen.add(event.id);
            partyMotionProbe.kinds[event.kind] = (partyMotionProbe.kinds[event.kind] ?? 0) + 1;
          }
          const last = document.querySelector('#table').dataset.presentationId;
          if (last && last !== partyMotionProbe.last) {
            partyMotionProbe.last = last;
            partyMotionProbe.played++;
          }
        }, 30);
      });
    await worker.evaluate(() => {
      partyEngine.lib.config.game_speed = 'vvfast';
      partyEngine.lib.config.duration = 10;
    });
    for (const mirror of desktop.frames().filter((frame) => frame.url().includes('/engine/view/')))
      await mirror.evaluate(() => {
        partyEngine.lib.config.game_speed = 'vvfast';
        partyEngine.lib.config.duration = 100;
      });
    for (const phone of phones) {
      await frame(phone).locator('#auto-button').tap();
      await frame(phone).waitForFunction(() => partyTable.state.auto);
    }
    await phones[0].waitForFunction(
      () => !document.querySelector('#rematch-button')?.hidden,
      null,
      { timeout: 180000 },
    );
    for (const phone of phones) await frame(phone).locator('#return-room').waitFor();
    console.log(`${mode}: 首局原生自然结算完成`);
    const presentation = await Promise.all(
      phones.map((phone) => frame(phone).evaluate(() => partyMotionProbe)),
    );
    assert(
      presentation.every(
        (proof) =>
          proof.kinds.use > 0 && proof.kinds.draw > 0 && proof.kinds.turn > 0 && proof.played > 0,
      ),
      'real native actions must reach and animate on each phone',
    );
    for (const phone of phones.slice(1)) {
      await frame(phone).locator('#return-room').tap();
      await phone.locator('#waiting-return:not([hidden])').waitFor();
    }
    await frame(phones[0]).locator('#return-room').tap();
    for (const phone of phones) await phone.locator('#ready-button:not([hidden])').waitFor();
    if (mode === 'duel') {
      for (const phone of phones)
        await request(phone, `/api/rooms/${code}/me/ready`, 'PUT', { ready: true });
      const nextStart = startRoom(phones[0], code);
      void nextStart.catch(() => {});
      await Promise.all(phones.map(choose));
      await nextStart;
      const nextWorker = desktop.frames().find((frame) => frame.url().includes('/engine/worker/'));
      await nextWorker.evaluate(() => {
        partyEngine.lib.config.game_speed = 'vvfast';
        partyEngine.lib.config.duration = 10;
      });
      for (const mirror of desktop
        .frames()
        .filter((frame) => frame.url().includes('/engine/view/')))
        await mirror.evaluate(() => {
          partyEngine.lib.config.game_speed = 'vvfast';
          partyEngine.lib.config.duration = 100;
        });
      for (const phone of phones) await frame(phone).locator('#auto-button').tap();
      await phones[0].waitForFunction(
        () => !document.querySelector('#rematch-button')?.hidden,
        null,
        { timeout: 180000 },
      );
      await frame(phones[0]).locator('#return-room').tap();
      for (const phone of phones) await phone.locator('#ready-button:not([hidden])').waitFor();
    }
    for (const phone of phones) {
      await request(phone, `/api/rooms/${code}/me`, 'DELETE');
      await phone.close();
    }
    results.push({
      mode,
      seats: count,
      selectedAndDealt: true,
      refresh: true,
      nativeSettlement: true,
      bothReturn: true,
      noPhoneEngine: true,
      presentation,
    });
    console.log(`${mode}: 重连、自然结算、双方回房通过`);
  }
  assert.deepEqual(
    await desktop.evaluate(() => window.partyViewFaults),
    [],
    'computer seat mirrors must not recover from hidden runtime errors',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  const js = await stat(`${root}/dist/web/table.js`),
    css = await stat(`${root}/dist/web/table.css`);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        results,
        targeted: process.env.LIGHT_VERIFY_TARGETED === '1',
        move: process.env.LIGHT_VERIFY_MOVE === '1',
        god: process.env.LIGHT_VERIFY_GOD === '1',
        privateChoice: process.env.LIGHT_VERIFY_PRIVATE || '',
        advanced: process.env.LIGHT_VERIFY_ADVANCED === '1',
        mirrorFaults: [],
        transport:
          process.env.LIGHT_VERIFY_HTTP === '1'
            ? 'http'
            : gateway
              ? 'public-stream'
              : 'lan-websocket',
        clientBytes: js.size + css.size,
        errors,
        missing,
      },
      null,
      2,
    ),
  );
  console.log(`验证通过：${output}`);
} catch (error) {
  const diagnostic = [];
  for (const context of contexts)
    for (const page of context.pages())
      for (const frame of page.frames())
        if (/\/engine\/(worker|view|table)\//.test(frame.url()))
          diagnostic.push(
            await frame
              .evaluate(() => ({
                surface: location.pathname.split('/')[2],
                event: globalThis.partyEngine?._status?.event?.name,
                paused: globalThis.partyEngine?._status?.paused,
                socket: globalThis.partyEngine?.game?.ws?.readyState,
                booted: globalThis.partyEngine?.proof?.booted,
                started: globalThis.partyEngine?.proof?.started,
                mode: globalThis.partyEngine?.lib?.config?.mode,
                prefix: globalThis.partyEngine?.lib?.configprefix,
                waiting: globalThis.partyEngine?._status?.waitingForPlayer,
                nativeClients: globalThis.partyEngine?.lib?.node?.clients?.length,
                online: globalThis.partyEngine?.game?.online,
                localErrors: globalThis.partyEngine?.proof?.errors?.length,
                localError: globalThis.partyEngine?.proof?.errors?.[0]?.slice(0, 3000),
                moving: globalThis.partyEngine?._status?.event?.isPlayingAnimation,
                moveSelection: globalThis.partyEngine?.ui?.selected?.guanxing_buttons?.length,
                moveAnimation: globalThis.partyEngine?.lib?.config?.animation_choose_to_move,
                touchscreen: globalThis.partyEngine?.lib?.config?.touchscreen,
                eventStep: globalThis.partyEngine?._status?.event?.step,
                startFunction: typeof globalThis.partyEngine?.lib?.init?.start,
                tablePhase: globalThis.partyTable?.state?.phase,
                dialogs: globalThis.partyTable?.state?.dialogs?.length,
                loading: document.querySelector('#loading-status')?.textContent,
              }))
              .catch(() => ({})),
          );
  for (let i = 0; i < contexts.length; i++)
    for (const page of contexts[i].pages())
      await page.screenshot({ path: `${output}/failure-${i}.png` }).catch(() => {});
  const faults = await contexts[0]
    ?.pages()[0]
    ?.evaluate(() => window.partyViewFaults)
    .catch(() => []);
  console.error('轻量验证失败：', error.stack, { errors, missing, diagnostic, faults });
  process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  gateway?.close();
  engine.close();
  party.closeStreams();
  party.server.closeAllConnections();
  await new Promise((resolve) => party.server.close(resolve));
}
