export function initPyrightModals(ctx) {
  const {
    host,
    updatePreference,
    refreshModal,
    toAbsolute,
    HOME_DIR,
    getCachedProjectRoot,
    parentDir,
    pickFile,
    pickDirectory,
    openFile,
    apiPost,
    getClientId,
    closeAllMenus,
  } = ctx;

  const pyrightWorkersModal = {
    root: document.getElementById('pyright-workers-modal'),
    closeBtn: document.getElementById('pyright-workers-close'),
    list: document.getElementById('pyright-workers-list'),
    empty: document.getElementById('pyright-workers-empty'),
    addBtn: document.getElementById('pyright-workers-add'),
    generateBtn: document.getElementById('pyright-workers-generate'),
    saveBtn: document.getElementById('pyright-workers-save'),
  };

  const pyrightWorkersState = {
    projectRootAbs: '',
  };

  const pyrightConfigModal = {
    root: document.getElementById('pyright-config-modal'),
    closeBtn: document.getElementById('pyright-config-close'),
    note: document.getElementById('pyright-config-note'),
    pathInput: document.getElementById('pyright-config-path'),
    typeBtn: document.getElementById('pyright-config-type-btn'),
    typeLabel: document.getElementById('pyright-config-type-label'),
    typeDD: document.getElementById('pyright-config-type-dd'),
    versionInput: document.getElementById('pyright-config-version'),
    platformInput: document.getElementById('pyright-config-platform'),
    includeInput: document.getElementById('pyright-config-include'),
    excludeInput: document.getElementById('pyright-config-exclude'),
    ignoreInput: document.getElementById('pyright-config-ignore'),
    venvPathInput: document.getElementById('pyright-config-venvpath'),
    venvInput: document.getElementById('pyright-config-venv'),
    openJsonBtn: document.getElementById('pyright-config-open-json'),
    saveBtn: document.getElementById('pyright-config-save'),
  };

  const pyrightConfigState = {
    workerRow: null,
    projectRootAbs: '',
    rootAbs: '',
    rootRel: '',
    configAbs: '',
    configRel: '',
    baseConfig: {},
    configKind: 'json',
  };

  function _getPyrightConfigMode(state) {
    const raw = String(state?.lspPyrightConfigMode || 'root').trim().toLowerCase();
    return raw === 'workers' ? 'workers' : 'root';
  }

  async function _setPyrightMode(nextMode) {
    const mode = String(nextMode || '').toLowerCase() === 'workers' ? 'workers' : 'root';
    const ok = await updatePreference('lspPyrightConfigMode', mode);
    if (!ok) {
      host.toast('Failed to update Pyright config mode');
      return;
    }
    refreshModal();
  }

  async function _fetchPyrightWorkers() {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/editor/pyright/workers', { cache: 'no-store' });
      const json = await resp.json();
      if (!json || json.ok === false) {
        host.toast(json?.error || 'Failed to load Pyright workers');
        return null;
      }
      return json.data || null;
    } catch (e) {
      host.toast(e?.message || 'Failed to load Pyright workers');
      return null;
    }
  }

  function _clearPyrightWorkersList() {
    if (pyrightWorkersModal.list) pyrightWorkersModal.list.innerHTML = '';
  }

  function _setPyrightWorkersEmpty(show) {
    if (pyrightWorkersModal.empty) pyrightWorkersModal.empty.style.display = show ? 'block' : 'none';
  }

  function _relToBase(targetAbs, baseAbs) {
    const base = String(baseAbs || '').replace(/\/+$/, '');
    const target = String(targetAbs || '').replace(/\/+$/, '');
    if (!base || !target) return target;
    if (target === base) return '';
    if (target.startsWith(base + '/')) return target.slice(base.length + 1);
    return target;
  }

  function _deriveWorkerId(rootRel) {
    const cleaned = String(rootRel || '')
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/[^a-zA-Z0-9._/-]+/g, '-')
      .replace(/\//g, '-')
      .replace(/^-+|-+$/g, '');
    return cleaned || 'root';
  }

  function _addPyrightWorkerRow(worker = {}) {
    if (!pyrightWorkersModal.list) return;
    const row = document.createElement('div');
    row.className = 'pyright-worker-row';

    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.className = 'pyright-worker-input pyright-worker-id';
    idInput.placeholder = 'id';
    idInput.value = worker.id || '';

    const rootInput = document.createElement('input');
    rootInput.type = 'text';
    rootInput.className = 'pyright-worker-input pyright-worker-root';
    rootInput.placeholder = 'root (relative to project)';
    rootInput.value = worker.root || '';

    const projectInput = document.createElement('input');
    projectInput.type = 'text';
    projectInput.className = 'pyright-worker-input pyright-worker-project';
    projectInput.placeholder = 'pyrightconfig.json or pyproject.toml';
    projectInput.value = worker.pyright_project || worker.pyrightProject || '';

    rootInput.addEventListener('blur', () => {
      if (!idInput.value) {
        idInput.value = _deriveWorkerId(rootInput.value || '');
      }
    });

    const actions = document.createElement('div');
    actions.className = 'pyright-worker-actions';

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'pyright-worker-enabled';
    const enabledInput = document.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.checked = worker.enabled !== false;
    enabledLabel.appendChild(enabledInput);
    enabledLabel.appendChild(document.createTextNode('enabled'));

    const pickConfigBtn = document.createElement('button');
    pickConfigBtn.type = 'button';
    pickConfigBtn.className = 'fe-btn fe-btn-secondary';
    pickConfigBtn.textContent = 'Pick config';
    pickConfigBtn.addEventListener('click', async () => {
      const projectRootAbs = pyrightWorkersState.projectRootAbs || (getCachedProjectRoot() ? toAbsolute(getCachedProjectRoot(), null, HOME_DIR) : '');
      const abs = await pickFile(projectRootAbs);
      if (!abs) return;
      if (!projectRootAbs || (!abs.startsWith(projectRootAbs + '/') && abs !== projectRootAbs)) {
        host.toast('Config file must be inside the project');
        return;
      }
      const rootAbs = parentDir(abs);
      let rootRel = _relToBase(rootAbs, projectRootAbs);
      if (!rootRel) rootRel = '.';
      rootInput.value = rootRel;
      projectInput.value = _relToBase(abs, rootAbs) || projectInput.value;
      if (!idInput.value) idInput.value = _deriveWorkerId(rootRel);
    });

    const pickRootBtn = document.createElement('button');
    pickRootBtn.type = 'button';
    pickRootBtn.className = 'fe-btn fe-btn-secondary';
    pickRootBtn.textContent = 'Pick root';
    pickRootBtn.addEventListener('click', async () => {
      const projectRootAbs = pyrightWorkersState.projectRootAbs || (getCachedProjectRoot() ? toAbsolute(getCachedProjectRoot(), null, HOME_DIR) : '');
      const abs = await pickDirectory(projectRootAbs);
      if (!abs) return;
      if (!projectRootAbs || (!abs.startsWith(projectRootAbs + '/') && abs !== projectRootAbs)) {
        host.toast('Root must be inside the project');
        return;
      }
      let rootRel = _relToBase(abs, projectRootAbs);
      if (!rootRel) rootRel = '.';
      rootInput.value = rootRel;
      if (!idInput.value) idInput.value = _deriveWorkerId(rootRel);
    });

    const configureBtn = document.createElement('button');
    configureBtn.type = 'button';
    configureBtn.className = 'fe-btn fe-btn-secondary';
    configureBtn.textContent = 'Configure';
    configureBtn.addEventListener('click', () => {
      showPyrightConfigModalForRow(row);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'fe-btn fe-btn-danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      row.remove();
      const hasRows = pyrightWorkersModal.list && pyrightWorkersModal.list.querySelector('.pyright-worker-row');
      _setPyrightWorkersEmpty(!hasRows);
    });

    actions.appendChild(enabledLabel);
    actions.appendChild(pickConfigBtn);
    actions.appendChild(pickRootBtn);
    actions.appendChild(configureBtn);
    actions.appendChild(removeBtn);

    row.appendChild(idInput);
    row.appendChild(rootInput);
    row.appendChild(projectInput);
    row.appendChild(actions);

    pyrightWorkersModal.list.appendChild(row);
  }

  function _collectPyrightWorkersFromUI() {
    const workers = [];
    if (!pyrightWorkersModal.list) return workers;
    const rows = Array.from(pyrightWorkersModal.list.querySelectorAll('.pyright-worker-row'));
    for (const row of rows) {
      const id = row.querySelector('.pyright-worker-id')?.value?.trim() || '';
      const root = row.querySelector('.pyright-worker-root')?.value?.trim() || '';
      const project = row.querySelector('.pyright-worker-project')?.value?.trim() || '';
      const enabled = Boolean(row.querySelector('.pyright-worker-enabled input')?.checked);
      if (!root) continue;
      workers.push({
        id: id || _deriveWorkerId(root),
        root,
        pyright_project: project,
        enabled,
      });
    }
    return workers;
  }

  async function showPyrightWorkersModal() {
    if (!pyrightWorkersModal.root) return;
    const payload = await _fetchPyrightWorkers();
    if (!payload) return;
    pyrightWorkersState.projectRootAbs = payload.projectRoot
      ? toAbsolute(payload.projectRoot, null, HOME_DIR).replace(/\/+$/, '')
      : '';

    _clearPyrightWorkersList();
    const workers = Array.isArray(payload.workers) ? payload.workers : [];
    if (workers.length === 0) {
      _setPyrightWorkersEmpty(true);
    } else {
      _setPyrightWorkersEmpty(false);
      for (const worker of workers) _addPyrightWorkerRow(worker);
    }

    pyrightWorkersModal.root.classList.add('show');
    pyrightWorkersModal.root.setAttribute('aria-hidden', 'false');
  }

  function hidePyrightWorkersModal() {
    if (!pyrightWorkersModal.root) return;
    pyrightWorkersModal.root.classList.remove('show');
    pyrightWorkersModal.root.setAttribute('aria-hidden', 'true');
  }

  async function _generatePyrightWorkers() {
    if (!pyrightWorkersModal.generateBtn) return;
    pyrightWorkersModal.generateBtn.disabled = true;
    try {
      const resp = await fetch('/api/app/file_editor_cm6/editor/pyright/workers/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await resp.json();
      if (!json || json.ok === false) {
        host.toast(json?.error || 'Scan failed');
        return;
      }
      const payload = json.data || {};
      const workers = Array.isArray(payload.workers) ? payload.workers : [];
      _clearPyrightWorkersList();
      if (workers.length === 0) {
        _setPyrightWorkersEmpty(true);
      } else {
        _setPyrightWorkersEmpty(false);
        for (const worker of workers) _addPyrightWorkerRow(worker);
      }
      if (payload.saved) host.toast('Generated registry saved');
    } catch (e) {
      host.toast(e?.message || 'Scan failed');
    } finally {
      pyrightWorkersModal.generateBtn.disabled = false;
    }
  }

  async function _savePyrightWorkers() {
    if (!pyrightWorkersModal.saveBtn) return;
    pyrightWorkersModal.saveBtn.disabled = true;
    try {
      const resp = await fetch('/api/app/file_editor_cm6/editor/pyright/workers/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workers: _collectPyrightWorkersFromUI() }),
      });
      const json = await resp.json();
      if (!json || json.ok === false) {
        host.toast(json?.error || 'Save failed');
        return;
      }
      const errors = json.data?.errors || [];
      if (errors.length) host.toast(`Saved with ${errors.length} issue(s)`);
      else host.toast('Pyright workers saved');
    } catch (e) {
      host.toast(e?.message || 'Save failed');
    } finally {
      pyrightWorkersModal.saveBtn.disabled = false;
    }
  }

  function _splitLines(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function _joinLines(items) {
    if (!Array.isArray(items)) return '';
    return items.filter(Boolean).join('\n');
  }

  function _setConfigField(el, value) {
    if (el) el.value = value || '';
  }

  function _setOrDelete(obj, key, value) {
    if (Array.isArray(value)) {
      if (!value.length) delete obj[key];
      else obj[key] = value;
      return;
    }
    if (value == null || value === '') {
      delete obj[key];
      return;
    }
    obj[key] = value;
  }

  function _getPyrightTypeMode() {
    const raw = pyrightConfigModal.typeBtn?.dataset?.value || '';
    return String(raw || '').trim();
  }

  function _setPyrightTypeMode(value) {
    const mode = String(value || '').trim();
    if (pyrightConfigModal.typeBtn) {
      pyrightConfigModal.typeBtn.dataset.value = mode;
    }
    if (pyrightConfigModal.typeLabel) {
      pyrightConfigModal.typeLabel.textContent = mode || '(default)';
    }
    if (pyrightConfigModal.typeDD) {
      pyrightConfigModal.typeDD.querySelectorAll('.fe-dd-item').forEach((item) => {
        const isActive = item.dataset.value === mode;
        item.classList.toggle('fe-menu-item-checked', isActive);
      });
    }
  }

  function _populatePyrightTypeDropdown() {
    if (!pyrightConfigModal.typeDD) return;
    const dd = pyrightConfigModal.typeDD;
    dd.innerHTML = '';
    const options = [
      { label: '(default)', value: '' },
      { label: 'off', value: 'off' },
      { label: 'basic', value: 'basic' },
      { label: 'standard', value: 'standard' },
      { label: 'strict', value: 'strict' },
    ];
    for (const opt of options) {
      const item = document.createElement('div');
      item.className = 'fe-dd-item';
      item.setAttribute('data-checkable', 'true');
      item.dataset.value = opt.value;
      item.textContent = opt.label;
      const isActive = _getPyrightTypeMode() === opt.value;
      item.classList.toggle('fe-menu-item-checked', isActive);
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        dd.classList.remove('show');
        _setPyrightTypeMode(opt.value);
      });
      dd.appendChild(item);
    }
  }

  function _resolveWorkerRootAbs(rootRel) {
    const base = pyrightConfigState.projectRootAbs || pyrightWorkersState.projectRootAbs || getCachedProjectRoot() || HOME_DIR;
    return toAbsolute(rootRel || '.', base, HOME_DIR).replace(/\/+$/, '');
  }

  function _resolveWorkerConfigPath(rootAbs, projectValue) {
    const projectText = String(projectValue || '').trim();
    if (projectText) {
      if (projectText.startsWith('/')) return projectText;
      return `${rootAbs.replace(/\/+$/, '')}/${projectText.replace(/^\.\/+/, '')}`;
    }
    return `${rootAbs.replace(/\/+$/, '')}/pyrightconfig.json`;
  }

  async function _readFileAbs(pathAbs) {
    try {
      const resp = await fetch(`/api/app/file_editor_cm6/read?path=${encodeURIComponent(pathAbs)}`, { cache: 'no-store' });
      if (!resp.ok) return null;
      const json = await resp.json();
      if (json && json.ok && json.data && typeof json.data.content === 'string') {
        return json.data.content;
      }
    } catch (_) { }
    return null;
  }

  async function _writeFileAbs(pathAbs, content) {
    return await apiPost('write', {
      path: pathAbs,
      content: content ?? '',
      client_id: getClientId(),
    });
  }

  async function _fetchPyrightConfig(pathAbs) {
    try {
      const resp = await fetch(`/api/app/file_editor_cm6/editor/pyright/config?path=${encodeURIComponent(pathAbs)}`, { cache: 'no-store' });
      const json = await resp.json();
      if (json && json.ok) return json.data || null;
      return null;
    } catch (_) {
      return null;
    }
  }

  async function _savePyrightConfigServer(pathAbs, config) {
    try {
      const resp = await fetch('/api/app/file_editor_cm6/editor/pyright/config/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathAbs, config: config || {} }),
      });
      const json = await resp.json();
      if (json && json.ok) return json.data || null;
    } catch (_) { }
    return null;
  }

  function _setConfigFieldsEnabled(enabled) {
    const fields = [
      pyrightConfigModal.typeBtn,
      pyrightConfigModal.versionInput,
      pyrightConfigModal.platformInput,
      pyrightConfigModal.includeInput,
      pyrightConfigModal.excludeInput,
      pyrightConfigModal.ignoreInput,
      pyrightConfigModal.venvPathInput,
      pyrightConfigModal.venvInput,
      pyrightConfigModal.saveBtn,
    ];
    for (const field of fields) {
      if (field) field.disabled = !enabled;
    }
  }

  function _populateConfigForm(cfg) {
    _setPyrightTypeMode(cfg.typeCheckingMode || '');
    _setConfigField(pyrightConfigModal.versionInput, cfg.pythonVersion || '');
    _setConfigField(pyrightConfigModal.platformInput, cfg.pythonPlatform || '');
    _setConfigField(pyrightConfigModal.includeInput, _joinLines(cfg.include));
    _setConfigField(pyrightConfigModal.excludeInput, _joinLines(cfg.exclude));
    _setConfigField(pyrightConfigModal.ignoreInput, _joinLines(cfg.ignore));
    _setConfigField(pyrightConfigModal.venvPathInput, cfg.venvPath || '');
    _setConfigField(pyrightConfigModal.venvInput, cfg.venv || '');
  }

  function _collectConfigForm() {
    return {
      typeCheckingMode: _getPyrightTypeMode(),
      pythonVersion: pyrightConfigModal.versionInput?.value || '',
      pythonPlatform: pyrightConfigModal.platformInput?.value || '',
      include: _splitLines(pyrightConfigModal.includeInput?.value || ''),
      exclude: _splitLines(pyrightConfigModal.excludeInput?.value || ''),
      ignore: _splitLines(pyrightConfigModal.ignoreInput?.value || ''),
      venvPath: pyrightConfigModal.venvPathInput?.value || '',
      venv: pyrightConfigModal.venvInput?.value || '',
    };
  }

  async function showPyrightConfigModalForRow(row) {
    if (!pyrightConfigModal.root || !row) return;

    const rootRel = row.querySelector('.pyright-worker-root')?.value?.trim() || '';
    if (!rootRel) {
      host.toast('Set a worker root first');
      return;
    }

    const projectVal = row.querySelector('.pyright-worker-project')?.value?.trim() || '';
    const projectRootAbs = pyrightWorkersState.projectRootAbs || (getCachedProjectRoot() ? toAbsolute(getCachedProjectRoot(), null, HOME_DIR) : '');
    const rootAbs = _resolveWorkerRootAbs(rootRel);
    const configAbs = _resolveWorkerConfigPath(rootAbs, projectVal);
    const configRel = projectRootAbs ? _relToBase(configAbs, projectRootAbs) : configAbs;

    pyrightConfigState.workerRow = row;
    pyrightConfigState.projectRootAbs = projectRootAbs;
    pyrightConfigState.rootAbs = rootAbs;
    pyrightConfigState.rootRel = rootRel;
    pyrightConfigState.configAbs = configAbs;
    pyrightConfigState.configRel = configRel;
    pyrightConfigState.baseConfig = {};
    pyrightConfigState.configKind = configAbs.endsWith('.toml') ? 'toml' : 'json';

    if (pyrightConfigModal.pathInput) {
      pyrightConfigModal.pathInput.value = configRel || configAbs;
    }

    if (pyrightConfigModal.note) {
      pyrightConfigModal.note.textContent = pyrightConfigState.configKind === 'toml'
        ? 'Editing [tool.pyright] inside pyproject.toml. For advanced changes, open the config file.'
        : 'Edit common Pyright settings. For advanced changes, open the config file.';
    }
    _setConfigFieldsEnabled(true);
    const payload = await _fetchPyrightConfig(configAbs);
    if (payload && payload.config && typeof payload.config === 'object') {
      pyrightConfigState.baseConfig = payload.config;
    } else {
      pyrightConfigState.baseConfig = {};
    }
    _populateConfigForm(pyrightConfigState.baseConfig || {});

    pyrightConfigModal.root.classList.add('show');
    pyrightConfigModal.root.setAttribute('aria-hidden', 'false');
  }

  function hidePyrightConfigModal() {
    if (!pyrightConfigModal.root) return;
    pyrightConfigModal.root.classList.remove('show');
    pyrightConfigModal.root.setAttribute('aria-hidden', 'true');
  }

  async function _openPyrightConfigJson() {
    const abs = pyrightConfigState.configAbs;
    if (!abs) return;
    const existing = await _readFileAbs(abs);
    if (!existing) {
      await _savePyrightConfigServer(abs, pyrightConfigState.baseConfig || {});
    }
    await openFile(abs);
  }

  async function _savePyrightConfig() {
    if (!pyrightConfigState.configAbs) return;

    const cfg = { ...(pyrightConfigState.baseConfig || {}) };
    const form = _collectConfigForm();

    _setOrDelete(cfg, 'typeCheckingMode', form.typeCheckingMode || '');
    _setOrDelete(cfg, 'pythonVersion', form.pythonVersion || '');
    _setOrDelete(cfg, 'pythonPlatform', form.pythonPlatform || '');
    _setOrDelete(cfg, 'include', form.include);
    _setOrDelete(cfg, 'exclude', form.exclude);
    _setOrDelete(cfg, 'ignore', form.ignore);
    _setOrDelete(cfg, 'venvPath', form.venvPath || '');
    _setOrDelete(cfg, 'venv', form.venv || '');

    const result = await _savePyrightConfigServer(pyrightConfigState.configAbs, cfg);
    if (!result) {
      host.toast('Failed to save config');
      return;
    }
    pyrightConfigState.baseConfig = result.config || cfg;

    if (pyrightConfigState.workerRow) {
      const projectInput = pyrightConfigState.workerRow.querySelector('.pyright-worker-project');
      if (projectInput && !projectInput.value.trim()) {
        const rel = _relToBase(pyrightConfigState.configAbs, pyrightConfigState.rootAbs);
        projectInput.value = rel || 'pyrightconfig.json';
      }
    }

    host.toast('Pyright config saved');
  }

  function applyModeUI({ mode, isEnabled, workersBtn }) {
    if (workersBtn) {
      workersBtn.disabled = !isEnabled || mode !== 'workers';
    }
  }

  function applyModeRadios({ mode, isEnabled, radioRoot, radioWorkers }) {
    if (radioRoot) radioRoot.checked = mode === 'root';
    if (radioWorkers) radioWorkers.checked = mode === 'workers';
    if (radioRoot) radioRoot.disabled = !isEnabled;
    if (radioWorkers) radioWorkers.disabled = !isEnabled;
  }

  function closeMenus() {
    if (pyrightConfigModal.typeDD) pyrightConfigModal.typeDD.classList.remove('show');
  }

  function bindControls(lspModal) {
    if (lspModal.pyrightModeRoot) {
      lspModal.pyrightModeRoot.addEventListener('change', (e) => {
        if (e?.target?.checked) _setPyrightMode('root');
      });
    }
    if (lspModal.pyrightModeWorkers) {
      lspModal.pyrightModeWorkers.addEventListener('change', (e) => {
        if (e?.target?.checked) _setPyrightMode('workers');
      });
    }
    if (lspModal.pyrightWorkersBtn) {
      lspModal.pyrightWorkersBtn.addEventListener('click', showPyrightWorkersModal);
    }
    if (lspModal.scanPyright) {
      lspModal.scanPyright.addEventListener('click', async () => {
        const btn = lspModal.scanPyright;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '⏳ Scanning...';
        try {
          const resp = await fetch('/api/app/file_editor_cm6/editor/pyright/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const json = await resp.json();
          if (json && json.ok) {
            host.toast('Pyright scan started');
          } else {
            host.toast('Pyright scan failed: ' + (json?.error || 'unknown error'));
          }
        } catch (e) {
          host.toast('Pyright scan failed: ' + (e?.message || e));
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      });
    }

    if (pyrightWorkersModal.closeBtn) pyrightWorkersModal.closeBtn.addEventListener('click', hidePyrightWorkersModal);
    if (pyrightWorkersModal.root) {
      pyrightWorkersModal.root.addEventListener('click', (evt) => {
        if (evt.target === pyrightWorkersModal.root) hidePyrightWorkersModal();
      });
    }
    if (pyrightWorkersModal.addBtn) {
      pyrightWorkersModal.addBtn.addEventListener('click', () => {
        _addPyrightWorkerRow({});
        _setPyrightWorkersEmpty(false);
      });
    }
    if (pyrightWorkersModal.generateBtn) {
      pyrightWorkersModal.generateBtn.addEventListener('click', _generatePyrightWorkers);
    }
    if (pyrightWorkersModal.saveBtn) {
      pyrightWorkersModal.saveBtn.addEventListener('click', _savePyrightWorkers);
    }

    if (pyrightConfigModal.closeBtn) pyrightConfigModal.closeBtn.addEventListener('click', hidePyrightConfigModal);
    if (pyrightConfigModal.root) {
      pyrightConfigModal.root.addEventListener('click', (evt) => {
        if (evt.target === pyrightConfigModal.root) hidePyrightConfigModal();
      });
    }
    if (pyrightConfigModal.openJsonBtn) pyrightConfigModal.openJsonBtn.addEventListener('click', _openPyrightConfigJson);
    if (pyrightConfigModal.saveBtn) pyrightConfigModal.saveBtn.addEventListener('click', _savePyrightConfig);
    if (pyrightConfigModal.typeBtn && pyrightConfigModal.typeDD) {
      pyrightConfigModal.typeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = pyrightConfigModal.typeDD;
        const wasOpen = dd.classList.contains('show');
        closeAllMenus();
        if (!wasOpen) dd.classList.add('show');
      });
    }

    _populatePyrightTypeDropdown();
  }

  return {
    getModeFromState: _getPyrightConfigMode,
    applyModeUI,
    applyModeRadios,
    bindControls,
    closeMenus,
  };
}
