import { readDownloads, readStatus, readShell, readPicker, readSaved, readDirectoryResponse, errorMessage, required } from './contracts';
import type { Host, API, State, ShellState, Task, Group, RefreshOptions, ShellRefreshOptions, ActionOptions } from './contracts';

const POLL_INTERVAL_MS = 5000;
const SHELL_LOG_TAIL = 120;
const HOST_STORE_KEY = '__ariaDownloaderHost';

function setGlobalHost(host: Host) {
  window[HOST_STORE_KEY] = host || {};
}

function getGlobalHost() {
  return window[HOST_STORE_KEY] || {};
}

function notify(message: string) {
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
    const reason: unknown = event.reason;
    const message = errorMessage(reason);
    notify('[Promise rejection] ' + message);
  });
}

function formatBytes(bytes: number | string | undefined) {
  const value = Number(bytes) || 0;
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, exponent);
  const decimals = scaled >= 10 || exponent === 0 ? 0 : 1;
  return scaled.toFixed(decimals) + ' ' + units[exponent];
}

function formatSpeed(bytesPerSec: number | string | undefined) {
  return formatBytes(bytesPerSec) + '/s';
}

function formatEta(task: Task) {
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

function formatDuration(seconds: number | undefined) {
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

function formatTimestamp(seconds: number) {
  if (seconds == null) return '--';
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
}

function panelLabelForStatus(status: string) {
  if (!status) return 'status';
  const lower = status.toLowerCase();
  if (lower.indexOf('active') >= 0) return 'active';
  if (lower.indexOf('complete') >= 0) return 'completed';
  if (lower.indexOf('error') >= 0) return 'error';
  if (lower.indexOf('pause') >= 0) return 'paused';
  return lower;
}

export default function init(container: HTMLElement, api: API, host?: Host) {
  console.log('Aria Downloader app init v20241014b');
  const safeHost = host || {};
  setGlobalHost(safeHost);

  function setTitle(title: string) {
    if (safeHost && typeof safeHost.setTitle === 'function') {
      try {
        safeHost.setTitle(title);
      } catch (error) {
        console.warn('aria_downloader setTitle failed', error);
      }
    }
  }

  function registerBeforeExit(handler: () => void) {
    if (safeHost && typeof safeHost.onBeforeExit === 'function') {
      try {
        safeHost.onBeforeExit(handler);
      } catch (error) {
        console.warn('aria_downloader onBeforeExit failed', error);
      }
    }
  }

  function loadState(defaultValue: Record<string, unknown>): unknown {
    if (safeHost && typeof safeHost.loadState === 'function') {
      try {
        return safeHost.loadState(defaultValue);
      } catch (error) {
        console.warn('aria_downloader loadState failed', error);
      }
    }
    return defaultValue;
  }

  function saveState(state: Record<string, unknown>) {
    if (safeHost && typeof safeHost.saveState === 'function') {
      try {
        safeHost.saveState(state);
      } catch (error) {
        console.warn('aria_downloader saveState failed', error);
      }
    }
  }

  const summaryEl = required(container, '#aria-summary', HTMLElement);
  const refreshBtn = required(container, '#aria-refresh', HTMLButtonElement);
  const newBtn = required(container, '#aria-new', HTMLButtonElement);
  const loadingEl = required(container, '#aria-loading', HTMLElement);
  const panelsEl = required(container, '#aria-panels', HTMLElement);
  const errorEl = required(container, '#aria-error', HTMLElement);

  const listEls = {
    active: required(container, '#aria-list-active', HTMLElement),
    waiting: required(container, '#aria-list-waiting', HTMLElement),
    stopped: required(container, '#aria-list-stopped', HTMLElement),
  };
  const emptyEls = {
    active: required(container, '#aria-empty-active', HTMLElement),
    waiting: required(container, '#aria-empty-waiting', HTMLElement),
    stopped: required(container, '#aria-empty-stopped', HTMLElement),
  };
  const countEls = {
    active: required(container, '#aria-count-active', HTMLElement),
    waiting: required(container, '#aria-count-waiting', HTMLElement),
    stopped: required(container, '#aria-count-stopped', HTMLElement),
  };

  const sortSelect = required(container, '#aria-sort', HTMLSelectElement);
  const sortDirSelect = required(container, '#aria-sort-dir', HTMLSelectElement);

  const pauseSelectedBtn = required(container, '#aria-pause-selected', HTMLButtonElement);
  const resumeSelectedBtn = required(container, '#aria-resume-selected', HTMLButtonElement);
  const removeSelectedBtn = required(container, '#aria-remove-selected', HTMLButtonElement);
  const clearSelectionBtn = required(container, '#aria-clear-selection', HTMLButtonElement);
  const selectionCountEl = required(container, '#aria-selection-count', HTMLElement);

  const pauseAllBtn = required(container, '#aria-pause-all', HTMLButtonElement);
  const resumeAllBtn = required(container, '#aria-resume-all', HTMLButtonElement);
  const purgeBtn = required(container, '#aria-purge', HTMLButtonElement);

  const newModal = required(container, '#aria-new-modal', HTMLElement);
  const newCloseBtn = required(container, '#aria-new-close', HTMLButtonElement);
  const newCancelBtn = required(container, '#aria-new-cancel', HTMLButtonElement);
  const newSubmitBtn = required(container, '#aria-new-submit', HTMLButtonElement);
  const urlInput = required(container, '#aria-url', HTMLInputElement);
  const directoryInput = required(container, '#aria-directory', HTMLInputElement);
  const filenameInput = required(container, '#aria-filename', HTMLInputElement);
  const pauseOnAddInput = required(container, '#aria-pause-on-add', HTMLInputElement);
  const browseBtn = required(container, '#aria-browse', HTMLButtonElement);
  const parallelInput = required(container, '#aria-parallel', HTMLInputElement);

  const browseSheet = container.querySelector<HTMLElement>('#aria-browse-sheet');
  const browsePathEl = container.querySelector<HTMLElement>('#aria-browse-path');
  const browseListEl = container.querySelector<HTMLElement>('#aria-browse-list');
  const browseUpBtn = container.querySelector<HTMLButtonElement>('#aria-browse-up');
  const browseSelectBtn = container.querySelector<HTMLButtonElement>('#aria-browse-select');
  const browseCloseBtn = container.querySelector<HTMLButtonElement>('#aria-browse-close');
  const hasLegacyBrowse = !!(browseSheet && browsePathEl && browseListEl && browseUpBtn && browseSelectBtn && browseCloseBtn);

  const shellStatusEl = required(container, '#aria-shell-status', HTMLElement);
  const shellMetaEl = required(container, '#aria-shell-meta', HTMLElement);
  const shellLogsWrap = required(container, '#aria-shell-logs', HTMLElement);
  const shellStdoutEl = required(container, '#aria-shell-stdout', HTMLElement);
  const shellStderrEl = required(container, '#aria-shell-stderr', HTMLElement);
  const shellStartBtn = required(container, '#aria-shell-start', HTMLButtonElement);
  const shellStopBtn = required(container, '#aria-shell-stop', HTMLButtonElement);
  const shellRestartBtn = required(container, '#aria-shell-restart', HTMLButtonElement);
  const shellKillBtn = required(container, '#aria-shell-kill', HTMLButtonElement);
  const shellRemoveBtn = required(container, '#aria-shell-remove', HTMLButtonElement);
  const shellRefreshBtn = required(container, '#aria-shell-refresh', HTMLButtonElement);

  const state: State = {
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

  const shellState: ShellState = {
    record: null,
    config: null,
    loading: true,
    error: null,
    actionPending: false,
    lastLogs: null,
  };

  try {
    const saved = readSaved(loadState({}));
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

  function setError(message: string | null) {
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

    function setButtonState(options: Partial<Record<'start' | 'stop' | 'restart' | 'kill' | 'remove' | 'refresh', boolean>>) {
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
      shellState.lastLogs = null;
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
      let logsSource = null;
      if (record.logs) {
        const stdoutLines = Array.isArray(record.logs.stdout_tail) ? record.logs.stdout_tail : [];
        const stderrLines = Array.isArray(record.logs.stderr_tail) ? record.logs.stderr_tail : [];
        logsSource = { stdout: stdoutLines, stderr: stderrLines };
        shellState.lastLogs = logsSource;
      } else if (shellState.lastLogs) {
        logsSource = shellState.lastLogs;
      }
      if (logsSource) {
        const stdoutLines = Array.isArray(logsSource.stdout) ? logsSource.stdout : [];
        const stderrLines = Array.isArray(logsSource.stderr) ? logsSource.stderr : [];
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

  function sortTasks(tasks: Task[]) {
    const key = state.sortKey;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const copy = tasks.slice();
    copy.sort((a, b) => {
      function get(task: Task) {
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

  function humanStatus(task: Task) {
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
    (['active', 'waiting', 'stopped'] as Group[]).forEach((key) => {
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

        function addActionButton(action: string, label: string, cssClass?: string, confirmRequired?: boolean) {
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
      const data = readStatus(await api.get('status'));
      state.status = data;
    } catch (error) {
      console.warn('status fetch failed', error);
    }
  }

  async function refreshDownloads(options: RefreshOptions) {
    const manual = options && options.manual;
    if (manual) setError(null);
    try {
      const data = readDownloads(await api.get('downloads'));
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
      if (state.loading) loadingEl.textContent = 'Unable to load downloads: ' + errorMessage(error);
      setError('Failed to load downloads: ' + errorMessage(error));
    }
  }

  async function refreshShell(options: ShellRefreshOptions = {}) {
    const opts = options || {};
    const includeLogs = !!opts.includeLogs;
    const tailLines = opts.tail != null ? Math.max(0, parseInt(String(opts.tail), 10) || 0) : SHELL_LOG_TAIL;
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
      const result = readShell(await api.get('shell' + query));
      const payload = result.shell;
      if (payload && payload.record) {
        shellState.record = payload.record;
        shellState.config = payload.config || null;
        if (payload.record.logs) {
          const stdoutLines = Array.isArray(payload.record.logs.stdout_tail) ? payload.record.logs.stdout_tail : [];
          const stderrLines = Array.isArray(payload.record.logs.stderr_tail) ? payload.record.logs.stderr_tail : [];
          shellState.lastLogs = { stdout: stdoutLines, stderr: stderrLines };
        }
      } else {
        shellState.record = null;
        shellState.config = null;
        shellState.lastLogs = null;
      }
      shellState.error = null;
    } catch (error) {
      shellState.error = errorMessage(error);
    } finally {
      shellState.loading = false;
      renderShell();
    }
  }

  async function spawnShell(force: boolean) {
    shellState.actionPending = true;
    shellState.error = null;
    renderShell();
    try {
      const response = readShell(await api.post('shell/spawn', force ? { force: true } : {}));
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
      shellState.error = errorMessage(error);
      notify('Failed to start aria2: ' + shellState.error);
      renderShell();
    }
  }

  async function runShellAction(action: string, extras?: Record<string, unknown>) {
    if (!action) return;
    shellState.actionPending = true;
    shellState.error = null;
    renderShell();
    try {
      const response = readShell(await api.post('shell/action', Object.assign({ action }, extras || {})));
      const payload = response.shell;
      if (payload && payload.record) {
        shellState.record = payload.record;
        shellState.config = payload.config || shellState.config || null;
      } else {
        shellState.record = null;
        shellState.config = null;
      }
      shellState.error = null;
      const messages: Record<string, string> = {
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
      shellState.error = errorMessage(error);
      notify('Shell action failed: ' + shellState.error);
      renderShell();
    }
  }

  async function fullRefresh(options: RefreshOptions = {}) {
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

  async function runControl(action: string, gids?: string | string[] | null) {
    let targetGids = gids;
    if (!Array.isArray(targetGids) && action !== 'purge' && action !== 'pauseAll' && action !== 'resumeAll') {
      targetGids = targetGids ? [targetGids] : [];
    }
    const payload: Record<string, unknown> = { action };
    if (Array.isArray(targetGids) && targetGids.length) payload.gids = targetGids;
    await api.post('control', payload);
    await refreshDownloads({});
  }

  function confirmAction(message: string) {
    return window.teUI?.dialog.confirm(message) ?? Promise.resolve(false);
  }

  async function handleAction(action: string, gids?: string | string[] | null, options?: ActionOptions) {
    const opts = options || {};
    try {
      if (action === 'remove' || action === 'purge') {
        if (!(await confirmAction(opts.message || (action === 'purge' ? 'Purge completed/error downloads?' : 'Remove the selected downloads?')))) return;
      }
      await runControl(action, gids);
      notify('Done');
    } catch (error) {
      notify('Action failed: ' + errorMessage(error));
      setError('Action failed: ' + errorMessage(error));
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
    const options: Record<string, string> = {};
    if (pauseOnAddInput.checked) options.pause = 'true';
    const payload: Record<string, unknown> = { url };
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
      notify('Add failed: ' + errorMessage(error));
      setError('Add failed: ' + errorMessage(error));
    } finally {
      newSubmitBtn.disabled = false;
    }
  }

  async function openDirectoryPicker() {
    if (!(window.teFilePicker && typeof window.teFilePicker.openDirectory === 'function')) {
      notify('File picker unavailable');
      return;
    }
    const start = directoryInput.value.trim() || state.lastDirectory || '~';
    try {
      const result = readPicker(await window.teFilePicker.openDirectory({
        startPath: start,
        title: 'Select download directory',
        selectLabel: 'Use Folder',
      }));
      if (result && result.path) {
        let chosen = result.path;
        if (typeof chosen === 'string' && chosen.endsWith('/')) {
          chosen = chosen.replace(/\/+$/, '');
        }
        directoryInput.value = chosen === '~' ? '' : chosen;
        state.lastDirectory = chosen;
        state.browsePath = chosen;
        persistState();
      }
    } catch (error) {
      if (errorMessage(error) === 'cancelled') return;
      const message = errorMessage(error);
      notify('Browse failed: ' + message);
    }
  }

  function parentDir(path: string) {
    if (!path || path === '~') return '~';
    const cleaned = path.replace(/\/+$/, '');
    const idx = cleaned.lastIndexOf('/');
    if (idx <= 0) return '/';
    return cleaned.slice(0, idx);
  }

  async function loadDirectory(path: string) {
    if (!hasLegacyBrowse) {
      return;
    }
    if (!browseSheet || !browsePathEl || !browseListEl) return;
    const target = path || '~';
    browsePathEl.textContent = target;
    browseListEl.innerHTML = '<div style="padding:12px; color:rgba(148,163,184,0.8);">Loading...</div>';
    try {
      const items = await fetch('/api/browse?path=' + encodeURIComponent(target))
        .then((res) => res.json())
        .then((body: unknown) => readDirectoryResponse(body));
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
      browseListEl.innerHTML = '<div style="padding:12px; color:#f87171;">Failed to browse: ' + errorMessage(error) + '</div>';
    }
  }

  function openBrowseSheet() {
    if (!hasLegacyBrowse) {
      openDirectoryPicker();
      return;
    }
    if (!browseSheet) return;
    const target = directoryInput.value.trim() || state.lastDirectory || '~';
    browseSheet.classList.add('show');
    browseSheet.setAttribute('aria-hidden', 'false');
    loadDirectory(target);
  }

  function closeBrowseSheet() {
    if (!hasLegacyBrowse) return;
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
  if (shellKillBtn) shellKillBtn.addEventListener('click', async () => {
    if (!(await confirmAction('Force kill the aria2 service?'))) return;
    runShellAction('kill');
  });
  if (shellRemoveBtn) shellRemoveBtn.addEventListener('click', async () => {
    if (!(await confirmAction('Remove the tracked aria2 framework shell and its logs?'))) return;
    runShellAction('remove', { force: true });
  });
  if (shellRefreshBtn) shellRefreshBtn.addEventListener('click', () => {
    refreshShell({ includeLogs: true, silent: false });
  });

  newBtn.addEventListener('click', openNewModal);
  newCloseBtn.addEventListener('click', closeNewModal);
  newCancelBtn.addEventListener('click', closeNewModal);
  newSubmitBtn.addEventListener('click', submitNewDownload);

  if (directoryInput) {
    directoryInput.addEventListener('change', () => {
      const value = directoryInput.value.trim();
      state.lastDirectory = value || '~';
      persistState();
    });
  }
  if (browseBtn) {
    browseBtn.addEventListener('click', (event) => {
      if (event) event.preventDefault();
      if (hasLegacyBrowse) {
        openBrowseSheet();
      } else {
        openDirectoryPicker();
      }
    });
  }
  if (hasLegacyBrowse) {
    browseCloseBtn.addEventListener('click', (event) => {
      if (event) event.preventDefault();
      closeBrowseSheet();
    });
    browseSelectBtn.addEventListener('click', (event) => {
      if (event) event.preventDefault();
      const chosen = state.browsePath || '~';
      directoryInput.value = chosen === '~' ? '' : chosen;
      state.lastDirectory = chosen;
      persistState();
      closeBrowseSheet();
    });
    browseUpBtn.addEventListener('click', (event) => {
      if (event) event.preventDefault();
      loadDirectory(parentDir(state.browsePath));
    });
    browseListEl.addEventListener('click', (event) => {
      const btn = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-path]') : null;
      if (!btn) return;
      loadDirectory(btn.dataset.path || '~');
    });
  }

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
    const btn = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-action]') : null;
    if (!btn) return;
    const action = btn.dataset.action;
    const gid = btn.dataset.gid;
    const confirmNeeded = btn.dataset.confirm === 'true';
    handleAction(action || '', gid, confirmNeeded ? { message: 'Remove this download?' } : {});
  });

  panelsEl.addEventListener('change', (event) => {
    const checkbox = event.target instanceof Element ? event.target.closest<HTMLInputElement>('input.aria-select') : null;
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
      } else if (browseSheet && browseSheet.classList && browseSheet.classList.contains('show')) {
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
