import { RPC_NAMESPACES } from "../../rpc/namespaces.ts";
import type {
  JsonObject,
  JsonRpcNotificationEnvelope,
} from "../../rpc/transport.ts";

export const EXPLORER_RPC_NAMESPACE = RPC_NAMESPACES.explorer;

export const EXPLORER_RPC_METHODS = {
  cm6Mirror: "explorer.cm6.mirror",
  dirCreate: "explorer.dir.create",
  entriesCopy: "explorer.entries.copy",
  entriesDelete: "explorer.entries.delete",
  entriesMove: "explorer.entries.move",
  editorOpen: "explorer.editor.open",
  entryCopy: "explorer.entry.copy",
  entryCopyFrom: "explorer.entry.copyFrom",
  entryDelete: "explorer.entry.delete",
  entryMove: "explorer.entry.move",
  entryMoveFrom: "explorer.entry.moveFrom",
  entryRename: "explorer.entry.rename",
  extensionsAdapterRestart: "explorer.extensions.adapter.restart",
  extensionsConfigSchemaGet: "explorer.extensions.configSchema.get",
  extensionsConfigure: "explorer.extensions.configure",
  extensionsCustomSettingsGet: "explorer.extensions.customSettings.get",
  extensionsCustomSettingsSet: "explorer.extensions.customSettings.set",
  extensionsInstall: "explorer.extensions.install",
  extensionsList: "explorer.extensions.list",
  extensionsToggle: "explorer.extensions.toggle",
  extensionsUninstall: "explorer.extensions.uninstall",
  extensionsWorkspaceSettingsGet: "explorer.extensions.workspaceSettings.get",
  extensionsWorkspaceSettingsSet: "explorer.extensions.workspaceSettings.set",
  fileCreate: "explorer.file.create",
  gitBranchesList: "explorer.git.branches.list",
  gitClone: "explorer.git.clone",
  gitCommit: "explorer.git.commit",
  gitCommitsList: "explorer.git.commits.list",
  gitDiffBaseGet: "explorer.git.diffBase.get",
  gitDiffBaseSet: "explorer.git.diffBase.set",
  gitInit: "explorer.git.init",
  gitPull: "explorer.git.pull",
  gitPush: "explorer.git.push",
  gitReset: "explorer.git.reset",
  gitRestore: "explorer.git.restore",
  gitStage: "explorer.git.stage",
  gitStageAll: "explorer.git.stageAll",
  gitStatusGet: "explorer.git.status.get",
  gitUnstage: "explorer.git.unstage",
  gitUnstageAll: "explorer.git.unstageAll",
  list: "explorer.list",
  mentionAgent: "explorer.mention.agent",
  openDirsSet: "explorer.openDirs.set",
  prefsAgentIconVendor: "explorer.prefs.agentIcon.vendor",
  prefsUiUpdate: "explorer.prefs.ui.update",
  projectCreate: "explorer.project.create",
  projectList: "explorer.project.list",
  projectOpen: "explorer.project.open",
  pulseAlive: "explorer.pulse.alive",
  refresh: "explorer.refresh",
  reviewDiscard: "explorer.review.discard",
  reviewList: "explorer.review.list",
  reviewSave: "explorer.review.save",
  searchCancel: "explorer.search.cancel",
  searchBenchmarkFrontendResult: "explorer.search.benchmark.frontendResult",
  searchBenchmarkRun: "explorer.search.benchmark.run",
  searchMore: "explorer.search.more",
  searchMoreInFile: "explorer.search.moreInFile",
  searchRun: "explorer.search.run",
  watcherConfigGet: "explorer.watcher.config.get",
  watcherLimitRaise: "explorer.watcher.limit.raise",
  watcherModeSet: "explorer.watcher.mode.set",
} as const;

