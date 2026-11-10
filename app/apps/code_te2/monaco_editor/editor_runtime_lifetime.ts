interface LifetimeDeps {
  setTimeoutFn(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeoutFn(timer: ReturnType<typeof setTimeout>): void;
  onCleanupError?(error: unknown): void;
}

/** Instance-owned work only; shared services and backend state outlive it. */
export function createEditorRuntimeLifetime(deps: LifetimeDeps) {
  const cleanups = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  let disposing = false;
  const cleanup = (callback: () => void): void => {
    try { callback(); } catch (error) {
      try { deps.onCleanupError?.(error); } catch (_) { /* Continue teardown. */ }
    }
  };
  return {
    isDisposed: () => disposed,
    addCleanup(callback: () => void): () => void {
      if (disposed) { cleanup(callback); return () => {}; }
      cleanups.add(callback);
      return () => { cleanups.delete(callback); };
    },
    setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
      if (disposed && !disposing) throw new Error('Working editor lifetime disposed');
      const timer = deps.setTimeoutFn(() => {
        if (timers.delete(timer) && !disposed) callback();
      }, delay);
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer: ReturnType<typeof setTimeout>): void {
      if (timers.delete(timer)) deps.clearTimeoutFn(timer);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposing = true;
      // Cleanup RPCs may complete their synchronous send path before transports
      // close. Any timers created during cleanup are cancelled before returning.
      for (const callback of cleanups) cleanup(callback);
      cleanups.clear();
      disposing = false;
      for (const timer of timers) cleanup(() => deps.clearTimeoutFn(timer));
      timers.clear();
    },
  };
}
