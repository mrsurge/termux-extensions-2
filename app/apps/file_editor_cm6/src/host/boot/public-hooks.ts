// @ts-check

/**
 * @param {{
 *   openFile: (path: string) => Promise<any>,
 *   toast: (msg: string) => void,
 *   toAbsolute: (path: string, base?: any, homeDir?: string) => string,
 *   getBaseDir: (projectRoot?: string | null) => string,
 *   HOME_DIR: string
 * }} deps
 */
export function installGlobalOpenHooks(deps) {
  window.appOpenFile = (absPath) => {
    deps.openFile(absPath).catch(e => {
      deps.toast(`Failed to open: ${e.message}`);
    });
  };

  window.appOpenFileRel = (rel, projectRoot) => {
    const base = deps.getBaseDir(projectRoot);
    const abs = deps.toAbsolute(rel, base, deps.HOME_DIR);
    deps.openFile(abs).catch(e => {
      deps.toast(`Failed to open: ${e.message}`);
    });
  };
}

/**
 * @param {{
 *   onBeforeExit: (cb: Function) => void,
 *   getUnsaved: () => boolean,
 *   showConfirm: () => void,
 *   toast: (msg: string) => void,
 *   flushSessionState: (force?: boolean) => Promise<any> | void
 * }} deps
 */
export function installBeforeExitGuard(deps) {
  deps.onBeforeExit(() => {
    if (deps.getUnsaved()) {
      deps.showConfirm();
      deps.toast('Unsaved changes — Save or Discard before leaving.');
      return { cancel: true };
    }
    deps.flushSessionState(true);
    return {};
  });
}
