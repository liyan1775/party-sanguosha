// SPDX-License-Identifier: GPL-3.0-only
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { draftBidControl, draftCandidateGrid, draftMeta } from '../apps/web/src/draft-controls.js';

test('选将角标保留真实起始体力与不同上限，相同时只显示一个数字', () => {
  assert.equal(draftMeta('wei', '4/5'), '魏 · 4/5');
  assert.equal(draftMeta('shen', '3/6'), '神 · 3/6');
  assert.equal(draftMeta('shu', '4/4'), '蜀 · 4');
  assert.equal(draftMeta('wu', '4'), '吴 · 4');
  assert.equal(draftMeta('qun', '3'), '群 · 3');
  assert.equal(draftMeta('jin', '3'), '晋 · 3');
});

test('6 张和 10 张均计算两排，较少候选不占第二排', () => {
  assert.deepEqual(draftCandidateGrid(6), { columns: 3, rows: 2 });
  assert.deepEqual(draftCandidateGrid(10), { columns: 5, rows: 2 });
  assert.deepEqual(draftCandidateGrid(4), { columns: 4, rows: 1 });
  assert.deepEqual(draftCandidateGrid(0), { columns: 1, rows: 1 });
});

test('倍数筹码仅在我可操控的当前行动席页面可见', () => {
  assert.equal(draftBidControl('own', 'own'), 'bid');
  assert.equal(draftBidControl('bot', 'bot'), 'bid');
  assert.equal(draftBidControl('own', 'mate'), 'return');
  assert.equal(draftBidControl('bot', 'own'), 'return');
  assert.equal(draftBidControl(undefined, 'mate'), 'hidden');
});
