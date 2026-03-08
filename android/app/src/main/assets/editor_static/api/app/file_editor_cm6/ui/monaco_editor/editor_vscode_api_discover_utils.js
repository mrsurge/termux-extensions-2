export async function discoverVscodeApiWsPath(fetchFn, setTimeoutFn) {
  var json = null;
  var resp = null;
  for (var attempt = 0; attempt < 25; attempt++) {
    resp = await fetchFn('/api/app/file_editor_cm6/vscode_api/discover', { cache: 'no-store' });
    json = null;
    try { json = await resp.json(); } catch (_) {}
    if (resp.ok && !(json && json.ok === false)) break;
    if (resp.status === 503) {
      await new Promise(function (r) { setTimeoutFn(r, 120); });
      continue;
    }
    var msg0 = (json && (json.error || json.detail)) ? (json.error || json.detail) : ('HTTP ' + resp.status);
    throw new Error(msg0);
  }
  if (!resp || !resp.ok || (json && json.ok === false)) {
    var msg = (json && (json.error || json.detail)) ? (json.error || json.detail) : (resp ? ('HTTP ' + resp.status) : 'unknown');
    throw new Error('vscode_api discover failed: ' + msg);
  }
  var wsPath = null;
  try { wsPath = (json && json.data && json.data.ws_url) ? json.data.ws_url : (json && json.ws_url ? json.ws_url : null); } catch (_) {}
  if (!wsPath) throw new Error('vscode_api discover missing ws_url');
  return wsPath;
}
