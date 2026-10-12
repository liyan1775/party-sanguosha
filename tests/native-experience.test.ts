import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as tick } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { ObserverJournal } from '../packages/noname-adapter/src/observer.js';

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
  )
    .replace(/import \{([^}]+)\} from 'noname';/, 'const {$1} = globalThis.nativeFixture;')
    .replace(
      "import { withChoiceDisclosure } from './privacy.js';",
      'const { withChoiceDisclosure } = globalThis.nativeFixture;',
    );
  if (source.includes("import { markPublicLogCards } from './privacy.js';")) {
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

test('原生转化技能：点击技能打开选项，选项、材料和目标仍须明确确认；AI保持原生行为', async (t) => {
  let submitted = 0;
  let finished = 0;
  let closed = 0;
  let empty = true;
  const autoConfirm = (_event: unknown, _state: unknown) => {};
  const otherHook = (_event: unknown, _state: unknown) => {};
  const skills: Record<string, unknown> = {
    conversion: { chooseButton: { backup: () => ({}) } },
    generated: { sourceSkill: 'conversion', viewAs: { name: 'sha' } },
    material: { direct: true, viewAs: { name: 'sha' } },
    backup: { chooseButton: {}, viewAs: { name: 'sha' } },
    ordinary: {},
  };
  const lib = { hooks: { checkEnd: [autoConfirm, otherHook] } };
  const setup = { role: 'player' };
  const confirmations: string[] = [];
  const status: any = {};
  let cancelled: unknown[] = [];
  let confirmDuringCancel: unknown;
  const ui: any = {
    confirm: { close: () => closed++ },
    create: { confirm: (value: string) => confirmations.push(value) },
    click: {
      ok: () => submitted++,
      cancel: (...args: unknown[]) => {
        cancelled = args;
        confirmDuringCancel = ui.confirm;
        return 'native cancellation';
      },
    },
  };
  globals(t, {
    partyEngine: { setup },
    nativeFixture: {
      lib,
      game: {},
      ui,
      get: { info: (skill: string) => skills[skill], noSelected: () => empty },
      _status: status,
    },
  });
  const { installHumanConfirmation } = await runtime('controls');
  installHumanConfirmation();
  assert(!lib.hooks.checkEnd.includes(autoConfirm));
  assert(lib.hooks.checkEnd.includes(otherHook), 'unrelated native hooks are retained');
  const run = (name: string, skill: string, ok = true, mine = true) => {
    const event = { name, skill, skillDialog: true, isMine: () => mine, finish: () => finished++ };
    for (const hook of lib.hooks.checkEnd) hook(event, { ok });
    return event;
  };
  assert.equal(run('chooseToUse', 'conversion').skillDialog, false);
  run('chooseToRespond', 'conversion');
  assert.equal(submitted, 2, 'both native use and response can open their option picker');
  for (const [name, skill, ok, mine] of [
    ['chooseButton', 'conversion', true, true],
    ['chooseToUse', 'conversion', false, true],
    ['chooseToUse', 'conversion', true, false],
    ['chooseToUse', 'material', true, true],
    ['chooseToUse', 'backup', true, true],
    ['chooseToUse', 'ordinary', true, true],
    ['chooseToUse', '', true, true],
  ] as const)
    run(name, skill, ok, mine);
  empty = false;
  run('chooseToUse', 'conversion');
  assert.equal(submitted, 2, 'selected options, cards and targets are never auto-submitted');
  assert.equal(closed, 2);
  assert.equal(finished, 2, 'only the rule worker runs the native option/backup factory');
  const choice = {
    name: 'chooseToUse',
    skill: 'generated',
    _backupevent: 'generated',
    isMine: () => true,
    timeout: 'original deadline',
  };
  for (const ok of [false, true]) for (const hook of lib.hooks.checkEnd) hook(choice, { ok });
  assert.deepEqual(confirmations, ['c', 'oc'], 'generated material choices always allow cancel');
  status.event = choice;
  ui.confirm = {
    close: () => {
      closed++;
      delete ui.confirm;
    },
  };
  const button = {};
  assert.equal(ui.click.cancel(button), 'native cancellation');
  assert.deepEqual(cancelled, [button], 'native cancel receives the original button');
  assert.equal(confirmDuringCancel, undefined, 'stale confirm closes before native restore/check');
  assert.equal(choice.timeout, 'original deadline');
  assert.equal(submitted, 2, 'cancel never submits an action');
  assert.equal(closed, 3);
  lib.hooks.checkEnd = [autoConfirm, otherHook];
  setup.role = 'worker';
  installHumanConfirmation();
  assert.deepEqual(lib.hooks.checkEnd, [autoConfirm, otherHook]);
});

test('转化规则只从电脑原生定义发往当前选择者；刷新重放同一规则且不重新计时', async (t) => {
  const sent: { player: string; args: unknown[] }[] = [];
  const waiting: Record<string, unknown> = {};
  let waits = 0;
  class Player {
    constructor(public playerid: string) {}
    ws: object = {};
    send(...args: unknown[]) {
      sent.push({ player: this.playerid, args });
    }
    wait() {
      waits++;
      waiting[this.playerid] = '_noname_waiting';
    }
    unwait(result: unknown) {
      waiting[this.playerid] = result;
    }
  }
  const actor = new Player('actor');
  const other = new Player('other');
  const originalSet = [['type', 'phase']];
  let applied: unknown[] = [];
  const nativeCallback = (...args: unknown[]) => {
    applied = args;
  };
  class Choice {
    name = 'chooseToUse';
    player = actor;
    skill = 'conversion_backup';
    _backup: object | undefined = {};
    openskilldialog = '请选择转化材料';
    restore() {
      this._backup = undefined;
      this.skill = '';
    }
    send() {
      this.player.send(nativeCallback, this.name, [], originalSet, 'encoded parent', { stat: {} });
      other.send(nativeCallback, this.name, [], originalSet, 'other parent', {});
      this.player.wait();
      return this;
    }
  }
  const rule = {
    sourceSkill: 'conversion',
    filterCard: () => true,
    viewAs: { name: 'sha', nature: 'fire' },
  };
  class Client {
    id = 'actor';
    close() {}
  }
  const lib = {
    skill: { conversion: { chooseButton: { backup: () => rule } }, conversion_backup: rule },
    element: { GameEvent: Choice, Player, Client },
    playerOL: { actor, other },
    node: { torespond: waiting },
    message: { server: { reinited() {} } },
  };
  const choice = new Choice();
  globals(t, {
    partyEngine: { setup: { role: 'worker' }, proof: { started: true } },
    nativeFixture: {
      lib,
      get: { event: () => choice },
      withChoiceDisclosure: (_event: unknown, send: () => unknown) => send(),
    },
  });
  (await runtime('controls')).installRuleSkillChoices();
  (await runtime('selection-recovery')).installSelectionRecovery();
  assert.equal(choice.send(), choice);
  assert.equal(waits, 1);
  const request = sent[0]!.args;
  assert.equal(request[1], 'chooseToUse', 'native event identity remains recoverable');
  assert.deepEqual(request[3], [
    ...originalSet,
    ['_backupevent', choice.skill],
    ['openskilldialog', choice.openskilldialog],
  ]);
  assert.equal(request[4], 'encoded parent');
  assert.deepEqual(request[6], { rule: ['conversion_backup', rule] });
  assert.equal(request[7], nativeCallback);
  assert.equal(sent[1]!.args[0], nativeCallback, 'another seat never receives the actor backup');
  assert.equal(sent[1]!.args.length, 6);
  assert.deepEqual(originalSet, [['type', 'phase']], 'the original native request is not mutated');
  // Execute the trusted outbound callback as a freshly reconstructed phone.
  lib.skill.conversion_backup = { ...rule, viewAs: { name: 'jiu', nature: '' } };
  (request[0] as (...args: unknown[]) => void)(...request.slice(1));
  assert.equal(lib.skill.conversion_backup, rule);
  assert.deepEqual(applied, request.slice(1, 6));
  // Changing the worker's later rule must not change the retained request.
  lib.skill.conversion_backup = { ...rule, viewAs: { name: 'jiu', nature: '' } };
  const client = new Client();
  actor.ws = client;
  lib.message.server.reinited.call(client);
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[2]!.args, request);
  assert.equal(waits, 1, 'replay keeps the original timeout');
  actor.unwait({ bool: true });
  lib.message.server.reinited.call(client);
  assert.equal(sent.length, 3);
  choice._backup = undefined;
  choice.send();
  assert.equal(sent[3]!.args[0], nativeCallback, 'ordinary choices keep their native callback');
  assert.equal(sent[3]!.args.length, 6);
});

