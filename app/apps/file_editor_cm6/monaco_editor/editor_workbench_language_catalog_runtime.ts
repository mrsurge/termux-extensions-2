interface MonacoLanguageRegistryLike {
  register?(language: Record<string, unknown>): void;
}

interface MonacoLike {
  languages?: MonacoLanguageRegistryLike;
}

interface WindowWithWorkbenchLanguageCatalog extends Window {
  monaco?: MonacoLike;
}

interface EditorWorkbenchLanguageCatalogRuntimeDeps {
  getWindow(): WindowWithWorkbenchLanguageCatalog;
  fetchLanguageCatalog(): Promise<unknown>;
  normalizeLanguage(languageId: unknown): string;
  registerVscodeLanguageId(monacoRef: unknown, languageIds: Set<string>, langId: string, language: Record<string, unknown>): void;
  mapVscodeLanguageExtensions(target: Map<string, string>, extensions: unknown, langId: string): void;
  mapVscodeLanguageFilenames(target: Map<string, string>, filenames: unknown, langId: string): void;
  applyVscodeLanguageConfiguration(monacoRef: unknown, langId: string, rawConfig: unknown, parseJsoncFn: (value: string) => unknown): void;
  installVscodeLanguagesLoop(
    languages: unknown[],
    normalizeLanguageFn: (value: unknown) => string,
    onLanguage: (language: Record<string, unknown>, langId: string) => void,
  ): void;
  finalizeVscodeLanguagesInstall(
    languages: unknown[],
    byExtension: Map<string, string>,
    byFilename: Map<string, string>,
    installLanguageBridgeProviders: () => void,
  ): void;
  installWorkbenchLanguageBridgeProviders(): void;
  parseJsonc(value: string): unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractLanguagesPayload(value: unknown): unknown[] | null {
  const record = asRecord(value);
  if (!record) return null;
  if (Array.isArray(record.languages)) return record.languages;
  const inner = asRecord(record.result);
  if (inner && Array.isArray(inner.languages)) return inner.languages;
  return null;
}

export function createEditorWorkbenchLanguageCatalogRuntime(
  deps: EditorWorkbenchLanguageCatalogRuntimeDeps,
): {
  ensureWorkbenchLanguageCatalogInstalled(): Promise<boolean>;
  getLanguageIds(): Set<string>;
  getLanguageByExtension(): Map<string, string>;
  getLanguageByFilename(): Map<string, string>;
} {
  let languageCatalogInstalled = false;
  let languageCatalogInflight: Promise<boolean> | null = null;
  const languageIds = new Set<string>();
  const languageByExtension = new Map<string, string>();
  const languageByFilename = new Map<string, string>();

  async function ensureWorkbenchLanguageCatalogInstalled(): Promise<boolean> {
    const win = deps.getWindow();
    if (languageCatalogInstalled) return true;
    if (languageCatalogInflight) return languageCatalogInflight;
    if (!win.monaco || !win.monaco.languages) return false;

    languageCatalogInflight = (async () => {
      try {
        const response = await deps.fetchLanguageCatalog();
        const languages = extractLanguagesPayload(response);
        if (!Array.isArray(languages) || !languages.length) return false;

        languageByExtension.clear();
        languageByFilename.clear();
        deps.installVscodeLanguagesLoop(languages, deps.normalizeLanguage, (language, langId) => {
          deps.registerVscodeLanguageId(win.monaco, languageIds, langId, language);
          deps.mapVscodeLanguageExtensions(languageByExtension, language.extensions, langId);
          deps.mapVscodeLanguageFilenames(languageByFilename, language.filenames, langId);
          deps.applyVscodeLanguageConfiguration(win.monaco, langId, language.configuration_raw, deps.parseJsonc);
        });

        languageCatalogInstalled = true;
        deps.finalizeVscodeLanguagesInstall(
          languages,
          languageByExtension,
          languageByFilename,
          deps.installWorkbenchLanguageBridgeProviders,
        );
        return true;
      } catch (error) {
        console.warn('[Workbench][Languages] catalog install failed', error);
        return false;
      } finally {
        languageCatalogInflight = null;
      }
    })();

    return languageCatalogInflight;
  }

  return {
    ensureWorkbenchLanguageCatalogInstalled,
    getLanguageIds: () => languageIds,
    getLanguageByExtension: () => languageByExtension,
    getLanguageByFilename: () => languageByFilename,
  };
}
