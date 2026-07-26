interface OpenFlowProjectState {
  activeProject?: string | null;
  activeProjectExists?: boolean;
  activeProjectMessage?: string;
}

export interface OpenFileOptions {
  allowOverwrite?: boolean;
  forceRefresh?: boolean;
  line?: number | string | null;
  lineNo?: number | string | null;
  column?: number | string | null;
  col?: number | string | null;
  focus?: boolean;
  scrollY?: string;
  scrollToTop?: boolean;
}

interface OpenRequestPayload extends Record<string, unknown> {
  path: string;
  request_id: string;
  line?: number;
  column?: number;
  focus?: boolean;
  scroll_y?: string;
  scroll_to_top?: boolean;
}

interface OpenFlowControllerDeps {
  setStatus: (text: string) => void;
  ensureProjectContext: () => Promise<OpenFlowProjectState | null | undefined>;
  toAbsolute: (path: string, base?: string | null, home?: string) => string;
  homeDir: string;
  getRestoredSessionActive: () => boolean;
  getCurrentPath: () => string | null;
  setRestoredSessionActive: (flag: boolean) => void;
  setIndicatorInactive: () => void;
  setCurrentPath: (path: string) => void;
  setCurrentPathExists: (exists: boolean) => void;
  setLastPickerPath: (path: string) => void;
  parentDir: (path: string | null | undefined) => string;
  setCurrentModeLanguage: (lang: string | null) => void;
  detectLanguageFromFilename: (path: string) => string | null;
  setLastSha256: (sha: string | null) => void;
  requestBackendOpen: (payload: OpenRequestPayload) => Promise<unknown>;
  awaitEditorOpen: (requestId: string, path: string, timeoutMs?: number) => Promise<unknown>;
  setLastSavedContent: (content: string) => void;
  markUnsaved: (flag: boolean) => void;
  updatePathDisplay: () => void;
  syncSessionPath: () => void;
  getCachedProjectRoot: () => string | null;
  dispatchExplorerActiveFile: (rel: string | null) => void;
  openWebSocket: (path: string) => void | Promise<void>;
  jumpToCurrentFileLine: (line: number, opts?: Record<string, unknown>) => void | Promise<void>;
  toast: (msg: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return String(error ?? 'unknown error');
}

function numericOption(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function createOpenFlowController(deps: OpenFlowControllerDeps) {
  async function openFile(path: string, options: OpenFileOptions = {}): Promise<void> {
    const { allowOverwrite = true, forceRefresh = false } = options;
    const line = numericOption(options.line ?? options.lineNo);
    const column = numericOption(options.column ?? options.col);
    const openRequestId = `editor_open_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const openRequestOptions: OpenRequestPayload = {
      path: '',
      request_id: openRequestId,
    };
    if (line != null && line >= 1) openRequestOptions.line = line;
    if (column != null && column >= 1) openRequestOptions.column = column;
    if (Object.prototype.hasOwnProperty.call(options, 'focus')) {
      openRequestOptions.focus = Boolean(options.focus);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'scrollY') && typeof options.scrollY === 'string') {
      openRequestOptions.scroll_y = options.scrollY;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'scrollToTop')) {
      openRequestOptions.scroll_to_top = Boolean(options.scrollToTop);
    }
    if (!path) throw new Error('Path is empty');
    deps.setStatus('Opening...');

    const projectState = await deps.ensureProjectContext();
    if (!projectState || !projectState.activeProject || !projectState.activeProjectExists) {
      deps.setStatus('');
      deps.toast(projectState?.activeProjectMessage || 'Select a project before opening files.');
      return;
    }

    try {
      const resolvedTarget = deps.toAbsolute(path, null, deps.homeDir);
      if (!forceRefresh && !allowOverwrite && deps.getRestoredSessionActive() && deps.getCurrentPath() && resolvedTarget === deps.getCurrentPath()) {
        console.log('[Editor] Skipping host-side open; restored session buffer already loaded');
        deps.setStatus('');
        return;
      }

      deps.setRestoredSessionActive(false);
      deps.setIndicatorInactive();

      await deps.requestBackendOpen({
        ...openRequestOptions,
        path: resolvedTarget,
      });
      await deps.awaitEditorOpen(openRequestId, resolvedTarget, 10000);

      deps.setLastSavedContent('');
      deps.markUnsaved(false);
      deps.syncSessionPath();
      deps.setStatus('');

      deps.openWebSocket(resolvedTarget);
    } catch (error) {
      deps.setStatus('');
      deps.toast(`Failed to open: ${errorMessage(error)}`);
      throw error;
    }
  }

  return { openFile };
}