test('原生转化选择值保留闭包；刷新按同一已选颜色重建且拒绝客户端覆盖规则', async (t) => {
  const sent: unknown[][] = [];
  let closed = 0;
  let resumed = 0;
  let received = 0;
  class Player {
    playerid = 'actor';
    ws = { close: () => closed++ };
    applySkills() {}
    send(...args: unknown[]) {
      sent.push(args);
    }
    wait() {}
    unwait(_result?: unknown) {
      received++;
    }
    chooseToUse() {
      return new Choice();
    }
  }
  const actor = new Player();
  class Choice {
    player = actor;
    name = 'chooseToUse';
    skill = '';
    buttoned = 'conversion';
    _args = [];
    _set: [string, unknown][] = [['type', 'phase']];
    _result = { links: ['red'] };
    _backup: object | undefined;
    _modparent: unknown;
    _backupevent = '';
    set(key: string, value: unknown) {
      Object.assign(this, { [key]: value });
    }
    backup(skill: string) {
      this.skill = skill;
      this._backup = {};
      return this;
    }
    send() {
      actor.send(() => {}, this.name, this._args, this._set, 'original parent', {});
      actor.wait();
    }
  }
  const backup = (links: string[]) => ({
    sourceSkill: 'conversion',
    filterCard: (card: { color: string }) => card.color === links[0],
  });
  const lib = {
    skill: { conversion: { chooseButton: { backup } }, conversion_backup: backup(['red']) },
    element: { Player, GameEvent: Choice },
  };
  const status = { eventManager: { tempEvent: undefined as Choice | undefined } };
  globals(t, {
    partyEngine: { setup: { role: 'worker' } },
    nativeFixture: {
      lib,
      game: { me: actor, resume: () => resumed++ },
      ui: {},
      get: {},
      _status: status,
    },
  });
  (await runtime('controls')).installRuleSkillChoices();
  const choice = new Choice();
  choice.backup('conversion_backup');
  choice._result = { links: ['black'] };
  choice.send();
  const request = sent[0]!;
  assert.deepEqual(request[6], {
    recipe: { skill: 'conversion_backup', source: 'conversion', input: ['red'] },
  });
  assert.equal(actor.send, Player.prototype.send, 'the actor send override is temporary');
  lib.skill.conversion_backup = backup(['black']);
  (request[0] as (...args: unknown[]) => void)(...request.slice(1));
  assert(lib.skill.conversion_backup.filterCard({ color: 'red' }));
  assert(!lib.skill.conversion_backup.filterCard({ color: 'black' }));
  assert.equal(status.eventManager.tempEvent, undefined);
  assert.equal(resumed, 1);
  (request[0] as (...args: unknown[]) => void)(...request.slice(1));
  assert(
    lib.skill.conversion_backup.filterCard({ color: 'red' }),
    'recovery recreates the original closure',
  );
  actor.unwait({ bool: true, _sendskill: ['conversion_backup', {}] });
  assert.equal(closed, 1);
  assert.equal(received, 0, 'client backup definitions never reach native unwait');
  actor.unwait({ bool: true });
  assert.equal(received, 1);
});

test('原生技能选择刷新：原请求与期限保留，换席位、已提交和超时不重放', async (t) => {
  const sent: { id: string; name: string; parent: string }[] = [];
  let waits = 0;
  const waiting: Record<string, unknown> = {};
  class Player {
    playerid = 'actor';
    ws: Client | undefined;
    send(_callback: unknown, name: string, parent: string) {
      sent.push({ id: this.playerid, name, parent });
    }
    wait() {
      waits++;
      waiting[this.playerid] = '_noname_waiting';
    }
    unwait(result: unknown) {
      waiting[this.playerid] = result;
    }
  }
  const actor = new Player();
  class Choice {
    player = actor;
    name = 'chooseToMove_new';
    parent = 'original encoded parent';
    send() {
      this.player.send(() => {}, this.name, this.parent);
      this.player.wait();
    }
  }
  class Client {
    id = 'actor';
    close() {
      actor.unwait('ai');
    }
  }
  const lib = {
    element: { Player, GameEvent: Choice, Client },
    playerOL: { actor },
    node: { torespond: waiting },
    message: { server: { reinited() {} } },
  };
  // The fixture is already playing, as opposed to startup chooseButtonOL.
  globals(t, {
    partyEngine: { proof: { started: true } },
    nativeFixture: {
      lib,
      get: { event: () => choice },
      withChoiceDisclosure: (_event: unknown, send: () => unknown) => send(),
    },
  });
  const { installSelectionRecovery } = await runtime('selection-recovery');
  installSelectionRecovery();
  const choice = new Choice();
  const old = new Client();
  actor.ws = old;
  choice.send();
  choice.parent = 'parent advanced during reconnect';
  assert.equal(waits, 1);
  old.close();
  assert.equal(waiting.actor, '_noname_waiting', 'disconnect must not consume the pending skill');
  const replacement = new Client();
  lib.message.server.reinited.call(replacement);
  assert.equal(sent.length, 1, 'unbound connection cannot receive the private choice');
  actor.ws = replacement;
  lib.message.server.reinited.call(replacement);
  assert.deepEqual(sent, [
    { id: 'actor', name: 'chooseToMove_new', parent: 'original encoded parent' },
    { id: 'actor', name: 'chooseToMove_new', parent: 'original encoded parent' },
  ]);
  assert.equal(waits, 1, 'replay must not reset the original native timer');
  actor.unwait({ bool: true });
  lib.message.server.reinited.call(replacement);
  assert.equal(sent.length, 2, 'submitted choice cannot reopen');
  choice.send();
  actor.unwait('ai');
  lib.message.server.reinited.call(replacement);
  assert.equal(sent.length, 3, 'timeout cannot reopen a choice or extend its deadline');
});

