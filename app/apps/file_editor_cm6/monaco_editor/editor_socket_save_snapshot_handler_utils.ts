import type { EditorSaveSnapshotRequestPayload } from './editor_save_mirror_contract.ts';

interface MonacoModelLike {
  getValue?(): string;
}

function asSaveSnapshotRequestPayload(value: unknown): EditorSaveSnapshotRequestPayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as EditorSaveSnapshotRequestPayload
    : null;
}

export function handleSaveSnapshotRequest(
  payload: unknown,
  currentPath: string | null | undefined,
  model: unknown,
  baseSha256: string | null | undefined,
  emitToHostFn: (eventName: string, payload: Record<string, unknown>) => void,
): void {
  const typedPayload = asSaveSnapshotRequestPayload(payload);
  const requestId = typedPayload && (typedPayload.requestId || typedPayload.request_id)
    ? String(typedPayload.requestId || typedPayload.request_id)
    : '';
  if (!requestId) return;

  const response: Record<string, unknown> = { requestId };
  try {
    const typedModel = model != null && typeof model === 'object' && !Array.isArray(model)
      ? model as MonacoModelLike
      : null;
    if (!currentPath || !typedModel || typeof typedModel.getValue !== 'function') {
      response.error = 'missing_path';
    } else {
      response.path = String(currentPath);
      response.content = String(typedModel.getValue() || '');
      if (typeof baseSha256 === 'string' && baseSha256.length === 64) {
        response.base_sha256 = baseSha256;
      }
    }
  } catch (error) {
    response.error = error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || 'save_snapshot_failed')
      : 'save_snapshot_failed';
  }
  emitToHostFn('editor_save_snapshot_response', response);
}
