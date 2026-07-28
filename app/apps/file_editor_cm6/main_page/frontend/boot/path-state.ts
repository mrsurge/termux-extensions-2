interface NoProjectStateDeps {
  statusEl: { textContent: string | null };
  setIssuesButtonsEnabled: (enabled: boolean) => void;
  message: string;
}

interface RestoredServerState extends Record<string, unknown> {
  lastFileExists?: boolean;
}

interface RestoredPathStateDeps {
  restoredPath: string;
  serverState: RestoredServerState;
  restoredSha: string | null;
  parentDir: (path: string | null | undefined) => string;
  detectLanguageFromFilename: (path: string) => string | null;
  syncSessionPath: () => void;
  setCurrentPath: (path: string) => void;
  setCurrentPathExists: (exists: boolean) => void;
  setLastPickerPath: (path: string) => void;
  setLastSha256: (sha: string | null) => void;
  setCurrentModeLanguage: (lang: string | null) => void;
}

interface NoRestoredPathStateDeps {
  serverState: Record<string, unknown>;
  setStatus: (msg: string) => void;
}

export function applyNoProjectState(deps: NoProjectStateDeps): void {
  deps.statusEl.textContent = deps.message;
  deps.setIssuesButtonsEnabled(false);
}

export function applyRestoredPathState(deps: RestoredPathStateDeps): void {
  deps.setCurrentPath(deps.restoredPath);
  deps.setCurrentPathExists(!!deps.serverState.lastFileExists);
  deps.setLastPickerPath(deps.parentDir(deps.restoredPath));
  deps.setLastSha256(deps.restoredSha);
  deps.setCurrentModeLanguage(deps.detectLanguageFromFilename(deps.restoredPath));
  deps.syncSessionPath();
}

export function applyNoRestoredPathState(deps: NoRestoredPathStateDeps): void {
  const lastFile = typeof deps.serverState.lastFile === 'string' ? deps.serverState.lastFile : '';
  const lastFileExists = !!deps.serverState.lastFileExists;
  const lastFileMessage = typeof deps.serverState.lastFileMessage === 'string' ? deps.serverState.lastFileMessage : '';
  if (lastFile && !lastFileExists) {
    deps.setStatus(lastFileMessage || 'Last file not found.');
  } else {
    deps.setStatus('Select a file to begin.');
  }
}