test('原生视频编号弹窗：刷新先恢复本人私有弹窗，保留有界更新，关闭后不再重放', async (t) => {
  const sent: unknown[][] = [];
  const waiting: Record<string, unknown> = {};
  class Player {
    playerid = 'actor';
    ws: object = {};
    send(...args: unknown[]) {
      sent.push(args);
    }
    wait() {
      waiting.actor = '_noname_waiting';
    }
    unwait(result: unknown) {
      waiting.actor = result;
    }
  }
  const actor = new Player();
  class Choice {
    player = actor;
    name = 'chooseButton';
    send() {
      actor.send(() => {}, this.name);
      actor.wait();
    }
  }
  class Client {
    id = 'actor';
    close() {
      actor.unwait('ai');
    }
  }
  const lib = {
    element: { Player, GameEvent: Choice, Client },
    playerOL: { actor },
    node: { torespond: waiting },
    message: { server: { reinited() {} } },
  };
  const choice = new Choice();
  globals(t, {
    // Huashen can also run before the initial native deal is confirmed.
    partyEngine: { proof: { started: false } },
    nativeFixture: {
      lib,
      get: { event: () => choice, idDialog: () => ({ isConnected: true }) },
      withChoiceDisclosure: (event: Choice, send: () => unknown) => {
        assert.equal(event.player, actor);
        return send();
      },
    },
  });
  (await runtime('selection-recovery')).installSelectionRecovery();
  // These callbacks are never executed by the fixture; they stand for the
  // native actor-addressed creation/update protocol used by Huashen.
  const create = new Function(
    'id',
    'const dialog = ui.create.dialog("choice"); dialog.videoId = id;',
  );
  const update = new Function('index', 'id', 'get.idDialog(id).dataset.current = index;');
  actor.send(create, 7);
  for (let index = 0; index < 30; index++) actor.send(update, index, 7);
  choice.send();
  const originalChoice = sent.at(-1);
  actor.send(update, 99, 7);
  sent.length = 0;
  const replacement = new Client();
  actor.ws = replacement;
  lib.message.server.reinited.call(replacement);
  assert.equal(sent.length, 17, 'private dialog updates remain bounded plus one original request');
  assert.equal(sent[0]![0], create, 'native creation must precede ID-based choice');
  assert.deepEqual(sent.at(-1), originalChoice);
  actor.send('closeDialog', 7);
  actor.unwait({ bool: true });
  choice.send();
  sent.length = 0;
  lib.message.server.reinited.call(replacement);
  assert.equal(sent.length, 1, 'closed private dialogs cannot reappear for later choices');
});

test('火攻弃牌刷新：仅恢复仍打开且已公开的展示牌，沿用原编号和等待', async (t) => {
  const sent: unknown[][] = [];
  const waiting: Record<string, unknown> = {};
  let waits = 0;
  let connected = true;
  let known = true;
  class Player {
    playerid = 'actor';
    ws: object = {};
    send(...args: unknown[]) {
      sent.push(args);
    }
    wait() {
      waits++;
      waiting.actor = '_noname_waiting';
    }
    unwait(result: unknown) {
      waiting.actor = result;
    }
  }
  const actor = new Player();
  const shown = { isKnownBy: (receiver: unknown) => known && receiver === actor };
  const parent: any = { name: 'huogong', player: actor, cards2: [shown], videoId: 7 };
  class Choice {
    player = actor;
    name = 'chooseToDiscard';
    getParent(name: string) {
      return name === 'huogong' ? parent : undefined;
    }
    send() {
      actor.send(() => {}, this.name);
      actor.wait();
    }
  }
  class Client {
    id = 'actor';
    close() {
      actor.unwait('ai');
    }
  }
  const lib = {
    element: { Player, GameEvent: Choice, Client },
    playerOL: { actor },
    node: { torespond: waiting },
    message: { server: { reinited() {} } },
  };
  globals(t, {
    partyEngine: { proof: { started: true } },
    nativeFixture: {
      lib,
      get: { event: () => choice, idDialog: () => ({ isConnected: connected }) },
      withChoiceDisclosure: (_event: unknown, send: () => unknown) => send(),
    },
  });
  (await runtime('selection-recovery')).installSelectionRecovery();
  const choice = new Choice();
  choice.send();
  sent.length = 0;
  const client = new Client();
  actor.ws = client;
  lib.message.server.reinited.call(client);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0]!.slice(1), [[shown], 7]);
  assert.equal(sent[1]![1], 'chooseToDiscard');
  assert.equal(waits, 1);
  for (const reason of ['closed', 'hidden', 'other-actor', 'other-choice', 'extra-material']) {
    connected = reason !== 'closed';
    known = reason !== 'hidden';
    parent.player = reason === 'other-actor' ? {} : actor;
    parent.cards2 = reason === 'extra-material' ? [shown, shown] : [shown];
    choice.name = reason === 'other-choice' ? 'chooseCard' : 'chooseToDiscard';
    sent.length = 0;
    lib.message.server.reinited.call(client);
    assert.equal(sent.length, 1, reason);
  }
  actor.unwait({ bool: true });
  sent.length = 0;
  lib.message.server.reinited.call(client);
  assert.equal(sent.length, 0, '已提交不重弹');
});

