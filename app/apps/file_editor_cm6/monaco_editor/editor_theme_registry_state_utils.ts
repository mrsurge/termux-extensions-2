interface ThemeRegistryEntryLike {
  id?: string;
  serveUrl?: string;
}

type ThemeRegistryLike = Record<string, ThemeRegistryEntryLike>;

interface ThemeRegistryStateLike {
  registry?: unknown;
  promise?: Promise<unknown> | null;
}

export async function ensureThemeRegistryState(
  state: ThemeRegistryStateLike,
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>,
  buildUiUrlFn: (apiBase: string, path: string) => string,
  apiBase: string,
): Promise<ThemeRegistryLike> {
  if (state && state.registry) return state.registry as ThemeRegistryLike;
  if (state && state.promise) return state.promise as Promise<ThemeRegistryLike>;
  state.promise = (async function (): Promise<ThemeRegistryLike> {
    try {
      const response = await fetchFn(buildUiUrlFn(apiBase, 'monaco_editor/available_themes'), { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json() as { themes?: ThemeRegistryEntryLike[] };
      const themes = data && Array.isArray(data.themes) ? data.themes : [];
      const registry: ThemeRegistryLike = {};
      for (let index = 0; index < themes.length; index += 1) {
        const theme = themes[index];
        if (theme && theme.id && theme.serveUrl) registry[theme.id] = theme;
      }
      state.registry = registry;
      return registry;
    } catch (error) {
      console.warn('[MonacoTheme] _ensureThemeRegistry failed', error);
      state.registry = {};
      return state.registry as ThemeRegistryLike;
    } finally {
      state.promise = null;
    }
  })();
  return state.promise as Promise<ThemeRegistryLike>;
}
