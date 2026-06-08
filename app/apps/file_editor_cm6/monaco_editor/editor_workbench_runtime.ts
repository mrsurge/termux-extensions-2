import { isAdapterReady, wbIsFrameworkReady, wbIsBarrierOpen } from './editor_workbench_barrier_utils.js';
import { wbFlushDidChangeIfReady, wbFlushPendingAfterOpen, wbFlushSymbolsIfReady, wbPublishDidChange } from './editor_workbench_flush_utils.js';
import { wbBumpGeneration } from './editor_workbench_generation_utils.js';
import { wbCurrentGeneration, wbQueueDidChange, wbQueueOpenFile, wbQueueSymbols, wbSetOpenAck } from './editor_workbench_state_utils.js';
import type { WorkbenchFlowLike, WorkbenchPendingDidChangePayload, WorkbenchPendingOpenFilePayload } from './editor_workbench_state_utils.js';
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
  wbFlushActiveModelOpen(reason?: string): Promise<unknown>;
  wbBeginProjectSwitch(params?: Record<string, unknown>): void;
  wbEndProjectSwitch(params?: Record<string, unknown>): void;
  replayOpenFileAfterBaton(): Promise<unknown>;
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
  let projectSwitchAckWaiters: Array<() => void> = [];
  const wbFlow: WorkbenchFlowLike = {
    generation: 0,
    activePath: '',
    openAckGeneration: -1,
    openAckPath: '',
    pendingDidChange: null,
    pendingOpenFile: null,
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

  function isDocumentBackedWorkbenchMethod(method: string): boolean {
    switch (method) {
      case 'completions':
      case 'hover':
      case 'symbols':
      case 'folding_ranges':
      case 'semantic_tokens':
      case 'semantic_tokens_range':
      case 'inlay_hints':
      case 'inline_completions':
        return true;
      default:
        return false;
    }
  }

  function isIntelligenceWorkbenchMethod(method: string): boolean {
    switch (method) {
      case 'completions':
      case 'hover':
      case 'symbols':
      case 'folding_ranges':
      case 'semantic_tokens':
      case 'semantic_tokens_legend':
      case 'semantic_tokens_range':
      case 'inlay_hints':
      case 'inlay_hints_resolve':
      case 'inlay_hints_release':
      case 'inline_completions':
      case 'inline_completions_free':
      case 'inline_completions_did_show':
        return true;
      default:
        return false;
    }
  }

  function awaitProjectSwitchAck(): Promise<void> {
    if (!isProjectSwitchInProgress()) return Promise.resolve();
    return new Promise((resolve) => {
      projectSwitchAckWaiters.push(resolve);
    });
  }

  function resolveProjectSwitchAckWaiters(): void {
    const waiters = projectSwitchAckWaiters;
    projectSwitchAckWaiters = [];
    for (const resolve of waiters) {
      try { resolve(); } catch (_) {}
    }
  }

  function isProjectSwitchInProgress(): boolean {
    const win = deps.getWindow() as Window & typeof globalThis & { __te2ProjectSwitchInProgress?: boolean };
    return !!win.__te2ProjectSwitchInProgress;
  }

  function activeAdapterProject(): string {
    const win = deps.getWindow() as Window & typeof globalThis & { __te2AdapterProject?: string | null };
    return typeof win.__te2AdapterProject === 'string' ? win.__te2AdapterProject : '';
  }

  function isPathUnderProject(path: string, project: string): boolean {
    const normalizedPath = String(path || '');
    const normalizedProject = String(project || '');
    if (!normalizedPath || !normalizedProject) return true;
    return normalizedPath === normalizedProject || normalizedPath.startsWith(normalizedProject.endsWith('/') ? normalizedProject : normalizedProject + '/');
  }

  function adapterAcceptsPath(path: string): boolean {
    const project = activeAdapterProject();
    return !project || isPathUnderProject(path, project);
  }

  async function awaitOpenAckForPath(path: string, timeoutMs: number, reason: string): Promise<{ ok: boolean; reason?: string }> {
    if (!path) return { ok: false, reason: 'missing_path' };
    if (isProjectSwitchInProgress()) return { ok: false, reason: 'project_switching' };
    if (!adapterAcceptsPath(path)) return { ok: false, reason: 'stale_project_path' };
    let generation = currentGeneration();
    if (barrierOpen(path, generation)) return { ok: true };

    if (String(path) === String(deps.getCurrentPath() || '')) {
      await flushActiveModelOpen(reason);
      generation = currentGeneration();
      if (barrierOpen(path, generation)) return { ok: true };
    }

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

  async function awaitOpenAckForProvider(kind: string, ctx: unknown, params: Record<string, unknown>, timeoutMs: number): Promise<{ ok: boolean; reason?: string }> {
    const typedCtx = ctx as Partial<LanguageContextLike> | null;
    const path = String(params.path || typedCtx?.path || deps.getCurrentPath() || '');
    return awaitOpenAckForPath(path, timeoutMs, 'provider_' + kind);
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
      console.warn('[wba] didChange queued: direct WBA socket is not connected');
      queueDidChange(payload.path, payload.text, payload.languageId, payload.generation);
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

  function rawEditorWorkbenchCall(method: string, params?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown> {
    const wbaMethod = editorWorkbenchMethodToWbaMethod(method);
    if (!wbaMethod) {
      return Promise.reject(new Error('unsupported direct WBA workbench method: ' + method));
    }
    return deps.wbaRpcCall(wbaMethod, params || {}, opts);
  }

  async function editorWorkbenchCall(method: string, params?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown> {
    const normalizedParams = params || {};
    const timeoutMs = opts && Number(opts.timeoutMs) ? Number(opts.timeoutMs) : 5000;
    if (isIntelligenceWorkbenchMethod(method) && isProjectSwitchInProgress()) {
      await awaitProjectSwitchAck();
    }
    if (isDocumentBackedWorkbenchMethod(method)) {
      const openAck = await awaitOpenAckForPath(String(normalizedParams.path || deps.getCurrentPath() || ''), timeoutMs, 'workbench_' + method);
      if (!openAck.ok) {
        throw new Error(openAck.reason || 'open_ack_not_ready');
      }
    }
    return rawEditorWorkbenchCall(method, normalizedParams, opts);
  }

  function normalizeOpenFilePayload(opts: Record<string, unknown>): WorkbenchPendingOpenFilePayload | null {
    const path = String(opts.path || '');
    const generation = Number.isFinite(Number(opts.generation)) ? Number(opts.generation) : currentGeneration();
    const languageId = String(opts.languageId || '');
    const requestId = String(opts.requestId || ('diag_' + Date.now() + '_open'));
    const source = String(opts.source || 'open');
    if (!path) return null;
    return {
      path,
      languageId,
      uri: String(opts.uri || ''),
      requestId,
      forceRefresh: !!opts.forceRefresh,
      generation,
      source,
      timeoutMs: Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 8000,
    };
  }

  function canSendOpenFile(payload?: WorkbenchPendingOpenFilePayload | null): boolean {
    if (isProjectSwitchInProgress()) return false;
    const path = String(payload?.path || deps.getCurrentPath() || '');
    return isAdapterReady(deps.getWindow()) && deps.isWbaRpcConnected() && frameworkReady() && adapterAcceptsPath(path);
  }

  function sendQueuedOpenFile(payload: WorkbenchPendingOpenFilePayload): Promise<unknown> {
    const openPromise = rawEditorWorkbenchCall('open_file', {
      path: payload.path,
      languageId: payload.languageId,
      uri: payload.uri,
      requestId: payload.requestId,
      forceRefresh: payload.forceRefresh,
      generation: payload.generation,
    }, { timeoutMs: payload.timeoutMs }).then((result) => {
      if (payload.generation !== currentGeneration() || String(payload.path) !== String(deps.getCurrentPath() || '')) {
        return { ok: false, stale: true };
      }
      setOpenAck(payload.path, payload.generation);
      flushPendingAfterOpen();
      schedulePostReadyStructureRefresh(payload.path, payload.generation, payload.source);
      return result;
    }).catch((error) => {
      if (payload.generation === currentGeneration() && String(payload.path) === String(deps.getCurrentPath() || '')) {
        wbFlow.pendingOpenFile = payload;
      }
      throw error instanceof Error ? error : new Error(String(error || 'open_file_failed'));
    });
    wbFlow.openAckPromise = openPromise;
    wbFlow.openAckPromisePath = payload.path;
    wbFlow.openAckPromiseGeneration = payload.generation;
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

  function queueActiveModelOpen(reason: string): WorkbenchPendingOpenFilePayload | null {
    const currentPath = deps.getCurrentPath();
    const editor = deps.getEditor();
    if (isProjectSwitchInProgress()) return null;
    if (currentPath && !adapterAcceptsPath(currentPath)) return null;
    if (!currentPath || !editor) return null;
    const model = typeof editor.getModel === 'function' ? editor.getModel() : null;
    if (!model) return null;
    let generation = currentGeneration();
    if (!generation || String(wbFlow.activePath || '') !== String(currentPath || '')) {
      generation = bumpGeneration(currentPath, reason || 'active_model_open');
    }
    const languageId = (model.getLanguageId ? model.getLanguageId() : '') || '';
    try {
      const content = model.getValue ? model.getValue() : '';
      queueDidChange(currentPath, content, languageId, generation);
    } catch (_) {}
    queueSymbols(currentPath, generation);
    return wbQueueOpenFile(wbFlow, {
      path: currentPath,
      languageId,
      uri: model && model.uri ? String(model.uri.toString()) : '',
      requestId: String(reason || 'active') + '_' + Date.now(),
      forceRefresh: true,
      generation,
      source: reason || 'active_model',
      timeoutMs: 8000,
    }, currentGeneration);
  }

  function flushActiveModelOpen(reason: string = 'flush'): Promise<unknown> {
    if (!wbFlow.pendingOpenFile) {
      queueActiveModelOpen(reason);
    }
    const pending = wbFlow.pendingOpenFile;
    if (!pending || !pending.path) return Promise.resolve({ ok: false, deferred: true });
    if (!canSendOpenFile(pending)) {
      console.log('[readiness] open_file held (' + String(reason || pending.source || 'open') + ') - waiting for WBA/model readiness');
      return Promise.resolve({ ok: false, deferred: true });
    }
    wbFlow.pendingOpenFile = null;
    return sendQueuedOpenFile(pending);
  }

  function openFileFlow(opts: Record<string, unknown>): Promise<unknown> {
    const payload = normalizeOpenFilePayload(opts);
    if (!payload) return Promise.resolve({ ok: false, deferred: true });
    wbQueueOpenFile(wbFlow, payload, currentGeneration);
    return flushActiveModelOpen(payload.source);
  }

  function replayOpenFileAfterBaton(): Promise<unknown> {
    console.log('[readiness] baton arrived, flushing active model open');
    return flushActiveModelOpen('baton').catch((error) => {
      console.warn('[readiness] baton replay open_file failed', error);
      throw error instanceof Error ? error : new Error(String(error || 'baton_open_failed'));
    });
  }

  function beginProjectSwitch(params?: Record<string, unknown>): void {
    wbFlow.openAckGeneration = -1;
    wbFlow.openAckPath = '';
    wbFlow.openAckPromise = null;
    wbFlow.openAckPromisePath = '';
    wbFlow.openAckPromiseGeneration = -1;
    wbFlow.pendingOpenFile = null;
    wbFlow.pendingDidChange = null;
    wbFlow.pendingSymbols = null;
    console.log('[project_switch] workbench suspended', params?.switchId || '');
  }

  function endProjectSwitch(params?: Record<string, unknown>): void {
    console.log('[project_switch] workbench resumed', params?.switchId || '');
    resolveProjectSwitchAckWaiters();
  }

  async function callWorkbenchProviderGuarded(kind: string, _method: string, params: Record<string, unknown>, ctx: unknown, opts?: { timeoutMs?: number; cancelToken?: { isCancellationRequested?: boolean } | null }): Promise<Record<string, unknown>> {
    const timeoutMs = opts && Number(opts.timeoutMs) ? Number(opts.timeoutMs) : 5000;
    const cancelToken = opts && opts.cancelToken ? opts.cancelToken : null;
    const languageBridge = deps.getLanguageBridge();
    let seq = 0;
    if (kind === 'hover') seq = ++languageBridge.hoverSeq;

    if (isProjectSwitchInProgress()) {
      await awaitProjectSwitchAck();
    }
    const openAck = await awaitOpenAckForProvider(kind, ctx, params, timeoutMs);
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
    wbFlushActiveModelOpen: flushActiveModelOpen,
    wbBeginProjectSwitch: beginProjectSwitch,
    wbEndProjectSwitch: endProjectSwitch,
    replayOpenFileAfterBaton,
    editorWorkbenchCall,
    callWorkbenchProviderGuarded,
  };
}
