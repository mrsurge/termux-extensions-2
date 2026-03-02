// @ts-check

/**
 * @param {{
 *   statusEl: { textContent: string },
 *   setToolbarFileName: (name: string) => void,
 *   setIssuesButtonsEnabled: (enabled: boolean) => void,
 *   message: string,
 * }} deps
 */
export function applyNoProjectState(deps) {
  deps.statusEl.textContent = deps.message;
  deps.setToolbarFileName('No file');
  deps.setIssuesButtonsEnabled(false);
}

/**
 * @param {{
 *   restoredPath: string,
 *   serverState: any,
 *   restoredSha: string | null,
 *   parentDir: (path: string) => string,
 *   detectLanguageFromFilename: (path: string) => string | null,
 *   syncSessionPath: () => void,
 *   setCurrentPath: (path: string) => void,
 *   setCurrentPathExists: (exists: boolean) => void,
 *   setLastPickerPath: (path: string) => void,
 *   setLastSha256: (sha: string | null) => void,
 *   setCurrentModeLanguage: (lang: string | null) => void,
 * }} deps
 */
export function applyRestoredPathState(deps) {
  deps.setCurrentPath(deps.restoredPath);
  deps.setCurrentPathExists(!!deps.serverState.lastFileExists);
  deps.setLastPickerPath(deps.parentDir(deps.restoredPath));
  deps.setLastSha256(deps.restoredSha);
  deps.setCurrentModeLanguage(deps.detectLanguageFromFilename(deps.restoredPath));
  deps.syncSessionPath();
}

/**
 * @param {{
 *   getCurrentPath: () => string,
 *   updatePathDisplay: () => void,
 *   delayMs?: number,
 * }} deps
 */
export function schedulePathDisplayFallback(deps) {
  setTimeout(() => {
    try {
      const el = document.getElementById('fe-file-name');
      if (el && deps.getCurrentPath() && (!el.textContent || el.textContent === 'Untitled')) {
        deps.updatePathDisplay();
      }
    } catch (_) {}
  }, Math.max(0, Number(deps.delayMs || 2000)));
}

/**
 * @param {{
 *   serverState: any,
 *   setStatus: (msg: string) => void,
 * }} deps
 */
export function applyNoRestoredPathState(deps) {
  if (deps.serverState.lastFile && !deps.serverState.lastFileExists) {
    deps.setStatus(deps.serverState.lastFileMessage || 'Last file not found.');
  } else {
    deps.setStatus('Select a file to begin.');
  }
}
