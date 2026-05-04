// @ts-check

/**
 * @param {{
 *   idleDelayMs: number,
 *   activeDelayMs: number,
 *   getAutoSaveEnabled: () => boolean,
 *   getNativeSelectionActive: () => boolean,
 *   getUnsaved: () => boolean,
 *   getCurrentPath: () => string,
 *   getCurrentPathExists: () => boolean,
 *   saveFile: (opts?: any) => Promise<any>,
 *   onAutosaveError: (err: any) => void,
 * }} deps
 */
export function createAutosaveRuntimeController(deps: any) {
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelAutosave() {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
  }

  function scheduleAutosave() {
    cancelAutosave();
    if (!deps.getAutoSaveEnabled() || deps.getNativeSelectionActive()) return;
    const delay = deps.getAutoSaveEnabled() ? deps.activeDelayMs : deps.idleDelayMs;
    saveDebounceTimer = setTimeout(() => {
      if (deps.getUnsaved() && deps.getCurrentPath() && deps.getCurrentPathExists() && !deps.getNativeSelectionActive()) {
        deps.saveFile({ isAutosave: true }).then((ok: unknown) => {
          if (ok === false) console.warn('Autosave attempt failed; leaving changes unsaved');
        }).catch((err: unknown) => deps.onAutosaveError(err));
      }
    }, delay);
  }

  return { cancelAutosave, scheduleAutosave };
}
