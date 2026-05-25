export const JSONRPC_VERSION = '2.0' as const;
export const EDITOR_RPC_EVENT = 'rpc' as const;

export type JsonRpcId = string | number;

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface JsonRpcRequestEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  method: EditorRpcMethodName;
  params: Record<string, unknown>;
}

export interface JsonRpcNotificationEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
  method: EditorRpcMethodName | EditorRpcNotificationName;
  params: Record<string, unknown>;
}

export interface JsonRpcSuccessEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export const EDITOR_RPC_METHODS = {
  open: 'editor.open',
  jumpToLine: 'editor.jumpToLine',
  gitBaselinesGet: 'editor.gitBaselines.get',
  draftDiffGet: 'editor.draftDiff.get',
  mirrorPublish: 'editor.mirror.publish',
  save: 'editor.save',
  mentionRequest: 'editor.mention.request',
  hostSave: 'editor.host.save',
  focus: 'editor.focus',
  blur: 'editor.blur',
  readyPublish: 'editor.ready.publish',
  cacheStatePublish: 'editor.cacheState.publish',
  draftStatePublish: 'editor.draftState.publish',
  notifyPublish: 'editor.notify.publish',
  openCompletePublish: 'editor.openComplete.publish',
  diagnosticsCountsPublish: 'editor.diagnosticsCounts.publish',
  scrollStatePublish: 'editor.scrollState.publish',
  modelReady: 'editor.modelReady',
  saveSnapshotResponse: 'editor.save.snapshot.response',
  issuesDumpResponse: 'editor.issues.dump.response',
  breadcrumbNavigate: 'editor.breadcrumb.navigate',
} as const;

export type EditorRpcMethodName = (typeof EDITOR_RPC_METHODS)[keyof typeof EDITOR_RPC_METHODS];

export const EDITOR_RPC_NOTIFICATIONS = {
  stateSsot: 'editor.state.ssot',
  fileOpened: 'editor.file.opened',
  fileJumpToLine: 'editor.file.jumpToLine',
  mirrorUpdated: 'editor.mirror.updated',
  gitBaselines: 'editor.gitBaselines.updated',
  draftDiff: 'editor.draftDiff.updated',
  prefsChanged: 'editor.prefs.changed',
  cacheState: 'editor.cache.state',
  draftState: 'editor.draft.state',
  ready: 'editor.ready',
  notify: 'editor.notify',
  openComplete: 'editor.open.complete',
  diagnostics: 'editor.diagnostics.updated',
  diagnosticsCounts: 'editor.diagnostics.counts',
  adapterState: 'editor.adapter.state',
  semanticTokensProviderRegistered: 'editor.semanticTokens.providerRegistered',
  issuesDumpRequest: 'editor.issues.dump.request',
  issuesDumpResponse: 'editor.issues.dump.response',
  saveSnapshotRequest: 'editor.save.snapshot.request',
  issuesCommand: 'editor.issues.command',
  findCommand: 'editor.find.command',
  editCommand: 'editor.edit.command',
  openStateChanged: 'editor.openState.changed',
  projectSwitching: 'editor.project.switching',
  projectSwitched: 'editor.project.switched',
} as const;

export type EditorRpcNotificationName = (typeof EDITOR_RPC_NOTIFICATIONS)[keyof typeof EDITOR_RPC_NOTIFICATIONS];

export interface EditorRpcOpenParams {
  path: string;
  line?: number;
  column?: number;
  request_id?: string;
}

export interface EditorRpcJumpToLineParams {
  line: number;
  column?: number;
  focus?: boolean;
  scroll_y?: string;
  scroll_to_top?: boolean;
}

export interface EditorRpcGitBaselinesGetParams {
  path: string;
}

export interface EditorRpcDraftDiffGetParams {
  path: string;
  requestId?: string;
  request_id?: string;
}

export interface EditorRpcMirrorPublishParams {
  path: string;
  content: string;
  content_sha256?: string;
  base_sha256?: string;
}

export interface EditorRpcSaveParams {
  path: string;
  content?: string;
  content_sha256?: string;
  base_sha256?: string;
  request_id?: string;
  requestId?: string;
}

export interface EditorRpcMentionRequestParams {
  path: string;
  lineNo?: number;
  col?: number;
  endLineNo?: number;
  endCol?: number;
  content?: string;
}

export interface EditorRpcStateSsotNotificationParams {
  project?: string | null;
  session_state?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  currentPath?: string | null;
  file?: Record<string, unknown>;
}

export interface EditorRpcFileOpenedNotificationParams extends Record<string, unknown> {
  path?: string;
  request_id?: string;
}

export interface EditorRpcGitBaselinesNotificationParams extends Record<string, unknown> {
  path?: string;
}

export interface EditorRpcDraftDiffNotificationParams extends Record<string, unknown> {
  path?: string;
  hunks?: unknown[];
}

export interface EditorRpcPrefsChangedNotificationParams extends Record<string, unknown> {
  source_client?: string;
}

export function buildEditorRpcRequestEnvelope(
  id: JsonRpcId,
  method: EditorRpcMethodName,
  params: Record<string, unknown>,
): JsonRpcRequestEnvelope {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    method,
    params,
  };
}

export function buildEditorRpcNotificationEnvelope(
  method: EditorRpcMethodName | EditorRpcNotificationName,
  params: Record<string, unknown>,
): JsonRpcNotificationEnvelope {
  return {
    jsonrpc: JSONRPC_VERSION,
    method,
    params,
  };
}

export function isJsonRpcSuccessEnvelope(value: unknown): value is JsonRpcSuccessEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.jsonrpc === JSONRPC_VERSION && 'id' in record && 'result' in record;
}

export function isJsonRpcErrorEnvelope(value: unknown): value is JsonRpcErrorEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.jsonrpc === JSONRPC_VERSION && 'error' in record;
}

export function isJsonRpcNotificationEnvelope(value: unknown): value is JsonRpcNotificationEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.jsonrpc === JSONRPC_VERSION && typeof record.method === 'string' && !('id' in record);
}
