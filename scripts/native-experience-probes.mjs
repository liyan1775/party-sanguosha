import assert from 'node:assert/strict';

/** Real native constructors/serialization, isolated from the running phase. */
export async function verifyChoicePrompts(worker, frame) {
  const actorId = await frame.evaluate(() => partyEngine.game.me.playerid);
  const choices = await worker.evaluate(async (actorId) => {
    const { lib, game, get, _status } = partyEngine;
    const player = lib.playerOL[actorId];
    const originalManager = _status.eventManager;
    const manager = new originalManager.constructor();
    const originalPause = game.pause;
    const transport = player.ws.ws;
    const originalSend = Object.getOwnPropertyDescriptor(transport, 'send');
    const originalWait = Object.getOwnPropertyDescriptor(player, 'wait');
    let transmitted;
    // Capture the native Client's actual JSON after recipient privacy filtering.
    // Never persist this wire data; the result file contains only case counts.
    transport.send = (text) => {
      transmitted = text;
    };
    player.wait = () => {};
    game.pause = () => {};
    const result = [];
    const sha = (card) => get.name(card) === 'sha';
    const shan = (card) => get.name(card) === 'shan';
    const response = () => player.chooseToRespond().set('filterCard', sha);
    const names = game.players.find((current) => current !== player);
    try {
      for (const [id, parentName, create] of [
        ['南蛮', 'nanman', response],
        ['万箭', 'wanjian', () => player.chooseToRespond().set('filterCard', shan)],
        ['决斗', 'juedou', response],
        [
          '无双决斗',
          'juedou',
          () => response().set('shaRequired', 2).set('prompt2', '共需打出2张杀'),
        ],
        ['普通乱武', 'luanwu', () => player.chooseToUse('乱武：使用一张【杀】或失去1点体力', sha)],
        ['界乱武', 'reluanwu', () => player.chooseToUse('乱武：使用一张【杀】或失去1点体力', sha)],
        [
          '乱武结束',
          'reluanwuContentAfter',
          () => player.chooseUseTarget('sha', '是否使用一张【杀】？', false, 'nodistance'),
        ],
        [
          '护驾',
          'hujia',
          () => player.chooseToRespond({ prompt: '是否替主公打出一张闪？', filterCard: shan }),
        ],
        [
          '激将',
          'jijiang1',
          () => player.chooseToRespond({ prompt: '是否替主公打出一张杀？', filterCard: sha }),
        ],
        [
          '界激将',
          'rejijiang1',
          () => player.chooseToRespond('是否替主公打出一张杀？').set('filterCard', sha),
        ],
        [
          '界挑衅',
          'oltiaoxin',
          () =>
            player.chooseToUse(
              sha,
              `挑衅：对${get.translation(names)}使用一张杀，或令其弃置你的一张牌`,
            ),
        ],
        [
          '界明策',
          'remingce',
          () =>
            player
              .chooseControl()
              .set('choiceList', [
                `视为对${get.translation(names)}使用一张【杀】，若此杀造成伤害则执行选项二`,
                `你与${get.translation(names)}各摸一张牌`,
              ])
              .set('prompt', `对${get.translation(names)}使用一张杀，或摸一张牌`),
        ],
        [
          '溃诛分支',
          'nzry_kuizhu_cost',
          () =>
            player
              .chooseControl('cancel2')
              .set('choiceList', [
                '令至多3名角色摸一张牌',
                '对任意名体力值之和为3的角色造成1点伤害',
              ])
              .set('prompt', '是否发动【溃诛】？'),
        ],
        [
          '飞扬',
          'feiyang_cost',
          () =>
            player.chooseToDiscard(
              'he',
              2,
              '是否发动【飞扬】？',
              '弃置两张牌，然后弃置判定区里的所有牌',
            ),
        ],
        [
          '恩怨',
          'reenyuan2',
          () =>
            player.chooseToGive(
              `恩怨：交给${get.translation(names)}一张手牌，或失去1点体力`,
              'h',
              names,
            ),
        ],
        [
          '借刀',
          'jiedao',
          () =>
            player.chooseToUse(
              `对${get.translation(names)}使用一张杀，或令发动者获得你的武器牌`,
              sha,
            ),
        ],
        [
          '后来赋值卡牌文字',
          'choice-probe',
          () => {
            const event = player.chooseCard('旧提示');
            event.prompt = '请选择装备区的一张牌';
            event.prompt2 = '取消则跳过';
            return event;
          },
        ],
        [
          '后来赋值目标文字',
          'choice-probe',
          () => {
            const event = player.chooseTarget('旧提示');
            event.prompt = '请选择两名其他角色';
            return event.set('selectTarget', [2, 2]);
          },
        ],
        [
          '关闭提示',
          'choice-probe',
          () => {
            const event = player.chooseBool('旧提示');
            event.prompt = false;
            event.prompt2 = false;
            return event;
          },
        ],
        [
          '后来赋值分支',
          'choice-probe',
          () => {
            const event = player.chooseControl('cancel2');
            event.prompt = '选择一项';
            event.choiceList = ['摸两张牌', '回复1点体力'];
            return event;
          },
        ],
        [
          '动态提示',
          'choice-probe',
          () => {
            const event = player.chooseToUse();
            event.prompt = (event) => `当前需要选择${event.selectCard[0]}张牌`;
            return event.set('selectCard', [2, 2]);
          },
        ],
        ['自定义响应文字', 'nanman', () => response().set('prompt', '技能追加的特殊响应条件')],
        ['修改响应过滤', 'nanman', () => player.chooseToRespond().set('filterCard', shan)],
      ]) {
        const parent = new lib.element.GameEvent(parentName, false, manager);
        parent.player = player;
        _status.eventManager = manager;
        manager.rootEvent = parent;
        manager.eventStack = [parent];
        const event = create();
        event.send();
        result.push({
          id,
          wire: transmitted,
          expected: {
            prompt: typeof event.prompt === 'function' ? event.prompt(event) : event.prompt,
            prompt2: event.prompt2,
            choiceList: event.choiceList,
          },
        });
      }
      // Use the actual skill body to construct its native filters. Stop at the
      // first choice's forResult, before any card use, damage or lost HP.
      for (const skill of ['luanwu', 'reluanwu', 'oltiaoxin']) {
        if (typeof lib.skill[skill]?.content !== 'function') continue;
        const originalChoose = Object.getOwnPropertyDescriptor(player, 'chooseToUse');
        const choose = player.chooseToUse;
        const stop = new Error('isolated native choice captured');
        let captured;
        player.chooseToUse = function (...args) {
          const event = choose.apply(this, args);
          event.forResult = () => {
            manager.eventStack = [manager.rootEvent, event];
            event.send();
            const card = { name: 'sha', isCard: true };
            const targets = game.players.filter((target) =>
              event.filterTarget(card, player, target),
            );
            if (skill !== 'oltiaoxin') {
              const minimum = Math.min(
                ...game.players
                  .filter((target) => target !== player)
                  .map((target) => get.distance(player, target)),
              );
              if (
                targets.some(
                  (target) => target === player || get.distance(player, target) !== minimum,
                )
              )
                throw new Error('Luanwu filter conflicts with its nearest-target prompt');
            }
            captured = {
              id: `原生${skill}`,
              wire: transmitted,
              expected: {
                prompt: event.prompt,
                prompt2: event.prompt2,
                choiceList: event.choiceList,
                targets: targets.map((target) => target.playerid).sort(),
              },
            };
            throw stop;
          };
          return event;
        };
        try {
          const parent = new lib.element.GameEvent(skill, false, manager);
          parent.player = names;
          parent.target = player;
          _status.eventManager = manager;
          manager.rootEvent = parent;
          manager.eventStack = [parent];
          try {
            await lib.skill[skill].content(parent, undefined, names);
          } catch (error) {
            if (error !== stop) throw error;
          }
          if (!captured) throw new Error(`Native ${skill} did not construct a choice`);
          result.push(captured);
        } finally {
          if (originalChoose) Object.defineProperty(player, 'chooseToUse', originalChoose);
          else delete player.chooseToUse;
        }
      }
    } finally {
      _status.eventManager = originalManager;
      game.pause = originalPause;
      if (originalSend) Object.defineProperty(transport, 'send', originalSend);
      else delete transport.send;
      if (originalWait) Object.defineProperty(player, 'wait', originalWait);
      else delete player.wait;
    }
    return result;
  }, actorId);
  // Reconstruct precisely as native GameEvent.send does on the phone, then
  // render the original dialog. No synthetic cards, damage or winner are used.
  const displayed = await frame.evaluate((choices) => {
    const { lib, game, ui, get, _status } = partyEngine;
    const originalManager = _status.eventManager;
    const manager = new originalManager.constructor();
    const result = [];
    try {
      for (const choice of choices) {
        _status.eventManager = manager;
        manager.rootEvent = new lib.element.GameEvent('prompt-probe', false, manager);
        manager.rootEvent.player = game.me;
        manager.eventStack = [manager.rootEvent];
        const packet = JSON.parse(choice.wire);
        if (packet[0] !== 'exec') throw new Error('Expected native choice packet');
        const [name, args, set, parent] = packet.slice(2).map((item) => get.parsedResult(item));
        const event = game.me[name](...args);
        for (const [key, value] of set) event.set(key, value);
        event._modparent = parent;
        manager.eventStack = [manager.rootEvent, event];
        const prompt = typeof event.prompt === 'function' ? event.prompt(event) : event.prompt;
        const dialog = ui.create.dialog(prompt === false ? 'hidden' : prompt);
        if (event.prompt2) dialog.addText(event.prompt2);
        if (event.choiceList) for (const text of event.choiceList) dialog.addText(text);
        result.push({
          id: choice.id,
          text: dialog.textContent,
          prompt,
          prompt2: event.prompt2,
          choiceList: event.choiceList,
          targets: choice.expected.targets
            ? game.players
                .filter((target) =>
                  event.filterTarget({ name: 'sha', isCard: true }, game.me, target),
                )
                .map((target) => target.playerid)
                .sort()
            : undefined,
        });
        dialog.close();
      }
    } finally {
      _status.eventManager = originalManager;
    }
    return result;
  }, choices);
  for (let index = 0; index < choices.length; index++)
    for (const key of ['prompt', 'prompt2', 'choiceList', 'targets'])
      assert.deepEqual(
        displayed[index][key],
        choices[index].expected[key],
        `${choices[index].id}:${key} survives native serialization`,
      );
  const text = Object.fromEntries(displayed.map((item) => [item.id, item.text]));
  assert.match(text['南蛮'], /南蛮入侵.*【杀】.*伤害/);
  assert.match(text['万箭'], /万箭齐发.*【闪】.*伤害/);
  assert.match(text['决斗'], /决斗.*【杀】.*伤害/);
  assert.match(text['无双决斗'], /决斗.*【杀】.*共需打出2张杀/);
  for (const id of ['普通乱武', '界乱武'])
    assert.match(text[id], /距离最近.*失去1点体力.*合法目标/);
  assert.match(text['乱武结束'], /乱武结束.*视为使用.*无距离限制.*取消则跳过.*无需提供手牌/);
  assert.match(text['界挑衅'], /使用一张【杀】并造成伤害，否则.*弃置/);
  assert.match(text['界明策'], /明策.*无需提供.*各摸一张牌/);
  assert.match(text['溃诛分支'], /至多3名.*体力值之和为3/);
  assert.match(text['飞扬'], /弃置两张牌.*判定区里的所有牌/);
  assert.match(text['恩怨'], /交给.*手牌.*失去1点体力/);
  assert.match(text['借刀'], /使用一张杀.*获得你的武器牌/);
  assert.equal(text['自定义响应文字'], '技能追加的特殊响应条件');
  assert(!text['修改响应过滤'].includes('【杀】'));
  return {
    nativeSerializedChoices: choices.length,
    nativeDialogs: displayed.length,
    nativeSkillChoices: choices.filter((choice) => choice.id.startsWith('原生')).length,
  };
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
