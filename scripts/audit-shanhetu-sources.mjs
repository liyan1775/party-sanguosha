// SPDX-License-Identifier: GPL-3.0-only
// Compare public reference snapshots with the pinned engine. This script never
// imports reference JavaScript or authorizes characters, skills or tactics.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { literal, readNativeData } from './native-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshots = resolve(root, process.argv[2] ?? '.local/research/shanhetu-20261107');
const destination = resolve(root, '.runtime/shanhetu-research/native-coverage.json');
const sourceFiles = [];
async function readSnapshot(name) {
  const filename = `xiaochao-${name}.json`;
  const bytes = await readFile(resolve(snapshots, filename));
  sourceFiles.push({
    dataset: name,
    url: `https://s.xiaochao.org/data/${name}.json`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  });
  return JSON.parse(bytes.toString('utf8'));
}
function uniqueRows(rows, label) {
  assert.ok(Array.isArray(rows), `${label} must be an array`);
  const result = new Map();
  for (const row of rows) {
    assert.ok(Number.isSafeInteger(row.id), `${label}: noninteger id`);
    assert.ok(!result.has(row.id), `${label}: repeated id ${row.id}`);
    result.set(row.id, row);
  }
  return result;
}
// Remove display punctuation only. Keep digits, words and clause ordering;
// sharing a name or a normalized description is still only a review candidate.
const normalize = (value) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .normalize('NFKC')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\s，。；：、“”‘’【】「」『』《》()（）\[\]!?！？,."'<>]/g, '');
const plain = (value) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .trim();

const [
  manifest,
  battleRows,
  eventRows,
  tactics,
  skillRows,
  cards,
  endings,
  tree,
  groups,
  references,
] = await Promise.all(
  [
    'manifest',
    'battles',
    'events',
    'tactics',
    'skills',
    'cards',
    'endings',
    'tactic-tree',
    'enemy-groups',
    'enemy-references',
  ].map(readSnapshot),
);
const battles = uniqueRows(battleRows, 'battles');
const events = uniqueRows(eventRows, 'events');
const enemyGroups = uniqueRows(groups, 'enemy groups');
const enemySkills = uniqueRows(references.skills, 'enemy skill references');
uniqueRows(tactics, 'tactics');
uniqueRows(skillRows, 'skills');
uniqueRows(cards, 'cards');
uniqueRows(endings, 'endings');
assert.equal(tree.length, new Set(tree.map((row) => `${row.seasonId}:${row.id}`)).size);
assert.equal(manifest.counts.battles, battles.size);
assert.equal(manifest.counts.events, events.size);
assert.equal(manifest.counts.enemyGroups, enemyGroups.size);

const { candidate, packs } = await readNativeData(root, { allPacks: true });
const nativeSkills = [];
for (const [pack, data] of packs) {
  for (const id of data.skills?.nodes.keys() ?? []) {
    const name = data.translates?.values[id];
    const info = data.translates?.values[`${id}_info`];
    if (typeof name === 'string' && typeof info === 'string')
      nativeSkills.push({ pack, id, name: plain(name), description: plain(info) });
  }
}
const zhanfaFile = resolve(root, `.local/noname/${candidate.tag}/noname/library/zhanfa.js`);
const zhanfaSource = await readFile(zhanfaFile, 'utf8');
const ast = ts.createSourceFile('zhanfa.js', zhanfaSource, ts.ScriptTarget.Latest, true);
let zhanfa;
for (const statement of ast.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations)
    if (declaration.name.getText() === '_zhanfa') zhanfa = literal(declaration.initializer);
}
assert.ok(zhanfa, 'Pinned tactic declarations not found');
const nativeTactics = Object.entries(zhanfa).map(([id, row]) => ({
  id,
  name: plain(row.translate),
  description: plain(row.info),
}));

function compare(row, pool) {
  const candidates = pool.filter((native) => normalize(native.name) === normalize(row.name));
  const exact = candidates.filter(
    (native) => normalize(native.description) === normalize(row.description),
  );
  return {
    sourceId: row.id,
    name: row.name,
    status: exact.length ? 'same-normalized-text' : candidates.length ? 'name-only' : 'unmatched',
    candidates: (exact.length ? exact : candidates).map(({ pack, id, description }) => ({
      ...(pack ? { pack } : {}),
      id,
      description,
    })),
  };
}
const tacticCandidates = tactics.map((row) => compare(row, nativeTactics));
const skillCandidates = skillRows.map((row) => compare(row, nativeSkills));
const enemySkillCandidates = references.skills.map((row) => compare(row, nativeSkills));
const candidateByEnemySkill = new Map(enemySkillCandidates.map((row) => [row.sourceId, row]));
function counts(rows) {
  return Object.fromEntries(
    ['same-normalized-text', 'name-only', 'unmatched'].map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ]),
  );
}

const scenarios = manifest.seasons.map((season) => {
  const cities = new Set(
    season.chapters.flatMap((chapter) => chapter.nodes.map((node) => node.id)),
  );
  const encounters = battleRows.filter((row) => row.cityIds?.some((id) => cities.has(id)));
  const groupIds = new Set(
    encounters.flatMap((row) => [row.groupId, row.newPlayerGroupId]).filter(Boolean),
  );
  const missingGroups = [...groupIds].filter((id) => !enemyGroups.has(id));
  const generals = [...groupIds].flatMap((id) => enemyGroups.get(id)?.generals ?? []);
  const skillIds = new Set(generals.flatMap((general) => general.skills.map((skill) => skill.id)));
  const missingSkills = [...skillIds].filter((id) => !enemySkills.has(id));
  const matching = [...skillIds].map((id) => candidateByEnemySkill.get(id)).filter(Boolean);
  const seasonTactics = tacticCandidates.filter((row) =>
    tactics.find((source) => source.id === row.sourceId).seasonIds.includes(season.id),
  );
  return {
    id: season.id,
    name: season.title,
    regions: season.chapters.length,
    levels: cities.size,
    battles: encounters.length,
    events: eventRows.filter((row) => row.cityIds?.some((id) => cities.has(id))).length,
    studyNodes: tree.filter((row) => row.seasonId === season.id).length,
    enemyGroups: groupIds.size,
    missingGroups,
    distinctEnemySkills: skillIds.size,
    missingSkills,
    enemySkillCandidates: counts(matching),
    tacticCandidates: counts(seasonTactics),
  };
});
const report = {
  schemaVersion: 1,
  status: 'research-only-not-an-authorization-list',
  generatedAt: new Date().toISOString(),
  engine: { tag: candidate.tag, commit: candidate.commit },
  referenceGeneratedAt: manifest.generatedAt,
  normalization:
    'display punctuation and NFKC only; text matches require semantic and runtime review',
  limitation:
    'Counts describe data and mapping candidates. They do not establish official rule fidelity, complete battle support, privacy or mobile verification.',
  sourceFiles: sourceFiles.sort((a, b) => a.dataset.localeCompare(b.dataset)),
  scenarios,
  native: { skillDescriptions: nativeSkills.length, tacticDefinitions: nativeTactics.length },
  candidates: {
    tactics: tacticCandidates,
    skills: skillCandidates,
    enemySkills: enemySkillCandidates,
  },
};
await mkdir(resolve(root, '.runtime/shanhetu-research'), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: destination, native: report.native, scenarios }, null, 2));
