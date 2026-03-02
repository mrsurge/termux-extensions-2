export function buildUiUrl(apiBase, relPath) {
  var p = String(relPath || '').replace(/^\/+/, '');
  return String(apiBase || '') + '/ui/' + p;
}

export function wsUrlFromPath(locationObj, p) {
  try {
    var proto = (locationObj && locationObj.protocol === 'https:') ? 'wss:' : 'ws:';
    var host = locationObj ? locationObj.host : 'localhost';
    var pathOnly = String(p || '');
    if (!pathOnly.startsWith('/')) pathOnly = '/' + pathOnly;
    return proto + '//' + host + pathOnly;
  } catch (_) {
    return null;
  }
}

export async function fetchJsonWithBase(fetchImpl, apiBase, path, options) {
  var url = String(apiBase || '') + String(path || '');
  var resp = await fetchImpl(url, options || { cache: 'no-store' });
  var json = null;
  try { json = await resp.json(); } catch (_) {}
  if (!resp.ok || (json && json.ok === false)) {
    var msg = (json && (json.error || json.detail)) ? (json.error || json.detail) : ('HTTP ' + resp.status);
    throw new Error(msg);
  }
  return json && (json.data || json) ? (json.data || json) : json;
}
