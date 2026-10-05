import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { chromium } from '@playwright/test';
import { createPartyServer } from '../apps/server/src/server.ts';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { createPublicGateway } from '../apps/server/src/public-gateway.ts';
import { APP_VERSION } from '../packages/shared/src/contracts.ts';
import { chooseGeneral, playOneAction } from './native-ui-actions.mjs';
import {
  verifyChoicePrompts,
  verifyLateVoices,
  observeActionDelivery,
} from './native-experience-probes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const party = process.env.ENGINE_VERIFY_EXISTING_URL
  ? null
  : createPartyServer({
      webRoot: `${root}/dist/web`,
      port: 0,
      adapter: new NativeNonameService(root),
      ...(process.env.ENGINE_VERIFY_LOCAL_BRIDGE === '1' ? { entryMode: 'internet' } : {}),
    });
if (party) await new Promise((resolve) => party.server.listen(0, '0.0.0.0', resolve));
const gateway =
  process.env.ENGINE_VERIFY_LOCAL_BRIDGE === '1' && party
    ? createPublicGateway(party.server.address().port)
    : null;
if (gateway) {
  await new Promise((resolve) => gateway.server.listen(0, '127.0.0.1', resolve));
  party.setInternetEntry('ready', '测试公网入口', 'https://preview-player.trycloudflare.com/');
}
const port = party
  ? party.server.address().port
  : Number(new URL(process.env.ENGINE_VERIFY_EXISTING_URL).port);
const lan = Object.values(networkInterfaces())
  .flat()
  .find(
    (address) =>
      address?.family === 'IPv4' &&
      !address.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address),
  )?.address;
assert(lan, 'LAN IPv4 is required');
const origin =
  process.env.ENGINE_VERIFY_PLAYER_URL ??
  process.env.ENGINE_VERIFY_EXISTING_URL ??
  (gateway ? `http://127.0.0.1:${gateway.server.address().port}` : undefined) ??
  `http://${lan}:${port}`;
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const faults = [],
  missing = new Set(),
  external = new Set(),
  contexts = [];
