// SPDX-License-Identifier: GPL-3.0-only
import { _status, game, get, lib } from 'noname';

const fury = 'party_shanhetu_nm_852';
const furyBan = fury + '_ban';
const furyLimit = fury + '_limit';

export function collectNightmarePassState(player) {
  const state = {};
  if (player.countMark(fury) > 0) state.fury = player.countMark(fury);
  if (player.hasSkill(furyBan)) {
    const targets = player
      .getStorage(furyBan)
      .map((target) => target.playerid)
      .filter((id) => Object.hasOwn(lib.playerOL, id));
    if (targets.length) state.banned = targets;
  }
  if (player.countMark(furyLimit) > 0) state.limit = player.countMark(furyLimit);
  if (player.hasSkill('fengyin')) state.sealed = true;
  if (player.hasSkill('dushi', null, null, false)) state.dushi = true;
  return Object.keys(state).length ? state : undefined;
}

export function restoreNightmarePassState(player, state) {
  if (lib.skill[fury]) {
    if (Number.isSafeInteger(state?.fury) && state.fury > 0 && state.fury <= 3) {
      player.storage[fury] = state.fury;
      player.markSkill(fury, null, null, true);
    } else if (player.countMark(fury)) {
      delete player.storage[fury];
      player.unmarkSkill(fury);
    }
    const banned = Array.isArray(state?.banned)
      ? state.banned.map((id) => lib.playerOL[id]).filter(Boolean)
      : [];
    if (banned.length) {
      player.addTempSkill(furyBan, { global: 'phaseAfter' });
      player.storage[furyBan] = banned;
      player.markSkill(furyBan, null, null, true);
    } else if (player.hasSkill(furyBan)) player.removeSkill(furyBan);
    if (Number.isSafeInteger(state?.limit) && state.limit > 0) {
      player.addTempSkill(furyLimit, { global: 'phaseAfter' });
      player.storage[furyLimit] = state.limit;
      player.markSkill(furyLimit, null, null, true);
    } else if (player.hasSkill(furyLimit)) player.removeSkill(furyLimit);
  }
  if (state?.sealed && lib.skill.fengyin) player.addTempSkill('fengyin', { global: 'phaseAfter' });
  if (state?.dushi && lib.skill.dushi) player.addSkill('dushi');
}

