// /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/main.js
// app/apps/file_editor_cm6/main.js
// Iframe-based NiceGUI Editor Integration

// CM6 import removed - now using NiceGUI's ui.codemirror in iframe
// import * as CM from '/static/vendor/codemirror.3/cm6.bundle.js';

import { initExplorerUI } from './static/js/explorer.js';
import { createDiffController } from './static/js/diff_decorations.js';
import { createTerminalDrawer } from './static/js/terminal.js';
import { initBranchMenu } from './static/js/git_menu.js';
import { initAgentDrawer } from './static/js/agent_drawer.js';
import ReconnectingWebSocket from './static/js/reconnecting_websocket.js';
import { initResizeManager, loadLayoutPreferences } from './static/js/resize_manager.js';

// === CM6 Code Disabled - Using NiceGUI iframe ===
// All CM6 initialization, themes, languages, and editor setup moved to NiceGUI
/*
// Core
const EditorState = CM.EditorState;
const { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, lineNumbers, Decoration, ViewPlugin, Compartment } = CM;
const defaultKeymap   = CM.defaultKeymap   || [];
const history         = CM.history         || (() => []);
const historyKeymap   = CM.historyKeymap   || [];
const searchKeymap    = CM.searchKeymap    || [];
const indentWithTab   = CM.indentWithTab   || (() => {});
const syntaxHighlighting = CM.syntaxHighlighting || (() => []);
const StreamLanguage  = CM.StreamLanguage;
const defaultHighlightStyle = CM.defaultHighlightStyle || null;
const { undo, redo, oneDark, search, openSearchPanel, termuxTheme } = CM;

// Import all available themes from the new bundle
const {
  githubDark, githubLight,
  vscodeDark, vscodeLight,
  xcodeDark, xcodeLight,
  solarizedDark, solarizedLight,
  nord, dracula, okaidia, sublime,
  androidstudio, darcula,
  basicDark, basicLight
} = CM;

const THEMES = {
  'cm6-dark': EditorView.theme({}, {dark: true}),
  'one-dark': oneDark || null,
  'termux': termuxTheme ? termuxTheme() : null,
  // GitHub themes
  'github-dark': githubDark || null,
  'github-light': githubLight || null,
  // VS Code themes
  'vscode-dark': vscodeDark || null,
  'vscode-light': vscodeLight || null,
  // Xcode themes
  'xcode-dark': xcodeDark || null,
  'xcode-light': xcodeLight || null,
  // Solarized themes
  'solarized-dark': solarizedDark || null,
  'solarized-light': solarizedLight || null,
  // Popular themes
  'nord': nord || null,
  'dracula': dracula || null,
  'okaidia': okaidia || null,
  'sublime': sublime || null,
  'androidstudio': androidstudio || null,
  'darcula': darcula || null,
  // Basic themes
  'basic-dark': basicDark || null,
  'basic-light': basicLight || null,
};

const zebraStripes = EditorView.theme({
  '& .cm-line:nth-child(even)': { 
    backgroundColor: 'rgba(128, 128, 128, 0.1)' 
  },
  '.cm-dark & .cm-line:nth-child(even)': {
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  }
});

// Languages (fallbacks are no-ops if missing in your bundle)
const javascript = CM.javascript || (() => []);
const jsonLang   = CM.json       || (() => []);
const python     = CM.python     || (() => []);
const htmlLang   = CM.html       || (() => []);
const cssLang    = CM.css        || (() => []);
const markdown   = CM.markdown   || (() => []);
const xmlLang    = CM.xml        || (() => []);

// Shell (legacy) — wrap if present in the bundle
const shellLang = () => {
  const mode = CM.shellMode;
  return (mode && CM.StreamLanguage) ? CM.StreamLanguage.define(mode) : null;
};

// ---------- Empty Line Selection Anchors (for Android native selection) ----------
// Creates invisible widgets in empty lines so Android selection can anchor properly
// Uses WORD JOINER (\u2060) which won't create line breaks

const emptyLineAnchorCompartment = new Compartment();

function createEmptyLineAnchorWidget() {
  class EmptyLineAnchor extends CM.WidgetType {
    toDOM() {
      const span = document.createElement('span');
      span.className = 'cm-empty-anchor';
      span.textContent = '\u2060'; // WORD JOINER - invisible, non-breaking
      return span;
    }
    ignoreEvent() { return false; }
  }

  const emptyLinePlugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = this.buildDecorations(view);
    }
    
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }
    
    buildDecorations(view) {
      const builder = [];
      for (let { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to;) {
          const line = view.state.doc.lineAt(pos);
          if (line.length === 0) {
            // Empty line - add anchor widget at the start
            builder.push(
              Decoration.widget({
                widget: new EmptyLineAnchor(),
                side: -1,
              }).range(line.from)
            );
          }
          pos = line.to + 1;
        }
      }
      return Decoration.set(builder);
    }
  }, {
    decorations: v => v.decorations,
  });

  return emptyLinePlugin;
}

// Initially disabled (will be enabled during native selection)
const emptyLineAnchorExtension = emptyLineAnchorCompartment.of([]);
*/
// === End of CM6 disabled code ===

// ---- host/api contract (injected by framework) ----
/* global host, api */
export default async function initFileEditor(rootEl, api, host) {

window.host = host;
window.api  = api;
const HOME_DIR = '/data/data/com.termux/files/home';
const HOME_PREFIX = `${HOME_DIR}/`;

// DOM helpers
function requireEl(selector, scope=document) {
  const el = scope.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

function initVirtualKeyboardAdjustments({ root, agentDrawer, composer, transcript, editorSurface }) {
  if (!root) return;

  const docEl = document.documentElement;
  const viewport = window.visualViewport;

  const getViewportHeight = () => {
    if (viewport) return viewport.height;
    return window.innerHeight || docEl.clientHeight || 0;
  };

  let baselineHeight = getViewportHeight() || window.innerHeight || docEl.clientHeight || 0;
  let activeContext = null; // 'agent' | 'editor' | null
  let keyboardActive = false;

  const applyClasses = () => {
    const agentActive = keyboardActive && activeContext === 'agent';
    const editorActive = keyboardActive && activeContext === 'editor';
    root.classList.toggle('keyboard-open', keyboardActive);
    root.classList.toggle('keyboard-agent', agentActive);
    root.classList.toggle('keyboard-editor', editorActive);
    root.style.height = '';
    root.style.maxHeight = '';
    root.style.overflow = '';
    if (document.body) {
      document.body.classList.toggle('keyboard-locked', keyboardActive);
    }
    if (agentDrawer) {
      agentDrawer.classList.toggle('agent-drawer--keyboard', agentActive);
    }
  };

  const scrollTranscriptToEnd = () => {
    if (!transcript) return;
    requestAnimationFrame(() => {
      transcript.scrollTop = transcript.scrollHeight;
    });
  };

  const updateInset = () => {
    const currentHeight = getViewportHeight();
    if (!currentHeight) return;

    if (!keyboardActive && currentHeight > baselineHeight) {
      baselineHeight = currentHeight;
    }

    let inset = Math.round(baselineHeight - currentHeight);
    if (inset < 0) inset = 0;

    if (inset < 80) {
      inset = 0;
      baselineHeight = currentHeight;
    }

    docEl.style.setProperty('--keyboard-inset', `${inset}px`);

    const shouldActivate = inset > 0 && activeContext !== null;
    if (shouldActivate !== keyboardActive) {
      keyboardActive = shouldActivate;
      applyClasses();
    } else if (!shouldActivate) {
      applyClasses();
    }

    if (keyboardActive && activeContext === 'agent') {
      scrollTranscriptToEnd();
    }
  };

  const setContext = (context) => {
    if (activeContext === context) return;
    activeContext = context;
    applyClasses();
    updateInset();
  };

  const clearContext = (context) => {
    if (activeContext !== context) return;
    activeContext = null;
    applyClasses();
    updateInset();
  };

  composer?.addEventListener('focus', () => setContext('agent'));
  composer?.addEventListener('pointerdown', () => setContext('agent'));
  composer?.addEventListener('blur', () => clearContext('agent'));

  if (root && editorSurface) {
    root.addEventListener('focusin', (event) => {
      if (editorSurface.contains(event.target)) {
        setContext('editor');
      }
    });

    root.addEventListener('focusout', (event) => {
      if (editorSurface.contains(event.target) && (!event.relatedTarget || !editorSurface.contains(event.relatedTarget))) {
        clearContext('editor');
      }
    });
  }

  const onViewportChange = () => updateInset();

  if (viewport) {
    viewport.addEventListener('resize', onViewportChange);
    viewport.addEventListener('scroll', onViewportChange);
  } else {
    window.addEventListener('resize', onViewportChange);
  }

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      baselineHeight = getViewportHeight() || window.innerHeight || baselineHeight;
      updateInset();
    }, 250);
  });

  updateInset();
}

