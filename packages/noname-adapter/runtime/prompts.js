// SPDX-License-Identifier: GPL-3.0-only
import { lib, get } from 'noname';

/** Carry complete choice text to the phone after native filters are assigned. */
export function installPrompts() {
  const written = new WeakMap();
  function replace(event, key, original, text) {
    const previous = written.get(event) ?? {};
    if (
      event[key] !== original &&
      (!Object.prototype.hasOwnProperty.call(previous, key) || event[key] !== previous[key])
    )
      return;
    if (event[key] !== text) event.set(key, text);
    previous[key] = text;
    written.set(event, previous);
  }
  function responseCount(event) {
    const range =
      typeof event.selectCard === 'number'
        ? [event.selectCard, event.selectCard]
        : (event.selectCard ?? [1, 1]);
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !range.every((value) => Number.isInteger(value) && value > 0) ||
      range[0] > range[1]
    )
      return;
    return range[0] === range[1]
      ? get.cnNumber(range[0])
      : `${get.cnNumber(range[0])}至${get.cnNumber(range[1])}`;
  }
  function describe(event, sending = false) {
    const parent = event.getParent();
    const responses = {
      nanman: ['南蛮入侵', '杀'],
      wanjian: ['万箭齐发', '闪'],
      juedou: ['决斗', '杀'],
    };
    if (sending && event.name === 'chooseToRespond' && responses[parent?.name]) {
      const count = responseCount(event);
      const [name, card] = responses[parent.name];
      // Only the pinned card's final name filter permits this clarification.
      // A skill that replaces its filter or supplies its own text keeps control.
      const cardId = parent.name === 'wanjian' ? 'shan' : 'sha';
      const filter =
        typeof event.filterCard === 'function' &&
        Function.prototype.toString.call(event.filterCard);
      const matches =
        filter &&
        new RegExp(`get\\.name\\(\\s*[\\w$]+\\s*\\)\\s*===?\\s*["']${cardId}["']`).test(filter);
      if (
        matches &&
        count &&
        ((typeof event.prompt === 'string' && /^请打出.+张牌(?:响应.*)?$/.test(event.prompt)) ||
          event.prompt === written.get(event)?.prompt)
      ) {
        replace(
          event,
          'prompt',
          event.prompt,
          `${name}：请打出${count}张【${card}】，否则受到伤害`,
        );
      }
    }
    if (event.name === 'chooseToUse' && ['luanwu', 'reluanwu'].includes(parent?.name)) {
      replace(
        event,
        'prompt',
        '乱武：使用一张【杀】或失去1点体力',
        '乱武：对距离最近的一名其他角色使用【杀】，否则失去1点体力',
      );
      if (event.prompt === written.get(event)?.prompt) {
        replace(
          event,
          'prompt2',
          undefined,
          '目标须能成为此【杀】的合法目标；不计入出杀次数。取消则失去体力，不是受到伤害。',
        );
      }
    }
    if (event.name === 'chooseUseTarget' && parent?.name === 'reluanwuContentAfter') {
      replace(
        event,
        'prompt',
        '是否使用一张【杀】？',
        '乱武结束：是否视为使用【杀】？（无距离限制，取消则跳过）',
      );
      if (event.prompt === written.get(event)?.prompt)
        replace(event, 'prompt2', undefined, '直接选择合法目标，无需提供手牌。');
    }
    if (
      event.name === 'chooseToUse' &&
      parent?.name === 'oltiaoxin' &&
      typeof event.prompt === 'string' &&
      event.prompt.startsWith('挑衅：对')
    ) {
      replace(
        event,
        'prompt',
        event.prompt,
        event.prompt.replace(
          '使用一张杀，或令其弃置你的一张牌',
          '使用一张【杀】并造成伤害，否则其弃置你的一张牌',
        ),
      );
    }
    if (
      event.name === 'chooseControl' &&
      parent?.name === 'remingce' &&
      Array.isArray(event.choiceList) &&
      event.choiceList.length === 2 &&
      event.choiceList.every((item) => typeof item === 'string') &&
      event.choiceList[0].startsWith('视为对') &&
      event.choiceList[1].endsWith('各摸一张牌') &&
      ((typeof event.prompt === 'string' && /^对.+使用一张杀，或摸一张牌$/.test(event.prompt)) ||
        event.prompt === written.get(event)?.prompt)
    ) {
      replace(event, 'prompt', event.prompt, '明策：请选择一项');
      replace(
        event,
        'prompt2',
        undefined,
        '第一项无需提供【杀】手牌；若此【杀】造成伤害，你与发动者仍各摸一张牌。',
      );
    }
  }
  function carryText(event) {
    // Native send recreates a choice from _args and _set, not its current
    // properties. Keep final presentation fields, including late assignment,
    // without copying rule state, filters, cards or the event parent.
    for (const key of ['prompt', 'prompt2', 'choiceList', 'targetprompt', 'targetprompt2']) {
      const value = event[key];
      if (
        typeof value !== 'string' &&
        value !== false &&
        typeof value !== 'function' &&
        !(Array.isArray(value) && value.every((item) => typeof item === 'string'))
      )
        continue;
      const last = event._set
        ?.slice()
        .reverse()
        .find(([name]) => name === key);
      if (!last || last[1] !== value) event.set(key, value);
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
    if (/^choose/.test(this.name) || ['discardPlayerCard', 'gainPlayerCard'].includes(this.name)) {
      describe(this, true);
      carryText(this);
    }
    return send.apply(this, args);
  };
}
