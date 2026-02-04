export class DisposableStore {
  constructor() {
    this._disposables = [];
    this._isDisposed = false;
  }

  add(d) {
    if (!d) return d;
    if (this._isDisposed) {
      try {
        d.dispose?.();
      } catch {}
      return d;
    }
    this._disposables.push(d);
    return d;
  }

  dispose() {
    if (this._isDisposed) return;
    this._isDisposed = true;
    const ds = this._disposables;
    this._disposables = [];
    for (const d of ds) {
      try {
        d.dispose?.();
      } catch {}
    }
  }
}

export class Disposable {
  constructor() {
    this._store = new DisposableStore();
  }

  _register(d) {
    return this._store.add(d);
  }

  dispose() {
    this._store.dispose();
  }
}

export function toDisposable(fn) {
  return { dispose: fn };
}

