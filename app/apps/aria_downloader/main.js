const POLL_INTERVAL_MS = 5000;

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, exponent);
  return `${scaled.toFixed(scaled >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(task) {
  const total = Number(task.totalLength) || 0;
  const completed = Number(task.completedLength) || 0;
  const remaining = Math.max(total - completed, 0);
  const speed = Number(task.downloadSpeed) || 0;
  if (!speed || !remaining) return '—';
  const seconds = Math.max(Math.round(remaining / speed), 1);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function panelLabelForStatus(status) {
  if (!status) return 'status';
  const lower = status.toLowerCase();
  if (lower.includes('active')) return 'active';
  if (lower.includes('complete')) return 'completed';
  if (lower.includes('error')) return 'error';
  if (lower.includes('pause')) return 'paused';
  return lower;
}

export default function init(container, api, host) {
  const summaryEl = container.querySelector('#aria-summary');
  const refreshBtn = container.querySelector('#aria-refresh');
  const newBtn = container.querySelector('#aria-new');
  const loadingEl = container.querySelector('#aria-loading');
  const panelsEl = container.querySelector('#aria-panels');
  const errorEl = container.querySelector('#aria-error');

  const listEls = {
    active: container.querySelector('#aria-list-active'),
    waiting: container.querySelector('#aria-list-waiting'),
    stopped: container.querySelector('#aria-list-stopped'),
  };
  const emptyEls = {
    active: container.querySelector('#aria-empty-active'),
    waiting: container.querySelector('#aria-empty-waiting'),
    stopped: container.querySelector('#aria-empty-stopped'),
  };
  const countEls = {
    active: container.querySelector('#aria-count-active'),
    waiting: container.querySelector('#aria-count-waiting'),
    stopped: container.querySelector('#aria-count-stopped'),
  };

  const sortSelect = container.querySelector('#aria-sort');
  const sortDirSelect = container.querySelector('#aria-sort-dir');

  const pauseSelectedBtn = container.querySelector('#aria-pause-selected');
  const resumeSelectedBtn = container.querySelector('#aria-resume-selected');
  const removeSelectedBtn = container.querySelector('#aria-remove-selected');
  const clearSelectionBtn = container.querySelector('#aria-clear-selection');
  const selectionCountEl = container.querySelector('#aria-selection-count');

  const pauseAllBtn = container.querySelector('#aria-pause-all');
  const resumeAllBtn = container.querySelector('#aria-resume-all');
  const purgeBtn = container.querySelector('#aria-purge');

  const newModal = document.getElementById('aria-new-modal');
  const newCloseBtn = document.getElementById('aria-new-close');
  const newCancelBtn = document.getElementById('aria-new-cancel');
  const newSubmitBtn = document.getElementById('aria-new-submit');
  const urlInput = document.getElementById('aria-url');
  const directoryInput = document.getElementById('aria-directory');
  const filenameInput = document.getElementById('aria-filename');
  const pauseOnAddInput = document.getElementById('aria-pause-on-add');
  const browseBtn = document.getElementById('aria-browse');

  const browseSheet = document.getElementById('aria-browse-sheet');
  const browsePathEl = document.getElementById('aria-browse-path');
  const browseListEl = document.getElementById('aria-browse-list');
  const browseUpBtn = document.getElementById('aria-browse-up');
  const browseSelectBtn = document.getElementById('aria-browse-select');
  const browseCloseBtn = document.getElementById('aria-browse-close');

  const state = {
    downloads: { active: [], waiting: [], stopped: [] },
    selected: new Set(),
    status: null,
    sortKey: 'status',
    sortDir: 'desc',
    lastDirectory: '~',
    pollTimer: null,
    lastErrorMessage: null,
    errorToastShown: false,
    loading: true,
    lastRefresh: null,
    browsePath: '~',
  };

  try {
    const saved = host.loadState() || {};
    if (typeof saved.sortKey === 'string') state.sortKey = saved.sortKey;
    if (typeof saved.sortDir === 'string') state.sortDir = saved.sortDir;
    if (typeof saved.lastDirectory === 'string') state.lastDirectory = saved.lastDirectory;
  } catch (e) {
    console.warn('Failed to load state', e);
  }

  sortSelect.value = state.sortKey;
  sortDirSelect.value = state.sortDir;
  directoryInput.value = state.lastDirectory === '~' ? '' : state.lastDirectory;

  if (host?.setTitle) host.setTitle('Aria Downloader');

  function persistState() {
    try {
      host.saveState({
        sortKey: state.sortKey,
        sortDir: state.sortDir,
        lastDirectory: state.lastDirectory,
      });
    } catch (e) {
      console.warn('Failed to persist state', e);
    }
  }

  function updateSelectionUI() {
    const count = state.selected.size;
    selectionCountEl.textContent = count ? `${count} selected` : 'No items selected';
    const disabled = count === 0;
    pauseSelectedBtn.disabled = disabled;
    resumeSelectedBtn.disabled = disabled;
    removeSelectedBtn.disabled = disabled;
    clearSelectionBtn.disabled = disabled;
  }

  function setError(message) {
    state.lastErrorMessage = message;
    if (message) {
      errorEl.textContent = message;
      errorEl.classList.add('show');
      if (!state.errorToastShown) {
        host?.toast?.(message);
        state.errorToastShown = true;
      }
    } else {
      errorEl.textContent = '';
      errorEl.classList.remove('show');
      state.errorToastShown = false;
    }
  }

  function sortTasks(tasks) {
    const key = state.sortKey;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const copy = [...tasks];
    copy.sort((a, b) => {
      const get = (task) => {
        switch (key) {
          case 'name':
            return (task.name || '').toLowerCase();
          case 'progress':
            return Number(task.completedLength || 0) / Math.max(Number(task.totalLength) || 1, 1);
          case 'speed':
            return Number(task.downloadSpeed) || 0;
          case 'size':
            return Number(task.totalLength) || 0;
          case 'status':
          default:
            return task.status || '';
        }
      };
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb) * dir;
      }
      return (va > vb ? 1 : -1) * dir;
    });
    return copy;
  }

  function humanStatus(task) {
    const status = panelLabelForStatus(task.status);
    if (status === 'completed') return 'Completed';
    if (status === 'active') return 'Active';
    if (status === 'error') return 'Error';
    if (status === 'paused') return 'Paused';
    if (status === 'waiting') return 'Waiting';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  function aggregateSummary() {
    const totals = { download: 0, upload: 0, active: state.downloads.active.length };
    for (const task of state.downloads.active) {
      totals.download += Number(task.downloadSpeed) || 0;
      totals.upload += Number(task.uploadSpeed) || 0;
    }
    const version = state.status?.version?.version || state.status?.version || 'unknown';
    const globalStat = state.status?.globalStat || {};
    const waiting = state.downloads.waiting.length;
    const stopped = state.downloads.stopped.length;
    const queued = Number(globalStat.numWaiting) || waiting;
    const stoppedCount = Number(globalStat.numStoppedTotal) || stopped;
    const speedText = totals.download ? `↓ ${formatSpeed(totals.download)}` : '↓ 0 B/s';
    const uploadText = totals.upload ? `↑ ${formatSpeed(totals.upload)}` : '↑ 0 B/s';
    const timestamp = state.lastRefresh ? new Date(state.lastRefresh).toLocaleTimeString() : '—';
    summaryEl.innerHTML = `
      <strong>aria2 ${version}</strong>
      <span>• ${speedText}</span>
      <span>• ${uploadText}</span>
      <span>• Active ${totals.active}</span>
      <span>• Waiting ${queued}</span>
      <span>• Stopped ${stoppedCount}</span>
      <span>• Updated ${timestamp}</span>
    `;
  }

  function render() {
    Object.keys(listEls).forEach((key) => {
      const listEl = listEls[key];
      const emptyEl = emptyEls[key];
      const tasks = sortTasks(state.downloads[key] || []);
      countEls[key].textContent = tasks.length;
      listEl.innerHTML = '';
      if (!tasks.length) {
        emptyEl.hidden = false;
        return;
      }
      emptyEl.hidden = true;
      for (const task of tasks) {
        const li = document.createElement('li');
        li.className = 'aria-task';
        if (state.selected.has(task.gid)) li.classList.add('selected');
        li.dataset.gid = task.gid;

        const checkboxWrap = document.createElement('label');
        checkboxWrap.className = 'aria-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'aria-select';
        checkbox.dataset.gid = task.gid;
        checkbox.checked = state.selected.has(task.gid);
        checkboxWrap.appendChild(checkbox);

        const main = document.createElement('div');
        main.className = 'aria-task-main';

        const header = document.createElement('div');
        header.className = 'aria-task-header';
        const title = document.createElement('div');
        title.className = 'aria-task-name';
        title.textContent = task.name || task.gid;
        header.appendChild(title);
        const statusChip = document.createElement('span');
        const statusName = panelLabelForStatus(task.status);
        statusChip.className = `aria-status ${statusName}`;
        statusChip.textContent = humanStatus(task);
        header.appendChild(statusChip);
        main.appendChild(header);

        const progressBar = document.createElement('div');
        progressBar.className = 'aria-progress-bar';
        const fill = document.createElement('div');
        fill.className = 'aria-progress-fill';
        const progress = Math.min(Math.max(Number(task.progress) || ((Number(task.completedLength) || 0) / Math.max(Number(task.totalLength) || 1, 1)), 0), 1);
        fill.style.width = `${(progress * 100).toFixed(1)}%`;
        progressBar.appendChild(fill);
        main.appendChild(progressBar);

        const meta = document.createElement('div');
        meta.className = 'aria-progress-meta';
        const completed = Number(task.completedLength) || 0;
        const total = Number(task.totalLength) || 0;
        const remaining = Math.max(total - completed, 0);
        meta.innerHTML = `
          <span>${formatBytes(completed)} / ${total ? formatBytes(total) : 'Unknown'}</span>
          <span>${formatSpeed(task.downloadSpeed || 0)}</span>
          <span>ETA ${formatEta(task)}</span>
          <span>${remaining ? formatBytes(remaining) + ' remaining' : (statusName === 'completed' ? 'Done' : '—')}</span>
        `;
        if (task.errorMessage) {
          const errorSpan = document.createElement('span');
          errorSpan.style.color = '#f87171';
          errorSpan.textContent = task.errorMessage;
          meta.appendChild(errorSpan);
        }
        main.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'aria-task-actions';

        const addActionButton = (action, label, cssClass, confirmRequired = false) => {
          const btn = document.createElement('button');
          btn.className = `aria-btn ${cssClass || 'ghost'}`;
          btn.dataset.action = action;
          btn.dataset.gid = task.gid;
          if (confirmRequired) btn.dataset.confirm = 'true';
          btn.textContent = label;
          actions.appendChild(btn);
        };

        const statusLower = statusName;
        if (statusLower === 'active' || statusLower === 'waiting') {
          addActionButton('pause', 'Pause');
        }
        if (statusLower === 'paused') {
          addActionButton('resume', 'Resume');
        }
        if (statusLower !== 'completed') {
          addActionButton('remove', 'Remove', 'destructive', true);
        } else {
          addActionButton('remove', 'Remove', 'destructive', true);
        }

        li.appendChild(checkboxWrap);
        li.appendChild(main);
        li.appendChild(actions);
        listEl.appendChild(li);
      }
    });

    aggregateSummary();
    updateSelectionUI();
  }

  async function refreshStatus() {
    try {
      const data = await api.get('status');
      state.status = data;
    } catch (e) {
      console.warn('status fetch failed', e);
    }
  }

  async function refreshDownloads(options = {}) {
    if (options.manual) {
      setError(null);
    }
    try {
      const data = await api.get('downloads');
      state.downloads = {
        active: data.active || [],
        waiting: data.waiting || [],
        stopped: data.stopped || [],
      };
      const allGids = new Set([
        ...state.downloads.active.map((t) => t.gid),
        ...state.downloads.waiting.map((t) => t.gid),
        ...state.downloads.stopped.map((t) => t.gid),
      ]);
      for (const gid of Array.from(state.selected)) {
        if (!allGids.has(gid)) state.selected.delete(gid);
      }
      state.lastRefresh = Date.now();
      setError(null);
      state.loading = false;
      loadingEl.hidden = true;
      panelsEl.hidden = false;
      render();
    } catch (e) {
      if (state.loading) {
        loadingEl.textContent = 'Unable to load downloads: ' + e.message;
      }
      setError('Failed to load downloads: ' + e.message);
    }
  }

  async function fullRefresh(options = {}) {
    await Promise.all([refreshStatus(), refreshDownloads(options)]);
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      if (!document.hidden) {
        refreshDownloads();
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  async function runControl(action, gids) {
    if (!Array.isArray(gids) && action !== 'purge' && action !== 'pauseAll' && action !== 'resumeAll') {
      gids = gids ? [gids] : [];
    }
    const payload = { action };
    if (Array.isArray(gids) && gids.length) {
      payload.gids = gids;
    }
    await api.post('control', payload);
    await refreshDownloads();
  }

  function confirmDestructive(message) {
    if (typeof window.confirm === 'function') {
      return window.confirm(message);
    }
    return true;
  }

  async function handleAction(action, gids, options = {}) {
    try {
      if (!action) return;
      const destructive = action === 'remove' || action === 'purge';
      if (destructive) {
        const message = options.message || (action === 'purge' ? 'Purge completed/error downloads?' : 'Remove the selected downloads?');
        if (!confirmDestructive(message)) return;
      }
      await runControl(action, gids);
      host?.toast?.('Done');
    } catch (e) {
      host?.toast?.('Action failed: ' + e.message);
      setError('Action failed: ' + e.message);
    }
  }

  function openNewModal() {
    newModal.classList.add('show');
    newModal.setAttribute('aria-hidden', 'false');
    urlInput.focus();
  }

  function closeNewModal() {
    newModal.classList.remove('show');
    newModal.setAttribute('aria-hidden', 'true');
    urlInput.value = '';
    filenameInput.value = '';
    pauseOnAddInput.checked = false;
  }

  async function submitNewDownload() {
    const url = urlInput.value.trim();
    if (!url) {
      host?.toast?.('Enter a download URL');
      urlInput.focus();
      return;
    }
    const directory = directoryInput.value.trim();
    const filename = filenameInput.value.trim();
    const options = {};
    if (pauseOnAddInput.checked) options.pause = 'true';
    const payload = { url };
    if (directory) payload.directory = directory;
    if (filename) payload.filename = filename;
    if (Object.keys(options).length) payload.options = options;
    try {
      newSubmitBtn.disabled = true;
      await api.post('add', payload);
      host?.toast?.('Download added');
      if (directory) state.lastDirectory = directory;
      persistState();
      closeNewModal();
      await refreshDownloads();
    } catch (e) {
      host?.toast?.('Add failed: ' + e.message);
      setError('Add failed: ' + e.message);
    } finally {
      newSubmitBtn.disabled = false;
    }
  }

  function parentDir(path) {
    if (!path || path === '~') return '~';
    const cleaned = path.replace(/\/+$/, '');
    const idx = cleaned.lastIndexOf('/');
    if (idx <= 0) return '/';
    return cleaned.slice(0, idx);
  }

  async function loadDirectory(path) {
    const target = path || '~';
    browsePathEl.textContent = target;
    browseListEl.innerHTML = '<div style="padding:12px; color:rgba(148,163,184,0.8);">Loading…</div>';
    try {
      const items = await window.teFetch(`/api/browse?path=${encodeURIComponent(target)}`);
      const directories = (items || []).filter((item) => item.type === 'directory');
      if (!directories.length) {
        browseListEl.innerHTML = '<div style="padding:12px; color:rgba(148,163,184,0.7);">No subdirectories</div>';
      } else {
        browseListEl.innerHTML = '';
        directories.sort((a, b) => a.name.localeCompare(b.name));
        for (const dir of directories) {
          const entry = document.createElement('button');
          entry.type = 'button';
          entry.className = 'aria-browse-item';
          entry.dataset.path = dir.path;
          entry.textContent = dir.name || dir.path;
          browseListEl.appendChild(entry);
        }
      }
      state.browsePath = target;
      browsePathEl.textContent = target;
    } catch (e) {
      browseListEl.innerHTML = `<div style="padding:12px; color:#f87171;">Failed to browse: ${e.message}</div>`;
    }
  }

  function openBrowseSheet() {
    const target = directoryInput.value.trim() || state.lastDirectory || '~';
    browseSheet.classList.add('show');
    browseSheet.setAttribute('aria-hidden', 'false');
    loadDirectory(target);
  }

  function closeBrowseSheet() {
    browseSheet.classList.remove('show');
    browseSheet.setAttribute('aria-hidden', 'true');
  }

  refreshBtn.addEventListener('click', () => {
    fullRefresh({ manual: true });
  });
  newBtn.addEventListener('click', openNewModal);
  newCloseBtn.addEventListener('click', closeNewModal);
  newCancelBtn.addEventListener('click', closeNewModal);
  newSubmitBtn.addEventListener('click', submitNewDownload);


  directoryInput.addEventListener('change', () => {
    const value = directoryInput.value.trim();
    state.lastDirectory = value || '~';
    persistState();
  });
  browseBtn.addEventListener('click', openBrowseSheet);
  browseCloseBtn.addEventListener('click', closeBrowseSheet);
  browseSelectBtn.addEventListener('click', () => {
    const chosen = state.browsePath || '~';
    directoryInput.value = chosen === '~' ? '' : chosen;
    state.lastDirectory = chosen;
    persistState();
    closeBrowseSheet();
  });
  browseUpBtn.addEventListener('click', () => {
    loadDirectory(parentDir(state.browsePath));
  });
  browseListEl.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-path]');
    if (!btn) return;
    loadDirectory(btn.dataset.path);
  });

  sortSelect.addEventListener('change', () => {
    state.sortKey = sortSelect.value;
    persistState();
    render();
  });
  sortDirSelect.addEventListener('change', () => {
    state.sortDir = sortDirSelect.value;
    persistState();
    render();
  });

  pauseSelectedBtn.addEventListener('click', () => {
    if (!state.selected.size) return;
    handleAction('pause', Array.from(state.selected));
  });
  resumeSelectedBtn.addEventListener('click', () => {
    if (!state.selected.size) return;
    handleAction('resume', Array.from(state.selected));
  });
  removeSelectedBtn.addEventListener('click', () => {
    if (!state.selected.size) return;
    handleAction('remove', Array.from(state.selected), { message: 'Remove the selected downloads?' });
  });
  clearSelectionBtn.addEventListener('click', () => {
    state.selected.clear();
    updateSelectionUI();
    render();
  });

  pauseAllBtn.addEventListener('click', () => {
    handleAction('pauseAll');
  });
  resumeAllBtn.addEventListener('click', () => {
    handleAction('resumeAll');
  });
  purgeBtn.addEventListener('click', () => {
    handleAction('purge', null, { message: 'Purge completed and removed downloads?' });
  });

  panelsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const gid = btn.dataset.gid;
    const confirmNeeded = btn.dataset.confirm === 'true';
    handleAction(action, gid, confirmNeeded ? { message: 'Remove this download?' } : {});
  });

  panelsEl.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input.aria-select');
    if (!checkbox) return;
    const gid = checkbox.dataset.gid;
    if (!gid) return;
    if (checkbox.checked) {
      state.selected.add(gid);
    } else {
      state.selected.delete(gid);
    }
    updateSelectionUI();
    const row = checkbox.closest('.aria-task');
    if (row) {
      row.classList.toggle('selected', checkbox.checked);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (newModal.classList.contains('show')) {
        event.stopPropagation();
        closeNewModal();
      } else if (browseSheet.classList.contains('show')) {
        event.stopPropagation();
        closeBrowseSheet();
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshDownloads();
    }
  });

  if (host?.onBeforeExit) {
    host.onBeforeExit(() => {
      stopPolling();
    });
  }

  fullRefresh({ manual: true }).finally(() => {
    startPolling();
  });
}