const closingRooms = new Set();
const artifactRoot = `.runtime/native-runtime/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
await mkdir(artifactRoot, { recursive: true });
// This fixture exercises Android/WeChat branches; it is still desktop Edge,
// and cannot certify a physical phone's browser or WeChat version.
const mobileUserAgent =
  process.env.ENGINE_VERIFY_USER_AGENT ??
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.179 Mobile Safari/537.36 MicroMessenger/8.0.50.2700';
const presets = JSON.parse(await readFile(`${root}/config/roster-presets.json`, 'utf8')).presets;
async function privateHandIds(worker, viewerId) {
  return worker.evaluate((id) => {
    const viewer = partyEngine.lib.playerOL[id];
    return partyEngine.game.players
      .filter((player) => player !== viewer)
      .flatMap((player) => player.getCards('h'))
      .filter((card) => !card.isKnownBy(viewer))
      .map((card) => card.cardid);
  }, viewerId);
}

async function observeJudgeDisplay(frame) {
  await frame.waitForFunction(() => globalThis.partyEngine?.proof.booted, {}, { timeout: 120000 });
  await frame.evaluate(() => {
    // Observe actual rendered public judge cards, including native copies.
    // Keep counts only, never card faces or deck order in the result file.
    globalThis.partyJudgeDisplayProof = { cards: 0, concealed: 0, missingFace: 0 };
    const seen = new WeakSet();
    // Comparison uses the arena highlight too, but intentionally flips a back
    // before its face. Judge observations must not classify that animation.
    const comparisons = new WeakSet();
    const throwxy2 = partyEngine.lib.element.Player.prototype.$throwxy2;
    partyEngine.lib.element.Player.prototype.$throwxy2 = function (...args) {
      const node = throwxy2.apply(this, args);
      comparisons.add(node);
      return node;
    };
    const inspect = () => {
      for (const card of document.querySelectorAll('.card.thrownhighlight')) {
        if (seen.has(card) || comparisons.has(card)) continue;
        seen.add(card);
        const proof = partyJudgeDisplayProof;
        proof.cards++;
        if (card.classList.contains('infohidden') || card.name === 'party_unknown')
          proof.concealed++;
        if (!['heart', 'diamond', 'club', 'spade'].includes(card.suit) || !card.number)
          proof.missingFace++;
      }
    };
    new MutationObserver(inspect).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    inspect();
  });
}

async function observePublicDisplay(frame) {
  await frame.waitForFunction(() => globalThis.partyEngine?.proof.booted, {}, { timeout: 120000 });
  await frame.evaluate(() => {
    globalThis.partyPublicDisplayProof = {
      wuguDialogs: 0,
      wuguCards: 0,
      wuguConcealed: 0,
      deadBeforeEnd: 0,
      deadIncorrect: 0,
    };
    const { ui, game, get } = partyEngine;
    const createDialog = ui.create.dialog;
    ui.create.dialog = function (...args) {
      const dialog = createDialog.apply(this, args);
      if (args[0] === '五谷丰登') {
        const proof = partyPublicDisplayProof;
        proof.wuguDialogs++;
        for (const button of dialog.buttons) {
          proof.wuguCards++;
          if (
            button.link?.name === 'party_unknown' ||
            button.classList.contains('infohidden') ||
            !['heart', 'diamond', 'club', 'spade'].includes(button.link?.suit)
          )
            proof.wuguConcealed++;
        }
      }
      return dialog;
    };
    const seen = new Set();
    const inspect = () => {
      if (get.mode() !== 'identity') return;
      for (const player of game.dead) {
        if (!player.identityShown || !player.node.dieidentity || seen.has(player.playerid))
          continue;
        seen.add(player.playerid);
        if (!partyEngine._status.over) partyPublicDisplayProof.deadBeforeEnd++;
        if (
          player.identity === 'unknown' ||
          player.node.dieidentity?.textContent !== get.translation(`${player.identity}2`)
        )
          partyPublicDisplayProof.deadIncorrect++;
      }
    };
    new MutationObserver(inspect).observe(document.body, {
      childList: true,
      characterData: true,
      attributes: true,
      subtree: true,
    });
  });
}

async function page(mobile, remote = false) {
  const context = await browser.newContext(
    mobile
      ? {
          viewport:
            process.env.ENGINE_VERIFY_PORTRAIT === '1'
              ? { width: 390, height: 844 }
              : { width: 844, height: 390 },
          isMobile: true,
          hasTouch: true,
          userAgent: mobileUserAgent,
        }
      : {},
  );
  contexts.push(context);
  if (mobile && (process.env.ENGINE_VERIFY_NO_RTC === '1' || remote))
    await context.addInitScript(() => {
      globalThis.RTCPeerConnection = undefined;
    });
  if (mobile && process.env.ENGINE_VERIFY_HTTP === '1')
    await context.addInitScript(() => sessionStorage.setItem('party_http_transport', '1'));
  if (mobile && process.env.ENGINE_VERIFY_BLOCK_WEBSOCKET === '1')
    await context.routeWebSocket('**/engine/socket/**/player*', (socket) => socket.close());
  if (mobile && process.env.ENGINE_VERIFY_STALL_WEBSOCKET === '1')
    await context.addInitScript(() => {
      const native = WebSocket;
      globalThis.WebSocket = class extends EventTarget {
        readyState = 0;
        constructor(url) {
          super();
          if (!String(url).includes('/player')) return new native(url);
        }
        close() {
          this.readyState = 3;
        }
        send() {}
      };
    });
  let interrupted = false;
  if (process.env.ENGINE_VERIFY_CACHE !== '1')
    await context.route('**/*', async (route) => {
      if (![origin, `http://127.0.0.1:${port}`].includes(new URL(route.request().url()).origin)) {
        external.add(route.request().url());
        await route.abort();
      } else if (
        mobile &&
        process.env.ENGINE_VERIFY_RETRY_START === '1' &&
        !interrupted &&
        /^\/engine\/bundle\/noname-[a-f0-9]+\.js$/.test(new URL(route.request().url()).pathname)
      ) {
        interrupted = true;
        await route.abort('failed');
      } else if (
        mobile &&
        process.env.ENGINE_VERIFY_SLOW_START === '1' &&
        new URL(route.request().url()).pathname.replace(/\/core\/[a-f0-9]{40}\//, '/core/') ===
          '/engine/core/layout/default/layout.css'
      ) {
        // A cold LAN load can exceed the upstream ten-second reset timer.
        await new Promise((resolve) => setTimeout(resolve, 12000));
        await route.continue();
      } else if (
        (process.env.ENGINE_VERIFY_GOD_FIXTURE === '1' ||
          process.env.ENGINE_VERIFY_JUDGE_FIXTURE === '1' ||
          process.env.ENGINE_VERIFY_COMPARE_FIXTURE === '1') &&
        route.request().url().includes('/engine/setup/')
      ) {
        const response = await route.fetch();
        const setup = await response.json();
        setup.preset = {
          completePacks: [],
          packGroups:
            process.env.ENGINE_VERIFY_JUDGE_FIXTURE === '1'
              ? { standard: [] }
              : process.env.ENGINE_VERIFY_COMPARE_FIXTURE === '1'
                ? { refresh: [] }
                : { extra: [] },
          additionalCharacters:
            process.env.ENGINE_VERIFY_JUDGE_FIXTURE === '1'
              ? ['zhenji', 'simayi']
              : process.env.ENGINE_VERIFY_COMPARE_FIXTURE === '1'
                ? ['xin_gaoshun', 're_taishici']
                : ['shen_zhaoyun', 'shen_lvbu'],
          definitionPacks: setup.preset.definitionPacks,
        };
        await route.fulfill({ response, json: setup });
      } else await route.continue();
    });
  const page = await context.newPage();
  if (mobile && process.env.ENGINE_VERIFY_COLD_MOBILE_KBPS) {
    const bandwidth = Number(process.env.ENGINE_VERIFY_COLD_MOBILE_KBPS);
    assert(Number.isFinite(bandwidth) && bandwidth >= 20 && bandwidth <= 10000);
    const network = await context.newCDPSession(page);
    await network.send('Network.enable');
    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: bandwidth * 1024,
      uploadThroughput: bandwidth * 1024,
      connectionType: 'cellular4g',
    });
  }
  page.packRequests = new Set();
  page.largeFontRequests = new Set();
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname.replace(/\/core\/[a-f0-9]{40}\//, '/core/');
    if (![origin, `http://127.0.0.1:${port}`].includes(new URL(request.url()).origin))
      external.add(request.url());
    if (/^\/engine\/core\/(?:character|card)\/[^/]+\.js$/.test(path)) page.packRequests.add(path);
    if (/^\/engine\/core\/font\/(?!suits\.)/.test(path)) page.largeFontRequests.add(path);
  });
  page.on('pageerror', (error) => {
    faults.push(String(error));
    console.log('browser error:', String(error).slice(0, 300));
  });
  page.on('dialog', async (dialog) => {
    faults.push(dialog.message());
    console.log('unexpected dialog:', dialog.message().slice(0, 150));
    await dialog.dismiss();
  });
  page.on('response', (response) => {
    const closedRoom = /^\/api\/rooms\/([A-F0-9]{6})(?:\/events)?$/.exec(
      new URL(response.url()).pathname,
    );
    if (response.status() === 404 && closedRoom && closingRooms.has(closedRoom[1])) return;
    if (response.status() >= 400 && !response.url().endsWith('/api/me')) {
      missing.add(new URL(response.url()).pathname);
      console.log('HTTP', response.status(), new URL(response.url()).pathname);
    }
  });
  return page;
}
const results = [];
try {
  let computer = await page(false);
  await computer.goto(`http://127.0.0.1:${port}/server`);
  if (process.env.ENGINE_VERIFY_LEGACY_HOST === '1')
    await computer.locator('footer').evaluate((footer) => {
      footer.textContent = '聚会三国杀 v0.4.1';
    });
  let duplicateComputer =
    process.env.ENGINE_VERIFY_DUPLICATE_HOST === '1' ? await computer.context().newPage() : null;
  if (duplicateComputer) await duplicateComputer.goto(`http://127.0.0.1:${port}/server`);
  const modes = process.env.ENGINE_VERIFY_MODES?.split(',') ?? [
    'duel',
    'identity',
    'doudizhu',
    'versus',
  ];
  for (const mode of modes) {
    const phone = await page(true);
    const phones = [phone];
    await phone.goto(origin);
    const created = await phone.evaluate(async () => {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: '玩家 <测试>' }),
      });
      return response.json();
    });
    const code = created.room.code;
    await phone.goto(`${origin}/join/${code}`);
    if (mode === modes[0]) {
      await phone.locator('#general-guide').tap();
      await phone.waitForFunction(
        () => document.querySelector('#general-guide-dialog img')?.naturalWidth > 0,
      );
      await phone.screenshot({ path: `${artifactRoot}/general-guide.png` });
      await phone.locator('#guide-close').tap();
    }
    await phone.waitForFunction(
      () =>
        document.querySelector('#ready-button') &&
        !document.querySelector('#ready-button').disabled,
    );
    const playerCount =
      mode === 'identity'
        ? Number(process.env.ENGINE_VERIFY_IDENTITY_SEATS ?? 5)
        : { duel: 2, doudizhu: 3, versus: 4 }[mode];
    const humanCount = Math.min(playerCount, Number(process.env.ENGINE_VERIFY_HUMANS ?? 1));
    await phone.evaluate(
      async ({ code, mode, playerCount, preset }) => {
        const base = `/api/rooms/${code}`;
        for (const [path, method, body] of [
          [base, 'PUT', { mode, playerCount, generalPreset: preset, extensions: [] }],
        ]) {
          const response = await fetch(path, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!response.ok) throw new Error(await response.text());
        }
      },
      { code, mode, playerCount, preset: process.env.ENGINE_VERIFY_PRESET ?? 'beginner' },
    );
    for (let index = 1; index < humanCount; index++) {
      const friend = await page(true, process.env.ENGINE_VERIFY_MIXED_NETWORK === '1');
      phones.push(friend);
      await friend.goto(`${origin}/join/${code}`);
      await friend.locator('#nickname').fill(`朋友 ${index}`);
      await friend.locator('#join-button').tap();
      await friend.locator('#ready-button').waitFor({ state: 'visible' });
    }
    if (playerCount > humanCount)
      await phone.evaluate(
        async ({ code, count }) => {
          const response = await fetch(`/api/rooms/${code}/bots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count }),
          });
          if (!response.ok) throw new Error(await response.text());
        },
        { code, count: playerCount - humanCount },
      );
    for (const participant of phones) {
      if (process.env.ENGINE_VERIFY_PRELOAD === '1')
        await participant.waitForFunction(
          () =>
            document.querySelector('#engine-preload')?.textContent.includes('本局通用素材已准备好'),
          {},
          { timeout: 180000 },
        );
      await participant.waitForFunction(() => !document.querySelector('#ready-button').disabled);
      await participant.locator('#ready-button').tap();
    }
    await phone.locator('#start-button').waitFor({ state: 'visible' });
    await phone.waitForFunction(() => !document.querySelector('#start-button').disabled);
    await phone.locator('#start-button').tap();
    await phone.locator('#game-frame').waitFor({ state: 'visible', timeout: 15000 });
    await phone.waitForFunction(() =>
      document
        .querySelector('#game-frame')
        ?.contentWindow?.location.pathname.startsWith('/engine/player/'),
    );
    const gameFrame = phone.frames().find((frame) => frame.url().includes('/engine/player/'));
    assert(gameFrame);
    if (process.env.ENGINE_VERIFY_RETRY_START === '1') {
      for (const participant of phones) {
        const failedFrame = participant
          .frames()
          .find((frame) => frame.url().includes('/engine/player/'));
        await failedFrame.locator('#engine-loading[data-state="failed"]').waitFor();
        const detail = await failedFrame.locator('#loading-detail').innerText();
        assert(detail.includes('重试会保留房间和座位'));
        await failedFrame.locator('#loading-retry').tap();
      }
      console.log(mode, 'failed module load retried without resetting storage');
    }
    const currentMatch = gameFrame.url().split('/').at(-1);
    if (process.env.ENGINE_VERIFY_SLOW_START === '1') {
      await phone.locator('#match-loading').waitFor({ state: 'visible' });
      await phone.waitForFunction(
        () =>
          document.querySelector('#match-loading-progress').value > 0 &&
          document.querySelector('#match-loading-detail').textContent.includes('项资源'),
      );
      await phone.screenshot({ path: `${artifactRoot}/${mode}-loading.png` });
    }
    const activeComputer = await Promise.any(
      [computer, duplicateComputer].filter(Boolean).map(async (candidate) => {
        await candidate.waitForFunction(
          (id) =>
            [...document.querySelectorAll('.engine-worker')].some(
              (frame) =>
                frame.src.endsWith(id) && frame.contentWindow?.partyEngine?.proof.hostReady,
            ),
          currentMatch,
          { timeout: 20000 },
        );
        return candidate;
      }),
    );
    if (activeComputer !== computer) [computer, duplicateComputer] = [activeComputer, computer];
    const worker = computer
      .frames()
      .find((frame) => frame.url().endsWith(`/engine/worker/${currentMatch}`));
    assert(worker);
    await worker.evaluate(() => {
      partyEngine.proof.publicCards = {
        throws: 0,
        opponentThrows: 0,
        masked: 0,
        judges: 0,
        opponentJudges: 0,
        judgeFacesIncorrect: 0,
        rejudges: 0,
        wuguPools: 0,
        wuguMasked: 0,
        compares: 0,
        compareMasked: 0,
      };
      const clientSend = partyEngine.lib.element.Client.prototype.send;
      partyEngine.lib.element.Client.prototype.send = function (...args) {
        const send = this.ws.send;
        const client = this;
        this.ws.send = function (payload) {
          const packet = JSON.parse(payload);
          const event = partyEngine.get.event();
          const proof = partyEngine.proof.publicCards;
          if (packet[0] === 'exec' && /\$compare(?:Multiple)?\(/.test(String(packet[1]))) {
            proof.compares++;
            if (JSON.stringify([packet[3], packet[4]]).includes('party_unknown'))
              proof.compareMasked++;
          }
          if (
            packet[0] === 'exec' &&
            String(packet[1]).includes('五谷丰登') &&
            Array.isArray(args[1]) &&
            args[1].some((card) => card?.cardid)
          ) {
            proof.wuguPools++;
            if (JSON.stringify(packet[2]).includes('party_unknown')) proof.wuguMasked++;
          }
          if (
            packet[0] === 'exec' &&
            String(packet[1]).includes('.$throw(') &&
            ['useCard', 'respond'].includes(event?.name)
          ) {
            proof.throws++;
            if (event.player?.playerid !== client.id) proof.opponentThrows++;
            if (JSON.stringify(packet[3]).includes('party_unknown')) proof.masked++;
            if (event.name === 'respond' && event.highlight) proof.rejudges++;
          }
          if (
            packet[0] === 'exec' &&
            String(packet[1]).includes('thrownhighlight') &&
            String(packet[3]).startsWith('_noname_card:') &&
            args[2]?.cardid
          ) {
            proof.judges++;
            if (args[1]?.playerid !== client.id) proof.opponentJudges++;
            const face = JSON.parse(packet[3].slice('_noname_card:'.length));
            const card = args[2];
            if (face[1] !== card.suit || face[2] !== card.number || face[3] !== card.name)
              proof.judgeFacesIncorrect++;
          }
          return send.call(this, payload);
        };
        try {
          return clientSend.apply(this, args);
        } finally {
          this.ws.send = send;
        }
      };
    });
    const gameFrames = [];
    for (const participant of phones) {
      await participant.waitForFunction(() =>
        document
          .querySelector('#game-frame')
          ?.contentWindow?.location.pathname.startsWith('/engine/player/'),
      );
      gameFrames.push(
        participant.frames().find((frame) => frame.url().includes('/engine/player/')),
      );
    }
    for (const frame of gameFrames) {
      await observeJudgeDisplay(frame);
      await observePublicDisplay(frame);
    }
    await Promise.all(gameFrames.map((frame) => chooseGeneral(frame, worker)));
    await worker.waitForFunction(() => partyEngine.proof.started, {}, { timeout: 25000 });
    await gameFrame
      .locator('.dialog .button.character')
      .first()
      .waitFor({ state: 'detached', timeout: 5000 });
    // The worker's deal confirmation precedes delivery to remote players.
    // Observe the actual hand rather than assuming LAN-sized transfer latency.
    await Promise.all(
      gameFrames.map((frame) =>
        frame.waitForFunction(
          () =>
            partyEngine.game.me?.name &&
            partyEngine.game.me.getCards('h').some((card) => card.name !== 'party_unknown'),
          {},
          { timeout: 30000 },
        ),
      ),
    );
    if (process.env.ENGINE_VERIFY_PORTRAIT === '1') {
      const sameFrame = await phone.locator('#game-frame').getAttribute('src');
      assert(
        await phone
          .locator('#match-panel')
          .evaluate((node) => node.classList.contains('rotated-table')),
      );
      await phone.locator('#match-orientation').tap();
      assert(
        !(await phone
          .locator('#match-panel')
          .evaluate((node) => node.classList.contains('rotated-table'))),
      );
      await phone.locator('#match-orientation').tap();
      assert(
        await phone
          .locator('#match-panel')
          .evaluate((node) => node.classList.contains('rotated-table')),
      );
      assert.equal(
        await phone.locator('#game-frame').getAttribute('src'),
        sameFrame,
        'orientation preserves the match iframe',
      );
      await gameFrame.waitForTimeout(750);
    }
    const loadingProof = await gameFrame.evaluate(() => ({
      steps: partyEngine.proof.loading,
      errors: partyEngine.proof.errors,
      statusHidden: document.querySelector('#engine-loading').hidden,
      resources: performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.includes('/engine/'))
        .map((entry) => ({
          path: new URL(entry.name).pathname,
          transferred: entry.transferSize,
          bytes: entry.encodedBodySize,
        })),
      speed: {
        value: partyEngine.lib.config.game_speed,
        duration: partyEngine.lib.config.duration,
      },
      packs: {
        characters: Object.keys(partyEngine.lib.characterPack).sort(),
        cards: partyEngine.lib.config.all.cards,
      },
      missingSkills: partyEngine.proof.roster.flatMap((name) =>
        partyEngine.get
          .character(name)
          .skills.filter((skill) => !partyEngine.lib.skill[skill])
          .map((skill) => `${name}:${skill}`),
      ),
    }));
    loadingProof.packRequests = [...phone.packRequests].sort();
    loadingProof.largeFontRequests = [...phone.largeFontRequests].sort();
    loadingProof.health = await gameFrame.evaluate(() =>
      partyEngine.game.players.map((player) => ({
        visible:
          player.node.hp.getBoundingClientRect().width > 0 &&
          getComputedStyle(player.node.hp).visibility !== 'hidden',
        numeric:
          player.node.hp.classList.contains('text') ||
          player.node.hp.classList.contains('textstyle'),
        text: player.node.hp.innerText,
        dots: [...player.node.hp.children].map((dot) => ({
          background: getComputedStyle(dot).backgroundImage,
          color: getComputedStyle(dot).backgroundColor,
        })),
      })),
    );
    assert.deepEqual(
      loadingProof.largeFontRequests,
      [],
      'mobile table needs no large font download',
    );
    assert(
      loadingProof.health.every((hp) => hp.visible),
      'every player has visible health',
    );
    for (const hp of loadingProof.health) {
      if (hp.numeric) {
        assert.match(
          hp.text,
          /[0-9∞]/,
          'numeric health remains visible for generals with more than five HP',
        );
        continue;
      }
      for (const dot of hp.dots) {
        assert.equal(dot.background, 'none', 'health is drawn without image requests');
        assert.notEqual(dot.color, 'rgba(0, 0, 0, 0)', 'health dot has a visible color');
      }
    }
    assert.deepEqual(loadingProof.errors, []);
    assert(loadingProof.statusHidden, 'loader closes after native startup');
    assert.equal(await phone.locator('#match-loading').isVisible(), false);
    loadingProof.mobilePortraitBytes = loadingProof.resources
      .filter((entry) => entry.path.startsWith('/engine/portraits/'))
      .reduce((total, entry) => total + entry.bytes, 0);
    assert(loadingProof.mobilePortraitBytes > 0, 'native selection/table use the small portraits');
    if (process.env.ENGINE_VERIFY_EXPERIENCE === '1')
      loadingProof.choicePrompts = await verifyChoicePrompts(worker, gameFrame);
    const expectedSpeed =
      process.env.ENGINE_VERIFY_PRESET === 'advanced'
        ? { value: 'fast', duration: 500 }
        : { value: 'slow', duration: 1000 };
    assert.deepEqual(loadingProof.speed, expectedSpeed);
    assert.equal(
      loadingProof.resources.filter((entry) => entry.path.startsWith('/engine/bundle/')).length,
      1,
      'one shared engine bundle',
    );
    if (process.env.ENGINE_VERIFY_PRELOAD === '1')
      assert.equal(
        loadingProof.resources.find((entry) => entry.path.startsWith('/engine/bundle/'))
          .transferred,
        0,
        'lobby warming is reused by the actual game iframe',
      );
    if ((await phone.locator('#match-sound').getAttribute('aria-pressed')) !== 'true')
      await phone.locator('#match-sound').tap();
    await gameFrame.waitForFunction(
      () => partyEngine.audio && document.querySelector('#engine-loading').hidden,
    );
    // Real browser audio decoding/playback, using the same entry as native cards.
    await gameFrame.evaluate(async () => {
      await partyEngine.audio.unlock();
      partyEngine.game.playCardAudio({ name: 'sha' }, 'male');
    });
    await gameFrame.waitForFunction(() => partyEngine.proof.audio.played > 0);
    await phone.locator('#match-sound').tap();
    const mutedCount = await gameFrame.evaluate(() => {
      const count = partyEngine.proof.audio.played;
      partyEngine.game.playCardAudio({ name: 'sha' }, 'male');
      return count;
    });
    await gameFrame.waitForTimeout(100);
    assert.equal(
      await gameFrame.evaluate(() => partyEngine.proof.audio.played),
      mutedCount,
      'mute prevents playback',
    );
    await phone.locator('#match-sound').tap();
    if (process.env.ENGINE_VERIFY_EXPERIENCE === '1')
      loadingProof.expiredVoices = await verifyLateVoices(gameFrame);
    for (const frame of gameFrames) {
      const boundary = await frame.evaluate(() => ({
        swipe: partyEngine.lib.config.swipe,
        menu: typeof partyEngine.ui.click.configMenu,
      }));
      assert.deepEqual(boundary, { swipe: false, menu: 'undefined' });
    }
    for (const participant of phones) {
      const box = await participant.locator('#game-frame').boundingBox();
      const touch = await participant.context().newCDPSession(participant);
      const point = { x: box.x + box.width / 2, y: box.y + 20 };
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...point, y: point.y + Math.min(240, box.height - 40) }],
      });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await touch.detach();
      const frame = participant.frames().find((frame) => frame.url().includes('/engine/player/'));
      assert(
        await frame.evaluate(
          () =>
            !partyEngine.ui.arena.classList.contains('menupaused') &&
            (partyEngine.ui.menuContainer?.classList.contains('hidden') ?? true),
        ),
        'real downward touch swipe leaves native settings closed',
      );
    }
    const definitions = presets.find(
      (preset) => preset.id === (process.env.ENGINE_VERIFY_PRESET ?? 'beginner'),
    ).definitionPacks;
    const expectedPacks = definitions.characters.slice().sort();
    assert.deepEqual(loadingProof.packs.characters, expectedPacks);
    assert.deepEqual(loadingProof.packs.cards, definitions.cards);
    assert.deepEqual(loadingProof.missingSkills, [], 'every selectable general has native skills');
    const allowedPaths = new Set([
      ...expectedPacks.map((name) => `/engine/core/character/${name}.js`),
      '/engine/core/character/rank.js',
      '/engine/core/character/replace.js',
      '/engine/core/character/perfectPairs.js',
      ...definitions.cards.map((name) => `/engine/core/card/${name}.js`),
    ]);
    for (const request of loadingProof.packRequests)
      assert(allowedPaths.has(request), `unused pack was downloaded: ${request}`);
    assert(loadingProof.packRequests.includes('/engine/core/character/standard.js'));
    if (process.env.ENGINE_VERIFY_SLOW_START === '1')
      assert(
        loadingProof.steps.at(-1).elapsedMs >= 12000,
        'native startup really exceeded ten seconds',
      );
    const concealedAtSource = await privateHandIds(worker, created.playerId);
    const initial = await gameFrame.evaluate((privateIds) => {
      const { game } = partyEngine;
      return {
        ownCards: game.me.getCards('h').filter((card) => card.name !== 'party_unknown').length,
        concealedValues: game.players
          .filter((player) => player !== game.me)
          .flatMap((player) => player.getCards('h'))
          .filter(
            (card) =>
              privateIds.includes(card.cardid) &&
              (card.name !== 'party_unknown' || card.suit !== 'none' || card.number !== 0),
          ).length,
        identities: game.players.map((player) => ({
          self: player === game.me,
          identity: player.identity,
          shown: player.identityShown,
        })),
        secure: isSecureContext,
        ownId: game.me.playerid,
        layout: {
          viewport: [innerWidth, innerHeight],
          zoom: game.documentZoom,
          body: [document.body.offsetWidth, document.body.offsetHeight],
          bodyOrigin: [
            document.body.getBoundingClientRect().x,
            document.body.getBoundingClientRect().y,
          ],
          arenaClass: partyEngine.ui.arena.className,
          arenaOrigin: [
            partyEngine.ui.arena.getBoundingClientRect().x,
            partyEngine.ui.arena.getBoundingClientRect().y,
          ],
          players: game.players.map((player) => {
            const rect = player.getBoundingClientRect();
            return {
              self: player === game.me,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          }),
        },
      };
    }, concealedAtSource);
    assert.equal(
      initial.secure,
      new URL(origin).protocol === 'https:' ||
        ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname),
    );
    assert.equal(initial.ownId, created.playerId);
    assert(initial.ownCards > 0, 'own hand is visible');
    assert.equal(initial.concealedValues, 0, 'opponent concealed values are filtered');
    for (const player of initial.layout.players) {
      assert(player.x >= -1 && player.y >= -1, 'player portrait stays inside the viewport');
      assert(
        player.x + player.width <= initial.layout.viewport[0] + 1,
        'portrait fits horizontally',
      );
      assert(
        player.y + player.height <= initial.layout.viewport[1] + 1,
        'portrait fits vertically',
      );
    }
    const encodedPrivacy = await worker.evaluate((playerId) => {
      const { lib, game, get } = partyEngine;
      const viewer = lib.playerOL[playerId];
      const hidden = game.players
        .filter((player) => player !== viewer)
        .flatMap((player) => player.getCards('h'))
        .find((card) => !card.isKnownBy(viewer));
      const own = viewer.getCards('h')[0];
      if (!hidden || !own) throw new Error('Privacy probe requires real concealed and owned cards');
      const original = [hidden.name, hidden.suit, hidden.number];
      // Native GameEvent.send encodes its parent before entering Client.send.
      const event =
        '_noname_event:' +
        JSON.stringify({
          hidden: get.cardInfoOL(hidden),
          raw: get.cardInfo(hidden),
          own: get.cardInfoOL(own),
          states: game.getState?.() ?? {},
        });
      const client = viewer.ws;
      const send = client.ws.send;
      let captured;
      client.ws.send = (payload) => {
        captured = JSON.parse(payload);
      };
      try {
        client.send('privacy-probe', event);
      } finally {
        client.ws.send = send;
      }
      const encoded = JSON.parse(captured[1].slice('_noname_event:'.length));
      const hiddenInfo = JSON.parse(encoded.hidden.slice('_noname_card:'.length));
      const ownInfo = JSON.parse(encoded.own.slice('_noname_card:'.length));
      const nativeEvent = get.event;
      const nativePosition = get.position;
      const peek = partyEngine.ui.cardPile.firstElementChild;
      const peekSource = [peek.name, peek.suit, peek.number];
      let declared;
      let privatePeek;
      let authorizedPeek;
      let wuguPeek;
      let yajiaoPeek;
      client.ws.send = (payload) => {
        captured = JSON.parse(payload);
      };
      try {
        // Probe only serialization context with real native cards. No game
        // actions, damage, pile order or winner are synthesized.
        get.event = () => ({ name: 'useCard', cards: [hidden], getParent: () => null });
        client.send('declared-card-probe', hidden);
        declared = JSON.parse(captured[1].slice('_noname_card:'.length));
        get.event = () => ({
          name: 'useCard',
          card: { name: 'wugu' },
          wuguShownCards: [peek],
          getParent: () => null,
        });
        client.send('wugu-pool-probe', peek);
        wuguPeek = JSON.parse(captured[1].slice('_noname_card:'.length));
        get.event = () => ({ name: 'reyajiao', card: peek, getParent: () => null });
        client.send('yajiao-reveal-probe', peek);
        yajiaoPeek = JSON.parse(captured[1].slice('_noname_card:'.length));
        get.event = () => ({ name: 'chooseToGuanxing', cards: [peek], getParent: () => null });
        get.position = (card, ...args) =>
          card === peek ? 'o' : nativePosition.call(get, card, ...args);
        client.send('private-ordering-probe', peek);
        privatePeek = JSON.parse(captured[1].slice('_noname_card:'.length));
        viewer.send('authorized-ordering-probe', peek);
        authorizedPeek = JSON.parse(captured[1].slice('_noname_card:'.length));
      } finally {
        get.event = nativeEvent;
        get.position = nativePosition;
        client.ws.send = send;
      }
      return {
        wuguPoolVisible:
          wuguPeek[3] === peek.name && wuguPeek[1] === peek.suit && wuguPeek[2] === peek.number,
        yajiaoFlipVisible:
          yajiaoPeek[3] === peek.name &&
          yajiaoPeek[1] === peek.suit &&
          yajiaoPeek[2] === peek.number,
        declaredCardVisible:
          declared[3] === hidden.name &&
          declared[1] === hidden.suit &&
          declared[2] === hidden.number,
        privateOrderingHidden:
          privatePeek[3] === 'party_unknown' && privatePeek[1] === 'none' && privatePeek[2] === 0,
        authorizedOrderingVisible:
          authorizedPeek[3] === peek.name &&
          authorizedPeek[1] === peek.suit &&
          authorizedPeek[2] === peek.number,
        peekSourceUnchanged: peekSource.every(
          (value, index) => value === [peek.name, peek.suit, peek.number][index],
        ),
        encodedHiddenMasked:
          hiddenInfo[1] === 'none' && hiddenInfo[2] === 0 && hiddenInfo[3] === 'party_unknown',
        rawHiddenMasked:
          encoded.raw[0] === 'none' && encoded.raw[1] === 0 && encoded.raw[2] === 'party_unknown',
        ownVisible: ownInfo[3] === own.name && ownInfo[1] === own.suit && ownInfo[2] === own.number,
        sourceUnchanged: original.every(
          (value, index) => value === [hidden.name, hidden.suit, hidden.number][index],
        ),
        identitiesMasked:
          partyEngine.setup.settings.mode !== 'identity' ||
          Object.entries(encoded.states).every(
            ([id, state]) =>
              id === viewer.playerid ||
              lib.playerOL[id]?.identityShown ||
              state.identity === 'unknown',
          ),
      };
    }, created.playerId);
    for (const [check, passed] of Object.entries(encodedPrivacy)) assert(passed, check);
    const seatProof = await worker.evaluate(() => ({
      count: partyEngine.game.players.length,
      hostInSeats: partyEngine.game.players.includes(partyEngine.game.me),
      chars: partyEngine.game.players.map((player) => player.name),
      rosterLength: partyEngine.proof.roster.length,
      additionalPresent: partyEngine.setup.preset.additionalCharacters.every((name) =>
        partyEngine.proof.roster.includes(name),
      ),
      ...(partyEngine.setup.settings.mode === 'doudizhu'
        ? {
            landlord: {
              hp: partyEngine.game.zhu.maxHp,
              characterHp: partyEngine.get.character(partyEngine.game.zhu.name).maxHp,
              feiyang: partyEngine.game.zhu.hasSkill('feiyang'),
              bahu: partyEngine.game.zhu.hasSkill('bahu'),
            },
          }
        : {}),
    }));
    assert.equal(seatProof.hostInSeats, false);
    assert.equal(seatProof.count, playerCount);
    assert.equal(
      seatProof.rosterLength,
      process.env.ENGINE_VERIFY_GOD_FIXTURE === '1' ||
        process.env.ENGINE_VERIFY_JUDGE_FIXTURE === '1' ||
        process.env.ENGINE_VERIFY_COMPARE_FIXTURE === '1'
        ? 2
        : process.env.ENGINE_VERIFY_PRESET === 'advanced'
          ? 156
          : 33,
    );
    assert(seatProof.additionalPresent);
    if (process.env.ENGINE_VERIFY_LEGACY_HOST === '1')
      assert(
        (await computer.locator('footer').textContent()).includes(`v${APP_VERSION}`),
        '旧电脑页在载入新规则宿主前自动更新',
      );
    if (duplicateComputer)
      assert.equal(
        await duplicateComputer.locator('.engine-worker').count(),
        0,
        '重复电脑页不重复创建规则宿主',
      );
    const networkProof = [];
    for (const [networkIndex, participant] of phones.entries()) {
      await participant.waitForFunction(() => {
        const status = document.querySelector('#match-network');
        return status?.dataset.rtt && Number.isFinite(Number(status.dataset.rtt));
      });
      if (gateway) {
        const expectedRoute =
          process.env.ENGINE_VERIFY_NO_RTC === '1' ||
          (networkIndex > 0 && process.env.ENGINE_VERIFY_MIXED_NETWORK === '1')
            ? 'internet'
            : 'lan';
        await participant.waitForFunction(
          (route) => document.querySelector('#match-network')?.dataset.route === route,
          expectedRoute,
        );
        if (
          expectedRoute === 'internet' &&
          process.env.ENGINE_VERIFY_HTTP !== '1' &&
          process.env.ENGINE_VERIFY_BLOCK_WEBSOCKET !== '1' &&
          process.env.ENGINE_VERIFY_STALL_WEBSOCKET !== '1'
        )
          await participant.waitForFunction(
            () =>
              document.querySelector('#game-frame')?.contentWindow?.partyEngine?.game.ws
                .streamOpen === true,
          );
      }
      const active = participant.frames().find((frame) => frame.url().includes('/engine/player/'));
      await active.waitForFunction(() => {
        const status = document.querySelector('#party-action-status');
        return status?.hidden && getComputedStyle(status).display === 'none';
      });
      networkProof.push(
        await participant.locator('#match-network').evaluate((status) => ({
          route: status.dataset.route,
          rtt: Number(status.dataset.rtt),
          text: status.textContent,
          transport: status.dataset.transport,
        })),
      );
    }
    loadingProof.network = networkProof;
    await computer.waitForFunction(
      (code) =>
        document.querySelector('#console-room-title')?.textContent.includes(code) &&
        document.querySelectorAll('.observer-seat').length > 0,
      created.room.code,
    );
    const publicView = await computer.evaluate(async (code) => {
      const data = await (await fetch('/api/console')).json();
      const entry = data.rooms.find((entry) => entry.room.code === code);
      return {
        observer: entry.observer,
        computerSeat: (await (await fetch('/api/me')).json()).playerId,
      };
    }, created.room.code);
    assert.equal(publicView.computerSeat, null);
    assert.equal(publicView.observer.players.length, playerCount);
    assert(
      publicView.observer.players.every(
        (player) =>
          Number.isInteger(player.handCount) && !('hand' in player) && !('storage' in player),
      ),
    );
    if (mode === 'identity')
      assert(publicView.observer.players.some((player) => player.identity === '身份未公开'));
    loadingProof.publicObserver = {
      seats: publicView.observer.players.length,
      computerHasSeat: false,
      publicOnly: true,
    };
    await computer.screenshot({ path: `${artifactRoot}/${mode}-console.png`, fullPage: true });
    if (process.env.ENGINE_VERIFY_STREAM_DROP === '1') {
      const before = await gameFrame.evaluate(() => partyEngine.game.ws.channel);
      await gameFrame.evaluate(() => partyEngine.game.ws.streamSocket.close());
      await gameFrame.waitForFunction(
        () => partyEngine.game.ws.streamOpen === false && partyEngine.game.ws.readyState === 1,
      );
      assert.equal(await gameFrame.evaluate(() => partyEngine.game.ws.channel), before);
      loadingProof.streamDropKeptChannel = true;
    }
    if (mode === 'doudizhu') {
      assert.equal(seatProof.landlord.hp, seatProof.landlord.characterHp + 1);
      assert(seatProof.landlord.feiyang && seatProof.landlord.bahu);
    }
    await phone.screenshot({ path: `${artifactRoot}/${mode}-playing.png` });
    if (process.env.ENGINE_VERIFY_MANUAL === '1') {
      const delivery = await observeActionDelivery(worker, gameFrames);
      await playOneAction(gameFrames, worker);
      loadingProof.actionDeliveryMs = await delivery();
      console.log(
        mode,
        'touch submission reached the rule worker (ms)',
        loadingProof.actionDeliveryMs,
      );
    }
    if (gateway && process.env.ENGINE_VERIFY_LOCAL_BRIDGE_DROP === '1') {
      const before = await gameFrame.evaluate(() => partyEngine.game.ws.channel);
      await phone.evaluate(() => partyLan.close());
      await gameFrame.waitForFunction(
        () => partyEngine.game.ws.route === 'internet',
        {},
        { timeout: 20000 },
      );
      const after = await gameFrame.evaluate(() => ({
        channel: partyEngine.game.ws.channel,
        ready: partyEngine.game.ws.readyState,
      }));
      assert.equal(after.channel, before, '直连中断保留原通道及序号');
      assert.equal(after.ready, 1);
      loadingProof.directDropKeptChannel = true;
      console.log(mode, 'local peer closed, same polling channel continued over public ingress');
    }
    const previousJudgeDisplays = [];
    if (process.env.ENGINE_VERIFY_RECONNECT) {
      previousJudgeDisplays.push(await gameFrame.evaluate(() => partyJudgeDisplayProof));
      if (process.env.ENGINE_VERIFY_RECONNECT === 'socket') {
        await gameFrame.evaluate(() => {
          globalThis.partyReconnectOld = true;
          partyEngine.game.ws.close();
        });
        await phone.waitForFunction(
          () =>
            document.querySelector('#game-frame')?.contentWindow?.partyEngine &&
            !document.querySelector('#game-frame').contentWindow.partyReconnectOld,
        );
      } else await phone.reload();
      await phone.waitForFunction(
        () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.game.me?.playerid,
      );
      const resumed = phone.frames().find((frame) => frame.url().includes('/engine/player/'));
      await resumed.waitForFunction(
        () =>
          partyEngine.game.me?.name &&
          Object.keys(partyEngine.lib.playerOL).length >= partyEngine.setup.seats.length,
        {},
        { timeout: 20000 },
      );
      const privateAfterReconnect = await privateHandIds(worker, created.playerId);
      const reconnectProof = await resumed.evaluate(
        (privateIds) => ({
          ownId: partyEngine.game.me.playerid,
          ownHand: partyEngine.game.me.getCards('h').map((card) => card.name),
          hiddenLeak: partyEngine.game.players
            .filter((player) => player !== partyEngine.game.me)
            .flatMap((player) => player.getCards('h'))
            .some((card) => privateIds.includes(card.cardid) && card.name !== 'party_unknown'),
        }),
        privateAfterReconnect,
      );
      assert.equal(reconnectProof.ownId, created.playerId);
      assert.equal(reconnectProof.hiddenLeak, false);
      await observeJudgeDisplay(resumed);
      await observePublicDisplay(resumed);
      if (process.env.ENGINE_VERIFY_CACHE === '1') {
        const cached = await resumed.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .filter((entry) => new URL(entry.name).pathname.startsWith('/engine/bundle/'))
            .map((entry) => entry.transferSize),
        );
        assert.deepEqual(cached, [0], 'refresh reuses the full engine bundle from the phone cache');
        loadingProof.warmBundleTransferred = cached[0];
      }
      console.log(mode, 'same-seat refresh reconnected');
    }
    const activeGames = phones.map((participant) =>
      participant.frames().find((frame) => frame.url().includes('/engine/player/')),
    );
    await worker.evaluate(() => {
      partyEngine.lib.config.game_speed = 'vvfast';
      partyEngine.lib.config.duration = 100;
    });
    for (const activeGame of activeGames) {
      await activeGame.evaluate(() => {
        partyEngine.lib.config.game_speed = 'vvfast';
        partyEngine.lib.config.duration = 100;
      });
      await activeGame.evaluate(() => partyEngine.ui.click.auto());
    }
    for (
      let elapsed = 0;
      elapsed < 360 && !(await worker.evaluate(() => partyEngine.proof.ended));
      elapsed += 20
    ) {
      await worker
        .waitForFunction(() => partyEngine.proof.ended, {}, { timeout: 20000 })
        .catch((error) => {
          if (error.name !== 'TimeoutError') throw error;
        });
      if (!(await worker.evaluate(() => partyEngine.proof.ended)))
        console.log(
          mode,
          'native turn progress',
          await worker.evaluate(() => ({
            turns: partyEngine.game.phaseNumber,
            alive: partyEngine.game.players.length,
            errors: partyEngine.proof.errors,
          })),
        );
    }
    assert(await worker.evaluate(() => partyEngine.proof.ended), 'native game must finish');
    await phone
      .locator('#rematch-button')
      .waitFor({ state: 'visible', timeout: process.env.ENGINE_VERIFY_PLAYER_URL ? 30000 : 5000 });
    const ended = await worker.evaluate(() => ({
      publicCards: partyEngine.proof.publicCards,
      errors: partyEngine.proof.errors,
      alive: partyEngine.game.players.length,
      hostInSeats: [...partyEngine.game.players, ...partyEngine.game.dead].includes(
        partyEngine.game.me,
      ),
      cardUses: partyEngine.game.getAllGlobalHistory('useCard').length,
      wuguUses: partyEngine.game
        .getAllGlobalHistory('useCard')
        .filter((event) => event.card?.name === 'wugu').length,
    }));
    assert(ended.cardUses > 0);
    assert(ended.publicCards.opponentThrows > 0, 'an opponent really played public cards');
    assert.equal(ended.publicCards.masked, 0, 'played cards are publicly visible');
    assert.equal(ended.publicCards.wuguMasked, 0, '五谷丰登 wire pool has real card faces');
    assert.equal(ended.publicCards.compareMasked, 0, 'native comparisons reveal declared cards');
    if (process.env.ENGINE_VERIFY_COMPARE_FIXTURE === '1')
      assert(ended.publicCards.compares > 0, 'native skill really compared cards');
    assert.equal(ended.publicCards.judgeFacesIncorrect, 0, 'judge suit, rank and name are public');
    ended.judgeDisplay = [
      ...previousJudgeDisplays,
      ...(await Promise.all(
        activeGames.map((frame) => frame.evaluate(() => partyJudgeDisplayProof)),
      )),
    ];
    ended.publicDisplay = await Promise.all(
      activeGames.map((frame) => frame.evaluate(() => partyPublicDisplayProof)),
    );
    ended.audio = await Promise.all(
      activeGames.map((frame) => frame.evaluate(() => partyEngine.proof.audio)),
    );
    for (const display of ended.publicDisplay) {
      assert.equal(display.wuguConcealed, 0, 'all rendered 五谷丰登 cards are public');
      assert.equal(display.deadIncorrect, 0, 'dead identity text matches the revealed identity');
    }
    for (const audio of ended.audio)
      assert.equal(audio.failures, 0, 'local audio decodes without failures');
    if (mode === 'identity')
      assert(
        ended.publicDisplay.some((display) => display.deadBeforeEnd > 0),
        'death identity is shown during the game, before final settlement',
      );
    for (const display of ended.judgeDisplay) {
      assert.equal(display.concealed, 0, 'rendered public judges have no concealed face class');
      assert.equal(display.missingFace, 0, 'rendered public judges have a suit and rank');
    }
    if (process.env.ENGINE_VERIFY_JUDGE_FIXTURE === '1') {
      assert(ended.publicCards.opponentJudges > 0, 'an opponent really performed a native judge');
      // A refresh splits one phone's observation into two segments. Require
      // actual judge faces on each phone over the complete session.
      const previous = previousJudgeDisplays.reduce((sum, display) => sum + display.cards, 0);
      assert(
        ended.judgeDisplay
          .slice(-activeGames.length)
          .every((display, index) => display.cards + (index === 0 ? previous : 0) > 0),
      );
    }
    assert.equal(ended.hostInSeats, false);
    assert.deepEqual(ended.errors, []);
    await phone.locator('#rematch-button').tap();
    await phone.locator('#game-frame').waitFor({ state: 'detached' });
    if (process.env.ENGINE_VERIFY_SECOND_ROUND === '1') {
      for (const participant of phones) await participant.locator('#ready-button').tap();
      await phone.waitForFunction(() => !document.querySelector('#start-button').disabled);
      await phone.locator('#start-button').tap();
      await phone.waitForFunction(() =>
        document
          .querySelector('#game-frame')
          ?.contentWindow?.location.pathname.startsWith('/engine/player/'),
      );
      const secondId = phone
        .frames()
        .find((frame) => frame.url().includes('/engine/player/'))
        .url()
        .split('/')
        .at(-1);
      assert.notEqual(secondId, currentMatch);
      await computer.waitForFunction(
        (id) =>
          [...document.querySelectorAll('.engine-worker')].some(
            (frame) => frame.src.endsWith(id) && frame.contentWindow?.partyEngine?.proof.hostReady,
          ),
        secondId,
      );
      const nextWorker = computer
        .frames()
        .find((frame) => frame.url().endsWith(`/engine/worker/${secondId}`));
      const nextFrames = phones.map((participant) =>
        participant.frames().find((frame) => frame.url().includes('/engine/player/')),
      );
      await Promise.all(nextFrames.map((frame) => chooseGeneral(frame, nextWorker)));
      await nextWorker.waitForFunction(() => partyEngine.proof.started);
      await nextWorker.evaluate(() => {
        partyEngine.lib.config.game_speed = 'vvfast';
        partyEngine.lib.config.duration = 100;
      });
      for (const frame of nextFrames)
        await frame.evaluate(() => {
          partyEngine.lib.config.game_speed = 'vvfast';
          partyEngine.lib.config.duration = 100;
          partyEngine.ui.click.auto();
        });
      for (
        let elapsed = 0;
        elapsed < 360 && !(await nextWorker.evaluate(() => partyEngine.proof.ended));
        elapsed += 20
      ) {
        await nextWorker
          .waitForFunction(() => partyEngine.proof.ended, {}, { timeout: 20000 })
          .catch((error) => {
            if (error.name !== 'TimeoutError') throw error;
          });
      }
      assert(await nextWorker.evaluate(() => partyEngine.proof.ended));
      await phone.locator('#rematch-button').tap();
      await phone.locator('#game-frame').waitFor({ state: 'detached' });
      console.log(mode, 'second native game completed in the same room');
    }
    closingRooms.add(code);
    await phone.locator('#leave-button').tap();
    for (const friend of phones.slice(1)) await friend.locator('#leave-button').tap();
    results.push({ mode, loadingProof, initial, encodedPrivacy, seatProof, ended });
    console.log(mode, 'completed native game and returned to lobby');
  }
  assert.deepEqual(faults, []);
  assert.deepEqual([...missing], []);
  assert.deepEqual([...external], []);
  const parameters = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith('ENGINE_VERIFY_')),
  );
  const variant = [
    process.env.ENGINE_VERIFY_PRESET ?? 'beginner',
    process.env.ENGINE_VERIFY_MODES?.replaceAll(',', '-') ?? 'all-modes',
    `${process.env.ENGINE_VERIFY_IDENTITY_SEATS ?? 5}seats`,
    `${process.env.ENGINE_VERIFY_HUMANS ?? 1}humans`,
    process.env.ENGINE_VERIFY_MANUAL === '1' ? 'touch' : 'auto',
    process.env.ENGINE_VERIFY_SECOND_ROUND === '1' ? 'rematch' : '',
    process.env.ENGINE_VERIFY_RECONNECT ? `reconnect-${process.env.ENGINE_VERIFY_RECONNECT}` : '',
    process.env.ENGINE_VERIFY_GOD_FIXTURE === '1' ? 'god-fixture' : '',
    process.env.ENGINE_VERIFY_JUDGE_FIXTURE === '1' ? 'judge-fixture' : '',
    process.env.ENGINE_VERIFY_COMPARE_FIXTURE === '1' ? 'compare-fixture' : '',
    process.env.ENGINE_VERIFY_HTTP === '1' ? 'http-transport' : '',
    process.env.ENGINE_VERIFY_BLOCK_WEBSOCKET === '1' ? 'websocket-fallback' : '',
    process.env.ENGINE_VERIFY_STALL_WEBSOCKET === '1' ? 'websocket-timeout' : '',
    process.env.ENGINE_VERIFY_PLAYER_URL ? 'public' : '',
    gateway ? 'lan-bridge' : '',
    process.env.ENGINE_VERIFY_NO_RTC === '1' ? 'no-rtc' : '',
    party ? 'source' : 'portable',
  ]
    .filter(Boolean)
    .join('-');
  await writeFile(
    `${artifactRoot}/result-${variant}.json`,
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        parameters,
        mobileUserAgent,
        results,
        missing: [...missing],
        external: [...external],
      },
      null,
      2,
    ),
  );
  console.log(`Verified artifacts: ${artifactRoot}`);
} catch (error) {
  for (const context of contexts)
    for (const page of context.pages())
      for (const frame of page.frames()) {
        if (frame.url().includes('/engine/'))
          console.log(
            'native diagnostic',
            await frame
              .evaluate(() =>
                globalThis.partyEngine
                  ? {
                      role: partyEngine.setup.role,
                      configMode: partyEngine.lib.config.mode,
                      splash: partyEngine.get.config('show_splash'),
                      allModes: partyEngine.lib.config.all.mode,
                      booted: partyEngine.proof.booted,
                      errors: partyEngine.proof.errors,
                      event: partyEngine._status.event?.name,
                      importedMode: Object.keys(partyEngine.lib.imported.mode ?? {}),
                      audio: partyEngine.proof.audio,
                      stream: {
                        enabled: partyEngine.setup.playerStreaming,
                        open: partyEngine.game.ws?.streamOpen,
                        failure: partyEngine.game.ws?.streamFailure,
                        forcedHttp: sessionStorage.getItem('party_http_transport'),
                      },
                      transport: partyEngine.game.ws
                        ? {
                            readyState: partyEngine.game.ws.readyState,
                            polling: partyEngine.game.ws.polling ?? false,
                          }
                        : null,
                    }
                  : 'not booted',
              )
              .catch(() => 'closed'),
          );
      }
  for (let i = 0; i < contexts.length; i++)
    for (const page of contexts[i].pages())
      await page.screenshot({ path: `${artifactRoot}/failure-${i}.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  gateway?.close();
  party?.stop();
}
