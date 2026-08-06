import { RPC_NAMESPACES } from '../rpc/namespaces.ts';
import type { JsonObject, JsonRpcNotificationEnvelope } from '../rpc/transport.ts';

export const UI_IPC_RPC_NAMESPACE = RPC_NAMESPACES.uiIpc;

export const UI_IPC_RPC_METHODS = {
  hostFileOpen: 'ui.host.file.open',
  hostFileSave: 'ui.host.file.save',
  hostDraftDiscard: 'ui.host.draft.discard',
  hostEditorPreferenceUpdate: 'ui.host.editorPreference.update',
  hostFileRun: 'ui.host.file.run',
  hostPagePreviewTemplateInstall: 'ui.host.pagePreview.template.install',
  hostRunProfilesGet: 'ui.host.runProfiles.get',
  hostRunProfilesSave: 'ui.host.runProfiles.save',
  hostRunProfileStateGet: 'ui.host.runProfile.state.get',
  hostRunProfileStop: 'ui.host.runProfile.stop',
  hostBootSnapshotGet: 'ui.host.bootSnapshot.get',
  hostLanguageBackendSet: 'ui.host.languageBackend.set',
  hostEditorJumpToLine: 'ui.host.editor.jumpToLine',
  hostEditorGitBaselinesGet: 'ui.host.editor.gitBaselines.get',
  hostEditorFind: 'ui.host.editor.find',
  hostEditorIssuesCommand: 'ui.host.editor.issues.command',
  hostEditorIssuesDump: 'ui.host.editor.issues.dump',
  hostEditorCommand: 'ui.host.editor.command',
  hostCodeInspectorCommand: 'ui.host.codeInspector.command',
  hostDiagnosticsMention: 'ui.host.diagnostics.mention',
  hostGitBranchCheckout: 'ui.host.git.branch.checkout',
  hostGitBranchCreate: 'ui.host.git.branch.create',
  hostGitBranchesList: 'ui.host.git.branches.list',
  hostGitRemoteAdd: 'ui.host.git.remote.add',
  hostStateFileScrollUpdate: 'ui.host.state.fileScroll.update',
  hostRecentFileClose: 'ui.host.recentFile.close',
  sidebarWindowCreate: 'ui.sidebar.window.create',
  sidebarWindowActivate: 'ui.sidebar.window.activate',
  sidebarWindowClose: 'ui.sidebar.window.close',
  sidebarActiveShortcutSet: 'ui.sidebar.activeShortcut.set',
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
  fileTabsDecorationsChanged: 'ui.fileTabs.decorations.changed',
  projectSwitching: 'ui.project.switching',
  projectSwitched: 'ui.project.switched',
  preferencesChanged: 'ui.preferences.changed',
  terminalOpen: 'ui.terminal.open',
  sidebarWindowsChanged: 'ui.sidebar.windows.changed',
  sidebarWindowActivated: 'ui.sidebar.window.activated',
  sidebarWindowReadinessChanged: 'ui.sidebar.window.readiness.changed',
  codeInspectorChanged: 'ui.codeInspector.changed',
  runProfileStateChanged: 'ui.runProfile.state.changed',
  runTargetRoutesChanged: 'ui.runTarget.routes.changed',
} as const;

type ValueOf<T> = T[keyof T];

export type UiIpcRpcMethod = ValueOf<typeof UI_IPC_RPC_METHODS>;
export type UiIpcRpcNotificationMethod = ValueOf<typeof UI_IPC_RPC_NOTIFICATIONS>;

export interface UiIpcRpcNotification {
  method: UiIpcRpcNotificationMethod;
  params: JsonObject;
}

const UI_IPC_RPC_NOTIFICATION_METHOD_SET = new Set<string>(Object.values(UI_IPC_RPC_NOTIFICATIONS));

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeUiIpcRpcParams(payload: unknown): JsonObject {
  if (isJsonObject(payload)) {
    return payload;
  }
  return {};
}

export function isUiIpcRpcNotificationMethod(method: string): method is UiIpcRpcNotificationMethod {
  return UI_IPC_RPC_NOTIFICATION_METHOD_SET.has(method);
}

export function parseUiIpcRpcNotification(notification: JsonRpcNotificationEnvelope | JsonObject): UiIpcRpcNotification | null {
  const method = typeof notification.method === 'string' ? notification.method : '';
  if (!isUiIpcRpcNotificationMethod(method)) {
    return null;
  }
  return {
    method,
    params: normalizeUiIpcRpcParams(notification.params),
  };
}

export function buildUiIpcRpcNotificationEnvelope(method: UiIpcRpcNotificationMethod, params: JsonObject = {}): JsonObject {
  return {
    jsonrpc: '2.0',
    method,
    params,
  };
}