export function installNightmarePassSkills(recordUse) {
  lib.skill[fury] = {
    enable: 'phaseUse',
    marktext: '戾',
    intro: { name: '暴戾', content: 'mark' },
    filter: (event, player) => player.countMark(fury) > 0,
    filterTarget: (card, player, target) => target !== player && !target.hasMark(fury),
    async content(event, trigger, player) {
      recordUse(fury);
      player.removeMark(fury, 1);
      event.target.addMark(fury, 1);
    },
    group: [fury + '_start', fury + '_damage', fury + '_resolve'],
    ai: { order: 10, result: { target: -2 } },
  };
  lib.skill[fury + '_start'] = {
    trigger: { global: 'phaseBefore', player: 'enterGame' },
    forced: true,
    filter: (event, player) =>
      (event.name !== 'phase' || game.phaseNumber === 0) && player.countMark(fury) < 3,
    async content(event, trigger, player) {
      player.addMark(fury, 3 - player.countMark(fury));
    },
  };
  lib.skill[fury + '_damage'] = {
    trigger: { source: 'damageBegin1' },
    forced: true,
    filter: (event, player) => event.player !== player && event.player.hasMark(fury),
    async content(event, trigger) {
      trigger.num++;
    },
  };
  lib.skill[fury + '_resolve'] = {
    trigger: { global: 'phaseUseBegin' },
    forced: true,
    filter: (event, player) => event.player !== player && event.player.hasMark(fury),
    async content(event, trigger, player) {
      const target = trigger.player;
      target.removeMark(fury, target.countMark(fury));
      const choice = get.rand(0, 2);
      if (choice === 0) {
        target.addTempSkill(fury + '_ban', { global: 'phaseAfter' });
        target.markAuto(fury + '_ban', [player]);
        await target.damage(1, 'fire', player);
      } else if (choice === 1) {
        target.addTempSkill(fury + '_limit', { global: 'phaseAfter' });
        target.addMark(fury + '_limit', 1);
        await target.loseHp();
      } else {
        const cards = [target.getCards('h').randomGet(), target.getCards('e').randomGet()].filter(
          Boolean,
        );
        if (cards.length) await player.gain(cards, target, 'giveAuto', 'bySelf');
      }
    },
  };
  lib.skill[fury + '_ban'] = {
    charlotte: true,
    onremove: true,
    mark: true,
    intro: { content: '本回合不能对$使用【杀】' },
    mod: {
      playerEnabled(card, player, target) {
        if (card.name === 'sha' && player.getStorage(fury + '_ban').includes(target)) return false;
      },
    },
  };
  lib.skill[fury + '_limit'] = {
    charlotte: true,
    onremove: true,
    intro: { content: '本回合手牌上限-#' },
    mod: { maxHandcard: (player, number) => number - player.countMark(fury + '_limit') },
  };
  lib.translate[fury + '_ban'] = lib.translate[fury + '_limit'] = '暴戾';
  lib.skill.party_shanhetu_nm_853 = {
    trigger: { global: 'dying' },
    forced: true,
    filter: (event, player) => event.player !== player && event.player.hp < 0,
    async content(event, trigger, player) {
      recordUse(event.name);
      if (player.countMark(fury) < 3) player.addMark(fury, 1);
      const cause = trigger.getParent();
      const cards =
        cause?.name === 'damage'
          ? (cause.cards ?? []).filter((card) => ['o', 'd'].includes(get.position(card, true)))
          : [];
      if (cards.length) await player.gain(cards, 'gain2');
    },
  };
  lib.skill.party_shanhetu_nm_266 = {
    trigger: { player: 'useCardToPlayered' },
    direct: true,
    filter(event, player) {
      const qualifies = (use) => ['sha', 'juedou'].includes(use.card?.name);
      return (
        _status.currentPhase === player &&
        event.targets.length === 1 &&
        qualifies(event) &&
        player.getHistory('useCard', qualifies)[0] === event.getParent()
      );
    },
    async content(event, trigger, player) {
      const result = await player
        .chooseControl('摸牌', '增加伤害', 'cancel2')
        .set('prompt', get.prompt2(event.name, trigger.target))
        .set('ai', () => (get.attitude(get.player(), get.event().getTrigger().target) < 0 ? 1 : 0))
        .forResult();
      if (result.control === 'cancel2') return;
      player.logSkill(event.name, trigger.target);
      recordUse(event.name);
      const count = trigger.target.countCards(
        'h',
        (card) => get.suit(card, trigger.target) === 'diamond',
      );
      if (!count) return;
      if (result.index === 0) await player.draw(count);
      else {
        const use = trigger.getParent();
        use.baseDamage = (use.baseDamage ?? 1) + count;
      }
    },
  };
  lib.skill.party_shanhetu_nm_14122 = {
    trigger: { player: 'useCardToPlayered' },
    filter: (event) => event.card.name === 'sha',
    check: (event, player) => get.attitude(player, event.target) < 0,
    logTarget: 'target',
    async content(event, trigger, player) {
      recordUse(event.name);
      const target = trigger.target;
      target.addTempSkill('fengyin', { global: 'phaseAfter' });
      const judge = await player.judge().forResult();
      const color = judge.color ?? get.color(judge.card);
      const matching = target.getCards('he', (card) => get.color(card, target) === color);
      if (
        matching.length &&
        matching.every((card) => lib.filter.cardDiscardable(card, target, event.name))
      ) {
        const result = await target
          .chooseBool(
            '铁骑：弃置所有' +
              (color === 'red' ? '红色' : '黑色') +
              '牌，以保留抵消此【杀】的机会？',
          )
          .set('worthwhile', matching.length === 1 && target.hp <= 2)
          .set('ai', () => get.event().worthwhile)
          .forResult();
        if (result.bool) {
          await target.discard(matching);
          return;
        }
      }
      trigger.getParent().directHit.add(target);
    },
  };
  const poem = 'party_shanhetu_nm_3050',
    majesty = 'party_shanhetu_nm_3052';
  lib.skill[majesty] = {
    locked: true,
    limitFor(player) {
      return player.hasSkill(majesty) &&
        _status.currentPhase !== player &&
        _status.currentPhase?.group === 'qun'
        ? 2
        : 1;
    },
    ai: { combo: poem },
  };
  lib.skill[poem] = {
    trigger: { target: 'useCardToTargeted' },
    forced: true,
    filter(event, player) {
      if (event.player === player) return false;
      const count = 2 + Math.sign(event.player.hp - player.hp);
      return (player.storage[poem + '_count']?.[count] ?? 0) < lib.skill[majesty].limitFor(player);
    },
    async content(event, trigger, player) {
      recordUse(poem);
      const count = 2 + Math.sign(trigger.player.hp - player.hp);
      player.addTempSkill(poem + '_count', { global: 'phaseAfter' });
      const uses = (player.storage[poem + '_count'] ??= {});
      uses[count] = (uses[count] ?? 0) + 1;
      await player.draw(count);
    },
  };
  lib.skill[poem + '_count'] = { charlotte: true, onremove: true };
  lib.skill.party_shanhetu_nm_3385 = {
    trigger: { player: 'damageEnd' },
    forced: true,
    filter: (event, player) => player.hp < 5 && player.isDamaged(),
    async content(event, trigger, player) {
      recordUse(event.name);
      await player.recover();
    },
  };
  lib.skill.party_shanhetu_nm_3386 = {
    trigger: { target: 'useCardToTargeted' },
    forced: true,
    filter: (event, player) => player.hp < 8,
    async content(event, trigger, player) {
      recordUse(event.name);
      await player.draw(2);
    },
  };
}
