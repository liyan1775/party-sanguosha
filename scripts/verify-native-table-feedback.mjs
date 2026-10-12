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
const openingEquipment = process.env.ENGINE_VERIFY_TABLE_PUYUAN === '1';
const adapterAudit = process.env.ENGINE_VERIFY_ADAPTER_AUDIT === '1';
const gesture = desktop ? 'click' : 'tap';
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const output = `.runtime/native-table-feedback/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
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
  await worker.waitForFunction(() => partyTableProbe.done || partyTableProbe.error, null, {
    timeout: 20000,
  });
  assert.equal(await worker.evaluate(() => partyTableProbe.error), undefined);
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
  await phones[0].waitForFunction(async (code) => {
    const response = await fetch(`/api/rooms/${code}`);
    const { room } = await response.json();
    return room.players.every((player) => player.ready && player.online);
  }, code);
  const opening = phones[0].waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/rooms/${code}/start`,
    { timeout: 120000 },
  );
  await phones[0].locator('#start-button')[gesture]();
  for (const phone of phones) frames.push(await table(phone));
  await progress(`${mode}-phones-booted`);
  const matchId = party.lobby.get(code).snapshot().matchId;
  worker = computer.frames().find((frame) => frame.url().includes(`/engine/worker/${matchId}`));
  assert(worker, 'the current match has an attached rule worker');
  await progress(`${mode}-native-selection`);
  await Promise.all(frames.map((frame) => chooseGeneral(frame, worker, { mouse: desktop })));
  await worker.waitForFunction(() => partyEngine.proof.started && partyEngine._status.paused);
  const response = await opening;
  assert(response.ok(), await response.text());
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
    globalThis.partyTableProbe = { done: true };
  });
  for (const [i, phone] of (openingEquipment || adapterAudit ? [] : phones).entries()) {
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
    const { game, lib, _status } = partyEngine;
    const probe = partyTableProbe;
    probe.done = false;
    const event = new lib.element.GameEvent(
      ['huashen', 'puyuan-opening'].includes(kind) ? 'phase' : 'partyTableFixture',
      false,
      _status.eventManager,
    );
    event.player = game.players[0];
    event.kind = kind;
    event.setContent(async function (event) {
      const { game, ui, get } = partyEngine,
        probe = partyTableProbe;
      const [actor, target] = game.players;
      if (event.kind === 'equipment') {
        const equipment = game.createCard('bagua', 'spade', 2);
        await target.equip(equipment);
        probe.equipment = equipment.cardid;
        probe.target = target.playerid;
        const result = await actor
          .chooseTarget('选择装备牌所在武将', true, (_card, player, target) => player !== target)
          .forResult();
        probe.targetChosen = result.targets?.[0] === target;
      }
      if (event.kind === 'card-target') {
        const card = game.createCard('sha', 'spade', 7);
        actor.directgain([card]);
        probe.material = card.cardid;
        await actor.chooseToUse().set('type', 'phase');
      }
      if (event.kind === 'deck') {
        await actor.draw(1);
        game.roundNumber = 3;
        game.updateRoundNumber();
      }
      if (event.kind === 'huashen') {
        _status.currentPhase = actor;
        await event.trigger('phaseBefore');
        probe.huashenChosen = !!actor.storage.huashen.current2;
      }
      if (event.kind === 'puyuan-opening') {
        _status.currentPhase = actor;
        await event.trigger('phaseBefore');
        probe.openingEquipment = actor.getCards('e').map((card) => ({
          id: card.cardid,
          name: card.name,
          label: get.translation(card.name),
        }));
      }
      if (event.kind === 'puyuan-private-equipment') {
        probe.privateEquipment = get.cardPile((card) => get.type(card) === 'equip');
        await actor.gain(probe.privateEquipment);
      }
      if (event.kind === 'puyuan-replacement') await actor.equip(probe.privateEquipment);
      if (event.kind === 'audit-moves') {
        await actor.draw(2);
        const materials = actor.getCards('h').slice(0, 4);
        if (materials.length !== 4) throw new Error('audit requires four native starting cards');
        probe.audit = { actor: actor.playerid, target: target.playerid };
        await actor.addJudge('lebu', [materials[0]]);
        const judgment = actor.getCards('j')[0];
        probe.audit.judgment = { id: judgment.cardid, name: judgment.name };
        await target.gain(materials[1], actor, 'give');
        probe.audit.gain = { id: materials[1].cardid, name: materials[1].name };
        await actor.addToExpansion(materials[2], actor, 'give');
        probe.audit.expansion = { id: materials[2].cardid, name: materials[2].name };
        const batches = [
          [actor, [actor.getCards('h').find((card) => !materials.includes(card))]],
          [target, [target.getCards('h').find((card) => card !== materials[1])]],
        ];
        await game
          .loseAsync({ lose_list: batches, animate: 'give' })
          .setContent('addToExpansionMultiple');
        probe.audit.batches = batches.map(([player, [card]]) => ({
          owner: player.playerid,
          id: card.cardid,
          name: card.name,
        }));
        await actor.equip(get.autoViewAs({ name: 'bagua' }, [materials[3]]));
        const equipment = actor.getCards('e')[0];
        probe.audit.equipment = { id: equipment.cardid, name: equipment.name };
      }
      if (event.kind === 'audit-public-pool') {
        const cards = get.cards(3);
        await game.cardsGotoOrdering(cards);
        const shown = actor.showCards(cards, '接入层公开展示验证').set('closeDialog', false);
        await shown;
        probe.audit.poolId = shown.videoId;
        probe.audit.pool = cards.map((card) => ({ id: card.cardid, name: card.name }));
        const result = await actor
          .chooseButton(true)
          .set('dialog', shown.videoId)
          .set('closeDialog', false)
          .forResult();
        probe.audit.poolChoice = cards.includes(result.links?.[0]);
        game.broadcastAll('closeDialog', shown.videoId);
      }
      if (event.kind === 'audit-wugu') {
        _status.currentPhase = actor;
        await actor.useCard(game.createCard('wugu', 'heart', 3), game.players);
      }
      if (event.kind === 'guhuo-setup') {
        for (const player of game.players) {
          player.stat.push({ card: {}, skill: {}, triggerSkill: {} });
          if (player.countCards('h')) await player.lose(player.getCards('h'), ui.discardPile);
        }
        probe.claim = game.createCard('sha', 'spade', 7);
        probe.other = game.createCard('shan', 'heart', 2);
        actor.directgain([probe.claim, probe.other]);
      }
      if (event.kind === 'guhuo') {
        _status.currentPhase = actor;
        probe.beforeChallengeDraw = target.countCards('h');
        const originalBroadcast = game.broadcastAll;
        probe.flips = [];
        game.broadcastAll = function (...args) {
          if (typeof args[0] === 'function' && String(args[0]).includes('old_guhuoNode')) {
            const current = get.event();
            probe.flips.push({
              event: current?.name,
              match: /_status\.old_guhuoNode\.listenTransition\(onEnd,\s*300\)/.test(
                String(args[0]),
              ),
              callbackSame: args[1] === current?.onEnd01,
              cardCount: current?._trigger?.cards?.length,
            });
          }
          return originalBroadcast.apply(this, args);
        };
        try {
          await actor.phaseUse();
        } finally {
          game.broadcastAll = originalBroadcast;
        }
        probe.falseClaimDiscarded = get.position(probe.claim) === 'd';
        probe.challengeDrew = target.countCards('h') > probe.beforeChallengeDraw;
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

async function equipmentClick() {
  await frames[0].waitForFunction(() =>
    partyEngine.game.players.some(
      (player) =>
        player.classList.contains('selectable') &&
        player.node.equips.querySelector('.card:not(.emptyequip):not(.hidden)'),
    ),
  );
  await frames[0].evaluate(() => {
    const player = partyEngine.game.players.find(
      (player) =>
        player.classList.contains('selectable') &&
        player.node.equips.querySelector('.card:not(.emptyequip):not(.hidden)'),
    );
    player.node.equips.querySelector(
      '.card:not(.emptyequip):not(.hidden)',
    ).dataset.targetEquipment = 'true';
  });
  // Native target-only choices intentionally pass equipment pointer events to
  // their owner. Click the visible equipment's position in either native mode.
  await wait(600);
  const rect = await frames[0].locator('[data-target-equipment="true"]').first().boundingBox();
  assert(rect);
  const input = desktop ? phones[0].mouse : phones[0].touchscreen;
  await input[gesture](rect.x + rect.width / 2, rect.y + rect.height / 2);
  await frames[0].waitForFunction(() =>
    partyEngine.ui.selected.targets.some((player) =>
      player.node.equips.querySelector('[data-target-equipment="true"]'),
    ),
  );
}

async function deckVisible() {
  const expected = await worker.evaluate(() => ({
    round: partyEngine.game.roundNumber,
    count: partyEngine.ui.cardPile.childElementCount,
  }));
  for (let i = 0; i < frames.length; i++) {
    await frames[i].waitForFunction(
      ({ round, count }) =>
        document.querySelector('#party-table-count')?.textContent === `${round}轮 剩余牌: ${count}`,
      expected,
    );
    assert(await frames[i].locator('#party-table-count').isVisible());
    assert.equal(await phones[i].locator('#match-deck').count(), 0);
  }
}

async function flowers(mode) {
  const frame = frames[0];
  await frame.evaluate(() => {
    const target = partyEngine.game.players.find((player) => player !== partyEngine.game.me);
    partyEngine.ui.click.intro.call(target, { clientX: 300, clientY: 130 });
  });
  const flower = frame
    .locator('.popped .menubutton')
    .filter({ hasText: /^鲜花$/ })
    .first();
  const send = async () => {
    await frame.evaluate(() => {
      for (const node of document.querySelectorAll('.party-emotion'))
        node.dataset.tableGiftPrevious = 'true';
    });
    await flower[gesture]();
    await frame.waitForFunction(() =>
      document.querySelector('.party-emotion:not([data-table-gift-previous])'),
    );
  };
  for (let i = 0; i < 2; i++) {
    await send();
    const position = () =>
      frame.evaluate(() => {
        const node = [...document.querySelectorAll('.party-emotion')].at(-1);
        const rect = node.getBoundingClientRect();
        const animation = node.getAnimations()[0];
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          time: animation?.currentTime,
          frames: animation?.effect.getKeyframes().length,
        };
      });
    const before = await position();
    await wait(220);
    const during = await position();
    assert(
      Math.hypot(before.x - during.x, before.y - during.y) > 10,
      'flower actually travels across the seated Edge table',
    );
    assert(during.time > 0 && during.frames === 3);
    await wait(700);
    const arrived = await frame.evaluate(() => {
      const node = [...document.querySelectorAll('.party-emotion')].at(-1).getBoundingClientRect();
      const target = partyEngine.game.players
        .find((player) => player !== partyEngine.game.me)
        .getBoundingClientRect();
      return (
        Math.hypot(
          node.x + node.width / 2 - target.x - target.width / 2,
          node.y + node.height / 2 - target.y - target.height / 2,
        ) < 5
      );
    });
    assert(arrived);
  }
  assert(await flower.isVisible(), 'repeat gifts keep the native menu open');
  await frames[1].waitForFunction(
    () => document.querySelector('.party-emotion-notice')?.dataset.count === '2',
  );
  await phones[0].emulateMedia({ reducedMotion: 'reduce' });
  await send();
  const fade = await frame.evaluate(() =>
    [...document.querySelectorAll('.party-emotion')]
      .at(-1)
      .getAnimations()[0]
      ?.effect.getKeyframes()
      .map((frame) => frame.opacity),
  );
  assert.deepEqual(fade, ['0', '1'], 'reduced motion retains a fade transition');
  await phones[0].emulateMedia({ reducedMotion: 'no-preference' });
  await phones[0].screenshot({ path: `${output}/${mode}.png` });
  await frame.evaluate(() => partyEngine._status.removePop?.());
  results.push({
    mode,
    flowerFlight: true,
    arrivesAtTarget: true,
    repeatedGift: true,
    receiverNotice: true,
    reducedMotionFade: true,
  });
}

async function oldHuashen() {
  await stage('huashen');
  await frames[0].locator('.dialog .button.selectable:not(.nodisplay)').first().waitFor();
  const names = await worker.evaluate(() =>
    Object.keys(partyEngine.game.players[0].storage.huashen.owned),
  );
  assert.equal(names.length, 2);
  const ownerId = await frames[0].evaluate(() => partyEngine.game.me.playerid);
  const privateState = async () => {
    for (const frame of frames.slice(1))
      assert.equal(
        await frame.evaluate(
          ({ ownerId, names }) => {
            const state = partyEngine.lib.playerOL[ownerId].storage.huashen;
            const text = JSON.stringify(state.owned);
            return (
              Object.keys(state.owned).length === 2 &&
              !names.some((name) => text.includes(name)) &&
              Object.values(state.owned).every((skills) => !skills.length)
            );
          },
          { ownerId, names },
        ),
        true,
      );
  };
  await privateState();
  const before = await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], ownerId);
  await phones[0].reload();
  frames[0] = await table(phones[0]);
  await frames[0].locator('.dialog .button.selectable:not(.nodisplay)').first().waitFor();
  assert.equal(
    await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], ownerId),
    before,
  );
  await frames[0].locator('.dialog .button.selectable:not(.nodisplay)').first()[gesture]();
  await frames[0]
    .locator('.control:not(.removing) > div')
    .filter({ hasNotText: /^(取消|确定)$/ })
    .first()
    [gesture]();
  await finish();
  assert.equal(await worker.evaluate(() => partyTableProbe.huashenChosen), true);
  for (let i = 0; i < 2; i++) {
    await phones[i].reload();
    frames[i] = await table(phones[i]);
    await frames[i].waitForFunction(() => partyEngine.game.me?.name && partyEngine.lib.cardOL);
  }
  await frames[0].waitForFunction(
    () => Object.keys(partyEngine.game.me.storage.huashen.owned).length === 2,
  );
  await privateState();
  results.push({
    oldHuashen: true,
    privateCandidates: 2,
    ownerAndOpponentReconnect: true,
    originalDeadlineRetained: true,
  });
}

