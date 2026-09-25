import type * as Monaco from '../../../static/vendor/monaco-editor-core/esm/vs/editor/editor.api';
import { buildMonacoOptionsFromPrefsState } from './editor_monaco_options_utils.ts';
import { ensureThemeRegistryState } from './editor_theme_registry_state_utils.ts';
import { getVscodeThemeJsonUrl, themeJsonWithUiTheme } from './editor_theme_url_utils.ts';
import { vscodeThemeToMonacoTheme } from './editor_theme_convert_utils.ts';
import { monacoThemeName } from './editor_theme_name_utils.ts';
import type { RequestThemeCatalog } from '../src/theme_catalog.ts';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function historicalAppearance(preferences: unknown) {
  const outer = record(preferences);
  const bag = record(outer.preferences ?? outer);
  const editor = { fontScale: 0.85, ...record(bag.editor ?? bag) };
  const options = buildMonacoOptionsFromPrefsState({ editor }, null);
  const cursorStyle = options.cursorStyle === 'block' || options.cursorStyle === 'block-outline'
    ? options.cursorStyle
    : 'line';
  // Appearance is an allowlist: preferences cannot enable writes or providers.
  const appearance: Monaco.editor.IEditorOptions = {
    fontSize: Number(options.fontSize), fontFamily: String(options.fontFamily),
    fontLigatures: true, lineNumbers: options.lineNumbers === 'off' ? 'off' : 'on',
    cursorStyle,
    wordWrap: options.wordWrap === 'on' ? 'on' : 'off',
  };
  const selected = record(editor).theme;
  return { appearance, theme: typeof selected === 'string' && selected ? selected : 'github-dark-default' };
}

/** Theme fetches are asynchronous; only the newest live view may publish them. */
export function createHistoricalThemeApplier(
  monaco: Pick<typeof Monaco, 'editor'>, signal: AbortSignal,
  requestCatalog: RequestThemeCatalog,
  fetchTheme: typeof fetch = (...args) => fetch(...args),
) {
  const registry = {};
  let revision = 0;
  let current = '';
  const themes = new Map<string, Promise<Monaco.editor.IStandaloneThemeData>>();
  const setRootTheme = (base: string): void => {
    document.documentElement.classList.remove('vs', 'vs-dark', 'hc-black', 'hc-light');
    document.documentElement.classList.add(base === 'vs' || base === 'hc-light' ? 'vs' : 'vs-dark');
    if (base === 'hc-black' || base === 'hc-light') document.documentElement.classList.add(base);
  };
  return async (theme: string): Promise<void> => {
    const epoch = ++revision;
    if (signal.aborted || current === theme) return;
    if (['vs', 'vs-dark', 'hc-black', 'hc-light'].includes(theme)) {
      monaco.editor.setTheme(theme);
      setRootTheme(theme);
      current = theme;
      return;
    }
    let pending = themes.get(theme);
    if (!pending) {
      pending = (async () => {
        const entries = await ensureThemeRegistryState(registry, requestCatalog);
        const url = getVscodeThemeJsonUrl(theme, entries, '/api/app/code_te2');
        if (!url) throw new Error(`Historical theme unavailable: ${theme}`);
        const response = await fetchTheme(url);
        if (!response.ok) throw new Error(`Historical theme failed: ${response.status}`);
        const value: unknown = await response.json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid historical theme: ${theme}`);
        const json = themeJsonWithUiTheme(value as Record<string, unknown>, entries[theme]?.uiTheme);
        // The existing converter produces Monaco theme data with opaque rule declarations.
        return vscodeThemeToMonacoTheme(theme, json) as Monaco.editor.IStandaloneThemeData;
      })();
      themes.set(theme, pending);
      void pending.catch(() => { themes.delete(theme); });
    }
    const data = await pending;
    if (signal.aborted || epoch !== revision) return;
    monaco.editor.defineTheme(monacoThemeName(theme), data);
    monaco.editor.setTheme(monacoThemeName(theme));
    setRootTheme(data.base);
    current = theme;
  };
}
