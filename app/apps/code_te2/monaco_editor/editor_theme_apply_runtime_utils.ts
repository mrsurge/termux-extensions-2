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
): Promise<ThemeJsonLike | null> {
  const options = opts || ({} as ApplyMonacoThemeRuntimeOptions);
  try {
    if (!options.win || !options.win.monaco || !options.win.monaco.editor || !options.win.monaco.editor.setTheme) return null;
    if (typeof options.ensureTe2DiffThemeFn === 'function') options.ensureTe2DiffThemeFn();
    try { if (typeof options.loadThemesFn === 'function') await options.loadThemesFn(); } catch (_) {}
    const cache = options.getJsonCacheFn ? (options.getJsonCacheFn() || {}) : {};
    const resolvedId = options.resolveThemeIdFn ? options.resolveThemeIdFn(options.themeKey, cache) : String(options.themeKey || '');
    if (!cache[resolvedId]) {
      const url = options.getThemeJsonUrlFn ? options.getThemeJsonUrlFn(resolvedId) : null;
      if (url) {
        try {
          const response = await options.fetchFn(url, { cache: 'no-store' });
          if (response.ok) {
            const json = await response.json() as ThemeJsonLike;
            cache[resolvedId] = json;
            const monacoTheme = options.toMonacoThemeFn(resolvedId, json);
            options.win.monaco.editor?.defineTheme?.(resolvedId, monacoTheme as Record<string, unknown>);
          }
        } catch (_) {}
      }
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
    if (cache[resolvedId]) {
      if (typeof options.applyThemeToTextmateRegistryFn === 'function') options.applyThemeToTextmateRegistryFn(cache[resolvedId]);
      return cache[resolvedId];
    }
    return null;
  } catch (error) {
    console.warn('[Monaco] applyMonacoTheme failed', error);
    return null;
  }
}
