import { EDITOR_RPC_NOTIFICATIONS } from './editor_rpc_contract.ts';
import { buildInlineDiffScrollbarOptions } from './editor_diff_scrollbar_options.ts';
import { acceptDocumentProjection } from './editor_document_revision_runtime.ts';

interface EditorSocketLike {
  on(eventName: string, handler: (payload: unknown) => void): void;
}

interface EditorRpcNotificationSource {
  onNotification(method: string, handler: (payload: Record<string, unknown>) => void): () => void;
}

interface MonacoUriLike {
  toString(): string;
}

interface MonacoModelLike {
  uri?: MonacoUriLike;
  getLanguageId?(): string;
  getValue?(): string;
  getFullModelRange?(): unknown;
  applyEdits?(edits: Array<{ range: unknown; text: string }>): void;
  dispose?(): void;
}

interface MonacoEditorLike {
  setModel?(model: MonacoModelLike | null): void;
  saveViewState?(): unknown;
  restoreViewState?(state: unknown): void;
  updateOptions?(options: Record<string, unknown>): void;
  layout?(): void;
}

interface MonacoDiffEditorLike {
  setModel?(model: Record<string, unknown> | null): void;
  getOriginalEditor?(): MonacoEditorLike | null;
  getModifiedEditor?(): MonacoEditorLike | null;
  getModel?(): Record<string, unknown> | null;
  layout?(): void;
}

