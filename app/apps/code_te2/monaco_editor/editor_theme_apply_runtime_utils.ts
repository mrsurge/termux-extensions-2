import { monacoThemeName } from './editor_theme_name_utils.ts';
import { themeJsonWithUiTheme } from './editor_theme_url_utils.ts';

interface ThemeJsonLike extends Record<string, unknown> {
  uiTheme?: string;
}

interface ApplyMonacoThemeRuntimeOptions {
  win?: Window | null;
  doc: Document;
  ensureTe2DiffThemeFn?: () => unknown;
  getSelectedThemeFn(): Promise<unknown>;
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
    // The backend projects the selected theme; the renderer only translates it.
    const selected = await options.getSelectedThemeFn();
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)) throw new Error('Invalid selected theme projection');
    const selection = selected as Record<string, unknown>;
    const resolvedId = selection.id;
    const source = selection.theme;
    if (typeof resolvedId !== 'string' || !resolvedId || !source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('Invalid selected theme projection');
    }
    if (typeof selection.uiTheme !== 'string') throw new Error('Invalid selected theme base');
    const cache = options.getJsonCacheFn ? (options.getJsonCacheFn() || {}) : {};
    const json = themeJsonWithUiTheme(source as ThemeJsonLike, selection.uiTheme);
    const monacoTheme = options.toMonacoThemeFn(resolvedId, json);
    options.win.monaco.editor.defineTheme?.(monacoThemeName(resolvedId), monacoTheme as Record<string, unknown>);
    cache[resolvedId] = json;
    if (options.setJsonCacheFn) options.setJsonCacheFn(cache);
    options.win.monaco.editor.setTheme(monacoThemeName(resolvedId));
    try {
      options.doc.documentElement.classList.remove('vs', 'vs-dark', 'hc-black', 'hc-light');
      const themeBase = (cache[resolvedId] && cache[resolvedId].uiTheme) || '';
      const scheme = themeBase ? (themeBase.includes('light') || themeBase === 'vs' ? 'vs' : 'vs-dark')
        : resolvedId.toLowerCase().includes('light') ? 'vs' : 'vs-dark';
      options.doc.documentElement.classList.add(scheme);
      if (themeBase === 'hc-black' || themeBase === 'hc-light') options.doc.documentElement.classList.add(themeBase);
      console.log('[touch-theme] html class set to', scheme, 'for theme', resolvedId);
    } catch (_) {}
    if (typeof options.applyThemeToTextmateRegistryFn === 'function') options.applyThemeToTextmateRegistryFn(cache[resolvedId]);
    return cache[resolvedId];
  } catch (error) {
    console.warn('[Monaco] applyMonacoTheme failed', error);
    throw error;
  }
}
