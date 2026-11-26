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

test('a fractional measured scale preserves clearance without alternating between adjacent lift pixels', () => {
  const handTop = 500;
  const unshiftedBottom = 504.01;
  // offsetWidth rounds the native container to an integer, slightly
  // underestimating the actual translation of one CSS pixel.
  const scale = 0.999;
  let lift = 0;
  const positions = new Set<number>();
  for (let frame = 0; frame < 60; frame++) {
    lift = confirmationLift(unshiftedBottom - lift, handTop, lift, scale);
    positions.add(lift);
    assert(handTop - (unshiftedBottom - lift) >= 12);
  }
  assert.deepEqual([...positions], [17]);
  assert.equal(confirmationLift(440, handTop, lift, scale), 0);
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
