export interface DiagnosticsBridgePayloadLike {
  type?: string;
  path?: string;
  markers?: unknown[];
  owner?: string;
  args?: unknown[];
  entries?: unknown[];
  items?: unknown[];
}

function asDiagnosticsBridgePayloadLike(value: unknown): DiagnosticsBridgePayloadLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as DiagnosticsBridgePayloadLike
    : null;
}

export function applyDiagnosticsBridgeUpdate(
  payload: unknown,
  applyDiagnosticsUpdateFn: (payload: Record<string, unknown>) => void,
): void {
  const typedPayload = asDiagnosticsBridgePayloadLike(payload);
  if (!typedPayload) return;
  if (typedPayload.type === 'diagnostics/changeMany') {
    applyDiagnosticsUpdateFn(typedPayload as Record<string, unknown>);
    return;
  }
  if (typedPayload.type !== 'diagnostics/update') return;
  if (Array.isArray(typedPayload.items)) {
    applyDiagnosticsUpdateFn(typedPayload as Record<string, unknown>);
    return;
  }
  const items = [{ uri: 'file://' + (typedPayload.path || ''), markers: typedPayload.markers || [] }];
  applyDiagnosticsUpdateFn({ owner: typedPayload.owner || 'workbench', items });
}
