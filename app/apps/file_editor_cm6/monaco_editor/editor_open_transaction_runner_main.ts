import type {
  EditorOpenPayload,
  EditorOpenTransactionStore,
} from './editor_open_contract.ts';
import {
  beginOpenTransaction,
  resolveOpenJumpPayload,
  settleOpenTransaction,
} from './editor_open_transaction_state.ts';
import { awaitOpenCompletion } from './editor_open_transaction_runner.ts';

interface RunEditorOpenTransactionDeps {
  getWindow(): { monaco?: any };
  getCurrentPath(): string | null;
  setCurrentPath(path: string): void;
  getBaseSha256(): string | null;
  setBaseSha256(value: string | null): void;
  getLastContentSha256(): string | null;
  setLastContentSha256(value: string | null): void;
  getEditor(): any;
  getDiffEditor(): any;
  getModel(): any;
  setModel(model: any): void;
  ensureEditorWithPrefs(): Promise<any>;
  languageFromPath(path: string): string;
  monacoFileUri(monacoRef: any, path: string): any;
  applyLanguageToModel(model: any, lang: string, absPath: string): void;
  createFileModel(content: string, lang: string, absPath: string): any;
  installMirrorPublisher(): void;
  installScrollPublisher(): void;
  vscodeRpcDidOpenIfReady(): void;
  installVscodeRpcChangePublisher(): void;
  applyLineNumberSizing(): void;
  ensureTouchSelection(reason: string): void;
  emitToHost(eventType: string, payload: Record<string, unknown>): void;
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
  applyJumpToLine(editor: any, model: any, jumpPayload: any): void;
  coercePositiveInt(value: unknown): number | null;
  shouldRecreateOpenModel(monacoRef: any, monacoFileUriFn: (monacoRef: any, path: string) => any, model: any, absPath: string): boolean;
  applyOpenModelTextSafely(model: any, editor: any, content: string, setApplyingRemote: (value: boolean) => void): void;
  emitOpenCacheState(emitToHostFn: (eventType: string, payload: Record<string, unknown>) => void, absPath: string, hasDraft: boolean, sha256: string | null, autoSave: boolean | null): void;
  queueBackendWorkbenchOpen(payload: Record<string, unknown>): void;
  setApplyingRemote(value: boolean): void;
  openTransactionStore: EditorOpenTransactionStore;
}

export async function runEditorOpenTransaction(
  deps: RunEditorOpenTransactionDeps,
  payload: EditorOpenPayload | null | undefined,
): Promise<void> {
  if (!payload || !payload.path) return;

  const incomingPath = String(payload.path || '');
  let incomingUri: any = null;
  let sameFileNavigationOnly = false;
  try {
    incomingUri = deps.monacoFileUri(deps.getWindow().monaco, incomingPath);
    const model = deps.getModel();
    sameFileNavigationOnly = !!(
      payload.reason !== 'external_change'
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
  let postOpenJumpPayload: any = null;
  try { deps.bcUpdatePath(currentPath, true); } catch (_) {}

  try {
    await deps.ensureEditorWithPrefs();
    const lang = deps.languageFromPath(currentPath);
    let model = deps.getModel();
    const editor = deps.getEditor();
    const diffEditor = deps.getDiffEditor();

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
      editor.setModel(model);
      deps.applyLanguageToModel(model, lang, currentPath);
      deps.installMirrorPublisher();
      deps.installScrollPublisher();
      deps.vscodeRpcDidOpenIfReady();
      deps.installVscodeRpcChangePublisher();
    } else {
      try {
        const want = deps.monacoFileUri(deps.getWindow().monaco, currentPath);
        if (want && model.uri && String(model.uri.toString()) !== String(want.toString())) {
          if (diffEditor) { try { diffEditor.setModel(null); } catch (_) {} }
          try { model.dispose(); } catch (_) {}
          model = deps.createFileModel(payload.content || '', lang, currentPath);
          deps.setModel(model);
          editor.setModel(model);
          deps.applyLanguageToModel(model, lang, currentPath);
          deps.installMirrorPublisher();
          deps.installScrollPublisher();
          deps.vscodeRpcDidOpenIfReady();
          deps.installVscodeRpcChangePublisher();
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

    if (!sameFileNavigationOnly && payload.reason !== 'external_change') {
      try {
        if (diffEditor && diffEditor.getModel) {
          const dm = diffEditor.getModel();
          if (dm && dm.te2FreezeProjection && dm.modifiedBaseline && model) {
            const freshContent = model.getValue();
            let modViewState: any = null;
            try {
              const modifiedEditor = diffEditor.getModifiedEditor();
              if (modifiedEditor) modViewState = modifiedEditor.saveViewState();
            } catch (_) {}
            dm.modifiedBaseline.setValue(freshContent);
            diffEditor.setModel(dm);
            try {
              if (modViewState) {
                const modifiedEditor = diffEditor.getModifiedEditor();
                if (modifiedEditor) modifiedEditor.restoreViewState(modViewState);
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    deps.setLastContentSha256(payload.content_sha256 || deps.getLastContentSha256());
    deps.emitToHost('editor_cache_state', {
      path: currentPath,
      state: payload.state || 'clean',
      unsaved: !!payload.unsaved,
      reason: payload.reason || 'open',
      content_sha256: payload.content_sha256,
      auto_save: payload.auto_save,
    });
    if (payload.has_draft) deps.requestDraftDiff('open');
    else deps.clearDraftDiffDecorations();

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

    deps.emitToHost('editor_open_complete', {
      path: currentPath,
      request_id: payload && payload.request_id ? String(payload.request_id) : '',
      line: tx && tx.hasExplicitNavigation ? tx.line : null,
      column: tx && tx.hasExplicitNavigation ? tx.column : null,
      reason: payload.reason || 'open',
    });

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
    settleOpenTransaction(deps.openTransactionStore, tx);
  } catch (err) {
    settleOpenTransaction(deps.openTransactionStore, tx);
    throw err;
  }
}
