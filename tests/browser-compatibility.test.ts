import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(
  new URL('../packages/noname-adapter/runtime/browser-compatibility.js', import.meta.url),
  'utf8',
);
const { installBrowserCompatibility } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
function olderBrowser() {
  const realm = runInNewContext(
    '({ Promise, Object, Set, Reflect, Array, Symbol, history: function* () { yield 2; yield 3; } })',
  );
  const iterator = realm.Object.getPrototypeOf(
    realm.Object.getPrototypeOf(new realm.Array()[realm.Symbol.iterator]()),
  );
  for (const [target, name] of [
    [realm.Promise, 'try'],
    [realm.Promise, 'withResolvers'],
    [realm.Object, 'groupBy'],
    [realm.Set.prototype, 'union'],
    [realm.Set.prototype, 'difference'],
    [iterator, 'toArray'],
    [iterator, 'map'],
    [iterator, 'reduce'],
  ])
    delete target[name];
  installBrowserCompatibility(realm);
  return realm;
}

test('旧浏览器 Promise 接口同步执行、拒绝异常、接续异步结果并保留子类', async () => {
  const { Promise: LegacyPromise } = olderBrowser();
  let called = false;
  const result = LegacyPromise.try(
    (a: number, b: number) => {
      called = true;
      return a + b;
    },
    2,
    3,
  );
  assert(called);
  assert.equal(await result, 5);
  const error = new Error('callback failed');
  const rejected = LegacyPromise.try(() => {
    throw error;
  });
  await assert.rejects(rejected, (reason) => reason === error);
  assert.equal(await LegacyPromise.try(() => Promise.resolve(7)), 7);
  class DerivedPromise extends LegacyPromise {}
  assert(DerivedPromise.try(() => 1) instanceof DerivedPromise);
  const deferred = DerivedPromise.withResolvers();
  assert(deferred.promise instanceof DerivedPromise);
  deferred.resolve('ready');
  deferred.reject(error);
  assert.equal(await deferred.promise, 'ready');
  const failed = LegacyPromise.withResolvers();
  failed.reject(error);
  await assert.rejects(failed.promise, (reason) => reason === error);
});

test('旧浏览器卡牌分组支持原型名称、符号键、迭代顺序和回调索引', () => {
  const { Object: LegacyObject } = olderBrowser();
  const symbol = Symbol('suit');
  const keys = ['__proto__', 'constructor', symbol, '__proto__'];
  const indices: number[] = [];
  const groups = LegacyObject.groupBy(new Set([1, 2, 3, 4]), (value: number, index: number) => {
    indices.push(index);
    return { [Symbol.toPrimitive]: () => keys[value - 1] };
  });
  assert.equal(Object.getPrototypeOf(groups), null);
  assert.deepEqual(indices, [0, 1, 2, 3]);
  assert.deepEqual(Array.from(groups.__proto__), [1, 4]);
  assert.deepEqual(Array.from(groups.constructor), [2]);
  assert.deepEqual(Array.from(groups[symbol]), [3]);
  assert.throws(() => LegacyObject.groupBy([], null), TypeError);
});

test('旧浏览器选择集合运算保留顺序与原集合，重复安装保留现有实现', () => {
  const realm = olderBrowser();
  const cards = new realm.Set([3, 1, NaN]);
  const other = new Map([
    [1, true],
    [2, true],
  ]);
  assert.deepEqual(Array.from(cards.union(other)), [3, 1, NaN, 2]);
  assert.deepEqual(Array.from(cards.difference(other)), [3, NaN]);
  assert.deepEqual(Array.from(cards), [3, 1, NaN]);
  assert.deepEqual(Array.from(other.keys()), [1, 2]);
  const targets = [
    [realm.Promise, 'try'],
    [realm.Promise, 'withResolvers'],
    [realm.Object, 'groupBy'],
    [realm.Set.prototype, 'union'],
    [realm.Set.prototype, 'difference'],
    [Object.getPrototypeOf(Object.getPrototypeOf(new realm.Set().values())), 'toArray'],
    [Object.getPrototypeOf(Object.getPrototypeOf(new realm.Set().values())), 'map'],
    [Object.getPrototypeOf(Object.getPrototypeOf(new realm.Set().values())), 'reduce'],
  ] as const;
  const implementations = targets.map(([target, name]) => target[name]);
  installBrowserCompatibility(realm);
  targets.forEach(([target, name], index) => {
    assert.equal(target[name], implementations[index]);
    assert.equal(Object.getOwnPropertyDescriptor(target, name)?.enumerable, false);
  });
  const nativeRealm = runInNewContext('({ Promise, Object, Set, Reflect, Array, Symbol })');
  const nativeTry = nativeRealm.Promise.try;
  installBrowserCompatibility(nativeRealm);
  assert.equal(nativeRealm.Promise.try, nativeTry);
});

test('旧浏览器历史迭代器延迟映射、保留索引、归约空值并在异常时关闭', () => {
  const realm = olderBrowser();
  const iterator = realm.Object.getPrototypeOf(
    realm.Object.getPrototypeOf(new realm.Array()[realm.Symbol.iterator]()),
  );
  const history = realm.history();
  let calls = 0;
  const mapped = history.map((value: number, index: number) => {
    calls++;
    return value + index;
  });
  assert.equal(calls, 0);
  assert.deepEqual(Array.from(mapped), [2, 4]);
  assert.equal(calls, 2);
  assert.deepEqual(Array.from(new realm.Set([1, 2]).values().toArray()), [1, 2]);
  assert.equal(
    new realm.Set([2, 3]).values().reduce((a: number, b: number) => a + b),
    5,
  );
  assert.equal(
    new realm.Set().values().reduce(() => 1, undefined),
    undefined,
  );
  assert.throws(() => new realm.Set().values().reduce(() => 1), TypeError);
  assert.throws(() => new realm.Set().values().map(null), TypeError);
  let closed = false;
  function* failing() {
    try {
      yield 1;
      yield 2;
    } finally {
      closed = true;
    }
  }
  assert.throws(() =>
    iterator.reduce.call(
      failing(),
      () => {
        throw new Error('failed');
      },
      0,
    ),
  );
  assert(closed);
});
