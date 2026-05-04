// @ts-check

/**
 * @param {{
 *   getTerminal: () => any,
 *   closeWebSocket: () => void,
 *   resetHostState: () => void,
 *   markUnsaved: (flag: boolean) => void,
 *   updatePathDisplay: () => void,
 *   syncSessionPath: () => void,
 *   syncEditorState: (forceRefresh?: boolean) => Promise<any>,
 *   broadcastRecentsUpdate: (state: any) => void,
 *   getBranchMenuHandle: () => any,
 *   reloadEditorSurface: () => void
 * }} deps
 */
export function createProjectSwitchController(deps: any) {
  async function handleProjectOpened(newProjectPath: string) {
    try {
      const terminal = deps.getTerminal();
      if (terminal && typeof terminal.closeAndDisconnect === 'function') terminal.closeAndDisconnect();
    } catch (err) {
      console.warn('[ProjectSwitch] Failed to close terminal drawer:', err);
    }

    deps.closeWebSocket();
    deps.resetHostState();
    deps.markUnsaved(false);
    deps.updatePathDisplay();
    deps.syncSessionPath();

    try {
      await fetch('/api/app/file_editor_cm6/editor/set_active_project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: newProjectPath }),
      });
    } catch (err) {
      console.warn('[ProjectSwitch] Failed to sync worker project root:', err);
    }

    const newState = await deps.syncEditorState(true);

    deps.broadcastRecentsUpdate(newState);
    const branchMenuHandle = deps.getBranchMenuHandle();
    if (branchMenuHandle && typeof branchMenuHandle.refresh === 'function') {
      try { branchMenuHandle.refresh(); } catch (err) {
        console.warn('[ProjectSwitch] Failed to refresh branch menu:', err);
      }
    }

    try { deps.reloadEditorSurface(); } catch (err) {
      console.warn('[ProjectSwitch] Failed to reload editor surface:', err);
    }
  }

  function installWindowHook() {
    window.__cm6HandleProjectOpened = handleProjectOpened;
  }

  return { handleProjectOpened, installWindowHook };
}
