const STATE = {
  containers: [],
  sessions: [],
  pollTimer: null,
};

const IMPORT = {
  lastRootfs: null,
  lastTarget: null,
};

let host;
let apiRef;
let refs = {
  containerEl: null,
  emptyEl: null,
  logsModal: null,
  logsOutput: null,
  logsTitle: null,
  importModal: null,
  importForm: null,
  attachModal: null,
  attachList: null,
};

let currentAttachContainer = null;

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
      selectLabel: 'Select Folder',
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

function sessionById(sid) {
  return STATE.sessions.find((session) => session.sid === sid);
}

function attachmentEntries(container) {
  const attachments = Array.isArray(container.attachments) ? container.attachments : [];
  return attachments.map((sid) => {
    const session = sessionById(sid);
    return {
      sid,
      session,
    };
  });
}

function availableSessions(container) {
  const attached = new Set((container.attachments || []).map(String));
  return STATE.sessions.filter((session) => !attached.has(session.sid) && !session.busy);
}

function textLine(key, value) {
  const div = document.createElement('div');
  div.innerHTML = `<span class="distro-meta-key">${key}:</span> <span>${value}</span>`;
  return div;
}

function renderContainers() {
  const { containerEl, emptyEl } = refs;
  if (!containerEl || !emptyEl) return;

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

    const header = document.createElement('div');
    header.className = 'distro-card-header';

    const title = document.createElement('h3');
    title.textContent = item.label;
    header.appendChild(title);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'distro-menu-btn';
    menuBtn.textContent = '⋯';
    menuBtn.addEventListener('click', (ev) => openMenu(item, menuBtn, ev));
    header.appendChild(menuBtn);

    card.appendChild(header);

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

    const primaryRow = document.createElement('div');
    primaryRow.className = 'distro-primary-row';

    const primaryBtn = document.createElement('button');
    primaryBtn.className = 'distro-btn primary';
    if (item.state === 'running') {
      primaryBtn.textContent = 'Stop';
      primaryBtn.addEventListener('click', () => stopContainer(item));
    } else {
      primaryBtn.textContent = 'Start';
      primaryBtn.addEventListener('click', () => startContainer(item));
    }
    primaryRow.appendChild(primaryBtn);

    const menu = buildMenu(item);
    primaryRow.appendChild(menu);

    card.appendChild(primaryRow);

    const attachments = attachmentEntries(item);
    const attachmentsBlock = document.createElement('div');
    attachmentsBlock.className = 'distro-attachments';
    const headerRow = document.createElement('div');
    headerRow.className = 'distro-attachments-header';
    const label = document.createElement('span');
    label.textContent = 'Attached Sessions';
    headerRow.appendChild(label);
    attachmentsBlock.appendChild(headerRow);

    if (!attachments.length) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'distro-attachments-empty';
      emptyMsg.textContent = 'No sessions attached';
      attachmentsBlock.appendChild(emptyMsg);
    } else {
      attachments.forEach(({ sid, session }) => {
        const pill = document.createElement('div');
        pill.className = 'distro-attachment';
        const title = session ? (session.name || `SID ${session.sid}`) : `SID ${sid}`;
        const detail = session ? session.cwd : 'Session unavailable';
        pill.innerHTML = `
          <div class="distro-attachment-main">
            <div class="distro-attachment-title">${title}</div>
            <div class="distro-attachment-meta">${detail || ''}</div>
          </div>
          <button class="distro-attachment-detach" data-sid="${sid}">Detach</button>
        `;
        pill.querySelector('.distro-attachment-detach').addEventListener('click', () => detachFromSession(item, sid));
        attachmentsBlock.appendChild(pill);
      });
    }

    card.appendChild(attachmentsBlock);
    containerEl.appendChild(card);
  });
}

function buildMenu(container) {
  const menuWrapper = document.createElement('div');
  menuWrapper.className = 'distro-menu-wrapper';
  const menu = document.createElement('div');
  menu.className = 'distro-menu';
  menuWrapper.appendChild(menu);

  const addItem = (label, handler, opts = {}) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'distro-menu-item';
    if (opts.destructive) item.classList.add('destructive');
    item.textContent = label;
    item.addEventListener('click', () => {
      closeMenus();
      handler();
    });
    menu.appendChild(item);
  };

  addItem('Mount', () => mountContainer(container));
  addItem('Unmount', () => unmountContainer(container));
  addItem('View Logs', () => showLogs(container));
  addItem('Attach to Session…', () => openAttachModal(container));
  if ((container.attachments || []).length) {
    addItem('Detach all sessions', () => detachAll(container));
  }
  return menuWrapper;
}

