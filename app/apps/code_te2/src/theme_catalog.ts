export interface ThemeCatalogEntry {
  id: string;
  label: string;
  uiTheme: string;
  source: 'vendored' | 'extension';
  sourceLabel: string;
  serveUrl: string;
}

export interface ThemeCatalog {
  themes: ThemeCatalogEntry[];
}

export type RequestThemeCatalog = () => Promise<unknown>;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

// Both RPC lanes share this DTO, not a connection or another surface's socket.
export function parseThemeCatalog(value: unknown): ThemeCatalog {
  const entries = record(value).themes;
  if (!Array.isArray(entries)) throw new Error('Invalid theme catalog');
  const themes: ThemeCatalogEntry[] = entries.map((value: unknown) => {
    const entry = record(value);
    const { id, label, uiTheme, source, sourceLabel, serveUrl } = entry;
    if (typeof id !== 'string' || typeof label !== 'string' || typeof uiTheme !== 'string'
      || (source !== 'vendored' && source !== 'extension')
      || typeof sourceLabel !== 'string' || typeof serveUrl !== 'string') {
      throw new Error('Invalid theme catalog entry');
    }
    return { id, label, uiTheme, source, sourceLabel, serveUrl };
  });
  return { themes };
}
