import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  let source = (
    await readFile(
      new URL(`../packages/noname-adapter/runtime/${name}.js`, import.meta.url),
      'utf8',
    )
  ).replace(/import \{([^}]+)\} from 'noname';/, 'const {$1} = globalThis.nativeFixture;');
  if (source.includes("from './privacy.js';")) {
    const privacy = (
      await readFile(
        new URL('../packages/noname-adapter/runtime/privacy.js', import.meta.url),
        'utf8',
      )
    ).replace(/import \{([^}]+)\} from 'noname';/, 'const {$1} = globalThis.nativeFixture;');
    source = source.replace(
      "'./privacy.js'",
      `'data:text/javascript;base64,${Buffer.from(privacy).toString('base64')}#${Math.random()}'`,
    );
  }
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`
  );
}

test('原生对象过滤条件按数据重建，曹冲装备条件保留；其他函数及错误数据走原解析', async (t) => {
  const fallback: unknown[] = [],
    recipes: unknown[] = [];
  const get: any = {
    parsedResult(value: any): any {
      if (Array.isArray(value)) return value.map((item) => get.parsedResult(item));
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, get.parsedResult(item)]),
        );
      if (typeof value === 'string' && value.startsWith('_noname_func:')) {
        fallback.push(value);
        return 'native-function-parser';
      }
      return value;
    },
    filter(condition: Record<string, unknown>, index: number) {
      recipes.push([condition, index]);
      return (...values: Record<string, unknown>[]) =>
        Object.entries(condition).every(([key, value]) => values[index]?.[key] === value);
    },
  };
  globals(t, { partyEngine: { setup: { role: 'player' } }, nativeFixture: { get } });
  (await runtime('controls')).installNativeFilterDecoding();
  const encoded = '_noname_func:[{"type":"equip"},0]';
  const event = get.parsedResult({ args: [{ filterCard: encoded, position: 'he' }] });
  const filter = event.args[0].filterCard;
  assert.equal(filter({ type: 'equip' }), true);
  assert.equal(filter({ type: 'basic' }), false);
  assert.equal(event.args[0].position, 'he');
  assert.deepEqual(recipes, [[{ type: 'equip' }, 0]]);
  assert.deepEqual(fallback, [], 'valid native filter JSON never enters the function sanitizer');
  const target = get.parsedResult('_noname_func:[{"group":"wei"},2]');
  assert.equal(target({}, {}, { group: 'wei' }), true, 'the declared argument index is preserved');
  for (const value of [
    '_noname_func:function(){return true;}',
    '_noname_func:["broken"',
    '_noname_func:[{},-1]',
    '_noname_func:[{},0,1]',
  ])
    assert.equal(get.parsedResult(value), 'native-function-parser');
  assert.equal(fallback.length, 4);
  const before = get.parsedResult;
  (globalThis as any).partyEngine.setup.role = 'worker';
  (await runtime('controls')).installNativeFilterDecoding();
  assert.equal(get.parsedResult, before, 'worker result parsing is not widened');
});

test('公开装备、弃牌与重铸只揭示显式材料，移牌前日志与协议一致；其余手牌、摸牌和私人排序仍隐藏', async (t) => {
  let event: any;
  const owner = { playerid: 'actor' },
    viewer = { playerid: 'viewer' };
  class Card {
    kind = 'card';
    position = 'h';
    classList = { contains: () => false, add() {}, remove() {} };
    constructor(
      public name: string,
      public cardid: string,
    ) {}
    init() {}
    isKnownBy(receiver: unknown) {
      return receiver === owner;
    }
  }
  const discarded = new Card('public-discard', 'discarded');
  const remaining = new Card('SECRET-HAND', 'remaining');
  const ordering = new Card('SECRET-ORDERING', 'ordering');
  ordering.position = 'o';
  const recast = new Card('tiesuo', 'recast'),
    otherTiesuo = new Card('tiesuo', 'other-tiesuo'),
    drawn = new Card('SECRET-DRAW', 'drawn');
  class Client {
    id = 'viewer';
    send(...values: unknown[]) {
      return values.map((value) =>
        get.itemtype(value) === 'card' ? get.cardInfoOL(value) : get.stringifiedResult(value),
      );
    }
  }
  class Player {
    send() {}
  }
  const get: any = {
    position: (card: Card) => card.position,
    event: () => event,
    owner: (card: Card) => (card === ordering ? null : owner),
    itemtype: (value: any) =>
      Array.isArray(value) && value.every((item) => item?.kind === 'card') ? 'cards' : value?.kind,
    is: { shownCard: () => false },
    translation: (value: any) => (typeof value === 'string' ? value : value.name),
    cardInfoOL: (card: Card) =>
      '_noname_card:' + JSON.stringify([card.cardid, 'heart', 8, card.name, '']),
    cardInfo: (card: Card) => ['heart', 8, card.name, '', card.cardid],
    stringifiedResult: (value: unknown) => value,
    mode: () => 'identity',
  };
  const lib = {
    card: {},
    translate: {},
    element: { Card, Client, Player },
    playerOL: { viewer },
    cardOL: Object.fromEntries(
      [discarded, remaining, ordering, recast, otherTiesuo, drawn].map((card) => [
        card.cardid,
        card,
      ]),
    ),
  };
  globals(t, { nativeFixture: { lib, get, _status: {} } });
  (await runtime('privacy')).installPrivacy();
  const { observerCardVisible, publicLogText } = await runtime('observer');
  const client = new Client();
  event = {
    name: 'loseAsync',
    type: 'discard',
    visible: true,
    cards: [],
    lose_list: [[owner, [discarded]]],
  };
  assert.equal(observerCardVisible(discarded), true, 'native log precedes filling event.cards');
  assert.equal(observerCardVisible(remaining), false);
  assert.equal(observerCardVisible(ordering), false);
  assert.equal(publicLogText(['弃置了', [discarded]]), '弃置了public-discard');
  const serialized = client.send(discarded, remaining, ordering);
  assert(serialized[0]!.includes('public-discard'));
  assert(serialized[1]!.includes('party_unknown'));
  assert(serialized[2]!.includes('party_unknown'));
  for (const changed of [{ visible: false }, { type: 'gain' }, { name: 'privateSkill' }]) {
    event = {
      name: 'loseAsync',
      type: 'discard',
      visible: true,
      cards: [],
      lose_list: [[owner, [discarded]]],
      ...changed,
    };
    assert.equal(observerCardVisible(discarded), false);
    assert(client.send(discarded)[0]!.includes('party_unknown'));
  }
  event = { name: 'loseToDiscardpile', cards: [discarded] };
  assert.equal(observerCardVisible(discarded), true);
  assert(client.send(discarded)[0]!.includes('public-discard'));
  event.blank = true;
  assert.equal(observerCardVisible(discarded), false);
  assert(client.send(discarded)[0]!.includes('party_unknown'));

  event = { name: 'recast', cards: [recast] };
  assert.equal(publicLogText(['重铸了', [recast]]), '重铸了tiesuo');
  assert.equal(observerCardVisible(recast), true, 'recast is published before its discard child');
  assert.equal(
    observerCardVisible(otherTiesuo),
    false,
    'a matching card name grants no disclosure',
  );
  assert.equal(observerCardVisible(drawn), false, 'replacement draws are not recast materials');
  const recastWire = client.send(recast, otherTiesuo, drawn, remaining, ordering);
  assert(recastWire[0]!.includes('tiesuo'));
  assert(recastWire.slice(1).every((value) => value.includes('party_unknown')));
  const encoded = '_noname_event:' + JSON.stringify({ cards: [recast, drawn].map(get.cardInfoOL) });
  const encodedWire = client.send(encoded)[0]!;
  assert(encodedWire.includes('tiesuo'));
  assert(!encodedWire.includes('SECRET-DRAW'), 'pre-serialized parent cards are filtered too');
  assert(encodedWire.includes('party_unknown'));
  assert.deepEqual(client.send(get.cardInfo(drawn))[0], [
    'none',
    0,
    'party_unknown',
    '',
    drawn.cardid,
  ]);
  const parent = event;
  event = { name: 'draw', cards: [drawn], getParent: () => parent };
  assert.equal(observerCardVisible(recast), true);
  assert.equal(observerCardVisible(drawn), false);
  assert(client.send(drawn)[0]!.includes('party_unknown'));
  event = { name: 'chooseToUse', cards: [recast], recastable: true };
  assert.equal(observerCardVisible(recast), false, 'selecting a recastable card is still private');
  assert(client.send(recast)[0]!.includes('party_unknown'));
  event = {
    name: 'loseAsync',
    visible: true,
    cards: [],
    lose_list: [[owner, [recast]]],
    content: 'loseToDiscardpileMultiple',
    position: 'cardPile',
  };
  assert.equal(
    observerCardVisible(recast),
    false,
    'returning cards to a pile is not public discard',
  );
  assert(client.send(recast)[0]!.includes('party_unknown'));
  // 奇思 directly equips from the hand. Native lose has already cleared all
  // knowers, and the equipment is still in ui.special at its first broadcast.
  discarded.position = 's';
  event = { name: 'equip', visible: true, cards: [discarded], card: drawn };
  assert.equal(observerCardVisible(discarded), true);
  assert.equal(publicLogText(['装备了', discarded]), '装备了public-discard');
  const equipWire = client.send(discarded, remaining, ordering, drawn);
  assert(equipWire[0]!.includes('public-discard'));
  assert(equipWire.slice(1).every((value) => value.includes('party_unknown')));
  const equipParent = event;
  event = { name: 'lose', cards: [discarded], getParent: () => equipParent };
  assert(client.send(discarded)[0]!.includes('public-discard'));
  assert.equal(observerCardVisible(discarded), true);
  const preencodedEquip =
    '_noname_event:' + JSON.stringify({ cards: [discarded, drawn].map(get.cardInfoOL) });
  assert(client.send(preencodedEquip)[0]!.includes('public-discard'));
  assert(!client.send(preencodedEquip)[0]!.includes('SECRET-DRAW'));
  for (const changed of [
    { visible: false },
    { visible: undefined },
    { name: 'chooseToUse' },
    { cards: [] },
  ]) {
    event = { name: 'equip', visible: true, cards: [discarded], ...changed };
    assert.equal(observerCardVisible(discarded), false);
    assert(client.send(discarded)[0]!.includes('party_unknown'));
  }
  discarded.position = 'h';
  for (const name of ['equip', 'addJudge', 'gain', 'addToExpansion', 'lose']) {
    event = { name, visible: true, cards: [discarded] };
    assert.equal(observerCardVisible(discarded), true, `${name}: explicit public material`);
    assert(client.send(discarded)[0]!.includes('public-discard'));
    assert.equal(observerCardVisible(remaining), false, `${name}: remaining hand is private`);
    for (const visible of [false, undefined]) {
      event.visible = visible;
      assert.equal(observerCardVisible(discarded), false, `${name}: no blanket publication`);
      assert(client.send(discarded)[0]!.includes('party_unknown'));
    }
  }
  for (const [type, field] of [
    ['gain', 'gain_list'],
    ['addToExpansion', 'lose_list'],
  ]) {
    event = { name: 'loseAsync', type, visible: true, [field!]: [[owner, [discarded]]] };
    assert.equal(observerCardVisible(discarded), true);
    assert(client.send(discarded)[0]!.includes('public-discard'));
    assert(client.send(remaining)[0]!.includes('party_unknown'));
    event.visible = false;
    assert.equal(observerCardVisible(discarded), false, 'private multiple moves stay private');
  }
  for (const name of ['reguhuo_guess', 'old_guhuo_guess', 'guhuo_guess']) {
    const use = { name: 'useCard', cards: [ordering] };
    const challenge = { name, _trigger: use, getParent: () => use };
    event = { name: 'chooseButtonOL', getParent: () => challenge };
    assert.equal(observerCardVisible(ordering), false, `${name} keeps bluff materials private`);
    assert.equal(publicLogText(['质疑', ordering]), '质疑暗牌');
    event = { name: 'showCards', cards: [ordering], getParent: () => challenge };
    assert.equal(observerCardVisible(ordering), true, `${name} publishes only at native reveal`);
  }
});

test('公开放置牌与虚拟装备按原生边界同步；刷新保留公开材料，私下转移及未知区域不获授权', async (t) => {
  let event: any;
  let display: Card;
  class Card {
    kind = 'card';
    position = 's';
    owner: Player | undefined;
    classList = { contains: () => false, add() {}, remove() {} };
    constructor(
      public name: string,
      public cardid: string,
    ) {}
    init() {}
    clearKnowers() {}
    isKnownBy(receiver: unknown) {
      return this.owner === receiver;
    }
  }
  class Client {
    id = 'viewer';
    send(...args: unknown[]) {
      return args.map((value) => get.stringifiedResult(value));
    }
  }
  class Player {
    vcardsMap: any = { equips: [], judges: [] };
    send() {}
    getCards(zone: string) {
      return [material, secret, unowned].filter(
        (card) => card.owner === this && card.position === zone,
      );
    }
    $addToExpansion(cards: Card[]) {
      const existing = this.getCards('x');
      for (const card of cards) {
        if (existing.includes(card)) continue;
        card.position = 'x';
        card.owner = this;
      }
    }
    $addVirtualEquip(virtual: any, cards: Card[]) {
      display = new Card(virtual.name, 'display');
      return game.broadcastAll(() => {}, this, display, true, virtual, cards);
    }
    $addVirtualJudge(virtual: any, cards: Card[]) {
      return this.$addVirtualEquip(virtual, cards);
    }
  }
  const actor = new Player(),
    viewer = new Player(),
    other = new Player();
  const material = new Card('public-material', 'material');
  const secret = new Card('SECRET', 'secret');
  const unowned = new Card('UNOWNED-EXPANSION', 'unowned');
  unowned.position = 'x';
  const get: any = {
    position: (card: Card) => card.position,
    owner: (card: Card) => card.owner,
    event: () => event,
    itemtype: (value: any) => value?.kind,
    cardInfoOL: (card: Card) =>
      '_noname_card:' + JSON.stringify([card.cardid, 'heart', 8, card.name, '']),
    cardInfo: (card: Card) => ['heart', 8, card.name, '', card.cardid],
    stringifiedResult(value: any): any {
      if (value instanceof Card) return get.cardInfoOL(value);
      if (Array.isArray(value)) return value.map((item) => get.stringifiedResult(item));
      return value;
    },
  };
  const lib: any = {
    card: { bagua: {}, lebu: {}, concealed: { blankCard: true } },
    translate: {},
    element: { Card, Client, Player },
    playerOL: { viewer },
  };
  const client = new Client();
  const game = {
    players: [actor, viewer],
    dead: [],
    broadcastAll: (...args: unknown[]) => client.send(...args.slice(1)),
  };
  globals(t, { nativeFixture: { lib, get, game, _status: {} } });
  const { installPrivacy, publicCardVisible } = await runtime('privacy');
  installPrivacy();
  event = { name: 'addToExpansion', player: actor, visible: true, cards: [material] };
  actor.$addToExpansion([material]);
  event = undefined;
  assert.equal(publicCardVisible(material), true, 'public expansion survives reinit');
  actor.$addToExpansion([material]);
  assert.equal(
    publicCardVisible(material),
    true,
    'native duplicate placement is a no-op, not a new private placement',
  );
  assert(client.send(material)[0].includes('public-material'));
  assert.equal(publicCardVisible(unowned), false, 'an unknown owner grants no access');
  material.position = 'h';
  assert.equal(publicCardVisible(material), false, 'past public placement cannot reveal a hand');
  material.position = 'x';
  material.clearKnowers();
  assert.equal(publicCardVisible(material), false, 'native knowledge reset revokes the placement');
  material.position = 's';
  event = { name: 'addToExpansion', player: actor, visible: true, cards: [material] };
  actor.$addToExpansion([material]);
  event = { name: 'addToExpansion', player: actor, visible: false, cards: [material] };
  material.position = 's';
  actor.$addToExpansion([material]);
  event = undefined;
  assert.equal(
    publicCardVisible(material),
    false,
    'private replacement cannot reuse public authorization',
  );
  event = {
    name: 'loseAsync',
    type: 'addToExpansion',
    visible: true,
    lose_list: [[actor, [material]]],
  };
  other.$addToExpansion([secret]);
  material.position = 's';
  actor.$addToExpansion([material]);
  event = undefined;
  assert.equal(
    publicCardVisible(material),
    true,
    'native multiple expansion placement survives recovery',
  );
  assert.equal(publicCardVisible(secret), false, 'another recipient or material is not authorized');
  event = {
    name: 'loseAsync',
    type: 'addToExpansion',
    visible: false,
    lose_list: [[actor, [material]]],
  };
  material.position = 's';
  actor.$addToExpansion([material]);
  event = undefined;
  assert.equal(
    publicCardVisible(material),
    false,
    'private multiple placement revokes former publicity',
  );
  for (const [method, name] of [
    ['$addVirtualEquip', 'bagua'],
    ['$addVirtualJudge', 'lebu'],
  ]) {
    material.position = 's';
    event = {
      name: method === '$addVirtualEquip' ? 'equip' : 'addJudge',
      visible: true,
      cards: [material],
    };
    const result = (actor as any)[method!]({ name }, [material]);
    assert(result[1].includes(name), 'native synthetic display card is public');
    assert.equal(publicCardVisible(display!), false, 'render scope closes after the callback');
    assert(client.send(secret)[0].includes('party_unknown'));
  }
  event = { name: 'addJudge', visible: false, cards: [material] };
  assert(
    actor.$addVirtualJudge({ name: 'concealed' }, [material])[1].includes('party_unknown'),
    'blank native judgments do not acquire display authorization',
  );
  event = undefined;
  actor.vcardsMap.equips = [{ name: 'bagua', cards: [material] }];
  assert.equal(
    publicCardVisible(material),
    true,
    'physical materials attached to public virtual equipment survive recovery',
  );
  assert.equal(publicCardVisible(secret), false);
  actor.vcardsMap.equips = [];
  actor.vcardsMap.judges = [{ name: 'concealed', cards: [material] }];
  assert.equal(
    publicCardVisible(material),
    false,
    'blank virtual judgments do not expose their materials',
  );
});

test('重连只恢复原生广播仍有效的公开牌池，使用当前剩余牌；私人、暗置、已关闭和同编号替换的弹窗不恢复', async (t) => {
  class Card {
    kind = 'card';
    position = 'o';
    _knowers: string[] = [];
    classList = { contains: () => false, add() {}, remove() {} };
    constructor(
      public name: string,
      public cardid: string,
    ) {}
    init() {}
    isKnownBy() {
      return false;
    }
  }
  const sent: unknown[][] = [];
  class Client {
    id = 'viewer';
    send(...args: unknown[]) {
      return args.map((value) => get.stringifiedResult(value));
    }
  }
  class Player {
    send(...args: unknown[]) {
      sent.push(new Client().send(...args));
    }
  }
  const viewer = new Player();
  const first = new Card('PUBLIC-ONE', 'one'),
    second = new Card('PUBLIC-TWO', 'two');
  first._knowers = second._knowers = ['everyone'];
  const secret = new Card('SECRET-POOL', 'secret');
  const dialogs = new Map<number, any>();
  const makeDialog = (id: number, cards: Card[], hidden = false) => {
    const dialog = {
      isConnected: true,
      buttons: cards.map((link) => ({ link, classList: { contains: () => hidden } })),
      content: { firstChild: { textContent: '当前原生公开牌池' } },
      static: true,
    };
    dialogs.set(id, dialog);
    return dialog;
  };
  const get: any = {
    position: (card: Card) => card.position,
    owner: () => undefined,
    event: () => undefined,
    itemtype: (value: any) => value?.kind,
    idDialog: (id: number) => dialogs.get(id),
    cardInfoOL: (card: Card) =>
      '_noname_card:' + JSON.stringify([card.cardid, 'heart', 8, card.name, '']),
    cardInfo: (card: Card) => ['heart', 8, card.name, '', card.cardid],
    stringifiedResult(value: any): any {
      if (value instanceof Card) return get.cardInfoOL(value);
      if (Array.isArray(value)) return value.map((item) => get.stringifiedResult(item));
      return value;
    },
  };
  const game: any = {
    broadcast() {},
    broadcastAll(...args: unknown[]) {
      return game.broadcast(...args);
    },
  };
  const lib = { card: {}, translate: {}, element: { Card, Client, Player }, playerOL: { viewer } };
  globals(t, { nativeFixture: { lib, get, game, _status: {} } });
  const { installPrivacy, replayPublicDialogs } = await runtime('privacy');
  installPrivacy();
  function nativePool(cards: unknown[], id: number) {
    const dialog = (globalThis as any).ui.create.dialog('五谷丰登', cards);
    dialog.videoId = id;
  }
  makeDialog(10, [secret]);
  game.broadcast(nativePool, [secret], 10);
  makeDialog(11, [first], true);
  game.broadcast(nativePool, [first], 11);
  makeDialog(12, [first]);
  game.broadcast(() => {}, [first], 12);
  makeDialog(13, [first]);
  viewer.send(nativePool, [first], 13);
  makeDialog(14, [first, secret]);
  game.broadcast(nativePool, [first], 14);
  sent.length = 0;
  replayPublicDialogs(viewer);
  assert.equal(
    sent.length,
    0,
    'neither private messages, opaque broadcasts nor mixed/blank dialogs qualify',
  );
  const publicPool = makeDialog(20, [first, second]);
  game.broadcast(nativePool, [first, second], 20);
  publicPool.buttons.shift();
  replayPublicDialogs(viewer);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.slice(2), [20, '当前原生公开牌池', true]);
  assert((sent[0]![1] as string[])[0]!.includes('PUBLIC-TWO'));
  assert.equal((sent[0]![1] as string[]).length, 1, 'picked cards are not restored');
  publicPool.buttons.push({ link: secret, classList: { contains: () => false } });
  replayPublicDialogs(viewer);
  assert.equal(sent.length, 1, 'new private material cannot inherit the public pool authorization');
  publicPool.buttons.pop();
  publicPool.isConnected = false;
  makeDialog(20, [first]);
  replayPublicDialogs(viewer);
  assert.equal(sent.length, 1, 'a reused video ID cannot resurrect the closed original');
  makeDialog(21, [first]);
  game.broadcastAll(nativePool, [first], 21);
  game.broadcastAll('closeDialog', 21);
  replayPublicDialogs(viewer);
  assert.equal(sent.length, 1, 'explicit close revokes recovery even before DOM removal');
});

test('装备点击选择其有效目标，装备材料、非目标和自定义卡牌处理仍走原生流程', async (t) => {
  const calls: unknown[] = [];
  const owner = { classList: { contains: (name: string): boolean => name === 'selectable' } };
  const ui = {
    click: {
      card(this: unknown, event: unknown) {
        calls.push(['card', this, event]);
      },
      target(this: unknown, event: unknown) {
        calls.push(['target', this, event]);
      },
    },
  };
  const event = { custom: { replace: {} as { card?: () => void } } };
  globals(t, {
    partyEngine: { setup: { role: 'player' } },
    nativeFixture: { ui, _status: { event } },
  });
  (await runtime('controls')).installEquipmentTargetSelection();
  let selectable = false;
  const card = {
    classList: { contains: () => selectable },
    parentNode: { classList: { contains: (name: string) => name === 'equips' } },
    closest: () => owner,
  };
  const input = { type: 'click' };
  ui.click.card.call(card, input);
  assert.deepEqual(calls.pop(), ['target', owner, input]);
  selectable = true;
  ui.click.card.call(card, input);
  assert.deepEqual(calls.pop(), ['card', card, input]);
  selectable = false;
  event.custom.replace.card = () => {};
  ui.click.card.call(card, input);
  assert.deepEqual(calls.pop(), ['card', card, input]);
  delete event.custom.replace.card;
  owner.classList.contains = () => false;
  ui.click.card.call(card, input);
  assert.deepEqual(calls.pop(), ['card', card, input]);
});

test('首次发牌及后续堆变化广播实际余量，仅发送轮数和整数，不读取牌堆顶部或顺序', async (t) => {
  const observers: { update: () => void; disconnected: boolean }[] = [];
  const broadcasts: unknown[][] = [];
  const window = new EventTarget();
  const pile = {
    childElementCount: 160,
    get firstChild(): never {
      return assert.fail('must not inspect the top card');
    },
    get childNodes(): never {
      return assert.fail('must not inspect deck order');
    },
  };
  const ui = { cardPile: pile, create: { arena: () => 'native-arena' } };
  const lib = { configOL: { gameStarted: false } };
  globals(t, {
    partyEngine: { setup: { role: 'worker' } },
    window,
    nativeFixture: {
      lib,
      ui,
      game: { roundNumber: 0, broadcastAll: (...values: unknown[]) => broadcasts.push(values) },
    },
    MutationObserver: class {
      disconnected = false;
      constructor(public update: () => void) {
        observers.push(this);
      }
      observe(target: unknown, options: unknown) {
        assert.equal(target, pile);
        assert.deepEqual(options, { childList: true });
      }
      disconnect() {
        this.disconnected = true;
      }
    },
  });
  (await runtime('controls')).installDeckCounter();
  observers[0]!.update();
  assert.equal(broadcasts.length, 0, 'pile setup before native game start is not a player update');
  lib.configOL.gameStarted = true;
  pile.childElementCount = 148;
  observers[0]!.update();
  observers[0]!.update();
  assert.equal(broadcasts.length, 1);
  assert.deepEqual(broadcasts[0]!.slice(1), [0, 148]);
  pile.childElementCount = 146;
  observers[0]!.update();
  assert.deepEqual(broadcasts[1]!.slice(1), [0, 146]);
  assert.equal(ui.create.arena(), 'native-arena');
  assert.equal(observers[0]!.disconnected, true, 'recreated arenas retire their old observer');
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(observers.at(-1)!.disconnected, true);
});
