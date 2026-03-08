export function wbEmitDidChange(editorSocket, payload, currentGenerationFn) {
  try {
    if (!editorSocket || !editorSocket.connected) return false;
    if (!payload || !payload.path) return false;
    var fallback = typeof currentGenerationFn === 'function' ? currentGenerationFn() : 0;
    editorSocket.emit('editor_workbench_did_change', {
      path: payload.path,
      text: String(payload.text || ''),
      languageId: String(payload.languageId || ''),
      generation: Number.isFinite(Number(payload.generation)) ? Number(payload.generation) : fallback,
    });
    return true;
  } catch (_) {
    return false;
  }
}
