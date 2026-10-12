import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

// Isolated known-material fixtures after real native selection and dealing.
// This verifies native effects and phone serialization, not random full games
// or physical phone/WeChat behavior. Never attaches to the production service.
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
const output = `.runtime/native-expansion/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
await mkdir(output, { recursive: true });
const contexts = [],
  phones = [],
  frames = [],
  faults = [],
  missing = new Set(),
  results = [];
let worker, computer;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function progress(value) {
  console.log(value);
  await writeFile(
    `${output}/progress.json`,
    JSON.stringify({ value, at: new Date().toISOString() }),
  );
}
async function page(phone = false) {
  const context = await browser.newContext(
    phone ? { viewport: { width: 844, height: 390 }, isMobile: !desktop, hasTouch: !desktop } : {},
  );
  contexts.push(context);
  if (phone && http)
    await context.addInitScript(() => sessionStorage.setItem('party_http_transport', '1'));
  if (!phone)
    await context.route('**/engine/runtime/mode.js', async (route) => {
      const headers = route.request().headers();
      delete headers['if-none-match'];
      delete headers['if-modified-since'];
      const response = await route.fetch({ headers }),
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
async function choice(index, name) {
  await frames[index].waitForFunction(
    (name) => partyEngine._status.event.name === name && partyEngine._status.paused,
    name,
  );
}
async function renew(index, name) {
  const id = await frames[index].evaluate(() => partyEngine.game.me.playerid);
  const before = await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id);
  assert.equal(typeof before, 'number');
  await phones[index].reload();
  frames[index] = await table(phones[index]);
  await choice(index, name);
  assert.equal(
    await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id),
    before,
    'refresh preserves the original native deadline',
  );
}
async function target(index, id) {
  await frames[index].evaluate((id) => {
    partyEngine.lib.playerOL[id].dataset.expansionTarget = id;
  }, id);
  await frames[index].locator(`[data-expansion-target="${id}"].selectable`).first()[gesture]();
}
async function material(index, id) {
  await frames[index].waitForFunction(
    (id) => partyEngine.lib.cardOL[id]?.classList.contains('selectable'),
    id,
  );
  await frames[index].evaluate((id) => {
    partyEngine.lib.cardOL[id].dataset.expansionMaterial = id;
  }, id);
  await frames[index]
    .locator(`[data-expansion-material="${id}"].selectable`)
    .first()
    [gesture]({ position: { x: 8, y: 15 } });
  await frames[index].waitForFunction(
    (id) => partyEngine.ui.selected.cards.some((card) => card.cardid === id),
    id,
  );
}
async function button(index, id) {
  await frames[index].evaluate((id) => {
    for (const node of partyEngine._status.event.dialog.buttons)
      if (node.link?.cardid === id) node.dataset.expansionButton = id;
  }, id);
  await frames[index]
    .locator(`.dialog:not(.removing) [data-expansion-button="${id}"]`)
    .first()
    [gesture]();
}
async function moveToTop(index, id) {
  await frames[index].evaluate((id) => {
    const event = partyEngine._status.event;
    for (const node of event.buttonss.flatMap((zone) => [...zone.children]))
      if (node.link?.cardid === id) node.dataset.expansionMove = id;
    event.buttonss[1].dataset.expansionZone = 'top';
  }, id);
  await frames[index]
    .locator(`.dialog:not(.removing) [data-expansion-move="${id}"]`)
    .first()
    [gesture]();
  const zone = frames[index].locator('.dialog:not(.removing) [data-expansion-zone="top"]');
  const bounds = await zone.boundingBox();
  assert(bounds);
  await zone[gesture]({ position: { x: bounds.width - 8, y: bounds.height / 2 } });
  await frames[index].waitForFunction(
    (id) =>
      partyEngine._status.event.moved[1].some((card) => card.cardid === id) &&
      !partyEngine._status.event.isPlayingAnimation,
    id,
  );
}
async function finish({ drain = false } = {}) {
  for (let count = 0; count < 150; count++) {
    const state = await worker.evaluate(() => ({
      done: partyExpansionProbe.done,
      error: partyExpansionProbe.error,
    }));
    assert.equal(state.error, undefined);
    if (state.done) return;
    if (drain)
      for (const frame of frames) {
        const name = await frame.evaluate(() => partyEngine._status.event.name);
        if (['chooseToRespond', 'chooseToUse', 'chooseBool'].includes(name)) {
          const cancel = control(frame, '取消');
          if (await cancel.isVisible()) await cancel[gesture]();
        }
      }
    await wait(100);
  }
  throw new Error('Native expansion fixture did not finish');
}
async function stage(kind) {
  await progress(kind);
  await worker.evaluate((kind) => {
    const { game, lib, ui, _status } = partyEngine,
      probe = partyExpansionProbe;
    probe.done = false;
    probe.error = undefined;
    const event = new lib.element.GameEvent('partyExpansionFixture', false, _status.eventManager);
    event.player = game.players[0];
    event.kind = kind;
    event.setContent(async function (event) {
      const { game, lib, ui } = partyEngine,
        probe = partyExpansionProbe;
      const [fazheng, xusheng, yufan, dongbai] = game.players;
      if (event.kind.endsWith('setup')) {
        for (const player of game.players) {
          player.stat.push({ card: {}, skill: {}, triggerSkill: {} });
          player.removeSkill(['decadepojun2', 'xiahui2']);
          if (player.countCards('hejx')) await player.lose(player.getCards('hejx'), ui.discardPile);
          player.hp = player.maxHp;
          player.hujia = 0;
          player.update();
        }
        if (event.kind === 'xuanhuo-setup') {
          fazheng.directgain([probe.cards.own]);
          xusheng.directgain([probe.cards.bystander]);
          dongbai.directgain([probe.cards.sha, probe.cards.hidden]);
          yufan.hujia = 1;
          yufan.update();
        }
        if (event.kind === 'pojun-setup') {
          xusheng.directgain([probe.cards.sha]);
          // These fixed seats are distance two apart. Supply an ordinary
          // range-two weapon rather than changing the native target rules.
          await xusheng.equip(probe.cards.weapon);
          dongbai.directgain([probe.cards.trick, probe.cards.basic, probe.cards.hidden]);
          await dongbai.equip(probe.cards.equip);
          dongbai.hujia = 1;
          dongbai.update();
        }
        if (event.kind === 'zongxuan-setup') {
          yufan.directgain([probe.cards.trick, probe.cards.equip, probe.cards.hidden]);
        }
        return;
      }
      if (event.kind.startsWith('xuanhuo-')) {
        probe.beforeUses = dongbai.getAllHistory('useCard').length;
        probe.beforeFazheng = fazheng.countCards('h');
        await fazheng.phaseDraw();
        probe.afterUses = dongbai.getAllHistory('useCard').length;
        probe.afterFazheng = fazheng.countCards('h');
        probe.last = dongbai.getAllHistory('useCard').at(-1);
      }
      if (event.kind === 'pojun') {
        await xusheng.chooseToUse().set('type', 'phase');
        probe.pojunExpansion = dongbai.getExpansions('decadepojun2').slice();
        probe.pojunEquipDiscarded = partyEngine.get.position(probe.cards.equip) === 'd';
      }
      if (event.kind === 'pojun-return') await event.trigger('phaseEnd');
      if (event.kind === 'zongxuan') {
        await yufan.discard([probe.cards.trick, probe.cards.equip]);
        probe.pileTop = [ui.cardPile.children[0], ui.cardPile.children[1]];
      }
      if (event.kind === 'zhiyan') await yufan.phaseJieshu();
      if (event.kind === 'private-ordering') {
        probe.privateCard = game.createCard('tao', 'heart', 7);
        ui.ordering.appendChild(probe.privateCard);
        game.log(fazheng, '私有排序边界测试', [probe.privateCard]);
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
async function concealed(index, ids) {
  await frames[index].waitForFunction(
    (ids) => ids.every((id) => partyEngine.lib.cardOL[id]?.name === 'party_unknown'),
    ids,
    { timeout: 5000 },
  );
}
async function designation(index, expectedId) {
  const value = await frames[index].evaluate(() => {
    const { game, get, _status } = partyEngine;
    return {
      targets: game.players
        .filter((target) => _status.event.filterTarget({ name: 'sha' }, game.me, target))
        .map((target) => target.playerid),
      bindings: _status.event.partyDesignatedTargets?.map((target) => target.playerid),
      type: get.itemtype(_status.event.partyDesignatedTargets),
    };
  });
  assert.deepEqual(value.targets, [expectedId]);
  assert.deepEqual(value.bindings, [expectedId]);
  assert.equal(value.type, 'players');
  assert(
    await worker.evaluate(() =>
      partyExpansionProbe.rules.every(({ event, original }) => event.filterTarget === original),
    ),
    'phone reconstruction never replaces the worker native target rule',
  );
}
try {
  await progress('real-selection-dealing');
  computer = await page();
  await computer.goto(`${base}/server`);
  await computer.waitForFunction(
    async () => (await (await fetch('/api/info')).json()).engine.ready,
  );
  for (let index = 0; index < 4; index++) phones.push(await page(true));
  await phones[0].goto(base);
  const created = await request(phones[0], '/api/rooms', 'POST', { nickname: '扩池技能验证' });
  const code = created.room.code;
  await phones[0].goto(`${base}/join/${code}`);
  await request(phones[0], `/api/rooms/${code}`, 'PUT', {
    mode: 'versus',
    playerCount: 4,
    generalPreset: 'advanced',
    allowGeneralSelection: true,
    extensions: [],
  });
  for (let index = 1; index < 4; index++) {
    await phones[index].goto(`${base}/join/${code}`);
    await phones[index].locator('#nickname').fill(`扩池技能${index}`);
    await phones[index].locator('#join-button')[gesture]();
  }
  const generals = ['xin_fazheng', 'xin_xusheng', 'yufan', 'dongbai'];
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
    await worker.evaluate(() => partyEngine.game.players.map((player) => player.name)),
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
      sha: game.createCard('sha', 'spade', 9),
      own: game.createCard('tao', 'heart', 4),
      bystander: game.createCard('wuxie', 'club', 6),
      hidden: game.createCard('shan', 'heart', 11),
      trick: game.createCard('guohe', 'club', 10),
      basic: game.createCard('tao', 'diamond', 8),
      equip: game.createCard('zhuge', 'club', 1),
      weapon: game.createCard('qinggang', 'spade', 6),
    };
    globalThis.partyExpansionProbe = { cards, done: true, rules: [] };
    const send = lib.element.GameEvent.prototype.send;
    lib.element.GameEvent.prototype.send = function (...args) {
      const check = this.name === 'chooseToUse' && this.getParent?.().name === 'xinxuanhuo';
      if (check) partyExpansionProbe.rules.push({ event: this, original: this.filterTarget });
      const original = this.filterTarget;
      const returned = send.apply(this, args);
      if (check && this.filterTarget !== original)
        partyExpansionProbe.error = 'Worker native target filter was replaced';
      return returned;
    };
    return {
      players: game.players.map((player) => player.playerid),
      cards: Object.fromEntries(Object.entries(cards).map(([key, card]) => [key, card.cardid])),
    };
  });
  for (const [index, phone] of phones.entries()) {
    await phone.reload();
    frames[index] = await table(phone);
  }
  for (const branch of ['sha', 'refuse']) {
    await stage('xuanhuo-setup');
    await finish();
    await stage(`xuanhuo-${branch}`);
    await choice(0, 'chooseTarget');
    await target(0, ids.players[3]);
    await control(frames[0], '确定')[gesture]();
    await choice(0, 'chooseTarget');
    await target(0, ids.players[2]);
    await control(frames[0], '确定')[gesture]();
    await choice(3, 'chooseToUse');
    await designation(3, ids.players[2]);
    const nativeWire = await worker.evaluate(() =>
      partyEngine.get.stringifiedResult(partyExpansionProbe.rules.at(-1).original),
    );
    assert.equal(
      await frames[3].evaluate((wire) => {
        try {
          partyEngine.get.parsedResult(wire)(null, partyEngine.game.me, partyEngine.game.me);
          return '';
        } catch (error) {
          return error.name;
        }
      }, nativeWire),
      'ReferenceError',
      'the pinned native closure alone loses target2 during real codec reconstruction',
    );
    await renew(3, 'chooseToUse');
    await designation(3, ids.players[2]);
    for (const index of [0, 1, 2]) await concealed(index, [ids.cards.sha, ids.cards.hidden]);
    await concealed(3, [ids.cards.own, ids.cards.bystander]);
    if (branch === 'sha') {
      await material(3, ids.cards.sha);
      assert.equal(await worker.evaluate(() => partyExpansionProbe.done), false);
      const selected = await frames[3].evaluate(() =>
        partyEngine.ui.selected.targets.map((player) => player.playerid),
      );
      assert.deepEqual(selected, [ids.players[2]]);
      await control(frames[3], '确定')[gesture]();
      await finish({ drain: true });
      assert.deepEqual(
        await worker.evaluate(() => ({
          used: partyExpansionProbe.afterUses - partyExpansionProbe.beforeUses,
          name: partyExpansionProbe.last?.card.name,
          targets: partyExpansionProbe.last?.targets.map((player) => player.playerid),
          gained: partyExpansionProbe.afterFazheng - partyExpansionProbe.beforeFazheng,
        })),
        { used: 1, name: 'sha', targets: [ids.players[2]], gained: 0 },
      );
      for (const index of [0, 1, 2]) await concealed(index, [ids.cards.hidden]);
    } else {
      await control(frames[3], '取消')[gesture]();
      await choice(0, 'gainPlayerCard');
      const selected = await frames[0].evaluate(() => {
        const buttons = partyEngine._status.event.dialog.buttons;
        for (const [index, node] of buttons.entries()) node.dataset.expansionPick = index;
        return {
          allConcealed: buttons.every((node) => node.link.name === 'party_unknown'),
          count: buttons.length,
        };
      });
      assert.equal(selected.allConcealed, true, 'gainPlayerCard must keep target hand blank');
      assert(selected.count >= 2);
      for (const index of [0, 1])
        await frames[0]
          .locator(`.dialog:not(.removing) [data-expansion-pick="${index}"]`)
          .first()
          [gesture]();
      await control(frames[0], '确定')[gesture]();
      // Taking two cards offers Fazheng's separate optional Enyuan draw.
      // Decline that native follow-up so this fixture measures Xuanhuo only.
      await finish({ drain: true });
      assert.deepEqual(
        await worker.evaluate(() => ({
          used: partyExpansionProbe.afterUses - partyExpansionProbe.beforeUses,
          gained: partyExpansionProbe.afterFazheng - partyExpansionProbe.beforeFazheng,
        })),
        { used: 0, gained: 2 },
      );
      const transferred = await worker.evaluate(() =>
        partyEngine.game.players[0]
          .getCards('h')
          .filter((card) => card !== partyExpansionProbe.cards.own)
          .map((card) => card.cardid),
      );
      for (const index of [1, 2]) await concealed(index, transferred);
    }
    results.push({
      skill: 'xinxuanhuo',
      branch,
      originalClosureFailureReproduced: true,
      workerRuleUnchanged: true,
      onlyDesignatedTarget: true,
      sameTargetAndDeadlineAfterRefresh: true,
      privateHandsConcealed: true,
      nativeEffectVerified: true,
    });
  }

  await stage('pojun-setup');
  await finish();
  await stage('pojun');
  await choice(1, 'chooseToUse');
  await material(1, ids.cards.sha);
  await target(1, ids.players[3]);
  await control(frames[1], '确定')[gesture]();
  await choice(1, 'choosePlayerCard');
  await concealed(1, [ids.cards.trick, ids.cards.basic, ids.cards.hidden]);
  for (const id of [ids.cards.trick, ids.cards.basic, ids.cards.equip]) await button(1, id);
  await control(frames[1], '确定')[gesture]();
  await choice(1, 'chooseButton');
  await concealed(1, [ids.cards.trick, ids.cards.basic, ids.cards.hidden]);
  for (const index of [0, 2])
    await concealed(index, [ids.cards.trick, ids.cards.basic, ids.cards.hidden]);
  assert(
    await frames[3].evaluate(
      (ids) => ids.every((id) => partyEngine.lib.cardOL[id].name !== 'party_unknown'),
      [ids.cards.trick, ids.cards.basic],
    ),
    'the original owner still sees their own temporarily removed cards',
  );
  await renew(1, 'chooseButton');
  await button(1, ids.cards.equip);
  await control(frames[1], '确定')[gesture]();
  await finish({ drain: true });
  assert.deepEqual(
    await worker.evaluate(() => ({
      count: partyExpansionProbe.pojunExpansion.length,
      equipDiscarded: partyExpansionProbe.pojunEquipDiscarded,
    })),
    { count: 2, equipDiscarded: true },
  );
  await stage('pojun-return');
  await finish();
  assert(
    await worker.evaluate(() => {
      const target = partyEngine.game.players[3];
      return (
        !target.getExpansions('decadepojun2').length &&
        [partyExpansionProbe.cards.trick, partyExpansionProbe.cards.basic].every((card) =>
          target.getCards('h').includes(card),
        )
      );
    }),
  );
  for (const index of [0, 1, 2])
    await concealed(index, [ids.cards.trick, ids.cards.basic, ids.cards.hidden]);
  results.push({
    skill: 'decadepojun',
    blindHandSelection: true,
    ownerSeesExpansion: true,
    otherSeatsCannotSeeExpansion: true,
    equipmentChoiceRestored: true,
    equipmentDiscarded: true,
    remainingExpansionReturned: true,
  });

  await stage('zongxuan-setup');
  await finish();
  await stage('zongxuan');
  await choice(2, 'chooseBool');
  await control(frames[2], '确定')[gesture]();
  await choice(2, 'chooseToMove');
  await renew(2, 'chooseToMove');
  assert.deepEqual(
    await frames[2].evaluate(() =>
      partyEngine._status.event.list[0][1].map((card) => card.name).sort(),
    ),
    ['guohe', 'zhuge'],
  );
  await moveToTop(2, ids.cards.equip);
  await moveToTop(2, ids.cards.trick);
  assert.deepEqual(
    await frames[2].evaluate(() => partyEngine._status.event.moved[1].map((card) => card.cardid)),
    [ids.cards.equip, ids.cards.trick],
  );
  assert.equal(await worker.evaluate(() => partyExpansionProbe.done), false);
  for (const index of [0, 1, 3]) {
    assert.notEqual(
      await frames[index].evaluate(() => partyEngine._status.event.name),
      'chooseToMove',
      'the other seats do not receive the actor private sorting request',
    );
    await concealed(index, [ids.cards.hidden]);
  }
  await control(frames[2], '确定')[gesture]();
  await finish();
  assert.deepEqual(
    await worker.evaluate(() => partyExpansionProbe.pileTop.map((card) => card.cardid)),
    [ids.cards.equip, ids.cards.trick],
    'the native card pile matches the actor confirmed order',
  );
  await stage('zhiyan');
  await choice(2, 'chooseTarget');
  await target(2, ids.players[3]);
  await control(frames[2], '确定')[gesture]();
  await finish({ drain: true });
  assert(
    await worker.evaluate(() =>
      partyEngine.game.players[3].getCards('e').includes(partyExpansionProbe.cards.equip),
    ),
    'Zhiyan visibly draws and natively equips the selected top equipment',
  );
  for (const frame of frames)
    assert.equal(
      await frame.evaluate((id) => partyEngine.lib.cardOL[id].name, ids.cards.equip),
      'zhuge',
    );
  results.push({
    skill: 'zongxuan/zhiyan',
    publicDiscardMaterialsVisible: true,
    privateSortingRequest: true,
    originalSortingDeadlineAfterRefresh: true,
    nativePileOrderConfirmed: true,
    visibleTopCardDrawAndEquipment: true,
    otherHandCardsConcealed: true,
  });

  await stage('private-ordering');
  await finish();
  await wait(600);
  const history = await request(phones[0], `/engine/history/${matchId}`, 'GET');
  assert(history.entries.some((entry) => entry.text.includes('私有排序边界测试暗牌')));
  assert.deepEqual(failures, []);
  assert.deepEqual(faults, []);
  assert.deepEqual([...missing], []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        fixture: true,
        physicalPhone: false,
        browser: browser.version(),
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
  console.log('原生扩池技能验证通过', output);
} catch (error) {
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: error.stack,
        failures,
        faults,
        missing: [...missing],
        progress: await worker
          ?.evaluate(() => ({
            event: partyEngine._status.event.name,
            errors: partyEngine.proof.errors,
            done: globalThis.partyExpansionProbe?.done,
            fixtureError: globalThis.partyExpansionProbe?.error,
          }))
          .catch(() => null),
        phones: await Promise.all(
          frames.map((frame) =>
            frame
              .evaluate(() => ({
                event: partyEngine._status.event.name,
                paused: partyEngine._status.paused,
                filterTarget: String(partyEngine._status.event.filterTarget),
                parent: partyEngine._status.event.getParent?.().name,
                controls: [...document.querySelectorAll('.control > div')].map(
                  (node) => node.textContent,
                ),
              }))
              .catch(() => null),
          ),
        ),
      },
      null,
      2,
    ),
  );
  for (const [index, phone] of phones.entries())
    await phone.screenshot({ path: `${output}/failure-${index}.png` }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  adapter.close();
  for (const context of contexts) await context.close();
  await browser.close();
  party.closeStreams();
  party.server.closeAllConnections();
  await new Promise((resolve) => party.server.close(resolve));
}
