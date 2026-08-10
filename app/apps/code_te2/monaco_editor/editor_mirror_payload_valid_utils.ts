interface EditorMirrorPayloadLike {
  path?: unknown;
  content?: unknown;
}

export function isMirrorPayloadValid(payload: EditorMirrorPayloadLike | null | undefined): boolean {
  return !!(payload && payload.path && typeof payload.content === 'string');
}
