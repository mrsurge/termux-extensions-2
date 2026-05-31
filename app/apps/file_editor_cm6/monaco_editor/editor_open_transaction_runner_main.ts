import type {
  EditorLike,
  EditorModelLike,
  EditorOpenJumpPayload,
  EditorOpenPayload,
  EditorOpenTransactionStore,
  EditorUriLike,
} from './editor_open_contract.ts';
import {
  beginOpenTransaction,
  resolveOpenJumpPayload,
  settleOpenTransaction,
} from './editor_open_transaction_state.ts';
import { awaitOpenCompletion } from './editor_open_transaction_runner.ts';

interface RunEditorOpenTransactionDeps {
  getWindow(): { monaco?: unknown };
  getCurrentPath(): string | null;
  setCurrentPath(path: string): void;
  getBaseSha256(): string | null;
  setBaseSha256(value: string | null): void;
  getLastContentSha256(): string | null;
  setLastContentSha256(value: string | null): void;
  getEditor(): OpenEditorLike | null;
  getDiffEditor(): OpenDiffEditorLike | null;
  getModel(): OpenModelLike | null;
  setModel(model: OpenModelLike | null): void;
  ensureEditorWithPrefs(): Promise<unknown>;
  languageFromPath(path: string): string;
  monacoFileUri(monacoRef: unknown, path: string): EditorUriLike | null;
  applyLanguageToModel(model: OpenModelLike, lang: string, absPath: string): void;
  createFileModel(content: string, lang: string, absPath: string): OpenModelLike;
  installMirrorPublisher(): void;
  installScrollPublisher(): void;
  applyLineNumberSizing(): void;
  ensureTouchSelection(reason: string): void;
  syncDiagnosticsForCurrentModel(reason: string): void;
  emitToHost(eventType: string, payload: Record<string, unknown>): void;
  emitModelReady(payload: { path: string; languageId: string; generation?: number; request_id?: string; source?: string }): boolean;
  requestDraftDiff(reason: string): void;
  clearDraftDiffDecorations(): void;
  requestGitBaselines(payload: { reason: string }): void;
  wbCurrentGeneration(): number;
  wbBumpGeneration(path: string, source: string): number;
  bcUpdatePath(path: string, shouldAnnounce: boolean): void;
  queueDidChange(path: string, text: string, languageId: string, generation: number): void;
  queueSymbols(path: string, generation: number): void;
  openFileFlow(payload: Record<string, unknown>): Promise<unknown>;
  absPathFromVscodeUri(uri: string): string | null;
  applyJumpToLine(editor: EditorLike, model: EditorModelLike, jumpPayload: EditorOpenJumpPayload): void;
  coercePositiveInt(value: unknown): number | null;
  shouldRecreateOpenModel(monacoRef: unknown, monacoFileUriFn: (monacoRef: unknown, path: string) => EditorUriLike | null, model: OpenModelLike | null, absPath: string): boolean;
  applyOpenModelTextSafely(model: OpenModelLike, editor: OpenEditorLike, content: string, setApplyingRemote: (value: boolean) => void): void;
  emitOpenCacheState(emitToHostFn: (eventType: string, payload: Record<string, unknown>) => void, absPath: string, hasDraft: boolean, sha256: string | null, baseSha256: string | null, autoSave: boolean | null): void;
  queueBackendWorkbenchOpen(payload: Record<string, unknown>): void;
  setApplyingRemote(value: boolean): void;
  openTransactionStore: EditorOpenTransactionStore;
}

interface OpenEditorLike extends EditorLike {
  setModel?(model: OpenModelLike | null): void;
  setValue?(value: string): void;
  saveViewState?(): unknown;
  restoreViewState?(state: unknown): void;
}

interface OpenDiffModelLike extends Record<string, unknown> {
  original?: unknown;
  modified?: unknown;
}

interface OpenDiffEditorLike {
  setModel?(model: Record<string, unknown> | null): void;
  getModel?(): OpenDiffModelLike | null;
  getModifiedEditor?(): OpenEditorLike | null;
}

interface OpenModelLike extends EditorModelLike {
  getValue(): string;
  getLanguageId?(): string;
  setValue?(value: string): void;
  dispose?(): void;
}

