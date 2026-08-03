interface RunFileResponse extends Record<string, unknown> {
  ok?: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

interface RunFileControllerDeps {
  getCurrentPath: () => string | null;
  apiPost: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  requestBackendRunActiveFile?: (payload: Record<string, unknown>) => Promise<unknown>;
  requestBackendRunProfileState: (payload: Record<string, unknown>) => Promise<unknown>;
  requestBackendRunProfileStop: (payload: Record<string, unknown>) => Promise<unknown>;
  setRunButtonState: (state: RunButtonState) => void;
  toast: (msg: string) => void;
}

interface RunButtonState {
  disabled: boolean;
  running: boolean;
  busy: boolean;
  profileId: string;
}

interface RunProfileState {
  path: string;
  matched: boolean;
  running: boolean;
  profileId: string;
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
  let state: RunProfileState = {
    path: '',
    matched: false,
    running: false,
    profileId: '',
  };
  let busy = false;
  let refreshSequence = 0;

  function render(): void {
    const path = deps.getCurrentPath() || '';
    deps.setRunButtonState({
      disabled: !path || busy,
      running: !!path && state.path === path && state.running,
      busy,
      profileId: state.path === path ? state.profileId : '',
    });
  }

  function applyProjection(value: unknown): void {
    const data = asRunFileResponse(value);
    state = {
      path: typeof data.path === 'string' ? data.path : '',
      matched: data.matched === true,
      running: data.running === true,
      profileId: typeof data.profileId === 'string' ? data.profileId : '',
    };
    render();
  }

  async function refreshState(options: { quiet?: boolean } = {}): Promise<void> {
    const path = deps.getCurrentPath() || '';
    const sequence = ++refreshSequence;
    if (!path) {
      state = { path: '', matched: false, running: false, profileId: '' };
      render();
      return;
    }
    try {
      const response = asRunFileResponse(
        await deps.requestBackendRunProfileState({ path }),
      );
      if (sequence !== refreshSequence || path !== (deps.getCurrentPath() || '')) return;
      const data = asRunFileResponse(response.data);
      state = {
        path,
        matched: data.matched === true,
        running: data.running === true,
        profileId: typeof data.profileId === 'string' ? data.profileId : '',
      };
      if (response.ok === false && !options.quiet) {
        deps.toast(response.error || 'Failed to inspect run profile');
      }
    } catch (error) {
      if (sequence !== refreshSequence || path !== (deps.getCurrentPath() || '')) return;
      state = { path, matched: false, running: false, profileId: '' };
      if (!options.quiet) deps.toast(errorMessage(error));
    } finally {
      if (sequence === refreshSequence) {
        render();
      }
    }
  }

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
    busy = true;
    render();
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
        const data = asRunFileResponse(responseRecord.data);
        if (typeof data.path === 'string' && typeof data.running === 'boolean') {
          applyProjection(data);
        }
        deps.toast(resultMessage(responseRecord));
      }
    } catch (err) {
      console.error('[RUN] Failed to execute file:', err);
      deps.toast(errorMessage(err));
    } finally {
      busy = false;
      render();
    }
  }

  async function stopCurrentProfile(): Promise<void> {
    const path = deps.getCurrentPath();
    if (!path) return;
    busy = true;
    render();
    try {
      const response = asRunFileResponse(
        await deps.requestBackendRunProfileStop({ path }),
      );
      const data = asRunFileResponse(response.data);
      if (response.ok === false) deps.toast(response.error || 'Failed to stop run profile');
      else {
        applyProjection(data);
        deps.toast(
          typeof data.message === 'string' ? data.message : 'Run profile stopped',
        );
      }
    } catch (error) {
      deps.toast(errorMessage(error));
    } finally {
      busy = false;
      render();
    }
  }

  async function runOrStop(): Promise<void> {
    const path = deps.getCurrentPath() || '';
    if (state.running && state.path === path) {
      await stopCurrentProfile();
      return;
    }
    await runCurrentFile();
  }

  return {
    applyProjection,
    refreshState,
    render,
    runCurrentFile,
    runOrStop,
    stopCurrentProfile,
  };
}
