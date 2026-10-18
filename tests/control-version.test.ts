import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('人工／AI切换递增私有控制版本；旧结果及旧连接不能提交，合法新版本结果去标记后交原生', async (t) => {
  let accepted = 0;
  let last: any;
  const sent: any[] = [];
  const restoreOrder: string[] = [];
  const client = {
    id: 'role-ai',
    closed: false,
    send(_fn: unknown, value: unknown) {
      sent.push(value);
      restoreOrder.push('version');
    },
  };
  const player = { ws: client, isAuto: false };
  const lib: any = {
    playerOL: { 'role-ai': player },
    message: {
      server: {
        reinited() {
          restoreOrder.push('choice-replay');
        },
        auto() {
          player.isAuto = true;
        },
        unauto() {
          player.isAuto = false;
        },
        result(value: unknown) {
          accepted++;
          last = value;
        },
        tempResult(value: unknown) {
          accepted++;
          last = value;
        },
      },
    },
    node: { clients: [] },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'nativeControlFixture');
  const engineOriginal = Object.getOwnPropertyDescriptor(globalThis, 'partyEngine');
  Object.defineProperty(globalThis, 'nativeControlFixture', {
    value: { lib, game: {}, ui: {}, _status: {} },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'partyEngine', {
    value: { setup: { role: 'worker', controlVersions: true } },
    configurable: true,
  });
  t.after(() => {
    for (const [key, value] of [
      ['nativeControlFixture', original],
      ['partyEngine', engineOriginal],
    ] as const) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const source = (
    await readFile(
      new URL('../packages/noname-adapter/runtime/connection-recovery.js', import.meta.url),
      'utf8',
    )
  ).replace(/import \{([^}]+)\} from 'noname';/, 'const {$1}=globalThis.nativeControlFixture;');
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  module.installConnectionRecovery();
  const submit = (version: number, result: unknown) => ({
    partyControlVersion: version,
    partyNativeResult: result,
  });
  lib.message.server.result.call(client, submit(0, { bool: true }));
  assert.equal(accepted, 1);
  assert.deepEqual(last, { bool: true });
  lib.message.server.auto.call(client);
  assert.equal(sent.at(-1).controlVersion, 1);
  lib.message.server.result.call(client, submit(0, { bool: true }));
  assert.equal(accepted, 1);
  lib.message.server.unauto.call(client);
  assert.equal(sent.at(-1).controlVersion, 2);
  lib.message.server.tempResult.call(client, submit(1, { bool: true }));
  assert.equal(accepted, 1);
  lib.message.server.result.call({ id: 'role-ai', closed: false }, submit(2, { bool: true }));
  assert.equal(accepted, 1);
  lib.message.server.result.call(client, submit(2, { bool: true }));
  assert.equal(accepted, 2);
  assert.deepEqual(last, { bool: true });
  lib.message.server.result.call(client, submit(2, 'ai'));
  assert.equal(accepted, 3);
  assert.equal(last, 'ai');
  lib.message.server.tempResult.call(client, submit(2, ['general', 'choice']));
  assert.equal(accepted, 4);
  assert.deepEqual(last, ['general', 'choice']);
  lib.message.server.tempResult.call(client, submit(2, 'general'));
  assert.equal(accepted, 5);
  assert.equal(last, 'general');
  restoreOrder.length = 0;
  lib.message.server.reinited.call(client);
  assert.deepEqual(restoreOrder, ['version', 'choice-replay']);
  assert.equal(sent.at(-1).controlVersion, 2);
});

test('手机立即标记托管切换后的选择；迟到确认不倒退版本，原生字符串及数组保持形状', async (t) => {
  const sent: any[][] = [];
  const game = { send: (...args: any[]) => sent.push(args) };
  const engine: any = { setup: { role: 'player', id: 'match', controlVersions: true } };
  const values = {
    nativeControlFixture: { lib: {}, game, ui: {}, _status: {} },
    partyEngine: engine,
    window: { addEventListener() {}, parent: { postMessage() {} } },
    location: { origin: 'https://fixture.invalid' },
  };
  const originals = Object.fromEntries(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const source = (
    await readFile(
      new URL('../packages/noname-adapter/runtime/connection-recovery.js', import.meta.url),
      'utf8',
    )
  ).replace(/import \{([^}]+)\} from 'noname';/, 'const {$1}=globalThis.nativeControlFixture;');
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#player`
  );
  module.installConnectionRecovery();
  game.send('auto');
  game.send('result', 'ai');
  game.send('unauto');
  engine.showControlState({ controlVersion: 1 });
  game.send('tempResult', ['general', 'choice']);
  assert.deepEqual(sent, [
    ['auto'],
    ['result', { partyControlVersion: 1, partyNativeResult: 'ai' }],
    ['unauto'],
    ['tempResult', { partyControlVersion: 2, partyNativeResult: ['general', 'choice'] }],
  ]);
});
