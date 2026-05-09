interface WorkerCtorLike {
  new (url: string | URL, options?: WorkerOptions): Worker;
}

type WindowWithMonacoBoot = Window & {
  MonacoEnvironment?: Record<string, unknown>;
  _loadedMonacoBundle?: string;
};

interface MonacoTypeScriptDefaultsLike {
  modeConfiguration?: Record<string, unknown>;
  setDiagnosticsOptions?(options: Record<string, unknown>): void;
  setModeConfiguration?(options: Record<string, unknown>): void;
}

interface MonacoTypeScriptNamespaceLike {
  typescriptDefaults?: MonacoTypeScriptDefaultsLike;
  javascriptDefaults?: MonacoTypeScriptDefaultsLike;
}

interface MonacoLanguagesLike {
  typescript?: MonacoTypeScriptNamespaceLike;
}

interface MonacoLike {
  languages?: MonacoLanguagesLike;
}

interface EditorMonacoBootRuntimeDeps {
  getWindow(): WindowWithMonacoBoot;
  getApiBase(): string;
  getBootSnapshot(): unknown;
  getCachedPrefs(): unknown;
  setCachedPrefs(value: unknown): void;
  fetchSSOTState(): Promise<unknown>;
  languageWorkersEnabled(): boolean;
  getWorkerLogOnce(): Record<string, boolean>;
  ensureTe2DiffTheme(): void;
  applyMonacoTheme(themeKey: string): Promise<void> | void;
  ensureEditorWithPrefs(): Promise<unknown>;
  applyBootSnapshot(): void;
  ensureWorkbenchLanguageCatalogInstalled(): Promise<boolean>;
  installWorkbenchLanguageBridgeProviders(): void;
  applyActiveModelLanguage(): void;
  collectBootLanguageIds(monacoRef: unknown): string[];
  warnIfPlaintextOnlyLanguages(languageIds: string[]): void;
  connectEditorSocket(): Promise<unknown> | boolean | void;
  connectEditorHostActions(): void;
  emitToHost(eventName: string, payload: Record<string, unknown>): void;
  updateDebug(extra: string): void;
}

