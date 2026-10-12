import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readNativeData } from './native-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const {
  candidate,
  presets,
  packs,
  manifest,
  rosters,
  character,
  translations: translate,
} = await readNativeData(root);
const plain = (text) =>
  String(text ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const characters = [];
const official = JSON.parse(await readFile(`${root}/config/official-rosters.json`, 'utf8')).rosters;
for (const preset of presets) {
  const officialEntries = official.find((roster) => roster.id === preset.id)?.entries ?? [];
  const translations = translate(preset);
  const nativeSkill = (id) =>
    preset.definitionPacks.characters
      .map((pack) => packs.get(pack).skills?.values[id])
      .find(Boolean);
  for (const id of rosters.get(preset.id)) {
    const officialEntry = officialEntries.find((entry) => entry.nativeId === id);
    const data = character(preset, id);
    const associated = new Set();
    const inspected = new Set();
    const collectDerivations = (id) => {
      if (inspected.has(id)) return;
      inspected.add(id);
      const skill = nativeSkill(id);
      if (!skill) return;
      const derivations = Array.isArray(skill.derivation) ? skill.derivation : [skill.derivation];
      for (const derivation of derivations)
        if (typeof derivation === 'string') associated.add(derivation);
      if (typeof skill.inherit === 'string') collectDerivations(skill.inherit);
    };
    for (const skill of data.skills) collectDerivations(skill);
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
      if (!skills.some((item) => item.id === skill) && translations[`${skill}_info`]) {
        collectDerivations(skill);
        skills.push({
          id: skill,
          name: `${plain(translations[skill])}（关联技能）`,
          description: describe(translations[`${skill}_info`]),
        });
      }
    const portrait = manifest.portraitAliases[id] ?? data.img ?? `image/character/${id}.jpg`;
    if (!manifest.assets.some((asset) => asset.path === portrait))
      throw new Error(`Unverified portrait ${id}: ${portrait}`);
    characters.push({
      id,
      preset: preset.id,
      name: plain(translations[id]),
      ...(officialEntry?.versionNote ? { versionNote: officialEntry.versionNote } : {}),
      ...(officialEntries.some((entry) => entry.nativeId === id)
        ? {
            officialName: officialEntries
              .find((entry) => entry.nativeId === id)
              .officialName.replace(/;/g, ''),
          }
        : {}),
      faction: data.group,
      hp: data.hp === data.maxHp ? String(data.hp) : `${data.hp}/${data.maxHp}`,
      ...(data.hujia ? { armor: data.hujia } : {}),
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
