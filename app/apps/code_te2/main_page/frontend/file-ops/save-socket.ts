interface SaveSocketControllerDeps {
  requestBackendFileSave: (payload: Record<string, unknown>) => Promise<unknown>;
}

export function createSaveSocketController(deps: SaveSocketControllerDeps) {
  function saveFileViaEditorSocket(payload: Record<string, unknown>, timeoutMs = 8000): Promise<unknown> {
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
