interface MonacoModelUriLike {
  toString(): string;
}

interface MonacoChangeRangeLike {
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
}

interface MonacoChangeLike {
  range?: MonacoChangeRangeLike;
  text?: string;
}

interface MonacoChangeEventLike {
  changes?: MonacoChangeLike[];
}

interface MonacoTextModelLike {
  uri?: MonacoModelUriLike;
  getLanguageId?(): string;
  getValue?(): string;
  onDidChangeContent?(listener: (event: MonacoChangeEventLike) => void): unknown;
  __te2VscodeRpcInstalled?: boolean;
}

interface VscodeRpcDocumentLifecycleDeps {
  getModel(): MonacoTextModelLike | null;
  getCurrentPath(): string | null;
  languageFromPath(path: string): string;
  ensureVscodeRpcConnected(): Promise<boolean>;
  getVscodeRpcLegend(): unknown;
  getVscodeRpcWebSocket(): WebSocket | null;
  getVscodeRpcDocUri(): string | null;
  setVscodeRpcDocUri(uri: string | null): void;
  getVscodeRpcDocVersion(): number;
  setVscodeRpcDocVersion(version: number): void;
  getVscodeRpcChangeDebounceTimer(): ReturnType<typeof setTimeout> | null;
  setVscodeRpcChangeDebounceTimer(timer: ReturnType<typeof setTimeout> | null): void;
}

function buildPosition(lineNumber: number | undefined, column: number | undefined): { line: number; character: number } {
  return {
    line: Math.max(0, Number(lineNumber || 1) - 1),
    character: Math.max(0, Number(column || 1) - 1),
  };
}

function sendJsonRpc(ws: WebSocket | null, payload: Record<string, unknown>): void {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

export function vscodeRpcDidOpenIfReady(deps: VscodeRpcDocumentLifecycleDeps): void {
  try {
    const model = deps.getModel();
    const currentPath = deps.getCurrentPath();
    if (!model || !currentPath) return;

    const languageId = String(model.getLanguageId ? model.getLanguageId() : deps.languageFromPath(currentPath));
    if (languageId !== 'typescript' && languageId !== 'javascript') return;

    deps.ensureVscodeRpcConnected().then((ok) => {
      if (!ok || !deps.getVscodeRpcLegend()) return;

      const uri = model.uri ? model.uri.toString() : '';
      if (!uri || !uri.startsWith('file://')) return;

      const ws = deps.getVscodeRpcWebSocket();
      const previousUri = deps.getVscodeRpcDocUri();
      if (previousUri && previousUri !== uri) {
        try {
          sendJsonRpc(ws, {
            jsonrpc: '2.0',
            method: 'textDocument/didClose',
            params: { textDocument: { uri: previousUri } },
          });
        } catch (_) {}
      }

      deps.setVscodeRpcDocUri(uri);
      deps.setVscodeRpcDocVersion(1);

      try {
        sendJsonRpc(ws, {
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri,
              languageId,
              version: deps.getVscodeRpcDocVersion(),
              text: model.getValue ? model.getValue() : '',
            },
          },
        });
      } catch (_) {}
    }).catch(() => {});
  } catch (_) {}
}

export function installVscodeRpcChangePublisher(deps: VscodeRpcDocumentLifecycleDeps): void {
  try {
    const model = deps.getModel();
    if (!model || model.__te2VscodeRpcInstalled || typeof model.onDidChangeContent !== 'function') return;
    model.__te2VscodeRpcInstalled = true;

    model.onDidChangeContent((event) => {
      try {
        const ws = deps.getVscodeRpcWebSocket();
        const docUri = deps.getVscodeRpcDocUri();
        if (!ws || ws.readyState !== 1) return;
        if (!docUri) return;
        if (!event || !Array.isArray(event.changes) || !event.changes.length) return;

        const nextVersion = deps.getVscodeRpcDocVersion() + 1;
        deps.setVscodeRpcDocVersion(nextVersion);

        const contentChanges = event.changes.map((change) => {
          const range = change && change.range ? change.range : {};
          return {
            range: {
              start: buildPosition(range.startLineNumber, range.startColumn),
              end: buildPosition(range.endLineNumber, range.endColumn),
            },
            text: change && typeof change.text === 'string' ? change.text : '',
          };
        });

        const payload = {
          jsonrpc: '2.0',
          method: 'textDocument/didChange',
          params: {
            textDocument: { uri: docUri, version: nextVersion },
            contentChanges,
          },
        };

        const pending = deps.getVscodeRpcChangeDebounceTimer();
        if (pending) clearTimeout(pending);
        deps.setVscodeRpcChangeDebounceTimer(setTimeout(() => {
          try {
            sendJsonRpc(deps.getVscodeRpcWebSocket(), payload);
          } catch (_) {}
        }, 120));
      } catch (_) {}
    });
  } catch (_) {}
}
