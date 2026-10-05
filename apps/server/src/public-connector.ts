import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Only a complete file matching the reviewed release digest can be executed. */
export async function downloadConnector(
  url: string,
  destination: string,
  digest: string,
  {
    fetcher = fetch,
    signal,
    maxBytes = 80 * 1024 * 1024,
    log = console.log,
  }: {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    maxBytes?: number;
    log?: (message: string) => void;
  } = {},
): Promise<void> {
  if (new URL(url).protocol !== 'https:') throw new Error('联网组件必须从 HTTPS 下载。');
  const temporary = `${destination}.${randomUUID()}.part`;
  let handle;
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.any([AbortSignal.timeout(900000), ...(signal ? [signal] : [])]),
    });
    if (
      !response.ok ||
      !response.body ||
      (response.url && new URL(response.url).protocol !== 'https:')
    )
      throw new Error('联网组件下载服务不可用，请稍后再次双击。');
    if (Number(response.headers.get('content-length')) > maxBytes)
      throw new Error('联网组件大小异常。');
    handle = await open(temporary, 'wx');
    const hash = createHash('sha256');
    let size = 0,
      progress = Date.now();
    const reader = response.body.getReader();
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error('联网组件大小异常。');
      hash.update(chunk);
      await handle.writeFile(chunk);
      if (Date.now() - progress > 15000) {
        log(`正在准备联网组件，已下载 ${(size / 1024 / 1024).toFixed(1)} MiB…`);
        progress = Date.now();
      }
    }
    if (hash.digest('hex') !== digest) throw new Error('联网组件校验失败，未运行该文件。');
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

export async function ensureConnector(root: string, signal?: AbortSignal) {
  const config = JSON.parse(await readFile(resolve(root, 'config/public-connector.json'), 'utf8'));
  const key = `${process.platform}-${process.arch}`;
  const artifact = config.artifacts[key];
  if (!artifact) throw new Error('自动公网入口当前支持 Windows x64。');
  const directory = resolve(root, '.local/connector', config.version, key);
  await mkdir(directory, { recursive: true });
  const executable = resolve(directory, 'cloudflared.exe');
  if ((await sha256(executable).catch(() => '')) !== artifact.sha256) {
    console.log('首次跨网络启动，自动准备固定版本联网组件，无需安装或注册…');
    await downloadConnector(artifact.url, executable, artifact.sha256, {
      ...(signal ? { signal } : {}),
    });
  }
  const configPath = resolve(directory, 'empty.yml');
  await writeFile(configPath, '{}\n');
  return { executable, configPath };
}
