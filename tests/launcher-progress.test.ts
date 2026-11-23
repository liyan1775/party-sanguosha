import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { startProgressServer } = await import(
  new URL('../scripts/launcher-progress.mjs', import.meta.url).href
);

test('启动可视化进度页：仅允许本机 Host、实时汇报阶段与百分比并在关闭时清理状态文件', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'party-launcher-progress-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const progress = await startProgressServer({
    runtimeDir: dir,
    version: '1.0.0',
    entryMode: 'internet',
  });
  t.after(async () => {
    await progress.close();
  });

  const meta = JSON.parse(await readFile(path.join(dir, 'launcher-progress.json'), 'utf8'));
  assert.equal(meta.url, progress.url);
  assert.equal(meta.entryMode, 'internet');
  assert.equal(meta.pid, process.pid);

  const page = await fetch(progress.url);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('set-cookie'), null);
  const html = await page.text();
  assert.match(html, /聚会三国杀 v1\.0\.0/);
  assert.match(html, /data\/shanhetu/);

  const hostileStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(
      `${progress.url}api/status`,
      { headers: { Host: 'evil.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.once('error', reject);
    req.end();
  });
  assert.equal(hostileStatus, 403);

  progress.update({ step: 2, percent: 25, stageTitle: '正在同步游戏资源…' });
  progress.pushLog('校验固定资源 50 / 100');
  const mid = await (await fetch(`${progress.url}api/status`)).json();
  assert.equal(mid.step, 2);
  assert.ok(mid.percent >= 49 && mid.percent <= 82);
  assert.equal(mid.logs.at(-1), '校验固定资源 50 / 100');

  progress.setReady('http://127.0.0.1:43210/server');
  const ready = await (await fetch(`${progress.url}api/status`)).json();
  assert.equal(ready.state, 'ready');
  assert.equal(ready.percent, 100);
  assert.equal(ready.redirectUrl, 'http://127.0.0.1:43210/server');

  progress.setFailed('模拟网络中断');
  const failed = await (await fetch(`${progress.url}api/status`)).json();
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error, '模拟网络中断');

  await progress.close();
  await assert.rejects(() => stat(path.join(dir, 'launcher-progress.json')));
});
