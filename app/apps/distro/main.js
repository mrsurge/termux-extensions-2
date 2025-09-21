const STATE = {
  containers: [],
  pollTimer: null,
};

const IMPORT = {
  lastRootfs: null,
  lastTarget: null,
};

let host;
let apiRef;
let renderRefs = { containerEl: null, emptyEl: null };

function notify(message) {
  if (host && typeof host.toast === 'function') {
    host.toast(message);
  } else if (window.teUI && typeof window.teUI.toast === 'function') {
    window.teUI.toast(message);
  } else {
    console.log('[distro]', message);
  }
}

async function pickDirectory(startPath, title) {
  if (!(window.teFilePicker && typeof window.teFilePicker.openDirectory === 'function')) {
    notify('File picker unavailable');
    return null;
  }
  try {
    const result = await window.teFilePicker.openDirectory({
      startPath: startPath || '~',
      title: title || 'Select directory',
      selectLabel: 'Use Folder',
    });
    return result?.path || null;
  } catch (err) {
    notify(err.message || 'Picker cancelled');
    return null;
  }
}


function inferChrootPath(rootfs) {
  if (!rootfs) return '';
  const cleaned = rootfs.replace(/\/+$/, '');
  const idx = cleaned.lastIndexOf('/');
  if (idx <= 0) return cleaned;
  return cleaned.slice(0, idx);
}

function statusDotClass(state) {
  switch (state) {
    case 'running':
      return 'distro-state-running';
    case 'mounted':
      return 'distro-state-mounted';
    case 'error':
      return 'distro-state-error';
    default:
      return 'distro-state-offline';
  }
}

function formatStats(container) {
  const shell = container.shell;
  if (!shell || !shell.stats || !shell.stats.alive) return '';
  const parts = [];
  if (shell.stats.uptime != null) {
    const up = Math.max(0, Math.round(shell.stats.uptime));
    parts.push(`uptime: ${up}s`);
  }
  if (shell.stats.cpu_percent != null) parts.push(`cpu: ${shell.stats.cpu_percent.toFixed(1)}%`);
  if (shell.stats.memory_rss != null) {
    const mb = (shell.stats.memory_rss / (1024 * 1024)).toFixed(1);
    parts.push(`mem: ${mb} MB`);
  }
  return parts.join(' · ');
}

function renderContainers(containerEl, emptyEl) {
  if (!STATE.containers.length) {
    emptyEl.style.display = 'block';
    containerEl.innerHTML = '';
    return;
  }
  emptyEl.style.display = 'none';
  containerEl.innerHTML = '';

  STATE.containers.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'distro-card';

    const title = document.createElement('h3');
    title.textContent = item.label;
    card.appendChild(title);

    const stateRow = document.createElement('div');
    stateRow.className = 'distro-state';
    const dot = document.createElement('span');
    dot.className = `distro-state-dot ${statusDotClass(item.state)}`;
    stateRow.appendChild(dot);
    const stateLabel = document.createElement('span');
    stateLabel.textContent = item.state;
    stateRow.appendChild(stateLabel);
    card.appendChild(stateRow);

    const meta = document.createElement('div');
    meta.className = 'distro-meta';
    if (item.rootfs) meta.appendChild(textLine('rootfs', item.rootfs));
    if (item.shell_id) meta.appendChild(textLine('shell id', item.shell_id));
    const stats = formatStats(item);
    if (stats) meta.appendChild(textLine('stats', stats));
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'distro-actions';

    const primary = document.createElement('button');
    primary.className = 'distro-btn primary';
    if (item.state === 'running') {
      primary.textContent = 'Stop';
      primary.addEventListener('click', () => stopContainer(item));
    } else {
      primary.textContent = 'Start';
      primary.addEventListener('click', () => startContainer(item));
    }
    actions.appendChild(primary);

    const mountBtn = document.createElement('button');
    mountBtn.className = 'distro-btn';
    mountBtn.textContent = 'Mount';
    mountBtn.addEventListener('click', () => mountContainer(item));
    actions.appendChild(mountBtn);

    const unmountBtn = document.createElement('button');
    unmountBtn.className = 'distro-btn';
    unmountBtn.textContent = 'Unmount';
    unmountBtn.addEventListener('click', () => unmountContainer(item));
    actions.appendChild(unmountBtn);

    const logsBtn = document.createElement('button');
    logsBtn.className = 'distro-btn';
    logsBtn.textContent = 'Logs';
    logsBtn.addEventListener('click', () => showLogs(item));
    actions.appendChild(logsBtn);

    const shellBtn = document.createElement('button');
    shellBtn.className = 'distro-btn';
    shellBtn.textContent = 'Open Shell';
    shellBtn.addEventListener('click', () => notify('Shell hand-off not implemented yet'));
    actions.appendChild(shellBtn);

    card.appendChild(actions);
    containerEl.appendChild(card);
  });
}

