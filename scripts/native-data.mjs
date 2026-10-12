import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { rosterNames } from '../packages/noname-adapter/runtime/roster-policy.js';

const key = (name) => (ts.isStringLiteral(name) ? name.text : name.getText());
// Translation getters occasionally choose between two literal spellings.
// Display their first spelling without evaluating the getter or its condition.
function translationGetter(prop) {
  const statement = prop.body?.statements[0];
  if (prop.body?.statements.length !== 1 || !statement || !ts.isReturnStatement(statement))
    return undefined;
  const expression = statement.expression;
  if (
    expression &&
    ts.isConditionalExpression(expression) &&
    ts.isStringLiteral(expression.whenTrue) &&
    ts.isStringLiteral(expression.whenFalse)
  )
    return expression.whenTrue;
  return expression && ts.isStringLiteral(expression) ? expression : undefined;
}
export function strings(node) {
  const values = new Set();
  const visit = (item) => {
    if (ts.isStringLiteral(item) || ts.isNoSubstitutionTemplateLiteral(item)) values.add(item.text);
    ts.forEachChild(item, visit);
  };
  visit(node);
  return [...values];
}
// Some native translations assemble numbered clauses from two literal arrays.
// Recognize that exact syntax; do not execute an IIFE or arbitrary map callback.
function numberedTranslation(node) {
  if (!ts.isCallExpression(node) || node.arguments.length) return undefined;
  let fn = node.expression;
  while (ts.isParenthesizedExpression(fn)) fn = fn.expression;
  if (!ts.isArrowFunction(fn) || fn.parameters.length || !ts.isBlock(fn.body)) return undefined;
  const [declaration, result] = fn.body.statements;
  if (
    fn.body.statements.length !== 2 ||
    !ts.isVariableStatement(declaration) ||
    declaration.declarationList.declarations.length !== 1 ||
    !ts.isReturnStatement(result)
  )
    return undefined;
  const binding = declaration.declarationList.declarations[0];
  if (!ts.isIdentifier(binding.name) || !binding.initializer) return undefined;
  const values = literal(binding.initializer);
  const expression = result.expression;
  if (
    !Array.isArray(values) ||
    !values.every((value) => typeof value === 'string') ||
    !expression ||
    !ts.isBinaryExpression(expression) ||
    expression.operatorToken.kind !== ts.SyntaxKind.PlusToken ||
    !ts.isStringLiteral(expression.right)
  )
    return undefined;
  const join = expression.left;
  if (
    !ts.isCallExpression(join) ||
    !ts.isPropertyAccessExpression(join.expression) ||
    join.expression.name.text !== 'join' ||
    join.arguments.length !== 1 ||
    !ts.isStringLiteral(join.arguments[0])
  )
    return undefined;
  const map = join.expression.expression;
  if (
    !ts.isCallExpression(map) ||
    !ts.isPropertyAccessExpression(map.expression) ||
    map.expression.name.text !== 'map' ||
    map.expression.expression.getText() !== binding.name.text ||
    map.arguments.length !== 1
  )
    return undefined;
  const callback = map.arguments[0];
  if (!ts.isArrowFunction(callback) || callback.parameters.length !== 2) return undefined;
  const body = callback.body;
  if (
    !ts.isBinaryExpression(body) ||
    body.operatorToken.kind !== ts.SyntaxKind.PlusToken ||
    !ts.isElementAccessExpression(body.left) ||
    body.left.argumentExpression.getText() !== callback.parameters[1].name.getText() ||
    body.right.getText() !== callback.parameters[0].name.getText()
  )
    return undefined;
  const prefixes = literal(body.left.expression);
  if (
    !Array.isArray(prefixes) ||
    prefixes.length !== values.length ||
    !prefixes.every((value) => typeof value === 'string')
  )
    return undefined;
  return (
    values.map((value, index) => prefixes[index] + value).join(join.arguments[0].text) +
    expression.right.text
  );
}
// Deliberately read literal data only; never execute upstream skill code.
export function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  const numbered = numberedTranslation(node);
  if (numbered !== undefined) return numbered;
  if (
    ts.isCallExpression(node) &&
    node.expression.getText() === 'get.poptip' &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0])
  )
    return `【skill:${node.arguments[0].text}】`;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literal(node.left),
      right = literal(node.right);
    return typeof left === 'string' && typeof right === 'string' ? left + right : undefined;
  }
  if (ts.isTemplateExpression(node)) {
    const parts = node.templateSpans.map((span) => {
      const expression = span.expression;
      // Literal arrays of skill poptips (e.g. 经合's twelve 天书 skills).
      if (
        ts.isCallExpression(expression) &&
        ts.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === 'join'
      ) {
        const map = expression.expression.expression;
        const separator = expression.arguments[0];
        if (
          ts.isCallExpression(map) &&
          ts.isPropertyAccessExpression(map.expression) &&
          map.expression.name.text === 'map' &&
          ts.isArrayLiteralExpression(map.expression.expression) &&
          separator &&
          ts.isStringLiteral(separator)
        ) {
          const callback = map.arguments[0];
          const values = map.expression.expression.elements;
          if (
            callback &&
            ts.isArrowFunction(callback) &&
            callback.parameters.length === 1 &&
            ts.isCallExpression(callback.body) &&
            callback.body.expression.getText() === 'get.poptip' &&
            callback.body.arguments.length === 1 &&
            callback.body.arguments[0].getText() === callback.parameters[0].name.getText() &&
            values.every(ts.isStringLiteral)
          )
            return (
              values.map((value) => `【skill:${value.text}】`).join(separator.text) +
              span.literal.text
            );
        }
      }
      if (!ts.isCallExpression(expression) || expression.expression.getText() !== 'get.poptip')
        return undefined;
      const argument = expression.arguments[0];
      if (argument && ts.isStringLiteral(argument))
        return `【skill:${argument.text}】${span.literal.text}`;
      // Native object poptips contain their own literal explanation (e.g.
      // 神典韦's general-as-weapon rules), not another skill translation.
      if (argument && ts.isObjectLiteralExpression(argument)) {
        const tip = literal(argument);
        if (typeof tip.name === 'string' && typeof tip.info === 'string')
          return `${tip.name}（${tip.info}）${span.literal.text}`;
        if (typeof tip.name === 'string' && tip.dialog === 'characterDialog')
          return `${tip.name}${span.literal.text}`;
      }
      return undefined;
    });
    return parts.includes(undefined) ? undefined : node.head.text + parts.join('');
  }
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties
        .filter(ts.isPropertyAssignment)
        .map((prop) => [key(prop.name), literal(prop.initializer)]),
    );
  return undefined;
}
export async function readNativeData(root, { allPacks = false } = {}) {
  const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
  const presets = JSON.parse(await readFile(resolve(root, 'config/roster-presets.json'))).presets;
  const manifest = JSON.parse(await readFile(resolve(root, 'config/noname-lab-assets.json')));
  const engine = resolve(root, `.local/noname/${candidate.tag}`);
  if (
    JSON.parse(await readFile(resolve(engine, 'game/build-info.json'))).commit !== candidate.commit
  )
    throw new Error('Pinned native data mismatch');
  const packs = new Map();
  const packNames = allPacks
    ? (await readdir(resolve(engine, 'character')))
        .filter(
          (file) =>
            file.endsWith('.js') && !['rank.js', 'replace.js', 'perfectPairs.js'].includes(file),
        )
        .map((file) => file.slice(0, -3))
    : new Set(presets.flatMap((p) => p.definitionPacks.characters));
  for (const pack of packNames) {
    const source = ts.createSourceFile(
      `${pack}.js`,
      await readFile(resolve(engine, `character/${pack}.js`), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const data = {};
    const substitute = (node) => {
      if (ts.isPropertyAssignment(node) && key(node.name) === 'characterSubstitute')
        data.characterSubstitute = { values: literal(node.initializer) ?? {} };
      ts.forEachChild(node, substitute);
    };
    substitute(source);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer))
          continue;
        data[declaration.name.getText()] = { nodes: new Map(), values: {} };
        const target = data[declaration.name.getText()];
        for (const prop of declaration.initializer.properties) {
          const value = ts.isPropertyAssignment(prop)
            ? prop.initializer
            : declaration.name.getText() === 'translates' && ts.isGetAccessor(prop)
              ? translationGetter(prop)
              : undefined;
          if (!value) continue;
          target.nodes.set(key(prop.name), value);
          target.values[key(prop.name)] = literal(value);
        }
      }
    }
    packs.set(pack, data);
  }
  const rosters = new Map(
    presets.map((preset) => {
      return [
        preset.id,
        rosterNames(
          preset,
          Object.fromEntries([...packs].map(([id, data]) => [id, data.characters?.values])),
          Object.fromEntries([...packs].map(([id, data]) => [id, data.characterSort?.values])),
        ),
      ];
    }),
  );
  const character = (preset, id) => {
    if (preset.characterOverrides) throw new Error('将池只允许选择原生武将');
    const data = preset.definitionPacks.characters
      .map((pack) => packs.get(pack).characters?.values[id])
      .find(Boolean);
    if (!data) throw new Error(`Missing native character ${preset.id}/${id}`);
    return { ...data, maxHp: data.maxHp ?? data.hp };
  };
  const translations = (preset) =>
    Object.assign(
      {},
      ...preset.definitionPacks.characters.map((pack) => packs.get(pack).translates?.values ?? {}),
    );
  return { candidate, presets, manifest, packs, rosters, character, translations };
}
