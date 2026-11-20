// SPDX-License-Identifier: GPL-3.0-only
import { _status, lib, game, get } from 'noname';
import { installShanhetuTerrain } from './shanhetu-terrain.js';

let actors = [];
const identityLabels = {
  zhu: '你',
  zhu2: '征战者',
  fan: '敌',
  fan2: '敌军',
  zhong: '友',
  zhong2: '队友',
};
const publicBossSkills = ['party_shanhetu_poison', 'party_shanhetu_xingtian_ban', 'repojun2'];

function actorFor(player) {
  const actor = actors.find((actor) => actor.id === player.playerid);
  return actor?.nextForm && actor.nextForm.character === player.name1 ? actor.nextForm : actor;
}

function npcRules(actor) {
  const rules = ['party_shanhetu_npc_rule'];
  if (actor.nextForm) rules.push('party_shanhetu_stage');
  if (actor.armorRecovery || actor.nextForm?.armorRecovery)
    rules.push('party_shanhetu_armor_recovery');
  return rules;
}

function attachTerrain(heroId) {
  for (const player of Object.values(lib.playerOL)) {
    player.addAdditionalSkill('partyShanhetuTerrain', 'party_shanhetu_terrain');
  }
  lib.playerOL[heroId].markSkill('party_shanhetu_terrain', null, null, true);
}

