export function installVscodeLanguagesLoop(
  langs: unknown[],
  normalizeLanguageFn: (languageId: unknown) => string,
  onLanguageFn: (language: Record<string, unknown>, normalizedLanguageId: string) => void,
): void {
  for (let index = 0; index < langs.length; index += 1) {
    const language = langs[index] as Record<string, unknown> | null;
    if (!language || typeof language.id !== 'string' || !language.id) continue;
    const langId = normalizeLanguageFn(language.id);
    if (!langId) continue;
    onLanguageFn(language, langId);
  }
}
