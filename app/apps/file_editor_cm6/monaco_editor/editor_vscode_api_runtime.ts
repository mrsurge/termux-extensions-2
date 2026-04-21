interface SocketLike {
  readyState?: number;
  onmessage?: ((event: MessageEvent) => void) | null;
  onclose?: (() => void) | null;
  onopen?: (() => void) | null;
  onerror?: (() => void) | null;
  send?(value: string): void;
}

type WindowVscodeApiLike = Window & {
  monaco?: Window['monaco'] & {
    languages?: unknown;
    editor?: {
      getModels?(): Array<{ resetTokenization?(): void }>;
    };
  };
};

interface VscodeApiRuntimeDeps {
  getWindow(): WindowVscodeApiLike;
  getDocument(): Document;
  fetchFn(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  startVscodeApiService(): Promise<void>;
  discoverVscodeApiWsPath(): Promise<string>;
  buildVscodeApiWsUrl(wsPath: string): string;
  createWebSocket(url: string): SocketLike;
  handleVscodeApiMessageData(data: unknown, pending: Map<string, unknown>, handlers: Map<string, unknown>): void;
  rejectAndClearVscodeApiPending(pending: Map<string, unknown>, reason: string): void;
  buildVscodeApiRequestPayload(id: number, method: string, params: Record<string, unknown>): Record<string, unknown>;
  createVscodeApiCallPromise(
    pending: Map<string, unknown>,
    id: number,
    method: string,
    timeoutMs: number,
  ): Promise<unknown>;
  vscodeApiNotify(socket: SocketLike | null, method: string, params: Record<string, unknown>): unknown;
  getVscodeLanguagesList(win: WindowVscodeApiLike, callFn: (method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }) => Promise<unknown>): Promise<unknown[]>;
  normalizeLanguage(languageId: unknown): string;
  registerVscodeLanguageId(monacoRef: unknown, languageIds: Set<string>, langId: string, language: Record<string, unknown>): void;
  mapVscodeLanguageExtensions(target: Map<string, string>, extensions: unknown, langId: string): void;
  mapVscodeLanguageFilenames(target: Map<string, string>, filenames: unknown, langId: string): void;
  applyVscodeLanguageConfiguration(monacoRef: unknown, langId: string, rawConfig: unknown, parseJsoncFn: (value: string) => unknown): void;
  installVscodeLanguagesLoop(languages: unknown[], normalizeLanguageFn: (value: unknown) => string, onLanguage: (language: Record<string, unknown>, langId: string) => void): void;
  finalizeVscodeLanguagesInstall(
    languages: unknown[],
    byExtension: Map<string, string>,
    byFilename: Map<string, string>,
    installLanguageBridgeProviders: () => void,
  ): void;
  installVscodeApiLanguageBridgeProviders(): void;
  loadVscodeTextmateThemesRuntime(args: Record<string, unknown>): Promise<unknown>;
  applyMonacoThemeRuntime(args: Record<string, unknown>): Promise<unknown>;
  ensureThemeRegistry(): Promise<unknown>;
  getVscodeThemeJsonUrl(themeId: string): string;
  vscodeThemeToMonacoTheme(themeId: string, vscodeJson: unknown): unknown;
  ensureTe2DiffTheme(): void;
  resolveMonacoThemeId(themeKey: string, cache: Record<string, unknown>): string;
  applyThemeToTextmateRegistry(vscodeThemeJson: unknown): void;
  forceSemanticHighlighting(): void;
  parseJsonc(value: string): unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createEditorVscodeApiRuntime(
  deps: VscodeApiRuntimeDeps,
): {
  ensureVscodeApiWs(): Promise<SocketLike | null>;
  vscodeApiCall(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  vscodeApiNotify(method: string, params: Record<string, unknown>): unknown;
  ensureVscodeLanguagesInstalled(): Promise<boolean>;
  loadVscodeTextmateThemes(): Promise<unknown>;
  applyMonacoTheme(themeKey: string): Promise<void>;
  getVscodeLanguageIds(): Set<string>;
  getVscodeLanguageByExtension(): Map<string, string>;
  getVscodeLanguageByFilename(): Map<string, string>;
  getThemeJsonCache(): Record<string, unknown>;
} {
  let vscodeApiWs: SocketLike | null = null;
  let vscodeApiConnecting: Promise<SocketLike | null> | null = null;
  let vscodeApiNextId = 1;
  const vscodeApiPending = new Map<string, unknown>();
  const vscodeApiHandlers = new Map<string, unknown>();
  let vscodeLanguagesInstalled = false;
  const vscodeLanguageIds = new Set<string>();
  const vscodeLanguageByExtension = new Map<string, string>();
  const vscodeLanguageByFilename = new Map<string, string>();
  const themeState: { _jsonCache?: Record<string, unknown> } = { _jsonCache: {} };

  async function ensureVscodeApiWs(): Promise<SocketLike | null> {
    if (vscodeApiWs && vscodeApiWs.readyState === WebSocket.OPEN) return vscodeApiWs;
    if (vscodeApiConnecting) return vscodeApiConnecting;

    vscodeApiConnecting = (async () => {
      await deps.startVscodeApiService();
      const wsPath = await deps.discoverVscodeApiWsPath();
      const wsUrl = deps.buildVscodeApiWsUrl(wsPath);
      const ws = deps.createWebSocket(wsUrl);
      vscodeApiWs = ws;

      ws.onmessage = (event) => {
        deps.handleVscodeApiMessageData(event.data, vscodeApiPending, vscodeApiHandlers);
      };

      ws.onclose = () => {
        vscodeApiWs = null;
        vscodeApiConnecting = null;
        deps.rejectAndClearVscodeApiPending(vscodeApiPending, 'vscode_api ws closed');
      };

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('vscode_api ws connect timeout')); }, 8000);
        ws.onopen = () => { clearTimeout(timer); resolve(); };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('vscode_api ws error')); };
      });

      vscodeApiConnecting = null;
      return ws;
    })();

    return vscodeApiConnecting;
  }

  async function vscodeApiCall(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown> {
    const ws = await ensureVscodeApiWs();
    if (!ws || typeof ws.send !== 'function') throw new Error('vscode_api ws unavailable');
    const id = vscodeApiNextId++;
    const payload = deps.buildVscodeApiRequestPayload(id, method, params);
    let timeoutMs = 12000;
    try {
      if (opts && Number.isFinite(Number(opts.timeoutMs))) timeoutMs = Math.max(250, Number(opts.timeoutMs));
    } catch (_) {}
    const pending = deps.createVscodeApiCallPromise(vscodeApiPending, id, method, timeoutMs);
    ws.send(JSON.stringify(payload));
    return pending;
  }

  function vscodeApiNotify(method: string, params: Record<string, unknown>): unknown {
    return deps.vscodeApiNotify(vscodeApiWs, method, params);
  }

  async function ensureVscodeLanguagesInstalled(): Promise<boolean> {
    const win = deps.getWindow();
    if (vscodeLanguagesInstalled) return true;
    if (!win.monaco || !win.monaco.languages) return false;

    try {
      const languages = await deps.getVscodeLanguagesList(win, vscodeApiCall);
      vscodeLanguageByExtension.clear();
      vscodeLanguageByFilename.clear();
      deps.installVscodeLanguagesLoop(languages, deps.normalizeLanguage, (language, langId) => {
        deps.registerVscodeLanguageId(win.monaco, vscodeLanguageIds, langId, language);
        deps.mapVscodeLanguageExtensions(vscodeLanguageByExtension, language.extensions, langId);
        deps.mapVscodeLanguageFilenames(vscodeLanguageByFilename, language.filenames, langId);
        deps.applyVscodeLanguageConfiguration(win.monaco, langId, language.configuration_raw, deps.parseJsonc);
      });

      vscodeLanguagesInstalled = true;
      deps.finalizeVscodeLanguagesInstall(languages, vscodeLanguageByExtension, vscodeLanguageByFilename, deps.installVscodeApiLanguageBridgeProviders);
      return true;
    } catch (error) {
      console.warn('[VSIX][Languages] list failed', error);
      return false;
    }
  }

  async function loadVscodeTextmateThemes(): Promise<unknown> {
    return deps.loadVscodeTextmateThemesRuntime({
      win: deps.getWindow(),
      state: themeState,
      ensureThemeRegistryFn: deps.ensureThemeRegistry,
      getThemeJsonUrlFn: deps.getVscodeThemeJsonUrl,
      fetchFn: deps.fetchFn,
      toMonacoThemeFn: deps.vscodeThemeToMonacoTheme,
    });
  }

  async function applyMonacoTheme(themeKey: string): Promise<void> {
    const activeTheme = await deps.applyMonacoThemeRuntime({
      win: deps.getWindow(),
      doc: deps.getDocument(),
      themeKey,
      ensureTe2DiffThemeFn: deps.ensureTe2DiffTheme,
      loadThemesFn: loadVscodeTextmateThemes,
      resolveThemeIdFn: (key: string, cache: Record<string, unknown>) => deps.resolveMonacoThemeId(key, cache || {}),
      getThemeJsonUrlFn: deps.getVscodeThemeJsonUrl,
      fetchFn: deps.fetchFn,
      toMonacoThemeFn: deps.vscodeThemeToMonacoTheme,
      getJsonCacheFn: () => themeState._jsonCache || {},
      setJsonCacheFn: (cache: Record<string, unknown>) => { themeState._jsonCache = cache || {}; },
      applyThemeToTextmateRegistryFn: deps.applyThemeToTextmateRegistry,
    });
    if (activeTheme) deps.applyThemeToTextmateRegistry(activeTheme);
    deps.forceSemanticHighlighting();
    try {
      const win = deps.getWindow();
      const models = win.monaco && win.monaco.editor && typeof win.monaco.editor.getModels === 'function'
        ? win.monaco.editor.getModels()
        : [];
      for (const model of models || []) {
        if (model && typeof model.resetTokenization === 'function') {
          model.resetTokenization();
        }
      }
    } catch (_) {}
  }

  function getThemeJsonCache(): Record<string, unknown> {
    return themeState._jsonCache || {};
  }

  return {
    ensureVscodeApiWs,
    vscodeApiCall,
    vscodeApiNotify,
    ensureVscodeLanguagesInstalled,
    loadVscodeTextmateThemes,
    applyMonacoTheme,
    getVscodeLanguageIds: () => vscodeLanguageIds,
    getVscodeLanguageByExtension: () => vscodeLanguageByExtension,
    getVscodeLanguageByFilename: () => vscodeLanguageByFilename,
    getThemeJsonCache,
  };
}
