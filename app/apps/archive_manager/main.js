import { createJobPoller, cancelJob, deleteJob } from '/static/js/jobs_client.js';

const DEFAULT_STATE = {
  mode: 'filesystem',
  cwd: '~',
  archivePath: null,
  archiveInternal: '',
  entries: [],
  entryMap: new Map(),
  pending: false,
  selectedIds: new Set(),
  showHidden: false,
  lastPickedTarget: null,
  homeDir: null,
  lastFilesystemPath: '~',
};

function createState() {
  const state = structuredClone(DEFAULT_STATE);
  state.selectedIds = new Set();
  state.entryMap = new Map();
  return state;
}

function setTitle(host) {
  if (host && typeof host.setTitle === 'function') {
    host.setTitle('Archive Manager');
  }
}

function restoreState(host) {
  if (!host || typeof host.loadState !== 'function') {
    return createState();
  }
  const saved = host.loadState() || {};
  const state = createState();
  state.mode = saved.mode || state.mode;
  state.cwd = saved.cwd || state.cwd;
  state.archivePath = saved.archivePath || null;
  state.archiveInternal = saved.archiveInternal || '';
  state.showHidden = !!saved.showHidden;
  state.lastPickedTarget = saved.lastPickedTarget || null;
  state.homeDir = saved.homeDir || null;
  state.lastFilesystemPath = saved.lastFilesystemPath || state.lastFilesystemPath;
  return state;
}

function persistState(host, state) {
  if (!host || typeof host.saveState !== 'function') return;
  const payload = {
    mode: state.mode,
    cwd: state.cwd,
    archivePath: state.archivePath,
    archiveInternal: state.archiveInternal,
    showHidden: state.showHidden,
    lastPickedTarget: state.lastPickedTarget,
    homeDir: state.homeDir,
    lastFilesystemPath: state.lastFilesystemPath,
  };
  host.saveState(payload);
}

