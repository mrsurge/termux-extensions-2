interface MonacoUriLike {
  toString(): string;
}

interface MonacoModelLike {
  uri?: MonacoUriLike;
}

export interface DiagnosticsLogPayloadLike {
  type?: string;
  args?: unknown[];
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
  let owner = '?';
  let resourceCount = 0;
  let totalMarkers = 0;
  let firstPath = '';
  let activeTouched = false;
  if (typedPayload.type === 'diagnostics/changeMany' && Array.isArray(typedPayload.args) && typedPayload.args.length >= 2) {
    owner = typeof typedPayload.args[0] === 'string' ? typedPayload.args[0] : '?';
    const pairs = Array.isArray(typedPayload.args[1]) ? typedPayload.args[1] : [];
    resourceCount = pairs.length;
    for (let index = 0; index < pairs.length; index += 1) {
      const pair = Array.isArray(pairs[index]) ? pairs[index] : null;
      if (!pair || pair.length < 2) continue;
      const rawUri = pair[0];
      const uriString = typeof rawUri === 'string'
        ? rawUri
        : (rawUri && typeof rawUri === 'object' && !Array.isArray(rawUri) && typeof (rawUri as Record<string, unknown>).external === 'string'
          ? String((rawUri as Record<string, unknown>).external)
          : '');
      const path = uriString ? absPathFromVscodeUriFn(uriString) || '' : '';
      if (!firstPath && path) firstPath = path;
      const markers = Array.isArray(pair[1]) ? pair[1] : [];
      totalMarkers += markers.length;
      if (path && activePath && path === activePath) activeTouched = true;
    }
  }
  console.log(
    ts,
    '[editor:diagnostics:sideband] rx',
    typedPayload.type,
    'owner=' + owner,
    'resources=' + resourceCount,
    'markers=' + totalMarkers,
    'firstPath=' + (firstPath || '?'),
    'activeTouched=' + activeTouched,
    'currentPath=' + currentPath,
    'modelUri=' + modelUri,
    'activePath=' + activePath,
  );
  if (typedPayload.type === 'diagnostics/changeMany' && Array.isArray(typedPayload.args) && typedPayload.args.length >= 2) {
    const pairs = Array.isArray(typedPayload.args[1]) ? typedPayload.args[1] : [];
    const firstPair = pairs.length && Array.isArray(pairs[0]) ? pairs[0] : null;
    const markers = firstPair && Array.isArray(firstPair[1]) ? firstPair[1] : [];
    if (markers.length) {
      console.log('[editor:diagnostics:sideband] first 5 markers:', markers.slice(0, 5));
    }
  }
}