function textLine(key, value) {
  const div = document.createElement('div');
  div.textContent = `${key}: ${value}`;
  return div;
}

async function fetchContainers() {
  const data = await apiRef.get('containers');
  STATE.containers = data || [];
}

function schedulePoll() {
  if (STATE.pollTimer) clearTimeout(STATE.pollTimer);
  const fast = STATE.containers.some((c) => c.state === 'running');
  const delay = fast ? 5000 : 15000;
  STATE.pollTimer = setTimeout(() => loadAndRender(), delay);
}

async function loadAndRender() {
  try {
    await fetchContainers();
    renderContainers(renderRefs.containerEl, renderRefs.emptyEl);
    schedulePoll();
  } catch (err) {
    notify(err.message || 'Failed to load containers');
  }
}

async function callAction(path, body = {}, successMessage) {
  const response = await apiRef.post(path, body);
  if (successMessage) notify(successMessage);
  return response;
}

async function mountContainer(item) {
  try {
    await callAction(`containers/${item.id}/mount`, {}, 'Mounted');
    await loadAndRender();
  } catch (err) {
    notify(err.message || 'Mount failed');
  }
}

async function unmountContainer(item) {
  try {
    await callAction(`containers/${item.id}/unmount`, {}, 'Unmounted');
    await loadAndRender();
  } catch (err) {
    notify(err.message || 'Unmount failed');
  }
}

async function startContainer(item) {
  try {
    await callAction(`containers/${item.id}/start`, {}, 'Starting container');
    await loadAndRender();
  } catch (err) {
    notify(err.message || 'Start failed');
  }
}

async function stopContainer(item) {
  try {
    await callAction(`containers/${item.id}/stop`, {}, 'Stopping container');
    await loadAndRender();
  } catch (err) {
    notify(err.message || 'Stop failed');
  }
}

function resetImportForm(form) {
  if (!form) return;
  form.reset();
}

async function handleImportSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form) return;
  const id = form.querySelector('#distro-import-id').value.trim();
  const label = form.querySelector('#distro-import-label').value.trim();
  const rootfs = form.querySelector('#distro-import-rootfs').value.trim();
  const chrootPath = form.querySelector('#distro-import-chroot-path').value.trim();
  const device = form.querySelector('#distro-import-device').value.trim();
  const target = form.querySelector('#distro-import-target').value.trim();
  const options = form.querySelector('#distro-import-options').value.trim();
  const autostart = form.querySelector('#distro-import-autostart').checked;
  if (!id) {
    notify('Container ID is required');
    return;
  }
  if (!rootfs) {
    notify('Rootfs path is required');
    return;
  }
  const payload = {
    id,
    type: 'chroot-distro',
    label: label || id,
    rootfs,
    auto_start: autostart,
    environment: {},
  };
  const resolvedChroot = chrootPath || inferChrootPath(rootfs);
  if (resolvedChroot) {
    payload.environment.CHROOT_DISTRO_PATH = resolvedChroot;
  }
  const mounts = [];
  if (device || target) {
    if (!device || !target) {
      notify('Both device and mount target are required when specifying a mount');
      return;
    }
    const mountEntry = { device, target };
    if (options) mountEntry.options = options;
    mounts.push(mountEntry);
  }
  if (mounts.length) payload.mounts = mounts;
  if (!Object.keys(payload.environment).length) delete payload.environment;
  try {
    await apiRef.post('containers', payload);
    IMPORT.lastRootfs = rootfs;
    IMPORT.lastTarget = target || IMPORT.lastTarget;
    notify('Container saved');
    closeImportModal();
    resetImportForm(form);
    await loadAndRender();
  } catch (err) {
    notify(err.message || 'Failed to save container');
  }
}