test('宴戏公开池刷新：本人恢复原猜牌、旁人恢复三明牌，关闭／非公开材料不重建', async (t) => {
  const sent: unknown[][] = [];
  const waiting: Record<string, unknown> = {};
  let waits = 0;
  let connected = true;
  const publicDialog = {
    videoId: 17,
    get isConnected() {
      return connected;
    },
  };
  class Player {
    ws: object = {};
    constructor(public playerid: string) {}
    send(...args: unknown[]) {
      sent.push(args);
    }
    wait() {
      waits++;
      waiting[this.playerid] = '_noname_waiting';
    }
    unwait(result: unknown) {
      waiting[this.playerid] = result;
    }
  }
  const actor = new Player('actor');
  const viewer = new Player('viewer');
  const cards = [{ cardid: 'public1' }, { cardid: 'public2' }, { cardid: 'public3' }];
  const privateHand = { cardid: 'private4' };
  const parent: any = {
    name: 'yanxi',
    player: actor,
    target: viewer,
    partyShownYanxiCards: cards,
    otherHand: [privateHand],
  };
  class Choice {
    player = actor;
    name = 'chooseButton';
    _set: unknown[][] = [['dialog', 17]];
    dialog: number | typeof publicDialog | undefined = publicDialog;
    getParent(name: string) {
      return name === 'yanxi' ? parent : undefined;
    }
    send() {
      actor.send(() => {}, this.name);
      actor.wait();
    }
  }
  class Client {
    constructor(public id: string) {}
    close() {}
  }
  const lib = {
    element: { Player, GameEvent: Choice, Client },
    playerOL: { actor, viewer },
    node: { torespond: waiting },
    message: { server: { reinited() {} } },
  };
  const choice = new Choice();
  globals(t, {
    partyEngine: { proof: { started: true } },
    nativeFixture: {
      lib,
      get: { event: () => choice, idDialog: () => publicDialog },
      withChoiceDisclosure: (_event: unknown, send: () => unknown) => send(),
    },
  });
  (await runtime('selection-recovery')).installSelectionRecovery();
  choice.send();
  const actorClient = new Client('actor');
  actor.ws = actorClient;
  sent.length = 0;
  lib.message.server.reinited.call(actorClient);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0]!.slice(1), [cards, 17, actor, viewer, true]);
  assert.equal(sent[1]![1], 'chooseButton');
  assert.equal(waits, 1);
  const viewerClient = new Client('viewer');
  viewer.ws = viewerClient;
  sent.length = 0;
  lib.message.server.reinited.call(viewerClient);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.slice(1), [cards, 17, actor, viewer, false]);
  assert(!JSON.stringify(sent[0]![1]).includes(privateHand.cardid));
  assert.equal(waits, 1, 'public pool restoration creates no new choice or wait');
  sent.length = 0;
  lib.message.server.reinited.call(new Client('viewer'));
  assert.equal(sent.length, 0, 'only the bound reinitialized seat receives materials');
  for (const boundary of [
    'closed',
    'not-published',
    'wrong-choice',
    'wrong-skill',
    'no-video-id',
    'other-dialog',
  ]) {
    connected = boundary !== 'closed';
    parent.partyShownYanxiCards = boundary === 'not-published' ? [privateHand] : cards;
    choice.name = boundary === 'wrong-choice' ? 'chooseToMove' : 'chooseButton';
    parent.name = boundary === 'wrong-skill' ? 'privateSkill' : 'yanxi';
    choice._set = boundary === 'no-video-id' ? [] : [['dialog', 17]];
    choice.dialog = boundary === 'other-dialog' ? { videoId: 18, isConnected: true } : publicDialog;
    sent.length = 0;
    lib.message.server.reinited.call(actorClient);
    assert.equal(sent.length, 1, boundary + ': pending request alone is retained');
    sent.length = 0;
    lib.message.server.reinited.call(viewerClient);
    assert.equal(sent.length, 0, boundary + ': no other public dialog is guessed');
  }
  actor.unwait({ bool: true });
  connected = false;
  sent.length = 0;
  lib.message.server.reinited.call(actorClient);
  assert.equal(sent.length, 0, 'closed completed choices stay closed');
});

test('共享将池冲突重试：重发原请求的剩余候选，保留原等待与期限，已选和换席位拒绝', async (t) => {
  const sent: unknown[][] = [];
  const waiting: Record<string, unknown> = {};
  let waits = 0;
  class Player {
    playerid = 'actor';
    ws: object = {};
    send(...args: unknown[]) {
      sent.push(args);
    }
    wait() {
      waits++;
      waiting.actor = Object.assign(() => {}, { _noname_waiting: true });
    }
    unwait(result: unknown) {
      waiting.actor = result;
    }
  }
  class Choice {
    send() {}
  }
  class Client {
    close() {}
  }
  const actor = new Player();
  const lib = {
    element: { Player, GameEvent: Choice, Client },
    playerOL: { actor },
    node: { torespond: waiting },
    message: { server: { reinited() {} } },
  };
  globals(t, {
    partyEngine: { proof: { started: false } },
    nativeFixture: {
      lib,
      get: { event: () => ({ name: 'chooseButtonOL' }) },
      withChoiceDisclosure: (_event: unknown, send: () => unknown) => send(),
    },
  });
  const recovery = (await runtime('selection-recovery')).installSelectionRecovery();
  const callback = () => {};
  const candidates = ['liubei', 'guanyu', 'zhangfei'];
  const dialog = ['队友正在选将', [candidates, 'character']];
  const args = [dialog, true, 1];
  actor.wait();
  actor.send(callback, args);
  const originalWaiting = waiting.actor;
  candidates.splice(0, 1);
  dialog[0] = '队友已选刘备';
  assert.equal(recovery.replay(new Player()), false, 'same ID cannot bypass the bound actor');
  assert.equal(recovery.replay(actor), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1]![0], callback);
  assert.equal(sent[1]![1], args);
  assert.equal(waiting.actor, originalWaiting);
  assert.equal(waits, 1, 'retry never calls wait or replaces the original timer');
  actor.unwait({ bool: true, links: ['guanyu'] });
  assert.equal(recovery.replay(actor), false);
  actor.wait();
  actor.send(callback, args);
  actor.unwait('ai');
  assert.equal(recovery.replay(actor), false, 'expired choice cannot reopen');
});

