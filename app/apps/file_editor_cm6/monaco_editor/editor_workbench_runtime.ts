import { isAdapterReady, wbIsFrameworkReady, wbIsBarrierOpen } from './editor_workbench_barrier_utils.js';
import { wbEmitDidChange } from './editor_workbench_emit_utils.js';
import { wbFlushDidChangeIfReady, wbFlushPendingAfterOpen, wbFlushSymbolsIfReady, wbPublishDidChange } from './editor_workbench_flush_utils.js';
import { wbBumpGeneration } from './editor_workbench_generation_utils.js';
import { wbCurrentGeneration, wbQueueDidChange, wbQueueSymbols, wbSetOpenAck } from './editor_workbench_state_utils.js';
import { EDITOR_RPC_METHODS, editorWorkbenchMethodToRpcMethod } from './editor_rpc_contract.ts';

interface MonacoUriLike {
  toString(): string;
}

interface MonacoModelLike {
  uri?: MonacoUriLike;
  getLanguageId?(): string;
  getVersionId?(): number;
  getValue?(): string;
}

interface MonacoMarkerLike {
  severity?: number;
  startLineNumber?: number;
}

interface MonacoEditorNamespaceLike {
  getModelMarkers?(opts: { resource: MonacoUriLike }): MonacoMarkerLike[];
  setModelMarkers?(model: MonacoModelLike, owner: string, markers: Record<string, unknown>[]): void;
}

interface MonacoMarkerSeverityLike {
  Error?: number;
  Warning?: number;
  Info?: number;
  Hint?: number;
}

interface MonacoLike {
  editor?: MonacoEditorNamespaceLike;
  MarkerSeverity?: MonacoMarkerSeverityLike;
}

interface EditorContributionLike {
  triggerFoldingModelChanged?(): void;
  getFoldingModel?(): Promise<unknown> | null;
  _stickyLineCandidateProvider?: { update?(): Promise<void> };
  _updateState?(): Promise<void>;
}

interface EditorLike {
  getModel?(): MonacoModelLike | null;
  getContribution?(id: string): EditorContributionLike | null;
}

interface EditorSocketLike {
  connected?: boolean;
  emit?(eventName: string, payload: Record<string, unknown>): void;
}

