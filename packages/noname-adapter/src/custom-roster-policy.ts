// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import type { ResolvedCustomRoster } from '../../shared/src/contracts.js';

/** Stable public snapshot identity, excluding editor capabilities and archive metadata. */
export function customRosterDigest(
  roster: Omit<ResolvedCustomRoster, 'digest'> | ResolvedCustomRoster,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        engineCommit: roster.engineCommit,
        id: roster.summary.id,
        revision: roster.summary.revision,
        name: roster.summary.name,
        basePreset: roster.summary.basePreset,
        characters: roster.characters,
        definitionPacks: {
          characters: roster.definitionPacks.characters,
          cards: roster.definitionPacks.cards,
        },
        enabledPacks: roster.enabledPacks,
      }),
    )
    .digest('hex');
}
