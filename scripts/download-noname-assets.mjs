// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

// Offsets come exclusively from the pinned upstream release directory. Each
// extracted file must also match its length and Git blob hash in the manifest.
function batches(directory, archive, missing) {
  const entries = [];
  for (let position = 0; position < directory.length;) {
    if (directory.readUInt32LE(position) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const nameSize = directory.readUInt16LE(position + 28);
    const name = directory.toString('utf8', position + 46, position + 46 + nameSize);
    entries.push({
      name,
      offset: directory.readUInt32LE(position + 42),
      size: directory.readUInt32LE(position + 20),
      bytes: directory.readUInt32LE(position + 24),
      method: directory.readUInt16LE(position + 10),
    });
    position +=
      46 + nameSize + directory.readUInt16LE(position + 30) + directory.readUInt16LE(position + 32);
  }
  entries.sort((left, right) => left.offset - right.offset);
  const result = [];
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const asset = missing.get(entry.name);
    if (!asset) continue;
    if (entry.bytes !== asset.bytes || ![0, 8].includes(entry.method) || seen.has(entry.name))
      throw new Error('Release entry does not match the pinned manifest');
    seen.add(entry.name);
    const end = entries[index + 1]?.offset ?? archive.directoryOffset;
    if (end < entry.offset + 30 + entry.size || end > archive.directoryOffset)
      throw new Error('Invalid ZIP entry extent');
    const last = result.at(-1);
    if (last && entry.offset - last.end <= 393216 && end - last.start <= 8 * 1048576) {
      last.end = end;
      last.entries.push(entry);
    } else {
      result.push({ start: entry.offset, end, entries: [entry] });
    }
  }
  if (seen.size !== missing.size) throw new Error('Pinned release is missing requested assets');
  return result;
}

/** Fetch public release ranges. The signed redirect is only kept in memory. */
export async function downloadArchiveAssets(archive, missing, save, fetchRange = fetch) {
  let directUrl = archive.apiUrl;
  async function range(start, end) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetchRange(directUrl, {
          headers: { Accept: 'application/octet-stream', Range: `bytes=${start}-${end - 1}` },
          signal: AbortSignal.timeout(90000),
        });
        if (
          response.status !== 206 ||
          response.headers.get('content-range') !== `bytes ${start}-${end - 1}/${archive.bytes}`
        ) {
          await response.body?.cancel();
          throw new Error(`Archive range unavailable (HTTP ${response.status})`);
        }
        const payload = Buffer.from(await response.arrayBuffer());
        if (payload.length !== end - start) throw new Error('Incomplete release range');
        if (response.url) directUrl = response.url;
        return payload;
      } catch (error) {
        if (attempt >= 2) throw error;
        directUrl = archive.apiUrl;
        await delay(500 * 2 ** attempt);
      }
    }
  }
  const directory = await range(
    archive.directoryOffset,
    archive.directoryOffset + archive.directoryBytes,
  );
  if (createHash('sha256').update(directory).digest('hex') !== archive.directorySha256)
    throw new Error('Release directory checksum mismatch');
  const parts = batches(directory, archive, missing);
  let next = 0;
  let failure;
  async function worker() {
    try {
      while (!failure && next < parts.length) {
        const part = parts[next++];
        const payload = await range(part.start, part.end);
        for (const entry of part.entries) {
          const position = entry.offset - part.start;
          if (
            payload.readUInt32LE(position) !== 0x04034b50 ||
            payload.readUInt16LE(position + 8) !== entry.method
          )
            throw new Error('Invalid ZIP member');
          const nameEnd = position + 30 + payload.readUInt16LE(position + 26);
          const dataStart = nameEnd + payload.readUInt16LE(position + 28);
          if (
            payload.toString('utf8', position + 30, nameEnd) !== entry.name ||
            dataStart + entry.size > payload.length
          )
            throw new Error('Unexpected ZIP member bounds');
          const compressed = payload.subarray(dataStart, dataStart + entry.size);
          const bytes =
            entry.method === 0
              ? compressed
              : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.bytes) });
          await save(missing.get(entry.name), bytes);
        }
      }
    } catch (error) {
      failure ??= error;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, parts.length) }, worker));
  if (failure) throw failure;
}
