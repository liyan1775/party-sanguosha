import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

// Real selection and dealing, then isolated native skills with known materials.
// These fixtures do not stand for random full games or physical phone testing.
const root = fileURLToPath(new URL('../', import.meta.url));
const engine = new NativeNonameService(root);
const engineEvents = [];
engine.subscribe((event) => {
  if (event.type === 'failed') {
    engineEvents.push(event);
    console.log('engine failed', event.message ?? event.reason);
  }
});
const party = createPartyServer({ webRoot: `${root}/dist/web`, port: 0, adapter: engine });
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const desktop = process.env.ENGINE_VERIFY_DESKTOP === '1';
const http = process.env.ENGINE_VERIFY_HTTP === '1';
const gesture = desktop ? 'click' : 'tap';
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const output = `.runtime/native-cards-feedback/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
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
  return phone.frames().find((frame) => frame.url().includes('/engine/player/'));
}
const control = (frame, text) =>
  frame
    .locator('.control:not(.removing) > div')
    .filter({ hasText: new RegExp(`^${text}$`) })
    .first();
async function renew(index, name) {
  const id = await frames[index].evaluate(() => partyEngine.game.me.playerid);
  const before = await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id);
  assert.equal(typeof before, 'number');
  await phones[index].reload();
  frames[index] = await table(phones[index]);
  await frames[index].waitForFunction(
    (name) => partyEngine._status.event.name === name && partyEngine._status.paused,
    name,
  );
  const after = await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id);
  assert.equal(after, before, 'refresh keeps the original native deadline');
}
async function finish() {
  await worker.waitForFunction(() => partyCardsProbe.done || partyCardsProbe.error, null, {
    timeout: 20000,
  });
  assert.equal(await worker.evaluate(() => partyCardsProbe.error), undefined);
}
async function material(index, id) {
  await frames[index].waitForFunction(
    (id) =>
      partyEngine.game.me
        .getCards('he')
        .some((card) => card.cardid === id && card.classList.contains('selectable')),
    id,
    { timeout: 5000 },
  );
  await frames[index].evaluate(
    (id) => (partyEngine.lib.cardOL[id].dataset.feedbackMaterial = id),
    id,
  );
  const equipment = await frames[index].evaluate(
    (id) => partyEngine.get.position(partyEngine.lib.cardOL[id]) === 'e',
    id,
  );
  await frames[index]
    .locator(`[data-feedback-material="${id}"].selectable`)
    .first()
    [gesture](equipment ? {} : { position: { x: 8, y: 15 } });
  await frames[index].waitForFunction(
    (id) => partyEngine.ui.selected.cards.some((card) => card.cardid === id),
    id,
  );
}
async function start(computer, mode, preset, generals) {
  frames.length = phones.length = 0;
  for (let i = 0; i < generals.length; i++) phones.push(await page(true));
  await phones[0].goto(base);
  const created = await request(phones[0], '/api/rooms', 'POST', { nickname: '公开卡牌验证' });
  const code = created.room.code;
  await phones[0].goto(`${base}/join/${code}`);
  await request(phones[0], `/api/rooms/${code}`, 'PUT', {
    mode,
    playerCount: generals.length,
    generalPreset: preset,
    allowGeneralSelection: true,
    extensions: [],
  });
  for (let i = 1; i < generals.length; i++) {
    await phones[i].goto(`${base}/join/${code}`);
    await phones[i].locator('#nickname').fill(`卡牌验证${i}`);
    await phones[i].locator('#join-button')[gesture]();
  }
  for (const [i, general] of generals.entries())
    await request(phones[i], `/api/rooms/${code}/me/general`, 'PUT', { general });
  for (const phone of phones) await phone.locator('#ready-button')[gesture]();
  await phones[0].locator('#start-button')[gesture]();
  for (const phone of phones) frames.push(await table(phone));
  await progress(`${mode}-phones-booted`);
  const matchId = party.lobby.get(code).snapshot().matchId;
  worker = computer.frames().find((frame) => frame.url().includes(`/engine/worker/${matchId}`));
  assert(worker, 'the current match has an attached rule worker');
  await progress(`${mode}-native-selection`);
  await Promise.all(frames.map((frame) => chooseGeneral(frame, worker, { mouse: desktop })));
  await worker.waitForFunction(() => partyEngine.proof.started && partyEngine._status.paused);
  const initialCount = await worker.evaluate(() => partyEngine.ui.cardPile.childElementCount);
  // Check before any reinit: this was the reported first-deal failure.
  for (const phone of phones)
    await phone.waitForFunction(
      (count) =>
        document
          .querySelector('#game-frame')
          .contentDocument.querySelector('#party-table-count')
          ?.textContent.endsWith(`剩余牌: ${count}`),
      initialCount,
      { timeout: 5000 },
    );
  results.push({ mode, initialDeckCountMatches: true, initialCount });
  await worker.evaluate(() => {
    const { lib, _status } = partyEngine;
    for (const timer of Object.values(lib.node.torespondtimeout)) clearTimeout(timer);
    lib.node.torespond = {};
    lib.node.torespondtimeout = {};
    _status.eventManager = new _status.eventManager.constructor();
    _status.eventManager.rootEvent = lib.element.GameEvent.initialGameEvent();
    _status.pauseManager = new _status.pauseManager.constructor();
    lib.config.duration = 100;
    globalThis.partyCardsProbe = { done: true };
  });
  for (const [i, phone] of phones.entries()) {
    await phone.reload();
    frames[i] = await table(phone);
    // booted means module loading finished, while HTTP reinit is asynchronous.
    // Do not inject fixture moves before this phone has its restored arena.
    await frames[i].waitForFunction(
      () =>
        partyEngine.lib.cardOL &&
        partyEngine.game.online &&
        partyEngine.game.me?.name &&
        partyEngine.game.me.playerid === partyEngine.game.onlineID,
    );
  }
  return { code, matchId };
}
async function stage(kind) {
  await progress(kind);
  await worker.evaluate((kind) => {
    const { game, lib, ui, _status } = partyEngine,
      probe = partyCardsProbe;
    probe.done = false;
    probe.kind = kind;
    const event = new lib.element.GameEvent('partyCardsFixture', false, _status.eventManager);
    event.player = game.players[0];
    event.kind = kind;
    event.setContent(async function (event) {
      const { game, ui } = partyEngine,
        probe = partyCardsProbe;
      const [actor, target, source] = game.players;
      if (event.kind === 'renxin-setup') {
        for (const player of game.players) {
          player.stat.push({ card: {}, skill: {}, triggerSkill: {} });
          if (player.countCards('hej')) await player.lose(player.getCards('hej'), ui.discardPile);
        }
        if (actor.isTurnedOver()) await actor.turnOver();
        target.hp = 1;
        target.hujia = 1;
        target.update();
        actor.directgain([probe.materials.equip, probe.materials.basic]);
        await actor.equip(probe.materials.wearing);
        return;
      }
      if (event.kind.startsWith('renxin-')) {
        await target.damage(1, source);
        return;
      }
      if (event.kind === 'recast-setup') {
        for (const player of game.players) {
          player.stat.push({ card: {}, skill: {}, triggerSkill: {} });
          if (player.countCards('hej')) await player.lose(player.getCards('hej'), ui.discardPile);
        }
        actor.directgain(Object.values(probe.materials));
        return;
      }
      if (event.kind === 'recast') {
        const before = actor.getCards('h').slice(),
          deckBefore = ui.cardPile.childElementCount;
        await actor.chooseToUse().set('type', 'phase');
        probe.recast = {
          countUnchanged: actor.countCards('h') === before.length,
          discarded: partyEngine.get.position(probe.materials.recast) === 'd',
          deckDecreased: ui.cardPile.childElementCount === deckBefore - 1,
          drawnIds: actor
            .getCards('h')
            .filter((card) => !before.includes(card))
            .map((card) => card.cardid),
        };
        return;
      }
      if (event.kind === 'poxi-setup') {
        for (const player of game.players) {
          player.stat.push({ card: {}, skill: {}, triggerSkill: {} });
          if (player.countCards('hej')) await player.lose(player.getCards('hej'), ui.discardPile);
        }
        actor.directgain(probe.materials.own);
        target.directgain(probe.materials.target);
        return;
      }
      if (event.kind === 'poxi') await actor.chooseToUse().set('type', 'phase');
      if (event.kind === 'private-ordering') {
        probe.privateCard = game.createCard('tao', 'heart', 7);
        ui.ordering.appendChild(probe.privateCard);
        game.log(actor, '私人区域测试', [probe.privateCard]);
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
try {
  await progress('real-doudizhu-selection-dealing');
  computer = await page();
  await computer.goto(`${base}/server`);
  await computer.waitForFunction(
    async () => (await (await fetch('/api/info')).json()).engine.ready,
  );
  const { matchId: doudizhuMatchId } = await start(computer, 'doudizhu', 'advanced', [
    're_caochong',
    're_xuzhu',
    're_zhaoyun',
  ]);
  const ids = await worker.evaluate(() => {
    const { game } = partyEngine;
    const materials = {
      equip: game.createCard('bagua', 'spade', 2),
      wearing: game.createCard('zhuge', 'club', 1),
      basic: game.createCard('sha', 'heart', 5),
    };
    partyCardsProbe.materials = materials;
    return Object.fromEntries(Object.entries(materials).map(([key, card]) => [key, card.cardid]));
  });
  await stage('renxin-setup');
  await finish();
  await stage('renxin-cancel');
  await frames[0].waitForFunction(
    () => partyEngine._status.event.name === 'chooseToDiscard' && partyEngine._status.paused,
  );
  const choice = await frames[0].evaluate(() => {
    const { game, get, _status } = partyEngine;
    const equip = game.me.getCards('he').find((card) => get.type(card) === 'equip');
    const recipe = get.funcInfoOL(get.filter({ type: 'equip' }));
    return {
      nativeFilterJSONRejected: get.infoFuncOL(recipe)(equip) !== true,
      restoredNativeFilterAcceptsEquipment: get.parsedResult(recipe)(equip) === true,
      args: _status.event._args.map((arg) => typeof arg),
      cards: game.me.getCards('he').map((card) => ({
        name: card.name,
        type: get.type(card),
        selected: card.classList.contains('selectable'),
      })),
      filter: String(_status.event.filterCard),
    };
  });
  await writeFile(`${output}/renxin-choice.json`, JSON.stringify(choice, null, 2));
  assert.equal(choice.nativeFilterJSONRejected, true);
  assert.equal(choice.restoredNativeFilterAcceptsEquipment, true);
  assert.equal(
    choice.cards.find((card) => card.name === 'sha').selected,
    false,
    'basic cards are not valid Renxin materials',
  );
  await material(0, ids.equip);
  assert.equal(
    await worker.evaluate(() => partyCardsProbe.done),
    false,
    'selection alone does not pay the cost',
  );
  await frames[0]
    .locator(`[data-feedback-material="${ids.equip}"].selected`)
    .first()
    [gesture]({ position: { x: 8, y: 15 } });
  await frames[0].waitForFunction(() => partyEngine.ui.selected.cards.length === 0);
  await renew(0, 'chooseToDiscard');
  await control(frames[0], '取消')[gesture]();
  await finish();
  assert.deepEqual(
    await worker.evaluate(() => ({
      flipped: partyEngine.game.players[0].isTurnedOver(),
      hp: partyEngine.game.players[1].hp,
      armor: partyEngine.game.players[1].hujia,
    })),
    { flipped: false, hp: 1, armor: 0 },
  );
  for (const [label, id] of [
    ['hand-equipment', ids.equip],
    ['equipped-card', ids.wearing],
  ]) {
    await stage('renxin-setup');
    await finish();
    await stage(`renxin-${label}`);
    await frames[0].waitForFunction(
      () => partyEngine._status.event.name === 'chooseToDiscard' && partyEngine._status.paused,
    );
    await material(0, id);
    const equipmentConfirm = frames[0]
      .locator('.dialog.popped .menubutton:not(.disabled)')
      .filter({ hasText: /^确定$/ });
    if (await equipmentConfirm.isVisible()) await equipmentConfirm[gesture]();
    else await control(frames[0], '确定')[gesture]();
    await finish();
    assert.deepEqual(
      await worker.evaluate(
        (id) => ({
          flipped: partyEngine.game.players[0].isTurnedOver(),
          hp: partyEngine.game.players[1].hp,
          armor: partyEngine.game.players[1].hujia,
          discarded: partyEngine.get.position(partyEngine.lib.cardOL[id]) === 'd',
        }),
        id,
      ),
      { flipped: true, hp: 1, armor: 1, discarded: true },
    );
    results.push({ renxin: label, correctCostAndPreventedDamage: true });
  }
  await phones[0].screenshot({ path: `${output}/renxin.png` });
  // The preceding equipment picker can outlive its cost confirmation during
  // native touch debounce. Dismiss it through its normal backdrop before the
  // independent recast fixture; never force a tap through an active poplayer.
  const equipmentLayer = frames[0].locator('.poplayer').last();
  if (await equipmentLayer.isVisible()) {
    await frames[0].waitForFunction(() => !partyEngine._status.touchpopping);
    await equipmentLayer[gesture]({ position: { x: 300, y: 10 } });
    await frames[0].waitForFunction(() => !document.querySelector('.poplayer'));
  }

  const recastMaterials = await worker.evaluate(() => {
    const { game } = partyEngine;
    partyCardsProbe.materials = {
      recast: game.createCard('tiesuo', 'spade', 11),
      remaining: game.createCard('tiesuo', 'club', 12),
      basic: game.createCard('shan', 'diamond', 5),
    };
    return Object.fromEntries(
      Object.entries(partyCardsProbe.materials).map(([name, card]) => [name, card.cardid]),
    );
  });
  await stage('recast-setup');
  await finish();
  await stage('recast');
  await frames[0].waitForFunction(
    () => partyEngine._status.event.name === 'chooseToUse' && partyEngine._status.paused,
  );
  await control(frames[0], '重铸')[gesture]();
  await material(0, recastMaterials.recast);
  assert.equal(await worker.evaluate(() => partyCardsProbe.done), false);
  for (const index of [1, 2]) {
    assert(
      await frames[index].evaluate(
        (ids) => ids.every((id) => partyEngine.lib.cardOL[id]?.name === 'party_unknown'),
        Object.values(recastMaterials),
      ),
      'choosing a recast material does not reveal it before confirmation',
    );
  }
  await control(frames[0], '确定')[gesture]();
  await finish();
  const recastResult = await worker.evaluate(() => partyCardsProbe.recast);
  assert.equal(recastResult.countUnchanged, true);
  assert.equal(recastResult.discarded, true);
  assert.equal(recastResult.deckDecreased, true);
  assert.equal(recastResult.drawnIds.length, 1);
  const recastFace = await worker.evaluate(
    (id) => partyEngine.get.translation(partyEngine.lib.cardOL[id]),
    recastMaterials.recast,
  );
  await wait(650);
  const recastHistory = await request(phones[1], `/engine/history/${doudizhuMatchId}`, 'GET');
  const recastEntry = recastHistory.entries.find((entry) => entry.text.includes('重铸了'));
  assert(recastEntry?.text.endsWith(`重铸了${recastFace}`));
  assert(!recastEntry.text.includes('暗牌'));
  for (const [index, phone] of phones.entries()) {
    await frames[index].waitForFunction((id) => {
      const card = partyEngine.lib.cardOL[id];
      return card?.name === 'tiesuo' && card.suit === 'spade' && card.number === 11;
    }, recastMaterials.recast);
    await phone.locator('#match-records')[gesture]();
    await phone.waitForFunction(
      (text) =>
        document
          .querySelector('#match-records-dialog .observer-recent')
          ?.textContent.includes(text),
      recastEntry.text,
    );
    await phone.getByRole('button', { name: '关闭本局记录' })[gesture]();
    if (index > 0)
      assert(
        await frames[index].evaluate(
          (ids) => ids.every((id) => partyEngine.lib.cardOL[id]?.name === 'party_unknown'),
          [recastMaterials.remaining, recastMaterials.basic, ...recastResult.drawnIds],
        ),
        'unrecast hand cards and the actual replacement draw remain concealed',
      );
  }
  assert(
    await frames[0].evaluate(
      (ids) =>
        ids.every((id) => {
          const card = partyEngine.lib.cardOL[id];
          return typeof card?.name === 'string' && card.name !== 'party_unknown';
        }),
      recastResult.drawnIds,
    ),
    'the actor still receives the actual replacement draw',
  );
  await phones[1].reload();
  frames[1] = await table(phones[1]);
  const refreshedRecast = await request(phones[1], `/engine/history/${doudizhuMatchId}`, 'GET');
  assert(
    refreshedRecast.entries.some(
      (entry) => entry.sequence === recastEntry.sequence && entry.text === recastEntry.text,
    ),
    'refresh keeps the originally published recast face and sequence',
  );
  await phones[1].locator('#match-records')[gesture]();
  await phones[1].waitForFunction(
    (text) =>
      document.querySelector('#match-records-dialog .observer-recent')?.textContent.includes(text),
    recastEntry.text,
  );
  await phones[1].screenshot({ path: `${output}/recast-records.png` });
  await phones[1].getByRole('button', { name: '关闭本局记录' })[gesture]();
  results.push({
    nativeTiesuoRecast: true,
    actualDiscardAndReplacementDraw: true,
    selectionConcealedBeforeConfirmation: true,
    publicMaterialFaceInAllNativeClients: true,
    publicMaterialFaceInAllPlayerRecords: true,
    remainingHandsAndReplacementDrawConcealed: true,
    refreshRetainsOriginalRecastFaceAndSequence: true,
  });
  await worker.evaluate(() => partyEngine.game.over(true));
  await phones[0].locator('#rematch-button')[gesture]();

  await progress('real-poxi-selection-dealing');
  const { matchId } = await start(computer, 'versus', 'ol-doudizhu-s15', [
    'shen_ganning',
    're_xuzhu',
    're_zhaoyun',
    're_guojia',
  ]);
  const poxi = await worker.evaluate(() => {
    const { game } = partyEngine;
    const card = (name, suit, num) => game.createCard(name, suit, num);
    const own = [
      card('sha', 'spade', 6),
      card('shan', 'heart', 8),
      card('guohe', 'club', 9),
      card('sha', 'spade', 10),
    ];
    const target = [card('sha', 'diamond', 11), card('shan', 'spade', 12)];
    partyCardsProbe.materials = { own, target };
    return {
      selected: [...own.slice(0, 3), target[0]].map((card) => card.cardid),
      hidden: [own[3].cardid, target[1].cardid],
    };
  });
  await stage('poxi-setup');
  await finish();
  await stage('poxi');
  await frames[0].waitForFunction(
    () => partyEngine._status.event.name === 'chooseToUse' && partyEngine._status.paused,
  );
  await control(frames[0], '魄袭')[gesture]();
  const targetId = await frames[1].evaluate(() => partyEngine.game.me.playerid);
  await frames[0].evaluate(
    (id) => (partyEngine.lib.playerOL[id].dataset.feedbackTarget = 'poxi'),
    targetId,
  );
  await frames[0]
    .locator('[data-feedback-target="poxi"].selectable')
    [gesture]({ position: { x: 12, y: 12 } });
  await control(frames[0], '确定')[gesture]();
  await frames[0].waitForFunction(
    () => partyEngine._status.event.name === 'chooseButton' && partyEngine._status.paused,
  );
  for (const id of poxi.selected) {
    await frames[0].evaluate((id) => {
      for (const button of partyEngine.ui.dialog.buttons)
        if (button.link.cardid === id) button.dataset.feedbackButton = id;
    }, id);
    await frames[0].locator(`[data-feedback-button="${id}"].selectable`)[gesture]();
  }
  assert.equal(await worker.evaluate(() => partyCardsProbe.done), false);
  await control(frames[0], '确定')[gesture]();
  await finish();
  const expected = await worker.evaluate(
    (ids) => ids.map((id) => partyEngine.get.translation(partyEngine.lib.cardOL[id])),
    poxi.selected,
  );
  await wait(650);
  const history = await request(phones[0], `/engine/history/${matchId}`, 'GET');
  const discarded = history.entries.filter((entry) => entry.text.includes('弃置了'));
  assert(discarded.length >= 2);
  assert(
    discarded.every((entry) => !entry.text.includes('暗牌')),
    'native simultaneous public discard must retain all four card faces',
  );
  for (const name of expected) assert(discarded.some((entry) => entry.text.includes(name)));
  for (const index of [2, 3]) {
    const hidden = await frames[index].evaluate(
      (ids) => ids.map((id) => partyEngine.lib.cardOL[id]?.name),
      poxi.hidden,
    );
    assert(
      hidden.every((name) => name === 'party_unknown'),
      'remaining unexposed hands remain hidden to uninvolved players',
    );
  }
  await stage('private-ordering');
  await finish();
  await wait(650);
  const privateHistory = await request(phones[0], `/engine/history/${matchId}`, 'GET');
  assert(privateHistory.entries.some((entry) => entry.text.includes('私人区域测试暗牌')));
  await phones[0].reload();
  frames[0] = await table(phones[0]);
  const after = await request(phones[0], `/engine/history/${matchId}`, 'GET');
  for (const entry of discarded)
    assert(
      after.entries.some((item) => item.sequence === entry.sequence && item.text === entry.text),
    );
  results.push({
    nativePoxi: true,
    publicDiscardFaces: 4,
    remainingHandsConcealed: true,
    privateOrderingConcealed: true,
    refreshRetainsPublicDiscards: true,
  });
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
        faults,
        missing: [...missing],
      },
      null,
      2,
    ),
  );
  console.log('原生卡牌反馈验证通过', output);
} catch (error) {
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: error.stack,
        engineEvents,
        faults,
        missing: [...missing],
        progress: await worker
          ?.evaluate(() => ({
            event: partyEngine._status.event.name,
            errors: partyEngine.proof.errors,
          }))
          .catch(() => null),
      },
      null,
      2,
    ),
  );
  for (const [i, phone] of phones.entries())
    await phone.screenshot({ path: `${output}/failure-${i}.png` }).catch(() => {});
  await computer?.screenshot({ path: `${output}/failure-computer.png` }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  engine.close();
  for (const context of contexts) await context.close();
  await browser.close();
  party.closeStreams();
  party.server.closeAllConnections();
  await new Promise((resolve) => party.server.close(resolve));
}
