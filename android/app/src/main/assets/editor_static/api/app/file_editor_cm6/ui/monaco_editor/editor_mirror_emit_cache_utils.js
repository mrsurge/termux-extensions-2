export function emitMirrorCacheState(emitToHostFn, payload, mirrorUnsaved) {
  emitToHostFn('editor_cache_state', {
    path: payload.path,
    state: mirrorUnsaved ? 'mid_session' : 'clean',
    unsaved: mirrorUnsaved,
    reason: 'mirror',
    content_sha256: payload.content_sha256,
  });
  if (mirrorUnsaved) emitToHostFn('editor_draft_state', { has_draft: true, path: payload.path });
}
