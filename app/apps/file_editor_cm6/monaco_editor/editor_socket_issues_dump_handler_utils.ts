interface MonacoUriLike {
  toString(): string;
}

interface MonacoModelLike {
  uri?: MonacoUriLike;
}

interface MonacoEditorNamespaceLike {
  getModelMarkers?(opts: { resource: MonacoUriLike }): unknown[];
}

interface MonacoLike {
  editor?: MonacoEditorNamespaceLike;
}

export interface IssuesDumpPayloadLike {
  requestId?: string;
  request_id?: string;
}

function asIssuesDumpPayloadLike(value: unknown): IssuesDumpPayloadLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as IssuesDumpPayloadLike
    : null;
}

function asMonacoLike(value: unknown): MonacoLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as MonacoLike
    : null;
}

function asMonacoModelLike(value: unknown): MonacoModelLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as MonacoModelLike
    : null;
}

export function handleIssuesDumpRequest(
  payload: unknown,
  monacoRef: unknown,
  model: unknown,
  emitToHostFn: (eventName: string, payload: Record<string, unknown>) => void,
): void {
  const typedPayload = asIssuesDumpPayloadLike(payload);
  const typedMonaco = asMonacoLike(monacoRef);
  const typedModel = asMonacoModelLike(model);
  const requestId = typedPayload?.requestId || typedPayload?.request_id ? String(typedPayload?.requestId || typedPayload?.request_id || '') : '';
  if (!requestId) return;
  let dump: Record<string, unknown> = {};
  try {
    if (typedMonaco?.editor?.getModelMarkers && typedModel?.uri) {
      const markers = typedMonaco.editor.getModelMarkers({ resource: typedModel.uri }) || [];
      dump = { markers };
    }
  } catch (_) {}
  emitToHostFn('editor_issues_dump_response', { requestId, dump });
}
