// SPDX-License-Identifier: GPL-3.0-only
import type { ShanhetuFinalReport } from '../../../packages/shared/src/shanhetu.js';

export type JourneyStats = Omit<ShanhetuFinalReport, 'title'>;

// S5 observations matched by decision ID, not the displayed label. Elite
// recruitment and refusing a recruit can have different effects on reputation.
const deltas: [readonly number[], Partial<JourneyStats>][] = [
  [[179801, 179802, 192801, 192802, 195101, 195102, 195601, 195701], { reputation: 1 }],
  [
    [
      179901, 179902, 190001, 190002, 192901, 192902, 193001, 193002, 195201, 195202, 195301,
      195302, 195602, 195702,
    ],
    { strategy: 10 },
  ],
  [
    [
      148401, 148402, 148601, 148602, 149101, 149102, 149201, 149202, 149601, 149602, 149701,
      149702,
    ],
    { reputation: -1, strategy: 10 },
  ],
  [
    [
      179803, 179903, 190003, 192803, 192903, 193003, 195103, 195203, 195303, 148403, 148603,
      149103, 149203, 149603, 149703, 126903, 127303, 195603, 195703,
    ],
    { trade: 10 },
  ],
  [[126901, 127301], { merit: 5 }],
  [[126902, 127302], { merit: 10 }],
];
const decisions = new Map(deltas.flatMap(([ids, delta]) => ids.map((id) => [id, delta] as const)));

export function recordJourneyDecision(stats: JourneyStats, decisionId: number) {
  const delta = decisions.get(decisionId);
  if (!delta) return;
  stats.reputation += delta.reputation ?? 0;
  stats.strategy += delta.strategy ?? 0;
  stats.merit += delta.merit ?? 0;
  stats.trade += delta.trade ?? 0;
}

export function finalJourneyReport(
  difficulty: number,
  victory: boolean,
  stats: JourneyStats,
): ShanhetuFinalReport {
  let title = victory ? '大获全胜' : '折戟沉沙';
  if (victory && stats.reputation >= 0) {
    if (difficulty === 1 && stats.strategy > 30) title = '水到渠成';
    if (difficulty === 6 && stats.merit > 15) title = '从龙之功';
    // A recorded clear at exactly 4,000 establishes the inclusive money bound.
    if (difficulty === 11 && stats.trade > 60 && stats.earnedCoins >= 4000) title = '居功至伟';
  }
  return { title, ...stats };
}
