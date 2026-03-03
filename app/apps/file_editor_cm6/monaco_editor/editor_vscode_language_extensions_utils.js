export function mapVscodeLanguageExtensions(extensionMap, extensions, langId) {
  try {
    if (!Array.isArray(extensions)) return;
    for (var j = 0; j < extensions.length; j++) {
      var ext = String(extensions[j] || '').trim();
      if (!ext) continue;
      extensionMap.set(ext, langId);
    }
  } catch (_) {}
}
