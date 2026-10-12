// The pinned engine uses these APIs without checking older mobile WebKit.
// Keep native implementations when available; install before engine evaluation.
export function installBrowserCompatibility(realm = globalThis) {
  const define = (target, name, value) => {
    if (typeof target[name] === 'function') return;
    realm.Object.defineProperty(target, name, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  };
  define(realm.Promise, 'try', function (callback, ...args) {
    return new this((resolve) => resolve(callback(...args)));
  });
  define(realm.Promise, 'withResolvers', function () {
    let resolve, reject;
    const promise = new this((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  });
  define(realm.Object, 'groupBy', function (items, callback) {
    if (typeof callback !== 'function') throw new TypeError('groupBy callback must be a function');
    const groups = realm.Object.create(null);
    let index = 0;
    for (const item of items) {
      // Computed property syntax performs ToPropertyKey, including symbol keys.
      const key = realm.Reflect.ownKeys({ [callback(item, index++)]: null })[0];
      if (!realm.Object.hasOwn(groups, key)) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  });
  define(realm.Set.prototype, 'union', function (other) {
    const result = new realm.Set(this);
    for (const value of other.keys()) result.add(value);
    return result;
  });
  define(realm.Set.prototype, 'difference', function (other) {
    const result = new realm.Set();
    for (const value of this) if (!other.has(value)) result.add(value);
    return result;
  });
  // History queries return generators; standard Rende also chains map/reduce.
  const iterator = realm.Object.getPrototypeOf(
    realm.Object.getPrototypeOf(new realm.Array()[realm.Symbol.iterator]()),
  );
  define(iterator, 'toArray', function () {
    return realm.Array.from(this);
  });
  define(iterator, 'map', function (callback) {
    if (typeof callback !== 'function') throw new TypeError('iterator callback must be a function');
    const source = this;
    return (function* () {
      let index = 0;
      for (const value of source) yield callback(value, index++);
    })();
  });
  define(iterator, 'reduce', function (callback, ...initial) {
    if (typeof callback !== 'function') throw new TypeError('iterator callback must be a function');
    let hasValue = initial.length > 0;
    let result = initial[0];
    let index = 0;
    for (const value of this) {
      if (hasValue) result = callback(result, value, index);
      else {
        result = value;
        hasValue = true;
      }
      index++;
    }
    if (!hasValue) throw new TypeError('cannot reduce an empty iterator without an initial value');
    return result;
  });
}

installBrowserCompatibility();
