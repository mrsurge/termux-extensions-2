export function absPathFromVscodeUri(raw) {
  try {
    if (!raw) return '';
    if (typeof raw === 'object') {
      if (raw.fsPath) return String(raw.fsPath);
      if (raw.path) return String(raw.path);
      if (raw.external) return absPathFromVscodeUri(String(raw.external));
      if (raw.scheme && raw.authority && raw.path) return String(raw.path);
      if (raw.scheme && raw.path) return String(raw.path);
      return '';
    }
    var s = String(raw);
    if (s[0] === '/' || /^[A-Za-z]:[\\/]/.test(s)) return s;
    if (s.indexOf('file://') === 0) return decodeURIComponent(s.slice('file://'.length));
    if (s.indexOf('vscode-remote://') === 0) {
      var rest = s.slice('vscode-remote://'.length);
      var slash = rest.indexOf('/');
      if (slash === -1) return '';
      return decodeURIComponent(rest.slice(slash));
    }
    var u = new URL(s);
    if (u && u.pathname) return decodeURIComponent(u.pathname || '');
  } catch (_) {}
  return '';
}
