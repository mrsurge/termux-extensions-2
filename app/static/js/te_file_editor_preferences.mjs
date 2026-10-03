const KEY = 'te2:file-editor:preferences:v1';
export function createEditorPreferences({ storage, themes }) {
  function normalize(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
      showLineNumbers: typeof input.showLineNumbers === 'boolean' ? input.showLineNumbers : true,
      showLineShading: typeof input.showLineShading === 'boolean' ? input.showLineShading : false,
      showSyntaxHighlight: typeof input.showSyntaxHighlight === 'boolean' ? input.showSyntaxHighlight : true,
      wordWrap: typeof input.wordWrap === 'boolean' ? input.wordWrap : false,
      theme: typeof input.theme === 'string' && themes[input.theme] ? input.theme : 'cm6-dark',
    };
  }
  return {
    load(seed) {
      try {
        const raw = storage()?.getItem(KEY);
        return normalize(raw == null ? seed : JSON.parse(raw));
      } catch { return normalize(seed); }
    },
    save(value) {
      const prefs = normalize(value);
      try { storage()?.setItem(KEY, JSON.stringify(prefs)); } catch { /* unavailable storage */ }
      return prefs;
    },
  };
}
