import type { EditorCacheStatePayload } from './editor_save_mirror_contract.ts';

export function handleUnsavedCacheState(
  payload: EditorCacheStatePayload,
  setUnsavedTraceFn: (reason: string, unsaved: boolean) => void,
  requestDraftDiffFn: (reason: string) => void,
): void {
  setUnsavedTraceFn(String(payload.reason || 'cache_state'), true);
  requestDraftDiffFn('cache_state');
}
