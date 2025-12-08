import * as CM from "nicegui-codemirror";

// Forward console to parent window (for debug logging)
if (window.parent && window.parent !== window) {
  const _origLog = console.log.bind(console);
  console.log = (...args) => { _origLog(...args); try { window.parent.console.log(...args); } catch { } };
}

// Socket.IO transport adapter for @codemirror/lsp-client
// NOTE: CodeMirror runs in a NiceGUI iframe, but socket.io is loaded in the parent window.
// We access `io` from the parent to bridge the iframe barrier.
const _io = (window.parent && typeof window.parent.io === 'function') ? window.parent.io : (typeof io === 'function' ? io : null);

class SocketIOTransport {
  constructor(namespace, languageId, projectRoot) {
    this.socket = null;
    this.onMessage = null;

    try {
      if (!_io) {
        console.warn('[LSP] socket.io client (io) is not available in this context or parent window');
        return;
      }

      this.socket = _io(namespace, {
        path: "/ui/_nicegui_ws/socket.io",
        transports: ["websocket", "polling"],
      });

      this.socket.on('connect', () => {
        try {
          console.log('[LSP] Socket.IO connected, sending initialize...');
          this.socket.emit('initialize', {
            languageId: languageId,
            projectRoot: projectRoot,
          });
        } catch (err) {
          console.warn('[LSP] Failed to send initialize event:', err);
        }
      });

      // NOTE: Don't register lsp:server_to_client handler here.
      // The cmTransport adapter will register its own handler that properly converts
      // Socket.IO objects to JSON strings for @codemirror/lsp-client.
    } catch (err) {
      console.warn('[LSP] Failed to initialize SocketIOTransport:', err);
      this.socket = null;
    }
  }

  send(data) {
    if (!this.socket) return;
    try {
      this.socket.emit('lsp:client_to_server', data);
    } catch (err) {
      console.warn('[LSP] Failed to send client_to_server payload:', err);
    }
  }

  close() {
    try {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
    } catch (err) {
      console.warn('[LSP] Error while closing SocketIOTransport:', err);
    }
  }
}

const searchExtension = typeof CM.search === 'function' ? CM.search : null;
const searchKeymap = Array.isArray(CM.searchKeymap) ? CM.searchKeymap : null;
const highlightSelectionMatches = typeof CM.highlightSelectionMatches === 'function' ? CM.highlightSelectionMatches : null;
const openSearchPanel = typeof CM.openSearchPanel === 'function' ? CM.openSearchPanel : null;
const indentationMarkers = typeof CM.indentationMarkers === 'function' ? CM.indentationMarkers : null;
// Color picker extension is exported as colorView() function and colorTheme
const colorExtension = (typeof CM.colorView === 'function' && CM.colorTheme) ? [CM.colorView(), CM.colorTheme] : null;
const showMinimap = CM.showMinimap;

const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 2.0;

const clampFontScale = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, parsed));
};

const buildFontScaleTheme = (scale) => {
  return CM.EditorView.theme({
    "&": {
      fontSize: `${scale * 100}%`,
      lineHeight: "1.45",
    },
    "& .cm-content, & .cm-line": {
      fontSize: "inherit",
      lineHeight: "inherit",
    },
  });
};

// Language-specific indent unit mapping
const LANGUAGE_INDENT_MAP = {
  // 2-space languages
  'javascript': 2,
  'typescript': 2,
  'jsx': 2,
  'tsx': 2,
  'html': 2,
  'css': 2,
  'json': 2,
  'yaml': 2,
  'xml': 2,
  'vue': 2,
  'svelte': 2,

  // 4-space languages
  'python': 4,
  'java': 4,
  'c': 4,
  'cpp': 4,
  'c++': 4,
  'csharp': 4,
  'c#': 4,
  'php': 4,
  'ruby': 4,
  'go': 4,
  'rust': 4,
  'shell': 4,
  'bash': 4,
  'sh': 4,
  'markdown': 4,
  'md': 4,
};

function getIndentForLanguage(language) {
  if (!language) return 4;  // Default to 4 spaces
  const normalized = language.toLowerCase().trim();
  return LANGUAGE_INDENT_MAP[normalized] || 4;  // Default to 4 if unknown
}

const EMPTY_GUTTER_RANGESET = (() => {
  const builder = new CM.RangeSetBuilder();
  return builder.finish();
})();

// Deletion widget class (moved to outer scope for facet access)
class RemovedLineWidget extends CM.WidgetType {
  constructor(text, wordWrap, originalLine, isDraft = false) {
    super();
    this.text = text;
    this.wordWrap = wordWrap;
    this.originalLine = originalLine;
    this.isDraft = isDraft;
  }
  toDOM() {
    const lineEl = document.createElement('div');
    lineEl.className = 'cm-diff-line cm-diff-line-removed';
    if (this.isDraft) {
      lineEl.classList.add('cm-diff-line-removed-draft');
    }
    if (this.wordWrap) {
      lineEl.classList.add('cm-diff-wrap');
    }

    const content = document.createElement('span');
    content.className = 'cm-diff-removed-text';
    content.textContent = this.text ?? '';

    lineEl.append(content);
    return lineEl;
  }
  ignoreEvent() { return true; }
}

// Deleted line number marker for the standard line-number gutter
class DeletedLineNumberMarker extends CM.GutterMarker {
  constructor(num, isDraft = false) {
    super();
    this.num = num;
    this.isDraft = !!isDraft;
    // Apply classes to the gutter element itself
    this.elementClass = isDraft
      ? 'cm-diff-deleted-lineno cm-diff-deleted-lineno-draft'
      : 'cm-diff-deleted-lineno';
  }
  eq(other) { return other instanceof DeletedLineNumberMarker && other.num === this.num && other.isDraft === this.isDraft; }
  toDOM() {
    const span = document.createElement('span');
    span.textContent = this.num;
    return span;
  }
}

// Marker for the fold gutter on deletion lines (empty but styled)
class DeletedFoldMarker extends CM.GutterMarker {
  constructor() {
    super();
    this.elementClass = 'cm-diff-deleted-lineno';
  }
  eq(other) { return other instanceof DeletedFoldMarker; }
  toDOM() {
    return document.createElement('div');
  }
}

// Marker to add class to added lines (for gutterLineClass)
class AddedLineClassMarker extends CM.GutterMarker {
  constructor() {
    super();
    this.elementClass = 'cm-diff-added-lineno';
  }
  eq(other) { return other instanceof AddedLineClassMarker; }
}
const addedLineClassMarker = new AddedLineClassMarker();

class AddedDraftLineClassMarker extends CM.GutterMarker {
  constructor() {
    super();
    this.elementClass = 'cm-diff-added-lineno-draft';
  }
  eq(other) { return other instanceof AddedDraftLineClassMarker; }
}
const addedDraftLineClassMarker = new AddedDraftLineClassMarker();

// Inline diff decorations helper (extracted from diff_decorations.js)
function buildDiffDecorations(view, hunks, CM, getWordWrap) {
  const { Decoration, RangeSetBuilder } = CM;

  if (!hunks || hunks.length === 0) {
    return { decorations: Decoration.none, gutter: EMPTY_GUTTER_RANGESET, gutterClasses: EMPTY_GUTTER_RANGESET };
  }

  const lineAddedDeco = Decoration.line({
    class: 'cm-diff-line-added',
    diffKind: 'insert',
  });

  const lineAddedDraftDeco = Decoration.line({
    class: 'cm-diff-line-added-draft',
    diffKind: 'insert-draft',
  });

  const lineContextDeco = Decoration.line({
    class: 'cm-diff-line-context',
  });

  const wordWrap = getWordWrap();
  const builder = new RangeSetBuilder();
  const gutterBuilder = new RangeSetBuilder();
  const gutterClassBuilder = new RangeSetBuilder();
  let gutterCount = 0;
  let classCount = 0;
  const doc = view.state.doc;

  const lineDecorations = new Map();
  const deletionWidgets = [];

  for (const hunk of hunks) {
    let newLine = Math.max(1, hunk.newStart || 1);
    let oldLine = Math.max(1, hunk.oldStart || 1);

    for (const line of hunk.lines || []) {
      const kind = line.type;
      if (kind === 'add') {
        lineDecorations.set(newLine, { decoration: lineAddedDeco, markerKind: '+', isAdd: true });
        newLine += 1;
      } else if (kind === 'add-draft') {
        lineDecorations.set(newLine, { decoration: lineAddedDraftDeco, markerKind: '+', isAddDraft: true });
        newLine += 1;
      } else if (kind === 'context') {
        lineDecorations.set(newLine, { decoration: lineContextDeco, markerKind: '│' });
        newLine += 1;
        oldLine += 1;
      } else if (kind === 'del' || kind === 'del-draft') {
        deletionWidgets.push({
          line: newLine > 0 ? newLine : 1,
          text: line.text || '',
          originalLine: oldLine,
          isDraft: (kind === 'del-draft')
        });
        oldLine += 1;
      }
    }
  }

  deletionWidgets.sort((a, b) => a.line - b.line);

  let widgetIndex = 0;
  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const lineInfo = safeLine(doc, lineNum);
    if (!lineInfo) continue;

    // Widgets before the line
    while (widgetIndex < deletionWidgets.length && deletionWidgets[widgetIndex].line < lineNum) {
      const widget = deletionWidgets[widgetIndex];
      const anchorLine = safeLine(doc, widget.line);
      const pos = anchorLine ? anchorLine.from : doc.length;
      builder.add(pos, pos, Decoration.widget({
        side: -1,
        block: true,
        widget: new RemovedLineWidget(widget.text, wordWrap, widget.originalLine, widget.isDraft),
        diffKind: widget.isDraft ? 'delete-draft' : 'delete',
      }));
      widgetIndex++;
    }

    // Widgets AT the line
    while (widgetIndex < deletionWidgets.length && deletionWidgets[widgetIndex].line === lineNum) {
      const widget = deletionWidgets[widgetIndex];
      builder.add(lineInfo.from, lineInfo.from, Decoration.widget({
        side: -1,
        block: true,
        widget: new RemovedLineWidget(widget.text, wordWrap, widget.originalLine, widget.isDraft),
        diffKind: 'delete',
      }));
      widgetIndex++;
    }

    const entry = lineDecorations.get(lineNum);
    if (entry) {
      builder.add(lineInfo.from, lineInfo.from, entry.decoration);
      if (entry.markerKind) {
        gutterBuilder.add(lineInfo.from, lineInfo.from, new DiffGutterMarker(entry.markerKind));
        gutterCount++;
      }
      if (entry.isAdd) {
        gutterClassBuilder.add(lineInfo.from, lineInfo.from, addedLineClassMarker);
        classCount++;
      } else if (entry.isAddDraft) {
        gutterClassBuilder.add(lineInfo.from, lineInfo.from, addedDraftLineClassMarker);
        classCount++;
      }
    }
  }

  // Remaining widgets
  while (widgetIndex < deletionWidgets.length) {
    const widget = deletionWidgets[widgetIndex];
    const anchorLine = safeLine(doc, widget.line);
    const pos = anchorLine ? anchorLine.from : doc.length;
    builder.add(pos, pos, Decoration.widget({
      side: -1,
      block: true,
      widget: new RemovedLineWidget(widget.text, wordWrap, widget.originalLine, widget.isDraft),
      diffKind: widget.isDraft ? 'delete-draft' : 'delete',
    }));
    widgetIndex++;
  }

  const decorations = builder.finish();
  const gutter = gutterCount ? gutterBuilder.finish() : EMPTY_GUTTER_RANGESET;
  const gutterClasses = classCount ? gutterClassBuilder.finish() : EMPTY_GUTTER_RANGESET;
  return { decorations, gutter, gutterClasses };
}

// Helper to scan diff decorations and build minimap gutters
function diffMinimapGuttersFromDecorations(state, diffField) {
  if (!diffField) return [];

  // Get current decoration set from the state field
  const decos = state.field(diffField, false);
  if (!decos) return [];

  const colorBuckets = new Map();
  const ensureBucket = (color) => {
    if (!colorBuckets.has(color)) {
      colorBuckets.set(color, {});
    }
    return colorBuckets.get(color);
  };

  const colorForKind = (kind) => {
    switch (kind) {
      case 'insert':
        return '#34d399'; // git added
      case 'delete':
        return '#f87171'; // git deleted
      case 'insert-draft':
        return '#60a5fa'; // draft added (blue)
      case 'delete-draft':
        return '#facc15'; // draft deleted (yellow)
      default:
        return null;
    }
  };

  decos.between(0, state.doc.length, (from, to, deco) => {
    const kind = deco.spec?.diffKind;
    const bucketColor = colorForKind(kind);
    if (!bucketColor) return;

    // Map this decoration/widget to line numbers in the *current* doc
    const lineFrom = state.doc.lineAt(from).number;
    const lineTo = state.doc.lineAt(to).number;
    const bucket = ensureBucket(bucketColor);

    for (let line = lineFrom; line <= lineTo; line++) {
      bucket[line] = bucketColor;
    }
  });

  return Array.from(colorBuckets.values());
}

