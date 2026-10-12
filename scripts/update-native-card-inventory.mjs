// Inventory literal deck templates without executing upstream card/skill code.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { format, resolveConfig } from 'prettier';
import { literal } from './native-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
const engine = resolve(root, `.local/noname/${candidate.tag}`);
assert.equal(
  JSON.parse(await readFile(resolve(engine, 'game/build-info.json'))).commit,
  candidate.commit,
  'Pinned card inventory commit mismatch',
);
const key = (name) => (ts.isStringLiteral(name) ? name.text : name.getText());
async function source(path) {
  return ts.createSourceFile(
    path,
    await readFile(resolve(engine, path), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
}
function find(ast, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(matches.length, 1, `Expected one literal template in ${ast.fileName}`);
  return matches[0];
}
function cardList(node) {
  assert(ts.isArrayLiteralExpression(node), 'Expected an array deck template');
  return node.elements.map((item) => {
    assert(ts.isArrayLiteralExpression(item), 'Expected a card tuple');
    const card = literal(item);
    // Some activity cards generate their suit/number at import time. Count
    // their literal names, but do not evaluate or invent those card faces.
    assert(typeof card[2] === 'string', 'Dynamic card name is not supported');
    assert(
      item.elements.length < 4 || card[3] === null || typeof card[3] === 'string',
      'Dynamic card nature is not supported',
    );
    return card;
  });
}
const packageAst = await source('game/package.js');
const catalog = literal(
  find(
    packageAst,
    (node) =>
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText() === 'window.noname_package',
  ).right,
).card;
const templates = new Map();
const translations = {};
for (const [id, name] of Object.entries(catalog)) {
  const path = `card/${id}.js`;
  const ast = await source(path);
  const object = find(ast, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return false;
    return node.properties.some(
      (prop) =>
        ts.isPropertyAssignment(prop) &&
        key(prop.name) === 'name' &&
        literal(prop.initializer) === id,
    );
  });
  const fields = new Map(
    object.properties
      .filter(ts.isPropertyAssignment)
      .map((prop) => [key(prop.name), prop.initializer]),
  );
  const list = fields.get('list');
  assert(list && ts.isArrayLiteralExpression(list), `Non-literal card list: ${path}`);
  const cards = cardList(list);
  const definitions = literal(fields.get('card'));
  for (const [key, value] of Object.entries(literal(fields.get('translate'))))
    if (typeof value === 'string' && translations[key] === undefined) translations[key] = value;
  templates.set(id, { id, name, path, cards, definitions });
}
const natureNames = { fire: '火', thunder: '雷', ice: '冰', stab: '刺' };
function statistics(list) {
  const counts = new Map();
  for (const card of list) {
    assert(
      Array.isArray(card) &&
        (card[0] === undefined || ['spade', 'heart', 'club', 'diamond'].includes(card[0])) &&
        (card[1] === undefined || (Number.isInteger(card[1]) && card[1] >= 1 && card[1] <= 13)) &&
        typeof card[2] === 'string' &&
        (!card[3] || typeof card[3] === 'string'),
      'Unsupported literal card tuple',
    );
    const id = card[2];
    const nature = card[3] || null;
    const key = `${id}:${nature ?? ''}`;
    if (!counts.has(key))
      counts.set(key, {
        id,
        nature,
        name: `${id === 'sha' && nature ? (natureNames[nature] ?? nature) : ''}${translations[id] ?? id}`,
        count: 0,
      });
    counts.get(key).count++;
  }
  const cards = [...counts].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, card]) => card);
  assert.equal(
    cards.reduce((sum, card) => sum + card.count, 0),
    list.length,
  );
  return {
    total: list.length,
    dynamicFaceCards: list.filter((card) => card[0] === undefined || card[1] === undefined).length,
    cards,
  };
}
const reference = (path) => `${candidate.repository}/blob/${candidate.commit}/apps/core/${path}`;
const packs = [...templates.values()].map(({ id, name, path, cards, definitions }) => ({
  id,
  name,
  source: path,
  reference: reference(path),
  // Pack lists can supplement another deck or need other packs' definitions.
  // A listed template does not authorize it for any product room.
  ...statistics(cards),
  modeRestrictedDefinitions: Object.entries(definitions)
    .filter(([, definition]) => definition.mode)
    .map(([id, definition]) => ({ id, modes: definition.mode })),
}));
const nativeModes = [];
for (const [id, name, path, field, variable] of [
  ['single-normal', '新1v1', 'mode/single.js', 'singlePile', false],
  ['single-wuxianhuoli', '无限火力单挑', 'mode/single.js', 'singlePile_wuxianhuoli', false],
  ['doudizhu-online', '智斗三国', 'mode/doudizhu.js', 'online_cardPile', false],
  ['versus-four', '四人对抗（4v4）', 'mode/versus.js', 'cardsFour', false],
  ['guozhan-normal', '国战现行牌堆', 'mode/guozhan/src/info/pile.js', 'normal', true],
  ['guozhan-old', '国战怀旧牌堆', 'mode/guozhan/src/info/pile.js', 'old', true],
  ['guozhan-yingbian', '国战应变牌堆', 'mode/guozhan/src/info/pile.js', 'yingbian', true],
]) {
  const ast = await source(path);
  const node = find(
    ast,
    (node) =>
      (variable ? ts.isVariableDeclaration(node) : ts.isPropertyAssignment(node)) &&
      key(node.name) === field &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer),
  );
  nativeModes.push({
    id,
    name,
    source: path,
    field,
    reference: reference(path),
    ...statistics(cardList(node.initializer)),
  });
}
const standard = templates.get('standard').cards;
const military = [...standard, ...templates.get('extra').cards];
const combinations = [
  { id: 'standard', packs: ['standard'], excludedCards: [], ...statistics(standard) },
  {
    id: 'standard-extra',
    packs: ['standard', 'extra'],
    excludedCards: [],
    ...statistics(military),
  },
  {
    id: 'standard-extra-no-muniu',
    packs: ['standard', 'extra'],
    excludedCards: ['muniu'],
    ...statistics(military.filter((card) => card[2] !== 'muniu')),
  },
];
const inventory = {
  schemaVersion: 1,
  status: 'research-only',
  engine: {
    tag: candidate.tag,
    commit: candidate.commit,
    coreArchiveSha256: candidate.coreArchive.sha256,
  },
  scope:
    'Native package lists, related fixed mode templates and classic combinations; excludes user extensions and programmatic brawl/boss deck changes. Counts describe template entries before mode filtering, not a shuffled match or remaining cards. dynamicFaceCards counts entries with unevaluated suit/number expressions.',
  packs,
  nativeModes,
  combinations,
};
const outputPath = resolve(root, 'config/native-card-inventory.json');
await writeFile(
  outputPath,
  await format(JSON.stringify(inventory), {
    ...(await resolveConfig(outputPath)),
    filepath: outputPath,
  }),
);
console.log(
  `Pinned ${candidate.tag}: ${packs.length} card packs, ${nativeModes.length} fixed mode templates`,
);
for (const pack of packs) console.log(`${pack.id}: ${pack.name}, ${pack.total} template entries`);
console.log(
  `Classic combinations: ${combinations.map((deck) => `${deck.id}=${deck.total}`).join(', ')}`,
);