export const EXPLORER_RPC_NOTIFICATIONS = {
  autosaveContent: "explorer.autosave.content",
  cm6MirrorAck: "explorer.cm6.mirror.ack",
  diagnosticsDetail: "explorer.diagnostics.detail",
  draftContent: "explorer.draft.content",
  editorPrefsChanged: "explorer.editor.prefs.changed",
  error: "explorer.error",
  activeFileUpdated: "explorer.activeFile.updated",
  openStateChanged: "explorer.openState.changed",
  entryCreated: "explorer.entry.created",
  listUpdated: "explorer.list.updated",
  navigate: "explorer.navigate",
  openDirsUpdated: "explorer.openDirs.updated",
  treeUpdated: "explorer.tree.updated",
  decorationsUpdated: "explorer.decorations.updated",
  gitDecorationsUpdated: "explorer.git.decorations.updated",
  extensionsAdapterRestarted: "explorer.extensions.adapter.restarted",
  extensionsAdapterRestarting: "explorer.extensions.adapter.restarting",
  extensionsConfigSchemaUpdated: "explorer.extensions.configSchema.updated",
  extensionsSettingsChanged: "explorer.extensions.settings.changed",
  gitCloneStarted: "explorer.git.clone.started",
  gitDiffBaseUpdated: "explorer.git.diffBase.updated",
  gitPullStarted: "explorer.git.pull.started",
  gitPushStarted: "explorer.git.push.started",
  gitRestored: "explorer.git.restored",
  gitStatusUpdated: "explorer.git.status.updated",
  jobProgress: "explorer.job.progress",
  prefsUiUpdated: "explorer.prefs.ui.updated",
  prefsAgentIconVendored: "explorer.prefs.agentIcon.vendored",
  projectOpened: "explorer.project.opened",
  projectActiveUpdated: "explorer.project.active.updated",
  pulse: "explorer.pulse",
  reviewEntriesUpdated: "explorer.review.entries.updated",
  searchJobDone: "search.job.done",
  searchJobError: "search.job.error",
  searchJobProgress: "search.job.progress",
  searchJobResult: "search.job.result",
  searchBenchmarkDone: "explorer.search.benchmark.done",
  searchBenchmarkError: "explorer.search.benchmark.error",
  searchBenchmarkProgress: "explorer.search.benchmark.progress",
  searchBenchmarkResult: "explorer.search.benchmark.result",
  searchBenchmarkFrontendRecorded: "explorer.search.benchmark.frontendRecorded",
  searchResultsUpdated: "explorer.search.results.updated",
  watcherConfigUpdated: "explorer.watcher.config.updated",
  watcherError: "explorer.watcher.error",
  watcherModeChanged: "explorer.watcher.mode.changed",
  watcherModeStatus: "explorer.watcher.mode.status",
  watcherLimitRaiseResult: "explorer.watcher.limit.raiseResult",
} as const;

type ValueOf<T> = T[keyof T];

export type ExplorerRpcMethod = ValueOf<typeof EXPLORER_RPC_METHODS>;
export type ExplorerRpcNotificationMethod = ValueOf<
  typeof EXPLORER_RPC_NOTIFICATIONS
>;

export interface ExplorerRpcNotification {
  method: ExplorerRpcNotificationMethod;
  params: JsonObject;
}

const EXPLORER_RPC_NOTIFICATION_METHOD_SET = new Set<string>(
  Object.values(EXPLORER_RPC_NOTIFICATIONS),
);

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeExplorerRpcParams(payload: unknown): JsonObject {
  if (isJsonObject(payload)) {
    return payload;
  }
  return {};
}

export function isExplorerRpcNotificationMethod(
  method: string,
): method is ExplorerRpcNotificationMethod {
  return EXPLORER_RPC_NOTIFICATION_METHOD_SET.has(method);
}

export function parseExplorerRpcNotification(
  notification: JsonRpcNotificationEnvelope,
): ExplorerRpcNotification | null {
  if (!isExplorerRpcNotificationMethod(notification.method)) {
    return null;
  }
  return {
    method: notification.method,
    params: normalizeExplorerRpcParams(notification.params),
  };
}
