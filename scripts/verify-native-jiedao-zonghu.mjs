import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

// Isolated known-material tests, after actual native selection and dealing.
// Never attach to or change a running party; synthetic touch is not phone QA.
const root = fileURLToPath(new URL('../', import.meta.url));
const adapter = new NativeNonameService(root);
const failures = [];
adapter.subscribe((event) => {
  if (event.type === 'failed') failures.push(event);
});
const party = createPartyServer({ webRoot: `${root}/dist/web`, port: 0, adapter });
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const desktop = process.env.ENGINE_VERIFY_DESKTOP === '1';
const http = process.env.ENGINE_VERIFY_HTTP === '1';
const gesture = desktop ? 'click' : 'tap';
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const output = `.runtime/native-jiedao-zonghu/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
await mkdir(output, { recursive: true });
console.log(output);
const contexts = [],
  phones = [],
  frames = [],
  faults = [],
  missing = new Set(),
  results = [];
let worker, computer;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function page(phone = false) {
  const context = await browser.newContext(
    phone ? { viewport: { width: 844, height: 390 }, isMobile: !desktop, hasTouch: !desktop } : {},
  );
  contexts.push(context);
  if (phone && http)
    await context.addInitScript(() => sessionStorage.setItem('party_http_transport', '1'));
  if (!phone)
    await context.route('**/engine/runtime/mode.js', async (route) => {
      const response = await route.fetch(),
        source = await response.text();
      assert(source.includes('const seats = setup.seats.slice().randomSort();'));
      assert(source.includes('await game.phaseLoop(first);'));
      await route.fulfill({
        response,
        body: source
          .replace(
            'const seats = setup.seats.slice().randomSort();',
            'const seats = setup.seats.slice();',
          )
          .replace('await game.phaseLoop(first);', 'await game.pause();'),
      });
    });
  const value = await context.newPage();
  const poll = (target) => {
    const original = target.waitForFunction.bind(target);
    target.waitForFunction = (fn, arg, options) => original(fn, arg, { polling: 100, ...options });
  };
  poll(value);
  value.on('frameattached', poll);
  value.on('pageerror', (error) => faults.push(error.message));
  value.on('response', (response) => {
    if (response.status() >= 400) missing.add(new URL(response.url()).pathname);
  });
  return value;
}
async function request(phone, path, method, body) {
  return phone.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`${response.status}: ${path}`);
      return response.json();
    },
    { path, method, body },
  );
}
async function table(phone) {
  await phone.waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
  );
  const frame = phone.frames().find((item) => item.url().includes('/engine/player/'));
  await frame.waitForFunction(
    () =>
      partyEngine.game.online &&
      partyEngine.game.me?.name &&
      partyEngine.game.me.playerid === partyEngine.game.onlineID,
  );
  return frame;
}
const control = (frame, text) =>
  frame
    .locator('.control:not(.removing) > div')
    .filter({ hasText: new RegExp(`^${text}$`) })
    .first();
async function choice(index, name, skill) {
  await frames[index].waitForFunction(
    ({ name, skill }) =>
      partyEngine._status.event.name === name &&
      partyEngine._status.paused &&
      (!skill || partyEngine._status.event.skill === skill),
    { name, skill },
  );
}
async function renew(index, name, skill) {
  const id = await frames[index].evaluate(() => partyEngine.game.me.playerid);
  const before = await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id);
  assert.equal(typeof before, 'number');
  await phones[index].reload();
  frames[index] = await table(phones[index]);
  await choice(index, name, skill);
  assert.equal(
    await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id),
    before,
    'refresh preserves original deadline',
  );
}
async function target(index, id) {
  await frames[index].evaluate((id) => (partyEngine.lib.playerOL[id].dataset.probeTarget = id), id);
  await frames[index].locator(`[data-probe-target="${id}"].selectable`).first()[gesture]();
}
async function material(index, id) {
  await frames[index].waitForFunction(
    (id) => partyEngine.lib.cardOL[id]?.classList.contains('selectable'),
    id,
  );
  await frames[index].evaluate((id) => (partyEngine.lib.cardOL[id].dataset.probeMaterial = id), id);
  const node = frames[index].locator(`[data-probe-material="${id}"].selectable`).first();
  const equip = await node.evaluate((node) => node.parentElement.classList.contains('equips'));
  // Equipment is a scaled short row; the hand-card corner can fall outside it.
  await node[gesture](equip ? {} : { position: { x: 8, y: 15 } });
  if (equip && (await frames[index].locator('.poplayer').isVisible())) {
    await frames[index].waitForFunction(() => !partyEngine._status.touchpopping);
    await frames[index].locator('.poplayer')[gesture]({ position: { x: 400, y: 90 } });
    await frames[index].locator('.poplayer').waitFor({ state: 'hidden' });
  }
  await frames[index].waitForFunction(
    (id) => partyEngine.ui.selected.cards.some((card) => card.cardid === id),
    id,
  );
}
async function finish({ drain = false } = {}) {
  for (let count = 0; count < 200; count++) {
    const state = await worker.evaluate(() => ({
      done: partyInteractionProbe.done,
      error: partyInteractionProbe.error,
    }));
    assert.equal(state.error, undefined);
    if (state.done) return;
    if (drain)
      for (const frame of frames) {
        const name = await frame.evaluate(() => partyEngine._status.event.name);
        if (['chooseToUse', 'chooseToRespond', 'chooseBool'].includes(name)) {
          const cancel = control(frame, '取消');
          if (await cancel.isVisible()) await cancel[gesture]();
        }
      }
    await wait(100);
  }
  throw new Error('Native interaction fixture did not finish');
}
async function stage(kind, round = 1) {
  console.log(kind, round);
  await worker.evaluate(
    ({ kind, round }) => {
      const { game, lib, _status } = partyEngine,
        probe = partyInteractionProbe;
      probe.done = false;
      probe.error = undefined;
      const event = new lib.element.GameEvent(
        'partyInteractionFixture',
        false,
        _status.eventManager,
      );
      event.player = game.players[0];
      event.kind = kind;
      event.round = round;
      event.setContent(async function (event) {
        const { game, ui, _status } = partyEngine,
          probe = partyInteractionProbe;
        const [jushou, liuzhang, other] = game.players;
        if (event.kind.endsWith('setup')) {
          for (const player of game.players) {
            player.stat.push({ card: {}, skill: {}, triggerSkill: {} });
            player.removeSkill('olzonghu_used');
            if (player.countCards('hejx'))
              await player.lose(player.getCards('hejx'), ui.discardPile);
            player.hp = player.maxHp;
            player.hujia = 0;
            player.update();
          }
          game.roundNumber = event.round;
          game.updateRoundNumber();
          if (event.kind === 'jiedao-setup') {
            jushou.directgain([probe.cards.jiedao]);
            liuzhang.directgain([probe.cards.sha]);
            await liuzhang.equip(probe.cards.weapon);
          } else {
            liuzhang.directgain([
              probe.cards.cost1,
              probe.cards.cost2,
              probe.cards.cost3,
              probe.cards.hidden,
            ]);
            if (event.kind === 'zonghu-equip-setup') await liuzhang.equip(probe.cards.costEquip);
          }
          return;
        }
        _status.currentPhase =
          event.kind === 'zonghu-shan'
            ? jushou
            : event.kind.startsWith('jiedao')
              ? jushou
              : liuzhang;
        probe.beforeUses = liuzhang.getAllHistory('useCard').length;
        if (event.kind === 'jiedao') await jushou.chooseToUse().set('type', 'phase');
        if (event.kind === 'zonghu-sha') await liuzhang.chooseToUse().set('type', 'phase');
        if (event.kind === 'zonghu-shan')
          await jushou.useCard({ name: 'sha', isCard: true }, liuzhang, false);
        probe.afterUses = liuzhang.getAllHistory('useCard').length;
        probe.last = liuzhang.getAllHistory('useCard').at(-1);
        probe.lastJiedao = jushou
          .getAllHistory('useCard')
          .filter((entry) => entry.card.name === 'jiedao')
          .at(-1);
      });
      _status.eventManager.rootEvent = event;
      void event.start().then(
        () => {
          probe.done = true;
        },
        (error) => {
          probe.error = error.message;
        },
      );
    },
    { kind, round },
  );
}
async function snapshot(label) {
  const views = await Promise.all(
    frames.map((frame) =>
      frame.evaluate(() => {
        const { game, get, ui, _status, lib } = partyEngine,
          event = _status.event;
        return {
          event: event.name,
          skill: event.skill,
          backupevent: event._backupevent,
          paused: _status.paused,
          round: game.roundNumber,
          prompt: event.openskilldialog,
          dialog: event.dialog?.textContent,
          controls: [...document.querySelectorAll('.control:not(.removing) > div')].map(
            (node) => node.textContent,
          ),
          selectedTargets: ui.selected.targets.map((p) => p.playerid),
          targets: game.players.map((p) => ({
            id: p.playerid,
            name: p.name,
            weapons: p.getEquips(1).length,
            selectable: p.classList.contains('selectable'),
          })),
          viewAs: lib.skill[event.skill]?.viewAs,
          norestore: event.norestore,
          selectCard:
            typeof event.selectCard === 'function'
              ? get.select(event.selectCard)
              : event.selectCard,
        };
      }),
    ),
  );
  await writeFile(
    `${output}/${label}.json`,
    JSON.stringify({ views, faults, missing: [...missing] }, null, 2),
  );
  return views;
}
try {
  computer = await page();
  await computer.goto(`${base}/server`);
  await computer.waitForFunction(
    async () => (await (await fetch('/api/info')).json()).engine.ready,
  );
  for (let index = 0; index < 3; index++) phones.push(await page(true));
  await phones[0].goto(base);
  const created = await request(phones[0], '/api/rooms', 'POST', { nickname: '借刀宗护验证' }),
    code = created.room.code;
  await phones[0].goto(`${base}/join/${code}`);
  await request(phones[0], `/api/rooms/${code}`, 'PUT', {
    mode: 'doudizhu',
    playerCount: 3,
    generalPreset: 'ol-ranked-2026-10-basic',
    allowGeneralSelection: true,
    extensions: [],
  });
  for (let index = 1; index < 3; index++) {
    await phones[index].goto(`${base}/join/${code}`);
    await phones[index].locator('#nickname').fill(`技能验证${index}`);
    await phones[index].locator('#join-button')[gesture]();
  }
  const generals = ['yj_jushou', 'ol_liuzhang', 'caocao'];
  for (const [index, general] of generals.entries())
    await request(phones[index], `/api/rooms/${code}/me/general`, 'PUT', { general });
  for (const phone of phones) await phone.locator('#ready-button')[gesture]();
  await phones[0].locator('#start-button')[gesture]();
  const matchId = party.lobby.get(code).snapshot().matchId;
  await Promise.all(
    phones.map(async (phone, index) => {
      await phone.waitForFunction(
        () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
      );
      frames[index] = phone.frames().find((frame) => frame.url().includes('/engine/player/'));
    }),
  );
  worker = computer.frames().find((frame) => frame.url().includes(`/engine/worker/${matchId}`));
  assert(worker);
  await Promise.all(frames.map((frame) => chooseGeneral(frame, worker, { mouse: desktop })));
  await worker.waitForFunction(() => partyEngine.proof.started && partyEngine._status.paused);
  assert.deepEqual(
    await worker.evaluate(() => partyEngine.game.players.map((p) => p.name)),
    generals,
  );
  const ids = await worker.evaluate(() => {
    const { game, lib, _status } = partyEngine;
    for (const timer of Object.values(lib.node.torespondtimeout)) clearTimeout(timer);
    lib.node.torespond = {};
    lib.node.torespondtimeout = {};
    _status.eventManager = new _status.eventManager.constructor();
    _status.eventManager.rootEvent = lib.element.GameEvent.initialGameEvent();
    _status.pauseManager = new _status.pauseManager.constructor();
    lib.config.duration = 100;
    const cards = {
      jiedao: game.createCard('jiedao', 'club', 12),
      weapon: game.createCard('qinggang', 'spade', 6),
      sha: game.createCard('sha', 'spade', 9),
      cost1: game.createCard('tao', 'heart', 4),
      cost2: game.createCard('jiu', 'spade', 3),
      cost3: game.createCard('guohe', 'club', 10),
      costEquip: game.createCard('zhuge', 'club', 1),
      hidden: game.createCard('wuxie', 'club', 6),
    };
    globalThis.partyInteractionProbe = { cards, done: true };
    return {
      players: game.players.map((p) => p.playerid),
      cards: Object.fromEntries(Object.entries(cards).map(([key, card]) => [key, card.cardid])),
    };
  });
  for (const [index, phone] of phones.entries()) {
    await phone.reload();
    frames[index] = await table(phone);
  }
  if (process.env.ENGINE_VERIFY_ZONGHU_ONLY !== '1') {
    for (const branch of ['sha', 'refuse']) {
      await stage('jiedao-setup');
      await finish();
      await stage('jiedao');
      await choice(0, 'chooseToUse');
      await material(0, ids.cards.jiedao);
      const first = await snapshot(`jiedao-${branch}-first`);
      assert.deepEqual(
        first[0].targets.filter((p) => p.selectable).map((p) => p.id),
        [ids.players[1]],
        'only armed first target is selectable',
      );
      await target(0, ids.players[1]);
      const second = await snapshot(`jiedao-${branch}-second`);
      assert(
        second[0].targets.find((p) => p.id === ids.players[2]).selectable,
        'unarmed second target is legal',
      );
      await target(0, ids.players[2]);
      await target(0, ids.players[2]);
      assert.deepEqual(
        await frames[0].evaluate(() => partyEngine.ui.selected.targets.map((p) => p.playerid)),
        [ids.players[1]],
        'deselecting only the second target preserves the armed first target',
      );
      await target(0, ids.players[2]);
      await target(0, ids.players[1]);
      const removed = await snapshot(`jiedao-${branch}-remove-first`);
      assert.deepEqual(
        removed[0].selectedTargets,
        [],
        'deselecting the first target clears its dependent second target',
      );
      await target(0, ids.players[1]);
      await target(0, ids.players[2]);
      await control(frames[0], '确定')[gesture]();
      await choice(1, 'chooseToUse');
      if (branch === 'refuse') await control(frames[1], '取消')[gesture]();
      else {
        await material(1, ids.cards.sha);
        const targets = await frames[1].evaluate(() =>
          partyEngine.ui.selected.targets.map((p) => p.playerid),
        );
        if (!targets.includes(ids.players[2])) await target(1, ids.players[2]);
        await control(frames[1], '确定')[gesture]();
      }
      await finish({ drain: true });
      assert.equal(
        await worker.evaluate(() =>
          partyEngine.game.players[0].getCards('h').includes(partyInteractionProbe.cards.weapon),
        ),
        branch === 'refuse',
        'only native refusal gives weapon to caster',
      );
      results.push({
        card: 'jiedao',
        branch,
        armedFirstTargetOnly: true,
        unarmedSecondTargetLegal: true,
        nativeEffect: true,
      });
    }
  }

  for (const round of [1, 2, 3, 4])
    for (const branch of ['sha', 'shan']) {
      const count = Math.min(3, round);
      const costs = ['cost1', 'cost2', 'cost3'].slice(0, count).map((key) => ids.cards[key]);
      if (round === 4) costs[2] = ids.cards.costEquip;
      await stage(round === 4 ? 'zonghu-equip-setup' : 'zonghu-setup', round);
      await finish();
      await stage(`zonghu-${branch}`, round);
      await choice(1, 'chooseToUse');
      await renew(1, 'chooseToUse');
      await snapshot(`zonghu-${round}-${branch}-start`);
      await control(frames[1], '宗护')[gesture]();
      await choice(1, 'chooseToUse', 'olzonghu_backup');
      await renew(1, 'chooseToUse', 'olzonghu_backup');
      const costView = await snapshot(`zonghu-${round}-${branch}-cost`);
      assert.equal(costView[1].round, round);
      assert.deepEqual(costView[1].selectCard, [count, count]);
      if (round === 1 && branch === 'sha') {
        // Recreate an old phone's zero-round UI and submit its actual empty
        // material result. The worker must reject it and restore the SAME wait.
        const before = await worker.evaluate(
          (id) => partyEngine.lib.node.torespondtimeout[id],
          ids.players[1],
        );
        await frames[1].evaluate(() => {
          partyEngine.game.roundNumber = 0;
          partyEngine.game.check();
        });
        await target(1, ids.players[2]);
        await control(frames[1], '确定')[gesture]();
        await frames[1].waitForFunction(
          () =>
            partyEngine._status.paused &&
            partyEngine.game.roundNumber === 1 &&
            partyEngine._status.event.skill === 'olzonghu_backup' &&
            partyEngine.ui.selected.targets.length === 0,
        );
        assert.deepEqual(
          await worker.evaluate(
            (id) => ({
              deadline: partyEngine.lib.node.torespondtimeout[id],
              used: partyEngine.lib.playerOL[id].hasSkill('olzonghu_used'),
              given: partyEngine.game.players[2].countCards('h'),
            }),
            ids.players[1],
          ),
          { deadline: before, used: false, given: 0 },
        );
        results.push({ skill: 'olzonghu', zeroCostRejected: true, sameOriginalDeadline: true });
      }
      for (const id of costs) await material(1, id);
      await target(1, ids.players[2]);
      await control(frames[1], '确定')[gesture]();
      await choice(1, 'chooseToUse', 'olzonghu_backup2');
      await renew(1, 'chooseToUse', 'olzonghu_backup2');
      const use = await snapshot(`zonghu-${round}-${branch}-use`);
      assert.equal(use[1].viewAs?.name, branch);
      for (const index of [0, 1, 2])
        assert.equal(
          await frames[index].evaluate((id) => partyEngine.lib.cardOL[id]?.name, ids.cards.hidden),
          index === 1 ? 'wuxie' : 'party_unknown',
          'unspent hand stays private',
        );
      for (const id of costs)
        for (const index of [0, 1, 2])
          assert.equal(
            await frames[index].evaluate(
              (id) => partyEngine.lib.cardOL[id]?.name === 'party_unknown',
              id,
            ),
            index === 0 && id !== ids.cards.costEquip,
            'private hand gift stays hidden; previously public equipment remains known',
          );
      if (branch === 'sha') await target(1, ids.players[0]);
      await control(frames[1], '确定')[gesture]();
      await finish({ drain: true });
      assert.equal(await worker.evaluate(() => partyInteractionProbe.last?.card.name), branch);
      assert.deepEqual(
        await worker.evaluate(() => ({
          recipient: partyEngine.game.players[2]
            .getCards('h')
            .map((card) => card.cardid)
            .sort(),
          used: partyEngine.game.players[1].hasSkill('olzonghu_used'),
          targets: partyInteractionProbe.last.targets.map((p) => p.playerid),
        })),
        {
          recipient: costs.slice().sort(),
          used: true,
          targets: branch === 'sha' ? [ids.players[0]] : [],
        },
      );
      results.push({
        skill: 'olzonghu',
        branch,
        round,
        paidCards: count,
        nativeEffect: true,
        privateGift: true,
        bothStagesRecovered: true,
      });
    }
  assert.deepEqual(failures, []);
  assert.deepEqual(faults, []);
  assert.deepEqual([...missing], []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        fixture: true,
        physicalPhone: false,
        http,
        input: desktop ? 'mouse' : 'touch',
        results,
        failures,
        faults,
        missing: [...missing],
      },
      null,
      2,
    ),
  );
  console.log('Passed', output);
} catch (error) {
  await snapshot('failure').catch(() => {});
  for (const [index, phone] of phones.entries())
    await phone.screenshot({ path: `${output}/failure-${index}.png` }).catch(() => {});
  await writeFile(
    `${output}/error.json`,
    JSON.stringify(
      { message: error.message, stack: error.stack, failures, faults, missing: [...missing] },
      null,
      2,
    ),
  );
  throw error;
} finally {
  adapter.close();
  for (const context of contexts) await context.close();
  await browser.close();
  party.closeStreams();
  party.server.closeAllConnections();
  await new Promise((resolve) => party.server.close(resolve));
}
