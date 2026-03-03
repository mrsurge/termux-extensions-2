export function applyDiagnosticsBridgeUpdate(payload, applyDiagnosticsUpdateFn) {
  if (!payload || payload.type !== 'diagnostics/update') return;
  var items = [{ uri: 'file://' + (payload.path || ''), markers: payload.markers || [] }];
  applyDiagnosticsUpdateFn({ owner: payload.owner || 'workbench', items: items });
}
