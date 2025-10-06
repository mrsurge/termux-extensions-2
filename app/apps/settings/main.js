const METRICS_ENDPOINT = '/api/framework/runtime/metrics';
const SHELLS_ENDPOINT = '/api/framework_shells';
const SHELL_ACTION_ENDPOINT = (id) => `/api/framework_shells/${id}/action`;
const SHELL_DELETE_ENDPOINT = (id) => `/api/framework_shells/${id}`;
const SHUTDOWN_ENDPOINT = '/api/framework/runtime/shutdown';
const SETTINGS_ENDPOINT = '/api/settings';
const EXTENSIONS_ENDPOINT = '/api/extensions';

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '--';
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || parts.length) parts.push(`${hours}h`);
  if (minutes || parts.length) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

export default function init(root, _api, host) {
  const metricsSection = root.querySelector('[data-section="metrics"]');
  const metricsFields = {
    runId: metricsSection?.querySelector('[data-field="run-id"]') || null,
    supervisorPid: metricsSection?.querySelector('[data-field="supervisor-pid"]') || null,
    appPid: metricsSection?.querySelector('[data-field="app-pid"]') || null,
    uptime: metricsSection?.querySelector('[data-field="uptime"]') || null,
    shellCount: metricsSection?.querySelector('[data-field="shell-count"]') || null,
    sessionCount: metricsSection?.querySelector('[data-field="session-count"]') || null,
    shellMemory: metricsSection?.querySelector('[data-field="shell-memory"]') || null,
  };

  const shellListEl = root.querySelector('[data-role="shell-list"]');
  const tokenInput = root.querySelector('#framework-token');
  const extensionOrderContainer = root.querySelector('[data-role="extension-order"]');
  const saveExtensionOrderBtn = root.querySelector('[data-action="save-extension-order"]');
  const reloadExtensionsBtn = root.querySelector('[data-action="reload-extensions"]');

  let frameworkToken = '';
  const savedState = typeof host.loadState === 'function' ? host.loadState({}) : null;
  if (savedState && typeof savedState === 'object' && savedState.frameworkToken) {
    frameworkToken = savedState.frameworkToken;
    if (tokenInput) tokenInput.value = frameworkToken;
  }

  let settingsCache = null;
  let settingsLoaded = false;

  function persistToken(token) {
    frameworkToken = token.trim();
    if (tokenInput) tokenInput.value = frameworkToken;
    if (typeof host.saveState === 'function') {
      host.saveState({ frameworkToken });
    }
  }

  async function request(url, options = {}, useToken = false) {
    const opts = { ...options };
    opts.headers = { ...(options.headers || {}) };
    if (useToken && frameworkToken) {
      opts.headers['X-Framework-Key'] = frameworkToken;
    }
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    try {
      const response = await fetch(url, opts);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      return body.data ?? body;
    } catch (err) {
      const message = err?.message || 'Request failed';
      if (host?.toast) host.toast(message, 3500);
      throw err;
    }
  }

  async function ensureSettings() {
    if (settingsLoaded) return settingsCache || {};
    try {
      settingsCache = await request(SETTINGS_ENDPOINT);
      if (!settingsCache || typeof settingsCache !== 'object') settingsCache = {};
    } catch (err) {
      console.error('Failed to load settings', err);
      settingsCache = {};
    }
    settingsLoaded = true;
    return settingsCache;
  }

  async function persistSettingsPatch(patch) {
    await ensureSettings();
    const merged = { ...(settingsCache || {}), ...(patch || {}) };
    settingsCache = await request(SETTINGS_ENDPOINT, { method: 'POST', body: merged });
    if (!settingsCache || typeof settingsCache !== 'object') settingsCache = {};
    settingsLoaded = true;
    return settingsCache;
  }

  function updateMetrics(data) {
    const uptime = data?.uptime ?? 0;
    const shellStats = data?.framework_shells ?? {};
    const sessions = data?.interactive_sessions ?? {};

    const assign = (node, value) => {
      if (node) node.textContent = value;
    };

    assign(metricsFields.runId, data?.run_id || '--');
    assign(metricsFields.supervisorPid, data?.supervisor_pid ?? '--');
    assign(metricsFields.appPid, data?.app_pid ?? '--');
    assign(metricsFields.uptime, formatDuration(uptime));
    assign(metricsFields.shellCount, `${shellStats.num_running || 0} running / ${shellStats.num_shells || 0} total`);
    assign(metricsFields.sessionCount, `${sessions.matching_run || 0} / ${sessions.total || 0}`);
    assign(metricsFields.shellMemory, formatBytes(shellStats.memory_rss || 0));
  }

  function renderShells(shells) {
    if (!shellListEl) return;
    shellListEl.innerHTML = '';
    if (!shells || shells.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No framework shells are currently tracked.';
      shellListEl.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'shell-table';
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Label</th>
        <th>Status</th>
        <th>PID</th>
        <th>Command</th>
        <th>Actions</th>
      </tr>
    `;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    const makeActionButton = (label, handler, variant) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (variant) btn.classList.add(variant);
      btn.addEventListener('click', async () => {
        try {
          await handler();
        } catch (_) {
          /* errors already surfaced via toast */
        }
      });
      return btn;
    };

    shells.forEach((shell) => {
      const row = document.createElement('tr');
      const label = shell.label || shell.id;
      const command = Array.isArray(shell.command) ? shell.command.join(' ') : String(shell.command || '');

      row.innerHTML = `
        <td>${label}</td>
        <td>${shell.status || 'unknown'}</td>
        <td>${shell.pid ?? '--'}</td>
        <td>${command}</td>
      `;

      const actionsCell = document.createElement('td');
      actionsCell.className = 'shell-actions';

      actionsCell.appendChild(makeActionButton('Stop', () => performShellAction(shell.id, 'stop')));
      actionsCell.appendChild(makeActionButton('Kill', () => performShellAction(shell.id, 'kill'), 'danger'));
      actionsCell.appendChild(makeActionButton('Restart', () => performShellAction(shell.id, 'restart')));
      actionsCell.appendChild(makeActionButton('Remove', () => removeShell(shell.id), 'danger'));

      row.appendChild(actionsCell);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    shellListEl.appendChild(table);
  }

  function renderExtensionOrderList(extensions) {
    if (!extensionOrderContainer) return;
    extensionOrderContainer.innerHTML = '';

    if (!Array.isArray(extensions) || extensions.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No extensions found.';
      extensionOrderContainer.appendChild(empty);
      return;
    }

    const savedOrder = Array.isArray(settingsCache?.extensionOrder) ? settingsCache.extensionOrder : [];
    const sorted = [...extensions].sort((a, b) => {
      const aId = `extension-${a._ext_dir}`;
      const bId = `extension-${b._ext_dir}`;
      const aIdx = savedOrder.indexOf(aId);
      const bIdx = savedOrder.indexOf(bId);
      if (aIdx === -1 && bIdx === -1) return a.name.localeCompare(b.name);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    const list = document.createElement('div');
    list.className = 'reorder-list';

    sorted.forEach((ext) => {
      const extId = `extension-${ext._ext_dir}`;
      const item = document.createElement('div');
      item.className = 'reorder-item';
      item.dataset.extId = extId;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = `${ext.name}`;

      const controls = document.createElement('div');
      controls.className = 'reorder-item-controls';

      const upButton = document.createElement('button');
      upButton.textContent = '↑';
      upButton.addEventListener('click', () => {
        if (item.previousElementSibling) {
          list.insertBefore(item, item.previousElementSibling);
        }
      });

      const downButton = document.createElement('button');
      downButton.textContent = '↓';
      downButton.addEventListener('click', () => {
        if (item.nextElementSibling) {
          list.insertBefore(item.nextElementSibling, item);
        }
      });

      controls.appendChild(upButton);
      controls.appendChild(downButton);

      item.appendChild(nameSpan);
      item.appendChild(controls);
      list.appendChild(item);
    });

    extensionOrderContainer.appendChild(list);
  }

  async function loadMetrics() {
    const data = await request(METRICS_ENDPOINT);
    updateMetrics(data);
  }

  async function loadShells() {
    const shells = await request(SHELLS_ENDPOINT, {}, true);
    renderShells(shells || []);
  }

  async function loadExtensions() {
    await ensureSettings();
    const extensions = await request(EXTENSIONS_ENDPOINT);
    renderExtensionOrderList(extensions || []);
  }

  async function performShellAction(shellId, action) {
    await request(SHELL_ACTION_ENDPOINT(shellId), { method: 'POST', body: { action } }, true);
    if (host?.toast) host.toast(`Shell ${shellId} ${action} requested`, 2500);
    await Promise.allSettled([loadShells(), loadMetrics()]);
  }

  async function removeShell(shellId) {
    await request(SHELL_DELETE_ENDPOINT(shellId), { method: 'DELETE' }, true);
    if (host?.toast) host.toast(`Shell ${shellId} removed`, 2500);
    await Promise.allSettled([loadShells(), loadMetrics()]);
  }

  async function shutdownSupervisor() {
    if (!window.confirm('Shutdown the framework supervisor and terminate all shells?')) {
      return;
    }
    try {
      await request(SHUTDOWN_ENDPOINT, { method: 'POST' }, true);
      if (host?.toast) host.toast('Shutdown signal sent', 3000);
    } catch (_) {
      /* errors already surfaced */
    }
  }

  root.querySelector('[data-action="refresh-metrics"]')?.addEventListener('click', () => {
    loadMetrics().catch(() => {});
  });
  root.querySelector('[data-action="refresh-shells"]')?.addEventListener('click', () => {
    loadShells().catch(() => {});
  });
  root.querySelector('[data-action="store-token"]')?.addEventListener('click', () => {
    persistToken(tokenInput?.value || '');
    if (host?.toast) host.toast('Framework token saved', 2000);
  });
  root.querySelector('[data-action="clear-token"]')?.addEventListener('click', () => {
    persistToken('');
    if (host?.toast) host.toast('Framework token cleared', 2000);
  });
  root.querySelector('[data-action="shutdown"]')?.addEventListener('click', () => {
    shutdownSupervisor().catch(() => {});
  });
  reloadExtensionsBtn?.addEventListener('click', () => {
    loadExtensions().catch(() => {});
  });
  saveExtensionOrderBtn?.addEventListener('click', async () => {
    if (!extensionOrderContainer) return;
    const items = extensionOrderContainer.querySelectorAll('[data-ext-id]');
    const newOrder = Array.from(items).map((item) => item.dataset.extId);
    try {
      await persistSettingsPatch({ extensionOrder: newOrder });
      if (host?.toast) host.toast('Extension order saved', 2000);
    } catch (err) {
      console.error('Failed to save extension order', err);
      if (host?.toast) host.toast('Failed to save extension order', 3000);
    }
  });

  loadMetrics().catch(() => {});
  loadShells().catch(() => {});
  loadExtensions().catch(() => {});
}
