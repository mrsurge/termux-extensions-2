// @ts-check

/**
 * @param {{
 *   apiPost: (path: string, body: any) => Promise<any>,
 *   getEditorViewState: () => any,
 *   getCurrentPath: () => string,
 *   openFile: (path: string) => Promise<any>,
 *   jumpToCurrentFileLine: (line: number) => void,
 *   statusEl: HTMLElement | null
 * }} deps
 */
export function createEditTrackerController(deps) {
  function connectEditTracker() {
    deps.apiPost('editor/toggle_edit_tracking', { enabled: true })
      .then(() => console.log('[EditTracker] Enabled'))
      .catch(err => console.error('[EditTracker] Failed to enable:', err));
  }

  function disconnectEditTracker() {
    deps.apiPost('editor/toggle_edit_tracking', { enabled: false })
      .then(() => console.log('[EditTracker] Disabled'))
      .catch(err => console.error('[EditTracker] Failed to disable:', err));
  }

  function updateEditTrackerStatus(status) {
    if (!deps.statusEl) return;
    if (status.active && status.shells && status.shells.length > 0) {
      const shellTypes = status.shells.map(s => s.type).join(', ');
      deps.statusEl.textContent = `🤖 Tracking (${status.shells.length} ${shellTypes})`;
      deps.statusEl.style.display = '';
    } else {
      deps.statusEl.textContent = '';
      deps.statusEl.style.display = 'none';
    }
  }

  async function autoJumpToEdit(path, line) {
    try {
      if (deps.getCurrentPath() !== path) await deps.openFile(path);
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (line > 0) deps.jumpToCurrentFileLine(line);
    } catch (e) {
      console.error('[EditTracker] Auto-jump failed:', e);
    }
  }

  function handleEditTrackerEvent(data) {
    if (data.event === 'tracking_status') {
      updateEditTrackerStatus(data);
    } else if (data.event === 'edit_tracked') {
      const viewState = deps.getEditorViewState();
      if (viewState?.trackAgentEdits || viewState?.trackAgentSidebarEdits) {
        void autoJumpToEdit(data.path, data.line);
      }
    }
  }

  return {
    connectEditTracker,
    disconnectEditTracker,
    handleEditTrackerEvent,
    updateEditTrackerStatus,
    autoJumpToEdit,
  };
}
