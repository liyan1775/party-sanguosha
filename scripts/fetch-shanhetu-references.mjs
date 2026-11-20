// SPDX-License-Identifier: GPL-3.0-only
// Research snapshots only. Nothing fetched here is executed or served to a room.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const research = JSON.parse(
  await readFile(resolve(root, 'config/research/ol-shanhetu-2026-11.json'), 'utf8'),
);
const folder = resolve(root, process.argv[2] ?? '.local/research/shanhetu-20261107');
const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(folder, { recursive: true });
for (const source of research.referenceSnapshot.files) {
  if (
    !/^[a-z-]+$/.test(source.dataset) ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isSafeInteger(source.bytes) ||
    source.bytes <= 0 ||
    source.bytes > 8 * 1024 * 1024 ||
    source.url !== `https://s.xiaochao.org/data/${source.dataset}.json`
  )
    throw new Error('Invalid frozen research reference');
  const filename = `xiaochao-${source.dataset}.json`;
  const destination = resolve(folder, filename);
  let cached;
  try {
    cached = await readFile(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (cached) {
    if (cached.length !== source.bytes || checksum(cached) !== source.sha256)
      throw new Error(`${filename}: cached snapshot differs; preserve it before investigating`);
    console.log(`${filename}: verified cache`);
    continue;
  }
  const response = await fetch(source.url, {
    signal: AbortSignal.timeout(60000),
    redirect: 'error',
  });
  if (!response.ok || !response.body)
    throw new Error(`${filename}: download returned HTTP ${response.status}`);
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > source.bytes)
      throw new Error(`${filename}: upstream snapshot is larger than the frozen version`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== source.bytes || checksum(bytes) !== source.sha256)
    throw new Error(`${filename}: upstream changed; the frozen research version was not replaced`);
  JSON.parse(bytes.toString('utf8'));
  await writeFile(destination, bytes, { flag: 'wx' });
  console.log(`${filename}: downloaded and verified ${bytes.length} bytes`);
}
