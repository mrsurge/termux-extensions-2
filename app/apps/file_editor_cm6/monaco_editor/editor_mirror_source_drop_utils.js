export function shouldDropMirrorForSource(payload, editorSocketId) {
  return !!(payload && payload.source_client && editorSocketId && String(payload.source_client) === String(editorSocketId));
}
