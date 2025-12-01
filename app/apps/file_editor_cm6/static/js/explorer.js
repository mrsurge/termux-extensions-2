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

let treeElement = null;
let projectLabelEl = null;
let gitSummaryEl = null;
let gitBaseBtn = null;
let gitBaseDropdown = null;
let gitButtons = null;

const uiState = {
  projectPath: null,
  gitStatus: null,
  reviewEntries: [],
};

// --- Batch Select Mode state ---
let selectModeDir = null;           // rel of directory in select mode, or null
const selectedEntries = new Set();  // rel paths of checked items

// --- Search / Review overlay state ---
let searchOverlayVisible = false;
let searchMode = 'name'; // 'name' | 'content' | 'changes' | 'review'
let searchQuery = '';
let searchResults = null;
let searchLoading = false;
let searchError = null;
let searchDebounceTimer = null;
let lastKnownProjectPath = '';
const selectedReviewFiles = new Set();

// Minimal diff-base shell for changes note (no dropdown wiring yet)
let gitDiffBase = { ref: 'HEAD', mode: 'none', commit: null };
let searchBaseBtn = null;
let searchBaseDropdown = null;

/**
 * Format a hunk header in human-readable form.
 * @param {object} hunk - Hunk object with oldStart, oldLines, newStart, newLines
 * @returns {string} Human-readable line range description
 */
function formatHunkHeader(hunk) {
  const oldEnd = hunk.oldStart + hunk.oldLines - 1;
  const newEnd = hunk.newStart + hunk.newLines - 1;
  
  // For single-line changes
  if (hunk.newLines === 1) {
    return `Line ${hunk.newStart}`;
  }
  
  // For multi-line changes
  return `Lines ${hunk.newStart}–${newEnd}`;
}

function formatDiffBaseLabel(info, withPrefix = true) {
  if (!info || info.mode === 'none') {
    return withPrefix ? 'Status: (no git)' : 'No Git';
  }
  const commit = info.commit || null;
  const short = (commit && commit.short) || info.ref || 'HEAD';
  const summary =
    commit && commit.subject ? truncateText(commit.subject, 36) : '';
  const prefix = withPrefix ? 'Status: ' : '';
  return summary ? `${prefix}${short} · ${summary}` : `${prefix}${short}`;
}

