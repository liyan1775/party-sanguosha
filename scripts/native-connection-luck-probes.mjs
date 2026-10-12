import assert from 'node:assert/strict';

const table = (page) => page.frames().find((frame) => frame.url().includes('/engine/player/'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real UI and rule execution, retaining card IDs only inside the test browser. */
export async function verifyLuckCards(frame, worker) {
  const page = frame.page();
  const id = await frame.evaluate(() => partyEngine.game.me.playerid);
  const first = await frame.evaluate(() => ({ ...partyEngine.luckState }));
  assert.equal(first.remaining, 3);
  await worker.evaluate((id) => {
    const player = partyEngine.lib.playerOL[id];
    partyEngine.luckQA = {
      count: player.countCards('h'),
      hand: player.getCards('h').map((card) => card.cardid),
      draws: 0,
    };
  }, id);
  const refresh = async (remaining) => {
    await frame.locator('#party-luck-cards button[data-action="refresh"]').tap();
    await frame.waitForFunction(
      (remaining) => partyEngine.luckState?.remaining === remaining,
      remaining,
    );
    const aggregate = await worker.evaluate((id) => {
      const player = partyEngine.lib.playerOL[id];
      const next = player.getCards('h').map((card) => card.cardid);
      const proof = partyEngine.luckQA;
      const changed = next.every((card) => !proof.hand.includes(card));
      const count = player.countCards('h');
      proof.hand = next;
      proof.draws++;
      return { changed, count, originalCount: proof.count };
    }, id);
    assert.equal(aggregate.changed, true, 'the entire original hand was replaced');
    assert.equal(aggregate.count, aggregate.originalCount);
    await frame.waitForFunction(
      (count) => {
        const cards = [...document.querySelectorAll('#me .card')];
        return (
          cards.length === count &&
          cards.every((card) => {
            const box = card.getBoundingClientRect();
            const style = getComputedStyle(card);
            return (
              box.width > 40 &&
              box.height > 50 &&
              box.right > 0 &&
              box.left < innerWidth &&
              box.bottom > 0 &&
              box.top < innerHeight &&
              card.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
              Number(style.opacity) >= 0.95 &&
              style.visibility !== 'hidden'
            );
          })
        );
      },
      aggregate.count,
      { timeout: 5000 },
    );
  };
  await refresh(2);
  // Replay the already accepted native action. It cannot consume another use.
  await frame.evaluate(
    (epoch) => partyEngine.game.send('partyLuck', epoch, 0, 'refresh'),
    first.epoch,
  );
  await wait(400);
  assert.equal(await frame.evaluate(() => partyEngine.luckState.remaining), 2);
  const before = await frame.evaluate(() => partyEngine.luckState.remainingMs);
  await frame.evaluate(() => partyEngine.game.ws.close(4000, '测试短暂断线'));
  await page.locator('#match-connection.blocking').waitFor({ state: 'visible' });
  await page
    .locator('#match-connection-title')
    .filter({ hasText: '已恢复连接' })
    .waitFor({ state: 'visible', timeout: 15000 });
  frame = table(page);
  await frame.waitForFunction(
    () => partyEngine.luckState?.active && partyEngine.luckState.remaining === 2,
  );
  const resumed = await frame.evaluate(() => ({ ...partyEngine.luckState }));
  assert.equal(resumed.epoch, first.epoch);
  assert(resumed.remainingMs < before - 500, 'reconnect keeps the original stage deadline');
  assert.equal(await frame.evaluate(() => partyEngine.game.me.playerid), id);
  await refresh(1);
  await page.screenshot({ path: `${process.env.PARTY_EXPERIENCE_OUTPUT}/luck-cards.png` });
  await refresh(0);
  await frame.evaluate(
    (epoch) => partyEngine.game.send('partyLuck', epoch, 3, 'refresh'),
    first.epoch,
  );
  await wait(300);
  const limited = await worker.evaluate((id) => {
    const player = partyEngine.lib.playerOL[id];
    return player.getCards('h').every((card) => partyEngine.luckQA.hand.includes(card.cardid));
  }, id);
  assert.equal(limited, true, 'a fourth refresh is rejected');
  console.log(
    'experience: three full-hand refreshes, duplicate/fourth rejection and reconnect deadline verified',
  );
  return frame;
}

export async function verifyConnectionAndEmotions(page, worker, allPages, output) {
  let frame = table(page);
  const id = await frame.evaluate(() => partyEngine.game.me.playerid);
  // Drop actual native delivery on this client while /api/health still works.
  // This models a silent game downlink failure, not a signalled socket close.
  await frame.evaluate(() => {
    partyEngine.game.ws.deliver = () => {};
  });
  assert.equal((await page.request.get(new URL('/api/health', page.url()).href)).status(), 200);
  await page
    .locator('#match-connection-title')
    .filter({ hasText: '没有响应' })
    .waitFor({ state: 'visible', timeout: 20000 });
  assert.equal(await page.locator('#game-frame').getAttribute('inert'), '');
  await page.screenshot({ path: `${output}/silent-connection.png` });
  await page
    .locator('#match-connection-title')
    .filter({ hasText: /已恢复连接|你正在托管/ })
    .waitFor({ state: 'visible', timeout: 30000 });
  frame = table(page);
  assert.equal(await frame.evaluate(() => partyEngine.game.me.playerid), id);
  assert.equal(await page.locator('#game-frame').getAttribute('inert'), null);
  // An actual offline browser closes its game transport and visibly retries.
  const offlineStarted = Date.now();
  await page.context().setOffline(true);
  await page.locator('#match-connection.blocking').waitFor({ state: 'visible' });
  await wait(22000);
  // HTTP retains its bounded channel for 45 seconds when an offline phone
  // cannot deliver DELETE, followed by the same 20-second native grace.
  await worker.waitForFunction((id) => partyEngine.lib.playerOL[id].ws.closed, id, {
    timeout: 60000,
  });
  const offlineSeconds = Math.ceil((Date.now() - offlineStarted) / 1000);
  await page.context().setOffline(false);
  await page
    .locator('#match-connection-title')
    .filter({ hasText: /已恢复连接|你正在托管/ })
    .waitFor({ state: 'visible', timeout: 20000 });
  assert(
    /AI 可能已行动|AI 正在替你操作/.test(
      await page.locator('#match-connection-detail').textContent(),
    ),
  );
  frame = table(page);
  assert.equal(await frame.evaluate(() => partyEngine.game.me.playerid), id);
  // Toggle native auto, then reclaim through the outer phone button.
  await frame.evaluate(() => {
    if (!partyEngine._status.auto) partyEngine.ui.click.auto('forced');
  });
  await page.locator('#match-manual').waitFor({ state: 'visible' });
  await page.locator('#match-manual').tap();
  await worker.waitForFunction((id) => !partyEngine.lib.playerOL[id].isAuto, id);
  await page.locator('#match-connection').waitFor({ state: 'hidden' });
  // Use the existing touch intro and native authenticated emotion command.
  const touch = await page.context().newCDPSession(page);
  for (const name of ['flower', 'egg']) {
    const targetId = await frame.evaluate(
      () => partyEngine.game.players.find((player) => player !== partyEngine.game.me).playerid,
    );
    // Resolve the native name area without assuming screen order. The avatar
    // has a separate double-click character/skin action; this is the intro.
    const position = await frame.evaluate(
      (id) => partyEngine.lib.playerOL[id].dataset.position,
      targetId,
    );
    const intro = await frame
      .locator(`.player[data-position="${position}"] .name`)
      .first()
      .boundingBox();
    assert(intro);
    // Native touch intros open on a 500ms long press, not a short avatar tap.
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: intro.x + intro.width / 2, y: intro.y + intro.height / 2 }],
    });
    await wait(650);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(500);
    const emotion = frame
      .locator('.intro .menubutton, .dialog .menubutton, .popped .menubutton')
      .filter({ hasText: name === 'flower' ? /^鲜花$/ : /^鸡蛋$/ })
      .first();
    await emotion.tap({ timeout: 5000 });
    assert.equal(
      await emotion.isVisible(),
      true,
      'emotion menu remains available for consecutive gifts',
    );
    await Promise.all(
      allPages.map(async (participant) => {
        const current = table(participant);
        await current
          .locator(`.party-emotion[data-emotion="${name}"] svg`)
          .waitFor({ state: 'visible', timeout: 5000 });
        assert.equal(
          await current
            .locator('.party-emotion')
            .evaluateAll((nodes) =>
              nodes.every((node) => getComputedStyle(node).pointerEvents === 'none'),
            ),
          true,
        );
      }),
    );
    await page.screenshot({ path: `${output}/${name}.png` });
    await frame.locator('.poplayer').tap({ position: { x: 5, y: 5 } });
    assert.equal(
      await frame.locator('.poplayer').count(),
      0,
      'closing emotion menu releases touch shield',
    );
    await wait(1800);
    assert.equal(await frame.locator('.party-emotion').count(), 0);
  }
  await touch.detach();
  console.log(
    `experience: silent downlink, ${offlineSeconds}-second offline, manual reclaim and two broadcast SVG emotions verified`,
  );
  return {
    silentDownlink: true,
    offlineSeconds,
    sameSeat: true,
    manualReclaim: true,
    emotions: ['flower', 'egg'],
  };
}