/** NPC definitions are isolated from the selectable native roster. */
export async function installShanhetu(setup) {
  const recipe = setup.shanhetuRecipe;
  if (!recipe || recipe.id !== setup.shanhetu.battleId) throw new Error('山河图阵容不一致');
  const companions = setup.shanhetuCompanions ?? [];
  if (setup.shanhetuTerrain) installShanhetuTerrain(setup.shanhetuTerrain);
  const equipmentIds = new Set(
    recipe.enemies.flatMap((enemy) =>
      [...(enemy.fixedEquipment ?? []), ...(enemy.nextForm?.fixedEquipment ?? [])].map(
        (card) => card.nativeId,
      ),
    ),
  );
  if (setup.shanhetuNpcSkills.length || companions.length || equipmentIds.size) {
    const skills = await import('./shanhetu-skills.js');
    skills.installShanhetuNpcSkills(setup.shanhetuNpcSkills);
    skills.installShanhetuCompanionSkills(companions);
    if (equipmentIds.has('party_shanhetu_inferno_halberd')) skills.installShanhetuInfernoHalberd();
    skills.installShanhetuNormalWeapons(equipmentIds);
    skills.installShanhetuHardGear(equipmentIds);
  }
  Object.assign(lib.translate, identityLabels);
  actors = [...recipe.enemies, ...companions].map((actor, index) => ({
    ...actor,
    id: setup.seats[index + 1].id,
    character: `party_shanhetu_npc_${index}`,
    ally: index >= recipe.enemies.length,
    skills: actor.skills.map((skill) => (typeof skill === 'string' ? skill : skill.nativeId)),
    ...(actor.nextForm
      ? {
          nextForm: { ...actor.nextForm, character: `party_shanhetu_npc_${index}_stage2` },
        }
      : {}),
  }));
  const forms = actors.flatMap((actor) => (actor.nextForm ? [actor, actor.nextForm] : [actor]));
  for (const actor of forms) {
    // No unrelated native general is substituted for an activity NPC. The
    // temporary silhouette uses an existing local resource until art is pinned.
    if (actor.skills.some((skill) => !lib.skill[skill]))
      throw new Error(`缺少${actor.name}的原生技能`);
    for (const item of actor.fixedEquipment ?? []) {
      const definition = lib.card[item.nativeId];
      const subtype = item.subtype ?? 'equip1';
      if (
        definition?.subtype !== subtype ||
        (subtype === 'equip1' && 1 - (definition.distance?.attackFrom ?? 0) !== item.range)
      )
        throw new Error(`缺少${actor.name}的起始装备`);
      // This pinned asset pack omits the boss-mode illustration.
      if (definition.modeimage === 'boss') definition.fullskin = false;
    }
    lib.character[actor.character] = get.convertedCharacter({
      sex: actor.sex ?? 'male',
      group: actor.group ?? 'qun',
      hp: actor.hp,
      maxHp: actor.maxHp,
      hujia: actor.armor,
      skills: actor.skills,
      isUnseen: true,
      isAiForbidden: true,
      img: `image/character/default_silhouette_${actor.sex === 'female' ? 'female' : 'male'}.jpg`,
    });
    lib.translate[actor.character] = actor.name;
  }
  lib.skill.party_shanhetu_npc_rule = {
    charlotte: true,
    forced: true,
    popup: false,
    priority: 10000,
    trigger: { player: 'phaseDrawBegin2' },
    filter(event, player) {
      return !event.numFixed && !!actorFor(player);
    },
    async content(event, trigger, player) {
      trigger.num = Math.max(0, trigger.num + actorFor(player).draw - 2);
    },
    mod: {
      cardUsable(card, player, num) {
        if (card.name === 'sha') return num + (actorFor(player)?.extraSha ?? 0);
      },
    },
  };
  lib.skill.party_shanhetu_armor_recovery = {
    charlotte: true,
    forced: true,
    popup: false,
    priority: 20,
    trigger: { global: 'roundStart' },
    filter(event, player) {
      return player.hujia < 5 && actorFor(player)?.armorRecovery > 0;
    },
    async content(event, trigger, player) {
      const before = player.hujia;
      await player.changeHujia(actorFor(player).armorRecovery, 'gain', 5);
      const proof = globalThis.partyEngine?.proof;
      if (proof) {
        const changes = (proof.shanhetuArmorRecovery ??= []);
        if (changes.length < 40)
          changes.push({
            id: player.playerid,
            before,
            after: player.hujia,
            round: game.roundNumber,
          });
      }
    },
  };
  lib.skill.party_shanhetu_stage = {
    charlotte: true,
    forced: true,
    forceDie: true,
    firstDo: true,
    priority: 10000,
    popup: false,
    trigger: { player: ['dyingBefore', 'dieBefore'] },
    filter(event, player) {
      const actor = actorFor(player);
      return (
        player.hp <= 0 && player.isAlive() && player.name1 === actor?.character && !!actor?.nextForm
      );
    },
    async content(event, trigger, player) {
      const next = actorFor(player).nextForm;
      trigger.cancel();
      game.log(player, '进入第二形态');
      // The native seat, turn history and private cards stay with this player.
      await player.reinitCharacter(player.name1, next.character);
      game.broadcastAll(
        function (id, hp, maxHp, armor) {
          const player = lib.playerOL[id];
          player.hp = hp;
          player.maxHp = maxHp;
          player.hujia = armor;
          player.update();
        },
        player.playerid,
        next.hp,
        next.maxHp,
        next.armor,
      );
      await equipFixedEquipment(player, next);
    },
  };
  for (const tactic of setup.shanhetuGrowth.tactics) {
    if (!lib.zhanfa.getSkill(tactic.nativeId)) throw new Error('缺少已接入的原生战法');
    const rarity = ['common', 'rare', 'epic', 'legend'][tactic.rarity - 1];
    lib.zhanfa.setRarity(tactic.nativeId, rarity);
    lib.card[tactic.nativeId].subtype = `zf_${rarity}`;
    // The pinned resource set has the generic card back, not individual art.
    lib.card[tactic.nativeId].image = 'image/card/zhanfa.png';
  }
  lib.skill.party_shanhetu_growth_rule = {
    charlotte: true,
    forced: true,
    popup: false,
    trigger: { player: 'phaseDrawBegin2' },
    filter(event) {
      return !event.numFixed;
    },
    async content(event, trigger) {
      trigger.num += globalThis.partyEngine.setup.shanhetu.build?.draw ?? 0;
    },
    mod: {
      cardUsable(card, player, num) {
        if (card.name === 'sha')
          return num + (globalThis.partyEngine.setup.shanhetu.build?.extraSha ?? 0);
      },
      maxHandcard(player, num) {
        return num + (globalThis.partyEngine.setup.shanhetu.build?.handLimit ?? 0);
      },
    },
  };
  if (setup.role === 'worker') {
    // A start-of-round effect can cause a dying check before currentPhase is set.
    // The headless rule worker's spectator is outside the native seat ring.
    const rescueScore = lib.card.tao.ai.result.target_use;
    lib.card.tao.ai.result.target_use = function (player, target, card) {
      const event = get.event();
      const previous = _status.currentPhase;
      if (
        event?.dying !== target ||
        !game.players.includes(target) ||
        game.players.includes(previous)
      )
        return rescueScore(player, target, card);
      const turnPlayer = event.getParent('phase')?.player;
      _status.currentPhase = game.players.includes(turnPlayer) ? turnPlayer : target;
      try {
        return rescueScore(player, target, card);
      } finally {
        _status.currentPhase = previous;
      }
    };
    const send = lib.element.Client.prototype.send;
    lib.element.Client.prototype.send = function (...args) {
      if (args[0] === 'reinit' && args[2]?.players) {
        const hero = lib.playerOL[setup.ownerPlayerId];
        const saved = {
          growthRule: hero.skills.includes('party_shanhetu_growth_rule'),
          skills: setup.shanhetuGrowth.skills
            .filter((skill) => hero.skills.includes(skill.nativeId))
            .map((skill) => skill.nativeId),
          tactics: setup.shanhetuGrowth.tactics
            .filter((tactic) => hero.hasZhanfa(tactic.nativeId))
            .map((tactic) => tactic.nativeId),
          bossSkills: Object.entries(lib.playerOL).flatMap(([id, player]) => {
            const skills = publicBossSkills.filter((skill) => player.hasSkill(skill));
            return skills.length ? [{ id, skills }] : [];
          }),
        };
        // Native loadModeAsync copies only a small set of mode methods on
        // reinit. Its onreconnect hook runs after the mirror is rebuilt.
        const previous = Array.isArray(args[6]) ? args[6].slice() : null;
        args[6] = [
          function (id, saved, previous) {
            globalThis.partyEngine.restoreShanhetuGrowth(id, saved);
            if (previous?.length) return previous[0].apply(this, previous.slice(1));
          },
          hero.playerid,
          saved,
          previous,
        ];
      }
      return send.apply(this, args);
    };
  }
}

