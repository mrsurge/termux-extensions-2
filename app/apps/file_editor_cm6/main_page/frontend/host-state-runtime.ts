export interface HostStateRuntimeDeps {
  updateLspSpinner: () => void;
  applyActiveFilePath: (path: string) => void;
  clearActiveFilePath: () => void;
  log?: (...args: unknown[]) => void;
}

export interface WorkbenchAdapterState {
  readyOk: boolean;
  connecting: Promise<boolean> | null;
}

export interface HostStateRuntime {
  install: () => void;
  ensureWorkbenchAdapterReady: () => Promise<boolean>;
  spinnerSetStep: (title: string, failed?: boolean) => void;
  setWorkbenchAdapterState: (next: WorkbenchAdapterState) => void;
}

interface SpinnerUiState {
  lspShow: boolean;
  lspTitle: string;
  busyShow: boolean;
  busyTitle: string;
  busyLanguageId: string;
  busyActivity: string;
}

interface HostStateWindow extends Window {
  __adapterConnected?: boolean;
  __adapterReadyResolve?: ((ready: boolean) => void) | null;
  __feLspSpinnerUi?: SpinnerUiState;
  __feLspSpinnerState?: {
    hideTimer?: number | null;
  };
}

function hostWindow(): HostStateWindow {
  return window as HostStateWindow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ensureSpinnerUi(): SpinnerUiState {
  const win = hostWindow();
  if (!win.__feLspSpinnerUi) {
    win.__feLspSpinnerUi = {
      lspShow: false,
      lspTitle: '',
      busyShow: false,
      busyTitle: '',
      busyLanguageId: '',
      busyActivity: '',
    };
  }
  return win.__feLspSpinnerUi;
}

function hostTs(): string {
  try {
    const elapsed = typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
      ? Math.round(performance.now() * 10) / 10
      : null;
    return `${elapsed != null ? `t=${elapsed}ms ` : ''}now=${Date.now()}`;
  } catch {
    return `now=${Date.now()}`;
  }
}

export function createHostStateRuntime(deps: HostStateRuntimeDeps): HostStateRuntime {
  let installed = false;
  let workbenchAdapterConnecting: Promise<boolean> | null = null;
  let workbenchAdapterReadyOk = false;
  const log = deps.log || console.log.bind(console);
  const win = hostWindow();
  win.__adapterConnected = false;

  function updateLspSpinner(): void {
    try {
      deps.updateLspSpinner();
    } catch {}
  }

  function spinnerSetStep(title: string, failed = false): void {
    try {
      const ui = ensureSpinnerUi();
      ui.busyShow = true;
      ui.busyActivity = 'readiness';
      ui.busyTitle = `${failed ? '\u2718 ' : ''}${title}`;
      updateLspSpinner();
    } catch {}
  }

  function spinnerHide(ok: boolean): void {
    try {
      const winRef = hostWindow();
      winRef.__adapterConnected = Boolean(ok);
      const ui = winRef.__feLspSpinnerUi;
      if (!ui) {
        updateLspSpinner();
        return;
      }
      if (ui.busyActivity === 'readiness' || ui.busyActivity === 'workbench_adapter' || ui.busyActivity === '') {
        ui.busyShow = false;
        ui.busyTitle = '';
        ui.busyActivity = '';
        try { log(hostTs(), `[spinner] STOP request_id=- path=- reason=readiness_${ok ? 'ok' : 'fail'}`); } catch {}
        try {
          const state = winRef.__feLspSpinnerState;
          if (state?.hideTimer) {
            clearTimeout(state.hideTimer);
            state.hideTimer = null;
          }
        } catch {}
        updateLspSpinner();
      }
    } catch {}
  }

  function resolveAdapterReady(value: boolean): void {
    const resolver = hostWindow().__adapterReadyResolve;
    if (!resolver) return;
    hostWindow().__adapterReadyResolve = null;
    try { resolver(value); } catch {}
  }

  function handleAdapterState(detail: unknown): void {
    const payload = isRecord(detail) ? detail : {};
    const status = typeof payload.status === 'string' ? payload.status : '';
    log(hostTs(), '[adapter_state]', status, payload.error || '');
    if (status === 'ready') {
      workbenchAdapterReadyOk = true;
      spinnerHide(true);
      resolveAdapterReady(true);
    } else if (status === 'error') {
      workbenchAdapterReadyOk = false;
      spinnerHide(false);
      resolveAdapterReady(false);
    } else if (status === 'starting' || status === 'connected') {
      spinnerSetStep(status === 'connected' ? 'Connecting adapter\u2026' : 'Starting adapter\u2026');
    } else if (status === 'idle') {
      if (!workbenchAdapterReadyOk && !hostWindow().__adapterReadyResolve) {
        updateLspSpinner();
      }
    }
  }

  function handleActiveFileChanged(detail: unknown): void {
    try {
      const payload = isRecord(detail) ? detail : {};
      const openState = isRecord(payload.openState) ? payload.openState : null;
      if (openState) {
        handleOpenStateChanged(openState);
        return;
      }
      const filePath = typeof payload.path === 'string' ? payload.path : '';
      if (!filePath) {
        deps.clearActiveFilePath();
        return;
      }
      deps.applyActiveFilePath(filePath);
    } catch {}
  }

  function handleOpenStateChanged(detail: unknown): void {
    try {
      const payload = isRecord(detail) ? detail : {};
      const openFile = typeof payload.openFile === 'string' ? payload.openFile : '';
      if (!openFile) {
        deps.clearActiveFilePath();
        return;
      }
      deps.applyActiveFilePath(openFile);
    } catch {}
  }

  async function ensureWorkbenchAdapterReady(): Promise<boolean> {
    if (workbenchAdapterReadyOk) return true;
    if (workbenchAdapterConnecting) return await workbenchAdapterConnecting;

    spinnerSetStep('Waiting for adapter\u2026');
    try { log(hostTs(), '[spinner] START request_id=- path=- reason=readiness_chain'); } catch {}

    workbenchAdapterConnecting = new Promise((resolve) => {
      hostWindow().__adapterReadyResolve = resolve;
      setTimeout(() => {
        if (!workbenchAdapterReadyOk && hostWindow().__adapterReadyResolve) {
          spinnerSetStep('Readiness timeout', true);
          hostWindow().__adapterReadyResolve = null;
          resolve(false);
        }
      }, 60000);
    });

    const result = await workbenchAdapterConnecting;
    workbenchAdapterConnecting = null;
    return result;
  }

  function setWorkbenchAdapterState(next: WorkbenchAdapterState): void {
    workbenchAdapterReadyOk = Boolean(next.readyOk);
    workbenchAdapterConnecting = next.connecting;
  }

  function install(): void {
    if (installed) return;
    installed = true;
    window.addEventListener('cm6:adapter-state', (evt) => {
      try {
        handleAdapterState(evt instanceof CustomEvent ? evt.detail : undefined);
      } catch {}
    });
    window.addEventListener('cm6:active-file-changed', (evt) => {
      try {
        handleActiveFileChanged(evt instanceof CustomEvent ? evt.detail : undefined);
      } catch {}
    });
    window.addEventListener('cm6:open-state-changed', (evt) => {
      try {
        handleOpenStateChanged(evt instanceof CustomEvent ? evt.detail : undefined);
      } catch {}
    });
  }

  return {
    install,
    ensureWorkbenchAdapterReady,
    spinnerSetStep,
    setWorkbenchAdapterState,
  };
}
