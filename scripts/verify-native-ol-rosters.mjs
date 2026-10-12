import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from './native-ui-actions.mjs';

// An isolated real-engine fixture, after native selection and dealing. Only the
// natural phase loop is paused. Skills, native choices, and transport codecs run
// normally. Evidence contains aggregate assertions, never private materials.
const root = fileURLToPath(new URL('../', import.meta.url));
const adapter = new NativeNonameService(root);
const failures = [];
adapter.subscribe((event) => {
  if (event.type === 'failed') failures.push(event.type);
});
const party = createPartyServer({ webRoot: `${root}/dist/web`, port: 0, adapter });
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const desktop = process.env.ENGINE_VERIFY_DESKTOP === '1';
const http = process.env.ENGINE_VERIFY_HTTP === '1';
const diagnostic = process.env.ENGINE_VERIFY_DIAGNOSTIC === '1';
const gesture = desktop ? 'click' : 'tap';
const output = `.runtime/native-ol-rosters/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const contexts = [];
const phones = [];
const frames = [];
const results = [];
const faults = [];
const missing = new Set();
let worker, computer, matchId, currentStage;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function progress(stage) {
  currentStage = stage;
  console.log(stage);
  await writeFile(
    `${output}/progress.json`,
    JSON.stringify({ stage, at: new Date().toISOString() }),
  );
}

async function page(phone = false, storageState) {
  const context = await browser.newContext(
    phone
      ? {
          viewport: { width: 844, height: 390 },
          isMobile: !desktop,
          hasTouch: !desktop,
          storageState,
        }
      : {},
  );
  contexts.push(context);
  if (phone && http)
    await context.addInitScript(() => sessionStorage.setItem('party_http_transport', '1'));
  if (!phone)
    await context.route('**/engine/runtime/mode.js', async (route) => {
      const headers = route.request().headers();
      delete headers['if-none-match'];
      delete headers['if-modified-since'];
      const response = await route.fetch({ headers });
      const source = await response.text();
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
  const trace = { hiddenInitCount: 0, jinInitCount: 0, concealedDefinitionOnly: true };
  value.olNativeTrace = trace;
  const observe = (value, depth = 0) => {
    if (depth > 16) return;
    if (typeof value === 'string') {
      try {
        observe(JSON.parse(value), depth + 1);
      } catch {
        /* Native function/card strings are not JSON. */
      }
      return;
    }
    if (Array.isArray(value)) {
      const callback = value[1];
      if (
        value[0] === 'exec' &&
        typeof callback === 'string' &&
        callback.includes('get.convertedCharacter(concealed)') &&
        callback.includes('lib.playerOL[id].init(name)')
      ) {
        if (value[3] === 'jin_wangyuanji') trace.jinInitCount++;
        if (typeof value[3] === 'string' && value[3].startsWith('party_hidden_')) {
          trace.hiddenInitCount++;
          trace.concealedDefinitionOnly &&=
            value[4]?.hasHiddenSkill === true &&
            value[4]?.skills?.length === 0 &&
            value[4]?.hp === 1 &&
            value[4]?.maxHp === 1;
        }
      }
      for (const child of value) observe(child, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) observe(child, depth + 1);
    }
  };
  value.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) =>
      observe(typeof payload === 'string' ? payload : payload.toString('utf8')),
    ),
  );
  const poll = (target) => {
    const original = target.waitForFunction.bind(target);
    target.waitForFunction = (fn, arg, options) => original(fn, arg, { polling: 100, ...options });
  };
  poll(value);
  value.on('frameattached', poll);
  // A browser exception could contain serialized private data: keep only its type.
  value.on('pageerror', (error) => faults.push(error.name));
  value.on('response', (response) => {
    if (response.status() >= 400) missing.add(new URL(response.url()).pathname);
    if (
      phone &&
      new URL(response.url()).pathname.startsWith('/engine/poll/') &&
      response.status() === 200
    )
      void response
        .json()
        .then(observe)
        .catch(() => {});
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
      if (!response.ok) throw new Error('Fixture HTTP request failed');
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
  assert.equal(typeof before, 'number', 'Native choice has an original deadline');
  await phones[index].reload();
  frames[index] = await table(phones[index]);
  await choice(index, name);
  assert.equal(
    await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id),
    before,
    'Reconnect preserves the original native choice deadline',
  );
}

async function target(index, id) {
  await frames[index].evaluate((id) => {
    partyEngine.lib.playerOL[id].dataset.olProbeTarget = 'selected';
  }, id);
  await frames[index].locator('[data-ol-probe-target="selected"].selectable').first()[gesture]();
}

async function material(index, id) {
  await frames[index].waitForFunction(
    (id) => partyEngine.lib.cardOL[id]?.classList.contains('selectable'),
    id,
  );
  await frames[index].evaluate((id) => {
    partyEngine.lib.cardOL[id].dataset.olProbeMaterial = 'selected';
  }, id);
  await frames[index]
    .locator('[data-ol-probe-material="selected"].selectable')
    .first()
    [gesture]({ position: { x: 8, y: 15 } });
  await frames[index].waitForFunction(
    (id) => partyEngine.ui.selected.cards.some((card) => card.cardid === id),
    id,
  );
}

async function dialogButton(index, kind, value) {
  await frames[index].evaluate(
    ({ kind, value }) => {
      const buttons =
        partyEngine._status.event.dialog?.buttons || partyEngine.ui.dialog?.buttons || [];
      for (const button of buttons) {
        const matches =
          kind === 'material' ? button.link?.cardid === value : button.link?.[2] === value;
        if (matches) button.dataset.olProbeButton = 'selected';
      }
    },
    { kind, value },
  );
  await frames[index]
    .locator('.dialog:not(.removing) [data-ol-probe-button="selected"].selectable')
    .first()
    [gesture]();
  await control(frames[index], '确定')[gesture]();
}

async function concealed(index, ids) {
  await frames[index].waitForFunction(
    (ids) =>
      ids.every((id) => {
        const card = partyEngine.lib.cardOL[id];
        return (
          !card ||
          (card.name === 'party_unknown' && card.suit === 'none' && !card.number && !card.nature)
        );
      }),
    ids,
    { timeout: 5000 },
  );
}

async function publicCards(index, ids) {
  const expected = await worker.evaluate(
    (ids) =>
      ids.map((id) => {
        const card =
          Object.values(partyOlProbe.cards).find((card) => card.cardid === id) ||
          partyOlProbe.yanxiShown.find((card) => card.cardid === id);
        return {
          id,
          name: card.name,
          suit: card.suit,
          number: card.number,
          nature: card.nature || '',
        };
      }),
    ids,
  );
  await frames[index].waitForFunction(
    (expected) =>
      expected.every((face) => {
        const card = partyEngine.lib.cardOL[face.id];
        return (
          card &&
          card.name === face.name &&
          card.suit === face.suit &&
          card.number === face.number &&
          (card.nature || '') === face.nature
        );
      }),
    expected,
    { timeout: 5000 },
  );
}

async function finish({ drain = false } = {}) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const state = await worker.evaluate(() => ({
      done: partyOlProbe.done,
      error: !!partyOlProbe.error,
    }));
    assert.equal(state.error, false, 'Native fixture event completes without an exception');
    if (state.done) return;
    if (drain)
      for (const frame of frames) {
        const name = await frame.evaluate(() => partyEngine._status.event.name);
        if (['chooseToUse', 'chooseToRespond', 'chooseBool'].includes(name)) {
          for (const text of ['取消', '结束', '结束回合']) {
            const cancel = control(frame, text);
            if (await cancel.isVisible()) {
              await cancel[gesture]();
              break;
            }
          }
        }
      }
    await wait(100);
  }
  throw new Error('Native fixture did not finish');
}

async function stage(kind) {
  await progress(kind);
  await worker.evaluate((kind) => {
    const { game, lib, _status } = partyEngine;
    const probe = partyOlProbe;
    probe.done = false;
    probe.error = false;
    const event = new lib.element.GameEvent(
      kind === 'huashen' ? 'phase' : kind === 'hidden-reveal' ? 'useSkill' : 'partyOlFixture',
      false,
      _status.eventManager,
    );
    event.player =
      game.players[
        kind.startsWith('guhuo') ? 1 : kind.startsWith('yanxi') || kind === 'hidden-reveal' ? 2 : 0
      ];
    event.kind = kind;
    event.setContent(async function (event) {
      const { game, lib, ui, _status, get } = partyEngine;
      const probe = partyOlProbe;
      const [zuoci, yuji, wangyuanji, sunquan] = game.players;
      if (event.kind === 'hidden-reveal') {
        _status.currentPhase = wangyuanji;
        const hand = wangyuanji.getCards('h').slice();
        wangyuanji.storage.partyOlPreserve = 'fixture';
        await wangyuanji.showCharacter(0);
        probe.hiddenPreserved =
          hand.every((card) => wangyuanji.getCards('h').includes(card)) &&
          hand.length === wangyuanji.countCards('h') &&
          wangyuanji.storage.partyOlPreserve === 'fixture';
        probe.revealedHp = wangyuanji.hp;
        probe.revealedMaxHp = wangyuanji.maxHp;
      }
      if (event.kind.endsWith('setup')) {
        // Isolate known material states through native player methods.
        await zuoci.removeAdditionalSkills('rehuashen');
        for (const player of game.players) {
          player.stat.push({ card: {}, skill: {}, triggerSkill: {} });
          if (player.countCards('hejx')) await player.lose(player.getCards('hejx'), ui.discardPile);
          player.hp = player.maxHp;
          player.hujia = 0;
          player.update();
        }
        if (event.kind === 'guhuo-setup') {
          yuji.directgain([probe.cards.claim, probe.cards.privateYuji]);
          sunquan.directgain([probe.cards.privateOther]);
        } else if (event.kind === 'yanxi-setup') {
          sunquan.directgain([probe.cards.targetOne, probe.cards.targetTwo]);
          yuji.directgain([probe.cards.yanxiPrivateYuji]);
          ui.cardPile.insertBefore(probe.cards.topTwo.fix(), ui.cardPile.firstChild);
          ui.cardPile.insertBefore(probe.cards.topOne.fix(), ui.cardPile.firstChild);
          ui.ordering.appendChild(probe.cards.privateOrdering);
          game.log(wangyuanji, '私有排序边界测试', [probe.cards.privateOrdering]);
          game.updateRoundNumber();
        }
        return;
      }
      if (event.kind === 'huashen') {
        _status.currentPhase = zuoci;
        // Initial dealing precedes phaseBefore in the native adapter.
        await event.trigger(
          zuoci.storage.rehuashen.character.length ? 'phaseBegin' : 'phaseBefore',
        );
        probe.huashenChosen =
          !!zuoci.storage.rehuashen.current && !!zuoci.storage.rehuashen.current2;
        probe.huashenCount = zuoci.storage.rehuashen.character.length;
      }
      if (event.kind === 'guhuo') {
        _status.currentPhase = yuji;
        probe.beforeChallengeDraw = zuoci.countCards('h');
        await yuji.phaseUse();
        probe.falseClaimDiscarded = get.position(probe.cards.claim) === 'd';
        probe.challengeDrew = zuoci.countCards('h') > probe.beforeChallengeDraw;
      }
      if (event.kind === 'yanxi') {
        _status.currentPhase = wangyuanji;
        await wangyuanji.phaseUse();
        probe.yanxiGained = probe.yanxiShown.every((card) =>
          wangyuanji.getCards('h').includes(card),
        );
        probe.yanxiOtherHandRemains = sunquan.countCards('h') === 1;
      }
    });
    _status.eventManager.rootEvent = event;
    void event.start().then(
      () => {
        probe.done = true;
      },
      () => {
        probe.error = true;
      },
    );
  }, kind);
}

async function huashenPrivate(index, allowEmpty = false) {
  const aggregate = await frames[index].evaluate(() => {
    const owner = partyEngine.game.players.find((player) => player.name === 're_zuoci');
    const value = owner.storage.rehuashen;
    return {
      exists: !!value,
      listCount: value?.character?.length ?? -1,
      onlyUnknown: value?.character?.every((name) => name === 'unknown') ?? false,
      mapCount: Object.keys(value?.map || {}).length,
      chosenCount: (value?.choosed || []).length,
    };
  });
  if (!(
    aggregate.exists &&
    (aggregate.listCount === 3 || (allowEmpty && aggregate.listCount === 0)) &&
    aggregate.onlyUnknown &&
    aggregate.mapCount === 0 &&
    aggregate.chosenCount === 0
  ))
    console.log(JSON.stringify({ boundary: 'rehuashen', ...aggregate }));
  assert.equal(
    await frames[index].evaluate((allowEmpty) => {
      const owner = partyEngine.game.players.find((player) => player.name === 're_zuoci');
      const value = owner.storage.rehuashen;
      return (
        Array.isArray(value?.character) &&
        (value.character.length === 3 || (allowEmpty && value.character.length === 0)) &&
        value.character.every((name) => name === 'unknown') &&
        Object.keys(value.map || {}).length === 0 &&
        (value.choosed || []).length === 0
      );
    }, allowEmpty),
    true,
    'Nonowner huashen state contains only counts and public current selection',
  );
}

async function hiddenPrivate(index, ownerId) {
  assert.equal(
    await frames[index].evaluate((ownerId) => {
      const { lib } = partyEngine;
      const player = lib.playerOL[ownerId];
      const definition = lib.character[player.name1];
      return (
        player.name1 === `party_hidden_${ownerId}` &&
        player.name !== 'jin_wangyuanji' &&
        player.isUnseen(0) &&
        player.hp === 1 &&
        player.maxHp === 1 &&
        definition?.hasHiddenSkill &&
        definition.skills.length === 0 &&
        !(player.hiddenSkills || []).some((skill) => ['yanxi', 'shiren'].includes(skill)) &&
        !(player.invisibleSkills || []).some((skill) => ['yanxi', 'shiren'].includes(skill)) &&
        (player.storage.rawHp === undefined || player.storage.rawHp === 1) &&
        (player.storage.rawMaxHp === undefined || player.storage.rawMaxHp === 1)
      );
    }, ownerId),
    true,
    'Opponent initial and reinit state contains only a synthetic unseen definition',
  );
}

async function guhuoPrivate(index, materialId) {
  await concealed(index, [materialId]);
  const aggregate = await frames[index].evaluate(() => {
    let event = partyEngine._status.event;
    const names = [];
    let fakePresent = false;
    const visited = new Set();
    for (let depth = 0; event && depth < 32 && !visited.has(event); depth++) {
      visited.add(event);
      if (typeof event.name === 'string') names.push(event.name);
      if (event.name === 'reguhuo_guess') fakePresent = Object.hasOwn(event, 'fake');
      event = event._modparent || event.parent;
    }
    return { seenChallenge: names.includes('reguhuo_guess'), fakePresent, ancestors: names };
  });
  if (aggregate.fakePresent) console.log(JSON.stringify({ boundary: 'reguhuo', ...aggregate }));
  assert.equal(
    await frames[index].evaluate(() => {
      let event = partyEngine._status.event;
      const visited = new Set();
      for (let depth = 0; event && depth < 32 && !visited.has(event); depth++) {
        visited.add(event);
        if (event.name === 'reguhuo_guess') {
          if (Object.hasOwn(event, 'fake')) return false;
        }
        event = event._modparent || event.parent;
      }
      // Native chooseButtonOL sends a remote chooser rather than a serialized
      // guess parent. Absence of that secret parent is the expected boundary.
      return true;
    }),
    true,
    'Opponent native challenge ancestry does not contain the hidden truth flag',
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
  const created = await request(phones[0], '/api/rooms', 'POST', { nickname: 'OL技能验证' });
  const code = created.room.code;
  await phones[0].goto(`${base}/join/${code}`);
  await request(phones[0], `/api/rooms/${code}`, 'PUT', {
    mode: 'versus',
    playerCount: 4,
    generalPreset: 'ol-ranked-2026-10-full',
    allowGeneralSelection: true,
    extensions: [],
  });
  for (let index = 1; index < 4; index++) {
    await phones[index].goto(`${base}/join/${code}`);
    await phones[index].locator('#nickname').fill(`OL验证${index}`);
    await phones[index].locator('#join-button')[gesture]();
  }
  const generals = ['re_zuoci', 'xin_yuji', 'jin_wangyuanji', 'sunquan'];
  for (const [index, general] of generals.entries())
    await request(phones[index], `/api/rooms/${code}/me/general`, 'PUT', { general });
  for (const phone of phones) await phone.locator('#ready-button')[gesture]();
  await phones[0].locator('#start-button')[gesture]();
  matchId = party.lobby.get(code).snapshot().matchId;
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
  assert.equal(
    await worker.evaluate(
      (generals) =>
        partyEngine.game.players.every(
          (player, index) => player.name1 === generals[index] && player.countCards('h') >= 4,
        ),
      generals,
    ),
    true,
    'Four real native selections and starting hands precede fixture setup',
  );
  results.push({ fixture: 'real-selection-dealing', passed: true, players: 4 });
  for (const index of [0, 1, 3]) {
    const trace = phones[index].olNativeTrace;
    assert.equal(
      trace.hiddenInitCount > 0 && trace.jinInitCount === 0 && trace.concealedDefinitionOnly,
      true,
      'Actual opponent initial transport broadcasts contain only the synthetic hidden definition',
    );
  }
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
      claim: game.createCard('shan', 'diamond', 9),
      privateYuji: game.createCard('wuxie', 'club', 6),
      privateOther: game.createCard('tao', 'heart', 4),
      yanxiPrivateYuji: game.createCard('wuxie', 'spade', 8),
      targetOne: game.createCard('sha', 'club', 11),
      targetTwo: game.createCard('shan', 'heart', 7),
      topOne: game.createCard('guohe', 'spade', 3),
      topTwo: game.createCard('tiesuo', 'club', 12),
      privateOrdering: game.createCard('sha', 'diamond', 1),
    };
    globalThis.partyOlProbe = { cards, done: true, yanxiShown: [] };
    const log = game.log;
    game.log = function (...args) {
      if (
        _status.event.name === 'yanxi' &&
        args.length === 3 &&
        args[1] === '展示了' &&
        Array.isArray(args[2]) &&
        args[2].length === 3
      )
        partyOlProbe.yanxiShown = args[2].slice();
      return log.apply(this, args);
    };
    return {
      players: game.players.map((player) => player.playerid),
      cards: Object.fromEntries(Object.entries(cards).map(([name, card]) => [name, card.cardid])),
    };
  });
  for (const [index, phone] of phones.entries()) {
    await phone.reload();
    frames[index] = await table(phone);
  }

  await progress('hidden-character-initial-and-fresh-reinit');
  for (const index of [0, 1, 3]) await hiddenPrivate(index, ids.players[2]);
  const oldPhone = phones[0];
  const storageState = await oldPhone.context().storageState();
  await oldPhone.context().close();
  phones[0] = await page(true, storageState);
  await phones[0].goto(`${base}/join/${code}`);
  frames[0] = await table(phones[0]);
  await hiddenPrivate(0, ids.players[2]);
  await stage('hidden-reveal');
  await finish({ drain: true });
  assert.equal(
    await worker.evaluate(() => partyOlProbe.hiddenPreserved),
    true,
    'Native reveal preserves existing hand and unrelated storage',
  );
  const revealed = await worker.evaluate(() => ({
    hp: partyOlProbe.revealedHp,
    maxHp: partyOlProbe.revealedMaxHp,
  }));
  for (const index of [0, 1, 2, 3]) {
    await frames[index].waitForFunction(
      ({ ownerId, hp, maxHp }) => {
        const player = partyEngine.lib.playerOL[ownerId];
        return (
          player.name === 'jin_wangyuanji' &&
          player.name1 === 'jin_wangyuanji' &&
          !player.isUnseen(0) &&
          player.hp === hp &&
          player.maxHp === maxHp &&
          player.node.avatar.style.backgroundImage.includes('jin_wangyuanji')
        );
      },
      { ownerId: ids.players[2], ...revealed },
    );
  }
  results.push({
    fixture: 'jin-hidden-character',
    passed: true,
    initialSyntheticShell: true,
    initialTransportRedaction: true,
    freshContextReinit: true,
    nativeReveal: true,
    handAndStoragePreserved: true,
  });

  await stage('huashen');
  const initialChoice = await frames[0].waitForFunction(
    () =>
      ['chooseButton', 'chooseControl'].includes(partyEngine._status.event.name) &&
      partyEngine._status.paused,
  );
  await initialChoice.dispose();
  if (await control(frames[0], '替换当前化身').isVisible())
    await control(frames[0], '替换当前化身')[gesture]();
  await choice(0, 'chooseButton');
  assert.equal(
    await frames[0].evaluate(
      () =>
        partyEngine.game.me.storage.rehuashen.character.length === 3 &&
        partyEngine.game.me.storage.rehuashen.character.every((name) => name !== 'unknown'),
    ),
    true,
    'Huashen owner sees the three native private candidates',
  );
  for (const index of [1, 2, 3]) await huashenPrivate(index);
  await phones[1].reload();
  frames[1] = await table(phones[1]);
  // Native arena reinit omits storage for nonpending players, so this mirror
  // may contain the skill's empty initial storage; it must never contain names.
  await huashenPrivate(1, diagnostic);
  await renew(0, 'chooseButton');
  await frames[0]
    .locator('.dialog:not(.removing) .button.selectable:not(.nodisplay)')
    .first()
    [gesture]();
  await control(frames[0], '确定')[gesture]();
  await choice(0, 'chooseControl');
  await frames[0]
    .locator('.control:not(.removing) > div')
    .filter({ hasNotText: /^返回$/ })
    .first()
    [gesture]();
  await finish();
  assert.equal(
    await worker.evaluate(() => partyOlProbe.huashenChosen && partyOlProbe.huashenCount === 3),
    true,
    'Native huashen publishes the chosen current character and skill',
  );
  for (const index of [1, 2, 3]) await huashenPrivate(index, diagnostic && index === 1);
  if (!diagnostic) {
    await progress('huashen-completed-owner-and-opponent-reinit');
    const expected = await worker.evaluate(() => {
      const storage = partyEngine.game.players[0].storage.rehuashen;
      return {
        character: storage.character.slice(),
        map: storage.map,
        choosed: storage.choosed.slice(),
        current: storage.current,
        current2: storage.current2,
      };
    });
    await phones[0].reload();
    frames[0] = await table(phones[0]);
    assert.equal(
      await frames[0].evaluate((expected) => {
        const storage = partyEngine.game.me.storage.rehuashen;
        const entries = (value) =>
          Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b));
        return (
          JSON.stringify(storage.character) === JSON.stringify(expected.character) &&
          JSON.stringify(storage.choosed) === JSON.stringify(expected.choosed) &&
          JSON.stringify(entries(storage.map)) === JSON.stringify(entries(expected.map)) &&
          storage.current === expected.current &&
          storage.current2 === expected.current2
        );
      }, expected),
      true,
      'Completed huashen owner reinit preserves private candidates and the active skill',
    );
    await phones[1].reload();
    frames[1] = await table(phones[1]);
    await huashenPrivate(1);
    assert.equal(
      await frames[1].evaluate(
        ({ ownerId, current, current2 }) => {
          const player = partyEngine.lib.playerOL[ownerId];
          return (
            player.storage.rehuashen.current === current &&
            player.storage.rehuashen.current2 === current2 &&
            player.marks.rehuashen?.markcount?.textContent.trim() === '3'
          );
        },
        { ownerId: ids.players[0], current: expected.current, current2: expected.current2 },
      ),
      true,
      'Opponent reinit restores only the public active transformation, skill, and count mark',
    );
  }
  results.push({
    fixture: 'rehuashen',
    passed: true,
    privateCandidates: 3,
    ownerReconnect: true,
    opponentReconnect: true,
    completedOwnerReconnect: !diagnostic,
    completedOpponentReconnect: !diagnostic,
  });

  await stage('guhuo-setup');
  await finish({ drain: true });
  const guhuoHistoryBase =
    (await request(phones[0], `/engine/history/${matchId}`, 'GET')).entries.at(-1)?.sequence ?? 0;
  await stage('guhuo');
  await choice(1, 'chooseToUse');
  for (const index of [0, 2, 3]) await concealed(index, [ids.cards.claim, ids.cards.privateYuji]);
  await control(frames[1], '蛊惑')[gesture]();
  await choice(1, 'chooseButton');
  await dialogButton(1, 'virtual', 'wuzhong');
  await choice(1, 'chooseToUse');
  await material(1, ids.cards.claim);
  assert.equal(
    await worker.evaluate(() => partyOlProbe.done),
    false,
    'Guhuo material selection waits for native confirmation',
  );
  await control(frames[1], '确定')[gesture]();
  for (const index of [0, 2, 3]) {
    await choice(index, 'chooseButton');
    await guhuoPrivate(index, ids.cards.claim);
  }
  const claimFace = await worker.evaluate(() =>
    partyEngine.get.translation(partyOlProbe.cards.claim),
  );
  assert.equal(
    await frames[0].evaluate(
      async ({ matchId, base, face }) => {
        const history = await (await fetch(`/engine/history/${matchId}`)).json();
        return !history.entries.some((entry) => entry.sequence > base && entry.text.includes(face));
      },
      { matchId, base: guhuoHistoryBase, face: claimFace },
    ),
    true,
    'Public history does not reveal the bluff material before challenges resolve',
  );
  if (!diagnostic) {
    await renew(0, 'chooseButton');
    await guhuoPrivate(0, ids.cards.claim);
  }
  await dialogButton(0, 'virtual', 'reguhuo_betray');
  for (const index of [2, 3]) await dialogButton(index, 'virtual', 'reguhuo_ally');
  for (const index of [0, 2, 3]) await publicCards(index, [ids.cards.claim]);
  await finish({ drain: true });
  assert.equal(
    await worker.evaluate(() => partyOlProbe.falseClaimDiscarded && partyOlProbe.challengeDrew),
    true,
    'Actual challenge reveals the false material, cancels the claim, and draws for the challenger',
  );
  for (const index of [0, 2, 3]) await concealed(index, [ids.cards.privateYuji]);
  const guhuoLog = await frames[0].evaluate(
    async ({ matchId, materialId, base }) => {
      const response = await fetch(`/engine/history/${matchId}`);
      const history = await response.json();
      const face = partyEngine.get.translation(partyEngine.lib.cardOL[materialId]);
      return history.entries.some((entry) => entry.sequence > base && entry.text.includes(face));
    },
    { matchId, materialId: ids.cards.claim, base: guhuoHistoryBase },
  );
  assert.equal(guhuoLog, true, 'Native public history includes the challenged material face');
  results.push({
    fixture: 'reguhuo',
    passed: true,
    truthHiddenBeforeChallenge: true,
    materialHiddenBeforeChallenge: true,
    reconnect: !diagnostic,
    actualChallengeReveal: true,
    publicHistory: true,
  });

  await stage('yanxi-setup');
  await finish({ drain: true });
  const yanxiHistoryBase =
    (await request(phones[0], `/engine/history/${matchId}`, 'GET')).entries.at(-1)?.sequence ?? 0;
  await stage('yanxi');
  await choice(2, 'chooseToUse');
  await control(frames[2], '宴戏')[gesture]();
  await target(2, ids.players[3]);
  await control(frames[2], '确定')[gesture]();
  await choice(2, 'chooseButton');
  const shown = await worker.evaluate(() => ({
    cards: partyOlProbe.yanxiShown.map((card) => card.cardid),
    answer: partyOlProbe.yanxiShown.find((card) =>
      partyEngine.game.players[3].getCards('h').includes(card),
    )?.cardid,
    remaining: partyEngine.game.players[3]
      .getCards('h')
      .filter((card) => !partyOlProbe.yanxiShown.includes(card))
      .map((card) => card.cardid),
  }));
  assert.equal(shown.cards.length, 3, 'Native yanxi publishes exactly three materials');
  assert.equal(shown.remaining.length, 1, 'Yanxi target retains an unrelated concealed hand card');
  for (const index of [0, 1, 2, 3]) await publicCards(index, shown.cards);
  for (const index of [0, 1, 2]) await concealed(index, shown.remaining);
  for (const index of [0, 2, 3])
    await concealed(index, [ids.cards.yanxiPrivateYuji, ids.cards.privateOrdering]);
  if (!diagnostic) {
    await renew(2, 'chooseButton');
    await publicCards(2, shown.cards);
    await concealed(2, shown.remaining);
    await phones[0].reload();
    frames[0] = await table(phones[0]);
    await publicCards(0, shown.cards);
    await concealed(0, [...shown.remaining, ids.cards.yanxiPrivateYuji, ids.cards.privateOrdering]);
  }
  await dialogButton(2, 'material', shown.answer);
  await finish({ drain: true });
  assert.equal(
    await worker.evaluate(() => partyOlProbe.yanxiGained && partyOlProbe.yanxiOtherHandRemains),
    true,
    'Native correct yanxi answer gains exactly the three shown cards',
  );
  const yanxiLog = await frames[0].evaluate(
    async ({ matchId, cards, base }) => {
      const history = await (await fetch(`/engine/history/${matchId}`)).json();
      const faces = cards.map((id) => partyEngine.get.translation(partyEngine.lib.cardOL[id]));
      return {
        publicFaces: faces.every((face) =>
          history.entries.some((entry) => entry.sequence > base && entry.text.includes(face)),
        ),
        privateOrdering: history.entries.some(
          (entry) => entry.text.includes('私有排序边界测试') && entry.text.includes('暗牌'),
        ),
      };
    },
    { matchId, cards: shown.cards, base: yanxiHistoryBase },
  );
  assert.equal(
    yanxiLog.publicFaces && yanxiLog.privateOrdering,
    true,
    'History exposes the three yanxi faces and conceals unrelated ordering material',
  );
  for (const index of [0, 1, 2]) await concealed(index, shown.remaining);
  results.push({
    fixture: 'yanxi',
    passed: true,
    publicMaterials: 3,
    ownerReconnect: !diagnostic,
    observerReconnect: !diagnostic,
    actualGain: true,
    unrelatedHandHidden: true,
    privateOrderingHidden: true,
    publicHistory: true,
  });
  assert.equal(failures.length, 0, 'Independent native service reports no failures');
  assert.equal(faults.length, 0, 'Real player browsers report no native exceptions');
  assert.equal(missing.size, 0, 'All requested engine materials are available');
  const summary = {
    passed: true,
    diagnostic,
    desktop,
    http,
    results,
    failures,
    faults,
    missing: [...missing],
  };
  await writeFile(`${output}/result.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  console.log(output);
} catch (error) {
  const summary = {
    passed: false,
    stage: currentStage,
    errorType: error.name,
    locations: String(error.stack || '')
      .split('\n')
      .filter((line) => /^\s+at /.test(line))
      .slice(0, 4),
    native: await worker
      ?.evaluate(() => ({
        event: partyEngine._status.event.name,
        paused: partyEngine._status.paused,
        done: !!globalThis.partyOlProbe?.done,
        eventError: !!globalThis.partyOlProbe?.error,
        errorCount: partyEngine.proof.errors.length,
        dialogType: typeof partyEngine._status.event.dialog,
        hasDialogVideoId: typeof partyEngine._status.event.dialog?.videoId === 'number',
        yanxiParent: partyEngine._status.event.getParent?.('yanxi')?.name === 'yanxi',
      }))
      .catch(() => null),
    choices: await Promise.all(
      frames.map((frame) =>
        frame
          .evaluate(() => ({
            event: partyEngine._status.event.name,
            paused: partyEngine._status.paused,
            buttonCount: (partyEngine._status.event.dialog?.buttons || []).length,
            controlCount: document.querySelectorAll('.control:not(.removing) > div').length,
          }))
          .catch(() => null),
      ),
    ),
    results,
    failures,
    faults,
    missing: [...missing],
  };
  await writeFile(`${output}/failure.json`, JSON.stringify(summary, null, 2));
  console.error(JSON.stringify(summary));
  console.error(output);
  process.exitCode = 1;
} finally {
  adapter.close();
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
  party.closeStreams();
  party.server.closeAllConnections();
  await new Promise((resolve) => party.server.close(resolve));
}
