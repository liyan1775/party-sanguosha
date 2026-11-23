// SPDX-License-Identifier: GPL-3.0-only
import type { ModeId } from '../../../packages/shared/src/contracts.js';

const paths: Record<ModeId, string> = {
  shanhetu:
    '<path d="m2.5 18.5 5.8-10 4.6 7.2 3.1-5 5.5 7.8H2.5Z" fill="currentColor" fill-opacity=".22"/><path d="M2.5 21h19M14 4.2h5.5l-1.4 2 1.4 2H14V4.2ZM14 3.5v7.2"/>',
  college:
    '<path d="m2.5 9.2 9.5-4.7 9.5 4.7-9.5 4.7-9.5-4.7Z" fill="currentColor" fill-opacity=".22"/><path d="M6.2 11.4v5.6c3.6 2.6 8 2.6 11.6 0v-5.6M21.5 9.2v7.2"/>',
  identity:
    '<path d="m4 8.2 4 3.8 4-6.8 4 6.8 4-3.8-1.8 9.8H5.8L4 8.2Z" fill="currentColor" fill-opacity=".22"/><path d="M6.5 20.5h11"/>',
  doudizhu:
    '<path d="m12 3 5 6.8-5 6.8-5-6.8L12 3Z" fill="currentColor" fill-opacity=".22"/><path d="m5.2 10-2.7 4.6 4.8 6.4 4.7-4.4m6.8-6.6 2.7 4.6-4.8 6.4-4.7-4.4"/>',
  versus:
    '<circle cx="7.2" cy="7.2" r="3" fill="currentColor" fill-opacity=".22"/><circle cx="16.8" cy="16.8" r="3" fill="currentColor" fill-opacity=".22"/><path d="M3.2 17.5v-1.8a4 4 0 0 1 8 0m9.6-7.4V6.5a4 4 0 0 0-8 0M4.5 20.5 19.5 3.5"/>',
  duel: '<path d="m4.2 3.5 7.8 6.8 1 3-3-1-6.8-7.8 1-1Zm15.6 0-7.8 6.8-1 3 3-1 6.8-7.8-1-1Z" fill="currentColor" fill-opacity=".22"/><path d="m5.5 15 3.8 3.8m5.4-3.8 3.8 3.8M3.5 20.5l4.8-4.8m7.4 0 4.8 4.8"/>',
};

export function modeIcon(mode: ModeId): string {
  return `<svg class="mode-emblem-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[mode]}</svg>`;
}

export const arrowIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12h14.5m-5.5-5.5L19 12l-5.5 5.5"/></svg>';

// Celestial Jade-Gold artwork panel kept light for LAN offline rendering.
export const heroArtwork = `
  <div class="hero-art" aria-hidden="true">
    <div class="art-halo"></div><div class="art-ring ring-outer"></div><div class="art-ring ring-inner"></div>
    <span class="art-inscription">驹隙隐泉 · 以牌会友</span>
    <div class="hero-card card-dodge"><span class="card-corner">♦<small>2</small></span><span class="card-name">闪</span>
      <svg class="card-drawing" viewBox="0 0 160 180" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M30 100c12-56 100-61 105-6 4 42-70 55-78 19-5-25 37-45 53-23M18 130c28 25 98 23 120-22M24 67c31-38 90-43 120-15"/><path d="m77 26-13 55 28-11-16 71 36-90-31 9 15-34"/></svg>
      <span class="card-footnote">进退，自有分寸</span></div>
    <div class="hero-card card-peach"><span class="card-corner">♥<small>3</small></span><span class="card-name">桃</span>
      <svg class="card-drawing" viewBox="0 0 160 180" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M80 137c-58-6-68-77-27-82 12-2 18 6 27 12 9-6 15-14 27-12 41 5 31 76-27 82Z"/><path d="M80 67c-3-17 2-33 17-42m-16 30c-16-1-27-12-28-27 20 0 29 8 28 27Zm-1 14c-13 17-15 39-10 53"/><circle cx="80" cy="93" r="58" stroke-opacity=".22"/></svg>
      <span class="card-footnote">留一份，生生不息</span></div>
    <div class="hero-card card-strike"><span class="card-corner">♠<small>7</small></span><span class="card-name">杀</span>
      <svg class="card-drawing" viewBox="0 0 160 180" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="80" cy="91" r="58" stroke-opacity=".28"/><circle cx="80" cy="91" r="49" stroke-opacity=".14"/><path d="m112 24-13 63-34 41-11-10 35-40 23-54Z" fill="currentColor" fill-opacity=".1"/><path d="m112 24-18 58-35 41m-6-11 20 17m-15-9-16 20 6 5 16-21m-27 20 8 6"/><path d="M31 64c19-15 34-22 53-22m31 75c-10 14-24 23-43 26" stroke-opacity=".42"/></svg>
      <span class="card-footnote">一招，风云起</span><span class="card-stamp">聚</span></div>
    <span class="art-caption">白衣素绡 · 方寸风云</span>
  </div>`;

export const roomArtwork =
  '<div class="room-art" aria-hidden="true"><span>聚</span><i></i><small>白衣素绡 · 以牌会友</small></div>';
