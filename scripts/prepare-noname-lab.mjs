import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'config/noname-lab-assets.json'), 'utf8'));
if (candidate.tag !== 'v1.11.6' || manifest.commit !== candidate.commit) {
  throw new Error('This lab supports the reviewed v1.11.6 candidate and manifest only.');
}
const engineRoot = resolve(root, '.local/noname', candidate.tag);
const archive = resolve(root, '.local/research/noname.core.zip');
let archiveBytes = await readFile(archive).catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (!archiveBytes) {
  const response = await fetch(candidate.coreArchive.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Core archive download failed (${response.status})`);
  archiveBytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(archiveBytes).digest('hex') !== candidate.coreArchive.sha256) {
    throw new Error('Downloaded core archive checksum mismatch');
  }
  await mkdir(dirname(archive), { recursive: true });
  const temporary = `${archive}.part`;
  try {
    await writeFile(temporary, archiveBytes);
    await rename(temporary, archive);
  } finally {
    await rm(temporary, { force: true });
  }
}
const digest = createHash('sha256').update(archiveBytes).digest('hex');
if (digest !== candidate.coreArchive.sha256 || manifest.commit !== candidate.commit) {
  throw new Error('Pinned archive or asset manifest mismatch');
}
const extracted = await readFile(resolve(engineRoot, 'noname.js')).catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (!extracted) {
  if (process.platform !== 'win32')
    throw new Error(`Extract the verified archive into ${engineRoot} first.`);
  // All paths are derived from this workspace and the fixed candidate. No move
  // or recursive cleanup, and no overwrite of an existing partial extraction.
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(engineRoot)}`,
    ],
    { stdio: 'inherit' },
  );
}

const build = JSON.parse(await readFile(resolve(engineRoot, 'game/build-info.json'), 'utf8'));
if (build.commit !== candidate.commit)
  throw new Error('Extracted core build does not match the pinned commit');

function blobHash(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

let next = 0;
let downloaded = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < manifest.assets.length) {
      const entry = manifest.assets[next++];
      // The committed manifest contains upstream-relative assets only.
      if (
        !/^(?:image\/(?:card|character|background)\/[^/]+\.(?:png|jpg)|audio\/(?:skill|die|effect|card\/(?:male|female))\/[\w.-]+\.mp3|LICENSE)$/.test(
          entry.path,
        )
      ) {
        throw new Error('Invalid asset manifest path');
      }
      const target = resolve(engineRoot, entry.path);
      const present = await readFile(target).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (present && present.length === entry.bytes && blobHash(present) === entry.gitBlobSha)
        continue;
      const url = `https://raw.githubusercontent.com/libnoname/noname/${manifest.commit}/apps/core/${entry.path}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok)
        throw new Error(`Asset download failed: ${entry.path} (${response.status})`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== entry.bytes || blobHash(bytes) !== entry.gitBlobSha) {
        throw new Error(`Asset checksum mismatch: ${entry.path}`);
      }
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.part`;
      try {
        await writeFile(temporary, bytes);
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
      downloaded++;
      if (downloaded % 40 === 0) console.log(`Prepared ${downloaded} engine lab assets`);
    }
  }),
);
await mkdir(resolve(root, 'packages/noname-adapter/licenses'), { recursive: true });
await writeFile(
  resolve(root, 'packages/noname-adapter/licenses/noname-GPL-3.0.txt'),
  await readFile(resolve(engineRoot, 'LICENSE')),
);
console.log(`Verified ${manifest.assets.length} pinned lab assets; downloaded ${downloaded}.`);
