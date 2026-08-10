import { formatErrorMessage } from "./error-format.mjs";

export interface DispatchRequest {
  id: unknown;
  method: string;
  params: unknown;
}

export interface AdapterConfigState {
  upstreamHttp: string;
  proxyHttp: string;
  codeServerSocketPath: string | null;
}

export interface AdapterSessionState {
  connected: boolean;
  ready: boolean;
  mgmtConnected: boolean;
  extConnected: boolean;
  useRemote: boolean | null;
  authority: string | null;
  serverRootPath: string | null;
  commit: string | null;
  workspaceFolder: string | null;
  activePath: string | null;
  activeUri: string | null;
  activeLanguageId: string | null;
  lastOpenTs: number | null;
  docSymbolsProviderHandle: number | null;
  hoverProviderHandle: number | null;
}

export interface AdapterServerState {
  config: AdapterConfigState;
  session: AdapterSessionState;
}

export interface HeapSnapshotResult {
  file: string;
  heap_used: number;
  heap_limit: number;
}

export interface WorkbenchStatus {
  activePath?: string | null;
}

export interface WorkbenchLike {
  state?: WorkbenchStatus & Record<string, unknown>;
  resync: () => unknown;
  languageCatalog: () => Promise<unknown>;
  connect: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  disconnect?: () => void;
  resubscribeWatcher: () => Promise<void>;
  _switchWorkspace: (folder: string) => Promise<Record<string, unknown>>;
  providers?: () => Record<string, unknown>;
  extensionActivitySnapshot: () => Record<string, unknown>;
  selectExtensionLog: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  extensionMenuResolve: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  extensionCommandExecute: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  resolveLanguageId: (
    path: string,
    text: string,
    requestedLanguageId?: unknown,
  ) => string;
  activateLanguage: (languageId: string) => Promise<Record<string, unknown>>;
  activateByEvent: (
    event: unknown,
    activationKind?: number,
    timeoutMs?: number,
  ) => Promise<unknown>;
  activateExtension: (
    extensionId: unknown,
    activationEvent?: unknown,
    timeoutMs?: number,
  ) => Promise<unknown>;
  openFile: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  reconcileLogicalDocuments: (
    params: Record<string, unknown>,
  ) => Record<string, unknown>;
  hydrateLogicalDocument: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  documentSymbols: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  foldingRanges: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  hover: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  documentHighlights: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  references: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  definitions: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  implementations: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  prepareCallHierarchy: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  incomingCalls: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  outgoingCalls: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  releaseCallHierarchy: (
    params: Record<string, unknown>,
  ) => Record<string, unknown>;
  completions: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  documentColors: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  colorPresentations: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  inlayHints: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  resolveInlayHint: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  releaseInlayHints: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  inlineCompletions: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  freeInlineCompletions: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  handleInlineCompletionDidShow: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  semanticTokens: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  getSemanticTokensLegend: (languageId: string) => Promise<unknown>;
  semanticTokensRange: (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  didChange: (
    params: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  webviewAttach: (params: Record<string, unknown>) => Record<string, unknown>;
  webviewMessage: (params: Record<string, unknown>) => Record<string, unknown>;
  webviewState: (params: Record<string, unknown>) => Record<string, unknown>;
  webviewVisibility: (params: Record<string, unknown>) => Record<string, unknown>;
  webviewDispose: (params: Record<string, unknown>) => Record<string, unknown>;
}

export interface ServerDispatchRuntime {
  wb: WorkbenchLike;
  state: AdapterServerState;
  eventLog: unknown[];
  defaultRemoteAuthority: string;
  defaultCodeServerHttp: string;
  nowMs: () => number;
  normalizePathParam: (params: unknown) => string;
  normalizeAuthorityParam: (params: unknown, fallback?: string) => string;
  vscodeRemoteUri: (authority: string, fsPath: string) => string;
  buildStatusResult: () => Record<string, unknown>;
  logStatus: (reason: string, extra?: Record<string, unknown> | null) => void;
  emitTe2Event: (event: Record<string, unknown>) => void;
  requestShutdown: () => void;
  scheduleOpenFileSnapshot: () => void;
  takeHeapSnapshot: (
    label: string,
    explicitPath?: string | null,
  ) => HeapSnapshotResult;
  log: (...args: unknown[]) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function success(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function failure(
  id: unknown,
  code: number,
  message: unknown,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message: formatErrorMessage(message) },
  };
}

function missingPathError(id: unknown): Record<string, unknown> {
  return failure(id, -32602, "Invalid params: provide path or uri");
}

const LANGUAGE_ACTIVATION_METHODS = new Set([
  "vscode.documentSymbols",
  "vscode.foldingRanges",
  "vscode.hover",
  "vscode.documentHighlights",
  "vscode.definition",
  "vscode.references",
  "vscode.implementations",
  "vscode.callHierarchy.prepare",
  "vscode.completions",
  "vscode.documentColors",
  "vscode.colorPresentations",
  "vscode.inlayHints",
  "vscode.inlineCompletions",
  "vscode.semanticTokens",
  "vscode.semanticTokensLegend",
  "vscode.semanticTokensRange",
]);

function boundedTimeout(value: unknown, fallback = 30000): number {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) return fallback;
  return Math.max(1000, Math.min(120000, timeout));
}

function resetDisconnectedSession(session: AdapterSessionState): void {
  session.connected = false;
  session.ready = false;
  session.mgmtConnected = false;
  session.extConnected = false;
  session.activePath = null;
  session.activeUri = null;
  session.activeLanguageId = null;
  session.lastOpenTs = null;
  session.docSymbolsProviderHandle = null;
  session.hoverProviderHandle = null;
}

function mergeWorkbenchState(runtime: ServerDispatchRuntime): void {
  if (!isRecord(runtime.wb.state)) return;
  runtime.state.session = {
    ...runtime.state.session,
    ...runtime.wb.state,
  } as AdapterSessionState;
}

export async function dispatchJsonRpcRequest(
  runtime: ServerDispatchRuntime,
  request: DispatchRequest,
): Promise<Record<string, unknown> | null> {
  const { id, method } = request;
  const params = asRecord(request.params);

  if (method === "te2.ping") {
    return success(id, { ok: true, ts_ms: runtime.nowMs() });
  }

  if (method === "te2.resync") {
    return success(id, runtime.wb.resync());
  }

  if (method === "te2.language_catalog") {
    return success(id, await runtime.wb.languageCatalog());
  }

  if (method === "vscode.webview.attach") {
    return success(id, runtime.wb.webviewAttach(params));
  }

  if (method === "vscode.webview.message") {
    return success(id, runtime.wb.webviewMessage(params));
  }

  if (method === "vscode.webview.state") {
    return success(id, runtime.wb.webviewState(params));
  }

  if (method === "vscode.webview.visibility") {
    return success(id, runtime.wb.webviewVisibility(params));
  }

  if (method === "vscode.webview.dispose") {
    return success(id, runtime.wb.webviewDispose(params));
  }

  if (method === "te2.status" || method === "adapter.status") {
    return success(id, runtime.buildStatusResult());
  }

  if (method === "adapter.events") {
    const limit = Number.isFinite(Number(params.limit))
      ? Math.max(0, Math.min(5000, Number(params.limit)))
      : 200;
    const slice = limit
      ? runtime.eventLog.slice(-limit)
      : [...runtime.eventLog];
    if (params.clear === true) runtime.eventLog.length = 0;
    return success(id, {
      ok: true,
      ts_ms: runtime.nowMs(),
      count: runtime.eventLog.length,
      events: slice,
    });
  }

  if (method === "adapter.shutdown") {
    runtime.requestShutdown();
    return success(id, { ok: true, ts_ms: runtime.nowMs() });
  }

  if (method === "adapter.connect") {
    const result = await runtime.wb.connect({
      proxyHttp: params.proxyHttp ?? runtime.state.config.proxyHttp,
      codeServerSocketPath:
        params.codeServerSocketPath ??
        runtime.state.config.codeServerSocketPath,
      token: params.token,
      folder: params.folder,
      authority: params.authority ?? runtime.defaultRemoteAuthority,
      serverRootPath: params.serverRootPath,
      commit: params.commit,
      proxyUri: params.proxyUri,
    });
    runtime.buildStatusResult();
    runtime.logStatus("adapter_connected");
    runtime.emitTe2Event({
      type: "adapter/ready",
      ts_ms: runtime.nowMs(),
      session: runtime.state.session,
    });
    return success(id, result);
  }

  if (method === "adapter.disconnect") {
    try {
      runtime.wb.disconnect?.();
    } catch {
      // Preserve current best-effort disconnect behavior.
    }
    resetDisconnectedSession(runtime.state.session);
    runtime.logStatus("adapter_disconnected");
    return success(id, { ok: true, ts_ms: runtime.nowMs() });
  }

  if (method === "adapter.resubscribeWatcher") {
    try {
      await runtime.wb.resubscribeWatcher();
      return success(id, { ok: true, ts_ms: runtime.nowMs() });
    } catch (error) {
      return failure(id, -32000, error);
    }
  }

  if (method === "adapter.switchWorkspace") {
    const folder =
      stringValue(params.folder) ?? stringValue(params.workspaceFolder);
    if (!folder) return failure(id, -32602, "Missing required param: folder");
    try {
      const result = await runtime.wb._switchWorkspace(folder);
      mergeWorkbenchState(runtime);
      runtime.logStatus("workspace_switched");
      return success(id, {
        ok: true,
        ts_ms: runtime.nowMs(),
        workspaceFolder: folder,
        ...result,
      });
    } catch (error) {
      return failure(id, -32000, error);
    }
  }

  if (method === "adapter.reconnect") {
    const workspaceFolder =
      stringValue(params.workspaceFolder) ?? stringValue(params.folder);
    if (!workspaceFolder)
      return failure(id, -32602, "Missing required param: workspaceFolder");
    const previousWorkspaceFolder =
      stringValue(runtime.state.session.workspaceFolder) ??
      stringValue(field(runtime.wb.state, "workspaceFolder"));
    try {
      runtime.emitTe2Event({
        type: "adapter/sessionReset",
        ts_ms: runtime.nowMs(),
        reason: "reconnect",
        from: previousWorkspaceFolder,
        to: workspaceFolder,
        workspaceFolder,
      });
      runtime.wb.disconnect?.();
      const result = await runtime.wb.connect({
        folder: workspaceFolder,
        authority: params.authority ?? runtime.defaultRemoteAuthority,
        proxyHttp: params.proxyHttp ?? runtime.defaultCodeServerHttp,
        codeServerSocketPath:
          params.codeServerSocketPath ??
          runtime.state.config.codeServerSocketPath,
        token: params.token ?? "00000000000000000000",
      });
      mergeWorkbenchState(runtime);
      runtime.logStatus("adapter_reconnected");
      runtime.emitTe2Event({
        type: "workspace/switched",
        ts_ms: runtime.nowMs(),
        from: previousWorkspaceFolder,
        to: workspaceFolder,
        workspaceFolder,
        readyForDocumentOpen: true,
        reconnect: true,
      });
      runtime.emitTe2Event({
        type: "adapter/ready",
        ts_ms: runtime.nowMs(),
        session: runtime.state.session,
      });
      return success(id, {
        ok: true,
        ts_ms: runtime.nowMs(),
        readyForDocumentOpen: true,
        previousWorkspaceFolder,
        workspaceFolder,
        reconnect: true,
        ...result,
      });
    } catch (error) {
      runtime.logStatus("adapter_reconnect_error");
      return failure(id, -32000, error);
    }
  }

  if (method === "adapter.heapSnapshot") {
    const label = stringValue(params.label) ?? "manual";
    const snapshot = runtime.takeHeapSnapshot(label, stringValue(params.path));
    return success(id, { ok: true, ts_ms: runtime.nowMs(), ...snapshot });
  }

  if (method === "adapter.providers") {
    const result = runtime.wb.providers?.() ?? {
      hover: [],
      documentSymbols: [],
    };
    return success(id, { ok: true, ts_ms: runtime.nowMs(), ...result });
  }

  if (method === "extensions.activity.snapshot") {
    return success(id, runtime.wb.extensionActivitySnapshot());
  }

  if (method === "extensions.logs.select") {
    try {
      return success(id, await runtime.wb.selectExtensionLog(params));
    } catch (error) {
      return failure(id, -32602, error);
    }
  }

  if (method === "vscode.extensionMenus.resolve") {
    try {
      return success(id, await runtime.wb.extensionMenuResolve(params));
    } catch (error) {
      return failure(id, -32602, error);
    }
  }

  if (method === "vscode.extensionCommands.execute") {
    try {
      return success(id, await runtime.wb.extensionCommandExecute(params));
    } catch (error) {
      return failure(id, -32000, error);
    }
  }

  if (method === "extensions.activateByEvent") {
    try {
      const activationKind = Number.isFinite(Number(params.activationKind))
        ? Number(params.activationKind)
        : 0;
      return success(
        id,
        await runtime.wb.activateByEvent(
          params.event,
          activationKind,
          boundedTimeout(params.timeoutMs),
        ),
      );
    } catch (error) {
      return failure(id, -32602, error);
    }
  }

  if (method === "extensions.activate") {
    try {
      return success(
        id,
        await runtime.wb.activateExtension(
          params.extensionId,
          params.activationEvent,
          boundedTimeout(params.timeoutMs),
        ),
      );
    } catch (error) {
      return failure(id, -32602, error);
    }
  }

  if (method === "adapter.configure") {
    if (typeof params.upstreamHttp === "string")
      runtime.state.config.upstreamHttp = params.upstreamHttp;
    if (typeof params.proxyHttp === "string")
      runtime.state.config.proxyHttp = params.proxyHttp;
    if (typeof params.codeServerSocketPath === "string")
      runtime.state.config.codeServerSocketPath =
        params.codeServerSocketPath.trim() || null;
    return success(id, {
      ok: true,
      ts_ms: runtime.nowMs(),
      config: runtime.state.config,
    });
  }

  if (LANGUAGE_ACTIVATION_METHODS.has(method)) {
    const resolvedPath = runtime.normalizePathParam(params);
    const languageId = runtime.wb.resolveLanguageId(
      resolvedPath,
      String(params.text ?? ""),
      params.languageId,
    );
    try {
      await runtime.wb.activateLanguage(languageId);
    } catch (error) {
      return failure(id, -32000, error);
    }
  }

  if (method === "vscode.logicalDocuments.reconcile") {
    return success(id, runtime.wb.reconcileLogicalDocuments(params));
  }

  if (method === "vscode.logicalDocuments.hydrate") {
    try {
      return success(id, await runtime.wb.hydrateLogicalDocument(params));
    } catch (error) {
      return failure(id, -32000, error);
    }
  }

  if (method === "vscode.openFile") {
    const resolvedPath = runtime.normalizePathParam(params);
    const requestId = stringValue(params.requestId);
    const forceRefreshReq = params.forceRefresh === true;
    if (!resolvedPath) return missingPathError(id);

    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const alreadyActive = resolvedPath === runtime.wb.state?.activePath;
    const forceRefreshEff = forceRefreshReq || (alreadyActive && !!requestId);
    runtime.log(
      `[server] vscode.openFile ENTER path=${resolvedPath} id=${id} requestId=${requestId || "-"} alreadyActive=${alreadyActive ? 1 : 0} forceRefresh_req=${forceRefreshReq ? 1 : 0} forceRefresh_eff=${forceRefreshEff ? 1 : 0}`,
    );
    runtime.scheduleOpenFileSnapshot();

    const result = await runtime.wb.openFile({
      path: resolvedPath,
      languageId: params.languageId,
      authority,
      forceRefresh: forceRefreshEff,
      generation: params.generation,
      workspaceFolder: params.workspaceFolder ?? null,
    });
    runtime.log(`[server] wb.openFile returned for ${resolvedPath}`);
    runtime.logStatus("open_file", { path: resolvedPath });
    return success(id, {
      ...result,
      path: resolvedPath,
      uri: runtime.vscodeRemoteUri(authority, resolvedPath),
    });
  }

  if (method === "vscode.documentSymbols") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const result = await runtime.wb.documentSymbols({
      path: resolvedPath,
      authority,
      providerHandle: params.providerHandle,
      languageId: params.languageId,
      timeoutMs: params.timeoutMs,
      generation: params.generation,
    });
    return success(id, result);
  }

