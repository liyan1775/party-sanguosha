// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function draftModule() {
  const source = (
    await readFile(
      new URL('../packages/noname-adapter/runtime/hero-draft.js', import.meta.url),
      'utf8',
    )
  ).replace("import { lib, game, ui, get, _status } from 'noname';", '');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('原生选将角标显示起始/上限、同值简写和当前公开主公的实况', async () => {
  const { draftGeneralFacts } = await draftModule();
  const nameOf = (group: string) => group;
  assert.deepEqual(draftGeneralFacts({ group: 'wei', hp: 4, maxHp: 5 }, null, nameOf), {
    group: 'wei',
    color: 'blue',
    label: '魏 · 4/5',
  });
  assert.deepEqual(draftGeneralFacts({ group: 'shen', hp: 3, maxHp: 6 }, null, nameOf), {
    group: 'shen',
    color: 'gold',
    label: '神 · 3/6',
  });
  assert.equal(draftGeneralFacts({ group: 'wu', hp: 4, maxHp: 4 }, null, nameOf).label, '吴 · 4');
  const base = { group: 'shen', hp: 3, maxHp: 6 };
  assert.deepEqual(draftGeneralFacts(base, { group: 'qun', hp: 4, maxHp: 7 }, nameOf), {
    group: 'qun',
    color: 'amber',
    label: '群 · 4/7',
  });
});

test('原生选将座次只投影本人身份和已公开主公，不泄露其他暗身份', async () => {
  const { draftSeats } = await draftModule();
  const lord = { seatNum: 1, nickname: '主公候选', identity: 'zhu', identityShown: true };
  const self = { seatNum: 2, nickname: '本人', identity: 'fan', identityShown: false };
  const other = { seatNum: 3, nickname: '他席', identity: 'nei', identityShown: false };
  const seats = draftSeats('identity', [self, other, lord], self);
  assert.deepEqual(
    seats.map(
      ({
        number,
        own,
        badge,
      }: {
        number: number;
        own: boolean;
        badge?: [label: string, tone: string];
      }) => [number, own, badge?.[0]],
    ),
    [
      [1, false, '主公'],
      [2, true, '反贼'],
      [3, false, undefined],
    ],
  );
});
