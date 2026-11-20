// SPDX-License-Identifier: GPL-3.0-only
import { game, get, lib, ui } from 'noname';

const guanbian = 'party_shanhetu_nm_3513';
const xiongni = 'party_shanhetu_nm_14206';
const fengshang = 'party_shanhetu_nm_14207';
const zhibing = 'party_shanhetu_nm_14208';
const zhixi = 'party_shanhetu_nm_14209';
const jiuchi = 'party_shanhetu_nm_14210';
const roulin = 'party_shanhetu_nm_14211';
const lianzhu = 'party_shanhetu_nm_14212';
const liyu = 'party_shanhetu_nm_14128';
const biyue = 'party_shanhetu_nm_14213';
const shennu = 'party_shanhetu_nm_14214';

// The host is a spectator. Only actual fighters count, including casualties.
function fighterCount() {
  return game.players.length + game.dead.length;
}

function discardedThisTurn() {
  const cards = new Set();
  game.checkGlobalHistory('cardMove', (move) => {
    if (move.name === 'cardsDiscard' || (move.name === 'lose' && move.position === ui.discardPile))
      for (const card of move.cards) if (get.position(card, true) === 'd') cards.add(card);
  });
  return [...cards];
}

function blackCardNumber(event) {
  return (
    event.player
      .getHistory('useCard', (use) => get.color(use.card, event.player) === 'black')
      .indexOf(event) + 1
  );
}

function gainableZones(player, target) {
  return ['h', 'e', 'j'].filter((zone) => target.countGainableCards(player, zone) > 0);
}

function printedFinalSkills(actor) {
  return (actor?.skills ?? []).map((skill) => (typeof skill === 'string' ? skill : skill.nativeId));
}

export function collectNightmareFinalState(player, actor) {
  const printed = printedFinalSkills(actor);
  const state = {};
  if (player.hasSkill(zhixi)) state.silenced = true;
  if (printed.includes(shennu) && player.countMark(shennu) > 0)
    state.rage = player.countMark(shennu);
  if (printed.includes(guanbian) && !player.hasSkill(guanbian, null, null, false))
    state.lostGuanbian = true;
  if (printed.includes(jiuchi)) {
    if (!player.hasSkill('benghuai', null, null, false) && printed.includes('benghuai'))
      state.lostBenghuai = true;
    if (player.hasSkill('zaiqi', null, null, false)) state.zaiqi = true;
  }
  if (printed.includes(biyue) && player.hasSkill('liuli', null, null, false)) state.liuli = true;
  return Object.keys(state).length ? state : undefined;
}

export function restoreNightmareFinalState(player, state, actor) {
  const printed = printedFinalSkills(actor);
  if (state?.silenced) player.addTempSkill(zhixi, 'phaseAfter');
  else if (player.hasSkill(zhixi)) player.removeSkill(zhixi);
  if (printed.includes(shennu)) {
    if (Number.isSafeInteger(state?.rage) && state.rage > 0) {
      player.storage[shennu] = state.rage;
      player.markSkill(shennu, null, null, true);
    } else {
      delete player.storage[shennu];
      player.unmarkSkill(shennu);
    }
  }
  if (printed.includes(guanbian) && state?.lostGuanbian) player.removeSkill(guanbian);
  if (printed.includes(jiuchi)) {
    if (state?.lostBenghuai && printed.includes('benghuai')) player.removeSkill('benghuai');
    if (state?.zaiqi) player.addSkill('zaiqi');
  }
  if (printed.includes(biyue) && state?.liuli)
    player.addTempSkill('liuli', { player: 'phaseBeginStart' });
}

