// SPDX-License-Identifier: GPL-3.0-only
import { _status, game, get, lib, ui } from 'noname';

export function installShanhetuHardSkills(recordUse) {
  lib.skill.party_shanhetu_keshou = {
    trigger: { player: 'damageBegin3' },
    direct: true,
    filter: (event, player) => event.num > 0 && player.countDiscardableCards(player, 'he') >= 2,
    async content(event, trigger, player) {
      const { bool } = await player
        .chooseToDiscard('he', 2, get.prompt2(event.name))
        .set('complexCard', true)
        .set(
          'filterCard',
          (card, player) =>
            lib.filter.cardDiscardable(card, player) &&
            (!ui.selected.cards.length ||
              get.color(card, player) === get.color(ui.selected.cards[0], player)),
        )
        .set('ai', (card) => 6 - get.value(card))
        .forResult();
      if (!bool) return;
      player.logSkill(event.name);
      recordUse(event.name);
      trigger.num--;
      if (!game.hasPlayer((target) => target !== player && target.group === player.group)) {
        const { bool: red } = await player
          .judge((card) => (get.color(card) === 'red' ? 1 : -1))
          .forResult();
        if (red) await player.draw();
      }
    },
  };
  lib.skill.party_shanhetu_gulp = {
    forced: true,
    trigger: { player: ['phaseUseBegin', 'phaseJieshuBegin'] },
    filter: (event, player) => player.countCards('h') < player.getHandcardLimit(),
    async content(event, trigger, player) {
      recordUse(event.name);
      await player.drawTo(player.getHandcardLimit());
    },
  };
  lib.skill.party_shanhetu_might = {
    forced: true,
    trigger: { player: 'phaseDrawBegin2' },
    filter: (event) => !event.numFixed,
    async content(event, trigger, player) {
      recordUse(event.name);
      trigger.num += game.countPlayer((target) => player.side !== target.side);
    },
    mod: {
      maxHandcard(player, count) {
        return count + game.countPlayer((target) => player.side !== target.side);
      },
    },
  };
  lib.skill.party_shanhetu_agility = {
    forced: true,
    trigger: { player: 'damageBegin4' },
    async content(event, trigger, player) {
      recordUse(event.name);
      const result = await player.judge((card) => (get.color(card) === 'red' ? 1 : -1)).forResult();
      if (result.bool) trigger.cancel();
    },
  };
  lib.skill.party_shanhetu_featherblade = {
    trigger: { source: 'damageEnd' },
    check: (event, player) =>
      game.hasPlayer((target) => target !== player && target.side !== player.side),
    async content(event, trigger, player) {
      recordUse(event.name);
      const { bool } = await player
        .judge((card) => (get.color(card) === 'red' ? 1 : -1))
        .forResult();
      if (!bool) return;
      const result = await player
        .chooseTarget(
          '羽刃：对一名其他角色造成1点雷电伤害',
          true,
          (card, player, target) => player !== target,
        )
        .set('ai', (target) => get.damageEffect(target, player, player, 'thunder'))
        .forResult();
      if (result.bool) await result.targets[0].damage('thunder', player);
    },
  };
  lib.skill.party_shanhetu_jujue = {
    forced: true,
    trigger: { player: 'damageEnd' },
    filter: (event, player) => player.hp < 5 && event.source?.isIn(),
    logTarget: 'source',
    async content(event, trigger) {
      recordUse(event.name);
      trigger.source.addTempSkill('fengyin', { global: 'phaseAfter' });
    },
  };
  lib.skill.party_shanhetu_rainstorm = {
    forced: true,
    trigger: { player: 'damageBegin4', global: 'roundStart' },
    filter: (event, player, name) => name === 'roundStart' || event.hasNature('fire'),
    async content(event, trigger, player) {
      recordUse(event.name);
      if (event.triggername !== 'roundStart') {
        trigger.cancel();
        return;
      }
      for (const target of game.filterPlayer((target) => target !== player).sortBySeat(player)) {
        if (target.isIn()) await target.damage(player);
      }
    },
  };
  lib.skill.party_shanhetu_wuying = {
    forced: true,
    trigger: { global: 'gainAfter' },
    filter(event, player) {
      const target = event.player;
      return (
        target.side !== player.side &&
        _status.currentPhase === target &&
        target.countCards('h') > 10
      );
    },
    logTarget: 'player',
    async content(event, trigger, player) {
      recordUse(event.name);
      await trigger.player.damage(player);
    },
  };
  lib.skill.party_shanhetu_ganlu = {
    enable: 'phaseUse',
    usable: 1,
    selectTarget: 2,
    filterTarget(card, player, target) {
      const first = ui.selected.targets[0];
      if (!first) return true;
      const difference = Math.abs(first.countCards('e') - target.countCards('e'));
      return (
        difference <= player.getDamagedHp() ||
        player.countDiscardableCards(player, 'he') >= difference
      );
    },
    async content(event, trigger, player) {
      const [first, second] = event.targets;
      const gap = Math.abs(first.countCards('e') - second.countCards('e'));
      if (gap > player.getDamagedHp()) {
        const result = await player
          .chooseToDiscard('he', gap, true, `甘露：弃置${gap}张牌`)
          .forResult();
        if (!result.bool) return;
      }
      if (!first.isIn() || !second.isIn()) return;
      recordUse(event.name);
      await first.swapEquip(second);
    },
    multitarget: true,
    ai: {
      order: 8,
      result: {
        target(player, target) {
          const first = ui.selected.targets[0];
          if (!first) return -target.countCards('e');
          return first.countCards('e') - target.countCards('e');
        },
      },
    },
  };
  const zhouxuan = 'party_shanhetu_zhouxuan';
  lib.skill[zhouxuan] = {
    trigger: { player: 'phaseDiscardBegin' },
    filter: (event, player) => player.countCards('h') > 0,
    async cost(event, trigger, player) {
      event.result = await player
        .chooseCard('h', [1, player.countCards('h')], get.prompt2(event.skill))
        .set('ai', (card) =>
          get.event().overflow > ui.selected.cards.length ? 8 - get.value(card) : 0,
        )
        .set('overflow', Math.max(0, player.countCards('h') - player.getHandcardLimit()))
        .forResult();
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      const expansion = player.addToExpansion(event.cards, player, 'giveAuto');
      expansion.gaintag.add(zhouxuan);
      await expansion;
    },
    intro: {
      name: '旋',
      content: (storage, player) => `共有${player.getExpansions(zhouxuan).length}张牌`,
      markcount: 'expansion',
    },
    onremove(player) {
      player.loseToDiscardpile(player.getExpansions(zhouxuan));
    },
    group: `${zhouxuan}_draw`,
    subSkill: {
      draw: {
        forced: true,
        trigger: { player: 'useCard' },
        filter: (event, player) => player.getExpansions(zhouxuan).length > 0,
        async content(event, trigger, player) {
          recordUse(event.name);
          await player.loseToDiscardpile(player.getExpansions(zhouxuan).slice(0, 1));
          await player.draw();
          if (
            game.hasPlayer(
              (target) => target !== player && target.countCards('h') >= player.countCards('h'),
            )
          ) {
            const count = player.getExpansions(zhouxuan).length;
            if (count) await player.draw(count);
          }
        },
      },
    },
  };
  lib.skill.party_shanhetu_luoyi = {
    trigger: { player: 'phaseDrawBefore' },
    filter: (event, player) => !event.numFixed && player.hp > 0,
    frequent: true,
    async content(event, trigger, player) {
      recordUse(event.name);
      const hp = player.hp;
      const cards = get.cards(hp);
      await game.cardsGotoOrdering(cards);
      await player.showCards(cards, '裸衣');
      const usable = cards.filter(
        (card) =>
          get.type(card) === 'basic' || get.subtype(card) === 'equip1' || card.name === 'juedou',
      );
      const result = await player
        .chooseBool(`跳过摸牌，获得其中${usable.length}张牌，杀和决斗伤害+${hp}？`)
        .set('choice', usable.length >= 2 || player.countCards('h', 'sha') > 0)
        .forResult();
      if (!result.bool) return;
      trigger.cancel();
      player.addTempSkill('party_shanhetu_luoyi_damage', { player: 'phaseBefore' });
      player.storage.party_shanhetu_luoyi_damage = hp;
      if (usable.length) await player.gain(usable, 'gain2');
    },
  };
  lib.skill.party_shanhetu_luoyi_damage = {
    charlotte: true,
    forced: true,
    trigger: { source: 'damageBegin1' },
    filter: (event) => ['sha', 'juedou'].includes(event.card?.name) && event.notLink(),
    async content(event, trigger, player) {
      recordUse(event.name);
      trigger.num += player.storage.party_shanhetu_luoyi_damage;
    },
    onremove: true,
  };
  lib.translate.party_shanhetu_luoyi_damage = '裸衣';
}

