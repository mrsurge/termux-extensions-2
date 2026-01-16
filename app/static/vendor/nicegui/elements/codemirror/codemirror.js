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
const DEBUG_STICKY = false; // set true for sticky scroll logging

class SocketIOTransport {
  constructor(namespace, languageId, projectRoot, initExtra) {
    this.socket = null;
    this.onMessage = null;
    this._readyResolve = null;
    this._readyReject = null;
    this.ready = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });

    this._lspInitResolve = null;
    this._lspInitReject = null;
    this.lspInitialized = new Promise((resolve, reject) => {
      this._lspInitResolve = resolve;
      this._lspInitReject = reject;
    });

    try {
      if (!_io) {
        console.warn('[LSP] socket.io client (io) is not available in this context or parent window');
        this._readyReject?.(new Error('socket.io client not available'));
        return;
      }

      console.log('[LSP] Creating socket connection to namespace:', namespace);
      console.log('[LSP] _io type:', typeof _io, '_io:', _io);

      this.socket = _io(namespace, {
        path: "/ui/_nicegui_ws/socket.io",
        transports: ["websocket"],
        query: { app_id: 'file_editor_cm6' },
      });

      console.log('[LSP] Socket created:', this.socket);
      console.log('[LSP] Socket connected?:', this.socket?.connected);

      this._initPayload = Object.assign({
        languageId: languageId,
        projectRoot: projectRoot,
      }, (initExtra && typeof initExtra === 'object') ? initExtra : {});

      this.socket.on('connect', () => {
        try {
          console.log('[LSP] Socket.IO connected, sending initialize...');
          this._readyResolve?.();
          this.socket.emit('initialize', this._initPayload);
        } catch (err) {
          console.warn('[LSP] Failed to send initialize event:', err);
        }
      });

      // Backend ack that the shell is spawned and ready to accept LSP JSON-RPC.
      this.socket.on('lsp_initialized', (data) => {
        try {
          console.log('[LSP] Backend reported lsp_initialized:', data);
          this._lspInitResolve?.(data);
        } catch (err) {
          console.warn('[LSP] Error handling lsp_initialized:', err);
        }
      });

      this.socket.on('connect_error', (err) => {
        console.error('[LSP] Socket.IO connect_error:', err);
        this._readyReject?.(err);
      });

      this.socket.on('error', (err) => {
        console.error('[LSP] Socket.IO error:', err);
      });

      // NOTE: Don't register lsp:server_to_client handler here.
      // The cmTransport adapter will register its own handler that properly converts
      // Socket.IO objects to JSON strings for @codemirror/lsp-client.
    } catch (err) {
      console.warn('[LSP] Failed to initialize SocketIOTransport:', err);
      this.socket = null;
      this._readyReject?.(err);
    }
  }

  send(data) {
    if (!this.socket) return;
    try {
      console.log('[LSP] Sending to server:', typeof data, data);
      this.socket.emit('lsp_client_to_server', data);
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

// ---------------------------------------------------------------------------
// LSP Request Broker
//
// Manages LSP request coalescing to prevent flooding the server/bridge.
// Features:
// - Per-method debouncing (different delays for different request types)
// - Max-1-in-flight per method (new requests replace pending ones)
// - Stale response detection via nonces
// - Request instrumentation counters for debugging
// ---------------------------------------------------------------------------
class LSPRequestBroker {
  constructor() {
    // In-flight request tracking: method -> { nonce, promise }
    this._inFlight = new Map();
    // Pending (debounced) requests: method -> { nonce, timeoutId, resolve, reject, params }
    this._pending = new Map();
    // Request nonce counter
    this._nonceCounter = 0;
    // Debounce delays per method (ms)
    this._debounceDelays = {
      'textDocument/documentSymbol': 800,
      'textDocument/diagnostic': 600,
      'textDocument/hover': 150,
      'textDocument/completion': 100,
      // Default for unknown methods
      '_default': 50,
    };
    // Instrumentation counters
    this.stats = {
      requestsSent: 0,
      requestsDropped: 0,
      requestsCoalesced: 0,
      responsesReceived: 0,
      responsesStale: 0,
    };
  }

  /**
   * Request with coalescing. Returns a promise that resolves with the response
   * or rejects on error. If a newer request supersedes this one, the promise
   * will reject with { stale: true }.
   */
  async request(lspClient, method, params) {
    if (!lspClient) {
      return Promise.reject(new Error('LSP client not available'));
    }

    const nonce = ++this._nonceCounter;
    const delay = this._debounceDelays[method] ?? this._debounceDelays['_default'];

    // If there's already a pending (debounced) request for this method, cancel it
    const existing = this._pending.get(method);
    if (existing) {
      clearTimeout(existing.timeoutId);
      existing.reject({ stale: true, coalesced: true });
      this.stats.requestsCoalesced++;
      this._pending.delete(method);
    }

    // If there's an in-flight request, mark it as superseded (response will be ignored)
    // but don't cancel the actual network request - let it complete
    const inFlight = this._inFlight.get(method);
    if (inFlight) {
      // The in-flight request's nonce is now stale; when it returns,
      // we'll compare nonces and discard if it doesn't match
      this.stats.requestsDropped++;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        this._pending.delete(method);

        // Record this request as in-flight
        const requestPromise = this._executeRequest(lspClient, method, params, nonce);
        this._inFlight.set(method, { nonce, promise: requestPromise });

        try {
          const result = await requestPromise;
          // Check if this response is still current
          const current = this._inFlight.get(method);
          if (current && current.nonce === nonce) {
            this._inFlight.delete(method);
            this.stats.responsesReceived++;
            resolve(result);
          } else {
            // Response arrived but a newer request has superseded it
            this.stats.responsesStale++;
            reject({ stale: true });
          }
        } catch (err) {
          const current = this._inFlight.get(method);
          if (current && current.nonce === nonce) {
            this._inFlight.delete(method);
          }
          reject(err);
        }
      }, delay);

      this._pending.set(method, { nonce, timeoutId, resolve, reject, params });
    });
  }

  async _executeRequest(lspClient, method, params, nonce) {
    this.stats.requestsSent++;
    console.log(`[LSP Broker] Sending ${method} (nonce=${nonce})`);
    return lspClient.request(method, params);
  }

  /**
   * Immediately send a request without debouncing (for critical requests like didChange).
   * Still tracks in-flight status for the method.
   */
  async requestImmediate(lspClient, method, params) {
    if (!lspClient) {
      return Promise.reject(new Error('LSP client not available'));
    }

    const nonce = ++this._nonceCounter;

    // Cancel any pending debounced request for this method
    const existing = this._pending.get(method);
    if (existing) {
      clearTimeout(existing.timeoutId);
      existing.reject({ stale: true, coalesced: true });
      this.stats.requestsCoalesced++;
      this._pending.delete(method);
    }

    this._inFlight.set(method, { nonce, promise: null });
    this.stats.requestsSent++;

    try {
      const result = await lspClient.request(method, params);
      const current = this._inFlight.get(method);
      if (current && current.nonce === nonce) {
        this._inFlight.delete(method);
        this.stats.responsesReceived++;
        return result;
      } else {
        this.stats.responsesStale++;
        throw { stale: true };
      }
    } catch (err) {
      const current = this._inFlight.get(method);
      if (current && current.nonce === nonce) {
        this._inFlight.delete(method);
      }
      throw err;
    }
  }

  /**
   * Check if a request for the given method is currently in-flight.
   */
  isInFlight(method) {
    return this._inFlight.has(method);
  }

  /**
   * Cancel all pending requests (e.g., on disconnect).
   */
  cancelAll() {
    for (const [method, pending] of this._pending) {
      clearTimeout(pending.timeoutId);
      pending.reject({ cancelled: true });
    }
    this._pending.clear();
    this._inFlight.clear();
  }

  /**
   * Get instrumentation stats.
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset instrumentation stats.
   */
  resetStats() {
    this.stats = {
      requestsSent: 0,
      requestsDropped: 0,
      requestsCoalesced: 0,
      responsesReceived: 0,
      responsesStale: 0,
    };
  }
}

