interface MonacoUriLike {
  toString(): string;
}

interface MonacoModelLike {
  uri?: MonacoUriLike;
}

interface MonacoDocumentSemanticTokensLegendLike {
  tokenTypes?: string[];
  tokenModifiers?: string[];
}

interface MonacoSemanticTokensProviderLike {
  getLegend(): MonacoDocumentSemanticTokensLegendLike;
  provideDocumentSemanticTokens(model: MonacoModelLike): Promise<{ data: Uint32Array }>;
  releaseDocumentSemanticTokens(): void;
}

interface MonacoLanguagesLike {
  registerDocumentSemanticTokensProvider?(
    selector: string,
    provider: MonacoSemanticTokensProviderLike,
  ): void;
}

interface MonacoLike {
  languages?: MonacoLanguagesLike;
}

interface VscodeRpcRuntimeDeps {
  getWindow(): Window & typeof globalThis;
  getMonaco(): MonacoLike | null;
  fetchJsonWithBase(path: string, init?: RequestInit): Promise<unknown>;
  wsUrlFromPath(wsPath: string): string | null;
  createWebSocket(url: string): WebSocket;
}

function isLegend(value: unknown): value is MonacoDocumentSemanticTokensLegendLike {
  return !!value && typeof value === 'object';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createEditorVscodeRpcRuntime(
  deps: VscodeRpcRuntimeDeps,
): {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  ensureConnected(enabled: boolean): Promise<boolean>;
  installSemanticTokens(legend: MonacoDocumentSemanticTokensLegendLike | null | undefined): void;
  getLegend(): MonacoDocumentSemanticTokensLegendLike | null;
  getWebSocket(): WebSocket | null;
  getDocUri(): string | null;
  setDocUri(uri: string | null): void;
  getDocVersion(): number;
  setDocVersion(version: number): void;
  getChangeDebounceTimer(): ReturnType<typeof setTimeout> | null;
  setChangeDebounceTimer(timer: ReturnType<typeof setTimeout> | null): void;
} {
  let vscodeRpcWs: WebSocket | null = null;
  const vscodeRpcPending: Record<string, { resolve(value: unknown): void; reject(error: unknown): void }> = Object.create(null);
  let vscodeRpcNextId = 1;
  let vscodeRpcLegend: MonacoDocumentSemanticTokensLegendLike | null = null;
  let vscodeRpcInstalled = false;
  let vscodeRpcDocUri: string | null = null;
  let vscodeRpcDocVersion = 1;
  let vscodeRpcChangeDebounceT: ReturnType<typeof setTimeout> | null = null;

  function call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      try {
        if (!vscodeRpcWs || vscodeRpcWs.readyState !== 1) {
          reject(new Error('vscode_rpc not connected'));
          return;
        }
        const id = vscodeRpcNextId++;
        vscodeRpcPending[String(id)] = { resolve, reject };
        vscodeRpcWs.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }));
      } catch (error) {
        reject(error);
      }
    });
  }

  function installSemanticTokens(legend: MonacoDocumentSemanticTokensLegendLike | null | undefined): void {
    try {
      if (vscodeRpcInstalled) return;
      const monacoRef = deps.getMonaco();
      if (!monacoRef || !monacoRef.languages || !monacoRef.languages.registerDocumentSemanticTokensProvider) return;
      if (!legend || !Array.isArray(legend.tokenTypes) || !Array.isArray(legend.tokenModifiers)) return;

      const makeProvider = (): MonacoSemanticTokensProviderLike => ({
        getLegend() {
          return legend;
        },
        async provideDocumentSemanticTokens(model: MonacoModelLike) {
          try {
            if (!model) return { data: new Uint32Array(0) };
            const uri = model.uri ? model.uri.toString() : '';
            const resp = await call('textDocument/semanticTokens/full', { textDocument: { uri } });
            const data = resp && typeof resp === 'object' && Array.isArray((resp as { data?: unknown[] }).data)
              ? (resp as { data: number[] }).data
              : [];
            return { data: new Uint32Array(data) };
          } catch (_) {
            return { data: new Uint32Array(0) };
          }
        },
        releaseDocumentSemanticTokens() {},
      });

      monacoRef.languages.registerDocumentSemanticTokensProvider('typescript', makeProvider());
      monacoRef.languages.registerDocumentSemanticTokensProvider('javascript', makeProvider());
      vscodeRpcInstalled = true;
      console.log('[vscode_rpc] semantic tokens provider installed');
    } catch (error) {
      console.warn('[vscode_rpc] install semantic tokens failed', error);
    }
  }

  async function ensureConnected(enabled: boolean): Promise<boolean> {
    try {
      if (!enabled) return false;
      if (vscodeRpcWs && vscodeRpcWs.readyState === 1) return true;
      const disc = await deps.fetchJsonWithBase('/vscode_rpc/discover', { cache: 'no-store' });
      const discRecord = asRecord(disc);
      const wsPath = discRecord && typeof discRecord.ws_url === 'string' ? discRecord.ws_url : '';
      if (!wsPath) return false;
      const wsUrl = deps.wsUrlFromPath(wsPath);
      if (!wsUrl) return false;

      vscodeRpcWs = deps.createWebSocket(wsUrl);
      vscodeRpcWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data || ''));
          if (msg && msg.id != null) {
            const key = String(msg.id);
            const pending = vscodeRpcPending[key];
            if (pending) {
              delete vscodeRpcPending[key];
              if (msg.error) pending.reject(msg.error);
              else pending.resolve(msg.result);
            }
          }
        } catch (_) {}
      };

      await new Promise<void>((resolve, reject) => {
        if (!vscodeRpcWs) {
          reject(new Error('vscode_rpc websocket missing'));
          return;
        }
        vscodeRpcWs.onopen = () => { resolve(); };
        vscodeRpcWs.onerror = (event) => { reject(event); };
      });

      try {
        const init = await call('initialize', { processId: null, rootUri: null, capabilities: {} });
        const st = init && typeof init === 'object' ? (init as { capabilities?: { semanticTokensProvider?: { legend?: unknown } } }).capabilities?.semanticTokensProvider : null;
        vscodeRpcLegend = st && isLegend(st.legend) ? st.legend : null;
      } catch (_) {
        vscodeRpcLegend = null;
      }

      if (vscodeRpcLegend && !vscodeRpcInstalled) installSemanticTokens(vscodeRpcLegend);
      return true;
    } catch (error) {
      if (enabled) console.warn('[vscode_rpc] connect failed', error);
      return false;
    }
  }

  return {
    call,
    ensureConnected,
    installSemanticTokens,
    getLegend() { return vscodeRpcLegend; },
    getWebSocket() { return vscodeRpcWs; },
    getDocUri() { return vscodeRpcDocUri; },
    setDocUri(uri: string | null) { vscodeRpcDocUri = uri; },
    getDocVersion() { return vscodeRpcDocVersion; },
    setDocVersion(version: number) { vscodeRpcDocVersion = version; },
    getChangeDebounceTimer() { return vscodeRpcChangeDebounceT; },
    setChangeDebounceTimer(timer: ReturnType<typeof setTimeout> | null) { vscodeRpcChangeDebounceT = timer; },
  };
}
