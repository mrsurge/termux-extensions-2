interface MonacoEditorNamespaceLike {
  setModelLanguage?(model: unknown, languageId: string): void;
}

interface MonacoWindowLike extends Window {
  monaco?: {
    editor?: MonacoEditorNamespaceLike;
  };
}

interface EditorTextmateThemeOwnerDeps {
  getWindow(): MonacoWindowLike;
  getDocument(): Document;
  ensureTe2DiffTheme(): void;
  applyMonacoThemeRuntime(args: unknown): Promise<unknown>;
  getSelectedTheme(): Promise<unknown>;
  vscodeThemeToMonacoTheme(themeId: string, vscodeJson: unknown): unknown;
  applyThemeToTextmateRegistry(vscodeThemeJson: unknown): void;
  getLanguageWorkersEnabled(): boolean;
  normalizeLanguage(languageId: unknown): string;
  languageFromPath(path: string): string;
  ensureWorkbenchLanguageCatalogInstalled(): Promise<boolean>;
  ensureTextmateTokenization(languageId: string, filePath: string): Promise<boolean>;
  installWorkbenchLanguageBridgeProviders(): void;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isTextmateDisabled(win: Window | null | undefined): boolean {
  try {
    return !!(win && (win as Window & { __debugDisableTextmate?: boolean }).__debugDisableTextmate);
  } catch (_) {
    return false;
  }
}

export function createEditorTextmateThemeOwnerRuntime(
  deps: EditorTextmateThemeOwnerDeps,
): {
  getThemeJsonCache(): Record<string, unknown>;
  applyTheme(themeKey: string): Promise<void>;
  applyLanguageToModel(model: unknown, languageId: unknown, filePath: string): void;
} {
  let themeJsonCache: Record<string, unknown> = {};
  const languageApplyInflight: Record<string, Promise<void> | undefined> = Object.create(null);
  let themeApplyInflight: Promise<void> | null = null;
  let themeApplyKey = '';
  let textmateDisableLogged = false;

  function setModelLanguage(model: unknown, languageId: string): void {
    try {
      const win = deps.getWindow();
      if (!model || !win.monaco || !win.monaco.editor || typeof win.monaco.editor.setModelLanguage !== 'function') return;
      win.monaco.editor.setModelLanguage(model, languageId);
    } catch (_) {}
  }

  function getThemeJsonCache(): Record<string, unknown> {
    return themeJsonCache;
  }

  async function applyTheme(themeKey: string): Promise<void> {
    const nextKey = String(themeKey || '');
    if (themeApplyInflight && themeApplyKey === nextKey) {
      return await themeApplyInflight;
    }
    themeApplyKey = nextKey;
    themeApplyInflight = (async () => {
      await deps.applyMonacoThemeRuntime({
        win: deps.getWindow(),
        doc: deps.getDocument(),
        ensureTe2DiffThemeFn: deps.ensureTe2DiffTheme,
        getSelectedThemeFn: deps.getSelectedTheme,
        toMonacoThemeFn: deps.vscodeThemeToMonacoTheme,
        getJsonCacheFn: getThemeJsonCache,
        setJsonCacheFn(cache: Record<string, unknown>) {
          themeJsonCache = cache || {};
        },
        applyThemeToTextmateRegistryFn:
          deps.getLanguageWorkersEnabled() || isTextmateDisabled(deps.getWindow())
          ? undefined
          : deps.applyThemeToTextmateRegistry,
      });
    })();
    try {
      await themeApplyInflight;
    } finally {
      if (themeApplyKey === nextKey) {
        themeApplyInflight = null;
      }
    }
  }

  function applyLanguageToModel(model: unknown, languageId: unknown, filePath: string): void {
    let lang = deps.normalizeLanguage(languageId);
    if ((!lang || lang === 'plaintext') && filePath) {
      lang = deps.languageFromPath(filePath);
    }
    if (!lang) lang = 'plaintext';

    setModelLanguage(model, lang);
    if (deps.getLanguageWorkersEnabled()) return;

    const applyKey = (filePath || '') + '::' + lang;
    const inflight = languageApplyInflight[applyKey];
    if (inflight) return;

    languageApplyInflight[applyKey] = (async () => {
      try {
        const textmateDisabled = isTextmateDisabled(deps.getWindow());
        await deps.ensureWorkbenchLanguageCatalogInstalled();
        if (filePath) {
          const resolved = deps.normalizeLanguage(deps.languageFromPath(filePath));
          if (resolved) lang = resolved;
        }
        setModelLanguage(model, lang);
        if (textmateDisabled) {
          if (!textmateDisableLogged) {
            textmateDisableLogged = true;
            try { console.log('[TextMate] disabled by __debugDisableTextmate'); } catch (_) {}
          }
        } else {
          const ok = await deps.ensureTextmateTokenization(lang, filePath);
          if (!ok) return;
          setModelLanguage(model, lang);
        }
        try { deps.installWorkbenchLanguageBridgeProviders(); } catch (_) {}
      } finally {
        delete languageApplyInflight[applyKey];
      }
    })().catch(() => {});
  }

  return {
    getThemeJsonCache,
    applyTheme,
    applyLanguageToModel,
  };
}
