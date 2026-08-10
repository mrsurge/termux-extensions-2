export type ComponentCleanup = () => void;

export type ComponentDisposable =
  | ComponentCleanup
  | { dispose: ComponentCleanup }
  | { unsubscribe: ComponentCleanup }
  | { destroy: ComponentCleanup };

export type ComponentSubscription<Value> = (
  listener: (value: Value) => void,
) => ComponentDisposable | void;

export interface ComponentOwner {
  readonly disposed: boolean;
  own: (disposable: ComponentDisposable | void) => ComponentCleanup;
  onDispose: (cleanup: ComponentCleanup) => ComponentCleanup;
  listen: (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => ComponentCleanup;
  subscribe: <Value>(
    subscription: ComponentSubscription<Value>,
    listener: (value: Value) => void,
  ) => ComponentCleanup;
  child: () => ComponentOwner;
  dispose: () => void;
}

interface CleanupEntry {
  cleanup: ComponentCleanup;
  active: boolean;
}

function cleanupFrom(
  disposable: ComponentDisposable | void,
): ComponentCleanup {
  if (!disposable) return () => {};
  if (typeof disposable === "function") return disposable;
  if ("dispose" in disposable && typeof disposable.dispose === "function") {
    return () => disposable.dispose();
  }
  if (
    "unsubscribe" in disposable &&
    typeof disposable.unsubscribe === "function"
  ) {
    return () => disposable.unsubscribe();
  }
  if ("destroy" in disposable && typeof disposable.destroy === "function") {
    return () => disposable.destroy();
  }
  return () => {};
}

export function createComponentOwner(): ComponentOwner {
  const cleanups: CleanupEntry[] = [];
  let disposed = false;

  function runEntry(entry: CleanupEntry): void {
    if (!entry.active) return;
    entry.active = false;
    const index = cleanups.lastIndexOf(entry);
    if (index >= 0) cleanups.splice(index, 1);
    entry.cleanup();
  }

  function own(disposable: ComponentDisposable | void): ComponentCleanup {
    const cleanup = cleanupFrom(disposable);
    if (disposed) {
      cleanup();
      return () => {};
    }
    const entry = { cleanup, active: true };
    cleanups.push(entry);
    return () => runEntry(entry);
  }

  function listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): ComponentCleanup {
    target.addEventListener(type, listener, options);
    return own(() => target.removeEventListener(type, listener, options));
  }

  function subscribe<Value>(
    subscription: ComponentSubscription<Value>,
    listener: (value: Value) => void,
  ): ComponentCleanup {
    return own(subscription(listener));
  }

  function child(): ComponentOwner {
    const nested = createComponentOwner();
    const release = own(() => nested.dispose());
    return {
      get disposed() {
        return nested.disposed;
      },
      own: nested.own,
      onDispose: nested.onDispose,
      listen: nested.listen,
      subscribe: nested.subscribe,
      child: nested.child,
      dispose: release,
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    const pending = cleanups.splice(0).reverse();
    const errors: unknown[] = [];
    pending.forEach((entry) => {
      if (!entry.active) return;
      entry.active = false;
      try {
        entry.cleanup();
      } catch (error) {
        errors.push(error);
      }
    });
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Component disposal failed");
    }
  }

  return {
    get disposed() {
      return disposed;
    },
    own,
    onDispose: own,
    listen,
    subscribe,
    child,
    dispose,
  };
}
