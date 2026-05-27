import type { EditorCacheStatePayload } from './editor_save_mirror_contract.ts';

interface CleanCacheStateHandlerOptions {
  payload: EditorCacheStatePayload;
  clearDraftDiffDecorationsFn(): void;
  getAutoSaveFn(): boolean;
  requestGitBaselinesFn(payload: { immediate?: boolean; reason: string }): void;
  setUnsavedTraceFn(reason: string, unsaved: boolean): void;
}

export function handleCleanCacheState(opts: CleanCacheStateHandlerOptions | null | undefined): void {
  const options = opts;
  if (!options) return;
  options.clearDraftDiffDecorationsFn();
  try {
    options.requestGitBaselinesFn({
      immediate: true,
      reason: options.getAutoSaveFn() ? 'cache_state_clean_autosave' : 'cache_state_clean',
    });
  } catch (_) {}
  options.setUnsavedTraceFn(String(options.payload.reason || 'cache_state'), false);
}
