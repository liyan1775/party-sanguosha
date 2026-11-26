import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const runtime = 'packages/noname-adapter/runtime';

async function fileHashes(root, names) {
  const hash = createHash('sha256');
  async function add(name) {
    const absolute = path.join(root, name);
    const entries = await readdir(absolute, { withFileTypes: true }).catch((error) => {
      if (error.code !== 'ENOTDIR') throw error;
      return null;
    });
    if (entries) {
      for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
        await add(`${name}/${entry.name}`);
      return;
    }
    const content = createHash('sha256')
      .update(await readFile(absolute))
      .digest('hex');
    hash.update(`${name}\0${content}\n`);
  }
  for (const name of names) await add(name);
  return hash.digest('hex');
}

export function sourceFingerprint(root) {
  return fileHashes(root, [
    'apps/server',
    'apps/web',
    'packages/shared/src',
    'packages/noname-adapter/src',
    runtime,
    'config',
    'package.json',
    'package-lock.json',
    'scripts/build.mjs',
    'scripts/build-manifest.mjs',
    'scripts/build-native-engine.mjs',
    'scripts/build-native-portraits.mjs',
    'scripts/client-art.mjs',
  ]);
}

const outputFolders = ['server', 'web', 'runtime'];
const defaultBuildDir = (root) => path.join(root, 'dist');

async function buildFolders(buildDir) {
  const entries = await readdir(buildDir, { withFileTypes: true });
  return entries.some((entry) => entry.name === 'engine' && entry.isDirectory())
    ? [...outputFolders, 'engine']
    : outputFolders;
}

async function identifyBuild(buildDir, sourceId) {
  const artifactId = await fileHashes(buildDir, await buildFolders(buildDir));
  return createHash('sha256').update(sourceId).update(artifactId).digest('hex');
}

export async function writeBuildManifest(root, sourceId, buildDir = defaultBuildDir(root)) {
  const buildId = await identifyBuild(buildDir, sourceId);
  const file = path.join(buildDir, 'build-manifest.json');
  const pending = `${file}.${process.pid}.tmp`;
  await writeFile(pending, JSON.stringify({ buildId, sourceId }) + '\n');
  await rename(pending, file);
}

export async function readBuildManifest(root, buildDir = defaultBuildDir(root)) {
  try {
    const manifest = JSON.parse(await readFile(path.join(buildDir, 'build-manifest.json'), 'utf8'));
    const valid = (id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
    if (valid(manifest?.buildId) && valid(manifest?.sourceId)) return manifest;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return null;
}

export async function verifyBuildManifest(root, buildDir = defaultBuildDir(root)) {
  const manifest = await readBuildManifest(root, buildDir);
  if (!manifest) return null;
  try {
    return (await identifyBuild(buildDir, manifest.sourceId)) === manifest.buildId
      ? manifest
      : null;
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    return null;
  }
}

/** Copy, never link: a tool replacing or rewriting dist cannot affect a live instance. */
export async function createBuildSnapshot(root, sourceDir = defaultBuildDir(root)) {
  const manifest = await readBuildManifest(root, sourceDir);
  if (!manifest) throw new Error('缺少构建清单，请重新构建或解压启动包。');
  const snapshots = path.join(root, '.runtime/builds');
  await mkdir(snapshots, { recursive: true });
  const buildDir = await mkdtemp(path.join(snapshots, 'snapshot-'));
  try {
    for (const directory of await buildFolders(sourceDir))
      await cp(path.join(sourceDir, directory), path.join(buildDir, directory), {
        recursive: true,
        dereference: true,
      });
    await writeFile(path.join(buildDir, 'build-manifest.json'), JSON.stringify(manifest) + '\n');
    if (!(await verifyBuildManifest(root, buildDir)))
      throw new Error('构建文件不完整或在复制期间已变动，请重新构建后启动。');
    return buildDir;
  } catch (error) {
    await rm(buildDir, { recursive: true, force: true });
    throw error;
  }
}
