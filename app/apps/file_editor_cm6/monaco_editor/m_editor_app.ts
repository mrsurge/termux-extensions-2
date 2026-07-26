import { buildUiUrl, fetchJsonWithBase } from "./editor_common_utils.ts";
import {
  normalizeLanguageId,
  languageIdFromPath,
  monacoFileUri,
} from "./editor_language_utils.ts";
import { parseJsonc } from "./editor_parse_utils.ts";
import { createFileModel as createMonacoFileModel } from "./editor_model_utils.ts";
import {
  runIssuesCommand,
  runFindCommand,
  runEditCommand,
} from "./editor_command_utils.ts";
import { deriveApiBase } from "./editor_api_base_utils.ts";
import { absPathFromVscodeUri } from "./editor_vscode_uri_utils.ts";
import {
  monacoRangeFromProtoRange,
  toMonacoHoverContents,
  isLanguageContextCurrent,
} from "./editor_bridge_utils.ts";
import {
  te2DumpTextmateScopesForLine,
  te2GetActiveEditorAndModel,
  te2AdvanceRuleStackToLine,
} from "./editor_textmate_debug_utils.ts";
import { applyJumpToLine as applyJumpToLineAt } from "./editor_jump_utils.ts";
import { resolveMonacoThemeId } from "./editor_theme_resolver_utils.ts";
import { isAdapterReady } from "./editor_workbench_barrier_utils.js";
import { buildMonacoOptionsFromPrefsState } from "./editor_monaco_options_utils.ts";
import { ensureTe2DiffThemeApplied } from "./editor_diff_theme_utils.ts";
import { getVscodeThemeJsonUrl } from "./editor_theme_url_utils.ts";
import { vscodeThemeToMonacoTheme } from "./editor_theme_convert_utils.ts";
import { ensureThemeRegistryState } from "./editor_theme_registry_state_utils.ts";
import { loadVscodeTextmateThemesRuntime } from "./editor_theme_loader_runtime_utils.ts";
import { applyMonacoThemeRuntime } from "./editor_theme_apply_runtime_utils.ts";
import { clearDraftDiffZonesState } from "./editor_draft_zone_clear_utils.ts";
import { clearDraftDiffDecorationsState } from "./editor_draft_decorations_clear_utils.ts";
import { resetVscodeLanguageMatchers } from "./editor_vscode_language_matchers_reset_utils.ts";
import { registerVscodeLanguageId } from "./editor_vscode_language_register_utils.ts";
import { mapVscodeLanguageExtensions } from "./editor_vscode_language_extensions_utils.ts";
import { mapVscodeLanguageFilenames } from "./editor_vscode_language_filenames_utils.ts";
import { applyVscodeLanguageConfiguration } from "./editor_vscode_language_config_utils.ts";
import { installVscodeLanguagesLoop } from "./editor_vscode_languages_install_loop_utils.ts";
import { finalizeVscodeLanguagesInstall } from "./editor_vscode_languages_finalize_utils.ts";
import { resolveAutoSaveFromPrefs } from "./editor_open_autosave_pref_utils.js";
import { fetchOpenCache } from "./editor_open_cache_fetch_utils.js";
import { resolveOpenContent } from "./editor_open_content_resolve_utils.js";
import { resolveOpenLanguage } from "./editor_open_lang_resolve_utils.js";
import { initOpenModel } from "./editor_open_model_init_utils.js";
import {
  shouldRecreateOpenModel,
  applyOpenModelTextSafely,
} from "./editor_open_model_update_utils.js";
import { emitOpenCacheState } from "./editor_open_emit_cache_state_utils.js";
import { queueBackendWorkbenchOpen } from "./editor_open_workbench_open_utils.js";
// editor_socket_readiness_step_handler_utils.js removed — readiness is now push-based via editor RPC adapter_state
import { handleJumpToLineEvent } from "./editor_socket_jump_handler_utils.ts";
import { coercePositiveInt } from "./editor_open_contract.ts";
import {
  createEditorOpenTransactionStore,
  getOpenTransactionForPath,
  beginOpenTransaction,
  resolveOpenJumpPayload,
  settleOpenTransaction,
  queueOpenTransaction,
} from "./editor_open_transaction_state.ts";
import {
  applyResolvedOpenJump,
  awaitOpenCompletion,
} from "./editor_open_transaction_runner.ts";
import { runEditorOpenTransaction } from "./editor_open_transaction_runner_main.ts";
import { handleGitBaselinesSocketEvent } from "./editor_git_baselines_socket_handler_utils.ts";
import { canInstallScrollPublisher } from "./editor_scroll_publisher_guard_utils.ts";
import { buildScrollStatePayload } from "./editor_scroll_publisher_payload_utils.ts";
import { shouldSendScrollImmediately } from "./editor_scroll_publisher_throttle_utils.ts";
import { scheduleScrollSend } from "./editor_scroll_publisher_schedule_utils.ts";
import { installScrollPublisherRuntime } from "./editor_scroll_publisher_runtime.ts";
import { shouldApplyMirrorPath } from "./editor_apply_mirror_path_utils.ts";
import { applyMirrorContent } from "./editor_apply_mirror_content_utils.ts";
import { collectBootLanguageIds } from "./editor_boot_language_ids_utils.ts";
import { warnIfPlaintextOnlyLanguages } from "./editor_boot_plaintext_warn_utils.ts";
import { applyActiveModelLanguage } from "./editor_boot_apply_active_model_language_utils.ts";
import { applyBootSnapshotToEditor } from "./editor_boot_snapshot_runtime.ts";
import {
  applyDraftDiffDecorations as applyDraftDiffDecorationsRuntime,
  applyDraftZones as applyDraftZonesRuntime,
  ensureDraftDecoCollection as ensureDraftDecoCollectionRuntime,
  installDraftZoneOrderingHook as installDraftZoneOrderingHookRuntime,
  reapplyDraftZones as reapplyDraftZonesRuntime,
} from "./editor_draft_diff_runtime.ts";
import { createEditorTextmateRuntime } from "./editor_textmate_runtime.ts";
import { createEditorTextmateThemeOwnerRuntime } from "./editor_textmate_theme_owner_runtime.ts";
import {
  disposeDiffEditorOnly as disposeDiffEditorRuntime,
  disposeGitBaselines as disposeGitBaselinesRuntime,
  disposePlainEditorOnly as disposePlainEditorRuntime,
  ensureDiffEditorWithPrefs as ensureDiffEditorWithPrefsRuntime,
  ensureEditorWithPrefs as ensureEditorWithPrefsRuntime,
  ensurePlainEditorWithPrefs as ensurePlainEditorWithPrefsRuntime,
} from "./editor_editor_lifecycle.ts";
import { applyGitBaselines as applyGitBaselinesRuntime } from "./editor_git_baseline_runtime.ts";
import { createEditorLanguageBridgeProviders } from "./editor_language_bridge_providers.ts";
import { registerEditorSaveMirrorSocketHandlers } from "./editor_save_mirror_socket_handlers.ts";
import { registerEditorRuntimeSocketHandlers } from "./editor_socket_runtime_handlers.ts";
import { createEditorBreadcrumbRuntime } from "./editor_breadcrumb_runtime.ts";
import { createEditorRpcHostActionRuntime } from "./editor_rpc_host_action_runtime.ts";
import { bootMonacoRuntime } from "./editor_monaco_boot_runtime.ts";
import { registerEditorSocketConnectionHandlers } from "./editor_socket_connection_runtime.ts";
import { createEditorWorkbenchLanguageCatalogRuntime } from "./editor_workbench_language_catalog_runtime.ts";
import { createEditorWorkbenchRuntime } from "./editor_workbench_runtime.ts";
import { createEditorRpcTransport } from "./editor_rpc_transport.ts";
import {
  EDITOR_RPC_METHODS,
  EDITOR_RPC_NOTIFICATIONS,
} from "./editor_rpc_contract.ts";
import { createEditorWbaRpcTransport } from "./editor_wba_rpc_transport.ts";
import {
  bindExtensionActivityTransport,
  notifyExtensionActivityBridgeReady,
} from "../main_page/frontend/connections/extension-activity-bridge.ts";
import { RPC_CODEC_MSGPACK_V1 } from "../src/rpc/codec.ts";
import {
  SOCKET_IO_NAMESPACES,
  SOCKET_IO_PATHS,
  fileEditorSocketQuery,
} from "../src/rpc/socketio-topology.ts";
import { registerEditorWbaRuntimeHandlers } from "./editor_wba_runtime_handlers.ts";
import { createEditorDebugRuntime } from "./editor_debug_runtime.ts";
import { createEditorUiEditorRuntime } from "./editor_ui_editor_runtime.ts";
import {
  createEditorCodeInspectorRuntime,
  type CodeInspectorRuntime,
} from "./editor_code_inspector_runtime.ts";
import {
  replaceCodeInspectorHighlights,
} from "./editor_search_highlight_runtime.ts";
import { installTextmateDebugHooks } from "./editor_textmate_debug_runtime.ts";
import { createEditorPrefRuntime } from "./editor_pref_runtime.ts";
import { createEditorMirrorRuntime } from "./editor_mirror_runtime.ts";
import { createEditorDraftDiffRequestRuntime } from "./editor_draft_diff_request_runtime.ts";
import {
  buildEditorLifecycleDeps,
  buildGitBaselineRuntimeDeps,
  buildDraftDiffRuntimeDeps,
  buildOpenTransactionDeps,
  buildSocketConnectionDeps,
  buildSaveMirrorSocketDeps,
  buildRuntimeSocketDeps,
  buildBootMonacoRuntimeDeps,
} from "./editor_app_bindings.ts";
/* eslint-disable no-undef */

interface MonacoRuntimeUriLike {
  toString(): string;
}

interface MonacoRuntimePositionLike {
  lineNumber: number;
  column: number;
  [key: string]: unknown;
}

interface MonacoRuntimeModelLike {
  uri?: MonacoRuntimeUriLike;
  getLanguageId?(): string;
  getValue(): string;
  getVersionId?(): number;
  getFullModelRange?(): unknown;
  applyEdits?(edits: Array<{ range: unknown; text: string }>): void;
  dispose?(): void;
  getLineCount?(): number;
  getLineContent?(lineNumber: number): string;
  getLineLength?(lineNumber: number): number;
}

