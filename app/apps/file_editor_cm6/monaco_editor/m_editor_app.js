import { buildUiUrl, wsUrlFromPath, fetchJsonWithBase } from './editor_common_utils.js';
import { normalizeLanguageId, languageIdFromPath, monacoFileUri } from './editor_language_utils.js';
import { parseJsonc } from './editor_parse_utils.js';
import { setUnsavedTrace, noteGitBaselineRequest } from './editor_trace_utils.js';
import { createFileModel as createMonacoFileModel } from './editor_model_utils.js';
import { setDebugPart, syncTraceDebug, syncMirrorDebug } from './editor_debug_utils.js';
import { runIssuesCommand, runFindCommand } from './editor_command_utils.js';
import { deriveApiBase } from './editor_api_base_utils.js';
import { absPathFromVscodeUri } from './editor_vscode_uri_utils.js';
import { monacoRangeFromProtoRange, toMonacoHoverContents, isLanguageContextCurrent, monacoRangeFromCompletionRange, mapCompletionItemKind } from './editor_bridge_utils.js';
import { te2DumpTextmateScopesForLine, te2GetActiveEditorAndModel, te2AdvanceRuleStackToLine } from './editor_textmate_debug_utils.js';
import { installMarkerNavBindings, jumpToMarker } from './editor_marker_nav_utils.js';
import { applyJumpToLine as applyJumpToLineAt } from './editor_jump_utils.js';
import { resolveMonacoThemeId } from './editor_theme_resolver_utils.js';
import { emitToHostSocket } from './editor_socket_emit_utils.js';
import { getShowInlineDiffsFlag, getShowDraftDiffsFlag, getUseTrueInlineViewFlag, getAutoSaveFlag } from './editor_pref_flags_utils.js';
import { localMirrorDebounceMs, mirrorHotWindowMs, gitBaselineDebounceMs, gitBaselineApplyIdleMs } from './editor_timing_policy_utils.js';
import { wbCurrentGeneration, wbSetOpenAck, wbQueueDidChange, wbQueueSymbols } from './editor_workbench_state_utils.js';
import { isAdapterReady, wbIsFrameworkReady, wbIsBarrierOpen } from './editor_workbench_barrier_utils.js';
import { wbEmitDidChange } from './editor_workbench_emit_utils.js';
import { wbBumpGeneration } from './editor_workbench_generation_utils.js';
import { wbFlushDidChangeIfReady, wbFlushSymbolsIfReady, wbFlushPendingAfterOpen, wbPublishDidChange } from './editor_workbench_flush_utils.js';
import { buildMonacoOptionsFromPrefsState } from './editor_monaco_options_utils.js';
import { ensureTe2DiffThemeApplied } from './editor_diff_theme_utils.js';
import { getVscodeThemeJsonUrl } from './editor_theme_url_utils.js';
import { vscodeThemeToMonacoTheme } from './editor_theme_convert_utils.js';
import { buildDebugMessage } from './editor_debug_message_utils.js';
import { applyLineNumberSizingForEditors } from './editor_line_number_utils.js';
import { ensureThemeRegistryState } from './editor_theme_registry_state_utils.js';
import { loadVscodeTextmateThemesRuntime } from './editor_theme_loader_runtime_utils.js';
import { applyMonacoThemeRuntime } from './editor_theme_apply_runtime_utils.js';
import { requestGitBaselinesDebounced } from './editor_git_baseline_request_utils.js';
import { syncReadOnlyInputMode } from './editor_readonly_input_mode_utils.js';
import { onEditorConfigChanged } from './editor_config_change_utils.js';
import { clearDraftDiffZonesState } from './editor_draft_zone_clear_utils.js';
import { clearDraftDiffDecorationsState } from './editor_draft_decorations_clear_utils.js';
import { startVscodeApiService } from './editor_vscode_api_start_utils.js';
import { discoverVscodeApiWsPath } from './editor_vscode_api_discover_utils.js';
import { buildVscodeApiWsUrl } from './editor_vscode_api_ws_url_utils.js';
import { handleVscodeApiMessageData } from './editor_vscode_api_message_utils.js';
import { rejectAndClearVscodeApiPending } from './editor_vscode_api_close_utils.js';
import { createVscodeApiCallPromise } from './editor_vscode_api_call_request_utils.js';
import { vscodeApiNotify } from './editor_vscode_api_notify_utils.js';
import { buildVscodeApiRequestPayload } from './editor_vscode_api_payload_utils.js';
import { getVscodeLanguagesList } from './editor_vscode_languages_source_utils.js';
import { resetVscodeLanguageMatchers } from './editor_vscode_language_matchers_reset_utils.js';
import { registerVscodeLanguageId } from './editor_vscode_language_register_utils.js';
import { mapVscodeLanguageExtensions } from './editor_vscode_language_extensions_utils.js';
import { mapVscodeLanguageFilenames } from './editor_vscode_language_filenames_utils.js';
import { applyVscodeLanguageConfiguration } from './editor_vscode_language_config_utils.js';
import { installVscodeLanguagesLoop } from './editor_vscode_languages_install_loop_utils.js';
import { finalizeVscodeLanguagesInstall } from './editor_vscode_languages_finalize_utils.js';
import { resolveAutoSaveFromPrefs } from './editor_open_autosave_pref_utils.js';
import { fetchOpenCache } from './editor_open_cache_fetch_utils.js';
import { resolveOpenContent } from './editor_open_content_resolve_utils.js';
import { resolveOpenLanguage } from './editor_open_lang_resolve_utils.js';
import { initOpenModel } from './editor_open_model_init_utils.js';
import { shouldRecreateOpenModel, applyOpenModelTextSafely } from './editor_open_model_update_utils.js';
import { emitOpenCacheState } from './editor_open_emit_cache_state_utils.js';
import { queueBackendWorkbenchOpen } from './editor_open_workbench_open_utils.js';
import { isMirrorPayloadValid } from './editor_mirror_payload_valid_utils.js';
import { shouldDropMirrorForSource } from './editor_mirror_source_drop_utils.js';
import { shouldDropMirrorForPath } from './editor_mirror_path_drop_utils.js';
import { shouldDropMirrorForNoModel } from './editor_mirror_model_drop_utils.js';
import { shouldDropMirrorForSha } from './editor_mirror_sha_drop_utils.js';
import { shouldDropMirrorForHotWindow } from './editor_mirror_hot_drop_utils.js';
import { applyMirrorContentToModel } from './editor_mirror_apply_content_utils.js';
import { emitMirrorCacheState } from './editor_mirror_emit_cache_utils.js';
// editor_socket_readiness_step_handler_utils.js removed — readiness is now push-based via UI IPC adapter_state
import { handleJumpToLineEvent } from './editor_socket_jump_handler_utils.js';
import { handleDraftDiffEvent } from './editor_socket_draft_diff_handler_utils.js';
import { handleWorkbenchResponseEvent } from './editor_socket_workbench_response_handler_utils.js';
import { handleSemanticTokensProviderRegistered } from './editor_socket_semantic_registered_handler_utils.js';
import { handleIssuesDumpRequest } from './editor_socket_issues_dump_handler_utils.js';
import { handleIssuesCommand } from './editor_socket_issues_cmd_handler_utils.js';
import { handleFindCommand } from './editor_socket_find_cmd_handler_utils.js';
import { isCacheStatePayloadForCurrentPath, isCacheStateClean, isCacheStateUnsaved } from './editor_cache_state_payload_utils.js';
import { shouldSkipAutosaveBaselineRefresh } from './editor_cache_state_autosave_skip_utils.js';
import { resnapshotDraftBaseline } from './editor_cache_state_resnapshot_utils.js';
import { handleCleanCacheState } from './editor_cache_state_clean_handler_utils.js';
import { handleUnsavedCacheState } from './editor_cache_state_unsaved_handler_utils.js';
import { logDiagnosticsEvent } from './editor_diagnostics_log_utils.js';
import { applyDiagnosticsBridgeUpdate } from './editor_diagnostics_apply_update_utils.js';
import { handleGitBaselinesSocketEvent } from './editor_git_baselines_socket_handler_utils.js';
import { initBreadcrumbElement } from './editor_breadcrumb_init_utils.js';
import { loadBreadcrumbIcons } from './editor_breadcrumb_icons_loader_utils.js';
import { shouldUpdateBreadcrumbPath } from './editor_breadcrumb_update_path_utils.js';
import { resolveBreadcrumbSymbolsLangId } from './editor_breadcrumb_symbols_lang_utils.js';
import { getBreadcrumbSymbolsTimeoutMs } from './editor_breadcrumb_symbols_timeout_utils.js';
import { unwrapBreadcrumbSymbols } from './editor_breadcrumb_symbols_unwrap_utils.js';
import { symbolRangeToLineBounds } from './editor_breadcrumb_symbol_range_utils.js';
import { breadcrumbSymbolIcon } from './editor_breadcrumb_symbol_icon_utils.js';
import { canInstallScrollPublisher } from './editor_scroll_publisher_guard_utils.js';
import { buildScrollStatePayload } from './editor_scroll_publisher_payload_utils.js';
import { shouldSendScrollImmediately } from './editor_scroll_publisher_throttle_utils.js';
import { scheduleScrollSend } from './editor_scroll_publisher_schedule_utils.js';
import { shouldApplyMirrorPath } from './editor_apply_mirror_path_utils.js';
import { applyMirrorContent } from './editor_apply_mirror_content_utils.js';
import { connectUiIpcSocket } from './editor_ui_ipc_connect_utils.js';
import { registerConsoleWorker } from './editor_ui_ipc_register_utils.js';
import { safeSerializeConsoleArg } from './editor_console_safe_serialize_utils.js';
import { serializeConsoleArg } from './editor_console_serialize_arg_utils.js';
import { emitConsoleLog } from './editor_console_emit_log_utils.js';
import { patchConsoleLevels } from './editor_console_patch_levels_utils.js';
import { installConsoleErrorHooks } from './editor_console_error_hooks_utils.js';
import { handleConsoleEval } from './editor_console_eval_handler_utils.js';
import { bindSaveKeyCommand } from './editor_ui_ipc_save_key_utils.js';
import { bindFocusRelay } from './editor_ui_ipc_focus_relay_utils.js';
import { bindVendoredCtrlHelperFocus } from './editor_mobile_ctrl_helper_utils.js';
import { findBreadcrumbSymbolChain } from './editor_breadcrumb_find_symbol_chain_utils.js';
import { splitBreadcrumbPathParts } from './editor_breadcrumb_split_parts_utils.js';
import { appendBreadcrumbSeparator } from './editor_breadcrumb_append_sep_utils.js';
import { isBreadcrumbFileSegment } from './editor_breadcrumb_is_file_segment_utils.js';
import { createBreadcrumbPathItem } from './editor_breadcrumb_create_path_item_utils.js';
import { getBreadcrumbIconTheme } from './editor_breadcrumb_icon_theme_utils.js';
import { applyBreadcrumbFileIcon } from './editor_breadcrumb_apply_icon_utils.js';
import { shouldRenderBreadcrumbSymbolChain } from './editor_breadcrumb_should_render_symbols_utils.js';
import { getBreadcrumbSymbolPosition } from './editor_breadcrumb_symbol_position_utils.js';
import { createBreadcrumbSymbolItem } from './editor_breadcrumb_create_symbol_item_utils.js';
import { finalizeBreadcrumbScroll } from './editor_breadcrumb_finalize_scroll_utils.js';
import { getBreadcrumbPathClickTarget } from './editor_breadcrumb_path_click_utils.js';
import { getBreadcrumbSymbolClickPosition } from './editor_breadcrumb_symbol_click_utils.js';
import { collectBootLanguageIds } from './editor_boot_language_ids_utils.js';
import { warnIfPlaintextOnlyLanguages } from './editor_boot_plaintext_warn_utils.js';
import { applyActiveModelLanguage } from './editor_boot_apply_active_model_language_utils.js';
import { ensureTouchSelection as _ensureTouchSelection } from './editor_touch_menu_utils.js';
/* eslint-disable no-undef */
(function() {
  // Debug (draft diff hunks): default ON for now to diagnose incorrect ranges.
  // You can disable at runtime in the iframe console with:
  //   window.__debugDraftDiffs = false
  try {
    if (typeof window.__debugDraftDiffs === 'undefined') {
      window.__debugDraftDiffs = true;
    }
  } catch (_) {}

  var editor = null;
  var diffEditor = null;
  var model = null;
  var gitHeadModel = null;
  var gitDiskModel = null;
  var lastGitBaselines = null;
  var _workerLogOnce = Object.create(null);
  var currentPath = null;
  var dbg = null;
  var cachedPrefs = null;
  var editorSocket = null;
  var editorSocketId = null;
  var baseSha256 = null;
  var lastContentSha256 = null;
  var lastLocalEditAt = 0;
  var isApplyingRemote = false;
  var mirrorPublisherDisposable = null;
  var mirrorDebounceT = null;
  var gitBaselineDebounceT = null;
  var gitBaselineApplyT = null;
  var pendingGitBaselinePayload = null;
  var draftDecoCollection = null;
  var draftDecoIds = [];
  var draftDiffDebounceT = null;
  var draftDiffRequestId = null;
  var draftZoneIds = [];
  var lastDraftZones = null;
  var isApplyingDraftZones = false;
  var _ignoreNextModifiedViewZonesEvent = false;
  var _reapplyDraftZonesScheduled = false;
  var layoutObserver = null;
  var debugParts = { git: null, draft: null, diag: null, flags: null, mirror: null, trace: null, extra: null };
  var mirrorState = {
    rx: 0,
    ap: 0,
    drop_self: 0,
    drop_path: 0,
    drop_no_model: 0,
    drop_sha: 0,
    drop_hot: 0,
  };
  var _trace = {
    mirror_bind_total: 0,
    mirror_active: 0,
    unsaved_reason: '-',
    gb_req_total: 0,
    gb_req_immediate: 0,
    gb_req_debounced: 0,
    gb_last_source: '-',
  };

  function _fetch(url, init) {
    return window.fetch(url, init);
  }

  function _setUnsavedTrace(reason, unsaved) {
    setUnsavedTrace(_trace, reason, unsaved, _syncTraceDebug);
  }

  function _noteGitBaselineRequest(source, immediate) {
    noteGitBaselineRequest(_trace, source, immediate, _syncTraceDebug);
  }
  var apiBase = deriveApiBase(window.location);

  // vscode_rpc (JSON-RPC over WS) - Phase 0 POC: semantic tokens via TypeScript LSP.
  var vscodeRpcWs = null;
  var vscodeRpcPending = Object.create(null);
  var vscodeRpcNextId = 1;
  var vscodeRpcLegend = null;
  var vscodeRpcInstalled = false;
  var vscodeRpcDocUri = null;
  var vscodeRpcDocVersion = 1;
  var vscodeRpcChangeDebounceT = null;

  // TextMate tokenization (VS Code grammars) - client-side only.
  // Uses UMD globals loaded by m_editor_app.py:
  //   - window.onig (vscode-oniguruma)
  //   - window.vscodetextmate (vscode-textmate)
  var tmRegistry = null;
  var tmGrammarIndex = null; // { scopes: { scopeName: fileName } }
  var tmInstalled = Object.create(null); // languageId -> true
  var tmGrammarByLang = Object.create(null); // languageId -> vscode-textmate grammar (debug use)
  var tmActiveThemeJson = null; // cached VS Code theme JSON for registry.setTheme()
  // TextMate grammar index from installed VSIX (via vscode_api).
  // Structure:
  // - byScope: {scopeName -> {id, scopeName, language}}
  // - byLanguage: {languageId -> {preferred: scopeName, scopes: [scopeName,...]}}
  var tmVscodeIndex = null;

  async function ensureTextmateReady() {
    if (tmRegistry) return tmRegistry;
    if (!window.vscodetextmate || !window.onig) {
      throw new Error('TextMate deps missing (vscodetextmate/onig)');
    }
    // Prefer grammars from installed VSIX via vscode_api (global pool),
    // but keep the legacy static grammar_index.json as a fallback.
    if (!tmVscodeIndex) {
      try {
        tmVscodeIndex = await _refreshVscodeGrammarIndex();
      } catch (e0) {
        tmVscodeIndex = null;
      }
    }
    if (!tmGrammarIndex) {
      try {
        tmGrammarIndex = await fetchJsonWithBase(fetch, apiBase, '/ui/monaco_editor/textmate/grammar_index.json', { cache: 'no-store' });
      } catch (_) {
        tmGrammarIndex = null;
      }
    }

    // Load Oniguruma WASM once.
    try {
      var wasmResp = await fetch(buildUiUrl(apiBase, 'monaco_editor/textmate/onig.wasm'), { cache: 'force-cache' });
      if (!wasmResp.ok) throw new Error('onig.wasm HTTP ' + wasmResp.status);
      var wasmBuf = await wasmResp.arrayBuffer();
      await window.onig.loadWASM(wasmBuf);
    } catch (e) {
      console.warn('[TextMate] loadWASM failed', e);
      throw e;
    }

    var registry = new window.vscodetextmate.Registry({
      onigLib: Promise.resolve({
        createOnigScanner: function (sources) { return new window.onig.OnigScanner(sources); },
        createOnigString: function (str) { return new window.onig.OnigString(str); },
      }),
      loadGrammar: async function (scopeName) {
        try {
          var sn = String(scopeName || '');

          // 1) Prefer extension grammar via adapter WS.
          try {
            if (!tmVscodeIndex) tmVscodeIndex = await _refreshVscodeGrammarIndex();
            var entry = tmVscodeIndex && tmVscodeIndex.byScope ? tmVscodeIndex.byScope[sn] : null;
            if (entry && entry.id) {
              var loadRes = await editorWorkbenchCall('grammars_load', { id: entry.id }, { timeoutMs: 8000 });
              var loadResult = loadRes && loadRes.result ? loadRes.result : loadRes;
              if (loadResult && loadResult.ok && loadResult.raw) {
                var url = 'adapter://textmate/' + encodeURIComponent(entry.id);
                console.log('[TextMate] loaded extension grammar', sn, '->', entry.id);
                return window.vscodetextmate.parseRawGrammar(String(loadResult.raw), url);
              }
            }
          } catch (e1) {
            // fall through to static bundle
          }

          // 2) Legacy static grammars.
          var scopes = tmGrammarIndex && tmGrammarIndex.scopes ? tmGrammarIndex.scopes : null;
          var fileName = scopes ? scopes[sn] : null;
          if (!fileName) return null;
          var url2 = buildUiUrl(apiBase, 'monaco_editor/textmate/grammars/' + fileName);
          var resp = await fetch(url2, { cache: 'force-cache' });
          if (!resp.ok) return null;
          var content = await resp.text();
          return window.vscodetextmate.parseRawGrammar(content, url2);
        } catch (e) {
          console.warn('[TextMate] loadGrammar failed', scopeName, e);
          return null;
        }
      },
    });

    tmRegistry = registry;
    // Apply the active theme immediately so the color map is correct
    // before any grammar is loaded (avoids boot race where applyMonacoTheme
    // no-ops because tmRegistry didn't exist yet).
    if (tmActiveThemeJson) {
      _applyThemeToTextmateRegistry(tmActiveThemeJson);
      // setColorMap just overrode the rendering palette — existing Monarch
      // tokens in the model have stale foreground indices.  Force retokenize.
      try {
        var models = window.monaco.editor.getModels();
        for (var mi = 0; mi < models.length; mi++) {
          if (models[mi] && typeof models[mi].resetTokenization === 'function') {
            models[mi].resetTokenization();
          }
        }
      } catch (_) {}
    }
    console.log('[TextMate] ready');
    return tmRegistry;
  }

  /**
   * Apply a VS Code theme JSON to the TextMate registry so tokenizeLine2()
   * produces correctly colored binary tokens, and sync the color map to Monaco.
   */
  function _applyThemeToTextmateRegistry(vscodeThemeJson) {
    try {
      if (!tmRegistry || !vscodeThemeJson) return;
      var settings = [];
      var colors = vscodeThemeJson.colors || {};
      var editorFg = colors['editor.foreground'] || colors['foreground'] || '#e6edf3';
      var editorBg = colors['editor.background'] || colors['editorPane.background'] || '#0d1117';
      settings.push({ settings: { foreground: editorFg, background: editorBg } });
      var tc = vscodeThemeJson.tokenColors || [];
      for (var i = 0; i < tc.length; i++) {
        settings.push(tc[i]);
      }
      tmRegistry.setTheme({ name: vscodeThemeJson.name || 'te2-theme', settings: settings });
      // Sync color map to Monaco so encoded token color indices resolve correctly.
      if (window.monaco && window.monaco.languages && window.monaco.languages.setColorMap) {
        var colorMap = tmRegistry.getColorMap();
        if (colorMap && colorMap.length > 0) {
          window.monaco.languages.setColorMap(colorMap);
          var installedLangs = Object.keys(tmInstalled).filter(function(k) { return tmInstalled[k]; });
          console.log('[TextMate:DIAG] setColorMap called, colors=' + colorMap.length + ', already installed langs: [' + installedLangs.join(', ') + ']');
        }
      }
    } catch (e) {
      console.warn('[TextMate] _applyThemeToTextmateRegistry failed', e);
    }
  }

  async function _scopeNameForLanguage(languageId, filePath) {
    var lang = normalizeLanguage(languageId);
    try {
      if (!tmVscodeIndex) {
        // Await the index on first call so ext-host grammars are available.
        try { tmVscodeIndex = await _refreshVscodeGrammarIndex(); } catch (_) {}
      }
      if (tmVscodeIndex && tmVscodeIndex.byLanguage && tmVscodeIndex.byLanguage[lang]) {
        // Prefer extension-specific scopes when present.
        var entry = tmVscodeIndex.byLanguage[lang];
        if (entry && entry.scopes && filePath) {
          var p = String(filePath || '');
          // JSX/TSX special cases under monaco's "javascript"/"typescript" language ids.
          if (lang === 'javascript' && /\\.jsx$/i.test(p)) {
            if (entry.scopes.indexOf('source.js.jsx') >= 0) return 'source.js.jsx';
            if (entry.scopes.indexOf('source.jsx') >= 0) return 'source.jsx';
          }
          if (lang === 'typescript' && /\\.tsx$/i.test(p)) {
            if (entry.scopes.indexOf('source.tsx') >= 0) return 'source.tsx';
          }
          if (lang === 'markdown') {
            if (entry.scopes.indexOf('text.html.markdown') >= 0) return 'text.html.markdown';
          }
        }
        if (entry && entry.preferred) return entry.preferred;
      }
    } catch (_) {}
    var p = String(filePath || '');
    if (lang === 'javascript') {
      if (/\\.jsx$/i.test(p)) return 'source.js.jsx';
      return 'source.js';
    }
    if (lang === 'typescript') {
      if (/\\.tsx$/i.test(p)) return 'source.tsx';
      return 'source.ts';
    }
    if (lang === 'python') return 'source.python';
    if (lang === 'json') return 'source.json';
    if (lang === 'jsonc') return 'source.json.comments';
    if (lang === 'html') return 'text.html.basic';
    if (lang === 'css') return 'source.css';
    if (lang === 'markdown') return 'text.html.markdown';
    if (lang === 'shell') return 'source.shell';
    if (lang === 'c') return 'source.c';
    if (lang === 'cpp') return 'source.cpp';
    if (lang === 'java') return 'source.java';
    if (lang === 'rust') return 'source.rust';
    // Generic fallback: most TextMate scopes follow "source.<lang>" convention.
    // If the grammar doesn't exist, registry.loadGrammar() returns null and we bail.
    return 'source.' + lang;
  }

  async function _refreshVscodeGrammarIndex() {
    // Build a tiny in-memory index so TextMate registry can resolve scope -> raw grammar.
    var idx = { byScope: Object.create(null), byLanguage: Object.create(null) };
    try {
      // Route through adapter WS (via editorWorkbenchCall → Python → adapter_rpc).
      var res = await editorWorkbenchCall('grammars_list', {}, { timeoutMs: 8000 });
      var result = res && res.result ? res.result : res;
      var arr = result && result.grammars ? result.grammars : [];
      if (!Array.isArray(arr)) arr = [];
      var byLangScopes = Object.create(null); // lang -> Set(scope)
      for (var i = 0; i < arr.length; i++) {
        var g = arr[i];
        if (!g) continue;
        var scope = String(g.scopeName || '').trim();
        var id = String(g.id || '').trim();
        if (!scope || !id) continue;
        var glang = String(g.language || '').trim();
        idx.byScope[scope] = { id: id, scopeName: scope, language: glang };
        var lang = normalizeLanguage(glang);
        if (!lang) continue;
        if (!byLangScopes[lang]) byLangScopes[lang] = new Set();
        byLangScopes[lang].add(scope);
      }

      function pickPreferred(lang, scopesArr) {
        // Prefer canonical scopes for the languageId, then "source.<lang>".
        var prefer = [];
        if (lang === 'javascript') prefer = ['source.js', 'source.jsx', 'source.js.jsx'];
        else if (lang === 'typescript') prefer = ['source.ts', 'source.tsx'];
        else if (lang === 'python') prefer = ['source.python'];
        else if (lang === 'json') prefer = ['source.json', 'source.json.comments'];
        else if (lang === 'html') prefer = ['text.html.basic'];
        else if (lang === 'css') prefer = ['source.css'];
        else if (lang === 'markdown') prefer = ['text.html.markdown'];
        else if (lang === 'shell') prefer = ['source.shell'];
        else if (lang === 'c') prefer = ['source.c'];
        else if (lang === 'cpp') prefer = ['source.cpp'];
        else if (lang === 'java') prefer = ['source.java'];
        else if (lang === 'rust') prefer = ['source.rust'];
        for (var i = 0; i < prefer.length; i++) {
          if (scopesArr.indexOf(prefer[i]) >= 0) return prefer[i];
        }
        var fallback = 'source.' + lang;
        if (scopesArr.indexOf(fallback) >= 0) return fallback;
        // Else first scope (stable sort).
        return scopesArr.length ? scopesArr[0] : null;
      }

      // Materialize byLanguage entries.
      for (var lang2 in byLangScopes) {
        if (!Object.prototype.hasOwnProperty.call(byLangScopes, lang2)) continue;
        var set = byLangScopes[lang2];
        var scopes = Array.from(set);
        scopes.sort();
        var preferred = pickPreferred(lang2, scopes);
        idx.byLanguage[lang2] = { preferred: preferred, scopes: scopes };
      }
    } catch (_) {
      // ignore
    }
    return idx;
  }

  function _makeTextmateState(ruleStack) {
    return {
      _rs: ruleStack,
      clone: function () { return _makeTextmateState(this._rs); },
      equals: function (other) { return !!other && this._rs === other._rs; },
    };
  }

  async function ensureTextmateTokenization(languageId, filePath) {
    try {
      if (!window.monaco || !window.monaco.languages || !window.monaco.languages.setTokensProvider) return false;
      var lang = normalizeLanguage(languageId);
      console.log('[TextMate:DIAG] ensureTextmateTokenization called: lang=' + lang + ' filePath=' + filePath + ' alreadyInstalled=' + !!tmInstalled[lang]);
      if (tmInstalled[lang]) return true;

      var scopeName = await _scopeNameForLanguage(lang, filePath);
      console.log('[TextMate:DIAG] scopeName for ' + lang + ' = ' + scopeName);
      if (!scopeName) return false;

      var registry = await ensureTextmateReady();
      var cmBefore = registry.getColorMap ? registry.getColorMap().length : '?';
      var grammar = await registry.loadGrammar(scopeName);
      var cmAfter = registry.getColorMap ? registry.getColorMap().length : '?';
      console.log('[TextMate:DIAG] loadGrammar(' + scopeName + ') colorMap: ' + cmBefore + ' -> ' + cmAfter);
      if (!grammar) {
        console.warn('[TextMate] missing grammar for', lang, scopeName);
        return false;
      }
      try { tmGrammarByLang[lang] = grammar; } catch (_) {}

      // Apply theme to registry if not done yet, so tokenizeLine2 resolves colors.
      if (tmActiveThemeJson) {
        _applyThemeToTextmateRegistry(tmActiveThemeJson);
      }

      // Register the language if Monaco doesn't know about it yet (e.g. JSON
      // whose registration came from the now-removed worker language contrib).
      try {
        var knownLangs = window.monaco.languages.getLanguages();
        if (!knownLangs.some(function(l) { return l.id === lang; })) {
          window.monaco.languages.register({ id: lang });
        }
      } catch (_) {}

      window.monaco.languages.setTokensProvider(lang, {
        getInitialState: function () { return _makeTextmateState(window.vscodetextmate.INITIAL); },
        // Encoded tokenization: vscode-textmate resolves full scope stack against
        // the theme and returns a Uint32Array with pre-computed color indices.
        // This matches code-server's VS Code engine behavior exactly.
        tokenizeEncoded: function (line, state) {
          var rs = state && state._rs ? state._rs : window.vscodetextmate.INITIAL;
          var res = grammar.tokenizeLine2(String(line || ''), rs);
          return { tokens: res.tokens, endState: _makeTextmateState(res.ruleStack) };
        },
        // Text-mode fallback (used by EncodedTokenizationSupportAdapter.tokenize
        // and by debug tooling).
        tokenize: function (line, state) {
          var rs = state && state._rs ? state._rs : window.vscodetextmate.INITIAL;
          var res = grammar.tokenizeLine(String(line || ''), rs);
          var tokens = [];
          for (var i = 0; i < res.tokens.length; i++) {
            var t = res.tokens[i];
            var scopes = t.scopes || [];
            var last = scopes.length ? scopes[scopes.length - 1] : '';
            try {
              if (window.__debugTextmateScopes) {
                if (!t._te2_scopeStack) t._te2_scopeStack = scopes.slice();
              }
            } catch (_) {}
            tokens.push({ startIndex: t.startIndex, scopes: last });
          }
          return { tokens: tokens, endState: _makeTextmateState(res.ruleStack) };
        },
      });

      tmInstalled[lang] = true;
      console.log('[TextMate] installed', lang, '->', scopeName);
      return true;
    } catch (e) {
      console.warn('[TextMate] install failed', languageId, e);
      return false;
    }
  }

  function _te2DumpTextmateScopesForLine(lang, text, ruleStack) {
    return te2DumpTextmateScopesForLine(tmGrammarByLang, window.vscodetextmate, lang, text, ruleStack);
  }

  // Debug helper:
  //   window.__debugTextmateScopes = true;
  //   window.__te2DumpTextmateAtCursor(); // logs scopes for cursor line (active editor/model)
  //   window.__te2DumpTextmateLine(1); // logs scopes for a specific line
  //   window.__te2DumpTextmateScopes(); // scans for import/def/class (active editor/model)
  function _te2GetActiveEditorAndModel() {
    return te2GetActiveEditorAndModel(diffEditor, editor);
  }

  function _te2AdvanceRuleStackToLine(grammar, model, targetLine) {
    return te2AdvanceRuleStackToLine(window.vscodetextmate, grammar, model, targetLine);
  }

  function _te2DumpTextmateLine(ln) {
    try {
      var ctx = _te2GetActiveEditorAndModel();
      if (!ctx.model) return;
      var activeModel = ctx.model;
      var lang = normalizeLanguage(activeModel.getLanguageId ? activeModel.getLanguageId() : languageFromPath(currentPath));
      if (!lang) return;
      var grammar = tmGrammarByLang[lang];
      if (!grammar) {
        console.warn('[TextMate][Debug] no grammar loaded for', lang, { side: ctx.side, uri: String(activeModel && activeModel.uri) });
        return;
      }

      var lineNo = Math.min(Math.max(1, ln | 0), activeModel.getLineCount());
      var ruleStack = _te2AdvanceRuleStackToLine(grammar, activeModel, lineNo);
      var line = activeModel.getLineContent(lineNo);
      var dump = _te2DumpTextmateScopesForLine(lang, line, ruleStack);
      console.log('[TextMate][Debug]', {
        side: ctx.side,
        uri: String(activeModel && activeModel.uri),
        lang: lang,
        ln: lineNo,
        line: line,
        tokens: dump ? dump.tokens : null,
      });
    } catch (e) {
      console.warn('[TextMate][Debug] failed', e);
    }
  }

  window.__te2DumpTextmateLine = _te2DumpTextmateLine;

  window.__te2DumpTextmateAtCursor = function () {
    try {
      var ctx = _te2GetActiveEditorAndModel();
      if (!ctx.editor || !ctx.model) return;
      var pos = ctx.editor.getPosition ? ctx.editor.getPosition() : null;
      var ln = (pos && pos.lineNumber) ? pos.lineNumber : 1;
      _te2DumpTextmateLine(ln);
    } catch (e) {
      console.warn('[TextMate][Debug] failed', e);
    }
  };

  window.__te2DumpTextmateScopes = function () {
    try {
      var ctx = _te2GetActiveEditorAndModel();
      if (!ctx.model) return;
      var activeModel = ctx.model;
      var lang = normalizeLanguage(activeModel.getLanguageId ? activeModel.getLanguageId() : languageFromPath(currentPath));
      if (!lang) return;
      var grammar = tmGrammarByLang[lang];
      if (!grammar) {
        console.warn('[TextMate][Debug] no grammar loaded for', lang, { side: ctx.side, uri: String(activeModel && activeModel.uri) });
        return;
      }

      var maxLines = Math.min(activeModel.getLineCount(), 200);
      var ruleStack = window.vscodetextmate.INITIAL;
      var printed = 0;
      for (var ln = 1; ln <= maxLines; ln++) {
        var line = activeModel.getLineContent(ln);
        var isImport = /^(\\s*from\\s+\\S+\\s+import\\s+|\\s*import\\s+\\S+)/.test(line);
        var isDef = /^\\s*def\\s+\\w+|^\\s*class\\s+\\w+/.test(line);
        if (!isImport && !isDef) {
          // Still advance rule stack so scopes are accurate.
          var step = grammar.tokenizeLine(String(line || ''), ruleStack);
          ruleStack = step.ruleStack;
          continue;
        }
        var dump = _te2DumpTextmateScopesForLine(lang, line, ruleStack);
        if (!dump) continue;
        ruleStack = dump.ruleStack;
        console.log('[TextMate][Debug]', {
          side: ctx.side,
          uri: String(activeModel && activeModel.uri),
          lang: lang,
          ln: ln,
          line: line,
          tokens: dump.tokens,
        });
        printed += 1;
        if (printed >= 12) break;
      }
      if (!printed) console.log('[TextMate][Debug] no import/def/class lines found in first', maxLines, 'lines');
    } catch (e) {
      console.warn('[TextMate][Debug] failed', e);
    }
  };

  function applyLanguageToModel(nextModel, languageId, filePath) {
    try {
      if (!nextModel || !window.monaco || !window.monaco.editor) return;
      var lang = normalizeLanguage(languageId);
      if ((!lang || lang === 'plaintext') && filePath) lang = languageFromPath(filePath);

      // Apply immediately so Monaco can proceed. Once VSIX languages / TextMate are
      // installed (async), re-apply the best language id to force retokenization.
      try { window.monaco.editor.setModelLanguage(nextModel, lang); } catch (_) {}

      // VSIX language contributions (registration + configuration) are best-effort.
      Promise.resolve()
        .then(function () { return ensureVscodeLanguagesInstalled(); })
        .then(function () {
          // Re-resolve after VSIX languages are installed (can introduce new ids).
          try {
            if (filePath) {
              var resolved = normalizeLanguage(languageFromPath(filePath));
              if (resolved && resolved !== lang) {
                lang = resolved;
                try { window.monaco.editor.setModelLanguage(nextModel, lang); } catch (_) {}
              }
            }
          } catch (_) {}
          return ensureTextmateTokenization(lang, filePath);
        })
        .then(function (ok) {
          if (!ok) return;
          try { window.monaco.editor.setModelLanguage(nextModel, lang); } catch (_) {}
          try { installVscodeApiLanguageBridgeProviders(); } catch (_) {}
        })
        .catch(function () { /* ignore */ });
    } catch (_) {}
  }

  function getEditorContainer() {
    try { return document.getElementById('fh-monaco'); } catch (_) { return null; }
  }

  function _layoutEditors() {
    try { if (diffEditor && diffEditor.layout) diffEditor.layout(); } catch (_) {}
    try { if (editor && editor.layout) editor.layout(); } catch (_) {}
  }

  function ensureLayoutObserver() {
    try {
      if (layoutObserver) return;
      if (!window.ResizeObserver) return;
      var el = getEditorContainer();
      if (!el) return;
      layoutObserver = new ResizeObserver(function() {
        _layoutEditors();
      });
      layoutObserver.observe(el);
      try {
        window.addEventListener('resize', _layoutEditors);
      } catch (_) {}
    } catch (_) {}
  }

  function getShowInlineDiffs() {
    return getShowInlineDiffsFlag(cachedPrefs);
  }

  function getShowDraftDiffs() {
    // Draft diffs are meaningless when autosave is ON (there are no drafts).
    return getShowDraftDiffsFlag(cachedPrefs, getAutoSave);
  }

  function getUseTrueInlineView() {
    return getUseTrueInlineViewFlag(cachedPrefs);
  }

  function getAutoSave() {
    return getAutoSaveFlag(cachedPrefs);
  }

  function _localMirrorDebounceMs() {
    return localMirrorDebounceMs(getAutoSave);
  }

  function _mirrorHotWindowMs() {
    return mirrorHotWindowMs(getAutoSave);
  }

  function _gitBaselineDebounceMs() {
    return gitBaselineDebounceMs(getAutoSave);
  }

  function _gitBaselineApplyIdleMs() {
    return gitBaselineApplyIdleMs(getAutoSave, getShowInlineDiffs);
  }

  function _schedulePendingGitBaselineApply() {
    if (!pendingGitBaselinePayload) return;
    var idleMs = _gitBaselineApplyIdleMs();
    if (idleMs <= 0) return;
    var sinceEdit = lastLocalEditAt > 0 ? (Date.now() - lastLocalEditAt) : idleMs;
    var waitMs = sinceEdit >= idleMs ? 0 : (idleMs - sinceEdit);
    if (gitBaselineApplyT) clearTimeout(gitBaselineApplyT);
    gitBaselineApplyT = setTimeout(function() {
      gitBaselineApplyT = null;
      var p = pendingGitBaselinePayload;
      pendingGitBaselinePayload = null;
      try { if (p) applyGitBaselines(p); } catch (_) {}
    }, waitMs);
  }

  function _emitGitBaselineRequestNow() {
    if (!editorSocket || !editorSocket.connected) return false;
    if (!currentPath) return false;

    if (!getShowInlineDiffs()) {
      // Drop Git UI immediately if diffs are disabled.
      disposeGitBaselines();
      if (diffEditor) ensurePlainEditorWithPrefs();
      return false;
    }

    editorSocket.emit('editor_git_baselines_request', { path: currentPath });
    return true;
  }

  function normalizeLanguage(lang) {
    return normalizeLanguageId(lang);
  }

  function languageFromPath(path) {
    return languageIdFromPath(path, vscodeLanguageByFilename, vscodeLanguageByExtension);
  }

  function createFileModel(content, lang, absPath) {
    return createMonacoFileModel(
      monaco,
      function (p) { return monacoFileUri(window.monaco, p); },
      content,
      lang,
      absPath,
      function () {
        try { setTimeout(function () { installVscodeApiLanguageBridgeProviders(); }, 0); } catch (_) {}
      }
    );
  }

  function vscodeRpcCall(method, params) {
    return new Promise(function(resolve, reject) {
      try {
        if (!vscodeRpcWs || vscodeRpcWs.readyState !== 1) {
          reject(new Error('vscode_rpc not connected'));
          return;
        }
        var id = vscodeRpcNextId++;
        vscodeRpcPending[String(id)] = { resolve: resolve, reject: reject };
        vscodeRpcWs.send(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params || {} }));
      } catch (e) {
        reject(e);
      }
    });
  }

  // vscode_rpc is a legacy/optional side-channel (stdio LSP + semantic tokens POC).
  // It is NOT required for the workbench-sidecar (code-server) language features.
  // Default it off to avoid noisy failures when local LSP binaries are not present.
  var ENABLE_VSCODE_RPC = false;

  async function ensureVscodeRpcConnected() {
    try {
      if (!ENABLE_VSCODE_RPC) return false;
      if (vscodeRpcWs && vscodeRpcWs.readyState === 1) return true;
      var disc = await fetchJsonWithBase(fetch, apiBase, '/vscode_rpc/discover', { cache: 'no-store' });
      if (!disc || !disc.ws_url) return false;
      var wsUrl = wsUrlFromPath(window.location, disc.ws_url);
      if (!wsUrl) return false;

      vscodeRpcWs = new WebSocket(wsUrl);
      vscodeRpcWs.onmessage = function(ev) {
        try {
          var msg = JSON.parse(String(ev.data || ''));
          if (msg && msg.id != null) {
            var key = String(msg.id);
            var p = vscodeRpcPending[key];
            if (p) {
              delete vscodeRpcPending[key];
              if (msg.error) p.reject(msg.error);
              else p.resolve(msg.result);
            }
          }
        } catch (_) {}
      };

      await new Promise(function(resolve, reject) {
        vscodeRpcWs.onopen = function() { resolve(); };
        vscodeRpcWs.onerror = function(e) { reject(e); };
      });

      // Initialize and capture semantic token legend.
      try {
        var init = await vscodeRpcCall('initialize', { processId: null, rootUri: null, capabilities: {} });
        var st = init && init.capabilities ? init.capabilities.semanticTokensProvider : null;
        vscodeRpcLegend = st && st.legend ? st.legend : null;
      } catch (_) {
        vscodeRpcLegend = null;
      }

      if (vscodeRpcLegend && !vscodeRpcInstalled) {
        installVscodeSemanticTokens(vscodeRpcLegend);
      }

      return true;
    } catch (e) {
      // Keep this quiet by default; users can opt-in when debugging local LSP.
      if (ENABLE_VSCODE_RPC) console.warn('[vscode_rpc] connect failed', e);
      return false;
    }
  }

  function installVscodeSemanticTokens(legend) {
    try {
      if (vscodeRpcInstalled) return;
      if (!window.monaco || !monaco.languages || !monaco.languages.registerDocumentSemanticTokensProvider) return;
      if (!legend || !legend.tokenTypes || !legend.tokenModifiers) return;

      var makeProvider = function() {
        return {
          getLegend: function() { return legend; },
          provideDocumentSemanticTokens: async function(m) {
            try {
              if (!m) return { data: new Uint32Array(0) };
              var uri = m.uri ? m.uri.toString() : '';
              var resp = await vscodeRpcCall('textDocument/semanticTokens/full', { textDocument: { uri: uri } });
              var data = resp && resp.data ? resp.data : [];
              return { data: new Uint32Array(data) };
            } catch (_) {
              return { data: new Uint32Array(0) };
            }
          },
          releaseDocumentSemanticTokens: function() {},
        };
      };

      // Register for JS/TS only (POC).
      monaco.languages.registerDocumentSemanticTokensProvider('typescript', makeProvider());
      monaco.languages.registerDocumentSemanticTokensProvider('javascript', makeProvider());
      vscodeRpcInstalled = true;
      console.log('[vscode_rpc] semantic tokens provider installed');
    } catch (e) {
      console.warn('[vscode_rpc] install semantic tokens failed', e);
    }
  }



  function _applyDiagnosticsUpdate(params) {
    try {
      if (!window.monaco || !window.monaco.editor) return;
      if (!_diagState) _diagState = { rx: 0, apply: 0, drop_no_path: 0, drop_no_model: 0, drop_mismatch: 0 };
      _diagState.rx += 1;

      var owner = (params && params.owner) ? String(params.owner) : 'workbench';
      var activeUri = (model && model.uri) ? String(model.uri.toString()) : '';
      var activePath = currentPath ? String(currentPath) : (activeUri ? _absPathFromVscodeUri(activeUri) : '');
      var items = params && Array.isArray(params.items) ? params.items : [];
      var didApply = false;

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item) continue;
        var itemPath = _absPathFromVscodeUri(item.uri || item && item.resource || '');
        if (!itemPath) {
          _diagState.drop_no_path += 1;
          try {
            if (window.__debugVscodeApiDiag) console.log('[vscode_api] diag drop_no_path item.uri=', item && item.uri);
          } catch (_) {}
          continue;
        }
        var markers = Array.isArray(item.markers) ? item.markers : [];
        var outMarkers = [];
        for (var j = 0; j < markers.length; j++) {
          var m = markers[j] || {};
          var sev = Number(m.severity || 3);
          // VS Code MarkerSeverity: 1 Hint, 2 Info, 4 Warning, 8 Error.
          var ms = monaco.MarkerSeverity.Info;
          if (sev === 8) ms = monaco.MarkerSeverity.Error;
          else if (sev === 4) ms = monaco.MarkerSeverity.Warning;
          else if (sev === 2) ms = monaco.MarkerSeverity.Info;
          else if (sev === 1 && monaco.MarkerSeverity.Hint) ms = monaco.MarkerSeverity.Hint;
          // Normalize code (VS Code may send {value,target} object).
          var code = undefined;
          try {
            if (typeof m.code === 'string' || typeof m.code === 'number') code = String(m.code);
            else if (m.code && typeof m.code === 'object' && m.code.value != null) code = String(m.code.value);
          } catch (_) {}
          outMarkers.push({
            severity: ms,
            message: (m.message != null) ? String(m.message) : '',
            startLineNumber: Math.max(1, Number(m.startLineNumber || 1)),
            startColumn: Math.max(1, Number(m.startColumn || 1)),
            endLineNumber: Math.max(1, Number(m.endLineNumber || m.startLineNumber || 1)),
            endColumn: Math.max(1, Number(m.endColumn || m.startColumn || 1)),
            source: (m.source != null) ? String(m.source) : 'vscode',
            code: code,
          });
        }

        // Apply to active model if it matches.
        if (model && model.uri && activePath && itemPath === activePath) {
          try {
            if (!_diagKnownOwners) _diagKnownOwners = new Set();
            _diagKnownOwners.add(owner);
            console.log('[vscode_api] setModelMarkers owner=' + owner + ' count=' + outMarkers.length + ' sevs=[' + outMarkers.map(function(m){ return m.severity; }).join(',') + '] lines=[' + outMarkers.map(function(m){ return m.startLineNumber; }).join(',') + ']');
            if (outMarkers.length > 0) console.log('[vscode_api] marker[0]:', JSON.stringify(outMarkers[0]));
            monaco.editor.setModelMarkers(model, owner, outMarkers);
            // Verify markers actually stuck (across all owners).
            var verify = monaco.editor.getModelMarkers({ resource: model.uri });
            console.log('[vscode_api] verify getModelMarkers count=' + (verify ? verify.length : 'null'));
            // Emit aggregated marker counts to host for toolbar badges.
            _emitAggregatedDiagCounts(itemPath);
          } catch (ex) { console.error('[vscode_api] setModelMarkers THREW:', ex); }
          didApply = true;
          _diagState.apply += 1;
        } else if (model && model.uri && activePath && itemPath !== activePath) {
          _diagState.drop_mismatch += 1;
          try {
            if (window.__debugVscodeApiDiag) console.log('[vscode_api] diag mismatch itemPath=', itemPath, 'activePath=', activePath);
          } catch (_) {}
        } else if (!model || !model.uri) {
          _diagState.drop_no_model += 1;
        }
      }

      try { setDebugDiag('diag=rx' + _diagState.rx + '/ap' + _diagState.apply + '/np' + _diagState.drop_no_path + '/nm' + _diagState.drop_no_model + '/mm' + _diagState.drop_mismatch); } catch (_) {}

      if (!didApply) {
        // Diagnostics arrived for a file/model that isn't active — dropped.
        // Fresh diagnostics will be requested via _wbQueueDidChange when the
        // file is opened or the adapter re-sends via $changeMany.
      }
    } catch (_) {}
  }

  var _diagState = null; // counters
  var _diagKnownOwners = null; // Set of owner strings seen for active path

  /** Aggregate marker counts across all owners from the model and emit to host toolbar. */
  function _emitAggregatedDiagCounts(path) {
    try {
      if (!model || !model.uri || !window.monaco || !window.monaco.editor) return;
      var all = monaco.editor.getModelMarkers({ resource: model.uri });
      var errors = 0, warnings = 0, hints = 0;
      if (all && all.length) {
        for (var k = 0; k < all.length; k++) {
          var s = all[k].severity;
          if (s === monaco.MarkerSeverity.Error) errors++;
          else if (s === monaco.MarkerSeverity.Warning) warnings++;
          else hints++;
        }
      }
      emitToHost('editor_diagnostics_counts', { errors: errors, warnings: warnings, hints: hints, total: (all ? all.length : 0), path: path || currentPath || '' });
    } catch (_) {}
  }

  /** Clear markers for all known owners and emit zero diagnostic counts (used on file switch). */
  function _clearDiagnosticsForSwitch() {
    try {
      if (model && window.monaco && window.monaco.editor) {
        if (_diagKnownOwners && _diagKnownOwners.size) {
          _diagKnownOwners.forEach(function(own) {
            try { monaco.editor.setModelMarkers(model, own, []); } catch (_) {}
          });
        }
        // Also clear the legacy owner in case older cached markers used it.
        monaco.editor.setModelMarkers(model, 'vscode_api', []);
      }
      _diagKnownOwners = new Set();
      emitToHost('editor_diagnostics_counts', { errors: 0, warnings: 0, hints: 0, total: 0, path: currentPath || '' });
    } catch (_) {}
  }

  function _absPathFromVscodeUri(raw) {
    return absPathFromVscodeUri(raw);
  }

  function _currentLanguageContext() {
    try {
      if (!model || !model.uri) return null;
      var uri = String(model.uri.toString());
      if (!uri) return null;
      var p = currentPath ? String(currentPath) : _absPathFromVscodeUri(uri);
      var lang = String(model.getLanguageId ? model.getLanguageId() : languageFromPath(p));
      var v = Number(model.getVersionId ? model.getVersionId() : 1) || 1;
      return { uri: uri, path: p, languageId: lang, version: v };
    } catch (_) {
      return null;
    }
  }

  function _monacoRangeFromProtoRange(range) {
    return monacoRangeFromProtoRange(window.monaco, range);
  }

  function _toMonacoHoverContents(raw) {
    return toMonacoHoverContents(raw);
  }

  var languageBridge = {
    hoverSeq: 0,
    symbolsSeq: 0,
    completionsSeq: 0,
    semanticTokensSeq: 0,
    registeredHover: new Set(),
    registeredSymbols: new Set(),
    registeredFolding: new Set(),
    registeredCompletions: new Set(),
    registeredSemanticTokens: new Set(),
    semanticTokensLegendCache: {}, // languageId -> legend
    semanticTokensRangeFlag: {},   // languageId -> true if range-only provider
    semanticTokensResultId: {}, // languageId -> last resultId (for delta requests)
    semanticTokensDiagGated: new Set(), // languages waiting for diagnostics before registering
  };

  // ── Workbench RPC over editor Socket.IO ──────────────────────────
  // Routes hover/symbols/openFile through editor_ws.py → adapter stdio pipe.
  // Replaces the old vscode_api_ws raw WebSocket path.
  var _wbPending = new Map(); // request_id -> {resolve, reject, timer}
  var _wbNextId = 1;
  var _wbPostReadyRefreshSeq = 0;
  var _wbFlow = {
    generation: 0,
    activePath: '',
    openAckGeneration: -1,
    openAckPath: '',
    pendingDidChange: null, // { path, text, languageId, generation }
    pendingSymbols: null, // { path, generation }
  };

  // Gate: open_file calls are deferred until the readiness baton arrives.
  // On page reload (adapter already running), the baton arrives quickly.
  // On cold start, it arrives after code-server + adapter boot.
  function _isAdapterReady() {
    return isAdapterReady(window);
  }

  function _wbCurrentGeneration() {
    return wbCurrentGeneration(_wbFlow);
  }

  function _wbBumpGeneration(path, reason) {
    return wbBumpGeneration(_wbFlow, path, reason);
  }

  function _wbIsFrameworkReady() {
    return wbIsFrameworkReady(editor, model, currentPath);
  }

  function _wbIsBarrierOpen(path, generation) {
    return wbIsBarrierOpen({
      win: window,
      editor: editor,
      model: model,
      currentPath: currentPath,
      wbFlow: _wbFlow,
      path: path,
      generation: generation,
      currentGeneration: _wbCurrentGeneration(),
    });
  }

  function _wbSetOpenAck(path, generation) {
    wbSetOpenAck(_wbFlow, path, generation, _wbCurrentGeneration);
  }

  function _wbQueueDidChange(path, text, languageId, generation) {
    wbQueueDidChange(_wbFlow, path, text, languageId, generation, _wbCurrentGeneration);
  }

  function _wbQueueSymbols(path, generation) {
    wbQueueSymbols(_wbFlow, path, generation, _wbCurrentGeneration);
  }

  function _wbEmitDidChange(payload) {
    return wbEmitDidChange(editorSocket, payload, _wbCurrentGeneration);
  }

  function _wbFlushDidChangeIfReady() {
    wbFlushDidChangeIfReady(_wbFlow, _wbIsBarrierOpen, _wbEmitDidChange);
  }

  function _wbFlushSymbolsIfReady() {
    wbFlushSymbolsIfReady(_wbFlow, _wbIsBarrierOpen, _bcRequestSymbols);
  }

  function _wbFlushPendingAfterOpen() {
    wbFlushPendingAfterOpen(_wbFlushDidChangeIfReady, _wbFlushSymbolsIfReady);
  }

  function _wbSchedulePostReadyStructureRefresh(path, generation, reason) {
    if (_languageWorkersEnabled()) return;
    var wantPath = String(path || '');
    if (!wantPath) return;
    var wantGeneration = Number.isFinite(Number(generation)) ? Number(generation) : _wbCurrentGeneration();
    var refreshSeq = ++_wbPostReadyRefreshSeq;
    setTimeout(function () {
      Promise.resolve().then(async function () {
        if (refreshSeq !== _wbPostReadyRefreshSeq) return;
        if (!_wbIsBarrierOpen(wantPath, wantGeneration)) return;
        if (String(currentPath || '') !== wantPath) return;
        if (_wbCurrentGeneration() !== wantGeneration) return;

        var activeEditor = editor;
        var activeModel = activeEditor && activeEditor.getModel ? activeEditor.getModel() : null;
        if (!activeEditor || !activeModel || !activeModel.uri) return;
        if (String(_absPathFromVscodeUri(String(activeModel.uri.toString()))) !== wantPath) return;

        var folding = null;
        try {
          folding = activeEditor.getContribution ? activeEditor.getContribution('editor.contrib.folding') : null;
          if (folding && typeof folding.triggerFoldingModelChanged === 'function') {
            folding.triggerFoldingModelChanged();
          }
        } catch (e) {
          console.warn('[readiness] post-ready folding trigger failed (' + String(reason || 'open') + ')', e);
        }

        try {
          var sticky = activeEditor.getContribution
            ? (activeEditor.getContribution('store.contrib.stickyScrollController') || activeEditor.getContribution('editor.contrib.stickyScrollController'))
            : null;
          var stickyProvider = sticky && sticky._stickyLineCandidateProvider;
          if (stickyProvider && typeof stickyProvider.update === 'function') {
            await stickyProvider.update();
          }
          if (refreshSeq !== _wbPostReadyRefreshSeq) return;
          if (!_wbIsBarrierOpen(wantPath, wantGeneration)) return;
          if (String(currentPath || '') !== wantPath) return;
          if (_wbCurrentGeneration() !== wantGeneration) return;
          if (sticky && typeof sticky._updateState === 'function') {
            await sticky._updateState();
          }
        } catch (e) {
          console.warn('[readiness] post-ready sticky refresh failed (' + String(reason || 'open') + ')', e);
        }

        try {
          var foldingModelPromise = folding && typeof folding.getFoldingModel === 'function'
            ? folding.getFoldingModel()
            : null;
          if (foldingModelPromise && typeof foldingModelPromise.then === 'function') {
            foldingModelPromise.then(function () {}, function () {});
          }
        } catch (e) {
          console.warn('[readiness] post-ready folding warmup failed (' + String(reason || 'open') + ')', e);
        }
      }).catch(function (e) {
        console.warn('[readiness] post-ready structure refresh failed (' + String(reason || 'open') + ')', e);
      });
    }, 0);
  }

  function _wbPublishDidChange(path, text, languageId, generation) {
    return wbPublishDidChange(
      _wbFlow,
      path,
      text,
      languageId,
      generation,
      _wbCurrentGeneration,
      _wbIsBarrierOpen,
      _wbEmitDidChange,
      _wbQueueDidChange
    );
  }

  function _wbOpenFileFlow(opts) {
    var o = opts || {};
    var path = String(o.path || '');
    var generation = Number.isFinite(Number(o.generation)) ? Number(o.generation) : _wbCurrentGeneration();
    var lang = String(o.languageId || '');
    var requestId = String(o.requestId || ('diag_' + Date.now() + '_open'));
    var source = String(o.source || 'open');
    if (!path || !editorSocket || !editorSocket.connected) return Promise.resolve({ ok: false, deferred: true });

    try {
      editorSocket.emit('editor_diagnostics_consumer_pending', { path: path, request_id: requestId });
    } catch (_) {}

    if (!_isAdapterReady()) {
      console.log('[readiness] open_file deferred (' + source + ') — waiting for baton');
      return Promise.resolve({ ok: false, deferred: true });
    }

    return editorWorkbenchCall(
      'open_file',
      {
        path: path,
        languageId: lang,
        uri: String(o.uri || ''),
        requestId: requestId,
        forceRefresh: !!o.forceRefresh,
        generation: generation,
      },
      { timeoutMs: Number.isFinite(Number(o.timeoutMs)) ? Number(o.timeoutMs) : 8000 }
    ).then(function (res) {
      if (generation !== _wbCurrentGeneration() || String(path) !== String(currentPath || '')) {
        return { ok: false, stale: true };
      }
      _wbSetOpenAck(path, generation);
      try {
        editorSocket.emit('editor_diagnostics_consumer_ready', { path: path, request_id: requestId });
      } catch (_) {}
      _wbFlushPendingAfterOpen();
      _wbSchedulePostReadyStructureRefresh(path, generation, source);
      return res;
    });
  }

  // Replay: called when baton arrives, triggers open_file for the currently loaded file.
  function _replayOpenFileAfterBaton() {
    if (!currentPath || !editor) return;
    var model = editor.getModel ? editor.getModel() : null;
    if (!model) return;
    var lang = (model.getLanguageId ? model.getLanguageId() : '') || '';
    var generation = _wbCurrentGeneration();
    if (!generation || String(_wbFlow.activePath || '') !== String(currentPath || '')) {
      generation = _wbBumpGeneration(currentPath, 'baton_replay');
    }
    var replayReqId = 'baton_' + Date.now();
    console.log('[readiness] baton arrived, replaying open_file for', currentPath);
    try {
      var content = model.getValue();
      _wbQueueDidChange(currentPath, content, lang, generation);
    } catch (_) {}
    _wbQueueSymbols(currentPath, generation);
    _wbOpenFileFlow({
      path: currentPath,
      languageId: lang,
      uri: (model && model.uri) ? String(model.uri.toString()) : '',
      requestId: replayReqId,
      forceRefresh: true,
      generation: generation,
      source: 'baton',
      timeoutMs: 8000,
    }).catch(function (e) {
      console.warn('[readiness] baton replay open_file failed', e);
    });
  }

  function editorWorkbenchCall(method, params, opts) {
    var timeoutMs = (opts && Number.isFinite(Number(opts.timeoutMs))) ? Number(opts.timeoutMs) : 12000;
    var requestId = 'wb_' + (_wbNextId++) + '_' + Date.now();
    var eventName = 'editor_workbench_' + method; // e.g. editor_workbench_hover
    var responseEvent = 'editor:workbench_' + method + '_response';

    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (!_wbPending.has(requestId)) return;
        _wbPending.delete(requestId);
        reject(new Error('workbench timeout: ' + method));
      }, timeoutMs);

      _wbPending.set(requestId, { resolve: resolve, reject: reject, timer: timer });

      if (!editorSocket || !editorSocket.connected) {
        clearTimeout(timer);
        _wbPending.delete(requestId);
        reject(new Error('editor socket not connected'));
        return;
      }

      var payload = Object.assign({}, params || {}, { request_id: requestId });
      console.log('[editorWorkbenchCall] EMIT ' + eventName + ' reqId=' + requestId + ' connected=' + editorSocket.connected);
      editorSocket.emit(eventName, payload);
    });
  }

  function _callVscodeApiGuarded(kind, method, params, ctx, opts) {
    var timeoutMs = (opts && Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 5000;
    var cancelToken = (opts && opts.cancelToken) ? opts.cancelToken : null;
    var seq = 0;
    if (kind === 'hover') seq = ++languageBridge.hoverSeq;
    else if (kind === 'completions') seq = ++languageBridge.completionsSeq;
    return editorWorkbenchCall(kind, params, { timeoutMs: timeoutMs }).then(function (res) {
      var nowCtx = _currentLanguageContext();
      if (kind === 'symbols' || kind === 'folding_ranges') {
        if (!ctx || !nowCtx || String(nowCtx.uri) !== String(ctx.uri)) return { ok: false, stale: true };
      } else {
        if (cancelToken && cancelToken.isCancellationRequested) return { ok: false, stale: true, canceled: true };
        if (!isLanguageContextCurrent(ctx, nowCtx)) return { ok: false, stale: true };
      }
      if (kind === 'hover' && seq !== languageBridge.hoverSeq) return { ok: false, stale: true };
      if (kind === 'completions' && seq !== languageBridge.completionsSeq) return { ok: false, stale: true };
      return { ok: true, result: res };
    }).catch(function (e) {
      return { ok: false, error: String(e && e.message ? e.message : e || 'error') };
    });
  }

  function _languageWorkersEnabled() {
    return !!(cachedPrefs && cachedPrefs.preferences && cachedPrefs.preferences.ui
      && cachedPrefs.preferences.ui.webWorkersEnabled === true);
  }

  function _documentSymbolProviderSelector(langId) {
    if (_languageWorkersEnabled()) return langId;
    // With language workers OFF, worker-backed JS/HTML symbol adapters stay
    // registered but can hang OutlineModel.create(). Use an exclusive file-only
    // selector so Monaco prefers the bridge provider for the real editor model.
    return { language: langId, scheme: 'file', exclusive: true };
  }

  function _foldingRangeProviderSelector(langId) {
    if (_languageWorkersEnabled()) return langId;
    // When workers are OFF, keep file-backed folding on the WBA bridge path so
    // Monaco doesn't sit behind a worker adapter that never resolves.
    return { language: langId, scheme: 'file', exclusive: true };
  }

  function _normalizeDocumentSymbols(raw) {
    if (!Array.isArray(raw) || !window.monaco || !monaco.languages) return [];
    var defaultKind = monaco.languages.SymbolKind ? monaco.languages.SymbolKind.Function : 11;
    function _symbolProtoRange(s) {
      return (s && s.range) ? s.range : ((s && s.location && s.location.range) ? s.location.range : null);
    }
    var mapOne = function (s) {
      // Some built-in providers still return SymbolInformation-style entries
      // with location.range/containerName instead of DocumentSymbol fields.
      var protoRange = _symbolProtoRange(s);
      var range = _monacoRangeFromProtoRange(protoRange);
      var sel = _monacoRangeFromProtoRange(s && s.selectionRange ? s.selectionRange : protoRange);
      var kids = Array.isArray(s && s.children) ? s.children.map(mapOne) : [];
      var detail = (s && s.detail != null) ? String(s.detail) : '';
      if (!detail && s && s.containerName != null) detail = String(s.containerName);
      return {
        name: String((s && s.name) || ''),
        detail: detail,
        kind: Number((s && s.kind) != null ? s.kind : defaultKind),
        tags: Array.isArray(s && s.tags) ? s.tags : [],
        range: range || new monaco.Range(1, 1, 1, 1),
        selectionRange: sel || range || new monaco.Range(1, 1, 1, 1),
        children: kids,
      };
    };
    return raw.map(mapOne);
  }

  function _monacoFoldingRangeKindFromProto(kind) {
    if (!kind || !window.monaco || !monaco.languages || !monaco.languages.FoldingRangeKind) return undefined;
    var value = '';
    if (typeof kind === 'string') value = kind;
    else if (kind && typeof kind.value === 'string') value = kind.value;
    if (!value) return undefined;
    var kinds = monaco.languages.FoldingRangeKind;
    if (typeof kinds.fromValue === 'function') return kinds.fromValue(value);
    if (value === 'comment' && kinds.Comment) return kinds.Comment;
    if (value === 'imports' && kinds.Imports) return kinds.Imports;
    if (value === 'region' && kinds.Region) return kinds.Region;
    return undefined;
  }

  function _normalizeFoldingRanges(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      var start = Number(r && r.start);
      var end = Number(r && r.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end <= start) continue;
      var item = { start: start, end: end };
      var kind = _monacoFoldingRangeKindFromProto(r && r.kind);
      if (kind) item.kind = kind;
      out.push(item);
    }
    return out;
  }

  function _monacoRangeFromCompletionRange(range, pos) {
    return monacoRangeFromCompletionRange(window.monaco, range, pos);
  }

  function _mapCompletionItemKind(kind) {
    return mapCompletionItemKind(window.monaco, kind);
  }

  // Core registration: given a legend, register the Monaco provider immediately
  function _registerSemanticTokensWithLegend(langId, legend, isRange) {
    if (languageBridge.registeredSemanticTokens.has(langId)) return;
    languageBridge.registeredSemanticTokens.add(langId);

    if (isRange && monaco.languages.registerDocumentRangeSemanticTokensProvider) {
      monaco.languages.registerDocumentRangeSemanticTokensProvider(langId, {
        getLegend: function () {
          return legend;
        },
        provideDocumentRangeSemanticTokens: function (m, range, token) {
          try {
            if (!m || !m.uri || !range) return null;
            var uri = String(m.uri.toString());
            var p = currentPath ? String(currentPath) : _absPathFromVscodeUri(uri);
            var lang = String(m.getLanguageId ? m.getLanguageId() : langId);
            return editorWorkbenchCall('semantic_tokens_range', {
              uri: uri,
              path: p,
              languageId: lang,
              range: {
                startLineNumber: range.startLineNumber,
                startColumn: range.startColumn,
                endLineNumber: range.endLineNumber,
                endColumn: range.endColumn,
              },
              timeoutMs: 10000,
            }, { timeoutMs: 12000 }).then(function (out) {
              if (!out || out.ok === false) return null;
              var payload = out.result || out;
              if (!payload) return null;
              var data = payload.data;
              if (!data || !data.length) return null;
              return {
                resultId: payload.resultId || '',
                data: new Uint32Array(data),
              };
            }).catch(function () {
              return null;
            });
          } catch (_) {
            return null;
          }
        },
      });
      return;
    }

    console.log('[semanticTokens] registering FULL provider for ' + langId + ' types=' + legend.tokenTypes.length + ' mods=' + legend.tokenModifiers.length);
    monaco.languages.registerDocumentSemanticTokensProvider(langId, {
      getLegend: function () {
        return legend;
      },
      provideDocumentSemanticTokens: function (m, lastResultId, token) {
        try {
          if (!m || !m.uri) return null;
          var uri = String(m.uri.toString());
          var p = currentPath ? String(currentPath) : _absPathFromVscodeUri(uri);
          var lang = String(m.getLanguageId ? m.getLanguageId() : langId);
          console.log('[semanticTokens] FULL REQUEST ' + lang + ' path=' + p + ' prevResultId=' + (lastResultId || '0'));
          return editorWorkbenchCall('semantic_tokens', {
            uri: uri,
            path: p,
            languageId: lang,
            previousResultId: lastResultId || '0',
            timeoutMs: 10000,
          }, { timeoutMs: 12000 }).then(function (out) {
            if (!out || out.ok === false) return null;
            var payload = out.result || out;
            if (!payload) return null;
            if (payload.type === 'delta' && payload.edits) {
              return {
                resultId: payload.resultId || '',
                edits: payload.edits.map(function (e) {
                  return {
                    start: e.start || 0,
                    deleteCount: e.deleteCount || 0,
                    data: e.data ? new Uint32Array(e.data) : undefined,
                  };
                }),
              };
            }
            var data = payload.data;
            if (!data || !data.length) return null;
            return {
              resultId: payload.resultId || '',
              data: new Uint32Array(data),
            };
          }).catch(function (e) {
            console.warn('[semanticTokens] request failed', e);
            return null;
          });
        } catch (_) {
          return null;
        }
      },
      releaseDocumentSemanticTokens: function (resultId) {},
    });
  }

  // Pull-based fallback: fetch legend then register (used from baton/doRegister)
  function _registerSemanticTokensForLanguage(langId) {
    if (languageBridge.registeredSemanticTokens.has(langId)) return;

    editorWorkbenchCall('semantic_tokens_legend', { languageId: langId }, { timeoutMs: 8000 })
      .then(function (res) {
        var legend = res && res.legend;
        if (!legend || !legend.tokenTypes || !legend.tokenModifiers) {
          console.warn('[semanticTokens] no legend for ' + langId, res);
          return;
        }
        languageBridge.semanticTokensLegendCache[langId] = legend;
        _registerSemanticTokensWithLegend(langId, legend);
      })
      .catch(function (e) {
        console.warn('[semanticTokens] legend fetch failed for ' + langId, e);
      });
  }

  function installVscodeApiLanguageBridgeProviders() {
    try {
      if (!window.monaco || !window.monaco.languages) return;

      // Register for the current language context immediately (no async dependency).
      var _doRegister = function (targets) {
        try {
          targets.forEach(function (langId) {
            if (!langId) return;
            if (!languageBridge.registeredHover.has(langId) && monaco.languages.registerHoverProvider) {
              console.log('[hover:bridge] registering hover provider for lang=' + langId);
              monaco.languages.registerHoverProvider(langId, {
                provideHover: function (m, pos, token) {
                  try {
                    var ctx = _currentLanguageContext();
                    if (!ctx || !m || !m.uri || String(m.uri.toString()) !== String(ctx.uri)) {
                      console.warn('[hover:bridge] BAIL provideHover: ctx=' + (ctx ? 'ok' : 'NULL') + ' m.uri=' + (m && m.uri ? String(m.uri.toString()).slice(-60) : 'NULL') + ' ctx.uri=' + (ctx ? String(ctx.uri).slice(-60) : 'N/A'));
                      return null;
                    }
                    return _callVscodeApiGuarded(
                      'hover',
                      'vscode.hover',
                      {
                        uri: ctx.uri,
                        path: ctx.path,
                        languageId: ctx.languageId,
                        lineNumber: Number(pos && pos.lineNumber ? pos.lineNumber : 1),
                        column: Number(pos && pos.column ? pos.column : 1),
                        timeoutMs: 4500,
                      },
                      ctx,
                      { timeoutMs: 5000, cancelToken: token },
                    ).then(function (out) {
                      if (!out || !out.ok || !out.result || out.result.ok === false) return null;
                      var payload = out.result.result || out.result.hover || null;
                      if (!payload) return null;
                      var range = _monacoRangeFromProtoRange(payload.range);
                      var contents = _toMonacoHoverContents(payload.contents);
                      if (!contents.length) return null;
                      return { range: range || undefined, contents: contents };
                    });
                  } catch (_) {
                    return null;
                  }
                },
              });
              languageBridge.registeredHover.add(langId);
            }

            if (!languageBridge.registeredSymbols.has(langId) && monaco.languages.registerDocumentSymbolProvider) {
              monaco.languages.registerDocumentSymbolProvider(_documentSymbolProviderSelector(langId), {
                provideDocumentSymbols: function (m, token) {
                  try {
                    var ctx = _currentLanguageContext();
                    if (!ctx || !m || !m.uri || String(m.uri.toString()) !== String(ctx.uri)) return [];
                    return _callVscodeApiGuarded(
                      'symbols',
                      'vscode.documentSymbols',
                      {
                        uri: ctx.uri,
                        path: ctx.path,
                        languageId: ctx.languageId,
                        timeoutMs: 6000,
                      },
                      ctx,
                      { timeoutMs: 6500, cancelToken: token },
                    ).then(function (out) {
                      if (!out || !out.ok || !out.result || out.result.ok === false) return [];
                      var payload = Array.isArray(out.result)
                        ? out.result
                        : (Array.isArray(out.result.result) ? out.result.result : []);
                      return _normalizeDocumentSymbols(payload);
                    });
                  } catch (_) {
                    return [];
                  }
                },
              });
              languageBridge.registeredSymbols.add(langId);
            }

            if (!languageBridge.registeredFolding.has(langId) && monaco.languages.registerFoldingRangeProvider) {
              monaco.languages.registerFoldingRangeProvider(_foldingRangeProviderSelector(langId), {
                provideFoldingRanges: function (m, context, token) {
                  try {
                    var ctx = _currentLanguageContext();
                    if (!ctx || !m || !m.uri || String(m.uri.toString()) !== String(ctx.uri)) return null;
                    return _callVscodeApiGuarded(
                      'folding_ranges',
                      'vscode.foldingRanges',
                      {
                        uri: ctx.uri,
                        path: ctx.path,
                        languageId: ctx.languageId,
                        context: (context && typeof context === 'object') ? context : {},
                        timeoutMs: 6000,
                      },
                      ctx,
                      { timeoutMs: 6500, cancelToken: token },
                    ).then(function (out) {
                      if (!out || !out.ok || !out.result || out.result.ok === false) return null;
                      var payload = Array.isArray(out.result) ? out.result : out.result.result;
                      var normalized = _normalizeFoldingRanges(payload);
                      return normalized == null ? null : normalized;
                    });
                  } catch (_) {
                    return null;
                  }
                },
              });
              languageBridge.registeredFolding.add(langId);
            }

            if (!languageBridge.registeredCompletions.has(langId) && monaco.languages.registerCompletionItemProvider) {
              monaco.languages.registerCompletionItemProvider(langId, {
                triggerCharacters: ['.', ':', '<', '"', "'", '/', '@', '#'],
                provideCompletionItems: function (m, pos, token, context) {
                  try {
                    // Flush pending didChange so the ext host has the latest text
                    // before we ask for completions (debounce can lag behind typing).
                    _flushMirrorDebounce();
                    var ctx = _currentLanguageContext();
                    if (!ctx || !m || !m.uri || String(m.uri.toString()) !== String(ctx.uri)) return { suggestions: [] };
                    var triggerKind = 0;
                    var triggerCharacter = undefined;
                    if (context && context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter) {
                      triggerKind = 1;
                      triggerCharacter = context.triggerCharacter || undefined;
                    } else if (context && context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerForIncompleteCompletions) {
                      triggerKind = 2;
                    }
                    return _callVscodeApiGuarded(
                      'completions',
                      'vscode.completions',
                      {
                        uri: ctx.uri,
                        path: ctx.path,
                        languageId: ctx.languageId,
                        lineNumber: Number(pos && pos.lineNumber ? pos.lineNumber : 1),
                        column: Number(pos && pos.column ? pos.column : 1),
                        triggerKind: triggerKind,
                        triggerCharacter: triggerCharacter,
                        text: m && m.getValue ? m.getValue() : undefined,
                        timeoutMs: 8000,
                      },
                      ctx,
                      { timeoutMs: 10000, cancelToken: token },
                    ).then(function (out) {
                      if (!out || !out.ok || !out.result || out.result.ok === false) return { suggestions: [] };
                      var payload = out.result.result || out.result;
                      var rawItems = payload.items || payload.suggestions || [];
                      if (!Array.isArray(rawItems)) return { suggestions: [] };
                      // Debug: log first 3 items' range and filterText
                      try {
                        for (var di = 0; di < Math.min(3, rawItems.length); di++) {
                          var dbg = rawItems[di];
                          if (dbg) console.log('[completions] item[' + di + '] label=' + JSON.stringify(dbg.label) + ' filterText=' + JSON.stringify(dbg.filterText) + ' range=' + JSON.stringify(dbg.range) + ' insertText=' + JSON.stringify(dbg.insertText ? dbg.insertText.substring(0, 40) : ''));
                        }
                      } catch (_) {}
                      var suggestions = rawItems.map(function (item) {
                        if (!item) return null;
                        var range = _monacoRangeFromCompletionRange(item.range, pos);
                        var suggestion = {
                          label: item.label || '',
                          kind: _mapCompletionItemKind(item.kind),
                          detail: item.detail || undefined,
                          documentation: item.documentation || undefined,
                          sortText: item.sortText || undefined,
                          filterText: item.filterText || undefined,
                          preselect: item.preselect || undefined,
                          insertText: item.insertText || (typeof item.label === 'string' ? item.label : ''),
                          insertTextRules: item.insertTextRules || undefined,
                          range: range,
                          commitCharacters: item.commitCharacters || undefined,
                          additionalTextEdits: item.additionalTextEdits || undefined,
                          tags: item.tags || undefined,
                        };
                        if (item.command) {
                          suggestion.command = {
                            id: item.command.id || '',
                            title: item.command.title || item.command.id || '',
                            arguments: item.command.arguments || undefined,
                          };
                        }
                        return suggestion;
                      }).filter(Boolean);
                      return {
                        suggestions: suggestions,
                        incomplete: !!payload.isIncomplete,
                      };
                    });
                  } catch (_) {
                    return { suggestions: [] };
                  }
                },
              });
              languageBridge.registeredCompletions.add(langId);
            }

            // Semantic tokens: NOT registered eagerly — gated by diagnostics arrival.
            // Legend is cached by the push handler; registration happens in
            // _applyDiagnosticsUpdate when diagnostics first land for this language.
          });
        } catch (_) {}
      };

      // Immediate: register for current language context right now
      var immediate = new Set();
      try {
        var ctx = _currentLanguageContext();
        if (ctx && ctx.languageId) immediate.add(String(ctx.languageId));
      } catch (_) {}
      console.log('[hover:bridge] installVscodeApiLanguageBridgeProviders immediate=' + Array.from(immediate).join(',') + ' model=' + (model ? 'yes' : 'no') + ' registeredHover=' + Array.from(languageBridge.registeredHover).join(','));
      if (immediate.size) _doRegister(immediate);

      // Deferred: also register for all known VSIX languages once loaded
      ensureVscodeLanguagesInstalled().then(function () {
        try {
          var all = new Set();
          try { vscodeLanguageIds.forEach(function (id) { if (id) all.add(id); }); } catch (_) {}
          try {
            var ctx2 = _currentLanguageContext();
            if (ctx2 && ctx2.languageId) all.add(String(ctx2.languageId));
          } catch (_) {}
          _doRegister(all);
        } catch (_) {}
      }).catch(function () {});
    } catch (_) {}
  }

  function vscodeRpcDidOpenIfReady() {
    try {
      if (!model || !currentPath) return;
      var lang = String(model.getLanguageId ? model.getLanguageId() : languageFromPath(currentPath));
      if (lang !== 'typescript' && lang !== 'javascript') return;

      ensureVscodeRpcConnected().then(function(ok) {
        if (!ok || !vscodeRpcLegend) return;

        var uri = model.uri ? model.uri.toString() : '';
        if (!uri || !uri.startsWith('file://')) return;

        // If switching docs, close old.
        if (vscodeRpcDocUri && vscodeRpcDocUri !== uri) {
          try { vscodeRpcWs.send(JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri: vscodeRpcDocUri } } })); } catch (_) {}
        }

        vscodeRpcDocUri = uri;
        vscodeRpcDocVersion = 1;

        try {
          vscodeRpcWs.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
              textDocument: {
                uri: uri,
                languageId: lang,
                version: vscodeRpcDocVersion,
                text: model.getValue(),
              },
            },
          }));
        } catch (_) {}
      });
    } catch (_) {}
  }



  function installVscodeRpcChangePublisher() {
    try {
      if (!model || model.__te2VscodeRpcInstalled) return;
      model.__te2VscodeRpcInstalled = true;

      model.onDidChangeContent(function(e) {
        try {
          if (!vscodeRpcWs || vscodeRpcWs.readyState !== 1) return;
          if (!vscodeRpcDocUri) return;
          if (!e || !e.changes || !e.changes.length) return;

          vscodeRpcDocVersion += 1;
          var changes = e.changes.map(function(ch) {
            var r = ch.range;
            return { range: { start: { line: (r.startLineNumber || 1) - 1, character: (r.startColumn || 1) - 1 }, end: { line: (r.endLineNumber || 1) - 1, character: (r.endColumn || 1) - 1 } }, text: ch.text };
          });

          var payload = {
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
              textDocument: { uri: vscodeRpcDocUri, version: vscodeRpcDocVersion },
              contentChanges: changes,
            },
          };

          if (vscodeRpcChangeDebounceT) clearTimeout(vscodeRpcChangeDebounceT);
          vscodeRpcChangeDebounceT = setTimeout(function() {
            try { if (vscodeRpcWs && vscodeRpcWs.readyState === 1) vscodeRpcWs.send(JSON.stringify(payload)); } catch (_) {}
          }, 120);
        } catch (_) {}
      });
    } catch (_) {}
  }

  // Force-enable semantic highlighting on the standalone theme object.
  // Monaco standalone hardcodes semanticHighlighting=false on the theme class;
  // this patches it at runtime so isSemanticColoringEnabled() returns true.
  function _forceSemanticHighlighting() {
    try {
      if (!editor) return;
      var svc = _getThemeService();
      if (!svc || typeof svc.getColorTheme !== 'function') {
        console.log('[semanticTokens] could not find themeService on editor');
        return;
      }
      var theme = svc.getColorTheme();
      if (theme && !theme.semanticHighlighting) {
        Object.defineProperty(theme, 'semanticHighlighting', { value: true, writable: true, configurable: true });
        console.log('[semanticTokens] forced semanticHighlighting=true on theme');
      }
    } catch (e) { console.warn('[semanticTokens] _forceSemanticHighlighting error', e); }
  }

  // Get the Monaco standalone theme service from the editor instance.
  function _getThemeService() {
    try {
      if (!editor) return null;
      var svc = editor._themeService;
      if (!svc && editor._instantiationService) {
        try { svc = editor._instantiationService.invokeFunction(function(a) { return a.get && a.get({ toString: function() { return 'standaloneThemeService'; }}); }); } catch (_) {}
      }
      if (!svc) {
        var keys = Object.keys(editor);
        for (var ki = 0; ki < keys.length; ki++) {
          try {
            var v = editor[keys[ki]];
            if (v && typeof v === 'object' && typeof v.getColorTheme === 'function') {
              svc = v;
              break;
            }
          } catch (_) {}
        }
      }
      return svc || null;
    } catch (_) { return null; }
  }

  function ensureEditor() {
    if (editor) return;
    var el = getEditorContainer();
    if (!el || !window.monaco) return;
    // Editor creation MUST be driven by SSOT (HistoryStore/PreferencesStore).
    // This function is only used as a last-resort guard; prefer ensureEditorWithPrefs().
    editor = monaco.editor.create(el, buildMonacoOptionsFromPrefs(cachedPrefs));
    try { _forceSemanticHighlighting(); } catch (_) {}
    try { installMarkerNavBindings(window.monaco, editor, function (dir) { jumpToMarker(window.monaco, editor, model, dir); }); } catch (_) {}
    _syncReadOnlyInputMode(editor);
    editor.onDidChangeConfiguration(function() { _onEditorConfigChanged(editor); });
    updateDebug();
  }

  function disposeDiffEditorOnly() {
    try {
      if (mirrorPublisherDisposable && mirrorPublisherDisposable.dispose) {
        mirrorPublisherDisposable.dispose();
      }
    } catch (_) {}
    mirrorPublisherDisposable = null;
    installMirrorPublisher._done = false;
    _trace.mirror_active = 0;
    _syncTraceDebug();
    try {
      if (diffEditor && diffEditor.setModel) {
        diffEditor.setModel(null);
      }
    } catch (_) {}
    try { if (diffEditor && diffEditor.dispose) diffEditor.dispose(); } catch (_) {}
    diffEditor = null;
    // Drop any cached decoration collection tied to the disposed editor.
    draftDecoCollection = null;
    draftDecoIds = [];
    draftZoneIds = [];
    // Allow scroll/cursor publisher to re-install on the next editor instance.
    installScrollPublisher._done = false;
  }

  function disposePlainEditorOnly() {
    try {
      if (mirrorPublisherDisposable && mirrorPublisherDisposable.dispose) {
        mirrorPublisherDisposable.dispose();
      }
    } catch (_) {}
    mirrorPublisherDisposable = null;
    installMirrorPublisher._done = false;
    _trace.mirror_active = 0;
    _syncTraceDebug();
    try { if (editor && editor.dispose) editor.dispose(); } catch (_) {}
    editor = null;
    // Drop any cached decoration collection tied to the disposed editor.
    draftDecoCollection = null;
    draftDecoIds = [];
    draftZoneIds = [];
    // Allow scroll/cursor publisher to re-install on the next editor instance.
    installScrollPublisher._done = false;
  }

  function disposeGitBaselines() {
    // Ensure diff editor is not still referencing these models.
    try {
      if (diffEditor && diffEditor.setModel) {
        diffEditor.setModel(null);
      }
    } catch (_) {}
    try { if (gitHeadModel && gitHeadModel.dispose) gitHeadModel.dispose(); } catch (_) {}
    try { if (gitDiskModel && gitDiskModel.dispose) gitDiskModel.dispose(); } catch (_) {}
    gitHeadModel = null;
    gitDiskModel = null;
    lastGitBaselines = null;
  }

  function buildMonacoOptionsFromPrefs(state) {
    return buildMonacoOptionsFromPrefsState(state, loadVscodeTextmateThemes._jsonCache || {});
  }

  function ensureTe2DiffTheme() {
    ensureTe2DiffTheme._done = ensureTe2DiffThemeApplied(window, !!ensureTe2DiffTheme._done);
  }

  // ensureTe2Themes / loadOfficialThemes — replaced by loadVscodeTextmateThemes() with dynamic registry.

  // Theme registry: fetched once from the available_themes endpoint.
  // Maps theme ID → { serveUrl, label, uiTheme, source }.
  var _themeRegistry = null;
  var _themeRegistryPromise = null;
  var _themeRegistryState = { registry: null, promise: null };

  async function _ensureThemeRegistry() {
    _themeRegistryState.registry = _themeRegistry;
    _themeRegistryState.promise = _themeRegistryPromise;
    var reg = await ensureThemeRegistryState(_themeRegistryState, _fetch, buildUiUrl, apiBase);
    _themeRegistry = reg;
    _themeRegistryPromise = _themeRegistryState.promise;
    return reg;
  }

  function _getVscodeThemeJsonUrl(themeId) {
    return getVscodeThemeJsonUrl(themeId, _themeRegistryState.registry || _themeRegistry, apiBase);
  }

  // ---------------------------------------------------------------------------
  // Semantic-token-type → TextMate-scope mapping (mirrors VS Code's
  // tokenClassificationRegistry in tokenClassificationRegistry.ts).
  // Monaco standalone's getTokenStyleMetadata() matches semantic token types
  // directly against theme rules, but themes only define TextMate scopes.
  // This bridge resolves each semantic type to the correct TextMate colour.
  // ---------------------------------------------------------------------------
  function _vscodeThemeToMonacoTheme(themeId, vscodeJson) {
    return vscodeThemeToMonacoTheme(themeId, vscodeJson);
  }

  // ------------------------------------------------------------------
  // VS Code API (vscode_api) theme loading for installed VSIX themes.
  // Theme preference key uses SSOT string: "vscode:<extensionId>:<relPath>".
  // ------------------------------------------------------------------

  var vscodeApiWs = null;
  var vscodeApiConnecting = null;
  var vscodeApiNextId = 1;
  var vscodeApiPending = new Map();
  var vscodeApiHandlers = new Map(); // method -> (params)=>void
  // vscodeThemeIdMap, vscodeThemeLoaded, _vscodeThemeKeyToMonacoId removed — no vscode: theme loading
  // VSIX language contributions (per-project enablement).
  var vscodeLanguagesInstalled = false;
  var vscodeLanguageIds = new Set();
  var vscodeLanguageByExtension = new Map(); // ".py" -> "python"
  var vscodeLanguageByFilename = new Map(); // "Dockerfile" -> "dockerfile"


  async function ensureVscodeApiWs() {
    if (vscodeApiWs && vscodeApiWs.readyState === WebSocket.OPEN) return vscodeApiWs;
    if (vscodeApiConnecting) return vscodeApiConnecting;

    vscodeApiConnecting = (async function () {
      await startVscodeApiService(_fetch);
      var wsPath = await discoverVscodeApiWsPath(_fetch, setTimeout);
      var wsUrl = buildVscodeApiWsUrl(location, wsPath);

      var ws = new WebSocket(wsUrl);
      vscodeApiWs = ws;

      // Register notification handlers.
      // Diagnostics are now routed through editor Socket.IO (diagnostics_bridge),
      // so we no longer handle them here. Other te2.event types can be added if needed.
      try {} catch (_) {}

      ws.onmessage = function (ev) {
        handleVscodeApiMessageData(ev.data, vscodeApiPending, vscodeApiHandlers);
      };

      ws.onclose = function () {
        vscodeApiWs = null;
        vscodeApiConnecting = null;
        rejectAndClearVscodeApiPending(vscodeApiPending, 'vscode_api ws closed');
      };

      await new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error('vscode_api ws connect timeout')); }, 8000);
        ws.onopen = function () { clearTimeout(t); resolve(); };
        ws.onerror = function () { clearTimeout(t); reject(new Error('vscode_api ws error')); };
      });

      vscodeApiConnecting = null;
      return ws;
    })();

    return vscodeApiConnecting;
  }

  async function vscodeApiCall(method, params, opts) {
    var ws = await ensureVscodeApiWs();
    var id = vscodeApiNextId++;
    var payload = buildVscodeApiRequestPayload(id, method, params);
    var timeoutMs = 12000;
    try {
      if (opts && Number.isFinite(Number(opts.timeoutMs))) timeoutMs = Math.max(250, Number(opts.timeoutMs));
    } catch (_) {}
    var p = createVscodeApiCallPromise(vscodeApiPending, id, method, timeoutMs, setTimeout);
    ws.send(JSON.stringify(payload));
    return p;
  }

  function _vscodeApiNotify(method, params) {
    return vscodeApiNotify(vscodeApiWs, method, params);
  }


  async function ensureVscodeLanguagesInstalled() {
    if (vscodeLanguagesInstalled) return true;
    if (!window.monaco || !window.monaco.languages) return false;

    try {
      var langs = await getVscodeLanguagesList(window, vscodeApiCall);
      resetVscodeLanguageMatchers(vscodeLanguageByExtension, vscodeLanguageByFilename);
      installVscodeLanguagesLoop(langs, normalizeLanguage, function (l, langId) {
        registerVscodeLanguageId(window.monaco, vscodeLanguageIds, langId, l);
        mapVscodeLanguageExtensions(vscodeLanguageByExtension, l.extensions, langId);
        mapVscodeLanguageFilenames(vscodeLanguageByFilename, l.filenames, langId);
        applyVscodeLanguageConfiguration(window.monaco, langId, l.configuration_raw, parseJsonc);
      });

      vscodeLanguagesInstalled = true;
      finalizeVscodeLanguagesInstall(langs, vscodeLanguageByExtension, vscodeLanguageByFilename, installVscodeApiLanguageBridgeProviders);
      return true;
    } catch (e) {
      console.warn('[VSIX][Languages] list failed', e);
      return false;
    }
  }

  async function loadVscodeTextmateThemes() {
    return loadVscodeTextmateThemesRuntime({
      win: window,
      state: loadVscodeTextmateThemes,
      ensureThemeRegistryFn: _ensureThemeRegistry,
      getThemeJsonUrlFn: _getVscodeThemeJsonUrl,
      fetchFn: _fetch,
      toMonacoThemeFn: _vscodeThemeToMonacoTheme,
    });
  }

  async function applyMonacoTheme(themeKey) {
    var activeTheme = await applyMonacoThemeRuntime({
      win: window,
      doc: document,
      themeKey: themeKey,
      ensureTe2DiffThemeFn: ensureTe2DiffTheme,
      loadThemesFn: loadVscodeTextmateThemes,
      resolveThemeIdFn: function (k, c) { return resolveMonacoThemeId(k, c || {}); },
      getThemeJsonUrlFn: _getVscodeThemeJsonUrl,
      fetchFn: _fetch,
      toMonacoThemeFn: _vscodeThemeToMonacoTheme,
      getJsonCacheFn: function () { return loadVscodeTextmateThemes._jsonCache || {}; },
      setJsonCacheFn: function (cache) { loadVscodeTextmateThemes._jsonCache = cache || {}; },
      applyThemeToTextmateRegistryFn: _applyThemeToTextmateRegistry,
    });
    if (activeTheme) tmActiveThemeJson = activeTheme;
    _forceSemanticHighlighting();
    try {
      var models = window.monaco.editor.getModels();
      for (var mi = 0; mi < models.length; mi++) {
        if (models[mi] && typeof models[mi].resetTokenization === 'function') {
          models[mi].resetTokenization();
        }
      }
    } catch (_) {}
  }

  function emitToHost(eventName, payload) {
    return emitToHostSocket(editorSocket, eventName, payload);
  }


  function requestGitBaselines(opts) {
    return requestGitBaselinesDebounced({
      immediate: !!(opts && opts.immediate),
      reason: (opts && opts.reason) ? String(opts.reason) : 'unknown',
      timer: gitBaselineDebounceT,
      setTimerFn: function (t) { gitBaselineDebounceT = t; },
      noteRequestFn: _noteGitBaselineRequest,
      emitNowFn: _emitGitBaselineRequestNow,
      debounceMs: _gitBaselineDebounceMs(),
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });
  }

  function applyGitBaselines(payload) {
    try {
      if (!payload || !payload.path || !currentPath) { console.log('[GitBaselines] skip: no path/currentPath'); return; }
      if (String(payload.path) !== String(currentPath)) { console.log('[GitBaselines] skip: path mismatch', payload.path, currentPath); return; }
      if (!window.monaco) { console.log('[GitBaselines] skip: no monaco'); return; }

      var baselineIdleMs = _gitBaselineApplyIdleMs();
      if (baselineIdleMs > 0 && diffEditor && lastLocalEditAt > 0) {
        var ageMs = Date.now() - lastLocalEditAt;
        if (ageMs < baselineIdleMs) {
          console.log('[GitBaselines] deferred by idle guard, ageMs=' + ageMs + ' threshold=' + baselineIdleMs);
          pendingGitBaselinePayload = payload;
          _schedulePendingGitBaselineApply();
          setDebugGit('git=defer ' + String(baselineIdleMs - ageMs) + 'ms');
          return;
        }
      }

      lastGitBaselines = payload;

      // Capture scroll/cursor from whichever editor is active before any transitions.
      var savedScrollTop = null;
      var savedPosition = null;
      try {
        var activeEd = (diffEditor && diffEditor.getModifiedEditor)
          ? diffEditor.getModifiedEditor()
          : editor;
        if (activeEd) {
          savedScrollTop = activeEd.getScrollTop();
          savedPosition = activeEd.getPosition();
        }
      } catch (_) {}

      if (!getShowInlineDiffs()) {
        disposeGitBaselines();
        if (diffEditor) ensurePlainEditorWithPrefs();
        return;
      }

      var tracked = !!payload.tracked;
      var head = (typeof payload.head_content === 'string') ? payload.head_content : null;
      var disk = (typeof payload.disk_content === 'string') ? payload.disk_content : '';
      var headSha = (typeof payload.head_sha256 === 'string') ? payload.head_sha256 : null;
      var diskSha = (typeof payload.disk_sha256 === 'string') ? payload.disk_sha256 : null;

      var hasGitDiff = !!(tracked && head != null && headSha && diskSha && headSha !== diskSha);
      if (!hasGitDiff) {
        // No diff — use current editor content as both original and modified
        // so the diff editor stays active with an empty diff (no editor swap).
        head = model && model.getValue ? model.getValue() : '';
      }

      var lang = languageFromPath(currentPath);

      if (!gitHeadModel) {
        console.log('[GitBaselines] creating new gitHeadModel');
        gitHeadModel = monaco.editor.createModel(head || '', lang);
      } else {
        var nextHead = head || '';
        try {
          var curHead = gitHeadModel.getValue ? String(gitHeadModel.getValue()) : '';
          var headChanged = curHead !== String(nextHead);
          console.log('[GitBaselines] gitHeadModel update: changed=' + headChanged + ' curLen=' + curHead.length + ' nextLen=' + nextHead.length);
          if (headChanged) {
            gitHeadModel.setValue(nextHead);
          }
        } catch (_) {
          try { gitHeadModel.setValue(nextHead); } catch (_) {}
        }
        try { monaco.editor.setModelLanguage(gitHeadModel, lang); } catch (_) {}
      }

      if (!gitDiskModel) {
        gitDiskModel = monaco.editor.createModel(disk || '', lang);
      } else {
        var nextDisk = disk || '';
        try {
          if (!gitDiskModel.getValue || String(gitDiskModel.getValue()) !== String(nextDisk)) {
            gitDiskModel.setValue(nextDisk);
          }
        } catch (_) {
          try { gitDiskModel.setValue(nextDisk); } catch (_) {}
        }
        try { monaco.editor.setModelLanguage(gitDiskModel, lang); } catch (_) {}
      }

      ensureDiffEditorWithPrefs();

      var desiredAutoSave = !!getAutoSave();
      var desiredFreeze = !desiredAutoSave;
      var desiredHasBaseline = !desiredAutoSave;

      var needsSetModel = true;
      var needsFlagRebind = false;
      try {
        if (diffEditor && diffEditor.getModel) {
          var dm = diffEditor.getModel();
          if (dm && dm.original === gitHeadModel && dm.modified === model) {
            needsSetModel = false;
            var curAutoSave = !!dm.te2AutosaveMode;
            var curFreeze = !!dm.te2FreezeProjection;
            var curHasBaseline = !!dm.modifiedBaseline;
            needsFlagRebind = (
              curAutoSave !== desiredAutoSave ||
              curFreeze !== desiredFreeze ||
              curHasBaseline !== desiredHasBaseline
            );
            console.log('[GitBaselines] models match: needsSetModel=false needsFlagRebind=' + needsFlagRebind + ' hasGitDiff=' + hasGitDiff);
          } else {
            console.log('[GitBaselines] models differ: needsSetModel=true');
          }
        }
      } catch (_) {}

      if (needsSetModel || needsFlagRebind) {
        try {
          // Save view state before setModel to preserve cursor/scroll position.
          var modViewState = null;
          try {
            var modEd = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
            if (modEd) modViewState = modEd.saveViewState();
          } catch (_) {}

          var diffModel = {
            original: gitHeadModel,
            modified: model,
            te2AutosaveMode: desiredAutoSave,
          };
          if (!desiredAutoSave) {
            // Snapshot current editor content as draft baseline so edits
            // after toggling to draft mode show as diffs.
            var baselineContent = model.getValue ? model.getValue() : '';
            var baselineLang = model.getLanguageId ? model.getLanguageId() : 'plaintext';
            diffModel.modifiedBaseline = monaco.editor.createModel(baselineContent, baselineLang);
            diffModel.te2FreezeProjection = true;
          }
          diffEditor.setModel(diffModel);

          // Restore cursor/scroll after setModel.
          try {
            if (modViewState) {
              var modEd2 = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
              if (modEd2) modEd2.restoreViewState(modViewState);
            }
          } catch (_) {}

          setDebugFlags('flags=set as=' + (desiredAutoSave ? '1' : '0') + ' fr=' + (desiredFreeze ? '1' : '0') + ' mb=' + (desiredHasBaseline ? '1' : '0'));
        } catch (e) {
          console.warn('[Monaco] diffEditor.setModel failed', e);
          disposeGitBaselines();
          ensurePlainEditorWithPrefs();
          return;
        }
      }
      applyLineNumberSizing();
      _layoutEditors();
      // Install ordering hook so draft deletion zones can be re-appended after git diff
      // inserts its own deletion view zones.
      try { _installDraftZoneOrderingHook(); } catch (e) { console.warn('[DraftDiff] Failed to install zone ordering hook', e); }
      // Git diff deletion widgets are implemented as view zones; ensure our draft deletion
      // zones are added *after* the diff engine updates so they appear below git zones.
      try {
        if (diffEditor && diffEditor.onDidUpdateDiff && !diffEditor.__te2DraftZoneOrderBound) {
          diffEditor.__te2DraftZoneOrderBound = true;
          diffEditor.onDidUpdateDiff(function() {
            try { if (getShowDraftDiffs()) setTimeout(function(){ reapplyDraftZones(); }, 0); } catch (_) {}
          });
        }
      } catch (_) {}
      try { if (getShowDraftDiffs()) setTimeout(function(){ reapplyDraftZones(); }, 0); } catch (_) {}

      // Diff computation is async; getLineChanges() may be null until it settles.
      try {
        if (!diffEditor.__te2_onDidUpdateDiffBound && diffEditor.onDidUpdateDiff) {
          diffEditor.__te2_onDidUpdateDiffBound = true;
          diffEditor.onDidUpdateDiff(function() {
            try {
              var lc2 = null;
              try { lc2 = diffEditor.getLineChanges ? diffEditor.getLineChanges() : null; } catch (_) { lc2 = null; }
              var n2 = (lc2 && lc2.length != null) ? lc2.length : (lc2 === null ? 'null' : '0');
              setDebugGit('git=on lc=' + n2);
            } catch (_) {}
          });
        }
      } catch (_) {}

      try {
        var updateLc = function(tag) {
          try {
            var lc = null;
            try { lc = diffEditor.getLineChanges ? diffEditor.getLineChanges() : null; } catch (_) { lc = null; }
            var n = (lc && lc.length != null) ? lc.length : (lc === null ? 'null' : '0');
            setDebugGit('git=on lc=' + n + (tag ? ' ' + tag : ''));
            if (tag === 't800' && (lc === null || (lc && lc.length === 0))) {
              try {
                var res = null;
                try { res = diffEditor.getDiffComputationResult ? diffEditor.getDiffComputationResult() : null; } catch (_) { res = null; }
                var dm = null;
                try { dm = diffEditor.getModel ? diffEditor.getModel() : null; } catch (_) { dm = null; }
                console.warn('[Monaco][GitDiff] lc still empty after t800', {
                  path: currentPath,
                  tracked: tracked,
                  headSha: headSha,
                  diskSha: diskSha,
                  hasGitDiff: hasGitDiff,
                  diffResult: res ? { identical: res.identical, quitEarly: res.quitEarly, changesLen: res.changes ? res.changes.length : null, changes2Len: res.changes2 ? res.changes2.length : null } : null,
                  modelKeys: dm ? Object.keys(dm) : null,
                  hasModifiedBaselineKey: dm ? Object.prototype.hasOwnProperty.call(dm, 'modifiedBaseline') : null,
                  modifiedBaselineType: dm && dm.modifiedBaseline ? (typeof dm.modifiedBaseline) : null,
                });
              } catch (_) {}
            }
          } catch (_) {}
        };
        updateLc('t0');
        setTimeout(function(){ updateLc('t200'); }, 200);
        setTimeout(function(){ updateLc('t800'); }, 800);
      } catch (_) {}

      ensureTouchSelection('gitdiff');
      setTimeout(function(){ ensureTouchSelection('gitdiff-tick'); }, 0);

      // Restore scroll/cursor after editor transition + setModel + async diff computation.
      // Must be deferred because diff view zones alter scroll synchronously after computation.
      if (savedScrollTop != null) {
        var _restoreScroll = function() {
          try {
            var restoreEd = (diffEditor && diffEditor.getModifiedEditor)
              ? diffEditor.getModifiedEditor()
              : editor;
            if (restoreEd && savedScrollTop != null) restoreEd.setScrollTop(savedScrollTop);
            if (restoreEd && savedPosition) restoreEd.setPosition(savedPosition);
          } catch (_) {}
        };
        // Immediate attempt + deferred attempts after diff engine settles
        _restoreScroll();
        setTimeout(_restoreScroll, 50);
        setTimeout(_restoreScroll, 300);
      }
    } catch (e) {
      console.warn('[Monaco] applyGitBaselines failed', e);
    }
  }

  async function fetchSSOTState() {
    // Single call site so we can instrument/adjust behavior later.
    return await fetchJsonWithBase(fetch, apiBase, '/state', { cache: 'no-store' });
  }

  async function ensureEditorWithPrefs() {
    if (editor) return editor;
    var el = getEditorContainer();
    if (!el || !window.monaco) return null;

    try {
      if (!cachedPrefs) cachedPrefs = await fetchSSOTState();
    } catch (e) {
      // If SSOT is unavailable, we do NOT create a "base editor state".
      // Leave the editor uninitialized and show debug context.
      updateDebug('ssot=fail');
      throw e;
    }

    editor = monaco.editor.create(el, buildMonacoOptionsFromPrefs(cachedPrefs));
    try { _forceSemanticHighlighting(); } catch (_) {}
    try { installMarkerNavBindings(window.monaco, editor, function (dir) { jumpToMarker(window.monaco, editor, model, dir); }); } catch (_) {}
    try {
      var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
      var t = prefs && prefs.editor && prefs.editor.theme ? prefs.editor.theme : '';
      applyMonacoTheme(t);
    } catch (_) {}
    ensureTouchSelection('boot');
    _syncReadOnlyInputMode(editor);
    editor.onDidChangeConfiguration(function() { _onEditorConfigChanged(editor); });
    updateDebug('ssot=ok');
    ensureLayoutObserver();

    bindUIIPCEditorHooks();
    return editor;
  }

  function ensurePlainEditorWithPrefs() {
    // Capture scroll position from diff editor's modified pane before disposing.
    var savedScrollTop = null;
    var savedPosition = null;
    if (diffEditor) {
      try {
        var me = diffEditor.getModifiedEditor();
        if (me) {
          savedScrollTop = me.getScrollTop();
          savedPosition = me.getPosition();
        }
      } catch (_) {}
      disposeDiffEditorOnly();
      editor = null;
    }
    if (editor) return editor;
    var el = getEditorContainer();
    if (!el || !window.monaco) return null;

    editor = monaco.editor.create(el, buildMonacoOptionsFromPrefs(cachedPrefs));
    try { _forceSemanticHighlighting(); } catch (_) {}
    try { installMarkerNavBindings(window.monaco, editor, function (dir) { jumpToMarker(window.monaco, editor, model, dir); }); } catch (_) {}
    try {
      var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
      var t = prefs && prefs.editor && prefs.editor.theme ? prefs.editor.theme : '';
      applyMonacoTheme(t);
    } catch (_) {}
    if (model) {
      try { editor.setModel(model); } catch (_) {}
      installMirrorPublisher();
      installScrollPublisher();
    }
    ensureTouchSelection('plain');
    _syncReadOnlyInputMode(editor);
    editor.onDidChangeConfiguration(function() { _onEditorConfigChanged(editor); });
    ensureLayoutObserver();
    _layoutEditors();

    // Restore scroll position from the diff editor that was disposed.
    try {
      if (savedScrollTop != null && editor) {
        editor.setScrollTop(savedScrollTop);
      }
      if (savedPosition && editor) {
        editor.setPosition(savedPosition);
      }
    } catch (_) {}

    bindUIIPCEditorHooks();
    return editor;
  }

  function ensureDiffEditorWithPrefs() {
    if (diffEditor) return diffEditor;

    // Capture scroll position from plain editor before disposing it.
    var savedScrollTop = null;
    var savedPosition = null;
    try {
      if (editor) {
        savedScrollTop = editor.getScrollTop();
        savedPosition = editor.getPosition();
      }
    } catch (_) {}

    // Dispose the plain editor instance before creating the DiffEditor in the same container.
    if (editor) {
      disposePlainEditorOnly();
    }

    var el = getEditorContainer();
    if (!el || !window.monaco) return null;

    diffEditor = monaco.editor.createDiffEditor(el, {
      renderSideBySide: false,
      readOnly: false,
      originalEditable: false,
      enableSplitViewResizing: false,
      automaticLayout: true,
      experimental: { useTrueInlineView: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      renderGutterMenu: false
    });

    // Apply SSOT-derived options to both editors (original gutter must follow font size).
    try {
      var opts = buildMonacoOptionsFromPrefs(cachedPrefs);
      var theme = null;
      try { theme = opts && opts.theme ? opts.theme : null; } catch (_) { theme = null; }
      try { if (opts) delete opts.theme; } catch (_) {}
      try {
        var diffOpts = Object.assign({}, opts || {}, { minimap: { enabled: false } });
        diffEditor.getModifiedEditor().updateOptions(diffOpts);
      } catch (_) {}
      try {
        var origOpts = Object.assign({}, opts || {}, { readOnly: true, contextmenu: false, minimap: { enabled: false } });
        diffEditor.getOriginalEditor().updateOptions(origOpts);
      } catch (_) {}
      try {
        var scrollOpts = { scrollbar: { vertical: 'hidden', verticalScrollbarSize: 0, horizontal: 'hidden', horizontalScrollbarSize: 0 } };
        diffEditor.getModifiedEditor().updateOptions(scrollOpts);
        diffEditor.getOriginalEditor().updateOptions(scrollOpts);
      } catch (_) {}
          if (theme) applyMonacoTheme(theme);
    } catch (_) {}

    editor = diffEditor.getModifiedEditor();

    if (model) {
      try { editor.setModel(model); } catch (_) {}
      installMirrorPublisher();
      installScrollPublisher();
    }
    // Request breadcrumb symbols for the diff editor's active file.
    try { if (currentPath) _bcRequestSymbols(currentPath); } catch (_) {}
    ensureTouchSelection('diff');
    // Original pane is always readOnly — always suppress keyboard.
    _syncReadOnlyInputMode(diffEditor.getOriginalEditor());
    _syncReadOnlyInputMode(editor);
    editor.onDidChangeConfiguration(function() { _onEditorConfigChanged(editor); });
    ensureLayoutObserver();
    _layoutEditors();

    // Restore scroll position from the plain editor that was disposed.
    try {
      if (savedScrollTop != null && editor) {
        editor.setScrollTop(savedScrollTop);
      }
      if (savedPosition && editor) {
        editor.setPosition(savedPosition);
      }
    } catch (_) {}

    bindUIIPCEditorHooks();
    return diffEditor;
  }

  // Force-flush the mirror/didChange debounce so the ext host has the latest
  // document content before we make an RPC call (e.g., completions).
  function _flushMirrorDebounce() {
    try {
      if (!mirrorDebounceT) return;
      clearTimeout(mirrorDebounceT);
      mirrorDebounceT = null;
      if (!model || !currentPath || !editorSocket || !editorSocket.connected) return;
      var content = model.getValue();
      editorSocket.emit('editor_mirror', {
        path: currentPath,
        content: content,
        base_sha256: baseSha256,
      });
      _wbPublishDidChange(
        currentPath,
        content,
        model.getLanguageId ? model.getLanguageId() : '',
        _wbCurrentGeneration()
      );
    } catch (_) {}
  }

  function installMirrorPublisher() {
    if (!editor) return;
    try {
      if (installMirrorPublisher._done) return;
      try {
        if (mirrorPublisherDisposable && mirrorPublisherDisposable.dispose) {
          mirrorPublisherDisposable.dispose();
        }
      } catch (_) {}
      mirrorPublisherDisposable = editor.onDidChangeModelContent(function() {
        if (isApplyingRemote) return;
        if (!editorSocket || !editorSocket.connected) return;
        if (!currentPath || !model) return;
        lastLocalEditAt = Date.now();
        if (mirrorDebounceT) clearTimeout(mirrorDebounceT);
        mirrorDebounceT = setTimeout(function() {
          try {
            var content = model.getValue();
            editorSocket.emit('editor_mirror', {
              path: currentPath,
              content: content,
              base_sha256: baseSha256,
            });
            _wbPublishDidChange(
              currentPath,
              content,
              model.getLanguageId ? model.getLanguageId() : '',
              _wbCurrentGeneration()
            );
          } catch (_) {}
          requestDraftDiff('local');
        }, _localMirrorDebounceMs());
      });
      installMirrorPublisher._done = true;
      _trace.mirror_active = 1;
      _trace.mirror_bind_total += 1;
      _syncTraceDebug();
    } catch (e) {
      console.warn('[Monaco] Failed to install mirror publisher', e);
    }
  }

  function ensureTouchSelection(reason) {
    _ensureTouchSelection(reason, {
      getEditor: function() { return editor; },
      getDiffEditor: function() { return diffEditor; },
      getCurrentPath: function() { return currentPath; },
      getUiIpcSocket: function() { return uiIpcSocket; },
      updateDebug: updateDebug,
    });
  }

  // Suppress soft keyboard on mobile when editor is readOnly.
  function _syncReadOnlyInputMode(ed) {
    syncReadOnlyInputMode(ed, monaco, document);
  }

  var _lastKnownReadOnly = null;
  function _onEditorConfigChanged(ed) {
    onEditorConfigChanged(ed, {
      syncReadOnlyInputModeFn: _syncReadOnlyInputMode,
      lastKnownReadOnly: _lastKnownReadOnly,
      setLastKnownReadOnlyFn: function (ro) { _lastKnownReadOnly = ro; },
      monacoRef: monaco,
      fetchFn: _fetch,
    });
  }

  function updateDebug(extra) {
    try {
      if (!dbg) dbg = document.getElementById('fh-debug');
      if (!dbg) return;
      dbg.textContent = buildDebugMessage(dbg, editor, debugParts, extra);
    } catch (_) {}
  }

  function setDebugGit(s) {
    setDebugPart(debugParts, 'git', s, updateDebug);
  }

  function setDebugDraft(s) {
    setDebugPart(debugParts, 'draft', s, updateDebug);
  }

  function setDebugDiag(s) {
    setDebugPart(debugParts, 'diag', s, updateDebug);
  }

  function setDebugFlags(s) {
    setDebugPart(debugParts, 'flags', s, updateDebug);
  }

  function setDebugMirror(s) {
    setDebugPart(debugParts, 'mirror', s, updateDebug);
  }

  function setDebugTrace(s) {
    setDebugPart(debugParts, 'trace', s, updateDebug);
  }

  function _syncTraceDebug() {
    syncTraceDebug(_trace, setDebugTrace);
  }

  function _syncMirrorDebug() {
    syncMirrorDebug(mirrorState, setDebugMirror);
  }

  function clearDraftDiffDecorations() {
    var next = clearDraftDiffDecorationsState({
      clearZonesFn: clearDraftDiffZones,
      draftDecoCollection: draftDecoCollection,
      editor: editor,
      draftDecoIds: draftDecoIds,
      setDebugDraftFn: setDebugDraft,
    });
    draftDecoIds = next.draftDecoIds;
    lastDraftZones = next.lastDraftZones;
  }

  function clearDraftDiffZones() {
    draftZoneIds = clearDraftDiffZonesState(editor, draftZoneIds);
  }

  function applyDraftZones(zones) {
    lastDraftZones = (zones && zones.length) ? zones.slice() : null;
    clearDraftDiffZones();
    if (!zones || !zones.length || !editor || !editor.changeViewZones) return;
    isApplyingDraftZones = true;
    try {
      _ignoreNextModifiedViewZonesEvent = true;
      editor.changeViewZones(function(accessor) {
        for (var zi = 0; zi < zones.length; zi++) {
          var z = zones[zi];
          var node = document.createElement('div');
          node.className = 'te2-draft-del-zone';
          node.textContent = z.text || '';
          node.style.whiteSpace = 'pre';
          applyEditorTypography(node);
          try {
            var id = accessor.addZone({
              afterLineNumber: z.after,
              heightInLines: Math.max(1, z.lines || 1),
              domNode: node,
            });
            draftZoneIds.push(id);
          } catch (_) {}
        }
      });
    } catch (_) {}
    isApplyingDraftZones = false;
  }

  function reapplyDraftZones() {
    try {
      if (isApplyingDraftZones) return;
      if (!lastDraftZones || !lastDraftZones.length) return;
      applyDraftZones(lastDraftZones);
    } catch (_) {}
  }

  function _installDraftZoneOrderingHook() {
    try {
      if (!diffEditor || diffEditor.__te2DraftZoneOrderingHook) return;
      const mod = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
      if (!mod || !mod.onDidChangeViewZones) return;
      diffEditor.__te2DraftZoneOrderingHook = true;
      mod.onDidChangeViewZones(function() {
        try {
          if (_ignoreNextModifiedViewZonesEvent) {
            _ignoreNextModifiedViewZonesEvent = false;
            return;
          }
          // When git diff inserts its own deleted-code view zones, re-append our draft zones
          // so they appear below git zones. Avoid tight loops with a debounce.
          if (_reapplyDraftZonesScheduled) return;
          if (!getShowInlineDiffs()) return;
          if (!getShowDraftDiffs()) return;
          if (!lastDraftZones || !lastDraftZones.length) return;
          _reapplyDraftZonesScheduled = true;
          setTimeout(function() {
            _reapplyDraftZonesScheduled = false;
            try { reapplyDraftZones(); } catch (_) {}
          }, 0);
        } catch (_) {}
      });
    } catch (_) {}
  }

  function applyEditorTypography(node) {
    try {
      if (!node || !editor || !window.monaco) return;
      var ff = null;
      var fs = null;
      var lh = null;
      try { ff = editor.getOption(monaco.editor.EditorOption.fontFamily); } catch (_) { ff = null; }
      try { fs = editor.getOption(monaco.editor.EditorOption.fontSize); } catch (_) { fs = null; }
      try { lh = editor.getOption(monaco.editor.EditorOption.lineHeight); } catch (_) { lh = null; }
      if (ff) node.style.fontFamily = ff;
      if (fs) node.style.fontSize = String(fs) + 'px';
      if (lh) node.style.lineHeight = String(lh) + 'px';
    } catch (_) {}
  }

  function applyLineNumberSizing() {
    applyLineNumberSizingForEditors(editor, diffEditor, model, gitHeadModel, gitDiskModel);
  }

  function _ensureDraftDecoCollection() {
    try {
      if (draftDecoCollection) return draftDecoCollection;
      if (!editor) return null;
      if (editor.createDecorationsCollection) {
        draftDecoCollection = editor.createDecorationsCollection();
        return draftDecoCollection;
      }
    } catch (_) {}
    return null;
  }

  function applyDraftDiffDecorations(payload) {
    try {
      if (!payload || !payload.path || !currentPath) return;
      if (String(payload.path) !== String(currentPath)) return;
      if (!editor || !window.monaco || !model) return;

      if (!getShowDraftDiffs()) {
        clearDraftDiffDecorations();
        return;
      }

      var hunks = Array.isArray(payload.hunks) ? payload.hunks : [];
      var ms = (payload.ms != null) ? payload.ms : null;
      var debug = false;
      try { debug = !!window.__debugDraftDiffs; } catch (_) { debug = false; }

      var addLines = 0;
      var delLines = 0;
      var decorations = [];
      var zones = [];

      var lineCount = 0;
      try { lineCount = model.getLineCount ? model.getLineCount() : 0; } catch (_) { lineCount = 0; }
      if (!lineCount || lineCount < 1) {
        clearDraftDiffDecorations();
        setDebugDraft('draft=empty');
        return;
      }
      function clampLine(n) {
        if (n < 1) return 1;
        if (n > lineCount) return lineCount;
        return n;
      }

      var debugLines = null;
      if (debug) {
        debugLines = [];
        console.groupCollapsed('[DraftDiff] apply ' + String(payload.path || '') + ' hunks=' + String(hunks.length) + ' lines=' + String(lineCount) + (ms != null ? (' ms=' + String(ms)) : ''));
      }

      for (var hi = 0; hi < hunks.length; hi++) {
        var h = hunks[hi];
        if (!h || !Array.isArray(h.lines)) continue;
        var oldLine = (typeof h.oldStart === 'number' ? h.oldStart : 1);
        var newLine = (typeof h.newStart === 'number' ? h.newStart : 1);
        if (debug && debugLines) {
          debugLines.push('hunk#' + hi + ' oldStart=' + oldLine + ' newStart=' + newLine + ' lines=' + h.lines.length);
        }

        for (var li = 0; li < h.lines.length; li++) {
          var ln = h.lines[li];
          var t = ln && ln.type ? String(ln.type) : '';
          if (t === 'context') {
            oldLine += 1;
            newLine += 1;
            continue;
          }
          if (t === 'add-draft') {
            addLines += 1;
            var lno = clampLine(newLine);
            if (lno < 1 || lno > lineCount) {
              newLine += 1;
              continue;
            }
            var lineLen = 0;
            try { lineLen = model.getLineLength(lno); } catch (_) { lineLen = 0; }
            if (debug && debugLines) {
              let sample = '';
              try {
                sample = model.getLineContent(lno);
                if (sample && sample.length > 140) sample = sample.slice(0, 140) + '…';
              } catch (_) {}
              debugLines.push('  add hunk#' + hi + ' line#' + li + ' newLine=' + newLine + ' -> lno=' + lno + ' len=' + lineLen + ' sample=' + JSON.stringify(sample));
            }
            decorations.push({
              range: new monaco.Range(lno, 1, lno, 1),
              options: { isWholeLine: true, className: 'te2-draft-add-line' },
            });
            newLine += 1;
            continue;
          }
          if (t === 'del-draft') {
            // Group consecutive deletions into a single marker + zone so we don't
            // stack multiple decorations on the same anchor line (Monaco will only
            // show one marker, and ranges overlap heavily).
            var anchor = clampLine(newLine);
            if (anchor < 1 || anchor > lineCount) {
              oldLine += 1;
              continue;
            }

            var delBlock = [];
            var delBlockPreview = [];
            var blockStartLi = li;
            while (li < h.lines.length) {
              var ln2 = h.lines[li];
              var t2 = ln2 && ln2.type ? String(ln2.type) : '';
              if (t2 !== 'del-draft') break;
              delLines += 1;
              var txt = (ln2 && typeof ln2.text === 'string') ? ln2.text : '';
              delBlock.push(txt);
              if (debug && debugLines) {
                const prev = txt.length > 140 ? txt.slice(0, 140) + '…' : txt;
                delBlockPreview.push(prev);
              }
              oldLine += 1;
              li += 1;
            }
            // We advanced li one past last del line; outer loop will li++ again.
            li -= 1;

            if (debug && debugLines) {
              let sample2 = '';
              try {
                sample2 = model.getLineContent(anchor);
                if (sample2 && sample2.length > 140) sample2 = sample2.slice(0, 140) + '…';
              } catch (_) {}
              debugLines.push(
                '  del-block hunk#' + hi +
                ' lines#' + blockStartLi + '-' + li +
                ' newLine=' + newLine +
                ' anchor=' + anchor +
                ' count=' + delBlock.length +
                ' del=' + JSON.stringify(delBlockPreview.join('\\n')) +
                ' sample=' + JSON.stringify(sample2)
              );
            }

            decorations.push({
              range: new monaco.Range(anchor, 1, anchor, 1),
              options: {
                // Only render a gutter marker for deletions; avoid tinting the line itself.
                // In "replace" hunks (del+add at same anchor), line tint would mix with the
                // insertion highlight and make the first inserted line look wrong.
                isWholeLine: false,
                linesDecorationsClassName: 'te2-draft-del-marker',
              },
            });
            zones.push({
              after: anchor - 1,
              text: delBlock.join('\n'),
              lines: delBlock.length,
            });
            continue;
          }
          oldLine += 1;
          newLine += 1;
        }
      }

      if (debug && debugLines) {
        // Quick overlap sanity check for line-based decorations.
        try {
          const lines = decorations
            .map(d => (d && d.range) ? d.range.startLineNumber : null)
            .filter(n => typeof n === 'number')
            .sort((a,b) => a-b);
          let overlaps = 0;
          for (let i=1;i<lines.length;i++) if (lines[i] === lines[i-1]) overlaps++;
          console.log('[DraftDiff] summary add=' + addLines + ' del=' + delLines + ' decorations=' + decorations.length + ' zones=' + zones.length + ' overlaps=' + overlaps);
        } catch (_) {}
        for (let i = 0; i < debugLines.length; i++) console.log('[DraftDiff] ' + debugLines[i]);
        console.groupEnd();
      }

      var coll = _ensureDraftDecoCollection();
      if (coll && coll.set) {
        coll.set(decorations);
      } else if (editor && editor.deltaDecorations) {
        draftDecoIds = editor.deltaDecorations(draftDecoIds, decorations);
      }

      applyDraftZones(zones);
      try { if (getShowInlineDiffs()) _installDraftZoneOrderingHook(); } catch (e) { console.warn('[DraftDiff] Failed to install zone ordering hook', e); }

      var tag = 'draft=+' + addLines + ' -' + delLines;
      if (ms != null) tag += ' ' + String(ms) + 'ms';
      setDebugDraft(tag);
      if (payload && payload.error) console.warn('[DraftDiff] error', payload.error);
    } catch (e) {
      console.warn('[DraftDiff] apply failed', e);
    }
  }

  function requestDraftDiff(reason) {
    try {
      if (!editorSocket || !editorSocket.connected) return false;
      if (!currentPath) return false;
      if (!getShowDraftDiffs()) return false;

      if (draftDiffDebounceT) clearTimeout(draftDiffDebounceT);
      draftDiffDebounceT = setTimeout(function() {
        try {
          draftDiffRequestId = String(Date.now()) + ':' + String(Math.random()).slice(2);
          editorSocket.emit('editor_draft_diff_request', { path: currentPath, requestId: draftDiffRequestId, reason: reason || '' });
        } catch (_) {}
      }, 180);
      return true;
    } catch (_) {
      return false;
    }
  }


  async function openPathFromBackend(absPath, preferredLanguage) {
    if (!absPath) return;
    _clearDiagnosticsForSwitch();
    try {
      await ensureEditorWithPrefs();
    } catch (e) {
      console.warn('[Monaco] SSOT unavailable; cannot open file', e);
      return;
    }

    var autoSave = resolveAutoSaveFromPrefs(cachedPrefs);
    var cache = await fetchOpenCache(fetchJsonWithBase, fetch, apiBase, absPath);
    var openData = await resolveOpenContent(fetchJsonWithBase, fetch, apiBase, absPath, cache);
    var hasDraft = !!openData.hasDraft;
    var content = openData.content;
    var sha256 = openData.sha256;

    // Apply to Monaco model
    var lang = resolveOpenLanguage(preferredLanguage, absPath, normalizeLanguage, languageFromPath);
    if (!model) {
      model = initOpenModel(createFileModel, editor, content, lang, absPath, function(nextModel, nextLang, nextPath) {
        applyLanguageToModel(nextModel, nextLang, nextPath);
        installMirrorPublisher();
        installScrollPublisher();
        vscodeRpcDidOpenIfReady();
        installVscodeRpcChangePublisher();
      });
    } else {
      try {
        if (shouldRecreateOpenModel(window.monaco, monacoFileUri, model, absPath)) {
          if (diffEditor) { try { diffEditor.setModel(null); } catch (_) {} }
          try { model.dispose(); } catch (_) {}
          model = initOpenModel(createFileModel, editor, content, lang, absPath, function(nextModel, nextLang, nextPath) {
            applyLanguageToModel(nextModel, nextLang, nextPath);
            installMirrorPublisher();
            installScrollPublisher();
            vscodeRpcDidOpenIfReady();
            installVscodeRpcChangePublisher();
          });
        } else {
          applyOpenModelTextSafely(model, editor, content, function(v) { isApplyingRemote = !!v; });
          applyLanguageToModel(model, lang, absPath);
        }
      } catch (_) {
        applyOpenModelTextSafely(model, editor, content, function(v) { isApplyingRemote = !!v; });
        applyLanguageToModel(model, lang, absPath);
      }
    }
    currentPath = absPath;
    var backendGeneration = _wbBumpGeneration(currentPath, 'openPathFromBackend');
    try { bcUpdatePath(currentPath, true); } catch (_) {}
    baseSha256 = sha256;

    emitOpenCacheState(emitToHost, absPath, hasDraft, sha256, autoSave);

    queueBackendWorkbenchOpen({
      currentPath: currentPath,
      lang: lang,
      model: model,
      generation: backendGeneration,
      queueDidChangeFn: _wbQueueDidChange,
      queueSymbolsFn: _wbQueueSymbols,
      openFileFlowFn: _wbOpenFileFlow,
    });

    ensureTouchSelection('open-post');
    setTimeout(function(){ ensureTouchSelection('open-tick'); }, 0);
    updateDebug('open=ok');
  }

  function connectEditorSocket() {
    try {
      if (!window.io) return false;
      editorSocket = window.io('/editor', {
        path: '/editor_ws/socket.io',
        transports: ['websocket'],
        query: { app_id: 'file_editor_cm6' },
      });

      editorSocket.on('connect', function() {
        editorSocketId = editorSocket.id || null;
        emitToHost('editor_ready', {});
        emitToHost('editor:iframe_ready', {});
      });

      editorSocket.on('editor:ssot', function(snapshot) {
        try {
          try {
            var _t = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
              ? (Math.round(performance.now() * 10) / 10)
              : null;
            console.log((_t != null ? ('t=' + _t + 'ms ') : '') + 'now=' + Date.now(), '[editor:ssot] rx', { hasFile: !!(snapshot && snapshot.file), currentPath: snapshot && snapshot.currentPath });
          } catch (_) {}
          cachedPrefs = snapshot;
          if (snapshot && snapshot.file) {
            var f = snapshot.file;
            // Apply directly from SSOT payload (draft wins).
            baseSha256 = f.base_sha256 || baseSha256;
            currentPath = f.path || currentPath;
            var ssotGeneration = _wbBumpGeneration(currentPath, 'ssot');
            try { bcUpdatePath(currentPath, true); } catch (_) {}
            ensureEditorWithPrefs().then(function() {
              var lang = languageFromPath(currentPath);
              if (!model) {
                model = createFileModel(f.content || '', lang, currentPath);
                editor.setModel(model);
                applyLanguageToModel(model, lang, currentPath);
                installMirrorPublisher();
                installScrollPublisher();
                vscodeRpcDidOpenIfReady();
                installVscodeRpcChangePublisher();
              } else {
                // If the active file changed, recreate the model with a file:// URI so
                // vscode_rpc semantic tokens + diagnostics can target the correct doc.
                try {
                  var want = monacoFileUri(window.monaco, currentPath);
                  if (want && model.uri && String(model.uri.toString()) !== String(want.toString())) {
                    if (diffEditor) { try { diffEditor.setModel(null); } catch (_) {} }
                    try { model.dispose(); } catch (_) {}
                    model = createFileModel(f.content || '', lang, currentPath);
                    editor.setModel(model);
                    applyLanguageToModel(model, lang, currentPath);
                    installMirrorPublisher();
                    installScrollPublisher();
                    vscodeRpcDidOpenIfReady();
                    installVscodeRpcChangePublisher();
                  } else {
                    isApplyingRemote = true;
                    try {
                      var _ssotRange = model.getFullModelRange();
                      model.applyEdits([{ range: _ssotRange, text: f.content || '' }]);
                    } finally { isApplyingRemote = false; }
                    applyLanguageToModel(model, lang, currentPath);
                  }
                } catch (_) {
                  isApplyingRemote = true;
                  try {
                    var _ssotRange2 = model.getFullModelRange();
                    model.applyEdits([{ range: _ssotRange2, text: f.content || '' }]);
                  } finally { isApplyingRemote = false; }
                  applyLanguageToModel(model, lang, currentPath);
                }
              }
              ensureTouchSelection('ssot');
              try { lastContentSha256 = f.content_sha256 || lastContentSha256; } catch (_) {}
              emitToHost('editor_cache_state', {
                path: currentPath,
                state: f.state,
                unsaved: !!f.unsaved,
                reason: f.reason,
                content_sha256: f.content_sha256,
                auto_save: f.auto_save,
              });
              // Cold-open restore: if SSOT provides a last scroll line and there is no explicit jump,
              // restore viewport to that line.
              try {
                if (f && f.scroll_line != null && !f.has_draft) {
                  applyJumpToLineAt(editor, model, { line: f.scroll_line, focus: false, scroll_to_top: true });
                }
              } catch (_) {}
              if (f.has_draft) {
                emitToHost('editor_draft_state', { has_draft: true, path: currentPath });
                requestDraftDiff('ssot');
              } else {
                clearDraftDiffDecorations();
              }
              updateDebug('ws=ssot');
              requestGitBaselines({ reason: 'ssot' });

              // IMPORTANT: SSOT restore does not currently emit `editor:open`.
              // Trigger the workbench language sidecar anyway so code-server can
              // activate extensions and register providers for the active file.
              try {
                var ssotReqId = (f && f.request_id) ? String(f.request_id) : ('diag_' + Date.now() + '_ssot');
                var ssotText = '';
                try { ssotText = model && model.getValue ? model.getValue() : ''; } catch (_) {}
                _wbQueueDidChange(
                  currentPath,
                  ssotText,
                  model && model.getLanguageId ? model.getLanguageId() : lang,
                  ssotGeneration
                );
                _wbQueueSymbols(currentPath, ssotGeneration);
                _wbOpenFileFlow({
                  path: currentPath,
                  languageId: lang,
                  uri: (model && model.uri) ? String(model.uri.toString()) : '',
                  requestId: ssotReqId,
                  forceRefresh: true,
                  generation: ssotGeneration,
                  source: 'ssot',
                  timeoutMs: 8000,
                }).catch(function () {});
              } catch (_) {}

              // Diagnostics will arrive fresh via $changeMany from the adapter
              // after _wbQueueDidChange notifies the extension host above.
            });
          } else {
            updateDebug('ws=ssot-empty');
          }
        } catch (e) {
          console.warn('[Monaco] ssot apply failed', e);
        }
      });

      editorSocket.on('editor:open', function(payload) {
        try {
          if (!payload || !payload.path) return;

          // Guard: external_change events that don't match the loaded model URI
          // are irrelevant to this editor — skip entirely.
          if (payload.reason === 'external_change' && model && model.uri) {
            try {
              var incomingUri = monacoFileUri(window.monaco, payload.path);
              if (incomingUri && String(model.uri.toString()) !== String(incomingUri.toString())) {
                console.log('[editor:open] skip external_change: URI mismatch', payload.path);
                return;
              }
            } catch (_) {}
          }

          try {
            var _t = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
              ? (Math.round(performance.now() * 10) / 10)
              : null;
            console.log((_t != null ? ('t=' + _t + 'ms ') : '') + 'now=' + Date.now(), '[editor:open] rx', { path: payload.path, request_id: payload.request_id || '' });
          } catch (_) {}
          // Always follow SSOT open across clients.
          baseSha256 = payload.base_sha256 || baseSha256;
          currentPath = payload.path;
          var openGeneration = _wbBumpGeneration(currentPath, 'editor:open');
          try { bcUpdatePath(currentPath, true); } catch (_) {}
          ensureEditorWithPrefs().then(function() {
            var lang = languageFromPath(currentPath);
            if (!model) {
              model = createFileModel(payload.content || '', lang, currentPath);
              editor.setModel(model);
              applyLanguageToModel(model, lang, currentPath);
              installMirrorPublisher();
              installScrollPublisher();
              vscodeRpcDidOpenIfReady();
              installVscodeRpcChangePublisher();
            } else {
              try {
                var want = monacoFileUri(window.monaco, currentPath);
                if (want && model.uri && String(model.uri.toString()) !== String(want.toString())) {
                  // Detach diff editor model before disposing — Monaco throws
                  // BugIndicatingError if a TextModel is disposed while DiffEditorWidget
                  // still references it.
                  if (diffEditor) { try { diffEditor.setModel(null); } catch (_) {} }
                  try { model.dispose(); } catch (_) {}
                  model = createFileModel(payload.content || '', lang, currentPath);
                  editor.setModel(model);
                  applyLanguageToModel(model, lang, currentPath);
                  installMirrorPublisher();
                  installScrollPublisher();
                  vscodeRpcDidOpenIfReady();
                  installVscodeRpcChangePublisher();
                } else {
                  isApplyingRemote = true;
                  try {
                    var fullRange = model.getFullModelRange();
                    model.applyEdits([{ range: fullRange, text: payload.content || '' }]);
                  } finally { isApplyingRemote = false; }
                  applyLanguageToModel(model, lang, currentPath);
                }
              } catch (_) {
                isApplyingRemote = true;
                try {
                  var fullRange2 = model.getFullModelRange();
                  model.applyEdits([{ range: fullRange2, text: payload.content || '' }]);
                } finally { isApplyingRemote = false; }
                applyLanguageToModel(model, lang, currentPath);
              }
            }
            applyLineNumberSizing();
            ensureTouchSelection('open');

            // After external edit, re-snapshot modifiedBaseline so the diff
            // recomputes even when te2FreezeProjection is active (draft/auto-track).
            // Skip for external_change — diff recalc is deferred to avoid thrash.
            if (payload.reason !== 'external_change') {
              try {
                if (diffEditor && diffEditor.getModel) {
                  var dm = diffEditor.getModel();
                  if (dm && dm.te2FreezeProjection && dm.modifiedBaseline && model) {
                    var freshContent = model.getValue();
                    var freshLang = model.getLanguageId ? model.getLanguageId() : 'plaintext';
                    dm.modifiedBaseline.setValue(freshContent);
                    // Force diff recomputation by calling setModel with updated baseline.
                    var modViewState = null;
                    try {
                      var me = diffEditor.getModifiedEditor();
                      if (me) modViewState = me.saveViewState();
                    } catch (_) {}
                    diffEditor.setModel(dm);
                    try {
                      if (modViewState) {
                        var me2 = diffEditor.getModifiedEditor();
                        if (me2) me2.restoreViewState(modViewState);
                      }
                    } catch (_) {}
                  }
                }
              } catch (_) {}
            }
            // Notify the language sidecar so extension activation + provider registration can happen.
            // This is intentionally best-effort and must not block the editor UI.
            try {
              var openReqId = (payload && payload.request_id) ? String(payload.request_id) : ('diag_' + Date.now() + '_open');
              var openText = '';
              try { openText = model && model.getValue ? model.getValue() : ''; } catch (_) {}
              _wbQueueDidChange(
                currentPath,
                openText,
                model && model.getLanguageId ? model.getLanguageId() : lang,
                openGeneration
              );
              _wbQueueSymbols(currentPath, openGeneration);
              _wbOpenFileFlow({
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
            // Diagnostics will arrive fresh via $changeMany after _wbQueueDidChange above.
            // Optional open+jump payload (used by agent drawer + explorer + go-to-line).
            try {
              if (payload.line != null) {
                applyJumpToLineAt(editor, model, {
                  line: payload.line,
                  column: payload.column,
                  focus: payload.focus,
                  scroll_y: payload.scroll_y,
                  scroll_to_top: payload.scroll_to_top,
                });
              }
            } catch (_) {}
            try { lastContentSha256 = payload.content_sha256 || lastContentSha256; } catch (_) {}
            emitToHost('editor_cache_state', {
              path: currentPath,
              state: payload.state || 'clean',
              unsaved: !!payload.unsaved,
              reason: payload.reason || 'open',
              content_sha256: payload.content_sha256,
              auto_save: payload.auto_save,
            });
            if (payload.has_draft) requestDraftDiff('open');
            else clearDraftDiffDecorations();

            // Restore last scroll line if no explicit open+jump was requested.
            try {
              if (payload.line == null && payload.scroll_line != null) {
                applyJumpToLineAt(editor, model, { line: payload.scroll_line, focus: false, scroll_to_top: true });
              }
            } catch (_) {}
          });
          // Skip git baselines for external_change — content is already updated
          // from disk; the diff recompute is expensive and should not fire on
          // every watcher hit during bundler runs.
          if (payload.reason !== 'external_change') {
            requestGitBaselines({ reason: 'open' });
          }
        } catch (e) {
          console.warn('[Monaco] open apply failed', e);
        }
      });

      editorSocket.on('editor:jump_to_line', function(payload) {
        handleJumpToLineEvent(editor, model, payload, applyJumpToLineAt);
      });

      editorSocket.on('editor:mirror', function(payload) {
        try {
          mirrorState.rx += 1;
          if (!isMirrorPayloadValid(payload)) return;
          if (shouldDropMirrorForSource(payload, editorSocketId)) {
            mirrorState.drop_self += 1;
            _syncMirrorDebug();
            return;
          }
          if (shouldDropMirrorForPath(payload.path, currentPath)) {
            mirrorState.drop_path += 1;
            _syncMirrorDebug();
            return;
          }
          if (shouldDropMirrorForNoModel(model)) {
            mirrorState.drop_no_model += 1;
            _syncMirrorDebug();
            return;
          }
          if (shouldDropMirrorForSha(payload.content_sha256, lastContentSha256, model, payload.content)) {
            mirrorState.drop_sha += 1;
            _syncMirrorDebug();
            return;
          }
          var hotMs = _mirrorHotWindowMs();
          if (shouldDropMirrorForHotWindow(lastLocalEditAt, Date.now(), hotMs)) {
            mirrorState.drop_hot += 1;
            _syncMirrorDebug();
            return;
          }
          applyMirrorContentToModel(model, payload.content, function(v) { isApplyingRemote = !!v; });
          try { lastContentSha256 = payload.content_sha256 || lastContentSha256; } catch (_) {}
          mirrorState.ap += 1;
          _syncMirrorDebug();
          applyLineNumberSizing();
          var mirrorUnsaved = (payload.unsaved === true);
          _setUnsavedTrace('mirror', mirrorUnsaved);
          emitMirrorCacheState(emitToHost, payload, mirrorUnsaved);
          if (mirrorUnsaved) {
            // Do not refresh Git baselines on draft mirror; Git baselines must stay pinned.
            requestDraftDiff('mirror');
          } else {
            clearDraftDiffDecorations();
          }
        } catch (e) {
          console.warn('[Monaco] mirror apply failed', e);
        }
      });

      editorSocket.on('editor:prefs_changed', function(payload) {
        try {
          var nextPrefs = payload && payload.preferences ? payload.preferences : null;
          if (!nextPrefs) return;
          var prevAutoSave = !!getAutoSave();

          if (!cachedPrefs) cachedPrefs = {};
          cachedPrefs.preferences = nextPrefs;
          var nextAutoSave = !!getAutoSave();

          if (!editor) return;
          var opts = buildMonacoOptionsFromPrefs({ preferences: nextPrefs });
          var theme = null;
          // Theme must be the raw SSOT key (supports `vscode:*`).
          try { theme = nextPrefs && nextPrefs.editor && nextPrefs.editor.theme ? nextPrefs.editor.theme : null; } catch (_) { theme = null; }
          try { if (opts) delete opts.theme; } catch (_) {}

          try { editor.updateOptions(opts || {}); } catch (e) { console.warn('[Monaco] updateOptions failed', e); }
          applyLineNumberSizing();
          if (diffEditor && diffEditor.getOriginalEditor) {
            try {
              var origOpts = Object.assign({}, opts || {}, { readOnly: true, contextmenu: false, minimap: { enabled: false } });
              diffEditor.getOriginalEditor().updateOptions(origOpts);
              try {
                var diffOpts = Object.assign({}, opts || {}, { minimap: { enabled: false } });
                diffEditor.getModifiedEditor().updateOptions(diffOpts);
              } catch (_) {}
              try {
                var scrollOpts = { scrollbar: { vertical: 'hidden', verticalScrollbarSize: 0, horizontal: 'hidden', horizontalScrollbarSize: 0 } };
                diffEditor.getModifiedEditor().updateOptions(scrollOpts);
                diffEditor.getOriginalEditor().updateOptions(scrollOpts);
              } catch (_) {}
            } catch (_) {}
          }
          if (theme) {
            applyMonacoTheme(theme);
          }
          ensureTouchSelection('prefs');
          _layoutEditors();
          updateDebug('prefs=ok');
          if (prevAutoSave !== nextAutoSave && diffEditor && diffEditor.getModel) {
            try {
              var dm = diffEditor.getModel ? diffEditor.getModel() : null;
              if (dm && dm.original && dm.modified) {
                // Preserve cursor/scroll across mode switch.
                var _mvs = null;
                try {
                  var _me = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
                  if (_me) _mvs = _me.saveViewState();
                } catch (_) {}

                var nextDiffModel = {
                  original: dm.original,
                  modified: dm.modified,
                  te2AutosaveMode: !!nextAutoSave,
                };
                if (!nextAutoSave && dm.original === gitHeadModel && dm.modified === model) {
                  // Snapshot the current editor content as the draft baseline.
                  // After autosave, gitDiskModel == editor content (empty diff).
                  // Instead, freeze the current state so subsequent edits diff against it.
                  var baselineContent = model.getValue ? model.getValue() : '';
                  var baselineLang = model.getLanguageId ? model.getLanguageId() : 'plaintext';
                  var draftBaseline = monaco.editor.createModel(baselineContent, baselineLang);
                  nextDiffModel.modifiedBaseline = draftBaseline;
                  nextDiffModel.te2FreezeProjection = true;
                }
                diffEditor.setModel(nextDiffModel);

                try {
                  if (_mvs) {
                    var _me2 = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
                    if (_me2) _me2.restoreViewState(_mvs);
                  }
                } catch (_) {}
              }
            } catch (e2) {
              console.warn('[Monaco] autosave diff mode switch failed', e2);
            }
          }
          if (getShowInlineDiffs()) {
            requestGitBaselines({ immediate: true, reason: 'prefs' });
          } else {
            disposeGitBaselines();
            if (diffEditor) ensurePlainEditorWithPrefs();
          }
          if (getShowDraftDiffs()) requestDraftDiff('prefs');
          else clearDraftDiffDecorations();
          // Ensure semantic token provider is installed once monaco is live.
          ensureVscodeRpcConnected();
        } catch (e) {
          console.warn('[Monaco] prefs_changed apply failed', e);
        }
      });

      editorSocket.on('editor:git_baselines', function(payload) {
        handleGitBaselinesSocketEvent(payload, applyGitBaselines);
      });

      editorSocket.on('editor:draft_diff', function(payload) {
        try {
          handleDraftDiffEvent(payload, currentPath, draftDiffRequestId, applyDraftDiffDecorations);
        } catch (e) {
          console.warn('[DraftDiff] handler failed', e);
        }
      });

      editorSocket.on('editor:cache_state', function(payload) {
        try {
          if (!isCacheStatePayloadForCurrentPath(payload, currentPath)) return;
          if (isCacheStateClean(payload)) {
            handleCleanCacheState({
              payload: payload,
              clearDraftDiffDecorationsFn: clearDraftDiffDecorations,
              getAutoSaveFn: getAutoSave,
              shouldSkipAutosaveFn: shouldSkipAutosaveBaselineRefresh,
              diffEditor: diffEditor,
              gitHeadModel: gitHeadModel,
              model: model,
              requestGitBaselinesFn: requestGitBaselines,
              resnapshotDraftBaselineFn: resnapshotDraftBaseline,
              monacoRef: monaco,
              setUnsavedTraceFn: _setUnsavedTrace,
            });
            return;
          }
          if (isCacheStateUnsaved(payload)) {
            handleUnsavedCacheState(payload, _setUnsavedTrace, requestDraftDiff);
          }
        } catch (_) {}
      });

      // Diagnostics from workbench adapter via server-side bridge (editor_ws).
      // This arrives over the already-connected Socket.IO, avoiding the vscode_api_ws race.
      editorSocket.on('editor:diagnostics', function(payload) {
        try {
          logDiagnosticsEvent(payload, model, currentPath, _absPathFromVscodeUri);
          applyDiagnosticsBridgeUpdate(payload, _applyDiagnosticsUpdate);
        } catch (_) {}
      });

      editorSocket.on('editor:workbench_open_file_response', function (data) {
        try { handleWorkbenchResponseEvent(data, _wbPending, clearTimeout); } catch (_) {}
      });

      editorSocket.on('editor:workbench_hover_response', function (data) {
        try { handleWorkbenchResponseEvent(data, _wbPending, clearTimeout); } catch (_) {}
      });

      editorSocket.on('editor:workbench_symbols_response', function (data) {
        try { handleWorkbenchResponseEvent(data, _wbPending, clearTimeout); } catch (_) {}
      });

      editorSocket.on('editor:workbench_completions_response', function (data) {
        try { handleWorkbenchResponseEvent(data, _wbPending, clearTimeout); } catch (_) {}
      });

      editorSocket.on('editor:workbench_semantic_tokens_response', function (data) {
        try { handleWorkbenchResponseEvent(data, _wbPending, clearTimeout); } catch (_) {}
      });

      editorSocket.on('editor:workbench_semantic_tokens_legend_response', function (data) {
        try { handleWorkbenchResponseEvent(data, _wbPending, clearTimeout); } catch (_) {}
      });

      editorSocket.on('editor:workbench_semantic_tokens_range_response', function (data) {
        try { handleWorkbenchResponseEvent(data, _wbPending, clearTimeout); } catch (_) {}
      });

      editorSocket.on('editor:workbench_folding_ranges_response', function (data) {
        try { handleWorkbenchResponseEvent(data, _wbPending, clearTimeout); } catch (_) {}
      });

      editorSocket.on('editor:workbench_grammars_list_response', function (data) {
        try { handleWorkbenchResponseEvent(data, _wbPending, clearTimeout); } catch (_) {}
      });

      editorSocket.on('editor:workbench_grammars_load_response', function (data) {
        try { handleWorkbenchResponseEvent(data, _wbPending, clearTimeout); } catch (_) {}
      });

      // Push-based: adapter notifies when a semantic tokens provider registers.
      // Cache the legend but DON'T register the Monaco provider yet — wait for
      // diagnostics to prove the language server has analyzed the file first.
      editorSocket.on('editor:semantic_tokens_provider_registered', function (data) {
        try { handleSemanticTokensProviderRegistered(data, languageBridge, _registerSemanticTokensWithLegend); } catch (_) {}
      });

      editorSocket.on('editor:issues_dump_request', function(payload) {
        try {
          handleIssuesDumpRequest(payload, monaco, model, emitToHost);
        } catch (e) {
          console.warn('[Monaco] issues dump response failed', e);
        }
      });

      editorSocket.on('editor:issues_cmd', function(payload) {
        try { handleIssuesCommand(payload, editor, runIssuesCommand); } catch (_) {}
      });

      editorSocket.on('editor:find_cmd', function(payload) {
        try { handleFindCommand(payload, editor, runFindCommand); } catch (e) { console.error('[Find] error:', e); }
      });

      return true;
    } catch (e) {
      console.warn('[Monaco] socket connect failed', e);
      return false;
    }
  }

  function installScrollPublisher() {
    try {
      if (!canInstallScrollPublisher(editor, installScrollPublisher._done)) return;
      installScrollPublisher._done = true;

      var lastSentAt = 0;
      var pendingT = null;

      var send = function() {
        pendingT = null;
        try {
          if (!editorSocket || !editorSocket.connected) return;
          if (!currentPath || !model) return;
          var payload = buildScrollStatePayload(editor, currentPath);
          if (!payload) return;
          editorSocket.emit('editor_scroll_state', payload);
          lastSentAt = Date.now();
          try { bcUpdateCursor(payload.cursorLine); } catch (_) {}
        } catch (_) {}
      };

      var schedule = function() {
        try {
          var now = Date.now();
          if (shouldSendScrollImmediately(now, lastSentAt, 400)) {
            send();
            return;
          }
          if (pendingT) return;
          pendingT = scheduleScrollSend(setTimeout, send, 450);
        } catch (_) {}
      };

      editor.onDidScrollChange(schedule);
      editor.onDidChangeCursorPosition(schedule);
    } catch (_) {}
  }

  function applyMirror(data) {
    if (!data) return;
    ensureEditor();
    ensureTouchSelection('mirror-pre');
    if (!editor) return;

    var nextPath = (typeof data.path === 'string' && data.path) ? data.path : null;
    if (!shouldApplyMirrorPath(currentPath, nextPath)) return;

    var content = (typeof data.content === 'string') ? data.content : '';
    try {
      applyMirrorContent(model, editor, content);
    } catch (_) {}

    ensureTouchSelection('mirror-post');
    setTimeout(function(){ ensureTouchSelection('mirror-tick'); }, 0);
  }

  // No host↔iframe postMessage bridge: all runtime communication uses /editor Socket.IO.

  // ─── TE2 Breadcrumb Bar ──────────────────────────────────
  var _bcEl = null;
  var _bcSymbols = [];
  var _bcLastPath = null;
  var _bcSymbolsSeq = 0;
  var _bcGetIcon = null; // seti-icons getIcon (loaded async)

  function bcInit() {
    _bcEl = initBreadcrumbElement(document);
    loadBreadcrumbIcons(function(path) { return import(path); }, function(getIcon) {
      _bcGetIcon = getIcon;
      if (_bcLastPath) _bcRender();
    }, function(e) { console.warn('[BC] seti-icons load failed:', e); });
  }

  function bcUpdatePath(absPath, deferSymbols) {
    if (!_bcEl) return;
    if (!shouldUpdateBreadcrumbPath(absPath, _bcLastPath, deferSymbols)) return;
    _bcLastPath = absPath;
    _bcSymbols = [];
    _bcRender();
    if (!deferSymbols) {
      _bcRequestSymbols(absPath);
    }
  }

  function _bcRequestSymbols(absPath, opts) {
    var generation = (opts && Number.isFinite(Number(opts.generation))) ? Number(opts.generation) : _wbCurrentGeneration();
    if (!editorSocket || !editorSocket.connected) return;
    if (!_wbIsBarrierOpen(absPath, generation)) {
      _wbQueueSymbols(absPath, generation);
      return;
    }
    var seq = ++_bcSymbolsSeq;
    var langId = resolveBreadcrumbSymbolsLangId(model, absPath, languageFromPath);
    // plaintext has no symbol provider and never will — skip to avoid
    // 8s timeout loops that trigger workbench re-opens and cursor resets.
    if (langId === 'plaintext') {
      _bcSymbols = [];
      _bcRender();
      return;
    }
    // TS/JS extensions can be slow to activate on mobile — give them extra time
    var tms = getBreadcrumbSymbolsTimeoutMs(langId);
    editorWorkbenchCall('symbols', {
      path: absPath,
      languageId: langId,
      generation: generation,
    }, { timeoutMs: tms }).then(function(result) {
      if (seq !== _bcSymbolsSeq) return; // stale
      if (generation !== _wbCurrentGeneration()) return; // stale generation
      if (String(absPath || '') !== String(currentPath || '')) return; // stale path
      // Unwrap adapter response: {ok, result: [...]} or raw array
      _bcSymbols = unwrapBreadcrumbSymbols(result);
      console.log('[BC] symbols received:', _bcSymbols.length, _bcSymbols.slice(0, 2));
      _bcRender();
    }).catch(function(e) { console.warn('[BC] symbols request failed:', e); });
  }

  function bcUpdateCursor(line) {
    if (!_bcEl || !_bcLastPath) return;
    _bcRender(line);
  }

  function _bcFindSymbolChain(symbols, line) {
    return findBreadcrumbSymbolChain(symbols, line, symbolRangeToLineBounds);
  }

  // Symbol kind -> codicon class + color (LSP SymbolKind values, VS Code-style colors)
  var _SYM_CODICON = {
    1:  ['codicon-symbol-file',           '#8b949e'], // File
    2:  ['codicon-symbol-module',         '#bc8cff'], // Module
    3:  ['codicon-symbol-namespace',      '#bc8cff'], // Namespace
    4:  ['codicon-symbol-package',        '#f0883e'], // Package
    5:  ['codicon-symbol-class',          '#f0883e'], // Class
    6:  ['codicon-symbol-method',         '#bc8cff'], // Method
    7:  ['codicon-symbol-property',       '#4da6ff'], // Property
    8:  ['codicon-symbol-field',          '#4da6ff'], // Field
    9:  ['codicon-symbol-constructor',    '#bc8cff'], // Constructor
    10: ['codicon-symbol-enum',           '#f0883e'], // Enum
    11: ['codicon-symbol-interface',      '#4da6ff'], // Interface
    12: ['codicon-symbol-function',       '#bc8cff'], // Function
    13: ['codicon-symbol-variable',       '#4da6ff'], // Variable
    14: ['codicon-symbol-constant',       '#4da6ff'], // Constant
    15: ['codicon-symbol-string',         '#f0883e'], // String
    16: ['codicon-symbol-number',         '#a6e22e'], // Number
    17: ['codicon-symbol-boolean',        '#4da6ff'], // Boolean
    18: ['codicon-symbol-array',          '#f0883e'], // Array
    19: ['codicon-symbol-object',         '#8b949e'], // Object
    22: ['codicon-symbol-enum-member',    '#f0883e'], // EnumMember
    23: ['codicon-symbol-struct',         '#f0883e'], // Struct
    25: ['codicon-symbol-operator',       '#8b949e'], // Operator
    26: ['codicon-symbol-type-parameter', '#a6e22e'], // TypeParameter
  };

  function _bcSymbolSvg(kind) {
    return breadcrumbSymbolIcon(kind, _SYM_CODICON);
  }

  function _bcRender(cursorLine) {
    if (!_bcEl) return;
    _bcEl.innerHTML = '';
    if (!_bcLastPath) return;

    var parts = splitBreadcrumbPathParts(_bcLastPath);
    var accum = '';

    for (var i = 0; i < parts.length; i++) {
      accum += '/' + parts[i];
      if (i > 0) {
        appendBreadcrumbSeparator(document, _bcEl);
      }
      var isFile = isBreadcrumbFileSegment(i, parts.length);
      var item = createBreadcrumbPathItem(document, accum, isFile);
      // Add seti icon for the file segment
      if (isFile && _bcGetIcon) {
        var iconSpan = document.createElement('span');
        iconSpan.className = 'te2-bc-icon';
        item.appendChild(iconSpan);
        applyBreadcrumbFileIcon(_bcGetIcon, iconSpan, parts[i], getBreadcrumbIconTheme());
      }
      var label = document.createElement('span');
      label.textContent = parts[i];
      item.appendChild(label);
      item.addEventListener('click', _bcOnPathClick);
      _bcEl.appendChild(item);
    }

    // Symbol chain based on cursor
    if (shouldRenderBreadcrumbSymbolChain(_bcSymbols, cursorLine)) {
      var chain = _bcFindSymbolChain(_bcSymbols, cursorLine);
      for (var j = 0; j < chain.length; j++) {
        appendBreadcrumbSeparator(document, _bcEl);
        var sitem = createBreadcrumbSymbolItem(document, chain[j], j, _bcSymbolSvg(chain[j].kind));
        var symRange = chain[j].selectionRange || chain[j].range;
        if (symRange) {
          var pos = getBreadcrumbSymbolPosition(symRange);
          sitem.dataset.line = String(pos.line);
          sitem.dataset.col = String(pos.col);
        }
        sitem.addEventListener('click', _bcOnSymbolClick);
        _bcEl.appendChild(sitem);
      }
    }
    // Auto-scroll to show the rightmost (active) item
    finalizeBreadcrumbScroll(_bcEl);
  }

  function _bcOnPathClick(ev) {
    try {
      var target = getBreadcrumbPathClickTarget(ev);
      var isFile = target.isFile;
      if (isFile) return; // file segment = no-op (already open)
      // Directory click → emit to editor socket, which relays to explorer
      var absDir = target.absDir;
      console.log('[BC] path click:', absDir, 'socket connected:', !!(editorSocket && editorSocket.connected));
      if (editorSocket && editorSocket.connected) {
        editorSocket.emit('editor_breadcrumb_navigate', { path: absDir, open_drawer: true });
      }
    } catch (_) {}
  }

  function _bcOnSymbolClick(ev) {
    try {
      var p = getBreadcrumbSymbolClickPosition(ev);
      var line = p.line;
      var col = p.col;
      if (Number.isFinite(line)) {
        applyJumpToLineAt(editor, model, { line: line, column: col, focus: true, scroll_y: 'center' });
      }
    } catch (_) {}
  }
  // ─── End Breadcrumb ──────────────────────────────────────

  // ─── UI IPC (frontend-to-frontend relay) ────────────────
  var uiIpcSocket = null;
  var consoleSocket = null;
  var _editorConsoleWorkerId = null;

  function _randomConsoleWorkerSuffix() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID().split('-')[0];
      }
    } catch (_) {}
    return Math.random().toString(36).slice(2, 10);
  }

  function _getEditorConsoleWorkerId() {
    if (_editorConsoleWorkerId) return _editorConsoleWorkerId;
    _editorConsoleWorkerId = 'editor_iframe:' + _randomConsoleWorkerSuffix();
    return _editorConsoleWorkerId;
  }

  function connectConsoleSocket(ioRef) {
    if (!ioRef) return null;
    return ioRef('/te2_console', {
      path: '/te2_console_ws/socket.io',
      transports: ['websocket'],
      query: {
        app_id: 'file_editor_cm6',
        source: 'editor_iframe_console',
        workerId: _getEditorConsoleWorkerId(),
      },
    });
  }

  function connectUIIPC() {
    try {
      if (!window.io) return;
      uiIpcSocket = connectUiIpcSocket(window.io);
      consoleSocket = connectConsoleSocket(window.io);
      uiIpcSocket.on('connect', function() {
        console.log('[UI_IPC] editor iframe connected');
      });
      uiIpcSocket.on('ui_event', function(data) {
        if (!data || typeof data !== 'object') return;
        if (data.type === 'adapter_state') {
          var status = data.status;
          console.log('[adapter_state] iframe received:', status);
          if (status === 'ready') {
            window.__te2AdapterReady = true;
            _replayOpenFileAfterBaton();
          } else if (status === 'error') {
            console.warn('[adapter_state] error:', data.error);
          }
        }
      });

      if (consoleSocket) {
        consoleSocket.on('connect', function() {
          console.log('[TE2_CONSOLE] editor iframe connected');
          registerConsoleWorker(consoleSocket, _getEditorConsoleWorkerId(), 'worker');
        });

        // Console bridge — monkey-patch console.* to emit on the framework-owned console bus
        _initEditorConsoleBridge(consoleSocket);
      }
    } catch (e) {
      console.warn('[UI_IPC] connect failed', e);
    }
  }

  // ─── Console bridge (inline for non-module iframe) ────────
  var _consoleBridgeActive = false;

  function _initEditorConsoleBridge(sock) {
    if (_consoleBridgeActive) return;
    var LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
    var workerId = _getEditorConsoleWorkerId();

    function safeSerialize(x) {
      return safeSerializeConsoleArg(x);
    }

    function serializeArg(a) {
      return serializeConsoleArg(a);
    }

    function emitLog(level, rawArgs) {
      emitConsoleLog(sock, workerId, level, rawArgs);
    }

    patchConsoleLevels(LEVELS, emitLog);

    installConsoleErrorHooks(window, emitLog);

    // Remote eval support
    sock.on('console:eval', function(msg) {
      handleConsoleEval(sock, workerId, msg);
    });

    _consoleBridgeActive = true;
    console.log('[console_bridge] editor iframe bridge active');
  }

  /** Call after editor/diffEditor is created to bind Ctrl+S and focus relay. */
  function bindUIIPCEditorHooks() {
    _bindEditorSaveKey();
    _bindEditorFocusRelay();
    _bindEditorMobileCtrlHelper();
  }

  function _bindEditorSaveKey() {
    try {
      var ed = (diffEditor && diffEditor.getModifiedEditor)
        ? diffEditor.getModifiedEditor()
        : editor;
      if (!ed || !window.monaco) return;
      bindSaveKeyCommand(ed, monaco, uiIpcSocket);
    } catch (_) {}
  }

  var _uiIpcFocusDisposable = null;
  var _mobileCtrlFocusDisposable = null;

  function _bindEditorFocusRelay() {
    try {
      if (_uiIpcFocusDisposable) {
        try { _uiIpcFocusDisposable.dispose(); } catch (_) {}
        _uiIpcFocusDisposable = null;
      }
      var ed = (diffEditor && diffEditor.getModifiedEditor)
        ? diffEditor.getModifiedEditor()
        : editor;
      if (!ed) {
        console.warn('[focus_relay] no editor instance — skipping bind');
        return;
      }
      _uiIpcFocusDisposable = bindFocusRelay(ed, function() { return uiIpcSocket; });
      console.log('[focus_relay] bound to editor widget');
    } catch (e) {
      console.warn('[focus_relay] bind failed', e);
    }
  }

  function _bindEditorMobileCtrlHelper() {
    try {
      if (_mobileCtrlFocusDisposable) {
        try { _mobileCtrlFocusDisposable.dispose(); } catch (_) {}
        _mobileCtrlFocusDisposable = null;
      }
      var ed = (diffEditor && diffEditor.getModifiedEditor)
        ? diffEditor.getModifiedEditor()
        : editor;
      if (!ed) {
        console.warn('[editor_ctrl_helper] no editor instance — skipping bind');
        return;
      }
      _mobileCtrlFocusDisposable = bindVendoredCtrlHelperFocus(ed, window.monaco);
      console.log('[editor_ctrl_helper] bound to editor widget');
    } catch (e) {
      console.warn('[editor_ctrl_helper] bind failed', e);
    }
  }
  // ─── End UI IPC ─────────────────────────────────────────

  async function bootMonaco() {
    try {
      // Load the pinned VS Code monaco-editor-core ESM build (served by the worker).
      // NOTE: This is the only supported Monaco source for TE2 right now.
      var base = (apiBase || '') + '/ui/monaco_vscode/esm';
      var langBase = (apiBase || '') + '/ui/monaco_vscode/lang';

      // Monaco ESM expects a global MonacoEnvironment.getWorker for editor services.
      // Provide worker entrypoints for Monaco language services + editor services.
      // Language workers are gated by the webWorkersEnabled UI preference (default OFF).
      window.MonacoEnvironment = {
        getWorker: function(_moduleId, _label) {
          var label = String(_label || '');
          var moduleId = String(_moduleId || '');

          // Language-specific worker labels
          var langWorkerMap = {
            'typescript': '/workers/ts.worker.js',
            'javascript': '/workers/ts.worker.js',
            'json': '/workers/json.worker.js',
            'css': '/workers/css.worker.js',
            'scss': '/workers/css.worker.js',
            'less': '/workers/css.worker.js',
            'html': '/workers/html.worker.js',
            'handlebars': '/workers/html.worker.js',
            'razor': '/workers/html.worker.js',
          };
          var isLangWorker = langWorkerMap.hasOwnProperty(label);

          // Read at call time — cachedPrefs is populated after bootMonaco fetches /state
          var wwEnabled = _languageWorkersEnabled();

          if (isLangWorker && !wwEnabled) {
            // Return a silent no-op worker — Monaco caches the client so this
            // runs once per label.  Requests never resolve, so built-in language
            // contributions (folding, validation, symbols) silently degrade
            // while the extension-host adapter handles everything.
            var noop = new Blob(['self.onmessage=function(){}'], {type:'application/javascript'});
            return new Worker(URL.createObjectURL(noop));
          }

          var url;
          if (isLangWorker) {
            url = langBase + langWorkerMap[label];
          } else {
            url = base + '/vs/editor/common/services/editorWebWorkerMain.bundle.js';
          }

          var wk = new Worker(url, { type: 'module' });
          var key = label + ':' + url.split('/').pop();
          if (!_workerLogOnce[key]) {
            _workerLogOnce[key] = true;
            console.log('[MonacoWorker]', { moduleId: moduleId, label: label, url: url });
          }
          wk.onerror = function(ev) { console.error('[MonacoWorker] error', { moduleId: moduleId, label: label, ev: ev }); };
          wk.onmessageerror = function(ev) { console.error('[MonacoWorker] messageerror', { moduleId: moduleId, label: label, ev: ev }); };
          return wk;
        },
      };

      var monacoNs = null;
      // Fetch SSOT prefs before bundle import.
      try { cachedPrefs = await fetchSSOTState(); } catch (_) {}
      var bundleName = 'monaco.bootstrap.bundle.js';
      var bundled = await import(langBase + '/bootstrap/' + bundleName);
      monacoNs = await bundled.loadMonaco();
      window._loadedMonacoBundle = bundleName;
      console.log('[Monaco] loaded ' + bundleName);

      window.monaco = monacoNs;
      ensureTe2DiffTheme();

      // TS/JS worker diagnostics — ext host is the sole diagnostics source.
      // When TS contribution is available in the bootstrap bundle, disable worker diagnostics.
      try {
        var tsLang = monacoNs.languages.typescript;
        if (tsLang && tsLang.typescriptDefaults) {
          tsLang.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
          tsLang.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
          console.log('[Monaco] TS/JS worker diagnostics disabled');
        }
      } catch (e) { console.warn('[Monaco] TS/JS diagnostics config failed', e); }

      try { await loadVscodeTextmateThemes(); } catch (_) {}
      try { await applyMonacoTheme('github-dark-default'); } catch (_) {}

      // Initialize editor strictly from SSOT.
      await ensureEditorWithPrefs();
      try { installVscodeApiLanguageBridgeProviders(); } catch (_) {}

      try {
        // vscode_api bootstrap snapshot — deprecated, kept for backward compat.
        try {
          window.__te2VscodeBootstrap = await vscodeApiCall('vscode.bootstrap.snapshot', {});
        } catch (_) {}

        applyActiveModelLanguage(window, model, currentPath, applyLanguageToModel, languageFromPath);
        var langs = collectBootLanguageIds(monaco);
        warnIfPlaintextOnlyLanguages(langs);
      } catch (_) {}

      // Connect editor Socket.IO transport (required for readiness chain + SSOT).
      connectEditorSocket();

      // Connect UI IPC Socket.IO (frontend-to-frontend relay for iframe ↔ main page).
      connectUIIPC();

      // Phase 0: connect vscode_rpc (semantic tokens via TS LSP).
      // Best-effort: this is optional, but should be available when the shell is running.
      try { ensureVscodeRpcConnected(); } catch (_) {}

      emitToHost('editor_ready', {});
      updateDebug('boot=ok');
    } catch (e) {
      console.error('[Monaco] boot failed', e);
      updateDebug('boot=fail');
    }
  }

  updateDebug('boot=init');
  bcInit();
  bootMonaco();
})();