function openImportModal() {
  const modal = document.getElementById('distro-import-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const firstInput = modal.querySelector('input');
  if (firstInput) firstInput.focus();
}

function closeImportModal() {
  const modal = document.getElementById('distro-import-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

async function showLogs(item) {
  const modal = document.getElementById('distro-logs-modal');
  const output = document.getElementById('distro-logs-output');
  const title = document.getElementById('distro-logs-title');
  try {
    const logs = await apiRef.get(`containers/${item.id}/logs?tail=400`);
    title.textContent = `${item.label} logs`;
    const lines = [];
    if (logs.stdout_tail?.length) {
      lines.push('--- stdout ---', ...logs.stdout_tail);
    }
    if (logs.stderr_tail?.length) {
      lines.push('--- stderr ---', ...logs.stderr_tail);
    }
    output.textContent = lines.join('\n') || 'No logs available';
    modal.classList.remove('hidden');
  } catch (err) {
    notify(err.message || 'Failed to load logs');
  }
}

export default function init(container, api, hostRef) {
  apiRef = api;
  host = hostRef;
  host.setTitle('Distro Manager');

  const cards = container.querySelector('#distro-cards');
  const empty = container.querySelector('#distro-empty');
  const refreshBtn = container.querySelector('#distro-refresh');
  const logsModal = document.getElementById('distro-logs-modal');
  const logsClose = document.getElementById('distro-logs-close');

  const addBtn = container.querySelector('#distro-add');
  const importModal = document.getElementById('distro-import-modal');
  const importClose = document.getElementById('distro-import-close');
  const importCancel = document.getElementById('distro-import-cancel');
  const importForm = document.getElementById('distro-import-form');
  const rootfsInput = document.getElementById('distro-import-rootfs');
  const chrootInput = document.getElementById('distro-import-chroot-path');
  const targetInput = document.getElementById('distro-import-target');
  const rootfsBrowse = document.getElementById('distro-import-rootfs-browse');
  const targetBrowse = document.getElementById('distro-import-target-browse');

  renderRefs = { containerEl: cards, emptyEl: empty };

  if (refreshBtn) refreshBtn.addEventListener('click', () => loadAndRender());
  if (logsClose) logsClose.addEventListener('click', () => logsModal.classList.add('hidden'));
  if (logsModal) logsModal.addEventListener('click', (ev) => { if (ev.target === logsModal) logsModal.classList.add('hidden'); });

  const closeImport = () => {
    closeImportModal();
    resetImportForm(importForm);
  };

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      resetImportForm(importForm);
      if (IMPORT.lastRootfs && rootfsInput) {
        rootfsInput.value = IMPORT.lastRootfs;
        if (chrootInput) chrootInput.value = inferChrootPath(IMPORT.lastRootfs);
      }
      if (IMPORT.lastTarget && targetInput) {
        targetInput.value = IMPORT.lastTarget;
      }
      openImportModal();
    });
  }

  if (importClose) importClose.addEventListener('click', closeImport);
  if (importCancel) importCancel.addEventListener('click', closeImport);
  if (importModal) importModal.addEventListener('click', (ev) => { if (ev.target === importModal) closeImport(); });
  if (importForm) importForm.addEventListener('submit', handleImportSubmit);

  if (rootfsBrowse) {
    rootfsBrowse.addEventListener('click', async () => {
      const start = (rootfsInput && rootfsInput.value.trim()) || IMPORT.lastRootfs || '~';
      const selected = await pickDirectory(start, 'Select rootfs directory');
      if (selected) {
        if (rootfsInput) rootfsInput.value = selected;
        IMPORT.lastRootfs = selected;
        if (chrootInput) chrootInput.value = inferChrootPath(selected);
      }
    });
  }
  if (rootfsInput) {
    rootfsInput.addEventListener('blur', () => {
      const value = rootfsInput.value.trim();
      if (value && chrootInput && !chrootInput.value.trim()) {
        chrootInput.value = inferChrootPath(value);
      }
    });
  }

  if (targetBrowse) {
    targetBrowse.addEventListener('click', async () => {
      const start = (targetInput && targetInput.value.trim()) || IMPORT.lastTarget || '~';
      const selected = await pickDirectory(start, 'Select mount target');
      if (selected) {
        if (targetInput) targetInput.value = selected;
        IMPORT.lastTarget = selected;
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (importModal && !importModal.classList.contains('hidden')) {
        event.stopPropagation();
        closeImport();
      } else if (logsModal && !logsModal.classList.contains('hidden')) {
        event.stopPropagation();
        logsModal.classList.add('hidden');
      }
    }
  });

  host.onBeforeExit(() => {
    if (STATE.pollTimer) clearTimeout(STATE.pollTimer);
    closeImport();
    if (logsModal) logsModal.classList.add('hidden');
  });

  loadAndRender();
}
