import { bootInlineEditorHost } from '../../monaco_editor/inline_host.ts';
import { runBootSequence } from './boot/boot-sequence.ts';
import {
  applyNoProjectState,
  applyNoRestoredPathState,
  applyRestoredPathState,
} from './boot/path-state.ts';
import type { ExplorerUiInitOptions } from '../../src/explorer/app/bootstrap.ts';
import type { IoFactory } from '../../src/rpc/transport.ts';
import type { UiIpcRpcMethod } from '../../src/ui_ipc/rpc_contract.ts';

type UnknownRecord = Record<string, unknown>;

interface BootProblemsPanelLike {
  update: (payload: unknown) => void;
}

interface BootSidebarShortcutsLike {
  init?: () => unknown;
  hydrate?: () => unknown;
}

interface BootStatusElementLike {
  textContent: string | null;
}

interface HostBootRuntimeDeps {
  initResponsiveLayout: () => void;
  loadLayoutPreferences: () => void;
  initResizeManager: () => void;
  initExplorerUI: (deps: ExplorerUiInitOptions) => Promise<unknown>;
  ensureSocketIoLoaded: () => Promise<IoFactory | null | undefined>;
  homeDir: string;
  toAbsolute: (path: string, base?: string | null, homeDir?: string) => string;
  getActiveProjectPath: () => string | null;
  getSessionActiveProject: () => string | null;
  applyHostActivePath: (path: string) => void;
  problemsPanel: BootProblemsPanelLike;
  reloadEditorFrame: () => void | Promise<void>;
  requestAdapterRestart: () => void | Promise<void>;
  connectUIIPC: () => void | Promise<unknown>;
  requestUiIpc: (method: UiIpcRpcMethod, params?: UnknownRecord, timeoutMs?: number) => Promise<unknown>;
  connectSidebarIPC: () => void;
  ensureWorkbenchAdapterReady: () => Promise<unknown>;
  requestBackendCodeServerInstall: (payload?: UnknownRecord) => Promise<unknown>;
  spinnerSetStep: (title: string, failed?: boolean) => void;
  initBranchMenu: (deps: { requestUiIpc: (method: UiIpcRpcMethod, params?: UnknownRecord, timeoutMs?: number) => Promise<unknown> }) => unknown;
  setBranchMenuHandle: (handle: unknown) => void;
  waitForInitialUiPrefs: (ms?: number) => Promise<UnknownRecord>;
  seedUiPrefsSnapshot: (prefs: UnknownRecord) => void;
  applySidebarUiPrefs: (prefs: UnknownRecord) => void;
  syncEditorState: (force?: boolean) => Promise<UnknownRecord | null>;
  hydrateEditorState: (state: UnknownRecord | null) => UnknownRecord | null;
  broadcastRecentsUpdate: (state: UnknownRecord | null) => void;
  refreshMenuState: () => Promise<unknown>;
  apiPost: (path: string, body: UnknownRecord) => Promise<unknown>;
  fetchPersistedSessionState: () => Promise<UnknownRecord | null>;
  seedPersistedSessionState: (snapshot: UnknownRecord | null) => UnknownRecord | null;
  initSessionStateContext: (serverState: UnknownRecord | null) => void;
  queueSessionStateUpdate: (partial?: UnknownRecord) => void;
  syncSessionPath: () => void;
  resetSavedState: () => void;
  markUnsaved: (flag: boolean) => void;
  statusEl: BootStatusElementLike;
  setIssuesButtonsEnabled: (enabled: boolean) => void;
  getUrlSearch: () => string;
  parentDir: (path: string | null | undefined) => string;
  detectLanguageFromFilename: (path: string) => string | null;
  setCurrentPath: (path: string) => void;
  setCurrentPathExists: (exists: boolean) => void;
  setLastPickerPath: (path: string) => void;
  setLastSha256: (sha: string | null) => void;
  setCurrentModeLanguage: (lang: string | null) => void;
  openWebSocket: (path: string) => void;
  openFile: (path: string) => Promise<unknown>;
  setOpenFilePickerDir: (path: string) => void;
  resetActiveFileState: () => void;
  toast: (message: string, kind?: unknown) => void;
  requestBackendBootSnapshot: (payload?: UnknownRecord) => Promise<unknown>;
  editorFrameEl: HTMLElement;
  sidebarShortcuts: BootSidebarShortcutsLike | null | undefined;
  ensureEditorFrameReady: () => Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}

function deferHostHydrate(fn: () => void): void {
  const runtimeWindow = window as Window & {
    requestIdleCallback?: (cb: () => void) => unknown;
  };
  if (typeof runtimeWindow.requestIdleCallback === 'function') {
    runtimeWindow.requestIdleCallback(fn);
    return;
  }
  window.setTimeout(fn, 0);
}

function runPostBootSidebarHydration(deps: HostBootRuntimeDeps): void {
  try {
    deps.sidebarShortcuts?.init?.();
  } catch (error) {
    console.warn('[Sidebar] init failed:', error);
  }

  deferHostHydrate(() => {
    try {
      void deps.ensureEditorFrameReady()
        .then(() => Promise.resolve(deps.sidebarShortcuts?.hydrate?.()))
        .catch((error: unknown) => {
          console.warn('[Sidebar] deferred hydrate failed:', error);
        });
    } catch (error) {
      console.warn('[Sidebar] deferred hydrate failed:', error);
    }
  });
}

