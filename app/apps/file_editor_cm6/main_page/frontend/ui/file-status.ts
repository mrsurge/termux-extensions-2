// @ts-check

/**
 * @param {{
 *   runActiveBtn: HTMLButtonElement | null,
 *   getCurrentPath: () => string,
 *   setIndicatorInactive: (badge: HTMLElement) => void,
 *   setIssuesButtonsEnabled: (enabled: boolean) => void,
 * }} deps
 */
export function createFileStatusController(deps: any) {
  function updateRunButtonState() {
    if (!deps.runActiveBtn) return;
    const currentPath = deps.getCurrentPath();
    const enabled = Boolean(currentPath);
    deps.runActiveBtn.disabled = !enabled;
    deps.runActiveBtn.title = enabled ? 'Run active file' : 'Open a file to enable play';
  }

  function updatePathDisplay() {
    const currentPath = deps.getCurrentPath();
    const badge = document.getElementById('fe-file-draft-badge');
    if (!currentPath) {
      if (badge) deps.setIndicatorInactive(badge);
      deps.setIssuesButtonsEnabled(false);
      updateRunButtonState();
      return;
    }
    if (badge) deps.setIndicatorInactive(badge);
    deps.setIssuesButtonsEnabled(true);
    updateRunButtonState();
  }

  return { updateRunButtonState, updatePathDisplay };
}
