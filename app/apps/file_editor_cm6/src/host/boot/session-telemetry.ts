// @ts-check

/**
 * @param {{
 *   apiPost: (path: string, body: any) => Promise<any>,
 *   getActiveProjectFallback: () => string | null,
 *   getCurrentPath: () => string | null,
 *   getLastSha256: () => string | null,
 *   getUnsaved: () => boolean
 * }} deps
 */
export function createSessionTelemetryController(deps) {
  const sessionState = {
    activeProject: null,
    currentPath: null,
    lastSha256: null,
    unsaved: false,
    updatedAt: null,
  };
  let sessionStateInitialized = false;
  let sessionStateTimer = null;
  let persistedSessionSnapshot = null;

  async function fetchPersistedSessionState() {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/session_state', { cache: 'no-store' });
      const json = await resp.json();
      if (!resp.ok || json?.ok === false) {
        throw new Error(json?.error || resp.statusText || 'Session state fetch failed');
      }
      persistedSessionSnapshot = json?.data || {};
      return persistedSessionSnapshot;
    } catch (err) {
      console.warn('Failed to load session telemetry:', err);
      persistedSessionSnapshot = null;
      return null;
    }
  }

  function initSessionStateContext(serverState) {
    const persisted = persistedSessionSnapshot || {};
    sessionState.activeProject = serverState?.activeProject || persisted.activeProject || null;
    sessionState.currentPath = persisted.currentPath || null;
    sessionState.unsaved = !!persisted.unsaved;
    sessionState.lastSha256 = persisted.lastSha256 || null;
    sessionState.updatedAt = persisted.updated_at || null;
    sessionStateInitialized = true;
  }

  function seedPersistedSessionState(snapshot = null) {
    persistedSessionSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
    return persistedSessionSnapshot;
  }

  function queueSessionStateUpdate(partial = null) {
    if (!sessionStateInitialized) return;
    if (partial && Object.keys(partial).length) Object.assign(sessionState, partial);
    sessionState.updatedAt = new Date().toISOString();
    if (sessionStateTimer) clearTimeout(sessionStateTimer);
    sessionStateTimer = setTimeout(() => { void flushSessionState(); }, 600);
  }

  async function flushSessionState(force = false) {
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

  function activeProjectPath() {
    return deps.getActiveProjectFallback() || sessionState.activeProject || null;
  }

  function syncSessionPath(extra = {}) {
    queueSessionStateUpdate({
      activeProject: activeProjectPath(),
      currentPath: deps.getCurrentPath() || null,
      lastSha256: deps.getLastSha256(),
      unsaved: deps.getUnsaved(),
      ...extra,
    });
  }

  function setSessionActiveProject(path) {
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
