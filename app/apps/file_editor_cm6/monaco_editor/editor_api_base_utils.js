export function deriveApiBase(locationObj) {
  try {
    var override = '';
    try {
      override = String(
        (typeof window !== 'undefined' && window.__te2InlineMonacoApiBase)
          ? window.__te2InlineMonacoApiBase
          : ''
      ).trim();
    } catch (_) {
      override = '';
    }
    if (override) return override.replace(/\/+$/, '');

    var p = String(locationObj && locationObj.pathname ? locationObj.pathname : '');
    var idx = p.indexOf('/ui/');
    return idx >= 0 ? p.slice(0, idx) : '';
  } catch (_) {
    return '';
  }
}
