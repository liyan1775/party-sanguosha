// SPDX-License-Identifier: GPL-3.0-only
// Scenario-only variants: never replace the selectable native generals' skills.
import { lib, game, get, ui } from 'noname';
import { installShanhetuHardSkills, installHardGear } from './shanhetu-hard.js';
import { installNightmarePassSkills } from './shanhetu-nightmare-pass.js';
import { installNightmareRoadSkills } from './shanhetu-nightmare-roads.js';
import { installNightmareFinalSkills } from './shanhetu-nightmare-final.js';
import { installNightmareGear } from './shanhetu-nightmare-gear.js';
import { installShanhetuMediumSkills, installShanhetuDuanhun } from './shanhetu-medium.js';

function recordUse(skill) {
  const proof = globalThis.partyEngine?.proof;
  if (!proof) return;
  const uses = (proof.shanhetuNpcUses ??= []);
  if (uses.length < 64) uses.push({ skill, round: game.roundNumber });
}

function wushuangRequirement(player) {
  return Math.min(
    5,
    Math.max(
      1,
      player.countAllHistory('useCard', (event) => event.card?.name === 'sha'),
    ),
  );
}

// Poison is public and persists until a diamond judgment removes it.
const poisoned = 'party_shanhetu_poison';

function installNormalBossSkills() {
  lib.skill.party_shanhetu_envenom = {
    forced: true,
    trigger: { source: 'damageEnd' },
    filter(event, player) {
      return event.num > 0 && event.player.side !== player.side;
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      if (trigger.player.isIn()) trigger.player.addSkill(poisoned);
      await player.draw(Math.min(game.roundNumber, 5));
    },
  };
  lib.skill[poisoned] = {
    forced: true,
    mark: true,
    marktext: '毒',
    intro: { content: '准备阶段判定，方块解毒，否则失去当前轮数的体力。' },
    trigger: { player: 'phaseZhunbeiBegin' },
    async content(event, trigger, player) {
      const judgment = await player
        .judge((card) => (get.suit(card) === 'diamond' ? 2 : -2))
        .forResult();
      if (!judgment.card) return;
      recordUse(event.name);
      if (judgment.suit === 'diamond') player.removeSkill(poisoned);
      else await player.loseHp(game.roundNumber);
    },
  };
  lib.skill.party_shanhetu_newcomer_yaowu = {
    forced: true,
    trigger: { player: 'damageBegin3' },
    filter(event) {
      return event.num > 0 && !!event.card;
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      if (get.color(trigger.card) === 'red') await player.gainMaxHp(trigger.num);
      else await player.recover(trigger.num);
    },
  };
  lib.skill.party_shanhetu_shizhan = {
    enable: 'phaseUse',
    usable: () => game.roundNumber,
    filterTarget(card, player, target) {
      return target !== player && player.canUse({ name: 'juedou', isCard: true }, target);
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      await player.useCard({ name: 'juedou', isCard: true }, event.target);
    },
    ai: {
      order: 8,
      result: {
        target(player, target) {
          return get.effect(target, { name: 'juedou' }, player, target);
        },
      },
    },
  };
  lib.skill.party_shanhetu_guixin = {
    trigger: { player: 'damageEnd' },
    getIndex(event) {
      return event.num;
    },
    filter(event, player) {
      return game.hasPlayer(
        (target) => target !== player && target.countGainableCards(player, 'hej'),
      );
    },
    check(event, player) {
      const value = game
        .filterPlayer((target) => target !== player)
        .reduce(
          (total, target) =>
            total -
            Math.sign(get.attitude(player, target)) * target.countGainableCards(player, 'hej'),
          0,
        );
      return player.isTurnedOver() || value >= 2;
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      const targets = game.filterPlayer((target) => target !== player).sortBySeat(player);
      for (const target of targets) {
        const zone = ['h', 'e', 'j']
          .filter((zone) => target.countGainableCards(player, zone))
          .randomGet();
        if (zone) await player.gain(target.getGainableCards(player, zone), target, 'giveAuto');
      }
      await player.turnOver();
    },
  };
  lib.skill.party_shanhetu_qiangxi = {
    enable: 'phaseUse',
    usable: 2,
    position: 'he',
    selectCard: [0, 1],
    filterCard(card, player) {
      return get.subtype(card) === 'equip1' && lib.filter.cardDiscardable(card, player);
    },
    filterTarget(card, player, target) {
      return target !== player;
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      // The round, rather than a phase-local use count, determines the damage.
      const uses = player.countRoundHistory('useSkill', (use) => use.skill === event.name);
      if (!event.cards.length) await player.loseHp();
      if (event.target.isIn()) await event.target.damage(uses, player);
    },
    ai: {
      order: 8,
      check(card) {
        return 7 - get.value(card);
      },
      result: {
        player(player) {
          if (ui.selected.cards.length) return 0;
          if (player.hp <= 1) return -3;
          return player.hp === 2 ? -1 : -0.35;
        },
        target(player, target) {
          return get.damageEffect(target, player, target);
        },
      },
    },
  };

  const chenglve = 'party_shanhetu_chenglve';
  const suits = chenglve + '_suits';
  lib.skill[chenglve] = {
    enable: 'phaseUse',
    usable: 1,
    zhuanhuanji: true,
    marktext: '☯',
    intro: {
      content(storage) {
        return storage ? '阴：摸两张牌并弃置一张手牌。' : '阳：摸一张牌并弃置两张手牌。';
      },
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      const draw = player.storage[chenglve] ? 2 : 1;
      player.changeZhuanhuanji(chenglve);
      await player.draw(draw);
      const result = await player.chooseToDiscard('h', true, 3 - draw).forResult();
      if (!result.cards?.length) return;
      player.addTempSkill(suits, 'phaseUseAfter');
      player.markAuto(
        suits,
        result.cards.map((card) => get.suit(card, player)),
      );
    },
    ai: {
      order: 7,
      result: { player: 1 },
    },
  };
  lib.skill[suits] = {
    charlotte: true,
    onremove: true,
    intro: { content: '本出牌阶段使用$花色的牌无距离和次数限制' },
    mod: {
      cardUsable(card, player) {
        if (player.getStorage('party_shanhetu_chenglve_suits').includes(get.suit(card)))
          return Infinity;
      },
      targetInRange(card, player) {
        if (player.getStorage('party_shanhetu_chenglve_suits').includes(get.suit(card)))
          return true;
      },
    },
  };
  lib.skill.party_shanhetu_shicai = {
    trigger: { player: 'useCardAfter' },
    filter(event, player) {
      const type = get.type2(event.card, false);
      return (
        (event.cards.someInD('od') ||
          player.getCards('e').some((card) => event.cards.includes(card))) &&
        !player.hasHistory(
          'useCard',
          (use) => use !== event && get.type2(use.card, false) === type,
          event,
        )
      );
    },
    check(event, player) {
      return get.type(event.card) !== 'equip' || !player.hasSkill('nzry_cunmu');
    },
    async content(event, trigger, player) {
      const equipped = player.getCards('e').filter((card) => trigger.cards.includes(card));
      const cards = [...trigger.cards.filterInD('od'), ...equipped];
      if (!cards.length) return;
      recordUse(event.name);
      if (equipped.length) await trigger.player.lose(equipped, ui.ordering);
      await game.cardsGotoPile(cards.reverse(), 'insert');
      await player.draw();
    },
  };
  lib.skill.party_shanhetu_qiaomeng = {
    trigger: { player: 'useCardToPlayered' },
    filter(event, player) {
      return event.card.name === 'sha' && event.target.countDiscardableCards(player, 'hej') > 0;
    },
    logTarget: 'target',
    check(event, player) {
      return event.target.side !== player.side;
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      const max = Math.min(
        player.getAttackRange(),
        trigger.target.countDiscardableCards(player, 'hej'),
      );
      if (max > 0) await player.discardPlayerCard(trigger.target, true, 'hej', max);
    },
  };
  lib.skill.party_shanhetu_rescue_lord = {
    trigger: { global: 'dying' },
    filter(event, player) {
      return (
        player !== event.player &&
        player.side === event.player.side &&
        player.hp > 1 &&
        player.hasCard((card) => lib.filter.cardDiscardable(card, player), 'he')
      );
    },
    async cost(event, trigger, player) {
      event.result = await player
        .chooseToDiscard('he', get.prompt2(event.skill, trigger.player), 1)
        .forResult();
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      await player.loseHp();
      if (trigger.player.isIn()) await trigger.player.recover();
    },
  };
  lib.skill.party_shanhetu_cyclic_xiongluan = {
    inherit: 'drlt_xiongluan',
    limited: false,
    skillAnimation: false,
    usable: 1,
    group: [],
    async content(event, trigger, player) {
      recordUse(event.name);
      const slots = [1, 2, 3, 4, 5].flatMap((slot) =>
        Array(player.countEnabledSlot(slot)).fill(slot),
      );
      if (!player.isDisabledJudge()) await player.disableJudge();
      if (slots.length) await player.disableEquip(slots.randomGet());
      const effect = 'drlt_xiongluan_effect';
      player.addTempSkill(effect);
      player.markAuto(effect, [event.target]);
      event.target.addTempSkill('drlt_xiongluan_ban');
    },
  };
  lib.skill.party_shanhetu_ganglie = {
    trigger: { player: 'damageEnd' },
    getIndex(event) {
      return event.num;
    },
    filter(event) {
      return event.source?.isIn();
    },
    check(event, player) {
      return event.source.side !== player.side;
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      const source = trigger.source;
      const judge = await player.judge((card) => (get.color(card) === 'red' ? 2 : 1)).forResult();
      if (!source.isIn()) return;
      if (judge.color === 'red') await source.damage(2, player);
      else if (judge.color === 'black' && source.countCards('he'))
        await player.discardPlayerCard(source, 'he', true, 2);
    },
  };
  lib.skill.party_shanhetu_shensu = {
    trigger: { player: ['phaseJudgeBefore', 'phaseUseBefore', 'phaseDiscardBefore'] },
    filter(event, player) {
      return game.hasPlayer((target) =>
        player.canUse({ name: 'sha', isCard: true }, target, false),
      );
    },
    async cost(event, trigger, player) {
      const prep = trigger.name === 'phaseJudge';
      const play = trigger.name === 'phaseUse';
      const text = prep ? '跳过判定和摸牌' : play ? '跳过出牌' : '跳过弃牌并翻面';
      event.result = await player
        .chooseTarget(
          get.prompt(event.skill),
          text + '，视为使用一张无距离限制且加伤的【杀】',
          (card, player, target) => player.canUse({ name: 'sha', isCard: true }, target, false),
        )
        .set(
          'score',
          prep
            ? player.countCards('h') >= 2
              ? 0
              : 2
            : play
              ? player.countCards('h', (card) => player.hasValueTarget(card))
              : 1,
        )
        .set('ai', (target) => {
          const player = get.player();
          return get.effect(target, { name: 'sha' }, player, player) - get.event().score;
        })
        .forResult();
    },
    async content(event, trigger, player) {
      recordUse(event.name);
      // A paid phase is counted even while its native cancellation is still in flight.
      const skipped = new Set([...player.getHistory('skipped'), trigger.name]);
      trigger.cancel();
      if (trigger.name === 'phaseJudge') {
        player.skip('phaseDraw');
        skipped.add('phaseDraw');
      } else if (trigger.name === 'phaseDiscard') await player.turnOver();
      if (event.targets[0].isIn())
        await player
          .useCard({ name: 'sha', isCard: true }, event.targets[0], false)
          .set('baseDamage', 1 + skipped.size);
    },
  };
}

