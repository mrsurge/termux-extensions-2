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
const cacheStateBadge = requireEl('#fe-file-draft-badge');
window.api  = api;
const HOME_DIR = '/data/data/com.termux/files/home';
const HOME_PREFIX = `${HOME_DIR}/`;

// DOM helpers
function requireEl(selector, scope=document) {
  const el = scope.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

function initVirtualKeyboardAdjustments({ root }) {
  if (!root) return;

  const docEl = document.documentElement;
  const viewport = window.visualViewport;

  // We only care about detecting if the keyboard is likely open to toggle a class.
  // We do NOT want to manually resize elements or set CSS variables that fight native behavior.

  const getViewportHeight = () => {
    if (viewport) return viewport.height;
    return window.innerHeight || docEl.clientHeight || 0;
  };

  let baselineHeight = getViewportHeight() || window.innerHeight || docEl.clientHeight || 0;
  let keyboardActive = false;

  const updateKeyboardState = () => {
    const currentHeight = getViewportHeight();
    if (!currentHeight) return;

    // specific check: if height shrinks by > 150px, assume keyboard
    const diff = baselineHeight - currentHeight;
    const likelyKeyboard = diff > 150;

    if (likelyKeyboard !== keyboardActive) {
      keyboardActive = likelyKeyboard;
      root.classList.toggle('keyboard-open', keyboardActive);
    }
    
    // Update baseline if we get a larger height (e.g. keyboard closed or orientation changed)
    if (currentHeight > baselineHeight) {
      baselineHeight = currentHeight;
    }
  };

  if (viewport) {
    viewport.addEventListener('resize', updateKeyboardState);
  } else {
    window.addEventListener('resize', updateKeyboardState);
  }

  // Handle orientation changes by resetting baseline
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      baselineHeight = getViewportHeight() || window.innerHeight || baselineHeight;
      updateKeyboardState();
    }, 250);
  });

  // Initial check
  updateKeyboardState();
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
const runActiveBtn   = requireEl('#run-active-file-btn');
const MAX_FILENAME_DISPLAY = 34;
const MAX_FILEPATH_DISPLAY = 43;

function formatFileNameDisplay(name) {
  if (!name) return '';
  if (name.length <= MAX_FILENAME_DISPLAY) return name;
  const keepStart = Math.max(6, Math.floor((MAX_FILENAME_DISPLAY - 1) * 0.6));
  const keepEnd = Math.max(4, MAX_FILENAME_DISPLAY - keepStart - 1);
  return `${name.slice(0, keepStart)}…${name.slice(-keepEnd)}`;
}

function formatFilePathDisplay(path) {
  if (!path) return '';
  if (path.length <= MAX_FILEPATH_DISPLAY) return path;
  const keepStart = Math.max(6, Math.floor((MAX_FILEPATH_DISPLAY - 1) * 0.6));
  const keepEnd = Math.max(4, MAX_FILEPATH_DISPLAY - keepStart - 1);
  return `${path.slice(0, keepStart)}…${path.slice(-keepEnd)}`;
}

function setToolbarFileName(rawName) {
  const safe = rawName || '';
  fileNameEl.textContent = formatFileNameDisplay(safe);
  fileNameEl.title = safe;
}
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
const miToggleIndentGuides = requireEl('#mi-toggle-indent-guides');
const miToggleWrap    = requireEl('#mi-toggle-wrap');
const miToggleAutosave = requireEl('#mi-toggle-autosave');
const miToggleDiffs  = requireEl('#mi-toggle-diffs');
const miToggleDraftDiffs = requireEl('#mi-toggle-draft-diffs');
const miToggleColorPicker = requireEl('#mi-toggle-color-picker');
const miToggleReadonly = requireEl('#mi-toggle-readonly');
const miTrackEdits   = requireEl('#mi-track-edits');
const miFind          = requireEl('#mi-find');
const miGoto          = requireEl('#mi-goto');

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

