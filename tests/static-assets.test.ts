import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { get, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createPartyServer } from '../apps/server/src/server.js';

test('HTTP static: real fingerprint, encoded bytes, conditional requests and private no-store', async () => {
  const webRoot = await mkdtemp(join(tmpdir(), 'party-web-cache-'));
  const content = Buffer.from('export const title = "party";\n'.repeat(200));
  const version = createHash('sha256').update(content).digest('hex');
  const asset = `/assets/app.js?v=${version}`;
  await writeFile(join(webRoot, 'app.js'), content);
  await writeFile(join(webRoot, 'index.html'), `<script type="module" src="${asset}"></script>`);
  const party = createPartyServer({ port: 0, webRoot });
  try {
    party.server.listen(0, '127.0.0.1');
    await once(party.server, 'listening');
    const port = (party.server.address() as AddressInfo).port;
    function request(path: string, headers?: OutgoingHttpHeaders) {
      return new Promise<{ status: number; headers: IncomingHttpHeaders; bytes: Buffer }>(
        (resolve, reject) => {
          get({ host: '127.0.0.1', port, path, headers }, async (response) => {
            try {
              const chunks: Buffer[] = [];
              for await (const chunk of response) chunks.push(chunk);
              resolve({
                status: response.statusCode!,
                headers: response.headers,
                bytes: Buffer.concat(chunks),
              });
            } catch (error) {
              reject(error);
            }
          }).once('error', reject);
        },
      );
    }
    const plain = await request(asset);
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.deepEqual(plain.bytes, content);
    assert.match(plain.headers['cache-control']!, /max-age=31536000, immutable/);
    for (const [accept, encoding, decode] of [
      ['gzip, br', 'br', brotliDecompressSync],
      ['br;q=0.1, gzip;q=0.9', 'gzip', gunzipSync],
    ] as const) {
      const zipped = await request(asset, { 'Accept-Encoding': accept });
      assert.equal(zipped.headers['content-encoding'], encoding);
      assert.equal(zipped.headers.vary, 'Accept-Encoding');
      assert.deepEqual(decode(zipped.bytes), content);
      assert(zipped.bytes.length < plain.bytes.length);
      const unchanged = await request(asset, {
        'Accept-Encoding': accept,
        'If-None-Match': zipped.headers.etag!.slice(2),
      });
      assert.equal(unchanged.status, 304);
      assert.equal(unchanged.headers.vary, 'Accept-Encoding');
      assert.equal(unchanged.headers.etag, plain.headers.etag);
      assert.equal(unchanged.bytes.length, 0);
    }
    for (const path of [
      '/assets/app.js',
      `/assets/app.js?v=${'0'.repeat(64)}`,
      '/',
      '/join/ABCDEF',
    ]) {
      const response = await request(path);
      assert.equal(response.headers['cache-control'], 'no-cache');
      assert.equal((await request(path, { 'If-None-Match': response.headers.etag! })).status, 304);
    }
    for (const path of ['/server', '/api/me', '/api/rooms', '/api/console']) {
      const response = await request(path);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
  } finally {
    party.stop();
    await rm(webRoot, { force: true, recursive: true });
  }
});
