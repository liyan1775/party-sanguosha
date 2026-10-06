import assert from 'node:assert/strict';

const tableFrame = (phone) =>
  phone.frames().find((frame) => frame.url().includes('/engine/table/'));
const mirrorFrame = (desktop, id) =>
  desktop
    .frames()
    .find(
      (frame) =>
        frame.url().includes('/engine/view/') &&
        new URL(frame.url()).searchParams.get('seat') === id,
    );

/** Exercise the product's native UI, with no computer selection mirror. */
export async function verifyNativePrivateChoices({ kind, worker, phones, playerId, output }) {
  assert(['poxi', 'gongxin-discard', 'gongxin-top'].includes(kind));
  const nativeFrame = (phone) =>
    phone.frames().find((frame) => frame.url().includes('/engine/player/'));
  let first = nativeFrame(phones[0]);
  for (let attempt = 0; attempt < 200; attempt++) {
    const phase = await first.evaluate(() => partyEngine._status.event?.name);
    if (phase === 'chooseToUse' && (await first.evaluate(() => partyEngine._status.paused))) break;
    if (phase === 'chooseBool') {
      const cancel = first
        .locator('.control > div')
        .filter({ hasText: /^取消$/ })
        .first();
      if (await cancel.isVisible()) await cancel.tap();
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await first.waitForFunction(
    () => partyEngine._status.event?.name === 'chooseToUse' && partyEngine._status.paused,
  );
  const fixture = await worker.evaluate((id) => {
    const { game, lib } = partyEngine;
    const actor = lib.playerOL[id];
    const target = game.players.find((player) => player !== actor);
    const own = [game.createCard('sha', 'spade', 7), game.createCard('shan', 'heart', 2)];
    const enemy = [
      game.createCard('tao', 'diamond', 3),
      game.createCard('wuxie', 'club', 12),
      game.createCard('shan', 'heart', 9),
    ];
    actor.directgain(own);
    target.directgain(enemy);
    partyEngine.privateChoiceProbe = { actor, target, own, enemy };
    return {
      targetId: target.playerid,
      ownIds: own.map((card) => card.cardid),
      enemyIds: enemy.map((card) => card.cardid),
    };
  }, playerId);
  await first.waitForFunction(
    (ids) =>
      ids.every((id) => partyEngine.game.me.getCards('h').some((card) => card.cardid === id)),
    fixture.ownIds,
  );
  const skill = kind === 'poxi' ? '魄袭' : '攻心';
  await first
    .locator('.control > div')
    .filter({ hasText: new RegExp('^' + skill + '$') })
    .first()
    .tap();
  const targetIndex = await first.evaluate(
    (id) => [...document.querySelectorAll('.player')].findIndex((node) => node.playerid === id),
    fixture.targetId,
  );
  const target = first.locator('.player').nth(targetIndex);
  await target.and(first.locator('.selectable')).waitFor();
  await target.tap();
  await target.and(first.locator('.selected')).waitFor();
  const confirm = () =>
    first
      .locator('.control > div')
      .filter({ hasText: /^确定$/ })
      .first();
  // Selecting a skill and target must not use it before the native OK control.
  assert.equal(await first.evaluate(() => partyEngine._status.event.name), 'chooseToUse');
  await confirm().tap();
  const phase = kind === 'poxi' ? 'chooseButton' : 'chooseToMove_new';
  await first.waitForFunction(
    (phase) => partyEngine._status.event.name === phase && partyEngine._status.imchoosing,
    phase,
  );
  const materials = () =>
    first.evaluate(() => {
      const dialog = partyEngine._status.event.dialog;
      return [...dialog.querySelectorAll('.button.card')].map((button) => ({
        id: button.link.cardid,
        name: button.link.name,
        suit: button.link.suit,
        number: button.link.number,
      }));
    });
  const before = await materials();
  assert(
    before.every((card) => card.name !== 'party_unknown' && card.suit !== 'none' && card.number),
  );
  if (kind === 'poxi') {
    const groups = await first.evaluate(
      () =>
        [...partyEngine._status.event.dialog.querySelectorAll('.buttons')].filter((pool) =>
          pool.querySelector('.button.card'),
        ).length,
    );
    assert.equal(groups, 2, 'native poxi retains separate hand rows');
    assert(
      (await first.evaluate(() => partyEngine._status.event.dialog.innerText)).includes('你的手牌'),
    );
  } else {
    assert.equal(
      await first.evaluate(() => partyEngine._status.event.dialog.itemContainers.length),
      7,
    );
    assert(
      (await first.evaluate(() => partyEngine._status.event.dialog.innerText)).includes(
        '置于牌堆顶',
      ),
    );
  }
  for (const phone of phones.slice(1)) {
    assert(
      await nativeFrame(phone).evaluate(
        ({ actorId, targetId, ownIds, enemyIds }) => {
          const { lib, game } = partyEngine;
          return [
            ...(game.me.playerid === actorId
              ? []
              : lib.playerOL[actorId].getCards('h').filter((card) => ownIds.includes(card.cardid))),
            ...(game.me.playerid === targetId
              ? []
              : lib.playerOL[targetId]
                  .getCards('h')
                  .filter((card) => enemyIds.includes(card.cardid))),
          ].every((card) => card.name === 'party_unknown');
        },
        { actorId: playerId, ...fixture },
      ),
      'uninvolved native clients retain concealed hands',
    );
  }
  assert(
    await worker.evaluate(async () => {
      const { observerCardVisible } = await import('/engine/runtime/observer.js');
      return [...partyEngine.privateChoiceProbe.own, ...partyEngine.privateChoiceProbe.enemy].every(
        (card) => !observerCardVisible(card),
      );
    }),
    'public observation retains private materials',
  );
  const originalDeadline = await worker.evaluate(
    (id) => partyEngine.lib.node.torespondtimeout[id],
    playerId,
  );
  assert(originalDeadline, 'the private skill has a native deadline');
  await phones[0].reload();
  await phones[0].waitForFunction(
    (phase) => {
      const engine = document.querySelector('#game-frame')?.contentWindow?.partyEngine;
      return engine?._status.event?.name === phase && engine._status.imchoosing;
    },
    phase,
    { timeout: 30000 },
  );
  first = nativeFrame(phones[0]);
  assert.deepEqual(
    await materials(),
    before,
    'refresh restores exactly the authorized choice materials',
  );
  assert.equal(
    await worker.evaluate((id) => partyEngine.lib.node.torespondtimeout[id], playerId),
    originalDeadline,
    'skill recovery retains the original deadline',
  );
  await phones[0].setViewportSize({ width: 844, height: 390 });
  await first.locator('.dialog').evaluateAll(async (nodes) => {
    await Promise.all(
      nodes
        .flatMap((node) => node.getAnimations())
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await phones[0].screenshot({ path: output + '/' + kind + '-native-private-choice.png' });
  const button = (id) =>
    first.locator('.dialog .button.card').nth(before.findIndex((card) => card.id === id));
  if (kind === 'poxi') {
    for (const id of fixture.ownIds) {
      await button(id).tap();
      await button(id).and(first.locator('.selected')).waitFor();
    }
    assert.equal(
      await button(fixture.enemyIds[2]).and(first.locator('.selectable')).count(),
      0,
      'same-suit materials remain disabled',
    );
    for (const id of fixture.enemyIds.slice(0, 2)) {
      await button(id).tap();
      await button(id).and(first.locator('.selected')).waitFor();
    }
    assert(
      await worker.evaluate(() => {
        const { actor, target, own, enemy } = partyEngine.privateChoiceProbe;
        return (
          own.every((card) => actor.getCards('h').includes(card)) &&
          enemy.every((card) => target.getCards('h').includes(card))
        );
      }),
      'selecting poxi materials must not discard before OK',
    );
    await confirm().tap();
    await worker.waitForFunction(() => {
      const { actor, target, own, enemy } = partyEngine.privateChoiceProbe;
      return (
        own.every((card) => !actor.getCards('h').includes(card)) &&
        enemy.slice(0, 2).every((card) => !target.getCards('h').includes(card)) &&
        target.getCards('h').includes(enemy[2])
      );
    });
  } else {
    const zone = (index) => first.locator('.dialog .item-container').nth(2 * (index + 1));
    // Native move dialogs overlap cards when the pool is wide. Touch the
    // exposed left edge, as a player would, instead of the covered center.
    await button(fixture.enemyIds[0]).tap({ position: { x: 5, y: 15 } });
    await button(fixture.enemyIds[0]).and(first.locator('.selected')).waitFor();
    await zone(1).tap();
    assert.equal(
      await first.evaluate(() => partyEngine._status.event.moved[1].length),
      0,
      'non-heart cannot move to discard',
    );
    await button(fixture.enemyIds[2]).tap({ position: { x: 5, y: 15 } });
    await button(fixture.enemyIds[2]).and(first.locator('.selected')).waitFor();
    const destination = kind === 'gongxin-top' ? 2 : 1;
    await zone(destination).tap();
    await first.waitForFunction(
      (destination) =>
        !partyEngine._status.event.dialog.isBusy &&
        partyEngine._status.event.moved[destination].length === 1,
      destination,
    );
    assert(
      await worker.evaluate(() =>
        partyEngine.privateChoiceProbe.target
          .getCards('h')
          .includes(partyEngine.privateChoiceProbe.enemy[2]),
      ),
      'moving a card must not commit before OK',
    );
    await confirm().tap();
    await worker.waitForFunction(
      () =>
        !partyEngine.privateChoiceProbe.target
          .getCards('h')
          .includes(partyEngine.privateChoiceProbe.enemy[2]),
    );
    assert(
      await worker.evaluate((destination) => {
        const card = partyEngine.privateChoiceProbe.enemy[2];
        return destination === 2
          ? partyEngine.ui.cardPile.firstChild === card
          : card.parentNode === partyEngine.ui.discardPile;
      }, destination),
      'native skill resolves to the correct destination',
    );
  }
  await first.waitForFunction(
    () => partyEngine._status.event.name === 'chooseToUse' && partyEngine._status.paused,
  );
  await phones[0].setViewportSize({ width: 390, height: 844 });
  console.log(skill + ': 原生牌面、分区、显式确认、同材料/同期限刷新、旁人隐私和技能结算通过');
  return {
    skill,
    authorizedFaces: true,
    separateZones: true,
    explicitConfirmation: true,
    refreshKeepsMaterialsAndDeadline: true,
    otherSeatsPrivate: true,
  };
}

/** Real native choices; only candidates and supplemental test cards are fixed. */
export async function verifyPrivateChoices({ kind, desktop, worker, phones, playerId, output }) {
  assert(['poxi', 'gongxin-discard', 'gongxin-top'].includes(kind));
  let first = tableFrame(phones[0]);
  for (let attempt = 0; attempt < 200; attempt++) {
    const current = await first.evaluate(() => ({
      phase: partyTable.state.phase,
      choosing: partyTable.state.choosing,
      cancel: partyTable.state.controls.some((item) => item.label === '不发动'),
    }));
    if (current.phase === 'chooseToUse' && current.choosing) break;
    if (current.choosing && current.cancel)
      await first
        .locator('#controls button')
        .filter({ hasText: /^不发动$/ })
        .tap();
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await first.waitForFunction(
    () => partyTable.state.phase === 'chooseToUse' && partyTable.state.choosing,
  );
  const fixture = await worker.evaluate((id) => {
    const { game, lib } = partyEngine;
    const actor = lib.playerOL[id];
    const target = game.players.find((player) => player !== actor);
    const own = [game.createCard('sha', 'spade', 7), game.createCard('shan', 'heart', 2)];
    const enemy = [
      game.createCard('tao', 'diamond', 3),
      game.createCard('wuxie', 'club', 12),
      game.createCard('shan', 'heart', 9),
    ];
    actor.directgain(own);
    target.directgain(enemy);
    partyEngine.privateChoiceProbe = { own, enemy, actor, target };
    return {
      targetId: target.playerid,
      ownIds: own.map((card) => card.cardid),
      enemyIds: enemy.map((card) => card.cardid),
    };
  }, playerId);
  await first.waitForFunction(() =>
    partyTable.state.hand.some(
      (item) => item.label === '闪' && item.number === '2' && item.suit === '♥',
    ),
  );
  const skill = kind === 'poxi' ? '魄袭' : '攻心';
  await first
    .locator('#controls button')
    .filter({ hasText: new RegExp(`^${skill}$`) })
    .tap();
  await first
    .locator(`#opponents [data-player-id="${fixture.targetId}"].selectable-seat`)
    .waitFor();
  await first.locator(`#opponents [data-player-id="${fixture.targetId}"] .player-face`).tap();
  await first.locator(`#opponents [data-player-id="${fixture.targetId}"].selected-seat`).waitFor();
  await first
    .locator('#controls button')
    .filter({ hasText: /^使用$/ })
    .tap();
  await first.waitForFunction(
    (kind) =>
      partyTable.state.choosing &&
      partyTable.state.phase === (kind === 'poxi' ? 'chooseButton' : 'chooseToMove_new'),
    kind,
  );
  if (kind === 'poxi') {
    await first.locator('.choice-group').nth(1).waitFor();
    const groups = await first.evaluate(
      () => partyTable.state.dialogs.find((dialog) => dialog.groups?.length === 2).groups,
    );
    assert.equal(groups[0].label, '你的手牌');
    assert(groups[1].label.endsWith('的手牌'));
    assert(groups[1].items.every((item) => item.label !== '暗牌' && item.suit && item.number));
  } else {
    await first.locator('.move-zone').nth(2).waitFor();
    const zones = await first.evaluate(
      () => partyTable.state.dialogs.find((dialog) => dialog.zones.length === 3).zones,
    );
    assert(zones[0].items.every((item) => item.label !== '暗牌' && item.suit && item.number));
    assert.deepEqual(
      zones.slice(1).map((zone) => zone.label),
      ['弃置', '置于牌堆顶'],
    );
  }
  // A fresh native serialization to each other seat must retain concealed faces.
  for (const phone of phones.slice(1)) {
    const otherId = await tableFrame(phone).evaluate(() => partyTable.state.playerId);
    const hidden = await mirrorFrame(desktop, otherId).evaluate(
      ({ actorId, targetId, ownIds, enemyIds }) => {
        const { lib } = partyEngine;
        const own = lib.playerOL[actorId]
          .getCards('h')
          .filter((card) => ownIds.includes(card.cardid));
        const enemy =
          targetId === partyEngine.game.me.playerid
            ? []
            : lib.playerOL[targetId].getCards('h').filter((card) => enemyIds.includes(card.cardid));
        return [...own, ...enemy].every((card) => card.name === 'party_unknown');
      },
      { actorId: playerId, ...fixture },
    );
    assert(hidden, 'uninvolved seats must not receive the revealed faces');
  }
  assert(
    await worker.evaluate(async () => {
      const { observerCardVisible } = await import('/engine/runtime/observer.js');
      return [...partyEngine.privateChoiceProbe.own, ...partyEngine.privateChoiceProbe.enemy].every(
        (card) => !observerCardVisible(card),
      );
    }),
    'computer public observer stays private during the choice',
  );
  const before = await first.evaluate(() => ({
    epoch: partyTable.state.epoch,
    choice: partyTable.state.choice,
    dialogs: partyTable.state.dialogs,
  }));
  await phones[0].reload();
  await phones[0].waitForFunction(
    () => document.querySelector('#game-frame')?.contentWindow?.partyTable?.state?.choosing,
  );
  first = tableFrame(phones[0]);
  assert.deepEqual(
    await first.evaluate(() => ({
      epoch: partyTable.state.epoch,
      choice: partyTable.state.choice,
      dialogs: partyTable.state.dialogs,
    })),
    before,
  );
  await phones[0].setViewportSize({ width: 844, height: 390 });
  await first.locator('.choice-section').evaluateAll(async (nodes) => {
    await Promise.all(
      nodes
        .flatMap((node) => node.getAnimations())
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await phones[0].screenshot({ path: `${output}/${kind}-private-choice.png` });
  await phones[0].setViewportSize({ width: 390, height: 844 });
  // The actual deal can contain the same face as a supplemental card. Match
  // physical test cards to their native button positions, then use the phone's
  // ephemeral UI keys; card IDs stay in this local verifier, out of the protocol.
  const positions = await mirrorFrame(desktop, playerId).evaluate(
    ({ kind, ownIds, enemyIds }) => {
      const dialog = partyEngine._status.event.dialog;
      const pools =
        kind === 'poxi'
          ? [...dialog.querySelectorAll('.buttons')].filter((pool) =>
              pool.querySelector('.button.card'),
            )
          : [dialog.itemContainers[2]];
      const locate = (pool, ids) =>
        ids.map((id) =>
          [...pool.querySelectorAll('.button')].findIndex((button) => button.link.cardid === id),
        );
      return {
        own: kind === 'poxi' ? locate(pools[0], ownIds) : [],
        enemy: locate(pools[kind === 'poxi' ? 1 : 0], enemyIds),
      };
    },
    { kind, ...fixture },
  );
  assert([...positions.own, ...positions.enemy].every((position) => position >= 0));
  const materials = await first.evaluate(
    ({ kind, positions }) => {
      const dialog = partyTable.state.dialogs.find((dialog) =>
        kind === 'poxi' ? dialog.groups?.length === 2 : dialog.zones.length === 3,
      );
      const own = kind === 'poxi' ? dialog.groups[0].items : [];
      const enemy = kind === 'poxi' ? dialog.groups[1].items : dialog.zones[0].items;
      return {
        own: positions.own.map((position) => own[position]),
        enemy: positions.enemy.map((position) => enemy[position]),
      };
    },
    { kind, positions },
  );
  assert.deepEqual(
    materials.enemy.map((item) => [item.label, item.suit, item.number]),
    [
      ['桃', '♦', '3'],
      ['无懈可击', '♣', 'Q'],
      ['闪', '♥', '9'],
    ],
  );
  const materialButton = (item) => first.locator(`#choice-content button[data-key="${item.key}"]`);
  async function select(item) {
    const button = materialButton(item);
    await button.tap();
    await button.and(first.locator('[aria-pressed="true"]')).waitFor();
  }
  if (kind === 'poxi') {
    assert.deepEqual(
      materials.own.map((item) => [item.label, item.suit, item.number]),
      [
        ['杀', '♠', '7'],
        ['闪', '♥', '2'],
      ],
    );
    await select(materials.own[0]);
    await select(materials.own[1]);
    await first.waitForFunction(
      () =>
        partyTable.state.dialogs
          .flatMap((dialog) => dialog.groups ?? [])
          .flatMap((group) => group.items)
          .filter((item) => item.selected).length === 2,
    );
    assert.equal(
      await materialButton(materials.enemy[2]).getAttribute('data-action'),
      '',
      'same-suit materials stay disabled',
    );
    await select(materials.enemy[0]);
    await select(materials.enemy[1]);
    assert(
      await worker.evaluate(() => {
        const { own, enemy, actor, target } = partyEngine.privateChoiceProbe;
        return (
          own.every((card) => actor.getCards('h').includes(card)) &&
          enemy.every((card) => target.getCards('h').includes(card))
        );
      }),
      'selecting four cards must not discard before confirmation',
    );
    await first
      .locator('#controls button')
      .filter({ hasText: /^确定$/ })
      .tap();
    await worker.waitForFunction(() => {
      const { own, enemy, actor, target } = partyEngine.privateChoiceProbe;
      return (
        own.every((card) => !actor.getCards('h').includes(card)) &&
        enemy.slice(0, 2).every((card) => !target.getCards('h').includes(card)) &&
        target.getCards('h').includes(enemy[2])
      );
    });
  } else {
    const source = first.locator('.move-zone').nth(0);
    // Native permits selecting a non-heart but refuses moving it.
    await select(materials.enemy[0]);
    await first.locator('.move-zone').nth(1).locator('.move-destination').tap();
    await first.waitForFunction(() =>
      partyTable.state.dialogs
        .flatMap((dialog) => dialog.zones)
        .flatMap((zone) => zone.items)
        .every((item) => !item.selected),
    );
    assert.equal(
      await first.evaluate(
        () =>
          partyTable.state.dialogs.find((dialog) => dialog.zones.length === 3).zones[1].items
            .length,
      ),
      0,
    );
    await select(materials.enemy[2]);
    await source.locator('.selected').waitFor();
    const destination = kind === 'gongxin-top' ? 2 : 1;
    await first.locator('.move-zone').nth(destination).locator('.move-destination').tap();
    await first.waitForFunction(
      (destination) =>
        partyTable.state.dialogs.some((dialog) => dialog.zones[destination]?.items.length === 1),
      destination,
    );
    assert(
      await worker.evaluate(() =>
        partyEngine.privateChoiceProbe.target
          .getCards('h')
          .includes(partyEngine.privateChoiceProbe.enemy[2]),
      ),
      'moving a card in the choice is not yet a discard',
    );
    await first
      .locator('#controls button')
      .filter({ hasText: /^确定$/ })
      .tap();
    await worker.waitForFunction(
      () =>
        !partyEngine.privateChoiceProbe.target
          .getCards('h')
          .includes(partyEngine.privateChoiceProbe.enemy[2]),
    );
    assert(
      await worker.evaluate((destination) => {
        const card = partyEngine.privateChoiceProbe.enemy[2];
        return destination === 2
          ? partyEngine.ui.cardPile.firstChild === card
          : card.parentNode === partyEngine.ui.discardPile;
      }, destination),
      'native discard/top-deck destination must be correct',
    );
  }
  await first.waitForFunction(
    () => partyTable.state.phase === 'chooseToUse' && partyTable.state.choosing,
  );
  console.log(`${skill}: 真实牌面、分区、刷新、原生筛选与结算、旁人/公开观战隐私通过`);
}
