// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';

// A standard ZIP with a deflated member, an unrequested stored member, and a
// second requested stored member. Only the central directory and one batch are needed.
const archive = Buffer.from(
  'UEsDBBQAAAAIAAAAIQBliCO7CgAAADwAAAABAAAAYUvLLCouSSOPAABQSwMEFAAAAAAAAAAhAH1VdvgEAAAABAAAAAUAAABleHRyYXNraXBQSwMEFAAAAAAAAAAhAGkRH7YGAAAABgAAAAEAAABic2Vjb25kUEsBAhQAFAAAAAgAAAAhAGWII7sKAAAAPAAAAAEAAAAAAAAAAAAAAIABAAAAAGFQSwECFAAUAAAAAAAAACEAfVV2+AQAAAAEAAAABQAAAAAAAAAAAAAAgAEpAAAAZXh0cmFQSwECFAAUAAAAAAAAACEAaREftgYAAAAGAAAAAQAAAAAAAAAAAAAAgAFQAAAAYlBLBQYAAAAAAwADAJEAAAB1AAAAAAA=',
  'base64',
);
const metadata = {
  apiUrl: 'https://example.invalid/release',
  bytes: archive.length,
  directoryOffset: 117,
  directoryBytes: 145,
  directorySha256: '1ce348fffececbbfbd27eb1a1fa765ce8618dd814c41ce3df951cb73b08bdabe',
};

test('固定发行包只提取缺少的条目，目录摘要不符时不落盘', async () => {
  const { downloadArchiveAssets } = await import(
    new URL('../scripts/download-noname-assets.mjs', import.meta.url).href
  );
  const requests: string[] = [];
  const readRange = async (_url: string, options: { headers: { Range: string } }) => {
    const header = options.headers.Range;
    requests.push(header);
    const match = /^bytes=(\d+)-(\d+)$/.exec(header)!;
    return new Response(archive.subarray(Number(match[1]), Number(match[2]) + 1), {
      status: 206,
      headers: { 'Content-Range': `bytes ${match[1]}-${match[2]}/${archive.length}` },
    });
  };
  const missing = new Map([
    ['a', { path: 'a', bytes: 60 }],
    ['b', { path: 'b', bytes: 6 }],
  ]);
  const written = new Map<string, string>();
  const save = (entry: { path: string }, payload: Buffer) =>
    written.set(entry.path, payload.toString());
  await downloadArchiveAssets(metadata, missing, save, readRange);
  assert.deepEqual(
    [...written],
    [
      ['a', 'first'.repeat(12)],
      ['b', 'second'],
    ],
  );
  assert.deepEqual(requests, ['bytes=117-261', 'bytes=0-116']);
  written.clear();
  await assert.rejects(
    downloadArchiveAssets(
      { ...metadata, directorySha256: '0'.repeat(64) },
      missing,
      save,
      readRange,
    ),
    /checksum/,
  );
  assert.equal(written.size, 0);
});
