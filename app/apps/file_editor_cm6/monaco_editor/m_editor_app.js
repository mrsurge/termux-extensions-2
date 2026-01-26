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
  var isApplyingRemote = false;
  var mirrorDebounceT = null;
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
  var debugParts = { git: null, draft: null, extra: null };
  var apiBase = (function() {
    try {
      var p = String(window.location && window.location.pathname ? window.location.pathname : '');
      var idx = p.indexOf('/ui/');
      return idx >= 0 ? p.slice(0, idx) : '';
    } catch (_) { return ''; }
  })();

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

  function ensureEditor() {
    if (editor) return;
    var el = getEditorContainer();
    if (!el || !window.monaco) return;
    // Editor creation MUST be driven by SSOT (HistoryStore/PreferencesStore).
    // This function is only used as a last-resort guard; prefer ensureEditorWithPrefs().
    editor = monaco.editor.create(el, buildMonacoOptionsFromPrefs(cachedPrefs));
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
  }

  function disposePlainEditorOnly() {
    try { if (editor && editor.dispose) editor.dispose(); } catch (_) {}
    editor = null;
    // Drop any cached decoration collection tied to the disposed editor.
    draftDecoCollection = null;
    draftDecoIds = [];
    draftZoneIds = [];
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

    // Theme mapping: CM6 theme keys map to Monaco theme ids.
    var theme = _resolveMonacoThemeId(editorPrefs.theme);

    return {
      value: '',
      language: 'plaintext',
      theme: theme,
      automaticLayout: true,
      contextmenu: false,
      readOnly: readOnly,
      lineNumbers: showLineNumbers ? 'on' : 'off',
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

      // GitHub-inspired palettes (keep light-weight; override only editor UI + token colors).
      // Theme ids are stable Monaco ids so the host can map CM6 theme keys -> Monaco themes.
      window.monaco.editor.defineTheme('te2-github-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '8B949E' },
          { token: 'string', foreground: 'A5D6FF' },
          { token: 'keyword', foreground: 'FF7B72' },
          { token: 'number', foreground: 'FFA657' },
          { token: 'type', foreground: '79C0FF' },
          { token: 'delimiter', foreground: 'C9D1D9' },
        ],
        colors: {
          'editor.background': '#0d1117',
          'editor.foreground': '#c9d1d9',
          'editorLineNumber.foreground': '#6e7681',
          'editorLineNumber.activeForeground': '#c9d1d9',
          'editorCursor.foreground': '#c9d1d9',
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
          'editorSuggestWidget.foreground': '#c9d1d9',
          'dropdown.background': '#161b22',
          'dropdown.border': '#30363d',
          'input.background': '#0d1117',
          'input.border': '#30363d',
          'input.foreground': '#c9d1d9',
          'scrollbar.shadow': '#00000000',
          'scrollbarSlider.background': '#484f5833',
          'scrollbarSlider.hoverBackground': '#484f5866',
          'scrollbarSlider.activeBackground': '#484f5899',
        },
      });

      window.monaco.editor.defineTheme('te2-github-light', {
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
          'editorCursor.foreground': '#24292f',
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

  function _resolveMonacoThemeId(themeKey) {
    try {
      var t = String(themeKey || '').toLowerCase();
      if (t.includes('te2-github-dark') || t.includes('github-dark')) return 'te2-github-dark';
      if (t.includes('te2-github-light') || t.includes('github-light')) return 'te2-github-light';
      if (t.includes('te2-dracula') || t.includes('dracula')) return 'te2-dracula';
      if (t.includes('vscode-dark')) return 'vs-dark';
      if (t.includes('vscode-light')) return 'vs';
      // Fall back to Monaco base themes for everything else.
      if (t.includes('vs-dark')) return 'vs-dark';
      if (t.includes('vs')) return 'vs';
      if (t.includes('light')) return 'vs';
      return 'vs-dark';
    } catch (_) {
      return 'vs-dark';
    }
  }

  function applyMonacoTheme(themeKey) {
    try {
      if (!window.monaco || !window.monaco.editor || !window.monaco.editor.setTheme) return;
      ensureTe2Themes();
      ensureTe2DiffTheme();
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

  function requestGitBaselines() {
    try {
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
    } catch (_) {
      return false;
    }
  }

  function applyGitBaselines(payload) {
    try {
      if (!payload || !payload.path || !currentPath) return;
      if (String(payload.path) !== String(currentPath)) return;
      if (!window.monaco) return;

      lastGitBaselines = payload;

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
        disposeGitBaselines();
        ensurePlainEditorWithPrefs();
        return;
      }

      var lang = languageFromPath(currentPath);

      if (!gitHeadModel) {
        gitHeadModel = monaco.editor.createModel(head || '', lang);
      } else {
        try { gitHeadModel.setValue(head || ''); } catch (_) {}
        try { monaco.editor.setModelLanguage(gitHeadModel, lang); } catch (_) {}
      }

      if (!gitDiskModel) {
        gitDiskModel = monaco.editor.createModel(disk || '', lang);
      } else {
        try { gitDiskModel.setValue(disk || ''); } catch (_) {}
        try { monaco.editor.setModelLanguage(gitDiskModel, lang); } catch (_) {}
      }

      ensureDiffEditorWithPrefs();

      try {
        diffEditor.setModel({
          original: gitHeadModel,
          modified: model,
          modifiedBaseline: gitDiskModel,
          te2FreezeProjection: true,
        });
      } catch (e) {
        console.warn('[Monaco] diffEditor.setModel failed', e);
        disposeGitBaselines();
        ensurePlainEditorWithPrefs();
        return;
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
    if (diffEditor) {
      disposeDiffEditorOnly();
      editor = null;
    }
    if (editor) return editor;
    var el = getEditorContainer();
    if (!el || !window.monaco) return null;

    editor = monaco.editor.create(el, buildMonacoOptionsFromPrefs(cachedPrefs));
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
    }
    ensureTouchSelection('plain');
    ensureLayoutObserver();
    _layoutEditors();
    return editor;
  }

  function ensureDiffEditorWithPrefs() {
    if (diffEditor) return diffEditor;

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
    }
    ensureTouchSelection('diff');
    ensureLayoutObserver();
    _layoutEditors();
    return diffEditor;
  }

  function installMirrorPublisher() {
    if (!editor) return;
    try {
      editor.onDidChangeModelContent(function() {
        if (isApplyingRemote) return;
        if (!editorSocket || !editorSocket.connected) return;
        if (!currentPath || !model) return;
        if (mirrorDebounceT) clearTimeout(mirrorDebounceT);
        mirrorDebounceT = setTimeout(function() {
          try {
            var content = model.getValue();
            editorSocket.emit('editor_mirror', {
              path: currentPath,
              content: content,
              base_sha256: baseSha256,
            });
          } catch (_) {}
          requestDraftDiff('local');
        }, 120);
      });
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
        window['monaco-touch-selection'].editorTouchSelectionHelp(editor);
        updateDebug('touch=reinit' + (reason ? ':' + reason : ''));
      }
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
        model = monaco.editor.createModel(content, lang);
        editor.setModel(model);
      } catch (e) {
        console.warn('[Monaco] createModel failed, falling back to setValue', e);
        editor.setValue(content);
      }
    } else {
      try { model.setValue(content); } catch (_) { editor.setValue(content); }
      try { monaco.editor.setModelLanguage(model, lang); } catch (_) {}
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
      model = monaco.editor.createModel(content || '', lang);
      editor.setModel(model);
      installMirrorPublisher();
    } else {
      try { isApplyingRemote = true; model.setValue(content || ''); } catch (_) { editor.setValue(content || ''); } finally { isApplyingRemote = false; }
      try { monaco.editor.setModelLanguage(model, lang); } catch (_) {}
    }
    currentPath = absPath;
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

    ensureTouchSelection('open-post');
    setTimeout(function(){ ensureTouchSelection('open-tick'); }, 0);
    updateDebug('open=ok');
  }

  async function restoreFromSSOT() {
    try {
      var state = await fetchSSOTState();
      cachedPrefs = state;
      if (!state) return;
      var target = state.currentPath || state.lastFile || null;
      if (!target) return;
      await openPathFromBackend(target, languageFromPath(target));
    } catch (e) {
      console.warn('[Monaco] restoreFromSSOT failed', e);
    }
  }

  function applyOpenPayload(payload) {
    try {
      if (!payload) return;
      cachedPrefs = { preferences: payload.preferences || (cachedPrefs && cachedPrefs.preferences) || {} };
      baseSha256 = payload.base_sha256 || payload.baseSha256 || baseSha256;
      openPathFromBackend(payload.path, payload.language || languageFromPath(payload.path));
    } catch (e) {
      console.warn('[Monaco] applyOpenPayload failed', e);
    }
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
      });

      editorSocket.on('editor:ssot', function(snapshot) {
        try {
          cachedPrefs = snapshot;
          if (snapshot && snapshot.file) {
            var f = snapshot.file;
            // Apply directly from SSOT payload (draft wins).
            baseSha256 = f.base_sha256 || baseSha256;
            currentPath = f.path || currentPath;
            ensureEditorWithPrefs().then(function() {
              var lang = languageFromPath(currentPath);
              if (!model) {
                model = monaco.editor.createModel(f.content || '', lang);
                editor.setModel(model);
                installMirrorPublisher();
              } else {
                isApplyingRemote = true;
                try { model.setValue(f.content || ''); } finally { isApplyingRemote = false; }
                try { monaco.editor.setModelLanguage(model, lang); } catch (_) {}
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
              if (f.has_draft) {
                emitToHost('editor_draft_state', { has_draft: true, path: currentPath });
                requestDraftDiff('ssot');
              } else {
                clearDraftDiffDecorations();
              }
              updateDebug('ws=ssot');
              requestGitBaselines();
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
          // Always follow SSOT open across clients.
          baseSha256 = payload.base_sha256 || baseSha256;
          currentPath = payload.path;
          ensureEditorWithPrefs().then(function() {
            var lang = languageFromPath(currentPath);
            if (!model) {
              model = monaco.editor.createModel(payload.content || '', lang);
              editor.setModel(model);
              installMirrorPublisher();
            } else {
              isApplyingRemote = true;
              try { model.setValue(payload.content || ''); } finally { isApplyingRemote = false; }
              try { monaco.editor.setModelLanguage(model, lang); } catch (_) {}
            }
            applyLineNumberSizing();
            ensureTouchSelection('open');
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
          });
          requestGitBaselines();
        } catch (e) {
          console.warn('[Monaco] open apply failed', e);
        }
      });

      editorSocket.on('editor:jump_to_line', function(payload) {
        try { applyJumpToLine(payload); } catch (e) { console.warn('[Monaco] jump_to_line failed', e); }
      });

      editorSocket.on('editor:mirror', function(payload) {
        try {
          if (!payload || !payload.path || !payload.content) return;
          if (payload.source_client && editorSocketId && String(payload.source_client) === String(editorSocketId)) return;
          if (currentPath && String(payload.path) !== String(currentPath)) return;
          if (!model) return;
          isApplyingRemote = true;
          try { model.setValue(payload.content); } finally { isApplyingRemote = false; }
          try { lastContentSha256 = payload.content_sha256 || lastContentSha256; } catch (_) {}
          applyLineNumberSizing();
          emitToHost('editor_cache_state', {
            path: payload.path,
            state: 'mid_session',
            unsaved: true,
            reason: 'mirror',
            content_sha256: payload.content_sha256,
          });
          emitToHost('editor_draft_state', { has_draft: true, path: payload.path });
          // Do not refresh Git baselines on draft mirror; Git baselines must stay pinned.
          requestDraftDiff('mirror');
        } catch (e) {
          console.warn('[Monaco] mirror apply failed', e);
        }
      });

      editorSocket.on('editor:prefs_changed', function(payload) {
        try {
          var nextPrefs = payload && payload.preferences ? payload.preferences : null;
          if (!nextPrefs) return;

          if (!cachedPrefs) cachedPrefs = {};
          cachedPrefs.preferences = nextPrefs;

          if (!editor) return;
          var opts = buildMonacoOptionsFromPrefs({ preferences: nextPrefs });
          var theme = null;
          try { theme = opts && opts.theme ? opts.theme : null; } catch (_) { theme = null; }
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
          requestGitBaselines();
          if (getShowDraftDiffs()) requestDraftDiff('prefs');
          else clearDraftDiffDecorations();
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
            // After a save (drafts cleared), refresh Git baselines so inline git diffs update
            // and the editor can switch back into diff mode when applicable.
            try { requestGitBaselines(); } catch (_) {}
            return;
          }
          if (payload.unsaved === true) {
            requestDraftDiff('cache_state');
          }
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

      return true;
    } catch (e) {
      console.warn('[Monaco] socket connect failed', e);
      return false;
    }
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

  function applyMirror(data) {
    if (!data) return;
    ensureEditor();
    ensureTouchSelection('mirror-pre');
    if (!editor) return;

    var nextPath = (typeof data.path === 'string' && data.path) ? data.path : null;
    if (currentPath && nextPath && String(nextPath) !== String(currentPath)) return;

    var content = (typeof data.content === 'string') ? data.content : '';
    try {
      if (model && model.setValue) model.setValue(content);
      else editor.setValue(content);
    } catch (_) {}

    ensureTouchSelection('mirror-post');
    setTimeout(function(){ ensureTouchSelection('mirror-tick'); }, 0);
  }

  // No host↔iframe postMessage bridge: all runtime communication uses /editor Socket.IO.

  async function bootMonaco() {
    try {
      // Load the pinned VS Code monaco-editor-core ESM build (served by the worker).
      // NOTE: This is the only supported Monaco source for TE2 right now.
      var base = (apiBase || '') + '/ui/monaco_vscode/esm';
      var langBase = (apiBase || '') + '/ui/monaco_vscode/lang';

      // Register TE2 themes before the editor is created.
      ensureTe2Themes();
      ensureTe2DiffTheme();

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

      var monacoNs = await import(base + '/vs/editor/editor.main.js');
      window.monaco = monacoNs;
      try { applyMonacoTheme('vs-dark'); } catch (_) {}

      // Register tokenizers + language services (typescript/css/html/json) from TE2 language bundles.
      // These modules import from "monaco-editor-core" which is mapped via <script type="importmap">.
      try {
        await import(langBase + '/basic-languages/monaco.contribution.js');
        await import(langBase + '/language/typescript/monaco.contribution.js');
        await import(langBase + '/language/json/monaco.contribution.js');
        await import(langBase + '/language/css/monaco.contribution.js');
        await import(langBase + '/language/html/monaco.contribution.js');
      } catch (e) {
        console.warn('[Monaco] Failed to load language bundles', e);
        try {
          var bust = '?ts=' + Date.now();
          await import(langBase + '/basic-languages/monaco.contribution.js' + bust);
          await import(langBase + '/language/typescript/monaco.contribution.js' + bust);
          await import(langBase + '/language/json/monaco.contribution.js' + bust);
          await import(langBase + '/language/css/monaco.contribution.js' + bust);
          await import(langBase + '/language/html/monaco.contribution.js' + bust);
        } catch (e2) {
          console.warn('[Monaco] Forced language bundle load failed', e2);
        }
      }

      // Initialize editor strictly from SSOT.
      await ensureEditorWithPrefs();
      if (pending) applyContent(pending);

      try {
        if (window.monaco && model && currentPath) {
          monaco.editor.setModelLanguage(model, languageFromPath(currentPath));
        }
        var langs = (window.monaco && monaco.languages && monaco.languages.getLanguages)
          ? monaco.languages.getLanguages().map(function(l){ return l && l.id; }).filter(Boolean)
          : [];
        if (langs.length <= 1 && langs[0] === 'plaintext') {
          console.warn('[Monaco] language registry still plaintext-only');
        }
      } catch (_) {}

      // Prefer dedicated editor Socket.IO transport; fall back to SSOT HTTP.
      if (!connectEditorSocket()) {
        restoreFromSSOT();
      }

      emitToHost('editor_ready', {});
      updateDebug('boot=ok');
    } catch (e) {
      console.error('[Monaco] boot failed', e);
      updateDebug('boot=fail');
    }
  }

  updateDebug('boot=init');
  bootMonaco();
})();
