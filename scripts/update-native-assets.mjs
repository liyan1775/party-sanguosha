// Maintenance helper: derive portrait assets from the already pinned core and
// the fixed upstream Git tree, never from a floating branch.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNativeData, strings } from './native-data.mjs';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
const manifestPath = resolve(root, 'config/noname-lab-assets.json');
const manifest = JSON.parse(await readFile(manifestPath));
const tree = JSON.parse(await readFile(resolve(root, '.local/research/upstream-tree.json')));
if (tree.sha !== candidate.commit || manifest.commit !== candidate.commit)
  throw new Error('Pinned source tree mismatch');
const { rosters, presets, packs, character } = await readNativeData(root);
const names = new Set([...rosters.values()].flat());
let added = 0;
manifest.portraitAliases ??= {};
manifest.portraitVariants = {};
const blobs = new Map(tree.tree.map((blob) => [blob.path, blob]));
function addPortrait(path) {
  const blob = blobs.get(`apps/core/${path}`);
  if (!blob) throw new Error(`Missing fixed portrait ${path}`);
  if (!manifest.assets.some((entry) => entry.path === path)) {
    manifest.assets.push({ path, bytes: blob.size, gitBlobSha: blob.sha });
    added++;
  }
}
for (const name of names) {
  const preset = presets.find((entry) => rosters.get(entry.id).includes(name));
  const native = character(preset, name);
  if (native.hasHiddenSkill) addPortrait('image/character/hidden_image.jpg');
  let path = manifest.portraitAliases?.[name] ?? native.img ?? `image/character/${name}.jpg`;
  let blob = tree.tree.find((entry) => entry.path === `apps/core/${path}`);
  if (!blob) {
    const base = name.replace(/^(?:(?:xin|old|re|ol|dc|std|sp)_)+/, '');
    path = `image/character/${base}.jpg`;
    blob = tree.tree.find((entry) => entry.path === `apps/core/${path}`);
    if (blob) manifest.portraitAliases[name] = path;
  }
  if (!blob) throw new Error(`Missing fixed portrait ${path}`);
  addPortrait(path);
  const variants = new Set();
  const skills = new Map(
    preset.definitionPacks.characters.flatMap((pack) => [...(packs.get(pack).skills?.nodes ?? [])]),
  );
  const visited = new Set();
  function inspect(skill) {
    if (visited.has(skill)) return;
    visited.add(skill);
    const node = skills.get(skill);
    if (!node) return;
    const visit = (item) => {
      if (
        ts.isCallExpression(item) &&
        ts.isPropertyAccessExpression(item.expression) &&
        item.expression.name.text === 'changeSkin'
      )
        for (const value of strings(item))
          if (value !== name && blobs.has(`apps/core/image/character/${value}.jpg`))
            variants.add(value);
      ts.forEachChild(item, visit);
    };
    visit(node);
    for (const value of strings(node)) if (skills.has(value)) inspect(value);
  }
  for (const skill of native.skills) inspect(skill);
  for (const pack of preset.definitionPacks.characters)
    for (const [variant] of packs.get(pack).characterSubstitute?.values[name] ?? [])
      variants.add(variant);
  if (variants.size) {
    manifest.portraitVariants[name] = [...variants].sort();
    for (const variant of variants) addPortrait(`image/character/${variant}.jpg`);
  }
}
manifest.assets.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Explicit whitelists: ${names.size} generals; added ${added} pinned portraits.`);
