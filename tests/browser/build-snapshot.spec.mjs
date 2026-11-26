// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../../apps/server/src/server.ts';
import { NativeNonameService } from '../../packages/noname-adapter/src/service.ts';
import {
  createBuildSnapshot,
  readBuildManifest,
  writeBuildManifest,
} from '../../scripts/build-manifest.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = join(root, '.runtime/unified-draft-evidence-20261125');

test('清缓存复连旧单挑选将，磁盘新版入口更换且移除旧资源后仍保留完整候选，零 404', async ({
  browser,
}) => {
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(join(evidence, 'snapshot-test-'));
  const contexts = [];
  let party;
  try {
    const distribution = join(scratch, 'dist');
    await cp(join(root, 'dist'), distribution, { recursive: true });
    const manifest = await readBuildManifest(scratch);
    expect(manifest).not.toBeNull();
    const pinned = await createBuildSnapshot(scratch);
    party = createPartyServer({
      port: 0,
      webRoot: join(pinned, 'web'),
      adapter: new NativeNonameService(root, undefined, pinned),
      rosterDirectory: join(scratch, 'rosters'),
      shanhetuDirectory: join(scratch, 'shanhetu'),
      buildId: manifest.buildId,
    });
    await new Promise((resolve) => party.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + party.server.address().port;
    const failures = [];
    async function open(storageState) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        storageState,
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on('response', (response) => response.status() === 404 && failures.push(response.url()));
      page.on('pageerror', (error) => failures.push(error.message));
      return page;
    }
    const consolePage = await open();
    await consolePage.goto(base + '/server');
    const owner = await open();
    const creation = await owner.request.post(base + '/api/rooms', {
      data: { nickname: '旧牌桌玩家' },
    });
    expect(creation.ok()).toBe(true);
    const { code } = (await creation.json()).room;
    const api = base + '/api/rooms/' + code;
    const url = base + '/join/' + code;
    expect(
      (
        await owner.request.put(api, {
          data: { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
        })
      ).ok(),
    ).toBe(true);
    expect((await owner.request.post(api + '/bots', { data: { count: 1 } })).ok()).toBe(true);
    await owner.goto(url);
    await owner.locator('#ready-button').click();
    await owner.locator('#start-button').click();
    const cards = (page) =>
      page.frameLocator('#game-frame').locator('.party-native-draft-shell .hd-card');
    await expect(cards(owner).first()).toBeVisible();
    const candidates = (page) => cards(page).evaluateAll((nodes) => nodes.map((node) => node.link));
    const expected = await candidates(owner);
    expect(expected.length).toBeGreaterThan(1);
    const playerEntry = owner
      .frames()
      .find((frame) => frame.url().includes('/engine/player/'))
      .url();
    const bytes = async (page, path) => {
      const response = await page.request.get(new URL(path, base).href);
      expect(response.status(), path).toBe(200);
      return response.body();
    };
    const html = (await bytes(owner, playerEntry)).toString('utf8');
    const bundleUrl = html.match(/\/engine\/bundle\/noname-[a-f0-9]{64}\.js/)?.[0];
    expect(bundleUrl).toBeTruthy();
    const paths = [
      '/',
      '/assets/app.js',
      '/assets/style.css',
      playerEntry,
      bundleUrl,
      '/engine/runtime/bootstrap.js',
      '/engine/runtime/hero-draft.js',
      '/engine/runtime/hero-draft-native.css',
      '/engine/runtime/assets/tables/table-jade.webp',
    ];
    const hashes = (page) =>
      Promise.all(
        paths.map(async (path) =>
          createHash('sha256')
            .update(await bytes(page, path))
            .digest('hex'),
        ),
      );
    const before = await hashes(owner);
    // Only the isolated simulated new distribution changes. The launched instance
    // must not serve a mixture of old entrypoint, new scripts and missing files.
    await writeFile(join(distribution, 'web/index.html'), '<h1>new console</h1>');
    await writeFile(
      join(distribution, 'runtime/index.html'),
      '<script src="/engine/runtime/next.js"></script>',
    );
    await writeFile(join(distribution, 'runtime/next.js'), 'void 0;');
    await rename(
      join(distribution, 'runtime/hero-draft.js'),
      join(distribution, 'runtime/retired.js'),
    );
    await rm(join(distribution, 'runtime/assets/tables/table-jade.webp'));
    await writeFile(join(distribution, 'engine/noname.js'), 'export const newBundle = true;');
    await writeBuildManifest(scratch, 'b'.repeat(64));
    expect((await readBuildManifest(scratch)).buildId).not.toBe(manifest.buildId);
    const fresh = await open(await owner.context().storageState());
    await owner.context().close();
    await fresh.goto(url);
    await expect(cards(fresh)).toHaveCount(expected.length);
    expect(await candidates(fresh)).toEqual(expected);
    expect(await hashes(fresh)).toEqual(before);
    expect((await (await fresh.request.get(base + '/api/health')).json()).buildId).toBe(
      manifest.buildId,
    );
    expect(failures).toEqual([]);
    await fresh.screenshot({ path: join(evidence, 'snapshot-reconnect-desktop.png') });
  } finally {
    if (party) {
      const closed = once(party.server, 'close');
      party.stop();
      for (const context of contexts) await context.close();
      party.server.closeAllConnections();
      await closed;
    }
    await rm(scratch, { recursive: true, force: true });
  }
});