export function installShanhetuNormalWeapons(ids) {
  const weapons = {
    party_shanhetu_thunder_blade: {
      name: '雷震',
      info: '锁定技，你每使用三张手牌后，下一张【杀】造成的伤害+1（无法叠加）。',
      range: 2,
      skill: {
        forced: true,
        group: 'party_shanhetu_thunder_charge',
        trigger: { player: 'useCard1' },
        filter(event, player) {
          return (
            event.card.name === 'sha' &&
            player.getEquip('party_shanhetu_thunder_blade')?.partyThunder?.charged
          );
        },
        async content(event, trigger, player) {
          const blade = player.getEquip('party_shanhetu_thunder_blade');
          blade.partyThunder.charged = false;
          trigger.baseDamage++;
          recordUse(event.name);
        },
      },
    },
    party_shanhetu_soul_cutter: {
      name: '斩魂刀',
      info: '对已受伤的一名角色造成伤害时，你可以防止此伤害，令其体力上限减1。',
      range: 3,
      skill: {
        trigger: { source: 'damageBegin2' },
        logTarget: 'player',
        filter(event) {
          return event.num > 0 && event.player.isDamaged();
        },
        check(event, player) {
          const target = event.player;
          return target.side !== player.side && (target.hp > event.num || target.maxHp === 1);
        },
        async content(event, trigger) {
          recordUse(event.name);
          trigger.cancel();
          await trigger.player.loseMaxHp();
        },
      },
    },
    party_shanhetu_xingtian_axe: {
      name: '刑天破军斧',
      info: '出牌阶段使用牌指定唯一目标后，你可以弃置两张牌，令其本回合不能使用或打出牌且防具失效。',
      range: 4,
      skill: {
        trigger: { player: 'useCardToPlayered' },
        filter(event, player) {
          return (
            player.isPhaseUsing() &&
            event.targets.length === 1 &&
            !event.target.hasSkill('party_shanhetu_xingtian_ban') &&
            player.countDiscardableCards(player, 'he') >= 2
          );
        },
        async cost(event, trigger, player) {
          const target = trigger.target;
          event.result = await player
            .chooseToDiscard('he', get.prompt2(event.skill, target), 2)
            .set('ai', (card) => (get.event().wantsBan ? 7 - get.value(card) : 0))
            .set(
              'wantsBan',
              target.side !== player.side &&
                (get.tag(trigger.card, 'respondSha') ||
                  get.tag(trigger.card, 'respondShan') ||
                  (get.tag(trigger.card, 'damage') &&
                    (target.countCards('h') > 0 || !!target.getEquip(2)))),
            )
            .forResult();
        },
        async content(event, trigger) {
          recordUse(event.name);
          trigger.target.addTempSkill('party_shanhetu_xingtian_ban');
        },
      },
    },
  };
  for (const [id, { name, range, info, skill }] of Object.entries(weapons)) {
    if (!ids.has(id)) continue;
    const effect = id + '_skill';
    lib.card[id] = {
      type: 'equip',
      subtype: 'equip1',
      fullskin: false,
      distance: { attackFrom: 1 - range },
      skills: [effect],
      ai: { basic: { equipValue: 5 } },
    };
    lib.translate[id] = lib.translate[effect] = name;
    lib.translate[id + '_info'] = lib.translate[effect + '_info'] = info;
    lib.skill[effect] = { ...skill, equipSkill: true };
    game.finishCard(id);
  }
  if (ids.has('party_shanhetu_thunder_blade')) {
    lib.skill.party_shanhetu_thunder_charge = {
      equipSkill: true,
      popup: false,
      forced: true,
      trigger: { player: 'useCardAfter' },
      filter(event, player) {
        return player.hasHistory(
          'lose',
          (loss) =>
            loss.type === 'use' &&
            loss.hs?.length > 0 &&
            (loss.getParent() === event || loss.relatedEvent === event),
        );
      },
      async content(event, trigger, player) {
        const blade = player.getEquip('party_shanhetu_thunder_blade');
        if (!blade) return;
        if (blade.partyThunder?.owner !== player.playerid)
          blade.partyThunder = { owner: player.playerid, uses: 0, charged: false };
        const charge = blade.partyThunder;
        if (++charge.uses < 3) return;
        charge.uses = 0;
        charge.charged = true;
        recordUse(event.name);
      },
    };
  }
  if (ids.has('party_shanhetu_duanhun')) installShanhetuDuanhun(recordUse);
  lib.skill.party_shanhetu_xingtian_ban = {
    charlotte: true,
    mark: true,
    intro: { content: '本回合不能使用、打出牌，也不能发动防具技能。' },
    mod: {
      cardEnabled() {
        return false;
      },
      cardEnabled2() {
        return false;
      },
      cardRespondable() {
        return false;
      },
      cardSavable() {
        return false;
      },
    },
    ai: { unequip2: true },
  };
  lib.translate.party_shanhetu_xingtian_ban = '刑天破军斧';
}

