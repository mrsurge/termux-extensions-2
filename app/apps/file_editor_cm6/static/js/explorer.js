// app/apps/file_editor_cm6/static/js/explorer.js
// diff test... please ignore this comment
// explorer.js - File Explorer Drawer for CM6 Editor
let currentProjectPath = '';
let cachedState = null;
const expandedDirs = new Set();
let gitStatusCache = null;
let gitSummaryEl = null;
let gitButtons = null;
let treeElement = null;
let cardMenu = null;
let currentMenuButton = null;
let selectModeDir = null;
const selectedEntries = new Set();
let gitDiffBase = { ref: 'HEAD', mode: 'none', commit: null };
let gitBaseBtn = null;
let gitBaseDropdown = null;
let searchBaseBtn = null;
let searchBaseDropdown = null;

// Search overlay state
let searchOverlayVisible = false;
let searchMode = 'name'; // 'name' | 'content' | 'changes'
let searchQuery = '';
let searchResults = null;
let searchLoading = false;
let searchError = null;
let searchDebounceTimer = null;
let lastKnownProjectPath = '';

// Helper to check if we're in mobile layout
function isMobileLayout() {
  const root = document.querySelector('.fe-root');
  return root?.classList.contains('layout-mobile') || false;
}

// Helper to close drawer (mobile only)
function closeDrawerIfMobile() {
  if (isMobileLayout()) {
    const root = document.querySelector('.fe-root');
    root?.classList.remove('drawer-open');
  }
}

const GIT_STATUS_CLASS_MAP = {
  modified: 'fe-git-modified',
  staged: 'fe-git-staged',
  staged_modified: 'fe-git-staged-modified',
  added: 'fe-git-added',
  deleted: 'fe-git-deleted',
  renamed: 'fe-git-renamed',
  untracked: 'fe-git-untracked',
  ignored: 'fe-git-ignored',
  conflict: 'fe-git-conflict',
};

const FILE_KIND_CLASS = {
  dir: 'fe-entry-dir',
  exec: 'fe-entry-exec',
  file: 'fe-entry-file',
};

async function getEditorState(forceRefresh = false) {
  if (!forceRefresh && cachedState) return cachedState;
  if (typeof window.__cm6SyncState === 'function') {
    cachedState = await window.__cm6SyncState(forceRefresh);
    return cachedState;
  }
  try {
    const resp = await fetch('/api/app/file_editor_cm6/state', { cache: 'no-store' });
    const json = await resp.json();
    cachedState = json?.data || null;
    return cachedState;
  } catch (err) {
    console.error('Failed to fetch editor state:', err);
    cachedState = null;
    return null;
  }
}

function toast(message) {
  if (window.host && typeof window.host.toast === 'function') {
    window.host.toast(message);
  } else {
    alert(message);
  }
}

function truncateText(text, limit = 40) {
  if (!text) return '';
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1) + '…';
}

function formatDiffBaseLabel(info, withPrefix = true) {
  if (!info || info.mode === 'none') {
    return withPrefix ? 'Status: (no git)' : 'No Git';
  }
  const commit = info.commit || null;
  const short = commit?.short || info.ref || 'HEAD';
  const summary = commit?.subject ? truncateText(commit.subject, 36) : '';
  const prefix = withPrefix ? 'Status: ' : '';
  return summary ? `${prefix}${short} · ${summary}` : `${prefix}${short}`;
}

window.__cm6RefreshRecents = (state) => {
  if (state) {
    cachedState = state;
  }
  renderRecentMenu(state);
};

window.__cm6RefreshExplorer = async () => {
  if (treeElement && currentProjectPath) {
    await refreshTree(treeElement);
  }
};

export async function initExplorerUI() {
  const backdrop = document.getElementById('fe-backdrop');
  backdrop?.addEventListener('click', () => toggleDrawer(false));
  const btnOpenProject = document.getElementById('fe-open-project');
  const ddBtn = document.getElementById('recent-files-btn');
  const dd = document.getElementById('recent-files-dd');
  const root = document.querySelector('.fe-root');
  const drawerClose = document.getElementById('fe-drawer-close');
  const drawerOpenBtn = document.getElementById('fe-drawer-open');
  const drawerBackdrop = document.getElementById('fe-drawer-backdrop');
  const treeEl = document.getElementById('fe-file-tree');
  treeElement = treeEl;
  gitSummaryEl = document.getElementById('fe-git-summary');
  gitButtons = {
    stage: document.getElementById('fe-git-stage'),
    unstage: document.getElementById('fe-git-unstage'),
    commit: document.getElementById('fe-git-commit'),
    push: document.getElementById('fe-git-push'),
    pull: document.getElementById('fe-git-pull'),
    reset: document.getElementById('fe-git-reset'),
    init: document.getElementById('fe-git-init'),
  };
  gitBaseBtn = document.getElementById('fe-git-base-btn');
  gitBaseDropdown = document.getElementById('fe-git-base-dd');
  setGitControlsEnabled(false);

  if (gitBaseBtn && gitBaseDropdown) {
    gitBaseBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleDiffBaseMenu(gitBaseBtn, gitBaseDropdown);
    });
  }

  document.addEventListener('click', (ev) => {
    const inBaseButton = ev.target.closest('#fe-git-base-btn') || ev.target.closest('#fe-search-base-btn');
    const inBaseDropdown = ev.target.closest('#fe-git-base-dd') || ev.target.closest('#fe-search-base-dd');
    if (!inBaseButton && !inBaseDropdown) {
      closeDiffBaseMenus();
    }
  });

  const searchBtn = document.getElementById('fe-search-btn');
  if (searchBtn) {
    searchBtn.onclick = openSearchOverlay;
  }

  const state = await refreshCurrentProject(true);
  await renderRecentMenu(state);
  if (treeEl && state?.activeProjectExists) {
    await renderTreeRoot(treeEl);
    syncExpandedDirsFromTree(treeEl);
  }
  await refreshGitStatus(false);

  window.addEventListener('cm6:recents-updated', (ev) => {
    const detailState = ev?.detail;
    if (detailState) {
      cachedState = detailState;
    }
    renderRecentMenu(detailState || cachedState);
  });

  btnOpenProject?.addEventListener('click', openProjectPrompt);

  const btnNewProject = document.getElementById('fe-new-project');
  btnNewProject?.addEventListener('click', openNewProjectPrompt);

  if (gitButtons) {
    gitButtons.stage?.addEventListener('click', () => handleGitAction('/git/stage_all', {}));
    gitButtons.unstage?.addEventListener('click', () => handleGitAction('/git/unstage_all', {}));
    gitButtons.commit?.addEventListener('click', async () => {
      if (!gitStatusCache || !gitStatusCache.staged?.length) {
        toast('No staged changes to commit.');
        return;
      }
      const message = prompt('Commit message');
      if (!message) return;
      const trimmed = message.trim();
      if (!trimmed) {
        toast('Commit message cannot be empty.');
        return;
      }
      await handleGitAction('/git/commit', { message: trimmed });
    });
    gitButtons.push?.addEventListener('click', () => handleGitAction('/git/push', {}));
    gitButtons.pull?.addEventListener('click', () => handleGitAction('/git/pull', {}));
    gitButtons.reset?.addEventListener('click', async () => {
        try {
          const resp = await fetch('/api/app/file_editor_cm6/git/commits');
          const json = await resp.json();
          if (!json.ok) throw new Error(json.error || 'Failed to fetch commits');
          
          const commits = json.data;
          if (!commits.length) {
            toast('No commits found');
            return;
          }
          
          const commitList = commits.slice(0, 5).map(c => `${c.short_hash}: ${c.summary}`).join('\n');
          const confirmed = confirm(
            `⚠️ DANGER: Hard reset will discard ALL uncommitted changes!\n\n` +
            `Recent commits:\n${commitList}\n\n` +
            `Reset to HEAD?`
          );
          if (!confirmed) return;
          
          const resetResp = await fetch('/api/app/file_editor_cm6/git/reset_hard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commit: 'HEAD' })
          });
          const resetJson = await resetResp.json();
          if (!resetJson.ok) throw new Error(resetJson.error || 'Reset failed');
          
          gitStatusCache = resetJson.data;
          renderGitSummary(resetJson.data);
          toast('Repository reset to HEAD');
          await refreshTree(treeElement);
          
          if (typeof window.__cm6ReloadCurrentFile === 'function') {
            await window.__cm6ReloadCurrentFile();
          }
        } catch (err) {
          toast(err.message || 'Reset failed');
        }
    });
    gitButtons.init?.addEventListener('click', async () => {
        const confirmed = confirm('Initialize Git repository in this project?');
        if (!confirmed) return;
        
        try {
          const resp = await fetch('/api/app/file_editor_cm6/git/init', { method: 'POST' });
          const json = await resp.json();
          if (!json.ok) throw new Error(json.error || 'Init failed');
          
          toast('Git repository initialized');
          await refreshGitStatus(false);
          await refreshTree(treeElement);
        } catch (err) {
          toast(err.message || 'Git init failed');
        }
    });
  }

  // Toggle drawer function matching old IDE
  async function toggleDrawer(open) {
    if (!root) {
      return;
    }
    if (open === undefined) {
      const willOpen = !root.classList.contains('drawer-open');
      root.classList.toggle('drawer-open');
      if (willOpen && treeEl) {
        await refreshTree(treeEl);
      }
    } else if (open) {
      const openingNow = !root.classList.contains('drawer-open');
      root.classList.add('drawer-open');
      if (openingNow && treeEl) {
        await refreshTree(treeEl);
      }
    } else {
      root.classList.remove('drawer-open');
    }
  }

  // Close drawer
  drawerClose?.addEventListener('click', () => toggleDrawer(false));
  drawerBackdrop?.addEventListener('click', () => toggleDrawer(false));

  // Open drawer
  drawerOpenBtn?.addEventListener('click', () => toggleDrawer(true));

  treeEl?.addEventListener('click', onTreeClick);

  cardMenu = document.createElement('div');
  cardMenu.className = 'fe-card-menu';
  document.body.appendChild(cardMenu);

  document.addEventListener('click', (ev) => {
    // If clicking menu itself, do nothing
    if (ev.target.closest('.fe-card-menu')) {
      return;
    }

    // If clicking menu button, let that button's handler deal with it
    if (ev.target.closest('.fe-card-menu-btn')) {
      return;
    }

    // Any other click: close menu without affecting that click
    if (cardMenu.classList.contains('show')) {
      cardMenu.classList.remove('show');
      currentMenuButton = null;
    }
  }, false); // Use bubble phase, not capture
}

