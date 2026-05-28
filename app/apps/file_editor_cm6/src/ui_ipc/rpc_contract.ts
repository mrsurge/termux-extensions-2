import { RPC_NAMESPACES } from '../rpc/namespaces.ts';
import type { JsonObject, JsonRpcNotificationEnvelope } from '../rpc/transport.ts';

export const UI_IPC_RPC_NAMESPACE = RPC_NAMESPACES.uiIpc;

export const UI_IPC_RPC_METHODS = {
  hostFileOpen: 'ui.host.file.open',
  hostFileSave: 'ui.host.file.save',
  hostDraftDiscard: 'ui.host.draft.discard',
  hostEditorPreferenceUpdate: 'ui.host.editorPreference.update',
  hostFileRun: 'ui.host.file.run',
  hostBootSnapshotGet: 'ui.host.bootSnapshot.get',
  hostEditorJumpToLine: 'ui.host.editor.jumpToLine',
  hostEditorGitBaselinesGet: 'ui.host.editor.gitBaselines.get',
  hostEditorFind: 'ui.host.editor.find',
  hostEditorIssuesCommand: 'ui.host.editor.issues.command',
  hostEditorIssuesDump: 'ui.host.editor.issues.dump',
  hostEditorCommand: 'ui.host.editor.command',
  hostDiagnosticsMention: 'ui.host.diagnostics.mention',
  hostStateFileActivityRecord: 'ui.host.state.fileActivity.record',
  hostStateFileScrollUpdate: 'ui.host.state.fileScroll.update',
} as const;

export const UI_IPC_RPC_NOTIFICATIONS = {
  editorSave: 'ui.editor.save',
  editorFocus: 'ui.editor.focus',
  editorBlur: 'ui.editor.blur',
  imeFocus: 'ui.ime.focus',
  imeBlur: 'ui.ime.blur',
  editorReady: 'ui.editor.ready',
  editorOpenComplete: 'ui.editor.open.complete',
  editorCacheState: 'ui.editor.cache.state',
  editorDraftState: 'ui.editor.draft.state',
  editorScrollState: 'ui.editor.scroll.state',
  editorNotify: 'ui.editor.notify',
  editorDiagnosticsCounts: 'ui.editor.diagnostics.counts',
  adapterState: 'ui.adapter.state',
  hostActiveFileChanged: 'ui.host.activeFile.changed',
  openStateChanged: 'ui.openState.changed',
  projectSwitching: 'ui.project.switching',
  projectSwitched: 'ui.project.switched',
  preferencesChanged: 'ui.preferences.changed',
} as const;

type ValueOf<T> = T[keyof T];

export type UiIpcRpcMethod = ValueOf<typeof UI_IPC_RPC_METHODS>;
export type UiIpcRpcNotificationMethod = ValueOf<typeof UI_IPC_RPC_NOTIFICATIONS>;

export interface UiIpcRpcNotification {
  method: UiIpcRpcNotificationMethod;
  params: JsonObject;
}

const UI_IPC_RPC_NOTIFICATION_METHOD_SET = new Set<string>(
  Object.values(UI_IPC_RPC_NOTIFICATIONS),
);

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeUiIpcRpcParams(payload: unknown): JsonObject {
  if (isJsonObject(payload)) {
    return payload;
  }
  return {};
}

export function isUiIpcRpcNotificationMethod(
  method: string,
): method is UiIpcRpcNotificationMethod {
  return UI_IPC_RPC_NOTIFICATION_METHOD_SET.has(method);
}

export function parseUiIpcRpcNotification(
  notification: JsonRpcNotificationEnvelope | JsonObject,
): UiIpcRpcNotification | null {
  const method = typeof notification.method === 'string' ? notification.method : '';
  if (!isUiIpcRpcNotificationMethod(method)) {
    return null;
  }
  return {
    method,
    params: normalizeUiIpcRpcParams(notification.params),
  };
}

export function buildUiIpcRpcNotificationEnvelope(
  method: UiIpcRpcNotificationMethod,
  params: JsonObject = {},
): JsonObject {
  return {
    jsonrpc: '2.0',
    method,
    params,
  };
}
