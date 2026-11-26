// SPDX-License-Identifier: GPL-3.0-only

/** Work in painted viewport pixels before converting back to native zoom. */
export function confirmationLift(controlBottom, handTop, existingLift, scale) {
  const clearance = handTop - controlBottom;
  // Keep a safe placement across the rounding of painted rects and offsetWidth.
  // Always correct a real shortfall. Lower only when a whole native pixel and
  // a half painted pixel of rounding slack can safely be given back.
  if (clearance >= 12 && clearance < 12 + scale + 0.5) return existingLift;
  return Math.max(0, existingLift + Math.ceil((12 - clearance) / scale));
}

export function landlordRole(mode, identity) {
  if (mode !== 'doudizhu' && mode !== 'college') return null;
  return identity === 'zhu' ? '地主' : identity === 'fan' ? '农民' : null;
}

export function selectionSummary(materials, extra, targets, moreTargets, skill, converted) {
  const cards = materials.join('、') + extra;
  const action =
    skill && converted ? `${skill} · ${converted}${cards ? `（${cards}）` : ''}` : cards;
  return `已选：${action}${targets.length ? ` → ${targets.join('、')}${moreTargets ? '等' : ''}` : ''}`;
}
