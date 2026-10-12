// SPDX-License-Identifier: GPL-3.0-only

/** One whitelist is shared by the native runtime and the offline data tools. */
export function rosterNames(preset, characters = {}, sorts = {}) {
  if (Array.isArray(preset.characters)) return [...preset.characters];
  const names = new Set(preset.additionalCharacters);
  for (const pack of preset.completePacks)
    for (const name of Object.keys(characters[pack] ?? {})) names.add(name);
  for (const [pack, groups] of Object.entries(preset.packGroups))
    for (const group of groups) for (const name of sorts[pack]?.[group] ?? []) names.add(name);
  return [...names];
}

/** Validate the whitelist without changing any upstream character or skill. */
export function validateNativeRoster(lib, preset) {
  if (preset.characterOverrides) throw new Error('将池只允许选择原生武将，不允许覆盖武将规则');
  const names = rosterNames(preset);
  if (new Set(names).size !== names.length) throw new Error('将池包含重复武将');
  for (const id of names) {
    const character = lib.character[id];
    if (!character) throw new Error(`武将包未启用：${id}`);
    for (const skill of character.skills)
      if (!lib.skill[skill]) throw new Error(`缺少原生技能：${id}/${skill}`);
  }
}
