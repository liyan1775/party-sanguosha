import assert from 'node:assert/strict';

export async function chooseGeneral(frame, worker) {
  await frame.waitForFunction(
    () =>
      globalThis.partyEngine?._status.event?.name === 'chooseButton' && partyEngine._status.paused,
    {},
    { timeout: 25000 },
  );
  await frame.locator('.dialog .button.character').first().tap();
  for (
    let attempt = 0;
    attempt < 100 && !(await worker.evaluate(() => partyEngine.proof.started));
    attempt++
  ) {
    const groupChoice = frame
      .locator('.dialog')
      .filter({ hasText: '请选择你的势力' })
      .locator('.button');
    if (await groupChoice.first().isVisible()) await groupChoice.first().tap();
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
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const frame of frames) {
      const selectable = frame
        .locator(
          '.handcards .card.selectable, .handcards1 .card.selectable, .handcards2 .card.selectable',
        )
        .first();
      if (!(await selectable.isVisible())) continue;
      await selectable.tap();
      const target = frame.locator('.player.selectable').first();
      if (await target.isVisible()) await target.tap();
      const confirm = frame
        .locator('.control')
        .filter({ hasText: /^确定$/ })
        .first();
      if (await confirm.isVisible()) await confirm.tap();
      await worker.waitForFunction(
        (before) =>
          before.some((record) => {
            const player = partyEngine.lib.playerOL[record.id];
            return (
              player.getAllHistory('useCard').length > record.used ||
              player.getAllHistory('respond').length > record.responded
            );
          }),
        before,
        { timeout: 8000 },
      );
      assert(true, 'native rule worker recorded the human card action');
      console.log('native touch card selection recorded by the rule worker');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('No manual card action became available');
}