async function detachAll(container) {
  const attachments = Array.isArray(container.attachments) ? [...container.attachments] : [];
  if (!attachments.length) return;
  try {
    for (const sid of attachments) {
      await apiRef.post(`containers/${container.id}/detach`, { sid });
    }
    notify('Detached all sessions');
    await loadAndRender();
  } catch (err) {
    notify(err.message || 'Failed to detach sessions');
  }
}

function closeMenus() {
  document.querySelectorAll('.distro-menu').forEach((menu) => {
    menu.classList.remove('open');
  });
}

function openMenu(container, button, event) {
  event.stopPropagation();
  closeMenus();
  const menu = button.parentElement.querySelector('.distro-menu');
  if (!menu) return;
  menu.classList.add('open');
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('.distro-menu-wrapper')) {
    closeMenus();
  }
});

async function fetchContainers() {
  const data = await apiRef.get('containers');
  STATE.containers = Array.isArray(data) ? data : [];
}

async function fetchSessions() {
  try {
    const data = await window.teFetch('/api/ext/sessions_and_shortcuts/sessions');
    STATE.sessions = Array.isArray(data) ? data : [];
  } catch (err) {
    STATE.sessions = [];
  }
}

function schedulePoll() {
  if (STATE.pollTimer) clearTimeout(STATE.pollTimer);
  const hasRunning = STATE.containers.some((c) => c.state === 'running');
  const delay = hasRunning ? 5000 : 15000;
  STATE.pollTimer = setTimeout(() => loadAndRender(), delay);
}

async function loadAndRender() {
  try {
    await Promise.all([fetchContainers(), fetchSessions()]);
    renderContainers();
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
  if (!refs.importModal) return;
  resetImportForm(refs.importForm);
  refs.importModal.classList.remove('hidden');
  const firstInput = refs.importModal.querySelector('input');
  if (firstInput) firstInput.focus();
}

function closeImportModal() {
  if (!refs.importModal) return;
  refs.importModal.classList.add('hidden');
}

function openAttachModal(container) {
  currentAttachContainer = container;
  if (!refs.attachModal || !refs.attachList) return;
  refs.attachList.innerHTML = '';
  const sessions = availableSessions(container);
  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'distro-attach-empty';
    empty.textContent = 'No idle sessions available';
    refs.attachList.appendChild(empty);
  } else {
    sessions.forEach((session) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'distro-attach-item';
      const title = session.name || `SID ${session.sid}`;
      const status = session.cwd || '';
      button.innerHTML = `<span class="distro-attach-title">${title}</span><span class="distro-attach-sub">${status}</span>`;
      button.addEventListener('click', () => attachToSession(container, session.sid));
      refs.attachList.appendChild(button);
    });
  }
  refs.attachModal.classList.remove('hidden');
}

function closeAttachModal() {
  if (!refs.attachModal) return;
  refs.attachModal.classList.add('hidden');
  currentAttachContainer = null;
}

async function attachToSession(container, sid) {
  try {
    await apiRef.post(`containers/${container.id}/attach`, { sid });
    notify(`Attached to session ${sid}`);
    closeAttachModal();
    await loadAndRender();
  } catch (err) {
    notify(err.message || 'Failed to attach session');
  }
}

async function detachFromSession(container, sid) {
  try {
    await apiRef.post(`containers/${container.id}/detach`, { sid });
    notify(`Detached from session ${sid}`);
    await loadAndRender();
  } catch (err) {
    notify(err.message || 'Failed to detach session');
  }
}

async function showLogs(item) {
  if (!refs.logsModal || !refs.logsOutput || !refs.logsTitle) return;
  try {
    const logs = await apiRef.get(`containers/${item.id}/logs?tail=400`);
    refs.logsTitle.textContent = `${item.label} logs`;
    const lines = [];
    if (logs.stdout_tail?.length) lines.push('--- stdout ---', ...logs.stdout_tail);
    if (logs.stderr_tail?.length) lines.push('--- stderr ---', ...logs.stderr_tail);
    refs.logsOutput.textContent = lines.join('\n') || 'No logs available';
    refs.logsModal.classList.remove('hidden');
  } catch (err) {
    notify(err.message || 'Failed to load logs');
  }
}

