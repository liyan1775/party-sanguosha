import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createPartyServer } from '../apps/server/src/server.js';
import { createPublicGateway } from '../apps/server/src/public-gateway.js';
import { downloadConnector } from '../apps/server/src/public-connector.js';
import {
  extractTemporaryUrl,
  publicHealthMatches,
  verifyRealtime,
} from '../apps/server/src/public-tunnel.js';
import { PollChannel } from '../packages/noname-adapter/src/poll-channel.js';
import { findHomeUrls } from '../apps/server/src/network.js';

test('双入口：公网未就绪时局域网可扫码，中断保留两码，公网响应不泄露局域网地址', async (t) => {
  const lanUrl = 'http://192.168.1.100:3000/';
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../apps/web/', import.meta.url)),
    entryMode: 'internet',
    publicUrl: lanUrl,
  });
  await new Promise<void>((done) => party.server.listen(0, '127.0.0.1', done));
  const address = party.server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const gateway = createPublicGateway(address.port);
  await new Promise<void>((done) => gateway.server.listen(0, '127.0.0.1', done));
  const ingress = gateway.server.address();
  assert(ingress && typeof ingress === 'object');
  const publicBase = `http://127.0.0.1:${ingress.port}`;
  t.after(() => {
    gateway.close();
    party.stop();
    party.server.closeAllConnections();
  });
  const info = () => fetch(`${base}/api/info`).then((response) => response.json());
  assert.deepEqual((await info()).homeUrls, [lanUrl]);
  assert.equal((await info()).entry.access, 'lan');
  assert.equal((await info()).entry.status, 'starting');
  const publicInfo = () => fetch(`${publicBase}/api/info`).then((response) => response.json());
  assert.deepEqual((await publicInfo()).homeUrls, []);
  assert.equal((await publicInfo()).entry.access, 'internet');
  assert.throws(() => party.setInternetEntry('ready', 'wrong', 'https://other.invalid/'));
  const publicUrl = 'https://friends-party.trycloudflare.com/';
  party.setInternetEntry('ready', 'ready', publicUrl);
  const created = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '朋友' }),
  });
  const cookie = created.headers.get('set-cookie')!.split(';')[0]!;
  const data = await created.json();
  assert.deepEqual(
    data.joinUrls,
    [lanUrl, publicUrl].map((url) => new URL(`/join/${data.room.code}`, url).href),
  );
  assert.deepEqual((await publicInfo()).homeUrls, [publicUrl]);
  assert.equal(JSON.stringify(await publicInfo()).includes('192.168.'), false);
  assert.equal(JSON.stringify(await info()).includes(party.controlToken), false);
  const publicRoom = await (await fetch(`${publicBase}/api/rooms/${data.room.code}`)).json();
  assert.deepEqual(publicRoom.joinUrls, [new URL(`/join/${data.room.code}`, publicUrl).href]);
  assert.equal(
    (await fetch(`${publicBase}/api/qr.png?url=${encodeURIComponent(lanUrl)}`)).status,
    400,
  );
  const qr = `${base}/api/qr.png?url=${encodeURIComponent(publicUrl)}`;
  const image = await fetch(qr);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert((await image.arrayBuffer()).byteLength > 1000);
  party.setInternetEntry('unavailable', 'waiting');
  assert.deepEqual((await info()).homeUrls, [lanUrl, publicUrl]);
  assert.equal((await fetch(qr)).status, 200);
  assert.equal((await fetch(`${base}/api/qr.svg?url=${encodeURIComponent(lanUrl)}`)).status, 200);
  const room = await (await fetch(`${base}/api/rooms/${data.room.code}`)).json();
  assert.deepEqual(room.joinUrls, data.joinUrls);
  const joined = await fetch(`${base}/api/rooms/${data.room.code}/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '局域网朋友' }),
  });
  assert.equal(joined.status, 201, '公网中断时，局域网仍可入座同一房间');
  assert.equal(
    (await fetch(`${base}/api/me`, { headers: { cookie } }).then((r) => r.json())).playerId,
    data.playerId,
  );
  party.setInternetEntry('ready', 'recovered', publicUrl);
  assert.deepEqual((await info()).homeUrls, [lanUrl, publicUrl]);
  assert.equal(await publicHealthMatches(base, party.instanceId), true);
  assert.equal(await publicHealthMatches(base, randomUUID()), false);
  assert.equal(await verifyRealtime(base), true);
  assert.equal(extractTemporaryUrl('| https://friends-party.trycloudflare.com |'), publicUrl);
  assert.equal(extractTemporaryUrl('https://friends-party.trycloudflare.com.evil/'), undefined);
});

test('公网代理：伪造 Host、转发头和本机凭据不能取得管理页、停止或宿主权限', async (t) => {
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../apps/web/', import.meta.url)),
    entryMode: 'internet',
  });
  await new Promise<void>((done) => party.server.listen(0, '127.0.0.1', done));
  const address = party.server.address();
  assert(address && typeof address === 'object');
  const gateway = createPublicGateway(address.port);
  await new Promise<void>((done) => gateway.server.listen(0, '127.0.0.1', done));
  const ingress = gateway.server.address();
  assert(ingress && typeof ingress === 'object');
  const base = `http://127.0.0.1:${ingress.port}`;
  t.after(() => {
    gateway.close();
    party.stop();
    party.server.closeAllConnections();
  });
  for (const route of [
    '/server',
    '/host',
    '/engine/jobs',
    '/engine/jobs?transport=events',
    '/engine/worker/a',
    '/engine/setup/a?role=worker',
    '/api/shutdown',
    '/api/internet/retry',
    '//[',
  ]) {
    const response: Response = await fetch(base + route, {
      method: route.startsWith('/api/') ? 'POST' : 'GET',
      headers: {
        Host: `127.0.0.1:${address.port}`,
        'X-Party-Control': party.controlToken,
        'X-Party-Ingress': '',
        Cookie: 'party_engine=forged',
      },
    });
    assert.equal(response.status, 403, route);
    assert.equal(response.headers.has('set-cookie'), false);
  }
  assert(party.server.listening);
  const created = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '流量玩家' }),
  });
  assert.equal(created.status, 201);
  assert.match(created.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict.*Secure/);
  assert.equal(await publicHealthMatches(base, party.instanceId), true);
  for (let batch = 0; batch < 2; batch++) {
    const checks = await Promise.all(
      Array.from({ length: 10 }, () => publicHealthMatches(base, party.instanceId)),
    );
    assert(checks.every(Boolean), '连续并发请求可复用正常完成的代理连接');
  }
  assert.equal(await verifyRealtime(base), true);
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/engine/socket/a/worker', {
    headers: { Host: `127.0.0.1:${address.port}` },
    origin: base,
  });
  ws.on('error', () => {});
  await once(ws, 'error');
  const denied = await fetch(`http://127.0.0.1:${address.port}/api/shutdown`, {
    method: 'POST',
    headers: { 'X-Party-Control': party.controlToken, 'X-Party-Ingress': 'public' },
  });
  assert.equal(denied.status, 403);
});

