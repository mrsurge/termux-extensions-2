// app/apps/file_editor_cm6/src/explorer/app/bootstrap.ts
// Explorer v2 – Socket.IO‑driven, backend‑owned state.
//
// Responsibilities:
// - Render the explorer tree/cards from backend snapshots (`explorer:setTree`).
// - Reflect git status and draft flags on entries.
// - Wire basic chrome (drawer open/close, project label, git summary, header actions).
// - Expose `initExplorerUI` plus typed Explorer runtime hooks for host integration.
//
// All state that matters lives on the backend; this module treats incoming
// messages as the source of truth and only keeps enough transient state to draw.

import { showNewProjectModal } from "../chrome/new-project-modal.ts";
import { getIcon as getSetiIcon } from "/static/vendor/seti-icons/seti-icons.js";
import type { JsonObject } from "../../rpc/transport.ts";
import { createExplorerStickyScopes } from "../chrome/sticky-scopes.ts";
import { registerExplorerPublicApi } from "./public-api.ts";
import { createExplorerDirectoryStateHelpers } from "../tree/directory-state-utils.ts";
import { createExplorerChromeController } from "../chrome/explorer-chrome-controller.ts";
import { createExplorerUiHelpers } from "../chrome/ui-helpers.ts";
import { createExplorerDiffBaseController } from "../git/diff-base-controller.ts";
import { createExplorerActiveFileUtils } from "../tree/active-file-utils.ts";
import { createExplorerTreeRenderer } from "../tree/renderer.ts";
import { createExplorerTreeMenuController } from "../tree/menu-controller.ts";
import { createExplorerTreeClickHandler } from "../tree/click-handler.ts";
import { createExplorerTreeDecorationsController } from "../tree/decorations.ts";
import type { ExplorerTreeMenuEntry } from "../tree/types.ts";
import {
  createExplorerFileOpenBridge,
  type ExplorerJumpOptions,
} from "../host/file-open-bridge.ts";
import { createExplorerSearchOverlayController } from "../search/overlay-controller.ts";
import { getErrorMessage } from "../utils/errors.ts";
import { createExplorerRefreshController } from "./refresh-controller.ts";
import {
  EXPLORER_RPC_METHODS,
  type ExplorerRpcMethod,
  isExplorerRpcNotificationMethod,
} from "../rpc/contract.ts";
import {
  isExplorerRpcAvailable,
  notifyExplorerRpc,
  requestExplorerRpc,
} from "../rpc/client.ts";
import {
  createExplorerRpcRuntime,
  type ExplorerRpcRuntime,
  type ExplorerRpcRuntimeDeps,
} from "../rpc/runtime.ts";
import { createExplorerNotificationHandler } from "../rpc/notifications.ts";
import { getParentRel as getParentRelModule } from "../tree/path-watcher-utils.ts";
import { createExplorerGitFooterUtils } from "../git/footer-utils.ts";
import {
  renderExplorerDiagnostics,
  getExplorerDiagnosticsPanel,
} from "../search/diagnostics-renderer.ts";
import { createExplorerRuntimeState } from "../state/runtime-state.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCancelledError(error: unknown): boolean {
  return getErrorMessage(error, "") === "cancelled";
}

function isExplorerTreeMenuEntry(
  value: unknown,
): value is ExplorerTreeMenuEntry {
  return (
    isRecord(value) &&
    typeof value.rel === "string" &&
    typeof value.name === "string" &&
    typeof value.kind === "string"
  );
}

type ExplorerGitButtons = {
  init: HTMLButtonElement | null;
  stage: HTMLButtonElement | null;
  unstage: HTMLButtonElement | null;
  commit: HTMLButtonElement | null;
  push: HTMLButtonElement | null;
  pull: HTMLButtonElement | null;
  reset: HTMLButtonElement | null;
};

type ExplorerSearchOverlayControllerApi = ReturnType<
  typeof createExplorerSearchOverlayController
>;
type ExplorerTimer = ReturnType<typeof setTimeout> | null;

let treeElement: HTMLElement | null = null;
let gitSummaryEl: HTMLElement | null = null;
let gitButtons: ExplorerGitButtons | null = null;
let explorerRpcRuntime: ExplorerRpcRuntime | null = null;
const explorerRuntimeState = createExplorerRuntimeState();
let draftUpdateListenerInstalled = false;

// Currently opened document (relative to project root), if known.
let activeFileRel: string | null = null;

function hasExplorerRpc(): boolean {
  return isExplorerRpcAvailable();
}