async function oldGuhuo(matchId, version = 'yuji') {
  const nodeKey = version === 'yuji' ? 'old_guhuoNode' : 'guhuoNode';
  const guessName = version === 'yuji' ? 'old_guhuo_guess' : 'guhuo_guess';
  await stage('guhuo-setup');
  await finish();
  const ids = await worker.evaluate(() => [
    partyTableProbe.claim.cardid,
    partyTableProbe.other.cardid,
  ]);
  const initial = await request(phones[1], `/engine/history/${matchId}`, 'GET');
  const base = initial.entries.at(-1)?.sequence ?? 0;
  const choosing = async (index, name) =>
    frames[index].waitForFunction(
      (name) => partyEngine._status.event.name === name && partyEngine._status.paused,
      name,
    );
  const virtual = async (index, name) => {
    await frames[index].evaluate((name) => {
      for (const button of partyEngine._status.event.dialog.buttons)
        if (button.link?.[2] === name) button.dataset.tableBluffButton = 'true';
    }, name);
    await frames[index]
      .locator('.dialog:not(.removing) [data-table-bluff-button="true"].selectable')
      .first()
      [gesture]();
    await control(frames[index], '确定')[gesture]();
  };
  const concealed = async () => {
    await frames[1].waitForFunction(
      (ids) =>
        ids.every(
          (id) =>
            !partyEngine.lib.cardOL[id] || partyEngine.lib.cardOL[id].name === 'party_unknown',
        ),
      ids,
    );
    assert(
      await frames[1].evaluate((guessName) => {
        const visited = new Set();
        for (
          let event = partyEngine._status.event;
          event && !visited.has(event);
          event = event._modparent || event.parent
        ) {
          visited.add(event);
          if (event.name === guessName && Object.hasOwn(event, 'fake')) return false;
        }
        return true;
      }, guessName),
    );
  };
  await stage('guhuo');
  await choosing(0, 'chooseToUse');
  await control(frames[0], '蛊惑')[gesture]();
  await choosing(0, 'chooseButton');
  await virtual(0, 'wuzhong');
  await choosing(0, 'chooseToUse');
  await frames[0].evaluate((id) => {
    partyEngine.lib.cardOL[id].dataset.tableBluffMaterial = 'true';
  }, ids[0]);
  await frames[0]
    .locator('[data-table-bluff-material="true"].selectable')
    [gesture]({ position: { x: 8, y: 15 } });
  await control(frames[0], '确定')[gesture]();
  await choosing(1, 'chooseButton');
  await concealed();
  const face = await worker.evaluate(() => partyEngine.get.translation(partyTableProbe.claim));
  const history = await request(phones[1], `/engine/history/${matchId}`, 'GET');
  assert(!history.entries.some((entry) => entry.sequence > base && entry.text.includes(face)));
  await renew(1, 'chooseButton');
  await concealed();
  await virtual(1, 'reguhuo_betray');
  await frames[1].waitForFunction(
    ({ id, nodeKey }) =>
      partyEngine.lib.cardOL?.[id]?.name === 'sha' &&
      partyEngine._status[nodeKey]?.name === 'sha' &&
      !partyEngine._status[nodeKey].classList.contains('infohidden'),
    { id: ids[0], nodeKey },
  );
  await choosing(0, 'chooseToUse');
  await control(frames[0], '结束回合')[gesture]();
  await finish();
  assert(
    await worker.evaluate(
      (version) =>
        partyTableProbe.falseClaimDiscarded &&
        (version !== 'yuji' || partyTableProbe.challengeDrew),
      version,
    ),
  );
  await frames[1].waitForFunction(
    (id) => partyEngine.lib.cardOL[id]?.name === 'party_unknown',
    ids[1],
  );
  await phones[1].waitForFunction(
    async ({ matchId, base, face }) => {
      const history = await (await fetch(`/engine/history/${matchId}`)).json();
      return history.entries.some((entry) => entry.sequence > base && entry.text.includes(face));
    },
    { matchId, base, face },
  );
  results.push({
    oldGuhuo: true,
    version,
    privateUntilChallenges: true,
    reconnectOriginalDeadline: true,
    nativeFlipReveals: true,
    remainingHandPrivate: true,
    publicHistory: true,
  });
}