function basename(path) {
  if (!path || path === '/') return '/';
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || '/';
}

async function refreshCurrentProject(forceRefresh = false) {
  const state = await getEditorState(forceRefresh);
  const label = document.getElementById('fe-project-label');

  currentProjectPath = state?.activeProjectExists ? state.activeProject : '';
  applyGitDiffBaseFromState(state?.gitDiffBase || null);

  if (!currentProjectPath) {
    gitStatusCache = null;
    renderGitSummary(null, 'Select a project to enable git actions.');
    setGitControlsEnabled(false);
  }

  if (label) {
    if (state?.activeProject) {
      const display = state.activeProjectExists
        ? (state.activeProjectLabel || basename(state.activeProject))
        : `${state.activeProjectLabel || basename(state.activeProject)} (missing)`;
      label.textContent = display;
      label.title = state.activeProject;
      label.classList.toggle('fe-label-missing', !state.activeProjectExists);
    } else {
      label.textContent = '(none)';
      label.title = '';
      label.classList.remove('fe-label-missing');
    }
  }

  return state;
}

function setGitControlsEnabled(enabled, showInit = false) {
  if (!gitButtons) return;
  const allowActions = gitDiffBase.mode === 'head';
  const effectiveEnabled = enabled && allowActions;

  if (gitButtons.init) {
    gitButtons.init.style.display = showInit ? 'inline-block' : 'none';
    gitButtons.init.disabled = !enabled;
  }

  Object.entries(gitButtons).forEach(([key, btn]) => {
    if (!btn || key === 'init') return;
    const visible = !showInit && allowActions;
    btn.style.display = visible ? 'inline-block' : 'none';
    btn.disabled = !effectiveEnabled;
  });

  updateGitActionsVisibility();
}

function updateGitActionsVisibility() {
  const actionsRow = document.querySelector('.fe-git-actions');
  if (!actionsRow) return;
  const showInit = gitButtons?.init && gitButtons.init.style.display !== 'none';
  const hideRow = (gitDiffBase.mode !== 'head') && !showInit;
  actionsRow.classList.toggle('detached', hideRow);
}

function applyGitDiffBaseFromState(payload) {
  const fallback = { ref: 'HEAD', mode: 'none', commit: null };
  if (payload && typeof payload === 'object') {
    gitDiffBase = {
      ...fallback,
      ...payload,
      commit: payload.commit || null,
    };
    if (!gitDiffBase.ref) gitDiffBase.ref = 'HEAD';
  } else {
    gitDiffBase = fallback;
  }
  updateDiffBaseButtons();
  updateGitActionsVisibility();
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

function closeDiffBaseMenus(except) {
  [gitBaseDropdown, searchBaseDropdown].forEach((dropdown) => {
    if (!dropdown) return;
    if (dropdown !== except) {
      dropdown.classList.remove('show');
    }
  });
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
    options.push({ ref: c.hash, short: c.short_hash, summary: c.summary });
  });

  const currentHash = (gitDiffBase.commit && gitDiffBase.commit.hash) || null;
  const currentRef = gitDiffBase.ref || 'HEAD';
  const hasCurrent = options.some((opt) => opt.ref === currentHash || opt.ref === currentRef);
  if (!hasCurrent && gitDiffBase.commit) {
    options.unshift({ ref: gitDiffBase.commit.hash, short: gitDiffBase.commit.short, summary: gitDiffBase.commit.subject });
  }

  options.forEach((opt) => {
    const item = document.createElement('div');
    item.className = 'fe-dd-item';
    const isCurrent = (opt.ref === 'HEAD' && currentRef === 'HEAD') || (opt.ref !== 'HEAD' && (opt.ref === currentRef || opt.ref === currentHash));
    if (isCurrent) {
      item.classList.add('fe-menu-item-checked');
    }
    item.textContent = `${opt.short || opt.ref} · ${truncateText(opt.summary || '', 40)}`;
    item.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      closeDiffBaseMenus();
      if (!isCurrent) {
        await changeDiffBase(opt.ref);
      }
    });
    dropdown.appendChild(item);
  });
}

async function changeDiffBase(ref) {
  try {
    const resp = await gitRequest('/git/diff_base', {
      method: 'POST',
      body: JSON.stringify({ ref })
    });
    applyGitDiffBaseFromState(resp);
    await refreshGitStatus(false);
    if (treeElement) {
      await refreshTree(treeElement);
    }
    if (typeof window.__cm6ReloadCurrentFile === 'function') {
      await window.__cm6ReloadCurrentFile();
    }
    if (searchMode === 'changes') {
      await fetchChangesResults(true);
    }
  } catch (err) {
    toast(err.message || 'Failed to update status base');
  }
}

async function toggleDiffBaseMenu(button, dropdown) {
  if (!button || !dropdown || button.disabled) return;
  const isOpen = dropdown.classList.contains('show');
  closeDiffBaseMenus(dropdown);
  if (isOpen) {
    dropdown.classList.remove('show');
    return;
  }
  dropdown.innerHTML = '<div class="fe-dd-item" style="opacity:0.6">Loading…</div>';
  dropdown.classList.add('show');
  if (gitDiffBase.mode === 'none') {
    renderDiffBaseDropdown(dropdown, []);
    return;
  }
  try {
    const commits = await gitRequest('/git/commits');
    renderDiffBaseDropdown(dropdown, commits);
  } catch (err) {
    dropdown.innerHTML = `<div class="fe-dd-item" style="opacity:0.7">${err.message || 'Failed to load commits'}</div>`;
  }
}

