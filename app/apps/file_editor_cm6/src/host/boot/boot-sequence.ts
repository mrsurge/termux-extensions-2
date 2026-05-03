import {
  getBootSnapshotHostState,
  getBootSnapshotSessionState,
  getBootSnapshotUiPrefs,
  requestHostBootSnapshot,
  type HostBootSnapshot,
} from './boot-snapshot.ts';

interface RestoredPathStateArgs {
  restoredPath: string;
  serverState: Record<string, unknown>;
  restoredSha: string | null;
}

interface BootSequenceDeps {
  initResponsiveLayout(): void;
  initToolbarTitleClampObservers(): void;
  loadLayoutPreferences(): void;
  initResizeManager(): void;
  initExplorerUI(): Promise<unknown>;
  connectExplorerSocket(): void;
  connectUIIPC(): void | Promise<unknown>;
  connectSidebarIPC(): void;
  ensureWorkbenchAdapterReady(): Promise<unknown>;
  initBranchMenu(): unknown;
  waitForInitialUiPrefs(ms?: number): Promise<Record<string, unknown>>;
  seedUiPrefsSnapshot(prefs: Record<string, unknown>): void;
  applySidebarUiPrefs(prefs: Record<string, unknown>): void;
  applyAgentRuntimeConfigFromUi(prefs: Record<string, unknown>): Promise<unknown>;
  connectCodexAppserverSocket(url?: string): void;
  createAgentController(cfg: unknown): unknown;
  syncEditorState(force?: boolean): Promise<Record<string, unknown> | null>;
  hydrateEditorState(state: Record<string, unknown> | null): Record<string, unknown> | null;
  broadcastRecentsUpdate(state: Record<string, unknown> | null): void;
  refreshMenuState(): Promise<unknown>;
  apiPost(path: string, body: Record<string, unknown>): Promise<unknown>;
  fetchPersistedSessionState(): Promise<Record<string, unknown> | null>;
  seedPersistedSessionState(snapshot: Record<string, unknown> | null): Record<string, unknown> | null;
  initSessionStateContext(serverState: Record<string, unknown> | null): void;
  queueSessionStateUpdate(partial?: Record<string, unknown>): void;
  resetSavedState(): void;
  markUnsaved(flag: boolean): void;
  setNoProjectState(msg: string): void;
  getUrlSearch(): string;
  toAbsolute(path: string, base?: unknown, homeDir?: string): string;
  HOME_DIR: string;
  applyRestoredPathState(args: RestoredPathStateArgs): void;
  openWebSocket(path: string): void;
  updatePathDisplayFallbackLater(): void;
  openFile(path: string): Promise<unknown>;
  onOpenFileFailure(err: Error): void;
  onNoRestoredPath(serverState: Record<string, unknown>): void;
  setBranchMenuHandle(handle: unknown): void;
  setAgentDrawerHandle(handle: unknown): void;
  requestBackendBootSnapshot(payload?: Record<string, unknown>): Promise<unknown>;
  mountInlineEditorHost(snapshot: HostBootSnapshot | null): Promise<unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function runBootSequence(deps: BootSequenceDeps): Promise<void> {
  deps.initResponsiveLayout();
  deps.initToolbarTitleClampObservers();
  deps.loadLayoutPreferences();
  deps.initResizeManager();

  await deps.initExplorerUI().catch((error) => {
    console.error('Failed to initialize explorer UI:', error);
  });

  let bootSnapshot: HostBootSnapshot | null = null;
  try {
    bootSnapshot = await requestHostBootSnapshot({
      requestBackendBootSnapshot: (payload) => deps.requestBackendBootSnapshot(payload),
    });
  } catch (error) {
    console.warn('Boot snapshot request failed:', error);
  }

  const snapshotUiPrefs = getBootSnapshotUiPrefs(bootSnapshot);
  if (Object.keys(snapshotUiPrefs).length) {
    try { deps.seedUiPrefsSnapshot(snapshotUiPrefs); } catch (error) { console.warn('[Sidebar] Failed to seed snapshot prefs:', error); }
  }

  const snapshotSessionState = getBootSnapshotSessionState(bootSnapshot);
  if (snapshotSessionState) {
    deps.seedPersistedSessionState(snapshotSessionState);
  }

  const snapshotServerState = getBootSnapshotHostState(bootSnapshot);
  if (snapshotServerState) {
    deps.hydrateEditorState(snapshotServerState);
  }

  deps.setBranchMenuHandle(deps.initBranchMenu());

  try { await deps.ensureWorkbenchAdapterReady(); } catch (error) { console.warn('Workbench adapter readiness failed:', error); }
  try { await deps.connectUIIPC(); } catch (error) { console.warn('Failed to connect UI IPC channel:', error); }
  try { await deps.mountInlineEditorHost(bootSnapshot); } catch (error) { console.error('Inline editor boot failed:', error); }

  try { deps.connectExplorerSocket(); } catch (error) { console.warn('Failed to connect explorer Socket.IO bus:', error); }
  try { deps.connectSidebarIPC(); } catch (error) { console.warn('Failed to connect Sidebar IPC channel:', error); }

  const initialUiPrefs = Object.keys(snapshotUiPrefs).length
    ? snapshotUiPrefs
    : await deps.waitForInitialUiPrefs(2200);
  try { deps.applySidebarUiPrefs(initialUiPrefs || {}); } catch (error) { console.warn('[Sidebar] Failed to apply initial prefs:', error); }
  const agentIframeConfig = await deps.applyAgentRuntimeConfigFromUi(initialUiPrefs || {});
  try {
    const runtimeUrl = asRecord(agentIframeConfig)?.url;
    deps.connectCodexAppserverSocket(typeof runtimeUrl === 'string' && runtimeUrl ? runtimeUrl : undefined);
  } catch (error) {
    console.warn('Failed to connect Codex appserver socket:', error);
  }
  deps.setAgentDrawerHandle(deps.createAgentController(agentIframeConfig));

  const serverState = snapshotServerState || await deps.syncEditorState(true);
  deps.broadcastRecentsUpdate(serverState);
  await deps.refreshMenuState();
  try { await deps.apiPost('editor/refresh_cache_state', {}); } catch (error) { console.warn('Failed to refresh cache state on boot:', error); }

  if (!snapshotSessionState) {
    await deps.fetchPersistedSessionState();
  }
  deps.initSessionStateContext(serverState);
  deps.queueSessionStateUpdate({ activeProject: serverState?.activeProject || null });
  deps.resetSavedState();
  deps.markUnsaved(false);

  if (!serverState || !serverState.activeProject || !serverState.activeProjectExists) {
    deps.setNoProjectState(asString(serverState?.activeProjectMessage) || 'Select a project to begin.');
    return;
  }

  const params = new URLSearchParams(deps.getUrlSearch());
  const fileFromUrl = params.get('file');
  const restoredPath = asString(serverState.currentPath) || asString(serverState.lastFile);
  const restoredSha = asString(serverState.lastFileSha256) || null;

  if (restoredPath) {
    deps.applyRestoredPathState({ restoredPath, serverState, restoredSha });
    deps.openWebSocket(restoredPath);
    console.log('[BOOT] Synced with backend SSOT:', restoredPath);
    deps.updatePathDisplayFallbackLater();
  }

  if (fileFromUrl) {
    const abs = deps.toAbsolute(fileFromUrl, null, deps.HOME_DIR);
    if (abs !== restoredPath) {
      await deps.openFile(abs).catch((error) => deps.onOpenFileFailure(error instanceof Error ? error : new Error(String(error))));
    }
  } else if (!restoredPath) {
    deps.onNoRestoredPath(serverState);
  }
}
