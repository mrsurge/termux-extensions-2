import { isUnknownArray } from '../src/rpc/value-types.ts';
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
          aliases: isUnknownArray(langDef.aliases) ? langDef.aliases : undefined,
          extensions: isUnknownArray(langDef.extensions) ? langDef.extensions : undefined,
          filenames: isUnknownArray(langDef.filenames) ? langDef.filenames : undefined,
          mimetypes: isUnknownArray(langDef.mimetypes) ? langDef.mimetypes : undefined,
        });
      } catch (_) {}
    }
    knownIdsSet.add(langId);
  } catch (_) {}
}