function truncateText(text, limit = 40) {
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

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
    window.__explorerBusSend('git:setDiffBase', { ref });
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
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

function basename(path) {
  if (!path || path === '/') return '/';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '/';
}

function toast(message) {
  if (window.host && typeof window.host.toast === 'function') {
    window.host.toast(message);
  } else {
    console.log(message);
  }
}

function isMobileLayout() {
  const root = document.querySelector('.fe-root');
  return root?.classList.contains('layout-mobile') || false;
}

function closeDrawerIfMobile() {
  if (!isMobileLayout()) return;
  const root = document.querySelector('.fe-root');
  if (root) {
    root.classList.remove('drawer-open');
  }
}

// --- Batch Select Mode helpers ---

function isInSelectMode(parentRel) {
  return selectModeDir === parentRel;
}

function enableSelectMode(dirRel) {
  if (!dirRel) return;
  selectModeDir = dirRel;
  selectedEntries.clear();
  
  // Collapse any open subdirectories within this dir to keep UX clean
  collapseSubdirsOf(dirRel);
  
  // Re-render this directory's children to show checkboxes
  if (typeof window.__explorerBusSend === 'function') {
    window.__explorerBusSend('explorer:list', { rel: dirRel });
  }
}

function disableSelectMode() {
  const wasDir = selectModeDir;
  selectModeDir = null;
  selectedEntries.clear();
  
  // Re-render to remove checkboxes
  if (wasDir && typeof window.__explorerBusSend === 'function') {
    window.__explorerBusSend('explorer:list', { rel: wasDir });
  }
}

function collapseSubdirsOf(parentRel) {
  if (!treeElement) return;
  
  // Find the parent directory node
  const parentLi = treeElement.querySelector(
    `li.fe-tree-node[data-kind="dir"][data-rel="${parentRel}"]`
  );
  if (!parentLi) return;
  
  // Find all open subdirectories within it and collapse them
  const openSubdirs = parentLi.querySelectorAll(
    'li.fe-tree-node[data-kind="dir"][data-open="true"]'
  );
  openSubdirs.forEach((li) => {
    li.dataset.open = 'false';
    const childList = li.querySelector(':scope > ul.fe-tree');
    if (childList) childList.remove();
  });
}

function checkAutoDisableSelectMode(collapsedRel) {
  // If user collapses the directory that's in select mode, auto-disable
  if (selectModeDir && selectModeDir === collapsedRel) {
    selectModeDir = null;
    selectedEntries.clear();
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
      window.__explorerBusSend('explorer:list', { rel });
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
  if (!rel || rel === '.') return '.';
  const parts = rel.split('/').filter(Boolean);
  if (parts.length <= 1) return '.';
  return parts.slice(0, -1).join('/');
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
  if (!gitSummaryEl) return;
  const s = uiState.gitStatus;
  if (!s) {
    gitSummaryEl.textContent = 'Git status unavailable.';
    return;
  }
  const branch = s.branch || '(no branch)';
  const detached = !!s.detached;
  const ahead = s.ahead || 0;
  const behind = s.behind || 0;
  const stagedCount = Array.isArray(s.staged) ? s.staged.length : 0;
  const unstagedCount = Array.isArray(s.unstaged) ? s.unstaged.length : 0;
  const untrackedCount = Array.isArray(s.untracked)
    ? s.untracked.length
    : 0;

  const bits = [];
  bits.push(detached ? 'DETACHED HEAD' : branch);
  if (ahead) bits.push(`↑${ahead}`);
  if (behind) bits.push(`↓${behind}`);

  const counts = `staged ${stagedCount} · changes ${unstagedCount} · untracked ${untrackedCount}`;
  gitSummaryEl.textContent = `${bits.join(' ')} · ${counts}`;
}

function setGitControlsEnabled(enabled, showInit = false) {
  if (!gitButtons) return;
  Object.entries(gitButtons).forEach(([key, btn]) => {
    if (!btn) return;
    if (key === 'init') {
      // Init is only visible when we are in a non-git project.
      btn.style.display = showInit ? 'inline-block' : 'none';
      btn.disabled = !enabled;
    } else if (key === 'reset') {
      // Reset is only meaningful when regular git controls are active.
      const visible = enabled && !showInit;
      btn.style.display = visible ? 'inline-block' : 'none';
      btn.disabled = !visible;
    } else {
      // Regular git controls (stage/unstage/commit/push/pull)
      btn.style.display = showInit ? 'none' : 'inline-block';
      btn.disabled = !enabled || showInit;
    }
  });
}

// --- Git Progress Bar ---
// Ephemeral progress bar at top of git footer + progress text in status row

let gitProgressBarEl = null;
let gitProgressTextEl = null;

function ensureProgressBarElements() {
  // Progress bar: thin line at top of footer
  if (!gitProgressBarEl) {
    const footer = document.querySelector('.fe-git-footer');
    if (footer) {
      gitProgressBarEl = document.createElement('div');
      gitProgressBarEl.className = 'fe-git-progress-bar';
      gitProgressBarEl.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        height: 0;
        background: linear-gradient(90deg, #3b82f6, #60a5fa);
        transition: width 0.2s ease, height 0.15s ease;
        z-index: 10;
        pointer-events: none;
      `;
      footer.style.position = 'relative';
      footer.insertBefore(gitProgressBarEl, footer.firstChild);
    }
  }
  
  // Progress text: right-aligned in git summary row
  if (!gitProgressTextEl) {
    const summaryRow = document.querySelector('.fe-git-row.fe-git-meta');
    if (summaryRow) {
      gitProgressTextEl = document.createElement('span');
      gitProgressTextEl.className = 'fe-git-progress-text';
      gitProgressTextEl.style.cssText = `
        margin-left: auto;
        font-size: 0.8em;
        color: #60a5fa;
        white-space: nowrap;
        display: none;
      `;
      summaryRow.appendChild(gitProgressTextEl);
    }
  }
}

function showGitProgressBar(pct, detail) {
  ensureProgressBarElements();
  
  if (gitProgressBarEl) {
    gitProgressBarEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    gitProgressBarEl.style.height = '3px';
  }
  
  if (gitProgressTextEl) {
    gitProgressTextEl.style.display = 'inline';
    gitProgressTextEl.textContent = detail || `${pct}%`;
  }
}

function hideGitProgressBar() {
  if (gitProgressBarEl) {
    gitProgressBarEl.style.width = '0%';
    gitProgressBarEl.style.height = '0';
  }
  
  if (gitProgressTextEl) {
    gitProgressTextEl.style.display = 'none';
    gitProgressTextEl.textContent = '';
  }
}

function renderExplorerTree() {
  if (!treeElement) {
    treeElement = document.getElementById('fe-file-tree');
  }
  const el = treeElement;
  if (!el) return;

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
  clearElement(containerUl);

  // Determine parent rel from container if not provided
  if (parentRel === null) {
    const parentLi = containerUl.closest('li.fe-tree-node[data-kind="dir"]');
    parentRel = parentLi?.dataset?.rel || '.';
  }

  const inSelectMode = isInSelectMode(parentRel);
  
  // Toggle select mode class on the container
  containerUl.classList.toggle('fe-tree-select-mode', inSelectMode);

  const list = Array.isArray(entries) ? entries : [];
  for (const entry of list) {
    const li = document.createElement('li');
    li.className = 'fe-tree-node';
    li.dataset.kind = entry.kind || 'file';
    li.dataset.rel = entry.rel || entry.path || '';
    li.dataset.name = entry.name || '';

    if (entry.gitStatus) {
      li.dataset.gitStatus = entry.gitStatus;
      li.classList.add(`fe-git-${entry.gitStatus}`);
    }

    // Apply gitFlags for directories - these represent all descendant statuses
    const flags = entry.gitFlags || [];
    if (flags.length > 0) {
      li.dataset.gitFlags = flags.join(',');
      flags.forEach((flag) => {
        li.classList.add(`fe-dir-has-${flag}`);
      });
    }

    // Apply draft styling
    if (entry.hasDraft) {
      li.dataset.hasDraft = '1';
      if (entry.kind === 'file') {
        li.classList.add('fe-draft');
      } else {
        // Directory contains drafts
        li.classList.add('fe-dir-has-draft');
      }
    }

    // In select mode: show checkbox instead of menu button
    if (inSelectMode) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'fe-entry-checkbox';
      checkbox.dataset.rel = entry.rel || '';
      checkbox.checked = selectedEntries.has(entry.rel);
      checkbox.addEventListener('change', (ev) => {
        ev.stopPropagation();
        if (ev.target.checked) {
          selectedEntries.add(entry.rel);
        } else {
          selectedEntries.delete(entry.rel);
        }
      });
      li.appendChild(checkbox);
    }

    const iconSpan = document.createElement('span');
    iconSpan.className = `fe-entry-icon fe-entry-icon-${entry.kind || 'file'}`;

    const textSpan = document.createElement('span');
    textSpan.className = 'fe-tree-text';
    textSpan.textContent = entry.name || '';

    // Only show menu button when NOT in select mode
    if (!inSelectMode) {
      const menuButton = document.createElement('button');
      menuButton.className = 'fe-card-menu-btn';
      menuButton.textContent = '⋮';
      li.appendChild(iconSpan);
      li.appendChild(textSpan);
      li.appendChild(menuButton);
    } else {
      li.appendChild(iconSpan);
      li.appendChild(textSpan);
    }

    containerUl.appendChild(li);
  }

  // After entries are rendered, recompute aggregated git-status flags
  // (fe-dir-has-*) so parent directories can visually reflect dirty
  // descendants independently of the single gitStatus value.
  applyAggregatedGitStatusFlags();
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
    window.__explorerBusSend('explorer:list', { rel });
  });
  // After any git change + refreshed listings, recompute aggregated flags
  applyAggregatedGitStatusFlags();
}

function handleExplorerEvent(type, payload) {
  switch (type) {
    case 'project:setActive': {
      uiState.projectPath = payload.path || payload.projectPath || uiState.projectPath;
      renderProjectLabel();
      // When the active project changes, refresh diff base from backend
      // so both footer and overlay selectors stay in sync with HistoryStore.
      initDiffBaseFromBackend();
      break;
    }
    case 'explorer:setList': {
      // payload: { cwd, entries: [...] }
      const cwd = payload.cwd || '.';
      if (!treeElement) {
        treeElement = document.getElementById('fe-file-tree');
      }
      if (!treeElement) break;

      if (cwd === '.' || cwd === '') {
        // Root snapshot
        renderExplorerTree();
        const rootLi = treeElement.querySelector('li.fe-tree-node.fe-tree-root');
        if (!rootLi) break;
        let childList = rootLi.querySelector(':scope > ul.fe-tree');
        if (!childList) {
          childList = document.createElement('ul');
          childList.className = 'fe-tree';
          rootLi.appendChild(childList);
        }
        renderEntriesInto(childList, payload.entries);
      } else {
        // Directory listing for cwd
        const dirLi = treeElement.querySelector(
          `li.fe-tree-node[data-kind="dir"][data-rel="${cwd}"]`
        );
        if (!dirLi) break;
        
        // Only update if directory is already open (or being opened)
        const wasOpen = dirLi.dataset.open === 'true';
        let childList = dirLi.querySelector(':scope > ul.fe-tree');
        
        if (wasOpen || childList) {
          // Directory is open - update its contents
          if (!childList) {
            childList = document.createElement('ul');
            childList.className = 'fe-tree';
            dirLi.appendChild(childList);
          }
          dirLi.dataset.open = 'true';
          renderEntriesInto(childList, payload.entries);
        }
        // If directory was closed and has no childList, ignore the update
        // (it will be fetched when user opens it)
      }
      
      // Notify any pending expandToPath requests that this directory is ready
      _notifyDirListComplete(cwd);
      break;
    }
    case 'explorer:setTree': {
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
      break;
    }
    case 'explorer:updateDecorations': {
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
    case 'explorer:updateGitStatus': {
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
          // Remove git-related classes but NOT draft-related ones
          if (cls.startsWith('fe-git-') || 
              (cls.startsWith('fe-dir-has-') && !cls.includes('draft'))) {
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
        const li = root.querySelector(
          `li.fe-tree-node[data-rel="${rel}"]`
        );
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
        const li = root.querySelector(
          `li.fe-tree-node[data-kind="dir"][data-rel="${dirRel}"]`
        );
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
      break;
    }
    case 'project:opened': {
      // Backend confirms a project switch (open/create). Treat this as
      // authoritative and reload the page so the editor worker, history
      // store, and NiceGUI iframe all start from the new project.
      if (payload && payload.path) {
        uiState.projectPath = payload.path;
        renderProjectLabel();
      }
      try {
        window.location.reload();
      } catch {
        // If reload fails for some reason, at least request a full refresh.
        if (typeof window.__explorerBusSend === 'function') {
          window.__explorerBusSend('explorer:refresh', {});
        }
      }
      break;
    }
    case 'git:status': {
      console.log('[GIT_STATUS_DEBUG] Received:', payload);
      uiState.gitStatus = payload || null;
      renderGitSummary();
      // Any git status means we are in a real git repo: enable controls and hide Init.
      setGitControlsEnabled(true, false);
      break;
    }
    case 'git:diffBaseSet': {
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
    case 'git:restored': {
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
    case 'job:progress': {
      const { id, type, status, progress, message, error } = payload;
      console.log('[JOB_PROGRESS]', { id, type, status, progress, message });
      
      // Only handle git-related jobs
      if (!type || !type.startsWith('git_')) break;
      
      if (status === 'running') {
        // Show/update progress bar
        const pct = progress?.completed ?? 0;
        const detail = progress?.detail || message || '';
        showGitProgressBar(pct, detail);
      } else if (status === 'succeeded') {
        hideGitProgressBar();
        toast(message || `${type.replace('_', ' ')} completed`);
        // Refresh git status after push/pull completes
        if (type === 'git_pull' || type === 'git_push') {
          if (typeof window.__explorerBusSend === 'function') {
            window.__explorerBusSend('git:status', {});
            window.__explorerBusSend('explorer:refresh', {});
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
    case 'git:pushStarted':
    case 'git:pullStarted':
    case 'git:cloneStarted': {
      // Job started acknowledgement - show initial progress state
      console.log('[GIT_JOB_STARTED]', type, payload);
      showGitProgressBar(0, 'Starting...');
      break;
    }
    
    case 'search:setResults': {
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
    case 'review:setEntries': {
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
    default:
      break;
  }
}

export async function initExplorerUI() {
  const root = document.querySelector('.fe-root');
  const drawer = document.getElementById('fe-drawer');
  const drawerClose = document.getElementById('fe-drawer-close');
  const drawerOpenBtn = document.getElementById('fe-drawer-open');
  const drawerBackdrop = document.getElementById('fe-drawer-backdrop');
  const btnNewProject = document.getElementById('fe-new-project');
  const btnOpenProject = document.getElementById('fe-open-project');
  treeElement = document.getElementById('fe-file-tree');
  projectLabelEl = document.getElementById('fe-project-label');
  gitSummaryEl = document.getElementById('fe-git-summary');
  const searchBtn = document.getElementById('fe-search-btn');
  gitBaseBtn = document.getElementById('fe-git-base-btn');
  gitBaseDropdown = document.getElementById('fe-git-base-dd');

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
        setGitControlsEnabled(false, false);
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
        window.__explorerBusSend('project:open', { path: choice.path });
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
        // Clone repository then open as project via WS.
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

          toast('Cloning repository...');
          const resp = await fetch('/api/git/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: choice.url,
              target_path: result.path,
            }),
          });
          const json = await resp.json();
          if (!json || json.ok === false) {
            throw new Error(json?.detail || json?.error || 'Clone failed');
          }
          toast('Repository cloned successfully.');

          if (typeof window.__explorerBusSend !== 'function') {
            toast('Explorer connection unavailable.');
            return;
          }
          window.__explorerBusSend('project:open', { path: result.path });
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
          window.__explorerBusSend('project:create', {
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

  if (gitButtons) {
    const safeSend = (type, payload) => {
      if (typeof window.__explorerBusSend !== 'function') {
        toast('Explorer connection unavailable.');
        return false;
      }
      try {
        window.__explorerBusSend(type, payload || {});
      } catch (err) {
        toast(err?.message || 'Explorer command failed.');
        return false;
      }
      return true;
    };

    gitButtons.stage?.addEventListener('click', () => {
      safeSend('git:stageAll', {});
    });

    gitButtons.unstage?.addEventListener('click', () => {
      safeSend('git:unstageAll', {});
    });

    gitButtons.commit?.addEventListener('click', () => {
      const status = uiState.gitStatus;
      const stagedCount = Array.isArray(status?.staged)
        ? status.staged.length
        : 0;
      if (!stagedCount) {
        toast('No staged changes to commit.');
        return;
      }
      const message = window.prompt('Commit message');
      if (!message) return;
      const trimmed = message.trim();
      if (!trimmed) {
        toast('Commit message cannot be empty.');
        return;
      }
      safeSend('git:commit', { message: trimmed });
    });

    gitButtons.push?.addEventListener('click', () => {
      if (
        !window.confirm(
          'Are you sure you want to push changes to remote?',
        )
      ) {
        return;
      }
      safeSend('git:push', {});
    });

    gitButtons.pull?.addEventListener('click', () => {
      if (
        !window.confirm(
          'Are you sure you want to pull changes from remote?',
        )
      ) {
        return;
      }
      safeSend('git:pull', {});
    });

    gitButtons.reset?.addEventListener('click', () => {
      if (
        !window.confirm(
          '⚠️ Hard reset will discard ALL uncommitted changes!\n\nReset to HEAD?',
        )
      ) {
        return;
      }
      if (!safeSend('git:reset', { commit: 'HEAD' })) return;
      if (typeof window.__cm6ReloadCurrentFile === 'function') {
        try {
          window.__cm6ReloadCurrentFile();
        } catch (err) {
          console.warn('Failed to reload current file after reset:', err);
        }
      }
    });

    gitButtons.init?.addEventListener('click', () => {
      if (
        !window.confirm(
          'Initialize a Git repository in this project?',
        )
      ) {
        return;
      }
      safeSend('git:init', {});
    });
  }

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
              window.__explorerBusSend('explorer:createFile', {
                parent_rel: rel,
                name,
              });
            }
            break;
          }
          case 'createDir': {
            const name = window.prompt('New folder name:');
            if (!name) return;
            if (typeof window.__explorerBusSend === 'function') {
              window.__explorerBusSend('explorer:createDir', {
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
              window.__explorerBusSend('explorer:copy', {
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
              window.__explorerBusSend('explorer:move', {
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
              window.__explorerBusSend('explorer:copyFrom', {
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
              window.__explorerBusSend('explorer:moveFrom', {
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
              window.__explorerBusSend('explorer:rename', {
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
              window.__explorerBusSend('explorer:delete', { rel });
            }
            break;
          }
          case 'stage': {
            if (typeof window.__explorerBusSend !== 'function') {
              toast('Explorer connection unavailable.');
              break;
            }
            try {
              window.__explorerBusSend('git:stage', { paths: [rel] });
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
              window.__explorerBusSend('git:unstage', { paths: [rel] });
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
              window.__explorerBusSend('git:stage', { paths: [rel] });
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
              window.__explorerBusSend('git:unstage', { paths: [rel] });
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
              window.__explorerBusSend('git:restore', {
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
      window.__explorerBusSend('explorer:batchCopy', {
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
      window.__explorerBusSend('explorer:batchMove', {
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
    window.__explorerBusSend('git:stage', { paths });
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
    window.__explorerBusSend('git:unstage', { paths });
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
    window.__explorerBusSend('explorer:batchDelete', { rels: paths });
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

  // Basic click handling: expand/collapse dirs, open files, open context menu
  if (treeElement) {
    treeElement.addEventListener('click', (ev) => {
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
        } else {
          // Expand: ask backend for this directory listing
          li.dataset.open = 'true';
          if (typeof window.__explorerBusSend === 'function') {
            window.__explorerBusSend('explorer:list', { rel });
          }
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

  // Wire up global dispatch hook for the Socket.IO bus in main.js
  window.__explorerBusDispatch = (type, payload) => {
    try {
      handleExplorerEvent(type, payload || {});
    } catch (err) {
      console.warn('[Explorer] dispatch error', type, err);
    }
  };

  // Host calls this when it wants to "refresh" the explorer.
  // For now, just ask the backend to refresh via the UI bus if available.
  window.__cm6RefreshExplorer = async () => {
    if (typeof window.__explorerBusSend === 'function') {
      window.__explorerBusSend('explorer:refresh', {});
    }
  };

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
    // Expand tree to reveal the file in the background
    expandToFile(rel);
    
    await window.appOpenFileRel(rel, uiState.projectPath || null);
    closeDrawerIfMobile();

    if (typeof lineNumber === 'number' && window.jumpToCurrentFileLine) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await window.jumpToCurrentFileLine(lineNumber, jumpOptions);
    }
  } catch (err) {
    toast('Failed to open file: ' + (err?.message || 'unknown error'));
  }
}

// --- Search / Review overlay wiring ---

function openSearchOverlay() {
  if (!uiState.projectPath) {
    toast('No project open');
    return;
  }

  searchOverlayVisible = true;
  lastKnownProjectPath = uiState.projectPath || '';
  renderSearchOverlay();

  setTimeout(() => {
    if (searchMode === 'changes') {
      fetchChangesResults(true);
    } else if (searchMode === 'review') {
      fetchReviewResults(true);
    } else {
      const input = document.getElementById('fe-search-input');
      if (input) input.focus();
    }
  }, 0);
}

function closeSearchOverlay() {
  searchOverlayVisible = false;
  clearSearchResults();
  renderSearchOverlay();
}

function clearSearchResults(preserveQuery = false) {
  if (!preserveQuery) {
    searchQuery = '';
  }
  searchResults = null;
  searchError = null;
  searchLoading = false;
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
}

function scheduleSearch(query) {
  if (searchMode === 'changes' || searchMode === 'review') {
    return;
  }
  searchQuery = query;

  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  if (query.length < 2) {
    searchResults = null;
    renderSearchOverlay();
    return;
  }

  searchLoading = true;
  renderSearchOverlay();

  searchDebounceTimer = setTimeout(() => {
    performSearch(query);
  }, 300);
}

async function performSearch(query) {
  if (searchMode === 'changes' || searchMode === 'review') {
    return;
  }
  if (!uiState.projectPath) {
    searchError = 'No project open';
    searchLoading = false;
    renderSearchOverlay();
    return;
  }

  lastKnownProjectPath = uiState.projectPath || '';
  searchLoading = true;
  searchError = null;
  renderSearchOverlay();

  if (typeof window.__explorerBusSend !== 'function') {
    searchLoading = false;
    searchError = 'Search bus unavailable';
    renderSearchOverlay();
    return;
  }

  try {
    window.__explorerBusSend('search:run', {
      mode: searchMode,
      query,
    });
  } catch (err) {
    searchLoading = false;
    searchError = err?.message || 'Search request failed';
    renderSearchOverlay();
  }
}

async function fetchChangesResults(force = false) {
  if (searchMode !== 'changes') return;
  if (searchLoading && !force) return;

  if (!uiState.projectPath) {
    searchError = 'No project open';
    searchLoading = false;
    renderSearchOverlay();
    return;
  }

  lastKnownProjectPath = uiState.projectPath || '';
  searchLoading = true;
  searchError = null;
  renderSearchOverlay();

  if (typeof window.__explorerBusSend !== 'function') {
    searchLoading = false;
    searchError = 'Search bus unavailable';
    renderSearchOverlay();
    return;
  }

  try {
    window.__explorerBusSend('search:run', { mode: 'changes' });
  } catch (err) {
    searchLoading = false;
    searchError = err?.message || 'Changes lookup failed';
    renderSearchOverlay();
  }
}

async function fetchReviewResults(force = false) {
  if (searchMode !== 'review') return;
  if (searchLoading && !force) return;

  searchLoading = true;
  searchError = null;
  renderSearchOverlay();

  if (typeof window.__explorerBusSend !== 'function') {
    searchLoading = false;
    searchError = 'Review bus unavailable';
    renderSearchOverlay();
    return;
  }

  try {
    window.__explorerBusSend('review:list', { lightweight: false });
  } catch (err) {
    searchLoading = false;
    searchError = err?.message || 'Failed to load review list';
    renderSearchOverlay();
  }
}

function setSearchMode(mode) {
  if (mode === searchMode) {
    return;
  }

  clearSearchResults(true);
  searchMode = mode;

  if (mode === 'changes') {
    searchLoading = true;
    renderSearchOverlay();
    fetchChangesResults(true);
    return;
  }

  if (mode === 'review') {
    searchLoading = true;
    renderSearchOverlay();
    fetchReviewResults(true);
    return;
  }

  searchLoading = false;
  searchError = null;
  renderSearchOverlay();
  if (searchQuery.length >= 2) {
    performSearch(searchQuery);
  } else {
    setTimeout(() => {
      const input = document.getElementById('fe-search-input');
      if (input) input.focus();
    }, 0);
  }
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

  resultsContainer.innerHTML = '';

  if (searchLoading) {
    const loading = document.createElement('div');
    loading.className = 'fe-search-loading';
    loading.textContent =
      searchMode === 'changes'
        ? 'Loading changes…'
        : searchMode === 'review'
          ? 'Loading drafts…'
          : 'Searching…';
    resultsContainer.appendChild(loading);
    return;
  }

  if (searchError) {
    const error = document.createElement('div');
    error.className = 'fe-search-error';
    error.textContent = searchError;
    resultsContainer.appendChild(error);
    return;
  }

  if (!searchResults) {
    const hint = document.createElement('div');
    hint.className = 'fe-search-hint';
    if (searchMode === 'name') {
      hint.textContent = 'Type at least 2 characters to search by name.';
    } else if (searchMode === 'content') {
      hint.textContent = 'Type at least 2 characters to search within files.';
    } else if (searchMode === 'changes') {
      hint.textContent = 'View all changes in the working tree.';
    } else if (searchMode === 'review') {
      hint.textContent = 'Review unsaved draft edits across files.';
    }
    resultsContainer.appendChild(hint);
    return;
  }

  if (searchMode === 'name') {
    renderNameResults(resultsContainer, searchResults);
  } else if (searchMode === 'content') {
    renderContentResults(resultsContainer, searchResults);
  } else if (searchMode === 'changes') {
    renderChangesResults(resultsContainer, searchResults);
  } else if (searchMode === 'review') {
    renderReviewResults(resultsContainer, searchResults);
  }
}

function renderNameResults(container, data) {
  const results = data.results || [];
  const list = document.createElement('div');
  list.className = 'fe-search-list';

  results.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'fe-search-item';
    row.onclick = async () => {
      if (item.type === 'file') {
        if (window.appOpenFileRel) {
          try {
            // Expand tree to reveal the file
            expandToFile(item.rel);
            await window.appOpenFileRel(item.rel, uiState.projectPath || null);
            closeDrawerIfMobile();
          } catch (e) {
            toast('Failed to open file: ' + (e?.message || 'unknown error'));
          }
        } else {
          toast('File opener not available');
        }
      } else if (item.type === 'dir') {
        closeSearchOverlay();
        // Expand tree to reveal the directory
        expandToPath(item.rel);
      }
    };

    const icon = document.createElement('span');
    icon.className = 'fe-search-icon';
    icon.textContent = item.type === 'dir' ? '📁' : '📄';
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'fe-search-name';
    name.textContent = item.rel;
    row.appendChild(name);

    list.appendChild(row);
  });

  container.appendChild(list);

  if (data.truncated) {
    const notice = document.createElement('div');
    notice.className = 'fe-search-notice';
    notice.textContent = `Showing first ${data.count} results`;
    container.appendChild(notice);
  }
}

function renderContentResults(container, data) {
  const list = document.createElement('div');
  list.className = 'fe-search-list';

  (data.results || []).forEach((fileResult) => {
    const fileGroup = document.createElement('div');
    fileGroup.className = 'fe-search-file-group';

    const matches = fileResult.matches || [];

    const fileHeader = document.createElement('div');
    fileHeader.className = 'fe-search-file-header';
    fileHeader.textContent = `${fileResult.rel} (${matches.length})`;
    fileGroup.appendChild(fileHeader);

    matches.forEach((match) => {
      const matchRow = document.createElement('div');
      matchRow.className = 'fe-search-match';
      matchRow.onclick = async () => {
        if (window.appOpenFileRel && window.jumpToCurrentFileLine) {
          try {
            // Expand tree to reveal the file
            expandToFile(fileResult.rel);
            await window.appOpenFileRel(fileResult.rel, uiState.projectPath || null);

            closeDrawerIfMobile();

            await new Promise((resolve) => setTimeout(resolve, 100));
            await window.jumpToCurrentFileLine(match.line, { focus: false });
          } catch (e) {
            toast('Failed to open file: ' + (e?.message || 'unknown error'));
          }
        } else {
          toast('File opener not available');
        }
      };

      const lineNum = document.createElement('span');
      lineNum.className = 'fe-search-line-num';
      lineNum.textContent = match.line;
      matchRow.appendChild(lineNum);

      const snippet = document.createElement('span');
      snippet.className = 'fe-search-snippet';
      snippet.textContent = match.snippet;
      matchRow.appendChild(snippet);

      fileGroup.appendChild(matchRow);
    });

    list.appendChild(fileGroup);
  });

  container.appendChild(list);

  if (data.truncated) {
    const notice = document.createElement('div');
    notice.className = 'fe-search-notice';
    notice.textContent = `Showing ${data.file_count} files, ${data.match_count} matches`;
    container.appendChild(notice);
  }
}

function firstDiffLine(change) {
  const hunks = change?.hunks || [];
  for (const h of hunks) {
    if (typeof h?.newStart === 'number' && h.newStart > 0) {
      return h.newStart;
    }
    if (typeof h?.oldStart === 'number' && h.oldStart > 0) {
      return h.oldStart;
    }
  }
  return 1;
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

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save Selected';
  saveBtn.className = 'fe-btn fe-btn-sm fe-btn-primary';
  saveBtn.style.marginLeft = '8px';
  saveBtn.onclick = async () => {
    const selected = Array.from(selectedReviewFiles);
    if (!selected.length) return toast('No files selected');

    if (typeof window.__explorerBusSend !== 'function') {
      toast('Review bus unavailable');
      return;
    }

    try {
      window.__explorerBusSend('review:save', { files: selected });
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
    if (!window.confirm(`Discard drafts for ${selected.length} files?`)) return;

    if (typeof window.__explorerBusSend !== 'function') {
      toast('Review bus unavailable');
      return;
    }

    try {
      window.__explorerBusSend('review:discard', { files: selected });
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
