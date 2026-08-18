import {
  getBootSnapshotHostState,
  requestHostBootSnapshot,
} from './boot-snapshot.ts';

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
  requestBackendBootSnapshot: (payload?: Record<string, unknown>) => Promise<unknown>;
  requestBackendEditorGitBaselines: (payload: Record<string, unknown>) => Promise<unknown>;
  getEditorViewState: () => HostEditorViewState | null;
  updatePreference: (key: string, value: unknown) => Promise<boolean>;
  openFile: (path: string, opts?: Record<string, unknown>) => Promise<unknown>;
}

interface EditorStateRuntimeWindow {
  __codeTe2EditorState?: HostEditorState | null;
  __codeTe2SyncState?: (forceRefresh?: boolean) => Promise<HostEditorState | null>;
  __codeTe2ReloadCurrentFile?: () => Promise<void>;
  __codeTe2RequestGitBaselines?: () => boolean;
  __codeTe2EnsureInlineDiffs?: (forceOn?: boolean) => Promise<boolean>;
  __codeTe2EnsureDraftDiffs?: (forceOn?: boolean) => Promise<boolean>;
}

function runtimeWindow(): EditorStateRuntimeWindow {
  return window as unknown as EditorStateRuntimeWindow;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function createEditorStateController(deps: EditorStateControllerDeps) {
  let syncPromise: Promise<HostEditorState | null> | null = null;

  function hydrateEditorState(state: HostEditorState | null | undefined): HostEditorState | null {
    const nextState = state || null;
    deps.setEditorState(nextState);
    deps.setCachedProjectRoot(typeof nextState?.activeProject === 'string' ? nextState.activeProject : null);
    runtimeWindow().__codeTe2EditorState = nextState;
    return nextState;
  }

  async function requestSnapshotHostState(): Promise<HostEditorState | null> {
    const snapshot = await requestHostBootSnapshot({
      requestBackendBootSnapshot: (payload) => deps.requestBackendBootSnapshot(payload),
    }, { scope: 'hostState' });
    return getBootSnapshotHostState(snapshot) as HostEditorState | null;
  }

  async function syncEditorState(forceRefresh = false): Promise<HostEditorState | null> {
    if (!forceRefresh && deps.getEditorState()) return deps.getEditorState();
    if (syncPromise) return syncPromise;
    syncPromise = requestSnapshotHostState()
      .then((state) => state ? hydrateEditorState(state) : deps.getEditorState())
      .catch((err) => {
        console.error('Failed to fetch host snapshot state:', err);
        return deps.getEditorState();
      })
      .finally(() => {
        syncPromise = null;
      });
    return syncPromise;
  }

  async function ensureProjectContext(): Promise<HostEditorState | null> {
    const state = await syncEditorState(!deps.getCachedProjectRoot());
    if (!state || !state.activeProject || !state.activeProjectExists) return null;
    deps.setCachedProjectRoot(state.activeProject);
    return state;
  }

  function installWindowHooks(): void {
    const rw = runtimeWindow();
    rw.__codeTe2SyncState = syncEditorState;
    rw.__codeTe2ReloadCurrentFile = async function reloadCurrentFile() {
      const currentPath = deps.getCurrentPath();
      if (currentPath) await deps.openFile(currentPath, { allowOverwrite: true, forceRefresh: true });
    };

    rw.__codeTe2RequestGitBaselines = function requestGitBaselines() {
      try {
        const currentPath = deps.getCurrentPath();
        if (!currentPath) return false;
        void deps.requestBackendEditorGitBaselines({ path: currentPath });
        return true;
      } catch (_) {
        return false;
      }
    };

    rw.__codeTe2EnsureInlineDiffs = async function ensureInlineDiffsEnabled(forceOn = true) {
      if (!forceOn) return true;
      if (deps.getEditorViewState()?.showInlineDiffs) return true;
      try {
        return await deps.updatePreference('showInlineDiffs', true);
      } catch (err) {
        console.warn('Auto-enable inline diffs failed:', err);
        return false;
      }
    };

    rw.__codeTe2EnsureDraftDiffs = async function ensureDraftDiffsEnabled(forceOn = true) {
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
