interface MonacoUriLike {
  toString(): string;
}

interface MonacoModelLike {
  uri?: MonacoUriLike;
}

export interface DiagnosticsLogPayloadLike {
  type?: string;
  path?: string;
  markers?: unknown[];
}

function asDiagnosticsLogPayloadLike(value: unknown): DiagnosticsLogPayloadLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as DiagnosticsLogPayloadLike
    : null;
}

function asMonacoModelLike(value: unknown): MonacoModelLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as MonacoModelLike
    : null;
}

export function logDiagnosticsEvent(
  payload: unknown,
  model: unknown,
  currentPath: string | null | undefined,
  absPathFromVscodeUriFn: (raw: string) => string | null,
): void {
  const typedPayload = asDiagnosticsLogPayloadLike(payload);
  if (!typedPayload) return;
  const typedModel = asMonacoModelLike(model);
  let ts = '';
  try {
    const t = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? (Math.round(performance.now() * 10) / 10)
      : null;
    ts = (t != null ? ('t=' + t + 'ms ') : '') + 'now=' + Date.now();
  } catch (_) {
    ts = 'now=' + Date.now();
  }
  const modelUri = typedModel?.uri ? String(typedModel.uri.toString()) : '';
  const activePath = currentPath ? String(currentPath) : absPathFromVscodeUriFn(modelUri);
  const payloadPath = typedPayload.path ? String(typedPayload.path) : '';
  const markers = Array.isArray(typedPayload.markers) ? typedPayload.markers : [];
  console.log(
    ts,
    '[editor:diagnostics] rx',
    typedPayload.type,
    'path=' + (payloadPath || '?'),
    'markers=' + markers.length,
    'currentPath=' + currentPath,
    'modelUri=' + modelUri,
    'activePath=' + activePath,
  );
  if (markers.length) {
    console.log('[editor:diagnostics] first 5 markers:', markers.slice(0, 5));
  }
}