function toTildePath(state, path) {
  if (!path) return path;
  if (!state.homeDir) return path;
  const home = state.homeDir;
  if (path === home) return '~';
  if (path.startsWith(home + '/')) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return null;
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const fixed = value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${fixed} ${units[index]}`;
}

function formatMeta(entry, mode) {
  if (entry.type === 'directory') {
    return mode === 'archive' ? 'Directory in archive' : 'Directory';
  }
  const size = formatBytes(entry.size);
  if (mode === 'archive') {
    const packed = formatBytes(entry.packed_size);
    const parts = [];
    if (size) parts.push(`Size ${size}`);
    if (packed) parts.push(`Packed ${packed}`);
    return parts.join(' • ') || 'File';
  }
  return size ? `File • ${size}` : 'File';
}

function buildBreadcrumbs(state) {
  const crumbs = [];
  if (state.mode === 'filesystem') {
    const tildePath = toTildePath(state, state.cwd);
    const segments = tildePath.split('/').filter(Boolean);
    let accumulator = '';
    segments.forEach((segment, idx) => {
      if (idx === 0 && segment === '~') {
        accumulator = '~';
      } else if (accumulator === '~') {
        accumulator = `${accumulator}/${segment}`;
      } else if (accumulator) {
        accumulator = `${accumulator}/${segment}`;
      } else {
        accumulator = segment;
      }
      crumbs.push({
        label: segment,
        value: accumulator,
        mode: 'filesystem',
      });
    });
    if (!crumbs.length) {
      crumbs.push({ label: '~', value: '~', mode: 'filesystem' });
    }
  } else {
    const archiveTilde = toTildePath(state, state.archivePath || '');
    crumbs.push({
      label: archiveTilde ? archiveTilde.split('/').pop() || archiveTilde : state.archivePath,
      value: '',
      mode: 'archive',
    });
    const segments = (state.archiveInternal || '').split('/').filter(Boolean);
    let accumulator = '';
    segments.forEach((segment) => {
      accumulator = accumulator ? `${accumulator}/${segment}` : segment;
      crumbs.push({
        label: segment,
        value: accumulator,
        mode: 'archive',
      });
    });
  }
  return crumbs;
}

function renderBreadcrumbs(container, state) {
  container.innerHTML = '';
  const crumbs = buildBreadcrumbs(state);
  crumbs.forEach((crumb, idx) => {
    if (idx > 0) {
      const sep = document.createElement('span');
      sep.className = 'am-crumb-sep';
      sep.textContent = '/';
      container.appendChild(sep);
    }
    const span = document.createElement('span');
    span.className = `am-crumb${idx === crumbs.length - 1 ? ' current' : ''}`;
    span.textContent = crumb.label;
    if (idx !== crumbs.length - 1) {
      span.addEventListener('click', () => {
        if (crumb.mode === 'filesystem') {
          state.navigateToFilesystem(crumb.value || '~');
        } else {
          state.navigateWithinArchive(crumb.value || '');
        }
      });
    }
    container.appendChild(span);
  });
}

function renderEntries(gridEl, placeholderEl, state) {
  gridEl.innerHTML = '';
  if (state.pending) {
    placeholderEl.textContent = 'Loading…';
    placeholderEl.style.display = 'block';
    return;
  }
  if (!state.entries.length) {
    placeholderEl.textContent = state.mode === 'archive'
      ? 'This archive location is empty.'
      : 'This folder is empty.';
    placeholderEl.style.display = 'block';
    return;
  }
  placeholderEl.style.display = 'none';
  const template = document.getElementById('am-entry-card');
  state.entries.forEach((entry) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const checkbox = node.querySelector('.am-card-select');
    node.querySelector('.am-card-title').textContent = entry.name;
    node.querySelector('[data-role="meta"]').textContent = entry.meta || '';
    checkbox.checked = state.selectedIds.has(entry.id);
    if (checkbox.checked) node.classList.add('selected');
    checkbox.addEventListener('change', (event) => {
      if (event.target.checked) {
        state.selectedIds.add(entry.id);
        node.classList.add('selected');
      } else {
        state.selectedIds.delete(entry.id);
        node.classList.remove('selected');
      }
      state.updateActionButtons();
    });

    // Open button handler
    const openBtn = node.querySelector('[data-action="open"]');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        state.handleOpen(entry);
      });
    }
    
    // Add double-click navigation
    node.addEventListener('dblclick', (e) => {
      // Prevent double-click on checkbox
      if (e.target.type === 'checkbox' || e.target.closest('.am-card-select')) {
        return;
      }
      state.handleOpen(entry);
    });

    gridEl.appendChild(node);
  });
}

function createClient(api) {
  return {
    browse(params) {
      const search = new URLSearchParams(params);
      return api.get(`browse?${search.toString()}`);
    },
    createArchive(body) {
      return api.post('archives/create', body);
    },
    extractArchive(body) {
      return api.post('archives/extract', body);
    },
    testArchive(body) {
      return api.post('archives/test', body);
    },
  };
}

function useToast(host, message, duration = 2500) {
  if (host && typeof host.toast === 'function') {
    host.toast(message, duration);
    return;
  }
  if (window.teUI && typeof window.teUI.toast === 'function') {
    window.teUI.toast(message, duration);
  } else {
    console.log('[toast]', message);
  }
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
  jobs: new Map(),
};

function ensureJobPoller(state) {
  if (!jobTracker.poller) {
    jobTracker.poller = createJobPoller({
      onUpdate: (jobs) => handleJobUpdates(state, jobs),
      onError: (err) => console.error('[archive jobs]', err),
    });
  }
  if (!jobTracker.poller.isRunning()) {
    jobTracker.poller.start();
  }
}

function maybeStopJobPoller() {
  if (jobTracker.poller && jobTracker.poller.isRunning() && jobTracker.jobs.size === 0) {
    jobTracker.poller.stop();
  }
}

function trackExtractionJob(state, job, meta) {
  const info = {
    meta,
    lastStatus: job.status,
    cleaned: false,
  };
  jobTracker.jobs.set(job.id, info);
  updateJobNotification(state, job, info);
  ensureJobPoller(state);
}

function handleJobUpdates(state, jobs) {
  if (!Array.isArray(jobs)) return;
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  for (const [jobId, info] of jobTracker.jobs.entries()) {
    const job = jobMap.get(jobId);
    if (!job) {
      window.teUI?.dismiss?.(jobId);
      jobTracker.jobs.delete(jobId);
      continue;
    }
    updateJobNotification(state, job, info);
  }
  maybeStopJobPoller();
}

function updateJobNotification(state, job, info) {
  const meta = info.meta;
  const title = meta.archiveName ? `Extract ${meta.archiveName}` : 'Extract archive';
  let message = meta.destination ? `→ ${meta.destination}` : 'Running';
  let variant = 'info';
  const actions = [];

  if (job.message) {
    message = job.message;
  }
  if (job.status === JobStatus.SUCCEEDED) {
    variant = 'success';
    message = job.message || `Extracted to ${meta.destination}`;
  } else if (job.status === JobStatus.FAILED) {
    variant = 'error';
    message = job.error || 'Extraction failed';
  } else if (job.status === JobStatus.CANCELLED) {
    variant = 'warning';
    message = job.message || 'Extraction cancelled';
  }

  if (job.status === JobStatus.RUNNING || job.status === JobStatus.PENDING) {
    actions.push({
      label: 'Cancel',
      onClick: async () => {
        try {
          await cancelJob(job.id);
          useToast(state.host, 'Cancellation requested.');
        } catch (error) {
          useToast(state.host, error?.message || 'Failed to cancel job.');
        }
      },
    });
  }

  const progress = job.progress && typeof job.progress === 'object' ? job.progress : undefined;

  if (window.teUI && typeof window.teUI.notify === 'function') {
    window.teUI.notify({
      id: job.id,
      title,
      message,
      variant,
      status: job.status,
      progress,
      actions,
      onDismiss: () => {
        jobTracker.jobs.delete(job.id);
        if (TERMINAL_STATUSES.has(job.status)) {
          deleteJob(job.id).catch(() => {});
        }
        maybeStopJobPoller();
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

  const meta = info.meta;
  let toastMessage = job.message;
  if (!toastMessage) {
    if (job.status === JobStatus.SUCCEEDED) {
      toastMessage = meta.destination
        ? `Extracted to ${meta.destination}`
        : 'Extraction completed.';
    } else if (job.status === JobStatus.FAILED) {
      toastMessage = job.error || 'Extraction failed.';
    } else {
      toastMessage = 'Extraction cancelled.';
    }
  }
  useToast(state.host, toastMessage, 3500);

  if (job.status === JobStatus.SUCCEEDED) {
    if (state.mode === 'filesystem' && state.cwd === meta.destination) {
      state.refresh();
    }
  }

  setTimeout(() => {
    window.teUI?.dismiss?.(job.id);
    jobTracker.jobs.delete(job.id);
    deleteJob(job.id).catch(() => {});
    maybeStopJobPoller();
  }, 4000);
}

function transformEntries(state, data) {
  const mode = data.mode;
  const entries = (data.entries || []).map((item) => {
    const meta = formatMeta(item, mode);
    return { ...item, meta, isArchive: item.is_archive }; // keep is_archive on filesystem entries
  });
  const map = new Map(entries.map((entry) => [entry.id, entry]));
  state.entries = entries;
  state.entryMap = map;
}

async function promptForArchivePath(state, initialName = 'archive.7z') {
  if (!window.teFilePicker || typeof window.teFilePicker.saveFile !== 'function') {
    const fallback = window.prompt('Enter archive destination path (relative to home)', `~/${initialName}`);
    return fallback ? { path: fallback } : null;
  }
  try {
    const target = await window.teFilePicker.saveFile({
      startPath: state.mode === 'filesystem' ? state.cwd : state.archivePath?.split('::')[0] || '~',
      filename: initialName,
      title: 'Save Archive As',
    });
    return target || null;
  } catch (error) {
    return null;
  }
}

async function pickExistingArchive(state) {
  if (!window.teFilePicker || typeof window.teFilePicker.openFile !== 'function') {
    const fallback = window.prompt('Enter existing archive path', state.cwd);
    return fallback ? { path: fallback } : null;
  }
  try {
    const target = await window.teFilePicker.openFile({
      startPath: state.cwd,
      title: 'Select Archive',
    });
    return target || null;
  } catch (error) {
    return null;
  }
}

async function pickDestinationDirectory(state) {
  if (!window.teFilePicker || typeof window.teFilePicker.openDirectory !== 'function') {
    const fallback = window.prompt('Enter destination directory', state.lastPickedTarget || state.cwd);
    return fallback ? { path: fallback } : null;
  }
  try {
    const choice = await window.teFilePicker.openDirectory({
      startPath: state.lastPickedTarget || state.cwd,
      title: 'Select Destination Directory',
      selectLabel: 'Use Folder',
    });
    return choice || null;
  } catch (error) {
    return null;
  }
}

export default async function init(root, api, host) {
  setTitle(host);
  const state = restoreState(host);
  state.host = host;
  state.client = createClient(api);

  const searchParams = new URLSearchParams(window.location.search || '');
  const requestedPath = searchParams.get('path');
  const requestedArchive = searchParams.get('archive');
  const requestedInternal = searchParams.get('internal');
  const requestedDestination = searchParams.get('destination');
  const requestedHidden = searchParams.get('hidden');
  if (requestedPath) {
    state.cwd = requestedPath;
    state.lastFilesystemPath = requestedPath;
  }
  if (requestedDestination) {
    state.lastPickedTarget = requestedDestination;
  }
  if (requestedHidden && ['1', 'true', 'yes', 'on'].includes(requestedHidden.toLowerCase())) {
    state.showHidden = true;
  }
  if (requestedArchive) {
    state.lastFilesystemPath = state.lastFilesystemPath || state.cwd || '~';
    state.mode = 'archive';
    state.archivePath = requestedArchive;
    state.archiveInternal = (requestedInternal || '').replace(/^\/+|\/+$/g, '');
  }

  const gridEl = root.querySelector('[data-role="entry-grid"]');
  const placeholderEl = root.querySelector('[data-role="empty-state"]');
  const breadcrumbEl = root.querySelector('[data-role="breadcrumbs"]');
  const newArchiveBtn = root.querySelector('[data-action="new-archive"]');
  const exitArchiveBtn = root.querySelector('[data-action="exit-archive"]');
  const extractBtn = root.querySelector('[data-action="extract"]');
  const addBtn = root.querySelector('[data-action="add-to-archive"]');
  const pickBtn = root.querySelector('[data-action="pick-target"]');
  const showHiddenToggle = root.querySelector('#am-show-hidden');

  state.updateActionButtons = () => {
    const hasSelection = state.selectedIds.size > 0;
    newArchiveBtn.disabled = !(state.mode === 'filesystem' && hasSelection);
    addBtn.disabled = !(state.mode === 'filesystem' && hasSelection);
    extractBtn.disabled = !(state.mode === 'archive' && hasSelection);
    if (exitArchiveBtn) {
      if (state.mode === 'archive') {
        exitArchiveBtn.classList.remove('am-hidden');
      } else {
        exitArchiveBtn.classList.add('am-hidden');
      }
    }
  };

  state.clearSelection = () => {
    state.selectedIds.clear();
    state.updateActionButtons();
  };

  state.navigateToFilesystem = (path) => {
    const targetPath = path || state.cwd || state.lastFilesystemPath || '~';
    state.mode = 'filesystem';
    state.archivePath = null;
    state.archiveInternal = '';
    state.cwd = targetPath;
    state.lastFilesystemPath = targetPath;
    state.clearSelection();
    state.refresh();
  };

  state.navigateWithinArchive = (internal) => {
    if (!state.archivePath) return;
    state.mode = 'archive';
    state.archiveInternal = internal || '';
    state.clearSelection();
    state.refresh();
  };

  state.navigateToArchiveRoot = (archivePath) => {
    state.lastFilesystemPath = state.cwd || state.lastFilesystemPath || '~';
    state.mode = 'archive';
    state.archivePath = archivePath;
    state.archiveInternal = '';
    state.clearSelection();
    state.refresh();
  };

  state.handleOpen = (entry) => {
    if (state.mode === 'filesystem') {
      if (entry.type === 'directory') {
        // Navigate into directory
        state.navigateToFilesystem(entry.path);
        return;
      }
      if (entry.isArchive) {
        // Open archive for browsing
        state.navigateToArchiveRoot(entry.path);
        return;
      }
      // For regular files, show info
      useToast(host, `File: ${entry.name} (${formatBytes(entry.size)})`);
    } else {
      // Inside archive mode
      if (entry.type === 'directory') {
        // Navigate deeper into archive
        state.navigateWithinArchive(entry.internal || entry.name);
      } else {
        // For files in archive, show info and suggest extraction
        const sizeInfo = entry.size ? ` (${formatBytes(entry.size)})` : '';
        useToast(host, `${entry.name}${sizeInfo} - Select and extract to access`);
      }
    }
  };

  // Preview handler removed - using double-click navigation instead

  state.handleCreateArchive = async () => {
    if (state.mode !== 'filesystem' || state.selectedIds.size === 0) {
      useToast(host, 'Select files or folders in the filesystem view first.');
      return;
    }
    const selected = Array.from(state.selectedIds).map((id) => state.entryMap.get(id)).filter(Boolean);
    const defaultName = selected.length === 1 ? `${selected[0].name}.7z` : 'archive.7z';
    const target = await promptForArchivePath(state, defaultName);
    if (!target) return;
    if (target.existed && !window.confirm('Archive already exists. Overwrite/append?')) {
      return;
    }
    const body = {
      archive_path: target.path,
      sources: selected.map((entry) => entry.path),
      options: {},
    };
    try {
      await state.client.createArchive(body);
      useToast(host, 'Archive created successfully.');
      state.clearSelection();
      state.refresh();
    } catch (error) {
      useToast(host, error?.message || 'Failed to create archive.');
    }
  };

  state.handleAddToArchive = async () => {
    if (state.mode !== 'filesystem' || state.selectedIds.size === 0) {
      useToast(host, 'Select files or folders to add.');
      return;
    }
    const selected = Array.from(state.selectedIds).map((id) => state.entryMap.get(id)).filter(Boolean);
    const target = await pickExistingArchive(state);
    if (!target) return;
    const confirmMessage = `Add ${selected.length} item(s) to ${target.path}?`;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    try {
      await state.client.createArchive({
        archive_path: target.path,
        sources: selected.map((entry) => entry.path),
        options: {},
      });
      useToast(host, 'Archive updated successfully.');
      state.clearSelection();
      state.refresh();
    } catch (error) {
      useToast(host, error?.message || 'Failed to update archive.');
    }
  };

  state.handleExitArchive = () => {
    const target = state.lastFilesystemPath || state.homeDir || '~';
    state.navigateToFilesystem(target);
  };

  state.handleExtract = async () => {
    if (state.mode !== 'archive' || state.selectedIds.size === 0) {
      useToast(host, 'Select archive entries to extract.');
      return;
    }
    const destinationChoice = state.lastPickedTarget
      ? { path: state.lastPickedTarget }
      : await pickDestinationDirectory(state);
    if (!destinationChoice) {
      const picked = await pickDestinationDirectory(state);
      if (!picked) return;
      destinationChoice.path = picked.path;
    }
    const destinationPath = destinationChoice.path;
    state.lastPickedTarget = destinationPath;
    const selected = Array.from(state.selectedIds).map((id) => state.entryMap.get(id)).filter(Boolean);
    const items = selected
      .map((entry) => entry.internal)
      .filter(Boolean);
    if (!items.length) {
      useToast(host, 'Unable to determine archive paths for selection.');
      return;
    }
    try {
      const job = await createJobRequest('extract_archive', {
        archive_path: state.archivePath,
        items,
        destination: destinationPath,
        options: {},
      });
      const archiveName = state.archivePath ? state.archivePath.split('/').pop() || state.archivePath : 'archive';
      trackExtractionJob(state, job, {
        archivePath: state.archivePath,
        archiveName,
        destination: destinationPath,
        itemCount: items.length,
      });
      useToast(host, 'Extraction started.');
      state.clearSelection();
      persistState(host, state);
    } catch (error) {
      useToast(host, error?.message || 'Failed to start extraction.');
    }
  };

  state.handlePickDestination = async () => {
    const choice = await pickDestinationDirectory(state);
    if (choice) {
      state.lastPickedTarget = choice.path;
      persistState(host, state);
      useToast(host, `Destination set to ${choice.path}`);
    }
  };

  state.refresh = async () => {
    state.pending = true;
    renderEntries(gridEl, placeholderEl, state);
    let params = {
      path: state.mode === 'filesystem' ? state.cwd : state.archivePath,
      hidden: state.showHidden ? '1' : '0',
    };
    if (state.mode === 'archive') {
      params.archive = '1';
      params.internal = state.archiveInternal || '';
    }
    try {
      const data = await state.client.browse(params);
      state.mode = data.mode === 'archive' ? 'archive' : 'filesystem';
      if (data.mode === 'filesystem') {
        state.cwd = data.path || state.cwd;
        state.lastFilesystemPath = state.cwd || state.lastFilesystemPath || '~';
        state.homeDir = state.homeDir || data.path;
        state.archivePath = null;
        state.archiveInternal = '';
      } else {
        state.archivePath = data.archive_path || state.archivePath;
        state.archiveInternal = data.internal || '';
        state.homeDir = state.homeDir || state.cwd;
        if (!state.cwd || state.mode === 'archive') {
          state.cwd = data.archive_path || state.cwd;
        }
      }
      transformEntries(state, data);
    } catch (error) {
      useToast(host, error?.message || 'Failed to load entries.');
    } finally {
      state.pending = false;
      for (const id of Array.from(state.selectedIds)) {
        if (!state.entryMap.has(id)) {
          state.selectedIds.delete(id);
        }
      }
      state.updateActionButtons();
      renderEntries(gridEl, placeholderEl, state);
      renderBreadcrumbs(breadcrumbEl, state);
      persistState(host, state);
    }
  };

  showHiddenToggle.checked = state.showHidden;
  showHiddenToggle.addEventListener('change', (event) => {
    state.showHidden = event.target.checked;
    persistState(host, state);
    state.refresh();
  });

  newArchiveBtn.addEventListener('click', state.handleCreateArchive);
  addBtn.addEventListener('click', state.handleAddToArchive);
  extractBtn.addEventListener('click', state.handleExtract);
  pickBtn.addEventListener('click', state.handlePickDestination);
  if (exitArchiveBtn) {
    exitArchiveBtn.addEventListener('click', state.handleExitArchive);
  }

  await state.refresh();

  if (host && typeof host.onBeforeExit === 'function') {
    host.onBeforeExit(() => {
      persistState(host, state);
    });
  }
}
