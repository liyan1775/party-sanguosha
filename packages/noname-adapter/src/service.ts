import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { EngineAdapter, EngineEvent, MatchSetup } from './index.js';
import type { EngineStatus } from '../../shared/src/contracts.js';

type Match = {
  id: string;
  setup: MatchSetup;
  state: 'starting' | 'playing' | 'ended' | 'failed';
  host?: WebSocket;
  players: Map<string, WebSocket>;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};
type Membership = (roomCode: string, token?: string) => { id: string } | undefined;
const local = (request: IncomingMessage) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '');
const cookie = (request: IncomingMessage, name: string) =>
  (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
};
function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { 'Content-Type': types['.json']!, 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}
function send(socket: WebSocket | undefined, data: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}
function safeMessage(data: string): boolean {
  if (data.length > 131072) return false;
  try {
    const message: unknown = JSON.parse(data);
    // These are native player actions. Configuration, arbitrary execution,
    // deck inspection and the upstream room host protocol are never accepted.
    if (
      !Array.isArray(message) ||
      ![
        'init',
        'inited',
        'reinited',
        'result',
        'tempResult',
        'auto',
        'unauto',
        'giveup',
        'dataSync',
        'syncHandcard',
      ].includes(message[0])
    )
      return false;
    return !data.includes('_noname_func:') && !data.includes('_noname_event:');
  } catch {
    return false;
  }
}

