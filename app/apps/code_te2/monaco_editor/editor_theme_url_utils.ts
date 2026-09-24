import { buildUiUrl } from './editor_common_utils.ts';

interface ThemeRegistryEntryLike {
  serveUrl?: string;
  uiTheme?: string;
}

export function getVscodeThemeUiTheme(themeId: string, themeRegistry: unknown): string | null {
  const registry = themeRegistry as Record<string, ThemeRegistryEntryLike> | null | undefined;
  const value = registry?.[themeId]?.uiTheme;
  return typeof value === 'string' ? value : null;
}

export function themeJsonWithUiTheme<T extends Record<string, unknown>>(
  json: T,
  uiTheme: string | null | undefined,
): T {
  return uiTheme ? { ...json, uiTheme } : json;
}

export function getVscodeThemeJsonUrl(
  themeId: string,
  themeRegistry: unknown,
  apiBase: string,
): string | null {
  const registry = themeRegistry as Record<string, ThemeRegistryEntryLike> | null | undefined;
  const id = String(themeId || '');
  if (registry && registry[id] && registry[id].serveUrl) {
    return buildUiUrl(apiBase, registry[id].serveUrl || '');
  }
  return null;
}