test('蛊惑质疑直发选择：断线恢复原请求，保留期限，其他弹窗及已提交／超时请求不重放', async (t) => {
  const sent: unknown[][] = [];
  const waiting: Record<string, unknown> = {};
  let waits = 0;
  let event = { name: 'chooseButtonOL', getParent: () => ({ name: 'reguhuo_guess' }) };
  class Player {
    playerid = 'challenger';
    ws: object = {};
    send(...args: unknown[]) {
      sent.push(args);
    }
    wait() {
      waits++;
      waiting.challenger = Object.assign(() => {}, { _noname_waiting: true });
    }
    unwait(result: unknown) {
      waiting.challenger = result;
    }
  }
  class Choice {
    send() {}
  }
  const actor = new Player();
  class Client {
    id = 'challenger';
    close() {
      actor.unwait('ai');
    }
  }
  const lib = {
    element: { Player, GameEvent: Choice, Client },
    playerOL: { challenger: actor },
    node: { torespond: waiting },
    message: { server: { reinited() {} } },
  };
  globals(t, {
    partyEngine: { proof: { started: true } },
    nativeFixture: {
      lib,
      get: { event: () => event },
      withChoiceDisclosure: (_event: unknown, send: () => unknown) => send(),
    },
  });
  const recovery = (await runtime('selection-recovery')).installSelectionRecovery();
  const chooseRemote = () => {};
  const args = [['是否质疑', [['质疑', '不质疑'], 'textbutton']], true, 1];
  const request = [chooseRemote, args, undefined, undefined, undefined];
  const old = new Client();
  actor.ws = old;
  actor.wait();
  const originalWaiting = waiting.challenger;
  actor.send(...request);
  // A later unrelated private dialog must not replace the original challenge.
  event = { name: 'chooseButtonOL', getParent: () => ({ name: 'otherSkill' }) };
  actor.send(() => {}, ['unrelated dialog'], undefined, undefined, undefined);
  old.close();
  assert.equal(waiting.challenger, originalWaiting);
  const replacement = new Client();
  lib.message.server.reinited.call(replacement);
  assert.equal(sent.length, 2, 'unbound replacement cannot receive the request');
  actor.ws = replacement;
  lib.message.server.reinited.call(replacement);
  assert.deepEqual(sent.at(-1), request);
  assert.equal(waits, 1, 'reinit does not create a new wait or deadline');
  actor.unwait({ bool: true, links: ['质疑'] });
  assert.equal(recovery.replay(actor), false, 'submitted challenge stays closed');
  event = { name: 'chooseButtonOL', getParent: () => ({ name: 'reguhuo_guess' }) };
  actor.wait();
  actor.send(...request);
  actor.unwait('ai');
  assert.equal(recovery.replay(actor), false, 'native timeout stays final');
  event = { name: 'chooseButtonOL', getParent: () => ({ name: 'otherSkill' }) };
  actor.wait();
  actor.send(...request);
  assert.equal(recovery.replay(actor), false, 'unreviewed direct choices are not retained');
  event = { name: 'chooseButtonOL', getParent: () => ({ name: 'reguhuo_guess' }) };
  actor.send(chooseRemote, args);
  assert.equal(recovery.replay(actor), false, 'non-native dialog shape is not a challenge');
});

test('公开观战投影：暗手牌、私有 storage、未亮身份与私人选牌不进入观察者数据', async (t) => {
  const hiddenCard = { name: 'secret-card' };
  const player = {
    playerid: 'seat',
    nickname: '<img src=x>',
    name: 'caocao',
    identity: 'nei',
    identityShown: false,
    hp: 3,
    maxHp: 4,
    hujia: 1,
    isDead: () => false,
    isLinked: () => false,
    isTurnedOver: () => false,
    isUnseen: () => false,
    countCards: (position: string) => {
      assert.equal(position, 'h');
      return 1;
    },
    getCards: (position: string) => {
      assert.notEqual(position, 'h');
      return position === 'e' ? [{ name: 'zhuge' }] : [];
    },
    get storage(): never {
      return assert.fail('must never read private skill storage');
    },
  };
  const status = { over: false, currentPhase: player };
  globals(t, {
    nativeFixture: {
      game: { players: [player], dead: [], roundNumber: 2 },
      get: { translation: (text: string) => text },
      _status: status,
    },
  });
  const { publicObserverState } = await runtime('observer');
  const state = publicObserverState();
  assert.equal(state.players[0].identity, '身份未公开');
  assert.equal(state.players[0].handCount, 1);
  assert.equal(state.players[0].general, 'caocao');
  assert(!JSON.stringify(state).includes(hiddenCard.name));
  assert(!JSON.stringify(state).includes('nei'));
  assert(!JSON.stringify(state).includes('storage'));
  player.identityShown = true;
  assert.equal(publicObserverState().players[0].identity, 'nei2');
  player.isUnseen = () => true;
  assert.equal(publicObserverState().players[0].general, '未亮将');
});

test('公开日志捕捉短事件与虚拟牌，整局分批保留；暗牌、观星与未知对象不泄露', async (t) => {
  const player = (id: string) => ({
    kind: 'player',
    playerid: id,
    nickname: id,
    name: 'public-general',
    identity: 'nei',
    identityShown: false,
    hp: 3,
    maxHp: 4,
    hujia: 0,
    isAuto: false,
    ws: { closed: false },
    isDead: () => false,
    isLinked: () => false,
    isTurnedOver: () => false,
    isUnseen: () => false,
    countCards: () => 2,
    getCards: () => [],
    get storage(): never {
      return assert.fail('private storage must not be read');
    },
  });
  const actor = player('a'),
    target = player('b');
  const hidden = { kind: 'card', name: 'SECRET-HAND', position: 'h' };
  const ordering = { kind: 'card', name: 'SECRET-DECK', position: 'o' };
  const shown = { kind: 'card', name: 'PUBLIC-CARD', position: 'h' };
  const virtual = { name: 'PUBLIC-VIRTUAL' };
  let event: any = { name: 'chooseToMove' };
  let originalCalls = 0;
  class Client {
    close() {}
  }
  const lib = { configOL: { gameStarted: true }, element: { Client }, message: { server: {} } };
  const game = {
    players: [actor, target],
    dead: [],
    roundNumber: 1,
    log: (..._args: unknown[]) => {
      originalCalls++;
      return 'native-result';
    },
  };
  const status = { over: false, currentPhase: actor };
  const window = new EventTarget();
  globals(t, {
    window,
    partyEngine: {
      setup: {
        seats: [
          { id: 'a', nickname: '<img src=x>', kind: 'human' },
          { id: 'b', nickname: '目标', kind: 'human' },
        ],
      },
      proof: { started: true },
    },
    nativeFixture: {
      lib,
      game,
      _status: status,
      get: {
        event: () => event,
        position: (card: { position: string }) => card.position,
        is: { shownCard: () => false },
        itemtype: (value: any) =>
          Array.isArray(value) && value.every((item) => item?.kind === 'card')
            ? 'cards'
            : value?.kind,
        translation: (value: string | { name: string }) =>
          typeof value === 'string' ? value : value.name,
      },
    },
  });
  t.after(() => window.dispatchEvent(new Event('pagehide')));
  const { installObserver, observerCardVisible } = await runtime('observer');
  const journal = new ObserverJournal();
  const update = installObserver((state: Parameters<ObserverJournal['append']>[0]) => {
    assert(
      Buffer.byteLength(JSON.stringify(state)) < 131072,
      'observer batches fit the native gateway frame limit',
    );
    journal.append(state);
  });
  assert.equal(
    game.log(actor, '获得', hidden, ordering, { storage: 'SECRET-STORAGE' }),
    'native-result',
  );
  assert.equal(observerCardVisible(ordering), false);
  event = { name: 'useCard', cards: [shown], card: virtual };
  game.log(actor, '对', target, '使用了', virtual, shown);
  for (const message of ['摸了两张牌', '发动【公开技能】', '受到一点伤害', '濒死', '阵亡'])
    game.log(actor, message);
  for (let index = 0; index < 250; index++) game.log(`短暂事件 ${index}`);
  for (let index = 0; index < 64; index++) game.log(`长事件 ${index} ${'\u0001'.repeat(500)}`);
  update();
  update();
  let before: number | undefined;
  const all = [];
  do {
    const page = journal.page('match', before);
    all.unshift(...page.entries);
    before = page.entries[0]?.sequence;
  } while (before && before > 1);
  assert.equal(
    all.length,
    originalCalls,
    'every native log survives timer intervals and duplicate previews',
  );
  assert.deepEqual(
    all.map((entry) => entry.sequence),
    Array.from({ length: originalCalls }, (_, index) => index + 1),
  );
  const text = all.map((entry) => entry.text).join('\n');
  assert(text.includes('<img src=x>（public-general）对目标'));
  assert(text.includes('PUBLIC-VIRTUAL') && text.includes('PUBLIC-CARD'));
  assert(text.includes('伤害') && text.includes('阵亡') && text.includes('短暂事件 0'));
  assert(!text.includes('SECRET') && !text.includes('nei'));
  const revealed = [
    { kind: 'card', name: 'PUBLIC-YANXI-HAND', position: 'h' },
    { kind: 'card', name: 'PUBLIC-YANXI-TOP-1', position: 'c' },
    { kind: 'card', name: 'PUBLIC-YANXI-TOP-2', position: 'c' },
  ];
  event = { name: 'yanxi', player: actor };
  game.log(actor, '展示了', revealed);
  update();
  const displayed = journal.page('match').entries.at(-1)!.text;
  assert(revealed.every((card) => displayed.includes(card.name)));
  assert.equal(observerCardVisible(hidden), false);
  assert.equal(observerCardVisible(ordering), false);
  const bluff = {
    name: 'reguhuo_guess',
    _trigger: { cards: [hidden] },
    getParent: () => ({ name: 'useCard', cards: [hidden] }),
  };
  event = { name: 'chooseButtonOL', getParent: () => bluff };
  assert.equal(observerCardVisible(hidden), false, 'challenge does not reveal the bluff');
  event = { name: 'showCards', cards: [hidden], getParent: () => bluff };
  assert.equal(observerCardVisible(hidden), true, 'native reveal makes that material public');
  event = { name: 'chooseToMove' };
  status.over = true;
  assert.equal(observerCardVisible(hidden), false, 'ending does not reveal concealed faces');
});

