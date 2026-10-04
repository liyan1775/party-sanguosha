// Maintenance helper: derive portrait assets from the already pinned core and
// the fixed upstream Git tree, never from a floating branch.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
const manifestPath = resolve(root, 'config/noname-lab-assets.json');
const manifest = JSON.parse(await readFile(manifestPath));
const tree = JSON.parse(await readFile(resolve(root, '.local/research/upstream-tree.json')));
if (tree.sha !== candidate.commit || manifest.commit !== candidate.commit)
  throw new Error('Pinned source tree mismatch');
const preset = JSON.parse(await readFile(resolve(root, 'config/roster-presets.json'))).presets.find(
  (preset) => preset.id === 'advanced',
);
async function literal(pack, name) {
  const source = await readFile(
    resolve(root, `.local/noname/${candidate.tag}/character/${pack}.js`),
    'utf8',
  );
  const match = source.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\});`));
  if (!match) throw new Error(`Missing pinned ${pack} ${name}`);
  // This evaluates only the release's data object, not its skills or entry point.
  return Function(`return (${match[1]})`)();
}
const names = new Set(preset.additionalCharacters);
for (const pack of preset.completePacks)
  for (const name of Object.keys(await literal(pack, 'characters'))) names.add(name);
for (const [pack, groups] of Object.entries(preset.packGroups)) {
  const sort = await literal(pack, 'characterSort');
  for (const group of groups) for (const name of sort[group]) names.add(name);
}
let added = 0;
manifest.portraitAliases ??= {};
for (const name of names) {
  let path = `image/character/${name}.jpg`;
  let blob = tree.tree.find((entry) => entry.path === `apps/core/${path}`);
  if (!blob) {
    const base = name.replace(/^(?:(?:xin|old|re|ol|dc|std|sp)_)+/, '');
    path = `image/character/${base}.jpg`;
    blob = tree.tree.find((entry) => entry.path === `apps/core/${path}`);
    if (blob) manifest.portraitAliases[name] = path;
  }
  if (!blob) throw new Error(`Missing fixed portrait ${path}`);
  if (manifest.assets.some((entry) => entry.path === path)) continue;
  manifest.assets.push({ path, bytes: blob.size, gitBlobSha: blob.sha });
  added++;
}
manifest.assets.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Advanced whitelist: ${names.size} generals; added ${added} pinned portraits.`);
