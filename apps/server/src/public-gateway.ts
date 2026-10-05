import { createServer, request as proxyRequest, type IncomingMessage } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';

function allowed(request: IncomingMessage): boolean {
  let url: URL;
  try {
    url = new URL(request.url ?? '/', 'http://localhost');
  } catch {
    return false;
  }
  return !(
    ['/server', '/host', '/api/shutdown', '/api/internet/retry', '/engine/jobs'].includes(
      url.pathname,
    ) ||
    /^\/engine\/(worker|socket\/[^/]+\/worker)(\/|$)/.test(url.pathname) ||
    (url.pathname.startsWith('/engine/setup/') && url.searchParams.get('role') === 'worker')
  );
}

/** A separate loopback listener keeps tunnel traffic outside local authority. */
export function createPublicGateway(port: number) {
  const sockets = new Set<Duplex>();
  const headers = (request: IncomingMessage) => ({
    ...request.headers,
    'x-party-ingress': 'public',
    'x-party-control': '',
    cookie: (request.headers.cookie ?? '')
      .split(';')
      .filter((part) => !part.trim().startsWith('party_engine='))
      .join(';'),
  });
  const gateway = createServer((request, response) => {
    if (!allowed(request)) {
      response.writeHead(403, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    const upstream = proxyRequest(
      {
        host: '127.0.0.1',
        port,
        path: request.url,
        method: request.method,
        headers: headers(request),
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.on('error', () => response.destroy());
        result.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    response.on('close', () => {
      if (!response.writableEnded) upstream.destroy();
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
  gateway.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  gateway.on('upgrade', (request, socket, head) => {
    if (
      !allowed(request) ||
      !/^\/engine\/socket\/[^/]+\/player$|^\/api\/realtime-check$/.test(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      )
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = connect({ host: '127.0.0.1', port });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.once('connect', () => {
      const fields = Object.entries(headers(request)).flatMap(([key, value]) =>
        value === undefined
          ? []
          : (Array.isArray(value) ? value : [value]).map((part) => `${key}: ${part}`),
      );
      upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${fields.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
  });
  return {
    server: gateway,
    close: () => {
      for (const socket of sockets) socket.destroy();
      gateway.close();
    },
  };
}
