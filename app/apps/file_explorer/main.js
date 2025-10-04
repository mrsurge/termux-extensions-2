const HOME_DIR = '/data/data/com.termux/files/home';
const TERMUX_BASE = HOME_DIR.replace(/\/files\/home$/, '');
const TYPE_ICON = {
  directory: '📁',
  file: '📄',
  symlink: '🔗',
  unknown: '❔',
};

// Editable file extensions - can be opened in file editor
const EDITABLE_EXTENSIONS = new Set([
  '.txt', '.text', '.md', '.markdown',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.pyw', '.pyi',
  '.sh', '.bash', '.zsh', '.fish', '.ksh',
  '.json', '.jsonc', '.json5',
  '.xml', '.html', '.htm', '.xhtml', '.svg',
  '.css', '.scss', '.sass', '.less',
  '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.config',
  '.env', '.env.local', '.env.production',
  '.gitignore', '.dockerignore', '.npmignore',
  '.editorconfig', '.prettierrc', '.eslintrc',
  '.bashrc', '.zshrc', '.vimrc', '.tmux.conf',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx',
  '.java', '.kt', '.kts',
  '.go', '.rs', '.rb', '.php', '.pl',
  '.r', '.R', '.sql', '.lua', '.vim',
  '.dockerfile', 'Dockerfile',
  '.makefile', 'Makefile',
  '.log', '.csv', '.tsv'
]);

function isEditableFile(filename) {
  if (!filename) return false;
  const name = filename.toLowerCase();
  // Check exact matches first (like Dockerfile, Makefile)
  if (EDITABLE_EXTENSIONS.has(name)) return true;
  // Check extensions
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return false;
  const ext = name.slice(lastDot);
  return EDITABLE_EXTENSIONS.has(ext);
}

const ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar'
]);

const OWNER_BITS = { read: 0o400, write: 0o200, exec: 0o100 };
const GROUP_BITS = { read: 0o040, write: 0o020, exec: 0o010 };
const OTHER_BITS = { read: 0o004, write: 0o002, exec: 0o001 };
const MAX_EDITOR_SIZE = 256 * 1024; // 256 KB threshold

function permissionsToMode(perms) {
  if (!perms) return 0;
  let mode = 0;
  const owner = perms.owner || {};
  const group = perms.group || {};
  const others = perms.others || {};
  if (owner.read) mode |= OWNER_BITS.read;
  if (owner.write) mode |= OWNER_BITS.write;
  if (owner.exec) mode |= OWNER_BITS.exec;
  if (group.read) mode |= GROUP_BITS.read;
  if (group.write) mode |= GROUP_BITS.write;
  if (group.exec) mode |= GROUP_BITS.exec;
  if (others.read) mode |= OTHER_BITS.read;
  if (others.write) mode |= OTHER_BITS.write;
  if (others.exec) mode |= OTHER_BITS.exec;
  return mode;
}

function modeToPermissions(mode) {
  const value = Number.isFinite(mode) ? mode : parseInt(`${mode}`, 8);
  const safe = Number.isFinite(value) ? value : 0;
  const has = (flag) => (safe & flag) === flag;
  return {
    owner: {
      read: has(OWNER_BITS.read),
      write: has(OWNER_BITS.write),
      exec: has(OWNER_BITS.exec),
    },
    group: {
      read: has(GROUP_BITS.read),
      write: has(GROUP_BITS.write),
      exec: has(GROUP_BITS.exec),
    },
    others: {
      read: has(OTHER_BITS.read),
      write: has(OTHER_BITS.write),
      exec: has(OTHER_BITS.exec),
    },
  };
}

