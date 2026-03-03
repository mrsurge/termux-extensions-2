export function mapVscodeLanguageFilenames(filenameMap, filenames, langId) {
  try {
    if (!Array.isArray(filenames)) return;
    for (var j = 0; j < filenames.length; j++) {
      var name = String(filenames[j] || '').trim();
      if (!name) continue;
      filenameMap.set(name, langId);
    }
  } catch (_) {}
}
