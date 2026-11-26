import test from 'node:test';
import assert from 'node:assert/strict';
import { ObserverJournal, sanitizeObserver } from '../packages/noname-adapter/src/observer.js';
import type { MatchSetup } from '../packages/noname-adapter/src/index.js';

const setup: MatchSetup = {
  roomCode: 'ABC123',
  ownerPlayerId: 'human',
  settings: {
    mode: 'duel',
    playerCount: 2,
    generalPreset: 'beginner',
    allowGeneralSelection: false,
    extensions: [],
  },
  seats: [
    { id: 'human', nickname: '<b>玩家</b>', kind: 'human' },
    { id: 'bot', nickname: 'AI', kind: 'bot' },
  ],
  aiPolicy: 'strongest-native',
};

test('公开观战只接收本桌且未过期的连击摘要', () => {
  const at = Date.now() - 20;
  const gifts = [
    { targetId: 'bot', count: 2, at, sender: 'SECRET' },
    { targetId: 'other-room', count: 2, at },
    { targetId: 'human', count: 2, at: at - 4000 },
    { targetId: 'human', count: 2, at: at + 4000 },
    { targetId: 'human', count: 100, at },
    { targetId: 'human', count: 1, at },
  ];
  const state = { players: [], recent: [], giftCombos: gifts };
  assert.deepEqual(sanitizeObserver(state, setup)?.giftCombos, [{ targetId: 'bot', count: 2, at }]);
  assert.equal(sanitizeObserver({ ...state, ended: true }, setup)?.giftCombos, undefined);
  assert.equal(
    sanitizeObserver({ ...state, giftCombos: [...gifts, ...gifts] }, setup)?.giftCombos,
    undefined,
  );
});

test('观察者历史去重、分页、房间白名单与容量边界', () => {
  const journal = new ObserverJournal();
  for (let start = 1; start <= 10100; start += 100) {
    const state = sanitizeObserver(
      {
        round: 1,
        deckCount: 73,
        players: [
          { id: 'human', nickname: 'forged', controller: 'bot', storage: 'SECRET' },
          { id: 'bot', controller: 'human' },
          { id: 'other-room', hand: 'SECRET' },
        ],
        recent: Array.from({ length: 100 }, (_, offset) => `公开事件 ${start + offset}`),
        logStart: start,
        logTotal: start + 99,
        deck: 'SECRET',
      },
      setup,
    )!;
    assert.equal(state.players.length, 2);
    assert.equal(state.players[0]!.nickname, '<b>玩家</b>');
    assert.equal(state.players[0]!.controller, undefined);
    assert.equal(state.players[1]!.controller, 'bot');
    assert(!JSON.stringify(state).includes('SECRET'));
    assert.equal(state.deckCount, 73);
    journal.append(state);
    journal.append(state);
  }
  const page = journal.page('match');
  assert.equal(page.first, 101);
  assert.equal(page.total, 10100);
  assert.equal(page.entries.length, 100);
  assert.equal(page.entries[0]!.sequence, 10001);
  assert.equal(journal.page('match', 10001).entries.at(-1)!.sequence, 10000);
  assert.equal(journal.page('match', 101).entries.length, 0);
  assert.equal(new ObserverJournal().page('other-match').total, 0);
});
