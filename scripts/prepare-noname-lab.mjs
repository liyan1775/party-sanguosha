import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { downloadArchiveAssets } from './download-noname-assets.mjs';
import { prepareShanhetuPortraits } from './prepare-shanhetu-portraits.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidate = JSON.parse(await readFile(resolve(root, 'config/noname-candidate.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'config/noname-lab-assets.json'), 'utf8'));
if (candidate.tag !== 'v1.11.6' || manifest.commit !== candidate.commit) {
  throw new Error('This lab supports the reviewed v1.11.6 candidate and manifest only.');
}
const engineRoot = resolve(root, '.local/noname', candidate.tag);
const archive = resolve(root, '.local/research/noname.core.zip');
const coreArchive = candidate.coreArchive;
async function downloadCore(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Core archive download failed (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== coreArchive.sha256)
    throw new Error('Downloaded core archive checksum mismatch');
  return bytes;
}
let archiveBytes = await readFile(archive).catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (!archiveBytes) {
  console.log('首次准备：正在从无名杀上游下载固定核心包（约 38 MiB）……');
  archiveBytes = await downloadCore(coreArchive.url).catch(async (directError) => {
    console.log('发布页下载未完成，正在通过 GitHub 官方 API 重试……');
    try {
      return await downloadCore(coreArchive.apiUrl, {
        Accept: 'application/octet-stream',
        'X-GitHub-Api-Version': '2026-03-10',
      });
    } catch (apiError) {
      throw new AggregateError([directError, apiError], 'Cannot download pinned core archive');
    }
  });
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
if (digest !== coreArchive.sha256 || manifest.commit !== candidate.commit) {
  throw new Error('Pinned archive or asset manifest mismatch');
}
if (process.platform === 'win32') {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(root, 'scripts/restore-noname-core.ps1'),
      '-Archive',
      archive,
      '-Destination',
      engineRoot,
    ],
    { stdio: 'inherit', windowsHide: true },
  );
} else {
  await readFile(resolve(engineRoot, 'noname.js')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Extract the verified archive into ${engineRoot} first.`);
  });
}

const build = JSON.parse(await readFile(resolve(engineRoot, 'game/build-info.json'), 'utf8'));
if (build.commit !== candidate.commit)
  throw new Error('Extracted core build does not match the pinned commit');

function blobHash(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

async function downloadAsset(url, path) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500)
          throw new Error(`Asset download rejected: ${path} (${response.status})`);
        throw new TypeError(`Asset download interrupted: ${path} (${response.status})`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 2 || !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name))
        throw new Error(`Cannot download pinned asset ${path}`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

let downloaded = 0;
let verified = 0;
let checkedBytes = 0;
const totalBytes = manifest.assets.reduce((sum, entry) => sum + entry.bytes, 0);
console.log(
  `正在校验并补齐 ${manifest.assets.length} 个固定资源（约 ${Math.ceil(totalBytes / 1048576)} MiB）；已完成的文件会保留。`,
);
const progress = () => {
  verified++;
  if (verified % 80 === 0 || verified === manifest.assets.length)
    console.log(
      `资源 ${verified}/${manifest.assets.length} · ${Math.floor(checkedBytes / 1048576)}/${Math.ceil(totalBytes / 1048576)} MiB · 本次下载 ${downloaded} 个`,
    );
};
const missing = new Map();
for (const entry of manifest.assets) {
  if (
    !/^(?:image\/(?:card|character|background)\/[\p{L}\p{N}_.-]+\.(?:png|jpg)|audio\/(?:skill|die|effect|card\/(?:male|female))\/[\p{L}\p{N}_.-]+\.mp3|LICENSE)$/u.test(
      entry.path,
    )
  )
    throw new Error('Invalid asset manifest path');
  const present = await readFile(resolve(engineRoot, entry.path)).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (present && present.length === entry.bytes && blobHash(present) === entry.gitBlobSha) {
    checkedBytes += entry.bytes;
    progress();
  } else missing.set(entry.path, entry);
}
async function save(entry, bytes) {
  if (bytes.length !== entry.bytes || blobHash(bytes) !== entry.gitBlobSha)
    throw new Error(`Asset checksum mismatch: ${entry.path}`);
  const target = resolve(engineRoot, entry.path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.part`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  missing.delete(entry.path);
  downloaded++;
  checkedBytes += entry.bytes;
  progress();
}
if (missing.size) {
  console.log(`正在从无名杀官方发行包分批补齐 ${missing.size} 个资源……`);
  try {
    await downloadArchiveAssets(candidate.assetArchive, missing, save);
  } catch (error) {
    console.warn(
      `发行包分段下载未完成（${error.message}），剩余 ${missing.size} 个资源将改从固定上游文件下载。`,
    );
    const remaining = [...missing.values()].values();
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (const entry of remaining) {
          const url = `https://raw.githubusercontent.com/libnoname/noname/${manifest.commit}/apps/core/${entry.path}`;
          await save(entry, await downloadAsset(url, entry.path));
        }
      }),
    );
  }
}
await mkdir(resolve(root, 'packages/noname-adapter/licenses'), { recursive: true });
await writeFile(
  resolve(root, 'packages/noname-adapter/licenses/noname-GPL-3.0.txt'),
  await readFile(resolve(engineRoot, 'LICENSE')),
);
console.log(`Verified ${manifest.assets.length} pinned lab assets; downloaded ${downloaded}.`);
try {
  await prepareShanhetuPortraits(engineRoot, downloadAsset);
} catch (error) {
  console.warn(
    '山河图立绘尚未备齐。请在电脑能访问 web.sanguosha.com 时重新启动以补齐。其他玩法可照常使用。',
    error.message,
  );
}
