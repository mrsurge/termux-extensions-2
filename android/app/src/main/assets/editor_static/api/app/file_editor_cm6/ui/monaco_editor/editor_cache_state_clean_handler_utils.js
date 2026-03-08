export function handleCleanCacheState(opts) {
  var o = opts || {};
  o.clearDraftDiffDecorationsFn();
  try {
    if (o.getAutoSaveFn()) {
      if (!o.shouldSkipAutosaveFn(o.diffEditor, o.gitHeadModel, o.model)) {
        o.requestGitBaselinesFn({ reason: 'cache_state_clean_autosave' });
      }
    } else {
      o.resnapshotDraftBaselineFn(o.diffEditor, o.monacoRef, o.model);
      o.requestGitBaselinesFn({ immediate: true, reason: 'cache_state_clean' });
    }
  } catch (_) {}
  o.setUnsavedTraceFn((o.payload && o.payload.reason) || 'cache_state', false);
}
