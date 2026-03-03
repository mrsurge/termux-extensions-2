export function handleIssuesDumpRequest(payload, monacoRef, model, emitToHostFn) {
  var requestId = payload && (payload.requestId || payload.request_id)
    ? String(payload.requestId || payload.request_id)
    : '';
  if (!requestId) return;
  var dump = {};
  try {
    if (monacoRef && model) {
      var markers = monacoRef.editor.getModelMarkers({ resource: model.uri }) || [];
      dump = { markers: markers };
    }
  } catch (_) {}
  emitToHostFn('editor_issues_dump_response', { requestId: requestId, dump: dump });
}
