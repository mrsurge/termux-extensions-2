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
  var pending = null;
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

  function _setUnsavedTrace(reason, unsaved) {
    try {
      var r = reason != null ? String(reason) : '-';
      _trace.unsaved_reason = r + ':' + (unsaved ? '1' : '0');
      _syncTraceDebug();
    } catch (_) {}
  }

  function _noteGitBaselineRequest(source, immediate) {
    try {
      var src = source != null ? String(source) : 'unknown';
      _trace.gb_req_total += 1;
      if (immediate) _trace.gb_req_immediate += 1;
      else _trace.gb_req_debounced += 1;
      _trace.gb_last_source = src + (immediate ? ':imm' : ':deb');
      _syncTraceDebug();
    } catch (_) {}
  }
  var apiBase = (function() {
    try {
      var p = String(window.location && window.location.pathname ? window.location.pathname : '');
      var idx = p.indexOf('/ui/');
      return idx >= 0 ? p.slice(0, idx) : '';
    } catch (_) { return ''; }
  })();

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
  // TextMate grammar index from installed VSIX (via vscode_api).
  // Structure:
  // - byScope: {scopeName -> {id, scopeName, language}}
  // - byLanguage: {languageId -> {preferred: scopeName, scopes: [scopeName,...]}}
  var tmVscodeIndex = null;

  function _uiUrl(relPath) {
    var p = String(relPath || '').replace(/^\/+/, '');
    return (apiBase || '') + '/ui/' + p;
  }

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
        tmGrammarIndex = await fetchJson('/ui/monaco_editor/textmate/grammar_index.json', { cache: 'no-store' });
      } catch (_) {
        tmGrammarIndex = null;
      }
    }

    // Load Oniguruma WASM once.
    try {
      var wasmResp = await fetch(_uiUrl('monaco_editor/textmate/onig.wasm'), { cache: 'force-cache' });
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

          // 1) Prefer vscode_api grammar (installed VSIX).
          try {
            if (!tmVscodeIndex) tmVscodeIndex = await _refreshVscodeGrammarIndex();
            var entry = tmVscodeIndex && tmVscodeIndex.byScope ? tmVscodeIndex.byScope[sn] : null;
            if (entry && entry.id) {
              var res = await vscodeApiCall('vscode.textmate.grammars.load', { id: entry.id });
              if (res && res.ok && res.raw) {
                var url = 'vscode_api://textmate/' + encodeURIComponent(entry.id);
                return window.vscodetextmate.parseRawGrammar(String(res.raw), url);
              }
            }
          } catch (e1) {
            // fall through to legacy
          }

          // 2) Legacy static grammars.
          var scopes = tmGrammarIndex && tmGrammarIndex.scopes ? tmGrammarIndex.scopes : null;
          var fileName = scopes ? scopes[sn] : null;
          if (!fileName) return null;
          var url2 = _uiUrl('monaco_editor/textmate/grammars/' + fileName);
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
    console.log('[TextMate] ready');
    return tmRegistry;
  }

  function _scopeNameForLanguage(languageId, filePath) {
    var lang = normalizeLanguage(languageId);
    try {
      if (!tmVscodeIndex) {
        // Don't block: refresh lazily.
        _refreshVscodeGrammarIndex().then(function (idx) { tmVscodeIndex = idx; }).catch(function () {});
      } else if (tmVscodeIndex.byLanguage && tmVscodeIndex.byLanguage[lang]) {
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
    return null;
  }

  async function _refreshVscodeGrammarIndex() {
    // Build a tiny in-memory index so TextMate registry can resolve scope -> raw grammar.
    var idx = { byScope: Object.create(null), byLanguage: Object.create(null) };
    try {
      var res = await vscodeApiCall('vscode.textmate.grammars.list', {});
      var arr = res && res.grammars ? res.grammars : [];
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
      if (tmInstalled[lang]) return true;

      var scopeName = _scopeNameForLanguage(lang, filePath);
      if (!scopeName) return false;

      var registry = await ensureTextmateReady();
      var grammar = await registry.loadGrammar(scopeName);
      if (!grammar) {
        console.warn('[TextMate] missing grammar for', lang, scopeName);
        return false;
      }
      try { tmGrammarByLang[lang] = grammar; } catch (_) {}

      window.monaco.languages.setTokensProvider(lang, {
        getInitialState: function () { return _makeTextmateState(window.vscodetextmate.INITIAL); },
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
                // Keep Monaco behavior unchanged (we still return last scope as token class),
                // but expose full scope stacks for debugging.
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
    try {
      var grammar = tmGrammarByLang[lang];
      if (!grammar) return null;
      var rs = ruleStack || window.vscodetextmate.INITIAL;
      var res = grammar.tokenizeLine(String(text || ''), rs);
      var out = [];
      for (var i = 0; i < res.tokens.length; i++) {
        var t = res.tokens[i];
        out.push({
          startIndex: t.startIndex,
          endIndex: t.endIndex,
          scopes: (t.scopes || []).slice(),
        });
      }
      return { tokens: out, ruleStack: res.ruleStack };
    } catch (_) {
      return null;
    }
  }

  // Debug helper:
  //   window.__debugTextmateScopes = true;
  //   window.__te2DumpTextmateAtCursor(); // logs scopes for cursor line (active editor/model)
  //   window.__te2DumpTextmateLine(1); // logs scopes for a specific line
  //   window.__te2DumpTextmateScopes(); // scans for import/def/class (active editor/model)
  function _te2GetActiveEditorAndModel() {
    try {
      // Prefer the DiffEditor's modified editor when present, since that's the editable buffer.
      if (diffEditor && diffEditor.getModifiedEditor) {
        var me = diffEditor.getModifiedEditor();
        if (me && me.getModel) return { editor: me, model: me.getModel(), side: 'diff:modified' };
      }
    } catch (_) {}
    try {
      if (editor && editor.getModel) return { editor: editor, model: editor.getModel(), side: 'single' };
    } catch (_) {}
    return { editor: null, model: null, side: 'none' };
  }

  function _te2AdvanceRuleStackToLine(grammar, model, targetLine) {
    try {
      var maxLines = Math.min(Math.max(1, targetLine | 0), model.getLineCount());
      var rs = window.vscodetextmate.INITIAL;
      for (var ln = 1; ln < maxLines; ln++) {
        var line = model.getLineContent(ln);
        var step = grammar.tokenizeLine(String(line || ''), rs);
        rs = step.ruleStack;
      }
      return rs;
    } catch (_) {
      return window.vscodetextmate.INITIAL;
    }
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
    try {
      var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
      if (prefs && prefs.editor && typeof prefs.editor.showInlineDiffs === 'boolean') return prefs.editor.showInlineDiffs;
      if (prefs && typeof prefs.showInlineDiffs === 'boolean') return prefs.showInlineDiffs;
    } catch (_) {}
    return false;
  }

  function getShowDraftDiffs() {
    // Draft diffs are meaningless when autosave is ON (there are no drafts).
    if (getAutoSave()) return false;
    try {
      var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
      if (prefs && prefs.editor && typeof prefs.editor.showDraftDiffs === 'boolean') return prefs.editor.showDraftDiffs;
      if (prefs && typeof prefs.showDraftDiffs === 'boolean') return prefs.showDraftDiffs;
    } catch (_) {}
    return false;
  }

  function getUseTrueInlineView() {
    try {
      var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
      if (prefs && prefs.editor && typeof prefs.editor.useTrueInlineView === 'boolean') return prefs.editor.useTrueInlineView;
      if (prefs && typeof prefs.useTrueInlineView === 'boolean') return prefs.useTrueInlineView;
    } catch (_) {}
    return false;
  }

  function getAutoSave() {
    try {
      var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
      if (prefs && prefs.editor && typeof prefs.editor.autoSave === 'boolean') return prefs.editor.autoSave;
      if (prefs && typeof prefs.autoSave === 'boolean') return prefs.autoSave;
    } catch (_) {}
    return false;
  }

  function _localMirrorDebounceMs() {
    // In autosave mode, use a longer debounce to reduce echo churn while typing.
    return getAutoSave() ? 1000 : 180;
  }

  function _mirrorHotWindowMs() {
    // Ignore incoming mirrors briefly after local keystrokes to avoid cursor jitter.
    return getAutoSave() ? 850 : 250;
  }

  function _gitBaselineDebounceMs() {
    return getAutoSave() ? 320 : 180;
  }

  function _gitBaselineApplyIdleMs() {
    // For autosave + diff view, apply baseline updates only after typing settles.
    return (getAutoSave() && getShowInlineDiffs()) ? 1000 : 0;
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
    if (!lang) return 'plaintext';
    var s = String(lang).toLowerCase();
    if (s === 'text') return 'plaintext';
    if (s === 'shell') return 'shell';
    if (s === 'cpp') return 'cpp';
    return s;
  }

  function languageFromPath(path) {
    try {
      var p = String(path || '').toLowerCase();
      // Prefer VSIX-provided language contributions (when enabled) so we can
      // resolve non-builtin language ids and apply their configuration.
      try {
        var full = String(path || '');
        var base = full.split('/').pop() || full;
        if (vscodeLanguageByFilename && vscodeLanguageByFilename.size) {
          var byName = vscodeLanguageByFilename.get(base);
          if (byName) return normalizeLanguage(byName);
        }
        if (vscodeLanguageByExtension && vscodeLanguageByExtension.size) {
          // Prefer longest extension match (e.g. ".d.ts" over ".ts").
          var best = null;
          var bestLen = 0;
          for (const [ext, langId] of vscodeLanguageByExtension.entries()) {
            if (!ext || typeof ext !== 'string') continue;
            if (!langId) continue;
            if (p.endsWith(ext.toLowerCase()) && ext.length > bestLen) {
              best = langId;
              bestLen = ext.length;
            }
          }
          if (best) return normalizeLanguage(best);
        }
      } catch (_) {}
      if (p.endsWith('.py') || p.endsWith('.pyw')) return 'python';
      if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return 'javascript';
      if (p.endsWith('.ts') || p.endsWith('.tsx')) return 'typescript';
      if (p.endsWith('.c')) return 'c';
      if (p.endsWith('.cc') || p.endsWith('.cpp') || p.endsWith('.cxx') || p.endsWith('.h') || p.endsWith('.hh') || p.endsWith('.hpp') || p.endsWith('.hxx')) return 'cpp';
      if (p.endsWith('.kt') || p.endsWith('.kts')) return 'kotlin';
      if (p.endsWith('.html') || p.endsWith('.htm')) return 'html';
      if (p.endsWith('.css')) return 'css';
      if (p.endsWith('.json') || p.endsWith('.webmanifest')) return 'json';
      if (p.endsWith('.md') || p.endsWith('.mdx')) return 'markdown';
      if (p.endsWith('.sh') || p.endsWith('.bash') || p.endsWith('.zsh')) return 'shell';
      if (p.endsWith('.yml') || p.endsWith('.yaml')) return 'yaml';
      return 'plaintext';
    } catch (_) {
      return 'plaintext';
    }
  }

  function _fileUri(absPath) {
    try {
      if (!window.monaco || !window.monaco.Uri || !window.monaco.Uri.file) return null;
      return window.monaco.Uri.file(String(absPath || ''));
    } catch (_) { return null; }
  }

  function createFileModel(content, lang, absPath) {
    var m;
    try {
      var uri = _fileUri(absPath);
      if (uri) m = monaco.editor.createModel(content || '', lang || 'plaintext', uri);
    } catch (_) {}
    if (!m) m = monaco.editor.createModel(content || '', lang || 'plaintext');
    // Ensure hover/symbols providers are registered for this language.
    try { setTimeout(function () { installVscodeApiLanguageBridgeProviders(); }, 0); } catch (_) {}
    return m;
  }

  function _wsUrlFromPath(p) {
    try {
      var proto = (window.location && window.location.protocol === 'https:') ? 'wss:' : 'ws:';
      var host = window.location ? window.location.host : 'localhost';
      var pathOnly = String(p || '');
      if (!pathOnly.startsWith('/')) pathOnly = '/' + pathOnly;
      return proto + '//' + host + pathOnly;
    } catch (_) {
      return null;
    }
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
      var disc = await fetchJson('/vscode_rpc/discover', { cache: 'no-store' });
      if (!disc || !disc.ws_url) return false;
      var wsUrl = _wsUrlFromPath(disc.ws_url);
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

      // Diagnostics may arrive in file:// or vscode-remote:// form depending on backend.
      // Normalize to an absolute path key so we can apply markers to the active model.
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

        // Cache per-path (so we can apply after model/currentPath is ready).
        try {
          if (!_diagCache) _diagCache = new Map();
          _diagCache.set(itemPath, { ts_ms: Date.now(), markers: outMarkers });
          while (_diagCache.size > DIAG_CACHE_MAX) {
            var firstKey = _diagCache.keys().next().value;
            _diagCache.delete(firstKey);
          }
        } catch (_) {}

        // Apply to active model if it matches.
        if (model && model.uri && activePath && itemPath === activePath) {
          try {
            console.log('[vscode_api] setModelMarkers count=' + outMarkers.length + ' sevs=[' + outMarkers.map(function(m){ return m.severity; }).join(',') + '] lines=[' + outMarkers.map(function(m){ return m.startLineNumber; }).join(',') + ']');
            if (outMarkers.length > 0) console.log('[vscode_api] marker[0]:', JSON.stringify(outMarkers[0]));
            monaco.editor.setModelMarkers(model, 'vscode_api', outMarkers);
            // Verify markers actually stuck
            var verify = monaco.editor.getModelMarkers({ resource: model.uri });
            console.log('[vscode_api] verify getModelMarkers count=' + (verify ? verify.length : 'null'));
            // Emit marker counts to host for toolbar badges.
            try {
              var errors = 0, warnings = 0, hints = 0;
              for (var k = 0; k < outMarkers.length; k++) {
                var s = outMarkers[k].severity;
                if (s === monaco.MarkerSeverity.Error) errors++;
                else if (s === monaco.MarkerSeverity.Warning) warnings++;
                else hints++;
              }
              emitToHost('editor_diagnostics_counts', { errors: errors, warnings: warnings, hints: hints, total: outMarkers.length, path: itemPath });
            } catch (_) {}
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
        try { _applyCachedDiagnosticsForActive(); } catch (_) {}
        // Mobile/WebView timing: diagnostics can land before the model swap completes.
        // Retry a few times after caching without spamming.
        try { _scheduleDiagReapply(); } catch (_) {}
      }
    } catch (_) {}
  }

  var _diagCache = null; // Map(absPath -> {ts_ms, markers})
  var _diagState = null; // counters
  var DIAG_CACHE_MAX = 50;
  var _diagReapplyScheduled = false;
  function _scheduleDiagReapply() {
    if (_diagReapplyScheduled) return;
    _diagReapplyScheduled = true;
    var delays = [0, 50, 250];
    delays.forEach(function (ms) {
      try {
        setTimeout(function () {
          try { _applyCachedDiagnosticsForActive(); } catch (_) {}
        }, ms);
      } catch (_) {}
    });
    try { setTimeout(function () { _diagReapplyScheduled = false; }, 300); } catch (_) { _diagReapplyScheduled = false; }
  }

  /** Clear markers and emit zero diagnostic counts (used on file switch). */
  function _clearDiagnosticsForSwitch() {
    try {
      if (model && window.monaco && window.monaco.editor) {
        monaco.editor.setModelMarkers(model, 'vscode_api', []);
      }
      emitToHost('editor_diagnostics_counts', { errors: 0, warnings: 0, hints: 0, total: 0, path: currentPath || '' });
    } catch (_) {}
  }

  function _applyCachedDiagnosticsForActive() {
    try {
      if (!window.monaco || !window.monaco.editor) return;
      if (!_diagCache || !_diagCache.size) return;
      if (!model || !model.uri) return;
      var activeUri = String(model.uri.toString());
      var activePath = currentPath ? String(currentPath) : _absPathFromVscodeUri(activeUri);
      if (!activePath) return;
      var cached = _diagCache.get(activePath);
      if (!cached) return;
      var markers = Array.isArray(cached.markers) ? cached.markers : [];
      monaco.editor.setModelMarkers(model, 'vscode_api', markers);
      if (_diagState) _diagState.apply += 1;
      try { setDebugDiag('diag=rx' + (_diagState ? _diagState.rx : 0) + '/ap' + (_diagState ? _diagState.apply : 0) + '/np' + (_diagState ? _diagState.drop_no_path : 0) + '/nm' + (_diagState ? _diagState.drop_no_model : 0) + '/mm' + (_diagState ? _diagState.drop_mismatch : 0)); } catch (_) {}
    } catch (_) {}
  }

  function _absPathFromVscodeUri(raw) {
    try {
      if (!raw) return '';
      // vscode-api and workbench sometimes send URI objects (revived) not strings.
      if (typeof raw === 'object') {
        if (raw.fsPath) return String(raw.fsPath);
        if (raw.path) return String(raw.path);
        if (raw.external) return _absPathFromVscodeUri(String(raw.external));
        if (raw.scheme && raw.authority && raw.path) return String(raw.path);
        if (raw.scheme && raw.path) return String(raw.path);
        return '';
      }
      var s = String(raw);
      // Plain absolute paths are already normalized (no scheme).
      if (s[0] === '/' || /^[A-Za-z]:[\\/]/.test(s)) {
        return s;
      }
      // Fast path: avoid URL() differences across mobile/webview implementations.
      if (s.indexOf('file://') === 0) {
        return decodeURIComponent(s.slice('file://'.length));
      }
      if (s.indexOf('vscode-remote://') === 0) {
        // vscode-remote://authority/<abs-path>
        var rest = s.slice('vscode-remote://'.length);
        var slash = rest.indexOf('/');
        if (slash === -1) return '';
        return decodeURIComponent(rest.slice(slash));
      }
      // Fallback: try URL parser for any other scheme that includes a pathname.
      var u = new URL(s);
      if (u && u.pathname) return decodeURIComponent(u.pathname || '');
    } catch (_) {}
    return '';
  }

  function _currentLanguageContext() {
    try {
      if (!model || !model.uri) return null;
      var uri = String(model.uri.toString());
      if (!uri) return null;
      var p = currentPath ? String(currentPath) : _pathFromUriString(uri);
      var lang = String(model.getLanguageId ? model.getLanguageId() : languageFromPath(p));
      var v = Number(model.getVersionId ? model.getVersionId() : 1) || 1;
      return { uri: uri, path: p, languageId: lang, version: v };
    } catch (_) {
      return null;
    }
  }

  function _monacoRangeFromProtoRange(range) {
    try {
      if (!range || !window.monaco || !window.monaco.Range) return null;
      var sl = Math.max(1, Number(range.startLineNumber || 1));
      var sc = Math.max(1, Number(range.startColumn || 1));
      var el = Math.max(1, Number(range.endLineNumber || sl));
      var ec = Math.max(1, Number(range.endColumn || sc));
      return new monaco.Range(sl, sc, el, ec);
    } catch (_) {
      return null;
    }
  }

  function _toMonacoHoverContents(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (typeof c === 'string') {
        out.push({ value: c });
      } else if (c && typeof c === 'object') {
        if (typeof c.value === 'string') out.push({ value: c.value });
        else if (typeof c.language === 'string' && typeof c.value === 'string') out.push({ value: '```' + c.language + '\n' + c.value + '\n```' });
      }
    }
    return out;
  }

  var languageBridge = {
    hoverSeq: 0,
    symbolsSeq: 0,
    registeredHover: new Set(),
    registeredSymbols: new Set(),
  };

  function _isContextCurrent(ctx) {
    try {
      var now = _currentLanguageContext();
      if (!ctx || !now) return false;
      return String(now.uri) === String(ctx.uri) && Number(now.version || 0) === Number(ctx.version || -1);
    } catch (_) {
      return false;
    }
  }

  // ── Workbench RPC over editor Socket.IO ──────────────────────────
  // Routes hover/symbols/openFile through editor_ws.py → adapter stdio pipe.
  // Replaces the old vscode_api_ws raw WebSocket path.
  var _wbPending = new Map(); // request_id -> {resolve, reject, timer}
  var _wbNextId = 1;
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
    return !!window.__te2AdapterReady;
  }

  function _wbCurrentGeneration() {
    return Number(_wbFlow.generation || 0);
  }

  function _wbBumpGeneration(path, reason) {
    _wbFlow.generation = _wbCurrentGeneration() + 1;
    _wbFlow.activePath = String(path || '');
    _wbFlow.openAckGeneration = -1;
    _wbFlow.openAckPath = '';
    _wbFlow.pendingDidChange = null;
    _wbFlow.pendingSymbols = null;
    try {
      console.log('[workbench-flow] generation=' + _wbFlow.generation + ' reason=' + String(reason || 'unknown') + ' path=' + _wbFlow.activePath);
    } catch (_) {}
    return _wbFlow.generation;
  }

  function _wbIsFrameworkReady() {
    return !!(editor && model && currentPath);
  }

  function _wbIsBarrierOpen(path, generation) {
    if (!_isAdapterReady()) return false;
    if (!_wbIsFrameworkReady()) return false;
    var wantPath = String(path || currentPath || '');
    var wantGen = Number.isFinite(Number(generation)) ? Number(generation) : _wbCurrentGeneration();
    return Number(_wbFlow.openAckGeneration) === wantGen && String(_wbFlow.openAckPath || '') === wantPath;
  }

  function _wbSetOpenAck(path, generation) {
    _wbFlow.openAckPath = String(path || '');
    _wbFlow.openAckGeneration = Number.isFinite(Number(generation)) ? Number(generation) : _wbCurrentGeneration();
  }

  function _wbQueueDidChange(path, text, languageId, generation) {
    _wbFlow.pendingDidChange = {
      path: String(path || ''),
      text: String(text || ''),
      languageId: String(languageId || ''),
      generation: Number.isFinite(Number(generation)) ? Number(generation) : _wbCurrentGeneration(),
    };
  }

  function _wbQueueSymbols(path, generation) {
    _wbFlow.pendingSymbols = {
      path: String(path || ''),
      generation: Number.isFinite(Number(generation)) ? Number(generation) : _wbCurrentGeneration(),
    };
  }

  function _wbEmitDidChange(payload) {
    try {
      if (!editorSocket || !editorSocket.connected) return false;
      if (!payload || !payload.path) return false;
      editorSocket.emit('editor_workbench_did_change', {
        path: payload.path,
        text: String(payload.text || ''),
        languageId: String(payload.languageId || ''),
        generation: Number.isFinite(Number(payload.generation)) ? Number(payload.generation) : _wbCurrentGeneration(),
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function _wbFlushDidChangeIfReady() {
    var pending = _wbFlow.pendingDidChange;
    if (!pending) return;
    if (!_wbIsBarrierOpen(pending.path, pending.generation)) return;
    _wbFlow.pendingDidChange = null;
    _wbEmitDidChange(pending);
  }

  function _wbFlushSymbolsIfReady() {
    var pending = _wbFlow.pendingSymbols;
    if (!pending) return;
    if (!_wbIsBarrierOpen(pending.path, pending.generation)) return;
    _wbFlow.pendingSymbols = null;
    _bcRequestSymbols(pending.path, { generation: pending.generation, fromQueue: true });
  }

  function _wbFlushPendingAfterOpen() {
    _wbFlushDidChangeIfReady();
    _wbFlushSymbolsIfReady();
  }

  function _wbPublishDidChange(path, text, languageId, generation) {
    var payload = {
      path: String(path || ''),
      text: String(text || ''),
      languageId: String(languageId || ''),
      generation: Number.isFinite(Number(generation)) ? Number(generation) : _wbCurrentGeneration(),
    };
    if (_wbIsBarrierOpen(payload.path, payload.generation)) {
      return _wbEmitDidChange(payload);
    }
    _wbQueueDidChange(payload.path, payload.text, payload.languageId, payload.generation);
    return false;
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
      editorSocket.emit(eventName, payload);
    });
  }

  function _callVscodeApiGuarded(kind, method, params, ctx, opts) {
    var timeoutMs = (opts && Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 5000;
    var cancelToken = (opts && opts.cancelToken) ? opts.cancelToken : null;
    var seq = 0;
    if (kind === 'hover') seq = ++languageBridge.hoverSeq;
    else if (kind === 'symbols') seq = ++languageBridge.symbolsSeq;
    return editorWorkbenchCall(kind, params, { timeoutMs: timeoutMs }).then(function (res) {
      if (cancelToken && cancelToken.isCancellationRequested) return { ok: false, stale: true, canceled: true };
      if (!_isContextCurrent(ctx)) return { ok: false, stale: true };
      if (kind === 'hover' && seq !== languageBridge.hoverSeq) return { ok: false, stale: true };
      if (kind === 'symbols' && seq !== languageBridge.symbolsSeq) return { ok: false, stale: true };
      return { ok: true, result: res };
    }).catch(function (e) {
      return { ok: false, error: String(e && e.message ? e.message : e || 'error') };
    });
  }

  function _normalizeDocumentSymbols(raw) {
    if (!Array.isArray(raw) || !window.monaco || !monaco.languages) return [];
    var defaultKind = monaco.languages.SymbolKind ? monaco.languages.SymbolKind.Function : 11;
    var mapOne = function (s) {
      var range = _monacoRangeFromProtoRange(s && s.range ? s.range : null);
      var sel = _monacoRangeFromProtoRange(s && s.selectionRange ? s.selectionRange : (s && s.range ? s.range : null));
      var kids = Array.isArray(s && s.children) ? s.children.map(mapOne) : [];
      return {
        name: String((s && s.name) || ''),
        detail: (s && s.detail != null) ? String(s.detail) : '',
        kind: Number((s && s.kind) || defaultKind),
        tags: Array.isArray(s && s.tags) ? s.tags : [],
        range: range || new monaco.Range(1, 1, 1, 1),
        selectionRange: sel || range || new monaco.Range(1, 1, 1, 1),
        children: kids,
      };
    };
    return raw.map(mapOne);
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
              monaco.languages.registerHoverProvider(langId, {
                provideHover: function (m, pos, token) {
                  try {
                    var ctx = _currentLanguageContext();
                    if (!ctx || !m || !m.uri || String(m.uri.toString()) !== String(ctx.uri)) return null;
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
              monaco.languages.registerDocumentSymbolProvider(langId, {
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
                      var payload = out.result.result || [];
                      return _normalizeDocumentSymbols(payload);
                    });
                  } catch (_) {
                    return [];
                  }
                },
              });
              languageBridge.registeredSymbols.add(langId);
            }
          });
        } catch (_) {}
      };

      // Immediate: register for current language context right now
      var immediate = new Set();
      try {
        var ctx = _currentLanguageContext();
        if (ctx && ctx.languageId) immediate.add(String(ctx.languageId));
      } catch (_) {}
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

  function ensureEditor() {
    if (editor) return;
    var el = getEditorContainer();
    if (!el || !window.monaco) return;
    // Editor creation MUST be driven by SSOT (HistoryStore/PreferencesStore).
    // This function is only used as a last-resort guard; prefer ensureEditorWithPrefs().
    editor = monaco.editor.create(el, buildMonacoOptionsFromPrefs(cachedPrefs));
    try { _installMarkerNavBindings(editor); } catch (_) {}
    try {
      var dom = editor.getDomNode();
      if (dom) {
        dom.addEventListener('contextmenu', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }, { capture: true });
      }
    } catch (_) {}
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
    // NOTE: "No base editor state" means: no ad-hoc defaults in the host.
    // We still need hard fallbacks if SSOT is missing values, but the goal is
    // that PreferencesStore always provides a complete snapshot.
    var prefs = null;
    try { prefs = state && state.preferences ? state.preferences : state; } catch (_) {}
    var editorPrefs = null;
    try { editorPrefs = prefs && prefs.editor ? prefs.editor : (prefs && prefs.preferences && prefs.preferences.editor ? prefs.preferences.editor : null); } catch (_) {}
    try {
      // Host shells often send a flat "view_state" (no nested {editor:{...}}).
      // Accept that as editorPrefs so the iframe can apply prefs without SSOT re-fetch.
      if (!editorPrefs && prefs && typeof prefs.showLineNumbers === 'boolean') editorPrefs = prefs;
      if (!editorPrefs && state && typeof state.showLineNumbers === 'boolean') editorPrefs = state;
      if (!editorPrefs) editorPrefs = {};
    } catch (_) { editorPrefs = editorPrefs || {}; }

    var showLineNumbers = true;
    try { if (typeof editorPrefs.showLineNumbers === 'boolean') showLineNumbers = editorPrefs.showLineNumbers; } catch (_) {}

    var wordWrap = false;
    try { if (typeof editorPrefs.wordWrap === 'boolean') wordWrap = editorPrefs.wordWrap; } catch (_) {}

    var readOnly = false;
    try { if (typeof editorPrefs.readOnly === 'boolean') readOnly = editorPrefs.readOnly; } catch (_) {}

    var showMinimap = true;
    try { if (typeof editorPrefs.showMinimap === 'boolean') showMinimap = editorPrefs.showMinimap; } catch (_) {}

    var showIndentGuides = true;
    try { if (typeof editorPrefs.showIndentGuides === 'boolean') showIndentGuides = editorPrefs.showIndentGuides; } catch (_) {}

    var autoCloseBrackets = true;
    try { if (typeof editorPrefs.autoCloseBrackets === 'boolean') autoCloseBrackets = editorPrefs.autoCloseBrackets; } catch (_) {}

    var autocompletion = true;
    try { if (typeof editorPrefs.autocompletion === 'boolean') autocompletion = editorPrefs.autocompletion; } catch (_) {}

    var fontSize = 14;
    try {
      // In CM6, "fontScale" is a numeric scale factor.
      // Keep the mapping conservative.
      if (typeof editorPrefs.fontScale === 'number' && isFinite(editorPrefs.fontScale)) {
        var s = editorPrefs.fontScale;
        if (s > 0 && s < 10) fontSize = Math.round(14 * s);
        else if (s >= 10 && s <= 48) fontSize = Math.round(s);
      }
    } catch (_) {}

    var fontFamily = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    try {
      if (typeof editorPrefs.fontFamily === 'string' && editorPrefs.fontFamily.trim()) {
        fontFamily = editorPrefs.fontFamily.trim();
      }
    } catch (_) {}

    // Theme:
    // - For built-in/known themes, we can pass the resolved Monaco theme id directly.
    // - For VSIX themes (`vscode:*`), Monaco requires the theme to be defined before use.
    //   We load/define the theme asynchronously in applyMonacoTheme(), so keep the
    //   initial theme as a safe built-in to avoid fallback-to-light behavior.
    var rawThemeKey = '';
    try { rawThemeKey = String(editorPrefs.theme || ''); } catch (_) { rawThemeKey = ''; }
    var theme = 'vs-dark';
    try {
      if (rawThemeKey && rawThemeKey.toLowerCase().startsWith('vscode:')) {
        theme = 'vs-dark';
      } else {
        theme = _resolveMonacoThemeId(rawThemeKey);
      }
    } catch (_) {
      theme = 'vs-dark';
    }

    return {
      value: '',
      language: 'plaintext',
      theme: theme,
      // IMPORTANT:
      // - TextMate scope theming is now enabled (VS Code grammars).
      // - Semantic tokens can override TextMate colors. Until we implement full
      //   VS Code-style `semanticTokenColors` mapping, keep semantic highlighting
      //   theme-controlled to avoid "overriding" scope colors with defaults.
      //
      // VS Code accepts: true | false | "configuredByTheme". The pinned Monaco/VSCode
      // build supports the same option shape.
      'semanticHighlighting.enabled': 'configuredByTheme',
      automaticLayout: true,
      contextmenu: false,
      readOnly: readOnly,
      lineNumbers: showLineNumbers ? 'on' : 'off',
      showFoldingControls: 'always',
      wordWrap: wordWrap ? 'on' : 'off',
      minimap: { enabled: !!showMinimap },
      renderIndentGuides: !!showIndentGuides,
      autoClosingBrackets: autoCloseBrackets ? 'always' : 'never',
      // Monaco has multiple suggestion paths:
      // - word based suggestions (no language service needed)
      // - language service backed suggestions (ts/css/json/html workers)
      // Keep both enabled when `autocompletion` is enabled.
      quickSuggestions: autocompletion ? { other: true, comments: true, strings: true } : false,
      suggestOnTriggerCharacters: !!autocompletion,
      wordBasedSuggestions: autocompletion ? 'currentDocument' : 'off',
      parameterHints: { enabled: !!autocompletion },
      tabCompletion: autocompletion ? 'on' : 'off',
      fontSize: fontSize,
      fontFamily: fontFamily,
    };
  }

  function ensureTe2DiffTheme() {
    try {
      if (!window.monaco || !window.monaco.editor || !window.monaco.editor.defineTheme) return;
      if (ensureTe2DiffTheme._done) return;
      ensureTe2DiffTheme._done = true;

      window.monaco.editor.defineTheme('te2-vs-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          // Make diff backgrounds explicit so we don't end up "invisible" due to theme config.
          'diffEditor.insertedLineBackground': 'rgba(46, 160, 67, 0.18)',
          'diffEditor.insertedTextBackground': 'rgba(46, 160, 67, 0.28)',
          'diffEditor.removedLineBackground': 'rgba(248, 81, 73, 0.14)',
          'diffEditor.removedTextBackground': 'rgba(248, 81, 73, 0.24)',
          // Subtle separators.
          'diffEditor.border': 'rgba(255, 255, 255, 0.10)',
          'diffEditor.diagonalFill': 'rgba(255, 255, 255, 0.04)',
        },
      });
    } catch (_) {}
  }

  function ensureTe2Themes() {
    try {
      if (!window.monaco || !window.monaco.editor || !window.monaco.editor.defineTheme) return;
      if (ensureTe2Themes._done) return;
      ensureTe2Themes._done = true;

      // TE2-local themes (hand-tuned). These are NOT part of the monaco-editor-themes SSOT,
      // but we keep them available for TE2-specific UI/contrast needs.
      //
      // `te2-dark` / `te2-light` are GitHub-inspired and intentionally match the diff
      // colors from GitHub Dark/Light Default so diffs remain consistent.
      window.monaco.editor.defineTheme('te2-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '8B949E' },
          { token: 'string', foreground: 'A5D6FF' },
          { token: 'keyword', foreground: 'FF7B72' },
          { token: 'number', foreground: 'FFA657' },
          { token: 'type', foreground: '79C0FF' },
          { token: 'delimiter', foreground: 'E6EDF3' },
        ],
        colors: {
          'editor.background': '#06080cff',
          'editor.foreground': '#e6edf3',
          'editorLineNumber.foreground': '#6e7681',
          'editorLineNumber.activeForeground': '#e6edf3',
          'editorCursor.foreground': '#2f81f7',
          'editor.selectionBackground': '#264f78',
          'editor.inactiveSelectionBackground': '#264f7840',
          'editorIndentGuide.background': '#30363d',
          'editorIndentGuide.activeBackground': '#6e7681',
          'editorWhitespace.foreground': '#484f58',
          'editorGutter.background': '#0d1117',
          'editorWidget.background': '#161b22',
          'editorHoverWidget.background': '#161b22',
          'editorSuggestWidget.background': '#161b22',
          'editorSuggestWidget.border': '#30363d',
          'editorSuggestWidget.foreground': '#e6edf3',
          'dropdown.background': '#161b22',
          'dropdown.border': '#30363d',
          'input.background': '#0d1117',
          'input.border': '#30363d',
          'input.foreground': '#e6edf3',
          'scrollbar.shadow': '#00000000',
          'scrollbarSlider.background': '#484f5833',
          'scrollbarSlider.hoverBackground': '#484f5866',
          'scrollbarSlider.activeBackground': '#484f5899',

          // Git diff colors: match GitHub Dark Default.
          'diffEditor.insertedLineBackground': '#23863626',
          'diffEditor.insertedTextBackground': '#3fb9504d',
          'diffEditor.removedLineBackground': '#da363326',
          'diffEditor.removedTextBackground': '#ff7b724d',
        },
      });

      window.monaco.editor.defineTheme('te2-light', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '6E7781' },
          { token: 'string', foreground: '0A3069' },
          { token: 'keyword', foreground: 'CF222E' },
          { token: 'number', foreground: '953800' },
          { token: 'type', foreground: '0550AE' },
          { token: 'delimiter', foreground: '24292F' },
        ],
        colors: {
          'editor.background': '#ffffff',
          'editor.foreground': '#24292f',
          'editorLineNumber.foreground': '#8c959f',
          'editorLineNumber.activeForeground': '#24292f',
          'editorCursor.foreground': '#0969da',
          'editor.selectionBackground': '#add6ff',
          'editor.inactiveSelectionBackground': '#add6ff66',
          'editorIndentGuide.background': '#d0d7de',
          'editorIndentGuide.activeBackground': '#8c959f',
          'editorWhitespace.foreground': '#d0d7de',
          'editorGutter.background': '#ffffff',
          'editorWidget.background': '#f6f8fa',
          'editorHoverWidget.background': '#f6f8fa',
          'editorSuggestWidget.background': '#f6f8fa',
          'editorSuggestWidget.border': '#d0d7de',
          'editorSuggestWidget.foreground': '#24292f',
          'dropdown.background': '#ffffff',
          'dropdown.border': '#d0d7de',
          'input.background': '#ffffff',
          'input.border': '#d0d7de',
          'input.foreground': '#24292f',
          'scrollbar.shadow': '#00000000',
          'scrollbarSlider.background': '#8c959f33',
          'scrollbarSlider.hoverBackground': '#8c959f66',
          'scrollbarSlider.activeBackground': '#8c959f99',

          // Git diff colors: match GitHub Light Default.
          'diffEditor.insertedLineBackground': '#aceebb4d',
          'diffEditor.insertedTextBackground': '#6fdd8b80',
          'diffEditor.removedLineBackground': '#ffcecb4d',
          'diffEditor.removedTextBackground': '#ff818266',
        },
      });

      // Extra dark theme option (quick win): Dracula-ish.
      window.monaco.editor.defineTheme('te2-dracula', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '6272A4' },
          { token: 'string', foreground: 'F1FA8C' },
          { token: 'keyword', foreground: 'FF79C6' },
          { token: 'number', foreground: 'BD93F9' },
          { token: 'type', foreground: '8BE9FD' },
          { token: 'delimiter', foreground: 'F8F8F2' },
        ],
        colors: {
          'editor.background': '#282A36',
          'editor.foreground': '#F8F8F2',
          'editorLineNumber.foreground': '#6272A4',
          'editorLineNumber.activeForeground': '#F8F8F2',
          'editorCursor.foreground': '#F8F8F2',
          'editor.selectionBackground': '#44475A',
          'editorIndentGuide.background': '#44475A',
          'editorIndentGuide.activeBackground': '#6272A4',
          'editorGutter.background': '#282A36',
          'editorWidget.background': '#21222C',
          'editorHoverWidget.background': '#21222C',
          'editorSuggestWidget.background': '#21222C',
          'editorSuggestWidget.border': '#44475A',
          'scrollbar.shadow': '#00000000',
          'scrollbarSlider.background': '#6272A433',
          'scrollbarSlider.hoverBackground': '#6272A466',
          'scrollbarSlider.activeBackground': '#6272A499',
        },
      });
    } catch (e) {
      console.warn('[Monaco] ensureTe2Themes failed', e);
    }
  }

  function _getThemeJsonUrl(themeId) {
    return '/api/app/file_editor_cm6/ui/monaco_editor/themes/' + encodeURIComponent(themeId) + '.json';
  }

  function sanitizeMonacoThemeJson(themeId, json) {
    try {
      if (!json || typeof json !== 'object') return json;
      var colors = json.colors;
      if (colors && typeof colors === 'object') {
        for (var k in colors) {
          if (!Object.prototype.hasOwnProperty.call(colors, k)) continue;
          var v = colors[k];
          if (typeof v === 'string') continue;
          if (Array.isArray(v) && v.length && typeof v[0] === 'string') {
            // Some VS Code theme exports contain palette arrays for certain keys
            // (e.g. symbolIcon.*Foreground). Monaco expects a single color string.
            colors[k] = v[0];
            continue;
          }
          // Drop unsupported values to avoid hard failures in Monaco's color parser.
          delete colors[k];
        }
      }
    } catch (e) {
      console.warn('[MonacoTheme] sanitize failed', themeId, e);
    }
    return json;
  }

  async function loadOfficialThemes() {
    if (loadOfficialThemes._done) return;
    // Don't memoize a "no-op" run before Monaco exists. Monaco is created by
    // `await import(.../editor.main.js)` later in bootMonaco().
    if (!window.monaco || !window.monaco.editor || !window.monaco.editor.defineTheme) return;
    if (loadOfficialThemes._promise) return loadOfficialThemes._promise;
    loadOfficialThemes._promise = (async function () {
      try {
        var themeIds = [
          // Legacy ids (kept for backwards compatibility with old prefs)
          'github-dark',
          'github-light',
          'atom-dark',
          'atom-light',
          'material-dark',
          'material-light',
          'darcula',
          'monokai-pro',
          'one-dark-pro',
        ];
        for (var i = 0; i < themeIds.length; i++) {
          var id = themeIds[i];
          try {
            var res = await fetch(_getThemeJsonUrl(id), { cache: 'no-cache' });
            if (!res.ok) {
              console.warn('[MonacoTheme] missing', id, res.status);
              continue;
            }
            var json = await res.json();
            json = sanitizeMonacoThemeJson(id, json);
            window.monaco.editor.defineTheme(id, json);
          } catch (e) {
            console.warn('[MonacoTheme] failed to load', id, e);
          }
        }
        loadOfficialThemes._done = true;
      } catch (e) {
        console.warn('[MonacoTheme] loadOfficialThemes failed', e);
      }
    })();
    return loadOfficialThemes._promise;
  }

  function _getVscodeThemeJsonUrl(themeId) {
    var id = String(themeId || '');
    if (id === 'github-dark-default') return _uiUrl('monaco_editor/textmate/themes/github-dark-default.vscode.json');
    if (id === 'github-light-default') return _uiUrl('monaco_editor/textmate/themes/github-light-default.vscode.json');
    return null;
  }

  function _toMonacoColorHex(hex) {
    if (!hex) return null;
    var s = String(hex).trim();
    if (!s) return null;
    // Monaco expects no leading '#'
    if (s[0] === '#') s = s.slice(1);
    // VS Code themes sometimes use 8-digit ARGB; Monaco supports 8-digit too.
    if (!/^[0-9a-fA-F]{3,8}$/.test(s)) return null;
    return s.toUpperCase();
  }

  function _vscodeTokenColorsToMonacoRules(tokenColors) {
    var rules = [];
    if (!Array.isArray(tokenColors)) return rules;
    for (var i = 0; i < tokenColors.length; i++) {
      var tc = tokenColors[i];
      if (!tc || !tc.settings) continue;
      var fg = _toMonacoColorHex(tc.settings.foreground);
      var bg = _toMonacoColorHex(tc.settings.background);
      var fontStyle = null;
      if (typeof tc.settings.fontStyle === 'string') {
        // VS Code uses space-separated: "italic bold underline". Monaco expects same.
        fontStyle = tc.settings.fontStyle.trim();
      }
      var scopes = tc.scope;
      var scopeList = [];
      if (Array.isArray(scopes)) {
        scopeList = scopes;
      } else if (typeof scopes === 'string') {
        scopeList = scopes.split(',');
      } else {
        continue;
      }
      for (var j = 0; j < scopeList.length; j++) {
        var rawScope = scopeList[j];
        if (rawScope == null) continue;
        var scopeStr = String(rawScope || '').trim();
        if (!scopeStr) continue;

        // VS Code tokenColors allow "compound" scope selectors (e.g.
        // "meta.import.python keyword.control.import.python"). Monaco's standalone
        // token theming does not understand full TextMate selector semantics, and our
        // TextMate tokenization currently feeds Monaco the last scope as the token id.
        //
        // To stay compatible, split on whitespace and register each scope segment as
        // a possible token id. This provides a best-effort mapping for common themes.
        var parts = scopeStr.split(/\s+/g);
        for (var p = 0; p < parts.length; p++) {
          var scope = String(parts[p] || '').trim();
          if (!scope) continue;
          var rule = { token: scope };
          if (fg) rule.foreground = fg;
          if (bg) rule.background = bg;
          if (fontStyle) rule.fontStyle = fontStyle;
          // Only keep rules that actually set something.
          if (rule.foreground || rule.background || rule.fontStyle) rules.push(rule);
        }
      }
    }
    return rules;
  }

  function _vscodeThemeToMonacoTheme(themeId, vscodeJson) {
    var themeKey = String(themeId || '');
    var uiTheme = null;
    try {
      uiTheme = vscodeJson && typeof vscodeJson.uiTheme === 'string' ? vscodeJson.uiTheme : null;
    } catch (_) {}
    var isLight = false;
    try {
      if (uiTheme) {
        isLight = String(uiTheme).toLowerCase().includes('light');
      } else {
        isLight = themeKey.toLowerCase().includes('light');
      }
    } catch (_) { isLight = themeKey.toLowerCase().includes('light'); }
    var tokenColors = vscodeJson && vscodeJson.tokenColors ? vscodeJson.tokenColors : [];
    var colorsIn = vscodeJson && vscodeJson.colors ? vscodeJson.colors : {};
    var colors = {};
    try {
      for (var k in colorsIn) {
        if (!Object.prototype.hasOwnProperty.call(colorsIn, k)) continue;
        var v = colorsIn[k];
        if (typeof v === 'string') {
          colors[k] = v;
        }
      }
    } catch (_) {}
    return {
      base: isLight ? 'vs' : 'vs-dark',
      inherit: true,
      rules: _vscodeTokenColorsToMonacoRules(tokenColors),
      colors: colors,
    };
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
  var vscodeThemeIdMap = new Map(); // themeKey -> monacoThemeId
  var vscodeThemeLoaded = new Set(); // monacoThemeId
  // VSIX language contributions (per-project enablement).
  var vscodeLanguagesInstalled = false;
  var vscodeLanguageIds = new Set();
  var vscodeLanguageByExtension = new Map(); // ".py" -> "python"
  var vscodeLanguageByFilename = new Map(); // "Dockerfile" -> "dockerfile"

  function _vscodeThemeKeyToMonacoId(themeKey) {
    try {
      if (vscodeThemeIdMap.has(themeKey)) return vscodeThemeIdMap.get(themeKey);
      var id = String(themeKey || '');
      if (id.startsWith('vscode:')) id = id.slice('vscode:'.length);
      // Monaco standalone theme names are restricted to /^[a-z0-9\\-]+$/i.
      // Keep them lowercase and hyphen-only to avoid "Illegal theme name!"
      // from StandaloneThemeService.defineTheme().
      id = id
        .replace(/\\/g, '/')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Keep names reasonably short to avoid pathological theme keys.
      if (id.length > 120) {
        var h = 0;
        for (var i = 0; i < id.length; i++) {
          h = ((h << 5) - h) + id.charCodeAt(i);
          h |= 0;
        }
        var suffix = String(Math.abs(h));
        id = id.slice(0, 100).replace(/-+$/g, '') + '-' + suffix;
      }

      var monacoId = 'vscode-theme-' + (id || 'unknown');
      vscodeThemeIdMap.set(themeKey, monacoId);
      return monacoId;
    } catch (_) {
      return 'vscode-theme-unknown';
    }
  }

  async function ensureVscodeApiWs() {
    if (vscodeApiWs && vscodeApiWs.readyState === WebSocket.OPEN) return vscodeApiWs;
    if (vscodeApiConnecting) return vscodeApiConnecting;

    vscodeApiConnecting = (async function () {
      // 1) Start the service explicitly (separate endpoint), then 2) discover WS url.
      // This avoids racy "discover starts the service" behavior.
      var startResp = await fetch('/api/app/file_editor_cm6/vscode_api/start', { cache: 'no-store' });
      var startJson = null;
      try { startJson = await startResp.json(); } catch (_) {}
      if (!startResp.ok || (startJson && startJson.ok === false)) {
        var startMsg = (startJson && (startJson.error || startJson.detail)) ? (startJson.error || startJson.detail) : ('HTTP ' + startResp.status);
        throw new Error('vscode_api start failed: ' + startMsg);
      }

      // Discover can still briefly 503 while the shell proxy route is wiring up; retry lightly.
      var json = null;
      var resp = null;
      for (var attempt = 0; attempt < 25; attempt++) {
        resp = await fetch('/api/app/file_editor_cm6/vscode_api/discover', { cache: 'no-store' });
        json = null;
        try { json = await resp.json(); } catch (_) {}
        if (resp.ok && !(json && json.ok === false)) break;
        if (resp.status === 503) {
          await new Promise(function (r) { setTimeout(r, 120); });
          continue;
        }
        var msg0 = (json && (json.error || json.detail)) ? (json.error || json.detail) : ('HTTP ' + resp.status);
        throw new Error(msg0);
      }
      if (!resp || !resp.ok || (json && json.ok === false)) {
        var msg = (json && (json.error || json.detail)) ? (json.error || json.detail) : (resp ? ('HTTP ' + resp.status) : 'unknown');
        throw new Error('vscode_api discover failed: ' + msg);
      }
      var wsPath = null;
      try { wsPath = (json && json.data && json.data.ws_url) ? json.data.ws_url : (json && json.ws_url ? json.ws_url : null); } catch (_) {}
      if (!wsPath) throw new Error('vscode_api discover missing ws_url');
      var proto = (location.protocol === 'https:') ? 'wss' : 'ws';
      var wsUrl = proto + '://' + location.host + wsPath;

      var ws = new WebSocket(wsUrl);
      vscodeApiWs = ws;

      // Register notification handlers.
      // Diagnostics are now routed through editor Socket.IO (diagnostics_bridge),
      // so we no longer handle them here. Other te2.event types can be added if needed.
      try {} catch (_) {}

      ws.onmessage = function (ev) {
        var msg2 = null;
        try { msg2 = JSON.parse(String(ev.data || '')); } catch (_) { return; }
        var handleOne = function (m) {
          if (!m) return;
          var id = m.id;
          if (id != null) {
            var pending = vscodeApiPending.get(id);
            if (!pending) return;
            vscodeApiPending.delete(id);
            if (m.error) pending.reject(new Error(m.error.message || 'jsonrpc error'));
            else pending.resolve(m.result);
            return;
          }

          // Notifications from vscode_api (workbench adapter events)
          try {
            if (m.method && vscodeApiHandlers && vscodeApiHandlers.has(m.method)) {
              vscodeApiHandlers.get(m.method)(m.params);
            }
          } catch (_) {}
        };
        if (Array.isArray(msg2)) msg2.forEach(handleOne);
        else handleOne(msg2);
      };

      ws.onclose = function () {
        vscodeApiWs = null;
        vscodeApiConnecting = null;
        try {
          vscodeApiPending.forEach(function (p) { try { p.reject(new Error('vscode_api ws closed')); } catch (_) {} });
          vscodeApiPending.clear();
        } catch (_) {}
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
    var payload = { jsonrpc: '2.0', id: id, method: String(method || ''), params: params || {} };
    var timeoutMs = 12000;
    try {
      if (opts && Number.isFinite(Number(opts.timeoutMs))) timeoutMs = Math.max(250, Number(opts.timeoutMs));
    } catch (_) {}
    var p = new Promise(function (resolve, reject) {
      vscodeApiPending.set(id, { resolve: resolve, reject: reject });
      setTimeout(function () {
        if (!vscodeApiPending.has(id)) return;
        vscodeApiPending.delete(id);
        reject(new Error('vscode_api timeout: ' + method));
      }, timeoutMs);
    });
    ws.send(JSON.stringify(payload));
    return p;
  }

  function _vscodeApiNotify(method, params) {
    try {
      if (!vscodeApiWs || vscodeApiWs.readyState !== WebSocket.OPEN) return false;
      vscodeApiWs.send(JSON.stringify({ jsonrpc: '2.0', method: String(method || ''), params: params || {} }));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function ensureVscodeApiThemeLoaded(themeKey) {
    if (!themeKey || typeof themeKey !== 'string' || !themeKey.startsWith('vscode:')) return null;
    if (!window.monaco || !window.monaco.editor || !window.monaco.editor.defineTheme) return null;

    var monacoThemeId = _vscodeThemeKeyToMonacoId(themeKey);
    if (vscodeThemeLoaded.has(monacoThemeId)) return monacoThemeId;

    var themeId = themeKey.slice('vscode:'.length);
    var res = await vscodeApiCall('vscode.themes.load', { id: themeId });
    if (!res || res.ok === false) throw new Error((res && (res.error || res.detail)) || 'theme load failed');

    var raw = res.raw;
    if (!raw) throw new Error('theme missing raw');
    var vscodeJson = null;
    try { vscodeJson = _parseJsonc(String(raw)); } catch (e) { throw new Error('theme json parse failed'); }

    // Preserve uiTheme hint if the extension provided it.
    try {
      if (res.uiTheme && typeof res.uiTheme === 'string') {
        vscodeJson.uiTheme = res.uiTheme;
      }
    } catch (_) {}

    var monacoTheme = _vscodeThemeToMonacoTheme(themeId, vscodeJson);
    window.monaco.editor.defineTheme(monacoThemeId, monacoTheme);
    vscodeThemeLoaded.add(monacoThemeId);
    return monacoThemeId;
  }

  function _parseJsonc(text) {
    // Minimal JSONC parser (supports // and /* */ comments + trailing commas).
    // This is needed because many VS Code themes ship as jsonc.
    var s = String(text || '');
    // Strip BOM
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    // Remove /* */ comments
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove // comments (line)
    s = s.replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Remove trailing commas
    s = s.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(s);
  }

  async function ensureVscodeLanguagesInstalled() {
    if (vscodeLanguagesInstalled) return true;
    if (!window.monaco || !window.monaco.languages) return false;

    try {
      // Prefer bootstrap snapshot languages when available (single request at boot),
      // otherwise query vscode_api directly.
      var langs = null;
      try {
        if (window.__te2VscodeBootstrap && Array.isArray(window.__te2VscodeBootstrap.languages)) {
          langs = window.__te2VscodeBootstrap.languages;
        }
      } catch (_) {}
      if (!Array.isArray(langs)) {
        const res = await vscodeApiCall('vscode.languages.list', {});
        langs = res && res.languages ? res.languages : [];
      }
      if (!Array.isArray(langs)) return false;

      // Reset matchers each time we build them (future-proof for re-install).
      try { vscodeLanguageByExtension.clear(); } catch (_) {}
      try { vscodeLanguageByFilename.clear(); } catch (_) {}

      for (let i = 0; i < langs.length; i++) {
        const l = langs[i];
        if (!l || !l.id) continue;
        const langId = normalizeLanguage(l.id);
        if (!langId) continue;

        // Register language id if it isn't already known.
        try {
          if (!vscodeLanguageIds.has(langId)) {
            try {
              window.monaco.languages.register({
                id: langId,
                aliases: Array.isArray(l.aliases) ? l.aliases : undefined,
                extensions: Array.isArray(l.extensions) ? l.extensions : undefined,
                filenames: Array.isArray(l.filenames) ? l.filenames : undefined,
                mimetypes: Array.isArray(l.mimetypes) ? l.mimetypes : undefined,
              });
            } catch (_) {}
            vscodeLanguageIds.add(langId);
          }
        } catch (_) {}

        // Build filename/extension matchers for languageFromPath().
        try {
          if (Array.isArray(l.extensions)) {
            for (let j = 0; j < l.extensions.length; j++) {
              const ext = String(l.extensions[j] || '').trim();
              if (!ext) continue;
              vscodeLanguageByExtension.set(ext, langId);
            }
          }
        } catch (_) {}
        try {
          if (Array.isArray(l.filenames)) {
            for (let j = 0; j < l.filenames.length; j++) {
              const name = String(l.filenames[j] || '').trim();
              if (!name) continue;
              vscodeLanguageByFilename.set(name, langId);
            }
          }
        } catch (_) {}

        // Apply language configuration if provided (jsonc).
        try {
          if (l.configuration_raw) {
            const cfg = _parseJsonc(String(l.configuration_raw));
            if (cfg && typeof cfg === 'object') {
              try { window.monaco.languages.setLanguageConfiguration(langId, cfg); } catch (_) {}
            }
          }
        } catch (e) {
          console.warn('[VSIX][Languages] config parse failed', langId, e);
        }
      }

      vscodeLanguagesInstalled = true;
      try { installVscodeApiLanguageBridgeProviders(); } catch (_) {}
      console.log('[VSIX][Languages] installed', langs.length, 'ext=', vscodeLanguageByExtension.size, 'files=', vscodeLanguageByFilename.size);
      return true;
    } catch (e) {
      console.warn('[VSIX][Languages] list failed', e);
      return false;
    }
  }

  async function loadVscodeTextmateThemes() {
    if (loadVscodeTextmateThemes._done) return;
    if (!window.monaco || !window.monaco.editor || !window.monaco.editor.defineTheme) return;
    if (loadVscodeTextmateThemes._promise) return loadVscodeTextmateThemes._promise;
    loadVscodeTextmateThemes._promise = (async function () {
      var themeIds = ['github-dark-default', 'github-light-default'];
      for (var i = 0; i < themeIds.length; i++) {
        var id = themeIds[i];
        var url = _getVscodeThemeJsonUrl(id);
        if (!url) continue;
        try {
          var res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) {
            console.warn('[MonacoTheme] missing vscode theme', id, res.status);
            continue;
          }
          var json = await res.json();
          var monacoTheme = _vscodeThemeToMonacoTheme(id, json);
          window.monaco.editor.defineTheme(id, monacoTheme);
          console.log('[MonacoTheme] loaded vscode theme', id, 'rules=', monacoTheme.rules.length);

          // Also (re)define TE2 themes to use the same TextMate scope rule-set as
          // GitHub Dark/Light Default, while preserving TE2 UI colors (esp. the
          // editor background). This gives TE2 themes "real" VS Code scope coloring.
          //
          // NOTE: We intentionally do not attempt to map VS Code semanticTokenColors
          // here; semantic tokens remain theme-controlled via
          // `editor.semanticHighlighting.enabled = "configuredByTheme"`.
          try {
            if (id === 'github-dark-default') {
              var rules = (monacoTheme.rules || []).slice();
              // Ensure function identifiers stay purple.
              rules.push({ token: 'entity.name.function', foreground: 'D2A8FF' });
              window.monaco.editor.defineTheme('te2-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: rules,
                colors: {
                  'editor.background': '#06080cff',
                  'editor.foreground': '#e6edf3',
                  'editorLineNumber.foreground': '#6e7681',
                  'editorLineNumber.activeForeground': '#e6edf3',
                  'editorCursor.foreground': '#2f81f7',
                  'editor.selectionBackground': '#264f78',
                  'editor.inactiveSelectionBackground': '#264f7840',
                  'editorIndentGuide.background': '#30363d',
                  'editorIndentGuide.activeBackground': '#6e7681',
                  'editorWhitespace.foreground': '#484f58',
                  'editorGutter.background': '#0d1117',
                  'editorWidget.background': '#161b22',
                  'editorHoverWidget.background': '#161b22',
                  'editorSuggestWidget.background': '#161b22',
                  'editorSuggestWidget.border': '#30363d',
                  'editorSuggestWidget.foreground': '#e6edf3',
                  'dropdown.background': '#161b22',
                  'dropdown.border': '#30363d',
                  'input.background': '#0d1117',
                  'input.border': '#30363d',
                  'input.foreground': '#e6edf3',
                  'scrollbar.shadow': '#00000000',
                  'scrollbarSlider.background': '#484f5833',
                  'scrollbarSlider.hoverBackground': '#484f5866',
                  'scrollbarSlider.activeBackground': '#484f5899',

                  // Git diff colors: match GitHub Dark Default.
                  'diffEditor.insertedLineBackground': '#23863626',
                  'diffEditor.insertedTextBackground': '#3fb9504d',
                  'diffEditor.removedLineBackground': '#da363326',
                  'diffEditor.removedTextBackground': '#ff7b724d',
                },
              });
            }

            if (id === 'github-light-default') {
              var rulesL = (monacoTheme.rules || []).slice();
              // Ensure function identifiers stay purple (light).
              rulesL.push({ token: 'entity.name.function', foreground: '8250DF' });
              window.monaco.editor.defineTheme('te2-light', {
                base: 'vs',
                inherit: true,
                rules: rulesL,
                colors: {
                  'editor.background': '#ffffff',
                  'editor.foreground': '#24292f',
                  'editorLineNumber.foreground': '#8c959f',
                  'editorLineNumber.activeForeground': '#24292f',
                  'editorCursor.foreground': '#0969da',
                  'editor.selectionBackground': '#add6ff',
                  'editor.inactiveSelectionBackground': '#add6ff66',
                  'editorIndentGuide.background': '#d0d7de',
                  'editorIndentGuide.activeBackground': '#8c959f',
                  'editorWhitespace.foreground': '#d0d7de',
                  'editorGutter.background': '#ffffff',
                  'editorWidget.background': '#f6f8fa',
                  'editorHoverWidget.background': '#f6f8fa',
                  'editorSuggestWidget.background': '#f6f8fa',
                  'editorSuggestWidget.border': '#d0d7de',
                  'editorSuggestWidget.foreground': '#24292f',
                  'dropdown.background': '#ffffff',
                  'dropdown.border': '#d0d7de',
                  'input.background': '#ffffff',
                  'input.border': '#d0d7de',
                  'input.foreground': '#24292f',
                  'scrollbar.shadow': '#00000000',
                  'scrollbarSlider.background': '#8c959f33',
                  'scrollbarSlider.hoverBackground': '#8c959f66',
                  'scrollbarSlider.activeBackground': '#8c959f99',

                  // Git diff colors: match GitHub Light Default.
                  'diffEditor.insertedLineBackground': '#aceebb4d',
                  'diffEditor.insertedTextBackground': '#6fdd8b80',
                  'diffEditor.removedLineBackground': '#ffcecb4d',
                  'diffEditor.removedTextBackground': '#ff818266',
                },
              });
            }
          } catch (e3) {
            console.warn('[MonacoTheme] failed to sync te2 themes from github defaults', e3);
          }
        } catch (e) {
          console.warn('[MonacoTheme] failed vscode theme', id, e);
        }
      }
      loadVscodeTextmateThemes._done = true;
    })();
    return loadVscodeTextmateThemes._promise;
  }

  function _resolveMonacoThemeId(themeKey) {
    try {
      var t = String(themeKey || '').toLowerCase();
      if (t.startsWith('vscode:')) return _vscodeThemeKeyToMonacoId(String(themeKey || ''));
      var official = [
        'github-dark-default',
        'github-light-default',
        'github-dark',
        'github-light',
        'atom-dark',
        'atom-light',
        'material-dark',
        'material-light',
        'darcula',
        'monokai-pro',
        'one-dark-pro',
      ];
      if (t === 'github-dark') return 'github-dark-default';
      if (t === 'github-light') return 'github-light-default';
      if (official.includes(t)) return t;
      if (t === 'te2-dark' || t.includes('te2-dark')) return 'te2-dark';
      if (t === 'te2-light' || t.includes('te2-light')) return 'te2-light';
      if (t === 'te2-dracula' || t.includes('te2-dracula') || t === 'dracula') return 'te2-dracula';
      if (t === 'vs' || t === 'vs-dark') return t;
      if (t.includes('light')) return 'vs';
      return 'vs-dark';
    } catch (_) {
      return 'vs-dark';
    }
  }

  async function applyMonacoTheme(themeKey) {
    try {
      if (!window.monaco || !window.monaco.editor || !window.monaco.editor.setTheme) return;
      ensureTe2Themes();
      ensureTe2DiffTheme();
      try { await loadVscodeTextmateThemes(); } catch (_) {}
      try { await loadOfficialThemes(); } catch (_) {}
      var tk = String(themeKey || '');
      if (tk.startsWith('vscode:')) {
        var monacoId = await ensureVscodeApiThemeLoaded(tk);
        if (monacoId) {
          window.monaco.editor.setTheme(monacoId);
          return;
        }
      }
      window.monaco.editor.setTheme(_resolveMonacoThemeId(themeKey));
    } catch (e) {
      console.warn('[Monaco] applyMonacoTheme failed', e);
    }
  }

  async function fetchJson(path, options) {
    var url = (apiBase || '') + String(path || '');
    var resp = await fetch(url, options || { cache: 'no-store' });
    var json = null;
    try { json = await resp.json(); } catch (_) {}
    if (!resp.ok || (json && json.ok === false)) {
      var msg = (json && (json.error || json.detail)) ? (json.error || json.detail) : ('HTTP ' + resp.status);
      throw new Error(msg);
    }
    return json && (json.data || json) ? (json.data || json) : json;
  }

  function emitToHost(eventName, payload) {
    try {
      if (!editorSocket || !editorSocket.connected) return false;
      editorSocket.emit(eventName, payload || {});
      return true;
    } catch (_) {
      return false;
    }
  }

  function requestGitBaselines(opts) {
    try {
      var immediate = !!(opts && opts.immediate);
      var reason = (opts && opts.reason) ? String(opts.reason) : 'unknown';
      _noteGitBaselineRequest(reason, immediate);
      if (immediate) {
        if (gitBaselineDebounceT) clearTimeout(gitBaselineDebounceT);
        gitBaselineDebounceT = null;
        return _emitGitBaselineRequestNow();
      }
      if (gitBaselineDebounceT) clearTimeout(gitBaselineDebounceT);
      gitBaselineDebounceT = setTimeout(function() {
        gitBaselineDebounceT = null;
        try { _emitGitBaselineRequestNow(); } catch (_) {}
      }, _gitBaselineDebounceMs());
      return true;
    } catch (_) {
      return false;
    }
  }

  function applyGitBaselines(payload) {
    try {
      if (!payload || !payload.path || !currentPath) return;
      if (String(payload.path) !== String(currentPath)) return;
      if (!window.monaco) return;

      var baselineIdleMs = _gitBaselineApplyIdleMs();
      if (baselineIdleMs > 0 && diffEditor && lastLocalEditAt > 0) {
        var ageMs = Date.now() - lastLocalEditAt;
        if (ageMs < baselineIdleMs) {
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
        gitHeadModel = monaco.editor.createModel(head || '', lang);
      } else {
        var nextHead = head || '';
        try {
          if (!gitHeadModel.getValue || String(gitHeadModel.getValue()) !== String(nextHead)) {
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

      // If the diffEditor already has models bound for this file, skip setModel()
      // to preserve scroll position (the model content updates above are sufficient
      // to trigger diff recomputation).
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
            setDebugFlags(
              needsFlagRebind
                ? ('flags=rebind as=' + (desiredAutoSave ? '1' : '0') + ' fr=' + (desiredFreeze ? '1' : '0') + ' mb=' + (desiredHasBaseline ? '1' : '0'))
                : ('flags=ok as=' + (curAutoSave ? '1' : '0') + ' fr=' + (curFreeze ? '1' : '0') + ' mb=' + (curHasBaseline ? '1' : '0'))
            );
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
    return await fetchJson('/state', { cache: 'no-store' });
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
    try { _installMarkerNavBindings(editor); } catch (_) {}
    try {
      var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
      var t = prefs && prefs.editor && prefs.editor.theme ? prefs.editor.theme : '';
      applyMonacoTheme(t);
    } catch (_) {}
    try {
      var dom = editor.getDomNode();
      if (dom) {
        dom.addEventListener('contextmenu', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }, { capture: true });
      }
    } catch (_) {}
    ensureTouchSelection('boot');
    updateDebug('ssot=ok');
    ensureLayoutObserver();
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
    try { _installMarkerNavBindings(editor); } catch (_) {}
    try {
      var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
      var t = prefs && prefs.editor && prefs.editor.theme ? prefs.editor.theme : '';
      applyMonacoTheme(t);
    } catch (_) {}
    try {
      var dom = editor.getDomNode();
      if (dom) {
        dom.addEventListener('contextmenu', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }, { capture: true });
      }
    } catch (_) {}
    if (model) {
      try { editor.setModel(model); } catch (_) {}
      installMirrorPublisher();
      installScrollPublisher();
    }
    ensureTouchSelection('plain');
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
    try {
      var dom = editor.getDomNode();
      if (dom) {
        dom.addEventListener('contextmenu', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }, { capture: true });
      }
    } catch (_) {}

    if (model) {
      try { editor.setModel(model); } catch (_) {}
      installMirrorPublisher();
      installScrollPublisher();
    }
    // Request breadcrumb symbols for the diff editor's active file.
    try { if (currentPath) _bcRequestSymbols(currentPath); } catch (_) {}
    ensureTouchSelection('diff');
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

    return diffEditor;
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
    try {
      if (!editor) return;
      if (!(window['monaco-touch-selection'] && window['monaco-touch-selection'].editorTouchSelectionHelp)) return;
      var dom = editor.getDomNode && editor.getDomNode();
      if (!dom) return;
      // If Monaco rebuilt the editor DOM (common on language switches), re-install.
      var hasUI = !!dom.querySelector('.monaco-editor-touch-selections');
      if (!hasUI) {
        window['monaco-touch-selection'].editorTouchSelectionHelp(editor, {
          tools: function (ctx) {
            try {
              var defaultTools = ctx && ctx.defaultTools ? ctx.defaultTools : null;
              if (!defaultTools || typeof defaultTools.set !== 'function') return defaultTools && defaultTools.values ? defaultTools.values() : undefined;
              if (!defaultTools.has('hover')) {
                defaultTools.set('hover', {
                  name: 'hover',
                  innerHTML: 'Hover',
                  action: async function () {
                    try { if (ctx && ctx.closeMenu) ctx.closeMenu(); } catch (_) {}
                    try {
                      if (!editor) return true;
                      var sel = editor.getSelection ? editor.getSelection() : null;
                      if (sel && sel.getStartPosition) {
                        try { editor.setPosition(sel.getStartPosition()); } catch (_) {}
                      }
                      var action = editor.getAction ? editor.getAction('editor.action.showHover') : null;
                      if (action && action.run) action.run();
                      else editor.trigger('touch', 'editor.action.showHover', null);
                      updateDebug('touch=hover:menu');
                    } catch (_) {}
                    return true;
                  },
                });
              }
              return defaultTools.values();
            } catch (_) {
              return ctx && ctx.defaultTools && ctx.defaultTools.values ? ctx.defaultTools.values() : undefined;
            }
          },
        });
        updateDebug('touch=reinit' + (reason ? ':' + reason : ''));
      }
      // Long-press hover path disabled (use touch menu Hover instead).
    } catch (e) {
      console.warn('[MonacoTouchSelection] ensure failed', e);
    }
  }

  function updateDebug(extra) {
    try {
      if (!dbg) dbg = document.getElementById('fh-debug');
      if (!dbg) return;
      var hasExt = !!(window['monaco-touch-selection'] && window['monaco-touch-selection'].editorTouchSelectionHelp);
      var og = editor && editor.getDomNode ? editor.getDomNode().querySelector('.overflow-guard') : null;
      var msg = 'ext=' + (hasExt ? 'yes' : 'no') + ' og=' + (og ? 'yes' : 'no');
      if (extra) debugParts.extra = extra;
      if (debugParts.git) msg += ' ' + debugParts.git;
      if (debugParts.draft) msg += ' ' + debugParts.draft;
      if (debugParts.diag) msg += ' ' + debugParts.diag;
      if (debugParts.flags) msg += ' ' + debugParts.flags;
      if (debugParts.mirror) msg += ' ' + debugParts.mirror;
      if (debugParts.trace) msg += ' ' + debugParts.trace;
      if (debugParts.extra) msg += ' ' + debugParts.extra;
      dbg.textContent = msg;
    } catch (_) {}
  }

  function setDebugGit(s) {
    debugParts.git = s || null;
    updateDebug();
  }

  function setDebugDraft(s) {
    debugParts.draft = s || null;
    updateDebug();
  }

  function setDebugDiag(s) {
    debugParts.diag = s || null;
    updateDebug();
  }

  function setDebugFlags(s) {
    debugParts.flags = s || null;
    updateDebug();
  }

  function setDebugMirror(s) {
    debugParts.mirror = s || null;
    updateDebug();
  }

  function setDebugTrace(s) {
    debugParts.trace = s || null;
    updateDebug();
  }

  function _syncTraceDebug() {
    setDebugTrace(
      'trace=mb' + _trace.mirror_bind_total +
      '/a' + _trace.mirror_active +
      ' us=' + _trace.unsaved_reason +
      ' gb=' + _trace.gb_req_total +
      '/' + _trace.gb_req_immediate +
      '/' + _trace.gb_req_debounced +
      ' src=' + _trace.gb_last_source
    );
  }

  function _syncMirrorDebug() {
    setDebugMirror(
      'mir=rx' + mirrorState.rx +
      '/ap' + mirrorState.ap +
      '/self' + mirrorState.drop_self +
      '/sha' + mirrorState.drop_sha +
      '/hot' + mirrorState.drop_hot
    );
  }

  function clearDraftDiffDecorations() {
    try {
      clearDraftDiffZones();
      if (draftDecoCollection && draftDecoCollection.clear) {
        draftDecoCollection.clear();
      } else if (editor && editor.deltaDecorations) {
        draftDecoIds = editor.deltaDecorations(draftDecoIds, []);
      }
    } catch (_) {}
    setDebugDraft(null);
    lastDraftZones = null;
  }

  function clearDraftDiffZones() {
    try {
      if (!editor || !editor.changeViewZones) {
        draftZoneIds = [];
        return;
      }
      if (!draftZoneIds || !draftZoneIds.length) return;
      editor.changeViewZones(function(accessor) {
        for (var i = 0; i < draftZoneIds.length; i++) {
          try { accessor.removeZone(draftZoneIds[i]); } catch (_) {}
        }
      });
    } catch (_) {}
    draftZoneIds = [];
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
    try {
      if (!editor || !window.monaco) return;
      var maxLines = 1;
      try { if (model && model.getLineCount) maxLines = Math.max(maxLines, model.getLineCount()); } catch (_) {}
      try { if (gitHeadModel && gitHeadModel.getLineCount) maxLines = Math.max(maxLines, gitHeadModel.getLineCount()); } catch (_) {}
      try { if (gitDiskModel && gitDiskModel.getLineCount) maxLines = Math.max(maxLines, gitDiskModel.getLineCount()); } catch (_) {}
      var digits = String(maxLines || 1).length;
      var minChars = Math.max(4, digits + 1);
      if (diffEditor && diffEditor.getOriginalEditor && diffEditor.getModifiedEditor) {
        var diffMin = Math.max(4, digits + 1);
        try { diffEditor.getOriginalEditor().updateOptions({ lineNumbersMinChars: diffMin }); } catch (_) {}
        try { diffEditor.getModifiedEditor().updateOptions({ lineNumbersMinChars: diffMin }); } catch (_) {}
        try { editor.updateOptions({ lineNumbersMinChars: diffMin }); } catch (_) {}
      } else {
        try { editor.updateOptions({ lineNumbersMinChars: minChars }); } catch (_) {}
      }
    } catch (_) {}
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
              after: Math.max(1, anchor - 1),
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

  function applyContent(data) {
    if (!data) return;
    // Legacy host-driven content push. Prefer cm6_open_path + SSOT pull.
    ensureEditor();
    ensureTouchSelection('pre');
    if (!editor || !window.monaco) {
      pending = data;
      updateDebug('pending=1');
      return;
    }
    var nextPath = (typeof data.path === 'string' && data.path) ? data.path : null;
    var lang = normalizeLanguage(data.language);
    var content = (typeof data.content === 'string') ? data.content : '';

    if (!model) {
      try {
        // Keep a single model to avoid editor/plugin teardown between files.
        model = createFileModel(content, lang, nextPath);
        editor.setModel(model);
        applyLanguageToModel(model, lang, nextPath);
        vscodeRpcDidOpenIfReady();
        installVscodeRpcChangePublisher();
      } catch (e) {
        console.warn('[Monaco] createModel failed, falling back to setValue', e);
        editor.setValue(content);
      }
    } else {
      try { model.setValue(content); } catch (_) { editor.setValue(content); }
      applyLanguageToModel(model, lang, nextPath);
    }
    currentPath = nextPath;
    try { lastContentSha256 = data.content_sha256 || lastContentSha256; } catch (_) {}
    applyLineNumberSizing();
    ensureTouchSelection('post');
    setTimeout(function(){ ensureTouchSelection('tick'); }, 0);
    emitToHost('editor_notify', { type: 'cm6_set_content_ack', path: data.path || null });
    updateDebug('pending=0');
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

    var autoSave = null;
    try {
      var prefs = cachedPrefs && cachedPrefs.preferences ? cachedPrefs.preferences : cachedPrefs;
      autoSave = prefs && prefs.editor && typeof prefs.editor.autoSave === 'boolean' ? prefs.editor.autoSave : null;
    } catch (_) {}

    var cache = null;
    try {
      cache = await fetchJson('/editor/check_cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: absPath }),
      });
    } catch (_) {}

    var hasDraft = !!(cache && cache.has_draft);
    var content = null;
    var sha256 = null;
    if (hasDraft) {
      content = typeof cache.content === 'string' ? cache.content : '';
      sha256 = (cache.base_sha256 && typeof cache.base_sha256 === 'string') ? cache.base_sha256 : null;
    } else {
      var read = await fetchJson('/read?path=' + encodeURIComponent(absPath), { cache: 'no-store' });
      content = typeof read.content === 'string' ? read.content : '';
      sha256 = (read.sha256 && typeof read.sha256 === 'string') ? read.sha256 : null;
    }

    // Apply to Monaco model
    var lang = normalizeLanguage(preferredLanguage || '');
    if (!lang || lang.indexOf('/') >= 0) {
      lang = languageFromPath(absPath);
    }
    if (!model) {
      model = createFileModel(content || '', lang, absPath);
      editor.setModel(model);
      applyLanguageToModel(model, lang, absPath);
      installMirrorPublisher();
      installScrollPublisher();
      vscodeRpcDidOpenIfReady();
      installVscodeRpcChangePublisher();
    } else {
      try {
        var want = _fileUri(absPath);
        if (want && model.uri && String(model.uri.toString()) !== String(want.toString())) {
          if (diffEditor) { try { diffEditor.setModel(null); } catch (_) {} }
          try { model.dispose(); } catch (_) {}
          model = createFileModel(content || '', lang, absPath);
          editor.setModel(model);
          applyLanguageToModel(model, lang, absPath);
          installMirrorPublisher();
          installScrollPublisher();
          vscodeRpcDidOpenIfReady();
          installVscodeRpcChangePublisher();
        } else {
          try { isApplyingRemote = true; model.setValue(content || ''); } catch (_) { editor.setValue(content || ''); } finally { isApplyingRemote = false; }
          applyLanguageToModel(model, lang, absPath);
        }
      } catch (_) {
        try { isApplyingRemote = true; model.setValue(content || ''); } catch (_) { editor.setValue(content || ''); } finally { isApplyingRemote = false; }
        applyLanguageToModel(model, lang, absPath);
      }
    }
    currentPath = absPath;
    var backendGeneration = _wbBumpGeneration(currentPath, 'openPathFromBackend');
    try { bcUpdatePath(currentPath, true); } catch (_) {}
    baseSha256 = sha256;

    // Emit SSOT-derived telemetry to host (draft badge + autosave toggle sync).
    emitToHost('editor_cache_state', {
      path: absPath,
      state: hasDraft ? 'mid_session' : 'clean',
      unsaved: hasDraft,
      reason: hasDraft ? 'restore' : 'set_content',
      content_sha256: sha256,
      auto_save: autoSave,
    });
    if (hasDraft) {
      emitToHost('editor_draft_state', { has_draft: true, path: absPath });
    }

    try {
      var backendReqId = 'diag_' + Date.now() + '_backend';
      var backendText = model && model.getValue ? model.getValue() : '';
      _wbQueueDidChange(
        currentPath,
        backendText,
        model && model.getLanguageId ? model.getLanguageId() : lang,
        backendGeneration
      );
      _wbQueueSymbols(currentPath, backendGeneration);
      _wbOpenFileFlow({
        path: currentPath,
        languageId: lang,
        uri: (model && model.uri) ? String(model.uri.toString()) : '',
        requestId: backendReqId,
        forceRefresh: true,
        generation: backendGeneration,
        source: 'openPathFromBackend',
        timeoutMs: 8000,
      }).catch(function () {});
    } catch (_) {}

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
        // Kick off sequential readiness chain: code-server -> adapter -> baton.
        emitToHost('editor:iframe_ready', {});
        editorSocket.emit('editor_readiness_check', {});
      });

      // Readiness step events from the server-side chain.
      editorSocket.on('editor:readiness_step', function(data) {
        var step = data && data.step || '';
        var ok = data && data.ok;
        console.log('[readiness] step=' + step + ' ok=' + ok + (data.error ? ' error=' + data.error : ''));
        emitToHost('editor:readiness_step', data);
        if (step === 'baton' && ok) {
          window.__te2AdapterReady = true;
          // Replay initial open_file now that the adapter is confirmed ready.
          // This gates diagnostics/symbols to AFTER the full readiness chain.
          _replayOpenFileAfterBaton();
        }
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
                  var want = _fileUri(currentPath);
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
                  applyJumpToLine({ line: f.scroll_line, focus: false, scroll_to_top: true });
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

              // If diagnostics arrived early (before model/currentPath), apply from cache now.
              try { _applyCachedDiagnosticsForActive(); } catch (_) {}
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
                var want = _fileUri(currentPath);
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
            // Apply cached diagnostics for this file immediately after open/model swap.
            try { _applyCachedDiagnosticsForActive(); } catch (_) {}
            // Optional open+jump payload (used by agent drawer + explorer + go-to-line).
            try {
              if (payload.line != null) {
                applyJumpToLine({
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
                applyJumpToLine({ line: payload.scroll_line, focus: false, scroll_to_top: true });
              }
            } catch (_) {}
          });
          requestGitBaselines({ reason: 'open' });
        } catch (e) {
          console.warn('[Monaco] open apply failed', e);
        }
      });

      editorSocket.on('editor:jump_to_line', function(payload) {
        try { applyJumpToLine(payload); } catch (e) { console.warn('[Monaco] jump_to_line failed', e); }
      });

      editorSocket.on('editor:mirror', function(payload) {
        try {
          mirrorState.rx += 1;
          if (!payload || !payload.path || typeof payload.content !== 'string') return;
          if (payload.source_client && editorSocketId && String(payload.source_client) === String(editorSocketId)) {
            mirrorState.drop_self += 1;
            _syncMirrorDebug();
            return;
          }
          if (currentPath && String(payload.path) !== String(currentPath)) {
            mirrorState.drop_path += 1;
            _syncMirrorDebug();
            return;
          }
          if (!model) {
            mirrorState.drop_no_model += 1;
            _syncMirrorDebug();
            return;
          }
          if (payload.content_sha256 && lastContentSha256 && String(payload.content_sha256) === String(lastContentSha256)) {
            mirrorState.drop_sha += 1;
            _syncMirrorDebug();
            return;
          }
          var hotMs = _mirrorHotWindowMs();
          if (hotMs > 0 && lastLocalEditAt > 0 && (Date.now() - lastLocalEditAt) < hotMs) {
            mirrorState.drop_hot += 1;
            _syncMirrorDebug();
            return;
          }
          // Skip if content is identical (self-echo from authoring client).
          if (model.getValue && model.getValue() === payload.content) {
            mirrorState.drop_sha += 1;
            _syncMirrorDebug();
            return;
          }
          isApplyingRemote = true;
          try {
            var fullRange = model.getFullModelRange();
            model.applyEdits([{ range: fullRange, text: payload.content }]);
          } finally { isApplyingRemote = false; }
          try { lastContentSha256 = payload.content_sha256 || lastContentSha256; } catch (_) {}
          mirrorState.ap += 1;
          _syncMirrorDebug();
          applyLineNumberSizing();
          var mirrorUnsaved = (payload.unsaved === true);
          _setUnsavedTrace('mirror', mirrorUnsaved);
          emitToHost('editor_cache_state', {
            path: payload.path,
            state: mirrorUnsaved ? 'mid_session' : 'clean',
            unsaved: mirrorUnsaved,
            reason: 'mirror',
            content_sha256: payload.content_sha256,
          });
          if (mirrorUnsaved) {
            emitToHost('editor_draft_state', { has_draft: true, path: payload.path });
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
          requestGitBaselines({ reason: 'prefs' });
          if (getShowDraftDiffs()) requestDraftDiff('prefs');
          else clearDraftDiffDecorations();
          // Ensure semantic token provider is installed once monaco is live.
          ensureVscodeRpcConnected();
        } catch (e) {
          console.warn('[Monaco] prefs_changed apply failed', e);
        }
      });

      editorSocket.on('editor:git_baselines', function(payload) {
        applyGitBaselines(payload);
      });

      editorSocket.on('editor:draft_diff', function(payload) {
        try {
          if (!payload || !payload.path || !currentPath) return;
          if (String(payload.path) !== String(currentPath)) return;
          if (payload.requestId && draftDiffRequestId && String(payload.requestId) !== String(draftDiffRequestId)) return;
          applyDraftDiffDecorations(payload);
        } catch (e) {
          console.warn('[DraftDiff] handler failed', e);
        }
      });

      editorSocket.on('editor:cache_state', function(payload) {
        try {
          if (!payload || !payload.path || !currentPath) return;
          if (String(payload.path) !== String(currentPath)) return;
          if (payload.unsaved === false) {
            clearDraftDiffDecorations();
            // After a save, refresh Git baselines so inline git diffs update.
            // In autosave mode, skip the refresh if the diff editor is already
            // correctly configured — the diff is HEAD vs live editor, disk state
            // is irrelevant, and refreshing on every save causes cursor jumps
            // from gitDiskModel.setValue() + potential setModel() calls.
            try {
              if (getAutoSave()) {
                // Only refresh if diff editor isn't set up yet or flags are stale.
                var _skipRefresh = false;
                if (diffEditor && diffEditor.getModel) {
                  var _dm = diffEditor.getModel();
                  if (_dm && _dm.original === gitHeadModel && _dm.modified === model && !!_dm.te2AutosaveMode) {
                    _skipRefresh = true;
                  }
                } else {
                  // No diff editor — plain editor autosave; skip baseline refresh
                  // to avoid cursor jumps from unnecessary editor recreation.
                  _skipRefresh = true;
                }
                if (!_skipRefresh) requestGitBaselines({ reason: 'cache_state_clean_autosave' });
              } else {
                requestGitBaselines({ immediate: true, reason: 'cache_state_clean' });
              }
            } catch (_) {}
            _setUnsavedTrace(payload.reason || 'cache_state', false);
            return;
          }
          if (payload.unsaved === true) {
            _setUnsavedTrace(payload.reason || 'cache_state', true);
            requestDraftDiff('cache_state');
          }
        } catch (_) {}
      });

      // Diagnostics from workbench adapter via server-side bridge (editor_ws).
      // This arrives over the already-connected Socket.IO, avoiding the vscode_api_ws race.
      editorSocket.on('editor:diagnostics', function(payload) {
        try {
          if (!payload || typeof payload !== 'object') return;
          var _ts = '';
          try {
            var _t = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
              ? (Math.round(performance.now() * 10) / 10)
              : null;
            _ts = (_t != null ? ('t=' + _t + 'ms ') : '') + 'now=' + Date.now();
          } catch (_) { _ts = 'now=' + Date.now(); }
          var modelUri = (model && model.uri) ? String(model.uri.toString()) : '';
          var activePath = currentPath ? String(currentPath) : _absPathFromVscodeUri(modelUri);
          var payloadPath = payload.path ? String(payload.path) : '';
          console.log(_ts, '[editor:diagnostics] rx', payload.type,
            'path=' + (payloadPath || '?'),
            'markers=' + ((payload.markers || []).length),
            'currentPath=' + currentPath,
            'modelUri=' + modelUri,
            'activePath=' + activePath
          );
          // Full diagnostic objects for severity inspection
          if (payload.markers && payload.markers.length) {
            console.log('[editor:diagnostics] first 5 markers:', payload.markers.slice(0, 5));
          }
          if (payload.type === 'diagnostics/update') {
            // Convert server-side bridge format to the format _applyDiagnosticsUpdate expects.
            var items = [{ uri: 'file://' + (payload.path || ''), markers: payload.markers || [] }];
            _applyDiagnosticsUpdate({ owner: payload.owner || 'workbench', items: items });
          }
        } catch (_) {}
      });

      editorSocket.on('editor:workbench_open_file_response', function (data) {
        try {
          var rid = data && data.request_id;
          var entry = _wbPending.get(rid);
          if (!entry) return;
          _wbPending.delete(rid);
          clearTimeout(entry.timer);
          if (data.error) entry.reject(new Error(String(data.error)));
          else entry.resolve(data.result || data);
        } catch (_) {}
      });

      editorSocket.on('editor:workbench_hover_response', function (data) {
        try {
          var rid = data && data.request_id;
          var entry = _wbPending.get(rid);
          if (!entry) return;
          _wbPending.delete(rid);
          clearTimeout(entry.timer);
          if (data.error) entry.reject(new Error(String(data.error)));
          else entry.resolve(data.result || data);
        } catch (_) {}
      });

      editorSocket.on('editor:workbench_symbols_response', function (data) {
        try {
          var rid = data && data.request_id;
          var entry = _wbPending.get(rid);
          if (!entry) return;
          _wbPending.delete(rid);
          clearTimeout(entry.timer);
          if (data.error) entry.reject(new Error(String(data.error)));
          else entry.resolve(data.result || data);
        } catch (_) {}
      });

      editorSocket.on('editor:issues_dump_request', function(payload) {
        try {
          var requestId = payload && (payload.requestId || payload.request_id)
            ? String(payload.requestId || payload.request_id)
            : '';
          if (!requestId) return;
          var dump = {};
          try {
            if (window.monaco && model) {
              var markers = monaco.editor.getModelMarkers({ resource: model.uri }) || [];
              dump = { markers: markers };
            }
          } catch (_) {}
          emitToHost('editor_issues_dump_response', { requestId: requestId, dump: dump });
        } catch (e) {
          console.warn('[Monaco] issues dump response failed', e);
        }
      });

      editorSocket.on('editor:issues_cmd', function(payload) {
        try {
          var action = payload && payload.action ? String(payload.action) : '';
          if (!action) return;
          _runIssuesCommand(action);
        } catch (_) {}
      });

      editorSocket.on('editor:find_cmd', function(payload) {
        try {
          var action = payload && payload.action ? String(payload.action) : 'find';
          _runFindCommand(action);
        } catch (_) {}
      });

      return true;
    } catch (e) {
      console.warn('[Monaco] socket connect failed', e);
      return false;
    }
  }

  function _runIssuesCommand(action) {
    try {
      if (!editor) return;
      var id = 'editor.action.marker.next';
      if (action === 'toggle') action = 'next';
      if (action === 'prev') id = 'editor.action.marker.prev';
      var act = editor.getAction ? editor.getAction(id) : null;
      if (act && act.run) {
        act.run();
      }
    } catch (_) {}
  }

  function _runFindCommand(action) {
    try {
      if (!editor) return;
      var id = action === 'replace' ? 'editor.action.startFindReplaceAction' : 'actions.find';
      var act = editor.getAction ? editor.getAction(id) : null;
      if (act && act.run) {
        act.run();
      } else {
        editor.trigger('keyboard', id, null);
      }
    } catch (_) {}
  }

  function _installMarkerNavBindings(ed) {
    try {
      if (!ed || ed.__te2MarkerNavBound || !window.monaco || !monaco.KeyMod || !monaco.KeyCode) return;
      ed.__te2MarkerNavBound = true;
      ed.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.F8, function () { _jumpToMarker(1); });
      ed.addCommand(monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.F8, function () { _jumpToMarker(-1); });
    } catch (_) {}
  }

  function _jumpToMarker(dir) {
    try {
      if (!editor || !model || !window.monaco) return;
      var markers = monaco.editor.getModelMarkers({ resource: model.uri }) || [];
      if (!markers.length) return;
      markers.sort(function (a, b) {
        if (a.startLineNumber !== b.startLineNumber) return a.startLineNumber - b.startLineNumber;
        return a.startColumn - b.startColumn;
      });
      var pos = editor.getPosition ? editor.getPosition() : null;
      var line = pos && pos.lineNumber ? pos.lineNumber : 1;
      var col = pos && pos.column ? pos.column : 1;
      var idx = -1;
      if (dir > 0) {
        for (var i = 0; i < markers.length; i++) {
          var m = markers[i];
          if (m.startLineNumber > line || (m.startLineNumber === line && m.startColumn > col)) { idx = i; break; }
        }
        if (idx === -1) idx = 0;
      } else {
        for (var j = markers.length - 1; j >= 0; j--) {
          var m2 = markers[j];
          if (m2.startLineNumber < line || (m2.startLineNumber === line && m2.startColumn < col)) { idx = j; break; }
        }
        if (idx === -1) idx = markers.length - 1;
      }
      var hit = markers[idx];
      if (!hit) return;
      var targetLine = Math.max(1, Number(hit.startLineNumber || 1));
      var targetCol = Math.max(1, Number(hit.startColumn || 1));
      try { editor.setPosition({ lineNumber: targetLine, column: targetCol }); } catch (_) {}
      try { editor.revealLineInCenter(targetLine, 0); } catch (_) {}
      try { editor.focus(); } catch (_) {}
    } catch (_) {}
  }

  function applyJumpToLine(payload) {
    try {
      if (!payload) return;
      if (!editor || !model) return;

      var line = payload.line;
      var col = payload.column;
      if (typeof line === 'string' && /^\d+$/.test(line)) line = parseInt(line, 10);
      if (typeof col === 'string' && /^\d+$/.test(col)) col = parseInt(col, 10);
      if (!Number.isFinite(line)) return;
      line = Math.max(1, Math.min(model.getLineCount(), line));
      if (!Number.isFinite(col)) col = 1;
      col = Math.max(1, Math.min(model.getLineMaxColumn(line), col));

      var focus = payload.focus;
      var scrollY = payload.scroll_y;
      var scrollToTop = payload.scroll_to_top;

      if (scrollToTop) {
        try { editor.revealLine(line, 0); } catch (_) {}
      } else if (typeof scrollY === 'string' && String(scrollY).toLowerCase() === 'center') {
        try { editor.revealLineInCenter(line, 0); } catch (_) {}
      } else {
        try { editor.revealLineNearTop(line, 0); } catch (_) {}
      }

      try { editor.setPosition({ lineNumber: line, column: col }); } catch (_) {}
      try { if (focus !== false) editor.focus(); } catch (_) {}
    } catch (_) {}
  }

  function installScrollPublisher() {
    try {
      if (!editor || !editor.onDidScrollChange || !editor.onDidChangeCursorPosition) return;
      if (installScrollPublisher._done) return;
      installScrollPublisher._done = true;

      var lastSentAt = 0;
      var pendingT = null;

      var send = function() {
        pendingT = null;
        try {
          if (!editorSocket || !editorSocket.connected) return;
          if (!currentPath || !model) return;
          var pos = null;
          try { pos = editor.getPosition(); } catch (_) { pos = null; }
          var line = pos && pos.lineNumber ? pos.lineNumber : null;
          var col = pos && pos.column ? pos.column : null;
          if (!line) return;
          editorSocket.emit('editor_scroll_state', {
            path: currentPath,
            line: line,
            column: col || 1,
          });
          lastSentAt = Date.now();
          try { bcUpdateCursor(line); } catch (_) {}
        } catch (_) {}
      };

      var schedule = function() {
        try {
          var now = Date.now();
          // Throttle: at most once every ~400ms.
          if (now - lastSentAt > 400) {
            send();
            return;
          }
          if (pendingT) return;
          pendingT = setTimeout(send, 450);
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
    if (currentPath && nextPath && String(nextPath) !== String(currentPath)) return;

    var content = (typeof data.content === 'string') ? data.content : '';
    try {
      if (model && model.getFullModelRange) {
        var _mirrorRange = model.getFullModelRange();
        model.applyEdits([{ range: _mirrorRange, text: content }]);
      } else if (model && model.setValue) {
        model.setValue(content);
      } else {
        editor.setValue(content);
      }
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
    _bcEl = document.getElementById('te2-breadcrumbs');
    // Load seti-icons ESM module for file icons
    import('/static/vendor/seti-icons/seti-icons.js').then(function(mod) {
      mod.ensureLoaded();
      _bcGetIcon = mod.getIcon;
      // Re-render if we already have a path (icons were missing on first render)
      if (_bcLastPath) _bcRender();
    }).catch(function(e) { console.warn('[BC] seti-icons load failed:', e); });
  }

  function bcUpdatePath(absPath, deferSymbols) {
    if (!_bcEl || !absPath) return;
    if (absPath === _bcLastPath && !deferSymbols) return;
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
    var langId = (model && model.getLanguageId) ? model.getLanguageId() : '';
    if (!langId) langId = languageFromPath(absPath) || '';
    // plaintext has no symbol provider and never will — skip to avoid
    // 8s timeout loops that trigger workbench re-opens and cursor resets.
    if (langId === 'plaintext') {
      _bcSymbols = [];
      _bcRender();
      return;
    }
    // TS/JS extensions can be slow to activate on mobile — give them extra time
    var tms = (langId === 'javascript' || langId === 'typescript' || langId === 'javascriptreact' || langId === 'typescriptreact') ? 15000 : 8000;
    editorWorkbenchCall('symbols', {
      path: absPath,
      languageId: langId,
      generation: generation,
    }, { timeoutMs: tms }).then(function(result) {
      if (seq !== _bcSymbolsSeq) return; // stale
      if (generation !== _wbCurrentGeneration()) return; // stale generation
      if (String(absPath || '') !== String(currentPath || '')) return; // stale path
      // Unwrap adapter response: {ok, result: [...]} or raw array
      var symbols = result;
      if (symbols && typeof symbols === 'object' && !Array.isArray(symbols)) {
        symbols = symbols.result || symbols.symbols || [];
      }
      _bcSymbols = Array.isArray(symbols) ? symbols : [];
      console.log('[BC] symbols received:', _bcSymbols.length, _bcSymbols.slice(0, 2));
      _bcRender();
    }).catch(function(e) { console.warn('[BC] symbols request failed:', e); });
  }

  function bcUpdateCursor(line) {
    if (!_bcEl || !_bcLastPath) return;
    _bcRender(line);
  }

  function _bcFindSymbolChain(symbols, line) {
    var chain = [];
    var cur = symbols;
    while (cur && cur.length) {
      var found = null;
      for (var i = 0; i < cur.length; i++) {
        var s = cur[i];
        var r = s.range || (s.location && s.location.range);
        if (!r) continue;
        // Handle both Monaco (1-indexed) and LSP (0-indexed) range formats
        var startLine, endLine;
        if (typeof r.startLineNumber === 'number') {
          startLine = r.startLineNumber;
          endLine = r.endLineNumber || 999999;
        } else if (r.start && typeof r.start.line === 'number') {
          startLine = r.start.line + 1; // LSP is 0-indexed
          endLine = (r.end && typeof r.end.line === 'number') ? r.end.line + 1 : 999999;
        } else if (typeof r.startLine === 'number') {
          startLine = r.startLine;
          endLine = r.endLine || 999999;
        } else {
          // Try array format [startLine, startCol, endLine, endCol]
          if (Array.isArray(r) && r.length >= 3) {
            startLine = r[0] + 1;
            endLine = r[2] + 1;
          } else continue;
        }
        if (line >= startLine && line <= endLine) { found = s; break; }
      }
      if (!found) break;
      chain.push(found);
      cur = found.children || [];
    }
    return chain;
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
    var entry = _SYM_CODICON[kind];
    var cls = entry ? entry[0] : 'codicon-symbol-misc';
    var col = entry ? entry[1] : '#8b949e';
    return '<span class="codicon ' + cls + '" style="color:' + col + ';font-size:14px;line-height:1"></span>';
  }

  function _bcRender(cursorLine) {
    if (!_bcEl) return;
    _bcEl.innerHTML = '';
    if (!_bcLastPath) return;

    var parts = _bcLastPath.split('/').filter(Boolean);
    var accum = '';

    for (var i = 0; i < parts.length; i++) {
      accum += '/' + parts[i];
      if (i > 0) {
        var sep = document.createElement('span');
        sep.className = 'te2-bc-sep';
        sep.textContent = '\u203A'; // ›
        _bcEl.appendChild(sep);
      }
      var isFile = (i === parts.length - 1);
      var item = document.createElement('span');
      item.className = 'te2-bc-item';
      item.dataset.path = accum;
      item.dataset.isFile = isFile ? '1' : '0';
      // Add seti icon for the file segment
      if (isFile && _bcGetIcon) {
        var iconSpan = document.createElement('span');
        iconSpan.className = 'te2-bc-icon';
        item.appendChild(iconSpan);
        (function(span, name) {
          var brightTheme = {
            blue: '#4da6ff', green: '#a6e22e', red: '#f85149',
            orange: '#f0883e', yellow: '#e3b341', purple: '#bc8cff',
            pink: '#f778ba', white: '#e6edf3', grey: '#8b949e',
            'grey-light': '#b1bac4', ignore: '#6e7681',
          };
          _bcGetIcon(name, brightTheme).then(function(ic) {
            if (ic && ic.svg) span.innerHTML = ic.svg;
            if (ic && ic.color) span.style.color = ic.color;
          }).catch(function() {});
        })(iconSpan, parts[i]);
      }
      var label = document.createElement('span');
      label.textContent = parts[i];
      item.appendChild(label);
      item.addEventListener('click', _bcOnPathClick);
      _bcEl.appendChild(item);
    }

    // Symbol chain based on cursor
    if (_bcSymbols.length && typeof cursorLine === 'number' && cursorLine > 0) {
      var chain = _bcFindSymbolChain(_bcSymbols, cursorLine);
      for (var j = 0; j < chain.length; j++) {
        var ssep = document.createElement('span');
        ssep.className = 'te2-bc-sep';
        ssep.textContent = '\u203A';
        _bcEl.appendChild(ssep);

        var sitem = document.createElement('span');
        sitem.className = 'te2-bc-item';
        // Symbol kind SVG icon
        var si = document.createElement('span');
        si.className = 'te2-bc-sym-icon';
        si.innerHTML = _bcSymbolSvg(chain[j].kind);
        sitem.appendChild(si);
        var slabel = document.createElement('span');
        slabel.textContent = chain[j].name || '';
        sitem.appendChild(slabel);
        sitem.dataset.symIdx = String(j);
        var symRange = chain[j].selectionRange || chain[j].range;
        if (symRange) {
          var sl = symRange.startLineNumber || symRange.startLine || (symRange.start && typeof symRange.start.line === 'number' ? symRange.start.line + 1 : null) || 1;
          var sc = symRange.startColumn || (symRange.start && typeof symRange.start.character === 'number' ? symRange.start.character + 1 : null) || 1;
          if (Array.isArray(symRange) && symRange.length >= 2) { sl = symRange[0] + 1; sc = symRange[1] + 1; }
          sitem.dataset.line = String(sl);
          sitem.dataset.col = String(sc);
        }
        sitem.addEventListener('click', _bcOnSymbolClick);
        _bcEl.appendChild(sitem);
      }
    }
    // Auto-scroll to show the rightmost (active) item
    _bcEl.scrollLeft = _bcEl.scrollWidth;
  }

  function _bcOnPathClick(ev) {
    try {
      var el = ev.currentTarget;
      var isFile = el.dataset.isFile === '1';
      if (isFile) return; // file segment = no-op (already open)
      // Directory click → emit to editor socket, which relays to explorer
      var absDir = el.dataset.path || '';
      console.log('[BC] path click:', absDir, 'socket connected:', !!(editorSocket && editorSocket.connected));
      if (editorSocket && editorSocket.connected) {
        editorSocket.emit('editor_breadcrumb_navigate', { path: absDir, open_drawer: true });
      }
    } catch (_) {}
  }

  function _bcOnSymbolClick(ev) {
    try {
      var el = ev.currentTarget;
      var line = parseInt(el.dataset.line, 10);
      var col = parseInt(el.dataset.col, 10) || 1;
      if (Number.isFinite(line)) {
        applyJumpToLine({ line: line, column: col, focus: true, scroll_y: 'center' });
      }
    } catch (_) {}
  }
  // ─── End Breadcrumb ──────────────────────────────────────

  async function bootMonaco() {
    try {
      // Load the pinned VS Code monaco-editor-core ESM build (served by the worker).
      // NOTE: This is the only supported Monaco source for TE2 right now.
      var base = (apiBase || '') + '/ui/monaco_vscode/esm';
      var langBase = (apiBase || '') + '/ui/monaco_vscode/lang';

      // Monaco ESM expects a global MonacoEnvironment.getWorker for editor services.
      // Provide worker entrypoints for Monaco language services + editor services.
      window.MonacoEnvironment = {
        getWorker: function(_moduleId, _label) {
          try {
            var label = String(_label || '');
            var moduleId = String(_moduleId || '');
            // Monaco's language services are worker-backed (completion/diagnostics/etc).
            // Route by label, mirroring Monaco's standard mapping.
            if (label === 'typescript' || label === 'javascript') {
              var wts = new Worker(langBase + '/workers/ts.worker.js', { type: 'module' });
              if (!_workerLogOnce['ts']) {
                _workerLogOnce['ts'] = true;
                console.log('[MonacoWorker] ts', { moduleId: moduleId, label: label, url: langBase + '/workers/ts.worker.js' });
              }
              wts.onerror = function(ev) { console.error('[MonacoWorker] ts error', ev); };
              wts.onmessageerror = function(ev) { console.error('[MonacoWorker] ts messageerror', ev); };
              return wts;
            }
            if (label === 'json') {
              var wj = new Worker(langBase + '/workers/json.worker.js', { type: 'module' });
              if (!_workerLogOnce['json']) {
                _workerLogOnce['json'] = true;
                console.log('[MonacoWorker] json', { moduleId: moduleId, label: label, url: langBase + '/workers/json.worker.js' });
              }
              wj.onerror = function(ev) { console.error('[MonacoWorker] json error', ev); };
              wj.onmessageerror = function(ev) { console.error('[MonacoWorker] json messageerror', ev); };
              return wj;
            }
            if (label === 'css' || label === 'scss' || label === 'less') {
              var wc = new Worker(langBase + '/workers/css.worker.js', { type: 'module' });
              if (!_workerLogOnce['css']) {
                _workerLogOnce['css'] = true;
                console.log('[MonacoWorker] css', { moduleId: moduleId, label: label, url: langBase + '/workers/css.worker.js' });
              }
              wc.onerror = function(ev) { console.error('[MonacoWorker] css error', ev); };
              wc.onmessageerror = function(ev) { console.error('[MonacoWorker] css messageerror', ev); };
              return wc;
            }
            if (label === 'html' || label === 'handlebars' || label === 'razor') {
              var wh = new Worker(langBase + '/workers/html.worker.js', { type: 'module' });
              if (!_workerLogOnce['html']) {
                _workerLogOnce['html'] = true;
                console.log('[MonacoWorker] html', { moduleId: moduleId, label: label, url: langBase + '/workers/html.worker.js' });
              }
              wh.onerror = function(ev) { console.error('[MonacoWorker] html error', ev); };
              wh.onmessageerror = function(ev) { console.error('[MonacoWorker] html messageerror', ev); };
              return wh;
            }

            // Fallback: editor worker service.
            //
            // IMPORTANT: `vs/editor/editor.worker.start.js` only exports `start()` and does not
            // bootstrap the worker message loop on its own. Using it directly causes Monaco's
            // editor worker RPC to never initialize (diff computation stays pending / null).
            //
            // `editorWebWorkerMain.js` uses `bootstrapWebWorker(...)` and will correctly wire up
            // the worker message handler when Monaco posts the initial "-please-ignore-" message.
            var url = base + '/vs/editor/common/services/editorWebWorkerMain.js';
            var wk = new Worker(url, { type: 'module' });
            var key = 'editor:' + label;
            if (!_workerLogOnce[key]) {
              _workerLogOnce[key] = true;
              console.log('[MonacoWorker] editor', { moduleId: moduleId, label: label, url: url });
            }
            wk.onerror = function(ev) { console.error('[MonacoWorker] editor error', { moduleId: moduleId, label: label, ev: ev }); };
            wk.onmessageerror = function(ev) { console.error('[MonacoWorker] editor messageerror', { moduleId: moduleId, label: label, ev: ev }); };
            return wk;
          } catch (e) {
            console.error('[Monaco] Failed to create worker', e);
            throw e;
          }
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
      try { await loadOfficialThemes(); } catch (_) {}
      try { await applyMonacoTheme('vs-dark'); } catch (_) {}

      // Initialize editor strictly from SSOT.
      await ensureEditorWithPrefs();
      try { installVscodeApiLanguageBridgeProviders(); } catch (_) {}
      if (pending) applyContent(pending);

      try {
        // vscode_api bootstrap snapshot (installed VSIX, themes, grammars, enabled list).
        // This is used for TextMate apply (grammars) today, and will become the basis
        // for extension host bootstrapping in later phases.
        try {
          window.__te2VscodeBootstrap = await vscodeApiCall('vscode.bootstrap.snapshot', {});
        } catch (_) {}
        try {
          tmVscodeIndex = await _refreshVscodeGrammarIndex();
        } catch (_) {}

        if (window.monaco && model && currentPath) {
          applyLanguageToModel(model, languageFromPath(currentPath), currentPath);
        }
        var langs = (window.monaco && monaco.languages && monaco.languages.getLanguages)
          ? monaco.languages.getLanguages().map(function(l){ return l && l.id; }).filter(Boolean)
          : [];
        if (langs.length <= 1 && langs[0] === 'plaintext') {
          console.warn('[Monaco] language registry still plaintext-only');
        }
      } catch (_) {}

      // Connect editor Socket.IO transport (required for readiness chain + SSOT).
      connectEditorSocket();

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
