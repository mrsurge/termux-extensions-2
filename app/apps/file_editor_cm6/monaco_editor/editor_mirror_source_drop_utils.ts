interface EditorMirrorPayloadLike {
  source_client?: unknown;
}

export function shouldDropMirrorForSource(
  payload: EditorMirrorPayloadLike | null | undefined,
  editorSocketId: string | null | undefined,
): boolean {
  return !!(payload && payload.source_client && editorSocketId && String(payload.source_client) === String(editorSocketId));
}
