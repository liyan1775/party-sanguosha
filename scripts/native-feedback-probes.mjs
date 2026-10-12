import assert from 'node:assert/strict';

const desktop = process.env.ENGINE_VERIFY_DESKTOP === '1';
const gesture = desktop ? 'click' : 'tap';

// Known-material fixtures after real selection/dealing. Native choices,
// serialization, privacy and card/skill effects remain on their normal paths.
export async function verifyNativeFeedback({
  phones,
  frames,
  worker,
  output,
  control,
  material,
  target,
}) {
  const waitChoice = (index, name) =>
    frames[index].waitForFunction(
      (name) => partyEngine._status.event.name === name && partyEngine._status.paused,
      name,
    );
  const run = async (kind) => {
    console.log(`feedback: ${kind}`);
    return worker.evaluate((kind) => {
      const { game, lib, ui, _status } = partyEngine;
      const players = game.players.slice();
      const probe = (globalThis.partyFeedbackProbe = { done: false, error: null, kind, cards: {} });
      const event = new lib.element.GameEvent('partyFeedbackFixture', false, _status.eventManager);
      event.player = players[0];
      event.kind = kind;
      event.setContent(async function (event) {
        const { game, lib, ui } = partyEngine;
        const probe = partyFeedbackProbe;
        for (const player of game.players) {
          if (player.countCards('hej')) await player.lose(player.getCards('hej'), ui.discardPile);
          player.stat.push({ card: {}, skill: {}, triggerSkill: {} });
          player.actionHistory.push({
            useCard: [],
            respond: [],
            lose: [],
            gain: [],
            sourceDamage: [],
            damage: [],
            custom: [],
            useSkill: [],
          });
        }
        const generals =
          event.kind === 'wuxie'
            ? ['re_xuzhu', 're_zhaoyun', 're_xuzhu', 're_zhaoyun']
            : [
                event.kind === 'jili' ? 're_xuzhu' : 'ol_sb_jiangwei',
                'shamoke',
                're_xuzhu',
                're_zhaoyun',
              ];
        game.broadcastAll(
          function (players, generals) {
            for (const [index, player] of players.entries()) {
              player.uninit();
              player.init(generals[index]);
            }
          },
          game.players,
          generals,
        );
        const [actor, shamoke, opponent, other] = game.players;
        const card = (key, name, suit, number) => {
          const value = game.createCard(name, suit, number);
          probe.cards[key] = value;
          return value;
        };
        if (event.kind === 'wuxie') {
          actor.directgain([
            card('trick', 'guohe', 'spade', 10),
            card('wuxie', 'wuxie', 'club', 12),
          ]);
          opponent.directgain([card('hidden', 'shan', 'heart', 2)]);
          probe.before = opponent.countCards('h');
          await actor.useCard(probe.cards.trick, opponent);
          probe.selfWuxie = actor
            .getHistory('useCard')
            .some((event) => event.card.name === 'wuxie');
          probe.cancelledTrick = opponent.countCards('h') === probe.before;
        } else if (event.kind === 'jili') {
          actor.directgain([card('wugu', 'wugu', 'heart', 3)]);
          shamoke.directgain([card('jiliWuxie', 'wuxie', 'club', 12)]);
          await actor.useCard(probe.cards.wugu, game.players);
          probe.jiliDrew = shamoke
            .getHistory('gain')
            .some(
              (event) =>
                event.getParent(3)?.name === 'gzjili' ||
                event.getParent('gzjili').name === 'gzjili',
            );
        } else {
          actor.directgain([card('high', 'sha', 'spade', 13), card('reserve', 'shan', 'heart', 3)]);
          opponent.directgain([
            card('low', event.kind === 'zhuri-trick' ? 'guohe' : 'sha', 'club', 1),
            card('other', 'guohe', 'spade', 7),
          ]);
          if (event.kind === 'zhuri-trick')
            shamoke.directgain([
              card('victim', 'shan', 'heart', 2),
              card('victimOther', 'shan', 'spade', 3),
            ]);
          actor.getStat().card.sha = 1;
          const choice = lib.skill.olsbzhuri.content(event, { name: 'phaseUse' }, actor);
          await choice;
          probe.reusedCompare = actor
            .getHistory('useCard')
            .some((used) =>
              used.cards.includes(probe.cards[event.kind === 'zhuri' ? 'high' : 'low']),
            );
          probe.noExtraShaCount = actor.getStat().card.sha === 1;
        }
      });
      _status.eventManager.rootEvent = event;
      void event.start().then(
        () => (probe.done = true),
        (error) => (probe.error = error.message),
      );
      return true;
    }, kind);
  };
  const cardId = (key) => worker.evaluate((key) => partyFeedbackProbe.cards[key]?.cardid, key);
  const done = async () => {
    await worker.waitForFunction(() => partyFeedbackProbe.done || partyFeedbackProbe.error);
    assert.equal(await worker.evaluate(() => partyFeedbackProbe.error), null);
  };
  const refresh = async (index, name) => {
    const id = await frames[index].evaluate(() => partyEngine.game.me.playerid);
    const before = await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id);
    assert.equal(typeof before, 'number');
    await phones[index].reload();
    await phones[index].waitForFunction(
      () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
    );
    frames[index] = phones[index].frames().find((frame) => frame.url().includes('/engine/player/'));
    await waitChoice(index, name);
    assert.equal(
      await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], id),
      before,
    );
  };
  const selectButton = async (index, id) => {
    await frames[index].evaluate((id) => {
      for (const button of partyEngine.ui.dialog.buttons)
        if (button.link?.cardid === id) button.dataset.feedbackCard = id;
    }, id);
    await frames[index].locator(`[data-feedback-card="${id}"].selectable`)[gesture]();
    await control(frames[index], '确定')[gesture]();
  };
  const results = [];
  for (const frame of frames)
    assert.equal(await frame.evaluate(() => partyEngine.lib.config.wuxie_self), false);
  await run('wuxie');
  await waitChoice(0, 'chooseToUse');
  assert.equal(await frames[0].evaluate(() => partyEngine._status.event.type), 'wuxie');
  await material(0, await cardId('wuxie'));
  await control(frames[0], '确定')[gesture]();
  await done();
  assert.equal(
    await worker.evaluate(() => partyFeedbackProbe.selfWuxie && partyFeedbackProbe.cancelledTrick),
    true,
  );
  results.push({ selfTrickWuxie: true });

  await run('jili');
  await waitChoice(1, 'chooseToUse');
  await material(1, await cardId('jiliWuxie'));
  await control(frames[1], '确定')[gesture]();
  await waitChoice(1, 'chooseBool');
  assert.match(await frames[1].evaluate(() => partyEngine.ui.dialog.textContent), /蒺藜/);
  assert.equal(await frames[1].locator('.party-background-dialog .button.card').count(), 4);
  assert.equal(
    await frames[1].locator('.party-background-dialog:not(.removing)').isVisible(),
    false,
  );
  await frames[1].waitForTimeout(600);
  await phones[1].screenshot({ path: `${output}/jili-over-wugu.png` });
  await control(frames[1], '确定')[gesture]();
  let restored = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await worker.evaluate(() => partyFeedbackProbe.done)) break;
    for (const [index, frame] of frames.entries()) {
      if (
        await frame.evaluate(
          () => partyEngine._status.event.name === 'chooseButton' && partyEngine._status.paused,
        )
      ) {
        assert.equal(await frame.locator('.party-background-dialog:not(.removing)').count(), 0);
        restored = true;
        const button = frame.locator('.dialog .button.card.selectable').first();
        if (await button.isVisible()) {
          await button[gesture]();
          await control(frame, '确定')[gesture]();
        }
      } else if (
        await frame.evaluate(
          () =>
            ['chooseToUse', 'chooseBool'].includes(partyEngine._status.event.name) &&
            partyEngine._status.paused,
        )
      ) {
        const cancel = control(frame, '取消');
        if (await cancel.isVisible()) await cancel[gesture]();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await done();
  assert(restored, 'public wugu pool is visible again for its native choice');
  assert.equal(await worker.evaluate(() => partyFeedbackProbe.jiliDrew), true);
  results.push({ jiliOverWugu: true, poolRestored: true, jiliDrew: true });

  const targetId = await frames[2].evaluate(() => partyEngine.game.me.playerid);
  for (const kind of ['zhuri', 'zhuri-opponent', 'zhuri-trick']) {
    await run(kind);
    await waitChoice(0, 'chooseTarget');
    await target(0, targetId);
    await control(frames[0], '确定')[gesture]();
    await Promise.all([waitChoice(0, 'chooseCard'), waitChoice(2, 'chooseCard')]);
    await material(0, await cardId('high'));
    await material(2, await cardId('low'));
    await Promise.all([
      control(frames[0], '确定')[gesture](),
      control(frames[2], '确定')[gesture](),
    ]);
    await waitChoice(0, 'chooseButton');
    await selectButton(0, await cardId(kind === 'zhuri' ? 'high' : 'low'));
    await waitChoice(0, 'chooseTarget');
    if (kind === 'zhuri') {
      await frames[0].waitForTimeout(600);
      await phones[0].screenshot({ path: `${output}/zhuri-use-targets.png` });
      await refresh(0, 'chooseTarget');
    }
    const victimId = await frames[1].evaluate(() => partyEngine.game.me.playerid);
    await target(0, victimId);
    await control(frames[0], '确定')[gesture]();
    if (kind === 'zhuri-trick') {
      // Native guohe can automatically choose among identical blank hand cards.
      // Its real discard still has to complete on the authoritative worker.
      await done();
      assert.equal(await worker.evaluate(() => partyEngine.game.players[1].countCards('h')), 1);
    } else {
      await waitChoice(1, 'chooseToUse');
      await control(frames[1], '取消')[gesture]();
    }
    await done();
    assert.equal(
      await worker.evaluate(
        () => partyFeedbackProbe.reusedCompare && partyFeedbackProbe.noExtraShaCount,
      ),
      true,
    );
    results.push({
      label: kind,
      zhuriWinReusedCard: true,
      reuseRefreshSameDeadline: kind === 'zhuri',
      priorShaCountRetained: true,
    });
  }

  // A mouse and a touch gesture must both work in the native interaction menu.
  const sender = frames[0],
    recipient = targetId;
  await sender.evaluate((id) => {
    const player = partyEngine.lib.playerOL[id];
    partyEngine.ui.click.intro.call(player, { clientX: 250, clientY: 150 });
  }, recipient);
  const menu = sender
    .locator('.popped .menubutton')
    .filter({ hasText: /^鲜花$/ })
    .first();
  for (let repeat = 0; repeat < 3; repeat++) {
    await menu.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  for (const frame of frames) {
    const notice = frame.locator('.party-emotion-notice');
    assert.equal(await notice.getAttribute('data-to'), recipient);
    assert.equal(await notice.getAttribute('data-count'), '3');
    assert.match(await notice.innerText(), /威临验证 → 目标验证：鲜花 ×3/);
  }
  assert(await menu.isVisible());
  await phones[0].screenshot({ path: `${output}/continuous-flower.png` });
  await sender
    .locator('.popped .menubutton')
    .filter({ hasText: /^鸡蛋$/ })
    .first()
    [gesture]();
  await sender.locator('.party-emotion-notice').filter({ hasText: /鸡蛋/ }).waitFor();
  await sender.locator('.poplayer')[gesture]({ position: { x: 5, y: 5 } });
  assert.equal(await sender.locator('.poplayer').count(), 0);
  results.push({
    mouseGifts: true,
    touchGifts: !desktop,
    repeatCount: 3,
    senderAndRecipientShown: true,
    menuClosesOutside: true,
  });

  const phone = phones[0];
  assert.equal(await phone.locator('#match-volume').inputValue(), '35');
  await phone.locator('#match-volume').evaluate((input) => {
    input.value = '15';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await phone.locator('#match-volume-value').innerText(), '15%');
  assert.equal(await sender.evaluate(() => localStorage.getItem('party_sound_volume')), '15');
  await phone.reload();
  await phone.waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyEngine?.proof.booted,
  );
  frames[0] = phone.frames().find((frame) => frame.url().includes('/engine/player/'));
  await phone.locator('#match-volume-value').filter({ hasText: '15%' }).waitFor();
  assert.equal(await phones[1].locator('#match-volume').inputValue(), '35');
  await frames[0].evaluate(() => partyEngine.audio.setVolume(0));
  await phone.locator('#match-volume-value').filter({ hasText: '0%' }).waitFor();
  await phone.locator('#match-sound')[gesture]();
  await phone.locator('#match-volume-value').filter({ hasText: '35%' }).waitFor();
  results.push({ volumeDefault: 35, volumeSavedAfterRefresh: 15, independentPreferences: true });
  return results;
}
