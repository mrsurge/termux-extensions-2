export interface DiagnosticsBridgePayloadLike {
  type?: string;
  args?: unknown[];
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
  if (typedPayload.type !== 'diagnostics/changeMany') return;
  if (!Array.isArray(typedPayload.args)) return;
  applyDiagnosticsUpdateFn(typedPayload as Record<string, unknown>);
}
