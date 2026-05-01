export function applyVscodeLanguageConfiguration(
  monacoRef: MonacoRuntimeGlobal | null | undefined,
  langId: string,
  configurationRaw: unknown,
  parseJsoncFn: (text: string) => unknown,
): void {
  try {
    if (!configurationRaw || !monacoRef || !monacoRef.languages || !monacoRef.languages.setLanguageConfiguration) return;
    const config = parseJsoncFn(String(configurationRaw));
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      try { monacoRef.languages.setLanguageConfiguration(langId, config as Record<string, unknown>); } catch (_) {}
    }
  } catch (error) {
    console.warn('[VSIX][Languages] config parse failed', langId, error);
  }
}
