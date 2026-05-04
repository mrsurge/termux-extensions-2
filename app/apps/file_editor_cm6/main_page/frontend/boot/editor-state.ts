interface HostEditorState extends Record<string, unknown> {
  activeProject?: string | null;
  activeProjectExists?: boolean;
}

interface HostEditorViewState extends Record<string, unknown> {
  showInlineDiffs?: boolean;
  showDraftDiffs?: boolean;
}

interface EditorStateControllerDeps {
  getEditorState: () => HostEditorState | null;
  setEditorState: (state: HostEditorState | null) => void;
  getCachedProjectRoot: () => string | null;
  setCachedProjectRoot: (path: string | null) => void;
  getCurrentPath: () => string | null;
  setCurrentPath: (path: string) => void;
  reconcileCurrentPath?: (path: string) => void;
  requestBackendEditorGitBaselines: (payload: Record<string, unknown>) => Promise<unknown>;
  getEditorViewState: () => HostEditorViewState | null;
  updatePreference: (key: string, value: unknown) => Promise<boolean>;
  openFile: (path: string, opts?: Record<string, unknown>) => Promise<unknown>;
}

interface EditorStateRuntimeWindow {
  __cm6EditorState?: HostEditorState | null;
  __cm6SyncState?: (forceRefresh?: boolean) => Promise<HostEditorState | null>;
  __cm6ReloadCurrentFile?: () => Promise<void>;
  __cm6RequestGitBaselines?: () => boolean;
  __cm6EnsureInlineDiffs?: (forceOn?: boolean) => Promise<boolean>;
  __cm6EnsureDraftDiffs?: (forceOn?: boolean) => Promise<boolean>;
}

function runtimeWindow(): EditorStateRuntimeWindow {
  return window as unknown as EditorStateRuntimeWindow;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function createEditorStateController(deps: EditorStateControllerDeps) {
  function hydrateEditorState(state: HostEditorState | null | undefined): HostEditorState | null {
    const nextState = state || null;
    deps.setEditorState(nextState);
    deps.setCachedProjectRoot(typeof nextState?.activeProject === 'string' ? nextState.activeProject : null);
    runtimeWindow().__cm6EditorState = nextState;
    return nextState;
  }

  async function syncEditorState(forceRefresh = false): Promise<HostEditorState | null> {
    if (!forceRefresh && deps.getEditorState()) return deps.getEditorState();
    try {
      const resp = await fetch('/api/app/file_editor_cm6/state', { cache: 'no-store' });
      const json = asRecord(await resp.json());
      const state = asRecord(json?.data) || {};
      return hydrateEditorState(state as HostEditorState);
    } catch (err) {
      console.error('Failed to fetch editor state:', err);
      return hydrateEditorState(null);
    }
  }

  async function ensureProjectContext(): Promise<HostEditorState | null> {
    const state = await syncEditorState(!deps.getCachedProjectRoot());
    if (!state || !state.activeProject || !state.activeProjectExists) return null;
    deps.setCachedProjectRoot(state.activeProject);
    return state;
  }

  function installWindowHooks(): void {
    const rw = runtimeWindow();
    rw.__cm6SyncState = syncEditorState;
    rw.__cm6ReloadCurrentFile = async function reloadCurrentFile() {
      const currentPath = deps.getCurrentPath();
      if (currentPath) await deps.openFile(currentPath, { allowOverwrite: true, forceRefresh: true });
    };

    rw.__cm6RequestGitBaselines = function requestGitBaselines() {
      try {
        const currentPath = deps.getCurrentPath();
        if (!currentPath) return false;
        void deps.requestBackendEditorGitBaselines({ path: currentPath });
        return true;
      } catch (_) {
        return false;
      }
    };

    rw.__cm6EnsureInlineDiffs = async function ensureInlineDiffsEnabled(forceOn = true) {
      if (!forceOn) return true;
      if (deps.getEditorViewState()?.showInlineDiffs) return true;
      try {
        return await deps.updatePreference('showInlineDiffs', true);
      } catch (err) {
        console.warn('Auto-enable inline diffs failed:', err);
        return false;
      }
    };

    rw.__cm6EnsureDraftDiffs = async function ensureDraftDiffsEnabled(forceOn = true) {
      if (!forceOn) return true;
      if (deps.getEditorViewState()?.showDraftDiffs) return true;
      try {
        return await deps.updatePreference('showDraftDiffs', true);
      } catch (err) {
        console.warn('Auto-enable draft diffs failed:', err);
        return false;
      }
    };

    Object.defineProperty(window, 'currentPath', {
      get: () => deps.getCurrentPath(),
      set: (value) => {
        if (typeof value === 'string' && value) {
          if (typeof deps.reconcileCurrentPath === 'function') {
            deps.reconcileCurrentPath(value);
            return;
          }
          deps.setCurrentPath(value);
          return;
        }
        deps.setCurrentPath('');
      },
      configurable: true,
    });
  }

  return { syncEditorState, ensureProjectContext, hydrateEditorState, installWindowHooks };
}
