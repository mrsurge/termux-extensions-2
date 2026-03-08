export function deriveApiBase(locationObj) {
  try {
    var p = String(locationObj && locationObj.pathname ? locationObj.pathname : '');
    var idx = p.indexOf('/ui/');
    return idx >= 0 ? p.slice(0, idx) : '';
  } catch (_) {
    return '';
  }
}