/** Each browser worker is a rule executor, never a player or room owner. */
export class NativeNonameService implements EngineAdapter {
  private readonly engineRoot: string;
  private readonly runtimeRoot: string;
  private readonly resourcesReady: boolean;
  private readonly hostToken = randomBytes(32).toString('base64url');
  private readonly matches = new Map<string, Match>();
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private lastSupervisor = 0;
  private hostOnline = false;
  private membership: Membership = () => undefined;
  private wss?: WebSocketServer;
  private readonly expiry: NodeJS.Timeout;
  constructor(private readonly projectRoot: string) {
    this.engineRoot = resolve(projectRoot, '.local/noname/v1.11.6');
    this.runtimeRoot = resolve(projectRoot, 'packages/noname-adapter/runtime');
    try {
      const manifest = JSON.parse(
        readFileSync(resolve(projectRoot, 'config/noname-lab-assets.json'), 'utf8'),
      );
      const candidate = JSON.parse(
        readFileSync(resolve(projectRoot, 'config/noname-candidate.json'), 'utf8'),
      );
      const build = JSON.parse(readFileSync(this.engineFile('game/build-info.json'), 'utf8'));
      this.resourcesReady =
        candidate.tag === 'v1.11.6' &&
        manifest.commit === candidate.commit &&
        build.commit === candidate.commit &&
        manifest.assets.every((entry: { path: string; bytes: number; gitBlobSha: string }) => {
          const bytes = readFileSync(this.engineFile(entry.path));
          return (
            bytes.length === entry.bytes &&
            createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') ===
              entry.gitBlobSha
          );
        });
    } catch {
      this.resourcesReady = false;
    }
    this.expiry = setInterval(() => {
      if (this.hostOnline && Date.now() - this.lastSupervisor > 20000) {
        this.hostOnline = false;
        this.emit({ type: 'status' });
      }
    }, 5000);
    this.expiry.unref();
  }
  status(): EngineStatus {
    const assets = this.resourcesReady;
    const ready = assets && this.hostOnline;
    return {
      id: 'noname',
      ready,
      message: ready
        ? '无名杀已就绪，真人准备后可以开始对局。'
        : assets
          ? '请让电脑上的服务页面保持开启，等待对局服务就绪。'
          : '无名杀资源未准备，请在电脑上运行资源准备脚本。',
    };
  }
  subscribe(listener: (event: EngineEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: EngineEvent) {
    for (const listener of this.listeners) listener(event);
  }
  matchId(roomCode: string): string | null {
    return (
      [...this.matches.values()].find((match) => match.setup.roomCode === roomCode)?.id ?? null
    );
  }
  start(setup: MatchSetup): Promise<void> {
    this.release(setup.roomCode);
    return new Promise((resolveStart, reject) => {
      const id = randomUUID();
      const match: Match = {
        id,
        setup: structuredClone(setup),
        state: 'starting',
        players: new Map(),
        resolve: resolveStart,
        reject,
        timer: setTimeout(() => this.fail(match), 180000),
      };
      this.matches.set(id, match);
    });
  }
  private fail(match: Match) {
    if (match.state === 'failed' || match.state === 'ended') return;
    const wasStarting = match.state === 'starting';
    match.state = 'failed';
    clearTimeout(match.timer);
    if (wasStarting) match.reject(new Error('Native rule worker unavailable'));
    this.emit({ type: 'failed', roomCode: match.setup.roomCode });
    for (const player of match.players.values()) player.close(1011, '对局服务已中断');
  }
  release(roomCode: string) {
    for (const match of this.matches.values()) {
      if (match.setup.roomCode !== roomCode) continue;
      this.matches.delete(match.id);
      clearTimeout(match.timer);
      match.host?.close(1000);
      for (const player of match.players.values()) player.close(1000);
    }
  }
  close() {
    clearInterval(this.expiry);
    for (const match of [...this.matches.values()]) this.release(match.setup.roomCode);
    for (const socket of this.wss?.clients ?? []) socket.terminate();
    this.wss?.close();
  }
  private hostAuthorized(request: IncomingMessage) {
    const value = cookie(request, 'party_engine');
    if (!local(request) || !value) return false;
    const supplied = Buffer.from(value),
      expected = Buffer.from(this.hostToken);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  attach(server: Server, membership: Membership) {
    this.membership = membership;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 131072 });
    this.wss = wss;
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const route = /^\/engine\/socket\/([\w-]+)\/(worker|player)$/.exec(url.pathname);
      const match = route && this.matches.get(route[1]!);
      let sameOrigin = false;
      try {
        sameOrigin = new URL(request.headers.origin ?? '').host === request.headers.host;
      } catch {
        /* invalid Origin */
      }
      const seat = match && this.membership(match.setup.roomCode, cookie(request, 'party_player'));
      const allowed =
        match &&
        sameOrigin &&
        (route![2] === 'worker'
          ? this.hostAuthorized(request)
          : seat &&
            match.setup.seats.some(
              (candidate) => candidate.kind === 'human' && candidate.id === seat.id,
            ));
      if (!allowed || !match || match.state === 'failed') {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        if (route![2] === 'worker') {
          if (match.host?.readyState === WebSocket.OPEN) {
            ws.close(1008);
            return;
          }
          match.host = ws;
          for (const id of match.players.keys()) send(ws, { type: 'connect', id });
          ws.on('message', (bytes) => {
            try {
              const message = JSON.parse(bytes.toString()) as {
                type: string;
                id?: string;
                data?: string;
              };
              if (message.type === 'send' && message.id && typeof message.data === 'string') {
                const player = match.players.get(message.id);
                if (player?.readyState === WebSocket.OPEN) player.send(message.data);
              } else if (message.type === 'close' && message.id)
                match.players.get(message.id)?.close();
              else if (message.type === 'started' && match.state === 'starting') {
                match.state = 'playing';
                clearTimeout(match.timer);
                match.resolve();
              } else if (message.type === 'ended' && match.state === 'playing') {
                match.state = 'ended';
                this.emit({ type: 'ended', roomCode: match.setup.roomCode });
              } else if (message.type === 'failed') this.fail(match);
            } catch {
              this.fail(match);
            }
          });
          ws.on('close', () => {
            if (match.host === ws && this.matches.has(match.id)) this.fail(match);
          });
        } else {
          const id = seat!.id;
          const previous = match.players.get(id);
          if (previous) {
            previous.close(1000, '已在另一页面继续对局');
            send(match.host, { type: 'close', id });
          }
          match.players.set(id, ws);
          send(match.host, { type: 'connect', id });
          ws.on('message', (bytes) => {
            const data = bytes.toString();
            if (!safeMessage(data)) {
              ws.close(1008, '无效对局操作');
              return;
            }
            send(match.host, { type: 'message', id, data });
          });
          ws.on('close', () => {
            if (match.players.get(id) !== ws) return;
            match.players.delete(id);
            send(match.host, { type: 'close', id });
          });
        }
      });
    });
  }
  private engineFile(path: string) {
    if (path.includes('\\') || path.includes('\0')) throw new Error('Invalid engine path');
    const file = resolve(this.engineRoot, path.replace(/^\/+/, ''));
    const within = relative(this.engineRoot, file);
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('Invalid engine path');
    return file;
  }
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/engine/')) return false;
    if (request.method !== 'GET') {
      json(response, 405, { error: { message: '只允许读取引擎资源。' } });
      return true;
    }
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    );
    try {
      if (url.pathname === '/engine/jobs') {
        if (!local(request)) {
          json(response, 403, {});
          return true;
        }
        response.setHeader(
          'Set-Cookie',
          `party_engine=${this.hostToken}; Path=/; HttpOnly; SameSite=Strict`,
        );
        this.lastSupervisor = Date.now();
        if (!this.hostOnline) {
          this.hostOnline = true;
          this.emit({ type: 'status' });
        }
        json(response, 200, {
          jobs: [...this.matches.values()]
            .filter((match) => ['starting', 'playing', 'ended'].includes(match.state))
            .map(({ id, setup }) => ({ id, roomCode: setup.roomCode })),
        });
        return true;
      }
      const matchRoute = /^\/engine\/(setup|worker|player)\/([\w-]+)$/.exec(url.pathname);
      if (matchRoute) {
        const match = this.matches.get(matchRoute[2]!);
        const worker =
          matchRoute[1] === 'worker' ||
          (matchRoute[1] === 'setup' && url.searchParams.get('role') === 'worker');
        const seat =
          match && this.membership(match.setup.roomCode, cookie(request, 'party_player'));
        if (!match || (worker ? !this.hostAuthorized(request) : !seat)) {
          json(response, 403, {});
          return true;
        }
        if (matchRoute[1] === 'setup') {
          const presets = JSON.parse(
            await readFile(resolve(this.projectRoot, 'config/roster-presets.json'), 'utf8'),
          );
          const config = JSON.parse(await readFile(this.engineFile('game/config.json'), 'utf8'));
          const assets = JSON.parse(
            await readFile(resolve(this.projectRoot, 'config/noname-lab-assets.json'), 'utf8'),
          );
          json(response, 200, {
            id: match.id,
            ...match.setup,
            role: worker ? 'worker' : 'player',
            playerId: worker ? null : seat!.id,
            preset: presets.presets.find(
              (preset: { id: string }) => preset.id === match.setup.settings.generalPreset,
            ),
            portraitAliases: assets.portraitAliases ?? {},
            config,
          });
        } else {
          const content = await readFile(resolve(this.runtimeRoot, 'index.html'));
          response.writeHead(200, { 'Content-Type': types['.html']!, 'Cache-Control': 'no-store' });
          response.end(content);
        }
        return true;
      }
      if (url.pathname.startsWith('/engine/fs/')) {
        const file = this.engineFile(
          url.searchParams.get('fileName') ?? url.searchParams.get('dir') ?? '',
        );
        if (url.pathname === '/engine/fs/checkFile') {
          const info = await stat(file).catch(() => null);
          json(response, 200, {
            success: true,
            data: info?.isFile() ? 'file' : info?.isDirectory() ? 'directory' : null,
          });
        } else if (url.pathname === '/engine/fs/getFileList') {
          const entries = await readdir(file, { withFileTypes: true }).catch(() => []);
          json(response, 200, {
            success: true,
            data: {
              folders: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
              files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
            },
          });
        } else json(response, 403, { success: false });
        return true;
      }
      const wrapper =
        /^\/engine\/(?:modes\/(identity|single|doudizhu|versus)(?:\/index)?|core\/mode\/(identity|single|doudizhu|versus)\/index)\.js$/.exec(
          url.pathname,
        );
      if (wrapper) {
        response.writeHead(200, { 'Content-Type': types['.js']! });
        response.end(
          `import base from '/engine/core/mode/${wrapper[1] ?? wrapper[2]}.js'; import { adaptMode } from '/engine/runtime/mode.js'; export const type='mode'; export default function(){ return adaptMode(typeof base === 'function' ? base() : {...base}); }`,
        );
        return true;
      }
      let file: string;
      if (url.pathname.startsWith('/engine/runtime/')) {
        const name = url.pathname.slice('/engine/runtime/'.length);
        if (!['bootstrap.js', 'mode.js', 'relay.js', 'privacy.js', 'controls.js'].includes(name))
          throw new Error('Invalid runtime path');
        file = resolve(this.runtimeRoot, name);
      } else if (url.pathname.startsWith('/engine/core/'))
        file = this.engineFile(decodeURIComponent(url.pathname.slice('/engine/core/'.length)));
      else {
        json(response, 404, {});
        return true;
      }
      let content = await readFile(file);
      if (file === this.engineFile('noname/init/import.js')) {
        content = Buffer.from(
          content
            .toString()
            .replaceAll('`/card/', '`/engine/core/card/')
            .replaceAll('`/character/', '`/engine/core/character/')
            .replaceAll('`/mode/', '`/engine/modes/'),
        );
      } else if (file === this.engineFile('noname/init/browser.js'))
        content = Buffer.from(
          content.toString().replaceAll('requestBackend("/', 'requestBackend("/engine/fs/'),
        );
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(content);
    } catch (error) {
      json(response, (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400, {
        error: { message: '引擎资源不可用。' },
      });
    }
    return true;
  }
}
