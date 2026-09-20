interface ThemeJsonLike extends Record<string, unknown> {
  uiTheme?: string;
}

interface ApplyMonacoThemeRuntimeOptions {
  win?: Window | null;
  doc: Document;
  themeKey: string;
  ensureTe2DiffThemeFn?: () => unknown;
  loadThemesFn?: () => Promise<unknown> | unknown;
  resolveThemeIdFn?: (themeKey: string, cache: Record<string, ThemeJsonLike>) => string;
  getThemeJsonUrlFn?: (themeId: string) => string | null;
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
  toMonacoThemeFn: (themeId: string, json: ThemeJsonLike) => unknown;
  getJsonCacheFn?: () => Record<string, ThemeJsonLike>;
  setJsonCacheFn?: (cache: Record<string, ThemeJsonLike>) => void;
  applyThemeToTextmateRegistryFn?: (theme: ThemeJsonLike) => void;
}

export async function applyMonacoThemeRuntime(
  opts: ApplyMonacoThemeRuntimeOptions,
): Promise<ThemeJsonLike> {
  const options = opts || ({} as ApplyMonacoThemeRuntimeOptions);
  try {
    if (!options.win?.monaco?.editor?.setTheme) throw new Error('Monaco theme runtime unavailable');
    if (typeof options.ensureTe2DiffThemeFn === 'function') options.ensureTe2DiffThemeFn();
    if (typeof options.loadThemesFn === 'function') await options.loadThemesFn();
    const cache = options.getJsonCacheFn ? (options.getJsonCacheFn() || {}) : {};
    // A known selected resource must not silently turn into the default theme
    // merely because its preload failed. Retry that resource or fail explicitly.
    const resolvedId = options.getThemeJsonUrlFn?.(options.themeKey)
      ? options.themeKey
      : options.resolveThemeIdFn ? options.resolveThemeIdFn(options.themeKey, cache) : String(options.themeKey || '');
    if (!cache[resolvedId]) {
      const url = options.getThemeJsonUrlFn ? options.getThemeJsonUrlFn(resolvedId) : null;
      if (!url) throw new Error(`Theme resource unavailable: ${resolvedId}`);
      const response = await options.fetchFn(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Theme resource failed: ${resolvedId} (HTTP ${response.status})`);
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid theme: ${resolvedId}`);
      const json = value as ThemeJsonLike;
      const monacoTheme = options.toMonacoThemeFn(resolvedId, json);
      options.win.monaco.editor.defineTheme?.(resolvedId, monacoTheme as Record<string, unknown>);
      cache[resolvedId] = json;
    }
    if (options.setJsonCacheFn) options.setJsonCacheFn(cache);
    options.win.monaco.editor.setTheme(resolvedId);
    try {
      options.doc.documentElement.classList.remove('vs', 'vs-dark', 'hc-black', 'hc-light');
      let base = (cache[resolvedId] && cache[resolvedId].uiTheme) || '';
      if (!base) base = resolvedId.toLowerCase().includes('light') ? 'vs' : 'vs-dark';
      else if (base.includes('light')) base = 'vs';
      else base = 'vs-dark';
      options.doc.documentElement.classList.add(base);
      console.log('[touch-theme] html class set to', base, 'for theme', resolvedId);
    } catch (_) {}
    if (typeof options.applyThemeToTextmateRegistryFn === 'function') options.applyThemeToTextmateRegistryFn(cache[resolvedId]);
    return cache[resolvedId];
  } catch (error) {
    console.warn('[Monaco] applyMonacoTheme failed', error);
    throw error;
  }
}
