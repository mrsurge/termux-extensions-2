export function finalizeVscodeLanguagesInstall(
  langs: unknown[],
  extensionMap: Map<string, string>,
  filenameMap: Map<string, string>,
  installBridgeProvidersFn: () => void,
): void {
  try { installBridgeProvidersFn(); } catch (_) {}
  console.log('[VSIX][Languages] installed', langs.length, 'ext=', extensionMap.size, 'files=', filenameMap.size);
}