function isRunnableFile(path) {
  if (!path) return false;
  const normalized = String(path).toLowerCase().trim();
  const idx = normalized.lastIndexOf('.');
  if (idx === -1) return false;
  const ext = normalized.slice(idx);
  return RUNNABLE_EXTENSIONS.has(ext);
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

// Font scale preset mapping
const FONT_SCALE_PRESETS = {
  small: 0.70,   // 85% user-facing (smaller than comfortable)
  medium: 0.85,  // 100% user-facing (comfortable baseline)
  large: 1.0     // 115% user-facing (back to browser default)
};

const RUNNABLE_EXTENSIONS = new Set(['.py', '.pyw', '.sh', '.bash', '.zsh']);

function applyFontScale(scale) {
  // This function applies the selected font scale to the UI.
  // It updates the --chrome-font-scale CSS variable, which is used
  // by the stylesheet to resize UI elements like menus and the explorer.
  document.documentElement.style.setProperty('--chrome-font-scale', scale);
  
  // Update menu checkmarks
  updateFontScaleMenuChecks(scale);
  
  console.log(`[FontScale] Applied scale: ${scale}`);
}

function updateFontScaleMenuChecks(currentScale) {
  // This helper ensures the correct font size preset is checked in the menu.
  const items = {
    'mi-font-small': FONT_SCALE_PRESETS.small,
    'mi-font-medium': FONT_SCALE_PRESETS.medium,
    'mi-font-large': FONT_SCALE_PRESETS.large
  };
  
  for (const [id, scale] of Object.entries(items)) {
    const item = document.getElementById(id);
    if (item) {
      const isActive = Math.abs(scale - currentScale) < 0.01;
      item.classList.toggle('fe-menu-item-checked', isActive);
      item.setAttribute('aria-checked', isActive ? 'true' : 'false');
    }
  }
}

async function setFontScale(preset) {
  // This function orchestrates changing the font size. It applies the
  // new scale to the UI, sends the change to the backend to update the
  // editor iframe, and persists the setting for future sessions.
  const scale = FONT_SCALE_PRESETS[preset];
  if (!scale) {
    console.error(`[FontScale] Invalid preset: ${preset}`);
    return;
  }
  
  try {
    // 1. Update chrome immediately
    applyFontScale(scale);
    
    // 2. Update editor via backend and persist
    await updatePreference('fontScale', scale);
    
  } catch (error) {
    console.error('[FontScale] Failed to update:', error);
    host.toast('Failed to update font scale', 'error');
  }
}


// ---------- Editor state ----------
let view = null;
let currentPath = '';
let currentPathExists = false;
let lastSavedContent = '';
let unsaved = false;

// Preferences are managed by backend; frontend displays state only (no caching)
let editorViewState = null; // Loaded from backend at startup via /editor/view_state

let currentModeLanguage = null;
let cachedProjectRoot = null;
let editorState = null;
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
let restoredSessionActive = false;
let externalRefreshInProgress = false;
let lastPickerPath = HOME_DIR;

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
let bootAutoOpenTimer = null;
let bootAutoOpenPath = null;

function cancelBootAutoOpen(reason) {
  if (!bootAutoOpenTimer) return;
  clearTimeout(bootAutoOpenTimer);
  bootAutoOpenTimer = null;
  bootAutoOpenPath = null;
  if (reason) {
    console.log(`[BOOT] Cancelled deferred open: ${reason}`);
  }
}

function handleCacheStateBridgeEvent(event) {
  if (!event || !event.data || event.data.type !== 'cm6-cache-state') {
    return;
  }
  if (editorFrame && editorFrame.contentWindow && event.source && event.source !== editorFrame.contentWindow) {
    return;
  }
  const data = event.data;
  const normalizedPath = data.path ? toAbsolute(data.path, null, HOME_DIR) : null;
  if (normalizedPath) {
    const pathChanged = normalizedPath !== currentPath;
    currentPath = normalizedPath;
    currentPathExists = true;
    lastPickerPath = parentDir(normalizedPath);
    if (pathChanged || !fileNameEl.textContent || fileNameEl.textContent === 'Untitled') {
      updatePathDisplay();
    }
  }
  if (typeof data.content_sha256 === 'string' && data.content_sha256.length === 64) {
    lastSha256 = data.content_sha256;
  }
  if (data.reason === 'restore') {
    restoredSessionActive = true;
    if (bootAutoOpenPath && normalizedPath && bootAutoOpenPath === normalizedPath) {
      cancelBootAutoOpen('NiceGUI restored cached session');
    }
  } else if (data.state === 'clean') {
    restoredSessionActive = false;
    bootAutoOpenPath = null;
  }
  if (data.reason === 'watcher_external' && normalizedPath) {
    triggerExternalRefresh(normalizedPath);
  }
  applyCacheIndicator({
    state: data.state,
    unsaved: data.unsaved,
    reason: data.reason,
    restoredActive: restoredSessionActive,
  });
  window.__cm6CacheState = data;
}

window.addEventListener('message', handleCacheStateBridgeEvent);

// Handle generic notifications from iframe (NiceGUI)
window.addEventListener('message', (event) => {
  if (!event || !event.data) return;
  
  // Validate source
  if (editorFrame && editorFrame.contentWindow && event.source && event.source !== editorFrame.contentWindow) {
    return;
  }

  if (event.data.type === 'notification') {
    const payload = event.data.data;
    if (payload && payload.message) {
      const timeout = payload.timeout || 3000;
      host.toast(payload.message, timeout); 
    }
  } else if (event.data.type === 'draft_state') {
    const payload = event.data.data;
    if (payload && payload.has_draft && payload.path === currentPath) {
      // Force indicator to restored state
      restoredSessionActive = true;
      applyCacheIndicator({
        state: 'mid_session',
        reason: 'restore',
        restoredActive: true,
        unsaved: true
      });
    }
  }
});

async function triggerExternalRefresh(path) {
  if (externalRefreshInProgress) return;
  externalRefreshInProgress = true;
  try {
    console.log('[WATCHER] External edit detected; reloading', path);
    await openFile(path, { forceRefresh: true });
  } catch (err) {
    console.error('Failed to refresh after external edit:', err);
  } finally {
    externalRefreshInProgress = false;
  }
}

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
  cacheStateBadge.dataset.state = next ? (cacheStateBadge.dataset.state || '') : '';
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

async function triggerEditorSearchPanel(reason = 'menu') {
  const payload = {
    path: currentPath || null,
    project: cachedProjectRoot || null,
    reason,
  };
  const result = await apiPost('editor/search/open', payload);
  if (result?.ok === false) {
    const message = result?.error || 'Search unavailable';
    host.toast(message);
  }
}

// ---------- Unified Preference Management (Backend as Single Source of Truth) ----------

async function fetchEditorState() {
  // Query backend for current editor state (for menu checkmarks only)
  try {
    const resp = await fetch('/api/app/file_editor_cm6/editor/view_state', { cache: 'no-store' });
    const json = await resp.json();
    return json?.data || null;
  } catch (err) {
    console.error('[EditorState] Failed to fetch:', err);
    return null;
  }
}

async function updatePreference(key, value) {
  // Send preference change to backend; backend handles persistence + application
  // Returns full state in single round trip (Jimmy's optimization)
  try {
    const resp = await apiPost('editor/update_preference', { key, value });
    
    // apiPost already unwraps the response (returns res.data)
    // Backend sends {ok: true, data: {...}}, apiPost returns the data object
    if (resp && typeof resp === 'object' && Object.keys(resp).length > 0) {
      // resp is the state object (not wrapped in {ok, data})
      editorViewState = resp; // Update state BEFORE applying (fixes minimap toggle inversion)
      applyStateToMenus(resp);
      return true;
    }
    
    // Empty response or error
    console.error(`[Preference] Update ${key} failed: empty or invalid response`, resp);
    return false;
  } catch (err) {
    console.error(`[Preference] Failed to update ${key}:`, err);
    return false;
  }
}

async function refreshMenuState() {
  // Query backend for current state and update menu checkmarks
  const state = await fetchEditorState();
  if (!state) return;
  
  applyStateToMenus(state);
  editorViewState = state;
}

function applyStateToMenus(state) {
  // Update all menu checkmarks from backend state
  setMenuChecked(miToggleLines, state.showLineNumbers);
  setMenuChecked(miToggleSyntax, state.showSyntax);
  setMenuChecked(miToggleCloseBrackets, state.autoCloseBrackets);
  setMenuChecked(miToggleAutocomplete, state.autocompletion);
  setMenuChecked(miToggleShading, state.showShading);
  setMenuChecked(miToggleIndentGuides, state.showIndentGuides);
  setMenuChecked(miToggleWrap, state.wordWrap);
  setMenuChecked(miToggleAutosave, state.autoSave);
  setMenuChecked(miToggleDiffs, state.showInlineDiffs);
  setMenuChecked(miToggleDraftDiffs, state.showDraftDiffs);
  setMenuChecked(miToggleColorPicker, state.colorPicker);
  setMenuChecked(miToggleReadonly, state.readOnly);
  setMenuChecked(miToggleMinimap, state.showMinimap);
  setMenuChecked(miTrackEdits, state.trackAgentEdits);
  
  // Update theme menu checkmarks
  themeMenuItems.forEach(item => {
    setMenuChecked(item, item.dataset.theme === state.theme);
  });
  
  // Apply font scale to UI
  applyFontScale(state.fontScale ?? 0.85);
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
    await openFile(currentPath, { allowOverwrite: true, forceRefresh: true });
  }
};

