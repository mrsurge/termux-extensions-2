export interface DraftDiffPayloadLike {
  path?: string;
  requestId?: string;
}

function asDraftDiffPayloadLike(value: unknown): DraftDiffPayloadLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as DraftDiffPayloadLike
    : null;
}

export function handleDraftDiffEvent(
  payload: unknown,
  currentPath: string | null | undefined,
  draftDiffRequestId: string | null | undefined,
  applyDraftDiffDecorationsFn: (payload: DraftDiffPayloadLike) => void,
): void {
  const typedPayload = asDraftDiffPayloadLike(payload);
  if (!typedPayload || !typedPayload.path || !currentPath) return;
  if (String(typedPayload.path) !== String(currentPath)) return;
  if (typedPayload.requestId && draftDiffRequestId && String(typedPayload.requestId) !== String(draftDiffRequestId)) return;
  applyDraftDiffDecorationsFn(typedPayload);
}
