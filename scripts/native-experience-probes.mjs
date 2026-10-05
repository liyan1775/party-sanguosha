import assert from 'node:assert/strict';

/** Real native constructors/serialization, isolated from the running phase. */
export async function verifyChoicePrompts(worker, frame) {
  const choices = await worker.evaluate(() => {
    const { lib, game, _status } = partyEngine;
    const player = game.players.find((current) => current.ws);
    const originalManager = _status.eventManager;
    const manager = new originalManager.constructor();
    const originalPause = game.pause;
    const originalSend = Object.getOwnPropertyDescriptor(player, 'send');
    const originalWait = Object.getOwnPropertyDescriptor(player, 'wait');
    let transmitted;
    player.send = (_fn, name, args, set) => {
      transmitted = { name, args, set };
    };
    player.wait = () => {};
    game.pause = () => {};
    const result = [];
    try {
      for (const [parentName, choice, args] of [
        ['nanman', 'chooseToRespond', []],
        ['wanjian', 'chooseToRespond', []],
        ['reluanwu', 'chooseToUse', ['乱武：使用一张【杀】或失去1点体力']],
        [
          'reluanwuContentAfter',
          'chooseUseTarget',
          ['sha', '是否使用一张【杀】？', false, 'nodistance'],
        ],
      ]) {
        const parent = new lib.element.GameEvent(parentName, false, manager);
        parent.player = player;
        _status.eventManager = manager;
        manager.rootEvent = parent;
        manager.eventStack = [parent];
        const event = player[choice](...args);
        event.send();
        result.push({
          name: transmitted.name,
          args: transmitted.args,
          text: transmitted.set.filter(([key]) => ['prompt', 'prompt2'].includes(key)),
        });
      }
    } finally {
      _status.eventManager = originalManager;
      game.pause = originalPause;
      if (originalSend) Object.defineProperty(player, 'send', originalSend);
      else delete player.send;
      if (originalWait) Object.defineProperty(player, 'wait', originalWait);
      else delete player.wait;
    }
    return result;
  });
  // Reconstruct precisely as native GameEvent.send does on the phone, then
  // render the original dialog. No synthetic cards, damage or winner are used.
  const displayed = await frame.evaluate((choices) => {
    const { lib, game, ui, _status } = partyEngine;
    const originalManager = _status.eventManager;
    const manager = new originalManager.constructor();
    const result = [];
    try {
      for (const choice of choices) {
        _status.eventManager = manager;
        manager.rootEvent = new lib.element.GameEvent('prompt-probe', false, manager);
        manager.rootEvent.player = game.me;
        manager.eventStack = [manager.rootEvent];
        const event = game.me[choice.name](...choice.args);
        for (const [key, text] of choice.text) event.set(key, text);
        const dialog = ui.create.dialog(event.prompt);
        if (event.prompt2) dialog.addText(event.prompt2);
        result.push(dialog.textContent);
        dialog.close();
      }
    } finally {
      _status.eventManager = originalManager;
    }
    return result;
  }, choices);
  assert.match(displayed[0], /南蛮入侵.*【杀】.*伤害/);
  assert.match(displayed[1], /万箭齐发.*【闪】.*伤害/);
  assert.match(displayed[2], /距离最近.*失去1点体力.*合法目标/);
  assert.match(displayed[3], /乱武结束.*视为使用.*无距离限制.*取消则跳过.*无需提供手牌/);
  return { nativeSerializedChoices: choices.length, nativeDialogs: displayed.length };
}

export async function verifyLateVoices(frame) {
  const proof = await frame.evaluate(async () => {
    const { game, audio, proof } = partyEngine;
    await audio.unlock();
    const before = proof.audio.dropped;
    let played = 0;
    const nativeFetch = window.fetch;
    window.fetch = async (...args) => {
      if (String(args[0]).includes('audio/skill/luanwu1.mp3'))
        await new Promise((resolve) => setTimeout(resolve, 2200));
      return nativeFetch(...args);
    };
    try {
      for (let count = 0; count < 20; count++)
        game.playAudio({
          path: 'skill/luanwu1',
          onPlay: () => {
            played++;
          },
        });
      // Wait for real fetch + decode; a passed deadline alone proves nothing.
      for (let attempt = 0; attempt < 200 && proof.audio.dropped - before < 20; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      return { played, dropped: proof.audio.dropped - before };
    } finally {
      window.fetch = nativeFetch;
    }
  });
  assert.equal(proof.played, 0, 'delayed historical voices never burst into playback');
  assert(proof.dropped >= 20, 'all twenty expired voices completed and were discarded');
  return proof;
}

export async function observeActionDelivery(worker, frames) {
  await worker.evaluate(() => {
    const { lib, proof } = partyEngine;
    proof.actionReceivedAt = {};
    const receive = lib.message.server.result;
    lib.message.server.result = function (...args) {
      proof.actionReceivedAt[this.id] = Date.now();
      return receive.apply(this, args);
    };
  });
  for (const frame of frames)
    await frame.evaluate(() => {
      const { game, proof } = partyEngine;
      const send = game.send;
      game.send = function (...args) {
        if (args[0] === 'result') proof.actionSubmittedAt = Date.now();
        return send.apply(this, args);
      };
    });
  return async () => {
    const received = await worker.evaluate(() => partyEngine.proof.actionReceivedAt);
    const submitted = await Promise.all(
      frames.map((frame) =>
        frame.evaluate(() => ({
          id: partyEngine.game.me.playerid,
          at: partyEngine.proof.actionSubmittedAt,
        })),
      ),
    );
    const elapsed = submitted
      .filter((action) => action.at && received[action.id])
      .map((action) => received[action.id] - action.at);
    assert(elapsed.length > 0);
    assert(elapsed.every((time) => time >= 0));
    return elapsed;
  };
}
