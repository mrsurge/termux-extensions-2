import {
  getBootSnapshotHostState,
  getBootSnapshotCodeInspector,
  getBootSnapshotCodeServer,
  getBootSnapshotRunProfileState,
  getBootSnapshotSessionState,
  getBootSnapshotUiPrefs,
  requestHostBootSnapshot,
  type HostBootSnapshot,
} from './boot-snapshot.ts';
import { traceColdBoot } from '../../../monaco_editor/editor_cold_boot_trace.ts';
import { consumeProjectLaunch } from './project-launch.ts';

interface RestoredPathStateArgs {
  restoredPath: string;
  serverState: Record<string, unknown>;
  restoredSha: string | null;
}

interface BootSequenceDeps {
  initResponsiveLayout(): void;
  initResizeManager(): void;
  initExplorerUI(): Promise<unknown>;
  connectUIIPC(): void | Promise<unknown>;
  connectSidebarIPC(): void;
  ensureWorkbenchAdapterReady(): Promise<unknown>;
  requestBackendLanguageBackendSet(payload?: Record<string, unknown>): Promise<unknown>;
  spinnerSetStep(title: string, failed?: boolean): void;
  initBranchMenu(): unknown;
  waitForInitialUiPrefs(ms?: number): Promise<Record<string, unknown>>;
  seedUiPrefsSnapshot(prefs: Record<string, unknown>): void;
  setStartupInteraction?(active: boolean): void;
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
  openFile(path: string): Promise<unknown>;
  onOpenFileFailure(err: Error): void;
  onNoRestoredPath(serverState: Record<string, unknown>): void;
  setBranchMenuHandle(handle: unknown): void;
  requestBackendBootSnapshot(payload?: Record<string, unknown>): Promise<unknown>;
  mountInlineEditorHost(snapshot: HostBootSnapshot | null): Promise<unknown>;
  requestProjectDirectory(params: Record<string, unknown>): Promise<unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function withStartupInteraction<T>(deps: BootSequenceDeps, show: () => Promise<T>): Promise<T> {
  deps.setStartupInteraction?.(true);
  try {
    return await show();
  } finally {
    deps.setStartupInteraction?.(false);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function prepareCodeServer(
  snapshot: HostBootSnapshot | null,
  uiPrefs: Record<string, unknown>,
  deps: BootSequenceDeps,
): Promise<boolean> {
  if (uiPrefs.webWorkersEnabled === true) return false;

  let prerequisite = getBootSnapshotCodeServer(snapshot);
  if (prerequisite?.compatible === true) return true;

  // A host boot snapshot can have been captured while another view was still
  // installing the managed runtime. Re-read backend authority immediately
  // before presenting an install choice so a completed installation and its
  // already-running shells cannot be mistaken for a missing prerequisite.
  try {
    const refreshedSnapshot = await requestHostBootSnapshot({
      requestBackendBootSnapshot: (payload) => deps.requestBackendBootSnapshot(payload),
    });
    const refreshedUiPrefs = getBootSnapshotUiPrefs(refreshedSnapshot);
    if (Object.keys(refreshedUiPrefs).length) {
      Object.assign(uiPrefs, refreshedUiPrefs);
      deps.seedUiPrefsSnapshot(uiPrefs);
    }
    if (uiPrefs.webWorkersEnabled === true) return false;
    const refreshedPrerequisite = getBootSnapshotCodeServer(refreshedSnapshot);
    if (refreshedPrerequisite?.compatible === true) {
      prerequisite = refreshedPrerequisite;
      if (snapshot) snapshot.code_server = refreshedPrerequisite;
      return true;
    }
    prerequisite = refreshedPrerequisite || prerequisite;
  } catch (error) {
    console.warn('[code-server] prerequisite refresh failed:', error);
  }

  const installVersion = asString(prerequisite?.install_version) || '4.130.0';
  const installPrefix = asString(prerequisite?.install_prefix);
  const reason = asString(prerequisite?.reason) || "TE2's managed Code Server is not installed.";
  const androidNote = prerequisite?.android === true
    ? '\n\nOn Android this downloads about 165 MiB, installs about 709 MiB under TE2 data, and may install its Termux runtime dependencies.'
    : '';

  let result: Awaited<ReturnType<typeof window.teUI.dialog.open>>;
  try {
    result = await withStartupInteraction(deps, () => window.teUI.dialog.open({
      kind: 'confirm',
      title: 'Choose Language Backend',
      message: reason,
      detail: [
        `Install Code Server ${installVersion} into TE2's private runtime?`,
        installPrefix,
        '',
        'Code TE2 always uses this managed runtime for extension execution, VSIX management, built-in extensions, and protocol discovery.',
        `Continue without it to use Monaco's built-in JSON, CSS, HTML, and TypeScript language workers.${androidNote}`,
      ].filter(Boolean).join('\n'),
      severity: 'warning',
      actions: [
        { id: 'continue', label: 'Continue Without Extensions', role: 'cancel' },
        { id: 'install', label: `Install ${installVersion}`, role: 'accept', primary: true },
      ],
      defaultAction: 'install',
      cancelAction: 'continue',
      width: 'medium',
    }));
  } catch (error) {
    console.warn('[code-server] prerequisite dialog failed:', error);
    return false;
  }

  if (result.status !== 'accepted' || result.action !== 'install') {
    deps.spinnerSetStep('Enabling Monaco language workers\u2026');
    try {
      const response = asRecord(await deps.requestBackendLanguageBackendSet({ mode: 'web-workers' }));
      if (!response || response.ok === false) {
        throw new Error(asString(response?.error) || 'The Monaco language-worker preference was not saved.');
      }
      uiPrefs.webWorkersEnabled = true;
      if (snapshot) snapshot.ui_prefs = uiPrefs;
      deps.seedUiPrefsSnapshot(uiPrefs);
      console.info('[code-server] using Monaco language workers');
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.spinnerSetStep('Language backend update failed', true);
      await withStartupInteraction(deps, () => window.teUI.dialog.alert(message, {
        title: 'Language Backend Update Failed',
        severity: 'danger',
      }));
      return false;
    }
  }

  deps.spinnerSetStep(`Installing Code Server ${installVersion}\u2026`);
  try {
    const response = asRecord(await deps.requestBackendLanguageBackendSet({ mode: 'code-server' }));
    const data = asRecord(response?.data);
    const installedCodeServer = asRecord(data?.code_server);
    if (!response || response.ok === false || installedCodeServer?.compatible !== true) {
      throw new Error(asString(response?.error) || 'The private Code Server installation did not become ready.');
    }
    uiPrefs.webWorkersEnabled = false;
    if (snapshot) {
      snapshot.ui_prefs = uiPrefs;
      snapshot.code_server = installedCodeServer || undefined;
    }
    deps.seedUiPrefsSnapshot(uiPrefs);
    deps.spinnerSetStep('Starting extension host\u2026');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.spinnerSetStep('Code Server installation failed', true);
    await withStartupInteraction(deps, () => window.teUI.dialog.alert(message, {
      title: 'Code Server Installation Failed',
      severity: 'danger',
    }));
    return false;
  }
}

export async function runBootSequence(deps: BootSequenceDeps): Promise<void> {
  traceColdBoot('host.boot.started', {});
  deps.initResponsiveLayout();
  deps.initResizeManager();

  await deps.initExplorerUI().catch((error) => {
    console.error('Failed to initialize explorer UI:', error);
  });
  traceColdBoot('host.explorer.initialized', {});

  try { await consumeProjectLaunch({
    search: deps.getUrlSearch(),
    connect: async () => deps.connectUIIPC(),
    request: (params) => deps.requestProjectDirectory(params),
    confirm: (message, options) => withStartupInteraction(deps, () => window.teUI.dialog.confirm(message, options)),
    consume: () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('project');
      window.history.replaceState(window.history.state, '', url);
    },
  }); } catch (error) {
    await withStartupInteraction(deps, () => window.teUI.dialog.alert(
      error instanceof Error ? error.message : String(error), { title: 'Project opening failed' }));
  }

  let bootSnapshot: HostBootSnapshot | null = null;
  try {
    traceColdBoot('host.snapshot.requested', {});
    bootSnapshot = await requestHostBootSnapshot({
      requestBackendBootSnapshot: (payload) => deps.requestBackendBootSnapshot(payload),
    });
    traceColdBoot('host.snapshot.received', { available: bootSnapshot !== null });
  } catch (error) {
    traceColdBoot('host.snapshot.failed', {});
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
    new CustomEvent('code-te2:code-inspector-hydrate', {
      detail: { projection: getBootSnapshotCodeInspector(bootSnapshot) },
    }),
  );
  window.dispatchEvent(
    new CustomEvent('code-te2:run-profile-state-changed', {
      detail: getBootSnapshotRunProfileState(bootSnapshot) || {},
    }),
  );

  deps.setBranchMenuHandle(deps.initBranchMenu());

  const useWorkbenchAdapter = await prepareCodeServer(bootSnapshot, snapshotUiPrefs, deps);
  traceColdBoot('host.language_backend.prepared', { wba: useWorkbenchAdapter });
  if (useWorkbenchAdapter) {
    // Document display is independent of extension-host readiness. Existing WBA
    // state/baton handlers replay the active model when intelligence connects.
    // Keep the status/error observer, but never gate mounting Monaco on it.
    void deps.ensureWorkbenchAdapterReady().catch((error) => {
      console.warn('Workbench adapter readiness failed:', error);
    });
  }
  let uiIpcConnected = false;
  try { await deps.connectUIIPC(); uiIpcConnected = true; } catch (error) { console.warn('Failed to connect UI IPC channel:', error); }
  traceColdBoot('host.ui_ipc.complete', { connected: uiIpcConnected });
  // Snapshot seeding/live prefs handlers already apply sidebar preferences.
  // If the snapshot lacked them, settle the existing live-prefs wait before
  // Monaco measures its container, never replay the same prefs after mounting.
  if (!Object.keys(snapshotUiPrefs).length) await deps.waitForInitialUiPrefs(2200);
  traceColdBoot('host.inline_editor.mount_begin', {});
  let inlineEditorMounted = false;
  try { await deps.mountInlineEditorHost(bootSnapshot); inlineEditorMounted = true; } catch (error) {
    console.error('Inline editor boot failed:', error);
    throw error;
  }
  traceColdBoot('host.inline_editor.mount_end', { mounted: inlineEditorMounted });

  try { deps.connectSidebarIPC(); } catch (error) { console.warn('Failed to connect Sidebar IPC channel:', error); }

  const serverState = snapshotServerState || await deps.syncEditorState(true);
  deps.broadcastRecentsUpdate(serverState);
  await deps.refreshMenuState();
  // Draft/cache state arrives through editor bootstrap and live projections.

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
