export function requestGitBaselinesDebounced(opts) {
  var o = opts || {};
  try {
    var immediate = !!o.immediate;
    var reason = o.reason ? String(o.reason) : 'unknown';
    if (typeof o.noteRequestFn === 'function') o.noteRequestFn(reason, immediate);
    if (immediate) {
      if (o.timer) o.clearTimeoutFn(o.timer);
      if (typeof o.setTimerFn === 'function') o.setTimerFn(null);
      return typeof o.emitNowFn === 'function' ? o.emitNowFn() : false;
    }
    if (o.timer) o.clearTimeoutFn(o.timer);
    var next = o.setTimeoutFn(function () {
      if (typeof o.setTimerFn === 'function') o.setTimerFn(null);
      try { if (typeof o.emitNowFn === 'function') o.emitNowFn(); } catch (_) {}
    }, Number(o.debounceMs || 180));
    if (typeof o.setTimerFn === 'function') o.setTimerFn(next);
    return true;
  } catch (_) {
    return false;
  }
}