function renderGitSummary(status, message) {
  if (!gitSummaryEl) return;
  if (!status) {
    gitSummaryEl.textContent = message || 'Git status unavailable.';
    return;
  }

  if (gitDiffBase.mode === 'detached') {
    const description = gitDiffBase.commit?.subject
      ? `${gitDiffBase.commit.short} · ${truncateText(gitDiffBase.commit.subject, 40)}`
      : gitDiffBase.ref || 'HEAD';
    gitSummaryEl.textContent = `Viewing ${description}. Git actions disabled.`;
    return;
  }

  const { branch, detached, ahead, behind } = status;
  const stagedCount = Array.isArray(status.staged) ? status.staged.length : 0;
  const unstagedCount = Array.isArray(status.unstaged) ? status.unstaged.length : 0;
  const untrackedCount = Array.isArray(status.untracked) ? status.untracked.length : 0;
  const bits = [];
  bits.push(detached ? 'DETACHED HEAD' : branch || '(no branch)');
  if (ahead) bits.push(`↑${ahead}`);
  if (behind) bits.push(`↓${behind}`);
  const counts = `staged ${stagedCount} · changes ${unstagedCount} · untracked ${untrackedCount}`;
  gitSummaryEl.textContent = `${bits.join(' ')} · ${counts}`;
}

async function refreshGitStatus(showToast = true) {
  if (!currentProjectPath) return;
  try {
    const isRepoData = await gitRequest('/git/is_repo');
    if (!isRepoData.is_repo) {
        gitStatusCache = null;
        renderGitSummary(null, 'Not a git repository.');
        setGitControlsEnabled(false, true);
        return;
    }

    const data = await gitRequest('/git/status');
    gitStatusCache = data;
    renderGitSummary(data);
    setGitControlsEnabled(true);
  } catch (err) {
    gitStatusCache = null;
    renderGitSummary(null, err.message);
    setGitControlsEnabled(false);
    if (showToast) toast(err.message || 'Git status unavailable');
  }
}

async function handleGitAction(endpoint, payload) {
  if (!currentProjectPath) {
    toast('Select a project first.');
    return;
  }
  try {
    setGitControlsEnabled(false);
    const data = await gitRequest(endpoint, payload);
    gitStatusCache = data;
    renderGitSummary(data);
    if (treeElement) {
      await refreshTree(treeElement);
    }
    
    // After commit: reload current file (HEAD changed, diff baseline stale)
    if (endpoint === '/git/commit' && typeof window.__cm6ReloadCurrentFile === 'function') {
      await window.__cm6ReloadCurrentFile();
    }
    
    // After push: reload file AND close drawer (push is usually final git action)
    if (endpoint === '/git/push' && typeof window.__cm6ReloadCurrentFile === 'function') {
      await window.__cm6ReloadCurrentFile();
      // Close drawer to show the updated file
      const root = document.querySelector('.fe-root');
      if (root) {
        root.classList.remove('drawer-open');
      }
    }
    
    return;
  } catch (err) {
    toast(err.message || 'Git action failed');
  } finally {
    setGitControlsEnabled(true);
  }
}