function safeLine(doc, lineNumber) {
  if (!doc) return null;
  const total = doc.lines;
  if (total <= 0) return null;
  if (lineNumber < 1) lineNumber = 1;
  if (lineNumber > total) {
    return doc.line(total);
  }
  return doc.line(lineNumber);
}

// Deletion widget gutter marker (Chad's solution)
class MinusGutterMarker extends CM.GutterMarker {
  constructor() {
    super();
    this.elementClass = 'cm-diff-deleted-lineno';
  }
  toDOM() {
    const span = document.createElement('span');
    span.textContent = '−';
    span.className = 'cm-diff-minus-marker';
    return span;
  }
  eq(other) {
    return other instanceof MinusGutterMarker;
  }
}

const minusMarker = new MinusGutterMarker();

// Deletion widget gutter marker for drafts
class MinusDraftGutterMarker extends CM.GutterMarker {
  constructor() {
    super();
    this.elementClass = 'cm-diff-deleted-lineno-draft';
  }
  toDOM() {
    const span = document.createElement('span');
    span.textContent = '−';
    span.className = 'cm-diff-minus-marker-draft';
    return span;
  }
  eq(other) {
    return other instanceof MinusDraftGutterMarker;
  }
}
const minusDraftMarker = new MinusDraftGutterMarker();

