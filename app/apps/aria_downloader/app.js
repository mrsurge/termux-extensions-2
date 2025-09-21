const POLL_INTERVAL_MS = 5000;
const SHELL_LOG_TAIL = 120;
const HOST_STORE_KEY = '__ariaDownloaderHost';

function setGlobalHost(host) {
  window[HOST_STORE_KEY] = host || {};
}

function getGlobalHost() {
  return window[HOST_STORE_KEY] || {};
}

function notify(message) {
  const currentHost = getGlobalHost();
  if (currentHost && typeof currentHost.toast === 'function') {
    try {
      currentHost.toast(message);
    } catch (error) {
      console.warn('aria_downloader toast failed', error);
    }
  }
}

if (!window.__ariaDownloaderErrorsBound) {
  window.__ariaDownloaderErrorsBound = true;
  window.addEventListener('error', (event) => {
    const message = event && event.message ? event.message : 'Uncaught error';
    notify('[JS error] ' + message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason;
    const message = reason && reason.message ? reason.message : String(reason || 'Unhandled rejection');
    notify('[Promise rejection] ' + message);
  });
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, exponent);
  const decimals = scaled >= 10 || exponent === 0 ? 0 : 1;
  return scaled.toFixed(decimals) + ' ' + units[exponent];
}

function formatSpeed(bytesPerSec) {
  return formatBytes(bytesPerSec) + '/s';
}

function formatEta(task) {
  const total = Number(task.totalLength) || 0;
  const completed = Number(task.completedLength) || 0;
  const remaining = Math.max(total - completed, 0);
  const speed = Number(task.downloadSpeed) || 0;
  if (!speed || !remaining) return '--';
  const seconds = Math.max(Math.round(remaining / speed), 1);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return hours + 'h ' + minutes + 'm';
  if (minutes > 0) return minutes + 'm ' + secs + 's';
  return secs + 's';
}

function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  if (!Number.isFinite(value) || value <= 0) return '--';
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return hours + 'h ' + minutes + 'm';
  if (minutes > 0) return minutes + 'm ' + secs + 's';
  return secs + 's';
}

function formatTimestamp(seconds) {
  if (seconds == null) return '--';
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
}

function panelLabelForStatus(status) {
  if (!status) return 'status';
  const lower = status.toLowerCase();
  if (lower.indexOf('active') >= 0) return 'active';
  if (lower.indexOf('complete') >= 0) return 'completed';
  if (lower.indexOf('error') >= 0) return 'error';
  if (lower.indexOf('pause') >= 0) return 'paused';
  return lower;
}