test('公网推送接管正在等待的 HTTP 读取；推送中断后同通道继续，不重复 open 或消息', async (t) => {
  let incoming: ((packet: unknown) => void) | undefined;
  let nativeSocket: { onclose?: (event: { code: number; reason: string }) => void };
  class Socket {
    onmessage?: (event: { data: string }) => void;
    onclose?: (event: { code: number; reason: string }) => void;
    constructor() {
      nativeSocket = this;
      incoming = (packet) => this.onmessage?.({ data: JSON.stringify(packet) });
      setTimeout(() => {
        incoming?.({ type: 'opened' });
        incoming?.({
          type: 'frames',
          messages: [
            { sequence: 1, sentAt: 0, data: 'stream-one' },
            { sequence: 2, sentAt: 0, data: 'stream-two' },
          ],
        });
      }, 10);
    }
    send() {}
    close() {}
  }
  class Close extends Event {
    constructor(
      type: string,
      public init: unknown,
    ) {
      super(type);
    }
  }
  let reads = 0;
  let opens = 0;
  const parent = Object.assign(new EventTarget(), { postMessage: () => {} });
  const window = Object.assign(new EventTarget(), { parent });
  globals(t, {
    WebSocket: Socket,
    CloseEvent: Close,
    window,
    document: Object.assign(new EventTarget(), { hidden: true }),
    location: { origin: 'http://fixture' },
    sessionStorage: { getItem: () => null },
    partyEngine: { setup: { id: 'match', playerStreaming: true, playerNetwork: 'internet' } },
    fetch: async (_url: string, options: { method: string; signal: AbortSignal }) => {
      if (options.method === 'POST') {
        opens++;
        return { ok: true, json: async () => ({ closed: false }) };
      }
      if (options.method === 'DELETE') return { ok: true };
      if (++reads === 2)
        return {
          ok: true,
          json: async () => ({
            messages: [
              { sequence: 2, data: 'stream-two' },
              { sequence: 3, data: 'http-three' },
            ],
          }),
        };
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('cancelled'))),
      );
    },
  });
  const { PlayerTransport } = await runtime('player-transport');
  const socket = new PlayerTransport('ws://fixture/engine/socket/match/player');
  t.after(() => socket.close());
  let openEvents = 0;
  socket.onopen = () => openEvents++;
  const messages: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('transport did not resume')), 2000);
    socket.onmessage = (event: MessageEvent) => {
      messages.push(event.data);
      if (event.data === 'stream-two')
        setTimeout(() => nativeSocket.onclose?.({ code: 1006, reason: '' }), 0);
      if (event.data === 'http-three') {
        clearTimeout(timeout);
        socket.close();
        resolve();
      }
    };
  });
  assert.deepEqual(messages, ['stream-one', 'stream-two', 'http-three']);
  assert.equal(opens, 1);
  assert.equal(openEvents, 1);
  assert.equal(reads, 2);
});

test('公网连续动作无需逐条等待 ACK，丢失确认后按序重试，不重复提交且保留原通道', async (t) => {
  globals(t, {
    WebSocket: class {},
    window: Object.assign(new EventTarget(), { parent: { postMessage: () => {} } }),
    sessionStorage: { getItem: () => null },
    location: { origin: 'http://fixture' },
    CloseEvent: class extends Event {},
  });
  const { PlayerTransport } = await runtime('player-transport');
  const socket = new PlayerTransport('ws://fixture/engine/socket/match/player');
  socket.start = () => {};
  socket.readyState = 1;
  socket.polling = true;
  socket.route = 'internet';
  socket.streamOpen = true;
  const acknowledgements = new Map<number, () => void>();
  const applied: number[] = [];
  const delivered: number[] = [];
  let incoming = 0;
  const apply = (sequence: number) => {
    if (sequence === incoming + 1) {
      incoming = sequence;
      applied.push(sequence);
    } else assert(sequence <= incoming, 'no gap or out-of-order actions');
  };
  socket.streamSocket = {
    send: (json: string) => {
      const packet = JSON.parse(json);
      delivered.push(packet.sequence);
      apply(packet.sequence);
      acknowledgements.set(packet.sequence, () => {
        const pending = socket.streamPending.get(`action-${packet.sequence}`);
        clearTimeout(pending.timer);
        socket.streamPending.delete(`action-${packet.sequence}`);
        pending.resolve({ status: 200 });
      });
    },
    close: () => {},
  };
  t.after(() => socket.finish(1000, ''));
  const originalChannel = socket.channel;
  socket.send('first');
  await tick();
  socket.send('second');
  await tick();
  assert.deepEqual(delivered, [1, 2], 'second packet already sent before first ACK');
  acknowledgements.get(1)!();
  await tick();
  const retried: number[] = [];
  socket.request = async (_method: string, body: { sequence: number }) => {
    retried.push(body.sequence);
    apply(body.sequence);
    return {};
  };
  socket.stopStream();
  let lateSent = false;
  (globalThis as unknown as { window: EventTarget }).window.addEventListener(
    'party-action-ack',
    () => {
      if (!socket.outgoing.length && !lateSent) {
        lateSent = true;
        queueMicrotask(() => socket.send('fourth-after-ack'));
      }
    },
  );
  socket.send('third');
  await socket.sending;
  await tick();
  assert.deepEqual(retried, [2, 3, 4]);
  assert.deepEqual(applied, [1, 2, 3, 4]);
  assert.equal(socket.channel, originalChannel);
  assert.equal(socket.readyState, 1);
});

