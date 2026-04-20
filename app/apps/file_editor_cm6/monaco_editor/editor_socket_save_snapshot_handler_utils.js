export function handleSaveSnapshotRequest(payload, currentPath, model, baseSha256, emitToHostFn) {
  var requestId = payload && (payload.requestId || payload.request_id)
    ? String(payload.requestId || payload.request_id)
    : '';
  if (!requestId) return;

  var response = { requestId: requestId };
  try {
    if (!currentPath || !model || typeof model.getValue !== 'function') {
      response.error = 'missing_path';
    } else {
      response.path = String(currentPath);
      response.content = String(model.getValue() || '');
      if (typeof baseSha256 === 'string' && baseSha256.length === 64) {
        response.base_sha256 = baseSha256;
      }
    }
  } catch (err) {
    response.error = (err && err.message) ? String(err.message) : 'save_snapshot_failed';
  }
  emitToHostFn('editor_save_snapshot_response', response);
}
