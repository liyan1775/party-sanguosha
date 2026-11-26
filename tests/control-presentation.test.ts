import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  confirmationLift,
  landlordRole,
  selectionSummary,
  // Runtime-only JavaScript is tested directly with the Node runner.
  // @ts-expect-error No declaration is needed by production TypeScript.
} from '../packages/noname-adapter/runtime/control-presentation.js';

test('confirmation clearance measures painted pixels and accounts for existing lift at native zoom', () => {
  assert.equal(confirmationLift(271, 254, 0, 0.75), 39);
  assert.equal(confirmationLift(241.75, 254, 39, 0.75), 39);
  assert.equal(confirmationLift(241.75, 243, 39, 0.75), 54);
  assert.equal(confirmationLift(230, 254, 0, 1), 0);
  assert.equal(confirmationLift(230, Infinity, 10, 1), 0);
});

test('landlord display labels never translate classic hidden or public roles', () => {
  for (const mode of ['doudizhu', 'college']) {
    assert.equal(landlordRole(mode, 'zhu'), '地主');
    assert.equal(landlordRole(mode, 'fan'), '农民');
    assert.equal(landlordRole(mode, 'unknown'), null);
  }
  assert.equal(landlordRole('identity', 'zhu'), null);
  assert.equal(landlordRole('versus', 'fan'), null);
});

test('selection summary separates the converted result and its actual material', () => {
  assert.equal(
    selectionSummary(['♥A 万箭齐发'], '', ['孟获'], false, '武圣', '杀'),
    '已选：武圣 · 杀（♥A 万箭齐发） → 孟获',
  );
  assert.equal(selectionSummary(['♣K 决斗'], '', ['吕蒙'], false, '', ''), '已选：♣K 决斗 → 吕蒙');
});
