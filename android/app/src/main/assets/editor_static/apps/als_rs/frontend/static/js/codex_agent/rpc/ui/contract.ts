import { RPC_NAMESPACES } from '../namespaces.ts';

export type JsonObject = Record<string, unknown>;

export const UI_RPC_NAMESPACE = RPC_NAMESPACES.ui;
export const UI_RPC_IMPLEMENTATION_STATUS = 'implemented' as const;
export const UI_RPC_METHODS = {
  viewGet: 'view.get',
  viewSet: 'view.set',
  hostUiGet: 'hostUi.get',
  hostUiRecheck: 'hostUi.recheck',
  filesystemHome: 'filesystem.home',
  filesystemList: 'filesystem.list',
  filesystemSearch: 'filesystem.search',
  projectSummaryGet: 'project.summary.get',
  projectIdentityGet: 'project.identity.get',
  projectAgentDiffAccept: 'project.agentDiff.accept',
  projectAgentDiffReject: 'project.agentDiff.reject',
  projectAgentDiffRejectAll: 'project.agentDiff.rejectAll',
  projectGitStage: 'project.git.stage',
  projectGitUnstage: 'project.git.unstage',
  projectGitRestore: 'project.git.restore',
  projectGitCommit: 'project.git.commit',
  projectGitRemote: 'project.git.remote',
  projectTe2StatusGet: 'project.te2.status.get',
  projectTe2Open: 'project.te2.open',
  projectTe2Create: 'project.te2.create',
  appWindowStatePublish: 'app.windowState.publish',
  fileOpen: 'file.open',
  urlOpen: 'url.open',
} as const;

export type UiRpcMethod =
  typeof UI_RPC_METHODS[keyof typeof UI_RPC_METHODS];

export const UI_RPC_NOTIFICATION_METHODS = [
  'view.changed',
  'hostUi.updated',
  'project.agentDiff.added',
  'project.agentDiff.removed',
] as const;

export type UiRpcNotificationMethod =
  typeof UI_RPC_NOTIFICATION_METHODS[number];

export const UI_RPC_ANCHOR_MODULES = [
  'host/runtime.ts',
  'composer/runtime.ts',
  'conversation_drawer/actions.ts',
  'project_modal.ts',
  'markdown.js',
] as const;
