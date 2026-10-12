import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';

function globals(t: TestContext, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => {
      if (before) Object.defineProperty(globalThis, key, before);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}
async function runtime(name: string) {
  const source = (
    await readFile(
      new URL(`../packages/noname-adapter/runtime/${name}.js`, import.meta.url),
      'utf8',
    )
  ).replace(/import \{([^}]+)\} from 'noname';/, 'const {$1} = globalThis.nativeFixture;');
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`
  );
}
function clock(t: TestContext) {
  let now = 100000;
  let sequence = 0;
  const tasks = new Map<number, { fn: () => void; at: number }>();
  t.mock.method(Date, 'now', () => now);
  globals(t, {
    setTimeout: (fn: () => void, delay: number) => {
      const id = ++sequence;
      tasks.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout: (id: number) => tasks.delete(id),
  });
  return {
    advance(ms: number) {
      now += ms;
      for (const [id, task] of tasks)
        if (task.at <= now) {
          tasks.delete(id);
          task.fn();
        }
    },
    tasks,
  };
}

test('短断线保留原生等待与客户端，20秒后离线；重连与强制关闭不会留下旧计时器', async (t) => {
  const timer = clock(t);
  const sent: unknown[][] = [];
  let closed = 0;
  const socket: any = {
    handlers: {
      close: () => {
        closed++;
        client.closed = true;
      },
    },
    send: (value: string) => sent.push(JSON.parse(value)),
  };
  const client: any = {
    id: 'one',
    ws: socket,
    closed: false,
    send: (...values: unknown[]) => sent.push(values),
  };
  const player: any = { ws: client, nickname: '甲', setNickname: () => {}, isAuto: false };
  const deadline = { original: true };
  const lib: any = {
    node: { clients: [client], torespondtimeout: { one: deadline } },
    playerOL: { one: player },
    message: {
      server: {
        reinited() {},
        auto() {
          player.isAuto = true;
        },
        unauto() {
          player.isAuto = false;
        },
      },
    },
  };
  globals(t, {
    nativeFixture: { lib, game: { broadcast() {} }, ui: {}, _status: {} },
    partyEngine: { setup: { role: 'worker' } },
  });
  const recovery = (await runtime('connection-recovery')).installConnectionRecovery();
  recovery.disconnect(socket);
  timer.advance(19999);
  assert.equal(closed, 0);
  assert.equal(lib.node.torespondtimeout.one, deadline);
  assert.equal(recovery.resume(socket), true);
  assert.equal(timer.tasks.size, 0);
  lib.message.server.reinited.call(client);
  const restored = sent.at(-1)![1] as any;
  assert.equal(restored.recovered, true);
  assert.equal(restored.offline, false);
  assert.equal(restored.awaySeconds, 19);
  recovery.disconnect(socket);
  timer.advance(20000);
  assert.equal(closed, 1);
  assert.equal(recovery.resume(socket), false);
  lib.message.server.reinited.call(client);
  assert.equal((sent.at(-1)![1] as any).offline, true);
  client.closed = false;
  recovery.disconnect(socket);
  recovery.close(socket);
  recovery.close(socket);
  timer.advance(30000);
  assert.equal(closed, 1, 'a stale transport cannot close its rejoined seat again');
  assert.equal(timer.tasks.size, 0);
  const freshSocket = { ...socket };
  client.ws = freshSocket;
  client.closed = false;
  recovery.disconnect(freshSocket);
  recovery.close(freshSocket);
  recovery.close(freshSocket);
  timer.advance(30000);
  assert.equal(closed, 2, 'forced close runs once and cancels its delayed duplicate');
  assert.equal(timer.tasks.size, 0);
  lib.message.server.auto.call(client);
  assert.equal((sent.at(-1)![1] as any).auto, true);
  lib.message.server.unauto.call(client);
  assert.equal((sent.at(-1)![1] as any).auto, false);
});

test('手气卡只操作本人起手牌：3次上限、旧消息去重、同席刷新原期限、AI与牌总数保持', async (t) => {
  const timer = clock(t);
  const pile: any[] = [];
  function card(id: string) {
    return {
      id,
      removeGaintag() {},
      clearKnowers() {},
      fix() {},
      remove() {
        for (const player of players)
          player.hand = player.hand.filter((item: any) => item !== this);
      },
    };
  }
  const addressed: { id: string; values: any[] }[] = [];
  const player = (id: string, count: number) => ({
    playerid: id,
    ws: {} as any,
    hand: Array.from({ length: count }, (_, i) => card(`${id}-${i}`)),
    getCards() {
      return this.hand.slice();
    },
    directgain(cards: any[]) {
      this.hand.push(...cards);
    },
    update() {},
    send(...values: any[]) {
      addressed.push({ id, values });
    },
  });
  const players = [player('one', 4), player('two', 5), player('bot', 4)] as const;
  for (let i = 0; i < 40; i++) pile.push(card(`pile-${i}`));
  const client = { id: 'one' };
  players[0].ws = client;
  const lib: any = {
    playerOL: Object.fromEntries(players.map((player) => [player.playerid, player])),
    message: { server: { reinited() {} } },
  };
  globals(t, {
    partyEngine: {
      setup: {
        role: 'worker',
        seats: players.map((player) => ({
          id: player.playerid,
          kind: player.playerid === 'bot' ? 'bot' : 'human',
        })),
      },
    },
    nativeFixture: {
      lib,
      game: { players, broadcastAll: (fn: Function, ...args: any[]) => fn(...args) },
      ui: {
        cardPile: {
          childNodes: pile,
          insertBefore(card: any, before: any) {
            const at = pile.indexOf(before);
            pile.splice(at < 0 ? pile.length : at, 0, card);
          },
        },
      },
      get: { id: () => 'epoch', cards: (count: number) => pile.splice(0, count), rand: () => 0 },
    },
  });
  const run = (await runtime('luck-cards')).installLuckCards();
  const done = run();
  const state = () => addressed.filter((packet) => packet.id === 'one').at(-1)!.values[1];
  assert.equal(state().remaining, 3);
  assert.equal(
    addressed.some((packet) => packet.id === 'bot'),
    false,
  );
  const originalBot = players[2].hand.slice();
  lib.message.server.partyLuck.call({ id: 'one' }, 'epoch', 0, 'refresh');
  assert.equal(state().remaining, 3, 'replaced client has no authority');
  lib.message.server.partyLuck.call(client, 'epoch', 0, 'refresh');
  assert.equal(state().remaining, 2);
  const afterFirst = players[0].hand.slice();
  lib.message.server.partyLuck.call(client, 'epoch', 0, 'refresh');
  assert.deepEqual(players[0].hand, afterFirst, 'replayed revision cannot draw twice');
  timer.advance(5000);
  lib.message.server.reinited.call(client);
  assert.equal(state().remaining, 2);
  assert.equal(state().remainingMs, 25000, 'refresh does not renew the 30-second deadline');
  for (const revision of [1, 2])
    lib.message.server.partyLuck.call(client, 'epoch', revision, 'refresh');
  assert.equal(state().remaining, 0);
  assert.equal(state().done, true);
  const finalHand = players[0].hand.slice();
  lib.message.server.partyLuck.call(client, 'epoch', 3, 'refresh');
  assert.deepEqual(players[0].hand, finalHand);
  assert.equal(players[0].hand.length, 4);
  assert.equal(players[1].hand.length, 5, '2v2 compensation is retained');
  assert.deepEqual(players[2].hand, originalBot);
  assert.equal(pile.length + players.reduce((sum, player) => sum + player.hand.length, 0), 53);
  assert.equal(new Set([...pile, ...players.flatMap((player) => player.hand)]).size, 53);
  assert(
    addressed.every((packet) => !JSON.stringify(packet.values[1]).includes('pile-')),
    'control state has no hand faces or deck data',
  );
  timer.advance(25000);
  await done;
  assert.equal(state().active, false);
  lib.message.server.partyLuck.call(client, 'epoch', 3, 'refresh');
  assert.deepEqual(players[0].hand, finalHand, 'no refresh after the first-turn boundary');
});

test('牌桌心跳只由同通道原生回复完成；网页健康与普通帧不能伪装成恢复', async (t) => {
  const timer = clock(t);
  const messages: any[] = [];
  globals(t, {
    partyEngine: { setup: { id: 'match', connectionRecovery: true } },
    WebSocket: class {},
    window: Object.assign(new EventTarget(), {
      parent: { postMessage: (packet: any) => messages.push(packet) },
    }),
    document: Object.assign(new EventTarget(), { hidden: false }),
    location: { origin: 'http://fixture' },
    sessionStorage: { getItem: () => null },
    CloseEvent: class extends Event {},
    fetch: async () => {
      throw new Error('health must not be used');
    },
  });
  const { PlayerTransport } = await runtime('player-transport');
  const socket = new PlayerTransport('ws://fixture/engine/socket/match/player');
  socket.start = () => {};
  socket.readyState = 1;
  socket.socket = { send: (value: string) => messages.push(JSON.parse(value)), close() {} };
  t.after(() => socket.finish(1000, ''));
  const probe = socket.probe();
  const id = messages.at(-1)[1];
  let completed = false;
  void probe.then(() => (completed = true));
  socket.deliver('["partyPong",999]');
  socket.deliver('["normal"]');
  await Promise.resolve();
  assert.equal(completed, false);
  socket.deliver(JSON.stringify(['partyPong', id]));
  await probe;
  assert.equal(socket.nativeProbes.size, 0);
  socket.polling = true;
  socket.request = async () => ({});
  socket.reportNetwork(undefined, true);
  const notices = messages.filter((packet) => packet.type === 'party-network').length;
  socket.outgoing.push({ sequence: 1, data: '["partyPing",2]', bytes: 15 });
  socket.outgoingBytes = 15;
  await socket.drainActions();
  assert.equal(
    messages.filter((packet) => packet.type === 'party-network').length,
    notices,
    'an HTTP action ACK is not proof that the native executor replied',
  );
  const unavailable = socket.probe();
  const rejection = assert.rejects(unavailable, /无响应/);
  timer.advance(8000);
  await rejection;
  assert.equal(socket.nativeProbes.size, 0);
});
