export function handleDraftDiffEvent(payload, currentPath, draftDiffRequestId, applyDraftDiffDecorationsFn) {
  if (!payload || !payload.path || !currentPath) return;
  if (String(payload.path) !== String(currentPath)) return;
  if (payload.requestId && draftDiffRequestId && String(payload.requestId) !== String(draftDiffRequestId)) return;
  applyDraftDiffDecorationsFn(payload);
}
