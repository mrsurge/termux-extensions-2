import {
  EXPLORER_RPC_METHODS,
  EXPLORER_RPC_NOTIFICATIONS,
  type ExplorerRpcMethod,
  type ExplorerRpcNotificationMethod,
} from "./contract.ts";
import {
  handleSearchBenchmarkNotification,
  hasActiveActualSearchBenchmark,
  observeActualSearchNotification,
} from "../search/benchmark.ts";
import type { JsonObject } from "../../rpc/transport.ts";
import type { ExplorerRuntimeState } from "../state/runtime-state.ts";
import type { ExplorerTreeDecorationsController } from "../tree/decorations.ts";
import type { ExplorerGitStatus } from "../git/footer-utils.ts";
import type { ProblemsPanelApi } from "../search/diagnostics-renderer.ts";

interface ExplorerSearchOverlayController {
  handleSearchResultsUpdated(payload: JsonObject): void;
  handleSearchJobProgress(payload: JsonObject): void;
  handleSearchJobResult(payload: JsonObject): void;
  handleSearchJobDone(payload: JsonObject): void;
  handleSearchJobError(payload: JsonObject): void;
  handleSearchError(message: string): boolean;
  handleReviewEntriesUpdated(payload: JsonObject): void;
  cancelActiveSearch(reason: string): void;
  isVisible(): boolean;
  getSearchMode(): string;
}

