                (function() {
                  var editor = null;
                  var model = null;
                  var pending = null;
                  var currentPath = null;
                  var dbg = null;
                  var cachedPrefs = null;
                  var editorSocket = null;
                  var editorSocketId = null;
                  var baseSha256 = null;
                  var isApplyingRemote = false;
                  var mirrorDebounceT = null;
                  var apiBase = (function() {
                    try {
                      var p = String(window.location && window.location.pathname ? window.location.pathname : '');
                      var idx = p.indexOf('/ui/');
                      return idx >= 0 ? p.slice(0, idx) : '';
                    } catch (_) { return ''; }
                  })();

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
                    var el = document.getElementById('fh-monaco');
                    if (!el || !window.monaco || !window.require) return;
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

                  function buildMonacoOptionsFromPrefs(state) {
                    // NOTE: "No base editor state" means: no ad-hoc defaults in the host.
                    // We still need hard fallbacks if SSOT is missing values, but the goal is
                    // that PreferencesStore always provides a complete snapshot.
                    var prefs = null;
                    try { prefs = state && state.preferences ? state.preferences : state; } catch (_) {}
                    var editorPrefs = null;
                    try { editorPrefs = prefs && prefs.editor ? prefs.editor : (prefs && prefs.preferences && prefs.preferences.editor ? prefs.preferences.editor : null); } catch (_) {}

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

                    // Theme mapping: CM6 themes are not Monaco themes; map to a stable Monaco theme.
                    var theme = 'vs-dark';
                    try {
                      var t = String(editorPrefs.theme || '').toLowerCase();
                      if (t.includes('light')) theme = 'vs';
                    } catch (_) {}

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
                      quickSuggestions: !!autocompletion,
                      fontSize: fontSize,
                    };
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

                  function postToHost(type, data) {
                    try { window.parent?.postMessage({ type: type, data: data || {} }, '*'); } catch (_) {}
                  }

                  async function fetchSSOTState() {
                    // Single call site so we can instrument/adjust behavior later.
                    return await fetchJson('/state', { cache: 'no-store' });
                  }

                  async function ensureEditorWithPrefs() {
                    if (editor) return editor;
                    var el = document.getElementById('fh-monaco');
                    if (!el || !window.monaco || !window.require) return null;

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
                    return editor;
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
                      if (extra) msg += ' ' + extra;
                      dbg.textContent = msg;
                    } catch (_) {}
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
                    ensureTouchSelection('post');
                    setTimeout(function(){ ensureTouchSelection('tick'); }, 0);
                    try {
                      window.parent?.postMessage({ type: 'cm6_set_content_ack', data: { path: data.path || null } }, '*');
                    } catch (_) {}
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
                    postToHost('cm6-cache-state', {
                      path: absPath,
                      state: hasDraft ? 'mid_session' : 'clean',
                      unsaved: hasDraft,
                      reason: hasDraft ? 'restore' : 'set_content',
                      content_sha256: sha256,
                      auto_save: autoSave,
                    });
                    if (hasDraft) {
                      postToHost('draft_state', { has_draft: true, path: absPath });
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
                              postToHost('cm6-cache-state', {
                                path: currentPath,
                                state: f.state,
                                unsaved: !!f.unsaved,
                                reason: f.reason,
                                content_sha256: f.content_sha256,
                                auto_save: f.auto_save,
                              });
                              if (f.has_draft) postToHost('draft_state', { has_draft: true, path: currentPath });
                              updateDebug('ws=ssot');
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
                            ensureTouchSelection('open');
                            postToHost('cm6-cache-state', {
                              path: currentPath,
                              state: payload.state || 'clean',
                              unsaved: !!payload.unsaved,
                              reason: payload.reason || 'open',
                              content_sha256: payload.content_sha256,
                              auto_save: payload.auto_save,
                            });
                          });
                        } catch (e) {
                          console.warn('[Monaco] open apply failed', e);
                        }
                      });

                      editorSocket.on('editor:mirror', function(payload) {
                        try {
                          if (!payload || !payload.path || !payload.content) return;
                          if (payload.source_client && editorSocketId && String(payload.source_client) === String(editorSocketId)) return;
                          if (currentPath && String(payload.path) !== String(currentPath)) return;
                          if (!model) return;
                          isApplyingRemote = true;
                          try { model.setValue(payload.content); } finally { isApplyingRemote = false; }
                          postToHost('cm6-cache-state', {
                            path: payload.path,
                            state: 'mid_session',
                            unsaved: true,
                            reason: 'mirror',
                            content_sha256: payload.content_sha256,
                          });
                          postToHost('draft_state', { has_draft: true, path: payload.path });
                        } catch (e) {
                          console.warn('[Monaco] mirror apply failed', e);
                        }
                      });

                      return true;
                    } catch (e) {
                      console.warn('[Monaco] socket connect failed', e);
                      return false;
                    }
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

                  window.addEventListener('message', function(ev) {
                    var msg = ev && ev.data ? ev.data : null;
                    if (!msg || typeof msg !== 'object') return;
                    if (msg.type === 'cm6_set_content') {
                      var data = msg && msg.data ? msg.data : null;
                      // Legacy path: host provided full content payload. Keep for backwards compat.
                      pending = data || pending;
                      applyContent(pending);
                    } else if (msg.type === 'cm6_mirror') {
                      var data2 = msg && msg.data ? msg.data : null;
                      applyMirror(data2);
                    } else if (msg.type === 'cm6_open_path') {
                      var data3 = msg && msg.data ? msg.data : null;
                      var p = data3 && typeof data3.path === 'string' ? data3.path : null;
                      var l = data3 ? data3.language : null;
                      if (p) {
                        if (editorSocket && editorSocket.connected) {
                          editorSocket.emit('editor_open_request', { path: p });
                        } else {
                          openPathFromBackend(p, l);
                        }
                      }
                    }
                  });

                  function bootMonaco() {
                    if (!window.require) return;
                    window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' } });
                    window.require(['vs/editor/editor.main'], function() {
                      try {
                        // Initialize editor strictly from SSOT.
                        ensureEditorWithPrefs().then(function() {
                          if (pending) applyContent(pending);
                          // Prefer dedicated editor Socket.IO transport; fall back to SSOT HTTP.
                          if (!connectEditorSocket()) {
                            restoreFromSSOT();
                          }
                          postToHost('cm6_ready', {});
                          updateDebug('boot=ok');
                        }).catch(function(e) {
                          console.error('[Monaco] SSOT boot failed', e);
                          updateDebug('boot=fail');
                        });
                        // Restore current file/prefs from backend SSOT (HistoryStore/PreferencesStore).
                      } catch (e) {
                        console.error('[Monaco] boot failed', e);
                        updateDebug('boot=fail');
                      }
                    });
                  }

                  updateDebug('boot=init');
                  bootMonaco();
                })();
                