async function promptFixture(t: TestContext) {
  let parent: { name: string };
  class Choice {
    prompt?: string | false;
    prompt2?: string | false;
    selectCard?: number | number[];
    filterCard?: unknown;
    choiceList?: string[];
    sets: [string, unknown][] = [];
    _set = this.sets;
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
      const choice = new Choice('chooseUseTarget');
      choice.prompt = '是否使用一张【杀】？';
      return choice;
    }
  }
  const get = {
    cnNumber: (num: number) => ['零', '一', '两', '三'][num] ?? String(num),
    name: (card: unknown) =>
      typeof card === 'object' && card ? String(Reflect.get(card, 'name')) : String(card),
  };
  globals(t, {
    nativeFixture: {
      lib: { element: { Player, GameEvent: Choice } },
      get,
    },
  });
  (await runtime('prompts')).installPrompts();
  return {
    Choice,
    Player,
    get,
    parent: (name: string) => {
      parent = { name };
    },
  };
}

test('响应提示随最终过滤与数量发送；南蛮/万箭/决斗区分杀闪，乱武区分最近目标与额外出杀', async (t) => {
  const fixture = await promptFixture(t);
  const { Player, get } = fixture;
  const player = new Player();
  for (const [name, card] of [
    ['nanman', '杀'],
    ['wanjian', '闪'],
    ['juedou', '杀'],
  ]) {
    fixture.parent(name!);
    const event = player.chooseToRespond();
    // Native filters are added after construction; serialization must still
    // include explicit text so remote reconstruction cannot revert to “牌”.
    event.set(
      'filterCard',
      card === '杀'
        ? function (card: unknown) {
            return get.name(card) === 'sha';
          }
        : function (card: unknown) {
            return get.name(card) === 'shan';
          },
    );
    event.set('selectCard', [2, 2]);
    event.set('prompt2', '共需依次打出两张响应牌');
    assert(
      event
        .send()
        .some(([key, value]) => key === 'prompt' && String(value).includes(`两张【${card}】`)),
    );
    assert.equal(event.prompt2, '共需依次打出两张响应牌');
    const once = event.sets.length;
    event.send();
    assert.equal(event.sets.length, once, 'repeated sends do not accumulate duplicate text');
  }
  fixture.parent('reluanwu');
  const forced = player.chooseToUse();
  assert.match(String(forced.prompt), /距离最近.*失去1点体力/);
  assert.match(String(forced.prompt2), /合法目标/);
  fixture.parent('reluanwuContentAfter');
  const extra = player.chooseUseTarget();
  assert.match(String(extra.prompt), /视为使用.*无距离限制.*取消则跳过/);
  assert.match(String(extra.prompt2), /无需提供手牌/);
  fixture.parent('other-skill');
  assert.equal(player.chooseToRespond().prompt, '请打出一张牌');
});

test('最终选择文案直接赋值也传到手机，保留分支标签与 false；不携带额外规则或私有状态', async (t) => {
  const fixture = await promptFixture(t);
  fixture.parent('custom-skill');
  for (const name of [
    'chooseCard',
    'chooseTarget',
    'chooseControl',
    'chooseBool',
    'chooseToGive',
    'discardPlayerCard',
  ]) {
    const event = new fixture.Choice(name);
    event.set('prompt', '旧提示');
    event.prompt = '只选装备区的一张牌';
    event.prompt2 = '取消则跳过';
    event.choiceList = ['选项一：摸牌', '选项二：回复体力'];
    Object.assign(event, { privateCards: ['secret'], filterTarget: () => true });
    const transmitted = Object.fromEntries(event.send());
    assert.equal(transmitted.prompt, event.prompt);
    assert.equal(transmitted.prompt2, event.prompt2);
    assert.deepEqual(transmitted.choiceList, event.choiceList);
    assert(!('privateCards' in transmitted));
    assert(!('filterTarget' in transmitted));
    event.prompt = false;
    event.prompt2 = false;
    assert.equal(Object.fromEntries(event.send()).prompt, false);
    assert.equal(Object.fromEntries(event.send()).prompt2, false);
  }
  const rule = new fixture.Choice('useCard');
  rule.prompt = '规则内部文字';
  assert.deepEqual(rule.send(), []);
});

test('明确或关闭的提示、变化后的过滤器不被通用响应文案覆盖', async (t) => {
  const fixture = await promptFixture(t);
  const { get } = fixture;
  fixture.parent('nanman');
  const event = new fixture.Player().chooseToRespond();
  event.set('filterCard', function (card: unknown) {
    return get.name(card) === 'shan';
  });
  event.send();
  assert.equal(event.prompt, '请打出一张牌', 'unrecognized response requirement stays native');
  for (const prompt of ['技能修改后的特殊响应', false] as const) {
    event.prompt = prompt;
    event.set('filterCard', function (card: unknown) {
      return get.name(card) === 'sha';
    });
    assert.equal(Object.fromEntries(event.send()).prompt, prompt);
  }
  fixture.parent('reluanwu');
  const luanwu = new fixture.Player().chooseToUse();
  luanwu.prompt = '另一技能追加的选择';
  luanwu.prompt2 = '追加的条件';
  assert.equal(Object.fromEntries(luanwu.send()).prompt, luanwu.prompt);
  assert.equal(luanwu.prompt2, '追加的条件');
});

