interface WorkerCtorLike {
  new (url: string | URL, options?: WorkerOptions): Worker;
}

type WindowWithMonacoBoot = Window & {
  MonacoEnvironment?: Record<string, unknown>;
  _loadedMonacoBundle?: string;
  __te2VscodeBootstrap?: unknown;
};

interface MonacoTypeScriptDefaultsLike {
  setDiagnosticsOptions?(options: Record<string, unknown>): void;
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
  getCachedPrefs(): unknown;
  setCachedPrefs(value: unknown): void;
  fetchSSOTState(): Promise<unknown>;
  languageWorkersEnabled(): boolean;
  getWorkerLogOnce(): Record<string, boolean>;
  ensureTe2DiffTheme(): void;
  loadVscodeTextmateThemes(): Promise<void>;
  applyMonacoTheme(themeKey: string): Promise<void> | void;
  ensureEditorWithPrefs(): Promise<unknown>;
  installVscodeApiLanguageBridgeProviders(): void;
  vscodeApiCall(method: string, params: Record<string, unknown>): Promise<unknown>;
  applyActiveModelLanguage(): void;
  collectBootLanguageIds(monacoRef: unknown): string[];
  warnIfPlaintextOnlyLanguages(languageIds: string[]): void;
  connectEditorSocket(): void;
  connectUIIPC(): void;
  ensureVscodeRpcConnected(): void;
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

function disableTypeScriptWorkerDiagnostics(monacoNs: unknown): void {
  try {
    const monacoRef = monacoNs as MonacoLike;
    const tsLang = monacoRef.languages && monacoRef.languages.typescript;
    if (!tsLang) return;
    if (tsLang.typescriptDefaults && typeof tsLang.typescriptDefaults.setDiagnosticsOptions === 'function') {
      tsLang.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
      });
    }
    if (tsLang.javascriptDefaults && typeof tsLang.javascriptDefaults.setDiagnosticsOptions === 'function') {
      tsLang.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
      });
    }
    console.log('[Monaco] TS/JS worker diagnostics disabled');
  } catch (error) {
    console.warn('[Monaco] TS/JS diagnostics config failed', error);
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
    disableTypeScriptWorkerDiagnostics(monacoNs);

    try { await deps.loadVscodeTextmateThemes(); } catch (_) {}
    try { await deps.applyMonacoTheme('github-dark-default'); } catch (_) {}

    await deps.ensureEditorWithPrefs();
    try { deps.installVscodeApiLanguageBridgeProviders(); } catch (_) {}

    try {
      try {
        win.__te2VscodeBootstrap = await deps.vscodeApiCall('vscode.bootstrap.snapshot', {});
      } catch (_) {}
      deps.applyActiveModelLanguage();
      const langs = deps.collectBootLanguageIds(monacoNs);
      deps.warnIfPlaintextOnlyLanguages(langs);
    } catch (_) {}

    deps.connectEditorSocket();
    deps.connectUIIPC();

    try { deps.ensureVscodeRpcConnected(); } catch (_) {}

    deps.emitToHost('editor_ready', {});
    deps.updateDebug('boot=ok');
  } catch (error) {
    console.error('[Monaco] boot failed', error);
    deps.updateDebug('boot=fail');
  }
}
