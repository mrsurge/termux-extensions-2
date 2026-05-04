interface RunFileResponse extends Record<string, unknown> {
  ok?: boolean;
  error?: string;
  data?: Record<string, unknown>;
  command_preview?: string;
}

interface RunFileControllerDeps {
  getCurrentPath: () => string | null;
  getCurrentPathExists: () => boolean;
  isRunnableFile: (path: string) => boolean;
  setRunButtonDisabled: (flag: boolean) => void;
  saveFile: () => Promise<unknown>;
  openTerminal: () => Promise<void>;
  apiPost: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  requestBackendRunActiveFile?: (payload: Record<string, unknown>) => Promise<unknown>;
  basename: (path: string | null | undefined) => string;
  toast: (msg: string) => void;
  updateRunButtonState: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return 'Failed to run file';
}

function asRunFileResponse(value: unknown): RunFileResponse {
  return isRecord(value) ? value : {};
}

export function createRunFileController(deps: RunFileControllerDeps) {
  async function runCurrentFile(): Promise<void> {
    const currentPath = deps.getCurrentPath();
    const runnable = currentPath && deps.isRunnableFile(currentPath);
    if (!runnable || !currentPath) {
      deps.toast('Open a Python, shell, JS/TS, or C/C++ source file to run it in the terminal');
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
      const response = deps.requestBackendRunActiveFile
        ? await deps.requestBackendRunActiveFile({ path: currentPath })
        : await deps.apiPost('terminal/run_active_file', { path: currentPath });
      const responseRecord = asRunFileResponse(response);
      const isWrapped = Object.prototype.hasOwnProperty.call(responseRecord, 'ok');
      if (isWrapped && responseRecord.ok === false) {
        deps.toast(responseRecord.error || 'Failed to run file');
      } else {
        const payload = isWrapped ? asRunFileResponse(responseRecord.data) : responseRecord;
        if (Object.keys(payload).length > 0) {
          const preview = typeof payload.command_preview === 'string'
            ? payload.command_preview
            : deps.basename(currentPath);
          deps.toast(`Running ${preview} in terminal`);
        } else {
          deps.toast('Failed to run file');
        }
      }
    } catch (err) {
      console.error('[RUN] Failed to execute file:', err);
      deps.toast(errorMessage(err));
    } finally {
      deps.updateRunButtonState();
    }
  }

  return { runCurrentFile };
}
