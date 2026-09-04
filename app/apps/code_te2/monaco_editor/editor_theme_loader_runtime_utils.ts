interface ThemeRegistryEntryLike {
  id?: string;
  serveUrl?: string;
}

interface ThemeLoaderStateLike {
  done?: boolean;
  promise?: Promise<void> | null;
  jsonCache?: Record<string, unknown>;
}

interface ThemeLoaderRuntimeOptions {
  win?: Window | null;
  state: ThemeLoaderStateLike;
  ensureThemeRegistryFn(): Promise<Record<string, ThemeRegistryEntryLike>>;
  getThemeJsonUrlFn(themeId: string): string | null;
  fetchFn(input: string, init?: RequestInit): Promise<Response>;
  toMonacoThemeFn(themeId: string, json: unknown): { rules?: unknown[] };
}

export async function loadVscodeTextmateThemesRuntime(opts: ThemeLoaderRuntimeOptions): Promise<void> {
  const options = opts || { state: {} } as ThemeLoaderRuntimeOptions;
  if (options.state && options.state.done) return;
  const monacoEditor = options.win?.monaco?.editor;
  if (!monacoEditor || !monacoEditor.defineTheme) return;
  const defineTheme = monacoEditor.defineTheme.bind(monacoEditor);
  if (options.state && options.state.promise) return options.state.promise;
  options.state.promise = (async () => {
    if (!options.state.jsonCache) options.state.jsonCache = {};
    const registry = await options.ensureThemeRegistryFn();
    let themeIds = Object.keys(registry || {});
    if (!themeIds.length) themeIds = ['github-dark', 'github-light-default'];
    for (let index = 0; index < themeIds.length; index += 1) {
      const id = themeIds[index];
      const url = options.getThemeJsonUrlFn(id);
      if (!url) continue;
      try {
        const response = await options.fetchFn(url, { cache: 'no-store' });
        if (!response.ok) {
          console.warn('[MonacoTheme] missing vscode theme', id, response.status);
          continue;
        }
        const json = await response.json();
        options.state.jsonCache[id] = json;
        const monacoTheme = options.toMonacoThemeFn(id, json);
        defineTheme(id, monacoTheme as Record<string, unknown>);
        console.log('[MonacoTheme] loaded vscode theme', id, 'rules=', Array.isArray(monacoTheme.rules) ? monacoTheme.rules.length : 0);
      } catch (error) {
        console.warn('[MonacoTheme] failed vscode theme', id, error);
      }
    }
    options.state.done = true;
  })();
  return options.state.promise;
}
