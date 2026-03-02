// @ts-check

/**
 * @param {{
 *   getEditorSocket: () => any
 * }} deps
 */
export function createSaveSocketController(deps) {
  function saveFileViaEditorSocket(payload, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const editorSocket = deps.getEditorSocket();
      if (!editorSocket || !editorSocket.connected) {
        reject(new Error('Editor socket not connected'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Save timed out'));
      }, timeoutMs);
      editorSocket.emit('editor_save_request', payload, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  return { saveFileViaEditorSocket };
}