test('默认双入口监听 LAN：局域网手机可读取大厅，伪造本机 Host 和凭据仍不能管理或停止', async (t) => {
  const party = createPartyServer({ port: 0, webRoot: '.', entryMode: 'internet' });
  await new Promise<void>((done) => party.server.listen(0, '0.0.0.0', done));
  t.after(() => {
    party.stop();
    party.server.closeAllConnections();
  });
  const address = party.server.address();
  assert(address && typeof address === 'object');
  const base = findHomeUrls(address.port)[0];
  if (!base) return t.skip('测试环境没有私有 IPv4 网卡，真实 LAN 来源需另行验证');
  const info = await (await fetch(new URL('/api/info', base))).json();
  assert.equal(info.entry.access, 'lan');
  assert(info.homeUrls.includes(base));
  assert.equal(info.entry.status, 'starting');
  for (const path of ['/server', '/api/console', '/api/shutdown', '/api/internet/retry']) {
    const response: Response = await fetch(new URL(path, base), {
      method: ['shutdown', 'retry'].some((part) => path.endsWith(part)) ? 'POST' : 'GET',
      headers: { Host: `127.0.0.1:${address.port}`, 'X-Party-Control': party.controlToken },
    });
    assert.equal(response.status, 403, path);
  }
  assert(party.server.listening);
});

test('公网大厅：连续 HTTP 更新保活，超时撤销准备并保留房主，SSE 与轮询标签共存', async (t) => {
  const party = createPartyServer({ port: 0, webRoot: '.', entryMode: 'internet' });
  await new Promise<void>((done) => party.server.listen(0, '127.0.0.1', done));
  const address = party.server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => {
    party.stop();
    party.server.closeAllConnections();
  });
  const created = await fetch(base + '/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '房主' }),
  });
  const cookie = created.headers.get('set-cookie')!.split(';')[0]!;
  const data = await created.json();
  const room = party.lobby.get(data.room.code);
  const updates = () =>
    fetch(`${base}/api/rooms/${room.code}/events?transport=poll`, { headers: { cookie } }).then(
      (r) => r.json(),
    );
  assert.equal((await updates()).players[0].online, true);
  room.setReady(cookie.slice('party_player='.length), true);
  assert.equal((await updates()).players[0].ready, true);
  const disconnect = room.connect(cookie.slice('party_player='.length));
  disconnect();
  assert.equal(room.snapshot().players[0]!.ready, true);
  room.expirePolls(Date.now() + 31000);
  assert.equal(room.snapshot().players[0]!.online, false);
  assert.equal(room.snapshot().players[0]!.ready, false);
  assert.equal(room.snapshot().ownerId, data.playerId);
  assert.equal((await updates()).players[0].online, true);
  assert.equal(
    JSON.stringify(await updates()).includes(cookie.slice('party_player='.length)),
    false,
  );
});

test('联网组件：校验失败和大小异常不覆盖缓存，完整校验后才原子替换', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'party-connector-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = join(root, 'connector.exe');
  await writeFile(destination, 'previous');
  const bytes = 'verified executable fixture';
  const digest = createHash('sha256').update(bytes).digest('hex');
  const mockFetch = (async () => new Response(bytes)) as typeof fetch;
  await assert.rejects(
    downloadConnector('https://example.invalid/file', destination, 'wrong', { fetcher: mockFetch }),
  );
  assert.equal(await readFile(destination, 'utf8'), 'previous');
  assert.deepEqual(await readdir(root), ['connector.exe']);
  await assert.rejects(
    downloadConnector('https://example.invalid/file', destination, digest, {
      fetcher: mockFetch,
      maxBytes: 3,
    }),
  );
  await assert.rejects(
    downloadConnector('http://example.invalid/file', destination, digest, { fetcher: mockFetch }),
  );
  await downloadConnector('https://example.invalid/file', destination, digest, {
    fetcher: mockFetch,
  });
  assert.equal(await readFile(destination, 'utf8'), bytes);
  let closed = 0;
  const channel = new PollChannel(randomUUID(), 'seat', () => closed++);
  for (let index = 0; index < 520; index++) channel.send('fixture');
  assert.equal(channel.readyState, 3);
  channel.close();
  assert.equal(closed, 1);
});