async function puyuanEquipment() {
  assert.equal(await worker.evaluate(() => partyEngine.game.players[0].name), 'ol_puyuan');
  await stage('puyuan-opening');
  await finish();
  const expected = await worker.evaluate(() => partyTableProbe.openingEquipment);
  assert.equal(expected.length, 2, 'native 奇思 installs two different equipment types');
  const actor = await worker.evaluate(() => partyEngine.game.players[0].playerid);
  const capture = async (tag) => {
    const snapshots = [];
    for (const [index, frame] of frames.entries()) {
      await frame.waitForFunction(
        ({ actor, ids }) =>
          ids.every((id) =>
            Array.from(partyEngine.lib.playerOL?.[actor]?.node?.equips?.children ?? []).some(
              (card) => card.cardid === id,
            ),
          ),
        { actor, ids: expected.map((entry) => entry.id) },
      );
      snapshots.push(
        await frame.evaluate(
          (actor) =>
            Array.from(partyEngine.lib.playerOL[actor].node.equips.children)
              .filter((card) => card.classList.contains('card'))
              .map((card) => ({
                id: card.cardid,
                name: card.name,
                text: card.node.name2.textContent,
                concealed:
                  card.classList.contains('party-concealed') ||
                  card.classList.contains('infohidden'),
                textDisplay: getComputedStyle(card.node.name2).display,
                textOpacity: getComputedStyle(card.node.name2).opacity,
              })),
          actor,
        ),
      );
      // Allow the native gain/give copies to finish before visual inspection.
      await wait(600);
      await phones[index].screenshot({ path: `${output}/${tag}-${index}.png` });
    }
    await writeFile(`${output}/${tag}.json`, JSON.stringify({ expected, snapshots }, null, 2));
    for (const snapshot of snapshots)
      for (const entry of expected) {
        const card = snapshot.find((card) => card.id === entry.id);
        assert.equal(card.name, entry.name, `${tag}: equipment has its public native name`);
        assert.equal(card.concealed, false, `${tag}: equipment is not visually concealed`);
        assert(card.text.includes(entry.label), `${tag}: equipment label is visible`);
        assert.notEqual(card.textDisplay, 'none');
        assert.notEqual(card.textOpacity, '0');
      }
  };
  await capture('puyuan-before-any-recovery');
  const assertHandPrivate = async () => {
    const ids = await worker.evaluate(() =>
      partyEngine.game.players[0].getCards('h').map((card) => card.cardid),
    );
    const hidden = await frames[1].evaluate(
      (ids) =>
        ids.every(
          (id) =>
            !partyEngine.lib.cardOL[id] || partyEngine.lib.cardOL[id].name === 'party_unknown',
        ),
      ids,
    );
    assert.equal(hidden, true, 'other hand cards stay private');
  };
  await assertHandPrivate();
  for (const [index, phone] of phones.entries()) {
    await phone.reload();
    frames[index] = await table(phone);
  }
  await capture('puyuan-after-recovery');
  await stage('puyuan-private-equipment');
  await finish();
  await assertHandPrivate();
  await stage('puyuan-replacement');
  await finish();
  const replacement = await worker.evaluate(() => {
    const card = partyTableProbe.privateEquipment;
    return { id: card.cardid, name: card.name, label: partyEngine.get.translation(card.name) };
  });
  expected.splice(0, expected.length, replacement);
  await capture('puyuan-later-direct-equipment');
  await assertHandPrivate();
  results.push({
    nativePuyuanOpening: true,
    initialEquipment: true,
    ownerAndOpponentLabels: true,
    recoveryMatches: true,
    laterDirectEquipment: true,
    remainingHandPrivate: true,
  });
}

