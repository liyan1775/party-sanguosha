// SPDX-License-Identifier: GPL-3.0-only
import { lib } from 'noname';

/** Carry complete choice text to the phone after native filters are assigned. */
export function installPrompts() {
  function describe(event) {
    const parent = event.getParent();
    if (event.name === 'chooseToRespond' && ['nanman', 'wanjian'].includes(parent?.name)) {
      const name = parent.name === 'nanman' ? '南蛮入侵' : '万箭齐发';
      const card = parent.name === 'nanman' ? '杀' : '闪';
      event.set('prompt', `${name}：请打出一张【${card}】，否则受到伤害`);
    }
    if (event.name === 'chooseToUse' && event.prompt === '乱武：使用一张【杀】或失去1点体力') {
      event.set('prompt', '乱武：对距离最近的一名其他角色使用【杀】，否则失去1点体力');
      event.set(
        'prompt2',
        '目标须能成为此【杀】的合法目标；不计入出杀次数。取消则失去体力，不是受到伤害。',
      );
    }
    if (event.name === 'chooseUseTarget' && parent?.name === 'reluanwuContentAfter') {
      event.set('prompt', '乱武结束：是否视为使用【杀】？（无距离限制，取消则跳过）');
      event.set('prompt2', '直接选择合法目标，无需提供手牌。');
    }
  }
  for (const name of ['chooseToRespond', 'chooseToUse', 'chooseUseTarget']) {
    const choose = lib.element.Player.prototype[name];
    lib.element.Player.prototype[name] = function (...args) {
      const event = choose.apply(this, args);
      describe(event);
      return event;
    };
  }
  const send = lib.element.GameEvent.prototype.send;
  lib.element.GameEvent.prototype.send = function (...args) {
    describe(this);
    return send.apply(this, args);
  };
}
