import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTable, tableAction } from '../packages/noname-adapter/src/table.js';

test('轻量席位投影只保留声明字段，不传原生事件、暗牌附加数据、HTML或外部资源地址', () => {
  const input = {
    playerId: 'seat-a',
    epoch: 'epoch-a',
    revision: 1,
    choice: 4,
    prompt: '<img src=x onerror=alert(1)>',
    storage: { private: 'secret-storage' },
    event: 'secret-event',
    token: 'secret-token',
    deck: ['secret-deck'],
    players: [
      {
        id: 'seat-b',
        nickname: '<svg onload=alert(1)>',
        identity: '身份未公开',
        hand: ['secret-hand'],
        storage: 'secret-skill',
      },
    ],
    hand: [
      {
        key: 'card-a',
        label: '杀',
        image: 'https://evil.invalid/track',
        enabled: true,
        action: 'select-a',
        cardid: 'native-card',
        value: 'secret-value',
      },
    ],
    controls: [{ key: 'ok', label: '使用', action: 'confirm-a', enabled: true }],
  };
  const state = sanitizeTable(input, 'seat-a')!;
  assert(state);
  for (const secret of [
    'secret-storage',
    'secret-event',
    'secret-token',
    'secret-deck',
    'secret-hand',
    'secret-skill',
    'native-card',
    'secret-value',
  ])
    assert(!JSON.stringify(state).includes(secret));
  assert.equal(state.hand[0]!.image, '');
  assert.equal(state.players[0]!.nickname, input.players[0]!.nickname);
  assert.equal(sanitizeTable(input, 'seat-b'), null);
  assert(tableAction(JSON.stringify(['tableAction', 'epoch-a', 4, 'select-a']), state));
  assert(tableAction(JSON.stringify(['tableAction', 'epoch-a', 4, 'confirm-a']), state));
  for (const packet of [
    ['tableAction', 'epoch-a', 3, 'confirm-a'],
    ['tableAction', 'epoch-old', 4, 'confirm-a'],
    ['tableAction', 'epoch-a', 4, 'invented'],
    ['tableAction', 'epoch-a', 4, 'confirm-a', 'exec'],
    ['result', { bool: true }],
  ])
    assert(!tableAction(JSON.stringify(packet), state));
});

test('轻量投影限制选项、文字和数值，已禁用动作不能提交', () => {
  const state = sanitizeTable(
    {
      playerId: 'seat',
      epoch: 'epoch',
      revision: 2,
      choice: 1,
      hand: Array.from({ length: 1000 }, () => ({
        key: 'a',
        action: 'forbidden',
        enabled: false,
        label: 'a'.repeat(10000),
      })),
      players: [{ id: 'seat', hp: Infinity, maxHp: 999999, handCount: -1 }],
    },
    'seat',
  )!;
  assert.equal(state.hand.length, 96);
  assert.equal(state.hand[0]!.label.length, 200);
  assert.equal(state.hand[0]!.action, '');
  assert.equal(state.players[0]!.hp, 0);
  assert.equal(state.players[0]!.maxHp, 100);
  assert.equal(state.players[0]!.handCount, 0);
  assert(!tableAction(JSON.stringify(['tableAction', 'epoch', 1, 'forbidden']), state));
});

test('分组手牌保留标题、牌面与合法操作，附加私有字段和禁用动作被丢弃', () => {
  const state = sanitizeTable(
    {
      playerId: 'seat',
      epoch: 'epoch',
      revision: 2,
      choice: 3,
      dialogs: [
        {
          key: 'poxi',
          groups: [
            {
              label: '你的手牌',
              cards: ['secret'],
              items: [
                { key: 'own', label: '杀', suit: '♠', number: '7', enabled: true, action: 'own' },
              ],
            },
            {
              label: '曹操的手牌',
              token: 'secret',
              items: [
                {
                  key: 'target',
                  label: '桃',
                  suit: '♥',
                  number: '3',
                  enabled: false,
                  action: 'forbidden',
                  cardid: 'secret',
                },
              ],
            },
          ],
        },
      ],
    },
    'seat',
  )!;
  assert.deepEqual(
    state.dialogs[0]!.groups!.map((group) => group.label),
    ['你的手牌', '曹操的手牌'],
  );
  assert.equal(state.dialogs[0]!.groups![1]!.items[0]!.suit, '♥');
  assert(!JSON.stringify(state).includes('secret'));
  assert(tableAction(JSON.stringify(['tableAction', 'epoch', 3, 'own']), state));
  assert(!tableAction(JSON.stringify(['tableAction', 'epoch', 3, 'forbidden']), state));
});