test('界挑衅提示造成伤害条件；界明策区分虚拟杀与双方摸牌，过滤器保持原样', async (t) => {
  const fixture = await promptFixture(t);
  fixture.parent('oltiaoxin');
  const tiaoxin = new fixture.Choice('chooseToUse');
  tiaoxin.prompt = '挑衅：对甲使用一张杀，或令其弃置你的一张牌';
  const filter = () => true;
  tiaoxin.set('filterCard', filter);
  const transmitted = Object.fromEntries(tiaoxin.send());
  assert.match(String(transmitted.prompt), /使用一张【杀】并造成伤害，否则.*弃置/);
  assert.equal(transmitted.filterCard, filter);
  fixture.parent('remingce');
  const mingce = new fixture.Choice('chooseControl');
  mingce.prompt = '对乙使用一张杀，或摸一张牌';
  mingce.choiceList = ['视为对乙使用一张【杀】，若此杀造成伤害则执行选项二', '你与甲各摸一张牌'];
  const choices = Object.fromEntries(mingce.send());
  assert.equal(choices.prompt, '明策：请选择一项');
  assert.match(String(choices.prompt2), /无需提供.*造成伤害.*各摸一张牌/);
  assert.deepEqual(choices.choiceList, mingce.choiceList);
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

test('私有牌面选择按原生声明授权：魄袭/攻心可看具体材料，暗选、旁人及选择结束仍遮盖', async (t) => {
  type Card = {
    kind: string;
    cardid: string;
    name: string;
    position: string;
    isKnownBy(): boolean;
  };
  const cards: Card[] = ['shown-a', 'shown-b', 'blank', 'unrelated'].map((cardid) => ({
    kind: 'card',
    cardid,
    name: cardid,
    position: 'h',
    isKnownBy: () => false,
  }));
  const buttons = cards.slice(0, 3).map((link, index) => ({
    link,
    classList: { contains: (name: string) => index === 2 && name === 'blank' },
  }));
  const get = {
    itemtype: (value: unknown) => (value as Card)?.kind,
    position: (card: Card) => card.position,
    owner: () => target,
    event: () => undefined,
    mode: () => 'duel',
    cardInfoOL: (card: Card) =>
      '_noname_card:' + JSON.stringify([card.cardid, 'spade', 7, card.name, '']),
    cardInfo: (card: Card) => ['spade', 7, card.name, '', card.cardid],
    stringifiedResult: (value: unknown): unknown => {
      if ((value as Card)?.kind === 'card') return get.cardInfoOL(value as Card);
      if (Array.isArray(value)) return value.map((item) => get.stringifiedResult(item));
      return value;
    },
  };
  class Client {
    constructor(public id: string) {}
    send(...args: unknown[]) {
      return args.map((value) => get.stringifiedResult(value));
    }
  }
  class Player {
    constructor(public client: Client) {}
    send(...args: unknown[]) {
      return this.client.send(...args);
    }
    $compare() {}
    $compareMultiple() {}
  }
  const actor = new Player(new Client('actor'));
  const target = new Player(new Client('target'));
  const bystander = new Player(new Client('bystander'));
  class GameEvent {
    name = 'chooseButton';
    player = actor;
    dialog = { buttons };
    list: unknown[] = [
      ['目标手牌', cards.slice(0, 2)],
      [['弃置'], ['置于牌堆顶']],
    ];
    cards = cards.slice(0, 2);
    send() {
      // Include native card tuples and previously encoded parent cards, too.
      const encoded = cards.map((card) => get.cardInfoOL(card));
      const tuples = cards.map((card) => get.cardInfo(card));
      return { actor: this.player.send(cards, tuples, encoded), other: bystander.send(cards) };
    }
  }
  globals(t, {
    nativeFixture: {
      lib: {
        element: {
          Client,
          Player,
          GameEvent,
          Card: class {
            init() {}
          },
        },
        card: {},
        translate: {},
        playerOL: { actor, target, bystander },
        cardOL: Object.fromEntries(cards.map((card) => [card.cardid, card])),
      },
      get,
      _status: {},
    },
  });
  (await runtime('privacy')).installPrivacy();
  const choice = new GameEvent();
  const known = (value: unknown) => JSON.stringify(value).includes('"shown-a"');
  const named = (value: unknown, name: string) => {
    const faces: unknown[] = [];
    const visit = (item: unknown) => {
      if (typeof item === 'string' && item.startsWith('_noname_card:'))
        faces.push(JSON.parse(item.slice(13))[3]);
      else if (Array.isArray(item)) {
        if (item.length === 5 && ['spade', 'none'].includes(item[0])) faces.push(item[2]);
        else item.forEach(visit);
      }
    };
    visit(value);
    return faces.includes(name);
  };
  for (const method of [
    'chooseButton',
    'choosePlayerCard',
    'discardPlayerCard',
    'gainPlayerCard',
    'chooseToMove',
    'chooseToMove_new',
    'viewCards',
  ]) {
    choice.name = method;
    const result = choice.send();
    assert(known(result.actor), `${method} retains the declared card reference`);
    assert(
      named(result.actor, 'shown-a') && named(result.actor, 'shown-b'),
      `${method} reveals face-up materials`,
    );
    assert(!named(result.actor, 'blank') && !named(result.actor, 'unrelated'));
    assert(
      !named(result.other, 'shown-a') && !named(result.other, 'shown-b'),
      'bystander stays concealed during nested sends',
    );
    assert(
      !named(actor.send(cards), 'shown-a'),
      'authorization ends with the synchronous choice send',
    );
  }
  choice.name = 'chooseButton';
  choice.dialog.buttons = buttons.map((button) => ({
    ...button,
    classList: { contains: () => true },
  }));
  assert(!named(choice.send().actor, 'shown-a'), 'all-blank native choices stay concealed');
  choice.name = 'chooseToCompare';
  assert(
    !named(choice.send().actor, 'shown-a'),
    'a different event cannot use a face-up dialog as authorization',
  );
});

test('慢音频过期后不补播，静音后再开启也不会复活旧语音，载入与后台保持安静', async (t) => {
  let now = 0;
  let finishRead!: (value: unknown) => void;
  let reads = 0;
  let starts = 0;
  let outputGain = 0;
  const preferences = new Map<string, string>();
  const proof = { booted: false, audio: { dropped: 0, played: 0 } };
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: () => ({ pause() {} }),
  });
  class AudioContext {
    state = 'running';
    sampleRate = 48000;
    destination = {};
    currentTime = 0;
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
        gain: {
          set value(value: number) {
            outputGain = value;
          },
          setValueAtTime(value: number) {
            outputGain = value;
          },
        },
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
        disconnect() {},
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
      | {
          unlock(): Promise<void>;
          setEnabled(value: boolean): Promise<void>;
          setVolume(value: number): void;
        }
      | undefined,
  };
  globals(t, {
    window: Object.assign(new EventTarget(), { AudioContext }),
    document,
    parent: { postMessage() {} },
    location: { origin: 'http://fixture' },
    performance: { now: () => now },
    localStorage: {
      getItem: (key: string) => preferences.get(key) ?? null,
      setItem: (key: string, value: string) => preferences.set(key, value),
    },
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
  assert.equal(outputGain, 0.35, 'first use has a quieter master gain');
  engine.audio!.setVolume(15);
  assert.equal(outputGain, 0.15, 'the existing master output changes immediately');
  assert.equal(preferences.get('party_sound_volume'), '15');
  engine.audio!.setVolume(NaN);
  assert.equal(outputGain, 0.15, 'invalid control values cannot corrupt the gain');
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
