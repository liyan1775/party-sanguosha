import test from 'node:test';
import assert from 'node:assert/strict';
import { DoudizhuPreparation } from '../packages/noname-adapter/src/doudizhu-preparation.js';
import type {
  MatchSetup,
  EngineAdapter,
  EngineEvent,
} from '../packages/noname-adapter/src/index.js';
import { RoomStore } from '../apps/server/src/room.js';

function setup(college = true): MatchSetup {
  return {
    roomCode: 'ABC123',
    ownerPlayerId: 'p0',
    aiPolicy: 'strongest-native',
    settings: {
      mode: college ? 'college' : 'doudizhu',
      playerCount: college ? 4 : 3,
      generalPreset: college ? 'ol-college-2026' : 'beginner',
      allowGeneralSelection: false,
      extensions: [],
    },
    seats: Array.from({ length: college ? 4 : 3 }, (_, i) => ({
      id: `p${i}`,
      nickname: `玩家${i}`,
      kind: 'human',
    })),
  };
}
function operation(
  prep: DoudizhuPreparation,
  controller: string,
  subject: string,
  action: string,
  value?: string | number,
) {
  const view = prep.privateState(controller);
  const seat = view.seats.find((s) => s.id === subject)!;
  assert(seat, 'controller must see exactly its legal subject');
  return {
    id: view.preparation.id,
    phaseId: view.preparation.phaseId,
    revision: seat.revision,
    seatId: subject,
    action,
    ...(action === 'bid' ? { bid: value } : { general: value }),
  };
}
function chooseAll(prep: DoudizhuPreparation) {
  for (const controller of ['p0', 'p1', 'p2', 'p3'])
    for (const seat of prep.privateState(controller).seats)
      if (!seat.locked)
        prep.action(controller, operation(prep, controller, seat.id, 'choose', seat.candidates[0]));
}

test('普通斗地主先各6将，竞价后仅地主补4；点将不改变身份，候选互不重复', async () => {
  const s = setup(false);
  s.settings.allowGeneralSelection = true;
  s.generalSelections = { p1: 'caocao' };
  const prep = new DoudizhuPreparation(s, 0, () => {});
  const initial = ['p0', 'p1', 'p2'].flatMap((id) => prep.privateState(id).seats[0]!.candidates);
  assert.equal(initial.length, 18);
  assert.equal(new Set(initial).size, 18);
  assert(prep.privateState('p1').seats[0]!.candidates.includes('caocao'));
  prep.action('p0', operation(prep, 'p0', 'p0', 'bid', 3));
  assert.equal(prep.privateState('p0').seats[0]!.candidates.length, 10);
  assert.equal(prep.privateState('p1').seats[0]!.candidates.length, 6);
  assert(!JSON.stringify(prep.publicState()).includes('caocao'));
  chooseAll(prep);
  const result = await prep.result;
  assert.equal(result.seats[0]!.id, 'p0');
  assert.equal(new Set(Object.values(result.doudizhu!.candidates).flat()).size, 22);
});

test('AI队友叫地主：代理只用AI原4＋真人随机2，且引擎保留AI报名ID并绑定真人', async () => {
  const s = setup();
  s.seats[2]!.kind = 'bot';
  const prep = new DoudizhuPreparation(s, 2, () => {});
  const before = prep.privateState('p0');
  const own = before.seats.find((s) => s.id === 'p0')!.candidates;
  const ai = before.seats.find((s) => s.id === 'p2')!.candidates;
  prep.action('p0', operation(prep, 'p0', 'p2', 'bid', 4));
  const now = prep.privateState('p0');
  assert.deepEqual(
    now.seats.map((s) => s.id),
    ['p2'],
  );
  assert.equal(now.seats[0]!.candidates.length, 6);
  assert(ai.every((id) => now.seats[0]!.candidates.includes(id)));
  assert.equal(now.seats[0]!.candidates.filter((id) => own.includes(id)).length, 2);
  chooseAll(prep);
  const result = await prep.result;
  assert.deepEqual(result.seats[0], {
    id: 'p2',
    nickname: '玩家2',
    kind: 'human',
    controllerId: 'p0',
  });
  assert(!result.seats.some((s) => s.id === 'p0'));
  assert.equal(result.doudizhu!.members.length, 4);
});

