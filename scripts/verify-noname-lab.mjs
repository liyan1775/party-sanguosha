import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { chromium } from '@playwright/test';
import { startEngineLab } from '../packages/noname-adapter/lab/serve.mjs';

const lanAddress =
  process.env.ENGINE_LAB_LAN_ADDRESS ??
  Object.values(networkInterfaces())
    .flat()
    .find(
      (address) =>
        address?.family === 'IPv4' &&
        !address.internal &&
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address),
    )?.address;
if (!lanAddress) throw new Error('A private LAN IPv4 address is required for the HTTP proof.');
await mkdir('.runtime/noname-lab', { recursive: true });
const results = [];
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge' });

async function scenario(humanCount) {
  const lab = await startEngineLab({ host: '0.0.0.0', humanCount });
  const origin = `http://${lanAddress}:${lab.port}`;
  const contexts = [];
  const faults = [];
  const missing = new Set();
  const external = new Set();
  async function page(mobile) {
    const context = await browser.newContext(
      mobile ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } : {},
    );
    contexts.push(context);
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.add(route.request().url());
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => faults.push(String(error)));
    page.on('dialog', async (dialog) => {
      faults.push(`Unexpected dialog: ${dialog.message().slice(0, 120)}`);
      await dialog.dismiss();
    });
    page.on('response', (response) => {
      if (response.status() >= 400) missing.add(new URL(response.url()).pathname);
    });
    return page;
  }
  try {
    const host = await page(false);
    await host.goto(origin);
    await host.waitForFunction(() => partyEngineLab.proof.hostReady, {}, { timeout: 20000 });
    assert.equal(
      await host.evaluate(() => isSecureContext),
      false,
      'Must exercise ordinary LAN HTTP',
    );
    const phones = [];
    for (let index = 1; index <= humanCount; index++) {
      const phone = await page(true);
      phones.push(phone);
      await phone.goto(`${origin}/?role=human-${index}`);
    }
    for (const phone of phones) {
      await phone.waitForFunction(
        () =>
          globalThis.partyEngineLab?._status.event?.name === 'chooseButton' &&
          partyEngineLab._status.paused,
        {},
        { timeout: 20000 },
      );
      await phone.locator('.dialog .button.character').first().tap();
    }
    await host.waitForFunction(() => partyEngineLab.proof.started, {}, { timeout: 20000 });
    const initial = await host.evaluate(() => {
      const { game } = partyEngineLab;
      return {
        ids: game.players.map((player) => player.playerid),
        characters: game.players.map((player) => player.name),
        hostInSeats: game.players.includes(game.me),
      };
    });
    assert.equal(initial.hostInSeats, false);
    assert.equal(initial.ids.length, 2);
    assert.equal(new Set(initial.characters).size, 2);
    for (let index = 0; index < phones.length; index++) {
      assert.equal(
        await phones[index].evaluate(() => partyEngineLab.game.me.playerid),
        `human-${index + 1}`,
      );
    }
    // The adapter preserves card IDs/counts but strips concealed values.
    const visibility = await phones[0].evaluate(() => {
      const { game } = partyEngineLab;
      const opponent = game.players.find((player) => player !== game.me);
      return {
        opponentCards: opponent.countCards('h'),
        serializedOpponentValues: opponent
          .getCards('h')
          .filter(
            (card) => card.name !== 'party_unknown' || card.suit !== 'none' || card.number !== 0,
          ).length,
      };
    });
    assert.equal(visibility.serializedOpponentValues, 0);
    console.log(
      `${humanCount} human + ${2 - humanCount} native AI: native character choice and start confirmed`,
    );
    // Exercise native auto, including the native online result / resume path.
    // We do not synthesize damage, hands, responses or victory.
    for (const phone of phones) await phone.evaluate(() => partyEngineLab.ui.click.auto());
    for (
      let elapsed = 0;
      elapsed < 240 && !(await host.evaluate(() => partyEngineLab.proof.ended));
      elapsed += 20
    ) {
      await host
        .waitForFunction(() => partyEngineLab.proof.ended, {}, { timeout: 20000 })
        .catch((error) => {
          if (error.name !== 'TimeoutError') throw error;
        });
      if (!(await host.evaluate(() => partyEngineLab.proof.ended)))
        console.log(`Native turns running (${humanCount} human case, ${elapsed + 20}s)`);
    }
    const outcome = await host.evaluate(() => {
      const { proof, game } = partyEngineLab;
      const participants = game.players.concat(game.dead);
      return {
        ...proof,
        participants: participants.map((player) => ({
          id: player.playerid,
          character: player.name,
          secondary: player.name2 ?? null,
          alive: player.isAlive(),
        })),
        cardUses: participants.reduce(
          (sum, player) =>
            sum +
            player.stat.reduce(
              (total, turn) =>
                total + Object.values(turn.card ?? {}).reduce((count, value) => count + value, 0),
              0,
            ),
          0,
        ),
        hostInSeats: participants.includes(game.me),
      };
    });
    assert.equal(outcome.ended, true, 'Native death / victory must finish the match');
    assert.equal(outcome.winners.length, 1);
    assert.equal(outcome.participants.length, 2);
    assert.equal(outcome.hostInSeats, false);
    assert.ok(outcome.participants.every((player) => player.secondary === null));
    assert.ok(outcome.cardUses > 0);
    assert.deepEqual(outcome.errors, []);
    assert.deepEqual(faults, []);
    assert.equal(external.size, 0, 'Offline runtime must not call external services');
    for (const phone of phones)
      await phone.waitForFunction(() => partyEngineLab._status.over, {}, { timeout: 10000 });
    assert.equal(missing.size, 0, 'The standard-pack proof must load its resources');
    await phones[0].screenshot({ path: `.runtime/noname-lab/${humanCount}-human-result.png` });
    const result = {
      humanCount,
      nativeAI: 2 - humanCount,
      secureContext: false,
      initial,
      outcome,
      visibility,
      missing: [...missing],
      external: [...external],
    };
    results.push(result);
    console.log(
      `Native duel completed; ${outcome.cardUses} card uses, one winner, computer outside all seats.`,
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await lab.close();
  }
}

try {
  await scenario(1);
  await scenario(2);
  await writeFile(
    '.runtime/noname-lab/result.json',
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        scope: 'Development lab only, human selects then native auto plays',
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
}