export function installNightmareFinalSkills(recordUse) {
  lib.skill[guanbian] = {
    forced: true,
    mark: true,
    intro: { content: '手牌上限、与其他角色相互计算距离的增量均等于开局人数。' },
    mod: {
      maxHandcard: (player, current) => current + fighterCount(),
      globalFrom: (from, to, current) => current + fighterCount(),
      globalTo: (from, to, current) => current + fighterCount(),
    },
    trigger: { global: 'roundEnd', player: [xiongni + 'After', fengshang + 'After'] },
    filter: (event, player, name) => name !== 'roundEnd' || game.roundNumber === 1,
    async content(event, trigger, player) {
      recordUse(guanbian);
      await player.removeSkills(guanbian);
    },
  };
  lib.skill[xiongni] = {
    trigger: { player: 'phaseUseBegin' },
    filter: (event, player) => player.countDiscardableCards(player, 'he') > 0,
    async cost(event, trigger, player) {
      event.result = await player
        .chooseToDiscard('he', 1, get.prompt2(xiongni))
        .set('ai', (card) => {
          const player = get.player();
          const score = game
            .filterPlayer((target) => target !== player)
            .reduce(
              (sum, target) =>
                sum - Math.sign(get.attitude(player, target)) * (target.maxHp <= 2 ? 3 : 1),
              0,
            );
          return score > 0 ? 8 - get.value(card) : 0;
        })
        .forResult();
    },
    async content(event, trigger, player) {
      recordUse(xiongni);
      const suit = get.suit(event.cards[0]);
      const targets = game.filterPlayer((target) => target !== player).sortBySeat(player);
      for (const target of targets) {
        if (!target.isIn()) continue;
        const result = await target
          .chooseToDiscard(
            'he',
            5,
            '凶逆：弃置五张' + get.translation(suit) + '牌，否则减1点体力上限',
            (card, owner) => get.suit(card, owner) === get.event().requiredSuit,
          )
          .set('requiredSuit', suit)
          .set(
            'ai',
            (card) =>
              (get.player().maxHp <= 1 ? 100 : get.player().isHealthy() ? 7 : 4) - get.value(card),
          )
          .forResult();
        if (!result.bool) await target.loseMaxHp();
      }
    },
  };
  // The active use is phase-limited. Each distinct dying event independently opens an offer.
  lib.skill[fengshang] = {
    enable: 'phaseUse',
    trigger: { global: 'dying' },
    filter(event, player) {
      if (event.name === 'chooseToUse' && player.hasSkill(fengshang + '_used')) return false;
      return discardedThisTurn().length > 0;
    },
    async content(event, trigger, player) {
      const cards = discardedThisTurn();
      if (!cards.length) return;
      const choice = await player
        .chooseButtonTarget({
          createDialog: ['封赏：选同一花色的任意张牌，全部交给一名角色', cards],
          forced: true,
          selectButton: [1, cards.length],
          selectTarget: 1,
          filterButton(button) {
            const first = ui.selected.buttons[0];
            return !first || get.suit(button.link) === get.suit(first.link);
          },
          filterTarget: true,
          ai1: (button) => Math.max(0.1, get.value(button.link)),
          ai2(target) {
            const player = get.player();
            return (
              get.attitude(player, target) / (1 + target.countCards('h')) +
              (player === target ? 0 : get.attitude(player, target) > 0 ? 1 : 0)
            );
          },
        })
        .forResult();
      if (!choice.bool) return;
      if (!trigger) player.addTempSkill(fengshang + '_used', 'phaseUseAfter');
      recordUse(fengshang);
      const target = choice.targets[0];
      await target.gain(choice.links, 'gain2');
      const wine = { name: 'jiu', isCard: true };
      if (target !== player && player.hasUseTarget(wine, true, false))
        await player.chooseUseTarget(wine, true, false);
    },
    subSkill: { used: { charlotte: true } },
    ai: { order: 8, result: { player: 1 } },
  };
  lib.skill[zhibing] = {
    trigger: { global: 'useCard' },
    forced: true,
    filter(event, player) {
      return (
        event.player !== player &&
        get.color(event.card, event.player) === 'black' &&
        [3, 6, 9].includes(blackCardNumber(event))
      );
    },
    async content(event, trigger, player) {
      recordUse(zhibing);
      switch (blackCardNumber(trigger)) {
        case 3:
          await trigger.player.loseHp();
          break;
        case 6: {
          const excess = player.countCards('h') - 9;
          if (excess > 0) await player.chooseToDiscard('h', excess, true);
          else if (excess < 0) await player.draw(-excess);
          break;
        }
        case 9:
          trigger.player.addTempSkill(zhixi, 'phaseAfter');
          break;
      }
    },
  };
  lib.skill[zhixi] = {
    charlotte: true,
    mark: true,
    marktext: '止',
    intro: { content: '本回合不能使用牌。' },
    mod: { cardEnabled: () => false, cardSavable: () => false },
  };
  lib.translate[zhixi] = '止息';
  lib.translate[zhixi + '_info'] = '锁定技，你不能使用牌。';

  lib.skill[jiuchi] = {
    enable: 'chooseToUse',
    position: 'hs',
    viewAs: { name: 'jiu' },
    filterCard: (card, player) => get.color(card, player) === 'black',
    viewAsFilter: (player) => player.hasCard((card) => get.color(card, player) === 'black', 'hs'),
    check(card) {
      const player = get.player();
      if (get.event().type === 'dying') return 12 - get.value(card);
      if (!player.hasCard((other) => other !== card && get.name(other, player) === 'sha', 'hs'))
        return 0;
      return (player.hasSkill('benghuai') ? 9 : 6) - get.value(card);
    },
    mod: {
      cardUsable(card) {
        if (card.name === 'jiu') return Infinity;
      },
    },
    group: jiuchi + '_change',
    subSkill: {
      change: {
        forced: true,
        trigger: { source: 'damageSource' },
        filter: (event, player) =>
          event.card?.name === 'sha' &&
          event.getParent(2)?.jiu === true &&
          (player.hasSkill('benghuai') || !player.hasSkill('zaiqi')),
        async content(event, trigger, player) {
          recordUse(jiuchi);
          await player.changeSkills(['zaiqi'], ['benghuai']);
        },
      },
    },
  };
  lib.skill[roulin] = {
    trigger: { player: 'useCardToPlayered', target: 'useCardToTargeted' },
    forced: true,
    filter: (event) => event.card.name === 'sha' && event.player !== event.target,
    async content(event, trigger) {
      recordUse(roulin);
      const args = (trigger.getParent().customArgs[trigger.target.playerid] ??= {});
      args.shanRequired = (args.shanRequired ?? 1) + 1;
    },
    ai: {
      directHit_ai: true,
      skillTagFilter(player, tag, arg) {
        return (
          arg?.card?.name === 'sha' && arg.target.mayHaveShan(player, 'use', undefined, 'count') < 2
        );
      },
    },
  };
  lib.skill[lianzhu] = {
    enable: 'phaseUse',
    usable: 1,
    position: 'he',
    filterCard: true,
    filterTarget: (card, player, target) => target !== player,
    discard: false,
    lose: false,
    delay: false,
    check: (card) => (get.color(card) === 'black' ? 9 : 4) - get.value(card),
    async content(event, trigger, player) {
      recordUse(lianzhu);
      const { target, cards } = event;
      const black = get.color(cards[0], player) === 'black';
      await player.give(cards, target, true);
      if (!black || target.hp <= 0) return;
      const count = target.hp;
      const result = await target
        .chooseToDiscard(
          'he',
          count,
          '连诛：弃置' + count + '张牌，或令' + get.translation(player) + '摸' + count + '张牌',
        )
        .set('hostile', get.attitude(target, player) < 0)
        .set('ai', (card) => (get.event().hostile ? 6 : 0) - get.value(card))
        .forResult();
      if (!result.bool) await player.draw(count);
    },
    ai: {
      order: 8,
      result: {
        target(player, target) {
          return ui.selected.cards[0] && get.color(ui.selected.cards[0], player) === 'black'
            ? -Math.min(target.hp, 5)
            : 1;
        },
      },
    },
  };
  lib.skill[liyu] = {
    trigger: { source: 'damageSource' },
    filter: (event, player) =>
      event.card?.name === 'sha' &&
      event.player !== player &&
      event.player.isIn() &&
      gainableZones(player, event.player).length > 0,
    check: (event, player) =>
      get.attitude(player, event.player) < 0 || event.player.countCards('j') > 0,
    async content(event, trigger, player) {
      const victim = trigger.player;
      const zones = gainableZones(player, victim);
      if (!zones.length) return;
      const labels = { h: '手牌区', e: '装备区', j: '判定区' };
      const best =
        get.attitude(player, victim) > 0 && zones.includes('j')
          ? 'j'
          : zones.reduce((best, zone) =>
              victim.countGainableCards(player, zone) > victim.countGainableCards(player, best)
                ? zone
                : best,
            );
      const decision =
        zones.length === 1
          ? 0
          : (
              await player
                .chooseControl(zones.map((zone) => labels[zone]))
                .set('prompt', '利驭：获得此区域内的所有牌')
                .set('choice', zones.indexOf(best))
                .forResult()
            ).index;
      const cards = victim.getGainableCards(player, zones[decision]);
      if (!cards.length) return;
      recordUse(liyu);
      // This can take an entire concealed hand. The native transfer keeps it private.
      const gain = player.gain(cards, victim, 'giveAuto');
      await gain;
      const gained = player
        .getHistory('gain', (move) => move === gain)
        .flatMap((move) => move.cards);
      if (!gained.length || !victim.isIn()) return;
      if (!gained.some((card) => get.type(card) === 'equip')) {
        await victim.draw();
        return;
      }
      const duel = { name: 'juedou', isCard: true };
      if (
        !game.hasPlayer(
          (target) => target !== player && target !== victim && player.canUse(duel, target),
        )
      )
        return;
      const chosen = await victim
        .chooseTarget(
          true,
          '利驭：指定一名其他角色与其决斗',
          (card, chooser, target) =>
            target !== chooser &&
            target !== get.event().duelist &&
            get.event().duelist.canUse('juedou', target),
        )
        .set('duelist', player)
        .set('ai', (target) =>
          get.effect(target, { name: 'juedou' }, get.event().duelist, get.player()),
        )
        .forResult();
      if (chosen.bool)
        await player.useCard(duel, chosen.targets[0]).set('baseDamage', gained.length);
    },
  };
  lib.skill[biyue] = {
    trigger: { player: 'phaseJieshuBegin' },
    forced: true,
    derivation: 'liuli',
    async content(event, trigger, player) {
      recordUse(biyue);
      if (player.countCards('h') === 0) await player.drawTo(player.getHandcardLimit());
      else player.addTempSkill('liuli', { player: 'phaseBeginStart' });
    },
  };
  lib.skill[shennu] = {
    forced: true,
    marktext: '怒',
    intro: { content: 'mark' },
    onremove: true,
    // Native damage fires after prevention/HP changes and before dying or shape changes.
    trigger: { player: 'damage', source: ['damageBegin1', 'damageSource'] },
    filter(event, player, name) {
      return name === 'damage' || player.countMark(shennu) > 0;
    },
    async content(event, trigger, player) {
      recordUse(shennu);
      if (event.triggername === 'damage') {
        player.addMark(shennu, 1);
        if (trigger.source?.hp > 0) await player.draw(trigger.source.hp);
      } else if (event.triggername === 'damageBegin1') trigger.num += player.countMark(shennu);
      else player.removeMark(shennu, player.countMark(shennu));
    },
  };
}
