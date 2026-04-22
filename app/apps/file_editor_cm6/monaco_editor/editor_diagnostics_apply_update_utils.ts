export interface DiagnosticsBridgePayloadLike {
  type?: string;
  path?: string;
  markers?: unknown[];
  owner?: string;
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
  if (!typedPayload || typedPayload.type !== 'diagnostics/update') return;
  const items = [{ uri: 'file://' + (typedPayload.path || ''), markers: typedPayload.markers || [] }];
  applyDiagnosticsUpdateFn({ owner: typedPayload.owner || 'workbench', items });
}
