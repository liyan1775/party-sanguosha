import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readNativeData, strings } from './native-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { candidate, manifest, packs, rosters } = await readNativeData(root);
const tree = JSON.parse(await readFile(`${root}/.local/research/upstream-tree.json`));
if (tree.sha !== candidate.commit || manifest.commit !== candidate.commit)
  throw new Error('Pinned audio tree mismatch');
const allSkills = new Map();
for (const data of packs.values())
  for (const [id, node] of data.skills?.nodes ?? []) allSkills.set(id, node);
const stems = new Set(['feiyang', 'bahu']);
const deaths = new Set();
const visited = new Set();
function follow(skill) {
  if (visited.has(skill)) return;
  visited.add(skill);
  stems.add(skill);
  const node = allSkills.get(skill);
  if (!node) return;
  for (const value of strings(node)) {
    // Covers native audio redirects, audioname variants and derived skills.
    if (/^[\w:/.-]+$/.test(value)) {
      stems.add(
        value
          .replace(/^skill\//, '')
          .replace(/\.mp3$/, '')
          .replace(/:\d+$/, ''),
      );
      if (allSkills.has(value)) follow(value);
    }
  }
}
for (const roster of rosters.values())
  for (const id of roster) {
    const character = [...packs.values()].find((pack) => pack.characters?.values[id])?.characters
      .values[id];
    deaths.add(id);
    for (const audio of character.dieAudios ?? [])
      deaths.add(audio.replace(/^die\//, '').replace(/\.mp3$/, ''));
    for (const skill of character.skills) follow(skill);
  }
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const skillPattern = new RegExp(
  `^apps/core/audio/skill/(?:${[...stems]
    .filter((stem) => /^[\w-]+$/.test(stem))
    .map(escape)
    .join('|')})(?:\\d|_|\\.)`,
);
const deathPattern = new RegExp(
  `^apps/core/audio/die/(?:${[...deaths].map(escape).join('|')})(?:\\d|\\.)`,
);
let added = 0;
for (const blob of tree.tree) {
  if (!blob.path.endsWith('.mp3')) continue;
  if (
    !/^apps\/core\/audio\/(?:card\/(?:male|female)|effect)\//.test(blob.path) &&
    !skillPattern.test(blob.path) &&
    !deathPattern.test(blob.path)
  )
    continue;
  const path = blob.path.slice('apps/core/'.length);
  if (manifest.assets.some((entry) => entry.path === path)) continue;
  manifest.assets.push({ path, bytes: blob.size, gitBlobSha: blob.sha });
  added++;
}
manifest.assets.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(`${root}/config/noname-lab-assets.json`, `${JSON.stringify(manifest, null, 2)}\n`);
const audio = manifest.assets.filter((entry) => entry.path.startsWith('audio/'));
console.log(
  `Pinned audio: ${audio.length} files, ${(audio.reduce((sum, entry) => sum + entry.bytes, 0) / 1024 / 1024).toFixed(1)} MiB; added ${added}.`,
);
