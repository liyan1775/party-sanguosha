import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPartyServer } from '../../apps/server/src/server.js';

test('旧 JS/CSS 已长缓存，同地址普通刷新立即使用新 HTML 指纹', async ({ page }) => {
  const webRoot = await mkdtemp(join(tmpdir(), 'party-upgrade-cache-'));
  const party = createPartyServer({ port: 0, webRoot });
  async function publish(version: string, color: string) {
    const js = `document.querySelector('main').textContent = '${version}';`;
    const css = `main { color: ${color} }`;
    const hash = (content: string) => createHash('sha256').update(content).digest('hex');
    const script = `/assets/app.js?v=${hash(js)}`;
    const style = `/assets/style.css?v=${hash(css)}`;
    await Promise.all([
      writeFile(join(webRoot, 'app.js'), js),
      writeFile(join(webRoot, 'style.css'), css),
    ]);
    await writeFile(
      join(webRoot, 'index.html'),
      `<link rel="stylesheet" href="${style}"><script type="module" src="${script}"></script><main></main>`,
    );
    return { script, style };
  }
  try {
    const old = await publish('before', 'red');
    party.server.listen(0, '127.0.0.1');
    await once(party.server, 'listening');
    const url = `http://127.0.0.1:${(party.server.address() as AddressInfo).port}/`;
    const requests = [old.script, old.style].map((asset) =>
      page.waitForResponse((response) => response.url().endsWith(asset)),
    );
    await page.goto(url);
    for (const request of requests)
      expect((await request).headers()['cache-control']).toContain('immutable');
    await expect(page.locator('main')).toHaveText('before');
    await expect(page.locator('main')).toHaveCSS('color', 'rgb(255, 0, 0)');
    const updated = await publish('after!', 'blue');
    await page.reload();
    await expect(page.locator('script')).toHaveAttribute('src', updated.script);
    await expect(page.locator('link')).toHaveAttribute('href', updated.style);
    await expect(page.locator('main')).toHaveText('after!');
    await expect(page.locator('main')).toHaveCSS('color', 'rgb(0, 0, 255)');
  } finally {
    const closed = once(party.server, 'close');
    party.stop();
    party.server.closeAllConnections();
    await closed;
    await rm(webRoot, { force: true, recursive: true });
  }
});
