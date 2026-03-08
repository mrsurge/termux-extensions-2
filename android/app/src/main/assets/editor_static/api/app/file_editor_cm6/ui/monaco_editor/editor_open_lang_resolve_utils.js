export function resolveOpenLanguage(preferredLanguage, absPath, normalizeLanguageFn, languageFromPathFn) {
  var lang = normalizeLanguageFn(preferredLanguage || '');
  if (!lang || lang.indexOf('/') >= 0) lang = languageFromPathFn(absPath);
  return lang;
}