function notifyExplorer(
  method: string,
  payload: Record<string, unknown> = {},
): boolean {
  return notifyExplorerRpc(method as ExplorerRpcMethod, payload as JsonObject);
}

export type ExplorerUiInitOptions = ExplorerRpcRuntimeDeps;

function setActiveFileRel(nextRel: string | null): void {
  explorerActiveFileUtils.setActiveFileRel(nextRel);
}

function applyActiveFileMarker(): void {
  explorerActiveFileUtils.applyActiveFileMarker();
}

function relFromAbsPath(absPath: string | null | undefined): string | null {
  return explorerActiveFileUtils.relFromAbsPath(absPath);
}

function applyDraftFlag(
  rel: string | null | undefined,
  hasDraft: boolean,
): void {
  explorerActiveFileUtils.applyDraftFlag(rel, hasDraft);
}

async function scrollToActiveFile(): Promise<void> {
  return explorerActiveFileUtils.scrollToActiveFile();
}

// --- Seti-UI file icons (files only; dirs keep emoji) ---
function applySetiIconToSpan(
  span: HTMLElement,
  fileName: string,
  kind = "file",
): void {
  if (!span) return;
  if (kind !== "file") {
    // Ensure directories don't inherit prior SVG.
    span.innerHTML = "";
    span.style.color = "";
    return;
  }
  const name = fileName || "";
  if (!span.innerHTML && !span.textContent) {
    span.textContent = "📄";
  }
  getSetiIcon(name)
    .then((icon) => {
      if (!span.isConnected) return;
      if (icon && icon.svg) {
        span.innerHTML = icon.svg;
      }
      span.style.color = icon && icon.color ? icon.color : "";
    })
    .catch(() => {
      // Leave fallback (emoji / default) in place.
    });
}

// --- Batch Select Mode state ---
let selectModeDir: string | null = null; // rel of directory in select mode, or null
const selectedEntries = new Set<string>(); // rel paths of checked items

function isEntrySelected(rel: string): boolean {
  return selectedEntries.has(rel);
}

function setEntrySelected(rel: string, selected: boolean): void {
  if (selected) {
    selectedEntries.add(rel);
  } else {
    selectedEntries.delete(rel);
  }
}

// --- Open Directories Persistence ---
const openDirectories = new Set<string>(); // rel paths of currently open directories
let openDirsSyncTimer: ExplorerTimer = null;
const OPEN_DIRS_SYNC_DEBOUNCE = 500; // ms
let openDirsInitialized = false; // True after we've received initial open dirs from backend

