interface EditorMirrorPayloadLike {
  path?: unknown;
  content_sha256?: unknown;
  base_sha256?: unknown;
  document_revision?: unknown;
}

export function emitMirrorCacheState(
  emitToHostFn: (eventName: string, payload: Record<string, unknown>) => void,
  payload: EditorMirrorPayloadLike | null | undefined,
  mirrorUnsaved: boolean,
): void {
  emitToHostFn('editor_cache_state', {
    path: payload?.path,
    state: mirrorUnsaved ? 'mid_session' : 'clean',
    unsaved: mirrorUnsaved,
    reason: 'mirror',
    content_sha256: payload?.content_sha256,
    base_sha256: payload?.base_sha256,
    document_revision: payload?.document_revision,
  });
  if (mirrorUnsaved) {
    emitToHostFn('editor_draft_state', {
      has_draft: true,
      path: payload?.path,
      document_revision: payload?.document_revision,
    });
  }
}