export function installShanhetuNpcSkills(definitions) {
  installNormalBossSkills();
  installShanhetuMediumSkills(recordUse);
  installShanhetuHardSkills(recordUse);
  installNightmarePassSkills(recordUse);
  installNightmareRoadSkills(recordUse);
  installNightmareFinalSkills(recordUse);
  lib.skill.party_shanhetu_baonue = {
    inherit: 'olbaonue',
    zhuSkill: false,
    filter(event, player) {
      return event.source !== player && event.source?.group === 'qun' && event.num > 0;
    },
    async content(event, trigger, player) {
      recordUse('party_shanhetu_baonue');
      await lib.skill.olbaonue.content(event, trigger, player);
    },
  };
  const fixedDistance = 'party_shanhetu_fixed_distance';
  lib.skill[fixedDistance] = { locked: true };
  if (definitions.some((skill) => skill.nativeId === fixedDistance)) {
    const distance = get.distance;
    get.distance = function (from, to, method) {
      const value = distance.call(this, from, to, method);
      if (
        from !== to &&
        Number.isFinite(value) &&
        !['raw', 'pure', 'absolute'].includes(method) &&
        from.hasSkill(fixedDistance)
      )
        return 1;
      return value;
    };
  }
  lib.skill.party_shanhetu_battle_wushuang = {
    forced: true,
    trigger: { player: 'useCardToPlayered', target: 'useCardToTargeted' },
    filter(event, player) {
      return (
        (event.card.name === 'juedou' ||
          (event.card.name === 'sha' &&
            event.player === player &&
            !event.getParent().directHit.includes(event.target))) &&
        wushuangRequirement(player) > 1
      );
    },
    async content(event, trigger, player) {
      const extra = wushuangRequirement(player) - 1;
      const args = (trigger.getParent().customArgs[trigger.target.playerid] ??= {});
      if (trigger.card.name === 'sha') args.shanRequired = (args.shanRequired ?? 1) + extra;
      else {
        const responder = (trigger.player === player ? trigger.target : trigger.player).playerid;
        const responses = (args.shaReq ??= {});
        responses[responder] = (responses[responder] ?? 1) + extra;
      }
      recordUse('party_shanhetu_battle_wushuang');
    },
  };
  lib.skill.party_shanhetu_xiuluo = {
    trigger: { player: 'phaseZhunbeiBegin' },
    filter(event, player) {
      return (
        player.countCards('j') &&
        player.hasCard(
          (card) => lib.filter.cardDiscardable(card, player, 'party_shanhetu_xiuluo'),
          'he',
        )
      );
    },
    async cost(event, trigger, player) {
      event.result = await player.chooseToDiscard('he', 1, get.prompt2(event.skill)).forResult();
    },
    async content(event, trigger, player) {
      await player.discard(player.getCards('j'));
      recordUse('party_shanhetu_xiuluo');
    },
  };
  lib.skill.party_shanhetu_dungong = {
    forced: true,
    trigger: { player: 'damageBegin4' },
    filter(event) {
      return event.num > 3;
    },
    async content(event, trigger) {
      trigger.num = 3;
      recordUse('party_shanhetu_dungong');
    },
  };
  lib.skill.party_shanhetu_zonglve = {
    inherit: 'olzonglve',
    forced: false,
    check(event, player) {
      return get.attitude(player, event.player) < 0;
    },
  };
  for (const skill of definitions) {
    if (skill.inherits && !lib.skill[skill.inherits])
      throw new Error(`缺少山河图敌军依赖：${skill.name}`);
    if (skill.implementation === 'scenario-specific') continue;
    if (!lib.skill[skill.nativeId]) throw new Error(`缺少山河图敌军技能：${skill.name}`);
  }
  lib.skill.party_shanhetu_langxi = {
    trigger: { global: 'phaseZhunbeiBegin' },
    filter(event, player) {
      return game.hasPlayer((target) => target !== player && target.hp <= player.hp);
    },
    async cost(event, trigger, player) {
      event.result = await player
        .chooseTarget(
          get.prompt2(event.skill),
          (card, player, target) => target !== player && target.hp <= player.hp,
        )
        .set('ai', (target) => get.damageEffect(target, get.player(), get.player()))
        .forResult();
    },
    async content(event, trigger, player) {
      recordUse('party_shanhetu_langxi');
      await event.targets[0].damage(get.rand(1, 2), player);
    },
  };
  lib.skill.party_shanhetu_douchan = {
    forced: true,
    trigger: { player: 'phaseZhunbeiBegin' },
    marktext: '缠',
    intro: { content: '攻击范围与出杀次数+#' },
    async content(event, trigger, player) {
      recordUse('party_shanhetu_douchan');
      const count = player.maxHp;
      let missing = 0;
      for (let index = 0; index < count; index++) {
        const card = get.cardPile2((card) => card.name === 'juedou');
        if (card) await player.gain(card, 'gain2');
        else missing++;
      }
      if (missing) player.addMark('party_shanhetu_douchan', missing, false);
    },
    mod: {
      attackRange(player, num) {
        return num + player.countMark('party_shanhetu_douchan');
      },
      cardUsable(card, player, num) {
        if (card.name === 'sha') return num + player.countMark('party_shanhetu_douchan');
      },
    },
  };
  lib.skill.party_shanhetu_zhenjun = {
    inherit: 'rezhenjun',
    filter() {
      return game.hasPlayer((target) => target.countCards('he') > 0);
    },
  };
  lib.skill.party_shanhetu_luanji = {
    inherit: 'olluanji',
    filterCard(card) {
      return !ui.selected.cards.length || get.color(card) === get.color(ui.selected.cards[0]);
    },
  };
  lib.skill.party_shanhetu_yishi = {
    trigger: { source: 'damageBegin2' },
    filter(event, player) {
      return (
        event.card?.name === 'sha' &&
        event.notLink() &&
        event.player.isIn() &&
        event.player.countGainableCards(player, 'hej') > 0
      );
    },
    check(event, player) {
      const target = event.player;
      return (
        get.damageEffect(target, player, player) < 0 ||
        (event.num === 1 && target.hp > event.num && target.countCards('he') > 0)
      );
    },
    async content(event, trigger, player) {
      recordUse('party_shanhetu_yishi');
      trigger.cancel();
      await player.gainPlayerCard(trigger.player, 'hej', true);
    },
  };
  lib.skill.party_shanhetu_mieji = {
    enable: 'phaseUse',
    usable: 1,
    filterTarget(card, player, target) {
      return target !== player && target.countCards('h') > 0;
    },
    async content(event, trigger, player) {
      recordUse('party_shanhetu_mieji');
      const { target } = event;
      const hasTrick = target.hasCard(
        (card) => get.type2(card) === 'trick' && lib.filter.cardDiscardable(card, target),
        'h',
      );
      let discardTrick = false;
      if (hasTrick) {
        const result = await target
          .chooseControl('弃置一张锦囊牌', '弃置所有手牌')
          .set('prompt', '灭计：弃置一张锦囊牌，或弃置所有手牌')
          .set('ai', () => 0)
          .forResult();
        discardTrick = result.index === 0;
      }
      if (discardTrick)
        await target
          .chooseToDiscard('h', true, 1)
          .set('filterCard', (card) => get.type2(card) === 'trick');
      else if (target.countCards('h')) await target.discard(target.getCards('h'));
    },
    ai: {
      order: 9,
      result: {
        target(player, target) {
          return -target.countCards('h');
        },
      },
    },
  };
  lib.skill.party_shanhetu_fencheng = {
    enable: 'phaseUse',
    round: 2,
    filterTarget(card, player, target) {
      return target !== player;
    },
    async content(event, trigger, player) {
      recordUse('party_shanhetu_fencheng');
      const targets = game.filterPlayer((target) => target !== player).sortBySeat(event.target);
      for (const target of targets) {
        if (!target.isIn()) continue;
        const damage = Math.abs(player.countCards('h') - target.countCards('h'));
        const result = await target
          .chooseControl('弃置所有手牌', '承受火焰伤害')
          .set('prompt', `焚城：弃置所有手牌，或受到${damage}点火焰伤害`)
          .set('damage', damage)
          .set('ai', () => {
            const player = get.player();
            const damage = get.event().damage;
            return !player.countCards('h') ||
              damage >= player.hp ||
              (damage > 0 && player.countCards('h') <= 2)
              ? 0
              : 1;
          })
          .forResult();
        const discardAll = result.index === 0;
        if (discardAll && target.countCards('h')) await target.discard(target.getCards('h'));
        else if (discardAll) continue;
        else if (damage > 0) await target.damage(damage, 'fire', player);
      }
    },
    ai: {
      order: 10,
      result: {
        target(player, target) {
          if (!target.countCards('h')) return 0;
          const damage = Math.abs(player.countCards('h') - target.countCards('h'));
          return damage > 0 ? get.damageEffect(target, player, target, 'fire') : 0;
        },
      },
    },
  };
  for (const skill of definitions) {
    // Source wording is for these isolated NPC variants only.
    if (skill.implementation === 'scenario-specific') {
      lib.translate[skill.nativeId] = skill.name;
      lib.translate[`${skill.nativeId}_info`] = skill.description;
    }
  }
}