/** Only already-public admitted growth is restored on a player mirror. */
export function restoreShanhetuGrowth(id, saved) {
  const { setup } = globalThis.partyEngine;
  if (setup.role === 'worker') return;
  const hero = lib.playerOL[id];
  if (!hero || id !== setup.ownerPlayerId) return;
  Object.assign(lib.translate, identityLabels);
  hero.side = true;
  hero.isZhu = false;
  hero.setIdentity('zhu');
  for (const actor of actors) {
    const npc = lib.playerOL[actor.id];
    if (!npc) continue;
    npc.side = actor.ally;
    npc.setIdentity(actor.ally ? 'zhong' : 'fan');
    npc.additionalSkills.partyShanhetuStats = npcRules(actor);
  }
  const allowedSkills = setup.shanhetuGrowth.skills.map((skill) => skill.nativeId);
  const allowedTactics = setup.shanhetuGrowth.tactics.map((tactic) => tactic.nativeId);
  const skills = saved.skills.filter((id) => allowedSkills.includes(id));
  if (saved.growthRule) skills.push('party_shanhetu_growth_rule');
  for (const skill of skills) if (!hero.skills.includes(skill)) hero.addSkill(skill);
  const tactics = saved.tactics.filter((id) => allowedTactics.includes(id));
  // No acquisition events, rule-side changes or repeated animations.
  hero.storage.zhanfa = tactics;
  hero.additionalSkills.zhanfa = tactics.map((id) => lib.zhanfa.getSkill(id));
  if (tactics.length) hero.markSkill('zhanfa', null, null, true);
  if (setup.shanhetuTerrain) attachTerrain(hero.playerid);
  for (const player of Object.values(lib.playerOL)) {
    const publicSkills = saved.bossSkills?.find((item) => item.id === player.playerid)?.skills;
    for (const skill of publicBossSkills) {
      if (!lib.skill[skill]) continue;
      if (publicSkills?.includes(skill)) {
        if (skill === 'party_shanhetu_xingtian_ban') player.addTempSkill(skill);
        else if (!player.skills.includes(skill)) player.addSkill(skill);
        if (skill === 'repojun2') player.markSkill(skill, null, null, true);
      } else if (player.hasSkill(skill)) player.removeSkill(skill);
    }
    for (const tag of ['party_shanhetu_zhouxuan', 'olqushi_effect']) {
      // Native reinit restores expansion tags but does not recreate their marks.
      // These skills show only the count of entries the mirror already has.
      if (lib.skill[tag] && player.getExpansions(tag).length) {
        const name = tag === 'olqushi_effect' ? '趋' : '旋';
        player.markSkill(
          tag,
          {
            name,
            content: () => `共有${player.getExpansions(tag).length}张牌`,
            markcount: 'expansion',
          },
          null,
          true,
        );
      }
    }
  }
  get.rawAttitude = (from, to) => (from.side === to.side ? 10 : -10);
}

