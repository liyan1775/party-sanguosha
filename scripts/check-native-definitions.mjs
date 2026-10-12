import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { readNativeData } from './native-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const settings = JSON.parse(await readFile(`${root}/config/roster-presets.json`, 'utf8'));
const engine = `${root}/.local/noname/${settings.engineCandidate}`;
const nativeData = await readNativeData(root);
const packs = new Map();
const skills = new Map();
const cards = new Map();
const choiceDefinitions = new Map();
const dependencies = new Map();
const generalRoots = [];
const key = (name) => name.getText().replace(/^['"]|['"]$/g, '');
function strings(node) {
  const values = new Set();
  function visit(item) {
    if (ts.isStringLiteral(item)) values.add(item.text);
    ts.forEachChild(item, visit);
  }
  visit(node);
  return values;
}
function register(registry, name, pack, node) {
  if (!registry.has(name)) registry.set(name, []);
  registry.get(name).push({ pack, node });
}
// Inspect the pinned compiled definitions without running third-party modules.
for (const kind of ['character', 'card']) {
  for (const file of await readdir(`${engine}/${kind}`)) {
    if (!file.endsWith('.js') || ['rank.js', 'replace.js', 'perfectPairs.js'].includes(file))
      continue;
    const name = `${kind}/${file.slice(0, -3)}`;
    const source = ts.createSourceFile(
      file,
      await readFile(`${engine}/${kind}/${file}`, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const data = { characters: new Map(), groups: new Map() };
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer))
          continue;
        const group = declaration.name.getText();
        const fields = declaration.initializer.properties;
        for (const property of fields) {
          if (!property.name) continue;
          const id = key(property.name);
          if (group === 'characters') data.characters.set(id, property);
          else if (group === 'characterSort') data.groups.set(id, property);
          else if (group === 'skills') register(skills, id, name, property);
          else if (kind === 'card' && ['card', 'skill'].includes(id)) {
            assert(ts.isObjectLiteralExpression(property.initializer));
            for (const item of property.initializer.properties) {
              if (!item.name) continue;
              register(id === 'card' ? cards : skills, key(item.name), name, item);
            }
          } else if (group === 'cards') register(cards, id, name, property);
        }
      }
    }
    packs.set(name, data);
  }
}
function references(node) {
  const result = new Set();
  function visit(item) {
    if (
      ts.isPropertyAssignment(item) &&
      ['inherit', 'group', 'global', 'derivation'].includes(key(item.name))
    )
      for (const value of strings(item.initializer)) result.add(value);
    if (
      ts.isCallExpression(item) &&
      /\.(?:addSkill|addTempSkill|addAdditionalSkill|changeSkills|addSkills|removeSkills|info|createCard|createCard2|createCard3)$/.test(
        item.expression.getText(),
      )
    )
      for (const argument of item.arguments)
        for (const value of strings(argument)) result.add(value);
    if (ts.isPropertyAccessExpression(item) && item.expression.getText().endsWith('.skill'))
      result.add(item.name.text);
    if (
      ts.isElementAccessExpression(item) &&
      item.expression.getText().endsWith('.skill') &&
      ts.isStringLiteral(item.argumentExpression)
    )
      result.add(item.argumentExpression.text);
    if (
      ts.isPropertyAssignment(item) &&
      key(item.name) === 'name' &&
      ts.isStringLiteral(item.initializer) &&
      cards.has(item.initializer.text)
    )
      result.add(item.initializer.text);
    ts.forEachChild(item, visit);
  }
  visit(node);
  return result;
}
for (const preset of settings.presets) {
  const loaded = new Set([
    ...preset.definitionPacks.characters.map((name) => `character/${name}`),
    ...preset.definitionPacks.cards.map((name) => `card/${name}`),
  ]);
  const roster = new Set(nativeData.rosters.get(preset.id));
  assert.equal(roster.size, preset.characters.length, `${preset.id}: duplicate whitelist entry`);
  const visited = new Set();
  function follow(id, registry, from) {
    const definitions = registry.get(id);
    if (!definitions) return; // Generic engine/mode definitions are not pack files.
    const definition = definitions.find((item) => loaded.has(item.pack));
    assert(
      definition,
      `${preset.id}: ${from} needs ${id} from ${definitions.map((item) => item.pack)}`,
    );
    const identity = `${definition.pack}:${id}`;
    if (visited.has(identity)) return identity;
    visited.add(identity);
    choiceDefinitions.set(identity, { id, ...definition });
    const edges = new Set();
    dependencies.set(identity, edges);
    for (const reference of references(definition.node)) {
      for (const registry of [skills, cards]) {
        const child = follow(reference, registry, id);
        if (child) edges.add(child);
      }
    }
    return identity;
  }
  for (const id of roster) {
    const character = nativeData.character(preset, id);
    const roots = [];
    for (const skill of character.skills) {
      assert(skills.has(skill), `Missing native skill ${id}:${skill}`);
      roots.push(follow(skill, skills, id));
    }
    generalRoots.push({ preset: preset.id, general: id, roots });
  }
  // Include every enabled physical card and its native skill closure, keeping
  // definition-only dependencies distinct from the approved physical piles.
  for (const [id, definitions] of cards) {
    if (preset.cardPile.excludedCards.includes(id)) continue;
    if (definitions.some((item) => preset.cardPile.packs.includes(item.pack.slice(5))))
      follow(id, cards, 'card pile');
  }
  console.log(
    `${preset.id}: ${roster.size} generals, ${visited.size} static skill/card dependencies verified`,
  );
}
// Audit the playable rosters and both approved decks' static dependency closure.
// A newly introduced parameterless response cannot silently inherit “牌”.
const choiceAudit = [];
const visibilityAudit = [];
const interactionAudit = [];
for (const { id, pack, node } of choiceDefinitions.values()) {
  const text = node.getText();
  const pileNames = /\blib\.inpile\b|\bget\.inpileVCardList\b|\bget\.inpile\(/.test(text);
  const pileNatures = /\blib\.inpile_nature\b/.test(text);
  const optionPicker =
    ts.isObjectLiteralExpression(node.initializer) &&
    node.initializer.properties.some(
      (property) => property.name && key(property.name) === 'chooseButton',
    );
  if (pileNames || pileNatures || optionPicker)
    interactionAudit.push({
      pack,
      id,
      pileNames,
      pileNatures,
      optionPicker,
      line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
    });
  const handMaterials = /getCards\(["']h["']|viewHandcard|showHandcards/.test(node.getText());
  function visit(item) {
    if (
      ts.isCallExpression(item) &&
      ts.isPropertyAccessExpression(item.expression) &&
      /^choose/.test(item.expression.name.text)
    ) {
      const method = item.expression.name.text;
      const genericResponse = method === 'chooseToRespond' && item.arguments.length === 0;
      assert(
        !genericResponse ||
          (pack === 'card/standard' && ['nanman', 'wanjian', 'juedou'].includes(id)),
        `${pack}:${id} has a new generic response; review its final prompt and add a native serialization case`,
      );
      choiceAudit.push({
        pack,
        id,
        method,
        genericResponse,
        line: item.getSourceFile().getLineAndCharacterOfPosition(item.getStart()).line + 1,
      });
    }
    if (ts.isCallExpression(item) && ts.isPropertyAccessExpression(item.expression)) {
      const method = item.expression.name.text;
      if (
        /^(viewCards|viewHandcards|showHandcards)$/.test(method) ||
        (handMaterials &&
          /^(chooseButton|chooseCardButton|chooseToMove|chooseToMove_new|choosePlayerCard|gainPlayerCard|discardPlayerCard)$/.test(
            method,
          ))
      )
        visibilityAudit.push({
          pack,
          id,
          method,
          line: item.getSourceFile().getLineAndCharacterOfPosition(item.getStart()).line + 1,
          call: item.getText().slice(0, 1000),
        });
    }
    ts.forEachChild(item, visit);
  }
  visit(node);
}
await mkdir(`${root}/.runtime`, { recursive: true });
await writeFile(
  `${root}/.runtime/native-choice-audit.json`,
  JSON.stringify(
    {
      engine: settings.engineCandidate,
      definitions: choiceDefinitions.size,
      choices: choiceAudit,
    },
    null,
    2,
  ),
);
await writeFile(
  `${root}/.runtime/native-visibility-audit.json`,
  JSON.stringify(
    {
      engine: settings.engineCandidate,
      definitions: choiceDefinitions.size,
      sites: visibilityAudit,
    },
    null,
    2,
  ),
);
const relatedGenerals = generalRoots
  .map(({ preset, general, roots }) => {
    const seen = new Set();
    const visit = (identity) => {
      if (!identity || seen.has(identity)) return;
      seen.add(identity);
      for (const child of dependencies.get(identity) ?? []) visit(child);
    };
    roots.forEach(visit);
    return {
      preset,
      general,
      interactions: interactionAudit
        .filter(({ pack, id }) => seen.has(`${pack}:${id}`))
        .map(({ pack, id }) => `${pack}:${id}`),
    };
  })
  .filter(({ interactions }) => interactions.length);
await writeFile(
  `${root}/.runtime/native-interaction-audit.json`,
  JSON.stringify(
    {
      engine: settings.engineCandidate,
      scope: 'Static approved-roster dependencies; dynamic skill paths still need real play.',
      generals: relatedGenerals,
      definitions: interactionAudit,
    },
    null,
    2,
  ),
);
console.log(
  `Choice audit: ${choiceDefinitions.size} static definitions, ${choiceAudit.length} choice sites; generic responses reviewed`,
);
console.log(
  `Interaction audit: ${interactionAudit.filter((item) => item.pileNames || item.pileNatures).length} pile-catalog definitions, ${interactionAudit.filter((item) => item.optionPicker).length} option-picker definitions; ${new Set(relatedGenerals.map((item) => item.general)).size} related generals`,
);
