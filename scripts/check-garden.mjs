import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join, posix } from 'node:path';
import ts from 'typescript';

const rerun = 'npm run check:garden';
const charter = 'docs/charter.md';
const handoff = 'docs/handoff.md';
function report(file, reason, fix) {
  console.error(`${file} — ${reason}。修复：${fix}。重跑：${rerun}`);
  process.exitCode = 1;
}

function scan(directory, extension, inspect) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = posix.join(directory, entry.name);
    if (entry.isDirectory()) scan(file, extension, inspect);
    else if (entry.isFile() && extension.test(file)) inspect(file, readFileSync(file, 'utf8'));
  }
}

function inspectImports(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest);
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isExternalModuleReference(node)) {
      specifier = node.expression;
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifier = node.argument.literal;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.getText(ast) === 'require.resolve'))
    ) {
      specifier = node.arguments[0];
    }
    if (
      specifier &&
      ts.isStringLiteralLike(specifier) &&
      (specifier.text.startsWith('node:') || isBuiltin(specifier.text))
    ) {
      const { line } = ast.getLineAndCharacterOfPosition(specifier.getStart(ast));
      report(
        `${file}:${line + 1}`,
        `共享包依赖 Node 模块 ${specifier.text}`,
        '将平台调用移至服务端或适配器，共享层只保留跨端协议',
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

function inspectMotion(file, source) {
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const match = /\bprefers-reduced-(?:motion|transparency)\b/i.exec(line);
    if (match)
      report(
        `${file}:${index + 1}`,
        `出现系统动效偏好 ${match[0]}`,
        '移除自动降级条件，通过玩家主动选择控制动效',
      );
  }
}

function inspectCharter() {
  const source = readFileSync(charter, 'utf8');
  if (source.trimEnd().split(/\r?\n/).length > 60 || source.split(/\r?\n/).length > 61)
    report(
      charter,
      '北极星页超过 60 行',
      '精简措辞，只留第一性原理、明确不做、单向门初衷与修宪记录',
    );
  const sections = source.split(/^##\s+/m).slice(1);
  for (const [pattern, name] of [
    [/^第一性原理\s*\r?\n/, '第一性原理'],
    [/^明确不做/, '明确不做'],
    [/^单向门决策备忘/, '单向门决策备忘'],
    [/^修宪记录\s*\r?\n/, '修宪记录'],
  ]) {
    if (!sections.some((section) => pattern.test(section)))
      report(charter, `缺少“${name}”分段`, `在 ${charter} 中补回“## ${name}”分段`);
  }
}

function inspectHandoff() {
  const source = readFileSync(handoff, 'utf8');
  if (source.trimEnd().split(/\r?\n/).length > 180 || source.split(/\r?\n/).length > 181)
    report(handoff, '活交接超过 180 行', '将历史记录移入 docs/archive 并保留链接');
  const sections = source.split(/^##\s+/m).slice(1);
  const entry = sections.find((section) => /^正式打开入口\s*\r?\n/.test(section));
  if (
    !entry ||
    !['源码', '发行包', '启动聚会三国杀.cmd', '无黑框启动聚会三国杀.vbs'].every((item) =>
      entry.includes(item),
    )
  )
    report(
      handoff,
      '缺少完整启动入口分段',
      '在“正式打开入口”中分别列出源码 CMD 与 Windows 发行包 VBS',
    );
  const boundary = sections.find((section) => /^尚未验通的硬边界\s*\r?\n/.test(section));
  if (!boundary || !['微信', 'Windows'].every((item) => boundary.includes(item)))
    report(
      handoff,
      '缺少独立 Windows 与实体微信待验分段',
      '在“尚未验通的硬边界”中说明各项实测边界',
    );
  if (/v0\.7\.11\b/i.test(source))
    report(handoff, '出现过时的 v0.7.11 候选导航', '移至历史归档并指向当前基线');
  const tracked = new Set(
    execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0'),
  );
  for (const match of source.matchAll(/(?:\]\(\s*|^\s*\[[^\]]+\]:\s*)(?:<([^>]+)>|([^\s)]+))/gm)) {
    const target = (match[1] ?? match[2]).split(/[?#]/)[0];
    if (!target || /^(?:[a-z]+:|\/\/)/i.test(target)) continue;
    const path = posix.normalize(posix.join('docs', decodeURIComponent(target)));
    if (
      !tracked.has(path) ||
      !statSync(join(process.cwd(), path), { throwIfNoEntry: false })?.isFile()
    )
      report(
        handoff,
        `链接 ${target} 缺少可随仓库交付的文件`,
        '改为存在且受 Git 跟踪的相对路径，新增文档请用 git add 纳入版本管理',
      );
  }
}

for (const [path, check] of [
  ['packages/shared/src', () => scan('packages/shared/src', /\.[cm]?[jt]sx?$/i, inspectImports)],
  ...['apps/web/src', 'website'].map((dir) => [
    dir,
    () => scan(dir, /\.(?:[cm]?[jt]sx?|css|scss|sass|less|html?|svg)$/i, inspectMotion),
  ]),
  [charter, inspectCharter],
  [handoff, inspectHandoff],
]) {
  try {
    check();
  } catch (error) {
    report(path, error.message, '检查路径、文件内容及本机 Git 后，从仓库根目录执行检查');
  }
}
if (!process.exitCode) console.log('项目地图护栏通过');