export function installShanhetuHardGear(ids) {
  installHardGear(ids, recordUse);
  installNightmareGear(ids, recordUse);
}

export function installShanhetuInfernoHalberd() {
  const id = 'party_shanhetu_inferno_halberd';
  const skill = `${id}_skill`;
  lib.card[id] = {
    type: 'equip',
    subtype: 'equip1',
    fullskin: false,
    distance: { attackFrom: -3 },
    skills: [skill],
    ai: { basic: { equipValue: 5 } },
  };
  lib.translate[id] = lib.translate[skill] = '修罗炼狱戟';
  lib.translate[`${id}_info`] =
    '你可为【杀】额外选择攻击范围内的目标。此【杀】造成的伤害+1，受伤角色随后回复1点体力。';
  lib.skill[skill] = {
    equipSkill: true,
    forced: true,
    mod: {
      selectTarget(card, player, range) {
        if (card.name === 'sha' && range[1] !== -1) range[1] = game.countPlayer() - 1;
      },
    },
    trigger: { source: 'damageBegin1' },
    filter(event) {
      return event.card?.name === 'sha' && event.notLink();
    },
    async content(event, trigger) {
      trigger.num++;
      const recovery = game.createEvent('shanhetuHalberdRecovery', false);
      recovery.player = trigger.player;
      recovery.damage = trigger;
      event.next.remove(recovery);
      trigger.after.push(recovery);
      recovery.setContent(async (event, trigger, player) => {
        if (
          player.isIn() &&
          event.damage.num > 0 &&
          player.getAllHistory('damage').includes(event.damage)
        )
          await player.recover(1);
      });
    },
  };
  game.finishCard(id);
}