window.__cm6EnsureInlineDiffs = async function ensureInlineDiffsEnabled(forceOn = true) {
  if (!forceOn) {
    return true;
  }
  if (editorViewState?.showInlineDiffs) {
    return true;
  }
  try {
    return await updatePreference('showInlineDiffs', true);
  } catch (err) {
    console.warn('Auto-enable inline diffs failed:', err);
    return false;
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
      if (editorViewState?.showInlineDiffs) {
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
    if (diffController && editorViewState?.showInlineDiffs && currentPath) {
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
function updateRunButtonState() {
  if (!runActiveBtn) return;
  const runnable = Boolean(currentPath && currentPathExists && isRunnableFile(currentPath));
  runActiveBtn.disabled = !runnable;
  runActiveBtn.title = runnable ? 'Run active file in terminal' : 'Open a Python or shell script to enable running';
}

function updatePathDisplay() {
  const badge = document.getElementById('fe-file-draft-badge');
  if (!currentPath) {
    setToolbarFileName('Untitled');
    if (badge) setIndicatorInactive(badge);
    filePathEl.textContent = 'No file open';
    filePathEl.title = '';
    updateRunButtonState();
    return;
  }
  const abs = toAbsolute(currentPath, null, HOME_DIR);
  setToolbarFileName(basename(abs));
  if (badge) setIndicatorInactive(badge); // Reset to grey default
  filePathEl.textContent = formatFilePathDisplay(formatDisplayDirectory(abs));
  filePathEl.title = abs;
  updateRunButtonState();
}

async function handleDiscardClick(e) {
  e.stopPropagation();
  e.preventDefault();
  
  const project = cachedProjectRoot || (await getCurrentProjectRoot());
  if (!project) {
    host.toast('Cannot discard: Project root unknown');
    return;
  }

  // Instant discard - no confirmation
  try {
    const url = `session_cache?project=${encodeURIComponent(project)}&path=${encodeURIComponent(currentPath)}`;
    await api.delete(url);
    
    // Reload file to reset content to disk version
    await openFile(currentPath, { forceRefresh: true });
    host.toast('Draft discarded');
  } catch (err) {
    host.toast('Failed to discard draft');
    console.error(err);
  }
}

function setIndicatorActive(badge, char) {
  badge.textContent = char;
  badge.style.color = '#ff4444'; // Red
  badge.style.cursor = 'pointer';
  badge.title = 'Unsaved draft available. Click to discard.';
  badge.onclick = handleDiscardClick;
  badge.style.display = 'inline-block';
}

function setIndicatorInactive(badge) {
  // Respect global restored flag - do not clear if we are holding a draft
  if (restoredSessionActive) return;

  badge.textContent = '*';
  badge.style.color = '#666'; // Grey
  badge.style.cursor = 'default';
  badge.title = 'No unsaved draft';
  badge.onclick = null;
  badge.style.display = 'inline-block';
}

function applyCacheIndicator(info) {
  const badge = document.getElementById('fe-file-draft-badge');
  if (!badge) return;

  if (!info) {
    setIndicatorInactive(badge);
    return;
  }

  const { state, unsaved, reason, restoredActive } = info;
  
  // Logic to determine if we should show RED (Active)
  const isCrashed = (state === 'crashed');
  const isRestored = (state === 'mid_session' && (reason === 'restore' || restoredActive));
  const isActiveDraft = (state === 'mid_session' && unsaved);

  if (isCrashed || isRestored || isActiveDraft) {
    setIndicatorActive(badge, isCrashed ? '!' : '*');
    badge.dataset.state = isCrashed ? 'crashed' : (isRestored ? 'restored' : 'cached');
    markUnsaved(true);
  } else {
    // Only turn inactive if we are NOT holding a restored session
    // This protects against race conditions where 'clean' arrives after 'restore'
    if (!restoredSessionActive) {
      setIndicatorInactive(badge);
      badge.dataset.state = '';
      markUnsaved(false);
    }
  }
}

async function openFile(path, options = {}) {
  const { allowOverwrite = true, forceRefresh = false } = options;
  if (!path) throw new Error('Path is empty');
  statusEl.textContent = 'Opening...';
  
  const projectState = await ensureProjectContext();
  if (!projectState || !projectState.activeProject || !projectState.activeProjectExists) {
    statusEl.textContent = '';
    host.toast(projectState?.activeProjectMessage || 'Select a project before opening files.');
    return;
  }

  try {
    const resolvedTarget = toAbsolute(path, null, HOME_DIR);
    if (!forceRefresh && !allowOverwrite && restoredSessionActive && currentPath && resolvedTarget === currentPath) {
      console.log('[Editor] Skipping host-side open; restored session buffer already loaded');
      statusEl.textContent = '';
      return;
    }
    
    // Reset indicator for new file load
    restoredSessionActive = false;
    setIndicatorInactive(cacheStateBadge);

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
    if (editorViewState?.showInlineDiffs) {
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

async function runCurrentFile() {
  const runnable = currentPath && currentPathExists && isRunnableFile(currentPath);
  if (!runnable) {
    host.toast('Open a Python or shell script to run it in the terminal');
    return;
  }

  runActiveBtn.disabled = true;
  try {
    if (terminal && typeof terminal.open === 'function') {
      await terminal.open();
    }

    const response = await apiPost('editor/run_active_file', {});
    if (response?.ok) {
      const preview = response.data?.command_preview || basename(currentPath);
      host.toast(`Running ${preview} in terminal`);
    } else {
      host.toast(response?.error || 'Failed to run file');
    }
  } catch (err) {
    console.error('[RUN] Failed to execute file:', err);
    host.toast(err?.message || 'Failed to run file');
  } finally {
    updateRunButtonState();
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
    if (editorViewState?.showInlineDiffs) {
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
  if (!(editorViewState?.autoSave) || nativeSelectionActive) {
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

// Helper: Jump to line in current file
async function jumpToCurrentFileLine(line) {
  const path = window.currentPath;
  if (!path) {
    host.toast('No file currently open');
    return;
  }
  
  try {
    await apiPost('editor/jump_to_line', { line: parseInt(line, 10) });
  } catch (e) {
    host.toast('Failed to jump: ' + (e?.message || 'unknown error'));
  }
}

// Expose for search overlay
window.jumpToCurrentFileLine = jumpToCurrentFileLine;

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
      if (newTheme && newTheme !== editorViewState?.theme) {
        // Update preference via unified method
        const success = await updatePreference('theme', newTheme);
        if (!success) {
          host.toast('Failed to change theme');
        }
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
runActiveBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  runCurrentFile();
});
document.addEventListener('click', () => closeAllMenus());

bindMenuToggle(miNew, () => {
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

bindMenuToggle(miToggleLines, async () => {
  const success = await updatePreference('showLineNumbers', !(editorViewState?.showLineNumbers));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleShading, async () => {
  const success = await updatePreference('showShading', !(editorViewState?.showShading));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleIndentGuides, async () => {
  const success = await updatePreference('showIndentGuides', !(editorViewState?.showIndentGuides));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleSyntax, async () => {
  const success = await updatePreference('showSyntax', !(editorViewState?.showSyntax));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleCloseBrackets, async () => {
  const success = await updatePreference('autoCloseBrackets', !(editorViewState?.autoCloseBrackets));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleAutocomplete, async () => {
  const success = await updatePreference('autocompletion', !(editorViewState?.autocompletion));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleWrap, async () => {
  const success = await updatePreference('wordWrap', !(editorViewState?.wordWrap));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleAutosave, async () => {
  const success = await updatePreference('autoSave', !(editorViewState?.autoSave));
  if (!success) host.toast('Failed to update preference');
  // Trigger autosave immediately if there are unsaved changes and autosave was enabled
  if (success && editorViewState?.autoSave && unsaved && currentPath && currentPathExists) {
    scheduleAutosave();
  }
});

bindMenuToggle(miToggleDiffs, async () => {
  const success = await updatePreference('showInlineDiffs', !(editorViewState?.showInlineDiffs));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleDraftDiffs, async () => {
  const success = await updatePreference('showDraftDiffs', !(editorViewState?.showDraftDiffs));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleColorPicker, async () => {
  const success = await updatePreference('colorPicker', !(editorViewState?.colorPicker));
  if (!success) host.toast('Failed to update color picker');
});

bindMenuToggle(miToggleReadonly, async () => {
  const success = await updatePreference('readOnly', !(editorViewState?.readOnly));
  if (success) {
    host.toast(editorViewState?.readOnly ? 'Editor is now read-only' : 'Editor is now editable', 'info');
  } else {
    host.toast('Failed to toggle read-only mode');
  }
});

const miToggleMinimap = requireEl('#mi-toggle-minimap');
bindMenuToggle(miToggleMinimap, async () => {
  const success = await updatePreference('showMinimap', !(editorViewState?.showMinimap));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miTrackEdits, async () => {
  const success = await updatePreference('trackAgentEdits', !(editorViewState?.trackAgentEdits));
  if (!success) host.toast('Failed to update preference');
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

// NEW: Font scale radio buttons
const miFontSmall = document.getElementById('mi-font-small');
const miFontMedium = document.getElementById('mi-font-medium');
const miFontLarge = document.getElementById('mi-font-large');

if (miFontSmall) {
  miFontSmall.addEventListener('click', () => setFontScale('small'));
}
if (miFontMedium) {
  miFontMedium.addEventListener('click', () => setFontScale('medium'));
}
if (miFontLarge) {
  miFontLarge.addEventListener('click', () => setFontScale('large'));
}

bindMenuToggle(miFind, () => { triggerEditorSearchPanel('menu'); });
bindMenuToggle(miGoto, async () => {
  const input = window.prompt('Go to line:');
  if (!input) return;
  
  const line = parseInt(input, 10);
  if (isNaN(line) || line < 1) {
    host.toast('Invalid line number');
    return;
  }
  
  await jumpToCurrentFileLine(line);
});



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

  // Ctrl/Cmd+F: Search
  if (cmdOrCtrl && e.key === 'f') {
    e.preventDefault();
    triggerEditorSearchPanel('shortcut');
  }

  // Ctrl/Cmd+N: New
  if (cmdOrCtrl && e.key === 'n') {
    e.preventDefault();
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

  // NEW: Font scale shortcuts
  if ((e.ctrlKey || e.metaKey) && e.key === '=' && !e.shiftKey) {
    // This shortcut allows increasing the font size through presets.
    e.preventDefault();
    const currentScale = parseFloat(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--chrome-font-scale') || '0.85'
    );
    
    if (currentScale < 0.75) setFontScale('medium');
    else if (currentScale < 1.0) setFontScale('large');
    // Already at Large, do nothing
  }

  if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    // This shortcut allows decreasing the font size through presets.
    e.preventDefault();
    const currentScale = parseFloat(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--chrome-font-scale') || '0.85'
    );
    
    if (currentScale > 1.0) setFontScale('medium');
    else if (currentScale > 0.75) setFontScale('small');
    // Already at Small, do nothing
  }
});


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

  const serverState = await syncEditorState(true);

  // Load menu state from backend (backend already configured editor at page render)
  await refreshMenuState();
  bindThemeMenu();

  // Handshake: Ask backend to resend cache state now that we are listening
  // This fixes the "Missed Message" race condition on page load
  try {
    await apiPost('editor/refresh_cache_state', {});
  } catch (e) {
    console.warn('Failed to refresh cache state on boot:', e);
  }
  
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
    setToolbarFileName('No file');
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
    bootAutoOpenPath = toAbsolute(serverState.lastFile, null, HOME_DIR);
    bootAutoOpenTimer = setTimeout(async () => {
      bootAutoOpenTimer = null;
      bootAutoOpenPath = null;
      await openFile(serverState.lastFile, { allowOverwrite: false }).catch((e) => {
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
