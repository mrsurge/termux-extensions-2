export function applyVscodeLanguageConfiguration(monacoRef, langId, configurationRaw, parseJsoncFn) {
  try {
    if (!configurationRaw) return;
    var cfg = parseJsoncFn(String(configurationRaw));
    if (cfg && typeof cfg === 'object') {
      try { monacoRef.languages.setLanguageConfiguration(langId, cfg); } catch (_) {}
    }
  } catch (e) {
    console.warn('[VSIX][Languages] config parse failed', langId, e);
  }
}
