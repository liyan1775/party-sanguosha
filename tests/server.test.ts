import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartyServer } from '../apps/server/src/server.js';
import { fileURLToPath } from 'node:url';

test('HTTP 权限、邀请、请求校验与文件隔离', async (t) => {
  const secret = 'test-host-capability-with-sufficient-length';
  const party = createPartyServer({
    port: 0,
    hostSecret: secret,
    webRoot: fileURLToPath(new URL('../apps/web/', import.meta.url)),
    publicUrl: 'http://192.168.1.100:3000',
  });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    party.closeStreams();
    party.server.closeAllConnections();
    await new Promise<void>((resolve) => party.server.close(() => resolve()));
  });
  const address = party.server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (route: string, method = 'GET', body?: unknown, cookie = '', origin?: string) =>
    fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', cookie, ...(origin ? { origin } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const info = await (await request('/api/info')).json();
  assert.equal(JSON.stringify(info).includes(secret), false);
  assert.equal(info.room.engine.ready, false);
  assert.equal((await request('/api/room', 'PUT', {})).status, 403);
  assert.equal((await request('/api/room/start', 'POST')).status, 403);
  assert.equal((await request('/api/host-session', 'POST', { secret: 'wrong' })).status, 403);
  const login = await request('/api/host-session', 'POST', { secret });
  const hostCookie = login.headers.get('set-cookie')!.split(';')[0]!;
  assert.match(login.headers.get('set-cookie')!, /HttpOnly/);
  assert.equal(
    (
      await request(
        '/api/room',
        'PUT',
        { mode: 'duel', playerCount: 2, generalPreset: 'advanced', extensions: [] },
        hostCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request('/api/room', 'PUT', {}, hostCookie, 'http://other-site.invalid')).status,
    403,
  );
  assert.equal((await request('/api/room/start', 'POST', undefined, hostCookie)).status, 503);
  assert.equal(
    (await request('/api/players', 'POST', { code: 'OLD123', nickname: '赵云' })).status,
    404,
  );
  assert.equal(
    (await request('/api/players', 'POST', { code: party.room.code, nickname: '赵云' })).status,
    201,
  );
  assert.equal(
    (await request('/api/players', 'POST', { code: party.room.code, nickname: '关羽' })).status,
    201,
  );
  assert.equal(
    (await request('/api/players', 'POST', { code: party.room.code, nickname: '张飞' })).status,
    409,
  );
  assert.equal((await request('/api/me/ready', 'PUT', { ready: true })).status, 401);
  const badJson = await fetch(base + '/api/players', { method: 'POST', body: '{bad' });
  assert.equal(badJson.status, 400);
  const largeBody = await request('/api/players', 'POST', { nickname: 'x'.repeat(5000) });
  assert.equal(largeBody.status, 413);
  const qr = await request(
    `/api/qr.svg?url=${encodeURIComponent(info.joinUrls[0])}`,
    'GET',
    undefined,
    hostCookie,
  );
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /<svg/);
  assert.equal(
    (
      await request(
        `/api/qr.svg?url=${encodeURIComponent(base + '/host#' + secret)}`,
        'GET',
        undefined,
        hostCookie,
      )
    ).status,
    400,
  );
  for (const route of [
    '/.env',
    '/.runtime/session.json',
    '/config/noname-candidate.json',
    '/.local/noname/v1.11.6/index.html',
  ])
    assert.equal((await request(route)).status, 404);
  assert.equal((await request('/')).status, 200);
});
