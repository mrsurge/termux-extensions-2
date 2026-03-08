export function emitToHostSocket(editorSocket, eventName, payload) {
  try {
    if (!editorSocket || !editorSocket.connected) return false;
    editorSocket.emit(eventName, payload || {});
    return true;
  } catch (_) {
    return false;
  }
}