const explorerDirectoryStateHelpers = createExplorerDirectoryStateHelpers({
  getTreeElement: () => treeElement,
  getSelectModeDir: () => selectModeDir,
  setSelectModeDir: (next) => {
    selectModeDir = next;
  },
  clearSelectedEntries: () => selectedEntries.clear(),
  hasExplorerBus: () => hasExplorerRpc(),
  sendExplorerBus: (method, payload) => notifyExplorer(method, payload),
  getOpenDirectories: () => openDirectories,
  getOpenDirsInitialized: () => openDirsInitialized,
  getOpenDirsSyncTimer: () => openDirsSyncTimer,
  setOpenDirsSyncTimer: (next) => {
    openDirsSyncTimer = next;
  },
  getOpenDirsSyncDebounce: () => OPEN_DIRS_SYNC_DEBOUNCE,
});
const explorerUiHelpers = createExplorerUiHelpers();
const explorerActiveFileUtils = createExplorerActiveFileUtils({
  getTreeElement: () => treeElement,
  setTreeElement: (next) => {
    treeElement = next;
  },
  getActiveFileRel: () => activeFileRel,
  setActiveFileRelValue: (next) => {
    activeFileRel = next;
  },
  getProjectPath: () => explorerRuntimeState.getProjectPath(),
  expandToFile,
  toast,
});
const explorerFileOpenBridge = createExplorerFileOpenBridge({
  getProjectPath: () => explorerRuntimeState.getProjectPath(),
  expandToFile,
  closeDrawerIfMobile,
  toast,
});
const explorerGitFooterUtils = createExplorerGitFooterUtils({
  getGitSummaryElement: () => gitSummaryEl,
  getGitStatus: () => explorerRuntimeState.getGitStatus(),
  getGitButtons: () => gitButtons,
  hasExplorerBus: () => hasExplorerRpc(),
  sendExplorerBus: (method, payload) => notifyExplorer(method, payload),
  toast,
  reloadCurrentFile: () => window.__cm6ReloadCurrentFile?.(),
});
let explorerSearchOverlayController: ExplorerSearchOverlayControllerApi;
const explorerDiffBaseController = createExplorerDiffBaseController({
  hasExplorerRpc: () => hasExplorerRpc(),
  notifyExplorer: (method, payload) => notifyExplorer(method, payload),
  toast,
  setGitControlsEnabled,
  reloadCurrentFile,
  isChangesMode: () =>
    explorerSearchOverlayController?.getSearchMode() === "changes",
  refreshChangesResults: (force = false) =>
    explorerSearchOverlayController?.fetchChangesResults(force),
  getEditorState: () => window.__cm6EditorState || null,
});
const explorerChromeController = createExplorerChromeController({
  getProjectPath: () => explorerRuntimeState.getProjectPath(),
  basename,
  toast,
  hasExplorerRpc: () => hasExplorerRpc(),
  notifyExplorer: (method, payload) => notifyExplorer(method, payload),
  closeDiffBaseMenus: () => explorerDiffBaseController.closeMenus(),
  openSearchOverlay: () => openSearchOverlay(),
  scrollToActiveFile,
  showNewProjectModal,
  isCancelledError,
  getErrorMessage,
  initStickyScopes: (deps) => createExplorerStickyScopes(deps),
});
explorerSearchOverlayController = createExplorerSearchOverlayController({
  toast,
  hasExplorerRpc: () => hasExplorerRpc(),
  notifyExplorer: (method, payload) => notifyExplorer(method, payload),
  requestExplorer: (method, payload, timeoutMs) =>
    requestExplorerRpc(method, payload, timeoutMs),
  getProjectPath: () => explorerRuntimeState.getProjectPath() || "",
  openFileAndMaybeJump: (rel, lineNumber, jumpOptions) =>
    explorerFileOpenBridge.openFileAndMaybeJump(rel, lineNumber, jumpOptions),
  expandToPath,
  applySetiIconToSpan,
  basename,
  ensureDraftDiffs: async () => {
    if (typeof window.__cm6EnsureDraftDiffs === "function") {
      try {
        await window.__cm6EnsureDraftDiffs(true);
      } catch {
        /* ignore */
      }
    }
  },
  ensureInlineDiffs: async () => {
    if (typeof window.__cm6EnsureInlineDiffs === "function") {
      try {
        await window.__cm6EnsureInlineDiffs(true);
      } catch (err) {
        console.warn("Failed to auto-enable inline diffs:", err);
      }
    }
  },
  renderDiagnosticsResults: (container) => {
    const proj = explorerRuntimeState.getProjectPath() || "";
    const activeAbs = activeFileRel && proj ? `${proj}/${activeFileRel}` : null;
    renderExplorerDiagnostics(
      container,
      explorerTreeDecorationsController.getDiagnosticsDetail(),
      {
        openFileAndMaybeJump,
        toast,
        mentionAgent: (payload) => {
          if (!hasExplorerRpc()) {
            throw new Error("Explorer RPC unavailable");
          }
          notifyExplorer(EXPLORER_RPC_METHODS.mentionAgent, { ...payload });
        },
        getProjectPath: () => explorerRuntimeState.getProjectPath(),
        activeFileAbs: activeAbs,
      },
    );
  },
  getGitDiffBase: () => explorerDiffBaseController.getDiffBase(),
  setGitDiffBase: (next) => {
    explorerDiffBaseController.setDiffBase(next);
  },
  onGitDiffBaseChanged: () => explorerDiffBaseController.updateButtons(),
  toggleDiffBaseMenu: (button, dropdown) =>
    explorerDiffBaseController.toggleMenu(button, dropdown),
});
const explorerTreeDecorationsController =
  createExplorerTreeDecorationsController({
    getTreeElement: () => treeElement,
    setTreeElement: (next) => {
      treeElement = next;
    },
  });
