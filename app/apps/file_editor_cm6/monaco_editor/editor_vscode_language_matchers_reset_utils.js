export function resetVscodeLanguageMatchers(extensionMap, filenameMap) {
  try { extensionMap.clear(); } catch (_) {}
  try { filenameMap.clear(); } catch (_) {}
}
