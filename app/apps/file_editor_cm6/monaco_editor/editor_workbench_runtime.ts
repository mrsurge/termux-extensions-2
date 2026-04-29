import { isAdapterReady, wbIsFrameworkReady, wbIsBarrierOpen } from './editor_workbench_barrier_utils.js';
import { wbFlushDidChangeIfReady, wbFlushPendingAfterOpen, wbFlushSymbolsIfReady, wbPublishDidChange } from './editor_workbench_flush_utils.js';
import { wbBumpGeneration } from './editor_workbench_generation_utils.js';
import { wbCurrentGeneration, wbQueueDidChange, wbQueueSymbols, wbSetOpenAck } from './editor_workbench_state_utils.js';
import type { WorkbenchFlowLike, WorkbenchPendingDidChangePayload } from './editor_workbench_state_utils.js';
import { editorWorkbenchMethodToWbaMethod } from './editor_wba_rpc_transport.ts';
import { VendorMarkerService } from './vscode_document_intelligence_vendor/markerService.ts';
import {
  VendorMainThreadDiagnostics,
  uriObjToString,
} from './vscode_document_intelligence_vendor/mainThreadDiagnostics.ts';
import type { MarkerLike } from './vscode_document_intelligence_vendor/markers.ts';

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

interface LanguageContextLike {
  uri: string;
  path: string;
  languageId: string;
  version: number;
}

interface LanguageBridgeLike {
  hoverSeq: number;
}

