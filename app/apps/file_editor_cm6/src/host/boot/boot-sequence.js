// @ts-check

/**
 * @param {{
 *   initResponsiveLayout: () => void,
 *   initToolbarTitleClampObservers: () => void,
 *   loadLayoutPreferences: () => void,
 *   initResizeManager: () => void,
 *   initExplorerUI: () => Promise<any>,
 *   connectExplorerSocket: () => void,
 *   connectEditorSocket: () => void,
 *   connectUIIPC: () => void,
 *   connectSidebarIPC: () => void,
 *   ensureWorkbenchAdapterReady: () => Promise<any>,
 *   initBranchMenu: () => any,
 *   waitForInitialUiPrefs: (ms?: number) => Promise<any>,
 *   applySidebarUiPrefs: (prefs: any) => void,
 *   applyAgentRuntimeConfigFromUi: (prefs: any) => Promise<any>,
 *   connectCodexAppserverSocket: (url?: string) => void,
 *   createAgentController: (cfg: any) => any,
 *   syncEditorState: (force?: boolean) => Promise<any>,
 *   broadcastRecentsUpdate: (state: any) => void,
 *   refreshMenuState: () => Promise<any>,
 *   apiPost: (path: string, body: any) => Promise<any>,
 *   fetchPersistedSessionState: () => Promise<any>,
 *   initSessionStateContext: (serverState: any) => void,
 *   queueSessionStateUpdate: (partial?: any) => void,
 *   resetSavedState: () => void,
 *   markUnsaved: (flag: boolean) => void,
 *   setNoProjectState: (msg: string) => void,
 *   getUrlSearch: () => string,
 *   toAbsolute: (path: string, base?: any, homeDir?: string) => string,
 *   HOME_DIR: string,
 *   applyRestoredPathState: (args: { restoredPath: string, serverState: any, restoredSha: string | null }) => void,
 *   openWebSocket: (path: string) => void,
 *   updatePathDisplayFallbackLater: () => void,
 *   openFile: (path: string) => Promise<any>,
 *   onOpenFileFailure: (err: any) => void,
 *   onNoRestoredPath: (serverState: any) => void,
 *   setBranchMenuHandle: (h: any) => void,
 *   setAgentDrawerHandle: (h: any) => void
 * }} deps
 */
export async function runBootSequence(deps) {
  deps.initResponsiveLayout();
  deps.initToolbarTitleClampObservers();
  deps.loadLayoutPreferences();
  deps.initResizeManager();

  await deps.initExplorerUI().catch(e => {
    console.error('Failed to initialize explorer UI:', e);
  });

  try { deps.connectExplorerSocket(); } catch (e) { console.warn('Failed to connect explorer Socket.IO bus:', e); }
  try { deps.connectEditorSocket(); } catch (e) { console.warn('Failed to connect editor Socket.IO channel:', e); }
  try { deps.connectUIIPC(); } catch (e) { console.warn('Failed to connect UI IPC channel:', e); }
  try { deps.connectSidebarIPC(); } catch (e) { console.warn('Failed to connect Sidebar IPC channel:', e); }
  try { await deps.ensureWorkbenchAdapterReady(); } catch (e) { console.warn('Workbench adapter readiness failed:', e); }

  deps.setBranchMenuHandle(deps.initBranchMenu());
  const initialUiPrefs = await deps.waitForInitialUiPrefs(2200);
  try { deps.applySidebarUiPrefs(initialUiPrefs || {}); } catch (e) { console.warn('[Sidebar] Failed to apply initial prefs:', e); }
  const agentIframeConfig = await deps.applyAgentRuntimeConfigFromUi(initialUiPrefs);
  try { deps.connectCodexAppserverSocket(agentIframeConfig?.url); } catch (e) { console.warn('Failed to connect Codex appserver socket:', e); }
  deps.setAgentDrawerHandle(deps.createAgentController(agentIframeConfig));

  const serverState = await deps.syncEditorState(true);
  deps.broadcastRecentsUpdate(serverState);
  await deps.refreshMenuState();
  try { await deps.apiPost('editor/refresh_cache_state', {}); } catch (e) { console.warn('Failed to refresh cache state on boot:', e); }

  await deps.fetchPersistedSessionState();
  deps.initSessionStateContext(serverState);
  deps.queueSessionStateUpdate({ activeProject: serverState?.activeProject || null });
  deps.resetSavedState();
  deps.markUnsaved(false);

  if (!serverState || !serverState.activeProject || !serverState.activeProjectExists) {
    deps.setNoProjectState(serverState?.activeProjectMessage || 'Select a project to begin.');
    return;
  }

  const params = new URLSearchParams(deps.getUrlSearch());
  const fileFromUrl = params.get('file');
  const restoredPath = serverState.currentPath || serverState.lastFile;
  const restoredSha = serverState.lastFileSha256 || null;

  if (restoredPath) {
    deps.applyRestoredPathState({ restoredPath, serverState, restoredSha });
    deps.openWebSocket(restoredPath);
    console.log('[BOOT] Synced with backend SSOT:', restoredPath);
    deps.updatePathDisplayFallbackLater();
  }

  if (fileFromUrl) {
    const abs = deps.toAbsolute(fileFromUrl, null, deps.HOME_DIR);
    if (abs !== restoredPath) {
      await deps.openFile(abs).catch((e) => deps.onOpenFileFailure(e));
    }
  } else if (!restoredPath) {
    deps.onNoRestoredPath(serverState);
  }
}
