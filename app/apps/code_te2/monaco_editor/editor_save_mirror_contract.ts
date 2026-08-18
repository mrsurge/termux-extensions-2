export interface EditorSocketLike {
  on(eventName: string, handler: (payload: unknown) => void): void;
}

export interface EditorMirrorState {
  rx: number;
  ap: number;
  drop_self: number;
  drop_path: number;
  drop_no_model: number;
  drop_sha: number;
  drop_hot: number;
}

export interface EditorMirrorPayload {
  path?: unknown;
  content?: unknown;
  base_sha256?: unknown;
  content_sha256?: unknown;
  unsaved?: unknown;
  source_client?: unknown;
  document_revision?: unknown;
}

export interface EditorCacheStatePayload {
  path?: unknown;
  state?: unknown;
  unsaved?: unknown;
  reason?: unknown;
  content_sha256?: unknown;
  base_sha256?: unknown;
  source_client?: unknown;
  document_revision?: unknown;
}

export interface EditorSaveSnapshotRequestPayload {
  requestId?: unknown;
  request_id?: unknown;
  requestedAtMs?: unknown;
}