async function gitRequest(path, body) {
  const resp = await fetch(`/api/app/file_editor_cm6${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json().catch(() => null);
  if (!json || json.ok === false) {
    throw new Error(json?.error || resp.statusText || 'Git request failed');
  }
  return json.data || {};
}

async function openProjectPrompt() {
  // 1. Verify the shared picker is available
  if (!window.teFilePicker) {
    alert('File picker is not available.');
    return;
  }

  try {
    // 2. Launch the directory picker modal
    const choice = await window.teFilePicker.openDirectory({
      title: 'Open Project Directory',
      selectLabel: 'Set as Project'
    });

    // 3. Send the valid, absolute path to the backend
    const r = await fetch('/api/app/file_editor_cm6/project/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: choice.path })
    });
    const j = await r.json();

    // 4. Reload the page on success
    if (j?.ok) {
      location.reload();
    } else {
      alert(`Failed to open project: ${j?.error || 'Unknown error'}`);
    }
  } catch (e) {
    // 5. Gracefully handle cancellation (picker promise rejects on cancel)
    if (e && e.message !== 'cancelled') {
      alert(`An error occurred: ${e.message}`);
    }
    // If the error is 'cancelled', we do nothing.
  }
}

async function openNewProjectPrompt() {
    if (!confirm("This will create a new directory for your project. Continue?")) {
        return;
    }

    if (!window.teFilePicker) {
        toast('File picker not available.');
        return;
    }

    try {
        // Use saveFile mode which includes a filename input
        const result = await window.teFilePicker.saveFile({
            title: 'Create New Project',
            filename: 'my-project',  // Default suggestion
            selectLabel: 'Create Project'
        });

        // result.directory is the parent path
        // result.path is the full path (parent + filename)
        // result.existed tells us if it already exists

        if (result.existed) {
            if (!confirm(`Directory "${result.path}" already exists. Use it anyway?`)) {
                return;
            }
        }

        const r = await fetch('/api/app/file_editor_cm6/project/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                parent_path: result.directory,  // Parent directory
                name: result.name               // Folder name from the input
            })
        });
        const j = await r.json();
        if (j?.ok) {
            location.reload();
        } else {
            alert(`Failed to create project: ${j?.error || 'Unknown error'}`);
        }
    } catch (e) {
        if (e && e.message !== 'cancelled') {
            alert(`An error occurred: ${e.message}`);
        }
    }
}

async function renderRecentMenu(state) {
  const dd = document.getElementById('recent-files-dd');
  const ddBtn = document.getElementById('recent-files-btn');

  if (!dd || !ddBtn) return;

  dd.innerHTML = '';

  try {
    const s = state || await getEditorState(false);
    cachedState = s;
    const allFiles = s?.recents || [];
    
    // Filter out currently open file
    const currentPath = window.currentPath || '';
    const files = allFiles.filter(entry => entry.path !== currentPath);

    if (files.length === 0) {
      ddBtn.disabled = true;
      const emptyItem = document.createElement('div');
      emptyItem.className = 'fe-dd-item';
      emptyItem.textContent = currentPath ? 'No other recent files' : 'No recent files';
      emptyItem.style.opacity = '0.5';
      dd.appendChild(emptyItem);
      return;
    }

    ddBtn.disabled = false;

    // Files are already sorted by most recent first from backend
    files.forEach(entry => {
      const div = document.createElement('div');
      div.className = 'fe-dd-item';
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.style.alignItems = 'center';

      const span = document.createElement('span');
      span.textContent = entry.exists ? (entry.label || entry.path) : `${entry.label || entry.path} (missing)`;
      span.title = entry.path;
      span.style.flex = '1';
      span.style.cursor = 'pointer';
      if (!entry.exists) {
        span.classList.add('fe-dd-item-missing');
      }

      const x = document.createElement('button');
      x.textContent = '×';
      x.className = 'fe-btn';
      x.style.marginLeft = '8px';
      x.style.padding = '2px 6px';

      span.addEventListener('click', () => {
        dd.classList.remove('show');
        if (!entry.exists) {
          toast(`File "${entry.label}" not found.`);
          return;
        }
        openFile(entry.path);
      });

      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeRecent(entry.path);
        div.remove();
      });

      div.appendChild(span);
      div.appendChild(x);
      dd.appendChild(div);
    });
    
    // Add separator and "Clear All" button
    const separator = document.createElement('div');
    separator.style.borderTop = '1px solid var(--border, #333)';
    separator.style.margin = '4px 0';
    dd.appendChild(separator);
    
    const clearAllDiv = document.createElement('div');
    clearAllDiv.className = 'fe-dd-item';
    clearAllDiv.textContent = 'Clear All';
    clearAllDiv.style.color = 'var(--destructive, #ef4444)';
    clearAllDiv.style.cursor = 'pointer';
    clearAllDiv.style.textAlign = 'center';
    
    clearAllDiv.addEventListener('click', async () => {
      if (!confirm('Clear all recent files?')) return;
      await clearAllRecents();
      dd.classList.remove('show');
    });
    
    dd.appendChild(clearAllDiv);
    
  } catch (e) {
    console.error('Failed to render recent menu:', e);
  }
}

async function removeRecent(path) {
  try {
    const u = new URL('/api/app/file_editor_cm6/history/file', location.href);
    u.searchParams.set('path', path);
    await fetch(u, { method: 'DELETE' });
    const updatedState = await getEditorState(true);
    renderRecentMenu(updatedState);
    window.dispatchEvent(new CustomEvent('cm6:recents-updated', { detail: updatedState }));
  } catch (e) {
    console.error('Failed to remove recent file:', e);
  }
}

async function clearAllRecents() {
  try {
    const resp = await fetch('/api/app/file_editor_cm6/history/files/all', { method: 'DELETE' });
    const json = await resp.json();
    if (json.ok) {
      const updatedState = await getEditorState(true);
      renderRecentMenu(updatedState);
      window.dispatchEvent(new CustomEvent('cm6:recents-updated', { detail: updatedState }));
      toast('All recent files cleared');
    } else {
      toast(`Failed to clear recents: ${json.error}`);
    }
  } catch (e) {
    console.error('Failed to clear all recents:', e);
    toast('Failed to clear recents');
  }
}

async function renderTreeRoot(treeEl) {
  treeEl.replaceChildren();
  if (!currentProjectPath) {
    const empty = document.createElement('li');
    empty.className = 'fe-tree-empty';
    empty.textContent = 'Select a project to load the explorer.';
    treeEl.appendChild(empty);
    return;
  }

  const rootLi = document.createElement('li');
  rootLi.className = 'fe-tree-node fe-tree-root';
  rootLi.dataset.kind = 'dir';
  rootLi.dataset.rel = '.';
  rootLi.dataset.open = 'true';

  const twisty = document.createElement('button');
  twisty.className = 'fe-tree-twisty';
  twisty.textContent = '▾';

  const icon = document.createElement('span');
  icon.className = 'fe-entry-icon fe-entry-icon-dir';

  const text = document.createElement('span');
  text.className = 'fe-tree-text';
  text.textContent = basename(currentProjectPath) || 'Project';

  const menuBtn = document.createElement('button');
  menuBtn.className = 'fe-card-menu-btn';
  menuBtn.textContent = '⋮';
  const rootEntry = { rel: '.', name: basename(currentProjectPath) || 'Project', kind: 'dir' };
  menuBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    showCardMenu(rootEntry, menuBtn);
  });

  const childList = document.createElement('ul');
  childList.className = 'fe-tree';

  rootLi.appendChild(twisty);
  rootLi.appendChild(icon);
  rootLi.appendChild(text);
  rootLi.appendChild(menuBtn);
  rootLi.appendChild(childList);
  treeEl.appendChild(rootLi);

  await addTreeChildren(childList, '.');
}

async function addTreeChildren(parentEl, rel) {
  try {
    const u = new URL('/api/app/file_editor_cm6/explorer/list', location.href);
    u.searchParams.set('rel', rel);
    const r = await fetch(u);
    const j = await r.json();

    if (!j?.ok) {
      console.error('Failed to list directory:', j?.error);
      return;
    }

    const entries = j?.data?.entries || [];
    const parentIsInSelectMode = isInSelectMode(rel);

    if (parentEl.parentElement?.classList.contains('fe-tree-root')) {
        parentEl.parentElement.classList.toggle('fe-tree-select-mode', parentIsInSelectMode);
    } else {
        parentEl.classList.toggle('fe-tree-select-mode', parentIsInSelectMode);
    }

    entries.forEach(e => {
      const li = document.createElement('li');
      li.className = 'fe-tree-node';
      li.dataset.kind = e.kind;
      li.dataset.rel = e.rel;
      li.dataset.name = e.name;
      li.dataset.open = 'false';
      if (e.gitStatus) {
        li.dataset.gitStatus = e.gitStatus;
        const statusClass = GIT_STATUS_CLASS_MAP[e.gitStatus];
        if (statusClass) {
          li.classList.add(statusClass);
        }
      }

      if (parentIsInSelectMode) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'fe-entry-checkbox';
        checkbox.dataset.rel = e.rel;
        checkbox.checked = selectedEntries.has(e.rel);
        checkbox.addEventListener('change', (ev) => {
          ev.stopPropagation();
          if (ev.target.checked) {
            selectedEntries.add(e.rel);
          } else {
            selectedEntries.delete(e.rel);
          }
        });
        li.appendChild(checkbox);
      }

      const twisty = document.createElement('button');
      twisty.className = 'fe-tree-twisty';
      twisty.textContent = e.kind === 'dir' ? '▸' : '';
      twisty.style.visibility = e.kind === 'dir' ? 'visible' : 'hidden';

      const icon = document.createElement('span');
      icon.className = `fe-entry-icon fe-entry-icon-${e.kind}`;

      const text = document.createElement('span');
      text.className = 'fe-tree-text';
      text.textContent = e.name;
      applyEntryStyling(text, e);

      const menuBtn = document.createElement('button');
      menuBtn.className = 'fe-card-menu-btn';
      menuBtn.textContent = '⋮';
      menuBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showCardMenu(e, menuBtn);
      });
      if (parentIsInSelectMode) {
        menuBtn.style.display = 'none';
      }

      li.appendChild(twisty);
      li.appendChild(icon);
      li.appendChild(text);
      li.appendChild(menuBtn);
      parentEl.appendChild(li);
    });
  } catch (e) {
    console.error('Failed to add tree children:', e);
  }
}

async function refreshTree(treeEl) {
  syncExpandedDirsFromTree(treeEl);
  await renderTreeRoot(treeEl);
  await restoreExpandedDirs(treeEl);
  await refreshGitStatus(false);
}

function syncExpandedDirsFromTree(treeEl) {
  expandedDirs.clear();
  treeEl?.querySelectorAll('li.fe-tree-node[data-kind="dir"][data-open="true"]').forEach((li) => {
    const rel = li.dataset.rel;
    if (rel && rel !== '.') {
      expandedDirs.add(rel);
    }
  });
}

async function restoreExpandedDirs(treeEl) {
  if (!expandedDirs.size) return;
  const ordered = Array.from(expandedDirs).sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    return depthA - depthB;
  });
  for (const rel of ordered) {
    await expandDirectory(treeEl, rel);
  }
}

async function expandDirectory(treeEl, rel) {
  if (!rel) return;
  const segments = rel.split('/').filter(Boolean);
  if (!segments.length) return;

  let currentRel = '.';
  let container = treeEl.querySelector('.fe-tree-root > ul.fe-tree');

  for (const segment of segments) {
    const nextRel = currentRel === '.' ? segment : `${currentRel}/${segment}`;
    let dirNode = findDirNode(container, nextRel);
    
    if (!dirNode) {
      // This case should ideally not be hit if restore is called after render.
      // But as a fallback, we can try to render the parent.
      const parentRel = nextRel.includes('/') ? nextRel.substring(0, nextRel.lastIndexOf('/')) : '.';
      const parentNode = findDirNode(treeEl, parentRel);
      if (parentNode) {
        const parentChildList = parentNode.querySelector(':scope > ul');
        if (parentChildList) {
          await addTreeChildren(parentChildList, parentRel);
          dirNode = findDirNode(parentChildList, nextRel);
        }
      }
      if (!dirNode) {
        return; // still not found, bail.
      }
    }

    if (dirNode.dataset.open !== 'true') {
      dirNode.dataset.open = 'true';
      const twisty = dirNode.querySelector('.fe-tree-twisty');
      if (twisty) twisty.textContent = '▾';
      let childList = dirNode.querySelector(':scope > ul');
      if (!childList) {
        childList = document.createElement('ul');
        childList.className = 'fe-tree';
        dirNode.appendChild(childList);
      } else {
        childList.replaceChildren();
      }
      await addTreeChildren(childList, nextRel);
    }

    container = dirNode.querySelector(':scope > ul');
    currentRel = nextRel;
    if (!container) {
      return;
    }
  }
}

function findDirNode(container, rel) {
  if (!container) return null;
  return Array.from(container.querySelectorAll(':scope > li.fe-tree-node[data-kind="dir"]')).find(
    (li) => li.dataset.rel === rel
  ) || null;
}

async function onTreeClick(ev) {
  if (ev.target.classList.contains('fe-card-menu-btn') || ev.target.classList.contains('fe-entry-checkbox')) {
    return;
  }
  if (!currentProjectPath) {
    toast('Select a project before browsing files.');
    return;
  }
  const li = ev.target.closest('li.fe-tree-node');
  if (!li) return;

  // Prevent root from being collapsed by clicking on its twisty/icon area
  if (li.dataset.rel === '.' && li.dataset.kind === 'dir' && !ev.target.classList.contains('fe-tree-text')) {
    const isMenuBtn = ev.target.classList.contains('fe-card-menu-btn');
    if(!isMenuBtn) return;
  }

  const rel = li.dataset.rel;
  const kind = li.dataset.kind;

  if (kind === 'dir') {
    const isOpen = li.dataset.open === 'true';
    const twisty = li.querySelector('.fe-tree-twisty');

    if (isOpen) {
      // Collapse
      li.dataset.open = 'false';
      if (twisty) twisty.textContent = '▸';
      const ul = li.querySelector(':scope > ul');
      if (ul) ul.remove();
      if (rel && rel !== '.') {
        expandedDirs.delete(rel);
        for (const stored of Array.from(expandedDirs)) {
          if (stored.startsWith(`${rel}/`)) {
            expandedDirs.delete(stored);
          }
        }
      }
    } else {
      // Expand
      li.dataset.open = 'true';
      if (twisty) twisty.textContent = '▾';
      const ul = document.createElement('ul');
      ul.className = 'fe-tree';
      li.appendChild(ul);
      await addTreeChildren(ul, rel);
      if (rel && rel !== '.') {
        expandedDirs.add(rel);
      }
    }
  } else {
    // File clicked - open it
    openFileRel(rel, currentProjectPath);
    // Close drawer after opening file
    const root = document.querySelector('.fe-root');
    root?.classList.remove('drawer-open');
  }
}

function applyEntryStyling(labelEl, entry) {
  labelEl.classList.add('fe-tree-label');

  if (entry.kind === 'dir') {
    labelEl.classList.add(FILE_KIND_CLASS.dir);
  } else if (entry.isExecutable) {
    labelEl.classList.add(FILE_KIND_CLASS.exec);
  } else {
    labelEl.classList.add(FILE_KIND_CLASS.file);
  }

  if (entry.isSymlink) {
    labelEl.classList.add('fe-entry-symlink');
  }

  // ADD THIS SECTION for badges on files only
  if (entry.kind === 'file' && entry.gitStatus) {
    if (entry.gitStatus === 'modified') {
      const badge = document.createElement('span');
      badge.className = 'fe-git-badge fe-git-badge-modified';
      badge.textContent = 'M';
      labelEl.appendChild(badge);
    } else if (entry.gitStatus === 'untracked') {
      const badge = document.createElement('span');
      badge.className = 'fe-git-badge fe-git-badge-untracked';
      badge.textContent = 'U';
      labelEl.appendChild(badge);
    }
  }
}

function showCardMenu(entry, anchorEl) {
  // Toggle behavior: if clicking same button, close menu
  if (currentMenuButton === anchorEl && cardMenu.classList.contains('show')) {
    cardMenu.classList.remove('show');
    currentMenuButton = null;
    return;
  }

  currentMenuButton = anchorEl;
  cardMenu.innerHTML = '';
  cardMenu.classList.add('show');

  const rect = anchorEl.getBoundingClientRect();
  cardMenu.style.position = 'absolute';
  cardMenu.style.top = `${rect.bottom}px`;
  cardMenu.style.left = `${rect.left}px`;

  const items = buildMenuItems(entry);
  items.forEach(item => {
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
    div.addEventListener('click', () => {
      cardMenu.classList.remove('show');
      currentMenuButton = null;
      item.handler(entry);
    });
    cardMenu.appendChild(div);
  });

  const menuWidth = cardMenu.offsetWidth;
  const menuHeight = cardMenu.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  let left = rect.right - menuWidth;
  if (left < 8) {
    left = 8;
  }
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

function buildMenuItems(entry) {
  const items = [];
  const isDir = entry.kind === 'dir';

  if (isInSelectMode(entry.rel)) {
    items.push({ label: 'Disable select mode', handler: disableSelectMode });
    items.push({ divider: true });
    items.push({ label: `Copy selected (${selectedEntries.size})`, handler: batchCopyTo });
    items.push({ label: `Move selected (${selectedEntries.size})`, handler: batchMoveTo });
    items.push({ label: `Stage selected (${selectedEntries.size})`, handler: batchStage });
    items.push({ label: `Unstage selected (${selectedEntries.size})`, handler: batchUnstage });
    items.push({ divider: true });
    items.push({ label: `Delete selected (${selectedEntries.size})`, handler: batchDelete, destructive: true });
  } else {
    if (isDir) {
      items.push({ label: 'Enable select mode', handler: enableSelectMode });
      items.push({ divider: true });
      items.push({ label: 'Add File', handler: addFile });
      items.push({ label: 'Add Directory', handler: addDirectory });
    }

    items.push({ label: 'Rename', handler: renameEntry });
    items.push({ label: 'Copy to…', handler: copyTo });
    items.push({ label: 'Move to…', handler: moveTo });
    
    if (entry.gitStatus && (entry.gitStatus === 'modified' || entry.gitStatus === 'untracked' || entry.gitStatus === 'added')) {
        items.push({ label: 'Stage', handler: stageEntry });
    }
    if (entry.gitStatus && (entry.gitStatus === 'staged' || entry.gitStatus === 'staged_modified')) {
        items.push({ label: 'Unstage', handler: unstageEntry });
    }
    if (!isDir && entry.gitStatus && entry.gitStatus !== 'clean') {
        items.push({ label: 'Restore…', handler: restoreEntry });
    }

    items.push({ divider: true });
    items.push({ label: 'Delete', handler: deleteEntry, destructive: true });
  }

  return items;
}

// Functions for card menu actions
async function addFile(entry) {
    const name = prompt('File name:');
    if (!name || !name.trim()) return;

    try {
        const resp = await fetch('/api/app/file_editor_cm6/explorer/touch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project: currentProjectPath,
                parent_rel: entry.rel,
                name: name.trim()
            })
        });
        const json = await resp.json();
        if (!json.ok) throw new Error(json.error || 'Failed to create file');

        toast(`File "${name}" created`);
        await refreshTree(treeElement);
        await refreshGitStatus(false);
    } catch (err) {
        toast(err.message || 'Failed to create file');
    }
}

async function addDirectory(entry) {
    const name = prompt('Directory name:');
    if (!name || !name.trim()) return;

    try {
        const resp = await fetch('/api/app/file_editor_cm6/explorer/mkdir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project: currentProjectPath,
                parent_rel: entry.rel,
                name: name.trim()
            })
        });
        const json = await resp.json();
        if (!json.ok) throw new Error(json.error || 'Failed to create directory');

        toast(`Directory "${name}" created`);
        await refreshTree(treeElement);
        await refreshGitStatus(false);
    } catch (err) {
        toast(err.message || 'Failed to create directory');
    }
}

async function renameEntry(entry) {
    const currentName = entry.name;
    const newName = prompt('Rename to:', currentName);
    if (!newName || !newName.trim() || newName === currentName) return;

    try {
        const resp = await fetch('/api/app/file_editor_cm6/explorer/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project: currentProjectPath,
                rel: entry.rel,
                new_name: newName.trim()
            })
        });
        const json = await resp.json();
        if (!json.ok) throw new Error(json.error || 'Failed to rename');

        toast(`Renamed to "${newName}"`);
        await refreshTree(treeElement);
        await refreshGitStatus(false);
    } catch (err) {
        toast(err.message || 'Failed to rename');
    }
}

async function deleteEntry(entry) {
    const confirmed = confirm(
        `⚠️ WARNING: Delete "${entry.name}"?\\n\\n` +
        `This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
        const resp = await fetch('/api/app/file_editor_cm6/explorer/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rel: entry.rel })
        });
        const json = await resp.json();
        if (!json.ok) throw new Error(json.error || 'Delete failed');

        toast(`Deleted ${entry.name}`);
        await refreshTree(treeElement);
        await refreshGitStatus(false);
    } catch (err) {
        toast(err.message || 'Delete failed');
    }
}

