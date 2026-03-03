export function applyActiveModelLanguage(windowRef, model, currentPath, applyLanguageToModelFn, languageFromPathFn) {
  if (windowRef.monaco && model && currentPath) {
    applyLanguageToModelFn(model, languageFromPathFn(currentPath), currentPath);
  }
}