const explorerTreeRenderer = createExplorerTreeRenderer({
  getTreeElement: () => treeElement,
  setTreeElement: (next) => {
    treeElement = next;
  },
  getProjectPath: () => explorerRuntimeState.getProjectPath(),
  clearElement,
  basename,
  isInSelectMode: (parentRel) => isInSelectMode(parentRel),
  isEntrySelected,
  setEntrySelected,
  applySetiIconToSpan,
  applyAggregatedGitStatusFlags,
  applyAggregatedDiagnosticFlags,
});
const explorerTreeMenuController = createExplorerTreeMenuController({
  getTreeElement: () => treeElement,
  getSelectedEntries: () => selectedEntries,
  getProjectPath: () => explorerRuntimeState.getProjectPath(),
  hasExplorerRpc: () => hasExplorerRpc(),
  notifyExplorer: (method, payload) => notifyExplorer(method, payload),
  toast,
  isInSelectMode: (rel) => rel !== null && isInSelectMode(rel),
  enableSelectMode: (rel) => enableSelectMode(rel),
  disableSelectMode: () => disableSelectMode(),
  openFileAndMaybeJump: (rel, lineNumber, jumpOptions) =>
    explorerFileOpenBridge.openFileAndMaybeJump(rel, lineNumber, jumpOptions),
  isCancelledError,
  getErrorMessage,
});
const explorerTreeClickHandler = createExplorerTreeClickHandler({
  getTreeElement: () => treeElement,
  getProjectPath: () => explorerRuntimeState.getProjectPath(),
  getSelectModeDir: () => selectModeDir,
  hasExplorerRpc: () => hasExplorerRpc(),
  notifyExplorer: (method, payload) => notifyExplorer(method, payload),
  checkAutoDisableSelectMode: (rel) => checkAutoDisableSelectMode(rel),
  markDirectoryOpen: (rel, isOpen) => markDirectoryOpen(rel, isOpen),
  setEntrySelected,
  openCardMenuForEntry: (entry, anchorEl) =>
    explorerTreeMenuController.openCardMenuForEntry(entry, anchorEl),
  openFile: async (rel) => {
    await explorerFileOpenBridge.openFileAndMaybeJump(rel);
  },
});

function updateDiffBaseButtons() {
  explorerDiffBaseController.updateButtons();
}

async function initDiffBaseFromBackend() {
  await explorerDiffBaseController.initFromBackend();
}

function clearElement(el: HTMLElement | null): void {
  explorerUiHelpers.clearElement(el);
}

function basename(path: string): string {
  return explorerUiHelpers.basename(path);
}

function toast(message: string): void {
  explorerUiHelpers.toast(message);
}

function isMobileLayout(): boolean {
  return explorerUiHelpers.isMobileLayout();
}

function closeDrawerIfMobile(): void {
  explorerUiHelpers.closeDrawerIfMobile();
}

// --- Batch Select Mode helpers ---

function isInSelectMode(parentRel: string): boolean {
  return explorerDirectoryStateHelpers.isInSelectMode(parentRel);
}

function enableSelectMode(dirRel: string): void {
  explorerDirectoryStateHelpers.enableSelectMode(dirRel);
}

function disableSelectMode(): void {
  explorerDirectoryStateHelpers.disableSelectMode();
}

function collapseSubdirsOf(parentRel: string): void {
  explorerDirectoryStateHelpers.collapseSubdirsOf(parentRel);
}

function checkAutoDisableSelectMode(collapsedRel: string): void {
  explorerDirectoryStateHelpers.checkAutoDisableSelectMode(collapsedRel);
}

// --- Open Directories Persistence ---

function markDirectoryOpen(rel: string, isOpen: boolean): void {
  explorerDirectoryStateHelpers.markDirectoryOpen(rel, isOpen);
}

function scheduleOpenDirsSync(): void {
  explorerDirectoryStateHelpers.scheduleOpenDirsSync();
}

function syncOpenDirsToBackend(): void {
  explorerDirectoryStateHelpers.syncOpenDirsToBackend();
}

