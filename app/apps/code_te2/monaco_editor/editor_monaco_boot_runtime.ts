import { loadMonaco as loadBundledMonaco } from '../../../static/vendor/monaco-editor-core/te2-lang/bootstrap/monaco.bootstrap.bundle.js';

interface WorkerCtorLike {
  new (url: string | URL, options?: WorkerOptions): Worker;
}

type WindowWithMonacoBoot = Window & {
  MonacoEnvironment?: Record<string, unknown>;
  _loadedMonacoBundle?: string;
};

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

function isGeckoRuntime(win: WindowWithMonacoBoot): boolean {
  return /\bGecko\//.test(String(win.navigator && win.navigator.userAgent || ''));
}

// Gecko rejects a module worker when the Android asset WebExtension redirects
// its entry module to the APK loopback server. A same-origin Blob entrypoint can
// import the normal worker URL, whose module fetch may follow that local redirect.
function createGeckoModuleWorker(
  win: WindowWithMonacoBoot,
  WorkerRef: WorkerCtorLike,
  URLRef: typeof URL,
  BlobRef: typeof Blob,
  moduleUrl: string,
): Worker {
  const absoluteModuleUrl = new URLRef(moduleUrl, win.location.href).href;
  const bootstrap = new BlobRef(
    [`import ${JSON.stringify(absoluteModuleUrl)};`],
    { type: 'application/javascript' },
  );
  const bootstrapUrl = URLRef.createObjectURL(bootstrap);
  try {
    const worker = new WorkerRef(bootstrapUrl, { type: 'module' });
    let revoked = false;
    const revokeBootstrapUrl = (): void => {
      if (revoked) return;
      revoked = true;
      URLRef.revokeObjectURL(bootstrapUrl);
    };
    worker.addEventListener('message', revokeBootstrapUrl, { once: true });
    worker.addEventListener('error', revokeBootstrapUrl, { once: true });
    setTimeout(revokeBootstrapUrl, 30_000);
    return worker;
  } catch (error) {
    URLRef.revokeObjectURL(bootstrapUrl);
    throw error;
  }
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
        throw new Error(
          `[MonacoWorker] ${label} requested while Code Server owns language intelligence`,
        );
      }

      const url = isLangWorker
        ? (langBase + langWorkerMap[label])
        : (base + '/vs/editor/common/services/editorWebWorkerMain.bundle.js');
      const useGeckoBlobImport = isGeckoRuntime(win);
      const worker = useGeckoBlobImport
        ? createGeckoModuleWorker(win, WorkerRef, URLRef, BlobRef, url)
        : new WorkerRef(url, { type: 'module' });
      const key = label + ':' + url.split('/').pop();
      if (!workerLogOnce[key]) {
        workerLogOnce[key] = true;
        console.log('[MonacoWorker]', {
          moduleId,
          label,
          url,
          transport: useGeckoBlobImport ? 'gecko-blob-import' : 'direct-module',
        });
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

    const languageWorkersEnabled = deps.languageWorkersEnabled();
    const monacoNs = await loadBundledMonaco({ languageWorkersEnabled });
    win._loadedMonacoBundle = 'host.js';
    console.log(
      `[Monaco] loaded from host.js mode=${languageWorkersEnabled ? 'web-workers' : 'code-server'}`,
    );

    win.monaco = monacoNs || undefined;
    deps.ensureTe2DiffTheme();

    try { await deps.applyMonacoTheme('github-dark-default'); } catch (_) {}

    try { deps.applyBootSnapshot(); } catch (_) {}
    await deps.ensureEditorWithPrefs();
    // Register readiness subscribers before Socket.IO can replay connect-time
    // adapter state; Rust can deliver that replay faster than Python did.
    deps.connectEditorHostActions();
    await Promise.resolve(deps.connectEditorSocket());
    if (!languageWorkersEnabled) {
      try { await deps.ensureWorkbenchLanguageCatalogInstalled(); } catch (_) {}
      try { deps.installWorkbenchLanguageBridgeProviders(); } catch (_) {}
    }

    try {
      deps.applyActiveModelLanguage();
      const langs = deps.collectBootLanguageIds(monacoNs);
      deps.warnIfPlaintextOnlyLanguages(langs);
    } catch (_) {}

    deps.emitToHost('editor_ready', {});
    deps.updateDebug('boot=ok');
  } catch (error) {
    console.error('[Monaco] boot failed', error);
    deps.updateDebug('boot=fail');
  }
}