  if (method === "vscode.foldingRanges") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const result = await runtime.wb.foldingRanges({
      path: resolvedPath,
      authority,
      providerHandle: params.providerHandle,
      languageId: params.languageId,
      timeoutMs: params.timeoutMs,
      generation: params.generation,
      context: params.context,
    });
    return success(id, result);
  }

  if (method === "vscode.hover") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const result = await runtime.wb.hover({
      path: resolvedPath,
      authority,
      providerHandle: params.providerHandle,
      languageId: params.languageId,
      lineNumber: params.lineNumber,
      column: params.column,
      timeoutMs: params.timeoutMs,
    });
    return success(id, result);
  }

  if (method === "vscode.documentHighlights") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    return success(
      id,
      await runtime.wb.documentHighlights({
        path: resolvedPath,
        authority,
        languageId: params.languageId,
        lineNumber: params.lineNumber,
        column: params.column,
        timeoutMs: params.timeoutMs,
      }),
    );
  }

  if (method === "vscode.references") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    return success(
      id,
      await runtime.wb.references({
        path: resolvedPath,
        authority,
        languageId: params.languageId,
        lineNumber: params.lineNumber,
        column: params.column,
        includeDeclaration: params.includeDeclaration,
        timeoutMs: params.timeoutMs,
      }),
    );
  }

  if (method === "vscode.definition") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    return success(
      id,
      await runtime.wb.definitions({
        path: resolvedPath,
        authority,
        languageId: params.languageId,
        lineNumber: params.lineNumber,
        column: params.column,
        timeoutMs: params.timeoutMs,
      }),
    );
  }

  if (method === "vscode.implementations") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    return success(
      id,
      await runtime.wb.implementations({
        path: resolvedPath,
        authority,
        languageId: params.languageId,
        lineNumber: params.lineNumber,
        column: params.column,
        timeoutMs: params.timeoutMs,
      }),
    );
  }

  if (method === "vscode.callHierarchy.prepare") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    return success(
      id,
      await runtime.wb.prepareCallHierarchy({
        path: resolvedPath,
        authority,
        languageId: params.languageId,
        lineNumber: params.lineNumber,
        column: params.column,
        timeoutMs: params.timeoutMs,
      }),
    );
  }

  if (method === "vscode.callHierarchy.incoming") {
    return success(id, await runtime.wb.incomingCalls(params));
  }

  if (method === "vscode.callHierarchy.outgoing") {
    return success(id, await runtime.wb.outgoingCalls(params));
  }

  if (method === "vscode.callHierarchy.release") {
    return success(id, runtime.wb.releaseCallHierarchy(params));
  }

  if (method === "vscode.completions") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const result = await runtime.wb.completions({
      path: resolvedPath,
      authority,
      providerHandle: params.providerHandle,
      languageId: params.languageId,
      lineNumber: params.lineNumber,
      column: params.column,
      triggerKind: params.triggerKind,
      triggerCharacter: params.triggerCharacter,
      text: params.text,
      timeoutMs: params.timeoutMs,
    });
    return success(id, result);
  }

  if (method === "vscode.documentColors") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const result = await runtime.wb.documentColors({
      path: resolvedPath,
      authority,
      providerHandle: params.providerHandle,
      languageId: params.languageId,
      text: params.text,
      modelVersionId: params.modelVersionId,
      timeoutMs: params.timeoutMs,
    });
    return success(id, result);
  }

  if (method === "vscode.colorPresentations") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const result = await runtime.wb.colorPresentations({
      path: resolvedPath,
      authority,
      providerHandle: params.providerHandle,
      languageId: params.languageId,
      colorInfo: params.colorInfo,
      timeoutMs: params.timeoutMs,
    });
    return success(id, result);
  }

  if (method === "vscode.inlayHints") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const result = await runtime.wb.inlayHints({
      path: resolvedPath,
      authority,
      providerHandle: params.providerHandle,
      languageId: params.languageId,
      range: params.range,
      text: params.text,
      modelVersionId: params.modelVersionId,
      timeoutMs: params.timeoutMs,
    });
    return success(id, result);
  }

  if (method === "vscode.inlayHints.resolve") {
    const result = await runtime.wb.resolveInlayHint({
      providerHandle: params.providerHandle,
      cacheId: params.cacheId,
    });
    return success(id, result);
  }

  if (method === "vscode.inlayHints.release") {
    const result = await runtime.wb.releaseInlayHints({
      providerHandle: params.providerHandle,
      cacheId: params.cacheId,
    });
    return success(id, result);
  }

  if (method === "vscode.inlineCompletions") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const result = await runtime.wb.inlineCompletions({
      path: resolvedPath,
      authority,
      providerHandle: params.providerHandle,
      languageId: params.languageId,
      lineNumber: params.lineNumber,
      column: params.column,
      context: params.context,
      text: params.text,
      modelVersionId: params.modelVersionId,
      timeoutMs: params.timeoutMs,
    });
    return success(id, result);
  }

  if (method === "vscode.inlineCompletions.free") {
    const result = await runtime.wb.freeInlineCompletions({
      providerHandle: params.providerHandle,
      pid: params.pid,
      reason: params.reason,
    });
    return success(id, result);
  }

  if (method === "vscode.inlineCompletions.didShow") {
    const result = await runtime.wb.handleInlineCompletionDidShow({
      providerHandle: params.providerHandle,
      pid: params.pid,
      idx: params.idx,
      updatedInsertText: params.updatedInsertText,
    });
    return success(id, result);
  }

  if (method === "vscode.semanticTokens") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const result = await runtime.wb.semanticTokens({
      path: resolvedPath,
      authority,
      providerHandle: params.providerHandle,
      languageId: params.languageId,
      previousResultId: params.previousResultId,
      text: params.text,
      modelVersionId: params.modelVersionId,
      timeoutMs: params.timeoutMs,
    });
    return success(id, result);
  }

  if (method === "vscode.semanticTokensLegend") {
    const languageId = String(params.languageId || "");
    const legend = await runtime.wb.getSemanticTokensLegend(languageId);
    return success(id, { ok: !!legend, legend });
  }

  if (method === "vscode.semanticTokensRange") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const authority = runtime.normalizeAuthorityParam(
      params,
      runtime.defaultRemoteAuthority,
    );
    const result = await runtime.wb.semanticTokensRange({
      path: resolvedPath,
      authority,
      providerHandle: params.providerHandle,
      languageId: params.languageId,
      range: params.range,
      text: params.text,
      modelVersionId: params.modelVersionId,
      timeoutMs: params.timeoutMs,
    });
    runtime.log(
      `[semanticTokensRange_reply] ok=${String((result as { ok?: unknown })?.ok)} hasData=${!!field(field(result, "result"), "data")} dataLen=${Array.isArray(field(field(result, "result"), "data")) ? (field(field(result, "result"), "data") as unknown[]).length : 0}`,
    );
    return success(id, result);
  }

  if (method === "vscode.didChange") {
    const resolvedPath = runtime.normalizePathParam(params);
    if (!resolvedPath) return missingPathError(id);
    const result = runtime.wb.didChange({
      path: resolvedPath,
      text: String(params.text ?? ""),
      languageId: params.languageId,
      generation: params.generation,
    });
    return success(id, result);
  }

  return null;
}
