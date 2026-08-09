export function resetVscodeLanguageMatchers(
  extensionMap: Map<string, string>,
  filenameMap: Map<string, string>,
): void {
  try { extensionMap.clear(); } catch (_) {}
  try { filenameMap.clear(); } catch (_) {}
}
