type JsonRecord = Record<string, unknown>;

export interface HostBootSnapshot {
  host_state?: JsonRecord;
  session_state?: JsonRecord;
  editor_ssot?: JsonRecord;
  ui_prefs?: JsonRecord;
  explorer_bootstrap?: JsonRecord | null;
  code_inspector?: JsonRecord | null;
  code_server?: JsonRecord;
}

interface HostBootSnapshotReply {
  ok?: boolean;
  snapshot?: HostBootSnapshot;
}

interface RequestBootSnapshotDeps {
  requestBackendBootSnapshot(payload?: JsonRecord): Promise<unknown>;
}

function asRecord(value: unknown): JsonRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export async function requestHostBootSnapshot(
  deps: RequestBootSnapshotDeps,
): Promise<HostBootSnapshot | null> {
  const reply = asRecord(await deps.requestBackendBootSnapshot({})) as HostBootSnapshotReply | null;
  if (!reply || reply.ok === false) return null;
  return asRecord(reply.snapshot) as HostBootSnapshot | null;
}

export function getBootSnapshotHostState(snapshot: HostBootSnapshot | null): JsonRecord | null {
  return asRecord(snapshot?.host_state);
}

export function getBootSnapshotSessionState(snapshot: HostBootSnapshot | null): JsonRecord | null {
  return asRecord(snapshot?.session_state);
}

export function getBootSnapshotUiPrefs(snapshot: HostBootSnapshot | null): JsonRecord {
  const uiPrefs = asRecord(snapshot?.ui_prefs);
  return uiPrefs || {};
}

export function getBootSnapshotCodeInspector(snapshot: HostBootSnapshot | null): JsonRecord | null {
  return asRecord(snapshot?.code_inspector);
}

export function getBootSnapshotCodeServer(snapshot: HostBootSnapshot | null): JsonRecord | null {
  return asRecord(snapshot?.code_server);
}
