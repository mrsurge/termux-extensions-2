import type { EditorCacheStatePayload } from './editor_save_mirror_contract.ts';

interface CleanCacheStateHandlerOptions {
  payload: EditorCacheStatePayload;
  clearDraftDiffDecorationsFn(): void;
  getAutoSaveFn(): boolean;
  shouldSkipAutosaveFn(diffEditor: unknown, gitHeadModel: unknown, model: unknown): boolean;
  diffEditor: unknown;
  gitHeadModel: unknown;
  model: unknown;
  requestGitBaselinesFn(payload: { immediate?: boolean; reason: string }): void;
  resnapshotDraftBaselineFn(diffEditor: unknown, monacoRef: unknown, model: unknown): void;
  monacoRef: unknown;
  setUnsavedTraceFn(reason: string, unsaved: boolean): void;
}

export function handleCleanCacheState(opts: CleanCacheStateHandlerOptions | null | undefined): void {
  const options = opts;
  if (!options) return;
  options.clearDraftDiffDecorationsFn();
  try {
    if (options.getAutoSaveFn()) {
      if (!options.shouldSkipAutosaveFn(options.diffEditor, options.gitHeadModel, options.model)) {
        options.requestGitBaselinesFn({ reason: 'cache_state_clean_autosave' });
      }
    } else {
      options.resnapshotDraftBaselineFn(options.diffEditor, options.monacoRef, options.model);
      options.requestGitBaselinesFn({ immediate: true, reason: 'cache_state_clean' });
    }
  } catch (_) {}
  options.setUnsavedTraceFn(String(options.payload.reason || 'cache_state'), false);
}
