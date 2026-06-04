// /data/data/com.termux/files/home/mrselect/app/apps/file_editor_cm6/main.ts
// app/apps/file_editor_cm6/main.ts
// Inline Monaco editor integration
import { initExplorerUI } from './src/explorer/app/bootstrap.ts';
import { dispatchExplorerNotification, refreshExplorer } from './src/explorer/app/public-api.ts';
import { createTerminalDrawer } from './main_page/frontend/host-terminal-drawer.ts';
import { initBranchMenu } from './main_page/frontend/host-git-branch-menu.ts';
// Hardcoded extension imports for now; will be dynamically loaded later.
import { initSidebarShortcuts } from './main_page/frontend/sidebar-shortcuts/runtime.ts';
import ReconnectingWebSocket from './main_page/frontend/connections/reconnecting-websocket.ts';
import { createConsoleDrawer } from './main_page/frontend/host-console-drawer.ts';
import { createProblemsPanel } from './src/diagnostics/problems-panel.ts';
import { getConsoleBridgeStatus, initConsoleBridge } from './main_page/frontend/console_bridge.js';
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
import { createStateInitController } from './main_page/frontend/boot/state-init.ts';
import { createSaveSocketController } from './main_page/frontend/file-ops/save-socket.ts';
import { createSaveFlowController } from './main_page/frontend/file-ops/save-flow.ts';
import { createOpenFlowController } from './main_page/frontend/file-ops/open-flow.ts';
import { createRunFileController } from './main_page/frontend/file-ops/run-file.ts';
import { createApiClient } from './main_page/frontend/core/api-client.ts';
import { createHostChromeRuntime } from './main_page/frontend/host-chrome-runtime.ts';
import { createHostStateRuntime } from './main_page/frontend/host-state-runtime.ts';
import { createHostEditorEventsRuntime } from './main_page/frontend/host-editor-events-runtime.ts';
import { createHostSidebarRuntime } from './main_page/frontend/host-sidebar-runtime.ts';
import { captureHostElements } from './main_page/frontend/host-elements.ts';
import { createHostUiPrefsRuntime } from './main_page/frontend/host-ui-prefs-runtime.ts';
import { createHostBootRuntime } from './main_page/frontend/host-boot-runtime.ts';
import { initResizeManager, loadLayoutPreferences } from './main_page/frontend/host-resize-manager.ts';
import type { ProblemsPanelController } from './src/diagnostics/problems-panel.ts';
import type { OpenFileOptions } from './main_page/frontend/file-ops/open-flow.ts';
import type { ScheduleToolbarTitleClampOptions } from './main_page/frontend/host-chrome-runtime.ts';
import type { SidebarIpcRpcNotificationMethod } from './src/sidebar_ipc/rpc_contract.ts';
import type { UiIpcRpcMethod } from './src/ui_ipc/rpc_contract.ts';

type UnknownRecord = Record<string, unknown>;

interface HostApi {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body: unknown) => Promise<unknown>;
  delete: (path: string) => Promise<unknown>;
  [key: string]: unknown;
}

interface HostBridge {
  toast: (message: string, kind?: unknown) => void;
  onBeforeExit: (cb: () => UnknownRecord) => void;
}

interface EditorViewState extends UnknownRecord {
  autoSave?: boolean;
  theme?: string;
}

interface EditorState extends UnknownRecord {
  activeProject?: string | null;
}

interface SessionState extends UnknownRecord {
  activeProject: string | null;
  currentPath: string | null;
  unsaved: boolean;
  lastSha256: string | null;
  updatedAt: string | null;
}

interface HostActivePathOptions {
  forceToolbar?: boolean;
}

interface SaveFileOptions {
  isAutosave?: boolean;
}

interface SidebarShortcutsLike {
  init?: () => unknown;
  hydrate?: () => unknown;
  applyUiPrefs?: (prefs: UnknownRecord) => unknown;
}

type CacheIndicatorHandler = (info: unknown) => void;
type ExplorerRpcRequestMethod = Parameters<typeof requestExplorerRpc>[0];
type ExplorerRpcRequestPayload = Parameters<typeof requestExplorerRpc>[1];
type ExplorerRpcNotifyMethod = Parameters<typeof notifyExplorerRpc>[0];
type ExplorerRpcNotifyPayload = Parameters<typeof notifyExplorerRpc>[1];

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

function asUnknownRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