async function auditAdapter(matchId) {
  await stage('audit-moves');
  await finish();
  const expected = await worker.evaluate(() => partyTableProbe.audit);
  const publicHands = [expected.gain.id];
  const assertPrivateHands = async () => {
    for (const frame of frames)
      assert.equal(
        await frame.evaluate((publicHands) => {
          const { game } = partyEngine;
          return game.players.every((player) =>
            player
              .getCards('h')
              .every((card) =>
                player === game.me
                  ? card.name !== 'party_unknown'
                  : publicHands.includes(card.cardid) || card.name === 'party_unknown',
              ),
          );
        }, publicHands),
        true,
        'own hands are usable; other undeclared hands stay concealed',
      );
  };
  const snapshots = [];
  for (const [index, frame] of frames.entries()) {
    await frame.waitForFunction(
      ({ actor, judgment, equipment }) =>
        partyEngine.lib.playerOL?.[actor]
          ?.getCards('j')
          .some((card) => card.cardid === judgment.id) &&
        partyEngine.lib.playerOL?.[actor]
          ?.getCards('e')
          .some((card) => card.cardid === equipment.id),
      expected,
    );
    snapshots.push(
      await frame.evaluate((expected) => {
        const { lib } = partyEngine;
        return Object.fromEntries(
          ['judgment', 'gain', 'expansion', 'equipment'].map((key) => {
            const card = lib.cardOL[expected[key].id];
            return [
              key,
              {
                present: !!card,
                faceMatches: card?.name === expected[key].name,
                concealed:
                  !card ||
                  card.classList.contains('party-concealed') ||
                  card.classList.contains('infohidden'),
              },
            ];
          }),
        );
      }, expected),
    );
    await phones[index].screenshot({ path: `${output}/adapter-audit-initial-${index}.png` });
  }
  let history;
  for (let attempt = 0; attempt < 20; attempt++) {
    history = await request(phones[0], `/engine/history/${matchId}`, 'GET');
    if (
      history.entries.length >= 5 &&
      history.entries.some((entry) => entry.text.includes('装备了'))
    )
      break;
    await wait(250);
  }
  await writeFile(
    `${output}/adapter-audit-initial.json`,
    JSON.stringify({ expected, snapshots, history }, null, 2),
  );
  assert(history.entries.length >= 5);
  assert(history.entries.some((entry) => entry.text.includes('装备了')));
  assert(
    history.entries.every((entry) => !entry.text.includes('暗牌')),
    'native public movement logs retain declared faces',
  );
  await assertPrivateHands();
  for (const snapshot of snapshots)
    for (const key of ['judgment', 'gain', 'expansion', 'equipment']) {
      assert.equal(snapshot[key].faceMatches, true, `${key}: initial public face matches`);
      assert.equal(snapshot[key].concealed, false, `${key}: initial public face is unmasked`);
    }
  const assertRecovered = async () => {
    for (const [index, phone] of phones.entries()) {
      await phone.reload();
      frames[index] = await table(phone);
      await frames[index].waitForFunction(({ actor, judgment, equipment }) => {
        const player = partyEngine.lib.playerOL?.[actor];
        return (
          player
            ?.getCards('j')
            .some((card) => card.cardid === judgment.id && card.name === judgment.name) &&
          player
            ?.getCards('e')
            .some((card) => card.cardid === equipment.id && card.name === equipment.name)
        );
      }, expected);
      const recovered = await frames[index].evaluate(({ actor, expansion, batches }) => {
        return [{ owner: actor, ...expansion }, ...batches].every(({ owner, id, name }) => {
          const card = partyEngine.lib.playerOL[owner]
            .getCards('x')
            .find((card) => card.cardid === id);
          return (
            !!card &&
            card.name === name &&
            !card.classList.contains('party-concealed') &&
            !card.classList.contains('infohidden')
          );
        });
      }, expected);
      assert.equal(recovered, true, 'public expansion keeps its face after recovery');
    }
    await assertPrivateHands();
  };
  for (const frame of frames)
    await frame.waitForFunction(
      (batches) =>
        batches.every(({ owner, id, name }) => {
          const card = partyEngine.lib.playerOL[owner]
            .getCards('x')
            .find((card) => card.cardid === id);
          return card?.name === name && !card.classList.contains('party-concealed');
        }),
      expected.batches,
    );
  await assertRecovered();
  await stage('audit-public-pool');
  await frames[0].waitForFunction(
    () => partyEngine._status.event.name === 'chooseButton' && partyEngine._status.paused,
  );
  const poolId = await worker.evaluate(() => partyTableProbe.audit.poolId);
  const recoverPool = async (pool, picker) => {
    const id = await frames[picker].evaluate(() => partyEngine.game.me.playerid);
    const before = await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id);
    assert.equal(typeof before, 'number');
    for (const [index, phone] of phones.entries()) {
      await phone.reload();
      frames[index] = await table(phone);
      await frames[index].waitForFunction(
        ({ id, cards }) => {
          const dialog = partyEngine.get.idDialog(id);
          return (
            dialog?.isConnected &&
            dialog.buttons.length === cards.length &&
            dialog.buttons.every(
              (button) =>
                cards.some(
                  (card) => card.id === button.link.cardid && card.name === button.link.name,
                ) &&
                !button.classList.contains('infohidden') &&
                !button.classList.contains('party-concealed'),
            )
          );
        },
        pool,
        { timeout: 5000 },
      );
    }
    assert.equal(
      await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id),
      before,
      'recovering public pools preserves the original choice deadline',
    );
    await frames[picker].waitForFunction(
      () => partyEngine._status.event.name === 'chooseButton' && partyEngine._status.paused,
    );
    await assertPrivateHands();
  };
  const pickPool = async (id, picker) => {
    await frames[picker].evaluate(
      (id) => (partyEngine.get.idDialog(id).dataset.auditPool = 'true'),
      id,
    );
    await frames[picker]
      .locator('[data-audit-pool="true"] .button.card.selectable')
      .first()
      [gesture]();
    await control(frames[picker], '确定')[gesture]();
  };
  const assertClosed = async (id) => {
    for (const frame of frames)
      await frame.waitForFunction((id) => !partyEngine.get.idDialog(id)?.isConnected, id);
    await phones[0].reload();
    frames[0] = await table(phones[0]);
    await frames[0].waitForFunction(
      (id) => partyEngine.game.me?.name && !partyEngine.get.idDialog(id)?.isConnected,
      id,
    );
  };
  await recoverPool(
    { id: poolId, cards: await worker.evaluate(() => partyTableProbe.audit.pool) },
    0,
  );
  await pickPool(poolId, 0);
  await finish();
  assert.equal(await worker.evaluate(() => partyTableProbe.audit.poolChoice), true);
  await assertClosed(poolId);
  await stage('audit-wugu');
  let wuguId;
  for (const picker of [0, 1]) {
    const until = Date.now() + 20000;
    let choosing = false;
    while (Date.now() < until && !choosing) {
      choosing = await frames[picker].evaluate(
        () => partyEngine._status.event.name === 'chooseButton' && partyEngine._status.paused,
      );
      if (choosing) break;
      for (const frame of frames)
        if (
          await frame.evaluate(
            () => partyEngine._status.event.name === 'chooseToUse' && partyEngine._status.paused,
          )
        )
          await control(frame, '取消')[gesture]();
      await wait(100);
    }
    assert.equal(choosing, true, 'native counterspell choices finish before the public pool pick');
    const pool = await worker.evaluate(() => {
      const { get } = partyEngine;
      const current = get.event().dialog;
      const dialog = typeof current === 'number' ? get.idDialog(current) : current;
      return {
        id: dialog.videoId,
        cards: dialog.buttons.map((button) => ({ id: button.link.cardid, name: button.link.name })),
      };
    });
    wuguId = pool.id;
    assert.equal(pool.cards.length, 3 - picker, 'native 五谷丰登 removes the previous pick');
    if (!picker) publicHands.push(...pool.cards.map((card) => card.id));
    await recoverPool(pool, picker);
    await pickPool(pool.id, picker);
  }
  const until = Date.now() + 20000;
  while (Date.now() < until && !(await worker.evaluate(() => partyTableProbe.done))) {
    for (const frame of frames)
      if (
        await frame.evaluate(
          () => partyEngine._status.event.name === 'chooseToUse' && partyEngine._status.paused,
        )
      )
        await control(frame, '取消')[gesture]();
    await wait(100);
  }
  await finish();
  await assertClosed(wuguId);
  await assertPrivateHands();
  results.push({
    adapterAudit: true,
    directJudgment: true,
    publicGain: true,
    publicExpansion: true,
    multipleExpansion: true,
    virtualEquipment: true,
    recoveryMatches: true,
    publicPools: true,
    nativeWuguRemainingPool: true,
    originalDeadlines: true,
    remainingHandPrivate: true,
    closedPoolNotRestored: true,
  });
}

