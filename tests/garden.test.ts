import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/check-garden.mjs');
const charter = [
  '# 项目北极星',
  '## 第一性原理',
  '一台电脑开服，手机扫码即玩。',
  '## 明确不做（Non-Goals）',
  '不做账号和商业解锁。',
  '## 单向门决策备忘（Why）',
  '固定无名杀原生引擎。',
  '## 修宪记录',
  '- 2026-11-27｜立宪',
].join('\n');
const handoff = [
  '## 正式打开入口',
  '源码：启动聚会三国杀.cmd。Windows 发行包：无黑框启动聚会三国杀.vbs。',
  '## 尚未验通的硬边界',
  '实体微信、朋友 Windows 首装。',
  '[产品](product.md)',
].join('\n');

test('项目地图护栏允许合规源码，并为每个违规文件给出修复和重跑命令', async () => {
  mkdirSync(resolve('test-results'), { recursive: true });
  const cwd = mkdtempSync(resolve('test-results/garden-test-'));
  const write = (path: string, source: string) => writeFileSync(resolve(cwd, path), source);
  const run = () => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  try {
    for (const directory of ['packages/shared/src', 'apps/web/src', 'website', 'docs']) {
      mkdirSync(resolve(cwd, directory), { recursive: true });
    }
    execFileSync('git', ['init', '-q'], { cwd });
    write('docs/product.md', '# 产品');
    execFileSync('git', ['add', '--', 'docs/product.md'], { cwd });
    write('docs/charter.md', charter);
    write('docs/handoff.md', handoff);
    write('packages/shared/src/model.ts', "import type { Card } from './cards.js';");
    write('website/style.css', '@media (max-width: 800px) { .card { display: block; } }');
    const clean = run();
    assert.equal(clean.status, 0, clean.stderr);
    write(
      'packages/shared/src/model.ts',
      [
        "import 'node:fs';",
        "export { readFile } from 'fs/promises';",
        "const os = await import('os');",
        "const path = require('path');",
      ].join('\n'),
    );
    write('apps/web/src/table.ts', "matchMedia('(prefers-reduced-transparency: reduce)')");
    write(
      'website/style.css',
      '@media (prefers-reduced-motion: reduce) { .card { animation: none; } }',
    );
    write('docs/draft.md', '未受跟踪');
    write('docs/charter.md', '\n'.repeat(61) + '# 空白北极星');
    write(
      'docs/handoff.md',
      '\n'.repeat(181) + '下一项按 v0.7.11 候选执行 [缺失](missing.md) [草稿](draft.md)',
    );
    const broken = run();
    assert.equal(broken.status, 1, broken.stderr);
    for (const [path, reasons] of Object.entries({
      'packages/shared/src/model.ts': ['node:fs', 'fs/promises', '模块 os', '模块 path'],
      'apps/web/src/table.ts': ['prefers-reduced-transparency'],
      'website/style.css': ['prefers-reduced-motion'],
      'docs/charter.md': ['60 行', '第一性原理', '明确不做', '单向门决策备忘', '修宪记录'],
      'docs/handoff.md': ['180 行', '入口', '待验', 'v0.7.11', 'missing.md', 'draft.md'],
    })) {
      for (const reason of reasons) {
        assert.ok(
          broken.stderr
            .split(/\r?\n/)
            .some(
              (line) =>
                line.startsWith(path) &&
                line.includes(reason) &&
                line.includes('修复：') &&
                line.includes('重跑：npm run check:garden'),
            ),
          broken.stderr,
        );
      }
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
