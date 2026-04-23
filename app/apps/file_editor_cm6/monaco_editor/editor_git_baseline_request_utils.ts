interface GitBaselineRequestDebounceOptions {
  immediate?: boolean;
  reason?: string;
  timer?: ReturnType<typeof setTimeout> | null;
  clearTimeoutFn(timer: ReturnType<typeof setTimeout>): void;
  setTimerFn(timer: ReturnType<typeof setTimeout> | null): void;
  setTimeoutFn(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  noteRequestFn?(reason: string, immediate: boolean): void;
  emitNowFn?(): boolean;
  debounceMs?: number;
}

export function requestGitBaselinesDebounced(opts: GitBaselineRequestDebounceOptions | null | undefined): boolean {
  const o = opts || undefined;
  try {
    if (!o) return false;
    const immediate = !!o.immediate;
    const reason = o.reason ? String(o.reason) : 'unknown';
    if (typeof o.noteRequestFn === 'function') o.noteRequestFn(reason, immediate);
    if (immediate) {
      if (o.timer) o.clearTimeoutFn(o.timer);
      if (typeof o.setTimerFn === 'function') o.setTimerFn(null);
      return typeof o.emitNowFn === 'function' ? o.emitNowFn() : false;
    }
    if (o.timer) o.clearTimeoutFn(o.timer);
    const next = o.setTimeoutFn(function () {
      if (typeof o.setTimerFn === 'function') o.setTimerFn(null);
      try { if (typeof o.emitNowFn === 'function') o.emitNowFn(); } catch (_) {}
    }, Number(o.debounceMs || 180));
    if (typeof o.setTimerFn === 'function') o.setTimerFn(next);
    return true;
  } catch (_) {
    return false;
  }
}
