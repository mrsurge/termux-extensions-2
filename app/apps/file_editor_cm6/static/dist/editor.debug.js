"use strict";
(() => {
  // monaco_editor/editor_common_utils.js
  function buildUiUrl(apiBase, relPath) {
    var p = String(relPath || "").replace(/^\/+/, "");
    return String(apiBase || "") + "/ui/" + p;
  }
  function wsUrlFromPath(locationObj, p) {
    try {
      var proto = locationObj && locationObj.protocol === "https:" ? "wss:" : "ws:";
      var host = locationObj ? locationObj.host : "localhost";
      var pathOnly = String(p || "");
      if (!pathOnly.startsWith("/")) pathOnly = "/" + pathOnly;
      return proto + "//" + host + pathOnly;
    } catch (_) {
      return null;
    }
  }
  async function fetchJsonWithBase(fetchImpl, apiBase, path, options) {
    var url = String(apiBase || "") + String(path || "");
    var resp = await fetchImpl(url, options || { cache: "no-store" });
    var json = null;
    try {
      json = await resp.json();
    } catch (_) {
    }
    if (!resp.ok || json && json.ok === false) {
      var msg = json && (json.error || json.detail) ? json.error || json.detail : "HTTP " + resp.status;
      throw new Error(msg);
    }
    return json && (json.data || json) ? json.data || json : json;
  }

  // monaco_editor/editor_language_utils.js
  function normalizeLanguageId(lang) {
    if (!lang) return "plaintext";
    var s = String(lang).toLowerCase();
    if (s === "text") return "plaintext";
    if (s === "shell") return "shell";
    if (s === "cpp") return "cpp";
    return s;
  }
  function languageIdFromPath(path, byFilename, byExtension) {
    try {
      var p = String(path || "").toLowerCase();
      try {
        var full = String(path || "");
        var base = full.split("/").pop() || full;
        if (byFilename && byFilename.size) {
          var byName = byFilename.get(base);
          if (byName) return normalizeLanguageId(byName);
        }
        if (byExtension && byExtension.size) {
          var best = null;
          var bestLen = 0;
          for (const [ext, langId] of byExtension.entries()) {
            if (!ext || typeof ext !== "string") continue;
            if (!langId) continue;
            if (p.endsWith(ext.toLowerCase()) && ext.length > bestLen) {
              best = langId;
              bestLen = ext.length;
            }
          }
          if (best) return normalizeLanguageId(best);
        }
      } catch (_) {
      }
      if (p.endsWith(".py") || p.endsWith(".pyw")) return "python";
      if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs")) return "javascript";
      if (p.endsWith(".ts") || p.endsWith(".tsx")) return "typescript";
      if (p.endsWith(".c")) return "c";
      if (p.endsWith(".cc") || p.endsWith(".cpp") || p.endsWith(".cxx") || p.endsWith(".h") || p.endsWith(".hh") || p.endsWith(".hpp") || p.endsWith(".hxx")) return "cpp";
      if (p.endsWith(".kt") || p.endsWith(".kts")) return "kotlin";
      if (p.endsWith(".html") || p.endsWith(".htm")) return "html";
      if (p.endsWith(".css")) return "css";
      if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "json";
      if (p.endsWith(".md") || p.endsWith(".mdx")) return "markdown";
      if (p.endsWith(".sh") || p.endsWith(".bash") || p.endsWith(".zsh")) return "shell";
      if (p.endsWith(".yml") || p.endsWith(".yaml")) return "yaml";
      return "plaintext";
    } catch (_) {
      return "plaintext";
    }
  }
  function monacoFileUri(monacoObj, absPath) {
    try {
      if (!monacoObj || !monacoObj.Uri || !monacoObj.Uri.file) return null;
      return monacoObj.Uri.file(String(absPath || ""));
    } catch (_) {
      return null;
    }
  }

  // monaco_editor/editor_parse_utils.js
  function expandShortHex(color) {
    if (!color || typeof color !== "string") return color;
    var m = color.match(/^#([0-9a-fA-F]{3,4})$/);
    if (!m) return color;
    var s = m[1];
    if (s.length === 3) return "#" + s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length === 4) return "#" + s[0] + s[0] + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return color;
  }
  function toMonacoColorHex(hex) {
    if (!hex) return null;
    var s = String(hex).trim();
    if (!s) return null;
    if (s[0] === "#") s = s.slice(1);
    if (!/^[0-9a-fA-F]{3,8}$/.test(s)) return null;
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length === 4) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return s.toUpperCase();
  }
  function parseJsonc(text) {
    var s = String(text || "");
    if (s.charCodeAt(0) === 65279) s = s.slice(1);
    s = s.replace(/\/\*[\s\S]*?\*\//g, "");
    s = s.replace(/(^|[^:])\/\/.*$/gm, "$1");
    s = s.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(s);
  }

  // monaco_editor/editor_trace_utils.js
  function setUnsavedTrace(trace, reason, unsaved, onSync) {
    try {
      var r = reason != null ? String(reason) : "-";
      trace.unsaved_reason = r + ":" + (unsaved ? "1" : "0");
      onSync();
    } catch (_) {
    }
  }
  function noteGitBaselineRequest(trace, source, immediate, onSync) {
    try {
      var src = source != null ? String(source) : "unknown";
      trace.gb_req_total += 1;
      if (immediate) trace.gb_req_immediate += 1;
      else trace.gb_req_debounced += 1;
      trace.gb_last_source = src + (immediate ? ":imm" : ":deb");
      onSync();
    } catch (_) {
    }
  }

  // monaco_editor/editor_model_utils.js
  function createFileModel(monacoObj, fileUriFactory, content, lang, absPath, onAfterCreate) {
    var m;
    try {
      var uri = fileUriFactory(absPath);
      if (uri) m = monacoObj.editor.createModel(content || "", lang || "plaintext", uri);
    } catch (_) {
    }
    if (!m) m = monacoObj.editor.createModel(content || "", lang || "plaintext");
    try {
      onAfterCreate();
    } catch (_) {
    }
    return m;
  }

  // monaco_editor/editor_debug_utils.js
  function setDebugPart(debugParts, key, value, updateDebug) {
    debugParts[key] = value || null;
    updateDebug();
  }
  function syncTraceDebug(trace, setDebugTrace) {
    setDebugTrace(
      "trace=mb" + trace.mirror_bind_total + "/a" + trace.mirror_active + " us=" + trace.unsaved_reason + " gb=" + trace.gb_req_total + "/" + trace.gb_req_immediate + "/" + trace.gb_req_debounced + " src=" + trace.gb_last_source
    );
  }
  function syncMirrorDebug(mirrorState, setDebugMirror) {
    setDebugMirror(
      "mir=rx" + mirrorState.rx + "/ap" + mirrorState.ap + "/self" + mirrorState.drop_self + "/sha" + mirrorState.drop_sha + "/hot" + mirrorState.drop_hot
    );
  }

  // monaco_editor/editor_command_utils.js
  function runIssuesCommand(editor, action) {
    try {
      if (!editor) return;
      var id = "editor.action.marker.next";
      if (action === "toggle") action = "next";
      if (action === "prev") id = "editor.action.marker.prev";
      var act = editor.getAction ? editor.getAction(id) : null;
      if (act && act.run) act.run();
    } catch (_) {
    }
  }
  function runFindCommand(editor, action, onError) {
    try {
      if (!editor) return;
      var act = editor.getAction ? editor.getAction("actions.find") : null;
      if (act && act.run) act.run();
      else editor.trigger("keyboard", "actions.find", null);
      if (action === "replace") {
        setTimeout(function() {
          try {
            editor.trigger("keyboard", "editor.action.startFindReplaceAction", null);
          } catch (_) {
          }
        }, 50);
      }
    } catch (e) {
      try {
        onError(e);
      } catch (_) {
      }
    }
  }

  // monaco_editor/editor_api_base_utils.js
  function deriveApiBase(locationObj) {
    try {
      var p = String(locationObj && locationObj.pathname ? locationObj.pathname : "");
      var idx = p.indexOf("/ui/");
      return idx >= 0 ? p.slice(0, idx) : "";
    } catch (_) {
      return "";
    }
  }

  // monaco_editor/editor_vscode_uri_utils.js
  function absPathFromVscodeUri(raw) {
    try {
      if (!raw) return "";
      if (typeof raw === "object") {
        if (raw.fsPath) return String(raw.fsPath);
        if (raw.path) return String(raw.path);
        if (raw.external) return absPathFromVscodeUri(String(raw.external));
        if (raw.scheme && raw.authority && raw.path) return String(raw.path);
        if (raw.scheme && raw.path) return String(raw.path);
        return "";
      }
      var s = String(raw);
      if (s[0] === "/" || /^[A-Za-z]:[\\/]/.test(s)) return s;
      if (s.indexOf("file://") === 0) return decodeURIComponent(s.slice("file://".length));
      if (s.indexOf("vscode-remote://") === 0) {
        var rest = s.slice("vscode-remote://".length);
        var slash = rest.indexOf("/");
        if (slash === -1) return "";
        return decodeURIComponent(rest.slice(slash));
      }
      var u = new URL(s);
      if (u && u.pathname) return decodeURIComponent(u.pathname || "");
    } catch (_) {
    }
    return "";
  }

  // monaco_editor/editor_bridge_utils.js
  function monacoRangeFromProtoRange(monacoObj, range) {
    try {
      if (!range || !monacoObj || !monacoObj.Range) return null;
      var sl = Math.max(1, Number(range.startLineNumber || 1));
      var sc = Math.max(1, Number(range.startColumn || 1));
      var el = Math.max(1, Number(range.endLineNumber || sl));
      var ec = Math.max(1, Number(range.endColumn || sc));
      return new monacoObj.Range(sl, sc, el, ec);
    } catch (_) {
      return null;
    }
  }
  function toMonacoHoverContents(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (typeof c === "string") {
        out.push({ value: c });
      } else if (c && typeof c === "object") {
        if (typeof c.value === "string") out.push({ value: c.value });
        else if (typeof c.language === "string" && typeof c.value === "string") out.push({ value: "```" + c.language + "\n" + c.value + "\n```" });
      }
    }
    return out;
  }
  function isLanguageContextCurrent(ctx, nowCtx) {
    try {
      if (!ctx || !nowCtx) return false;
      return String(nowCtx.uri) === String(ctx.uri) && Number(nowCtx.version || 0) === Number(ctx.version || -1);
    } catch (_) {
      return false;
    }
  }
  function monacoRangeFromCompletionRange(monacoObj, range, pos) {
    if (!range || !monacoObj) return void 0;
    if (range.insert || range.replace) {
      return {
        insert: monacoRangeFromProtoRange(monacoObj, range.insert) || new monacoObj.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        replace: monacoRangeFromProtoRange(monacoObj, range.replace) || new monacoObj.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column)
      };
    }
    return monacoRangeFromProtoRange(monacoObj, range) || new monacoObj.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
  }
  function mapCompletionItemKind(monacoObj, kind) {
    if (!monacoObj || !monacoObj.languages || !monacoObj.languages.CompletionItemKind) return kind || 0;
    return kind || 0;
  }

  // monaco_editor/editor_textmate_debug_utils.js
  function te2DumpTextmateScopesForLine(tmGrammarByLang, textmateObj, lang, text, ruleStack) {
    try {
      var grammar = tmGrammarByLang[lang];
      if (!grammar) return null;
      var rs = ruleStack || textmateObj.INITIAL;
      var res = grammar.tokenizeLine(String(text || ""), rs);
      var out = [];
      for (var i = 0; i < res.tokens.length; i++) {
        var t = res.tokens[i];
        out.push({
          startIndex: t.startIndex,
          endIndex: t.endIndex,
          scopes: (t.scopes || []).slice()
        });
      }
      return { tokens: out, ruleStack: res.ruleStack };
    } catch (_) {
      return null;
    }
  }
  function te2GetActiveEditorAndModel(diffEditor, editor) {
    try {
      if (diffEditor && diffEditor.getModifiedEditor) {
        var me = diffEditor.getModifiedEditor();
        if (me && me.getModel) return { editor: me, model: me.getModel(), side: "diff:modified" };
      }
    } catch (_) {
    }
    try {
      if (editor && editor.getModel) return { editor, model: editor.getModel(), side: "single" };
    } catch (_) {
    }
    return { editor: null, model: null, side: "none" };
  }
  function te2AdvanceRuleStackToLine(textmateObj, grammar, model, targetLine) {
    try {
      var maxLines = Math.min(Math.max(1, targetLine | 0), model.getLineCount());
      var rs = textmateObj.INITIAL;
      for (var ln = 1; ln < maxLines; ln++) {
        var line = model.getLineContent(ln);
        var step = grammar.tokenizeLine(String(line || ""), rs);
        rs = step.ruleStack;
      }
      return rs;
    } catch (_) {
      return textmateObj.INITIAL;
    }
  }

  // monaco_editor/editor_marker_nav_utils.js
  function installMarkerNavBindings(monacoObj, editorInstance, onJump) {
    try {
      if (!editorInstance || editorInstance.__te2MarkerNavBound || !monacoObj || !monacoObj.KeyMod || !monacoObj.KeyCode) return;
      editorInstance.__te2MarkerNavBound = true;
      editorInstance.addCommand(monacoObj.KeyMod.Alt | monacoObj.KeyCode.F8, function() {
        onJump(1);
      });
      editorInstance.addCommand(monacoObj.KeyMod.Alt | monacoObj.KeyMod.Shift | monacoObj.KeyCode.F8, function() {
        onJump(-1);
      });
    } catch (_) {
    }
  }
  function jumpToMarker(monacoObj, editorInstance, modelInstance, dir) {
    try {
      if (!editorInstance || !modelInstance || !monacoObj) return;
      var markers = monacoObj.editor.getModelMarkers({ resource: modelInstance.uri }) || [];
      if (!markers.length) return;
      markers.sort(function(a, b) {
        if (a.startLineNumber !== b.startLineNumber) return a.startLineNumber - b.startLineNumber;
        return a.startColumn - b.startColumn;
      });
      var pos = editorInstance.getPosition ? editorInstance.getPosition() : null;
      var line = pos && pos.lineNumber ? pos.lineNumber : 1;
      var col = pos && pos.column ? pos.column : 1;
      var idx = -1;
      if (dir > 0) {
        for (var i = 0; i < markers.length; i++) {
          var m = markers[i];
          if (m.startLineNumber > line || m.startLineNumber === line && m.startColumn > col) {
            idx = i;
            break;
          }
        }
        if (idx === -1) idx = 0;
      } else {
        for (var j = markers.length - 1; j >= 0; j--) {
          var m2 = markers[j];
          if (m2.startLineNumber < line || m2.startLineNumber === line && m2.startColumn < col) {
            idx = j;
            break;
          }
        }
        if (idx === -1) idx = markers.length - 1;
      }
      var hit = markers[idx];
      if (!hit) return;
      var targetLine = Math.max(1, Number(hit.startLineNumber || 1));
      var targetCol = Math.max(1, Number(hit.startColumn || 1));
      try {
        editorInstance.setPosition({ lineNumber: targetLine, column: targetCol });
      } catch (_) {
      }
      try {
        editorInstance.revealLineInCenter(targetLine, 0);
      } catch (_) {
      }
      try {
        editorInstance.focus();
      } catch (_) {
      }
    } catch (_) {
    }
  }

  // monaco_editor/editor_jump_utils.js
  function applyJumpToLine(editorInstance, modelInstance, payload) {
    try {
      if (!payload) return;
      if (!editorInstance || !modelInstance) return;
      var line = payload.line;
      var col = payload.column;
      if (typeof line === "string" && /^\d+$/.test(line)) line = parseInt(line, 10);
      if (typeof col === "string" && /^\d+$/.test(col)) col = parseInt(col, 10);
      if (!Number.isFinite(line)) return;
      line = Math.max(1, Math.min(modelInstance.getLineCount(), line));
      if (!Number.isFinite(col)) col = 1;
      col = Math.max(1, Math.min(modelInstance.getLineMaxColumn(line), col));
      var focus = payload.focus;
      var scrollY = payload.scroll_y;
      var scrollToTop = payload.scroll_to_top;
      if (scrollToTop) {
        try {
          editorInstance.revealLine(line, 0);
        } catch (_) {
        }
      } else if (typeof scrollY === "string" && String(scrollY).toLowerCase() === "center") {
        try {
          editorInstance.revealLineInCenter(line, 0);
        } catch (_) {
        }
      } else {
        try {
          editorInstance.revealLineNearTop(line, 0);
        } catch (_) {
        }
      }
      try {
        editorInstance.setPosition({ lineNumber: line, column: col });
      } catch (_) {
      }
      try {
        if (focus !== false) editorInstance.focus();
      } catch (_) {
      }
    } catch (_) {
    }
  }

  // monaco_editor/editor_theme_resolver_utils.js
  function resolveMonacoThemeId(themeKey, themeCache) {
    try {
      var key = String(themeKey || "").trim();
      if (themeCache && themeCache[key]) return key;
      if (key === "vs-dark" || key === "hc-black") return "github-dark-default";
      if (key === "vs" || key === "hc-light") return "github-light-default";
      var t = key.toLowerCase();
      if (t.includes("light")) return "github-light-default";
      return "github-dark-default";
    } catch (_) {
      return "github-dark-default";
    }
  }

  // monaco_editor/editor_socket_emit_utils.js
  function emitToHostSocket(editorSocket, eventName, payload) {
    try {
      if (!editorSocket || !editorSocket.connected) return false;
      editorSocket.emit(eventName, payload || {});
      return true;
    } catch (_) {
      return false;
    }
  }

  // monaco_editor/editor_pref_read_utils.js
  function getEditorPrefs(cachedPrefs) {
    return cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
  }
  function getBooleanPref(cachedPrefs, key) {
    try {
      var prefs = getEditorPrefs(cachedPrefs);
      if (prefs && prefs.editor && typeof prefs.editor[key] === "boolean") return prefs.editor[key];
      if (prefs && typeof prefs[key] === "boolean") return prefs[key];
    } catch (_) {
    }
    return false;
  }

  // monaco_editor/editor_pref_flags_utils.js
  function getShowInlineDiffsFlag(cachedPrefs) {
    return getBooleanPref(cachedPrefs, "showInlineDiffs");
  }
  function getShowDraftDiffsFlag(cachedPrefs, getAutoSaveFn) {
    if (typeof getAutoSaveFn === "function" && getAutoSaveFn()) return false;
    return getBooleanPref(cachedPrefs, "showDraftDiffs");
  }
  function getUseTrueInlineViewFlag(cachedPrefs) {
    return getBooleanPref(cachedPrefs, "useTrueInlineView");
  }
  function getAutoSaveFlag(cachedPrefs) {
    return getBooleanPref(cachedPrefs, "autoSave");
  }

  // monaco_editor/editor_timing_policy_utils.js
  function localMirrorDebounceMs(getAutoSaveFn) {
    return typeof getAutoSaveFn === "function" && getAutoSaveFn() ? 1e3 : 180;
  }
  function mirrorHotWindowMs(getAutoSaveFn) {
    return typeof getAutoSaveFn === "function" && getAutoSaveFn() ? 850 : 250;
  }
  function gitBaselineDebounceMs(getAutoSaveFn) {
    return typeof getAutoSaveFn === "function" && getAutoSaveFn() ? 320 : 180;
  }
  function gitBaselineApplyIdleMs(getAutoSaveFn, getShowInlineDiffsFn) {
    var autoSave = typeof getAutoSaveFn === "function" && getAutoSaveFn();
    var showInline = typeof getShowInlineDiffsFn === "function" && getShowInlineDiffsFn();
    return autoSave && showInline ? 1e3 : 0;
  }

  // monaco_editor/editor_workbench_state_utils.js
  function wbCurrentGeneration(wbFlow) {
    return Number(wbFlow && wbFlow.generation || 0);
  }
  function wbSetOpenAck(wbFlow, path, generation, currentGenerationFn) {
    if (!wbFlow) return;
    wbFlow.openAckPath = String(path || "");
    var fallback = typeof currentGenerationFn === "function" ? currentGenerationFn() : wbCurrentGeneration(wbFlow);
    wbFlow.openAckGeneration = Number.isFinite(Number(generation)) ? Number(generation) : fallback;
  }
  function wbQueueDidChange(wbFlow, path, text, languageId, generation, currentGenerationFn) {
    if (!wbFlow) return;
    var fallback = typeof currentGenerationFn === "function" ? currentGenerationFn() : wbCurrentGeneration(wbFlow);
    wbFlow.pendingDidChange = {
      path: String(path || ""),
      text: String(text || ""),
      languageId: String(languageId || ""),
      generation: Number.isFinite(Number(generation)) ? Number(generation) : fallback
    };
  }
  function wbQueueSymbols(wbFlow, path, generation, currentGenerationFn) {
    if (!wbFlow) return;
    var fallback = typeof currentGenerationFn === "function" ? currentGenerationFn() : wbCurrentGeneration(wbFlow);
    wbFlow.pendingSymbols = {
      path: String(path || ""),
      generation: Number.isFinite(Number(generation)) ? Number(generation) : fallback
    };
  }

  // monaco_editor/editor_workbench_barrier_utils.js
  function isAdapterReady(win) {
    return !!(win && win.__te2AdapterReady);
  }
  function wbIsFrameworkReady(editor, model, currentPath) {
    return !!(editor && model && currentPath);
  }
  function wbIsBarrierOpen(opts) {
    var o = opts || {};
    if (!isAdapterReady(o.win)) return false;
    if (!wbIsFrameworkReady(o.editor, o.model, o.currentPath)) return false;
    var wantPath = String(o.path || o.currentPath || "");
    var wantGen = Number.isFinite(Number(o.generation)) ? Number(o.generation) : Number(o.currentGeneration || 0);
    return Number(o.wbFlow && o.wbFlow.openAckGeneration || -1) === wantGen && String(o.wbFlow && o.wbFlow.openAckPath || "") === wantPath;
  }

  // monaco_editor/editor_workbench_emit_utils.js
  function wbEmitDidChange(editorSocket, payload, currentGenerationFn) {
    try {
      if (!editorSocket || !editorSocket.connected) return false;
      if (!payload || !payload.path) return false;
      var fallback = typeof currentGenerationFn === "function" ? currentGenerationFn() : 0;
      editorSocket.emit("editor_workbench_did_change", {
        path: payload.path,
        text: String(payload.text || ""),
        languageId: String(payload.languageId || ""),
        generation: Number.isFinite(Number(payload.generation)) ? Number(payload.generation) : fallback
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  // monaco_editor/editor_workbench_generation_utils.js
  function wbBumpGeneration(wbFlow, path, reason) {
    if (!wbFlow) return 0;
    wbFlow.generation = wbCurrentGeneration(wbFlow) + 1;
    wbFlow.activePath = String(path || "");
    wbFlow.openAckGeneration = -1;
    wbFlow.openAckPath = "";
    wbFlow.pendingDidChange = null;
    wbFlow.pendingSymbols = null;
    try {
      console.log("[workbench-flow] generation=" + wbFlow.generation + " reason=" + String(reason || "unknown") + " path=" + wbFlow.activePath);
    } catch (_) {
    }
    return wbFlow.generation;
  }

  // monaco_editor/editor_workbench_flush_utils.js
  function wbFlushDidChangeIfReady(wbFlow, isBarrierOpenFn, emitDidChangeFn) {
    var pending = wbFlow && wbFlow.pendingDidChange;
    if (!pending) return;
    if (!(typeof isBarrierOpenFn === "function" && isBarrierOpenFn(pending.path, pending.generation))) return;
    wbFlow.pendingDidChange = null;
    if (typeof emitDidChangeFn === "function") emitDidChangeFn(pending);
  }
  function wbFlushSymbolsIfReady(wbFlow, isBarrierOpenFn, requestSymbolsFn) {
    var pending = wbFlow && wbFlow.pendingSymbols;
    if (!pending) return;
    if (!(typeof isBarrierOpenFn === "function" && isBarrierOpenFn(pending.path, pending.generation))) return;
    wbFlow.pendingSymbols = null;
    if (typeof requestSymbolsFn === "function") requestSymbolsFn(pending.path, { generation: pending.generation, fromQueue: true });
  }
  function wbFlushPendingAfterOpen(flushDidChangeFn, flushSymbolsFn) {
    if (typeof flushDidChangeFn === "function") flushDidChangeFn();
    if (typeof flushSymbolsFn === "function") flushSymbolsFn();
  }
  function wbPublishDidChange(wbFlow, path, text, languageId, generation, currentGenerationFn, isBarrierOpenFn, emitDidChangeFn, queueDidChangeFn) {
    var fallback = typeof currentGenerationFn === "function" ? currentGenerationFn() : 0;
    var payload = {
      path: String(path || ""),
      text: String(text || ""),
      languageId: String(languageId || ""),
      generation: Number.isFinite(Number(generation)) ? Number(generation) : fallback
    };
    if (typeof isBarrierOpenFn === "function" && isBarrierOpenFn(payload.path, payload.generation)) {
      return typeof emitDidChangeFn === "function" ? emitDidChangeFn(payload) : false;
    }
    if (typeof queueDidChangeFn === "function") queueDidChangeFn(payload.path, payload.text, payload.languageId, payload.generation);
    return false;
  }

  // monaco_editor/editor_monaco_options_utils.js
  function buildMonacoOptionsFromPrefsState(state, jsonCache) {
    var prefs = null;
    try {
      prefs = state && state.preferences ? state.preferences : state;
    } catch (_) {
    }
    var editorPrefs = null;
    try {
      editorPrefs = prefs && prefs.editor ? prefs.editor : prefs && prefs.preferences && prefs.preferences.editor ? prefs.preferences.editor : null;
    } catch (_) {
    }
    try {
      if (!editorPrefs && prefs && typeof prefs.showLineNumbers === "boolean") editorPrefs = prefs;
      if (!editorPrefs && state && typeof state.showLineNumbers === "boolean") editorPrefs = state;
      if (!editorPrefs) editorPrefs = {};
    } catch (_) {
      editorPrefs = editorPrefs || {};
    }
    var showLineNumbers = true;
    try {
      if (typeof editorPrefs.showLineNumbers === "boolean") showLineNumbers = editorPrefs.showLineNumbers;
    } catch (_) {
    }
    var wordWrap = false;
    try {
      if (typeof editorPrefs.wordWrap === "boolean") wordWrap = editorPrefs.wordWrap;
    } catch (_) {
    }
    var readOnly = false;
    try {
      if (typeof editorPrefs.readOnly === "boolean") readOnly = editorPrefs.readOnly;
    } catch (_) {
    }
    var showMinimap = true;
    try {
      if (typeof editorPrefs.showMinimap === "boolean") showMinimap = editorPrefs.showMinimap;
    } catch (_) {
    }
    var showIndentGuides = true;
    try {
      if (typeof editorPrefs.showIndentGuides === "boolean") showIndentGuides = editorPrefs.showIndentGuides;
    } catch (_) {
    }
    var autoCloseBrackets = true;
    try {
      if (typeof editorPrefs.autoCloseBrackets === "boolean") autoCloseBrackets = editorPrefs.autoCloseBrackets;
    } catch (_) {
    }
    var autocompletion = true;
    try {
      if (typeof editorPrefs.autocompletion === "boolean") autocompletion = editorPrefs.autocompletion;
    } catch (_) {
    }
    var fontSize = 14;
    try {
      if (typeof editorPrefs.fontScale === "number" && isFinite(editorPrefs.fontScale)) {
        var s = editorPrefs.fontScale;
        if (s > 0 && s < 10) fontSize = Math.round(14 * s);
        else if (s >= 10 && s <= 48) fontSize = Math.round(s);
      }
    } catch (_) {
    }
    var fontFamily = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    try {
      if (typeof editorPrefs.fontFamily === "string" && editorPrefs.fontFamily.trim()) {
        fontFamily = editorPrefs.fontFamily.trim();
      }
    } catch (_) {
    }
    var rawThemeKey = "";
    try {
      rawThemeKey = String(editorPrefs.theme || "");
    } catch (_) {
      rawThemeKey = "";
    }
    var theme = "vs-dark";
    try {
      if (rawThemeKey && rawThemeKey.toLowerCase().startsWith("vscode:")) {
        theme = "vs-dark";
      } else {
        theme = resolveMonacoThemeId(rawThemeKey, jsonCache || {});
      }
    } catch (_) {
      theme = "vs-dark";
    }
    return {
      value: "",
      language: "plaintext",
      theme,
      "semanticHighlighting.enabled": true,
      automaticLayout: true,
      contextmenu: false,
      readOnly,
      lineNumbers: showLineNumbers ? "on" : "off",
      showFoldingControls: "always",
      wordWrap: wordWrap ? "on" : "off",
      minimap: { enabled: !!showMinimap },
      renderIndentGuides: !!showIndentGuides,
      autoClosingBrackets: autoCloseBrackets ? "always" : "never",
      quickSuggestions: autocompletion ? { other: true, comments: true, strings: true } : false,
      suggestOnTriggerCharacters: !!autocompletion,
      wordBasedSuggestions: autocompletion ? "currentDocument" : "off",
      parameterHints: { enabled: !!autocompletion },
      tabCompletion: autocompletion ? "on" : "off",
      fontSize,
      fontFamily
    };
  }

  // monaco_editor/editor_diff_theme_utils.js
  function ensureTe2DiffThemeApplied(win, doneFlag) {
    try {
      if (!win || !win.monaco || !win.monaco.editor || !win.monaco.editor.defineTheme) return doneFlag;
      if (doneFlag) return doneFlag;
      win.monaco.editor.defineTheme("te2-vs-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "diffEditor.insertedLineBackground": "rgba(46, 160, 67, 0.18)",
          "diffEditor.insertedTextBackground": "rgba(46, 160, 67, 0.28)",
          "diffEditor.removedLineBackground": "rgba(248, 81, 73, 0.14)",
          "diffEditor.removedTextBackground": "rgba(248, 81, 73, 0.24)",
          "diffEditor.border": "rgba(255, 255, 255, 0.10)",
          "diffEditor.diagonalFill": "rgba(255, 255, 255, 0.04)"
        }
      });
      return true;
    } catch (_) {
      return doneFlag;
    }
  }

  // monaco_editor/editor_theme_url_utils.js
  function getVscodeThemeJsonUrl(themeId, themeRegistry, apiBase) {
    var id = String(themeId || "");
    if (themeRegistry && themeRegistry[id] && themeRegistry[id].serveUrl) {
      return buildUiUrl(apiBase, themeRegistry[id].serveUrl);
    }
    var vendoredMap = {
      "github-dark-default": "dark-default.json",
      "github-light-default": "light-default.json",
      "github-dark": "dark.json",
      "github-light": "light.json",
      "github-dark-dimmed": "dark-dimmed.json",
      "github-dark-high-contrast": "dark-high-contrast.json",
      "github-light-high-contrast": "light-high-contrast.json",
      "github-dark-colorblind-beta": "dark-colorblind.json",
      "github-light-colorblind-beta": "light-colorblind.json"
    };
    if (vendoredMap[id]) {
      return buildUiUrl(apiBase, "monaco_editor/themes/vendored/github/" + vendoredMap[id]);
    }
    return null;
  }

  // monaco_editor/editor_theme_rules_utils.js
  function vscodeTokenColorsToMonacoRules(tokenColors) {
    var rules = [];
    if (!Array.isArray(tokenColors)) return rules;
    for (var i = 0; i < tokenColors.length; i++) {
      var tc = tokenColors[i];
      if (!tc || !tc.settings) continue;
      var fg = toMonacoColorHex(tc.settings.foreground);
      var bg = toMonacoColorHex(tc.settings.background);
      var fontStyle = null;
      if (typeof tc.settings.fontStyle === "string") {
        fontStyle = tc.settings.fontStyle.trim();
      }
      var scopes = tc.scope;
      var scopeList = [];
      if (Array.isArray(scopes)) {
        scopeList = scopes;
      } else if (typeof scopes === "string") {
        scopeList = scopes.split(",");
      } else {
        continue;
      }
      for (var j = 0; j < scopeList.length; j++) {
        var rawScope = scopeList[j];
        if (rawScope == null) continue;
        var scopeStr = String(rawScope || "").trim();
        if (!scopeStr) continue;
        var parts = scopeStr.split(/\s+/g);
        for (var p = 0; p < parts.length; p++) {
          var scope = String(parts[p] || "").trim();
          if (!scope) continue;
          var rule = { token: scope };
          if (fg) rule.foreground = fg;
          if (bg) rule.background = bg;
          if (fontStyle) rule.fontStyle = fontStyle;
          if (rule.foreground || rule.background || rule.fontStyle) rules.push(rule);
        }
      }
    }
    return rules;
  }

  // monaco_editor/editor_semantic_token_rules_utils.js
  var SEMANTIC_TO_TM_SCOPES = {
    "comment": ["comment"],
    "string": ["string"],
    "keyword": ["keyword.control", "keyword"],
    "number": ["constant.numeric", "constant"],
    "regexp": ["constant.regexp", "constant"],
    "operator": ["keyword.operator", "keyword"],
    "namespace": ["entity.name.namespace", "entity.name", "entity"],
    "type": ["entity.name.type", "support.type", "entity.name", "entity"],
    "struct": ["entity.name.type.struct", "entity.name.type", "entity.name", "entity"],
    "class": ["entity.name.type.class", "entity.name.type", "support.class", "entity.name", "entity"],
    "interface": ["entity.name.type.interface", "entity.name.type", "entity.name", "entity"],
    "enum": ["entity.name.type.enum", "entity.name.type", "entity.name", "entity"],
    "typeParameter": ["entity.name.type.parameter", "entity.name.type", "entity.name", "entity"],
    "function": ["entity.name.function", "support.function", "entity.name", "entity"],
    "method": ["entity.name.function.member", "entity.name.function", "support.function", "entity.name", "entity"],
    "macro": ["entity.name.function.preprocessor", "entity.name.function", "entity.name", "entity"],
    "variable": ["variable.other.readwrite", "entity.name.variable", "variable.other", "variable"],
    "parameter": ["variable.parameter", "variable"],
    "property": ["variable.other.property", "variable.other", "variable"],
    "enumMember": ["variable.other.enummember", "variable.other", "variable"],
    "event": ["variable.other.event", "variable.other", "variable"],
    "decorator": ["entity.name.decorator", "entity.name.function", "entity.name", "entity"]
  };
  var SEMANTIC_MOD_TO_TM_SCOPES = {
    "variable.readonly": ["variable.other.constant", "variable.other", "variable"],
    "property.readonly": ["variable.other.constant.property", "variable.other.constant", "variable.other", "variable"],
    "variable.defaultLibrary": ["support.variable", "support"],
    "variable.defaultLibrary.readonly": ["support.constant", "support"],
    "property.defaultLibrary": ["support.variable.property", "support.variable", "support"],
    "function.defaultLibrary": ["support.function", "support"]
  };
  function buildSemanticTokenRules(tokenColors) {
    var scopeSettings = {};
    if (!Array.isArray(tokenColors)) return [];
    for (var i = 0; i < tokenColors.length; i++) {
      var tc = tokenColors[i];
      if (!tc || !tc.settings) continue;
      var scopes = tc.scope;
      var scopeList = Array.isArray(scopes) ? scopes : typeof scopes === "string" ? scopes.split(",") : [];
      for (var j = 0; j < scopeList.length; j++) {
        var s = String(scopeList[j] || "").trim();
        if (s) scopeSettings[s] = tc.settings;
      }
    }
    function resolve(tmScopes) {
      for (var k = 0; k < tmScopes.length; k++) {
        if (scopeSettings[tmScopes[k]]) return scopeSettings[tmScopes[k]];
      }
      return null;
    }
    var rules = [];
    function addRule(token, settings) {
      if (!settings) return;
      var r = { token };
      var fg = toMonacoColorHex(settings.foreground);
      if (fg) r.foreground = fg;
      if (typeof settings.fontStyle === "string") r.fontStyle = settings.fontStyle.trim();
      if (r.foreground || r.fontStyle) rules.push(r);
    }
    for (var semType in SEMANTIC_TO_TM_SCOPES) {
      if (!Object.prototype.hasOwnProperty.call(SEMANTIC_TO_TM_SCOPES, semType)) continue;
      addRule(semType, resolve(SEMANTIC_TO_TM_SCOPES[semType]));
    }
    for (var semMod in SEMANTIC_MOD_TO_TM_SCOPES) {
      if (!Object.prototype.hasOwnProperty.call(SEMANTIC_MOD_TO_TM_SCOPES, semMod)) continue;
      addRule(semMod, resolve(SEMANTIC_MOD_TO_TM_SCOPES[semMod]));
    }
    return rules;
  }

  // monaco_editor/editor_theme_convert_utils.js
  function vscodeThemeToMonacoTheme(themeId, vscodeJson) {
    var themeKey = String(themeId || "");
    var uiTheme = null;
    try {
      uiTheme = vscodeJson && typeof vscodeJson.uiTheme === "string" ? vscodeJson.uiTheme : null;
    } catch (_) {
    }
    var isLight = false;
    try {
      if (uiTheme) isLight = String(uiTheme).toLowerCase().includes("light");
      else isLight = themeKey.toLowerCase().includes("light");
    } catch (_) {
      isLight = themeKey.toLowerCase().includes("light");
    }
    var tokenColors = vscodeJson && vscodeJson.tokenColors ? vscodeJson.tokenColors : [];
    var colorsIn = vscodeJson && vscodeJson.colors ? vscodeJson.colors : {};
    var colors = {};
    try {
      for (var k in colorsIn) {
        if (!Object.prototype.hasOwnProperty.call(colorsIn, k)) continue;
        var v = colorsIn[k];
        if (typeof v === "string") colors[k] = expandShortHex(v);
      }
    } catch (_) {
    }
    return {
      base: isLight ? "vs" : "vs-dark",
      inherit: true,
      rules: vscodeTokenColorsToMonacoRules(tokenColors).concat(buildSemanticTokenRules(tokenColors)),
      colors
    };
  }

  // monaco_editor/editor_debug_message_utils.js
  function buildDebugMessage(dbg, editor, debugParts, extra) {
    if (!dbg) return "";
    var hasExt = !!(window["monaco-touch-selection"] && window["monaco-touch-selection"].editorTouchSelectionHelp);
    var og = editor && editor.getDomNode ? editor.getDomNode().querySelector(".overflow-guard") : null;
    var msg = "ext=" + (hasExt ? "yes" : "no") + " og=" + (og ? "yes" : "no");
    if (extra) debugParts.extra = extra;
    if (debugParts.git) msg += " " + debugParts.git;
    if (debugParts.draft) msg += " " + debugParts.draft;
    if (debugParts.diag) msg += " " + debugParts.diag;
    if (debugParts.flags) msg += " " + debugParts.flags;
    if (debugParts.mirror) msg += " " + debugParts.mirror;
    if (debugParts.trace) msg += " " + debugParts.trace;
    if (debugParts.extra) msg += " " + debugParts.extra;
    return msg;
  }

  // monaco_editor/editor_line_number_utils.js
  function applyLineNumberSizingForEditors(editor, diffEditor, model, gitHeadModel, gitDiskModel) {
    try {
      if (!editor || !window.monaco) return;
      var maxLines = 1;
      try {
        if (model && model.getLineCount) maxLines = Math.max(maxLines, model.getLineCount());
      } catch (_) {
      }
      try {
        if (gitHeadModel && gitHeadModel.getLineCount) maxLines = Math.max(maxLines, gitHeadModel.getLineCount());
      } catch (_) {
      }
      try {
        if (gitDiskModel && gitDiskModel.getLineCount) maxLines = Math.max(maxLines, gitDiskModel.getLineCount());
      } catch (_) {
      }
      var digits = String(maxLines || 1).length;
      var minChars = Math.max(4, digits + 1);
      if (diffEditor && diffEditor.getOriginalEditor && diffEditor.getModifiedEditor) {
        var diffMin = Math.max(4, digits + 1);
        try {
          diffEditor.getOriginalEditor().updateOptions({ lineNumbersMinChars: diffMin });
        } catch (_) {
        }
        try {
          diffEditor.getModifiedEditor().updateOptions({ lineNumbersMinChars: diffMin });
        } catch (_) {
        }
        try {
          editor.updateOptions({ lineNumbersMinChars: diffMin });
        } catch (_) {
        }
      } else {
        try {
          editor.updateOptions({ lineNumbersMinChars: minChars });
        } catch (_) {
        }
      }
    } catch (_) {
    }
  }

  // monaco_editor/editor_theme_registry_state_utils.js
  async function ensureThemeRegistryState(state, fetchFn, buildUiUrlFn, apiBase) {
    if (state && state.registry) return state.registry;
    if (state && state.promise) return state.promise;
    state.promise = (async function() {
      try {
        var res = await fetchFn(buildUiUrlFn(apiBase, "monaco_editor/available_themes"), { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        var data = await res.json();
        var themes = data && data.themes ? data.themes : [];
        var reg = {};
        for (var i = 0; i < themes.length; i++) {
          var t = themes[i];
          if (t && t.id && t.serveUrl) reg[t.id] = t;
        }
        state.registry = reg;
        return reg;
      } catch (e) {
        console.warn("[MonacoTheme] _ensureThemeRegistry failed", e);
        state.registry = {};
        return state.registry;
      } finally {
        state.promise = null;
      }
    })();
    return state.promise;
  }

  // monaco_editor/editor_theme_loader_runtime_utils.js
  async function loadVscodeTextmateThemesRuntime(opts) {
    var o = opts || {};
    if (o.state && o.state.done) return;
    if (!o.win || !o.win.monaco || !o.win.monaco.editor || !o.win.monaco.editor.defineTheme) return;
    if (o.state && o.state.promise) return o.state.promise;
    o.state.promise = (async function() {
      if (!o.state.jsonCache) o.state.jsonCache = {};
      var reg = await o.ensureThemeRegistryFn();
      var themeIds = Object.keys(reg || {});
      if (!themeIds.length) themeIds = ["github-dark-default", "github-light-default"];
      for (var i = 0; i < themeIds.length; i++) {
        var id = themeIds[i];
        var url = o.getThemeJsonUrlFn(id);
        if (!url) continue;
        try {
          var res = await o.fetchFn(url, { cache: "no-store" });
          if (!res.ok) {
            console.warn("[MonacoTheme] missing vscode theme", id, res.status);
            continue;
          }
          var json = await res.json();
          o.state.jsonCache[id] = json;
          var monacoTheme = o.toMonacoThemeFn(id, json);
          o.win.monaco.editor.defineTheme(id, monacoTheme);
          console.log("[MonacoTheme] loaded vscode theme", id, "rules=", monacoTheme.rules.length);
        } catch (e) {
          console.warn("[MonacoTheme] failed vscode theme", id, e);
        }
      }
      o.state.done = true;
    })();
    return o.state.promise;
  }

  // monaco_editor/editor_theme_apply_runtime_utils.js
  async function applyMonacoThemeRuntime(opts) {
    var o = opts || {};
    try {
      if (!o.win || !o.win.monaco || !o.win.monaco.editor || !o.win.monaco.editor.setTheme) return null;
      if (typeof o.ensureTe2DiffThemeFn === "function") o.ensureTe2DiffThemeFn();
      try {
        if (typeof o.loadThemesFn === "function") await o.loadThemesFn();
      } catch (_) {
      }
      var cache = o.getJsonCacheFn ? o.getJsonCacheFn() || {} : {};
      var resolvedId = o.resolveThemeIdFn ? o.resolveThemeIdFn(o.themeKey, cache) : String(o.themeKey || "");
      if (!cache[resolvedId]) {
        var url = o.getThemeJsonUrlFn ? o.getThemeJsonUrlFn(resolvedId) : null;
        if (url) {
          try {
            var res = await o.fetchFn(url, { cache: "no-store" });
            if (res.ok) {
              var json = await res.json();
              cache[resolvedId] = json;
              var monacoTheme = o.toMonacoThemeFn(resolvedId, json);
              o.win.monaco.editor.defineTheme(resolvedId, monacoTheme);
            }
          } catch (_) {
          }
        }
      }
      if (o.setJsonCacheFn) o.setJsonCacheFn(cache);
      o.win.monaco.editor.setTheme(resolvedId);
      try {
        o.doc.documentElement.classList.remove("vs", "vs-dark", "hc-black", "hc-light");
        var base = cache[resolvedId] && cache[resolvedId].uiTheme || "";
        if (!base) base = resolvedId.toLowerCase().includes("light") ? "vs" : "vs-dark";
        else if (base.includes("light")) base = "vs";
        else base = "vs-dark";
        o.doc.documentElement.classList.add(base);
        console.log("[touch-theme] html class set to", base, "for theme", resolvedId);
      } catch (_) {
      }
      if (cache[resolvedId]) {
        if (typeof o.applyThemeToTextmateRegistryFn === "function") o.applyThemeToTextmateRegistryFn(cache[resolvedId]);
        return cache[resolvedId];
      }
      return null;
    } catch (e) {
      console.warn("[Monaco] applyMonacoTheme failed", e);
      return null;
    }
  }

  // monaco_editor/editor_git_baseline_request_utils.js
  function requestGitBaselinesDebounced(opts) {
    var o = opts || {};
    try {
      var immediate = !!o.immediate;
      var reason = o.reason ? String(o.reason) : "unknown";
      if (typeof o.noteRequestFn === "function") o.noteRequestFn(reason, immediate);
      if (immediate) {
        if (o.timer) o.clearTimeoutFn(o.timer);
        if (typeof o.setTimerFn === "function") o.setTimerFn(null);
        return typeof o.emitNowFn === "function" ? o.emitNowFn() : false;
      }
      if (o.timer) o.clearTimeoutFn(o.timer);
      var next = o.setTimeoutFn(function() {
        if (typeof o.setTimerFn === "function") o.setTimerFn(null);
        try {
          if (typeof o.emitNowFn === "function") o.emitNowFn();
        } catch (_) {
        }
      }, Number(o.debounceMs || 180));
      if (typeof o.setTimerFn === "function") o.setTimerFn(next);
      return true;
    } catch (_) {
      return false;
    }
  }

  // monaco_editor/editor_readonly_input_mode_utils.js
  function syncReadOnlyInputMode(ed, monacoRef, docRef) {
    try {
      if (!ed) return;
      var dom = ed.getDomNode && ed.getDomNode();
      if (!dom) return;
      var ta = dom.querySelector("textarea.inputarea") || dom.querySelector("textarea");
      if (!ta) return;
      var ro = ed.getOption(monacoRef.editor.EditorOption.readOnly);
      ta.setAttribute("inputmode", ro ? "none" : "text");
      if (ro && ta === docRef.activeElement) ta.blur();
    } catch (_) {
    }
  }

  // monaco_editor/editor_config_change_utils.js
  function onEditorConfigChanged(ed, opts) {
    var o = opts || {};
    if (typeof o.syncReadOnlyInputModeFn === "function") o.syncReadOnlyInputModeFn(ed);
    try {
      if (!ed) return;
      var ro = ed.getOption(o.monacoRef.editor.EditorOption.readOnly);
      if (o.lastKnownReadOnly !== null && ro !== o.lastKnownReadOnly) {
        o.fetchFn("/api/app/file_editor_cm6/editor/update_preference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "readOnly", value: ro })
        }).catch(function(e) {
          console.warn("[Monaco] readOnly pref save failed", e);
        });
      }
      if (typeof o.setLastKnownReadOnlyFn === "function") o.setLastKnownReadOnlyFn(ro);
    } catch (_) {
    }
  }

  // monaco_editor/editor_draft_zone_clear_utils.js
  function clearDraftDiffZonesState(editor, draftZoneIds) {
    try {
      if (!editor || !editor.changeViewZones) {
        return [];
      }
      if (!draftZoneIds || !draftZoneIds.length) return [];
      editor.changeViewZones(function(accessor) {
        for (var i = 0; i < draftZoneIds.length; i++) {
          try {
            accessor.removeZone(draftZoneIds[i]);
          } catch (_) {
          }
        }
      });
    } catch (_) {
    }
    return [];
  }

  // monaco_editor/editor_draft_decorations_clear_utils.js
  function clearDraftDiffDecorationsState(opts) {
    var o = opts || {};
    try {
      if (typeof o.clearZonesFn === "function") o.clearZonesFn();
      if (o.draftDecoCollection && o.draftDecoCollection.clear) {
        o.draftDecoCollection.clear();
      } else if (o.editor && o.editor.deltaDecorations) {
        o.draftDecoIds = o.editor.deltaDecorations(o.draftDecoIds || [], []);
      }
    } catch (_) {
    }
    if (typeof o.setDebugDraftFn === "function") o.setDebugDraftFn(null);
    return {
      draftDecoIds: o.draftDecoIds || [],
      lastDraftZones: null
    };
  }

  // monaco_editor/editor_vscode_api_start_utils.js
  async function startVscodeApiService(fetchFn) {
    var startResp = await fetchFn("/api/app/file_editor_cm6/vscode_api/start", { cache: "no-store" });
    var startJson = null;
    try {
      startJson = await startResp.json();
    } catch (_) {
    }
    if (!startResp.ok || startJson && startJson.ok === false) {
      var startMsg = startJson && (startJson.error || startJson.detail) ? startJson.error || startJson.detail : "HTTP " + startResp.status;
      throw new Error("vscode_api start failed: " + startMsg);
    }
  }

  // monaco_editor/editor_vscode_api_discover_utils.js
  async function discoverVscodeApiWsPath(fetchFn, setTimeoutFn) {
    var json = null;
    var resp = null;
    for (var attempt = 0; attempt < 25; attempt++) {
      resp = await fetchFn("/api/app/file_editor_cm6/vscode_api/discover", { cache: "no-store" });
      json = null;
      try {
        json = await resp.json();
      } catch (_) {
      }
      if (resp.ok && !(json && json.ok === false)) break;
      if (resp.status === 503) {
        await new Promise(function(r) {
          setTimeoutFn(r, 120);
        });
        continue;
      }
      var msg0 = json && (json.error || json.detail) ? json.error || json.detail : "HTTP " + resp.status;
      throw new Error(msg0);
    }
    if (!resp || !resp.ok || json && json.ok === false) {
      var msg = json && (json.error || json.detail) ? json.error || json.detail : resp ? "HTTP " + resp.status : "unknown";
      throw new Error("vscode_api discover failed: " + msg);
    }
    var wsPath = null;
    try {
      wsPath = json && json.data && json.data.ws_url ? json.data.ws_url : json && json.ws_url ? json.ws_url : null;
    } catch (_) {
    }
    if (!wsPath) throw new Error("vscode_api discover missing ws_url");
    return wsPath;
  }

  // monaco_editor/editor_vscode_api_ws_url_utils.js
  function buildVscodeApiWsUrl(loc, wsPath) {
    var proto = loc.protocol === "https:" ? "wss" : "ws";
    return proto + "://" + loc.host + wsPath;
  }

  // monaco_editor/editor_vscode_api_message_utils.js
  function handleVscodeApiMessageData(rawData, pendingMap, handlersMap) {
    var msg = null;
    try {
      msg = JSON.parse(String(rawData || ""));
    } catch (_) {
      return;
    }
    var handleOne = function(m) {
      if (!m) return;
      var id = m.id;
      if (id != null) {
        var pending = pendingMap.get(id);
        if (!pending) return;
        pendingMap.delete(id);
        if (m.error) pending.reject(new Error(m.error.message || "jsonrpc error"));
        else pending.resolve(m.result);
        return;
      }
      try {
        if (m.method && handlersMap && handlersMap.has(m.method)) {
          handlersMap.get(m.method)(m.params);
        }
      } catch (_) {
      }
    };
    if (Array.isArray(msg)) msg.forEach(handleOne);
    else handleOne(msg);
  }

  // monaco_editor/editor_vscode_api_close_utils.js
  function rejectAndClearVscodeApiPending(pendingMap, reason) {
    try {
      pendingMap.forEach(function(p) {
        try {
          p.reject(new Error(reason || "vscode_api ws closed"));
        } catch (_) {
        }
      });
      pendingMap.clear();
    } catch (_) {
    }
  }

  // monaco_editor/editor_vscode_api_call_request_utils.js
  function createVscodeApiCallPromise(pendingMap, id, method, timeoutMs, setTimeoutFn) {
    return new Promise(function(resolve, reject) {
      pendingMap.set(id, { resolve, reject });
      setTimeoutFn(function() {
        if (!pendingMap.has(id)) return;
        pendingMap.delete(id);
        reject(new Error("vscode_api timeout: " + method));
      }, timeoutMs);
    });
  }

  // monaco_editor/editor_vscode_api_notify_utils.js
  function vscodeApiNotify(ws, method, params) {
    try {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: String(method || ""), params: params || {} }));
      return true;
    } catch (_) {
      return false;
    }
  }

  // monaco_editor/editor_vscode_api_payload_utils.js
  function buildVscodeApiRequestPayload(id, method, params) {
    return { jsonrpc: "2.0", id, method: String(method || ""), params: params || {} };
  }

  // monaco_editor/editor_vscode_languages_source_utils.js
  async function getVscodeLanguagesList(win, vscodeApiCallFn) {
    var langs = null;
    try {
      if (win && win.__te2VscodeBootstrap && Array.isArray(win.__te2VscodeBootstrap.languages)) {
        langs = win.__te2VscodeBootstrap.languages;
      }
    } catch (_) {
    }
    if (!Array.isArray(langs)) {
      var res = await vscodeApiCallFn("vscode.languages.list", {});
      langs = res && res.languages ? res.languages : [];
    }
    return Array.isArray(langs) ? langs : [];
  }

  // monaco_editor/editor_vscode_language_matchers_reset_utils.js
  function resetVscodeLanguageMatchers(extensionMap, filenameMap) {
    try {
      extensionMap.clear();
    } catch (_) {
    }
    try {
      filenameMap.clear();
    } catch (_) {
    }
  }

  // monaco_editor/editor_vscode_language_register_utils.js
  function registerVscodeLanguageId(monacoRef, knownIdsSet, langId, langDef) {
    try {
      if (knownIdsSet.has(langId)) return;
      try {
        monacoRef.languages.register({
          id: langId,
          aliases: Array.isArray(langDef.aliases) ? langDef.aliases : void 0,
          extensions: Array.isArray(langDef.extensions) ? langDef.extensions : void 0,
          filenames: Array.isArray(langDef.filenames) ? langDef.filenames : void 0,
          mimetypes: Array.isArray(langDef.mimetypes) ? langDef.mimetypes : void 0
        });
      } catch (_) {
      }
      knownIdsSet.add(langId);
    } catch (_) {
    }
  }

  // monaco_editor/editor_vscode_language_extensions_utils.js
  function mapVscodeLanguageExtensions(extensionMap, extensions, langId) {
    try {
      if (!Array.isArray(extensions)) return;
      for (var j = 0; j < extensions.length; j++) {
        var ext = String(extensions[j] || "").trim();
        if (!ext) continue;
        extensionMap.set(ext, langId);
      }
    } catch (_) {
    }
  }

  // monaco_editor/editor_vscode_language_filenames_utils.js
  function mapVscodeLanguageFilenames(filenameMap, filenames, langId) {
    try {
      if (!Array.isArray(filenames)) return;
      for (var j = 0; j < filenames.length; j++) {
        var name = String(filenames[j] || "").trim();
        if (!name) continue;
        filenameMap.set(name, langId);
      }
    } catch (_) {
    }
  }

  // monaco_editor/editor_vscode_language_config_utils.js
  function applyVscodeLanguageConfiguration(monacoRef, langId, configurationRaw, parseJsoncFn) {
    try {
      if (!configurationRaw) return;
      var cfg = parseJsoncFn(String(configurationRaw));
      if (cfg && typeof cfg === "object") {
        try {
          monacoRef.languages.setLanguageConfiguration(langId, cfg);
        } catch (_) {
        }
      }
    } catch (e) {
      console.warn("[VSIX][Languages] config parse failed", langId, e);
    }
  }

  // monaco_editor/editor_vscode_languages_install_loop_utils.js
  function installVscodeLanguagesLoop(langs, normalizeLanguageFn, onLanguageFn) {
    for (var i = 0; i < langs.length; i++) {
      var l = langs[i];
      if (!l || !l.id) continue;
      var langId = normalizeLanguageFn(l.id);
      if (!langId) continue;
      onLanguageFn(l, langId);
    }
  }

  // monaco_editor/editor_vscode_languages_finalize_utils.js
  function finalizeVscodeLanguagesInstall(langs, extensionMap, filenameMap, installBridgeProvidersFn) {
    try {
      installBridgeProvidersFn();
    } catch (_) {
    }
    console.log("[VSIX][Languages] installed", langs.length, "ext=", extensionMap.size, "files=", filenameMap.size);
  }

  // monaco_editor/editor_open_autosave_pref_utils.js
  function resolveAutoSaveFromPrefs(cachedPrefs) {
    var autoSave = null;
    try {
      var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
      autoSave = prefs && prefs.editor && typeof prefs.editor.autoSave === "boolean" ? prefs.editor.autoSave : null;
    } catch (_) {
    }
    return autoSave;
  }

  // monaco_editor/editor_open_cache_fetch_utils.js
  async function fetchOpenCache(fetchJsonWithBaseFn, fetchFn, apiBase, absPath) {
    try {
      return await fetchJsonWithBaseFn(fetchFn, apiBase, "/editor/check_cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: absPath })
      });
    } catch (_) {
      return null;
    }
  }

  // monaco_editor/editor_open_content_resolve_utils.js
  async function resolveOpenContent(fetchJsonWithBaseFn, fetchFn, apiBase, absPath, cache) {
    var hasDraft = !!(cache && cache.has_draft);
    var content = "";
    var sha256 = null;
    if (hasDraft) {
      content = typeof cache.content === "string" ? cache.content : "";
      sha256 = cache.base_sha256 && typeof cache.base_sha256 === "string" ? cache.base_sha256 : null;
      return { hasDraft, content, sha256 };
    }
    var read = await fetchJsonWithBaseFn(fetchFn, apiBase, "/read?path=" + encodeURIComponent(absPath), { cache: "no-store" });
    content = typeof read.content === "string" ? read.content : "";
    sha256 = read.sha256 && typeof read.sha256 === "string" ? read.sha256 : null;
    return { hasDraft, content, sha256 };
  }

  // monaco_editor/editor_open_lang_resolve_utils.js
  function resolveOpenLanguage(preferredLanguage, absPath, normalizeLanguageFn, languageFromPathFn) {
    var lang = normalizeLanguageFn(preferredLanguage || "");
    if (!lang || lang.indexOf("/") >= 0) lang = languageFromPathFn(absPath);
    return lang;
  }

  // monaco_editor/editor_open_model_init_utils.js
  function initOpenModel(createFileModelFn, editor, content, lang, absPath, afterAttachFn) {
    var model = createFileModelFn(content || "", lang, absPath);
    editor.setModel(model);
    if (typeof afterAttachFn === "function") afterAttachFn(model, lang, absPath);
    return model;
  }

  // monaco_editor/editor_open_model_update_utils.js
  function shouldRecreateOpenModel(monacoRef, monacoFileUriFn, model, absPath) {
    try {
      var want = monacoFileUriFn(monacoRef, absPath);
      return !!(want && model && model.uri && String(model.uri.toString()) !== String(want.toString()));
    } catch (_) {
      return false;
    }
  }
  function applyOpenModelTextSafely(model, editor, content, setApplyingRemoteFn) {
    try {
      if (typeof setApplyingRemoteFn === "function") setApplyingRemoteFn(true);
      model.setValue(content || "");
    } catch (_) {
      editor.setValue(content || "");
    } finally {
      if (typeof setApplyingRemoteFn === "function") setApplyingRemoteFn(false);
    }
  }

  // monaco_editor/editor_open_emit_cache_state_utils.js
  function emitOpenCacheState(emitToHostFn, absPath, hasDraft, sha256, autoSave) {
    emitToHostFn("editor_cache_state", {
      path: absPath,
      state: hasDraft ? "mid_session" : "clean",
      unsaved: hasDraft,
      reason: hasDraft ? "restore" : "set_content",
      content_sha256: sha256,
      auto_save: autoSave
    });
    if (hasDraft) emitToHostFn("editor_draft_state", { has_draft: true, path: absPath });
  }

  // monaco_editor/editor_open_workbench_open_utils.js
  function queueBackendWorkbenchOpen(opts) {
    var o = opts || {};
    try {
      var reqId = "diag_" + Date.now() + "_backend";
      var text = o.model && o.model.getValue ? o.model.getValue() : "";
      o.queueDidChangeFn(o.currentPath, text, o.model && o.model.getLanguageId ? o.model.getLanguageId() : o.lang, o.generation);
      o.queueSymbolsFn(o.currentPath, o.generation);
      o.openFileFlowFn({
        path: o.currentPath,
        languageId: o.lang,
        uri: o.model && o.model.uri ? String(o.model.uri.toString()) : "",
        requestId: reqId,
        forceRefresh: true,
        generation: o.generation,
        source: "openPathFromBackend",
        timeoutMs: 8e3
      }).catch(function() {
      });
    } catch (_) {
    }
  }

  // monaco_editor/editor_mirror_payload_valid_utils.js
  function isMirrorPayloadValid(payload) {
    return !!(payload && payload.path && typeof payload.content === "string");
  }

  // monaco_editor/editor_mirror_source_drop_utils.js
  function shouldDropMirrorForSource(payload, editorSocketId) {
    return !!(payload && payload.source_client && editorSocketId && String(payload.source_client) === String(editorSocketId));
  }

  // monaco_editor/editor_mirror_path_drop_utils.js
  function shouldDropMirrorForPath(payloadPath, currentPath) {
    return !!(currentPath && String(payloadPath) !== String(currentPath));
  }

  // monaco_editor/editor_mirror_model_drop_utils.js
  function shouldDropMirrorForNoModel(model) {
    return !model;
  }

  // monaco_editor/editor_mirror_sha_drop_utils.js
  function shouldDropMirrorForSha(payloadSha, lastContentSha256, model, payloadContent) {
    if (payloadSha && lastContentSha256 && String(payloadSha) === String(lastContentSha256)) return true;
    if (model && model.getValue && model.getValue() === payloadContent) return true;
    return false;
  }

  // monaco_editor/editor_mirror_hot_drop_utils.js
  function shouldDropMirrorForHotWindow(lastLocalEditAt, nowMs, hotMs) {
    return !!(hotMs > 0 && lastLocalEditAt > 0 && nowMs - lastLocalEditAt < hotMs);
  }

  // monaco_editor/editor_mirror_apply_content_utils.js
  function applyMirrorContentToModel(model, content, setApplyingRemoteFn) {
    if (typeof setApplyingRemoteFn === "function") setApplyingRemoteFn(true);
    try {
      var fullRange = model.getFullModelRange();
      model.applyEdits([{ range: fullRange, text: content }]);
    } finally {
      if (typeof setApplyingRemoteFn === "function") setApplyingRemoteFn(false);
    }
  }

  // monaco_editor/editor_mirror_emit_cache_utils.js
  function emitMirrorCacheState(emitToHostFn, payload, mirrorUnsaved) {
    emitToHostFn("editor_cache_state", {
      path: payload.path,
      state: mirrorUnsaved ? "mid_session" : "clean",
      unsaved: mirrorUnsaved,
      reason: "mirror",
      content_sha256: payload.content_sha256
    });
    if (mirrorUnsaved) emitToHostFn("editor_draft_state", { has_draft: true, path: payload.path });
  }

  // monaco_editor/editor_socket_readiness_step_handler_utils.js
  function handleReadinessStep(data, emitToHostFn, onBatonReadyFn) {
    var step = data && data.step || "";
    var ok = data && data.ok;
    console.log("[readiness] step=" + step + " ok=" + ok + (data && data.error ? " error=" + data.error : ""));
    emitToHostFn("editor:readiness_step", data);
    if (step === "baton" && ok) onBatonReadyFn();
  }

  // monaco_editor/editor_socket_jump_handler_utils.js
  function handleJumpToLineEvent(editor, model, payload, applyJumpToLineFn) {
    try {
      applyJumpToLineFn(editor, model, payload);
    } catch (e) {
      console.warn("[Monaco] jump_to_line failed", e);
    }
  }

  // monaco_editor/editor_socket_draft_diff_handler_utils.js
  function handleDraftDiffEvent(payload, currentPath, draftDiffRequestId, applyDraftDiffDecorationsFn) {
    if (!payload || !payload.path || !currentPath) return;
    if (String(payload.path) !== String(currentPath)) return;
    if (payload.requestId && draftDiffRequestId && String(payload.requestId) !== String(draftDiffRequestId)) return;
    applyDraftDiffDecorationsFn(payload);
  }

  // monaco_editor/editor_socket_workbench_response_handler_utils.js
  function handleWorkbenchResponseEvent(data, wbPending, clearTimeoutFn) {
    var rid = data && data.request_id;
    var entry = wbPending.get(rid);
    if (!entry) return;
    wbPending.delete(rid);
    clearTimeoutFn(entry.timer);
    if (data && data.error) entry.reject(new Error(String(data.error)));
    else entry.resolve(data && data.result || data);
  }

  // monaco_editor/editor_socket_semantic_registered_handler_utils.js
  function handleSemanticTokensProviderRegistered(data, languageBridge, registerSemanticTokensFn) {
    var lang = data && data.language;
    var legend = data && data.legend;
    if (!lang || !legend || !legend.tokenTypes || !legend.tokenModifiers) return;
    if (languageBridge.registeredSemanticTokens.has(lang)) return;
    console.log("[semanticTokens] push cached legend for " + lang + " types=" + legend.tokenTypes.length + " mods=" + legend.tokenModifiers.length + " range=" + !!data.range);
    languageBridge.semanticTokensLegendCache[lang] = legend;
    if (data.range) languageBridge.semanticTokensRangeFlag[lang] = true;
    registerSemanticTokensFn(lang, legend, !!data.range);
  }

  // monaco_editor/editor_socket_issues_dump_handler_utils.js
  function handleIssuesDumpRequest(payload, monacoRef, model, emitToHostFn) {
    var requestId = payload && (payload.requestId || payload.request_id) ? String(payload.requestId || payload.request_id) : "";
    if (!requestId) return;
    var dump = {};
    try {
      if (monacoRef && model) {
        var markers = monacoRef.editor.getModelMarkers({ resource: model.uri }) || [];
        dump = { markers };
      }
    } catch (_) {
    }
    emitToHostFn("editor_issues_dump_response", { requestId, dump });
  }

  // monaco_editor/editor_socket_issues_cmd_handler_utils.js
  function handleIssuesCommand(payload, editor, runIssuesCommandFn) {
    var action = payload && payload.action ? String(payload.action) : "";
    if (!action) return;
    runIssuesCommandFn(editor, action);
  }

  // monaco_editor/editor_socket_find_cmd_handler_utils.js
  function handleFindCommand(payload, editor, runFindCommandFn) {
    var action = payload && payload.action ? String(payload.action) : "find";
    console.log("[Find] iframe received editor:find_cmd action=", action, "editor=", !!editor);
    runFindCommandFn(editor, action, function(e) {
      console.error("[Find] _runFindCommand error:", e);
    });
  }

  // monaco_editor/editor_cache_state_payload_utils.js
  function isCacheStatePayloadForCurrentPath(payload, currentPath) {
    if (!payload || !payload.path || !currentPath) return false;
    return String(payload.path) === String(currentPath);
  }
  function isCacheStateClean(payload) {
    return !!(payload && payload.unsaved === false);
  }
  function isCacheStateUnsaved(payload) {
    return !!(payload && payload.unsaved === true);
  }

  // monaco_editor/editor_cache_state_autosave_skip_utils.js
  function shouldSkipAutosaveBaselineRefresh(diffEditor, gitHeadModel, model) {
    var skip = false;
    if (diffEditor && diffEditor.getModel) {
      var dm = diffEditor.getModel();
      if (dm && dm.original === gitHeadModel && dm.modified === model && !!dm.te2AutosaveMode) {
        skip = true;
      }
    } else {
      skip = true;
    }
    return skip;
  }

  // monaco_editor/editor_cache_state_resnapshot_utils.js
  function resnapshotDraftBaseline(diffEditor, monacoRef, model) {
    if (!(diffEditor && diffEditor.getModel && diffEditor.setModel)) return;
    try {
      var dm = diffEditor.getModel();
      if (!(dm && dm.te2FreezeProjection && dm.modifiedBaseline)) return;
      var mvs = null;
      try {
        var me = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
        if (me) mvs = me.saveViewState();
      } catch (_) {
      }
      var freshContent = model.getValue ? model.getValue() : "";
      var freshLang = model.getLanguageId ? model.getLanguageId() : "plaintext";
      var freshBaseline = monacoRef.editor.createModel(freshContent, freshLang);
      diffEditor.setModel({
        original: dm.original,
        modified: dm.modified,
        modifiedBaseline: freshBaseline,
        te2AutosaveMode: false,
        te2FreezeProjection: true
      });
      try {
        if (mvs) {
          var me2 = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
          if (me2) me2.restoreViewState(mvs);
        }
      } catch (_) {
      }
      console.log("[GitBaselines] draft save: re-snapshotted modifiedBaseline");
    } catch (e) {
      console.warn("[GitBaselines] draft save baseline re-snapshot failed", e);
    }
  }

  // monaco_editor/editor_cache_state_clean_handler_utils.js
  function handleCleanCacheState(opts) {
    var o = opts || {};
    o.clearDraftDiffDecorationsFn();
    try {
      if (o.getAutoSaveFn()) {
        if (!o.shouldSkipAutosaveFn(o.diffEditor, o.gitHeadModel, o.model)) {
          o.requestGitBaselinesFn({ reason: "cache_state_clean_autosave" });
        }
      } else {
        o.resnapshotDraftBaselineFn(o.diffEditor, o.monacoRef, o.model);
        o.requestGitBaselinesFn({ immediate: true, reason: "cache_state_clean" });
      }
    } catch (_) {
    }
    o.setUnsavedTraceFn(o.payload && o.payload.reason || "cache_state", false);
  }

  // monaco_editor/editor_cache_state_unsaved_handler_utils.js
  function handleUnsavedCacheState(payload, setUnsavedTraceFn, requestDraftDiffFn) {
    setUnsavedTraceFn(payload && payload.reason || "cache_state", true);
    requestDraftDiffFn("cache_state");
  }

  // monaco_editor/editor_diagnostics_log_utils.js
  function logDiagnosticsEvent(payload, model, currentPath, absPathFromVscodeUriFn) {
    if (!payload || typeof payload !== "object") return;
    var ts = "";
    try {
      var t = typeof performance !== "undefined" && performance && typeof performance.now === "function" ? Math.round(performance.now() * 10) / 10 : null;
      ts = (t != null ? "t=" + t + "ms " : "") + "now=" + Date.now();
    } catch (_) {
      ts = "now=" + Date.now();
    }
    var modelUri = model && model.uri ? String(model.uri.toString()) : "";
    var activePath = currentPath ? String(currentPath) : absPathFromVscodeUriFn(modelUri);
    var payloadPath = payload.path ? String(payload.path) : "";
    console.log(
      ts,
      "[editor:diagnostics] rx",
      payload.type,
      "path=" + (payloadPath || "?"),
      "markers=" + (payload.markers || []).length,
      "currentPath=" + currentPath,
      "modelUri=" + modelUri,
      "activePath=" + activePath
    );
    if (payload.markers && payload.markers.length) {
      console.log("[editor:diagnostics] first 5 markers:", payload.markers.slice(0, 5));
    }
  }

  // monaco_editor/editor_diagnostics_apply_update_utils.js
  function applyDiagnosticsBridgeUpdate(payload, applyDiagnosticsUpdateFn) {
    if (!payload || payload.type !== "diagnostics/update") return;
    var items = [{ uri: "file://" + (payload.path || ""), markers: payload.markers || [] }];
    applyDiagnosticsUpdateFn({ owner: payload.owner || "workbench", items });
  }

  // monaco_editor/editor_git_baselines_socket_handler_utils.js
  function handleGitBaselinesSocketEvent(payload, applyGitBaselinesFn) {
    applyGitBaselinesFn(payload);
  }

  // monaco_editor/editor_breadcrumb_init_utils.js
  function initBreadcrumbElement(doc) {
    return doc.getElementById("te2-breadcrumbs");
  }

  // monaco_editor/editor_breadcrumb_icons_loader_utils.js
  function loadBreadcrumbIcons(dynamicImportFn, onLoaded, onError) {
    return dynamicImportFn("/static/vendor/seti-icons/seti-icons.js").then(function(mod) {
      mod.ensureLoaded();
      onLoaded(mod.getIcon);
    }).catch(function(e) {
      if (typeof onError === "function") onError(e);
    });
  }

  // monaco_editor/editor_breadcrumb_update_path_utils.js
  function shouldUpdateBreadcrumbPath(absPath, lastPath, deferSymbols) {
    if (!absPath) return false;
    if (absPath === lastPath && !deferSymbols) return false;
    return true;
  }

  // monaco_editor/editor_breadcrumb_symbols_lang_utils.js
  function resolveBreadcrumbSymbolsLangId(model, absPath, languageFromPathFn) {
    var langId = model && model.getLanguageId ? model.getLanguageId() : "";
    if (!langId) langId = languageFromPathFn(absPath) || "";
    return langId;
  }

  // monaco_editor/editor_breadcrumb_symbols_timeout_utils.js
  function getBreadcrumbSymbolsTimeoutMs(langId) {
    return langId === "javascript" || langId === "typescript" || langId === "javascriptreact" || langId === "typescriptreact" ? 15e3 : 8e3;
  }

  // monaco_editor/editor_breadcrumb_symbols_unwrap_utils.js
  function unwrapBreadcrumbSymbols(result) {
    var symbols = result;
    if (symbols && typeof symbols === "object" && !Array.isArray(symbols)) {
      symbols = symbols.result || symbols.symbols || [];
    }
    return Array.isArray(symbols) ? symbols : [];
  }

  // monaco_editor/editor_breadcrumb_symbol_range_utils.js
  function symbolRangeToLineBounds(r) {
    var startLine;
    var endLine;
    if (typeof r.startLineNumber === "number") {
      startLine = r.startLineNumber;
      endLine = r.endLineNumber || 999999;
    } else if (r.start && typeof r.start.line === "number") {
      startLine = r.start.line + 1;
      endLine = r.end && typeof r.end.line === "number" ? r.end.line + 1 : 999999;
    } else if (typeof r.startLine === "number") {
      startLine = r.startLine;
      endLine = r.endLine || 999999;
    } else if (Array.isArray(r) && r.length >= 3) {
      startLine = r[0] + 1;
      endLine = r[2] + 1;
    } else {
      return null;
    }
    return { startLine, endLine };
  }

  // monaco_editor/editor_breadcrumb_symbol_icon_utils.js
  function breadcrumbSymbolIcon(kind, symbolMap) {
    var entry = symbolMap[kind];
    var cls = entry ? entry[0] : "codicon-symbol-misc";
    var col = entry ? entry[1] : "#8b949e";
    return '<span class="codicon ' + cls + '" style="color:' + col + ';font-size:14px;line-height:1"></span>';
  }

  // monaco_editor/editor_scroll_publisher_guard_utils.js
  function canInstallScrollPublisher(editor, installedFlag) {
    if (!editor || !editor.onDidScrollChange || !editor.onDidChangeCursorPosition) return false;
    if (installedFlag) return false;
    return true;
  }

  // monaco_editor/editor_scroll_publisher_payload_utils.js
  function buildScrollStatePayload(editor, currentPath) {
    var pos = null;
    try {
      pos = editor.getPosition();
    } catch (_) {
      pos = null;
    }
    var line = pos && pos.lineNumber ? pos.lineNumber : null;
    var col = pos && pos.column ? pos.column : null;
    if (!line) return null;
    return { path: currentPath, line, column: col || 1, cursorLine: line };
  }

  // monaco_editor/editor_scroll_publisher_throttle_utils.js
  function shouldSendScrollImmediately(now, lastSentAt, thresholdMs) {
    return now - lastSentAt > thresholdMs;
  }

  // monaco_editor/editor_scroll_publisher_schedule_utils.js
  function scheduleScrollSend(setTimeoutFn, sendFn, delayMs) {
    return setTimeoutFn(sendFn, delayMs);
  }

  // monaco_editor/editor_apply_mirror_path_utils.js
  function shouldApplyMirrorPath(currentPath, nextPath) {
    if (currentPath && nextPath && String(nextPath) !== String(currentPath)) return false;
    return true;
  }

  // monaco_editor/editor_apply_mirror_content_utils.js
  function applyMirrorContent(model, editor, content) {
    if (model && model.getFullModelRange) {
      var range = model.getFullModelRange();
      model.applyEdits([{ range, text: content }]);
    } else if (model && model.setValue) {
      model.setValue(content);
    } else {
      editor.setValue(content);
    }
  }

  // monaco_editor/editor_ui_ipc_connect_utils.js
  function connectUiIpcSocket(ioRef) {
    if (!ioRef) return null;
    return ioRef("/ui_ipc", {
      path: "/ui_ipc_ws/socket.io",
      transports: ["websocket"],
      query: { app_id: "file_editor_cm6", source: "editor_iframe" }
    });
  }

  // monaco_editor/editor_ui_ipc_register_utils.js
  function registerConsoleWorker(sock, workerId, role) {
    if (!sock) return;
    sock.emit("console:register", { workerId, role });
  }

  // monaco_editor/editor_console_safe_serialize_utils.js
  function safeSerializeConsoleArg(x) {
    var seen = typeof WeakSet !== "undefined" ? /* @__PURE__ */ new WeakSet() : null;
    return JSON.stringify(x, function(_k, v) {
      if (typeof v === "bigint") return "BigInt(" + v.toString() + ")";
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      if (typeof v === "object" && v !== null && seen) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      return v;
    });
  }

  // monaco_editor/editor_console_serialize_arg_utils.js
  function serializeConsoleArg(a) {
    try {
      return JSON.parse(safeSerializeConsoleArg(a));
    } catch (_) {
      return String(a);
    }
  }

  // monaco_editor/editor_console_emit_log_utils.js
  function emitConsoleLog(sock, workerId, level, rawArgs) {
    if (!sock || !sock.connected) return;
    sock.emit("console:log", {
      workerId,
      level,
      ts: Date.now(),
      args: rawArgs.map(serializeConsoleArg)
    });
  }

  // monaco_editor/editor_console_patch_levels_utils.js
  function patchConsoleLevels(levels, emitLogFn) {
    var originals = {};
    for (var i = 0; i < levels.length; i++) {
      (function(level) {
        originals[level] = console[level].bind(console);
        console[level] = function() {
          var args = Array.prototype.slice.call(arguments);
          try {
            emitLogFn(level, args);
          } catch (_) {
          }
          return originals[level].apply(console, args);
        };
      })(levels[i]);
    }
    return originals;
  }

  // monaco_editor/editor_console_error_hooks_utils.js
  function installConsoleErrorHooks(win, emitLogFn) {
    win.addEventListener("error", function(e) {
      emitLogFn("error", [e.message, e.filename, e.lineno, e.colno, e.error || null]);
    });
    win.addEventListener("unhandledrejection", function(e) {
      emitLogFn("error", ["UnhandledRejection", e.reason]);
    });
  }

  // monaco_editor/editor_console_eval_handler_utils.js
  function handleConsoleEval(sock, workerId, msg) {
    if (!msg || !msg.reqId || !msg.code) return;
    try {
      var result = (0, eval)(msg.code);
      Promise.resolve(result).then(function(value) {
        sock.emit("console:evalResult", {
          workerId,
          reqId: msg.reqId,
          ok: true,
          value: serializeConsoleArg(value)
        });
      });
    } catch (err) {
      sock.emit("console:evalResult", {
        workerId,
        reqId: msg.reqId,
        ok: false,
        error: serializeConsoleArg(err)
      });
    }
  }

  // monaco_editor/editor_ui_ipc_save_key_utils.js
  function bindSaveKeyCommand(ed, monacoRef, uiIpcSocket) {
    if (!ed || !monacoRef) return;
    ed.addCommand(monacoRef.KeyMod.CtrlCmd | monacoRef.KeyCode.KeyS, function() {
      if (uiIpcSocket) uiIpcSocket.emit("ui_event", { type: "save" });
    });
  }

  // monaco_editor/editor_ui_ipc_focus_relay_utils.js
  function bindFocusRelay(ed, uiIpcSocket) {
    if (!ed) return null;
    var disposables = [];
    disposables.push(ed.onDidFocusEditorWidget(function() {
      console.log("[focus_relay] onDidFocusEditorWidget fired, socket=" + (uiIpcSocket ? uiIpcSocket.connected ? "connected" : "disconnected" : "null"));
      if (uiIpcSocket) uiIpcSocket.emit("ui_event", { type: "focus" });
    }));
    disposables.push(ed.onDidBlurEditorWidget(function() {
      console.log("[focus_relay] onDidBlurEditorWidget fired");
      if (uiIpcSocket) uiIpcSocket.emit("ui_event", { type: "blur" });
    }));
    return { dispose: function() {
      disposables.forEach(function(d) {
        d.dispose();
      });
    } };
  }

  // monaco_editor/editor_breadcrumb_find_symbol_chain_utils.js
  function findBreadcrumbSymbolChain(symbols, line, symbolRangeToLineBoundsFn) {
    var chain = [];
    var cur = symbols;
    while (cur && cur.length) {
      var found = null;
      for (var i = 0; i < cur.length; i++) {
        var s = cur[i];
        var r = s.range || s.location && s.location.range;
        if (!r) continue;
        var bounds = symbolRangeToLineBoundsFn(r);
        if (!bounds) continue;
        if (line >= bounds.startLine && line <= bounds.endLine) {
          found = s;
          break;
        }
      }
      if (!found) break;
      chain.push(found);
      cur = found.children || [];
    }
    return chain;
  }

  // monaco_editor/editor_breadcrumb_split_parts_utils.js
  function splitBreadcrumbPathParts(path) {
    return String(path || "").split("/").filter(Boolean);
  }

  // monaco_editor/editor_breadcrumb_append_sep_utils.js
  function appendBreadcrumbSeparator(doc, parentEl) {
    var sep = doc.createElement("span");
    sep.className = "te2-bc-sep";
    sep.textContent = "\u203A";
    parentEl.appendChild(sep);
  }

  // monaco_editor/editor_breadcrumb_is_file_segment_utils.js
  function isBreadcrumbFileSegment(index, total) {
    return index === total - 1;
  }

  // monaco_editor/editor_breadcrumb_create_path_item_utils.js
  function createBreadcrumbPathItem(doc, accumPath, isFile) {
    var item = doc.createElement("span");
    item.className = "te2-bc-item";
    item.dataset.path = accumPath;
    item.dataset.isFile = isFile ? "1" : "0";
    return item;
  }

  // monaco_editor/editor_breadcrumb_icon_theme_utils.js
  function getBreadcrumbIconTheme() {
    return {
      blue: "#4da6ff",
      green: "#a6e22e",
      red: "#f85149",
      orange: "#f0883e",
      yellow: "#e3b341",
      purple: "#bc8cff",
      pink: "#f778ba",
      white: "#e6edf3",
      grey: "#8b949e",
      "grey-light": "#b1bac4",
      ignore: "#6e7681"
    };
  }

  // monaco_editor/editor_breadcrumb_apply_icon_utils.js
  function applyBreadcrumbFileIcon(getIconFn, iconSpan, name, theme) {
    getIconFn(name, theme).then(function(ic) {
      if (ic && ic.svg) iconSpan.innerHTML = ic.svg;
      if (ic && ic.color) iconSpan.style.color = ic.color;
    }).catch(function() {
    });
  }

  // monaco_editor/editor_breadcrumb_should_render_symbols_utils.js
  function shouldRenderBreadcrumbSymbolChain(symbols, cursorLine) {
    return !!(symbols && symbols.length && typeof cursorLine === "number" && cursorLine > 0);
  }

  // monaco_editor/editor_breadcrumb_symbol_position_utils.js
  function getBreadcrumbSymbolPosition(symRange) {
    if (!symRange) return { line: 1, col: 1 };
    var sl = symRange.startLineNumber || symRange.startLine || (symRange.start && typeof symRange.start.line === "number" ? symRange.start.line + 1 : null) || 1;
    var sc = symRange.startColumn || (symRange.start && typeof symRange.start.character === "number" ? symRange.start.character + 1 : null) || 1;
    if (Array.isArray(symRange) && symRange.length >= 2) {
      sl = symRange[0] + 1;
      sc = symRange[1] + 1;
    }
    return { line: sl, col: sc };
  }

  // monaco_editor/editor_breadcrumb_create_symbol_item_utils.js
  function createBreadcrumbSymbolItem(doc, chainItem, idx, iconHtml) {
    var sitem = doc.createElement("span");
    sitem.className = "te2-bc-item";
    var si = doc.createElement("span");
    si.className = "te2-bc-sym-icon";
    si.innerHTML = iconHtml;
    sitem.appendChild(si);
    var slabel = doc.createElement("span");
    slabel.textContent = chainItem.name || "";
    sitem.appendChild(slabel);
    sitem.dataset.symIdx = String(idx);
    return sitem;
  }

  // monaco_editor/editor_breadcrumb_finalize_scroll_utils.js
  function finalizeBreadcrumbScroll(el) {
    el.scrollLeft = el.scrollWidth;
  }

  // monaco_editor/editor_breadcrumb_path_click_utils.js
  function getBreadcrumbPathClickTarget(ev) {
    var el = ev.currentTarget;
    return {
      isFile: el.dataset.isFile === "1",
      absDir: el.dataset.path || ""
    };
  }

  // monaco_editor/editor_breadcrumb_symbol_click_utils.js
  function getBreadcrumbSymbolClickPosition(ev) {
    var el = ev.currentTarget;
    var line = parseInt(el.dataset.line, 10);
    var col = parseInt(el.dataset.col, 10) || 1;
    return { line, col };
  }

  // monaco_editor/editor_boot_language_ids_utils.js
  function collectBootLanguageIds(monacoRef) {
    if (!(monacoRef && monacoRef.languages && monacoRef.languages.getLanguages)) return [];
    return monacoRef.languages.getLanguages().map(function(l) {
      return l && l.id;
    }).filter(Boolean);
  }

  // monaco_editor/editor_boot_plaintext_warn_utils.js
  function warnIfPlaintextOnlyLanguages(langs) {
    if (langs.length <= 1 && langs[0] === "plaintext") {
      console.warn("[Monaco] language registry still plaintext-only");
    }
  }

  // monaco_editor/editor_boot_apply_active_model_language_utils.js
  function applyActiveModelLanguage(windowRef, model, currentPath, applyLanguageToModelFn, languageFromPathFn) {
    if (windowRef.monaco && model && currentPath) {
      applyLanguageToModelFn(model, languageFromPathFn(currentPath), currentPath);
    }
  }

  // monaco_editor/m_editor_app.js
  (function() {
    try {
      if (typeof window.__debugDraftDiffs === "undefined") {
        window.__debugDraftDiffs = true;
      }
    } catch (_) {
    }
    var editor = null;
    var diffEditor = null;
    var model = null;
    var gitHeadModel = null;
    var gitDiskModel = null;
    var lastGitBaselines = null;
    var _workerLogOnce = /* @__PURE__ */ Object.create(null);
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
      drop_hot: 0
    };
    var _trace = {
      mirror_bind_total: 0,
      mirror_active: 0,
      unsaved_reason: "-",
      gb_req_total: 0,
      gb_req_immediate: 0,
      gb_req_debounced: 0,
      gb_last_source: "-"
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
    var vscodeRpcWs = null;
    var vscodeRpcPending = /* @__PURE__ */ Object.create(null);
    var vscodeRpcNextId = 1;
    var vscodeRpcLegend = null;
    var vscodeRpcInstalled = false;
    var vscodeRpcDocUri = null;
    var vscodeRpcDocVersion = 1;
    var vscodeRpcChangeDebounceT = null;
    var tmRegistry = null;
    var tmGrammarIndex = null;
    var tmInstalled = /* @__PURE__ */ Object.create(null);
    var tmGrammarByLang = /* @__PURE__ */ Object.create(null);
    var tmActiveThemeJson = null;
    var tmVscodeIndex = null;
    async function ensureTextmateReady() {
      if (tmRegistry) return tmRegistry;
      if (!window.vscodetextmate || !window.onig) {
        throw new Error("TextMate deps missing (vscodetextmate/onig)");
      }
      if (!tmVscodeIndex) {
        try {
          tmVscodeIndex = await _refreshVscodeGrammarIndex();
        } catch (e0) {
          tmVscodeIndex = null;
        }
      }
      if (!tmGrammarIndex) {
        try {
          tmGrammarIndex = await fetchJsonWithBase(fetch, apiBase, "/ui/monaco_editor/textmate/grammar_index.json", { cache: "no-store" });
        } catch (_) {
          tmGrammarIndex = null;
        }
      }
      try {
        var wasmResp = await fetch(buildUiUrl(apiBase, "monaco_editor/textmate/onig.wasm"), { cache: "force-cache" });
        if (!wasmResp.ok) throw new Error("onig.wasm HTTP " + wasmResp.status);
        var wasmBuf = await wasmResp.arrayBuffer();
        await window.onig.loadWASM(wasmBuf);
      } catch (e) {
        console.warn("[TextMate] loadWASM failed", e);
        throw e;
      }
      var registry = new window.vscodetextmate.Registry({
        onigLib: Promise.resolve({
          createOnigScanner: function(sources) {
            return new window.onig.OnigScanner(sources);
          },
          createOnigString: function(str) {
            return new window.onig.OnigString(str);
          }
        }),
        loadGrammar: async function(scopeName) {
          try {
            var sn = String(scopeName || "");
            try {
              if (!tmVscodeIndex) tmVscodeIndex = await _refreshVscodeGrammarIndex();
              var entry = tmVscodeIndex && tmVscodeIndex.byScope ? tmVscodeIndex.byScope[sn] : null;
              if (entry && entry.id) {
                var res = await vscodeApiCall("vscode.textmate.grammars.load", { id: entry.id });
                if (res && res.ok && res.raw) {
                  var url = "vscode_api://textmate/" + encodeURIComponent(entry.id);
                  return window.vscodetextmate.parseRawGrammar(String(res.raw), url);
                }
              }
            } catch (e1) {
            }
            var scopes = tmGrammarIndex && tmGrammarIndex.scopes ? tmGrammarIndex.scopes : null;
            var fileName = scopes ? scopes[sn] : null;
            if (!fileName) return null;
            var url2 = buildUiUrl(apiBase, "monaco_editor/textmate/grammars/" + fileName);
            var resp = await fetch(url2, { cache: "force-cache" });
            if (!resp.ok) return null;
            var content = await resp.text();
            return window.vscodetextmate.parseRawGrammar(content, url2);
          } catch (e) {
            console.warn("[TextMate] loadGrammar failed", scopeName, e);
            return null;
          }
        }
      });
      tmRegistry = registry;
      if (tmActiveThemeJson) {
        _applyThemeToTextmateRegistry(tmActiveThemeJson);
        try {
          var models = window.monaco.editor.getModels();
          for (var mi = 0; mi < models.length; mi++) {
            if (models[mi] && typeof models[mi].resetTokenization === "function") {
              models[mi].resetTokenization();
            }
          }
        } catch (_) {
        }
      }
      console.log("[TextMate] ready");
      return tmRegistry;
    }
    function _applyThemeToTextmateRegistry(vscodeThemeJson) {
      try {
        if (!tmRegistry || !vscodeThemeJson) return;
        var settings = [];
        var colors = vscodeThemeJson.colors || {};
        var editorFg = colors["editor.foreground"] || colors["foreground"] || "#e6edf3";
        var editorBg = colors["editor.background"] || colors["editorPane.background"] || "#0d1117";
        settings.push({ settings: { foreground: editorFg, background: editorBg } });
        var tc = vscodeThemeJson.tokenColors || [];
        for (var i = 0; i < tc.length; i++) {
          settings.push(tc[i]);
        }
        tmRegistry.setTheme({ name: vscodeThemeJson.name || "te2-theme", settings });
        if (window.monaco && window.monaco.languages && window.monaco.languages.setColorMap) {
          var colorMap = tmRegistry.getColorMap();
          if (colorMap && colorMap.length > 0) {
            window.monaco.languages.setColorMap(colorMap);
            var installedLangs = Object.keys(tmInstalled).filter(function(k) {
              return tmInstalled[k];
            });
            console.log("[TextMate:DIAG] setColorMap called, colors=" + colorMap.length + ", already installed langs: [" + installedLangs.join(", ") + "]");
            try {
              _patchSemanticTokenColorIndices("setColorMap");
            } catch (_) {
            }
          }
        }
      } catch (e) {
        console.warn("[TextMate] _applyThemeToTextmateRegistry failed", e);
      }
    }
    async function _scopeNameForLanguage(languageId, filePath) {
      var lang = normalizeLanguage(languageId);
      try {
        if (!tmVscodeIndex) {
          try {
            tmVscodeIndex = await _refreshVscodeGrammarIndex();
          } catch (_) {
          }
        }
        if (tmVscodeIndex && tmVscodeIndex.byLanguage && tmVscodeIndex.byLanguage[lang]) {
          var entry = tmVscodeIndex.byLanguage[lang];
          if (entry && entry.scopes && filePath) {
            var p = String(filePath || "");
            if (lang === "javascript" && /\\.jsx$/i.test(p)) {
              if (entry.scopes.indexOf("source.js.jsx") >= 0) return "source.js.jsx";
              if (entry.scopes.indexOf("source.jsx") >= 0) return "source.jsx";
            }
            if (lang === "typescript" && /\\.tsx$/i.test(p)) {
              if (entry.scopes.indexOf("source.tsx") >= 0) return "source.tsx";
            }
            if (lang === "markdown") {
              if (entry.scopes.indexOf("text.html.markdown") >= 0) return "text.html.markdown";
            }
          }
          if (entry && entry.preferred) return entry.preferred;
        }
      } catch (_) {
      }
      var p = String(filePath || "");
      if (lang === "javascript") {
        if (/\\.jsx$/i.test(p)) return "source.js.jsx";
        return "source.js";
      }
      if (lang === "typescript") {
        if (/\\.tsx$/i.test(p)) return "source.tsx";
        return "source.ts";
      }
      if (lang === "python") return "source.python";
      if (lang === "json") return "source.json";
      if (lang === "jsonc") return "source.json.comments";
      if (lang === "html") return "text.html.basic";
      if (lang === "css") return "source.css";
      if (lang === "markdown") return "text.html.markdown";
      if (lang === "shell") return "source.shell";
      if (lang === "c") return "source.c";
      if (lang === "cpp") return "source.cpp";
      if (lang === "java") return "source.java";
      if (lang === "rust") return "source.rust";
      return "source." + lang;
    }
    async function _refreshVscodeGrammarIndex() {
      var idx = { byScope: /* @__PURE__ */ Object.create(null), byLanguage: /* @__PURE__ */ Object.create(null) };
      try {
        let pickPreferred2 = function(lang3, scopesArr) {
          var prefer = [];
          if (lang3 === "javascript") prefer = ["source.js", "source.jsx", "source.js.jsx"];
          else if (lang3 === "typescript") prefer = ["source.ts", "source.tsx"];
          else if (lang3 === "python") prefer = ["source.python"];
          else if (lang3 === "json") prefer = ["source.json", "source.json.comments"];
          else if (lang3 === "html") prefer = ["text.html.basic"];
          else if (lang3 === "css") prefer = ["source.css"];
          else if (lang3 === "markdown") prefer = ["text.html.markdown"];
          else if (lang3 === "shell") prefer = ["source.shell"];
          else if (lang3 === "c") prefer = ["source.c"];
          else if (lang3 === "cpp") prefer = ["source.cpp"];
          else if (lang3 === "java") prefer = ["source.java"];
          else if (lang3 === "rust") prefer = ["source.rust"];
          for (var i2 = 0; i2 < prefer.length; i2++) {
            if (scopesArr.indexOf(prefer[i2]) >= 0) return prefer[i2];
          }
          var fallback = "source." + lang3;
          if (scopesArr.indexOf(fallback) >= 0) return fallback;
          return scopesArr.length ? scopesArr[0] : null;
        };
        var pickPreferred = pickPreferred2;
        var res = await vscodeApiCall("vscode.textmate.grammars.list", {});
        var arr = res && res.grammars ? res.grammars : [];
        if (!Array.isArray(arr)) arr = [];
        var byLangScopes = /* @__PURE__ */ Object.create(null);
        for (var i = 0; i < arr.length; i++) {
          var g = arr[i];
          if (!g) continue;
          var scope = String(g.scopeName || "").trim();
          var id = String(g.id || "").trim();
          if (!scope || !id) continue;
          var glang = String(g.language || "").trim();
          idx.byScope[scope] = { id, scopeName: scope, language: glang };
          var lang = normalizeLanguage(glang);
          if (!lang) continue;
          if (!byLangScopes[lang]) byLangScopes[lang] = /* @__PURE__ */ new Set();
          byLangScopes[lang].add(scope);
        }
        for (var lang2 in byLangScopes) {
          if (!Object.prototype.hasOwnProperty.call(byLangScopes, lang2)) continue;
          var set = byLangScopes[lang2];
          var scopes = Array.from(set);
          scopes.sort();
          var preferred = pickPreferred2(lang2, scopes);
          idx.byLanguage[lang2] = { preferred, scopes };
        }
      } catch (_) {
      }
      return idx;
    }
    function _makeTextmateState(ruleStack) {
      return {
        _rs: ruleStack,
        clone: function() {
          return _makeTextmateState(this._rs);
        },
        equals: function(other) {
          return !!other && this._rs === other._rs;
        }
      };
    }
    async function ensureTextmateTokenization(languageId, filePath) {
      try {
        if (!window.monaco || !window.monaco.languages || !window.monaco.languages.setTokensProvider) return false;
        var lang = normalizeLanguage(languageId);
        console.log("[TextMate:DIAG] ensureTextmateTokenization called: lang=" + lang + " filePath=" + filePath + " alreadyInstalled=" + !!tmInstalled[lang]);
        if (tmInstalled[lang]) return true;
        var scopeName = await _scopeNameForLanguage(lang, filePath);
        console.log("[TextMate:DIAG] scopeName for " + lang + " = " + scopeName);
        if (!scopeName) return false;
        var registry = await ensureTextmateReady();
        var cmBefore = registry.getColorMap ? registry.getColorMap().length : "?";
        var grammar = await registry.loadGrammar(scopeName);
        var cmAfter = registry.getColorMap ? registry.getColorMap().length : "?";
        console.log("[TextMate:DIAG] loadGrammar(" + scopeName + ") colorMap: " + cmBefore + " -> " + cmAfter);
        if (!grammar) {
          console.warn("[TextMate] missing grammar for", lang, scopeName);
          return false;
        }
        try {
          tmGrammarByLang[lang] = grammar;
        } catch (_) {
        }
        if (tmActiveThemeJson) {
          _applyThemeToTextmateRegistry(tmActiveThemeJson);
        }
        try {
          var knownLangs = window.monaco.languages.getLanguages();
          if (!knownLangs.some(function(l) {
            return l.id === lang;
          })) {
            window.monaco.languages.register({ id: lang });
          }
        } catch (_) {
        }
        window.monaco.languages.setTokensProvider(lang, {
          getInitialState: function() {
            return _makeTextmateState(window.vscodetextmate.INITIAL);
          },
          // Encoded tokenization: vscode-textmate resolves full scope stack against
          // the theme and returns a Uint32Array with pre-computed color indices.
          // This matches code-server's VS Code engine behavior exactly.
          tokenizeEncoded: function(line, state) {
            var rs = state && state._rs ? state._rs : window.vscodetextmate.INITIAL;
            var res = grammar.tokenizeLine2(String(line || ""), rs);
            return { tokens: res.tokens, endState: _makeTextmateState(res.ruleStack) };
          },
          // Text-mode fallback (used by EncodedTokenizationSupportAdapter.tokenize
          // and by debug tooling).
          tokenize: function(line, state) {
            var rs = state && state._rs ? state._rs : window.vscodetextmate.INITIAL;
            var res = grammar.tokenizeLine(String(line || ""), rs);
            var tokens = [];
            for (var i = 0; i < res.tokens.length; i++) {
              var t = res.tokens[i];
              var scopes = t.scopes || [];
              var last = scopes.length ? scopes[scopes.length - 1] : "";
              try {
                if (window.__debugTextmateScopes) {
                  if (!t._te2_scopeStack) t._te2_scopeStack = scopes.slice();
                }
              } catch (_) {
              }
              tokens.push({ startIndex: t.startIndex, scopes: last });
            }
            return { tokens, endState: _makeTextmateState(res.ruleStack) };
          }
        });
        tmInstalled[lang] = true;
        console.log("[TextMate] installed", lang, "->", scopeName);
        try {
          _patchSemanticTokenColorIndices("tmInstall:" + lang);
        } catch (_) {
        }
        return true;
      } catch (e) {
        console.warn("[TextMate] install failed", languageId, e);
        return false;
      }
    }
    function _te2DumpTextmateScopesForLine(lang, text, ruleStack) {
      return te2DumpTextmateScopesForLine(tmGrammarByLang, window.vscodetextmate, lang, text, ruleStack);
    }
    function _te2GetActiveEditorAndModel() {
      return te2GetActiveEditorAndModel(diffEditor, editor);
    }
    function _te2AdvanceRuleStackToLine(grammar, model2, targetLine) {
      return te2AdvanceRuleStackToLine(window.vscodetextmate, grammar, model2, targetLine);
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
          console.warn("[TextMate][Debug] no grammar loaded for", lang, { side: ctx.side, uri: String(activeModel && activeModel.uri) });
          return;
        }
        var lineNo = Math.min(Math.max(1, ln | 0), activeModel.getLineCount());
        var ruleStack = _te2AdvanceRuleStackToLine(grammar, activeModel, lineNo);
        var line = activeModel.getLineContent(lineNo);
        var dump = _te2DumpTextmateScopesForLine(lang, line, ruleStack);
        console.log("[TextMate][Debug]", {
          side: ctx.side,
          uri: String(activeModel && activeModel.uri),
          lang,
          ln: lineNo,
          line,
          tokens: dump ? dump.tokens : null
        });
      } catch (e) {
        console.warn("[TextMate][Debug] failed", e);
      }
    }
    window.__te2DumpTextmateLine = _te2DumpTextmateLine;
    window.__te2DumpTextmateAtCursor = function() {
      try {
        var ctx = _te2GetActiveEditorAndModel();
        if (!ctx.editor || !ctx.model) return;
        var pos = ctx.editor.getPosition ? ctx.editor.getPosition() : null;
        var ln = pos && pos.lineNumber ? pos.lineNumber : 1;
        _te2DumpTextmateLine(ln);
      } catch (e) {
        console.warn("[TextMate][Debug] failed", e);
      }
    };
    window.__te2DumpTextmateScopes = function() {
      try {
        var ctx = _te2GetActiveEditorAndModel();
        if (!ctx.model) return;
        var activeModel = ctx.model;
        var lang = normalizeLanguage(activeModel.getLanguageId ? activeModel.getLanguageId() : languageFromPath(currentPath));
        if (!lang) return;
        var grammar = tmGrammarByLang[lang];
        if (!grammar) {
          console.warn("[TextMate][Debug] no grammar loaded for", lang, { side: ctx.side, uri: String(activeModel && activeModel.uri) });
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
            var step = grammar.tokenizeLine(String(line || ""), ruleStack);
            ruleStack = step.ruleStack;
            continue;
          }
          var dump = _te2DumpTextmateScopesForLine(lang, line, ruleStack);
          if (!dump) continue;
          ruleStack = dump.ruleStack;
          console.log("[TextMate][Debug]", {
            side: ctx.side,
            uri: String(activeModel && activeModel.uri),
            lang,
            ln,
            line,
            tokens: dump.tokens
          });
          printed += 1;
          if (printed >= 12) break;
        }
        if (!printed) console.log("[TextMate][Debug] no import/def/class lines found in first", maxLines, "lines");
      } catch (e) {
        console.warn("[TextMate][Debug] failed", e);
      }
    };
    function applyLanguageToModel(nextModel, languageId, filePath) {
      try {
        if (!nextModel || !window.monaco || !window.monaco.editor) return;
        var lang = normalizeLanguage(languageId);
        if ((!lang || lang === "plaintext") && filePath) lang = languageFromPath(filePath);
        try {
          window.monaco.editor.setModelLanguage(nextModel, lang);
        } catch (_) {
        }
        Promise.resolve().then(function() {
          return ensureVscodeLanguagesInstalled();
        }).then(function() {
          try {
            if (filePath) {
              var resolved = normalizeLanguage(languageFromPath(filePath));
              if (resolved && resolved !== lang) {
                lang = resolved;
                try {
                  window.monaco.editor.setModelLanguage(nextModel, lang);
                } catch (_) {
                }
              }
            }
          } catch (_) {
          }
          return ensureTextmateTokenization(lang, filePath);
        }).then(function(ok) {
          if (!ok) return;
          try {
            window.monaco.editor.setModelLanguage(nextModel, lang);
          } catch (_) {
          }
          try {
            installVscodeApiLanguageBridgeProviders();
          } catch (_) {
          }
        }).catch(function() {
        });
      } catch (_) {
      }
    }
    function getEditorContainer() {
      try {
        return document.getElementById("fh-monaco");
      } catch (_) {
        return null;
      }
    }
    function _layoutEditors() {
      try {
        if (diffEditor && diffEditor.layout) diffEditor.layout();
      } catch (_) {
      }
      try {
        if (editor && editor.layout) editor.layout();
      } catch (_) {
      }
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
          window.addEventListener("resize", _layoutEditors);
        } catch (_) {
        }
      } catch (_) {
      }
    }
    function getShowInlineDiffs() {
      return getShowInlineDiffsFlag(cachedPrefs);
    }
    function getShowDraftDiffs() {
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
      var sinceEdit = lastLocalEditAt > 0 ? Date.now() - lastLocalEditAt : idleMs;
      var waitMs = sinceEdit >= idleMs ? 0 : idleMs - sinceEdit;
      if (gitBaselineApplyT) clearTimeout(gitBaselineApplyT);
      gitBaselineApplyT = setTimeout(function() {
        gitBaselineApplyT = null;
        var p = pendingGitBaselinePayload;
        pendingGitBaselinePayload = null;
        try {
          if (p) applyGitBaselines(p);
        } catch (_) {
        }
      }, waitMs);
    }
    function _emitGitBaselineRequestNow() {
      if (!editorSocket || !editorSocket.connected) return false;
      if (!currentPath) return false;
      if (!getShowInlineDiffs()) {
        disposeGitBaselines();
        if (diffEditor) ensurePlainEditorWithPrefs();
        return false;
      }
      editorSocket.emit("editor_git_baselines_request", { path: currentPath });
      return true;
    }
    function normalizeLanguage(lang) {
      return normalizeLanguageId(lang);
    }
    function languageFromPath(path) {
      return languageIdFromPath(path, vscodeLanguageByFilename, vscodeLanguageByExtension);
    }
    function createFileModel2(content, lang, absPath) {
      return createFileModel(
        monaco,
        function(p) {
          return monacoFileUri(window.monaco, p);
        },
        content,
        lang,
        absPath,
        function() {
          try {
            setTimeout(function() {
              installVscodeApiLanguageBridgeProviders();
            }, 0);
          } catch (_) {
          }
        }
      );
    }
    function vscodeRpcCall(method, params) {
      return new Promise(function(resolve, reject) {
        try {
          if (!vscodeRpcWs || vscodeRpcWs.readyState !== 1) {
            reject(new Error("vscode_rpc not connected"));
            return;
          }
          var id = vscodeRpcNextId++;
          vscodeRpcPending[String(id)] = { resolve, reject };
          vscodeRpcWs.send(JSON.stringify({ jsonrpc: "2.0", id, method, params: params || {} }));
        } catch (e) {
          reject(e);
        }
      });
    }
    var ENABLE_VSCODE_RPC = false;
    async function ensureVscodeRpcConnected() {
      try {
        if (!ENABLE_VSCODE_RPC) return false;
        if (vscodeRpcWs && vscodeRpcWs.readyState === 1) return true;
        var disc = await fetchJsonWithBase(fetch, apiBase, "/vscode_rpc/discover", { cache: "no-store" });
        if (!disc || !disc.ws_url) return false;
        var wsUrl = wsUrlFromPath(window.location, disc.ws_url);
        if (!wsUrl) return false;
        vscodeRpcWs = new WebSocket(wsUrl);
        vscodeRpcWs.onmessage = function(ev) {
          try {
            var msg = JSON.parse(String(ev.data || ""));
            if (msg && msg.id != null) {
              var key = String(msg.id);
              var p = vscodeRpcPending[key];
              if (p) {
                delete vscodeRpcPending[key];
                if (msg.error) p.reject(msg.error);
                else p.resolve(msg.result);
              }
            }
          } catch (_) {
          }
        };
        await new Promise(function(resolve, reject) {
          vscodeRpcWs.onopen = function() {
            resolve();
          };
          vscodeRpcWs.onerror = function(e) {
            reject(e);
          };
        });
        try {
          var init = await vscodeRpcCall("initialize", { processId: null, rootUri: null, capabilities: {} });
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
        if (ENABLE_VSCODE_RPC) console.warn("[vscode_rpc] connect failed", e);
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
            getLegend: function() {
              return legend;
            },
            provideDocumentSemanticTokens: async function(m) {
              try {
                if (!m) return { data: new Uint32Array(0) };
                var uri = m.uri ? m.uri.toString() : "";
                var resp = await vscodeRpcCall("textDocument/semanticTokens/full", { textDocument: { uri } });
                var data = resp && resp.data ? resp.data : [];
                return { data: new Uint32Array(data) };
              } catch (_) {
                return { data: new Uint32Array(0) };
              }
            },
            releaseDocumentSemanticTokens: function() {
            }
          };
        };
        monaco.languages.registerDocumentSemanticTokensProvider("typescript", makeProvider());
        monaco.languages.registerDocumentSemanticTokensProvider("javascript", makeProvider());
        vscodeRpcInstalled = true;
        console.log("[vscode_rpc] semantic tokens provider installed");
      } catch (e) {
        console.warn("[vscode_rpc] install semantic tokens failed", e);
      }
    }
    function _applyDiagnosticsUpdate(params) {
      try {
        if (!window.monaco || !window.monaco.editor) return;
        if (!_diagState) _diagState = { rx: 0, apply: 0, drop_no_path: 0, drop_no_model: 0, drop_mismatch: 0 };
        _diagState.rx += 1;
        var owner = params && params.owner ? String(params.owner) : "workbench";
        var activeUri = model && model.uri ? String(model.uri.toString()) : "";
        var activePath = currentPath ? String(currentPath) : activeUri ? _absPathFromVscodeUri(activeUri) : "";
        var items = params && Array.isArray(params.items) ? params.items : [];
        var didApply = false;
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          if (!item) continue;
          var itemPath = _absPathFromVscodeUri(item.uri || item && item.resource || "");
          if (!itemPath) {
            _diagState.drop_no_path += 1;
            try {
              if (window.__debugVscodeApiDiag) console.log("[vscode_api] diag drop_no_path item.uri=", item && item.uri);
            } catch (_) {
            }
            continue;
          }
          var markers = Array.isArray(item.markers) ? item.markers : [];
          var outMarkers = [];
          for (var j = 0; j < markers.length; j++) {
            var m = markers[j] || {};
            var sev = Number(m.severity || 3);
            var ms = monaco.MarkerSeverity.Info;
            if (sev === 8) ms = monaco.MarkerSeverity.Error;
            else if (sev === 4) ms = monaco.MarkerSeverity.Warning;
            else if (sev === 2) ms = monaco.MarkerSeverity.Info;
            else if (sev === 1 && monaco.MarkerSeverity.Hint) ms = monaco.MarkerSeverity.Hint;
            var code = void 0;
            try {
              if (typeof m.code === "string" || typeof m.code === "number") code = String(m.code);
              else if (m.code && typeof m.code === "object" && m.code.value != null) code = String(m.code.value);
            } catch (_) {
            }
            outMarkers.push({
              severity: ms,
              message: m.message != null ? String(m.message) : "",
              startLineNumber: Math.max(1, Number(m.startLineNumber || 1)),
              startColumn: Math.max(1, Number(m.startColumn || 1)),
              endLineNumber: Math.max(1, Number(m.endLineNumber || m.startLineNumber || 1)),
              endColumn: Math.max(1, Number(m.endColumn || m.startColumn || 1)),
              source: m.source != null ? String(m.source) : "vscode",
              code
            });
          }
          try {
            if (!_diagCache) _diagCache = /* @__PURE__ */ new Map();
            var pathOwnerMap = _diagCache.get(itemPath);
            if (!pathOwnerMap) {
              pathOwnerMap = /* @__PURE__ */ new Map();
              _diagCache.set(itemPath, pathOwnerMap);
            }
            pathOwnerMap.set(owner, { ts_ms: Date.now(), markers: outMarkers });
            while (_diagCache.size > DIAG_CACHE_MAX) {
              var firstKey = _diagCache.keys().next().value;
              _diagCache.delete(firstKey);
            }
          } catch (_) {
          }
          if (model && model.uri && activePath && itemPath === activePath) {
            try {
              if (!_diagKnownOwners) _diagKnownOwners = /* @__PURE__ */ new Set();
              _diagKnownOwners.add(owner);
              console.log("[vscode_api] setModelMarkers owner=" + owner + " count=" + outMarkers.length + " sevs=[" + outMarkers.map(function(m2) {
                return m2.severity;
              }).join(",") + "] lines=[" + outMarkers.map(function(m2) {
                return m2.startLineNumber;
              }).join(",") + "]");
              if (outMarkers.length > 0) console.log("[vscode_api] marker[0]:", JSON.stringify(outMarkers[0]));
              monaco.editor.setModelMarkers(model, owner, outMarkers);
              var verify = monaco.editor.getModelMarkers({ resource: model.uri });
              console.log("[vscode_api] verify getModelMarkers count=" + (verify ? verify.length : "null"));
              _emitAggregatedDiagCounts(itemPath);
            } catch (ex) {
              console.error("[vscode_api] setModelMarkers THREW:", ex);
            }
            didApply = true;
            _diagState.apply += 1;
          } else if (model && model.uri && activePath && itemPath !== activePath) {
            _diagState.drop_mismatch += 1;
            try {
              if (window.__debugVscodeApiDiag) console.log("[vscode_api] diag mismatch itemPath=", itemPath, "activePath=", activePath);
            } catch (_) {
            }
          } else if (!model || !model.uri) {
            _diagState.drop_no_model += 1;
          }
        }
        try {
          setDebugDiag("diag=rx" + _diagState.rx + "/ap" + _diagState.apply + "/np" + _diagState.drop_no_path + "/nm" + _diagState.drop_no_model + "/mm" + _diagState.drop_mismatch);
        } catch (_) {
        }
        if (!didApply) {
          try {
            _applyCachedDiagnosticsForActive();
          } catch (_) {
          }
          try {
            _scheduleDiagReapply();
          } catch (_) {
          }
        }
      } catch (_) {
      }
    }
    var _diagCache = null;
    var _diagState = null;
    var DIAG_CACHE_MAX = 50;
    var _diagKnownOwners = null;
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
        emitToHost("editor_diagnostics_counts", { errors, warnings, hints, total: all ? all.length : 0, path: path || currentPath || "" });
      } catch (_) {
      }
    }
    var _diagReapplyScheduled = false;
    function _scheduleDiagReapply() {
      if (_diagReapplyScheduled) return;
      _diagReapplyScheduled = true;
      var delays = [0, 50, 250];
      delays.forEach(function(ms) {
        try {
          setTimeout(function() {
            try {
              _applyCachedDiagnosticsForActive();
            } catch (_) {
            }
          }, ms);
        } catch (_) {
        }
      });
      try {
        setTimeout(function() {
          _diagReapplyScheduled = false;
        }, 300);
      } catch (_) {
        _diagReapplyScheduled = false;
      }
    }
    function _clearDiagnosticsForSwitch() {
      try {
        if (model && window.monaco && window.monaco.editor) {
          if (_diagKnownOwners && _diagKnownOwners.size) {
            _diagKnownOwners.forEach(function(own) {
              try {
                monaco.editor.setModelMarkers(model, own, []);
              } catch (_) {
              }
            });
          }
          monaco.editor.setModelMarkers(model, "vscode_api", []);
        }
        _diagKnownOwners = /* @__PURE__ */ new Set();
        emitToHost("editor_diagnostics_counts", { errors: 0, warnings: 0, hints: 0, total: 0, path: currentPath || "" });
      } catch (_) {
      }
    }
    function _applyCachedDiagnosticsForActive() {
      try {
        if (!window.monaco || !window.monaco.editor) return;
        if (!_diagCache || !_diagCache.size) return;
        if (!model || !model.uri) return;
        var activeUri = String(model.uri.toString());
        var activePath = currentPath ? String(currentPath) : _absPathFromVscodeUri(activeUri);
        if (!activePath) return;
        var pathOwnerMap = _diagCache.get(activePath);
        if (!pathOwnerMap || !pathOwnerMap.size) return;
        if (!_diagKnownOwners) _diagKnownOwners = /* @__PURE__ */ new Set();
        var applied = 0;
        pathOwnerMap.forEach(function(cached, own) {
          var markers = Array.isArray(cached.markers) ? cached.markers : [];
          monaco.editor.setModelMarkers(model, own, markers);
          _diagKnownOwners.add(own);
          applied += markers.length;
        });
        if (_diagState) _diagState.apply += 1;
        _emitAggregatedDiagCounts(activePath);
        try {
          setDebugDiag("diag=rx" + (_diagState ? _diagState.rx : 0) + "/ap" + (_diagState ? _diagState.apply : 0) + "/np" + (_diagState ? _diagState.drop_no_path : 0) + "/nm" + (_diagState ? _diagState.drop_no_model : 0) + "/mm" + (_diagState ? _diagState.drop_mismatch : 0));
        } catch (_) {
        }
      } catch (_) {
      }
    }
    function _absPathFromVscodeUri(raw) {
      return absPathFromVscodeUri(raw);
    }
    function _currentLanguageContext() {
      try {
        if (!model || !model.uri) return null;
        var uri = String(model.uri.toString());
        if (!uri) return null;
        var p = currentPath ? String(currentPath) : _pathFromUriString(uri);
        var lang = String(model.getLanguageId ? model.getLanguageId() : languageFromPath(p));
        var v = Number(model.getVersionId ? model.getVersionId() : 1) || 1;
        return { uri, path: p, languageId: lang, version: v };
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
      registeredHover: /* @__PURE__ */ new Set(),
      registeredSymbols: /* @__PURE__ */ new Set(),
      registeredCompletions: /* @__PURE__ */ new Set(),
      registeredSemanticTokens: /* @__PURE__ */ new Set(),
      semanticTokensLegendCache: {},
      // languageId -> legend
      semanticTokensRangeFlag: {},
      // languageId -> true if range-only provider
      semanticTokensResultId: {},
      // languageId -> last resultId (for delta requests)
      semanticTokensDiagGated: /* @__PURE__ */ new Set()
      // languages waiting for diagnostics before registering
    };
    var _wbPending = /* @__PURE__ */ new Map();
    var _wbNextId = 1;
    var _wbFlow = {
      generation: 0,
      activePath: "",
      openAckGeneration: -1,
      openAckPath: "",
      pendingDidChange: null,
      // { path, text, languageId, generation }
      pendingSymbols: null
      // { path, generation }
    };
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
        editor,
        model,
        currentPath,
        wbFlow: _wbFlow,
        path,
        generation,
        currentGeneration: _wbCurrentGeneration()
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
      var path = String(o.path || "");
      var generation = Number.isFinite(Number(o.generation)) ? Number(o.generation) : _wbCurrentGeneration();
      var lang = String(o.languageId || "");
      var requestId = String(o.requestId || "diag_" + Date.now() + "_open");
      var source = String(o.source || "open");
      if (!path || !editorSocket || !editorSocket.connected) return Promise.resolve({ ok: false, deferred: true });
      try {
        editorSocket.emit("editor_diagnostics_consumer_pending", { path, request_id: requestId });
      } catch (_) {
      }
      if (!_isAdapterReady()) {
        console.log("[readiness] open_file deferred (" + source + ") \u2014 waiting for baton");
        return Promise.resolve({ ok: false, deferred: true });
      }
      return editorWorkbenchCall(
        "open_file",
        {
          path,
          languageId: lang,
          uri: String(o.uri || ""),
          requestId,
          forceRefresh: !!o.forceRefresh,
          generation
        },
        { timeoutMs: Number.isFinite(Number(o.timeoutMs)) ? Number(o.timeoutMs) : 8e3 }
      ).then(function(res) {
        if (generation !== _wbCurrentGeneration() || String(path) !== String(currentPath || "")) {
          return { ok: false, stale: true };
        }
        _wbSetOpenAck(path, generation);
        try {
          editorSocket.emit("editor_diagnostics_consumer_ready", { path, request_id: requestId });
        } catch (_) {
        }
        _wbFlushPendingAfterOpen();
        return res;
      });
    }
    function _replayOpenFileAfterBaton() {
      if (!currentPath || !editor) return;
      var model2 = editor.getModel ? editor.getModel() : null;
      if (!model2) return;
      var lang = (model2.getLanguageId ? model2.getLanguageId() : "") || "";
      var generation = _wbCurrentGeneration();
      if (!generation || String(_wbFlow.activePath || "") !== String(currentPath || "")) {
        generation = _wbBumpGeneration(currentPath, "baton_replay");
      }
      var replayReqId = "baton_" + Date.now();
      console.log("[readiness] baton arrived, replaying open_file for", currentPath);
      try {
        var content = model2.getValue();
        _wbQueueDidChange(currentPath, content, lang, generation);
      } catch (_) {
      }
      _wbQueueSymbols(currentPath, generation);
      _wbOpenFileFlow({
        path: currentPath,
        languageId: lang,
        uri: model2 && model2.uri ? String(model2.uri.toString()) : "",
        requestId: replayReqId,
        forceRefresh: true,
        generation,
        source: "baton",
        timeoutMs: 8e3
      }).catch(function(e) {
        console.warn("[readiness] baton replay open_file failed", e);
      });
    }
    function editorWorkbenchCall(method, params, opts) {
      var timeoutMs = opts && Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 12e3;
      var requestId = "wb_" + _wbNextId++ + "_" + Date.now();
      var eventName = "editor_workbench_" + method;
      var responseEvent = "editor:workbench_" + method + "_response";
      return new Promise(function(resolve, reject) {
        var timer = setTimeout(function() {
          if (!_wbPending.has(requestId)) return;
          _wbPending.delete(requestId);
          reject(new Error("workbench timeout: " + method));
        }, timeoutMs);
        _wbPending.set(requestId, { resolve, reject, timer });
        if (!editorSocket || !editorSocket.connected) {
          clearTimeout(timer);
          _wbPending.delete(requestId);
          reject(new Error("editor socket not connected"));
          return;
        }
        var payload = Object.assign({}, params || {}, { request_id: requestId });
        console.log("[editorWorkbenchCall] EMIT " + eventName + " reqId=" + requestId + " connected=" + editorSocket.connected);
        editorSocket.emit(eventName, payload);
      });
    }
    function _callVscodeApiGuarded(kind, method, params, ctx, opts) {
      var timeoutMs = opts && Number(opts.timeoutMs) ? Number(opts.timeoutMs) : 5e3;
      var cancelToken = opts && opts.cancelToken ? opts.cancelToken : null;
      var seq = 0;
      if (kind === "hover") seq = ++languageBridge.hoverSeq;
      else if (kind === "symbols") seq = ++languageBridge.symbolsSeq;
      else if (kind === "completions") seq = ++languageBridge.completionsSeq;
      return editorWorkbenchCall(kind, params, { timeoutMs }).then(function(res) {
        if (cancelToken && cancelToken.isCancellationRequested) return { ok: false, stale: true, canceled: true };
        if (!isLanguageContextCurrent(ctx, _currentLanguageContext())) return { ok: false, stale: true };
        if (kind === "hover" && seq !== languageBridge.hoverSeq) return { ok: false, stale: true };
        if (kind === "symbols" && seq !== languageBridge.symbolsSeq) return { ok: false, stale: true };
        if (kind === "completions" && seq !== languageBridge.completionsSeq) return { ok: false, stale: true };
        return { ok: true, result: res };
      }).catch(function(e) {
        return { ok: false, error: String(e && e.message ? e.message : e || "error") };
      });
    }
    function _normalizeDocumentSymbols(raw) {
      if (!Array.isArray(raw) || !window.monaco || !monaco.languages) return [];
      var defaultKind = monaco.languages.SymbolKind ? monaco.languages.SymbolKind.Function : 11;
      var mapOne = function(s) {
        var range = _monacoRangeFromProtoRange(s && s.range ? s.range : null);
        var sel = _monacoRangeFromProtoRange(s && s.selectionRange ? s.selectionRange : s && s.range ? s.range : null);
        var kids = Array.isArray(s && s.children) ? s.children.map(mapOne) : [];
        return {
          name: String(s && s.name || ""),
          detail: s && s.detail != null ? String(s.detail) : "",
          kind: Number(s && s.kind || defaultKind),
          tags: Array.isArray(s && s.tags) ? s.tags : [],
          range: range || new monaco.Range(1, 1, 1, 1),
          selectionRange: sel || range || new monaco.Range(1, 1, 1, 1),
          children: kids
        };
      };
      return raw.map(mapOne);
    }
    function _monacoRangeFromCompletionRange(range, pos) {
      return monacoRangeFromCompletionRange(window.monaco, range, pos);
    }
    function _mapCompletionItemKind(kind) {
      return mapCompletionItemKind(window.monaco, kind);
    }
    function _registerSemanticTokensWithLegend(langId, legend, isRange) {
      if (languageBridge.registeredSemanticTokens.has(langId)) return;
      languageBridge.registeredSemanticTokens.add(langId);
      if (isRange && monaco.languages.registerDocumentRangeSemanticTokensProvider) {
        console.log("[semanticTokens] registering RANGE provider for " + langId + " types=" + legend.tokenTypes.length + " mods=" + legend.tokenModifiers.length);
        monaco.languages.registerDocumentRangeSemanticTokensProvider(langId, {
          getLegend: function() {
            return legend;
          },
          provideDocumentRangeSemanticTokens: function(m, range, token) {
            try {
              if (!m || !m.uri || !range) return null;
              var uri = String(m.uri.toString());
              var p = currentPath ? String(currentPath) : _pathFromUriString(uri);
              var lang = String(m.getLanguageId ? m.getLanguageId() : langId);
              console.log("[semanticTokens] RANGE REQUEST " + lang + " path=" + p + " range=" + range.startLineNumber + ":" + range.startColumn + "-" + range.endLineNumber + ":" + range.endColumn);
              return editorWorkbenchCall("semantic_tokens_range", {
                uri,
                path: p,
                languageId: lang,
                range: {
                  startLineNumber: range.startLineNumber,
                  startColumn: range.startColumn,
                  endLineNumber: range.endLineNumber,
                  endColumn: range.endColumn
                },
                timeoutMs: 1e4
              }, { timeoutMs: 12e3 }).then(function(out) {
                if (!out || out.ok === false) {
                  console.log("[semanticTokens] RANGE RESPONSE not ok", out);
                  return null;
                }
                var payload = out.result || out;
                if (!payload) {
                  console.log("[semanticTokens] RANGE RESPONSE no payload");
                  return null;
                }
                var data = payload.data;
                if (!data || !data.length) {
                  console.log("[semanticTokens] RANGE RESPONSE no data, payload keys=" + Object.keys(payload).join(","), "type=" + payload.type, "resultId=" + payload.resultId);
                  return null;
                }
                console.log("[semanticTokens] RANGE RESPONSE OK tokens=" + data.length / 5 + " resultId=" + (payload.resultId || "") + " first5=[" + Array.from(data).slice(0, 5).join(",") + "]");
                return {
                  resultId: payload.resultId || "",
                  data: new Uint32Array(data)
                };
              }).catch(function(e) {
                console.warn("[semanticTokens] range request failed", e);
                return null;
              });
            } catch (_) {
              return null;
            }
          }
        });
        return;
      }
      console.log("[semanticTokens] registering FULL provider for " + langId + " types=" + legend.tokenTypes.length + " mods=" + legend.tokenModifiers.length);
      monaco.languages.registerDocumentSemanticTokensProvider(langId, {
        getLegend: function() {
          return legend;
        },
        provideDocumentSemanticTokens: function(m, lastResultId, token) {
          try {
            if (!m || !m.uri) return null;
            var uri = String(m.uri.toString());
            var p = currentPath ? String(currentPath) : _pathFromUriString(uri);
            var lang = String(m.getLanguageId ? m.getLanguageId() : langId);
            console.log("[semanticTokens] FULL REQUEST " + lang + " path=" + p + " prevResultId=" + (lastResultId || "0"));
            return editorWorkbenchCall("semantic_tokens", {
              uri,
              path: p,
              languageId: lang,
              previousResultId: lastResultId || "0",
              timeoutMs: 1e4
            }, { timeoutMs: 12e3 }).then(function(out) {
              if (!out || out.ok === false) return null;
              var payload = out.result || out;
              if (!payload) return null;
              if (payload.type === "delta" && payload.edits) {
                return {
                  resultId: payload.resultId || "",
                  edits: payload.edits.map(function(e) {
                    return {
                      start: e.start || 0,
                      deleteCount: e.deleteCount || 0,
                      data: e.data ? new Uint32Array(e.data) : void 0
                    };
                  })
                };
              }
              var data = payload.data;
              if (!data || !data.length) return null;
              return {
                resultId: payload.resultId || "",
                data: new Uint32Array(data)
              };
            }).catch(function(e) {
              console.warn("[semanticTokens] request failed", e);
              return null;
            });
          } catch (_) {
            return null;
          }
        },
        releaseDocumentSemanticTokens: function(resultId) {
        }
      });
      try {
        _patchSemanticTokenColorIndices("semanticProvider");
      } catch (_) {
      }
    }
    function _registerSemanticTokensForLanguage(langId) {
      if (languageBridge.registeredSemanticTokens.has(langId)) return;
      editorWorkbenchCall("semantic_tokens_legend", { languageId: langId }, { timeoutMs: 8e3 }).then(function(res) {
        var legend = res && res.legend;
        if (!legend || !legend.tokenTypes || !legend.tokenModifiers) {
          console.warn("[semanticTokens] no legend for " + langId, res);
          return;
        }
        languageBridge.semanticTokensLegendCache[langId] = legend;
        _registerSemanticTokensWithLegend(langId, legend);
      }).catch(function(e) {
        console.warn("[semanticTokens] legend fetch failed for " + langId, e);
      });
    }
    function installVscodeApiLanguageBridgeProviders() {
      try {
        if (!window.monaco || !window.monaco.languages) return;
        var _doRegister = function(targets) {
          try {
            targets.forEach(function(langId) {
              if (!langId) return;
              if (!languageBridge.registeredHover.has(langId) && monaco.languages.registerHoverProvider) {
                console.log("[hover:bridge] registering hover provider for lang=" + langId);
                monaco.languages.registerHoverProvider(langId, {
                  provideHover: function(m, pos, token) {
                    try {
                      var ctx2 = _currentLanguageContext();
                      if (!ctx2 || !m || !m.uri || String(m.uri.toString()) !== String(ctx2.uri)) {
                        console.warn("[hover:bridge] BAIL provideHover: ctx=" + (ctx2 ? "ok" : "NULL") + " m.uri=" + (m && m.uri ? String(m.uri.toString()).slice(-60) : "NULL") + " ctx.uri=" + (ctx2 ? String(ctx2.uri).slice(-60) : "N/A"));
                        return null;
                      }
                      return _callVscodeApiGuarded(
                        "hover",
                        "vscode.hover",
                        {
                          uri: ctx2.uri,
                          path: ctx2.path,
                          languageId: ctx2.languageId,
                          lineNumber: Number(pos && pos.lineNumber ? pos.lineNumber : 1),
                          column: Number(pos && pos.column ? pos.column : 1),
                          timeoutMs: 4500
                        },
                        ctx2,
                        { timeoutMs: 5e3, cancelToken: token }
                      ).then(function(out) {
                        if (!out || !out.ok || !out.result || out.result.ok === false) return null;
                        var payload = out.result.result || out.result.hover || null;
                        if (!payload) return null;
                        var range = _monacoRangeFromProtoRange(payload.range);
                        var contents = _toMonacoHoverContents(payload.contents);
                        if (!contents.length) return null;
                        return { range: range || void 0, contents };
                      });
                    } catch (_) {
                      return null;
                    }
                  }
                });
                languageBridge.registeredHover.add(langId);
              }
              if (!languageBridge.registeredSymbols.has(langId) && monaco.languages.registerDocumentSymbolProvider) {
                monaco.languages.registerDocumentSymbolProvider(langId, {
                  provideDocumentSymbols: function(m, token) {
                    try {
                      var ctx2 = _currentLanguageContext();
                      if (!ctx2 || !m || !m.uri || String(m.uri.toString()) !== String(ctx2.uri)) return [];
                      return _callVscodeApiGuarded(
                        "symbols",
                        "vscode.documentSymbols",
                        {
                          uri: ctx2.uri,
                          path: ctx2.path,
                          languageId: ctx2.languageId,
                          timeoutMs: 6e3
                        },
                        ctx2,
                        { timeoutMs: 6500, cancelToken: token }
                      ).then(function(out) {
                        if (!out || !out.ok || !out.result || out.result.ok === false) return [];
                        var payload = out.result.result || [];
                        return _normalizeDocumentSymbols(payload);
                      });
                    } catch (_) {
                      return [];
                    }
                  }
                });
                languageBridge.registeredSymbols.add(langId);
              }
              if (!languageBridge.registeredCompletions.has(langId) && monaco.languages.registerCompletionItemProvider) {
                monaco.languages.registerCompletionItemProvider(langId, {
                  triggerCharacters: [".", ":", "<", '"', "'", "/", "@", "#"],
                  provideCompletionItems: function(m, pos, token, context) {
                    try {
                      _flushMirrorDebounce();
                      var ctx2 = _currentLanguageContext();
                      if (!ctx2 || !m || !m.uri || String(m.uri.toString()) !== String(ctx2.uri)) return { suggestions: [] };
                      var triggerKind = 0;
                      var triggerCharacter = void 0;
                      if (context && context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter) {
                        triggerKind = 1;
                        triggerCharacter = context.triggerCharacter || void 0;
                      } else if (context && context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerForIncompleteCompletions) {
                        triggerKind = 2;
                      }
                      return _callVscodeApiGuarded(
                        "completions",
                        "vscode.completions",
                        {
                          uri: ctx2.uri,
                          path: ctx2.path,
                          languageId: ctx2.languageId,
                          lineNumber: Number(pos && pos.lineNumber ? pos.lineNumber : 1),
                          column: Number(pos && pos.column ? pos.column : 1),
                          triggerKind,
                          triggerCharacter,
                          text: m && m.getValue ? m.getValue() : void 0,
                          timeoutMs: 8e3
                        },
                        ctx2,
                        { timeoutMs: 1e4, cancelToken: token }
                      ).then(function(out) {
                        if (!out || !out.ok || !out.result || out.result.ok === false) return { suggestions: [] };
                        var payload = out.result.result || out.result;
                        var rawItems = payload.items || payload.suggestions || [];
                        if (!Array.isArray(rawItems)) return { suggestions: [] };
                        try {
                          for (var di = 0; di < Math.min(3, rawItems.length); di++) {
                            var dbg2 = rawItems[di];
                            if (dbg2) console.log("[completions] item[" + di + "] label=" + JSON.stringify(dbg2.label) + " filterText=" + JSON.stringify(dbg2.filterText) + " range=" + JSON.stringify(dbg2.range) + " insertText=" + JSON.stringify(dbg2.insertText ? dbg2.insertText.substring(0, 40) : ""));
                          }
                        } catch (_) {
                        }
                        var suggestions = rawItems.map(function(item) {
                          if (!item) return null;
                          var range = _monacoRangeFromCompletionRange(item.range, pos);
                          var suggestion = {
                            label: item.label || "",
                            kind: _mapCompletionItemKind(item.kind),
                            detail: item.detail || void 0,
                            documentation: item.documentation || void 0,
                            sortText: item.sortText || void 0,
                            filterText: item.filterText || void 0,
                            preselect: item.preselect || void 0,
                            insertText: item.insertText || (typeof item.label === "string" ? item.label : ""),
                            insertTextRules: item.insertTextRules || void 0,
                            range,
                            commitCharacters: item.commitCharacters || void 0,
                            additionalTextEdits: item.additionalTextEdits || void 0,
                            tags: item.tags || void 0
                          };
                          if (item.command) {
                            suggestion.command = {
                              id: item.command.id || "",
                              title: item.command.title || item.command.id || "",
                              arguments: item.command.arguments || void 0
                            };
                          }
                          return suggestion;
                        }).filter(Boolean);
                        return {
                          suggestions,
                          incomplete: !!payload.isIncomplete
                        };
                      });
                    } catch (_) {
                      return { suggestions: [] };
                    }
                  }
                });
                languageBridge.registeredCompletions.add(langId);
              }
            });
          } catch (_) {
          }
        };
        var immediate = /* @__PURE__ */ new Set();
        try {
          var ctx = _currentLanguageContext();
          if (ctx && ctx.languageId) immediate.add(String(ctx.languageId));
        } catch (_) {
        }
        console.log("[hover:bridge] installVscodeApiLanguageBridgeProviders immediate=" + Array.from(immediate).join(",") + " model=" + (model ? "yes" : "no") + " registeredHover=" + Array.from(languageBridge.registeredHover).join(","));
        if (immediate.size) _doRegister(immediate);
        ensureVscodeLanguagesInstalled().then(function() {
          try {
            var all = /* @__PURE__ */ new Set();
            try {
              vscodeLanguageIds.forEach(function(id) {
                if (id) all.add(id);
              });
            } catch (_) {
            }
            try {
              var ctx2 = _currentLanguageContext();
              if (ctx2 && ctx2.languageId) all.add(String(ctx2.languageId));
            } catch (_) {
            }
            _doRegister(all);
          } catch (_) {
          }
        }).catch(function() {
        });
      } catch (_) {
      }
    }
    function vscodeRpcDidOpenIfReady() {
      try {
        if (!model || !currentPath) return;
        var lang = String(model.getLanguageId ? model.getLanguageId() : languageFromPath(currentPath));
        if (lang !== "typescript" && lang !== "javascript") return;
        ensureVscodeRpcConnected().then(function(ok) {
          if (!ok || !vscodeRpcLegend) return;
          var uri = model.uri ? model.uri.toString() : "";
          if (!uri || !uri.startsWith("file://")) return;
          if (vscodeRpcDocUri && vscodeRpcDocUri !== uri) {
            try {
              vscodeRpcWs.send(JSON.stringify({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri: vscodeRpcDocUri } } }));
            } catch (_) {
            }
          }
          vscodeRpcDocUri = uri;
          vscodeRpcDocVersion = 1;
          try {
            vscodeRpcWs.send(JSON.stringify({
              jsonrpc: "2.0",
              method: "textDocument/didOpen",
              params: {
                textDocument: {
                  uri,
                  languageId: lang,
                  version: vscodeRpcDocVersion,
                  text: model.getValue()
                }
              }
            }));
          } catch (_) {
          }
        });
      } catch (_) {
      }
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
              jsonrpc: "2.0",
              method: "textDocument/didChange",
              params: {
                textDocument: { uri: vscodeRpcDocUri, version: vscodeRpcDocVersion },
                contentChanges: changes
              }
            };
            if (vscodeRpcChangeDebounceT) clearTimeout(vscodeRpcChangeDebounceT);
            vscodeRpcChangeDebounceT = setTimeout(function() {
              try {
                if (vscodeRpcWs && vscodeRpcWs.readyState === 1) vscodeRpcWs.send(JSON.stringify(payload));
              } catch (_) {
              }
            }, 120);
          } catch (_) {
          }
        });
      } catch (_) {
      }
    }
    function _forceSemanticHighlighting() {
      try {
        if (!editor) return;
        var svc = _getThemeService();
        if (!svc || typeof svc.getColorTheme !== "function") {
          console.log("[semanticTokens] could not find themeService on editor");
          return;
        }
        var theme = svc.getColorTheme();
        if (theme && !theme.semanticHighlighting) {
          Object.defineProperty(theme, "semanticHighlighting", { value: true, writable: true, configurable: true });
          console.log("[semanticTokens] forced semanticHighlighting=true on theme");
        }
      } catch (e) {
        console.warn("[semanticTokens] _forceSemanticHighlighting error", e);
      }
    }
    function _getThemeService() {
      try {
        if (!editor) return null;
        var svc = editor._themeService;
        if (!svc && editor._instantiationService) {
          try {
            svc = editor._instantiationService.invokeFunction(function(a) {
              return a.get && a.get({ toString: function() {
                return "standaloneThemeService";
              } });
            });
          } catch (_) {
          }
        }
        if (!svc) {
          var keys = Object.keys(editor);
          for (var ki = 0; ki < keys.length; ki++) {
            try {
              var v = editor[keys[ki]];
              if (v && typeof v === "object" && typeof v.getColorTheme === "function") {
                svc = v;
                break;
              }
            } catch (_) {
            }
          }
        }
        return svc || null;
      } catch (_) {
        return null;
      }
    }
    function _patchSemanticTokenColorIndices(caller) {
      var tag = "[semanticTokens:patch" + (caller ? ":" + caller : "") + "]";
      try {
        let hexToRgb2 = function(hex2) {
          var h2 = hex2.replace("#", "");
          if (h2.length === 3) h2 = h2[0] + h2[0] + h2[1] + h2[1] + h2[2] + h2[2];
          return [parseInt(h2.substr(0, 2), 16), parseInt(h2.substr(2, 2), 16), parseInt(h2.substr(4, 2), 16)];
        }, findNearestTmIndex2 = function(hex2) {
          var rgb = hexToRgb2(hex2);
          var bestIdx = 1;
          var bestDist = Infinity;
          for (var ti = 1; ti < tmColorMap.length; ti++) {
            if (!tmColorMap[ti]) continue;
            var trgb = hexToRgb2(String(tmColorMap[ti]).toLowerCase());
            var dr = rgb[0] - trgb[0], dg = rgb[1] - trgb[1], db = rgb[2] - trgb[2];
            var dist = dr * dr + dg * dg + db * db;
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = ti;
            }
            if (dist === 0) break;
          }
          return bestIdx;
        };
        var hexToRgb = hexToRgb2, findNearestTmIndex = findNearestTmIndex2;
        if (!tmRegistry) {
          console.log(tag, "SKIP: no tmRegistry");
          return;
        }
        var svc = _getThemeService();
        if (!svc) {
          console.log(tag, "SKIP: no themeService");
          return;
        }
        var theme = svc.getColorTheme();
        if (!theme) {
          console.log(tag, "SKIP: no theme");
          return;
        }
        if (!theme.tokenTheme) {
          console.log(tag, "SKIP: no theme.tokenTheme");
          return;
        }
        console.log(tag, "theme obj id=", theme.id || "?", "already patched=", !!theme._te2PatchedGetTokenStyleMetadata);
        var themeColorMap = theme.tokenTheme.getColorMap();
        if (!themeColorMap || !themeColorMap.length) {
          console.log(tag, "SKIP: empty themeColorMap");
          return;
        }
        var tmColorMap = tmRegistry.getColorMap();
        if (!tmColorMap || !tmColorMap.length) {
          console.log(tag, "SKIP: empty tmColorMap");
          return;
        }
        console.log(tag, "themeColorMap.length=" + themeColorMap.length, "tmColorMap.length=" + tmColorMap.length);
        var tmHexToIdx = {};
        for (var i = 0; i < tmColorMap.length; i++) {
          if (!tmColorMap[i]) continue;
          tmHexToIdx[String(tmColorMap[i]).toLowerCase()] = i;
        }
        var themeIdxToHex = [];
        for (var j = 0; j < themeColorMap.length; j++) {
          try {
            var hex = themeColorMap[j].toString().toLowerCase();
            themeIdxToHex[j] = hex;
          } catch (_) {
            themeIdxToHex[j] = null;
          }
        }
        var sampleTheme = themeIdxToHex.slice(0, 6).map(function(h2, i2) {
          return i2 + ":" + h2;
        }).join(" ");
        var sampleTm = tmColorMap.slice(0, 6).map(function(h2, i2) {
          return i2 + ":" + (h2 || "").toLowerCase();
        }).join(" ");
        console.log(tag, "themeHex sample:", sampleTheme);
        console.log(tag, "tmHex sample:", sampleTm);
        var indexTranslation = [];
        var translatedCount = 0;
        var unmatchedHexes = [];
        var nearestMapped = [];
        for (var k = 0; k < themeIdxToHex.length; k++) {
          var h = themeIdxToHex[k];
          if (h && tmHexToIdx[h] !== void 0) {
            indexTranslation[k] = tmHexToIdx[h];
            if (indexTranslation[k] !== k) translatedCount++;
          } else if (h) {
            var nearest = findNearestTmIndex2(h);
            indexTranslation[k] = nearest;
            translatedCount++;
            if (nearestMapped.length < 5) nearestMapped.push(k + ":" + h + "->" + nearest + ":" + (tmColorMap[nearest] || "?").toLowerCase());
          } else {
            indexTranslation[k] = k;
          }
        }
        if (nearestMapped.length > 0) {
          console.log(tag, "nearest-color mapped:", nearestMapped.join(" "));
        }
        if (translatedCount === 0) {
          console.log(tag, "no index translation needed (themeColors=" + themeColorMap.length + ", tmColors=" + tmColorMap.length + ")");
          if (themeIdxToHex.length > 1 && tmColorMap.length > 1) {
            console.log(tag, "DEBUG themeHex[1]=" + themeIdxToHex[1] + " tmHex[1]=" + tmColorMap[1].toLowerCase());
          }
          return;
        }
        var origMethod = theme._te2OrigGetTokenStyleMetadata || theme.getTokenStyleMetadata;
        if (!origMethod) {
          console.log(tag, "SKIP: no getTokenStyleMetadata method");
          return;
        }
        theme._te2OrigGetTokenStyleMetadata = origMethod;
        theme._te2PatchedGetTokenStyleMetadata = true;
        theme.getTokenStyleMetadata = function(type, modifiers, modelLanguage) {
          var result = origMethod.call(this, type, modifiers, modelLanguage);
          if (result && typeof result.foreground === "number") {
            var orig = result.foreground;
            if (orig >= 0 && orig < indexTranslation.length) {
              result.foreground = indexTranslation[orig];
            }
          }
          return result;
        };
        console.log(tag, "PATCHED getTokenStyleMetadata, translated " + translatedCount + "/" + themeIdxToHex.length + " color indices");
        try {
          if (theme.tokenTheme) {
            if (typeof theme.tokenTheme.setColorIndexTranslation === "function") {
              theme.tokenTheme.setColorIndexTranslation(indexTranslation);
            } else {
              theme.tokenTheme._colorIndexTranslation = indexTranslation;
              if (theme.tokenTheme._cache && typeof theme.tokenTheme._cache.clear === "function") {
                theme.tokenTheme._cache.clear();
              }
            }
            console.log(tag, "SET tokenTheme colorIndexTranslation for Monarch fix (" + indexTranslation.length + " entries)");
          }
        } catch (monarchErr) {
          console.warn(tag, "tokenTheme colorIndexTranslation failed", monarchErr);
        }
      } catch (e) {
        console.warn(tag, "FAILED", e);
      }
    }
    function ensureEditor() {
      if (editor) return;
      var el = getEditorContainer();
      if (!el || !window.monaco) return;
      editor = monaco.editor.create(el, buildMonacoOptionsFromPrefs(cachedPrefs));
      try {
        _forceSemanticHighlighting();
      } catch (_) {
      }
      try {
        installMarkerNavBindings(window.monaco, editor, function(dir) {
          jumpToMarker(window.monaco, editor, model, dir);
        });
      } catch (_) {
      }
      _syncReadOnlyInputMode(editor);
      editor.onDidChangeConfiguration(function() {
        _onEditorConfigChanged(editor);
      });
      updateDebug();
    }
    function disposeDiffEditorOnly() {
      try {
        if (mirrorPublisherDisposable && mirrorPublisherDisposable.dispose) {
          mirrorPublisherDisposable.dispose();
        }
      } catch (_) {
      }
      mirrorPublisherDisposable = null;
      installMirrorPublisher._done = false;
      _trace.mirror_active = 0;
      _syncTraceDebug();
      try {
        if (diffEditor && diffEditor.setModel) {
          diffEditor.setModel(null);
        }
      } catch (_) {
      }
      try {
        if (diffEditor && diffEditor.dispose) diffEditor.dispose();
      } catch (_) {
      }
      diffEditor = null;
      draftDecoCollection = null;
      draftDecoIds = [];
      draftZoneIds = [];
      installScrollPublisher._done = false;
    }
    function disposePlainEditorOnly() {
      try {
        if (mirrorPublisherDisposable && mirrorPublisherDisposable.dispose) {
          mirrorPublisherDisposable.dispose();
        }
      } catch (_) {
      }
      mirrorPublisherDisposable = null;
      installMirrorPublisher._done = false;
      _trace.mirror_active = 0;
      _syncTraceDebug();
      try {
        if (editor && editor.dispose) editor.dispose();
      } catch (_) {
      }
      editor = null;
      draftDecoCollection = null;
      draftDecoIds = [];
      draftZoneIds = [];
      installScrollPublisher._done = false;
    }
    function disposeGitBaselines() {
      try {
        if (diffEditor && diffEditor.setModel) {
          diffEditor.setModel(null);
        }
      } catch (_) {
      }
      try {
        if (gitHeadModel && gitHeadModel.dispose) gitHeadModel.dispose();
      } catch (_) {
      }
      try {
        if (gitDiskModel && gitDiskModel.dispose) gitDiskModel.dispose();
      } catch (_) {
      }
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
    function _vscodeThemeToMonacoTheme(themeId, vscodeJson) {
      return vscodeThemeToMonacoTheme(themeId, vscodeJson);
    }
    var vscodeApiWs = null;
    var vscodeApiConnecting = null;
    var vscodeApiNextId = 1;
    var vscodeApiPending = /* @__PURE__ */ new Map();
    var vscodeApiHandlers = /* @__PURE__ */ new Map();
    var vscodeLanguagesInstalled = false;
    var vscodeLanguageIds = /* @__PURE__ */ new Set();
    var vscodeLanguageByExtension = /* @__PURE__ */ new Map();
    var vscodeLanguageByFilename = /* @__PURE__ */ new Map();
    async function ensureVscodeApiWs() {
      if (vscodeApiWs && vscodeApiWs.readyState === WebSocket.OPEN) return vscodeApiWs;
      if (vscodeApiConnecting) return vscodeApiConnecting;
      vscodeApiConnecting = (async function() {
        await startVscodeApiService(_fetch);
        var wsPath = await discoverVscodeApiWsPath(_fetch, setTimeout);
        var wsUrl = buildVscodeApiWsUrl(location, wsPath);
        var ws = new WebSocket(wsUrl);
        vscodeApiWs = ws;
        try {
        } catch (_) {
        }
        ws.onmessage = function(ev) {
          handleVscodeApiMessageData(ev.data, vscodeApiPending, vscodeApiHandlers);
        };
        ws.onclose = function() {
          vscodeApiWs = null;
          vscodeApiConnecting = null;
          rejectAndClearVscodeApiPending(vscodeApiPending, "vscode_api ws closed");
        };
        await new Promise(function(resolve, reject) {
          var t = setTimeout(function() {
            reject(new Error("vscode_api ws connect timeout"));
          }, 8e3);
          ws.onopen = function() {
            clearTimeout(t);
            resolve();
          };
          ws.onerror = function() {
            clearTimeout(t);
            reject(new Error("vscode_api ws error"));
          };
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
      var timeoutMs = 12e3;
      try {
        if (opts && Number.isFinite(Number(opts.timeoutMs))) timeoutMs = Math.max(250, Number(opts.timeoutMs));
      } catch (_) {
      }
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
        installVscodeLanguagesLoop(langs, normalizeLanguage, function(l, langId) {
          registerVscodeLanguageId(window.monaco, vscodeLanguageIds, langId, l);
          mapVscodeLanguageExtensions(vscodeLanguageByExtension, l.extensions, langId);
          mapVscodeLanguageFilenames(vscodeLanguageByFilename, l.filenames, langId);
          applyVscodeLanguageConfiguration(window.monaco, langId, l.configuration_raw, parseJsonc);
        });
        vscodeLanguagesInstalled = true;
        finalizeVscodeLanguagesInstall(langs, vscodeLanguageByExtension, vscodeLanguageByFilename, installVscodeApiLanguageBridgeProviders);
        return true;
      } catch (e) {
        console.warn("[VSIX][Languages] list failed", e);
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
        toMonacoThemeFn: _vscodeThemeToMonacoTheme
      });
    }
    async function applyMonacoTheme(themeKey) {
      var activeTheme = await applyMonacoThemeRuntime({
        win: window,
        doc: document,
        themeKey,
        ensureTe2DiffThemeFn: ensureTe2DiffTheme,
        loadThemesFn: loadVscodeTextmateThemes,
        resolveThemeIdFn: function(k, c) {
          return resolveMonacoThemeId(k, c || {});
        },
        getThemeJsonUrlFn: _getVscodeThemeJsonUrl,
        fetchFn: _fetch,
        toMonacoThemeFn: _vscodeThemeToMonacoTheme,
        getJsonCacheFn: function() {
          return loadVscodeTextmateThemes._jsonCache || {};
        },
        setJsonCacheFn: function(cache) {
          loadVscodeTextmateThemes._jsonCache = cache || {};
        },
        applyThemeToTextmateRegistryFn: _applyThemeToTextmateRegistry
      });
      if (activeTheme) tmActiveThemeJson = activeTheme;
      _forceSemanticHighlighting();
      try {
        _patchSemanticTokenColorIndices("applyMonacoTheme");
      } catch (_) {
      }
      try {
        var models = window.monaco.editor.getModels();
        for (var mi = 0; mi < models.length; mi++) {
          if (models[mi] && typeof models[mi].resetTokenization === "function") {
            models[mi].resetTokenization();
          }
        }
      } catch (_) {
      }
    }
    function emitToHost(eventName, payload) {
      return emitToHostSocket(editorSocket, eventName, payload);
    }
    function requestGitBaselines(opts) {
      return requestGitBaselinesDebounced({
        immediate: !!(opts && opts.immediate),
        reason: opts && opts.reason ? String(opts.reason) : "unknown",
        timer: gitBaselineDebounceT,
        setTimerFn: function(t) {
          gitBaselineDebounceT = t;
        },
        noteRequestFn: _noteGitBaselineRequest,
        emitNowFn: _emitGitBaselineRequestNow,
        debounceMs: _gitBaselineDebounceMs(),
        setTimeoutFn: setTimeout,
        clearTimeoutFn: clearTimeout
      });
    }
    function applyGitBaselines(payload) {
      try {
        if (!payload || !payload.path || !currentPath) {
          console.log("[GitBaselines] skip: no path/currentPath");
          return;
        }
        if (String(payload.path) !== String(currentPath)) {
          console.log("[GitBaselines] skip: path mismatch", payload.path, currentPath);
          return;
        }
        if (!window.monaco) {
          console.log("[GitBaselines] skip: no monaco");
          return;
        }
        var baselineIdleMs = _gitBaselineApplyIdleMs();
        if (baselineIdleMs > 0 && diffEditor && lastLocalEditAt > 0) {
          var ageMs = Date.now() - lastLocalEditAt;
          if (ageMs < baselineIdleMs) {
            console.log("[GitBaselines] deferred by idle guard, ageMs=" + ageMs + " threshold=" + baselineIdleMs);
            pendingGitBaselinePayload = payload;
            _schedulePendingGitBaselineApply();
            setDebugGit("git=defer " + String(baselineIdleMs - ageMs) + "ms");
            return;
          }
        }
        lastGitBaselines = payload;
        var savedScrollTop = null;
        var savedPosition = null;
        try {
          var activeEd = diffEditor && diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : editor;
          if (activeEd) {
            savedScrollTop = activeEd.getScrollTop();
            savedPosition = activeEd.getPosition();
          }
        } catch (_) {
        }
        if (!getShowInlineDiffs()) {
          disposeGitBaselines();
          if (diffEditor) ensurePlainEditorWithPrefs();
          return;
        }
        var tracked = !!payload.tracked;
        var head = typeof payload.head_content === "string" ? payload.head_content : null;
        var disk = typeof payload.disk_content === "string" ? payload.disk_content : "";
        var headSha = typeof payload.head_sha256 === "string" ? payload.head_sha256 : null;
        var diskSha = typeof payload.disk_sha256 === "string" ? payload.disk_sha256 : null;
        var hasGitDiff = !!(tracked && head != null && headSha && diskSha && headSha !== diskSha);
        if (!hasGitDiff) {
          head = model && model.getValue ? model.getValue() : "";
        }
        var lang = languageFromPath(currentPath);
        if (!gitHeadModel) {
          console.log("[GitBaselines] creating new gitHeadModel");
          gitHeadModel = monaco.editor.createModel(head || "", lang);
        } else {
          var nextHead = head || "";
          try {
            var curHead = gitHeadModel.getValue ? String(gitHeadModel.getValue()) : "";
            var headChanged = curHead !== String(nextHead);
            console.log("[GitBaselines] gitHeadModel update: changed=" + headChanged + " curLen=" + curHead.length + " nextLen=" + nextHead.length);
            if (headChanged) {
              gitHeadModel.setValue(nextHead);
            }
          } catch (_) {
            try {
              gitHeadModel.setValue(nextHead);
            } catch (_2) {
            }
          }
          try {
            monaco.editor.setModelLanguage(gitHeadModel, lang);
          } catch (_) {
          }
        }
        if (!gitDiskModel) {
          gitDiskModel = monaco.editor.createModel(disk || "", lang);
        } else {
          var nextDisk = disk || "";
          try {
            if (!gitDiskModel.getValue || String(gitDiskModel.getValue()) !== String(nextDisk)) {
              gitDiskModel.setValue(nextDisk);
            }
          } catch (_) {
            try {
              gitDiskModel.setValue(nextDisk);
            } catch (_2) {
            }
          }
          try {
            monaco.editor.setModelLanguage(gitDiskModel, lang);
          } catch (_) {
          }
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
              needsFlagRebind = curAutoSave !== desiredAutoSave || curFreeze !== desiredFreeze || curHasBaseline !== desiredHasBaseline;
              console.log("[GitBaselines] models match: needsSetModel=false needsFlagRebind=" + needsFlagRebind + " hasGitDiff=" + hasGitDiff);
            } else {
              console.log("[GitBaselines] models differ: needsSetModel=true");
            }
          }
        } catch (_) {
        }
        if (needsSetModel || needsFlagRebind) {
          try {
            var modViewState = null;
            try {
              var modEd = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
              if (modEd) modViewState = modEd.saveViewState();
            } catch (_) {
            }
            var diffModel = {
              original: gitHeadModel,
              modified: model,
              te2AutosaveMode: desiredAutoSave
            };
            if (!desiredAutoSave) {
              var baselineContent = model.getValue ? model.getValue() : "";
              var baselineLang = model.getLanguageId ? model.getLanguageId() : "plaintext";
              diffModel.modifiedBaseline = monaco.editor.createModel(baselineContent, baselineLang);
              diffModel.te2FreezeProjection = true;
            }
            diffEditor.setModel(diffModel);
            try {
              if (modViewState) {
                var modEd2 = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
                if (modEd2) modEd2.restoreViewState(modViewState);
              }
            } catch (_) {
            }
            setDebugFlags("flags=set as=" + (desiredAutoSave ? "1" : "0") + " fr=" + (desiredFreeze ? "1" : "0") + " mb=" + (desiredHasBaseline ? "1" : "0"));
          } catch (e) {
            console.warn("[Monaco] diffEditor.setModel failed", e);
            disposeGitBaselines();
            ensurePlainEditorWithPrefs();
            return;
          }
        }
        applyLineNumberSizing();
        _layoutEditors();
        try {
          _installDraftZoneOrderingHook();
        } catch (e) {
          console.warn("[DraftDiff] Failed to install zone ordering hook", e);
        }
        try {
          if (diffEditor && diffEditor.onDidUpdateDiff && !diffEditor.__te2DraftZoneOrderBound) {
            diffEditor.__te2DraftZoneOrderBound = true;
            diffEditor.onDidUpdateDiff(function() {
              try {
                if (getShowDraftDiffs()) setTimeout(function() {
                  reapplyDraftZones();
                }, 0);
              } catch (_) {
              }
            });
          }
        } catch (_) {
        }
        try {
          if (getShowDraftDiffs()) setTimeout(function() {
            reapplyDraftZones();
          }, 0);
        } catch (_) {
        }
        try {
          if (!diffEditor.__te2_onDidUpdateDiffBound && diffEditor.onDidUpdateDiff) {
            diffEditor.__te2_onDidUpdateDiffBound = true;
            diffEditor.onDidUpdateDiff(function() {
              try {
                var lc2 = null;
                try {
                  lc2 = diffEditor.getLineChanges ? diffEditor.getLineChanges() : null;
                } catch (_) {
                  lc2 = null;
                }
                var n2 = lc2 && lc2.length != null ? lc2.length : lc2 === null ? "null" : "0";
                setDebugGit("git=on lc=" + n2);
              } catch (_) {
              }
            });
          }
        } catch (_) {
        }
        try {
          var updateLc = function(tag) {
            try {
              var lc = null;
              try {
                lc = diffEditor.getLineChanges ? diffEditor.getLineChanges() : null;
              } catch (_) {
                lc = null;
              }
              var n = lc && lc.length != null ? lc.length : lc === null ? "null" : "0";
              setDebugGit("git=on lc=" + n + (tag ? " " + tag : ""));
              if (tag === "t800" && (lc === null || lc && lc.length === 0)) {
                try {
                  var res = null;
                  try {
                    res = diffEditor.getDiffComputationResult ? diffEditor.getDiffComputationResult() : null;
                  } catch (_) {
                    res = null;
                  }
                  var dm2 = null;
                  try {
                    dm2 = diffEditor.getModel ? diffEditor.getModel() : null;
                  } catch (_) {
                    dm2 = null;
                  }
                  console.warn("[Monaco][GitDiff] lc still empty after t800", {
                    path: currentPath,
                    tracked,
                    headSha,
                    diskSha,
                    hasGitDiff,
                    diffResult: res ? { identical: res.identical, quitEarly: res.quitEarly, changesLen: res.changes ? res.changes.length : null, changes2Len: res.changes2 ? res.changes2.length : null } : null,
                    modelKeys: dm2 ? Object.keys(dm2) : null,
                    hasModifiedBaselineKey: dm2 ? Object.prototype.hasOwnProperty.call(dm2, "modifiedBaseline") : null,
                    modifiedBaselineType: dm2 && dm2.modifiedBaseline ? typeof dm2.modifiedBaseline : null
                  });
                } catch (_) {
                }
              }
            } catch (_) {
            }
          };
          updateLc("t0");
          setTimeout(function() {
            updateLc("t200");
          }, 200);
          setTimeout(function() {
            updateLc("t800");
          }, 800);
        } catch (_) {
        }
        ensureTouchSelection("gitdiff");
        setTimeout(function() {
          ensureTouchSelection("gitdiff-tick");
        }, 0);
        if (savedScrollTop != null) {
          var _restoreScroll = function() {
            try {
              var restoreEd = diffEditor && diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : editor;
              if (restoreEd && savedScrollTop != null) restoreEd.setScrollTop(savedScrollTop);
              if (restoreEd && savedPosition) restoreEd.setPosition(savedPosition);
            } catch (_) {
            }
          };
          _restoreScroll();
          setTimeout(_restoreScroll, 50);
          setTimeout(_restoreScroll, 300);
        }
      } catch (e) {
        console.warn("[Monaco] applyGitBaselines failed", e);
      }
    }
    async function fetchSSOTState() {
      return await fetchJsonWithBase(fetch, apiBase, "/state", { cache: "no-store" });
    }
    async function ensureEditorWithPrefs() {
      if (editor) return editor;
      var el = getEditorContainer();
      if (!el || !window.monaco) return null;
      try {
        if (!cachedPrefs) cachedPrefs = await fetchSSOTState();
      } catch (e) {
        updateDebug("ssot=fail");
        throw e;
      }
      editor = monaco.editor.create(el, buildMonacoOptionsFromPrefs(cachedPrefs));
      try {
        _forceSemanticHighlighting();
      } catch (_) {
      }
      try {
        installMarkerNavBindings(window.monaco, editor, function(dir) {
          jumpToMarker(window.monaco, editor, model, dir);
        });
      } catch (_) {
      }
      try {
        var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
        var t = prefs && prefs.editor && prefs.editor.theme ? prefs.editor.theme : "";
        applyMonacoTheme(t);
      } catch (_) {
      }
      ensureTouchSelection("boot");
      _syncReadOnlyInputMode(editor);
      editor.onDidChangeConfiguration(function() {
        _onEditorConfigChanged(editor);
      });
      updateDebug("ssot=ok");
      ensureLayoutObserver();
      bindUIIPCEditorHooks();
      return editor;
    }
    function ensurePlainEditorWithPrefs() {
      var savedScrollTop = null;
      var savedPosition = null;
      if (diffEditor) {
        try {
          var me = diffEditor.getModifiedEditor();
          if (me) {
            savedScrollTop = me.getScrollTop();
            savedPosition = me.getPosition();
          }
        } catch (_) {
        }
        disposeDiffEditorOnly();
        editor = null;
      }
      if (editor) return editor;
      var el = getEditorContainer();
      if (!el || !window.monaco) return null;
      editor = monaco.editor.create(el, buildMonacoOptionsFromPrefs(cachedPrefs));
      try {
        _forceSemanticHighlighting();
      } catch (_) {
      }
      try {
        installMarkerNavBindings(window.monaco, editor, function(dir) {
          jumpToMarker(window.monaco, editor, model, dir);
        });
      } catch (_) {
      }
      try {
        var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
        var t = prefs && prefs.editor && prefs.editor.theme ? prefs.editor.theme : "";
        applyMonacoTheme(t);
      } catch (_) {
      }
      if (model) {
        try {
          editor.setModel(model);
        } catch (_) {
        }
        installMirrorPublisher();
        installScrollPublisher();
      }
      ensureTouchSelection("plain");
      _syncReadOnlyInputMode(editor);
      editor.onDidChangeConfiguration(function() {
        _onEditorConfigChanged(editor);
      });
      ensureLayoutObserver();
      _layoutEditors();
      try {
        if (savedScrollTop != null && editor) {
          editor.setScrollTop(savedScrollTop);
        }
        if (savedPosition && editor) {
          editor.setPosition(savedPosition);
        }
      } catch (_) {
      }
      bindUIIPCEditorHooks();
      return editor;
    }
    function ensureDiffEditorWithPrefs() {
      if (diffEditor) return diffEditor;
      var savedScrollTop = null;
      var savedPosition = null;
      try {
        if (editor) {
          savedScrollTop = editor.getScrollTop();
          savedPosition = editor.getPosition();
        }
      } catch (_) {
      }
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
      try {
        var opts = buildMonacoOptionsFromPrefs(cachedPrefs);
        var theme = null;
        try {
          theme = opts && opts.theme ? opts.theme : null;
        } catch (_) {
          theme = null;
        }
        try {
          if (opts) delete opts.theme;
        } catch (_) {
        }
        try {
          var diffOpts = Object.assign({}, opts || {}, { minimap: { enabled: false } });
          diffEditor.getModifiedEditor().updateOptions(diffOpts);
        } catch (_) {
        }
        try {
          var origOpts = Object.assign({}, opts || {}, { readOnly: true, contextmenu: false, minimap: { enabled: false } });
          diffEditor.getOriginalEditor().updateOptions(origOpts);
        } catch (_) {
        }
        try {
          var scrollOpts = { scrollbar: { vertical: "hidden", verticalScrollbarSize: 0, horizontal: "hidden", horizontalScrollbarSize: 0 } };
          diffEditor.getModifiedEditor().updateOptions(scrollOpts);
          diffEditor.getOriginalEditor().updateOptions(scrollOpts);
        } catch (_) {
        }
        if (theme) applyMonacoTheme(theme);
      } catch (_) {
      }
      editor = diffEditor.getModifiedEditor();
      if (model) {
        try {
          editor.setModel(model);
        } catch (_) {
        }
        installMirrorPublisher();
        installScrollPublisher();
      }
      try {
        if (currentPath) _bcRequestSymbols(currentPath);
      } catch (_) {
      }
      ensureTouchSelection("diff");
      _syncReadOnlyInputMode(diffEditor.getOriginalEditor());
      _syncReadOnlyInputMode(editor);
      editor.onDidChangeConfiguration(function() {
        _onEditorConfigChanged(editor);
      });
      ensureLayoutObserver();
      _layoutEditors();
      try {
        if (savedScrollTop != null && editor) {
          editor.setScrollTop(savedScrollTop);
        }
        if (savedPosition && editor) {
          editor.setPosition(savedPosition);
        }
      } catch (_) {
      }
      bindUIIPCEditorHooks();
      return diffEditor;
    }
    function _flushMirrorDebounce() {
      try {
        if (!mirrorDebounceT) return;
        clearTimeout(mirrorDebounceT);
        mirrorDebounceT = null;
        if (!model || !currentPath || !editorSocket || !editorSocket.connected) return;
        var content = model.getValue();
        editorSocket.emit("editor_mirror", {
          path: currentPath,
          content,
          base_sha256: baseSha256
        });
        _wbPublishDidChange(
          currentPath,
          content,
          model.getLanguageId ? model.getLanguageId() : "",
          _wbCurrentGeneration()
        );
      } catch (_) {
      }
    }
    function installMirrorPublisher() {
      if (!editor) return;
      try {
        if (installMirrorPublisher._done) return;
        try {
          if (mirrorPublisherDisposable && mirrorPublisherDisposable.dispose) {
            mirrorPublisherDisposable.dispose();
          }
        } catch (_) {
        }
        mirrorPublisherDisposable = editor.onDidChangeModelContent(function() {
          if (isApplyingRemote) return;
          if (!editorSocket || !editorSocket.connected) return;
          if (!currentPath || !model) return;
          lastLocalEditAt = Date.now();
          if (mirrorDebounceT) clearTimeout(mirrorDebounceT);
          mirrorDebounceT = setTimeout(function() {
            try {
              var content = model.getValue();
              editorSocket.emit("editor_mirror", {
                path: currentPath,
                content,
                base_sha256: baseSha256
              });
              _wbPublishDidChange(
                currentPath,
                content,
                model.getLanguageId ? model.getLanguageId() : "",
                _wbCurrentGeneration()
              );
            } catch (_) {
            }
            requestDraftDiff("local");
          }, _localMirrorDebounceMs());
        });
        installMirrorPublisher._done = true;
        _trace.mirror_active = 1;
        _trace.mirror_bind_total += 1;
        _syncTraceDebug();
      } catch (e) {
        console.warn("[Monaco] Failed to install mirror publisher", e);
      }
    }
    function ensureTouchSelection(reason) {
      try {
        if (!editor) return;
        if (!(window["monaco-touch-selection"] && window["monaco-touch-selection"].editorTouchSelectionHelp)) return;
        var dom = editor.getDomNode && editor.getDomNode();
        if (!dom) return;
        var hasUI = !!dom.querySelector(".monaco-editor-touch-selections");
        if (!hasUI) {
          window["monaco-touch-selection"].editorTouchSelectionHelp(editor);
          updateDebug("touch=reinit" + (reason ? ":" + reason : ""));
        }
      } catch (e) {
        console.warn("[MonacoTouchSelection] ensure failed", e);
      }
    }
    function _syncReadOnlyInputMode(ed) {
      syncReadOnlyInputMode(ed, monaco, document);
    }
    var _lastKnownReadOnly = null;
    function _onEditorConfigChanged(ed) {
      onEditorConfigChanged(ed, {
        syncReadOnlyInputModeFn: _syncReadOnlyInputMode,
        lastKnownReadOnly: _lastKnownReadOnly,
        setLastKnownReadOnlyFn: function(ro) {
          _lastKnownReadOnly = ro;
        },
        monacoRef: monaco,
        fetchFn: _fetch
      });
    }
    function updateDebug(extra) {
      try {
        if (!dbg) dbg = document.getElementById("fh-debug");
        if (!dbg) return;
        dbg.textContent = buildDebugMessage(dbg, editor, debugParts, extra);
      } catch (_) {
      }
    }
    function setDebugGit(s) {
      setDebugPart(debugParts, "git", s, updateDebug);
    }
    function setDebugDraft(s) {
      setDebugPart(debugParts, "draft", s, updateDebug);
    }
    function setDebugDiag(s) {
      setDebugPart(debugParts, "diag", s, updateDebug);
    }
    function setDebugFlags(s) {
      setDebugPart(debugParts, "flags", s, updateDebug);
    }
    function setDebugMirror(s) {
      setDebugPart(debugParts, "mirror", s, updateDebug);
    }
    function setDebugTrace(s) {
      setDebugPart(debugParts, "trace", s, updateDebug);
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
        draftDecoCollection,
        editor,
        draftDecoIds,
        setDebugDraftFn: setDebugDraft
      });
      draftDecoIds = next.draftDecoIds;
      lastDraftZones = next.lastDraftZones;
    }
    function clearDraftDiffZones() {
      draftZoneIds = clearDraftDiffZonesState(editor, draftZoneIds);
    }
    function applyDraftZones(zones) {
      lastDraftZones = zones && zones.length ? zones.slice() : null;
      clearDraftDiffZones();
      if (!zones || !zones.length || !editor || !editor.changeViewZones) return;
      isApplyingDraftZones = true;
      try {
        _ignoreNextModifiedViewZonesEvent = true;
        editor.changeViewZones(function(accessor) {
          for (var zi = 0; zi < zones.length; zi++) {
            var z = zones[zi];
            var node = document.createElement("div");
            node.className = "te2-draft-del-zone";
            node.textContent = z.text || "";
            node.style.whiteSpace = "pre";
            applyEditorTypography(node);
            try {
              var id = accessor.addZone({
                afterLineNumber: z.after,
                heightInLines: Math.max(1, z.lines || 1),
                domNode: node
              });
              draftZoneIds.push(id);
            } catch (_) {
            }
          }
        });
      } catch (_) {
      }
      isApplyingDraftZones = false;
    }
    function reapplyDraftZones() {
      try {
        if (isApplyingDraftZones) return;
        if (!lastDraftZones || !lastDraftZones.length) return;
        applyDraftZones(lastDraftZones);
      } catch (_) {
      }
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
            if (_reapplyDraftZonesScheduled) return;
            if (!getShowInlineDiffs()) return;
            if (!getShowDraftDiffs()) return;
            if (!lastDraftZones || !lastDraftZones.length) return;
            _reapplyDraftZonesScheduled = true;
            setTimeout(function() {
              _reapplyDraftZonesScheduled = false;
              try {
                reapplyDraftZones();
              } catch (_) {
              }
            }, 0);
          } catch (_) {
          }
        });
      } catch (_) {
      }
    }
    function applyEditorTypography(node) {
      try {
        if (!node || !editor || !window.monaco) return;
        var ff = null;
        var fs = null;
        var lh = null;
        try {
          ff = editor.getOption(monaco.editor.EditorOption.fontFamily);
        } catch (_) {
          ff = null;
        }
        try {
          fs = editor.getOption(monaco.editor.EditorOption.fontSize);
        } catch (_) {
          fs = null;
        }
        try {
          lh = editor.getOption(monaco.editor.EditorOption.lineHeight);
        } catch (_) {
          lh = null;
        }
        if (ff) node.style.fontFamily = ff;
        if (fs) node.style.fontSize = String(fs) + "px";
        if (lh) node.style.lineHeight = String(lh) + "px";
      } catch (_) {
      }
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
      } catch (_) {
      }
      return null;
    }
    function applyDraftDiffDecorations(payload) {
      try {
        let clampLine2 = function(n) {
          if (n < 1) return 1;
          if (n > lineCount) return lineCount;
          return n;
        };
        var clampLine = clampLine2;
        if (!payload || !payload.path || !currentPath) return;
        if (String(payload.path) !== String(currentPath)) return;
        if (!editor || !window.monaco || !model) return;
        if (!getShowDraftDiffs()) {
          clearDraftDiffDecorations();
          return;
        }
        var hunks = Array.isArray(payload.hunks) ? payload.hunks : [];
        var ms = payload.ms != null ? payload.ms : null;
        var debug = false;
        try {
          debug = !!window.__debugDraftDiffs;
        } catch (_) {
          debug = false;
        }
        var addLines = 0;
        var delLines = 0;
        var decorations = [];
        var zones = [];
        var lineCount = 0;
        try {
          lineCount = model.getLineCount ? model.getLineCount() : 0;
        } catch (_) {
          lineCount = 0;
        }
        if (!lineCount || lineCount < 1) {
          clearDraftDiffDecorations();
          setDebugDraft("draft=empty");
          return;
        }
        var debugLines = null;
        if (debug) {
          debugLines = [];
          console.groupCollapsed("[DraftDiff] apply " + String(payload.path || "") + " hunks=" + String(hunks.length) + " lines=" + String(lineCount) + (ms != null ? " ms=" + String(ms) : ""));
        }
        for (var hi = 0; hi < hunks.length; hi++) {
          var h = hunks[hi];
          if (!h || !Array.isArray(h.lines)) continue;
          var oldLine = typeof h.oldStart === "number" ? h.oldStart : 1;
          var newLine = typeof h.newStart === "number" ? h.newStart : 1;
          if (debug && debugLines) {
            debugLines.push("hunk#" + hi + " oldStart=" + oldLine + " newStart=" + newLine + " lines=" + h.lines.length);
          }
          for (var li = 0; li < h.lines.length; li++) {
            var ln = h.lines[li];
            var t = ln && ln.type ? String(ln.type) : "";
            if (t === "context") {
              oldLine += 1;
              newLine += 1;
              continue;
            }
            if (t === "add-draft") {
              addLines += 1;
              var lno = clampLine2(newLine);
              if (lno < 1 || lno > lineCount) {
                newLine += 1;
                continue;
              }
              var lineLen = 0;
              try {
                lineLen = model.getLineLength(lno);
              } catch (_) {
                lineLen = 0;
              }
              if (debug && debugLines) {
                let sample = "";
                try {
                  sample = model.getLineContent(lno);
                  if (sample && sample.length > 140) sample = sample.slice(0, 140) + "\u2026";
                } catch (_) {
                }
                debugLines.push("  add hunk#" + hi + " line#" + li + " newLine=" + newLine + " -> lno=" + lno + " len=" + lineLen + " sample=" + JSON.stringify(sample));
              }
              decorations.push({
                range: new monaco.Range(lno, 1, lno, 1),
                options: { isWholeLine: true, className: "te2-draft-add-line" }
              });
              newLine += 1;
              continue;
            }
            if (t === "del-draft") {
              var anchor = clampLine2(newLine);
              if (anchor < 1 || anchor > lineCount) {
                oldLine += 1;
                continue;
              }
              var delBlock = [];
              var delBlockPreview = [];
              var blockStartLi = li;
              while (li < h.lines.length) {
                var ln2 = h.lines[li];
                var t2 = ln2 && ln2.type ? String(ln2.type) : "";
                if (t2 !== "del-draft") break;
                delLines += 1;
                var txt = ln2 && typeof ln2.text === "string" ? ln2.text : "";
                delBlock.push(txt);
                if (debug && debugLines) {
                  const prev = txt.length > 140 ? txt.slice(0, 140) + "\u2026" : txt;
                  delBlockPreview.push(prev);
                }
                oldLine += 1;
                li += 1;
              }
              li -= 1;
              if (debug && debugLines) {
                let sample2 = "";
                try {
                  sample2 = model.getLineContent(anchor);
                  if (sample2 && sample2.length > 140) sample2 = sample2.slice(0, 140) + "\u2026";
                } catch (_) {
                }
                debugLines.push(
                  "  del-block hunk#" + hi + " lines#" + blockStartLi + "-" + li + " newLine=" + newLine + " anchor=" + anchor + " count=" + delBlock.length + " del=" + JSON.stringify(delBlockPreview.join("\\n")) + " sample=" + JSON.stringify(sample2)
                );
              }
              decorations.push({
                range: new monaco.Range(anchor, 1, anchor, 1),
                options: {
                  // Only render a gutter marker for deletions; avoid tinting the line itself.
                  // In "replace" hunks (del+add at same anchor), line tint would mix with the
                  // insertion highlight and make the first inserted line look wrong.
                  isWholeLine: false,
                  linesDecorationsClassName: "te2-draft-del-marker"
                }
              });
              zones.push({
                after: anchor - 1,
                text: delBlock.join("\n"),
                lines: delBlock.length
              });
              continue;
            }
            oldLine += 1;
            newLine += 1;
          }
        }
        if (debug && debugLines) {
          try {
            const lines = decorations.map((d) => d && d.range ? d.range.startLineNumber : null).filter((n) => typeof n === "number").sort((a, b) => a - b);
            let overlaps = 0;
            for (let i = 1; i < lines.length; i++) if (lines[i] === lines[i - 1]) overlaps++;
            console.log("[DraftDiff] summary add=" + addLines + " del=" + delLines + " decorations=" + decorations.length + " zones=" + zones.length + " overlaps=" + overlaps);
          } catch (_) {
          }
          for (let i = 0; i < debugLines.length; i++) console.log("[DraftDiff] " + debugLines[i]);
          console.groupEnd();
        }
        var coll = _ensureDraftDecoCollection();
        if (coll && coll.set) {
          coll.set(decorations);
        } else if (editor && editor.deltaDecorations) {
          draftDecoIds = editor.deltaDecorations(draftDecoIds, decorations);
        }
        applyDraftZones(zones);
        try {
          if (getShowInlineDiffs()) _installDraftZoneOrderingHook();
        } catch (e) {
          console.warn("[DraftDiff] Failed to install zone ordering hook", e);
        }
        var tag = "draft=+" + addLines + " -" + delLines;
        if (ms != null) tag += " " + String(ms) + "ms";
        setDebugDraft(tag);
        if (payload && payload.error) console.warn("[DraftDiff] error", payload.error);
      } catch (e) {
        console.warn("[DraftDiff] apply failed", e);
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
            draftDiffRequestId = String(Date.now()) + ":" + String(Math.random()).slice(2);
            editorSocket.emit("editor_draft_diff_request", { path: currentPath, requestId: draftDiffRequestId, reason: reason || "" });
          } catch (_) {
          }
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
        console.warn("[Monaco] SSOT unavailable; cannot open file", e);
        return;
      }
      var autoSave = resolveAutoSaveFromPrefs(cachedPrefs);
      var cache = await fetchOpenCache(fetchJsonWithBase, fetch, apiBase, absPath);
      var openData = await resolveOpenContent(fetchJsonWithBase, fetch, apiBase, absPath, cache);
      var hasDraft = !!openData.hasDraft;
      var content = openData.content;
      var sha256 = openData.sha256;
      var lang = resolveOpenLanguage(preferredLanguage, absPath, normalizeLanguage, languageFromPath);
      if (!model) {
        model = initOpenModel(createFileModel2, editor, content, lang, absPath, function(nextModel, nextLang, nextPath) {
          applyLanguageToModel(nextModel, nextLang, nextPath);
          installMirrorPublisher();
          installScrollPublisher();
          vscodeRpcDidOpenIfReady();
          installVscodeRpcChangePublisher();
        });
      } else {
        try {
          if (shouldRecreateOpenModel(window.monaco, monacoFileUri, model, absPath)) {
            if (diffEditor) {
              try {
                diffEditor.setModel(null);
              } catch (_) {
              }
            }
            try {
              model.dispose();
            } catch (_) {
            }
            model = initOpenModel(createFileModel2, editor, content, lang, absPath, function(nextModel, nextLang, nextPath) {
              applyLanguageToModel(nextModel, nextLang, nextPath);
              installMirrorPublisher();
              installScrollPublisher();
              vscodeRpcDidOpenIfReady();
              installVscodeRpcChangePublisher();
            });
          } else {
            applyOpenModelTextSafely(model, editor, content, function(v) {
              isApplyingRemote = !!v;
            });
            applyLanguageToModel(model, lang, absPath);
          }
        } catch (_) {
          applyOpenModelTextSafely(model, editor, content, function(v) {
            isApplyingRemote = !!v;
          });
          applyLanguageToModel(model, lang, absPath);
        }
      }
      currentPath = absPath;
      var backendGeneration = _wbBumpGeneration(currentPath, "openPathFromBackend");
      try {
        bcUpdatePath(currentPath, true);
      } catch (_) {
      }
      baseSha256 = sha256;
      emitOpenCacheState(emitToHost, absPath, hasDraft, sha256, autoSave);
      queueBackendWorkbenchOpen({
        currentPath,
        lang,
        model,
        generation: backendGeneration,
        queueDidChangeFn: _wbQueueDidChange,
        queueSymbolsFn: _wbQueueSymbols,
        openFileFlowFn: _wbOpenFileFlow
      });
      ensureTouchSelection("open-post");
      setTimeout(function() {
        ensureTouchSelection("open-tick");
      }, 0);
      updateDebug("open=ok");
    }
    function connectEditorSocket() {
      try {
        if (!window.io) return false;
        editorSocket = window.io("/editor", {
          path: "/editor_ws/socket.io",
          transports: ["websocket"],
          query: { app_id: "file_editor_cm6" }
        });
        editorSocket.on("connect", function() {
          editorSocketId = editorSocket.id || null;
          emitToHost("editor_ready", {});
          emitToHost("editor:iframe_ready", {});
          editorSocket.emit("editor_readiness_check", {});
        });
        editorSocket.on("editor:readiness_step", function(data) {
          handleReadinessStep(data, emitToHost, function() {
            window.__te2AdapterReady = true;
            _replayOpenFileAfterBaton();
          });
        });
        editorSocket.on("editor:ssot", function(snapshot) {
          try {
            try {
              var _t = typeof performance !== "undefined" && performance && typeof performance.now === "function" ? Math.round(performance.now() * 10) / 10 : null;
              console.log((_t != null ? "t=" + _t + "ms " : "") + "now=" + Date.now(), "[editor:ssot] rx", { hasFile: !!(snapshot && snapshot.file), currentPath: snapshot && snapshot.currentPath });
            } catch (_) {
            }
            cachedPrefs = snapshot;
            if (snapshot && snapshot.file) {
              var f = snapshot.file;
              baseSha256 = f.base_sha256 || baseSha256;
              currentPath = f.path || currentPath;
              var ssotGeneration = _wbBumpGeneration(currentPath, "ssot");
              try {
                bcUpdatePath(currentPath, true);
              } catch (_) {
              }
              ensureEditorWithPrefs().then(function() {
                var lang = languageFromPath(currentPath);
                if (!model) {
                  model = createFileModel2(f.content || "", lang, currentPath);
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
                      if (diffEditor) {
                        try {
                          diffEditor.setModel(null);
                        } catch (_) {
                        }
                      }
                      try {
                        model.dispose();
                      } catch (_) {
                      }
                      model = createFileModel2(f.content || "", lang, currentPath);
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
                        model.applyEdits([{ range: _ssotRange, text: f.content || "" }]);
                      } finally {
                        isApplyingRemote = false;
                      }
                      applyLanguageToModel(model, lang, currentPath);
                    }
                  } catch (_) {
                    isApplyingRemote = true;
                    try {
                      var _ssotRange2 = model.getFullModelRange();
                      model.applyEdits([{ range: _ssotRange2, text: f.content || "" }]);
                    } finally {
                      isApplyingRemote = false;
                    }
                    applyLanguageToModel(model, lang, currentPath);
                  }
                }
                ensureTouchSelection("ssot");
                try {
                  lastContentSha256 = f.content_sha256 || lastContentSha256;
                } catch (_) {
                }
                emitToHost("editor_cache_state", {
                  path: currentPath,
                  state: f.state,
                  unsaved: !!f.unsaved,
                  reason: f.reason,
                  content_sha256: f.content_sha256,
                  auto_save: f.auto_save
                });
                try {
                  if (f && f.scroll_line != null && !f.has_draft) {
                    applyJumpToLine(editor, model, { line: f.scroll_line, focus: false, scroll_to_top: true });
                  }
                } catch (_) {
                }
                if (f.has_draft) {
                  emitToHost("editor_draft_state", { has_draft: true, path: currentPath });
                  requestDraftDiff("ssot");
                } else {
                  clearDraftDiffDecorations();
                }
                updateDebug("ws=ssot");
                requestGitBaselines({ reason: "ssot" });
                try {
                  var ssotReqId = f && f.request_id ? String(f.request_id) : "diag_" + Date.now() + "_ssot";
                  var ssotText = "";
                  try {
                    ssotText = model && model.getValue ? model.getValue() : "";
                  } catch (_) {
                  }
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
                    uri: model && model.uri ? String(model.uri.toString()) : "",
                    requestId: ssotReqId,
                    forceRefresh: true,
                    generation: ssotGeneration,
                    source: "ssot",
                    timeoutMs: 8e3
                  }).catch(function() {
                  });
                } catch (_) {
                }
                try {
                  _applyCachedDiagnosticsForActive();
                } catch (_) {
                }
              });
            } else {
              updateDebug("ws=ssot-empty");
            }
          } catch (e) {
            console.warn("[Monaco] ssot apply failed", e);
          }
        });
        editorSocket.on("editor:open", function(payload) {
          try {
            if (!payload || !payload.path) return;
            try {
              var _t = typeof performance !== "undefined" && performance && typeof performance.now === "function" ? Math.round(performance.now() * 10) / 10 : null;
              console.log((_t != null ? "t=" + _t + "ms " : "") + "now=" + Date.now(), "[editor:open] rx", { path: payload.path, request_id: payload.request_id || "" });
            } catch (_) {
            }
            baseSha256 = payload.base_sha256 || baseSha256;
            currentPath = payload.path;
            var openGeneration = _wbBumpGeneration(currentPath, "editor:open");
            try {
              bcUpdatePath(currentPath, true);
            } catch (_) {
            }
            ensureEditorWithPrefs().then(function() {
              var lang = languageFromPath(currentPath);
              if (!model) {
                model = createFileModel2(payload.content || "", lang, currentPath);
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
                    if (diffEditor) {
                      try {
                        diffEditor.setModel(null);
                      } catch (_) {
                      }
                    }
                    try {
                      model.dispose();
                    } catch (_) {
                    }
                    model = createFileModel2(payload.content || "", lang, currentPath);
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
                      model.applyEdits([{ range: fullRange, text: payload.content || "" }]);
                    } finally {
                      isApplyingRemote = false;
                    }
                    applyLanguageToModel(model, lang, currentPath);
                  }
                } catch (_) {
                  isApplyingRemote = true;
                  try {
                    var fullRange2 = model.getFullModelRange();
                    model.applyEdits([{ range: fullRange2, text: payload.content || "" }]);
                  } finally {
                    isApplyingRemote = false;
                  }
                  applyLanguageToModel(model, lang, currentPath);
                }
              }
              applyLineNumberSizing();
              ensureTouchSelection("open");
              try {
                if (diffEditor && diffEditor.getModel) {
                  var dm = diffEditor.getModel();
                  if (dm && dm.te2FreezeProjection && dm.modifiedBaseline && model) {
                    var freshContent = model.getValue();
                    var freshLang = model.getLanguageId ? model.getLanguageId() : "plaintext";
                    dm.modifiedBaseline.setValue(freshContent);
                    var modViewState = null;
                    try {
                      var me = diffEditor.getModifiedEditor();
                      if (me) modViewState = me.saveViewState();
                    } catch (_) {
                    }
                    diffEditor.setModel(dm);
                    try {
                      if (modViewState) {
                        var me2 = diffEditor.getModifiedEditor();
                        if (me2) me2.restoreViewState(modViewState);
                      }
                    } catch (_) {
                    }
                  }
                }
              } catch (_) {
              }
              try {
                var openReqId = payload && payload.request_id ? String(payload.request_id) : "diag_" + Date.now() + "_open";
                var openText = "";
                try {
                  openText = model && model.getValue ? model.getValue() : "";
                } catch (_) {
                }
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
                  uri: model && model.uri ? String(model.uri.toString()) : "",
                  requestId: openReqId,
                  forceRefresh: true,
                  generation: openGeneration,
                  source: "editor:open",
                  timeoutMs: 8e3
                }).catch(function() {
                });
              } catch (_) {
              }
              try {
                _applyCachedDiagnosticsForActive();
              } catch (_) {
              }
              try {
                if (payload.line != null) {
                  applyJumpToLine(editor, model, {
                    line: payload.line,
                    column: payload.column,
                    focus: payload.focus,
                    scroll_y: payload.scroll_y,
                    scroll_to_top: payload.scroll_to_top
                  });
                }
              } catch (_) {
              }
              try {
                lastContentSha256 = payload.content_sha256 || lastContentSha256;
              } catch (_) {
              }
              emitToHost("editor_cache_state", {
                path: currentPath,
                state: payload.state || "clean",
                unsaved: !!payload.unsaved,
                reason: payload.reason || "open",
                content_sha256: payload.content_sha256,
                auto_save: payload.auto_save
              });
              if (payload.has_draft) requestDraftDiff("open");
              else clearDraftDiffDecorations();
              try {
                if (payload.line == null && payload.scroll_line != null) {
                  applyJumpToLine(editor, model, { line: payload.scroll_line, focus: false, scroll_to_top: true });
                }
              } catch (_) {
              }
            });
            requestGitBaselines({ reason: "open" });
          } catch (e) {
            console.warn("[Monaco] open apply failed", e);
          }
        });
        editorSocket.on("editor:jump_to_line", function(payload) {
          handleJumpToLineEvent(editor, model, payload, applyJumpToLine);
        });
        editorSocket.on("editor:mirror", function(payload) {
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
            applyMirrorContentToModel(model, payload.content, function(v) {
              isApplyingRemote = !!v;
            });
            try {
              lastContentSha256 = payload.content_sha256 || lastContentSha256;
            } catch (_) {
            }
            mirrorState.ap += 1;
            _syncMirrorDebug();
            applyLineNumberSizing();
            var mirrorUnsaved = payload.unsaved === true;
            _setUnsavedTrace("mirror", mirrorUnsaved);
            emitMirrorCacheState(emitToHost, payload, mirrorUnsaved);
            if (mirrorUnsaved) {
              requestDraftDiff("mirror");
            } else {
              clearDraftDiffDecorations();
            }
          } catch (e) {
            console.warn("[Monaco] mirror apply failed", e);
          }
        });
        editorSocket.on("editor:prefs_changed", function(payload) {
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
            try {
              theme = nextPrefs && nextPrefs.editor && nextPrefs.editor.theme ? nextPrefs.editor.theme : null;
            } catch (_) {
              theme = null;
            }
            try {
              if (opts) delete opts.theme;
            } catch (_) {
            }
            try {
              editor.updateOptions(opts || {});
            } catch (e) {
              console.warn("[Monaco] updateOptions failed", e);
            }
            applyLineNumberSizing();
            if (diffEditor && diffEditor.getOriginalEditor) {
              try {
                var origOpts = Object.assign({}, opts || {}, { readOnly: true, contextmenu: false, minimap: { enabled: false } });
                diffEditor.getOriginalEditor().updateOptions(origOpts);
                try {
                  var diffOpts = Object.assign({}, opts || {}, { minimap: { enabled: false } });
                  diffEditor.getModifiedEditor().updateOptions(diffOpts);
                } catch (_) {
                }
                try {
                  var scrollOpts = { scrollbar: { vertical: "hidden", verticalScrollbarSize: 0, horizontal: "hidden", horizontalScrollbarSize: 0 } };
                  diffEditor.getModifiedEditor().updateOptions(scrollOpts);
                  diffEditor.getOriginalEditor().updateOptions(scrollOpts);
                } catch (_) {
                }
              } catch (_) {
              }
            }
            if (theme) {
              applyMonacoTheme(theme);
            }
            ensureTouchSelection("prefs");
            _layoutEditors();
            updateDebug("prefs=ok");
            if (prevAutoSave !== nextAutoSave && diffEditor && diffEditor.getModel) {
              try {
                var dm = diffEditor.getModel ? diffEditor.getModel() : null;
                if (dm && dm.original && dm.modified) {
                  var _mvs = null;
                  try {
                    var _me = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : null;
                    if (_me) _mvs = _me.saveViewState();
                  } catch (_) {
                  }
                  var nextDiffModel = {
                    original: dm.original,
                    modified: dm.modified,
                    te2AutosaveMode: !!nextAutoSave
                  };
                  if (!nextAutoSave && dm.original === gitHeadModel && dm.modified === model) {
                    var baselineContent = model.getValue ? model.getValue() : "";
                    var baselineLang = model.getLanguageId ? model.getLanguageId() : "plaintext";
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
                  } catch (_) {
                  }
                }
              } catch (e2) {
                console.warn("[Monaco] autosave diff mode switch failed", e2);
              }
            }
            if (getShowInlineDiffs()) {
              requestGitBaselines({ immediate: true, reason: "prefs" });
            } else {
              disposeGitBaselines();
              if (diffEditor) ensurePlainEditorWithPrefs();
            }
            if (getShowDraftDiffs()) requestDraftDiff("prefs");
            else clearDraftDiffDecorations();
            ensureVscodeRpcConnected();
          } catch (e) {
            console.warn("[Monaco] prefs_changed apply failed", e);
          }
        });
        editorSocket.on("editor:git_baselines", function(payload) {
          handleGitBaselinesSocketEvent(payload, applyGitBaselines);
        });
        editorSocket.on("editor:draft_diff", function(payload) {
          try {
            handleDraftDiffEvent(payload, currentPath, draftDiffRequestId, applyDraftDiffDecorations);
          } catch (e) {
            console.warn("[DraftDiff] handler failed", e);
          }
        });
        editorSocket.on("editor:cache_state", function(payload) {
          try {
            if (!isCacheStatePayloadForCurrentPath(payload, currentPath)) return;
            if (isCacheStateClean(payload)) {
              handleCleanCacheState({
                payload,
                clearDraftDiffDecorationsFn: clearDraftDiffDecorations,
                getAutoSaveFn: getAutoSave,
                shouldSkipAutosaveFn: shouldSkipAutosaveBaselineRefresh,
                diffEditor,
                gitHeadModel,
                model,
                requestGitBaselinesFn: requestGitBaselines,
                resnapshotDraftBaselineFn: resnapshotDraftBaseline,
                monacoRef: monaco,
                setUnsavedTraceFn: _setUnsavedTrace
              });
              return;
            }
            if (isCacheStateUnsaved(payload)) {
              handleUnsavedCacheState(payload, _setUnsavedTrace, requestDraftDiff);
            }
          } catch (_) {
          }
        });
        editorSocket.on("editor:diagnostics", function(payload) {
          try {
            logDiagnosticsEvent(payload, model, currentPath, _absPathFromVscodeUri);
            applyDiagnosticsBridgeUpdate(payload, _applyDiagnosticsUpdate);
          } catch (_) {
          }
        });
        editorSocket.on("editor:workbench_open_file_response", function(data) {
          try {
            handleWorkbenchResponseEvent(data, _wbPending, clearTimeout);
          } catch (_) {
          }
        });
        editorSocket.on("editor:workbench_hover_response", function(data) {
          try {
            handleWorkbenchResponseEvent(data, _wbPending, clearTimeout);
          } catch (_) {
          }
        });
        editorSocket.on("editor:workbench_symbols_response", function(data) {
          try {
            handleWorkbenchResponseEvent(data, _wbPending, clearTimeout);
          } catch (_) {
          }
        });
        editorSocket.on("editor:workbench_completions_response", function(data) {
          try {
            handleWorkbenchResponseEvent(data, _wbPending, clearTimeout);
          } catch (_) {
          }
        });
        editorSocket.on("editor:workbench_semantic_tokens_response", function(data) {
          try {
            handleWorkbenchResponseEvent(data, _wbPending, clearTimeout);
          } catch (_) {
          }
        });
        editorSocket.on("editor:workbench_semantic_tokens_legend_response", function(data) {
          try {
            handleWorkbenchResponseEvent(data, _wbPending, clearTimeout);
          } catch (_) {
          }
        });
        editorSocket.on("editor:workbench_semantic_tokens_range_response", function(data) {
          try {
            handleWorkbenchResponseEvent(data, _wbPending, clearTimeout);
          } catch (_) {
          }
        });
        editorSocket.on("editor:semantic_tokens_provider_registered", function(data) {
          try {
            handleSemanticTokensProviderRegistered(data, languageBridge, _registerSemanticTokensWithLegend);
          } catch (_) {
          }
        });
        editorSocket.on("editor:issues_dump_request", function(payload) {
          try {
            handleIssuesDumpRequest(payload, monaco, model, emitToHost);
          } catch (e) {
            console.warn("[Monaco] issues dump response failed", e);
          }
        });
        editorSocket.on("editor:issues_cmd", function(payload) {
          try {
            handleIssuesCommand(payload, editor, runIssuesCommand);
          } catch (_) {
          }
        });
        editorSocket.on("editor:find_cmd", function(payload) {
          try {
            handleFindCommand(payload, editor, runFindCommand);
          } catch (e) {
            console.error("[Find] error:", e);
          }
        });
        return true;
      } catch (e) {
        console.warn("[Monaco] socket connect failed", e);
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
            editorSocket.emit("editor_scroll_state", payload);
            lastSentAt = Date.now();
            try {
              bcUpdateCursor(payload.cursorLine);
            } catch (_) {
            }
          } catch (_) {
          }
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
          } catch (_) {
          }
        };
        editor.onDidScrollChange(schedule);
        editor.onDidChangeCursorPosition(schedule);
      } catch (_) {
      }
    }
    function applyMirror(data) {
      if (!data) return;
      ensureEditor();
      ensureTouchSelection("mirror-pre");
      if (!editor) return;
      var nextPath = typeof data.path === "string" && data.path ? data.path : null;
      if (!shouldApplyMirrorPath(currentPath, nextPath)) return;
      var content = typeof data.content === "string" ? data.content : "";
      try {
        applyMirrorContent(model, editor, content);
      } catch (_) {
      }
      ensureTouchSelection("mirror-post");
      setTimeout(function() {
        ensureTouchSelection("mirror-tick");
      }, 0);
    }
    var _bcEl = null;
    var _bcSymbols = [];
    var _bcLastPath = null;
    var _bcSymbolsSeq = 0;
    var _bcGetIcon = null;
    function bcInit() {
      _bcEl = initBreadcrumbElement(document);
      loadBreadcrumbIcons(function(path) {
        return import(path);
      }, function(getIcon) {
        _bcGetIcon = getIcon;
        if (_bcLastPath) _bcRender();
      }, function(e) {
        console.warn("[BC] seti-icons load failed:", e);
      });
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
      var generation = opts && Number.isFinite(Number(opts.generation)) ? Number(opts.generation) : _wbCurrentGeneration();
      if (!editorSocket || !editorSocket.connected) return;
      if (!_wbIsBarrierOpen(absPath, generation)) {
        _wbQueueSymbols(absPath, generation);
        return;
      }
      var seq = ++_bcSymbolsSeq;
      var langId = resolveBreadcrumbSymbolsLangId(model, absPath, languageFromPath);
      if (langId === "plaintext") {
        _bcSymbols = [];
        _bcRender();
        return;
      }
      var tms = getBreadcrumbSymbolsTimeoutMs(langId);
      editorWorkbenchCall("symbols", {
        path: absPath,
        languageId: langId,
        generation
      }, { timeoutMs: tms }).then(function(result) {
        if (seq !== _bcSymbolsSeq) return;
        if (generation !== _wbCurrentGeneration()) return;
        if (String(absPath || "") !== String(currentPath || "")) return;
        _bcSymbols = unwrapBreadcrumbSymbols(result);
        console.log("[BC] symbols received:", _bcSymbols.length, _bcSymbols.slice(0, 2));
        _bcRender();
      }).catch(function(e) {
        console.warn("[BC] symbols request failed:", e);
      });
    }
    function bcUpdateCursor(line) {
      if (!_bcEl || !_bcLastPath) return;
      _bcRender(line);
    }
    function _bcFindSymbolChain(symbols, line) {
      return findBreadcrumbSymbolChain(symbols, line, symbolRangeToLineBounds);
    }
    var _SYM_CODICON = {
      1: ["codicon-symbol-file", "#8b949e"],
      // File
      2: ["codicon-symbol-module", "#bc8cff"],
      // Module
      3: ["codicon-symbol-namespace", "#bc8cff"],
      // Namespace
      4: ["codicon-symbol-package", "#f0883e"],
      // Package
      5: ["codicon-symbol-class", "#f0883e"],
      // Class
      6: ["codicon-symbol-method", "#bc8cff"],
      // Method
      7: ["codicon-symbol-property", "#4da6ff"],
      // Property
      8: ["codicon-symbol-field", "#4da6ff"],
      // Field
      9: ["codicon-symbol-constructor", "#bc8cff"],
      // Constructor
      10: ["codicon-symbol-enum", "#f0883e"],
      // Enum
      11: ["codicon-symbol-interface", "#4da6ff"],
      // Interface
      12: ["codicon-symbol-function", "#bc8cff"],
      // Function
      13: ["codicon-symbol-variable", "#4da6ff"],
      // Variable
      14: ["codicon-symbol-constant", "#4da6ff"],
      // Constant
      15: ["codicon-symbol-string", "#f0883e"],
      // String
      16: ["codicon-symbol-number", "#a6e22e"],
      // Number
      17: ["codicon-symbol-boolean", "#4da6ff"],
      // Boolean
      18: ["codicon-symbol-array", "#f0883e"],
      // Array
      19: ["codicon-symbol-object", "#8b949e"],
      // Object
      22: ["codicon-symbol-enum-member", "#f0883e"],
      // EnumMember
      23: ["codicon-symbol-struct", "#f0883e"],
      // Struct
      25: ["codicon-symbol-operator", "#8b949e"],
      // Operator
      26: ["codicon-symbol-type-parameter", "#a6e22e"]
      // TypeParameter
    };
    function _bcSymbolSvg(kind) {
      return breadcrumbSymbolIcon(kind, _SYM_CODICON);
    }
    function _bcRender(cursorLine) {
      if (!_bcEl) return;
      _bcEl.innerHTML = "";
      if (!_bcLastPath) return;
      var parts = splitBreadcrumbPathParts(_bcLastPath);
      var accum = "";
      for (var i = 0; i < parts.length; i++) {
        accum += "/" + parts[i];
        if (i > 0) {
          appendBreadcrumbSeparator(document, _bcEl);
        }
        var isFile = isBreadcrumbFileSegment(i, parts.length);
        var item = createBreadcrumbPathItem(document, accum, isFile);
        if (isFile && _bcGetIcon) {
          var iconSpan = document.createElement("span");
          iconSpan.className = "te2-bc-icon";
          item.appendChild(iconSpan);
          applyBreadcrumbFileIcon(_bcGetIcon, iconSpan, parts[i], getBreadcrumbIconTheme());
        }
        var label = document.createElement("span");
        label.textContent = parts[i];
        item.appendChild(label);
        item.addEventListener("click", _bcOnPathClick);
        _bcEl.appendChild(item);
      }
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
          sitem.addEventListener("click", _bcOnSymbolClick);
          _bcEl.appendChild(sitem);
        }
      }
      finalizeBreadcrumbScroll(_bcEl);
    }
    function _bcOnPathClick(ev) {
      try {
        var target = getBreadcrumbPathClickTarget(ev);
        var isFile = target.isFile;
        if (isFile) return;
        var absDir = target.absDir;
        console.log("[BC] path click:", absDir, "socket connected:", !!(editorSocket && editorSocket.connected));
        if (editorSocket && editorSocket.connected) {
          editorSocket.emit("editor_breadcrumb_navigate", { path: absDir, open_drawer: true });
        }
      } catch (_) {
      }
    }
    function _bcOnSymbolClick(ev) {
      try {
        var p = getBreadcrumbSymbolClickPosition(ev);
        var line = p.line;
        var col = p.col;
        if (Number.isFinite(line)) {
          applyJumpToLine(editor, model, { line, column: col, focus: true, scroll_y: "center" });
        }
      } catch (_) {
      }
    }
    var uiIpcSocket = null;
    function connectUIIPC() {
      try {
        if (!window.io) return;
        uiIpcSocket = connectUiIpcSocket(window.io);
        uiIpcSocket.on("connect", function() {
          console.log("[UI_IPC] editor iframe connected");
          registerConsoleWorker(uiIpcSocket, "editor_iframe", "worker");
        });
        uiIpcSocket.on("ui_event", function(data) {
        });
        _initEditorConsoleBridge(uiIpcSocket);
      } catch (e) {
        console.warn("[UI_IPC] connect failed", e);
      }
    }
    var _consoleBridgeActive = false;
    function _initEditorConsoleBridge(sock) {
      if (_consoleBridgeActive) return;
      var LEVELS = ["log", "info", "warn", "error", "debug"];
      var workerId = "editor_iframe";
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
      sock.on("console:eval", function(msg) {
        handleConsoleEval(sock, workerId, msg);
      });
      _consoleBridgeActive = true;
      console.log("[console_bridge] editor iframe bridge active");
    }
    function bindUIIPCEditorHooks() {
      _bindEditorSaveKey();
      _bindEditorFocusRelay();
    }
    function _bindEditorSaveKey() {
      try {
        var ed = diffEditor && diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : editor;
        if (!ed || !window.monaco) return;
        bindSaveKeyCommand(ed, monaco, uiIpcSocket);
      } catch (_) {
      }
    }
    var _uiIpcFocusDisposable = null;
    function _bindEditorFocusRelay() {
      try {
        if (_uiIpcFocusDisposable) {
          try {
            _uiIpcFocusDisposable.dispose();
          } catch (_) {
          }
          _uiIpcFocusDisposable = null;
        }
        var ed = diffEditor && diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : editor;
        if (!ed) {
          console.warn("[focus_relay] no editor instance \u2014 skipping bind");
          return;
        }
        _uiIpcFocusDisposable = bindFocusRelay(ed, uiIpcSocket);
        console.log("[focus_relay] bound to editor widget");
      } catch (e) {
        console.warn("[focus_relay] bind failed", e);
      }
    }
    async function bootMonaco() {
      try {
        var base = (apiBase || "") + "/ui/monaco_vscode/esm";
        var langBase = (apiBase || "") + "/ui/monaco_vscode/lang";
        window.MonacoEnvironment = {
          getWorker: function(_moduleId, _label) {
            try {
              var label = String(_label || "");
              var moduleId = String(_moduleId || "");
              var url;
              if (label === "typescript" || label === "javascript") {
                url = langBase + "/workers/ts.worker.js";
              } else {
                url = base + "/vs/editor/common/services/editorWebWorkerMain.bundle.js";
              }
              var wk = new Worker(url, { type: "module" });
              var key = label + ":" + url.split("/").pop();
              if (!_workerLogOnce[key]) {
                _workerLogOnce[key] = true;
                console.log("[MonacoWorker]", { moduleId, label, url });
              }
              wk.onerror = function(ev) {
                console.error("[MonacoWorker] error", { moduleId, label, ev });
              };
              wk.onmessageerror = function(ev) {
                console.error("[MonacoWorker] messageerror", { moduleId, label, ev });
              };
              return wk;
            } catch (e) {
              console.error("[Monaco] Failed to create worker", e);
              throw e;
            }
          }
        };
        var monacoNs = null;
        try {
          cachedPrefs = await fetchSSOTState();
        } catch (_) {
        }
        var bundleName = "monaco.bootstrap.bundle.js";
        var bundled = await import(langBase + "/bootstrap/" + bundleName);
        monacoNs = await bundled.loadMonaco();
        window._loadedMonacoBundle = bundleName;
        console.log("[Monaco] loaded " + bundleName);
        window.monaco = monacoNs;
        ensureTe2DiffTheme();
        try {
          var tsLang = monacoNs.languages.typescript;
          if (tsLang && tsLang.typescriptDefaults) {
            tsLang.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
            tsLang.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
            console.log("[Monaco] TS/JS worker diagnostics disabled");
          }
        } catch (e) {
          console.warn("[Monaco] TS/JS diagnostics config failed", e);
        }
        try {
          await loadVscodeTextmateThemes();
        } catch (_) {
        }
        try {
          await applyMonacoTheme("github-dark-default");
        } catch (_) {
        }
        await ensureEditorWithPrefs();
        try {
          installVscodeApiLanguageBridgeProviders();
        } catch (_) {
        }
        try {
          try {
            window.__te2VscodeBootstrap = await vscodeApiCall("vscode.bootstrap.snapshot", {});
          } catch (_) {
          }
          try {
            tmVscodeIndex = await _refreshVscodeGrammarIndex();
          } catch (_) {
          }
          applyActiveModelLanguage(window, model, currentPath, applyLanguageToModel, languageFromPath);
          var langs = collectBootLanguageIds(monaco);
          warnIfPlaintextOnlyLanguages(langs);
        } catch (_) {
        }
        connectEditorSocket();
        connectUIIPC();
        try {
          ensureVscodeRpcConnected();
        } catch (_) {
        }
        emitToHost("editor_ready", {});
        updateDebug("boot=ok");
      } catch (e) {
        console.error("[Monaco] boot failed", e);
        updateDebug("boot=fail");
      }
    }
    updateDebug("boot=init");
    bcInit();
    bootMonaco();
  })();
})();
//# sourceMappingURL=editor.debug.js.map
