// /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/main.js
// app/apps/file_editor_cm6/main.js
// Inline Monaco editor integration

// @ts-check
import { initExplorerUI } from './src/explorer/app/bootstrap.ts';
import { dispatchExplorerNotification, refreshExplorer } from './src/explorer/app/public-api.ts';
import { createTerminalDrawer } from './main_page/frontend/host-terminal-drawer.ts';
import { initBranchMenu } from './main_page/frontend/host-git-branch-menu.ts';
// Hardcoded extension imports for now; will be dynamically loaded later.
import { initSidebarShortcuts } from './extensions/sidebar_extension/static/js/sidebar_shortcuts.js';
import ReconnectingWebSocket from './main_page/frontend/connections/reconnecting-websocket.ts';
import { createConsoleDrawer } from './main_page/frontend/host-console-drawer.ts';
import { createProblemsPanel } from './src/diagnostics/problems-panel.ts';
import { initConsoleBridge } from './main_page/frontend/console_bridge.js';
import {
  HOME_DIR, HOME_PREFIX, simplifyAbsolute, toAbsolute, parentDir, basename,
  formatDisplayPath, formatDisplayDirectory, detectLanguageFromFilename,
  RUNNABLE_EXTENSIONS, isRunnableFile, setMenuChecked, FONT_SCALE_PRESETS,
  requireEl,
} from './main_page/frontend/core/utils.ts';
import { createAppContext } from './main_page/frontend/core/app-context.ts';
import { initVirtualKeyboardAdjustments } from './main_page/frontend/ui/virtual-keyboard.ts';
import { pickerAvailable as pickerUiAvailable, pickFileWithPicker, pickDirectoryWithPicker, pickSaveTargetWithPicker } from './main_page/frontend/io/picker-helpers.ts';
import { createPickerController } from './main_page/frontend/io/picker-controller.ts';
import { createJumpLineController } from './main_page/frontend/io/jump-line.ts';
import { createAdapterUiController } from './main_page/frontend/ui/adapter-ui.ts';
import { createEditTrackerController } from './main_page/frontend/ui/edit-tracker.ts';
import { createFontScaleController } from './main_page/frontend/ui/font-scale.ts';
import { createSearchPanelController } from './main_page/frontend/ui/search-panel.ts';
import { createMenuCoreController } from './main_page/frontend/ui/menu-core.ts';
import { installBasicMenuActions } from './main_page/frontend/ui/menu-actions-basic.ts';
import { installSimplePreferenceMenuActions } from './main_page/frontend/ui/menu-actions-preferences.ts';
import { installAdvancedMenuActions } from './main_page/frontend/ui/menu-actions-advanced.ts';
import { installPrefsSync } from './main_page/frontend/ui/prefs-sync.ts';
import { createRecentsController } from './main_page/frontend/ui/recents.ts';
import { createPreferencesController } from './main_page/frontend/ui/preferences.ts';
import { createProjectSwitchController } from './main_page/frontend/ui/project-switch.ts';
import { createCacheIndicatorController } from './main_page/frontend/ui/cache-indicator.ts';
import { initDrawerAndShortcuts } from './main_page/frontend/ui/drawer-shortcuts.ts';
import { initPanelsAndDrawer } from './main_page/frontend/ui/panels-drawer.ts';
import { initSidebarShortcutsSafe } from './main_page/frontend/ui/sidebar-shortcuts-bootstrap.ts';
import { initResponsiveLayout } from './main_page/frontend/ui/layout-manager.ts';
import { createFileStatusController } from './main_page/frontend/ui/file-status.ts';
import { createSettingsBootstrap } from './main_page/frontend/ui/settings-bootstrap.ts';
import { createAutosaveModalController } from './main_page/frontend/ui/autosave-modal.ts';
import { createAutosaveRuntimeController } from './main_page/frontend/ui/autosave-runtime.ts';
import { showProjectsDebugModal } from './main_page/frontend/ui/projects-debug-modal.ts';
import { initWatcherUI, drainPendingWatcherEvents, showWatcherLimitModal } from './main_page/frontend/ui/watcher-settings.ts';
import { createUiIpcConnections } from './main_page/frontend/connections/ui-ipc.ts';
import { EXPLORER_RPC_NOTIFICATIONS } from './src/explorer/rpc/contract.ts';
import { notifyExplorerRpc, requestExplorerRpc } from './src/explorer/rpc/client.ts';
import { createFileWebSocketManager } from './main_page/frontend/connections/file-websocket.ts';
import { createFileSyncHandler } from './main_page/frontend/connections/file-sync-handler.ts';
import { ensureSocketIoLoaded, ensureVConsoleLoaded } from './main_page/frontend/connections/vendor-loaders.ts';
import { createSessionTelemetryController } from './main_page/frontend/boot/session-telemetry.ts';
import { createEditorStateController } from './main_page/frontend/boot/editor-state.ts';
import { runBootSequence } from './main_page/frontend/boot/boot-sequence.ts';
import { installBeforeExitGuard } from './main_page/frontend/boot/public-hooks.ts';
import { createStateInitController } from './main_page/frontend/boot/state-init.ts';
import { createBootSequenceDeps } from './main_page/frontend/boot/sequence-deps.ts';
import { applyNoProjectState, applyRestoredPathState, schedulePathDisplayFallback, applyNoRestoredPathState } from './main_page/frontend/boot/path-state.ts';
import { installHostExitGuard } from './main_page/frontend/boot/exit-guard.ts';
import { createSaveSocketController } from './main_page/frontend/file-ops/save-socket.ts';
import { createSaveFlowController } from './main_page/frontend/file-ops/save-flow.ts';
import { createOpenFlowController } from './main_page/frontend/file-ops/open-flow.ts';
import { createRunFileController } from './main_page/frontend/file-ops/run-file.ts';
import { createApiClient } from './main_page/frontend/core/api-client.ts';
import { bootInlineEditorHost } from './monaco_editor/inline_host.ts';
import { createHostChromeRuntime } from './main_page/frontend/host-chrome-runtime.ts';
import { createHostStateRuntime } from './main_page/frontend/host-state-runtime.ts';
import { createHostEditorEventsRuntime } from './main_page/frontend/host-editor-events-runtime.ts';
import { createHostSidebarRuntime } from './main_page/frontend/host-sidebar-runtime.ts';
import { captureHostElements } from './main_page/frontend/host-elements.ts';

