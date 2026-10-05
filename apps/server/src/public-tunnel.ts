import { spawn, type ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createPublicGateway } from './public-gateway.js';
import { ensureConnector } from './public-connector.js';
import type { EntryInfo } from '../../../packages/shared/src/contracts.js';

export function extractTemporaryUrl(text: string): string | undefined {
  const result = text.match(
    /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com(?=$|[\s|])/i,
  )?.[0];
  return result ? `${result.toLowerCase()}/` : undefined;
}

export async function publicHealthMatches(
  base: string,
  instanceId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/health', base), {
      signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok || Number(response.headers.get('content-length')) > 4096) return false;
    const data = await response.text();
    if (data.length > 4096) return false;
    const health = JSON.parse(data);
    return (
      health.app === 'party-sanguosha' && health.instanceId === instanceId && health.ok === true
    );
  } catch {
    return false;
  }
}

export async function verifyRealtime(base: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((done) => {
    const url = new URL('/api/realtime-check', base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { origin: new URL(base).origin, handshakeTimeout: 10000 });
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.terminate();
      done(ok);
    };
    const abort = () => finish(false);
    const timer = setTimeout(abort, 12000);
    signal?.addEventListener('abort', abort, { once: true });
    socket.once('open', () => socket.send('ping'));
    socket.once('message', (bytes) => finish(bytes.toString() === 'party-sanguosha-realtime'));
    socket.on('error', abort);
    socket.once('close', abort);
    if (signal?.aborted) abort();
  });
}

/** Owns only its connector child; stopping a game server also closes its ingress. */
export function managePublicEntry(options: {
  root: string;
  runtime: string;
  port: number;
  instanceId: string;
  hasRooms: () => boolean;
  update: (status: EntryInfo['status'], message: string, url?: string) => void;
}) {
  const gateway = createPublicGateway(options.port);
  let child: ChildProcess | undefined;
  let controller: AbortController | undefined;
  let closed = false,
    running = false;
  let currentUrl: string | undefined;
  let tail = '';
  const saveLog = () =>
    writeFile(resolve(options.runtime, 'public-tunnel.log'), tail).catch(() => {});
  const stopChild = async () => {
    const owned = child;
    child = undefined;
    if (!owned || owned.exitCode !== null || owned.signalCode !== null) return;
    await new Promise<void>((done) => {
      const timeout = setTimeout(done, 3000);
      owned.once('exit', () => {
        clearTimeout(timeout);
        done();
      });
      owned.kill();
    });
  };
  const started = new Promise<number>((done, reject) => {
    gateway.server.once('error', reject);
    gateway.server.listen(0, '127.0.0.1', () => {
      const address = gateway.server.address();
      if (address && typeof address === 'object') done(address.port);
      else reject(new Error('公网入口未能启动。'));
    });
  });
  void started.catch(() => {});
  async function start() {
    if (closed || running) return;
    if (currentUrl && options.hasRooms()) {
      options.update('unavailable', '公网入口已中断。结束当前牌桌后双击停止，再启动并分享新码。');
      return;
    }
    running = true;
    controller = new AbortController();
    const { signal } = controller;
    options.update('starting', '正在准备跨网络入口，请稍候…');
    try {
      const [{ executable, configPath }, ingressPort] = await Promise.all([
        ensureConnector(options.root, signal),
        started,
      ]);
      let ready = false;
      for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
        await stopChild();
        tail = '';
        currentUrl = undefined;
        let candidate: string | undefined,
          ended = false;
        const owned = spawn(
          executable,
          [
            'tunnel',
            '--config',
            configPath,
            '--url',
            `http://127.0.0.1:${ingressPort}`,
            '--no-autoupdate',
            '--protocol',
            ['auto', 'http2', 'quic'][attempt]!,
            '--edge-ip-version',
            '4',
            '--metrics',
            '127.0.0.1:0',
          ],
          {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) => !key.toUpperCase().startsWith('TUNNEL_'),
              ),
            ),
          },
        );
        child = owned;
        owned.once('error', () => {
          ended = true;
        });
        owned.once('exit', () => {
          ended = true;
        });
        const output = (chunk: Buffer) => {
          tail = (tail + chunk.toString('utf8')).slice(-16384);
          candidate ??= extractTemporaryUrl(tail);
        };
        owned.stdout?.on('data', output);
        owned.stderr?.on('data', output);
        const deadline = Date.now() + 100000;
        options.update(
          'starting',
          attempt
            ? `跨网络连接暂未成功，正在重试（${attempt + 1}/3）…`
            : '正在建立临时入口，确认网页与对局连接…',
        );
        while (!ended && !signal.aborted && Date.now() < deadline) {
          if (
            candidate &&
            (await publicHealthMatches(candidate, options.instanceId, signal)) &&
            (await verifyRealtime(candidate, signal))
          ) {
            if (!ended && !signal.aborted) {
              currentUrl = candidate;
              ready = true;
            }
            break;
          }
          await delay(candidate ? 1500 : 250, undefined, { signal });
        }
        await saveLog();
        if (ready) break;
      }
      if (!ready || !currentUrl)
        throw new Error(
          '跨网络入口暂时无法连接。请确认电脑联网，再双击启动重试；同一 Wi-Fi 可用「启动局域网聚会三国杀」。',
        );
      options.update(
        'ready',
        'Wi-Fi 或手机流量均可扫码。整局保持电脑开机、联网和页面开启。',
        currentUrl,
      );
      console.log(`跨网络主页已就绪：${currentUrl}`);
      let failures = 0,
        available = true;
      while (!signal.aborted) {
        await delay(12000, undefined, { signal });
        if (!child || child.exitCode !== null || child.signalCode !== null)
          throw new Error('联网组件已退出。请重新双击启动；新入口需要分享新码。');
        const reachable =
          (await publicHealthMatches(currentUrl, options.instanceId, signal)) &&
          (await verifyRealtime(currentUrl, signal));
        failures = reachable ? 0 : failures + 1;
        if (!reachable && failures >= 2 && available) {
          available = false;
          options.update(
            'unavailable',
            '跨网络入口暂时中断，正在等待恢复。请保持电脑联网，恢复后继续使用原码。',
          );
          await saveLog();
        } else if (reachable && !available) {
          available = true;
          options.update('ready', '跨网络入口已恢复，可继续使用原码和原牌桌。', currentUrl);
        }
      }
    } catch (error) {
      await stopChild();
      if (!signal.aborted)
        options.update(
          'unavailable',
          error instanceof Error ? error.message : '跨网络入口不可用，请重新双击启动。',
        );
    } finally {
      running = false;
    }
  }
  return {
    start,
    close: () => {
      closed = true;
      controller?.abort();
      gateway.close();
      void stopChild();
    },
  };
}
