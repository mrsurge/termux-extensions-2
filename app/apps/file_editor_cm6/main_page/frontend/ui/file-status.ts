// @ts-check

/**
 * @param {{
 *   runActiveBtn: HTMLButtonElement | null,
 *   getCurrentPath: () => string,
 *   getCurrentPathExists: () => boolean,
 *   isRunnableFile: (path: string) => boolean,
 *   toAbsolute: (path: string, base?: any, homeDir?: string) => string,
 *   HOME_DIR: string,
 *   basename: (path: string) => string,
 *   setToolbarFileName: (name: string) => void,
 *   setIndicatorInactive: (badge: HTMLElement) => void,
 *   setIssuesButtonsEnabled: (enabled: boolean) => void,
 * }} deps
 */
export function createFileStatusController(deps: any) {
  function updateRunButtonState() {
    if (!deps.runActiveBtn) return;
    const currentPath = deps.getCurrentPath();
    const runnable = Boolean(currentPath && deps.isRunnableFile(currentPath));
    deps.runActiveBtn.disabled = !runnable;
    deps.runActiveBtn.title = runnable
      ? 'Run active file in terminal'
      : 'Open a Python, shell, JS/TS, or C/C++ source file to enable running';
  }

  function updatePathDisplay() {
    const currentPath = deps.getCurrentPath();
    const badge = document.getElementById('fe-file-draft-badge');
    if (!currentPath) {
      deps.setToolbarFileName('No file');
      if (badge) deps.setIndicatorInactive(badge);
      deps.setIssuesButtonsEnabled(false);
      updateRunButtonState();
      return;
    }
    const abs = deps.toAbsolute(currentPath, null, deps.HOME_DIR);
    deps.setToolbarFileName(deps.basename(abs));
    if (badge) deps.setIndicatorInactive(badge);
    deps.setIssuesButtonsEnabled(true);
    updateRunButtonState();
  }

  return { updateRunButtonState, updatePathDisplay };
}
