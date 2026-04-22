interface EditorSocketLike {
  connected?: boolean;
  emit?(eventName: string, payload: Record<string, unknown>): void;
}

export function emitToHostSocket(
  editorSocket: EditorSocketLike | null | undefined,
  eventName: string,
  payload: Record<string, unknown> | null | undefined,
): boolean {
  try {
    if (!editorSocket || !editorSocket.connected || typeof editorSocket.emit !== 'function') return false;
    editorSocket.emit(eventName, payload || {});
    return true;
  } catch (_) {
    return false;
  }
}
