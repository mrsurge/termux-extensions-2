import { loadMonaco as loadBundledMonaco } from '../../../static/vendor/monaco-editor-core/te2-lang/bootstrap/monaco.bootstrap.bundle.js';
import { traceColdBoot } from './editor_cold_boot_trace.ts';

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
  languageWorkersEnabled(): boolean;
  getWorkerLogOnce(): Record<string, boolean>;
  ensureTe2DiffTheme(): void;
  ensureDocumentTheme(): Promise<void>;
  ensureDocumentSyntax(): Promise<void>;
  ensureEditorWithPrefs(): Promise<unknown>;
  getActiveModelTrace?(): { uri: string; language: string; version: number; lines: number } | null;
  applyBootSnapshot(includeDocument?: boolean): void;
  ensureWorkbenchLanguageCatalogInstalled(): Promise<boolean>;
  installWorkbenchLanguageBridgeProviders(): void;
  applyActiveModelLanguage(): void;
  collectBootLanguageIds(monacoRef: unknown): string[];
  warnIfPlaintextOnlyLanguages(languageIds: string[]): void;
  connectEditorSocket(): Promise<unknown> | boolean | void;
  connectEditorHostActions(): void;
  emitToHost(eventName: string, payload: Record<string, unknown>): void;
  updateDebug(extra: string): void;
  onReady?(): void;
  onError?(error: unknown): void;
}

function isGeckoRuntime(win: WindowWithMonacoBoot): boolean {
  return /\bGecko\//.test(String(win.navigator && win.navigator.userAgent || ''));
}

// Gecko rejects a module worker when the Android asset WebExtension redirects
// its entry module to the APK loopback server. A same-origin Blob entrypoint can
// import the normal worker URL, whose module fetch may follow that local redirect.
export function createGeckoModuleWorker(
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
        deps.applyBootSnapshot(false);
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

    // Subscribe before connecting, then apply the selected theme before either
    // a boot snapshot or live replay may create/attach a document model.
    deps.connectEditorHostActions();
    await Promise.resolve(deps.connectEditorSocket());
    // Theme and backend-projected syntax can prepare concurrently. Both are
    // first-paint prerequisites; neither waits for WBA or the extension host.
    await Promise.all([
      deps.ensureDocumentTheme(),
      deps.ensureDocumentSyntax(),
    ]);
    deps.applyBootSnapshot();
    await deps.ensureEditorWithPrefs();
    const activeModel = deps.getActiveModelTrace?.();
    if (activeModel) traceColdBoot('model.first_mount', activeModel);
    if (!languageWorkersEnabled) {
      // Catalog enrichment follows WBA availability, not editor readiness. A
      // cold extension host must not delay the editor-ready/open-model handshake.
      void deps.ensureWorkbenchLanguageCatalogInstalled().then(() => {
        deps.installWorkbenchLanguageBridgeProviders();
        deps.applyActiveModelLanguage();
      }).catch(() => {});
    }

    try {
      deps.applyActiveModelLanguage();
      const langs = deps.collectBootLanguageIds(monacoNs);
      deps.warnIfPlaintextOnlyLanguages(langs);
    } catch (_) {}

    deps.emitToHost('editor_ready', {});
    deps.updateDebug('boot=ok');
    deps.onReady?.();
  } catch (error) {
    console.error('[Monaco] boot failed', error);
    deps.updateDebug('boot=fail');
    deps.onError?.(error);
  }
}