let problemsPanel = { show() {}, hide() {}, update() {}, destroy() {}, get isVisible() { return false; } };

import { initResizeManager, loadLayoutPreferences } from './main_page/frontend/host-resize-manager.ts';

let _latestUiPrefs = {};
let _hasUiPrefsSnapshot = false;
const _uiPrefsWaiters = [];
let editorViewState = null; // Loaded from backend at startup via /editor/view_state
let cachedProjectRoot = null;
// Host file-state must be declared before any early reconciler/helper functions
// that read or write it, otherwise the built host bundle can split the binding.
let currentPath = '';
let currentPathExists = false;
let lastSavedContent = '';
let unsaved = false;
var restoredSessionActive = false;
var restoredSessionPath = null;
let currentModeLanguage = null;
let lastPickerPath = HOME_DIR;

function _resolveUiPrefsWaiters(ui) {
  if (!_uiPrefsWaiters.length) return;
  while (_uiPrefsWaiters.length) {
    const resolve = _uiPrefsWaiters.shift();
    try {
      resolve(ui);
    } catch (_) {}
  }
}

function waitForInitialUiPrefs(timeoutMs = 2200) {
  if (_hasUiPrefsSnapshot) {
    return Promise.resolve(_latestUiPrefs || {});
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(_latestUiPrefs || {});
    }, Math.max(300, timeoutMs || 0));
    _uiPrefsWaiters.push((ui) => {
      clearTimeout(timer);
      resolve(ui || {});
    });
  });
}

function _isMobileLayout() {
  try {
    const root = document.querySelector('.fe-root');
    if (root && root.classList.contains('layout-mobile')) return true;
    if (root && root.classList.contains('layout-desktop')) return false;

    // Fallback for early boot / unexpected DOM state.
    const isDesktop = window.matchMedia('(min-width: 768px) and (orientation: landscape)').matches;
    return !isDesktop;
  } catch (_) {
    return true;
  }
}

function _emitSidebarIpc(eventName, payload) {
  uiIpcConnections.emitSidebarIpc(eventName, payload);
}

// Ensure lastSha256 exists before any cache-state events fire.
var lastSha256 = null;
// `explorer:event` may arrive before helper functions are defined; keep a stable symbol.
// This is NOT a suppression: we queue the latest indicator payload and replay it once
// the real implementation is installed.
var applyCacheIndicator = function (info) {
  try { window.__fePendingCacheIndicator = info; } catch (_) {}
};

function _applyHostActivePath(filePath, options = {}) {
  const normalizedPath = (typeof filePath === 'string' && filePath) ? filePath : '';
  if (!normalizedPath) return;

  try { currentPath = normalizedPath; } catch (_) {}
  try { currentPathExists = true; } catch (_) {}
  try {
    const trimmed = normalizedPath.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    lastPickerPath = idx > 0 ? trimmed.slice(0, idx) : '/';
  } catch (_) {}
  try { currentModeLanguage = detectLanguageFromFilename(normalizedPath); } catch (_) {}
  try { if (problemsPanel.setActiveFile) problemsPanel.setActiveFile(normalizedPath); } catch (_) {}

  const trimmed = normalizedPath.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  const expectedName = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  const nameEl = window.fileNameEl || fileNameEl || null;
  const forceToolbar = !!(options && options.forceToolbar);
  const toolbarStale = !!(
    nameEl
    && (
      nameEl.textContent !== expectedName
      || nameEl.title !== expectedName
    )
  );

  try {
    if (typeof updatePathDisplay === 'function') updatePathDisplay();
    else if (typeof window.updatePathDisplay === 'function') window.updatePathDisplay();
    else if (forceToolbar || toolbarStale || !nameEl) setToolbarFileName(expectedName);
  } catch (_) {
    try {
      if (forceToolbar || toolbarStale || !nameEl) setToolbarFileName(expectedName);
    } catch (_) {}
  }
}

function _setHostCurrentPathOnly(path) {
  if (typeof path === 'string' && path) {
    _applyHostActivePath(path);
    return;
  }
  try { currentPath = ''; } catch (_) {}
}

