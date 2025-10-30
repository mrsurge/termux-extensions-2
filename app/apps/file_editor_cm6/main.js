// app/apps/file_editor_cm6/main.js

// Code Viewer (CM6) — dual-surface editor with native Android selection mode.
// Imports resolve to files produced by scripts/vendor_cm6.sh
// comment for testing in-line git refreshes
import * as CM from '/static/vendor/codemirror.1/codemirror.bundle.js';
import { initExplorerUI } from './static/js/explorer.js';
import { createDiffController } from './static/js/diff_decorations.js';
import { createTerminalDrawer } from './static/js/terminal.js';
import { initBranchMenu } from './static/js/git_menu.js';
import { initAgentDrawer } from './static/js/agent_drawer.js';

// Core
const EditorState = CM.EditorState;
const { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, lineNumbers } = CM;
const defaultKeymap   = CM.defaultKeymap   || [];
const history         = CM.history         || (() => []);
const historyKeymap   = CM.historyKeymap   || [];
const searchKeymap    = CM.searchKeymap    || [];
const indentWithTab   = CM.indentWithTab   || (() => {});
const syntaxHighlighting = CM.syntaxHighlighting || (() => []);
const StreamLanguage  = CM.StreamLanguage;
const defaultHighlightStyle = CM.defaultHighlightStyle || null;
const { undo, redo, oneDark, search, openSearchPanel, termuxTheme } = CM;

const THEMES = {
  'cm6-dark': EditorView.theme({}, {dark: true}), // Keep a basic dark as default
  'one-dark': oneDark || null,
  'termux': termuxTheme ? termuxTheme() : null
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
  const mode = CM.shell || CM.shellMode || CM.modeShell;
  return (mode && StreamLanguage) ? StreamLanguage.define(mode) : null;
};

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

const container = requireEl('#editor-container');
const cmHost = requireEl('#cm6-host');
const selectSurface = requireEl('#select-surface');
const selectExit = requireEl('#select-exit');
const selectTip = requireEl('#select-tip');

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
const miToggleShading = requireEl('#mi-toggle-shading');
const miToggleSyntax  = requireEl('#mi-toggle-syntax');
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

