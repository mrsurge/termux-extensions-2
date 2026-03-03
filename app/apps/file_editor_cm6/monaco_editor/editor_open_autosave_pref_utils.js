export function resolveAutoSaveFromPrefs(cachedPrefs) {
  var autoSave = null;
  try {
    var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
    autoSave = prefs && prefs.editor && typeof prefs.editor.autoSave === 'boolean' ? prefs.editor.autoSave : null;
  } catch (_) {}
  return autoSave;
}
