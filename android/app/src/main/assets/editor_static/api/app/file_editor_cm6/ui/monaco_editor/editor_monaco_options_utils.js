import { resolveMonacoThemeId } from './editor_theme_resolver_utils.js';

export function buildMonacoOptionsFromPrefsState(state, jsonCache) {
  var prefs = null;
  try { prefs = state && state.preferences ? state.preferences : state; } catch (_) {}
  var editorPrefs = null;
  try { editorPrefs = prefs && prefs.editor ? prefs.editor : (prefs && prefs.preferences && prefs.preferences.editor ? prefs.preferences.editor : null); } catch (_) {}
  try {
    if (!editorPrefs && prefs && typeof prefs.showLineNumbers === 'boolean') editorPrefs = prefs;
    if (!editorPrefs && state && typeof state.showLineNumbers === 'boolean') editorPrefs = state;
    if (!editorPrefs) editorPrefs = {};
  } catch (_) { editorPrefs = editorPrefs || {}; }

  var showLineNumbers = true;
  try { if (typeof editorPrefs.showLineNumbers === 'boolean') showLineNumbers = editorPrefs.showLineNumbers; } catch (_) {}

  var wordWrap = false;
  try { if (typeof editorPrefs.wordWrap === 'boolean') wordWrap = editorPrefs.wordWrap; } catch (_) {}

  var readOnly = false;
  try { if (typeof editorPrefs.readOnly === 'boolean') readOnly = editorPrefs.readOnly; } catch (_) {}

  var showMinimap = true;
  try { if (typeof editorPrefs.showMinimap === 'boolean') showMinimap = editorPrefs.showMinimap; } catch (_) {}

  var showIndentGuides = true;
  try { if (typeof editorPrefs.showIndentGuides === 'boolean') showIndentGuides = editorPrefs.showIndentGuides; } catch (_) {}

  var autoCloseBrackets = true;
  try { if (typeof editorPrefs.autoCloseBrackets === 'boolean') autoCloseBrackets = editorPrefs.autoCloseBrackets; } catch (_) {}

  var autocompletion = true;
  try { if (typeof editorPrefs.autocompletion === 'boolean') autocompletion = editorPrefs.autocompletion; } catch (_) {}

  var fontSize = 14;
  try {
    if (typeof editorPrefs.fontScale === 'number' && isFinite(editorPrefs.fontScale)) {
      var s = editorPrefs.fontScale;
      if (s > 0 && s < 10) fontSize = Math.round(14 * s);
      else if (s >= 10 && s <= 48) fontSize = Math.round(s);
    }
  } catch (_) {}

  var fontFamily = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  try {
    if (typeof editorPrefs.fontFamily === 'string' && editorPrefs.fontFamily.trim()) {
      fontFamily = editorPrefs.fontFamily.trim();
    }
  } catch (_) {}

  var rawThemeKey = '';
  try { rawThemeKey = String(editorPrefs.theme || ''); } catch (_) { rawThemeKey = ''; }
  var theme = 'vs-dark';
  try {
    if (rawThemeKey && rawThemeKey.toLowerCase().startsWith('vscode:')) {
      theme = 'vs-dark';
    } else {
      theme = resolveMonacoThemeId(rawThemeKey, jsonCache || {});
    }
  } catch (_) {
    theme = 'vs-dark';
  }

  return {
    value: '',
    language: 'plaintext',
    theme: theme,
    'semanticHighlighting.enabled': true,
    automaticLayout: true,
    contextmenu: false,
    readOnly: readOnly,
    lineNumbers: showLineNumbers ? 'on' : 'off',
    showFoldingControls: 'always',
    wordWrap: wordWrap ? 'on' : 'off',
    minimap: { enabled: !!showMinimap },
    renderIndentGuides: !!showIndentGuides,
    autoClosingBrackets: autoCloseBrackets ? 'always' : 'never',
    quickSuggestions: autocompletion ? { other: true, comments: true, strings: true } : false,
    suggestOnTriggerCharacters: !!autocompletion,
    wordBasedSuggestions: autocompletion ? 'currentDocument' : 'off',
    parameterHints: { enabled: !!autocompletion },
    tabCompletion: autocompletion ? 'on' : 'off',
    fontSize: fontSize,
    fontFamily: fontFamily,
  };
}
