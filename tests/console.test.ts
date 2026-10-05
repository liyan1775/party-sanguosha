import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createPartyServer } from '../apps/server/src/server.js';
import { RoomStore } from '../apps/server/src/room.js';
import type { EngineAdapter } from '../packages/noname-adapter/src/index.js';
import { createPublicGateway } from '../apps/server/src/public-gateway.js';
import { request } from 'node:http';

test('电脑控制台：独立本机会话、全部房间、等待席位交接、关闭与过期点击保护', async (t) => {
  const party = createPartyServer({
    port: 0,
    webRoot: fileURLToPath(new URL('../apps/web/', import.meta.url)),
  });
  party.server.listen(0, '127.0.0.1');
  await once(party.server, 'listening');
  const address = party.server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => {
    party.stop();
    party.server.closeAllConnections();
  });
  const operator = await fetch(base + '/server');
  const consoleCookie = operator.headers.get('set-cookie')!.split(';')[0]!;
  assert.match(consoleCookie, /^party_console=/);
  assert(!consoleCookie.includes(party.controlToken));
  assert.equal((await fetch(base + '/api/me', { headers: { Cookie: consoleCookie } })).status, 200);
  assert.deepEqual(
    await (await fetch(base + '/api/me', { headers: { Cookie: consoleCookie } })).json(),
    { playerId: null, roomCode: null },
  );
  const first = party.lobby.create('<img src=x onerror=alert(1)>'.slice(0, 16));
  const second = party.lobby.create('第二桌');
  const member = party.lobby.join(first.room.code, '朋友');
  const read = await fetch(base + '/api/console', { headers: { Cookie: consoleCookie } });
  assert.equal(read.status, 200);
  const data = await read.json();
  assert.equal(data.rooms.length, 2);
  assert(!JSON.stringify(data).includes(first.token));
  assert(!JSON.stringify(data).includes(party.controlToken));
  assert.equal((await fetch(base + '/api/console')).status, 403);
  assert.equal(
    (await fetch(base + '/api/console', { headers: { Cookie: `party_player=${first.token}` } }))
      .status,
    403,
  );
  assert.equal(
    await new Promise<number | undefined>((resolve) => {
      const probe = request(
        base + '/api/console',
        { headers: { Cookie: consoleCookie, Host: 'attacker.invalid' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      probe.end();
    }),
    403,
  );
  assert.equal(
    (
      await fetch(base + '/api/console', {
        headers: { Cookie: consoleCookie, 'X-Party-Ingress': 'public' },
      })
    ).status,
    403,
  );
  const command = (path: string, revision: number, headers = {}) =>
    fetch(base + path, {
      method: 'DELETE',
      headers: { Cookie: consoleCookie, 'X-Party-Revision': String(revision), ...headers },
    });
  assert.equal((await command(`/api/console/rooms/${first.room.code}`, 0)).status, 409);
  assert.equal(
    (
      await command(`/api/console/rooms/${first.room.code}`, first.room.snapshot().revision, {
        Origin: 'http://attacker.invalid',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await command(
        `/api/console/rooms/${first.room.code}/players/${first.playerId}`,
        first.room.snapshot().revision,
      )
    ).status,
    200,
  );
  assert.equal(first.room.snapshot().ownerId, member.playerId);
  assert.equal(second.room.snapshot().ownerId, second.playerId);
  // The computer still cannot use ordinary player-owner endpoints.
  assert.equal(
    (
      await fetch(`${base}/api/rooms/${second.room.code}/bots`, {
        method: 'POST',
        headers: { Cookie: consoleCookie, 'Content-Type': 'application/json' },
        body: '{"count":1}',
      })
    ).status,
    403,
  );
  assert.equal(
    (await command(`/api/console/rooms/${first.room.code}`, first.room.snapshot().revision)).status,
    200,
  );
  assert.throws(() => party.lobby.get(first.room.code));
  assert.equal(party.lobby.list().length, 1);

  const gateway = createPublicGateway(address.port);
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  t.after(gateway.close);
  const ingress = gateway.server.address();
  assert(ingress && typeof ingress === 'object');
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${ingress.port}/api/console`, {
        headers: { Cookie: consoleCookie },
      })
    ).status,
    403,
  );
});

test('控制台结束开局：迟到的引擎确认或失败不能复活房间，也不影响另一桌', async () => {
  let rejectStart!: (error: Error) => void;
  const engine: EngineAdapter = {
    status: () => ({ id: 'noname', ready: true, message: '测试适配器' }),
    start: () =>
      new Promise((_resolve, reject) => {
        rejectStart = reject;
      }),
    release: () => rejectStart(new Error('released')),
  };
  for (const operation of ['reset', 'close']) {
    const room = new RoomStore(engine);
    const owner = room.join('房主');
    room.updateSettings(
      { mode: 'duel', playerCount: 2, generalPreset: 'beginner', extensions: [] },
      owner.token,
    );
    room.addBots(1, owner.token);
    const disconnect = room.connect(owner.token);
    room.setReady(owner.token, true);
    const starting = room.start(owner.token);
    if (operation === 'reset') room.consoleReset();
    else room.consoleClose();
    await assert.rejects(starting, /电脑控制台/);
    assert.equal(room.snapshot().phase, operation === 'reset' ? 'waiting' : 'closed');
    assert.equal(room.snapshot().players.length, operation === 'reset' ? 2 : 0);
    if (operation === 'reset')
      assert.equal(
        room.snapshot().players.find((player) => player.id === owner.playerId)?.ready,
        false,
      );
    disconnect();
  }
});
