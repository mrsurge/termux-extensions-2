const API_WRAPPER = {
  async get(api, endpoint) {
    try {
      const payload = await api.get(endpoint);
      if (payload && payload.ok === false && payload.error) {
        throw new Error(payload.error);
      }
      return payload?.data ?? payload;
    } catch (err) {
      const message = err?.message || String(err);
      console.error(`termux-lm: GET ${endpoint} failed`, err);
      throw new Error(message);
    }
  },
  async post(api, endpoint, body) {
    try {
      const payload = await api.post(endpoint, body);
      if (payload && payload.ok === false && payload.error) {
        throw new Error(payload.error);
      }
      return payload?.data ?? payload;
    } catch (err) {
      const message = err?.message || String(err);
      console.error(`termux-lm: POST ${endpoint} failed`, err);
      throw new Error(message);
    }
  },
};

export default function initTermuxLM(root, api, host) {
  host.setTitle('Termux-LM');

  ensureStylesheet();

  const state = {
    runMode: 'chat',
    models: [],
    sessions: {},
    activeModelId: null,
    activeSessionId: null,
    shell: null,
    chatMessages: [],
    pendingModelType: 'local',
    modalMode: 'create',
    modalDraft: {},
  };

  const els = mapElements(root);
  bindEvents();
  refreshAll();

  function ensureStylesheet() {
    if (!document.querySelector('link[data-termux-lm-style]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `/apps/termux_lm/style.css`;
      link.dataset.termuxLmStyle = 'true';
      document.head.appendChild(link);
    }
  }

  function mapElements(container) {
    const resolved = {
      addModelButtons: container.querySelectorAll('[data-action="add-model"]'),
      refreshModels: container.querySelector('[data-action="refresh-models"]'),
      runModeRadios: container.querySelectorAll('input[name="run-mode"]'),
      startChatButton: container.querySelector('[data-action="start-chat"]'),
      modal: container.querySelector('[data-modal="model-form"]'),
      modalTitle: container.querySelector('[data-role="modal-title"]'),
      form: container.querySelector('[data-role="model-form"]'),
      closeButtons: container.querySelectorAll('[data-action="close-modal"]'),
      typeButtons: container.querySelectorAll('[data-model-type]'),
      localSection: container.querySelector('[data-form-section="local"]'),
      remoteSection: container.querySelector('[data-form-section="remote"]'),
      browseButtons: container.querySelectorAll('[data-action="browse-model"]'),
      cardContainer: container.querySelector('[data-role="card-container"]'),
      emptyState: container.querySelector('[data-role="empty-state"]'),
      activeModelLabel: container.querySelector('[data-role="active-model-label"]'),
      shellStdout: container.querySelector('[data-role="shell-stdout"]'),
      shellStderr: container.querySelector('[data-role="shell-stderr"]'),
    };

    if (!container.classList.contains('tlm-app')) {
      container.classList.add('tlm-app');
    }

    return resolved;
  }

  function bindEvents() {
    els.addModelButtons.forEach((btn) => {
      btn.addEventListener('click', () => openModelModal('create'));
    });

    if (els.refreshModels) {
      els.refreshModels.addEventListener('click', refreshModels);
    }

    els.closeButtons.forEach((btn) => {
      btn.addEventListener('click', closeModelModal);
    });

    if (els.form) {
      els.form.addEventListener('submit', handleModelSubmit);
    }

    els.typeButtons.forEach((btn) => {
      btn.addEventListener('click', () => selectModelType(btn.dataset.modelType));
    });

    els.browseButtons.forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.preventDefault();
        await browseModelFile(btn.closest('[data-form-section]'));
      });
    });

    els.runModeRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) state.runMode = radio.value;
      });
    });
  }

  async function refreshAll() {
    await Promise.all([
      refreshModels(),
      refreshState(),
    ]);
    renderModelCards();
    updateShellLogs();
  }

  async function refreshModels() {
    try {
      const records = await API_WRAPPER.get(api, 'models');
      state.models = Array.isArray(records) ? records : [];
      state.sessions = {};
    } catch (err) {
      host.toast?.(err.message || 'Failed to load models');
    }
  }

  async function refreshState() {
    try {
      const payload = await API_WRAPPER.get(api, 'sessions/active');
      state.activeModelId = payload?.active_model_id || null;
      state.activeSessionId = payload?.active_session_id || null;
      state.runMode = payload?.run_mode || state.runMode;
      state.shell = payload?.shell || null;
      syncRunModeRadios();
      updateActiveModelLabel();
      if (state.activeModelId && !state.sessions[state.activeModelId]) {
        state.sessions[state.activeModelId] = await fetchSessions(state.activeModelId);
      }
    } catch (err) {
      console.warn('termux-lm: failed to refresh active state', err);
    }
  }

  async function fetchSessions(modelId) {
    try {
      const list = await API_WRAPPER.get(api, `models/${modelId}/sessions`);
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.warn('termux-lm: failed to load sessions for %s', modelId, err);
      return [];
    }
  }

  function syncRunModeRadios() {
    els.runModeRadios.forEach((radio) => {
      radio.checked = radio.value === state.runMode;
    });
  }

  function updateActiveModelLabel() {
    if (!els.activeModelLabel) return;
    const model = state.models.find((item) => item.id === state.activeModelId);
    els.activeModelLabel.textContent = model ? displayNameForModel(model) : 'No model loaded';
  }

  function renderModelCards() {
    if (!els.cardContainer || !els.emptyState) return;
    els.cardContainer.innerHTML = '';
    if (!state.models.length) {
      els.emptyState.hidden = false;
      els.cardContainer.appendChild(els.emptyState);
      return;
    }
    els.emptyState.hidden = true;

    const fragment = document.createDocumentFragment();
    state.models.forEach((model) => {
      const card = document.createElement('article');
      card.className = 'tlm-model-card';
      if (model.id === state.activeModelId) {
        card.dataset.active = 'true';
      }

      const alive = Boolean(state.shell && model.id === state.activeModelId && state.shell.stats?.alive);
      const status = model.id === state.activeModelId ? (alive ? 'Running' : 'Starting…') : 'Idle';
      const statusVariant = model.id === state.activeModelId ? (alive ? 'active' : 'loading') : 'idle';
      const displayName = displayNameForModel(model);

      card.innerHTML = `
        <header class="tlm-model-header">
          <div>
            <h3 class="tlm-model-title">${escapeHTML(displayName)}</h3>
            <div class="tlm-status">
              <span class="tlm-status-dot" data-status="${statusVariant}"></span>
              <span>${status}</span>
            </div>
          </div>
          <div class="tlm-card-menu">
            <button type="button" class="tlm-btn ghost tlm-btn-icon" data-action="model-menu" title="Model options">⋮</button>
            <div class="tlm-menu" hidden>
              <button type="button" data-menu-action="load">${model.id === state.activeModelId && alive ? 'Reload Model' : 'Load Model'}</button>
              ${model.id === state.activeModelId && alive ? '<button type="button" data-menu-action="unload">Unload Model</button>' : ''}
              <button type="button" data-menu-action="session">Start Session</button>
              <button type="button" data-menu-action="edit">Edit Model</button>
              <button type="button" data-menu-action="delete" class="destructive">Delete Model</button>
            </div>
          </div>
        </header>
        <div class="tlm-model-meta">
          <span class="tlm-model-type" data-variant="${model.type}">
            ${model.type === 'local' ? 'Local llama.cpp' : 'Remote API'}
          </span>
          ${model.type === 'local' ? `<span class="tlm-model-sub">${escapeHTML(filenameFromPath(model.path))}</span>` : ''}
          ${model.type === 'remote' ? `<span class="tlm-model-sub">${escapeHTML(model.provider || 'custom')}</span>` : ''}
          ${model.id === state.activeModelId && state.shell?.stats ? renderShellStats(state.shell.stats) : ''}
        </div>
      `;

      setupMenu(card, model, displayName, alive);

      fragment.appendChild(card);
    });

    els.cardContainer.appendChild(fragment);
  }

  function openModelModal(mode, model) {
    if (!els.modal) return;
    state.modalMode = mode;
    const dialog = els.modal;
    const title = mode === 'edit' ? 'Edit Model' : 'Add Model';
    if (els.modalTitle) els.modalTitle.textContent = title;
    state.pendingModelType = model?.type || 'local';
    selectModelType(state.pendingModelType, { silent: true });

    if (model) {
      state.modalDraft = { ...model };
      populateModelForm(model);
    } else if (state.modalDraft && Object.keys(state.modalDraft).length) {
      populateModelForm(state.modalDraft);
    } else {
      populateModelForm(null);
      state.modalDraft = {};
    }

    if (typeof dialog.show === 'function') {
      dialog.show();
    } else if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    }
    dialog.hidden = false;
    dialog.removeAttribute('hidden');
    dialog.setAttribute('open', '');
  }

  function closeModelModal() {
    if (!els.modal) return;
    const dialog = els.modal;
    if (typeof dialog.close === 'function') {
      try {
        dialog.close();
      } catch (err) {
        dialog.open = false;
      }
    }
    dialog.hidden = true;
    dialog.removeAttribute('open');
  }

  function selectModelType(type, { silent } = {}) {
    state.pendingModelType = type === 'remote' ? 'remote' : 'local';
    els.typeButtons.forEach((btn) => {
      btn.dataset.active = btn.dataset.modelType === state.pendingModelType ? 'true' : 'false';
    });
    if (els.localSection) els.localSection.hidden = state.pendingModelType !== 'local';
    if (els.remoteSection) els.remoteSection.hidden = state.pendingModelType !== 'remote';
    if (!silent) {
      const label = state.pendingModelType === 'local' ? 'Local llama.cpp' : 'Remote API';
      host.toast?.(`Configuring ${label}`);
    }
  }

  async function browseModelFile(sectionEl) {
    if (!sectionEl) return;
    const pathInput = sectionEl.querySelector('input[name="path"]');
    if (!pathInput) return;

    if (els.form) {
      const formData = new FormData(els.form);
      state.modalDraft = Object.fromEntries(formData.entries());
    }

    let reopen = false;
    if (els.modal && els.modal.open) {
      try {
        els.modal.close();
      } catch (_) {
        els.modal.open = false;
      }
      reopen = true;
    }

    if (!window.teFilePicker) {
      host.toast?.('File picker unavailable');
      if (reopen) openModelModal(state.modalMode, state.modalDraft);
      return;
    }

    try {
      const choice = await window.teFilePicker.openFile?.({
        title: 'Select GGUF Model',
        startPath: pathInput.value || '~/models',
      });
      if (choice && choice.path) {
        pathInput.value = choice.path;
        pathInput.dispatchEvent(new Event('change', { bubbles: true }));
        state.modalDraft = { ...state.modalDraft, path: choice.path };
      }
    } catch (err) {
      console.debug('termux-lm: file picker closed', err);
    } finally {
      if (reopen) openModelModal(state.modalMode, state.modalDraft);
    }
  }

  function populateModelForm(model) {
    if (!els.form) return;
    const form = els.form;
    form.reset();
    const values = model || {};
    Object.entries(values).forEach(([key, value]) => {
      const field = form.elements.namedItem(key);
      if (!field) return;
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        field.value = value ?? '';
      }
    });
  }

  async function handleModelSubmit(event) {
    event.preventDefault();
    if (!els.form) return;

    const formData = new FormData(els.form);
    const payload = Object.fromEntries(formData.entries());
    payload.type = state.pendingModelType;

    try {
      const created = await API_WRAPPER.post(api, 'models', payload);
      state.models.unshift(created);
      host.toast?.('Model saved');
      closeModelModal();
      renderModelCards();
      updateActiveModelLabel();
      updateShellLogs();
    } catch (err) {
      host.toast?.(err.message || 'Failed to save model');
    }
  }
  function updateShellLogs() {
    if (!state.shell) {
      if (els.shellStdout) els.shellStdout.textContent = '';
      if (els.shellStderr) els.shellStderr.textContent = '';
      return;
    }
    const logs = state.shell.logs || {};
    if (els.shellStdout) els.shellStdout.textContent = (logs.stdout_tail || []).join('\n');
    if (els.shellStderr) els.shellStderr.textContent = (logs.stderr_tail || []).join('\n');
  }

  function displayNameForModel(model) {
    return model?.name || model?.display_name || model?.id || 'model';
  }

  function filenameFromPath(path) {
    if (!path) return '';
    return String(path).split('/').filter(Boolean).pop() || path;
  }

  function renderShellStats(stats) {
    const cpu = typeof stats.cpu === 'number' ? `${stats.cpu.toFixed(1)}% CPU` : null;
    const rssMb = typeof stats.rss_mb === 'number' ? `${stats.rss_mb.toFixed(1)} MB RSS` : null;
    if (!cpu && !rssMb) return '';
    const parts = [cpu, rssMb].filter(Boolean).map((part) => `<span class="tlm-stat">${part}</span>`);
    return `<div class="tlm-shell-stats">${parts.join('<span class="tlm-divider">·</span>')}</div>`;
  }

  function setupMenu(card, model, displayName, alive) {
    const trigger = card.querySelector('[data-action="model-menu"]');
    const menu = card.querySelector('.tlm-menu');
    if (!trigger || !menu) return;

    function closeMenu() {
      menu.hidden = true;
      document.removeEventListener('click', onOutsideClick, true);
    }

    function onOutsideClick(event) {
      if (!menu.contains(event.target) && event.target !== trigger) {
        closeMenu();
      }
    }

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      if (!menu.hidden) {
        document.addEventListener('click', onOutsideClick, true);
      } else {
        document.removeEventListener('click', onOutsideClick, true);
      }
    });

    menu.querySelectorAll('button[data-menu-action]').forEach((item) => {
      item.addEventListener('click', async (event) => {
        event.stopPropagation();
        menu.hidden = true;
        document.removeEventListener('click', onOutsideClick, true);
        const action = item.dataset.menuAction;
        if (action === 'load') {
          await loadModel(model.id);
        } else if (action === 'unload') {
          await unloadModel(model.id);
        } else if (action === 'edit') {
          openModelModal('edit', model);
        } else if (action === 'delete') {
          await deleteModel(model.id, displayName);
        } else if (action === 'session') {
          await startSession(model);
        }
      });
    });
  }

  async function loadModel(modelId) {
    try {
      await API_WRAPPER.post(api, `models/${encodeURIComponent(modelId)}/load`, {});
      host.toast?.('Model loading…');
      await refreshState();
      await refreshModels();
      renderModelCards();
      updateShellLogs();
    } catch (err) {
      host.toast?.(err.message || 'Failed to load model');
    }
  }

  async function unloadModel(modelId) {
    try {
      await API_WRAPPER.post(api, `models/${encodeURIComponent(modelId)}/unload`, {});
      host.toast?.('Model unloaded');
      await refreshState();
      renderModelCards();
      updateShellLogs();
    } catch (err) {
      host.toast?.(err.message || 'Failed to unload model');
    }
  }

  async function deleteModel(modelId, name) {
    const ok = confirm(`Delete model "${name}"?`);
    if (!ok) return;
    try {
      await api.delete(`models/${encodeURIComponent(modelId)}`);
      state.models = state.models.filter((item) => item.id !== modelId);
      if (state.activeModelId === modelId) {
        state.activeModelId = null;
        state.activeSessionId = null;
      }
      renderModelCards();
      updateActiveModelLabel();
      updateShellLogs();
      host.toast?.('Model deleted');
    } catch (err) {
      host.toast?.(err?.message || 'Failed to delete model');
    }
  }

  async function startSession(model) {
    try {
      if (state.activeModelId !== model.id) {
        await loadModel(model.id);
      }
      const body = { run_mode: state.runMode };
      const session = await API_WRAPPER.post(api, `models/${encodeURIComponent(model.id)}/sessions`, body);
      state.activeModelId = model.id;
      state.activeSessionId = session?.id || null;
      state.sessions[model.id] = state.sessions[model.id] ? [session, ...state.sessions[model.id]] : [session];
      host.toast?.('Session created');
      // TODO: open chat view when implemented
    } catch (err) {
      host.toast?.(err.message || 'Failed to start session');
    }
  }
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