export default function init(container, api, host) {
  const safeHost = host || {};
  setGlobalHost(safeHost);

  function setTitle(title) {
    if (safeHost && typeof safeHost.setTitle === 'function') {
      try {
        safeHost.setTitle(title);
      } catch (error) {
        console.warn('aria_downloader setTitle failed', error);
      }
    }
  }

  function registerBeforeExit(handler) {
    if (safeHost && typeof safeHost.onBeforeExit === 'function') {
      try {
        safeHost.onBeforeExit(handler);
      } catch (error) {
        console.warn('aria_downloader onBeforeExit failed', error);
      }
    }
  }

  function loadState(defaultValue) {
    if (safeHost && typeof safeHost.loadState === 'function') {
      try {
        return safeHost.loadState(defaultValue);
      } catch (error) {
        console.warn('aria_downloader loadState failed', error);
      }
    }
    return defaultValue;
  }

  function saveState(state) {
    if (safeHost && typeof safeHost.saveState === 'function') {
      try {
        safeHost.saveState(state);
      } catch (error) {
        console.warn('aria_downloader saveState failed', error);
      }
    }
  }

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
  const parallelInput = document.getElementById('aria-parallel');

  const browseSheet = document.getElementById('aria-browse-sheet');
  const browsePathEl = document.getElementById('aria-browse-path');
  const browseListEl = document.getElementById('aria-browse-list');
  const browseUpBtn = document.getElementById('aria-browse-up');
  const browseSelectBtn = document.getElementById('aria-browse-select');
  const browseCloseBtn = document.getElementById('aria-browse-close');

  const shellStatusEl = container.querySelector('#aria-shell-status');
  const shellMetaEl = container.querySelector('#aria-shell-meta');
  const shellLogsWrap = container.querySelector('#aria-shell-logs');
  const shellStdoutEl = container.querySelector('#aria-shell-stdout');
  const shellStderrEl = container.querySelector('#aria-shell-stderr');
  const shellStartBtn = container.querySelector('#aria-shell-start');
  const shellStopBtn = container.querySelector('#aria-shell-stop');
  const shellRestartBtn = container.querySelector('#aria-shell-restart');
  const shellKillBtn = container.querySelector('#aria-shell-kill');
  const shellRemoveBtn = container.querySelector('#aria-shell-remove');
  const shellRefreshBtn = container.querySelector('#aria-shell-refresh');

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

  const shellState = {
    record: null,
    config: null,
    loading: true,
    error: null,
    actionPending: false,
  };

  try {
    const saved = loadState({}) || {};
    if (typeof saved.sortKey === 'string') state.sortKey = saved.sortKey;
    if (typeof saved.sortDir === 'string') state.sortDir = saved.sortDir;
    if (typeof saved.lastDirectory === 'string') state.lastDirectory = saved.lastDirectory;
  } catch (error) {
    console.warn('Failed to load saved state', error);
  }

  sortSelect.value = state.sortKey;
  sortDirSelect.value = state.sortDir;
  directoryInput.value = state.lastDirectory === '~' ? '' : state.lastDirectory;

  setTitle('Aria Downloader');

  function persistState() {
    saveState({
      sortKey: state.sortKey,
      sortDir: state.sortDir,
      lastDirectory: state.lastDirectory,
    });
  }

  function updateSelectionUI() {
    const count = state.selected.size;
    selectionCountEl.textContent = count ? count + ' selected' : 'No items selected';
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
        notify(message);
        state.errorToastShown = true;
      }
    } else {
      errorEl.textContent = '';
      errorEl.classList.remove('show');
      state.errorToastShown = false;
    }
  }

  function renderShell() {
    const config = shellState.config || {};
    if (!shellStatusEl) return;

    function setButtonState(options) {
      const defaultOptions = { start: false, stop: true, restart: true, kill: true, remove: true, refresh: false };
      const opts = Object.assign(defaultOptions, options || {});
      if (shellStartBtn) shellStartBtn.disabled = opts.start;
      if (shellStopBtn) shellStopBtn.disabled = opts.stop;
      if (shellRestartBtn) shellRestartBtn.disabled = opts.restart;
      if (shellKillBtn) shellKillBtn.disabled = opts.kill;
      if (shellRemoveBtn) shellRemoveBtn.disabled = opts.remove;
      if (shellRefreshBtn) shellRefreshBtn.disabled = opts.refresh;
    }

    if (shellState.loading) {
      shellStatusEl.className = 'aria-shell-state';
      shellStatusEl.textContent = 'Checking';
      if (shellMetaEl) shellMetaEl.textContent = 'Gathering aria2 service status...';
      if (shellLogsWrap) shellLogsWrap.hidden = true;
      setButtonState({ start: true, stop: true, restart: true, kill: true, remove: true, refresh: shellState.actionPending });
      return;
    }

    if (shellState.error) {
      shellStatusEl.className = 'aria-shell-state error';
      shellStatusEl.textContent = 'Error';
      if (shellMetaEl) shellMetaEl.textContent = shellState.error;
      if (shellLogsWrap) shellLogsWrap.hidden = true;
      setButtonState({ start: shellState.actionPending, remove: !shellState.record || shellState.actionPending, refresh: shellState.actionPending });
      return;
    }

    const record = shellState.record;
    if (!record) {
      shellStatusEl.className = 'aria-shell-state stopped';
      shellStatusEl.textContent = 'Stopped';
      if (shellMetaEl) shellMetaEl.textContent = 'No tracked aria2 framework shell. Use Start to launch aria2c in the background.';
      if (shellLogsWrap) shellLogsWrap.hidden = true;
      setButtonState({ start: shellState.actionPending, refresh: shellState.actionPending });
      return;
    }

    const stats = record.stats || {};
    const alive = !!stats.alive;
    shellStatusEl.className = 'aria-shell-state ' + (alive ? 'running' : 'stopped');
    shellStatusEl.textContent = alive ? 'Running' : 'Stopped';

    const cpuPercent = typeof stats.cpu_percent === 'number' && Number.isFinite(stats.cpu_percent) ? stats.cpu_percent.toFixed(1) + '%' : '--';
    const memoryRss = typeof stats.memory_rss === 'number' ? formatBytes(stats.memory_rss) : '--';
    const uptime = stats.alive ? formatDuration(stats.uptime) : '--';
    const pid = record.pid || '--';
    const exitCode = record.exit_code != null ? record.exit_code : '--';
    const label = record.label || config.label || 'aria2';
    const cwd = record.cwd || config.cwd || '--';
    const createdAt = record.created_at != null ? formatTimestamp(record.created_at) : (config.created_at != null ? formatTimestamp(config.created_at) : '--');
    const updatedAt = record.updated_at != null ? formatTimestamp(record.updated_at) : '--';

    if (shellMetaEl) {
      shellMetaEl.innerHTML = [
        '<span><strong>Label:</strong> ' + label + '</span>',
        '<span><strong>PID:</strong> ' + pid + '</span>',
        '<span><strong>CPU:</strong> ' + cpuPercent + '</span>',
        '<span><strong>Memory:</strong> ' + memoryRss + '</span>',
        '<span><strong>Uptime:</strong> ' + uptime + '</span>',
        '<span><strong>Exit:</strong> ' + exitCode + '</span>',
        '<span><strong>CWD:</strong> ' + cwd + '</span>',
        '<span><strong>Created:</strong> ' + createdAt + '</span>',
        '<span><strong>Updated:</strong> ' + updatedAt + '</span>',
      ].join(' ');
    }

    if (shellLogsWrap && shellStdoutEl && shellStderrEl) {
      if (record.logs) {
        const stdoutLines = Array.isArray(record.logs.stdout_tail) ? record.logs.stdout_tail : [];
        const stderrLines = Array.isArray(record.logs.stderr_tail) ? record.logs.stderr_tail : [];
        shellStdoutEl.textContent = stdoutLines.length ? stdoutLines.join('\n') : 'No recent output.';
        shellStderrEl.textContent = stderrLines.length ? stderrLines.join('\n') : 'No recent output.';
        shellLogsWrap.hidden = false;
      } else {
        shellStdoutEl.textContent = '';
        shellStderrEl.textContent = '';
        shellLogsWrap.hidden = true;
      }
    }

    setButtonState({
      start: shellState.actionPending || alive,
      stop: shellState.actionPending || !alive,
      restart: shellState.actionPending || !record,
      kill: shellState.actionPending || !alive,
      remove: shellState.actionPending || !record,
      refresh: shellState.actionPending,
    });
  }

  function sortTasks(tasks) {
    const key = state.sortKey;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const copy = tasks.slice();
    copy.sort((a, b) => {
      function get(task) {
        switch (key) {
          case 'name':
            return (task.name || '').toLowerCase();
          case 'progress':
            return (Number(task.completedLength) || 0) / Math.max(Number(task.totalLength) || 1, 1);
          case 'speed':
            return Number(task.downloadSpeed) || 0;
          case 'size':
            return Number(task.totalLength) || 0;
          case 'status':
          default:
            return task.status || '';
        }
      }
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
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
    const statusData = state.status || {};
    const versionField = statusData.version;
    let version = 'unknown';
    if (versionField && typeof versionField === 'object') {
      version = versionField.version || versionField.status || 'unknown';
    } else if (versionField) {
      version = versionField;
    }
    const globalStat = statusData.globalStat || {};
    const waiting = state.downloads.waiting.length;
    const stopped = state.downloads.stopped.length;
    const queued = Number(globalStat.numWaiting) || waiting;
    const stoppedCount = Number(globalStat.numStoppedTotal) || stopped;
    const speedText = totals.download ? 'down ' + formatSpeed(totals.download) : 'down 0 B/s';
    const uploadText = totals.upload ? 'up ' + formatSpeed(totals.upload) : 'up 0 B/s';
    const timestamp = state.lastRefresh ? new Date(state.lastRefresh).toLocaleTimeString() : '--';
    summaryEl.innerHTML = [
      '<strong>aria2 ' + version + '</strong>',
      '<span>- ' + speedText + '</span>',
      '<span>- ' + uploadText + '</span>',
      '<span>- Active ' + totals.active + '</span>',
      '<span>- Waiting ' + queued + '</span>',
      '<span>- Stopped ' + stoppedCount + '</span>',
      '<span>- Updated ' + timestamp + '</span>',
    ].join(' ');
  }

  function render() {
    ['active', 'waiting', 'stopped'].forEach((key) => {
      const listEl = listEls[key];
      const emptyEl = emptyEls[key];
      const tasks = sortTasks(state.downloads[key] || []);
      countEls[key].textContent = String(tasks.length);
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
        statusChip.className = 'aria-status ' + statusName;
        statusChip.textContent = humanStatus(task);
        header.appendChild(statusChip);
        main.appendChild(header);

        const progressBar = document.createElement('div');
        progressBar.className = 'aria-progress-bar';
        const fill = document.createElement('div');
        fill.className = 'aria-progress-fill';
        const progress = Math.min(Math.max((Number(task.completedLength) || 0) / Math.max(Number(task.totalLength) || 1, 1), 0), 1);
        fill.style.width = (progress * 100).toFixed(1) + '%';
        progressBar.appendChild(fill);
        main.appendChild(progressBar);

        const meta = document.createElement('div');
        meta.className = 'aria-progress-meta';
        const completed = Number(task.completedLength) || 0;
        const total = Number(task.totalLength) || 0;
        const remaining = Math.max(total - completed, 0);
        meta.innerHTML = [
          '<span>' + formatBytes(completed) + ' / ' + (total ? formatBytes(total) : 'Unknown') + '</span>',
          '<span>' + formatSpeed(task.downloadSpeed || 0) + '</span>',
          '<span>ETA ' + formatEta(task) + '</span>',
          '<span>' + (remaining ? formatBytes(remaining) + ' remaining' : (statusName === 'completed' ? 'Done' : '--')) + '</span>',
        ].join(' ');
        if (task.errorMessage) {
          const errorSpan = document.createElement('span');
          errorSpan.style.color = '#f87171';
          errorSpan.textContent = task.errorMessage;
          meta.appendChild(errorSpan);
        }
        main.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'aria-task-actions';

        function addActionButton(action, label, cssClass, confirmRequired) {
          const btn = document.createElement('button');
          btn.className = 'aria-btn ' + (cssClass || 'ghost');
          btn.dataset.action = action;
          btn.dataset.gid = task.gid;
          if (confirmRequired) btn.dataset.confirm = 'true';
          btn.textContent = label;
          actions.appendChild(btn);
        }

        if (statusName === 'active' || statusName === 'waiting') addActionButton('pause', 'Pause');
        if (statusName === 'paused') addActionButton('resume', 'Resume');
        addActionButton('remove', 'Remove', 'destructive', true);

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
    } catch (error) {
      console.warn('status fetch failed', error);
    }
  }

  async function refreshDownloads(options) {
    const manual = options && options.manual;
    if (manual) setError(null);
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
    } catch (error) {
      if (state.loading) loadingEl.textContent = 'Unable to load downloads: ' + error.message;
      setError('Failed to load downloads: ' + error.message);
    }
  }

  async function refreshShell(options) {
    const opts = options || {};
    const includeLogs = !!opts.includeLogs;
    const tailLines = opts.tail != null ? Math.max(0, parseInt(opts.tail, 10) || 0) : SHELL_LOG_TAIL;
    if (!opts.silent) {
      shellState.loading = true;
      shellState.error = null;
      renderShell();
    }
    try {
      const queryParts = [];
      if (includeLogs) {
        queryParts.push('logs=1');
        queryParts.push('tail=' + encodeURIComponent(tailLines));
      }
      const query = queryParts.length ? '?' + queryParts.join('&') : '';
      const result = await api.get('shell' + query);
      const payload = result.shell;
      if (payload && payload.record) {
        shellState.record = payload.record;
        shellState.config = payload.config || null;
      } else {
        shellState.record = null;
        shellState.config = null;
      }
      shellState.error = null;
    } catch (error) {
      shellState.error = error.message || String(error);
    } finally {
      shellState.loading = false;
      renderShell();
    }
  }

  async function spawnShell(force) {
    shellState.actionPending = true;
    shellState.error = null;
    renderShell();
    try {
      const response = await api.post('shell/spawn', force ? { force: true } : {});
      const payload = response.shell;
      if (payload && payload.record) {
        shellState.record = payload.record;
        shellState.config = payload.config || null;
      } else {
        shellState.record = null;
        shellState.config = null;
      }
      shellState.error = null;
      notify('aria2 service started');
      shellState.actionPending = false;
      await refreshShell({ includeLogs: true, silent: true });
    } catch (error) {
      shellState.actionPending = false;
      shellState.error = error.message || String(error);
      notify('Failed to start aria2: ' + shellState.error);
      renderShell();
    }
  }

  async function runShellAction(action, extras) {
    if (!action) return;
    shellState.actionPending = true;
    shellState.error = null;
    renderShell();
    try {
      const response = await api.post('shell/action', Object.assign({ action }, extras || {}));
      const payload = response.shell;
      if (payload && payload.record) {
        shellState.record = payload.record;
        shellState.config = payload.config || shellState.config || null;
      } else {
        shellState.record = null;
        shellState.config = null;
      }
      shellState.error = null;
      const messages = {
        stop: 'aria2 service stopped',
        kill: 'aria2 service killed',
        restart: 'aria2 service restarted',
        remove: 'aria2 shell removed',
        adopt: 'aria2 shell adopted',
      };
      notify(messages[action] || 'Done');
      shellState.actionPending = false;
      await refreshShell({ includeLogs: true, silent: true });
    } catch (error) {
      shellState.actionPending = false;
      shellState.error = error.message || String(error);
      notify('Shell action failed: ' + shellState.error);
      renderShell();
    }
  }

  async function fullRefresh(options) {
    const opts = options || {};
    await Promise.all([
      refreshStatus(),
      refreshDownloads(opts),
      refreshShell({ includeLogs: !!opts.manual, silent: !opts.manual }),
    ]);
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      if (!document.hidden) {
        Promise.allSettled([
          refreshDownloads({}),
          refreshShell({ includeLogs: false, silent: true }),
        ]);
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
    let targetGids = gids;
    if (!Array.isArray(targetGids) && action !== 'purge' && action !== 'pauseAll' && action !== 'resumeAll') {
      targetGids = targetGids ? [targetGids] : [];
    }
    const payload = { action };
    if (Array.isArray(targetGids) && targetGids.length) payload.gids = targetGids;
    await api.post('control', payload);
    await refreshDownloads({});
  }

  function confirmAction(message) {
    return typeof window.confirm === 'function' ? window.confirm(message) : true;
  }

  async function handleAction(action, gids, options) {
    const opts = options || {};
    try {
      if (action === 'remove' || action === 'purge') {
        if (!confirmAction(opts.message || (action === 'purge' ? 'Purge completed/error downloads?' : 'Remove the selected downloads?'))) return;
      }
      await runControl(action, gids);
      notify('Done');
    } catch (error) {
      notify('Action failed: ' + error.message);
      setError('Action failed: ' + error.message);
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
      notify('Enter a download URL');
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
    const parallelRaw = parallelInput ? parseInt(parallelInput.value, 10) : 1;
    if (!Number.isNaN(parallelRaw) && parallelRaw > 0) {
      options['max-connection-per-server'] = String(parallelRaw);
    }
    if (Object.keys(options).length) payload.options = options;
    try {
      newSubmitBtn.disabled = true;
      await api.post('add', payload);
      notify('Download added');
      if (directory) {
        state.lastDirectory = directory;
        persistState();
      }
      closeNewModal();
      await refreshDownloads({});
    } catch (error) {
      notify('Add failed: ' + error.message);
      setError('Add failed: ' + error.message);
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
    if (!browseSheet || !browsePathEl || !browseListEl) return;
    const target = path || '~';
    browsePathEl.textContent = target;
    browseListEl.innerHTML = '<div style="padding:12px; color:rgba(148,163,184,0.8);">Loading...</div>';
    try {
      const items = await fetch('/api/browse?path=' + encodeURIComponent(target))
        .then((res) => res.json())
        .then((body) => {
          if (body && body.ok) return body.data || [];
          throw new Error(body && body.error ? body.error : 'Browse failed');
        });
      const directories = (items || []).filter((item) => item.type === 'directory');
      if (!directories.length) {
        browseListEl.innerHTML = '<div style="padding:12px; color:rgba(148,163,184,0.7);">No subdirectories</div>';
      } else {
        browseListEl.innerHTML = '';
        directories.sort((a, b) => a.name.localeCompare(b.name));
        directories.forEach((dir) => {
          const entry = document.createElement('button');
          entry.type = 'button';
          entry.className = 'aria-browse-item';
          entry.dataset.path = dir.path;
          entry.textContent = dir.name || dir.path;
          browseListEl.appendChild(entry);
        });
      }
      state.browsePath = target;
      browsePathEl.textContent = target;
    } catch (error) {
      browseListEl.innerHTML = '<div style="padding:12px; color:#f87171;">Failed to browse: ' + error.message + '</div>';
    }
  }

  function openBrowseSheet() {
    if (!browseSheet) return;
    const target = directoryInput.value.trim() || state.lastDirectory || '~';
    browseSheet.classList.add('show');
    browseSheet.setAttribute('aria-hidden', 'false');
    loadDirectory(target);
  }

  function closeBrowseSheet() {
    if (!browseSheet) return;
    browseSheet.classList.remove('show');
    browseSheet.setAttribute('aria-hidden', 'true');
  }

  refreshBtn.addEventListener('click', () => {
    fullRefresh({ manual: true });
  });

  if (shellStartBtn) shellStartBtn.addEventListener('click', () => spawnShell(false));
  if (shellStopBtn) shellStopBtn.addEventListener('click', () => runShellAction('stop'));
  if (shellRestartBtn) shellRestartBtn.addEventListener('click', () => runShellAction('restart'));
  if (shellKillBtn) shellKillBtn.addEventListener('click', () => {
    if (!confirmAction('Force kill the aria2 service?')) return;
    runShellAction('kill');
  });
  if (shellRemoveBtn) shellRemoveBtn.addEventListener('click', () => {
    if (!confirmAction('Remove the tracked aria2 framework shell and its logs?')) return;
    runShellAction('remove', { force: true });
  });
  if (shellRefreshBtn) shellRefreshBtn.addEventListener('click', () => {
    refreshShell({ includeLogs: true, silent: false });
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
  browseBtn.addEventListener('click', (event) => {
    event.preventDefault();
    openBrowseSheet();
  });
  browseCloseBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeBrowseSheet();
  });
  browseSelectBtn.addEventListener('click', (event) => {
    event.preventDefault();
    const chosen = state.browsePath || '~';
    directoryInput.value = chosen === '~' ? '' : chosen;
    state.lastDirectory = chosen;
    persistState();
    closeBrowseSheet();
  });
  browseUpBtn.addEventListener('click', (event) => {
    event.preventDefault();
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
    if (row) row.classList.toggle('selected', checkbox.checked);
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
      Promise.allSettled([
        refreshDownloads({}),
        refreshShell({ includeLogs: true, silent: false }),
      ]);
    }
  });

  registerBeforeExit(() => {
    stopPolling();
  });

  renderShell();
  fullRefresh({ manual: true }).finally(() => {
    startPolling();
  });
}
