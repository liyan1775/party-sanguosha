// SPDX-License-Identifier: GPL-3.0-only
import { game, get, lib } from 'noname';

const chuanyun = 'party_shanhetu_nm_665';
const echou = 'party_shanhetu_nm_1324';
const snake = echou + '_snake';
const eyi = 'party_shanhetu_nm_3296';
const evilReady = eyi + '_ready';
const cangxin = 'party_shanhetu_nm_3314';
const shuanghun = 'party_shanhetu_nm_14046';
const chengxiong = 'party_shanhetu_nm_14055';
const zhouxue = 'party_shanhetu_nm_14060';
const snow = zhouxue + '_seal';
const cuanchao = 'party_shanhetu_nm_14069';
const tiepao = 'party_shanhetu_nm_14075';
const cannon = tiepao + '_distance';

// Seat IDs and counts represent publicly applied effects. No cards or histories are projected.
function updateSources(player, skill, source, change) {
  const sources = new Map(player.getStorage(skill));
  if (change === null) sources.delete(source.playerid);
  else
    sources.set(source.playerid, skill === snow ? 1 : (sources.get(source.playerid) ?? 0) + change);
  game.broadcastAll(
    function (target, skill, pairs) {
      if (!pairs.length) {
        target.removeSkill(skill);
        return;
      }
      target.storage[skill] = pairs;
      target.addSkill(skill);
      target.markSkill(skill, null, null, true);
    },
    player,
    skill,
    [...sources],
  );
}

function expiresAtSourceTurn(skill) {
  return {
    charlotte: true,
    forced: true,
    popup: false,
    onremove: true,
    trigger: { global: 'phaseBeginStart' },
    filter(event, player) {
      return player.getStorage(skill).some(([id]) => id === event.player.playerid);
    },
    async content(event, trigger, player) {
      updateSources(player, skill, trigger.player, null);
    },
  };
}

function cannonMaterial(card, player, source) {
  return (
    game.checkMod(card, player, 'unchanged', 'cardEnabled2', player) !== false &&
    player.canUse(get.autoViewAs({ name: 'sha' }, [card]), source)
  );
}

export function collectNightmareRoadState(player) {
  const state = {};
  if (player.countMark(snake) > 0) state.snake = player.countMark(snake);
  if (player.hasSkill(evilReady)) state.evil = true;
  if (player.awakenedSkills?.includes(shuanghun)) state.soulSpent = true;
  if (player.storage[cuanchao] === true) state.yin = true;
  for (const [skill, key] of [
    [snow, 'snow'],
    [cannon, 'cannon'],
  ]) {
    if (player.hasSkill(skill))
      state[key] = player.getStorage(skill).map(([id, count]) => [id, count]);
  }
  return Object.keys(state).length ? state : undefined;
}

export function restoreNightmareRoadState(player, state) {
  if (Number.isSafeInteger(state?.snake) && state.snake > 0) {
    player.addSkill(snake);
    player.storage[snake] = state.snake;
    player.markSkill(snake, null, null, true);
  } else if (player.hasSkill(snake)) player.removeSkill(snake);
  if (state?.evil === true) player.addTempSkill(evilReady);
  else if (player.hasSkill(evilReady)) player.removeSkill(evilReady);
  if (
    state?.soulSpent === true &&
    player.skills.includes(shuanghun) &&
    !player.awakenedSkills.includes(shuanghun)
  )
    player.awakenSkill(shuanghun);
  if (player.skills.includes(cuanchao)) {
    player.storage[cuanchao] = state?.yin === true;
    player.markSkill(cuanchao, null, null, true);
  }
  for (const [skill, key] of [
    [snow, 'snow'],
    [cannon, 'cannon'],
  ]) {
    const pairs = Array.isArray(state?.[key])
      ? state[key].filter(
          (entry) =>
            Array.isArray(entry) &&
            typeof entry[0] === 'string' &&
            Object.hasOwn(lib.playerOL, entry[0]) &&
            Number.isSafeInteger(entry[1]) &&
            entry[1] > 0,
        )
      : [];
    if (pairs.length) {
      player.storage[skill] = pairs;
      player.addSkill(skill);
      player.markSkill(skill, null, null, true);
    } else if (player.hasSkill(skill)) player.removeSkill(skill);
  }
}

