export function wbFlushDidChangeIfReady(wbFlow, isBarrierOpenFn, emitDidChangeFn) {
  var pending = wbFlow && wbFlow.pendingDidChange;
  if (!pending) return;
  if (!(typeof isBarrierOpenFn === 'function' && isBarrierOpenFn(pending.path, pending.generation))) return;
  wbFlow.pendingDidChange = null;
  if (typeof emitDidChangeFn === 'function') emitDidChangeFn(pending);
}

export function wbFlushSymbolsIfReady(wbFlow, isBarrierOpenFn, requestSymbolsFn) {
  var pending = wbFlow && wbFlow.pendingSymbols;
  if (!pending) return;
  if (!(typeof isBarrierOpenFn === 'function' && isBarrierOpenFn(pending.path, pending.generation))) return;
  wbFlow.pendingSymbols = null;
  if (typeof requestSymbolsFn === 'function') requestSymbolsFn(pending.path, { generation: pending.generation, fromQueue: true });
}

export function wbFlushPendingAfterOpen(flushDidChangeFn, flushSymbolsFn) {
  if (typeof flushDidChangeFn === 'function') flushDidChangeFn();
  if (typeof flushSymbolsFn === 'function') flushSymbolsFn();
}

export function wbPublishDidChange(wbFlow, path, text, languageId, generation, currentGenerationFn, isBarrierOpenFn, emitDidChangeFn, queueDidChangeFn) {
  var fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : 0;
  var payload = {
    path: String(path || ''),
    text: String(text || ''),
    languageId: String(languageId || ''),
    generation: Number.isFinite(Number(generation)) ? Number(generation) : fallback,
  };
  if (typeof isBarrierOpenFn === 'function' && isBarrierOpenFn(payload.path, payload.generation)) {
    return typeof emitDidChangeFn === 'function' ? emitDidChangeFn(payload) : false;
  }
  if (typeof queueDidChangeFn === 'function') queueDidChangeFn(payload.path, payload.text, payload.languageId, payload.generation);
  return false;
}
