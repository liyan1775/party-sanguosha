import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

// Dedicated, isolated rule fixtures. These deliberately supply cards and
// judgment tops; they are not evidence of an untouched game's natural result.
const root = fileURLToPath(new URL('../', import.meta.url));
const party = createPartyServer({
  webRoot: `${root}/dist/web`,
  port: 0,
  adapter: new NativeNonameService(root),
});
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge' });
const contexts = [],
  faults = [],
  missing = new Set();
const output = `.runtime/native-military/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
await mkdir(output, { recursive: true });
async function page(mobile = false) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } : {},
  );
  contexts.push(context);
  context.on('page', (page) => {
    page.on('pageerror', (error) => faults.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) missing.add(new URL(response.url()).pathname);
    });
  });
  if (!mobile)
    await context.route('**/engine/runtime/mode.js', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      assert(source.includes('pool.randomRemove(choiceCount)'));
      await route.fulfill({
        response,
        body: source
          .replace(
            'const seats = setup.seats.slice().randomSort();',
            'const seats = setup.seats.slice();',
          )
          .replace(
            /const candidates = preference\s*\? \[preference, \.\.\.shared\.filter\(\(name\) => name !== preference\)\]\s*:\s*shared\.slice\(\);/,
            "const candidates = [['re_guohuai', 'yanyan'], ['caoren', 're_huaxiong'], ['re_huaxiong', 'caoren'], ['yanyan', 're_guohuai']][game.players.indexOf(player)];",
          ),
      });
    });
  return context.newPage();
}
const frames = [];
let worker;
async function waitStage() {
  for (let i = 0; i < 150; i++) {
    const state = await worker.evaluate(() => ({
      done: partyMilitary.done,
      error: partyMilitary.error,
    }));
    assert.equal(state.error, undefined);
    if (state.done) return;
    for (const frame of frames) {
      if (
        await frame.evaluate(() =>
          ['chooseToRespond', 'chooseToUse', 'chooseBool'].includes(
            partyEngine._status.event?.name,
          ),
        )
      ) {
        const cancel = frame
          .locator('.control:not(.removing) > div')
          .filter({ hasText: /^取消$/ })
          .first();
        if (await cancel.isVisible()) await cancel.tap();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const state = await worker.evaluate(() => ({
    kind: partyMilitary.kind,
    event: partyEngine._status.event?.name,
    paused: partyEngine._status.paused,
    result: partyMilitary.result,
    errors: partyEngine.proof.errors,
  }));
  console.log('Fixture progress', state);
  console.log(
    'Phone events',
    await Promise.all(
      frames.map((frame) =>
        frame.evaluate(() => ({
          event: partyEngine._status.event?.name,
          controls: [...document.querySelectorAll('.control:not(.removing)')].map(
            (node) => node.textContent,
          ),
        })),
      ),
    ),
  );
  throw new Error('Native military fixture did not finish');
}
async function stage(kind) {
  await worker.evaluate((kind) => {
    const { game, lib, ui, _status } = partyEngine;
    const probe = globalThis.partyMilitary;
    const { actor, target, third, own } = probe;
    probe.done = false;
    probe.kind = kind;
    const event = new lib.element.GameEvent('partyMilitaryFixture', false, _status.eventManager);
    event.player = actor;
    event.kind = kind;
    event.setContent(async function (event) {
      const { game, lib, ui, get } = partyEngine;
      const { actor, target, third, own, result } = partyMilitary;
      const restore = async (player) => {
        if (player.hp < player.maxHp) await player.recover(player.maxHp - player.hp);
      };
      if (event.kind === 'setup') {
        for (const player of game.players) {
          if (player.countCards('hej')) await player.lose(player.getCards('hej'), ui.discardPile);
          await restore(player);
        }
        actor.directgain(Object.values(own));
        target.directgain(partyMilitary.enemy);
      } else if (event.kind === 'fire') {
        result.fireBefore = target.hp;
        await actor.useCard(own.huogong, target);
        result.fireDamage = result.fireBefore - target.hp;
      } else if (event.kind === 'wine') {
        await target.lose(target.getCards('h'), ui.discardPile);
        await restore(target);
        await actor.useCard(own.jiu, actor);
        const before = target.hp;
        await actor.useCard(own.sha, target);
        result.wineDamage = before - target.hp;
        result.wineConsumed = !actor.storage.jiu;
      } else if (event.kind === 'chain') {
        await restore(target);
        await restore(third);
        await actor.useCard(own.tiesuo, [target, third]);
        result.linked = target.isLinked() && third.isLinked();
        const before = [target.hp, third.hp];
        await target.damage(1, actor, 'thunder');
        result.chainDamage = [before[0] - target.hp, before[1] - third.hp];
        result.unlinked = !target.isLinked() && !third.isLinked();
      } else if (event.kind === 'recast') {
        const before = actor.countCards('h');
        await actor.recast(own.recast);
        result.recastDraw = actor.countCards('h') === before && get.position(own.recast) === 'd';
      } else if (event.kind === 'armor') {
        await restore(target);
        await target.equip(game.createCard('tengjia', 'spade', 2));
        const before = target.hp;
        await actor.useCard(game.createCard('sha', 'spade', 7), target);
        result.vineBlocksNormal = before === target.hp;
        await target.damage(1, actor, 'fire');
        result.vineFireDamage = before - target.hp;
        await restore(target);
        await target.equip(game.createCard('baiyin', 'club', 1));
        const silverBefore = target.hp;
        await target.damage(3, actor, 'thunder');
        result.silverDamage = silverBefore - target.hp;
        await target.lose(target.getCards('e'), ui.discardPile);
        result.silverRemovalHeals = target.hp === silverBefore;
      } else if (event.kind === 'judgment') {
        for (const suit of ['heart', 'club']) {
          target.skipList.remove('phaseDraw');
          await actor.useCard(game.createCard('bingliang', 'spade', 10), target);
          ui.cardPile.insertBefore(game.createCard('shan', suit, 2), ui.cardPile.firstChild);
          await target.phaseJudge();
          result[suit === 'heart' ? 'supplySkipsDraw' : 'clubKeepsDraw'] =
            suit === 'heart'
              ? target.skipList.includes('phaseDraw')
              : !target.skipList.includes('phaseDraw');
        }
      }
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
  }, kind);
}
async function card(frame, id) {
  await frame.waitForFunction(
    (id) => [...document.querySelectorAll('.card.selectable')].some((node) => node.cardid === id),
    id,
  );
  await frame.evaluate((id) => {
    for (const node of document.querySelectorAll('.card'))
      if (node.cardid === id) node.dataset.militaryCard = id;
  }, id);
  await frame
    .locator(`[data-military-card="${id}"].selectable`)
    .first()
    .tap({ position: { x: 8, y: 15 } });
  await frame
    .locator('.control:not(.removing) > div')
    .filter({ hasText: /^确定$/ })
    .first()
    .tap();
}
try {
  const computer = await page();
  await computer.goto(base + '/server');
  await computer.waitForFunction(
    async () => (await (await fetch('/api/info')).json()).engine.ready,
  );
  const phones = [await page(true), await page(true)];
  await phones[0].goto(base);
  const created = await phones[0].evaluate(
    async () =>
      await (
        await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: '军争规则夹具' }),
        })
      ).json(),
  );
  const code = created.room.code;
  await phones[0].goto(`${base}/join/${code}`);
  await phones[0].evaluate(async (code) => {
    await fetch(`/api/rooms/${code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'versus',
        playerCount: 4,
        generalPreset: 'advanced',
        extensions: [],
      }),
    });
  }, code);
  await phones[1].goto(`${base}/join/${code}`);
  await phones[1].locator('#nickname').fill('火攻目标');
  await phones[1].locator('#join-button').tap();
  await phones[0].evaluate(
    async (code) =>
      fetch(`/api/rooms/${code}/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 2 }),
      }),
    code,
  );
  for (const phone of phones) await phone.locator('#ready-button').tap();
  await phones[0].locator('#start-button').tap();
  for (const phone of phones) {
    await phone.locator('#game-frame').waitFor();
    await phone.waitForFunction(
      () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
    );
    frames.push(phone.frames().find((frame) => frame.url().includes('/engine/player/')));
  }
  worker = computer.frames().find((frame) => frame.url().includes('/engine/worker/'));
  await Promise.all(frames.map((frame) => chooseGeneral(frame, worker)));
  await worker.waitForFunction(
    () => partyEngine.proof.started && partyEngine._status.paused,
    {},
    { polling: 100 },
  );
  const fixture = await worker.evaluate(() => {
    const { lib, game, _status } = partyEngine;
    const [actor, target, third] = game.players;
    _status.eventManager = new _status.eventManager.constructor();
    _status.pauseManager = new _status.pauseManager.constructor();
    lib.config.duration = 100;
    const own = Object.fromEntries(
      [
        ['huogong', 'huogong', 'diamond', 2],
        ['material', 'shan', 'heart', 5],
        ['jiu', 'jiu', 'spade', 3],
        ['sha', 'sha', 'spade', 7],
        ['tiesuo', 'tiesuo', 'club', 12],
        ['recast', 'tiesuo', 'spade', 11],
      ].map(([id, name, suit, number]) => [id, game.createCard(name, suit, number)]),
    );
    const enemy = [game.createCard('tao', 'heart', 8), game.createCard('sha', 'club', 9)];
    globalThis.partyMilitary = { actor, target, third, own, enemy, result: {} };
    return { shown: enemy[0].cardid, hidden: enemy[1].cardid, material: own.material.cardid };
  });
  await stage('setup');
  await waitStage();
  await stage('fire');
  await frames[1].waitForFunction(
    () => partyEngine._status.event?.name === 'chooseCard' && partyEngine._status.paused,
  );
  const deadline = await worker.evaluate(
    () => partyEngine.lib.playerOL[partyMilitary.target.playerid].timeout,
  );
  await phones[1].reload();
  await phones[1].waitForFunction(
    () =>
      document.querySelector('#game-frame')?.contentWindow?.partyEngine?._status.event?.name ===
      'chooseCard',
  );
  frames[1] = phones[1].frames().find((frame) => frame.url().includes('/engine/player/'));
  assert.equal(
    await worker.evaluate(() => partyEngine.lib.playerOL[partyMilitary.target.playerid].timeout),
    deadline,
  );
  await card(frames[1], fixture.shown);
  await frames[0].waitForFunction(
    () => partyEngine._status.event?.name === 'chooseToDiscard' && partyEngine._status.paused,
  );
  for (const frame of frames)
    assert(
      await frame.evaluate(
        (id) =>
          [...document.querySelectorAll('.dialog .button.card')].some(
            (node) => node.link?.cardid === id && node.link.name !== 'party_unknown',
          ),
        fixture.shown,
      ),
      '火攻展示牌应公开显示',
    );
  assert(
    await frames[0].evaluate(
      (id) =>
        partyEngine.game.players
          .filter((p) => p !== partyEngine.game.me)
          .flatMap((p) => p.getCards('h'))
          .some((c) => c.cardid === id && c.name === 'party_unknown'),
      fixture.hidden,
    ),
    '未展示手牌保持隐藏',
  );
  await phones[0].reload();
  await phones[0].waitForFunction(
    () =>
      document.querySelector('#game-frame')?.contentWindow?.partyEngine?._status.event?.name ===
      'chooseToDiscard',
  );
  frames[0] = phones[0].frames().find((frame) => frame.url().includes('/engine/player/'));
  assert(
    await frames[0].evaluate(
      (id) =>
        [...document.querySelectorAll('.dialog .button.card')].some(
          (node) => node.link?.cardid === id && node.link.name !== 'party_unknown',
        ),
      fixture.shown,
    ),
    '火攻弃牌选择刷新后仍应看到展示牌',
  );
  await card(frames[0], fixture.material);
  await waitStage();
  for (const kind of ['wine', 'chain', 'recast', 'armor', 'judgment']) {
    await stage(kind);
    await waitStage();
    console.log('军争原生夹具完成', kind);
  }
  const result = await worker.evaluate(() => partyMilitary.result);
  assert.equal(result.fireDamage, 1);
  assert.equal(result.wineDamage, 2);
  assert.equal(result.wineConsumed, true);
  assert.equal(result.linked, true);
  assert.deepEqual(result.chainDamage, [1, 1]);
  assert.equal(result.unlinked, true);
  assert.equal(result.recastDraw, true);
  assert.equal(result.vineBlocksNormal, true);
  assert.equal(result.vineFireDamage, 2);
  assert.equal(result.silverDamage, 1);
  assert.equal(result.silverRemovalHeals, true);
  assert.equal(result.supplySkipsDraw, true);
  assert.equal(result.clubKeepsDraw, true);
  assert.deepEqual(faults, []);
  assert.deepEqual([...missing], []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        fixture: true,
        targetChoiceRefresh: true,
        publicShownCard: true,
        unshownCardsPrivate: true,
        result,
      },
      null,
      2,
    ),
  );
  console.log(
    '军争原生定向验证通过：火攻选择恢复/展示/隐私、酒杀、铁索/重铸、藤甲、白银、兵粮判定。',
    output,
  );
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  party.closeStreams();
  party.server.closeAllConnections();
  await new Promise((resolve) => party.server.close(resolve));
}
