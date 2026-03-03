export function queueBackendWorkbenchOpen(opts) {
  var o = opts || {};
  try {
    var reqId = 'diag_' + Date.now() + '_backend';
    var text = o.model && o.model.getValue ? o.model.getValue() : '';
    o.queueDidChangeFn(o.currentPath, text, o.model && o.model.getLanguageId ? o.model.getLanguageId() : o.lang, o.generation);
    o.queueSymbolsFn(o.currentPath, o.generation);
    o.openFileFlowFn({
      path: o.currentPath,
      languageId: o.lang,
      uri: (o.model && o.model.uri) ? String(o.model.uri.toString()) : '',
      requestId: reqId,
      forceRefresh: true,
      generation: o.generation,
      source: 'openPathFromBackend',
      timeoutMs: 8000,
    }).catch(function () {});
  } catch (_) {}
}
