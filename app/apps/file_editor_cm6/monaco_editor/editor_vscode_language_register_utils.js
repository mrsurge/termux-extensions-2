export function registerVscodeLanguageId(monacoRef, knownIdsSet, langId, langDef) {
  try {
    if (knownIdsSet.has(langId)) return;
    try {
      monacoRef.languages.register({
        id: langId,
        aliases: Array.isArray(langDef.aliases) ? langDef.aliases : undefined,
        extensions: Array.isArray(langDef.extensions) ? langDef.extensions : undefined,
        filenames: Array.isArray(langDef.filenames) ? langDef.filenames : undefined,
        mimetypes: Array.isArray(langDef.mimetypes) ? langDef.mimetypes : undefined,
      });
    } catch (_) {}
    knownIdsSet.add(langId);
  } catch (_) {}
}