export default function init(container, api, hostRef) {
  apiRef = api;
  host = hostRef;
  host.setTitle('Distro Manager');

  refs.containerEl = container.querySelector('#distro-cards');
  refs.emptyEl = container.querySelector('#distro-empty');
  refs.logsModal = document.getElementById('distro-logs-modal');
  refs.logsOutput = document.getElementById('distro-logs-output');
  refs.logsTitle = document.getElementById('distro-logs-title');
  refs.importModal = document.getElementById('distro-import-modal');
  refs.importForm = document.getElementById('distro-import-form');
  refs.attachModal = document.getElementById('distro-attach-modal');
  refs.attachList = document.getElementById('distro-attach-list');

  const refreshBtn = container.querySelector('#distro-refresh');
  const addBtn = container.querySelector('#distro-add');
  const logsClose = document.getElementById('distro-logs-close');
  const importClose = document.getElementById('distro-import-close');
  const importCancel = document.getElementById('distro-import-cancel');
  const rootfsBrowse = document.getElementById('distro-import-rootfs-browse');
  const targetBrowse = document.getElementById('distro-import-target-browse');
  const rootfsInput = document.getElementById('distro-import-rootfs');
  const chrootInput = document.getElementById('distro-import-chroot-path');
  const targetInput = document.getElementById('distro-import-target');
  const attachClose = document.getElementById('distro-attach-close');

  if (refreshBtn) refreshBtn.addEventListener('click', () => loadAndRender());
  if (addBtn) addBtn.addEventListener('click', () => {
    if (rootfsInput && IMPORT.lastRootfs) {
      rootfsInput.value = IMPORT.lastRootfs;
      if (chrootInput && !chrootInput.value) {
        chrootInput.value = inferChrootPath(IMPORT.lastRootfs);
      }
    }
    if (targetInput && IMPORT.lastTarget) {
      targetInput.value = IMPORT.lastTarget;
    }
    openImportModal();
  });

  if (logsClose) logsClose.addEventListener('click', () => refs.logsModal.classList.add('hidden'));
  if (refs.logsModal) refs.logsModal.addEventListener('click', (ev) => {
    if (ev.target === refs.logsModal) refs.logsModal.classList.add('hidden');
  });

  if (importClose) importClose.addEventListener('click', closeImportModal);
  if (importCancel) importCancel.addEventListener('click', closeImportModal);
  if (refs.importModal) refs.importModal.addEventListener('click', (ev) => {
    if (ev.target === refs.importModal) closeImportModal();
  });

  if (attachClose) attachClose.addEventListener('click', closeAttachModal);
  if (refs.attachModal) refs.attachModal.addEventListener('click', (ev) => {
    if (ev.target === refs.attachModal) closeAttachModal();
  });

  if (rootfsBrowse) {
    rootfsBrowse.addEventListener('click', async () => {
      const start = (rootfsInput && rootfsInput.value.trim()) || IMPORT.lastRootfs || '~';
      const selected = await pickDirectory(start, 'Select rootfs directory');
      if (selected && rootfsInput) {
        rootfsInput.value = selected;
        IMPORT.lastRootfs = selected;
        if (chrootInput && !chrootInput.value.trim()) {
          chrootInput.value = inferChrootPath(selected);
        }
      }
    });
  }

  if (targetBrowse) {
    targetBrowse.addEventListener('click', async () => {
      const start = (targetInput && targetInput.value.trim()) || IMPORT.lastTarget || '~';
      const selected = await pickDirectory(start, 'Select mount target');
      if (selected && targetInput) {
        targetInput.value = selected;
        IMPORT.lastTarget = selected;
      }
    });
  }

  if (rootfsInput && chrootInput) {
    rootfsInput.addEventListener('blur', () => {
      const value = rootfsInput.value.trim();
      if (value && !chrootInput.value.trim()) {
        chrootInput.value = inferChrootPath(value);
      }
    });
  }

  if (refs.importForm) refs.importForm.addEventListener('submit', handleImportSubmit);

  host.onBeforeExit(() => {
    if (STATE.pollTimer) clearTimeout(STATE.pollTimer);
    closeImportModal();
    closeAttachModal();
    if (refs.logsModal) refs.logsModal.classList.add('hidden');
  });

  loadAndRender();
}