// Global broker instance (shared across component instances)
const lspBroker = new LSPRequestBroker();

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
	        // Defensive normalization: some upstream producers may accidentally pack
	        // multiple deleted lines into a single `text` field (containing '\n').
	        // The CM6 widget gutter can only attach one line-number marker per widget
	        // block, so we MUST split into one widget per deleted line to preserve
	        // "one deleted line number per deleted line" behavior.
	        const isDraft = (kind === 'del-draft');
	        const raw = (line.text ?? '');
	        const parts = String(raw).split(/\r?\n/);
	        for (const part of parts) {
	          // Keep empty strings as legitimate blank deleted lines.
	          deletionWidgets.push({
	            line: newLine > 0 ? newLine : 1,
	            text: part,
	            originalLine: oldLine,
	            isDraft,
	          });
	          oldLine += 1;
	        }
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
	        diffKind: widget.isDraft ? 'delete-draft' : 'delete',
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
      // Autocompletion override compartment (used for non-LSP fallbacks)
      completionCompartment: null,
      isMobileLayout: false,
      // Issues overlay state (LSP diagnostics-driven)
      issuesOverlayVisible: false,
      // LSP document version counter (for didChange notifications)
      _lspDocumentVersion: 1,
      // LSP instrumentation counters
      _lspDidChangeCount: 0,
      _lspDiagnosticsCount: 0,
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
    try {
      if (typeof this._teardownIssuesOverlay === 'function') {
        this._teardownIssuesOverlay();
      }
    } catch (err) {
      console.warn('[Issues] Error during beforeDestroy teardown:', err);
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
    try {
      if (typeof this._teardownIssuesOverlay === 'function') {
        this._teardownIssuesOverlay();
      }
    } catch (err) {
      console.warn('[Issues] Error during beforeUnmount teardown:', err);
    }
  },
  methods: {
    // -------------------------------------------------------------------
    // Issues Overlay (Diagnostics)
    // -------------------------------------------------------------------
    _isTermuxAndroidPath(p) {
      return typeof p === 'string' && p.startsWith('/data/data/com.termux/');
    },
    _issuesSeverityBucket(sev) {
      // LSP DiagnosticSeverity: 1=Error, 2=Warning, 3=Information, 4=Hint
      if (sev === 1) return 'error';
      if (sev === 2) return 'warning';
      // Semantics-first: bucket info/hint as warnings (can be refined later)
      if (sev === 3 || sev === 4) return 'warning';
      return 'warning';
    },
    _issuesSig(diag) {
      try {
        const source = diag?.source || '';
        const code = (diag && diag.code != null) ? String(diag.code) : '';
        const sev = (diag && diag.severity != null) ? String(diag.severity) : '';
        const msg = diag?.message || '';
        return `${source}|${code}|${sev}|${msg}`;
      } catch {
        return String(diag?.message || '');
      }
    },
    _ensureIssuesState() {
      if (!this._issues) {
        this._issues = {
          byUri: new Map(), // uri -> { rawDiagnostics, filteredDiagnostics, flat, counts, activeIndex, suppressed }
          currentUri: null,
        };
      }
      if (!this._issuesPendingSquigglesByUri) {
        this._issuesPendingSquigglesByUri = new Map(); // uri -> diagnostics[]
      }
      return this._issues;
    },
    _flushPendingSquiggles(uri) {
      try {
        if (!uri || !this._issuesPendingSquigglesByUri || !this._issuesSquiggleEffect || !this.editor) return;
        const pending = this._issuesPendingSquigglesByUri.get(uri);
        if (!pending) return;
        this._issuesPendingSquigglesByUri.delete(uri);
        this.applyIssueSquiggles(pending, uri);
      } catch { }
    },
    _ensureIssuesOverlayDom() {
      if (this._issuesOverlayEl || !this.editor) return;

      const el = document.createElement('div');
      el.className = 'cm-issuesOverlay';
      el.style.display = 'none';
      el.addEventListener('click', (e) => {
        // Prevent clicks from bubbling to CM and stealing focus unless user taps a control.
        e.stopPropagation();
      });

      // We want the overlay to share the CM editor theme scope, so keep it inside view.dom.
      this.editor.dom.appendChild(el);
      this._issuesOverlayEl = el;

      const position = () => {
        try {
          if (!this._issuesOverlayEl) return;
          const rect = this.editor.scrollDOM.getBoundingClientRect();
          // Keep it aligned with the editor scroll area; leave a small inset.
          const inset = 8;
          const width = Math.max(200, rect.width - inset * 2);
          this._issuesOverlayEl.style.left = `${rect.left + inset}px`;
          this._issuesOverlayEl.style.width = `${width}px`;
          this._issuesOverlayEl.style.bottom = `${inset}px`;
        } catch { }
      };

      this._issuesOverlayPositioner = position;
      try {
        window.addEventListener('resize', position);
        this.editor.scrollDOM.addEventListener('scroll', position, { passive: true });
      } catch { }
      position();
    },
    _teardownIssuesOverlay() {
      try {
        if (this._handleIssuesCmdFromHostBound) {
          window.removeEventListener('message', this._handleIssuesCmdFromHostBound);
        }
      } catch { }
      try {
        if (this._issuesOverlayPositioner) {
          window.removeEventListener('resize', this._issuesOverlayPositioner);
        }
      } catch { }
      try {
        if (this.editor && this._issuesOverlayPositioner) {
          this.editor.scrollDOM.removeEventListener('scroll', this._issuesOverlayPositioner);
        }
      } catch { }
      try {
        if (this._issuesOverlayEl && this._issuesOverlayEl.parentNode) {
          this._issuesOverlayEl.parentNode.removeChild(this._issuesOverlayEl);
        }
      } catch { }
      this._issuesOverlayEl = null;
      this._issuesOverlayPositioner = null;
      this._handleIssuesCmdFromHostBound = null;
    },
    _renderIssuesOverlay() {
      const state = this._ensureIssuesState();
      this._ensureIssuesOverlayDom();
      if (!this._issuesOverlayEl) return;

      const uri = state.currentUri;
      const entry = uri ? state.byUri.get(uri) : null;

      if (!this.issuesOverlayVisible) {
        this._issuesOverlayEl.style.display = 'none';
        return;
      }

      const total = entry?.flat?.length || 0;
      if (!uri || !entry || total === 0) {
        this._issuesOverlayEl.innerHTML = `
          <div class="cm-issuesOverlay-header">
            <div class="cm-issuesOverlay-title">Issues</div>
            <button class="cm-issuesOverlay-close" title="Close">✕</button>
          </div>
          <div class="cm-issuesOverlay-empty">No issues</div>
        `;
        this._issuesOverlayEl.style.display = '';
        const close = this._issuesOverlayEl.querySelector('.cm-issuesOverlay-close');
        if (close) close.onclick = () => { this.issuesOverlayVisible = false; this._renderIssuesOverlay(); this._emitIssuesState(); };
        return;
      }

      const idx = Math.max(0, Math.min(entry.activeIndex || 0, total - 1));
      entry.activeIndex = idx;
      const issue = entry.flat[idx];
      const lineNo = issue.startLine;

      // Group all issues on this same line for the overlay body
      const lineIssues = entry.flat.filter((it) => it.startLine === lineNo);

      // Build the "replica line" with squiggle spans
      let lineText = '';
      try {
        lineText = this.editor.state.doc.line(lineNo).text;
      } catch { }

      const escapeHtml = (s) => {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
      };

      const markers = [];
      for (const it of lineIssues) {
        const from = Math.max(0, it.startChar);
        const to = Math.max(from + 1, it.endChar);
        markers.push({ from, to, severity: it.bucket });
      }
      markers.sort((a, b) => (a.from - b.from) || (b.to - a.to));

      let out = '';
      let cursor = 0;
      for (const m of markers) {
        if (m.from > cursor) out += escapeHtml(lineText.slice(cursor, m.from));
        const seg = lineText.slice(m.from, Math.min(lineText.length, m.to));
        const cls = m.severity === 'error' ? 'cm-issuesRange cm-issuesRange-error' : 'cm-issuesRange cm-issuesRange-warning';
        out += `<span class="${cls}">${escapeHtml(seg || ' ')}</span>`;
        cursor = Math.max(cursor, m.to);
      }
      if (cursor < lineText.length) out += escapeHtml(lineText.slice(cursor));

      const header = `
        <div class="cm-issuesOverlay-header">
          <div class="cm-issuesOverlay-title">Issues</div>
          <div class="cm-issuesOverlay-nav">
            <button class="cm-issuesOverlay-prev" title="Previous">‹</button>
            <div class="cm-issuesOverlay-pos">${idx + 1}/${total}</div>
            <button class="cm-issuesOverlay-next" title="Next">›</button>
          </div>
          <button class="cm-issuesOverlay-close" title="Close">✕</button>
        </div>
      `;

      const replica = `
        <div class="cm-issuesOverlay-line">
          <div class="cm-issuesOverlay-lineNo">${lineNo}</div>
          <div class="cm-issuesOverlay-lineText">${out || '&nbsp;'}</div>
        </div>
      `;

      const rows = lineIssues.map((it) => {
        const colorClass = it.bucket === 'error' ? 'error' : 'warning';
        const msg = escapeHtml(it.message || '');
        const source = escapeHtml(it.source || '');
        const code = escapeHtml(it.code || '');
        const meta = [source, code].filter(Boolean).join(' ');
        return `
          <div class="cm-issuesOverlay-item ${colorClass}" data-sig="${escapeHtml(it.sig)}">
            <div class="cm-issuesOverlay-sev">${it.bucket === 'error' ? 'Error' : 'Warning'}</div>
            <div class="cm-issuesOverlay-msg">
              <div class="cm-issuesOverlay-msgText">${msg}</div>
              ${meta ? `<div class="cm-issuesOverlay-meta">${meta}</div>` : ''}
            </div>
            <button class="cm-issuesOverlay-dismiss" title="Dismiss">✕</button>
          </div>
        `;
      }).join('');

      this._issuesOverlayEl.innerHTML = header + replica + `<div class="cm-issuesOverlay-items">${rows}</div>`;
      this._issuesOverlayEl.style.display = '';

      const close = this._issuesOverlayEl.querySelector('.cm-issuesOverlay-close');
      const prev = this._issuesOverlayEl.querySelector('.cm-issuesOverlay-prev');
      const next = this._issuesOverlayEl.querySelector('.cm-issuesOverlay-next');
      if (close) close.onclick = () => { this.issuesOverlayVisible = false; this._renderIssuesOverlay(); this._emitIssuesState(); };
      if (prev) prev.onclick = () => this._issuesNavigate(-1);
      if (next) next.onclick = () => this._issuesNavigate(1);

      this._issuesOverlayEl.querySelectorAll('.cm-issuesOverlay-dismiss').forEach((btn) => {
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const item = btn.closest('.cm-issuesOverlay-item');
          const sig = item?.dataset?.sig;
          if (sig) this._issuesDismiss(sig);
        };
      });

      try { this._issuesOverlayPositioner?.(); } catch { }
    },
    _issuesDismiss(sig) {
      const state = this._ensureIssuesState();
      const uri = state.currentUri;
      if (!uri) return;
      const entry = state.byUri.get(uri);
      if (!entry) return;
      entry.suppressed.add(sig);
      // Re-filter on next render
      this._recomputeIssuesForUri(uri);
      try {
        if (state.currentUri === uri) {
          this.applyIssueSquiggles(entry.filteredDiagnostics || []);
        }
      } catch { }
      this._renderIssuesOverlay();
      this._emitIssuesState();
    },
    _issuesNavigate(delta) {
      const state = this._ensureIssuesState();
      const uri = state.currentUri;
      if (!uri) return;
      const entry = state.byUri.get(uri);
      if (!entry || !entry.flat || entry.flat.length === 0) return;

      const total = entry.flat.length;
      const nextIdx = Math.max(0, Math.min((entry.activeIndex || 0) + delta, total - 1));
      entry.activeIndex = nextIdx;
      const issue = entry.flat[nextIdx];
      this._jumpToIssue(issue);
      this._renderIssuesOverlay();
      this._emitIssuesState();
    },
    _jumpToIssue(issue) {
      if (!issue || !this.editor) return;
      try {
        const doc = this.editor.state.doc;
        const line = doc.line(issue.startLine);
        const pos = Math.max(line.from, Math.min(line.to, line.from + issue.startChar));
        const effects = [];
        if (CM?.EditorView?.scrollIntoView) {
          effects.push(CM.EditorView.scrollIntoView(pos, { y: 'center' }));
        }
        this.editor.dispatch({
          selection: { anchor: pos, head: pos },
          effects: effects.length ? effects : undefined,
        });
      } catch { }
    },
    _recomputeIssuesForUri(uri) {
      const state = this._ensureIssuesState();
      const entry = state.byUri.get(uri);
      if (!entry) return;

      const suppressed = entry.suppressed || new Set();
      const raw = []
        .concat(Array.isArray(entry.rawDiagnostics) ? entry.rawDiagnostics : [])
        .concat(Array.isArray(entry.localDiagnostics) ? entry.localDiagnostics : []);
      const filtered = raw.filter((d) => !suppressed.has(this._issuesSig(d)));
      entry.filteredDiagnostics = filtered;

      const flat = [];
      let errors = 0;
      let warnings = 0;
      for (const d of filtered) {
        const bucket = this._issuesSeverityBucket(d?.severity);
        if (bucket === 'error') errors++;
        else warnings++;
        const startLine = (d?.range?.start?.line ?? 0) + 1;
        const startChar = (d?.range?.start?.character ?? 0);
        const endChar = (d?.range?.end?.character ?? startChar + 1);
        flat.push({
          bucket,
          message: d?.message || '',
          source: d?.source || '',
          code: (d && d.code != null) ? String(d.code) : '',
          sig: this._issuesSig(d),
          startLine,
          startChar,
          endChar,
        });
      }

      const sevScore = (b) => (b === 'error' ? 0 : 1);
      flat.sort((a, b) => (sevScore(a.bucket) - sevScore(b.bucket)) || (a.startLine - b.startLine) || (a.startChar - b.startChar));

      entry.flat = flat;
      entry.counts = { errors, warnings };
      if (entry.activeIndex == null) entry.activeIndex = 0;
      if (entry.activeIndex >= flat.length) entry.activeIndex = Math.max(0, flat.length - 1);
    },
    _emitIssuesState() {
      const state = this._ensureIssuesState();
      const uri = state.currentUri;
      const entry = uri ? state.byUri.get(uri) : null;
      const counts = entry?.counts || { errors: 0, warnings: 0 };
      const total = entry?.flat?.length || 0;
      const activeIndex = entry?.activeIndex || 0;
      try {
        this.notifyParent('cm6-issues-state', {
          uri,
          errors: counts.errors || 0,
          warnings: counts.warnings || 0,
          total,
          activeIndex,
          overlayVisible: !!this.issuesOverlayVisible,
        });
      } catch { }
    },
    handlePublishDiagnostics(params) {
      const state = this._ensureIssuesState();
      const uri = params?.uri;
      if (typeof uri !== 'string' || !uri) return;
      const diagnostics = Array.isArray(params?.diagnostics) ? params.diagnostics : [];

      // Debug: log URI comparison for diagnostics
      const uriMatch = state.currentUri === uri;
      console.log(`[Issues] publishDiagnostics: incoming=${uri} current=${state.currentUri} match=${uriMatch} count=${diagnostics.length}`);

      let entry = state.byUri.get(uri);
      if (!entry) {
        entry = {
          rawDiagnostics: [],
          localDiagnostics: [],
          filteredDiagnostics: [],
          flat: [],
          counts: { errors: 0, warnings: 0 },
          activeIndex: 0,
          suppressed: new Set(),
        };
        state.byUri.set(uri, entry);
      }

      entry.rawDiagnostics = diagnostics;
      this._recomputeIssuesForUri(uri);

      // If this diagnostics update is for the currently open file, update overlay + host chrome.
      // Also try URI normalization for servers that return different URI formats (e.g., Kotlin)
      const normalizedIncoming = uri.replace(/^file:\/\/\//, 'file://').replace(/^file:\/([^/])/, 'file:///$1');
      const normalizedCurrent = (state.currentUri || '').replace(/^file:\/\/\//, 'file://').replace(/^file:\/([^/])/, 'file:///$1');
      const isMatch = (state.currentUri === uri) || (normalizedIncoming === normalizedCurrent);
      
      if (isMatch) {
        // Apply squiggle decorations directly (do not rely on CM's lint plumbing,
        // which can drop diagnostics due to version/file mapping mismatches).
        try {
          this.applyIssueSquiggles(entry.filteredDiagnostics || [], uri);
        } catch (err) {
          console.warn('[Issues] Failed to apply squiggles:', err);
        }
        this._renderIssuesOverlay();
        this._emitIssuesState();
      } else {
        console.log(`[Issues] URI mismatch - skipping overlay update. normalized: incoming=${normalizedIncoming} current=${normalizedCurrent}`);
      }
    },
    setLocalDiagnosticsForUri(uri, diagnostics) {
      try {
        const state = this._ensureIssuesState();
        if (typeof uri !== 'string' || !uri) return;
        const diags = Array.isArray(diagnostics) ? diagnostics : [];

        let entry = state.byUri.get(uri);
        if (!entry) {
          entry = {
            rawDiagnostics: [],
            localDiagnostics: [],
            filteredDiagnostics: [],
            flat: [],
            counts: { errors: 0, warnings: 0 },
            activeIndex: 0,
            suppressed: new Set(),
          };
          state.byUri.set(uri, entry);
        }

        entry.localDiagnostics = diags;
        this._recomputeIssuesForUri(uri);

        const isMatch = (state.currentUri === uri);
        if (isMatch) {
          this.applyIssueSquiggles(entry.filteredDiagnostics || [], uri);
          this._renderIssuesOverlay();
          this._emitIssuesState();
        }
      } catch { }
    },
    applyIssueSquiggles(diagnostics, uri = null) {
      const diags = Array.isArray(diagnostics) ? diagnostics : [];
      const targetUri = uri || (this._issues?.currentUri || null);

      // If the editor/effect isn't ready yet (rare timing), queue and apply later.
      if (!this.editor || !this._issuesSquiggleEffect) {
        try {
          if (targetUri && this._issuesPendingSquigglesByUri) {
            this._issuesPendingSquigglesByUri.set(targetUri, diags);
          }
        } catch { }
        return;
      }
      try {
        this.editor.dispatch({
          effects: this._issuesSquiggleEffect.of(diags),
        });
      } catch (err) {
        console.warn('[Issues] Squiggle dispatch failed:', err);
      }
    },
    _handleIssuesCmdFromHost(event) {
      try {
        if (!event || !event.data) return;
        if (window.parent && window.parent !== window && event.source && event.source !== window.parent) return;
        if (event.data.type !== 'issues_cmd') return;
        const payload = event.data.data || {};
        const action = payload.action;
        if (action === 'toggle') {
          this.issuesOverlayVisible = !this.issuesOverlayVisible;
          this._renderIssuesOverlay();
          this._emitIssuesState();
        } else if (action === 'next') {
          this.issuesOverlayVisible = true;
          this._issuesNavigate(1);
        } else if (action === 'prev') {
          this.issuesOverlayVisible = true;
          this._issuesNavigate(-1);
        } else if (action === 'dump') {
          const requestId = payload.requestId || null;
          const state = this._ensureIssuesState();
          const uri = state.currentUri;
          const entry = uri ? state.byUri.get(uri) : null;
          const dump = {
            exported_at: new Date().toISOString(),
            uri: uri || '',
            lsp_language_id: this._lspLanguageId || '',
            lsp_file_uri: this._lspFileUri || '',
            counts: entry?.counts || { errors: 0, warnings: 0 },
            total: entry?.flat?.length || 0,
            activeIndex: entry?.activeIndex || 0,
            rawDiagnostics: entry?.rawDiagnostics || [],
            filteredDiagnostics: entry?.filteredDiagnostics || [],
            flat: entry?.flat || [],
            suppressed: Array.from(entry?.suppressed || []),
            lsp_stats: (typeof this.getLspStats === 'function') ? this.getLspStats() : {},
          };
          this.notifyParent('cm6-issues-dump', { requestId, dump });
        }
      } catch { }
    },
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
            this.indentUnitCompartment.reconfigure(CM.indentUnit.of('    ')),
          ]
        });
        this.applyCompletionFallback();
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
        this.applyCompletionFallback();
      });
    },
    // Provide a light-weight autocomplete fallback for languages where we may be
    // running without LSP (or where the language mode doesn't provide rich data).
    //
    // IMPORTANT: When an LSP client is connected, we do NOT install an override,
    // because it can suppress LSP completion providers.
    applyCompletionFallback() {
      if (!this.editor) return;

      if (!this.completionCompartment) {
        // Installed in setupExtensions(); if we missed it for any reason,
        // bail without breaking the editor.
        return;
      }

      // If LSP is active, don't override completion sources.
      if (this.lspClient) {
        try {
          this.editor.dispatch({ effects: this.completionCompartment.reconfigure([]) });
        } catch {}
        return;
      }

      const lang = (this.language || '').toLowerCase().trim();
      const autocompletion = CM && typeof CM.autocompletion === 'function' ? CM.autocompletion : null;
      if (!autocompletion) return;

      const completeFromList = (CM && typeof CM.completeFromList === 'function') ? CM.completeFromList : null;
      const completeAnyWord = (CM && typeof CM.completeAnyWord === 'function') ? CM.completeAnyWord : null;

      const keywordLists = {
        kotlin: [
          'package','import','class','interface','object','fun','val','var','typealias',
          'data','sealed','enum','annotation','companion','init',
          'public','private','protected','internal',
          'override','open','final','abstract',
          'suspend','inline','noinline','crossinline','tailrec','operator','infix',
          'const','lateinit',
          'if','else','when','for','while','do','return','break','continue',
          'try','catch','finally','throw',
          'is','in','as','this','super',
          'null','true','false',
        ],
        c: [
          'auto','break','case','char','const','continue','default','do','double','else','enum',
          'extern','float','for','goto','if','inline','int','long','register','restrict','return',
          'short','signed','sizeof','static','struct','switch','typedef','union','unsigned','void',
          'volatile','while',
        ],
        cpp: [
          'alignas','alignof','and','and_eq','asm','auto','bitand','bitor','bool','break','case','catch',
          'char','char8_t','char16_t','char32_t','class','concept','const','consteval','constexpr','constinit',
          'const_cast','continue','co_await','co_return','co_yield','decltype','default','delete','do','double',
          'dynamic_cast','else','enum','explicit','export','extern','false','float','for','friend','goto','if',
          'inline','int','long','mutable','namespace','new','noexcept','not','not_eq','nullptr','operator','or',
          'or_eq','private','protected','public','register','reinterpret_cast','requires','return','short',
          'signed','sizeof','static','static_assert','static_cast','struct','switch','template','this','thread_local',
          'throw','true','try','typedef','typeid','typename','union','unsigned','using','virtual','void','volatile',
          'wchar_t','while','xor','xor_eq','override','final',
        ],
      };

      let keywords = null;
      if (lang === 'kotlin') keywords = keywordLists.kotlin;
      else if (lang === 'c') keywords = keywordLists.c;
      else if (lang === 'cpp' || lang === 'c++') keywords = keywordLists.cpp;

      const sources = [];
      if (keywords && completeFromList) {
        sources.push(completeFromList(keywords));
      }
      if (completeAnyWord) {
        sources.push(completeAnyWord);
      }

      // Only apply an override when we actually have something to add.
      const ext = sources.length ? autocompletion({ override: sources }) : [];
      try {
        this.editor.dispatch({ effects: this.completionCompartment.reconfigure(ext ? [ext] : []) });
      } catch (err) {
        console.warn('[CodeMirror] applyCompletionFallback failed:', err);
      }
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
    emitLspStatus(state, payload) {
      try {
        const data = Object.assign({ state: state }, payload || {});
        this.notifyParent('cm6-lsp-status', data);
      } catch { }
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
      try { this.emitLspStatus('connecting', { languageId, projectRoot, filePath }); } catch { }

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

      // Reset document version counter for new connection
      this._lspDocumentVersion = 1;

      const initExtra = (typeof options === 'object' && options !== null) ? {
        baseProjectRoot: options.baseProjectRoot || '',
      } : {};
      const transport = new SocketIOTransport('/lsp', languageId, projectRoot, initExtra);
      if (!transport || !transport.socket) {
        console.warn('[LSP] SocketIOTransport not initialized; aborting LSP connect');
        return;
      }

      this.lspTransport = transport;

      // Prevent older async connect attempts from racing.
      const connectNonce = (this._lspConnectNonce = (this._lspConnectNonce || 0) + 1);

      // Defer the actual LSP JSON-RPC handshake until the backend confirms the shell is ready.
      (async () => {
        try {
          await transport.ready;
        } catch (err) {
          console.warn('[LSP] Socket.IO did not become ready:', err);
          return;
        }

        if (this._lspConnectNonce !== connectNonce) return;

        // Wait for backend "lsp_initialized" (shell spawned + pipe bridge active).
        const waitForInit = (ms) => new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('lsp_initialized timeout')), ms);
          transport.lspInitialized.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
        });

        let initOk = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (this._lspConnectNonce !== connectNonce) return;
          try {
            await waitForInit(15000 + attempt * 5000);
            initOk = true;
            break;
          } catch (err) {
            console.warn('[LSP] Waiting for lsp_initialized failed, retrying initialize...', err);
            try {
              try {
                transport.socket?.emit('initialize', transport._initPayload || { languageId, projectRoot });
              } catch { }
            } catch { }
          }
        }

        if (!initOk) {
          console.warn('[LSP] Backend never reported lsp_initialized; aborting LSP connect');
          try { this.emitLspStatus('error', { languageId, projectRoot, filePath, error: 'backend initialize timeout' }); } catch { }
          return;
        }
        try { this.emitLspStatus('backend_ready', { languageId, projectRoot, filePath }); } catch { }

        if (this._lspConnectNonce !== connectNonce) return;

        try {
          // Add extension to request hierarchical DocumentSymbol (with children) instead of flat SymbolInformation
          // This is required for nested sticky scroll to work correctly
          const hierarchicalSymbolCapability = {
            clientCapabilities: {
              window: {
                workDoneProgress: true
              },
              textDocument: {
                documentSymbol: {
                  hierarchicalDocumentSymbolSupport: true,
                  symbolKind: {
                    valueSet: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26]
                  },
                  labelSupport: true
                }
              }
            }
          };

          // @codemirror/lsp-client default request timeout is 3s, which is too short for
          // heavier servers (notably JetBrains Kotlin LSP on first startup).
          const isTermuxAndroidPath = (p) => typeof p === 'string' && p.startsWith('/data/data/com.termux/');
          const isKotlin = (String(languageId || '').toLowerCase() === 'kotlin');
          const isAndroid = isTermuxAndroidPath(projectRoot) || isTermuxAndroidPath(filePath);
          // Kotlin LSP can take a long time to answer the *first* initialize on mobile.
          // If it times out, the backend may still receive and cache the eventual response.
          const lspTimeoutMs = isKotlin ? (isAndroid ? 180000 : 60000) : 10000;
          console.log(`[LSP] Client timeout=${lspTimeoutMs}ms (languageId=${languageId}, android=${isAndroid})`);

          const lspExtensions = [];
          try {
            if (typeof CM.languageServerExtensions === 'function') {
              lspExtensions.push(...CM.languageServerExtensions());
            }
            // Some bundles don’t re-export languageServerExtensions, but do export serverDiagnostics.
            // Diagnostics are required for squiggles; add them explicitly if needed.
            if (!lspExtensions.length && typeof CM.serverDiagnostics === 'function') {
              lspExtensions.push(CM.serverDiagnostics());
            }
          } catch (err) {
            console.warn('[LSP] Failed to load languageServerExtensions:', err);
          }
          if (!lspExtensions.length) {
            console.warn('[LSP] Diagnostics extensions not found in bundle; squiggles will not render');
          }

          // Determine effective workspace root for LSP
          // STUB: Will be replaced with HistoryStore singleton lookup
          // For now, hardcode Kotlin to use android/ subdirectory
          let effectiveRootUri = 'file://' + projectRoot;
          let effectiveWorkspaceFolders = [{ name: 'root', uri: 'file://' + projectRoot }];
          
          const lspWorkspaceOverrides = this._getLspWorkspaceOverrides(languageId, projectRoot, filePath);
          if (lspWorkspaceOverrides) {
            effectiveRootUri = lspWorkspaceOverrides.rootUri;
            effectiveWorkspaceFolders = lspWorkspaceOverrides.workspaceFolders;
            console.log(`[LSP] Using workspace override for ${languageId}: ${effectiveRootUri}`);
          }

          this.lspClient = new LSPClient({
            rootUri: effectiveRootUri,
            workspaceFolders: effectiveWorkspaceFolders,
            extensions: [hierarchicalSymbolCapability, ...lspExtensions],
            timeout: lspTimeoutMs,
          });
        } catch (err) {
          console.error('[LSP] Failed to create LanguageServerClient:', err);
          try { this.emitLspStatus('error', { languageId, projectRoot, filePath, error: String(err?.message || err) }); } catch { }
          transport.close();
          this.lspTransport = null;
          this.lspClient = null;
          return;
        }

        // LSP is now active; remove any non-LSP completion overrides.
        try { this.applyCompletionFallback(); } catch { }

        // Create a Transport adapter that @codemirror/lsp-client expects
        // It needs: send(message: string), subscribe(handler), unsubscribe(handler)
        // NOTE: @codemirror/lsp-client expects JSON STRINGS, but Socket.IO auto-parses JSON.
        // So we need to: stringify server responses before passing to handler,
        // and parse outgoing messages if they're strings (Socket.IO will re-stringify).
        // NOTE: Event names use underscores to match Python AsyncNamespace on_* handlers
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
              // Instrumentation: track all outgoing didChange notifications (from any source)
              if (payload && payload.method === 'textDocument/didChange') {
                this._lspDidChangeSentCount = (this._lspDidChangeSentCount || 0) + 1;
                // Log every 5th to reduce noise but still show activity
                if (this._lspDidChangeSentCount % 5 === 1) {
                  const version = payload.params?.textDocument?.version || '?';
                  console.log(`[LSP Stats] didChange → server: #${this._lspDidChangeSentCount}, v=${version}`);
                }
              }
              transport.socket.emit('lsp_client_to_server', payload);
            }
          },
          subscribe: (handler) => {
            transport.onMessage = handler;
            if (transport.socket) {
              transport.socket.on('lsp_server_to_client', (data) => {
                if (handler) {
                  // Tap into publishDiagnostics for the Issues Overlay state.
                  try {
                    if (data && typeof data === 'object' && data.method === 'textDocument/publishDiagnostics') {
                      // Instrumentation: track publishDiagnostics arrivals
                      this._lspDiagnosticsCount = (this._lspDiagnosticsCount || 0) + 1;
                      const diagCount = Array.isArray(data.params?.diagnostics) ? data.params.diagnostics.length : 0;
                      console.log(`[LSP Stats] publishDiagnostics received: #${this._lspDiagnosticsCount}, ${diagCount} issues`);
                      this.handlePublishDiagnostics(data.params || {});
                    }
                  } catch (err) {
                    console.warn('[Issues] Failed to handle publishDiagnostics:', err);
                  }
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
              transport.socket.off('lsp_server_to_client');
            }
          },
        };

        // Connect the client to the server - this initiates the LSP handshake
        try {
          console.log('[LSP] Connecting client to transport...');
          this.lspClient.connect(cmTransport);
          try { this.emitLspStatus('initializing', { languageId, projectRoot, filePath }); } catch { }
        } catch (err) {
          console.error('[LSP] Failed to connect LSPClient:', err);
          try { this.emitLspStatus('error', { languageId, projectRoot, filePath, error: String(err?.message || err) }); } catch { }
          transport.close();
          this.lspTransport = null;
          this.lspClient = null;
          return;
        }

        // Store connection info for document symbol requests
        // Use the provided file path or construct from project root
        this._lspFileUri = filePath ? ('file://' + filePath) : ('file://' + projectRoot + '/untitled');
        this._lspLanguageId = languageId;
        // Track current URI for the Issues Overlay
        try {
          const st = this._ensureIssuesState();
          st.currentUri = this._lspFileUri;
          // Ensure entry exists so host sees 0/0 counts immediately.
          if (!st.byUri.get(this._lspFileUri)) {
            st.byUri.set(this._lspFileUri, {
              rawDiagnostics: [],
              localDiagnostics: [],
              filteredDiagnostics: [],
              flat: [],
              counts: { errors: 0, warnings: 0 },
              activeIndex: 0,
              suppressed: new Set(),
            });
          }
          this._emitIssuesState();
          try {
            const entry = st.byUri.get(this._lspFileUri);
            this.applyIssueSquiggles(entry?.filteredDiagnostics || [], this._lspFileUri);
            this._flushPendingSquiggles(this._lspFileUri);
          } catch { }
        } catch { }

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

        // Wait for initialization then send didOpen and request document symbols
        this.lspClient.initializing.then(async () => {
          console.log('[LSP] Client initialized');
          try { this.emitLspStatus('ready', { languageId, projectRoot, filePath }); } catch { }
          try {
            if (this._lspInitRetryCount) this._lspInitRetryCount = 0;
          } catch { }

          // Open the file with the LSP client's workspace
          // This sends textDocument/didOpen with the current document content
          console.log(`[LSP] Opening file ${this._lspFileUri} with workspace`);

          try {
            // Use workspace.openFile which sends didOpen notification
            if (this.lspClient.workspace && typeof this.lspClient.workspace.openFile === 'function') {
              this.lspClient.workspace.openFile(this._lspFileUri, this._lspLanguageId, this.editor);
              console.log('[LSP] File opened via workspace.openFile');
            } else {
              // Fallback: send notification directly
              this.lspClient.notification('textDocument/didOpen', {
                textDocument: {
                  uri: this._lspFileUri,
                  languageId: this._lspLanguageId,
                  version: 1,
                  text: this.editor.state.doc.toString()
                }
              });
              console.log('[LSP] File opened via notification');
            }
          } catch (err) {
            console.warn('[LSP] didOpen failed:', err);
          }

          // Nudge: Send a didChange after didOpen to trigger diagnostics refresh.
          // This handles the reload race condition where the server already has
          // the file open and won't re-emit diagnostics on didOpen alone.
          setTimeout(() => {
            if (this.lspClient && this.lspClient.connected && this._lspFileUri) {
              try {
                this._lspDocumentVersion = (this._lspDocumentVersion || 1) + 1;
                const content = this.editor.state.doc.toString();
                this.lspClient.notification('textDocument/didChange', {
                  textDocument: {
                    uri: this._lspFileUri,
                    version: this._lspDocumentVersion,
                  },
                  contentChanges: [{ text: content }],
                });
                console.log(`[LSP] Sent diagnostics nudge (didChange v=${this._lspDocumentVersion})`);
              } catch (err) {
                console.warn('[LSP] Diagnostics nudge failed:', err);
              }
            }
          }, 500);

          // Give server time to process the file before requesting symbols
          // Use longer delay on initial load to allow server warm-up
          setTimeout(() => {
            console.log('[LSP] Requesting symbols after didOpen...');
            this.requestDocumentSymbols();
          }, 1000);

          // For Kotlin: request pull diagnostics after server has processed the file
          // (Kotlin LSP uses pull-based diagnostics, not push)
          setTimeout(() => {
            this.requestPullDiagnostics();
          }, 1500);
        }).catch((err) => {
          console.warn('[LSP] Client initialization failed:', err);
          try { this.emitLspStatus('error', { languageId, projectRoot, filePath, error: String(err?.message || err) }); } catch { }

          // Kotlin-only: one retry helps in cases where the first initialize
          // times out but the server eventually responds (backend caches it),
          // so a second connect succeeds immediately.
          try {
            const isKotlin = (String(languageId || '').toLowerCase() === 'kotlin');
            this._lspInitRetryCount = this._lspInitRetryCount || 0;
            if (isKotlin && this._lspInitRetryCount < 1 && this._lspConnectNonce === connectNonce) {
              this._lspInitRetryCount++;
              console.log('[LSP] Kotlin initialize failed; retrying connect once...');
              setTimeout(() => {
                if (this._lspConnectNonce !== connectNonce) return;
                try { this.disconnectLSP(); } catch { }
                try { this.connectLSP({ languageId, projectRoot, filePath }); } catch { }
              }, 1500);
            }
          } catch { }
        });
      })();

      // Set up debounced symbol refresh on document changes
      // Note: The broker adds its own 800ms debounce, so we use a shorter delay here
      // to allow the broker to coalesce rapid requests effectively
      if (!this._symbolRefreshDebounce) {
        this._symbolRefreshDebounce = this._debounce(() => {
          this.requestDocumentSymbols();
        }, 300);
      }

      // Set up debounced pull diagnostics refresh for Kotlin
      // Use longer delay (1500ms) to ensure didChange is processed first
      if (!this._pullDiagnosticsDebounce) {
        this._pullDiagnosticsDebounce = this._debounce(() => {
          this.requestPullDiagnostics();
        }, 1500);
      }
    },

    disconnectLSP() {
      // Cancel any pending broker requests
      lspBroker.cancelAll();
      
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
      // Restore non-LSP completion fallbacks (if any).
      try { this.applyCompletionFallback(); } catch { }
      try { this.emitLspStatus('disconnected', { languageId: this._lspLanguageId || '' }); } catch { }
      try {
        if (this._stickyScrollPlugin && typeof this._stickyScrollPlugin.updateStickyHeader === 'function') {
          this._stickyScrollPlugin.updateStickyHeader(true);
        }
      } catch (err) {
        if (DEBUG_STICKY) {
          console.warn('[StickyScroll] Failed to refresh after LSP disconnect:', err);
        }
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
      
      // Debug: log structure of first few symbols to verify hierarchy
      if (this.lspSymbols.length > 0) {
        const sample = this.lspSymbols.slice(0, 3).map(sym => ({
          name: sym.name,
          kind: sym.kind,
          hasRange: !!sym.range,
          hasLocation: !!sym.location,
          hasSelectionRange: !!sym.selectionRange,
          hasChildren: !!(sym.children && sym.children.length),
          childCount: sym.children?.length || 0,
          range: sym.range,
          location: sym.location
        }));
        console.log('[LSP] Symbol structure sample:', sample);
      }

      // Notify Sticky Scroll to recompute its model if active
      try {
        if (this._stickyScrollPlugin && typeof this._stickyScrollPlugin.updateStickyHeader === 'function') {
          this._stickyScrollPlugin.updateStickyHeader(true);
        }
      } catch (err) {
        if (DEBUG_STICKY) {
          console.warn('[StickyScroll] Failed to refresh from LSP symbols:', err);
        }
      }

      // Optional: bubble up to host iframe consumer for outline/telemetry
      try {
        // Deep clone to avoid DataCloneError with postMessage
        const clonedSymbols = JSON.parse(JSON.stringify(this.lspSymbols || []));
        this.notifyParent('cm6-document-symbols', { symbols: clonedSymbols });
      } catch (err) {
        // Host notifications are best-effort only
        console.warn('[CodeMirror] Failed to notify parent', err);
      }
    },

    // Request document symbols from the LSP server
    async requestDocumentSymbols(retryCount = 0) {
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
        // Use the broker for coalesced, debounced requests
        const symbols = await lspBroker.request(this.lspClient, 'textDocument/documentSymbol', {
          textDocument: { uri: this._lspFileUri }
        });
        this.handleDocumentSymbols(symbols);
      } catch (err) {
        // Silently ignore stale/coalesced responses - this is expected behavior
        if (err && (err.stale || err.coalesced)) {
          return;
        }
        // Don't spam errors if the server doesn't support documentSymbol
        if (err && err.code === -32601) {
          console.log('[LSP] Server does not support textDocument/documentSymbol');
        } else if (err && err.message && err.message.includes('timed out') && retryCount < 3) {
          // Retry on timeout (server may still be initializing)
          const delay = 1000 * (retryCount + 1); // 1s, 2s, 3s backoff
          console.log(`[LSP] Symbol request timed out, retrying in ${delay}ms (attempt ${retryCount + 1}/3)`);
          setTimeout(() => this.requestDocumentSymbols(retryCount + 1), delay);
        } else {
          console.warn('[LSP] Failed to request document symbols:', err);
        }
      }
    },

    // Get LSP workspace root overrides for specific languages
    // NOTE: Code CM6 now passes an effective projectRoot from the backend
    // (project-scoped SSOT via HistoryStore), so we do not hardcode per-language
    // workspace root overrides here.
    // Returns { rootUri, workspaceFolders } or null for no override
    _getLspWorkspaceOverrides(languageId, projectRoot, filePath) {
      return null;
    },

    // Request pull-based diagnostics (for servers like Kotlin LSP that don't push)
    async requestPullDiagnostics() {
      if (!this.lspClient || !this._lspFileUri) {
        return;
      }

      // Only use pull diagnostics for Kotlin (other servers use push)
      const langId = (this._lspLanguageId || '').toLowerCase();
      if (langId !== 'kotlin') {
        return;
      }

      if (!this.lspClient.connected) {
        console.log('[LSP] Client not connected, skipping pull diagnostics');
        return;
      }

      try {
        await this.lspClient.initializing;
      } catch (err) {
        console.warn('[LSP] Client initialization failed:', err);
        return;
      }

      try {
        console.log(`[LSP] Requesting pull diagnostics for ${this._lspFileUri}`);
        const result = await lspBroker.request(this.lspClient, 'textDocument/diagnostic', {
          textDocument: { uri: this._lspFileUri }
        });

        // DEBUG: Log full response
        console.log('[LSP] Pull diagnostics raw response:', JSON.stringify(result, null, 2));

        // Handle the response - can be DocumentDiagnosticReport (full or unchanged)
        // Full: { kind: 'full', items: [...diagnostics], resultId?: string }
        // Unchanged: { kind: 'unchanged', resultId: string }
        if (result && result.kind === 'full' && Array.isArray(result.items)) {
          console.log(`[LSP] Pull diagnostics received: ${result.items.length} items`);
          // Convert to publishDiagnostics format and feed into existing pipeline
          this.handlePublishDiagnostics({
            uri: this._lspFileUri,
            diagnostics: result.items,
          });
        } else if (result && result.kind === 'unchanged') {
          console.log('[LSP] Pull diagnostics unchanged');
        } else {
          console.log('[LSP] Pull diagnostics response:', result);
          // Try to handle as direct diagnostics array (some servers may return differently)
          if (Array.isArray(result)) {
            this.handlePublishDiagnostics({
              uri: this._lspFileUri,
              diagnostics: result,
            });
          }
        }
      } catch (err) {
        if (err && (err.stale || err.coalesced)) {
          return;
        }
        // Server may not support pull diagnostics (-32601 = method not found)
        if (err && err.code === -32601) {
          console.log('[LSP] Server does not support textDocument/diagnostic (pull diagnostics)');
        } else {
          console.warn('[LSP] Failed to request pull diagnostics:', err);
        }
      }
    },

    // Get LSP broker stats for debugging
    getLspBrokerStats() {
      return lspBroker.getStats();
    },

    // Reset LSP broker stats
    resetLspBrokerStats() {
      lspBroker.resetStats();
    },

    // Get all LSP stats (broker + transport counters)
    getLspStats() {
      return {
        broker: lspBroker.getStats(),
        didChangeExplicit: this._lspDidChangeCount || 0,
        didChangeSentTotal: this._lspDidChangeSentCount || 0,
        diagnosticsReceived: this._lspDiagnosticsCount || 0,
        documentVersion: this._lspDocumentVersion || 1,
      };
    },

    // Reset all LSP stats
    resetLspStats() {
      lspBroker.resetStats();
      this._lspDidChangeCount = 0;
      this._lspDidChangeSentCount = 0;
      this._lspDiagnosticsCount = 0;
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
            this.lspDebounceTimer = null;
          }
          update(update) {
            if (!update.docChanged) return;
            if (!self.emitting) return;

            // Trigger LSP symbol refresh on document changes
            if (self._symbolRefreshDebounce) {
              self._symbolRefreshDebounce();
            }

            // Send LSP didChange notification (debounced)
            // This ensures the LSP server gets document updates even if
            // @codemirror/lsp-client's auto-sync isn't working correctly
            if (this.lspDebounceTimer) {
              clearTimeout(this.lspDebounceTimer);
            }
            this.lspDebounceTimer = setTimeout(() => {
              this.lspDebounceTimer = null;
              if (self.lspClient && self._lspFileUri && self.lspClient.connected) {
                try {
                  // Use component-level version counter for consistency
                  self._lspDocumentVersion = (self._lspDocumentVersion || 1) + 1;
                  const content = update.state.doc.toString();
                  self.lspClient.notification('textDocument/didChange', {
                    textDocument: {
                      uri: self._lspFileUri,
                      version: self._lspDocumentVersion,
                    },
                    contentChanges: [{ text: content }],
                  });
                  // Track for instrumentation
                  self._lspDidChangeCount = (self._lspDidChangeCount || 0) + 1;
                  if (self._lspDidChangeCount % 10 === 1) {
                    console.log(`[LSP Stats] didChange sent (explicit): ${self._lspDidChangeCount}, version=${self._lspDocumentVersion}`);
                  }
                  // For Kotlin: trigger pull diagnostics after didChange
                  if (self._pullDiagnosticsDebounce) {
                    self._pullDiagnosticsDebounce();
                  }
                } catch (err) {
                  console.warn('[LSP] Failed to send didChange:', err);
                }
              }
            }, 150); // 150ms debounce for didChange

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
            }, 630); // Keep visible for .63 after scroll stops
          }

          destroy() {
            this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
            if (this.timeout) clearTimeout(this.timeout);
          }
        }
      );

      // Lezer-based local syntax diagnostics (cached per-URI in issues map).
      const lezerDiagnosticsPlugin = CM.ViewPlugin.fromClass(
        class {
          constructor() {
            this.timer = null;
          }
          update(update) {
            if (!update.docChanged) return;
            if (this.timer) clearTimeout(this.timer);
            this.timer = setTimeout(() => {
              this.timer = null;
              try {
                const st = self._ensureIssuesState();
                const uri = st?.currentUri || self._lspFileUri;
                if (!uri) return;

                const state = update.state;
                const tree = CM.ensureSyntaxTree(state, state.doc.length, 200) || CM.syntaxTree(state);
                if (!tree || typeof tree.iterate !== 'function') {
                  self.setLocalDiagnosticsForUri(uri, []);
                  return;
                }

                const out = [];
                const max = 50;
                const toLspPos = (pos) => {
                  const line = state.doc.lineAt(pos);
                  return { line: Math.max(0, (line.number || 1) - 1), character: Math.max(0, pos - line.from) };
                };

                tree.iterate({
                  enter: (node) => {
                    try {
                      if (out.length >= max) return;
                      if (!node?.type?.isError) return;
                      const from = Math.max(0, node.from);
                      const to = Math.max(from + 1, node.to);
                      out.push({
                        range: { start: toLspPos(from), end: toLspPos(to) },
                        severity: 2,
                        source: 'cm6-lezer',
                        code: 'SYNTAX_ERROR',
                        message: 'Syntax error (local parser)',
                      });
                    } catch { }
                  }
                });

                self.setLocalDiagnosticsForUri(uri, out);
              } catch { }
            }, 200);
          }
          destroy() {
            if (this.timer) clearTimeout(this.timer);
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
      this.completionCompartment = new CM.Compartment();

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
        lezerDiagnosticsPlugin,
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
        this.completionCompartment.of([]), // Completion override (non-LSP fallbacks)
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

      // -------------------------------------------------------------------
      // Issues squiggles (diagnostics-driven) — custom StateField pipeline.
      //
      // We intentionally do NOT rely solely on CM's built-in `serverDiagnostics()`
      // because it can ignore publishDiagnostics when version/file mapping
      // doesn't match what the LSP server emits. Our overlay uses the raw LSP
      // payload, so squiggles must follow the same ground truth.
      // -------------------------------------------------------------------
      try {
        const { StateEffect, StateField, RangeSetBuilder, Decoration, EditorView } = CM;

        this._issuesSquiggleEffect = StateEffect.define();

        const toDocPos = (state, line0, ch0) => {
          try {
            const lineNo = Math.max(1, Math.min(state.doc.lines, (Number(line0) || 0) + 1));
            const line = state.doc.line(lineNo);
            const col = Math.max(0, Number(ch0) || 0);
            return Math.max(line.from, Math.min(line.to, line.from + col));
          } catch {
            return 0;
          }
        };

        const build = (state, diags) => {
          const builder = new RangeSetBuilder();
          const arr = Array.isArray(diags) ? diags : [];

          // RangeSetBuilder requires ranges to be added in sorted order.
          // Some servers (notably Kotlin) may emit diagnostics unsorted.
          const ranges = [];
          for (const d of arr) {
            const sev = d?.severity;
            const bucket = (sev === 1) ? 'error' : (sev === 2 ? 'warning' : (sev === 3 || sev === 4 ? 'warning' : 'warning'));
            const cls = bucket === 'error' ? 'cm-issuesRange cm-issuesRange-error' : 'cm-issuesRange cm-issuesRange-warning';

            const start = d?.range?.start || {};
            const end = d?.range?.end || {};
            let from = toDocPos(state, start.line, start.character);
            let to = toDocPos(state, end.line, end.character);

            if (to < from) {
              const tmp = from; from = to; to = tmp;
            }
            // Zero-length diagnostics: underline at least one char if possible.
            if (to === from) {
              try {
                const line = state.doc.lineAt(from);
                if (from < line.to) to = from + 1;
              } catch { }
            }
            if (to > from) {
              ranges.push({ from, to, cls });
            }
          }

          ranges.sort((a, b) => (a.from - b.from) || (a.to - b.to) || (a.cls < b.cls ? -1 : (a.cls > b.cls ? 1 : 0)));
          for (const r of ranges) {
            builder.add(r.from, r.to, Decoration.mark({ class: r.cls }));
          }

          return builder.finish();
        };

        const field = StateField.define({
          create(state) {
            return Decoration.none;
          },
          update(value, tr) {
            // Keep squiggles roughly aligned through edits until refreshed by LSP.
            try {
              if (tr.docChanged && value && typeof value.map === 'function') {
                value = value.map(tr.changes);
              }
            } catch { }
            for (const ef of tr.effects) {
              if (ef.is(self._issuesSquiggleEffect)) {
                try {
                  value = build(tr.state, ef.value);
                } catch {
                  value = Decoration.none;
                }
              }
            }
            return value;
          },
          provide: (f) => EditorView.decorations.from(f),
        });

        extensions.push(field);
      } catch (err) {
        console.warn('[Issues] Failed to install squiggle field:', err);
      }

      // Squiggle styling (don’t rely on @codemirror/lint theme being active).
      // We style our own classes so decorations remain visible even when the
      // lint extension isn't installed.
      try {
        const squiggleTheme = CM.EditorView.baseTheme({
          ".cm-issuesRange": {
            textDecorationLine: "underline",
            textDecorationStyle: "wavy",
            textUnderlineOffset: "1px",
            textDecorationThickness: "1px",
          },
          ".cm-issuesRange-error": {
            textDecorationColor: "#d11",
          },
          ".cm-issuesRange-warning": {
            textDecorationColor: "orange",
          },
        });
        extensions.push(squiggleTheme);
      } catch { }

      // Issues overlay theme (iframe-owned diagnostics UI)
      try {
        const issuesTheme = CM.EditorView.baseTheme({
          ".cm-issuesOverlay": {
            position: "fixed",
            zIndex: "320",
            maxHeight: "40vh",
            overflow: "auto",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(10, 14, 20, 0.95)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 10px 18px rgba(0,0,0,0.45)",
            fontFamily: '"EditorMono", "JetBrains Mono", monospace',
          },
          ".cm-issuesOverlay-header": {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 10px 6px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            position: "sticky",
            top: "0",
            background: "rgba(10, 14, 20, 0.95)",
          },
          ".cm-issuesOverlay-title": {
            fontWeight: "600",
            opacity: "0.9",
          },
          ".cm-issuesOverlay-nav": {
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          },
          ".cm-issuesOverlay-pos": {
            opacity: "0.75",
            fontSize: "12px",
          },
          ".cm-issuesOverlay-header button": {
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
            color: "inherit",
            borderRadius: "8px",
            padding: "4px 8px",
          },
          ".cm-issuesOverlay-empty": {
            padding: "12px 10px",
            opacity: "0.75",
          },
          ".cm-issuesOverlay-line": {
            display: "grid",
            gridTemplateColumns: "52px 1fr",
            gap: "10px",
            padding: "10px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          },
          ".cm-issuesOverlay-lineNo": {
            opacity: "0.65",
            textAlign: "right",
          },
          ".cm-issuesOverlay-lineText": {
            whiteSpace: "pre",
            overflow: "hidden",
            textOverflow: "ellipsis",
          },
          ".cm-issuesOverlay-items": {
            padding: "8px 10px 12px 10px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          },
          ".cm-issuesOverlay-item": {
            display: "grid",
            gridTemplateColumns: "76px 1fr 34px",
            gap: "10px",
            alignItems: "start",
            padding: "8px 8px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.04)",
          },
          ".cm-issuesOverlay-item.error": {
            borderColor: "rgba(239, 68, 68, 0.45)",
          },
          ".cm-issuesOverlay-item.warning": {
            borderColor: "rgba(234, 179, 8, 0.40)",
          },
          ".cm-issuesOverlay-sev": {
            fontSize: "12px",
            fontWeight: "700",
            opacity: "0.9",
          },
          ".cm-issuesOverlay-item.error .cm-issuesOverlay-sev": {
            color: "#ef4444",
          },
          ".cm-issuesOverlay-item.warning .cm-issuesOverlay-sev": {
            color: "#eab308",
          },
          ".cm-issuesOverlay-msgText": {
            fontSize: "13px",
            lineHeight: "1.25",
          },
          ".cm-issuesOverlay-meta": {
            fontSize: "11px",
            opacity: "0.7",
            marginTop: "3px",
          },
          ".cm-issuesOverlay-dismiss": {
            marginLeft: "auto",
            padding: "4px 8px",
          },
        });
        extensions.push(issuesTheme);
      } catch { }

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
            top: scrollTop,
            atBottom: true,
            timestamp: Date.now(),
          });
          return;
        }

        // Get the line at actual viewport top using lineBlockAtHeight(scrollTop)
        // This is symmetrical with restore which uses scrollTop = lineBlockAt(pos).top
        let refLine;
        try {
          const block = view.lineBlockAtHeight(scrollTop);
          refLine = state.doc.lineAt(block.from).number;
        } catch {
          // Fallback to viewport.from method
          let pos = view.viewport.from;
          const ranges = view.visibleRanges;
          if (ranges && ranges.length > 0) {
            pos = ranges[0].from;
          }
          refLine = state.doc.lineAt(pos).number;
        }

        console.log('[CodeMirror] reportScrollPosition', { line: refLine, scrollTop });
        this.notifyParent('cm6-scroll-state', {
          line: refLine,
          column: 0,
          top: scrollTop,
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
	    // Updated: 2026-01-16 - Added optional scrollY:'center' (CM6 EditorView.scrollIntoView)
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
	      let scrollToTop = false; // If true, position line at viewport top (for scroll restore)
	      let scrollY = null; // Optional: 'center' uses CM6 EditorView.scrollIntoView for better UX
	      let input = payload;
	      if (payload && typeof payload === 'object') {
	        input = payload.line;
	        if (Object.prototype.hasOwnProperty.call(payload, 'focus')) {
	          shouldFocus = !!payload.focus;
	        }
	        if (Object.prototype.hasOwnProperty.call(payload, 'scrollToTop')) {
	          scrollToTop = !!payload.scrollToTop;
	        }
	        const rawScrollY = Object.prototype.hasOwnProperty.call(payload, 'scrollY')
	          ? payload.scrollY
	          : (Object.prototype.hasOwnProperty.call(payload, 'scroll_y') ? payload.scroll_y : null);
	        if (typeof rawScrollY === 'string' && rawScrollY.trim()) {
	          scrollY = rawScrollY.trim();
	        } else if (Object.prototype.hasOwnProperty.call(payload, 'center') && payload.center) {
	          scrollY = 'center';
	        }
	      }

      const line = parseInt(input, 10);
      if (isNaN(line) || line < 1) {
        console.warn('[CodeMirror] jumpToLine: invalid line number', input);
        return;
      }

      try {
        const view = this.editor;
        const doc = view.state.doc;
        const maxLine = doc.lines;
        const targetLine = Math.max(1, Math.min(line, maxLine));
        const pos = doc.line(targetLine).from;

	        if (scrollToTop) {
	          // Scroll restore mode: position target line at viewport top
	          // Use lineBlockAt to get pixel position, then set scrollTop directly
	          const lineBlock = view.lineBlockAt(pos);
	          view.scrollDOM.scrollTop = lineBlock.top;
          
          // Set selection without scrolling (we already scrolled)
          view.dispatch({
            selection: { anchor: pos }
          });
          
          // Re-initialize sticky scroll at new position to avoid rendering issues
          if (this._stickyScrollPlugin && typeof this._stickyScrollPlugin.initializeAtCurrentPosition === 'function') {
            setTimeout(() => {
              if (this._stickyScrollPlugin) {
                this._stickyScrollPlugin.initializeAtCurrentPosition();
              }
            }, 50);
          }
          
	          console.log('[CodeMirror] jumpToLine: scrolled line', targetLine, 'to top, scrollTop=', lineBlock.top);
	        } else {
	          if (scrollY === 'center' && CM?.EditorView?.scrollIntoView) {
	            // Center behavior: use CM6 recommended effect for better UX
	            view.dispatch({
	              selection: { anchor: pos },
	              effects: [CM.EditorView.scrollIntoView(pos, { y: 'center' })],
	            });
	            console.log('[CodeMirror] jumpToLine: centered line', targetLine, 'focus=', shouldFocus);
	          } else {
	            // Default behavior: scroll target line into view (minimal scroll)
	            view.dispatch({
	              selection: { anchor: pos },
	              scrollIntoView: true
	            });
	            console.log('[CodeMirror] jumpToLine: jumped to line', targetLine, 'focus=', shouldFocus);
	          }
	        }

        if (shouldFocus) {
          view.focus();
        }
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
          // Lezer's CSS grammar uses `RuleSet`/`AtRule` as the main block nodes.
          // Keep additional names for compatibility with other grammars/bundles.
          "RuleSet", "AtRule", "StyleRule", "QualifiedRule"
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

      // Kotlin scope fallback (brace-based) for legacy stream mode.
      // Kotlin in this bundle is provided via legacy clike StreamLanguage, so
      // there is no Lezer syntax tree available. When LSP documentSymbols are
      // missing/unavailable, we provide a lightweight heuristic based on braces.
      const stripKotlinLineForBraces = (text) => {
        if (!text) return "";
        // Remove line comments first.
        let s = String(text).replace(/\/\/.*$/, '');
        // Remove basic quoted strings to avoid counting braces inside them.
        // (Not perfect for triple-quoted strings, but good enough as a fallback.)
        s = s.replace(/\"([^\"\\]|\\.)*\"/g, '""');
        s = s.replace(/'([^'\\]|\\.)*'/g, "''");
        return s;
      };

      const collectKotlinScopesByBraces = (doc) => {
        const scopes = [];
        const stack = []; // {startLine, openDepth, depth, name, rawText}
        let braceDepth = 0;

        const scopeNameForLine = (text) => {
          const t = text.trim();
          // class/interface/object/enum class
          let m = t.match(/\b(enum\s+class|class|interface|object)\s+([A-Za-z_]\w*)/);
          if (m) return m[2];
          // fun (handles modifiers crudely)
          m = t.match(/\bfun\s+([A-Za-z_]\w*)\s*\(/);
          if (m) return m[1];
          return null;
        };

        for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
          const lineText = doc.line(lineNo).text || '';
          const cleaned = stripKotlinLineForBraces(lineText);

          // Detect a scope header line that opens a block on the same line.
          // If the opening brace is on the next line, this heuristic won't capture it.
          if (cleaned.includes('{')) {
            const name = scopeNameForLine(cleaned);
            if (name) {
              stack.push({
                startLine: lineNo,
                openDepth: braceDepth + 1,
                depth: braceDepth,
                name,
                rawText: lineText,
              });
            }
          }

          // Update braceDepth for this line.
          let opens = 0, closes = 0;
          for (let i = 0; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (ch === '{') opens++;
            else if (ch === '}') closes++;
          }
          braceDepth = Math.max(0, braceDepth + opens - closes);

          // Close any scopes whose brace depth is no longer active.
          while (stack.length && braceDepth < stack[stack.length - 1].openDepth) {
            const scope = stack.pop();
            scopes.push({
              startLine: scope.startLine,
              endLine: lineNo,
              depth: scope.depth,
              name: scope.name,
              rawText: scope.rawText,
            });
          }
        }

        // Close any remaining scopes to end-of-doc.
        while (stack.length) {
          const scope = stack.pop();
          scopes.push({
            startLine: scope.startLine,
            endLine: doc.lines,
            depth: scope.depth,
            name: scope.name,
            rawText: scope.rawText,
          });
        }

        return scopes;
      };

      const kotlinPathAt = (scopes, refLine) => {
        const candidates = (scopes || []).filter((s) =>
          s && typeof s.startLine === 'number' && typeof s.endLine === 'number' &&
          refLine > s.startLine && refLine <= s.endLine
        );
        candidates.sort((a, b) => (a.depth - b.depth) || (a.startLine - b.startLine));

        // Build a proper nesting path (increasing depth, within parent ranges).
        const path = [];
        for (const s of candidates) {
          if (!path.length) {
            path.push(s);
            continue;
          }
          const prev = path[path.length - 1];
          if (s.startLine >= prev.startLine && s.endLine <= prev.endLine && s.depth >= prev.depth) {
            path.push(s);
          }
        }
        return path;
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
        "@keyframes cm-sticky-enter-from-top": {
          "0%": { transform: "translateY(calc(-1 * var(--scope-height, 100%)))", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" }
        },
        ".cm-sticky-layer.entering-from-top": {
          animation: "cm-sticky-enter-from-top 150ms ease-out",
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
            const targetLayer = e.target.closest('.cm-sticky-layer');
            if (!targetLayer || !this.currentScopes.length) return;

            const index = parseInt(targetLayer.dataset.index, 10);
            if (Number.isNaN(index) || index < 0 || index >= this.currentScopes.length) return;

            const scope = this.currentScopes[index];
            if (!scope) return;

            // Resolve a document position for the scope.
            // - Lezer-backed scopes: use `node.from`
            // - LSP-backed scopes: use `startLine` (1-based) -> doc position
            let pos = null;
            try {
              if (scope.node && typeof scope.node.from === 'number') {
                pos = scope.node.from;
              } else if (typeof scope.startLine === 'number') {
                pos = view.state.doc.line(scope.startLine).from;
              }
            } catch { }
            if (pos == null) return;

            // Jump so the target line lands at the same Y position as the clicked
            // sticky row (anchored jump). This keeps the gesture feeling "local".
            //
            // IMPORTANT UX DETAIL:
            // - If the editor does NOT currently have focus (for example, the user
            //   is interacting with host chrome and doesn't want the virtual keyboard),
            //   we scroll without forcing focus/cursor movement.
            const hadFocus = typeof view.hasFocus === 'function' ? view.hasFocus() : false;
            try {
              const scrollRect = view.scrollDOM.getBoundingClientRect();
              const slotRect = targetLayer.getBoundingClientRect();
              const slotY = slotRect.top - scrollRect.top;
              const lineBlock = view.lineBlockAt(pos);

              const maxScroll = Math.max(
                0,
                view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight,
              );
              const nextTop = Math.min(
                maxScroll,
                Math.max(0, lineBlock.top - slotY),
              );
              view.scrollDOM.scrollTop = nextTop;

              if (hadFocus) {
                view.dispatch({ selection: { anchor: pos } });
                view.focus();
              }
            } catch {
              // Fallback: let CM handle scroll if geometry lookup fails.
              if (hadFocus) {
                view.dispatch({
                  selection: { anchor: pos },
                  scrollIntoView: true,
                });
                view.focus();
              } else {
                // As a last resort, just try to scroll the line into view
                // without moving cursor or focusing.
                try {
                  const lineBlock = view.lineBlockAt(pos);
                  const maxScroll = Math.max(
                    0,
                    view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight,
                  );
                  view.scrollDOM.scrollTop = Math.min(
                    maxScroll,
                    Math.max(0, lineBlock.top),
                  );
                } catch { }
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

          // Initial render - use initializeAtCurrentPosition for proper setup
          // This handles the mid-document case correctly (word wrap heights, etc.)
          this.initializeAtCurrentPosition();
          
          // Re-render after a delay to catch late-arriving LSP symbols
          setTimeout(() => this.updateStickyHeader(), 1500);
          setTimeout(() => this.updateStickyHeader(), 3000);
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

        // Get styled HTML for a given 1-based line number using highlightCode
        // to programmatically apply syntax highlighting (works for any line,
        // even if not currently in the viewport).
        getStyledLineHTML(lineNumber) {
          const view = this.view;
          const state = view.state;
          if (!state || !view) return null;
          if (lineNumber < 1 || lineNumber > state.doc.lines) return null;

          try {
            const line = state.doc.line(lineNumber);
            const lineText = line.text;

            // Get the language parser from the current editor state
            const lang = state.facet(CM.language);
            if (!lang || !lang.parser) {
              // No language configured - return escaped plain text
              return this.escapeHTML(lineText);
            }

            // Build highlighted HTML using highlightCode
            let result = "";
            const highlighter = {
              style: tags => CM.highlightingFor(state, tags)
            };

            CM.highlightCode(
              lineText,
              lang.parser.parse(lineText),
              highlighter,
              (text, cls) => {
                result += cls
                  ? `<span class="${cls}">${this.escapeHTML(text)}</span>`
                  : this.escapeHTML(text);
              },
              () => {
                // Line break callback - not needed for single line
              }
            );

            return result;
          } catch (e) {
            if (DEBUG_STICKY) {
              console.warn('[StickyScroll] highlightCode failed:', e);
            }
            // Fallback to plain text
            try {
              const line = state.doc.line(lineNumber);
              return this.escapeHTML(line.text);
            } catch {
              return null;
            }
          }
        }

        // Escape HTML special characters
        escapeHTML(text) {
          return text.replace(/[<>&]/g, ch =>
            ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&amp;'
          );
        }

        // Initialize sticky scroll at current position - clears cached state and
        // forces a clean render. Call this when enabling sticky scroll or opening
        // a file mid-document to avoid rendering issues (whitespace, empty slots).
        initializeAtCurrentPosition() {
          if (DEBUG_STICKY) {
            console.log('[StickyScroll] Initializing at current position');
          }
          
          const view = this.view;
          const state = view.state;
          const lineHeight = view.defaultLineHeight || 20;
          const wrappingEnabled = cmComponent ? cmComponent.lineWrapping : false;
          
          // Reset rendering state but KEEP scopeHeights cache - those measurements
          // are still valid and needed for word-wrap mode to avoid visual flashing
          this.slots.clear();
          this.currentScopes = [];
          // Note: NOT clearing scopeHeights - preserve height measurements
          this.lastOverlayHeight = 0;
          this.lastOverlaySampleHeight = 0;
          this.lastTopOffset = 0;
          this.lastActiveSignature = '';
          this.lastRenderKey = '';
          this.lastScrollTop = view.scrollDOM.scrollTop || 0;
          this.pendingTransitions.clear();
          
          // For word-wrap mode, pre-measure heights of lines that will be in the
          // sticky header. This avoids the flash when heights default to 1.
          if (wrappingEnabled) {
            try {
              const scrollTop = view.scrollDOM.scrollTop;
              const block = view.lineBlockAtHeight(scrollTop);
              const refLine = state.doc.lineAt(block.from).number;
              
              // Pre-measure heights for lines from start to current position
              // Only measure lines we haven't already cached
              for (let lineNo = 1; lineNo <= Math.min(refLine, state.doc.lines); lineNo++) {
                const lineObj = state.doc.line(lineNo);
                const lineBlock = view.lineBlockAt(lineObj.from);
                const heightPx = lineBlock.bottom - lineBlock.top;
                const lines = Math.max(1, Math.round(heightPx / lineHeight));
                
                // Cache height for potential scope keys at various depths
                for (let depth = 0; depth < 5; depth++) {
                  const key = `${depth}:${lineNo}`;
                  if (!this.scopeHeights.has(key)) {
                    this.scopeHeights.set(key, lines);
                  }
                }
              }
              if (DEBUG_STICKY) {
                console.log('[StickyScroll] Pre-measured heights for lines 1-' + Math.min(refLine, state.doc.lines));
              }
            } catch (err) {
              if (DEBUG_STICKY) {
                console.warn('[StickyScroll] Failed to pre-measure heights:', err);
              }
            }
          }
          
          // Clear the DOM
          this.dom.innerHTML = '';
          
          // Force a fresh render
          this.updateStickyHeader(true);
          
          // Schedule follow-up renders to catch any late layout
          setTimeout(() => this.updateStickyHeader(true), 100);
          setTimeout(() => this.updateStickyHeader(true), 500);
        }

        updateStickyHeader(isRetry = false) {
          const view = this.view;
          const state = view.state;
          const scrollTop = view.scrollDOM.scrollTop;
          const lineHeight = view.defaultLineHeight;

          // Debug: log every 50th call to verify handler is running
          if (!this._callCount) this._callCount = 0;
          this._callCount++;
          if (DEBUG_STICKY && this._callCount % 50 === 0) {
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
          const isJavaScript = langName === 'javascript' || langName === 'javascriptreact';
          const isTypeScript = langName === 'typescript' || langName === 'typescriptreact';
          const isJSLike = isJavaScript || isTypeScript;
          const isMarkdown = langName === 'markdown' || langName === 'md' || langName === 'gfm';
          const isKotlin = langName === 'kotlin';

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
            // For markdown: use earlyLines=1 when scrolling down, but also subtract 1 when
            // scrolling up to get early "release" of headers (they disappear one line sooner)
            const markdownOffset = direction < 0 ? 1 : earlyLines;
            const path = markdownPathAtSimple(sections, refLine - markdownOffset);

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
            const DEBUG_LSP_STICKY = DEBUG_STICKY; // Enable for debugging
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

            // Build ancestor path: find symbols that contain refLine, keeping hierarchy
            const findAncestorPath = (symbols, targetLine, currentPath = []) => {
              for (const sym of symbols) {
                if (!sym) continue;
                
                const range = sym.range || sym.location?.range || sym.selectionRange;
                if (!range || !range.start || typeof range.start.line !== 'number') continue;
                
                const startLine = range.start.line + 1; // LSP is 0-based
                const endLine = (range.end && typeof range.end.line === 'number') 
                  ? range.end.line + 1 
                  : startLine;
                
                // Check if this symbol contains the target line
                // Use > startLine (not >=) so scope activates AFTER its definition scrolls out
                if (targetLine > startLine && targetLine <= endLine) {
                  const newPath = [...currentPath, {
                    sym,
                    startLine,
                    endLine,
                    name: sym.name || '',
                    kind: sym.kind
                  }];
                  
                  // Recursively check children for deeper matches
                  if (Array.isArray(sym.children) && sym.children.length) {
                    const deeperPath = findAncestorPath(sym.children, targetLine, newPath);
                    if (deeperPath.length > newPath.length) {
                      return deeperPath;
                    }
                  }
                  return newPath;
                }
              }
              return currentPath;
            };

            const ancestorPath = findAncestorPath(cmComponent.lspSymbols, refLine);
            
            if (DEBUG_LSP_STICKY) {
              console.log('[LSP-Sticky] refLine:', refLine, 'symbolCount:', cmComponent.lspSymbols.length);
              // Log first few symbols to see their actual ranges
              const firstFew = cmComponent.lspSymbols.slice(0, 5).map(sym => {
                const range = sym.range || sym.location?.range || sym.selectionRange;
                return {
                  name: sym.name,
                  kind: sym.kind,
                  startLine: range?.start?.line,
                  endLine: range?.end?.line,
                  hasChildren: Array.isArray(sym.children) && sym.children.length > 0,
                  childCount: sym.children?.length || 0
                };
              });
              console.log('[LSP-Sticky] First 5 symbols:', firstFew);
              console.log('[LSP-Sticky] ancestorPath:', ancestorPath.map(p => ({ name: p.name, start: p.startLine, end: p.endLine })));
            }
            
            // For Python, drop outermost ancestors that aren't truly indent-0 (same as Lezer path)
            // For JS/TS, no filtering needed - braces define scopes, not indentation
            let filteredPath = ancestorPath;
            if (isPython && filteredPath.length > 0) {
              filteredPath = filteredPath.filter((sec, idx) => {
                if (idx !== 0) return true;
                const lineText = state.doc.line(sec.startLine).text;
                const indentMatch = lineText.match(/^([ \t]*)/);
                const indentRaw = indentMatch ? indentMatch[1] : '';
                const indentSpaces = indentRaw.replace(/\t/g, '    ').length;
                return indentSpaces === 0;
              });
            }

            // Deduplicate scopes with the same startLine (e.g., variable + anonymous class)
            // Keep the one with a more meaningful name (not <class>, <function>, etc.)
            const deduped = [];
            for (const sec of filteredPath) {
              const prev = deduped[deduped.length - 1];
              if (prev && prev.startLine === sec.startLine) {
                // Same line - prefer the one with a real name over synthetic names
                const prevIsSynthetic = /^<.*>$/.test(prev.name);
                const currIsSynthetic = /^<.*>$/.test(sec.name);
                if (prevIsSynthetic && !currIsSynthetic) {
                  // Replace synthetic with real name
                  deduped[deduped.length - 1] = sec;
                }
                // If current is synthetic or both are real, keep the previous (first one)
              } else {
                deduped.push(sec);
              }
            }
            filteredPath = deduped;

            if (DEBUG_LSP_STICKY) {
              console.log('[LSP-Sticky] filteredPath:', filteredPath.map(p => ({ name: p.name, start: p.startLine, end: p.endLine })));
            }

            let cumulativeHeight = 0;

            candidateScopes = filteredPath.map((sec, pathIdx) => {
              const depth = pathIdx; // Use path index as depth (outermost = 0)
              let startLine = sec.startLine;
              const endLine = sec.endLine;

              let lineText = state.doc.line(startLine).text;
              
              // For Python: if the startLine is a decorator (@...), skip to the def/class line
              if (isPython) {
                const trimmed = lineText.trim();
                if (trimmed.startsWith('@')) {
                  // Scan forward to find the actual def/class line
                  for (let scanLine = startLine + 1; scanLine <= Math.min(endLine, startLine + 10); scanLine++) {
                    const scanText = state.doc.line(scanLine).text.trim();
                    if (scanText.startsWith('def ') || scanText.startsWith('async def ') || scanText.startsWith('class ')) {
                      startLine = scanLine;
                      lineText = state.doc.line(scanLine).text;
                      break;
                    }
                    // Stop if we hit a non-decorator, non-empty line that isn't def/class
                    if (scanText && !scanText.startsWith('@') && !scanText.startsWith('#')) {
                      break;
                    }
                  }
                }
              }

              const indentMatch = lineText.match(/^([ \t]*)/);
              const indentRaw = indentMatch ? indentMatch[1] : '';
              const indentSpaces = indentRaw.replace(/\t/g, '    ').length;
              const indentDepth = Math.floor(indentSpaces / indentSize);

              let cachedHeight = 1;
              let offset;

              if (wrappingEnabled) {
                const key = `${depth}:${startLine}`;
                cachedHeight = this.scopeHeights.get(key) || 1;
                // Calculate offset based on cumulative height of ancestors (same as Lezer)
                offset = -(cumulativeHeight + 1);
                cumulativeHeight += cachedHeight;
              } else {
                // Simplified offset: just account for the header stack height
                // Each nested scope adds one line to the overlay
                offset = -(depth + 1);
              }

              const triggerLine = startLine + offset;
              // End trigger: use smaller offset for exit to prevent early release
              // Only offset by 1 line (for the header itself) instead of full depth
              let endTriggerLine = Math.max(startLine, endLine - 1);

              const scopeObj = {
                node: null, // LSP doesn't have syntax tree nodes
                depth,
                startLine,
                endLine,
                text: sec.name || lineText,
                rawText: lineText, // Use actual line text for syntax highlighting
                triggerLine,
                endTriggerLine,
                indentDepth,
                indentSpaces,
                height: cachedHeight
              };
              
              if (DEBUG_LSP_STICKY) {
                console.log('[LSP-Sticky] candidate scope:', {
                  depth,
                  name: sec.name,
                  startLine,
                  endLine,
                  triggerLine,
                  endTriggerLine
                });
              }
              
              return scopeObj;
            });
          } else if (isKotlin) {
            // Kotlin fallback: brace-based scopes (no Lezer tree for legacy stream mode)
            const kotlinScopes = collectKotlinScopesByBraces(state.doc);
            const path = kotlinPathAt(kotlinScopes, refLine);
            const indentSize = Math.max(1, (cmComponent && typeof cmComponent.indent === 'string') ? cmComponent.indent.length : 4);

            let cumulativeHeight = 0;
            candidateScopes = path.map((sec, pathIdx) => {
              const depth = pathIdx;
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
                offset = -(cumulativeHeight + 1);
                cumulativeHeight += cachedHeight;
              } else {
                offset = -(depth + 1);
              }

              const triggerLine = startLine + offset;
              const endTriggerLine = Math.max(startLine, endLine - 1);

              return {
                node: null,
                depth,
                startLine,
                endLine,
                text: sec.name || lineText,
                rawText: lineText,
                triggerLine,
                endTriggerLine,
                indentDepth,
                indentSpaces,
                height: cachedHeight,
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

          const DEBUG_SLOTS = DEBUG_STICKY; // Set true to log to browser_console.log

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
                let endLineObj;
                if (scope.node) {
                  // Lezer-backed: use node.to
                  endLineObj = state.doc.lineAt(scope.node.to);
                } else {
                  // LSP-backed: use endLine directly
                  endLineObj = state.doc.line(scope.endLine);
                }
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
                // Smooth sibling transition for all scope types
                this.pendingTransitions.set(scope.depth, {
                  outgoing: existing,
                  incoming: scope,
                  startTime: performance.now(),
                });
              } else {
                if (DEBUG_SLOTS) console.log('[Slots] REGISTER', { depth: scope.depth, startLine: scope.startLine });
                this.slots.register(scope);
              }
            }
          }

          // Get active scopes from slots (guaranteed no Y-axis pileup)
          let activeScopes = this.slots.getActive();

          // -------------------------------------------------------------------
          // Heuristic fix: "Double Entries" (same scope rendered twice)
          //
          // Observed symptom:
          // - Occasionally the same scope shows up twice, back-to-back, in
          //   adjacent sticky slots (most commonly on LSP-driven symbol paths).
          //
          // Root cause:
          // - Likely a deterministic timing/range edge case between symbol
          //   updates + geometry-based sampling. It's hard to reproduce and
          //   not worth risking destabilizing the core algorithm right now.
          //
          // Heuristic:
          // - Enforce unique startLine per adjacent slot by squashing
          //   consecutive scopes with the same `startLine`.
          // -------------------------------------------------------------------
          if (activeScopes.length > 1) {
            const deduped = [activeScopes[0]];
            for (let i = 1; i < activeScopes.length; i++) {
              const prev = deduped[deduped.length - 1];
              const cur = activeScopes[i];
              if (prev && cur && prev.startLine === cur.startLine) {
                continue;
              }
              deduped.push(cur);
            }
            activeScopes = deduped;
          }

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
            // Use consistent small margin for all scopes - 1 line works well
            pushMarginLines = 1;
          }
          const earlyMargin = pushMarginLines * lineHeight;

          try {
            let endBottomViewport;
            if (isMarkdown) {
              const endLineObj = state.doc.line(innermost.endLine);
              const endLineBlock = view.lineBlockAt(endLineObj.to);
              endBottomViewport = endLineBlock.bottom - scrollTop;
            } else if (innermost.node) {
              // Lezer-backed scope: use node.to for precise end position
              const endLine = state.doc.lineAt(innermost.node.to);
              const endLineBlock = view.lineBlockAt(endLine.to);
              endBottomViewport = endLineBlock.bottom - scrollTop;
            } else {
              // LSP-backed scope: use endLine directly
              const endLineObj = state.doc.line(innermost.endLine);
              const endLineBlock = view.lineBlockAt(endLineObj.to);
              endBottomViewport = endLineBlock.bottom - scrollTop;
            }
            const stackBottomViewport = headerHeight;
            const delta = endBottomViewport - stackBottomViewport;
            
            const DEBUG_PUSHUP = true;
            if (DEBUG_PUSHUP && delta < earlyMargin * 2) {
              console.log('[PushUp]', {
                scope: innermost.text?.slice(0, 40),
                depth: innermost.depth,
                startLine: innermost.startLine,
                endLine: innermost.endLine,
                endTriggerLine: innermost.endTriggerLine,
                refLine,
                delta: delta.toFixed(1),
                earlyMargin: earlyMargin.toFixed(1),
                topOffset: topOffset.toFixed(1),
                headerHeight: headerHeight.toFixed(1),
                isLSP: !innermost.node
              });
            }
            
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
            layer.style.setProperty('--scope-height', `${scopeHeightPx}px`);

            // Apply push-up transform to innermost layer (but not during entry animation)
            if (cls === 'entering-from-top' || cls === 'entering') {
              // Let CSS animation handle the transform
              layer.style.transform = '';
            } else {
              layer.style.transform = idx === lastIndex && !cls ? `translateY(${topOffset}px)` : 'translateY(0)';
            }

            // Allow height to be auto for wrapping, but set min-height
            layer.style.height = 'auto';
            layer.style.minHeight = `${lineHeight}px`;

            // Store scope key for measurement
            layer.dataset.scopeKey = `${scope.depth}:${scope.startLine}`;
            layer.dataset.index = String(idx);

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
          // Track which scopes are newly entering (for pull-down animation on scroll up)
          const newlyEntering = new Set();
          activeScopes.forEach((scope) => {
            const key = `${scope.depth}:${scope.startLine}-${scope.endLine}`;
            if (!prevActiveKeys.has(key) && direction < 0) {
              // This scope is new and we're scrolling up - animate it entering
              newlyEntering.add(scope.depth);
            }
          });

          activeScopes.forEach((scope, idx) => {
            const t = this.pendingTransitions.get(scope.depth);
            if (t && t.outgoing.startLine !== scope.startLine) {
              // Render outgoing + incoming together
              renderLayer(t.outgoing, idx, 'exiting');
              renderLayer(t.incoming, idx, 'entering');
            } else if (newlyEntering.has(scope.depth)) {
              // New scope appearing while scrolling up - animate entry from top
              renderLayer(scope, idx, 'entering-from-top');
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

      // When enabling, initialize the sticky scroll at the current position
      // to avoid rendering issues when starting mid-document
      if (enabled && this._stickyScrollPlugin && typeof this._stickyScrollPlugin.initializeAtCurrentPosition === 'function') {
        // Small delay to ensure the plugin is fully mounted
        setTimeout(() => {
          if (this._stickyScrollPlugin) {
            this._stickyScrollPlugin.initializeAtCurrentPosition();
          }
        }, 50);
      }

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
    // Position target line at viewport top (symmetrical with how we record scroll position)
    if (typeof this.initialScrollLine === 'number' && this.initialScrollLine > 1) {
      try {
        const doc = this.editor.state.doc;
        const maxLine = doc.lines;
        const targetLine = Math.max(1, Math.min(this.initialScrollLine, maxLine));
        const lineObj = doc.line(targetLine);
        
        // Use lineBlockAt to get pixel position, then set scrollTop directly
        // This is symmetrical with reportScrollPosition which uses lineBlockAtHeight
        const lineBlock = this.editor.lineBlockAt(lineObj.from);
        this.editor.scrollDOM.scrollTop = lineBlock.top;
        
        // Set selection without scrolling (we already scrolled)
        this.editor.dispatch({
          selection: { anchor: lineObj.from }
        });
        
        // Re-initialize sticky scroll at new position to avoid rendering issues
        if (this._stickyScrollPlugin && typeof this._stickyScrollPlugin.initializeAtCurrentPosition === 'function') {
          setTimeout(() => {
            if (this._stickyScrollPlugin) {
              this._stickyScrollPlugin.initializeAtCurrentPosition();
            }
          }, 100);
        }
        
        console.log('[CodeMirror] Initial scroll to line', targetLine, 'scrollTop=', lineBlock.top);
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

    // Issues overlay: install host command listener and bootstrap DOM.
    try {
      this._handleIssuesCmdFromHostBound = (e) => this._handleIssuesCmdFromHost(e);
      window.addEventListener('message', this._handleIssuesCmdFromHostBound);
      this._ensureIssuesOverlayDom();
      this._renderIssuesOverlay();
      this._emitIssuesState();
      try {
        this._flushPendingSquiggles(this._issues?.currentUri || null);
      } catch { }
    } catch (err) {
      console.warn('[Issues] Failed to initialize issues overlay:', err);
    }
  },
};