function enableSelectMode(entry) {
  if (entry.kind !== 'dir') return;
  selectModeDir = entry.rel;
  selectedEntries.clear();
  refreshTree(treeElement); // This will re-render with checkboxes
}

function disableSelectMode() {
  selectModeDir = null;
  selectedEntries.clear();
  refreshTree(treeElement);
}

function isInSelectMode(parentRel) {
  return selectModeDir === parentRel;
}

async function copyTo(entry) {
    if (!window.teFilePicker) {
      toast('File picker not available');
      return;
    }
    
    try {
      const dest = await window.teFilePicker.openDirectory({
        title: `Copy "${entry.name}" to…`,
        startPath: currentProjectPath
      });
      
      const resp = await fetch('/api/app/file_editor_cm6/explorer/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: currentProjectPath,
          rel: entry.rel,
          dest_path: dest.path
        })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Copy failed');
      
      toast(`Copied to ${dest.path}`);
      await refreshTree(treeElement);
      await refreshGitStatus(false);
    } catch (err) {
      if (err.message !== 'cancelled') {
        toast(err.message || 'Copy failed');
      }
    }
}

async function moveTo(entry) {
    if (!window.teFilePicker) {
      toast('File picker not available');
      return;
    }
    
    try {
      const dest = await window.teFilePicker.openDirectory({
        title: `Move "${entry.name}" to…`,
        startPath: currentProjectPath
      });
      
      const resp = await fetch('/api/app/file_editor_cm6/explorer/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: currentProjectPath,
          rel: entry.rel,
          dest_path: dest.path
        })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Move failed');
      
      toast(`Moved to ${dest.path}`);
      await refreshTree(treeElement);
      await refreshGitStatus(false);
    } catch (err) {
      if (err.message !== 'cancelled') {
        toast(err.message || 'Move failed');
      }
    }
}

