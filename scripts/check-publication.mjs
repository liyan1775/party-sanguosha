import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args) =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16000000,
  });
assert.equal(
  await realpath(root),
  await realpath(git(['rev-parse', '--show-toplevel']).trim()),
  'Publication history checks require this project to be its own Git checkout; do not scan a parent repository from an extracted source archive.',
);
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const contracts = await readFile(resolve(root, 'packages/shared/src/contracts.ts'), 'utf8');
assert.equal(pkg.license, 'GPL-3.0-only', 'Project code license must be explicit');
assert.equal(lock.version, pkg.version, 'Lockfile version differs');
assert.equal(lock.packages[''].version, pkg.version, 'Lockfile root version differs');
assert.equal(lock.packages[''].license, pkg.license, 'Lockfile license differs');
assert.equal(
  contracts.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1],
  pkg.version,
  'App version differs',
);
assert.match(await readFile(resolve(root, 'LICENSE'), 'utf8'), /GNU GENERAL PUBLIC LICENSE/);
const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json')));
const assets = JSON.parse(await readFile(resolve(root, 'config/noname-lab-assets.json')));
assert.equal(candidate.tag, 'v1.11.6');
assert.match(candidate.commit, /^[a-f0-9]{40}$/);
assert.equal(assets.commit, candidate.commit);

// Only report paths and line numbers. Never echo a suspected credential, an
// original line, .env contents or local runtime/session data into CI logs.
const patterns = [
  ['private-key', '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'],
  ['github-token', '(github_pat_[a-zA-Z0-9_]{70,}|gh[pousr]_[A-Za-z0-9]{36,})'],
  ['api-key', 'sk-(proj-)?[A-Za-z0-9_-]{40,}'],
  [
    'embedded-session',
    '["\']?(controlToken|party_engine|party_console)["\']?[ \\t]*[:=][ \\t]*["\'][A-Za-z0-9_-]{24,}',
  ],
];
const forbidden = (path) =>
  /(^|\/)(\.local|\.runtime|node_modules|dist|test-results|playwright-report)(\/|$)/.test(path) ||
  (/(^|\/)\.env($|\.)/.test(path) && !path.endsWith('.env.example')) ||
  /\.(pfx|p12|pem)$/i.test(path);
const findings = [];
const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .split('\0')
  .filter(Boolean);
for (const path of files) {
  if (forbidden(path)) findings.push({ scope: 'working-tree', path, kind: 'private-file' });
  const bytes = await readFile(resolve(root, path)).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!bytes || bytes.includes(0)) continue;
  const lines = bytes.toString('utf8').split('\n');
  for (const [index, line] of lines.entries())
    for (const [kind, source] of patterns)
      if (new RegExp(source).test(line))
        findings.push({ scope: 'working-tree', path, line: index + 1, kind });
}

let commits = 0;
if (!process.argv.includes('--working-tree-only')) {
  const revisions = git(['rev-list', '--all']).trim().split('\n').filter(Boolean);
  for (const revision of revisions) {
    commits++;
    for (const path of git(['ls-tree', '-r', '--name-only', '-z', revision])
      .split('\0')
      .filter(Boolean))
      if (forbidden(path))
        findings.push({ scope: 'history', revision, path, kind: 'private-file' });
    const output = (() => {
      try {
        return git([
          'grep',
          '-I',
          '-l',
          '-E',
          patterns.map((entry) => `(${entry[1]})`).join('|'),
          revision,
        ]);
      } catch (error) {
        if (error.status === 1) return '';
        throw error;
      }
    })();
    for (const path of output.trim().split('\n').filter(Boolean))
      findings.push({
        scope: 'history',
        revision,
        path: path.slice(revision.length + 1),
        kind: 'credential-pattern',
      });
  }
}

const result = {
  at: new Date().toISOString(),
  version: pkg.version,
  files: files.length,
  commits,
  engine: { tag: candidate.tag, commit: candidate.commit },
  findings,
  limitations: [
    'Pattern checks cannot prove the absence of all credentials or personal information.',
    'Ignored local files are not read or included.',
    'Asset redistribution permission and real-device acceptance require separate evidence.',
  ],
};
await mkdir(resolve(root, '.runtime/release-readiness'), { recursive: true });
await writeFile(
  resolve(root, '.runtime/release-readiness/publication.json'),
  JSON.stringify(result, null, 2) + '\n',
);
if (findings.length) {
  for (const finding of findings) console.error(JSON.stringify(finding));
  throw new Error(`Publication review found ${findings.length} items requiring inspection.`);
}
console.log(
  `Source publication checks passed: ${pkg.version}, ${files.length} files, ${commits} historical revisions.`,
);
console.log('Asset permissions and real-device acceptance remain separate release requirements.');