interface ExplorerNotificationHandlerDeps {
  runtimeState: ExplorerRuntimeState;
  getTreeElement(): HTMLElement | null;
  setTreeElement(next: HTMLElement | null): void;
  getOpenDirectories(): Set<string>;
  setOpenDirsInitialized(next: boolean): void;
  getActiveFileRel(): string | null;
  setActiveFileRel(next: string | null): void;
  hasExplorerRpc(): boolean;
  notifyExplorer(method: ExplorerRpcMethod, payload: JsonObject): void;
  renderProjectLabel(): void;
  initDiffBaseFromBackend(): Promise<void>;
  renderExplorerTree(): void;
  renderEntriesInto(
    containerUl: HTMLElement | null,
    entries: unknown,
    parentRel?: string | null,
  ): void;
  basename(path: string): string;
  restoreOpenDirectories(dirs: string[]): Promise<void> | void;
  notifyDirListComplete(rel: string): void;
  expandToFile(rel: string): Promise<void>;
  expandToPath(rel: string): Promise<void>;
  applyActiveFileMarker(): void;
  setExplorerStickyHeadersEnabled(next: boolean | null): void;
  syncExplorerPrefsUI(): void;
  applyExplorerStickyScopesPreference(): void;
  treeDecorations: ExplorerTreeDecorationsController;
  getDiagnosticsPanel(): ProblemsPanelApi | null;
  searchOverlayController: ExplorerSearchOverlayController;
  renderSearchOverlay(): void;
  dispatchRemoteDraft(payload: JsonObject): void;
  dispatchAutosaveContent(payload: JsonObject): void;
  dispatchPrefsChanged(payload: JsonObject): void;
  dispatchProjectOpened(path: string, payload?: JsonObject): void;
  dispatchWatcherError(payload: JsonObject): void;
  dispatchWatcherRaiseResult(payload: JsonObject): void;
  reloadCurrentFile(): void;
  showGitProgressBar(pct: number, detail?: string): void;
  hideGitProgressBar(): void;
  toast(message: string): void;
  setGitControlsEnabled(enabled: boolean, showInit?: boolean): void;
  renderGitSummary(): void;
  setGitDiffBaseRef(ref: string): void;
  updateDiffBaseButtons(): void;
  toggleDrawer(open?: boolean): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function getProjectedProjectPath(
  payload: JsonObject,
  fallback: string | null = null,
): string | null {
  return (
    getNonEmptyString(payload.resolved_path) ||
    getNonEmptyString(payload.resolvedPath) ||
    getNonEmptyString(payload.projectPath) ||
    getNonEmptyString(payload.path) ||
    fallback
  );
}

function setWatcherRefreshBarVisible(visible: boolean): void {
  try {
    const bar = document.getElementById("fe-watcher-refresh-bar");
    if (bar instanceof HTMLElement) {
      bar.style.display = visible ? "" : "none";
    }
  } catch {
    // Ignore UI refresh-bar races.
  }
}

function coerceGitStatus(payload: JsonObject): ExplorerGitStatus {
  const status: ExplorerGitStatus = {};
  if (typeof payload.branch === "string") status.branch = payload.branch;
  if (payload.detached === true) status.detached = true;
  if (typeof payload.ahead === "number") status.ahead = payload.ahead;
  if (typeof payload.behind === "number") status.behind = payload.behind;
  if (Array.isArray(payload.staged)) status.staged = payload.staged;
  if (Array.isArray(payload.unstaged)) status.unstaged = payload.unstaged;
  if (Array.isArray(payload.untracked)) status.untracked = payload.untracked;
  return status;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
}

function statusesFromGitStatus(payload: JsonObject): Record<string, string> {
  const statuses: Record<string, string> = {};

  function setStatus(rel: string, status: string): void {
    const previous = statuses[rel];
    if (
      (previous === "staged" && status === "modified") ||
      (previous === "modified" && status === "staged")
    ) {
      statuses[rel] = "staged_modified";
      return;
    }
    statuses[rel] = status;
  }

  stringList(payload.staged).forEach((rel) => setStatus(rel, "staged"));
  stringList(payload.unstaged).forEach((rel) => setStatus(rel, "modified"));
  stringList(payload.untracked).forEach((rel) => setStatus(rel, "untracked"));
  return statuses;
}

function applyProjectRootProjection(
  deps: ExplorerNotificationHandlerDeps,
  nextProjectPath: string | null,
  options: { forceReset?: boolean } = {},
): boolean {
  if (!nextProjectPath) return false;
  const prevProjectPath = deps.runtimeState.getProjectPath() || "";
  const projectChanged =
    options.forceReset === true ||
    (!!prevProjectPath && prevProjectPath !== nextProjectPath);
  deps.runtimeState.setProjectPath(nextProjectPath);
  deps.renderProjectLabel();
  if (!projectChanged) return false;

  deps.setActiveFileRel(null);
  deps.getOpenDirectories().clear();
  deps.setOpenDirsInitialized(false);
  deps.runtimeState.setGitStatus(null);
  deps.renderExplorerTree();
  deps.renderGitSummary();
  deps.setGitControlsEnabled(false, false);
  if (deps.hasExplorerRpc()) {
    deps.notifyExplorer(EXPLORER_RPC_METHODS.list, { rel: "." });
    deps.notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
  }
  void deps.initDiffBaseFromBackend();
  return true;
}

function applyBackendOpenStateProjection(
  deps: ExplorerNotificationHandlerDeps,
  value: unknown,
): void {
  // Project-open resets clear Explorer-local render state; this reapplies the
  // backend sidecar open-state fact after that reset boundary.
  const openState = isRecord(value) ? value : null;
  const nextRel = openState
    ? getStringValue(openState.openFileRel) || getStringValue(openState.rel)
    : null;
  deps.setActiveFileRel(nextRel);
  if (nextRel) {
    Promise.resolve(deps.expandToFile(nextRel))
      .then(() => {
        try {
          deps.applyActiveFileMarker();
        } catch {
          // Ignore marker races after project reset.
        }
      })
      .catch(() => {});
  } else {
    try {
      deps.applyActiveFileMarker();
    } catch {
      // Ignore marker races while clearing project state.
    }
  }
}

function getJobProgressPercent(value: unknown): number {
  if (!isRecord(value)) {
    return 0;
  }
  return typeof value.completed === "number"
    ? value.completed
    : Number(value.completed || 0);
}

function getJobProgressDetail(
  value: unknown,
  fallbackMessage: string | null,
): string {
  if (isRecord(value) && typeof value.detail === "string" && value.detail) {
    return value.detail;
  }
  return fallbackMessage || "";
}

export function createExplorerNotificationHandler(
  deps: ExplorerNotificationHandlerDeps,
) {
  function handleExplorerNotification(
    method: ExplorerRpcNotificationMethod,
    payload: JsonObject,
  ): void {
    if (method === EXPLORER_RPC_NOTIFICATIONS.watcherError) {
      deps.dispatchWatcherError(payload || {});
      return;
    }

    if (method === EXPLORER_RPC_NOTIFICATIONS.watcherLimitRaiseResult) {
      deps.dispatchWatcherRaiseResult(payload || {});
      return;
    }

    if (method === EXPLORER_RPC_NOTIFICATIONS.watcherModeChanged) {
      setWatcherRefreshBarVisible(payload.mode === "none");
      return;
    }

    if (method === EXPLORER_RPC_NOTIFICATIONS.watcherConfigUpdated) {
      setWatcherRefreshBarVisible(payload.mode === "none");
    }

    switch (method) {
      case EXPLORER_RPC_NOTIFICATIONS.prefsUiUpdated: {
        const ui = isRecord(payload.ui) ? payload.ui : null;
        const next = ui?.explorerStickyHeaders;
        if (typeof next === "boolean") {
          deps.setExplorerStickyHeadersEnabled(next);
        }
        deps.syncExplorerPrefsUI();
        deps.applyExplorerStickyScopesPreference();
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.projectActiveUpdated: {
        const prevProjectPath = deps.runtimeState.getProjectPath() || "";
        const nextProjectPath = getProjectedProjectPath(
          payload,
          prevProjectPath,
        );
        const projectChanged = applyProjectRootProjection(
          deps,
          nextProjectPath,
        );
        if (projectChanged) {
          deps.searchOverlayController.cancelActiveSearch("projectChanged");
        }
        void deps.initDiffBaseFromBackend();

        if (
          !projectChanged &&
          prevProjectPath &&
          nextProjectPath &&
          prevProjectPath !== nextProjectPath
        ) {
          deps.setActiveFileRel(null);
          deps.getOpenDirectories().clear();
          deps.setOpenDirsInitialized(false);
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.activeFileUpdated: {
        const nextRel = getStringValue(payload.rel);
        deps.setActiveFileRel(nextRel);
        if (nextRel) {
          Promise.resolve(deps.expandToFile(nextRel))
            .then(() => {
              try {
                deps.applyActiveFileMarker();
              } catch {
                // Ignore marker races during open.
              }
            })
            .catch(() => {});
        } else {
          try {
            deps.applyActiveFileMarker();
          } catch {
            // Ignore marker races during clear.
          }
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.openStateChanged: {
        const nextProjectPath = getProjectedProjectPath(payload);
        applyProjectRootProjection(deps, nextProjectPath);
        applyBackendOpenStateProjection(deps, payload);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.openDirsUpdated: {
        const dirs = Array.isArray(payload.dirs)
          ? payload.dirs.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        void deps.restoreOpenDirectories(dirs);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.listUpdated: {
        const cwd = getNonEmptyString(payload.cwd) || ".";
        let treeElement = deps.getTreeElement();
        if (!treeElement) {
          treeElement = document.getElementById("fe-file-tree");
          deps.setTreeElement(treeElement);
        }
        if (!treeElement) break;

        if (cwd === "." || cwd === "") {
          const currentProjectPath = deps.runtimeState.getProjectPath();
          const sameProject =
            !!deps.runtimeState.getRenderedProjectPath() &&
            !!currentProjectPath &&
            deps.runtimeState.getRenderedProjectPath() === currentProjectPath;
          let rootLi = treeElement.querySelector<HTMLLIElement>(
            "li.fe-tree-node.fe-tree-root",
          );
          if (!rootLi || !sameProject) {
            deps.renderExplorerTree();
            treeElement = deps.getTreeElement();
            rootLi =
              treeElement?.querySelector<HTMLLIElement>(
                "li.fe-tree-node.fe-tree-root",
              ) || null;
          } else {
            const label = rootLi.querySelector<HTMLElement>(
              ":scope > .fe-tree-text",
            );
            if (label) {
              label.textContent =
                deps.basename(currentProjectPath || "") || "Project";
            }
          }
          if (!rootLi) break;
          let childList = rootLi.querySelector<HTMLUListElement>(
            ":scope > ul.fe-tree",
          );
          if (!childList) {
            childList = document.createElement("ul");
            childList.className = "fe-tree";
            rootLi.appendChild(childList);
          }
          deps.renderEntriesInto(childList, payload.entries);

          if (deps.runtimeState.getReconnectResyncPending()) {
            deps.runtimeState.setReconnectResyncPending(false);
            if (deps.getOpenDirectories().size && deps.hasExplorerRpc()) {
              void deps.restoreOpenDirectories(
                Array.from(deps.getOpenDirectories()),
              );
            }
          }
        } else {
          const dirLi = treeElement.querySelector<HTMLLIElement>(
            `li.fe-tree-node[data-kind="dir"][data-rel="${cwd}"]`,
          );
          if (!dirLi) break;

          const wasOpen = dirLi.dataset.open === "true";
          let childList = dirLi.querySelector<HTMLUListElement>(
            ":scope > ul.fe-tree",
          );
          const trackedAsOpen = deps.getOpenDirectories().has(cwd);

          if (wasOpen || childList || trackedAsOpen) {
            if (!childList) {
              childList = document.createElement("ul");
              childList.className = "fe-tree";
              dirLi.appendChild(childList);
            }
            dirLi.dataset.open = "true";
            deps.renderEntriesInto(childList, payload.entries);
            if (cwd !== "." && cwd !== "") {
              deps.getOpenDirectories().add(cwd);
            }
          }
        }

        deps.notifyDirListComplete(cwd);
        deps.applyActiveFileMarker();
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.treeUpdated: {
        const nextProjectPath = getProjectedProjectPath(payload);
        if (nextProjectPath) {
          deps.runtimeState.setProjectPath(nextProjectPath);
        }
        deps.renderProjectLabel();
        deps.renderExplorerTree();
        const treeElement = deps.getTreeElement();
        if (treeElement) {
          const rootLi = treeElement.querySelector<HTMLLIElement>(
            "li.fe-tree-node.fe-tree-root",
          );
          if (rootLi) {
            let childList = rootLi.querySelector<HTMLUListElement>(
              ":scope > ul.fe-tree",
            );
            if (!childList) {
              childList = document.createElement("ul");
              childList.className = "fe-tree";
              rootLi.appendChild(childList);
            }
            deps.renderEntriesInto(
              childList,
              payload.entries ?? payload.nodes ?? [],
            );
          }
        }
        if (!deps.runtimeState.getGitStatus() && deps.hasExplorerRpc()) {
          deps.notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.decorationsUpdated: {
        deps.treeDecorations.applyDraftDecorations(payload);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.gitDecorationsUpdated: {
        deps.treeDecorations.applyGitDecorations(payload);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.diagnosticsDetail: {
        deps.treeDecorations.setDiagnosticsDetail(payload);
        const livePanel = deps.getDiagnosticsPanel();
        const projectPath = (deps.runtimeState.getProjectPath() || "").replace(
          /\/+$/,
          "",
        );
        const activeFileRel = deps.getActiveFileRel();
        const activeAbs =
          activeFileRel && projectPath
            ? `${projectPath}/${activeFileRel}`
            : null;
        if (livePanel) {
          if (activeAbs) {
            livePanel.setActiveFile(activeAbs);
          }
          livePanel.update(deps.treeDecorations.getDiagnosticsDetail());
          deps.treeDecorations.setDiagnosticsSummary(
            livePanel.getSummary(projectPath),
          );
          deps.treeDecorations.applyAggregatedDiagnosticFlags();
        } else {
          deps.treeDecorations.setDiagnosticsSummary(
            deps.treeDecorations.deriveSummaryFromDetail(projectPath),
          );
          deps.treeDecorations.applyAggregatedDiagnosticFlags();
        }

        if (
          deps.searchOverlayController.isVisible() &&
          deps.searchOverlayController.getSearchMode() === "diagnostics"
        ) {
          deps.renderSearchOverlay();
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.draftContent: {
        deps.dispatchRemoteDraft(payload);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.autosaveContent: {
        deps.dispatchAutosaveContent(payload);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.editorPrefsChanged: {
        deps.dispatchPrefsChanged(payload);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.projectOpened: {
        const path = getProjectedProjectPath(payload);
        if (path) {
          const prevProjectPath = deps.runtimeState.getProjectPath() || "";
          if (prevProjectPath && prevProjectPath !== path) {
            deps.searchOverlayController.cancelActiveSearch("projectChanged");
          }
          applyProjectRootProjection(deps, path, { forceReset: true });
          deps.dispatchProjectOpened(path, payload);
          applyBackendOpenStateProjection(deps, payload.openState);
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.gitStatusUpdated: {
        console.log("[GIT_STATUS_DEBUG] Received:", payload);
        deps.runtimeState.setGitStatus(coerceGitStatus(payload));
        deps.treeDecorations.applyGitDecorations({
          statuses: statusesFromGitStatus(payload),
        });
        deps.renderGitSummary();
        deps.setGitControlsEnabled(true, false);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.gitDiffBaseUpdated: {
        const ref = getNonEmptyString(payload.ref);
        if (ref) {
          deps.setGitDiffBaseRef(ref);
          if (payload.refresh === true) {
            void deps.initDiffBaseFromBackend().catch(() => {});
          } else {
            deps.updateDiffBaseButtons();
          }
          if (deps.searchOverlayController.isVisible()) {
            deps.renderSearchOverlay();
          }
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.gitRestored: {
        deps.reloadCurrentFile();
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.jobProgress: {
        const type = getNonEmptyString(payload.type);
        const status = getNonEmptyString(payload.status);
        const message = getNonEmptyString(payload.message);
        const error = getNonEmptyString(payload.error);
        if (!type || !type.startsWith("git_") || !status) {
          break;
        }

        if (status === "running") {
          deps.showGitProgressBar(
            getJobProgressPercent(payload.progress),
            getJobProgressDetail(payload.progress, message),
          );
        } else if (status === "succeeded") {
          deps.hideGitProgressBar();
          deps.toast(message || `${type.replace("_", " ")} completed`);
          if (
            (type === "git_pull" ||
              type === "git_push" ||
              type === "git_clone") &&
            deps.hasExplorerRpc()
          ) {
            deps.notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
            deps.notifyExplorer(EXPLORER_RPC_METHODS.refresh, {});
          }
        } else if (status === "failed") {
          deps.hideGitProgressBar();
          deps.toast(error || message || `${type.replace("_", " ")} failed`);
        } else if (status === "cancelled") {
          deps.hideGitProgressBar();
          deps.toast(`${type.replace("_", " ")} cancelled`);
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.gitPushStarted:
      case EXPLORER_RPC_NOTIFICATIONS.gitPullStarted:
      case EXPLORER_RPC_NOTIFICATIONS.gitCloneStarted: {
        deps.showGitProgressBar(0, "Starting...");
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.searchResultsUpdated: {
        deps.searchOverlayController.handleSearchResultsUpdated(payload);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.searchJobProgress: {
        const benchmarkActive = hasActiveActualSearchBenchmark();
        const startedAt = benchmarkActive ? performance.now() : 0;
        deps.searchOverlayController.handleSearchJobProgress(payload);
        if (benchmarkActive) {
          observeActualSearchNotification(
            "search.job.progress",
            payload,
            performance.now() - startedAt,
          );
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.searchJobResult: {
        const benchmarkActive = hasActiveActualSearchBenchmark();
        const startedAt = benchmarkActive ? performance.now() : 0;
        deps.searchOverlayController.handleSearchJobResult(payload);
        if (benchmarkActive) {
          observeActualSearchNotification(
            "search.job.result",
            payload,
            performance.now() - startedAt,
          );
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.searchJobDone: {
        const benchmarkActive = hasActiveActualSearchBenchmark();
        const startedAt = benchmarkActive ? performance.now() : 0;
        deps.searchOverlayController.handleSearchJobDone(payload);
        if (benchmarkActive) {
          observeActualSearchNotification(
            "search.job.done",
            payload,
            performance.now() - startedAt,
          );
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.searchJobError: {
        const benchmarkActive = hasActiveActualSearchBenchmark();
        const startedAt = benchmarkActive ? performance.now() : 0;
        deps.searchOverlayController.handleSearchJobError(payload);
        if (benchmarkActive) {
          observeActualSearchNotification(
            "search.job.error",
            payload,
            performance.now() - startedAt,
          );
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.searchBenchmarkProgress:
      case EXPLORER_RPC_NOTIFICATIONS.searchBenchmarkResult:
      case EXPLORER_RPC_NOTIFICATIONS.searchBenchmarkDone:
      case EXPLORER_RPC_NOTIFICATIONS.searchBenchmarkError:
      case EXPLORER_RPC_NOTIFICATIONS.searchBenchmarkFrontendRecorded: {
        handleSearchBenchmarkNotification(method, payload);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.error: {
        const message = getNonEmptyString(payload.error) || "Unknown error";
        if (!deps.searchOverlayController.handleSearchError(message)) {
          deps.toast(message);
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.reviewEntriesUpdated: {
        deps.searchOverlayController.handleReviewEntriesUpdated(payload);
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.pulse: {
        if (deps.hasExplorerRpc()) {
          deps.notifyExplorer(EXPLORER_RPC_METHODS.pulseAlive, {});
        }
        break;
      }
      case EXPLORER_RPC_NOTIFICATIONS.navigate: {
        const rel = getStringValue(payload.rel) || "";
        if (payload.open_drawer === true) {
          deps.toggleDrawer(true);
        }
        if (rel) {
          void deps.expandToPath(rel);
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    handleExplorerNotification,
  };
}
