export function getEditorPrefs(cachedPrefs) {
  return cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
}

export function getBooleanPref(cachedPrefs, key) {
  try {
    var prefs = getEditorPrefs(cachedPrefs);
    if (prefs && prefs.editor && typeof prefs.editor[key] === 'boolean') return prefs.editor[key];
    if (prefs && typeof prefs[key] === 'boolean') return prefs[key];
  } catch (_) {}
  return false;
}
