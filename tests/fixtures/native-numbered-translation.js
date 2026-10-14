// SPDX-License-Identifier: GPL-3.0-only
// Numbered translation fixture from libnoname/noname v1.11.6,
// commit 2367607e246d21aae168dba15c01151ee0651f30, character/onlyOL.js.
// Parsed as syntax by tests; never imported or executed.
const translate = {
  olsbliwen_info: (() => {
    let list = [
      '游戏开始时，你获得3枚“贤”标记（一名角色的“贤”标记上限为5）',
      '当你使用或打出牌后，若此牌与你使用或打出的上一张牌的花色或类型相同，则你获得1枚“贤”标记',
      '回合结束时，你依次执行：⒈你可以将任意枚“贤”标记分配给等量其他角色；⒉场上所有有“贤”标记的角色按照“贤”标记由大到小的顺序（“贤”标记数相同的角色按座次逆时针排序）依次选择是否使用一张手牌，若不选择使用，则其移去所有“贤”标记，然后你摸等量的牌',
    ];
    return list.map((item, i) => ['①', '②', '③'][i] + item).join('。') + '。';
  })(),
};