class DiffGutterMarker extends CM.GutterMarker {
  constructor(marker) {
    super();
    this.marker = marker;
  }
  eq(other) {
    return other instanceof DiffGutterMarker && other.marker === this.marker;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-diff-gutter-marker';
    span.textContent = this.marker;
    if (this.marker === '+') {
      span.classList.add('cm-diff-marker-add');
    } else if (this.marker === '−') {
      span.classList.add('cm-diff-marker-del');
    } else if (this.marker === '│') {
      span.classList.add('cm-diff-marker-context');
    }
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}


export default {
  template: `
    <div></div>
  `,
  props: {
    value: String,
    language: String,
    theme: { type: String, required: true },
    fontScale: { type: Number, default: 1 },
    lineWrapping: Boolean,
    disable: Boolean,
    indent: String,
    highlightWhitespace: Boolean,
    showMinimap: Boolean,
    // Optional 1-based line number for initial scroll anchoring (backend-driven)
    initialScrollLine: { type: Number, default: null },
  },
  watch: {
    language(newLanguage) {
      this.setLanguage(newLanguage);
    },
    theme(newTheme) {
      this.setTheme(newTheme);
    },
    disable(newDisable) {
      this.setDisabled(newDisable);
    },
    lineWrapping(newLineWrapping) {
      this.setLineWrapping(newLineWrapping);
    },
    showMinimap(newVal) {
      this.updateMinimapState();
    },
  },
  data() {
    return {
      // To let other methods wait for the editor to be created because
      // they might be called by the server before the editor is created.
      editorPromise: new Promise((resolve) => {
        this.resolveEditor = resolve;
      }),
      pendingFontScale: clampFontScale(this.fontScale),
      colorPickerCompartment: null, // Color picker toggle compartment
      readOnlyCompartment: null,     // Read-only mode compartment
      stickyScrollCompartment: null, // Sticky scroll toggle compartment - Added: 2025-12-03 by vectorArc - TE2 Team
      // LSP client state
      lspClient: null,
      lspTransport: null,
      lspCompartment: null,
      // Latest LSP document symbols (used primarily by Sticky Scroll; host may also observe)
      lspSymbols: [],
      // Sticky scroll plugin instance handle (set by plugin constructor when enabled)
      _stickyScrollPlugin: null,
      isMobileLayout: false,
    };
  },
  beforeDestroy() {
    // Best-effort LSP cleanup for Vue 2 lifecycle
    try {
      if (typeof this.disconnectLSP === 'function') {
        this.disconnectLSP();
      }
    } catch (err) {
      console.warn('[LSP] Error during beforeDestroy disconnect:', err);
    }
  },
  beforeUnmount() {
    // Best-effort LSP cleanup for Vue 3 lifecycle
    try {
      if (typeof this.disconnectLSP === 'function') {
        this.disconnectLSP();
      }
    } catch (err) {
      console.warn('[LSP] Error during beforeUnmount disconnect:', err);
    }
  },
  methods: {
    updateMinimapState() {
      if (!this.showMinimap) {
        this.applyMinimapMode('off');
        return;
      }
      const mode = this.isMobileLayout ? 'mobile' : 'desktop';
      this.applyMinimapMode(mode);
    },
    handleLayoutChange(e) {
      this.isMobileLayout = e.matches;
      if (this.showMinimap) {
        this.updateMinimapState();
      }
    },
    openSearchPanelFromServer() {
      if (!this.editor || typeof openSearchPanel !== 'function') return;
      try {
        openSearchPanel(this.editor);
      } catch (err) {
        console.warn('[CodeMirror] Failed to open search panel:', err);
      }
    },
    request_content() {
      if (!this.editor) return "";
      return this.editor.state.doc.toString();
    },
    // Find the language's extension by its name. Case insensitive.
    findLanguage(name) {
      for (const language of this.languages)
        for (const alias of [language.name, ...language.alias])
          if (name.toLowerCase() === alias.toLowerCase()) return language;

      console.error(`Language not found: ${name}`);
      console.info("Supported language names:", this.languages.map((lang) => lang.name).join(", "));
      return null;
    },
    // Get the names of all supported languages
    async getLanguages() {
      if (!this.editor) await this.editorPromise;
      // Over 100 supported languages: https://github.com/codemirror/language-data/blob/main/src/language-data.ts
      return this.languages.map((lang) => lang.name).sort(Intl.Collator("en").compare);
    },
    setLanguage(language) {
      if (!language) {
        // Default to 4 spaces when no language
        this.editor.dispatch({
          effects: [
            this.languageConfig.reconfigure([]),
            this.indentUnitCompartment.reconfigure(CM.indentUnit.of('    '))
          ]
        });
        return;
      }

      const lang_description = this.findLanguage(language, this.languages);
      if (!lang_description) {
        console.error("Language not found:", language);
        return;
      }

      lang_description.load().then((extension) => {
        // Determine appropriate indent size for this language
        const indentSize = getIndentForLanguage(language);
        const indentString = ' '.repeat(indentSize);

        // Reconfigure both language and indent unit together
        this.editor.dispatch({
          effects: [
            this.languageConfig.reconfigure([extension]),
            this.indentUnitCompartment.reconfigure(CM.indentUnit.of(indentString))
          ]
        });
      });
    },
    async getThemes() {
      if (!this.editor) await this.editorPromise;
      // `this.themes` also contains some non-theme objects
      // The real themes are Arrays
      return Object.keys(this.themes)
        .filter((key) => Array.isArray(this.themes[key]))
        .sort(Intl.Collator("en").compare);
    },
    resolveThemeExtension(themeName) {
      if (!themeName) {
        throw new Error('[CodeMirror] No theme name provided by backend preferences');
      }
      if (!this.themes || typeof this.themes !== 'object') {
        throw new Error('[CodeMirror] Theme bundle not available; cannot resolve theme');
      }
      const extension = this.themes[themeName];
      if (!extension) {
        throw new Error(`[CodeMirror] Theme not found: ${themeName}`);
      }
      return extension;
    },
    setTheme(theme) {
      const new_theme = this.resolveThemeExtension(theme);
      this.editor.dispatch({
        effects: this.themeConfig.reconfigure([new_theme]),
        annotations: [CM.Transaction.userEvent.of('setTheme')],
      });
    },
    setEditorValueFromProps() {
      this.setEditorValue(this.value);
    },
    setEditorValue(value) {
      if (!this.editor) return;
      if (this.editor.state.doc.toString() === value) return;

      this.emitting = false;
      this.editor.dispatch({ changes: { from: 0, to: this.editor.state.doc.length, insert: value } });
      this.emitting = true;
    },
    emitCacheState(payload) {
      try {
        const envelope = Object.assign({ type: 'cm6-cache-state' }, payload || {});
        const target = window.parent || window;
        target.postMessage(envelope, '*');
      } catch (err) {
        console.warn('[CodeMirror] Failed to emit cache state event', err);
      }
    },
    notifyParent(type, data) {
      try {
        const target = window.parent || window;
        target.postMessage({
          type: type,
          data: data
        }, '*');
      } catch (err) {
        console.warn('[CodeMirror] Failed to notify parent', err);
      }
    },
    // Establish LSP connection using Socket.IO transport and @codemirror/lsp-client
    // NOTE: Python run_method sends {languageId, projectRoot, filePath} as single dict argument
    connectLSP(options) {
      // Handle both dict and separate args for flexibility
      let languageId, projectRoot, filePath;
      if (typeof options === 'object' && options !== null) {
        languageId = options.languageId;
        projectRoot = options.projectRoot;
        filePath = options.filePath || '';
      } else {
        // Legacy: separate args (languageId, projectRoot)
        languageId = options;
        projectRoot = arguments[1];
        filePath = arguments[2] || '';
      }

      console.log(`[LSP] connectLSP called: languageId=${languageId}, projectRoot=${projectRoot}, filePath=${filePath}`);

      if (!this.editor) {
        console.warn('[LSP] connectLSP called before editor is ready');
        return;
      }

      const LSPClient = CM && CM.LSPClient ? CM.LSPClient : null;
      if (typeof LSPClient !== 'function') {
        console.warn('[CM6] LSP client not available in bundle (looked for CM.LSPClient)');
        return;
      }

      // Tear down any existing client first
      if (this.lspClient) {
        this.disconnectLSP();
      }

      const transport = new SocketIOTransport('/lsp', languageId, projectRoot);
      if (!transport || !transport.socket) {
        console.warn('[LSP] SocketIOTransport not initialized; aborting LSP connect');
        return;
      }

      this.lspTransport = transport;

      try {
        this.lspClient = new LSPClient({
          rootUri: 'file://' + projectRoot,
          workspaceFolders: [{ name: 'root', uri: 'file://' + projectRoot }],
        });
      } catch (err) {
        console.error('[LSP] Failed to create LanguageServerClient:', err);
        transport.close();
        this.lspTransport = null;
        this.lspClient = null;
        return;
      }

      // Create a Transport adapter that @codemirror/lsp-client expects
      // It needs: send(message: string), subscribe(handler), unsubscribe(handler)
      // NOTE: @codemirror/lsp-client expects JSON STRINGS, but Socket.IO auto-parses JSON.
      // So we need to: stringify server responses before passing to handler,
      // and parse outgoing messages if they're strings (Socket.IO will re-stringify).
      const cmTransport = {
        send: (message) => {
          if (transport.socket) {
            // message is a JSON string from lsp-client; parse it so Socket.IO can serialize it
            let payload = message;
            try {
              if (typeof message === 'string') {
                payload = JSON.parse(message);
              }
            } catch (e) {
              // If parsing fails, send as-is
            }
            transport.socket.emit('lsp:client_to_server', payload);
          }
        },
        subscribe: (handler) => {
          transport.onMessage = handler;
          if (transport.socket) {
            transport.socket.on('lsp:server_to_client', (data) => {
              if (handler) {
                // data is already an object from Socket.IO; stringify for lsp-client
                let msg = data;
                if (typeof data !== 'string') {
                  try {
                    msg = JSON.stringify(data);
                  } catch (e) {
                    console.warn('[LSP] Failed to stringify server message:', e);
                    return;
                  }
                }
                handler(msg);
              }
            });
          }
        },
        unsubscribe: (handler) => {
          transport.onMessage = null;
          if (transport.socket) {
            transport.socket.off('lsp:server_to_client');
          }
        },
      };

      // Connect the client to the server - this initiates the LSP handshake
      try {
        console.log('[LSP] Connecting client to transport...');
        this.lspClient.connect(cmTransport);
      } catch (err) {
        console.error('[LSP] Failed to connect LSPClient:', err);
        transport.close();
        this.lspTransport = null;
        this.lspClient = null;
        return;
      }

      // Store connection info for document symbol requests
      // Use the provided file path or construct from project root
      this._lspFileUri = filePath ? ('file://' + filePath) : ('file://' + projectRoot + '/untitled');
      this._lspLanguageId = languageId;

      // Install LSP extension into its own compartment
      if (!this.lspCompartment) {
        this.lspCompartment = new CM.Compartment();
      }

      // Note: LSPClient.plugin() creates the extension and triggers didOpen
      // We need to pass the file URI and language ID
      try {
        const lspExtension = this.lspClient.plugin(this._lspFileUri, languageId);
        this.editor.dispatch({
          effects: [
            this.lspCompartment.reconfigure([lspExtension]),
          ],
        });
      } catch (err) {
        console.error('[LSP] Failed to install LSP extension:', err);
      }

      console.log(`[LSP] Connected to ${languageId} (projectRoot=${projectRoot})`);

      // Wait for initialization then request document symbols
      this.lspClient.initializing.then(() => {
        console.log('[LSP] Client initialized, requesting symbols...');
        this.requestDocumentSymbols();
      }).catch((err) => {
        console.warn('[LSP] Client initialization failed:', err);
      });

      // Set up debounced symbol refresh on document changes
      if (!this._symbolRefreshDebounce) {
        this._symbolRefreshDebounce = this._debounce(() => {
          this.requestDocumentSymbols();
        }, 1000);
      }
    },

    disconnectLSP() {
      // Dispose client (should close transport) and clear compartment
      try {
        if (this.lspClient && typeof this.lspClient.dispose === 'function') {
          this.lspClient.dispose();
        }
      } catch (err) {
        console.warn('[LSP] Error while disposing LSP client:', err);
      }
      this.lspClient = null;

      try {
        if (this.lspTransport && typeof this.lspTransport.close === 'function') {
          this.lspTransport.close();
        }
      } catch (err) {
        console.warn('[LSP] Error while closing LSP transport:', err);
      }
      this.lspTransport = null;

      if (this.editor && this.lspCompartment) {
        try {
          this.editor.dispatch({
            effects: [
              this.lspCompartment.reconfigure([]),
            ],
          });
        } catch (err) {
          console.warn('[LSP] Failed to clear LSP compartment:', err);
        }
      }

      // Clear LSP-driven symbols when disconnecting
      this.lspSymbols = [];
      try {
        if (this._stickyScrollPlugin && typeof this._stickyScrollPlugin.updateStickyHeader === 'function') {
          this._stickyScrollPlugin.updateStickyHeader(true);
        }
      } catch (err) {
        console.warn('[StickyScroll] Failed to refresh after LSP disconnect:', err);
      }
    },
    // Handle LSP documentSymbols payloads.
    // Primary consumer is the in-bundle Sticky Scroll plugin; host notification is secondary.
    handleDocumentSymbols(symbols) {
      // Normalize payload to an array
      if (Array.isArray(symbols)) {
        this.lspSymbols = symbols;
      } else if (symbols && Array.isArray(symbols.symbols)) {
        // Some clients wrap under { symbols: [...] }
        this.lspSymbols = symbols.symbols;
      } else {
        this.lspSymbols = [];
      }

      console.log(`[LSP] Received ${this.lspSymbols.length} document symbols`);

      // Notify Sticky Scroll to recompute its model if active
      try {
        if (this._stickyScrollPlugin && typeof this._stickyScrollPlugin.updateStickyHeader === 'function') {
          this._stickyScrollPlugin.updateStickyHeader(true);
        }
      } catch (err) {
        console.warn('[StickyScroll] Failed to refresh from LSP symbols:', err);
      }

      // Optional: bubble up to host iframe consumer for outline/telemetry
      try {
        this.notifyParent('cm6-document-symbols', { symbols: this.lspSymbols });
      } catch (err) {
        // Host notifications are best-effort only
      }
    },

    // Request document symbols from the LSP server
    async requestDocumentSymbols() {
      if (!this.lspClient || !this._lspFileUri) {
        return;
      }

      // Wait for client to be connected and initialized
      if (!this.lspClient.connected) {
        console.log('[LSP] Client not yet connected, skipping symbol request');
        return;
      }

      try {
        await this.lspClient.initializing;
      } catch (err) {
        console.warn('[LSP] Client initialization failed:', err);
        return;
      }

      try {
        console.log(`[LSP] Requesting document symbols for ${this._lspFileUri}`);
        const symbols = await this.lspClient.request('textDocument/documentSymbol', {
          textDocument: { uri: this._lspFileUri }
        });
        this.handleDocumentSymbols(symbols);
      } catch (err) {
        // Don't spam errors if the server doesn't support documentSymbol
        if (err && err.code === -32601) {
          console.log('[LSP] Server does not support textDocument/documentSymbol');
        } else {
          console.warn('[LSP] Failed to request document symbols:', err);
        }
      }
    },

    // Debounce utility for throttling repeated calls
    _debounce(fn, delay) {
      let timeoutId = null;
      return (...args) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
          fn.apply(this, args);
          timeoutId = null;
        }, delay);
      };
    },
    setDiffMode(mode) {
      if (!this.editor) return;
      if (mode === 'draft') {
        this.editor.dom.classList.add('cm-diff-mode-draft');
        this.editor.dom.classList.remove('cm-diff-mode-git');
      } else {
        this.editor.dom.classList.remove('cm-diff-mode-draft');
        this.editor.dom.classList.add('cm-diff-mode-git');
      }
    },
    setDisabled(disabled) {
      this.editor.dispatch({
        effects: this.editableConfig.reconfigure(this.editableStates[!disabled]),
      });
    },
    setLineWrapping(wrap) {
      this.editor.dispatch({
        effects: this.lineWrappingConfig.reconfigure(wrap ? [CM.EditorView.lineWrapping] : []),
      });
    },
    setFontScale(scale) {
      const { StateEffect, Compartment } = CM;
      const clamped = clampFontScale(scale);
      this.pendingFontScale = clamped;
      if (!this.editor) return;

      if (!this.fontSizeCompartment) {
        this.fontSizeCompartment = new Compartment();
        this.editor.dispatch({
          effects: StateEffect.appendConfig.of(this.fontSizeCompartment.of([])),
        });
      }

      const fontTheme = buildFontScaleTheme(clamped);

      this.editor.dispatch({
        effects: this.fontSizeCompartment.reconfigure([fontTheme]),
      });
    },
    async applyIndentGuides(enabled) {
      // Initialize indent guides compartment on first call
      if (!this.indentCompartment) {
        if (!indentationMarkers) {
          console.warn('[CM6] indentationMarkers not available in bundle');
          return;
        }

        const { Compartment, StateEffect } = CM;

        this.indentCompartment = new Compartment();

        // Extension configuration
        this.indentExtensions = [
          indentationMarkers({
            highlightActiveBlock: true,
            thickness: 1,
            hideFirstIndent: false,
            markerType: 'fullScope',
            colors: {
              light: '#c9b398ff',    // darker muted tan for inactive guides
              dark: '#3c3226ff',     // darker muted tan for inactive guides
              activeLight: '#7a6557ff',  // medium tan for active block
              activeDark: '#7a6557ff'    // medium tan for active block
            }
          })
        ];

        // Install empty compartment
        this.editor.dispatch({
          effects: StateEffect.appendConfig.of(this.indentCompartment.of([]))
        });
      }

      // Reconfigure compartment
      const extensions = enabled ? this.indentExtensions : [];
      this.editor.dispatch({
        effects: this.indentCompartment.reconfigure(extensions)
      });
    },
    async applyZebraStripes(enabled) {
      // Initialize zebra compartment on first call
      if (!this.zebraCompartment) {
        const { EditorView, Decoration, ViewPlugin } = CM;
        const { Facet, RangeSetBuilder, StateEffect, Compartment } = CM;

        this.zebraCompartment = new Compartment();

        const baseTheme = EditorView.baseTheme({
          "&light .cm-zebraStripe": { backgroundColor: "rgba(0,0,0,.035)" },
          "&dark .cm-zebraStripe": { backgroundColor: "rgba(255,255,255,.06)" },
        });

        const stepSize = Facet.define({ combine: v => v.length ? v[0] : 2 });
        const stripe = Decoration.line({ attributes: { class: "cm-zebraStripe" } });

        function stripeDeco(v) {
          const step = v.state.facet(stepSize);
          const b = new RangeSetBuilder();
          for (let { from, to } of v.visibleRanges) {
            for (let pos = from; pos <= to;) {
              const line = v.state.doc.lineAt(pos);
              if ((line.number % step) === 0) b.add(line.from, line.from, stripe);
              pos = line.to + 1;
            }
          }
          return b.finish();
        }

        const zebraPlugin = ViewPlugin.fromClass(class {
          constructor(v) { this.decorations = stripeDeco(v); }
          update(u) {
            if (u.docChanged || u.viewportChanged) this.decorations = stripeDeco(u.view);
          }
        }, { decorations: v => v.decorations });

        this.zebraExtensions = [baseTheme, stepSize.of(2), zebraPlugin];

        // Install empty compartment
        this.editor.dispatch({
          effects: StateEffect.appendConfig.of(this.zebraCompartment.of([]))
        });
      }

      // Reconfigure compartment
      const extensions = enabled ? this.zebraExtensions : [];
      this.editor.dispatch({
        effects: this.zebraCompartment.reconfigure(extensions)
      });
    },

    // Initialize diff compartments early so minimap can reference diffField
    initDiffCompartments() {
      if (this.diffCompartment) return; // Already initialized

      const { StateEffect, StateField, Compartment } = CM;

      this.diffCompartment = new Compartment();
      this.setDiffEffect = StateEffect.define();
      this.clearDiffEffect = StateEffect.define();

      const setDiffEffect = this.setDiffEffect;
      const clearDiffEffect = this.clearDiffEffect;

      const diffField = StateField.define({
        create() {
          return CM.Decoration.none;
        },
        update(value, tr) {
          if (tr.docChanged && value !== CM.Decoration.none) {
            value = value.map(tr.changes);
          }
          for (const effect of tr.effects) {
            if (effect.is(setDiffEffect)) {
              value = effect.value;
            } else if (effect.is(clearDiffEffect)) {
              value = CM.Decoration.none;
            }
          }
          return value;
        },
        provide: field => CM.EditorView.decorations.from(field)
      });

      this.diffField = diffField;

      this.editor.dispatch({
        effects: StateEffect.appendConfig.of(this.diffCompartment.of([diffField]))
      });

      // Also initialize gutter compartment
      this.diffGutterCompartment = new Compartment();
      this.setDiffGutterEffect = StateEffect.define();
      this.clearDiffGutterEffect = StateEffect.define();
      const setDiffGutterEffect = this.setDiffGutterEffect;
      const clearDiffGutterEffect = this.clearDiffGutterEffect;
      const diffGutterField = StateField.define({
        create() {
          return EMPTY_GUTTER_RANGESET;
        },
        update(value, tr) {
          if (tr.docChanged && value && typeof value.map === 'function') {
            value = value.map(tr.changes);
          }
          for (const effect of tr.effects) {
            if (effect.is(setDiffGutterEffect)) {
              value = effect.value;
            } else if (effect.is(clearDiffGutterEffect)) {
              value = EMPTY_GUTTER_RANGESET;
            }
          }
          return value;
        },
      });
      this.diffGutterField = diffGutterField;
      this.diffGutterExtension = [
        diffGutterField,
        CM.gutter({
          class: 'cm-diff-gutter',
          markers: view => view.state.field(diffGutterField),
          initialSpacer: () => new DiffGutterMarker(''),
          ...(CM.gutterWidgetClass ? {
            widgetMarker: (view, widget, block) => {
              if (widget instanceof RemovedLineWidget) {
                return widget.isDraft ? minusDraftMarker : minusMarker;
              }
              return null;
            }
          } : {}),
        }),
        CM.lineNumberWidgetMarker.of((view, widget, block) => {
          if (widget instanceof RemovedLineWidget) {
            return new DeletedLineNumberMarker(widget.originalLine, widget.isDraft);
          }
          return null;
        }),
      ];
      this.editor.dispatch({
        effects: CM.StateEffect.appendConfig.of(this.diffGutterCompartment.of([]))
      });

      console.log('[CodeMirror] Diff compartments initialized early');
    },

    async applyDiffDecorations(hunks) {
      console.log('[applyDiffDecorations] Called with hunks:', JSON.stringify(hunks, null, 2));
      console.log('[applyDiffDecorations] Doc has', this.editor?.state?.doc?.lines, 'lines');

      // Initialize diff compartment if not already done (fallback for direct calls)
      if (!this.diffCompartment) {
        this.initDiffCompartments();
      }

      const normalizedHunks = Array.isArray(hunks) ? hunks : [];

      const getWordWrap = () => this.lineWrapping || false;
      console.log('[applyDiffDecorations] Building decorations, wordWrap:', getWordWrap());
      const { decorations: decoSet, gutter: gutterSet, gutterClasses: gutterClassSet } = buildDiffDecorations(this.editor, normalizedHunks, CM, getWordWrap);
      console.log('[applyDiffDecorations] Built diff decorations');
      const gutterActive = gutterSet !== EMPTY_GUTTER_RANGESET;

      const effects = [
        this.setDiffEffect.of(decoSet)
      ];
      if (this.diffGutterCompartment && this.diffGutterExtension) {
        if (gutterActive) {
          effects.push(this.diffGutterCompartment.reconfigure(this.diffGutterExtension));
          effects.push(this.setDiffGutterEffect.of(gutterSet));
        } else {
          effects.push(this.clearDiffGutterEffect.of(null));
          effects.push(this.diffGutterCompartment.reconfigure([]));
        }
      }

      // Reconfigure gutter classes
      if (this.gutterClassCompartment) {
        if (gutterActive && gutterClassSet !== EMPTY_GUTTER_RANGESET) {
          effects.push(this.gutterClassCompartment.reconfigure(CM.gutterLineClass.of(gutterClassSet)));
        } else {
          effects.push(this.gutterClassCompartment.reconfigure([]));
        }
      }

      this.editor.dispatch({ effects });

      // Force minimap update to reflect new diff gutters
      if (this.showMinimap) {
        this.updateMinimapState();
      }
    },
    setupExtensions() {
      const self = this;

      // Sends a ChangeSet https://codemirror.net/docs/ref/#state.ChangeSet
      // containing only the changes made to the document.
      // This could potentially be optimized further by sending updates
      // periodically instead of on every change and accumulating changesets
      // with ChangeSet.compose.
      const changeSender = CM.ViewPlugin.fromClass(
        class {
          constructor() {
            this.debounceTimer = null;
          }
          update(update) {
            if (!update.docChanged) return;
            if (!self.emitting) return;

            // Trigger LSP symbol refresh on document changes
            if (self._symbolRefreshDebounce) {
              self._symbolRefreshDebounce();
            }

            if (this.debounceTimer) {
              clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = setTimeout(() => {
              const newContent = update.state.doc.toString();
              self.$emit("change", { value: newContent });
            }, 500); // 500ms debounce
          }
        }
      );

      // Scroll activity detector for mobile minimap fade-in
      const scrollActivityPlugin = CM.ViewPlugin.fromClass(
        class {
          constructor(view) {
            this.view = view;
            this.timeout = null;
            this.onScroll = this.onScroll.bind(this);
            // Attach to scroller DOM
            this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
          }

          onScroll() {
            const wrapper = this.view.dom;
            if (!wrapper.classList.contains('cm-scrolling')) {
              wrapper.classList.add('cm-scrolling');
            }

            if (this.timeout) clearTimeout(this.timeout);
            this.timeout = setTimeout(() => {
              wrapper.classList.remove('cm-scrolling');
            }, 1500); // Keep visible for 1.5s after scroll stops
          }

          destroy() {
            this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
            if (this.timeout) clearTimeout(this.timeout);
          }
        }
      );

      // Create compartment for dynamic indent unit (before extensions array)
      this.indentUnitCompartment = new CM.Compartment();

      // Create compartments for toggleable features
      this.colorPickerCompartment = new CM.Compartment();
      this.readOnlyCompartment = new CM.Compartment();
      this.fontSizeCompartment = new CM.Compartment();
      this.gutterClassCompartment = new CM.Compartment();

      const initialFontScale = clampFontScale(this.fontScale);
      const initialFontTheme = buildFontScaleTheme(initialFontScale);
      this.pendingFontScale = initialFontScale;

      if (!this.theme) {
        throw new Error('[CodeMirror] Missing required theme prop; CodeMirror cannot initialize');
      }

      const initialThemeExtension = this.resolveThemeExtension(this.theme);

      const extensions = [
        CM.basicSetup,
        changeSender,
        scrollActivityPlugin, // Add the scroll listener
        // Enables the Tab key to indent the current lines https://codemirror.net/examples/tab/
        CM.keymap.of([CM.indentWithTab]),
        // Sets indentation https://codemirror.net/docs/ref/#language.indentUnit
        this.indentUnitCompartment.of(CM.indentUnit.of(this.indent)),
        // We will set these Compartments later and dynamically through props
        this.themeConfig.of([initialThemeExtension]),
        this.languageConfig.of([]),
        this.editableConfig.of([]),
        this.lineWrappingConfig.of([]),
        this.fontSizeCompartment.of([initialFontTheme]),
        this.colorPickerCompartment.of([]), // Color picker toggle
        this.readOnlyCompartment.of([]),     // Read-only mode toggle
        this.gutterClassCompartment.of([]), // Gutter line classes
        // Apply styling to ALL gutters for deletion widgets (fixes fold gutter tinting)
        (CM.gutterWidgetClass ? CM.gutterWidgetClass.of((view, widget, block) => {
          if (widget instanceof RemovedLineWidget) {
            return new DeletedFoldMarker();
          }
          return null;
        }) : []),
        CM.EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
      ];

      if (this.highlightWhitespace) extensions.push([CM.highlightWhitespace()]);
      if (searchExtension) extensions.push(searchExtension());
      if (highlightSelectionMatches) extensions.push(highlightSelectionMatches());
      if (searchKeymap && searchKeymap.length) {
        extensions.push(CM.keymap.of(searchKeymap));
      }

      // Scroll tracking via ViewPlugin (viewport-based; no focus assumptions)
      try {
        const self = this;
        const scrollTracker = CM.ViewPlugin.fromClass(class {
          constructor(view) {
            this.view = view;
            self.reportScrollPosition(view);
          }
          update(update) {
            if (update.viewportChanged || update.docChanged) {
              self.reportScrollPosition(update.view);
            }
          }
          destroy() {
            this.view = null;
          }
        });
        console.log('[CodeMirror] Installing scroll tracker plugin');
        extensions.push(scrollTracker);
      } catch (err) {
        console.warn('[CodeMirror] Failed to initialize scroll tracker plugin:', err);
      }

      return extensions;
    },
    // ============================================================================
    // CUSTOM METHOD: reportScrollPosition
    // Updated: 2025-12-03 by vectorArc - TE2 Team
    // Fix: Use lineBlockAtHeight instead of posAtCoords - stable during updates
    // Added: Bottom-of-document detection
    // ============================================================================
    reportScrollPosition(viewArg) {
      try {
        const view = viewArg || this.editor;
        if (!view) return;
        const state = view.state;
        if (!state) return;

        // Detect if at bottom of document first
        const { scrollTop, scrollHeight, clientHeight } = view.scrollDOM;
        const atBottom = Math.abs(scrollTop + clientHeight - scrollHeight) < 2;

        if (atBottom) {
          // Report last line when at bottom
          const lastLine = state.doc.lines;
          console.log('[CodeMirror] reportScrollPosition (at bottom)', { line: lastLine, atBottom: true });
          this.notifyParent('cm6-scroll-state', {
            line: lastLine,
            column: 0,
            top: state.doc.length,
            atBottom: true,
            timestamp: Date.now(),
          });
          return;
        }

        // Use visibleRanges / viewport.from to avoid layout reads during update
        let pos = view.viewport.from;
        const ranges = view.visibleRanges;
        if (ranges && ranges.length > 0) {
          pos = ranges[0].from;
        }

        const lineInfo = state.doc.lineAt(pos);
        const line = lineInfo.number;
        const column = pos - lineInfo.from;

        console.log('[CodeMirror] reportScrollPosition', { line, column, pos });
        this.notifyParent('cm6-scroll-state', {
          line,
          column,
          top: pos,
          atBottom: false,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.warn('[CodeMirror] Failed to report scroll position:', err);
      }
    },
    // ============================================================================
    // CUSTOM METHOD: jumpToLine
    // Added: 2025-11-17 by TE-2 Team
    // Purpose: Jump to a specific line number in the editor
    // Used by: Explorer search feature, Go To Line menu
    // Note: Uses proper CM6 API via editor.dispatch() for reliable scrolling
    // ============================================================================
    jumpToLine(payload) {
      if (!this.editor) {
        console.warn('[CodeMirror] jumpToLine: editor not ready');
        return;
      }

      let shouldFocus = true;
      let input = payload;
      if (payload && typeof payload === 'object') {
        input = payload.line;
        if (Object.prototype.hasOwnProperty.call(payload, 'focus')) {
          shouldFocus = !!payload.focus;
        }
      }

      const line = parseInt(input, 10);
      if (isNaN(line) || line < 1) {
        console.warn('[CodeMirror] jumpToLine: invalid line number', input);
        return;
      }

      try {
        const doc = this.editor.state.doc;
        const maxLine = doc.lines;
        const targetLine = Math.max(1, Math.min(line, maxLine));
        const pos = doc.line(targetLine).from;

        this.editor.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true
        });

        if (shouldFocus) {
          this.editor.focus();
        }

        console.log('[CodeMirror] jumpToLine: jumped to line', targetLine, 'focus=', shouldFocus);
      } catch (err) {
        console.error('[CodeMirror] jumpToLine failed:', err);
      }
    },
    // ============================================================================
    // CUSTOM METHOD: toggleColorPicker
    // Added: 2025-11-19 by TE-2 Team
    // Purpose: Toggle CSS color picker extension on/off
    // Used by: Editor menu "Show Color Picker" toggle
    // ============================================================================
    toggleColorPicker(enabled) {
      if (!this.editor || !this.colorPickerCompartment) {
        console.warn('[CodeMirror] toggleColorPicker: editor not ready');
        return;
      }

      if (!colorExtension) {
        console.warn('[CodeMirror] colorExtension not available in bundle');
        return;
      }

      try {
        const effects = enabled
          ? this.colorPickerCompartment.reconfigure(colorExtension)
          : this.colorPickerCompartment.reconfigure([]);

        this.editor.dispatch({ effects });
        console.log('[CodeMirror] Color picker:', enabled ? 'enabled' : 'disabled');
      } catch (err) {
        console.error('[CodeMirror] toggleColorPicker failed:', err);
      }
    },
    // ============================================================================
    // CUSTOM METHOD: setReadOnly
    // Added: 2025-11-19 by TE-2 Team
    // Purpose: Set editor to read-only mode (disable editing)
    // Used by: Editor menu "Read Only Mode" toggle
    // Note: On mobile, keyboard may still appear on tap - this is a CM6 limitation
    // ============================================================================
    setReadOnly(readonly) {
      if (!this.editor || !this.readOnlyCompartment) {
        console.warn('[CodeMirror] setReadOnly: editor not ready');
        return;
      }

      try {
        const effects = readonly
          ? this.readOnlyCompartment.reconfigure([
            CM.EditorState.readOnly.of(true),
            CM.EditorView.editable.of(false)
          ])
          : this.readOnlyCompartment.reconfigure([]);

        this.editor.dispatch({ effects });
        console.log('[CodeMirror] Read-only mode:', readonly ? 'enabled' : 'disabled');
      } catch (err) {
        console.error('[CodeMirror] setReadOnly failed:', err);
      }
    },
    // ============================================================================
    // CUSTOM METHOD: applyMinimapMode
    // Added: 2025-11-24 by TE-2 Team
    // Purpose: Configure minimap extension based on mode (desktop/mobile/off)
    // Used by: Editor preferences and layout detection
    // ============================================================================
    async applyMinimapMode(mode) {
      // mode: "desktop" | "mobile" | "off"
      if (!this.editor || !showMinimap || typeof showMinimap.compute !== 'function') {
        console.warn('[CodeMirror] minimap not available');
        return;
      }

      if (!this.minimapCompartment) {
        this.minimapCompartment = new CM.Compartment();

        // Install empty compartment once
        this.editor.dispatch({
          effects: CM.StateEffect.appendConfig.of(
            this.minimapCompartment.of([])
          ),
        });
      }

      const targetMode = mode || 'off';
      let extensions = [];

      if (targetMode !== 'off') {
        // Include diffField in dependencies if it exists so minimap updates when diffs change
        const deps = this.diffField ? ['doc', this.diffField] : ['doc'];

        const minimapExt = showMinimap.compute(deps, (state) => {
          // We just need to give it a container DOM node and config
          const create = (view) => {
            const dom = document.createElement('div');
            // Base class + mode class; CSS will do the heavy lifting
            dom.className = `cm-minimap-container cm-minimap-${targetMode}`;
            return { dom };
          };

          // Desktop vs mobile are just different config knobs
          const isMobile = targetMode === 'mobile';

          // Collect diff gutters if diffField exists (diffs active)
          // Pass 'this.diffField' which is the StateField created in applyDiffDecorations
          const gutters = this.diffField
            ? diffMinimapGuttersFromDecorations(state, this.diffField)
            : [];

          return {
            create,
            // VS Code-ish “blocky” look works well in a tiny view
            displayText: 'blocks',
            // Always show overlay (we control visibility/opacity via CSS/Mode)
            showOverlay: 'always',
            // Inject the collected diff gutters
            gutters: gutters,
          };
        });

        extensions = [minimapExt];
      }

      this.editor.dispatch({
        effects: this.minimapCompartment.reconfigure(extensions),
      });
      console.log('[CodeMirror] Minimap mode set to:', targetMode);

      // Add class to editor DOM for desktop sidebar layout
      if (targetMode === 'desktop') {
        this.editor.dom.classList.add('cm-has-minimap-desktop');
      } else {
        this.editor.dom.classList.remove('cm-has-minimap-desktop');
      }
    },
    // ============================================================================

    // ============================================================================
    // CUSTOM METHOD: applyStickyScroll
    // Added: 2025-12-03 by vectorArc - TE2 Team
    // Purpose: Enable Monaco-style sticky scroll showing current function/class scope
    // Uses: CM6 ViewPlugin with absolute-positioned overlay + Lezer syntax tree
    // Fixed: 2025-12-03 - Converted to Monaco pixel-geometry approach for proper triggering
    // ============================================================================
    applyStickyScroll(enabled) {
      if (!this.editor) return;

      const cmComponent = this;

      // Language-aware scope node types
      const SCOPE_NODE_TYPES = {
        javascript: new Set([
          "FunctionDeclaration", "FunctionExpression", "ArrowFunction",
          "MethodDeclaration", "MethodDefinition",
          "ClassDeclaration", "ClassExpression",
          "ExportDefault", "ExportDefaultDeclaration", "ExportDeclaration", "export"
        ]),
        typescript: new Set([
          "FunctionDeclaration", "FunctionExpression", "ArrowFunction",
          "MethodDeclaration", "MethodDefinition",
          "ClassDeclaration", "ClassExpression",
          "ExportDefault", "ExportDefaultDeclaration", "ExportDeclaration", "export",
          "InterfaceDeclaration", "TypeAliasDeclaration", "EnumDeclaration"
        ]),
        python: new Set([
          "FunctionDefinition", "ClassDefinition"
        ]),
        html: new Set([
          // Use element nodes; keeps nesting matching the DOM tree
          "Element"
        ]),
        css: new Set([
          // Group by rule blocks
          "StyleRule", "QualifiedRule", "AtRule"
        ]),
        // Fallback for other languages
        default: new Set([
          "FunctionDeclaration", "FunctionDefinition", "FunctionExpression",
          "ArrowFunction", "MethodDeclaration", "MethodDefinition",
          "ClassDeclaration", "ClassDefinition", "ClassExpression"
        ])
      };

      // Get scope types for current language
      const getScopeTypes = () => {
        const lang = (this.language || 'default').toLowerCase();
        return SCOPE_NODE_TYPES[lang] || SCOPE_NODE_TYPES.default;
      };

      // Markdown sections (ATX only, Monaco-style)
      const collectMarkdownHeadingsSimple = (doc) => {
        const headings = [];
        for (let i = 1; i <= doc.lines; i++) {
          const text = doc.line(i).text;
          const m = text.match(/^( {0,3})(#{1,6})\s+(.*)$/);
          if (!m) continue;
          headings.push({ line: i, level: m[2].length, text: m[3].trim() });
        }
        return headings;
      };

      const buildMarkdownSectionsSimple = (headings, totalLines) => {
        if (!headings.length) return [];
        return headings.map((h, idx) => {
          const next = headings.slice(idx + 1).find(n => n.level <= h.level);
          const endLine = next ? Math.max(h.line, next.line - 1) : totalLines;
          return { ...h, endLine };
        });
      };

      const markdownPathAtSimple = (sections, refLine) => {
        if (!sections.length) return [];
        const stack = [];
        for (const sec of sections) {
          if (sec.line > refLine) break;
          if (refLine > sec.endLine) continue; // only include if ref within section
          while (stack.length && stack[stack.length - 1].level >= sec.level) {
            stack.pop();
          }
          stack.push(sec);
        }
        return stack;
      };

      // Generic fold-based section helpers (work for other/unknown langs)
      const collectFoldSections = (state) => {
        const doc = state.doc;
        const sections = [];
        for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
          const line = doc.line(lineNo);
          const range = CM.foldable(state, line.from, line.to);
          // If foldable is missing (e.g., for some markdown headings), fall back to heading heuristics
          if (!range) {
            const atx = line.text.match(/^( {0,3})(#{1,6})\s+(.*)$/);
            if (!atx) continue;
            // Heuristic span: to next heading or doc end; resolved later
            sections.push({
              from: line.from,
              to: doc.length, // temp; will be trimmed in post-processing
              line: lineNo,
              text: atx[3].trim(),
              level: atx[2].length,
              isHeuristic: true,
            });
            continue;
          }
          const text = line.text.trim();
          if (!text) continue;
          // Try to infer heading level for markdown (ATX) to help nesting when fold ranges overlap
          let level = null;
          const atx = text.match(/^(#{1,6})\s+/);
          if (atx) level = atx[1].length;
          sections.push({
            // Expand to include the heading line itself so the section contains refPos within body
            from: line.from,
            to: range.to,
            line: lineNo,
            text,
            level,
            isHeuristic: false,
          });
        }
        // Post-process heuristic headings to set their end to the next heading start
        const sorted = sections.slice().sort((a, b) => a.from - b.from);

        // First, trim heuristic headings to next heading start
        for (let i = 0; i < sorted.length; i++) {
          const s = sorted[i];
          if (!s.isHeuristic) continue;
          const next = sorted[i + 1];
          if (next) s.to = Math.max(s.from, next.from);
          else s.to = doc.length;
        }

        // Then, for markdown headings (level != null), extend to next heading of same or higher level
        for (let i = 0; i < sorted.length; i++) {
          const s = sorted[i];
          if (s.level == null) continue;
          let end = doc.length;
          for (let j = i + 1; j < sorted.length; j++) {
            const nxt = sorted[j];
            if (nxt.level != null && nxt.level <= s.level) {
              end = nxt.from;
              break;
            }
          }
          s.to = Math.max(s.from + 1, end);
        }

        return sorted;
      };

      // Given fold sections, build nested path at a reference position
      const pathFromSectionsAtPos = (sections, pos, doc) => {
        if (!sections || !sections.length) return [];
        const candidates = sections.filter((s) => s.from <= pos && pos < s.to);
        // Sort outermost -> innermost (by span)
        candidates.sort((a, b) => {
          if (a.from !== b.from) return a.from - b.from;
          return b.to - a.to; // larger span first
        });
        const path = [];
        for (const s of candidates) {
          const last = path[path.length - 1];
          const fitsNest = !last || (last.from <= s.from && s.to <= last.to);
          const replaceSameOrHigher = last && last.level != null && s.level != null && last.level <= s.level;
          if (fitsNest) {
            path.push(s);
          } else if (replaceSameOrHigher) {
            path[path.length - 1] = s;
          }
        }
        return path.map((s, idx) => ({
          node: { from: doc.line(s.line).from, to: doc.line(s.line).to },
          depth: idx,
          startLine: s.line,
          endLine: doc.lineAt(s.to).number,
          text: s.text,
          triggerLine: s.line - (idx + 2),
          endTriggerLine: Math.max(s.line, doc.lineAt(s.to).number - (idx + 2)),
          indentDepth: idx,
          indentSpaces: 0,
        }));
      };

      // Decide if a node counts as a scope header.
      const isScopeNode = (node, scopeTypes, state, isPython) => {
        if (scopeTypes.has(node.name)) return true;
        const lname = node.name ? node.name.toLowerCase() : '';
        // Treat any default export wrapper as a scope
        if (lname.includes('export') && lname.includes('default')) return true;
        // Capture `export default { ... }` object literals as top-level scopes.
        if (node.name === 'ObjectExpression' && node.parent) {
          const pl = node.parent.name ? node.parent.name.toLowerCase() : '';
          if (pl.includes('export') && pl.includes('default')) return true;
        }
        // Python main guard: treat `if __name__ == '__main__':` as a scope header
        if (isPython && node.name === 'IfStatement' && state) {
          try {
            const snippet = state.doc.sliceString(node.from, node.to);
            if (/^\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:/m.test(snippet)) {
              return true;
            }
          } catch (e) { }
        }
        return false;
      };

      // Escape HTML for safe rendering
      const escapeHtml = (str) => {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
      };

      // Sticky scroll theme - ABSOLUTE overlay beside gutter
      const stickyScrollTheme = CM.EditorView.baseTheme({
        ".cm-stickyHeader": {
          position: "fixed",
          backgroundColor: "var(--cm-sticky-bg, var(--cm-editor-bg, #1e1e1e))",
          fontFamily: '"EditorMono", "JetBrains Mono", monospace',
          fontSize: "inherit",
          lineHeight: "1.4",
          zIndex: "300",
          pointerEvents: "auto",
          overflow: "hidden",
          // Soft shadow under the bottom-most overlay line
          boxShadow: "0 6px 8px rgba(0,0,0,0.35)",
        },
        ".cm-sticky-layer": {
          position: "absolute",
          left: "0",
          right: "0",
          height: "var(--cm-sticky-line-height, 1lh)",
          overflow: "hidden",
          display: "flex",
          alignItems: "stretch",
          backgroundColor: "var(--cm-sticky-bg, var(--cm-editor-bg, #1e1e1e))",
          pointerEvents: "auto",
        },
        ".cm-sticky-layer.innermost": {
          boxShadow: "0 6px 8px rgba(0,0,0,0.35)",
          transition: "transform 140ms cubic-bezier(0.25, 0.1, 0.25, 1), height 140ms cubic-bezier(0.25, 0.1, 0.25, 1)",
        },
        ".cm-sticky-layer.entering": {
          animation: "cm-sticky-enter 150ms ease-out",
        },
        ".cm-sticky-layer.exiting": {
          transform: "translateY(-100%)",
          opacity: "0",
          transition: "transform 150ms ease-out, opacity 150ms ease-out",
          pointerEvents: "none",
        },
        "@keyframes cm-sticky-enter": {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" }
        },
        ".cm-stickyHeader:empty": {
          display: "none",
        },
        ".cm-sticky-line": {
          padding: "1px 0 1px 0",
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          borderLeft: "2px solid transparent",
        },
        ".cm-sticky-line:hover": {
          backgroundColor: "rgba(255,255,255,0.05)",
          borderLeftColor: "#007acc",
        },
        ".cm-sticky-gutter": {
          display: "flex",
          flex: "0 0 auto",
          textAlign: "right",
          alignItems: "flex-start",
          padding: "0 10px 0 3.5px", // extra right padding for line numbers
          opacity: "0.85",
          fontVariantNumeric: "tabular-nums",
          color: "var(--cm-sticky-gutter-fg, var(--cm-gutter-foreground, #858585))",
          backgroundColor: "var(--cm-sticky-gutter-bg, var(--cm-gutter-background, transparent))",
          boxSizing: "border-box",
          borderRight: "1px solid rgba(255,255,255,0.08)",
        },
        ".cm-sticky-gutter-segment": {
          flex: "0 0 auto",
          textAlign: "right",
          paddingRight: "7px",
          boxSizing: "border-box",
        },
        ".cm-sticky-content": {
          flex: "1 1 auto",
          padding: "0 6px 0 6px",
          whiteSpace: "pre-wrap",
          wordBreak: "normal",
          overflowWrap: "anywhere",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
      });

      // ============================================================================
      // ViewPlugin using Monaco-style pixel geometry with line-based n+1 offsets
      // (restored from last known good n+1 implementation)
      // ============================================================================
      // ========================================================================
      // StickySlots: Enforces one scope per depth level (no Y-axis pileup)
      // ========================================================================
      class StickySlots {
        constructor(maxSlots = 5) {
          this.maxSlots = maxSlots;
          this.slots = new Array(maxSlots).fill(null);
        }

        // Register a scope into its depth slot
        // Returns true if registered, false if slot is occupied by different scope
        register(scope) {
          const slot = scope.depth;
          if (slot < 0 || slot >= this.maxSlots) return false;

          const existing = this.slots[slot];
          if (existing) {
            // Same scope (by startLine) - update it
            if (existing.startLine === scope.startLine) {
              this.slots[slot] = scope;
              return true;
            }
            // Different scope at same depth - reject (caller must clear first)
            return false;
          }

          this.slots[slot] = scope;
          return true;
        }

        // Clear a slot and all deeper slots
        clear(depth) {
          for (let i = depth; i < this.maxSlots; i++) {
            this.slots[i] = null;
          }
        }

        // Clear all slots
        clearAll() {
          this.slots.fill(null);
        }

        // Get scope at depth (or null)
        get(depth) {
          return this.slots[depth] || null;
        }

        // Get all active scopes in depth order
        getActive() {
          return this.slots.filter(s => s !== null);
        }

        // Get the deepest occupied slot index (-1 if empty)
        getMaxDepth() {
          for (let i = this.maxSlots - 1; i >= 0; i--) {
            if (this.slots[i] !== null) return i;
          }
          return -1;
        }
      }

      const stickyScrollPlugin = CM.ViewPlugin.fromClass(class {
        constructor(view) {
          this.view = view;
          this.dom = document.createElement("div");
          this.dom.className = "cm-stickyHeader";

          // Slot-based scope management (enforces one scope per depth)
          this.slots = new StickySlots(5);
          this.currentScopes = []; // For click handler compatibility
          this.scopeHeights = new Map(); // Cache for scope heights (lines)

          // Used to break the feedback loop between overlay height and
          // sampling position; we always sample using the previous height.
          this.lastOverlayHeight = 0;
          // Smoothed overlay height used for sampling (decays slowly to avoid
          // ping-pong when a scope drops at the boundary).
          this.lastOverlaySampleHeight = 0;
          // Used to add hysteresis to push-up offset near scope ends to
          // avoid flicker when hovering around the boundary.
          this.lastTopOffset = 0;
          // Track last rendered scope signature so we only log on changes.
          this.lastActiveSignature = '';
          // Track last render key to skip redundant DOM rebuilds
          this.lastRenderKey = '';
          // Track last scrollTop to infer scroll direction
          this.lastScrollTop = view.scrollDOM.scrollTop || 0;
          // rAF tail to ensure a follow-up pass if layout lags
          this.rafPending = false;
          // Pending sibling transitions: depth -> { outgoing, incoming, startTime }
          this.pendingTransitions = new Map();

          // Expose this plugin instance back to the Vue component so LSP
          // symbol handlers can request a sticky-header refresh when new
          // symbols arrive (no host round-trip required).
          if (cmComponent) {
            cmComponent._stickyScrollPlugin = this;
          }

          // Append to scrollDOM to share stacking context with minimap (fixes z-index layering)
          view.scrollDOM.appendChild(this.dom);

          // Initial background sync to match current theme
          this.syncBackgroundColor();

          // Click handler for jump-to-definition
          this.dom.addEventListener('click', (e) => {
            const target = e.target.closest('.cm-sticky-line');
            if (target && this.currentScopes.length > 0) {
              const index = parseInt(target.dataset.index, 10);
              const scope = this.currentScopes[index];
              if (!isNaN(index) && scope && scope.node) {
                view.dispatch({
                  selection: { anchor: scope.node.from },
                  scrollIntoView: true,
                });
                view.focus();
              }
            }
          });

          // Direct scroll listener for immediate response
          this.scrollHandler = () => {
            this.updateStickyHeader();
            if (!this.rafPending) {
              this.rafPending = true;
              requestAnimationFrame(() => {
                this.rafPending = false;
                this.updateStickyHeader();
              });
            }
          };
          view.scrollDOM.addEventListener('scroll', this.scrollHandler, { passive: true });

          // Initial render
          this.updateStickyHeader();
        }

        // Sync overlay background to the editor's current background color.
        syncBackgroundColor() {
          const pickColor = (el) => {
            if (!el) return null;
            const style = getComputedStyle(el);
            const bg = style && style.backgroundColor;
            if (!bg) return null;
            // Treat fully transparent as missing
            if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return null;
            return bg;
          };

          let bg = null;
          let gutterBg = null;
          let gutterFg = null;

          // Prefer the scrollDOM, then the scroller, then the root
          bg = pickColor(this.view && this.view.scrollDOM) || bg;
          const scroller = this.view && this.view.scrollDOM && this.view.scrollDOM.querySelector('.cm-scroller');
          bg = bg || pickColor(scroller);
          bg = bg || pickColor(this.view && this.view.dom);
          bg = bg || 'var(--cm-editor-bg, #1e1e1e)';

          // Try to read gutter colors to keep sticky gutter aligned
          try {
            const gutterRoot = this.view && this.view.dom && this.view.dom.querySelector('.cm-gutters');
            if (gutterRoot) {
              const gs = getComputedStyle(gutterRoot);
              gutterBg = pickColor(gutterRoot) || (gs && gs.backgroundColor) || null;
              gutterFg = (gs && gs.color) || null;
            }
          } catch (e) { }

          try {
            this.dom.style.backgroundColor = bg;
            this.dom.style.setProperty('--cm-sticky-bg', bg);
            if (gutterBg) {
              this.dom.style.setProperty('--cm-sticky-gutter-bg', gutterBg);
            }
            if (gutterFg) {
              this.dom.style.setProperty('--cm-sticky-gutter-fg', gutterFg);
            }
          } catch (e) {
            // Fallback silently if computedStyle fails
          }
        }

        // Try to get the styled HTML for a given 1-based line number by
        // cloning the existing .cm-line DOM. Falls back to null if the
        // line isn't currently rendered in the viewport.
        getStyledLineHTML(lineNumber) {
          const view = this.view;
          const state = view.state;
          if (!state || !view || !view.dom) return null;
          if (lineNumber < 1 || lineNumber > state.doc.lines) return null;

          try {
            const line = state.doc.line(lineNumber);
            const pos = line.from;
            const domAt = view.domAtPos(pos);
            let node = domAt.node;

            if (!node) return null;
            if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
              node = node.parentElement;
            }

            // Walk up until we hit the .cm-line container
            while (node && node !== view.dom) {
              if (node.nodeType === Node.ELEMENT_NODE &&
                node.classList &&
                node.classList.contains("cm-line")) {
                return node.innerHTML;
              }
              node = node.parentNode;
            }
          } catch (e) {
            // If DOM lookup fails (e.g., line not in viewport), just fall back.
          }
          return null;
        }

        updateStickyHeader(isRetry = false) {
          const view = this.view;
          const state = view.state;
          const scrollTop = view.scrollDOM.scrollTop;
          const lineHeight = view.defaultLineHeight;

          // Debug: log every 50th call to verify handler is running
          if (!this._callCount) this._callCount = 0;
          this._callCount++;
          if (this._callCount % 50 === 0) {
            console.log('[Slots] heartbeat', { callCount: this._callCount, scrollTop });
          }

          // CRITICAL: Update scroll tracking FIRST, before any early returns
          const direction = scrollTop > this.lastScrollTop ? 1 : (scrollTop < this.lastScrollTop ? -1 : 0);
          this.lastScrollTop = scrollTop;

          // Remember which scopes were active on the previous pass for hysteresis
          const prevActiveKeys = new Set(
            (this.currentScopes || []).map((s) => `${s.depth}:${s.startLine}-${s.endLine}`)
          );

          // Get gutter container and child gutter segments (line numbers, folds, etc.)
          const gutterRoot = view.dom.querySelector('.cm-gutters');
          const gutterWidth = gutterRoot ? gutterRoot.offsetWidth : 0;
          const gutterChildren = gutterRoot ? Array.from(gutterRoot.children) : [];
          const gutterSegmentWidths = gutterChildren.map((child) => child.offsetWidth || 0);
          const lineNumberGutter = gutterChildren.find((el) =>
            el.classList && el.classList.contains('cm-lineNumbers')
          ) || gutterChildren[0] || null;
          // Sync font size with the line-number gutter if possible
          if (lineNumberGutter) {
            try {
              const gutterStyle = window.getComputedStyle(lineNumberGutter);
              if (gutterStyle && gutterStyle.fontSize) {
                const baseSize = parseFloat(gutterStyle.fontSize);
                if (Number.isFinite(baseSize)) {
                  // Nudge slightly smaller than gutter to avoid crowding
                  this.dom.style.fontSize = `${Math.max(1, baseSize + 0.0)}px`;
                } else {
                  this.dom.style.fontSize = gutterStyle.fontSize;
                }
              }
            } catch (e) {
              // Ignore style lookup failures
            }
          }

          // Position absolute overlay spanning the entire content area,
          // including a synthetic gutter on the left.
          this.dom.style.top = '0';
          this.dom.style.left = '0';
          this.dom.style.right = '0';

          // Language flags early (used for sampling offsets too)
          const langName = (cmComponent && cmComponent.language || 'default').toLowerCase();
          const isPython = langName === 'python';
          const isMarkdown = langName === 'markdown' || langName === 'md' || langName === 'gfm';

          // ---------------------------------------------------------------------------
          // 1) Compute reference line below the current overlay
          //    Use the previous overlay height for sampling to avoid the
          //    overlay changing and refLine jumping in the same frame.
          //    Apply a scroll-fraction-based early-capture offset so that
          //    word-wrapped documents stay aligned from top to bottom.
          // ---------------------------------------------------------------------------
          const currentOverlayHeight = this.dom.offsetHeight || 0;
          const samplingOverlayHeight = this.lastOverlaySampleHeight || currentOverlayHeight;

          // Compute scroll fraction for the whole document (0 = top, 1 = bottom)
          const { scrollHeight, clientHeight } = view.scrollDOM;
          const denom = Math.max(1, scrollHeight - clientHeight);
          const scrollFrac = Math.max(0, Math.min(1, scrollTop / denom));

          const wrappingEnabled = cmComponent ? cmComponent.lineWrapping : false;
          let driftCorrectionLines = 0;
          let earlyLines = direction >= 0 ? 1 : 0;

          const baseTop = scrollTop + samplingOverlayHeight;
          const effectiveTop = baseTop + earlyLines * lineHeight;

          let refPos;
          try {
            const block = view.lineBlockAtHeight(effectiveTop);
            refPos = block.from;
          } catch {
            refPos = view.viewport.from;
          }
          const refLine = state.doc.lineAt(refPos).number;

          // ---------------------------------------------------------------------------
          // 2) Build scope candidates from LSP symbols (if available) or syntax tree
          // ---------------------------------------------------------------------------
          const scopeTypes = getScopeTypes();

          let candidateScopes = [];

          if (isMarkdown) {
            const headings = collectMarkdownHeadingsSimple(state.doc);
            const sections = buildMarkdownSectionsSimple(headings, state.doc.lines);
            const path = markdownPathAtSimple(sections, refLine - earlyLines);

            let cumulativeHeight = 0;
            candidateScopes = path.map((sec, idx) => {
              const depth = idx;
              let cachedHeight = 1;
              let offset;

              if (wrappingEnabled) {
                const key = `${depth}:${sec.line}`;
                cachedHeight = this.scopeHeights.get(key) || 1;
                // N+1 style early capture for markdown headings (tuned one line later)
                // Adjust offset based on cumulative height of ancestors
                offset = -(cumulativeHeight + 2);
                cumulativeHeight += cachedHeight;
              } else {
                // Old logic for non-wrapped mode
                offset = -2;
              }

              const triggerLine = sec.line + offset;
              const endTriggerLine = Math.max(sec.line, sec.endLine + offset);
              const lineObj = state.doc.line(sec.line);
              const rawText = lineObj.text;
              return {
                node: { from: lineObj.from, to: lineObj.to },
                depth,
                startLine: sec.line,
                endLine: sec.endLine,
                text: sec.text,
                rawText,
                triggerLine,
                endTriggerLine,
                indentDepth: depth,
                indentSpaces: 0,
                height: cachedHeight
              };
            });
          } else if (cmComponent && Array.isArray(cmComponent.lspSymbols) && cmComponent.lspSymbols.length) {
            // LSP-backed scopes for languages with documentSymbols
            const indentSize = Math.max(1, (cmComponent && typeof cmComponent.indent === 'string') ? cmComponent.indent.length : 4);

            const flattenSymbols = (symbols, depth) => {
              const sections = [];
              for (const sym of symbols) {
                if (!sym) continue;
                let startLine = null;
                let endLine = null;

                // Prefer full range; fall back to selectionRange if needed
                const range = sym.range || sym.location?.range || sym.selectionRange;
                if (range && range.start && typeof range.start.line === 'number') {
                  startLine = range.start.line + 1; // LSP is 0-based
                }
                if (range && range.end && typeof range.end.line === 'number') {
                  endLine = range.end.line + 1;
                }

                if (startLine == null) continue;
                if (endLine == null || endLine < startLine) endLine = startLine;

                // Clamp to document bounds
                if (startLine < 1 || startLine > state.doc.lines) continue;
                if (endLine < 1) endLine = startLine;
                if (endLine > state.doc.lines) endLine = state.doc.lines;

                sections.push({
                  depth,
                  startLine,
                  endLine,
                  name: sym.name || '',
                  kind: sym.kind,
                  rawText: null,
                });

                if (Array.isArray(sym.children) && sym.children.length) {
                  sections.push(...flattenSymbols(sym.children, depth + 1));
                }
              }
              return sections;
            };

            const sections = flattenSymbols(cmComponent.lspSymbols, 0);
            let cumulativeHeight = 0;

            candidateScopes = sections.map((sec) => {
              const depth = sec.depth;
              const startLine = sec.startLine;
              const endLine = sec.endLine;

              const lineText = state.doc.line(startLine).text;
              const indentMatch = lineText.match(/^([ \t]*)/);
              const indentRaw = indentMatch ? indentMatch[1] : '';
              const indentSpaces = indentRaw.replace(/\t/g, '    ').length;
              const indentDepth = Math.floor(indentSpaces / indentSize);

              let cachedHeight = 1;
              let offset;

              if (wrappingEnabled) {
                const key = `${depth}:${startLine}`;
                cachedHeight = this.scopeHeights.get(key) || 1;
                offset = -(cumulativeHeight + 2);
                cumulativeHeight += cachedHeight;
              } else {
                const offsetDepth = depth;
                offset = -(offsetDepth + 2);
              }

              const triggerLine = startLine + offset;
              let endTriggerLine = Math.max(startLine, endLine + offset);

              return {
                node: null,
                depth,
                startLine,
                endLine,
                text: sec.name || lineText,
                rawText: sec.rawText || lineText,
                triggerLine,
                endTriggerLine,
                indentDepth,
                indentSpaces,
                height: cachedHeight
              };
            });
          } else {
            const tree = CM.ensureSyntaxTree(state, state.doc.length, 200) || CM.syntaxTree(state);
            if (!tree || !tree.topNode) {
              if (this.dom.innerHTML !== '') this.dom.innerHTML = '';
              this.slots.clearAll();
              this.currentScopes = [];
              return;
            }

            let ancestorNodes = [];
            let node = tree.resolveInner(refPos);
            for (; node; node = node.parent) {
              if (isScopeNode(node, scopeTypes, state, isPython)) {
                ancestorNodes.push(node);
              }
            }
            ancestorNodes.reverse(); // depth 0 = outermost

            // For Python, drop outermost ancestors that aren't truly indent-0 (parser fallbacks)
            if (isPython && ancestorNodes.length > 0) {
              ancestorNodes = ancestorNodes.filter((n, idx) => {
                if (idx !== 0) return true;
                const lineText = state.doc.lineAt(n.from).text;
                const indentMatch = lineText.match(/^([ \t]*)/);
                const indentRaw = indentMatch ? indentMatch[1] : '';
                const indentSpaces = indentRaw.replace(/\t/g, '    ').length;
                return indentSpaces === 0;
              });
            }

            const indentSize = Math.max(1, (cmComponent && typeof cmComponent.indent === 'string') ? cmComponent.indent.length : 4);

            let cumulativeHeight = 0;
            candidateScopes = ancestorNodes.map((n, pathDepth) => {
              const startLine = state.doc.lineAt(n.from).number;
              const endLine = state.doc.lineAt(n.to).number;
              const lineText = state.doc.lineAt(n.from).text;
              const indentMatch = lineText.match(/^([ \t]*)/);
              const indentRaw = indentMatch ? indentMatch[1] : '';
              const indentSpaces = indentRaw.replace(/\t/g, '    ').length;
              const indentDepth = Math.floor(indentSpaces / indentSize);
              // Slot depth = ancestor index (outermost -> 0). Use indent only for cosmetics.
              const depth = pathDepth;

              let cachedHeight = 1;
              let offset;

              if (wrappingEnabled) {
                const key = `${depth}:${startLine}`;
                cachedHeight = this.scopeHeights.get(key) || 1;
                // Calculate offset based on cumulative height of ancestors
                offset = -(cumulativeHeight + 2);
                cumulativeHeight += cachedHeight;
              } else {
                // Old logic for non-wrapped mode
                const offsetDepth = isPython ? Math.max(0, depth - 1) : depth;
                offset = -(offsetDepth + 2);
                if (isPython && depth === 1) {
                  offset = -1;
                }
              }

              const triggerLine = startLine + offset;
              // Apply the same offset to the effective end so scopes hand off cleanly
              let endTriggerLine = Math.max(startLine, endLine + offset);
              if (isPython) {
                endTriggerLine += 4; // let Python scopes linger a bit before release
              }

              return {
                node: n,
                depth,
                startLine,
                endLine,
                text: lineText,
                triggerLine,
                endTriggerLine,
                indentDepth,
                indentSpaces,
                height: cachedHeight
              };
            });
          }

          // ---------------------------------------------------------------------------
          // 3) SLOT-BASED ACTIVATION: One scope per depth, no Y-axis pileup
          //    - Clear slots for scopes we've scrolled past
          //    - Register candidates into their depth slots
          //    - Slots enforce the invariant: max one scope per depth level
          // ---------------------------------------------------------------------------
          const hysteresisLines = 0.5;
          const earlyMarginLines = 1.5;

          const DEBUG_SLOTS = false; // Set true to log to browser_console.log

          // First pass: clear slots that are no longer valid
          // A slot should clear if refLine is outside its activation window
          for (let depth = 0; depth < this.slots.maxSlots; depth++) {
            const existing = this.slots.get(depth);
            if (!existing) continue;

            let scopedRef = refLine;
            // With dynamic heights, we don't need arbitrary drift correction
            // scopedRef = refLine;

            // Direction-aware release:
            // - Downward scroll: keep scope until the actual end line passes the ref line
            //   (no early shrink), preventing short scopes from disappearing too soon.
            // - Upward scroll: use the earlier endTriggerLine with margin so scopes exit faster
            //   when backing out.
            const goingDown = direction >= 0;
            const exitLine = goingDown ? existing.endLine : existing.endTriggerLine;
            const exitMargin = goingDown ? 0 : earlyMarginLines;

            // Release when we scroll ABOVE the bottom of the header line
            // Since header shows the startLine, release when refLine goes above startLine + 1
            const scrolledAbove = scopedRef <= existing.startLine;
            let scrolledBelow;
            if (isMarkdown) {
              // For fold-based scopes, allow early exit near the end to ensure clean handoff
              scrolledBelow = scopedRef > (existing.endLine - 1);
            } else {
              scrolledBelow = scopedRef > exitLine + exitMargin;
            }
            const shouldClear = scrolledAbove || scrolledBelow;

            if (DEBUG_SLOTS) {
              console.log('[Slots] check', {
                depth,
                refLine,
                scopedRef,
                startLine: existing.startLine,
                endLine: existing.endLine,
                triggerLine: existing.triggerLine,
                endTriggerLine: existing.endTriggerLine,
                exitLine,
                exitMargin,
                shouldClear,
                scrolledAbove,
                scrolledBelow,
                goingDown
              });
            }

            if (shouldClear) {
              if (DEBUG_SLOTS) console.log('[Slots] CLEARING', { depth });
              this.slots.clear(depth); // Clears this and all deeper slots
            }
          }

          // Second pass: try to register candidate scopes into slots
          for (const scope of candidateScopes) {
            let scopedRef = refLine;
            // if (wrappingEnabled && scope.depth > 0) {
            //   scopedRef = refLine - driftCorrectionLines;
            // }

            const key = `${scope.depth}:${scope.startLine}-${scope.endLine}`;
            const wasActive = prevActiveKeys.has(key);

            // Calculate activation window with hysteresis
            const lower = wasActive
              ? scope.triggerLine - hysteresisLines
              : scope.triggerLine + hysteresisLines;
            const upper = wasActive
              ? scope.endTriggerLine + hysteresisLines
              : scope.endTriggerLine - hysteresisLines;

            // Check if scope should be active
            let shouldActivate = scopedRef > lower && scopedRef <= upper;

            // Near-end linger: keep innermost scope active during push-up
            if (!shouldActivate && scope.depth > 0) {
              try {
                const endLineObj = state.doc.lineAt(scope.node.to);
                const endBlock = view.lineBlockAt(endLineObj.to);
                const endBottomViewport = endBlock.bottom - scrollTop;

                // Calculate prospective header height using cumulative heights
                let prospectiveHeight = 0;
                for (let i = 0; i <= scope.depth; i++) {
                  // Use cached height for ancestors, assume 1 for current if unknown
                  // But we have cached height in scope.height
                  // We need heights of all ancestors 0..depth
                  // Since we are iterating candidates, we can sum them up
                  const ancestor = candidateScopes[i];
                  if (ancestor) prospectiveHeight += (ancestor.height || 1);
                  else prospectiveHeight += 1;
                }
                const prospectiveHeightPx = prospectiveHeight * lineHeight;

                if (endBottomViewport < prospectiveHeightPx + earlyMarginLines * lineHeight) {
                  shouldActivate = true;
                }
              } catch { }
            }

            if (DEBUG_SLOTS) {
              console.log('[Slots] candidate', {
                depth: scope.depth,
                refLine,
                scopedRef,
                startLine: scope.startLine,
                triggerLine: scope.triggerLine,
                lower,
                upper,
                shouldActivate
              });
            }

            if (shouldActivate) {
              // Clear the slot first if occupied by a different scope
              const existing = this.slots.get(scope.depth);
              if (existing && existing.startLine !== scope.startLine) {
                if (isMarkdown) {
                  // Markdown: smooth sibling transition
                  this.pendingTransitions.set(scope.depth, {
                    outgoing: existing,
                    incoming: scope,
                    startTime: performance.now(),
                  });
                } else {
                  // Other languages: immediate swap to preserve snappy n+1 behavior
                  this.slots.clear(scope.depth);
                  this.slots.register(scope);
                }
              } else {
                if (DEBUG_SLOTS) console.log('[Slots] REGISTER', { depth: scope.depth, startLine: scope.startLine });
                this.slots.register(scope);
              }
            }
          }

          // Get active scopes from slots (guaranteed no Y-axis pileup)
          const activeScopes = this.slots.getActive();
          this.currentScopes = activeScopes;

          if (DEBUG_SLOTS) {
            console.log('[Slots] activeScopes', { count: activeScopes.length, scopes: activeScopes.map(s => s.startLine) });
          }

          // Track overlay height even when active set toggles to avoid
          // sampling jitter at the exact moment a scope disappears.
          if (activeScopes.length > 0) {
            // Sum of heights of active scopes
            const totalLines = activeScopes.reduce((sum, s) => sum + (s.height || 1), 0);
            this.lastOverlayHeight = totalLines * lineHeight;
          }

          // Debug logging (disabled by default); flip to true for diagnostics
          const DEBUG_STICKY = false; // set true for troubleshooting sticky overlay
          const signature = activeScopes.map((s) => `${s.depth}:${s.startLine}-${s.endLine}`).join('|');
          try {
            if (DEBUG_STICKY && signature !== this.lastActiveSignature) {
              console.log('[StickyScroll] active change', {
                refLine,
                scrollTop,
                overlayHeight: this.lastOverlayHeight,
                signature,
                scopes: activeScopes.map((s) => ({
                  depth: s.depth,
                  start: s.startLine,
                  end: s.endLine,
                  trigger: s.triggerLine,
                  endTrigger: s.endTriggerLine,
                })),
              });
            }
          } catch (e) {
            // Logging should never break rendering
          }
          // Always update the last signature so renderKey reflects real state
          this.lastActiveSignature = signature;

          // ---------------------------------------------------------------------------
          // 4) Complete pending transitions after animation duration
          // ---------------------------------------------------------------------------
          const TRANSITION_MS = 150;
          for (const [depth, t] of Array.from(this.pendingTransitions.entries())) {
            if (performance.now() - t.startTime >= TRANSITION_MS) {
              this.slots.clear(depth);
              this.slots.register(t.incoming);
              this.pendingTransitions.delete(depth);
            }
          }

          // ---------------------------------------------------------------------------
          // 5) Render overlay from activeScopes (+ any outgoing in transition)
          // ---------------------------------------------------------------------------
          if (activeScopes.length === 0) {
            if (this.dom.innerHTML !== '') this.dom.innerHTML = '';
            // When there is no overlay, pin it at the top. Keep sample height
            // to avoid refLine jump; let it decay slowly below.
            this.dom.style.top = '0px';
            // Decay sample height by at most one line per pass
            if (this.lastOverlaySampleHeight > 0) {
              this.lastOverlaySampleHeight = Math.max(0, this.lastOverlaySampleHeight - lineHeight);
            }
            // Reset renderKey so next non-empty render won't be skipped
            this.lastRenderKey = '';
            return;
          }

          // Compute nominal header height (before push-up) for geometry
          const headerHeightLines = activeScopes.reduce((sum, s) => sum + (s.height || 1), 0);
          const headerHeight = headerHeightLines * lineHeight;

          // ---------------------------------------------------------------------------
          // 5) Push-up effect (Markdown uses section end; code uses node end)
          // ---------------------------------------------------------------------------
          const innermost = activeScopes[activeScopes.length - 1];

          let topOffset = 0;
          let effectiveHeight;

          // Calculate height of the innermost scope (in pixels)
          const innermostHeight = (innermost.height || 1) * lineHeight;
          let lastHeight = innermostHeight;

          // Scale push-up margin based on scope length and type
          const scopeLength = Math.max(1, innermost.endLine - innermost.startLine + 1);
          let pushMarginLines;
          if (isMarkdown) {
            // For markdown, trigger push-up only when the section end crosses the stack bottom.
            pushMarginLines = 0; // start exactly at boundary
          } else {
            if (scopeLength <= 6) pushMarginLines = 1;
            else if (innermost.depth === 0) pushMarginLines = 1.5;
            else pushMarginLines = 3;
          }
          const earlyMargin = pushMarginLines * lineHeight;

          try {
            let endBottomViewport;
            if (isMarkdown) {
              const endLineObj = state.doc.line(innermost.endLine);
              const endLineBlock = view.lineBlockAt(endLineObj.to);
              endBottomViewport = endLineBlock.bottom - scrollTop;
            } else {
              const endLine = state.doc.lineAt(innermost.node.to);
              const endLineBlock = view.lineBlockAt(endLine.to);
              endBottomViewport = endLineBlock.bottom - scrollTop;
            }
            const stackBottomViewport = headerHeight;
            const delta = endBottomViewport - stackBottomViewport;
            if (isMarkdown) {
              if (delta < lineHeight) {
                // Start push-up about one line before the end crosses the stack
                topOffset = Math.max(-innermostHeight, delta - innermostHeight);
              }
            } else {
              if (delta < earlyMargin) {
                topOffset = Math.max(-earlyMargin, delta - earlyMargin);
              }
            }
          } catch (e) {
            // Keep pinned if geometry lookup fails
          }

          // Hysteresis to prevent flicker
          const epsilon = lineHeight * 0.25;
          if (Math.abs(topOffset - this.lastTopOffset) < epsilon) {
            topOffset = this.lastTopOffset;
          }

          // Upward scroll assist
          if (direction < 0 && topOffset < 0) {
            topOffset = Math.min(0, topOffset + lineHeight * 0.2);
          }

          lastHeight = Math.max(0, innermostHeight + topOffset);

          // Effective height is sum of all previous scopes + lastHeight
          const previousHeight = activeScopes.slice(0, -1).reduce((sum, s) => sum + (s.height || 1), 0) * lineHeight;
          effectiveHeight = previousHeight + lastHeight;

          this.lastTopOffset = topOffset;
          this.dom.style.height = `${effectiveHeight}px`;

          // Build one overlay layer per scope (separate stacking). Only the
          // innermost layer is translated for push-up; others stay pinned.
          const renderKey = `${signature}|${topOffset.toFixed(3)}|${effectiveHeight.toFixed(3)}`;
          if (renderKey === this.lastRenderKey && !isRetry) {
            return;
          }
          this.lastRenderKey = renderKey;

          this.dom.innerHTML = '';
          const lastIndex = activeScopes.length - 1;

          let currentTop = 0;

          const renderLayer = (scope, idx, cls) => {
            const scopeLines = scope.height || 1;
            const scopeHeightPx = scopeLines * lineHeight;

            const layer = document.createElement('div');
            layer.className = 'cm-sticky-layer';
            if (cls) layer.classList.add(cls);
            if (idx === lastIndex) layer.classList.add('innermost');

            layer.style.top = `${currentTop}px`;

            // Higher layers (outer scopes) sit above inner ones.
            layer.style.zIndex = String(100 - idx - (cls === 'exiting' ? 1 : 0));
            layer.style.setProperty('--cm-sticky-line-height', `${lineHeight}px`);

            // Apply push-up transform to innermost layer
            layer.style.transform = idx === lastIndex && !cls ? `translateY(${topOffset}px)` : 'translateY(0)';

            // Allow height to be auto for wrapping, but set min-height
            layer.style.height = 'auto';
            layer.style.minHeight = `${lineHeight}px`;

            // Store scope key for measurement
            layer.dataset.scopeKey = `${scope.depth}:${scope.startLine}`;

            const gutter = document.createElement('div');
            gutter.className = 'cm-sticky-gutter';
            gutter.style.width = `${gutterWidth}px`;
            // Create one segment per actual gutter (line numbers, folds, etc.)
            if (gutterSegmentWidths.length > 0) {
              gutterSegmentWidths.forEach((segWidth, segIdx) => {
                const seg = document.createElement('div');
                seg.className = 'cm-sticky-gutter-segment';
                seg.style.width = `${segWidth}px`;
                if (segIdx === 0) seg.textContent = String(scope.startLine);
                gutter.appendChild(seg);
              });
            } else {
              const seg = document.createElement('div');
              seg.className = 'cm-sticky-gutter-segment';
              seg.style.width = `${gutterWidth}px`;
              seg.textContent = String(scope.startLine);
              gutter.appendChild(seg);
            }

            const content = document.createElement('div');
            content.className = 'cm-sticky-content';
            if (wrappingEnabled) {
              content.style.whiteSpace = 'pre-wrap';
              content.style.wordBreak = 'normal';
              content.style.overflowWrap = 'anywhere';
            } else {
              content.style.whiteSpace = 'pre';
            }
            const styled = this.getStyledLineHTML(scope.startLine);
            if (styled != null) {
              content.innerHTML = styled;
            } else {
              if (isMarkdown && scope.rawText) {
                content.textContent = scope.rawText;
              } else {
                content.textContent = scope.text;
              }
            }

            layer.appendChild(gutter);
            layer.appendChild(content);
            this.dom.appendChild(layer);

            // Advance top for next layer
            if (!cls) { // Only advance for main stack, not transitions
              currentTop += scopeHeightPx;
            }
          };

          // Render active scopes and any outgoing transitions
          activeScopes.forEach((scope, idx) => {
            const t = this.pendingTransitions.get(scope.depth);
            if (t && t.outgoing.startLine !== scope.startLine) {
              // Render outgoing + incoming together
              renderLayer(t.outgoing, idx, 'exiting');
              renderLayer(t.incoming, idx, 'entering');
            } else {
              renderLayer(scope, idx, null);
            }
          });

          // ---------------------------------------------------------------------------
          // 6) Measure actual heights and update cache
          // ---------------------------------------------------------------------------
          if (wrappingEnabled && !isRetry) {
            let heightsChanged = false;
            const layers = Array.from(this.dom.querySelectorAll('.cm-sticky-layer'));
            layers.forEach(layer => {
              const key = layer.dataset.scopeKey;
              if (key) {
                const heightPx = layer.offsetHeight;
                const lines = Math.max(1, Math.round(heightPx / lineHeight));
                const oldLines = this.scopeHeights.get(key) || 1;

                if (lines !== oldLines) {
                  this.scopeHeights.set(key, lines);
                  heightsChanged = true;
                  // console.log(`[Sticky] Height changed for ${key}: ${oldLines} -> ${lines}`);
                }
              }
            });

            if (heightsChanged) {
              // Re-run update with new heights to correct offsets and positioning
              // Use requestAnimationFrame to avoid synchronous layout thrashing loop
              requestAnimationFrame(() => this.updateStickyHeader(true));
            }
          }

          // Remember overlay height for the next sampling pass so that
          // detection uses a stable value and avoids jitter at boundaries.
          this.lastOverlayHeight = effectiveHeight;
          // Smooth sampling height: grow immediately, shrink at most one line per update
          if (effectiveHeight > this.lastOverlaySampleHeight) {
            this.lastOverlaySampleHeight = effectiveHeight;
          } else if (effectiveHeight < this.lastOverlaySampleHeight) {
            this.lastOverlaySampleHeight = Math.max(effectiveHeight, this.lastOverlaySampleHeight - lineHeight);
          }
        }

        update(update) {
          // Re-render on document changes (syntax tree may have changed)
          if (update.docChanged) {
            // Clear slots on document change to force re-evaluation
            this.slots.clearAll();
            this.updateStickyHeader();
          }
          // Theme change marker: refresh overlay background
          const themeChanged = update.transactions && update.transactions.some((tr) =>
            tr.annotation && tr.annotation(CM.Transaction.userEvent) === 'setTheme'
          );
          if (themeChanged) {
            // Allow the theme reconfigure to apply, then sample
            requestAnimationFrame(() => this.syncBackgroundColor());
          }
        }

        destroy() {
          this.view.scrollDOM.removeEventListener('scroll', this.scrollHandler);
          this.dom.remove();
          if (cmComponent && cmComponent._stickyScrollPlugin === this) {
            cmComponent._stickyScrollPlugin = null;
          }
        }
      });

      // Extension array - theme + plugin
      const stickyScrollExtension = [
        stickyScrollTheme,
        stickyScrollPlugin,
      ];

      // Compartment management
      if (!this.stickyScrollCompartment) {
        this.stickyScrollCompartment = new CM.Compartment();
        // Install compartment (initially empty)
        this.editor.dispatch({
          effects: CM.StateEffect.appendConfig.of(
            this.stickyScrollCompartment.of([])
          )
        });
      }

      // Reconfigure based on enabled state
      this.editor.dispatch({
        effects: this.stickyScrollCompartment.reconfigure(
          enabled ? stickyScrollExtension : []
        )
      });

      console.log('[CodeMirror] Sticky scroll set to:', enabled);
    },
    // ============================================================================
  },
  async mounted() {
    // This is used to prevent emitting the value we just received from the server.
    this.emitting = true;

    // The Compartments are used to change the properties of the editor ("extensions") dynamically
    this.themes = { ...CM.themes, oneDark: CM.oneDark };
    this.themeConfig = new CM.Compartment();
    this.languages = CM.languages;
    this.languageConfig = new CM.Compartment();
    this.editableConfig = new CM.Compartment();
    this.editableStates = { true: CM.EditorView.editable.of(true), false: CM.EditorView.editable.of(false) };
    this.lineWrappingConfig = new CM.Compartment();

    const extensions = this.setupExtensions();

    this.editor = new CM.EditorView({
      doc: this.value,
      extensions: extensions,
      parent: this.$el,
    });

    this.resolveEditor(this.editor);

    this.setLanguage(this.language);
    this.setTheme(this.theme);
    this.setDisabled(this.disable);
    this.setLineWrapping(this.lineWrapping);
    if (typeof this.pendingFontScale === 'number') {
      this.setFontScale(this.pendingFontScale);
    }

    // Notify parent when the editor surface is interacted with (focus/click inside iframe)
    try {
      const focusHandler = () => {
        try {
          this.notifyParent('cm6-editor-focus', { focused: true });
        } catch (err) {
          console.warn('[CodeMirror] Failed to notify parent of editor focus:', err);
        }
      };
      // Track both keyboard focus and pointer interaction
      this.editor.dom.addEventListener('focusin', focusHandler);
      this.editor.dom.addEventListener('mousedown', focusHandler);
      // Stash for potential future cleanup
      this._focusHandler = focusHandler;
    } catch (err) {
      console.warn('[CodeMirror] Failed to attach editor focus handlers:', err);
    }

    // Apply initial scroll position from backend, if provided
    if (typeof this.initialScrollLine === 'number' && this.initialScrollLine > 1) {
      try {
        const doc = this.editor.state.doc;
        const maxLine = doc.lines;
        const targetLine = Math.max(1, Math.min(this.initialScrollLine, maxLine));
        const line = doc.line(targetLine);
        this.editor.dispatch({
          selection: { anchor: line.from },
          scrollIntoView: true,
        });
        console.log('[CodeMirror] Initial scroll to line', targetLine);
      } catch (err) {
        console.warn('[CodeMirror] Failed to apply initial scroll line:', err);
      }
    }

    // Initialize layout detection for minimap
    const mql = window.matchMedia('(max-width: 900px)');
    this.isMobileLayout = mql.matches;
    mql.addEventListener('change', this.handleLayoutChange);

    // Initialize diff compartments BEFORE minimap so minimap can reference diffField
    // This ensures proper dependency order - minimap needs diffField to exist
    this.initDiffCompartments();

    // Apply initial minimap state (now diffField exists for minimap to reference)
    this.updateMinimapState();
  },
};
