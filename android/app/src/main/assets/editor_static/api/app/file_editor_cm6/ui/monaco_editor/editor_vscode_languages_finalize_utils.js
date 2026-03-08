export function finalizeVscodeLanguagesInstall(langs, extensionMap, filenameMap, installBridgeProvidersFn) {
  try { installBridgeProvidersFn(); } catch (_) {}
  console.log('[VSIX][Languages] installed', langs.length, 'ext=', extensionMap.size, 'files=', filenameMap.size);
}
