interface SessionTelemetryDeps {
  apiPost: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  getActiveProjectFallback: () => string | null;
  getCurrentPath: () => string | null;
  getLastSha256: () => string | null;
  getUnsaved: () => boolean;
}

interface SessionState extends Record<string, unknown> {
  activeProject: string | null;
  currentPath: string | null;
  lastSha256: string | null;
  unsaved: boolean;
  updatedAt: string | null;
}

interface PersistedSessionState extends Partial<SessionState> {
  updated_at?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function createSessionTelemetryController(deps: SessionTelemetryDeps) {
  const sessionState: SessionState = {
    activeProject: null,
    currentPath: null,
    lastSha256: null,
    unsaved: false,
    updatedAt: null,
  };
  let sessionStateInitialized = false;
  let sessionStateTimer: number | null = null;
  let persistedSessionSnapshot: PersistedSessionState | null = null;

  async function fetchPersistedSessionState(): Promise<PersistedSessionState | null> {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/session_state', { cache: 'no-store' });
      const parsed: unknown = await resp.json();
      const jsonRecord = isRecord(parsed) ? parsed : null;
      if (!resp.ok || jsonRecord?.ok === false) {
        throw new Error(String(jsonRecord?.error || resp.statusText || 'Session state fetch failed'));
      }
      persistedSessionSnapshot = isRecord(jsonRecord?.data) ? jsonRecord.data as PersistedSessionState : {};
      return persistedSessionSnapshot;
    } catch (err) {
      console.warn('Failed to load session telemetry:', err);
      persistedSessionSnapshot = null;
      return null;
    }
  }

  function initSessionStateContext(serverState: Record<string, unknown> | null): void {
    const persisted = persistedSessionSnapshot || {};
    sessionState.activeProject = stringOrNull(serverState?.activeProject) || stringOrNull(persisted.activeProject) || null;
    sessionState.currentPath = stringOrNull(persisted.currentPath) || null;
    sessionState.unsaved = !!persisted.unsaved;
    sessionState.lastSha256 = stringOrNull(persisted.lastSha256) || null;
    sessionState.updatedAt = stringOrNull(persisted.updated_at) || stringOrNull(persisted.updatedAt) || null;
    sessionStateInitialized = true;
  }

  function seedPersistedSessionState(snapshot: Record<string, unknown> | null = null): PersistedSessionState | null {
    persistedSessionSnapshot = snapshot && typeof snapshot === 'object' ? snapshot as PersistedSessionState : null;
    return persistedSessionSnapshot;
  }

  function queueSessionStateUpdate(partial: Record<string, unknown> | null = null): void {
    if (!sessionStateInitialized) return;
    if (partial && Object.keys(partial).length) Object.assign(sessionState, partial);
    sessionState.updatedAt = new Date().toISOString();
    if (sessionStateTimer) clearTimeout(sessionStateTimer);
    sessionStateTimer = setTimeout(() => { void flushSessionState(); }, 600);
  }

  async function flushSessionState(force = false): Promise<void> {
    if (!sessionStateInitialized) return;
    if (sessionStateTimer) {
      clearTimeout(sessionStateTimer);
      sessionStateTimer = null;
    } else if (!force) {
      return;
    }
    try {
      await deps.apiPost('session_state', sessionState);
    } catch (err) {
      console.warn('Failed to persist session telemetry:', err);
    }
  }

  function activeProjectPath(): string | null {
    return deps.getActiveProjectFallback() || sessionState.activeProject || null;
  }

  function syncSessionPath(extra: Record<string, unknown> = {}): void {
    queueSessionStateUpdate({
      activeProject: activeProjectPath(),
      currentPath: deps.getCurrentPath() || null,
      lastSha256: deps.getLastSha256(),
      unsaved: deps.getUnsaved(),
      ...extra,
    });
  }

  function setSessionActiveProject(path: string | null): void {
    sessionState.activeProject = path || sessionState.activeProject || null;
  }

  return {
    sessionState,
    fetchPersistedSessionState,
    seedPersistedSessionState,
    initSessionStateContext,
    queueSessionStateUpdate,
    flushSessionState,
    activeProjectPath,
    syncSessionPath,
    setSessionActiveProject,
  };
}