function _issuesDumpRequestOnce() {
  return uiIpcConnections.requestBackendEditorIssuesDump({
    request_id: `issues_dump_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  });
}

// ─── UI IPC (frontend ↔ inline editor relay) ──────────────────────
const uiIpcConnections = createUiIpcConnections({
  ensureSocketIoLoaded,
  initConsoleBridge,
  getClientId: () => clientId,
});
function connectSidebarIPC() {
  uiIpcConnections.connectSidebarIPC();
}

function connectUIIPC() {
  return uiIpcConnections.connectUIIPC();
}
// ─── End UI IPC ───────────────────────────────────────────────────

// ---- host/api contract (injected by framework) ----
/* global host, api */
export default async function initFileEditor(rootEl, api, host) {
const appContext = createAppContext({ rootEl, api, host });
window.__feAppContext = appContext;
window.host = appContext.host;
window.api  = appContext.api;

const hostElements = captureHostElements(requireEl);
const {
  cacheStateBadge,
  container,
  editorFrameEl,
  root,
  toolbarEl,
  titleBlockEl,
  leftToolbarControlEl,
  rightToolbarControlEl,
  agentDrawerEl,
  fileNameEl,
  fileNameScrollEl,
  issuesToggleBtn,
  issuesPrevBtn,
  issuesNextBtn,
  issuesBadgesEl,
  statusEl,
  editTrackerStatusEl,
  menuFileBtn,
  menuFileDD,
  menuEditBtn,
  menuEditDD,
  menuEditorBtn,
  menuEditorDD,
  menuViewBtn,
  menuViewDD,
  recentFilesBtn,
  recentFilesDD,
  runActiveBtn,
  miNew,
  miOpen,
  miSave,
  miSaveAs,
  miClose,
  miQuit,
  miDebugProjects,
  miUndo,
  miRedo,
  miCut,
  miCopy,
  miPaste,
  miSelectAll,
  miToggleLines,
  miToggleSyntax,
  miToggleCloseBrackets,
  miToggleAutocomplete,
  miToggleShading,
  miToggleIndentGuides,
  miToggleWrap,
  miToggleAutosave,
  miToggleDiffs,
  miToggleDraftDiffs,
  miToggleColorPicker,
  miToggleReadonly,
  miToggleStickyScroll,
  miTrackEdits,
  miTrackAgentSidebarEdits,
  miFind,
  miGoto,
  miExportDiagnostics,
  miEditorSettings,
  miToggleMinimap,
  editorSettingsModal,
  editorSettingsClose,
  editorSettingsExtStrip,
  editorSettingsExtSummary,
  editorSettingsThemeStrip,
  editorSettingsThemeSummary,
  editorThemesModal,
  editorThemesClose,
  editorThemesList,
  editorExtManagerModal,
  editorExtManagerClose,
  editorExtManagerInstallBtn,
  editorExtManagerList,
  extCustomSettingsInput,
  extCustomSettingsSave,
  extConfigModal,
  extConfigTitle,
  extConfigClose,
  extConfigForm,
  extConfigCancel,
  extConfigSave,
} = hostElements;
Object.assign(appContext.elements, {
  cacheStateBadge,
  container,
  editorFrame: editorFrameEl,
  root,
  agentDrawerEl,
});

// Title/status & chrome
window.fileNameEl = fileNameEl;
const hostChromeRuntime = createHostChromeRuntime({
  root,
  toolbarEl,
  titleBlockEl,
  leftToolbarControlEl,
  rightToolbarControlEl,
  agentDrawerEl,
  fileNameEl,
  fileNameScrollEl,
  issuesToggleBtn,
  issuesPrevBtn,
  issuesNextBtn,
  issuesBadgesEl,
  isMobileLayout: () => _isMobileLayout(),
  basename,
  toAbsolute,
  homeDir: HOME_DIR,
  getCurrentPath: () => currentPath,
  getCachedProjectRoot: () => cachedProjectRoot,
  getProblemsDetail: () => problemsPanel.getDetail ? problemsPanel.getDetail() : {},
  pickerAvailable: () => pickerController.pickerAvailable(),
  saveFileWithPicker: (options) => window.teFilePicker.saveFile(options),
  apiPost: (path, body) => apiPost(path, body),
  getClientId: () => clientId,
  requestBackendEditorIssuesCommand: (payload) => uiIpcConnections.requestBackendEditorIssuesCommand(payload),
  toast: (message, kind) => host.toast(message, kind),
  confirm: (message) => window.confirm(message),
});
const {
  formatFileNameDisplay,
  scheduleToolbarTitleClamp,
  setToolbarFileName,
  initToolbarTitleClampObservers,
  setIssuesButtonsEnabled,
  exportDiagnosticsToFile,
} = hostChromeRuntime;
hostChromeRuntime.install();
const hostStateRuntime = createHostStateRuntime({
  updateLspSpinner: () => {
    const ui = window.__feAdapterUi;
    if (ui && typeof ui.updateLspSpinner === 'function') {
      ui.updateLspSpinner();
    }
  },
  applyActiveFilePath: (filePath) => _applyHostActivePath(filePath, { forceToolbar: true }),
  log: (...args) => console.log(...args),
});
hostStateRuntime.install();
const hostEditorEventsRuntime = createHostEditorEventsRuntime({
  applyCacheIndicator: (info) => applyCacheIndicator(info),
  triggerExternalRefresh: (path) => triggerExternalRefresh(path),
  applyAutosavePreference: (autoSave) => {
    if (!editorViewState || typeof editorViewState !== 'object') editorViewState = {};
    editorViewState.autoSave = autoSave;
    preferencesController.applyStateToMenus(editorViewState);
  },
  setLastSha256: (sha) => { lastSha256 = sha; },
  getRestoredSessionActive: () => !!restoredSessionActive,
  setRestoredSessionActive: (flag) => { restoredSessionActive = !!flag; },
  setRestoredSessionPath: (path) => { restoredSessionPath = path; },
  getCurrentPath: () => currentPath || '',
  queueSessionStateUpdate: (partial) => queueSessionStateUpdate(partial),
  apiPost: (path, body) => apiPost(path, body),
  issuesBadgesEl,
  setIssuesButtonsEnabled: (enabled) => setIssuesButtonsEnabled(enabled),
  toast: (message, timeoutMs) => host.toast(message, timeoutMs),
  log: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
});
hostEditorEventsRuntime.install();
function ensureEditorFrameReady() {
  return hostEditorEventsRuntime.ensureEditorFrameReady();
}
function _awaitEditorOpen(requestId, path, timeoutMs) {
  return hostEditorEventsRuntime.awaitEditorOpen(requestId, path, timeoutMs);
}

createSettingsBootstrap({
  els: {
    settingsModal: editorSettingsModal,
    settingsClose: editorSettingsClose,
    menuEditorSettings: miEditorSettings,
    extManagerModal: editorExtManagerModal,
    extManagerClose: editorExtManagerClose,
    settingsExtStrip: editorSettingsExtStrip,
    themesModal: editorThemesModal,
    themesClose: editorThemesClose,
    themesList: editorThemesList,
    settingsThemeStrip: editorSettingsThemeStrip,
    settingsThemeSummary: editorSettingsThemeSummary,
    extConfigModal,
    extConfigTitle,
    extConfigForm,
    extConfigClose,
    extConfigCancel,
    extConfigSave,
    extManagerInstallBtn: editorExtManagerInstallBtn,
    extCustomSettingsInput,
    extCustomSettingsSave,
    extSummary: editorSettingsExtSummary,
    extManagerList: editorExtManagerList,
  },
  closeAllMenus,
  getEditorViewState: () => editorViewState,
  setEditorTheme: (themeId) => {
    editorViewState = editorViewState || {};
    editorViewState.theme = themeId;
  },
  updatePreference: (key, value) => preferencesController.updatePreference(key, value),
  pickerAvailable: () => pickerController.pickerAvailable(),
  pickFile: (startPath) => pickFile(startPath),
  getStartPath: () => lastPickerPath || HOME_DIR,
  busRequest: (method, payload, timeoutMs) => requestExplorerRpc(method, payload, timeoutMs),
  busNotify: (method, payload) => notifyExplorerRpc(method, payload),
  reloadEditorFrame: _reloadEditorFrame,
  toast: (msg, ms) => host.toast(msg, ms),
});

function shouldUseLocalKeyboardViewportAdjustments() {
  try {
    return document.documentElement?.dataset?.shellMode !== 'mobile-tab';
  } catch (_) {
    return true;
  }
}

if (shouldUseLocalKeyboardViewportAdjustments()) {
  initVirtualKeyboardAdjustments({
    root,
  });
}


// ---------- Session telemetry ----------
async function fetchPersistedSessionState() {
  return sessionTelemetry.fetchPersistedSessionState();
}

function seedPersistedSessionState(snapshot) {
  return sessionTelemetry.seedPersistedSessionState(snapshot);
}

function initSessionStateContext(serverState) {
  sessionTelemetry.initSessionStateContext(serverState);
}

function queueSessionStateUpdate(partial = null) {
  sessionTelemetry.queueSessionStateUpdate(partial);
}

async function flushSessionState(force = false) {
  return sessionTelemetry.flushSessionState(force);
}

function syncSessionPath(extra = {}) {
  sessionTelemetry.syncSessionPath(extra);
}

// ---------- Edit Tracker ----------
const editTrackerController = createEditTrackerController({
  apiPost,
  getEditorViewState: () => editorViewState,
  getCurrentPath: () => currentPath,
  openFile: (path, opts) => openFile(path, opts),
  jumpToCurrentFileLine: (line) => jumpToCurrentFileLine(line),
  statusEl: editTrackerStatusEl,
});
const fontScaleController = createFontScaleController({
  presets: FONT_SCALE_PRESETS,
  updatePreference: (key, value) => preferencesController.updatePreference(key, value),
  scheduleToolbarTitleClamp: (opts) => scheduleToolbarTitleClamp(opts),
  toast: (msg, kind) => host.toast(msg, kind),
});
function applyFontScale(scale) {
  fontScaleController.applyFontScale(scale);
}

function updateFontScaleMenuChecks(currentScale) {
  fontScaleController.updateFontScaleMenuChecks(currentScale);
}

// ---------- Editor state ----------
// Preferences are managed by backend; frontend displays state only (no caching)

let editorState = null;
let branchMenuHandle = null;
let sidebarShortcuts = null;
const hostSidebarRuntime = createHostSidebarRuntime({
  drawerEl: agentDrawerEl,
  toggleButtonEl: document.getElementById('fe-agent-toggle'),
  closeButtonEl: document.getElementById('agent-close'),
  emitSidebarEvent: _emitSidebarIpc,
});
hostSidebarRuntime.install();
let sessionState = {
  activeProject: null,
  currentPath: null,
  unsaved: false,
  lastSha256: null,
  updatedAt: null,
};
const sessionTelemetry = createSessionTelemetryController({
  apiPost,
  getActiveProjectFallback: () => cachedProjectRoot || (editorState && editorState.activeProject) || null,
  getCurrentPath: () => currentPath || null,
  getLastSha256: () => lastSha256,
  getUnsaved: () => !!unsaved,
});
sessionState = sessionTelemetry.sessionState;
let externalRefreshInProgress = false;

function resetActiveFileState({ resetPicker = false } = {}) {
  fileWebSocketManager.closeWebSocket();
  currentPath = '';
  currentPathExists = false;
  if (resetPicker) lastPickerPath = HOME_DIR;
  currentModeLanguage = null;
  lastSha256 = null;
  lastSavedContent = '';
  markUnsaved(false);
  updatePathDisplay();
  syncSessionPath();
}

window.__cm6HandleUiPrefs = function(payload) {
  try {
    const ui =
      payload && typeof payload.ui === 'object' && payload.ui
        ? payload.ui
        : {};
    _latestUiPrefs = { ...ui };
    _hasUiPrefsSnapshot = true;
    _resolveUiPrefsWaiters(_latestUiPrefs);
    try {
      sidebarShortcuts?.applyUiPrefs?.(_latestUiPrefs);
    } catch (e) {
      console.warn('[Sidebar] Failed to apply sidebar prefs:', e);
    }
  } catch (err) {
    console.warn('[AgentPrefs] Failed to apply prefs:setUi payload:', err);
  }
};

try {
  if (window.__cm6PendingUiPrefs) {
    window.__cm6HandleUiPrefs(window.__cm6PendingUiPrefs);
    window.__cm6PendingUiPrefs = null;
  }
} catch (_) {}

// WebSocket and autosave state
let editTrackerWS = null;
let clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
let cm6NiceguiClientId = null;
var lastSha256 = null;
// Keep early bootstrap handlers from hitting TDZ on debounce constants.
try {
  if (typeof window.__feCursorStateDebounceMs !== 'number') window.__feCursorStateDebounceMs = 1000;
} catch (_) {}
let inflightOpId = null;
const AUTOSAVE_IDLE_DELAY = 1200; // manual saves / disabled autosave
const AUTOSAVE_ACTIVE_DELAY = 450; // faster loop while autosave is ON
let lastSaveTime = 0;
const SELF_ECHO_GRACE = 1800; // 1.8s grace period after save (avoid cursor jumps on slow typing)
const saveSocketController = createSaveSocketController({
  requestBackendFileSave: (payload) => uiIpcConnections.requestBackendFileSave(payload),
});
const autosaveRuntimeController = createAutosaveRuntimeController({
  idleDelayMs: AUTOSAVE_IDLE_DELAY,
  activeDelayMs: AUTOSAVE_ACTIVE_DELAY,
  getAutoSaveEnabled: () => !!(editorViewState?.autoSave),
  getNativeSelectionActive: () => !!nativeSelectionActive,
  getUnsaved: () => !!unsaved,
  getCurrentPath: () => currentPath,
  getCurrentPathExists: () => !!currentPathExists,
  saveFile: (opts) => saveFile(opts),
  onAutosaveError: (err) => console.error('Autosave failed:', err),
});

// Use `var` so early Socket.IO events can't hit TDZ before initialization.
var lastScrollState = null;
var scrollStateTimer = null;
const CURSOR_STATE_DEBOUNCE = 1000; // ms

// ── Adapter dropdown (context menu on status indicator) ──────────────
const adapterUi = createAdapterUiController({
  closeAllMenus: () => menuCoreController.closeAllMenus(),
  spinnerSetStep: (msg) => hostStateRuntime.spinnerSetStep(msg),
  setWorkbenchAdapterState: ({ readyOk, connecting }) => {
    hostStateRuntime.setWorkbenchAdapterState({ readyOk, connecting });
  },
  toast: (msg, ms) => host.toast(msg, ms),
});
window.__feAdapterUi = adapterUi;

function _closeAdapterDropdown() {
  adapterUi.closeAdapterDropdown();
}

function _openAdapterDropdown() {
  adapterUi.openAdapterDropdown();
}

async function _requestAdapterRestart() {
  return adapterUi.requestAdapterRestart();
}

function _reloadEditorFrame() {
  adapterUi.reloadEditorFrame();
}

window.__cm6HandleLspStatusUpdate = adapterUi.handleLspStatusUpdate;

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


function markUnsaved(flag) {
  const next = !!flag;
  cacheStateBadge.dataset.state = next ? (cacheStateBadge.dataset.state || '') : '';
  unsaved = next;
  fileNameEl.classList.toggle('fe-unsaved', unsaved);
  syncSessionPath();
  if (!unsaved) autosaveRuntimeController.cancelAutosave();
  if (unsaved && editorViewState?.autoSave) {
    autosaveRuntimeController.scheduleAutosave();
  }
}

// ---------- API helpers ----------
const apiClient = createApiClient(api);
async function apiGet(path) {
  return apiClient.apiGet(path);
}
async function apiPost(path, body) {
  return apiClient.apiPost(path, body);
}

// Live draft/autosave propagation is handled by the dedicated editor Socket.IO channel.
const searchPanelController = createSearchPanelController({
  getCurrentPath: () => currentPath || null,
  getProjectRoot: () => cachedProjectRoot || null,
  requestBackendEditorFind: (payload) => uiIpcConnections.requestBackendEditorFind(payload),
  toast: (msg) => host.toast(msg),
});

// ---------- Unified Preference Management (Backend as Single Source of Truth) ----------
const preferencesController = createPreferencesController({
  apiPost: (path, body) => apiPost(path, body),
  requestBackendEditorPreferenceUpdate: (payload) => uiIpcConnections.requestBackendEditorPreferenceUpdate(payload),
  getClientId: () => cm6NiceguiClientId,
  setEditorViewState: (state) => { editorViewState = state; },
  setMenuChecked,
  applyFontScale: (scale) => applyFontScale(scale),
  getMenuItems: () => ({
    miToggleLines,
    miToggleSyntax,
    miToggleCloseBrackets,
    miToggleAutocomplete,
    miToggleShading,
    miToggleIndentGuides,
    miToggleWrap,
    miToggleAutosave,
    miToggleDiffs,
    miToggleDraftDiffs,
    miToggleColorPicker,
    miToggleReadonly,
    miToggleMinimap,
    miToggleStickyScroll,
    miTrackEdits,
    miTrackAgentSidebarEdits,
  }),
});

installPrefsSync({
  getClientId: () => cm6NiceguiClientId,
  setEditorViewState: (state) => { editorViewState = state; },
  applyStateToMenus: (state) => preferencesController.applyStateToMenus(state),
});

const recentsController = createRecentsController({
  recentFilesDD,
  recentFilesBtn,
  formatFileNameDisplay: (name) => formatFileNameDisplay(name),
  openFile: (path) => openFile(path),
});
recentsController.installWindowHook();

// Synchronize host + inline editor when a project is opened in the explorer.
// Called from Explorer runtime via window.__cm6HandleProjectOpened(path).
const projectSwitchController = createProjectSwitchController({
  getTerminal: () => terminal,
  closeWebSocket: () => fileWebSocketManager.closeWebSocket(),
  resetHostState: () => {
    currentPath = '';
    currentPathExists = false;
    lastSha256 = null;
    lastSavedContent = '';
  },
  markUnsaved: (flag) => markUnsaved(flag),
  updatePathDisplay: () => updatePathDisplay(),
  syncSessionPath: () => syncSessionPath(),
  syncEditorState: (forceRefresh) => editorStateController.syncEditorState(forceRefresh),
  broadcastRecentsUpdate: (state) => recentsController.broadcastRecentsUpdate(state),
  getBranchMenuHandle: () => branchMenuHandle,
  reloadEditorSurface: () => window.location.reload(),
});

// Expose for Explorer runtime (project:opened handler)
projectSwitchController.installWindowHook();

const editorStateController = createEditorStateController({
  getEditorState: () => editorState,
  setEditorState: (state) => { editorState = state; },
  getCachedProjectRoot: () => cachedProjectRoot,
  setCachedProjectRoot: (path) => { cachedProjectRoot = path; },
  getCurrentPath: () => currentPath,
  setCurrentPath: (path) => { _setHostCurrentPathOnly(path); },
  reconcileCurrentPath: (path) => { _applyHostActivePath(path, { forceToolbar: true }); },
  requestBackendEditorGitBaselines: (payload) => uiIpcConnections.requestBackendEditorGitBaselines(payload),
  getEditorViewState: () => editorViewState,
  updatePreference: (key, value) => preferencesController.updatePreference(key, value),
  openFile: (path, opts) => openFile(path, opts),
});

editorStateController.installWindowHooks();

// ---------- WebSocket management ----------
const fileSyncHandler = createFileSyncHandler({
  getLastSaveTime: () => lastSaveTime,
  getInflightOpId: () => inflightOpId,
  selfEchoGraceMs: SELF_ECHO_GRACE,
  toAbsolute,
  homeDir: HOME_DIR,
  getCurrentPath: () => currentPath,
  setCurrentPath: (path) => { _setHostCurrentPathOnly(path); },
  updatePathDisplay: () => updatePathDisplay(),
  setLastSavedContent: (content) => { lastSavedContent = content; },
  getLastSha256: () => lastSha256,
  setLastSha256: (sha) => { lastSha256 = sha; },
  markUnsaved: (flag) => markUnsaved(flag),
  setStatus: (text) => { statusEl.textContent = text; },
  getUnsaved: () => !!unsaved,
  clearInflightOpId: () => { inflightOpId = null; },
  refreshExplorer: () => refreshExplorer(),
});
const fileWebSocketManager = createFileWebSocketManager({
  ReconnectingWebSocket,
  clientId,
  setStatus: (msg) => { statusEl.textContent = msg; },
  clearStatus: (expected, delayMs) => {
    setTimeout(() => {
      if (statusEl.textContent === expected) statusEl.textContent = '';
    }, delayMs);
  },
  onMessage: (msg) => fileSyncHandler.handleWSMessage(msg),
});

// ---------- File ops ----------
const fileStatusController = createFileStatusController({
  runActiveBtn,
  getCurrentPath: () => currentPath,
  getCurrentPathExists: () => currentPathExists,
  isRunnableFile,
  toAbsolute,
  HOME_DIR,
  basename,
  setToolbarFileName: (name) => setToolbarFileName(name),
  setIndicatorInactive: (badge) => cacheIndicatorController.setIndicatorInactive(badge),
  setIssuesButtonsEnabled: (enabled) => setIssuesButtonsEnabled(enabled),
});
function updatePathDisplay() {
  fileStatusController.updatePathDisplay();
}

const cacheIndicatorController = createCacheIndicatorController({
  getCurrentPath: () => currentPath,
  getCachedProjectRoot: () => cachedProjectRoot,
  getCurrentProjectRoot: () => stateInitController.getCurrentProjectRoot(),
  apiDelete: (path) => api.delete(path),
  openFile: (path, opts) => openFile(path, opts),
  toast: (msg) => host.toast(msg),
  markUnsaved: (flag) => markUnsaved(flag),
  getRestoredSessionActive: () => restoredSessionActive,
});

function _applyCacheIndicatorImpl(info) {
  cacheIndicatorController.applyCacheIndicator(info);
}

applyCacheIndicator = _applyCacheIndicatorImpl;
cacheIndicatorController.installWindowHook();

const openFlowController = createOpenFlowController({
  setStatus: (text) => { statusEl.textContent = text; },
  ensureProjectContext: () => editorStateController.ensureProjectContext(),
  toAbsolute,
  homeDir: HOME_DIR,
  getRestoredSessionActive: () => !!restoredSessionActive,
  getCurrentPath: () => currentPath,
  setRestoredSessionActive: (flag) => { restoredSessionActive = flag; },
  setIndicatorInactive: () => cacheIndicatorController.setIndicatorInactive(cacheStateBadge),
  apiPost: (path, body) => apiPost(path, body),
  apiGet: (path) => apiGet(path),
  setCurrentPath: (path) => { _setHostCurrentPathOnly(path); },
  setCurrentPathExists: (exists) => { currentPathExists = exists; },
  setLastPickerPath: (path) => { lastPickerPath = path; },
  parentDir,
  setCurrentModeLanguage: (lang) => { currentModeLanguage = lang; },
  detectLanguageFromFilename,
  setLastSha256: (sha) => { lastSha256 = sha; },
  requestBackendOpen: (payload) => uiIpcConnections.requestBackendFileOpen(payload),
  setLastSavedContent: (content) => { lastSavedContent = content; },
  awaitEditorOpen: (requestId, path, timeoutMs) => _awaitEditorOpen(requestId, path, timeoutMs),
  markUnsaved: (flag) => markUnsaved(flag),
  updatePathDisplay: () => updatePathDisplay(),
  syncSessionPath: () => syncSessionPath(),
  getCachedProjectRoot: () => cachedProjectRoot,
  dispatchExplorerActiveFile: (rel) => {
    dispatchExplorerNotification(EXPLORER_RPC_NOTIFICATIONS.activeFileUpdated, { rel });
  },
  openWebSocket: (path) => fileWebSocketManager.openWebSocket(path),
  getEditorState: () => editorState,
  setEditorState: (state) => { editorState = state; },
  setCachedProjectRoot: (path) => { cachedProjectRoot = path; },
  broadcastRecentsUpdate: (state) => recentsController.broadcastRecentsUpdate(state),
  syncEditorState: (force) => editorStateController.syncEditorState(force),
  getSessionStateActiveProject: () => sessionState.activeProject || null,
  setSessionStateActiveProject: (path) => { sessionState.activeProject = path; },
  jumpToCurrentFileLine: (line, opts) => jumpToCurrentFileLine(line, opts),
  toast: (msg) => host.toast(msg),
});

async function openFile(path, options = {}) {
  return openFlowController.openFile(path, options);
}

const saveFlowController = createSaveFlowController({
  clientId,
  setInflightOpId: (id) => { inflightOpId = id; },
  setLastSaveTime: (ts) => { lastSaveTime = ts; },
  getLastSha256: () => lastSha256,
  setLastSha256: (sha) => { lastSha256 = sha; },
  setLastSavedContent: (content) => { lastSavedContent = content; },
  markUnsaved: (flag) => markUnsaved(flag),
  syncSessionPath: () => syncSessionPath(),
  apiPost: (path, body) => apiPost(path, body),
  apiGet: (path) => apiGet(path),
  saveFileViaEditorSocket: (payload, timeoutMs) => saveSocketController.saveFileViaEditorSocket(payload, timeoutMs),
  setStatus: (text) => { statusEl.textContent = text; },
  getUnsaved: () => !!unsaved,
  toast: (msg) => host.toast(msg),
  pickSaveTarget: () => pickerController.pickSaveTarget(),
  toAbsolute,
  homeDir: HOME_DIR,
  setCurrentPath: (path) => { _setHostCurrentPathOnly(path); },
  setCurrentPathExists: (exists) => { currentPathExists = exists; },
  setLastPickerPath: (path) => { lastPickerPath = path; },
  setCurrentModeLanguage: (lang) => { currentModeLanguage = lang; },
  parentDir,
  detectLanguageFromFilename,
  updatePathDisplay: () => updatePathDisplay(),
  openFile: (path, options) => openFile(path, options),
  closeWebSocket: () => fileWebSocketManager.closeWebSocket(),
  openWebSocket: (path) => fileWebSocketManager.openWebSocket(path),
  getCachedProjectRoot: () => cachedProjectRoot,
  getEditorState: () => editorState,
  setEditorState: (state) => { editorState = state; },
  setCachedProjectRoot: (path) => { cachedProjectRoot = path; },
});

 // getAgentHostBase
async function saveFile(opts) {
  return saveFlowController.saveFile({
    currentPath,
    currentPathExists,
    isAutosave: !!(opts && opts.isAutosave),
    onMissingPath: () => saveFlowController.saveAsDialog(),
  });
}

const runFileController = createRunFileController({
  getCurrentPath: () => currentPath,
  getCurrentPathExists: () => currentPathExists,
  isRunnableFile,
  setRunButtonDisabled: (flag) => { runActiveBtn.disabled = !!flag; },
  saveFile: () => saveFile(),
  openTerminal: async () => {
    if (terminal && typeof terminal.open === 'function') await terminal.open();
  },
  apiPost: (path, body) => apiPost(path, body),
  requestBackendRunActiveFile: (payload) => uiIpcConnections.requestBackendRunActiveFile(payload),
  basename,
  toast: (msg) => host.toast(msg),
  updateRunButtonState: () => fileStatusController.updateRunButtonState(),
});

// Autosave confirmation modal (constructed lazily)
const autosaveModalController = createAutosaveModalController();

// Watcher UI (extracted to main_page/frontend/ui/watcher-settings.js)
initWatcherUI(appContext);

sidebarShortcuts = initSidebarShortcutsSafe({
  initSidebarShortcuts,
  host,
  homeDir: HOME_DIR,
  pickFile,
  openDrawer: () => hostSidebarRuntime.openDrawer(),
  closeAllMenus,
  setMenuChecked,
  emitSidebarIpc: _emitSidebarIpc,
});

drainPendingWatcherEvents();

// Projects debug modal extracted to main_page/frontend/ui/projects-debug-modal.js

// ---------- Picker helpers (shared modal provided by framework) ----------
const pickerController = createPickerController({
  pickFileWithPicker,
  pickDirectoryWithPicker,
  pickSaveTargetWithPicker,
  pickerAvailable: () => pickerUiAvailable(),
  getCurrentPath: () => currentPath,
  getLastPickerPath: () => lastPickerPath,
  setLastPickerPath: (path) => { lastPickerPath = path; },
  homeDir: HOME_DIR,
  toAbsolute,
  parentDir,
  basename,
  toast: (m) => host.toast(m),
});
async function pickFile(startPath) {
  return pickerController.pickFile(startPath);
}

const jumpLineController = createJumpLineController({
  getCurrentPath: () => currentPath,
  requestBackendEditorJumpToLine: (payload) => uiIpcConnections.requestBackendEditorJumpToLine(payload),
  toast: (msg) => host.toast(msg),
});

// Helper: Jump to line in current file
async function jumpToCurrentFileLine(line, options = {}) {
  return jumpLineController.jumpToCurrentFileLine(line, options);
}

// Expose for search overlay
window.jumpToCurrentFileLine = jumpToCurrentFileLine;

// ---------- Menu & keyboard wiring ----------
const menuCoreController = createMenuCoreController({
  menuFileDD,
  menuEditDD,
  menuEditorDD,
  menuViewDD,
  recentFilesDD,
  getAgentShortcutLoadDD: () => hostSidebarRuntime.getShortcutLoadDropdown(),
  getAgentShortcutLoadBtn: () => hostSidebarRuntime.getShortcutLoadButton(),
  getBranchMenuHandle: () => branchMenuHandle,
  menuFileBtn,
  menuEditBtn,
  menuEditorBtn,
  menuViewBtn,
  recentFilesBtn,
  runActiveBtn,
  runCurrentFile: () => runFileController.runCurrentFile(),
});
menuCoreController.installPrimaryMenuButtons();

function closeAllMenus() {
  return menuCoreController.closeAllMenus();
}
function bindMenuToggle(el, action) {
  return menuCoreController.bindMenuToggle(el, action);
}

installBasicMenuActions({
  bindMenuToggle,
  els: {
    miNew,
    miOpen,
    miSave,
    miSaveAs,
    miClose,
    miQuit,
    miDebugProjects,
    miExportDiagnostics,
    miUndo,
    miRedo,
    miCut,
    miCopy,
    miPaste,
    miSelectAll,
    miFind,
    miGoto,
  },
  resetToNewFile: () => resetActiveFileState({ resetPicker: true }),
  pickFile: () => pickFile(),
  openFile: (path) => openFile(path),
  saveFile: () => saveFile(),
  saveAsDialog: () => saveFlowController.saveAsDialog(),
  closeWebSocket: () => fileWebSocketManager.closeWebSocket(),
  clearOnQuit: () => resetActiveFileState(),
  showProjectsDebugModal,
  exportDiagnosticsToFile: () => exportDiagnosticsToFile(),
  triggerEditorSearchPanel: (reason, opts) => searchPanelController.triggerEditorSearchPanel(reason, opts),
  jumpToCurrentFileLine: (line) => jumpToCurrentFileLine(line),
  toast: (msg) => host.toast(msg),
});

installSimplePreferenceMenuActions({
  bindMenuToggle,
  els: {
    miToggleLines,
    miToggleShading,
    miToggleIndentGuides,
    miToggleSyntax,
    miToggleCloseBrackets,
    miToggleAutocomplete,
    miToggleWrap,
    miToggleColorPicker,
    miToggleMinimap,
    miToggleStickyScroll,
  },
  getEditorViewState: () => editorViewState,
  updatePreference: (key, value) => preferencesController.updatePreference(key, value),
  toast: (msg) => host.toast(msg),
});

installAdvancedMenuActions({
  bindMenuToggle,
  els: {
    miToggleAutosave,
    miToggleDiffs,
    miToggleDraftDiffs,
    miToggleReadonly,
    miTrackEdits,
    miTrackAgentSidebarEdits,
  },
  getEditorViewState: () => editorViewState,
  updatePreference: (key, value) => preferencesController.updatePreference(key, value),
  setMenuChecked,
  getCurrentPath: () => currentPath,
  getCurrentPathExists: () => currentPathExists,
  showAutosaveModal: (fileLabel, hasOtherDrafts) => autosaveModalController.showAutosaveModal(fileLabel, hasOtherDrafts),
  basename,
  getUnsaved: () => !!unsaved,
  saveFile: () => saveFile(),
  apiPost: (path, body) => apiPost(path, body),
  markUnsaved: (flag) => markUnsaved(flag),
  toast: (msg, kind) => host.toast(msg, kind),
});

const { terminal, consoleDrawer, problemsPanel: drawerProblemsPanel } = initPanelsAndDrawer({
  createTerminalDrawer,
  createConsoleDrawer,
  createProblemsPanel,
  initDrawerAndShortcuts,
  bindMenuToggle,
  requireEl,
  hostToast: (msg) => host.toast(msg),
  setFontScale: (preset) => fontScaleController.setFontScale(preset),
  triggerEditorSearchPanel: (reason, opts) => searchPanelController.triggerEditorSearchPanel(reason, opts),
  openFile: (path, opts) => openFile(path, opts),
  jumpToCurrentFileLine: (line) => jumpToCurrentFileLine(line),
  requestDiagnosticsMention: (payload) => uiIpcConnections.requestBackendDiagnosticsMention(payload),
  saveFile: () => saveFile(),
  resetToNewFile: () => resetActiveFileState({ resetPicker: true }),
  openPickedFile: () => {
    pickFile().then((p) => { if (p) openFile(p); });
  },
});
problemsPanel = drawerProblemsPanel;

// ---------- State load/init ----------
// host.setTitle('Code CM6');
const stateInitController = createStateInitController({
  openFile: (path) => openFile(path),
  toast: (msg) => host.toast(msg),
  toAbsolute,
  getBaseDir: (projectRoot) => projectRoot || cachedProjectRoot || HOME_DIR,
  homeDir: HOME_DIR,
  syncEditorState: (force) => editorStateController.syncEditorState(force),
});
stateInitController.installOpenHooks();

runBootSequence(createBootSequenceDeps({
    initResponsiveLayout: () => initResponsiveLayout({ scheduleToolbarTitleClamp: (opts) => scheduleToolbarTitleClamp(opts) }),
    initToolbarTitleClampObservers: () => initToolbarTitleClampObservers(),
    loadLayoutPreferences: () => loadLayoutPreferences(),
    initResizeManager: () => initResizeManager(),
    initExplorerUI: () => initExplorerUI({
      ensureSocketIoLoaded,
      homeDir: HOME_DIR,
      toAbsolute,
      getActiveProjectPath: () => sessionTelemetry.activeProjectPath() || null,
      getSessionActiveProject: () => sessionState.activeProject || null,
      applyHostActivePath: (path, options) => _applyHostActivePath(path, options),
      updateProblemsPanel: (payload) => problemsPanel.update(payload),
      reloadEditorFrame: () => _reloadEditorFrame(),
      requestAdapterRestart: () => _requestAdapterRestart(),
    }),
    connectUIIPC: () => connectUIIPC(),
    connectSidebarIPC: () => connectSidebarIPC(),
    ensureWorkbenchAdapterReady: () => hostStateRuntime.ensureWorkbenchAdapterReady(),
    initBranchMenu: () => initBranchMenu(),
    waitForInitialUiPrefs: (ms) => waitForInitialUiPrefs(ms),
    seedUiPrefsSnapshot: (prefs) => window.__cm6HandleUiPrefs({ ui: prefs || {} }),
    applySidebarUiPrefs: (prefs) => sidebarShortcuts?.applyUiPrefs?.(prefs || {}),
    syncEditorState: (force) => editorStateController.syncEditorState(force),
    hydrateEditorState: (state) => editorStateController.hydrateEditorState(state),
    broadcastRecentsUpdate: (state) => recentsController.broadcastRecentsUpdate(state),
    refreshMenuState: () => preferencesController.refreshMenuState(),
    apiPost: (path, body) => apiPost(path, body),
    fetchPersistedSessionState: () => fetchPersistedSessionState(),
    seedPersistedSessionState: (snapshot) => seedPersistedSessionState(snapshot),
    initSessionStateContext: (serverState) => initSessionStateContext(serverState),
    queueSessionStateUpdate: (partial) => queueSessionStateUpdate(partial),
    resetSavedState: () => { lastSavedContent = ''; },
    markUnsaved: (flag) => markUnsaved(flag),
    setNoProjectState: (msg) => applyNoProjectState({
      statusEl,
      setToolbarFileName: (name) => setToolbarFileName(name),
      setIssuesButtonsEnabled: (enabled) => setIssuesButtonsEnabled(enabled),
      message: msg,
    }),
    getUrlSearch: () => window.location.search,
    toAbsolute,
    HOME_DIR,
    applyRestoredPathState: ({ restoredPath, serverState, restoredSha }) => applyRestoredPathState({
      restoredPath,
      serverState,
      restoredSha,
      parentDir,
      detectLanguageFromFilename,
      syncSessionPath: () => syncSessionPath(),
      setCurrentPath: (path) => { _setHostCurrentPathOnly(path); },
      setCurrentPathExists: (exists) => { currentPathExists = exists; },
      setLastPickerPath: (path) => { lastPickerPath = path; },
      setLastSha256: (sha) => { lastSha256 = sha; },
      setCurrentModeLanguage: (lang) => { currentModeLanguage = lang; },
    }),
    openWebSocket: (path) => fileWebSocketManager.openWebSocket(path),
    updatePathDisplayFallbackLater: () => schedulePathDisplayFallback({
      getCurrentPath: () => currentPath,
      updatePathDisplay: () => updatePathDisplay(),
      delayMs: 2000,
    }),
    openFile: (path) => {
      lastPickerPath = parentDir(path);
      return openFile(path);
    },
    onOpenFileFailure: (e) => {
      host.toast(`Failed to open file: ${e.message}`);
      resetActiveFileState();
    },
    onNoRestoredPath: (serverState) => applyNoRestoredPathState({
      serverState,
      setStatus: (msg) => { statusEl.textContent = msg; },
    }),
    setBranchMenuHandle: (h) => { branchMenuHandle = h; },
    requestBackendBootSnapshot: (payload) => uiIpcConnections.requestBackendBootSnapshot(payload),
    mountInlineEditorHost: (snapshot) => bootInlineEditorHost(editorFrameEl, {
      ensureSocketIoLoaded,
      bootSnapshot: snapshot,
    }),
  })).then(() => {
  try { sidebarShortcuts?.init?.(); } catch (e) { console.warn('[Sidebar] init failed:', e); }

  const deferHydrate = typeof requestIdleCallback === 'function'
    ? (fn) => requestIdleCallback(fn)
    : (fn) => setTimeout(fn, 0);
  deferHydrate(() => {
    try {
      void ensureEditorFrameReady()
        .then(() => Promise.resolve(sidebarShortcuts?.hydrate?.()))
        .catch((e) => {
          console.warn('[Sidebar] deferred hydrate failed:', e);
        });
    } catch (e) {
      console.warn('[Sidebar] deferred hydrate failed:', e);
    }
  });
});

installHostExitGuard({
  installBeforeExitGuard,
  onBeforeExit: (cb) => host.onBeforeExit(cb),
  getUnsaved: () => !!unsaved,
  showConfirm: () => showConfirm(),
  toast: (msg) => host.toast(msg),
  flushSessionState: (force) => flushSessionState(force),
});

}
