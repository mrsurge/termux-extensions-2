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
  candidates: RunProfileCandidate[];
}

interface RunProfileCandidate {
  profileId: string;
  runner: string;
  entry: string;
  ownsActiveFile: boolean;
  running: boolean;
}

interface RunIntent extends Record<string, unknown> {
  profileId?: string;
  runCurrentFile?: true;
}

interface RunSelection {
  kind: 'profile' | 'currentFile';
  profileId?: string;
  running?: boolean;
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

function runProfileCandidates(value: unknown): RunProfileCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.profileId !== 'string' || !item.profileId) {
      return [];
    }
    return [{
      profileId: item.profileId,
      runner: typeof item.runner === 'string' ? item.runner : '',
      entry: typeof item.entry === 'string' ? item.entry : '',
      ownsActiveFile: item.ownsActiveFile === true,
      running: item.running === true,
    }];
  });
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
    candidates: [],
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
      candidates: runProfileCandidates(data.candidates),
    };
    render();
  }

  async function refreshState(options: { quiet?: boolean } = {}): Promise<void> {
    const path = deps.getCurrentPath() || '';
    const sequence = ++refreshSequence;
    if (!path) {
      state = {
        path: '',
        matched: false,
        running: false,
        profileId: '',
        candidates: [],
      };
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
        candidates: runProfileCandidates(data.candidates),
      };
      if (response.ok === false && !options.quiet) {
        deps.toast(response.error || 'Failed to inspect run profile');
      }
    } catch (error) {
      if (sequence !== refreshSequence || path !== (deps.getCurrentPath() || '')) return;
      state = {
        path,
        matched: false,
        running: false,
        profileId: '',
        candidates: [],
      };
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

  async function chooseRunSelection(
    data: Record<string, unknown>,
  ): Promise<RunSelection | null> {
    const candidates = runProfileCandidates(data.candidates);
    const includeRunCurrentFile = data.includeRunCurrentFile === true;
    const options: Array<{ value: RunSelection; label: string }> = candidates.map(
      (candidate) => {
        const detail = [candidate.runner, candidate.entry].filter(Boolean).join(' · ');
        return {
          value: {
            kind: 'profile',
            profileId: candidate.profileId,
            running: candidate.running,
          },
          label: `${candidate.running ? 'Stop' : 'Run'} ${candidate.profileId}${
            detail ? ` · ${detail}` : ''
          }`,
        };
      },
    );
    if (includeRunCurrentFile) {
      options.push({
        value: { kind: 'currentFile' },
        label: 'Run current file',
      });
    }
    if (!options.length) {
      deps.toast('No Run Profiles are available');
      return null;
    }
    const result = await window.teUI.dialog.open({
      kind: 'form',
      title: 'Run Profile',
      message: typeof data.message === 'string'
        ? data.message
        : 'Choose what to run or stop',
      fields: [{
        key: 'selection',
        kind: 'select',
        label: 'Action',
        value: options[0].value,
        options,
      }],
      actions: [
        { id: 'cancel', label: 'Cancel', role: 'cancel', validate: false },
        { id: 'continue', label: 'Continue', role: 'accept', primary: true },
      ],
      defaultAction: 'continue',
      cancelAction: 'cancel',
    });
    if (result.status !== 'accepted' || result.action !== 'continue') return null;
    const selection = result.values.selection;
    if (!isRecord(selection)) return null;
    if (selection.kind === 'currentFile') return { kind: 'currentFile' };
    if (selection.kind !== 'profile' || typeof selection.profileId !== 'string') {
      return null;
    }
    return {
      kind: 'profile',
      profileId: selection.profileId,
      running: selection.running === true,
    };
  }

  function handleRunResult(response: RunFileResponse): void {
    const isWrapped = Object.prototype.hasOwnProperty.call(response, 'ok');
    if (isWrapped && response.ok === false) {
      deps.toast(response.error || 'Failed to run file');
      return;
    }
    const data = asRunFileResponse(response.data);
    if (typeof data.path === 'string' && typeof data.running === 'boolean') {
      applyProjection(data);
    }
    deps.toast(resultMessage(response));
  }

  async function stopProfile(path: string, profileId: string): Promise<void> {
    const response = asRunFileResponse(
      await deps.requestBackendRunProfileStop({ path, profileId }),
    );
    const data = asRunFileResponse(response.data);
    if (response.ok === false) {
      deps.toast(response.error || 'Failed to stop run profile');
      return;
    }
    applyProjection(data);
    deps.toast(
      typeof data.message === 'string' ? data.message : 'Run profile stopped',
    );
  }

  async function performSelection(path: string, selection: RunSelection): Promise<void> {
    if (selection.kind === 'profile' && selection.running && selection.profileId) {
      await stopProfile(path, selection.profileId);
      return;
    }
    const intent: RunIntent = selection.kind === 'currentFile'
      ? { runCurrentFile: true }
      : { profileId: selection.profileId };
    await executeRunIntent(path, intent);
  }

  async function executeRunIntent(path: string, intent: RunIntent): Promise<void> {
    let response = await requestRun({ path, ...intent });
    const data = asRunFileResponse(response.data);
    if (data.action === 'selectRunProfile') {
      const selection = await chooseRunSelection(data);
      if (selection) await performSelection(path, selection);
      return;
    }
    if (data.action === 'confirmDraftSave') {
      const confirmation = await confirmDraftSave(data);
      if (!confirmation.confirmed) return;
      response = await requestRun({
        path,
        ...intent,
        confirmDraftSave: true,
        draftSaveConfirmationKey: confirmation.confirmationKey,
        suppressSaveWarning: confirmation.suppressWarning,
      });
    }
    handleRunResult(response);
  }

  async function runCurrentFile(intent: RunIntent = {}): Promise<void> {
    const path = deps.getCurrentPath();
    if (!path) {
      deps.toast('Open a file first');
      return;
    }
    busy = true;
    render();
    try {
      await executeRunIntent(path, intent);
    } catch (error) {
      console.error('[RUN] Failed to execute file:', error);
      deps.toast(errorMessage(error));
    } finally {
      busy = false;
      render();
    }
  }

  async function stopCurrentProfile(profileId = state.profileId): Promise<void> {
    const path = deps.getCurrentPath();
    if (!path || !profileId) return;
    busy = true;
    render();
    try {
      await stopProfile(path, profileId);
    } catch (error) {
      deps.toast(errorMessage(error));
    } finally {
      busy = false;
      render();
    }
  }

  async function showProfileSelector(): Promise<void> {
    const path = deps.getCurrentPath();
    if (!path) {
      deps.toast('Open a file first');
      return;
    }
    busy = true;
    render();
    try {
      const response = asRunFileResponse(
        await deps.requestBackendRunProfileState({
          path,
          includeAllProfiles: true,
        }),
      );
      if (response.ok === false) {
        deps.toast(response.error || 'Failed to inspect Run Profiles');
        return;
      }
      const data = asRunFileResponse(response.data);
      data.includeRunCurrentFile = true;
      data.message = 'Choose a Run Profile or run the active file';
      const selection = await chooseRunSelection(data);
      if (selection) await performSelection(path, selection);
    } catch (error) {
      deps.toast(errorMessage(error));
    } finally {
      busy = false;
      render();
    }
  }

  async function runOrStop(): Promise<void> {
    const path = deps.getCurrentPath() || '';
    const runningCandidates = state.path === path
      ? state.candidates.filter((candidate) => candidate.running)
      : [];
    if (runningCandidates.length === 1) {
      await stopCurrentProfile(runningCandidates[0].profileId);
      return;
    }
    if (runningCandidates.length > 1) {
      busy = true;
      render();
      try {
        const selection = await chooseRunSelection({
          candidates: runningCandidates,
          includeRunCurrentFile: false,
          message: 'Choose which running profile to stop',
        });
        if (selection) await performSelection(path, selection);
      } catch (error) {
        deps.toast(errorMessage(error));
      } finally {
        busy = false;
        render();
      }
      return;
    }
    if (state.running && state.path === path && state.profileId) {
      await stopCurrentProfile(state.profileId);
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
    showProfileSelector,
    stopCurrentProfile,
  };
}
