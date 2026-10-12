import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { chooseGeneral } from './native-ui-actions.mjs';
import { verifyNativeFeedback } from './native-feedback-probes.mjs';

// Isolated skill fixtures supply known cards/tags and reset between scenarios.
// Native UI, choice serialization, skill rules and effects execute unchanged.
const root = fileURLToPath(new URL('../', import.meta.url));
const party = createPartyServer({
  webRoot: `${root}/dist/web`,
  port: 0,
  adapter: new NativeNonameService(root),
});
await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${party.server.address().port}`;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const output = `.runtime/native-skills/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
await mkdir(output, { recursive: true });
const contexts = [],
  faults = [],
  missing = new Set(),
  results = [];
const http = process.env.ENGINE_VERIFY_HTTP === '1';
const desktop = process.env.ENGINE_VERIFY_DESKTOP === '1';
const gesture = desktop ? 'click' : 'tap';
async function progress(value) {
  await writeFile(
    `${output}/progress.json`,
    JSON.stringify({ value, at: new Date().toISOString() }),
  );
}
async function page(mobile = false) {
  const context = await browser.newContext(
    mobile
      ? {
          viewport: { width: 844, height: 390 },
          isMobile: !desktop,
          hasTouch: !desktop,
        }
      : {},
  );
  contexts.push(context);
  if (mobile && http)
    await context.addInitScript(() => sessionStorage.setItem('party_http_transport', '1'));
  if (!mobile)
    await context.route('**/engine/runtime/mode.js', async (route) => {
      const response = await route.fetch();
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
  const page = await context.newPage();
  // The computer frame is hidden while other pages receive touch input. Poll
  // conditions by timer rather than its potentially suspended animation frame.
  const poll = (target) => {
    const wait = target.waitForFunction.bind(target);
    target.waitForFunction = (fn, arg, options) => wait(fn, arg, { polling: 100, ...options });
  };
  poll(page);
  for (const frame of page.frames()) poll(frame);
  page.on('frameattached', poll);
  page.on('pageerror', (error) => faults.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /(?:Error|错误)/.test(message.text()))
      faults.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) missing.add(new URL(response.url()).pathname);
  });
  return page;
}
async function request(page, path, method, body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${response.status}: ${path}`);
      return response.json();
    },
    { path, method, body },
  );
}
const phones = [],
  frames = [];
let worker;
const control = (frame, text) =>
  frame
    .locator('.control:not(.removing) > div')
    .filter({ hasText: new RegExp(`^${text}$`) })
    .first();
async function table(phone) {
  await phone.waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
  );
  return phone.frames().find((frame) => frame.url().includes('/engine/player/'));
}
async function waitChoice(index) {
  await frames[index].waitForFunction(
    () => partyEngine._status.event.name === 'chooseToUse' && partyEngine._status.paused,
  );
}
async function stage(kind) {
  await progress(kind);
  await worker.evaluate((kind) => {
    const { game, lib, ui, _status } = partyEngine;
    const probe = partySkillProbe;
    probe.done = false;
    probe.kind = kind;
    probe.receivedFrom = probe.received.length;
    if (kind.endsWith('setup'))
      for (const player of game.players)
        player.stat.push({ card: {}, skill: {}, triggerSkill: {} });
    const event = new lib.element.GameEvent('partySkillFixture', false, _status.eventManager);
    event.player = kind.startsWith('weilin')
      ? probe.guanyu
      : kind.startsWith('qice') || kind.startsWith('zhijue')
        ? probe.target
        : kind.startsWith('guangu')
          ? probe.spectator
          : probe.lvbu;
    probe.actor = event.player;
    event.kind = kind;
    event.setContent(async function (event) {
      const { game, ui, lib, _status } = partyEngine;
      const probe = partySkillProbe,
        { guanyu, lvbu, target, own } = probe;
      if (event.kind === 'setup') {
        for (const player of game.players) {
          if (player.countCards('hej')) await player.lose(player.getCards('hej'), ui.discardPile);
          if (player.hp < player.maxHp) await player.recover(player.maxHp - player.hp);
          player.removeSkill(['olsbduoshou_used', 'olsbweilin_wusheng', 'olsbweilin_effect']);
        }
        guanyu.directgain([own.weilin]);
        lvbu.directgain([own.trick, own.equip, own.qi]);
        target.directgain([own.red, own.black]);
        return;
      }
      if (event.kind.endsWith('setup')) {
        const general =
          event.kind === 'qice-setup'
            ? 'clan_xunyou'
            : event.kind === 'zhijue-setup'
              ? 'ol_sb_zhugeliang'
              : 'clan_zhongyan';
        game.broadcastAll(
          function (player, general) {
            player.uninit();
            player.init(general);
          },
          event.player,
          general,
        );
        if (event.kind === 'qice-setup') event.player.addTempSkill('qice', 'roundStart');
        if (event.kind === 'zhijue-setup') event.player.changeZhuanhuanji('olsbzhijue');
        for (const player of game.players)
          if (player.countCards('hej')) await player.lose(player.getCards('hej'), ui.discardPile);
        event.player.directgain([own.red, own.black]);
        if (event.kind === 'zhijue-setup') await event.player.loseHp();
        return;
      }
      const actor = event.player;
      probe.before = actor.getAllHistory('useCard').length;
      probe.beforeLosses = actor.getAllHistory('lose').length;
      await actor.chooseToUse().set('type', 'phase');
      probe.after = actor.getAllHistory('useCard').length;
      probe.last = actor.getAllHistory('useCard').at(-1);
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
async function finish() {
  for (let attempt = 0; attempt < 150; attempt++) {
    const state = await worker.evaluate(() => ({
      done: partySkillProbe.done,
      error: partySkillProbe.error,
    }));
    assert.equal(state.error, undefined);
    if (state.done) return;
    for (const frame of frames) {
      const event = await frame.evaluate(() => partyEngine._status.event.name);
      if (
        ['chooseToUse', 'chooseToRespond', 'chooseBool'].includes(event) &&
        (await control(frame, '取消').isVisible())
      )
        await control(frame, '取消')[gesture]();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Native skill fixture did not finish');
}
async function material(index, id) {
  await frames[index].waitForFunction(
    (id) =>
      partyEngine.game.me
        .getCards('hes')
        .some((card) => card.cardid === id && card.classList.contains('selectable')),
    id,
  );
  await frames[index].evaluate((id) => {
    partyEngine.lib.cardOL[id].dataset.skillMaterial = id;
  }, id);
  await frames[index]
    .locator(`[data-skill-material="${id}"].selectable`)
    .first()
    [gesture]({ position: { x: 8, y: 15 } });
  await frames[index].waitForFunction(
    (id) => partyEngine.ui.selected.cards.some((card) => card.cardid === id),
    id,
  );
}
async function target(index, id) {
  await frames[index].evaluate((id) => {
    partyEngine.lib.playerOL[id].dataset.skillTarget = id;
  }, id);
  await frames[index]
    .locator(`[data-skill-target="${id}"].selectable`)
    [gesture]({ position: { x: 12, y: 12 } });
  await frames[index].waitForFunction(
    (id) => partyEngine.ui.selected.targets.some((player) => player.playerid === id),
    id,
  );
}
async function option(index, name, nature = '') {
  const frame = frames[index];
  await frame.waitForFunction(
    () => partyEngine._status.event.name === 'chooseButton' && partyEngine._status.paused,
  );
  await frame.evaluate(
    ({ name, nature }) => {
      for (const button of partyEngine.ui.dialog.buttons)
        if (button.link?.[2] === name && (button.link[3] || '') === nature)
          button.dataset.skillOption = 'chosen';
    },
    { name, nature },
  );
  await frame.locator('[data-skill-option="chosen"].selectable')[gesture]();
  assert.equal(
    await frame.evaluate(() => partyEngine._status.event.name),
    'chooseButton',
    'option selection waits for explicit confirmation',
  );
  await control(frame, '确定')[gesture]();
  await frame.waitForFunction(
    () => partyEngine._status.event.skill?.endsWith('_backup') && partyEngine._status.paused,
  );
}
async function notSubmitted(index, materialId) {
  assert.equal(
    await worker.evaluate(() => partySkillProbe.done),
    false,
    'material/target selection must not submit',
  );
  assert(
    await frames[index].evaluate(
      (id) => partyEngine.game.me.getCards('hes').some((card) => card.cardid === id),
      materialId,
    ),
  );
  assert(
    await worker.evaluate((id) => {
      const { game, lib } = partyEngine,
        probe = partySkillProbe;
      const actor = probe.actor;
      return (
        actor.getAllHistory('useCard').length === probe.before &&
        actor.getCards('hes').some((card) => card.cardid === id) &&
        lib.node.torespond[actor.playerid] === '_noname_waiting' &&
        !probe.received
          .slice(probe.receivedFrom)
          .some((value) => value.bool && value.skill?.endsWith('_backup'))
      );
    }, materialId),
    'no final result, card use or material cost has reached the worker',
  );
}
async function renew(index) {
  const before = await worker.evaluate(
    (id) => partyEngine.lib.node.torespondtimeout[id],
    await frames[index].evaluate(() => partyEngine.game.me.playerid),
  );
  assert.equal(typeof before, 'number', 'the pending native choice has a real deadline');
  await phones[index].reload();
  frames[index] = await table(phones[index]);
  await waitChoice(index);
  const after = await worker.evaluate(
    (id) => partyEngine.lib.node.torespondtimeout[id],
    await frames[index].evaluate(() => partyEngine.game.me.playerid),
  );
  assert.equal(after, before, 'refresh retains the original native choice deadline');
}
async function proof(label) {
  const value = await worker.evaluate(() => {
    const { get } = partyEngine,
      { last, before, after } = partySkillProbe;
    return {
      before,
      after,
      skill: last?.skill,
      name: last?.card?.name,
      nature: get.nature(last?.card),
      targets: last?.targets?.map((player) => player.playerid),
    };
  });
  results.push({ label, ...value });
  console.log(label, value.name, value.nature || 'normal');
  return value;
}
try {
  await progress('boot');
  const computer = await page();
  await computer.goto(base + '/server');
  await computer.waitForFunction(
    async () => (await (await fetch('/api/info')).json()).engine.ready,
  );
  for (let index = 0; index < 4; index++) phones.push(await page(true));
  await phones[0].goto(base);
  const created = await request(phones[0], '/api/rooms', 'POST', { nickname: '威临验证' });
  const code = created.room.code;
  await phones[0].goto(`${base}/join/${code}`);
  await request(phones[0], `/api/rooms/${code}`, 'PUT', {
    mode: 'versus',
    playerCount: 4,
    generalPreset: 'ol-doudizhu-s15',
    allowGeneralSelection: true,
    extensions: [],
  });
  for (let index = 1; index < 4; index++) {
    await phones[index].goto(`${base}/join/${code}`);
    await phones[index]
      .locator('#nickname')
      .fill(['罡拳验证', '目标验证', '旁观席验证'][index - 1]);
    await phones[index].locator('#join-button')[gesture]();
  }
  for (const [index, general] of ['ol_sb_guanyu', 'dm_lvbu', 're_xuzhu', 're_zhaoyun'].entries())
    await request(phones[index], `/api/rooms/${code}/me/general`, 'PUT', { general });
  for (const phone of phones) await phone.locator('#ready-button')[gesture]();
  await progress('start');
  await phones[0].locator('#start-button')[gesture]();
  for (const phone of phones) frames.push(await table(phone));
  worker = computer.frames().find((frame) => frame.url().includes('/engine/worker/'));
  await progress('selection');
  await Promise.all(frames.map((frame) => chooseGeneral(frame, worker, { mouse: desktop })));
  await worker.waitForFunction(() => partyEngine.proof.started && partyEngine._status.paused);
  await progress('initial-deal');
  const catalog = await worker.evaluate(() => ({
    names: partyEngine.lib.inpile,
    natures: partyEngine.lib.inpile_nature,
  }));
  assert(
    catalog.names.includes('sha') &&
      catalog.names.includes('jiu') &&
      !catalog.names.includes('muniu'),
  );
  for (const frame of frames)
    assert.deepEqual(
      await frame.evaluate(() => ({
        names: partyEngine.lib.inpile,
        natures: partyEngine.lib.inpile_nature,
      })),
      catalog,
    );
  const ids = await worker.evaluate(() => {
    const { game, lib, _status } = partyEngine;
    // Retire the natural opening choice before installing an isolated root;
    // otherwise a second actor's result waits for the abandoned first actor.
    for (const timer of Object.values(lib.node.torespondtimeout)) clearTimeout(timer);
    lib.node.torespond = {};
    lib.node.torespondtimeout = {};
    _status.eventManager = new _status.eventManager.constructor();
    _status.eventManager.rootEvent = lib.element.GameEvent.initialGameEvent();
    _status.pauseManager = new _status.pauseManager.constructor();
    lib.config.duration = 100;
    const [guanyu, lvbu, target, spectator] = game.players;
    const card = (name, suit, num) => game.createCard(name, suit, num);
    const own = {
      weilin: card('guohe', 'heart', 12),
      trick: card('guohe', 'spade', 10),
      equip: card('zhuge', 'club', 1),
      qi: card('jiu', 'spade', 3),
      red: card('tao', 'heart', 6),
      black: card('wuzhong', 'club', 7),
    };
    own.qi.addGaintag('eternal_olduoqi_tag');
    globalThis.partySkillProbe = { guanyu, lvbu, target, spectator, own, received: [] };
    const unwait = lib.element.Player.prototype.unwait;
    lib.element.Player.prototype.unwait = function (value) {
      partySkillProbe.received.push({
        player: this.name,
        bool: value?.bool,
        skill: value?.skill,
        waiting: Object.keys(lib.node.torespond),
      });
      return unwait.call(this, value);
    };
    return {
      players: game.players.map((player) => player.playerid),
      cards: Object.fromEntries(Object.entries(own).map(([key, value]) => [key, value.cardid])),
    };
  });
  // Retire the phones' matching opening choice as well. A fresh native reinit
  // restores their arenas without replay once the abandoned wait is cleared.
  for (let index = 0; index < phones.length; index++) {
    await phones[index].reload();
    frames[index] = await table(phones[index]);
  }
  if (process.env.ENGINE_VERIFY_FEEDBACK_ONLY !== '1') {
    await stage('setup');
    await finish();
    await stage('weilin-fire');
    await waitChoice(0);
    assert(await control(frames[0], '威临').isVisible(), '威临 is present on first entry');
    await control(frames[0], '威临')[gesture]();
    await option(0, 'sha', 'fire');
    await material(0, ids.cards.weilin);
    await target(0, ids.players[2]);
    await notSubmitted(0, ids.cards.weilin);
    await phones[0].screenshot({ path: `${output}/weilin-before-confirm.png` });
    await control(frames[0], '确定')[gesture]();
    await finish();
    const fire = await proof('威临火杀');
    assert.equal(fire.skill, 'olsbweilin_backup');
    assert.equal(fire.name, 'sha');
    assert.equal(fire.nature, 'fire');
    assert.deepEqual(fire.targets, [ids.players[2]]);
    assert.equal(fire.after, fire.before + 1);
    assert.deepEqual(
      await frames[2].evaluate(
        ({ red, black }) => ({
          red: partyEngine.get.name(partyEngine.lib.cardOL[red]),
          black: partyEngine.get.name(partyEngine.lib.cardOL[black]),
        }),
        ids.cards,
      ),
      { red: 'sha', black: 'wuzhong' },
    );
    await stage('weilin-exhausted');
    await waitChoice(0);
    assert.equal(
      await control(frames[0], '威临').isVisible(),
      false,
      'native once-per-turn limit remains',
    );
    await control(frames[0], '结束回合')[gesture]();
    await finish();
    await stage('setup');
    await finish();
    await stage('weilin-wine');
    await waitChoice(0);
    await renew(0);
    await control(frames[0], '威临')[gesture]();
    await option(0, 'sha', 'fire');
    await control(frames[0], '取消')[gesture]();
    await frames[0].waitForFunction(() => !partyEngine._status.event.skill);
    await control(frames[0], '威临')[gesture]();
    await option(0, 'jiu');
    await renew(0);
    assert.equal(
      await frames[0].evaluate(() => partyEngine.lib.skill.olsbweilin_backup.viewAs.name),
      'jiu',
      'refresh restores the same generated backup',
    );
    await material(0, ids.cards.weilin);
    await notSubmitted(0, ids.cards.weilin);
    await control(frames[0], '确定')[gesture]();
    await finish();
    assert.equal((await proof('威临酒／刷新')).name, 'jiu');
    await stage('setup');
    await finish();
    await stage('gangquan-duel');
    await waitChoice(1);
    await control(frames[1], '罡拳')[gesture]();
    await frames[1].waitForFunction(() => partyEngine._status.event.skill === 'olgangquan_backup');
    await material(1, ids.cards.trick);
    await target(1, ids.players[2]);
    await notSubmitted(1, ids.cards.trick);
    await phones[1].screenshot({ path: `${output}/gangquan-duel-before-confirm.png` });
    await control(frames[1], '确定')[gesture]();
    await finish();
    const duel = await proof('罡拳锦囊转决斗');
    assert.equal(duel.skill, 'olgangquan_backup');
    assert.equal(duel.name, 'juedou');
    assert.equal(duel.after, duel.before + 1);
    await stage('setup');
    await finish();
    await stage('qi-wine');
    await waitChoice(1);
    await material(1, ids.cards.qi);
    await control(frames[1], '确定')[gesture]();
    await finish();
    await stage('gangquan-fire');
    await waitChoice(1);
    assert.equal(await frames[1].evaluate(() => partyEngine._status.event.olgangquan), true);
    await renew(1);
    assert.equal(
      await frames[1].evaluate(() => partyEngine._status.event.olgangquan),
      true,
      'native qi branch survives refresh',
    );
    await control(frames[1], '罡拳')[gesture]();
    await frames[1].waitForFunction(() => partyEngine._status.event.skill === 'olgangquan_backup');
    await material(1, ids.cards.equip);
    assert.deepEqual(
      (
        await frames[1].evaluate(() =>
          partyEngine.ui.selected.targets.map((player) => player.playerid),
        )
      ).sort(),
      [ids.players[0], ids.players[2]].sort(),
      'fire sha targets both adjacent players and excludes the opposite seat',
    );
    await notSubmitted(1, ids.cards.equip);
    await phones[1].screenshot({ path: `${output}/gangquan-fire-before-confirm.png` });
    await control(frames[1], '确定')[gesture]();
    await finish();
    const gangFire = await proof('罡拳装备转火杀／刷新');
    assert.equal(gangFire.name, 'sha');
    assert.equal(gangFire.nature, 'fire');
    assert.deepEqual(gangFire.targets.sort(), [ids.players[0], ids.players[2]].sort());
    await stage('qice-setup');
    await finish();
    await stage('qice-use');
    await waitChoice(2);
    await control(frames[2], '奇策')[gesture]();
    await option(2, 'juedou');
    assert.equal(
      await frames[2].evaluate(() => partyEngine.ui.selected.cards.length),
      2,
      '奇策 retains its all-hand material rule',
    );
    await renew(2);
    await target(2, ids.players[0]);
    await notSubmitted(2, ids.cards.red);
    await control(frames[2], '确定')[gesture]();
    await finish();
    const qice = await proof('同类：奇策全部手牌转决斗／刷新');
    assert.equal(qice.name, 'juedou');
    assert.equal(qice.skill, 'qice_backup');
    await stage('guangu-setup');
    await finish();
    await stage('guangu-use');
    await waitChoice(3);
    await control(frames[3], '观骨')[gesture]();
    await frames[3].waitForFunction(() => partyEngine._status.event.name === 'chooseControl');
    await control(frames[3], '一')[gesture]();
    await frames[3].waitForFunction(() => partyEngine._status.event.skill === 'clanguangu_backup');
    await renew(3);
    assert.equal(
      await frames[3].evaluate(() => partyEngine.lib.skill.clanguangu_backup.num),
      1,
      'control index is preserved in native backup',
    );
    await notSubmitted(3, ids.cards.red);
    await control(frames[3], '确定')[gesture]();
    await frames[3].waitForFunction(
      () => partyEngine._status.event.name === 'chooseButton' && partyEngine._status.paused,
    );
    await control(frames[3], '取消')[gesture]();
    await finish();
    assert.equal(
      await worker.evaluate(() => partySkillProbe.spectator.getStat('skill').clanguangu),
      1,
      'native skill was actually used',
    );
    results.push({
      label: '同类：观骨控制选项／刷新／原生观看流程',
      skill: 'clanguangu_backup',
      count: 1,
    });
    await stage('zhijue-setup');
    await finish();
    await stage('zhijue-use');
    await waitChoice(2);
    await control(frames[2], '智绝')[gesture]();
    await frames[2].waitForFunction(() => partyEngine._status.event.name === 'chooseButton');
    await frames[2].evaluate(() => {
      partyEngine.ui.dialog.buttons.find((button) => button.link === 'red').dataset.skillOption =
        'red';
    });
    await frames[2].locator('[data-skill-option="red"].selectable')[gesture]();
    await control(frames[2], '确定')[gesture]();
    await frames[2].waitForFunction(() => partyEngine._status.event.skill === 'olsbzhijue_backup');
    await renew(2);
    assert.deepEqual(
      await frames[2].evaluate(() => partyEngine.ui.selected.cards.map((card) => card.cardid)),
      [ids.cards.red],
      'captured color filters remain intact after refresh',
    );
    await notSubmitted(2, ids.cards.red);
    await control(frames[2], '确定')[gesture]();
    await frames[2].waitForFunction(
      () => partyEngine._status.event.name === 'chooseButton' && partyEngine._status.paused,
    );
    await control(frames[2], '取消')[gesture]();
    await finish();
    assert.equal(
      await worker.evaluate(() => {
        const probe = partySkillProbe;
        return (
          probe.target
            .getAllHistory('lose')
            .slice(probe.beforeLosses)
            .some((event) => event.cards.includes(probe.own.red)) &&
          partyEngine.get.position(probe.own.red) === 'd' &&
          probe.target.getCards('h').includes(probe.own.black)
        );
      }),
      true,
      'native color material was actually discarded',
    );
    results.push({
      label: '同类：智绝红色闭包／刷新／原生弃牌流程',
      skill: 'olsbzhijue_backup',
      color: 'red',
    });
  }
  results.push(
    ...(await verifyNativeFeedback({ phones, frames, worker, output, control, material, target })),
  );
  for (const frame of frames)
    assert(
      await frame.evaluate(() =>
        partyEngine.game.players
          .filter((player) => player !== partyEngine.game.me)
          .every((player) =>
            player
              .getCards('h')
              .every(
                (card) => card.isKnownBy(partyEngine.game.me) || card.name === 'party_unknown',
              ),
          ),
      ),
      'unrevealed opponents stay concealed',
    );
  assert.deepEqual(faults, []);
  assert.deepEqual([...missing], []);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        fixture: true,
        physicalPhone: false,
        browser: browser.version(),
        input: desktop ? 'mouse' : 'touch',
        http,
        feedbackOnly: process.env.ENGINE_VERIFY_FEEDBACK_ONLY === '1',
        catalog,
        refreshRetainsDeadline: true,
        finalActionRequiresConfirm: true,
        targetsAndEffectsVerified: true,
        concealedHands: true,
        faults,
        missing: [...missing],
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    process.env.ENGINE_VERIFY_FEEDBACK_ONLY === '1'
      ? '原生反馈定向验证通过：自无懈、蒺藜/五谷、逐日拼点用牌、连续礼物与音量保存。'
      : '原生技能验证通过：威临/罡拳、奇策/观骨/智绝、自无懈、蒺藜/五谷、逐日拼点用牌、连续礼物、音量及暗牌隐私。',
    output,
  );
} catch (error) {
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: error.message,
        faults,
        missing: [...missing],
        worker: await worker
          ?.evaluate(() => ({
            event: partyEngine._status.event.name,
            player: partyEngine._status.event.player?.name,
            result: partyEngine._status.event.result?.bool,
            waiting: Object.keys(partyEngine.lib.node.torespond),
            connections: partyEngine.game.players.map((player) => ({
              name: player.name,
              online: player.isOnline(),
              auto: player.isAuto,
              closed: player.ws?.closed,
            })),
            received: partySkillProbe.received,
            kind: partySkillProbe.kind,
            done: partySkillProbe.done,
            error: partySkillProbe.error,
            errors: partyEngine.proof.errors,
            feedback: globalThis.partyFeedbackProbe && {
              kind: partyFeedbackProbe.kind,
              done: partyFeedbackProbe.done,
              error: partyFeedbackProbe.error,
              reusedCompare: partyFeedbackProbe.reusedCompare,
            },
          }))
          .catch(() => null),
        states: await Promise.all(
          frames.map((frame) =>
            frame
              .evaluate(() => ({
                event: partyEngine._status.event.name,
                skill: partyEngine._status.event.skill,
                parent: partyEngine._status.event.getParent()?.name,
                options: partyEngine.ui.dialog?.buttons?.map((button) => ({
                  link: Array.isArray(button.link) ? button.link : undefined,
                  classes: button.className,
                })),
                controls: [...document.querySelectorAll('.control:not(.removing)')].map(
                  (node) => node.textContent,
                ),
                errors: partyEngine.proof.errors,
              }))
              .catch(() => null),
          ),
        ),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  party.closeStreams();
  party.server.closeAllConnections();
  await new Promise((resolve) => party.server.close(resolve));
}
