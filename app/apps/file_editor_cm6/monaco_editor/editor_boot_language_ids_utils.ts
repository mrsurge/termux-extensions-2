interface MonacoLanguagesLike {
  getLanguages?(): Array<{ id?: string | null }>;
}

interface MonacoBootLike {
  languages?: MonacoLanguagesLike;
}

function asMonacoBootLike(value: unknown): MonacoBootLike | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as MonacoBootLike
    : null;
}

export function collectBootLanguageIds(monacoRef: unknown): string[] {
  const typedMonacoRef = asMonacoBootLike(monacoRef);
  if (!(typedMonacoRef && typedMonacoRef.languages && typedMonacoRef.languages.getLanguages)) return [];
  return typedMonacoRef.languages.getLanguages().map(function (language) {
    return language && language.id ? language.id : null;
  }).filter((languageId): languageId is string => Boolean(languageId));
}
