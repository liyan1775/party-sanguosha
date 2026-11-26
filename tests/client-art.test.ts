import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createPartyServer } from '../apps/server/src/server.js';
import { cityScene } from '../apps/web/src/shanhetu-art.js';
import { NativeNonameService } from '../packages/noname-adapter/src/service.js';
import { clientArt } from '../scripts/client-art.mjs';
import art from '../config/client-art.json' with { type: 'json' };
import scenario from '../config/shanhetu-scenario.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));

test('诸侯伐董十四城沿正式路线分配八幅画卷', () => {
  const regions = new Map(scenario.regions.map(({ id, next }) => [id, next]));
  assert.equal(regions.size, 14);
  assert.deepEqual(
    Object.keys(art.cityScenes).map(Number),
    [...regions.keys()].sort((a, b) => a - b),
  );
  const picture = (id: number) => cityScene(`region-${id}`);
  assert.equal(new Set([...regions.keys()].map(picture)).size, 8);
  assert.equal(picture(4), 'hulao');
  assert.equal(picture(10), 'luoyang');
  assert.notEqual(picture(scenario.initialRegions[0]!), picture(scenario.initialRegions[1]!));
  for (const [id, route] of regions)
    for (const next of route) assert.notEqual(picture(id), picture(next), `${id} → ${next}`);
});

test('美术白名单只公开 15 个指纹静态图和 10 个运行时道具、牌桌', async () => {
  const webRoot = await mkdtemp(join(tmpdir(), 'party-client-art-'));
  const party = createPartyServer({
    port: 0,
    webRoot,
    adapter: new NativeNonameService(root),
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(party.server.address() as AddressInfo).port}`;
  try {
    assert.equal(clientArt.length, 15);
    await Promise.all(
      clientArt.map(async (file) => {
        const source = join(root, 'apps/web/src/assets', file);
        const destination = join(webRoot, 'assets', file);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(source, destination);
        const hash = createHash('sha256')
          .update(await readFile(source))
          .digest('hex');
        const response = await fetch(`${url}/assets/${file}?v=${hash}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/webp');
        assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        assert.equal(
          createHash('sha256')
            .update(Buffer.from(await response.arrayBuffer()))
            .digest('hex'),
          hash,
        );
      }),
    );
    for (const [group, count] of [
      ['props', 6],
      ['tables', 4],
    ] as const) {
      const files = await readdir(join(root, 'packages/noname-adapter/runtime/assets', group));
      assert.equal(files.length, count);
      for (const file of files) {
        const response = await fetch(`${url}/engine/runtime/assets/${group}/${file}`, {
          method: 'HEAD',
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/webp');
        assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
      }
    }
    assert.equal((await fetch(`${url}/assets/shanhetu/scenes/master.webp`)).status, 404);
    assert.equal((await fetch(`${url}/engine/runtime/assets/props/prop-extra.webp`)).ok, false);
  } finally {
    party.stop();
    await rm(webRoot, { recursive: true, force: true });
  }
});
