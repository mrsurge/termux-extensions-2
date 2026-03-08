var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/window.ts
function ensureCodeWindow(targetWindow, fallbackWindowId) {
  const codeWindow = targetWindow;
  if (typeof codeWindow.vscodeWindowId !== "number") {
    Object.defineProperty(codeWindow, "vscodeWindowId", {
      get: () => fallbackWindowId
    });
  }
}
var mainWindow = window;

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/collections.ts
function groupBy(data, groupFn) {
  const result = /* @__PURE__ */ Object.create(null);
  for (const element of data) {
    const key = groupFn(element);
    let target = result[key];
    if (!target) {
      target = result[key] = [];
    }
    target.push(element);
  }
  return result;
}
var _a, _b;
var SetWithKey = class {
  constructor(values, toKey) {
    this.toKey = toKey;
    this._map = /* @__PURE__ */ new Map();
    this[_a] = "SetWithKey";
    for (const value of values) {
      this.add(value);
    }
  }
  get size() {
    return this._map.size;
  }
  add(value) {
    const key = this.toKey(value);
    this._map.set(key, value);
    return this;
  }
  delete(value) {
    return this._map.delete(this.toKey(value));
  }
  has(value) {
    return this._map.has(this.toKey(value));
  }
  *entries() {
    for (const entry of this._map.values()) {
      yield [entry, entry];
    }
  }
  keys() {
    return this.values();
  }
  *values() {
    for (const entry of this._map.values()) {
      yield entry;
    }
  }
  clear() {
    this._map.clear();
  }
  forEach(callbackfn, thisArg) {
    this._map.forEach((entry) => callbackfn.call(thisArg, entry, entry, this));
  }
  [(_b = Symbol.iterator, _a = Symbol.toStringTag, _b)]() {
    return this.values();
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/errors.ts
var ErrorHandler = class {
  constructor() {
    this.listeners = [];
    this.unexpectedErrorHandler = function(e) {
      setTimeout(() => {
        if (e.stack) {
          if (ErrorNoTelemetry.isErrorNoTelemetry(e)) {
            throw new ErrorNoTelemetry(e.message + "\n\n" + e.stack);
          }
          throw new Error(e.message + "\n\n" + e.stack);
        }
        throw e;
      }, 0);
    };
  }
  addListener(listener) {
    this.listeners.push(listener);
    return () => {
      this._removeListener(listener);
    };
  }
  emit(e) {
    this.listeners.forEach((listener) => {
      listener(e);
    });
  }
  _removeListener(listener) {
    this.listeners.splice(this.listeners.indexOf(listener), 1);
  }
  setUnexpectedErrorHandler(newUnexpectedErrorHandler) {
    this.unexpectedErrorHandler = newUnexpectedErrorHandler;
  }
  getUnexpectedErrorHandler() {
    return this.unexpectedErrorHandler;
  }
  onUnexpectedError(e) {
    this.unexpectedErrorHandler(e);
    this.emit(e);
  }
  // For external errors, we don't want the listeners to be called
  onUnexpectedExternalError(e) {
    this.unexpectedErrorHandler(e);
  }
};
var errorHandler = new ErrorHandler();
function onBugIndicatingError(e) {
  errorHandler.onUnexpectedError(e);
  return void 0;
}
function onUnexpectedError(e) {
  if (!isCancellationError(e)) {
    errorHandler.onUnexpectedError(e);
  }
  return void 0;
}
var canceledName = "Canceled";
function isCancellationError(error) {
  if (error instanceof CancellationError) {
    return true;
  }
  return error instanceof Error && error.name === canceledName && error.message === canceledName;
}
var CancellationError = class extends Error {
  constructor() {
    super(canceledName);
    this.name = this.message;
  }
};
var PendingMigrationError = class _PendingMigrationError extends Error {
  static {
    this._name = "PendingMigrationError";
  }
  static is(error) {
    return error instanceof _PendingMigrationError || error instanceof Error && error.name === _PendingMigrationError._name;
  }
  constructor(message) {
    super(message);
    this.name = _PendingMigrationError._name;
  }
};
function illegalArgument(name) {
  if (name) {
    return new Error(`Illegal argument: ${name}`);
  } else {
    return new Error("Illegal argument");
  }
}
var ErrorNoTelemetry = class _ErrorNoTelemetry extends Error {
  constructor(msg) {
    super(msg);
    this.name = "CodeExpectedError";
  }
  static fromError(err) {
    if (err instanceof _ErrorNoTelemetry) {
      return err;
    }
    const result = new _ErrorNoTelemetry();
    result.message = err.message;
    result.stack = err.stack;
    return result;
  }
  static isErrorNoTelemetry(err) {
    return err.name === "CodeExpectedError";
  }
};
var BugIndicatingError = class _BugIndicatingError extends Error {
  constructor(message) {
    super(message || "An unexpected bug occurred.");
    Object.setPrototypeOf(this, _BugIndicatingError.prototype);
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/arraysFind.ts
function findLastIdxMonotonous(array, predicate, startIdx = 0, endIdxEx = array.length) {
  let i = startIdx;
  let j = endIdxEx;
  while (i < j) {
    const k = Math.floor((i + j) / 2);
    if (predicate(array[k])) {
      i = k + 1;
    } else {
      j = k;
    }
  }
  return i - 1;
}
var MonotonousArray = class _MonotonousArray {
  constructor(_array) {
    this._array = _array;
    this._findLastMonotonousLastIdx = 0;
  }
  static {
    this.assertInvariants = false;
  }
  /**
   * The predicate must be monotonous, i.e. `arr.map(predicate)` must be like `[true, ..., true, false, ..., false]`!
   * For subsequent calls, current predicate must be weaker than (or equal to) the previous predicate, i.e. more entries must be `true`.
   */
  findLastMonotonous(predicate) {
    if (_MonotonousArray.assertInvariants) {
      if (this._prevFindLastPredicate) {
        for (const item of this._array) {
          if (this._prevFindLastPredicate(item) && !predicate(item)) {
            throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.");
          }
        }
      }
      this._prevFindLastPredicate = predicate;
    }
    const idx = findLastIdxMonotonous(this._array, predicate, this._findLastMonotonousLastIdx);
    this._findLastMonotonousLastIdx = idx + 1;
    return idx === -1 ? void 0 : this._array[idx];
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/arrays.ts
function equals(one, other, itemEquals = (a, b) => a === b) {
  if (one === other) {
    return true;
  }
  if (!one || !other) {
    return false;
  }
  if (one.length !== other.length) {
    return false;
  }
  for (let i = 0, len = one.length; i < len; i++) {
    if (!itemEquals(one[i], other[i])) {
      return false;
    }
  }
  return true;
}
function commonPrefixLength(one, other, equals3 = (a, b) => a === b) {
  let result = 0;
  for (let i = 0, len = Math.min(one.length, other.length); i < len && equals3(one[i], other[i]); i++) {
    result++;
  }
  return result;
}
var CompareResult;
((CompareResult2) => {
  function isLessThan(result) {
    return result < 0;
  }
  CompareResult2.isLessThan = isLessThan;
  function isLessThanOrEqual(result) {
    return result <= 0;
  }
  CompareResult2.isLessThanOrEqual = isLessThanOrEqual;
  function isGreaterThan(result) {
    return result > 0;
  }
  CompareResult2.isGreaterThan = isGreaterThan;
  function isNeitherLessOrGreaterThan(result) {
    return result === 0;
  }
  CompareResult2.isNeitherLessOrGreaterThan = isNeitherLessOrGreaterThan;
  CompareResult2.greaterThan = 1;
  CompareResult2.lessThan = -1;
  CompareResult2.neitherLessOrGreaterThan = 0;
})(CompareResult || (CompareResult = {}));
function compareBy(selector, comparator) {
  return (a, b) => comparator(selector(a), selector(b));
}
var numberComparator = (a, b) => a - b;
var CallbackIterable = class _CallbackIterable {
  constructor(iterate) {
    this.iterate = iterate;
  }
  static {
    this.empty = new _CallbackIterable((_callback) => {
    });
  }
  forEach(handler) {
    this.iterate((item) => {
      handler(item);
      return true;
    });
  }
  toArray() {
    const result = [];
    this.iterate((item) => {
      result.push(item);
      return true;
    });
    return result;
  }
  filter(predicate) {
    return new _CallbackIterable((cb) => this.iterate((item) => predicate(item) ? cb(item) : true));
  }
  map(mapFn) {
    return new _CallbackIterable((cb) => this.iterate((item) => cb(mapFn(item))));
  }
  some(predicate) {
    let result = false;
    this.iterate((item) => {
      result = predicate(item);
      return !result;
    });
    return result;
  }
  findFirst(predicate) {
    let result;
    this.iterate((item) => {
      if (predicate(item)) {
        result = item;
        return false;
      }
      return true;
    });
    return result;
  }
  findLast(predicate) {
    let result;
    this.iterate((item) => {
      if (predicate(item)) {
        result = item;
      }
      return true;
    });
    return result;
  }
  findLastMaxBy(comparator) {
    let result;
    let first = true;
    this.iterate((item) => {
      if (first || CompareResult.isGreaterThan(comparator(item, result))) {
        first = false;
        result = item;
      }
      return true;
    });
    return result;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/map.ts
var ResourceMapEntry = class {
  constructor(uri, value) {
    this.uri = uri;
    this.value = value;
  }
};
function isEntries(arg) {
  return Array.isArray(arg);
}
var _a2;
var ResourceMap = class _ResourceMap {
  constructor(arg, toKey) {
    this[_a2] = "ResourceMap";
    if (arg instanceof _ResourceMap) {
      this.map = new Map(arg.map);
      this.toKey = toKey ?? _ResourceMap.defaultToKey;
    } else if (isEntries(arg)) {
      this.map = /* @__PURE__ */ new Map();
      this.toKey = toKey ?? _ResourceMap.defaultToKey;
      for (const [resource, value] of arg) {
        this.set(resource, value);
      }
    } else {
      this.map = /* @__PURE__ */ new Map();
      this.toKey = arg ?? _ResourceMap.defaultToKey;
    }
  }
  static {
    this.defaultToKey = (resource) => resource.toString();
  }
  set(resource, value) {
    this.map.set(this.toKey(resource), new ResourceMapEntry(resource, value));
    return this;
  }
  get(resource) {
    return this.map.get(this.toKey(resource))?.value;
  }
  has(resource) {
    return this.map.has(this.toKey(resource));
  }
  get size() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  delete(resource) {
    return this.map.delete(this.toKey(resource));
  }
  forEach(clb, thisArg) {
    if (typeof thisArg !== "undefined") {
      clb = clb.bind(thisArg);
    }
    for (const [_, entry] of this.map) {
      clb(entry.value, entry.uri, this);
    }
  }
  *values() {
    for (const entry of this.map.values()) {
      yield entry.value;
    }
  }
  *keys() {
    for (const entry of this.map.values()) {
      yield entry.uri;
    }
  }
  *entries() {
    for (const entry of this.map.values()) {
      yield [entry.uri, entry.value];
    }
  }
  *[(_a2 = Symbol.toStringTag, Symbol.iterator)]() {
    for (const [, entry] of this.map) {
      yield [entry.uri, entry.value];
    }
  }
};
var _a3;
var ResourceSet = class {
  constructor(entriesOrKey, toKey) {
    this[_a3] = "ResourceSet";
    if (!entriesOrKey || typeof entriesOrKey === "function") {
      this._map = new ResourceMap(entriesOrKey);
    } else {
      this._map = new ResourceMap(toKey);
      entriesOrKey.forEach(this.add, this);
    }
  }
  get size() {
    return this._map.size;
  }
  add(value) {
    this._map.set(value, value);
    return this;
  }
  clear() {
    this._map.clear();
  }
  delete(value) {
    return this._map.delete(value);
  }
  forEach(callbackfn, thisArg) {
    this._map.forEach((_value, key) => callbackfn.call(thisArg, key, key, this));
  }
  has(value) {
    return this._map.has(value);
  }
  entries() {
    return this._map.entries();
  }
  keys() {
    return this._map.keys();
  }
  values() {
    return this._map.keys();
  }
  [(_a3 = Symbol.toStringTag, Symbol.iterator)]() {
    return this.keys();
  }
};
var _a4;
var LinkedMap = class {
  constructor() {
    this[_a4] = "LinkedMap";
    this._map = /* @__PURE__ */ new Map();
    this._head = void 0;
    this._tail = void 0;
    this._size = 0;
    this._state = 0;
  }
  clear() {
    this._map.clear();
    this._head = void 0;
    this._tail = void 0;
    this._size = 0;
    this._state++;
  }
  isEmpty() {
    return !this._head && !this._tail;
  }
  get size() {
    return this._size;
  }
  get first() {
    return this._head?.value;
  }
  get last() {
    return this._tail?.value;
  }
  has(key) {
    return this._map.has(key);
  }
  get(key, touch = 0 /* None */) {
    const item = this._map.get(key);
    if (!item) {
      return void 0;
    }
    if (touch !== 0 /* None */) {
      this.touch(item, touch);
    }
    return item.value;
  }
  set(key, value, touch = 0 /* None */) {
    let item = this._map.get(key);
    if (item) {
      item.value = value;
      if (touch !== 0 /* None */) {
        this.touch(item, touch);
      }
    } else {
      item = { key, value, next: void 0, previous: void 0 };
      switch (touch) {
        case 0 /* None */:
          this.addItemLast(item);
          break;
        case 1 /* AsOld */:
          this.addItemFirst(item);
          break;
        case 2 /* AsNew */:
          this.addItemLast(item);
          break;
        default:
          this.addItemLast(item);
          break;
      }
      this._map.set(key, item);
      this._size++;
    }
    return this;
  }
  delete(key) {
    return !!this.remove(key);
  }
  remove(key) {
    const item = this._map.get(key);
    if (!item) {
      return void 0;
    }
    this._map.delete(key);
    this.removeItem(item);
    this._size--;
    return item.value;
  }
  shift() {
    if (!this._head && !this._tail) {
      return void 0;
    }
    if (!this._head || !this._tail) {
      throw new Error("Invalid list");
    }
    const item = this._head;
    this._map.delete(item.key);
    this.removeItem(item);
    this._size--;
    return item.value;
  }
  forEach(callbackfn, thisArg) {
    const state = this._state;
    let current = this._head;
    while (current) {
      if (thisArg) {
        callbackfn.bind(thisArg)(current.value, current.key, this);
      } else {
        callbackfn(current.value, current.key, this);
      }
      if (this._state !== state) {
        throw new Error(`LinkedMap got modified during iteration.`);
      }
      current = current.next;
    }
  }
  keys() {
    const map = this;
    const state = this._state;
    let current = this._head;
    const iterator = {
      [Symbol.iterator]() {
        return iterator;
      },
      next() {
        if (map._state !== state) {
          throw new Error(`LinkedMap got modified during iteration.`);
        }
        if (current) {
          const result = { value: current.key, done: false };
          current = current.next;
          return result;
        } else {
          return { value: void 0, done: true };
        }
      }
    };
    return iterator;
  }
  values() {
    const map = this;
    const state = this._state;
    let current = this._head;
    const iterator = {
      [Symbol.iterator]() {
        return iterator;
      },
      next() {
        if (map._state !== state) {
          throw new Error(`LinkedMap got modified during iteration.`);
        }
        if (current) {
          const result = { value: current.value, done: false };
          current = current.next;
          return result;
        } else {
          return { value: void 0, done: true };
        }
      }
    };
    return iterator;
  }
  entries() {
    const map = this;
    const state = this._state;
    let current = this._head;
    const iterator = {
      [Symbol.iterator]() {
        return iterator;
      },
      next() {
        if (map._state !== state) {
          throw new Error(`LinkedMap got modified during iteration.`);
        }
        if (current) {
          const result = { value: [current.key, current.value], done: false };
          current = current.next;
          return result;
        } else {
          return { value: void 0, done: true };
        }
      }
    };
    return iterator;
  }
  [(_a4 = Symbol.toStringTag, Symbol.iterator)]() {
    return this.entries();
  }
  trimOld(newSize) {
    if (newSize >= this.size) {
      return;
    }
    if (newSize === 0) {
      this.clear();
      return;
    }
    let current = this._head;
    let currentSize = this.size;
    while (current && currentSize > newSize) {
      this._map.delete(current.key);
      current = current.next;
      currentSize--;
    }
    this._head = current;
    this._size = currentSize;
    if (current) {
      current.previous = void 0;
    }
    this._state++;
  }
  trimNew(newSize) {
    if (newSize >= this.size) {
      return;
    }
    if (newSize === 0) {
      this.clear();
      return;
    }
    let current = this._tail;
    let currentSize = this.size;
    while (current && currentSize > newSize) {
      this._map.delete(current.key);
      current = current.previous;
      currentSize--;
    }
    this._tail = current;
    this._size = currentSize;
    if (current) {
      current.next = void 0;
    }
    this._state++;
  }
  addItemFirst(item) {
    if (!this._head && !this._tail) {
      this._tail = item;
    } else if (!this._head) {
      throw new Error("Invalid list");
    } else {
      item.next = this._head;
      this._head.previous = item;
    }
    this._head = item;
    this._state++;
  }
  addItemLast(item) {
    if (!this._head && !this._tail) {
      this._head = item;
    } else if (!this._tail) {
      throw new Error("Invalid list");
    } else {
      item.previous = this._tail;
      this._tail.next = item;
    }
    this._tail = item;
    this._state++;
  }
  removeItem(item) {
    if (item === this._head && item === this._tail) {
      this._head = void 0;
      this._tail = void 0;
    } else if (item === this._head) {
      if (!item.next) {
        throw new Error("Invalid list");
      }
      item.next.previous = void 0;
      this._head = item.next;
    } else if (item === this._tail) {
      if (!item.previous) {
        throw new Error("Invalid list");
      }
      item.previous.next = void 0;
      this._tail = item.previous;
    } else {
      const next = item.next;
      const previous = item.previous;
      if (!next || !previous) {
        throw new Error("Invalid list");
      }
      next.previous = previous;
      previous.next = next;
    }
    item.next = void 0;
    item.previous = void 0;
    this._state++;
  }
  touch(item, touch) {
    if (!this._head || !this._tail) {
      throw new Error("Invalid list");
    }
    if (touch !== 1 /* AsOld */ && touch !== 2 /* AsNew */) {
      return;
    }
    if (touch === 1 /* AsOld */) {
      if (item === this._head) {
        return;
      }
      const next = item.next;
      const previous = item.previous;
      if (item === this._tail) {
        previous.next = void 0;
        this._tail = previous;
      } else {
        next.previous = previous;
        previous.next = next;
      }
      item.previous = void 0;
      item.next = this._head;
      this._head.previous = item;
      this._head = item;
      this._state++;
    } else if (touch === 2 /* AsNew */) {
      if (item === this._tail) {
        return;
      }
      const next = item.next;
      const previous = item.previous;
      if (item === this._head) {
        next.previous = void 0;
        this._head = next;
      } else {
        next.previous = previous;
        previous.next = next;
      }
      item.next = void 0;
      item.previous = this._tail;
      this._tail.next = item;
      this._tail = item;
      this._state++;
    }
  }
  toJSON() {
    const data = [];
    this.forEach((value, key) => {
      data.push([key, value]);
    });
    return data;
  }
  fromJSON(data) {
    this.clear();
    for (const [key, value] of data) {
      this.set(key, value);
    }
  }
};
var SetMap = class {
  constructor() {
    this.map = /* @__PURE__ */ new Map();
  }
  add(key, value) {
    let values = this.map.get(key);
    if (!values) {
      values = /* @__PURE__ */ new Set();
      this.map.set(key, values);
    }
    values.add(value);
  }
  delete(key, value) {
    const values = this.map.get(key);
    if (!values) {
      return;
    }
    values.delete(value);
    if (values.size === 0) {
      this.map.delete(key);
    }
  }
  forEach(key, fn) {
    const values = this.map.get(key);
    if (!values) {
      return;
    }
    values.forEach(fn);
  }
  get(key) {
    const values = this.map.get(key);
    if (!values) {
      return /* @__PURE__ */ new Set();
    }
    return values;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/assert.ts
function assertFn(condition) {
  if (!condition()) {
    debugger;
    condition();
    onUnexpectedError(new BugIndicatingError("Assertion Failed"));
  }
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/types.ts
function isString(str) {
  return typeof str === "string";
}
function isIterable(obj) {
  return !!obj && typeof obj[Symbol.iterator] === "function";
}
function isUndefined(obj) {
  return typeof obj === "undefined";
}
function isDefined(arg) {
  return !isUndefinedOrNull(arg);
}
function isUndefinedOrNull(obj) {
  return isUndefined(obj) || obj === null;
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/iterator.ts
var Iterable;
((Iterable2) => {
  function is(thing) {
    return !!thing && typeof thing === "object" && typeof thing[Symbol.iterator] === "function";
  }
  Iterable2.is = is;
  const _empty2 = Object.freeze([]);
  function empty() {
    return _empty2;
  }
  Iterable2.empty = empty;
  function* single(element) {
    yield element;
  }
  Iterable2.single = single;
  function wrap(iterableOrElement) {
    if (is(iterableOrElement)) {
      return iterableOrElement;
    } else {
      return single(iterableOrElement);
    }
  }
  Iterable2.wrap = wrap;
  function from(iterable) {
    return iterable ?? _empty2;
  }
  Iterable2.from = from;
  function* reverse(array) {
    for (let i = array.length - 1; i >= 0; i--) {
      yield array[i];
    }
  }
  Iterable2.reverse = reverse;
  function isEmpty(iterable) {
    return !iterable || iterable[Symbol.iterator]().next().done === true;
  }
  Iterable2.isEmpty = isEmpty;
  function first(iterable) {
    return iterable[Symbol.iterator]().next().value;
  }
  Iterable2.first = first;
  function some(iterable, predicate) {
    let i = 0;
    for (const element of iterable) {
      if (predicate(element, i++)) {
        return true;
      }
    }
    return false;
  }
  Iterable2.some = some;
  function every(iterable, predicate) {
    let i = 0;
    for (const element of iterable) {
      if (!predicate(element, i++)) {
        return false;
      }
    }
    return true;
  }
  Iterable2.every = every;
  function find(iterable, predicate) {
    for (const element of iterable) {
      if (predicate(element)) {
        return element;
      }
    }
    return void 0;
  }
  Iterable2.find = find;
  function* filter(iterable, predicate) {
    for (const element of iterable) {
      if (predicate(element)) {
        yield element;
      }
    }
  }
  Iterable2.filter = filter;
  function* map(iterable, fn) {
    let index = 0;
    for (const element of iterable) {
      yield fn(element, index++);
    }
  }
  Iterable2.map = map;
  function* flatMap(iterable, fn) {
    let index = 0;
    for (const element of iterable) {
      yield* fn(element, index++);
    }
  }
  Iterable2.flatMap = flatMap;
  function* concat(...iterables) {
    for (const item of iterables) {
      if (isIterable(item)) {
        yield* item;
      } else {
        yield item;
      }
    }
  }
  Iterable2.concat = concat;
  function reduce(iterable, reducer, initialValue) {
    let value = initialValue;
    for (const element of iterable) {
      value = reducer(value, element);
    }
    return value;
  }
  Iterable2.reduce = reduce;
  function length(iterable) {
    let count = 0;
    for (const _ of iterable) {
      count++;
    }
    return count;
  }
  Iterable2.length = length;
  function* slice(arr, from2, to = arr.length) {
    if (from2 < -arr.length) {
      from2 = 0;
    }
    if (from2 < 0) {
      from2 += arr.length;
    }
    if (to < 0) {
      to += arr.length;
    } else if (to > arr.length) {
      to = arr.length;
    }
    for (; from2 < to; from2++) {
      yield arr[from2];
    }
  }
  Iterable2.slice = slice;
  function consume(iterable, atMost = Number.POSITIVE_INFINITY) {
    const consumed = [];
    if (atMost === 0) {
      return [consumed, iterable];
    }
    const iterator = iterable[Symbol.iterator]();
    for (let i = 0; i < atMost; i++) {
      const next = iterator.next();
      if (next.done) {
        return [consumed, Iterable2.empty()];
      }
      consumed.push(next.value);
    }
    return [consumed, { [Symbol.iterator]() {
      return iterator;
    } }];
  }
  Iterable2.consume = consume;
  async function asyncToArray(iterable) {
    const result = [];
    for await (const item of iterable) {
      result.push(item);
    }
    return result;
  }
  Iterable2.asyncToArray = asyncToArray;
  async function asyncToArrayFlat(iterable) {
    let result = [];
    for await (const item of iterable) {
      result = result.concat(item);
    }
    return result;
  }
  Iterable2.asyncToArrayFlat = asyncToArrayFlat;
})(Iterable || (Iterable = {}));

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/lifecycle.ts
var TRACK_DISPOSABLES = false;
var disposableTracker = null;
var DisposableTracker = class _DisposableTracker {
  constructor() {
    this.livingDisposables = /* @__PURE__ */ new Map();
  }
  static {
    this.idx = 0;
  }
  getDisposableData(d) {
    let val = this.livingDisposables.get(d);
    if (!val) {
      val = { parent: null, source: null, isSingleton: false, value: d, idx: _DisposableTracker.idx++ };
      this.livingDisposables.set(d, val);
    }
    return val;
  }
  trackDisposable(d) {
    const data = this.getDisposableData(d);
    if (!data.source) {
      data.source = new Error().stack;
    }
  }
  setParent(child, parent) {
    const data = this.getDisposableData(child);
    data.parent = parent;
  }
  markAsDisposed(x) {
    this.livingDisposables.delete(x);
  }
  markAsSingleton(disposable) {
    this.getDisposableData(disposable).isSingleton = true;
  }
  getRootParent(data, cache) {
    const cacheValue = cache.get(data);
    if (cacheValue) {
      return cacheValue;
    }
    const result = data.parent ? this.getRootParent(this.getDisposableData(data.parent), cache) : data;
    cache.set(data, result);
    return result;
  }
  getTrackedDisposables() {
    const rootParentCache = /* @__PURE__ */ new Map();
    const leaking = [...this.livingDisposables.entries()].filter(([, v]) => v.source !== null && !this.getRootParent(v, rootParentCache).isSingleton).flatMap(([k]) => k);
    return leaking;
  }
  computeLeakingDisposables(maxReported = 10, preComputedLeaks) {
    let uncoveredLeakingObjs;
    if (preComputedLeaks) {
      uncoveredLeakingObjs = preComputedLeaks;
    } else {
      const rootParentCache = /* @__PURE__ */ new Map();
      const leakingObjects = [...this.livingDisposables.values()].filter((info) => info.source !== null && !this.getRootParent(info, rootParentCache).isSingleton);
      if (leakingObjects.length === 0) {
        return;
      }
      const leakingObjsSet = new Set(leakingObjects.map((o) => o.value));
      uncoveredLeakingObjs = leakingObjects.filter((l) => {
        return !(l.parent && leakingObjsSet.has(l.parent));
      });
      if (uncoveredLeakingObjs.length === 0) {
        throw new Error("There are cyclic diposable chains!");
      }
    }
    if (!uncoveredLeakingObjs) {
      return void 0;
    }
    function getStackTracePath(leaking) {
      function removePrefix(array, linesToRemove) {
        while (array.length > 0 && linesToRemove.some((regexp) => typeof regexp === "string" ? regexp === array[0] : array[0].match(regexp))) {
          array.shift();
        }
      }
      const lines = leaking.source.split("\n").map((p) => p.trim().replace("at ", "")).filter((l) => l !== "");
      removePrefix(lines, ["Error", /^trackDisposable \(.*\)$/, /^DisposableTracker.trackDisposable \(.*\)$/]);
      return lines.reverse();
    }
    const stackTraceStarts = new SetMap();
    for (const leaking of uncoveredLeakingObjs) {
      const stackTracePath = getStackTracePath(leaking);
      for (let i2 = 0; i2 <= stackTracePath.length; i2++) {
        stackTraceStarts.add(stackTracePath.slice(0, i2).join("\n"), leaking);
      }
    }
    uncoveredLeakingObjs.sort(compareBy((l) => l.idx, numberComparator));
    let message = "";
    let i = 0;
    for (const leaking of uncoveredLeakingObjs.slice(0, maxReported)) {
      i++;
      const stackTracePath = getStackTracePath(leaking);
      const stackTraceFormattedLines = [];
      for (let i2 = 0; i2 < stackTracePath.length; i2++) {
        let line = stackTracePath[i2];
        const starts = stackTraceStarts.get(stackTracePath.slice(0, i2 + 1).join("\n"));
        line = `(shared with ${starts.size}/${uncoveredLeakingObjs.length} leaks) at ${line}`;
        const prevStarts = stackTraceStarts.get(stackTracePath.slice(0, i2).join("\n"));
        const continuations = groupBy([...prevStarts].map((d) => getStackTracePath(d)[i2]), (v) => v);
        delete continuations[stackTracePath[i2]];
        for (const [cont, set] of Object.entries(continuations)) {
          if (set) {
            stackTraceFormattedLines.unshift(`    - stacktraces of ${set.length} other leaks continue with ${cont}`);
          }
        }
        stackTraceFormattedLines.unshift(line);
      }
      message += `


==================== Leaking disposable ${i}/${uncoveredLeakingObjs.length}: ${leaking.value.constructor.name} ====================
${stackTraceFormattedLines.join("\n")}
============================================================

`;
    }
    if (uncoveredLeakingObjs.length > maxReported) {
      message += `


... and ${uncoveredLeakingObjs.length - maxReported} more leaking disposables

`;
    }
    return { leaks: uncoveredLeakingObjs, details: message };
  }
};
function setDisposableTracker(tracker) {
  disposableTracker = tracker;
}
if (TRACK_DISPOSABLES) {
  const __is_disposable_tracked__ = "__is_disposable_tracked__";
  setDisposableTracker(new class {
    trackDisposable(x) {
      const stack = new Error("Potentially leaked disposable").stack;
      setTimeout(() => {
        if (!x[__is_disposable_tracked__]) {
          console.log(stack);
        }
      }, 3e3);
    }
    setParent(child, parent) {
      if (child && child !== Disposable.None) {
        try {
          child[__is_disposable_tracked__] = true;
        } catch {
        }
      }
    }
    markAsDisposed(disposable) {
      if (disposable && disposable !== Disposable.None) {
        try {
          disposable[__is_disposable_tracked__] = true;
        } catch {
        }
      }
    }
    markAsSingleton(disposable) {
    }
  }());
}
function trackDisposable(x) {
  disposableTracker?.trackDisposable(x);
  return x;
}
function markAsDisposed(disposable) {
  disposableTracker?.markAsDisposed(disposable);
}
function setParentOfDisposable(child, parent) {
  disposableTracker?.setParent(child, parent);
}
function setParentOfDisposables(children, parent) {
  if (!disposableTracker) {
    return;
  }
  for (const child of children) {
    disposableTracker.setParent(child, parent);
  }
}
function markAsSingleton(singleton) {
  disposableTracker?.markAsSingleton(singleton);
  return singleton;
}
function dispose(arg) {
  if (Iterable.is(arg)) {
    const errors = [];
    for (const d of arg) {
      if (d) {
        try {
          d.dispose();
        } catch (e) {
          errors.push(e);
        }
      }
    }
    if (errors.length === 1) {
      throw errors[0];
    } else if (errors.length > 1) {
      throw new AggregateError(errors, "Encountered errors while disposing of store");
    }
    return Array.isArray(arg) ? [] : arg;
  } else if (arg) {
    arg.dispose();
    return arg;
  }
}
function combinedDisposable(...disposables) {
  const parent = toDisposable(() => dispose(disposables));
  setParentOfDisposables(disposables, parent);
  return parent;
}
var FunctionDisposable = class {
  constructor(fn) {
    this._isDisposed = false;
    this._fn = fn;
    trackDisposable(this);
  }
  dispose() {
    if (this._isDisposed) {
      return;
    }
    if (!this._fn) {
      throw new Error(`Unbound disposable context: Need to use an arrow function to preserve the value of this`);
    }
    this._isDisposed = true;
    markAsDisposed(this);
    this._fn();
  }
};
function toDisposable(fn) {
  return new FunctionDisposable(fn);
}
var DisposableStore = class _DisposableStore {
  constructor() {
    this._toDispose = /* @__PURE__ */ new Set();
    this._isDisposed = false;
    trackDisposable(this);
  }
  static {
    this.DISABLE_DISPOSED_WARNING = false;
  }
  /**
   * Dispose of all registered disposables and mark this object as disposed.
   *
   * Any future disposables added to this object will be disposed of on `add`.
   */
  dispose() {
    if (this._isDisposed) {
      return;
    }
    markAsDisposed(this);
    this._isDisposed = true;
    this.clear();
  }
  /**
   * @return `true` if this object has been disposed of.
   */
  get isDisposed() {
    return this._isDisposed;
  }
  /**
   * Dispose of all registered disposables but do not mark this object as disposed.
   */
  clear() {
    if (this._toDispose.size === 0) {
      return;
    }
    try {
      dispose(this._toDispose);
    } finally {
      this._toDispose.clear();
    }
  }
  /**
   * Add a new {@link IDisposable disposable} to the collection.
   */
  add(o) {
    if (!o || o === Disposable.None) {
      return o;
    }
    if (o === this) {
      throw new Error("Cannot register a disposable on itself!");
    }
    setParentOfDisposable(o, this);
    if (this._isDisposed) {
      if (!_DisposableStore.DISABLE_DISPOSED_WARNING) {
        console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack);
      }
    } else {
      this._toDispose.add(o);
    }
    return o;
  }
  /**
   * Deletes a disposable from store and disposes of it. This will not throw or warn and proceed to dispose the
   * disposable even when the disposable is not part in the store.
   */
  delete(o) {
    if (!o) {
      return;
    }
    if (o === this) {
      throw new Error("Cannot dispose a disposable on itself!");
    }
    this._toDispose.delete(o);
    o.dispose();
  }
  /**
   * Deletes the value from the store, but does not dispose it.
   */
  deleteAndLeak(o) {
    if (!o) {
      return;
    }
    if (this._toDispose.delete(o)) {
      setParentOfDisposable(o, null);
    }
  }
  assertNotDisposed() {
    if (this._isDisposed) {
      onUnexpectedError(new BugIndicatingError("Object disposed"));
    }
  }
};
var Disposable = class {
  constructor() {
    this._store = new DisposableStore();
    trackDisposable(this);
    setParentOfDisposable(this._store, this);
  }
  static {
    /**
     * A disposable that does nothing when it is disposed of.
     *
     * TODO: This should not be a static property.
     */
    this.None = Object.freeze({ dispose() {
    } });
  }
  dispose() {
    markAsDisposed(this);
    this._store.dispose();
  }
  /**
   * Adds `o` to the collection of disposables managed by this object.
   */
  _register(o) {
    if (o === this) {
      throw new Error("Cannot register a disposable on itself!");
    }
    return this._store.add(o);
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/linkedList.ts
var Node2 = class _Node {
  static {
    this.Undefined = new _Node(void 0);
  }
  constructor(element) {
    this.element = element;
    this.next = _Node.Undefined;
    this.prev = _Node.Undefined;
  }
};
var LinkedList = class {
  constructor() {
    this._first = Node2.Undefined;
    this._last = Node2.Undefined;
    this._size = 0;
  }
  get size() {
    return this._size;
  }
  isEmpty() {
    return this._first === Node2.Undefined;
  }
  clear() {
    let node = this._first;
    while (node !== Node2.Undefined) {
      const next = node.next;
      node.prev = Node2.Undefined;
      node.next = Node2.Undefined;
      node = next;
    }
    this._first = Node2.Undefined;
    this._last = Node2.Undefined;
    this._size = 0;
  }
  unshift(element) {
    return this._insert(element, false);
  }
  push(element) {
    return this._insert(element, true);
  }
  _insert(element, atTheEnd) {
    const newNode = new Node2(element);
    if (this._first === Node2.Undefined) {
      this._first = newNode;
      this._last = newNode;
    } else if (atTheEnd) {
      const oldLast = this._last;
      this._last = newNode;
      newNode.prev = oldLast;
      oldLast.next = newNode;
    } else {
      const oldFirst = this._first;
      this._first = newNode;
      newNode.next = oldFirst;
      oldFirst.prev = newNode;
    }
    this._size += 1;
    let didRemove = false;
    return () => {
      if (!didRemove) {
        didRemove = true;
        this._remove(newNode);
      }
    };
  }
  shift() {
    if (this._first === Node2.Undefined) {
      return void 0;
    } else {
      const res = this._first.element;
      this._remove(this._first);
      return res;
    }
  }
  pop() {
    if (this._last === Node2.Undefined) {
      return void 0;
    } else {
      const res = this._last.element;
      this._remove(this._last);
      return res;
    }
  }
  peek() {
    if (this._last === Node2.Undefined) {
      return void 0;
    } else {
      const res = this._last.element;
      return res;
    }
  }
  _remove(node) {
    if (node.prev !== Node2.Undefined && node.next !== Node2.Undefined) {
      const anchor = node.prev;
      anchor.next = node.next;
      node.next.prev = anchor;
    } else if (node.prev === Node2.Undefined && node.next === Node2.Undefined) {
      this._first = Node2.Undefined;
      this._last = Node2.Undefined;
    } else if (node.next === Node2.Undefined) {
      this._last = this._last.prev;
      this._last.next = Node2.Undefined;
    } else if (node.prev === Node2.Undefined) {
      this._first = this._first.next;
      this._first.prev = Node2.Undefined;
    }
    this._size -= 1;
  }
  *[Symbol.iterator]() {
    let node = this._first;
    while (node !== Node2.Undefined) {
      yield node.element;
      node = node.next;
    }
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/stopwatch.ts
var performanceNow = globalThis.performance.now.bind(globalThis.performance);
var StopWatch = class _StopWatch {
  static create(highResolution) {
    return new _StopWatch(highResolution);
  }
  constructor(highResolution) {
    this._now = highResolution === false ? Date.now : performanceNow;
    this._startTime = this._now();
    this._stopTime = -1;
  }
  stop() {
    this._stopTime = this._now();
  }
  reset() {
    this._startTime = this._now();
    this._stopTime = -1;
  }
  elapsed() {
    if (this._stopTime !== -1) {
      return this._stopTime - this._startTime;
    }
    return this._now() - this._startTime;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/event.ts
var _enableDisposeWithListenerWarning = false;
var _enableSnapshotPotentialLeakWarning = false;
var Event;
((Event7) => {
  Event7.None = () => Disposable.None;
  function _addLeakageTraceLogic(options) {
    if (_enableSnapshotPotentialLeakWarning) {
      const { onDidAddListener: origListenerDidAdd } = options;
      const stack = Stacktrace.create();
      let count = 0;
      options.onDidAddListener = () => {
        if (++count === 2) {
          console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here");
          stack.print();
        }
        origListenerDidAdd?.();
      };
    }
  }
  function defer(event, flushOnListenerRemove, disposable) {
    return debounce(event, () => void 0, 0, void 0, flushOnListenerRemove ?? true, void 0, disposable);
  }
  Event7.defer = defer;
  function once(event) {
    return (listener, thisArgs = null, disposables) => {
      let didFire = false;
      let result = void 0;
      result = event((e) => {
        if (didFire) {
          return;
        } else if (result) {
          result.dispose();
        } else {
          didFire = true;
        }
        return listener.call(thisArgs, e);
      }, null, disposables);
      if (didFire) {
        result.dispose();
      }
      return result;
    };
  }
  Event7.once = once;
  function onceIf(event, condition) {
    return Event7.once(Event7.filter(event, condition));
  }
  Event7.onceIf = onceIf;
  function map(event, map2, disposable) {
    return snapshot((listener, thisArgs = null, disposables) => event((i) => listener.call(thisArgs, map2(i)), null, disposables), disposable);
  }
  Event7.map = map;
  function forEach(event, each, disposable) {
    return snapshot((listener, thisArgs = null, disposables) => event((i) => {
      each(i);
      listener.call(thisArgs, i);
    }, null, disposables), disposable);
  }
  Event7.forEach = forEach;
  function filter(event, filter2, disposable) {
    return snapshot((listener, thisArgs = null, disposables) => event((e) => filter2(e) && listener.call(thisArgs, e), null, disposables), disposable);
  }
  Event7.filter = filter;
  function signal(event) {
    return event;
  }
  Event7.signal = signal;
  function any(...events) {
    return (listener, thisArgs = null, disposables) => {
      const disposable = combinedDisposable(...events.map((event) => event((e) => listener.call(thisArgs, e))));
      return addAndReturnDisposable(disposable, disposables);
    };
  }
  Event7.any = any;
  function reduce(event, merge, initial, disposable) {
    let output = initial;
    return map(event, (e) => {
      output = merge(output, e);
      return output;
    }, disposable);
  }
  Event7.reduce = reduce;
  function snapshot(event, disposable) {
    let listener;
    const options = {
      onWillAddFirstListener() {
        listener = event(emitter.fire, emitter);
      },
      onDidRemoveLastListener() {
        listener?.dispose();
      }
    };
    if (!disposable) {
      _addLeakageTraceLogic(options);
    }
    const emitter = new Emitter(options);
    disposable?.add(emitter);
    return emitter.event;
  }
  function addAndReturnDisposable(d, store) {
    if (store instanceof Array) {
      store.push(d);
    } else if (store) {
      store.add(d);
    }
    return d;
  }
  function debounce(event, merge, delay = 100, leading = false, flushOnListenerRemove = false, leakWarningThreshold, disposable) {
    let subscription;
    let output = void 0;
    let handle = void 0;
    let numDebouncedCalls = 0;
    let doFire;
    const options = {
      leakWarningThreshold,
      onWillAddFirstListener() {
        subscription = event((cur) => {
          numDebouncedCalls++;
          output = merge(output, cur);
          if (leading && !handle) {
            emitter.fire(output);
            output = void 0;
          }
          doFire = () => {
            const _output = output;
            output = void 0;
            handle = void 0;
            if (!leading || numDebouncedCalls > 1) {
              emitter.fire(_output);
            }
            numDebouncedCalls = 0;
          };
          if (typeof delay === "number") {
            if (handle) {
              clearTimeout(handle);
            }
            handle = setTimeout(doFire, delay);
          } else {
            if (handle === void 0) {
              handle = null;
              queueMicrotask(doFire);
            }
          }
        });
      },
      onWillRemoveListener() {
        if (flushOnListenerRemove && numDebouncedCalls > 0) {
          doFire?.();
        }
      },
      onDidRemoveLastListener() {
        doFire = void 0;
        subscription.dispose();
      }
    };
    if (!disposable) {
      _addLeakageTraceLogic(options);
    }
    const emitter = new Emitter(options);
    disposable?.add(emitter);
    return emitter.event;
  }
  Event7.debounce = debounce;
  function accumulate(event, delay = 0, flushOnListenerRemove, disposable) {
    return Event7.debounce(event, (last, e) => {
      if (!last) {
        return [e];
      }
      last.push(e);
      return last;
    }, delay, void 0, flushOnListenerRemove ?? true, void 0, disposable);
  }
  Event7.accumulate = accumulate;
  function latch(event, equals3 = (a, b) => a === b, disposable) {
    let firstCall = true;
    let cache;
    return filter(event, (value) => {
      const shouldEmit = firstCall || !equals3(value, cache);
      firstCall = false;
      cache = value;
      return shouldEmit;
    }, disposable);
  }
  Event7.latch = latch;
  function split(event, isT, disposable) {
    return [
      Event7.filter(event, isT, disposable),
      Event7.filter(event, (e) => !isT(e), disposable)
    ];
  }
  Event7.split = split;
  function buffer(event, flushAfterTimeout = false, _buffer = [], disposable) {
    let buffer2 = _buffer.slice();
    let listener = event((e) => {
      if (buffer2) {
        buffer2.push(e);
      } else {
        emitter.fire(e);
      }
    });
    if (disposable) {
      disposable.add(listener);
    }
    const flush = () => {
      buffer2?.forEach((e) => emitter.fire(e));
      buffer2 = null;
    };
    const emitter = new Emitter({
      onWillAddFirstListener() {
        if (!listener) {
          listener = event((e) => emitter.fire(e));
          if (disposable) {
            disposable.add(listener);
          }
        }
      },
      onDidAddFirstListener() {
        if (buffer2) {
          if (flushAfterTimeout) {
            setTimeout(flush);
          } else {
            flush();
          }
        }
      },
      onDidRemoveLastListener() {
        if (listener) {
          listener.dispose();
        }
        listener = null;
      }
    });
    if (disposable) {
      disposable.add(emitter);
    }
    return emitter.event;
  }
  Event7.buffer = buffer;
  function chain(event, sythensize) {
    const fn = (listener, thisArgs, disposables) => {
      const cs = sythensize(new ChainableSynthesis());
      return event(function(value) {
        const result = cs.evaluate(value);
        if (result !== HaltChainable) {
          listener.call(thisArgs, result);
        }
      }, void 0, disposables);
    };
    return fn;
  }
  Event7.chain = chain;
  const HaltChainable = Symbol("HaltChainable");
  class ChainableSynthesis {
    constructor() {
      this.steps = [];
    }
    map(fn) {
      this.steps.push(fn);
      return this;
    }
    forEach(fn) {
      this.steps.push((v) => {
        fn(v);
        return v;
      });
      return this;
    }
    filter(fn) {
      this.steps.push((v) => fn(v) ? v : HaltChainable);
      return this;
    }
    reduce(merge, initial) {
      let last = initial;
      this.steps.push((v) => {
        last = merge(last, v);
        return last;
      });
      return this;
    }
    latch(equals3 = (a, b) => a === b) {
      let firstCall = true;
      let cache;
      this.steps.push((value) => {
        const shouldEmit = firstCall || !equals3(value, cache);
        firstCall = false;
        cache = value;
        return shouldEmit ? value : HaltChainable;
      });
      return this;
    }
    evaluate(value) {
      for (const step of this.steps) {
        value = step(value);
        if (value === HaltChainable) {
          break;
        }
      }
      return value;
    }
  }
  function fromNodeEventEmitter(emitter, eventName, map2 = (id2) => id2) {
    const fn = (...args) => result.fire(map2(...args));
    const onFirstListenerAdd = () => emitter.on(eventName, fn);
    const onLastListenerRemove = () => emitter.removeListener(eventName, fn);
    const result = new Emitter({ onWillAddFirstListener: onFirstListenerAdd, onDidRemoveLastListener: onLastListenerRemove });
    return result.event;
  }
  Event7.fromNodeEventEmitter = fromNodeEventEmitter;
  function fromDOMEventEmitter(emitter, eventName, map2 = (id2) => id2) {
    const fn = (...args) => result.fire(map2(...args));
    const onFirstListenerAdd = () => emitter.addEventListener(eventName, fn);
    const onLastListenerRemove = () => emitter.removeEventListener(eventName, fn);
    const result = new Emitter({ onWillAddFirstListener: onFirstListenerAdd, onDidRemoveLastListener: onLastListenerRemove });
    return result.event;
  }
  Event7.fromDOMEventEmitter = fromDOMEventEmitter;
  function toPromise(event, disposables) {
    let cancelRef;
    let listener;
    const promise = new Promise((resolve3) => {
      listener = once(event)(resolve3);
      addToDisposables(listener, disposables);
      cancelRef = () => {
        disposeAndRemove(listener, disposables);
      };
    });
    promise.cancel = cancelRef;
    if (disposables) {
      promise.finally(() => disposeAndRemove(listener, disposables));
    }
    return promise;
  }
  Event7.toPromise = toPromise;
  function forward(from, to) {
    return from((e) => to.fire(e));
  }
  Event7.forward = forward;
  function runAndSubscribe(event, handler, initial) {
    handler(initial);
    return event((e) => handler(e));
  }
  Event7.runAndSubscribe = runAndSubscribe;
  class EmitterObserver {
    constructor(_observable, store) {
      this._observable = _observable;
      this._counter = 0;
      this._hasChanged = false;
      const options = {
        onWillAddFirstListener: () => {
          _observable.addObserver(this);
          this._observable.reportChanges();
        },
        onDidRemoveLastListener: () => {
          _observable.removeObserver(this);
        }
      };
      if (!store) {
        _addLeakageTraceLogic(options);
      }
      this.emitter = new Emitter(options);
      if (store) {
        store.add(this.emitter);
      }
    }
    beginUpdate(_observable) {
      this._counter++;
    }
    handlePossibleChange(_observable) {
    }
    handleChange(_observable, _change) {
      this._hasChanged = true;
    }
    endUpdate(_observable) {
      this._counter--;
      if (this._counter === 0) {
        this._observable.reportChanges();
        if (this._hasChanged) {
          this._hasChanged = false;
          this.emitter.fire(this._observable.get());
        }
      }
    }
  }
  function fromObservable(obs, store) {
    const observer = new EmitterObserver(obs, store);
    return observer.emitter.event;
  }
  Event7.fromObservable = fromObservable;
  function fromObservableLight(observable) {
    return (listener, thisArgs, disposables) => {
      let count = 0;
      let didChange = false;
      const observer = {
        beginUpdate() {
          count++;
        },
        endUpdate() {
          count--;
          if (count === 0) {
            observable.reportChanges();
            if (didChange) {
              didChange = false;
              listener.call(thisArgs);
            }
          }
        },
        handlePossibleChange() {
        },
        handleChange() {
          didChange = true;
        }
      };
      observable.addObserver(observer);
      observable.reportChanges();
      const disposable = {
        dispose() {
          observable.removeObserver(observer);
        }
      };
      addToDisposables(disposable, disposables);
      return disposable;
    };
  }
  Event7.fromObservableLight = fromObservableLight;
})(Event || (Event = {}));
var EventProfiling = class _EventProfiling {
  constructor(name) {
    this.listenerCount = 0;
    this.invocationCount = 0;
    this.elapsedOverall = 0;
    this.durations = [];
    this.name = `${name}_${_EventProfiling._idPool++}`;
    _EventProfiling.all.add(this);
  }
  static {
    this.all = /* @__PURE__ */ new Set();
  }
  static {
    this._idPool = 0;
  }
  start(listenerCount) {
    this._stopWatch = new StopWatch();
    this.listenerCount = listenerCount;
  }
  stop() {
    if (this._stopWatch) {
      const elapsed = this._stopWatch.elapsed();
      this.durations.push(elapsed);
      this.elapsedOverall += elapsed;
      this.invocationCount += 1;
      this._stopWatch = void 0;
    }
  }
};
var _globalLeakWarningThreshold = -1;
var LeakageMonitor = class _LeakageMonitor {
  constructor(_errorHandler, threshold, name = (_LeakageMonitor._idPool++).toString(16).padStart(3, "0")) {
    this._errorHandler = _errorHandler;
    this.threshold = threshold;
    this.name = name;
    this._warnCountdown = 0;
  }
  static {
    this._idPool = 1;
  }
  dispose() {
    this._stacks?.clear();
  }
  check(stack, listenerCount) {
    const threshold = this.threshold;
    if (threshold <= 0 || listenerCount < threshold) {
      return void 0;
    }
    if (!this._stacks) {
      this._stacks = /* @__PURE__ */ new Map();
    }
    const count = this._stacks.get(stack.value) || 0;
    this._stacks.set(stack.value, count + 1);
    this._warnCountdown -= 1;
    if (this._warnCountdown <= 0) {
      this._warnCountdown = threshold * 0.5;
      const [topStack, topCount] = this.getMostFrequentStack();
      const message = `[${this.name}] potential listener LEAK detected, having ${listenerCount} listeners already. MOST frequent listener (${topCount}):`;
      console.warn(message);
      console.warn(topStack);
      const error = new ListenerLeakError(message, topStack);
      this._errorHandler(error);
    }
    return () => {
      const count2 = this._stacks.get(stack.value) || 0;
      this._stacks.set(stack.value, count2 - 1);
    };
  }
  getMostFrequentStack() {
    if (!this._stacks) {
      return void 0;
    }
    let topStack;
    let topCount = 0;
    for (const [stack, count] of this._stacks) {
      if (!topStack || topCount < count) {
        topStack = [stack, count];
        topCount = count;
      }
    }
    return topStack;
  }
};
var Stacktrace = class _Stacktrace {
  constructor(value) {
    this.value = value;
  }
  static create() {
    const err = new Error();
    return new _Stacktrace(err.stack ?? "");
  }
  print() {
    console.warn(this.value.split("\n").slice(2).join("\n"));
  }
};
var ListenerLeakError = class extends Error {
  constructor(message, stack) {
    super(message);
    this.name = "ListenerLeakError";
    this.stack = stack;
  }
};
var ListenerRefusalError = class extends Error {
  constructor(message, stack) {
    super(message);
    this.name = "ListenerRefusalError";
    this.stack = stack;
  }
};
var id = 0;
var UniqueContainer = class {
  constructor(value) {
    this.value = value;
    this.id = id++;
  }
};
var compactionThreshold = 2;
var forEachListener = (listeners, fn) => {
  if (listeners instanceof UniqueContainer) {
    fn(listeners);
  } else {
    for (let i = 0; i < listeners.length; i++) {
      const l = listeners[i];
      if (l) {
        fn(l);
      }
    }
  }
};
var Emitter = class {
  constructor(options) {
    this._size = 0;
    this._options = options;
    this._leakageMon = _globalLeakWarningThreshold > 0 || this._options?.leakWarningThreshold ? new LeakageMonitor(options?.onListenerError ?? onUnexpectedError, this._options?.leakWarningThreshold ?? _globalLeakWarningThreshold) : void 0;
    this._perfMon = this._options?._profName ? new EventProfiling(this._options._profName) : void 0;
    this._deliveryQueue = this._options?.deliveryQueue;
  }
  dispose() {
    if (!this._disposed) {
      this._disposed = true;
      if (this._deliveryQueue?.current === this) {
        this._deliveryQueue.reset();
      }
      if (this._listeners) {
        if (_enableDisposeWithListenerWarning) {
          const listeners = this._listeners;
          queueMicrotask(() => {
            forEachListener(listeners, (l) => l.stack?.print());
          });
        }
        this._listeners = void 0;
        this._size = 0;
      }
      this._options?.onDidRemoveLastListener?.();
      this._leakageMon?.dispose();
    }
  }
  /**
   * For the public to allow to subscribe
   * to events from this Emitter
   */
  get event() {
    this._event ??= (callback, thisArgs, disposables) => {
      if (this._leakageMon && this._size > this._leakageMon.threshold ** 2) {
        const message = `[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;
        console.warn(message);
        const tuple = this._leakageMon.getMostFrequentStack() ?? ["UNKNOWN stack", -1];
        const error = new ListenerRefusalError(`${message}. HINT: Stack shows most frequent listener (${tuple[1]}-times)`, tuple[0]);
        const errorHandler2 = this._options?.onListenerError || onUnexpectedError;
        errorHandler2(error);
        return Disposable.None;
      }
      if (this._disposed) {
        return Disposable.None;
      }
      if (thisArgs) {
        callback = callback.bind(thisArgs);
      }
      const contained = new UniqueContainer(callback);
      let removeMonitor;
      let stack;
      if (this._leakageMon && this._size >= Math.ceil(this._leakageMon.threshold * 0.2)) {
        contained.stack = Stacktrace.create();
        removeMonitor = this._leakageMon.check(contained.stack, this._size + 1);
      }
      if (_enableDisposeWithListenerWarning) {
        contained.stack = stack ?? Stacktrace.create();
      }
      if (!this._listeners) {
        this._options?.onWillAddFirstListener?.(this);
        this._listeners = contained;
        this._options?.onDidAddFirstListener?.(this);
      } else if (this._listeners instanceof UniqueContainer) {
        this._deliveryQueue ??= new EventDeliveryQueuePrivate();
        this._listeners = [this._listeners, contained];
      } else {
        this._listeners.push(contained);
      }
      this._options?.onDidAddListener?.(this);
      this._size++;
      const result = toDisposable(() => {
        removeMonitor?.();
        this._removeListener(contained);
      });
      addToDisposables(result, disposables);
      return result;
    };
    return this._event;
  }
  _removeListener(listener) {
    this._options?.onWillRemoveListener?.(this);
    if (!this._listeners) {
      return;
    }
    if (this._size === 1) {
      this._listeners = void 0;
      this._options?.onDidRemoveLastListener?.(this);
      this._size = 0;
      return;
    }
    const listeners = this._listeners;
    const index = listeners.indexOf(listener);
    if (index === -1) {
      console.log("disposed?", this._disposed);
      console.log("size?", this._size);
      console.log("arr?", JSON.stringify(this._listeners));
      throw new Error("Attempted to dispose unknown listener");
    }
    this._size--;
    listeners[index] = void 0;
    const adjustDeliveryQueue = this._deliveryQueue.current === this;
    if (this._size * compactionThreshold <= listeners.length) {
      let n2 = 0;
      for (let i = 0; i < listeners.length; i++) {
        if (listeners[i]) {
          listeners[n2++] = listeners[i];
        } else if (adjustDeliveryQueue && n2 < this._deliveryQueue.end) {
          this._deliveryQueue.end--;
          if (n2 < this._deliveryQueue.i) {
            this._deliveryQueue.i--;
          }
        }
      }
      listeners.length = n2;
    }
  }
  _deliver(listener, value) {
    if (!listener) {
      return;
    }
    const errorHandler2 = this._options?.onListenerError || onUnexpectedError;
    if (!errorHandler2) {
      listener.value(value);
      return;
    }
    try {
      listener.value(value);
    } catch (e) {
      errorHandler2(e);
    }
  }
  /** Delivers items in the queue. Assumes the queue is ready to go. */
  _deliverQueue(dq) {
    const listeners = dq.current._listeners;
    while (dq.i < dq.end) {
      this._deliver(listeners[dq.i++], dq.value);
    }
    dq.reset();
  }
  /**
   * To be kept private to fire an event to
   * subscribers
   */
  fire(event) {
    if (this._deliveryQueue?.current) {
      this._deliverQueue(this._deliveryQueue);
      this._perfMon?.stop();
    }
    this._perfMon?.start(this._size);
    if (!this._listeners) {
    } else if (this._listeners instanceof UniqueContainer) {
      this._deliver(this._listeners, event);
    } else {
      const dq = this._deliveryQueue;
      dq.enqueue(this, event, this._listeners.length);
      this._deliverQueue(dq);
    }
    this._perfMon?.stop();
  }
  hasListeners() {
    return this._size > 0;
  }
};
var EventDeliveryQueuePrivate = class {
  constructor() {
    /**
     * Index in current's listener list.
     */
    this.i = -1;
    /**
     * The last index in the listener's list to deliver.
     */
    this.end = 0;
  }
  enqueue(emitter, value, end) {
    this.i = 0;
    this.end = end;
    this.current = emitter;
    this.value = value;
  }
  reset() {
    this.i = this.end;
    this.current = void 0;
    this.value = void 0;
  }
};
function addToDisposables(result, disposables) {
  if (disposables instanceof DisposableStore) {
    disposables.add(result);
  } else if (Array.isArray(disposables)) {
    disposables.push(result);
  }
}
function disposeAndRemove(result, disposables) {
  if (disposables instanceof DisposableStore) {
    disposables.delete(result);
  } else if (Array.isArray(disposables)) {
    const index = disposables.indexOf(result);
    if (index !== -1) {
      disposables.splice(index, 1);
    }
  }
  result.dispose();
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/browser.ts
var WindowManager = class _WindowManager {
  constructor() {
    // --- Zoom Level
    this.mapWindowIdToZoomLevel = /* @__PURE__ */ new Map();
    this._onDidChangeZoomLevel = new Emitter();
    this.onDidChangeZoomLevel = this._onDidChangeZoomLevel.event;
    // --- Zoom Factor
    this.mapWindowIdToZoomFactor = /* @__PURE__ */ new Map();
    // --- Fullscreen
    this._onDidChangeFullscreen = new Emitter();
    this.onDidChangeFullscreen = this._onDidChangeFullscreen.event;
    this.mapWindowIdToFullScreen = /* @__PURE__ */ new Map();
  }
  static {
    this.INSTANCE = new _WindowManager();
  }
  getZoomLevel(targetWindow) {
    return this.mapWindowIdToZoomLevel.get(this.getWindowId(targetWindow)) ?? 0;
  }
  setZoomLevel(zoomLevel, targetWindow) {
    if (this.getZoomLevel(targetWindow) === zoomLevel) {
      return;
    }
    const targetWindowId = this.getWindowId(targetWindow);
    this.mapWindowIdToZoomLevel.set(targetWindowId, zoomLevel);
    this._onDidChangeZoomLevel.fire(targetWindowId);
  }
  getZoomFactor(targetWindow) {
    return this.mapWindowIdToZoomFactor.get(this.getWindowId(targetWindow)) ?? 1;
  }
  setZoomFactor(zoomFactor, targetWindow) {
    this.mapWindowIdToZoomFactor.set(this.getWindowId(targetWindow), zoomFactor);
  }
  setFullscreen(fullscreen, targetWindow) {
    if (this.isFullscreen(targetWindow) === fullscreen) {
      return;
    }
    const windowId = this.getWindowId(targetWindow);
    this.mapWindowIdToFullScreen.set(windowId, fullscreen);
    this._onDidChangeFullscreen.fire(windowId);
  }
  isFullscreen(targetWindow) {
    return !!this.mapWindowIdToFullScreen.get(this.getWindowId(targetWindow));
  }
  getWindowId(targetWindow) {
    return targetWindow.vscodeWindowId;
  }
};
function addMatchMediaChangeListener(targetWindow, query, callback) {
  if (typeof query === "string") {
    query = targetWindow.matchMedia(query);
  }
  query.addEventListener("change", callback);
}
var onDidChangeZoomLevel = WindowManager.INSTANCE.onDidChangeZoomLevel;
function getZoomFactor(targetWindow) {
  return WindowManager.INSTANCE.getZoomFactor(targetWindow);
}
var onDidChangeFullscreen = WindowManager.INSTANCE.onDidChangeFullscreen;
var userAgent = navigator.userAgent;
var isFirefox = userAgent.indexOf("Firefox") >= 0;
var isWebKit = userAgent.indexOf("AppleWebKit") >= 0;
var isChrome = userAgent.indexOf("Chrome") >= 0;
var isSafari = !isChrome && userAgent.indexOf("Safari") >= 0;
var isElectron = userAgent.indexOf("Electron/") >= 0;
var isAndroid = userAgent.indexOf("Android") >= 0;
var standalone = false;
if (typeof mainWindow.matchMedia === "function") {
  const standaloneMatchMedia = mainWindow.matchMedia("(display-mode: standalone) or (display-mode: window-controls-overlay)");
  const fullScreenMatchMedia = mainWindow.matchMedia("(display-mode: fullscreen)");
  standalone = standaloneMatchMedia.matches;
  addMatchMediaChangeListener(mainWindow, standaloneMatchMedia, ({ matches }) => {
    if (standalone && fullScreenMatchMedia.matches) {
      return;
    }
    standalone = matches;
  });
}
function isStandalone() {
  return standalone;
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/nls.messages.ts
function getNLSLanguage() {
  return globalThis._VSCODE_NLS_LANGUAGE;
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/nls.ts
var isPseudo = getNLSLanguage() === "pseudo" || typeof document !== "undefined" && document.location && typeof document.location.hash === "string" && document.location.hash.indexOf("pseudo=true") >= 0;

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/platform.ts
var LANGUAGE_DEFAULT = "en";
var _isWindows = false;
var _isMacintosh = false;
var _isLinux = false;
var _isLinuxSnap = false;
var _isNative = false;
var _isWeb = false;
var _isElectron = false;
var _isIOS = false;
var _isCI = false;
var _isMobile = false;
var _locale = void 0;
var _language = LANGUAGE_DEFAULT;
var _platformLocale = LANGUAGE_DEFAULT;
var _translationsConfigFile = void 0;
var _userAgent = void 0;
var $globalThis = globalThis;
var nodeProcess = void 0;
if (typeof $globalThis.vscode !== "undefined" && typeof $globalThis.vscode.process !== "undefined") {
  nodeProcess = $globalThis.vscode.process;
} else if (typeof process !== "undefined" && typeof process?.versions?.node === "string") {
  nodeProcess = process;
}
var isElectronProcess = typeof nodeProcess?.versions?.electron === "string";
var isElectronRenderer = isElectronProcess && nodeProcess?.type === "renderer";
if (typeof nodeProcess === "object") {
  _isWindows = nodeProcess.platform === "win32";
  _isMacintosh = nodeProcess.platform === "darwin";
  _isLinux = nodeProcess.platform === "linux";
  _isLinuxSnap = _isLinux && !!nodeProcess.env["SNAP"] && !!nodeProcess.env["SNAP_REVISION"];
  _isElectron = isElectronProcess;
  _isCI = !!nodeProcess.env["CI"] || !!nodeProcess.env["BUILD_ARTIFACTSTAGINGDIRECTORY"] || !!nodeProcess.env["GITHUB_WORKSPACE"];
  _locale = LANGUAGE_DEFAULT;
  _language = LANGUAGE_DEFAULT;
  const rawNlsConfig = nodeProcess.env["VSCODE_NLS_CONFIG"];
  if (rawNlsConfig) {
    try {
      const nlsConfig = JSON.parse(rawNlsConfig);
      _locale = nlsConfig.userLocale;
      _platformLocale = nlsConfig.osLocale;
      _language = nlsConfig.resolvedLanguage || LANGUAGE_DEFAULT;
      _translationsConfigFile = nlsConfig.languagePack?.translationsConfigFile;
    } catch (e) {
    }
  }
  _isNative = true;
} else if (typeof navigator === "object" && !isElectronRenderer) {
  _userAgent = navigator.userAgent;
  _isWindows = _userAgent.indexOf("Windows") >= 0;
  _isMacintosh = _userAgent.indexOf("Macintosh") >= 0;
  _isIOS = (_userAgent.indexOf("Macintosh") >= 0 || _userAgent.indexOf("iPad") >= 0 || _userAgent.indexOf("iPhone") >= 0) && !!navigator.maxTouchPoints && navigator.maxTouchPoints > 0;
  _isLinux = _userAgent.indexOf("Linux") >= 0;
  _isMobile = _userAgent?.indexOf("Mobi") >= 0;
  _isWeb = true;
  _language = getNLSLanguage() || LANGUAGE_DEFAULT;
  _locale = navigator.language.toLowerCase();
  _platformLocale = _locale;
} else {
  console.error("Unable to resolve platform.");
}
var _platform = 0 /* Web */;
if (_isMacintosh) {
  _platform = 1 /* Mac */;
} else if (_isWindows) {
  _platform = 3 /* Windows */;
} else if (_isLinux) {
  _platform = 2 /* Linux */;
}
var isWindows = _isWindows;
var isMacintosh = _isMacintosh;
var isLinux = _isLinux;
var isNative = _isNative;
var isWeb = _isWeb;
var isWebWorker = _isWeb && typeof $globalThis.importScripts === "function";
var webWorkerOrigin = isWebWorker ? $globalThis.origin : void 0;
var userAgent2 = _userAgent;
var language = _language;
var Language;
((Language2) => {
  function value() {
    return language;
  }
  Language2.value = value;
  function isDefaultVariant() {
    if (language.length === 2) {
      return language === "en";
    } else if (language.length >= 3) {
      return language[0] === "e" && language[1] === "n" && language[2] === "-";
    } else {
      return false;
    }
  }
  Language2.isDefaultVariant = isDefaultVariant;
  function isDefault() {
    return language === "en";
  }
  Language2.isDefault = isDefault;
})(Language || (Language = {}));
var setTimeout0IsFaster = typeof $globalThis.postMessage === "function" && !$globalThis.importScripts;
var setTimeout0 = (() => {
  if (setTimeout0IsFaster) {
    const pending = [];
    $globalThis.addEventListener("message", (e) => {
      if (e.data && e.data.vscodeScheduleAsyncWork) {
        for (let i = 0, len = pending.length; i < len; i++) {
          const candidate = pending[i];
          if (candidate.id === e.data.vscodeScheduleAsyncWork) {
            pending.splice(i, 1);
            candidate.callback();
            return;
          }
        }
      }
    });
    let lastId = 0;
    return (callback) => {
      const myId = ++lastId;
      pending.push({
        id: myId,
        callback
      });
      $globalThis.postMessage({ vscodeScheduleAsyncWork: myId }, "*");
    };
  }
  return (callback) => setTimeout(callback);
})();
var isChrome2 = !!(userAgent2 && userAgent2.indexOf("Chrome") >= 0);
var isFirefox2 = !!(userAgent2 && userAgent2.indexOf("Firefox") >= 0);
var isSafari2 = !!(!isChrome2 && (userAgent2 && userAgent2.indexOf("Safari") >= 0));
var isEdge = !!(userAgent2 && userAgent2.indexOf("Edg/") >= 0);
var isAndroid2 = !!(userAgent2 && userAgent2.indexOf("Android") >= 0);

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/canIUse.ts
var BrowserFeatures = {
  clipboard: {
    writeText: isNative || document.queryCommandSupported && document.queryCommandSupported("copy") || !!(navigator && navigator.clipboard && navigator.clipboard.writeText),
    readText: isNative || !!(navigator && navigator.clipboard && navigator.clipboard.readText)
  },
  keyboard: (() => {
    if (isNative || isStandalone()) {
      return 0 /* Always */;
    }
    if (navigator.keyboard || isSafari) {
      return 1 /* FullScreen */;
    }
    return 2 /* None */;
  })(),
  // 'ontouchstart' in window always evaluates to true with typescript's modern typings. This causes `window` to be
  // `never` later in `window.navigator`. That's why we need the explicit `window as Window` cast
  touch: "ontouchstart" in mainWindow || navigator.maxTouchPoints > 0,
  pointerEvents: mainWindow.PointerEvent && ("ontouchstart" in mainWindow || navigator.maxTouchPoints > 0)
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/keyCodes.ts
var KeyCodeStrMap = class {
  constructor() {
    this._keyCodeToStr = [];
    this._strToKeyCode = /* @__PURE__ */ Object.create(null);
  }
  define(keyCode, str) {
    this._keyCodeToStr[keyCode] = str;
    this._strToKeyCode[str.toLowerCase()] = keyCode;
  }
  keyCodeToStr(keyCode) {
    return this._keyCodeToStr[keyCode];
  }
  strToKeyCode(str) {
    return this._strToKeyCode[str.toLowerCase()] || 0 /* Unknown */;
  }
};
var uiMap = new KeyCodeStrMap();
var userSettingsUSMap = new KeyCodeStrMap();
var userSettingsGeneralMap = new KeyCodeStrMap();
var EVENT_KEY_CODE_MAP = new Array(230);
var NATIVE_WINDOWS_KEY_CODE_TO_KEY_CODE = {};
var scanCodeIntToStr = [];
var scanCodeStrToInt = /* @__PURE__ */ Object.create(null);
var scanCodeLowerCaseStrToInt = /* @__PURE__ */ Object.create(null);
var IMMUTABLE_CODE_TO_KEY_CODE = [];
var IMMUTABLE_KEY_CODE_TO_CODE = [];
for (let i = 0; i <= 193 /* MAX_VALUE */; i++) {
  IMMUTABLE_CODE_TO_KEY_CODE[i] = -1 /* DependsOnKbLayout */;
}
for (let i = 0; i <= 132 /* MAX_VALUE */; i++) {
  IMMUTABLE_KEY_CODE_TO_CODE[i] = -1 /* DependsOnKbLayout */;
}
(function() {
  const empty = "";
  const mappings = [
    // immutable, scanCode, scanCodeStr, keyCode, keyCodeStr, eventKeyCode, vkey, usUserSettingsLabel, generalUserSettingsLabel
    [1, 0 /* None */, "None", 0 /* Unknown */, "unknown", 0, "VK_UNKNOWN", empty, empty],
    [1, 1 /* Hyper */, "Hyper", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 2 /* Super */, "Super", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 3 /* Fn */, "Fn", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 4 /* FnLock */, "FnLock", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 5 /* Suspend */, "Suspend", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 6 /* Resume */, "Resume", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 7 /* Turbo */, "Turbo", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 8 /* Sleep */, "Sleep", 0 /* Unknown */, empty, 0, "VK_SLEEP", empty, empty],
    [1, 9 /* WakeUp */, "WakeUp", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [0, 10 /* KeyA */, "KeyA", 31 /* KeyA */, "A", 65, "VK_A", empty, empty],
    [0, 11 /* KeyB */, "KeyB", 32 /* KeyB */, "B", 66, "VK_B", empty, empty],
    [0, 12 /* KeyC */, "KeyC", 33 /* KeyC */, "C", 67, "VK_C", empty, empty],
    [0, 13 /* KeyD */, "KeyD", 34 /* KeyD */, "D", 68, "VK_D", empty, empty],
    [0, 14 /* KeyE */, "KeyE", 35 /* KeyE */, "E", 69, "VK_E", empty, empty],
    [0, 15 /* KeyF */, "KeyF", 36 /* KeyF */, "F", 70, "VK_F", empty, empty],
    [0, 16 /* KeyG */, "KeyG", 37 /* KeyG */, "G", 71, "VK_G", empty, empty],
    [0, 17 /* KeyH */, "KeyH", 38 /* KeyH */, "H", 72, "VK_H", empty, empty],
    [0, 18 /* KeyI */, "KeyI", 39 /* KeyI */, "I", 73, "VK_I", empty, empty],
    [0, 19 /* KeyJ */, "KeyJ", 40 /* KeyJ */, "J", 74, "VK_J", empty, empty],
    [0, 20 /* KeyK */, "KeyK", 41 /* KeyK */, "K", 75, "VK_K", empty, empty],
    [0, 21 /* KeyL */, "KeyL", 42 /* KeyL */, "L", 76, "VK_L", empty, empty],
    [0, 22 /* KeyM */, "KeyM", 43 /* KeyM */, "M", 77, "VK_M", empty, empty],
    [0, 23 /* KeyN */, "KeyN", 44 /* KeyN */, "N", 78, "VK_N", empty, empty],
    [0, 24 /* KeyO */, "KeyO", 45 /* KeyO */, "O", 79, "VK_O", empty, empty],
    [0, 25 /* KeyP */, "KeyP", 46 /* KeyP */, "P", 80, "VK_P", empty, empty],
    [0, 26 /* KeyQ */, "KeyQ", 47 /* KeyQ */, "Q", 81, "VK_Q", empty, empty],
    [0, 27 /* KeyR */, "KeyR", 48 /* KeyR */, "R", 82, "VK_R", empty, empty],
    [0, 28 /* KeyS */, "KeyS", 49 /* KeyS */, "S", 83, "VK_S", empty, empty],
    [0, 29 /* KeyT */, "KeyT", 50 /* KeyT */, "T", 84, "VK_T", empty, empty],
    [0, 30 /* KeyU */, "KeyU", 51 /* KeyU */, "U", 85, "VK_U", empty, empty],
    [0, 31 /* KeyV */, "KeyV", 52 /* KeyV */, "V", 86, "VK_V", empty, empty],
    [0, 32 /* KeyW */, "KeyW", 53 /* KeyW */, "W", 87, "VK_W", empty, empty],
    [0, 33 /* KeyX */, "KeyX", 54 /* KeyX */, "X", 88, "VK_X", empty, empty],
    [0, 34 /* KeyY */, "KeyY", 55 /* KeyY */, "Y", 89, "VK_Y", empty, empty],
    [0, 35 /* KeyZ */, "KeyZ", 56 /* KeyZ */, "Z", 90, "VK_Z", empty, empty],
    [0, 36 /* Digit1 */, "Digit1", 22 /* Digit1 */, "1", 49, "VK_1", empty, empty],
    [0, 37 /* Digit2 */, "Digit2", 23 /* Digit2 */, "2", 50, "VK_2", empty, empty],
    [0, 38 /* Digit3 */, "Digit3", 24 /* Digit3 */, "3", 51, "VK_3", empty, empty],
    [0, 39 /* Digit4 */, "Digit4", 25 /* Digit4 */, "4", 52, "VK_4", empty, empty],
    [0, 40 /* Digit5 */, "Digit5", 26 /* Digit5 */, "5", 53, "VK_5", empty, empty],
    [0, 41 /* Digit6 */, "Digit6", 27 /* Digit6 */, "6", 54, "VK_6", empty, empty],
    [0, 42 /* Digit7 */, "Digit7", 28 /* Digit7 */, "7", 55, "VK_7", empty, empty],
    [0, 43 /* Digit8 */, "Digit8", 29 /* Digit8 */, "8", 56, "VK_8", empty, empty],
    [0, 44 /* Digit9 */, "Digit9", 30 /* Digit9 */, "9", 57, "VK_9", empty, empty],
    [0, 45 /* Digit0 */, "Digit0", 21 /* Digit0 */, "0", 48, "VK_0", empty, empty],
    [1, 46 /* Enter */, "Enter", 3 /* Enter */, "Enter", 13, "VK_RETURN", empty, empty],
    [1, 47 /* Escape */, "Escape", 9 /* Escape */, "Escape", 27, "VK_ESCAPE", empty, empty],
    [1, 48 /* Backspace */, "Backspace", 1 /* Backspace */, "Backspace", 8, "VK_BACK", empty, empty],
    [1, 49 /* Tab */, "Tab", 2 /* Tab */, "Tab", 9, "VK_TAB", empty, empty],
    [1, 50 /* Space */, "Space", 10 /* Space */, "Space", 32, "VK_SPACE", empty, empty],
    [0, 51 /* Minus */, "Minus", 88 /* Minus */, "-", 189, "VK_OEM_MINUS", "-", "OEM_MINUS"],
    [0, 52 /* Equal */, "Equal", 86 /* Equal */, "=", 187, "VK_OEM_PLUS", "=", "OEM_PLUS"],
    [0, 53 /* BracketLeft */, "BracketLeft", 92 /* BracketLeft */, "[", 219, "VK_OEM_4", "[", "OEM_4"],
    [0, 54 /* BracketRight */, "BracketRight", 94 /* BracketRight */, "]", 221, "VK_OEM_6", "]", "OEM_6"],
    [0, 55 /* Backslash */, "Backslash", 93 /* Backslash */, "\\", 220, "VK_OEM_5", "\\", "OEM_5"],
    [0, 56 /* IntlHash */, "IntlHash", 0 /* Unknown */, empty, 0, empty, empty, empty],
    // has been dropped from the w3c spec
    [0, 57 /* Semicolon */, "Semicolon", 85 /* Semicolon */, ";", 186, "VK_OEM_1", ";", "OEM_1"],
    [0, 58 /* Quote */, "Quote", 95 /* Quote */, "'", 222, "VK_OEM_7", "'", "OEM_7"],
    [0, 59 /* Backquote */, "Backquote", 91 /* Backquote */, "`", 192, "VK_OEM_3", "`", "OEM_3"],
    [0, 60 /* Comma */, "Comma", 87 /* Comma */, ",", 188, "VK_OEM_COMMA", ",", "OEM_COMMA"],
    [0, 61 /* Period */, "Period", 89 /* Period */, ".", 190, "VK_OEM_PERIOD", ".", "OEM_PERIOD"],
    [0, 62 /* Slash */, "Slash", 90 /* Slash */, "/", 191, "VK_OEM_2", "/", "OEM_2"],
    [1, 63 /* CapsLock */, "CapsLock", 8 /* CapsLock */, "CapsLock", 20, "VK_CAPITAL", empty, empty],
    [1, 64 /* F1 */, "F1", 59 /* F1 */, "F1", 112, "VK_F1", empty, empty],
    [1, 65 /* F2 */, "F2", 60 /* F2 */, "F2", 113, "VK_F2", empty, empty],
    [1, 66 /* F3 */, "F3", 61 /* F3 */, "F3", 114, "VK_F3", empty, empty],
    [1, 67 /* F4 */, "F4", 62 /* F4 */, "F4", 115, "VK_F4", empty, empty],
    [1, 68 /* F5 */, "F5", 63 /* F5 */, "F5", 116, "VK_F5", empty, empty],
    [1, 69 /* F6 */, "F6", 64 /* F6 */, "F6", 117, "VK_F6", empty, empty],
    [1, 70 /* F7 */, "F7", 65 /* F7 */, "F7", 118, "VK_F7", empty, empty],
    [1, 71 /* F8 */, "F8", 66 /* F8 */, "F8", 119, "VK_F8", empty, empty],
    [1, 72 /* F9 */, "F9", 67 /* F9 */, "F9", 120, "VK_F9", empty, empty],
    [1, 73 /* F10 */, "F10", 68 /* F10 */, "F10", 121, "VK_F10", empty, empty],
    [1, 74 /* F11 */, "F11", 69 /* F11 */, "F11", 122, "VK_F11", empty, empty],
    [1, 75 /* F12 */, "F12", 70 /* F12 */, "F12", 123, "VK_F12", empty, empty],
    [1, 76 /* PrintScreen */, "PrintScreen", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 77 /* ScrollLock */, "ScrollLock", 84 /* ScrollLock */, "ScrollLock", 145, "VK_SCROLL", empty, empty],
    [1, 78 /* Pause */, "Pause", 7 /* PauseBreak */, "PauseBreak", 19, "VK_PAUSE", empty, empty],
    [1, 79 /* Insert */, "Insert", 19 /* Insert */, "Insert", 45, "VK_INSERT", empty, empty],
    [1, 80 /* Home */, "Home", 14 /* Home */, "Home", 36, "VK_HOME", empty, empty],
    [1, 81 /* PageUp */, "PageUp", 11 /* PageUp */, "PageUp", 33, "VK_PRIOR", empty, empty],
    [1, 82 /* Delete */, "Delete", 20 /* Delete */, "Delete", 46, "VK_DELETE", empty, empty],
    [1, 83 /* End */, "End", 13 /* End */, "End", 35, "VK_END", empty, empty],
    [1, 84 /* PageDown */, "PageDown", 12 /* PageDown */, "PageDown", 34, "VK_NEXT", empty, empty],
    [1, 85 /* ArrowRight */, "ArrowRight", 17 /* RightArrow */, "RightArrow", 39, "VK_RIGHT", "Right", empty],
    [1, 86 /* ArrowLeft */, "ArrowLeft", 15 /* LeftArrow */, "LeftArrow", 37, "VK_LEFT", "Left", empty],
    [1, 87 /* ArrowDown */, "ArrowDown", 18 /* DownArrow */, "DownArrow", 40, "VK_DOWN", "Down", empty],
    [1, 88 /* ArrowUp */, "ArrowUp", 16 /* UpArrow */, "UpArrow", 38, "VK_UP", "Up", empty],
    [1, 89 /* NumLock */, "NumLock", 83 /* NumLock */, "NumLock", 144, "VK_NUMLOCK", empty, empty],
    [1, 90 /* NumpadDivide */, "NumpadDivide", 113 /* NumpadDivide */, "NumPad_Divide", 111, "VK_DIVIDE", empty, empty],
    [1, 91 /* NumpadMultiply */, "NumpadMultiply", 108 /* NumpadMultiply */, "NumPad_Multiply", 106, "VK_MULTIPLY", empty, empty],
    [1, 92 /* NumpadSubtract */, "NumpadSubtract", 111 /* NumpadSubtract */, "NumPad_Subtract", 109, "VK_SUBTRACT", empty, empty],
    [1, 93 /* NumpadAdd */, "NumpadAdd", 109 /* NumpadAdd */, "NumPad_Add", 107, "VK_ADD", empty, empty],
    [1, 94 /* NumpadEnter */, "NumpadEnter", 3 /* Enter */, empty, 0, empty, empty, empty],
    [1, 95 /* Numpad1 */, "Numpad1", 99 /* Numpad1 */, "NumPad1", 97, "VK_NUMPAD1", empty, empty],
    [1, 96 /* Numpad2 */, "Numpad2", 100 /* Numpad2 */, "NumPad2", 98, "VK_NUMPAD2", empty, empty],
    [1, 97 /* Numpad3 */, "Numpad3", 101 /* Numpad3 */, "NumPad3", 99, "VK_NUMPAD3", empty, empty],
    [1, 98 /* Numpad4 */, "Numpad4", 102 /* Numpad4 */, "NumPad4", 100, "VK_NUMPAD4", empty, empty],
    [1, 99 /* Numpad5 */, "Numpad5", 103 /* Numpad5 */, "NumPad5", 101, "VK_NUMPAD5", empty, empty],
    [1, 100 /* Numpad6 */, "Numpad6", 104 /* Numpad6 */, "NumPad6", 102, "VK_NUMPAD6", empty, empty],
    [1, 101 /* Numpad7 */, "Numpad7", 105 /* Numpad7 */, "NumPad7", 103, "VK_NUMPAD7", empty, empty],
    [1, 102 /* Numpad8 */, "Numpad8", 106 /* Numpad8 */, "NumPad8", 104, "VK_NUMPAD8", empty, empty],
    [1, 103 /* Numpad9 */, "Numpad9", 107 /* Numpad9 */, "NumPad9", 105, "VK_NUMPAD9", empty, empty],
    [1, 104 /* Numpad0 */, "Numpad0", 98 /* Numpad0 */, "NumPad0", 96, "VK_NUMPAD0", empty, empty],
    [1, 105 /* NumpadDecimal */, "NumpadDecimal", 112 /* NumpadDecimal */, "NumPad_Decimal", 110, "VK_DECIMAL", empty, empty],
    [0, 106 /* IntlBackslash */, "IntlBackslash", 97 /* IntlBackslash */, "OEM_102", 226, "VK_OEM_102", empty, empty],
    [1, 107 /* ContextMenu */, "ContextMenu", 58 /* ContextMenu */, "ContextMenu", 93, empty, empty, empty],
    [1, 108 /* Power */, "Power", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 109 /* NumpadEqual */, "NumpadEqual", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 110 /* F13 */, "F13", 71 /* F13 */, "F13", 124, "VK_F13", empty, empty],
    [1, 111 /* F14 */, "F14", 72 /* F14 */, "F14", 125, "VK_F14", empty, empty],
    [1, 112 /* F15 */, "F15", 73 /* F15 */, "F15", 126, "VK_F15", empty, empty],
    [1, 113 /* F16 */, "F16", 74 /* F16 */, "F16", 127, "VK_F16", empty, empty],
    [1, 114 /* F17 */, "F17", 75 /* F17 */, "F17", 128, "VK_F17", empty, empty],
    [1, 115 /* F18 */, "F18", 76 /* F18 */, "F18", 129, "VK_F18", empty, empty],
    [1, 116 /* F19 */, "F19", 77 /* F19 */, "F19", 130, "VK_F19", empty, empty],
    [1, 117 /* F20 */, "F20", 78 /* F20 */, "F20", 131, "VK_F20", empty, empty],
    [1, 118 /* F21 */, "F21", 79 /* F21 */, "F21", 132, "VK_F21", empty, empty],
    [1, 119 /* F22 */, "F22", 80 /* F22 */, "F22", 133, "VK_F22", empty, empty],
    [1, 120 /* F23 */, "F23", 81 /* F23 */, "F23", 134, "VK_F23", empty, empty],
    [1, 121 /* F24 */, "F24", 82 /* F24 */, "F24", 135, "VK_F24", empty, empty],
    [1, 122 /* Open */, "Open", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 123 /* Help */, "Help", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 124 /* Select */, "Select", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 125 /* Again */, "Again", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 126 /* Undo */, "Undo", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 127 /* Cut */, "Cut", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 128 /* Copy */, "Copy", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 129 /* Paste */, "Paste", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 130 /* Find */, "Find", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 131 /* AudioVolumeMute */, "AudioVolumeMute", 117 /* AudioVolumeMute */, "AudioVolumeMute", 173, "VK_VOLUME_MUTE", empty, empty],
    [1, 132 /* AudioVolumeUp */, "AudioVolumeUp", 118 /* AudioVolumeUp */, "AudioVolumeUp", 175, "VK_VOLUME_UP", empty, empty],
    [1, 133 /* AudioVolumeDown */, "AudioVolumeDown", 119 /* AudioVolumeDown */, "AudioVolumeDown", 174, "VK_VOLUME_DOWN", empty, empty],
    [1, 134 /* NumpadComma */, "NumpadComma", 110 /* NUMPAD_SEPARATOR */, "NumPad_Separator", 108, "VK_SEPARATOR", empty, empty],
    [0, 135 /* IntlRo */, "IntlRo", 115 /* ABNT_C1 */, "ABNT_C1", 193, "VK_ABNT_C1", empty, empty],
    [1, 136 /* KanaMode */, "KanaMode", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [0, 137 /* IntlYen */, "IntlYen", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 138 /* Convert */, "Convert", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 139 /* NonConvert */, "NonConvert", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 140 /* Lang1 */, "Lang1", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 141 /* Lang2 */, "Lang2", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 142 /* Lang3 */, "Lang3", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 143 /* Lang4 */, "Lang4", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 144 /* Lang5 */, "Lang5", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 145 /* Abort */, "Abort", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 146 /* Props */, "Props", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 147 /* NumpadParenLeft */, "NumpadParenLeft", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 148 /* NumpadParenRight */, "NumpadParenRight", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 149 /* NumpadBackspace */, "NumpadBackspace", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 150 /* NumpadMemoryStore */, "NumpadMemoryStore", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 151 /* NumpadMemoryRecall */, "NumpadMemoryRecall", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 152 /* NumpadMemoryClear */, "NumpadMemoryClear", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 153 /* NumpadMemoryAdd */, "NumpadMemoryAdd", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 154 /* NumpadMemorySubtract */, "NumpadMemorySubtract", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 155 /* NumpadClear */, "NumpadClear", 131 /* Clear */, "Clear", 12, "VK_CLEAR", empty, empty],
    [1, 156 /* NumpadClearEntry */, "NumpadClearEntry", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 0 /* None */, empty, 5 /* Ctrl */, "Ctrl", 17, "VK_CONTROL", empty, empty],
    [1, 0 /* None */, empty, 4 /* Shift */, "Shift", 16, "VK_SHIFT", empty, empty],
    [1, 0 /* None */, empty, 6 /* Alt */, "Alt", 18, "VK_MENU", empty, empty],
    [1, 0 /* None */, empty, 57 /* Meta */, "Meta", 91, "VK_COMMAND", empty, empty],
    [1, 157 /* ControlLeft */, "ControlLeft", 5 /* Ctrl */, empty, 0, "VK_LCONTROL", empty, empty],
    [1, 158 /* ShiftLeft */, "ShiftLeft", 4 /* Shift */, empty, 0, "VK_LSHIFT", empty, empty],
    [1, 159 /* AltLeft */, "AltLeft", 6 /* Alt */, empty, 0, "VK_LMENU", empty, empty],
    [1, 160 /* MetaLeft */, "MetaLeft", 57 /* Meta */, empty, 0, "VK_LWIN", empty, empty],
    [1, 161 /* ControlRight */, "ControlRight", 5 /* Ctrl */, empty, 0, "VK_RCONTROL", empty, empty],
    [1, 162 /* ShiftRight */, "ShiftRight", 4 /* Shift */, empty, 0, "VK_RSHIFT", empty, empty],
    [1, 163 /* AltRight */, "AltRight", 6 /* Alt */, empty, 0, "VK_RMENU", empty, empty],
    [1, 164 /* MetaRight */, "MetaRight", 57 /* Meta */, empty, 0, "VK_RWIN", empty, empty],
    [1, 165 /* BrightnessUp */, "BrightnessUp", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 166 /* BrightnessDown */, "BrightnessDown", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 167 /* MediaPlay */, "MediaPlay", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 168 /* MediaRecord */, "MediaRecord", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 169 /* MediaFastForward */, "MediaFastForward", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 170 /* MediaRewind */, "MediaRewind", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 171 /* MediaTrackNext */, "MediaTrackNext", 124 /* MediaTrackNext */, "MediaTrackNext", 176, "VK_MEDIA_NEXT_TRACK", empty, empty],
    [1, 172 /* MediaTrackPrevious */, "MediaTrackPrevious", 125 /* MediaTrackPrevious */, "MediaTrackPrevious", 177, "VK_MEDIA_PREV_TRACK", empty, empty],
    [1, 173 /* MediaStop */, "MediaStop", 126 /* MediaStop */, "MediaStop", 178, "VK_MEDIA_STOP", empty, empty],
    [1, 174 /* Eject */, "Eject", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 175 /* MediaPlayPause */, "MediaPlayPause", 127 /* MediaPlayPause */, "MediaPlayPause", 179, "VK_MEDIA_PLAY_PAUSE", empty, empty],
    [1, 176 /* MediaSelect */, "MediaSelect", 128 /* LaunchMediaPlayer */, "LaunchMediaPlayer", 181, "VK_MEDIA_LAUNCH_MEDIA_SELECT", empty, empty],
    [1, 177 /* LaunchMail */, "LaunchMail", 129 /* LaunchMail */, "LaunchMail", 180, "VK_MEDIA_LAUNCH_MAIL", empty, empty],
    [1, 178 /* LaunchApp2 */, "LaunchApp2", 130 /* LaunchApp2 */, "LaunchApp2", 183, "VK_MEDIA_LAUNCH_APP2", empty, empty],
    [1, 179 /* LaunchApp1 */, "LaunchApp1", 0 /* Unknown */, empty, 0, "VK_MEDIA_LAUNCH_APP1", empty, empty],
    [1, 180 /* SelectTask */, "SelectTask", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 181 /* LaunchScreenSaver */, "LaunchScreenSaver", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 182 /* BrowserSearch */, "BrowserSearch", 120 /* BrowserSearch */, "BrowserSearch", 170, "VK_BROWSER_SEARCH", empty, empty],
    [1, 183 /* BrowserHome */, "BrowserHome", 121 /* BrowserHome */, "BrowserHome", 172, "VK_BROWSER_HOME", empty, empty],
    [1, 184 /* BrowserBack */, "BrowserBack", 122 /* BrowserBack */, "BrowserBack", 166, "VK_BROWSER_BACK", empty, empty],
    [1, 185 /* BrowserForward */, "BrowserForward", 123 /* BrowserForward */, "BrowserForward", 167, "VK_BROWSER_FORWARD", empty, empty],
    [1, 186 /* BrowserStop */, "BrowserStop", 0 /* Unknown */, empty, 0, "VK_BROWSER_STOP", empty, empty],
    [1, 187 /* BrowserRefresh */, "BrowserRefresh", 0 /* Unknown */, empty, 0, "VK_BROWSER_REFRESH", empty, empty],
    [1, 188 /* BrowserFavorites */, "BrowserFavorites", 0 /* Unknown */, empty, 0, "VK_BROWSER_FAVORITES", empty, empty],
    [1, 189 /* ZoomToggle */, "ZoomToggle", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 190 /* MailReply */, "MailReply", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 191 /* MailForward */, "MailForward", 0 /* Unknown */, empty, 0, empty, empty, empty],
    [1, 192 /* MailSend */, "MailSend", 0 /* Unknown */, empty, 0, empty, empty, empty],
    // See https://lists.w3.org/Archives/Public/www-dom/2010JulSep/att-0182/keyCode-spec.html
    // If an Input Method Editor is processing key input and the event is keydown, return 229.
    [1, 0 /* None */, empty, 114 /* KEY_IN_COMPOSITION */, "KeyInComposition", 229, empty, empty, empty],
    [1, 0 /* None */, empty, 116 /* ABNT_C2 */, "ABNT_C2", 194, "VK_ABNT_C2", empty, empty],
    [1, 0 /* None */, empty, 96 /* OEM_8 */, "OEM_8", 223, "VK_OEM_8", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_KANA", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_HANGUL", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_JUNJA", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_FINAL", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_HANJA", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_KANJI", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_CONVERT", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_NONCONVERT", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_ACCEPT", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_MODECHANGE", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_SELECT", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_PRINT", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_EXECUTE", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_SNAPSHOT", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_HELP", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_APPS", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_PROCESSKEY", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_PACKET", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_DBE_SBCSCHAR", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_DBE_DBCSCHAR", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_ATTN", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_CRSEL", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_EXSEL", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_EREOF", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_PLAY", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_ZOOM", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_NONAME", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_PA1", empty, empty],
    [1, 0 /* None */, empty, 0 /* Unknown */, empty, 0, "VK_OEM_CLEAR", empty, empty]
  ];
  const seenKeyCode = [];
  const seenScanCode = [];
  for (const mapping of mappings) {
    const [immutable, scanCode, scanCodeStr, keyCode, keyCodeStr, eventKeyCode, vkey, usUserSettingsLabel, generalUserSettingsLabel] = mapping;
    if (!seenScanCode[scanCode]) {
      seenScanCode[scanCode] = true;
      scanCodeIntToStr[scanCode] = scanCodeStr;
      scanCodeStrToInt[scanCodeStr] = scanCode;
      scanCodeLowerCaseStrToInt[scanCodeStr.toLowerCase()] = scanCode;
      if (immutable) {
        IMMUTABLE_CODE_TO_KEY_CODE[scanCode] = keyCode;
        if (keyCode !== 0 /* Unknown */ && keyCode !== 3 /* Enter */ && !isModifierKey(keyCode)) {
          IMMUTABLE_KEY_CODE_TO_CODE[keyCode] = scanCode;
        }
      }
    }
    if (!seenKeyCode[keyCode]) {
      seenKeyCode[keyCode] = true;
      if (!keyCodeStr) {
        throw new Error(`String representation missing for key code ${keyCode} around scan code ${scanCodeStr}`);
      }
      uiMap.define(keyCode, keyCodeStr);
      userSettingsUSMap.define(keyCode, usUserSettingsLabel || keyCodeStr);
      userSettingsGeneralMap.define(keyCode, generalUserSettingsLabel || usUserSettingsLabel || keyCodeStr);
    }
    if (eventKeyCode) {
      EVENT_KEY_CODE_MAP[eventKeyCode] = keyCode;
    }
    if (vkey) {
      NATIVE_WINDOWS_KEY_CODE_TO_KEY_CODE[vkey] = keyCode;
    }
  }
  IMMUTABLE_KEY_CODE_TO_CODE[3 /* Enter */] = 46 /* Enter */;
})();
var KeyCodeUtils;
((KeyCodeUtils2) => {
  function toString(keyCode) {
    return uiMap.keyCodeToStr(keyCode);
  }
  KeyCodeUtils2.toString = toString;
  function fromString(key) {
    return uiMap.strToKeyCode(key);
  }
  KeyCodeUtils2.fromString = fromString;
  function toUserSettingsUS(keyCode) {
    return userSettingsUSMap.keyCodeToStr(keyCode);
  }
  KeyCodeUtils2.toUserSettingsUS = toUserSettingsUS;
  function toUserSettingsGeneral(keyCode) {
    return userSettingsGeneralMap.keyCodeToStr(keyCode);
  }
  KeyCodeUtils2.toUserSettingsGeneral = toUserSettingsGeneral;
  function fromUserSettings(key) {
    return userSettingsUSMap.strToKeyCode(key) || userSettingsGeneralMap.strToKeyCode(key);
  }
  KeyCodeUtils2.fromUserSettings = fromUserSettings;
  function toElectronAccelerator(keyCode) {
    if (keyCode >= 98 /* Numpad0 */ && keyCode <= 113 /* NumpadDivide */) {
      return null;
    }
    switch (keyCode) {
      case 16 /* UpArrow */:
        return "Up";
      case 18 /* DownArrow */:
        return "Down";
      case 15 /* LeftArrow */:
        return "Left";
      case 17 /* RightArrow */:
        return "Right";
    }
    return uiMap.keyCodeToStr(keyCode);
  }
  KeyCodeUtils2.toElectronAccelerator = toElectronAccelerator;
})(KeyCodeUtils || (KeyCodeUtils = {}));
function isModifierKey(keyCode) {
  return keyCode === 5 /* Ctrl */ || keyCode === 4 /* Shift */ || keyCode === 6 /* Alt */ || keyCode === 57 /* Meta */;
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/keybindings.ts
var KeyCodeChord = class _KeyCodeChord {
  constructor(ctrlKey, shiftKey, altKey, metaKey, keyCode) {
    this.ctrlKey = ctrlKey;
    this.shiftKey = shiftKey;
    this.altKey = altKey;
    this.metaKey = metaKey;
    this.keyCode = keyCode;
  }
  equals(other) {
    return other instanceof _KeyCodeChord && this.ctrlKey === other.ctrlKey && this.shiftKey === other.shiftKey && this.altKey === other.altKey && this.metaKey === other.metaKey && this.keyCode === other.keyCode;
  }
  getHashCode() {
    const ctrl = this.ctrlKey ? "1" : "0";
    const shift = this.shiftKey ? "1" : "0";
    const alt = this.altKey ? "1" : "0";
    const meta = this.metaKey ? "1" : "0";
    return `K${ctrl}${shift}${alt}${meta}${this.keyCode}`;
  }
  isModifierKey() {
    return this.keyCode === 0 /* Unknown */ || this.keyCode === 5 /* Ctrl */ || this.keyCode === 57 /* Meta */ || this.keyCode === 6 /* Alt */ || this.keyCode === 4 /* Shift */;
  }
  toKeybinding() {
    return new Keybinding([this]);
  }
  /**
   * Does this keybinding refer to the key code of a modifier and it also has the modifier flag?
   */
  isDuplicateModifierCase() {
    return this.ctrlKey && this.keyCode === 5 /* Ctrl */ || this.shiftKey && this.keyCode === 4 /* Shift */ || this.altKey && this.keyCode === 6 /* Alt */ || this.metaKey && this.keyCode === 57 /* Meta */;
  }
};
var Keybinding = class {
  constructor(chords) {
    if (chords.length === 0) {
      throw illegalArgument(`chords`);
    }
    this.chords = chords;
  }
  getHashCode() {
    let result = "";
    for (let i = 0, len = this.chords.length; i < len; i++) {
      if (i !== 0) {
        result += ";";
      }
      result += this.chords[i].getHashCode();
    }
    return result;
  }
  equals(other) {
    if (other === null) {
      return false;
    }
    if (this.chords.length !== other.chords.length) {
      return false;
    }
    for (let i = 0; i < this.chords.length; i++) {
      if (!this.chords[i].equals(other.chords[i])) {
        return false;
      }
    }
    return true;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/keyboardEvent.ts
function extractKeyCode(e) {
  if (e.charCode) {
    const char = String.fromCharCode(e.charCode).toUpperCase();
    return KeyCodeUtils.fromString(char);
  }
  const keyCode = e.keyCode;
  if (keyCode === 3) {
    return 7 /* PauseBreak */;
  } else if (isFirefox) {
    switch (keyCode) {
      case 59:
        return 85 /* Semicolon */;
      case 60:
        if (isLinux) {
          return 97 /* IntlBackslash */;
        }
        break;
      case 61:
        return 86 /* Equal */;
      // based on: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/keyCode#numpad_keys
      case 107:
        return 109 /* NumpadAdd */;
      case 109:
        return 111 /* NumpadSubtract */;
      case 173:
        return 88 /* Minus */;
      case 224:
        if (isMacintosh) {
          return 57 /* Meta */;
        }
        break;
    }
  } else if (isWebKit) {
    if (isMacintosh && keyCode === 93) {
      return 57 /* Meta */;
    } else if (!isMacintosh && keyCode === 92) {
      return 57 /* Meta */;
    }
  }
  return EVENT_KEY_CODE_MAP[keyCode] || 0 /* Unknown */;
}
var ctrlKeyMod = isMacintosh ? 256 /* WinCtrl */ : 2048 /* CtrlCmd */;
var altKeyMod = 512 /* Alt */;
var shiftKeyMod = 1024 /* Shift */;
var metaKeyMod = isMacintosh ? 2048 /* CtrlCmd */ : 256 /* WinCtrl */;
var StandardKeyboardEvent = class {
  constructor(source) {
    this._standardKeyboardEventBrand = true;
    const e = source;
    this.browserEvent = e;
    this.target = e.target;
    this.ctrlKey = e.ctrlKey;
    this.shiftKey = e.shiftKey;
    this.altKey = e.altKey;
    this.metaKey = e.metaKey;
    this.altGraphKey = e.getModifierState?.("AltGraph");
    this.keyCode = extractKeyCode(e);
    this.code = e.code;
    this.ctrlKey = this.ctrlKey || this.keyCode === 5 /* Ctrl */;
    this.altKey = this.altKey || this.keyCode === 6 /* Alt */;
    this.shiftKey = this.shiftKey || this.keyCode === 4 /* Shift */;
    this.metaKey = this.metaKey || this.keyCode === 57 /* Meta */;
    this._asKeybinding = this._computeKeybinding();
    this._asKeyCodeChord = this._computeKeyCodeChord();
  }
  preventDefault() {
    if (this.browserEvent && this.browserEvent.preventDefault) {
      this.browserEvent.preventDefault();
    }
  }
  stopPropagation() {
    if (this.browserEvent && this.browserEvent.stopPropagation) {
      this.browserEvent.stopPropagation();
    }
  }
  toKeyCodeChord() {
    return this._asKeyCodeChord;
  }
  equals(other) {
    return this._asKeybinding === other;
  }
  _computeKeybinding() {
    let key = 0 /* Unknown */;
    if (!isModifierKey(this.keyCode)) {
      key = this.keyCode;
    }
    let result = 0;
    if (this.ctrlKey) {
      result |= ctrlKeyMod;
    }
    if (this.altKey) {
      result |= altKeyMod;
    }
    if (this.shiftKey) {
      result |= shiftKeyMod;
    }
    if (this.metaKey) {
      result |= metaKeyMod;
    }
    result |= key;
    return result;
  }
  _computeKeyCodeChord() {
    let key = 0 /* Unknown */;
    if (!isModifierKey(this.keyCode)) {
      key = this.keyCode;
    }
    return new KeyCodeChord(this.ctrlKey, this.shiftKey, this.altKey, this.metaKey, key);
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/iframe.ts
var sameOriginWindowChainCache = /* @__PURE__ */ new WeakMap();
function getParentWindowIfSameOrigin(w) {
  if (!w.parent || w.parent === w) {
    return null;
  }
  try {
    const location = w.location;
    const parentLocation = w.parent.location;
    if (location.origin !== "null" && parentLocation.origin !== "null" && location.origin !== parentLocation.origin) {
      return null;
    }
  } catch (e) {
    return null;
  }
  return w.parent;
}
var IframeUtils = class {
  /**
   * Returns a chain of embedded windows with the same origin (which can be accessed programmatically).
   * Having a chain of length 1 might mean that the current execution environment is running outside of an iframe or inside an iframe embedded in a window with a different origin.
   */
  static getSameOriginWindowChain(targetWindow) {
    let windowChainCache = sameOriginWindowChainCache.get(targetWindow);
    if (!windowChainCache) {
      windowChainCache = [];
      sameOriginWindowChainCache.set(targetWindow, windowChainCache);
      let w = targetWindow;
      let parent;
      do {
        parent = getParentWindowIfSameOrigin(w);
        if (parent) {
          windowChainCache.push({
            window: new WeakRef(w),
            iframeElement: w.frameElement || null
          });
        } else {
          windowChainCache.push({
            window: new WeakRef(w),
            iframeElement: null
          });
        }
        w = parent;
      } while (w);
    }
    return windowChainCache.slice(0);
  }
  /**
   * Returns the position of `childWindow` relative to `ancestorWindow`
   */
  static getPositionOfChildWindowRelativeToAncestorWindow(childWindow, ancestorWindow) {
    if (!ancestorWindow || childWindow === ancestorWindow) {
      return {
        top: 0,
        left: 0
      };
    }
    let top = 0, left = 0;
    const windowChain = this.getSameOriginWindowChain(childWindow);
    for (const windowChainEl of windowChain) {
      const windowInChain = windowChainEl.window.deref();
      top += windowInChain?.scrollY ?? 0;
      left += windowInChain?.scrollX ?? 0;
      if (windowInChain === ancestorWindow) {
        break;
      }
      if (!windowChainEl.iframeElement) {
        break;
      }
      const boundingRect = windowChainEl.iframeElement.getBoundingClientRect();
      top += boundingRect.top;
      left += boundingRect.left;
    }
    return {
      top,
      left
    };
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/mouseEvent.ts
var StandardMouseEvent = class {
  constructor(targetWindow, e) {
    this.timestamp = Date.now();
    this.browserEvent = e;
    this.leftButton = e.button === 0;
    this.middleButton = e.button === 1;
    this.rightButton = e.button === 2;
    this.buttons = e.buttons;
    this.defaultPrevented = e.defaultPrevented;
    this.target = e.target;
    this.detail = e.detail || 1;
    if (e.type === "dblclick") {
      this.detail = 2;
    }
    this.ctrlKey = e.ctrlKey;
    this.shiftKey = e.shiftKey;
    this.altKey = e.altKey;
    this.metaKey = e.metaKey;
    if (typeof e.pageX === "number") {
      this.posx = e.pageX;
      this.posy = e.pageY;
    } else {
      this.posx = e.clientX + this.target.ownerDocument.body.scrollLeft + this.target.ownerDocument.documentElement.scrollLeft;
      this.posy = e.clientY + this.target.ownerDocument.body.scrollTop + this.target.ownerDocument.documentElement.scrollTop;
    }
    const iframeOffsets = IframeUtils.getPositionOfChildWindowRelativeToAncestorWindow(targetWindow, e.view);
    this.posx -= iframeOffsets.left;
    this.posy -= iframeOffsets.top;
  }
  preventDefault() {
    this.browserEvent.preventDefault();
  }
  stopPropagation() {
    this.browserEvent.stopPropagation();
  }
};
var StandardWheelEvent = class {
  constructor(e, deltaX = 0, deltaY = 0) {
    this.browserEvent = e || null;
    this.target = e ? e.target || e.targetNode || e.srcElement : null;
    this.deltaY = deltaY;
    this.deltaX = deltaX;
    let shouldFactorDPR = false;
    if (isChrome) {
      const chromeVersionMatch = navigator.userAgent.match(/Chrome\/(\d+)/);
      const chromeMajorVersion = chromeVersionMatch ? parseInt(chromeVersionMatch[1]) : 123;
      shouldFactorDPR = chromeMajorVersion <= 122;
    }
    if (e) {
      const e1 = e;
      const e2 = e;
      const devicePixelRatio = e.view?.devicePixelRatio || 1;
      if (typeof e1.wheelDeltaY !== "undefined") {
        if (shouldFactorDPR) {
          this.deltaY = e1.wheelDeltaY / (120 * devicePixelRatio);
        } else {
          this.deltaY = e1.wheelDeltaY / 120;
        }
      } else if (typeof e2.VERTICAL_AXIS !== "undefined" && e2.axis === e2.VERTICAL_AXIS) {
        this.deltaY = -e2.detail / 3;
      } else if (e.type === "wheel") {
        const ev = e;
        if (ev.deltaMode === ev.DOM_DELTA_LINE) {
          if (isFirefox && !isMacintosh) {
            this.deltaY = -e.deltaY / 3;
          } else {
            this.deltaY = -e.deltaY;
          }
        } else {
          this.deltaY = -e.deltaY / 40;
        }
      }
      if (typeof e1.wheelDeltaX !== "undefined") {
        if (isSafari && isWindows) {
          this.deltaX = -(e1.wheelDeltaX / 120);
        } else if (shouldFactorDPR) {
          this.deltaX = e1.wheelDeltaX / (120 * devicePixelRatio);
        } else {
          this.deltaX = e1.wheelDeltaX / 120;
        }
      } else if (typeof e2.HORIZONTAL_AXIS !== "undefined" && e2.axis === e2.HORIZONTAL_AXIS) {
        this.deltaX = -e.detail / 3;
      } else if (e.type === "wheel") {
        const ev = e;
        if (ev.deltaMode === ev.DOM_DELTA_LINE) {
          if (isFirefox && !isMacintosh) {
            this.deltaX = -e.deltaX / 3;
          } else {
            this.deltaX = -e.deltaX;
          }
        } else {
          this.deltaX = -e.deltaX / 40;
        }
      }
      if (this.deltaY === 0 && this.deltaX === 0 && e.wheelDelta) {
        if (shouldFactorDPR) {
          this.deltaY = e.wheelDelta / (120 * devicePixelRatio);
        } else {
          this.deltaY = e.wheelDelta / 120;
        }
      }
    }
  }
  preventDefault() {
    this.browserEvent?.preventDefault();
  }
  stopPropagation() {
    this.browserEvent?.stopPropagation();
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/cancellation.ts
var shortcutEvent = Object.freeze(function(callback, context) {
  const handle = setTimeout(callback.bind(context), 0);
  return { dispose() {
    clearTimeout(handle);
  } };
});
var CancellationToken;
((CancellationToken6) => {
  function isCancellationToken(thing) {
    if (thing === CancellationToken6.None || thing === CancellationToken6.Cancelled) {
      return true;
    }
    if (thing instanceof MutableToken) {
      return true;
    }
    if (!thing || typeof thing !== "object") {
      return false;
    }
    return typeof thing.isCancellationRequested === "boolean" && typeof thing.onCancellationRequested === "function";
  }
  CancellationToken6.isCancellationToken = isCancellationToken;
  CancellationToken6.None = Object.freeze({
    isCancellationRequested: false,
    onCancellationRequested: Event.None
  });
  CancellationToken6.Cancelled = Object.freeze({
    isCancellationRequested: true,
    onCancellationRequested: shortcutEvent
  });
})(CancellationToken || (CancellationToken = {}));
var MutableToken = class {
  constructor() {
    this._isCancelled = false;
    this._emitter = null;
  }
  cancel() {
    if (!this._isCancelled) {
      this._isCancelled = true;
      if (this._emitter) {
        this._emitter.fire(void 0);
        this.dispose();
      }
    }
  }
  get isCancellationRequested() {
    return this._isCancelled;
  }
  get onCancellationRequested() {
    if (this._isCancelled) {
      return shortcutEvent;
    }
    if (!this._emitter) {
      this._emitter = new Emitter();
    }
    return this._emitter.event;
  }
  dispose() {
    if (this._emitter) {
      this._emitter.dispose();
      this._emitter = null;
    }
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/process.ts
var safeProcess;
var vscodeGlobal = globalThis.vscode;
if (typeof vscodeGlobal !== "undefined" && typeof vscodeGlobal.process !== "undefined") {
  const sandboxProcess = vscodeGlobal.process;
  safeProcess = {
    get platform() {
      return sandboxProcess.platform;
    },
    get arch() {
      return sandboxProcess.arch;
    },
    get env() {
      return sandboxProcess.env;
    },
    cwd() {
      return sandboxProcess.cwd();
    }
  };
} else if (typeof process !== "undefined" && typeof process?.versions?.node === "string") {
  safeProcess = {
    get platform() {
      return process.platform;
    },
    get arch() {
      return process.arch;
    },
    get env() {
      return process.env;
    },
    cwd() {
      return process.env["VSCODE_CWD"] || process.cwd();
    }
  };
} else {
  safeProcess = {
    // Supported
    get platform() {
      return isWindows ? "win32" : isMacintosh ? "darwin" : "linux";
    },
    get arch() {
      return void 0;
    },
    // Unsupported
    get env() {
      return {};
    },
    cwd() {
      return "/";
    }
  };
}
var cwd = safeProcess.cwd;
var env = safeProcess.env;
var platform = safeProcess.platform;
var arch = safeProcess.arch;

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/path.ts
var CHAR_UPPERCASE_A = 65;
var CHAR_LOWERCASE_A = 97;
var CHAR_UPPERCASE_Z = 90;
var CHAR_LOWERCASE_Z = 122;
var CHAR_DOT = 46;
var CHAR_FORWARD_SLASH = 47;
var CHAR_BACKWARD_SLASH = 92;
var CHAR_COLON = 58;
var CHAR_QUESTION_MARK = 63;
var ErrorInvalidArgType = class extends Error {
  constructor(name, expected, actual) {
    let determiner;
    if (typeof expected === "string" && expected.indexOf("not ") === 0) {
      determiner = "must not be";
      expected = expected.replace(/^not /, "");
    } else {
      determiner = "must be";
    }
    const type = name.indexOf(".") !== -1 ? "property" : "argument";
    let msg = `The "${name}" ${type} ${determiner} of type ${expected}`;
    msg += `. Received type ${typeof actual}`;
    super(msg);
    this.code = "ERR_INVALID_ARG_TYPE";
  }
};
function validateObject(pathObject, name) {
  if (pathObject === null || typeof pathObject !== "object") {
    throw new ErrorInvalidArgType(name, "Object", pathObject);
  }
}
function validateString(value, name) {
  if (typeof value !== "string") {
    throw new ErrorInvalidArgType(name, "string", value);
  }
}
var platformIsWin32 = platform === "win32";
function isPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
}
function isPosixPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH;
}
function isWindowsDeviceRoot(code) {
  return code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z || code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z;
}
function normalizeString(path, allowAboveRoot, separator, isPathSeparator3) {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (isPathSeparator3(code)) {
      break;
    } else {
      code = CHAR_FORWARD_SLASH;
    }
    if (isPathSeparator3(code)) {
      if (lastSlash === i - 1 || dots === 1) {
      } else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== CHAR_DOT || res.charCodeAt(res.length - 2) !== CHAR_DOT) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${separator}..` : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) {
          res += `${separator}${path.slice(lastSlash + 1, i)}`;
        } else {
          res = path.slice(lastSlash + 1, i);
        }
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}
function formatExt(ext) {
  return ext ? `${ext[0] === "." ? "" : "."}${ext}` : "";
}
function _format(sep2, pathObject) {
  validateObject(pathObject, "pathObject");
  const dir = pathObject.dir || pathObject.root;
  const base = pathObject.base || `${pathObject.name || ""}${formatExt(pathObject.ext)}`;
  if (!dir) {
    return base;
  }
  return dir === pathObject.root ? `${dir}${base}` : `${dir}${sep2}${base}`;
}
var win32 = {
  // path.resolve([from ...], to)
  resolve(...pathSegments) {
    let resolvedDevice = "";
    let resolvedTail = "";
    let resolvedAbsolute = false;
    for (let i = pathSegments.length - 1; i >= -1; i--) {
      let path;
      if (i >= 0) {
        path = pathSegments[i];
        validateString(path, `paths[${i}]`);
        if (path.length === 0) {
          continue;
        }
      } else if (resolvedDevice.length === 0) {
        path = cwd();
      } else {
        path = env[`=${resolvedDevice}`] || cwd();
        if (path === void 0 || path.slice(0, 2).toLowerCase() !== resolvedDevice.toLowerCase() && path.charCodeAt(2) === CHAR_BACKWARD_SLASH) {
          path = `${resolvedDevice}\\`;
        }
      }
      const len = path.length;
      let rootEnd = 0;
      let device = "";
      let isAbsolute2 = false;
      const code = path.charCodeAt(0);
      if (len === 1) {
        if (isPathSeparator(code)) {
          rootEnd = 1;
          isAbsolute2 = true;
        }
      } else if (isPathSeparator(code)) {
        isAbsolute2 = true;
        if (isPathSeparator(path.charCodeAt(1))) {
          let j = 2;
          let last = j;
          while (j < len && !isPathSeparator(path.charCodeAt(j))) {
            j++;
          }
          if (j < len && j !== last) {
            const firstPart = path.slice(last, j);
            last = j;
            while (j < len && isPathSeparator(path.charCodeAt(j))) {
              j++;
            }
            if (j < len && j !== last) {
              last = j;
              while (j < len && !isPathSeparator(path.charCodeAt(j))) {
                j++;
              }
              if (j === len || j !== last) {
                device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                rootEnd = j;
              }
            }
          }
        } else {
          rootEnd = 1;
        }
      } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
        device = path.slice(0, 2);
        rootEnd = 2;
        if (len > 2 && isPathSeparator(path.charCodeAt(2))) {
          isAbsolute2 = true;
          rootEnd = 3;
        }
      }
      if (device.length > 0) {
        if (resolvedDevice.length > 0) {
          if (device.toLowerCase() !== resolvedDevice.toLowerCase()) {
            continue;
          }
        } else {
          resolvedDevice = device;
        }
      }
      if (resolvedAbsolute) {
        if (resolvedDevice.length > 0) {
          break;
        }
      } else {
        resolvedTail = `${path.slice(rootEnd)}\\${resolvedTail}`;
        resolvedAbsolute = isAbsolute2;
        if (isAbsolute2 && resolvedDevice.length > 0) {
          break;
        }
      }
    }
    resolvedTail = normalizeString(
      resolvedTail,
      !resolvedAbsolute,
      "\\",
      isPathSeparator
    );
    return resolvedAbsolute ? `${resolvedDevice}\\${resolvedTail}` : `${resolvedDevice}${resolvedTail}` || ".";
  },
  normalize(path) {
    validateString(path, "path");
    const len = path.length;
    if (len === 0) {
      return ".";
    }
    let rootEnd = 0;
    let device;
    let isAbsolute2 = false;
    const code = path.charCodeAt(0);
    if (len === 1) {
      return isPosixPathSeparator(code) ? "\\" : path;
    }
    if (isPathSeparator(code)) {
      isAbsolute2 = true;
      if (isPathSeparator(path.charCodeAt(1))) {
        let j = 2;
        let last = j;
        while (j < len && !isPathSeparator(path.charCodeAt(j))) {
          j++;
        }
        if (j < len && j !== last) {
          const firstPart = path.slice(last, j);
          last = j;
          while (j < len && isPathSeparator(path.charCodeAt(j))) {
            j++;
          }
          if (j < len && j !== last) {
            last = j;
            while (j < len && !isPathSeparator(path.charCodeAt(j))) {
              j++;
            }
            if (j === len) {
              return `\\\\${firstPart}\\${path.slice(last)}\\`;
            }
            if (j !== last) {
              device = `\\\\${firstPart}\\${path.slice(last, j)}`;
              rootEnd = j;
            }
          }
        }
      } else {
        rootEnd = 1;
      }
    } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
      device = path.slice(0, 2);
      rootEnd = 2;
      if (len > 2 && isPathSeparator(path.charCodeAt(2))) {
        isAbsolute2 = true;
        rootEnd = 3;
      }
    }
    let tail = rootEnd < len ? normalizeString(path.slice(rootEnd), !isAbsolute2, "\\", isPathSeparator) : "";
    if (tail.length === 0 && !isAbsolute2) {
      tail = ".";
    }
    if (tail.length > 0 && isPathSeparator(path.charCodeAt(len - 1))) {
      tail += "\\";
    }
    if (!isAbsolute2 && device === void 0 && path.includes(":")) {
      if (tail.length >= 2 && isWindowsDeviceRoot(tail.charCodeAt(0)) && tail.charCodeAt(1) === CHAR_COLON) {
        return `.\\${tail}`;
      }
      let index = path.indexOf(":");
      do {
        if (index === len - 1 || isPathSeparator(path.charCodeAt(index + 1))) {
          return `.\\${tail}`;
        }
      } while ((index = path.indexOf(":", index + 1)) !== -1);
    }
    if (device === void 0) {
      return isAbsolute2 ? `\\${tail}` : tail;
    }
    return isAbsolute2 ? `${device}\\${tail}` : `${device}${tail}`;
  },
  isAbsolute(path) {
    validateString(path, "path");
    const len = path.length;
    if (len === 0) {
      return false;
    }
    const code = path.charCodeAt(0);
    return isPathSeparator(code) || // Possible device root
    len > 2 && isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON && isPathSeparator(path.charCodeAt(2));
  },
  join(...paths) {
    if (paths.length === 0) {
      return ".";
    }
    let joined;
    let firstPart;
    for (let i = 0; i < paths.length; ++i) {
      const arg = paths[i];
      validateString(arg, "path");
      if (arg.length > 0) {
        if (joined === void 0) {
          joined = firstPart = arg;
        } else {
          joined += `\\${arg}`;
        }
      }
    }
    if (joined === void 0) {
      return ".";
    }
    let needsReplace = true;
    let slashCount = 0;
    if (typeof firstPart === "string" && isPathSeparator(firstPart.charCodeAt(0))) {
      ++slashCount;
      const firstLen = firstPart.length;
      if (firstLen > 1 && isPathSeparator(firstPart.charCodeAt(1))) {
        ++slashCount;
        if (firstLen > 2) {
          if (isPathSeparator(firstPart.charCodeAt(2))) {
            ++slashCount;
          } else {
            needsReplace = false;
          }
        }
      }
    }
    if (needsReplace) {
      while (slashCount < joined.length && isPathSeparator(joined.charCodeAt(slashCount))) {
        slashCount++;
      }
      if (slashCount >= 2) {
        joined = `\\${joined.slice(slashCount)}`;
      }
    }
    return win32.normalize(joined);
  },
  // It will solve the relative path from `from` to `to`, for instance:
  //  from = 'C:\\orandea\\test\\aaa'
  //  to = 'C:\\orandea\\impl\\bbb'
  // The output of the function should be: '..\\..\\impl\\bbb'
  relative(from, to) {
    validateString(from, "from");
    validateString(to, "to");
    if (from === to) {
      return "";
    }
    const fromOrig = win32.resolve(from);
    const toOrig = win32.resolve(to);
    if (fromOrig === toOrig) {
      return "";
    }
    from = fromOrig.toLowerCase();
    to = toOrig.toLowerCase();
    if (from === to) {
      return "";
    }
    if (fromOrig.length !== from.length || toOrig.length !== to.length) {
      const fromSplit = fromOrig.split("\\");
      const toSplit = toOrig.split("\\");
      if (fromSplit[fromSplit.length - 1] === "") {
        fromSplit.pop();
      }
      if (toSplit[toSplit.length - 1] === "") {
        toSplit.pop();
      }
      const fromLen2 = fromSplit.length;
      const toLen2 = toSplit.length;
      const length2 = fromLen2 < toLen2 ? fromLen2 : toLen2;
      let i2;
      for (i2 = 0; i2 < length2; i2++) {
        if (fromSplit[i2].toLowerCase() !== toSplit[i2].toLowerCase()) {
          break;
        }
      }
      if (i2 === 0) {
        return toOrig;
      } else if (i2 === length2) {
        if (toLen2 > length2) {
          return toSplit.slice(i2).join("\\");
        }
        if (fromLen2 > length2) {
          return "..\\".repeat(fromLen2 - 1 - i2) + "..";
        }
        return "";
      }
      return "..\\".repeat(fromLen2 - i2) + toSplit.slice(i2).join("\\");
    }
    let fromStart = 0;
    while (fromStart < from.length && from.charCodeAt(fromStart) === CHAR_BACKWARD_SLASH) {
      fromStart++;
    }
    let fromEnd = from.length;
    while (fromEnd - 1 > fromStart && from.charCodeAt(fromEnd - 1) === CHAR_BACKWARD_SLASH) {
      fromEnd--;
    }
    const fromLen = fromEnd - fromStart;
    let toStart = 0;
    while (toStart < to.length && to.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) {
      toStart++;
    }
    let toEnd = to.length;
    while (toEnd - 1 > toStart && to.charCodeAt(toEnd - 1) === CHAR_BACKWARD_SLASH) {
      toEnd--;
    }
    const toLen = toEnd - toStart;
    const length = fromLen < toLen ? fromLen : toLen;
    let lastCommonSep = -1;
    let i = 0;
    for (; i < length; i++) {
      const fromCode = from.charCodeAt(fromStart + i);
      if (fromCode !== to.charCodeAt(toStart + i)) {
        break;
      } else if (fromCode === CHAR_BACKWARD_SLASH) {
        lastCommonSep = i;
      }
    }
    if (i !== length) {
      if (lastCommonSep === -1) {
        return toOrig;
      }
    } else {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === CHAR_BACKWARD_SLASH) {
          return toOrig.slice(toStart + i + 1);
        }
        if (i === 2) {
          return toOrig.slice(toStart + i);
        }
      }
      if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === CHAR_BACKWARD_SLASH) {
          lastCommonSep = i;
        } else if (i === 2) {
          lastCommonSep = 3;
        }
      }
      if (lastCommonSep === -1) {
        lastCommonSep = 0;
      }
    }
    let out = "";
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
      if (i === fromEnd || from.charCodeAt(i) === CHAR_BACKWARD_SLASH) {
        out += out.length === 0 ? ".." : "\\..";
      }
    }
    toStart += lastCommonSep;
    if (out.length > 0) {
      return `${out}${toOrig.slice(toStart, toEnd)}`;
    }
    if (toOrig.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) {
      ++toStart;
    }
    return toOrig.slice(toStart, toEnd);
  },
  toNamespacedPath(path) {
    if (typeof path !== "string" || path.length === 0) {
      return path;
    }
    const resolvedPath = win32.resolve(path);
    if (resolvedPath.length <= 2) {
      return path;
    }
    if (resolvedPath.charCodeAt(0) === CHAR_BACKWARD_SLASH) {
      if (resolvedPath.charCodeAt(1) === CHAR_BACKWARD_SLASH) {
        const code = resolvedPath.charCodeAt(2);
        if (code !== CHAR_QUESTION_MARK && code !== CHAR_DOT) {
          return `\\\\?\\UNC\\${resolvedPath.slice(2)}`;
        }
      }
    } else if (isWindowsDeviceRoot(resolvedPath.charCodeAt(0)) && resolvedPath.charCodeAt(1) === CHAR_COLON && resolvedPath.charCodeAt(2) === CHAR_BACKWARD_SLASH) {
      return `\\\\?\\${resolvedPath}`;
    }
    return resolvedPath;
  },
  dirname(path) {
    validateString(path, "path");
    const len = path.length;
    if (len === 0) {
      return ".";
    }
    let rootEnd = -1;
    let offset = 0;
    const code = path.charCodeAt(0);
    if (len === 1) {
      return isPathSeparator(code) ? path : ".";
    }
    if (isPathSeparator(code)) {
      rootEnd = offset = 1;
      if (isPathSeparator(path.charCodeAt(1))) {
        let j = 2;
        let last = j;
        while (j < len && !isPathSeparator(path.charCodeAt(j))) {
          j++;
        }
        if (j < len && j !== last) {
          last = j;
          while (j < len && isPathSeparator(path.charCodeAt(j))) {
            j++;
          }
          if (j < len && j !== last) {
            last = j;
            while (j < len && !isPathSeparator(path.charCodeAt(j))) {
              j++;
            }
            if (j === len) {
              return path;
            }
            if (j !== last) {
              rootEnd = offset = j + 1;
            }
          }
        }
      }
    } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
      rootEnd = len > 2 && isPathSeparator(path.charCodeAt(2)) ? 3 : 2;
      offset = rootEnd;
    }
    let end = -1;
    let matchedSlash = true;
    for (let i = len - 1; i >= offset; --i) {
      if (isPathSeparator(path.charCodeAt(i))) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
        matchedSlash = false;
      }
    }
    if (end === -1) {
      if (rootEnd === -1) {
        return ".";
      }
      end = rootEnd;
    }
    return path.slice(0, end);
  },
  basename(path, suffix) {
    if (suffix !== void 0) {
      validateString(suffix, "suffix");
    }
    validateString(path, "path");
    let start = 0;
    let end = -1;
    let matchedSlash = true;
    let i;
    if (path.length >= 2 && isWindowsDeviceRoot(path.charCodeAt(0)) && path.charCodeAt(1) === CHAR_COLON) {
      start = 2;
    }
    if (suffix !== void 0 && suffix.length > 0 && suffix.length <= path.length) {
      if (suffix === path) {
        return "";
      }
      let extIdx = suffix.length - 1;
      let firstNonSlashEnd = -1;
      for (i = path.length - 1; i >= start; --i) {
        const code = path.charCodeAt(i);
        if (isPathSeparator(code)) {
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else {
          if (firstNonSlashEnd === -1) {
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            if (code === suffix.charCodeAt(extIdx)) {
              if (--extIdx === -1) {
                end = i;
              }
            } else {
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }
      if (start === end) {
        end = firstNonSlashEnd;
      } else if (end === -1) {
        end = path.length;
      }
      return path.slice(start, end);
    }
    for (i = path.length - 1; i >= start; --i) {
      if (isPathSeparator(path.charCodeAt(i))) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
    }
    if (end === -1) {
      return "";
    }
    return path.slice(start, end);
  },
  extname(path) {
    validateString(path, "path");
    let start = 0;
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let preDotState = 0;
    if (path.length >= 2 && path.charCodeAt(1) === CHAR_COLON && isWindowsDeviceRoot(path.charCodeAt(0))) {
      start = startPart = 2;
    }
    for (let i = path.length - 1; i >= start; --i) {
      const code = path.charCodeAt(i);
      if (isPathSeparator(code)) {
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
      if (code === CHAR_DOT) {
        if (startDot === -1) {
          startDot = i;
        } else if (preDotState !== 1) {
          preDotState = 1;
        }
      } else if (startDot !== -1) {
        preDotState = -1;
      }
    }
    if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
    preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
    preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
      return "";
    }
    return path.slice(startDot, end);
  },
  format: _format.bind(null, "\\"),
  parse(path) {
    validateString(path, "path");
    const ret = { root: "", dir: "", base: "", ext: "", name: "" };
    if (path.length === 0) {
      return ret;
    }
    const len = path.length;
    let rootEnd = 0;
    let code = path.charCodeAt(0);
    if (len === 1) {
      if (isPathSeparator(code)) {
        ret.root = ret.dir = path;
        return ret;
      }
      ret.base = ret.name = path;
      return ret;
    }
    if (isPathSeparator(code)) {
      rootEnd = 1;
      if (isPathSeparator(path.charCodeAt(1))) {
        let j = 2;
        let last = j;
        while (j < len && !isPathSeparator(path.charCodeAt(j))) {
          j++;
        }
        if (j < len && j !== last) {
          last = j;
          while (j < len && isPathSeparator(path.charCodeAt(j))) {
            j++;
          }
          if (j < len && j !== last) {
            last = j;
            while (j < len && !isPathSeparator(path.charCodeAt(j))) {
              j++;
            }
            if (j === len) {
              rootEnd = j;
            } else if (j !== last) {
              rootEnd = j + 1;
            }
          }
        }
      }
    } else if (isWindowsDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
      if (len <= 2) {
        ret.root = ret.dir = path;
        return ret;
      }
      rootEnd = 2;
      if (isPathSeparator(path.charCodeAt(2))) {
        if (len === 3) {
          ret.root = ret.dir = path;
          return ret;
        }
        rootEnd = 3;
      }
    }
    if (rootEnd > 0) {
      ret.root = path.slice(0, rootEnd);
    }
    let startDot = -1;
    let startPart = rootEnd;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;
    let preDotState = 0;
    for (; i >= rootEnd; --i) {
      code = path.charCodeAt(i);
      if (isPathSeparator(code)) {
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
      if (code === CHAR_DOT) {
        if (startDot === -1) {
          startDot = i;
        } else if (preDotState !== 1) {
          preDotState = 1;
        }
      } else if (startDot !== -1) {
        preDotState = -1;
      }
    }
    if (end !== -1) {
      if (startDot === -1 || // We saw a non-dot character immediately before the dot
      preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
      preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        ret.base = ret.name = path.slice(startPart, end);
      } else {
        ret.name = path.slice(startPart, startDot);
        ret.base = path.slice(startPart, end);
        ret.ext = path.slice(startDot, end);
      }
    }
    if (startPart > 0 && startPart !== rootEnd) {
      ret.dir = path.slice(0, startPart - 1);
    } else {
      ret.dir = ret.root;
    }
    return ret;
  },
  sep: "\\",
  delimiter: ";",
  win32: null,
  posix: null
};
var posixCwd = (() => {
  if (platformIsWin32) {
    const regexp = /\\/g;
    return () => {
      const cwd2 = cwd().replace(regexp, "/");
      return cwd2.slice(cwd2.indexOf("/"));
    };
  }
  return () => cwd();
})();
var posix = {
  // path.resolve([from ...], to)
  resolve(...pathSegments) {
    let resolvedPath = "";
    let resolvedAbsolute = false;
    for (let i = pathSegments.length - 1; i >= 0 && !resolvedAbsolute; i--) {
      const path = pathSegments[i];
      validateString(path, `paths[${i}]`);
      if (path.length === 0) {
        continue;
      }
      resolvedPath = `${path}/${resolvedPath}`;
      resolvedAbsolute = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
    }
    if (!resolvedAbsolute) {
      const cwd2 = posixCwd();
      resolvedPath = `${cwd2}/${resolvedPath}`;
      resolvedAbsolute = cwd2.charCodeAt(0) === CHAR_FORWARD_SLASH;
    }
    resolvedPath = normalizeString(
      resolvedPath,
      !resolvedAbsolute,
      "/",
      isPosixPathSeparator
    );
    if (resolvedAbsolute) {
      return `/${resolvedPath}`;
    }
    return resolvedPath.length > 0 ? resolvedPath : ".";
  },
  normalize(path) {
    validateString(path, "path");
    if (path.length === 0) {
      return ".";
    }
    const isAbsolute2 = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
    const trailingSeparator = path.charCodeAt(path.length - 1) === CHAR_FORWARD_SLASH;
    path = normalizeString(path, !isAbsolute2, "/", isPosixPathSeparator);
    if (path.length === 0) {
      if (isAbsolute2) {
        return "/";
      }
      return trailingSeparator ? "./" : ".";
    }
    if (trailingSeparator) {
      path += "/";
    }
    return isAbsolute2 ? `/${path}` : path;
  },
  isAbsolute(path) {
    validateString(path, "path");
    return path.length > 0 && path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  },
  join(...paths) {
    if (paths.length === 0) {
      return ".";
    }
    const path = [];
    for (let i = 0; i < paths.length; ++i) {
      const arg = paths[i];
      validateString(arg, "path");
      if (arg.length > 0) {
        path.push(arg);
      }
    }
    if (path.length === 0) {
      return ".";
    }
    return posix.normalize(path.join("/"));
  },
  relative(from, to) {
    validateString(from, "from");
    validateString(to, "to");
    if (from === to) {
      return "";
    }
    from = posix.resolve(from);
    to = posix.resolve(to);
    if (from === to) {
      return "";
    }
    const fromStart = 1;
    const fromEnd = from.length;
    const fromLen = fromEnd - fromStart;
    const toStart = 1;
    const toLen = to.length - toStart;
    const length = fromLen < toLen ? fromLen : toLen;
    let lastCommonSep = -1;
    let i = 0;
    for (; i < length; i++) {
      const fromCode = from.charCodeAt(fromStart + i);
      if (fromCode !== to.charCodeAt(toStart + i)) {
        break;
      } else if (fromCode === CHAR_FORWARD_SLASH) {
        lastCommonSep = i;
      }
    }
    if (i === length) {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === CHAR_FORWARD_SLASH) {
          return to.slice(toStart + i + 1);
        }
        if (i === 0) {
          return to.slice(toStart + i);
        }
      } else if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === CHAR_FORWARD_SLASH) {
          lastCommonSep = i;
        } else if (i === 0) {
          lastCommonSep = 0;
        }
      }
    }
    let out = "";
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
      if (i === fromEnd || from.charCodeAt(i) === CHAR_FORWARD_SLASH) {
        out += out.length === 0 ? ".." : "/..";
      }
    }
    return `${out}${to.slice(toStart + lastCommonSep)}`;
  },
  toNamespacedPath(path) {
    return path;
  },
  dirname(path) {
    validateString(path, "path");
    if (path.length === 0) {
      return ".";
    }
    const hasRoot = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
    let end = -1;
    let matchedSlash = true;
    for (let i = path.length - 1; i >= 1; --i) {
      if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
        matchedSlash = false;
      }
    }
    if (end === -1) {
      return hasRoot ? "/" : ".";
    }
    if (hasRoot && end === 1) {
      return "//";
    }
    return path.slice(0, end);
  },
  basename(path, suffix) {
    if (suffix !== void 0) {
      validateString(suffix, "suffix");
    }
    validateString(path, "path");
    let start = 0;
    let end = -1;
    let matchedSlash = true;
    let i;
    if (suffix !== void 0 && suffix.length > 0 && suffix.length <= path.length) {
      if (suffix === path) {
        return "";
      }
      let extIdx = suffix.length - 1;
      let firstNonSlashEnd = -1;
      for (i = path.length - 1; i >= 0; --i) {
        const code = path.charCodeAt(i);
        if (code === CHAR_FORWARD_SLASH) {
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else {
          if (firstNonSlashEnd === -1) {
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            if (code === suffix.charCodeAt(extIdx)) {
              if (--extIdx === -1) {
                end = i;
              }
            } else {
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }
      if (start === end) {
        end = firstNonSlashEnd;
      } else if (end === -1) {
        end = path.length;
      }
      return path.slice(start, end);
    }
    for (i = path.length - 1; i >= 0; --i) {
      if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
    }
    if (end === -1) {
      return "";
    }
    return path.slice(start, end);
  },
  extname(path) {
    validateString(path, "path");
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let preDotState = 0;
    for (let i = path.length - 1; i >= 0; --i) {
      const char = path[i];
      if (char === "/") {
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
      if (char === ".") {
        if (startDot === -1) {
          startDot = i;
        } else if (preDotState !== 1) {
          preDotState = 1;
        }
      } else if (startDot !== -1) {
        preDotState = -1;
      }
    }
    if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
    preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
    preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
      return "";
    }
    return path.slice(startDot, end);
  },
  format: _format.bind(null, "/"),
  parse(path) {
    validateString(path, "path");
    const ret = { root: "", dir: "", base: "", ext: "", name: "" };
    if (path.length === 0) {
      return ret;
    }
    const isAbsolute2 = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
    let start;
    if (isAbsolute2) {
      ret.root = "/";
      start = 1;
    } else {
      start = 0;
    }
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;
    let preDotState = 0;
    for (; i >= start; --i) {
      const code = path.charCodeAt(i);
      if (code === CHAR_FORWARD_SLASH) {
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
      if (code === CHAR_DOT) {
        if (startDot === -1) {
          startDot = i;
        } else if (preDotState !== 1) {
          preDotState = 1;
        }
      } else if (startDot !== -1) {
        preDotState = -1;
      }
    }
    if (end !== -1) {
      const start2 = startPart === 0 && isAbsolute2 ? 1 : startPart;
      if (startDot === -1 || // We saw a non-dot character immediately before the dot
      preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
      preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        ret.base = ret.name = path.slice(start2, end);
      } else {
        ret.name = path.slice(start2, startDot);
        ret.base = path.slice(start2, end);
        ret.ext = path.slice(startDot, end);
      }
    }
    if (startPart > 0) {
      ret.dir = path.slice(0, startPart - 1);
    } else if (isAbsolute2) {
      ret.dir = "/";
    }
    return ret;
  },
  sep: "/",
  delimiter: ":",
  win32: null,
  posix: null
};
posix.win32 = win32.win32 = win32;
posix.posix = win32.posix = posix;
var normalize = platformIsWin32 ? win32.normalize : posix.normalize;
var isAbsolute = platformIsWin32 ? win32.isAbsolute : posix.isAbsolute;
var join = platformIsWin32 ? win32.join : posix.join;
var resolve = platformIsWin32 ? win32.resolve : posix.resolve;
var relative = platformIsWin32 ? win32.relative : posix.relative;
var dirname = platformIsWin32 ? win32.dirname : posix.dirname;
var basename = platformIsWin32 ? win32.basename : posix.basename;
var extname = platformIsWin32 ? win32.extname : posix.extname;
var format = platformIsWin32 ? win32.format : posix.format;
var parse = platformIsWin32 ? win32.parse : posix.parse;
var toNamespacedPath = platformIsWin32 ? win32.toNamespacedPath : posix.toNamespacedPath;
var sep = platformIsWin32 ? win32.sep : posix.sep;
var delimiter = platformIsWin32 ? win32.delimiter : posix.delimiter;

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/cache.ts
function identity(t) {
  return t;
}
var LRUCachedFunction = class {
  constructor(arg1, arg2) {
    this.lastCache = void 0;
    this.lastArgKey = void 0;
    if (typeof arg1 === "function") {
      this._fn = arg1;
      this._computeKey = identity;
    } else {
      this._fn = arg2;
      this._computeKey = arg1.getCacheKey;
    }
  }
  get(arg) {
    const key = this._computeKey(arg);
    if (this.lastArgKey !== key) {
      this.lastArgKey = key;
      this.lastCache = this._fn(arg);
    }
    return this.lastCache;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/lazy.ts
var Lazy = class {
  constructor(executor) {
    this.executor = executor;
    this._state = 0 /* Uninitialized */;
  }
  /**
   * True if the lazy value has been resolved.
   */
  get hasValue() {
    return this._state === 2 /* Completed */;
  }
  /**
   * Get the wrapped value.
   *
   * This will force evaluation of the lazy value if it has not been resolved yet. Lazy values are only
   * resolved once. `getValue` will re-throw exceptions that are hit while resolving the value
   */
  get value() {
    if (this._state === 0 /* Uninitialized */) {
      this._state = 1 /* Running */;
      try {
        this._value = this.executor();
      } catch (err) {
        this._error = err;
      } finally {
        this._state = 2 /* Completed */;
      }
    } else if (this._state === 1 /* Running */) {
      throw new Error("Cannot read the value of a lazy that is being initialized");
    }
    if (this._error) {
      throw this._error;
    }
    return this._value;
  }
  /**
   * Get the wrapped value without forcing evaluation.
   */
  get rawValue() {
    return this._value;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/strings.ts
function compare(a, b) {
  if (a < b) {
    return -1;
  } else if (a > b) {
    return 1;
  } else {
    return 0;
  }
}
function compareSubstring(a, b, aStart = 0, aEnd = a.length, bStart = 0, bEnd = b.length) {
  for (; aStart < aEnd && bStart < bEnd; aStart++, bStart++) {
    const codeA = a.charCodeAt(aStart);
    const codeB = b.charCodeAt(bStart);
    if (codeA < codeB) {
      return -1;
    } else if (codeA > codeB) {
      return 1;
    }
  }
  const aLen = aEnd - aStart;
  const bLen = bEnd - bStart;
  if (aLen < bLen) {
    return -1;
  } else if (aLen > bLen) {
    return 1;
  }
  return 0;
}
function compareSubstringIgnoreCase(a, b, aStart = 0, aEnd = a.length, bStart = 0, bEnd = b.length) {
  for (; aStart < aEnd && bStart < bEnd; aStart++, bStart++) {
    let codeA = a.charCodeAt(aStart);
    let codeB = b.charCodeAt(bStart);
    if (codeA === codeB) {
      continue;
    }
    if (codeA >= 128 || codeB >= 128) {
      return compareSubstring(a.toLowerCase(), b.toLowerCase(), aStart, aEnd, bStart, bEnd);
    }
    if (isLowerAsciiLetter(codeA)) {
      codeA -= 32;
    }
    if (isLowerAsciiLetter(codeB)) {
      codeB -= 32;
    }
    const diff = codeA - codeB;
    if (diff === 0) {
      continue;
    }
    return diff;
  }
  const aLen = aEnd - aStart;
  const bLen = bEnd - bStart;
  if (aLen < bLen) {
    return -1;
  } else if (aLen > bLen) {
    return 1;
  }
  return 0;
}
function isLowerAsciiLetter(code) {
  return code >= 97 /* a */ && code <= 122 /* z */;
}
function equalsIgnoreCase(a, b) {
  return a.length === b.length && compareSubstringIgnoreCase(a, b) === 0;
}
function startsWithIgnoreCase(str, candidate) {
  const len = candidate.length;
  return len <= str.length && compareSubstringIgnoreCase(str, candidate, 0, len) === 0;
}
function isHighSurrogate(charCode) {
  return 55296 <= charCode && charCode <= 56319;
}
function isLowSurrogate(charCode) {
  return 56320 <= charCode && charCode <= 57343;
}
function computeCodePoint(highSurrogate, lowSurrogate) {
  return (highSurrogate - 55296 << 10) + (lowSurrogate - 56320) + 65536;
}
var CSI_SEQUENCE = /(?:\x1b\[|\x9b)[=?>!]?[\d;:]*["$#'* ]?[a-zA-Z@^`{}|~]/;
var OSC_SEQUENCE = /(?:\x1b\]|\x9d).*?(?:\x1b\\|\x07|\x9c)/;
var ESC_SEQUENCE = /\x1b(?:[ #%\(\)\*\+\-\.\/]?[a-zA-Z0-9\|}~@])/;
var CONTROL_SEQUENCES = new RegExp("(?:" + [
  CSI_SEQUENCE.source,
  OSC_SEQUENCE.source,
  ESC_SEQUENCE.source
].join("|") + ")", "g");
var UTF8_BOM_CHARACTER = String.fromCharCode(65279 /* UTF8_BOM */);
var GraphemeBreakTree = class _GraphemeBreakTree {
  static {
    this._INSTANCE = null;
  }
  static getInstance() {
    if (!_GraphemeBreakTree._INSTANCE) {
      _GraphemeBreakTree._INSTANCE = new _GraphemeBreakTree();
    }
    return _GraphemeBreakTree._INSTANCE;
  }
  constructor() {
    this._data = getGraphemeBreakRawData();
  }
  getGraphemeBreakType(codePoint) {
    if (codePoint < 32) {
      if (codePoint === 10 /* LineFeed */) {
        return 3 /* LF */;
      }
      if (codePoint === 13 /* CarriageReturn */) {
        return 2 /* CR */;
      }
      return 4 /* Control */;
    }
    if (codePoint < 127) {
      return 0 /* Other */;
    }
    const data = this._data;
    const nodeCount = data.length / 3;
    let nodeIndex = 1;
    while (nodeIndex <= nodeCount) {
      if (codePoint < data[3 * nodeIndex]) {
        nodeIndex = 2 * nodeIndex;
      } else if (codePoint > data[3 * nodeIndex + 1]) {
        nodeIndex = 2 * nodeIndex + 1;
      } else {
        return data[3 * nodeIndex + 2];
      }
    }
    return 0 /* Other */;
  }
};
function getGraphemeBreakRawData() {
  return JSON.parse("[0,0,0,51229,51255,12,44061,44087,12,127462,127487,6,7083,7085,5,47645,47671,12,54813,54839,12,128678,128678,14,3270,3270,5,9919,9923,14,45853,45879,12,49437,49463,12,53021,53047,12,71216,71218,7,128398,128399,14,129360,129374,14,2519,2519,5,4448,4519,9,9742,9742,14,12336,12336,14,44957,44983,12,46749,46775,12,48541,48567,12,50333,50359,12,52125,52151,12,53917,53943,12,69888,69890,5,73018,73018,5,127990,127990,14,128558,128559,14,128759,128760,14,129653,129655,14,2027,2035,5,2891,2892,7,3761,3761,5,6683,6683,5,8293,8293,4,9825,9826,14,9999,9999,14,43452,43453,5,44509,44535,12,45405,45431,12,46301,46327,12,47197,47223,12,48093,48119,12,48989,49015,12,49885,49911,12,50781,50807,12,51677,51703,12,52573,52599,12,53469,53495,12,54365,54391,12,65279,65279,4,70471,70472,7,72145,72147,7,119173,119179,5,127799,127818,14,128240,128244,14,128512,128512,14,128652,128652,14,128721,128722,14,129292,129292,14,129445,129450,14,129734,129743,14,1476,1477,5,2366,2368,7,2750,2752,7,3076,3076,5,3415,3415,5,4141,4144,5,6109,6109,5,6964,6964,5,7394,7400,5,9197,9198,14,9770,9770,14,9877,9877,14,9968,9969,14,10084,10084,14,43052,43052,5,43713,43713,5,44285,44311,12,44733,44759,12,45181,45207,12,45629,45655,12,46077,46103,12,46525,46551,12,46973,46999,12,47421,47447,12,47869,47895,12,48317,48343,12,48765,48791,12,49213,49239,12,49661,49687,12,50109,50135,12,50557,50583,12,51005,51031,12,51453,51479,12,51901,51927,12,52349,52375,12,52797,52823,12,53245,53271,12,53693,53719,12,54141,54167,12,54589,54615,12,55037,55063,12,69506,69509,5,70191,70193,5,70841,70841,7,71463,71467,5,72330,72342,5,94031,94031,5,123628,123631,5,127763,127765,14,127941,127941,14,128043,128062,14,128302,128317,14,128465,128467,14,128539,128539,14,128640,128640,14,128662,128662,14,128703,128703,14,128745,128745,14,129004,129007,14,129329,129330,14,129402,129402,14,129483,129483,14,129686,129704,14,130048,131069,14,173,173,4,1757,1757,1,2200,2207,5,2434,2435,7,2631,2632,5,2817,2817,5,3008,3008,5,3201,3201,5,3387,3388,5,3542,3542,5,3902,3903,7,4190,4192,5,6002,6003,5,6439,6440,5,6765,6770,7,7019,7027,5,7154,7155,7,8205,8205,13,8505,8505,14,9654,9654,14,9757,9757,14,9792,9792,14,9852,9853,14,9890,9894,14,9937,9937,14,9981,9981,14,10035,10036,14,11035,11036,14,42654,42655,5,43346,43347,7,43587,43587,5,44006,44007,7,44173,44199,12,44397,44423,12,44621,44647,12,44845,44871,12,45069,45095,12,45293,45319,12,45517,45543,12,45741,45767,12,45965,45991,12,46189,46215,12,46413,46439,12,46637,46663,12,46861,46887,12,47085,47111,12,47309,47335,12,47533,47559,12,47757,47783,12,47981,48007,12,48205,48231,12,48429,48455,12,48653,48679,12,48877,48903,12,49101,49127,12,49325,49351,12,49549,49575,12,49773,49799,12,49997,50023,12,50221,50247,12,50445,50471,12,50669,50695,12,50893,50919,12,51117,51143,12,51341,51367,12,51565,51591,12,51789,51815,12,52013,52039,12,52237,52263,12,52461,52487,12,52685,52711,12,52909,52935,12,53133,53159,12,53357,53383,12,53581,53607,12,53805,53831,12,54029,54055,12,54253,54279,12,54477,54503,12,54701,54727,12,54925,54951,12,55149,55175,12,68101,68102,5,69762,69762,7,70067,70069,7,70371,70378,5,70720,70721,7,71087,71087,5,71341,71341,5,71995,71996,5,72249,72249,7,72850,72871,5,73109,73109,5,118576,118598,5,121505,121519,5,127245,127247,14,127568,127569,14,127777,127777,14,127872,127891,14,127956,127967,14,128015,128016,14,128110,128172,14,128259,128259,14,128367,128368,14,128424,128424,14,128488,128488,14,128530,128532,14,128550,128551,14,128566,128566,14,128647,128647,14,128656,128656,14,128667,128673,14,128691,128693,14,128715,128715,14,128728,128732,14,128752,128752,14,128765,128767,14,129096,129103,14,129311,129311,14,129344,129349,14,129394,129394,14,129413,129425,14,129466,129471,14,129511,129535,14,129664,129666,14,129719,129722,14,129760,129767,14,917536,917631,5,13,13,2,1160,1161,5,1564,1564,4,1807,1807,1,2085,2087,5,2307,2307,7,2382,2383,7,2497,2500,5,2563,2563,7,2677,2677,5,2763,2764,7,2879,2879,5,2914,2915,5,3021,3021,5,3142,3144,5,3263,3263,5,3285,3286,5,3398,3400,7,3530,3530,5,3633,3633,5,3864,3865,5,3974,3975,5,4155,4156,7,4229,4230,5,5909,5909,7,6078,6085,7,6277,6278,5,6451,6456,7,6744,6750,5,6846,6846,5,6972,6972,5,7074,7077,5,7146,7148,7,7222,7223,5,7416,7417,5,8234,8238,4,8417,8417,5,9000,9000,14,9203,9203,14,9730,9731,14,9748,9749,14,9762,9763,14,9776,9783,14,9800,9811,14,9831,9831,14,9872,9873,14,9882,9882,14,9900,9903,14,9929,9933,14,9941,9960,14,9974,9974,14,9989,9989,14,10006,10006,14,10062,10062,14,10160,10160,14,11647,11647,5,12953,12953,14,43019,43019,5,43232,43249,5,43443,43443,5,43567,43568,7,43696,43696,5,43765,43765,7,44013,44013,5,44117,44143,12,44229,44255,12,44341,44367,12,44453,44479,12,44565,44591,12,44677,44703,12,44789,44815,12,44901,44927,12,45013,45039,12,45125,45151,12,45237,45263,12,45349,45375,12,45461,45487,12,45573,45599,12,45685,45711,12,45797,45823,12,45909,45935,12,46021,46047,12,46133,46159,12,46245,46271,12,46357,46383,12,46469,46495,12,46581,46607,12,46693,46719,12,46805,46831,12,46917,46943,12,47029,47055,12,47141,47167,12,47253,47279,12,47365,47391,12,47477,47503,12,47589,47615,12,47701,47727,12,47813,47839,12,47925,47951,12,48037,48063,12,48149,48175,12,48261,48287,12,48373,48399,12,48485,48511,12,48597,48623,12,48709,48735,12,48821,48847,12,48933,48959,12,49045,49071,12,49157,49183,12,49269,49295,12,49381,49407,12,49493,49519,12,49605,49631,12,49717,49743,12,49829,49855,12,49941,49967,12,50053,50079,12,50165,50191,12,50277,50303,12,50389,50415,12,50501,50527,12,50613,50639,12,50725,50751,12,50837,50863,12,50949,50975,12,51061,51087,12,51173,51199,12,51285,51311,12,51397,51423,12,51509,51535,12,51621,51647,12,51733,51759,12,51845,51871,12,51957,51983,12,52069,52095,12,52181,52207,12,52293,52319,12,52405,52431,12,52517,52543,12,52629,52655,12,52741,52767,12,52853,52879,12,52965,52991,12,53077,53103,12,53189,53215,12,53301,53327,12,53413,53439,12,53525,53551,12,53637,53663,12,53749,53775,12,53861,53887,12,53973,53999,12,54085,54111,12,54197,54223,12,54309,54335,12,54421,54447,12,54533,54559,12,54645,54671,12,54757,54783,12,54869,54895,12,54981,55007,12,55093,55119,12,55243,55291,10,66045,66045,5,68325,68326,5,69688,69702,5,69817,69818,5,69957,69958,7,70089,70092,5,70198,70199,5,70462,70462,5,70502,70508,5,70750,70750,5,70846,70846,7,71100,71101,5,71230,71230,7,71351,71351,5,71737,71738,5,72000,72000,7,72160,72160,5,72273,72278,5,72752,72758,5,72882,72883,5,73031,73031,5,73461,73462,7,94192,94193,7,119149,119149,7,121403,121452,5,122915,122916,5,126980,126980,14,127358,127359,14,127535,127535,14,127759,127759,14,127771,127771,14,127792,127793,14,127825,127867,14,127897,127899,14,127945,127945,14,127985,127986,14,128000,128007,14,128021,128021,14,128066,128100,14,128184,128235,14,128249,128252,14,128266,128276,14,128335,128335,14,128379,128390,14,128407,128419,14,128444,128444,14,128481,128481,14,128499,128499,14,128526,128526,14,128536,128536,14,128543,128543,14,128556,128556,14,128564,128564,14,128577,128580,14,128643,128645,14,128649,128649,14,128654,128654,14,128660,128660,14,128664,128664,14,128675,128675,14,128686,128689,14,128695,128696,14,128705,128709,14,128717,128719,14,128725,128725,14,128736,128741,14,128747,128748,14,128755,128755,14,128762,128762,14,128981,128991,14,129009,129023,14,129160,129167,14,129296,129304,14,129320,129327,14,129340,129342,14,129356,129356,14,129388,129392,14,129399,129400,14,129404,129407,14,129432,129442,14,129454,129455,14,129473,129474,14,129485,129487,14,129648,129651,14,129659,129660,14,129671,129679,14,129709,129711,14,129728,129730,14,129751,129753,14,129776,129782,14,917505,917505,4,917760,917999,5,10,10,3,127,159,4,768,879,5,1471,1471,5,1536,1541,1,1648,1648,5,1767,1768,5,1840,1866,5,2070,2073,5,2137,2139,5,2274,2274,1,2363,2363,7,2377,2380,7,2402,2403,5,2494,2494,5,2507,2508,7,2558,2558,5,2622,2624,7,2641,2641,5,2691,2691,7,2759,2760,5,2786,2787,5,2876,2876,5,2881,2884,5,2901,2902,5,3006,3006,5,3014,3016,7,3072,3072,5,3134,3136,5,3157,3158,5,3260,3260,5,3266,3266,5,3274,3275,7,3328,3329,5,3391,3392,7,3405,3405,5,3457,3457,5,3536,3537,7,3551,3551,5,3636,3642,5,3764,3772,5,3895,3895,5,3967,3967,7,3993,4028,5,4146,4151,5,4182,4183,7,4226,4226,5,4253,4253,5,4957,4959,5,5940,5940,7,6070,6070,7,6087,6088,7,6158,6158,4,6432,6434,5,6448,6449,7,6679,6680,5,6742,6742,5,6754,6754,5,6783,6783,5,6912,6915,5,6966,6970,5,6978,6978,5,7042,7042,7,7080,7081,5,7143,7143,7,7150,7150,7,7212,7219,5,7380,7392,5,7412,7412,5,8203,8203,4,8232,8232,4,8265,8265,14,8400,8412,5,8421,8432,5,8617,8618,14,9167,9167,14,9200,9200,14,9410,9410,14,9723,9726,14,9733,9733,14,9745,9745,14,9752,9752,14,9760,9760,14,9766,9766,14,9774,9774,14,9786,9786,14,9794,9794,14,9823,9823,14,9828,9828,14,9833,9850,14,9855,9855,14,9875,9875,14,9880,9880,14,9885,9887,14,9896,9897,14,9906,9916,14,9926,9927,14,9935,9935,14,9939,9939,14,9962,9962,14,9972,9972,14,9978,9978,14,9986,9986,14,9997,9997,14,10002,10002,14,10017,10017,14,10055,10055,14,10071,10071,14,10133,10135,14,10548,10549,14,11093,11093,14,12330,12333,5,12441,12442,5,42608,42610,5,43010,43010,5,43045,43046,5,43188,43203,7,43302,43309,5,43392,43394,5,43446,43449,5,43493,43493,5,43571,43572,7,43597,43597,7,43703,43704,5,43756,43757,5,44003,44004,7,44009,44010,7,44033,44059,12,44089,44115,12,44145,44171,12,44201,44227,12,44257,44283,12,44313,44339,12,44369,44395,12,44425,44451,12,44481,44507,12,44537,44563,12,44593,44619,12,44649,44675,12,44705,44731,12,44761,44787,12,44817,44843,12,44873,44899,12,44929,44955,12,44985,45011,12,45041,45067,12,45097,45123,12,45153,45179,12,45209,45235,12,45265,45291,12,45321,45347,12,45377,45403,12,45433,45459,12,45489,45515,12,45545,45571,12,45601,45627,12,45657,45683,12,45713,45739,12,45769,45795,12,45825,45851,12,45881,45907,12,45937,45963,12,45993,46019,12,46049,46075,12,46105,46131,12,46161,46187,12,46217,46243,12,46273,46299,12,46329,46355,12,46385,46411,12,46441,46467,12,46497,46523,12,46553,46579,12,46609,46635,12,46665,46691,12,46721,46747,12,46777,46803,12,46833,46859,12,46889,46915,12,46945,46971,12,47001,47027,12,47057,47083,12,47113,47139,12,47169,47195,12,47225,47251,12,47281,47307,12,47337,47363,12,47393,47419,12,47449,47475,12,47505,47531,12,47561,47587,12,47617,47643,12,47673,47699,12,47729,47755,12,47785,47811,12,47841,47867,12,47897,47923,12,47953,47979,12,48009,48035,12,48065,48091,12,48121,48147,12,48177,48203,12,48233,48259,12,48289,48315,12,48345,48371,12,48401,48427,12,48457,48483,12,48513,48539,12,48569,48595,12,48625,48651,12,48681,48707,12,48737,48763,12,48793,48819,12,48849,48875,12,48905,48931,12,48961,48987,12,49017,49043,12,49073,49099,12,49129,49155,12,49185,49211,12,49241,49267,12,49297,49323,12,49353,49379,12,49409,49435,12,49465,49491,12,49521,49547,12,49577,49603,12,49633,49659,12,49689,49715,12,49745,49771,12,49801,49827,12,49857,49883,12,49913,49939,12,49969,49995,12,50025,50051,12,50081,50107,12,50137,50163,12,50193,50219,12,50249,50275,12,50305,50331,12,50361,50387,12,50417,50443,12,50473,50499,12,50529,50555,12,50585,50611,12,50641,50667,12,50697,50723,12,50753,50779,12,50809,50835,12,50865,50891,12,50921,50947,12,50977,51003,12,51033,51059,12,51089,51115,12,51145,51171,12,51201,51227,12,51257,51283,12,51313,51339,12,51369,51395,12,51425,51451,12,51481,51507,12,51537,51563,12,51593,51619,12,51649,51675,12,51705,51731,12,51761,51787,12,51817,51843,12,51873,51899,12,51929,51955,12,51985,52011,12,52041,52067,12,52097,52123,12,52153,52179,12,52209,52235,12,52265,52291,12,52321,52347,12,52377,52403,12,52433,52459,12,52489,52515,12,52545,52571,12,52601,52627,12,52657,52683,12,52713,52739,12,52769,52795,12,52825,52851,12,52881,52907,12,52937,52963,12,52993,53019,12,53049,53075,12,53105,53131,12,53161,53187,12,53217,53243,12,53273,53299,12,53329,53355,12,53385,53411,12,53441,53467,12,53497,53523,12,53553,53579,12,53609,53635,12,53665,53691,12,53721,53747,12,53777,53803,12,53833,53859,12,53889,53915,12,53945,53971,12,54001,54027,12,54057,54083,12,54113,54139,12,54169,54195,12,54225,54251,12,54281,54307,12,54337,54363,12,54393,54419,12,54449,54475,12,54505,54531,12,54561,54587,12,54617,54643,12,54673,54699,12,54729,54755,12,54785,54811,12,54841,54867,12,54897,54923,12,54953,54979,12,55009,55035,12,55065,55091,12,55121,55147,12,55177,55203,12,65024,65039,5,65520,65528,4,66422,66426,5,68152,68154,5,69291,69292,5,69633,69633,5,69747,69748,5,69811,69814,5,69826,69826,5,69932,69932,7,70016,70017,5,70079,70080,7,70095,70095,5,70196,70196,5,70367,70367,5,70402,70403,7,70464,70464,5,70487,70487,5,70709,70711,7,70725,70725,7,70833,70834,7,70843,70844,7,70849,70849,7,71090,71093,5,71103,71104,5,71227,71228,7,71339,71339,5,71344,71349,5,71458,71461,5,71727,71735,5,71985,71989,7,71998,71998,5,72002,72002,7,72154,72155,5,72193,72202,5,72251,72254,5,72281,72283,5,72344,72345,5,72766,72766,7,72874,72880,5,72885,72886,5,73023,73029,5,73104,73105,5,73111,73111,5,92912,92916,5,94095,94098,5,113824,113827,4,119142,119142,7,119155,119162,4,119362,119364,5,121476,121476,5,122888,122904,5,123184,123190,5,125252,125258,5,127183,127183,14,127340,127343,14,127377,127386,14,127491,127503,14,127548,127551,14,127744,127756,14,127761,127761,14,127769,127769,14,127773,127774,14,127780,127788,14,127796,127797,14,127820,127823,14,127869,127869,14,127894,127895,14,127902,127903,14,127943,127943,14,127947,127950,14,127972,127972,14,127988,127988,14,127992,127994,14,128009,128011,14,128019,128019,14,128023,128041,14,128064,128064,14,128102,128107,14,128174,128181,14,128238,128238,14,128246,128247,14,128254,128254,14,128264,128264,14,128278,128299,14,128329,128330,14,128348,128359,14,128371,128377,14,128392,128393,14,128401,128404,14,128421,128421,14,128433,128434,14,128450,128452,14,128476,128478,14,128483,128483,14,128495,128495,14,128506,128506,14,128519,128520,14,128528,128528,14,128534,128534,14,128538,128538,14,128540,128542,14,128544,128549,14,128552,128555,14,128557,128557,14,128560,128563,14,128565,128565,14,128567,128576,14,128581,128591,14,128641,128642,14,128646,128646,14,128648,128648,14,128650,128651,14,128653,128653,14,128655,128655,14,128657,128659,14,128661,128661,14,128663,128663,14,128665,128666,14,128674,128674,14,128676,128677,14,128679,128685,14,128690,128690,14,128694,128694,14,128697,128702,14,128704,128704,14,128710,128714,14,128716,128716,14,128720,128720,14,128723,128724,14,128726,128727,14,128733,128735,14,128742,128744,14,128746,128746,14,128749,128751,14,128753,128754,14,128756,128758,14,128761,128761,14,128763,128764,14,128884,128895,14,128992,129003,14,129008,129008,14,129036,129039,14,129114,129119,14,129198,129279,14,129293,129295,14,129305,129310,14,129312,129319,14,129328,129328,14,129331,129338,14,129343,129343,14,129351,129355,14,129357,129359,14,129375,129387,14,129393,129393,14,129395,129398,14,129401,129401,14,129403,129403,14,129408,129412,14,129426,129431,14,129443,129444,14,129451,129453,14,129456,129465,14,129472,129472,14,129475,129482,14,129484,129484,14,129488,129510,14,129536,129647,14,129652,129652,14,129656,129658,14,129661,129663,14,129667,129670,14,129680,129685,14,129705,129708,14,129712,129718,14,129723,129727,14,129731,129733,14,129744,129750,14,129754,129759,14,129768,129775,14,129783,129791,14,917504,917504,4,917506,917535,4,917632,917759,4,918000,921599,4,0,9,4,11,12,4,14,31,4,169,169,14,174,174,14,1155,1159,5,1425,1469,5,1473,1474,5,1479,1479,5,1552,1562,5,1611,1631,5,1750,1756,5,1759,1764,5,1770,1773,5,1809,1809,5,1958,1968,5,2045,2045,5,2075,2083,5,2089,2093,5,2192,2193,1,2250,2273,5,2275,2306,5,2362,2362,5,2364,2364,5,2369,2376,5,2381,2381,5,2385,2391,5,2433,2433,5,2492,2492,5,2495,2496,7,2503,2504,7,2509,2509,5,2530,2531,5,2561,2562,5,2620,2620,5,2625,2626,5,2635,2637,5,2672,2673,5,2689,2690,5,2748,2748,5,2753,2757,5,2761,2761,7,2765,2765,5,2810,2815,5,2818,2819,7,2878,2878,5,2880,2880,7,2887,2888,7,2893,2893,5,2903,2903,5,2946,2946,5,3007,3007,7,3009,3010,7,3018,3020,7,3031,3031,5,3073,3075,7,3132,3132,5,3137,3140,7,3146,3149,5,3170,3171,5,3202,3203,7,3262,3262,7,3264,3265,7,3267,3268,7,3271,3272,7,3276,3277,5,3298,3299,5,3330,3331,7,3390,3390,5,3393,3396,5,3402,3404,7,3406,3406,1,3426,3427,5,3458,3459,7,3535,3535,5,3538,3540,5,3544,3550,7,3570,3571,7,3635,3635,7,3655,3662,5,3763,3763,7,3784,3789,5,3893,3893,5,3897,3897,5,3953,3966,5,3968,3972,5,3981,3991,5,4038,4038,5,4145,4145,7,4153,4154,5,4157,4158,5,4184,4185,5,4209,4212,5,4228,4228,7,4237,4237,5,4352,4447,8,4520,4607,10,5906,5908,5,5938,5939,5,5970,5971,5,6068,6069,5,6071,6077,5,6086,6086,5,6089,6099,5,6155,6157,5,6159,6159,5,6313,6313,5,6435,6438,7,6441,6443,7,6450,6450,5,6457,6459,5,6681,6682,7,6741,6741,7,6743,6743,7,6752,6752,5,6757,6764,5,6771,6780,5,6832,6845,5,6847,6862,5,6916,6916,7,6965,6965,5,6971,6971,7,6973,6977,7,6979,6980,7,7040,7041,5,7073,7073,7,7078,7079,7,7082,7082,7,7142,7142,5,7144,7145,5,7149,7149,5,7151,7153,5,7204,7211,7,7220,7221,7,7376,7378,5,7393,7393,7,7405,7405,5,7415,7415,7,7616,7679,5,8204,8204,5,8206,8207,4,8233,8233,4,8252,8252,14,8288,8292,4,8294,8303,4,8413,8416,5,8418,8420,5,8482,8482,14,8596,8601,14,8986,8987,14,9096,9096,14,9193,9196,14,9199,9199,14,9201,9202,14,9208,9210,14,9642,9643,14,9664,9664,14,9728,9729,14,9732,9732,14,9735,9741,14,9743,9744,14,9746,9746,14,9750,9751,14,9753,9756,14,9758,9759,14,9761,9761,14,9764,9765,14,9767,9769,14,9771,9773,14,9775,9775,14,9784,9785,14,9787,9791,14,9793,9793,14,9795,9799,14,9812,9822,14,9824,9824,14,9827,9827,14,9829,9830,14,9832,9832,14,9851,9851,14,9854,9854,14,9856,9861,14,9874,9874,14,9876,9876,14,9878,9879,14,9881,9881,14,9883,9884,14,9888,9889,14,9895,9895,14,9898,9899,14,9904,9905,14,9917,9918,14,9924,9925,14,9928,9928,14,9934,9934,14,9936,9936,14,9938,9938,14,9940,9940,14,9961,9961,14,9963,9967,14,9970,9971,14,9973,9973,14,9975,9977,14,9979,9980,14,9982,9985,14,9987,9988,14,9992,9996,14,9998,9998,14,10000,10001,14,10004,10004,14,10013,10013,14,10024,10024,14,10052,10052,14,10060,10060,14,10067,10069,14,10083,10083,14,10085,10087,14,10145,10145,14,10175,10175,14,11013,11015,14,11088,11088,14,11503,11505,5,11744,11775,5,12334,12335,5,12349,12349,14,12951,12951,14,42607,42607,5,42612,42621,5,42736,42737,5,43014,43014,5,43043,43044,7,43047,43047,7,43136,43137,7,43204,43205,5,43263,43263,5,43335,43345,5,43360,43388,8,43395,43395,7,43444,43445,7,43450,43451,7,43454,43456,7,43561,43566,5,43569,43570,5,43573,43574,5,43596,43596,5,43644,43644,5,43698,43700,5,43710,43711,5,43755,43755,7,43758,43759,7,43766,43766,5,44005,44005,5,44008,44008,5,44012,44012,7,44032,44032,11,44060,44060,11,44088,44088,11,44116,44116,11,44144,44144,11,44172,44172,11,44200,44200,11,44228,44228,11,44256,44256,11,44284,44284,11,44312,44312,11,44340,44340,11,44368,44368,11,44396,44396,11,44424,44424,11,44452,44452,11,44480,44480,11,44508,44508,11,44536,44536,11,44564,44564,11,44592,44592,11,44620,44620,11,44648,44648,11,44676,44676,11,44704,44704,11,44732,44732,11,44760,44760,11,44788,44788,11,44816,44816,11,44844,44844,11,44872,44872,11,44900,44900,11,44928,44928,11,44956,44956,11,44984,44984,11,45012,45012,11,45040,45040,11,45068,45068,11,45096,45096,11,45124,45124,11,45152,45152,11,45180,45180,11,45208,45208,11,45236,45236,11,45264,45264,11,45292,45292,11,45320,45320,11,45348,45348,11,45376,45376,11,45404,45404,11,45432,45432,11,45460,45460,11,45488,45488,11,45516,45516,11,45544,45544,11,45572,45572,11,45600,45600,11,45628,45628,11,45656,45656,11,45684,45684,11,45712,45712,11,45740,45740,11,45768,45768,11,45796,45796,11,45824,45824,11,45852,45852,11,45880,45880,11,45908,45908,11,45936,45936,11,45964,45964,11,45992,45992,11,46020,46020,11,46048,46048,11,46076,46076,11,46104,46104,11,46132,46132,11,46160,46160,11,46188,46188,11,46216,46216,11,46244,46244,11,46272,46272,11,46300,46300,11,46328,46328,11,46356,46356,11,46384,46384,11,46412,46412,11,46440,46440,11,46468,46468,11,46496,46496,11,46524,46524,11,46552,46552,11,46580,46580,11,46608,46608,11,46636,46636,11,46664,46664,11,46692,46692,11,46720,46720,11,46748,46748,11,46776,46776,11,46804,46804,11,46832,46832,11,46860,46860,11,46888,46888,11,46916,46916,11,46944,46944,11,46972,46972,11,47000,47000,11,47028,47028,11,47056,47056,11,47084,47084,11,47112,47112,11,47140,47140,11,47168,47168,11,47196,47196,11,47224,47224,11,47252,47252,11,47280,47280,11,47308,47308,11,47336,47336,11,47364,47364,11,47392,47392,11,47420,47420,11,47448,47448,11,47476,47476,11,47504,47504,11,47532,47532,11,47560,47560,11,47588,47588,11,47616,47616,11,47644,47644,11,47672,47672,11,47700,47700,11,47728,47728,11,47756,47756,11,47784,47784,11,47812,47812,11,47840,47840,11,47868,47868,11,47896,47896,11,47924,47924,11,47952,47952,11,47980,47980,11,48008,48008,11,48036,48036,11,48064,48064,11,48092,48092,11,48120,48120,11,48148,48148,11,48176,48176,11,48204,48204,11,48232,48232,11,48260,48260,11,48288,48288,11,48316,48316,11,48344,48344,11,48372,48372,11,48400,48400,11,48428,48428,11,48456,48456,11,48484,48484,11,48512,48512,11,48540,48540,11,48568,48568,11,48596,48596,11,48624,48624,11,48652,48652,11,48680,48680,11,48708,48708,11,48736,48736,11,48764,48764,11,48792,48792,11,48820,48820,11,48848,48848,11,48876,48876,11,48904,48904,11,48932,48932,11,48960,48960,11,48988,48988,11,49016,49016,11,49044,49044,11,49072,49072,11,49100,49100,11,49128,49128,11,49156,49156,11,49184,49184,11,49212,49212,11,49240,49240,11,49268,49268,11,49296,49296,11,49324,49324,11,49352,49352,11,49380,49380,11,49408,49408,11,49436,49436,11,49464,49464,11,49492,49492,11,49520,49520,11,49548,49548,11,49576,49576,11,49604,49604,11,49632,49632,11,49660,49660,11,49688,49688,11,49716,49716,11,49744,49744,11,49772,49772,11,49800,49800,11,49828,49828,11,49856,49856,11,49884,49884,11,49912,49912,11,49940,49940,11,49968,49968,11,49996,49996,11,50024,50024,11,50052,50052,11,50080,50080,11,50108,50108,11,50136,50136,11,50164,50164,11,50192,50192,11,50220,50220,11,50248,50248,11,50276,50276,11,50304,50304,11,50332,50332,11,50360,50360,11,50388,50388,11,50416,50416,11,50444,50444,11,50472,50472,11,50500,50500,11,50528,50528,11,50556,50556,11,50584,50584,11,50612,50612,11,50640,50640,11,50668,50668,11,50696,50696,11,50724,50724,11,50752,50752,11,50780,50780,11,50808,50808,11,50836,50836,11,50864,50864,11,50892,50892,11,50920,50920,11,50948,50948,11,50976,50976,11,51004,51004,11,51032,51032,11,51060,51060,11,51088,51088,11,51116,51116,11,51144,51144,11,51172,51172,11,51200,51200,11,51228,51228,11,51256,51256,11,51284,51284,11,51312,51312,11,51340,51340,11,51368,51368,11,51396,51396,11,51424,51424,11,51452,51452,11,51480,51480,11,51508,51508,11,51536,51536,11,51564,51564,11,51592,51592,11,51620,51620,11,51648,51648,11,51676,51676,11,51704,51704,11,51732,51732,11,51760,51760,11,51788,51788,11,51816,51816,11,51844,51844,11,51872,51872,11,51900,51900,11,51928,51928,11,51956,51956,11,51984,51984,11,52012,52012,11,52040,52040,11,52068,52068,11,52096,52096,11,52124,52124,11,52152,52152,11,52180,52180,11,52208,52208,11,52236,52236,11,52264,52264,11,52292,52292,11,52320,52320,11,52348,52348,11,52376,52376,11,52404,52404,11,52432,52432,11,52460,52460,11,52488,52488,11,52516,52516,11,52544,52544,11,52572,52572,11,52600,52600,11,52628,52628,11,52656,52656,11,52684,52684,11,52712,52712,11,52740,52740,11,52768,52768,11,52796,52796,11,52824,52824,11,52852,52852,11,52880,52880,11,52908,52908,11,52936,52936,11,52964,52964,11,52992,52992,11,53020,53020,11,53048,53048,11,53076,53076,11,53104,53104,11,53132,53132,11,53160,53160,11,53188,53188,11,53216,53216,11,53244,53244,11,53272,53272,11,53300,53300,11,53328,53328,11,53356,53356,11,53384,53384,11,53412,53412,11,53440,53440,11,53468,53468,11,53496,53496,11,53524,53524,11,53552,53552,11,53580,53580,11,53608,53608,11,53636,53636,11,53664,53664,11,53692,53692,11,53720,53720,11,53748,53748,11,53776,53776,11,53804,53804,11,53832,53832,11,53860,53860,11,53888,53888,11,53916,53916,11,53944,53944,11,53972,53972,11,54000,54000,11,54028,54028,11,54056,54056,11,54084,54084,11,54112,54112,11,54140,54140,11,54168,54168,11,54196,54196,11,54224,54224,11,54252,54252,11,54280,54280,11,54308,54308,11,54336,54336,11,54364,54364,11,54392,54392,11,54420,54420,11,54448,54448,11,54476,54476,11,54504,54504,11,54532,54532,11,54560,54560,11,54588,54588,11,54616,54616,11,54644,54644,11,54672,54672,11,54700,54700,11,54728,54728,11,54756,54756,11,54784,54784,11,54812,54812,11,54840,54840,11,54868,54868,11,54896,54896,11,54924,54924,11,54952,54952,11,54980,54980,11,55008,55008,11,55036,55036,11,55064,55064,11,55092,55092,11,55120,55120,11,55148,55148,11,55176,55176,11,55216,55238,9,64286,64286,5,65056,65071,5,65438,65439,5,65529,65531,4,66272,66272,5,68097,68099,5,68108,68111,5,68159,68159,5,68900,68903,5,69446,69456,5,69632,69632,7,69634,69634,7,69744,69744,5,69759,69761,5,69808,69810,7,69815,69816,7,69821,69821,1,69837,69837,1,69927,69931,5,69933,69940,5,70003,70003,5,70018,70018,7,70070,70078,5,70082,70083,1,70094,70094,7,70188,70190,7,70194,70195,7,70197,70197,7,70206,70206,5,70368,70370,7,70400,70401,5,70459,70460,5,70463,70463,7,70465,70468,7,70475,70477,7,70498,70499,7,70512,70516,5,70712,70719,5,70722,70724,5,70726,70726,5,70832,70832,5,70835,70840,5,70842,70842,5,70845,70845,5,70847,70848,5,70850,70851,5,71088,71089,7,71096,71099,7,71102,71102,7,71132,71133,5,71219,71226,5,71229,71229,5,71231,71232,5,71340,71340,7,71342,71343,7,71350,71350,7,71453,71455,5,71462,71462,7,71724,71726,7,71736,71736,7,71984,71984,5,71991,71992,7,71997,71997,7,71999,71999,1,72001,72001,1,72003,72003,5,72148,72151,5,72156,72159,7,72164,72164,7,72243,72248,5,72250,72250,1,72263,72263,5,72279,72280,7,72324,72329,1,72343,72343,7,72751,72751,7,72760,72765,5,72767,72767,5,72873,72873,7,72881,72881,7,72884,72884,7,73009,73014,5,73020,73021,5,73030,73030,1,73098,73102,7,73107,73108,7,73110,73110,7,73459,73460,5,78896,78904,4,92976,92982,5,94033,94087,7,94180,94180,5,113821,113822,5,118528,118573,5,119141,119141,5,119143,119145,5,119150,119154,5,119163,119170,5,119210,119213,5,121344,121398,5,121461,121461,5,121499,121503,5,122880,122886,5,122907,122913,5,122918,122922,5,123566,123566,5,125136,125142,5,126976,126979,14,126981,127182,14,127184,127231,14,127279,127279,14,127344,127345,14,127374,127374,14,127405,127461,14,127489,127490,14,127514,127514,14,127538,127546,14,127561,127567,14,127570,127743,14,127757,127758,14,127760,127760,14,127762,127762,14,127766,127768,14,127770,127770,14,127772,127772,14,127775,127776,14,127778,127779,14,127789,127791,14,127794,127795,14,127798,127798,14,127819,127819,14,127824,127824,14,127868,127868,14,127870,127871,14,127892,127893,14,127896,127896,14,127900,127901,14,127904,127940,14,127942,127942,14,127944,127944,14,127946,127946,14,127951,127955,14,127968,127971,14,127973,127984,14,127987,127987,14,127989,127989,14,127991,127991,14,127995,127999,5,128008,128008,14,128012,128014,14,128017,128018,14,128020,128020,14,128022,128022,14,128042,128042,14,128063,128063,14,128065,128065,14,128101,128101,14,128108,128109,14,128173,128173,14,128182,128183,14,128236,128237,14,128239,128239,14,128245,128245,14,128248,128248,14,128253,128253,14,128255,128258,14,128260,128263,14,128265,128265,14,128277,128277,14,128300,128301,14,128326,128328,14,128331,128334,14,128336,128347,14,128360,128366,14,128369,128370,14,128378,128378,14,128391,128391,14,128394,128397,14,128400,128400,14,128405,128406,14,128420,128420,14,128422,128423,14,128425,128432,14,128435,128443,14,128445,128449,14,128453,128464,14,128468,128475,14,128479,128480,14,128482,128482,14,128484,128487,14,128489,128494,14,128496,128498,14,128500,128505,14,128507,128511,14,128513,128518,14,128521,128525,14,128527,128527,14,128529,128529,14,128533,128533,14,128535,128535,14,128537,128537,14]");
}
var AmbiguousCharacters = class _AmbiguousCharacters {
  constructor(confusableDictionary) {
    this.confusableDictionary = confusableDictionary;
  }
  static {
    this.ambiguousCharacterData = new Lazy(() => {
      return JSON.parse(
        '{"_common":[8232,32,8233,32,5760,32,8192,32,8193,32,8194,32,8195,32,8196,32,8197,32,8198,32,8200,32,8201,32,8202,32,8287,32,8199,32,8239,32,2042,95,65101,95,65102,95,65103,95,8208,45,8209,45,8210,45,65112,45,1748,45,8259,45,727,45,8722,45,10134,45,11450,45,1549,44,1643,44,184,44,42233,44,894,59,2307,58,2691,58,1417,58,1795,58,1796,58,5868,58,65072,58,6147,58,6153,58,8282,58,1475,58,760,58,42889,58,8758,58,720,58,42237,58,451,33,11601,33,660,63,577,63,2429,63,5038,63,42731,63,119149,46,8228,46,1793,46,1794,46,42510,46,68176,46,1632,46,1776,46,42232,46,1373,96,65287,96,8219,96,1523,96,8242,96,1370,96,8175,96,65344,96,900,96,8189,96,8125,96,8127,96,8190,96,697,96,884,96,712,96,714,96,715,96,756,96,699,96,701,96,700,96,702,96,42892,96,1497,96,2036,96,2037,96,5194,96,5836,96,94033,96,94034,96,65339,91,10088,40,10098,40,12308,40,64830,40,65341,93,10089,41,10099,41,12309,41,64831,41,10100,123,119060,123,10101,125,65342,94,8270,42,1645,42,8727,42,66335,42,5941,47,8257,47,8725,47,8260,47,9585,47,10187,47,10744,47,119354,47,12755,47,12339,47,11462,47,20031,47,12035,47,65340,92,65128,92,8726,92,10189,92,10741,92,10745,92,119311,92,119355,92,12756,92,20022,92,12034,92,42872,38,708,94,710,94,5869,43,10133,43,66203,43,8249,60,10094,60,706,60,119350,60,5176,60,5810,60,5120,61,11840,61,12448,61,42239,61,8250,62,10095,62,707,62,119351,62,5171,62,94015,62,8275,126,732,126,8128,126,8764,126,65372,124,65293,45,118002,50,120784,50,120794,50,120804,50,120814,50,120824,50,130034,50,42842,50,423,50,1000,50,42564,50,5311,50,42735,50,119302,51,118003,51,120785,51,120795,51,120805,51,120815,51,120825,51,130035,51,42923,51,540,51,439,51,42858,51,11468,51,1248,51,94011,51,71882,51,118004,52,120786,52,120796,52,120806,52,120816,52,120826,52,130036,52,5070,52,71855,52,118005,53,120787,53,120797,53,120807,53,120817,53,120827,53,130037,53,444,53,71867,53,118006,54,120788,54,120798,54,120808,54,120818,54,120828,54,130038,54,11474,54,5102,54,71893,54,119314,55,118007,55,120789,55,120799,55,120809,55,120819,55,120829,55,130039,55,66770,55,71878,55,2819,56,2538,56,2666,56,125131,56,118008,56,120790,56,120800,56,120810,56,120820,56,120830,56,130040,56,547,56,546,56,66330,56,2663,57,2920,57,2541,57,3437,57,118009,57,120791,57,120801,57,120811,57,120821,57,120831,57,130041,57,42862,57,11466,57,71884,57,71852,57,71894,57,9082,97,65345,97,119834,97,119886,97,119938,97,119990,97,120042,97,120094,97,120146,97,120198,97,120250,97,120302,97,120354,97,120406,97,120458,97,593,97,945,97,120514,97,120572,97,120630,97,120688,97,120746,97,65313,65,117974,65,119808,65,119860,65,119912,65,119964,65,120016,65,120068,65,120120,65,120172,65,120224,65,120276,65,120328,65,120380,65,120432,65,913,65,120488,65,120546,65,120604,65,120662,65,120720,65,5034,65,5573,65,42222,65,94016,65,66208,65,119835,98,119887,98,119939,98,119991,98,120043,98,120095,98,120147,98,120199,98,120251,98,120303,98,120355,98,120407,98,120459,98,388,98,5071,98,5234,98,5551,98,65314,66,8492,66,117975,66,119809,66,119861,66,119913,66,120017,66,120069,66,120121,66,120173,66,120225,66,120277,66,120329,66,120381,66,120433,66,42932,66,914,66,120489,66,120547,66,120605,66,120663,66,120721,66,5108,66,5623,66,42192,66,66178,66,66209,66,66305,66,65347,99,8573,99,119836,99,119888,99,119940,99,119992,99,120044,99,120096,99,120148,99,120200,99,120252,99,120304,99,120356,99,120408,99,120460,99,7428,99,1010,99,11429,99,43951,99,66621,99,128844,67,71913,67,71922,67,65315,67,8557,67,8450,67,8493,67,117976,67,119810,67,119862,67,119914,67,119966,67,120018,67,120174,67,120226,67,120278,67,120330,67,120382,67,120434,67,1017,67,11428,67,5087,67,42202,67,66210,67,66306,67,66581,67,66844,67,8574,100,8518,100,119837,100,119889,100,119941,100,119993,100,120045,100,120097,100,120149,100,120201,100,120253,100,120305,100,120357,100,120409,100,120461,100,1281,100,5095,100,5231,100,42194,100,8558,68,8517,68,117977,68,119811,68,119863,68,119915,68,119967,68,120019,68,120071,68,120123,68,120175,68,120227,68,120279,68,120331,68,120383,68,120435,68,5024,68,5598,68,5610,68,42195,68,8494,101,65349,101,8495,101,8519,101,119838,101,119890,101,119942,101,120046,101,120098,101,120150,101,120202,101,120254,101,120306,101,120358,101,120410,101,120462,101,43826,101,1213,101,8959,69,65317,69,8496,69,117978,69,119812,69,119864,69,119916,69,120020,69,120072,69,120124,69,120176,69,120228,69,120280,69,120332,69,120384,69,120436,69,917,69,120492,69,120550,69,120608,69,120666,69,120724,69,11577,69,5036,69,42224,69,71846,69,71854,69,66182,69,119839,102,119891,102,119943,102,119995,102,120047,102,120099,102,120151,102,120203,102,120255,102,120307,102,120359,102,120411,102,120463,102,43829,102,42905,102,383,102,7837,102,1412,102,119315,70,8497,70,117979,70,119813,70,119865,70,119917,70,120021,70,120073,70,120125,70,120177,70,120229,70,120281,70,120333,70,120385,70,120437,70,42904,70,988,70,120778,70,5556,70,42205,70,71874,70,71842,70,66183,70,66213,70,66853,70,65351,103,8458,103,119840,103,119892,103,119944,103,120048,103,120100,103,120152,103,120204,103,120256,103,120308,103,120360,103,120412,103,120464,103,609,103,7555,103,397,103,1409,103,117980,71,119814,71,119866,71,119918,71,119970,71,120022,71,120074,71,120126,71,120178,71,120230,71,120282,71,120334,71,120386,71,120438,71,1292,71,5056,71,5107,71,42198,71,65352,104,8462,104,119841,104,119945,104,119997,104,120049,104,120101,104,120153,104,120205,104,120257,104,120309,104,120361,104,120413,104,120465,104,1211,104,1392,104,5058,104,65320,72,8459,72,8460,72,8461,72,117981,72,119815,72,119867,72,119919,72,120023,72,120179,72,120231,72,120283,72,120335,72,120387,72,120439,72,919,72,120494,72,120552,72,120610,72,120668,72,120726,72,11406,72,5051,72,5500,72,42215,72,66255,72,731,105,9075,105,65353,105,8560,105,8505,105,8520,105,119842,105,119894,105,119946,105,119998,105,120050,105,120102,105,120154,105,120206,105,120258,105,120310,105,120362,105,120414,105,120466,105,120484,105,618,105,617,105,953,105,8126,105,890,105,120522,105,120580,105,120638,105,120696,105,120754,105,1110,105,42567,105,1231,105,43893,105,5029,105,71875,105,65354,106,8521,106,119843,106,119895,106,119947,106,119999,106,120051,106,120103,106,120155,106,120207,106,120259,106,120311,106,120363,106,120415,106,120467,106,1011,106,1112,106,65322,74,117983,74,119817,74,119869,74,119921,74,119973,74,120025,74,120077,74,120129,74,120181,74,120233,74,120285,74,120337,74,120389,74,120441,74,42930,74,895,74,1032,74,5035,74,5261,74,42201,74,119844,107,119896,107,119948,107,120000,107,120052,107,120104,107,120156,107,120208,107,120260,107,120312,107,120364,107,120416,107,120468,107,8490,75,65323,75,117984,75,119818,75,119870,75,119922,75,119974,75,120026,75,120078,75,120130,75,120182,75,120234,75,120286,75,120338,75,120390,75,120442,75,922,75,120497,75,120555,75,120613,75,120671,75,120729,75,11412,75,5094,75,5845,75,42199,75,66840,75,1472,108,8739,73,9213,73,65512,73,1633,108,1777,73,66336,108,125127,108,118001,108,120783,73,120793,73,120803,73,120813,73,120823,73,130033,73,65321,73,8544,73,8464,73,8465,73,117982,108,119816,73,119868,73,119920,73,120024,73,120128,73,120180,73,120232,73,120284,73,120336,73,120388,73,120440,73,65356,108,8572,73,8467,108,119845,108,119897,108,119949,108,120001,108,120053,108,120105,73,120157,73,120209,73,120261,73,120313,73,120365,73,120417,73,120469,73,448,73,120496,73,120554,73,120612,73,120670,73,120728,73,11410,73,1030,73,1216,73,1493,108,1503,108,1575,108,126464,108,126592,108,65166,108,65165,108,1994,108,11599,73,5825,73,42226,73,93992,73,66186,124,66313,124,119338,76,8556,76,8466,76,117985,76,119819,76,119871,76,119923,76,120027,76,120079,76,120131,76,120183,76,120235,76,120287,76,120339,76,120391,76,120443,76,11472,76,5086,76,5290,76,42209,76,93974,76,71843,76,71858,76,66587,76,66854,76,65325,77,8559,77,8499,77,117986,77,119820,77,119872,77,119924,77,120028,77,120080,77,120132,77,120184,77,120236,77,120288,77,120340,77,120392,77,120444,77,924,77,120499,77,120557,77,120615,77,120673,77,120731,77,1018,77,11416,77,5047,77,5616,77,5846,77,42207,77,66224,77,66321,77,119847,110,119899,110,119951,110,120003,110,120055,110,120107,110,120159,110,120211,110,120263,110,120315,110,120367,110,120419,110,120471,110,1400,110,1404,110,65326,78,8469,78,117987,78,119821,78,119873,78,119925,78,119977,78,120029,78,120081,78,120185,78,120237,78,120289,78,120341,78,120393,78,120445,78,925,78,120500,78,120558,78,120616,78,120674,78,120732,78,11418,78,42208,78,66835,78,3074,111,3202,111,3330,111,3458,111,2406,111,2662,111,2790,111,3046,111,3174,111,3302,111,3430,111,3664,111,3792,111,4160,111,1637,111,1781,111,65359,111,8500,111,119848,111,119900,111,119952,111,120056,111,120108,111,120160,111,120212,111,120264,111,120316,111,120368,111,120420,111,120472,111,7439,111,7441,111,43837,111,959,111,120528,111,120586,111,120644,111,120702,111,120760,111,963,111,120532,111,120590,111,120648,111,120706,111,120764,111,11423,111,4351,111,1413,111,1505,111,1607,111,126500,111,126564,111,126596,111,65259,111,65260,111,65258,111,65257,111,1726,111,64428,111,64429,111,64427,111,64426,111,1729,111,64424,111,64425,111,64423,111,64422,111,1749,111,3360,111,4125,111,66794,111,71880,111,71895,111,66604,111,1984,79,2534,79,2918,79,12295,79,70864,79,71904,79,118000,79,120782,79,120792,79,120802,79,120812,79,120822,79,130032,79,65327,79,117988,79,119822,79,119874,79,119926,79,119978,79,120030,79,120082,79,120134,79,120186,79,120238,79,120290,79,120342,79,120394,79,120446,79,927,79,120502,79,120560,79,120618,79,120676,79,120734,79,11422,79,1365,79,11604,79,4816,79,2848,79,66754,79,42227,79,71861,79,66194,79,66219,79,66564,79,66838,79,9076,112,65360,112,119849,112,119901,112,119953,112,120005,112,120057,112,120109,112,120161,112,120213,112,120265,112,120317,112,120369,112,120421,112,120473,112,961,112,120530,112,120544,112,120588,112,120602,112,120646,112,120660,112,120704,112,120718,112,120762,112,120776,112,11427,112,65328,80,8473,80,117989,80,119823,80,119875,80,119927,80,119979,80,120031,80,120083,80,120187,80,120239,80,120291,80,120343,80,120395,80,120447,80,929,80,120504,80,120562,80,120620,80,120678,80,120736,80,11426,80,5090,80,5229,80,42193,80,66197,80,119850,113,119902,113,119954,113,120006,113,120058,113,120110,113,120162,113,120214,113,120266,113,120318,113,120370,113,120422,113,120474,113,1307,113,1379,113,1382,113,8474,81,117990,81,119824,81,119876,81,119928,81,119980,81,120032,81,120084,81,120188,81,120240,81,120292,81,120344,81,120396,81,120448,81,11605,81,119851,114,119903,114,119955,114,120007,114,120059,114,120111,114,120163,114,120215,114,120267,114,120319,114,120371,114,120423,114,120475,114,43847,114,43848,114,7462,114,11397,114,43905,114,119318,82,8475,82,8476,82,8477,82,117991,82,119825,82,119877,82,119929,82,120033,82,120189,82,120241,82,120293,82,120345,82,120397,82,120449,82,422,82,5025,82,5074,82,66740,82,5511,82,42211,82,94005,82,65363,115,119852,115,119904,115,119956,115,120008,115,120060,115,120112,115,120164,115,120216,115,120268,115,120320,115,120372,115,120424,115,120476,115,42801,115,445,115,1109,115,43946,115,71873,115,66632,115,65331,83,117992,83,119826,83,119878,83,119930,83,119982,83,120034,83,120086,83,120138,83,120190,83,120242,83,120294,83,120346,83,120398,83,120450,83,1029,83,1359,83,5077,83,5082,83,42210,83,94010,83,66198,83,66592,83,119853,116,119905,116,119957,116,120009,116,120061,116,120113,116,120165,116,120217,116,120269,116,120321,116,120373,116,120425,116,120477,116,8868,84,10201,84,128872,84,65332,84,117993,84,119827,84,119879,84,119931,84,119983,84,120035,84,120087,84,120139,84,120191,84,120243,84,120295,84,120347,84,120399,84,120451,84,932,84,120507,84,120565,84,120623,84,120681,84,120739,84,11430,84,5026,84,42196,84,93962,84,71868,84,66199,84,66225,84,66325,84,119854,117,119906,117,119958,117,120010,117,120062,117,120114,117,120166,117,120218,117,120270,117,120322,117,120374,117,120426,117,120478,117,42911,117,7452,117,43854,117,43858,117,651,117,965,117,120534,117,120592,117,120650,117,120708,117,120766,117,1405,117,66806,117,71896,117,8746,85,8899,85,117994,85,119828,85,119880,85,119932,85,119984,85,120036,85,120088,85,120140,85,120192,85,120244,85,120296,85,120348,85,120400,85,120452,85,1357,85,4608,85,66766,85,5196,85,42228,85,94018,85,71864,85,8744,118,8897,118,65366,118,8564,118,119855,118,119907,118,119959,118,120011,118,120063,118,120115,118,120167,118,120219,118,120271,118,120323,118,120375,118,120427,118,120479,118,7456,118,957,118,120526,118,120584,118,120642,118,120700,118,120758,118,1141,118,1496,118,71430,118,43945,118,71872,118,119309,86,1639,86,1783,86,8548,86,117995,86,119829,86,119881,86,119933,86,119985,86,120037,86,120089,86,120141,86,120193,86,120245,86,120297,86,120349,86,120401,86,120453,86,1140,86,11576,86,5081,86,5167,86,42719,86,42214,86,93960,86,71840,86,66845,86,623,119,119856,119,119908,119,119960,119,120012,119,120064,119,120116,119,120168,119,120220,119,120272,119,120324,119,120376,119,120428,119,120480,119,7457,119,1121,119,1309,119,1377,119,71434,119,71438,119,71439,119,43907,119,71910,87,71919,87,117996,87,119830,87,119882,87,119934,87,119986,87,120038,87,120090,87,120142,87,120194,87,120246,87,120298,87,120350,87,120402,87,120454,87,1308,87,5043,87,5076,87,42218,87,5742,120,10539,120,10540,120,10799,120,65368,120,8569,120,119857,120,119909,120,119961,120,120013,120,120065,120,120117,120,120169,120,120221,120,120273,120,120325,120,120377,120,120429,120,120481,120,5441,120,5501,120,5741,88,9587,88,66338,88,71916,88,65336,88,8553,88,117997,88,119831,88,119883,88,119935,88,119987,88,120039,88,120091,88,120143,88,120195,88,120247,88,120299,88,120351,88,120403,88,120455,88,42931,88,935,88,120510,88,120568,88,120626,88,120684,88,120742,88,11436,88,11613,88,5815,88,42219,88,66192,88,66228,88,66327,88,66855,88,611,121,7564,121,65369,121,119858,121,119910,121,119962,121,120014,121,120066,121,120118,121,120170,121,120222,121,120274,121,120326,121,120378,121,120430,121,120482,121,655,121,7935,121,43866,121,947,121,8509,121,120516,121,120574,121,120632,121,120690,121,120748,121,1199,121,4327,121,71900,121,65337,89,117998,89,119832,89,119884,89,119936,89,119988,89,120040,89,120092,89,120144,89,120196,89,120248,89,120300,89,120352,89,120404,89,120456,89,933,89,978,89,120508,89,120566,89,120624,89,120682,89,120740,89,11432,89,1198,89,5033,89,5053,89,42220,89,94019,89,71844,89,66226,89,119859,122,119911,122,119963,122,120015,122,120067,122,120119,122,120171,122,120223,122,120275,122,120327,122,120379,122,120431,122,120483,122,7458,122,43923,122,71876,122,71909,90,66293,90,65338,90,8484,90,8488,90,117999,90,119833,90,119885,90,119937,90,119989,90,120041,90,120197,90,120249,90,120301,90,120353,90,120405,90,120457,90,918,90,120493,90,120551,90,120609,90,120667,90,120725,90,5059,90,42204,90,71849,90,65282,34,65283,35,65284,36,65285,37,65286,38,65290,42,65291,43,65294,46,65295,47,65296,48,65298,50,65299,51,65300,52,65301,53,65302,54,65303,55,65304,56,65305,57,65308,60,65309,61,65310,62,65312,64,65316,68,65318,70,65319,71,65324,76,65329,81,65330,82,65333,85,65334,86,65335,87,65343,95,65346,98,65348,100,65350,102,65355,107,65357,109,65358,110,65361,113,65362,114,65364,116,65365,117,65367,119,65370,122,65371,123,65373,125,119846,109],"_default":[160,32,8211,45,65374,126,8218,44,65306,58,65281,33,8216,96,8217,96,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"cs":[65374,126,8218,44,65306,58,65281,33,8216,96,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"de":[65374,126,65306,58,65281,33,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"es":[8211,45,65374,126,8218,44,65306,58,65281,33,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"fr":[65374,126,8218,44,65306,58,65281,33,8216,96,8245,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"it":[160,32,8211,45,65374,126,8218,44,65306,58,65281,33,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"ja":[8211,45,8218,44,65281,33,8216,96,8245,96,180,96,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65292,44,65297,49,65307,59],"ko":[8211,45,65374,126,8218,44,65306,58,65281,33,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"pl":[65374,126,65306,58,65281,33,8216,96,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"pt-BR":[65374,126,8218,44,65306,58,65281,33,8216,96,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"qps-ploc":[160,32,8211,45,65374,126,8218,44,65306,58,65281,33,8216,96,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"ru":[65374,126,8218,44,65306,58,65281,33,8216,96,8245,96,180,96,12494,47,305,105,921,73,1009,112,215,120,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"tr":[160,32,8211,45,65374,126,8218,44,65306,58,65281,33,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65288,40,65289,41,65292,44,65297,49,65307,59,65311,63],"zh-hans":[160,32,65374,126,8218,44,8245,96,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89,65297,49],"zh-hant":[8211,45,65374,126,8218,44,180,96,12494,47,1047,51,1073,54,1072,97,1040,65,1068,98,1042,66,1089,99,1057,67,1077,101,1045,69,1053,72,305,105,1050,75,921,73,1052,77,1086,111,1054,79,1009,112,1088,112,1056,80,1075,114,1058,84,215,120,1093,120,1061,88,1091,121,1059,89]}'
      );
    });
  }
  static {
    this.cache = new LRUCachedFunction((localesStr) => {
      const locales = localesStr.split(",");
      function arrayToMap(arr) {
        const result = /* @__PURE__ */ new Map();
        for (let i = 0; i < arr.length; i += 2) {
          result.set(arr[i], arr[i + 1]);
        }
        return result;
      }
      function mergeMaps(map1, map2) {
        const result = new Map(map1);
        for (const [key, value] of map2) {
          result.set(key, value);
        }
        return result;
      }
      function intersectMaps(map1, map2) {
        if (!map1) {
          return map2;
        }
        const result = /* @__PURE__ */ new Map();
        for (const [key, value] of map1) {
          if (map2.has(key)) {
            result.set(key, value);
          }
        }
        return result;
      }
      const data = this.ambiguousCharacterData.value;
      let filteredLocales = locales.filter(
        (l) => !l.startsWith("_") && Object.hasOwn(data, l)
      );
      if (filteredLocales.length === 0) {
        filteredLocales = ["_default"];
      }
      let languageSpecificMap = void 0;
      for (const locale of filteredLocales) {
        const map2 = arrayToMap(data[locale]);
        languageSpecificMap = intersectMaps(languageSpecificMap, map2);
      }
      const commonMap = arrayToMap(data["_common"]);
      const map = mergeMaps(commonMap, languageSpecificMap);
      return new _AmbiguousCharacters(map);
    });
  }
  static getInstance(locales) {
    return _AmbiguousCharacters.cache.get(Array.from(locales).join(","));
  }
  static {
    this._locales = new Lazy(
      () => Object.keys(_AmbiguousCharacters.ambiguousCharacterData.value).filter(
        (k) => !k.startsWith("_")
      )
    );
  }
  static getLocales() {
    return _AmbiguousCharacters._locales.value;
  }
  isAmbiguous(codePoint) {
    return this.confusableDictionary.has(codePoint);
  }
  containsAmbiguousCharacter(str) {
    for (let i = 0; i < str.length; i++) {
      const codePoint = str.codePointAt(i);
      if (typeof codePoint === "number" && this.isAmbiguous(codePoint)) {
        return true;
      }
    }
    return false;
  }
  /**
   * Returns the non basic ASCII code point that the given code point can be confused,
   * or undefined if such code point does note exist.
   */
  getPrimaryConfusable(codePoint) {
    return this.confusableDictionary.get(codePoint);
  }
  getConfusableCodePoints() {
    return new Set(this.confusableDictionary.keys());
  }
};
var InvisibleCharacters = class _InvisibleCharacters {
  static getRawData() {
    return JSON.parse('{"_common":[11,12,13,127,847,1564,4447,4448,6068,6069,6155,6156,6157,6158,7355,7356,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8204,8205,8206,8207,8234,8235,8236,8237,8238,8239,8287,8288,8289,8290,8291,8292,8293,8294,8295,8296,8297,8298,8299,8300,8301,8302,8303,10240,12644,65024,65025,65026,65027,65028,65029,65030,65031,65032,65033,65034,65035,65036,65037,65038,65039,65279,65440,65520,65521,65522,65523,65524,65525,65526,65527,65528,65532,78844,119155,119156,119157,119158,119159,119160,119161,119162,917504,917505,917506,917507,917508,917509,917510,917511,917512,917513,917514,917515,917516,917517,917518,917519,917520,917521,917522,917523,917524,917525,917526,917527,917528,917529,917530,917531,917532,917533,917534,917535,917536,917537,917538,917539,917540,917541,917542,917543,917544,917545,917546,917547,917548,917549,917550,917551,917552,917553,917554,917555,917556,917557,917558,917559,917560,917561,917562,917563,917564,917565,917566,917567,917568,917569,917570,917571,917572,917573,917574,917575,917576,917577,917578,917579,917580,917581,917582,917583,917584,917585,917586,917587,917588,917589,917590,917591,917592,917593,917594,917595,917596,917597,917598,917599,917600,917601,917602,917603,917604,917605,917606,917607,917608,917609,917610,917611,917612,917613,917614,917615,917616,917617,917618,917619,917620,917621,917622,917623,917624,917625,917626,917627,917628,917629,917630,917631,917760,917761,917762,917763,917764,917765,917766,917767,917768,917769,917770,917771,917772,917773,917774,917775,917776,917777,917778,917779,917780,917781,917782,917783,917784,917785,917786,917787,917788,917789,917790,917791,917792,917793,917794,917795,917796,917797,917798,917799,917800,917801,917802,917803,917804,917805,917806,917807,917808,917809,917810,917811,917812,917813,917814,917815,917816,917817,917818,917819,917820,917821,917822,917823,917824,917825,917826,917827,917828,917829,917830,917831,917832,917833,917834,917835,917836,917837,917838,917839,917840,917841,917842,917843,917844,917845,917846,917847,917848,917849,917850,917851,917852,917853,917854,917855,917856,917857,917858,917859,917860,917861,917862,917863,917864,917865,917866,917867,917868,917869,917870,917871,917872,917873,917874,917875,917876,917877,917878,917879,917880,917881,917882,917883,917884,917885,917886,917887,917888,917889,917890,917891,917892,917893,917894,917895,917896,917897,917898,917899,917900,917901,917902,917903,917904,917905,917906,917907,917908,917909,917910,917911,917912,917913,917914,917915,917916,917917,917918,917919,917920,917921,917922,917923,917924,917925,917926,917927,917928,917929,917930,917931,917932,917933,917934,917935,917936,917937,917938,917939,917940,917941,917942,917943,917944,917945,917946,917947,917948,917949,917950,917951,917952,917953,917954,917955,917956,917957,917958,917959,917960,917961,917962,917963,917964,917965,917966,917967,917968,917969,917970,917971,917972,917973,917974,917975,917976,917977,917978,917979,917980,917981,917982,917983,917984,917985,917986,917987,917988,917989,917990,917991,917992,917993,917994,917995,917996,917997,917998,917999],"cs":[173,8203,12288],"de":[173,8203,12288],"es":[8203,12288],"fr":[173,8203,12288],"it":[160,173,12288],"ja":[173],"ko":[173,12288],"pl":[173,8203,12288],"pt-BR":[173,8203,12288],"qps-ploc":[160,173,8203,12288],"ru":[173,12288],"tr":[160,173,8203,12288],"zh-hans":[160,173,8203,12288],"zh-hant":[173,12288]}');
  }
  static {
    this._data = void 0;
  }
  static getData() {
    if (!this._data) {
      this._data = new Set([...Object.values(_InvisibleCharacters.getRawData())].flat());
    }
    return this._data;
  }
  static isInvisibleCharacter(codePoint) {
    return _InvisibleCharacters.getData().has(codePoint);
  }
  static containsInvisibleCharacter(str) {
    for (let i = 0; i < str.length; i++) {
      const codePoint = str.codePointAt(i);
      if (typeof codePoint === "number" && (_InvisibleCharacters.isInvisibleCharacter(codePoint) || codePoint === 32 /* space */)) {
        return true;
      }
    }
    return false;
  }
  static get codePoints() {
    return _InvisibleCharacters.getData();
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/extpath.ts
function isPathSeparator2(code) {
  return code === 47 /* Slash */ || code === 92 /* Backslash */;
}
function toSlashes(osPath) {
  return osPath.replace(/[\\/]/g, posix.sep);
}
function toPosixPath(osPath) {
  if (osPath.indexOf("/") === -1) {
    osPath = toSlashes(osPath);
  }
  if (/^[a-zA-Z]:(\/|$)/.test(osPath)) {
    osPath = "/" + osPath;
  }
  return osPath;
}
function getRoot(path, sep2 = posix.sep) {
  if (!path) {
    return "";
  }
  const len = path.length;
  const firstLetter = path.charCodeAt(0);
  if (isPathSeparator2(firstLetter)) {
    if (isPathSeparator2(path.charCodeAt(1))) {
      if (!isPathSeparator2(path.charCodeAt(2))) {
        let pos2 = 3;
        const start = pos2;
        for (; pos2 < len; pos2++) {
          if (isPathSeparator2(path.charCodeAt(pos2))) {
            break;
          }
        }
        if (start !== pos2 && !isPathSeparator2(path.charCodeAt(pos2 + 1))) {
          pos2 += 1;
          for (; pos2 < len; pos2++) {
            if (isPathSeparator2(path.charCodeAt(pos2))) {
              return path.slice(0, pos2 + 1).replace(/[\\/]/g, sep2);
            }
          }
        }
      }
    }
    return sep2;
  } else if (isWindowsDriveLetter(firstLetter)) {
    if (path.charCodeAt(1) === 58 /* Colon */) {
      if (isPathSeparator2(path.charCodeAt(2))) {
        return path.slice(0, 2) + sep2;
      } else {
        return path.slice(0, 2);
      }
    }
  }
  let pos = path.indexOf("://");
  if (pos !== -1) {
    pos += 3;
    for (; pos < len; pos++) {
      if (isPathSeparator2(path.charCodeAt(pos))) {
        return path.slice(0, pos + 1);
      }
    }
  }
  return "";
}
function isEqualOrParent(base, parentCandidate, ignoreCase, separator = sep) {
  if (base === parentCandidate) {
    return true;
  }
  if (!base || !parentCandidate) {
    return false;
  }
  if (parentCandidate.length > base.length) {
    return false;
  }
  if (ignoreCase) {
    const beginsWith = startsWithIgnoreCase(base, parentCandidate);
    if (!beginsWith) {
      return false;
    }
    if (parentCandidate.length === base.length) {
      return true;
    }
    let sepOffset = parentCandidate.length;
    if (parentCandidate.charAt(parentCandidate.length - 1) === separator) {
      sepOffset--;
    }
    return base.charAt(sepOffset) === separator;
  }
  if (parentCandidate.charAt(parentCandidate.length - 1) !== separator) {
    parentCandidate += separator;
  }
  return base.indexOf(parentCandidate) === 0;
}
function isWindowsDriveLetter(char0) {
  return char0 >= 65 /* A */ && char0 <= 90 /* Z */ || char0 >= 97 /* a */ && char0 <= 122 /* z */;
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/uri.ts
var _schemePattern = /^\w[\w\d+.-]*$/;
var _singleSlashStart = /^\//;
var _doubleSlashStart = /^\/\//;
function _validateUri(ret, _strict) {
  if (!ret.scheme && _strict) {
    throw new Error(`[UriError]: Scheme is missing: {scheme: "", authority: "${ret.authority}", path: "${ret.path}", query: "${ret.query}", fragment: "${ret.fragment}"}`);
  }
  if (ret.scheme && !_schemePattern.test(ret.scheme)) {
    throw new Error("[UriError]: Scheme contains illegal characters.");
  }
  if (ret.path) {
    if (ret.authority) {
      if (!_singleSlashStart.test(ret.path)) {
        throw new Error('[UriError]: If a URI contains an authority component, then the path component must either be empty or begin with a slash ("/") character');
      }
    } else {
      if (_doubleSlashStart.test(ret.path)) {
        throw new Error('[UriError]: If a URI does not contain an authority component, then the path cannot begin with two slash characters ("//")');
      }
    }
  }
}
function _schemeFix(scheme, _strict) {
  if (!scheme && !_strict) {
    return "file";
  }
  return scheme;
}
function _referenceResolution(scheme, path) {
  switch (scheme) {
    case "https":
    case "http":
    case "file":
      if (!path) {
        path = _slash;
      } else if (path[0] !== _slash) {
        path = _slash + path;
      }
      break;
  }
  return path;
}
var _empty = "";
var _slash = "/";
var _regexp = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;
var URI = class _URI {
  static isUri(thing) {
    if (thing instanceof _URI) {
      return true;
    }
    if (!thing || typeof thing !== "object") {
      return false;
    }
    return typeof thing.authority === "string" && typeof thing.fragment === "string" && typeof thing.path === "string" && typeof thing.query === "string" && typeof thing.scheme === "string" && typeof thing.fsPath === "string" && typeof thing.with === "function" && typeof thing.toString === "function";
  }
  /**
   * @internal
   */
  constructor(schemeOrData, authority, path, query, fragment, _strict = false) {
    if (typeof schemeOrData === "object") {
      this.scheme = schemeOrData.scheme || _empty;
      this.authority = schemeOrData.authority || _empty;
      this.path = schemeOrData.path || _empty;
      this.query = schemeOrData.query || _empty;
      this.fragment = schemeOrData.fragment || _empty;
    } else {
      this.scheme = _schemeFix(schemeOrData, _strict);
      this.authority = authority || _empty;
      this.path = _referenceResolution(this.scheme, path || _empty);
      this.query = query || _empty;
      this.fragment = fragment || _empty;
      _validateUri(this, _strict);
    }
  }
  // ---- filesystem path -----------------------
  /**
   * Returns a string representing the corresponding file system path of this URI.
   * Will handle UNC paths, normalizes windows drive letters to lower-case, and uses the
   * platform specific path separator.
   *
   * * Will *not* validate the path for invalid characters and semantics.
   * * Will *not* look at the scheme of this URI.
   * * The result shall *not* be used for display purposes but for accessing a file on disk.
   *
   *
   * The *difference* to `URI#path` is the use of the platform specific separator and the handling
   * of UNC paths. See the below sample of a file-uri with an authority (UNC path).
   *
   * ```ts
  	const u = URI.parse('file://server/c$/folder/file.txt')
  	u.authority === 'server'
  	u.path === '/shares/c$/file.txt'
  	u.fsPath === '\\server\c$\folder\file.txt'
  ```
   *
   * Using `URI#path` to read a file (using fs-apis) would not be enough because parts of the path,
   * namely the server name, would be missing. Therefore `URI#fsPath` exists - it's sugar to ease working
   * with URIs that represent files on disk (`file` scheme).
   */
  get fsPath() {
    return uriToFsPath(this, false);
  }
  // ---- modify to new -------------------------
  with(change) {
    if (!change) {
      return this;
    }
    let { scheme, authority, path, query, fragment } = change;
    if (scheme === void 0) {
      scheme = this.scheme;
    } else if (scheme === null) {
      scheme = _empty;
    }
    if (authority === void 0) {
      authority = this.authority;
    } else if (authority === null) {
      authority = _empty;
    }
    if (path === void 0) {
      path = this.path;
    } else if (path === null) {
      path = _empty;
    }
    if (query === void 0) {
      query = this.query;
    } else if (query === null) {
      query = _empty;
    }
    if (fragment === void 0) {
      fragment = this.fragment;
    } else if (fragment === null) {
      fragment = _empty;
    }
    if (scheme === this.scheme && authority === this.authority && path === this.path && query === this.query && fragment === this.fragment) {
      return this;
    }
    return new Uri(scheme, authority, path, query, fragment);
  }
  // ---- parse & validate ------------------------
  /**
   * Creates a new URI from a string, e.g. `http://www.example.com/some/path`,
   * `file:///usr/home`, or `scheme:with/path`.
   *
   * @param value A string which represents an URI (see `URI#toString`).
   */
  static parse(value, _strict = false) {
    const match = _regexp.exec(value);
    if (!match) {
      return new Uri(_empty, _empty, _empty, _empty, _empty);
    }
    return new Uri(
      match[2] || _empty,
      percentDecode(match[4] || _empty),
      percentDecode(match[5] || _empty),
      percentDecode(match[7] || _empty),
      percentDecode(match[9] || _empty),
      _strict
    );
  }
  /**
   * Creates a new URI from a file system path, e.g. `c:\my\files`,
   * `/usr/home`, or `\\server\share\some\path`.
   *
   * The *difference* between `URI#parse` and `URI#file` is that the latter treats the argument
   * as path, not as stringified-uri. E.g. `URI.file(path)` is **not the same as**
   * `URI.parse('file://' + path)` because the path might contain characters that are
   * interpreted (# and ?). See the following sample:
   * ```ts
  const good = URI.file('/coding/c#/project1');
  good.scheme === 'file';
  good.path === '/coding/c#/project1';
  good.fragment === '';
  const bad = URI.parse('file://' + '/coding/c#/project1');
  bad.scheme === 'file';
  bad.path === '/coding/c'; // path is now broken
  bad.fragment === '/project1';
  ```
   *
   * @param path A file system path (see `URI#fsPath`)
   */
  static file(path) {
    let authority = _empty;
    if (isWindows) {
      path = path.replace(/\\/g, _slash);
    }
    if (path[0] === _slash && path[1] === _slash) {
      const idx = path.indexOf(_slash, 2);
      if (idx === -1) {
        authority = path.substring(2);
        path = _slash;
      } else {
        authority = path.substring(2, idx);
        path = path.substring(idx) || _slash;
      }
    }
    return new Uri("file", authority, path, _empty, _empty);
  }
  /**
   * Creates new URI from uri components.
   *
   * Unless `strict` is `true` the scheme is defaults to be `file`. This function performs
   * validation and should be used for untrusted uri components retrieved from storage,
   * user input, command arguments etc
   */
  static from(components, strict) {
    const result = new Uri(
      components.scheme,
      components.authority,
      components.path,
      components.query,
      components.fragment,
      strict
    );
    return result;
  }
  /**
   * Join a URI path with path fragments and normalizes the resulting path.
   *
   * @param uri The input URI.
   * @param pathFragment The path fragment to add to the URI path.
   * @returns The resulting URI.
   */
  static joinPath(uri, ...pathFragment) {
    if (!uri.path) {
      throw new Error(`[UriError]: cannot call joinPath on URI without path`);
    }
    let newPath;
    if (isWindows && uri.scheme === "file") {
      newPath = _URI.file(win32.join(uriToFsPath(uri, true), ...pathFragment)).path;
    } else {
      newPath = posix.join(uri.path, ...pathFragment);
    }
    return uri.with({ path: newPath });
  }
  // ---- printing/externalize ---------------------------
  /**
   * Creates a string representation for this URI. It's guaranteed that calling
   * `URI.parse` with the result of this function creates an URI which is equal
   * to this URI.
   *
   * * The result shall *not* be used for display purposes but for externalization or transport.
   * * The result will be encoded using the percentage encoding and encoding happens mostly
   * ignore the scheme-specific encoding rules.
   *
   * @param skipEncoding Do not encode the result, default is `false`
   */
  toString(skipEncoding = false) {
    return _asFormatted(this, skipEncoding);
  }
  toJSON() {
    return this;
  }
  static revive(data) {
    if (!data) {
      return data;
    } else if (data instanceof _URI) {
      return data;
    } else {
      const result = new Uri(data);
      result._formatted = data.external ?? null;
      result._fsPath = data._sep === _pathSepMarker ? data.fsPath ?? null : null;
      return result;
    }
  }
  [Symbol.for("debug.description")]() {
    return `URI(${this.toString()})`;
  }
};
var _pathSepMarker = isWindows ? 1 : void 0;
var Uri = class extends URI {
  constructor() {
    super(...arguments);
    this._formatted = null;
    this._fsPath = null;
  }
  get fsPath() {
    if (!this._fsPath) {
      this._fsPath = uriToFsPath(this, false);
    }
    return this._fsPath;
  }
  toString(skipEncoding = false) {
    if (!skipEncoding) {
      if (!this._formatted) {
        this._formatted = _asFormatted(this, false);
      }
      return this._formatted;
    } else {
      return _asFormatted(this, true);
    }
  }
  toJSON() {
    const res = {
      $mid: 1 /* Uri */
    };
    if (this._fsPath) {
      res.fsPath = this._fsPath;
      res._sep = _pathSepMarker;
    }
    if (this._formatted) {
      res.external = this._formatted;
    }
    if (this.path) {
      res.path = this.path;
    }
    if (this.scheme) {
      res.scheme = this.scheme;
    }
    if (this.authority) {
      res.authority = this.authority;
    }
    if (this.query) {
      res.query = this.query;
    }
    if (this.fragment) {
      res.fragment = this.fragment;
    }
    return res;
  }
};
var encodeTable = {
  [58 /* Colon */]: "%3A",
  // gen-delims
  [47 /* Slash */]: "%2F",
  [63 /* QuestionMark */]: "%3F",
  [35 /* Hash */]: "%23",
  [91 /* OpenSquareBracket */]: "%5B",
  [93 /* CloseSquareBracket */]: "%5D",
  [64 /* AtSign */]: "%40",
  [33 /* ExclamationMark */]: "%21",
  // sub-delims
  [36 /* DollarSign */]: "%24",
  [38 /* Ampersand */]: "%26",
  [39 /* SingleQuote */]: "%27",
  [40 /* OpenParen */]: "%28",
  [41 /* CloseParen */]: "%29",
  [42 /* Asterisk */]: "%2A",
  [43 /* Plus */]: "%2B",
  [44 /* Comma */]: "%2C",
  [59 /* Semicolon */]: "%3B",
  [61 /* Equals */]: "%3D",
  [32 /* Space */]: "%20"
};
function encodeURIComponentFast(uriComponent, isPath, isAuthority) {
  let res = void 0;
  let nativeEncodePos = -1;
  for (let pos = 0; pos < uriComponent.length; pos++) {
    const code = uriComponent.charCodeAt(pos);
    if (code >= 97 /* a */ && code <= 122 /* z */ || code >= 65 /* A */ && code <= 90 /* Z */ || code >= 48 /* Digit0 */ && code <= 57 /* Digit9 */ || code === 45 /* Dash */ || code === 46 /* Period */ || code === 95 /* Underline */ || code === 126 /* Tilde */ || isPath && code === 47 /* Slash */ || isAuthority && code === 91 /* OpenSquareBracket */ || isAuthority && code === 93 /* CloseSquareBracket */ || isAuthority && code === 58 /* Colon */) {
      if (nativeEncodePos !== -1) {
        res += encodeURIComponent(uriComponent.substring(nativeEncodePos, pos));
        nativeEncodePos = -1;
      }
      if (res !== void 0) {
        res += uriComponent.charAt(pos);
      }
    } else {
      if (res === void 0) {
        res = uriComponent.substr(0, pos);
      }
      const escaped = encodeTable[code];
      if (escaped !== void 0) {
        if (nativeEncodePos !== -1) {
          res += encodeURIComponent(uriComponent.substring(nativeEncodePos, pos));
          nativeEncodePos = -1;
        }
        res += escaped;
      } else if (nativeEncodePos === -1) {
        nativeEncodePos = pos;
      }
    }
  }
  if (nativeEncodePos !== -1) {
    res += encodeURIComponent(uriComponent.substring(nativeEncodePos));
  }
  return res !== void 0 ? res : uriComponent;
}
function encodeURIComponentMinimal(path) {
  let res = void 0;
  for (let pos = 0; pos < path.length; pos++) {
    const code = path.charCodeAt(pos);
    if (code === 35 /* Hash */ || code === 63 /* QuestionMark */) {
      if (res === void 0) {
        res = path.substr(0, pos);
      }
      res += encodeTable[code];
    } else {
      if (res !== void 0) {
        res += path[pos];
      }
    }
  }
  return res !== void 0 ? res : path;
}
function uriToFsPath(uri, keepDriveLetterCasing) {
  let value;
  if (uri.authority && uri.path.length > 1 && uri.scheme === "file") {
    value = `//${uri.authority}${uri.path}`;
  } else if (uri.path.charCodeAt(0) === 47 /* Slash */ && (uri.path.charCodeAt(1) >= 65 /* A */ && uri.path.charCodeAt(1) <= 90 /* Z */ || uri.path.charCodeAt(1) >= 97 /* a */ && uri.path.charCodeAt(1) <= 122 /* z */) && uri.path.charCodeAt(2) === 58 /* Colon */) {
    if (!keepDriveLetterCasing) {
      value = uri.path[1].toLowerCase() + uri.path.substr(2);
    } else {
      value = uri.path.substr(1);
    }
  } else {
    value = uri.path;
  }
  if (isWindows) {
    value = value.replace(/\//g, "\\");
  }
  return value;
}
function _asFormatted(uri, skipEncoding) {
  const encoder = !skipEncoding ? encodeURIComponentFast : encodeURIComponentMinimal;
  let res = "";
  let { scheme, authority, path, query, fragment } = uri;
  if (scheme) {
    res += scheme;
    res += ":";
  }
  if (authority || scheme === "file") {
    res += _slash;
    res += _slash;
  }
  if (authority) {
    let idx = authority.indexOf("@");
    if (idx !== -1) {
      const userinfo = authority.substr(0, idx);
      authority = authority.substr(idx + 1);
      idx = userinfo.lastIndexOf(":");
      if (idx === -1) {
        res += encoder(userinfo, false, false);
      } else {
        res += encoder(userinfo.substr(0, idx), false, false);
        res += ":";
        res += encoder(userinfo.substr(idx + 1), false, true);
      }
      res += "@";
    }
    authority = authority.toLowerCase();
    idx = authority.lastIndexOf(":");
    if (idx === -1) {
      res += encoder(authority, false, true);
    } else {
      res += encoder(authority.substr(0, idx), false, true);
      res += authority.substr(idx);
    }
  }
  if (path) {
    if (path.length >= 3 && path.charCodeAt(0) === 47 /* Slash */ && path.charCodeAt(2) === 58 /* Colon */) {
      const code = path.charCodeAt(1);
      if (code >= 65 /* A */ && code <= 90 /* Z */) {
        path = `/${String.fromCharCode(code + 32)}:${path.substr(3)}`;
      }
    } else if (path.length >= 2 && path.charCodeAt(1) === 58 /* Colon */) {
      const code = path.charCodeAt(0);
      if (code >= 65 /* A */ && code <= 90 /* Z */) {
        path = `${String.fromCharCode(code + 32)}:${path.substr(2)}`;
      }
    }
    res += encoder(path, true, false);
  }
  if (query) {
    res += "?";
    res += encoder(query, false, false);
  }
  if (fragment) {
    res += "#";
    res += !skipEncoding ? encodeURIComponentFast(fragment, false, false) : fragment;
  }
  return res;
}
function decodeURIComponentGraceful(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    if (str.length > 3) {
      return str.substr(0, 3) + decodeURIComponentGraceful(str.substr(3));
    } else {
      return str;
    }
  }
}
var _rEncodedAsHex = /(%[0-9A-Za-z][0-9A-Za-z])+/g;
function percentDecode(str) {
  if (!str.match(_rEncodedAsHex)) {
    return str;
  }
  return str.replace(_rEncodedAsHex, (match) => decodeURIComponentGraceful(match));
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/network.ts
var Schemas;
((Schemas2) => {
  Schemas2.inMemory = "inmemory";
  Schemas2.vscode = "vscode";
  Schemas2.internal = "private";
  Schemas2.walkThrough = "walkThrough";
  Schemas2.walkThroughSnippet = "walkThroughSnippet";
  Schemas2.http = "http";
  Schemas2.https = "https";
  Schemas2.file = "file";
  Schemas2.mailto = "mailto";
  Schemas2.untitled = "untitled";
  Schemas2.data = "data";
  Schemas2.command = "command";
  Schemas2.vscodeRemote = "vscode-remote";
  Schemas2.vscodeRemoteResource = "vscode-remote-resource";
  Schemas2.vscodeManagedRemoteResource = "vscode-managed-remote-resource";
  Schemas2.vscodeUserData = "vscode-userdata";
  Schemas2.vscodeCustomEditor = "vscode-custom-editor";
  Schemas2.vscodeNotebookCell = "vscode-notebook-cell";
  Schemas2.vscodeNotebookCellMetadata = "vscode-notebook-cell-metadata";
  Schemas2.vscodeNotebookCellMetadataDiff = "vscode-notebook-cell-metadata-diff";
  Schemas2.vscodeNotebookCellOutput = "vscode-notebook-cell-output";
  Schemas2.vscodeNotebookCellOutputDiff = "vscode-notebook-cell-output-diff";
  Schemas2.vscodeNotebookMetadata = "vscode-notebook-metadata";
  Schemas2.vscodeInteractiveInput = "vscode-interactive-input";
  Schemas2.vscodeSettings = "vscode-settings";
  Schemas2.vscodeWorkspaceTrust = "vscode-workspace-trust";
  Schemas2.vscodeTerminal = "vscode-terminal";
  Schemas2.vscodeChatCodeBlock = "vscode-chat-code-block";
  Schemas2.vscodeChatCodeCompareBlock = "vscode-chat-code-compare-block";
  Schemas2.vscodeChatEditor = "vscode-chat-editor";
  Schemas2.vscodeChatInput = "chatSessionInput";
  Schemas2.vscodeLocalChatSession = "vscode-chat-session";
  Schemas2.webviewPanel = "webview-panel";
  Schemas2.vscodeWebview = "vscode-webview";
  Schemas2.extension = "extension";
  Schemas2.vscodeFileResource = "vscode-file";
  Schemas2.tmp = "tmp";
  Schemas2.vsls = "vsls";
  Schemas2.vscodeSourceControl = "vscode-scm";
  Schemas2.commentsInput = "comment";
  Schemas2.codeSetting = "code-setting";
  Schemas2.outputChannel = "output";
  Schemas2.accessibleView = "accessible-view";
  Schemas2.chatEditingSnapshotScheme = "chat-editing-snapshot-text-model";
  Schemas2.chatEditingModel = "chat-editing-text-model";
  Schemas2.copilotPr = "copilot-pr";
})(Schemas || (Schemas = {}));
var connectionTokenQueryName = "tkn";
var RemoteAuthoritiesImpl = class {
  constructor() {
    this._hosts = /* @__PURE__ */ Object.create(null);
    this._ports = /* @__PURE__ */ Object.create(null);
    this._connectionTokens = /* @__PURE__ */ Object.create(null);
    this._preferredWebSchema = "http";
    this._delegate = null;
    this._serverRootPath = "/";
  }
  setPreferredWebSchema(schema) {
    this._preferredWebSchema = schema;
  }
  setDelegate(delegate) {
    this._delegate = delegate;
  }
  setServerRootPath(product, serverBasePath) {
    this._serverRootPath = posix.join(serverBasePath ?? "/", getServerProductSegment(product));
  }
  getServerRootPath() {
    return this._serverRootPath;
  }
  get _remoteResourcesPath() {
    return posix.join(this._serverRootPath, Schemas.vscodeRemoteResource);
  }
  set(authority, host, port) {
    this._hosts[authority] = host;
    this._ports[authority] = port;
  }
  setConnectionToken(authority, connectionToken) {
    this._connectionTokens[authority] = connectionToken;
  }
  getPreferredWebSchema() {
    return this._preferredWebSchema;
  }
  rewrite(uri) {
    if (this._delegate) {
      try {
        return this._delegate(uri);
      } catch (err) {
        onUnexpectedError(err);
        return uri;
      }
    }
    const authority = uri.authority;
    let host = this._hosts[authority];
    if (host && host.indexOf(":") !== -1 && host.indexOf("[") === -1) {
      host = `[${host}]`;
    }
    const port = this._ports[authority];
    const connectionToken = this._connectionTokens[authority];
    let query = `path=${encodeURIComponent(uri.path)}`;
    if (typeof connectionToken === "string") {
      query += `&${connectionTokenQueryName}=${encodeURIComponent(connectionToken)}`;
    }
    return URI.from({
      scheme: isWeb ? this._preferredWebSchema : Schemas.vscodeRemoteResource,
      authority: `${host}:${port}`,
      path: this._remoteResourcesPath,
      query
    });
  }
};
var RemoteAuthorities = new RemoteAuthoritiesImpl();
function getServerProductSegment(product) {
  return `${product.quality ?? "oss"}-${product.commit ?? "dev"}`;
}
var VSCODE_AUTHORITY = "vscode-app";
var FileAccessImpl = class _FileAccessImpl {
  static {
    this.FALLBACK_AUTHORITY = VSCODE_AUTHORITY;
  }
  /**
   * Returns a URI to use in contexts where the browser is responsible
   * for loading (e.g. fetch()) or when used within the DOM.
   *
   * **Note:** use `dom.ts#asCSSUrl` whenever the URL is to be used in CSS context.
   */
  asBrowserUri(resourcePath) {
    const uri = this.toUri(resourcePath);
    return this.uriToBrowserUri(uri);
  }
  /**
   * Returns a URI to use in contexts where the browser is responsible
   * for loading (e.g. fetch()) or when used within the DOM.
   *
   * **Note:** use `dom.ts#asCSSUrl` whenever the URL is to be used in CSS context.
   */
  uriToBrowserUri(uri) {
    if (uri.scheme === Schemas.vscodeRemote) {
      return RemoteAuthorities.rewrite(uri);
    }
    if (
      // ...only ever for `file` resources
      uri.scheme === Schemas.file && // ...and we run in native environments
      (isNative || // ...or web worker extensions on desktop
      webWorkerOrigin === `${Schemas.vscodeFileResource}://${_FileAccessImpl.FALLBACK_AUTHORITY}`)
    ) {
      return uri.with({
        scheme: Schemas.vscodeFileResource,
        // We need to provide an authority here so that it can serve
        // as origin for network and loading matters in chromium.
        // If the URI is not coming with an authority already, we
        // add our own
        authority: uri.authority || _FileAccessImpl.FALLBACK_AUTHORITY,
        query: null,
        fragment: null
      });
    }
    return uri;
  }
  /**
   * Returns the `file` URI to use in contexts where node.js
   * is responsible for loading.
   */
  asFileUri(resourcePath) {
    const uri = this.toUri(resourcePath);
    return this.uriToFileUri(uri);
  }
  /**
   * Returns the `file` URI to use in contexts where node.js
   * is responsible for loading.
   */
  uriToFileUri(uri) {
    if (uri.scheme === Schemas.vscodeFileResource) {
      return uri.with({
        scheme: Schemas.file,
        // Only preserve the `authority` if it is different from
        // our fallback authority. This ensures we properly preserve
        // Windows UNC paths that come with their own authority.
        authority: uri.authority !== _FileAccessImpl.FALLBACK_AUTHORITY ? uri.authority : null,
        query: null,
        fragment: null
      });
    }
    return uri;
  }
  toUri(uriOrModule) {
    if (URI.isUri(uriOrModule)) {
      return uriOrModule;
    }
    if (globalThis._VSCODE_FILE_ROOT) {
      const rootUriOrPath = globalThis._VSCODE_FILE_ROOT;
      if (/^\w[\w\d+.-]*:\/\//.test(rootUriOrPath)) {
        return URI.joinPath(URI.parse(rootUriOrPath, true), uriOrModule);
      }
      const modulePath = join(rootUriOrPath, uriOrModule);
      return URI.file(modulePath);
    }
    throw new Error("Cannot determine URI for module id!");
  }
};
var FileAccess = new FileAccessImpl();
var CacheControlheaders = Object.freeze({
  "Cache-Control": "no-cache, no-store"
});
var DocumentPolicyheaders = Object.freeze({
  "Document-Policy": "include-js-call-stacks-in-crash-reports"
});
var COI;
((COI2) => {
  const coiHeaders = /* @__PURE__ */ new Map([
    ["1", { "Cross-Origin-Opener-Policy": "same-origin" }],
    ["2", { "Cross-Origin-Embedder-Policy": "require-corp" }],
    ["3", { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" }]
  ]);
  COI2.CoopAndCoep = Object.freeze(coiHeaders.get("3"));
  const coiSearchParamName = "vscode-coi";
  function getHeadersFromQuery(url) {
    let params;
    if (typeof url === "string") {
      params = new URL(url).searchParams;
    } else if (url instanceof URL) {
      params = url.searchParams;
    } else if (URI.isUri(url)) {
      params = new URL(url.toString(true)).searchParams;
    }
    const value = params?.get(coiSearchParamName);
    if (!value) {
      return void 0;
    }
    return coiHeaders.get(value);
  }
  COI2.getHeadersFromQuery = getHeadersFromQuery;
  function addSearchParam(urlOrSearch, coop, coep) {
    if (!globalThis.crossOriginIsolated) {
      return;
    }
    const value = coop && coep ? "3" : coep ? "2" : "1";
    if (urlOrSearch instanceof URLSearchParams) {
      urlOrSearch.set(coiSearchParamName, value);
    } else {
      urlOrSearch[coiSearchParamName] = value;
    }
  }
  COI2.addSearchParam = addSearchParam;
})(COI || (COI = {}));

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/resources.ts
function originalFSPath(uri) {
  return uriToFsPath(uri, true);
}
var ExtUri = class {
  constructor(_ignorePathCasing) {
    this._ignorePathCasing = _ignorePathCasing;
  }
  compare(uri1, uri2, ignoreFragment = false) {
    if (uri1 === uri2) {
      return 0;
    }
    return compare(this.getComparisonKey(uri1, ignoreFragment), this.getComparisonKey(uri2, ignoreFragment));
  }
  isEqual(uri1, uri2, ignoreFragment = false) {
    if (uri1 === uri2) {
      return true;
    }
    if (!uri1 || !uri2) {
      return false;
    }
    return this.getComparisonKey(uri1, ignoreFragment) === this.getComparisonKey(uri2, ignoreFragment);
  }
  getComparisonKey(uri, ignoreFragment = false) {
    return uri.with({
      path: this._ignorePathCasing(uri) ? uri.path.toLowerCase() : void 0,
      fragment: ignoreFragment ? null : void 0
    }).toString();
  }
  ignorePathCasing(uri) {
    return this._ignorePathCasing(uri);
  }
  isEqualOrParent(base, parentCandidate, ignoreFragment = false) {
    if (base.scheme === parentCandidate.scheme) {
      if (base.scheme === Schemas.file) {
        return isEqualOrParent(originalFSPath(base), originalFSPath(parentCandidate), this._ignorePathCasing(base)) && base.query === parentCandidate.query && (ignoreFragment || base.fragment === parentCandidate.fragment);
      }
      if (isEqualAuthority(base.authority, parentCandidate.authority)) {
        return isEqualOrParent(base.path, parentCandidate.path, this._ignorePathCasing(base), "/") && base.query === parentCandidate.query && (ignoreFragment || base.fragment === parentCandidate.fragment);
      }
    }
    return false;
  }
  // --- path math
  joinPath(resource, ...pathFragment) {
    return URI.joinPath(resource, ...pathFragment);
  }
  basenameOrAuthority(resource) {
    return basename2(resource) || resource.authority;
  }
  basename(resource) {
    return posix.basename(resource.path);
  }
  extname(resource) {
    return posix.extname(resource.path);
  }
  dirname(resource) {
    if (resource.path.length === 0) {
      return resource;
    }
    let dirname3;
    if (resource.scheme === Schemas.file) {
      dirname3 = URI.file(dirname(originalFSPath(resource))).path;
    } else {
      dirname3 = posix.dirname(resource.path);
      if (resource.authority && dirname3.length && dirname3.charCodeAt(0) !== 47 /* Slash */) {
        console.error(`dirname("${resource.toString})) resulted in a relative path`);
        dirname3 = "/";
      }
    }
    return resource.with({
      path: dirname3
    });
  }
  normalizePath(resource) {
    if (!resource.path.length) {
      return resource;
    }
    let normalizedPath;
    if (resource.scheme === Schemas.file) {
      normalizedPath = URI.file(normalize(originalFSPath(resource))).path;
    } else {
      normalizedPath = posix.normalize(resource.path);
    }
    return resource.with({
      path: normalizedPath
    });
  }
  relativePath(from, to) {
    if (from.scheme !== to.scheme || !isEqualAuthority(from.authority, to.authority)) {
      return void 0;
    }
    if (from.scheme === Schemas.file) {
      const relativePath2 = relative(originalFSPath(from), originalFSPath(to));
      return isWindows ? toSlashes(relativePath2) : relativePath2;
    }
    let fromPath = from.path || "/";
    const toPath = to.path || "/";
    if (this._ignorePathCasing(from)) {
      let i = 0;
      for (const len = Math.min(fromPath.length, toPath.length); i < len; i++) {
        if (fromPath.charCodeAt(i) !== toPath.charCodeAt(i)) {
          if (fromPath.charAt(i).toLowerCase() !== toPath.charAt(i).toLowerCase()) {
            break;
          }
        }
      }
      fromPath = toPath.substr(0, i) + fromPath.substr(i);
    }
    return posix.relative(fromPath, toPath);
  }
  resolvePath(base, path) {
    if (base.scheme === Schemas.file) {
      const newURI = URI.file(resolve(originalFSPath(base), path));
      return base.with({
        authority: newURI.authority,
        path: newURI.path
      });
    }
    path = toPosixPath(path);
    return base.with({
      path: posix.resolve(base.path, path)
    });
  }
  // --- misc
  isAbsolutePath(resource) {
    return !!resource.path && resource.path[0] === "/";
  }
  isEqualAuthority(a1, a2) {
    return a1 === a2 || a1 !== void 0 && a2 !== void 0 && equalsIgnoreCase(a1, a2);
  }
  hasTrailingPathSeparator(resource, sep2 = sep) {
    if (resource.scheme === Schemas.file) {
      const fsp = originalFSPath(resource);
      return fsp.length > getRoot(fsp).length && fsp[fsp.length - 1] === sep2;
    } else {
      const p = resource.path;
      return p.length > 1 && p.charCodeAt(p.length - 1) === 47 /* Slash */ && !/^[a-zA-Z]:(\/$|\\$)/.test(resource.fsPath);
    }
  }
  removeTrailingPathSeparator(resource, sep2 = sep) {
    if (hasTrailingPathSeparator(resource, sep2)) {
      return resource.with({ path: resource.path.substr(0, resource.path.length - 1) });
    }
    return resource;
  }
  addTrailingPathSeparator(resource, sep2 = sep) {
    let isRootSep = false;
    if (resource.scheme === Schemas.file) {
      const fsp = originalFSPath(resource);
      isRootSep = fsp !== void 0 && fsp.length === getRoot(fsp).length && fsp[fsp.length - 1] === sep2;
    } else {
      sep2 = "/";
      const p = resource.path;
      isRootSep = p.length === 1 && p.charCodeAt(p.length - 1) === 47 /* Slash */;
    }
    if (!isRootSep && !hasTrailingPathSeparator(resource, sep2)) {
      return resource.with({ path: resource.path + "/" });
    }
    return resource;
  }
};
var extUri = new ExtUri(() => false);
var extUriBiasedIgnorePathCase = new ExtUri((uri) => {
  return uri.scheme === Schemas.file ? !isLinux : true;
});
var extUriIgnorePathCase = new ExtUri((_) => true);
var isEqual = extUri.isEqual.bind(extUri);
var isEqualOrParent2 = extUri.isEqualOrParent.bind(extUri);
var getComparisonKey = extUri.getComparisonKey.bind(extUri);
var basenameOrAuthority = extUri.basenameOrAuthority.bind(extUri);
var basename2 = extUri.basename.bind(extUri);
var extname2 = extUri.extname.bind(extUri);
var dirname2 = extUri.dirname.bind(extUri);
var joinPath = extUri.joinPath.bind(extUri);
var normalizePath = extUri.normalizePath.bind(extUri);
var relativePath = extUri.relativePath.bind(extUri);
var resolvePath = extUri.resolvePath.bind(extUri);
var isAbsolutePath = extUri.isAbsolutePath.bind(extUri);
var isEqualAuthority = extUri.isEqualAuthority.bind(extUri);
var hasTrailingPathSeparator = extUri.hasTrailingPathSeparator.bind(extUri);
var removeTrailingPathSeparator = extUri.removeTrailingPathSeparator.bind(extUri);
var addTrailingPathSeparator = extUri.addTrailingPathSeparator.bind(extUri);
var DataUri;
((DataUri2) => {
  DataUri2.META_DATA_LABEL = "label";
  DataUri2.META_DATA_DESCRIPTION = "description";
  DataUri2.META_DATA_SIZE = "size";
  DataUri2.META_DATA_MIME = "mime";
  function parseMetaData(dataUri) {
    const metadata = /* @__PURE__ */ new Map();
    const meta = dataUri.path.substring(dataUri.path.indexOf(";") + 1, dataUri.path.lastIndexOf(";"));
    meta.split(";").forEach((property) => {
      const [key, value] = property.split(":");
      if (key && value) {
        metadata.set(key, value);
      }
    });
    const mime = dataUri.path.substring(0, dataUri.path.indexOf(";"));
    if (mime) {
      metadata.set(DataUri2.META_DATA_MIME, mime);
    }
    return metadata;
  }
  DataUri2.parseMetaData = parseMetaData;
})(DataUri || (DataUri = {}));

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/symbols.ts
var MicrotaskDelay = Symbol("MicrotaskDelay");

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/async.ts
var TimeoutTimer = class {
  constructor(runner, timeout) {
    this._isDisposed = false;
    this._token = void 0;
    if (typeof runner === "function" && typeof timeout === "number") {
      this.setIfNotSet(runner, timeout);
    }
  }
  dispose() {
    this.cancel();
    this._isDisposed = true;
  }
  cancel() {
    if (this._token !== void 0) {
      clearTimeout(this._token);
      this._token = void 0;
    }
  }
  cancelAndSet(runner, timeout) {
    if (this._isDisposed) {
      throw new BugIndicatingError(`Calling 'cancelAndSet' on a disposed TimeoutTimer`);
    }
    this.cancel();
    this._token = setTimeout(() => {
      this._token = void 0;
      runner();
    }, timeout);
  }
  setIfNotSet(runner, timeout) {
    if (this._isDisposed) {
      throw new BugIndicatingError(`Calling 'setIfNotSet' on a disposed TimeoutTimer`);
    }
    if (this._token !== void 0) {
      return;
    }
    this._token = setTimeout(() => {
      this._token = void 0;
      runner();
    }, timeout);
  }
};
var IntervalTimer = class {
  constructor() {
    this.disposable = void 0;
    this.isDisposed = false;
  }
  cancel() {
    this.disposable?.dispose();
    this.disposable = void 0;
  }
  cancelAndSet(runner, interval, context = globalThis) {
    if (this.isDisposed) {
      throw new BugIndicatingError(`Calling 'cancelAndSet' on a disposed IntervalTimer`);
    }
    this.cancel();
    const handle = context.setInterval(() => {
      runner();
    }, interval);
    this.disposable = toDisposable(() => {
      context.clearInterval(handle);
      this.disposable = void 0;
    });
  }
  dispose() {
    this.cancel();
    this.isDisposed = true;
  }
};
var runWhenGlobalIdle;
var _runWhenIdle;
(function() {
  const safeGlobal = globalThis;
  if (typeof safeGlobal.requestIdleCallback !== "function" || typeof safeGlobal.cancelIdleCallback !== "function") {
    _runWhenIdle = (_targetWindow, runner, timeout) => {
      setTimeout0(() => {
        if (disposed) {
          return;
        }
        const end = Date.now() + 15;
        const deadline = {
          didTimeout: true,
          timeRemaining() {
            return Math.max(0, end - Date.now());
          }
        };
        runner(Object.freeze(deadline));
      });
      let disposed = false;
      return {
        dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
        }
      };
    };
  } else {
    _runWhenIdle = (targetWindow, runner, timeout) => {
      const handle = targetWindow.requestIdleCallback(runner, typeof timeout === "number" ? { timeout } : void 0);
      let disposed = false;
      return {
        dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          targetWindow.cancelIdleCallback(handle);
        }
      };
    };
  }
  runWhenGlobalIdle = (runner, timeout) => _runWhenIdle(globalThis, runner, timeout);
})();
var DeferredPromise = class _DeferredPromise {
  static fromPromise(promise) {
    const deferred = new _DeferredPromise();
    deferred.settleWith(promise);
    return deferred;
  }
  get isRejected() {
    return this.outcome?.outcome === 1 /* Rejected */;
  }
  get isResolved() {
    return this.outcome?.outcome === 0 /* Resolved */;
  }
  get isSettled() {
    return !!this.outcome;
  }
  get value() {
    return this.outcome?.outcome === 0 /* Resolved */ ? this.outcome?.value : void 0;
  }
  constructor() {
    this.p = new Promise((c, e) => {
      this.completeCallback = c;
      this.errorCallback = e;
    });
  }
  complete(value) {
    if (this.isSettled) {
      return Promise.resolve();
    }
    return new Promise((resolve3) => {
      this.completeCallback(value);
      this.outcome = { outcome: 0 /* Resolved */, value };
      resolve3();
    });
  }
  error(err) {
    if (this.isSettled) {
      return Promise.resolve();
    }
    return new Promise((resolve3) => {
      this.errorCallback(err);
      this.outcome = { outcome: 1 /* Rejected */, value: err };
      resolve3();
    });
  }
  settleWith(promise) {
    return promise.then(
      (value) => this.complete(value),
      (error) => this.error(error)
    );
  }
  cancel() {
    return this.error(new CancellationError());
  }
};
var Promises;
((Promises2) => {
  async function settled(promises) {
    let firstError = void 0;
    const result = await Promise.all(promises.map((promise) => promise.then((value) => value, (error) => {
      if (!firstError) {
        firstError = error;
      }
      return void 0;
    })));
    if (typeof firstError !== "undefined") {
      throw firstError;
    }
    return result;
  }
  Promises2.settled = settled;
  function withAsyncBody(bodyFn) {
    return new Promise(async (resolve3, reject) => {
      try {
        await bodyFn(resolve3, reject);
      } catch (error) {
        reject(error);
      }
    });
  }
  Promises2.withAsyncBody = withAsyncBody;
})(Promises || (Promises = {}));
var AsyncIterableObject = class _AsyncIterableObject {
  static fromArray(items) {
    return new _AsyncIterableObject((writer) => {
      writer.emitMany(items);
    });
  }
  static fromPromise(promise) {
    return new _AsyncIterableObject(async (emitter) => {
      emitter.emitMany(await promise);
    });
  }
  static fromPromisesResolveOrder(promises) {
    return new _AsyncIterableObject(async (emitter) => {
      await Promise.all(promises.map(async (p) => emitter.emitOne(await p)));
    });
  }
  static merge(iterables) {
    return new _AsyncIterableObject(async (emitter) => {
      await Promise.all(iterables.map(async (iterable) => {
        for await (const item of iterable) {
          emitter.emitOne(item);
        }
      }));
    });
  }
  static {
    this.EMPTY = _AsyncIterableObject.fromArray([]);
  }
  constructor(executor, onReturn) {
    this._state = 0 /* Initial */;
    this._results = [];
    this._error = null;
    this._onReturn = onReturn;
    this._onStateChanged = new Emitter();
    queueMicrotask(async () => {
      const writer = {
        emitOne: (item) => this.emitOne(item),
        emitMany: (items) => this.emitMany(items),
        reject: (error) => this.reject(error)
      };
      try {
        await Promise.resolve(executor(writer));
        this.resolve();
      } catch (err) {
        this.reject(err);
      } finally {
        writer.emitOne = void 0;
        writer.emitMany = void 0;
        writer.reject = void 0;
      }
    });
  }
  [Symbol.asyncIterator]() {
    let i = 0;
    return {
      next: async () => {
        do {
          if (this._state === 2 /* DoneError */) {
            throw this._error;
          }
          if (i < this._results.length) {
            return { done: false, value: this._results[i++] };
          }
          if (this._state === 1 /* DoneOK */) {
            return { done: true, value: void 0 };
          }
          await Event.toPromise(this._onStateChanged.event);
        } while (true);
      },
      return: async () => {
        this._onReturn?.();
        return { done: true, value: void 0 };
      }
    };
  }
  static map(iterable, mapFn) {
    return new _AsyncIterableObject(async (emitter) => {
      for await (const item of iterable) {
        emitter.emitOne(mapFn(item));
      }
    });
  }
  map(mapFn) {
    return _AsyncIterableObject.map(this, mapFn);
  }
  static filter(iterable, filterFn) {
    return new _AsyncIterableObject(async (emitter) => {
      for await (const item of iterable) {
        if (filterFn(item)) {
          emitter.emitOne(item);
        }
      }
    });
  }
  filter(filterFn) {
    return _AsyncIterableObject.filter(this, filterFn);
  }
  static coalesce(iterable) {
    return _AsyncIterableObject.filter(iterable, (item) => !!item);
  }
  coalesce() {
    return _AsyncIterableObject.coalesce(this);
  }
  static async toPromise(iterable) {
    const result = [];
    for await (const item of iterable) {
      result.push(item);
    }
    return result;
  }
  toPromise() {
    return _AsyncIterableObject.toPromise(this);
  }
  /**
   * The value will be appended at the end.
   *
   * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
   */
  emitOne(value) {
    if (this._state !== 0 /* Initial */) {
      return;
    }
    this._results.push(value);
    this._onStateChanged.fire();
  }
  /**
   * The values will be appended at the end.
   *
   * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
   */
  emitMany(values) {
    if (this._state !== 0 /* Initial */) {
      return;
    }
    this._results = this._results.concat(values);
    this._onStateChanged.fire();
  }
  /**
   * Calling `resolve()` will mark the result array as complete.
   *
   * **NOTE** `resolve()` must be called, otherwise all consumers of this iterable will hang indefinitely, similar to a non-resolved promise.
   * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
   */
  resolve() {
    if (this._state !== 0 /* Initial */) {
      return;
    }
    this._state = 1 /* DoneOK */;
    this._onStateChanged.fire();
  }
  /**
   * Writing an error will permanently invalidate this iterable.
   * The current users will receive an error thrown, as will all future users.
   *
   * **NOTE** If `resolve()` or `reject()` have already been called, this method has no effect.
   */
  reject(error) {
    if (this._state !== 0 /* Initial */) {
      return;
    }
    this._state = 2 /* DoneError */;
    this._error = error;
    this._onStateChanged.fire();
  }
};
var ProducerConsumer = class {
  constructor() {
    this._unsatisfiedConsumers = [];
    this._unconsumedValues = [];
  }
  get hasFinalValue() {
    return !!this._finalValue;
  }
  produce(value) {
    this._ensureNoFinalValue();
    if (this._unsatisfiedConsumers.length > 0) {
      const deferred = this._unsatisfiedConsumers.shift();
      this._resolveOrRejectDeferred(deferred, value);
    } else {
      this._unconsumedValues.push(value);
    }
  }
  produceFinal(value) {
    this._ensureNoFinalValue();
    this._finalValue = value;
    for (const deferred of this._unsatisfiedConsumers) {
      this._resolveOrRejectDeferred(deferred, value);
    }
    this._unsatisfiedConsumers.length = 0;
  }
  _ensureNoFinalValue() {
    if (this._finalValue) {
      throw new BugIndicatingError("ProducerConsumer: cannot produce after final value has been set");
    }
  }
  _resolveOrRejectDeferred(deferred, value) {
    if (value.ok) {
      deferred.complete(value.value);
    } else {
      deferred.error(value.error);
    }
  }
  consume() {
    if (this._unconsumedValues.length > 0 || this._finalValue) {
      const value = this._unconsumedValues.length > 0 ? this._unconsumedValues.shift() : this._finalValue;
      if (value.ok) {
        return Promise.resolve(value.value);
      } else {
        return Promise.reject(value.error);
      }
    } else {
      const deferred = new DeferredPromise();
      this._unsatisfiedConsumers.push(deferred);
      return deferred.p;
    }
  }
};
var AsyncIterableProducer = class _AsyncIterableProducer {
  constructor(executor, _onReturn) {
    this._onReturn = _onReturn;
    this._producerConsumer = new ProducerConsumer();
    this._iterator = {
      next: () => this._producerConsumer.consume(),
      return: () => {
        this._onReturn?.();
        return Promise.resolve({ done: true, value: void 0 });
      },
      throw: async (e) => {
        this._finishError(e);
        return { done: true, value: void 0 };
      }
    };
    queueMicrotask(async () => {
      const p = executor({
        emitOne: (value) => this._producerConsumer.produce({ ok: true, value: { done: false, value } }),
        emitMany: (values) => {
          for (const value of values) {
            this._producerConsumer.produce({ ok: true, value: { done: false, value } });
          }
        },
        reject: (error) => this._finishError(error)
      });
      if (!this._producerConsumer.hasFinalValue) {
        try {
          await p;
          this._finishOk();
        } catch (error) {
          this._finishError(error);
        }
      }
    });
  }
  static fromArray(items) {
    return new _AsyncIterableProducer((writer) => {
      writer.emitMany(items);
    });
  }
  static fromPromise(promise) {
    return new _AsyncIterableProducer(async (emitter) => {
      emitter.emitMany(await promise);
    });
  }
  static fromPromisesResolveOrder(promises) {
    return new _AsyncIterableProducer(async (emitter) => {
      await Promise.all(promises.map(async (p) => emitter.emitOne(await p)));
    });
  }
  static merge(iterables) {
    return new _AsyncIterableProducer(async (emitter) => {
      await Promise.all(iterables.map(async (iterable) => {
        for await (const item of iterable) {
          emitter.emitOne(item);
        }
      }));
    });
  }
  static {
    this.EMPTY = _AsyncIterableProducer.fromArray([]);
  }
  static map(iterable, mapFn) {
    return new _AsyncIterableProducer(async (emitter) => {
      for await (const item of iterable) {
        emitter.emitOne(mapFn(item));
      }
    });
  }
  static tee(iterable) {
    let emitter1;
    let emitter2;
    const defer = new DeferredPromise();
    const start = async () => {
      if (!emitter1 || !emitter2) {
        return;
      }
      try {
        for await (const item of iterable) {
          emitter1.emitOne(item);
          emitter2.emitOne(item);
        }
      } catch (err) {
        emitter1.reject(err);
        emitter2.reject(err);
      } finally {
        defer.complete();
      }
    };
    const p1 = new _AsyncIterableProducer(async (emitter) => {
      emitter1 = emitter;
      start();
      return defer.p;
    });
    const p2 = new _AsyncIterableProducer(async (emitter) => {
      emitter2 = emitter;
      start();
      return defer.p;
    });
    return [p1, p2];
  }
  map(mapFn) {
    return _AsyncIterableProducer.map(this, mapFn);
  }
  static coalesce(iterable) {
    return _AsyncIterableProducer.filter(iterable, (item) => !!item);
  }
  coalesce() {
    return _AsyncIterableProducer.coalesce(this);
  }
  static filter(iterable, filterFn) {
    return new _AsyncIterableProducer(async (emitter) => {
      for await (const item of iterable) {
        if (filterFn(item)) {
          emitter.emitOne(item);
        }
      }
    });
  }
  filter(filterFn) {
    return _AsyncIterableProducer.filter(this, filterFn);
  }
  _finishOk() {
    if (!this._producerConsumer.hasFinalValue) {
      this._producerConsumer.produceFinal({ ok: true, value: { done: true, value: void 0 } });
    }
  }
  _finishError(error) {
    if (!this._producerConsumer.hasFinalValue) {
      this._producerConsumer.produceFinal({ ok: false, error });
    }
  }
  [Symbol.asyncIterator]() {
    return this._iterator;
  }
};
var AsyncReaderEndOfStream = Symbol("AsyncReaderEndOfStream");

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/buffer.ts
var hasBuffer = typeof Buffer !== "undefined";
var indexOfTable = new Lazy(() => new Uint8Array(256));
var textEncoder;
var textDecoder;
var VSBuffer = class _VSBuffer {
  /**
   * When running in a nodejs context, the backing store for the returned `VSBuffer` instance
   * might use a nodejs Buffer allocated from node's Buffer pool, which is not transferrable.
   */
  static alloc(byteLength) {
    if (hasBuffer) {
      return new _VSBuffer(Buffer.allocUnsafe(byteLength));
    } else {
      return new _VSBuffer(new Uint8Array(byteLength));
    }
  }
  /**
   * When running in a nodejs context, if `actual` is not a nodejs Buffer, the backing store for
   * the returned `VSBuffer` instance might use a nodejs Buffer allocated from node's Buffer pool,
   * which is not transferrable.
   */
  static wrap(actual) {
    if (hasBuffer && !Buffer.isBuffer(actual)) {
      actual = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
    }
    return new _VSBuffer(actual);
  }
  /**
   * When running in a nodejs context, the backing store for the returned `VSBuffer` instance
   * might use a nodejs Buffer allocated from node's Buffer pool, which is not transferrable.
   */
  static fromString(source, options) {
    const dontUseNodeBuffer = options?.dontUseNodeBuffer || false;
    if (!dontUseNodeBuffer && hasBuffer) {
      return new _VSBuffer(Buffer.from(source));
    } else {
      if (!textEncoder) {
        textEncoder = new TextEncoder();
      }
      return new _VSBuffer(textEncoder.encode(source));
    }
  }
  /**
   * When running in a nodejs context, the backing store for the returned `VSBuffer` instance
   * might use a nodejs Buffer allocated from node's Buffer pool, which is not transferrable.
   */
  static fromByteArray(source) {
    const result = _VSBuffer.alloc(source.length);
    for (let i = 0, len = source.length; i < len; i++) {
      result.buffer[i] = source[i];
    }
    return result;
  }
  /**
   * When running in a nodejs context, the backing store for the returned `VSBuffer` instance
   * might use a nodejs Buffer allocated from node's Buffer pool, which is not transferrable.
   */
  static concat(buffers, totalLength) {
    if (typeof totalLength === "undefined") {
      totalLength = 0;
      for (let i = 0, len = buffers.length; i < len; i++) {
        totalLength += buffers[i].byteLength;
      }
    }
    const ret = _VSBuffer.alloc(totalLength);
    let offset = 0;
    for (let i = 0, len = buffers.length; i < len; i++) {
      const element = buffers[i];
      ret.set(element, offset);
      offset += element.byteLength;
    }
    return ret;
  }
  static isNativeBuffer(buffer) {
    return hasBuffer && Buffer.isBuffer(buffer);
  }
  constructor(buffer) {
    this.buffer = buffer;
    this.byteLength = this.buffer.byteLength;
  }
  /**
   * When running in a nodejs context, the backing store for the returned `VSBuffer` instance
   * might use a nodejs Buffer allocated from node's Buffer pool, which is not transferrable.
   */
  clone() {
    const result = _VSBuffer.alloc(this.byteLength);
    result.set(this);
    return result;
  }
  toString() {
    if (hasBuffer) {
      return this.buffer.toString();
    } else {
      if (!textDecoder) {
        textDecoder = new TextDecoder(void 0, { ignoreBOM: true });
      }
      return textDecoder.decode(this.buffer);
    }
  }
  slice(start, end) {
    return new _VSBuffer(this.buffer.subarray(start, end));
  }
  set(array, offset) {
    if (array instanceof _VSBuffer) {
      this.buffer.set(array.buffer, offset);
    } else if (array instanceof Uint8Array) {
      this.buffer.set(array, offset);
    } else if (array instanceof ArrayBuffer) {
      this.buffer.set(new Uint8Array(array), offset);
    } else if (ArrayBuffer.isView(array)) {
      this.buffer.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
    } else {
      throw new Error(`Unknown argument 'array'`);
    }
  }
  readUInt32BE(offset) {
    return readUInt32BE(this.buffer, offset);
  }
  writeUInt32BE(value, offset) {
    writeUInt32BE(this.buffer, value, offset);
  }
  readUInt32LE(offset) {
    return readUInt32LE(this.buffer, offset);
  }
  writeUInt32LE(value, offset) {
    writeUInt32LE(this.buffer, value, offset);
  }
  readUInt8(offset) {
    return readUInt8(this.buffer, offset);
  }
  writeUInt8(value, offset) {
    writeUInt8(this.buffer, value, offset);
  }
  indexOf(subarray, offset = 0) {
    return binaryIndexOf(this.buffer, subarray instanceof _VSBuffer ? subarray.buffer : subarray, offset);
  }
  equals(other) {
    if (this === other) {
      return true;
    }
    if (this.byteLength !== other.byteLength) {
      return false;
    }
    return this.buffer.every((value, index) => value === other.buffer[index]);
  }
};
function binaryIndexOf(haystack, needle, offset = 0) {
  const needleLen = needle.byteLength;
  const haystackLen = haystack.byteLength;
  if (needleLen === 0) {
    return 0;
  }
  if (needleLen === 1) {
    return haystack.indexOf(needle[0]);
  }
  if (needleLen > haystackLen - offset) {
    return -1;
  }
  const table = indexOfTable.value;
  table.fill(needle.length);
  for (let i2 = 0; i2 < needle.length; i2++) {
    table[needle[i2]] = needle.length - i2 - 1;
  }
  let i = offset + needle.length - 1;
  let j = i;
  let result = -1;
  while (i < haystackLen) {
    if (haystack[i] === needle[j]) {
      if (j === 0) {
        result = i;
        break;
      }
      i--;
      j--;
    } else {
      i += Math.max(needle.length - j, table[haystack[i]]);
      j = needle.length - 1;
    }
  }
  return result;
}
function readUInt32BE(source, offset) {
  return source[offset] * 2 ** 24 + source[offset + 1] * 2 ** 16 + source[offset + 2] * 2 ** 8 + source[offset + 3];
}
function writeUInt32BE(destination, value, offset) {
  destination[offset + 3] = value;
  value = value >>> 8;
  destination[offset + 2] = value;
  value = value >>> 8;
  destination[offset + 1] = value;
  value = value >>> 8;
  destination[offset] = value;
}
function readUInt32LE(source, offset) {
  return source[offset + 0] << 0 >>> 0 | source[offset + 1] << 8 >>> 0 | source[offset + 2] << 16 >>> 0 | source[offset + 3] << 24 >>> 0;
}
function writeUInt32LE(destination, value, offset) {
  destination[offset + 0] = value & 255;
  value = value >>> 8;
  destination[offset + 1] = value & 255;
  value = value >>> 8;
  destination[offset + 2] = value & 255;
  value = value >>> 8;
  destination[offset + 3] = value & 255;
}
function readUInt8(source, offset) {
  return source[offset];
}
function writeUInt8(destination, value, offset) {
  destination[offset] = value;
}
var hexChars = "0123456789abcdef";
function encodeHex({ buffer }) {
  let result = "";
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    result += hexChars[byte >>> 4];
    result += hexChars[byte & 15];
  }
  return result;
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/hash.ts
function hash(obj) {
  return doHash(obj, 0);
}
function doHash(obj, hashVal) {
  switch (typeof obj) {
    case "object":
      if (obj === null) {
        return numberHash(349, hashVal);
      } else if (Array.isArray(obj)) {
        return arrayHash(obj, hashVal);
      }
      return objectHash(obj, hashVal);
    case "string":
      return stringHash(obj, hashVal);
    case "boolean":
      return booleanHash(obj, hashVal);
    case "number":
      return numberHash(obj, hashVal);
    case "undefined":
      return numberHash(937, hashVal);
    default:
      return numberHash(617, hashVal);
  }
}
function numberHash(val, initialHashVal) {
  return (initialHashVal << 5) - initialHashVal + val | 0;
}
function booleanHash(b, initialHashVal) {
  return numberHash(b ? 433 : 863, initialHashVal);
}
function stringHash(s, hashVal) {
  hashVal = numberHash(149417, hashVal);
  for (let i = 0, length = s.length; i < length; i++) {
    hashVal = numberHash(s.charCodeAt(i), hashVal);
  }
  return hashVal;
}
function arrayHash(arr, initialHashVal) {
  initialHashVal = numberHash(104579, initialHashVal);
  return arr.reduce((hashVal, item) => doHash(item, hashVal), initialHashVal);
}
function objectHash(obj, initialHashVal) {
  initialHashVal = numberHash(181387, initialHashVal);
  return Object.keys(obj).sort().reduce((hashVal, key) => {
    hashVal = stringHash(key, hashVal);
    return doHash(obj[key], hashVal);
  }, initialHashVal);
}
function leftRotate(value, bits, totalBits = 32) {
  const delta = totalBits - bits;
  const mask = ~((1 << delta) - 1);
  return (value << bits | (mask & value) >>> delta) >>> 0;
}
function toHexString(bufferOrValue, bitsize = 32) {
  if (bufferOrValue instanceof ArrayBuffer) {
    return encodeHex(VSBuffer.wrap(new Uint8Array(bufferOrValue)));
  }
  return (bufferOrValue >>> 0).toString(16).padStart(bitsize / 4, "0");
}
var StringSHA1 = class _StringSHA1 {
  constructor() {
    // 80 * 4 = 320
    this._h0 = 1732584193;
    this._h1 = 4023233417;
    this._h2 = 2562383102;
    this._h3 = 271733878;
    this._h4 = 3285377520;
    this._buff = new Uint8Array(
      64 /* BLOCK_SIZE */ + 3
      /* to fit any utf-8 */
    );
    this._buffDV = new DataView(this._buff.buffer);
    this._buffLen = 0;
    this._totalLen = 0;
    this._leftoverHighSurrogate = 0;
    this._finished = false;
  }
  static {
    this._bigBlock32 = new DataView(new ArrayBuffer(320));
  }
  update(str) {
    const strLen = str.length;
    if (strLen === 0) {
      return;
    }
    const buff = this._buff;
    let buffLen = this._buffLen;
    let leftoverHighSurrogate = this._leftoverHighSurrogate;
    let charCode;
    let offset;
    if (leftoverHighSurrogate !== 0) {
      charCode = leftoverHighSurrogate;
      offset = -1;
      leftoverHighSurrogate = 0;
    } else {
      charCode = str.charCodeAt(0);
      offset = 0;
    }
    while (true) {
      let codePoint = charCode;
      if (isHighSurrogate(charCode)) {
        if (offset + 1 < strLen) {
          const nextCharCode = str.charCodeAt(offset + 1);
          if (isLowSurrogate(nextCharCode)) {
            offset++;
            codePoint = computeCodePoint(charCode, nextCharCode);
          } else {
            codePoint = 65533 /* UNICODE_REPLACEMENT */;
          }
        } else {
          leftoverHighSurrogate = charCode;
          break;
        }
      } else if (isLowSurrogate(charCode)) {
        codePoint = 65533 /* UNICODE_REPLACEMENT */;
      }
      buffLen = this._push(buff, buffLen, codePoint);
      offset++;
      if (offset < strLen) {
        charCode = str.charCodeAt(offset);
      } else {
        break;
      }
    }
    this._buffLen = buffLen;
    this._leftoverHighSurrogate = leftoverHighSurrogate;
  }
  _push(buff, buffLen, codePoint) {
    if (codePoint < 128) {
      buff[buffLen++] = codePoint;
    } else if (codePoint < 2048) {
      buff[buffLen++] = 192 | (codePoint & 1984) >>> 6;
      buff[buffLen++] = 128 | (codePoint & 63) >>> 0;
    } else if (codePoint < 65536) {
      buff[buffLen++] = 224 | (codePoint & 61440) >>> 12;
      buff[buffLen++] = 128 | (codePoint & 4032) >>> 6;
      buff[buffLen++] = 128 | (codePoint & 63) >>> 0;
    } else {
      buff[buffLen++] = 240 | (codePoint & 1835008) >>> 18;
      buff[buffLen++] = 128 | (codePoint & 258048) >>> 12;
      buff[buffLen++] = 128 | (codePoint & 4032) >>> 6;
      buff[buffLen++] = 128 | (codePoint & 63) >>> 0;
    }
    if (buffLen >= 64 /* BLOCK_SIZE */) {
      this._step();
      buffLen -= 64 /* BLOCK_SIZE */;
      this._totalLen += 64 /* BLOCK_SIZE */;
      buff[0] = buff[64 /* BLOCK_SIZE */ + 0];
      buff[1] = buff[64 /* BLOCK_SIZE */ + 1];
      buff[2] = buff[64 /* BLOCK_SIZE */ + 2];
    }
    return buffLen;
  }
  digest() {
    if (!this._finished) {
      this._finished = true;
      if (this._leftoverHighSurrogate) {
        this._leftoverHighSurrogate = 0;
        this._buffLen = this._push(this._buff, this._buffLen, 65533 /* UNICODE_REPLACEMENT */);
      }
      this._totalLen += this._buffLen;
      this._wrapUp();
    }
    return toHexString(this._h0) + toHexString(this._h1) + toHexString(this._h2) + toHexString(this._h3) + toHexString(this._h4);
  }
  _wrapUp() {
    this._buff[this._buffLen++] = 128;
    this._buff.subarray(this._buffLen).fill(0);
    if (this._buffLen > 56) {
      this._step();
      this._buff.fill(0);
    }
    const ml = 8 * this._totalLen;
    this._buffDV.setUint32(56, Math.floor(ml / 4294967296), false);
    this._buffDV.setUint32(60, ml % 4294967296, false);
    this._step();
  }
  _step() {
    const bigBlock32 = _StringSHA1._bigBlock32;
    const data = this._buffDV;
    for (let j = 0; j < 64; j += 4) {
      bigBlock32.setUint32(j, data.getUint32(j, false), false);
    }
    for (let j = 64; j < 320; j += 4) {
      bigBlock32.setUint32(j, leftRotate(bigBlock32.getUint32(j - 12, false) ^ bigBlock32.getUint32(j - 32, false) ^ bigBlock32.getUint32(j - 56, false) ^ bigBlock32.getUint32(j - 64, false), 1), false);
    }
    let a = this._h0;
    let b = this._h1;
    let c = this._h2;
    let d = this._h3;
    let e = this._h4;
    let f, k;
    let temp;
    for (let j = 0; j < 80; j++) {
      if (j < 20) {
        f = b & c | ~b & d;
        k = 1518500249;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 1859775393;
      } else if (j < 60) {
        f = b & c | b & d | c & d;
        k = 2400959708;
      } else {
        f = b ^ c ^ d;
        k = 3395469782;
      }
      temp = leftRotate(a, 5) + f + e + k + bigBlock32.getUint32(j * 4, false) & 4294967295;
      e = d;
      d = c;
      c = leftRotate(b, 30);
      b = a;
      a = temp;
    }
    this._h0 = this._h0 + a & 4294967295;
    this._h1 = this._h1 + b & 4294967295;
    this._h2 = this._h2 + c & 4294967295;
    this._h3 = this._h3 + d & 4294967295;
    this._h4 = this._h4 + e & 4294967295;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/debugName.ts
var DebugNameData = class {
  constructor(owner, debugNameSource, referenceFn) {
    this.owner = owner;
    this.debugNameSource = debugNameSource;
    this.referenceFn = referenceFn;
  }
  getDebugName(target) {
    return getDebugName(target, this);
  }
};
var countPerName = /* @__PURE__ */ new Map();
var cachedDebugName = /* @__PURE__ */ new WeakMap();
function getDebugName(target, data) {
  const cached = cachedDebugName.get(target);
  if (cached) {
    return cached;
  }
  const dbgName = computeDebugName(target, data);
  if (dbgName) {
    let count = countPerName.get(dbgName) ?? 0;
    count++;
    countPerName.set(dbgName, count);
    const result = count === 1 ? dbgName : `${dbgName}#${count}`;
    cachedDebugName.set(target, result);
    return result;
  }
  return void 0;
}
function computeDebugName(self, data) {
  const cached = cachedDebugName.get(self);
  if (cached) {
    return cached;
  }
  const ownerStr = data.owner ? formatOwner(data.owner) + `.` : "";
  let result;
  const debugNameSource = data.debugNameSource;
  if (debugNameSource !== void 0) {
    if (typeof debugNameSource === "function") {
      result = debugNameSource();
      if (result !== void 0) {
        return ownerStr + result;
      }
    } else {
      return ownerStr + debugNameSource;
    }
  }
  const referenceFn = data.referenceFn;
  if (referenceFn !== void 0) {
    result = getFunctionName(referenceFn);
    if (result !== void 0) {
      return ownerStr + result;
    }
  }
  if (data.owner !== void 0) {
    const key = findKey(data.owner, self);
    if (key !== void 0) {
      return ownerStr + key;
    }
  }
  return void 0;
}
function findKey(obj, value) {
  for (const key in obj) {
    if (obj[key] === value) {
      return key;
    }
  }
  return void 0;
}
var countPerClassName = /* @__PURE__ */ new Map();
var ownerId = /* @__PURE__ */ new WeakMap();
function formatOwner(owner) {
  const id2 = ownerId.get(owner);
  if (id2) {
    return id2;
  }
  const className = getClassName(owner) ?? "Object";
  let count = countPerClassName.get(className) ?? 0;
  count++;
  countPerClassName.set(className, count);
  const result = count === 1 ? className : `${className}#${count}`;
  ownerId.set(owner, result);
  return result;
}
function getClassName(obj) {
  const ctor = obj.constructor;
  if (ctor) {
    if (ctor.name === "Object") {
      return void 0;
    }
    return ctor.name;
  }
  return void 0;
}
function getFunctionName(fn) {
  const fnSrc = fn.toString();
  const regexp = /\/\*\*\s*@description\s*([^*]*)\*\//;
  const match = regexp.exec(fnSrc);
  const result = match ? match[1] : void 0;
  return result?.trim();
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/equals.ts
function strictEquals(a, b) {
  return a === b;
}
function strictEqualsC() {
  return (a, b) => a === b;
}
function arrayEquals(a, b, itemEquals) {
  return equals(a, b, itemEquals ?? strictEquals);
}
function arrayEqualsC(itemEquals) {
  return (a, b) => equals(a, b, itemEquals ?? strictEquals);
}
function structuralEquals(a, b) {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!structuralEquals(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (a && typeof a === "object" && b && typeof b === "object") {
    if (Object.getPrototypeOf(a) === Object.prototype && Object.getPrototypeOf(b) === Object.prototype) {
      const aObj = a;
      const bObj = b;
      const keysA = Object.keys(aObj);
      const keysB = Object.keys(bObj);
      const keysBSet = new Set(keysB);
      if (keysA.length !== keysB.length) {
        return false;
      }
      for (const key of keysA) {
        if (!keysBSet.has(key)) {
          return false;
        }
        if (!structuralEquals(aObj[key], bObj[key])) {
          return false;
        }
      }
      return true;
    }
  }
  return false;
}
function structuralEqualsC() {
  return (a, b) => structuralEquals(a, b);
}
function jsonStringifyEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function jsonStringifyEqualsC() {
  return (a, b) => JSON.stringify(a) === JSON.stringify(b);
}
function thisEqualsC() {
  return (a, b) => a.equals(b);
}
function equalsIfDefined(v1, v2, equals3) {
  if (v1 === void 0 || v1 === null || v2 === void 0 || v2 === null) {
    return v2 === v1;
  }
  return equals3(v1, v2);
}
function equalsIfDefinedC(equals3) {
  return (v1, v2) => {
    if (v1 === void 0 || v1 === null || v2 === void 0 || v2 === null) {
      return v2 === v1;
    }
    return equals3(v1, v2);
  };
}
var equals2;
((equals3) => {
  equals3.strict = strictEquals;
  equals3.strictC = strictEqualsC;
  equals3.array = arrayEquals;
  equals3.arrayC = arrayEqualsC;
  equals3.structural = structuralEquals;
  equals3.structuralC = structuralEqualsC;
  equals3.jsonStringify = jsonStringifyEquals;
  equals3.jsonStringifyC = jsonStringifyEqualsC;
  equals3.thisC = thisEqualsC;
  equals3.ifDefined = equalsIfDefined;
  equals3.ifDefinedC = equalsIfDefinedC;
})(equals2 || (equals2 = {}));

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/base.ts
function handleBugIndicatingErrorRecovery(message) {
  const err = new Error("BugIndicatingErrorRecovery: " + message);
  onUnexpectedError(err);
  console.error("recovered from an error that indicates a bug", err);
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/logging/logging.ts
var globalObservableLogger;
function addLogger(logger) {
  if (!globalObservableLogger) {
    globalObservableLogger = logger;
  } else if (globalObservableLogger instanceof ComposedLogger) {
    globalObservableLogger.loggers.push(logger);
  } else {
    globalObservableLogger = new ComposedLogger([globalObservableLogger, logger]);
  }
}
function getLogger() {
  return globalObservableLogger;
}
var globalObservableLoggerFn = void 0;
function setLogObservableFn(fn) {
  globalObservableLoggerFn = fn;
}
function logObservable(obs) {
  if (globalObservableLoggerFn) {
    globalObservableLoggerFn(obs);
  }
}
var ComposedLogger = class {
  constructor(loggers) {
    this.loggers = loggers;
  }
  handleObservableCreated(observable, location) {
    for (const logger of this.loggers) {
      logger.handleObservableCreated(observable, location);
    }
  }
  handleOnListenerCountChanged(observable, newCount) {
    for (const logger of this.loggers) {
      logger.handleOnListenerCountChanged(observable, newCount);
    }
  }
  handleObservableUpdated(observable, info) {
    for (const logger of this.loggers) {
      logger.handleObservableUpdated(observable, info);
    }
  }
  handleAutorunCreated(autorun2, location) {
    for (const logger of this.loggers) {
      logger.handleAutorunCreated(autorun2, location);
    }
  }
  handleAutorunDisposed(autorun2) {
    for (const logger of this.loggers) {
      logger.handleAutorunDisposed(autorun2);
    }
  }
  handleAutorunDependencyChanged(autorun2, observable, change) {
    for (const logger of this.loggers) {
      logger.handleAutorunDependencyChanged(autorun2, observable, change);
    }
  }
  handleAutorunStarted(autorun2) {
    for (const logger of this.loggers) {
      logger.handleAutorunStarted(autorun2);
    }
  }
  handleAutorunFinished(autorun2) {
    for (const logger of this.loggers) {
      logger.handleAutorunFinished(autorun2);
    }
  }
  handleDerivedDependencyChanged(derived2, observable, change) {
    for (const logger of this.loggers) {
      logger.handleDerivedDependencyChanged(derived2, observable, change);
    }
  }
  handleDerivedCleared(observable) {
    for (const logger of this.loggers) {
      logger.handleDerivedCleared(observable);
    }
  }
  handleBeginTransaction(transaction2) {
    for (const logger of this.loggers) {
      logger.handleBeginTransaction(transaction2);
    }
  }
  handleEndTransaction(transaction2) {
    for (const logger of this.loggers) {
      logger.handleEndTransaction(transaction2);
    }
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/transaction.ts
function transaction(fn, getDebugName2) {
  const tx = new TransactionImpl(fn, getDebugName2);
  try {
    fn(tx);
  } finally {
    tx.finish();
  }
}
function subtransaction(tx, fn, getDebugName2) {
  if (!tx) {
    transaction(fn, getDebugName2);
  } else {
    fn(tx);
  }
}
var TransactionImpl = class {
  constructor(_fn, _getDebugName) {
    this._fn = _fn;
    this._getDebugName = _getDebugName;
    this._updatingObservers = [];
    getLogger()?.handleBeginTransaction(this);
  }
  getDebugName() {
    if (this._getDebugName) {
      return this._getDebugName();
    }
    return getFunctionName(this._fn);
  }
  updateObserver(observer, observable) {
    if (!this._updatingObservers) {
      handleBugIndicatingErrorRecovery("Transaction already finished!");
      transaction((tx) => {
        tx.updateObserver(observer, observable);
      });
      return;
    }
    this._updatingObservers.push({ observer, observable });
    observer.beginUpdate(observable);
  }
  finish() {
    const updatingObservers = this._updatingObservers;
    if (!updatingObservers) {
      handleBugIndicatingErrorRecovery("transaction.finish() has already been called!");
      return;
    }
    for (let i = 0; i < updatingObservers.length; i++) {
      const { observer, observable } = updatingObservers[i];
      observer.endUpdate(observable);
    }
    this._updatingObservers = null;
    getLogger()?.handleEndTransaction(this);
  }
  debugGetUpdatingObservers() {
    return this._updatingObservers;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/debugLocation.ts
var DebugLocation;
((DebugLocation2) => {
  let enabled = false;
  function enable() {
    enabled = true;
  }
  DebugLocation2.enable = enable;
  function ofCaller() {
    if (!enabled) {
      return void 0;
    }
    const Err = Error;
    const l = Err.stackTraceLimit;
    Err.stackTraceLimit = 3;
    const stack = new Error().stack;
    Err.stackTraceLimit = l;
    return DebugLocationImpl.fromStack(stack, 2);
  }
  DebugLocation2.ofCaller = ofCaller;
})(DebugLocation || (DebugLocation = {}));
var DebugLocationImpl = class _DebugLocationImpl {
  constructor(fileName, line, column, id2) {
    this.fileName = fileName;
    this.line = line;
    this.column = column;
    this.id = id2;
  }
  static fromStack(stack, parentIdx) {
    const lines = stack.split("\n");
    const location = parseLine(lines[parentIdx + 1]);
    if (location) {
      return new _DebugLocationImpl(
        location.fileName,
        location.line,
        location.column,
        location.id
      );
    } else {
      return void 0;
    }
  }
};
function parseLine(stackLine) {
  const match = stackLine.match(/\((.*):(\d+):(\d+)\)/);
  if (match) {
    return {
      fileName: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      id: stackLine
    };
  }
  const match2 = stackLine.match(/at ([^\(\)]*):(\d+):(\d+)/);
  if (match2) {
    return {
      fileName: match2[1],
      line: parseInt(match2[2]),
      column: parseInt(match2[3]),
      id: stackLine
    };
  }
  return void 0;
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/observables/baseObservable.ts
var _derived;
function _setDerivedOpts(derived2) {
  _derived = derived2;
}
var _recomputeInitiallyAndOnChange;
function _setRecomputeInitiallyAndOnChange(recomputeInitiallyAndOnChange2) {
  _recomputeInitiallyAndOnChange = recomputeInitiallyAndOnChange2;
}
var _keepObserved;
function _setKeepObserved(keepObserved2) {
  _keepObserved = keepObserved2;
}
var _debugGetObservableGraph;
function _setDebugGetObservableGraph(debugGetObservableGraph2) {
  _debugGetObservableGraph = debugGetObservableGraph2;
}
var ConvenientObservable = class {
  get TChange() {
    return null;
  }
  reportChanges() {
    this.get();
  }
  /** @sealed */
  read(reader) {
    if (reader) {
      return reader.readObservable(this);
    } else {
      return this.get();
    }
  }
  map(fnOrOwner, fnOrUndefined, debugLocation = DebugLocation.ofCaller()) {
    const owner = fnOrUndefined === void 0 ? void 0 : fnOrOwner;
    const fn = fnOrUndefined === void 0 ? fnOrOwner : fnOrUndefined;
    return _derived(
      {
        owner,
        debugName: () => {
          const name = getFunctionName(fn);
          if (name !== void 0) {
            return name;
          }
          const regexp = /^\s*\(?\s*([a-zA-Z_$][a-zA-Z_$0-9]*)\s*\)?\s*=>\s*\1(?:\??)\.([a-zA-Z_$][a-zA-Z_$0-9]*)\s*$/;
          const match = regexp.exec(fn.toString());
          if (match) {
            return `${this.debugName}.${match[2]}`;
          }
          if (!owner) {
            return `${this.debugName} (mapped)`;
          }
          return void 0;
        },
        debugReferenceFn: fn
      },
      (reader) => fn(this.read(reader), reader),
      debugLocation
    );
  }
  /**
   * @sealed
   * Converts an observable of an observable value into a direct observable of the value.
  */
  flatten() {
    return _derived(
      {
        owner: void 0,
        debugName: () => `${this.debugName} (flattened)`
      },
      (reader) => this.read(reader).read(reader)
    );
  }
  recomputeInitiallyAndOnChange(store, handleValue) {
    store.add(_recomputeInitiallyAndOnChange(this, handleValue));
    return this;
  }
  /**
   * Ensures that this observable is observed. This keeps the cache alive.
   * However, in case of deriveds, it does not force eager evaluation (only when the value is read/get).
   * Use `recomputeInitiallyAndOnChange` for eager evaluation.
   */
  keepObserved(store) {
    store.add(_keepObserved(this));
    return this;
  }
  get debugValue() {
    return this.get();
  }
  get debug() {
    return new DebugHelper(this);
  }
};
var DebugHelper = class {
  constructor(observable) {
    this.observable = observable;
  }
  getDependencyGraph() {
    return _debugGetObservableGraph(this.observable, { type: "dependencies" });
  }
  getObserverGraph() {
    return _debugGetObservableGraph(this.observable, { type: "observers" });
  }
};
var BaseObservable = class extends ConvenientObservable {
  constructor(debugLocation) {
    super();
    this._observers = /* @__PURE__ */ new Set();
    getLogger()?.handleObservableCreated(this, debugLocation);
  }
  addObserver(observer) {
    const len = this._observers.size;
    this._observers.add(observer);
    if (len === 0) {
      this.onFirstObserverAdded();
    }
    if (len !== this._observers.size) {
      getLogger()?.handleOnListenerCountChanged(this, this._observers.size);
    }
  }
  removeObserver(observer) {
    const deleted = this._observers.delete(observer);
    if (deleted && this._observers.size === 0) {
      this.onLastObserverRemoved();
    }
    if (deleted) {
      getLogger()?.handleOnListenerCountChanged(this, this._observers.size);
    }
  }
  onFirstObserverAdded() {
  }
  onLastObserverRemoved() {
  }
  log() {
    const hadLogger = !!getLogger();
    logObservable(this);
    if (!hadLogger) {
      getLogger()?.handleObservableCreated(this, DebugLocation.ofCaller());
    }
    return this;
  }
  debugGetObservers() {
    return this._observers;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/observables/observableValue.ts
function observableValue(nameOrOwner, initialValue, debugLocation = DebugLocation.ofCaller()) {
  let debugNameData;
  if (typeof nameOrOwner === "string") {
    debugNameData = new DebugNameData(void 0, nameOrOwner, void 0);
  } else {
    debugNameData = new DebugNameData(nameOrOwner, void 0, void 0);
  }
  return new ObservableValue(debugNameData, initialValue, strictEquals, debugLocation);
}
var ObservableValue = class extends BaseObservable {
  constructor(_debugNameData, initialValue, _equalityComparator, debugLocation) {
    super(debugLocation);
    this._debugNameData = _debugNameData;
    this._equalityComparator = _equalityComparator;
    this._value = initialValue;
    getLogger()?.handleObservableUpdated(this, { hadValue: false, newValue: initialValue, change: void 0, didChange: true, oldValue: void 0 });
  }
  get debugName() {
    return this._debugNameData.getDebugName(this) ?? "ObservableValue";
  }
  get() {
    return this._value;
  }
  set(value, tx, change) {
    if (change === void 0 && this._equalityComparator(this._value, value)) {
      return;
    }
    let _tx;
    if (!tx) {
      tx = _tx = new TransactionImpl(() => {
      }, () => `Setting ${this.debugName}`);
    }
    try {
      const oldValue = this._value;
      this._setValue(value);
      getLogger()?.handleObservableUpdated(this, { oldValue, newValue: value, change, didChange: true, hadValue: true });
      for (const observer of this._observers) {
        tx.updateObserver(observer, this);
        observer.handleChange(this, change);
      }
    } finally {
      if (_tx) {
        _tx.finish();
      }
    }
  }
  toString() {
    return `${this.debugName}: ${this._value}`;
  }
  _setValue(newValue) {
    this._value = newValue;
  }
  debugGetState() {
    return {
      value: this._value
    };
  }
  debugSetValue(value) {
    this._value = value;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/reactions/autorunImpl.ts
function autorunStateToString(state) {
  switch (state) {
    case 1 /* dependenciesMightHaveChanged */:
      return "dependenciesMightHaveChanged";
    case 2 /* stale */:
      return "stale";
    case 3 /* upToDate */:
      return "upToDate";
    default:
      return "<unknown>";
  }
}
var AutorunObserver = class {
  constructor(_debugNameData, _runFn, _changeTracker, debugLocation) {
    this._debugNameData = _debugNameData;
    this._runFn = _runFn;
    this._changeTracker = _changeTracker;
    this._state = 2 /* stale */;
    this._updateCount = 0;
    this._disposed = false;
    this._dependencies = /* @__PURE__ */ new Set();
    this._dependenciesToBeRemoved = /* @__PURE__ */ new Set();
    this._isRunning = false;
    this._iteration = 0;
    this._store = void 0;
    this._delayedStore = void 0;
    this._changeSummary = this._changeTracker?.createChangeSummary(void 0);
    getLogger()?.handleAutorunCreated(this, debugLocation);
    this._run();
    trackDisposable(this);
  }
  get debugName() {
    return this._debugNameData.getDebugName(this) ?? "(anonymous)";
  }
  dispose() {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    for (const o of this._dependencies) {
      o.removeObserver(this);
    }
    this._dependencies.clear();
    if (this._store !== void 0) {
      this._store.dispose();
    }
    if (this._delayedStore !== void 0) {
      this._delayedStore.dispose();
    }
    getLogger()?.handleAutorunDisposed(this);
    markAsDisposed(this);
  }
  _run() {
    const emptySet = this._dependenciesToBeRemoved;
    this._dependenciesToBeRemoved = this._dependencies;
    this._dependencies = emptySet;
    this._state = 3 /* upToDate */;
    try {
      if (!this._disposed) {
        getLogger()?.handleAutorunStarted(this);
        const changeSummary = this._changeSummary;
        const delayedStore = this._delayedStore;
        if (delayedStore !== void 0) {
          this._delayedStore = void 0;
        }
        try {
          this._isRunning = true;
          if (this._changeTracker) {
            this._changeTracker.beforeUpdate?.(this, changeSummary);
            this._changeSummary = this._changeTracker.createChangeSummary(changeSummary);
          }
          if (this._store !== void 0) {
            this._store.dispose();
            this._store = void 0;
          }
          this._runFn(this, changeSummary);
        } catch (e) {
          onBugIndicatingError(e);
        } finally {
          this._isRunning = false;
          if (delayedStore !== void 0) {
            delayedStore.dispose();
          }
        }
      }
    } finally {
      if (!this._disposed) {
        getLogger()?.handleAutorunFinished(this);
      }
      for (const o of this._dependenciesToBeRemoved) {
        o.removeObserver(this);
      }
      this._dependenciesToBeRemoved.clear();
    }
  }
  toString() {
    return `Autorun<${this.debugName}>`;
  }
  // IObserver implementation
  beginUpdate(_observable) {
    if (this._state === 3 /* upToDate */) {
      this._checkIterations();
      this._state = 1 /* dependenciesMightHaveChanged */;
    }
    this._updateCount++;
  }
  endUpdate(_observable) {
    try {
      if (this._updateCount === 1) {
        this._iteration = 1;
        do {
          if (this._checkIterations()) {
            return;
          }
          if (this._state === 1 /* dependenciesMightHaveChanged */) {
            this._state = 3 /* upToDate */;
            for (const d of this._dependencies) {
              d.reportChanges();
              if (this._state === 2 /* stale */) {
                break;
              }
            }
          }
          this._iteration++;
          if (this._state !== 3 /* upToDate */) {
            this._run();
          }
        } while (this._state !== 3 /* upToDate */);
      }
    } finally {
      this._updateCount--;
    }
    assertFn(() => this._updateCount >= 0);
  }
  handlePossibleChange(observable) {
    if (this._state === 3 /* upToDate */ && this._isDependency(observable)) {
      this._checkIterations();
      this._state = 1 /* dependenciesMightHaveChanged */;
    }
  }
  handleChange(observable, change) {
    if (this._isDependency(observable)) {
      getLogger()?.handleAutorunDependencyChanged(this, observable, change);
      try {
        const shouldReact = this._changeTracker ? this._changeTracker.handleChange({
          changedObservable: observable,
          change,
          // eslint-disable-next-line local/code-no-any-casts
          didChange: (o) => o === observable
        }, this._changeSummary) : true;
        if (shouldReact) {
          this._checkIterations();
          this._state = 2 /* stale */;
        }
      } catch (e) {
        onBugIndicatingError(e);
      }
    }
  }
  _isDependency(observable) {
    return this._dependencies.has(observable) && !this._dependenciesToBeRemoved.has(observable);
  }
  // IReader implementation
  _ensureNoRunning() {
    if (!this._isRunning) {
      throw new BugIndicatingError("The reader object cannot be used outside its compute function!");
    }
  }
  readObservable(observable) {
    this._ensureNoRunning();
    if (this._disposed) {
      return observable.get();
    }
    observable.addObserver(this);
    const value = observable.get();
    this._dependencies.add(observable);
    this._dependenciesToBeRemoved.delete(observable);
    return value;
  }
  get store() {
    this._ensureNoRunning();
    if (this._disposed) {
      throw new BugIndicatingError("Cannot access store after dispose");
    }
    if (this._store === void 0) {
      this._store = new DisposableStore();
    }
    return this._store;
  }
  get delayedStore() {
    this._ensureNoRunning();
    if (this._disposed) {
      throw new BugIndicatingError("Cannot access store after dispose");
    }
    if (this._delayedStore === void 0) {
      this._delayedStore = new DisposableStore();
    }
    return this._delayedStore;
  }
  debugGetState() {
    return {
      isRunning: this._isRunning,
      updateCount: this._updateCount,
      dependencies: this._dependencies,
      state: this._state,
      stateStr: autorunStateToString(this._state)
    };
  }
  debugRerun() {
    if (!this._isRunning) {
      this._run();
    } else {
      this._state = 2 /* stale */;
    }
  }
  _checkIterations() {
    if (this._iteration > 100) {
      onBugIndicatingError(new BugIndicatingError(`Autorun '${this.debugName}' is stuck in an infinite update loop.`));
      return true;
    }
    return false;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/observables/derivedImpl.ts
function derivedStateToString(state) {
  switch (state) {
    case 0 /* initial */:
      return "initial";
    case 1 /* dependenciesMightHaveChanged */:
      return "dependenciesMightHaveChanged";
    case 2 /* stale */:
      return "stale";
    case 3 /* upToDate */:
      return "upToDate";
    default:
      return "<unknown>";
  }
}
var Derived = class extends BaseObservable {
  constructor(_debugNameData, _computeFn, _changeTracker, _handleLastObserverRemoved = void 0, _equalityComparator, debugLocation) {
    super(debugLocation);
    this._debugNameData = _debugNameData;
    this._computeFn = _computeFn;
    this._changeTracker = _changeTracker;
    this._handleLastObserverRemoved = _handleLastObserverRemoved;
    this._equalityComparator = _equalityComparator;
    this._state = 0 /* initial */;
    this._value = void 0;
    this._updateCount = 0;
    this._dependencies = /* @__PURE__ */ new Set();
    this._dependenciesToBeRemoved = /* @__PURE__ */ new Set();
    this._changeSummary = void 0;
    this._isUpdating = false;
    this._isComputing = false;
    this._didReportChange = false;
    this._isInBeforeUpdate = false;
    this._isReaderValid = false;
    this._store = void 0;
    this._delayedStore = void 0;
    this._removedObserverToCallEndUpdateOn = null;
    this._changeSummary = this._changeTracker?.createChangeSummary(void 0);
  }
  get debugName() {
    return this._debugNameData.getDebugName(this) ?? "(anonymous)";
  }
  onLastObserverRemoved() {
    this._state = 0 /* initial */;
    this._value = void 0;
    getLogger()?.handleDerivedCleared(this);
    for (const d of this._dependencies) {
      d.removeObserver(this);
    }
    this._dependencies.clear();
    if (this._store !== void 0) {
      this._store.dispose();
      this._store = void 0;
    }
    if (this._delayedStore !== void 0) {
      this._delayedStore.dispose();
      this._delayedStore = void 0;
    }
    this._handleLastObserverRemoved?.();
  }
  get() {
    const checkEnabled = false;
    if (this._isComputing && checkEnabled) {
      throw new BugIndicatingError("Cyclic deriveds are not supported yet!");
    }
    if (this._observers.size === 0) {
      let result;
      try {
        this._isReaderValid = true;
        let changeSummary = void 0;
        if (this._changeTracker) {
          changeSummary = this._changeTracker.createChangeSummary(void 0);
          this._changeTracker.beforeUpdate?.(this, changeSummary);
        }
        result = this._computeFn(this, changeSummary);
      } finally {
        this._isReaderValid = false;
      }
      this.onLastObserverRemoved();
      return result;
    } else {
      do {
        if (this._state === 1 /* dependenciesMightHaveChanged */) {
          for (const d of this._dependencies) {
            d.reportChanges();
            if (this._state === 2 /* stale */) {
              break;
            }
          }
        }
        if (this._state === 1 /* dependenciesMightHaveChanged */) {
          this._state = 3 /* upToDate */;
        }
        if (this._state !== 3 /* upToDate */) {
          this._recompute();
        }
      } while (this._state !== 3 /* upToDate */);
      return this._value;
    }
  }
  _recompute() {
    let didChange = false;
    this._isComputing = true;
    this._didReportChange = false;
    const emptySet = this._dependenciesToBeRemoved;
    this._dependenciesToBeRemoved = this._dependencies;
    this._dependencies = emptySet;
    try {
      const changeSummary = this._changeSummary;
      this._isReaderValid = true;
      if (this._changeTracker) {
        this._isInBeforeUpdate = true;
        this._changeTracker.beforeUpdate?.(this, changeSummary);
        this._isInBeforeUpdate = false;
        this._changeSummary = this._changeTracker?.createChangeSummary(changeSummary);
      }
      const hadValue = this._state !== 0 /* initial */;
      const oldValue = this._value;
      this._state = 3 /* upToDate */;
      const delayedStore = this._delayedStore;
      if (delayedStore !== void 0) {
        this._delayedStore = void 0;
      }
      try {
        if (this._store !== void 0) {
          this._store.dispose();
          this._store = void 0;
        }
        this._value = this._computeFn(this, changeSummary);
      } finally {
        this._isReaderValid = false;
        for (const o of this._dependenciesToBeRemoved) {
          o.removeObserver(this);
        }
        this._dependenciesToBeRemoved.clear();
        if (delayedStore !== void 0) {
          delayedStore.dispose();
        }
      }
      didChange = this._didReportChange || hadValue && !this._equalityComparator(oldValue, this._value);
      getLogger()?.handleObservableUpdated(this, {
        oldValue,
        newValue: this._value,
        change: void 0,
        didChange,
        hadValue
      });
    } catch (e) {
      onBugIndicatingError(e);
    }
    this._isComputing = false;
    if (!this._didReportChange && didChange) {
      for (const r of this._observers) {
        r.handleChange(this, void 0);
      }
    } else {
      this._didReportChange = false;
    }
  }
  toString() {
    return `LazyDerived<${this.debugName}>`;
  }
  // IObserver Implementation
  beginUpdate(_observable) {
    if (this._isUpdating) {
      throw new BugIndicatingError("Cyclic deriveds are not supported yet!");
    }
    this._updateCount++;
    this._isUpdating = true;
    try {
      const propagateBeginUpdate = this._updateCount === 1;
      if (this._state === 3 /* upToDate */) {
        this._state = 1 /* dependenciesMightHaveChanged */;
        if (!propagateBeginUpdate) {
          for (const r of this._observers) {
            r.handlePossibleChange(this);
          }
        }
      }
      if (propagateBeginUpdate) {
        for (const r of this._observers) {
          r.beginUpdate(this);
        }
      }
    } finally {
      this._isUpdating = false;
    }
  }
  endUpdate(_observable) {
    this._updateCount--;
    if (this._updateCount === 0) {
      const observers = [...this._observers];
      for (const r of observers) {
        r.endUpdate(this);
      }
      if (this._removedObserverToCallEndUpdateOn) {
        const observers2 = [...this._removedObserverToCallEndUpdateOn];
        this._removedObserverToCallEndUpdateOn = null;
        for (const r of observers2) {
          r.endUpdate(this);
        }
      }
    }
    assertFn(() => this._updateCount >= 0);
  }
  handlePossibleChange(observable) {
    if (this._state === 3 /* upToDate */ && this._dependencies.has(observable) && !this._dependenciesToBeRemoved.has(observable)) {
      this._state = 1 /* dependenciesMightHaveChanged */;
      for (const r of this._observers) {
        r.handlePossibleChange(this);
      }
    }
  }
  handleChange(observable, change) {
    if (this._dependencies.has(observable) && !this._dependenciesToBeRemoved.has(observable) || this._isInBeforeUpdate) {
      getLogger()?.handleDerivedDependencyChanged(this, observable, change);
      let shouldReact = false;
      try {
        shouldReact = this._changeTracker ? this._changeTracker.handleChange({
          changedObservable: observable,
          change,
          // eslint-disable-next-line local/code-no-any-casts
          didChange: (o) => o === observable
        }, this._changeSummary) : true;
      } catch (e) {
        onBugIndicatingError(e);
      }
      const wasUpToDate = this._state === 3 /* upToDate */;
      if (shouldReact && (this._state === 1 /* dependenciesMightHaveChanged */ || wasUpToDate)) {
        this._state = 2 /* stale */;
        if (wasUpToDate) {
          for (const r of this._observers) {
            r.handlePossibleChange(this);
          }
        }
      }
    }
  }
  // IReader Implementation
  _ensureReaderValid() {
    if (!this._isReaderValid) {
      throw new BugIndicatingError("The reader object cannot be used outside its compute function!");
    }
  }
  readObservable(observable) {
    this._ensureReaderValid();
    observable.addObserver(this);
    const value = observable.get();
    this._dependencies.add(observable);
    this._dependenciesToBeRemoved.delete(observable);
    return value;
  }
  reportChange(change) {
    this._ensureReaderValid();
    this._didReportChange = true;
    for (const r of this._observers) {
      r.handleChange(this, change);
    }
  }
  get store() {
    this._ensureReaderValid();
    if (this._store === void 0) {
      this._store = new DisposableStore();
    }
    return this._store;
  }
  get delayedStore() {
    this._ensureReaderValid();
    if (this._delayedStore === void 0) {
      this._delayedStore = new DisposableStore();
    }
    return this._delayedStore;
  }
  addObserver(observer) {
    const shouldCallBeginUpdate = !this._observers.has(observer) && this._updateCount > 0;
    super.addObserver(observer);
    if (shouldCallBeginUpdate) {
      if (!this._removedObserverToCallEndUpdateOn?.delete(observer)) {
        observer.beginUpdate(this);
      }
    }
  }
  removeObserver(observer) {
    if (this._observers.has(observer) && this._updateCount > 0) {
      if (!this._removedObserverToCallEndUpdateOn) {
        this._removedObserverToCallEndUpdateOn = /* @__PURE__ */ new Set();
      }
      this._removedObserverToCallEndUpdateOn.add(observer);
    }
    super.removeObserver(observer);
  }
  debugGetState() {
    return {
      state: this._state,
      stateStr: derivedStateToString(this._state),
      updateCount: this._updateCount,
      isComputing: this._isComputing,
      dependencies: this._dependencies,
      value: this._value
    };
  }
  debugSetValue(newValue) {
    this._value = newValue;
  }
  debugRecompute() {
    if (!this._isComputing) {
      this._recompute();
    } else {
      this._state = 2 /* stale */;
    }
  }
  setValue(newValue, tx, change) {
    this._value = newValue;
    const observers = this._observers;
    tx.updateObserver(this, this);
    for (const d of observers) {
      d.handleChange(this, change);
    }
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/observables/derived.ts
function derived(computeFnOrOwner, computeFn, debugLocation = DebugLocation.ofCaller()) {
  if (computeFn !== void 0) {
    return new Derived(
      new DebugNameData(computeFnOrOwner, void 0, computeFn),
      computeFn,
      void 0,
      void 0,
      strictEquals,
      debugLocation
    );
  }
  return new Derived(
    // eslint-disable-next-line local/code-no-any-casts
    new DebugNameData(void 0, void 0, computeFnOrOwner),
    // eslint-disable-next-line local/code-no-any-casts
    computeFnOrOwner,
    void 0,
    void 0,
    strictEquals,
    debugLocation
  );
}
function derivedOpts(options, computeFn, debugLocation = DebugLocation.ofCaller()) {
  return new Derived(
    new DebugNameData(options.owner, options.debugName, options.debugReferenceFn),
    computeFn,
    void 0,
    options.onLastObserverRemoved,
    options.equalsFn ?? strictEquals,
    debugLocation
  );
}
_setDerivedOpts(derivedOpts);

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/observables/observableFromEvent.ts
function observableFromEvent(...args) {
  let owner;
  let event;
  let getValue;
  let debugLocation;
  if (args.length === 2) {
    [event, getValue] = args;
  } else {
    [owner, event, getValue, debugLocation] = args;
  }
  return new FromEventObservable(
    new DebugNameData(owner, void 0, getValue),
    event,
    getValue,
    () => FromEventObservable.globalTransaction,
    strictEquals,
    debugLocation ?? DebugLocation.ofCaller()
  );
}
var FromEventObservable = class extends BaseObservable {
  constructor(_debugNameData, event, _getValue, _getTransaction, _equalityComparator, debugLocation) {
    super(debugLocation);
    this._debugNameData = _debugNameData;
    this.event = event;
    this._getValue = _getValue;
    this._getTransaction = _getTransaction;
    this._equalityComparator = _equalityComparator;
    this._hasValue = false;
    this.handleEvent = (args) => {
      const newValue = this._getValue(args);
      const oldValue = this._value;
      const didChange = !this._hasValue || !this._equalityComparator(oldValue, newValue);
      let didRunTransaction = false;
      if (didChange) {
        this._value = newValue;
        if (this._hasValue) {
          didRunTransaction = true;
          subtransaction(
            this._getTransaction(),
            (tx) => {
              getLogger()?.handleObservableUpdated(this, { oldValue, newValue, change: void 0, didChange, hadValue: this._hasValue });
              for (const o of this._observers) {
                tx.updateObserver(o, this);
                o.handleChange(this, void 0);
              }
            },
            () => {
              const name = this.getDebugName();
              return "Event fired" + (name ? `: ${name}` : "");
            }
          );
        }
        this._hasValue = true;
      }
      if (!didRunTransaction) {
        getLogger()?.handleObservableUpdated(this, { oldValue, newValue, change: void 0, didChange, hadValue: this._hasValue });
      }
    };
  }
  getDebugName() {
    return this._debugNameData.getDebugName(this);
  }
  get debugName() {
    const name = this.getDebugName();
    return "From Event" + (name ? `: ${name}` : "");
  }
  onFirstObserverAdded() {
    this._subscription = this.event(this.handleEvent);
  }
  onLastObserverRemoved() {
    this._subscription.dispose();
    this._subscription = void 0;
    this._hasValue = false;
    this._value = void 0;
  }
  get() {
    if (this._subscription) {
      if (!this._hasValue) {
        this.handleEvent(void 0);
      }
      return this._value;
    } else {
      const value = this._getValue(void 0);
      return value;
    }
  }
  debugSetValue(value) {
    this._value = value;
  }
  debugGetState() {
    return { value: this._value, hasValue: this._hasValue };
  }
};
((observableFromEvent2) => {
  observableFromEvent2.Observer = FromEventObservable;
  function batchEventsGlobally(tx, fn) {
    let didSet = false;
    if (FromEventObservable.globalTransaction === void 0) {
      FromEventObservable.globalTransaction = tx;
      didSet = true;
    }
    try {
      fn();
    } finally {
      if (didSet) {
        FromEventObservable.globalTransaction = void 0;
      }
    }
  }
  observableFromEvent2.batchEventsGlobally = batchEventsGlobally;
})(observableFromEvent || (observableFromEvent = {}));

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/utils/utils.ts
function keepObserved(observable) {
  const o = new KeepAliveObserver(false, void 0);
  observable.addObserver(o);
  return toDisposable(() => {
    observable.removeObserver(o);
  });
}
_setKeepObserved(keepObserved);
function recomputeInitiallyAndOnChange(observable, handleValue) {
  const o = new KeepAliveObserver(true, handleValue);
  observable.addObserver(o);
  try {
    o.beginUpdate(observable);
  } finally {
    o.endUpdate(observable);
  }
  return toDisposable(() => {
    observable.removeObserver(o);
  });
}
_setRecomputeInitiallyAndOnChange(recomputeInitiallyAndOnChange);
var KeepAliveObserver = class {
  constructor(_forceRecompute, _handleValue) {
    this._forceRecompute = _forceRecompute;
    this._handleValue = _handleValue;
    this._counter = 0;
  }
  beginUpdate(observable) {
    this._counter++;
  }
  endUpdate(observable) {
    if (this._counter === 1 && this._forceRecompute) {
      if (this._handleValue) {
        this._handleValue(observable.get());
      } else {
        observable.reportChanges();
      }
    }
    this._counter--;
  }
  handlePossibleChange(observable) {
  }
  handleChange(observable, change) {
  }
};
function isObservable(obj) {
  return !!obj && obj.read !== void 0 && obj.reportChanges !== void 0;
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/logging/consoleObservableLogger.ts
var consoleObservableLogger;
function logObservableToConsole(obs) {
  if (!consoleObservableLogger) {
    consoleObservableLogger = new ConsoleObservableLogger();
    addLogger(consoleObservableLogger);
  }
  consoleObservableLogger.addFilteredObj(obs);
}
var ConsoleObservableLogger = class {
  constructor() {
    this.indentation = 0;
    this.changedObservablesSets = /* @__PURE__ */ new WeakMap();
  }
  addFilteredObj(obj) {
    if (!this._filteredObjects) {
      this._filteredObjects = /* @__PURE__ */ new Set();
    }
    this._filteredObjects.add(obj);
  }
  _isIncluded(obj) {
    return this._filteredObjects?.has(obj) ?? true;
  }
  textToConsoleArgs(text) {
    return consoleTextToArgs([
      normalText(repeat("|  ", this.indentation)),
      text
    ]);
  }
  formatInfo(info) {
    if (!info.hadValue) {
      return [
        normalText(` `),
        styled(formatValue(info.newValue, 60), {
          color: "green"
        }),
        normalText(` (initial)`)
      ];
    }
    return info.didChange ? [
      normalText(` `),
      styled(formatValue(info.oldValue, 70), {
        color: "red",
        strikeThrough: true
      }),
      normalText(` `),
      styled(formatValue(info.newValue, 60), {
        color: "green"
      })
    ] : [normalText(` (unchanged)`)];
  }
  handleObservableCreated(observable) {
    if (observable instanceof Derived) {
      const derived2 = observable;
      this.changedObservablesSets.set(derived2, /* @__PURE__ */ new Set());
      const debugTrackUpdating = false;
      if (debugTrackUpdating) {
        const updating = [];
        derived2.__debugUpdating = updating;
        const existingBeginUpdate = derived2.beginUpdate;
        derived2.beginUpdate = (obs) => {
          updating.push(obs);
          return existingBeginUpdate.apply(derived2, [obs]);
        };
        const existingEndUpdate = derived2.endUpdate;
        derived2.endUpdate = (obs) => {
          const idx = updating.indexOf(obs);
          if (idx === -1) {
            console.error("endUpdate called without beginUpdate", derived2.debugName, obs.debugName);
          }
          updating.splice(idx, 1);
          return existingEndUpdate.apply(derived2, [obs]);
        };
      }
    }
  }
  handleOnListenerCountChanged(observable, newCount) {
  }
  handleObservableUpdated(observable, info) {
    if (!this._isIncluded(observable)) {
      return;
    }
    if (observable instanceof Derived) {
      this._handleDerivedRecomputed(observable, info);
      return;
    }
    console.log(...this.textToConsoleArgs([
      formatKind("observable value changed"),
      styled(observable.debugName, { color: "BlueViolet" }),
      ...this.formatInfo(info)
    ]));
  }
  formatChanges(changes) {
    if (changes.size === 0) {
      return void 0;
    }
    return styled(
      " (changed deps: " + [...changes].map((o) => o.debugName).join(", ") + ")",
      { color: "gray" }
    );
  }
  handleDerivedDependencyChanged(derived2, observable, change) {
    if (!this._isIncluded(derived2)) {
      return;
    }
    this.changedObservablesSets.get(derived2)?.add(observable);
  }
  _handleDerivedRecomputed(derived2, info) {
    if (!this._isIncluded(derived2)) {
      return;
    }
    const changedObservables = this.changedObservablesSets.get(derived2);
    if (!changedObservables) {
      return;
    }
    console.log(...this.textToConsoleArgs([
      formatKind("derived recomputed"),
      styled(derived2.debugName, { color: "BlueViolet" }),
      ...this.formatInfo(info),
      this.formatChanges(changedObservables),
      { data: [{ fn: derived2._debugNameData.referenceFn ?? derived2._computeFn }] }
    ]));
    changedObservables.clear();
  }
  handleDerivedCleared(derived2) {
    if (!this._isIncluded(derived2)) {
      return;
    }
    console.log(...this.textToConsoleArgs([
      formatKind("derived cleared"),
      styled(derived2.debugName, { color: "BlueViolet" })
    ]));
  }
  handleFromEventObservableTriggered(observable, info) {
    if (!this._isIncluded(observable)) {
      return;
    }
    console.log(...this.textToConsoleArgs([
      formatKind("observable from event triggered"),
      styled(observable.debugName, { color: "BlueViolet" }),
      ...this.formatInfo(info),
      { data: [{ fn: observable._getValue }] }
    ]));
  }
  handleAutorunCreated(autorun2) {
    if (!this._isIncluded(autorun2)) {
      return;
    }
    this.changedObservablesSets.set(autorun2, /* @__PURE__ */ new Set());
  }
  handleAutorunDisposed(autorun2) {
  }
  handleAutorunDependencyChanged(autorun2, observable, change) {
    if (!this._isIncluded(autorun2)) {
      return;
    }
    this.changedObservablesSets.get(autorun2).add(observable);
  }
  handleAutorunStarted(autorun2) {
    const changedObservables = this.changedObservablesSets.get(autorun2);
    if (!changedObservables) {
      return;
    }
    if (this._isIncluded(autorun2)) {
      console.log(...this.textToConsoleArgs([
        formatKind("autorun"),
        styled(autorun2.debugName, { color: "BlueViolet" }),
        this.formatChanges(changedObservables),
        { data: [{ fn: autorun2._debugNameData.referenceFn ?? autorun2._runFn }] }
      ]));
    }
    changedObservables.clear();
    this.indentation++;
  }
  handleAutorunFinished(autorun2) {
    this.indentation--;
  }
  handleBeginTransaction(transaction2) {
    let transactionName = transaction2.getDebugName();
    if (transactionName === void 0) {
      transactionName = "";
    }
    if (this._isIncluded(transaction2)) {
      console.log(...this.textToConsoleArgs([
        formatKind("transaction"),
        styled(transactionName, { color: "BlueViolet" }),
        { data: [{ fn: transaction2._fn }] }
      ]));
    }
    this.indentation++;
  }
  handleEndTransaction() {
    this.indentation--;
  }
};
function consoleTextToArgs(text) {
  const styles = new Array();
  const data = [];
  let firstArg = "";
  function process2(t) {
    if ("length" in t) {
      for (const item of t) {
        if (item) {
          process2(item);
        }
      }
    } else if ("text" in t) {
      firstArg += `%c${t.text}`;
      styles.push(t.style);
      if (t.data) {
        data.push(...t.data);
      }
    } else if ("data" in t) {
      data.push(...t.data);
    }
  }
  process2(text);
  const result = [firstArg, ...styles];
  result.push(...data);
  return result;
}
function normalText(text) {
  return styled(text, { color: "black" });
}
function formatKind(kind) {
  return styled(padStr(`${kind}: `, 10), { color: "black", bold: true });
}
function styled(text, options = {
  color: "black"
}) {
  function objToCss(styleObj) {
    return Object.entries(styleObj).reduce(
      (styleString, [propName, propValue]) => {
        return `${styleString}${propName}:${propValue};`;
      },
      ""
    );
  }
  const style = {
    color: options.color
  };
  if (options.strikeThrough) {
    style["text-decoration"] = "line-through";
  }
  if (options.bold) {
    style["font-weight"] = "bold";
  }
  return {
    text,
    style: objToCss(style)
  };
}
function formatValue(value, availableLen) {
  switch (typeof value) {
    case "number":
      return "" + value;
    case "string":
      if (value.length + 2 <= availableLen) {
        return `"${value}"`;
      }
      return `"${value.substr(0, availableLen - 7)}"+...`;
    case "boolean":
      return value ? "true" : "false";
    case "undefined":
      return "undefined";
    case "object":
      if (value === null) {
        return "null";
      }
      if (Array.isArray(value)) {
        return formatArray(value, availableLen);
      }
      return formatObject(value, availableLen);
    case "symbol":
      return value.toString();
    case "function":
      return `[[Function${value.name ? " " + value.name : ""}]]`;
    default:
      return "" + value;
  }
}
function formatArray(value, availableLen) {
  let result = "[ ";
  let first = true;
  for (const val of value) {
    if (!first) {
      result += ", ";
    }
    if (result.length - 5 > availableLen) {
      result += "...";
      break;
    }
    first = false;
    result += `${formatValue(val, availableLen - result.length)}`;
  }
  result += " ]";
  return result;
}
function formatObject(value, availableLen) {
  if (typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
    const val = value.toString();
    if (val.length <= availableLen) {
      return val;
    }
    return val.substring(0, availableLen - 3) + "...";
  }
  const className = getClassName(value);
  let result = className ? className + "(" : "{ ";
  let first = true;
  for (const [key, val] of Object.entries(value)) {
    if (!first) {
      result += ", ";
    }
    if (result.length - 5 > availableLen) {
      result += "...";
      break;
    }
    first = false;
    result += `${key}: ${formatValue(val, availableLen - result.length)}`;
  }
  result += className ? ")" : " }";
  return result;
}
function repeat(str, count) {
  let result = "";
  for (let i = 1; i <= count; i++) {
    result += str;
  }
  return result;
}
function padStr(str, length) {
  while (str.length < length) {
    str += " ";
  }
  return str;
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/logging/debugger/rpc.ts
var SimpleTypedRpcConnection = class _SimpleTypedRpcConnection {
  constructor(_channelFactory, _getHandler) {
    this._channelFactory = _channelFactory;
    this._getHandler = _getHandler;
    this._channel = this._channelFactory({
      handleNotification: (notificationData) => {
        const m = notificationData;
        const fn = this._getHandler().notifications[m[0]];
        if (!fn) {
          throw new Error(`Unknown notification "${m[0]}"!`);
        }
        fn(...m[1]);
      },
      handleRequest: (requestData) => {
        const m = requestData;
        try {
          const result = this._getHandler().requests[m[0]](...m[1]);
          return { type: "result", value: result };
        } catch (e) {
          return { type: "error", value: e };
        }
      }
    });
    const requests = new Proxy({}, {
      get: (target, key) => {
        return async (...args) => {
          const result = await this._channel.sendRequest([key, args]);
          if (result.type === "error") {
            throw result.value;
          } else {
            return result.value;
          }
        };
      }
    });
    const notifications = new Proxy({}, {
      get: (target, key) => {
        return (...args) => {
          this._channel.sendNotification([key, args]);
        };
      }
    });
    this.api = { notifications, requests };
  }
  static createHost(channelFactory, getHandler) {
    return new _SimpleTypedRpcConnection(channelFactory, getHandler);
  }
  static createClient(channelFactory, getHandler) {
    return new _SimpleTypedRpcConnection(channelFactory, getHandler);
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/logging/debugger/debuggerRpc.ts
function registerDebugChannel(channelId, createClient) {
  const g = globalThis;
  let queuedNotifications = [];
  let curHost = void 0;
  const { channel, handler } = createChannelFactoryFromDebugChannel({
    sendNotification: (data) => {
      if (curHost) {
        curHost.sendNotification(data);
      } else {
        queuedNotifications.push(data);
      }
    }
  });
  let curClient = void 0;
  (g.$$debugValueEditor_debugChannels ?? (g.$$debugValueEditor_debugChannels = {}))[channelId] = (host) => {
    curClient = createClient();
    curHost = host;
    for (const n2 of queuedNotifications) {
      host.sendNotification(n2);
    }
    queuedNotifications = [];
    return handler;
  };
  return SimpleTypedRpcConnection.createClient(channel, () => {
    if (!curClient) {
      throw new Error("Not supported");
    }
    return curClient;
  });
}
function createChannelFactoryFromDebugChannel(host) {
  let h;
  const channel = (handler) => {
    h = handler;
    return {
      sendNotification: (data) => {
        host.sendNotification(data);
      },
      sendRequest: (data) => {
        throw new Error("not supported");
      }
    };
  };
  return {
    channel,
    handler: {
      handleRequest: (data) => {
        if (data.type === "notification") {
          return h?.handleNotification(data.data);
        } else {
          return h?.handleRequest(data.data);
        }
      }
    }
  };
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/logging/debugger/utils.ts
var Throttler = class {
  constructor() {
    this._timeout = void 0;
  }
  throttle(fn, timeoutMs) {
    if (this._timeout === void 0) {
      this._timeout = setTimeout(() => {
        this._timeout = void 0;
        fn();
      }, timeoutMs);
    }
  }
  dispose() {
    if (this._timeout !== void 0) {
      clearTimeout(this._timeout);
    }
  }
};
function deepAssign(target, source) {
  for (const key in source) {
    if (!!target[key] && typeof target[key] === "object" && !!source[key] && typeof source[key] === "object") {
      deepAssign(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}
function deepAssignDeleteNulls(target, source) {
  for (const key in source) {
    if (source[key] === null) {
      delete target[key];
    } else if (!!target[key] && typeof target[key] === "object" && !!source[key] && typeof source[key] === "object") {
      deepAssignDeleteNulls(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/logging/debugger/devToolsLogger.ts
var DevToolsLogger = class _DevToolsLogger {
  constructor() {
    this._declarationId = 0;
    this._instanceId = 0;
    this._declarations = /* @__PURE__ */ new Map();
    this._instanceInfos = /* @__PURE__ */ new WeakMap();
    this._aliveInstances = /* @__PURE__ */ new Map();
    this._activeTransactions = /* @__PURE__ */ new Set();
    this._channel = registerDebugChannel("observableDevTools", () => {
      return {
        notifications: {
          setDeclarationIdFilter: (declarationIds) => {
          },
          logObservableValue: (observableId) => {
            console.log("logObservableValue", observableId);
          },
          flushUpdates: () => {
            this._flushUpdates();
          },
          resetUpdates: () => {
            this._pendingChanges = null;
            this._channel.api.notifications.handleChange(this._fullState, true);
          }
        },
        requests: {
          getDeclarations: () => {
            const result = {};
            for (const decl of this._declarations.values()) {
              result[decl.id] = decl;
            }
            return { decls: result };
          },
          getSummarizedInstances: () => {
            return null;
          },
          getObservableValueInfo: (instanceId) => {
            const obs = this._aliveInstances.get(instanceId);
            return {
              observers: [...obs.debugGetObservers()].map((d) => this._formatObserver(d)).filter(isDefined)
            };
          },
          getDerivedInfo: (instanceId) => {
            const d = this._aliveInstances.get(instanceId);
            return {
              dependencies: [...d.debugGetState().dependencies].map((d2) => this._formatObservable(d2)).filter(isDefined),
              observers: [...d.debugGetObservers()].map((d2) => this._formatObserver(d2)).filter(isDefined)
            };
          },
          getAutorunInfo: (instanceId) => {
            const obs = this._aliveInstances.get(instanceId);
            return {
              dependencies: [...obs.debugGetState().dependencies].map((d) => this._formatObservable(d)).filter(isDefined)
            };
          },
          getTransactionState: () => {
            return this.getTransactionState();
          },
          setValue: (instanceId, jsonValue) => {
            const obs = this._aliveInstances.get(instanceId);
            if (obs instanceof Derived) {
              obs.debugSetValue(jsonValue);
            } else if (obs instanceof ObservableValue) {
              obs.debugSetValue(jsonValue);
            } else if (obs instanceof FromEventObservable) {
              obs.debugSetValue(jsonValue);
            } else {
              throw new BugIndicatingError("Observable is not supported");
            }
            const observers = [...obs.debugGetObservers()];
            for (const d of observers) {
              d.beginUpdate(obs);
            }
            for (const d of observers) {
              d.handleChange(obs, void 0);
            }
            for (const d of observers) {
              d.endUpdate(obs);
            }
          },
          getValue: (instanceId) => {
            const obs = this._aliveInstances.get(instanceId);
            if (obs instanceof Derived) {
              return formatValue(obs.debugGetState().value, 200);
            } else if (obs instanceof ObservableValue) {
              return formatValue(obs.debugGetState().value, 200);
            }
            return void 0;
          },
          logValue: (instanceId) => {
            const obs = this._aliveInstances.get(instanceId);
            if (obs && "get" in obs) {
              console.log("Logged Value:", obs.get());
            } else {
              throw new BugIndicatingError("Observable is not supported");
            }
          },
          rerun: (instanceId) => {
            const obs = this._aliveInstances.get(instanceId);
            if (obs instanceof Derived) {
              obs.debugRecompute();
            } else if (obs instanceof AutorunObserver) {
              obs.debugRerun();
            } else {
              throw new BugIndicatingError("Observable is not supported");
            }
          }
        }
      };
    });
    this._pendingChanges = null;
    this._changeThrottler = new Throttler();
    this._fullState = {};
    this._flushUpdates = () => {
      if (this._pendingChanges !== null) {
        this._channel.api.notifications.handleChange(this._pendingChanges, false);
        this._pendingChanges = null;
      }
    };
    DebugLocation.enable();
  }
  static {
    this._instance = void 0;
  }
  static getInstance() {
    if (_DevToolsLogger._instance === void 0) {
      _DevToolsLogger._instance = new _DevToolsLogger();
    }
    return _DevToolsLogger._instance;
  }
  getTransactionState() {
    const affected = [];
    const txs = [...this._activeTransactions];
    if (txs.length === 0) {
      return void 0;
    }
    const observerQueue = txs.flatMap((t) => t.debugGetUpdatingObservers() ?? []).map((o) => o.observer);
    const processedObservers = /* @__PURE__ */ new Set();
    while (observerQueue.length > 0) {
      const observer = observerQueue.shift();
      if (processedObservers.has(observer)) {
        continue;
      }
      processedObservers.add(observer);
      const state = this._getInfo(observer, (d) => {
        if (!processedObservers.has(d)) {
          observerQueue.push(d);
        }
      });
      if (state) {
        affected.push(state);
      }
    }
    return { names: txs.map((t) => t.getDebugName() ?? "tx"), affected };
  }
  _getObservableInfo(observable) {
    const info = this._instanceInfos.get(observable);
    if (!info) {
      onUnexpectedError(new BugIndicatingError("No info found"));
      return void 0;
    }
    return info;
  }
  _getAutorunInfo(autorun2) {
    const info = this._instanceInfos.get(autorun2);
    if (!info) {
      onUnexpectedError(new BugIndicatingError("No info found"));
      return void 0;
    }
    return info;
  }
  _getInfo(observer, queue) {
    if (observer instanceof Derived) {
      const observersToUpdate = [...observer.debugGetObservers()];
      for (const o of observersToUpdate) {
        queue(o);
      }
      const info = this._getObservableInfo(observer);
      if (!info) {
        return;
      }
      const observerState = observer.debugGetState();
      const base = { name: observer.debugName, instanceId: info.instanceId, updateCount: observerState.updateCount };
      const changedDependencies = [...info.changedObservables].map((o) => this._instanceInfos.get(o)?.instanceId).filter(isDefined);
      if (observerState.isComputing) {
        return { ...base, type: "observable/derived", state: "updating", changedDependencies, initialComputation: false };
      }
      switch (observerState.state) {
        case 0 /* initial */:
          return { ...base, type: "observable/derived", state: "noValue" };
        case 3 /* upToDate */:
          return { ...base, type: "observable/derived", state: "upToDate" };
        case 2 /* stale */:
          return { ...base, type: "observable/derived", state: "stale", changedDependencies };
        case 1 /* dependenciesMightHaveChanged */:
          return { ...base, type: "observable/derived", state: "possiblyStale" };
      }
    } else if (observer instanceof AutorunObserver) {
      const info = this._getAutorunInfo(observer);
      if (!info) {
        return void 0;
      }
      const base = { name: observer.debugName, instanceId: info.instanceId, updateCount: info.updateCount };
      const changedDependencies = [...info.changedObservables].map((o) => this._instanceInfos.get(o).instanceId);
      if (observer.debugGetState().isRunning) {
        return { ...base, type: "autorun", state: "updating", changedDependencies };
      }
      switch (observer.debugGetState().state) {
        case 3 /* upToDate */:
          return { ...base, type: "autorun", state: "upToDate" };
        case 2 /* stale */:
          return { ...base, type: "autorun", state: "stale", changedDependencies };
        case 1 /* dependenciesMightHaveChanged */:
          return { ...base, type: "autorun", state: "possiblyStale" };
      }
    }
    return void 0;
  }
  _formatObservable(obs) {
    const info = this._getObservableInfo(obs);
    if (!info) {
      return void 0;
    }
    return { name: obs.debugName, instanceId: info.instanceId };
  }
  _formatObserver(obs) {
    if (obs instanceof Derived) {
      return { name: obs.toString(), instanceId: this._getObservableInfo(obs)?.instanceId };
    }
    const autorunInfo = this._getAutorunInfo(obs);
    if (autorunInfo) {
      return { name: obs.toString(), instanceId: autorunInfo.instanceId };
    }
    return void 0;
  }
  _handleChange(update) {
    deepAssignDeleteNulls(this._fullState, update);
    if (this._pendingChanges === null) {
      this._pendingChanges = update;
    } else {
      deepAssign(this._pendingChanges, update);
    }
    this._changeThrottler.throttle(this._flushUpdates, 10);
  }
  _getDeclarationId(type, location) {
    if (!location) {
      return -1;
    }
    let decInfo = this._declarations.get(location.id);
    if (decInfo === void 0) {
      decInfo = {
        id: this._declarationId++,
        type,
        url: location.fileName,
        line: location.line,
        column: location.column
      };
      this._declarations.set(location.id, decInfo);
      this._handleChange({ decls: { [decInfo.id]: decInfo } });
    }
    return decInfo.id;
  }
  handleObservableCreated(observable, location) {
    const declarationId = this._getDeclarationId("observable/value", location);
    const info = {
      declarationId,
      instanceId: this._instanceId++,
      listenerCount: 0,
      lastValue: void 0,
      updateCount: 0,
      changedObservables: /* @__PURE__ */ new Set()
    };
    this._instanceInfos.set(observable, info);
  }
  handleOnListenerCountChanged(observable, newCount) {
    const info = this._getObservableInfo(observable);
    if (!info) {
      return;
    }
    if (info.listenerCount === 0 && newCount > 0) {
      const type = observable instanceof Derived ? "observable/derived" : "observable/value";
      this._aliveInstances.set(info.instanceId, observable);
      this._handleChange({
        instances: {
          [info.instanceId]: {
            instanceId: info.instanceId,
            declarationId: info.declarationId,
            formattedValue: info.lastValue,
            type,
            name: observable.debugName
          }
        }
      });
    } else if (info.listenerCount > 0 && newCount === 0) {
      this._handleChange({
        instances: { [info.instanceId]: null }
      });
      this._aliveInstances.delete(info.instanceId);
    }
    info.listenerCount = newCount;
  }
  handleObservableUpdated(observable, changeInfo) {
    if (observable instanceof Derived) {
      this._handleDerivedRecomputed(observable, changeInfo);
      return;
    }
    const info = this._getObservableInfo(observable);
    if (info) {
      if (changeInfo.didChange) {
        info.lastValue = formatValue(changeInfo.newValue, 30);
        if (info.listenerCount > 0) {
          this._handleChange({
            instances: { [info.instanceId]: { formattedValue: info.lastValue } }
          });
        }
      }
    }
  }
  handleAutorunCreated(autorun2, location) {
    const declarationId = this._getDeclarationId("autorun", location);
    const info = {
      declarationId,
      instanceId: this._instanceId++,
      updateCount: 0,
      changedObservables: /* @__PURE__ */ new Set()
    };
    this._instanceInfos.set(autorun2, info);
    this._aliveInstances.set(info.instanceId, autorun2);
    if (info) {
      this._handleChange({
        instances: {
          [info.instanceId]: {
            instanceId: info.instanceId,
            declarationId: info.declarationId,
            runCount: 0,
            type: "autorun",
            name: autorun2.debugName
          }
        }
      });
    }
  }
  handleAutorunDisposed(autorun2) {
    const info = this._getAutorunInfo(autorun2);
    if (!info) {
      return;
    }
    this._handleChange({
      instances: { [info.instanceId]: null }
    });
    this._instanceInfos.delete(autorun2);
    this._aliveInstances.delete(info.instanceId);
  }
  handleAutorunDependencyChanged(autorun2, observable, change) {
    const info = this._getAutorunInfo(autorun2);
    if (!info) {
      return;
    }
    info.changedObservables.add(observable);
  }
  handleAutorunStarted(autorun2) {
  }
  handleAutorunFinished(autorun2) {
    const info = this._getAutorunInfo(autorun2);
    if (!info) {
      return;
    }
    info.changedObservables.clear();
    info.updateCount++;
    this._handleChange({
      instances: { [info.instanceId]: { runCount: info.updateCount } }
    });
  }
  handleDerivedDependencyChanged(derived2, observable, change) {
    const info = this._getObservableInfo(derived2);
    if (info) {
      info.changedObservables.add(observable);
    }
  }
  _handleDerivedRecomputed(observable, changeInfo) {
    const info = this._getObservableInfo(observable);
    if (!info) {
      return;
    }
    const formattedValue = formatValue(changeInfo.newValue, 30);
    info.updateCount++;
    info.changedObservables.clear();
    info.lastValue = formattedValue;
    if (info.listenerCount > 0) {
      this._handleChange({
        instances: { [info.instanceId]: { formattedValue, recomputationCount: info.updateCount } }
      });
    }
  }
  handleDerivedCleared(observable) {
    const info = this._getObservableInfo(observable);
    if (!info) {
      return;
    }
    info.lastValue = void 0;
    info.changedObservables.clear();
    if (info.listenerCount > 0) {
      this._handleChange({
        instances: {
          [info.instanceId]: {
            formattedValue: void 0
          }
        }
      });
    }
  }
  handleBeginTransaction(transaction2) {
    this._activeTransactions.add(transaction2);
  }
  handleEndTransaction(transaction2) {
    this._activeTransactions.delete(transaction2);
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/logging/debugGetDependencyGraph.ts
function debugGetObservableGraph(obs, options) {
  const debugNamePostProcessor = options?.debugNamePostProcessor ?? ((str) => str);
  const info = Info.from(obs, debugNamePostProcessor);
  if (!info) {
    return "";
  }
  const alreadyListed = /* @__PURE__ */ new Set();
  if (options.type === "observers") {
    return formatObservableInfoWithObservers(info, 0, alreadyListed, options).trim();
  } else {
    return formatObservableInfoWithDependencies(info, 0, alreadyListed, options).trim();
  }
}
function formatObservableInfoWithDependencies(info, indentLevel, alreadyListed, options) {
  const indent = "		".repeat(indentLevel);
  const lines = [];
  const isAlreadyListed = alreadyListed.has(info.sourceObj);
  if (isAlreadyListed) {
    lines.push(`${indent}* ${info.type} ${info.name} (already listed)`);
    return lines.join("\n");
  }
  alreadyListed.add(info.sourceObj);
  lines.push(`${indent}* ${info.type} ${info.name}:`);
  lines.push(`${indent}  value: ${formatValue(info.value, 50)}`);
  lines.push(`${indent}  state: ${info.state}`);
  if (info.dependencies.length > 0) {
    lines.push(`${indent}  dependencies:`);
    for (const dep of info.dependencies) {
      const info2 = Info.from(dep, options.debugNamePostProcessor ?? ((name) => name)) ?? Info.unknown(dep);
      lines.push(formatObservableInfoWithDependencies(info2, indentLevel + 1, alreadyListed, options));
    }
  }
  return lines.join("\n");
}
function formatObservableInfoWithObservers(info, indentLevel, alreadyListed, options) {
  const indent = "		".repeat(indentLevel);
  const lines = [];
  const isAlreadyListed = alreadyListed.has(info.sourceObj);
  if (isAlreadyListed) {
    lines.push(`${indent}* ${info.type} ${info.name} (already listed)`);
    return lines.join("\n");
  }
  alreadyListed.add(info.sourceObj);
  lines.push(`${indent}* ${info.type} ${info.name}:`);
  lines.push(`${indent}  value: ${formatValue(info.value, 50)}`);
  lines.push(`${indent}  state: ${info.state}`);
  if (info.observers.length > 0) {
    lines.push(`${indent}  observers:`);
    for (const observer of info.observers) {
      const info2 = Info.from(observer, options.debugNamePostProcessor ?? ((name) => name)) ?? Info.unknown(observer);
      lines.push(formatObservableInfoWithObservers(info2, indentLevel + 1, alreadyListed, options));
    }
  }
  return lines.join("\n");
}
var Info = class _Info {
  constructor(sourceObj, name, type, value, state, dependencies, observers) {
    this.sourceObj = sourceObj;
    this.name = name;
    this.type = type;
    this.value = value;
    this.state = state;
    this.dependencies = dependencies;
    this.observers = observers;
  }
  static from(obs, debugNamePostProcessor) {
    if (obs instanceof AutorunObserver) {
      const state = obs.debugGetState();
      return new _Info(
        obs,
        debugNamePostProcessor(obs.debugName),
        "autorun",
        void 0,
        state.stateStr,
        Array.from(state.dependencies),
        []
      );
    } else if (obs instanceof Derived) {
      const state = obs.debugGetState();
      return new _Info(
        obs,
        debugNamePostProcessor(obs.debugName),
        "derived",
        state.value,
        state.stateStr,
        Array.from(state.dependencies),
        Array.from(obs.debugGetObservers())
      );
    } else if (obs instanceof ObservableValue) {
      const state = obs.debugGetState();
      return new _Info(
        obs,
        debugNamePostProcessor(obs.debugName),
        "observableValue",
        state.value,
        "upToDate",
        [],
        Array.from(obs.debugGetObservers())
      );
    } else if (obs instanceof FromEventObservable) {
      const state = obs.debugGetState();
      return new _Info(
        obs,
        debugNamePostProcessor(obs.debugName),
        "fromEvent",
        state.value,
        state.hasValue ? "upToDate" : "initial",
        [],
        Array.from(obs.debugGetObservers())
      );
    }
    return void 0;
  }
  static unknown(obs) {
    return new _Info(
      obs,
      "(unknown)",
      "unknown",
      void 0,
      "unknown",
      [],
      []
    );
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/observableInternal/index.ts
_setDebugGetObservableGraph(debugGetObservableGraph);
setLogObservableFn(logObservableToConsole);
var enableLogging = false;
if (enableLogging) {
  addLogger(new ConsoleObservableLogger());
}
if (env && env["VSCODE_DEV_DEBUG_OBSERVABLES"]) {
  addLogger(DevToolsLogger.getInstance());
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/dom.ts
var {
  registerWindow,
  getWindow,
  getDocument,
  getWindows,
  getWindowsCount,
  getWindowId,
  getWindowById,
  hasWindow,
  onDidRegisterWindow,
  onWillUnregisterWindow,
  onDidUnregisterWindow
} = (function() {
  const windows = /* @__PURE__ */ new Map();
  ensureCodeWindow(mainWindow, 1);
  const mainWindowRegistration = { window: mainWindow, disposables: new DisposableStore() };
  windows.set(mainWindow.vscodeWindowId, mainWindowRegistration);
  const onDidRegisterWindow2 = new Emitter();
  const onDidUnregisterWindow2 = new Emitter();
  const onWillUnregisterWindow2 = new Emitter();
  function getWindowById2(windowId, fallbackToMain) {
    const window2 = typeof windowId === "number" ? windows.get(windowId) : void 0;
    return window2 ?? (fallbackToMain ? mainWindowRegistration : void 0);
  }
  return {
    onDidRegisterWindow: onDidRegisterWindow2.event,
    onWillUnregisterWindow: onWillUnregisterWindow2.event,
    onDidUnregisterWindow: onDidUnregisterWindow2.event,
    registerWindow(window2) {
      if (windows.has(window2.vscodeWindowId)) {
        return Disposable.None;
      }
      const disposables = new DisposableStore();
      const registeredWindow = {
        window: window2,
        disposables: disposables.add(new DisposableStore())
      };
      windows.set(window2.vscodeWindowId, registeredWindow);
      disposables.add(toDisposable(() => {
        windows.delete(window2.vscodeWindowId);
        onDidUnregisterWindow2.fire(window2);
      }));
      disposables.add(addDisposableListener(window2, EventType.BEFORE_UNLOAD, () => {
        onWillUnregisterWindow2.fire(window2);
      }));
      onDidRegisterWindow2.fire(registeredWindow);
      return disposables;
    },
    getWindows() {
      return windows.values();
    },
    getWindowsCount() {
      return windows.size;
    },
    getWindowId(targetWindow) {
      return targetWindow.vscodeWindowId;
    },
    hasWindow(windowId) {
      return windows.has(windowId);
    },
    getWindowById: getWindowById2,
    getWindow(e) {
      const candidateNode = e;
      if (candidateNode?.ownerDocument?.defaultView) {
        return candidateNode.ownerDocument.defaultView.window;
      }
      const candidateEvent = e;
      if (candidateEvent?.view) {
        return candidateEvent.view.window;
      }
      return mainWindow;
    },
    getDocument(e) {
      const candidateNode = e;
      return getWindow(candidateNode).document;
    }
  };
})();
function clearNode(node) {
  while (node.firstChild) {
    node.firstChild.remove();
  }
}
var DomListener = class {
  constructor(node, type, handler, options) {
    this._node = node;
    this._type = type;
    this._handler = handler;
    this._options = options || false;
    this._node.addEventListener(this._type, this._handler, this._options);
  }
  dispose() {
    if (!this._handler) {
      return;
    }
    this._node.removeEventListener(this._type, this._handler, this._options);
    this._node = null;
    this._handler = null;
  }
};
function addDisposableListener(node, type, handler, useCaptureOrOptions) {
  return new DomListener(node, type, handler, useCaptureOrOptions);
}
function _wrapAsStandardMouseEvent(targetWindow, handler) {
  return function(e) {
    return handler(new StandardMouseEvent(targetWindow, e));
  };
}
function _wrapAsStandardKeyboardEvent(handler) {
  return function(e) {
    return handler(new StandardKeyboardEvent(e));
  };
}
var addStandardDisposableListener = function addStandardDisposableListener2(node, type, handler, useCapture) {
  let wrapHandler = handler;
  if (type === "click" || type === "mousedown" || type === "contextmenu") {
    wrapHandler = _wrapAsStandardMouseEvent(getWindow(node), handler);
  } else if (type === "keydown" || type === "keypress" || type === "keyup") {
    wrapHandler = _wrapAsStandardKeyboardEvent(handler);
  }
  return addDisposableListener(node, type, wrapHandler, useCapture);
};
var runAtThisOrScheduleAtNextAnimationFrame;
var scheduleAtNextAnimationFrame;
var WindowIntervalTimer = class extends IntervalTimer {
  /**
   *
   * @param node The optional node from which the target window is determined
   */
  constructor(node) {
    super();
    this.defaultTarget = node && getWindow(node);
  }
  cancelAndSet(runner, interval, targetWindow) {
    return super.cancelAndSet(runner, interval, targetWindow ?? this.defaultTarget);
  }
};
var AnimationFrameQueueItem = class {
  constructor(runner, priority = 0) {
    this._runner = runner;
    this.priority = priority;
    this._canceled = false;
  }
  dispose() {
    this._canceled = true;
  }
  execute() {
    if (this._canceled) {
      return;
    }
    try {
      this._runner();
    } catch (e) {
      onUnexpectedError(e);
    }
  }
  // Sort by priority (largest to lowest)
  static sort(a, b) {
    return b.priority - a.priority;
  }
};
(function() {
  const NEXT_QUEUE = /* @__PURE__ */ new Map();
  const CURRENT_QUEUE = /* @__PURE__ */ new Map();
  const animFrameRequested = /* @__PURE__ */ new Map();
  const inAnimationFrameRunner = /* @__PURE__ */ new Map();
  const animationFrameRunner = (targetWindowId) => {
    animFrameRequested.set(targetWindowId, false);
    const currentQueue = NEXT_QUEUE.get(targetWindowId) ?? [];
    CURRENT_QUEUE.set(targetWindowId, currentQueue);
    NEXT_QUEUE.set(targetWindowId, []);
    inAnimationFrameRunner.set(targetWindowId, true);
    while (currentQueue.length > 0) {
      currentQueue.sort(AnimationFrameQueueItem.sort);
      const top = currentQueue.shift();
      top.execute();
    }
    inAnimationFrameRunner.set(targetWindowId, false);
  };
  scheduleAtNextAnimationFrame = (targetWindow, runner, priority = 0) => {
    const targetWindowId = getWindowId(targetWindow);
    const item = new AnimationFrameQueueItem(runner, priority);
    let nextQueue = NEXT_QUEUE.get(targetWindowId);
    if (!nextQueue) {
      nextQueue = [];
      NEXT_QUEUE.set(targetWindowId, nextQueue);
    }
    nextQueue.push(item);
    if (!animFrameRequested.get(targetWindowId)) {
      animFrameRequested.set(targetWindowId, true);
      targetWindow.requestAnimationFrame(() => animationFrameRunner(targetWindowId));
    }
    return item;
  };
  runAtThisOrScheduleAtNextAnimationFrame = (targetWindow, runner, priority) => {
    const targetWindowId = getWindowId(targetWindow);
    if (inAnimationFrameRunner.get(targetWindowId)) {
      const item = new AnimationFrameQueueItem(runner, priority);
      let currentQueue = CURRENT_QUEUE.get(targetWindowId);
      if (!currentQueue) {
        currentQueue = [];
        CURRENT_QUEUE.set(targetWindowId, currentQueue);
      }
      currentQueue.push(item);
      return item;
    } else {
      return scheduleAtNextAnimationFrame(targetWindow, runner, priority);
    }
  };
})();
function measure(targetWindow, callback) {
  return scheduleAtNextAnimationFrame(
    targetWindow,
    callback,
    1e4
    /* must be early */
  );
}
function modify(targetWindow, callback) {
  return scheduleAtNextAnimationFrame(
    targetWindow,
    callback,
    -1e4
    /* must be late */
  );
}
var Dimension = class _Dimension {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  static {
    this.None = new _Dimension(0, 0);
  }
  with(width = this.width, height = this.height) {
    if (width !== this.width || height !== this.height) {
      return new _Dimension(width, height);
    } else {
      return this;
    }
  }
  static is(obj) {
    return typeof obj === "object" && typeof obj.height === "number" && typeof obj.width === "number";
  }
  static lift(obj) {
    if (obj instanceof _Dimension) {
      return obj;
    } else {
      return new _Dimension(obj.width, obj.height);
    }
  }
  static equals(a, b) {
    if (a === b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return a.width === b.width && a.height === b.height;
  }
};
function getDomNodePagePosition(domNode) {
  const bb = domNode.getBoundingClientRect();
  const window2 = getWindow(domNode);
  return {
    left: bb.left + window2.scrollX,
    top: bb.top + window2.scrollY,
    width: bb.width,
    height: bb.height
  };
}
function isAncestor(testChild, testAncestor) {
  return Boolean(testAncestor?.contains(testChild));
}
function isShadowRoot(node) {
  return node && !!node.host && !!node.mode;
}
function getShadowRoot(domNode) {
  while (domNode.parentNode) {
    if (domNode === domNode.ownerDocument?.body) {
      return null;
    }
    domNode = domNode.parentNode;
  }
  return isShadowRoot(domNode) ? domNode : null;
}
function getActiveElement() {
  let result = getActiveDocument().activeElement;
  while (result?.shadowRoot) {
    result = result.shadowRoot.activeElement;
  }
  return result;
}
function isAncestorOfActiveElement(ancestor) {
  return isAncestor(getActiveElement(), ancestor);
}
function getActiveDocument() {
  if (getWindowsCount() <= 1) {
    return mainWindow.document;
  }
  const documents = Array.from(getWindows()).map(({ window: window2 }) => window2.document);
  return documents.find((doc) => doc.hasFocus()) ?? mainWindow.document;
}
var sharedMutationObserver = new class {
  constructor() {
    this.mutationObservers = /* @__PURE__ */ new Map();
  }
  observe(target, disposables, options) {
    let mutationObserversPerTarget = this.mutationObservers.get(target);
    if (!mutationObserversPerTarget) {
      mutationObserversPerTarget = /* @__PURE__ */ new Map();
      this.mutationObservers.set(target, mutationObserversPerTarget);
    }
    const optionsHash = hash(options);
    let mutationObserverPerOptions = mutationObserversPerTarget.get(optionsHash);
    if (!mutationObserverPerOptions) {
      const onDidMutate = new Emitter();
      const observer = new MutationObserver((mutations) => onDidMutate.fire(mutations));
      observer.observe(target, options);
      const resolvedMutationObserverPerOptions = mutationObserverPerOptions = {
        users: 1,
        observer,
        onDidMutate: onDidMutate.event
      };
      disposables.add(toDisposable(() => {
        resolvedMutationObserverPerOptions.users -= 1;
        if (resolvedMutationObserverPerOptions.users === 0) {
          onDidMutate.dispose();
          observer.disconnect();
          mutationObserversPerTarget?.delete(optionsHash);
          if (mutationObserversPerTarget?.size === 0) {
            this.mutationObservers.delete(target);
          }
        }
      }));
      mutationObserversPerTarget.set(optionsHash, mutationObserverPerOptions);
    } else {
      mutationObserverPerOptions.users += 1;
    }
    return mutationObserverPerOptions.onDidMutate;
  }
}();
function isHTMLElement(e) {
  return e instanceof HTMLElement || e instanceof getWindow(e).HTMLElement;
}
function isSVGElement(e) {
  return e instanceof SVGElement || e instanceof getWindow(e).SVGElement;
}
var EventType = {
  // Mouse
  CLICK: "click",
  AUXCLICK: "auxclick",
  DBLCLICK: "dblclick",
  MOUSE_UP: "mouseup",
  MOUSE_DOWN: "mousedown",
  MOUSE_OVER: "mouseover",
  MOUSE_MOVE: "mousemove",
  MOUSE_OUT: "mouseout",
  MOUSE_ENTER: "mouseenter",
  MOUSE_LEAVE: "mouseleave",
  MOUSE_WHEEL: "wheel",
  POINTER_UP: "pointerup",
  POINTER_DOWN: "pointerdown",
  POINTER_MOVE: "pointermove",
  POINTER_LEAVE: "pointerleave",
  CONTEXT_MENU: "contextmenu",
  WHEEL: "wheel",
  // Keyboard
  KEY_DOWN: "keydown",
  KEY_PRESS: "keypress",
  KEY_UP: "keyup",
  // HTML Document
  LOAD: "load",
  BEFORE_UNLOAD: "beforeunload",
  UNLOAD: "unload",
  PAGE_SHOW: "pageshow",
  PAGE_HIDE: "pagehide",
  PASTE: "paste",
  ABORT: "abort",
  ERROR: "error",
  RESIZE: "resize",
  SCROLL: "scroll",
  FULLSCREEN_CHANGE: "fullscreenchange",
  WK_FULLSCREEN_CHANGE: "webkitfullscreenchange",
  // Form
  SELECT: "select",
  CHANGE: "change",
  SUBMIT: "submit",
  RESET: "reset",
  FOCUS: "focus",
  FOCUS_IN: "focusin",
  FOCUS_OUT: "focusout",
  BLUR: "blur",
  INPUT: "input",
  // Local Storage
  STORAGE: "storage",
  // Drag
  DRAG_START: "dragstart",
  DRAG: "drag",
  DRAG_ENTER: "dragenter",
  DRAG_LEAVE: "dragleave",
  DRAG_OVER: "dragover",
  DROP: "drop",
  DRAG_END: "dragend",
  // Animation
  ANIMATION_START: isWebKit ? "webkitAnimationStart" : "animationstart",
  ANIMATION_END: isWebKit ? "webkitAnimationEnd" : "animationend",
  ANIMATION_ITERATION: isWebKit ? "webkitAnimationIteration" : "animationiteration"
};
var FocusTracker = class _FocusTracker extends Disposable {
  constructor(element) {
    super();
    this._onDidFocus = this._register(new Emitter());
    this._onDidBlur = this._register(new Emitter());
    let hasFocus = _FocusTracker.hasFocusWithin(element);
    let loosingFocus = false;
    const onFocus = () => {
      loosingFocus = false;
      if (!hasFocus) {
        hasFocus = true;
        this._onDidFocus.fire();
      }
    };
    const onBlur = () => {
      if (hasFocus) {
        loosingFocus = true;
        (isHTMLElement(element) ? getWindow(element) : element).setTimeout(() => {
          if (loosingFocus) {
            loosingFocus = false;
            hasFocus = false;
            this._onDidBlur.fire();
          }
        }, 0);
      }
    };
    this._refreshStateHandler = () => {
      const currentNodeHasFocus = _FocusTracker.hasFocusWithin(element);
      if (currentNodeHasFocus !== hasFocus) {
        if (hasFocus) {
          onBlur();
        } else {
          onFocus();
        }
      }
    };
    this._register(addDisposableListener(element, EventType.FOCUS, onFocus, true));
    this._register(addDisposableListener(element, EventType.BLUR, onBlur, true));
    if (isHTMLElement(element)) {
      this._register(addDisposableListener(element, EventType.FOCUS_IN, () => this._refreshStateHandler()));
      this._register(addDisposableListener(element, EventType.FOCUS_OUT, () => this._refreshStateHandler()));
    }
  }
  get onDidFocus() {
    return this._onDidFocus.event;
  }
  get onDidBlur() {
    return this._onDidBlur.event;
  }
  static hasFocusWithin(element) {
    if (isHTMLElement(element)) {
      const shadowRoot = getShadowRoot(element);
      const activeElement = shadowRoot ? shadowRoot.activeElement : element.ownerDocument.activeElement;
      return isAncestor(activeElement, element);
    } else {
      const window2 = element;
      return isAncestor(window2.document.activeElement, window2.document);
    }
  }
  refreshState() {
    this._refreshStateHandler();
  }
};
function trackFocus(element) {
  return new FocusTracker(element);
}
var SELECTOR_REGEX = /([\w\-]+)?(#([\w\-]+))?((\.([\w\-]+))*)/;
function _$(namespace, description, attrs, ...children) {
  const match = SELECTOR_REGEX.exec(description);
  if (!match) {
    throw new Error("Bad use of emmet");
  }
  const tagName = match[1] || "div";
  let result;
  if (namespace !== "http://www.w3.org/1999/xhtml" /* HTML */) {
    result = document.createElementNS(namespace, tagName);
  } else {
    result = document.createElement(tagName);
  }
  if (match[3]) {
    result.id = match[3];
  }
  if (match[4]) {
    result.className = match[4].replace(/\./g, " ").trim();
  }
  if (attrs) {
    Object.entries(attrs).forEach(([name, value]) => {
      if (typeof value === "undefined") {
        return;
      }
      if (/^on\w+$/.test(name)) {
        result[name] = value;
      } else if (name === "selected") {
        if (value) {
          result.setAttribute(name, "true");
        }
      } else {
        result.setAttribute(name, value);
      }
    });
  }
  result.append(...children);
  return result;
}
function $(description, attrs, ...children) {
  return _$("http://www.w3.org/1999/xhtml" /* HTML */, description, attrs, ...children);
}
$.SVG = function(description, attrs, ...children) {
  return _$("http://www.w3.org/2000/svg" /* SVG */, description, attrs, ...children);
};
RemoteAuthorities.setPreferredWebSchema(/^https:/.test(mainWindow.location.href) ? "https" : "http");
function camelCaseToHyphenCase(str) {
  return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
var n;
((n2) => {
  function nodeNs(elementNs = void 0) {
    return (tag, attributes, children) => {
      const className = attributes.class;
      delete attributes.class;
      const ref2 = attributes.ref;
      delete attributes.ref;
      const obsRef = attributes.obsRef;
      delete attributes.obsRef;
      return new ObserverNodeWithElement(tag, ref2, obsRef, elementNs, className, attributes, children);
    };
  }
  function node(tag, elementNs = void 0) {
    const f = nodeNs(elementNs);
    return (attributes, children) => {
      return f(tag, attributes, children);
    };
  }
  n2.div = node("div");
  n2.elem = nodeNs(void 0);
  n2.svg = node("svg", "http://www.w3.org/2000/svg");
  n2.svgElem = nodeNs("http://www.w3.org/2000/svg");
  function ref() {
    let value = void 0;
    const result = function(val) {
      value = val;
    };
    Object.defineProperty(result, "element", {
      get() {
        if (!value) {
          throw new BugIndicatingError("Make sure the ref is set before accessing the element. Maybe wrong initialization order?");
        }
        return value;
      }
    });
    return result;
  }
  n2.ref = ref;
})(n || (n = {}));
var ObserverNode = class _ObserverNode {
  constructor(tag, ref, obsRef, ns, className, attributes, children) {
    this._deriveds = [];
    this._isHovered = void 0;
    this._didMouseMoveDuringHover = void 0;
    this._element = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    if (ref) {
      ref(this._element);
    }
    if (obsRef) {
      this._deriveds.push(derived((_reader) => {
        obsRef(this);
        _reader.store.add({
          dispose: () => {
            obsRef(null);
          }
        });
      }));
    }
    if (className) {
      if (hasObservable(className)) {
        this._deriveds.push(derived(this, (reader) => {
          setClassName(this._element, getClassName2(className, reader));
        }));
      } else {
        setClassName(this._element, getClassName2(className, void 0));
      }
    }
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "style") {
        for (const [cssKey, cssValue] of Object.entries(value)) {
          const key2 = camelCaseToHyphenCase(cssKey);
          if (isObservable(cssValue)) {
            this._deriveds.push(derivedOpts({ owner: this, debugName: () => `set.style.${key2}` }, (reader) => {
              this._element.style.setProperty(key2, convertCssValue(cssValue.read(reader)));
            }));
          } else {
            this._element.style.setProperty(key2, convertCssValue(cssValue));
          }
        }
      } else if (key === "tabIndex") {
        if (isObservable(value)) {
          this._deriveds.push(derived(this, (reader) => {
            this._element.tabIndex = value.read(reader);
          }));
        } else {
          this._element.tabIndex = value;
        }
      } else if (key.startsWith("on")) {
        this._element[key] = value;
      } else {
        if (isObservable(value)) {
          this._deriveds.push(derivedOpts({ owner: this, debugName: () => `set.${key}` }, (reader) => {
            setOrRemoveAttribute(this._element, key, value.read(reader));
          }));
        } else {
          setOrRemoveAttribute(this._element, key, value);
        }
      }
    }
    if (children) {
      let getChildren2 = function(reader, children2) {
        if (isObservable(children2)) {
          return getChildren2(reader, children2.read(reader));
        }
        if (Array.isArray(children2)) {
          return children2.flatMap((c) => getChildren2(reader, c));
        }
        if (children2 instanceof _ObserverNode) {
          if (reader) {
            children2.readEffect(reader);
          }
          return [children2._element];
        }
        if (children2) {
          return [children2];
        }
        return [];
      };
      var getChildren = getChildren2;
      const d = derived(this, (reader) => {
        this._element.replaceChildren(...getChildren2(reader, children));
      });
      this._deriveds.push(d);
      if (!childrenIsObservable(children)) {
        d.get();
      }
    }
  }
  readEffect(reader) {
    for (const d of this._deriveds) {
      d.read(reader);
    }
  }
  keepUpdated(store) {
    derived((reader) => {
      this.readEffect(reader);
    }).recomputeInitiallyAndOnChange(store);
    return this;
  }
  /**
   * Creates a live element that will keep the element updated as long as the returned object is not disposed.
  */
  toDisposableLiveElement() {
    const store = new DisposableStore();
    this.keepUpdated(store);
    return new LiveElement(this._element, store);
  }
  get isHovered() {
    if (!this._isHovered) {
      const hovered = observableValue("hovered", false);
      this._element.addEventListener("mouseenter", (_e) => hovered.set(true, void 0));
      this._element.addEventListener("mouseleave", (_e) => hovered.set(false, void 0));
      this._isHovered = hovered;
    }
    return this._isHovered;
  }
  get didMouseMoveDuringHover() {
    if (!this._didMouseMoveDuringHover) {
      let _hovering = false;
      const hovered = observableValue("didMouseMoveDuringHover", false);
      this._element.addEventListener("mouseenter", (_e) => {
        _hovering = true;
      });
      this._element.addEventListener("mousemove", (_e) => {
        if (_hovering) {
          hovered.set(true, void 0);
        }
      });
      this._element.addEventListener("mouseleave", (_e) => {
        _hovering = false;
        hovered.set(false, void 0);
      });
      this._didMouseMoveDuringHover = hovered;
    }
    return this._didMouseMoveDuringHover;
  }
};
function setClassName(domNode, className) {
  if (isSVGElement(domNode)) {
    domNode.setAttribute("class", className);
  } else {
    domNode.className = className;
  }
}
function resolve2(value, reader, cb) {
  if (isObservable(value)) {
    cb(value.read(reader));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      resolve2(v, reader, cb);
    }
    return;
  }
  cb(value);
}
function getClassName2(className, reader) {
  let result = "";
  resolve2(className, reader, (val) => {
    if (val) {
      if (result.length === 0) {
        result = val;
      } else {
        result += " " + val;
      }
    }
  });
  return result;
}
function hasObservable(value) {
  if (isObservable(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((v) => hasObservable(v));
  }
  return false;
}
function convertCssValue(value) {
  if (typeof value === "number") {
    return value + "px";
  }
  return value;
}
function childrenIsObservable(children) {
  if (isObservable(children)) {
    return true;
  }
  if (Array.isArray(children)) {
    return children.some((c) => childrenIsObservable(c));
  }
  return false;
}
var LiveElement = class {
  constructor(element, _disposable) {
    this.element = element;
    this._disposable = _disposable;
  }
  dispose() {
    this._disposable.dispose();
  }
};
var ObserverNodeWithElement = class extends ObserverNode {
  get element() {
    return this._element;
  }
};
function setOrRemoveAttribute(element, key, value) {
  if (value === null || value === void 0) {
    element.removeAttribute(camelCaseToHyphenCase(key));
  } else {
    element.setAttribute(camelCaseToHyphenCase(key), String(value));
  }
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/domStylesheets.ts
var globalStylesheets = /* @__PURE__ */ new Map();
function createStyleSheet(container = mainWindow.document.head, beforeAppend, disposableStore) {
  const style = document.createElement("style");
  style.type = "text/css";
  style.media = "screen";
  beforeAppend?.(style);
  container.appendChild(style);
  if (disposableStore) {
    disposableStore.add(toDisposable(() => style.remove()));
  }
  if (container === mainWindow.document.head) {
    const globalStylesheetClones = /* @__PURE__ */ new Set();
    globalStylesheets.set(style, globalStylesheetClones);
    if (disposableStore) {
      disposableStore.add(toDisposable(() => globalStylesheets.delete(style)));
    }
    for (const { window: targetWindow, disposables } of getWindows()) {
      if (targetWindow === mainWindow) {
        continue;
      }
      const cloneDisposable = disposables.add(cloneGlobalStyleSheet(style, globalStylesheetClones, targetWindow));
      disposableStore?.add(cloneDisposable);
    }
  }
  return style;
}
function cloneGlobalStyleSheet(globalStylesheet, globalStylesheetClones, targetWindow) {
  const disposables = new DisposableStore();
  const clone = globalStylesheet.cloneNode(true);
  targetWindow.document.head.appendChild(clone);
  disposables.add(toDisposable(() => clone.remove()));
  for (const rule of getDynamicStyleSheetRules(globalStylesheet)) {
    clone.sheet?.insertRule(rule.cssText, clone.sheet?.cssRules.length);
  }
  disposables.add(sharedMutationObserver.observe(globalStylesheet, disposables, { childList: true, subtree: isFirefox, characterData: isFirefox })(() => {
    clone.textContent = globalStylesheet.textContent;
  }));
  globalStylesheetClones.add(clone);
  disposables.add(toDisposable(() => globalStylesheetClones.delete(clone)));
  return disposables;
}
function getDynamicStyleSheetRules(style) {
  if (style?.sheet?.rules) {
    return style.sheet.rules;
  }
  if (style?.sheet?.cssRules) {
    return style.sheet.cssRules;
  }
  return [];
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/fastDomNode.ts
var FastDomNode = class {
  constructor(domNode) {
    this.domNode = domNode;
    this._maxWidth = "";
    this._width = "";
    this._height = "";
    this._top = "";
    this._left = "";
    this._bottom = "";
    this._right = "";
    this._paddingTop = "";
    this._paddingLeft = "";
    this._paddingBottom = "";
    this._paddingRight = "";
    this._fontFamily = "";
    this._fontWeight = "";
    this._fontSize = "";
    this._fontStyle = "";
    this._fontFeatureSettings = "";
    this._fontVariationSettings = "";
    this._textDecoration = "";
    this._lineHeight = "";
    this._letterSpacing = "";
    this._className = "";
    this._display = "";
    this._position = "";
    this._visibility = "";
    this._color = "";
    this._backgroundColor = "";
    this._layerHint = false;
    this._contain = "none";
    this._boxShadow = "";
  }
  focus() {
    this.domNode.focus();
  }
  setMaxWidth(_maxWidth) {
    const maxWidth = numberAsPixels(_maxWidth);
    if (this._maxWidth === maxWidth) {
      return;
    }
    this._maxWidth = maxWidth;
    this.domNode.style.maxWidth = this._maxWidth;
  }
  setWidth(_width) {
    const width = numberAsPixels(_width);
    if (this._width === width) {
      return;
    }
    this._width = width;
    this.domNode.style.width = this._width;
  }
  setHeight(_height) {
    const height = numberAsPixels(_height);
    if (this._height === height) {
      return;
    }
    this._height = height;
    this.domNode.style.height = this._height;
  }
  setTop(_top) {
    const top = numberAsPixels(_top);
    if (this._top === top) {
      return;
    }
    this._top = top;
    this.domNode.style.top = this._top;
  }
  setLeft(_left) {
    const left = numberAsPixels(_left);
    if (this._left === left) {
      return;
    }
    this._left = left;
    this.domNode.style.left = this._left;
  }
  setBottom(_bottom) {
    const bottom = numberAsPixels(_bottom);
    if (this._bottom === bottom) {
      return;
    }
    this._bottom = bottom;
    this.domNode.style.bottom = this._bottom;
  }
  setRight(_right) {
    const right = numberAsPixels(_right);
    if (this._right === right) {
      return;
    }
    this._right = right;
    this.domNode.style.right = this._right;
  }
  setPaddingTop(_paddingTop) {
    const paddingTop = numberAsPixels(_paddingTop);
    if (this._paddingTop === paddingTop) {
      return;
    }
    this._paddingTop = paddingTop;
    this.domNode.style.paddingTop = this._paddingTop;
  }
  setPaddingLeft(_paddingLeft) {
    const paddingLeft = numberAsPixels(_paddingLeft);
    if (this._paddingLeft === paddingLeft) {
      return;
    }
    this._paddingLeft = paddingLeft;
    this.domNode.style.paddingLeft = this._paddingLeft;
  }
  setPaddingBottom(_paddingBottom) {
    const paddingBottom = numberAsPixels(_paddingBottom);
    if (this._paddingBottom === paddingBottom) {
      return;
    }
    this._paddingBottom = paddingBottom;
    this.domNode.style.paddingBottom = this._paddingBottom;
  }
  setPaddingRight(_paddingRight) {
    const paddingRight = numberAsPixels(_paddingRight);
    if (this._paddingRight === paddingRight) {
      return;
    }
    this._paddingRight = paddingRight;
    this.domNode.style.paddingRight = this._paddingRight;
  }
  setFontFamily(fontFamily) {
    if (this._fontFamily === fontFamily) {
      return;
    }
    this._fontFamily = fontFamily;
    this.domNode.style.fontFamily = this._fontFamily;
  }
  setFontWeight(fontWeight) {
    if (this._fontWeight === fontWeight) {
      return;
    }
    this._fontWeight = fontWeight;
    this.domNode.style.fontWeight = this._fontWeight;
  }
  setFontSize(_fontSize) {
    const fontSize = numberAsPixels(_fontSize);
    if (this._fontSize === fontSize) {
      return;
    }
    this._fontSize = fontSize;
    this.domNode.style.fontSize = this._fontSize;
  }
  setFontStyle(fontStyle) {
    if (this._fontStyle === fontStyle) {
      return;
    }
    this._fontStyle = fontStyle;
    this.domNode.style.fontStyle = this._fontStyle;
  }
  setFontFeatureSettings(fontFeatureSettings) {
    if (this._fontFeatureSettings === fontFeatureSettings) {
      return;
    }
    this._fontFeatureSettings = fontFeatureSettings;
    this.domNode.style.fontFeatureSettings = this._fontFeatureSettings;
  }
  setFontVariationSettings(fontVariationSettings) {
    if (this._fontVariationSettings === fontVariationSettings) {
      return;
    }
    this._fontVariationSettings = fontVariationSettings;
    this.domNode.style.fontVariationSettings = this._fontVariationSettings;
  }
  setTextDecoration(textDecoration) {
    if (this._textDecoration === textDecoration) {
      return;
    }
    this._textDecoration = textDecoration;
    this.domNode.style.textDecoration = this._textDecoration;
  }
  setLineHeight(_lineHeight) {
    const lineHeight = numberAsPixels(_lineHeight);
    if (this._lineHeight === lineHeight) {
      return;
    }
    this._lineHeight = lineHeight;
    this.domNode.style.lineHeight = this._lineHeight;
  }
  setLetterSpacing(_letterSpacing) {
    const letterSpacing = numberAsPixels(_letterSpacing);
    if (this._letterSpacing === letterSpacing) {
      return;
    }
    this._letterSpacing = letterSpacing;
    this.domNode.style.letterSpacing = this._letterSpacing;
  }
  setClassName(className) {
    if (this._className === className) {
      return;
    }
    this._className = className;
    this.domNode.className = this._className;
  }
  toggleClassName(className, shouldHaveIt) {
    this.domNode.classList.toggle(className, shouldHaveIt);
    this._className = this.domNode.className;
  }
  setDisplay(display) {
    if (this._display === display) {
      return;
    }
    this._display = display;
    this.domNode.style.display = this._display;
  }
  setPosition(position) {
    if (this._position === position) {
      return;
    }
    this._position = position;
    this.domNode.style.position = this._position;
  }
  setVisibility(visibility) {
    if (this._visibility === visibility) {
      return;
    }
    this._visibility = visibility;
    this.domNode.style.visibility = this._visibility;
  }
  setColor(color) {
    if (this._color === color) {
      return;
    }
    this._color = color;
    this.domNode.style.color = this._color;
  }
  setBackgroundColor(backgroundColor) {
    if (this._backgroundColor === backgroundColor) {
      return;
    }
    this._backgroundColor = backgroundColor;
    this.domNode.style.backgroundColor = this._backgroundColor;
  }
  setLayerHinting(layerHint) {
    if (this._layerHint === layerHint) {
      return;
    }
    this._layerHint = layerHint;
    this.domNode.style.transform = this._layerHint ? "translate3d(0px, 0px, 0px)" : "";
  }
  setBoxShadow(boxShadow) {
    if (this._boxShadow === boxShadow) {
      return;
    }
    this._boxShadow = boxShadow;
    this.domNode.style.boxShadow = boxShadow;
  }
  setContain(contain) {
    if (this._contain === contain) {
      return;
    }
    this._contain = contain;
    this.domNode.style.contain = this._contain;
  }
  setAttribute(name, value) {
    this.domNode.setAttribute(name, value);
  }
  removeAttribute(name) {
    this.domNode.removeAttribute(name);
  }
  appendChild(child) {
    this.domNode.appendChild(child.domNode);
  }
  removeChild(child) {
    this.domNode.removeChild(child.domNode);
  }
};
function numberAsPixels(value) {
  return typeof value === "number" ? `${value}px` : value;
}
function createFastDomNode(domNode) {
  return new FastDomNode(domNode);
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/globalPointerMoveMonitor.ts
var GlobalPointerMoveMonitor = class {
  constructor() {
    this._hooks = new DisposableStore();
    this._pointerMoveCallback = null;
    this._onStopCallback = null;
  }
  dispose() {
    this.stopMonitoring(false);
    this._hooks.dispose();
  }
  stopMonitoring(invokeStopCallback, browserEvent) {
    if (!this.isMonitoring()) {
      return;
    }
    this._hooks.clear();
    this._pointerMoveCallback = null;
    const onStopCallback = this._onStopCallback;
    this._onStopCallback = null;
    if (invokeStopCallback && onStopCallback) {
      onStopCallback(browserEvent);
    }
  }
  isMonitoring() {
    return !!this._pointerMoveCallback;
  }
  startMonitoring(initialElement, pointerId, initialButtons, pointerMoveCallback, onStopCallback) {
    if (this.isMonitoring()) {
      this.stopMonitoring(false);
    }
    this._pointerMoveCallback = pointerMoveCallback;
    this._onStopCallback = onStopCallback;
    let eventSource = initialElement;
    try {
      initialElement.setPointerCapture(pointerId);
      this._hooks.add(toDisposable(() => {
        try {
          initialElement.releasePointerCapture(pointerId);
        } catch (err) {
        }
      }));
    } catch (err) {
      eventSource = getWindow(initialElement);
    }
    this._hooks.add(addDisposableListener(
      eventSource,
      EventType.POINTER_MOVE,
      (e) => {
        if (e.buttons !== initialButtons) {
          this.stopMonitoring(true);
          return;
        }
        e.preventDefault();
        this._pointerMoveCallback(e);
      }
    ));
    this._hooks.add(addDisposableListener(
      eventSource,
      EventType.POINTER_UP,
      (e) => this.stopMonitoring(true)
    ));
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/decorators.ts
function memoize(_target, key, descriptor) {
  let fnKey = null;
  let fn = null;
  if (typeof descriptor.value === "function") {
    fnKey = "value";
    fn = descriptor.value;
    if (fn.length !== 0) {
      console.warn("Memoize should only be used in functions with zero parameters");
    }
  } else if (typeof descriptor.get === "function") {
    fnKey = "get";
    fn = descriptor.get;
  }
  if (!fn) {
    throw new Error("not supported");
  }
  const memoizeKey = `$memoize$${key}`;
  descriptor[fnKey] = function(...args) {
    if (!this.hasOwnProperty(memoizeKey)) {
      Object.defineProperty(this, memoizeKey, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: fn.apply(this, args)
      });
    }
    return this[memoizeKey];
  };
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/touch.ts
var EventType2;
((EventType3) => {
  EventType3.Tap = "-monaco-gesturetap";
  EventType3.Change = "-monaco-gesturechange";
  EventType3.Start = "-monaco-gesturestart";
  EventType3.End = "-monaco-gesturesend";
  EventType3.Contextmenu = "-monaco-gesturecontextmenu";
})(EventType2 || (EventType2 = {}));
var _Gesture = class _Gesture extends Disposable {
  // ms
  constructor() {
    super();
    this.dispatched = false;
    this.targets = new LinkedList();
    this.ignoreTargets = new LinkedList();
    this.activeTouches = {};
    this.handle = null;
    this._lastSetTapCountTime = 0;
    this._register(Event.runAndSubscribe(onDidRegisterWindow, ({ window: window2, disposables }) => {
      disposables.add(addDisposableListener(window2.document, "touchstart", (e) => this.onTouchStart(e), { passive: false }));
      disposables.add(addDisposableListener(window2.document, "touchend", (e) => this.onTouchEnd(window2, e)));
      disposables.add(addDisposableListener(window2.document, "touchmove", (e) => this.onTouchMove(e), { passive: false }));
    }, { window: mainWindow, disposables: this._store }));
  }
  static {
    this.SCROLL_FRICTION = -5e-3;
  }
  static {
    this.HOLD_DELAY = 700;
  }
  static {
    this.CLEAR_TAP_COUNT_TIME = 400;
  }
  static addTarget(element) {
    if (!_Gesture.isTouchDevice()) {
      return Disposable.None;
    }
    if (!_Gesture.INSTANCE) {
      _Gesture.INSTANCE = markAsSingleton(new _Gesture());
    }
    const remove = _Gesture.INSTANCE.targets.push(element);
    return toDisposable(remove);
  }
  static ignoreTarget(element) {
    if (!_Gesture.isTouchDevice()) {
      return Disposable.None;
    }
    if (!_Gesture.INSTANCE) {
      _Gesture.INSTANCE = markAsSingleton(new _Gesture());
    }
    const remove = _Gesture.INSTANCE.ignoreTargets.push(element);
    return toDisposable(remove);
  }
  static isTouchDevice() {
    return "ontouchstart" in mainWindow || navigator.maxTouchPoints > 0;
  }
  dispose() {
    if (this.handle) {
      this.handle.dispose();
      this.handle = null;
    }
    super.dispose();
  }
  onTouchStart(e) {
    const timestamp = Date.now();
    if (this.handle) {
      this.handle.dispose();
      this.handle = null;
    }
    for (let i = 0, len = e.targetTouches.length; i < len; i++) {
      const touch = e.targetTouches.item(i);
      this.activeTouches[touch.identifier] = {
        id: touch.identifier,
        initialTarget: touch.target,
        initialTimeStamp: timestamp,
        initialPageX: touch.pageX,
        initialPageY: touch.pageY,
        rollingTimestamps: [timestamp],
        rollingPageX: [touch.pageX],
        rollingPageY: [touch.pageY]
      };
      const evt = this.newGestureEvent(EventType2.Start, touch.target);
      evt.pageX = touch.pageX;
      evt.pageY = touch.pageY;
      this.dispatchEvent(evt);
    }
    if (this.dispatched) {
      e.preventDefault();
      e.stopPropagation();
      this.dispatched = false;
    }
  }
  onTouchEnd(targetWindow, e) {
    const timestamp = Date.now();
    const activeTouchCount = Object.keys(this.activeTouches).length;
    for (let i = 0, len = e.changedTouches.length; i < len; i++) {
      const touch = e.changedTouches.item(i);
      if (!this.activeTouches.hasOwnProperty(String(touch.identifier))) {
        console.warn("move of an UNKNOWN touch", touch);
        continue;
      }
      const data = this.activeTouches[touch.identifier], holdTime = Date.now() - data.initialTimeStamp;
      if (holdTime < _Gesture.HOLD_DELAY && Math.abs(data.initialPageX - data.rollingPageX.at(-1)) < 30 && Math.abs(data.initialPageY - data.rollingPageY.at(-1)) < 30) {
        const evt = this.newGestureEvent(EventType2.Tap, data.initialTarget);
        evt.pageX = data.rollingPageX.at(-1);
        evt.pageY = data.rollingPageY.at(-1);
        this.dispatchEvent(evt);
      } else if (holdTime >= _Gesture.HOLD_DELAY && Math.abs(data.initialPageX - data.rollingPageX.at(-1)) < 30 && Math.abs(data.initialPageY - data.rollingPageY.at(-1)) < 30) {
        const evt = this.newGestureEvent(EventType2.Contextmenu, data.initialTarget);
        evt.pageX = data.rollingPageX.at(-1);
        evt.pageY = data.rollingPageY.at(-1);
        this.dispatchEvent(evt);
      } else if (activeTouchCount === 1) {
        const finalX = data.rollingPageX.at(-1);
        const finalY = data.rollingPageY.at(-1);
        const deltaT = data.rollingTimestamps.at(-1) - data.rollingTimestamps[0];
        const deltaX = finalX - data.rollingPageX[0];
        const deltaY = finalY - data.rollingPageY[0];
        const dispatchTo = [...this.targets].filter((t) => data.initialTarget instanceof Node && t.contains(data.initialTarget));
        this.inertia(
          targetWindow,
          dispatchTo,
          timestamp,
          // time now
          Math.abs(deltaX) / deltaT,
          // speed
          deltaX > 0 ? 1 : -1,
          // x direction
          finalX,
          // x now
          Math.abs(deltaY) / deltaT,
          // y speed
          deltaY > 0 ? 1 : -1,
          // y direction
          finalY
          // y now
        );
      }
      this.dispatchEvent(this.newGestureEvent(EventType2.End, data.initialTarget));
      delete this.activeTouches[touch.identifier];
    }
    if (this.dispatched) {
      e.preventDefault();
      e.stopPropagation();
      this.dispatched = false;
    }
  }
  newGestureEvent(type, initialTarget) {
    const event = document.createEvent("CustomEvent");
    event.initEvent(type, false, true);
    event.initialTarget = initialTarget;
    event.tapCount = 0;
    return event;
  }
  dispatchEvent(event) {
    if (event.type === EventType2.Tap) {
      const currentTime = (/* @__PURE__ */ new Date()).getTime();
      let setTapCount = 0;
      if (currentTime - this._lastSetTapCountTime > _Gesture.CLEAR_TAP_COUNT_TIME) {
        setTapCount = 1;
      } else {
        setTapCount = 2;
      }
      this._lastSetTapCountTime = currentTime;
      event.tapCount = setTapCount;
    } else if (event.type === EventType2.Change || event.type === EventType2.Contextmenu) {
      this._lastSetTapCountTime = 0;
    }
    if (event.initialTarget instanceof Node) {
      for (const ignoreTarget of this.ignoreTargets) {
        if (ignoreTarget.contains(event.initialTarget)) {
          return;
        }
      }
      const targets = [];
      for (const target of this.targets) {
        if (target.contains(event.initialTarget)) {
          let depth = 0;
          let now = event.initialTarget;
          while (now && now !== target) {
            depth++;
            now = now.parentElement;
          }
          targets.push([depth, target]);
        }
      }
      targets.sort((a, b) => a[0] - b[0]);
      for (const [_, target] of targets) {
        target.dispatchEvent(event);
        this.dispatched = true;
      }
    }
  }
  inertia(targetWindow, dispatchTo, t1, vX, dirX, x, vY, dirY, y) {
    this.handle = scheduleAtNextAnimationFrame(targetWindow, () => {
      const now = Date.now();
      const deltaT = now - t1;
      let delta_pos_x = 0, delta_pos_y = 0;
      let stopped = true;
      vX += _Gesture.SCROLL_FRICTION * deltaT;
      vY += _Gesture.SCROLL_FRICTION * deltaT;
      if (vX > 0) {
        stopped = false;
        delta_pos_x = dirX * vX * deltaT;
      }
      if (vY > 0) {
        stopped = false;
        delta_pos_y = dirY * vY * deltaT;
      }
      const evt = this.newGestureEvent(EventType2.Change);
      evt.translationX = delta_pos_x;
      evt.translationY = delta_pos_y;
      dispatchTo.forEach((d) => d.dispatchEvent(evt));
      if (!stopped) {
        this.inertia(targetWindow, dispatchTo, now, vX, dirX, x + delta_pos_x, vY, dirY, y + delta_pos_y);
      }
    });
  }
  onTouchMove(e) {
    const timestamp = Date.now();
    for (let i = 0, len = e.changedTouches.length; i < len; i++) {
      const touch = e.changedTouches.item(i);
      if (!this.activeTouches.hasOwnProperty(String(touch.identifier))) {
        console.warn("end of an UNKNOWN touch", touch);
        continue;
      }
      const data = this.activeTouches[touch.identifier];
      const evt = this.newGestureEvent(EventType2.Change, data.initialTarget);
      evt.translationX = touch.pageX - data.rollingPageX.at(-1);
      evt.translationY = touch.pageY - data.rollingPageY.at(-1);
      evt.pageX = touch.pageX;
      evt.pageY = touch.pageY;
      this.dispatchEvent(evt);
      if (data.rollingPageX.length > 3) {
        data.rollingPageX.shift();
        data.rollingPageY.shift();
        data.rollingTimestamps.shift();
      }
      data.rollingPageX.push(touch.pageX);
      data.rollingPageY.push(touch.pageY);
      data.rollingTimestamps.push(timestamp);
    }
    if (this.dispatched) {
      e.preventDefault();
      e.stopPropagation();
      this.dispatched = false;
    }
  }
};
__decorateClass([
  memoize
], _Gesture, "isTouchDevice", 1);
var Gesture = _Gesture;

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/ui/widget.ts
var Widget = class extends Disposable {
  onclick(domNode, listener) {
    this._register(addDisposableListener(domNode, EventType.CLICK, (e) => listener(new StandardMouseEvent(getWindow(domNode), e))));
  }
  onmousedown(domNode, listener) {
    this._register(addDisposableListener(domNode, EventType.MOUSE_DOWN, (e) => listener(new StandardMouseEvent(getWindow(domNode), e))));
  }
  onmouseover(domNode, listener) {
    this._register(addDisposableListener(domNode, EventType.MOUSE_OVER, (e) => listener(new StandardMouseEvent(getWindow(domNode), e))));
  }
  onmouseleave(domNode, listener) {
    this._register(addDisposableListener(domNode, EventType.MOUSE_LEAVE, (e) => listener(new StandardMouseEvent(getWindow(domNode), e))));
  }
  onkeydown(domNode, listener) {
    this._register(addDisposableListener(domNode, EventType.KEY_DOWN, (e) => listener(new StandardKeyboardEvent(e))));
  }
  onkeyup(domNode, listener) {
    this._register(addDisposableListener(domNode, EventType.KEY_UP, (e) => listener(new StandardKeyboardEvent(e))));
  }
  oninput(domNode, listener) {
    this._register(addDisposableListener(domNode, EventType.INPUT, listener));
  }
  onblur(domNode, listener) {
    this._register(addDisposableListener(domNode, EventType.BLUR, listener));
  }
  onfocus(domNode, listener) {
    this._register(addDisposableListener(domNode, EventType.FOCUS, listener));
  }
  onchange(domNode, listener) {
    this._register(addDisposableListener(domNode, EventType.CHANGE, listener));
  }
  ignoreGesture(domNode) {
    return Gesture.ignoreTarget(domNode);
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/codiconsUtil.ts
var _codiconFontCharacters = /* @__PURE__ */ Object.create(null);
function register(id2, fontCharacter) {
  if (isString(fontCharacter)) {
    const val = _codiconFontCharacters[fontCharacter];
    if (val === void 0) {
      throw new Error(`${id2} references an unknown codicon: ${fontCharacter}`);
    }
    fontCharacter = val;
  }
  _codiconFontCharacters[id2] = fontCharacter;
  return { id: id2 };
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/codiconsLibrary.ts
var codiconsLibrary = {
  add: register("add", 6e4),
  plus: register("plus", 6e4),
  gistNew: register("gist-new", 6e4),
  repoCreate: register("repo-create", 6e4),
  lightbulb: register("lightbulb", 60001),
  lightBulb: register("light-bulb", 60001),
  repo: register("repo", 60002),
  repoDelete: register("repo-delete", 60002),
  gistFork: register("gist-fork", 60003),
  repoForked: register("repo-forked", 60003),
  gitPullRequest: register("git-pull-request", 60004),
  gitPullRequestAbandoned: register("git-pull-request-abandoned", 60004),
  recordKeys: register("record-keys", 60005),
  keyboard: register("keyboard", 60005),
  tag: register("tag", 60006),
  gitPullRequestLabel: register("git-pull-request-label", 60006),
  tagAdd: register("tag-add", 60006),
  tagRemove: register("tag-remove", 60006),
  person: register("person", 60007),
  personFollow: register("person-follow", 60007),
  personOutline: register("person-outline", 60007),
  personFilled: register("person-filled", 60007),
  sourceControl: register("source-control", 60008),
  mirror: register("mirror", 60009),
  mirrorPublic: register("mirror-public", 60009),
  star: register("star", 60010),
  starAdd: register("star-add", 60010),
  starDelete: register("star-delete", 60010),
  starEmpty: register("star-empty", 60010),
  comment: register("comment", 60011),
  commentAdd: register("comment-add", 60011),
  alert: register("alert", 60012),
  warning: register("warning", 60012),
  search: register("search", 60013),
  searchSave: register("search-save", 60013),
  logOut: register("log-out", 60014),
  signOut: register("sign-out", 60014),
  logIn: register("log-in", 60015),
  signIn: register("sign-in", 60015),
  eye: register("eye", 60016),
  eyeUnwatch: register("eye-unwatch", 60016),
  eyeWatch: register("eye-watch", 60016),
  circleFilled: register("circle-filled", 60017),
  primitiveDot: register("primitive-dot", 60017),
  closeDirty: register("close-dirty", 60017),
  debugBreakpoint: register("debug-breakpoint", 60017),
  debugBreakpointDisabled: register("debug-breakpoint-disabled", 60017),
  debugHint: register("debug-hint", 60017),
  terminalDecorationSuccess: register("terminal-decoration-success", 60017),
  primitiveSquare: register("primitive-square", 60018),
  edit: register("edit", 60019),
  pencil: register("pencil", 60019),
  info: register("info", 60020),
  issueOpened: register("issue-opened", 60020),
  gistPrivate: register("gist-private", 60021),
  gitForkPrivate: register("git-fork-private", 60021),
  lock: register("lock", 60021),
  mirrorPrivate: register("mirror-private", 60021),
  close: register("close", 60022),
  removeClose: register("remove-close", 60022),
  x: register("x", 60022),
  repoSync: register("repo-sync", 60023),
  sync: register("sync", 60023),
  clone: register("clone", 60024),
  desktopDownload: register("desktop-download", 60024),
  beaker: register("beaker", 60025),
  microscope: register("microscope", 60025),
  vm: register("vm", 60026),
  deviceDesktop: register("device-desktop", 60026),
  file: register("file", 60027),
  more: register("more", 60028),
  ellipsis: register("ellipsis", 60028),
  kebabHorizontal: register("kebab-horizontal", 60028),
  mailReply: register("mail-reply", 60029),
  reply: register("reply", 60029),
  organization: register("organization", 60030),
  organizationFilled: register("organization-filled", 60030),
  organizationOutline: register("organization-outline", 60030),
  newFile: register("new-file", 60031),
  fileAdd: register("file-add", 60031),
  newFolder: register("new-folder", 60032),
  fileDirectoryCreate: register("file-directory-create", 60032),
  trash: register("trash", 60033),
  trashcan: register("trashcan", 60033),
  history: register("history", 60034),
  clock: register("clock", 60034),
  folder: register("folder", 60035),
  fileDirectory: register("file-directory", 60035),
  symbolFolder: register("symbol-folder", 60035),
  logoGithub: register("logo-github", 60036),
  markGithub: register("mark-github", 60036),
  github: register("github", 60036),
  terminal: register("terminal", 60037),
  console: register("console", 60037),
  repl: register("repl", 60037),
  zap: register("zap", 60038),
  symbolEvent: register("symbol-event", 60038),
  error: register("error", 60039),
  stop: register("stop", 60039),
  variable: register("variable", 60040),
  symbolVariable: register("symbol-variable", 60040),
  array: register("array", 60042),
  symbolArray: register("symbol-array", 60042),
  symbolModule: register("symbol-module", 60043),
  symbolPackage: register("symbol-package", 60043),
  symbolNamespace: register("symbol-namespace", 60043),
  symbolObject: register("symbol-object", 60043),
  symbolMethod: register("symbol-method", 60044),
  symbolFunction: register("symbol-function", 60044),
  symbolConstructor: register("symbol-constructor", 60044),
  symbolBoolean: register("symbol-boolean", 60047),
  symbolNull: register("symbol-null", 60047),
  symbolNumeric: register("symbol-numeric", 60048),
  symbolNumber: register("symbol-number", 60048),
  symbolStructure: register("symbol-structure", 60049),
  symbolStruct: register("symbol-struct", 60049),
  symbolParameter: register("symbol-parameter", 60050),
  symbolTypeParameter: register("symbol-type-parameter", 60050),
  symbolKey: register("symbol-key", 60051),
  symbolText: register("symbol-text", 60051),
  symbolReference: register("symbol-reference", 60052),
  goToFile: register("go-to-file", 60052),
  symbolEnum: register("symbol-enum", 60053),
  symbolValue: register("symbol-value", 60053),
  symbolRuler: register("symbol-ruler", 60054),
  symbolUnit: register("symbol-unit", 60054),
  activateBreakpoints: register("activate-breakpoints", 60055),
  archive: register("archive", 60056),
  arrowBoth: register("arrow-both", 60057),
  arrowDown: register("arrow-down", 60058),
  arrowLeft: register("arrow-left", 60059),
  arrowRight: register("arrow-right", 60060),
  arrowSmallDown: register("arrow-small-down", 60061),
  arrowSmallLeft: register("arrow-small-left", 60062),
  arrowSmallRight: register("arrow-small-right", 60063),
  arrowSmallUp: register("arrow-small-up", 60064),
  arrowUp: register("arrow-up", 60065),
  bell: register("bell", 60066),
  bold: register("bold", 60067),
  book: register("book", 60068),
  bookmark: register("bookmark", 60069),
  debugBreakpointConditionalUnverified: register("debug-breakpoint-conditional-unverified", 60070),
  debugBreakpointConditional: register("debug-breakpoint-conditional", 60071),
  debugBreakpointConditionalDisabled: register("debug-breakpoint-conditional-disabled", 60071),
  debugBreakpointDataUnverified: register("debug-breakpoint-data-unverified", 60072),
  debugBreakpointData: register("debug-breakpoint-data", 60073),
  debugBreakpointDataDisabled: register("debug-breakpoint-data-disabled", 60073),
  debugBreakpointLogUnverified: register("debug-breakpoint-log-unverified", 60074),
  debugBreakpointLog: register("debug-breakpoint-log", 60075),
  debugBreakpointLogDisabled: register("debug-breakpoint-log-disabled", 60075),
  briefcase: register("briefcase", 60076),
  broadcast: register("broadcast", 60077),
  browser: register("browser", 60078),
  bug: register("bug", 60079),
  calendar: register("calendar", 60080),
  caseSensitive: register("case-sensitive", 60081),
  check: register("check", 60082),
  checklist: register("checklist", 60083),
  chevronDown: register("chevron-down", 60084),
  chevronLeft: register("chevron-left", 60085),
  chevronRight: register("chevron-right", 60086),
  chevronUp: register("chevron-up", 60087),
  chromeClose: register("chrome-close", 60088),
  chromeMaximize: register("chrome-maximize", 60089),
  chromeMinimize: register("chrome-minimize", 60090),
  chromeRestore: register("chrome-restore", 60091),
  circleOutline: register("circle-outline", 60092),
  circle: register("circle", 60092),
  debugBreakpointUnverified: register("debug-breakpoint-unverified", 60092),
  terminalDecorationIncomplete: register("terminal-decoration-incomplete", 60092),
  circleSlash: register("circle-slash", 60093),
  circuitBoard: register("circuit-board", 60094),
  clearAll: register("clear-all", 60095),
  clippy: register("clippy", 60096),
  closeAll: register("close-all", 60097),
  cloudDownload: register("cloud-download", 60098),
  cloudUpload: register("cloud-upload", 60099),
  code: register("code", 60100),
  collapseAll: register("collapse-all", 60101),
  colorMode: register("color-mode", 60102),
  commentDiscussion: register("comment-discussion", 60103),
  creditCard: register("credit-card", 60105),
  dash: register("dash", 60108),
  dashboard: register("dashboard", 60109),
  database: register("database", 60110),
  debugContinue: register("debug-continue", 60111),
  debugDisconnect: register("debug-disconnect", 60112),
  debugPause: register("debug-pause", 60113),
  debugRestart: register("debug-restart", 60114),
  debugStart: register("debug-start", 60115),
  debugStepInto: register("debug-step-into", 60116),
  debugStepOut: register("debug-step-out", 60117),
  debugStepOver: register("debug-step-over", 60118),
  debugStop: register("debug-stop", 60119),
  debug: register("debug", 60120),
  deviceCameraVideo: register("device-camera-video", 60121),
  deviceCamera: register("device-camera", 60122),
  deviceMobile: register("device-mobile", 60123),
  diffAdded: register("diff-added", 60124),
  diffIgnored: register("diff-ignored", 60125),
  diffModified: register("diff-modified", 60126),
  diffRemoved: register("diff-removed", 60127),
  diffRenamed: register("diff-renamed", 60128),
  diff: register("diff", 60129),
  diffSidebyside: register("diff-sidebyside", 60129),
  discard: register("discard", 60130),
  editorLayout: register("editor-layout", 60131),
  emptyWindow: register("empty-window", 60132),
  exclude: register("exclude", 60133),
  extensions: register("extensions", 60134),
  eyeClosed: register("eye-closed", 60135),
  fileBinary: register("file-binary", 60136),
  fileCode: register("file-code", 60137),
  fileMedia: register("file-media", 60138),
  filePdf: register("file-pdf", 60139),
  fileSubmodule: register("file-submodule", 60140),
  fileSymlinkDirectory: register("file-symlink-directory", 60141),
  fileSymlinkFile: register("file-symlink-file", 60142),
  fileZip: register("file-zip", 60143),
  files: register("files", 60144),
  filter: register("filter", 60145),
  flame: register("flame", 60146),
  foldDown: register("fold-down", 60147),
  foldUp: register("fold-up", 60148),
  fold: register("fold", 60149),
  folderActive: register("folder-active", 60150),
  folderOpened: register("folder-opened", 60151),
  gear: register("gear", 60152),
  gift: register("gift", 60153),
  gistSecret: register("gist-secret", 60154),
  gist: register("gist", 60155),
  gitCommit: register("git-commit", 60156),
  gitCompare: register("git-compare", 60157),
  compareChanges: register("compare-changes", 60157),
  gitMerge: register("git-merge", 60158),
  githubAction: register("github-action", 60159),
  githubAlt: register("github-alt", 60160),
  globe: register("globe", 60161),
  grabber: register("grabber", 60162),
  graph: register("graph", 60163),
  gripper: register("gripper", 60164),
  heart: register("heart", 60165),
  home: register("home", 60166),
  horizontalRule: register("horizontal-rule", 60167),
  hubot: register("hubot", 60168),
  inbox: register("inbox", 60169),
  issueReopened: register("issue-reopened", 60171),
  issues: register("issues", 60172),
  italic: register("italic", 60173),
  jersey: register("jersey", 60174),
  json: register("json", 60175),
  bracket: register("bracket", 60175),
  kebabVertical: register("kebab-vertical", 60176),
  key: register("key", 60177),
  law: register("law", 60178),
  lightbulbAutofix: register("lightbulb-autofix", 60179),
  linkExternal: register("link-external", 60180),
  link: register("link", 60181),
  listOrdered: register("list-ordered", 60182),
  listUnordered: register("list-unordered", 60183),
  liveShare: register("live-share", 60184),
  loading: register("loading", 60185),
  location: register("location", 60186),
  mailRead: register("mail-read", 60187),
  mail: register("mail", 60188),
  markdown: register("markdown", 60189),
  megaphone: register("megaphone", 60190),
  mention: register("mention", 60191),
  milestone: register("milestone", 60192),
  gitPullRequestMilestone: register("git-pull-request-milestone", 60192),
  mortarBoard: register("mortar-board", 60193),
  move: register("move", 60194),
  multipleWindows: register("multiple-windows", 60195),
  mute: register("mute", 60196),
  noNewline: register("no-newline", 60197),
  note: register("note", 60198),
  octoface: register("octoface", 60199),
  openPreview: register("open-preview", 60200),
  package: register("package", 60201),
  paintcan: register("paintcan", 60202),
  pin: register("pin", 60203),
  play: register("play", 60204),
  run: register("run", 60204),
  plug: register("plug", 60205),
  preserveCase: register("preserve-case", 60206),
  preview: register("preview", 60207),
  project: register("project", 60208),
  pulse: register("pulse", 60209),
  question: register("question", 60210),
  quote: register("quote", 60211),
  radioTower: register("radio-tower", 60212),
  reactions: register("reactions", 60213),
  references: register("references", 60214),
  refresh: register("refresh", 60215),
  regex: register("regex", 60216),
  remoteExplorer: register("remote-explorer", 60217),
  remote: register("remote", 60218),
  remove: register("remove", 60219),
  replaceAll: register("replace-all", 60220),
  replace: register("replace", 60221),
  repoClone: register("repo-clone", 60222),
  repoForcePush: register("repo-force-push", 60223),
  repoPull: register("repo-pull", 60224),
  repoPush: register("repo-push", 60225),
  report: register("report", 60226),
  requestChanges: register("request-changes", 60227),
  rocket: register("rocket", 60228),
  rootFolderOpened: register("root-folder-opened", 60229),
  rootFolder: register("root-folder", 60230),
  rss: register("rss", 60231),
  ruby: register("ruby", 60232),
  saveAll: register("save-all", 60233),
  saveAs: register("save-as", 60234),
  save: register("save", 60235),
  screenFull: register("screen-full", 60236),
  screenNormal: register("screen-normal", 60237),
  searchStop: register("search-stop", 60238),
  server: register("server", 60240),
  settingsGear: register("settings-gear", 60241),
  settings: register("settings", 60242),
  shield: register("shield", 60243),
  smiley: register("smiley", 60244),
  sortPrecedence: register("sort-precedence", 60245),
  splitHorizontal: register("split-horizontal", 60246),
  splitVertical: register("split-vertical", 60247),
  squirrel: register("squirrel", 60248),
  starFull: register("star-full", 60249),
  starHalf: register("star-half", 60250),
  symbolClass: register("symbol-class", 60251),
  symbolColor: register("symbol-color", 60252),
  symbolConstant: register("symbol-constant", 60253),
  symbolEnumMember: register("symbol-enum-member", 60254),
  symbolField: register("symbol-field", 60255),
  symbolFile: register("symbol-file", 60256),
  symbolInterface: register("symbol-interface", 60257),
  symbolKeyword: register("symbol-keyword", 60258),
  symbolMisc: register("symbol-misc", 60259),
  symbolOperator: register("symbol-operator", 60260),
  symbolProperty: register("symbol-property", 60261),
  wrench: register("wrench", 60261),
  wrenchSubaction: register("wrench-subaction", 60261),
  symbolSnippet: register("symbol-snippet", 60262),
  tasklist: register("tasklist", 60263),
  telescope: register("telescope", 60264),
  textSize: register("text-size", 60265),
  threeBars: register("three-bars", 60266),
  thumbsdown: register("thumbsdown", 60267),
  thumbsup: register("thumbsup", 60268),
  tools: register("tools", 60269),
  triangleDown: register("triangle-down", 60270),
  triangleLeft: register("triangle-left", 60271),
  triangleRight: register("triangle-right", 60272),
  triangleUp: register("triangle-up", 60273),
  twitter: register("twitter", 60274),
  unfold: register("unfold", 60275),
  unlock: register("unlock", 60276),
  unmute: register("unmute", 60277),
  unverified: register("unverified", 60278),
  verified: register("verified", 60279),
  versions: register("versions", 60280),
  vmActive: register("vm-active", 60281),
  vmOutline: register("vm-outline", 60282),
  vmRunning: register("vm-running", 60283),
  watch: register("watch", 60284),
  whitespace: register("whitespace", 60285),
  wholeWord: register("whole-word", 60286),
  window: register("window", 60287),
  wordWrap: register("word-wrap", 60288),
  zoomIn: register("zoom-in", 60289),
  zoomOut: register("zoom-out", 60290),
  listFilter: register("list-filter", 60291),
  listFlat: register("list-flat", 60292),
  listSelection: register("list-selection", 60293),
  selection: register("selection", 60293),
  listTree: register("list-tree", 60294),
  debugBreakpointFunctionUnverified: register("debug-breakpoint-function-unverified", 60295),
  debugBreakpointFunction: register("debug-breakpoint-function", 60296),
  debugBreakpointFunctionDisabled: register("debug-breakpoint-function-disabled", 60296),
  debugStackframeActive: register("debug-stackframe-active", 60297),
  circleSmallFilled: register("circle-small-filled", 60298),
  debugStackframeDot: register("debug-stackframe-dot", 60298),
  terminalDecorationMark: register("terminal-decoration-mark", 60298),
  debugStackframe: register("debug-stackframe", 60299),
  debugStackframeFocused: register("debug-stackframe-focused", 60299),
  debugBreakpointUnsupported: register("debug-breakpoint-unsupported", 60300),
  symbolString: register("symbol-string", 60301),
  debugReverseContinue: register("debug-reverse-continue", 60302),
  debugStepBack: register("debug-step-back", 60303),
  debugRestartFrame: register("debug-restart-frame", 60304),
  debugAlt: register("debug-alt", 60305),
  callIncoming: register("call-incoming", 60306),
  callOutgoing: register("call-outgoing", 60307),
  menu: register("menu", 60308),
  expandAll: register("expand-all", 60309),
  feedback: register("feedback", 60310),
  gitPullRequestReviewer: register("git-pull-request-reviewer", 60310),
  groupByRefType: register("group-by-ref-type", 60311),
  ungroupByRefType: register("ungroup-by-ref-type", 60312),
  account: register("account", 60313),
  gitPullRequestAssignee: register("git-pull-request-assignee", 60313),
  bellDot: register("bell-dot", 60314),
  debugConsole: register("debug-console", 60315),
  library: register("library", 60316),
  output: register("output", 60317),
  runAll: register("run-all", 60318),
  syncIgnored: register("sync-ignored", 60319),
  pinned: register("pinned", 60320),
  githubInverted: register("github-inverted", 60321),
  serverProcess: register("server-process", 60322),
  serverEnvironment: register("server-environment", 60323),
  pass: register("pass", 60324),
  issueClosed: register("issue-closed", 60324),
  stopCircle: register("stop-circle", 60325),
  playCircle: register("play-circle", 60326),
  record: register("record", 60327),
  debugAltSmall: register("debug-alt-small", 60328),
  vmConnect: register("vm-connect", 60329),
  cloud: register("cloud", 60330),
  merge: register("merge", 60331),
  export: register("export", 60332),
  graphLeft: register("graph-left", 60333),
  magnet: register("magnet", 60334),
  notebook: register("notebook", 60335),
  redo: register("redo", 60336),
  checkAll: register("check-all", 60337),
  pinnedDirty: register("pinned-dirty", 60338),
  passFilled: register("pass-filled", 60339),
  circleLargeFilled: register("circle-large-filled", 60340),
  circleLarge: register("circle-large", 60341),
  circleLargeOutline: register("circle-large-outline", 60341),
  combine: register("combine", 60342),
  gather: register("gather", 60342),
  table: register("table", 60343),
  variableGroup: register("variable-group", 60344),
  typeHierarchy: register("type-hierarchy", 60345),
  typeHierarchySub: register("type-hierarchy-sub", 60346),
  typeHierarchySuper: register("type-hierarchy-super", 60347),
  gitPullRequestCreate: register("git-pull-request-create", 60348),
  runAbove: register("run-above", 60349),
  runBelow: register("run-below", 60350),
  notebookTemplate: register("notebook-template", 60351),
  debugRerun: register("debug-rerun", 60352),
  workspaceTrusted: register("workspace-trusted", 60353),
  workspaceUntrusted: register("workspace-untrusted", 60354),
  workspaceUnknown: register("workspace-unknown", 60355),
  terminalCmd: register("terminal-cmd", 60356),
  terminalDebian: register("terminal-debian", 60357),
  terminalLinux: register("terminal-linux", 60358),
  terminalPowershell: register("terminal-powershell", 60359),
  terminalTmux: register("terminal-tmux", 60360),
  terminalUbuntu: register("terminal-ubuntu", 60361),
  terminalBash: register("terminal-bash", 60362),
  arrowSwap: register("arrow-swap", 60363),
  copy: register("copy", 60364),
  personAdd: register("person-add", 60365),
  filterFilled: register("filter-filled", 60366),
  wand: register("wand", 60367),
  debugLineByLine: register("debug-line-by-line", 60368),
  inspect: register("inspect", 60369),
  layers: register("layers", 60370),
  layersDot: register("layers-dot", 60371),
  layersActive: register("layers-active", 60372),
  compass: register("compass", 60373),
  compassDot: register("compass-dot", 60374),
  compassActive: register("compass-active", 60375),
  azure: register("azure", 60376),
  issueDraft: register("issue-draft", 60377),
  gitPullRequestClosed: register("git-pull-request-closed", 60378),
  gitPullRequestDraft: register("git-pull-request-draft", 60379),
  debugAll: register("debug-all", 60380),
  debugCoverage: register("debug-coverage", 60381),
  runErrors: register("run-errors", 60382),
  folderLibrary: register("folder-library", 60383),
  debugContinueSmall: register("debug-continue-small", 60384),
  beakerStop: register("beaker-stop", 60385),
  graphLine: register("graph-line", 60386),
  graphScatter: register("graph-scatter", 60387),
  pieChart: register("pie-chart", 60388),
  bracketDot: register("bracket-dot", 60389),
  bracketError: register("bracket-error", 60390),
  lockSmall: register("lock-small", 60391),
  azureDevops: register("azure-devops", 60392),
  verifiedFilled: register("verified-filled", 60393),
  newline: register("newline", 60394),
  layout: register("layout", 60395),
  layoutActivitybarLeft: register("layout-activitybar-left", 60396),
  layoutActivitybarRight: register("layout-activitybar-right", 60397),
  layoutPanelLeft: register("layout-panel-left", 60398),
  layoutPanelCenter: register("layout-panel-center", 60399),
  layoutPanelJustify: register("layout-panel-justify", 60400),
  layoutPanelRight: register("layout-panel-right", 60401),
  layoutPanel: register("layout-panel", 60402),
  layoutSidebarLeft: register("layout-sidebar-left", 60403),
  layoutSidebarRight: register("layout-sidebar-right", 60404),
  layoutStatusbar: register("layout-statusbar", 60405),
  layoutMenubar: register("layout-menubar", 60406),
  layoutCentered: register("layout-centered", 60407),
  target: register("target", 60408),
  indent: register("indent", 60409),
  recordSmall: register("record-small", 60410),
  errorSmall: register("error-small", 60411),
  terminalDecorationError: register("terminal-decoration-error", 60411),
  arrowCircleDown: register("arrow-circle-down", 60412),
  arrowCircleLeft: register("arrow-circle-left", 60413),
  arrowCircleRight: register("arrow-circle-right", 60414),
  arrowCircleUp: register("arrow-circle-up", 60415),
  layoutSidebarRightOff: register("layout-sidebar-right-off", 60416),
  layoutPanelOff: register("layout-panel-off", 60417),
  layoutSidebarLeftOff: register("layout-sidebar-left-off", 60418),
  blank: register("blank", 60419),
  heartFilled: register("heart-filled", 60420),
  map: register("map", 60421),
  mapHorizontal: register("map-horizontal", 60421),
  foldHorizontal: register("fold-horizontal", 60421),
  mapFilled: register("map-filled", 60422),
  mapHorizontalFilled: register("map-horizontal-filled", 60422),
  foldHorizontalFilled: register("fold-horizontal-filled", 60422),
  circleSmall: register("circle-small", 60423),
  bellSlash: register("bell-slash", 60424),
  bellSlashDot: register("bell-slash-dot", 60425),
  commentUnresolved: register("comment-unresolved", 60426),
  gitPullRequestGoToChanges: register("git-pull-request-go-to-changes", 60427),
  gitPullRequestNewChanges: register("git-pull-request-new-changes", 60428),
  searchFuzzy: register("search-fuzzy", 60429),
  commentDraft: register("comment-draft", 60430),
  send: register("send", 60431),
  sparkle: register("sparkle", 60432),
  insert: register("insert", 60433),
  mic: register("mic", 60434),
  thumbsdownFilled: register("thumbsdown-filled", 60435),
  thumbsupFilled: register("thumbsup-filled", 60436),
  coffee: register("coffee", 60437),
  snake: register("snake", 60438),
  game: register("game", 60439),
  vr: register("vr", 60440),
  chip: register("chip", 60441),
  piano: register("piano", 60442),
  music: register("music", 60443),
  micFilled: register("mic-filled", 60444),
  repoFetch: register("repo-fetch", 60445),
  copilot: register("copilot", 60446),
  lightbulbSparkle: register("lightbulb-sparkle", 60447),
  robot: register("robot", 60448),
  sparkleFilled: register("sparkle-filled", 60449),
  diffSingle: register("diff-single", 60450),
  diffMultiple: register("diff-multiple", 60451),
  surroundWith: register("surround-with", 60452),
  share: register("share", 60453),
  gitStash: register("git-stash", 60454),
  gitStashApply: register("git-stash-apply", 60455),
  gitStashPop: register("git-stash-pop", 60456),
  vscode: register("vscode", 60457),
  vscodeInsiders: register("vscode-insiders", 60458),
  codeOss: register("code-oss", 60459),
  runCoverage: register("run-coverage", 60460),
  runAllCoverage: register("run-all-coverage", 60461),
  coverage: register("coverage", 60462),
  githubProject: register("github-project", 60463),
  mapVertical: register("map-vertical", 60464),
  foldVertical: register("fold-vertical", 60464),
  mapVerticalFilled: register("map-vertical-filled", 60465),
  foldVerticalFilled: register("fold-vertical-filled", 60465),
  goToSearch: register("go-to-search", 60466),
  percentage: register("percentage", 60467),
  sortPercentage: register("sort-percentage", 60467),
  attach: register("attach", 60468),
  goToEditingSession: register("go-to-editing-session", 60469),
  editSession: register("edit-session", 60470),
  codeReview: register("code-review", 60471),
  copilotWarning: register("copilot-warning", 60472),
  python: register("python", 60473),
  copilotLarge: register("copilot-large", 60474),
  copilotWarningLarge: register("copilot-warning-large", 60475),
  keyboardTab: register("keyboard-tab", 60476),
  copilotBlocked: register("copilot-blocked", 60477),
  copilotNotConnected: register("copilot-not-connected", 60478),
  flag: register("flag", 60479),
  lightbulbEmpty: register("lightbulb-empty", 60480),
  symbolMethodArrow: register("symbol-method-arrow", 60481),
  copilotUnavailable: register("copilot-unavailable", 60482),
  repoPinned: register("repo-pinned", 60483),
  keyboardTabAbove: register("keyboard-tab-above", 60484),
  keyboardTabBelow: register("keyboard-tab-below", 60485),
  gitPullRequestDone: register("git-pull-request-done", 60486),
  mcp: register("mcp", 60487),
  extensionsLarge: register("extensions-large", 60488),
  layoutPanelDock: register("layout-panel-dock", 60489),
  layoutSidebarLeftDock: register("layout-sidebar-left-dock", 60490),
  layoutSidebarRightDock: register("layout-sidebar-right-dock", 60491),
  copilotInProgress: register("copilot-in-progress", 60492),
  copilotError: register("copilot-error", 60493),
  copilotSuccess: register("copilot-success", 60494),
  chatSparkle: register("chat-sparkle", 60495),
  searchSparkle: register("search-sparkle", 60496),
  editSparkle: register("edit-sparkle", 60497),
  copilotSnooze: register("copilot-snooze", 60498),
  sendToRemoteAgent: register("send-to-remote-agent", 60499),
  commentDiscussionSparkle: register("comment-discussion-sparkle", 60500),
  chatSparkleWarning: register("chat-sparkle-warning", 60501),
  chatSparkleError: register("chat-sparkle-error", 60502),
  collection: register("collection", 60503),
  newCollection: register("new-collection", 60504),
  thinking: register("thinking", 60505),
  build: register("build", 60506),
  commentDiscussionQuote: register("comment-discussion-quote", 60507),
  cursor: register("cursor", 60508),
  eraser: register("eraser", 60509),
  fileText: register("file-text", 60510),
  quotes: register("quotes", 60512),
  rename: register("rename", 60513),
  runWithDeps: register("run-with-deps", 60514),
  debugConnected: register("debug-connected", 60515),
  strikethrough: register("strikethrough", 60516),
  openInProduct: register("open-in-product", 60517),
  indexZero: register("index-zero", 60518),
  agent: register("agent", 60519),
  editCode: register("edit-code", 60520),
  repoSelected: register("repo-selected", 60521),
  skip: register("skip", 60522),
  mergeInto: register("merge-into", 60523),
  gitBranchChanges: register("git-branch-changes", 60524),
  gitBranchStagedChanges: register("git-branch-staged-changes", 60525),
  gitBranchConflicts: register("git-branch-conflicts", 60526),
  gitBranch: register("git-branch", 60527),
  gitBranchCreate: register("git-branch-create", 60527),
  gitBranchDelete: register("git-branch-delete", 60527),
  searchLarge: register("search-large", 60528),
  terminalGitBash: register("terminal-git-bash", 60529),
  windowActive: register("window-active", 60530),
  forward: register("forward", 60531),
  download: register("download", 60532),
  clockface: register("clockface", 60533),
  unarchive: register("unarchive", 60534),
  sessionInProgress: register("session-in-progress", 60535),
  collectionSmall: register("collection-small", 60536),
  vmSmall: register("vm-small", 60537),
  cloudSmall: register("cloud-small", 60538),
  addSmall: register("add-small", 60539),
  removeSmall: register("remove-small", 60540),
  worktreeSmall: register("worktree-small", 60541),
  worktree: register("worktree", 60542)
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/codicons.ts
var codiconsDerived = {
  dialogError: register("dialog-error", "error"),
  dialogWarning: register("dialog-warning", "warning"),
  dialogInfo: register("dialog-info", "info"),
  dialogClose: register("dialog-close", "close"),
  treeItemExpanded: register("tree-item-expanded", "chevron-down"),
  // collapsed is done with rotation
  treeFilterOnTypeOn: register("tree-filter-on-type-on", "list-filter"),
  treeFilterOnTypeOff: register("tree-filter-on-type-off", "list-selection"),
  treeFilterClear: register("tree-filter-clear", "close"),
  treeItemLoading: register("tree-item-loading", "loading"),
  menuSelection: register("menu-selection", "check"),
  menuSubmenu: register("menu-submenu", "chevron-right"),
  menuBarMore: register("menubar-more", "more"),
  scrollbarButtonLeft: register("scrollbar-button-left", "triangle-left"),
  scrollbarButtonRight: register("scrollbar-button-right", "triangle-right"),
  scrollbarButtonUp: register("scrollbar-button-up", "triangle-up"),
  scrollbarButtonDown: register("scrollbar-button-down", "triangle-down"),
  toolBarMore: register("toolbar-more", "more"),
  quickInputBack: register("quick-input-back", "arrow-left"),
  dropDownButton: register("drop-down-button", 60084),
  symbolCustomColor: register("symbol-customcolor", 60252),
  exportIcon: register("export", 60332),
  workspaceUnspecified: register("workspace-unspecified", 60355),
  newLine: register("newline", 60394),
  thumbsDownFilled: register("thumbsdown-filled", 60435),
  thumbsUpFilled: register("thumbsup-filled", 60436),
  gitFetch: register("git-fetch", 60445),
  lightbulbSparkleAutofix: register("lightbulb-sparkle-autofix", 60447),
  debugBreakpointPending: register("debug-breakpoint-pending", 60377)
};
var Codicon = {
  ...codiconsLibrary,
  ...codiconsDerived
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/themables.ts
var ThemeColor;
((ThemeColor2) => {
  function isThemeColor(obj) {
    return !!obj && typeof obj === "object" && typeof obj.id === "string";
  }
  ThemeColor2.isThemeColor = isThemeColor;
})(ThemeColor || (ThemeColor = {}));
var ThemeIcon;
((ThemeIcon2) => {
  ThemeIcon2.iconNameSegment = "[A-Za-z0-9]+";
  ThemeIcon2.iconNameExpression = "[A-Za-z0-9-]+";
  ThemeIcon2.iconModifierExpression = "~[A-Za-z]+";
  ThemeIcon2.iconNameCharacter = "[A-Za-z0-9~-]";
  const ThemeIconIdRegex = new RegExp(`^(${ThemeIcon2.iconNameExpression})(${ThemeIcon2.iconModifierExpression})?$`);
  function asClassNameArray(icon) {
    const match = ThemeIconIdRegex.exec(icon.id);
    if (!match) {
      return asClassNameArray(Codicon.error);
    }
    const [, id2, modifier] = match;
    const classNames = ["codicon", "codicon-" + id2];
    if (modifier) {
      classNames.push("codicon-modifier-" + modifier.substring(1));
    }
    return classNames;
  }
  ThemeIcon2.asClassNameArray = asClassNameArray;
  function asClassName(icon) {
    return asClassNameArray(icon).join(" ");
  }
  ThemeIcon2.asClassName = asClassName;
  function asCSSSelector(icon) {
    return "." + asClassNameArray(icon).join(".");
  }
  ThemeIcon2.asCSSSelector = asCSSSelector;
  function isThemeIcon(obj) {
    return !!obj && typeof obj === "object" && typeof obj.id === "string" && (typeof obj.color === "undefined" || ThemeColor.isThemeColor(obj.color));
  }
  ThemeIcon2.isThemeIcon = isThemeIcon;
  const _regexFromString = new RegExp(`^\\$\\((${ThemeIcon2.iconNameExpression}(?:${ThemeIcon2.iconModifierExpression})?)\\)$`);
  function fromString(str) {
    const match = _regexFromString.exec(str);
    if (!match) {
      return void 0;
    }
    const [, name] = match;
    return { id: name };
  }
  ThemeIcon2.fromString = fromString;
  function fromId(id2) {
    return { id: id2 };
  }
  ThemeIcon2.fromId = fromId;
  function modify2(icon, modifier) {
    let id2 = icon.id;
    const tildeIndex = id2.lastIndexOf("~");
    if (tildeIndex !== -1) {
      id2 = id2.substring(0, tildeIndex);
    }
    if (modifier) {
      id2 = `${id2}~${modifier}`;
    }
    return { id: id2 };
  }
  ThemeIcon2.modify = modify2;
  function getModifier(icon) {
    const tildeIndex = icon.id.lastIndexOf("~");
    if (tildeIndex !== -1) {
      return icon.id.substring(tildeIndex + 1);
    }
    return void 0;
  }
  ThemeIcon2.getModifier = getModifier;
  function isEqual2(ti1, ti2) {
    return ti1.id === ti2.id && ti1.color?.id === ti2.color?.id;
  }
  ThemeIcon2.isEqual = isEqual2;
  function isFile(icon) {
    return icon?.id === Codicon.file.id;
  }
  ThemeIcon2.isFile = isFile;
  function isFolder(icon) {
    return icon?.id === Codicon.folder.id;
  }
  ThemeIcon2.isFolder = isFolder;
})(ThemeIcon || (ThemeIcon = {}));

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/ui/scrollbar/scrollbarArrow.ts
var ARROW_IMG_SIZE = 11;
var ScrollbarArrow = class extends Widget {
  constructor(opts) {
    super();
    this._onActivate = opts.onActivate;
    this.bgDomNode = document.createElement("div");
    this.bgDomNode.className = "arrow-background";
    this.bgDomNode.style.position = "absolute";
    this.bgDomNode.style.width = opts.bgWidth + "px";
    this.bgDomNode.style.height = opts.bgHeight + "px";
    if (typeof opts.top !== "undefined") {
      this.bgDomNode.style.top = "0px";
    }
    if (typeof opts.left !== "undefined") {
      this.bgDomNode.style.left = "0px";
    }
    if (typeof opts.bottom !== "undefined") {
      this.bgDomNode.style.bottom = "0px";
    }
    if (typeof opts.right !== "undefined") {
      this.bgDomNode.style.right = "0px";
    }
    this.domNode = document.createElement("div");
    this.domNode.className = opts.className;
    this.domNode.classList.add(...ThemeIcon.asClassNameArray(opts.icon));
    this.domNode.style.position = "absolute";
    this.domNode.style.width = ARROW_IMG_SIZE + "px";
    this.domNode.style.height = ARROW_IMG_SIZE + "px";
    if (typeof opts.top !== "undefined") {
      this.domNode.style.top = opts.top + "px";
    }
    if (typeof opts.left !== "undefined") {
      this.domNode.style.left = opts.left + "px";
    }
    if (typeof opts.bottom !== "undefined") {
      this.domNode.style.bottom = opts.bottom + "px";
    }
    if (typeof opts.right !== "undefined") {
      this.domNode.style.right = opts.right + "px";
    }
    this._pointerMoveMonitor = this._register(new GlobalPointerMoveMonitor());
    this._register(addStandardDisposableListener(this.bgDomNode, EventType.POINTER_DOWN, (e) => this._arrowPointerDown(e)));
    this._register(addStandardDisposableListener(this.domNode, EventType.POINTER_DOWN, (e) => this._arrowPointerDown(e)));
    this._pointerdownRepeatTimer = this._register(new WindowIntervalTimer());
    this._pointerdownScheduleRepeatTimer = this._register(new TimeoutTimer());
  }
  _arrowPointerDown(e) {
    if (!e.target || !(e.target instanceof Element)) {
      return;
    }
    const scheduleRepeater = () => {
      this._pointerdownRepeatTimer.cancelAndSet(() => this._onActivate(), 1e3 / 24, getWindow(e));
    };
    this._onActivate();
    this._pointerdownRepeatTimer.cancel();
    this._pointerdownScheduleRepeatTimer.cancelAndSet(scheduleRepeater, 200);
    this._pointerMoveMonitor.startMonitoring(
      e.target,
      e.pointerId,
      e.buttons,
      (pointerMoveData) => {
      },
      () => {
        this._pointerdownRepeatTimer.cancel();
        this._pointerdownScheduleRepeatTimer.cancel();
      }
    );
    e.preventDefault();
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/common/scrollable.ts
var ScrollbarVisibility = /* @__PURE__ */ ((ScrollbarVisibility2) => {
  ScrollbarVisibility2[ScrollbarVisibility2["Auto"] = 1] = "Auto";
  ScrollbarVisibility2[ScrollbarVisibility2["Hidden"] = 2] = "Hidden";
  ScrollbarVisibility2[ScrollbarVisibility2["Visible"] = 3] = "Visible";
  return ScrollbarVisibility2;
})(ScrollbarVisibility || {});
var ScrollState = class _ScrollState {
  constructor(_forceIntegerValues, width, scrollWidth, scrollLeft, height, scrollHeight, scrollTop) {
    this._forceIntegerValues = _forceIntegerValues;
    this._scrollStateBrand = void 0;
    if (this._forceIntegerValues) {
      width = width | 0;
      scrollWidth = scrollWidth | 0;
      scrollLeft = scrollLeft | 0;
      height = height | 0;
      scrollHeight = scrollHeight | 0;
      scrollTop = scrollTop | 0;
    }
    this.rawScrollLeft = scrollLeft;
    this.rawScrollTop = scrollTop;
    if (width < 0) {
      width = 0;
    }
    if (scrollLeft + width > scrollWidth) {
      scrollLeft = scrollWidth - width;
    }
    if (scrollLeft < 0) {
      scrollLeft = 0;
    }
    if (height < 0) {
      height = 0;
    }
    if (scrollTop + height > scrollHeight) {
      scrollTop = scrollHeight - height;
    }
    if (scrollTop < 0) {
      scrollTop = 0;
    }
    this.width = width;
    this.scrollWidth = scrollWidth;
    this.scrollLeft = scrollLeft;
    this.height = height;
    this.scrollHeight = scrollHeight;
    this.scrollTop = scrollTop;
  }
  equals(other) {
    return this.rawScrollLeft === other.rawScrollLeft && this.rawScrollTop === other.rawScrollTop && this.width === other.width && this.scrollWidth === other.scrollWidth && this.scrollLeft === other.scrollLeft && this.height === other.height && this.scrollHeight === other.scrollHeight && this.scrollTop === other.scrollTop;
  }
  withScrollDimensions(update, useRawScrollPositions) {
    return new _ScrollState(
      this._forceIntegerValues,
      typeof update.width !== "undefined" ? update.width : this.width,
      typeof update.scrollWidth !== "undefined" ? update.scrollWidth : this.scrollWidth,
      useRawScrollPositions ? this.rawScrollLeft : this.scrollLeft,
      typeof update.height !== "undefined" ? update.height : this.height,
      typeof update.scrollHeight !== "undefined" ? update.scrollHeight : this.scrollHeight,
      useRawScrollPositions ? this.rawScrollTop : this.scrollTop
    );
  }
  withScrollPosition(update) {
    return new _ScrollState(
      this._forceIntegerValues,
      this.width,
      this.scrollWidth,
      typeof update.scrollLeft !== "undefined" ? update.scrollLeft : this.rawScrollLeft,
      this.height,
      this.scrollHeight,
      typeof update.scrollTop !== "undefined" ? update.scrollTop : this.rawScrollTop
    );
  }
  createScrollEvent(previous, inSmoothScrolling) {
    const widthChanged = this.width !== previous.width;
    const scrollWidthChanged = this.scrollWidth !== previous.scrollWidth;
    const scrollLeftChanged = this.scrollLeft !== previous.scrollLeft;
    const heightChanged = this.height !== previous.height;
    const scrollHeightChanged = this.scrollHeight !== previous.scrollHeight;
    const scrollTopChanged = this.scrollTop !== previous.scrollTop;
    return {
      inSmoothScrolling,
      oldWidth: previous.width,
      oldScrollWidth: previous.scrollWidth,
      oldScrollLeft: previous.scrollLeft,
      width: this.width,
      scrollWidth: this.scrollWidth,
      scrollLeft: this.scrollLeft,
      oldHeight: previous.height,
      oldScrollHeight: previous.scrollHeight,
      oldScrollTop: previous.scrollTop,
      height: this.height,
      scrollHeight: this.scrollHeight,
      scrollTop: this.scrollTop,
      widthChanged,
      scrollWidthChanged,
      scrollLeftChanged,
      heightChanged,
      scrollHeightChanged,
      scrollTopChanged
    };
  }
};
var Scrollable = class extends Disposable {
  constructor(options) {
    super();
    this._scrollableBrand = void 0;
    this._onScroll = this._register(new Emitter());
    this.onScroll = this._onScroll.event;
    this._smoothScrollDuration = options.smoothScrollDuration;
    this._scheduleAtNextAnimationFrame = options.scheduleAtNextAnimationFrame;
    this._state = new ScrollState(options.forceIntegerValues, 0, 0, 0, 0, 0, 0);
    this._smoothScrolling = null;
  }
  dispose() {
    if (this._smoothScrolling) {
      this._smoothScrolling.dispose();
      this._smoothScrolling = null;
    }
    super.dispose();
  }
  setSmoothScrollDuration(smoothScrollDuration) {
    this._smoothScrollDuration = smoothScrollDuration;
  }
  validateScrollPosition(scrollPosition) {
    return this._state.withScrollPosition(scrollPosition);
  }
  getScrollDimensions() {
    return this._state;
  }
  setScrollDimensions(dimensions, useRawScrollPositions) {
    const newState = this._state.withScrollDimensions(dimensions, useRawScrollPositions);
    this._setState(newState, Boolean(this._smoothScrolling));
    this._smoothScrolling?.acceptScrollDimensions(this._state);
  }
  /**
   * Returns the final scroll position that the instance will have once the smooth scroll animation concludes.
   * If no scroll animation is occurring, it will return the current scroll position instead.
   */
  getFutureScrollPosition() {
    if (this._smoothScrolling) {
      return this._smoothScrolling.to;
    }
    return this._state;
  }
  /**
   * Returns the current scroll position.
   * Note: This result might be an intermediate scroll position, as there might be an ongoing smooth scroll animation.
   */
  getCurrentScrollPosition() {
    return this._state;
  }
  setScrollPositionNow(update) {
    const newState = this._state.withScrollPosition(update);
    if (this._smoothScrolling) {
      this._smoothScrolling.dispose();
      this._smoothScrolling = null;
    }
    this._setState(newState, false);
  }
  setScrollPositionSmooth(update, reuseAnimation) {
    if (this._smoothScrollDuration === 0) {
      return this.setScrollPositionNow(update);
    }
    if (this._smoothScrolling) {
      update = {
        scrollLeft: typeof update.scrollLeft === "undefined" ? this._smoothScrolling.to.scrollLeft : update.scrollLeft,
        scrollTop: typeof update.scrollTop === "undefined" ? this._smoothScrolling.to.scrollTop : update.scrollTop
      };
      const validTarget = this._state.withScrollPosition(update);
      if (this._smoothScrolling.to.scrollLeft === validTarget.scrollLeft && this._smoothScrolling.to.scrollTop === validTarget.scrollTop) {
        return;
      }
      let newSmoothScrolling;
      if (reuseAnimation) {
        newSmoothScrolling = new SmoothScrollingOperation(this._smoothScrolling.from, validTarget, this._smoothScrolling.startTime, this._smoothScrolling.duration);
      } else {
        newSmoothScrolling = this._smoothScrolling.combine(this._state, validTarget, this._smoothScrollDuration);
      }
      this._smoothScrolling.dispose();
      this._smoothScrolling = newSmoothScrolling;
    } else {
      const validTarget = this._state.withScrollPosition(update);
      this._smoothScrolling = SmoothScrollingOperation.start(this._state, validTarget, this._smoothScrollDuration);
    }
    this._smoothScrolling.animationFrameDisposable = this._scheduleAtNextAnimationFrame(() => {
      if (!this._smoothScrolling) {
        return;
      }
      this._smoothScrolling.animationFrameDisposable = null;
      this._performSmoothScrolling();
    });
  }
  hasPendingScrollAnimation() {
    return Boolean(this._smoothScrolling);
  }
  _performSmoothScrolling() {
    if (!this._smoothScrolling) {
      return;
    }
    const update = this._smoothScrolling.tick();
    const newState = this._state.withScrollPosition(update);
    this._setState(newState, true);
    if (!this._smoothScrolling) {
      return;
    }
    if (update.isDone) {
      this._smoothScrolling.dispose();
      this._smoothScrolling = null;
      return;
    }
    this._smoothScrolling.animationFrameDisposable = this._scheduleAtNextAnimationFrame(() => {
      if (!this._smoothScrolling) {
        return;
      }
      this._smoothScrolling.animationFrameDisposable = null;
      this._performSmoothScrolling();
    });
  }
  _setState(newState, inSmoothScrolling) {
    const oldState = this._state;
    if (oldState.equals(newState)) {
      return;
    }
    this._state = newState;
    this._onScroll.fire(this._state.createScrollEvent(oldState, inSmoothScrolling));
  }
};
var SmoothScrollingUpdate = class {
  constructor(scrollLeft, scrollTop, isDone) {
    this.scrollLeft = scrollLeft;
    this.scrollTop = scrollTop;
    this.isDone = isDone;
  }
};
function createEaseOutCubic(from, to) {
  const delta = to - from;
  return function(completion) {
    return from + delta * easeOutCubic(completion);
  };
}
function createComposed(a, b, cut) {
  return function(completion) {
    if (completion < cut) {
      return a(completion / cut);
    }
    return b((completion - cut) / (1 - cut));
  };
}
var SmoothScrollingOperation = class _SmoothScrollingOperation {
  constructor(from, to, startTime, duration) {
    this.from = from;
    this.to = to;
    this.duration = duration;
    this.startTime = startTime;
    this.animationFrameDisposable = null;
    this._initAnimations();
  }
  _initAnimations() {
    this.scrollLeft = this._initAnimation(this.from.scrollLeft, this.to.scrollLeft, this.to.width);
    this.scrollTop = this._initAnimation(this.from.scrollTop, this.to.scrollTop, this.to.height);
  }
  _initAnimation(from, to, viewportSize) {
    const delta = Math.abs(from - to);
    if (delta > 2.5 * viewportSize) {
      let stop1, stop2;
      if (from < to) {
        stop1 = from + 0.75 * viewportSize;
        stop2 = to - 0.75 * viewportSize;
      } else {
        stop1 = from - 0.75 * viewportSize;
        stop2 = to + 0.75 * viewportSize;
      }
      return createComposed(createEaseOutCubic(from, stop1), createEaseOutCubic(stop2, to), 0.33);
    }
    return createEaseOutCubic(from, to);
  }
  dispose() {
    if (this.animationFrameDisposable !== null) {
      this.animationFrameDisposable.dispose();
      this.animationFrameDisposable = null;
    }
  }
  acceptScrollDimensions(state) {
    this.to = state.withScrollPosition(this.to);
    this._initAnimations();
  }
  tick() {
    return this._tick(Date.now());
  }
  _tick(now) {
    const completion = (now - this.startTime) / this.duration;
    if (completion < 1) {
      const newScrollLeft = this.scrollLeft(completion);
      const newScrollTop = this.scrollTop(completion);
      return new SmoothScrollingUpdate(newScrollLeft, newScrollTop, false);
    }
    return new SmoothScrollingUpdate(this.to.scrollLeft, this.to.scrollTop, true);
  }
  combine(from, to, duration) {
    return _SmoothScrollingOperation.start(from, to, duration);
  }
  static start(from, to, duration) {
    duration = duration + 10;
    const startTime = Date.now() - 10;
    return new _SmoothScrollingOperation(from, to, startTime, duration);
  }
};
function easeInCubic(t) {
  return Math.pow(t, 3);
}
function easeOutCubic(t) {
  return 1 - easeInCubic(1 - t);
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/ui/scrollbar/scrollbarVisibilityController.ts
var ScrollbarVisibilityController = class extends Disposable {
  constructor(visibility, visibleClassName, invisibleClassName) {
    super();
    this._visibility = visibility;
    this._visibleClassName = visibleClassName;
    this._invisibleClassName = invisibleClassName;
    this._domNode = null;
    this._isVisible = false;
    this._isNeeded = false;
    this._rawShouldBeVisible = false;
    this._shouldBeVisible = false;
    this._revealTimer = this._register(new TimeoutTimer());
  }
  setVisibility(visibility) {
    if (this._visibility !== visibility) {
      this._visibility = visibility;
      this._updateShouldBeVisible();
    }
  }
  // ----------------- Hide / Reveal
  setShouldBeVisible(rawShouldBeVisible) {
    this._rawShouldBeVisible = rawShouldBeVisible;
    this._updateShouldBeVisible();
  }
  _applyVisibilitySetting() {
    if (this._visibility === 2 /* Hidden */) {
      return false;
    }
    if (this._visibility === 3 /* Visible */) {
      return true;
    }
    return this._rawShouldBeVisible;
  }
  _updateShouldBeVisible() {
    const shouldBeVisible = this._applyVisibilitySetting();
    if (this._shouldBeVisible !== shouldBeVisible) {
      this._shouldBeVisible = shouldBeVisible;
      this.ensureVisibility();
    }
  }
  setIsNeeded(isNeeded) {
    if (this._isNeeded !== isNeeded) {
      this._isNeeded = isNeeded;
      this.ensureVisibility();
    }
  }
  setDomNode(domNode) {
    this._domNode = domNode;
    this._domNode.setClassName(this._invisibleClassName);
    this.setShouldBeVisible(false);
  }
  ensureVisibility() {
    if (!this._isNeeded) {
      this._hide(false);
      return;
    }
    if (this._shouldBeVisible) {
      this._reveal();
    } else {
      this._hide(true);
    }
  }
  _reveal() {
    if (this._isVisible) {
      return;
    }
    this._isVisible = true;
    this._revealTimer.setIfNotSet(() => {
      this._domNode?.setClassName(this._visibleClassName);
    }, 0);
  }
  _hide(withFadeAway) {
    this._revealTimer.cancel();
    if (!this._isVisible) {
      return;
    }
    this._isVisible = false;
    this._domNode?.setClassName(this._invisibleClassName + (withFadeAway ? " fade" : ""));
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/ui/scrollbar/abstractScrollbar.ts
var POINTER_DRAG_RESET_DISTANCE = 140;
var AbstractScrollbar = class extends Widget {
  constructor(opts) {
    super();
    this._lazyRender = opts.lazyRender;
    this._host = opts.host;
    this._scrollable = opts.scrollable;
    this._scrollByPage = opts.scrollByPage;
    this._scrollbarState = opts.scrollbarState;
    this._visibilityController = this._register(new ScrollbarVisibilityController(opts.visibility, "visible scrollbar " + opts.extraScrollbarClassName, "invisible scrollbar " + opts.extraScrollbarClassName));
    this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded());
    this._pointerMoveMonitor = this._register(new GlobalPointerMoveMonitor());
    this._shouldRender = true;
    this.domNode = createFastDomNode(document.createElement("div"));
    this.domNode.setAttribute("role", "presentation");
    this.domNode.setAttribute("aria-hidden", "true");
    this._visibilityController.setDomNode(this.domNode);
    this.domNode.setPosition("absolute");
    this._register(addDisposableListener(this.domNode.domNode, EventType.POINTER_DOWN, (e) => this._domNodePointerDown(e)));
  }
  // ----------------- creation
  /**
   * Creates the dom node for an arrow & adds it to the container
   */
  _createArrow(opts) {
    const arrow = this._register(new ScrollbarArrow(opts));
    this.domNode.domNode.appendChild(arrow.bgDomNode);
    this.domNode.domNode.appendChild(arrow.domNode);
  }
  /**
   * Creates the slider dom node, adds it to the container & hooks up the events
   */
  _createSlider(top, left, width, height) {
    this.slider = createFastDomNode(document.createElement("div"));
    this.slider.setClassName("slider");
    this.slider.setPosition("absolute");
    this.slider.setTop(top);
    this.slider.setLeft(left);
    if (typeof width === "number") {
      this.slider.setWidth(width);
    }
    if (typeof height === "number") {
      this.slider.setHeight(height);
    }
    this.slider.setLayerHinting(true);
    this.slider.setContain("strict");
    this.domNode.domNode.appendChild(this.slider.domNode);
    this._register(addDisposableListener(
      this.slider.domNode,
      EventType.POINTER_DOWN,
      (e) => {
        if (e.button === 0) {
          e.preventDefault();
          this._sliderPointerDown(e);
        }
      }
    ));
    this.onclick(this.slider.domNode, (e) => {
      if (e.leftButton) {
        e.stopPropagation();
      }
    });
  }
  // ----------------- Update state
  _onElementSize(visibleSize) {
    if (this._scrollbarState.setVisibleSize(visibleSize)) {
      this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded());
      this._shouldRender = true;
      if (!this._lazyRender) {
        this.render();
      }
    }
    return this._shouldRender;
  }
  _onElementScrollSize(elementScrollSize) {
    if (this._scrollbarState.setScrollSize(elementScrollSize)) {
      this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded());
      this._shouldRender = true;
      if (!this._lazyRender) {
        this.render();
      }
    }
    return this._shouldRender;
  }
  _onElementScrollPosition(elementScrollPosition) {
    if (this._scrollbarState.setScrollPosition(elementScrollPosition)) {
      this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded());
      this._shouldRender = true;
      if (!this._lazyRender) {
        this.render();
      }
    }
    return this._shouldRender;
  }
  // ----------------- rendering
  beginReveal() {
    this._visibilityController.setShouldBeVisible(true);
  }
  beginHide() {
    this._visibilityController.setShouldBeVisible(false);
  }
  render() {
    if (!this._shouldRender) {
      return;
    }
    this._shouldRender = false;
    this._renderDomNode(this._scrollbarState.getRectangleLargeSize(), this._scrollbarState.getRectangleSmallSize());
    this._updateSlider(this._scrollbarState.getSliderSize(), this._scrollbarState.getArrowSize() + this._scrollbarState.getSliderPosition());
  }
  // ----------------- DOM events
  _domNodePointerDown(e) {
    if (e.target !== this.domNode.domNode) {
      return;
    }
    this._onPointerDown(e);
  }
  delegatePointerDown(e) {
    const domTop = this.domNode.domNode.getClientRects()[0].top;
    const sliderStart = domTop + this._scrollbarState.getSliderPosition();
    const sliderStop = domTop + this._scrollbarState.getSliderPosition() + this._scrollbarState.getSliderSize();
    const pointerPos = this._sliderPointerPosition(e);
    if (sliderStart <= pointerPos && pointerPos <= sliderStop) {
      if (e.button === 0) {
        e.preventDefault();
        this._sliderPointerDown(e);
      }
    } else {
      this._onPointerDown(e);
    }
  }
  _onPointerDown(e) {
    let offsetX;
    let offsetY;
    if (e.target === this.domNode.domNode && typeof e.offsetX === "number" && typeof e.offsetY === "number") {
      offsetX = e.offsetX;
      offsetY = e.offsetY;
    } else {
      const domNodePosition = getDomNodePagePosition(this.domNode.domNode);
      offsetX = e.pageX - domNodePosition.left;
      offsetY = e.pageY - domNodePosition.top;
    }
    const isMouse = e.pointerType === "mouse";
    const isLeftClick = e.button === 0;
    if (isLeftClick || !isMouse) {
      const offset = this._pointerDownRelativePosition(offsetX, offsetY);
      this._setDesiredScrollPositionNow(
        this._scrollByPage ? this._scrollbarState.getDesiredScrollPositionFromOffsetPaged(offset) : this._scrollbarState.getDesiredScrollPositionFromOffset(offset)
      );
    }
    if (isLeftClick) {
      e.preventDefault();
      this._sliderPointerDown(e);
    }
  }
  _sliderPointerDown(e) {
    if (!e.target || !(e.target instanceof Element)) {
      return;
    }
    const initialPointerPosition = this._sliderPointerPosition(e);
    const initialPointerOrthogonalPosition = this._sliderOrthogonalPointerPosition(e);
    const initialScrollbarState = this._scrollbarState.clone();
    this.slider.toggleClassName("active", true);
    this._pointerMoveMonitor.startMonitoring(
      e.target,
      e.pointerId,
      e.buttons,
      (pointerMoveData) => {
        const pointerOrthogonalPosition = this._sliderOrthogonalPointerPosition(pointerMoveData);
        const pointerOrthogonalDelta = Math.abs(pointerOrthogonalPosition - initialPointerOrthogonalPosition);
        if (isWindows && pointerOrthogonalDelta > POINTER_DRAG_RESET_DISTANCE) {
          this._setDesiredScrollPositionNow(initialScrollbarState.getScrollPosition());
          return;
        }
        const pointerPosition = this._sliderPointerPosition(pointerMoveData);
        const pointerDelta = pointerPosition - initialPointerPosition;
        this._setDesiredScrollPositionNow(initialScrollbarState.getDesiredScrollPositionFromDelta(pointerDelta));
      },
      () => {
        this.slider.toggleClassName("active", false);
        this._host.onDragEnd();
      }
    );
    this._host.onDragStart();
  }
  _setDesiredScrollPositionNow(_desiredScrollPosition) {
    const desiredScrollPosition = {};
    this.writeScrollPosition(desiredScrollPosition, _desiredScrollPosition);
    this._scrollable.setScrollPositionNow(desiredScrollPosition);
  }
  updateScrollbarSize(scrollbarSize) {
    this._updateScrollbarSize(scrollbarSize);
    this._scrollbarState.setScrollbarSize(scrollbarSize);
    this._shouldRender = true;
    if (!this._lazyRender) {
      this.render();
    }
  }
  isNeeded() {
    return this._scrollbarState.isNeeded();
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/ui/scrollbar/scrollbarState.ts
var MINIMUM_SLIDER_SIZE = 20;
var ScrollbarState = class _ScrollbarState {
  constructor(arrowSize, scrollbarSize, oppositeScrollbarSize, visibleSize, scrollSize, scrollPosition) {
    this._scrollbarSize = Math.round(scrollbarSize);
    this._oppositeScrollbarSize = Math.round(oppositeScrollbarSize);
    this._arrowSize = Math.round(arrowSize);
    this._visibleSize = visibleSize;
    this._scrollSize = scrollSize;
    this._scrollPosition = scrollPosition;
    this._computedAvailableSize = 0;
    this._computedIsNeeded = false;
    this._computedSliderSize = 0;
    this._computedSliderRatio = 0;
    this._computedSliderPosition = 0;
    this._refreshComputedValues();
  }
  clone() {
    return new _ScrollbarState(this._arrowSize, this._scrollbarSize, this._oppositeScrollbarSize, this._visibleSize, this._scrollSize, this._scrollPosition);
  }
  setVisibleSize(visibleSize) {
    const iVisibleSize = Math.round(visibleSize);
    if (this._visibleSize !== iVisibleSize) {
      this._visibleSize = iVisibleSize;
      this._refreshComputedValues();
      return true;
    }
    return false;
  }
  setScrollSize(scrollSize) {
    const iScrollSize = Math.round(scrollSize);
    if (this._scrollSize !== iScrollSize) {
      this._scrollSize = iScrollSize;
      this._refreshComputedValues();
      return true;
    }
    return false;
  }
  setScrollPosition(scrollPosition) {
    const iScrollPosition = Math.round(scrollPosition);
    if (this._scrollPosition !== iScrollPosition) {
      this._scrollPosition = iScrollPosition;
      this._refreshComputedValues();
      return true;
    }
    return false;
  }
  setScrollbarSize(scrollbarSize) {
    this._scrollbarSize = Math.round(scrollbarSize);
  }
  setOppositeScrollbarSize(oppositeScrollbarSize) {
    this._oppositeScrollbarSize = Math.round(oppositeScrollbarSize);
  }
  static _computeValues(oppositeScrollbarSize, arrowSize, visibleSize, scrollSize, scrollPosition) {
    const computedAvailableSize = Math.max(0, visibleSize - oppositeScrollbarSize);
    const computedRepresentableSize = Math.max(0, computedAvailableSize - 2 * arrowSize);
    const computedIsNeeded = scrollSize > 0 && scrollSize > visibleSize;
    if (!computedIsNeeded) {
      return {
        computedAvailableSize: Math.round(computedAvailableSize),
        computedIsNeeded,
        computedSliderSize: Math.round(computedRepresentableSize),
        computedSliderRatio: 0,
        computedSliderPosition: 0
      };
    }
    const computedSliderSize = Math.round(Math.max(MINIMUM_SLIDER_SIZE, Math.floor(visibleSize * computedRepresentableSize / scrollSize)));
    const computedSliderRatio = (computedRepresentableSize - computedSliderSize) / (scrollSize - visibleSize);
    const computedSliderPosition = scrollPosition * computedSliderRatio;
    return {
      computedAvailableSize: Math.round(computedAvailableSize),
      computedIsNeeded,
      computedSliderSize: Math.round(computedSliderSize),
      computedSliderRatio,
      computedSliderPosition: Math.round(computedSliderPosition)
    };
  }
  _refreshComputedValues() {
    const r = _ScrollbarState._computeValues(this._oppositeScrollbarSize, this._arrowSize, this._visibleSize, this._scrollSize, this._scrollPosition);
    this._computedAvailableSize = r.computedAvailableSize;
    this._computedIsNeeded = r.computedIsNeeded;
    this._computedSliderSize = r.computedSliderSize;
    this._computedSliderRatio = r.computedSliderRatio;
    this._computedSliderPosition = r.computedSliderPosition;
  }
  getArrowSize() {
    return this._arrowSize;
  }
  getScrollPosition() {
    return this._scrollPosition;
  }
  getRectangleLargeSize() {
    return this._computedAvailableSize;
  }
  getRectangleSmallSize() {
    return this._scrollbarSize;
  }
  isNeeded() {
    return this._computedIsNeeded;
  }
  getSliderSize() {
    return this._computedSliderSize;
  }
  getSliderPosition() {
    return this._computedSliderPosition;
  }
  /**
   * Compute a desired `scrollPosition` such that `offset` ends up in the center of the slider.
   * `offset` is based on the same coordinate system as the `sliderPosition`.
   */
  getDesiredScrollPositionFromOffset(offset) {
    if (!this._computedIsNeeded) {
      return 0;
    }
    const desiredSliderPosition = offset - this._arrowSize - this._computedSliderSize / 2;
    return Math.round(desiredSliderPosition / this._computedSliderRatio);
  }
  /**
   * Compute a desired `scrollPosition` from if offset is before or after the slider position.
   * If offset is before slider, treat as a page up (or left).  If after, page down (or right).
   * `offset` and `_computedSliderPosition` are based on the same coordinate system.
   * `_visibleSize` corresponds to a "page" of lines in the returned coordinate system.
   */
  getDesiredScrollPositionFromOffsetPaged(offset) {
    if (!this._computedIsNeeded) {
      return 0;
    }
    const correctedOffset = offset - this._arrowSize;
    let desiredScrollPosition = this._scrollPosition;
    if (correctedOffset < this._computedSliderPosition) {
      desiredScrollPosition -= this._visibleSize;
    } else {
      desiredScrollPosition += this._visibleSize;
    }
    return desiredScrollPosition;
  }
  /**
   * Compute a desired `scrollPosition` such that the slider moves by `delta`.
   */
  getDesiredScrollPositionFromDelta(delta) {
    if (!this._computedIsNeeded) {
      return 0;
    }
    const desiredSliderPosition = this._computedSliderPosition + delta;
    return Math.round(desiredSliderPosition / this._computedSliderRatio);
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/ui/scrollbar/horizontalScrollbar.ts
var HorizontalScrollbar = class extends AbstractScrollbar {
  constructor(scrollable, options, host) {
    const scrollDimensions = scrollable.getScrollDimensions();
    const scrollPosition = scrollable.getCurrentScrollPosition();
    super({
      lazyRender: options.lazyRender,
      host,
      scrollbarState: new ScrollbarState(
        options.horizontalHasArrows ? options.arrowSize : 0,
        options.horizontal === 2 /* Hidden */ ? 0 : options.horizontalScrollbarSize,
        options.vertical === 2 /* Hidden */ ? 0 : options.verticalScrollbarSize,
        scrollDimensions.width,
        scrollDimensions.scrollWidth,
        scrollPosition.scrollLeft
      ),
      visibility: options.horizontal,
      extraScrollbarClassName: "horizontal",
      scrollable,
      scrollByPage: options.scrollByPage
    });
    if (options.horizontalHasArrows) {
      const arrowDelta = (options.arrowSize - ARROW_IMG_SIZE) / 2;
      const scrollbarDelta = (options.horizontalScrollbarSize - ARROW_IMG_SIZE) / 2;
      this._createArrow({
        className: "scra",
        icon: Codicon.scrollbarButtonLeft,
        top: scrollbarDelta,
        left: arrowDelta,
        bottom: void 0,
        right: void 0,
        bgWidth: options.arrowSize,
        bgHeight: options.horizontalScrollbarSize,
        onActivate: () => this._host.onMouseWheel(new StandardWheelEvent(null, 1, 0))
      });
      this._createArrow({
        className: "scra",
        icon: Codicon.scrollbarButtonRight,
        top: scrollbarDelta,
        left: void 0,
        bottom: void 0,
        right: arrowDelta,
        bgWidth: options.arrowSize,
        bgHeight: options.horizontalScrollbarSize,
        onActivate: () => this._host.onMouseWheel(new StandardWheelEvent(null, -1, 0))
      });
    }
    this._createSlider(Math.floor((options.horizontalScrollbarSize - options.horizontalSliderSize) / 2), 0, void 0, options.horizontalSliderSize);
  }
  _updateSlider(sliderSize, sliderPosition) {
    this.slider.setWidth(sliderSize);
    this.slider.setLeft(sliderPosition);
  }
  _renderDomNode(largeSize, smallSize) {
    this.domNode.setWidth(largeSize);
    this.domNode.setHeight(smallSize);
    this.domNode.setLeft(0);
    this.domNode.setBottom(0);
  }
  onDidScroll(e) {
    this._shouldRender = this._onElementScrollSize(e.scrollWidth) || this._shouldRender;
    this._shouldRender = this._onElementScrollPosition(e.scrollLeft) || this._shouldRender;
    this._shouldRender = this._onElementSize(e.width) || this._shouldRender;
    return this._shouldRender;
  }
  _pointerDownRelativePosition(offsetX, offsetY) {
    return offsetX;
  }
  _sliderPointerPosition(e) {
    return e.pageX;
  }
  _sliderOrthogonalPointerPosition(e) {
    return e.pageY;
  }
  _updateScrollbarSize(size) {
    this.slider.setHeight(size);
  }
  writeScrollPosition(target, scrollPosition) {
    target.scrollLeft = scrollPosition;
  }
  updateOptions(options) {
    this.updateScrollbarSize(options.horizontal === 2 /* Hidden */ ? 0 : options.horizontalScrollbarSize);
    this._scrollbarState.setOppositeScrollbarSize(options.vertical === 2 /* Hidden */ ? 0 : options.verticalScrollbarSize);
    this._visibilityController.setVisibility(options.horizontal);
    this._scrollByPage = options.scrollByPage;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/ui/scrollbar/verticalScrollbar.ts
var VerticalScrollbar = class extends AbstractScrollbar {
  constructor(scrollable, options, host) {
    const scrollDimensions = scrollable.getScrollDimensions();
    const scrollPosition = scrollable.getCurrentScrollPosition();
    super({
      lazyRender: options.lazyRender,
      host,
      scrollbarState: new ScrollbarState(
        options.verticalHasArrows ? options.arrowSize : 0,
        options.vertical === 2 /* Hidden */ ? 0 : options.verticalScrollbarSize,
        // give priority to vertical scroll bar over horizontal and let it scroll all the way to the bottom
        0,
        scrollDimensions.height,
        scrollDimensions.scrollHeight,
        scrollPosition.scrollTop
      ),
      visibility: options.vertical,
      extraScrollbarClassName: "vertical",
      scrollable,
      scrollByPage: options.scrollByPage
    });
    if (options.verticalHasArrows) {
      const arrowDelta = (options.arrowSize - ARROW_IMG_SIZE) / 2;
      const scrollbarDelta = (options.verticalScrollbarSize - ARROW_IMG_SIZE) / 2;
      this._createArrow({
        className: "scra",
        icon: Codicon.scrollbarButtonUp,
        top: arrowDelta,
        left: scrollbarDelta,
        bottom: void 0,
        right: void 0,
        bgWidth: options.verticalScrollbarSize,
        bgHeight: options.arrowSize,
        onActivate: () => this._host.onMouseWheel(new StandardWheelEvent(null, 0, 1))
      });
      this._createArrow({
        className: "scra",
        icon: Codicon.scrollbarButtonDown,
        top: void 0,
        left: scrollbarDelta,
        bottom: arrowDelta,
        right: void 0,
        bgWidth: options.verticalScrollbarSize,
        bgHeight: options.arrowSize,
        onActivate: () => this._host.onMouseWheel(new StandardWheelEvent(null, 0, -1))
      });
    }
    this._createSlider(0, Math.floor((options.verticalScrollbarSize - options.verticalSliderSize) / 2), options.verticalSliderSize, void 0);
  }
  _updateSlider(sliderSize, sliderPosition) {
    this.slider.setHeight(sliderSize);
    this.slider.setTop(sliderPosition);
  }
  _renderDomNode(largeSize, smallSize) {
    this.domNode.setWidth(smallSize);
    this.domNode.setHeight(largeSize);
    this.domNode.setRight(0);
    this.domNode.setTop(0);
  }
  onDidScroll(e) {
    this._shouldRender = this._onElementScrollSize(e.scrollHeight) || this._shouldRender;
    this._shouldRender = this._onElementScrollPosition(e.scrollTop) || this._shouldRender;
    this._shouldRender = this._onElementSize(e.height) || this._shouldRender;
    return this._shouldRender;
  }
  _pointerDownRelativePosition(offsetX, offsetY) {
    return offsetY;
  }
  _sliderPointerPosition(e) {
    return e.pageY;
  }
  _sliderOrthogonalPointerPosition(e) {
    return e.pageX;
  }
  _updateScrollbarSize(size) {
    this.slider.setWidth(size);
  }
  writeScrollPosition(target, scrollPosition) {
    target.scrollTop = scrollPosition;
  }
  updateOptions(options) {
    this.updateScrollbarSize(options.vertical === 2 /* Hidden */ ? 0 : options.verticalScrollbarSize);
    this._scrollbarState.setOppositeScrollbarSize(0);
    this._visibilityController.setVisibility(options.vertical);
    this._scrollByPage = options.scrollByPage;
  }
};

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/ui/scrollbar/scrollableElement.ts
var HIDE_TIMEOUT = 500;
var SCROLL_WHEEL_SENSITIVITY = 50;
var SCROLL_WHEEL_SMOOTH_SCROLL_ENABLED = true;
var MouseWheelClassifierItem = class {
  constructor(timestamp, deltaX, deltaY) {
    this.timestamp = timestamp;
    this.deltaX = deltaX;
    this.deltaY = deltaY;
    this.score = 0;
  }
};
var MouseWheelClassifier = class _MouseWheelClassifier {
  static {
    this.INSTANCE = new _MouseWheelClassifier();
  }
  constructor() {
    this._capacity = 5;
    this._memory = [];
    this._front = -1;
    this._rear = -1;
  }
  isPhysicalMouseWheel() {
    if (this._front === -1 && this._rear === -1) {
      return false;
    }
    let remainingInfluence = 1;
    let score = 0;
    let iteration = 1;
    let index = this._rear;
    do {
      const influence = index === this._front ? remainingInfluence : Math.pow(2, -iteration);
      remainingInfluence -= influence;
      score += this._memory[index].score * influence;
      if (index === this._front) {
        break;
      }
      index = (this._capacity + index - 1) % this._capacity;
      iteration++;
    } while (true);
    return score <= 0.5;
  }
  acceptStandardWheelEvent(e) {
    if (isChrome) {
      const targetWindow = getWindow(e.browserEvent);
      const pageZoomFactor = getZoomFactor(targetWindow);
      this.accept(Date.now(), e.deltaX * pageZoomFactor, e.deltaY * pageZoomFactor);
    } else {
      this.accept(Date.now(), e.deltaX, e.deltaY);
    }
  }
  accept(timestamp, deltaX, deltaY) {
    let previousItem = null;
    const item = new MouseWheelClassifierItem(timestamp, deltaX, deltaY);
    if (this._front === -1 && this._rear === -1) {
      this._memory[0] = item;
      this._front = 0;
      this._rear = 0;
    } else {
      previousItem = this._memory[this._rear];
      this._rear = (this._rear + 1) % this._capacity;
      if (this._rear === this._front) {
        this._front = (this._front + 1) % this._capacity;
      }
      this._memory[this._rear] = item;
    }
    item.score = this._computeScore(item, previousItem);
  }
  /**
   * A score between 0 and 1 for `item`.
   *  - a score towards 0 indicates that the source appears to be a physical mouse wheel
   *  - a score towards 1 indicates that the source appears to be a touchpad or magic mouse, etc.
   */
  _computeScore(item, previousItem) {
    if (Math.abs(item.deltaX) > 0 && Math.abs(item.deltaY) > 0) {
      return 1;
    }
    let score = 0.5;
    if (!this._isAlmostInt(item.deltaX) || !this._isAlmostInt(item.deltaY)) {
      score += 0.25;
    }
    if (previousItem) {
      const absDeltaX = Math.abs(item.deltaX);
      const absDeltaY = Math.abs(item.deltaY);
      const absPreviousDeltaX = Math.abs(previousItem.deltaX);
      const absPreviousDeltaY = Math.abs(previousItem.deltaY);
      const minDeltaX = Math.max(Math.min(absDeltaX, absPreviousDeltaX), 1);
      const minDeltaY = Math.max(Math.min(absDeltaY, absPreviousDeltaY), 1);
      const maxDeltaX = Math.max(absDeltaX, absPreviousDeltaX);
      const maxDeltaY = Math.max(absDeltaY, absPreviousDeltaY);
      const isSameModulo = maxDeltaX % minDeltaX === 0 && maxDeltaY % minDeltaY === 0;
      if (isSameModulo) {
        score -= 0.5;
      }
    }
    return Math.min(Math.max(score, 0), 1);
  }
  _isAlmostInt(value) {
    const epsilon = Number.EPSILON * 100;
    const delta = Math.abs(Math.round(value) - value);
    return delta < 0.01 + epsilon;
  }
};
var AbstractScrollableElement = class extends Widget {
  constructor(element, options, scrollable) {
    super();
    this._inertialTimeout = null;
    this._inertialSpeed = { X: 0, Y: 0 };
    this._onScroll = this._register(new Emitter());
    this._onWillScroll = this._register(new Emitter());
    element.style.overflow = "hidden";
    this._options = resolveOptions(options);
    this._scrollable = scrollable;
    this._register(this._scrollable.onScroll((e) => {
      this._onWillScroll.fire(e);
      this._onDidScroll(e);
      this._onScroll.fire(e);
    }));
    const scrollbarHost = {
      onMouseWheel: (mouseWheelEvent) => this._onMouseWheel(mouseWheelEvent),
      onDragStart: () => this._onDragStart(),
      onDragEnd: () => this._onDragEnd()
    };
    this._verticalScrollbar = this._register(new VerticalScrollbar(this._scrollable, this._options, scrollbarHost));
    this._horizontalScrollbar = this._register(new HorizontalScrollbar(this._scrollable, this._options, scrollbarHost));
    this._domNode = document.createElement("div");
    this._domNode.className = "monaco-scrollable-element " + this._options.className;
    this._domNode.setAttribute("role", "presentation");
    this._domNode.style.position = "relative";
    this._domNode.style.overflow = "hidden";
    this._domNode.appendChild(element);
    this._domNode.appendChild(this._horizontalScrollbar.domNode.domNode);
    this._domNode.appendChild(this._verticalScrollbar.domNode.domNode);
    if (this._options.useShadows) {
      this._leftShadowDomNode = createFastDomNode(document.createElement("div"));
      this._leftShadowDomNode.setClassName("shadow");
      this._domNode.appendChild(this._leftShadowDomNode.domNode);
      this._topShadowDomNode = createFastDomNode(document.createElement("div"));
      this._topShadowDomNode.setClassName("shadow");
      this._domNode.appendChild(this._topShadowDomNode.domNode);
      this._topLeftShadowDomNode = createFastDomNode(document.createElement("div"));
      this._topLeftShadowDomNode.setClassName("shadow");
      this._domNode.appendChild(this._topLeftShadowDomNode.domNode);
    } else {
      this._leftShadowDomNode = null;
      this._topShadowDomNode = null;
      this._topLeftShadowDomNode = null;
    }
    this._listenOnDomNode = this._options.listenOnDomNode || this._domNode;
    this._mouseWheelToDispose = [];
    this._setListeningToMouseWheel(this._options.handleMouseWheel);
    this.onmouseover(this._listenOnDomNode, (e) => this._onMouseOver(e));
    this.onmouseleave(this._listenOnDomNode, (e) => this._onMouseLeave(e));
    this._hideTimeout = this._register(new TimeoutTimer());
    this._isDragging = false;
    this._mouseIsOver = false;
    this._shouldRender = true;
    this._revealOnScroll = true;
  }
  get onScroll() {
    return this._onScroll.event;
  }
  get onWillScroll() {
    return this._onWillScroll.event;
  }
  get options() {
    return this._options;
  }
  dispose() {
    this._mouseWheelToDispose = dispose(this._mouseWheelToDispose);
    if (this._inertialTimeout) {
      this._inertialTimeout.dispose();
      this._inertialTimeout = null;
    }
    super.dispose();
  }
  /**
   * Get the generated 'scrollable' dom node
   */
  getDomNode() {
    return this._domNode;
  }
  getOverviewRulerLayoutInfo() {
    return {
      parent: this._domNode,
      insertBefore: this._verticalScrollbar.domNode.domNode
    };
  }
  /**
   * Delegate a pointer down event to the vertical scrollbar.
   * This is to help with clicking somewhere else and having the scrollbar react.
   */
  delegateVerticalScrollbarPointerDown(browserEvent) {
    this._verticalScrollbar.delegatePointerDown(browserEvent);
  }
  getScrollDimensions() {
    return this._scrollable.getScrollDimensions();
  }
  setScrollDimensions(dimensions) {
    this._scrollable.setScrollDimensions(dimensions, false);
  }
  /**
   * Update the class name of the scrollable element.
   */
  updateClassName(newClassName) {
    this._options.className = newClassName;
    if (isMacintosh) {
      this._options.className += " mac";
    }
    this._domNode.className = "monaco-scrollable-element " + this._options.className;
  }
  /**
   * Update configuration options for the scrollbar.
   */
  updateOptions(newOptions) {
    if (typeof newOptions.handleMouseWheel !== "undefined") {
      this._options.handleMouseWheel = newOptions.handleMouseWheel;
      this._setListeningToMouseWheel(this._options.handleMouseWheel);
    }
    if (typeof newOptions.mouseWheelScrollSensitivity !== "undefined") {
      this._options.mouseWheelScrollSensitivity = newOptions.mouseWheelScrollSensitivity;
    }
    if (typeof newOptions.fastScrollSensitivity !== "undefined") {
      this._options.fastScrollSensitivity = newOptions.fastScrollSensitivity;
    }
    if (typeof newOptions.scrollPredominantAxis !== "undefined") {
      this._options.scrollPredominantAxis = newOptions.scrollPredominantAxis;
    }
    if (typeof newOptions.horizontal !== "undefined") {
      this._options.horizontal = newOptions.horizontal;
    }
    if (typeof newOptions.vertical !== "undefined") {
      this._options.vertical = newOptions.vertical;
    }
    if (typeof newOptions.horizontalScrollbarSize !== "undefined") {
      this._options.horizontalScrollbarSize = newOptions.horizontalScrollbarSize;
    }
    if (typeof newOptions.verticalScrollbarSize !== "undefined") {
      this._options.verticalScrollbarSize = newOptions.verticalScrollbarSize;
    }
    if (typeof newOptions.scrollByPage !== "undefined") {
      this._options.scrollByPage = newOptions.scrollByPage;
    }
    this._horizontalScrollbar.updateOptions(this._options);
    this._verticalScrollbar.updateOptions(this._options);
    if (!this._options.lazyRender) {
      this._render();
    }
  }
  setRevealOnScroll(value) {
    this._revealOnScroll = value;
  }
  delegateScrollFromMouseWheelEvent(browserEvent) {
    this._onMouseWheel(new StandardWheelEvent(browserEvent));
  }
  async _periodicSync() {
    let scheduleAgain = false;
    if (this._inertialSpeed.X !== 0 || this._inertialSpeed.Y !== 0) {
      this._scrollable.setScrollPositionNow({
        scrollTop: this._scrollable.getCurrentScrollPosition().scrollTop - this._inertialSpeed.Y * 100,
        scrollLeft: this._scrollable.getCurrentScrollPosition().scrollLeft - this._inertialSpeed.X * 100
      });
      this._inertialSpeed.X *= 0.9;
      this._inertialSpeed.Y *= 0.9;
      if (Math.abs(this._inertialSpeed.X) < 0.01) {
        this._inertialSpeed.X = 0;
      }
      if (Math.abs(this._inertialSpeed.Y) < 0.01) {
        this._inertialSpeed.Y = 0;
      }
      scheduleAgain = this._inertialSpeed.X !== 0 || this._inertialSpeed.Y !== 0;
    }
    if (scheduleAgain) {
      if (!this._inertialTimeout) {
        this._inertialTimeout = new TimeoutTimer();
      }
      this._inertialTimeout.cancelAndSet(() => this._periodicSync(), 1e3 / 60);
    } else {
      this._inertialTimeout?.dispose();
      this._inertialTimeout = null;
    }
  }
  // -------------------- mouse wheel scrolling --------------------
  _setListeningToMouseWheel(shouldListen) {
    const isListening = this._mouseWheelToDispose.length > 0;
    if (isListening === shouldListen) {
      return;
    }
    this._mouseWheelToDispose = dispose(this._mouseWheelToDispose);
    if (shouldListen) {
      const onMouseWheel = (browserEvent) => {
        this._onMouseWheel(new StandardWheelEvent(browserEvent));
      };
      this._mouseWheelToDispose.push(addDisposableListener(this._listenOnDomNode, EventType.MOUSE_WHEEL, onMouseWheel, { passive: false }));
    }
  }
  _onMouseWheel(e) {
    if (e.browserEvent?.defaultPrevented) {
      return;
    }
    const classifier = MouseWheelClassifier.INSTANCE;
    if (SCROLL_WHEEL_SMOOTH_SCROLL_ENABLED) {
      classifier.acceptStandardWheelEvent(e);
    }
    let didScroll = false;
    if (e.deltaY || e.deltaX) {
      let deltaY = e.deltaY * this._options.mouseWheelScrollSensitivity;
      let deltaX = e.deltaX * this._options.mouseWheelScrollSensitivity;
      if (this._options.scrollPredominantAxis) {
        if (this._options.scrollYToX && deltaX + deltaY === 0) {
          deltaX = deltaY = 0;
        } else if (Math.abs(deltaY) >= Math.abs(deltaX)) {
          deltaX = 0;
        } else {
          deltaY = 0;
        }
      }
      if (this._options.flipAxes) {
        [deltaY, deltaX] = [deltaX, deltaY];
      }
      const shiftConvert = !isMacintosh && e.browserEvent && e.browserEvent.shiftKey;
      if ((this._options.scrollYToX || shiftConvert) && !deltaX) {
        deltaX = deltaY;
        deltaY = 0;
      }
      if (e.browserEvent && e.browserEvent.altKey) {
        deltaX = deltaX * this._options.fastScrollSensitivity;
        deltaY = deltaY * this._options.fastScrollSensitivity;
      }
      const futureScrollPosition = this._scrollable.getFutureScrollPosition();
      let desiredScrollPosition = {};
      if (deltaY) {
        const deltaScrollTop = SCROLL_WHEEL_SENSITIVITY * deltaY;
        const desiredScrollTop = futureScrollPosition.scrollTop - (deltaScrollTop < 0 ? Math.floor(deltaScrollTop) : Math.ceil(deltaScrollTop));
        this._verticalScrollbar.writeScrollPosition(desiredScrollPosition, desiredScrollTop);
      }
      if (deltaX) {
        const deltaScrollLeft = SCROLL_WHEEL_SENSITIVITY * deltaX;
        const desiredScrollLeft = futureScrollPosition.scrollLeft - (deltaScrollLeft < 0 ? Math.floor(deltaScrollLeft) : Math.ceil(deltaScrollLeft));
        this._horizontalScrollbar.writeScrollPosition(desiredScrollPosition, desiredScrollLeft);
      }
      desiredScrollPosition = this._scrollable.validateScrollPosition(desiredScrollPosition);
      if (this._options.inertialScroll && (deltaX || deltaY) && !classifier.isPhysicalMouseWheel()) {
        let startPeriodic = false;
        if (this._inertialSpeed.X === 0 && this._inertialSpeed.Y === 0) {
          startPeriodic = true;
        }
        this._inertialSpeed.Y = (deltaY < 0 ? -1 : 1) * Math.abs(deltaY) ** 1.02;
        this._inertialSpeed.X = (deltaX < 0 ? -1 : 1) * Math.abs(deltaX) ** 1.02;
        if (startPeriodic) {
          this._periodicSync();
        }
      }
      if (futureScrollPosition.scrollLeft !== desiredScrollPosition.scrollLeft || futureScrollPosition.scrollTop !== desiredScrollPosition.scrollTop) {
        const canPerformSmoothScroll = SCROLL_WHEEL_SMOOTH_SCROLL_ENABLED && this._options.mouseWheelSmoothScroll && classifier.isPhysicalMouseWheel();
        if (canPerformSmoothScroll) {
          this._scrollable.setScrollPositionSmooth(desiredScrollPosition);
        } else {
          this._scrollable.setScrollPositionNow(desiredScrollPosition);
        }
        didScroll = true;
      }
    }
    let consumeMouseWheel = didScroll;
    if (!consumeMouseWheel && this._options.alwaysConsumeMouseWheel) {
      consumeMouseWheel = true;
    }
    if (!consumeMouseWheel && this._options.consumeMouseWheelIfScrollbarIsNeeded && (this._verticalScrollbar.isNeeded() || this._horizontalScrollbar.isNeeded())) {
      consumeMouseWheel = true;
    }
    if (consumeMouseWheel) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  _onDidScroll(e) {
    this._shouldRender = this._horizontalScrollbar.onDidScroll(e) || this._shouldRender;
    this._shouldRender = this._verticalScrollbar.onDidScroll(e) || this._shouldRender;
    if (this._options.useShadows) {
      this._shouldRender = true;
    }
    if (this._revealOnScroll) {
      this._reveal();
    }
    if (!this._options.lazyRender) {
      this._render();
    }
  }
  /**
   * Render / mutate the DOM now.
   * Should be used together with the ctor option `lazyRender`.
   */
  renderNow() {
    if (!this._options.lazyRender) {
      throw new Error("Please use `lazyRender` together with `renderNow`!");
    }
    this._render();
  }
  _render() {
    if (!this._shouldRender) {
      return;
    }
    this._shouldRender = false;
    this._horizontalScrollbar.render();
    this._verticalScrollbar.render();
    if (this._options.useShadows) {
      const scrollState = this._scrollable.getCurrentScrollPosition();
      const enableTop = scrollState.scrollTop > 0;
      const enableLeft = scrollState.scrollLeft > 0;
      const leftClassName = enableLeft ? " left" : "";
      const topClassName = enableTop ? " top" : "";
      const topLeftClassName = enableLeft || enableTop ? " top-left-corner" : "";
      this._leftShadowDomNode.setClassName(`shadow${leftClassName}`);
      this._topShadowDomNode.setClassName(`shadow${topClassName}`);
      this._topLeftShadowDomNode.setClassName(`shadow${topLeftClassName}${topClassName}${leftClassName}`);
    }
  }
  // -------------------- fade in / fade out --------------------
  _onDragStart() {
    this._isDragging = true;
    this._reveal();
  }
  _onDragEnd() {
    this._isDragging = false;
    this._hide();
  }
  _onMouseLeave(e) {
    this._mouseIsOver = false;
    this._hide();
  }
  _onMouseOver(e) {
    this._mouseIsOver = true;
    this._reveal();
  }
  _reveal() {
    this._verticalScrollbar.beginReveal();
    this._horizontalScrollbar.beginReveal();
    this._scheduleHide();
  }
  _hide() {
    if (!this._mouseIsOver && !this._isDragging) {
      this._verticalScrollbar.beginHide();
      this._horizontalScrollbar.beginHide();
    }
  }
  _scheduleHide() {
    if (!this._mouseIsOver && !this._isDragging) {
      this._hideTimeout.cancelAndSet(() => this._hide(), HIDE_TIMEOUT);
    }
  }
};
var DomScrollableElement = class extends AbstractScrollableElement {
  constructor(element, options) {
    options = options || {};
    options.mouseWheelSmoothScroll = false;
    const scrollable = new Scrollable({
      forceIntegerValues: false,
      // See https://github.com/microsoft/vscode/issues/139877
      smoothScrollDuration: 0,
      scheduleAtNextAnimationFrame: (callback) => scheduleAtNextAnimationFrame(getWindow(element), callback)
    });
    super(element, options, scrollable);
    this._register(scrollable);
    this._element = element;
    this._register(this.onScroll((e) => {
      if (e.scrollTopChanged) {
        this._element.scrollTop = e.scrollTop;
      }
      if (e.scrollLeftChanged) {
        this._element.scrollLeft = e.scrollLeft;
      }
    }));
    this.scanDomNode();
  }
  setScrollPosition(update) {
    this._scrollable.setScrollPositionNow(update);
  }
  getScrollPosition() {
    return this._scrollable.getCurrentScrollPosition();
  }
  scanDomNode() {
    this.setScrollDimensions({
      width: this._element.clientWidth,
      scrollWidth: this._element.scrollWidth,
      height: this._element.clientHeight,
      scrollHeight: this._element.scrollHeight
    });
    this.setScrollPosition({
      scrollLeft: this._element.scrollLeft,
      scrollTop: this._element.scrollTop
    });
  }
};
function resolveOptions(opts) {
  const result = {
    lazyRender: typeof opts.lazyRender !== "undefined" ? opts.lazyRender : false,
    className: typeof opts.className !== "undefined" ? opts.className : "",
    useShadows: typeof opts.useShadows !== "undefined" ? opts.useShadows : true,
    handleMouseWheel: typeof opts.handleMouseWheel !== "undefined" ? opts.handleMouseWheel : true,
    flipAxes: typeof opts.flipAxes !== "undefined" ? opts.flipAxes : false,
    consumeMouseWheelIfScrollbarIsNeeded: typeof opts.consumeMouseWheelIfScrollbarIsNeeded !== "undefined" ? opts.consumeMouseWheelIfScrollbarIsNeeded : false,
    alwaysConsumeMouseWheel: typeof opts.alwaysConsumeMouseWheel !== "undefined" ? opts.alwaysConsumeMouseWheel : false,
    scrollYToX: typeof opts.scrollYToX !== "undefined" ? opts.scrollYToX : false,
    mouseWheelScrollSensitivity: typeof opts.mouseWheelScrollSensitivity !== "undefined" ? opts.mouseWheelScrollSensitivity : 1,
    fastScrollSensitivity: typeof opts.fastScrollSensitivity !== "undefined" ? opts.fastScrollSensitivity : 5,
    scrollPredominantAxis: typeof opts.scrollPredominantAxis !== "undefined" ? opts.scrollPredominantAxis : true,
    mouseWheelSmoothScroll: typeof opts.mouseWheelSmoothScroll !== "undefined" ? opts.mouseWheelSmoothScroll : true,
    inertialScroll: typeof opts.inertialScroll !== "undefined" ? opts.inertialScroll : false,
    arrowSize: typeof opts.arrowSize !== "undefined" ? opts.arrowSize : 11,
    listenOnDomNode: typeof opts.listenOnDomNode !== "undefined" ? opts.listenOnDomNode : null,
    horizontal: typeof opts.horizontal !== "undefined" ? opts.horizontal : 1 /* Auto */,
    horizontalScrollbarSize: typeof opts.horizontalScrollbarSize !== "undefined" ? opts.horizontalScrollbarSize : 10,
    horizontalSliderSize: typeof opts.horizontalSliderSize !== "undefined" ? opts.horizontalSliderSize : 0,
    horizontalHasArrows: typeof opts.horizontalHasArrows !== "undefined" ? opts.horizontalHasArrows : false,
    vertical: typeof opts.vertical !== "undefined" ? opts.vertical : 1 /* Auto */,
    verticalScrollbarSize: typeof opts.verticalScrollbarSize !== "undefined" ? opts.verticalScrollbarSize : 10,
    verticalHasArrows: typeof opts.verticalHasArrows !== "undefined" ? opts.verticalHasArrows : false,
    verticalSliderSize: typeof opts.verticalSliderSize !== "undefined" ? opts.verticalSliderSize : 0,
    scrollByPage: typeof opts.scrollByPage !== "undefined" ? opts.scrollByPage : false
  };
  result.horizontalSliderSize = typeof opts.horizontalSliderSize !== "undefined" ? opts.horizontalSliderSize : result.horizontalScrollbarSize;
  result.verticalSliderSize = typeof opts.verticalSliderSize !== "undefined" ? opts.verticalSliderSize : result.verticalScrollbarSize;
  if (isMacintosh) {
    result.className += " mac";
  }
  return result;
}

// ../../../../../../mrselect6-2/code-server/lib/vscode/src/vs/base/browser/ui/breadcrumbs/breadcrumbsWidget.ts
var BreadcrumbsItem = class {
};
var BreadcrumbsWidget = class {
  constructor(container, horizontalScrollbarSize, horizontalScrollbarVisibility = 1 /* Auto */, separatorIcon, styles) {
    this._disposables = new DisposableStore();
    this._onDidSelectItem = new Emitter();
    this._onDidFocusItem = new Emitter();
    this._onDidChangeFocus = new Emitter();
    this.onDidSelectItem = this._onDidSelectItem.event;
    this.onDidFocusItem = this._onDidFocusItem.event;
    this.onDidChangeFocus = this._onDidChangeFocus.event;
    this._items = new Array();
    this._nodes = new Array();
    this._freeNodes = new Array();
    this._enabled = true;
    this._focusedItemIdx = -1;
    this._selectedItemIdx = -1;
    this._domNode = document.createElement("div");
    this._domNode.className = "monaco-breadcrumbs";
    this._domNode.tabIndex = 0;
    this._domNode.setAttribute("role", "list");
    this._scrollable = new DomScrollableElement(this._domNode, {
      vertical: 2 /* Hidden */,
      horizontal: horizontalScrollbarVisibility,
      horizontalScrollbarSize,
      useShadows: false,
      scrollYToX: true
    });
    this._separatorIcon = separatorIcon;
    this._disposables.add(this._scrollable);
    this._disposables.add(addStandardDisposableListener(this._domNode, "click", (e) => this._onClick(e)));
    container.appendChild(this._scrollable.getDomNode());
    const styleElement = createStyleSheet(this._domNode);
    this._style(styleElement, styles);
    const focusTracker = trackFocus(this._domNode);
    this._disposables.add(focusTracker);
    this._disposables.add(focusTracker.onDidBlur((_) => this._onDidChangeFocus.fire(false)));
    this._disposables.add(focusTracker.onDidFocus((_) => this._onDidChangeFocus.fire(true)));
  }
  setHorizontalScrollbarSize(size) {
    this._scrollable.updateOptions({
      horizontalScrollbarSize: size
    });
  }
  setHorizontalScrollbarVisibility(visibility) {
    this._scrollable.updateOptions({
      horizontal: visibility
    });
  }
  dispose() {
    this._disposables.dispose();
    this._pendingLayout?.dispose();
    this._pendingDimLayout?.dispose();
    this._onDidSelectItem.dispose();
    this._onDidFocusItem.dispose();
    this._onDidChangeFocus.dispose();
    this._domNode.remove();
    this._nodes.length = 0;
    this._freeNodes.length = 0;
  }
  layout(dim) {
    if (dim && Dimension.equals(dim, this._dimension)) {
      return;
    }
    if (dim) {
      this._pendingDimLayout?.dispose();
      this._pendingDimLayout = this._updateDimensions(dim);
    } else {
      this._pendingLayout?.dispose();
      this._pendingLayout = this._updateScrollbar();
    }
  }
  _updateDimensions(dim) {
    const disposables = new DisposableStore();
    disposables.add(modify(getWindow(this._domNode), () => {
      this._dimension = dim;
      this._domNode.style.width = `${dim.width}px`;
      this._domNode.style.height = `${dim.height}px`;
      disposables.add(this._updateScrollbar());
    }));
    return disposables;
  }
  _updateScrollbar() {
    return measure(getWindow(this._domNode), () => {
      measure(getWindow(this._domNode), () => {
        this._scrollable.setRevealOnScroll(false);
        this._scrollable.scanDomNode();
        this._scrollable.setRevealOnScroll(true);
      });
    });
  }
  _style(styleElement, style) {
    let content = "";
    if (style.breadcrumbsBackground) {
      content += `.monaco-breadcrumbs { background-color: ${style.breadcrumbsBackground}}`;
    }
    if (style.breadcrumbsForeground) {
      content += `.monaco-breadcrumbs .monaco-breadcrumb-item { color: ${style.breadcrumbsForeground}}
`;
    }
    if (style.breadcrumbsFocusForeground) {
      content += `.monaco-breadcrumbs .monaco-breadcrumb-item.focused { color: ${style.breadcrumbsFocusForeground}}
`;
    }
    if (style.breadcrumbsFocusAndSelectionForeground) {
      content += `.monaco-breadcrumbs .monaco-breadcrumb-item.focused.selected { color: ${style.breadcrumbsFocusAndSelectionForeground}}
`;
    }
    if (style.breadcrumbsHoverForeground) {
      content += `.monaco-breadcrumbs:not(.disabled	) .monaco-breadcrumb-item:hover:not(.focused):not(.selected) { color: ${style.breadcrumbsHoverForeground}}
`;
    }
    styleElement.textContent = content;
  }
  setEnabled(value) {
    this._enabled = value;
    this._domNode.classList.toggle("disabled", !this._enabled);
  }
  domFocus() {
    const idx = this._focusedItemIdx >= 0 ? this._focusedItemIdx : this._items.length - 1;
    if (idx >= 0 && idx < this._items.length) {
      this._focus(idx, void 0);
    } else {
      this._domNode.focus();
    }
  }
  isDOMFocused() {
    return isAncestorOfActiveElement(this._domNode);
  }
  getFocused() {
    return this._items[this._focusedItemIdx];
  }
  setFocused(item, payload) {
    this._focus(this._items.indexOf(item), payload);
  }
  focusPrev(payload) {
    if (this._focusedItemIdx > 0) {
      this._focus(this._focusedItemIdx - 1, payload);
    }
  }
  focusNext(payload) {
    if (this._focusedItemIdx + 1 < this._nodes.length) {
      this._focus(this._focusedItemIdx + 1, payload);
    }
  }
  _focus(nth, payload) {
    this._focusedItemIdx = -1;
    for (let i = 0; i < this._nodes.length; i++) {
      const node = this._nodes[i];
      if (i !== nth) {
        node.classList.remove("focused");
      } else {
        this._focusedItemIdx = i;
        node.classList.add("focused");
        node.focus();
      }
    }
    this._reveal(this._focusedItemIdx, true);
    this._onDidFocusItem.fire({ type: "focus", item: this._items[this._focusedItemIdx], node: this._nodes[this._focusedItemIdx], payload });
  }
  reveal(item) {
    const idx = this._items.indexOf(item);
    if (idx >= 0) {
      this._reveal(idx, false);
    }
  }
  revealLast() {
    this._reveal(this._items.length - 1, false);
  }
  _reveal(nth, minimal) {
    if (nth < 0 || nth >= this._nodes.length) {
      return;
    }
    const node = this._nodes[nth];
    if (!node) {
      return;
    }
    const { width } = this._scrollable.getScrollDimensions();
    const { scrollLeft } = this._scrollable.getScrollPosition();
    if (!minimal || node.offsetLeft > scrollLeft + width || node.offsetLeft < scrollLeft) {
      this._scrollable.setRevealOnScroll(false);
      this._scrollable.setScrollPosition({ scrollLeft: node.offsetLeft });
      this._scrollable.setRevealOnScroll(true);
    }
  }
  getSelection() {
    return this._items[this._selectedItemIdx];
  }
  setSelection(item, payload) {
    this._select(this._items.indexOf(item), payload);
  }
  _select(nth, payload) {
    this._selectedItemIdx = -1;
    for (let i = 0; i < this._nodes.length; i++) {
      const node = this._nodes[i];
      if (i !== nth) {
        node.classList.remove("selected");
      } else {
        this._selectedItemIdx = i;
        node.classList.add("selected");
      }
    }
    this._onDidSelectItem.fire({ type: "select", item: this._items[this._selectedItemIdx], node: this._nodes[this._selectedItemIdx], payload });
  }
  getItems() {
    return this._items;
  }
  setItems(items) {
    let prefix;
    let removed = [];
    try {
      prefix = commonPrefixLength(this._items, items, (a, b) => a.equals(b));
      removed = this._items.splice(prefix, this._items.length - prefix, ...items.slice(prefix));
      this._render(prefix);
      dispose(removed);
      dispose(items.slice(0, prefix));
      this._focus(-1, void 0);
    } catch (e) {
      const newError = new Error(`BreadcrumbsItem#setItems: newItems: ${items.length}, prefix: ${prefix}, removed: ${removed.length}`);
      newError.name = e.name;
      newError.stack = e.stack;
      throw newError;
    }
  }
  _render(start) {
    let didChange = false;
    for (; start < this._items.length && start < this._nodes.length; start++) {
      const item = this._items[start];
      const node = this._nodes[start];
      this._renderItem(item, node);
      didChange = true;
    }
    while (start < this._nodes.length) {
      const free = this._nodes.pop();
      if (free) {
        this._freeNodes.push(free);
        free.remove();
        didChange = true;
      }
    }
    for (; start < this._items.length; start++) {
      const item = this._items[start];
      const node = this._freeNodes.length > 0 ? this._freeNodes.pop() : document.createElement("div");
      if (node) {
        this._renderItem(item, node);
        this._domNode.appendChild(node);
        this._nodes.push(node);
        didChange = true;
      }
    }
    if (didChange) {
      this.layout(void 0);
    }
  }
  _renderItem(item, container) {
    clearNode(container);
    container.className = "";
    try {
      item.render(container);
    } catch (err) {
      container.textContent = "<<RENDER ERROR>>";
      console.error(err);
    }
    container.tabIndex = -1;
    container.setAttribute("role", "listitem");
    container.classList.add("monaco-breadcrumb-item");
    const iconContainer = $(ThemeIcon.asCSSSelector(this._separatorIcon));
    container.appendChild(iconContainer);
  }
  _onClick(event) {
    if (!this._enabled) {
      return;
    }
    for (let el = event.target; el; el = el.parentElement) {
      const idx = this._nodes.indexOf(el);
      if (idx >= 0) {
        this._focus(idx, event);
        this._select(idx, event);
        break;
      }
    }
  }
};
export {
  BreadcrumbsItem,
  BreadcrumbsWidget,
  Codicon,
  Dimension,
  ScrollbarVisibility,
  ThemeIcon
};
//# sourceMappingURL=breadcrumbsWidget.js.map