test('混合农民各4将各2次换将，不能串用候选、越权操作对手或重放旧版本', async () => {
  const s = setup();
  s.seats[2]!.kind = 'bot';
  const prep = new DoudizhuPreparation(s, 1, () => {});
  prep.action('p1', operation(prep, 'p1', 'p1', 'bid', 4));
  const [own, ai] = prep.privateState('p0').seats;
  assert(own && ai);
  assert.equal(own.candidates.length, 4);
  assert.equal(ai.candidates.length, 4);
  const stale = operation(prep, 'p0', ai.id, 'replace', ai.candidates[0]);
  prep.action('p0', stale);
  assert.throws(() => prep.action('p0', stale));
  const updated = prep.privateState('p0').seats.find((s) => s.id === ai.id)!;
  assert.equal(updated.replacementsLeft, 1);
  assert.equal(prep.privateState('p0').seats[0]!.replacementsLeft, 2);
  assert(!updated.candidates.includes(ai.candidates[0]!));
  assert.throws(() => prep.action('p0', operation(prep, 'p0', ai.id, 'choose', own.candidates[0])));
  assert.throws(() =>
    prep.action('p3', operation(prep, 'p0', ai.id, 'choose', updated.candidates[0])),
  );
  assert.throws(() =>
    prep.action('p0', {
      ...operation(prep, 'p0', ai.id, 'choose', updated.candidates[0]),
      id: 'other-room',
    }),
  );
  chooseAll(prep);
  const result = await prep.result;
  assert.equal(result.seats.find((s) => s.id === 'p2')!.kind, 'bot');
});

test('全员不叫由先叫位1倍当地主；选择超时保留已锁定，余下交给合法池原生AI', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const prep = new DoudizhuPreparation(setup(), 0, () => {}, 1000);
  for (const id of ['p0', 'p1', 'p2', 'p3']) prep.action(id, operation(prep, id, id, 'bid', 0));
  assert.equal(prep.publicState().highestBid, 1);
  assert.equal(prep.publicState().landlordId, 'p0');
  const name = prep.privateState('p0').seats[0]!.candidates[0]!;
  prep.action('p0', operation(prep, 'p0', 'p0', 'choose', name));
  const deadline = prep.publicState().deadline;
  assert.equal(prep.privateState('p0').preparation.deadline, deadline);
  t.mock.timers.tick(1001);
  const result = await prep.result;
  assert.deepEqual(result.doudizhu!.selectedGenerals, { p0: name });
  assert.equal(Object.keys(result.doudizhu!.candidates).length, 3);
});

test('真人托管或断线不等于大厅AI，不允许替另一个真人选择', () => {
  const prep = new DoudizhuPreparation(setup(), 0, () => {});
  void prep.result.catch(() => {});
  assert.deepEqual(
    prep.privateState('p0').seats.map((s) => s.id),
    ['p0'],
  );
  const other = operation(prep, 'p2', 'p2', 'bid', 4);
  assert.throws(() => prep.action('p0', other));
  prep.cancel();
});

