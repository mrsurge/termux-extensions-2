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
  async function requestRun(payload: Record<string, unknown>): Promise<RunFileResponse> {
    const response = deps.requestBackendRunActiveFile
      ? await deps.requestBackendRunActiveFile(payload)
      : await deps.apiPost('terminal/run_active_file', payload);
    return asRunFileResponse(response);
  }

  async function confirmDraftSave(data: Record<string, unknown>): Promise<{
    confirmed: boolean;
    suppressWarning: boolean;
    confirmationKey: string;
  }> {
    const profileId = typeof data.profileId === 'string' ? data.profileId : '';
    const confirmationKey = typeof data.confirmationKey === 'string'
      ? data.confirmationKey
      : '';
    const result = await window.teUI.dialog.open({
      kind: 'confirm',
      title: 'Run and save drafts',
      message: typeof data.message === 'string'
        ? data.message
        : 'Save drafts before running?',
      detail: typeof data.detail === 'string' ? data.detail : '',
      severity: 'warning',
      fields: [{
        key: 'suppressWarning',
        kind: 'checkbox',
        label: profileId
          ? 'Don’t show this warning for this run profile again'
          : 'Don’t show this warning for files without a run profile again',
        value: false,
      }],
      actions: [
        { id: 'cancel', label: 'Cancel', role: 'cancel', validate: false },
        { id: 'run', label: 'Save and Run', role: 'accept', primary: true },
      ],
      defaultAction: 'run',
      cancelAction: 'cancel',
    });
    return {
      confirmed: result.status === 'accepted' && result.action === 'run',
      suppressWarning: result.values.suppressWarning === true,
      confirmationKey,
    };
  }

  async function runCurrentFile(): Promise<void> {
    const currentPath = deps.getCurrentPath();
    if (!currentPath) {
      deps.toast('Open a file first');
      return;
    }
    deps.setRunButtonDisabled(true);
    try {
      let responseRecord = await requestRun({ path: currentPath });
      const firstData = asRunFileResponse(responseRecord.data);
      if (firstData.action === 'confirmDraftSave') {
        const confirmation = await confirmDraftSave(firstData);
        if (!confirmation.confirmed) return;
        responseRecord = await requestRun({
          path: currentPath,
          confirmDraftSave: true,
          draftSaveConfirmationKey: confirmation.confirmationKey,
          suppressSaveWarning: confirmation.suppressWarning,
        });
      }
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
