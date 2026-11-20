// SPDX-License-Identifier: GPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import catalog from '../config/shanhetu-portraits.json' with { type: 'json' };

/** Fetch only missing, pinned OL seat art. Players read the same files over LAN. */
export async function prepareShanhetuPortraits(engineRoot, download) {
  const folder = join(engineRoot, 'image/shanhetu');
  await mkdir(folder, { recursive: true });
  const entries = catalog.portraits.values();
  let downloaded = 0;
  let failure;
  async function worker() {
    for (const { file, bytes, sha256 } of entries) {
      if (failure) return;
      try {
        if (!/^(?:generalface_)?\d+\.png$/.test(file) || !/^[a-f0-9]{64}$/.test(sha256))
          throw new Error('山河图立绘清单有误');
        const target = join(folder, sha256 + '.png');
        const matches = (data) =>
          data?.length === bytes && createHash('sha256').update(data).digest('hex') === sha256;
        const existing = await readFile(target).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (matches(existing)) continue;
        const url = new URL(file, catalog.baseUrl);
        const image = await download(url, url.href);
        if (!matches(image)) throw new Error(`立绘校验失败 ${url.href}`);
        const temporary = `${target}.${randomUUID()}.part`;
        try {
          await writeFile(temporary, image);
          await rename(temporary, target);
        } finally {
          await rm(temporary, { force: true });
        }
        downloaded++;
      } catch (error) {
        failure ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  if (failure) throw failure;
  console.log(`山河图立绘已校验 ${catalog.portraits.length} 张，本次下载 ${downloaded} 张。`);
}
