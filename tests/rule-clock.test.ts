import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { setTimeout as wait } from 'node:timers/promises';
import { RuleClock } from '../packages/noname-adapter/src/rule-clock.js';

test('同一规则实例恢复计时：保留原期限，到期单次回调不丢失，断线期间取消仍有效', async (t) => {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let clock: RuleClock | undefined;
  wss.on('connection', (socket) => {
    if (clock) clock.bind(socket);
    else clock = new RuleClock(socket, true);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  t.after(() => {
    clock?.close();
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    server.close();
  });
  const url = `ws://127.0.0.1:${address.port}`;
  const first = new WebSocket(url);
  await once(first, 'open');
  first.send(JSON.stringify({ type: 'schedule', id: -1, delay: 60, repeat: false }));
  first.send(JSON.stringify({ type: 'schedule', id: -2, delay: 500, repeat: false }));
  await wait(20);
  const closed = once(first, 'close');
  first.terminate();
  await closed;
  await wait(80);
  const resumed = new WebSocket(url);
  const events: number[] = [];
  resumed.on('message', (bytes) => events.push(JSON.parse(bytes.toString()).id));
  await once(resumed, 'open');
  resumed.send(JSON.stringify({ type: 'cancel', id: -2 }));
  await wait(550);
  assert.deepEqual(
    events,
    [-1],
    'expired callback is delivered once; cancelled callback does not fire',
  );
});

test('计时帧已发出但确认丢失：同实例重取不丢回调、不重复执行，确认后不再重放', async (t) => {
  const source = await readFile(
    new URL('../packages/noname-adapter/runtime/rule-clock.js', import.meta.url),
    'utf8',
  );
  const { installRuleClock } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let authority: RuleClock | undefined;
  wss.on('connection', (socket) => {
    if (authority) authority.bind(socket);
    else authority = new RuleClock(socket, true);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  let current: WebSocket;
  let dropAcknowledgment = true;
  const received: number[] = [];
  const acknowledgments: number[] = [];
  class Relay extends EventTarget {
    send(data: string) {
      const packet = JSON.parse(data);
      if (packet.type === 'ack') {
        acknowledgments.push(packet.id);
        if (dropAcknowledgment) return;
      }
      current.send(data);
    }
  }
  const relay = new Relay();
  const connect = async () => {
    current = new WebSocket(`ws://127.0.0.1:${address.port}`);
    current.on('message', (data) => {
      received.push(JSON.parse(data.toString()).id);
      relay.dispatchEvent(new MessageEvent('message', { data: data.toString() }));
    });
    await once(current, 'open');
  };
  const target = {
    setTimeout: () => 1,
    setInterval: () => 2,
    clearTimeout: () => {},
    clearInterval: () => {},
    Function,
  } as any;
  await connect();
  const clock = installRuleClock(relay, target, true);
  t.after(() => {
    clock.close();
    authority?.close();
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    server.close();
  });
  let called = 0;
  const delivery = once(current!, 'message');
  const id = target.setTimeout(() => called++, 20);
  await delivery;
  assert.equal(called, 1);
  const interrupted = once(current!, 'close');
  current!.terminate();
  await interrupted;
  dropAcknowledgment = false;
  await connect();
  await wait(30);
  assert.deepEqual(received, [id, id]);
  assert.deepEqual(acknowledgments, [id, id]);
  assert.equal(called, 1, 'replayed single-shot IDs cannot invoke a callback twice');
  const closed = once(current!, 'close');
  current!.terminate();
  await closed;
  await connect();
  await wait(30);
  assert.deepEqual(received, [id, id], 'an acknowledged callback is released');
  assert.equal(clock.proof.fired, 1);
});

test('规则计时回调留在本房间：参数不传出、取消/重复消息/跨类型取消与退出清理', async () => {
  const source = await readFile(
    new URL('../packages/noname-adapter/runtime/rule-clock.js', import.meta.url),
    'utf8',
  );
  const { installRuleClock } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  class Socket extends EventTarget {
    sent: { type: string; id: number; delay?: number; repeat?: boolean }[] = [];
    send(data: string) {
      this.sent.push(JSON.parse(data));
    }
    fire(id: number) {
      this.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'clock', id }) }),
      );
    }
  }
  const socket = new Socket();
  const cleared: number[] = [];
  const original = {
    setTimeout: () => 1,
    setInterval: () => 2,
    clearTimeout: (id: number) => cleared.push(id),
    clearInterval: (id: number) => cleared.push(id),
    Function,
  };
  const target = { ...original } as any;
  const clock = installRuleClock(socket, target);
  let called = 0;
  const id = target.setTimeout(
    function (this: unknown, secret: string) {
      assert.equal(this, target);
      assert.equal(secret, 'private-choice');
      called++;
    },
    125.9,
    'private-choice',
  );
  assert.deepEqual(socket.sent[0], { type: 'schedule', id, delay: 125, repeat: false });
  assert(!JSON.stringify(socket.sent).includes('private-choice'));
  socket.fire(id);
  socket.fire(id);
  assert.equal(called, 1);
  const cancelled = target.setTimeout(() => called++, 200);
  target.clearInterval(String(cancelled));
  socket.fire(cancelled);
  assert.equal(called, 1);
  assert.deepEqual(socket.sent.at(-1), { type: 'cancel', id: cancelled });
  const interval = target.setInterval(() => called++, 250);
  socket.fire(interval);
  socket.fire(interval);
  assert.equal(called, 3);
  target.clearTimeout(interval);
  socket.fire(interval);
  assert.equal(called, 3);
  target.clearTimeout(17);
  assert(cleared.includes(17), 'preexisting browser timers still clear');
  const closing = target.setTimeout(() => called++, 1000);
  socket.dispatchEvent(new Event('close'));
  socket.fire(closing);
  assert.equal(called, 3);
  for (const name of ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'])
    assert.equal(target[name], original[name as keyof typeof original]);
  clock.close();
  assert.equal(clock.proof.source, 'local-service');
});

test('本机规则时钟按期限推送，取消、断线与无效请求不会留下计时器', async (t) => {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket) => new RuleClock(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  t.after(() => {
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    server.close();
  });
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  await once(socket, 'open');
  const packets: { type: string; id: number }[] = [];
  socket.on('message', (data) => packets.push(JSON.parse(data.toString())));
  const began = performance.now();
  const fired = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'schedule', id: -1, delay: 50, repeat: false }));
  assert.deepEqual(JSON.parse((await fired)[0].toString()), { type: 'clock', id: -1 });
  assert(performance.now() - began >= 45, 'cannot execute a choice before its original deadline');
  socket.send(JSON.stringify({ type: 'schedule', id: -2, delay: 40, repeat: false }));
  socket.send(JSON.stringify({ type: 'cancel', id: -2 }));
  socket.send(JSON.stringify({ type: 'schedule', id: -3, delay: 15, repeat: true }));
  await wait(80);
  assert(!packets.some((packet) => packet.id === -2));
  assert(packets.filter((packet) => packet.id === -3).length >= 2);
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'schedule', id: 4, delay: 0, repeat: false }));
  assert.equal((await closed)[0], 1008);
  const count = packets.length;
  await wait(40);
  assert.equal(packets.length, count);
});
