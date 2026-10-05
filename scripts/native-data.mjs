import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const key = (name) => (ts.isStringLiteral(name) ? name.text : name.getText());
export function strings(node) {
  const values = new Set();
  const visit = (item) => {
    if (ts.isStringLiteral(item) || ts.isNoSubstitutionTemplateLiteral(item)) values.add(item.text);
    ts.forEachChild(item, visit);
  };
  visit(node);
  return [...values];
}
// Deliberately read literal data only; never execute upstream skill code.
export function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    const parts = node.templateSpans.map((span) => {
      const expression = span.expression;
      if (
        !ts.isCallExpression(expression) ||
        expression.expression.getText() !== 'get.poptip' ||
        !ts.isStringLiteral(expression.arguments[0])
      )
        return undefined;
      return `【skill:${expression.arguments[0].text}】${span.literal.text}`;
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
export async function readNativeData(root) {
  const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
  const presets = JSON.parse(await readFile(resolve(root, 'config/roster-presets.json'))).presets;
  const manifest = JSON.parse(await readFile(resolve(root, 'config/noname-lab-assets.json')));
  const engine = resolve(root, `.local/noname/${candidate.tag}`);
  if (
    JSON.parse(await readFile(resolve(engine, 'game/build-info.json'))).commit !== candidate.commit
  )
    throw new Error('Pinned native data mismatch');
  const packs = new Map();
  for (const pack of new Set(presets.flatMap((p) => p.definitionPacks.characters))) {
    const source = ts.createSourceFile(
      `${pack}.js`,
      await readFile(resolve(engine, `character/${pack}.js`), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const data = {};
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer))
          continue;
        data[declaration.name.getText()] = { nodes: new Map(), values: {} };
        const target = data[declaration.name.getText()];
        for (const prop of declaration.initializer.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          target.nodes.set(key(prop.name), prop.initializer);
          target.values[key(prop.name)] = literal(prop.initializer);
        }
      }
    }
    packs.set(pack, data);
  }
  const rosters = new Map(
    presets.map((preset) => {
      const names = new Set(preset.additionalCharacters);
      for (const pack of preset.completePacks)
        for (const name of Object.keys(packs.get(pack).characters.values)) names.add(name);
      for (const [pack, groups] of Object.entries(preset.packGroups))
        for (const group of groups)
          for (const name of packs.get(pack).characterSort.values[group]) names.add(name);
      return [preset.id, [...names]];
    }),
  );
  return { candidate, presets, manifest, packs, rosters };
}
