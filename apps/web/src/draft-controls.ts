// SPDX-License-Identifier: GPL-3.0-only
export const draftFactions: Readonly<Record<string, string>> = {
  wei: '魏',
  shu: '蜀',
  wu: '吴',
  qun: '群',
  jin: '晋',
  shen: '神',
  devil: '魔',
  key: '键',
  western: '西',
};

export function draftMeta(faction: string, health?: string) {
  const [hp, maxHp = hp] = (health ?? '').split('/').map((value) => value.trim());
  return [draftFactions[faction] ?? faction, hp && (hp === maxHp ? hp : `${hp}/${maxHp}`)]
    .filter(Boolean)
    .join(' · ');
}

export function draftCandidateGrid(count: number) {
  const columns = Math.min(5, Math.max(1, Math.ceil(count / (count > 5 ? 2 : 1))));
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) };
}

export function draftBidControl(actorId?: string | null, viewId?: string | null) {
  return actorId ? (actorId === viewId ? 'bid' : 'return') : 'hidden';
}

export function focusDraftCandidate(candidate?: HTMLButtonElement) {
  if (!candidate) return;
  candidate.focus({ preventScroll: true });
  candidate.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: document.documentElement.dataset.motion === 'reduced' ? 'instant' : 'smooth',
  });
}
