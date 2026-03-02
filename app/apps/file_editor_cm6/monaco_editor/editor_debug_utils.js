export function setDebugPart(debugParts, key, value, updateDebug) {
  debugParts[key] = value || null;
  updateDebug();
}

export function syncTraceDebug(trace, setDebugTrace) {
  setDebugTrace(
    'trace=mb' + trace.mirror_bind_total +
    '/a' + trace.mirror_active +
    ' us=' + trace.unsaved_reason +
    ' gb=' + trace.gb_req_total +
    '/' + trace.gb_req_immediate +
    '/' + trace.gb_req_debounced +
    ' src=' + trace.gb_last_source
  );
}

export function syncMirrorDebug(mirrorState, setDebugMirror) {
  setDebugMirror(
    'mir=rx' + mirrorState.rx +
    '/ap' + mirrorState.ap +
    '/self' + mirrorState.drop_self +
    '/sha' + mirrorState.drop_sha +
    '/hot' + mirrorState.drop_hot
  );
}