export function installNightmareRoadSkills(recordUse) {
  lib.skill[chuanyun] = {
    trigger: { player: 'phaseJieshuBegin' },
    filter: (event, player) =>
      game.hasPlayer((target) => target.side !== player.side && target.hp > player.hp),
    async cost(event, trigger, player) {
      event.result = await player
        .chooseTarget(
          get.prompt2(chuanyun),
          (card, player, target) => target.side !== player.side && target.hp > player.hp,
        )
        .set('ai', (target) => get.damageEffect(target, get.player(), get.player()))
        .forResult();
    },
    async content(event, trigger, player) {
      recordUse(chuanyun);
      await event.targets[0].damage(player);
    },
  };
  lib.skill[echou] = {
    trigger: { global: 'useCard' },
    forced: true,
    filter: (event, player) => event.player !== player && ['tao', 'jiu'].includes(event.card.name),
    async content(event, trigger) {
      recordUse(echou);
      trigger.player.addSkill(snake);
      trigger.player.addMark(snake, 1);
    },
  };
  lib.skill[snake] = {
    charlotte: true,
    forced: true,
    marktext: '毒',
    intro: { content: '有#枚蛇毒。准备阶段弃等量牌或失去等量体力，随后移去一枚。' },
    onremove: true,
    trigger: { player: 'phaseZhunbeiBegin' },
    filter: (event, player) => player.countMark(snake) > 0,
    async content(event, trigger, player) {
      const count = player.countMark(snake);
      const cost = await player
        .chooseToDiscard('he', count, '蛇毒：弃置' + count + '张牌，否则失去' + count + '点体力')
        .set('poisonStacks', count)
        .set(
          'ai',
          (card) => (get.player().hp <= get.event().poisonStacks ? 100 : 9) - get.value(card),
        )
        .forResult();
      if (!cost.bool) await player.loseHp(count);
      player.removeMark(snake, 1);
      if (!player.countMark(snake)) player.removeSkill(snake);
    },
  };
  lib.translate[snake] = '蛇毒';
  lib.skill[eyi] = {
    forced: true,
    trigger: { player: 'phaseBegin' },
    filter: (event, player) => player.hp === player.maxHp,
    async content(event, trigger, player) {
      player.addTempSkill(evilReady);
    },
  };
  lib.skill[evilReady] = {
    charlotte: true,
    forced: true,
    trigger: { player: 'useCard' },
    mark: true,
    marktext: '袭',
    intro: { content: '本回合首张杀不能被目标响应。' },
    filter: (event) => event.card.name === 'sha',
    async content(event, trigger, player) {
      recordUse(eyi);
      trigger.directHit.addArray(game.players);
      player.removeSkill(evilReady);
    },
  };
  lib.translate[evilReady] = '恶意';
  lib.skill[cangxin] = {
    forced: true,
    trigger: { player: ['phaseDrawBegin', 'damageBegin4'] },
    filter(event, player, name) {
      return name === 'phaseDrawBegin' || lib.skill.olcangxin.filter(event, player);
    },
    async content(event, trigger, player) {
      recordUse(cangxin);
      const cards = get.bottomCards(3, true);
      if (!cards.length) return;
      await player.showCards(cards, '藏心：展示牌堆底的牌');
      if (event.triggername === 'phaseDrawBegin') {
        const count = cards.filter((card) => get.suit(card, false) === 'heart').length;
        if (count) await player.draw(count);
        return;
      }
      const result = await player
        .chooseButton(
          ['藏心：弃置任意张底牌，每弃一张红桃可减1点伤害', cards],
          [0, cards.length],
          true,
          'allowChooseAll',
        )
        .set('ai', (button) =>
          get.suit(button.link, false) === 'heart' && get.event().reduce ? 1 : 0,
        )
        .set('reduce', get.damageEffect(player, trigger.source, player) <= 0)
        .forResult();
      if (!result.bool || !result.links.length) return;
      await game.cardsDiscard(result.links);
      const hearts = result.links.filter((card) => get.suit(card, false) === 'heart').length;
      trigger.num = Math.max(0, trigger.num - hearts);
    },
  };
  lib.skill[shuanghun] = {
    forced: true,
    limited: true,
    trigger: { player: 'dying' },
    skillAnimation: true,
    filter: (event, player) => player.hp <= 0 && !player.awakenedSkills.includes(shuanghun),
    async content(event, trigger, player) {
      recordUse(shuanghun);
      player.awakenSkill(shuanghun);
      if (player.isLinked()) await player.link(false);
      if (player.isTurnedOver()) await player.turnOver(false);
      await player.recoverTo(player.maxHp);
      await player.drawTo(player.maxHp);
      if (game.hasPlayer((target) => target !== player && target.side === player.side))
        player.restoreSkill(shuanghun);
    },
  };
  lib.skill[chengxiong] = {
    forced: true,
    trigger: { source: 'damageBegin1' },
    filter: (event) => game.roundNumber > 0 && event.num > 0,
    async content(event, trigger) {
      recordUse(chengxiong);
      trigger.num += game.roundNumber % 2 === 1 ? 1 : -1;
    },
  };
  lib.skill[zhouxue] = {
    forced: true,
    trigger: { source: 'damageSource' },
    filter: (event, player) => event.player !== player && event.player.isIn(),
    async content(event, trigger, player) {
      recordUse(zhouxue);
      updateSources(trigger.player, snow, player, 1);
    },
  };
  lib.skill[snow] = {
    ...expiresAtSourceTurn(snow),
    mark: true,
    marktext: '雪',
    intro: { content: '手牌上限为0，不能获得护甲。各来源的咒雪在其下次回合开始时失效。' },
    mod: { maxHandcardFinal: () => 0 },
    group: snow + '_armor',
    subSkill: {
      armor: {
        charlotte: true,
        forced: true,
        firstDo: true,
        trigger: { player: 'changeHujiaBefore' },
        filter: (event) => event.num > 0,
        async content(event, trigger) {
          trigger.cancel();
        },
      },
    },
  };
  lib.translate[snow] = '咒雪';
  lib.skill[cuanchao] = {
    zhuanhuanji: true,
    mark: true,
    marktext: '☯',
    intro: {
      content: (storage) =>
        storage
          ? '阴：成为锦囊牌目标时，可令此牌对你无效。'
          : '阳：成为基本牌目标时，可令此牌对你无效。',
    },
    trigger: { target: 'useCardToTargeted' },
    filter: (event, player) =>
      get.type2(event.card) === (player.storage[cuanchao] ? 'trick' : 'basic') &&
      !event.getParent('useCard').excluded.includes(player),
    check: (event, player) => get.effect(player, event.card, event.player, player) < 0,
    async content(event, trigger, player) {
      recordUse(cuanchao);
      trigger.getParent('useCard').excluded.add(player);
      player.changeZhuanhuanji(cuanchao);
      game.broadcast(
        function (target, skill, value) {
          target.storage[skill] = value;
          target.markSkill(skill, null, null, true);
        },
        player,
        cuanchao,
        player.storage[cuanchao],
      );
    },
  };
  lib.skill[tiepao] = {
    trigger: { player: 'damageEnd' },
    filter: (event, player) =>
      event.source &&
      event.source !== player &&
      event.source.isIn() &&
      player.hasCard((card) => cannonMaterial(card, player, event.source), 'hes'),
    async cost(event, trigger, player) {
      event.result = await player
        .chooseCard('hes', 1, get.prompt2(tiepao, trigger.source), (card, owner) =>
          lib.skill.party_shanhetu_nm_14075.material(card, owner, get.event().attacker),
        )
        .set('attacker', trigger.source)
        .set('ai', (card) =>
          get.effect(get.event().attacker, { name: 'sha' }, get.player(), get.player()) > 0
            ? 8 - get.value(card)
            : 0,
        )
        .forResult();
    },
    material: cannonMaterial,
    async content(event, trigger, player) {
      const source = trigger.source;
      if (!source.isIn() || !cannonMaterial(event.cards[0], player, source)) return;
      recordUse(tiepao);
      const slash = get.autoViewAs({ name: 'sha' }, event.cards);
      const use = player.useCard(slash, event.cards, source);
      await use;
      if (
        source.isIn() &&
        player.hasHistory(
          'sourceDamage',
          (damage) => damage.card === use.card && damage.getParent('useCard') === use,
        )
      )
        updateSources(source, cannon, player, 1);
    },
  };
  lib.skill[cannon] = {
    ...expiresAtSourceTurn(cannon),
    mark: true,
    marktext: '距',
    intro: { content: '计算与铁炮发动者的距离增加，直到该角色的回合开始。' },
    mod: {
      globalFrom(from, to, distance) {
        return distance + (new Map(from.getStorage(cannon)).get(to.playerid) ?? 0);
      },
    },
  };
  lib.translate[cannon] = '铁炮';
}
