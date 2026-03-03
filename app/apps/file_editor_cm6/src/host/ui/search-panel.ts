// @ts-nocheck

/**
 * @param {{
 *   getEditorSocket: () => any,
 *   getCurrentPath: () => string | null,
 *   getProjectRoot: () => string | null,
 *   apiPost: (path: string, body: any) => Promise<any>,
 *   toast: (msg: string) => void
 * }} deps
 */
export function createSearchPanelController(deps) {
  async function triggerEditorSearchPanel(reason = 'menu', opts = {}) {
    const optsAny = /** @type {any} */ (opts || {});
    const action = optsAny && optsAny.replace ? 'replace' : 'find';
    const editorSocket = deps.getEditorSocket();
    console.log('[Find] triggerEditorSearchPanel', action, 'editorSocket connected=', editorSocket?.connected);
    if (editorSocket && editorSocket.connected) {
      editorSocket.emit('editor_find_cmd', { action, reason });
      return;
    }
    const payload = {
      path: deps.getCurrentPath() || null,
      project: deps.getProjectRoot() || null,
      reason,
    };
    const result = await deps.apiPost('editor/search/open', payload);
    if (result?.ok === false) {
      const message = result?.error || 'Search unavailable';
      deps.toast(message);
    }
  }

  return { triggerEditorSearchPanel };
}
