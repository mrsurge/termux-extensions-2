import { installGlobalOpenHooks } from './public-hooks.ts';

interface StateInitDeps {
  openFile: (path: string) => Promise<unknown>;
  toast: (msg: string) => void;
  toAbsolute: (path: string, base?: string | null, home?: string) => string;
  getBaseDir: (projectRoot?: string | null) => string;
  homeDir: string;
  syncEditorState: (force?: boolean) => Promise<Record<string, unknown> | null>;
}

export function createStateInitController(deps: StateInitDeps) {
  function installOpenHooks(): void {
    installGlobalOpenHooks({
      openFile: (path: string) => deps.openFile(path),
      toast: (msg: string) => deps.toast(msg),
      toAbsolute: deps.toAbsolute,
      getBaseDir: (projectRoot?: string | null) => deps.getBaseDir(projectRoot),
      HOME_DIR: deps.homeDir,
    });
  }

  async function getCurrentProjectRoot(forceRefresh = false): Promise<string | null> {
    const state = await deps.syncEditorState(forceRefresh);
    return typeof state?.activeProject === 'string' ? state.activeProject : null;
  }

  return { installOpenHooks, getCurrentProjectRoot };
}
