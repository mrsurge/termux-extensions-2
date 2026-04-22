interface CachedPrefsLike {
  preferences?: {
    editor?: {
      autoSave?: boolean;
    };
  };
  editor?: {
    autoSave?: boolean;
  };
}

export function resolveAutoSaveFromPrefs(cachedPrefs: unknown): boolean | null {
  let autoSave: boolean | null = null;
  try {
    const prefs = cachedPrefs != null && typeof cachedPrefs === 'object' && !Array.isArray(cachedPrefs)
      ? ((cachedPrefs as CachedPrefsLike).preferences || cachedPrefs as CachedPrefsLike)
      : null;
    autoSave = prefs && prefs.editor && typeof prefs.editor.autoSave === 'boolean' ? prefs.editor.autoSave : null;
  } catch (_) {}
  return autoSave;
}