// Batch operations
async function batchCopyTo() {
    const paths = Array.from(selectedEntries);
    if (paths.length === 0) return;

    if (!window.teFilePicker) {
      toast('File picker not available');
      return;
    }

    try {
        const dest = await window.teFilePicker.openDirectory({
            title: `Copy ${paths.length} items to…`,
            startPath: currentProjectPath
        });

        const resp = await fetch('/api/app/file_editor_cm6/explorer/batch_copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project: currentProjectPath,
                rels: paths,
                dest_path: dest.path
            })
        });
        const json = await resp.json();
        if (!json.ok) throw new Error(json.error || 'Batch copy failed');

        toast(`Copied ${paths.length} items to ${dest.path}`);
        disableSelectMode();
        await refreshTree(treeElement);
        await refreshGitStatus(false);
    } catch (err) {
        if (err.message !== 'cancelled') {
            toast(err.message || 'Batch copy failed');
        }
    }
}
async function batchMoveTo() {
    const paths = Array.from(selectedEntries);
    if (paths.length === 0) return;

    if (!window.teFilePicker) {
        toast('File picker not available');
        return;
    }

    try {
        const dest = await window.teFilePicker.openDirectory({
            title: `Move ${paths.length} items to…`,
            startPath: currentProjectPath
        });

        const resp = await fetch('/api/app/file_editor_cm6/explorer/batch_move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project: currentProjectPath,
                rels: paths,
                dest_path: dest.path
            })
        });
        const json = await resp.json();
        if (!json.ok) throw new Error(json.error || 'Batch move failed');

        toast(`Moved ${paths.length} items to ${dest.path}`);
        disableSelectMode();
        await refreshTree(treeElement);
        await refreshGitStatus(false);
    } catch (err) {
        if (err.message !== 'cancelled') {
            toast(err.message || 'Batch move failed');
        }
    }
}
async function batchDelete() { 
    const paths = Array.from(selectedEntries);
    if (!paths.length) return;

    const confirmed = confirm(
      `⚠️ WARNING: Delete ${paths.length} items?\\n\\n` +
      `This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const resp = await fetch('/api/app/file_editor_cm6/explorer/batch_delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rels: paths })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Batch delete failed');

      toast(`Deleted ${paths.length} items`);
      disableSelectMode();
      await refreshTree(treeElement);
      await refreshGitStatus(false);
    } catch (err) {
      toast(err.message || 'Batch delete failed');
    }
}
async function batchStage() {
    const paths = Array.from(selectedEntries);
    if (paths.length === 0) return;
    try {
      const resp = await fetch('/api/app/file_editor_cm6/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: paths })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Batch stage failed');
      
      gitStatusCache = json.data;
      renderGitSummary(json.data);
      await refreshTree(treeElement);
      toast(`Staged ${paths.length} items`);
    } catch (err) {
      toast(err.message || 'Batch stage failed');
    }
}
async function batchUnstage() {
    const paths = Array.from(selectedEntries);
    if (paths.length === 0) return;
    try {
      const resp = await fetch('/api/app/file_editor_cm6/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: paths })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Batch unstage failed');
      
      gitStatusCache = json.data;
      renderGitSummary(json.data);
      await refreshTree(treeElement);
      toast(`Unstaged ${paths.length} items`);
    } catch (err) {
      toast(err.message || 'Batch unstage failed');
    }
}
async function stageEntry(entry) {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [entry.rel] })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Stage failed');
      
      gitStatusCache = json.data;
      renderGitSummary(json.data);
      await refreshTree(treeElement);
      toast(`Staged ${entry.name}`);
    } catch (err) {
      toast(err.message || 'Stage failed');
    }
}
async function unstageEntry(entry) {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [entry.rel] })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Unstage failed');
      
      gitStatusCache = json.data;
      renderGitSummary(json.data);
      await refreshTree(treeElement);
      toast(`Unstaged ${entry.name}`);
    } catch (err) {
      toast(err.message || 'Unstage failed');
    }
}

async function restoreEntry(entry) {
    try {
      // Fetch commits for this path
      const resp = await fetch(`/api/app/file_editor_cm6/git/commits_for_path?path=${encodeURIComponent(entry.rel)}`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'Failed to fetch commits');
      
      const commits = json.data;
      if (!commits.length) {
        toast('No commits found for this file');
        return;
      }
      
      // Show simple modal (for now use confirm, later build proper modal)
      const commitList = commits.slice(0, 5).map(c => `${c.short_hash}: ${c.summary}`).join('\\n');
      const confirmed = confirm(
        `⚠️ WARNING: This will discard changes to ${entry.name}\\n\\n` +
        `Recent commits:\\n${commitList}\\n\\n` +
        `Restore from HEAD?`
      );
      if (!confirmed) return;
      
      // Restore from HEAD
      const restoreResp = await fetch('/api/app/file_editor_cm6/git/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: entry.rel, commit: 'HEAD' })
      });
      const restoreJson = await restoreResp.json();
      if (!restoreJson.ok) throw new Error(restoreJson.error || 'Restore failed');
      
      toast(`Restored ${entry.name} from HEAD`);
      await refreshTree(treeElement);
      await refreshGitStatus(false);
      
      // Reload current file if it was restored
      if (typeof window.__cm6ReloadCurrentFile === 'function') {
        await window.__cm6ReloadCurrentFile();
      }
    } catch (err) {
      toast(err.message || 'Restore failed');
    }
  }

// These functions will be provided by main.js
function openFile(absPath) {
  if (window.appOpenFile) {
    window.appOpenFile(absPath);
  } else {
    console.error('appOpenFile not available');
  }
}

function openFileRel(rel, projectRoot) {
  if (window.appOpenFileRel) {
    window.appOpenFileRel(rel, projectRoot);
  } else {
    console.error('appOpenFileRel not available');
  }
}

async function openFileAndMaybeJump(rel, lineNumber = null) {
  if (!window.appOpenFileRel) {
    toast('File opener not available');
    return;
  }
  try {
    await window.appOpenFileRel(rel, currentProjectPath);
    closeDrawerIfMobile();

    if (treeElement) {
      const dirPath = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '.';
      await expandDirectory(treeElement, dirPath);
    }

    if (typeof lineNumber === 'number' && window.jumpToCurrentFileLine) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await window.jumpToCurrentFileLine(lineNumber);
    }
  } catch (err) {
    toast('Failed to open file: ' + (err?.message || 'unknown error'));
  }
}

function openSearchOverlay() {
  if (!currentProjectPath) {
    toast('No project open');
    return;
  }
  
  searchOverlayVisible = true;
  lastKnownProjectPath = currentProjectPath;
  renderSearchOverlay();
  
  // Focus search input after render
  setTimeout(() => {
    if (searchMode === 'changes') {
      fetchChangesResults(true);
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
  closeDiffBaseMenus();
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
  if (searchMode === 'changes') {
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
  if (searchMode === 'changes') {
    return;
  }
  // Check for project change
  if (currentProjectPath !== lastKnownProjectPath) {
    clearSearchResults();
    lastKnownProjectPath = currentProjectPath;
    return;
  }
  
  searchLoading = true;
  searchError = null;
  renderSearchOverlay();
  
  try {
    const resp = await fetch('/api/app/file_editor_cm6/explorer/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: searchMode, query })
    });
    
    const json = await resp.json();
    
    if (!resp.ok) {
      throw new Error(json.detail || resp.statusText);
    }
    
    searchResults = json.data;
    searchLoading = false;
    searchError = null;
    renderSearchOverlay();
    
  } catch (err) {
    searchLoading = false;
    searchError = err.message || 'Search failed';
    searchResults = null;
    renderSearchOverlay();
  }
}

async function fetchChangesResults(force = false) {
  if (searchMode !== 'changes') {
    return;
  }
  if (searchLoading && !force) {
    return;
  }

  const targetProject = currentProjectPath;
  lastKnownProjectPath = targetProject;
  searchLoading = true;
  searchError = null;
  renderSearchOverlay();

  try {
    const resp = await fetch('/api/app/file_editor_cm6/explorer/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'changes' })
    });

    const json = await resp.json();
    if (!resp.ok) {
      throw new Error(json.detail || resp.statusText);
    }

    if (targetProject !== currentProjectPath) {
      return;
    }

    if (json.data?.base) {
      applyGitDiffBaseFromState(json.data.base);
    }
    searchResults = json.data;
    searchLoading = false;
    searchError = null;
    renderSearchOverlay();
  } catch (err) {
    if (targetProject !== currentProjectPath) {
      return;
    }
    searchLoading = false;
    searchError = err.message || 'Changes lookup failed';
    searchResults = null;
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

function toggleSearchMode() {
  searchMode = searchMode === 'name' ? 'content' : 'name';
  if (searchQuery.length >= 2) {
    performSearch(searchQuery);
  } else {
    renderSearchOverlay();
  }
}

function renderSearchOverlay() {
  const overlay = document.getElementById('fe-search-overlay');
  if (!overlay) return;
  
  if (!searchOverlayVisible) {
    overlay.style.display = 'none';
    return;
  }
  
  overlay.style.display = 'flex';
  
  // First render - create structure
  if (!overlay.querySelector('.fe-search-header')) {
    // Build header
    const header = document.createElement('div');
    header.className = 'fe-search-header';
    
    const title = document.createElement('h3');
    title.textContent = 'Search';
    header.appendChild(title);
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className = 'fe-search-close';
    closeBtn.onclick = closeSearchOverlay;
    header.appendChild(closeBtn);
    
    // Mode toggle
    const modeToggle = document.createElement('div');
    modeToggle.className = 'fe-search-mode';
    
    const nameBtn = document.createElement('button');
    nameBtn.textContent = 'By Name';
    nameBtn.dataset.mode = 'name';
    modeToggle.appendChild(nameBtn);
    
    const contentBtn = document.createElement('button');
    contentBtn.textContent = 'By Contents';
    contentBtn.dataset.mode = 'content';
    modeToggle.appendChild(contentBtn);
    
    const changesBtn = document.createElement('button');
    changesBtn.textContent = 'By Changes';
    changesBtn.dataset.mode = 'changes';
    modeToggle.appendChild(changesBtn);
    
    header.appendChild(modeToggle);
    
    // Search input
    const inputContainer = document.createElement('div');
    inputContainer.className = 'fe-search-input-container';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'fe-search-input';
    input.placeholder = searchMode === 'name' ? 'Search files/folders...' : 'Search in files...';
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

    const headNote = document.createElement('span');
    headNote.className = 'fe-search-changes-note';
    headNote.textContent = 'This list compares files against the selected commit.';
    changesToolbar.appendChild(headNote);
    
    // Results area
    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'fe-search-results';
    
    // Assemble
    overlay.innerHTML = '';
    overlay.appendChild(header);
    overlay.appendChild(inputContainer);
    overlay.appendChild(changesToolbar);
    overlay.appendChild(resultsDiv);
  }
  
  // Subsequent renders - only update dynamic parts
  
  // Update mode toggle active state
  const modeButtons = overlay.querySelectorAll('.fe-search-mode button');
  modeButtons.forEach((btn) => {
    const mode = btn.dataset.mode;
    btn.className = mode === searchMode ? 'active' : '';
    btn.onclick = () => setSearchMode(mode);
  });
  
  // Update input placeholder and value
  const input = overlay.querySelector('#fe-search-input');
  if (input) {
    input.placeholder = searchMode === 'name' ? 'Search files/folders...' : 'Search in files...';
    if (input.value !== searchQuery) {
      input.value = searchQuery;
    }
    input.parentElement.style.display = searchMode === 'changes' ? 'none' : 'flex';
  }

  const changesToolbar = overlay.querySelector('.fe-search-changes-toolbar');
  if (changesToolbar) {
    changesToolbar.style.display = searchMode === 'changes' ? 'flex' : 'none';
    if (searchBaseBtn) {
      searchBaseBtn.textContent = `${formatDiffBaseLabel(gitDiffBase, false)} ▾`;
      searchBaseBtn.disabled = gitDiffBase.mode === 'none';
      searchBaseBtn.title = gitDiffBase.commit?.subject || 'Diff base selector';
    }
  }
  
  // Update clear button visibility
  const clearBtn = overlay.querySelector('.fe-search-clear');
  if (clearBtn) {
    clearBtn.style.display = searchQuery && searchMode !== 'changes' ? 'block' : 'none';
    clearBtn.onclick = () => {
      searchQuery = '';
      searchResults = null;
      renderSearchOverlay();
    };
  }
  
  // Update results container
  const resultsContainer = overlay.querySelector('.fe-search-results');
  if (resultsContainer) {
    if (searchLoading) {
      resultsContainer.innerHTML = '<div class="fe-search-loading">Searching...</div>';
    } else if (searchError) {
      resultsContainer.innerHTML = `<div class="fe-search-error">${searchError}</div>`;
    } else if (searchResults) {
      resultsContainer.innerHTML = '';
      renderSearchResults(resultsContainer);
    } else if (searchQuery.length > 0 && searchQuery.length < 2) {
      resultsContainer.innerHTML = '<div class="fe-search-hint">Type at least 2 characters</div>';
    } else {
      resultsContainer.innerHTML = '';
    }
  }
}

function renderSearchResults(container) {
  if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
    if (searchMode === 'changes') {
      renderChangesResults(container, searchResults);
      return;
    }
    container.innerHTML = '<div class="fe-search-empty">No results found</div>';
    return;
  }
  
  if (searchMode === 'name') {
    renderNameResults(container, searchResults);
  } else if (searchMode === 'content') {
    renderContentResults(container, searchResults);
  } else {
    renderChangesResults(container, searchResults);
  }
}

function renderNameResults(container, data) {
  const list = document.createElement('div');
  list.className = 'fe-search-list';
  
  data.results.forEach(item => {
    const row = document.createElement('div');
    row.className = 'fe-search-item';
    row.onclick = async () => {
      if (item.type === 'file') {
        // File clicked: open file, close drawer (mobile only), expand tree to show file
        if (window.appOpenFileRel) {
          window.appOpenFileRel(item.rel, currentProjectPath);
          closeDrawerIfMobile();
          
          // Expand tree to show the file
          if (treeElement) {
            const dirPath = item.rel.includes('/') ? item.rel.substring(0, item.rel.lastIndexOf('/')) : '.';
            await expandDirectory(treeElement, dirPath);
          }
        } else {
          toast('File opener not available');
        }
      } else if (item.type === 'dir') {
        // Directory clicked: close search overlay, expand tree to show directory
        closeSearchOverlay();
        
        if (treeElement) {
          await expandDirectory(treeElement, item.rel);
        }
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
  
  data.results.forEach(fileResult => {
    const fileGroup = document.createElement('div');
    fileGroup.className = 'fe-search-file-group';
    
    const matches = fileResult.matches || [];
    
    const fileHeader = document.createElement('div');
    fileHeader.className = 'fe-search-file-header';
    fileHeader.textContent = `${fileResult.rel} (${matches.length})`;
    fileGroup.appendChild(fileHeader);
    
    matches.forEach(match => {
      const matchRow = document.createElement('div');
      matchRow.className = 'fe-search-match';
      matchRow.onclick = async () => {
        if (window.appOpenFileRel && window.jumpToCurrentFileLine) {
          // File content match clicked: open file, jump to line, close drawer (mobile only), expand tree
          
          // First: Open file using unified flow (matching explorer behavior)
          try {
            await window.appOpenFileRel(fileResult.rel, currentProjectPath);
            
            closeDrawerIfMobile();
            
            // Expand tree to show the file
            if (treeElement) {
              const dirPath = fileResult.rel.includes('/') ? fileResult.rel.substring(0, fileResult.rel.lastIndexOf('/')) : '.';
              await expandDirectory(treeElement, dirPath);
            }
            
            // Wait a tick for file to load
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Then: Jump to line
            await window.jumpToCurrentFileLine(match.line);
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
  container.innerHTML = '';
  if (!data) {
    container.innerHTML = '<div class="fe-search-empty">No changes loaded</div>';
    return;
  }

  if (data.git === false) {
    container.innerHTML = '<div class="fe-search-empty">Open a Git project to view changes.</div>';
    return;
  }

  const entries = data.changes || [];

  const baseInfo = data.base || gitDiffBase;
  if (baseInfo && baseInfo.mode !== 'none') {
    const note = document.createElement('div');
    note.className = 'fe-search-changes-note';
    note.style.margin = '4px 0 8px';
    note.textContent = `Comparing against ${formatDiffBaseLabel(baseInfo, false)}`;
    container.appendChild(note);
  }

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'fe-search-empty';
    empty.textContent = 'Working tree is clean.';
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'fe-search-changes';

  entries.forEach((change) => {
    const group = document.createElement('div');
    group.className = 'fe-search-file-group fe-search-change-group';
    group.onclick = async () => {
      if (typeof window.__cm6EnsureInlineDiffs === 'function') {
        try {
          await window.__cm6EnsureInlineDiffs(true);
        } catch (err) {
          console.warn('Failed to auto-enable inline diffs:', err);
        }
      }
      await openFileAndMaybeJump(change.rel, firstDiffLine(change));
    };

    const header = document.createElement('div');
    header.className = 'fe-search-file-header fe-search-change-header';

    const title = document.createElement('span');
    title.className = 'fe-search-change-path';
    title.textContent = change.rel;
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'fe-search-change-meta';

    const status = document.createElement('span');
    status.className = `fe-search-change-status-text ${statusClassFor(change.status)}`;
    status.textContent = change.statusText || change.status || '';
    meta.appendChild(status);

    if (change.summary) {
      const summary = document.createElement('span');
      summary.className = 'fe-search-change-summary';
      summary.textContent = `+${change.summary.added || 0} / -${change.summary.deleted || 0}`;
      meta.appendChild(summary);
    }

    header.appendChild(meta);
    group.appendChild(header);

    if (change.error) {
      const err = document.createElement('div');
      err.className = 'fe-search-change-error';
      err.textContent = change.error === 'diff_too_large' ? 'Diff too large to preview' : change.error;
      group.appendChild(err);
    } else {
      const hunks = change.hunks || [];
      const hunksContainer = document.createElement('div');
      hunksContainer.className = 'fe-search-change-hunks';

      let renderedLines = 0;
      const MAX_LINES = 160;

      hunks.forEach((hunk) => {
        if (renderedLines >= MAX_LINES) {
          return;
        }

        const hunkBlock = document.createElement('div');
        hunkBlock.className = 'fe-search-hunk';

        const hunkHeader = document.createElement('div');
        hunkHeader.className = 'fe-search-hunk-header';
        hunkHeader.textContent = describeHunkRange(hunk);
        hunkBlock.appendChild(hunkHeader);

        const diffRows = document.createElement('div');
        diffRows.className = 'fe-search-diff-rows';

        let oldLine = Number(hunk.oldStart) || 0;
        let newLine = Number(hunk.newStart) || 0;

        (hunk.lines || []).forEach((line) => {
          if (renderedLines >= MAX_LINES) {
            return;
          }

          const row = document.createElement('div');
          row.className = 'fe-search-diff-row';

          const lineNum = document.createElement('span');
          lineNum.className = 'fe-search-diff-line-num';

          const sign = document.createElement('span');
          sign.className = 'fe-search-diff-sign';

          const text = document.createElement('pre');
          text.className = 'fe-search-diff-text';
          text.textContent = line.text || ' ';

          if (line.type === 'add') {
            row.classList.add('is-add');
            lineNum.textContent = newLine || '';
            sign.textContent = '+';
            newLine += 1;
          } else if (line.type === 'del') {
            row.classList.add('is-del');
            lineNum.textContent = oldLine || '';
            sign.textContent = '-';
            oldLine += 1;
          } else {
            row.classList.add('is-context');
            lineNum.textContent = newLine || oldLine || '';
            sign.textContent = '';
            newLine += 1;
            oldLine += 1;
          }

          row.appendChild(lineNum);
          row.appendChild(sign);
          row.appendChild(text);
          diffRows.appendChild(row);
          renderedLines += 1;
        });

        hunkBlock.appendChild(diffRows);
        hunksContainer.appendChild(hunkBlock);
      });

      if (renderedLines === 0) {
        const empty = document.createElement('div');
        empty.className = 'fe-search-change-empty-hunk';
        empty.textContent = 'No diff available (binary or metadata change).';
        hunksContainer.appendChild(empty);
      }

      if (renderedLines >= MAX_LINES) {
        const moreEl = document.createElement('div');
        moreEl.className = 'fe-search-diff-more';
        moreEl.textContent = '… diff truncated';
        hunksContainer.appendChild(moreEl);
      }

      group.appendChild(hunksContainer);
    }

    list.appendChild(group);
  });

  container.appendChild(list);

  if (data.truncated) {
    const notice = document.createElement('div');
    notice.className = 'fe-search-notice';
    notice.textContent = `Showing ${entries.length} of ${data.total || entries.length} files`;
    container.appendChild(notice);
  }
}

function describeHunkRange(hunk) {
  const formatRange = (start, length) => {
    const s = Number(start) || 0;
    const len = Number(length);
    if (!s && !len) return '—';
    if (!len || len <= 0) return `${s}`;
    if (len === 1) return `${s}`;
    return `${s}–${s + len - 1}`;
  };

  const oldDesc = formatRange(hunk.oldStart, hunk.oldLines);
  const newDesc = formatRange(hunk.newStart, hunk.newLines);

  const oldLen = Number(hunk.oldLines) || 0;
  const newLen = Number(hunk.newLines) || 0;

  if (oldLen === 0 && newLen > 0) {
    return `Added around line ${newDesc}`;
  }
  if (newLen === 0 && oldLen > 0) {
    return `Removed lines ${oldDesc}`;
  }
  return `Lines ${oldDesc} → ${newDesc}`;
}

function statusClassFor(status) {
  switch ((status || '').trim()) {
    case 'A':
      return 'is-added';
    case 'D':
      return 'is-deleted';
    case 'R':
      return 'is-renamed';
    case 'C':
      return 'is-copied';
    case 'U':
      return 'is-conflict';
    case '?':
      return 'is-untracked';
    case '!':
      return 'is-ignored';
    default:
      return 'is-modified';
  }
}

// Note: File opening from search uses window.appOpenFile (main.js)
// and window.jumpToCurrentFileLine (main.js) for unified flow
