import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';

async function fixture(t: TestContext, mode: string, seats: any[]) {
  let now = 100000;
  let sequence = 0;
  let tick = () => {};
  const sent = new Map<string, any>();
  const status = { over: false };
  const revealed = { count: 0 };
  const players = seats.map((seat) => ({
    playerid: seat.id,
    identity: seat.identity,
    side: seat.side,
    hp: 4,
    ws: { id: seat.id, closed: false },
    isDead() {
      return !game.players.includes(this);
    },
    send(_fn: unknown, state: unknown) {
      sent.set(seat.id, state);
    },
  }));
  const lib: any = {
    playerOL: Object.fromEntries(players.map((player) => [player.playerid, player])),
    message: {
      server: {
        reinited() {},
        giveup() {
          throw new Error('legacy death bypass');
        },
      },
    },
    onover: [],
    element: { Player: { prototype: { send() {} } } },
  };
  const logs: unknown[][] = [];
  const game: any = {
    players: [...players],
    dead: [],
    log: (...values: unknown[]) => logs.push(values),
    checkOnlineResult: () => true,
    showIdentity() {
      revealed.count++;
    },
    over() {
      status.over = true;
      for (const callback of lib.onover) callback();
    },
  };
  const values = {
    nativeFixture: {
      lib,
      game,
      ui: { create: {} },
      get: { id: () => `epoch-${++sequence}` },
      _status: status,
    },
    partyEngine: { setup: { role: 'worker', settings: { mode }, seats } },
    window: { addEventListener() {} },
    setInterval: (fn: () => void) => {
      tick = fn;
      return 1;
    },
    clearInterval() {},
  };
  for (const [key, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(Date, 'now', () => now);
  const source = (
    await readFile(
      new URL('../packages/noname-adapter/runtime/surrender.js', import.meta.url),
      'utf8',
    )
  ).replace(/import \{([^}]+)\} from 'noname';/, 'const {$1} = globalThis.nativeFixture;');
  const enable = (
    await import(
      `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`
    )
  ).installSurrender();
  return {
    enable,
    game,
    players,
    lib,
    sent,
    revealed,
    status,
    logs,
    advance(ms: number) {
      now += ms;
      tick();
    },
    command(id: string, action: string, epoch = '', client = lib.playerOL[id]?.ws) {
      lib.message.server.partySurrender.call(client, action, epoch);
    },
    remove(id: string) {
      const player = lib.playerOL[id];
      game.players.splice(game.players.indexOf(player), 1);
      game.dead.push(player);
      tick();
    },
  };
}
const human = (id: string, extra = {}) => ({
  id,
  nickname: `<b>${id}</b>`,
  kind: 'human',
  ...extra,
});

test('单挑本人确认即按失败结算，选将期间、旧连接与原生giveup不能越过确认', async (t) => {
  const f = await fixture(t, 'duel', [human('one'), human('two')]);
  f.command('one', 'request');
  assert.equal(f.status.over, false);
  f.enable();
  f.command('one', 'request', '', { id: 'one' });
  f.lib.message.server.giveup.call(f.lib.playerOL.one.ws, f.lib.playerOL.one);
  assert.equal(f.sent.get('one').vote, null);
  f.command('one', 'request');
  assert.equal(f.status.over, true);
  assert.equal(f.game.checkOnlineResult(f.players[0]), false);
  assert.equal(f.game.checkOnlineResult(f.players[1]), true);
  assert(f.players.every((player) => player.hp === 4 && !player.isDead()));
  assert.equal(f.sent.get('one').available, false);
});

test('农民认输须两位存活真人同意，地主、AI、重复和过期投票不能凑齐票数', async (t) => {
  const f = await fixture(t, 'doudizhu', [
    human('lord', { identity: 'zhu' }),
    human('one', { identity: 'fan' }),
    human('two', { identity: 'fan' }),
    { id: 'bot', kind: 'bot', identity: 'fan' },
  ]);
  f.enable();
  f.command('one', 'request');
  const epoch = f.sent.get('one').vote.epoch;
  assert.equal(f.sent.get('lord').vote.eligible, false);
  assert.equal(f.sent.get('one').vote.participants.length, 2);
  f.command('lord', 'approve', epoch);
  f.command('bot', 'approve', epoch);
  f.command('one', 'approve', epoch);
  f.command('two', 'approve', 'old-epoch');
  assert.equal(f.status.over, false);
  assert.equal(f.sent.get('one').vote.participants.filter((row: any) => row.approved).length, 1);
  f.command('two', 'approve', epoch);
  assert.equal(f.status.over, true);
  assert.equal(f.game.checkOnlineResult(f.players[0]), true);
  assert(f.players.slice(1).every((player) => !f.game.checkOnlineResult(player)));
});

test('AI无需投票，阵亡队友不能发起或否决本方存活真人认输，胜负覆盖阵亡队友', async (t) => {
  const f = await fixture(t, 'versus', [
    human('one', { side: true }),
    human('dead', { side: true }),
    { id: 'bot', kind: 'bot', side: false },
    human('enemy', { side: false }),
  ]);
  f.enable();
  f.remove('dead');
  assert.equal(f.sent.get('dead').available, false);
  f.command('dead', 'request');
  assert.equal(f.sent.get('one').vote, null);
  f.command('one', 'request');
  assert.equal(f.status.over, true);
  assert.equal(f.game.checkOnlineResult(f.players[1]), false);
  assert.equal(f.game.checkOnlineResult(f.players[2]), true);
});

test('任一队友拒绝即取消，60秒发起冷却由规则端执行，旧epoch不能批准新投票', async (t) => {
  const f = await fixture(t, 'versus', [
    human('one', { side: true }),
    human('two', { side: true }),
    human('enemy', { side: false }),
  ]);
  f.enable();
  f.command('one', 'request');
  const old = f.sent.get('one').vote.epoch;
  f.command('two', 'reject', old);
  assert.equal(f.sent.get('one').vote, null);
  f.command('one', 'request');
  assert.equal(f.sent.get('one').vote, null);
  f.advance(60000);
  f.command('one', 'request');
  const current = f.sent.get('one').vote.epoch;
  assert.notEqual(current, old);
  f.command('two', 'approve', old);
  assert.equal(f.status.over, false);
  f.command('two', 'approve', current);
  assert.equal(f.status.over, true);
});

test('重连恢复原票数和期限；托管、离线和超时不算同意，迟到批准不结束游戏', async (t) => {
  const f = await fixture(t, 'versus', [
    human('one', { side: true }),
    human('two', { side: true }),
    human('enemy', { side: false }),
  ]);
  f.enable();
  f.command('one', 'request');
  const epoch = f.sent.get('one').vote.epoch;
  Object.assign(f.players[1]!, { isAuto: true });
  f.advance(12000);
  f.lib.message.server.reinited.call(f.players[1]!.ws);
  assert.equal(f.sent.get('two').vote.epoch, epoch);
  assert.equal(f.sent.get('two').vote.remainingMs, 18000);
  assert.equal(f.sent.get('two').vote.voted, false);
  f.advance(18000);
  f.command('two', 'approve', epoch);
  assert.equal(f.status.over, false);
  assert.equal(f.sent.get('one').vote, null);
  assert.match(f.sent.get('one').notice, /超时/);
});

test('投票中真人队友阵亡即取消，不能因人数变少自动通过', async (t) => {
  const f = await fixture(t, 'versus', [
    human('one', { side: true }),
    human('two', { side: true }),
    human('enemy', { side: false }),
  ]);
  f.enable();
  f.command('one', 'request');
  const epoch = f.sent.get('one').vote.epoch;
  f.remove('two');
  f.command('two', 'approve', epoch);
  assert.equal(f.status.over, false);
  assert.equal(f.sent.get('one').vote, null);
  f.command('enemy', 'request');
  assert.equal(f.status.over, true);
  assert.equal(f.sent.get('one').available, false);
});

test('自然结算优先终止正在进行的投票，迟到批准和旧计时回调不能修改结果', async (t) => {
  const f = await fixture(t, 'versus', [
    human('one', { side: true }),
    human('two', { side: true }),
    human('enemy', { side: false }),
  ]);
  f.enable();
  f.command('one', 'request');
  const epoch = f.sent.get('one').vote.epoch;
  f.game.over();
  assert.equal(f.sent.get('one').vote, null);
  assert.equal(f.sent.get('one').available, false);
  const result = f.game.checkOnlineResult;
  f.command('two', 'approve', epoch);
  f.advance(60000);
  assert.equal(f.game.checkOnlineResult, result);
  assert.equal(f.sent.get('one').vote, null);
});

test('身份局全体真人（含阵亡）表态，与隐藏身份无关；通过才揭示身份且所有人不判胜负', async (t) => {
  const f = await fixture(t, 'identity', [
    human('lord', { identity: 'zhu' }),
    human('loyal', { identity: 'zhong' }),
    human('rebel', { identity: 'fan' }),
    human('spy', { identity: 'nei' }),
    { id: 'bot', kind: 'bot', identity: 'fan' },
  ]);
  f.enable();
  f.remove('loyal');
  f.command('rebel', 'request');
  const vote = f.sent.get('lord').vote;
  assert.equal(vote.participants.length, 4);
  assert.equal(f.sent.get('loyal').available, true);
  assert(f.sent.get('loyal').vote.eligible);
  assert(!/identity|\bside\b|\bzhu\b|\bzhong\b|\bfan\b|\bnei\b/.test(JSON.stringify(vote)));
  f.command('lord', 'approve', vote.epoch);
  f.command('spy', 'approve', vote.epoch);
  assert.equal(f.status.over, false);
  assert.equal(f.revealed.count, 0);
  f.command('loyal', 'approve', vote.epoch);
  assert.equal(f.status.over, true);
  assert.equal(f.revealed.count, 1);
  assert(f.players.every((player) => f.game.checkOnlineResult(player) === null));
});
