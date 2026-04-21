interface MonacoEditorNamespaceLike {
  setModelLanguage?(model: unknown, languageId: string): void;
}

interface MonacoWindowLike extends Window {
  monaco?: {
    editor?: MonacoEditorNamespaceLike;
  };
}

interface EditorModelLanguageRuntimeDeps {
  getWindow(): MonacoWindowLike;
  normalizeLanguage(languageId: unknown): string;
  languageFromPath(path: string): string;
  ensureVscodeLanguagesInstalled(): Promise<boolean>;
  ensureTextmateTokenization(languageId: string, filePath: string): Promise<boolean>;
  installVscodeApiLanguageBridgeProviders(): void;
}

export function applyLanguageToModelRuntime(
  deps: EditorModelLanguageRuntimeDeps,
  nextModel: unknown,
  languageId: unknown,
  filePath: string,
): void {
  try {
    const win = deps.getWindow();
    if (!nextModel || !win.monaco || !win.monaco.editor || typeof win.monaco.editor.setModelLanguage !== 'function') return;
    let lang = deps.normalizeLanguage(languageId);
    if ((!lang || lang === 'plaintext') && filePath) lang = deps.languageFromPath(filePath);

    try { win.monaco.editor.setModelLanguage(nextModel, lang); } catch (_) {}

    Promise.resolve()
      .then(() => deps.ensureVscodeLanguagesInstalled())
      .then(() => {
        try {
          if (filePath) {
            const resolved = deps.normalizeLanguage(deps.languageFromPath(filePath));
            if (resolved && resolved !== lang) {
              lang = resolved;
              try { win.monaco!.editor!.setModelLanguage!(nextModel, lang); } catch (_) {}
            }
          }
        } catch (_) {}
        return deps.ensureTextmateTokenization(lang, filePath);
      })
      .then((ok) => {
        if (!ok) return;
        try { win.monaco!.editor!.setModelLanguage!(nextModel, lang); } catch (_) {}
        try { deps.installVscodeApiLanguageBridgeProviders(); } catch (_) {}
      })
      .catch(() => {});
  } catch (_) {}
}
