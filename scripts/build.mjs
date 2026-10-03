import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/web');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [path.join(root, 'apps/web/src/main.ts')],
  outfile: path.join(output, 'app.js'),
  bundle: true,
  format: 'esm',
  target: ['chrome91', 'safari16.4'],
  sourcemap: false,
});
await copyFile(path.join(root, 'apps/web/index.html'), path.join(output, 'index.html'));
await copyFile(path.join(root, 'apps/web/src/style.css'), path.join(output, 'style.css'));
console.log('扫码房间页面已构建。');
