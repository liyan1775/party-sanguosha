import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildNativeEngine } from './build-native-engine.mjs';
import { buildNativePortraits } from './build-native-portraits.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await buildNativeEngine(root);
await buildNativePortraits(root);
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
await copyFile(path.join(root, 'config/general-catalog.json'), path.join(output, 'generals.json'));
const serverBuild = await build({
  entryPoints: [path.join(root, 'apps/server/src/main.ts')],
  outfile: path.join(root, 'dist/server/main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node24'],
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire as partyCreateRequire } from 'node:module'; const require = partyCreateRequire(import.meta.url);",
  },
  metafile: true,
});
await mkdir(path.join(root, '.runtime'), { recursive: true });
await writeFile(
  path.join(root, '.runtime/server-build-meta.json'),
  JSON.stringify(serverBuild.metafile),
);
console.log('扫码房间页面已构建。');
