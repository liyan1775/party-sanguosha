import type { ModeId } from '../../../packages/shared/src/contracts.js';

const paths: Record<ModeId, string> = {
  identity: '<path d="m4 8 4 4 4-7 4 7 4-4-2 10H6L4 8Z"/><path d="M7 21h10"/>',
  doudizhu: '<path d="m12 3 5 7-5 7-5-7 5-7Z"/><path d="m5 10-3 5 5 7 5-5m7-7 3 5-5 7-5-5"/>',
  versus:
    '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="M3 17v-2a4 4 0 0 1 8 0m10-8V7a4 4 0 0 0-8 0M4 21l16-18"/>',
  duel: '<path d="m4 3 8 7 1 3-3-1-7-8 1-1Zm16 0-8 7-1 3 3-1 7-8-1-1ZM5 15l4 4m6-4 4 4M3 21l5-5m8 0 5 5"/>',
};

export function modeIcon(mode: ModeId): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[mode]}</svg>`;
}

export const arrowIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';

// Original code-drawn artwork. It stays available on LAN without fonts or image downloads.
export const heroArtwork = `
  <div class="hero-art" aria-hidden="true">
    <div class="art-halo"></div><div class="art-ring ring-outer"></div><div class="art-ring ring-inner"></div>
    <span class="art-inscription">以牌会友</span>
    <div class="hero-card card-dodge"><span class="card-corner">♦<small>2</small></span><span class="card-name">闪</span>
      <svg class="card-drawing" viewBox="0 0 160 180" fill="none" stroke="currentColor" stroke-width="1"><path d="M30 100c12-56 100-61 105-6 4 42-70 55-78 19-5-25 37-45 53-23M18 130c28 25 98 23 120-22M24 67c31-38 90-43 120-15"/><path d="m77 26-13 55 28-11-16 71 36-90-31 9 15-34"/></svg>
      <span class="card-footnote">进退，自有分寸</span></div>
    <div class="hero-card card-peach"><span class="card-corner">♥<small>3</small></span><span class="card-name">桃</span>
      <svg class="card-drawing" viewBox="0 0 160 180" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M80 137c-58-6-68-77-27-82 12-2 18 6 27 12 9-6 15-14 27-12 41 5 31 76-27 82Z"/><path d="M80 67c-3-17 2-33 17-42m-16 30c-16-1-27-12-28-27 20 0 29 8 28 27Zm-1 14c-13 17-15 39-10 53"/><circle cx="80" cy="93" r="58" stroke-opacity=".2"/></svg>
      <span class="card-footnote">留一份，生生不息</span></div>
    <div class="hero-card card-strike"><span class="card-corner">♠<small>7</small></span><span class="card-name">杀</span>
      <svg class="card-drawing" viewBox="0 0 160 180" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="80" cy="91" r="58" stroke-opacity=".25"/><circle cx="80" cy="91" r="49" stroke-opacity=".12"/><path d="m112 24-13 63-34 41-11-10 35-40 23-54Z" fill="currentColor" fill-opacity=".08"/><path d="m112 24-18 58-35 41m-6-11 20 17m-15-9-16 20 6 5 16-21m-27 20 8 6"/><path d="M31 64c19-15 34-22 53-22m31 75c-10 14-24 23-43 26" stroke-opacity=".4"/></svg>
      <span class="card-footnote">一招，风云起</span><span class="card-stamp">聚</span></div>
    <span class="art-caption">方寸之间 · 自有风云</span>
  </div>`;

export const roomArtwork =
  '<div class="room-art" aria-hidden="true"><span>聚</span><i></i><small>以牌会友 · 尽兴而归</small></div>';
