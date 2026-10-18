// User-approved 2026-10-17 native versions; never run automatically at startup.
import { readFile, writeFile } from 'node:fs/promises';
const path = 'config/official-rosters.json';
const official = JSON.parse(await readFile(path, 'utf8'));
const research = JSON.parse(await readFile('config/research/ol-college-2026.json', 'utf8'));
const roster = {
  id: 'ol-college-2026',
  name: 'OL高校联赛（2026）',
  platform: 'ol',
  platformName: '三国杀OL',
  eventMode: 'doudizhu',
  source: {
    kind: 'announcement',
    publishedAt: '2026-10-10',
    url: 'https://sanguosha.com/news/20261010_3336_5809',
    rosterImages: research.sources
      .filter((s) => s.kind === 'current-official-roster-image')
      .map((s) => s.url),
  },
  announcedCount: 93,
  note: '2026-10-17用户确认王瓘、陆凯、谋鲁肃、谋张让、族荀粲采用现成原生设计及已记载差异；张郃按巧变、周泰按不屈／奋激对应。唐棠缺项。高校玩法另见赛事设计，不把其他官方池改为赛事规则。',
  versionNotes: research.entries
    .filter((e) => e.reviewDecision)
    .map((e) => `${e.officialName}：${e.reviewNote}`),
  entries: research.entries.map((e) =>
    e.nativeCandidate
      ? {
          officialName: e.officialName,
          nativeId: e.nativeCandidate.id,
          nativeName: e.nativeCandidate.name,
          nativePack: e.nativeCandidate.pack,
          nativeSkills: e.nativeCandidate.skills.map((s) => s.id),
          source: e.officialHeroUrl ?? 'https://sanguosha.com/news/20261010_3336_5809',
          ...(e.reviewNote ? { note: e.reviewNote } : {}),
          ...(e.priorReview?.versionNote ? { versionNote: e.priorReview.versionNote } : {}),
        }
      : {
          officialName: e.officialName,
          nativeId: null,
          source: e.officialHeroUrl,
          reason: e.reason,
          rejectedIds: [],
        },
  ),
};
official.rosters = [...official.rosters.filter((r) => r.id !== roster.id), roster];
await writeFile(path, JSON.stringify(official, null, 2) + '\n');
console.log('Approved college roster: 92 native versions / 93 announced.');