/** A first-battle native choice is retained for every subsequent encounter. */
export async function selectShanhetuGenerals(setup, initialize) {
  const hero = lib.playerOL[setup.ownerPlayerId];
  let name = setup.shanhetu.hero?.general;
  if (!name) {
    const selected = await hero
      .chooseButton(
        ['山河图：选择本次征程的武将', [setup.shanhetu.candidates, 'character']],
        true,
        1,
      )
      .set('ai', (button) => get.rank(button.link, true))
      .forResult();
    name = selected.links?.[0];
  }
  if (!setup.shanhetu.candidates.includes(name)) throw new Error('无效的山河图选将');
  await initialize(hero, name);
  for (const actor of actors) {
    const npc = lib.playerOL[actor.id];
    await initialize(npc, actor.character);
    // Host stats are not printed general skills and must never affect skill
    // order/count effects such as 穿屋 or be extracted as an NPC ability.
    game.broadcastAll(
      function (id, rules) {
        lib.playerOL[id].addAdditionalSkill('partyShanhetuStats', rules);
      },
      npc.playerid,
      npcRules(actor),
    );
  }
  if (setup.shanhetuTerrain) game.broadcastAll(attachTerrain, hero.playerid);
  if (setup.shanhetu.hero) {
    const saved = setup.shanhetu.hero;
    game.broadcastAll(
      function (id, hp, maxHp) {
        const player = lib.playerOL[id];
        player.hp = hp;
        player.maxHp = maxHp;
        player.update();
      },
      hero.playerid,
      saved.hp,
      saved.maxHp,
    );
    if (hero.group !== saved.group) await hero.changeGroup(saved.group);
  }
  const build = setup.shanhetu.build;
  if (build) {
    const skills = build.skills.map(
      (id) => setup.shanhetuGrowth.skills.find((skill) => skill.id === id).nativeId,
    );
    const tactics = build.tactics.map(
      (id) => setup.shanhetuGrowth.tactics.find((tactic) => tactic.id === id).nativeId,
    );
    if (skills.some((id) => !lib.skill[id])) throw new Error('缺少已接入的额外技能');
    game.broadcastAll(
      function (id, skills, tactics, armor) {
        const player = lib.playerOL[id];
        player.addSkill(['party_shanhetu_growth_rule', ...skills]);
        player.hujia += armor;
        player.update();
        for (const tactic of tactics) player.addZhanfa(tactic);
      },
      hero.playerid,
      skills,
      tactics,
      build.armor,
    );
  }
}

export function shanhetuStartingCards(player, setup) {
  return actorFor(player)?.startingCards ?? 4 + (setup.shanhetu.build?.initialCards ?? 0);
}

export function setShanhetuStartingHands(draw) {
  draw.otherPile = {};
  for (const actor of actors) {
    if (!actor.fixedHand?.length) continue;
    draw.otherPile[actor.id] = {
      getCards(num) {
        const fixed = actor.fixedHand.map((item) => {
          if (!lib.card[item.nativeId]) throw new Error('缺少已接入的角色起始牌');
          const card = game.createCard(item.nativeId, item.suit, item.number);
          card.destroyed = 'discardPile';
          return card;
        });
        return actor.ally ? fixed : [...get.cards(num), ...fixed];
      },
    };
  }
}

export async function equipShanhetuOpeningGear() {
  for (const actor of actors) await equipFixedEquipment(lib.playerOL[actor.id], actor);
}

async function equipFixedEquipment(player, actor) {
  for (const item of actor.fixedEquipment ?? []) {
    const card = game.createCard(item.nativeId, item.suit, item.number);
    card.destroyed = 'discardPile';
    await player.equip(card);
  }
}

/** Fresh physical instances every battle; no acquired card enters the template. */
export async function dealShanhetuCarryCards(setup) {
  const hero = lib.playerOL[setup.ownerPlayerId];
  for (const id of setup.shanhetu.build?.cards ?? []) {
    const item = setup.shanhetuCards.find((card) => card.id === id);
    if (!item || !lib.card[item.nativeId]) throw new Error('缺少已接入的随身牌');
    const card = game.createCard(item.nativeId, item.suit, item.number, item.nature);
    // Native movement handles use, recast, discard, death and replaced gear.
    // Keeping this property on the executor also covers transfer to an NPC.
    card.destroyed = 'discardPile';
    card._partyShanhetuCarry = item.id;
    if (item.autoEquip) await hero.equip(card);
    else await hero.gain(card, 'gain2');
  }
}

export function shanhetuOutcome() {
  const setup = globalThis.partyEngine.setup;
  const hero = lib.playerOL[setup.ownerPlayerId];
  if (!hero) return null;
  const dead = hero.isDead();
  const enemies = actors.filter((actor) => !actor.ally);
  const defeatedEnemies = enemies.filter((seat) => lib.playerOL[seat.id]?.isDead()).length;
  if (!dead && defeatedEnemies !== enemies.length) return null;
  return {
    runId: setup.shanhetu.runId,
    nodeId: setup.shanhetu.nodeId,
    battleId: setup.shanhetu.battleId,
    outcome: dead ? 'defeat' : 'victory',
    hero: { general: hero.name1, group: hero.group, hp: hero.hp, maxHp: hero.maxHp },
    defeatedEnemies,
  };
}

/** Called only for a setup explicitly carrying the PVE integration contract. */
export function adaptShanhetuMode(mode) {
  mode.game.checkResult = function () {
    if (shanhetuOutcome()) game.over();
  };
  mode.game.checkOnlineResult = function (player) {
    const result = shanhetuOutcome();
    return !!result && (player.side === true) === (result.outcome === 'victory');
  };
  mode.get.rawAttitude = function (from, to) {
    return from.side === to.side ? 10 : -10;
  };
  mode.element.player.dieAfter = function () {
    game.checkResult();
  };
  // Identity's rebel kill reward/lord punishment do not apply to this PVE.
  mode.element.player.dieAfter2 = function () {};
}
