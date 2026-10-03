import { timingSafeEqual, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import type {
  ExtensionInfo,
  ServerInfo,
  SessionView,
} from '../../../packages/shared/src/contracts.js';
import type { EngineAdapter } from '../../../packages/noname-adapter/src/index.js';
import { NonameAdapter } from '../../../packages/noname-adapter/src/index.js';
import { AppError } from './errors.js';
import { findJoinUrls } from './network.js';
import { RoomStore } from './room.js';

interface ServerOptions {
  webRoot: string;
  port: number;
  hostSecret?: string;
  publicUrl?: string;
  adapter?: EngineAdapter;
  extensions?: ExtensionInfo[];
}

function cookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('=').slice(0, 2))
      .filter((part) => part.length === 2),
  );
}

function matches(secret: unknown, expected: string): boolean {
  if (typeof secret !== 'string') return false;
  const supplied = Buffer.from(secret);
  const known = Buffer.from(expected);
  return supplied.length === known.length && timingSafeEqual(supplied, known);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 4096) throw new AppError(413, 'BODY_TOO_LARGE', '请求内容过长。');
    chunks.push(Buffer.from(chunk));
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new AppError(400, 'INVALID_JSON', '请求格式无效。');
  }
}

export function createPartyServer(options: ServerOptions) {
  const hostSecret = options.hostSecret ?? randomBytes(32).toString('base64url');
  const hostSession = randomBytes(32).toString('base64url');
  const extensions = options.extensions ?? [];
  const room = new RoomStore(options.adapter ?? new NonameAdapter(), extensions);
  const eventStreams = new Set<ServerResponse>();
  const cookie = (name: string, value: string, expiry = 86400) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expiry}`;
  const isHost = (request: IncomingMessage) => matches(cookies(request).party_host, hostSession);
  const requireHost = (request: IncomingMessage) => {
    if (!isHost(request))
      throw new AppError(403, 'HOST_REQUIRED', '只有电脑房主可以进行这项操作。');
  };

  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      const known =
        error instanceof AppError
          ? error
          : new AppError(500, 'INTERNAL_ERROR', '服务遇到问题，请查看电脑终端。');
      if (!(error instanceof AppError)) console.error(error);
      json(response, known.status, { error: { code: known.code, message: known.message } });
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 15000;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const route = `${request.method} ${url.pathname}`;
    if (!['GET', 'HEAD'].includes(request.method ?? '') && request.headers.origin) {
      if (new URL(request.headers.origin).host !== request.headers.host)
        throw new AppError(403, 'INVALID_ORIGIN', '请从本机房间页面操作。');
    }
    const playerToken = cookies(request).party_player;
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : options.port;
    const joinUrls = findJoinUrls(actualPort, room.code, options.publicUrl);

    if (route === 'GET /api/health') {
      json(response, 200, { ok: true, engineReady: room.snapshot().engine.ready });
      return;
    }
    if (route === 'GET /api/info') {
      const info: ServerInfo = { version: '0.1.0', joinUrls, room: room.snapshot(), extensions };
      json(response, 200, info);
      return;
    }
    if (route === 'GET /api/me') {
      const session: SessionView = {
        host: isHost(request),
        playerId: room.session(playerToken)?.id ?? null,
      };
      json(response, 200, session);
      return;
    }
    if (route === 'POST /api/host-session') {
      const body = await readBody(request);
      if (!matches(body.secret, hostSecret))
        throw new AppError(403, 'INVALID_HOST_KEY', '请使用电脑终端显示的房主链接进入。');
      response.setHeader('Set-Cookie', cookie('party_host', hostSession));
      json(response, 200, { ok: true });
      return;
    }
    if (route === 'POST /api/players') {
      const body = await readBody(request);
      const player = room.join(body.code, body.nickname, playerToken);
      response.setHeader('Set-Cookie', cookie('party_player', player.token));
      json(response, 201, { playerId: player.playerId });
      return;
    }
    if (route === 'DELETE /api/me') {
      room.leave(playerToken);
      response.setHeader('Set-Cookie', cookie('party_player', '', 0));
      json(response, 200, { ok: true });
      return;
    }
    if (route === 'PUT /api/me/ready') {
      const body = await readBody(request);
      room.setReady(playerToken, body.ready);
      json(response, 200, { ok: true });
      return;
    }
    if (route === 'PUT /api/room') {
      requireHost(request);
      room.updateSettings(await readBody(request));
      json(response, 200, room.snapshot());
      return;
    }
    if (route === 'POST /api/room/start') {
      requireHost(request);
      await room.start();
      json(response, 200, room.snapshot());
      return;
    }
    if (request.method === 'DELETE' && /^\/api\/players\/[\w-]+$/.test(url.pathname)) {
      requireHost(request);
      room.removePlayer(url.pathname.split('/').at(-1)!);
      json(response, 200, { ok: true });
      return;
    }
    if (route === 'GET /api/events') {
      room.checkCode(url.searchParams.get('room'));
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      eventStreams.add(response);
      const send = (snapshot: unknown) => {
        if (!response.destroyed && !response.writableEnded)
          response.write(`event: room\ndata: ${JSON.stringify(snapshot)}\n\n`);
      };
      const unsubscribe = room.subscribe(send);
      const disconnect = room.connect(playerToken, isHost(request));
      send(room.snapshot());
      const heartbeat = setInterval(() => {
        if (!response.destroyed) response.write(': heartbeat\n\n');
      }, 10000);
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        disconnect();
        eventStreams.delete(response);
      };
      response.once('close', cleanup);
      return;
    }
    if (route === 'GET /api/qr.svg') {
      requireHost(request);
      const target = url.searchParams.get('url');
      if (!target || !joinUrls.includes(target))
        throw new AppError(400, 'INVALID_QR_TARGET', '请选择电脑所在的局域网地址。');
      const svg = await QRCode.toString(target, {
        type: 'svg',
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#172520', light: '#ffffff' },
      });
      response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      response.end(svg);
      return;
    }
    const assets: Record<string, { file: string; mime: string }> = {
      '/assets/app.js': { file: 'app.js', mime: 'text/javascript; charset=utf-8' },
      '/assets/style.css': { file: 'style.css', mime: 'text/css; charset=utf-8' },
    };
    const asset =
      assets[url.pathname] ??
      (/^\/(host|join\/[A-F0-9]{6})?$/.test(url.pathname)
        ? { file: 'index.html', mime: 'text/html; charset=utf-8' }
        : undefined);
    if (asset && ['GET', 'HEAD'].includes(request.method ?? '')) {
      const content = await readFile(path.join(options.webRoot, asset.file));
      response.writeHead(200, { 'Content-Type': asset.mime, 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : content);
      return;
    }
    throw new AppError(404, 'NOT_FOUND', '页面不存在。');
  }

  return {
    server,
    room,
    hostSecret,
    closeStreams: () => {
      for (const stream of eventStreams) stream.end();
    },
  };
}
