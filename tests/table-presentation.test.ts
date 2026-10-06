import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sanitizeTable } from '../packages/noname-adapter/src/table.js';

test('原生动作按席位投影：摸牌不揭示旁人牌面，公开虚拟牌有来源与目标，无原生对象或实体 ID', async (t) => {
  const packets = new Map<string, Record<string, unknown>[]>();
  class Player {
    ws = { closed: false };
    constructor(public playerid: string) {
      packets.set(playerid, []);
    }
    send(_callback: unknown, event: Record<string, unknown>) {
      packets.get(this.playerid)!.push(event);
    }
    $draw(_cards: unknown) {
      return 'original';
    }
    $throw(_cards: unknown) {
      return 'original';
    }
    $damage(_source: unknown) {}
    $damagepop(_amount: unknown) {}
    logSkill(_name: unknown) {}
    $die() {}
  }
  const actor = new Player('a'),
    opponent = new Player('b'),
    other = new Player('c');
  let event: Record<string, unknown> = { name: 'draw' };
  const fixture = {
    lib: {
      element: { Player },
      playerOL: { a: actor, b: opponent, c: other },
      translate: { poxi: '魄袭' },
    },
    game: {
      log() {
        return 'logged';
      },
    },
    get: {
      event: () => event,
      translation: (value: unknown) => String(value),
      itemtype: (value: unknown) => ((value as { name?: string })?.name ? 'card' : 'other'),
    },
    _status: {},
    observerCardVisible: () => false,
  };
  const globals: Record<string, unknown> = {
    nativeFixture: fixture,
    partyEngine: {
      setup: {
        seats: ['a', 'b', 'c'].map((id) => ({ id, kind: 'human' })),
        assetBase: '/engine/core/abc/',
      },
    },
    window: { addEventListener() {} },
    setInterval: () => 1,
  };
  for (const [key, value] of Object.entries(globals)) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() =>
      before
        ? Object.defineProperty(globalThis, key, before)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const code = (
    await readFile(
      new URL('../packages/noname-adapter/runtime/table-presentation.js', import.meta.url),
      'utf8',
    )
  )
    .replace(/import \{([^}]+)\} from 'noname';/, 'const {$1} = globalThis.nativeFixture;')
    .replace(
      "import { observerCardVisible } from './observer.js';",
      'const { observerCardVisible } = globalThis.nativeFixture;',
    );
  const { installTablePresentation } = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
  installTablePresentation();
  const secret = {
    name: 'secret-card',
    suit: 'heart',
    number: 3,
    cardid: 'private-id',
    storage: 'private-storage',
    isKnownBy: () => false,
  };
  assert.equal(actor.$draw([secret]), 'original');
  const cards = (id: string) =>
    packets.get(id)![0]!.cards as { label: string; suit: string; image: string }[];
  assert.equal(cards('a')[0]!.label, 'secret-card');
  for (const id of ['b', 'c']) {
    assert.deepEqual(cards(id)[0], { label: '暗牌', suit: '', number: '', nature: '', image: '' });
    assert(!JSON.stringify(packets.get(id)).includes('secret-card'));
  }
  for (const id of ['a', 'b', 'c'])
    for (const secret of ['private-id', 'private-storage'])
      assert(!JSON.stringify(packets.get(id)).includes(secret));
  event = {
    name: 'useCard',
    player: actor,
    card: { name: 'sha', nature: 'fire' },
    targets: [opponent],
    storage: 'secret',
  };
  fixture.game.log(); // An unrelated log within this event does not reveal it.
  assert.equal(packets.get('b')!.length, 1);
  (fixture.game.log as (...args: unknown[]) => unknown)(event.card);
  (fixture.game.log as (...args: unknown[]) => unknown)(event.card);
  const publicUse = packets.get('c')![1]!;
  assert.equal(publicUse.kind, 'use');
  assert.equal(publicUse.source, 'a');
  assert.deepEqual(publicUse.targets, ['b']);
  assert.equal((publicUse.cards as { label: string }[])[0]!.label, '火sha');
  assert.equal(packets.get('c')!.length, 2, 'one publication per native event');
  Object.assign(fixture._status, { currentPhase: actor });
  event = { name: 'phase' };
  fixture.game.log();
  fixture.game.log();
  assert.equal(packets.get('c')!.filter((packet) => packet.kind === 'turn').length, 1);
  event = { name: 'phase' };
  fixture.game.log();
  assert.equal(
    packets.get('c')!.filter((packet) => packet.kind === 'turn').length,
    2,
    'the same player starting a separate extra turn still receives feedback',
  );
  actor.send = () => {
    throw new Error('presentation connection failure');
  };
  assert.equal(actor.$draw([secret]), 'original', 'decorative failure preserves the native action');
  event = { ...event };
  assert.equal(
    (fixture.game.log as (...args: unknown[]) => unknown)(event.card),
    'logged',
    'decorative failure preserves the original public log',
  );
});

test('动作字段白名单、席位限制与数量边界，动画素材不能指定外部 URL 或任意原生动作', () => {
  const state = sanitizeTable(
    {
      epoch: 'e',
      revision: 1,
      playerId: 'a',
      players: [{ id: 'a' }, { id: 'b' }],
      events: [
        {
          id: 1,
          at: 1,
          kind: 'use',
          source: 'a',
          targets: ['b', 'other'],
          label: '<script>text</script>',
          amount: Infinity,
          count: 900,
          event: 'private',
          cards: [
            {
              label: '杀',
              image: 'https://evil.invalid/x',
              cardid: 'private',
              action: 'exec',
              storage: 'private',
            },
          ],
        },
        { id: 2, at: 1, kind: 'exec', source: 'a' },
        { id: 3, at: 1, kind: 'use', source: 'other' },
      ],
    },
    'a',
  )!;
  assert.equal(state.events!.length, 1);
  assert.deepEqual(state.events![0]!.targets, ['b']);
  assert.equal(state.events![0]!.cards[0]!.image, '');
  assert.equal(state.events![0]!.amount, 0);
  assert.equal(state.events![0]!.count, 96);
  assert(!JSON.stringify(state).includes('private'));
});
