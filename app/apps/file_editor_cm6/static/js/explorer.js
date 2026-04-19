// app/apps/file_editor_cm6/static/js/explorer.js
// Explorer v2 – Socket.IO‑driven, backend‑owned state.
//
// Responsibilities:
// - Render the explorer tree/cards from backend snapshots (`explorer:setTree`).
// - Reflect git status and draft flags on entries.
// - Wire basic chrome (drawer open/close, project label, git summary, header actions).
// - Expose `initExplorerUI` and `window.__cm6RefreshExplorer` for host integration.
//
// All state that matters lives on the backend; this module treats incoming
// messages as the source of truth and only keeps enough transient state to draw.

import { showNewProjectModal } from './new_project_modal.js';
import { getIcon as getSetiIcon } from '/static/vendor/seti-icons/seti-icons.js';
import { initExplorerStickyScopes } from './explorer_extensions/sticky_scopes.js';
import { createExplorerSearchController } from './explorer_modules/explorer_search_controller.js';
import { createExplorerDirectoryStateHelpers } from './explorer_modules/explorer_directory_state_utils.js';
import { createExplorerUiHelpers } from './explorer_modules/explorer_ui_helpers.js';
import { createExplorerActiveFileUtils } from './explorer_modules/explorer_active_file_utils.js';
import {
  renderNameResults as renderNameResultsModule,
  renderContentResults as renderContentResultsModule,
} from './explorer_modules/explorer_search_results_renderer.js';
import { renderSearchOverlayBody } from './explorer_modules/explorer_search_overlay_body_renderer.js';
import {
  EXPLORER_RPC_METHODS,
  EXPLORER_RPC_NOTIFICATIONS,
} from '../../src/explorer/rpc/contract.ts';
import {
  formatDiffBaseLabel,
  formatHunkHeader,
  truncateText,
  firstDiffLine,
} from './explorer_modules/explorer_search_utils.js';
import {
  getParentRel as getParentRelModule,
  normalizeWatcherRel as normalizeWatcherRelModule,
  collectWatcherRels as collectWatcherRelsModule,
  isWatcherRelInOpenDir as isWatcherRelInOpenDirModule,
} from './explorer_modules/explorer_path_watcher_utils.js';
import { createExplorerGitFooterUtils } from './explorer_modules/explorer_git_footer_utils.js';
import { renderExplorerDiagnostics, getExplorerDiagnosticsPanel } from './explorer_modules/explorer_diagnostics_renderer.js';

let treeElement = null;
let projectLabelEl = null;
let gitSummaryEl = null;
let gitBaseBtn = null;
let gitBaseDropdown = null;
let gitButtons = null;

let explorerMenuBtn = null;
let explorerMenuDropdown = null;
let explorerMenuStickyHeadersItem = null;
let explorerMenuScrollActiveItem = null;

const UI_PREF_KEY_EXPLORER_STICKY_HEADERS = 'explorerStickyHeaders';
let explorerStickyHeadersEnabled = null; // boolean | null (unknown until prefs arrive)
const stickyScopesContext = {
  treeElement: null,
  drawerBodyEl: null,
  openCardMenuForEntry: null,
};

const uiState = {
  projectPath: null,
  gitStatus: null,
  reviewEntries: [],
};

let renderedProjectPath = null;
let draftUpdateListenerInstalled = false;

// Currently opened document (relative to project root), if known.
let activeFileRel = null;

function hasExplorerRpc() {
  return Boolean(window.__explorerRpc);
}

function notifyExplorer(method, payload = {}) {
  if (!window.__explorerRpc) return false;
  window.__explorerRpc.notify(method, payload);
  return true;
}

// Diagnostics summary (Sprint C): keep the last snapshot so newly-rendered
// nodes can receive flags even if the first broadcast raced before UI init.
let diagnosticsByRel = {};
let diagHasErrors = false;
let diagHasWarnings = false;
let diagErrorDirs = new Set();
let diagWarningDirs = new Set();

function setActiveFileRel(nextRel) {
  explorerActiveFileUtils.setActiveFileRel(nextRel);
}

function applyActiveFileMarker() {
  explorerActiveFileUtils.applyActiveFileMarker();
}

function relFromAbsPath(absPath) {
  return explorerActiveFileUtils.relFromAbsPath(absPath);
}

function applyDraftFlag(rel, hasDraft) {
  explorerActiveFileUtils.applyDraftFlag(rel, hasDraft);
}

async function scrollToActiveFile() {
  return explorerActiveFileUtils.scrollToActiveFile();
}

function setCheckableMenuItem(el, checked) {
  explorerUiHelpers.setCheckableMenuItem(el, checked);
}

function closeExplorerMenu() {
  explorerUiHelpers.closeExplorerMenu();
}

function syncExplorerPrefsUI() {
  explorerUiHelpers.syncExplorerPrefsUI();
}

function applyExplorerStickyScopesPreference() {
  const enabled = explorerStickyHeadersEnabled === true;
  const existing = window.__explorerStickyScopes;

  if (!enabled) {
    if (existing && typeof existing.destroy === 'function') {
      try {
        existing.destroy();
      } catch {
        // Ignore cleanup errors.
      }
    }
    window.__explorerStickyScopes = null;
    return;
  }

  const ctx = stickyScopesContext;
  if (
    !ctx.treeElement ||
    !ctx.drawerBodyEl ||
    typeof ctx.openCardMenuForEntry !== 'function'
  ) {
    return;
  }

  if (existing && typeof existing.update === 'function') {
    existing.update();
    return;
  }

  try {
    window.__explorerStickyScopes = initExplorerStickyScopes({
      treeElement: ctx.treeElement,
      drawerBodyEl: ctx.drawerBodyEl,
      openCardMenuForEntry: ctx.openCardMenuForEntry,
    });
  } catch (err) {
    console.warn('[Explorer] Sticky scopes init failed:', err);
    window.__explorerStickyScopes = null;
  }
}

// --- Seti-UI file icons (files only; dirs keep emoji) ---
function applySetiIconToSpan(span, fileName, kind = 'file') {
  if (!span) return;
  if (kind !== 'file') {
    // Ensure directories don't inherit prior SVG.
    span.innerHTML = '';
    span.style.color = '';
    return;
  }
  const name = fileName || '';
  if (!span.innerHTML && !span.textContent) {
    span.textContent = '📄';
  }
  getSetiIcon(name)
    .then((icon) => {
      if (!span.isConnected) return;
      if (icon && icon.svg) {
        span.innerHTML = icon.svg;
      }
      span.style.color = icon && icon.color ? icon.color : '';
    })
    .catch(() => {
      // Leave fallback (emoji / default) in place.
    });
}

// --- Batch Select Mode state ---
let selectModeDir = null;           // rel of directory in select mode, or null
const selectedEntries = new Set();  // rel paths of checked items

// --- Open Directories Persistence ---
const openDirectories = new Set();  // rel paths of currently open directories
let openDirsSyncTimer = null;
const OPEN_DIRS_SYNC_DEBOUNCE = 500;  // ms
let openDirsInitialized = false;  // True after we've received initial open dirs from backend

// --- Search / Review overlay state ---
let searchOverlayVisible = false;
let searchMode = 'name'; // 'name' | 'content' | 'changes' | 'review' | 'diagnostics'
let searchQuery = '';
let searchResults = null;
let searchLoading = false;
let searchError = null;
let searchDebounceTimer = null;
let lastKnownProjectPath = '';
let _explorerDiagDetail = {}; // { absPath: markers[] } — latest diagnostics:detail snapshot
const selectedReviewFiles = new Set();
const explorerSearchController = createExplorerSearchController({
  toast,
  renderSearchOverlay,
  focusSearchInput: () => {
    const input = document.getElementById('fe-search-input');
    if (input) input.focus();
  },
  hasBus: () => hasExplorerRpc(),
  sendBus: (method, payload) => notifyExplorer(method, payload),
  getProjectPath: () => uiState.projectPath || '',
  getSearchOverlayVisible: () => searchOverlayVisible,
  setSearchOverlayVisible: (next) => { searchOverlayVisible = !!next; },
  getSearchMode: () => searchMode,
  setSearchModeValue: (next) => { searchMode = next; },
  getSearchQuery: () => searchQuery,
  setSearchQuery: (next) => { searchQuery = next; },
  getSearchResults: () => searchResults,
  setSearchResults: (next) => { searchResults = next; },
  getSearchLoading: () => searchLoading,
  setSearchLoading: (next) => { searchLoading = !!next; },
  getSearchError: () => searchError,
  setSearchError: (next) => { searchError = next; },
  getSearchDebounceTimer: () => searchDebounceTimer,
  setSearchDebounceTimer: (next) => { searchDebounceTimer = next; },
  setLastKnownProjectPath: (next) => { lastKnownProjectPath = next || ''; },
});
const explorerDirectoryStateHelpers = createExplorerDirectoryStateHelpers({
  getTreeElement: () => treeElement,
  getSelectModeDir: () => selectModeDir,
  setSelectModeDir: (next) => { selectModeDir = next; },
  clearSelectedEntries: () => selectedEntries.clear(),
  hasExplorerBus: () => hasExplorerRpc(),
  sendExplorerBus: (method, payload) => notifyExplorer(method, payload),
  getOpenDirectories: () => openDirectories,
  getOpenDirsInitialized: () => openDirsInitialized,
  getOpenDirsSyncTimer: () => openDirsSyncTimer,
  setOpenDirsSyncTimer: (next) => { openDirsSyncTimer = next; },
  getOpenDirsSyncDebounce: () => OPEN_DIRS_SYNC_DEBOUNCE,
});
const explorerUiHelpers = createExplorerUiHelpers({
  getExplorerMenuDropdown: () => explorerMenuDropdown,
  getExplorerStickyHeadersEnabled: () => explorerStickyHeadersEnabled,
  getExplorerMenuStickyHeadersItem: () => explorerMenuStickyHeadersItem,
});
const explorerActiveFileUtils = createExplorerActiveFileUtils({
  getTreeElement: () => treeElement,
  setTreeElement: (next) => { treeElement = next; },
  getActiveFileRel: () => activeFileRel,
  setActiveFileRelValue: (next) => { activeFileRel = next; },
  getProjectPath: () => uiState.projectPath,
  expandToFile,
  toast,
});
const explorerGitFooterUtils = createExplorerGitFooterUtils({
  getGitSummaryElement: () => gitSummaryEl,
  getGitStatus: () => uiState.gitStatus,
  getGitButtons: () => gitButtons,
  hasExplorerBus: () => hasExplorerRpc(),
  sendExplorerBus: (method, payload) => notifyExplorer(method, payload),
  toast,
  reloadCurrentFile: () => window.__cm6ReloadCurrentFile?.(),
});

let reconnectResyncPending = false;

// Minimal diff-base shell for changes note (no dropdown wiring yet)
let gitDiffBase = { ref: 'HEAD', mode: 'none', commit: null };
let searchBaseBtn = null;
let searchBaseDropdown = null;


function updateDiffBaseButtons() {
  if (gitBaseBtn) {
    gitBaseBtn.textContent = `${formatDiffBaseLabel(gitDiffBase, true)} ▾`;
    gitBaseBtn.disabled = gitDiffBase.mode === 'none';
  }
  if (searchBaseBtn) {
    searchBaseBtn.textContent = `${formatDiffBaseLabel(gitDiffBase, false)} ▾`;
    searchBaseBtn.disabled = gitDiffBase.mode === 'none';
  }
}

async function initDiffBaseFromBackend() {
  try {
    const resp = await fetch('/api/app/file_editor_cm6/git/diff_base', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await resp.json().catch(() => null);
    const data = json && json.data;
    if (!data) return;
    gitDiffBase = {
      ref: data.ref || 'HEAD',
      mode: data.mode || 'none',
      commit: data.commit || null,
    };
    updateDiffBaseButtons();
    // If we have a project and diff base says "no git", show only Init.
    try {
      const state = window.__cm6EditorState || null;
      const projectExists =
        !!(state && state.activeProject && state.activeProjectExists);
      if (!projectExists) {
        setGitControlsEnabled(false, false);
      } else if (gitDiffBase.mode === 'none') {
        // Non-git project: only "Initialize Git" should be visible.
        setGitControlsEnabled(true, true);
      }
    } catch {
      // Non-fatal; controls will be updated on git:status if/when it arrives.
    }
  } catch (err) {
    console.warn('Failed to initialize diff base from backend:', err);
  }
}

function closeDiffBaseMenus(except) {
  const dropdowns = document.querySelectorAll(
    '#fe-search-base-dd, #fe-git-base-dd',
  );
  dropdowns.forEach((dd) => {
    if (!dd) return;
    if (dd !== except) {
      dd.classList.remove('show');
    }
  });
}

async function changeDiffBase(ref) {
  if (!ref || typeof window.__explorerBusSend !== 'function') return;
  try {
    // Persist diff base via WS (HistoryStore is the SSOT), then refresh changes.
    notifyExplorer(EXPLORER_RPC_METHODS.gitDiffBaseSet, { ref });
    if (searchMode === 'changes') {
      fetchChangesResults(true);
    }
    if (typeof window.__cm6ReloadCurrentFile === 'function') {
      window.__cm6ReloadCurrentFile();
    }
  } catch (err) {
    toast(err?.message || 'Failed to update diff base');
  }
}

function renderDiffBaseDropdown(dropdown, commits) {
  dropdown.innerHTML = '';
  const mode = gitDiffBase.mode;
  if (mode === 'none') {
    const empty = document.createElement('div');
    empty.className = 'fe-dd-item';
    empty.style.opacity = '0.65';
    empty.textContent = 'Not a git repository';
    dropdown.appendChild(empty);
    return;
  }

  const options = [];
  options.push({
    ref: 'HEAD',
    short: 'HEAD',
    summary: 'Working tree',
  });
  (commits || []).forEach((c) => {
    options.push({
      ref: c.hash,
      short: c.short_hash,
      summary: c.summary,
    });
  });

  const currentHash = gitDiffBase.commit && gitDiffBase.commit.hash;
  const currentRef = gitDiffBase.ref || 'HEAD';
  const hasCurrent = options.some(
    (opt) => opt.ref === currentHash || opt.ref === currentRef,
  );
  if (!hasCurrent && gitDiffBase.commit) {
    options.unshift({
      ref: gitDiffBase.commit.hash,
      short: gitDiffBase.commit.short,
      summary: gitDiffBase.commit.subject,
    });
  }

  options.forEach((opt) => {
    const item = document.createElement('div');
    item.className = 'fe-dd-item';
    const isCurrent =
      (opt.ref === 'HEAD' && currentRef === 'HEAD') ||
      (opt.ref !== 'HEAD' &&
        (opt.ref === currentRef || opt.ref === currentHash));
    if (isCurrent) {
      item.classList.add('fe-menu-item-checked');
    }
    item.textContent = `${opt.short || opt.ref} · ${truncateText(
      opt.summary || '',
      40,
    )}`;
    item.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeDiffBaseMenus();
      if (!isCurrent) {
        changeDiffBase(opt.ref);
      }
    });
    dropdown.appendChild(item);
  });
}