function joinPath(dir, name) {
  if (!dir || dir === '/') return `/${name}`;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

function isArchive(filename) {
  if (!filename) return false;
  const name = filename.toLowerCase();
  // Check for compound extensions
  if (name.endsWith('.tar.gz') || name.endsWith('.tar.bz2') || name.endsWith('.tar.xz')) {
    return true;
  }
  // Check single extensions
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return false;
  const ext = name.slice(lastDot);
  return ARCHIVE_EXTENSIONS.has(ext);
}

function parentPath(path) {
  if (!path || path === '/') return '/';
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  const parent = trimmed.slice(0, idx);
  return parent || '/';
}

function isWithinTermux(path) {
  if (!path) return false;
  const abs = path.endsWith('/') ? path.slice(0, -1) : path;
  if (!TERMUX_BASE) return abs === HOME_DIR || abs.startsWith(`${HOME_DIR}/`);
  return abs === TERMUX_BASE || abs === HOME_DIR || abs.startsWith(`${TERMUX_BASE}/`);
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function formatDate(mtime) {
  if (!Number.isFinite(mtime)) return '';
  try {
    return new Date(mtime * 1000).toLocaleString();
  } catch (_) {
    return '';
  }
}

function modeToString(mode, type) {
  if (!Number.isFinite(mode)) return '----------';
  
  // File type character
  let str = '';
  if (type === 'directory') str = 'd';
  else if (type === 'symlink') str = 'l';
  else str = '-';
  
  // Permission bits
  const perms = [
    (mode & 0o400) ? 'r' : '-',
    (mode & 0o200) ? 'w' : '-',
    (mode & 0o100) ? 'x' : '-',
    (mode & 0o040) ? 'r' : '-',
    (mode & 0o020) ? 'w' : '-',
    (mode & 0o010) ? 'x' : '-',
    (mode & 0o004) ? 'r' : '-',
    (mode & 0o002) ? 'w' : '-',
    (mode & 0o001) ? 'x' : '-',
  ];
  
  return str + perms.join('');
}

function formatOwnership(owner, group) {
  const o = owner || '?';
  const g = group || '?';
  return `${o}:${g}`;
}

const jobsClient = window.jobsClient || {};
const JobStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const TERMINAL_STATUSES = new Set([
  JobStatus.SUCCEEDED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
]);

const jobTracker = {
  poller: null,
  stream: null,
  jobs: new Map(),
};

function toast(host, message) {
  if (!message) return;
  if (window.teUI && typeof window.teUI.toast === 'function') {
    window.teUI.toast(message);
    return;
  }
  console.log('[toast]', message);
}

function hasJobSupport() {
  return typeof jobsClient.createJobPoller === 'function'
    || typeof jobsClient.createJobStream === 'function';
}

function ensureJobPoller(state) {
  if (!hasJobSupport()) return;
  if (!jobTracker.poller) {
    jobTracker.poller = jobsClient.createJobPoller({
      onUpdate: (jobs) => handleJobUpdates(state, jobs, { partial: false }),
      onError: (err) => console.error('[file-explorer jobs poller]', err),
    });
  }
  if (!jobTracker.poller.isRunning()) {
    jobTracker.poller.start();
  }
}

function ensureJobSubscription(state) {
  if (!hasJobSupport()) return;
  const streamSupported = typeof window !== 'undefined'
    && typeof window.EventSource === 'function'
    && typeof jobsClient.createJobStream === 'function';

  if (streamSupported) {
    const running = jobTracker.stream && typeof jobTracker.stream.isRunning === 'function'
      ? jobTracker.stream.isRunning()
      : false;
    if (!running) {
      jobTracker.stream = jobsClient.createJobStream({
        onUpdate: (jobs, options = {}) => handleJobUpdates(state, jobs, options),
        onError: (err) => {
          console.error('[file-explorer jobs stream]', err);
          if (jobTracker.stream) jobTracker.stream.stop();
          jobTracker.stream = null;
          ensureJobPoller(state);
        },
      });
      if (jobTracker.stream) {
        jobTracker.stream.start();
        if (typeof jobTracker.stream.isRunning === 'function' && jobTracker.stream.isRunning()) {
          return;
        }
      }
    } else {
      return;
    }
  }

  if (!jobTracker.poller || !jobTracker.poller.isRunning()) {
    ensureJobPoller(state);
  }
}

function maybeStopJobFeed() {
  if (jobTracker.jobs.size > 0) return;
  if (jobTracker.stream && typeof jobTracker.stream.stop === 'function') {
    jobTracker.stream.stop();
    jobTracker.stream = null;
  }
  if (jobTracker.poller && jobTracker.poller.isRunning()) {
    jobTracker.poller.stop();
    jobTracker.poller = null;
  }
}

function resolveTemplate(template, job, meta, fallback) {
  if (typeof template === 'function') {
    try {
      const value = template(job, meta);
      if (value) return value;
    } catch (error) {
      console.error('[file-explorer jobs] template error', error);
    }
  } else if (typeof template === 'string' && template.trim()) {
    return template;
  }
  return fallback;
}

function trackJob(state, job, meta = {}) {
  if (!hasJobSupport()) return;
  const metaPayload = { type: job.type, ...meta };
  jobTracker.jobs.set(job.id, {
    meta: metaPayload,
    lastStatus: job.status,
    cleaned: false,
  });
  updateJobNotification(state, job, jobTracker.jobs.get(job.id));
  ensureJobSubscription(state);
}

function trackArchiveExtractionJob(state, job, meta = {}) {
  const archiveName = meta.archiveName || (meta.archivePath ? meta.archivePath.split('/').pop() : 'archive');
  trackJob(state, job, {
    type: 'archive-extract',
    title: `Extract ${archiveName}`,
    ...meta,
  });
}

function trackBulkOperationJob(state, job, meta = {}) {
  trackJob(state, job, { ...meta, type: meta.type || job.type });
}

function handleJobUpdates(state, jobs, options = {}) {
  if (!Array.isArray(jobs) || jobs.length === 0) return;
  const partial = options?.partial === true;
  const jobMap = new Map(jobs.map((job) => [job.id, job]));

  if (partial) {
    for (const job of jobs) {
      const info = jobTracker.jobs.get(job.id);
      if (!info) continue;
      updateJobNotification(state, job, info);
    }
  } else {
    for (const [jobId, info] of jobTracker.jobs.entries()) {
      const job = jobMap.get(jobId);
      if (!job) {
        window.teUI?.dismiss?.(jobId);
        jobTracker.jobs.delete(jobId);
        continue;
      }
      updateJobNotification(state, job, info);
    }
    maybeStopJobFeed();
  }
}

function updateJobNotification(state, job, info) {
  const meta = info.meta || {};
  const failureCount = Array.isArray(job.result?.failed) ? job.result.failed.length : 0;
  const successCount = Array.isArray(job.result?.succeeded) ? job.result.succeeded.length : 0;

  const defaultTitle = meta.title
    || (meta.type === 'archive-extract'
      ? `Extract ${meta.archiveName || (meta.archivePath ? meta.archivePath.split('/').pop() : 'archive')}`
      : meta.type === 'bulk-copy'
        ? 'Copy items'
        : meta.type === 'bulk-move'
          ? 'Move items'
          : job.type || 'Background task');

  const runningFallback = meta.destination ? `→ ${meta.destination}` : 'Working…';
  let message = job.message || resolveTemplate(meta.runningMessage, job, meta, meta.description || runningFallback);
  let variant = 'info';
  const actions = [];

  if (job.status === JobStatus.SUCCEEDED) {
    const successFallback = failureCount
      ? (successCount ? `${successCount} completed, ${failureCount} failed.` : 'Operation completed with errors.')
      : meta.destination
        ? `Completed → ${meta.destination}`
        : 'Completed.';
    variant = failureCount > 0 ? (successCount > 0 ? 'warning' : 'error') : 'success';
    message = job.message || resolveTemplate(meta.successMessage, job, meta, successFallback);
  } else if (job.status === JobStatus.FAILED) {
    variant = 'error';
    message = job.error || resolveTemplate(meta.failureMessage, job, meta, 'Job failed.');
  } else if (job.status === JobStatus.CANCELLED) {
    variant = 'warning';
    message = job.message || resolveTemplate(meta.cancelMessage, job, meta, 'Job cancelled.');
  }

  if (job.status === JobStatus.RUNNING || job.status === JobStatus.PENDING) {
    actions.push({
      label: 'Cancel',
      onClick: async () => {
        if (typeof jobsClient.cancelJob !== 'function') return;
        try {
          await jobsClient.cancelJob(job.id);
          toast(state.host, 'Cancellation requested.');
        } catch (err) {
          toast(state.host, err?.message || 'Failed to cancel job.');
        }
      },
    });
  }

  const progress = job.progress && typeof job.progress === 'object' ? job.progress : undefined;

  if (window.teUI && typeof window.teUI.notify === 'function') {
    window.teUI.notify({
      id: job.id,
      title: defaultTitle,
      message,
      variant,
      status: job.status,
      progress,
      actions,
      onDismiss: () => {
        jobTracker.jobs.delete(job.id);
        if (TERMINAL_STATUSES.has(job.status) && typeof jobsClient.deleteJob === 'function') {
          jobsClient.deleteJob(job.id).catch(() => {});
        }
        maybeStopJobFeed();
      },
    });
  }

  if (info.lastStatus !== job.status && TERMINAL_STATUSES.has(job.status)) {
    scheduleJobCleanup(state, job, info);
  }

  info.lastStatus = job.status;
}

function scheduleJobCleanup(state, job, info) {
  if (info.cleaned) return;
  info.cleaned = true;

  const meta = info.meta || {};
  const failureCount = Array.isArray(job.result?.failed) ? job.result.failed.length : 0;
  const successCount = Array.isArray(job.result?.succeeded) ? job.result.succeeded.length : 0;

  let toastMessage;
  if (job.status === JobStatus.SUCCEEDED) {
    const fallback = job.message
      || (failureCount
        ? (successCount ? `${successCount} completed, ${failureCount} failed.` : 'Operation completed with errors.')
        : meta.destination
          ? `Completed → ${meta.destination}`
          : 'Operation completed.');
    toastMessage = resolveTemplate(meta.successToast ?? meta.successMessage, job, meta, fallback);
  } else if (job.status === JobStatus.FAILED) {
    toastMessage = resolveTemplate(meta.failureToast ?? meta.failureMessage, job, meta, job.error || 'Job failed.');
  } else {
    toastMessage = resolveTemplate(meta.cancelToast ?? meta.cancelMessage, job, meta, job.message || 'Job cancelled.');
  }

  if (toastMessage) {
    toast(state.host, toastMessage);
  }

  if (job.status === JobStatus.SUCCEEDED) {
    const refreshTargets = new Set();
    if (Array.isArray(meta.refreshOnSuccess)) {
      meta.refreshOnSuccess.forEach((value) => {
        if (typeof value === 'string' && value) refreshTargets.add(value);
      });
    }
    if (typeof meta.destination === 'string' && meta.destination) {
      refreshTargets.add(meta.destination);
    }
    if (job.result?.destination) {
      refreshTargets.add(job.result.destination);
    }
    if (Array.isArray(job.result?.succeeded)) {
      job.result.succeeded.forEach((entry) => {
        if (entry?.destination) refreshTargets.add(entry.destination);
        if (entry?.source_parent) refreshTargets.add(entry.source_parent);
      });
    }

    if (typeof state.refresh === 'function') {
      for (const target of refreshTargets) {
        if (target === state.currentPath) {
          state.refresh();
        }
      }
    }
  }

  setTimeout(() => {
    window.teUI?.dismiss?.(job.id);
    jobTracker.jobs.delete(job.id);
    if (TERMINAL_STATUSES.has(job.status) && typeof jobsClient.deleteJob === 'function') {
      jobsClient.deleteJob(job.id).catch(() => {});
    }
    maybeStopJobFeed();
  }, 4000);
}

async function createJobRequest(type, params) {
  const response = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, params }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body.data || body;
}

export default function initFileExplorer(root, api, host) {
  const container = root.querySelector('[data-app-root]') || root;
  if (host && typeof host.setTitle === 'function') {
    host.setTitle('File Explorer');
  }

  const savedState = host && typeof host.loadState === 'function'
    ? host.loadState(null)
    : null;

  const prefs = {
    path: savedState?.path && typeof savedState.path === 'string' ? savedState.path : HOME_DIR,
    showHidden: !!(savedState && savedState.showHidden),
    view: savedState?.view === 'grid' ? 'grid' : 'list',
    sortBy: savedState?.sortBy || 'name',
    sortAsc: savedState?.sortAsc !== false,  // Default to ascending
  };

  const ui = {
    breadcrumbs: container.querySelector('[data-role="breadcrumbs"]'),
    listWrapper: container.querySelector('.fx-list-view'),
    listContainer: container.querySelector('[data-role="list"]'),
    gridWrapper: container.querySelector('.fx-grid-view'),
    gridContainer: container.querySelector('[data-role="grid"]'),
    btnUp: container.querySelector('[data-action="up"]'),
    btnNewFolder: container.querySelector('[data-action="new-folder"]'),
    btnNewFile: container.querySelector('[data-action="new-file"]'),
    btnOpen: container.querySelector('[data-action="open"]'),
    btnOpenEditor: container.querySelector('[data-action="open-editor"]'),
    btnExtractArchive: container.querySelector('[data-action="extract-archive"]'),
    btnProperties: container.querySelector('[data-action="properties"]'),
    btnRename: container.querySelector('[data-action="rename"]'),
    btnDelete: container.querySelector('[data-action="delete"]'),
    btnCopy: container.querySelector('[data-action="copy"]'),
    btnMove: container.querySelector('[data-action="move"]'),
    btnToggleView: container.querySelector('[data-action="toggle-view"]'),
    toggleHidden: container.querySelector('[data-action="toggle-hidden"]'),
    selectAll: container.querySelector('[data-action="select-all"]'),
    selectionCount: container.querySelector('.fx-selection-count'),
    sortSelect: container.querySelector('[data-action="sort-by"]'),
    btnSortDir: container.querySelector('[data-action="sort-dir"]'),
    propertiesModal: container.querySelector('[data-modal="properties"]'),
    propertiesOverlay: container.querySelector('[data-role="properties-overlay"]'),
    propertiesPath: container.querySelector('[data-role="properties-path"]'),
    propertiesNameInput: container.querySelector('[data-role="properties-name"]'),
    propertiesRecurse: container.querySelector('[data-role="properties-recurse"]'),
    propertiesOwnerInput: container.querySelector('[data-role="properties-owner-input"]'),
    propertiesGroupInput: container.querySelector('[data-role="properties-group-input"]'),
    propertiesOwnerCurrent: container.querySelector('[data-role="properties-owner-current"]'),
    propertiesGroupCurrent: container.querySelector('[data-role="properties-group-current"]'),
    propertiesClose: container.querySelector('[data-action="properties-close"]'),
    propertiesCancel: container.querySelector('[data-action="properties-cancel"]'),
    propertiesApply: container.querySelector('[data-action="properties-apply"]'),
    propertiesPermOwnerRead: container.querySelector('[data-role="perm-owner-read"]'),
    propertiesPermOwnerWrite: container.querySelector('[data-role="perm-owner-write"]'),
    propertiesPermOwnerExec: container.querySelector('[data-role="perm-owner-exec"]'),
    propertiesPermGroupRead: container.querySelector('[data-role="perm-group-read"]'),
    propertiesPermGroupWrite: container.querySelector('[data-role="perm-group-write"]'),
    propertiesPermGroupExec: container.querySelector('[data-role="perm-group-exec"]'),
    propertiesPermOthersRead: container.querySelector('[data-role="perm-others-read"]'),
    propertiesPermOthersWrite: container.querySelector('[data-role="perm-others-write"]'),
    propertiesPermOthersExec: container.querySelector('[data-role="perm-others-exec"]'),
  };

  const PROPERTIES_APPLY_DEFAULT_LABEL = ui.propertiesApply ? ui.propertiesApply.textContent : 'Apply';

  function applyPermissionsToInputs(perms) {
    const normalized = perms || {};
    const owner = normalized.owner || {};
    const group = normalized.group || {};
    const others = normalized.others || {};
    if (ui.propertiesPermOwnerRead) ui.propertiesPermOwnerRead.checked = !!owner.read;
    if (ui.propertiesPermOwnerWrite) ui.propertiesPermOwnerWrite.checked = !!owner.write;
    if (ui.propertiesPermOwnerExec) ui.propertiesPermOwnerExec.checked = !!owner.exec;
    if (ui.propertiesPermGroupRead) ui.propertiesPermGroupRead.checked = !!group.read;
    if (ui.propertiesPermGroupWrite) ui.propertiesPermGroupWrite.checked = !!group.write;
    if (ui.propertiesPermGroupExec) ui.propertiesPermGroupExec.checked = !!group.exec;
    if (ui.propertiesPermOthersRead) ui.propertiesPermOthersRead.checked = !!others.read;
    if (ui.propertiesPermOthersWrite) ui.propertiesPermOthersWrite.checked = !!others.write;
    if (ui.propertiesPermOthersExec) ui.propertiesPermOthersExec.checked = !!others.exec;
  }

  function getPermissionsFromInputs() {
    return {
      owner: {
        read: ui.propertiesPermOwnerRead ? ui.propertiesPermOwnerRead.checked : false,
        write: ui.propertiesPermOwnerWrite ? ui.propertiesPermOwnerWrite.checked : false,
        exec: ui.propertiesPermOwnerExec ? ui.propertiesPermOwnerExec.checked : false,
      },
      group: {
        read: ui.propertiesPermGroupRead ? ui.propertiesPermGroupRead.checked : false,
        write: ui.propertiesPermGroupWrite ? ui.propertiesPermGroupWrite.checked : false,
        exec: ui.propertiesPermGroupExec ? ui.propertiesPermGroupExec.checked : false,
      },
      others: {
        read: ui.propertiesPermOthersRead ? ui.propertiesPermOthersRead.checked : false,
        write: ui.propertiesPermOthersWrite ? ui.propertiesPermOthersWrite.checked : false,
        exec: ui.propertiesPermOthersExec ? ui.propertiesPermOthersExec.checked : false,
      },
    };
  }

  const state = {
    currentPath: prefs.path,
    entries: [],
    selected: null,
    selectedPaths: new Set(), // For batch operations
    view: prefs.view,
    sortBy: prefs.sortBy,
    sortAsc: prefs.sortAsc,
  };

  const menuGroups = Array.from(container.querySelectorAll('.fx-menu-group'));

  if (ui.toggleHidden) {
    ui.toggleHidden.checked = prefs.showHidden;
  }
  
  // Initialize sort controls
  if (ui.sortSelect) {
    ui.sortSelect.value = state.sortBy;
  }
  if (ui.btnSortDir) {
    ui.btnSortDir.textContent = state.sortAsc ? '↓' : '↑';
    ui.btnSortDir.title = state.sortAsc ? 'Sort ascending (click for descending)' : 'Sort descending (click for ascending)';
  }

  function persistState() {
    if (host && typeof host.saveState === 'function') {
      host.saveState({
        path: state.currentPath,
        showHidden: !!(ui.toggleHidden && ui.toggleHidden.checked),
        view: state.view,
        sortBy: state.sortBy,
        sortAsc: state.sortAsc,
      });
    }
  }

  function setLoading() {
    if (ui.listContainer) {
      ui.listContainer.innerHTML = '<div class="fx-loading">Loading...</div>';
    }
    if (ui.gridContainer) {
      ui.gridContainer.innerHTML = '';
      const loading = document.createElement('div');
      loading.className = 'fx-loading';
      loading.textContent = 'Loading...';
      ui.gridContainer.appendChild(loading);
    }
  }

  function clearSelection() {
    state.selected = null;
    state.selectedPaths.clear();
    container.querySelectorAll('.fx-item.selected, .fx-tile.selected').forEach((el) => {
      el.classList.remove('selected');
    });
    container.querySelectorAll('.fx-checkbox input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
    if (ui.selectAll) ui.selectAll.checked = false;
    updateSelectionCount();
    updateActionButtons();
  }
  
  function updateSelectionCount() {
    const count = state.selectedPaths.size;
    if (ui.selectionCount) {
      if (count > 0) {
        ui.selectionCount.textContent = `${count} selected`;
        ui.selectionCount.style.display = 'inline';
      } else {
        ui.selectionCount.style.display = 'none';
      }
    }
  }
  
  function toggleItemSelection(path, checked) {
    if (checked) {
      state.selectedPaths.add(path);
    } else {
      state.selectedPaths.delete(path);
    }
    updateSelectionCount();
    updateActionButtons();
    
    // Update select all checkbox state
    if (ui.selectAll) {
      const total = state.entries.length;
      const selected = state.selectedPaths.size;
      ui.selectAll.checked = selected > 0 && selected === total;
      ui.selectAll.indeterminate = selected > 0 && selected < total;
    }
  }
  
  function selectAllItems(checked) {
    if (checked) {
      // Select all items
      state.entries.forEach(entry => {
        state.selectedPaths.add(entry.path);
      });
      container.querySelectorAll('.fx-checkbox input[type="checkbox"]').forEach((cb) => {
        cb.checked = true;
      });
    } else {
      // Deselect all items
      state.selectedPaths.clear();
      container.querySelectorAll('.fx-checkbox input[type="checkbox"]').forEach((cb) => {
        cb.checked = false;
      });
    }
    updateSelectionCount();
    updateActionButtons();
  }

  function updateActionButtons() {
    const hasSelection = !!state.selected;
    const hasBatchSelection = state.selectedPaths.size > 0;
    const hasSingleSelection = state.selectedPaths.size === 1;
    
    // Open and properties only work with single selection
    if (ui.btnOpen) ui.btnOpen.disabled = !hasSelection;
    const canOpenInEditor = hasSelection && state.selected.type === 'file' && isEditableFile(state.selected.name);
    if (ui.btnOpenEditor) ui.btnOpenEditor.disabled = !canOpenInEditor;
    const canExtract = hasSelection && state.selected.type === 'file' && isArchive(state.selected.name);
    if (ui.btnExtractArchive) ui.btnExtractArchive.disabled = !canExtract;
    if (ui.btnProperties) ui.btnProperties.disabled = !hasSelection;
    
    // Rename only works with single selection (either click or checkbox)
    if (ui.btnRename) ui.btnRename.disabled = !(hasSelection || hasSingleSelection);
    
    // Copy, Move, Delete work with batch selections
    if (ui.btnDelete) ui.btnDelete.disabled = !(hasSelection || hasBatchSelection);
    if (ui.btnCopy) ui.btnCopy.disabled = !(hasSelection || hasBatchSelection);
    if (ui.btnMove) ui.btnMove.disabled = !(hasSelection || hasBatchSelection);
    
    if (ui.btnToggleView) {
      ui.btnToggleView.textContent = state.view === 'list' ? 'Grid View' : 'List View';
    }
  }

  function applyView() {
    if (ui.listWrapper) ui.listWrapper.style.display = state.view === 'list' ? 'block' : 'none';
    if (ui.gridWrapper) ui.gridWrapper.style.display = state.view === 'grid' ? 'block' : 'none';
    updateActionButtons();
    persistState();
  }

  function closeAllMenus() {
    menuGroups.forEach((group) => group.removeAttribute('data-open'));
  }

  const menuActions = {
    'file:new-folder': () => createFolder(),
    'file:new-file': () => createNewFile(),
    'file:open': () => openSelected(),
    'file:open-editor': () => openSelectedInEditor(),
    'file:extract': () => extractSelectedArchive(),
    'edit:properties': () => openSelectedProperties(),
    'edit:rename': () => renameSelected(),
    'edit:delete': () => deleteSelected(),
    'edit:copy': () => copySelected(),
    'edit:move': () => moveSelected(),
    'view:grid': () => {
      state.view = 'grid';
      applyView();
    },
    'view:list': () => {
      state.view = 'list';
      applyView();
    },
  };

  function handleMenuCommand(command) {
    if (!command) return;
    const action = menuActions[command];
    if (!action) return;
    try {
      const result = action();
      if (result && typeof result.then === 'function') {
        result.catch(() => {});
      }
    } catch (error) {
      toast(host, error?.message || 'Unable to complete action');
    }
  }

  function renderBreadcrumbs() {
    if (!ui.breadcrumbs) return;
    const path = state.currentPath;
    const crumbs = [];
    if (isWithinTermux(path)) {
      if (path === HOME_DIR || path.startsWith(`${HOME_DIR}/`)) {
        crumbs.push({ label: 'Home', value: HOME_DIR });
        const remainder = path.slice(HOME_DIR.length).split('/').filter(Boolean);
        let accumulator = HOME_DIR;
        remainder.forEach((segment) => {
          accumulator = `${accumulator.replace(/\/+$/, '')}/${segment}`;
          crumbs.push({ label: segment, value: accumulator });
        });
      } else {
        crumbs.push({ label: 'Termux', value: TERMUX_BASE || '/data/data/com.termux' });
        const relative = path.slice((TERMUX_BASE || '/data/data/com.termux').length).split('/').filter(Boolean);
        let accumulator = TERMUX_BASE || '/data/data/com.termux';
        relative.forEach((segment) => {
          accumulator = `${accumulator.replace(/\/+$/, '')}/${segment}`;
          crumbs.push({ label: segment, value: accumulator });
        });
      }
    } else {
      crumbs.push({ label: '⚡ /', value: '/' });
      const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);
      let accumulator = '';
      segments.forEach((segment) => {
        accumulator += `/${segment}`;
        crumbs.push({ label: segment, value: accumulator || '/' });
      });
    }

    ui.breadcrumbs.innerHTML = '';
    crumbs.forEach((crumb, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'fx-crumb-sep';
        sep.textContent = '/';
        ui.breadcrumbs.appendChild(sep);
      }
      const span = document.createElement('span');
      span.className = 'fx-crumb' + (index === crumbs.length - 1 ? ' current' : '');
      span.textContent = crumb.label || '/';
      if (index !== crumbs.length - 1) {
        span.addEventListener('click', () => {
          loadDirectory(crumb.value);
        });
      }
      ui.breadcrumbs.appendChild(span);
    });
  }

  function selectEntry(entry, nodes) {
    state.selected = entry;
    container.querySelectorAll('.fx-item.selected, .fx-tile.selected').forEach((el) => el.classList.remove('selected'));
    if (nodes.row) nodes.row.classList.add('selected');
    if (nodes.tile) nodes.tile.classList.add('selected');
    updateActionButtons();
  }

  function renderEntries() {
    if (!ui.listContainer || !ui.gridContainer) return;
    ui.listContainer.innerHTML = '';
    ui.gridContainer.innerHTML = '';

    const entries = state.entries.slice().sort((a, b) => {
      // Directories always come first
      const dirOrder = Number(a.type !== 'directory') - Number(b.type !== 'directory');
      if (dirOrder !== 0) return dirOrder;
      
      // Then sort by selected field
      let cmp = 0;
      switch (state.sortBy) {
        case 'size':
          cmp = (a.size || 0) - (b.size || 0);
          break;
        case 'date':
          cmp = (a.mtime || 0) - (b.mtime || 0);
          break;
        case 'type':
          // Sort by extension then name
          const extA = a.name.includes('.') ? a.name.split('.').pop().toLowerCase() : '';
          const extB = b.name.includes('.') ? b.name.split('.').pop().toLowerCase() : '';
          cmp = extA.localeCompare(extB);
          if (cmp === 0) {
            cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          }
          break;
        case 'name':
        default:
          cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
      }
      
      // Apply sort direction
      return state.sortAsc ? cmp : -cmp;
    });

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'fx-empty';
      empty.textContent = 'This directory is empty.';
      ui.listContainer.appendChild(empty);
      const emptyGrid = empty.cloneNode(true);
      ui.gridContainer.appendChild(emptyGrid);
      return;
    }

    entries.forEach((entry) => {
      const isDir = entry.type === 'directory';
      const isSymlink = entry.type === 'symlink';
      const isFile = entry.type === 'file';
      const isEditable = isFile && isEditableFile(entry.name);
      const isArchiveFile = isFile && isArchive(entry.name);
      
      // For symlinks, add arrow indicator to show it's a link
      let nameDisplay = isSymlink ? `${entry.name} →` : entry.name;
      
      // Create row for list view
      const row = document.createElement('div');
      row.className = 'fx-item';
      if (isSymlink) row.classList.add('fx-symlink');
      
      // Add archive badge if applicable
      const archiveBadge = isArchiveFile ? '<span class="fx-archive-badge">📦 Archive</span>' : '';
      
      // Format permissions and ownership
      const permStr = modeToString(entry.mode, entry.type);
      const ownerStr = formatOwnership(entry.owner, entry.group);

      row.innerHTML = `
        <span class="fx-checkbox">
          <input type="checkbox" data-path="${entry.path}" aria-label="Select ${entry.name}">
        </span>
        <span class="fx-icon">${TYPE_ICON[entry.type] || TYPE_ICON.unknown}</span>
        <div class="fx-name-group">
          <span class="fx-name">${nameDisplay}</span>
          ${archiveBadge}
        </div>
        <span class="fx-permissions">${permStr}</span>
        <span class="fx-owner">${ownerStr}</span>
        <span class="fx-size">${isDir ? '' : formatSize(entry.size)}</span>
        <span class="fx-date">${formatDate(entry.mtime)}</span>
      `;

      // Create tile for grid view
      const tile = document.createElement('div');
      tile.className = 'fx-tile';
      if (isSymlink) tile.classList.add('fx-symlink');
      tile.innerHTML = `
        <div class="fx-icon-lg">${TYPE_ICON[entry.type] || TYPE_ICON.unknown}</div>
        <div class="fx-name-tile">${nameDisplay}${archiveBadge}</div>
      `;
      // Add checkbox event listener
      const checkbox = row.querySelector('.fx-checkbox input[type="checkbox"]');
      if (checkbox) {
        checkbox.addEventListener('change', (e) => {
          e.stopPropagation();
          toggleItemSelection(entry.path, e.target.checked);
        });
        
        // Restore checked state if item was previously selected
        if (state.selectedPaths.has(entry.path)) {
          checkbox.checked = true;
        }
      }
      
      const handleSelect = (e) => {
        // Don't select if clicking on checkbox
        if (e.target.type === 'checkbox' || e.target.closest('.fx-checkbox')) {
          return;
        }
        closeAllMenus();
        selectEntry(entry, { row, tile });
      };

      row.addEventListener('click', handleSelect);
      tile.addEventListener('click', handleSelect);

      if (isSymlink) {
        // For symlinks, resolve and follow on double-click
        const handleSymlink = async (ev) => {
          ev?.preventDefault();
          await followSymlink(entry);
        };
        row.addEventListener('dblclick', handleSymlink);
        tile.addEventListener('dblclick', handleSymlink);
      } else if (isDir) {
        const openDir = (ev) => {
          ev?.preventDefault();
          loadDirectory(entry.path);
        };
        row.addEventListener('dblclick', openDir);
        tile.addEventListener('dblclick', openDir);
      } else {
        const openFile = (ev) => {
          ev?.preventDefault();
          openSelected();
        };
        row.addEventListener('dblclick', openFile);
        tile.addEventListener('dblclick', openFile);
      }

      ui.listContainer.appendChild(row);
      ui.gridContainer.appendChild(tile);
    });
  }

  async function loadDirectory(targetPath) {
    const normalized = targetPath || state.currentPath || HOME_DIR;
    closeAllMenus();
    clearSelection();
    setLoading();
    try {
      const hiddenParam = ui.toggleHidden && ui.toggleHidden.checked ? '1' : '0';
      const payload = await api.get(`list?path=${encodeURIComponent(normalized)}&hidden=${hiddenParam}`);
      const entries = Array.isArray(payload) ? payload : [];
      state.currentPath = normalized;
      state.entries = entries;
      state.selected = null;
      renderBreadcrumbs();
      renderEntries();
      updateActionButtons();
      state.view = state.view === 'grid' ? 'grid' : 'list';
      applyView();
      persistState();
    } catch (error) {
      const message = error?.message || 'Failed to load directory';
      if (ui.listContainer) {
        ui.listContainer.innerHTML = '';
        const node = document.createElement('div');
        node.className = 'fx-empty';
        node.style.color = '#fca5a5';
        node.textContent = message;
        ui.listContainer.appendChild(node);
      }
      if (ui.gridContainer) {
        ui.gridContainer.innerHTML = '';
        const node = document.createElement('div');
        node.className = 'fx-empty';
        node.style.color = '#fca5a5';
        node.textContent = message;
        ui.gridContainer.appendChild(node);
      }
      toast(host, message);
    }
  }

  async function createFolder() {
    const base = state.currentPath;
    const name = (prompt('New folder name:') || '').trim();
    if (!name) return;
    if (/[\\/]/.test(name) || name === '.' || name === '..') {
      toast(host, 'Invalid folder name');
      return;
    }
    try {
      await api.post('mkdir', { path: base, name });
      toast(host, `Created folder "${name}"`);
      await loadDirectory(base);
    } catch (error) {
      toast(host, error?.message || 'Failed to create folder');
    }
  }

  async function createNewFile() {
    if (!window.teFilePicker || typeof window.teFilePicker.saveFile !== 'function') {
      // Fallback to prompt if file picker unavailable
      const name = (prompt('New file name:') || '').trim();
      if (!name) return;
      if (/[\\/]/.test(name)) {
        toast(host, 'Invalid file name');
        return;
      }
      const fullPath = `${state.currentPath.replace(/\/$/, '')}/${name}`;
      // Create empty file and open in editor
      window.location.href = `/app/file_editor?file=${encodeURIComponent(fullPath)}`;
      return;
    }

    try {
      const result = await window.teFilePicker.saveFile({
        title: 'Create New File',
        startPath: state.currentPath,
        filename: 'untitled.txt',
        selectLabel: 'Create',
      });
      
      if (!result || !result.path) return;
      
      // Create empty file and open in editor
      window.location.href = `/app/file_editor?file=${encodeURIComponent(result.path)}`;
    } catch (error) {
      if (error && error.message === 'cancelled') return;
      toast(host, error?.message || 'Failed to create file');
    }
  }

  async function renameSelected() {
    if (!state.selected) return;
    const next = (prompt('Rename to:', state.selected.name) || '').trim();
    if (!next || next === state.selected.name) return;
    try {
      await api.post('rename', { path: state.selected.path, name: next });
      toast(host, `Renamed to "${next}"`);
      await loadDirectory(state.currentPath);
    } catch (error) {
      toast(host, error?.message || 'Failed to rename');
    }
  }

  async function deleteSelected() {
    // Check if we have batch selection
    if (state.selectedPaths.size > 0) {
      const count = state.selectedPaths.size;
      const confirmed = confirm(`Delete ${count} selected item${count > 1 ? 's' : ''}? This cannot be undone.`);
      if (!confirmed) return;
      
      let succeeded = 0;
      let failed = 0;
      const errors = [];
      
      // Process each selected item
      for (const path of state.selectedPaths) {
        try {
          await api.post('delete', { path });
          succeeded++;
        } catch (error) {
          failed++;
          errors.push(`${path}: ${error?.message || 'Failed'}`);
        }
      }
      
      // Show results
      if (succeeded > 0 && failed === 0) {
        toast(host, `Successfully deleted ${succeeded} item${succeeded > 1 ? 's' : ''}`);
      } else if (succeeded > 0 && failed > 0) {
        toast(host, `Deleted ${succeeded} item${succeeded > 1 ? 's' : ''}, ${failed} failed`);
        console.error('Delete errors:', errors);
      } else {
        toast(host, `Failed to delete ${failed} item${failed > 1 ? 's' : ''}`);
      }
      
      clearSelection();
      await loadDirectory(state.currentPath);
      return;
    }
    
    // Single selection fallback
    if (!state.selected) return;
    const confirmed = confirm(`Delete "${state.selected.name}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await api.post('delete', { path: state.selected.path });
      toast(host, `Deleted "${state.selected.name}"`);
      await loadDirectory(state.currentPath);
    } catch (error) {
      toast(host, error?.message || 'Failed to delete');
    }
  }

  async function copySelected() {
    // Check if we have batch selection
    if (state.selectedPaths.size > 0) {
      if (!window.teFilePicker || typeof window.teFilePicker.openDirectory !== 'function') {
        toast(host, 'File picker unavailable');
        return;
      }

      const sources = Array.from(state.selectedPaths);
      const count = sources.length;
      try {
        const choice = await window.teFilePicker.openDirectory({ 
          title: `Copy ${count} item${count > 1 ? 's' : ''} to...`, 
          startPath: state.currentPath 
        });
        if (!choice || !choice.path) return;

        let jobStarted = false;
        if (hasJobSupport()) {
          try {
            const job = await createJobRequest('bulk_copy', {
              sources,
              destination: choice.path,
            });
            trackBulkOperationJob(state, job, {
              type: 'bulk-copy',
              title: `Copy ${count} item${count > 1 ? 's' : ''}`,
              destination: choice.path,
              runningMessage: `Copying → ${choice.path}`,
              successMessage: (jobInfo) => jobInfo?.message || `Copied to ${choice.path}`,
              failureMessage: (jobInfo) => jobInfo?.error || 'Copy failed.',
              cancelMessage: 'Copy cancelled.',
              successToast: (jobInfo) => jobInfo?.message || `Copied to ${choice.path}`,
              failureToast: (jobInfo) => jobInfo?.error || 'Copy failed.',
              cancelToast: 'Copy cancelled.',
              refreshOnSuccess: [choice.path].filter(Boolean),
            });
            toast(host, 'Copy started.');
            clearSelection();
            jobStarted = true;
          } catch (error) {
            console.error('[file-explorer] bulk_copy job failed', error);
            toast(host, error?.message || 'Failed to start copy job');
          }
        }

        if (jobStarted) return;

        let succeeded = 0;
        let failed = 0;
        const errors = [];

        // Process each selected item synchronously as a fallback
        for (const sourcePath of sources) {
          try {
            const filename = sourcePath.split('/').pop();
            const destPath = `${choice.path}/${filename}`;
            await api.post('copy', { source: sourcePath, dest: destPath });
            succeeded++;
          } catch (error) {
            failed++;
            errors.push(`${sourcePath}: ${error?.message || 'Failed'}`);
          }
        }

        if (succeeded > 0 && failed === 0) {
          toast(host, `Successfully copied ${succeeded} item${succeeded > 1 ? 's' : ''} to ${choice.path}`);
        } else if (succeeded > 0 && failed > 0) {
          toast(host, `Copied ${succeeded} item${succeeded > 1 ? 's' : ''}, ${failed} failed`);
          console.error('Copy errors:', errors);
        } else {
          toast(host, `Failed to copy ${failed} item${failed > 1 ? 's' : ''}`);
        }

        clearSelection();
        if (choice.path === state.currentPath || parentPath(choice.path) === state.currentPath) {
          await loadDirectory(state.currentPath);
        }
      } catch (error) {
        if (error && error.message === 'cancelled') return;
        toast(host, error?.message || 'Copy failed');
      }
      return;
    }
    
    // Single selection fallback
    if (!state.selected) return;
    if (!window.teFilePicker || typeof window.teFilePicker.saveFile !== 'function') {
      toast(host, 'File picker unavailable');
      return;
    }
    try {
      const startDir = state.currentPath;
      const pickerResult = await window.teFilePicker.saveFile({
        title: 'Copy As...',
        startPath: startDir,
        filename: state.selected.name,
        selectLabel: 'Copy',
      });
      if (!pickerResult || !pickerResult.path) return;
      const destPath = pickerResult.path;
      const destParent = parentPath(destPath);

      let jobStarted = false;
      if (hasJobSupport()) {
        try {
          const job = await createJobRequest('bulk_copy', {
            sources: [state.selected.path],
            destination: destParent || null,
            destinations: { [state.selected.path]: destPath },
          });
          trackBulkOperationJob(state, job, {
            type: 'bulk-copy',
            title: `Copy ${state.selected.name}`,
            destination: destParent || destPath,
            runningMessage: `Copying → ${destPath}`,
            successMessage: (jobInfo) => jobInfo?.message || `Copied to ${destPath}`,
            failureMessage: (jobInfo) => jobInfo?.error || 'Copy failed.',
            cancelMessage: 'Copy cancelled.',
            successToast: (jobInfo) => jobInfo?.message || `Copied to ${destPath}`,
            failureToast: (jobInfo) => jobInfo?.error || 'Copy failed.',
            cancelToast: 'Copy cancelled.',
            refreshOnSuccess: [destParent, state.currentPath].filter(Boolean),
          });
          toast(host, 'Copy started.');
          jobStarted = true;
        } catch (error) {
          console.error('[file-explorer] single copy job failed', error);
          toast(host, error?.message || 'Failed to start copy job');
        }
      }

      if (jobStarted) {
        clearSelection();
        return;
      }

      await api.post('copy', { source: state.selected.path, dest: pickerResult.path });
      toast(host, `Copied "${state.selected.name}" to ${pickerResult.path}`);
      if (destParent === state.currentPath) {
        await loadDirectory(state.currentPath);
      }
      clearSelection();
    } catch (error) {
      if (error && error.message === 'cancelled') return;
      toast(host, error?.message || 'Copy failed');
    }
  }

  async function moveSelected() {
    // Check if we have batch selection
    if (state.selectedPaths.size > 0) {
      if (!window.teFilePicker || typeof window.teFilePicker.openDirectory !== 'function') {
        toast(host, 'File picker unavailable');
        return;
      }

      const sources = Array.from(state.selectedPaths);
      const count = sources.length;
      try {
        const choice = await window.teFilePicker.openDirectory({ 
          title: `Move ${count} item${count > 1 ? 's' : ''} to...`, 
          startPath: state.currentPath 
        });
        if (!choice || !choice.path) return;

        let jobStarted = false;
        if (hasJobSupport()) {
          try {
            const job = await createJobRequest('bulk_move', {
              sources,
              destination: choice.path,
            });
            trackBulkOperationJob(state, job, {
              type: 'bulk-move',
              title: `Move ${count} item${count > 1 ? 's' : ''}`,
              destination: choice.path,
              runningMessage: `Moving → ${choice.path}`,
              successMessage: (jobInfo) => jobInfo?.message || `Moved to ${choice.path}`,
              failureMessage: (jobInfo) => jobInfo?.error || 'Move failed.',
              cancelMessage: 'Move cancelled.',
              successToast: (jobInfo) => jobInfo?.message || `Moved to ${choice.path}`,
              failureToast: (jobInfo) => jobInfo?.error || 'Move failed.',
              cancelToast: 'Move cancelled.',
              refreshOnSuccess: [state.currentPath, choice.path].filter(Boolean),
            });
            toast(host, 'Move started.');
            clearSelection();
            jobStarted = true;
          } catch (error) {
            console.error('[file-explorer] bulk_move job failed', error);
            toast(host, error?.message || 'Failed to start move job');
          }
        }

        if (jobStarted) return;

        let succeeded = 0;
        let failed = 0;
        const errors = [];

        for (const sourcePath of sources) {
          try {
            await api.post('move', { source: sourcePath, dest: choice.path });
            succeeded++;
          } catch (error) {
            failed++;
            errors.push(`${sourcePath}: ${error?.message || 'Failed'}`);
          }
        }

        if (succeeded > 0 && failed === 0) {
          toast(host, `Successfully moved ${succeeded} item${succeeded > 1 ? 's' : ''} to ${choice.path}`);
        } else if (succeeded > 0 && failed > 0) {
          toast(host, `Moved ${succeeded} item${succeeded > 1 ? 's' : ''}, ${failed} failed`);
          console.error('Move errors:', errors);
        } else {
          toast(host, `Failed to move ${failed} item${failed > 1 ? 's' : ''}`);
        }

        clearSelection();
        await loadDirectory(state.currentPath);
      } catch (error) {
        if (error && error.message === 'cancelled') return;
        toast(host, error?.message || 'Move failed');
      }
      return;
    }
    
    // Single selection fallback
    if (!state.selected) return;
    if (!window.teFilePicker || typeof window.teFilePicker.openDirectory !== 'function') {
      toast(host, 'File picker unavailable');
      return;
    }
    try {
      const choice = await window.teFilePicker.openDirectory({ title: 'Move to...', startPath: state.currentPath });
      if (!choice || !choice.path) return;
      await api.post('move', { source: state.selected.path, dest: choice.path });
      toast(host, `Moved "${state.selected.name}" to ${choice.path}`);
      await loadDirectory(state.currentPath);
    } catch (error) {
      if (error && error.message === 'cancelled') return;
      toast(host, error?.message || 'Move failed');
    }
  }

  async function followSymlink(entry) {
    try {
      const response = await api.get(`resolve_symlink?path=${encodeURIComponent(entry.path)}`);
      if (response.is_symlink && response.target_exists) {
        if (response.target_type === 'directory') {
          loadDirectory(response.target);
        } else if (response.target_type === 'file') {
          if (isArchive(response.target)) {
            await launchArchiveManager({ path: response.target, name: response.target.split('/').pop() || response.target });
          } else {
            // Open target file in editor
            window.location.href = `/app/file_editor?file=${encodeURIComponent(response.target)}`;
          }
        } else if (response.target_type === 'symlink') {
          toast(host, 'Target is another symlink. Following...');
          // Follow chain of symlinks
          await followSymlink({ path: response.target });
        }
      } else if (!response.target_exists) {
        toast(host, 'Symlink target does not exist');
      } else {
        // Not a symlink, handle normally
        if (entry.type === 'directory') {
          loadDirectory(entry.path);
        } else {
          window.location.href = `/app/file_editor?file=${encodeURIComponent(entry.path)}`;
        }
      }
    } catch (error) {
      toast(host, error?.message || 'Failed to resolve symlink');
    }
  }

  async function openSelected() {
    if (!state.selected) return;

    if (state.selected.type === 'symlink') {
      // Follow symlink to its target
      await followSymlink(state.selected);
    } else if (state.selected.type === 'directory') {
      loadDirectory(state.selected.path);
    } else {
      if (isArchive(state.selected.name)) {
        await launchArchiveManager(state.selected);
        return;
      }
      // Check if file can be edited
      if (!isEditableFile(state.selected.name)) {
        toast(host, 'This file type cannot be opened in the text editor');
        return;
      }
      // Open file in editor
      const target = state.selected.path;
      window.location.href = `/app/file_editor?file=${encodeURIComponent(target)}`;
    }
  }
  
  function openInEditor(filePath) {
    // Open file directly in the file_editor app
    window.location.href = `/app/file_editor?file=${encodeURIComponent(filePath)}`;
  }

  async function openSelectedInEditor() {
    if (!state.selected) return;

    let targetPath = state.selected.path;
    let targetName = state.selected.name;

    if (state.selected.type === 'directory') {
      toast(host, 'Select a file to open in the editor');
      return;
    }

    if (state.selected.type === 'symlink') {
      try {
        const info = await api.get(`resolve_symlink?path=${encodeURIComponent(state.selected.path)}`);
        if (!info.target_exists) {
          toast(host, 'Symlink target does not exist');
          return;
        }
        if (info.target_type === 'directory') {
          toast(host, 'Symlink points to a directory');
          return;
        }
        if (info.target_type === 'symlink') {
          toast(host, 'Symlink chain not supported for editor');
          return;
        }
        targetPath = info.target;
        targetName = info.target.split('/').pop() || info.target;
      } catch (error) {
        toast(host, error?.message || 'Failed to resolve symlink');
        return;
      }
    }

    if (isArchive(targetName)) {
      toast(host, 'Open archives with the Archive Manager');
      return;
    }

    let size = Number(state.selected.size);
    if (state.selected.type === 'symlink' || !Number.isFinite(size) || size <= 0) {
      const meta = await fetchProperties({ path: targetPath });
      if (!meta) return;
      size = Number(meta.size);
    }
    if (Number.isFinite(size) && size > MAX_EDITOR_SIZE) {
      toast(host, 'File is too large to open in the editor');
      return;
    }

    openInEditor(targetPath);
  }

  async function extractArchive(entry) {
    if (!entry) return;
    if (!window.teFilePicker || typeof window.teFilePicker.openDirectory !== 'function') {
      toast(host, 'File picker unavailable');
      return;
    }
    try {
      const dest = await window.teFilePicker.openDirectory({
        title: 'Extract Archive To…',
        startPath: state.currentPath,
        selectLabel: 'Extract Here',
      });
      if (!dest || !dest.path) return;

      if (hasJobSupport()) {
        const job = await createJobRequest('extract_archive', {
          archive_path: entry.path,
          items: [],
          destination: dest.path,
          options: { overwrite: 'rename', password: null },
        });
        trackArchiveExtractionJob(state, job, {
          archivePath: entry.path,
          archiveName: entry.name,
          destination: dest.path,
          itemCount: 0,
          runningMessage: dest.path ? `Extracting → ${dest.path}` : 'Extracting…',
          successMessage: () => `Extracted to ${dest.path}`,
          failureMessage: 'Extraction failed.',
          cancelMessage: 'Extraction cancelled.',
          successToast: () => `Extracted to ${dest.path}`,
          failureToast: (jobInfo) => jobInfo?.error || 'Extraction failed.',
          cancelToast: 'Extraction cancelled.',
          refreshOnSuccess: [dest.path],
        });
        toast(host, 'Extraction started.');
      } else {
        toast(host, 'Extracting archive…');
        const response = await fetch('/api/app/archive_manager/archives/expand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            archive_path: entry.path,
            destination: dest.path,
            options: { overwrite: 'rename', password: null },
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.ok === false) {
          const message = body?.error || `Extraction failed (HTTP ${response.status})`;
          throw new Error(message);
        }
        toast(host, `Archive extracted to ${dest.path}`);
        if (dest.path === state.currentPath) {
          await loadDirectory(state.currentPath);
        }
      }
    } catch (error) {
      if (error && error.message === 'cancelled') return;
      toast(host, error?.message || 'Extraction failed');
    }
  }

  function extractSelectedArchive() {
    if (!state.selected) return;
    const entry = state.selected;
    if (entry.type !== 'file' || !isArchive(entry.name)) {
      toast(host, 'Select an archive to extract');
      return;
    }
    extractArchive(entry);
  }

  async function launchArchiveManager(targetEntry, options = {}) {
    const archivePath = typeof targetEntry === 'string' ? targetEntry : targetEntry?.path;
    if (!archivePath) {
      toast(host, 'Archive path missing');
      return;
    }
    const payload = {
      archive_path: archivePath,
      filesystem_path: state.currentPath,
      show_hidden: !!(ui.toggleHidden && ui.toggleHidden.checked),
    };
    if (options.internal) payload.internal = options.internal;
    if (options.destination) payload.destination = options.destination;

    try {
      closeAllMenus();
      const response = await fetch('/api/app/archive_manager/archives/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        const message = body?.error || `Failed to open archive (HTTP ${response.status})`;
        throw new Error(message);
      }
      const data = body.data || {};
      if (!data.app_url) {
        throw new Error('Archive Manager did not provide a launch URL');
      }
      window.location.href = data.app_url;
    } catch (error) {
      toast(host, error?.message || 'Unable to open archive');
    }
  }

  let propertiesContext = null;

  function setPropertiesModalOpen(open) {
    if (!ui.propertiesModal) return;
    if (open) {
      ui.propertiesModal.dataset.open = 'true';
      ui.propertiesModal.setAttribute('aria-hidden', 'false');
    } else {
      delete ui.propertiesModal.dataset.open;
      ui.propertiesModal.setAttribute('aria-hidden', 'true');
    }
  }

  function openPropertiesModal(entry, metadata) {
    if (!ui.propertiesModal || !entry) return;

    const resolvedPath = metadata?.path || entry.path;
    let modeValue = metadata?.mode_int;
    if (!Number.isFinite(modeValue)) {
      const modeString = metadata?.mode_octal || metadata?.mode || null;
      const parsed = modeString ? parseInt(`${modeString}`.replace(/^0o/, ''), 8) : NaN;
      modeValue = Number.isFinite(parsed) ? parsed : 0;
    }

    const permissions = metadata?.permissions
      ? JSON.parse(JSON.stringify(metadata.permissions))
      : modeToPermissions(modeValue);

    propertiesContext = {
      entry: { ...entry },
      metadata: {
        ...(metadata || {}),
        path: resolvedPath,
        is_directory: metadata?.is_directory ?? entry.type === 'directory',
        is_symlink: metadata?.is_symlink ?? entry.type === 'symlink',
        mode_int: modeValue,
        mode_octal: metadata?.mode_octal || modeValue.toString(8).padStart(3, '0'),
        owner: metadata?.owner ?? '',
        group: metadata?.group ?? '',
        permissions,
      },
    };

    if (ui.propertiesPath) {
      ui.propertiesPath.textContent = resolvedPath;
      ui.propertiesPath.title = `Permissions: ${propertiesContext.metadata.mode_octal}`;
    }
    if (ui.propertiesNameInput) {
      ui.propertiesNameInput.value = metadata?.name || entry.name;
      ui.propertiesNameInput.select?.();
    }
    const ownerValue = metadata?.owner ? String(metadata.owner) : '';
    const groupValue = metadata?.group ? String(metadata.group) : '';
    if (ui.propertiesOwnerInput) ui.propertiesOwnerInput.value = ownerValue;
    if (ui.propertiesGroupInput) ui.propertiesGroupInput.value = groupValue;
    if (ui.propertiesOwnerCurrent) ui.propertiesOwnerCurrent.textContent = ownerValue || '—';
    if (ui.propertiesGroupCurrent) ui.propertiesGroupCurrent.textContent = groupValue || '—';
    if (ui.propertiesRecurse) {
      const allowRecursive = !!(propertiesContext.metadata?.is_directory && !propertiesContext.metadata?.is_symlink);
      ui.propertiesRecurse.checked = false;
      ui.propertiesRecurse.disabled = !allowRecursive;
    }

    applyPermissionsToInputs(permissions);

    if (ui.propertiesApply) {
      ui.propertiesApply.disabled = false;
      ui.propertiesApply.textContent = PROPERTIES_APPLY_DEFAULT_LABEL;
    }

    setPropertiesModalOpen(true);
    if (ui.propertiesNameInput) {
      setTimeout(() => ui.propertiesNameInput?.focus({ preventScroll: true }), 40);
    }
  }

  function closePropertiesModal() {
    propertiesContext = null;
    setPropertiesModalOpen(false);
    if (ui.propertiesApply) {
      ui.propertiesApply.disabled = false;
      ui.propertiesApply.textContent = PROPERTIES_APPLY_DEFAULT_LABEL;
    }
    if (ui.propertiesRecurse) {
      ui.propertiesRecurse.checked = false;
      ui.propertiesRecurse.disabled = false;
    }
    if (ui.propertiesOwnerInput) ui.propertiesOwnerInput.value = '';
    if (ui.propertiesGroupInput) ui.propertiesGroupInput.value = '';
    if (ui.propertiesOwnerCurrent) ui.propertiesOwnerCurrent.textContent = '—';
    if (ui.propertiesGroupCurrent) ui.propertiesGroupCurrent.textContent = '—';
  }

  async function fetchProperties(entry) {
    try {
      const payload = await api.get(`properties?path=${encodeURIComponent(entry.path)}`);
      return payload;
    } catch (error) {
      toast(host, error?.message || 'Failed to fetch properties');
      return null;
    }
  }

  async function showProperties(entry) {
    if (!entry) {
      toast(host, 'Select an item to view properties');
      return;
    }
    const data = await fetchProperties(entry);
    if (!data) return;

    openPropertiesModal(entry, data);
  }

  async function openSelectedProperties() {
    if (!state.selected) {
      toast(host, 'Select an item to view properties');
      return;
    }
    await showProperties(state.selected);
  }

  async function applyPropertiesChanges() {
    if (!propertiesContext) {
      closePropertiesModal();
      return;
    }

    const applyBtn = ui.propertiesApply;
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying…';
    }

    const { entry, metadata } = propertiesContext;
    const originalPath = metadata?.path || entry.path;
    const originalName = metadata?.name || entry.name;
    const parentDir = parentPath(originalPath);
    const newNameRaw = ui.propertiesNameInput ? ui.propertiesNameInput.value.trim() : originalName;
    const newName = newNameRaw || originalName;
    const renameChanged = newName !== originalName;

    const recursive = !!(ui.propertiesRecurse && ui.propertiesRecurse.checked && metadata?.is_directory && !metadata?.is_symlink);
    const newPermissions = getPermissionsFromInputs();
    const newModeValue = permissionsToMode(newPermissions);
    const originalModeValue = metadata?.mode_int ?? permissionsToMode(metadata?.permissions || modeToPermissions(0));
    const modeChanged = newModeValue !== originalModeValue;
    const ownerInput = ui.propertiesOwnerInput ? ui.propertiesOwnerInput.value.trim() : '';
    const groupInput = ui.propertiesGroupInput ? ui.propertiesGroupInput.value.trim() : '';
    const originalOwner = metadata?.owner ? String(metadata.owner) : '';
    const originalGroup = metadata?.group ? String(metadata.group) : '';
    const ownerChanged = !!(ownerInput && ownerInput !== originalOwner);
    const groupChanged = !!(groupInput && groupInput !== originalGroup);

    let currentPath = originalPath;
    let hadChange = false;

    try {
      if (renameChanged) {
        await api.post('rename', { path: originalPath, name: newName });
        currentPath = joinPath(parentDir, newName);
        propertiesContext.entry.name = newName;
        propertiesContext.entry.path = currentPath;
        propertiesContext.metadata.name = newName;
        propertiesContext.metadata.path = currentPath;
        if (ui.propertiesPath) ui.propertiesPath.textContent = currentPath;
        hadChange = true;
        toast(host, `Renamed to "${newName}"`);
      }

      if (modeChanged) {
        const modeStr = newModeValue.toString(8).padStart(3, '0');
        await api.post('chmod', {
          path: currentPath,
          mode: modeStr,
          recursive,
        });
        propertiesContext.metadata.mode_int = newModeValue;
        propertiesContext.metadata.mode_octal = modeStr;
        propertiesContext.metadata.permissions = newPermissions;
        if (ui.propertiesPath) ui.propertiesPath.title = `Permissions: ${modeStr}`;
        hadChange = true;
        toast(host, `Permissions updated to ${modeStr}${recursive ? ' (recursive)' : ''}`);
      }

      if (ownerChanged || groupChanged) {
        await api.post('chown', {
          path: currentPath,
          user: ownerChanged ? ownerInput : '',
          group: groupChanged ? groupInput : '',
        });
        if (ownerChanged) {
          propertiesContext.metadata.owner = ownerInput;
          if (ui.propertiesOwnerInput) ui.propertiesOwnerInput.value = ownerInput;
          if (ui.propertiesOwnerCurrent) ui.propertiesOwnerCurrent.textContent = ownerInput || '—';
        }
        if (groupChanged) {
          propertiesContext.metadata.group = groupInput;
          if (ui.propertiesGroupInput) ui.propertiesGroupInput.value = groupInput;
          if (ui.propertiesGroupCurrent) ui.propertiesGroupCurrent.textContent = groupInput || '—';
        }
        hadChange = true;
        toast(host, 'Ownership updated');
      }

      if (!hadChange) {
        toast(host, 'No changes to apply');
        return;
      }

      await loadDirectory(state.currentPath);
      closePropertiesModal();
    } catch (error) {
      toast(host, error?.message || 'Failed to apply properties');
    } finally {
      if (ui.propertiesApply) {
        ui.propertiesApply.disabled = false;
        ui.propertiesApply.textContent = PROPERTIES_APPLY_DEFAULT_LABEL;
      }
    }
  }

  menuGroups.forEach((group) => {
    const toggle = group.querySelector('[data-menu-toggle]');
    const commands = group.querySelectorAll('[data-command]');
    if (toggle) {
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = group.hasAttribute('data-open');
        closeAllMenus();
        if (!isOpen) {
          group.setAttribute('data-open', 'true');
        }
      });
    }
    commands.forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeAllMenus();
        handleMenuCommand(btn.dataset.command);
      });
    });
  });

  if (ui.btnUp) {
    ui.btnUp.addEventListener('click', () => {
      const parent = parentPath(state.currentPath);
      loadDirectory(parent);
    });
  }
  if (ui.btnNewFolder) ui.btnNewFolder.addEventListener('click', createFolder);
  if (ui.btnNewFile) ui.btnNewFile.addEventListener('click', createNewFile);
  if (ui.btnOpen) ui.btnOpen.addEventListener('click', openSelected);
  if (ui.btnOpenEditor) ui.btnOpenEditor.addEventListener('click', openSelectedInEditor);
  if (ui.btnExtractArchive) ui.btnExtractArchive.addEventListener('click', extractSelectedArchive);
  if (ui.btnProperties) ui.btnProperties.addEventListener('click', openSelectedProperties);
  if (ui.btnRename) ui.btnRename.addEventListener('click', renameSelected);
  if (ui.btnDelete) ui.btnDelete.addEventListener('click', deleteSelected);
  if (ui.btnCopy) ui.btnCopy.addEventListener('click', copySelected);
  if (ui.btnMove) ui.btnMove.addEventListener('click', moveSelected);
  if (ui.propertiesOverlay) ui.propertiesOverlay.addEventListener('click', closePropertiesModal);
  if (ui.propertiesClose) ui.propertiesClose.addEventListener('click', closePropertiesModal);
  if (ui.propertiesCancel) ui.propertiesCancel.addEventListener('click', closePropertiesModal);
  if (ui.propertiesApply) ui.propertiesApply.addEventListener('click', applyPropertiesChanges);
  if (ui.btnToggleView) {
    ui.btnToggleView.addEventListener('click', () => {
      state.view = state.view === 'list' ? 'grid' : 'list';
      applyView();
    });
  }
  if (ui.toggleHidden) {
    ui.toggleHidden.addEventListener('change', () => {
      loadDirectory(state.currentPath);
    });
  }
  if (ui.selectAll) {
    ui.selectAll.addEventListener('change', (e) => {
      selectAllItems(e.target.checked);
    });
  }
  if (ui.sortSelect) {
    ui.sortSelect.addEventListener('change', () => {
      state.sortBy = ui.sortSelect.value;
      renderEntries();
      persistState();
    });
  }
  if (ui.btnSortDir) {
    ui.btnSortDir.addEventListener('click', () => {
      state.sortAsc = !state.sortAsc;
      ui.btnSortDir.textContent = state.sortAsc ? '↓' : '↑';
      ui.btnSortDir.title = state.sortAsc ? 'Sort ascending (click for descending)' : 'Sort descending (click for ascending)';
      renderEntries();
      persistState();
    });
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.fx-menu-group')) {
      closeAllMenus();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const anyMenuOpen = menuGroups.some((group) => group.hasAttribute('data-open'));
      if (anyMenuOpen) {
        event.preventDefault();
        closeAllMenus();
        return;
      }
      if (ui.propertiesModal?.dataset.open === 'true') {
        event.preventDefault();
        closePropertiesModal();
      }
    }
  });

  setPropertiesModalOpen(false);

  applyView();
  loadDirectory(state.currentPath);

  return null;
}
