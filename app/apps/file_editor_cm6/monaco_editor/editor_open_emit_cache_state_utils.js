export function emitOpenCacheState(emitToHostFn, absPath, hasDraft, sha256, autoSave) {
  emitToHostFn('editor_cache_state', {
    path: absPath,
    state: hasDraft ? 'mid_session' : 'clean',
    unsaved: hasDraft,
    reason: hasDraft ? 'restore' : 'set_content',
    content_sha256: sha256,
    auto_save: autoSave,
  });
  if (hasDraft) emitToHostFn('editor_draft_state', { has_draft: true, path: absPath });
}
