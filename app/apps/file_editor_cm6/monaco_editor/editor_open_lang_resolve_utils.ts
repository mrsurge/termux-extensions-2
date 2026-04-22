export function resolveOpenLanguage(
  preferredLanguage: string | null | undefined,
  absPath: string,
  normalizeLanguageFn: (languageId: string) => string,
  languageFromPathFn: (path: string) => string,
): string {
  let lang = normalizeLanguageFn(preferredLanguage || '');
  if (!lang || lang.indexOf('/') >= 0) lang = languageFromPathFn(absPath);
  return lang;
}