interface EditorSocketConnectionDeps {
  rpcNotifications?: EditorRpcNotificationSource | null;
  emitToHost(eventName: string, payload: Record<string, unknown>): void;
  getCachedPrefs(): unknown;
  setCachedPrefs(snapshot: unknown): void;
  getBaseSha256(): string | null;
  setBaseSha256(value: string | null): void;
  getCurrentPath(): string | null;
  setCurrentPath(value: string | null): void;
  clearActiveModel(reason: string): void;
  wbBumpGeneration(path: string | null, reason: string): number;
  wbQueueDidChange(path: string, text: string, languageId: string, generation: number): void;
  wbQueueSymbols(path: string, generation: number): void;
  wbOpenFileFlow(opts: Record<string, unknown>): Promise<unknown>;
  bcUpdatePath(path: string | null, deferSymbols?: boolean): void;
  ensureEditorWithPrefs(): Promise<unknown>;
  getEditor(): MonacoEditorLike | null;
  getDiffEditor(): MonacoDiffEditorLike | null;
  getModel(): MonacoModelLike | null;
  setModel(model: MonacoModelLike | null): void;
  createFileModel(content: string, lang: string, absPath: string): MonacoModelLike;
  applyLanguageToModel(model: MonacoModelLike, languageId: string, filePath: string): void;
  installMirrorPublisher(): void;
  installScrollPublisher(): void;
  languageFromPath(path: string): string;
  monacoFileUri(path: string): MonacoUriLike | null;
  setApplyingRemote(value: boolean): void;
  ensureTouchSelection(reason: string): void;
  getLastContentSha256(): string | null;
  setLastContentSha256(value: string | null): void;
  updateDebug(extra: string): void;
  getOpenTransactionForPath(path: string): unknown;
  resolveOpenJumpPayload(tx: unknown, scrollLine: number | null, preferCursor: boolean): unknown;
  applyResolvedOpenJump(source: string, payload: unknown, tx: unknown): void;
  requestDraftDiff(reason: string): void;
  clearDraftDiffDecorations(): void;
  requestGitBaselines(opts: { immediate?: boolean; reason: string }): void;
  requestAgentEditDocumentState(payload: Record<string, unknown>): Promise<unknown>;
  shouldDropDuplicateEditorOpen(payload: unknown): boolean;
  queueOpenTransaction(task: () => Promise<void>): Promise<void>;
  runEditorOpenTransaction(payload: unknown): Promise<void>;
  handleJumpToLine(payload: unknown): void;
  buildMonacoOptionsFromPrefs(state: unknown): Record<string, unknown>;
  applyLineNumberSizing(): void;
  applyMonacoTheme(themeKey: string): Promise<void> | void;
  getAutoSave(): boolean;
  getShowInlineDiffs(): boolean;
  getShowDraftDiffs(): boolean;
  getShowDraftInsertions(): boolean;
  disposeGitBaselines(): void;
  ensurePlainEditorWithPrefs(): MonacoEditorLike | null;
  applyGitBaselines(payload: unknown): void;
  emitModelReady(payload: { path: string; languageId: string; generation?: number; request_id?: string; source?: string }): boolean;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function applyModelLifecycle(deps: EditorSocketConnectionDeps, content: string, lang: string, currentPath: string): void {
  const editor = deps.getEditor();
  const diffEditor = deps.getDiffEditor();
  const model = deps.getModel();

  if (!model) {
    const nextModel = deps.createFileModel(content || '', lang, currentPath);
    deps.setModel(nextModel);
    if (editor && typeof editor.setModel === 'function') editor.setModel(nextModel);
    deps.applyLanguageToModel(nextModel, lang, currentPath);
    deps.installMirrorPublisher();
    deps.installScrollPublisher();
    return;
  }

  try {
    const want = deps.monacoFileUri(currentPath);
    if (want && model.uri && String(model.uri.toString()) !== String(want.toString())) {
      if (diffEditor && typeof diffEditor.setModel === 'function') {
        try { diffEditor.setModel(null); } catch (_) {}
      }
      try { if (typeof model.dispose === 'function') model.dispose(); } catch (_) {}
      const recreated = deps.createFileModel(content || '', lang, currentPath);
      deps.setModel(recreated);
      if (editor && typeof editor.setModel === 'function') editor.setModel(recreated);
      deps.applyLanguageToModel(recreated, lang, currentPath);
      deps.installMirrorPublisher();
      deps.installScrollPublisher();
      return;
    }

    deps.setApplyingRemote(true);
    try {
      const range = model.getFullModelRange ? model.getFullModelRange() : null;
      if (range && typeof model.applyEdits === 'function') {
        model.applyEdits([{ range, text: content || '' }]);
      }
    } finally {
      deps.setApplyingRemote(false);
    }
    deps.applyLanguageToModel(model, lang, currentPath);
  } catch (_) {
    deps.setApplyingRemote(true);
    try {
      const range = model && model.getFullModelRange ? model.getFullModelRange() : null;
      if (range && model && typeof model.applyEdits === 'function') {
        model.applyEdits([{ range, text: content || '' }]);
      }
    } finally {
      deps.setApplyingRemote(false);
    }
    const activeModel = deps.getModel();
    if (activeModel) deps.applyLanguageToModel(activeModel, lang, currentPath);
  }
}

export function registerEditorSocketConnectionHandlers(
  socket: EditorSocketLike,
  deps: EditorSocketConnectionDeps,
): void {
  const handleSsotSnapshot = (snapshot: unknown): void => {
    try {
      const snapshotRecord = asRecord(snapshot);
      const snapshotFile = asRecord(snapshotRecord && snapshotRecord.file);
      try {
        const t = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
          ? (Math.round(performance.now() * 10) / 10)
          : null;
        console.log((t != null ? ('t=' + t + 'ms ') : '') + 'now=' + Date.now(), '[editor:ssot] rx', { hasFile: !!snapshotFile, currentPath: snapshotRecord && snapshotRecord.currentPath });
      } catch (_) {}
      deps.setCachedPrefs(snapshot);
      if (snapshotFile) {
        const file = snapshotFile;
        deps.ensureEditorWithPrefs().then(async () => {
          const snapshotPath = asString(file.path);
          if (!acceptDocumentProjection(snapshotPath, file.document_revision)) {
            console.warn('[editor:ssot] rejected stale or unfenced document projection', {
              path: snapshotPath,
              document_revision: file.document_revision,
            });
            return;
          }
          deps.setBaseSha256(asString(file.base_sha256) || deps.getBaseSha256());
          deps.setCurrentPath(snapshotPath || deps.getCurrentPath());
          const activePath = deps.getCurrentPath();
          if (!activePath) return;
          const ssotGeneration = deps.wbBumpGeneration(activePath, 'ssot');
          try { deps.bcUpdatePath(activePath, true); } catch (_) {}
          const lang = deps.languageFromPath(activePath);
          const activeModel = deps.getModel();
          const snapshotContent = asString(file.content);
          const shouldReuseBootModel = !!(
            activeModel
            && activePath === asString(file.path)
            && typeof activeModel.getValue === 'function'
            && activeModel.getValue() === snapshotContent
          );
          if (!shouldReuseBootModel) {
            applyModelLifecycle(deps, snapshotContent, lang, activePath);
          }
          deps.ensureTouchSelection('ssot');
          deps.setLastContentSha256(asString(file.content_sha256) || deps.getLastContentSha256());
          deps.emitToHost('editor_cache_state', {
            path: activePath,
            state: file.state,
            unsaved: !!file.unsaved,
            reason: file.reason,
            content_sha256: file.content_sha256,
            base_sha256: file.base_sha256 || (file.unsaved ? null : file.content_sha256),
            auto_save: file.auto_save,
            document_revision: file.document_revision,
          });
          try {
            const ssotTx = deps.getOpenTransactionForPath(activePath);
            const ssotJumpPayload = deps.resolveOpenJumpPayload(ssotTx, (file && !file.has_draft) ? (typeof file.scroll_line === 'number' ? file.scroll_line : null) : null, false);
            if (ssotJumpPayload) deps.applyResolvedOpenJump('ssot', ssotJumpPayload, ssotTx);
          } catch (_) {}
          if (file.has_draft) {
            deps.emitToHost('editor_draft_state', {
              has_draft: true,
              path: activePath,
              document_revision: file.document_revision,
            });
            deps.requestDraftDiff('ssot');
          } else {
            deps.clearDraftDiffDecorations();
          }
          try {
            const readyModel = deps.getModel();
            deps.emitModelReady({
              path: activePath,
              languageId: readyModel && readyModel.getLanguageId ? readyModel.getLanguageId() : lang,
              generation: ssotGeneration,
              request_id: file && file.request_id ? String(file.request_id) : '',
              source: 'ssot',
            });
          } catch (_) {}
          deps.updateDebug('ws=ssot');
          deps.requestGitBaselines({ reason: 'ssot' });
          let languageOpenPromise: Promise<unknown> | null = null;
          try {
            const requestId = file && file.request_id ? String(file.request_id) : ('diag_' + Date.now() + '_ssot');
            const nextActiveModel = deps.getModel();
            const text = nextActiveModel && nextActiveModel.getValue ? nextActiveModel.getValue() : '';
            deps.wbQueueDidChange(activePath, text, nextActiveModel && nextActiveModel.getLanguageId ? nextActiveModel.getLanguageId() : lang, ssotGeneration);
            deps.wbQueueSymbols(activePath, ssotGeneration);
            languageOpenPromise = deps.wbOpenFileFlow({
              path: activePath,
              languageId: lang,
              uri: nextActiveModel && nextActiveModel.uri ? String(nextActiveModel.uri.toString()) : '',
              requestId,
              forceRefresh: true,
              generation: ssotGeneration,
              source: 'ssot',
              timeoutMs: 8000,
            }).catch(() => {});
          } catch (_) {}
          if (languageOpenPromise) {
            try {
              await languageOpenPromise;
            } catch (_) {}
          }
          try {
            await deps.requestAgentEditDocumentState({
              path: activePath,
              request_id: file && file.request_id ? String(file.request_id) : '',
              reason: 'ssot',
            });
          } catch (error) {
            console.warn('[AgentEditReview] document state request failed after ssot open', error);
          }
        });
      } else {
        deps.clearActiveModel('ssot_empty');
        deps.updateDebug('ws=ssot-empty');
      }
    } catch (error) {
      console.warn('[Monaco] ssot apply failed', error);
    }
  };

  const handleOpenPayload = (payload: unknown): void => {
    try {
      const payloadRecord = asRecord(payload);
      if (!payloadRecord || !payloadRecord.path) return;
      if (deps.shouldDropDuplicateEditorOpen(payload)) {
        try {
          console.log('[editor:open] drop duplicate', { path: payloadRecord.path, request_id: payloadRecord.request_id || '' });
        } catch (_) {}
        return;
      }

      const model = deps.getModel();
      if (payloadRecord.reason === 'external_change' && model && model.uri) {
        try {
          const incomingUri = deps.monacoFileUri(asString(payloadRecord.path));
          if (incomingUri && String(model.uri.toString()) !== String(incomingUri.toString())) {
            console.log('[editor:open] skip external_change: URI mismatch', payloadRecord.path);
            return;
          }
        } catch (_) {}
      }

      try {
        const t = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
          ? (Math.round(performance.now() * 10) / 10)
          : null;
        console.log((t != null ? ('t=' + t + 'ms ') : '') + 'now=' + Date.now(), '[editor:open] rx', { path: payloadRecord.path, request_id: payloadRecord.request_id || '' });
      } catch (_) {}
      deps.queueOpenTransaction(() => deps.runEditorOpenTransaction(payload)).catch((error) => {
        console.warn('[Monaco] open apply failed', error);
      });
    } catch (error) {
      console.warn('[Monaco] open apply failed', error);
    }
  };

  const handlePrefsChangedPayload = (payload: unknown): void => {
    try {
      const payloadRecord = asRecord(payload);
      const nextPrefs = payloadRecord && payloadRecord.preferences ? asRecord(payloadRecord.preferences) : null;
      if (!nextPrefs) return;
      const nextCachedPrefs = Object.assign({}, asRecord(deps.getCachedPrefs()) || {});
      nextCachedPrefs.preferences = nextPrefs;
      deps.setCachedPrefs(nextCachedPrefs);

      const editor = deps.getEditor();
      const diffEditor = deps.getDiffEditor();
      const model = deps.getModel();
      if (!editor) return;
      const opts = deps.buildMonacoOptionsFromPrefs({ preferences: nextPrefs });
      const nextPrefsEditor = asRecord(nextPrefs.editor);
      let theme = null;
      try { theme = nextPrefsEditor && nextPrefsEditor.theme ? nextPrefsEditor.theme : null; } catch (_) { theme = null; }
      try { if (opts) delete opts.theme; } catch (_) {}

      try { if (editor.updateOptions) editor.updateOptions(opts || {}); } catch (error) { console.warn('[Monaco] updateOptions failed', error); }
      deps.applyLineNumberSizing();
      if (diffEditor && diffEditor.getOriginalEditor) {
        try {
          const origOpts = Object.assign({}, opts || {}, { readOnly: true, contextmenu: false, minimap: { enabled: false } });
          const originalEditor = diffEditor.getOriginalEditor ? diffEditor.getOriginalEditor() : null;
          if (originalEditor && typeof originalEditor.updateOptions === 'function') {
            originalEditor.updateOptions(origOpts);
          }
          try {
            const diffOpts = Object.assign({}, opts || {}, { minimap: { enabled: false } });
            const modifiedEditor = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
            if (modifiedEditor && typeof modifiedEditor.updateOptions === 'function') {
              modifiedEditor.updateOptions(diffOpts);
            }
          } catch (_) {}
          try {
            const scrollOpts = buildInlineDiffScrollbarOptions();
            const modifiedEditor = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
            const originalEditor = diffEditor.getOriginalEditor ? diffEditor.getOriginalEditor() : null;
            if (modifiedEditor && typeof modifiedEditor.updateOptions === 'function') {
              modifiedEditor.updateOptions(scrollOpts);
            }
            if (originalEditor && typeof originalEditor.updateOptions === 'function') {
              originalEditor.updateOptions(scrollOpts);
            }
          } catch (_) {}
        } catch (_) {}
      }
      if (typeof theme === 'string' && theme) deps.applyMonacoTheme(theme);
      deps.ensureTouchSelection('prefs');
      try { if (diffEditor && typeof diffEditor.layout === 'function') diffEditor.layout(); } catch (_) {}
      try { if (editor && typeof editor.layout === 'function') editor.layout(); } catch (_) {}
      deps.updateDebug('prefs=ok');

      if (deps.getShowInlineDiffs() || deps.getShowDraftDiffs()) {
        deps.requestGitBaselines({ immediate: true, reason: 'prefs' });
      } else {
        deps.disposeGitBaselines();
        if (diffEditor) deps.ensurePlainEditorWithPrefs();
      }
      if (deps.getShowDraftInsertions()) deps.requestDraftDiff('prefs');
      else deps.clearDraftDiffDecorations();
      deps.ensureTouchSelection('prefs');
    } catch (error) {
      console.warn('[Monaco] prefs_changed apply failed', error);
    }
  };

  socket.on('connect', () => {
    deps.emitToHost('editor_ready', {});
    deps.emitToHost('editor:iframe_ready', {});
  });

  if (deps.rpcNotifications) {
    deps.rpcNotifications.onNotification(EDITOR_RPC_NOTIFICATIONS.stateSsot, handleSsotSnapshot);
    deps.rpcNotifications.onNotification(EDITOR_RPC_NOTIFICATIONS.fileOpened, handleOpenPayload);
    deps.rpcNotifications.onNotification(EDITOR_RPC_NOTIFICATIONS.fileJumpToLine, (payload) => deps.handleJumpToLine(payload));
    deps.rpcNotifications.onNotification(EDITOR_RPC_NOTIFICATIONS.prefsChanged, handlePrefsChangedPayload);
  }

  const handleGitBaselinesPayload = (payload: unknown): void => {
    try {
      deps.applyGitBaselines(payload);
    } catch (error) {
      console.warn('[Monaco] git baselines apply failed', error);
    }
  };

  if (deps.rpcNotifications) {
    deps.rpcNotifications.onNotification(EDITOR_RPC_NOTIFICATIONS.gitBaselines, handleGitBaselinesPayload);
  }
}
