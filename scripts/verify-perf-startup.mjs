import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, readFile, realpath, rename, unlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeNonameService } from '../packages/noname-adapter/src/service.ts';
import { proofFile } from '../packages/noname-adapter/src/resource-proof.mjs';
import { createBuildSnapshot } from './build-manifest.mjs';
import { buildNativePortraits } from './build-native-portraits.mjs';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
assert(process.platform === 'win32' && process.argv.includes('--isolated'));
assert.equal(await readFile(join(root, '.runtime/perf-isolation'), 'utf8'), 'disposable copy');
assert.notEqual(root, parse(root).root);
const portable = JSON.parse(await readFile(join(root, 'portable.json'), 'utf8'));
assert.equal(portable.resources, 'download-pinned-upstream');
const manifest = JSON.parse(await readFile(join(root, 'config/noname-lab-assets.json'), 'utf8'));
const token = randomBytes(32).toString('hex');
const buildDir = await createBuildSnapshot(root);
const env = {
  ...process.env,
  PARTY_PROJECT_ROOT: root,
  PARTY_BUILD_DIR: buildDir,
  PARTY_STARTUP_PROOF: token,
  PARTY_NETWORK: 'lan',
  PARTY_AUTO_PORT: '1',
  PORT: '29876',
};
const engineRoot = join(root, '.local/noname/v1.11.6');
const target = resolve(engineRoot, manifest.assets.find(({ path }) => path.endsWith('.jpg')).path);
async function assertPrivateCopy(file) {
  assert.equal(await realpath(file), file);
  assert(file.startsWith(root + sep));
  const info = await lstat(file);
  assert(info.isFile() && info.nlink === 1);
  return info;
}
const targetInfo = await assertPrivateCopy(target);
const original = await readFile(target);
const fixedTime = new Date('2024-10-01T00:00:00Z');

function measure(label, proof) {
  const start = performance.now();
  const adapter = new NativeNonameService(root, proof, buildDir);
  const observation = {
    ready: adapter.status().preload,
    reused: adapter.startupAssetsReused,
    ms: Math.round(performance.now() - start),
  };
  console.log(label, observation);
  return observation;
}

function assertFailsBeforeListen(label) {
  const runner = spawnSync(process.execPath, [join(buildDir, 'server/main.js')], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 25_000,
  });
  assert.ifError(runner.error);
  assert.equal(runner.status, 1, runner.stdout + runner.stderr);
  assert.match(runner.stderr, /启动准备后发现固定游戏资源缺失或损坏/);
  assert.match(runner.stdout, /逐文件全量校验/);
  console.log(`${label}: service exited before listening`);
}

try {
  await utimes(target, fixedTime, fixedTime);
  const started = performance.now();
  const preparation = spawnSync(process.execPath, ['scripts/prepare-portable.mjs'], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 180_000,
  });
  assert.ifError(preparation.error);
  assert.equal(preparation.status, 0);
  console.log('portable-preparation-ms', Math.round(performance.now() - started));
  const shared = measure('same-start metadata', token);
  assert(shared.ready && shared.reused);

  const bundle = join(buildDir, 'engine/noname.js');
  await assertPrivateCopy(bundle);
  const bundleBytes = await readFile(bundle);
  const changedBundle = Buffer.from(bundleBytes);
  changedBundle[0] ^= 0xff;
  try {
    await writeFile(bundle, changedBundle);
    const invalidBundle = measure('independent bundle verification', token);
    assert(!invalidBundle.ready && invalidBundle.reused);
  } finally {
    await writeFile(bundle, bundleBytes);
  }

  const moved = join(dirname(target), 'perf-test-missing-asset.backup');
  await rename(target, moved);
  try {
    assertFailsBeforeListen('deleted original');
  } finally {
    await rename(moved, target);
  }

  const corrupt = Buffer.from(original);
  corrupt[0] ^= 0xff;
  await writeFile(target, corrupt);
  await utimes(target, fixedTime, fixedTime);
  assert.equal((await lstat(target)).mtimeMs, fixedTime.getTime());
  assert.equal((await lstat(target)).size, original.length);
  assertFailsBeforeListen('equal-length corruption with restored mtime');
  await writeFile(target, original);
  const stale = measure('same token after asset rewrite', token);
  assert(stale.ready && !stale.reused);
  const wrong = measure('different startup token', randomBytes(32).toString('hex'));
  assert(wrong.ready && !wrong.reused);
} finally {
  await writeFile(target, original);
  await utimes(target, targetInfo.atime, targetInfo.mtime);
  await unlink(join(root, proofFile)).catch(() => {});
}

const portraitRoot = join(buildDir, 'engine/portraits');
const portraitManifest = join(portraitRoot, 'manifest.json');
const initial = await readFile(portraitManifest, 'utf8');
const portraits = JSON.parse(initial);
const [broken, missing, changedParameter] = Object.keys(portraits.files);
for (const name of [broken, missing, changedParameter])
  await assertPrivateCopy(join(portraitRoot, name));
const portrait = join(portraitRoot, broken);
const initialPortrait = await readFile(portrait);
const missingPortrait = join(portraitRoot, missing);
const initialMissing = await readFile(missingPortrait);
const brokenPortrait = Buffer.from(initialPortrait);
brokenPortrait[0] ^= 0xff;
try {
  for (let run = 0; run < 2; run++) {
    const started = performance.now();
    assert.deepEqual(await buildNativePortraits(root, buildDir), { reused: 678, encoded: 0 });
    console.log('warm-portraits-ms', Math.round(performance.now() - started));
  }
  await writeFile(portrait, brokenPortrait);
  await unlink(missingPortrait);
  portraits.files[changedParameter].encoding = 'old-encoder';
  await writeFile(portraitManifest, JSON.stringify(portraits));
  assert.deepEqual(await buildNativePortraits(root, buildDir), { reused: 675, encoded: 3 });
  assert.deepEqual(await readFile(portrait), initialPortrait);
  assert.deepEqual(await readFile(missingPortrait), initialMissing);
  assert.equal(await readFile(portraitManifest, 'utf8'), initial);
  console.log('portrait repair: corrupt, missing, and stale encoder entries rebuilt');
} finally {
  await writeFile(portrait, initialPortrait);
  await writeFile(missingPortrait, initialMissing);
  await writeFile(portraitManifest, initial);
}