interface MonacoRuntimeEditorLike {
  layout?(): void;
  addCommand?(keybinding: number, handler: () => void): void;
  setModel?(model: MonacoRuntimeModelLike | null): void;
  getPosition?(): MonacoRuntimePositionLike | null;
  getOption?(option: unknown): string | number | null;
  updateOptions?(options: Record<string, unknown>): void;
  saveViewState?(): unknown;
  restoreViewState?(state: unknown): void;
  getDomNode?(): HTMLElement | null;
  onDidChangeConfiguration?(listener: () => void): void;
  onDidChangeModelContent(listener: () => void): { dispose(): void };
  getScrollTop?(): number;
  setScrollTop?(value: number): void;
  getModel?(): MonacoRuntimeModelLike | null;
  getContribution?(id: string): unknown;
  createDecorationsCollection?(): unknown;
  deltaDecorations?(
    oldDecorations: unknown[],
    newDecorations: unknown[],
  ): unknown[];
  changeViewZones?(
    callback: (accessor: {
      addZone(zone: Record<string, unknown>): unknown;
    }) => void,
  ): void;
}

interface MonacoRuntimeDiffEditorLike {
  layout?(): void;
  setModel?(model: Record<string, unknown> | null): void;
  getOriginalEditor?(): MonacoRuntimeEditorLike | null;
  getModifiedEditor?(): MonacoRuntimeEditorLike | null;
  getModel?(): Record<string, unknown> | null;
  onDidUpdateDiff?(listener: () => void): void;
  __te2DraftZoneOrderBound?: boolean;
}

interface EditorSocketLike {
  connected?: boolean;
  id?: string | null;
  sendBuffer?: unknown[];
  emit(eventName: string, payload: unknown): void;
  readonly volatile: {
    emit(eventName: string, payload: unknown): void;
  };
  on?(eventName: string, handler: (payload: unknown) => void): void;
}

interface ThemeRegistryStateLike {
  registry: unknown;
  promise: Promise<unknown> | null;
}

interface SemanticTokensLegendLike {
  tokenTypes: string[];
  tokenModifiers: string[];
}

interface LanguageBridgeStateLike {
  hoverSeq: number;
  symbolsSeq: number;
  semanticTokensSeq: number;
  registeredHover: Set<string>;
  registeredSymbols: Set<string>;
  registeredFolding: Set<string>;
  registeredSemanticTokens: Set<string>;
  semanticTokensChangeEmittersByLanguage: Record<
    string,
    { event(listener: () => void): { dispose(): void }; fire(): void }
  >;
  semanticTokensLanguagesByEventHandle: Record<string, string[]>;
  completionProvidersByLanguage: Record<
    string,
    Record<
      string,
      { handle: string; triggerCharacters: string[]; supportsResolve: boolean }
    >
  >;
  completionProviderDisposablesByLanguage: Record<
    string,
    { dispose(): void } | null
  >;
  completionProviderSignatureByLanguage: Record<string, string>;
  documentColorProvidersByLanguage: Record<
    string,
    Record<string, { handle: string }>
  >;
  documentColorProviderDisposablesByLanguage: Record<
    string,
    { dispose(): void } | null
  >;
  documentColorProviderSignatureByLanguage: Record<string, string>;
  inlayHintsProvidersByLanguage: Record<
    string,
    Record<
      string,
      {
        handle: string;
        supportsResolve: boolean;
        displayName?: string | null;
        eventHandle?: number | null;
      }
    >
  >;
  inlayHintsProviderDisposablesByKey: Record<
    string,
    { dispose(): void } | null
  >;
  inlayHintsProviderSignatureByKey: Record<string, string>;
  inlineCompletionProvidersByLanguage: Record<
    string,
    Record<
      string,
      {
        handle: string;
        supportsHandleEvents: boolean;
        extensionId?: string | null;
        extensionVersion?: string | null;
        groupId?: string | null;
        yieldsToGroupIds: string[];
        excludesGroupIds: string[];
        displayName?: string | null;
        debounceDelayMs?: number | null;
        eventHandle?: number | null;
      }
    >
  >;
  inlineCompletionProviderDisposablesByKey: Record<
    string,
    { dispose(): void } | null
  >;
  inlineCompletionProviderSignatureByKey: Record<string, string>;
  semanticTokensLegendCache: Record<string, SemanticTokensLegendLike>;
  semanticTokensRangeFlag: Record<string, boolean>;
  semanticTokensResultId: Record<string, string | undefined>;
  semanticTokensDiagGated: Set<string>;
}

interface EditorModelReadyPayloadLike {
  path: string;
  languageId: string;
  generation?: number;
  request_id?: string;
  source?: string;
}

interface CachedPrefsLike extends Record<string, unknown> {
  preferences?: {
    ui?: {
      webWorkersEnabled?: boolean;
    };
    editor?: {
      theme?: string;
    };
  };
}

interface MonacoBootWindowLike extends Window {
  __te2InlineMonacoBootSnapshot?: unknown;
}

