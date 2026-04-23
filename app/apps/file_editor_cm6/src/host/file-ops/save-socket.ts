// @ts-check

/**
 * @param {{
 *   requestBackendFileSave: (payload: any) => Promise<any>
 * }} deps
 */
export function createSaveSocketController(deps) {
  function saveFileViaEditorSocket(payload, timeoutMs = 8000) {
    return Promise.race([
      deps.requestBackendFileSave(payload),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Save timed out'));
        }, timeoutMs);
      }),
    ]);
  }

  return { saveFileViaEditorSocket };
}
