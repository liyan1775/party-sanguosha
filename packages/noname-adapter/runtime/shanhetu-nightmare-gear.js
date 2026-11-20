// SPDX-License-Identifier: GPL-3.0-only
// Equipment rules from the frozen S5 Card and cha_spell tables.
import { _status, game, get, lib } from 'noname';

const flyingBlade = 'party_shanhetu_nm_card_20861';
const flyingBladeDisabled = `${flyingBlade}_disabled`;
const crimsonBlade = 'party_shanhetu_nm_card_20876';

function inactiveSkillCandidates(target) {
  return target.getSkills(null, false, false).filter((skill) => {
    const info = get.info(skill);
    return (
      info &&
      !info.charlotte &&
      !info.hiddenSkill &&
      !get.is.locked(skill, target) &&
      !target.disabledSkills[skill]?.length
    );
  });
}

function lostHandCards(event, player) {
  return event.getl(player)?.hs?.length ?? 0;
}

function applyFlyingBladeDisable(player, status, skills) {
  player.addTempSkill(status, { player: 'phaseAfter' });
  const selected = (player.storage[status] ??= []);
  for (const skill of skills) {
    if (!selected.includes(skill)) selected.push(skill);
    player.disableSkill(status, skill);
  }
}

/** Native arena reinit precedes the first choice's skillState. */
export function collectNightmareGearState(player) {
  return (player.storage[flyingBladeDisabled] ?? []).filter((skill) =>
    player.disabledSkills[skill]?.includes(flyingBladeDisabled),
  );
}

export function restoreNightmareGearState(player, skills) {
  if (!skills?.length || !lib.skill[flyingBladeDisabled]) return;
  const publicSkills = skills.filter((skill) => lib.skill[skill] && !lib.skill[skill].hiddenSkill);
  if (publicSkills.length) applyFlyingBladeDisable(player, flyingBladeDisabled, publicSkills);
}

