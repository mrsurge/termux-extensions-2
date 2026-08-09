import { buildUiUrl } from './editor_common_utils.ts';

const VENDORED_THEME_MAP: Record<string, string> = {
  'github-dark-default': 'dark-default.json',
  'github-light-default': 'light-default.json',
  'github-dark': 'dark.json',
  'github-light': 'light.json',
  'github-dark-dimmed': 'dark-dimmed.json',
  'github-dark-high-contrast': 'dark-high-contrast.json',
  'github-light-high-contrast': 'light-high-contrast.json',
  'github-dark-colorblind-beta': 'dark-colorblind.json',
  'github-light-colorblind-beta': 'light-colorblind.json',
};

interface ThemeRegistryEntryLike {
  serveUrl?: string;
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
  if (VENDORED_THEME_MAP[id]) {
    return buildUiUrl(apiBase, 'monaco_editor/themes/vendored/github/' + VENDORED_THEME_MAP[id]);
  }
  return null;
}
