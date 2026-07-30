import {
  getBootSnapshotHostState,
  getBootSnapshotCodeInspector,
  getBootSnapshotCodeServer,
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
  loadLayoutPreferences(): void;
  initResizeManager(): void;
  initExplorerUI(): Promise<unknown>;
  connectUIIPC(): void | Promise<unknown>;
  connectSidebarIPC(): void;
  ensureWorkbenchAdapterReady(): Promise<unknown>;
  requestBackendCodeServerInstall(payload?: Record<string, unknown>): Promise<unknown>;
  spinnerSetStep(title: string, failed?: boolean): void;
  initBranchMenu(): unknown;
  waitForInitialUiPrefs(ms?: number): Promise<Record<string, unknown>>;
  seedUiPrefsSnapshot(prefs: Record<string, unknown>): void;
  applySidebarUiPrefs(prefs: Record<string, unknown>): void;
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
  openFile(path: string): Promise<unknown>;
  onOpenFileFailure(err: Error): void;
  onNoRestoredPath(serverState: Record<string, unknown>): void;
  setBranchMenuHandle(handle: unknown): void;
  requestBackendBootSnapshot(payload?: Record<string, unknown>): Promise<unknown>;
  mountInlineEditorHost(snapshot: HostBootSnapshot | null): Promise<unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function prepareCodeServer(
  snapshot: HostBootSnapshot | null,
  uiPrefs: Record<string, unknown>,
  deps: BootSequenceDeps,
): Promise<boolean> {
  const prerequisite = getBootSnapshotCodeServer(snapshot);
  if (!prerequisite || prerequisite.compatible === true) return true;

  const foundPackage = asString(prerequisite.code_server_version);
  const foundCode = asString(prerequisite.code_version);
  const foundExecutable = asString(prerequisite.executable);
  const installVersion = asString(prerequisite.install_version) || '4.130.0';
  const installPrefix = asString(prerequisite.install_prefix);
  const reason = asString(prerequisite.reason) || 'A compatible Code Server installation was not found.';
  const found = foundExecutable
    ? `\n\nDetected: ${foundPackage ? `Code Server ${foundPackage}` : 'Code Server'}${foundCode ? ` / Code ${foundCode}` : ''}\n${foundExecutable}`
    : '';
  const workers = uiPrefs.webWorkersEnabled === true
    ? 'Monaco language web workers are already enabled.'
    : 'You can enable the bundled Monaco language web workers later in Settings.';
  const androidNote = prerequisite.android === true
    ? '\n\nOn Android this downloads about 165 MiB, installs about 709 MiB under TE2 data, and may install its Termux runtime dependencies.'
    : '';

  let result: Awaited<ReturnType<typeof window.teUI.dialog.open>>;
  try {
    result = await window.teUI.dialog.open({
      kind: 'confirm',
      title: 'Enable VS Code Extensions',
      message: `${reason}${found}`,
      detail: [
        `Install Code Server ${installVersion} into TE2's private runtime?`,
        installPrefix,
        '',
        'This does not replace your normal Code Server installation.',
        `If you continue without it, VS Code extensions stay disabled. ${workers}${androidNote}`,
      ].filter(Boolean).join('\n'),
      severity: 'warning',
      actions: [
        { id: 'continue', label: 'Continue Without Extensions', role: 'cancel' },
        { id: 'install', label: `Install ${installVersion}`, role: 'accept', primary: true },
      ],
      defaultAction: 'install',
      cancelAction: 'continue',
      width: 'medium',
    });
  } catch (error) {
    console.warn('[code-server] prerequisite dialog failed:', error);
    return false;
  }

  if (result.status !== 'accepted' || result.action !== 'install') {
    console.info('[code-server] continuing without the VS Code extension host');
    return false;
  }

  deps.spinnerSetStep(`Installing Code Server ${installVersion}\u2026`);
  try {
    const response = asRecord(await deps.requestBackendCodeServerInstall({ confirmed: true }));
    const data = asRecord(response?.data);
    if (!response || response.ok === false || data?.compatible !== true) {
      throw new Error(asString(response?.error) || 'The private Code Server installation did not become ready.');
    }
    deps.spinnerSetStep('Starting extension host\u2026');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.spinnerSetStep('Code Server installation failed', true);
    await window.teUI.dialog.alert(message, {
      title: 'Code Server Installation Failed',
      severity: 'danger',
    });
    return false;
  }
}

export async function runBootSequence(deps: BootSequenceDeps): Promise<void> {
  deps.initResponsiveLayout();
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
  window.dispatchEvent(
    new CustomEvent('cm6:code-inspector-hydrate', {
      detail: { projection: getBootSnapshotCodeInspector(bootSnapshot) },
    }),
  );

  deps.setBranchMenuHandle(deps.initBranchMenu());

  const useWorkbenchAdapter = await prepareCodeServer(bootSnapshot, snapshotUiPrefs, deps);
  if (useWorkbenchAdapter) {
    try { await deps.ensureWorkbenchAdapterReady(); } catch (error) { console.warn('Workbench adapter readiness failed:', error); }
  }
  try { await deps.connectUIIPC(); } catch (error) { console.warn('Failed to connect UI IPC channel:', error); }
  try { await deps.mountInlineEditorHost(bootSnapshot); } catch (error) { console.error('Inline editor boot failed:', error); }

  try { deps.connectSidebarIPC(); } catch (error) { console.warn('Failed to connect Sidebar IPC channel:', error); }

  const initialUiPrefs = Object.keys(snapshotUiPrefs).length
    ? snapshotUiPrefs
    : await deps.waitForInitialUiPrefs(2200);
  try { deps.applySidebarUiPrefs(initialUiPrefs || {}); } catch (error) { console.warn('[Sidebar] Failed to apply initial prefs:', error); }

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