async function toggleDiffBaseMenu(button, dropdown) {
  if (!button || !dropdown || button.disabled) return;
  const isOpen = dropdown.classList.contains('show');
  closeDiffBaseMenus(dropdown);
  if (isOpen) {
    dropdown.classList.remove('show');
    return;
  }
  dropdown.innerHTML =
    '<div class=\"fe-dd-item\" style=\"opacity:0.6\">Loading…</div>';
  dropdown.classList.add('show');
  if (gitDiffBase.mode === 'none') {
    renderDiffBaseDropdown(dropdown, []);
    return;
  }
  try {
    const resp = await fetch('/api/app/file_editor_cm6/git/commits', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await resp.json().catch(() => null);
    if (!json || json.ok === false) {
      throw new Error(json?.error || resp.statusText || 'Failed to load commits');
    }
    const commits = json.data || [];
    renderDiffBaseDropdown(dropdown, commits);
  } catch (err) {
    dropdown.innerHTML = `<div class=\"fe-dd-item\" style=\"opacity:0.7\">${err?.message || 'Failed to load commits'}</div>`;
  }
}

// Search by Changes – raw data cache for client-side filtering
let lastChangesData = null;
let lastChangesContainer = null;

function clearElement(el) {
  explorerUiHelpers.clearElement(el);
}

function basename(path) {
  return explorerUiHelpers.basename(path);
}

function toast(message) {
  explorerUiHelpers.toast(message);
}

function isMobileLayout() {
  return explorerUiHelpers.isMobileLayout();
}

function closeDrawerIfMobile() {
  explorerUiHelpers.closeDrawerIfMobile();
}

// --- Batch Select Mode helpers ---

function isInSelectMode(parentRel) {
  return explorerDirectoryStateHelpers.isInSelectMode(parentRel);
}

function enableSelectMode(dirRel) {
  explorerDirectoryStateHelpers.enableSelectMode(dirRel);
}

function disableSelectMode() {
  explorerDirectoryStateHelpers.disableSelectMode();
}

function collapseSubdirsOf(parentRel) {
  explorerDirectoryStateHelpers.collapseSubdirsOf(parentRel);
}

function checkAutoDisableSelectMode(collapsedRel) {
  explorerDirectoryStateHelpers.checkAutoDisableSelectMode(collapsedRel);
}

// --- Open Directories Persistence ---

function markDirectoryOpen(rel, isOpen) {
  explorerDirectoryStateHelpers.markDirectoryOpen(rel, isOpen);
}

function scheduleOpenDirsSync() {
  explorerDirectoryStateHelpers.scheduleOpenDirsSync();
}

function syncOpenDirsToBackend() {
  explorerDirectoryStateHelpers.syncOpenDirsToBackend();
}

async function restoreOpenDirectories(dirs) {
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

async function expandDirectoryIfExists(rel) {
  /**
   * Expand a single directory if it exists in the tree.
   * Unlike expandToPath, this only expands the target directory itself,
   * assuming parent directories are already open.
   */
  if (!treeElement) {
    treeElement = document.getElementById('fe-file-tree');
  }
  if (!treeElement || !rel) return;
  
  // First, expand any parent directories needed
  const parts = rel.split('/').filter(Boolean);
  let currentRel = '.';
  
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    const nextRel = currentRel === '.' ? segment : `${currentRel}/${segment}`;
    
    let targetLi = treeElement.querySelector(
      `li.fe-tree-node[data-kind="dir"][data-rel="${nextRel}"]`
    );
    
    if (!targetLi) {
      // Node not in DOM - need to request parent listing first
      const parentLi = treeElement.querySelector(
        `li.fe-tree-node[data-kind="dir"][data-rel="${currentRel}"]`
      );
      
      if (parentLi && parentLi.dataset.open !== 'true') {
        parentLi.dataset.open = 'true';
        openDirectories.add(currentRel === '.' ? '' : currentRel);
        await _requestDirListAndWait(currentRel);
      }
      
      // Try again after parent expanded
      targetLi = treeElement.querySelector(
        `li.fe-tree-node[data-kind="dir"][data-rel="${nextRel}"]`
      );
      
      if (!targetLi) {
        // Directory doesn't exist - stop here
        throw new Error(`Directory not found: ${nextRel}`);
      }
    }
    
    // Expand this directory if not already open
    if (targetLi.dataset.open !== 'true') {
      targetLi.dataset.open = 'true';
      openDirectories.add(nextRel);
      await _requestDirListAndWait(nextRel);
    }
    
    currentRel = nextRel;
  }
}

// --- Expand to file/directory ---

// Pending directory list requests - maps rel -> { resolve, reject, timeout }
const _pendingDirListRequests = new Map();

function _notifyDirListComplete(rel) {
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

async function _requestDirListAndWait(rel, timeoutMs = 2000) {
  /**
   * Requests a directory listing and waits for the response.
   * Returns a promise that resolves when the listing is received.
   */
  return new Promise((resolve, reject) => {
    // Set up timeout
    const timeout = setTimeout(() => {
      _pendingDirListRequests.delete(rel);
      resolve(); // Resolve anyway to continue, don't block forever
    }, timeoutMs);
    
    _pendingDirListRequests.set(rel, { resolve, reject, timeout });
    
    // Send request
    if (typeof window.__explorerBusSend === 'function') {
      notifyExplorer(EXPLORER_RPC_METHODS.list, { rel });
    } else {
      clearTimeout(timeout);
      _pendingDirListRequests.delete(rel);
      resolve();
    }
  });
}

async function expandToPath(rel) {
  /**
   * Expands the tree to reveal a file or directory at the given relative path.
   * Walks through each path segment, expanding directories as needed.
   */
  if (!rel || rel === '.') return;
  if (!treeElement) {
    treeElement = document.getElementById('fe-file-tree');
  }
  if (!treeElement) return;

  const segments = rel.split('/').filter(Boolean);
  if (!segments.length) return;

  let currentRel = '.';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const nextRel = currentRel === '.' ? segment : `${currentRel}/${segment}`;
    const isLastSegment = i === segments.length - 1;

    // Find the node at nextRel
    let targetLi = treeElement.querySelector(
      `li.fe-tree-node[data-rel="${nextRel}"]`
    );

    if (!targetLi) {
      // Node not in DOM - need to expand parent first
      const parentLi = treeElement.querySelector(
        `li.fe-tree-node[data-kind="dir"][data-rel="${currentRel}"]`
      );
      
      if (parentLi && parentLi.dataset.open !== 'true') {
        parentLi.dataset.open = 'true';
        await _requestDirListAndWait(currentRel);
      } else if (!parentLi && currentRel === '.') {
        // Root should already be open, just wait a bit
        await _requestDirListAndWait('.');
      }
      
      // Try again after parent expanded
      targetLi = treeElement.querySelector(
        `li.fe-tree-node[data-rel="${nextRel}"]`
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
    if (targetLi.dataset.kind === 'dir' && targetLi.dataset.open !== 'true') {
      targetLi.dataset.open = 'true';
      await _requestDirListAndWait(nextRel);
    }

    currentRel = nextRel;
  }
}

function getParentRel(rel) {
  return getParentRelModule(rel);
}

async function expandToFile(fileRel) {
  /**
   * Expands the tree to reveal a file, expanding its parent directories.
   */
  if (!fileRel || fileRel === '.') return;
  const parentRel = getParentRel(fileRel);
  await expandToPath(parentRel);
}

function renderProjectLabel() {
  if (!projectLabelEl) return;
  const root = uiState.projectPath;
  if (!root) {
    projectLabelEl.textContent = '(none)';
    projectLabelEl.title = '';
    projectLabelEl.classList.remove('fe-label-missing');
    return;
  }
  const name = basename(root);
  projectLabelEl.textContent = name;
  projectLabelEl.title = root;
  projectLabelEl.classList.remove('fe-label-missing');
}

function renderGitSummary() {
  explorerGitFooterUtils.renderGitSummary();
}

function setGitControlsEnabled(enabled, showInit = false) {
  explorerGitFooterUtils.setGitControlsEnabled(enabled, showInit);
}

// --- Git Progress Bar ---
// Ephemeral progress bar at top of git footer + progress text in status row

function showGitProgressBar(pct, detail) {
  explorerGitFooterUtils.showGitProgressBar(pct, detail);
}

function hideGitProgressBar() {
  explorerGitFooterUtils.hideGitProgressBar();
}

function renderExplorerTree() {
  if (!treeElement) {
    treeElement = document.getElementById('fe-file-tree');
  }
  const el = treeElement;
  if (!el) return;

  renderedProjectPath = uiState.projectPath || null;
  clearElement(el);

  const rootLi = document.createElement('li');
  rootLi.className = 'fe-tree-node fe-tree-root';
  rootLi.dataset.kind = 'dir';
  rootLi.dataset.rel = '.';
  rootLi.dataset.open = 'true';

  const icon = document.createElement('span');
  icon.className = 'fe-entry-icon fe-entry-icon-dir';

  const text = document.createElement('span');
  text.className = 'fe-tree-text';
  const baseName = basename(uiState.projectPath || '') || 'Project';
  text.textContent = baseName;

  const menuBtn = document.createElement('button');
  menuBtn.className = 'fe-card-menu-btn';
  menuBtn.textContent = '⋮';

  const childList = document.createElement('ul');
  childList.className = 'fe-tree';

  rootLi.appendChild(icon);
  rootLi.appendChild(text);
  rootLi.appendChild(menuBtn);
  rootLi.appendChild(childList);
  el.appendChild(rootLi);
}

function renderEntriesInto(containerUl, entries, parentRel = null) {
  if (!containerUl) return;
  
  // Determine parent rel from container if not provided
  if (parentRel === null) {
    const parentLi = containerUl.closest('li.fe-tree-node[data-kind="dir"]');
    parentRel = parentLi?.dataset?.rel || '.';
  }

  const inSelectMode = isInSelectMode(parentRel);
  
  // Toggle select mode class on the container
  containerUl.classList.toggle('fe-tree-select-mode', inSelectMode);

  const list = Array.isArray(entries) ? entries : [];
  const newRels = new Set(list.map(e => e.rel || e.path));
  
  // 1. Index existing children by rel
  const existingNodes = new Map();
  Array.from(containerUl.children).forEach(li => {
    if (li.dataset.rel) {
      existingNodes.set(li.dataset.rel, li);
    }
  });

  // 2. Remove nodes that are no longer in the list
  existingNodes.forEach((li, rel) => {
    if (!newRels.has(rel)) {
      li.remove();
    }
  });

  // 3. Create or update nodes
  list.forEach((entry, index) => {
    const rel = entry.rel || entry.path || '';
    let li = existingNodes.get(rel);
    const isNew = !li;

    if (isNew) {
      li = document.createElement('li');
      li.className = 'fe-tree-node';
      li.dataset.rel = rel;
      // Insert at correct position
      if (index < containerUl.children.length) {
        containerUl.insertBefore(li, containerUl.children[index]);
      } else {
        containerUl.appendChild(li);
      }
    } else {
      // Ensure order: if current node at index isn't this one, move it
      const currentNodeAtIndex = containerUl.children[index];
      if (currentNodeAtIndex !== li) {
        containerUl.insertBefore(li, currentNodeAtIndex);
      }
    }

    // Update attributes (always)
    li.dataset.kind = entry.kind || 'file';
    li.dataset.name = entry.name || '';


    // Update Git Status
    if (entry.gitStatus) {
      li.dataset.gitStatus = entry.gitStatus;
    } else {
      delete li.dataset.gitStatus;
    }
    
    // Update Git Flags (for directories)
    const flags = entry.gitFlags || [];
    if (flags.length > 0) {
      li.dataset.gitFlags = flags.join(',');
    } else {
      delete li.dataset.gitFlags;
    }

    // Update Draft Status
    if (entry.hasDraft) {
      li.dataset.hasDraft = '1';
    } else {
      delete li.dataset.hasDraft;
    }

    // Re-apply classes based on new data
    // First, strip all dynamic classes to ensure clean state
    const classesToRemove = [];
    li.classList.forEach(cls => {
      if (cls.startsWith('fe-git-') || 
          cls.startsWith('fe-dir-has-') || 
          cls === 'fe-draft') {
        classesToRemove.push(cls);
      }
    });
    classesToRemove.forEach(c => li.classList.remove(c));

    // Re-add classes
    if (li.dataset.gitStatus) {
      li.classList.add(`fe-git-${li.dataset.gitStatus}`);
    }
    if (li.dataset.gitFlags) {
      li.dataset.gitFlags.split(',').forEach(f => {
        if (f) li.classList.add(`fe-dir-has-${f}`);
      });
    }
    if (li.dataset.hasDraft === '1') {
      if (entry.kind === 'file') {
        li.classList.add('fe-draft');
      } else {
        li.classList.add('fe-dir-has-draft');
      }
    }

    // Render/Update Content
    // We only rebuild the inner content if it's a new node OR if we need to toggle select mode UI
    // For existing nodes, we generally leave the structure alone to preserve the <ul> for children.
    
    // Check if we need to rebuild the "header" part (icon + text + menu/checkbox)
    // We can identify the header elements easily.
    
    let iconSpan = li.querySelector('.fe-entry-icon');
    let textSpan = li.querySelector('.fe-tree-text');
    let menuButton = li.querySelector('.fe-card-menu-btn');
    let checkbox = li.querySelector('.fe-entry-checkbox');

    // If mode changed (select vs normal), we might need to swap checkbox/menu
    const hasCheckbox = !!checkbox;
    const needsCheckbox = inSelectMode;
    
    if (isNew || hasCheckbox !== needsCheckbox) {
      // Rebuild header elements, but PRESERVE any existing <ul> (children)
      const childUl = li.querySelector('ul.fe-tree');
      
      // Clear everything except the UL
      Array.from(li.childNodes).forEach(node => {
        if (node !== childUl) node.remove();
      });

      // Re-create header
      if (inSelectMode) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'fe-entry-checkbox';
        checkbox.dataset.rel = rel;
        checkbox.checked = selectedEntries.has(rel);
        checkbox.addEventListener('change', (ev) => {
          ev.stopPropagation();
          if (ev.target.checked) {
            selectedEntries.add(rel);
          } else {
            selectedEntries.delete(rel);
          }
        });
        li.insertBefore(checkbox, childUl); // Insert before UL
      }

      iconSpan = document.createElement('span');
      iconSpan.className = `fe-entry-icon fe-entry-icon-${entry.kind || 'file'}`;
      li.insertBefore(iconSpan, childUl);
      applySetiIconToSpan(iconSpan, entry.name || '', entry.kind || 'file');

      textSpan = document.createElement('span');
      textSpan.className = 'fe-tree-text';
      textSpan.textContent = entry.name || '';
      li.insertBefore(textSpan, childUl);

      if (!inSelectMode) {
        menuButton = document.createElement('button');
        menuButton.className = 'fe-card-menu-btn';
        menuButton.textContent = '⋮';
        li.insertBefore(menuButton, childUl);
      }
    } else {
      // Just update existing header elements
      if (iconSpan) {
        iconSpan.className = `fe-entry-icon fe-entry-icon-${entry.kind || 'file'}`;
        applySetiIconToSpan(iconSpan, entry.name || '', entry.kind || 'file');
      }
      if (textSpan) textSpan.textContent = entry.name || '';
      if (checkbox) {
        checkbox.dataset.rel = rel;
        checkbox.checked = selectedEntries.has(rel);
      }
    }
  });

  // After entries are rendered, recompute aggregated git-status flags
  // (fe-dir-has-*) so parent directories can visually reflect dirty
  // descendants independently of the single gitStatus value.
  applyAggregatedGitStatusFlags();
  applyAggregatedDiagnosticFlags();
}

function applyAggregatedGitStatusFlags() {
  if (!treeElement) {
    treeElement = document.getElementById('fe-file-tree');
  }
  const root = treeElement;
  if (!root) return;

  // Clear previous aggregated flags on all directories (except those from gitFlags).
  // We'll re-apply them below.
  root
    .querySelectorAll('li.fe-tree-node[data-kind="dir"]')
    .forEach((li) => {
      li.classList.remove(
        'fe-dir-has-modified',
        'fe-dir-has-staged',
        'fe-dir-has-untracked',
        'fe-dir-has-conflict',
      );
      // Only clear fe-dir-has-draft if NOT set by backend (data-hasDraft).
      // Backend computes hasDraft via prefix matching, so collapsed dirs
      // retain their draft status even when children aren't in the DOM.
      if (!li.dataset.hasDraft) {
        li.classList.remove('fe-dir-has-draft');
      }
    });

  // For each node (file OR directory) with a gitStatus or gitFlags, walk up
  // its directory ancestors in the DOM and attach aggregated flags.
  // This handles:
  // 1. Files with gitStatus -> propagate that status up
  // 2. Directories with gitFlags -> propagate ALL flags up (handles collapsed dirs)
  const nodesWithStatus = root.querySelectorAll(
    'li.fe-tree-node[data-git-status], li.fe-tree-node[data-git-flags]',
  );
  
  nodesWithStatus.forEach((node) => {
    // Collect all statuses to propagate: from gitStatus and gitFlags
    const statusesToPropagate = new Set();
    
    const status = node.dataset.gitStatus || '';
    if (status && status !== 'clean') {
      statusesToPropagate.add(status);
    }
    
    // For directories, also include all gitFlags (these represent descendant statuses)
    const flagsStr = node.dataset.gitFlags || '';
    if (flagsStr) {
      flagsStr.split(',').forEach((f) => {
        if (f) statusesToPropagate.add(f);
      });
    }
    
    if (statusesToPropagate.size === 0) return;
    
    // Start from the node's parent (for files) or the node itself (for dirs)
    let current = node.dataset.kind === 'dir' ? node : node.parentElement?.closest('li.fe-tree-node[data-kind="dir"]');
    
    while (current) {
      statusesToPropagate.forEach((s) => {
        // Map statuses to aggregated flag classes
        if (s === 'modified' || s === 'staged_modified' || s === 'deleted' || s === 'renamed') {
          current.classList.add('fe-dir-has-modified');
        }
        if (s === 'untracked') {
          current.classList.add('fe-dir-has-untracked');
        }
        if (s === 'staged' || s === 'staged_modified' || s === 'added') {
          current.classList.add('fe-dir-has-staged');
        }
        if (s === 'conflict') {
          current.classList.add('fe-dir-has-conflict');
        }
      });
      
      current = current.parentElement?.closest('li.fe-tree-node[data-kind="dir"]');
    }
  });

  // Propagate draft status up to parent directories
  // Walk up from both files with drafts AND directories that contain drafts
  const nodesWithDraft = root.querySelectorAll('li.fe-tree-node.fe-draft, li.fe-tree-node.fe-dir-has-draft');
  nodesWithDraft.forEach((node) => {
    let current = node.parentElement?.closest('li.fe-tree-node[data-kind="dir"]');
    while (current) {
      current.classList.add('fe-dir-has-draft');
      current = current.parentElement?.closest('li.fe-tree-node[data-kind="dir"]');
    }
  });
}

function _setDiagnosticsSummary(next) {
  const obj = next && typeof next === 'object' ? next : {};
  diagnosticsByRel = obj;
  diagHasErrors = false;
  diagHasWarnings = false;
  diagErrorDirs = new Set();
  diagWarningDirs = new Set();

  Object.entries(obj).forEach(([rel, counts]) => {
    if (!counts) return;
    const errors = Number(counts.errors || 0);
    const warnings = Number(counts.warnings || 0);
    if (errors <= 0 && warnings <= 0) return;
    if (errors > 0) diagHasErrors = true;
    if (warnings > 0) diagHasWarnings = true;

    const parts = String(rel || '').split('/');
    for (let i = 1; i < parts.length; i++) {
      const dirRel = parts.slice(0, i).join('/');
      if (errors > 0) diagErrorDirs.add(dirRel);
      if (warnings > 0) diagWarningDirs.add(dirRel);
    }
  });
}

function _queryNodeByRel(root, kind, rel) {
  if (!root || !rel) return null;
  try {
    const esc = window.CSS && CSS.escape ? CSS.escape(rel) : null;
    if (esc) {
      return root.querySelector(`li.fe-tree-node[data-kind="${kind}"][data-rel="${esc}"]`);
    }
  } catch {
    // fall back to scan
  }
  const nodes = root.querySelectorAll(`li.fe-tree-node[data-kind="${kind}"]`);
  for (const li of nodes) {
    if ((li.dataset.rel || '') === rel) return li;
  }
  return null;
}

function applyAggregatedDiagnosticFlags() {
  if (!treeElement) {
    treeElement = document.getElementById('fe-file-tree');
  }
  const root = treeElement;
  if (!root) return;

  // Clear previous diagnostic classes
  root.querySelectorAll('li.fe-tree-node').forEach((li) => {
    li.classList.remove(
      'fe-diag-error',
      'fe-diag-warning',
      'fe-dir-has-diag-error',
      'fe-dir-has-diag-warning',
    );
    delete li.dataset.diagErrors;
    delete li.dataset.diagWarnings;
  });

  // Apply file-level flags for nodes currently in the DOM
  try {
    Object.entries(diagnosticsByRel || {}).forEach(([rel, counts]) => {
      if (!counts) return;
      const errors = Number(counts.errors || 0);
      const warnings = Number(counts.warnings || 0);
      if (errors <= 0 && warnings <= 0) return;

      const li = _queryNodeByRel(root, 'file', rel);
      if (!li) return;
      if (errors > 0) {
        li.classList.add('fe-diag-error');
        li.dataset.diagErrors = String(errors);
      }
      if (warnings > 0) {
        li.classList.add('fe-diag-warning');
        li.dataset.diagWarnings = String(warnings);
      }
    });
  } catch {
    // ignore
  }

  // Apply directory inheritance flags for dirs currently in the DOM
  const allDirRels = new Set([...diagErrorDirs, ...diagWarningDirs]);
  allDirRels.forEach((dirRel) => {
    const li = _queryNodeByRel(root, 'dir', dirRel);
    if (!li) return;
    if (diagErrorDirs.has(dirRel)) li.classList.add('fe-dir-has-diag-error');
    if (diagWarningDirs.has(dirRel)) li.classList.add('fe-dir-has-diag-warning');
  });

  // Root always exists; mark if anything in the project has diagnostics.
  const rootLi = root.querySelector('li.fe-tree-node.fe-tree-root');
  if (rootLi) {
    if (diagHasErrors) rootLi.classList.add('fe-dir-has-diag-error');
    if (diagHasWarnings) rootLi.classList.add('fe-dir-has-diag-warning');
  }

  // Render an inline marker INSIDE the filename span.
  // If inserted as a sibling, the grid layout (icon | text | menu) pushes it into the right column.
  root.querySelectorAll('li.fe-tree-node').forEach((li) => {
    const textSpan = li.querySelector('.fe-tree-text');
    if (!textSpan) return;

    let mark = textSpan.querySelector('.fe-diag-mark');
    if (!mark) {
      mark = document.createElement('span');
      mark.className = 'fe-diag-mark';
      textSpan.appendChild(mark);
    }

    if (li.classList.contains('fe-diag-error') || li.classList.contains('fe-dir-has-diag-error')) {
      mark.textContent = ' 🔴';
    } else if (
      li.classList.contains('fe-diag-warning') ||
      li.classList.contains('fe-dir-has-diag-warning')
    ) {
      mark.textContent = ' 🟡';
    } else {
      mark.textContent = '';
    }
  });
}

function refreshOpenDirectoriesAfterGit() {
  if (!treeElement) {
    treeElement = document.getElementById('fe-file-tree');
  }
  if (!treeElement) return;
  if (typeof window.__explorerBusSend !== 'function') return;

  const openDirs = treeElement.querySelectorAll(
    'li.fe-tree-node[data-kind="dir"][data-open="true"]',
  );
  openDirs.forEach((li) => {
    const rel = li.dataset.rel || '.';
    // Root (.) is already refreshed via broadcast explorer:setList.
    if (!rel || rel === '.') return;
    notifyExplorer(EXPLORER_RPC_METHODS.list, { rel });
  });
  // After any git change + refreshed listings, recompute aggregated flags
  applyAggregatedGitStatusFlags();
}

function _normalizeWatcherRel(rel) {
  return normalizeWatcherRelModule(rel);
}

function _collectWatcherRels(payload) {
  return collectWatcherRelsModule(payload);
}

function _isWatcherRelInOpenDir(rel, openDir) {
  return isWatcherRelInOpenDirModule(rel, openDir);
}

function handleExplorerNotification(method, payload) {
  if (method === EXPLORER_RPC_NOTIFICATIONS.watcherError) {
    try {
      if (typeof window.__cm6HandleWatcherError === 'function') {
        window.__cm6HandleWatcherError(payload || {});
      } else {
        window.__cm6PendingWatcherError = payload || {};
      }
    } catch (err) {
      console.warn('[Explorer] watcher:error handler failed', err);
    }
    return;
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.watcherLimitRaiseResult) {
    try {
      if (typeof window.__cm6HandleWatcherRaiseResult === 'function') {
        window.__cm6HandleWatcherRaiseResult(payload || {});
      } else {
        window.__cm6PendingWatcherRaiseResult = payload || {};
      }
    } catch (err) {
      console.warn('[Explorer] watcher:raiseResult handler failed', err);
    }
    return;
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.watcherFiles) {
    try {
      if (!hasExplorerRpc()) return;

      // Required: every watcher event triggers git status refresh.
      notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});

      const rels = _collectWatcherRels(payload);
      if (!rels.size) return;

      const dirsToRefresh = new Set();
      let refreshRoot = false;
      rels.forEach((rel) => {
        if (rel === '.') {
          refreshRoot = true;
        } else if (rel.indexOf('/') === -1) {
          refreshRoot = true;
        }

        openDirectories.forEach((openDir) => {
          if (_isWatcherRelInOpenDir(rel, openDir)) {
            dirsToRefresh.add(openDir);
          }
        });
      });

      if (refreshRoot) {
        notifyExplorer(EXPLORER_RPC_METHODS.list, { rel: '.' });
      }
      dirsToRefresh.forEach((rel) => {
        if (!rel || rel === '.') return;
        notifyExplorer(EXPLORER_RPC_METHODS.list, { rel });
      });

      if (activeFileRel) {
        const touchedActive = Array.from(rels).some((rel) => rel === activeFileRel);
        if (touchedActive && typeof window.__cm6RequestGitBaselines === 'function') {
          window.__cm6RequestGitBaselines();
        }
      }
    } catch (err) {
      console.warn('[Explorer] watcher:files handler failed', err);
    }
    return;
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.watcherModeChanged) {
    // Show/hide manual refresh bar when watcher mode changes
    try {
      const bar = document.getElementById('fe-watcher-refresh-bar');
      if (bar) {
        bar.style.display = (payload && payload.mode === 'none') ? '' : 'none';
      }
    } catch (_) {}
    return;
  }
  if (method === EXPLORER_RPC_NOTIFICATIONS.watcherConfigUpdated) {
    // On initial connect, show refresh bar if mode is "none"
    try {
      const bar = document.getElementById('fe-watcher-refresh-bar');
      if (bar) {
        bar.style.display = (payload && payload.mode === 'none') ? '' : 'none';
      }
    } catch (_) {}
    // Don't return — let main.js also handle via __cm6HandleWatcherConfig
  }
  switch (method) {
    case EXPLORER_RPC_NOTIFICATIONS.prefsUiUpdated: {
      const ui =
        payload && typeof payload.ui === 'object' && payload.ui ? payload.ui : null;
      const next = ui ? ui[UI_PREF_KEY_EXPLORER_STICKY_HEADERS] : undefined;
      if (typeof next === 'boolean') {
        explorerStickyHeadersEnabled = next;
      }
      syncExplorerPrefsUI();
      applyExplorerStickyScopesPreference();
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.projectActiveUpdated: {
      const prevProjectPath = uiState.projectPath || '';
      const nextProjectPath = payload.path || payload.projectPath || prevProjectPath;
      uiState.projectPath = nextProjectPath;
      renderProjectLabel();
      // When the active project changes, refresh diff base from backend
      // so both footer and overlay selectors stay in sync with HistoryStore.
      initDiffBaseFromBackend();

      // Only reset active file and open directory tracking when the project
      // actually changes. On Android, Socket.IO reconnects and workspace
      // settings saves re-fire project:setActive for the same project;
      // clearing here would lose track of the open file.
      if (prevProjectPath && nextProjectPath && prevProjectPath !== nextProjectPath) {
        setActiveFileRel(null);
        openDirectories.clear();
        openDirsInitialized = false;
      }

      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.activeFileUpdated: {
      const nextRel = payload && typeof payload.rel === 'string' ? payload.rel : null;
      setActiveFileRel(nextRel);
      if (nextRel) {
        Promise.resolve(expandToFile(nextRel))
          .then(() => {
            try { applyActiveFileMarker(); } catch (_) {}
          })
          .catch(() => {});
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.openDirsUpdated: {
      // Restore open directories from backend on page load
      const dirs = payload.dirs || [];
      restoreOpenDirectories(dirs);
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.listUpdated: {
      // payload: { cwd, entries: [...] }
      const cwd = payload.cwd || '.';
      if (!treeElement) {
        treeElement = document.getElementById('fe-file-tree');
      }
      if (!treeElement) break;

      if (cwd === '.' || cwd === '') {
        // Root snapshot
        const sameProject =
          !!renderedProjectPath &&
          !!uiState.projectPath &&
          renderedProjectPath === uiState.projectPath;
        let rootLi = treeElement.querySelector('li.fe-tree-node.fe-tree-root');
        if (!rootLi || !sameProject) {
          renderExplorerTree();
          rootLi = treeElement.querySelector('li.fe-tree-node.fe-tree-root');
        } else {
          const label = rootLi.querySelector(':scope > .fe-tree-text');
          if (label) {
            label.textContent = basename(uiState.projectPath || '') || 'Project';
          }
        }
        if (!rootLi) break;
        let childList = rootLi.querySelector(':scope > ul.fe-tree');
        if (!childList) {
          childList = document.createElement('ul');
          childList.className = 'fe-tree';
          rootLi.appendChild(childList);
        }
        renderEntriesInto(childList, payload.entries);

        if (reconnectResyncPending) {
          reconnectResyncPending = false;
          if (openDirectories.size && hasExplorerRpc()) {
            // Re-expand and refresh tracked open dirs after reconnect.
            restoreOpenDirectories(Array.from(openDirectories));
          }
        }
      } else {
        // Directory listing for cwd
        const dirLi = treeElement.querySelector(
          `li.fe-tree-node[data-kind="dir"][data-rel="${cwd}"]`
        );
        if (!dirLi) break;
        
        // Check if directory should be open:
        // 1. Already marked open in DOM
        // 2. Has existing child list
        // 3. Is tracked as open in our Set (handles race conditions)
        const wasOpen = dirLi.dataset.open === 'true';
        let childList = dirLi.querySelector(':scope > ul.fe-tree');
        const trackedAsOpen = openDirectories.has(cwd);
        
        if (wasOpen || childList || trackedAsOpen) {
          // Directory is open - update its contents
          if (!childList) {
            childList = document.createElement('ul');
            childList.className = 'fe-tree';
            dirLi.appendChild(childList);
          }
          dirLi.dataset.open = 'true';
          renderEntriesInto(childList, payload.entries);
          
          // Ensure it's tracked as open
          if (cwd !== '.' && cwd !== '') {
            openDirectories.add(cwd);
          }
        }
        // If directory was closed and has no childList, ignore the update
        // (it will be fetched when user opens it)
      }
      
      // Notify any pending expandToPath requests that this directory is ready
      _notifyDirListComplete(cwd);
      applyActiveFileMarker();
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.treeUpdated: {
      uiState.projectPath = payload.projectPath || uiState.projectPath;
      renderProjectLabel();
      renderExplorerTree();
      if (treeElement) {
        const rootLi = treeElement.querySelector('li.fe-tree-node.fe-tree-root');
        if (rootLi) {
          let childList = rootLi.querySelector(':scope > ul.fe-tree');
          if (!childList) {
            childList = document.createElement('ul');
            childList.className = 'fe-tree';
            rootLi.appendChild(childList);
          }
          renderEntriesInto(childList, payload.entries || payload.nodes || []);
        }
      }
      // Ensure footer controls/summaries are hydrated on cold boot even before watcher activity.
      if (!uiState.gitStatus && hasExplorerRpc()) {
        notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.decorationsUpdated: {
      const drafts = (payload && payload.drafts) || {};
      const root = treeElement || document.getElementById('fe-file-tree');
      if (!root) break;

      // Step 1: Clear existing draft flags from ALL nodes (files and directories)
      root.querySelectorAll('li.fe-tree-node').forEach((li) => {
        li.classList.remove('fe-draft', 'fe-dir-has-draft');
        if (li.dataset.hasDraft) {
          delete li.dataset.hasDraft;
        }
      });

      // Step 2: Apply draft flags to files that exist in DOM
      Object.entries(drafts).forEach(([rel, info]) => {
        if (!info || !info.hasDraft) return;
        const li = root.querySelector(
          `li.fe-tree-node[data-kind="file"][data-rel="${rel}"]`
        );
        if (li) {
          li.dataset.hasDraft = '1';
          li.classList.add('fe-draft');
        }
      });

      // Step 3: Compute ancestor directories from draft paths (path string manipulation)
      // This ensures parents show draft indicator even when children are collapsed
      const draftDirs = new Set();
      Object.entries(drafts).forEach(([rel, info]) => {
        if (!info || !info.hasDraft) return;
        const parts = rel.split('/');
        for (let i = 1; i < parts.length; i++) {
          draftDirs.add(parts.slice(0, i).join('/'));
        }
      });

      // Step 4: Apply fe-dir-has-draft to ancestor directories
      draftDirs.forEach((dirRel) => {
        const li = root.querySelector(
          `li.fe-tree-node[data-kind="dir"][data-rel="${dirRel}"]`
        );
        if (li) {
          li.dataset.hasDraft = '1';
          li.classList.add('fe-dir-has-draft');
        }
      });

      // Step 5: Mark root if there are any drafts
      if (draftDirs.size > 0 || Object.keys(drafts).length > 0) {
        const rootLi = root.querySelector('li.fe-tree-node.fe-tree-root');
        if (rootLi) {
          rootLi.dataset.hasDraft = '1';
          rootLi.classList.add('fe-dir-has-draft');
        }
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.gitDecorationsUpdated: {
      // Patch git status classes on existing DOM nodes without replacing the tree.
      // payload: { statuses: { rel: status, ... } }
      const statuses = (payload && payload.statuses) || {};
      const root = treeElement || document.getElementById('fe-file-tree');
      if (!root) break;

      // Statuses that warrant the orange "modified" outline on parent directories
      // (actual changes to tracked content)
      const OUTLINE_STATUSES = new Set(['modified', 'staged', 'staged_modified', 'added', 'deleted', 'renamed', 'conflict']);
      const STAGED_STATUSES = new Set(['staged', 'staged_modified', 'added']);

      // Step 1: Clear git status classes (but preserve draft flags)
      root.querySelectorAll('li.fe-tree-node').forEach((li) => {
        const classesToRemove = [];
        li.classList.forEach((cls) => {
          // Remove git-related classes but NOT draft or diagnostic ones
          if (cls.startsWith('fe-git-') || 
              (cls.startsWith('fe-dir-has-') && !cls.includes('draft') && !cls.includes('diag'))) {
            classesToRemove.push(cls);
          }
        });
        classesToRemove.forEach((cls) => li.classList.remove(cls));
        delete li.dataset.gitStatus;
        delete li.dataset.gitFlags;
      });

      // Step 2: Apply file statuses to nodes that exist in DOM
      Object.entries(statuses).forEach(([rel, status]) => {
        if (!status || status === 'clean') return;
        const li = _queryNodeByRel(root, 'file', rel);
        if (li) {
          li.dataset.gitStatus = status;
          li.classList.add(`fe-git-${status}`);
        }
      });

      // Step 3: Compute ancestor directories for each flag type
      const modifiedDirs = new Set();
      const stagedDirs = new Set();
      const untrackedDirs = new Set();
      
      Object.entries(statuses).forEach(([rel, status]) => {
        if (!status || status === 'clean') return;
        const parts = rel.split('/');
        for (let i = 1; i < parts.length; i++) {
          const dirRel = parts.slice(0, i).join('/');
          
          if (OUTLINE_STATUSES.has(status)) {
            modifiedDirs.add(dirRel);
          }
          if (STAGED_STATUSES.has(status)) {
            stagedDirs.add(dirRel);
          }
          if (status === 'untracked') {
            untrackedDirs.add(dirRel);
          }
        }
      });

      // Step 4: Apply directory flags
      const allDirRels = new Set([...modifiedDirs, ...stagedDirs, ...untrackedDirs]);
      allDirRels.forEach((dirRel) => {
        const li = _queryNodeByRel(root, 'dir', dirRel);
        if (!li) return;
        
        if (modifiedDirs.has(dirRel)) {
          li.classList.add('fe-dir-has-modified');
          li.classList.add('fe-git-modified');
          li.dataset.gitStatus = 'modified';
        }
        if (stagedDirs.has(dirRel)) {
          li.classList.add('fe-dir-has-staged');
        }
        if (untrackedDirs.has(dirRel)) {
          li.classList.add('fe-dir-has-untracked');
          if (!modifiedDirs.has(dirRel)) {
            li.classList.add('fe-git-untracked');
            li.dataset.gitStatus = li.dataset.gitStatus || 'untracked';
          }
        }
      });

      // Step 5: Mark root if there are any dirty files
      const rootLi = root.querySelector('li.fe-tree-node.fe-tree-root');
      if (rootLi) {
        if (modifiedDirs.size > 0) {
          rootLi.classList.add('fe-git-modified');
          rootLi.classList.add('fe-dir-has-modified');
        }
        if (stagedDirs.size > 0) {
          rootLi.classList.add('fe-dir-has-staged');
        }
        if (untrackedDirs.size > 0) {
          rootLi.classList.add('fe-dir-has-untracked');
          if (modifiedDirs.size === 0) {
            rootLi.classList.add('fe-git-untracked');
          }
        }
      }
      // Reapply diagnostic flags that may have been touched by class removal
      applyAggregatedDiagnosticFlags();
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.diagnosticsDetail: {
      // Full marker detail from the diagnostics bridge — SSOT for both
      // the Diagnostics tab AND the explorer tree badges.
      _explorerDiagDetail = (payload && typeof payload === 'object') ? payload : {};

      // If the explorer diagnostics panel is alive, let it process the
      // update (diff-aware) and derive the tree summary from its curated data.
      const livePanel = getExplorerDiagnosticsPanel();
      if (livePanel) {
        const proj = (uiState.projectPath || '').replace(/\/+$/, '');
        const activeAbs = activeFileRel && proj
          ? proj + '/' + activeFileRel : null;
        if (activeAbs) livePanel.setActiveFile(activeAbs);
        livePanel.update(_explorerDiagDetail);

        // Tree badges from the panel's manicured data
        const panelSummary = livePanel.getSummary(proj);
        _setDiagnosticsSummary(panelSummary);
        applyAggregatedDiagnosticFlags();
      } else {
        // No live panel — derive summary inline (same as before)
        const proj = (uiState.projectPath || '').replace(/\/+$/, '');
        const summary = {};
        Object.entries(_explorerDiagDetail).forEach(([absPath, markers]) => {
          if (!Array.isArray(markers) || markers.length === 0) return;
          const rel = proj && absPath.startsWith(proj + '/')
            ? absPath.slice(proj.length + 1) : absPath;
          if (!summary[rel]) summary[rel] = { errors: 0, warnings: 0 };
          for (const m of markers) {
            const sev = m.severity || 0;
            if (sev === 8) summary[rel].errors++;        // MarkerSeverity.Error
            else if (sev === 4) summary[rel].warnings++; // MarkerSeverity.Warning
          }
        });
        _setDiagnosticsSummary(summary);
        applyAggregatedDiagnosticFlags();
      }

      // If the Diagnostics tab is currently visible, re-render it.
      if (searchOverlayVisible && searchMode === 'diagnostics') {
        renderSearchOverlay();
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.draftContent: {
      // Live draft propagation (SSOT active file only).
      // Only apply if we are currently on the same absolute file path.
      try {
        if (payload && typeof window.__cm6ApplyRemoteDraft === 'function') {
          window.__cm6ApplyRemoteDraft(payload);
        }
      } catch (err) {
        console.warn('[Explorer] draft:content handler failed', err);
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.autosaveContent: {
      // Live autosave propagation (SSOT active file only).
      try {
        if (payload && typeof window.__cm6ApplyAutosaveContent === 'function') {
          window.__cm6ApplyAutosaveContent(payload);
        }
      } catch (err) {
        console.warn('[Explorer] autosave:content handler failed', err);
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.editorPrefsChanged: {
      // Preference changes should propagate immediately across host shells.
      try {
        if (payload && typeof window.__cm6HandlePrefsChanged === 'function') {
          window.__cm6HandlePrefsChanged(payload);
        } else {
          // Handler may not be registered yet during early boot; keep last event.
          window.__cm6PendingPrefsChanged = payload;
        }
      } catch (err) {
        console.warn('[Explorer] prefs_changed handler failed', err);
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.projectOpened: {
      // Backend confirms a project switch (open/create).
      // Update UI state - no page reload needed, WebSocket stays connected
      if (payload && payload.path) {
        uiState.projectPath = payload.path;
        renderProjectLabel();
        // Request fresh tree and git status for the new project
        if (hasExplorerRpc()) {
          notifyExplorer(EXPLORER_RPC_METHODS.list, { rel: '.' });
          notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
        }
        // Refresh diff base selector for the new project
        initDiffBaseFromBackend();
        // Also notify the host/editor runtime so the iframe detaches from the
        // old project and reloads into the new one.
        if (typeof window.__cm6HandleProjectOpened === 'function') {
          try {
            window.__cm6HandleProjectOpened(payload.path);
          } catch (err) {
            console.warn('[Explorer] Failed to synchronize editor on project:opened:', err);
          }
        }
      }

      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.gitStatusUpdated: {
      console.log('[GIT_STATUS_DEBUG] Received:', payload);
      uiState.gitStatus = payload || null;
      renderGitSummary();
      // Any git status means we are in a real git repo: enable controls and hide Init.
      setGitControlsEnabled(true, false);
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.gitDiffBaseUpdated: {
      if (payload && payload.ref) {
        gitDiffBase.ref = payload.ref;
        // If refresh flag is set (e.g., after commit), re-fetch full diff base info
        if (payload.refresh) {
          initDiffBaseFromBackend().catch(() => {});
        } else {
          updateDiffBaseButtons();
        }
        if (searchOverlayVisible) {
          renderSearchOverlay();
        }
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.gitRestored: {
      // After a file is restored from git, the backend broadcasts git:status
      // and this event. Reload the current file so restored content is shown.
      if (typeof window.__cm6ReloadCurrentFile === 'function') {
        try {
          window.__cm6ReloadCurrentFile();
        } catch (err) {
          console.warn('Failed to reload current file after restore:', err);
        }
      }
      break;
    }
    
    // --- Job Progress Events (git push/pull/clone with progress) ---
    case EXPLORER_RPC_NOTIFICATIONS.jobProgress: {
      const { id, type, status, progress, message, error } = payload;
      
      // Only handle git-related jobs
      if (!type || !type.startsWith('git_')) {
        break;
      }
      
      if (status === 'running') {
        const pct = progress?.completed ?? 0;
        const detail = progress?.detail || message || '';
        showGitProgressBar(pct, detail);
      } else if (status === 'succeeded') {
        hideGitProgressBar();
        toast(message || `${type.replace('_', ' ')} completed`);
        // Refresh git status after push/pull/clone completes
        if (type === 'git_pull' || type === 'git_push' || type === 'git_clone') {
          if (typeof window.__explorerBusSend === 'function') {
            notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
            notifyExplorer(EXPLORER_RPC_METHODS.refresh, {});
          }
        }
      } else if (status === 'failed') {
        hideGitProgressBar();
        toast(error || message || `${type.replace('_', ' ')} failed`);
      } else if (status === 'cancelled') {
        hideGitProgressBar();
        toast(`${type.replace('_', ' ')} cancelled`);
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.gitPushStarted:
    case EXPLORER_RPC_NOTIFICATIONS.gitPullStarted:
    case EXPLORER_RPC_NOTIFICATIONS.gitCloneStarted: {
      showGitProgressBar(0, 'Starting...');
      break;
    }
    
    case EXPLORER_RPC_NOTIFICATIONS.searchResultsUpdated: {
      searchResults = payload || null;
      searchLoading = false;
      searchError = null;
      if (payload && typeof payload.mode === 'string') {
        searchMode = payload.mode;
      }
      // Track diff base for changes mode, if provided
      if (payload && payload.mode === 'changes' && payload.base) {
        gitDiffBase = {
          ref: payload.base.ref || 'HEAD',
          mode: payload.base.mode || 'none',
          commit: payload.base.commit || null,
        };
        updateDiffBaseButtons();
      }
      if (searchOverlayVisible) {
        renderSearchOverlay();
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.error: {
      const message =
        payload && typeof payload.error === 'string'
          ? payload.error
          : 'Unknown error';

      // If the search overlay is active, prefer surfacing the error there
      // (otherwise users can get stuck on "Searching…").
      if (searchOverlayVisible && searchLoading) {
        searchLoading = false;
        searchError = message;
        renderSearchOverlay();
      } else {
        toast(message);
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.reviewEntriesUpdated: {
      uiState.reviewEntries = payload && Array.isArray(payload.entries) ? payload.entries : [];
      if (searchMode === 'review') {
        searchResults = { mode: 'review', results: uiState.reviewEntries };
        searchLoading = false;
        searchError = null;
        if (searchOverlayVisible) {
          renderSearchOverlay();
        }
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.pulse: {
      // Heartbeat from server. Respond to confirm we are alive.
      // console.debug('[Explorer] Pulse received 💓');
      if (hasExplorerRpc()) {
        notifyExplorer(EXPLORER_RPC_METHODS.pulseAlive, {});
      }
      break;
    }
    case EXPLORER_RPC_NOTIFICATIONS.navigate: {
      const rel = typeof payload?.rel === 'string' ? payload.rel : '';
      if (payload?.open_drawer) {
        toggleDrawer(true);
      }
      if (rel) {
        void expandToPath(rel);
      }
      break;
    }
    default:
      break;
  }
}

export async function initExplorerUI() {
  const root = document.querySelector('.fe-root');
  const drawer = document.getElementById('fe-drawer');
  const drawerBody = drawer?.querySelector('.fe-drawer-body');
  const drawerClose = document.getElementById('fe-drawer-close');
  const drawerOpenBtn = document.getElementById('fe-drawer-open');
  const drawerBackdrop = document.getElementById('fe-drawer-backdrop');
  explorerMenuBtn = document.getElementById('fe-explorer-menu-btn');
  explorerMenuDropdown = document.getElementById('fe-explorer-menu-dd');
  explorerMenuStickyHeadersItem = document.getElementById(
    'fe-mi-explorer-sticky-headers',
  );
  explorerMenuScrollActiveItem = document.getElementById(
    'fe-mi-explorer-scroll-active',
  );
  const btnNewProject = document.getElementById('fe-new-project');
  const btnOpenProject = document.getElementById('fe-open-project');
  treeElement = document.getElementById('fe-file-tree');
  projectLabelEl = document.getElementById('fe-project-label');
  gitSummaryEl = document.getElementById('fe-git-summary');
  const searchBtn = document.getElementById('fe-search-btn');
  gitBaseBtn = document.getElementById('fe-git-base-btn');
  gitBaseDropdown = document.getElementById('fe-git-base-dd');

  if (!draftUpdateListenerInstalled) {
    window.addEventListener('cm6:draft-updated', (event) => {
      const detail = event?.detail || {};
      const rel = relFromAbsPath(detail.path);
      if (!rel || rel === '.') return;
      applyDraftFlag(rel, !!detail.unsaved);
    });
    draftUpdateListenerInstalled = true;
  }

  gitButtons = {
    init: document.getElementById('fe-git-init'),
    stage: document.getElementById('fe-git-stage'),
    unstage: document.getElementById('fe-git-unstage'),
    commit: document.getElementById('fe-git-commit'),
    push: document.getElementById('fe-git-push'),
    pull: document.getElementById('fe-git-pull'),
    reset: document.getElementById('fe-git-reset'),
  };

  // Hydrate diff base from global editor state (HistoryStore-backed)
  try {
    const state = window.__cm6EditorState || null;
    const base = state && state.gitDiffBase;
    if (base) {
      gitDiffBase = {
        ref: base.ref || 'HEAD',
        mode: base.mode || 'none',
        commit: base.commit || null,
      };
      const projectExists =
        !!(state && state.activeProject && state.activeProjectExists);
      if (!projectExists) {
        setGitControlsEnabled(false, false);
      } else if (gitDiffBase.mode === 'none') {
        setGitControlsEnabled(true, true);
      } else {
        // Git repo exists — enable controls immediately; git:status will refine.
        setGitControlsEnabled(true, false);
      }
    }
  } catch {
    // Non-fatal; overlay can still hydrate from search results.
  }

  // Sync initial button labels with hydrated diff base; then ask backend
  // for the authoritative diff base snapshot to handle timing issues
  // with __cm6EditorState.
  updateDiffBaseButtons();
  initDiffBaseFromBackend();
  if (typeof window.__explorerBusSend === 'function') {
    notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
  }

  function toggleDrawer(open) {
    if (!root) return;
    if (open === undefined) {
      root.classList.toggle('drawer-open');
    } else if (open) {
      root.classList.add('drawer-open');
    } else {
      root.classList.remove('drawer-open');
    }
  }

  drawerClose?.addEventListener('click', () => toggleDrawer(false));
  drawerBackdrop?.addEventListener('click', () => toggleDrawer(false));
  drawerOpenBtn?.addEventListener('click', () => toggleDrawer(true));

  if (searchBtn) {
    searchBtn.addEventListener('click', openSearchOverlay);
  }

  if (gitBaseBtn && gitBaseDropdown) {
    gitBaseBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleDiffBaseMenu(gitBaseBtn, gitBaseDropdown);
    });
  }

  if (explorerMenuBtn && explorerMenuDropdown) {
    explorerMenuBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeDiffBaseMenus();
      explorerMenuDropdown.classList.toggle('show');
    });
  }

  if (explorerMenuStickyHeadersItem) {
    explorerMenuStickyHeadersItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeExplorerMenu();
      if (typeof explorerStickyHeadersEnabled !== 'boolean') {
        toast('Explorer preferences not loaded yet.');
        return;
      }
    if (!hasExplorerRpc()) {
      toast('Explorer connection unavailable.');
      return;
    }
      notifyExplorer(EXPLORER_RPC_METHODS.prefsUiUpdate, {
        key: UI_PREF_KEY_EXPLORER_STICKY_HEADERS,
        value: !explorerStickyHeadersEnabled,
      });
    });
  }

  if (explorerMenuScrollActiveItem) {
    explorerMenuScrollActiveItem.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      closeExplorerMenu();
      await scrollToActiveFile();
    });
  }

  document.addEventListener(
    'click',
    (ev) => {
      if (ev.target.closest('#fe-explorer-menu')) return;
      closeExplorerMenu();
    },
    false,
  );

  // Close diff-base dropdowns when clicking outside either button/dropdown.
  document.addEventListener(
    'click',
    (ev) => {
      const inBaseButton =
        ev.target.closest('#fe-git-base-btn') ||
        ev.target.closest('#fe-search-base-btn');
      const inBaseDropdown =
        ev.target.closest('#fe-git-base-dd') ||
        ev.target.closest('#fe-search-base-dd');
      if (!inBaseButton && !inBaseDropdown) {
        closeDiffBaseMenus();
      }
    },
    false,
  );

  if (btnOpenProject) {
    btnOpenProject.addEventListener('click', async () => {
      // Safety check: switching projects can drop unsaved work.
      if (
        !window.confirm(
          'Any unsaved changes in the current project will be lost. Continue?',
        )
      ) {
        return;
      }

      if (!window.teFilePicker) {
        toast('File picker not available.');
        return;
      }

      try {
        const choice = await window.teFilePicker.openDirectory({
          title: 'Open Project Directory',
          selectLabel: 'Set as Project',
        });
        if (!choice || !choice.path) return;
        if (typeof window.__explorerBusSend !== 'function') {
          toast('Explorer connection unavailable.');
          return;
        }
        // Delegate project switching to the WS dispatcher; it will emit
        // project:opened + refreshed tree/git status. We handle the event
        // below (handleExplorerEvent) and can reload if needed.
        notifyExplorer(EXPLORER_RPC_METHODS.projectOpen, { path: choice.path });
      } catch (e) {
        if (e && e.message !== 'cancelled') {
          toast(`An error occurred: ${e.message || e}`);
        }
      }
    });
  }

  if (btnNewProject) {
    btnNewProject.addEventListener('click', async () => {
      if (
        !window.confirm(
          'Any unsaved changes in the current project will be lost. Continue?',
        )
      ) {
        return;
      }

      if (!window.teFilePicker) {
        toast('File picker not available.');
        return;
      }

      let choice;
      try {
        choice = await showNewProjectModal(toast);
      } catch (e) {
        if (e !== 'cancelled') {
          toast(`An error occurred: ${e?.message || e}`);
        }
        return;
      }

      if (!choice) return;

      if (choice.type === 'clone') {
        // Clone repository via job system with progress.
        let name = 'repo';
        try {
          const parts = String(choice.url || '').split('/');
          let last = parts[parts.length - 1] || '';
          if (last.endsWith('.git')) last = last.slice(0, -4);
          if (last.trim()) name = last.trim();
        } catch {
          // keep default name
        }

        try {
          const result = await window.teFilePicker.saveFile({
            title: 'Clone Repository Destination',
            filename: name,
            selectLabel: 'Clone Here',
          });

          if (result && result.existed) {
            const ok = window.confirm(
              `Directory "${result.path}" already exists. Clone might fail if not empty. Continue?`,
            );
            if (!ok) return;
          }

          if (typeof window.__explorerBusSend !== 'function') {
            toast('Explorer connection unavailable.');
            return;
          }

          // Use job-based clone with progress via WebSocket
          notifyExplorer(EXPLORER_RPC_METHODS.gitClone, {
            url: choice.url,
            target_path: result.path,
          });
          // Progress bar shows via job:progress events
          // Backend auto-switches project when target dir is created
          
        } catch (e) {
          if (e && e.message !== 'cancelled') {
            toast(`An error occurred: ${e?.message || e}`);
          }
        }
      } else {
        // Local empty project: create directory then open via WS.
        try {
          const result = await window.teFilePicker.saveFile({
            title: 'Create New Project',
            filename: 'my-project',
            selectLabel: 'Create Project',
          });

          if (!result) return;

          if (result.existed) {
            const ok = window.confirm(
              `Directory "${result.path}" already exists. Use it anyway?`,
            );
            if (!ok) return;
          }

          if (typeof window.__explorerBusSend !== 'function') {
            toast('Explorer connection unavailable.');
            return;
          }

          // Let the backend validate and create the project directory, then
          // auto-open it (handle_project_create calls handle_project_open).
          notifyExplorer(EXPLORER_RPC_METHODS.projectCreate, {
            parent_path: result.directory,
            name: result.name,
          });
        } catch (e) {
          if (e && e.message !== 'cancelled') {
            toast(`An error occurred: ${e?.message || e}`);
          }
        }
      }
    });
  }

  explorerGitFooterUtils.bindGitFooterActions();

  // Context menu element (reused)
  let cardMenu = document.querySelector('.fe-card-menu');
  if (!cardMenu) {
    cardMenu = document.createElement('div');
    cardMenu.className = 'fe-card-menu';
    document.body.appendChild(cardMenu);
  }

  let currentMenuButton = null;

  function closeCardMenu() {
    if (cardMenu) {
      cardMenu.classList.remove('show');
      currentMenuButton = null;
    }
  }

  async function sendAgentMention(relPath) {
    if (!relPath) {
      toast('Missing path for mention');
      return;
    }
    if (!uiState.projectPath) {
      toast('No project open');
      return;
    }
    if (typeof window.__explorerBusSend !== 'function') {
      toast('Explorer bus unavailable');
      return;
    }
    let absPath = uiState.projectPath;
    if (relPath && relPath !== '.') {
      absPath =
        uiState.projectPath.replace(/\/+$/, '') +
        '/' +
        relPath.replace(/^\/+/, '');
    }
    try {
      notifyExplorer(EXPLORER_RPC_METHODS.mentionAgent, { path: absPath });
      toast('Mentioned in conversation');
    } catch (err) {
      console.error('Failed to send mention:', err);
      toast('Failed to mention in conversation');
    }
  }

  function openCardMenuForEntry(entry, anchorEl) {
    if (!cardMenu || !anchorEl) return;

    // Toggle behavior
    if (currentMenuButton === anchorEl && cardMenu.classList.contains('show')) {
      closeCardMenu();
      return;
    }

    currentMenuButton = anchorEl;
    cardMenu.innerHTML = '';
    cardMenu.classList.add('show');

    const items = [];
    const isDir = entry.kind === 'dir';
    const isFile = entry.kind === 'file';
    const gitStatus = entry.gitStatus || '';

    // Check if this directory is in select mode (menu clicked on the select-mode dir itself)
    if (isInSelectMode(entry.rel)) {
      // Select mode menu: batch actions
      items.push({ label: 'Disable select mode', type: 'disableSelectMode' });
      items.push({ divider: true });
      const count = selectedEntries.size;
      items.push({ label: `Copy selected (${count})`, type: 'batchCopy', disabled: count === 0 });
      items.push({ label: `Move selected (${count})`, type: 'batchMove', disabled: count === 0 });
      items.push({ divider: true });
      items.push({ label: `Stage selected (${count})`, type: 'batchStage', disabled: count === 0 });
      items.push({ label: `Unstage selected (${count})`, type: 'batchUnstage', disabled: count === 0 });
      items.push({ divider: true });
      items.push({ label: `Delete selected (${count})`, type: 'batchDelete', destructive: true, disabled: count === 0 });
    } else {
      // Normal menu
      if (isDir) {
        items.push({ label: 'Enable select mode', type: 'enableSelectMode' });
        items.push({ divider: true });
        items.push({ label: 'New File…', type: 'createFile' });
        items.push({ label: 'New Folder…', type: 'createDir' });
        items.push({ divider: true });
        items.push({ label: 'Open in File Explorer', type: 'openExternal' });
        items.push({ divider: true });
      }

      // Clipboard + move/copy actions for both files and dirs
      items.push({ label: 'Copy Name', type: 'copyName' });
      items.push({ label: 'Copy Path', type: 'copyPath' });
      items.push({ label: 'Copy Relative Path', type: 'copyRelPath' });
      items.push({ label: 'Mention in conversation', type: 'mentionAgent' });
      items.push({ divider: true });
      items.push({ label: 'Copy to…', type: 'copyTo' });
      items.push({ label: 'Move to…', type: 'moveTo' });

      if (isDir) {
        items.push({ label: 'Copy from…', type: 'copyFrom' });
        items.push({ label: 'Move from…', type: 'moveFrom' });
      }

      // Git actions for files with status
      if (
        isFile &&
        gitStatus &&
        (gitStatus === 'modified' ||
          gitStatus === 'untracked' ||
          gitStatus === 'added')
      ) {
        items.push({ label: 'Stage', type: 'stage' });
      }
      if (
        isFile &&
        gitStatus &&
        (gitStatus === 'staged' || gitStatus === 'staged_modified')
      ) {
        items.push({ label: 'Unstage', type: 'unstage' });
      }
      if (isFile && gitStatus && gitStatus !== 'clean') {
        items.push({ label: 'Restore…', type: 'restore' });
      }

      // Git actions for directories with dirty descendants
      if (isDir) {
        const dirLi = treeElement?.querySelector(
          `li.fe-tree-node[data-kind="dir"][data-rel="${entry.rel}"]`
        );
        const hasDirtyDescendants = dirLi && (
          dirLi.classList.contains('fe-dir-has-modified') ||
          dirLi.classList.contains('fe-dir-has-untracked')
        );
        const hasStagedDescendants = dirLi && 
          dirLi.classList.contains('fe-dir-has-staged');
        
        if (hasDirtyDescendants) {
          items.push({ label: 'Stage All in Folder…', type: 'stageDir' });
        }
        if (hasStagedDescendants) {
          items.push({ label: 'Unstage All in Folder…', type: 'unstageDir' });
        }
      }

      items.push({ divider: true });
      items.push({ label: 'Rename…', type: 'rename' });
      items.push({ label: 'Delete', type: 'delete', destructive: true });
    }

    items.forEach((item) => {
      if (item.divider) {
        const div = document.createElement('div');
        div.className = 'fe-dd-divider';
        cardMenu.appendChild(div);
        return;
      }
      const div = document.createElement('div');
      div.className = 'fe-dd-item';
      div.textContent = item.label;
      if (item.destructive) {
        div.dataset.destructive = 'true';
      }
      if (item.disabled) {
        div.classList.add('fe-dd-item-disabled');
        cardMenu.appendChild(div);
        return; // Don't add click handler for disabled items
      }
      div.addEventListener('click', async () => {
        closeCardMenu();
        if (!entry.rel) return;
        const rel = entry.rel;
        switch (item.type) {
          // --- Select Mode actions ---
          case 'enableSelectMode': {
            enableSelectMode(rel);
            break;
          }
          case 'disableSelectMode': {
            disableSelectMode();
            break;
          }
          case 'batchCopy': {
            await batchCopyTo();
            break;
          }
          case 'batchMove': {
            await batchMoveTo();
            break;
          }
          case 'batchStage': {
            await batchStage();
            break;
          }
          case 'batchUnstage': {
            await batchUnstage();
            break;
          }
          case 'batchDelete': {
            await batchDelete();
            break;
          }
          // --- Normal actions ---
          case 'createFile': {
            const name = window.prompt('New file name:');
            if (!name) return;
            if (typeof window.__explorerBusSend === 'function') {
              notifyExplorer(EXPLORER_RPC_METHODS.fileCreate, {
                parent_rel: rel,
                name,
              });
              // Open the newly created file after a short delay for server processing.
              const newRel = (rel && rel !== '.') ? rel.replace(/\/+$/, '') + '/' + name : name;
              setTimeout(() => { openFileAndMaybeJump(newRel); }, 200);
            }
            break;
          }
          case 'createDir': {
            const name = window.prompt('New folder name:');
            if (!name) return;
            if (typeof window.__explorerBusSend === 'function') {
              notifyExplorer(EXPLORER_RPC_METHODS.dirCreate, {
                parent_rel: rel,
                name,
              });
            }
            break;
          }
          case 'openExternal': {
            if (!uiState.projectPath) {
              toast('No project open');
              break;
            }
            let fullPath = uiState.projectPath;
            if (rel && rel !== '.') {
              fullPath =
                uiState.projectPath.replace(/\/+$/, '') +
                '/' +
                rel.replace(/^\/+/, '');
            }
            try {
              const resp = await fetch('/api/apps/file_explorer/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ params: { path: fullPath } }),
              });
              const json = await resp.json();
              if (json && json.ok && json.data && json.data.url) {
                window.location.href = json.data.url;
              } else {
                console.error('Launch failed', json);
                toast('Failed to open File Explorer');
              }
            } catch (err) {
              console.error(err);
              toast('Failed to open File Explorer');
            }
            break;
          }
          case 'copyName': {
            try {
              if (
                !navigator ||
                !navigator.clipboard ||
                !navigator.clipboard.writeText
              ) {
                toast('Clipboard not available');
                break;
              }
              const name = entry.name || '';
              await navigator.clipboard.writeText(name);
              toast(`Copied "${name}" to clipboard`);
            } catch {
              toast('Failed to copy name');
            }
            break;
          }
          case 'copyPath': {
            try {
              if (
                !navigator ||
                !navigator.clipboard ||
                !navigator.clipboard.writeText
              ) {
                toast('Clipboard not available');
                break;
              }
              if (!uiState.projectPath) {
                toast('No project open');
                break;
              }
              let fullPath = uiState.projectPath;
              if (rel && rel !== '.') {
                fullPath =
                  uiState.projectPath.replace(/\/+$/, '') +
                  '/' +
                  rel.replace(/^\/+/, '');
              }
              await navigator.clipboard.writeText(fullPath);
              toast('Copied path to clipboard');
            } catch {
              toast('Failed to copy path');
            }
            break;
          }
          case 'copyRelPath': {
            try {
              if (
                !navigator ||
                !navigator.clipboard ||
                !navigator.clipboard.writeText
              ) {
                toast('Clipboard not available');
                break;
              }
              const relPath = rel || '.';
              await navigator.clipboard.writeText(relPath);
              toast('Copied relative path to clipboard');
            } catch {
              toast('Failed to copy relative path');
            }
            break;
          }
          case 'mentionAgent': {
            await sendAgentMention(rel);
            break;
          }
          case 'copyTo': {
            if (!window.teFilePicker) {
              toast('File picker not available');
              break;
            }
            try {
              const dest = await window.teFilePicker.openDirectory({
                title: `Copy "${entry.name}" to…`,
                startPath: uiState.projectPath || '',
              });
              if (!dest || !dest.path) break;
              if (typeof window.__explorerBusSend !== 'function') {
                toast('Explorer connection unavailable.');
                break;
              }
              notifyExplorer(EXPLORER_RPC_METHODS.entryCopy, {
                rel,
                dest_path: dest.path,
              });
            } catch (err) {
              if (err && err.message === 'cancelled') break;
              toast(err?.message || 'Copy failed');
            }
            break;
          }
          case 'moveTo': {
            if (!window.teFilePicker) {
              toast('File picker not available');
              break;
            }
            try {
              const dest = await window.teFilePicker.openDirectory({
                title: `Move "${entry.name}" to…`,
                startPath: uiState.projectPath || '',
              });
              if (!dest || !dest.path) break;
              if (typeof window.__explorerBusSend !== 'function') {
                toast('Explorer connection unavailable.');
                break;
              }
              notifyExplorer(EXPLORER_RPC_METHODS.entryMove, {
                rel,
                dest_path: dest.path,
              });
            } catch (err) {
              if (err && err.message === 'cancelled') break;
              toast(err?.message || 'Move failed');
            }
            break;
          }
          case 'copyFrom': {
            if (!window.teFilePicker) {
              toast('File picker not available');
              break;
            }
            try {
              const source = await window.teFilePicker.open({
                title: `Copy into "${entry.name}"`,
                startPath: uiState.projectPath || '',
                mode: 'any',
                selectLabel: 'Copy Here',
              });
              if (!source || !source.path) break;
              if (typeof window.__explorerBusSend !== 'function') {
                toast('Explorer connection unavailable.');
                break;
              }
              notifyExplorer(EXPLORER_RPC_METHODS.entryCopyFrom, {
                source_path: source.path,
                dest_rel: rel,
              });
            } catch (err) {
              if (err && err.message === 'cancelled') break;
              toast(err?.message || 'Copy failed');
            }
            break;
          }
          case 'moveFrom': {
            if (!window.teFilePicker) {
              toast('File picker not available');
              break;
            }
            try {
              const source = await window.teFilePicker.open({
                title: `Move into "${entry.name}"`,
                startPath: uiState.projectPath || '',
                mode: 'any',
                selectLabel: 'Move Here',
              });
              if (!source || !source.path) break;
              if (typeof window.__explorerBusSend !== 'function') {
                toast('Explorer connection unavailable.');
                break;
              }
              notifyExplorer(EXPLORER_RPC_METHODS.entryMoveFrom, {
                source_path: source.path,
                dest_rel: rel,
              });
            } catch (err) {
              if (err && err.message === 'cancelled') break;
              toast(err?.message || 'Move failed');
            }
            break;
          }
          case 'rename': {
            const newName = window.prompt('New name:', entry.name || '');
            if (!newName || newName === entry.name) return;
            if (typeof window.__explorerBusSend === 'function') {
              notifyExplorer(EXPLORER_RPC_METHODS.entryRename, {
                rel,
                new_name: newName,
              });
            }
            break;
          }
          case 'delete': {
            const confirmed = window.confirm(
              `Delete ${entry.kind === 'dir' ? 'folder' : 'file'} "${entry.name}"?`
            );
            if (!confirmed) return;
            if (typeof window.__explorerBusSend === 'function') {
              notifyExplorer(EXPLORER_RPC_METHODS.entryDelete, { rel });
            }
            break;
          }
          case 'stage': {
            if (typeof window.__explorerBusSend !== 'function') {
              toast('Explorer connection unavailable.');
              break;
            }
            try {
              notifyExplorer(EXPLORER_RPC_METHODS.gitStage, { paths: [rel] });
              toast(`Staged ${entry.name}`);
            } catch (err) {
              toast(err?.message || 'Stage failed');
            }
            break;
          }
          case 'unstage': {
            if (typeof window.__explorerBusSend !== 'function') {
              toast('Explorer connection unavailable.');
              break;
            }
            try {
              notifyExplorer(EXPLORER_RPC_METHODS.gitUnstage, { paths: [rel] });
              toast(`Unstaged ${entry.name}`);
            } catch (err) {
              toast(err?.message || 'Unstage failed');
            }
            break;
          }
          case 'stageDir': {
            if (typeof window.__explorerBusSend !== 'function') {
              toast('Explorer connection unavailable.');
              break;
            }
            const stageConfirmed = window.confirm(
              `Stage all changes in "${entry.name}"?\n\nThis will stage all modified and untracked files in this directory.`,
            );
            if (!stageConfirmed) break;
            try {
              notifyExplorer(EXPLORER_RPC_METHODS.gitStage, { paths: [rel] });
              toast(`Staged all in ${entry.name}`);
            } catch (err) {
              toast(err?.message || 'Stage failed');
            }
            break;
          }
          case 'unstageDir': {
            if (typeof window.__explorerBusSend !== 'function') {
              toast('Explorer connection unavailable.');
              break;
            }
            const unstageConfirmed = window.confirm(
              `Unstage all changes in "${entry.name}"?\n\nThis will unstage all staged files in this directory.`,
            );
            if (!unstageConfirmed) break;
            try {
              notifyExplorer(EXPLORER_RPC_METHODS.gitUnstage, { paths: [rel] });
              toast(`Unstaged all in ${entry.name}`);
            } catch (err) {
              toast(err?.message || 'Unstage failed');
            }
            break;
          }
          case 'restore': {
            if (typeof window.__explorerBusSend !== 'function') {
              toast('Explorer connection unavailable.');
              break;
            }
            const confirmed = window.confirm(
              `⚠️ WARNING: This will discard changes to ${entry.name}\n\nRestore from HEAD?`,
            );
            if (!confirmed) break;
            try {
              notifyExplorer(EXPLORER_RPC_METHODS.gitRestore, {
                path: rel,
                commit: 'HEAD',
              });
            } catch (err) {
              toast(err?.message || 'Restore failed');
            }
            break;
          }
          default:
            break;
        }
      });
      cardMenu.appendChild(div);
    });

    const rect = anchorEl.getBoundingClientRect();
    const menuWidth = cardMenu.offsetWidth || 200;
    const menuHeight = cardMenu.offsetHeight || 200;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    if (left + menuWidth > viewportWidth - 8) {
      left = Math.max(8, viewportWidth - menuWidth - 8);
    }

    let top = rect.bottom;
    if (top + menuHeight > viewportHeight - 8) {
      top = Math.max(8, rect.top - menuHeight);
    }

    cardMenu.style.left = `${left}px`;
    cardMenu.style.top = `${top}px`;
  }

  // --- Batch action functions ---
  
  async function batchCopyTo() {
    const paths = Array.from(selectedEntries);
    if (!paths.length) {
      toast('No items selected');
      return;
    }
    if (!window.teFilePicker) {
      toast('File picker not available');
      return;
    }
    try {
      const dest = await window.teFilePicker.openDirectory({
        title: `Copy ${paths.length} items to…`,
        startPath: uiState.projectPath || '',
      });
      if (!dest || !dest.path) return;
      if (typeof window.__explorerBusSend !== 'function') {
        toast('Explorer connection unavailable');
        return;
      }
      notifyExplorer(EXPLORER_RPC_METHODS.entriesCopy, {
        rels: paths,
        dest_path: dest.path,
      });
      toast(`Copying ${paths.length} items…`);
      disableSelectMode();
    } catch (err) {
      if (err && err.message !== 'cancelled') {
        toast(err?.message || 'Batch copy failed');
      }
    }
  }

  async function batchMoveTo() {
    const paths = Array.from(selectedEntries);
    if (!paths.length) {
      toast('No items selected');
      return;
    }
    if (!window.teFilePicker) {
      toast('File picker not available');
      return;
    }
    try {
      const dest = await window.teFilePicker.openDirectory({
        title: `Move ${paths.length} items to…`,
        startPath: uiState.projectPath || '',
      });
      if (!dest || !dest.path) return;
      if (typeof window.__explorerBusSend !== 'function') {
        toast('Explorer connection unavailable');
        return;
      }
      notifyExplorer(EXPLORER_RPC_METHODS.entriesMove, {
        rels: paths,
        dest_path: dest.path,
      });
      toast(`Moving ${paths.length} items…`);
      disableSelectMode();
    } catch (err) {
      if (err && err.message !== 'cancelled') {
        toast(err?.message || 'Batch move failed');
      }
    }
  }

  async function batchStage() {
    const paths = Array.from(selectedEntries);
    if (!paths.length) {
      toast('No items selected');
      return;
    }
    if (typeof window.__explorerBusSend !== 'function') {
      toast('Explorer connection unavailable');
      return;
    }
    notifyExplorer(EXPLORER_RPC_METHODS.gitStage, { paths });
    toast(`Staged ${paths.length} items`);
    disableSelectMode();
  }

  async function batchUnstage() {
    const paths = Array.from(selectedEntries);
    if (!paths.length) {
      toast('No items selected');
      return;
    }
    if (typeof window.__explorerBusSend !== 'function') {
      toast('Explorer connection unavailable');
      return;
    }
    notifyExplorer(EXPLORER_RPC_METHODS.gitUnstage, { paths });
    toast(`Unstaged ${paths.length} items`);
    disableSelectMode();
  }

  async function batchDelete() {
    const paths = Array.from(selectedEntries);
    if (!paths.length) {
      toast('No items selected');
      return;
    }
    const confirmed = window.confirm(
      `⚠️ WARNING: Delete ${paths.length} items?\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;
    if (typeof window.__explorerBusSend !== 'function') {
      toast('Explorer connection unavailable');
      return;
    }
    notifyExplorer(EXPLORER_RPC_METHODS.entriesDelete, { rels: paths });
    toast(`Deleting ${paths.length} items…`);
    disableSelectMode();
  }

  document.addEventListener(
    'click',
    (ev) => {
      if (ev.target.closest('.fe-card-menu')) return;
      if (ev.target.closest('.fe-card-menu-btn')) return;
      if (cardMenu && cardMenu.classList.contains('show')) {
        closeCardMenu();
      }
    },
    false
  );

  // Initialize explorer dropdown UI with any already-known prefs snapshot.
  syncExplorerPrefsUI();

  // Sticky scopes (Monaco-ish "docked folders") overlay for the explorer tree.
  // Uses geometry; does not change backend/SSOT behavior.
  stickyScopesContext.treeElement = treeElement;
  stickyScopesContext.drawerBodyEl = drawerBody;
  stickyScopesContext.openCardMenuForEntry = openCardMenuForEntry;
  applyExplorerStickyScopesPreference();

  // Basic click handling: expand/collapse dirs, open files, open context menu
  if (treeElement) {
    treeElement.addEventListener('click', (ev) => {
      // Sticky scopes overlay: clicking the docked rows should collapse that scope.
      // (Menu clicks are handled by the overlay itself.)
      const sticky = document.getElementById('fe-sticky-scopes');
      if (sticky && sticky.style.display !== 'none') {
        const r = sticky.getBoundingClientRect();
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
          // Map the click to the sticky slot that visually contains the point.
          // The overlay itself is `pointer-events: none`, so clicks pass through
          // to the underlying tree; we intercept them here for correct behavior.
          const slots = sticky.querySelectorAll('ul.fe-sticky-scope-slot');
          let bestSlot = null;
          let bestZ = -Infinity;
          for (const slot of slots) {
            const rect = slot.getBoundingClientRect();
            if (
              ev.clientX >= rect.left &&
              ev.clientX <= rect.right &&
              ev.clientY >= rect.top &&
              ev.clientY <= rect.bottom
            ) {
              const z = Number(slot.style.zIndex || 0);
              if (z > bestZ) {
                bestZ = z;
                bestSlot = slot;
              }
            }
          }

          const rel = bestSlot?.querySelector('li.fe-tree-node')?.dataset?.rel;
          if (rel && rel !== '.') {
            const slotRect = bestSlot?.getBoundingClientRect?.();
            const selRel =
              (window.CSS && typeof window.CSS.escape === 'function')
                ? window.CSS.escape(rel)
                : rel.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
            const dirLi = treeElement.querySelector(
              `li.fe-tree-node[data-kind="dir"][data-rel="${selRel}"]`
            );
            if (dirLi && dirLi.dataset.open === 'true') {
              dirLi.dataset.open = 'false';
              const childList = dirLi.querySelector(':scope > ul.fe-tree');
              if (childList) childList.remove();

              // Auto-disable select mode if collapsing the select-mode directory
              checkAutoDisableSelectMode(rel);

              // Track directory close for persistence
              markDirectoryOpen(rel, false);

              // "Magic" UX: after closing a sticky scope, scroll so the closed
              // directory row lands exactly where the sticky header was.
              if (slotRect) {
                const dirRect = dirLi.getBoundingClientRect();
                const delta = dirRect.top - slotRect.top;
                if (Math.abs(delta) >= 1) {
                  const maxScroll = Math.max(
                    0,
                    treeElement.scrollHeight - treeElement.clientHeight,
                  );
                  const nextTop = Math.min(
                    maxScroll,
                    Math.max(0, treeElement.scrollTop + delta),
                  );
                  treeElement.scrollTop = nextTop;
                }
              }

              // Nudge sticky overlay to recompute immediately (some engines may not
              // emit a scroll event for programmatic `scrollTop` changes).
              const stickyApi = window.__explorerStickyScopes;
              if (stickyApi && typeof stickyApi.update === 'function') {
                stickyApi.update();
              }
            }
          }
          return;
        }
      }

      const li = ev.target.closest('li.fe-tree-node');
      if (!li) return;
      const rel = li.dataset.rel;
      const kind = li.dataset.kind;
      if (!rel) return;

      // Checkbox click in select mode - let it bubble to the checkbox handler
      if (ev.target.closest('.fe-entry-checkbox')) {
        return;
      }

      // Card menu open
      const menuBtn = ev.target.closest('.fe-card-menu-btn');
      if (menuBtn) {
        const entry = {
          rel,
          name: li.dataset.name || li.querySelector('.fe-tree-text')?.textContent || '',
          kind: kind || 'file',
          gitStatus: li.dataset.gitStatus || '',
        };
        openCardMenuForEntry(entry, menuBtn);
        return;
      }

      if (kind === 'dir') {
        // Do not collapse the synthetic project root card
        if (rel === '.') return;
        const isOpen = li.dataset.open === 'true';
        if (isOpen) {
          // Collapse: remove children list
          li.dataset.open = 'false';
          const childList = li.querySelector(':scope > ul.fe-tree');
          if (childList) childList.remove();
          
          // Auto-disable select mode if collapsing the select-mode directory
          checkAutoDisableSelectMode(rel);
          
          // Track directory close for persistence
          markDirectoryOpen(rel, false);
        } else {
          // Expand: ask backend for this directory listing
          li.dataset.open = 'true';
          if (typeof window.__explorerBusSend === 'function') {
            notifyExplorer(EXPLORER_RPC_METHODS.list, { rel });
          }
          
          // Track directory open for persistence
          markDirectoryOpen(rel, true);
        }
        return;
      }
      if (kind === 'file') {
        // In select mode, clicking a file toggles its checkbox
        if (selectModeDir) {
          const checkbox = li.querySelector('.fe-entry-checkbox');
          if (checkbox) {
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) {
              selectedEntries.add(rel);
            } else {
              selectedEntries.delete(rel);
            }
          }
          return;
        }
        
        if (typeof window.appOpenFileRel === 'function') {
          window.appOpenFileRel(rel, uiState.projectPath || null);
          closeDrawerIfMobile();
        }
      }
    });
  }

  // Wire up the Explorer RPC notification hook consumed by main.js.
  window.__explorerScrollToActiveFile = scrollToActiveFile;

  window.__explorerHandleNotification = (method, payload) => {
    try {
      handleExplorerNotification(method, payload || {});
    } catch (err) {
      console.warn('[Explorer] dispatch error', method, err);
    }
  };

  // Called by main.js after the explorer Socket.IO transport reconnects.
  // We request a fresh root listing (which repopulates DOM nodes), then
  // re-expand our tracked open directories once the root snapshot arrives.
  window.__cm6ExplorerOnReconnect = () => {
    if (!hasExplorerRpc()) return;
    reconnectResyncPending = true;
    try {
      notifyExplorer(EXPLORER_RPC_METHODS.list, { rel: '.' });
      notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
    } catch (_) {}
  };

  // Host calls this when it wants to "refresh" the explorer.
  // For now, just ask the backend to refresh via the UI bus if available.
  window.__cm6RefreshExplorer = async () => {
    if (hasExplorerRpc()) {
      notifyExplorer(EXPLORER_RPC_METHODS.refresh, {});
    }
  };

  // Manual refresh button for "none" watcher mode
  const refreshBtn = document.getElementById('fe-watcher-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (hasExplorerRpc()) {
        notifyExplorer(EXPLORER_RPC_METHODS.list, { rel: '.' });
        notifyExplorer(EXPLORER_RPC_METHODS.gitStatusGet, {});
        openDirectories.forEach((rel) => {
          notifyExplorer(EXPLORER_RPC_METHODS.list, { rel });
        });
      }
    });
  }

  // Initial render placeholders until first snapshot arrives
  renderProjectLabel();
  if (treeElement) {
    const empty = document.createElement('li');
    empty.className = 'fe-tree-empty';
    empty.textContent = 'Waiting for project snapshot…';
    treeElement.appendChild(empty);
  }
}

// --- Unified file open + jump helper ---
async function openFileAndMaybeJump(rel, lineNumber = null, jumpOptions = {}) {
  if (!window.appOpenFileRel) {
    toast('File opener not available');
    return;
  }
  try {
    const alreadyOpen = rel && rel === activeFileRel;
    const hasLineTarget = typeof lineNumber === 'number' && lineNumber >= 1;
    const openOptions = {};
    if (hasLineTarget) {
      openOptions.line = lineNumber;
      if (Object.prototype.hasOwnProperty.call(jumpOptions || {}, 'focus')) {
        openOptions.focus = Boolean(jumpOptions.focus);
      }
      if (Object.prototype.hasOwnProperty.call(jumpOptions || {}, 'scrollToTop')) {
        openOptions.scrollToTop = Boolean(jumpOptions.scrollToTop);
      }
      if (typeof jumpOptions?.scrollY === 'string') {
        openOptions.scrollY = jumpOptions.scrollY;
      }
    }

    if (!alreadyOpen) {
      expandToFile(rel);
      await window.appOpenFileRel(rel, uiState.projectPath || null, openOptions);
    }

    closeDrawerIfMobile();

    if (alreadyOpen && hasLineTarget && window.jumpToCurrentFileLine) {
      await window.jumpToCurrentFileLine(lineNumber, jumpOptions);
    }
  } catch (err) {
    toast('Failed to open file: ' + (err?.message || 'unknown error'));
  }
}

// --- Search / Review overlay wiring ---

function openSearchOverlay() {
  explorerSearchController.openSearchOverlay();
}

function closeSearchOverlay() {
  explorerSearchController.closeSearchOverlay();
}

function clearSearchResults(preserveQuery = false) {
  explorerSearchController.clearSearchResults(preserveQuery);
}

function scheduleSearch(query) {
  explorerSearchController.scheduleSearch(query);
}

async function performSearch(query) {
  return explorerSearchController.performSearch(query);
}

async function fetchChangesResults(force = false) {
  return explorerSearchController.fetchChangesResults(force);
}

async function fetchReviewResults(force = false) {
  return explorerSearchController.fetchReviewResults(force);
}

function setSearchMode(mode) {
  explorerSearchController.setSearchMode(mode);
}

function renderSearchOverlay() {
  const overlay = document.getElementById('fe-search-overlay');
  if (!overlay) return;

  overlay.style.display = searchOverlayVisible ? 'flex' : 'none';
  if (!searchOverlayVisible) return;

  if (!overlay.hasChildNodes()) {
    const header = document.createElement('div');
    header.className = 'fe-search-header';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'fe-search-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = closeSearchOverlay;
    header.appendChild(closeBtn);

    const modeContainer = document.createElement('div');
    modeContainer.className = 'fe-search-mode';

    const modes = [
      { id: 'name', label: 'By name' },
      { id: 'content', label: 'By contents' },
      { id: 'changes', label: 'By changes' },
      { id: 'review', label: 'Review edits' },
      { id: 'diagnostics', label: 'Diagnostics' },
    ];

    modes.forEach((m) => {
      const btn = document.createElement('button');
      btn.textContent = m.label;
      btn.dataset.mode = m.id;
      btn.onclick = () => setSearchMode(m.id);
      if (m.id === searchMode) btn.classList.add('active');
      modeContainer.appendChild(btn);
    });

    header.appendChild(modeContainer);

    const inputContainer = document.createElement('div');
    inputContainer.className = 'fe-search-input-container';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'fe-search-input';
    input.placeholder =
      searchMode === 'name' ? 'Search files/folders...' : 'Search in files...';
    input.value = searchQuery;
    input.oninput = (e) => scheduleSearch(e.target.value);
    input.onkeydown = (e) => {
      if (e.key === 'Escape') closeSearchOverlay();
    };
    inputContainer.appendChild(input);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕';
    clearBtn.className = 'fe-search-clear';
    clearBtn.style.display = searchQuery ? 'block' : 'none';
    clearBtn.onclick = () => {
      searchQuery = '';
      searchResults = null;
      renderSearchOverlay();
    };
    inputContainer.appendChild(clearBtn);

    const changesToolbar = document.createElement('div');
    changesToolbar.className = 'fe-search-changes-toolbar';

    // Diff base selector (mirrors Git footer, backed by HistoryStore)
    const headLabel = document.createElement('span');
    headLabel.className = 'fe-search-changes-label';
    headLabel.textContent = 'Diff vs';
    changesToolbar.appendChild(headLabel);

    const headBtn = document.createElement('button');
    headBtn.type = 'button';
    headBtn.id = 'fe-search-base-btn';
    headBtn.className = 'fe-search-head-btn';
    headBtn.textContent = `${formatDiffBaseLabel(gitDiffBase, false)} ▾`;
    headBtn.disabled = gitDiffBase.mode === 'none';
    headBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!searchBaseDropdown) return;
      toggleDiffBaseMenu(headBtn, searchBaseDropdown);
    });
    changesToolbar.appendChild(headBtn);
    searchBaseBtn = headBtn;

    const headDropdown = document.createElement('div');
    headDropdown.id = 'fe-search-base-dd';
    headDropdown.className = 'fe-dropdown';
    changesToolbar.appendChild(headDropdown);
    searchBaseDropdown = headDropdown;

    // Filter Controls
    const filterContainer = document.createElement('div');
    filterContainer.className = 'fe-changes-filter-container';

    const filterLabel = document.createElement('label');
    filterLabel.className = 'fe-changes-filter-label';
    const filterCheck = document.createElement('input');
    filterCheck.type = 'checkbox';
    filterCheck.id = 'fe-changes-filter-active';
    filterLabel.appendChild(filterCheck);
    filterLabel.appendChild(document.createTextNode(' Filter'));

    const filenameLabel = document.createElement('label');
    filenameLabel.className = 'fe-changes-filter-label';
    const filenameCheck = document.createElement('input');
    filenameCheck.type = 'checkbox';
    filenameCheck.id = 'fe-changes-filter-filename';
    filenameCheck.disabled = true;
    filenameLabel.appendChild(filenameCheck);
    filenameLabel.appendChild(document.createTextNode(' Filename only'));

    const hunksLabel = document.createElement('label');
    hunksLabel.className = 'fe-changes-filter-label';
    const hunksCheck = document.createElement('input');
    hunksCheck.type = 'checkbox';
    hunksCheck.id = 'fe-changes-filter-hunks';
    hunksCheck.disabled = true;
    hunksLabel.appendChild(hunksCheck);
    hunksLabel.appendChild(document.createTextNode(' Hunks only'));

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.id = 'fe-changes-filter-input';
    filterInput.className = 'fe-changes-filter-input';
    filterInput.placeholder = 'Filter changes...';
    filterInput.style.display = 'none';

    filterCheck.addEventListener('change', () => {
      const active = filterCheck.checked;
      filenameCheck.disabled = !active;
      hunksCheck.disabled = !active;
      filterInput.style.display = active ? 'inline-block' : 'none';
      if (active) filterInput.focus();
      applyChangesFilter();
    });

    filenameCheck.addEventListener('change', () => {
      if (filenameCheck.checked) hunksCheck.checked = false;
      applyChangesFilter();
    });

    hunksCheck.addEventListener('change', () => {
      if (hunksCheck.checked) filenameCheck.checked = false;
      applyChangesFilter();
    });

    filterInput.addEventListener('input', applyChangesFilter);

    filterContainer.appendChild(filterLabel);
    filterContainer.appendChild(filenameLabel);
    filterContainer.appendChild(hunksLabel);
    filterContainer.appendChild(filterInput);

    changesToolbar.appendChild(filterContainer);

    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'fe-search-results';

    overlay.appendChild(header);
    overlay.appendChild(inputContainer);
    overlay.appendChild(changesToolbar);
    overlay.appendChild(resultsContainer);
  }

  const resultsContainer = overlay.querySelector('.fe-search-results');
  const input = overlay.querySelector('#fe-search-input');
  const clearBtn = overlay.querySelector('.fe-search-clear');
  const modeButtons = overlay.querySelectorAll('.fe-search-mode button');
  const filterContainer = overlay.querySelector('.fe-changes-filter-container');

  modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === searchMode);
  });

  if (input) {
    input.placeholder =
      searchMode === 'name' ? 'Search files/folders...' : 'Search in files...';
    input.value = searchQuery;
    input.style.display =
      searchMode === 'name' || searchMode === 'content' ? 'block' : 'none';
  }

  if (clearBtn) {
    clearBtn.style.display =
      searchQuery && (searchMode === 'name' || searchMode === 'content')
        ? 'block'
        : 'none';
  }

  if (filterContainer) {
    filterContainer.style.display = searchMode === 'changes' ? 'flex' : 'none';
  }

  const changesToolbar = overlay.querySelector('.fe-search-changes-toolbar');
  if (changesToolbar) {
    changesToolbar.style.display = searchMode === 'changes' ? 'flex' : 'none';
  }

  const headBtn = overlay.querySelector('#fe-search-base-btn');
  if (headBtn) {
    headBtn.textContent = `${formatDiffBaseLabel(gitDiffBase, false)} ▾`;
    headBtn.disabled = gitDiffBase.mode === 'none';
  }

  if (!resultsContainer) return;
  renderSearchOverlayBody(
    resultsContainer,
    { searchMode, searchLoading, searchError, searchResults },
    {
      renderNameResults: (container, data) =>
        renderNameResultsModule(container, data, {
          expandToFile,
          getProjectPath: () => uiState.projectPath,
          closeDrawerIfMobile,
          toast,
          closeSearchOverlay,
          expandToPath,
          applySetiIconToSpan,
          basename,
        }),
      renderContentResults: (container, data) =>
        renderContentResultsModule(container, data, {
          expandToFile,
          getProjectPath: () => uiState.projectPath,
          closeDrawerIfMobile,
          toast,
        }),
      renderChangesResults,
      renderReviewResults,
      renderDiagnosticsResults: (container) => {
        const proj = uiState.projectPath || '';
        const activeAbs = activeFileRel && proj
          ? proj + '/' + activeFileRel : null;
        renderExplorerDiagnostics(container, _explorerDiagDetail, {
          openFileAndMaybeJump,
          toast,
          mentionAgent: (payload) => {
            if (!hasExplorerRpc()) {
              throw new Error('Explorer RPC unavailable');
            }
            notifyExplorer(EXPLORER_RPC_METHODS.mentionAgent, payload);
          },
          getProjectPath: () => uiState.projectPath,
          activeFileAbs: activeAbs,
        });
      },
    },
  );
}

function renderChangesResults(container, data) {
  lastChangesContainer = container;
  lastChangesData = data || null;
  applyChangesFilter();
}

function applyChangesFilter() {
  if (!lastChangesContainer || !lastChangesData) return;

  const container = lastChangesContainer;
  const data = lastChangesData;

  const filterActive =
    document.getElementById('fe-changes-filter-active')?.checked;
  const filenameOnly =
    document.getElementById('fe-changes-filter-filename')?.checked;
  const hunksOnly =
    document.getElementById('fe-changes-filter-hunks')?.checked;
  const query = (
    document.getElementById('fe-changes-filter-input')?.value || ''
  ).toLowerCase();

  let entries = data.changes || [];

  if (filterActive && query) {
    entries = entries
      .map((change) => {
        const newChange = { ...change };
        const filenameMatch = change.rel.toLowerCase().includes(query);

        if (hunksOnly) {
          const matchingHunks = (change.hunks || []).filter((hunk) => {
            for (const line of hunk.lines || []) {
              if (line.text.toLowerCase().includes(query)) return true;
            }
            return false;
          });

          if (matchingHunks.length > 0) {
            newChange.hunks = matchingHunks;
            return newChange;
          }
          if (filenameMatch) {
            newChange.hunks = [];
            return newChange;
          }
          return null;
        }

        if (filenameMatch) return newChange;

        if (!filenameOnly) {
          const hunks = change.hunks || [];
          for (const hunk of hunks) {
            for (const line of hunk.lines || []) {
              if (line.text.toLowerCase().includes(query)) return newChange;
            }
          }
        }

        return null;
      })
      .filter(Boolean);
  }

  const wasOriginallyEmpty = (data.changes || []).length === 0;
  renderChangesList(
    container,
    { ...data, changes: entries, total: data.changes?.length },
    wasOriginallyEmpty,
    query,
  );
}

function renderChangesList(container, data, wasOriginallyEmpty, query) {
  container.innerHTML = '';
  if (!data) {
    container.innerHTML = '<div class="fe-search-empty">No changes loaded</div>';
    return;
  }

  if (data.git === false) {
    container.innerHTML =
      '<div class="fe-search-empty">Open a Git project to view changes.</div>';
    return;
  }

  const entries = data.changes || [];

  const baseInfo = data.base || gitDiffBase;
  if (baseInfo && baseInfo.mode !== 'none') {
    const note = document.createElement('div');
    note.className = 'fe-search-changes-note';
    note.style.margin = '4px 0 8px';
    const ref =
      (baseInfo.commit && baseInfo.commit.short) ||
      baseInfo.ref ||
      gitDiffBase.ref ||
      'HEAD';
    note.textContent = `Comparing against ${ref}`;
    container.appendChild(note);
  }

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'fe-search-empty';
    empty.textContent = wasOriginallyEmpty
      ? 'Working tree is clean.'
      : 'No matching changes found.';
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'fe-search-changes';

  entries.forEach((change) => {
    const group = document.createElement('div');
    group.className = 'fe-search-file-group fe-search-change-group';
    group.dataset.line = firstDiffLine(change) || 1;
    group.onclick = async (event) => {
      if (typeof window.__cm6EnsureInlineDiffs === 'function') {
        try {
          await window.__cm6EnsureInlineDiffs(true);
        } catch (err) {
          console.warn('Failed to auto-enable inline diffs:', err);
        }
      }
      const lineEl = event?.target?.closest('[data-line]');
      const lineFromTarget = lineEl ? Number(lineEl.dataset.line || 0) : 0;
      const fallbackLine =
        Number(event?.currentTarget?.dataset?.line || 0) || firstDiffLine(change);
      const line = lineFromTarget || fallbackLine;
      await openFileAndMaybeJump(change.rel, line || firstDiffLine(change), {
        focus: false,
      });
    };

    const header = document.createElement('div');
    header.className = 'fe-search-file-header fe-search-change-header';

    const title = document.createElement('span');
    title.className = 'fe-search-change-path';
    title.textContent = change.rel;
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'fe-search-change-meta';
    const statusText = document.createElement('span');
    statusText.className = 'fe-search-change-status-text';
    statusText.textContent = change.statusText || '';
    meta.appendChild(statusText);
    header.appendChild(meta);
    group.appendChild(header);

    if (change.hunks && change.hunks.length) {
      const hunksContainer = document.createElement('div');
      hunksContainer.className = 'fe-search-change-hunks';

      change.hunks.forEach((hunk) => {
        const hunkBlock = document.createElement('div');
        hunkBlock.className = 'fe-search-hunk';

        const hunkHeader = document.createElement('div');
        hunkHeader.className = 'fe-search-hunk-header';
        hunkHeader.textContent = formatHunkHeader(hunk);
        hunkHeader.dataset.line = Number(hunk.newStart || hunk.oldStart || 1);
        hunkBlock.appendChild(hunkHeader);

        const diffRows = document.createElement('div');
        diffRows.className = 'fe-search-diff-rows';

        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;

        hunk.lines.forEach((line) => {
          const row = document.createElement('div');
          row.className = 'fe-search-diff-row';
          row.dataset.line =
            line.type === 'add' || line.type === 'add-draft'
              ? newLine
              : line.type === 'del' || line.type === 'del-draft'
                ? oldLine
                : newLine || oldLine || 1;

          const lineNum = document.createElement('span');
          lineNum.className = 'fe-search-diff-line-num';

          const sign = document.createElement('span');
          sign.className = 'fe-search-diff-sign';

          const text = document.createElement('pre');
          text.className = 'fe-search-diff-text';
          text.textContent = line.text;

          if (line.type === 'add' || line.type === 'add-draft') {
            row.classList.add(line.type === 'add-draft' ? 'is-add-draft' : 'is-add');
            lineNum.textContent = newLine;
            sign.textContent = '+';
            newLine++;
          } else if (line.type === 'del' || line.type === 'del-draft') {
            row.classList.add(line.type === 'del-draft' ? 'is-del-draft' : 'is-del');
            lineNum.textContent = oldLine;
            sign.textContent = '-';
            oldLine++;
          } else {
            row.classList.add('is-context');
            lineNum.textContent = newLine || oldLine;
            sign.textContent = '';
            newLine++;
            oldLine++;
          }

          row.appendChild(lineNum);
          row.appendChild(sign);
          row.appendChild(text);
          diffRows.appendChild(row);
        });

        hunkBlock.appendChild(diffRows);
        hunksContainer.appendChild(hunkBlock);
      });

      group.appendChild(hunksContainer);
    }

    list.appendChild(group);
  });

  container.appendChild(list);
}

function renderReviewResults(container, data) {
  const entries = data.results || [];

  const toolbar = document.createElement('div');
  toolbar.className = 'fe-review-toolbar';

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = 'Refresh';
  refreshBtn.className = 'fe-btn fe-btn-sm';
  refreshBtn.onclick = () => fetchReviewResults(true);
  toolbar.appendChild(refreshBtn);

  // Select All / Clear Selection toggle button
  const selectAllBtn = document.createElement('button');
  selectAllBtn.className = 'fe-btn fe-btn-sm';
  selectAllBtn.style.marginLeft = '8px';
  const updateSelectAllLabel = () => {
    const allSelected = entries.length > 0 && entries.every(e => selectedReviewFiles.has(e.rel));
    selectAllBtn.textContent = allSelected ? 'Clear Selection' : 'Select All';
  };
  updateSelectAllLabel();
  selectAllBtn.onclick = () => {
    const allSelected = entries.length > 0 && entries.every(e => selectedReviewFiles.has(e.rel));
    if (allSelected) {
      // Clear all
      entries.forEach(e => selectedReviewFiles.delete(e.rel));
    } else {
      // Select all
      entries.forEach(e => selectedReviewFiles.add(e.rel));
    }
    // Update checkboxes
    container.querySelectorAll('.fe-review-checkbox').forEach(cb => {
      cb.checked = selectedReviewFiles.has(cb.dataset.rel);
    });
    updateSelectAllLabel();
  };
  toolbar.appendChild(selectAllBtn);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save Selected';
  saveBtn.className = 'fe-btn fe-btn-sm fe-btn-primary';
  saveBtn.style.marginLeft = '8px';
  saveBtn.onclick = async () => {
    const selected = Array.from(selectedReviewFiles);
    if (!selected.length) return toast('No files selected');

    if (!hasExplorerRpc()) {
      toast('Review bus unavailable');
      return;
    }

    try {
      notifyExplorer(EXPLORER_RPC_METHODS.reviewSave, { files: selected });
    } catch (e) {
      toast(e.message || 'Save failed');
    }
  };
  toolbar.appendChild(saveBtn);

  const discardBtn = document.createElement('button');
  discardBtn.textContent = 'Discard Selected';
  discardBtn.className = 'fe-btn fe-btn-sm fe-btn-danger';
  discardBtn.style.marginLeft = '8px';
  discardBtn.onclick = async () => {
    const selected = Array.from(selectedReviewFiles);
    if (!selected.length) return toast('No files selected');
    if (!window.confirm(`Discard drafts for ${selected.length} file(s)?`)) return;

    if (!hasExplorerRpc()) {
      toast('Review bus unavailable');
      return;
    }

    try {
      notifyExplorer(EXPLORER_RPC_METHODS.reviewDiscard, { files: selected });
    } catch (e) {
      toast(e.message || 'Discard failed');
    }
  };
  toolbar.appendChild(discardBtn);

  container.appendChild(toolbar);

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'fe-search-empty';
    empty.textContent = 'No pending draft edits.';
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'fe-review-list';

  entries.forEach((entry) => {
    const group = document.createElement('div');
    group.className =
      'fe-search-file-group fe-search-change-group fe-review-group';
    group.dataset.line = firstDiffLine(entry) || 1;
    group.onclick = async (event) => {
      if (event?.target?.closest('.fe-review-checkbox')) return;
      const lineEl = event?.target?.closest('[data-line]');
      const line = lineEl
        ? Number(lineEl.dataset.line || 0)
        : Number(event?.currentTarget?.dataset?.line || 0);
      if (typeof window.__cm6EnsureDraftDiffs === 'function') {
        try {
          await window.__cm6EnsureDraftDiffs(true);
        } catch {
          /* ignore */
        }
      }
      if (typeof window.__cm6EnsureInlineDiffs === 'function') {
        try {
          await window.__cm6EnsureInlineDiffs(true);
        } catch {
          /* ignore */
        }
      }
      await openFileAndMaybeJump(
        entry.rel,
        line || firstDiffLine(entry),
        { focus: false },
      );
    };

    const header = document.createElement('div');
    header.className = 'fe-search-file-header fe-search-change-header';
    header.style.cursor = 'default';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'fe-review-checkbox';
    check.value = entry.rel;
    check.dataset.rel = entry.rel;  // For Select All to update checkboxes
    if (!entry.has_draft) check.disabled = true;
    check.checked = selectedReviewFiles.has(entry.rel);
    check.onchange = (e) => {
      if (e.target.checked) selectedReviewFiles.add(entry.rel);
      else selectedReviewFiles.delete(entry.rel);
    };
    check.style.marginRight = '8px';
    header.appendChild(check);

    const title = document.createElement('span');
    title.className = 'fe-search-change-path';
    title.textContent = entry.rel;
    title.style.cursor = 'pointer';
    title.onclick = async () => {
      if (typeof window.__cm6EnsureDraftDiffs === 'function') {
        try {
          await window.__cm6EnsureDraftDiffs(true);
        } catch {
          /* ignore */
        }
      }
      if (typeof window.__cm6EnsureInlineDiffs === 'function') {
        try {
          await window.__cm6EnsureInlineDiffs(true);
        } catch {
          /* ignore */
        }
      }
      await openFileAndMaybeJump(entry.rel, firstDiffLine(entry), {
        focus: false,
      });
    };
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'fe-search-change-meta';

    if (entry.has_draft) {
      const badge = document.createElement('span');
      badge.className = 'fe-badge fe-badge-draft';
      badge.textContent = 'Draft';
      badge.style.background = '#facc15';
      badge.style.color = '#000';
      badge.style.padding = '2px 6px';
      badge.style.borderRadius = '4px';
      badge.style.fontSize = '0.75rem';
      meta.appendChild(badge);
    }

    header.appendChild(meta);
    group.appendChild(header);

    if (entry.hunks && entry.hunks.length) {
      const hunksContainer = document.createElement('div');
      hunksContainer.className = 'fe-search-change-hunks';

      entry.hunks.forEach((hunk) => {
        const hunkBlock = document.createElement('div');
        hunkBlock.className = 'fe-search-hunk';

        const hunkHeader = document.createElement('div');
        hunkHeader.className = 'fe-search-hunk-header';
        hunkHeader.textContent = formatHunkHeader(hunk);
        hunkHeader.dataset.line = Number(hunk.newStart || hunk.oldStart || 1);
        hunkBlock.appendChild(hunkHeader);

        const diffRows = document.createElement('div');
        diffRows.className = 'fe-search-diff-rows';

        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;

        hunk.lines.forEach((line) => {
          const row = document.createElement('div');
          row.className = 'fe-search-diff-row';
          row.dataset.line =
            line.type === 'add-draft'
              ? newLine
              : line.type === 'del-draft'
                ? oldLine
                : newLine || oldLine || 1;

          const lineNum = document.createElement('span');
          lineNum.className = 'fe-search-diff-line-num';

          const sign = document.createElement('span');
          sign.className = 'fe-search-diff-sign';

          const text = document.createElement('pre');
          text.className = 'fe-search-diff-text';
          text.textContent = line.text;

          if (line.type === 'add-draft') {
            row.classList.add('is-add-draft');
            lineNum.textContent = newLine;
            sign.textContent = '+';
            newLine++;
          } else if (line.type === 'del-draft') {
            row.classList.add('is-del-draft');
            lineNum.textContent = oldLine;
            sign.textContent = '-';
            oldLine++;
          } else {
            row.classList.add('is-context');
            lineNum.textContent = newLine || oldLine;
            sign.textContent = '';
            newLine++;
            oldLine++;
          }

          row.appendChild(lineNum);
          row.appendChild(sign);
          row.appendChild(text);
          diffRows.appendChild(row);
        });

        hunkBlock.appendChild(diffRows);
        hunksContainer.appendChild(hunkBlock);
      });

      group.appendChild(hunksContainer);
    }

    list.appendChild(group);
  });

  container.appendChild(list);
}
