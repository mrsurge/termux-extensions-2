interface EditorMirrorPayloadLike {
  source_client?: unknown;
}

export function shouldDropMirrorForSource(
  payload: EditorMirrorPayloadLike | null | undefined,
  clientInstanceId: string | null | undefined,
): boolean {
  return !!(
    payload
    && payload.source_client
    && clientInstanceId
    && String(payload.source_client) === String(clientInstanceId)
  );
}