// ---------- Edit Tracker ----------
function connectEditTracker() {
  if (editTrackerWS) return; // Already connected
  
  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${window.location.host}/ws/app/file_editor_cm6/edit_tracker`;
  
  editTrackerWS = new WebSocket(wsUrl);
  
  editTrackerWS.onopen = () => {
    console.log('[EditTracker] Connected');
  };
  
  editTrackerWS.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleEditTrackerEvent(data);
    } catch (e) {
      console.error('[EditTracker] Parse error:', e);
    }
  };
  
  editTrackerWS.onerror = (err) => {
    console.error('[EditTracker] WebSocket error:', err);
  };
  
  editTrackerWS.onclose = () => {
    console.log('[EditTracker] Disconnected');
    editTrackerWS = null;
    updateEditTrackerStatus({ active: false, shells: [], last_edit: null });
  };
}

function disconnectEditTracker() {
  if (editTrackerWS) {
    editTrackerWS.close();
    editTrackerWS = null;
  }
  updateEditTrackerStatus({ active: false, shells: [], last_edit: null });
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
    
    // Wait a tick for editor to be ready
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Scroll to line and flash highlight
    if (editorView && line > 0) {
      const docLines = editorView.state.doc.lines;
      if (line <= docLines) {
        const lineObj = editorView.state.doc.line(line);
        const pos = lineObj.from;
        
        // Scroll into view
        editorView.dispatch({
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
  if (!editorView) return;
  
  const lineObj = editorView.state.doc.line(lineNumber);
  const flashDeco = CM.Decoration.line({ class: 'cm-edit-flash' });
  const decoSet = CM.RangeSetBuilder.of([flashDeco.range(lineObj.from)]);
  
  const flashField = CM.StateField.define({
    create: () => decoSet,
    update: (value) => value,
    provide: field => CM.EditorView.decorations.from(field),
  });
  
  // Add decoration
  editorView.dispatch({
    effects: CM.StateEffect.appendConfig.of(flashField),
  });
  
  // Remove after 1 second
  setTimeout(() => {
    try {
      editorView.dispatch({
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

// WebSocket and autosave state
let ws = null;
let editTrackerWS = null;
let clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
let lastSha256 = null;
let inflightOpId = null;
let saveDebounceTimer = null;
const AUTOSAVE_DELAY = 1200; // 1200ms debounce
let lastSaveTime = 0;
const SELF_ECHO_GRACE = 300; // 300ms grace period after save

function makeExtensions() {
  const exts = [
    history(),
    search(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    highlightActiveLine(),
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

  // Theme
  const theme = THEMES[currentTheme] || THEMES['cm6-dark'];
  if (theme) exts.push(theme);

  if (diffController?.extension) {
    exts.push(diffController.extension);
  }

  // Language
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
  return exts;
}

function createView(docText='') {
  if (view) {
    diffController.unbindView(view);
    view.destroy();
  }
  const state = EditorState.create({
    doc: docText,
    extensions: makeExtensions(),
  });
  view = new EditorView({ state, parent: cmHost });
  view.dom.style.flex = '1';
  view.dom.style.height = '100%';
  view.focus();
  diffController.bindView(view);
  diffController.setEnabled(showInlineDiffs);
  if (showInlineDiffs) {
    diffController.refresh();
  }
  reobserve();
}

function getText() { return view ? view.state.doc.toString() : ''; }
function setText(t) { createView(t); }

function markUnsaved(flag) {
  unsaved = !!flag;
  fileNameEl.classList.toggle('fe-unsaved', unsaved);
}

// ---------- API helpers ----------
async function apiGet(path) {
  const data = await api.get(path);
  // framework returns either raw or {ok,data}; normalize:
  return data.content ? data : (data.data || data);
}
async function apiPost(path, body) {
  const res = await api.post(path, body);
  return res.data || res;
}

function applyPreferencesFromStore(payload) {
  cachedPreferences = payload || {};
  const editorPrefs = (cachedPreferences && cachedPreferences.editor) || {};
  showLineNumbers = editorPrefs.showLineNumbers !== false;
  showLineShading = !!editorPrefs.showShading;
  showSyntaxHighlight = editorPrefs.showSyntax !== false;
  wordWrap = !!editorPrefs.wordWrap;
  autoSaveEnabled = editorPrefs.autoSave !== false;
  showInlineDiffs = editorPrefs.showInlineDiffs !== false;
  trackAgentEdits = !!editorPrefs.trackAgentEdits;
  const themeId = editorPrefs.theme;
  currentTheme = (themeId && THEMES[themeId]) ? themeId : 'cm6-dark';
  if (editorState) {
    editorState.preferences = cachedPreferences;
  }
}

function applyMenuState() {
  setMenuChecked(miToggleLines, showLineNumbers);
  setMenuChecked(miToggleShading, showLineShading);
  setMenuChecked(miToggleSyntax, showSyntaxHighlight);
  setMenuChecked(miToggleWrap, wordWrap);
  setMenuChecked(miToggleAutosave, autoSaveEnabled);
  setMenuChecked(miToggleDiffs, showInlineDiffs);
  setMenuChecked(miTrackEdits, trackAgentEdits);
  selectSurface.classList.toggle('wrap', wordWrap);
}

function updateThemeMenuChecks() {
  themeMenuItems.forEach((item) => {
    const themeId = item.getAttribute('data-theme');
    const available = !!THEMES[themeId];
    if (!available) {
      item.style.display = 'none';
      setMenuChecked(item, false);
      return;
    }
    setMenuChecked(item, themeId === currentTheme);
  });
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
    ws = new WebSocket(wsUrl);
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
    ws = null;
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
  }
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
  filePathEl.textContent = formatDisplayPath(abs);
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

    setText(payload.content || '');
    lastSavedContent = getText();
    markUnsaved(false);
    updatePathDisplay();
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
      } else {
        // Fallback to a fresh pull if the payload lacked state
        const refreshed = await syncEditorState(true);
        if (refreshed) {
          broadcastRecentsUpdate(refreshed);
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

  const content = getText();
  const result = await doSave(currentPath, content);

  if (result.success) {
    statusEl.textContent = 'Saved';
    setTimeout(() => { if (!unsaved) statusEl.textContent = ''; }, 1500);
  } else {
    host.toast(`Save failed: ${result.error}`);
    statusEl.textContent = '';
  }
}

async function saveAsDialog() {
  const target = await pickSaveTarget();
  if (!target || !target.path) return;
  if (target.existed && !window.confirm('File exists. Overwrite?')) return;
  statusEl.textContent = 'Saving...';

  const content = getText();
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

  if (!autoSaveEnabled) {
    return; // Autosave is disabled
  }

  saveDebounceTimer = setTimeout(() => {
    if (unsaved && currentPath && currentPathExists) {
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
  themeMenuItems.forEach((item) => {
    const themeId = item.getAttribute('data-theme');
    const available = !!THEMES[themeId];
    if (!available) {
      item.style.display = 'none';
      return;
    }
    const handle = () => {
      currentTheme = themeId;
      updateThemeMenuChecks();
      createView(getText());
      persistEditorPreferences({ theme: currentTheme });
    };

    item.addEventListener('click', () => { closeAllMenus(); handle(); });
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        closeAllMenus();
        handle();
      }
    });
  });
}

menuFileBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuFileDD.classList.toggle('show'); if (open){menuEditDD.classList.remove('show'); menuViewDD.classList.remove('show'); menuThemeDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
menuEditBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuEditDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuViewDD.classList.remove('show'); menuThemeDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
menuViewBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuViewDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuThemeDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
menuThemeBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = menuThemeDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuViewDD.classList.remove('show'); recentFilesDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
recentFilesBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = recentFilesDD.classList.toggle('show'); if (open){menuFileDD.classList.remove('show'); menuEditDD.classList.remove('show'); menuViewDD.classList.remove('show'); menuThemeDD.classList.remove('show'); if (branchMenuHandle) branchMenuHandle.close();}});
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
  setText(''); lastSavedContent = ''; markUnsaved(false); updatePathDisplay();
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
  setText(''); lastSavedContent=''; markUnsaved(false); updatePathDisplay();
});
bindMenuToggle(miQuit, () => {
  closeWebSocket();
  if (currentPath) {
    diffController.invalidateCacheForPath(currentPath);
  }
  diffController.setContext(null);
  currentPath=''; currentPathExists=false; lastSha256 = null;
  setText(''); lastSavedContent=''; markUnsaved(false); updatePathDisplay();
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
bindMenuToggle(miSelectAll, () => { if (selectSurface.style.display === 'block') { const r = document.createRange(); r.selectNodeContents(selectSurface); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } else { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); view.focus(); } });

bindMenuToggle(miToggleLines, () => {
  showLineNumbers = !showLineNumbers;
  applyMenuState();
  createView(getText());
  persistEditorPreferences({ showLineNumbers });
});
bindMenuToggle(miToggleShading, () => {
  showLineShading = !showLineShading;
  applyMenuState();
  createView(getText());
  persistEditorPreferences({ showShading: showLineShading });
});
bindMenuToggle(miToggleSyntax, () => {
  showSyntaxHighlight = !showSyntaxHighlight;
  applyMenuState();
  createView(getText());
  persistEditorPreferences({ showSyntax: showSyntaxHighlight });
});
bindMenuToggle(miToggleWrap, () => {
  wordWrap = !wordWrap;
  applyMenuState();
  createView(getText());
  if (showInlineDiffs && currentPath && currentPathExists) {
    diffController.refresh(true);
  }
  persistEditorPreferences({ wordWrap });
});
bindMenuToggle(miToggleAutosave, () => {
  autoSaveEnabled = !autoSaveEnabled;
  applyMenuState();
  if (autoSaveEnabled && unsaved && currentPath && currentPathExists) {
    scheduleAutosave(); // Trigger autosave immediately if there are unsaved changes
  }
  persistEditorPreferences({ autoSave: autoSaveEnabled });
});
bindMenuToggle(miToggleDiffs, () => {
  showInlineDiffs = !showInlineDiffs;
  applyMenuState();
  diffController.setEnabled(showInlineDiffs);
  if (showInlineDiffs) {
    diffController.refresh(true);
  }
  persistEditorPreferences({ showInlineDiffs });
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
    setText(''); lastSavedContent = ''; markUnsaved(false); updatePathDisplay();
  }

  // Ctrl/Cmd+O: Open
  if (cmdOrCtrl && e.key === 'o') {
    e.preventDefault();
    pickFile().then(p => { if (p) openFile(p); });
  }
});

// ---------- Dual-surface selection mode ----------
let selectMode = false;
let longPressTimer = null;
let pointerDownAt = null;

function enterSelectMode(fromPoint=null) {
  if (selectMode) return;
  selectMode = true;
  // Populate and show the selection surface
  selectSurface.textContent = getText();
  selectSurface.style.display = 'block';
  selectExit.style.display = 'inline-flex';
  selectTip.style.display = 'block';
  cmHost.style.display = 'none';
  cmHost.setAttribute('inert', 'true');
  cmHost.setAttribute('aria-hidden', 'true');
  // Focus and place caret near press
  selectSurface.focus();
  try {
    if (fromPoint && document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(fromPoint.x, fromPoint.y);
      if (r) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
  } catch {}
}

function exitSelectMode(commitChanges=true) {
  if (!selectMode) return;
  selectMode = false;
  if (commitChanges) {
    const newText = selectSurface.textContent || '';
    if (newText !== getText()) {
      setText(newText);
      markUnsaved(newText !== lastSavedContent);
    }
  }
  selectSurface.style.display = 'none';
  selectExit.style.display = 'none';
  selectTip.style.display = 'none';
  cmHost.style.display = 'flex';
  cmHost.removeAttribute('inert');
  cmHost.removeAttribute('aria-hidden');
  view.focus();
}

function scheduleLongPress(ev) {
  clearTimeout(longPressTimer);
  const pt = { x: ev.clientX, y: ev.clientY };
  pointerDownAt = { x: pt.x, y: pt.y, t: Date.now() };
  longPressTimer = setTimeout(() => enterSelectMode(pt), 500);
}
function cancelLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
  pointerDownAt = null;
}

cmHost.addEventListener('pointerdown', (ev) => {
  if (ev.pointerType === 'touch' || ev.pointerType === 'pen') scheduleLongPress(ev);
});
['pointerup','pointercancel','pointermove','wheel','scroll'].forEach(evt => {
  cmHost.addEventListener(evt, cancelLongPress, { passive:true });
});

selectExit.addEventListener('click', () => exitSelectMode(true));
selectSurface.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { ev.preventDefault(); exitSelectMode(true); }
});
selectSurface.addEventListener('blur', () => {
  // If user navigates away, keep selection mode but sync text to CM to avoid divergence
  const newText = selectSurface.textContent || '';
  if (newText !== getText()) { setText(newText); markUnsaved(newText !== lastSavedContent); }
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

  if (fileFromUrl) {
    const abs = toAbsolute(fileFromUrl, null, HOME_DIR);
    lastPickerPath = parentDir(abs);
    bootOpened = true;
    openFile(abs).catch((e) => {
      host.toast(`Failed to open file: ${e.message}`);
      currentPath = ''; currentPathExists = false; setText(''); markUnsaved(false); updatePathDisplay();
    });
  } else if (serverState.lastFile && serverState.lastFileExists) {
    bootOpened = true;
    setTimeout(() => {
      openFile(serverState.lastFile).catch((e) => {
        console.error('Failed to reopen last file:', e);
        statusEl.textContent = serverState.lastFileMessage || 'Last file not found.';
      });
    }, 400);
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
  return {};
});

// Track changes: refresh unsaved flag
// (We don't wire CM6 transactions directly since we're using bare ESM; use a lightweight observer)
const observer = new MutationObserver(() => onAnyChange());
observer.observe(cmHost, { childList:true, subtree:true, characterData:true });
}