async function restoreOpenDirectories(dirs: string[]): Promise<void> {
  /**
   * Restore open directories from backend on page load.
   * Expands each directory in order, skipping any that don't exist.
   */
  if (!Array.isArray(dirs) || !dirs.length) {
    openDirsInitialized = true;
    return;
  }

  // Sort by depth (shortest paths first) to expand parents before children
  const sorted = [...dirs].sort((a, b) => {
    const depthA = (a.match(/\//g) || []).length;
    const depthB = (b.match(/\//g) || []).length;
    return depthA - depthB;
  });

  for (const rel of sorted) {
    try {
      await expandDirectoryIfExists(rel);
    } catch (e) {
      // Directory doesn't exist or failed to expand - skip it
      console.warn(`[Explorer] Failed to restore open directory: ${rel}`, e);
    }
  }

  openDirsInitialized = true;

  // Sync cleaned list back to backend (removes any dirs that no longer exist)
  scheduleOpenDirsSync();
}

async function expandDirectoryIfExists(rel: string): Promise<void> {
  /**
   * Expand a single directory if it exists in the tree.
   * Unlike expandToPath, this only expands the target directory itself,
   * assuming parent directories are already open.
   */
  if (!treeElement) {
    treeElement = document.getElementById("fe-file-tree");
  }
  if (!treeElement || !rel) return;

  // First, expand any parent directories needed
  const parts = rel.split("/").filter(Boolean);
  let currentRel = ".";

  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    const nextRel = currentRel === "." ? segment : `${currentRel}/${segment}`;

    let targetLi = treeElement.querySelector<HTMLLIElement>(
      `li.fe-tree-node[data-kind="dir"][data-rel="${nextRel}"]`,
    );

    if (!targetLi) {
      // Node not in DOM - need to request parent listing first
      const parentLi = treeElement.querySelector<HTMLLIElement>(
        `li.fe-tree-node[data-kind="dir"][data-rel="${currentRel}"]`,
      );

      if (parentLi && parentLi.dataset.open !== "true") {
        parentLi.dataset.open = "true";
        openDirectories.add(currentRel === "." ? "" : currentRel);
        await _requestDirListAndWait(currentRel);
      }

      // Try again after parent expanded
      targetLi = treeElement.querySelector<HTMLLIElement>(
        `li.fe-tree-node[data-kind="dir"][data-rel="${nextRel}"]`,
      );

      if (!targetLi) {
        // Directory doesn't exist - stop here
        throw new Error(`Directory not found: ${nextRel}`);
      }
    }

    // Expand this directory if not already open
    if (targetLi.dataset.open !== "true") {
      targetLi.dataset.open = "true";
      openDirectories.add(nextRel);
      await _requestDirListAndWait(nextRel);
    }

    currentRel = nextRel;
  }
}

// --- Expand to file/directory ---

// Pending directory list requests - maps rel -> { resolve, reject, timeout }
const _pendingDirListRequests = new Map<
  string,
  {
    resolve: () => void;
    reject: (reason?: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

function _notifyDirListComplete(rel: string): void {
  /**
   * Called when explorer:setList is received for a directory.
   * Resolves any pending expand request waiting for this directory.
   */
  const pending = _pendingDirListRequests.get(rel);
  if (pending) {
    clearTimeout(pending.timeout);
    _pendingDirListRequests.delete(rel);
    pending.resolve();
  }
}

async function _requestDirListAndWait(
  rel: string,
  timeoutMs = 2000,
): Promise<void> {
  /**
   * Requests a directory listing and waits for the response.
   * Returns a promise that resolves when the listing is received.
   */
  return new Promise<void>((resolve, reject) => {
    // Set up timeout
    const timeout = setTimeout(() => {
      _pendingDirListRequests.delete(rel);
      resolve(); // Resolve anyway to continue, don't block forever
    }, timeoutMs);

    _pendingDirListRequests.set(rel, { resolve, reject, timeout });

    // Send request
    if (hasExplorerRpc()) {
      notifyExplorer(EXPLORER_RPC_METHODS.list, { rel });
    } else {
      clearTimeout(timeout);
      _pendingDirListRequests.delete(rel);
      resolve();
    }
  });
}

async function expandToPath(rel: string): Promise<void> {
  /**
   * Expands the tree to reveal a file or directory at the given relative path.
   * Walks through each path segment, expanding directories as needed.
   */
  if (!rel || rel === ".") return;
  if (!treeElement) {
    treeElement = document.getElementById("fe-file-tree");
  }
  if (!treeElement) return;

  const segments = rel.split("/").filter(Boolean);
  if (!segments.length) return;

  let currentRel = ".";

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const nextRel = currentRel === "." ? segment : `${currentRel}/${segment}`;
    const isLastSegment = i === segments.length - 1;

    // Find the node at nextRel
    let targetLi = treeElement.querySelector<HTMLLIElement>(
      `li.fe-tree-node[data-rel="${nextRel}"]`,
    );

    if (!targetLi) {
      // Node not in DOM - need to expand parent first
      const parentLi = treeElement.querySelector<HTMLLIElement>(
        `li.fe-tree-node[data-kind="dir"][data-rel="${currentRel}"]`,
      );

      if (parentLi && parentLi.dataset.open !== "true") {
        parentLi.dataset.open = "true";
        await _requestDirListAndWait(currentRel);
      } else if (!parentLi && currentRel === ".") {
        // Root should already be open, just wait a bit
        await _requestDirListAndWait(".");
      }

      // Try again after parent expanded
      targetLi = treeElement.querySelector<HTMLLIElement>(
        `li.fe-tree-node[data-rel="${nextRel}"]`,
      );

      if (!targetLi) {
        // Still not found - if this is the last segment, it might be a file
        // that just doesn't exist yet in DOM
        if (isLastSegment) return;
        // Otherwise can't proceed
        return;
      }
    }

    // If target is a directory and not the last segment, expand it
    if (targetLi.dataset.kind === "dir" && targetLi.dataset.open !== "true") {
      targetLi.dataset.open = "true";
      await _requestDirListAndWait(nextRel);
    }

    currentRel = nextRel;
  }
}

function getParentRel(rel: string): string {
  return getParentRelModule(rel);
}

async function expandToFile(fileRel: string): Promise<void> {
  /**
   * Expands the tree to reveal a file, expanding its parent directories.
   */
  if (!fileRel || fileRel === ".") return;
  const parentRel = getParentRel(fileRel);
  await expandToPath(parentRel);
}

function renderGitSummary() {
  explorerGitFooterUtils.renderGitSummary();
}

function setGitControlsEnabled(enabled: boolean, showInit = false): void {
  explorerGitFooterUtils.setGitControlsEnabled(enabled, showInit);
}

// --- Git Progress Bar ---
// Ephemeral progress bar at top of git footer + progress text in status row

function showGitProgressBar(pct: number, detail?: string): void {
  explorerGitFooterUtils.showGitProgressBar(pct, detail);
}

function hideGitProgressBar() {
  explorerGitFooterUtils.hideGitProgressBar();
}

function renderExplorerTree() {
  explorerRuntimeState.setRenderedProjectPath(
    explorerRuntimeState.getProjectPath() || null,
  );
  explorerTreeRenderer.renderExplorerTree();
}

function renderEntriesInto(
  containerUl: HTMLElement | null,
  entries: unknown,
  parentRel: string | null = null,
): void {
  explorerTreeRenderer.renderEntriesInto(containerUl, entries, parentRel);
}

function applyAggregatedGitStatusFlags() {
  explorerTreeDecorationsController.applyAggregatedGitStatusFlags();
}

function _setDiagnosticsSummary(next: unknown): void {
  explorerTreeDecorationsController.setDiagnosticsSummary(next);
}

function applyAggregatedDiagnosticFlags() {
  explorerTreeDecorationsController.applyAggregatedDiagnosticFlags();
}

function dispatchRemoteDraft(payload: JsonObject): void {
  try {
    if (payload && typeof window.__cm6ApplyRemoteDraft === "function") {
      window.__cm6ApplyRemoteDraft(payload);
    }
  } catch (err) {
    console.warn("[Explorer] draft:content handler failed", err);
  }
}

function dispatchAutosaveContent(payload: JsonObject): void {
  try {
    if (payload && typeof window.__cm6ApplyAutosaveContent === "function") {
      window.__cm6ApplyAutosaveContent(payload);
    }
  } catch (err) {
    console.warn("[Explorer] autosave:content handler failed", err);
  }
}

function dispatchPrefsChanged(payload: JsonObject): void {
  try {
    if (payload && typeof window.__cm6HandlePrefsChanged === "function") {
      window.__cm6HandlePrefsChanged(payload);
    } else {
      window.__cm6PendingPrefsChanged = payload;
    }
  } catch (err) {
    console.warn("[Explorer] prefs_changed handler failed", err);
  }
}

function dispatchProjectOpened(path: string, payload?: JsonObject): void {
  if (typeof window.__cm6HandleProjectOpened !== "function") {
    return;
  }
  try {
    window.__cm6HandleProjectOpened(path, payload);
  } catch (err) {
    console.warn(
      "[Explorer] Failed to synchronize editor on project:opened:",
      err,
    );
  }
}

function dispatchWatcherError(payload: JsonObject): void {
  try {
    if (typeof window.__cm6HandleWatcherError === "function") {
      window.__cm6HandleWatcherError(payload || {});
    } else {
      window.__cm6PendingWatcherError = payload || {};
    }
  } catch (err) {
    console.warn("[Explorer] watcher:error handler failed", err);
  }
}

function dispatchWatcherRaiseResult(payload: JsonObject): void {
  try {
    if (typeof window.__cm6HandleWatcherRaiseResult === "function") {
      window.__cm6HandleWatcherRaiseResult(payload || {});
    } else {
      window.__cm6PendingWatcherRaiseResult = payload || {};
    }
  } catch (err) {
    console.warn("[Explorer] watcher:raiseResult handler failed", err);
  }
}

function reloadCurrentFile() {
  if (typeof window.__cm6ReloadCurrentFile !== "function") {
    return;
  }
  try {
    window.__cm6ReloadCurrentFile();
  } catch (err) {
    console.warn("Failed to reload current file after restore:", err);
  }
}

function getButtonById(id: string): HTMLButtonElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLButtonElement ? element : null;
}

const explorerNotificationHandler = createExplorerNotificationHandler({
  runtimeState: explorerRuntimeState,
  getTreeElement: () => treeElement,
  setTreeElement: (next) => {
    treeElement = next;
  },
  getOpenDirectories: () => openDirectories,
  setOpenDirsInitialized: (next) => {
    openDirsInitialized = next;
  },
  getActiveFileRel: () => activeFileRel,
  setActiveFileRel,
  hasExplorerRpc: () => hasExplorerRpc(),
  notifyExplorer: (method, payload) => notifyExplorer(method, payload),
  renderProjectLabel: () => explorerChromeController.renderProjectLabel(),
  initDiffBaseFromBackend,
  renderExplorerTree,
  renderEntriesInto,
  basename,
  restoreOpenDirectories,
  notifyDirListComplete: _notifyDirListComplete,
  expandToFile,
  expandToPath,
  applyActiveFileMarker,
  setExplorerStickyHeadersEnabled: (next) =>
    explorerChromeController.setStickyHeadersEnabled(next),
  syncExplorerPrefsUI: () => explorerChromeController.syncExplorerPrefsUI(),
  applyExplorerStickyScopesPreference: () =>
    explorerChromeController.applyExplorerStickyScopesPreference(),
  treeDecorations: explorerTreeDecorationsController,
  getDiagnosticsPanel: () => getExplorerDiagnosticsPanel(),
  searchOverlayController: explorerSearchOverlayController,
  renderSearchOverlay,
  dispatchRemoteDraft,
  dispatchAutosaveContent,
  dispatchPrefsChanged,
  dispatchProjectOpened,
  dispatchWatcherError,
  dispatchWatcherRaiseResult,
  reloadCurrentFile,
  showGitProgressBar,
  hideGitProgressBar,
  toast,
  setGitControlsEnabled,
  renderGitSummary,
  setGitDiffBaseRef: (ref) => explorerDiffBaseController.setDiffBaseRef(ref),
  updateDiffBaseButtons,
  toggleDrawer: (open) => explorerChromeController.toggleDrawer(open),
});

const explorerRefreshController = createExplorerRefreshController({
  hasExplorerRpc: () => hasExplorerRpc(),
  notifyExplorer: (method, payload) => notifyExplorer(method, payload),
  getOpenDirectories: () => openDirectories,
  setReconnectResyncPending: (next) => {
    explorerRuntimeState.setReconnectResyncPending(next);
  },
});

export async function initExplorerUI(options: ExplorerUiInitOptions) {
  const drawer = document.getElementById("fe-drawer");
  const drawerBody =
    drawer?.querySelector<HTMLElement>(".fe-drawer-body") || null;
  const drawerClose = document.getElementById("fe-drawer-close");
  const drawerOpenBtn = document.getElementById("fe-drawer-open");
  const drawerBackdrop = document.getElementById("fe-drawer-backdrop");
  const explorerMenuBtn = document.getElementById("fe-explorer-menu-btn");
  const explorerMenuDropdown = document.getElementById("fe-explorer-menu-dd");
  const explorerMenuStickyHeadersItem = document.getElementById(
    "fe-mi-explorer-sticky-headers",
  );
  const explorerMenuScrollActiveItem = document.getElementById(
    "fe-mi-explorer-scroll-active",
  );
  const btnNewProject = document.getElementById("fe-new-project");
  const btnOpenProject = document.getElementById("fe-open-project");
  treeElement = document.getElementById("fe-file-tree");
  const projectLabel = document.getElementById("fe-project-label");
  gitSummaryEl = document.getElementById("fe-git-summary");
  const searchBtn = document.getElementById("fe-search-btn");
  const gitBaseBtn = document.getElementById("fe-git-base-btn");
  const gitBaseDropdown = document.getElementById("fe-git-base-dd");

  if (!draftUpdateListenerInstalled) {
    window.addEventListener("cm6:draft-updated", (event) => {
      const detail =
        event instanceof CustomEvent && isRecord(event.detail)
          ? event.detail
          : {};
      const rel = relFromAbsPath(
        typeof detail.path === "string" ? detail.path : null,
      );
      if (!rel || rel === ".") return;
      applyDraftFlag(rel, !!detail.unsaved);
    });
    draftUpdateListenerInstalled = true;
  }

  gitButtons = {
    init: getButtonById("fe-git-init"),
    stage: getButtonById("fe-git-stage"),
    unstage: getButtonById("fe-git-unstage"),
    commit: getButtonById("fe-git-commit"),
    push: getButtonById("fe-git-push"),
    pull: getButtonById("fe-git-pull"),
    reset: getButtonById("fe-git-reset"),
  };

  explorerChromeController.bindUi({
    drawerBody,
    drawerClose,
    drawerBackdrop,
    drawerOpenBtn,
    searchBtn,
    projectLabel,
    explorerMenuBtn,
    explorerMenuDropdown,
    explorerMenuStickyHeadersItem,
    explorerMenuScrollActiveItem,
    btnOpenProject,
    btnNewProject,
  });

  explorerDiffBaseController.bindGitBaseButton(
    gitBaseBtn instanceof HTMLButtonElement ? gitBaseBtn : null,
    gitBaseDropdown,
  );
  explorerDiffBaseController.bindGlobalCloseListener();
  explorerDiffBaseController.hydrateFromEditorState();
  updateDiffBaseButtons();
  void initDiffBaseFromBackend();

  explorerGitFooterUtils.bindGitFooterActions();
  document.addEventListener(
    "click",
    (ev) => {
      const target = ev.target;
      if (target instanceof Element && target.closest(".fe-card-menu")) return;
      if (target instanceof Element && target.closest(".fe-card-menu-btn")) {
        return;
      }
      explorerTreeMenuController.closeCardMenu();
    },
    false,
  );

  // Initialize explorer dropdown UI with any already-known prefs snapshot.
  explorerChromeController.syncExplorerPrefsUI();

  // Sticky scopes (Monaco-ish "docked folders") overlay for the explorer tree.
  // Uses geometry; does not change backend/SSOT behavior.
  explorerChromeController.setStickyScopesContext({
    treeElement,
    drawerBodyEl: drawerBody instanceof HTMLElement ? drawerBody : null,
    openCardMenuForEntry: (entry, anchorEl) => {
      if (!isExplorerTreeMenuEntry(entry)) {
        console.warn(
          "[Explorer] Invalid sticky-scope menu entry payload:",
          entry,
        );
        return;
      }
      explorerTreeMenuController.openCardMenuForEntry(entry, anchorEl);
    },
  });
  explorerChromeController.applyExplorerStickyScopesPreference();

  // Basic click handling: expand/collapse dirs, open files, open context menu
  if (treeElement) {
    treeElement.addEventListener("click", (ev) => {
      void explorerTreeClickHandler.handleTreeClick(ev);
    });
  }

  registerExplorerPublicApi({
    scrollToActiveFile,
    handleNotification: (method, payload) => {
      if (!isExplorerRpcNotificationMethod(method)) return;
      explorerNotificationHandler.handleExplorerNotification(method, payload);
    },
    handleReconnect: () => explorerRefreshController.handleReconnect(),
    refreshExplorer: () => explorerRefreshController.refreshExplorer(),
  });

  // Manual refresh button for "none" watcher mode
  const refreshBtn = document.getElementById("fe-watcher-refresh-btn");
  explorerRefreshController.bindManualRefreshButton(refreshBtn);

  // Initial render placeholders until first snapshot arrives
  explorerChromeController.renderProjectLabel();
  if (treeElement) {
    const empty = document.createElement("li");
    empty.className = "fe-tree-empty";
    empty.textContent = "Waiting for project snapshot…";
    treeElement.appendChild(empty);
  }

  explorerRpcRuntime = createExplorerRpcRuntime(options);
  await explorerRpcRuntime.connect();
  notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
}

// --- Unified file open + jump helper ---
async function openFileAndMaybeJump(
  rel: string,
  lineNumber: number | null | undefined = null,
  jumpOptions: ExplorerJumpOptions = {},
): Promise<void> {
  return explorerFileOpenBridge.openFileAndMaybeJump(
    rel,
    lineNumber,
    jumpOptions,
  );
}

// --- Search / Review overlay wiring ---

function openSearchOverlay(): void {
  explorerSearchOverlayController.openSearchOverlay();
}

async function fetchChangesResults(force = false): Promise<void> {
  return explorerSearchOverlayController.fetchChangesResults(force);
}

function renderSearchOverlay(): void {
  explorerSearchOverlayController.renderSearchOverlay();
}