interface WorkbenchRuntimeDeps {
  getWindow(): Window & typeof globalThis;
  getMonaco(): MonacoLike | null;
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
  isWbaRpcConnected(): boolean;
  wbaRpcCall(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  wbaRpcNotify(method: string, params: Record<string, unknown>): boolean;
  clearTimeoutFn(timer: ReturnType<typeof setTimeout>): void;
  setTimeoutFn(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createEditorWorkbenchRuntime(
  deps: WorkbenchRuntimeDeps,
): {
  applyDiagnosticsUpdate(params: unknown): void;
  emitAggregatedDiagCounts(path?: string | null): void;
  clearDiagnosticsForSwitch(): void;
  syncDiagnosticsForCurrentModel(reason?: string): void;
  currentLanguageContext(): LanguageContextLike | null;
  wbCurrentGeneration(): number;
  wbBumpGeneration(path: string | null, reason: string): number;
  wbIsFrameworkReady(): boolean;
  wbIsBarrierOpen(path: string | null, generation?: number): boolean;
  wbSetOpenAck(path: string, generation: number): void;
  wbQueueDidChange(path: string, text: string, languageId: string, generation: number): void;
  wbQueueSymbols(path: string, generation: number): void;
  wbFlushDidChangeIfReady(): void;
  wbFlushSymbolsIfReady(): void;
  wbFlushPendingAfterOpen(): void;
  wbSchedulePostReadyStructureRefresh(path: string, generation: number, reason?: string): void;
  wbPublishDidChange(path: string, text: string, languageId: string, generation: number): boolean;
  wbOpenFileFlow(opts: Record<string, unknown>): Promise<unknown>;
  replayOpenFileAfterBaton(): void;
  editorWorkbenchCall(method: string, params?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  callWorkbenchProviderGuarded(kind: string, method: string, params: Record<string, unknown>, ctx: unknown, opts?: { timeoutMs?: number; cancelToken?: { isCancellationRequested?: boolean } | null }): Promise<Record<string, unknown>>;
} {
  let diagState: { rx: number; appliedBatches: number; appliedResources: number; synced: number; droppedNoUri: number; dropNoModel: number } | null = null;
  let diagProjectedOwners = new Set<string>();
  let diagProjectedUri = '';
  const diagMarkerStore = new VendorMarkerService();
  const mainThreadDiagnostics = new VendorMainThreadDiagnostics({
    markerService: diagMarkerStore,
    uriToString: uriObjToString,
    log(message, ...args) {
      console.log(message, ...args);
    },
  });
  let wbPostReadyRefreshSeq = 0;
  const wbFlow: WorkbenchFlowLike = {
    generation: 0,
    activePath: '',
    openAckGeneration: -1,
    openAckPath: '',
    pendingDidChange: null,
    pendingSymbols: null,
  };

  function sameLanguageDocumentContext(ctx: unknown, nowCtx: unknown): boolean {
    try {
      if (!ctx || !nowCtx) return false;
      const before = ctx as Partial<LanguageContextLike>;
      const after = nowCtx as Partial<LanguageContextLike>;
      return String(after.uri || '') === String(before.uri || '')
        && String(after.path || '') === String(before.path || '')
        && String(after.languageId || '') === String(before.languageId || '');
    } catch (_) {
      return false;
    }
  }

  function waitWithTimeout(promise: Promise<unknown>, timeoutMs: number, label: string): Promise<unknown> {
    const boundedTimeoutMs = Math.max(1, Number(timeoutMs) || 1);
    return new Promise((resolve, reject) => {
      const timer = deps.setTimeoutFn(() => {
        reject(new Error(label + '_timeout'));
      }, boundedTimeoutMs);
      promise.then((value) => {
        deps.clearTimeoutFn(timer);
        resolve(value);
      }, (error) => {
        deps.clearTimeoutFn(timer);
        reject(error instanceof Error ? error : new Error(String(error || label + '_failed')));
      });
    });
  }

  async function awaitOpenAckForProvider(kind: string, ctx: unknown, timeoutMs: number): Promise<{ ok: boolean; reason?: string }> {
    if (kind !== 'completions') return { ok: true };
    const typedCtx = ctx as Partial<LanguageContextLike> | null;
    const path = String(typedCtx?.path || '');
    if (!path) return { ok: false, reason: 'missing_path' };
    const generation = currentGeneration();
    if (barrierOpen(path, generation)) return { ok: true };

    const openPromise = wbFlow.openAckPromise;
    const sameOpen = !!(
      openPromise
      && String(wbFlow.openAckPromisePath || '') === path
      && Number(wbFlow.openAckPromiseGeneration || -1) === generation
    );
    if (!sameOpen) return { ok: false, reason: 'open_ack_missing' };

    try {
      await waitWithTimeout(openPromise, Math.min(Math.max(1000, timeoutMs), 6000), 'open_ack');
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error || 'open_ack_failed') };
    }
    return barrierOpen(path, generation) ? { ok: true } : { ok: false, reason: 'open_ack_stale' };
  }

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
    diagProjectedOwners = new Set<string>();
    diagProjectedUri = '';
    syncDiagnosticsForCurrentModel('switch');
  }

  function readActiveResourceDiagnostics(activeUri: string, activePath: string): MarkerLike[] {
    const direct = diagMarkerStore.read({ resource: activeUri });
    if (direct.length || !activePath) return direct;
    return diagMarkerStore.read().filter((marker) => {
      return typeof marker.resource === 'string' && deps.absPathFromVscodeUri(marker.resource) === activePath;
    });
  }

  function syncDiagnosticsForCurrentModel(reason: string = 'sync'): void {
    try {
      const monacoRef = deps.getMonaco();
      const editorNs = monacoRef && monacoRef.editor;
      const model = deps.getModel();
      const currentPath = String(deps.getCurrentPath() || '');
      if (!model || !model.uri || !editorNs || typeof editorNs.setModelMarkers !== 'function') {
        if (!diagState) diagState = { rx: 0, appliedBatches: 0, appliedResources: 0, synced: 0, droppedNoUri: 0, dropNoModel: 0 };
        diagState.dropNoModel += 1;
        return;
      }

      const activeUri = String(model.uri.toString());
      const markers = readActiveResourceDiagnostics(activeUri, currentPath);
      const byOwner = new Map<string, Record<string, unknown>[]>();
      for (const marker of markers) {
        const owner = asString(marker.owner) || 'unknown';
        const bucket = byOwner.get(owner) || [];
        bucket.push({
          code: marker.code,
          severity: marker.severity,
          message: marker.message,
          source: marker.source,
          startLineNumber: marker.startLineNumber,
          startColumn: marker.startColumn,
          endLineNumber: marker.endLineNumber,
          endColumn: marker.endColumn,
          modelVersionId: marker.modelVersionId,
          relatedInformation: marker.relatedInformation,
          tags: marker.tags,
          origin: marker.origin,
        });
        byOwner.set(owner, bucket);
      }

      if (diagProjectedUri === activeUri) {
        for (const owner of diagProjectedOwners) {
          if (!byOwner.has(owner)) {
            try { editorNs.setModelMarkers(model, owner, []); } catch (_) {}
          }
        }
      } else {
        diagProjectedOwners = new Set<string>();
      }

      for (const [owner, ownerMarkers] of byOwner.entries()) {
        try { editorNs.setModelMarkers(model, owner, ownerMarkers); } catch (_) {}
      }

      diagProjectedOwners = new Set(byOwner.keys());
      diagProjectedUri = activeUri;
      emitAggregatedDiagCounts(currentPath);

      if (!diagState) diagState = { rx: 0, appliedBatches: 0, appliedResources: 0, synced: 0, droppedNoUri: 0, dropNoModel: 0 };
      diagState.synced += 1;
      deps.setDebugDiag(
        'diag=rx' + diagState.rx
        + '/bat' + diagState.appliedBatches
        + '/res' + diagState.appliedResources
        + '/sync' + diagState.synced
        + '/nu' + diagState.droppedNoUri
        + '/nm' + diagState.dropNoModel,
      );
      console.log(
        '[workbench] diagnostics sync reason=' + reason
        + ' resource=' + activeUri
        + ' owners=' + diagProjectedOwners.size
        + ' markers=' + markers.length
        + ' path=' + currentPath,
      );
    } catch (_) {}
  }

  function applyDiagnosticsUpdate(params: unknown): void {
    try {
      if (!diagState) diagState = { rx: 0, appliedBatches: 0, appliedResources: 0, synced: 0, droppedNoUri: 0, dropNoModel: 0 };
      diagState.rx += 1;
      const stats = mainThreadDiagnostics.applyChangeMany(params);
      if (!stats) return;

      diagState.appliedBatches += 1;
      diagState.appliedResources += stats.changedResources;
      diagState.droppedNoUri += stats.droppedNoUri;

      const model = deps.getModel();
      const activeUri = model && model.uri ? String(model.uri.toString()) : '';
      const currentPath = String(deps.getCurrentPath() || '');
      const activeTouched = stats.resources.some((resource) => {
        return resource === activeUri
          || (!!currentPath && deps.absPathFromVscodeUri(resource) === currentPath);
      });

      if (activeTouched || (!activeUri && currentPath)) {
        syncDiagnosticsForCurrentModel('changeMany');
      } else {
        deps.setDebugDiag(
          'diag=rx' + diagState.rx
          + '/bat' + diagState.appliedBatches
          + '/res' + diagState.appliedResources
          + '/sync' + diagState.synced
          + '/nu' + diagState.droppedNoUri
          + '/nm' + diagState.dropNoModel,
        );
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

  function emitDidChange(payload: WorkbenchPendingDidChangePayload): boolean {
    const wbaMethod = editorWorkbenchMethodToWbaMethod('did_change');
    if (!wbaMethod) return false;
    if (!deps.isWbaRpcConnected()) {
      console.warn('[wba] didChange dropped: direct WBA socket is not connected');
      return false;
    }
    return deps.wbaRpcNotify(wbaMethod, {
      path: payload.path,
      text: String(payload.text || ''),
      languageId: String(payload.languageId || ''),
      generation: Number.isFinite(Number(payload.generation)) ? Number(payload.generation) : currentGeneration(),
    });
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
    const wbaMethod = editorWorkbenchMethodToWbaMethod(method);
    if (!wbaMethod) {
      return Promise.reject(new Error('unsupported direct WBA workbench method: ' + method));
    }
    if (!deps.isWbaRpcConnected()) {
      return Promise.reject(new Error('direct WBA socket not connected: ' + method));
    }
    return deps.wbaRpcCall(wbaMethod, params || {}, opts);
  }

  function openFileFlow(opts: Record<string, unknown>): Promise<unknown> {
    const path = String(opts.path || '');
    const generation = Number.isFinite(Number(opts.generation)) ? Number(opts.generation) : currentGeneration();
    const languageId = String(opts.languageId || '');
    const requestId = String(opts.requestId || ('diag_' + Date.now() + '_open'));
    const source = String(opts.source || 'open');
    if (!path) return Promise.resolve({ ok: false, deferred: true });

    if (!isAdapterReady(deps.getWindow())) {
      console.log('[readiness] open_file deferred (' + source + ') - waiting for baton');
      return Promise.resolve({ ok: false, deferred: true });
    }

    const openPromise = editorWorkbenchCall('open_file', {
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
      flushPendingAfterOpen();
      schedulePostReadyStructureRefresh(path, generation, source);
      return result;
    });
    wbFlow.openAckPromise = openPromise;
    wbFlow.openAckPromisePath = path;
    wbFlow.openAckPromiseGeneration = generation;
    const clearOpenPromise = () => {
      if (wbFlow.openAckPromise === openPromise) {
        wbFlow.openAckPromise = null;
        wbFlow.openAckPromisePath = '';
        wbFlow.openAckPromiseGeneration = -1;
      }
    };
    openPromise.then(clearOpenPromise, clearOpenPromise);
    return openPromise;
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

  async function callWorkbenchProviderGuarded(kind: string, _method: string, params: Record<string, unknown>, ctx: unknown, opts?: { timeoutMs?: number; cancelToken?: { isCancellationRequested?: boolean } | null }): Promise<Record<string, unknown>> {
    const timeoutMs = opts && Number(opts.timeoutMs) ? Number(opts.timeoutMs) : 5000;
    const cancelToken = opts && opts.cancelToken ? opts.cancelToken : null;
    const languageBridge = deps.getLanguageBridge();
    let seq = 0;
    if (kind === 'hover') seq = ++languageBridge.hoverSeq;

    const openAck = await awaitOpenAckForProvider(kind, ctx, timeoutMs);
    if (!openAck.ok) {
      return { ok: false, notReady: true, error: openAck.reason || 'open_ack_not_ready' };
    }

    return editorWorkbenchCall(kind, params, { timeoutMs }).then((result) => {
      const nowCtx = currentLanguageContext();
      if (kind === 'symbols' || kind === 'folding_ranges') {
        if (!ctx || !nowCtx || String((nowCtx as { uri?: unknown }).uri) !== String((ctx as { uri?: unknown }).uri)) return { ok: false, stale: true };
      } else {
        if (cancelToken && cancelToken.isCancellationRequested) return { ok: false, stale: true, canceled: true };
        if (!deps.isLanguageContextCurrent(ctx, nowCtx)) return { ok: false, stale: true };
      }
      if (kind === 'hover' && seq !== languageBridge.hoverSeq) return { ok: false, stale: true };
      return { ok: true, result };
    }).catch((error) => {
      return { ok: false, error: String(error && (error as { message?: unknown }).message ? (error as { message: unknown }).message : error || 'error') };
    });
  }

  return {
    applyDiagnosticsUpdate,
    emitAggregatedDiagCounts,
    clearDiagnosticsForSwitch,
    syncDiagnosticsForCurrentModel,
    currentLanguageContext,
    wbCurrentGeneration: currentGeneration,
    wbBumpGeneration: bumpGeneration,
    wbIsFrameworkReady: frameworkReady,
    wbIsBarrierOpen: barrierOpen,
    wbSetOpenAck: setOpenAck,
    wbQueueDidChange: queueDidChange,
    wbQueueSymbols: queueSymbols,
    wbFlushDidChangeIfReady: flushDidChangeIfReady,
    wbFlushSymbolsIfReady: flushSymbolsIfReady,
    wbFlushPendingAfterOpen: flushPendingAfterOpen,
    wbSchedulePostReadyStructureRefresh: schedulePostReadyStructureRefresh,
    wbPublishDidChange: publishDidChange,
    wbOpenFileFlow: openFileFlow,
    replayOpenFileAfterBaton,
    editorWorkbenchCall,
    callWorkbenchProviderGuarded,
  };
}
