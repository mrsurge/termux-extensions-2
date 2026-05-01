interface VscodeLanguageDefinitionLike {
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  mimetypes?: string[];
}

export function registerVscodeLanguageId(
  monacoRef: MonacoRuntimeGlobal | null | undefined,
  knownIdsSet: Set<string>,
  langId: string,
  langDef: VscodeLanguageDefinitionLike,
): void {
  try {
    if (knownIdsSet.has(langId)) return;
    if (monacoRef && monacoRef.languages && monacoRef.languages.register) {
      try {
        monacoRef.languages.register({
          id: langId,
          aliases: Array.isArray(langDef.aliases) ? langDef.aliases : undefined,
          extensions: Array.isArray(langDef.extensions) ? langDef.extensions : undefined,
          filenames: Array.isArray(langDef.filenames) ? langDef.filenames : undefined,
          mimetypes: Array.isArray(langDef.mimetypes) ? langDef.mimetypes : undefined,
        });
      } catch (_) {}
    }
    knownIdsSet.add(langId);
  } catch (_) {}
}
