import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readNativeData } from './native-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { candidate, presets, manifest, packs, rosters } = await readNativeData(root);
const plain = (text) =>
  String(text ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const characters = [];
for (const preset of presets) {
  const definitions = preset.definitionPacks.characters.map((pack) => packs.get(pack));
  const translations = Object.assign(
    {},
    ...definitions.map((data) => data.translates?.values ?? {}),
  );
  for (const id of rosters.get(preset.id)) {
    const data = definitions.find((pack) => pack.characters?.values[id])?.characters.values[id];
    const associated = new Set();
    const describe = (description) =>
      plain(description).replace(/【skill:([\w]+)】/g, (_, id) => {
        associated.add(id);
        return `「${plain(translations[id] ?? id)}」`;
      });
    const skills = data.skills.map((skill) => {
      if (!translations[skill] || !translations[`${skill}_info`])
        throw new Error(`Missing guide description ${id}:${skill}`);
      return {
        id: skill,
        name: plain(translations[skill]),
        description: describe(translations[`${skill}_info`]),
      };
    });
    for (const skill of associated)
      if (!skills.some((item) => item.id === skill) && translations[`${skill}_info`])
        skills.push({
          id: skill,
          name: `${plain(translations[skill])}（关联技能）`,
          description: describe(translations[`${skill}_info`]),
        });
    const portrait = manifest.portraitAliases[id] ?? data.img ?? `image/character/${id}.jpg`;
    if (!manifest.assets.some((asset) => asset.path === portrait))
      throw new Error(`Unverified portrait ${id}: ${portrait}`);
    characters.push({
      id,
      preset: preset.id,
      name: plain(translations[id]),
      faction: data.group,
      hp: String(data.hp),
      portrait: `/engine/core/${portrait}`,
      skills,
    });
  }
}
await writeFile(
  `${root}/config/general-catalog.json`,
  `${JSON.stringify(
    {
      source: {
        repository: candidate.repository,
        tag: candidate.tag,
        commit: candidate.commit,
        license: 'GPL-3.0-only',
      },
      characters,
    },
    null,
    2,
  )}\n`,
);
console.log(`Generated guide: ${characters.length} generals from pinned native definitions.`);
