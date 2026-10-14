export async function chooseGeneral(frame, worker, options = {}) {
  const gesture = options.mouse ? 'click' : 'tap';
  const tapChoice = async (locator) => {
    try {
      await locator[gesture]({ timeout: 2000 });
    } catch (error) {
      // A simultaneous teammate confirmation may replace this exact dialog
      // between isVisible and tap. Retry only when that control disappeared.
      if (await locator.isVisible()) throw error;
    }
  };
  await frame.waitForFunction(
    () =>
      globalThis.partyEngine?._status.event?.name === 'chooseButton' && partyEngine._status.paused,
    {},
    { timeout: 120000 },
  );
  let inspectedLuck = false;
  for (
    let attempt = 0;
    attempt < 300 && !(await worker.evaluate(() => partyEngine.proof.started));
    attempt++
  ) {
    if (await frame.evaluate(() => globalThis.partyEngine?.luckState?.active)) {
      if (options.onLuck && !inspectedLuck) {
        inspectedLuck = true;
        frame = (await options.onLuck(frame, worker)) ?? frame;
      }
      // The button stays visible but disabled while its first submission is
      // in flight. A public round trip may span several loop iterations.
      const keep = frame.locator('#party-luck-cards button[data-action="keep"]:enabled');
      if (await keep.isVisible()) await tapChoice(keep);
      await new Promise((resolve) => setTimeout(resolve, 150));
      continue;
    }
    const confirm = frame
      .locator('.control:not(.removing) > div')
      .filter({ hasText: /^确定$/ })
      .first();
    // Shared-pool confirmations can race with a teammate or native AI. The
    // losing submission receives another native general choice, with the same
    // deadline; finish that real UI instead of assuming one dialog per seat.
    if (
      !(await frame.evaluate(
        () => partyEngine._status.event?.name === 'chooseButton' && partyEngine._status.paused,
      ))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      continue;
    }
    const generalChoice = frame.locator(
      '.dialog:not(.removing) .button.character.selectable:not(.selected)',
    );
    if (await generalChoice.first().isVisible()) {
      await tapChoice(generalChoice.first());
      if (await confirm.isVisible()) await tapChoice(confirm);
    }
    const groupChoice = frame
      .locator('.dialog:not(.removing)')
      .filter({ hasText: '请选择你的势力' })
      .locator('.button');
    if (await groupChoice.first().isVisible()) {
      await tapChoice(groupChoice.first());
      if (await confirm.isVisible()) await tapChoice(confirm);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** A real touch selection and native result packet, with no altered cards/HP. */
export async function playOneAction(frames, worker) {
  const before = await worker.evaluate(() =>
    partyEngine.game.players
      .filter((player) => player.ws)
      .map((player) => ({
        id: player.playerid,
        used: player.getAllHistory('useCard').length,
        responded: player.getAllHistory('respond').length,
      })),
  );
  const submitted = new Set();
  for (let attempt = 0; attempt < 100; attempt++) {
    // Finish native follow-up choices on either phone before judging the
    // recorded action. A discard cost alone is not a use/respond result.
    if (
      submitted.size &&
      (await worker.evaluate(
        ({ before, ids }) =>
          before.some((record) => {
            if (!ids.includes(record.id)) return false;
            const player = partyEngine.lib.playerOL[record.id];
            return (
              player.getAllHistory('useCard').length > record.used ||
              player.getAllHistory('respond').length > record.responded
            );
          }),
        { before, ids: [...submitted] },
      ))
    ) {
      console.log('native touch card selection recorded by the rule worker');
      return;
    }
    for (const frame of frames) {
      // A native skill may ask for an optional boolean or target before the
      // first playable card (e.g. 曹叡恢拓 after an opponent's damage). Decline
      // only when the native cancel control is visible; do not resolve a
      // mandatory choice or alter cards just to make this probe advance.
      const eventName = await frame.evaluate(() => partyEngine._status.event?.name);
      if (['chooseBool', 'chooseTarget', 'chooseButton'].includes(eventName)) {
        const cancel = frame
          .locator('.control > div')
          .filter({ hasText: /^取消$/ })
          .first();
        if (await cancel.isVisible()) await cancel.tap();
        continue;
      }
      const selectable = frame
        .locator(
          '.handcards .card.selectable:not(.selected), .handcards1 .card.selectable:not(.selected), .handcards2 .card.selectable:not(.selected)',
        )
        .first();
      if (!(await selectable.isVisible())) {
        // A human may legitimately have no 杀/闪 for a response. Decline
        // through the native control so later turns can offer a card action.
        if (['chooseToUse', 'chooseToRespond'].includes(eventName)) {
          const cancel = frame
            .locator('.control > div')
            .filter({ hasText: /^取消$/ })
            .first();
          if (await cancel.isVisible()) await cancel.tap();
        }
        continue;
      }
      await selectable.tap();
      const confirm = frame
        .locator('.control > div')
        .filter({ hasText: /^确定$/ })
        .first();
      // Global/self-targeting cards already select their native targets. Do not
      // toggle one off merely because it still carries the selectable class.
      if (!(await confirm.isVisible())) {
        const target = frame.locator('.player.selectable:not(.selected)').first();
        if (await target.isVisible()) await target.tap();
      }
      if (!(await confirm.isVisible())) continue;
      const playerId = await frame.evaluate(() => partyEngine.game.me.playerid);
      await confirm.tap();
      if (['chooseToUse', 'chooseToRespond'].includes(eventName)) submitted.add(playerId);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('No manual card action became available');
}