export function createHostBootRuntime(deps: HostBootRuntimeDeps) {
  function start(): void {
    void runBootSequence({
      initResponsiveLayout: () => deps.initResponsiveLayout(),
      loadLayoutPreferences: () => deps.loadLayoutPreferences(),
      initResizeManager: () => deps.initResizeManager(),
      initExplorerUI: () => deps.initExplorerUI({
        ensureSocketIoLoaded: deps.ensureSocketIoLoaded,
        homeDir: deps.homeDir,
        toAbsolute: deps.toAbsolute,
        getActiveProjectPath: () => deps.getActiveProjectPath(),
        getSessionActiveProject: () => deps.getSessionActiveProject(),
        applyHostActivePath: (path) => deps.applyHostActivePath(path),
        updateProblemsPanel: (payload) => deps.problemsPanel.update(payload),
        reloadEditorFrame: () => deps.reloadEditorFrame(),
        requestAdapterRestart: () => deps.requestAdapterRestart(),
      }),
      connectUIIPC: () => deps.connectUIIPC(),
      connectSidebarIPC: () => deps.connectSidebarIPC(),
      ensureWorkbenchAdapterReady: () => deps.ensureWorkbenchAdapterReady(),
      requestBackendCodeServerInstall: (payload) => deps.requestBackendCodeServerInstall(payload),
      spinnerSetStep: (title, failed) => deps.spinnerSetStep(title, failed),
      initBranchMenu: () => deps.initBranchMenu({
        requestUiIpc: (method, params, timeoutMs) => deps.requestUiIpc(method, params || {}, timeoutMs),
      }),
      waitForInitialUiPrefs: (ms) => deps.waitForInitialUiPrefs(ms),
      seedUiPrefsSnapshot: (prefs) => deps.seedUiPrefsSnapshot(prefs || {}),
      applySidebarUiPrefs: (prefs) => deps.applySidebarUiPrefs(prefs || {}),
      syncEditorState: (force) => deps.syncEditorState(force),
      hydrateEditorState: (state) => deps.hydrateEditorState(state),
      broadcastRecentsUpdate: (state) => deps.broadcastRecentsUpdate(state),
      refreshMenuState: () => deps.refreshMenuState(),
      apiPost: (path, body) => deps.apiPost(path, body),
      fetchPersistedSessionState: () => deps.fetchPersistedSessionState(),
      seedPersistedSessionState: (snapshot) => deps.seedPersistedSessionState(snapshot),
      initSessionStateContext: (serverState) => deps.initSessionStateContext(serverState),
      queueSessionStateUpdate: (partial) => deps.queueSessionStateUpdate(partial),
      resetSavedState: () => deps.resetSavedState(),
      markUnsaved: (flag) => deps.markUnsaved(flag),
      setNoProjectState: (message) => applyNoProjectState({
        statusEl: deps.statusEl,
        setIssuesButtonsEnabled: (enabled) => deps.setIssuesButtonsEnabled(enabled),
        message,
      }),
      getUrlSearch: () => deps.getUrlSearch(),
      toAbsolute: deps.toAbsolute,
      HOME_DIR: deps.homeDir,
      applyRestoredPathState: ({ restoredPath, serverState, restoredSha }) => applyRestoredPathState({
        restoredPath,
        serverState,
        restoredSha,
        parentDir: deps.parentDir,
        detectLanguageFromFilename: deps.detectLanguageFromFilename,
        syncSessionPath: () => deps.syncSessionPath(),
        setCurrentPath: (path) => deps.setCurrentPath(path),
        setCurrentPathExists: (exists) => deps.setCurrentPathExists(exists),
        setLastPickerPath: (path) => deps.setLastPickerPath(path),
        setLastSha256: (sha) => deps.setLastSha256(sha),
        setCurrentModeLanguage: (lang) => deps.setCurrentModeLanguage(lang),
      }),
      openWebSocket: (path) => deps.openWebSocket(path),
      openFile: (path) => {
        deps.setOpenFilePickerDir(deps.parentDir(path));
        return deps.openFile(path);
      },
      onOpenFileFailure: (error) => {
        deps.toast(`Failed to open file: ${errorMessage(error)}`);
        deps.resetActiveFileState();
      },
      onNoRestoredPath: (serverState) => applyNoRestoredPathState({
        serverState,
        setStatus: (message) => { deps.statusEl.textContent = message; },
      }),
      setBranchMenuHandle: (handle) => deps.setBranchMenuHandle(handle),
      requestBackendBootSnapshot: (payload) => deps.requestBackendBootSnapshot(payload),
      mountInlineEditorHost: (snapshot) => bootInlineEditorHost(deps.editorFrameEl, {
        ensureSocketIoLoaded: deps.ensureSocketIoLoaded,
        bootSnapshot: snapshot,
      }),
    }).then(() => {
      runPostBootSidebarHydration(deps);
    });

  }

  return {
    start,
  };
}
