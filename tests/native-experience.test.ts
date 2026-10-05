import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as tick } from 'node:timers/promises';
import type { TestContext } from 'node:test';

function globals(t: TestContext, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
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

test('响应提示随原生事件发送；南蛮/万箭区分杀闪，乱武区分最近目标与额外出杀', async (t) => {
  let parent: { name: string };
  class Choice {
    prompt?: string;
    prompt2?: string;
    sets: [string, unknown][] = [];
    constructor(public name: string) {}
    getParent() {
      return parent;
    }
    set(key: string, value: unknown) {
      Reflect.set(this, key, value);
      this.sets.push([key, value]);
      return this;
    }
    send() {
      return this.sets;
    }
  }
  class Player {
    chooseToRespond() {
      const choice = new Choice('chooseToRespond');
      choice.prompt = '请打出一张牌';
      return choice;
    }
    chooseToUse() {
      const choice = new Choice('chooseToUse');
      choice.prompt = '乱武：使用一张【杀】或失去1点体力';
      return choice;
    }
    chooseUseTarget() {
      return new Choice('chooseUseTarget');
    }
  }
  globals(t, { nativeFixture: { lib: { element: { Player, GameEvent: Choice } } } });
  (await runtime('prompts')).installPrompts();
  const player = new Player();
  for (const [name, card] of [
    ['nanman', '杀'],
    ['wanjian', '闪'],
  ]) {
    parent = { name: name! };
    const event = player.chooseToRespond();
    assert(event.prompt?.includes(`【${card}】`));
    // Native filters are added after construction; serialization must still
    // include explicit text so remote reconstruction cannot revert to “牌”.
    assert(
      event
        .send()
        .some(([key, value]) => key === 'prompt' && String(value).includes(`【${card}】`)),
    );
  }
  parent = { name: 'reluanwu' };
  const forced = player.chooseToUse();
  assert.match(forced.prompt!, /距离最近.*失去1点体力/);
  assert.match(forced.prompt2!, /合法目标/);
  parent = { name: 'reluanwuContentAfter' };
  const extra = player.chooseUseTarget();
  assert.match(extra.prompt!, /视为使用.*无距离限制.*取消则跳过/);
  assert.match(extra.prompt2!, /无需提供手牌/);
  parent = { name: 'other-skill' };
  assert.equal(player.chooseToRespond().prompt, '请打出一张牌');
});

test('拼点在原生展示时才公开材料，选择阶段、其余暗牌及观星排序仍隐藏', async (t) => {
  let event: { name: string; getParent(): unknown; [key: string]: unknown } = {
    name: 'chooseToCompare',
    getParent: () => undefined,
  };
  const cards = ['first', 'second', 'private'].map((cardid) => ({
    cardid,
    position: 'o',
    isKnownBy: () => false,
  }));
  const get = {
    position: (card: (typeof cards)[number]) => card.position,
    owner: () => undefined,
    event: () => event,
    mode: () => 'duel',
    cardInfoOL: (card: (typeof cards)[number]) => `public:${card.cardid}`,
    cardInfo: (card: (typeof cards)[number]) => ['spade', 7, 'sha', '', card.cardid],
    stringifiedResult: (item: unknown) => item,
  };
  class Client {
    id = 'viewer';
    send(...values: (typeof cards)[number][]) {
      return values.map((card) => get.cardInfoOL(card));
    }
  }
  const client = new Client();
  class Player {
    send() {}
    $compare(card: (typeof cards)[number], _target: unknown, other: (typeof cards)[number]) {
      return client.send(card, other);
    }
    $compareMultiple(card: (typeof cards)[number], _targets: unknown, others: typeof cards) {
      return client.send(card, ...others);
    }
  }
  globals(t, {
    nativeFixture: {
      lib: {
        element: {
          Client,
          Player,
          Card: class {
            init() {}
          },
        },
        card: {},
        translate: {},
        playerOL: { viewer: {} },
      },
      get,
      _status: {},
    },
  });
  (await runtime('privacy')).installPrivacy();
  event.card1 = cards[0];
  event.card2 = cards[1];
  assert(client.send(...cards).every((value) => value.includes('party_unknown')));
  assert.deepEqual(new Player().$compare(cards[0]!, undefined, cards[1]!), [
    'public:first',
    'public:second',
  ]);
  assert(client.send(cards[2]!)[0]!.includes('party_unknown'));
  const comparison = event;
  event = { name: 'compareAfter', getParent: () => comparison };
  assert.deepEqual(client.send(cards[0]!), ['public:first']);
  event = { name: 'chooseToCompareMultiple', getParent: () => undefined };
  assert.deepEqual(new Player().$compareMultiple(cards[0]!, undefined, [cards[1]!]), [
    'public:first',
    'public:second',
  ]);
  event = { name: 'chooseToGuanxing', getParent: () => undefined };
  assert(client.send(...cards).every((value) => value.includes('party_unknown')));
});

test('慢音频过期后不补播，静音后再开启也不会复活旧语音，载入与后台保持安静', async (t) => {
  let now = 0;
  let finishRead!: (value: unknown) => void;
  let reads = 0;
  let starts = 0;
  const proof = { booted: false, audio: { dropped: 0, played: 0 } };
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: () => ({ pause() {} }),
  });
  class AudioContext {
    state = 'running';
    sampleRate = 48000;
    destination = {};
    async resume() {}
    async close() {}
    createBuffer() {
      return {};
    }
    async decodeAudioData() {
      return {};
    }
    createGain() {
      return {
        gain: { value: 0 },
        connect() {
          return this;
        },
        disconnect() {},
      };
    }
    createBufferSource() {
      return {
        buffer: {},
        onended: undefined as (() => void) | undefined,
        connect() {
          return this;
        },
        start() {
          starts++;
        },
        stop() {
          this.onended?.();
        },
      };
    }
  }
  const game = {} as { playAudio: (path: string) => void };
  const engine = {
    setup: { role: 'player', audioFiles: ['skill/test.mp3'] },
    proof,
    deliveryAge: 0,
    audio: undefined as
      { unlock(): Promise<void>; setEnabled(value: boolean): Promise<void> } | undefined,
  };
  globals(t, {
    window: Object.assign(new EventTarget(), { AudioContext }),
    document,
    parent: { postMessage() {} },
    location: { origin: 'http://fixture' },
    performance: { now: () => now },
    localStorage: { getItem: () => null, setItem() {} },
    nativeFixture: { lib: { assetURL: '/engine/core/', config: {} }, game },
    partyEngine: engine,
    fetch: () => {
      reads++;
      return new Promise((resolve) => {
        finishRead = resolve;
      });
    },
  });
  (await runtime('audio')).installAudio();
  await engine.audio!.unlock();
  game.playAudio('skill/test');
  assert.equal(reads, 0, 'boot replay does not fetch or play voices');
  proof.booted = true;
  game.playAudio('skill/test');
  await tick();
  now = 1700;
  finishRead({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  await tick();
  assert.equal(starts, 0, 'late voice is discarded');
  assert.equal(proof.audio.dropped, 2);
  game.playAudio('skill/test');
  await engine.audio!.setEnabled(false);
  await engine.audio!.setEnabled(true);
  await tick();
  assert.equal(starts, 0, 'mute invalidates unresolved playback');
  game.playAudio('skill/test');
  await tick();
  assert.equal(starts, 1, 'current cached voice still plays');
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  game.playAudio('skill/test');
  await tick();
  assert.equal(starts, 1);
  document.hidden = false;
  engine.deliveryAge = 5000;
  game.playAudio('skill/test');
  await tick();
  assert.equal(starts, 1, 'queued historical frames remain silent');
  assert.equal(reads, 1, 'decoded voices reuse their download');
});

test('HTTP 多帧分开浏览器任务，微任务先完成，重复帧不会执行两次', async (t) => {
  let socket: {
    readyState: number;
    channel: string;
    close(): void;
    onmessage: (event: MessageEvent) => void;
  };
  let nextRead = 0;
  const events: string[] = [];
  class Close extends Event {
    constructor(
      type: string,
      public init: unknown,
    ) {
      super(type);
    }
  }
  const engine = { deliveryAge: 0 };
  globals(t, {
    WebSocket: class {},
    CloseEvent: Close,
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), { hidden: true }),
    sessionStorage: { getItem: () => '1' },
    partyEngine: engine,
    fetch: async (_path: string, options: { method: string; signal: AbortSignal }) => {
      if (options.method === 'POST') return { ok: true, json: async () => ({ closed: false }) };
      if (options.method === 'DELETE') return { ok: true };
      if (nextRead++ === 0)
        return {
          ok: true,
          json: async () => ({
            serverTime: 5000,
            messages: [
              { sequence: 1, sentAt: 0, data: 'one' },
              { sequence: 2, sentAt: 5000, data: 'two' },
            ],
          }),
        };
      if (nextRead === 2)
        return {
          ok: true,
          json: async () => ({
            serverTime: 5000,
            messages: [
              { sequence: 2, sentAt: 5000, data: 'two' },
              { sequence: 3, sentAt: 5000, data: 'three' },
            ],
          }),
        };
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('closed'))),
      );
    },
  });
  const { PlayerTransport } = await runtime('player-transport');
  const done = new Promise<void>((resolve) => {
    socket = new PlayerTransport('ws://fixture/engine/socket/match/player');
    socket.onmessage = (event) => {
      events.push(event.data);
      if (event.data === 'one') assert(engine.deliveryAge >= 5000);
      Promise.resolve().then(() => {
        events.push(`${event.data}-microtask`);
        if (event.data === 'three') {
          socket.close();
          resolve();
        }
      });
    };
  });
  t.after(() => socket.close());
  await done;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, [
    'one',
    'one-microtask',
    'two',
    'two-microtask',
    'three',
    'three-microtask',
  ]);
  assert.equal(engine.deliveryAge, 0);
});
