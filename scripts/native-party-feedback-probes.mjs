import assert from 'node:assert/strict';

/** Observe a genuinely dealt match through its public API and native controls. */
export async function verifyPartyFeedback({
  phone,
  worker,
  spectator,
  code,
  matchId,
  mode,
  playerCount,
}) {
  await spectator.goto(new URL(`/join/${code}`, phone.url()).href);
  await spectator.locator('#spectator-panel').waitFor({ state: 'visible' });
  await spectator.waitForFunction(
    (count) => document.querySelectorAll('#spectator-table .observer-seat').length === count,
    playerCount,
  );
  assert.equal(
    await spectator.locator('#game-frame').count(),
    0,
    'spectating never opens a private native client',
  );
  const observation = await spectator.evaluate(
    async ({ code, matchId }) => {
      const me = await (await fetch('/api/me')).json();
      const publicData = await (await fetch(`/engine/observe/${matchId}?room=${code}`)).json();
      return {
        seated: !!me.playerId,
        hasPrivateFields:
          JSON.stringify(publicData).includes('_noname_card:') ||
          ['setup', 'token', 'networks', 'generalSelections'].some((key) => key in publicData),
        players: publicData.observer.players,
        identities: publicData.observer.identityCounts,
      };
    },
    { code, matchId },
  );
  assert(!observation.seated && !observation.hasPrivateFields);
  assert.equal(observation.players.length, playerCount);
  assert(observation.players.every((player) => !('hand' in player) && !('storage' in player)));
  if (mode === 'identity') {
    await phone.locator('#match-identities').waitFor({ state: 'visible' });
    assert(observation.players.some((player) => player.identity === '身份未公开'));
    const expected = { 5: [1, 1, 2, 1], 6: [1, 1, 3, 1], 7: [1, 2, 3, 1], 8: [1, 2, 4, 1] }[
      playerCount
    ];
    const counts = Object.fromEntries(
      ['zhu', 'zhong', 'fan', 'nei'].map((role, index) => [role, expected[index]]),
    );
    const labels = { 主公: 'zhu', 忠臣: 'zhong', 反贼: 'fan', 内奸: 'nei' };
    for (const player of observation.players)
      if (player.dead && labels[player.identity]) counts[labels[player.identity]]--;
    assert.deepEqual(observation.identities, counts);
  } else assert.equal(await phone.locator('#match-identities').isVisible(), false);
  await phone.locator('#match-auto').waitFor({ state: 'visible' });
  await phone.waitForFunction(() => !document.querySelector('#match-auto').disabled);
  if ((await phone.locator('#match-auto').getAttribute('aria-pressed')) === 'true') {
    await phone.locator('#match-auto').tap();
    await phone.waitForFunction(
      () => document.querySelector('#match-auto').textContent === '主动托管',
    );
  }
  await phone.locator('#match-auto').tap();
  await phone.waitForFunction(
    () => document.querySelector('#match-auto').textContent === '恢复手动操作',
  );
  const id = await phone.evaluate(
    () => document.querySelector('#game-frame').contentWindow.partyEngine.setup.playerId,
  );
  await worker.waitForFunction((id) => partyEngine.lib.playerOL[id].isAuto === true, id);
  await phone.locator('#match-auto').tap();
  await phone.waitForFunction(
    () => document.querySelector('#match-auto').textContent === '主动托管',
  );
  await worker.waitForFunction((id) => partyEngine.lib.playerOL[id].isAuto !== true, id);
  await spectator.reload();
  await spectator.waitForFunction(
    (count) => document.querySelectorAll('#spectator-table .observer-seat').length === count,
    playerCount,
  );
  return {
    latePublicSpectator: true,
    spectatorRefresh: true,
    noSpectatorSeatOrPrivateChannel: true,
    publicIdentityCounts: mode === 'identity',
    nativeAutoAndManualButtons: true,
  };
}
