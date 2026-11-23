import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
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
await mkdir(path.join(output, 'assets'), { recursive: true });
for (const name of ['zibai-day.webp', 'zibai-night.webp'])
  await copyFile(path.join(root, 'apps/web/assets', name), path.join(output, 'assets', name));
for (const name of ['pass', 'encounter', 'market', 'camp']) {
  await copyFile(
    path.join(root, `apps/web/assets/shanhetu/${name}.webp`),
    path.join(output, `shanhetu-${name}.webp`),
  );
}
await build({
  entryPoints: [path.join(root, 'apps/web/src/zibai-v1.css')],
  outfile: path.join(output, 'style.css'),
  bundle: true,
  target: ['chrome91', 'safari16.4'],
  external: ['/assets/shanhetu-*.webp', '/assets/zibai-*.webp'],
});
await build({
  entryPoints: [path.join(root, 'apps/web/src/table-client.ts')],
  outfile: path.join(output, 'table.js'),
  bundle: true,
  format: 'esm',
  target: ['chrome91', 'safari16.4'],
  minify: true,
});
await copyFile(path.join(root, 'apps/web/table.html'), path.join(output, 'table.html'));
await build({
  entryPoints: [path.join(root, 'apps/web/src/table.css')],
  outfile: path.join(output, 'table.css'),
  minify: true,
  target: ['chrome91', 'safari16.4'],
});
await copyFile(path.join(root, 'config/general-catalog.json'), path.join(output, 'generals.json'));
const catalog = JSON.parse(await readFile(path.join(output, 'generals.json'), 'utf8'));
const presets = JSON.parse(
  await readFile(path.join(root, 'config/roster-presets.json'), 'utf8'),
).presets;
for (const preset of presets) {
  await writeFile(
    path.join(output, `generals-${preset.id}.json`),
    JSON.stringify({
      source: catalog.source,
      characters: catalog.characters.filter((entry) => entry.preset === preset.id),
    }),
  );
}
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
