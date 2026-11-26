import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, copyFile, cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildNativeEngine } from './build-native-engine.mjs';
import { buildNativePortraits } from './build-native-portraits.mjs';
import { clientArt } from './client-art.mjs';
import { sourceFingerprint, writeBuildManifest } from './build-manifest.mjs';
import { readRunningSession } from './launcher-upgrade.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const staged = args.length === 2 && args[0] === '--out-dir' && path.isAbsolute(args[1]);
if (args.length && !staged) throw new Error('Usage: build.mjs [--out-dir <absolute path>]');
const buildDir = staged ? path.resolve(args[1]) : path.join(root, 'dist');
if (staged) {
  const within = path.relative(path.join(root, '.runtime/builds'), buildDir);
  if (!within || within.startsWith('..') || path.isAbsolute(within))
    throw new Error('新的运行构建必须放在本项目 .runtime/builds 的独立目录。');
  await mkdir(buildDir, { recursive: true });
  if ((await readdir(buildDir)).length) throw new Error('新构建目录必须为空。');
  await cp(path.join(root, 'dist/engine/portraits'), path.join(buildDir, 'engine/portraits'), {
    recursive: true,
  }).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
} else {
  const running = await readRunningSession(path.join(root, '.runtime/session.json'));
  if (running && !running.buildDir)
    throw new Error('旧服务仍在使用共享构建。请结束房间活动并双击停止，再运行构建。');
}
const sourceId = await sourceFingerprint(root);
const runtimeSource = path.join(root, 'packages/noname-adapter/runtime');
const runtimeOutput = path.join(buildDir, 'runtime');
if (!staged) await rm(runtimeOutput, { recursive: true, force: true });
await mkdir(runtimeOutput, { recursive: true });
for (const entry of await readdir(runtimeSource, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.css')) {
    const { code } = await transform(await readFile(path.join(runtimeSource, entry.name), 'utf8'), {
      loader: 'css',
      minify: true,
      target: ['chrome91', 'safari16.4'],
    });
    await writeFile(path.join(runtimeOutput, entry.name), code);
  } else if (entry.name === 'assets' || (entry.isFile() && /\.(?:html|js|css)$/.test(entry.name)))
    await cp(path.join(runtimeSource, entry.name), path.join(runtimeOutput, entry.name), {
      recursive: entry.isDirectory(),
      dereference: true,
    });
}
await buildNativeEngine(root, buildDir);
await buildNativePortraits(root, buildDir);
const output = path.join(buildDir, 'web');
await mkdir(output, { recursive: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
const fingerprints = {};
async function fingerprint(name, file = name) {
  const bytes = await readFile(path.join(output, file));
  fingerprints[`/assets/${name}`] = createHash('sha256').update(bytes).digest('hex');
}
const versioned = (content) =>
  content.replace(/\/assets\/[\w./-]+/g, (url) =>
    fingerprints[url] ? `${url}?v=${fingerprints[url]}` : url,
  );
const portable = await readFile(path.join(root, 'portable.json')).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
for (const name of clientArt) {
  const destination = path.join(output, 'assets', name);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, 'apps/web/src/assets', name), destination).catch((error) => {
    if (!portable || error.code !== 'ENOENT') throw error;
  });
  await fingerprint(name, `assets/${name}`);
}
for (const name of ['zibai-day.webp', 'zibai-night.webp']) {
  await copyFile(path.join(root, 'apps/web/assets', name), path.join(output, 'assets', name));
  await fingerprint(name, `assets/${name}`);
}
for (const name of ['pass', 'encounter', 'market', 'camp']) {
  await copyFile(
    path.join(root, `apps/web/assets/shanhetu/${name}.webp`),
    path.join(output, `shanhetu-${name}.webp`),
  );
  await fingerprint(`shanhetu-${name}.webp`);
}
await build({
  entryPoints: [path.join(root, 'apps/web/src/zibai-v1.css')],
  outfile: path.join(output, 'style.css'),
  bundle: true,
  minify: true,
  target: ['chrome91', 'safari16.4'],
  external: ['/assets/shanhetu/*', '/assets/shanhetu-*.webp', '/assets/zibai-*.webp'],
});
await writeFile(
  path.join(output, 'style.css'),
  versioned(await readFile(path.join(output, 'style.css'), 'utf8')),
);
await build({
  entryPoints: [path.join(root, 'apps/web/src/table-client.ts')],
  outfile: path.join(output, 'table.js'),
  bundle: true,
  format: 'esm',
  target: ['chrome91', 'safari16.4'],
  minify: true,
});
await build({
  entryPoints: [path.join(root, 'apps/web/src/table.css')],
  outfile: path.join(output, 'table.css'),
  minify: true,
  target: ['chrome91', 'safari16.4'],
});
await copyFile(path.join(root, 'config/general-catalog.json'), path.join(output, 'generals.json'));
await fingerprint('generals.json');
const catalog = JSON.parse(await readFile(path.join(output, 'generals.json'), 'utf8'));
const portraits = await readFile(path.join(buildDir, 'engine/portraits/manifest.json'), 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
const presets = JSON.parse(
  await readFile(path.join(root, 'config/roster-presets.json'), 'utf8'),
).presets;
for (const preset of presets) {
  await writeFile(
    path.join(output, `generals-${preset.id}.json`),
    JSON.stringify({
      source: catalog.source,
      characters: catalog.characters
        .filter((entry) => entry.preset === preset.id)
        .map((entry) => {
          const file = portraits?.characters[entry.id];
          const version = portraits?.files[file]?.sha256;
          return file && version
            ? { ...entry, draftPortrait: '/engine/portraits/' + version + '/' + file }
            : entry;
        }),
    }),
  );
  await fingerprint(`generals-${preset.id}.json`);
}
// Removed pools must not survive in a shared dist and become starter assets.
const currentCatalogs = new Set(presets.map(({ id }) => 'generals-' + id + '.json'));
for (const name of await readdir(output)) {
  if (/^generals-[a-z0-9-]+.json$/.test(name) && !currentCatalogs.has(name))
    await rm(path.join(output, name), { force: true });
}
await build({
  entryPoints: [path.join(root, 'apps/web/src/main.ts')],
  outfile: path.join(output, 'app.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['chrome91', 'safari16.4'],
  define: { __PARTY_STATIC_FINGERPRINTS__: JSON.stringify(fingerprints) },
});
for (const name of ['app.js', 'style.css', 'table.js', 'table.css']) await fingerprint(name);
for (const name of ['index.html', 'table.html']) {
  const html = await readFile(path.join(root, 'apps/web', name), 'utf8');
  await writeFile(path.join(output, name), versioned(html));
}
const serverBuild = await build({
  entryPoints: [path.join(root, 'apps/server/src/main.ts')],
  outfile: path.join(buildDir, 'server/main.js'),
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
if (!staged) await mkdir(path.join(root, '.runtime'), { recursive: true });
if (!staged)
  await writeFile(
    path.join(root, '.runtime/server-build-meta.json'),
    JSON.stringify(serverBuild.metafile),
  );
if ((await sourceFingerprint(root)) !== sourceId)
  throw new Error('构建过程中源文件有变化，请重新运行构建。');
await writeBuildManifest(root, sourceId, buildDir);
console.log('扫码房间页面已构建。');
