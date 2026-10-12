import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { literal } from '../scripts/native-data.mjs';

const expression = (text: string) => {
  const source = ts.createSourceFile(
    'translation.js',
    `const value = ${text};`,
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = source.statements[0] as ts.VariableStatement;
  return statement.declarationList.declarations[0]!.initializer!;
};

test('固定原生立文的编号说明完整提取，不执行第三方函数', async () => {
  const source = ts.createSourceFile(
    'onlyOL.js',
    await readFile(
      new URL('../.local/noname/v1.11.6/character/onlyOL.js', import.meta.url),
      'utf8',
    ),
    ts.ScriptTarget.Latest,
    true,
  );
  let description: unknown;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'olsbliwen_info')
      description = literal(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(typeof description, 'string');
  assert.match(description as string, /^①游戏开始时/);
  assert.match(description as string, /②当你使用或打出牌后/);
  assert.match(description as string, /③回合结束时/);
  assert.match(description as string, /你摸等量的牌。$/);
});

test('说明解析拒绝动态函数、额外语句和不完整编号', () => {
  for (const text of [
    '(() => { globalThis.translationExecuted = true; return "bad"; })()',
    '(() => { let list = ["甲"]; return list.map((item, i) => globalThis.run(item)).join("。") + "。"; })()',
    '(() => { let list = ["甲", "乙"]; return list.map((item, i) => ["①"][i] + item).join("。") + "。"; })()',
  ])
    assert.equal(literal(expression(text)), undefined);
  assert.equal(Object.hasOwn(globalThis, 'translationExecuted'), false);
});
