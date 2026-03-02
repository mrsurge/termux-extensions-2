// @ts-check

/**
 * @param {{
 *   getCurrentPath: () => string,
 *   getCurrentPathExists: () => boolean,
 *   isRunnableFile: (path: string) => boolean,
 *   setRunButtonDisabled: (flag: boolean) => void,
 *   saveFile: () => Promise<any>,
 *   openTerminal: () => Promise<void>,
 *   apiPost: (path: string, body: any) => Promise<any>,
 *   basename: (path: string) => string,
 *   toast: (msg: string) => void,
 *   updateRunButtonState: () => void,
 * }} deps
 */
export function createRunFileController(deps) {
  async function runCurrentFile() {
    const currentPath = deps.getCurrentPath();
    const runnable = currentPath && deps.getCurrentPathExists() && deps.isRunnableFile(currentPath);
    if (!runnable) {
      deps.toast('Open a Python, shell, or C/C++ source file to run it in the terminal');
      return;
    }
    deps.setRunButtonDisabled(true);
    try {
      const saved = await deps.saveFile();
      if (!saved) {
        deps.toast('Save failed; not running file');
        return;
      }
      await deps.openTerminal();
      const response = await deps.apiPost('terminal/run_active_file', {});
      const isWrapped = response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'ok');
      if (isWrapped && response.ok === false) {
        deps.toast(response.error || 'Failed to run file');
      } else {
        const payload = isWrapped ? (response.data || {}) : (response || {});
        if (payload && Object.keys(payload).length > 0) {
          const preview = payload.command_preview || deps.basename(currentPath);
          deps.toast(`Running ${preview} in terminal`);
        } else {
          deps.toast('Failed to run file');
        }
      }
    } catch (err) {
      console.error('[RUN] Failed to execute file:', err);
      deps.toast(err?.message || 'Failed to run file');
    } finally {
      deps.updateRunButtonState();
    }
  }

  return { runCurrentFile };
}
