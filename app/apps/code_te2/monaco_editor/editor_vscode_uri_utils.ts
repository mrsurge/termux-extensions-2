interface VscodeUriObjectLike {
  fsPath?: unknown;
  path?: unknown;
  external?: unknown;
  scheme?: unknown;
  authority?: unknown;
}

interface EditorUriLike {
  toString(): string;
}

function isUriObjectLike(value: unknown): value is VscodeUriObjectLike {
  return !!value && typeof value === 'object';
}

export function absPathFromVscodeUri(raw: unknown): string {
  try {
    if (!raw) return '';
    if (isUriObjectLike(raw)) {
      if (raw.fsPath) return String(raw.fsPath);
      if (raw.path) return String(raw.path);
      if (raw.external) return absPathFromVscodeUri(String(raw.external));
      if ((raw.scheme && raw.authority && raw.path) || (raw.scheme && raw.path)) return String(raw.path);
      return '';
    }
    const value = String(raw);
    if (value[0] === '/' || /^[A-Za-z]:[\\/]/.test(value)) return value;
    if (value.startsWith('file://')) return decodeURIComponent(value.slice('file://'.length));
    if (value.startsWith('vscode-remote://')) {
      const rest = value.slice('vscode-remote://'.length);
      const slash = rest.indexOf('/');
      if (slash === -1) return '';
      return decodeURIComponent(rest.slice(slash));
    }
    const parsed = new URL(value);
    if (parsed.pathname) return decodeURIComponent(parsed.pathname || '');
  } catch (_) {}
  return '';
}

export type { EditorUriLike };
