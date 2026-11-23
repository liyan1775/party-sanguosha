// SPDX-License-Identifier: GPL-3.0-only
export type ZibaiTheme = 'day' | 'night';
export type ZibaiMotion = 'full' | 'reduced';

const THEME_KEY = 'party_zibai_theme';
const MOTION_KEY = 'party_zibai_motion';

const listeners = new Set<(state: { theme: ZibaiTheme; motion: ZibaiMotion }) => void>();

export const ZIBAI_ICONS = {
  sun: '<svg class="z-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.6" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.4v2.8M12 18.8v2.8M2.4 12h2.8M18.8 12h2.8M5.2 5.2l2 2M16.8 16.8l2 2M18.8 5.2l-2 2M7.2 16.8l-2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  moon: '<svg class="z-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.2 14.8A7.8 7.8 0 0 1 9.2 4.8a8.2 8.2 0 1 0 10 10Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M17.5 4.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" fill="currentColor"/></svg>',
  spark:
    '<svg class="z-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 14.6 9.4 21.5 12l-6.9 2.6L12 21.5l-2.6-6.9L2.5 12l6.9-2.6L12 2.5Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  tracker:
    '<svg class="z-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="1.5" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.7"/><path d="M2.5 4.5h19M2.5 19.5h19M8 9h8M8 12.5h5M8 16h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  stage:
    '<svg class="z-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12.5" rx="1.5" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 20h7M12 17v3M7.5 10.5l3 2.5 6-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  poster:
    '<svg class="z-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h14v17l-7-3.4-7 3.4v-17Z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 7.2l1.2 2.5 2.8.4-2 2 .5 2.7-2.5-1.3-2.5 1.3.5-2.7-2-2 2.8-.4 1.2-2.5Z" fill="currentColor"/></svg>',
  shanhetu:
    '<svg class="z-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 19 8.2 8.8 12.8 15.6 16 10.6 21.5 19H2.5Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14.5 4.2h5.2l-1.4 2.1 1.4 2.1h-5.2V4.2ZM14.5 3.5v7.5M2.5 21h19" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  qr: '<svg class="z-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="6.5" height="6.5" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.7"/><rect x="14" y="3.5" width="6.5" height="6.5" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.7"/><rect x="3.5" y="14" width="6.5" height="6.5" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.7"/><path d="M14 14h3v3h-3zM18.5 14h2v6.5H14v-2" fill="currentColor"/></svg>',
  star: '<svg class="z-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0.8 9.9 6.1 15.2 8 9.9 9.9 8 15.2 6.1 9.9 0.8 8 6.1 6.1 8 0.8Z" fill="currentColor"/></svg>',
} as const;

export function getZibaiTheme(): ZibaiTheme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'night' ? 'night' : 'day';
}

export function getZibaiMotion(): ZibaiMotion {
  const stored = localStorage.getItem(MOTION_KEY);
  return stored === 'reduced' ? 'reduced' : 'full';
}

function applyAttributes(theme: ZibaiTheme, motion: ZibaiMotion): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.motion = motion;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'night' ? '#081017' : '#eef4f3';
  for (const listener of listeners) listener({ theme, motion });
}

export function initZibaiTheme(): { theme: ZibaiTheme; motion: ZibaiMotion } {
  const theme = getZibaiTheme();
  const motion = getZibaiMotion();
  applyAttributes(theme, motion);
  return { theme, motion };
}

export function setZibaiTheme(theme: ZibaiTheme): void {
  localStorage.setItem(THEME_KEY, theme);
  applyAttributes(theme, getZibaiMotion());
}

export function toggleZibaiTheme(): ZibaiTheme {
  const next: ZibaiTheme = getZibaiTheme() === 'day' ? 'night' : 'day';
  setZibaiTheme(next);
  return next;
}

export function setZibaiMotion(motion: ZibaiMotion): void {
  localStorage.setItem(MOTION_KEY, motion);
  applyAttributes(getZibaiTheme(), motion);
}

export function toggleZibaiMotion(): ZibaiMotion {
  const next: ZibaiMotion = getZibaiMotion() === 'full' ? 'reduced' : 'full';
  setZibaiMotion(next);
  return next;
}

export function onZibaiPreferenceChange(
  callback: (state: { theme: ZibaiTheme; motion: ZibaiMotion }) => void,
): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Sync current theme & motion to the native match iframe without reloading it. */
export function syncThemeToFrame(frame: HTMLIFrameElement | null, matchId: string | null): void {
  if (!frame?.contentWindow || !matchId) return;
  frame.contentWindow.postMessage(
    {
      type: 'party-theme',
      matchId,
      theme: getZibaiTheme(),
      motion: getZibaiMotion(),
    },
    location.origin,
  );
}
