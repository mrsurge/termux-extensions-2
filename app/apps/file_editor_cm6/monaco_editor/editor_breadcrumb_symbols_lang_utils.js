export function resolveBreadcrumbSymbolsLangId(model, absPath, languageFromPathFn) {
  var langId = (model && model.getLanguageId) ? model.getLanguageId() : '';
  if (!langId) langId = languageFromPathFn(absPath) || '';
  return langId;
}
