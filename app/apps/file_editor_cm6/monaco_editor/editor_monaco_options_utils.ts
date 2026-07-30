import { resolveMonacoThemeId } from './editor_theme_resolver_utils.ts';

interface EditorPreferenceBag {
  showLineNumbers?: boolean;
  wordWrap?: boolean;
  readOnly?: boolean;
  showMinimap?: boolean;
  showIndentGuides?: boolean;
  autoCloseBrackets?: boolean;
  autocompletion?: boolean;
  showInlayHints?: boolean;
  fontScale?: number;
  fontFamily?: string;
  theme?: string;
}

interface EditorPrefsStateLike {
  preferences?: { editor?: EditorPreferenceBag };
  editor?: EditorPreferenceBag;
  showLineNumbers?: boolean;
  wordWrap?: boolean;
  readOnly?: boolean;
  showMinimap?: boolean;
  showIndentGuides?: boolean;
  autoCloseBrackets?: boolean;
  autocompletion?: boolean;
  showInlayHints?: boolean;
  fontScale?: number;
  fontFamily?: string;
  theme?: string;
}

export function buildMonacoOptionsFromPrefsState(
  state: unknown,
  jsonCache: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const stateValue = state as EditorPrefsStateLike | null | undefined;
  let prefs: EditorPrefsStateLike | null = null;
  try { prefs = stateValue && stateValue.preferences ? stateValue.preferences.editor ? stateValue : stateValue.preferences : stateValue || null; } catch (_) { prefs = stateValue || null; }
  let editorPrefs: EditorPreferenceBag | null = null;
  try {
    editorPrefs = prefs && prefs.editor
      ? prefs.editor
      : (prefs && prefs.preferences && prefs.preferences.editor ? prefs.preferences.editor : null);
  } catch (_) { editorPrefs = null; }
  try {
    if (!editorPrefs && prefs && typeof prefs.showLineNumbers === 'boolean') editorPrefs = prefs;
    if (!editorPrefs && stateValue && typeof stateValue.showLineNumbers === 'boolean') editorPrefs = stateValue;
    if (!editorPrefs) editorPrefs = {};
  } catch (_) { editorPrefs = editorPrefs || {}; }

  let showLineNumbers = true;
  try { if (typeof editorPrefs.showLineNumbers === 'boolean') showLineNumbers = editorPrefs.showLineNumbers; } catch (_) {}
  let wordWrap = false;
  try { if (typeof editorPrefs.wordWrap === 'boolean') wordWrap = editorPrefs.wordWrap; } catch (_) {}
  let readOnly = false;
  try { if (typeof editorPrefs.readOnly === 'boolean') readOnly = editorPrefs.readOnly; } catch (_) {}
  let showMinimap = true;
  try { if (typeof editorPrefs.showMinimap === 'boolean') showMinimap = editorPrefs.showMinimap; } catch (_) {}
  let showIndentGuides = true;
  try { if (typeof editorPrefs.showIndentGuides === 'boolean') showIndentGuides = editorPrefs.showIndentGuides; } catch (_) {}
  let autoCloseBrackets = true;
  try { if (typeof editorPrefs.autoCloseBrackets === 'boolean') autoCloseBrackets = editorPrefs.autoCloseBrackets; } catch (_) {}
  let autocompletion = true;
  try { if (typeof editorPrefs.autocompletion === 'boolean') autocompletion = editorPrefs.autocompletion; } catch (_) {}
  let showInlayHints = true;
  try { if (typeof editorPrefs.showInlayHints === 'boolean') showInlayHints = editorPrefs.showInlayHints; } catch (_) {}

  let fontSize = 14;
  try {
    if (typeof editorPrefs.fontScale === 'number' && Number.isFinite(editorPrefs.fontScale)) {
      const scale = editorPrefs.fontScale;
      if (scale > 0 && scale < 10) fontSize = Math.round(14 * scale);
      else if (scale >= 10 && scale <= 48) fontSize = Math.round(scale);
    }
  } catch (_) {}

  let fontFamily = "'JetBrains Mono Nerd', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  try {
    if (typeof editorPrefs.fontFamily === 'string' && editorPrefs.fontFamily.trim()) {
      fontFamily = editorPrefs.fontFamily.trim();
    }
  } catch (_) {}

  let rawThemeKey = '';
  try { rawThemeKey = String(editorPrefs.theme || ''); } catch (_) { rawThemeKey = ''; }
  let theme = 'vs-dark';
  try {
    if (rawThemeKey && rawThemeKey.toLowerCase().startsWith('vscode:')) theme = 'vs-dark';
    else theme = resolveMonacoThemeId(rawThemeKey, jsonCache || {});
  } catch (_) {
    theme = 'vs-dark';
  }

  return {
    value: '',
    language: 'plaintext',
    theme,
    'semanticHighlighting.enabled': true,
    automaticLayout: true,
    contextmenu: false,
    readOnly,
    lineNumbers: showLineNumbers ? 'on' : 'off',
    showFoldingControls: 'always',
    wordWrap: wordWrap ? 'on' : 'off',
    minimap: { enabled: !!showMinimap },
    renderIndentGuides: !!showIndentGuides,
    autoClosingBrackets: autoCloseBrackets ? 'always' : 'never',
    quickSuggestions: autocompletion ? { other: true, comments: true, strings: true } : false,
    suggestOnTriggerCharacters: !!autocompletion,
    wordBasedSuggestions: 'off',
    parameterHints: { enabled: !!autocompletion },
    inlayHints: { enabled: showInlayHints ? 'on' : 'off' },
    tabCompletion: autocompletion ? 'on' : 'off',
    fontSize,
    fontFamily,
    fontLigatures: true,
  };
}
