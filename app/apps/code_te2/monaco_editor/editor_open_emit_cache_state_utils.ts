export function emitOpenCacheState(
  emitToHostFn: (eventName: string, payload: Record<string, unknown>) => void,
  absPath: string,
  hasDraft: boolean,
  sha256: string | null,
  baseSha256: string | null,
  autoSave: boolean | null,
  documentRevision: number,
): void {
  emitToHostFn('editor_cache_state', {
    path: absPath,
    state: hasDraft ? 'mid_session' : 'clean',
    unsaved: hasDraft,
    reason: hasDraft ? 'restore' : 'set_content',
    content_sha256: sha256,
    base_sha256: baseSha256 || (hasDraft ? null : sha256),
    auto_save: autoSave,
    document_revision: documentRevision,
  });
  if (hasDraft) {
    emitToHostFn('editor_draft_state', {
      has_draft: true,
      path: absPath,
      document_revision: documentRevision,
    });
  }
}
