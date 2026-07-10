const SHELLS_ENDPOINT = '/api/framework_shells';
const SHELL_ACTION_ENDPOINT = (id) => `/api/framework_shells/${id}/action`;
const SHELL_DELETE_ENDPOINT = (id) => `/api/framework_shells/${id}`;
const SETTINGS_ENDPOINT = '/api/settings';
const EXTENSIONS_ENDPOINT = '/api/extensions';

export default function init(root, _api, host) {
  const shellListEl = root.querySelector('[data-role="shell-list"]');
  const tokenInput = root.querySelector('#framework-token');
  const extensionOrderContainer = root.querySelector('[data-role="extension-order"]');
  const saveExtensionOrderBtn = root.querySelector('[data-action="save-extension-order"]');
  const reloadExtensionsBtn = root.querySelector('[data-action="reload-extensions"]');
  const saveIntegrationBtn = root.querySelector('[data-action="save-integration-settings"]');

  const persistentNetworkToggle = root.querySelector('#setting-persistent-network');

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
    await loadShells();
  }

  async function removeShell(shellId) {
    await request(SHELL_DELETE_ENDPOINT(shellId), { method: 'DELETE' }, true);
    if (host?.toast) host.toast(`Shell ${shellId} removed`, 2500);
    await loadShells();
  }

  root.querySelector('[data-action="refresh-shells"]')?.addEventListener('click', () => {
    loadShells().catch(() => { });
  });
  root.querySelector('[data-action="store-token"]')?.addEventListener('click', () => {
    persistToken(tokenInput?.value || '');
    if (host?.toast) host.toast('Framework token saved', 2000);
  });
  root.querySelector('[data-action="clear-token"]')?.addEventListener('click', () => {
    persistToken('');
    if (host?.toast) host.toast('Framework token cleared', 2000);
  });
  reloadExtensionsBtn?.addEventListener('click', () => {
    loadExtensions().catch(() => { });
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

  saveIntegrationBtn?.addEventListener('click', async () => {
    const patch = {
      persistent_network_notification: !!persistentNetworkToggle?.checked,
    };

    try {
      await persistSettingsPatch(patch);
      if (host?.toast) host.toast('Integration settings saved', 2000);
    } catch (err) {
      console.error('Failed to save integration settings', err);
      if (host?.toast) host.toast('Failed to save settings', 3000);
    }
  });

  async function loadAndRenderAll() {
    await loadShells().catch(() => { });
    await loadExtensions().catch(() => { });

    const settings = await ensureSettings();
    if (persistentNetworkToggle) {
      persistentNetworkToggle.checked = !!settings.persistent_network_notification;
    }
  }

  loadAndRenderAll();
}
