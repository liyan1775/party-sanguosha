import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createPartyServer } from '../apps/server/src/server.js';
import { NativeNonameService } from '../packages/noname-adapter/src/service.js';
import { PollChannel } from '../packages/noname-adapter/src/poll-channel.js';
import { createServer } from 'node:http';
import type { TestContext } from 'node:test';
import type { MatchSetup } from '../packages/noname-adapter/src/index.js';

async function fixture(t: TestContext) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const engine = new NativeNonameService(root);
  const party = createPartyServer({ port: 0, webRoot: `${root}/apps/web`, adapter: engine });
  await new Promise<void>((resolve) => party.server.listen(0, '127.0.0.1', resolve));
  const address = party.server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => {
    engine.close();
    party.closeStreams();
    party.server.closeAllConnections();
    party.server.close();
  });
  const created = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '玩家' }),
  });
  const ownerCookie = created.headers.get('set-cookie')!.split(';')[0]!;
  const room = (await created.json()).room;
  const supervisor = await fetch(`${base}/engine/jobs`);
  const workerCookie = supervisor.headers.get('set-cookie')!.split(';')[0]!;
  const setup: MatchSetup = {
    roomCode: room.code,
    ownerPlayerId: room.ownerId,
    settings: { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
    seats: [
      { id: room.ownerId, nickname: '玩家', kind: 'human' },
      { id: 'bot-test', nickname: 'AI', kind: 'bot' },
    ],
    aiPolicy: 'strongest-native',
  };
  const started = engine.start(setup);
  void started.catch(() => {});
  const id = engine.matchId(room.code)!;
  const socket = (role: string, cookie = '', origin = base) =>
    new WebSocket(`${base.replace('http:', 'ws:')}/engine/socket/${id}/${role}`, {
      origin,
      headers: { Cookie: cookie },
    });
  return { base, engine, party, id, room, ownerCookie, workerCookie, started, socket };
}

test('引擎网关：玩家与规则宿主会话分离，拒绝陌生会话、跨源与越权操作', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await fetch(`${f.base}/engine/setup/${f.id}?role=worker`, {
        headers: { Cookie: f.ownerCookie },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(`${f.base}/engine/player/${f.id}`)).status, 403);
  for (const [role, cookie, origin] of [
    ['player', '', f.base],
    ['worker', f.ownerCookie, f.base],
    ['player', f.ownerCookie, 'http://example.invalid'],
  ]) {
    const denied = f.socket(role!, cookie, origin);
    denied.on('error', () => {});
    await new Promise<void>((resolve) => denied.once('error', () => resolve()));
  }
  const worker = f.socket('worker', f.workerCookie);
  await once(worker, 'open');
  const player = f.socket('player', f.ownerCookie);
  const connection = once(worker, 'message');
  await once(player, 'open');
  const connected = JSON.parse((await connection)[0].toString());
  assert.equal(connected.type, 'connect');
  assert.equal(connected.id, f.room.ownerId);
  const forwarded = once(worker, 'message');
  player.send(JSON.stringify(['init', 'native-version', { id: 'forged-other-seat' }]));
  const message = JSON.parse((await forwarded)[0].toString());
  assert.equal(message.id, f.room.ownerId);
  worker.send(JSON.stringify({ type: 'started' }));
  await f.started;
  const closed = once(player, 'close');
  player.send(JSON.stringify(['cardPile']));
  assert.equal((await closed)[0], 1008);
  worker.close();
});