export function installHardGear(ids, recordUse) {
  const ironGuard = 'party_shanhetu_iron_guard';
  const mirror = 'party_shanhetu_kunlun_mirror';
  const gear = {
    party_shanhetu_fire_lute: {
      name: '赤炎镇魂琴',
      info: '锁定技，你造成的伤害均视为火焰伤害。',
      subtype: 'equip1',
      distance: { attackFrom: -3 },
      skill: {
        forced: true,
        trigger: { source: 'damageBegin1' },
        filter: (event) => event.nature !== 'fire',
        async content(event, trigger) {
          recordUse(event.name);
          trigger.nature = 'fire';
        },
      },
    },
    [ironGuard]: {
      name: '铁甲胄',
      info: '当你受到大于1点的伤害或致命伤害时，你可弃置此牌，防止此伤害与本回合内其余伤害。',
      subtype: 'equip2',
      skill: {
        trigger: { player: 'damageBegin4' },
        filter(event, player) {
          const armor = player.hasSkillTag('nohujia') || event.nohujia ? 0 : player.hujia;
          return event.num > 1 || event.num - armor >= player.hp;
        },
        check: () => true,
        async content(event, trigger, player) {
          const armor = player.getEquip(ironGuard);
          if (!armor) return;
          await player.loseToDiscardpile(armor);
          recordUse(event.name);
          trigger.cancel();
          player.addTempSkill(`${ironGuard}_immune`, { global: 'phaseAfter' });
        },
      },
    },
    [mirror]: {
      name: '昆仑镜',
      info: '锁定技，当你受到锦囊牌的伤害后，防止同名锦囊牌本局对你造成的伤害。',
      subtype: 'equip5',
      skill: {
        forced: true,
        trigger: { player: ['damageBegin4', 'damageEnd'] },
        filter(event, player, name) {
          return (
            event.card &&
            get.type(event.card, 'trick') === 'trick' &&
            (name === 'damageEnd' || player.getStorage(mirror).includes(event.card.name))
          );
        },
        async content(event, trigger, player) {
          recordUse(event.name);
          if (event.triggername === 'damageEnd') {
            const stored = (player.storage[mirror] ??= []);
            if (!stored.includes(trigger.card.name)) stored.push(trigger.card.name);
          } else trigger.cancel();
        },
      },
    },
  };
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
    game.finishCard(id);
  }
  if (ids.has(ironGuard)) {
    lib.skill[`${ironGuard}_immune`] = {
      charlotte: true,
      forced: true,
      popup: false,
      trigger: { player: 'damageBegin4' },
      async content(event, trigger) {
        trigger.cancel();
      },
    };
  }
}
