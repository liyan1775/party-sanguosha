// SPDX-License-Identifier: GPL-3.0-only
const skins = new Set(['jade', 'palace', 'bamboo', 'chibi']);
const modeSkins = new Map([
  ['identity', 'palace'],
  ['doudizhu', 'bamboo'],
  ['duel', 'chibi'],
  ['versus', 'chibi'],
]);

export function installTableArt(mode, matchId) {
  const root = document.documentElement;
  const apply = (skin, emotions) => {
    root.dataset.tableSkin = skins.has(skin) ? skin : (modeSkins.get(mode) ?? 'jade');
    root.dataset.tableEmotions = emotions === false ? 'off' : 'on';
  };
  try {
    apply(
      localStorage.getItem('party-table-skin'),
      localStorage.getItem('party-emotions') !== 'off',
    );
  } catch {
    apply('auto', true);
  }
  window.addEventListener('message', (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      event.data?.matchId !== matchId ||
      event.data.type !== 'party-table-art'
    )
      return;
    apply(event.data.skin, event.data.emotions);
  });
}
