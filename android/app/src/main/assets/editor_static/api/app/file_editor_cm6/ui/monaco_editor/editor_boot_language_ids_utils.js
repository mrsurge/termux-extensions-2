export function collectBootLanguageIds(monacoRef) {
  if (!(monacoRef && monacoRef.languages && monacoRef.languages.getLanguages)) return [];
  return monacoRef.languages.getLanguages().map(function(l){ return l && l.id; }).filter(Boolean);
}
