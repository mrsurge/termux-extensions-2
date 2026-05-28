interface ExplorerOpenOptions extends Record<string, unknown> {
  line?: number;
  column?: number;
  focus?: boolean;
  scrollToTop?: boolean;
  scrollY?: string;
}

interface GlobalOpenHookDeps {
  openFile: (path: string, options?: ExplorerOpenOptions) => Promise<unknown>;
  toast: (msg: string) => void;
  toAbsolute: (path: string, base?: string | null, homeDir?: string) => string;
  getBaseDir: (projectRoot?: string | null) => string;
  HOME_DIR: string;
}

interface GlobalOpenRuntimeWindow {
  appOpenFile?: (absPath: string, options?: ExplorerOpenOptions) => Promise<unknown>;
  appOpenFileRel?: (rel: string, projectRoot?: string | null, options?: ExplorerOpenOptions) => Promise<unknown>;
}

function runtimeWindow(): GlobalOpenRuntimeWindow {
  return window as unknown as GlobalOpenRuntimeWindow;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}

export function installGlobalOpenHooks(deps: GlobalOpenHookDeps): void {
  const rw = runtimeWindow();
  rw.appOpenFile = (absPath: string, options: ExplorerOpenOptions = {}) => {
    return deps.openFile(absPath, options).catch((error: unknown) => {
      deps.toast(`Failed to open: ${errorMessage(error)}`);
      throw error;
    });
  };

  rw.appOpenFileRel = (rel: string, projectRoot?: string | null, options: ExplorerOpenOptions = {}) => {
    const base = deps.getBaseDir(projectRoot);
    const abs = deps.toAbsolute(rel, base, deps.HOME_DIR);
    return deps.openFile(abs, options).catch((error: unknown) => {
      deps.toast(`Failed to open: ${errorMessage(error)}`);
      throw error;
    });
  };
}