export async function runEditorOpenTransaction(
  deps: RunEditorOpenTransactionDeps,
  payload: EditorOpenPayload | null | undefined,
): Promise<void> {
  if (!payload || !payload.path) return;

  const incomingPath = String(payload.path || '');
  let incomingUri: EditorUriLike | null = null;
  let sameFileNavigationOnly = false;
  try {
    incomingUri = deps.monacoFileUri(deps.getWindow().monaco, incomingPath);
    const model = deps.getModel();
    const reason = String(payload.reason || '');
    sameFileNavigationOnly = !!(
      reason !== 'external_change'
      && reason !== 'discard_external'
      && model
      && model.uri
      && incomingUri
      && String(model.uri.toString()) === String(incomingUri.toString())
    );
  } catch (_) {}

  deps.setBaseSha256(payload.base_sha256 || deps.getBaseSha256());
  deps.setCurrentPath(incomingPath);
  const currentPath = incomingPath;
  const openGeneration = sameFileNavigationOnly
    ? deps.wbCurrentGeneration()
    : deps.wbBumpGeneration(currentPath, 'editor:open');
  const tx = beginOpenTransaction(
    deps.openTransactionStore,
    currentPath,
    openGeneration,
    payload,
    deps.coercePositiveInt,
  );
  let postOpenJumpPayload: EditorOpenJumpPayload | null = null;
  try { deps.bcUpdatePath(currentPath, true); } catch (_) {}

  try {
    await deps.ensureEditorWithPrefs();
    const lang = deps.languageFromPath(currentPath);
    let model = deps.getModel();
    const editor = deps.getEditor();
    const diffEditor = deps.getDiffEditor();
    if (!editor) {
      settleOpenTransaction(deps.openTransactionStore, tx);
      return;
    }

    if (sameFileNavigationOnly) {
      try {
        console.log('[editor:open] same-file navigation fast path', {
          path: currentPath,
          request_id: payload.request_id || '',
          line: payload.line,
        });
      } catch (_) {}
    } else if (!model) {
      model = deps.createFileModel(payload.content || '', lang, currentPath);
      deps.setModel(model);
      if (typeof editor.setModel === 'function') editor.setModel(model);
      deps.applyLanguageToModel(model, lang, currentPath);
      deps.installMirrorPublisher();
      deps.installScrollPublisher();
    } else {
      try {
        const want = deps.monacoFileUri(deps.getWindow().monaco, currentPath);
        if (want && model.uri && String(model.uri.toString()) !== String(want.toString())) {
          if (diffEditor && typeof diffEditor.setModel === 'function') { try { diffEditor.setModel(null); } catch (_) {} }
          try { if (typeof model.dispose === 'function') model.dispose(); } catch (_) {}
          model = deps.createFileModel(payload.content || '', lang, currentPath);
          deps.setModel(model);
          if (typeof editor.setModel === 'function') editor.setModel(model);
          deps.applyLanguageToModel(model, lang, currentPath);
          deps.installMirrorPublisher();
          deps.installScrollPublisher();
        } else {
          deps.applyOpenModelTextSafely(model, editor, payload.content || '', deps.setApplyingRemote);
          deps.applyLanguageToModel(model, lang, currentPath);
        }
      } catch (_) {
        deps.applyOpenModelTextSafely(model, editor, payload.content || '', deps.setApplyingRemote);
        deps.applyLanguageToModel(model, lang, currentPath);
      }
    }

    deps.applyLineNumberSizing();
    deps.ensureTouchSelection('open');
    deps.syncDiagnosticsForCurrentModel('open_model_ready');

    deps.setLastContentSha256(payload.content_sha256 || deps.getLastContentSha256());
    deps.emitToHost('editor_cache_state', {
      path: currentPath,
      state: payload.state || 'clean',
      unsaved: !!payload.unsaved,
      reason: payload.reason || 'open',
      content_sha256: payload.content_sha256,
      base_sha256: payload.base_sha256 || (payload.unsaved ? null : payload.content_sha256),
      auto_save: payload.auto_save,
    });
    if (payload.has_draft) deps.requestDraftDiff('open');
    else deps.clearDraftDiffDecorations();
    try {
      deps.emitModelReady({
        path: currentPath,
        languageId: model && model.getLanguageId ? model.getLanguageId() : lang,
        generation: openGeneration,
        request_id: payload && payload.request_id ? String(payload.request_id) : '',
        source: 'open',
      });
    } catch (_) {}

    postOpenJumpPayload = resolveOpenJumpPayload(
      deps.openTransactionStore,
      currentPath,
      tx,
      payload.scroll_line,
      sameFileNavigationOnly,
      deps.coercePositiveInt,
    );

    const satisfied = await awaitOpenCompletion({
      getCurrentPath: () => deps.getCurrentPath(),
      getEditor: () => deps.getEditor(),
      getModel: () => deps.getModel(),
      absPathFromVscodeUri: deps.absPathFromVscodeUri,
      applyJumpToLine: deps.applyJumpToLine,
      coercePositiveInt: deps.coercePositiveInt,
      logAppliedOpenJump: (detail) => {
        try { console.log('[editor:open] applied transaction navigation', detail); } catch (_) {}
      },
    }, deps.openTransactionStore, tx, postOpenJumpPayload, 4, 'editor:open-complete');

    if (!satisfied) {
      try {
        console.warn('[editor:open] completion verification failed', {
          path: currentPath,
          request_id: tx && tx.request_id ? tx.request_id : '',
          line: tx && tx.hasExplicitNavigation ? tx.line : null,
          column: tx && tx.hasExplicitNavigation ? tx.column : null,
        });
      } catch (_) {}
    }

    if (!sameFileNavigationOnly) {
      try {
        const openReqId = (payload && payload.request_id) ? String(payload.request_id) : (`diag_${Date.now()}_open`);
        let openText = '';
        try { openText = model && model.getValue ? model.getValue() : ''; } catch (_) {}
        deps.queueDidChange(
          currentPath,
          openText,
          model && model.getLanguageId ? model.getLanguageId() : lang,
          openGeneration,
        );
        deps.queueSymbols(currentPath, openGeneration);
        deps.openFileFlow({
          path: currentPath,
          languageId: lang,
          uri: (model && model.uri) ? String(model.uri.toString()) : '',
          requestId: openReqId,
          forceRefresh: true,
          generation: openGeneration,
          source: 'editor:open',
          timeoutMs: 8000,
        }).catch(function () {});
      } catch (_) {}
    }

    if (!sameFileNavigationOnly && payload.reason !== 'external_change') {
      deps.requestGitBaselines({ reason: 'open' });
    }
    deps.emitToHost('editor_open_complete', {
      path: currentPath,
      request_id: payload && payload.request_id ? String(payload.request_id) : '',
      line: tx && tx.hasExplicitNavigation ? tx.line : null,
      column: tx && tx.hasExplicitNavigation ? tx.column : null,
      reason: payload.reason || 'open',
    });
    settleOpenTransaction(deps.openTransactionStore, tx);
  } catch (err) {
    settleOpenTransaction(deps.openTransactionStore, tx);
    throw err;
  }
}
