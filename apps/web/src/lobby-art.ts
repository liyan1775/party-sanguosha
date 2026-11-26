// SPDX-License-Identifier: GPL-3.0-only
import type { ModeId } from '../../../packages/shared/src/contracts.js';

import { staticAsset } from './static-assets.js';

export function modeIcon(mode: ModeId): string {
  const url = staticAsset(`/assets/emblems/emblem-${mode}.webp`);
  return `<img class="mode-emblem-image" src="${url}" width="64" height="64" decoding="async" alt="">`;
}

export const arrowIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12h14.5m-5.5-5.5L19 12l-5.5 5.5"/></svg>';
