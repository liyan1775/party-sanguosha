import assert from 'node:assert/strict';

/** Native controls in a genuinely dealt match; UI-only callbacks do not play cards. */
export async function verifyNativeTouchControls({ worker, frame, phone, output, mode }) {
  const viewport = phone.viewportSize();
  const wasPaused = await worker.evaluate(() => {
    const paused = partyEngine._status.paused;
    if (!paused) partyEngine.game.pause();
    return paused;
  });
  await frame.evaluate(() => {
    const { ui } = partyEngine;
    globalThis.partyTouchControlProbe = {
      original: ui.confirm ? { str: ui.confirm.str, custom: ui.confirm.custom } : null,
      actions: [],
    };
    ui.create.confirm('');
    ui.create.confirm('oc', (action) => partyTouchControlProbe.actions.push(action));
  });
  const pair = async () => {
    const group = frame.locator('.party-touch-confirm:not(.removing)');
    await group.waitFor({ state: 'visible' });
    const ok = await group.locator('> div').nth(0).boundingBox();
    const cancel = await group.locator('> div').nth(1).boundingBox();
    const bounds = await group.boundingBox();
    assert(ok && cancel && bounds, 'both native touch buttons are visible');
    return {
      ok,
      cancel,
      bounds,
      gap: Math.max(
        cancel.x - ok.x - ok.width,
        ok.x - cancel.x - cancel.width,
        cancel.y - ok.y - ok.height,
        ok.y - cancel.y - cancel.height,
      ),
      minSide: Math.min(ok.width, ok.height, cancel.width, cancel.height),
    };
  };
  const views = [];
  try {
    // Capture the old native appearance without changing event handlers or
    // authoritative cards. Re-enable the actual adapter sheet immediately.
    await frame.evaluate(() => {
      document.querySelector('#party-touch-confirm-style').sheet.disabled = true;
      partyEngine.ui.updatec();
    });
    await phone.waitForTimeout(600);
    const before = await pair();
    await phone.screenshot({ path: `${output}/${mode}-touch-before.png` });
    await frame.evaluate(() => {
      document.querySelector('#party-touch-confirm-style').sheet.disabled = false;
      partyEngine.ui.updatec();
    });
    for (const size of [
      { width: 844, height: 390 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await phone.setViewportSize(size);
      await phone.waitForTimeout(800);
      const geometry = await pair();
      assert(geometry.gap >= 19, `native touch gap is ${geometry.gap}`);
      // The native press/appearance animation briefly scales a control to
      // 0.97. Check the real hit box, including that transient reduction.
      assert(geometry.minSide >= 44, `native touch target is ${geometry.minSide}`);
      for (const box of [geometry.ok, geometry.cancel]) {
        assert(
          box.x >= -1 &&
            box.y >= -1 &&
            box.x + box.width <= size.width + 1 &&
            box.y + box.height <= size.height + 1,
          'buttons fit the phone viewport',
        );
        assert(
          box.x >= geometry.bounds.x - 1 &&
            box.y >= geometry.bounds.y - 1 &&
            box.x + box.width <= geometry.bounds.x + geometry.bounds.width + 1 &&
            box.y + box.height <= geometry.bounds.y + geometry.bounds.height + 1,
          'the native group encloses both touch targets and the dead space',
        );
      }
      views.push({ viewport: size, gap: geometry.gap, minSide: geometry.minSide });
      await phone.screenshot({ path: `${output}/${mode}-touch-${size.width}x${size.height}.png` });
      if (size.width === 844)
        await frame.locator('.party-touch-confirm:not(.removing)').screenshot({
          path: `${output}/${mode}-touch-buttons.png`,
        });
    }
    const geometry = await pair();
    await phone.touchscreen.tap(
      (geometry.ok.x + geometry.ok.width / 2 + geometry.cancel.x + geometry.cancel.width / 2) / 2,
      (geometry.ok.y + geometry.ok.height / 2 + geometry.cancel.y + geometry.cancel.height / 2) / 2,
    );
    assert.deepEqual(
      await frame.evaluate(() => partyTouchControlProbe.actions),
      [],
      'the gap does not confirm or cancel',
    );
    await frame.locator('.party-touch-confirm:not(.removing) > div').nth(1).tap();
    assert.deepEqual(await frame.evaluate(() => partyTouchControlProbe.actions), ['cancel']);
    // Reuse the very same native control through replace(), whose cached width
    // previously ignored the added gap. The single and pair remain reachable.
    await frame.evaluate(() =>
      partyEngine.ui.create.confirm('o', (action) => partyTouchControlProbe.actions.push(action)),
    );
    await frame.locator('.party-touch-confirm:not(.removing) > div').tap();
    assert.deepEqual(await frame.evaluate(() => partyTouchControlProbe.actions), ['cancel', 'ok']);
    await frame.evaluate(() =>
      partyEngine.ui.create.confirm('oc', (action) => partyTouchControlProbe.actions.push(action)),
    );
    await phone.waitForTimeout(600);
    const reused = await pair();
    assert(reused.gap >= 19 && reused.minSide >= 44);
    const horizontal =
      Math.abs(reused.ok.x - reused.cancel.x) > Math.abs(reused.ok.y - reused.cancel.y);
    assert(
      (horizontal ? reused.bounds.width : reused.bounds.height) + 1 >=
        (horizontal
          ? reused.ok.width + reused.cancel.width
          : reused.ok.height + reused.cancel.height) +
          reused.gap,
      'native group does not clip the reused pair',
    );
    return {
      nativeFactory: true,
      uiFixtureOnly: true,
      before: { gap: before.gap, minSide: before.minSide },
      views,
      gapDoesNotSubmit: true,
      nativeCancelAndOkCallbacks: true,
      reusedPair: true,
    };
  } finally {
    await frame.evaluate(() => {
      const style = document.querySelector('#party-touch-confirm-style');
      if (style?.sheet) style.sheet.disabled = false;
      const { original } = partyTouchControlProbe;
      partyEngine.ui.create.confirm('');
      if (original) partyEngine.ui.create.confirm(original.str, original.custom);
      delete globalThis.partyTouchControlProbe;
    });
    await phone.setViewportSize(viewport);
    if (!wasPaused) await worker.evaluate(() => partyEngine.game.resume());
  }
}
