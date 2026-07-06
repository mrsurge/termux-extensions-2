interface RunFileResponse extends Record<string, unknown> {
  ok?: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

interface RunFileControllerDeps {
  getCurrentPath: () => string | null;
  setRunButtonDisabled: (flag: boolean) => void;
  apiPost: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  requestBackendRunActiveFile?: (payload: Record<string, unknown>) => Promise<unknown>;
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

function resultMessage(payload: RunFileResponse): string {
  const data = asRunFileResponse(payload.data);
  if (typeof data.message === 'string' && data.message) return data.message;
  if (data.action === 'pagePreview') {
    const url = typeof data.url === 'string' ? data.url : 'http://127.0.0.1:3000/';
    return `Page Preview opened ${url}`;
  }
  if (data.action === 'terminal') return 'Running active file in terminal';
  return 'Play dispatched';
}

export function createRunFileController(deps: RunFileControllerDeps) {
  async function runCurrentFile(): Promise<void> {
    const currentPath = deps.getCurrentPath();
    if (!currentPath) {
      deps.toast('Open a file first');
      return;
    }
    deps.setRunButtonDisabled(true);
    try {
      const response = deps.requestBackendRunActiveFile ? await deps.requestBackendRunActiveFile({ path: currentPath }) : await deps.apiPost('terminal/run_active_file', { path: currentPath });
      const responseRecord = asRunFileResponse(response);
      const isWrapped = Object.prototype.hasOwnProperty.call(responseRecord, 'ok');
      if (isWrapped && responseRecord.ok === false) {
        deps.toast(responseRecord.error || 'Failed to run file');
      } else {
        deps.toast(resultMessage(responseRecord));
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
