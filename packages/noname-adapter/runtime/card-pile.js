// Approved piles are independent of native mode-specific variants.
const military = {
  id: 'military160',
  packs: ['standard', 'extra'],
  excludedCards: ['muniu'],
  cardCount: 160,
};
const profiles = {
  beginner: { id: 'standard108', packs: ['standard'], excludedCards: [], cardCount: 108 },
  advanced: military,
  'ol-doudizhu-s15': military,
  'mobile-college-2026': military,
  'mobile-qunxiong-2026-09': military,
  'decade-quanmin-s19': military,
  'mobile-qunxiong-12': military,
  'mobile-qunxiong-16': military,
  'ol-ranked-2026-10-basic': military,
  'ol-ranked-2026-10-full': military,
  'ol-sgl-2026-stage1': military,
  'mobile-time-field-2026-10': military,
};

export function validateCardPile(preset) {
  const expected = profiles[preset?.id];
  const pile = preset?.cardPile;
  if (!expected || !pile) throw new Error('缺少已确认的档位牌堆');
  for (const field of ['id', 'packs', 'excludedCards', 'cardCount'])
    if (JSON.stringify(pile[field]) !== JSON.stringify(expected[field]))
      throw new Error('牌堆配置与已确认的档位不一致');
  if (!pile.packs.every((pack) => preset.definitionPacks?.cards.includes(pack)))
    throw new Error('牌堆缺少原生卡牌定义包');
  return pile;
}

/** Filter the native template before cards/virtual-card choices are created. */
export function prepareCardPile(lib, preset) {
  const pile = validateCardPile(preset);
  if (JSON.stringify(lib.config.cards) !== JSON.stringify(pile.packs))
    throw new Error('引擎启用的牌包与本局牌堆不一致');
  const cards = lib.card.list.filter((card) => !pile.excludedCards.includes(card[2]));
  if (cards.length !== pile.cardCount) throw new Error('原生牌堆张数不符合本局配置');
  if (cards.some((card) => !lib.card[card[2]])) throw new Error('牌堆存在未载入的原生卡牌');
  lib.card.list = cards;
}