test('引擎网关：房间之间不能读取对局设置或使用其他房间的套接字', async (t) => {
  const f = await fixture(t);
  const created = await fetch(`${f.base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '另一房主' }),
  });
  const otherCookie = created.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal(
    (
      await fetch(`${f.base}/engine/setup/${f.id}?role=player`, {
        headers: { Cookie: otherCookie },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(`${f.base}/engine/core/%2e%2e%5c%2e%2e%5c.env`)).status, 400);
  assert.equal(
    (await fetch(`${f.base}/engine/fs/writeFile?fileName=game/config.json`)).status,
    403,
  );
});

test('静态引擎资源可压缩和重新验证，私有设置始终禁止缓存', async (t) => {
  const f = await fixture(t);
  const first = await fetch(`${f.base}/engine/runtime/bootstrap.js`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-encoding'), 'gzip');
  assert.match(first.headers.get('cache-control')!, /must-revalidate/);
  const again = await fetch(`${f.base}/engine/runtime/bootstrap.js`, {
    headers: { 'If-None-Match': first.headers.get('etag')! },
  });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), '');
  const brotli = await fetch(`${f.base}/engine/runtime/bootstrap.js`, {
    headers: { 'Accept-Encoding': 'br, gzip' },
  });
  assert.equal(brotli.headers.get('content-encoding'), 'br');
  assert.equal(brotli.headers.get('etag'), first.headers.get('etag'));
  assert.equal(await brotli.text(), await first.text());
  const plain = await fetch(`${f.base}/engine/runtime/bootstrap.js`, {
    headers: { 'Accept-Encoding': 'br;q=0, gzip;q=0' },
  });
  assert.equal(plain.headers.get('content-encoding'), null);
  const setup = await fetch(`${f.base}/engine/setup/${f.id}?role=player`, {
    headers: { Cookie: f.ownerCookie },
  });
  assert.equal(setup.headers.get('cache-control'), 'no-store');
  assert.equal(setup.headers.get('etag'), null);
  const settings = await setup.json();
  const pinned = await fetch(`${f.base}${settings.assetBase}card/standard.js`);
  assert.match(pinned.headers.get('cache-control')!, /immutable/);
  assert.equal(
    (await fetch(`${f.base}/engine/core/${'0'.repeat(40)}/card/standard.js`)).status,
    404,
  );
  const denied = await fetch(`${f.base}/engine/setup/${f.id}?role=player`, {
    headers: { 'If-None-Match': first.headers.get('etag')! },
  });
  assert.equal(denied.status, 403);
});

test('电脑任务推送：仅本机建立宿主 cookie，任务变化立即推送，关闭连接正常清理', async (t) => {
  const f = await fixture(t);
  const denied = await fetch(`${f.base}/engine/jobs?transport=events`, {
    headers: { 'X-Party-Ingress': 'public' },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.has('set-cookie'), false);
  const stream = await fetch(`${f.base}/engine/jobs?transport=events`);
  assert.match(stream.headers.get('content-type')!, /text\/event-stream/);
  assert.match(stream.headers.get('set-cookie')!, /party_engine=.*HttpOnly/);
  const reader = stream.body!.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  assert(initial.includes(f.id));
  assert(!initial.includes('ownerPlayerId'));
  f.engine.release(f.room.code);
  const update = new TextDecoder().decode((await reader.read()).value);
  assert(update.includes('"jobs":[]'));
  await reader.cancel();
  assert.equal((await fetch(`${f.base}/engine/jobs`)).status, 200);
});

test('大厅预加载清单仅有固定公共素材，武将档切换补齐定义，缩略图使用独立内容哈希', async (t) => {
  const f = await fixture(t);
  const beginner = await (await fetch(`${f.base}/engine/preload`)).json();
  const advanced = await (await fetch(`${f.base}/engine/preload?preset=advanced&mode=duel`)).json();
  assert(advanced.assets.length > beginner.assets.length);
  assert(
    beginner.assets.every((url: string) =>
      /^\/engine\/(core\/[a-f0-9]{40}\/|bundle\/noname-[a-f0-9]{64}\.js$)/.test(url),
    ),
  );
  assert(!JSON.stringify(advanced).includes('token'));
  assert(!JSON.stringify(advanced).includes('/setup/'));
  assert(advanced.assets.some((url: string) => url.endsWith('/character/tw.js')));
  const statuses = await Promise.all(
    advanced.assets.map(async (url: string) => ({
      url,
      status: (await fetch(f.base + url, { method: 'HEAD' })).status,
    })),
  );
  assert.deepEqual(
    statuses.filter((item: { status: number }) => item.status !== 200),
    [],
  );
  assert.equal((await fetch(`${f.base}/engine/preload?preset=other`)).status, 400);
  const setup = await (
    await fetch(`${f.base}/engine/setup/${f.id}?role=player`, {
      headers: { Cookie: f.ownerCookie },
    })
  ).json();
  assert.equal(Object.keys(setup.mobilePortraits).length, 189);
  const image = await fetch(f.base + Object.values(setup.mobilePortraits)[0]);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.match(image.headers.get('cache-control')!, /immutable/);
  assert.equal(
    Buffer.from(await image.arrayBuffer())
      .subarray(0, 4)
      .toString(),
    'RIFF',
  );
});

test('HTTP 对局备用通道：每次请求认证，私有消息有序重取，重复动作仅转发一次', async (t) => {
  const f = await fixture(t);
  const worker = f.socket('worker', f.workerCookie);
  await once(worker, 'open');
  t.after(() => worker.terminate());
  const channel = randomUUID();
  const path = `${f.base}/engine/poll/${f.id}`;
  const request = (
    method: string,
    body?: unknown,
    query = `?channel=${channel}`,
    cookie = f.ownerCookie,
    origin = f.base,
  ) =>
    fetch(path + query, {
      method,
      headers: { cookie, origin, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  assert.equal((await request('POST', { open: true, channel }, '', '')).status, 403);
  assert.equal(
    (await request('POST', { open: true, channel }, '', f.ownerCookie, 'http://other.invalid'))
      .status,
    403,
  );
  const connect = once(worker, 'message');
  assert.equal((await request('POST', { open: true, channel }, '')).status, 200);
  assert.equal(JSON.parse((await connect)[0].toString()).id, f.room.ownerId);
  let forwarded = 0;
  worker.on('message', (raw) => {
    if (JSON.parse(raw.toString()).type === 'message') forwarded++;
  });
  const action = { sequence: 1, data: JSON.stringify(['init', 'version', { id: 'forged-seat' }]) };
  const received = once(worker, 'message');
  assert.equal((await request('POST', action)).status, 200);
  assert.equal(JSON.parse((await received)[0].toString()).id, f.room.ownerId);
  assert.equal((await request('POST', action)).status, 200);
  assert.equal(forwarded, 1);
  const privateData = JSON.stringify(['private-fixture', 'only this seat']);
  worker.send(JSON.stringify({ type: 'send', id: f.room.ownerId, data: privateData }));
  const read = await (await request('GET', undefined, `?channel=${channel}&after=0`)).json();
  assert.deepEqual(
    read.messages.map(({ sequence, data }: { sequence: number; data: string }) => ({
      sequence,
      data,
    })),
    [{ sequence: 1, data: privateData }],
  );
  assert(read.serverTime >= read.messages[0].sentAt);
  assert.deepEqual(
    (await (await request('GET', undefined, `?channel=${channel}&after=0`)).json()).messages,
    read.messages,
  );
  assert.equal((await request('GET', undefined, `?channel=${channel}&after=0`, '')).status, 403);
  assert.equal((await request('GET', undefined, `?channel=${channel}&after=99`)).status, 400);
  assert.equal((await request('POST', { sequence: 3, data: action.data })).status, 409);
  assert.equal(
    (await request('POST', { sequence: 2, data: JSON.stringify(['cardPile']) })).status,
    403,
  );
  assert.equal(
    (await (await request('GET', undefined, `?channel=${channel}&after=1`)).json()).code,
    1008,
  );
  assert.equal(forwarded, 1);
});

test('HTTP 同一动作的相邻帧合批，保留重取与确认的顺序', async (t) => {
  const channel = new PollChannel(randomUUID(), 'one-seat', () => {});
  let connected!: () => void;
  const pending = new Promise<void>((resolve) => {
    connected = resolve;
  });
  const server = createServer((request, response) => {
    channel.read(
      Number(new URL(request.url!, 'http://localhost').searchParams.get('after') ?? 0),
      response,
    );
    connected();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    channel.close();
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const read = fetch(url);
  await pending;
  channel.send('first');
  await new Promise((resolve) => setTimeout(resolve, 2));
  channel.send('second');
  const result = await (await read).json();
  assert.deepEqual(
    result.messages.map((message: { data: string }) => message.data),
    ['first', 'second'],
  );
  assert.deepEqual((await (await fetch(url + '?after=0')).json()).messages, result.messages);
  channel.send('third');
  const acknowledged = await (await fetch(url + '?after=2')).json();
  assert.deepEqual(
    acknowledged.messages.map((message: { sequence: number }) => message.sequence),
    [3],
  );
});

test('局域网桥接保持逐席认证、跨房间隔离和动作去重，授权只交给本机宿主', async (t) => {
  const f = await fixture(t);
  const headers = { Cookie: f.ownerCookie, 'Content-Type': 'application/json' };
  const create = () =>
    fetch(`${f.base}/engine/lan/${f.room.code}/offer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'offer', sdp: 'v=0\r\n' }),
    });
  assert.equal(
    (
      await fetch(`${f.base}/engine/lan/${f.room.code}/offer`, {
        method: 'POST',
        body: JSON.stringify({ type: 'offer', sdp: 'v=0\r\n' }),
      })
    ).status,
    403,
  );
  const { id } = await (await create()).json();
  const offers = await (await fetch(`${f.base}/engine/jobs`)).json();
  const offer = offers.lanOffers.find((item: { id: string }) => item.id === id);
  assert(offer.key);
  assert(!JSON.stringify(offers).includes(f.ownerCookie.split('=')[1]!));
  assert(!JSON.stringify(await (await fetch(`${f.base}/api/info`)).json()).includes(offer.key));
  const another = await fetch(`${f.base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '另一桌' }),
  });
  const otherCookie = another.headers.get('set-cookie')!.split(';')[0]!;
  const other = (await another.json()).room;
  assert.equal(
    (await fetch(`${f.base}/engine/lan/${id}`, { headers: { Cookie: otherCookie } })).status,
    403,
  );
  const answer = `${f.base}/engine/lan/${id}/answer`;
  const body = JSON.stringify({ type: 'answer', sdp: 'v=0\r\n' });
  assert.equal((await fetch(answer, { method: 'POST', headers, body })).status, 403);
  assert.equal(
    (
      await fetch(answer, {
        method: 'POST',
        headers: { ...headers, Cookie: f.workerCookie, 'X-Party-Ingress': 'public' },
        body,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(answer, {
        method: 'POST',
        headers: { ...headers, Cookie: f.workerCookie },
        body,
      })
    ).status,
    200,
  );
  const answerView = await (await fetch(`${f.base}/engine/lan/${id}`, { headers })).json();
  assert.equal(answerView.answer.type, 'answer');
  assert(!JSON.stringify(answerView).includes(offer.key));
  const relayHeaders = {
    Cookie: f.workerCookie,
    'X-Party-Relay': offer.key,
    'Content-Type': 'application/json',
  };
  const worker = f.socket('worker', f.workerCookie);
  await once(worker, 'open');
  t.after(() => worker.terminate());
  const channel = randomUUID();
  const poll = `${f.base}/engine/poll/${f.id}`;
  const connect = once(worker, 'message');
  assert.equal(
    (
      await fetch(poll, {
        method: 'POST',
        headers: relayHeaders,
        body: JSON.stringify({ open: true, channel }),
      })
    ).status,
    200,
  );
  assert.equal(JSON.parse((await connect)[0].toString()).id, f.room.ownerId);
  let received = 0;
  worker.on('message', (raw) => {
    if (JSON.parse(raw.toString()).type === 'message') received++;
  });
  const action = JSON.stringify({ sequence: 1, data: JSON.stringify(['init', 'version']) });
  const forwarded = once(worker, 'message');
  assert.equal(
    (
      await fetch(`${poll}?channel=${channel}`, {
        method: 'POST',
        headers: relayHeaders,
        body: action,
      })
    ).status,
    200,
  );
  await forwarded;
  assert.equal(
    (await fetch(`${poll}?channel=${channel}`, { method: 'POST', headers, body: action })).status,
    200,
  );
  assert.equal(received, 1, '切回公网重试同一动作只转发一次');
  assert.equal(
    (
      await fetch(`${poll}?channel=${channel}&after=0`, {
        headers: { ...relayHeaders, 'X-Party-Ingress': 'public' },
      })
    ).status,
    403,
  );
  worker.send(JSON.stringify({ type: 'send', id: f.room.ownerId, data: 'seat-only-message' }));
  const messages = await (
    await fetch(`${poll}?channel=${channel}&after=0`, { headers: relayHeaders })
  ).json();
  assert.deepEqual(
    messages.messages.map((item: { data: string }) => item.data),
    ['seat-only-message'],
  );
  const pending = f.engine.start({
    roomCode: other.code,
    ownerPlayerId: other.ownerId,
    settings: { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
    seats: [
      { id: other.ownerId, nickname: '另一桌', kind: 'human' },
      { id: 'other-bot', nickname: 'AI', kind: 'bot' },
    ],
    aiPolicy: 'strongest-native',
  });
  void pending.catch(() => {});
  const otherId = f.engine.matchId(other.code)!;
  assert.equal(
    (
      await fetch(`${f.base}/engine/poll/${otherId}`, {
        method: 'POST',
        headers: relayHeaders,
        body: JSON.stringify({ open: true, channel: randomUUID() }),
      })
    ).status,
    403,
  );
  await fetch(`${f.base}/api/rooms/${f.room.code}/me`, { method: 'DELETE', headers });
  assert.equal(
    (await fetch(`${f.base}/engine/lan/${id}/ping`, { headers: relayHeaders })).status,
    403,
  );
});