interface WorkbenchPendingEntry {
  timer: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface LanguageContextLike {
  uri: string;
  path: string;
  languageId: string;
  version: number;
}

interface WorkbenchFlowLike {
  generation: number;
  activePath: string;
  openAckGeneration: number;
  openAckPath: string;
  pendingDidChange: Record<string, unknown> | null;
  pendingSymbols: Record<string, unknown> | null;
}

interface LanguageBridgeLike {
  hoverSeq: number;
  completionsSeq: number;
}

interface WorkbenchRuntimeDeps {
  getWindow(): Window & typeof globalThis;
  getMonaco(): MonacoLike | null;
  getEditorSocket(): EditorSocketLike | null;
  getEditor(): EditorLike | null;
  getModel(): MonacoModelLike | null;
  getCurrentPath(): string | null;
  emitToHost(eventName: string, payload: Record<string, unknown>): void;
  absPathFromVscodeUri(raw: string): string | null;
  languageFromPath(path: string): string;
  isLanguageContextCurrent(ctx: unknown, nowCtx: unknown): boolean;
  getLanguageBridge(): LanguageBridgeLike;
  setDebugDiag(value: string): void;
  requestBreadcrumbSymbols(path: string, opts?: { generation?: number; fromQueue?: boolean }): void;
  languageWorkersEnabled(): boolean;
  isRpcConnected(): boolean;
  rpcCall(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  rpcNotify(method: string, params: Record<string, unknown>): boolean;
  clearTimeoutFn(timer: ReturnType<typeof setTimeout>): void;
  setTimeoutFn(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function createEditorWorkbenchRuntime(
  deps: WorkbenchRuntimeDeps,
): {
  applyDiagnosticsUpdate(params: unknown): void;
  emitAggregatedDiagCounts(path?: string | null): void;
  clearDiagnosticsForSwitch(): void;
  currentLanguageContext(): LanguageContextLike | null;
  wbCurrentGeneration(): number;
  wbBumpGeneration(path: string | null, reason: string): number;
  wbIsFrameworkReady(): boolean;
  wbIsBarrierOpen(path: string | null, generation?: number): boolean;
  wbSetOpenAck(path: string, generation: number): void;
  wbQueueDidChange(path: string, text: string, languageId: string, generation: number): void;
  wbQueueSymbols(path: string, generation: number): void;
  wbEmitDidChange(payload: Record<string, unknown>): boolean;
  wbFlushDidChangeIfReady(): void;
  wbFlushSymbolsIfReady(): void;
  wbFlushPendingAfterOpen(): void;
  wbSchedulePostReadyStructureRefresh(path: string, generation: number, reason?: string): void;
  wbPublishDidChange(path: string, text: string, languageId: string, generation: number): boolean;
  wbOpenFileFlow(opts: Record<string, unknown>): Promise<unknown>;
  replayOpenFileAfterBaton(): void;
  editorWorkbenchCall(method: string, params?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  callVscodeApiGuarded(kind: string, method: string, params: Record<string, unknown>, ctx: unknown, opts?: { timeoutMs?: number; cancelToken?: { isCancellationRequested?: boolean } | null }): Promise<Record<string, unknown>>;
  getPendingRequests(): Map<string, WorkbenchPendingEntry>;
} {
  let diagState: { rx: number; apply: number; drop_no_path: number; drop_no_model: number; drop_mismatch: number } | null = null;
  let diagKnownOwners: Set<string> | null = null;
  const workbenchPending = new Map<string, WorkbenchPendingEntry>();
  let wbNextId = 1;
  let wbPostReadyRefreshSeq = 0;
  const wbFlow: WorkbenchFlowLike = {
    generation: 0,
    activePath: '',
    openAckGeneration: -1,
    openAckPath: '',
    pendingDidChange: null,
    pendingSymbols: null,
  };

  function emitAggregatedDiagCounts(path?: string | null): void {
    try {
      const model = deps.getModel();
      const monacoRef = deps.getMonaco();
      if (!model || !model.uri || !monacoRef || !monacoRef.editor || !monacoRef.editor.getModelMarkers || !monacoRef.MarkerSeverity) return;
      const all = monacoRef.editor.getModelMarkers({ resource: model.uri }) || [];
      let errors = 0;
      let warnings = 0;
      let hints = 0;
      for (const marker of all) {
        const severity = marker.severity;
        if (severity === monacoRef.MarkerSeverity.Error) errors += 1;
        else if (severity === monacoRef.MarkerSeverity.Warning) warnings += 1;
        else hints += 1;
      }
      deps.emitToHost('editor_diagnostics_counts', {
        errors,
        warnings,
        hints,
        total: all.length,
        path: path || deps.getCurrentPath() || '',
      });
    } catch (_) {}
  }

  function clearDiagnosticsForSwitch(): void {
    try {
      const model = deps.getModel();
      const monacoRef = deps.getMonaco();
      if (model && monacoRef && monacoRef.editor && monacoRef.editor.setModelMarkers) {
        if (diagKnownOwners && diagKnownOwners.size) {
          diagKnownOwners.forEach((owner) => {
            try { monacoRef.editor!.setModelMarkers!(model, owner, []); } catch (_) {}
          });
        }
        monacoRef.editor.setModelMarkers(model, 'vscode_api', []);
      }
      diagKnownOwners = new Set();
      deps.emitToHost('editor_diagnostics_counts', {
        errors: 0,
        warnings: 0,
        hints: 0,
        total: 0,
        path: deps.getCurrentPath() || '',
      });
    } catch (_) {}
  }

  function applyDiagnosticsUpdate(params: unknown): void {
    try {
      const monacoRef = deps.getMonaco();
      const markerSeverity = monacoRef && monacoRef.MarkerSeverity;
      const editorNs = monacoRef && monacoRef.editor;
      if (!markerSeverity || !editorNs || !editorNs.setModelMarkers || !editorNs.getModelMarkers) return;
      if (!diagState) diagState = { rx: 0, apply: 0, drop_no_path: 0, drop_no_model: 0, drop_mismatch: 0 };
      diagState.rx += 1;

      const model = deps.getModel();
      const currentPath = deps.getCurrentPath();
      const owner = params && typeof params === 'object' && (params as { owner?: unknown }).owner != null
        ? String((params as { owner?: unknown }).owner)
        : 'workbench';
      const activeUri = model && model.uri ? String(model.uri.toString()) : '';
      const activePath = currentPath ? String(currentPath) : (activeUri ? deps.absPathFromVscodeUri(activeUri) : '');
      const items = params && typeof params === 'object' && Array.isArray((params as { items?: unknown[] }).items)
        ? (params as { items: unknown[] }).items
        : [];
      let didApply = false;

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const itemPath = deps.absPathFromVscodeUri(String((item as { uri?: unknown; resource?: unknown }).uri || (item as { resource?: unknown }).resource || ''));
        if (!itemPath) {
          diagState.drop_no_path += 1;
          try {
            if ((deps.getWindow() as Window & { __debugVscodeApiDiag?: boolean }).__debugVscodeApiDiag) {
              console.log('[vscode_api] diag drop_no_path item.uri=', (item as { uri?: unknown }).uri);
            }
          } catch (_) {}
          continue;
        }

        const markers = Array.isArray((item as { markers?: unknown[] }).markers) ? (item as { markers: unknown[] }).markers : [];
        const outMarkers = markers.map((marker) => {
          const m = (marker && typeof marker === 'object' ? marker : {}) as Record<string, unknown>;
          const sev = Number(m.severity || 3);
          let severity = markerSeverity.Info;
          if (sev === 8) severity = markerSeverity.Error;
          else if (sev === 4) severity = markerSeverity.Warning;
          else if (sev === 2) severity = markerSeverity.Info;
          else if (sev === 1 && markerSeverity.Hint != null) severity = markerSeverity.Hint;
          let code: string | undefined;
          try {
            if (typeof m.code === 'string' || typeof m.code === 'number') code = String(m.code);
            else if (m.code && typeof m.code === 'object' && (m.code as { value?: unknown }).value != null) code = String((m.code as { value?: unknown }).value);
          } catch (_) {}
          return {
            severity,
            message: m.message != null ? String(m.message) : '',
            startLineNumber: Math.max(1, asNumber(m.startLineNumber, 1)),
            startColumn: Math.max(1, asNumber(m.startColumn, 1)),
            endLineNumber: Math.max(1, asNumber(m.endLineNumber != null ? m.endLineNumber : m.startLineNumber, 1)),
            endColumn: Math.max(1, asNumber(m.endColumn != null ? m.endColumn : m.startColumn, 1)),
            source: m.source != null ? String(m.source) : 'vscode',
            code,
          };
        });

        if (model && model.uri && activePath && itemPath === activePath) {
          try {
            if (!diagKnownOwners) diagKnownOwners = new Set();
            diagKnownOwners.add(owner);
            console.log('[vscode_api] setModelMarkers owner=' + owner + ' count=' + outMarkers.length + ' sevs=[' + outMarkers.map((m) => m.severity).join(',') + '] lines=[' + outMarkers.map((m) => m.startLineNumber).join(',') + ']');
            if (outMarkers.length > 0) console.log('[vscode_api] marker[0]:', JSON.stringify(outMarkers[0]));
            editorNs.setModelMarkers(model, owner, outMarkers);
            const verify = editorNs.getModelMarkers({ resource: model.uri }) || [];
            console.log('[vscode_api] verify getModelMarkers count=' + verify.length);
            emitAggregatedDiagCounts(itemPath);
          } catch (error) {
            console.error('[vscode_api] setModelMarkers THREW:', error);
          }
          didApply = true;
          diagState.apply += 1;
        } else if (model && model.uri && activePath && itemPath !== activePath) {
          diagState.drop_mismatch += 1;
          try {
            if ((deps.getWindow() as Window & { __debugVscodeApiDiag?: boolean }).__debugVscodeApiDiag) {
              console.log('[vscode_api] diag mismatch itemPath=', itemPath, 'activePath=', activePath);
            }
          } catch (_) {}
        } else if (!model || !model.uri) {
          diagState.drop_no_model += 1;
        }
      }

      deps.setDebugDiag('diag=rx' + diagState.rx + '/ap' + diagState.apply + '/np' + diagState.drop_no_path + '/nm' + diagState.drop_no_model + '/mm' + diagState.drop_mismatch);
      if (!didApply) {
        // no-op: stale/mismatched diagnostics are intentionally dropped
      }
    } catch (_) {}
  }

  function currentLanguageContext(): LanguageContextLike | null {
    try {
      const model = deps.getModel();
      if (!model || !model.uri) return null;
      const uri = String(model.uri.toString());
      if (!uri) return null;
      const currentPath = deps.getCurrentPath();
      const path = currentPath ? String(currentPath) : (deps.absPathFromVscodeUri(uri) || '');
      if (!path) return null;
      const languageId = String(model.getLanguageId ? model.getLanguageId() : deps.languageFromPath(path));
      const version = Number(model.getVersionId ? model.getVersionId() : 1) || 1;
      return { uri, path, languageId, version };
    } catch (_) {
      return null;
    }
  }

  function currentGeneration(): number {
    return wbCurrentGeneration(wbFlow);
  }

  function bumpGeneration(path: string | null, reason: string): number {
    return wbBumpGeneration(wbFlow, path, reason);
  }

  function frameworkReady(): boolean {
    return wbIsFrameworkReady(deps.getEditor(), deps.getModel(), deps.getCurrentPath());
  }

  function barrierOpen(path: string | null, generation?: number): boolean {
    return wbIsBarrierOpen({
      win: deps.getWindow(),
      editor: deps.getEditor(),
      model: deps.getModel(),
      currentPath: deps.getCurrentPath(),
      wbFlow,
      path,
      generation,
      currentGeneration: currentGeneration(),
    });
  }

  function setOpenAck(path: string, generation: number): void {
    wbSetOpenAck(wbFlow, path, generation, currentGeneration);
  }

  function queueDidChange(path: string, text: string, languageId: string, generation: number): void {
    wbQueueDidChange(wbFlow, path, text, languageId, generation, currentGeneration);
  }

  function queueSymbols(path: string, generation: number): void {
    wbQueueSymbols(wbFlow, path, generation, currentGeneration);
  }

  function emitDidChange(payload: Record<string, unknown>): boolean {
    if (deps.isRpcConnected()) {
      return deps.rpcNotify(EDITOR_RPC_METHODS.workbenchDidChange, {
        path: payload.path,
        text: String(payload.text || ''),
        languageId: String(payload.languageId || ''),
        generation: Number.isFinite(Number(payload.generation)) ? Number(payload.generation) : currentGeneration(),
      });
    }
    return wbEmitDidChange(deps.getEditorSocket(), payload, currentGeneration);
  }

  function flushDidChangeIfReady(): void {
    wbFlushDidChangeIfReady(wbFlow, barrierOpen, emitDidChange);
  }

  function flushSymbolsIfReady(): void {
    wbFlushSymbolsIfReady(wbFlow, barrierOpen, deps.requestBreadcrumbSymbols);
  }

  function flushPendingAfterOpen(): void {
    wbFlushPendingAfterOpen(flushDidChangeIfReady, flushSymbolsIfReady);
  }

  function schedulePostReadyStructureRefresh(path: string, generation: number, reason?: string): void {
    if (deps.languageWorkersEnabled()) return;
    const wantPath = String(path || '');
    if (!wantPath) return;
    const wantGeneration = Number.isFinite(Number(generation)) ? Number(generation) : currentGeneration();
    const refreshSeq = ++wbPostReadyRefreshSeq;
    deps.setTimeoutFn(() => {
      Promise.resolve().then(async () => {
        if (refreshSeq !== wbPostReadyRefreshSeq) return;
        if (!barrierOpen(wantPath, wantGeneration)) return;
        if (String(deps.getCurrentPath() || '') !== wantPath) return;
        if (currentGeneration() !== wantGeneration) return;

        const activeEditor = deps.getEditor();
        const activeModel = activeEditor && typeof activeEditor.getModel === 'function' ? activeEditor.getModel() : null;
        if (!activeEditor || !activeModel || !activeModel.uri) return;
        if (String(deps.absPathFromVscodeUri(String(activeModel.uri.toString()))) !== wantPath) return;

        let folding: EditorContributionLike | null = null;
        try {
          folding = activeEditor.getContribution ? activeEditor.getContribution('editor.contrib.folding') : null;
          if (folding && typeof folding.triggerFoldingModelChanged === 'function') {
            folding.triggerFoldingModelChanged();
          }
        } catch (error) {
          console.warn('[readiness] post-ready folding trigger failed (' + String(reason || 'open') + ')', error);
        }

        try {
          const sticky = activeEditor.getContribution
            ? (activeEditor.getContribution('store.contrib.stickyScrollController') || activeEditor.getContribution('editor.contrib.stickyScrollController'))
            : null;
          const stickyProvider = sticky && sticky._stickyLineCandidateProvider;
          if (stickyProvider && typeof stickyProvider.update === 'function') {
            await stickyProvider.update();
          }
          if (refreshSeq !== wbPostReadyRefreshSeq) return;
          if (!barrierOpen(wantPath, wantGeneration)) return;
          if (String(deps.getCurrentPath() || '') !== wantPath) return;
          if (currentGeneration() !== wantGeneration) return;
          if (sticky && typeof sticky._updateState === 'function') {
            await sticky._updateState();
          }
        } catch (error) {
          console.warn('[readiness] post-ready sticky refresh failed (' + String(reason || 'open') + ')', error);
        }

        try {
          const foldingModelPromise = folding && typeof folding.getFoldingModel === 'function' ? folding.getFoldingModel() : null;
          if (foldingModelPromise && typeof foldingModelPromise.then === 'function') {
            foldingModelPromise.then(() => {}, () => {});
          }
        } catch (error) {
          console.warn('[readiness] post-ready folding warmup failed (' + String(reason || 'open') + ')', error);
        }
      }).catch((error) => {
        console.warn('[readiness] post-ready structure refresh failed (' + String(reason || 'open') + ')', error);
      });
    }, 0);
  }

  function publishDidChange(path: string, text: string, languageId: string, generation: number): boolean {
    return wbPublishDidChange(
      wbFlow,
      path,
      text,
      languageId,
      generation,
      currentGeneration,
      barrierOpen,
      emitDidChange,
      queueDidChange,
    );
  }

  function editorWorkbenchCall(method: string, params?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown> {
    const rpcMethod = editorWorkbenchMethodToRpcMethod(method);
    if (rpcMethod && deps.isRpcConnected()) {
      return deps.rpcCall(rpcMethod, params || {}, opts);
    }
    const timeoutMs = opts && Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 12000;
    const requestId = 'wb_' + (wbNextId++) + '_' + Date.now();
    const eventName = 'editor_workbench_' + method;
    return new Promise((resolve, reject) => {
      const timer = deps.setTimeoutFn(() => {
        if (!workbenchPending.has(requestId)) return;
        workbenchPending.delete(requestId);
        reject(new Error('workbench timeout: ' + method));
      }, timeoutMs);

      workbenchPending.set(requestId, { resolve, reject, timer });
      const socket = deps.getEditorSocket();
      if (!socket || !socket.connected || typeof socket.emit !== 'function') {
        deps.clearTimeoutFn(timer);
        workbenchPending.delete(requestId);
        reject(new Error('editor socket not connected'));
        return;
      }

      const payload = Object.assign({}, params || {}, { request_id: requestId });
      console.log('[editorWorkbenchCall] EMIT ' + eventName + ' reqId=' + requestId + ' connected=' + socket.connected);
      socket.emit(eventName, payload);
    });
  }

  function openFileFlow(opts: Record<string, unknown>): Promise<unknown> {
    const path = String(opts.path || '');
    const generation = Number.isFinite(Number(opts.generation)) ? Number(opts.generation) : currentGeneration();
    const languageId = String(opts.languageId || '');
    const requestId = String(opts.requestId || ('diag_' + Date.now() + '_open'));
    const source = String(opts.source || 'open');
    const socket = deps.getEditorSocket();
    if (!path || !socket || !socket.connected || typeof socket.emit !== 'function') return Promise.resolve({ ok: false, deferred: true });

    try {
      socket.emit('editor_diagnostics_consumer_pending', { path, request_id: requestId });
    } catch (_) {}

    if (!isAdapterReady(deps.getWindow())) {
      console.log('[readiness] open_file deferred (' + source + ') - waiting for baton');
      return Promise.resolve({ ok: false, deferred: true });
    }

    return editorWorkbenchCall('open_file', {
      path,
      languageId,
      uri: String(opts.uri || ''),
      requestId,
      forceRefresh: !!opts.forceRefresh,
      generation,
    }, { timeoutMs: Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 8000 }).then((result) => {
      if (generation !== currentGeneration() || String(path) !== String(deps.getCurrentPath() || '')) {
        return { ok: false, stale: true };
      }
      setOpenAck(path, generation);
      try {
        socket.emit!('editor_diagnostics_consumer_ready', { path, request_id: requestId });
      } catch (_) {}
      flushPendingAfterOpen();
      schedulePostReadyStructureRefresh(path, generation, source);
      return result;
    });
  }

  function replayOpenFileAfterBaton(): void {
    const currentPath = deps.getCurrentPath();
    const editor = deps.getEditor();
    if (!currentPath || !editor) return;
    const model = typeof editor.getModel === 'function' ? editor.getModel() : null;
    if (!model) return;
    let generation = currentGeneration();
    if (!generation || String(wbFlow.activePath || '') !== String(currentPath || '')) {
      generation = bumpGeneration(currentPath, 'baton_replay');
    }
    const replayReqId = 'baton_' + Date.now();
    const languageId = (model.getLanguageId ? model.getLanguageId() : '') || '';
    console.log('[readiness] baton arrived, replaying open_file for', currentPath);
    try {
      const content = model.getValue ? model.getValue() : '';
      queueDidChange(currentPath, content, languageId, generation);
    } catch (_) {}
    queueSymbols(currentPath, generation);
    openFileFlow({
      path: currentPath,
      languageId,
      uri: model && model.uri ? String(model.uri.toString()) : '',
      requestId: replayReqId,
      forceRefresh: true,
      generation,
      source: 'baton',
      timeoutMs: 8000,
    }).catch((error) => {
      console.warn('[readiness] baton replay open_file failed', error);
    });
  }

  function callVscodeApiGuarded(kind: string, _method: string, params: Record<string, unknown>, ctx: unknown, opts?: { timeoutMs?: number; cancelToken?: { isCancellationRequested?: boolean } | null }): Promise<Record<string, unknown>> {
    const timeoutMs = opts && Number(opts.timeoutMs) ? Number(opts.timeoutMs) : 5000;
    const cancelToken = opts && opts.cancelToken ? opts.cancelToken : null;
    const languageBridge = deps.getLanguageBridge();
    let seq = 0;
    if (kind === 'hover') seq = ++languageBridge.hoverSeq;
    else if (kind === 'completions') seq = ++languageBridge.completionsSeq;
    return editorWorkbenchCall(kind, params, { timeoutMs }).then((result) => {
      const nowCtx = currentLanguageContext();
      if (kind === 'symbols' || kind === 'folding_ranges') {
        if (!ctx || !nowCtx || String((nowCtx as { uri?: unknown }).uri) !== String((ctx as { uri?: unknown }).uri)) return { ok: false, stale: true };
      } else {
        if (cancelToken && cancelToken.isCancellationRequested) return { ok: false, stale: true, canceled: true };
        if (!deps.isLanguageContextCurrent(ctx, nowCtx)) return { ok: false, stale: true };
      }
      if (kind === 'hover' && seq !== languageBridge.hoverSeq) return { ok: false, stale: true };
      if (kind === 'completions' && seq !== languageBridge.completionsSeq) return { ok: false, stale: true };
      return { ok: true, result };
    }).catch((error) => {
      return { ok: false, error: String(error && (error as { message?: unknown }).message ? (error as { message: unknown }).message : error || 'error') };
    });
  }

  return {
    applyDiagnosticsUpdate,
    emitAggregatedDiagCounts,
    clearDiagnosticsForSwitch,
    currentLanguageContext,
    wbCurrentGeneration: currentGeneration,
    wbBumpGeneration: bumpGeneration,
    wbIsFrameworkReady: frameworkReady,
    wbIsBarrierOpen: barrierOpen,
    wbSetOpenAck: setOpenAck,
    wbQueueDidChange: queueDidChange,
    wbQueueSymbols: queueSymbols,
    wbEmitDidChange: emitDidChange,
    wbFlushDidChangeIfReady: flushDidChangeIfReady,
    wbFlushSymbolsIfReady: flushSymbolsIfReady,
    wbFlushPendingAfterOpen: flushPendingAfterOpen,
    wbSchedulePostReadyStructureRefresh: schedulePostReadyStructureRefresh,
    wbPublishDidChange: publishDidChange,
    wbOpenFileFlow: openFileFlow,
    replayOpenFileAfterBaton,
    editorWorkbenchCall,
    callVscodeApiGuarded,
    getPendingRequests: () => workbenchPending,
  };
}