interface MonacoBootstrapModuleLike {
  loadMonaco?(): Promise<unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function configureMonacoEnvironment(
  deps: EditorMonacoBootRuntimeDeps,
  base: string,
  langBase: string,
): void {
  const win = deps.getWindow();
  const workerLogOnce = deps.getWorkerLogOnce();
  const WorkerRef = Worker as unknown as WorkerCtorLike;
  const URLRef = URL;
  const BlobRef = Blob;

  win.MonacoEnvironment = {
    getWorker(_moduleId: unknown, _label: unknown) {
      const label = String(_label || '');
      const moduleId = String(_moduleId || '');
      const langWorkerMap: Record<string, string> = {
        typescript: '/workers/ts.worker.js',
        javascript: '/workers/ts.worker.js',
        json: '/workers/json.worker.js',
        css: '/workers/css.worker.js',
        scss: '/workers/css.worker.js',
        less: '/workers/css.worker.js',
        html: '/workers/html.worker.js',
        handlebars: '/workers/html.worker.js',
        razor: '/workers/html.worker.js',
      };
      const isLangWorker = Object.prototype.hasOwnProperty.call(langWorkerMap, label);
      const workersEnabled = deps.languageWorkersEnabled();

      if (isLangWorker && !workersEnabled) {
        const noop = new BlobRef(['self.onmessage=function(){}'], { type: 'application/javascript' });
        return new WorkerRef(URLRef.createObjectURL(noop));
      }

      const url = isLangWorker
        ? (langBase + langWorkerMap[label])
        : (base + '/vs/editor/common/services/editorWebWorkerMain.bundle.js');
      const worker = new WorkerRef(url, { type: 'module' });
      const key = label + ':' + url.split('/').pop();
      if (!workerLogOnce[key]) {
        workerLogOnce[key] = true;
        console.log('[MonacoWorker]', { moduleId, label, url });
      }
      worker.onerror = (event) => {
        console.error('[MonacoWorker] error', { moduleId, label, event });
      };
      worker.onmessageerror = (event) => {
        console.error('[MonacoWorker] messageerror', { moduleId, label, event });
      };
      return worker;
    },
  };
}

const DEFAULT_TS_MODE_CONFIGURATION: Record<string, boolean> = {
  completionItems: true,
  hovers: true,
  documentSymbols: true,
  definitions: true,
  references: true,
  documentHighlights: true,
  rename: true,
  diagnostics: true,
  documentRangeFormattingEdits: true,
  signatureHelp: true,
  onTypeFormattingEdits: true,
  codeActions: true,
  inlayHints: true,
};

function configureTypeScriptWorkerDefaults(monacoNs: unknown, workersEnabled: boolean): void {
  try {
    const monacoRef = monacoNs as MonacoLike;
    const tsLang = monacoRef.languages && monacoRef.languages.typescript;
    if (!tsLang) return;
    if (workersEnabled) {
      console.log('[Monaco] TS/JS worker defaults left enabled by webWorkersEnabled');
      return;
    }

    const configureDefaults = (defaults: MonacoTypeScriptDefaultsLike | undefined): void => {
      if (!defaults) return;
      if (typeof defaults.setDiagnosticsOptions === 'function') {
        defaults.setDiagnosticsOptions({
          noSemanticValidation: true,
          noSyntaxValidation: true,
        });
      }
      if (typeof defaults.setModeConfiguration === 'function') {
        defaults.setModeConfiguration({
          ...DEFAULT_TS_MODE_CONFIGURATION,
          ...(asRecord(defaults.modeConfiguration) || {}),
          completionItems: false,
        });
      }
    };

    configureDefaults(tsLang.typescriptDefaults);
    configureDefaults(tsLang.javascriptDefaults);

    if (tsLang.typescriptDefaults || tsLang.javascriptDefaults) {
      console.log('[Monaco] TS/JS worker diagnostics disabled; worker completions disabled');
    }
  } catch (error) {
    console.warn('[Monaco] TS/JS worker defaults config failed', error);
  }
}

export async function bootMonacoRuntime(
  deps: EditorMonacoBootRuntimeDeps,
): Promise<void> {
  try {
    const apiBase = deps.getApiBase() || '';
    const base = apiBase + '/ui/monaco_vscode/esm';
    const langBase = apiBase + '/ui/monaco_vscode/lang';
    const win = deps.getWindow();

    configureMonacoEnvironment(deps, base, langBase);

    try {
      if (!deps.getCachedPrefs() && deps.getBootSnapshot()) {
        deps.applyBootSnapshot();
      }
      if (!deps.getCachedPrefs()) {
        deps.setCachedPrefs(await deps.fetchSSOTState());
      }
    } catch (_) {}

    const bundleName = 'monaco.bootstrap.bundle.js';
    const bundled = await import(langBase + '/bootstrap/' + bundleName) as MonacoBootstrapModuleLike;
    const monacoNs = bundled && typeof bundled.loadMonaco === 'function'
      ? await bundled.loadMonaco()
      : null;
    win._loadedMonacoBundle = bundleName;
    console.log('[Monaco] loaded ' + bundleName);

    win.monaco = monacoNs || undefined;
    deps.ensureTe2DiffTheme();
    configureTypeScriptWorkerDefaults(monacoNs, deps.languageWorkersEnabled());

    try { await deps.applyMonacoTheme('github-dark-default'); } catch (_) {}

    try { deps.applyBootSnapshot(); } catch (_) {}
    await deps.ensureEditorWithPrefs();
    await Promise.resolve(deps.connectEditorSocket());
    try { await deps.ensureWorkbenchLanguageCatalogInstalled(); } catch (_) {}
    try { deps.installWorkbenchLanguageBridgeProviders(); } catch (_) {}

    try {
      deps.applyActiveModelLanguage();
      const langs = deps.collectBootLanguageIds(monacoNs);
      deps.warnIfPlaintextOnlyLanguages(langs);
    } catch (_) {}

    deps.connectEditorHostActions();

    deps.emitToHost('editor_ready', {});
    deps.updateDebug('boot=ok');
  } catch (error) {
    console.error('[Monaco] boot failed', error);
    deps.updateDebug('boot=fail');
  }
}
