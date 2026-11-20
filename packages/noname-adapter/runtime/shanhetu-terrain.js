// SPDX-License-Identifier: GPL-3.0-only
import { get, lib } from 'noname';

export const shanhetuTerrainSkill = 'party_shanhetu_terrain';

function forestLimitReached(player, event = get.event()) {
  const phase = event?.getParent('phaseUse', true, true);
  return (
    phase?.player === player &&
    player.countHistory(
      'useCard',
      (use) => use !== event && use.getParent('phaseUse', true) === phase,
    ) >= 10
  );
}

export function installShanhetuTerrain(terrain) {
  const effects = {
    13273: {
      trigger: { player: 'phaseEnd' },
      async content(event, trigger, player) {
        await player.loseHp();
      },
    },
    13274: {
      trigger: { player: 'useCardBefore' },
      filter: (event, player) => forestLimitReached(player, event),
      async content(event, trigger) {
        trigger.cancel();
      },
      mod: {
        cardEnabled(card, player) {
          if (forestLimitReached(player)) return false;
        },
      },
    },
    13275: {
      mod: {
        cardUsable(card, player, count) {
          if (card.name === 'sha') return count + 1;
        },
      },
    },
    13276: {
      mod: {
        maxHandcardFinal(player, count) {
          return Math.min(count, 8);
        },
      },
    },
    13277: {
      mod: {
        globalFrom(from, to, distance) {
          return distance - 1;
        },
      },
    },
    13278: {
      trigger: { player: 'phaseDrawBegin2' },
      filter: (event) => !event.numFixed,
      async content(event, trigger) {
        trigger.num += 2;
      },
    },
  }[terrain.id];
  if (!effects) throw new Error('缺少已接入的山河图地形');
  lib.skill[shanhetuTerrainSkill] = {
    charlotte: true,
    forced: true,
    firstDo: terrain.id === 13274,
    popup: false,
    intro: { content: terrain.description },
    ...effects,
  };
  lib.translate[shanhetuTerrainSkill] = terrain.name;
  lib.translate[`${shanhetuTerrainSkill}_info`] = terrain.description;
}
