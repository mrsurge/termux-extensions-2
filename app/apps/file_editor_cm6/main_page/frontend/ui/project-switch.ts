type UnknownRecord = Record<string, unknown>;

interface TerminalLike {
  closeAndDisconnect?: () => unknown;
}

interface ProjectSwitchControllerDeps {
  getTerminal: () => TerminalLike | null | undefined;
  closeWebSocket: () => void;
  resetHostState: () => void;
  markUnsaved: (flag: boolean) => void;
  updatePathDisplay: () => void;
  syncSessionPath: () => void;
  syncEditorState: (forceRefresh?: boolean) => Promise<UnknownRecord | null>;
  hydrateEditorState?: (state: UnknownRecord | null) => UnknownRecord | null;
  applyStateProjection?: (state: UnknownRecord, source: string) => void;
  broadcastRecentsUpdate: (state: UnknownRecord | null) => void;
  getBranchMenuHandle: () => unknown;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function getProjectPathFromPayload(payload: UnknownRecord): string | null {
  return getString(payload.resolved_path) ||
    getString(payload.path) ||
    getString(payload.projectPath);
}

function getStateFromPayload(payload: UnknownRecord): UnknownRecord | null {
  return asRecord(payload.state);
}

export function createProjectSwitchController(deps: ProjectSwitchControllerDeps) {
  async function applyProjectOpenedState(statePayload: UnknownRecord | null): Promise<UnknownRecord | null> {
    if (statePayload && deps.hydrateEditorState) {
      const nextState = deps.hydrateEditorState(statePayload);
      deps.applyStateProjection?.(statePayload, 'project_opened_rpc');
      return nextState;
    }
    return deps.syncEditorState(true);
  }

  async function runProjectOpened(statePayload: UnknownRecord | null = null): Promise<void> {
    try {
      const terminal = deps.getTerminal();
      if (terminal && typeof terminal.closeAndDisconnect === 'function') {
        terminal.closeAndDisconnect();
      }
    } catch (err) {
      console.warn('[ProjectSwitch] Failed to close terminal drawer:', err);
    }

    deps.closeWebSocket();
    deps.resetHostState();
    deps.markUnsaved(false);
    deps.updatePathDisplay();
    deps.syncSessionPath();

    const newState = await applyProjectOpenedState(statePayload);

    deps.broadcastRecentsUpdate(newState);
    const branchMenuHandle = asRecord(deps.getBranchMenuHandle());
    if (branchMenuHandle && typeof branchMenuHandle.refresh === 'function') {
      try {
        branchMenuHandle.refresh();
      } catch (err) {
        console.warn('[ProjectSwitch] Failed to refresh branch menu:', err);
      }
    }
  }

  async function handleProjectOpened(newProjectPath: string, payload?: UnknownRecord): Promise<void> {
    void newProjectPath;
    await runProjectOpened(payload ? getStateFromPayload(payload) : null);
  }

  async function handleProjectOpenedPayload(payload: unknown): Promise<void> {
    const data = asRecord(payload);
    if (!data || !getProjectPathFromPayload(data)) return;
    await runProjectOpened(getStateFromPayload(data));
  }

  function installWindowHook(): void {
    window.__cm6HandleProjectOpened = handleProjectOpened;
  }

  return { handleProjectOpened, handleProjectOpenedPayload, installWindowHook };
}
