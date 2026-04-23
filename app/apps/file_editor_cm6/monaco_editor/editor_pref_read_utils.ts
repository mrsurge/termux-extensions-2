type PrefsLike = unknown;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function getEditorPrefs(cachedPrefs: PrefsLike): Record<string, unknown> | null {
  const cachedPrefsRecord = asRecord(cachedPrefs);
  const nestedPrefs = cachedPrefsRecord ? asRecord(cachedPrefsRecord.preferences) : null;
  return nestedPrefs || cachedPrefsRecord;
}

export function getBooleanPref(cachedPrefs: PrefsLike, key: string): boolean {
  try {
    const prefs = getEditorPrefs(cachedPrefs);
    const editorPrefs = prefs && typeof prefs.editor === 'object' && prefs.editor && !Array.isArray(prefs.editor)
      ? prefs.editor as Record<string, unknown>
      : null;
    if (editorPrefs && typeof editorPrefs[key] === 'boolean') return editorPrefs[key] as boolean;
    if (prefs && typeof prefs[key] === 'boolean') return prefs[key] as boolean;
  } catch (_) {}
  return false;
}