const container = requireEl('#editor-container');
const editorFrame = requireEl('#editor-frame'); // Changed from cm6-host to editor-frame
const root = requireEl('.fe-root');
const agentDrawerEl = requireEl('#agent-drawer');
const agentTranscript = requireEl('#agent-transcript');
const agentComposer = requireEl('#agent-input');

// Title/status & chrome
const fileNameEl = requireEl('#fe-file-name');
const filePathEl = requireEl('#fe-file-path');
const statusEl = requireEl('#fe-status');
const editTrackerStatusEl = requireEl('#edit-tracker-status');

// Menus (ids must match template.html)
const menuFileBtn = requireEl('#menu-file-btn');
const menuFileDD  = requireEl('#menu-file-dd');
const menuEditBtn = requireEl('#menu-edit-btn');
const menuEditDD  = requireEl('#menu-edit-dd');
const menuEditorBtn = requireEl('#menu-editor-btn');
const menuEditorDD  = requireEl('#menu-editor-dd');
const menuViewBtn = requireEl('#menu-view-btn');
const menuViewDD  = requireEl('#menu-view-dd');
const menuThemeBtn= requireEl('#menu-theme-btn');
const menuThemeDD = requireEl('#menu-theme-dd');
const themeMenuItems = Array.from(menuThemeDD.querySelectorAll('[data-theme]'));


const recentFilesBtn = requireEl('#recent-files-btn');
const recentFilesDD  = requireEl('#recent-files-dd');
const miNew       = requireEl('#mi-new');
const miOpen      = requireEl('#mi-open');
const miSave      = requireEl('#mi-save');
const miSaveAs    = requireEl('#mi-saveas');
const miClose     = requireEl('#mi-close');
const miQuit      = requireEl('#mi-quit');

const miUndo      = requireEl('#mi-undo');
const miRedo      = requireEl('#mi-redo');
const miCut       = requireEl('#mi-cut');
const miCopy      = requireEl('#mi-copy');
const miPaste     = requireEl('#mi-paste');
const miSelectAll = requireEl('#mi-selectall');

const miToggleLines   = requireEl('#mi-toggle-lines');
const miToggleSyntax  = requireEl('#mi-toggle-syntax');
const miToggleCloseBrackets = requireEl('#mi-toggle-closebrackets');
const miToggleAutocomplete = requireEl('#mi-toggle-autocomplete');
const miToggleShading = requireEl('#mi-toggle-shading');
const miToggleWrap    = requireEl('#mi-toggle-wrap');
const miToggleAutosave = requireEl('#mi-toggle-autosave');
const miToggleDiffs  = requireEl('#mi-toggle-diffs');
const miTrackEdits   = requireEl('#mi-track-edits');
const miFind          = requireEl('#mi-find');
const miGoto          = requireEl('#mi-goto');

const confirmModal = requireEl('#fe-confirm');
const confirmClose = requireEl('#fe-confirm-close');
const btnDiscard   = requireEl('#fe-discard');
const btnSaveConfirm = requireEl('#fe-save-confirm');
const btnCancel    = requireEl('#fe-cancel');

initVirtualKeyboardAdjustments({
  root,
  agentDrawer: agentDrawerEl,
  composer: agentComposer,
  transcript: agentTranscript,
  editorSurface: editorFrame,
});

