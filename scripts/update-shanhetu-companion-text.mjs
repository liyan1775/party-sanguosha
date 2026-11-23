// SPDX-License-Identifier: GPL-3.0-only
import { readFile, writeFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const catalog = JSON.parse(await read('../config/shanhetu-companions.json'));
const engine = JSON.parse(await read('../config/general-catalog.json')).source;
const runtime = await read('../packages/noname-adapter/runtime/shanhetu-skills.js');
const packs = new Set(catalog.companions.flatMap(({ definitionPacks }) => definitionPacks));
const sources = new Map(
  await Promise.all(
    [...packs].map(async (pack) => [
      pack,
      await read(`../.local/noname/${engine.tag}/src/character/${pack}/translate.js`),
    ]),
  ),
);

const translations = new Map();
for (const companion of catalog.companions) {
  for (const { nativeId } of companion.skills) {
    if (!/^[a-z0-9_]+$/.test(nativeId)) throw new Error(`Invalid skill ID ${nativeId}`);
    const versions = translations.get(nativeId) ?? new Set();
    const native = new RegExp(`^\\s*${nativeId}_info:\\s*("(?:[^"\\\\]|\\\\.)*"),`, 'm');
    const custom = new RegExp(
      `const id = '${nativeId}';\\s*lib\\.translate\\[id\\] = '[^']+';\\s*lib\\.translate\\[[^\\]]+\\] =\\s*'([^']+)';`,
    );
    const localText = runtime.match(custom)?.[1];
    if (localText) versions.add(localText);
    for (const pack of companion.definitionPacks) {
      const quotedText = sources.get(pack).match(native)?.[1];
      if (quotedText) versions.add(JSON.parse(quotedText));
    }
    translations.set(nativeId, versions);
  }
}

const output = Object.fromEntries(
  [...translations]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, versions]) => {
      if (versions.size !== 1) throw new Error(`Expected one translation for ${id}`);
      return [id, [...versions][0]];
    }),
);
await writeFile(
  new URL('../config/shanhetu-companion-text.json', import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`,
);