try {
  computer = await page();
  await computer.goto(`${base}/server`);
  const cases = [
    ['duel', 'mobile-time-field-2026-10', ['huangzhong', 'old_xiaoqiao']],
    ['identity', 'mobile-time-field-2026-10', ['zuoci', 'liuxie', 'caocao', 'guanyu', 'sunjian']],
    ['doudizhu', 'mobile-time-field-2026-10', ['zhangxiu', 'liuxie', 're_huangzhong']],
    [
      'versus',
      'mobile-time-field-2026-10',
      ['mb_shen_caocao', 'zhangjiao', 'guansuo', 're_wangyun'],
    ],
    ['duel', 'ol-ranked-2026-10-basic', ['ol_sunjian', 're_huangzhong']],
    ['duel', 'mobile-time-field-2026-10', ['yuji', 'caocao']],
    ['duel', 'mobile-time-field-2026-10', ['re_yuji', 'caocao']],
  ];
  const selectedCases = adapterAudit
    ? [['doudizhu', 'advanced', ['caoren', 're_guanyu', 're_liubei']]]
    : openingEquipment
      ? [['duel', 'ol-ranked-2026-10-full', ['ol_puyuan', 're_huangzhong']]]
      : cases.filter(
          (entry) =>
            !process.env.ENGINE_VERIFY_TABLE_BLUFF ||
            entry[2][0] ===
              (process.env.ENGINE_VERIFY_TABLE_BLUFF === '1'
                ? 'yuji'
                : process.env.ENGINE_VERIFY_TABLE_BLUFF),
        );
  for (const [mode, preset, generals] of selectedCases) {
    const { code, matchId } = await start(computer, mode, preset, generals);
    if (adapterAudit) {
      await auditAdapter(matchId);
      for (const phone of phones) await phone.context().close();
      engine.release(code);
      continue;
    }
    if (openingEquipment) {
      await puyuanEquipment();
      for (const phone of phones) await phone.context().close();
      engine.release(code);
      continue;
    }
    await deckVisible();
    await stage('equipment');
    await equipmentClick();
    await control(frames[0], '确定')[gesture]();
    await finish();
    assert.equal(await worker.evaluate(() => partyTableProbe.targetChosen), true);
    await stage('card-target');
    await frames[0].waitForFunction(
      () => partyEngine._status.event.name === 'chooseToUse' && partyEngine._status.paused,
    );
    const material = await worker.evaluate(() => partyTableProbe.material);
    await frames[0].waitForFunction(
      (id) => partyEngine.lib.cardOL[id]?.classList.contains('selectable'),
      material,
    );
    await frames[0].evaluate((id) => {
      partyEngine.lib.cardOL[id].dataset.tableMaterial = 'true';
    }, material);
    await frames[0].locator('[data-table-material="true"]')[gesture]({ position: { x: 8, y: 15 } });
    await equipmentClick();
    await control(frames[0], '结束回合')[gesture]();
    await finish();
    await stage('deck');
    await finish();
    await deckVisible();
    await phones[0].reload();
    frames[0] = await table(phones[0]);
    await deckVisible();
    await flowers(mode);
    if (mode === 'identity') await oldHuashen();
    if (['yuji', 're_yuji'].includes(generals[0])) await oldGuhuo(matchId, generals[0]);
    results.push({
      mode,
      preset,
      realSelectionAndDealing: true,
      equipmentTarget: true,
      cardTarget: true,
      deckVisibleAfterDrawAndReconnect: true,
    });
    for (const phone of phones) await phone.context().close();
    engine.release(code);
  }
  assert.deepEqual(faults, []);
  assert.deepEqual([...missing], []);
  assert.deepEqual(engineEvents, []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        fixture: true,
        physicalPhone: false,
        browser: browser.version(),
        http,
        input: gesture,
        results,
        faults,
        missing: [...missing],
      },
      null,
      2,
    ),
  );
  console.log('原生牌桌反馈验证通过', output);
} catch (error) {
  const diagnostics = await Promise.all(
    frames.map(async (frame) => {
      try {
        return await frame.evaluate(() => ({
          role: partyEngine.setup.role,
          online: partyEngine.game.online,
          event: partyEngine._status.event?.name,
          hasCards: !!partyEngine.lib.cardOL,
          hasPlayers: !!partyEngine.lib.playerOL,
          flipConnected: !!partyEngine._status.old_guhuoNode?.isConnected,
          flipHidden: partyEngine._status.old_guhuoNode?.classList.contains('infohidden'),
          proofErrors: partyEngine.proof.errors,
        }));
      } catch {
        return { unavailable: true };
      }
    }),
  );
  let workerDiagnostic;
  try {
    workerDiagnostic = await worker?.evaluate(() => ({
      event: partyEngine._status.event?.name,
      errors: partyEngine.proof.errors,
      done: partyTableProbe?.done,
      fixtureError: partyTableProbe?.error,
      flips: partyTableProbe?.flips,
    }));
  } catch {}
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: error.stack,
        engineEvents,
        faults,
        missing: [...missing],
        diagnostics,
        workerDiagnostic,
      },
      null,
      2,
    ),
  );
  for (const [i, phone] of phones.entries())
    await phone.screenshot({ path: `${output}/failure-${i}.png` }).catch(() => {});
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
