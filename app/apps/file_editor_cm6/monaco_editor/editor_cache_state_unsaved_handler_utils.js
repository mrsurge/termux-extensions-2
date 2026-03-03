export function handleUnsavedCacheState(payload, setUnsavedTraceFn, requestDraftDiffFn) {
  setUnsavedTraceFn((payload && payload.reason) || 'cache_state', true);
  requestDraftDiffFn('cache_state');
}
