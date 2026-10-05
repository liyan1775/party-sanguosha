import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

/** Bundle the pinned browser singleton; dynamic packs still use the import map. */
export async function buildNativeEngine(root) {
  const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
  const engine = resolve(root, `.local/noname/${candidate.tag}`);
  const info = await readFile(resolve(engine, 'game/build-info.json')).catch(() => null);
  if (!info) return; // Lobby-only checkouts still build with an unconfigured engine.
  if (JSON.parse(info).commit !== candidate.commit) throw new Error('Pinned engine mismatch');
  const output = resolve(root, 'dist/engine');
  const coreBase = '(globalThis.partyAssetBase ?? "/engine/core/")';
  await mkdir(output, { recursive: true });
  const result = await build({
    stdin: {
      contents: `export * from './noname.js'; export { default as browserReady } from './noname/init/browser.js'; export { boot } from './noname/init/index.js'; export { device } from './noname/util/index.js'; export { loadBuildInfo } from './noname/util/meta.js';`,
      resolveDir: engine,
      sourcefile: 'party-browser-entry.js',
    },
    outfile: resolve(output, 'noname.js'),
    bundle: true,
    format: 'esm',
    external: ['os'],
    target: ['chrome91', 'safari16.4'],
    // Native broadcasts stringify functions and refer to game/lib/get by name.
    // Preserve identifiers; only compress whitespace and safe syntax.
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
    legalComments: 'eof',
    banner: {
      js: `// libnoname/noname ${candidate.tag}, commit ${candidate.commit}\n// SPDX-License-Identifier: GPL-3.0-only; upstream sources and licenses are retained in .local/noname.`,
    },
    write: false,
    metafile: true,
    plugins: [
      {
        name: 'party-pinned-browser',
        setup(plugin) {
          plugin.onResolve({ filter: /^(noname|vue|pinyin-pro|dedent)$/ }, ({ path }) => ({
            path: resolve(
              engine,
              {
                noname: 'noname.js',
                vue: 'node_modules/.pnpm/vue@3.5.28/node_modules/vue/dist/vue.esm-browser.js',
                'pinyin-pro':
                  'node_modules/.pnpm/pinyin-pro@3.28.0/node_modules/pinyin-pro/dist/index.js',
                dedent: 'node_modules/.pnpm/dedent@1.7.1/node_modules/dedent/dist/dedent.js',
              }[path],
            ),
          }));
          plugin.onLoad({ filter: /preload-helper\.js$/ }, () => ({
            // Vite's original dependency list names hundreds of separate files.
            contents: 'export function __vitePreload(load) { return load(); }',
            loader: 'js',
          }));
          plugin.onLoad({ filter: /\.js$/ }, async ({ path }) => {
            const name = relative(engine, path).replaceAll('\\', '/');
            if (name.startsWith('../')) return;
            let contents = await readFile(path, 'utf8');
            // URL-derived sandbox/asset paths must retain their source directory.
            contents = contents.replaceAll(
              'import.meta.url',
              `new URL(${coreBase} + ${JSON.stringify(name)}, location.origin).href`,
            );
            if (name === 'noname.js') contents = contents.replace('"./",', `${coreBase},`);
            if (name === 'noname/init/import.js')
              contents = contents
                .replaceAll('`/card/', '`${globalThis.partyAssetBase ?? "/engine/core/"}card/')
                .replaceAll(
                  '`/character/',
                  '`${globalThis.partyAssetBase ?? "/engine/core/"}character/',
                )
                .replaceAll('`/mode/', '`/engine/modes/');
            if (name === 'noname/init/browser.js')
              contents = contents.replaceAll('requestBackend("/', 'requestBackend("/engine/fs/');
            if (name === 'noname/init/index.js')
              contents = contents.replace(
                "fontSheet.insertRule(`@font-face {font-family: 'MotoyaLMaru'; src: url('${lib.assetURL}font/motoyamaru.woff2');}`, 0);",
                '',
              );
            return { contents, loader: 'js' };
          });
        },
      },
    ],
  });
  const bytes = result.outputFiles[0].contents;
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(resolve(output, 'noname.js'), bytes);
  await writeFile(
    resolve(output, 'manifest.json'),
    JSON.stringify({
      commit: candidate.commit,
      hash,
      bytes: bytes.length,
      modules: Object.keys(result.metafile.inputs).length,
    }),
  );
  console.log(`原生引擎合并为 1 个模块 (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)。`);
}
