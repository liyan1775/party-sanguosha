// SPDX-License-Identifier: GPL-3.0-only
import { game, get, lib, ui } from 'noname';

const jixian = 'party_shanhetu_jixian';
const shuangxiong = 'party_shanhetu_shuangxiong';
const duel = `${shuangxiong}_duel`;
const hulie = 'party_shanhetu_hulie';
const huanfu = 'party_shanhetu_huanfu';

function mostHandCards(player) {
  return !game.hasPlayer((target) => target.countCards('h') > player.countCards('h'));
}

function damageByCard(player, use) {
  return player.getHistory(
    'damage',
    (event) => event.card === use.card && event.getParent('useCard') === use,
  );
}

function jixianTarget(player, target) {
  return (
    target !== player && player.canUse('sha', target) && lib.skill.jixian.getNum(player, target) > 0
  );
}

export function installShanhetuMediumSkills(recordUse) {
  lib.skill.party_shanhetu_wuzang = {
    forced: true,
    trigger: { player: 'phaseDrawBegin2' },
    filter: (event) => !event.numFixed,
    async content(event, trigger, player) {
      recordUse(event.name);
      trigger.num = Math.max(5, Math.floor(player.hp / 2));
      trigger.numFixed = true;
    },
    mod: { maxHandcardFinal: () => 0 },
  };
  lib.skill[hulie] = {
    trigger: { player: 'useCardToPlayered' },
    logTarget: 'target',
    filter(event) {
      return ['sha', 'juedou'].includes(event.card.name) && event.targets.length === 1;
    },
    check(event, player) {
      return get.effect(event.target, event.card, player, player) > 0;
    },
    async content(event, trigger, player) {
      const use = trigger.getParent('useCard');
      recordUse(event.name);
      use.baseDamage += 2;
      use.partyHulieTarget = trigger.target;
      player.addTempSkill(`${hulie}_counter`);
    },
    subSkill: {
      counter: {
        charlotte: true,
        trigger: { player: 'useCardAfter' },
        filter(event, player) {
          const target = event.partyHulieTarget;
          return (
            target?.isIn() &&
            target.canUse('sha', player) &&
            !damageByCard(target, event).length &&
            !damageByCard(player, event).length
          );
        },
        check(event, player) {
          const target = event.partyHulieTarget;
          return get.effect(player, { name: 'sha' }, target, player) >= 0;
        },
        async content(event, trigger, player) {
          await trigger.partyHulieTarget.useCard({ name: 'sha', isCard: true }, player, false);
        },
      },
    },
  };
  lib.skill.party_shanhetu_hunzi = {
    forced: true,
    juexingji: true,
    trigger: { player: 'phaseZhunbeiBegin' },
    filter: (event, player) => player.isDamaged(),
    derivation: ['reyingzi', 'yinghun'],
    async content(event, trigger, player) {
      recordUse(event.name);
      player.awakenSkill('party_shanhetu_hunzi');
      await player.loseMaxHp();
      await player.addSkills(['reyingzi', 'yinghun']);
      player.addTempSkill('party_shanhetu_hunzi_reward');
    },
    subSkill: {
      reward: {
        charlotte: true,
        forced: true,
        trigger: { player: 'phaseJieshuBegin' },
        async content(event, trigger, player) {
          player.removeSkill('party_shanhetu_hunzi_reward');
          const choice = await player
            .chooseControl('摸三张牌', '回复2点体力')
            .set('prompt', '魂姿')
            .set('ai', () => (get.player().getDamagedHp() >= 2 ? 1 : 0))
            .forResult();
          if (choice.index === 1) await player.recover(2);
          else await player.draw(3);
        },
      },
    },
  };
  lib.skill[jixian] = {
    trigger: { player: 'phaseDrawAfter' },
    filter: (event, player) => game.hasPlayer((target) => jixianTarget(player, target)),
    async cost(event, trigger, player) {
      event.result = await player
        .chooseTarget(get.prompt2(event.skill), (card, player, target) =>
          lib.skill.party_shanhetu_jixian.eligible(player, target),
        )
        .set('ai', (target) => get.effect(target, { name: 'sha' }, get.player()))
        .forResult();
    },
    eligible: jixianTarget,
    async content(event, trigger, player) {
      recordUse(event.name);
      const target = event.targets[0];
      const count = lib.skill.jixian.getNum(player, target);
      const use = player.useCard({ name: 'sha', isCard: true }, target, false);
      await use;
      await player.draw(count);
      if (!damageByCard(target, use).length) await player.loseHp();
    },
  };
  lib.skill.party_shanhetu_baoli = {
    trigger: { source: 'damageBegin1' },
    forced: true,
    async content(event, trigger) {
      recordUse(event.name);
      trigger.num++;
    },
  };
  lib.skill[shuangxiong] = {
    trigger: { player: 'phaseDrawEnd' },
    filter(event, player) {
      return player.countDiscardableCards(player, 'he') > 0;
    },
    async cost(event, trigger, player) {
      event.result = await player
        .chooseToDiscard('he', 1, get.prompt2(event.skill), 'chooseonly')
        .set('ai', (card) => {
          const player = get.player();
          const color = get.color(card, player);
          const materials = player.countCards('he', (other) => get.color(other, player) !== color);
          return player.hasValueTarget({ name: 'juedou' }) ? materials * 2 - get.value(card) : -1;
        })
        .forResult();
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      const color = get.color(event.cards[0], player);
      await player.modedDiscard(event.cards);
      player.addTempSkill(duel);
      player.markAuto(duel, [color]);
    },
    group: [`${shuangxiong}_damage`, `${shuangxiong}_gain`],
    subSkill: {
      duel: {
        charlotte: true,
        onremove: true,
        enable: 'chooseToUse',
        viewAs: { name: 'juedou' },
        position: 'hes',
        filterCard(card, player) {
          const color = get.color(card, player);
          return player
            .getStorage('party_shanhetu_shuangxiong_duel')
            .some((item) => color !== item);
        },
        viewAsFilter(player) {
          return player.hasCard(
            (card) => lib.skill.party_shanhetu_shuangxiong_duel.filterCard(card, player),
            'hes',
          );
        },
        check: (card) => 6 - get.value(card),
        ai: { order: 7 },
      },
      damage: {
        forced: true,
        popup: false,
        trigger: { player: 'useCard1' },
        filter: (event) => event.card.name === 'juedou' && event.skill === duel,
        async content(event, trigger, player) {
          recordUse(event.name);
          trigger.baseDamage = player.countRoundHistory(
            'useSkill',
            (use) => use.skill === shuangxiong,
          );
        },
      },
      gain: {
        forced: true,
        trigger: { player: 'phaseJieshuBegin' },
        filter(event, player) {
          return player.hasHistory('damage', (hit) =>
            hit.cards?.some((card) => get.position(card, true) === 'd'),
          );
        },
        async content(event, trigger, player) {
          const cards = player.getHistory('damage').flatMap((hit) => hit.cards ?? []);
          await player.gain(
            [...new Set(cards.filter((card) => get.position(card, true) === 'd'))],
            'gain2',
          );
        },
      },
    },
  };
  lib.skill.party_shanhetu_fuqi = {
    forced: true,
    trigger: { player: 'useCard1' },
    async content(event, trigger, player) {
      recordUse(event.name);
      trigger.directHit.addArray(game.filterPlayer((target) => target !== player));
    },
    mod: {
      wuxieRespondable(card, player, target, viewer) {
        if (viewer !== player) return false;
      },
    },
    ai: { directHit_ai: true },
  };
  lib.skill.party_shanhetu_jiaozi = {
    trigger: { source: 'damageBegin1', player: 'damageBegin3' },
    forced: true,
    filter: (event, player) => mostHandCards(player),
    async content(event, trigger) {
      recordUse(event.name);
      trigger.num += game.roundNumber;
    },
  };
  lib.skill[huanfu] = {
    trigger: { player: 'useCardToPlayered', target: 'useCardToTargeted' },
    filter(event, player) {
      const wagers = event.getParent('useCard').partyHuanfu ?? [];
      return (
        event.card.name === 'sha' &&
        player.countDiscardableCards(player, 'he') > 0 &&
        !wagers.some((item) => item.player === player && item.target === event.target)
      );
    },
    async cost(event, trigger, player) {
      const baseDamage = trigger.getParent('useCard').baseDamage;
      event.result = await player
        .chooseToDiscard('he', [1, player.maxHp], get.prompt2(event.skill), 'chooseonly')
        .set('expectedDamage', Math.min(player.maxHp, baseDamage))
        .set('ai', (card) =>
          ui.selected.cards.length < get.event().expectedDamage ? 6 - get.value(card) : 0,
        )
        .forResult();
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      await player.modedDiscard(event.cards);
      const wagers = (trigger.getParent('useCard').partyHuanfu ??= []);
      wagers.push({ player, target: trigger.target, count: event.cards.length });
      player.addTempSkill(`${huanfu}_draw`);
    },
    subSkill: {
      draw: {
        charlotte: true,
        forced: true,
        popup: false,
        trigger: { global: 'useCardAfter' },
        filter(event, player) {
          return event.partyHuanfu?.some((item) => item.player === player);
        },
        async content(event, trigger, player) {
          for (const item of trigger.partyHuanfu.filter((item) => item.player === player)) {
            const damage = damageByCard(item.target, trigger).reduce(
              (total, hit) => total + hit.num,
              0,
            );
            if (damage === item.count) await player.draw(2 * item.count);
          }
        },
      },
    },
  };
  lib.skill.party_shanhetu_shidu = {
    enable: 'phaseUse',
    usable: 1,
    filter: (event, player) => game.hasPlayer((target) => player.canCompare(target)),
    filterTarget: (card, player, target) => player.canCompare(target),
    async content(event, trigger, player) {
      recordUse(event.name);
      const target = event.target;
      if (!(await player.chooseToCompare(target).forResult()).bool || !target.isIn()) return;
      const cards = target.getGainableCards(player, 'h');
      if (cards.length) await player.gain(cards, target, 'giveAuto');
      const count = Math.floor(player.countCards('h') / 2);
      if (count && target.isIn()) await player.chooseToGive(target, 'h', count, true);
    },
    ai: {
      order: 9,
      result: {
        target(player, target) {
          return target.countCards('h') > player.countCards('h') ? -2 : -0.25;
        },
      },
    },
  };
  lib.skill.party_shanhetu_reverse_shizhan = {
    enable: 'phaseUse',
    usable: 2,
    filterTarget: (card, player, target) => target !== player && target.canUse('juedou', player),
    async content(event, trigger, player) {
      recordUse(event.name);
      await event.target.useCard({ name: 'juedou', isCard: true }, player);
    },
    ai: {
      order: 8,
      result: {
        target(player, target) {
          return player.countCards('h', 'sha') > 1 && get.attitude(player, target) < 0 ? -1 : 0;
        },
      },
    },
  };
  lib.skill.party_shanhetu_qingjian = {
    trigger: { player: 'gainAfter' },
    direct: true,
    filter(event, player) {
      return event.getParent('phaseDraw')?.player !== player && event.getg(player).length > 0;
    },
    async content(event, trigger, player) {
      event.cards = trigger.getg(player).filter((card) => player.getCards('h').includes(card));
      while (event.cards.length && player.isIn()) {
        const choice = await player
          .chooseCardTarget({
            prompt: '清俭 · 交给其他角色本次获得的牌',
            position: 'h',
            selectCard: [1, event.cards.length],
            filterCard(card) {
              return get.event().getParent().cards.includes(card);
            },
            filterTarget(card, player, target) {
              return target !== player;
            },
            ai1(card) {
              return get.player().countCards('h') > get.player().hp ? 6 - get.value(card) : -1;
            },
            ai2(target) {
              return get.attitude(get.player(), target) - 3;
            },
          })
          .forResult();
        if (!choice.bool) break;
        const target = choice.targets[0];
        player.logSkill('party_shanhetu_qingjian', target);
        await player.give(choice.cards, target);
        event.cards = event.cards.filter((card) => !choice.cards.includes(card));
      }
    },
  };
  lib.skill.party_shanhetu_leijie = {
    trigger: { player: 'phaseZhunbeiBegin' },
    async cost(event, trigger, player) {
      event.result = await player
        .chooseTarget(get.prompt2(event.skill))
        .set('ai', (target) => {
          const damage = get.damageEffect(target, get.player(), get.player(), 'thunder');
          return get.attitude(get.player(), target) > 0 ? 3 + damage / 2 : 0;
        })
        .forResult();
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      const target = event.targets[0];
      const judgment = await target
        .judge((card) =>
          get.suit(card) === 'spade' && get.number(card) >= 2 && get.number(card) <= 9 ? -2 : 2,
        )
        .forResult();
      if (!judgment.card) return;
      if (judgment.suit === 'spade' && judgment.number >= 2 && judgment.number <= 9)
        await target.damage(2, 'thunder', player);
      else await target.draw(2);
    },
  };
  lib.skill.party_shanhetu_yanyu = {
    trigger: { global: 'phaseZhunbeiBegin' },
    forced: true,
    filter: (event, player) => event.player !== player,
    async content(event, trigger, player) {
      recordUse(event.name);
      const target = trigger.player;
      for (let count = 0; count < 3 && target.isIn() && player.isIn(); count++) {
        const judgment = await target
          .judge((card) => (get.color(card) === 'red' ? -2 : 2))
          .forResult();
        if (judgment.color !== 'red' || !judgment.card) break;
        await target.damage(1, 'fire', player);
        if (player.isIn() && ['o', 'd'].includes(get.position(judgment.card, true)))
          await player.gain(judgment.card, 'gain2');
      }
    },
  };
  lib.skill.party_shanhetu_biri = {
    trigger: { player: 'damageBegin4' },
    forced: true,
    filter: (event) => event.hasNature('fire'),
    async content(event, trigger, player) {
      recordUse(event.name);
      trigger.cancel();
      const before = player.hp;
      await player.recover(2 * trigger.num);
      const healed = player.hp - before;
      if (healed > 0) await player.draw(healed);
    },
  };
  lib.translate.party_shanhetu_shuangxiong_duel = '双雄';
  lib.translate.party_shanhetu_shuangxiong_duel_info =
    '本回合可将与弃牌颜色不同的牌当【决斗】使用。';
  lib.translate.party_shanhetu_hulie_counter = '虎烈';
  lib.translate.party_shanhetu_hulie_counter_info =
    '此牌未造成伤害时，你可令目标视为对你使用一张【杀】。';
  lib.translate.party_shanhetu_hunzi_reward = '魂姿';
}

export function installShanhetuDuanhun(recordUse) {
  const card = 'party_shanhetu_duanhun';
  const skill = `${card}_skill`;
  lib.card[card] = {
    type: 'equip',
    subtype: 'equip1',
    fullskin: false,
    distance: { attackFrom: -1 },
    skills: [skill],
    ai: { basic: { equipValue: 5 } },
  };
  lib.skill[skill] = {
    equipSkill: true,
    forced: true,
    trigger: { source: 'damageBegin1' },
    filter: (event) => event.player.hujia > 0 && !event.nohujia,
    async content(event, trigger) {
      recordUse(event.name);
      trigger.nohujia = true;
    },
  };
  lib.translate[card] = lib.translate[skill] = '断魂';
  lib.translate[`${card}_info`] = '锁定技，你造成的伤害无视护甲。';
  game.finishCard(card);
}
