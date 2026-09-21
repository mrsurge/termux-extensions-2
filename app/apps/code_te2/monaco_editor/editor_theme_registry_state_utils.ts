import { parseThemeCatalog, type RequestThemeCatalog, type ThemeCatalogEntry } from '../src/theme_catalog.ts';

export type ThemeRegistry = Record<string, ThemeCatalogEntry>;

export interface ThemeRegistryState {
  registry?: ThemeRegistry | null;
  promise?: Promise<ThemeRegistry> | null;
}

export function createDocumentThemeGate(
  waitUntilConnected: () => Promise<void>,
  applyTheme: (theme: string) => Promise<void>,
) {
  let selectedTheme = 'github-dark';
  let appliedTheme: string | null = null;
  let pending: Promise<void> | null = null;
  // Model consumers share this barrier. A later preference supersedes an older
  // in-flight choice; no waiter may release until the latest choice is applied.
  return {
    async apply(theme: string): Promise<void> {
      selectedTheme = theme || 'github-dark';
      while (pending || appliedTheme !== selectedTheme) {
        if (!pending) {
          pending = Promise.resolve().then(async () => {
            await waitUntilConnected();
            while (appliedTheme !== selectedTheme) {
              const next = selectedTheme;
              await applyTheme(next);
              appliedTheme = next;
            }
          }).finally(() => { pending = null; });
        }
        await pending;
      }
    },
  };
}

export async function ensureThemeRegistryState(
  state: ThemeRegistryState,
  requestCatalog: RequestThemeCatalog,
): Promise<ThemeRegistry> {
  if (state.registry) return state.registry;
  if (state.promise) return state.promise;
  // Share only successful metadata. A disconnected/failed RPC is not an empty
  // catalog and must remain retryable after the surface reconnects.
  const pending = Promise.resolve().then(requestCatalog).then((reply) => {
    const { themes } = parseThemeCatalog(reply);
    const registry: ThemeRegistry = Object.create(null);
    for (const theme of themes) registry[theme.id] = theme;
    state.registry = registry;
    return registry;
  });
  state.promise = pending;
  try {
    return await pending;
  } finally {
    if (state.promise === pending) state.promise = null;
  }
}
