// @ts-check

import { installGlobalOpenHooks } from './public-hooks.js';

/**
 * @param {{
 *   openFile: (path: string) => Promise<any>,
 *   toast: (msg: string) => void,
 *   toAbsolute: (path: string, base?: string|null, home?: string) => string,
 *   getBaseDir: (projectRoot?: string | null) => string,
 *   homeDir: string,
 *   syncEditorState: (force?: boolean) => Promise<any>,
 * }} deps
 */
export function createStateInitController(deps) {
  function installOpenHooks() {
    installGlobalOpenHooks({
      openFile: (path) => deps.openFile(path),
      toast: (msg) => deps.toast(msg),
      toAbsolute: deps.toAbsolute,
      getBaseDir: (projectRoot) => deps.getBaseDir(projectRoot),
      HOME_DIR: deps.homeDir,
    });
  }

  async function getCurrentProjectRoot(forceRefresh = false) {
    const state = await deps.syncEditorState(forceRefresh);
    return state?.activeProject || null;
  }

  return { installOpenHooks, getCurrentProjectRoot };
}
