// @ts-check

/**
 * @param {{
 *   openFile: (path: string, options?: any) => Promise<any>,
 *   toast: (msg: string) => void,
 *   toAbsolute: (path: string, base?: any, homeDir?: string) => string,
 *   getBaseDir: (projectRoot?: string | null) => string,
 *   HOME_DIR: string
 * }} deps
 */
export function installGlobalOpenHooks(deps) {
  window.appOpenFile = (absPath, options = {}) => {
    return deps.openFile(absPath, options).catch(e => {
      deps.toast(`Failed to open: ${e.message}`);
      throw e;
    });
  };

  window.appOpenFileRel = (rel, projectRoot, options = {}) => {
    const base = deps.getBaseDir(projectRoot);
    const abs = deps.toAbsolute(rel, base, deps.HOME_DIR);
    return deps.openFile(abs, options).catch(e => {
      deps.toast(`Failed to open: ${e.message}`);
      throw e;
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