/** The activity versions use the pinned engine's draw, discard and damage events. */
export function installShanhetuCompanionSkills(companions) {
  const skills = new Set(
    companions.flatMap((companion) => companion.skills.map((skill) => skill.nativeId)),
  );
  if (skills.has('party_shanhetu_weishu')) {
    const native = lib.skill.weishu;
    const id = 'party_shanhetu_weishu';
    lib.translate[id] = '卫戍';
    lib.translate[`${id}_info`] =
      '锁定技。你于摸牌阶段外非因本技能摸牌后，令一名角色摸一张牌；你的牌于弃牌阶段外因弃置进入弃牌堆后，你弃置一名其他角色一张牌。';
    lib.skill[id] = {
      forced: true,
      trigger: native.trigger,
      filter(event, player) {
        return (
          event.getParent()?.name === 'draw' &&
          event.getParent('phaseDraw', true)?.player !== player &&
          !event.getParent(id, true) &&
          !event.getParent('weishu', true)
        );
      },
      content: native.content,
      group: `${id}_discard`,
      subSkill: {
        discard: {
          forced: true,
          trigger: native.subSkill.discard.trigger,
          filter(event, player) {
            return (
              event.type === 'discard' &&
              event.getParent('phaseDiscard', true)?.player !== player &&
              !event.getParent(`${id}_discard`, true) &&
              !event.getParent('weishu_discard', true) &&
              event.getl(player)?.cards2?.some((card) => get.position(card, true) === 'd') &&
              game.hasPlayer(
                (target) => target !== player && target.hasDiscardableCards(player, 'he'),
              )
            );
          },
          content: native.subSkill.discard.content,
        },
      },
    };
  }
  if (skills.has('party_shanhetu_moyan')) {
    const id = 'party_shanhetu_moyan';
    lib.translate[id] = '魔炎';
    lib.translate[`${id}_info`] =
      '锁定技，你于回合外失去牌时进行一次判定。若为红色，你对一名其他角色造成1点火焰伤害。';
    lib.skill[id] = {
      forced: true,
      trigger: { player: 'loseAfter', global: 'loseAsyncAfter' },
      filter(event, player) {
        return (
          globalThis.partyEngine._status.currentPhase !== player &&
          event.getl(player)?.cards2?.length > 0 &&
          game.hasPlayer((target) => target !== player)
        );
      },
      async content(event, trigger, player) {
        const result = await player
          .judge((card) => (get.color(card) === 'red' ? 1 : -1))
          .forResult();
        if (result.color !== 'red') return;
        const choice = await player
          .chooseTarget(
            '魔炎：选择一名其他角色造成1点火焰伤害',
            true,
            (card, player, target) => target !== player,
          )
          .set('ai', (target) => {
            const player = get.player();
            return get.damageEffect(target, player, player, 'fire');
          })
          .forResult();
        if (choice.targets?.length) await choice.targets[0].damage(1, 'fire', player);
      },
    };
  }
}
