// @ts-check

/**
 * @param {{
 *   getEditorState: () => any,
 *   setEditorState: (state: any) => void,
 *   getCachedProjectRoot: () => string | null,
 *   setCachedProjectRoot: (path: string | null) => void,
 *   getCurrentPath: () => string,
 *   setCurrentPath: (path: string) => void,
 *   getEditorSocket: () => any,
 *   getEditorViewState: () => any,
 *   updatePreference: (key: string, value: any) => Promise<boolean>,
 *   openFile: (path: string, opts?: any) => Promise<any>
 * }} deps
 */
export function createEditorStateController(deps) {
  async function syncEditorState(forceRefresh = false) {
    if (!forceRefresh && deps.getEditorState()) return deps.getEditorState();
    try {
      const resp = await fetch('/api/app/file_editor_cm6/state', { cache: 'no-store' });
      const json = await resp.json();
      const state = json?.data || {};
      deps.setEditorState(state);
      deps.setCachedProjectRoot(state.activeProject || null);
      window.__cm6EditorState = state;
      return state;
    } catch (err) {
      console.error('Failed to fetch editor state:', err);
      deps.setEditorState(null);
      deps.setCachedProjectRoot(null);
      window.__cm6EditorState = null;
      return null;
    }
  }

  async function ensureProjectContext() {
    const state = await syncEditorState(!deps.getCachedProjectRoot());
    if (!state || !state.activeProject || !state.activeProjectExists) return null;
    deps.setCachedProjectRoot(state.activeProject);
    return state;
  }

  function installWindowHooks() {
    window.__cm6SyncState = syncEditorState;
    window.__cm6ReloadCurrentFile = async function() {
      const currentPath = deps.getCurrentPath();
      if (currentPath) await deps.openFile(currentPath, { allowOverwrite: true, forceRefresh: true });
    };

    window.__cm6RequestGitBaselines = function() {
      try {
        const editorSocket = deps.getEditorSocket();
        const currentPath = deps.getCurrentPath();
        if (!editorSocket || !editorSocket.connected) return false;
        if (!currentPath) return false;
        editorSocket.emit('editor_git_baselines_request', { path: currentPath });
        return true;
      } catch (_) {
        return false;
      }
    };

    window.__cm6EnsureInlineDiffs = async function ensureInlineDiffsEnabled(forceOn = true) {
      if (!forceOn) return true;
      if (deps.getEditorViewState()?.showInlineDiffs) return true;
      try {
        return await deps.updatePreference('showInlineDiffs', true);
      } catch (err) {
        console.warn('Auto-enable inline diffs failed:', err);
        return false;
      }
    };

    window.__cm6EnsureDraftDiffs = async function ensureDraftDiffsEnabled(forceOn = true) {
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
      set: (value) => { deps.setCurrentPath(value); },
      configurable: true,
    });
  }

  return { syncEditorState, ensureProjectContext, installWindowHooks };
}