test('高校整场自然结果幂等计分、轮换先叫位，回房保留规则并锁定队伍', async () => {
  const callbacks = new Set<(event: EngineEvent) => void>();
  let id = 0;
  let started: MatchSetup | undefined;
  const engine: EngineAdapter = {
    status: () => ({ id: 'noname', ready: true, doudizhuPractice: true, message: 'fixture' }),
    start: async (s) => {
      started = s;
      id++;
    },
    matchId: () => (id ? `match-${id}` : null),
    subscribe: (cb) => {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    release: () => {},
  };
  const room = new RoomStore(engine);
  const users = Array.from({ length: 4 }, (_, i) => room.join(`玩家${i}`));
  room.updateSettings(
    {
      mode: 'college',
      playerCount: 4,
      generalPreset: 'ol-college-2026',
      extensions: [],
      collegeFormat: 'quick',
    },
    users[0]!.token,
  );
  for (const user of users) {
    room.connect(user.token);
    room.setReady(user.token, true);
  }
  await room.start(users[0]!.token);
  const publicState = room.snapshot().doudizhu!;
  const bidder = users.find((u) => u.playerId === publicState.bidSeatId)!;
  const view = room.doudizhuChoice(bidder.token);
  const seat = view.seats[0]!;
  room.doudizhuAction(bidder.token, {
    id: view.preparation.id,
    phaseId: view.preparation.phaseId,
    seatId: seat.id,
    revision: seat.revision,
    action: 'bid',
    bid: 4,
  });
  for (const user of users)
    for (const choice of room.doudizhuChoice(user.token).seats) {
      const fresh = room.doudizhuChoice(user.token);
      room.doudizhuAction(user.token, {
        id: fresh.preparation.id,
        phaseId: fresh.preparation.phaseId,
        seatId: choice.id,
        revision: choice.revision,
        action: 'choose',
        general: choice.candidates[0],
      });
    }
  await new Promise((resolve) => setImmediate(resolve));
  assert(started);
  assert.equal(room.snapshot().phase, 'playing');
  const previous = room.snapshot().series!.firstBidIndex;
  for (const cb of callbacks)
    cb({ type: 'ended', roomCode: room.code, matchId: 'match-1', winner: 'landlord' });
  const series = room.snapshot().series!;
  assert.equal(series.completedGames, 1);
  assert.equal(series.scores[0] + series.scores[1], 4);
  assert.equal(series.firstBidIndex, (previous + 1) % 4);
  assert.deepEqual(series.results, [
    {
      game: 1,
      winner: series.teams[0].includes(room.snapshot().doudizhu!.landlordId!) ? 0 : 1,
      points: 4,
    },
  ]);
  for (const cb of callbacks)
    cb({ type: 'ended', roomCode: room.code, matchId: 'match-1', winner: 'landlord' });
  assert.equal(room.snapshot().series!.completedGames, 1);
  assert.deepEqual(room.snapshot().series!.results, series.results);
  room.returnToWaiting(users[0]!.token);
  assert.deepEqual(room.snapshot().series, series);
  assert.throws(() => room.addBots(1, users[0]!.token));
  assert.throws(() => room.setCollegeSeat(users[1]!.playerId, 0, users[0]!.token));
  room.endSeries(users[0]!.token);
  assert.equal(room.snapshot().series, undefined);
  room.consoleClose();
});

for (const format of ['quick', 'standard'] as const)
  test(`高校${format}计分：满${format === 'quick' ? 6 : 12}局同分只加赛一局，旧局结果不计入新局（领域夹具）`, async () => {
    let callback: (event: EngineEvent) => void = () => {};
    let sequence = 0;
    let match: string | null = null;
    const room = new RoomStore({
      status: () => ({
        id: 'noname',
        ready: true,
        doudizhuPractice: true,
        message: 'domain fixture',
      }),
      start: async () => {
        match = `score-${++sequence}`;
      },
      matchId: () => match,
      release: () => {
        match = null;
      },
      subscribe: (fn) => {
        callback = fn;
        return () => {};
      },
    });
    const users = Array.from({ length: 4 }, (_, i) => room.join(`选手${i}`));
    room.updateSettings(
      {
        mode: 'college',
        playerCount: 4,
        generalPreset: 'ol-college-2026',
        extensions: [],
        collegeFormat: format,
      },
      users[0]!.token,
    );
    users.forEach((u) => room.connect(u.token));
    const limit = format === 'quick' ? 6 : 12;
    for (let round = 0; round <= limit; round++) {
      for (const user of users) room.setReady(user.token, true);
      await room.start(users[0]!.token);
      while (room.snapshot().doudizhu!.phase === 'bidding') {
        const p = room.snapshot().doudizhu!;
        const user = users.find((u) => u.playerId === p.bidSeatId)!;
        const seat = room.doudizhuChoice(user.token).seats[0]!;
        room.doudizhuAction(user.token, {
          id: p.id,
          phaseId: p.phaseId,
          seatId: seat.id,
          revision: seat.revision,
          action: 'bid',
          bid: 0,
        });
      }
      for (const user of users)
        for (const seat of room.doudizhuChoice(user.token).seats) {
          const p = room.snapshot().doudizhu!;
          room.doudizhuAction(user.token, {
            id: p.id,
            phaseId: p.phaseId,
            seatId: seat.id,
            revision: seat.revision,
            action: 'choose',
            general: seat.candidates[0],
          });
        }
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(room.snapshot().phase, 'playing');
      if (round > 0) {
        callback({ type: 'ended', roomCode: room.code, matchId: 'old-match', winner: 'landlord' });
        assert.equal(room.snapshot().phase, 'playing');
      }
      const s = room.snapshot().series!;
      const lord = room.snapshot().doudizhu!.landlordId!;
      const landlordTeam = s.teams[0].includes(lord) ? 0 : 1;
      const winner = round % 2;
      callback({
        type: 'ended',
        roomCode: room.code,
        matchId: match!,
        winner: landlordTeam === winner ? 'landlord' : 'farmers',
      });
      assert.equal(room.snapshot().series!.completedGames, round + 1);
      assert.equal(room.snapshot().series!.finished, round === limit);
      room.returnToWaiting(users[0]!.token);
    }
    const final = room.snapshot().series!;
    assert.equal(final.winner, 0);
    assert.deepEqual(final.scores, [limit / 2 + 1, limit / 2]);
    room.consoleClose();
  });