// ---- host/api contract (injected by framework) ----
/* global host, api */
export default async function initFileEditor(rootEl: HTMLElement, api: HostApi, host: HostBridge) {
const appContext = createAppContext({ rootEl, api, host });
window.__feAppContext = appContext;
window.host = host;
window.api  = api;
let problemsPanel: ProblemsPanelController = {
  show() {},
  hide() {},
  update(_detail: unknown) {},
  setActiveFile(_absPath: string) {},
  destroy() {},
  getDetail() { return {}; },
  getSummary(_projectRoot?: string) { return {}; },
  get isVisible() { return false; },
};
let editorViewState: EditorViewState | null = null; // Loaded from backend at startup via /editor/view_state
let cachedProjectRoot: string | null = null;
let currentPath = '';
let currentPathExists = false;
let unsaved = false;
let restoredSessionActive = false;
let lastPickerPath = HOME_DIR;
let lastSha256: string | null = null;
// `explorer:event` may arrive before helper functions are defined; keep a stable symbol.
// This is NOT a suppression: we queue the latest indicator payload and replay it once
// the real implementation is installed.
let applyCacheIndicator: CacheIndicatorHandler = function (info: unknown) {
  try { window.__fePendingCacheIndicator = info; } catch (_) {}
};
let clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

function dispatchHostOpenStateProjection(state: UnknownRecord, source: string): void {
  const openState = asUnknownRecord(state.openState);
  const openFile = typeof openState.openFile === 'string' && openState.openFile
    ? openState.openFile
    : typeof state.currentPath === 'string' && state.currentPath
      ? state.currentPath
      : typeof state.lastFile === 'string' && state.lastFile
        ? state.lastFile
        : null;
  const projectPath = typeof openState.projectPath === 'string' && openState.projectPath
    ? openState.projectPath
    : typeof state.activeProject === 'string' && state.activeProject
      ? state.activeProject
      : null;
  const openStatePayload: UnknownRecord = {
    ...openState,
    source,
  };
  if (projectPath) openStatePayload.projectPath = projectPath;
  if (openFile) {
    openStatePayload.openFile = openFile;
    if (typeof openStatePayload.path !== 'string') openStatePayload.path = openFile;
  }
  window.dispatchEvent(new CustomEvent('cm6:open-state-changed', {
    detail: openStatePayload,
  }));
  window.dispatchEvent(new CustomEvent('cm6:active-file-changed', {
    detail: {
      ...openStatePayload,
      path: openFile,
      openState: openStatePayload,
    },
  }));
}

const uiIpcConnections = createUiIpcConnections({
  ensureSocketIoLoaded,
  initConsoleBridge,
  getClientId: () => clientId,
  onHostStateResync: async () => {
    const state = await editorStateController.syncEditorState(true);
    if (state) dispatchHostOpenStateProjection(state, 'ui_ipc_host_state_resync');
    recentsController.broadcastRecentsUpdate(state);
  },
});
function _requestSidebarUiControl(method: UiIpcRpcMethod, payload?: unknown) {
  uiIpcConnections.requestSidebarUiControl(method, asUnknownRecord(payload));
}
function _emitSidebarRpcNotification(method: SidebarIpcRpcNotificationMethod, payload?: unknown) {
  uiIpcConnections.emitSidebarRpcNotification(method, asUnknownRecord(payload));
}
function connectSidebarIPC() {
  uiIpcConnections.connectSidebarIPC();
}

function connectUIIPC() {
  return uiIpcConnections.connectUIIPC();
}

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
  miTrackAgentSidebarEdits,
  miFind,
  miGoto,
  miExportDiagnostics,
  miEditorSettings,
  miToggleMinimap,
  editorSettingsModal,
  editorSettingsClose,
  editorSettingsConsoleWorkerId,
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
  getProblemsDetail: () => problemsPanel.getDetail(),
  pickerAvailable: () => pickerController.pickerAvailable(),
  saveFileWithPicker: async (options) => window.teFilePicker?.saveFile(options) ?? null,
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
function _applyHostActivePath(filePath: unknown, options: HostActivePathOptions = {}) {
  const normalizedPath = (typeof filePath === 'string' && filePath) ? filePath : '';
  if (!normalizedPath) return;

  try { currentPath = normalizedPath; } catch (_) {}
  try { currentPathExists = true; } catch (_) {}
  try {
    const trimmed = normalizedPath.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    lastPickerPath = idx > 0 ? trimmed.slice(0, idx) : '/';
  } catch (_) {}
  try { if (problemsPanel.setActiveFile) problemsPanel.setActiveFile(normalizedPath); } catch (_) {}

  const trimmed = normalizedPath.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  const expectedName = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  const nameEl = fileNameEl || null;
  const forceToolbar = !!(options && options.forceToolbar);
  const toolbarStale = !!(
    nameEl
    && (
      nameEl.textContent !== expectedName
      || nameEl.title !== expectedName
    )
  );

  try {
    updatePathDisplay();
  } catch (_) {
    try {
      if (forceToolbar || toolbarStale || !nameEl) setToolbarFileName(expectedName);
    } catch (_) {}
  }
}

function _setHostCurrentPathOnly(path: unknown) {
  if (typeof path === 'string' && path) {
    _applyHostActivePath(path);
    return;
  }
  try { currentPath = ''; } catch (_) {}
}
hostChromeRuntime.install();
const hostStateRuntime = createHostStateRuntime({
  updateLspSpinner: () => {
    const ui = window.__feAdapterUi;
    if (ui && typeof ui.updateLspSpinner === 'function') {
      ui.updateLspSpinner();
    }
  },
  applyActiveFilePath: (filePath) => _applyHostActivePath(filePath, { forceToolbar: true }),
  clearActiveFilePath: () => {
    currentPath = '';
    currentPathExists = false;
    lastSha256 = null;
    setToolbarFileName('No file');
    setIssuesButtonsEnabled(false);
    if (runActiveBtn) {
      runActiveBtn.disabled = true;
      runActiveBtn.title = 'Open a runnable source file to enable running';
    }
  },
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
  setRestoredSessionPath: () => {},
  getCurrentPath: () => currentPath || '',
  queueSessionStateUpdate: (partial) => queueSessionStateUpdate(partial),
  updateFileScroll: (payload) => uiIpcConnections.requestBackendUpdateFileScroll(payload),
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
function _awaitEditorOpen(requestId: string, path: string, timeoutMs?: number) {
  return hostEditorEventsRuntime.awaitEditorOpen(requestId, path, timeoutMs);
}

createSettingsBootstrap({
  els: {
    settingsModal: editorSettingsModal,
    settingsClose: editorSettingsClose,
    settingsConsoleWorkerId: editorSettingsConsoleWorkerId,
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
  setEditorTheme: (themeId: string) => {
    editorViewState = editorViewState || {};
    editorViewState.theme = themeId;
  },
  updatePreference: (key: string, value: unknown) => preferencesController.updatePreference(key, value),
  pickerAvailable: () => pickerController.pickerAvailable(),
  pickFile: (startPath?: string) => pickFile(startPath),
  getStartPath: () => lastPickerPath || HOME_DIR,
  busRequest: (method: ExplorerRpcRequestMethod, payload: ExplorerRpcRequestPayload, timeoutMs?: number) => requestExplorerRpc(method, payload, timeoutMs),
  busNotify: (method: ExplorerRpcNotifyMethod, payload: ExplorerRpcNotifyPayload) => notifyExplorerRpc(method, payload),
  reloadEditorFrame: _reloadEditorFrame,
  getConsoleWorkerId: () => {
    const status = getConsoleBridgeStatus();
    return typeof status.workerId === 'string' ? status.workerId : null;
  },
  toast: (msg: string, ms?: number) => host.toast(msg, ms),
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
async function fetchPersistedSessionState(): Promise<UnknownRecord | null> {
  return sessionTelemetry.fetchPersistedSessionState();
}

function seedPersistedSessionState(snapshot: UnknownRecord | null): UnknownRecord | null {
  return sessionTelemetry.seedPersistedSessionState(snapshot);
}

function initSessionStateContext(serverState: UnknownRecord | null): void {
  sessionTelemetry.initSessionStateContext(serverState);
}

function queueSessionStateUpdate(partial: UnknownRecord | null = null): void {
  sessionTelemetry.queueSessionStateUpdate(partial);
}

async function flushSessionState(force = false): Promise<unknown> {
  return sessionTelemetry.flushSessionState(force);
}

function syncSessionPath(extra: UnknownRecord = {}): void {
  sessionTelemetry.syncSessionPath(extra);
}

const fontScaleController = createFontScaleController({
  presets: FONT_SCALE_PRESETS,
  updatePreference: (key: string, value: unknown) => preferencesController.updatePreference(key, value),
  scheduleToolbarTitleClamp: (opts?: ScheduleToolbarTitleClampOptions) => scheduleToolbarTitleClamp(opts),
  toast: (msg: string, kind?: unknown) => host.toast(msg, kind),
});
function applyFontScale(scale: number): void {
  fontScaleController.applyFontScale(scale);
}

// ---------- Editor state ----------
// Preferences are managed by backend; frontend displays state only (no caching)

let editorState: EditorState | null = null;
let branchMenuHandle: unknown = null;
let sidebarShortcuts: SidebarShortcutsLike | null = null;
const hostUiPrefsRuntime = createHostUiPrefsRuntime({
  getSidebarShortcuts: () => sidebarShortcuts,
  warn: (...args) => console.warn(...args),
});
const hostSidebarRuntime = createHostSidebarRuntime({
  drawerEl: agentDrawerEl,
  toggleButtonEl: document.getElementById('fe-agent-toggle'),
  closeButtonEl: document.getElementById('agent-close'),
  emitSidebarRpcNotification: _emitSidebarRpcNotification,
});
hostSidebarRuntime.install();
let sessionState: SessionState = {
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

function resetActiveFileState({ resetPicker = false }: { resetPicker?: boolean } = {}) {
  fileWebSocketManager.closeWebSocket();
  currentPath = '';
  currentPathExists = false;
  if (resetPicker) lastPickerPath = HOME_DIR;
  lastSha256 = null;
  markUnsaved(false);
  updatePathDisplay();
  syncSessionPath();
}

hostUiPrefsRuntime.installWindowHook();
hostUiPrefsRuntime.drainPendingUiPrefs();

// WebSocket and autosave state
// Host editor-event runtime reads this global when debouncing scroll persistence.
try {
  if (typeof window.__feCursorStateDebounceMs !== 'number') window.__feCursorStateDebounceMs = 1000;
} catch (_) {}
let inflightOpId: string | null = null;
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
  getNativeSelectionActive: () => false,
  getUnsaved: () => !!unsaved,
  getCurrentPath: () => currentPath,
  getCurrentPathExists: () => !!currentPathExists,
  saveFile: (opts: SaveFileOptions = {}) => saveFile(opts),
  onAutosaveError: (err: unknown) => console.error('Autosave failed:', err),
});

// ── Adapter dropdown (context menu on status indicator) ──────────────
const adapterUi = createAdapterUiController({
  closeAllMenus: () => menuCoreController.closeAllMenus(),
  spinnerSetStep: (msg: string) => hostStateRuntime.spinnerSetStep(msg),
  setWorkbenchAdapterState: ({ readyOk, connecting }: { readyOk?: boolean; connecting?: Promise<boolean> | null }) => {
    hostStateRuntime.setWorkbenchAdapterState({
      readyOk: !!readyOk,
      connecting: connecting instanceof Promise ? connecting : null,
    });
  },
  toast: (msg: string, ms?: number) => host.toast(msg, ms),
});
window.__feAdapterUi = adapterUi;

async function _requestAdapterRestart() {
  return adapterUi.requestAdapterRestart();
}

function _reloadEditorFrame() {
  adapterUi.reloadEditorFrame();
}

window.__cm6HandleLspStatusUpdate = adapterUi.handleLspStatusUpdate;

async function triggerExternalRefresh(path: string) {
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


function markUnsaved(flag: boolean) {
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
async function apiGet(path: string): Promise<unknown> {
  return apiClient.apiGet(path);
}
async function apiPost(path: string, body: UnknownRecord = {}): Promise<unknown> {
  return apiClient.apiPost(path, body);
}

// Live draft/autosave propagation is handled by the dedicated editor Socket.IO channel.
const searchPanelController = createSearchPanelController({
  getCurrentPath: () => currentPath || null,
  getProjectRoot: () => cachedProjectRoot || null,
  requestBackendEditorFind: (payload: UnknownRecord) => uiIpcConnections.requestBackendEditorFind(payload),
  toast: (msg: string) => host.toast(msg),
});

// ---------- Unified Preference Management (Backend as Single Source of Truth) ----------
const preferencesController = createPreferencesController({
  apiPost: (path: string, body: UnknownRecord) => apiPost(path, body),
  requestBackendEditorPreferenceUpdate: (payload: UnknownRecord) => uiIpcConnections.requestBackendEditorPreferenceUpdate(payload),
  getClientId: () => null,
  setEditorViewState: (state: EditorViewState | null) => { editorViewState = state; },
  setMenuChecked,
  applyFontScale: (scale: number) => applyFontScale(scale),
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
    miTrackAgentSidebarEdits,
  }),
});

installPrefsSync({
  getClientId: () => null,
  setEditorViewState: (state: EditorViewState | null) => { editorViewState = state; },
  applyStateToMenus: (state: EditorViewState | null) => preferencesController.applyStateToMenus(state),
});

const recentsController = createRecentsController({
  recentFilesDD,
  recentFilesBtn,
  formatFileNameDisplay: (name: string) => formatFileNameDisplay(name),
  openFile: (path: string) => openFile(path),
});
recentsController.installWindowHook();

// Synchronize host + inline editor when a project is opened over project RPC.
// Called from Explorer runtime via window.__cm6HandleProjectOpened(path, payload).
const projectSwitchController = createProjectSwitchController({
  getTerminal: () => terminal,
  closeWebSocket: () => fileWebSocketManager.closeWebSocket(),
  resetHostState: () => {
    currentPath = '';
    currentPathExists = false;
    lastSha256 = null;
  },
  markUnsaved: (flag: boolean) => markUnsaved(flag),
  updatePathDisplay: () => updatePathDisplay(),
  syncSessionPath: () => syncSessionPath(),
  syncEditorState: (forceRefresh?: boolean) => editorStateController.syncEditorState(forceRefresh),
  hydrateEditorState: (state: UnknownRecord | null) => editorStateController.hydrateEditorState(state),
  applyStateProjection: (state: UnknownRecord, source: string) => dispatchHostOpenStateProjection(state, source),
  broadcastRecentsUpdate: (state: EditorState | null) => recentsController.broadcastRecentsUpdate(state),
  getBranchMenuHandle: () => branchMenuHandle,
});

// Expose for Explorer runtime (project:opened handler)
projectSwitchController.installWindowHook();
window.addEventListener('cm6:sidebar-project-opened', (event) => {
  const payload = event instanceof CustomEvent ? asUnknownRecord(event.detail) : {};
  void projectSwitchController.handleProjectOpenedPayload(payload);
});

const editorStateController = createEditorStateController({
  getEditorState: () => editorState,
  setEditorState: (state: EditorState | null) => { editorState = state; },
  getCachedProjectRoot: () => cachedProjectRoot,
  setCachedProjectRoot: (path: string | null) => { cachedProjectRoot = path; },
  getCurrentPath: () => currentPath,
  setCurrentPath: (path: string) => { _setHostCurrentPathOnly(path); },
  reconcileCurrentPath: (path: string) => { _applyHostActivePath(path, { forceToolbar: true }); },
  requestBackendBootSnapshot: (payload?: UnknownRecord) => uiIpcConnections.requestBackendBootSnapshot(payload),
  requestBackendEditorGitBaselines: (payload: UnknownRecord) => uiIpcConnections.requestBackendEditorGitBaselines(payload),
  getEditorViewState: () => editorViewState,
  updatePreference: (key: string, value: unknown) => preferencesController.updatePreference(key, value),
  openFile: (path: string, opts?: OpenFileOptions) => openFile(path, opts),
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
  setCurrentPath: (path: string) => { _setHostCurrentPathOnly(path); },
  updatePathDisplay: () => updatePathDisplay(),
  setLastSavedContent: () => {},
  getLastSha256: () => lastSha256,
  setLastSha256: (sha: string | null) => { lastSha256 = sha; },
  markUnsaved: (flag: boolean) => markUnsaved(flag),
  setStatus: (text: string) => { statusEl.textContent = text; },
  getUnsaved: () => !!unsaved,
  clearInflightOpId: () => { inflightOpId = null; },
  refreshExplorer: () => refreshExplorer(),
});
const fileWebSocketManager = createFileWebSocketManager({
  ReconnectingWebSocket,
  clientId,
  setStatus: (msg: string) => { statusEl.textContent = msg; },
  clearStatus: (expected, delayMs) => {
    setTimeout(() => {
      if (statusEl.textContent === expected) statusEl.textContent = '';
    }, delayMs);
  },
  onMessage: (msg: unknown) => fileSyncHandler.handleWSMessage(msg),
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
  setToolbarFileName: (name: string) => setToolbarFileName(name),
  setIndicatorInactive: (badge: HTMLElement) => cacheIndicatorController.setIndicatorInactive(badge),
  setIssuesButtonsEnabled: (enabled: boolean) => setIssuesButtonsEnabled(enabled),
});
function updatePathDisplay() {
  fileStatusController.updatePathDisplay();
}

const cacheIndicatorController = createCacheIndicatorController({
  getCurrentPath: () => currentPath,
  getCachedProjectRoot: () => cachedProjectRoot,
  getCurrentProjectRoot: () => stateInitController.getCurrentProjectRoot(),
  discardDraft: (payload: UnknownRecord) => uiIpcConnections.requestBackendDraftDiscard(payload),
  toast: (msg: string) => host.toast(msg),
  markUnsaved: (flag: boolean) => markUnsaved(flag),
  getRestoredSessionActive: () => restoredSessionActive,
});

function _applyCacheIndicatorImpl(info: unknown): void {
  cacheIndicatorController.applyCacheIndicator(info);
}

applyCacheIndicator = _applyCacheIndicatorImpl;
cacheIndicatorController.installWindowHook();

const openFlowController = createOpenFlowController({
  setStatus: (text: string) => { statusEl.textContent = text; },
  ensureProjectContext: () => editorStateController.ensureProjectContext(),
  toAbsolute,
  homeDir: HOME_DIR,
  getRestoredSessionActive: () => !!restoredSessionActive,
  getCurrentPath: () => currentPath,
  setRestoredSessionActive: (flag: boolean) => { restoredSessionActive = flag; },
  setIndicatorInactive: () => cacheIndicatorController.setIndicatorInactive(cacheStateBadge),
  recordFileActivity: (payload: UnknownRecord) => uiIpcConnections.requestBackendRecordFileActivity(payload),
  setCurrentPath: (path: string) => { _setHostCurrentPathOnly(path); },
  setCurrentPathExists: (exists: boolean) => { currentPathExists = exists; },
  setLastPickerPath: (path: string) => { lastPickerPath = path; },
  parentDir,
  setCurrentModeLanguage: () => {},
  detectLanguageFromFilename,
  setLastSha256: (sha: string | null) => { lastSha256 = sha; },
  requestBackendOpen: (payload: UnknownRecord & { path: string; request_id: string }) => uiIpcConnections.requestBackendFileOpen(payload),
  setLastSavedContent: () => {},
  awaitEditorOpen: (requestId: string, path: string, timeoutMs?: number) => _awaitEditorOpen(requestId, path, timeoutMs),
  markUnsaved: (flag: boolean) => markUnsaved(flag),
  updatePathDisplay: () => updatePathDisplay(),
  syncSessionPath: () => syncSessionPath(),
  getCachedProjectRoot: () => cachedProjectRoot,
  dispatchExplorerActiveFile: (rel: string | null) => {
    dispatchExplorerNotification(EXPLORER_RPC_NOTIFICATIONS.activeFileUpdated, { rel });
  },
  openWebSocket: (path: string) => fileWebSocketManager.openWebSocket(path),
  getEditorState: () => editorState,
  setEditorState: (state: unknown) => { editorState = asUnknownRecord(state) as EditorState; },
  setCachedProjectRoot: (path: string | null) => { cachedProjectRoot = path; },
  broadcastRecentsUpdate: (state: unknown) => recentsController.broadcastRecentsUpdate(asUnknownRecord(state)),
  syncEditorState: (force?: boolean) => editorStateController.syncEditorState(force),
  getSessionStateActiveProject: () => sessionState.activeProject || null,
  setSessionStateActiveProject: (path: string | null) => { sessionState.activeProject = path; },
  jumpToCurrentFileLine: (line: number, opts?: UnknownRecord) => jumpToCurrentFileLine(line, opts),
  toast: (msg: string) => host.toast(msg),
});

async function openFile(path: string, options: OpenFileOptions = {}): Promise<unknown> {
  return openFlowController.openFile(path, options);
}

const saveFlowController = createSaveFlowController({
  clientId,
  setInflightOpId: (id: string | null) => { inflightOpId = id; },
  setLastSaveTime: (ts: number) => { lastSaveTime = ts; },
  getLastSha256: () => lastSha256,
  setLastSha256: (sha: string | null) => { lastSha256 = sha; },
  setLastSavedContent: () => {},
  markUnsaved: (flag: boolean) => markUnsaved(flag),
  syncSessionPath: () => syncSessionPath(),
  apiPost: (path: string, body: UnknownRecord) => apiPost(path, body),
  apiGet: (path: string) => apiGet(path),
  saveFileViaEditorSocket: (payload: UnknownRecord, timeoutMs?: number) => saveSocketController.saveFileViaEditorSocket(payload, timeoutMs),
  setStatus: (text: string) => { statusEl.textContent = text; },
  getUnsaved: () => !!unsaved,
  toast: (msg) => host.toast(msg),
  pickSaveTarget: () => pickerController.pickSaveTarget(),
  toAbsolute,
  homeDir: HOME_DIR,
  setCurrentPath: (path: string) => { _setHostCurrentPathOnly(path); },
  setCurrentPathExists: (exists: boolean) => { currentPathExists = exists; },
  setLastPickerPath: (path: string) => { lastPickerPath = path; },
  setCurrentModeLanguage: () => {},
  parentDir,
  detectLanguageFromFilename,
  updatePathDisplay: () => updatePathDisplay(),
  openFile: (path: string, options?: OpenFileOptions) => openFile(path, options),
  closeWebSocket: () => fileWebSocketManager.closeWebSocket(),
  openWebSocket: (path: string) => fileWebSocketManager.openWebSocket(path),
  getCachedProjectRoot: () => cachedProjectRoot,
  getEditorState: () => editorState,
  setEditorState: (state: unknown) => { editorState = state && typeof state === 'object' ? state as EditorState : null; },
  setCachedProjectRoot: (path: string | null) => { cachedProjectRoot = path; },
});

async function saveFile(opts: SaveFileOptions = {}): Promise<unknown> {
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
  setRunButtonDisabled: (flag: boolean) => { runActiveBtn.disabled = !!flag; },
  saveFile: () => saveFile(),
  openTerminal: async () => {
    if (terminal && typeof terminal.open === 'function') await terminal.open();
  },
  apiPost: (path: string, body: UnknownRecord) => apiPost(path, body),
  requestBackendRunActiveFile: (payload: UnknownRecord) => uiIpcConnections.requestBackendRunActiveFile(payload),
  basename,
  toast: (msg: string) => host.toast(msg),
  updateRunButtonState: () => fileStatusController.updateRunButtonState(),
});

// Autosave confirmation modal (constructed lazily)
const autosaveModalController = createAutosaveModalController();

// Watcher UI
initWatcherUI(appContext);

sidebarShortcuts = initSidebarShortcutsSafe({
  initSidebarShortcuts,
  host,
  homeDir: HOME_DIR,
  pickFile,
  openDrawer: () => hostSidebarRuntime.openDrawer(),
  closeAllMenus,
  setMenuChecked,
  emitSidebarUiRequest: _requestSidebarUiControl,
});

drainPendingWatcherEvents();

// ---------- Picker helpers (shared modal provided by framework) ----------
const pickerController = createPickerController({
  pickFileWithPicker,
  pickDirectoryWithPicker,
  pickSaveTargetWithPicker,
  pickerAvailable: () => pickerUiAvailable(),
  getCurrentPath: () => currentPath,
  getLastPickerPath: () => lastPickerPath,
  setLastPickerPath: (path: string) => { lastPickerPath = path; },
  homeDir: HOME_DIR,
  toAbsolute,
  parentDir,
  basename,
  toast: (m: string) => host.toast(m),
});
async function pickFile(startPath?: string): Promise<string | null> {
  return pickerController.pickFile(startPath);
}

const jumpLineController = createJumpLineController({
  getCurrentPath: () => currentPath,
  requestBackendEditorJumpToLine: (payload: UnknownRecord) => uiIpcConnections.requestBackendEditorJumpToLine(payload),
  toast: (msg: string) => host.toast(msg),
});

// Helper: Jump to line in current file
async function jumpToCurrentFileLine(line: number | string, options: UnknownRecord = {}): Promise<void> {
  await jumpLineController.jumpToCurrentFileLine(line, options);
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
function bindMenuToggle(el: HTMLElement, action: () => unknown) {
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
  openFile: (path: string) => openFile(path),
  saveFile: () => saveFile(),
  saveAsDialog: () => saveFlowController.saveAsDialog(),
  closeWebSocket: () => fileWebSocketManager.closeWebSocket(),
  clearOnQuit: () => resetActiveFileState(),
  showProjectsDebugModal,
  exportDiagnosticsToFile: () => exportDiagnosticsToFile(),
  requestBackendEditorCommand: (payload: UnknownRecord) => uiIpcConnections.requestBackendEditorCommand(payload),
  triggerEditorSearchPanel: (reason: string, opts?: UnknownRecord) => searchPanelController.triggerEditorSearchPanel(reason, opts),
  jumpToCurrentFileLine: (line: number | string) => jumpToCurrentFileLine(line),
  toast: (msg: string) => host.toast(msg),
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
  updatePreference: (key: string, value: unknown) => preferencesController.updatePreference(key, value),
  toast: (msg: string) => host.toast(msg),
});

installAdvancedMenuActions({
  bindMenuToggle,
  els: {
    miToggleAutosave,
    miToggleDiffs,
    miToggleDraftDiffs,
    miToggleReadonly,
    miTrackAgentSidebarEdits,
  },
  getEditorViewState: () => editorViewState,
  updatePreference: (key: string, value: unknown) => preferencesController.updatePreference(key, value),
  setMenuChecked,
  getCurrentPath: () => currentPath,
  getCurrentPathExists: () => currentPathExists,
  showAutosaveModal: (fileLabel: string, hasOtherDrafts: boolean) => autosaveModalController.showAutosaveModal(fileLabel, hasOtherDrafts),
  basename,
  getUnsaved: () => !!unsaved,
  saveFile: () => saveFile(),
  apiPost: (path: string, body: UnknownRecord) => apiPost(path, body),
  markUnsaved: (flag: boolean) => markUnsaved(flag),
  toast: (msg: string, kind?: unknown) => host.toast(msg, kind),
});

const { terminal, consoleDrawer, problemsPanel: drawerProblemsPanel } = initPanelsAndDrawer({
  createTerminalDrawer,
  createConsoleDrawer,
  createProblemsPanel,
  initDrawerAndShortcuts,
  bindMenuToggle,
  requireEl,
  hostToast: (msg: string) => host.toast(msg),
  setFontScale: (preset: string) => fontScaleController.setFontScale(preset),
  triggerEditorSearchPanel: (reason: string, opts?: UnknownRecord) => searchPanelController.triggerEditorSearchPanel(reason, opts),
  openFile: (path: string, opts?: OpenFileOptions) => openFile(path, opts),
  jumpToCurrentFileLine: (line: number | string) => jumpToCurrentFileLine(line),
  requestDiagnosticsMention: (payload: UnknownRecord) => uiIpcConnections.requestBackendDiagnosticsMention(payload),
  emitImeIntent: (active: boolean, params: UnknownRecord = {}) => {
    uiIpcConnections.emitUiIpcNotification(active ? 'imeFocus' : 'imeBlur', params);
  },
  saveFile: () => saveFile(),
  resetToNewFile: () => resetActiveFileState({ resetPicker: true }),
  openPickedFile: () => {
    void pickFile().then((p) => { if (p) void openFile(p); });
  },
});
window.addEventListener('cm6:preferences-changed', (event) => {
  try {
    preferencesController.applyPreferencesChangedPayload((event as CustomEvent<unknown>).detail);
  } catch (error) {
    console.warn('[Preferences] failed to apply preferences-changed event', error);
  }
});
problemsPanel = drawerProblemsPanel;

// ---------- State load/init ----------
// host.setTitle('Code CM6');
const stateInitController = createStateInitController({
  openFile: (path: string) => openFile(path),
  toast: (msg: string) => host.toast(msg),
  toAbsolute,
  getBaseDir: (projectRoot?: string | null) => projectRoot || cachedProjectRoot || HOME_DIR,
  homeDir: HOME_DIR,
  syncEditorState: (force?: boolean) => editorStateController.syncEditorState(force),
});
stateInitController.installOpenHooks();

createHostBootRuntime({
  initResponsiveLayout,
  scheduleToolbarTitleClamp: (opts?: unknown) => scheduleToolbarTitleClamp(opts as ScheduleToolbarTitleClampOptions | undefined),
  initToolbarTitleClampObservers,
  loadLayoutPreferences,
  initResizeManager,
  initExplorerUI,
  ensureSocketIoLoaded,
  homeDir: HOME_DIR,
  toAbsolute,
  getActiveProjectPath: () => sessionTelemetry.activeProjectPath() || null,
  getSessionActiveProject: () => sessionState.activeProject || null,
  applyHostActivePath: (path: string, options?: UnknownRecord) => _applyHostActivePath(path, options),
  problemsPanel,
  reloadEditorFrame: () => _reloadEditorFrame(),
  requestAdapterRestart: () => _requestAdapterRestart(),
  connectUIIPC: () => connectUIIPC(),
  connectSidebarIPC: () => connectSidebarIPC(),
  ensureWorkbenchAdapterReady: () => hostStateRuntime.ensureWorkbenchAdapterReady(),
  initBranchMenu,
  setBranchMenuHandle: (handle: unknown) => { branchMenuHandle = handle; },
  waitForInitialUiPrefs: (ms?: number) => hostUiPrefsRuntime.waitForInitialUiPrefs(ms),
  seedUiPrefsSnapshot: (prefs: UnknownRecord) => hostUiPrefsRuntime.seedUiPrefsSnapshot(prefs || {}),
  applySidebarUiPrefs: (prefs: UnknownRecord) => hostUiPrefsRuntime.applySidebarUiPrefs(prefs || {}),
  syncEditorState: (force?: boolean) => editorStateController.syncEditorState(force),
  hydrateEditorState: (state: UnknownRecord | null) => editorStateController.hydrateEditorState(state),
  broadcastRecentsUpdate: (state: UnknownRecord | null) => recentsController.broadcastRecentsUpdate(state),
  refreshMenuState: () => preferencesController.refreshMenuState(),
  apiPost: (path: string, body: UnknownRecord) => apiPost(path, body),
  fetchPersistedSessionState: () => fetchPersistedSessionState(),
  seedPersistedSessionState: (snapshot: UnknownRecord | null) => seedPersistedSessionState(snapshot),
  initSessionStateContext: (serverState: UnknownRecord | null) => initSessionStateContext(serverState),
  queueSessionStateUpdate: (partial?: UnknownRecord) => queueSessionStateUpdate(partial ?? null),
  syncSessionPath: () => syncSessionPath(),
  resetSavedState: () => {},
  markUnsaved: (flag: boolean) => markUnsaved(flag),
  statusEl,
  setToolbarFileName,
  setIssuesButtonsEnabled,
  getUrlSearch: () => window.location.search,
  parentDir,
  detectLanguageFromFilename,
  setCurrentPath: (path: string) => { _setHostCurrentPathOnly(path); },
  setCurrentPathExists: (exists: boolean) => { currentPathExists = exists; },
  setLastPickerPath: (path: string) => { lastPickerPath = path; },
  setLastSha256: (sha: string | null) => { lastSha256 = sha; },
  setCurrentModeLanguage: () => {},
  openWebSocket: (path: string) => fileWebSocketManager.openWebSocket(path),
  getCurrentPath: () => currentPath,
  updatePathDisplay: () => updatePathDisplay(),
  openFile: (path: string) => openFile(path),
  setOpenFilePickerDir: (path: string) => { lastPickerPath = path; },
  resetActiveFileState: () => resetActiveFileState(),
  toast: (message: string, kind?: unknown) => host.toast(message, kind),
  requestBackendBootSnapshot: (payload?: UnknownRecord) => uiIpcConnections.requestBackendBootSnapshot(payload),
  editorFrameEl,
  sidebarShortcuts,
  ensureEditorFrameReady: () => ensureEditorFrameReady(),
}).start();

}
