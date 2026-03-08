export function logDiagnosticsEvent(payload, model, currentPath, absPathFromVscodeUriFn) {
  if (!payload || typeof payload !== 'object') return;
  var ts = '';
  try {
    var t = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? (Math.round(performance.now() * 10) / 10)
      : null;
    ts = (t != null ? ('t=' + t + 'ms ') : '') + 'now=' + Date.now();
  } catch (_) { ts = 'now=' + Date.now(); }
  var modelUri = (model && model.uri) ? String(model.uri.toString()) : '';
  var activePath = currentPath ? String(currentPath) : absPathFromVscodeUriFn(modelUri);
  var payloadPath = payload.path ? String(payload.path) : '';
  console.log(ts, '[editor:diagnostics] rx', payload.type,
    'path=' + (payloadPath || '?'),
    'markers=' + ((payload.markers || []).length),
    'currentPath=' + currentPath,
    'modelUri=' + modelUri,
    'activePath=' + activePath
  );
  if (payload.markers && payload.markers.length) {
    console.log('[editor:diagnostics] first 5 markers:', payload.markers.slice(0, 5));
  }
}