(function () {
  const bootWindow = window as MonacoBootWindowLike;
  const initialBootSnapshot = bootWindow.__te2InlineMonacoBootSnapshot || null;

  // Debug (draft diff hunks): default ON for now to diagnose incorrect ranges.
  // You can disable at runtime in the iframe console with:
  //   window.__debugDraftDiffs = false
  try {
    if (typeof window.__debugDraftDiffs === "undefined") {
      window.__debugDraftDiffs = true;
    }
    if (typeof window.__debugDisableTextmate === "undefined") {
      window.__debugDisableTextmate = false;
    }
    window.__debugDisableSemanticTokens = false;
  } catch (_) {}
  try {
    if (window.__debugDisableTextmate)
      console.log("[TextMate] disabled by __debugDisableTextmate");
    if (window.__debugDisableSemanticTokens)
      console.log("[semanticTokens] disabled by __debugDisableSemanticTokens");
  } catch (_) {}

  let editor: MonacoRuntimeEditorLike | null = null;
  let diffEditor: MonacoRuntimeDiffEditorLike | null = null;
  let model: MonacoRuntimeModelLike | null = null;
  let gitHeadModel: MonacoRuntimeModelLike | null = null;
  let gitDiskModel: MonacoRuntimeModelLike | null = null;
  let lastGitBaselines: Record<string, unknown> | null = null;
  const _workerLogOnce: Record<string, boolean> = Object.create(null);
  let currentPath: string | null = null;
  let cachedPrefs: CachedPrefsLike | null = null;
  let editorRpcSocket: EditorSocketLike | null = null;
  let wbaRpcSocket: EditorSocketLike | null = null;
  let editorSocketId: string | null = null;
  let lastModelReadySyncKey: string | null = null;
  var openTransactionStore = createEditorOpenTransactionStore();
  let baseSha256: string | null = null;
  let lastContentSha256: string | null = null;
  let lastLocalEditAt = 0;
  let isApplyingRemote = false;
  let draftDecoCollection: unknown = null;
  let draftDecoIds: unknown[] = [];
  let draftZoneIds: unknown[] = [];
  let lastDraftZones: Array<{
    after: number;
    text: string;
    lines: number;
  }> | null = null;
  let isApplyingDraftZones = false;
  let _ignoreNextModifiedViewZonesEvent = false;
  let _reapplyDraftZonesScheduled = false;
  let scrollPublisherInstalled = false;
  let diffThemeInstalled = false;
  let codeInspectorRuntime: CodeInspectorRuntime | null = null;
  var debugRuntime = createEditorDebugRuntime({
    getDocument: function () {
      return document;
    },
    getEditor: function () {
      return editor;
    },
  });
  var uiEditorRuntime = createEditorUiEditorRuntime({
    getWindow: function () {
      return window;
    },
    getDocument: function () {
      return document;
    },
    getMonaco: function () {
      return monaco || window.monaco || null;
    },
    getEditor: function () {
      return editor as never;
    },
    getDiffEditor: function () {
      return diffEditor as never;
    },
    getModel: function () {
      return model;
    },
    getGitHeadModel: function () {
      return gitHeadModel;
    },
    getGitDiskModel: function () {
      return gitDiskModel;
    },
    getCurrentPath: function () {
      return currentPath;
    },
    sendEditorMentionRequest: function (payload) {
      return editorRpcNotify(EDITOR_RPC_METHODS.mentionRequest, payload);
    },
    inspectCode: function (mode) {
      codeInspectorRuntime?.start(mode);
    },
    updateDebug: function (extra) {
      return debugRuntime.updateDebug(extra);
    },
  });
  var prefRuntime = createEditorPrefRuntime({
    getCachedPrefs: function () {
      return cachedPrefs;
    },
    getLastLocalEditAt: function () {
      return lastLocalEditAt;
    },
    isRpcConnected: isEditorRpcConnected,
    rpcCall: editorRpcCall,
    getCurrentPath: function () {
      return currentPath;
    },
    getDiffEditor: function () {
      return diffEditor;
    },
    disposeGitBaselines: function () {
      return disposeGitBaselines();
    },
    ensurePlainEditorWithPrefs: function () {
      return ensurePlainEditorWithPrefs();
    },
    applyGitBaselines: function (payload) {
      return applyGitBaselines(payload);
    },
    noteGitBaselineRequest: function (source, immediate) {
      return debugRuntime.noteGitBaselineRequest(source, immediate);
    },
  });
  var draftDiffRequestRuntime = createEditorDraftDiffRequestRuntime({
    isRpcConnected: isEditorRpcConnected,
    rpcCall: editorRpcCall,
    getCurrentPath: function () {
      return currentPath;
    },
    getShowDraftInsertions: function () {
      return prefRuntime.getShowDraftInsertions();
    },
  });
  var mirrorRuntime = createEditorMirrorRuntime({
    getEditor: function () {
      return editor;
    },
    getCurrentPath: function () {
      return currentPath;
    },
    getModel: function () {
      return model;
    },
    getBaseSha256: function () {
      return baseSha256;
    },
    getIsApplyingRemote: function () {
      return isApplyingRemote;
    },
    setLastLocalEditAt: function (value) {
      lastLocalEditAt = value;
    },
    publishDidChange: function (path, text, languageId, generation) {
      return _wbPublishDidChange(path, text, languageId, generation);
    },
    getCurrentGeneration: function () {
      return _wbCurrentGeneration();
    },
    requestDraftDiff: function (reason) {
      return draftDiffRequestRuntime.requestDraftDiff(reason);
    },
    getLocalMirrorDebounceMs: function () {
      return prefRuntime.getLocalMirrorDebounceMs();
    },
    setMirrorActive: function (value) {
      return debugRuntime.setMirrorActive(value);
    },
    incrementMirrorBindTotal: function () {
      return debugRuntime.incrementMirrorBindTotal();
    },
    syncTraceDebug: function () {
      return debugRuntime.syncTraceDebug();
    },
    isRpcConnected: isEditorRpcConnected,
    rpcCall: editorRpcCall,
  });

  var breadcrumbRuntime = createEditorBreadcrumbRuntime({
    getDocument: function () {
      return document;
    },
    getEditor: function () {
      return editor;
    },
    getCurrentPath: function () {
      return currentPath;
    },
    getModel: function () {
      return model;
    },
    notifyEditorRpc: function (method, payload) {
      return editorRpcNotify(method, payload);
    },
    wbCurrentGeneration: _wbCurrentGeneration,
    wbIsBarrierOpen: _wbIsBarrierOpen,
    wbQueueSymbols: _wbQueueSymbols,
    languageFromPath: languageFromPath,
    editorWorkbenchCall: editorWorkbenchCall,
    applyJumpToLine: function (line, col) {
      applyJumpToLineAt(editor, model, {
        line: line,
        column: col,
        focus: true,
        scroll_y: "center",
      });
    },
  } as Parameters<typeof createEditorBreadcrumbRuntime>[0]);

  var editorHostActionRuntime = createEditorRpcHostActionRuntime({
    getWindow: function () {
      return window;
    },
    getEditor: function () {
      return editor;
    },
    getDiffEditor: function () {
      return diffEditor;
    },
    replayOpenFileAfterBaton: _replayOpenFileAfterBaton,
    onProjectSwitching: function (params) {
      try {
        editorWbaRpcTransport.rejectPending("project switching");
      } catch (_) {}
      try {
        workbenchRuntime.wbBeginProjectSwitch(params || {});
      } catch (_) {}
    },
    onProjectSwitched: function (params) {
      try {
        workbenchRuntime.wbEndProjectSwitch(params || {});
      } catch (_) {}
      try {
        _replayOpenFileAfterBaton();
      } catch (_) {}
    },
    notifyEditorRpc: function (method, params) {
      return editorRpcNotify(method, params);
    },
    onEditorRpcNotification: function (method, handler) {
      return editorRpcTransport.onNotification(method, handler);
    },
  } as Parameters<typeof createEditorRpcHostActionRuntime>[0]);

  var updateDebug = debugRuntime.updateDebug;
  var setDebugGit = debugRuntime.setDebugGit;
  var setDebugDraft = debugRuntime.setDebugDraft;
  var setDebugDiag = debugRuntime.setDebugDiag;
  var setDebugFlags = debugRuntime.setDebugFlags;
  var setDebugMirror = debugRuntime.setDebugMirror;
  var setDebugTrace = debugRuntime.setDebugTrace;
  var _syncTraceDebug = debugRuntime.syncTraceDebug;
  var _syncMirrorDebug = debugRuntime.syncMirrorDebug;
  var _setUnsavedTrace = debugRuntime.setUnsavedTrace;
  var _noteGitBaselineRequest = debugRuntime.noteGitBaselineRequest;
  var getShowInlineDiffs = prefRuntime.getShowInlineDiffs;
  var getShowDraftDiffs = prefRuntime.getShowDraftDiffs;
  var getUseTrueInlineView = prefRuntime.getUseTrueInlineView;
  var getAutoSave = prefRuntime.getAutoSave;
  var shouldDropDuplicateEditorOpen = prefRuntime.shouldDropDuplicateEditorOpen;
  var getEditorContainer = uiEditorRuntime.getEditorContainer;
  var _layoutEditors = uiEditorRuntime.layoutEditors;
  var ensureLayoutObserver = uiEditorRuntime.ensureLayoutObserver;
  var _forceSemanticHighlighting = uiEditorRuntime.forceSemanticHighlighting;
  var _installMarkerNavBindingsRuntime =
    uiEditorRuntime.installMarkerNavBindings;
  var ensureTouchSelection = uiEditorRuntime.ensureTouchSelection;
  var _syncReadOnlyInputMode = uiEditorRuntime.syncReadOnlyInputMode;
  var _onEditorConfigChanged = uiEditorRuntime.onEditorConfigChanged;
  var applyEditorTypography = uiEditorRuntime.applyEditorTypography;
  var applyLineNumberSizing = uiEditorRuntime.applyLineNumberSizing;

  function _fetch(url: string | URL, init?: RequestInit): Promise<Response> {
    return window.fetch(url, init);
  }

  function _setTimeoutBound(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout> {
    return window.setTimeout(callback, delayMs);
  }

  function _clearTimeoutBound(timer: ReturnType<typeof setTimeout>): void {
    window.clearTimeout(timer);
  }
  var apiBase = deriveApiBase(window.location);
  var editorRpcTransport = createEditorRpcTransport({
    getSocket: function () {
      return editorRpcSocket;
    },
    setTimeoutFn: _setTimeoutBound,
    clearTimeoutFn: _clearTimeoutBound,
    onProtocolError: function (error: unknown) {
      console.error("[editor-rpc] MessagePack protocol error", error);
    },
    onReliablePublishError: function (method: string, error: Error) {
      console.error("[editor-rpc] reliable publish failed", method, error);
    },
  });
  var editorWbaRpcTransport = createEditorWbaRpcTransport({
    getSocket: function () {
      return wbaRpcSocket;
    },
    setTimeoutFn: _setTimeoutBound,
    clearTimeoutFn: _clearTimeoutBound,
    onProtocolError: function (error: unknown) {
      console.error("[editor-wba-rpc] MessagePack protocol error", error);
    },
  });
  bindExtensionActivityTransport(editorWbaRpcTransport);

  var textmateRuntime = createEditorTextmateRuntime({
    getWindow: function () {
      return window;
    },
    getApiBase: function () {
      return apiBase;
    },
    fetchFn: _fetch,
    fetchJsonWithBase: function (path, init) {
      return fetchJsonWithBase(_fetch, apiBase, path, init);
    },
    buildUiUrl: function (path) {
      return buildUiUrl(apiBase, path);
    },
    normalizeLanguage: normalizeLanguage,
    editorWorkbenchCall: editorWorkbenchCall,
  } as Parameters<typeof createEditorTextmateRuntime>[0]);

  function _applyThemeToTextmateRegistry(vscodeThemeJson: unknown): void {
    textmateRuntime.applyThemeToRegistry(vscodeThemeJson);
  }

  var ensureTextmateTokenization = textmateRuntime.ensureTextmateTokenization;
  let textmateThemeOwnerRuntime: ReturnType<
    typeof createEditorTextmateThemeOwnerRuntime
  > | null = null;
  installTextmateDebugHooks({
    getWindow: function () {
      return window;
    },
    getCurrentPath: function () {
      return currentPath;
    },
    getActiveEditorAndModel: function () {
      return te2GetActiveEditorAndModel(diffEditor, editor);
    },
    normalizeLanguage: normalizeLanguage,
    languageFromPath: languageFromPath,
    getGrammarForLanguage: function (languageId) {
      return textmateRuntime.getGrammarForLanguage(languageId);
    },
    advanceRuleStackToLine: function (grammar, activeModel, targetLine) {
      if (!activeModel) return (window.vscodetextmate || {}).INITIAL;
      return te2AdvanceRuleStackToLine(
        window.vscodetextmate || {},
        grammar as MonacoTextmateGrammarLike,
        activeModel as MonacoRuntimeModelLike,
        targetLine,
      );
    },
    dumpTextmateScopesForLine: function (lang, text, ruleStack) {
      return te2DumpTextmateScopesForLine(
        textmateRuntime.getGrammarByLang() as Record<
          string,
          MonacoTextmateGrammarLike | undefined
        >,
        window.vscodetextmate || {},
        lang,
        text,
        ruleStack,
      );
    },
  } as Parameters<typeof installTextmateDebugHooks>[0]);

  function applyLanguageToModel(
    nextModel: MonacoRuntimeModelLike,
    languageId: string,
    filePath: string,
  ): void {
    if (textmateThemeOwnerRuntime) {
      textmateThemeOwnerRuntime.applyLanguageToModel(
        nextModel,
        languageId,
        filePath,
      );
      return;
    }
    try {
      let lang = normalizeLanguage(languageId);
      if ((!lang || lang === "plaintext") && filePath)
        lang = languageFromPath(filePath);
      if (
        nextModel &&
        window.monaco &&
        window.monaco.editor &&
        typeof window.monaco.editor.setModelLanguage === "function"
      ) {
        window.monaco.editor.setModelLanguage(nextModel, lang || "plaintext");
      }
    } catch (_) {}
  }

  function normalizeLanguage(lang: unknown): string {
    return normalizeLanguageId(lang);
  }

  function languageFromPath(path: string | null): string {
    return languageIdFromPath(
      path,
      workbenchLanguageCatalogRuntime
        ? workbenchLanguageCatalogRuntime.getLanguageByFilename()
        : new Map<string, string>(),
      workbenchLanguageCatalogRuntime
        ? workbenchLanguageCatalogRuntime.getLanguageByExtension()
        : new Map<string, string>(),
    );
  }

  function createFileModel(
    content: string,
    lang: string,
    absPath: string,
  ): MonacoRuntimeModelLike {
    return createMonacoFileModel(
      monaco,
      function (p: string | null | undefined) {
        return monacoFileUri(window.monaco, p) as MonacoRuntimeUriLike | null;
      },
      content,
      lang,
      absPath,
      function () {},
    ) as MonacoRuntimeModelLike;
  }

  function applyBootSnapshot(): void {
    applyBootSnapshotToEditor({
      getBootSnapshot: function () {
        return initialBootSnapshot;
      },
      getCachedPrefs: function () {
        return cachedPrefs;
      },
      setCachedPrefs: function (value: CachedPrefsLike | null) {
        cachedPrefs = value;
      },
      getCurrentPath: function () {
        return currentPath;
      },
      setCurrentPath: function (value: string | null) {
        currentPath = value;
      },
      getBaseSha256: function () {
        return baseSha256;
      },
      setBaseSha256: function (value: string | null) {
        baseSha256 = value;
      },
      getLastContentSha256: function () {
        return lastContentSha256;
      },
      setLastContentSha256: function (value: string | null) {
        lastContentSha256 = value;
      },
      getModel: function () {
        return model;
      },
      setModel: function (value: MonacoRuntimeModelLike | null) {
        model = value;
      },
      createFileModel: createFileModel,
      applyLanguageToModel: applyLanguageToModel,
      languageFromPath: function (path: string) {
        return languageFromPath(path);
      },
    });
  }

  function editorRpcCall(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown> {
    return editorRpcTransport.call(
      method as Parameters<typeof editorRpcTransport.call>[0],
      params || {},
      opts,
    );
  }

  function editorRpcNotify(
    method: string,
    params?: Record<string, unknown>,
  ): boolean {
    return editorRpcTransport.notify(
      method as Parameters<typeof editorRpcTransport.notify>[0],
      params || {},
    );
  }

  function isEditorRpcConnected(): boolean {
    return editorRpcTransport.isConnected();
  }

  function editorWbaRpcCall(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown> {
    return editorWbaRpcTransport.call(method, params || {}, opts);
  }

  function editorWbaRpcNotify(
    method: string,
    params?: Record<string, unknown>,
  ): boolean {
    return editorWbaRpcTransport.notify(method, params || {});
  }

  function isEditorWbaRpcConnected(): boolean {
    return editorWbaRpcTransport.isConnected();
  }

  function _applyDiagnosticsUpdate(params: unknown): void {
    workbenchRuntime.applyDiagnosticsUpdate(params);
  }

  function _emitAggregatedDiagCounts(path?: string | null): void {
    workbenchRuntime.emitAggregatedDiagCounts(path);
  }

  function _clearDiagnosticsForSwitch() {
    workbenchRuntime.clearDiagnosticsForSwitch();
  }

  function _clearDiagnosticsForLeavingModel(reason?: string): void {
    workbenchRuntime.clearDiagnosticsForLeavingModel(reason || "leaving_model");
  }

  function _syncDiagnosticsForCurrentModel(reason?: string): void {
    workbenchRuntime.syncDiagnosticsForCurrentModel(reason);
  }

  function _absPathFromVscodeUri(raw: string): string | null {
    return absPathFromVscodeUri(raw);
  }

  function _currentLanguageContext() {
    return workbenchRuntime.currentLanguageContext();
  }

  const languageBridge: LanguageBridgeStateLike = {
    hoverSeq: 0,
    symbolsSeq: 0,
    semanticTokensSeq: 0,
    registeredHover: new Set<string>(),
    registeredSymbols: new Set<string>(),
    registeredFolding: new Set<string>(),
    registeredSemanticTokens: new Set<string>(),
    semanticTokensChangeEmittersByLanguage: {},
    semanticTokensLanguagesByEventHandle: {},
    completionProvidersByLanguage: {},
    completionProviderDisposablesByLanguage: {},
    completionProviderSignatureByLanguage: {},
    documentColorProvidersByLanguage: {},
    documentColorProviderDisposablesByLanguage: {},
    documentColorProviderSignatureByLanguage: {},
    inlayHintsProvidersByLanguage: {},
    inlayHintsProviderDisposablesByKey: {},
    inlayHintsProviderSignatureByKey: {},
    inlineCompletionProvidersByLanguage: {},
    inlineCompletionProviderDisposablesByKey: {},
    inlineCompletionProviderSignatureByKey: {},
    semanticTokensLegendCache: {},
    semanticTokensRangeFlag: {},
    semanticTokensResultId: {},
    semanticTokensDiagGated: new Set<string>(),
  };
  var workbenchRuntime = createEditorWorkbenchRuntime({
    getWindow: function () {
      return window;
    },
    getMonaco: function () {
      return monaco || window.monaco || null;
    },
    getEditor: function () {
      return editor;
    },
    getModel: function () {
      return model;
    },
    getCurrentPath: function () {
      return currentPath;
    },
    emitToHost: emitToHost,
    absPathFromVscodeUri: _absPathFromVscodeUri,
    languageFromPath: languageFromPath,
    isLanguageContextCurrent: isLanguageContextCurrent,
    getLanguageBridge: function () {
      return languageBridge;
    },
    setDebugDiag: setDebugDiag,
    requestBreadcrumbSymbols: function (path, opts) {
      breadcrumbRuntime.requestSymbols(path, opts);
    },
    languageWorkersEnabled: _languageWorkersEnabled,
    isWbaRpcConnected: isEditorWbaRpcConnected,
    wbaRpcCall: editorWbaRpcCall,
    wbaRpcNotify: editorWbaRpcNotify,
    clearTimeoutFn: _clearTimeoutBound,
    setTimeoutFn: _setTimeoutBound,
  } as Parameters<typeof createEditorWorkbenchRuntime>[0]);
  codeInspectorRuntime = createEditorCodeInspectorRuntime({
    getEditor: function () {
      return (
        diffEditor?.getModifiedEditor?.() ??
        editor
      ) as never;
    },
    getCurrentPath: function () {
      return currentPath;
    },
    editorWorkbenchCall: function (method, params, opts) {
      return editorWorkbenchCall(method, params, opts);
    },
    publishProjection: function (projection) {
      return editorRpcTransport.publishReliable(
        EDITOR_RPC_METHODS.codeInspectorPublish,
        { projection },
        { timeoutMs: 12000 },
      );
    },
    replaceHighlights: function (ranges) {
      replaceCodeInspectorHighlights(
        diffEditor?.getModifiedEditor?.() ?? editor,
        ranges,
      );
    },
    logError: function (message, error) {
      console.error("[code-inspector]", message, error);
    },
  });
  editorRpcTransport.onNotification(
    EDITOR_RPC_NOTIFICATIONS.codeInspectorCommand,
    function (params) {
      codeInspectorRuntime?.handleCommand(params);
    },
  );
  window.addEventListener(
    "pagehide",
    function () {
      codeInspectorRuntime?.dispose();
    },
    { once: true },
  );
  let workbenchLanguageCatalogRuntime: ReturnType<
    typeof createEditorWorkbenchLanguageCatalogRuntime
  > | null = null;
  var languageBridgeProviders = createEditorLanguageBridgeProviders({
    getMonaco: function () {
      return window.monaco || null;
    },
    getLanguageWorkersEnabled: _languageWorkersEnabled,
    getDisableSemanticTokens: function () {
      return !!window.__debugDisableSemanticTokens;
    },
    getCurrentPath: function () {
      return currentPath;
    },
    getHasModel: function () {
      return !!model;
    },
    getCurrentLanguageContext: _currentLanguageContext,
    callWorkbenchProviderGuarded: _callWorkbenchProviderGuarded,
    editorWorkbenchCall: editorWorkbenchCall,
    absPathFromVscodeUri: _absPathFromVscodeUri,
    monacoRangeFromProtoRange: function (range: unknown) {
      return monacoRangeFromProtoRange(window.monaco, range);
    },
    toMonacoHoverContents: toMonacoHoverContents,
    flushMirrorDebounce: _flushMirrorDebounce,
    ensureWorkbenchLanguageCatalogInstalled: function () {
      return ensureWorkbenchLanguageCatalogInstalled().then(function () {});
    },
    getWorkbenchLanguageIds: function () {
      return workbenchLanguageCatalogRuntime
        ? workbenchLanguageCatalogRuntime.getLanguageIds()
        : new Set<string>();
    },
    languageBridge: languageBridge,
  } as unknown as Parameters<typeof createEditorLanguageBridgeProviders>[0]);

  // ── Workbench RPC over editor Socket.IO ──────────────────────────
  // Routes hover/symbols/openFile through editor_ws.py → adapter stdio pipe.
  // Replaces the old deprecated websocket harness path.
  function _isAdapterReady(): boolean {
    return isAdapterReady(window);
  }

  function _wbCurrentGeneration() {
    return workbenchRuntime.wbCurrentGeneration();
  }

  function _wbBumpGeneration(path: string | null, reason: string): number {
    return workbenchRuntime.wbBumpGeneration(path, reason);
  }

  function _wbIsFrameworkReady() {
    return workbenchRuntime.wbIsFrameworkReady();
  }

  function _wbIsBarrierOpen(path: string | null, generation?: number): boolean {
    return workbenchRuntime.wbIsBarrierOpen(path, generation);
  }

  function _wbSetOpenAck(path: string, generation: number): void {
    return workbenchRuntime.wbSetOpenAck(path, generation);
  }

  function _wbQueueDidChange(
    path: string,
    text: string,
    languageId: string,
    generation: number,
  ): void {
    return workbenchRuntime.wbQueueDidChange(
      path,
      text,
      languageId,
      generation,
    );
  }

  function _wbQueueSymbols(path: string, generation: number): void {
    return workbenchRuntime.wbQueueSymbols(path, generation);
  }

  function _wbFlushDidChangeIfReady() {
    return workbenchRuntime.wbFlushDidChangeIfReady();
  }

  function _wbFlushSymbolsIfReady() {
    return workbenchRuntime.wbFlushSymbolsIfReady();
  }

  function _wbFlushPendingAfterOpen() {
    return workbenchRuntime.wbFlushPendingAfterOpen();
  }

  function _wbSchedulePostReadyStructureRefresh(
    path: string,
    generation: number,
    reason?: string,
  ): void {
    return workbenchRuntime.wbSchedulePostReadyStructureRefresh(
      path,
      generation,
      reason,
    );
  }

  function _wbPublishDidChange(
    path: string,
    text: string,
    languageId: string,
    generation: number,
  ): boolean {
    return workbenchRuntime.wbPublishDidChange(
      path,
      text,
      languageId,
      generation,
    );
  }

  function _wbOpenFileFlow(opts: Record<string, unknown>): Promise<unknown> {
    return workbenchRuntime.wbOpenFileFlow(opts || {});
  }

  function _replayOpenFileAfterBaton() {
    return workbenchRuntime
      .replayOpenFileAfterBaton()
      .then(() => {
        replayActiveModelLanguageAfterWbaConnect("baton");
        refreshActiveLanguageIntelligenceAfterWbaConnect("baton");
      })
      .catch((error) => {
        console.warn("[readiness] baton active model flush failed", error);
      });
  }

  function editorWorkbenchCall(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<unknown> {
    return workbenchRuntime.editorWorkbenchCall(method, params || {}, opts);
  }

  function _callWorkbenchProviderGuarded(
    kind: string,
    method: string,
    params: Record<string, unknown>,
    ctx: unknown,
    opts?: {
      timeoutMs?: number;
      cancelToken?: { isCancellationRequested?: boolean } | null;
    },
  ): Promise<Record<string, unknown>> {
    return workbenchRuntime.callWorkbenchProviderGuarded(
      kind,
      method,
      params || {},
      ctx,
      opts,
    );
  }

  function _languageWorkersEnabled() {
    return !!(
      cachedPrefs &&
      cachedPrefs.preferences &&
      cachedPrefs.preferences.ui &&
      cachedPrefs.preferences.ui.webWorkersEnabled === true
    );
  }

  function _registerSemanticTokensWithLegend(
    langId: string,
    legend: unknown,
    isRange: boolean,
  ): void {
    languageBridgeProviders.registerSemanticTokensWithLegend(
      langId,
      legend as SemanticTokensLegendLike,
      !!isRange,
    );
  }

  function installWorkbenchLanguageBridgeProviders() {
    languageBridgeProviders.installWorkbenchLanguageBridgeProviders();
  }

  let providerSnapshotHydratePromise: Promise<void> | null = null;

  function hydrateWorkbenchProviderSnapshot(reason: string): Promise<void> {
    if (providerSnapshotHydratePromise) return providerSnapshotHydratePromise;
    providerSnapshotHydratePromise = editorWorkbenchCall(
      "providers",
      {},
      { timeoutMs: 5000 },
    )
      .then((snapshot) => {
        const counts =
          languageBridgeProviders.hydrateProviderSnapshot(snapshot);
        console.log(
          "[providers] hydrated snapshot reason=" +
            String(reason || "unknown") +
            " completions=" +
            counts.completions +
            " colors=" +
            counts.documentColors +
            " inlay=" +
            counts.inlayHints +
            " inline=" +
            counts.inlineCompletions +
            " semTok=" +
            counts.semanticTokens,
        );
      })
      .catch((error) => {
        console.warn(
          "[providers] snapshot hydrate failed (" +
            String(reason || "unknown") +
            ")",
          error,
        );
      })
      .finally(() => {
        providerSnapshotHydratePromise = null;
      });
    return providerSnapshotHydratePromise;
  }

  function replayActiveModelLanguageAfterWbaConnect(reason: string): void {
    try {
      console.log(
        "[wba] replay active model language reason=" +
          String(reason || "unknown") +
          " path=" +
          String(currentPath || ""),
      );
      applyActiveModelLanguage(
        window,
        model,
        currentPath,
        applyLanguageToModel,
        languageFromPath,
      );
    } catch (error) {
      console.warn("[wba] replay active model language failed", error);
    }
  }

  function refreshActiveLanguageIntelligenceAfterWbaConnect(
    reason: string,
  ): void {
    const activePath = String(currentPath || "");
    if (!activePath) return;
    try {
      workbenchRuntime.wbFlushDidChangeIfReady();
    } catch (error) {
      console.warn("[wba] didChange flush failed after connect", error);
    }
    try {
      workbenchRuntime.wbFlushSymbolsIfReady();
    } catch (error) {
      console.warn("[wba] symbols flush failed after connect", error);
    }
    try {
      const languageId =
        model && typeof model.getLanguageId === "function"
          ? String(model.getLanguageId() || "")
          : "";
      languageBridgeProviders.fireSemanticTokensChanged(languageId || null);
    } catch (error) {
      console.warn(
        "[wba] semantic-token invalidation failed after connect",
        error,
      );
    }
    try {
      const generation = workbenchRuntime.wbCurrentGeneration();
      _bcRequestSymbols(activePath, { generation });
      workbenchRuntime.wbSchedulePostReadyStructureRefresh(
        activePath,
        generation,
        "wba_ready:" + String(reason || "unknown"),
      );
    } catch (error) {
      console.warn(
        "[wba] active language-intelligence refresh failed after connect",
        error,
      );
    }
  }

  function handleWbaSocketReadyForEditor(reason: string): void {
    void workbenchRuntime
      .wbFlushActiveModelOpen("wba_ready:" + String(reason || "connect"))
      .catch((error) => {
        console.warn(
          "[wba] active model open flush failed after connect",
          error,
        );
      })
      .then((result) => {
        const record =
          result && typeof result === "object"
            ? (result as Record<string, unknown>)
            : {};
        if (record.deferred === true) return null;
        return hydrateWorkbenchProviderSnapshot(reason).finally(() => {
          replayActiveModelLanguageAfterWbaConnect(reason);
          refreshActiveLanguageIntelligenceAfterWbaConnect(reason);
        });
      });
  }

  function _clearEditorDecorationStateRuntime() {
    draftDecoCollection = null;
    draftDecoIds = [];
    draftZoneIds = [];
  }

  function _clearGitBaselineModelsRuntime(): void {
    try {
      if (gitHeadModel && gitHeadModel.dispose) gitHeadModel.dispose();
    } catch (_) {}
    try {
      if (gitDiskModel && gitDiskModel.dispose) gitDiskModel.dispose();
    } catch (_) {}
    gitHeadModel = null;
    gitDiskModel = null;
    lastGitBaselines = null;
  }

  function _setScrollPublisherInstalled(value: boolean): void {
    scrollPublisherInstalled = !!value;
  }

  function disposeDiffEditorOnly() {
    disposeDiffEditorRuntime(editorLifecycleDeps);
  }

  function disposePlainEditorOnly() {
    disposePlainEditorRuntime(editorLifecycleDeps);
  }

  function disposeGitBaselines() {
    disposeGitBaselinesRuntime(editorLifecycleDeps);
  }

  function buildMonacoOptionsFromPrefs(
    state: unknown,
  ): Record<string, unknown> {
    return buildMonacoOptionsFromPrefsState(
      state,
      textmateThemeOwnerRuntime
        ? textmateThemeOwnerRuntime.getThemeJsonCache()
        : {},
    );
  }

  function ensureTe2DiffTheme(): void {
    diffThemeInstalled = ensureTe2DiffThemeApplied(window, diffThemeInstalled);
  }

  var editorLifecycleDeps = buildEditorLifecycleDeps({
    getMonaco: function () {
      return window.monaco || null;
    },
    getEditorContainer: getEditorContainer,
    fetchSSOTState: fetchSSOTState,
    getCachedPrefs: function () {
      return cachedPrefs;
    },
    setCachedPrefs: function (value: CachedPrefsLike | null) {
      cachedPrefs = value;
    },
    getEditor: function () {
      return editor;
    },
    setEditor: function (value: MonacoRuntimeEditorLike | null) {
      editor = value;
    },
    getDiffEditor: function () {
      return diffEditor;
    },
    setDiffEditor: function (value: MonacoRuntimeDiffEditorLike | null) {
      diffEditor = value;
    },
    getModel: function () {
      return model;
    },
    getCurrentPath: function () {
      return currentPath;
    },
    disposeMirrorPublisher: function () {
      return mirrorRuntime.disposeMirrorPublisher();
    },
    setScrollPublisherInstalled: _setScrollPublisherInstalled,
    clearEditorDecorationState: _clearEditorDecorationStateRuntime,
    clearGitBaselineModels: _clearGitBaselineModelsRuntime,
    buildMonacoOptionsFromPrefs: buildMonacoOptionsFromPrefs,
    forceSemanticHighlighting: _forceSemanticHighlighting,
    installMarkerNavBindings: _installMarkerNavBindingsRuntime,
    applyMonacoTheme: applyMonacoTheme,
    ensureTouchSelection: ensureTouchSelection,
    syncReadOnlyInputMode: _syncReadOnlyInputMode,
    onEditorConfigChanged: _onEditorConfigChanged,
    updateDebug: updateDebug,
    ensureLayoutObserver: ensureLayoutObserver,
    bindEditorHostActionHooks: bindEditorHostActionHooks,
    installMirrorPublisher: installMirrorPublisher,
    installScrollPublisher: installScrollPublisher,
    requestBreadcrumbSymbols: _bcRequestSymbols,
    layoutEditors: _layoutEditors,
  }) as Parameters<typeof ensureEditorWithPrefsRuntime>[0];

  // ensureTe2Themes / loadOfficialThemes — replaced by loadVscodeTextmateThemes() with dynamic registry.

  // Theme registry: fetched once from the available_themes endpoint.
  // Maps theme ID → { serveUrl, label, uiTheme, source }.
  let _themeRegistry: unknown = null;
  let _themeRegistryPromise: Promise<unknown> | null = null;
  const _themeRegistryState: ThemeRegistryStateLike = {
    registry: null,
    promise: null,
  };

  async function _ensureThemeRegistry(): Promise<unknown> {
    _themeRegistryState.registry = _themeRegistry;
    _themeRegistryState.promise = _themeRegistryPromise;
    var reg = await ensureThemeRegistryState(
      _themeRegistryState,
      _fetch,
      buildUiUrl,
      apiBase,
    );
    _themeRegistry = reg;
    _themeRegistryPromise = _themeRegistryState.promise;
    return reg;
  }

  function _getVscodeThemeJsonUrl(themeId: string): string {
    return (
      getVscodeThemeJsonUrl(
        themeId,
        _themeRegistryState.registry || _themeRegistry,
        apiBase,
      ) || ""
    );
  }

  // ---------------------------------------------------------------------------
  // Semantic-token-type → TextMate-scope mapping (mirrors VS Code's
  // tokenClassificationRegistry in tokenClassificationRegistry.ts).
  // Monaco standalone's getTokenStyleMetadata() matches semantic token types
  // directly against theme rules, but themes only define TextMate scopes.
  // This bridge resolves each semantic type to the correct TextMate colour.
  // ---------------------------------------------------------------------------
  function _vscodeThemeToMonacoTheme(
    themeId: string,
    vscodeJson: unknown,
  ): unknown {
    return vscodeThemeToMonacoTheme(themeId, vscodeJson);
  }

  // ------------------------------------------------------------------
  // Workbench-owned language catalog install. This replaces the old
  // deprecated websocket language/bootstrap lane.
  // ------------------------------------------------------------------

  workbenchLanguageCatalogRuntime = createEditorWorkbenchLanguageCatalogRuntime(
    {
      getWindow: function () {
        return window;
      },
      fetchLanguageCatalog: function () {
        return editorWorkbenchCall("language_catalog", {}, { timeoutMs: 8000 });
      },
      normalizeLanguage: normalizeLanguage,
      registerVscodeLanguageId: registerVscodeLanguageId,
      mapVscodeLanguageExtensions: mapVscodeLanguageExtensions,
      mapVscodeLanguageFilenames: mapVscodeLanguageFilenames,
      applyVscodeLanguageConfiguration: applyVscodeLanguageConfiguration,
      installVscodeLanguagesLoop: installVscodeLanguagesLoop,
      finalizeVscodeLanguagesInstall: finalizeVscodeLanguagesInstall,
      installWorkbenchLanguageBridgeProviders:
        installWorkbenchLanguageBridgeProviders,
      parseJsonc: parseJsonc,
    },
  );

  textmateThemeOwnerRuntime = createEditorTextmateThemeOwnerRuntime({
    getWindow: function () {
      return window;
    },
    getDocument: function () {
      return document;
    },
    fetchFn: _fetch,
    ensureTe2DiffTheme: ensureTe2DiffTheme,
    loadVscodeTextmateThemesRuntime: loadVscodeTextmateThemesRuntime,
    applyMonacoThemeRuntime: applyMonacoThemeRuntime,
    ensureThemeRegistry: _ensureThemeRegistry,
    getVscodeThemeJsonUrl: _getVscodeThemeJsonUrl,
    vscodeThemeToMonacoTheme: _vscodeThemeToMonacoTheme,
    resolveMonacoThemeId: resolveMonacoThemeId,
    applyThemeToTextmateRegistry: _applyThemeToTextmateRegistry,
    normalizeLanguage: normalizeLanguage,
    languageFromPath: languageFromPath,
    ensureWorkbenchLanguageCatalogInstalled: function () {
      return ensureWorkbenchLanguageCatalogInstalled();
    },
    ensureTextmateTokenization: function (languageId, filePath) {
      return ensureTextmateTokenization(languageId, filePath);
    },
    installWorkbenchLanguageBridgeProviders:
      installWorkbenchLanguageBridgeProviders,
  });

  async function ensureWorkbenchLanguageCatalogInstalled(): Promise<boolean> {
    return workbenchLanguageCatalogRuntime
      ? workbenchLanguageCatalogRuntime.ensureWorkbenchLanguageCatalogInstalled()
      : false;
  }

  async function applyMonacoTheme(themeKey: string): Promise<void> {
    if (textmateThemeOwnerRuntime) {
      return textmateThemeOwnerRuntime.applyTheme(themeKey);
    }
  }

  function emitToHost(
    eventName: string,
    payload: Record<string, unknown>,
  ): boolean {
    if (eventName === "editor_open_complete") {
      return editorRpcTransport.publishReliable(
        EDITOR_RPC_METHODS.openCompletePublish,
        payload,
        { timeoutMs: 10000 },
      );
    }
    const eventMethodMap: Record<string, string> = {
      editor_cache_state: EDITOR_RPC_METHODS.cacheStatePublish,
      editor_draft_state: EDITOR_RPC_METHODS.draftStatePublish,
      editor_notify: EDITOR_RPC_METHODS.notifyPublish,
      editor_ready: EDITOR_RPC_METHODS.readyPublish,
      "editor:iframe_ready": EDITOR_RPC_METHODS.readyPublish,
      editor_diagnostics_counts: EDITOR_RPC_METHODS.diagnosticsCountsPublish,
      editor_save_snapshot_response: EDITOR_RPC_METHODS.saveSnapshotResponse,
      editor_issues_dump_response: EDITOR_RPC_METHODS.issuesDumpResponse,
    };
    const method = eventMethodMap[eventName];
    if (!method) return false;
    return editorRpcNotify(method, payload);
  }

  function emitModelReady(
    payload: EditorModelReadyPayloadLike | null | undefined,
  ): boolean {
    if (!payload || !payload.path || !isEditorRpcConnected()) return false;
    const generation =
      typeof payload.generation === "number" &&
      Number.isFinite(payload.generation)
        ? String(payload.generation)
        : "-";
    const syncKey = String(payload.path) + "::" + generation;
    if (lastModelReadySyncKey === syncKey) return false;
    lastModelReadySyncKey = syncKey;
    try {
      editorRpcNotify(EDITOR_RPC_METHODS.modelReady, {
        path: String(payload.path),
        languageId: String(payload.languageId || ""),
        generation: payload.generation,
        request_id: payload.request_id ? String(payload.request_id) : "",
        source: payload.source ? String(payload.source) : "",
      });
      void workbenchRuntime
        .wbFlushActiveModelOpen("model_ready")
        .catch((error) => {
          console.warn("[model_ready] WBA open flush failed", error);
        })
        .then((result) => {
          const record =
            result && typeof result === "object"
              ? (result as Record<string, unknown>)
              : {};
          if (record.deferred === true) return;
          void hydrateWorkbenchProviderSnapshot("model_ready");
        });
      console.log("[model_ready] emit", {
        path: String(payload.path),
        generation,
        source: payload.source ? String(payload.source) : "",
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function requestGitBaselines(opts?: {
    immediate?: boolean;
    reason?: string;
  }): boolean {
    return prefRuntime.requestGitBaselines(opts);
  }

  var gitBaselineRuntimeDeps = buildGitBaselineRuntimeDeps({
    getMonaco: function () {
      return window.monaco || null;
    },
    getCurrentPath: function () {
      return currentPath;
    },
    getEditor: function () {
      return editor;
    },
    getDiffEditor: function () {
      return diffEditor;
    },
    getModel: function () {
      return model;
    },
    getGitHeadModel: function () {
      return gitHeadModel;
    },
    setGitHeadModel: function (value: MonacoRuntimeModelLike | null) {
      gitHeadModel = value;
    },
    getGitDiskModel: function () {
      return gitDiskModel;
    },
    setGitDiskModel: function (value: MonacoRuntimeModelLike | null) {
      gitDiskModel = value;
    },
    getLastLocalEditAt: function () {
      return lastLocalEditAt;
    },
    getBaselineApplyIdleMs: function () {
      return prefRuntime.getGitBaselineApplyIdleMs();
    },
    setPendingGitBaselinePayload: function (payload: unknown) {
      prefRuntime.setPendingGitBaselinePayload(payload);
    },
    schedulePendingGitBaselineApply: function () {
      return prefRuntime.schedulePendingGitBaselineApply();
    },
    setLastGitBaselines: function (payload: Record<string, unknown> | null) {
      lastGitBaselines = payload;
    },
    getShowInlineDiffs: getShowInlineDiffs,
    getShowDraftDiffs: getShowDraftDiffs,
    getShowDraftInsertions: function () {
      return prefRuntime.getShowDraftInsertions();
    },
    disposeGitBaselines: disposeGitBaselines,
    ensurePlainEditorWithPrefs: ensurePlainEditorWithPrefs,
    ensureDiffEditorWithPrefs: ensureDiffEditorWithPrefs,
    languageFromPath: languageFromPath,
    applyLineNumberSizing: applyLineNumberSizing,
    layoutEditors: _layoutEditors,
    installDraftZoneOrderingHook: _installDraftZoneOrderingHook,
    reapplyDraftZones: reapplyDraftZones,
    requestDraftDiff: requestDraftDiff,
    ensureTouchSelection: ensureTouchSelection,
    setDebugGit: setDebugGit,
    setDebugFlags: setDebugFlags,
  }) as Parameters<typeof applyGitBaselinesRuntime>[0];

  function applyGitBaselines(payload: unknown): void {
    applyGitBaselinesRuntime(
      gitBaselineRuntimeDeps,
      payload as Parameters<typeof applyGitBaselinesRuntime>[1],
    );
  }

  async function fetchSSOTState() {
    // Single call site so we can instrument/adjust behavior later.
    return await fetchJsonWithBase(fetch, apiBase, "/state", {
      cache: "no-store",
    });
  }

  async function ensureEditorWithPrefs() {
    return await ensureEditorWithPrefsRuntime(editorLifecycleDeps);
  }

  function ensurePlainEditorWithPrefs() {
    return ensurePlainEditorWithPrefsRuntime(editorLifecycleDeps);
  }

  function ensureDiffEditorWithPrefs() {
    return ensureDiffEditorWithPrefsRuntime(editorLifecycleDeps);
  }

  // Force-flush the mirror/didChange debounce so the ext host has the latest
  // document content before we make an RPC call (e.g., completions).
  function _flushMirrorDebounce() {
    mirrorRuntime.flushMirrorDebounce();
  }

  function installMirrorPublisher() {
    mirrorRuntime.installMirrorPublisher();
  }

  var draftDiffRuntimeDeps = buildDraftDiffRuntimeDeps({
    getCurrentPath: function () {
      return currentPath;
    },
    getEditor: function () {
      return editor;
    },
    getDiffEditor: function () {
      return diffEditor;
    },
    getModel: function () {
      return model;
    },
    getMonaco: function () {
      return monaco;
    },
    getDocument: function () {
      return document;
    },
    getShowDraftDiffs: getShowDraftDiffs,
    getShowDraftInsertions: function () {
      return prefRuntime.getShowDraftInsertions();
    },
    getShowInlineDiffs: getShowInlineDiffs,
    clearDraftDiffDecorations: clearDraftDiffDecorations,
    clearDraftDiffZones: clearDraftDiffZones,
    setDebugDraft: setDebugDraft,
    applyEditorTypography: applyEditorTypography,
    getDraftDecoCollection: function () {
      return draftDecoCollection;
    },
    setDraftDecoCollection: function (value: unknown) {
      draftDecoCollection = value;
    },
    getDraftDecoIds: function () {
      return draftDecoIds;
    },
    setDraftDecoIds: function (value: unknown[]) {
      draftDecoIds = Array.isArray(value) ? value : [];
    },
    setDraftZoneIds: function (value: unknown[]) {
      draftZoneIds = Array.isArray(value) ? value : [];
    },
    getLastDraftZones: function () {
      return lastDraftZones;
    },
    setLastDraftZones: function (
      value: Array<{ after: number; text: string; lines: number }> | null,
    ) {
      lastDraftZones = value;
    },
    getIsApplyingDraftZones: function () {
      return isApplyingDraftZones;
    },
    setIsApplyingDraftZones: function (value: boolean) {
      isApplyingDraftZones = !!value;
    },
    getIgnoreNextModifiedViewZonesEvent: function () {
      return _ignoreNextModifiedViewZonesEvent;
    },
    setIgnoreNextModifiedViewZonesEvent: function (value: boolean) {
      _ignoreNextModifiedViewZonesEvent = !!value;
    },
    getReapplyDraftZonesScheduled: function () {
      return _reapplyDraftZonesScheduled;
    },
    setReapplyDraftZonesScheduled: function (value: boolean) {
      _reapplyDraftZonesScheduled = !!value;
    },
    schedule: function (callback: () => void, delayMs: number) {
      return setTimeout(callback, delayMs);
    },
  }) as Parameters<typeof applyDraftZonesRuntime>[0];

  function clearDraftDiffDecorations(): void {
    var next = clearDraftDiffDecorationsState({
      clearZonesFn: clearDraftDiffZones,
      draftDecoCollection: draftDecoCollection as { clear?(): void } | null,
      editor: editor,
      draftDecoIds: draftDecoIds,
      setDebugDraftFn: function (value: string | null) {
        setDebugDraft(value || "");
      },
    });
    draftDecoIds = next.draftDecoIds;
    lastDraftZones = next.lastDraftZones;
  }

  function clearDraftDiffZones(): void {
    draftZoneIds = clearDraftDiffZonesState(editor, draftZoneIds);
  }

  function applyDraftZones(
    zones:
      | Array<{ after: number; text: string; lines: number }>
      | null
      | undefined,
  ): void {
    applyDraftZonesRuntime(draftDiffRuntimeDeps, zones);
  }

  function reapplyDraftZones(): void {
    reapplyDraftZonesRuntime(draftDiffRuntimeDeps);
  }

  function _installDraftZoneOrderingHook(): void {
    installDraftZoneOrderingHookRuntime(draftDiffRuntimeDeps);
  }

  function _ensureDraftDecoCollection(): unknown {
    return ensureDraftDecoCollectionRuntime(draftDiffRuntimeDeps);
  }

  function applyDraftDiffDecorations(payload: unknown): void {
    applyDraftDiffDecorationsRuntime(
      draftDiffRuntimeDeps,
      payload as Parameters<typeof applyDraftDiffDecorationsRuntime>[1],
    );
  }

  function requestDraftDiff(reason: string): boolean {
    return draftDiffRequestRuntime.requestDraftDiff(reason);
  }

  var openTransactionDeps = buildOpenTransactionDeps({
    getWindow: function () {
      return window;
    },
    getCurrentPath: function () {
      return currentPath;
    },
    setCurrentPath: function (path: string | null) {
      currentPath = path;
    },
    getBaseSha256: function () {
      return baseSha256;
    },
    setBaseSha256: function (value: string | null) {
      baseSha256 = value;
    },
    getLastContentSha256: function () {
      return lastContentSha256;
    },
    setLastContentSha256: function (value: string | null) {
      lastContentSha256 = value;
    },
    getEditor: function () {
      return editor;
    },
    getDiffEditor: function () {
      return diffEditor;
    },
    getModel: function () {
      return model;
    },
    setModel: function (nextModel: MonacoRuntimeModelLike | null) {
      model = nextModel;
    },
    ensureEditorWithPrefs: ensureEditorWithPrefs,
    languageFromPath: languageFromPath,
    monacoFileUri: function (monacoRef: unknown, path: string) {
      return monacoFileUri(
        monacoRef as MonacoRuntimeGlobal | null | undefined,
        path,
      ) as MonacoRuntimeUriLike | null;
    },
    applyLanguageToModel: applyLanguageToModel,
    createFileModel: createFileModel,
    installMirrorPublisher: installMirrorPublisher,
    installScrollPublisher: installScrollPublisher,
    applyLineNumberSizing: applyLineNumberSizing,
    ensureTouchSelection: ensureTouchSelection,
    syncDiagnosticsForCurrentModel: function (reason: string) {
      _syncDiagnosticsForCurrentModel(reason);
    },
    emitToHost: emitToHost,
    emitModelReady: emitModelReady,
    requestDraftDiff: requestDraftDiff,
    clearDraftDiffDecorations: clearDraftDiffDecorations,
    requestGitBaselines: requestGitBaselines,
    clearDiagnosticsForLeavingModel: _clearDiagnosticsForLeavingModel,
    wbCurrentGeneration: _wbCurrentGeneration,
    wbBumpGeneration: _wbBumpGeneration,
    bcUpdatePath: bcUpdatePath,
    queueDidChange: _wbQueueDidChange,
    queueSymbols: _wbQueueSymbols,
    openFileFlow: _wbOpenFileFlow,
    absPathFromVscodeUri: _absPathFromVscodeUri,
    applyJumpToLine: applyJumpToLineAt,
    coercePositiveInt: coercePositiveInt,
    shouldRecreateOpenModel: function (
      monacoRef,
      monacoFileUriFn,
      targetModel,
      absPath,
    ) {
      return shouldRecreateOpenModel(
        monacoRef,
        monacoFileUriFn as never,
        targetModel as never,
        absPath,
      );
    },
    applyOpenModelTextSafely: function (
      targetModel,
      targetEditor,
      content,
      setApplyingRemote,
    ) {
      return applyOpenModelTextSafely(
        targetModel as never,
        targetEditor as never,
        content,
        setApplyingRemote,
      );
    },
    emitOpenCacheState: emitOpenCacheState,
    queueBackendWorkbenchOpen: function (payload: Record<string, unknown>) {
      return queueBackendWorkbenchOpen(payload as never);
    },
    requestAgentEditDocumentState: function (payload: Record<string, unknown>) {
      return editorRpcCall(
        EDITOR_RPC_METHODS.agentEditsDocumentStateGet,
        payload,
        { timeoutMs: 8000 },
      );
    },
    setApplyingRemote: function (value: boolean) {
      isApplyingRemote = !!value;
    },
    openTransactionStore: openTransactionStore,
  }) as Parameters<typeof runEditorOpenTransaction>[0];

  function _runEditorOpenTransaction(payload: unknown): Promise<void> {
    return runEditorOpenTransaction(
      openTransactionDeps,
      payload as Parameters<typeof runEditorOpenTransaction>[1],
    );
  }

  function connectEditorSocket(): boolean {
    try {
      if (editorRpcSocket) {
        if (editorRpcSocket) editorRpcTransport.attachSocket(editorRpcSocket);
        if (wbaRpcSocket) editorWbaRpcTransport.attachSocket(wbaRpcSocket);
        return true;
      }
      if (!window.io) return false;
      editorRpcSocket = window.io(SOCKET_IO_NAMESPACES.editorRpc, {
        path: SOCKET_IO_PATHS.editor,
        transports: ["websocket"],
        query: fileEditorSocketQuery(),
        auth: { rpcCodec: RPC_CODEC_MSGPACK_V1 },
      }) as EditorSocketLike;
      wbaRpcSocket = window.io(SOCKET_IO_NAMESPACES.wba, {
        path: SOCKET_IO_PATHS.wba,
        transports: ["websocket"],
        query: fileEditorSocketQuery(),
        auth: { rpcCodec: RPC_CODEC_MSGPACK_V1 },
      }) as EditorSocketLike;
      editorRpcTransport.attachSocket(editorRpcSocket);
      editorWbaRpcTransport.attachSocket(wbaRpcSocket);
      registerEditorSocketConnectionHandlers(
        editorRpcSocket as Parameters<
          typeof registerEditorSocketConnectionHandlers
        >[0],
        buildSocketConnectionDeps({
          rpcNotifications: editorRpcTransport,
          setEditorSocketId: function (value: string | null) {
            editorSocketId = value;
          },
          emitToHost: emitToHost,
          getCachedPrefs: function () {
            return cachedPrefs;
          },
          setCachedPrefs: function (snapshot: Record<string, unknown> | null) {
            cachedPrefs = snapshot;
          },
          getBaseSha256: function () {
            return baseSha256;
          },
          setBaseSha256: function (value: string | null) {
            baseSha256 = value;
          },
          getCurrentPath: function () {
            return currentPath;
          },
          setCurrentPath: function (value: string | null) {
            currentPath = value;
          },
          wbBumpGeneration: _wbBumpGeneration,
          wbQueueDidChange: _wbQueueDidChange,
          wbQueueSymbols: _wbQueueSymbols,
          wbOpenFileFlow: _wbOpenFileFlow,
          bcUpdatePath: bcUpdatePath,
          ensureEditorWithPrefs: ensureEditorWithPrefs,
          getEditor: function () {
            return editor;
          },
          getDiffEditor: function () {
            return diffEditor;
          },
          getModel: function () {
            return model;
          },
          setModel: function (value: MonacoRuntimeModelLike | null) {
            model = value;
          },
          createFileModel: createFileModel,
          applyLanguageToModel: applyLanguageToModel,
          installMirrorPublisher: installMirrorPublisher,
          installScrollPublisher: installScrollPublisher,
          languageFromPath: languageFromPath,
          monacoFileUri: function (path: string) {
            return monacoFileUri(
              window.monaco,
              path,
            ) as MonacoRuntimeUriLike | null;
          },
          setApplyingRemote: function (value: boolean) {
            isApplyingRemote = !!value;
          },
          ensureTouchSelection: ensureTouchSelection,
          getLastContentSha256: function () {
            return lastContentSha256;
          },
          setLastContentSha256: function (value: string | null) {
            lastContentSha256 = value;
          },
          updateDebug: updateDebug,
          emitModelReady: emitModelReady,
          getOpenTransactionForPath: function (path: string) {
            return getOpenTransactionForPath(openTransactionStore, path);
          },
          resolveOpenJumpPayload: function (
            tx: unknown,
            scrollLine: number | null,
            preferCursor: boolean,
          ) {
            return resolveOpenJumpPayload(
              openTransactionStore,
              currentPath,
              tx as never,
              scrollLine,
              preferCursor,
              coercePositiveInt,
            );
          },
          applyResolvedOpenJump: function (
            source: string,
            payload: unknown,
            tx: unknown,
          ) {
            applyResolvedOpenJump(
              {
                getCurrentPath: function () {
                  return currentPath;
                },
                getEditor: function () {
                  return editor as never;
                },
                getModel: function () {
                  return model as never;
                },
                absPathFromVscodeUri: _absPathFromVscodeUri,
                applyJumpToLine: function (
                  targetEditor,
                  targetModel,
                  jumpPayload,
                ) {
                  applyJumpToLineAt(targetEditor, targetModel, jumpPayload);
                },
                coercePositiveInt: coercePositiveInt,
              },
              openTransactionStore,
              source,
              payload as never,
              tx as never,
            );
          },
          requestDraftDiff: requestDraftDiff,
          clearDraftDiffDecorations: clearDraftDiffDecorations,
          requestGitBaselines: requestGitBaselines,
          requestAgentEditDocumentState: function (
            payload: Record<string, unknown>,
          ) {
            return editorRpcCall(
              EDITOR_RPC_METHODS.agentEditsDocumentStateGet,
              payload,
              { timeoutMs: 8000 },
            );
          },
          shouldDropDuplicateEditorOpen: shouldDropDuplicateEditorOpen,
          queueOpenTransaction: function (task: () => Promise<void>) {
            return queueOpenTransaction(openTransactionStore, task).then(
              function () {},
            );
          },
          runEditorOpenTransaction: function (payload: unknown) {
            return _runEditorOpenTransaction(payload).then(function () {});
          },
          handleJumpToLine: function (payload: unknown) {
            handleJumpToLineEvent(editor, model, payload, applyJumpToLineAt);
          },
          buildMonacoOptionsFromPrefs: buildMonacoOptionsFromPrefs,
          applyLineNumberSizing: applyLineNumberSizing,
          applyMonacoTheme: applyMonacoTheme,
          getAutoSave: getAutoSave,
          getShowInlineDiffs: getShowInlineDiffs,
          getShowDraftDiffs: getShowDraftDiffs,
          getShowDraftInsertions: function () {
            return prefRuntime.getShowDraftInsertions();
          },
          disposeGitBaselines: disposeGitBaselines,
          ensurePlainEditorWithPrefs: ensurePlainEditorWithPrefs,
          getGitHeadModel: function () {
            return gitHeadModel;
          },
          getMonaco: function () {
            return monaco || window.monaco || {};
          },
          applyGitBaselines: applyGitBaselines,
        }) as Parameters<typeof registerEditorSocketConnectionHandlers>[1],
      );

      registerEditorSaveMirrorSocketHandlers(
        editorRpcSocket as Parameters<
          typeof registerEditorSaveMirrorSocketHandlers
        >[0],
        buildSaveMirrorSocketDeps({
          rpcNotifications: editorRpcTransport,
          getCurrentPath: function () {
            return currentPath;
          },
          getModel: function () {
            return model;
          },
          getBaseSha256: function () {
            return baseSha256;
          },
          setBaseSha256: function (value: string | null) {
            baseSha256 = value;
          },
          getLastContentSha256: function () {
            return lastContentSha256;
          },
          setLastContentSha256: function (value: string | null) {
            lastContentSha256 = value;
          },
          getLastLocalEditAt: function () {
            return lastLocalEditAt;
          },
          getMirrorHotWindowMs: function () {
            return prefRuntime.getMirrorHotWindowMs();
          },
          getEditorSocketId: function () {
            return editorSocketId;
          },
          setApplyingRemote: function (value: boolean) {
            isApplyingRemote = !!value;
          },
          applyLineNumberSizing: applyLineNumberSizing,
          emitToHost: emitToHost,
          setUnsavedTrace: _setUnsavedTrace,
          requestDraftDiff: requestDraftDiff,
          clearDraftDiffDecorations: clearDraftDiffDecorations,
          getAutoSave: getAutoSave,
          requestGitBaselines: requestGitBaselines,
          incrementMirrorState: function (metric: string) {
            debugRuntime.incrementMirrorState(metric);
          },
          syncMirrorDebug: _syncMirrorDebug,
        }) as Parameters<typeof registerEditorSaveMirrorSocketHandlers>[1],
      );

      registerEditorRuntimeSocketHandlers(
        editorRpcSocket as Parameters<
          typeof registerEditorRuntimeSocketHandlers
        >[0],
        buildRuntimeSocketDeps({
          rpcNotifications: editorRpcTransport,
          getCurrentPath: function () {
            return currentPath;
          },
          getDraftDiffRequestId: function () {
            return draftDiffRequestRuntime.getDraftDiffRequestId();
          },
          applyDraftDiffDecorations: applyDraftDiffDecorations,
          getMonaco: function () {
            return monaco;
          },
          getModel: function () {
            return model;
          },
          emitToHost: emitToHost,
          getEditor: function () {
            return editor;
          },
          getDocument: function () {
            return document;
          },
          rpcCall: editorRpcCall,
          schedule: function (callback, delayMs) {
            return window.setTimeout(callback, delayMs);
          },
          reapplyCodeInspectorHighlights: function () {
            codeInspectorRuntime?.reapplyHighlights();
          },
          clearCodeInspectorHighlights: function () {
            codeInspectorRuntime?.clearHighlights();
          },
          runIssuesCommand: runIssuesCommand,
          runFindCommand: runFindCommand,
          runEditCommand: runEditCommand,
        }) as Parameters<typeof registerEditorRuntimeSocketHandlers>[1],
      );

      registerEditorWbaRuntimeHandlers(editorWbaRpcTransport, {
        getCurrentPath: function () {
          return currentPath;
        },
        getModel: function () {
          return model;
        },
        absPathFromVscodeUri: _absPathFromVscodeUri,
        applyDiagnosticsUpdate: _applyDiagnosticsUpdate,
        languageBridge: languageBridge,
        registerSemanticTokensWithLegend: _registerSemanticTokensWithLegend,
        fireSemanticTokensChanged:
          languageBridgeProviders.fireSemanticTokensChanged,
        cacheCompletionProviderRegistration:
          languageBridgeProviders.cacheCompletionProviderRegistration,
        cacheDocumentColorProviderRegistration:
          languageBridgeProviders.cacheDocumentColorProviderRegistration,
        cacheInlayHintsProviderRegistration:
          languageBridgeProviders.cacheInlayHintsProviderRegistration,
        cacheInlineCompletionProviderRegistration:
          languageBridgeProviders.cacheInlineCompletionProviderRegistration,
        resetDynamicProviderCaches:
          languageBridgeProviders.resetDynamicProviderCaches,
        onWorkspaceSwitchedAck: function (event) {
          const win = window as Window &
            typeof globalThis & {
              __te2AdapterReady?: boolean;
              __te2AdapterProject?: string | null;
              __te2ProjectSwitchInProgress?: boolean;
            };
          const project =
            typeof event.workspaceFolder === "string"
              ? event.workspaceFolder
              : typeof event.to === "string"
                ? event.to
                : null;
          win.__te2AdapterReady = event.readyForDocumentOpen === true;
          if (project) win.__te2AdapterProject = project;
          if (event.readyForDocumentOpen === true) {
            win.__te2ProjectSwitchInProgress = false;
            try {
              workbenchRuntime.wbEndProjectSwitch(event);
            } catch (_) {}
          }
        },
      });

      if (editorRpcSocket && typeof editorRpcSocket.on === "function") {
        editorRpcSocket.on("connect", () => {
          void hydrateWorkbenchProviderSnapshot("editor_socket_connect");
        });
      }
      if (wbaRpcSocket && typeof wbaRpcSocket.on === "function") {
        wbaRpcSocket.on("connect", () => {
          console.log("[wba] socket connected");
          notifyExtensionActivityBridgeReady();
          handleWbaSocketReadyForEditor("wba_socket_connect");
        });
        wbaRpcSocket.on("disconnect", () => {
          console.warn("[wba] socket disconnected");
        });
      }

      return true;
    } catch (e) {
      console.warn("[Monaco] socket connect failed", e);
      return false;
    }
  }

  function installScrollPublisher(): void {
    breadcrumbRuntime.bindEditor();
    installScrollPublisherRuntime({
      getEditor: function () {
        return editor;
      },
      getCurrentPath: function () {
        return currentPath;
      },
      getModel: function () {
        return model;
      },
      canInstall: function () {
        return canInstallScrollPublisher(editor, scrollPublisherInstalled);
      },
      setInstalled: function (value: boolean) {
        scrollPublisherInstalled = !!value;
      },
      buildScrollStatePayload: function () {
        return buildScrollStatePayload(editor, currentPath);
      },
      updateBreadcrumbCursor: bcUpdateCursor,
      notifyEditorRpc: function (method, payload) {
        return editorRpcNotify(method, payload);
      },
      shouldSendImmediately: shouldSendScrollImmediately,
      scheduleSend: function (callback: () => void, delayMs: number) {
        return scheduleScrollSend(setTimeout, callback, delayMs);
      },
    } as Parameters<typeof installScrollPublisherRuntime>[0]);
  }

  // No host↔frame postMessage bridge: editor runtime communication uses /rpc/editor.

  function bcInit() {
    breadcrumbRuntime.init();
  }

  function bcUpdatePath(
    absPath: string | null | undefined,
    deferSymbols?: boolean,
  ): void {
    breadcrumbRuntime.updatePath(absPath, deferSymbols);
  }

  function _bcRequestSymbols(
    absPath: string,
    opts?: { generation?: number; fromQueue?: boolean },
  ): void {
    breadcrumbRuntime.requestSymbols(absPath, opts);
  }

  function bcUpdateCursor(line?: number): void {
    breadcrumbRuntime.updateCursor(line);
  }

  function connectEditorHostActions() {
    editorHostActionRuntime.connect();
  }

  /** Call after editor/diffEditor is created to bind Ctrl+S and focus relay. */
  function bindEditorHostActionHooks() {
    editorHostActionRuntime.bindEditorHooks();
  }

  async function bootMonaco() {
    await bootMonacoRuntime(
      buildBootMonacoRuntimeDeps({
        getWindow: function () {
          return window;
        },
        getApiBase: function () {
          return apiBase;
        },
        getBootSnapshot: function () {
          return initialBootSnapshot;
        },
        getCachedPrefs: function () {
          return cachedPrefs;
        },
        setCachedPrefs: function (value: CachedPrefsLike | null) {
          cachedPrefs = value;
        },
        fetchSSOTState: fetchSSOTState,
        languageWorkersEnabled: _languageWorkersEnabled,
        getWorkerLogOnce: function () {
          return _workerLogOnce;
        },
        ensureTe2DiffTheme: ensureTe2DiffTheme,
        applyMonacoTheme: applyMonacoTheme,
        ensureEditorWithPrefs: ensureEditorWithPrefs,
        applyBootSnapshot: applyBootSnapshot,
        ensureWorkbenchLanguageCatalogInstalled:
          ensureWorkbenchLanguageCatalogInstalled,
        installWorkbenchLanguageBridgeProviders:
          installWorkbenchLanguageBridgeProviders,
        applyActiveModelLanguage: function () {
          applyActiveModelLanguage(
            window,
            model,
            currentPath,
            applyLanguageToModel,
            languageFromPath,
          );
        },
        collectBootLanguageIds: function (monacoRef) {
          return collectBootLanguageIds(monacoRef);
        },
        warnIfPlaintextOnlyLanguages: warnIfPlaintextOnlyLanguages,
        connectEditorSocket: connectEditorSocket,
        connectEditorHostActions: connectEditorHostActions,
        emitToHost: emitToHost,
        updateDebug: updateDebug,
      }) as Parameters<typeof bootMonacoRuntime>[0],
    );
  }

  updateDebug("boot=init");
  bcInit();
  bootMonaco();
})();