async function fetchDiffPayload(path) {
  if (!path) return { hunks: [], summary: { tracked: false } };
  try {
    const resp = await fetch(`/api/app/file_editor_cm6/diff?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
    const json = await resp.json();
    if (!resp.ok || json?.ok === false) {
      throw new Error(json?.error || resp.statusText || 'Diff request failed');
    }
    return json?.data || { hunks: [], summary: { tracked: true } };
  } catch (err) {
    console.error('Diff fetch failed:', err);
    return { hunks: [], summary: { tracked: false } };
  }
}

function handleDiffStatus(summary) {
  const current = statusEl.textContent || '';
  const isDiffLabel = current.startsWith('Δ ');

  if (!summary || summary.tracked === false || (!summary.added && !summary.deleted)) {
    statusEl.dataset.diffSummary = '';
    if (!unsaved && isDiffLabel) {
      statusEl.textContent = '';
    }
    return;
  }
  const label = `Δ +${summary.added || 0} −${summary.deleted || 0}`;
  statusEl.dataset.diffSummary = label;
  if (!unsaved && (isDiffLabel || !current)) {
    statusEl.textContent = label;
  }
}

const diffController = createDiffController({
  fetchDiff: fetchDiffPayload,
  onStatus: handleDiffStatus,
  getWordWrap: () => wordWrap,
});
window.__cm6Diff = diffController;

// ---------- Session telemetry ----------
async function fetchPersistedSessionState() {
  try {
    const resp = await fetch('/api/app/file_editor_cm6/session_state', { cache: 'no-store' });
    const json = await resp.json();
    if (!resp.ok || json?.ok === false) {
      throw new Error(json?.error || resp.statusText || 'Session state fetch failed');
    }
    persistedSessionSnapshot = json?.data || {};
    return persistedSessionSnapshot;
  } catch (err) {
    console.warn('Failed to load session telemetry:', err);
    persistedSessionSnapshot = null;
    return null;
  }
}

function initSessionStateContext(serverState) {
  const persisted = persistedSessionSnapshot || {};
  sessionState.activeProject = serverState?.activeProject || persisted.activeProject || null;
  sessionState.currentPath = persisted.currentPath || null;
  sessionState.unsaved = !!persisted.unsaved;
  sessionState.lastSha256 = persisted.lastSha256 || null;
  sessionState.updatedAt = persisted.updated_at || null;
  sessionStateInitialized = true;
}

function queueSessionStateUpdate(partial = null) {
  if (!sessionStateInitialized) return;
  if (partial && Object.keys(partial).length) {
    sessionState = { ...sessionState, ...partial };
  }
  sessionState.updatedAt = new Date().toISOString();
  if (sessionStateTimer) clearTimeout(sessionStateTimer);
  sessionStateTimer = setTimeout(() => flushSessionState(), 600);
}

async function flushSessionState(force = false) {
  if (!sessionStateInitialized) return;
  if (sessionStateTimer) {
    clearTimeout(sessionStateTimer);
    sessionStateTimer = null;
  } else if (!force) {
    // Nothing pending; skip.
    return;
  }
  try {
    await apiPost('session_state', sessionState);
  } catch (err) {
    console.warn('Failed to persist session telemetry:', err);
  }
}

function activeProjectPath() {
  return cachedProjectRoot || (editorState && editorState.activeProject) || sessionState.activeProject || null;
}

function syncSessionPath(extra = {}) {
  queueSessionStateUpdate({
    activeProject: activeProjectPath(),
    currentPath: currentPath || null,
    lastSha256,
    unsaved,
    ...extra,
  });
}

// ---------- Edit Tracker ----------
function connectEditTracker() {
  // Backend-only - no WebSocket needed
  // Just call the backend to enable edit tracking
  apiPost('editor/toggle_edit_tracking', { enabled: true })
    .then(() => console.log('[EditTracker] Enabled'))
    .catch(err => console.error('[EditTracker] Failed to enable:', err));
}

function disconnectEditTracker() {
  // Backend-only - no WebSocket needed
  apiPost('editor/toggle_edit_tracking', { enabled: false })
    .then(() => console.log('[EditTracker] Disabled'))
    .catch(err => console.error('[EditTracker] Failed to disable:', err));
}

function handleEditTrackerEvent(data) {
  if (data.event === 'tracking_status') {
    updateEditTrackerStatus(data);
  } else if (data.event === 'edit_tracked') {
    if (trackAgentEdits) {
      autoJumpToEdit(data.path, data.line);
    }
  }
}

function updateEditTrackerStatus(status) {
  if (status.active && status.shells && status.shells.length > 0) {
    const shellTypes = status.shells.map(s => s.type).join(', ');
    editTrackerStatusEl.textContent = `🤖 Tracking (${status.shells.length} ${shellTypes})`;
    editTrackerStatusEl.style.display = '';
  } else {
    editTrackerStatusEl.textContent = '';
    editTrackerStatusEl.style.display = 'none';
  }
}

async function autoJumpToEdit(path, line) {
  try {
    // Open file if not already open
    if (currentPath !== path) {
      await openFile(path);
    }
    
    // Wait 3 seconds for editor and file to fully load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Scroll to line and flash highlight
    if (view && line > 0) {
      const docLines = view.state.doc.lines;
      if (line <= docLines) {
        const lineObj = view.state.doc.line(line);
        const pos = lineObj.from;
        
        // Scroll into view
        view.dispatch({
          selection: { anchor: pos, head: pos },
          scrollIntoView: true,
        });
        
        // Flash highlight effect
        flashLine(line);
      }
    }
  } catch (e) {
    console.error('[EditTracker] Auto-jump failed:', e);
  }
}

function flashLine(lineNumber) {
  if (!view) return;
  
  const lineObj = view.state.doc.line(lineNumber);
  const flashDeco = CM.Decoration.line({ class: 'cm-edit-flash' });
  const decoSet = CM.RangeSetBuilder.of([flashDeco.range(lineObj.from)]);
  
  const flashField = CM.StateField.define({
    create: () => decoSet,
    update: (value) => value,
    provide: field => CM.EditorView.decorations.from(field),
  });
  
  // Add decoration
  view.dispatch({
    effects: CM.StateEffect.appendConfig.of(flashField),
  });
  
  // Remove after 1 second
  setTimeout(() => {
    try {
      view.dispatch({
        effects: CM.StateEffect.reconfigure.of([]),
      });
    } catch (e) {
      // Ignore if view is destroyed
    }
  }, 1000);
}

// ---------- small utils ----------
function simplifyAbsolute(path) {
  if (!path) return '/';
  const segments = [];
  const parts = String(path).split('/');
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (segments.length) segments.pop(); continue; }
    segments.push(part);
  }
  return '/' + segments.join('/');
}

function toAbsolute(path, base, homeDir=HOME_DIR) {
  if (!path) return simplifyAbsolute(base || homeDir);
  let value = String(path).trim();
  if (!value) return simplifyAbsolute(base || homeDir);
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return simplifyAbsolute(`${homeDir}/${value.slice(2)}`);
  if (value.startsWith('/')) return simplifyAbsolute(value);
  const origin = toAbsolute(base || homeDir, null, homeDir);
  return simplifyAbsolute(`${origin.replace(/\/+$/, '')}/${value}`);
}

function parentDir(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === '/' || abs === '') return '/';
  if (abs === HOME_DIR) return '/';
  const trimmed = abs.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  return trimmed.slice(0, idx) || '/';
}

function basename(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === '/') return '/';
  const parts = abs.split('/');
  return parts[parts.length - 1] || '/';
}

function detectLanguageFromFilename(filename) {
  if (!filename) return null;
  const parts = String(filename).toLowerCase().split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'css', less: 'css',
    html: 'html', htm: 'html',
    md: 'markdown', markdown: 'markdown',
    py: 'python', pyw: 'python',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    ksh: 'shell', csh: 'shell', tcsh: 'shell',
    xml: 'xml', svg: 'xml',
  };
  return map[ext] || null;
}

function setMenuChecked(element, checked) {
  if (!element) return;
  element.classList.toggle('fe-menu-item-checked', !!checked);
  element.setAttribute('aria-checked', checked ? 'true' : 'false');
}

function formatDisplayPath(path) {
  const abs = toAbsolute(path || HOME_DIR);
  if (abs === HOME_DIR) return '~';
  if (abs.startsWith(HOME_PREFIX)) return `~/${abs.slice(HOME_PREFIX.length)}`;
  return abs;
}

function formatDisplayDirectory(path) {
  const abs = toAbsolute(path || HOME_DIR);
  const dir = parentDir(abs);
  if (!dir || dir === abs) {
    return formatDisplayPath(abs);
  }
  return formatDisplayPath(dir);
}

// ---------- Editor state ----------
let view = null;
let currentPath = '';
let currentPathExists = false;
let lastSavedContent = '';
let unsaved = false;
let showLineNumbers = true;
let showLineShading = false; // cosmetic; not implemented for CM6 here
let showSyntaxHighlight = true;
let wordWrap = false;
let autoCloseBrackets = true;  // New: ON by default
let enableAutocompletion = true;  // New: ON by default
let autoSaveEnabled = true;
let showInlineDiffs = true;
let trackAgentEdits = false;
let currentTheme = 'cm6-dark';
let lastPickerPath = HOME_DIR;
let currentModeLanguage = null;
let cachedProjectRoot = null;
let editorState = null;
let cachedPreferences = null;
let branchMenuHandle = null;
let agentDrawerHandle = null;
let sessionState = {
  activeProject: null,
  currentPath: null,
  unsaved: false,
  lastSha256: null,
  updatedAt: null,
};
let sessionStateInitialized = false;
let sessionStateTimer = null;
let persistedSessionSnapshot = null;

// WebSocket and autosave state
let ws = null;
let editTrackerWS = null;
let clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
let explorerRefreshTimer = null;
let lastSha256 = null;
let inflightOpId = null;
let saveDebounceTimer = null;
const AUTOSAVE_DELAY = 1200; // 1200ms debounce
let lastSaveTime = 0;
const SELF_ECHO_GRACE = 300; // 300ms grace period after save

// Disabled - CM6 editor replaced with NiceGUI iframe
/*
function makeExtensions() {
  const exts = [
    history(),
    search(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    highlightActiveLine(),
    emptyLineAnchorExtension, // Add the compartment for empty line anchors
  ];
  if (showLineNumbers) exts.push(lineNumbers(), highlightActiveLineGutter());
  if (showSyntaxHighlight && defaultHighlightStyle) {
    exts.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }));
  }
  if (wordWrap) {
    exts.push(EditorView.lineWrapping);
  }
  if (showLineShading) {
    exts.push(zebraStripes);
  }
  if (autoCloseBrackets && CM.closeBrackets) {
    exts.push(CM.closeBrackets());
  }
  if (enableAutocompletion && CM.autocompletion) {
    exts.push(CM.autocompletion());
  }
  
  // Disable CM6's native double-click word selection (conflicts with our native selection)
  exts.push(EditorView.domEventHandlers({
    dblclick: (event, view) => {
      event.preventDefault();
      return true; // Mark as handled
    }
  }));

  // Theme
  const theme = THEMES[currentTheme] || THEMES['cm6-dark'];
  if (theme) exts.push(theme);

  if (diffController?.extension) {
    exts.push(diffController.extension);
  }

  // Language
  if (showSyntaxHighlight) {
    const lang = (currentModeLanguage || 'text');
    switch (lang) {
      case 'javascript': exts.push(javascript()); break;
      case 'json': exts.push(jsonLang()); break;
      case 'python': exts.push(python()); break;
      case 'html': exts.push(htmlLang()); break;
      case 'css': exts.push(cssLang()); break;
      case 'markdown': exts.push(markdown()); break;
      case 'xml': exts.push(xmlLang()); break;
      case 'shell': { const s = shellLang(); if (s) exts.push(s); } break;
      default: break;
    }
  }
  return exts;
}
*/

function createView(docText='') {
  // Disabled: CM6 editor replaced with NiceGUI iframe
  console.log('[CM6] createView() disabled - using NiceGUI iframe instead');
}

function getText() { return ''; } // Stub: content is in iframe (legacy code still calls this)
function setText(t) { console.log('[CM6] setText() disabled'); }

function markUnsaved(flag) {
  const next = !!flag;
  if (unsaved === next) {
    return;
  }
  unsaved = next;
  fileNameEl.classList.toggle('fe-unsaved', unsaved);
  syncSessionPath();
}

// ---------- API helpers ----------
async function apiGet(path) {
  const data = await api.get(path);
  // framework returns either raw or {ok,data}; normalize:
  return data.content ? data : (data.data || data);
}
async function apiPost(path, body) {
  try {
    const res = await api.post(path, body);
    return res?.data || res || {};
  } catch (error) {
    console.error(`[apiPost] Error calling ${path}:`, error);
    return {};
  }
}

function applyPreferencesFromStore(payload) {
  cachedPreferences = payload || {};
  const editorPrefs = (cachedPreferences && cachedPreferences.editor) || {};
  showLineNumbers = editorPrefs.showLineNumbers !== false;
  showLineShading = !!editorPrefs.showShading;
  showSyntaxHighlight = editorPrefs.showSyntax !== false;
  wordWrap = !!editorPrefs.wordWrap;
  autoCloseBrackets = editorPrefs.autoCloseBrackets !== false;  // Default true
  enableAutocompletion = editorPrefs.autocompletion !== false;  // Default true
  autoSaveEnabled = editorPrefs.autoSave !== false;
  showInlineDiffs = editorPrefs.showInlineDiffs !== false;
  trackAgentEdits = !!editorPrefs.trackAgentEdits;
  const themeId = editorPrefs.theme;
  currentTheme = themeId || 'cm6-dark';
  if (editorState) {
    editorState.preferences = cachedPreferences;
  }
  
  // NOTE: Do NOT sync to NiceGUI here! editor_app.py already loads correct settings
  // from preferences_store on startup. Menu toggles sync directly when changed.
}

function applyMenuState() {
  setMenuChecked(miToggleLines, showLineNumbers);
  setMenuChecked(miToggleSyntax, showSyntaxHighlight);
  setMenuChecked(miToggleCloseBrackets, autoCloseBrackets);
  setMenuChecked(miToggleAutocomplete, enableAutocompletion);
  setMenuChecked(miToggleShading, showLineShading);
  setMenuChecked(miToggleWrap, wordWrap);
  setMenuChecked(miToggleAutosave, autoSaveEnabled);
  setMenuChecked(miToggleDiffs, showInlineDiffs);
  setMenuChecked(miTrackEdits, trackAgentEdits);
}

function updateThemeMenuChecks() {
  themeMenuItems.forEach(item => {
    const isChecked = item.dataset.theme === currentTheme;
    item.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    if (isChecked) {
      item.setAttribute('data-checked', 'true');
    } else {
      item.removeAttribute('data-checked');
    }
  });
}

function mapThemeToNiceGUI(themeId) {
  const themeMap = {
    'cm6-dark': 'basicDark',
    'one-dark': 'oneDark',
    'termux': 'consoleDark',
    'github-dark': 'githubDark',
    'github-light': 'githubLight',
    'vscode-dark': 'vscodeDark',
    'vscode-light': 'vscodeLight',
    'xcode-dark': 'vscodeDark',
    'xcode-light': 'vscodeLight',
    'solarized-dark': 'solarizedDark',
    'solarized-light': 'solarizedLight',
    'nord': 'nord',
    'dracula': 'dracula',
    'okaidia': 'okaidia',
    'sublime': 'sublime',
    'androidstudio': 'androidstudio',
    'darcula': 'darcula',
    'basic-dark': 'basicDark',
    'basic-light': 'basicLight',
  };
  return themeMap[themeId] || 'oneDark';
}

async function fetchPreferencesFromServer() {
  try {
    const resp = await fetch('/api/app/file_editor_cm6/preferences', { cache: 'no-store' });
    const json = await resp.json();
    return json?.data || null;
  } catch (err) {
    console.error('Failed to fetch preferences:', err);
    return null;
  }
}

async function loadPreferences(initialPayload = null) {
  const payload = initialPayload || await fetchPreferencesFromServer();
  applyPreferencesFromStore(payload);
  diffController.setEnabled(showInlineDiffs);
  
  // Connect/disconnect edit tracker based on preference
  if (trackAgentEdits) {
    connectEditTracker();
  } else {
    disconnectEditTracker();
  }
}

async function persistEditorPreferences(partialEditor = null) {
  if (!partialEditor || Object.keys(partialEditor).length === 0) {
    return;
  }
  try {
    const data = await apiPost('preferences', { editor: partialEditor });
    if (data && typeof data === 'object') {
      cachedPreferences = data;
      if (editorState) {
        editorState.preferences = data;
      }
    }
  } catch (err) {
    console.error('Failed to persist editor preferences:', err);
  }
}

function broadcastRecentsUpdate(state) {
  if (!state) {
    return;
  }
  window.__cm6EditorState = state;
  if (typeof window.__cm6RefreshRecents === 'function') {
    try {
      window.__cm6RefreshRecents(state);
    } catch (err) {
      console.error('Failed to refresh recents dropdown:', err);
    }
  }
  window.dispatchEvent(new CustomEvent('cm6:recents-updated', { detail: state }));
}

async function syncEditorState(forceRefresh = false) {
  if (!forceRefresh && editorState) {
    return editorState;
  }
  try {
    const resp = await fetch('/api/app/file_editor_cm6/state', { cache: 'no-store' });
    const json = await resp.json();
    editorState = json?.data || {};
    cachedProjectRoot = editorState.activeProject || null;
    window.__cm6EditorState = editorState;
    return editorState;
  } catch (err) {
    console.error('Failed to fetch editor state:', err);
    editorState = null;
    cachedProjectRoot = null;
    window.__cm6EditorState = null;
    return null;
  }
}

window.__cm6SyncState = syncEditorState;

// Expose function to reload current file (for git operations)
window.__cm6ReloadCurrentFile = async function() {
  if (currentPath) {
    await openFile(currentPath);
  }
};

// Expose currentPath getter
Object.defineProperty(window, 'currentPath', {
  get: () => currentPath
});

async function ensureProjectContext() {
  const state = await syncEditorState(!cachedProjectRoot);
  if (!state || !state.activeProject || !state.activeProjectExists) {
    return null;
  }
  cachedProjectRoot = state.activeProject;
  return state;
}

// ---------- WebSocket management ----------
function closeWebSocket() {
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
}

async function openWebSocket(path) {
  closeWebSocket();
  if (!path) return;

  let wsUrl;
  try {
    if (!window.wsPort || typeof window.wsPort.buildWsUrl !== 'function') {
      throw new Error('wsPort helper unavailable');
    }
    wsUrl = await window.wsPort.buildWsUrl('file_editor_cm6', path, clientId);
  } catch (err) {
    console.error('Failed to resolve WebSocket URL:', err);
    statusEl.textContent = 'WebSocket unavailable';
    setTimeout(() => {
      if (statusEl.textContent === 'WebSocket unavailable') {
        statusEl.textContent = '';
      }
    }, 2000);
    return;
  }

  try {
    ws = new ReconnectingWebSocket(wsUrl, {
      maxRetries: 20,
      reconnectInterval: 1000,
      maxReconnectInterval: 10000,
      reconnectDecay: 1.3,
      debug: false
    });
  } catch (err) {
    console.error('Failed to open WebSocket:', err);
    statusEl.textContent = 'WebSocket unavailable';
    setTimeout(() => {
      if (statusEl.textContent === 'WebSocket unavailable') {
        statusEl.textContent = '';
      }
    }, 2000);
    return;
  }

  ws.onopen = () => {
    console.log('WebSocket connected for:', path);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWSMessage(msg);
    } catch (e) {
      console.error('Failed to parse WS message:', e);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };

  ws.onclose = () => {
    console.log('WebSocket closed');
  };
  
  ws.onreconnect = (attempt, delay) => {
    console.log(`[FileRead] Reconnecting (attempt ${attempt}) in ${delay}ms...`);
  };
}

function handleWSMessage(msg) {
  const type = msg.type;

  if (type === 'replace_full') {
    // Check if we're in grace period after save
    const timeSinceSave = Date.now() - lastSaveTime;
    const isInGracePeriod = inflightOpId || timeSinceSave < SELF_ECHO_GRACE;

    if (isInGracePeriod) {
      console.log('Ignoring replace_full during grace period');
      return;
    }

    if (msg.path) {
      const normalized = toAbsolute(msg.path, null, HOME_DIR);
      if (normalized !== currentPath) {
        currentPath = normalized;
        updatePathDisplay();
      }
    }

    // Update editor content
    const newContent = msg.content || '';
    if (getText() !== newContent) {
      setText(newContent);
      lastSavedContent = newContent;
      lastSha256 = msg.sha256 || null;
      markUnsaved(false);
      statusEl.textContent = 'Updated from disk';
      setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 2000);
      diffController.invalidateCacheForPath(currentPath);
      diffController.setContext({ path: currentPath, sha: lastSha256 });
      if (showInlineDiffs) {
        diffController.refresh(true);
      }
      // Refresh explorer on file changes (debounced)
      scheduleExplorerRefresh();
    }
  } else if (type === 'save_ack') {
    if (msg.op_id === inflightOpId) {
      inflightOpId = null;
      lastSha256 = msg.meta?.sha256 || lastSha256;
      statusEl.textContent = 'Saved';
      setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 1500);
    }
  } else if (type === 'diff_changed') {
    if (diffController && showInlineDiffs && currentPath) {
      diffController.invalidateCacheForPath(currentPath);
      diffController.refresh(true);
    }
    // Refresh explorer on file changes (debounced)
    scheduleExplorerRefresh();
  }
}

function scheduleExplorerRefresh() {
  if (explorerRefreshTimer) {
    clearTimeout(explorerRefreshTimer);
  }
  explorerRefreshTimer = setTimeout(() => {
    if (typeof window.__cm6RefreshExplorer === 'function') {
      window.__cm6RefreshExplorer().catch(err => {
        console.error('Failed to refresh explorer:', err);
      });
    }
  }, 500);
}

// ---------- File ops ----------
function updatePathDisplay() {
  if (!currentPath) {
    fileNameEl.textContent = 'Untitled';
    fileNameEl.title = 'Untitled';
    filePathEl.textContent = 'No file open';
    filePathEl.title = '';
    return;
  }
  const abs = toAbsolute(currentPath, null, HOME_DIR);
  fileNameEl.textContent = basename(abs);
  fileNameEl.title = basename(abs);
  filePathEl.textContent = formatDisplayDirectory(abs);
  filePathEl.title = abs;
}

async function openFile(path) {
  if (!path) throw new Error('Path is empty');
  statusEl.textContent = 'Opening...';
  const projectState = await ensureProjectContext();
  if (!projectState || !projectState.activeProject || !projectState.activeProjectExists) {
    statusEl.textContent = '';
    host.toast(projectState?.activeProjectMessage || 'Select a project before opening files.');
    return;
  }

  try {
    const payload = await apiGet(`read?path=${encodeURIComponent(path)}`);
    const resolved = toAbsolute(payload.path || path, null, HOME_DIR);
    currentPath = resolved;
    currentPathExists = true;
    lastPickerPath = parentDir(resolved);
    currentModeLanguage = detectLanguageFromFilename(resolved);

    // Initialize SHA256 if provided
    lastSha256 = payload.sha256 || null;

    // Send content to NiceGUI editor backend (fire and forget)
    apiPost('editor/set_content', {
      content: payload.content || '',
      path: resolved,
      language: currentModeLanguage || 'text'
    }).then(result => {
      if (result && result.sha256) {
        lastSha256 = result.sha256;
        console.log('[Editor] SHA256 initialized:', result.sha256);
        syncSessionPath();
      }
    }).catch(e => console.warn('[Editor] Failed to sync content to NiceGUI:', e));

    setText(payload.content || '');
    lastSavedContent = getText();
    markUnsaved(false);
    updatePathDisplay();
    syncSessionPath();
    statusEl.textContent = '';

    // Open WebSocket for this file
    openWebSocket(resolved);
    diffController.setContext({ path: resolved, sha: lastSha256 });
    if (showInlineDiffs) {
      diffController.refresh(true);
    }

    // Update persisted editor state (last file + recents)
    try {
      const activity = await apiPost('state/file_activity', {
        path: resolved,
        project: cachedProjectRoot || projectState.activeProject,
      });
      if (activity?.state) {
        editorState = activity.state;
        cachedProjectRoot = editorState.activeProject || cachedProjectRoot;
        broadcastRecentsUpdate(editorState);
        syncSessionPath();
      } else {
        // Fallback to a fresh pull if the payload lacked state
        const refreshed = await syncEditorState(true);
        if (refreshed) {
          broadcastRecentsUpdate(refreshed);
          sessionState.activeProject = refreshed.activeProject || sessionState.activeProject;
          syncSessionPath();
        }
      }
    } catch (err) {
      console.error('Failed to record file activity:', err);
    }
  } catch (e) {
    statusEl.textContent = '';
    host.toast(`Failed to open: ${e.message}`);
    throw e;
  }
}

async function doSave(targetPath, content) {
  const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  inflightOpId = opId;
  lastSaveTime = Date.now();

  const payload = {
    path: targetPath,
    content: content,
    client_id: clientId,
    op_id: opId
  };

  if (lastSha256) {
    payload.base = { sha256: lastSha256 };
  }

  try {
    const result = await apiPost('write', payload);
    lastSha256 = result.sha256 || lastSha256;
    lastSavedContent = content;
    markUnsaved(false);
    syncSessionPath();
    return { success: true, result };
  } catch (e) {
    inflightOpId = null;

    // Handle 409 conflict
    if (e.status === 409 || (e.response && e.response.error === 'BASE_MISMATCH')) {
      // Try to fetch latest and rebase once
      try {
        const latest = await apiGet(`read?path=${encodeURIComponent(targetPath)}`);
        lastSha256 = latest.sha256 || null;

        // Simple rebase: if our changes conflict, ask user
        if (window.confirm('File was modified externally. Retry save and overwrite?')) {
          // Retry once without base check (force overwrite)
          const retryPayload = {
            path: targetPath,
            content: content,
            client_id: clientId,
            op_id: `${opId}_retry`
          };
          const retryResult = await apiPost('write', retryPayload);
          lastSha256 = retryResult.sha256 || lastSha256;
          lastSavedContent = content;
          markUnsaved(false);
          return { success: true, result: retryResult };
        } else {
          return { success: false, error: 'Conflict - user cancelled' };
        }
      } catch (retryErr) {
        return { success: false, error: `Conflict resolution failed: ${retryErr.message}` };
      }
    }

    return { success: false, error: e.message };
  }
}

async function saveFile() {
  if (!currentPath || !currentPathExists) return saveAsDialog();
  statusEl.textContent = 'Saving...';

  // Backend-only save - no content round-trip needed
  const opId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const payload = {
    client_id: clientId,
    op_id: opId
  };
  
  if (lastSha256) {
    payload.base_sha256 = lastSha256;
  }

  try {
    const result = await apiPost('editor/save', payload);
    
    console.log('[SAVE] Response:', result);
    
    if (result.ok) {
      lastSha256 = result.data.sha256 || lastSha256;
      markUnsaved(false);
      statusEl.textContent = 'Saved';
      setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 1500);
    } else {
      console.error('[SAVE] Failed:', result.error);
      host.toast(`Save failed: ${result.error}`);
      statusEl.textContent = '';
    }
  } catch (e) {
    console.error('[SAVE] Exception:', e);
    
    // Handle 409 conflict
    if (e.status === 409 || (e.response && e.response.error === 'BASE_MISMATCH')) {
      if (window.confirm('File was modified externally. Retry save and overwrite?')) {
        // Retry without base check (force overwrite)
        const retryPayload = {
          client_id: clientId,
          op_id: `${opId}_retry`
        };
        try {
          const retryResult = await apiPost('editor/save', retryPayload);
          if (retryResult.ok) {
            lastSha256 = retryResult.data.sha256 || lastSha256;
            markUnsaved(false);
            statusEl.textContent = 'Saved';
            setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 1500);
          } else {
            host.toast(`Save failed: ${retryResult.error}`);
            statusEl.textContent = '';
          }
        } catch (retryErr) {
          host.toast(`Save failed: ${retryErr.message || 'Unknown error'}`);
          statusEl.textContent = '';
        }
      } else {
        statusEl.textContent = '';
      }
    } else {
      const errMsg = e.message || e.error || JSON.stringify(e);
      host.toast(`Save failed: ${errMsg}`);
      statusEl.textContent = '';
    }
  }
}

async function saveAsDialog() {
  const target = await pickSaveTarget();
  if (!target || !target.path) return;
  if (target.existed && !window.confirm('File exists. Overwrite?')) return;
  statusEl.textContent = 'Saving...';

  const content = await getText();
  const targetAbs = toAbsolute(target.path, null, HOME_DIR);

  // Reset SHA256 since this is a new file path
  lastSha256 = null;

  const result = await doSave(targetAbs, content);

  if (result.success) {
    currentPath = targetAbs;
    currentPathExists = true;
    lastPickerPath = parentDir(currentPath);
    currentModeLanguage = detectLanguageFromFilename(currentPath);
    updatePathDisplay();
    statusEl.textContent = 'Saved';
    setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 1500);

    // Open WebSocket for this new file
    closeWebSocket();
    openWebSocket(currentPath);
    diffController.invalidateCacheForPath(currentPath);
    diffController.setContext({ path: currentPath, sha: lastSha256 });
    if (showInlineDiffs) {
      diffController.refresh(true);
    }

    apiPost('state/file_activity', {
      path: currentPath,
      project: cachedProjectRoot || (editorState && editorState.activeProject) || undefined,
    }).then((data) => {
      if (data?.state) {
        editorState = data.state;
        cachedProjectRoot = editorState.activeProject || cachedProjectRoot;
        window.__cm6EditorState = editorState;
        if (typeof window.__cm6RefreshRecents === 'function') {
          window.__cm6RefreshRecents(editorState);
        }
      }
    }).catch(err => {
      console.error('Failed to record file activity after save-as:', err);
    });
  } else {
    host.toast(`Save failed: ${result.error}`);
    statusEl.textContent = '';
  }
}

// Autosave: debounced save
function scheduleAutosave() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  // Don't autosave if disabled OR if native selection is active (ZWSPs present)
  if (!autoSaveEnabled || nativeSelectionActive) {
    return;
  }

  saveDebounceTimer = setTimeout(() => {
    if (unsaved && currentPath && currentPathExists && !nativeSelectionActive) {
      saveFile().catch(err => {
        console.error('Autosave failed:', err);
      });
    }
  }, AUTOSAVE_DELAY);
}

// ---------- Picker helpers (shared modal provided by framework) ----------
function pickerAvailable() {
  return window.teFilePicker && typeof window.teFilePicker.openFile === 'function';
}
async function pickFile(startPath) {
  if (!pickerAvailable()) { host.toast('File picker unavailable'); return null; }
  const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath);
  const initial = toAbsolute(baseStart, null, HOME_DIR);
  try {
    const choice = await window.teFilePicker.openFile({ title:'Open File', startPath:initial, selectLabel:'Open' });
    if (choice && choice.path) { lastPickerPath = parentDir(choice.path); return choice.path; }
    return null;
  } catch (e) {
    if (e && e.message === 'cancelled') return null;
    host.toast(e?.message || 'Browse failed');
    return null;
  }
}
async function pickSaveTarget() {
  if (!pickerAvailable()) { host.toast('File picker unavailable'); return null; }
  const baseDir = currentPath ? parentDir(currentPath) : lastPickerPath;
  const initialDir = toAbsolute(baseDir, null, HOME_DIR);
  try {
    const result = await window.teFilePicker.saveFile({
      title:'Save As', startPath: initialDir, filename: currentPath ? basename(currentPath) : '', selectLabel:'Save'
    });
    return result || null;
  } catch (e) {
    if (e && e.message === 'cancelled') return null;
    host.toast(e?.message || 'Save cancelled');
    return null;
  }
}

// ---------- Menu & keyboard wiring ----------
function closeAllMenus() {
  menuFileDD.classList.remove('show');
  menuEditDD.classList.remove('show');
  menuEditorDD.classList.remove('show');
  menuViewDD.classList.remove('show');
  menuThemeDD.classList.remove('show');
  recentFilesDD.classList.remove('show');
  if (branchMenuHandle && typeof branchMenuHandle.close === 'function') {
    branchMenuHandle.close();
  }
}
function bindMenuToggle(el, action) {
  if (!el) return;
  const run = () => { closeAllMenus(); action(); };
  el.addEventListener('click', run);
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); run(); } });
}

function bindThemeMenu() {
  themeMenuItems.forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newTheme = item.dataset.theme;
      if (newTheme && newTheme !== currentTheme) {
        currentTheme = newTheme;
        updateThemeMenuChecks();
        
        // 1. Persist to disk
        await persistEditorPreferences({ theme: currentTheme });
        
        // 2. Update shared state for live sync
        const niceGUITheme = mapThemeToNiceGUI(currentTheme);
        apiPost('editor/set_view_settings', { theme: niceGUITheme })
          .catch(e => console.warn('[Theme] Failed to sync theme:', e));
      }
      menuThemeDD.classList.remove('show');
    });
  });
}

menuFileBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuFileDD.classList.toggle('show'); if (open){menuEditDD.classList.remove('show'); menuEditorDD.classList.remove('show'); menuViewDD.classList.remove('show'); menuThemeDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
menuEditBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuEditDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditorDD.classList.remove('show'); menuViewDD.classList.remove('show'); menuThemeDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
menuEditorBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuEditorDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuViewDD.classList.remove('show'); menuThemeDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
menuViewBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuViewDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuEditorDD.classList.remove('show'); menuThemeDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
menuThemeBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuThemeDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuEditorDD.classList.remove('show'); menuViewDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
recentFilesBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = recentFilesDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuEditorDD.classList.remove('show'); menuViewDD.classList.remove('show'); menuThemeDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
document.addEventListener('click', () => closeAllMenus());

bindMenuToggle(miNew, () => {
  if (unsaved) { showConfirm(); return; }
  closeWebSocket();
  if (currentPath) {
    diffController.invalidateCacheForPath(currentPath);
  }
  diffController.setContext(null);
  currentPath = ''; currentPathExists = false; lastPickerPath = HOME_DIR; currentModeLanguage = null;
  lastSha256 = null;
  setText(''); lastSavedContent = ''; markUnsaved(false); updatePathDisplay(); syncSessionPath();
});
bindMenuToggle(miOpen, async () => { const p = await pickFile(); if (p) await openFile(p); });
bindMenuToggle(miSave, () => saveFile());
bindMenuToggle(miSaveAs, () => saveAsDialog());
bindMenuToggle(miClose, () => {
  closeWebSocket();
  if (currentPath) {
    diffController.invalidateCacheForPath(currentPath);
  }
  diffController.setContext(null);
  currentPath=''; currentPathExists=false; lastPickerPath=HOME_DIR; currentModeLanguage=null;
  lastSha256 = null;
  setText(''); lastSavedContent=''; markUnsaved(false); updatePathDisplay(); syncSessionPath();
});
bindMenuToggle(miQuit, () => {
  closeWebSocket();
  if (currentPath) {
    diffController.invalidateCacheForPath(currentPath);
  }
  diffController.setContext(null);
  currentPath=''; currentPathExists=false; lastSha256 = null;
  setText(''); lastSavedContent=''; markUnsaved(false); updatePathDisplay(); syncSessionPath();
});

bindMenuToggle(miUndo, () => { if (view && undo) undo(view); });
bindMenuToggle(miRedo, () => { if (view && redo) redo(view); });
bindMenuToggle(miCut,  () => document.execCommand('cut'));
bindMenuToggle(miCopy, () => document.execCommand('copy'));
bindMenuToggle(miPaste, async () => {
  try {
    const text = await navigator.clipboard?.readText?.();
    if (text != null) {
      view.dispatch({ changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: text } });
      return;
    }
  } catch {}
  document.execCommand('paste');
});
bindMenuToggle(miSelectAll, () => {
  // Select all text in CodeMirror
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
});

bindMenuToggle(miToggleLines, () => {
  showLineNumbers = !showLineNumbers;
  applyMenuState();
  createView(getText());
  persistEditorPreferences({ showLineNumbers });
});
bindMenuToggle(miToggleShading, async () => {
  showLineShading = !showLineShading;
  setMenuChecked(miToggleShading, showLineShading);
  persistEditorPreferences({ showShading: showLineShading });
  // Sync to NiceGUI state - use set_view_settings to update immediately
  apiPost('editor/set_view_settings', { line_shading: showLineShading }).catch(e => console.warn('[Menu] Failed to sync line shading:', e));
});
bindMenuToggle(miToggleSyntax, () => {
  showSyntaxHighlight = !showSyntaxHighlight;
  applyMenuState();
  createView(getText());
  persistEditorPreferences({ showSyntax: showSyntaxHighlight });
});
bindMenuToggle(miToggleCloseBrackets, () => {
  autoCloseBrackets = !autoCloseBrackets;
  applyMenuState();
  createView(getText());
  if (showInlineDiffs && currentPath && currentPathExists) {
    diffController.refresh(true);
  }
  persistEditorPreferences({ autoCloseBrackets });
});
bindMenuToggle(miToggleAutocomplete, () => {
  enableAutocompletion = !enableAutocompletion;
  applyMenuState();
  createView(getText());
  if (showInlineDiffs && currentPath && currentPathExists) {
    diffController.refresh(true);
  }
  persistEditorPreferences({ autocompletion: enableAutocompletion });
});
bindMenuToggle(miToggleWrap, async () => {
  wordWrap = !wordWrap;
  setMenuChecked(miToggleWrap, wordWrap);
  persistEditorPreferences({ wordWrap });
  // Sync to NiceGUI state
  apiPost('editor/set_view_settings', { word_wrap: wordWrap }).catch(e => console.warn('[Menu] Failed to sync word wrap:', e));
});
bindMenuToggle(miToggleAutosave, () => {
  autoSaveEnabled = !autoSaveEnabled;
  applyMenuState();
  if (autoSaveEnabled && unsaved && currentPath && currentPathExists) {
    scheduleAutosave(); // Trigger autosave immediately if there are unsaved changes
  }
  persistEditorPreferences({ autoSave: autoSaveEnabled });
});
bindMenuToggle(miToggleDiffs, async () => {
  showInlineDiffs = !showInlineDiffs;
  setMenuChecked(miToggleDiffs, showInlineDiffs);
  persistEditorPreferences({ showInlineDiffs });
  // Sync to NiceGUI state - will trigger diff decorations in iframe
  apiPost('editor/set_view_settings', { 
    show_inline_diffs: showInlineDiffs,
    current_path: currentPath  // Send current file for diff loading
  }).catch(e => console.warn('[Menu] Failed to sync inline diffs:', e));
});
bindMenuToggle(miTrackEdits, () => {
  trackAgentEdits = !trackAgentEdits;
  applyMenuState();
  if (trackAgentEdits) {
    connectEditTracker();
  } else {
    disconnectEditTracker();
  }
  persistEditorPreferences({ trackAgentEdits });
});

// Initialize terminal drawer
const terminal = createTerminalDrawer({
  onReady: () => console.log('Terminal drawer ready'),
  getCurrentProjectPath: () => {
    if (!currentPath) return null;
    // Extract directory from file path
    const lastSlash = currentPath.lastIndexOf('/');
    return lastSlash > 0 ? currentPath.substring(0, lastSlash) : null;
  },
});

// Bind terminal toggle menu item
const miToggleTerminal = requireEl('#mi-toggle-terminal');
bindMenuToggle(miToggleTerminal, () => {
  terminal.toggle();
});

bindMenuToggle(miFind, () => { if (view && openSearchPanel) openSearchPanel(view); });
bindMenuToggle(miGoto, () => { const input = window.prompt('Go to line'); const line = Number.parseInt(input || '', 10); if (!Number.isNaN(line)) { const ln = Math.max(1, line); const pos = view.state.doc.line(ln).from; view.dispatch({ selection:{anchor:pos}, scrollIntoView:true }); view.focus(); } });



// Unsaved tracking
function onAnyChange() {
  const now = getText();
  const hasChanges = now !== lastSavedContent;
  markUnsaved(hasChanges);

  // Schedule autosave if there are changes
  if (hasChanges) {
    scheduleAutosave();
  }
}
const changeObserver = new MutationObserver(onAnyChange);
const observeEditor = () => {
  changeObserver.disconnect();
  if (view?.dom) changeObserver.observe(view.dom, { childList:true, subtree:true, characterData:true });
};
function reobserve() {
  setTimeout(observeEditor, 0);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

  // Ctrl/Cmd+`: Toggle Terminal
  if (cmdOrCtrl && e.key === '`') {
    e.preventDefault();
    terminal.toggle();
  }

  // Ctrl/Cmd+S: Save
  if (cmdOrCtrl && e.key === 's') {
    e.preventDefault();
    saveFile();
  }

  // Ctrl/Cmd+N: New
  if (cmdOrCtrl && e.key === 'n') {
    e.preventDefault();
    if (unsaved) { showConfirm(); return; }
    closeWebSocket();
    if (currentPath) {
      diffController.invalidateCacheForPath(currentPath);
    }
    diffController.setContext(null);
    currentPath = ''; currentPathExists = false; lastPickerPath = HOME_DIR; currentModeLanguage = null;
    lastSha256 = null;
    setText(''); lastSavedContent = ''; markUnsaved(false); updatePathDisplay(); syncSessionPath();
  }

  // Ctrl/Cmd+O: Open
  if (cmdOrCtrl && e.key === 'o') {
    e.preventDefault();
    pickFile().then(p => { if (p) openFile(p); });
  }
});

// ---------- Confirm modal ----------
function showConfirm() {
  confirmModal.classList.add('show');
  confirmModal.setAttribute('aria-hidden', 'false');
}
function hideConfirm() {
  confirmModal.classList.remove('show');
  confirmModal.setAttribute('aria-hidden', 'true');
}
confirmClose.addEventListener('click', hideConfirm);
btnCancel.addEventListener('click', hideConfirm);
btnDiscard.addEventListener('click', () => { hideConfirm(); markUnsaved(false); host.requestExit(); });
btnSaveConfirm.addEventListener('click', async () => { await saveFile(); hideConfirm(); host.requestExit(); });

// ---------- State load/init ----------
host.setTitle('Code Viewer (CM6)');

// Set up global file opening hooks for explorer.js
window.appOpenFile = (absPath) => {
  openFile(absPath).catch(e => {
    host.toast(`Failed to open: ${e.message}`);
  });
};

window.appOpenFileRel = (rel, projectRoot) => {
  // Convert relative path to absolute using project root
  const base = projectRoot || cachedProjectRoot || HOME_DIR;
  const abs = toAbsolute(rel, base, HOME_DIR);
  openFile(abs).catch(e => {
    host.toast(`Failed to open: ${e.message}`);
  });
};

async function getCurrentProjectRoot(forceRefresh = false) {
  const state = await syncEditorState(forceRefresh);
  return state?.activeProject || null;
}

async function main() {
  // Responsive layout manager - detects viewport and applies layout class
  const layoutManager = {
    init() {
      this.update();
      window.addEventListener('resize', () => this.update());
      window.addEventListener('orientationchange', () => setTimeout(() => this.update(), 100));
    },
    
    update() {
      const isDesktop = window.matchMedia('(min-width: 768px) and (orientation: landscape)').matches;
      const root = document.querySelector('.fe-root');
      
      if (isDesktop) {
        root.classList.add('layout-desktop');
        root.classList.remove('layout-mobile');
      } else {
        root.classList.add('layout-mobile');
        root.classList.remove('layout-desktop');
      }
    }
  };

  // Initialize layout manager
  layoutManager.init();

  // Load saved layout preferences
  loadLayoutPreferences();

  // Initialize resize handles
  initResizeManager();

  // Initialize explorer first to get project context
  await initExplorerUI().catch(e => {
    console.error('Failed to initialize explorer UI:', e);
  });

  branchMenuHandle = initBranchMenu();
  agentDrawerHandle = initAgentDrawer();

  // Apply host-side fallback preferences while we wait for disk-backed settings.
  applyPreferencesFromStore(cachedPreferences);
  applyMenuState();
  updateThemeMenuChecks();

  const serverState = await syncEditorState(true);

  await loadPreferences(serverState?.preferences || cachedPreferences);
  applyMenuState();
  updateThemeMenuChecks();
  bindThemeMenu();
  await fetchPersistedSessionState();
  initSessionStateContext(serverState);
  queueSessionStateUpdate({ activeProject: serverState?.activeProject || null });

  const initialDoc = '';
  createView(initialDoc);
  lastSavedContent = getText();
  markUnsaved(false);
  updatePathDisplay();

  if (!serverState || !serverState.activeProject || !serverState.activeProjectExists) {
    statusEl.textContent = serverState?.activeProjectMessage || 'Select a project to begin.';
    fileNameEl.textContent = 'No file';
    fileNameEl.title = 'No file';
    filePathEl.textContent = '';
    filePathEl.title = '';
    return;
  }

  // Open file via URL param or saved state
  const params = new URLSearchParams(window.location.search);
  const fileFromUrl = params.get('file');
  let bootOpened = false;
  const restoredPath = serverState.lastFile;
  const restoredSha = serverState.lastFileSha256 || null;
  if (restoredPath && !currentPath) {
    currentPath = restoredPath;
    currentPathExists = !!serverState.lastFileExists;
    lastPickerPath = parentDir(restoredPath);
    lastSha256 = restoredSha;
    setText(''); // NiceGUI iframe owns the real buffer
  }

  if (fileFromUrl) {
    const abs = toAbsolute(fileFromUrl, null, HOME_DIR);
    lastPickerPath = parentDir(abs);
    bootOpened = true;
    await openFile(abs).catch((e) => {
      host.toast(`Failed to open file: ${e.message}`);
      currentPath = ''; currentPathExists = false; setText(''); markUnsaved(false); updatePathDisplay();
    });
  } else if (serverState.lastFile && serverState.lastFileExists) {
    if (currentPath && restoredPath && currentPath === restoredPath) {
      console.log('[BOOT] Skipping host-side open; NiceGUI already loaded restored path');
      bootOpened = true;
    } else {
      bootOpened = true;
      // Use a timeout to ensure the iframe is ready
      setTimeout(async () => {
        await openFile(serverState.lastFile).catch((e) => {
          console.error('Failed to reopen last file:', e);
          statusEl.textContent = serverState.lastFileMessage || 'Last file not found.';
        });
      }, 400);
    }
  } else if (serverState.lastFile && !serverState.lastFileExists) {
    statusEl.textContent = serverState.lastFileMessage || 'Last file not found.';
  } else if (!bootOpened) {
    statusEl.textContent = 'Select a file to begin.';
  }

}

// Run the main boot sequence
main();

// Save state on exit
host.onBeforeExit(() => {
  if (unsaved) { showConfirm(); host.toast('Unsaved changes — Save or Discard before leaving.'); return { cancel:true }; }
  flushSessionState(true);
  return {};
});

// Track changes: refresh unsaved flag
// (We don't wire CM6 transactions directly since we're using bare ESM; use a lightweight observer)
const observer = new MutationObserver(() => onAnyChange());
observer.observe(editorFrame, { childList:true, subtree:true, characterData:true });
}