export function installNightmareGear(ids, recordUse = () => {}) {
  const resolvedTargets = new WeakMap();
  const jade = {
    name: '螭纹玉佩',
    info: '锁定技，出牌阶段结束时回复1点体力。摸牌阶段，若你未受伤，多摸两张牌。',
    subtype: 'equip5',
    skill: {
      forced: true,
      trigger: { player: ['phaseUseEnd', 'phaseDrawBegin2'] },
      filter(event, player) {
        return event.name === 'phaseUse'
          ? player.isDamaged()
          : player.isHealthy() && !event.numFixed;
      },
      async content(event, trigger, player) {
        recordUse(event.name);
        if (trigger.name === 'phaseUse') await player.recover();
        else trigger.num += 2;
      },
    },
  };
  const gear = {
    party_shanhetu_nm_card_20671: {
      name: '鸾凤和鸣剑',
      info: '攻击范围3。使用雷【杀】或火【杀】指定目标后，你可令其弃置一张牌，或令你摸一张牌，由其选择。',
      subtype: 'equip1',
      distance: { attackFrom: -2 },
      skill: {
        trigger: { player: 'useCardToPlayered' },
        logTarget: 'target',
        filter(event) {
          return (
            event.card.name === 'sha' &&
            (game.hasNature(event.card, 'thunder') || game.hasNature(event.card, 'fire'))
          );
        },
        check: (event, player) => get.attitude(player, event.target) < 0,
        async content(event, trigger, player) {
          recordUse(event.name);
          const target = trigger.target;
          const { bool } = await target
            .chooseToDiscard('he', `弃置一张牌，或令${get.translation(player)}摸一张牌`)
            .forResult();
          if (!bool) await player.draw();
        },
      },
    },
    party_shanhetu_nm_card_20761: {
      name: '金乌落日弓',
      info: '攻击范围9。出牌阶段一次失去至少两张手牌后，你可弃置一名其他角色等量张牌。',
      subtype: 'equip1',
      distance: { attackFrom: -8 },
      skill: {
        trigger: {
          player: 'loseAfter',
          global: [
            'equipAfter',
            'addJudgeAfter',
            'gainAfter',
            'loseAsyncAfter',
            'addToExpansionAfter',
          ],
        },
        direct: true,
        filter(event, player) {
          const count = lostHandCards(event, player);
          return (
            count >= 2 &&
            event.getParent('phaseUse')?.player === player &&
            game.hasPlayer(
              (target) => target !== player && target.countDiscardableCards(player, 'he') >= count,
            )
          );
        },
        async content(event, trigger, player) {
          const count = lostHandCards(trigger, player);
          const { targets } = await player
            .chooseTarget(
              `金乌落日弓：可以弃置一名其他角色的${count}张牌`,
              (card, actor, target) =>
                target !== actor &&
                target.countDiscardableCards(actor, 'he') >= _status.event.count,
            )
            .set('count', count)
            .set('ai', (target) => -get.attitude(get.player(), target))
            .forResult();
          const [target] = targets ?? [];
          if (!target) return;
          player.logSkill(event.name, target);
          recordUse(event.name);
          await player.discardPlayerCard(target, 'he', count, true);
        },
      },
    },
    party_shanhetu_nm_card_20776: {
      name: '三首',
      info: '受到伤害时，你可亮出牌堆顶三张牌。若其中有本回合未使用过的牌类别，防止此伤害。',
      subtype: 'equip2',
      skill: {
        inherit: 'sanshou',
        audio: false,
        async content(event, trigger, player) {
          recordUse(event.name);
          await lib.skill.sanshou.content(event, trigger, player);
        },
      },
    },
    party_shanhetu_nm_card_20846: jade,
    party_shanhetu_nm_card_20847: jade,
    [flyingBlade]: {
      name: '暗器飞刃',
      info: '攻击范围5。锁定技，你每回合对每名其他角色首次造成伤害时，令其随机一个非锁定技失效，直到其回合结束。',
      subtype: 'equip1',
      distance: { attackFrom: -4 },
      skill: {
        forced: true,
        trigger: { source: 'damageBegin1' },
        logTarget: 'player',
        filter(event, player) {
          const target = event.player;
          return (
            target !== player &&
            inactiveSkillCandidates(target).length > 0 &&
            !player.getHistory(
              'useSkill',
              (use) => use.skill === flyingBlade && use.targets?.includes(target),
            ).length
          );
        },
        async content(event, trigger) {
          const skill = inactiveSkillCandidates(trigger.player).randomGet();
          if (!skill) return;
          recordUse(event.name);
          game.broadcastAll(applyFlyingBladeDisable, trigger.player, flyingBladeDisabled, [skill]);
        },
      },
    },
    [crimsonBlade]: {
      name: '妖刀赤瞳',
      info: '攻击范围3。锁定技，你使用的黑色【杀】伤害+1；【杀】指定目标后进行判定，若为黑色，随机改为另一合法目标。',
      subtype: 'equip1',
      distance: { attackFrom: -2 },
      skill: {
        forced: true,
        trigger: { player: 'useCardToTarget' },
        filter(event) {
          return (
            event.card.name === 'sha' && !resolvedTargets.get(event.getParent())?.has(event.target)
          );
        },
        async content(event, trigger, player) {
          const use = trigger.getParent();
          const previous = trigger.target;
          const seen = resolvedTargets.get(use) ?? new Set();
          resolvedTargets.set(use, seen);
          seen.add(previous);
          recordUse(event.name);
          const { color } = await player
            .judge((card) => (get.color(card) === 'black' ? -1 : 0))
            .forResult();
          if (color !== 'black') return;
          const candidates = game.filterPlayer(
            (target) =>
              target !== player &&
              !seen.has(target) &&
              !use.targets.includes(target) &&
              lib.filter.targetEnabled2(use.card, player, target) &&
              lib.filter.targetInRange(use.card, player, target),
          );
          const replacement = candidates.randomGet();
          const index = use.targets.indexOf(previous);
          if (!replacement || index < 0) return;
          seen.add(replacement);
          use.triggeredTargets2.remove(previous);
          use.targets.splice(index, 1, replacement);
          player.line(replacement);
          game.log(trigger.card, '的目标由', previous, '改为', replacement);
        },
        group: `${crimsonBlade}_damage`,
      },
    },
  };

  if (ids.has(flyingBlade)) {
    lib.skill[flyingBladeDisabled] = {
      charlotte: true,
      mark: true,
      intro: {
        content(storage, player, status) {
          return `${get.translation(player.storage[status])}失效，直到你的回合结束。`;
        },
      },
      onremove(player, status) {
        player.enableSkill(status);
        delete player.storage[status];
      },
    };
    lib.translate[flyingBladeDisabled] = '暗器飞刃';
  }
  if (ids.has(crimsonBlade)) {
    const damage = `${crimsonBlade}_damage`;
    lib.skill[damage] = {
      equipSkill: true,
      forced: true,
      trigger: { source: 'damageBegin1' },
      filter(event, player) {
        return (
          event.card?.name === 'sha' && event.notLink() && get.color(event.card, player) === 'black'
        );
      },
      async content(event, trigger) {
        recordUse(crimsonBlade);
        trigger.num++;
      },
    };
    lib.translate[damage] = '妖刀赤瞳';
  }
  for (const [id, { name, info, subtype, distance, skill }] of Object.entries(gear)) {
    if (!ids.has(id)) continue;
    lib.card[id] = {
      type: 'equip',
      subtype,
      distance,
      skills: [id],
      ai: { equipValue: 6, basic: { equipValue: 6 } },
    };
    lib.skill[id] = { ...skill, equipSkill: true };
    lib.translate[id] = name;
    lib.translate[`${id}_info`] = info;
    if (skill.inherit) {
      if (!lib.skill[skill.inherit]) throw new Error(`缺少${name}所需的原生技能`);
      game.finishSkill(id);
    }
    game.finishCard(id);
  }
}
