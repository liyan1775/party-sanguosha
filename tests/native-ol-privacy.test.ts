import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';

async function fixture(t: TestContext) {
  let event: any;
  let mode = 'versus';
  let modeLoad: Promise<unknown> | undefined;
  const reinitTrace: string[] = [];
  const status: { over?: boolean } = {};
  class Card {
    kind = 'card';
    classList = { contains: () => false, add() {}, remove() {} };
    constructor(
      public name: string,
      public cardid: string,
      public owner: Player | undefined,
      public position = 'h',
    ) {}
    init() {}
    isKnownBy(receiver: unknown) {
      return this.owner === receiver;
    }
  }
  class Client {
    constructor(public id: string) {}
    send(...args: unknown[]): any[] {
      // Native Client.send prefixes function calls with exec and serializes
      // arguments 1..n before the JSON websocket frame. Other fixture calls
      // use an explicit test command rather than treating data as a command.
      if (typeof args[0] === 'function') args.unshift('exec');
      else if (args[0] !== 'reinit') args.unshift('fixture');
      for (let index = 1; index < args.length; index++)
        args[index] = get.stringifiedResult(args[index]);
      return JSON.parse(JSON.stringify(args)).slice(1);
    }
  }
  class Player {
    kind = 'player';
    storage: Record<string, any> = {};
    identity = 'fan';
    identityShown = false;
    name = 'public-general';
    name1 = 'public-general';
    name2: string | undefined;
    sex = 'male';
    group = 'jin';
    hp = 4;
    maxHp = 4;
    hujia = 0;
    skills: string[] = [];
    hiddenSkills: string[] = [];
    invisibleSkills: string[] = [];
    additionalSkills = {};
    disabledSkills = {};
    tempSkills = {};
    tempname: string[] = [];
    marks: Record<string, { count: number }> = {};
    unseen = new Set<number>();
    skin = { name: this.name };
    showCalls = 0;
    node = {
      avatar: { setBackground() {} },
      avatar2: { setBackground() {} },
      name: { innerHTML: '' },
      name2: { innerHTML: '' },
    };
    constructor(public playerid: string) {}
    isUnderControl() {
      return false;
    }
    isUnseen(index: number) {
      return index === 2 ? this.unseen.size > 0 : this.unseen.has(index);
    }
    getStat() {
      return { card: {}, skill: {} };
    }
    getState() {
      // Actual getState fields relevant to unseen characters and identities.
      return {
        name: this.name,
        name1: this.name1,
        name2: this.name2,
        sex: this.sex,
        group: this.group,
        hp: this.hp,
        maxHp: this.maxHp,
        hujia: this.hujia,
        unseen: this.isUnseen(0),
        unseen2: this.isUnseen(1),
        identity: this.identity,
        identityNode: ['反', 'fan'],
      };
    }
    init(name: string) {
      const definition = lib.character[name];
      this.name = this.name1 = name;
      this.skin.name = name;
      this.group = definition.group;
      this.hp = definition.hp;
      this.maxHp = definition.maxHp;
      this.skills = definition.skills.slice();
      if (this.skills.includes('rehuashen'))
        this.storage.rehuashen = { character: [], choosed: [], map: {} };
      if (definition.hasHiddenSkill) {
        this.hiddenSkills = this.skills;
        this.skills = ['g_hidden_ai'];
        this.unseen.add(0);
        this.name = 'unknown';
        this.storage.rawHp = this.hp;
        this.storage.rawMaxHp = this.maxHp;
        this.hp = this.maxHp = 1;
      }
    }
    $showCharacter(index: number) {
      this.showCalls++;
      if (index === 0 || index === 2) this.unseen.delete(0);
      if (index === 1 || index === 2) this.unseen.delete(1);
      this.name = this.name1;
      if (!this.isUnseen(2)) {
        this.hp = this.storage.rawHp + this.maxHp - 1;
        this.maxHp = this.storage.rawMaxHp + this.maxHp - 1;
        this.skills.push(...this.hiddenSkills);
        this.hiddenSkills = [];
      }
    }
    send(...args: unknown[]) {
      return new Client(this.playerid).send(...args);
    }
    markSkill(skill: string, _info?: unknown, _card?: unknown, nobroadcast?: boolean): any {
      if (nobroadcast) {
        this.marks[skill] = {
          count:
            skill === 'huashen'
              ? Object.keys(this.storage[skill]?.owned ?? {}).length
              : (this.storage[skill]?.character?.length ?? 0),
        };
        reinitTrace.push('local-mark:' + this.playerid);
        return this;
      }
      // Native markSkill broadcasts storage as a standalone argument.
      return game.broadcastAll(
        function (storage: unknown, player: Player, name: string) {
          player.storage[name] = storage;
        },
        this.storage[skill],
        this,
        skill,
      );
    }
  }
  class GameEvent {
    kind = 'event';
    cards: Card[] = [];
    list: unknown[] = [];
    dialog: any;
    _trigger: GameEvent | undefined;
    fake: boolean | undefined;
    constructor(
      public name: string,
      public player: Player,
      public parent?: GameEvent,
    ) {}
    getParent() {
      return this.parent;
    }
    send() {
      // Native sends encode the parent before entering Client.send.
      const parent = get.stringifiedResult(this.parent);
      const payload = [this.list, this.dialog, this.cards, parent, get.skillState(this.player)];
      return {
        actor: this.player.send(...payload),
        broadcast: new Client('viewer').send(...payload),
      };
    }
  }
  const actor = new Player('actor');
  const target = new Player('target');
  const viewer = new Player('viewer');
  const lib: any = {
    card: {},
    character: {
      'public-general': { group: 'jin', hp: 4, maxHp: 4, skills: [], hasHiddenSkill: false },
    },
    skill: { global: [] },
    message: {
      client: {
        reinit(
          config: any,
          state: any,
          _state2?: unknown,
          _ip?: unknown,
          observe?: unknown,
          onreconnect?: any[],
        ) {
          // The pinned method returns before its asynchronous loadModeAsync
          // callback reconstructs players. onreconnect runs after reconstruction
          // and before game.loop plus the reinited reply.
          game.online = true;
          lib.playerOL = {};
          game.loadModeAsync(config.mode, () => {
            for (const [id, info] of Object.entries<any>(state.players)) {
              const player = new Player(id);
              assert(
                lib.character[info.name1],
                'native reinit requires a known character definition',
              );
              player.init(info.name1);
              player.hp = info.hp;
              player.maxHp = info.maxHp;
              player.hujia = info.hujia;
              player.group = info.group;
              if (!info.unseen) player.unseen.delete(0);
              if (info.unseen2) player.unseen.add(1);
              lib.playerOL[id] = player;
            }
            reinitTrace.push('players-rebuilt');
            if (!observe && Array.isArray(onreconnect))
              onreconnect.shift().apply(null, onreconnect);
            game.loop();
            game.send('reinited');
          });
        },
      },
    },
    translate: {},
    element: { Card, Client, Player, GameEvent },
    playerOL: { actor, target, viewer },
    cardOL: {},
  };
  const get: any = {
    itemtype: (value: any) => value?.kind,
    event: () => event,
    position: (card: Card) => card.position,
    owner: (card: Card) => card.owner,
    mode: () => mode,
    cardInfoOL: (card: Card) =>
      '_noname_card:' + JSON.stringify([card.cardid, 'heart', 8, card.name, '']),
    cardInfo: (card: Card) => ['heart', 8, card.name, '', card.cardid],
    convertedCharacter: (definition: unknown) => definition,
    slimName: (name: string) => name,
    arenaState: () => ({
      players: Object.fromEntries(
        Object.values(lib.playerOL as Record<string, Player>).map((player) => [
          player.playerid,
          player.getState(),
        ]),
      ),
    }),
    skillState: (actor?: Player) => ({
      global: lib.skill.global,
      ...Object.fromEntries(
        Object.values(lib.playerOL as Record<string, Player>).map((player) => [
          player.playerid,
          {
            skills: player.skills,
            hiddenSkills: player.hiddenSkills,
            invisibleSkills: player.invisibleSkills,
            additionalSkills: player.additionalSkills,
            disabledSkills: player.disabledSkills,
            tempSkills: player.tempSkills,
            storage: player.storage,
          },
        ]),
      ),
      skillinfo: {},
      ...(actor ? { stat: actor.getStat() } : {}),
    }),
    eventInfoOL: (value: GameEvent, _level?: number, noMore?: boolean) => {
      const entries: [string, unknown][] = [];
      for (const [key, item] of Object.entries(value)) {
        // Native eventInfoOL specially includes one _trigger and serializes
        // other fields with nomore=false, avoiding arbitrary parent recursion.
        if (key === '_trigger') {
          if (noMore !== false && item instanceof GameEvent)
            entries.push([key, get.eventInfoOL(item, null, false)]);
        } else if (
          !(GameEvent.prototype as any)[key] &&
          key !== 'content' &&
          !(item instanceof GameEvent)
        )
          entries.push([key, get.stringifiedResult(item, null, false)]);
      }
      return '_noname_event:' + JSON.stringify(Object.fromEntries(entries));
    },
    stringifiedResult: (value: any, level = 8, noMore?: boolean): any => {
      if (typeof value === 'function') return '_noname_func:' + value.toString();
      if (value instanceof Card) return get.cardInfoOL(value);
      if (value instanceof Player) return '_noname_player:' + value.playerid;
      if (value instanceof GameEvent) return noMore === false ? '' : get.eventInfoOL(value);
      if (typeof level !== 'number') level = 8;
      if (Array.isArray(value))
        return level === 0
          ? []
          : value.map((item) => get.stringifiedResult(item, level - 1, noMore));
      if (value?.constructor === Object)
        return level === 0
          ? {}
          : Object.fromEntries(
              Object.entries(value).map(([key, item]) => [
                key,
                get.stringifiedResult(item, level - 1, noMore),
              ]),
            );
      return value;
    },
  };
  const broadcasts: unknown[][] = [];
  const game = {
    online: false,
    loadModeAsync: (_name: string, callback: () => unknown) => {
      modeLoad = Promise.resolve().then(callback);
      return modeLoad;
    },
    loop: () => {
      reinitTrace.push('loop');
    },
    send: (command: string) => {
      reinitTrace.push(command);
    },
    log: (...args: unknown[]) => new Client('viewer').send(...args),
    broadcast: (...args: unknown[]) => {
      broadcasts.push(args);
      return {
        actor: new Client('actor').send(...args),
        target: new Client('target').send(...args),
        viewer: new Client('viewer').send(...args),
      };
    },
    broadcastAll: (...args: unknown[]) => game.broadcast(...args),
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'nativeFixture');
  Object.defineProperty(globalThis, 'nativeFixture', {
    value: { lib, game, get, _status: status },
    writable: true,
    configurable: true,
  });
  t.after(() => {
    if (before) Object.defineProperty(globalThis, 'nativeFixture', before);
    else Reflect.deleteProperty(globalThis, 'nativeFixture');
  });
  const source = (
    await readFile(
      new URL('../packages/noname-adapter/runtime/privacy.js', import.meta.url),
      'utf8',
    )
  ).replace(/import \{([^}]+)\} from 'noname';/, 'const {$1} = globalThis.nativeFixture;');
  const runtime = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`
  );
  runtime.installPrivacy();
  return {
    actor,
    target,
    viewer,
    Client,
    Player,
    GameEvent,
    get,
    game,
    status,
    lib,
    broadcasts,
    reinitTrace,
    settleReinit: () => modeLoad,
    runtime,
    setEvent: (value: unknown) => (event = value),
    setMode: (value: string) => (mode = value),
    card: (name: string, owner?: Player, position = 'h') => {
      const card = new Card(name, 'id-' + name, owner, position);
      lib.cardOL[card.cardid] = card;
      return card;
    },
  };
}

function faces(value: unknown): string[] {
  if (typeof value === 'string') {
    if (value.startsWith('_noname_card:')) return [JSON.parse(value.slice(13))[3]];
    if (value.startsWith('_noname_event:')) return faces(JSON.parse(value.slice(14)));
    return [];
  }
  if (Array.isArray(value)) {
    if (value.length === 5 && ['heart', 'none'].includes(value[0])) return [value[2]];
    return value.flatMap(faces);
  }
  return value?.constructor === Object ? Object.values(value).flatMap(faces) : [];
}

test('定向私有消息仅授权显式无主材料，父事件和其他技能storage里的暗牌不能借收件人授权', async (t) => {
  const { actor, viewer, card, get, setEvent } = await fixture(t);
  setEvent({ name: 'chooseToMove' });
  const shown = card('DECLARED-PRIVATE', undefined, 'o');
  const unrelated = card('SECRET-PARENT', undefined, 'o');
  const stored = card('SECRET-STORAGE', undefined, 's');
  const encodedParent = '_noname_event:' + JSON.stringify({ cards: [get.cardInfoOL(unrelated)] });
  const result = actor.send(() => {}, [shown], encodedParent, { storage: { cards: [stored] } });
  assert(
    faces(result).includes('DECLARED-PRIVATE'),
    'explicit actor-addressed materials stay usable',
  );
  assert(
    !faces(result).includes('SECRET-PARENT'),
    'encoded parent is not an actor-visible material list',
  );
  assert(
    !faces(result).includes('SECRET-STORAGE'),
    'unowned skill storage is not an actor-visible material list',
  );
  assert(faces(result).includes('party_unknown'));
  assert(!faces(viewer.send(() => {}, { cards: [shown] })).includes('DECLARED-PRIVATE'));
  assert(
    !faces(actor.send(() => {}, { cards: [shown] })).includes('DECLARED-PRIVATE'),
    'authorization ends with the original message',
  );
});

test('化身动画只向所有者传真实将名；旁人保留数量，其他选将及权威材料不变', async (t) => {
  const { actor, Client, game } = await fixture(t);
  actor.storage.rehuashen = {
    character: ['SECRET-GENERAL-A', 'SECRET-GENERAL-B'],
    choosed: ['SECRET-HISTORY'],
    map: { 'SECRET-GENERAL-A': ['SECRET-SKILL'] },
    current: 'PUBLIC-GENERAL',
    current2: 'PUBLIC-SKILL',
  };
  const drawn = actor.storage.rehuashen.character.slice();
  // Pinned drawCharacter's callback is owner-only despite broadcastAll.
  function drawCharacter(player: any, list: string[]) {
    if (player.isUnderControl(true)) {
      for (const name of list) player.$draw('huashen_card_' + name, 'nobroadcast');
    }
  }
  const result = game.broadcastAll(drawCharacter, actor, drawn);
  assert.deepEqual(result.actor[2], drawn);
  assert.deepEqual(result.viewer[2], ['unknown', 'unknown']);
  assert.deepEqual(result.target[2], ['unknown', 'unknown']);
  assert(!JSON.stringify(result.viewer).includes('SECRET-GENERAL'));
  assert.deepEqual(drawn, ['SECRET-GENERAL-A', 'SECRET-GENERAL-B']);
  assert.equal(actor.storage.rehuashen.map['SECRET-GENERAL-A'][0], 'SECRET-SKILL');
  assert.deepEqual(
    new Client('viewer').send(function selectCharacter() {}, actor, drawn)[2],
    drawn,
    'an unrelated candidate-selection callback is not rewritten',
  );
});

test('时光场旧化身的备用将和技能映射在动画、标记、选择和整页恢复中仅本人可见', async (t) => {
  const { actor, Client, game, get } = await fixture(t);
  const secret = {
    owned: { 'SECRET-A': ['SECRET-SKILL-A'], 'SECRET-B': ['SECRET-SKILL-B'] },
    choosed: ['SECRET-HISTORY'],
    current: 'PUBLIC-GENERAL',
    current2: 'PUBLIC-SKILL',
  };
  const publicState = {
    owned: { unknown_0: [], unknown_1: [] },
    choosed: [],
    current: secret.current,
    current2: secret.current2,
  };
  actor.storage.huashen = secret;
  const mark = actor.markSkill('huashen');
  assert.deepEqual(mark.actor[1], secret);
  assert.deepEqual(mark.viewer[1], publicState);
  const state = get.skillState();
  assert.deepEqual(new Client('actor').send(state)[0].actor.storage.huashen, secret);
  assert.deepEqual(new Client('viewer').send(state)[0].actor.storage.huashen, publicState);
  const encoded = '_noname_event:' + JSON.stringify({ skills: state });
  assert(!new Client('viewer').send(encoded)[0].includes('SECRET-'));
  function drawCharacter(player: any, list: string[]) {
    if (player.isUnderControl(true))
      for (const name of list) player.$draw('huashen_card_' + name, 'nobroadcast');
  }
  const drawn = game.broadcastAll(drawCharacter, actor, Object.keys(secret.owned));
  assert.deepEqual(drawn.actor[2], Object.keys(secret.owned));
  assert.deepEqual(drawn.viewer[2], ['unknown', 'unknown']);
  const arena = get.arenaState();
  const owner = new Client('actor').send('reinit', { mode: 'versus' }, arena, {}, 'local', null);
  const outsider = new Client('viewer').send(
    'reinit',
    { mode: 'versus' },
    arena,
    {},
    'local',
    null,
  );
  assert.deepEqual(owner[1].partyHuashen.actor, secret);
  assert.deepEqual(outsider[1].partyHuashen.actor, publicState);
  assert(!JSON.stringify(outsider).includes('SECRET-'));
  assert.equal(actor.storage.huashen, secret);
});

test('化身标记与选择恢复skillState按席位过滤：公开当前技能/数量，隐藏备用将、历史和映射', async (t) => {
  const { actor, target, Client, get, setMode } = await fixture(t);
  const secret = {
    character: ['SECRET-GENERAL-A', 'SECRET-GENERAL-B'],
    choosed: ['SECRET-HISTORY'],
    map: { 'SECRET-GENERAL-A': ['SECRET-SKILL'] },
    current: 'PUBLIC-GENERAL',
    current2: 'PUBLIC-SKILL',
  };
  actor.storage = { rehuashen: secret, publicMark: ['public-record'] };
  target.storage.rehuashen = { ...secret, character: ['OTHER-SECRET'] };
  const publicState = {
    character: ['unknown', 'unknown'],
    choosed: [],
    map: {},
    current: 'PUBLIC-GENERAL',
    current2: 'PUBLIC-SKILL',
  };
  const mark = actor.markSkill('rehuashen');
  assert.deepEqual(mark.actor[1], secret);
  assert.deepEqual(mark.viewer[1], publicState);
  assert.deepEqual(mark.target[1], publicState);
  for (const mode of ['versus', 'identity', 'doudizhu']) {
    setMode(mode);
    const state = get.skillState();
    const actorWire = new Client('actor').send(state)[0];
    const otherWire = new Client('viewer').send(state)[0];
    assert.deepEqual(actorWire.actor.storage.rehuashen, secret);
    assert.deepEqual(actorWire.target.storage.rehuashen.character, ['unknown']);
    assert.deepEqual(otherWire.actor.storage.rehuashen, publicState);
    assert.deepEqual(otherWire.actor.storage.publicMark, ['public-record']);
    const arena = new Client('viewer').send(get.arenaState())[0];
    assert.equal(arena.players.actor.identity, mode === 'identity' ? 'unknown' : 'fan');
    const encoded = '_noname_event:' + JSON.stringify({ skills: state });
    const wire = new Client('viewer').send(encoded)[0];
    assert(!wire.includes('SECRET-'), 'pre-encoded reconnect and choice parents are filtered');
    assert(wire.includes('PUBLIC-GENERAL') && wire.includes('PUBLIC-SKILL'));
    assert.deepEqual(state.actor.storage.rehuashen, secret);
  }
});

test('没有待处理选择的化身整页reinit：本人恢复原候选，旁人恢复数量和当前变身，异步重建后才更新标记', async (t) => {
  const primary = await fixture(t);
  const { actor, lib, Client, get } = primary;
  const definition = {
    group: 'qun',
    hp: 3,
    maxHp: 3,
    skills: ['rehuashen', 'rexinsheng'],
    hasHiddenSkill: false,
  };
  lib.character.re_zuoci = definition;
  actor.name = actor.name1 = 're_zuoci';
  actor.skills = definition.skills.slice();
  const secret = {
    character: ['SECRET-GENERAL-A', 'SECRET-GENERAL-B', 'SECRET-GENERAL-C'],
    choosed: ['SECRET-HISTORY'],
    map: { 'SECRET-GENERAL-A': ['SECRET-SKILL'] },
    current: 'PUBLIC-GENERAL',
    current2: 'PUBLIC-SKILL',
  };
  actor.storage = { rehuashen: secret, unrelatedPrivateState: 'SECRET-UNRELATED-STORAGE' };
  const arena = get.arenaState();
  assert(!('storage' in arena.players.actor), 'native arena snapshots have no skill storage');
  const owner = new Client('actor').send('reinit', { mode: 'versus' }, arena, {}, 'local', null);
  const outsider = new Client('viewer').send(
    'reinit',
    { mode: 'versus' },
    arena,
    {},
    'local',
    null,
  );
  const publicState = {
    character: ['unknown', 'unknown', 'unknown'],
    choosed: [],
    map: {},
    current: 'PUBLIC-GENERAL',
    current2: 'PUBLIC-SKILL',
  };
  assert.deepEqual(owner[1].partyRehuashen.actor, secret);
  assert.deepEqual(outsider[1].partyRehuashen.actor, publicState);
  assert(!JSON.stringify(outsider).includes('SECRET-'));
  assert(!JSON.stringify(owner).includes('SECRET-UNRELATED-STORAGE'));
  assert(!('partyRehuashen' in arena), 'the source arena snapshot is unchanged');
  assert.equal(actor.storage.rehuashen, secret, 'the rule executor retains its native object');
  const ordinary = new Client('viewer').send(arena)[0];
  assert(!('partyRehuashen' in ordinary), 'ordinary snapshots do not gain private storage');

  for (const [id, wire, expected] of [
    ['actor', owner, secret],
    ['viewer', outsider, publicState],
  ] as const)
    await t.test('fresh ' + id, async (freshTest) => {
      const fresh = await fixture(freshTest);
      fresh.lib.character.re_zuoci = definition;
      const token = { nativeHookArgument: true };
      const existingHook = [
        (argument: unknown) => {
          assert.equal(argument, token);
          assert.deepEqual(fresh.lib.playerOL.actor.storage.rehuashen, expected);
          fresh.reinitTrace.push('native-hook');
        },
        token,
      ];
      fresh.game.loop = () => {
        assert.equal(fresh.lib.playerOL.actor.marks.rehuashen.count, 3);
        fresh.reinitTrace.push('loop');
      };
      fresh.lib.message.client.reinit(wire[0], wire[1], {}, 'local', null, existingHook);
      assert.deepEqual(fresh.lib.playerOL, {}, 'native mode loading has not rebuilt players yet');
      assert.deepEqual(fresh.reinitTrace, [], 'restoration waits for native reconstruction');
      await fresh.settleReinit();
      const mirror = fresh.lib.playerOL.actor;
      assert.deepEqual(mirror.storage.rehuashen, expected);
      assert.deepEqual(mirror.tempname, ['PUBLIC-GENERAL']);
      assert.equal(mirror.marks.rehuashen.count, 3);
      assert(!('unrelatedPrivateState' in mirror.storage));
      assert.deepEqual(fresh.reinitTrace, [
        'players-rebuilt',
        'local-mark:actor',
        'native-hook',
        'loop',
        'reinited',
      ]);
      assert.equal(
        existingHook.length,
        2,
        'the native hook is chained without mutating its arguments',
      );
      assert.equal(fresh.broadcasts.length, 0, 'mirror restoration emits no broadcast');
      assert.equal(
        actor.storage.rehuashen,
        secret,
        'owner and outsider refresh leave authority unchanged',
      );
    });
});

test('隐匿初始化和新页面reinit只重建公开外壳，明置元数据不重置对局状态', async (t) => {
  const primary = await fixture(t);
  const { actor, lib, Client, get, runtime, broadcasts } = primary;
  lib.character['SECRET-JIN'] = {
    group: 'jin',
    hp: 4,
    maxHp: 4,
    hujia: 0,
    skills: ['SECRET-JIN-SKILL'],
    hasHiddenSkill: true,
  };
  const initialized = runtime.broadcastCharacterInit(actor, 'SECRET-JIN');
  assert.equal(initialized.actor[2], 'SECRET-JIN');
  assert.equal(initialized.viewer[2], 'party_hidden_actor');
  assert.equal(initialized.viewer[3].hp, 1);
  assert.equal(initialized.viewer[3].maxHp, 1);
  assert.equal(initialized.viewer[3].hasHiddenSkill, true);
  assert.deepEqual(initialized.viewer[3].skills, []);
  assert(!JSON.stringify(initialized.viewer).includes('SECRET-JIN'));
  // broadcastAll also calls this callback on the rule executor in production.
  actor.init('SECRET-JIN');
  const wire = new Client('viewer').send(get.arenaState())[0];
  assert.equal(wire.players.actor.name, 'unknown');
  assert.equal(wire.players.actor.name1, 'party_hidden_actor');
  assert.equal(wire.players.actor.unseen, true);
  assert.equal(actor.name1, 'SECRET-JIN');
  await t.test('fresh mirror has no initial synthetic definition', async (freshTest) => {
    const fresh = await fixture(freshTest);
    assert(!fresh.lib.character.party_hidden_actor);
    fresh.lib.message.client.reinit({}, wire);
    await fresh.settleReinit();
    const mirror = fresh.lib.playerOL.actor;
    assert.equal(mirror.name1, 'party_hidden_actor');
    assert.equal(mirror.isUnseen(0), true);
    assert.equal(mirror.hp, 1);
    assert.equal(mirror.maxHp, 1);
    assert.deepEqual(mirror.hiddenSkills, []);
    assert(!JSON.stringify(fresh.lib.character.party_hidden_actor).includes('SECRET-JIN'));
    const mark = { retained: true };
    mirror.storage.publicMark = mark;
    const hpBefore = mirror.hp;
    const countBefore = broadcasts.length;
    actor.$showCharacter(0);
    const [repair, , metadata] = broadcasts[countBefore]! as [Function, unknown, unknown];
    repair(mirror, metadata);
    assert.equal(mirror.name1, 'SECRET-JIN', 'only now does a non-owner learn the real name');
    assert.equal(mirror.hp, hpBefore, 'metadata does not perform native re-init or change HP');
    assert.equal(
      mirror.storage.publicMark,
      mark,
      'existing skill storage survives reveal metadata',
    );
    assert.equal(actor.hp, 4, 'only the original native reveal restores authoritative base HP');
    assert.equal(actor.showCalls, 1);
    const shown = new Client('viewer').send(get.arenaState())[0];
    assert.equal(shown.players.actor.name1, 'SECRET-JIN');
    assert.equal(shown.players.actor.unseen, false);
  });
});

test('隐匿getState与skillState过滤对应未亮将，保留本人、公开技能及已亮副将', async (t) => {
  const { actor, target, lib, get, Client, status } = await fixture(t);
  lib.character['SECRET-MAIN'] = {
    group: 'jin',
    hp: 4,
    maxHp: 4,
    hasHiddenSkill: true,
    skills: ['SECRET-MAIN-SKILL', 'PUBLIC-ACQUIRED'],
  };
  lib.character['SECRET-SECONDARY'] = {
    group: 'jin',
    hp: 3,
    maxHp: 3,
    hasHiddenSkill: true,
    skills: ['SECRET-SECONDARY-SKILL'],
  };
  actor.name = 'unknown';
  actor.name1 = 'SECRET-MAIN';
  actor.name2 = 'public-general';
  actor.unseen.add(0);
  actor.skills = ['g_hidden_ai', 'PUBLIC-ACQUIRED'];
  actor.hiddenSkills = ['SECRET-MAIN-SKILL', 'PUBLIC-ACQUIRED', 'PUBLIC-OTHER-MARK'];
  actor.invisibleSkills = ['SECRET-MAIN-SKILL', 'PUBLIC-OTHER-MARK'];
  actor.storage = { rawHp: 4, rawMaxHp: 4, publicMark: 2 };
  target.name = target.name1 = 'public-general';
  target.name2 = 'SECRET-SECONDARY';
  target.unseen.add(1);
  target.skills = ['PUBLIC-REVEALED-SKILL'];
  target.hiddenSkills = ['SECRET-SECONDARY-SKILL'];
  const arena = get.arenaState();
  const own = new Client('actor').send(arena, get.skillState(actor));
  const opponent = new Client('viewer').send(arena, get.skillState());
  assert.equal(own[0].players.actor.name1, 'SECRET-MAIN');
  assert(own[1].actor.hiddenSkills.includes('SECRET-MAIN-SKILL'));
  assert.equal(opponent[0].players.actor.name1, 'party_hidden_actor');
  assert.equal(opponent[0].players.actor.name2, 'public-general');
  assert.equal(opponent[0].players.actor.hp, actor.hp);
  assert.equal(opponent[0].players.actor.group, actor.group);
  assert.equal(opponent[0].players.target.name, 'public-general');
  assert.equal(opponent[0].players.target.name1, 'public-general');
  assert.equal(opponent[0].players.target.name2, 'party_hidden_target_secondary');
  assert.deepEqual(opponent[1].actor.skills, ['g_hidden_ai', 'PUBLIC-ACQUIRED']);
  assert.deepEqual(opponent[1].actor.hiddenSkills, ['PUBLIC-ACQUIRED', 'PUBLIC-OTHER-MARK']);
  assert.deepEqual(opponent[1].actor.invisibleSkills, ['PUBLIC-OTHER-MARK']);
  assert.deepEqual(opponent[1].actor.storage, { publicMark: 2 });
  assert.deepEqual(opponent[1].target.skills, ['PUBLIC-REVEALED-SKILL']);
  assert.deepEqual(opponent[1].target.hiddenSkills, []);
  assert(!JSON.stringify(opponent).includes('SECRET-'));
  assert.deepEqual(actor.storage, { rawHp: 4, rawMaxHp: 4, publicMark: 2 });
  actor.unseen.clear();
  const revealed = new Client('viewer').send(arena, get.skillState())[1];
  assert(
    revealed.actor.hiddenSkills.includes('SECRET-MAIN-SKILL'),
    'native revealed state is not filtered',
  );
  status.over = true;
  assert(
    new Client('viewer').send(get.arenaState())[0].players.target.name2 === 'SECRET-SECONDARY',
  );
});

test('宴戏只在原生展示日志公开三张牌，牌堆、剩余手牌与其他查看仍隐藏', async (t) => {
  const { actor, target, card, Client, GameEvent, get, game, runtime, setEvent } = await fixture(t);
  const hand = card('YANXI-HAND', target);
  const top1 = card('YANXI-TOP-ONE', undefined, 'c');
  const top2 = card('YANXI-TOP-TWO', undefined, 'c');
  const otherHand = card('SECRET-HAND', target);
  const otherTop = card('SECRET-TOP', undefined, 'c');
  const shown = [top1, hand, top2];
  const event = new GameEvent('yanxi', actor);
  setEvent(event);
  assert(faces(new Client('viewer').send(shown)).every((name) => name === 'party_unknown'));
  const before = get.stringifiedResult(shown);
  const log = game.log(actor, '展示了', shown);
  assert.deepEqual(faces(log), ['YANXI-TOP-ONE', 'YANXI-HAND', 'YANXI-TOP-TWO']);
  const broadcast = new Client('viewer').send(
    shown,
    before,
    shown.map(get.cardInfo),
    otherHand,
    otherTop,
  );
  assert.deepEqual(faces(broadcast).slice(0, 9), [
    'YANXI-TOP-ONE',
    'YANXI-HAND',
    'YANXI-TOP-TWO',
    'YANXI-TOP-ONE',
    'YANXI-HAND',
    'YANXI-TOP-TWO',
    'YANXI-TOP-ONE',
    'YANXI-HAND',
    'YANXI-TOP-TWO',
  ]);
  assert.deepEqual(faces(broadcast).slice(9), ['party_unknown', 'party_unknown']);
  setEvent(new GameEvent('chooseButton', actor, event));
  assert.deepEqual(
    faces(new Client('viewer').send(shown)),
    shown.map((item) => item.name),
  );
  setEvent(new GameEvent('clanjieli', actor));
  runtime.markPublicLogCards([actor, '展示了', shown]);
  assert(faces(new Client('viewer').send(shown)).every((name) => name === 'party_unknown'));
  for (const args of [
    [actor, '观看了', shown],
    [actor, '展示了', [hand]],
    [target, '展示了', shown],
  ]) {
    setEvent(new GameEvent('yanxi', actor));
    runtime.markPublicLogCards(args);
    assert(faces(new Client('viewer').send(shown)).every((name) => name === 'party_unknown'));
  }
});

test('诫厉私人换牌与无换牌查看只授权本人指定材料，其他手牌及旁人均隐藏', async (t) => {
  const { actor, target, card, Client, GameEvent, get, setEvent } = await fixture(t);
  const hand = card('JIELI-LONG-HAND', target);
  const otherHand = card('SECRET-OTHER-HAND', target);
  const top = card('JIELI-TOP', undefined, 'o');
  const otherOrdering = card('SECRET-ORDERING', undefined, 'o');
  const parent = new GameEvent('clanjieli', actor);
  parent.cards = [hand, top, otherHand, otherOrdering];
  const choice = new GameEvent('chooseToMove', actor, parent);
  choice.list = [
    ['最长手牌', [hand]],
    ['牌堆顶', [top]],
  ];
  setEvent(choice);
  const result = choice.send();
  assert(faces(result.actor).includes(hand.name) && faces(result.actor).includes(top.name));
  assert(!faces(result.actor).includes(otherHand.name));
  assert(
    !faces(result.broadcast).includes(hand.name) && !faces(result.broadcast).includes(top.name),
  );
  assert(!faces(result.broadcast).includes(otherOrdering.name));
  assert.deepEqual(faces(new Client('viewer').send(parent.cards)), Array(4).fill('party_unknown'));
  const view = new GameEvent('chooseControl', actor, parent);
  view.dialog = ['诫厉：最长手牌', [hand]];
  setEvent(view);
  const viewed = view.send();
  assert(
    faces(viewed.actor).includes(hand.name),
    'zero-used-card branch still permits its private view',
  );
  assert(!faces(viewed.broadcast).includes(hand.name));
  view.parent = new GameEvent('unrelatedSkill', actor);
  assert(
    !faces(view.send().actor).includes(hand.name),
    'arbitrary chooseControl dialogs gain no authority',
  );
  assert.deepEqual(get.cardInfo(otherHand).slice(0, 3), ['heart', 8, otherHand.name]);
});

for (const version of ['reguhuo_guess', 'old_guhuo_guess', 'guhuo_guess'])
  test(`${version}质疑时父事件真伪和暗置材料不泄露，原生亮牌后恢复公开`, async (t) => {
    const { actor, target, card, Client, GameEvent, get, setEvent } = await fixture(t);
    const bluff = card('SECRET-BLUFF', actor, 'o');
    const remaining = card('SECRET-REMAINING', actor);
    const use = new GameEvent('useCard', actor);
    use.cards = [bluff];
    const guess = new GameEvent(version, actor, use);
    guess.fake = true;
    guess._trigger = use;
    const choice = new GameEvent('chooseButtonOL', target, guess);
    setEvent(choice);
    const encoded = get.stringifiedResult(guess);
    assert(
      encoded.includes('"fake":true'),
      'authoritative pre-encoding retains the native verdict',
    );
    for (const value of [encoded, guess]) {
      const wire = new Client('target').send(value)[0];
      assert(!wire.includes('"fake"'));
      assert(!faces(wire).includes(bluff.name));
      assert(faces(wire).includes('party_unknown'));
      assert(new Client('actor').send(value)[0].includes('"fake":true'));
    }
    assert.equal(guess.fake, true);
    const display = new GameEvent('showCards', actor, guess);
    display.cards = [bluff];
    setEvent(display);
    assert.deepEqual(faces(new Client('target').send(bluff, remaining)), [
      bluff.name,
      'party_unknown',
    ]);
    setEvent(use);
    assert.deepEqual(faces(new Client('target').send(bluff)), [bluff.name]);
    const ordinary = new GameEvent('useCard', actor);
    ordinary.cards = [remaining];
    setEvent(ordinary);
    assert.deepEqual(faces(new Client('target').send(remaining)), [remaining.name]);
  });

for (const version of ['old_guhuo_guess', 'guhuo_guess'])
  test(`${version}仅在原生翻牌回调公开一张材料，其他广播、假回调和其余暗牌仍隐藏`, async (t) => {
    const { actor, target, card, Client, GameEvent, game, get, broadcasts, setEvent } =
      await fixture(t);
    const bluff = card('BLUFF-TO-REVEAL', actor, 'o');
    const secret = card('SECRET-OTHER', actor);
    const use = new GameEvent('useCard', actor);
    use.cards = [bluff];
    const guess: any = new GameEvent(version, actor, use);
    guess._trigger = use;
    guess.onEnd01 = function nativeFlip() {};
    const flip =
      version === 'old_guhuo_guess'
        ? function (onEnd: unknown) {
            (globalThis as any)._status.old_guhuoNode.listenTransition(onEnd, 300);
          }
        : function (onEnd: unknown) {
            (globalThis as any)._status.guhuoNode.listenTransition(onEnd, 300);
          };
    setEvent(guess);
    game.broadcastAll(flip, () => {});
    assert(!guess.partyShownGuhuoCards, 'unrelated callbacks do not publish materials');
    assert.deepEqual(faces(new Client(target.playerid).send(bluff, secret)), [
      'party_unknown',
      'party_unknown',
    ]);
    const before = broadcasts.length;
    game.broadcastAll(flip, guess.onEnd01);
    assert.deepEqual(guess.partyShownGuhuoCards, [bluff]);
    assert.equal(
      broadcasts.length,
      before + 2,
      'publication precedes the unchanged native animation',
    );
    assert.deepEqual(faces(get.stringifiedResult(broadcasts.at(-2))), [bluff.name]);
    assert.deepEqual(faces(new Client(target.playerid).send(bluff, secret)), [
      bluff.name,
      'party_unknown',
    ]);
    assert.equal(bluff.name, 'BLUFF-TO-REVEAL');
  });
