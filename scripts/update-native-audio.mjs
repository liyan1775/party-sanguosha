import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readNativeData, strings } from './native-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const {
  candidate,
  manifest,
  packs,
  rosters,
  presets,
  character: resolveCharacter,
} = await readNativeData(root);
const tree = JSON.parse(await readFile(`${root}/.local/research/upstream-tree.json`));
if (tree.sha !== candidate.commit || manifest.commit !== candidate.commit)
  throw new Error('Pinned audio tree mismatch');
function audioPatterns(preset) {
  const allSkills = new Map();
  for (const pack of preset.definitionPacks.characters)
    for (const [id, node] of packs.get(pack).skills?.nodes ?? []) allSkills.set(id, node);
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
  for (const id of rosters.get(preset.id)) {
    const character = resolveCharacter(preset, id);
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
  return [skillPattern, deathPattern];
}
const patterns = new Map(presets.map((preset) => [preset.id, audioPatterns(preset)]));
manifest.audioFilesByPreset = Object.fromEntries(presets.map((preset) => [preset.id, []]));
let added = 0;
for (const blob of tree.tree) {
  if (!blob.path.endsWith('.mp3')) continue;
  const matching = presets.filter(
    (preset) =>
      /^apps\/core\/audio\/(?:card\/(?:male|female)|effect)\//.test(blob.path) ||
      patterns.get(preset.id).some((pattern) => pattern.test(blob.path)),
  );
  if (!matching.length) continue;
  const path = blob.path.slice('apps/core/'.length);
  for (const preset of matching) manifest.audioFilesByPreset[preset.id].push(path.slice(6));
  if (manifest.assets.some((entry) => entry.path === path)) continue;
  manifest.assets.push({ path, bytes: blob.size, gitBlobSha: blob.sha });
  added++;
}
manifest.assets.sort((a, b) => a.path.localeCompare(b.path));
for (const files of Object.values(manifest.audioFilesByPreset)) files.sort();
await writeFile(`${root}/config/noname-lab-assets.json`, `${JSON.stringify(manifest, null, 2)}\n`);
const audio = manifest.assets.filter((entry) => entry.path.startsWith('audio/'));
console.log(
  `Pinned audio: ${audio.length} files, ${(audio.reduce((sum, entry) => sum + entry.bytes, 0) / 1024 / 1024).toFixed(1)} MiB; added ${added}.`,
);
