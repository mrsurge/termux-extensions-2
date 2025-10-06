const API = {
  async get(api, endpoint) {
    const payload = await api.get(endpoint);
    if (payload && payload.ok === false) {
      throw new Error(payload.error || 'Request failed');
    }
    return payload?.data ?? payload;
  },
  async post(api, endpoint, body) {
    const payload = await api.post(endpoint, body);
    if (payload && payload.ok === false) {
      throw new Error(payload.error || 'Request failed');
    }
    return payload?.data ?? payload;
  },
  async del(api, endpoint) {
    const payload = await api.delete(endpoint);
    if (payload && payload.ok === false) {
      throw new Error(payload.error || 'Request failed');
    }
    return payload?.data ?? payload;
  },
};

export default function initTermuxLM(root, api, host) {
  host.setTitle('Termux-LM');
  injectStylesheet();

  const apiBase = `/api/app/${host?.id || 'termux_lm'}/`;

  const state = {
    models: [],
    sessions: {},
    activeModelId: null,
    activeSessionId: null,
    runMode: 'chat',
    shell: null,
    chatMessages: [],
    streaming: false,
    streamController: null,
    pendingModelType: 'local',
    modalMode: 'create',
    modalDraft: {},
    drawerOpen: false,
    activeMenu: null,
    remoteReady: false,
    remoteReadiness: {},
  };

  const els = mapElements(root);
  const cleanup = [];
  // Disable Open Interpreter Chat until server detected
  if (els.openInterpreterButton) {
    els.openInterpreterButton.disabled = true;
  }
  startAutoRefresh();

  bindEvents();
  refreshAll();

  function injectStylesheet() {
    if (!document.querySelector('link[data-termux-lm-style]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/apps/termux_lm/style.css';
      link.dataset.termuxLmStyle = 'true';
      document.head.appendChild(link);
    }
  }

  function mapElements(container) {
    const resolved = {
      addModelButtons: container.querySelectorAll('[data-action="add-model"]'),
      refreshButton: container.querySelector('[data-action="refresh-models"]'),
      runModeRadios: container.querySelectorAll('input[name="run-mode"]'),
      startChatButton: container.querySelector('[data-action="start-chat"]'),
      startInterpreterButton: container.querySelector('[data-action="start-interpreter"]'),
      openInterpreterButton: container.querySelector('[data-action="open-interpreter"]'),
      oiStatus: container.querySelector('[data-role="oi-status"]'),
      shellStdout: container.querySelector('[data-role="shell-stdout"]'),
      shellStderr: container.querySelector('[data-role="shell-stderr"]'),
      activeModelLabel: container.querySelector('[data-role="active-model-label"]'),
      cardContainer: container.querySelector('[data-role="card-container"]'),
      emptyState: container.querySelector('[data-role="empty-state"]'),
      modal: container.querySelector('[data-modal="model-form"]'),
      modalTitle: container.querySelector('[data-role="modal-title"]'),
      modalForm: container.querySelector('[data-role="model-form"]'),
      closeModalButtons: container.querySelectorAll('[data-action="close-modal"]'),
      typeButtons: container.querySelectorAll('[data-model-type]'),
      localSection: container.querySelector('[data-form-section="local"]'),
      remoteSection: container.querySelector('[data-form-section="remote"]'),
      browseButtons: container.querySelectorAll('[data-action="browse-model"]'),
      chatOverlay: container.querySelector('[data-shell]'),
      chatPanel: container.querySelector('[data-shell-panel]'),
      chatDrawer: container.querySelector('[data-shell-drawer]'),
      chatSessions: container.querySelector('[data-shell-sessions]'),
      chatLog: container.querySelector('[data-role="chat-log"]'),
      chatEmpty: container.querySelector('[data-role="chat-empty"]'),
      chatForm: container.querySelector('[data-role="chat-form"]'),
      chatInput: container.querySelector('[data-role="chat-input"]'),
      chatSend: container.querySelector('[data-role="chat-send"]'),
      chatBack: container.querySelector('[data-action="chat-back"]'),
      drawerToggle: container.querySelector('[data-action="toggle-drawer"]'),
      drawerClose: container.querySelector('[data-action="close-drawer"]'),
      newSessionButton: container.querySelector('[data-action="new-session"]'),
      overlayBg: container.querySelector('[data-shell-overlay]'),
      tokenReadout: container.querySelector('[data-role="token-readout"]'),
      // OI Console (overlay)
      oiOverlay: container.querySelector('[data-oi]'),
      oiOverlayBg: container.querySelector('[data-oi-overlay]'),
      oiLog: container.querySelector('[data-role="oi-log"]'),
      oiForm: container.querySelector('[data-role="oi-form"]'),
      oiInput: container.querySelector('[data-role="oi-input"]'),
      oiSend: container.querySelector('[data-role="oi-send"]'),
      oiApprove: container.querySelector('[data-action="oi-approve"]'),
      oiAuth: container.querySelector('[data-action="oi-auth"]'),
      oiBack: container.querySelector('[data-action="oi-back"]'),
      searchSection: container.querySelector('[data-form-section="search"]'),
      hfQuery: container.querySelector('[data-role="hf-query"]'),
      hfResults: container.querySelector('[data-role="hf-results"]'),
      searchHfButton: container.querySelector('[data-action="search-hf"]'),
      hfSearchModal: container.querySelector('[data-modal="hf-search"]'),
      closeSearchModalButton: container.querySelector('[data-action="close-search-modal"]'),
    };

    container.classList.add('tlm-app');
    return resolved;
  }

  function startAutoRefresh() {
    const timer = setInterval(() => {
      refreshState()
        .then(() => {
          renderModelCards();
          updateShellLogs();
          updateOIStatus();
        })
        .catch((err) => console.debug('termux-lm: refresh tick failed', err));
    }, 6000);
    cleanup.push(() => clearInterval(timer));
  }

  function bindEvents() {
    document.addEventListener('keydown', handleGlobalKey, true);
    cleanup.push(() => document.removeEventListener('keydown', handleGlobalKey, true));

    els.addModelButtons.forEach((btn) => {
      btn.addEventListener('click', () => openModelModal('create'));
    });

    els.closeModalButtons.forEach((btn) => {
      btn.addEventListener('click', closeModelModal);
    });

    if (els.refreshButton) {
      els.refreshButton.addEventListener('click', refreshAll);
    }

    if (els.modalForm) {
      els.modalForm.addEventListener('submit', handleModelSubmit);
    }

    els.typeButtons.forEach((btn) => {
      btn.addEventListener('click', () => selectModelType(btn.dataset.modelType));
    });

    els.browseButtons.forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        browseModelFile(btn.closest('[data-form-section]'));
      });
    });

    els.runModeRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          state.runMode = radio.value;
          applyRunMode();
        }
      });
    });

    if (els.startChatButton) {
      els.startChatButton.addEventListener('click', handleStartChat);
    }
    if (els.startInterpreterButton) {
      els.startInterpreterButton.addEventListener('click', handleStartInterpreter);
    }
    if (els.openInterpreterButton) {
      els.openInterpreterButton.addEventListener('click', toggleOIConsole);
    }

    if (els.chatForm) {
      els.chatForm.addEventListener('submit', sendChatMessage);
    }

    if (els.chatBack) {
      els.chatBack.addEventListener('click', closeChatOverlay);
    }

    if (els.drawerToggle) {
      els.drawerToggle.addEventListener('click', () => setDrawerOpen(!state.drawerOpen));
    }

    if (els.drawerClose) {
      els.drawerClose.addEventListener('click', () => setDrawerOpen(false));
    }

    if (els.newSessionButton) {
      els.newSessionButton.addEventListener('click', createSessionFromDrawer);
    }

    if (els.overlayBg) {
      els.overlayBg.addEventListener('click', (event) => {
        if (!els.chatPanel?.contains(event.target)) {
          closeChatOverlay();
        }
      });
    }

    if (els.hfQuery) {
      els.hfQuery.addEventListener('input', debounce(handleHfSearch, 300));
    }

    // OI Console bindings
    if (els.oiForm) {
      els.oiForm.addEventListener('submit', handleOISend);
    }
    if (els.oiApprove) {
      els.oiApprove.addEventListener('click', handleOIApprove);
    }
    if (els.oiAuth) {
      els.oiAuth.addEventListener('click', handleOIAuth);
    }
    if (els.oiBack) {
      els.oiBack.addEventListener('click', () => showOIConsole(false));
    }
    if (els.oiOverlayBg) {
      els.oiOverlayBg.addEventListener('click', (event) => {
        if (!els.oiOverlay?.querySelector('.tlm-oi-panel')?.contains(event.target)) {
          showOIConsole(false);
        }
      });
    }

    if (els.searchHfButton) {
      els.searchHfButton.addEventListener('click', openSearchModal);
    }

    if (els.closeSearchModalButton) {
      els.closeSearchModalButton.addEventListener('click', closeSearchModal);
    }
  }

  function openSearchModal() {
    if (els.hfSearchModal) openDialog(els.hfSearchModal);
  }

  function closeSearchModal() {
    if (els.hfSearchModal) closeDialog(els.hfSearchModal);
  }

  function debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  }

  async function handleHfSearch() {
    if (!els.hfQuery || !els.hfResults) return;
    const query = els.hfQuery.value.trim();

    try {
      els.hfResults.innerHTML = '<div class="tlm-loading">Searching...</div>';
      let results = [];
      if (query) {
        results = await API.get(api, `hf/search?q=${encodeURIComponent(query)}`);
      } else {
        results = [];
      }
      renderHfResults(results);
    } catch (err) {
      els.hfResults.innerHTML = `<div class="tlm-error">${escapeHTML(err.message)}</div>`;
      host.toast?.(err.message || 'Failed to search Hugging Face');
    }
  }

  function renderHfResults(results) {
    if (!els.hfResults) return;
    els.hfResults.innerHTML = '';
    if (!results || !results.length) {
      els.hfResults.innerHTML = '<div class="tlm-empty">No models found.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    results.forEach(model => {
      const card = document.createElement('article');
      card.className = 'tlm-model-card tlm-hf-card';
      
      const sizeMB = model.size / (1024 * 1024);
      const sizeDisplay = model.size > 0 
        ? (sizeMB > 1024 ? `${(sizeMB / 1024).toFixed(2)} GB` : `${sizeMB.toFixed(2)} MB`)
        : 'N/A';

      card.innerHTML = `
        <h3>${escapeHTML(model.model_name)}</h3>
        <div class="tlm-model-meta" style="flex-direction: row; align-items: center; gap: 8px; margin-top: 0.5rem; font-size: 0.8rem;">
          <span>by ${escapeHTML(model.author)}</span>
          <span class="tlm-divider">·</span>
          <span>Quant: ${escapeHTML(model.quant)}</span>
          <span class="tlm-divider">·</span>
          <span>Size: ${sizeDisplay}</span>
        </div>
        <button class="tlm-btn primary" data-action="download-model" style="margin-top: 1rem;">Download</button>
      `;

      const downloadBtn = card.querySelector('[data-action="download-model"]');
      downloadBtn.addEventListener('click', () => handleDownloadClick(model.repo_id, model.file));

      fragment.appendChild(card);
    });
    els.hfResults.appendChild(fragment);
  }

  async function handleDownloadClick(repo, file) {
    closeSearchModal(); // Close the search modal before opening the file picker
    try {
      const target = await window.teFilePicker.saveFile({
        title: 'Save Model As',
        startPath: '~/models',
        filename: file,
      });

      if (!target?.path) return; // User cancelled

      host.toast?.('Preparing download...');

      // 1. Ensure Aria2 daemon is running using absolute paths and fetch
      const ARIA_API_BASE = '/api/app/aria_downloader';

      try {
        let shellRunning = false;
        try {
          const shellResponse = await fetch(`${ARIA_API_BASE}/shell`);
          const shellStatus = await shellResponse.json();
          if (shellStatus.ok && shellStatus.data?.shell?.record?.stats?.alive) {
            shellRunning = true;
          }
        } catch (e) {
          // Ignore error, assume shell is not running
        }

        if (!shellRunning) {
          host.toast?.('Starting download service...');
          const spawnResponse = await fetch(`${ARIA_API_BASE}/shell/spawn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autostart: true, force: true }),
          });
          const spawnResult = await spawnResponse.json();
          if (!spawnResult.ok) {
            throw new Error(spawnResult.error || 'Failed to start download service');
          }
        }

        // 2. Add the download
        const hfUrl = `https://huggingface.co/${repo}/resolve/main/${file}`;
        const addResponse = await fetch(`${ARIA_API_BASE}/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: hfUrl,
            directory: target.directory,
            filename: target.name,
          }),
        });
        const addResult = await addResponse.json();
        if (!addResult.ok) {
          throw new Error(addResult.error || 'Failed to add download to queue');
        }

        // 3. Redirect to Aria Downloader app
        host.toast?.('Download started! Redirecting...');
        window.location.href = '/app/aria_downloader';

      } catch (err) {
        // This will now catch errors from the fetch calls too
        if (err.message !== 'cancelled') {
          host.toast?.(err.message || 'Failed to start download');
          console.error('Download failed', err);
        }
      }
    } catch (err) {
        if (err.message !== 'cancelled') {
            host.toast?.(err.message || 'File picker failed');
            console.error('File picker failed', err);
        }
    }
  }

  function handleGlobalKey(event) {
    if (event.key === 'Escape') {
      closeChatOverlay();
      closeActiveMenu();
    }
  }

  async function refreshAll() {
    await Promise.all([refreshModels(), refreshState()]);
    renderModelCards();
    updateShellLogs();
  }

  async function refreshModels() {
    try {
      const records = await API.get(api, 'models');
      state.models = Array.isArray(records) ? records : [];
      state.models.forEach((model) => {
        if (!state.sessions[model.id]) {
          state.sessions[model.id] = [];
        }
      });
    } catch (err) {
      host.toast?.(err.message || 'Failed to load models');
    }
  }

  async function refreshState() {
    try {
      const payload = await API.get(api, 'sessions/active');
      state.activeModelId = payload?.active_model_id || null;
      state.activeSessionId = payload?.active_session_id || null;
      state.runMode = payload?.run_mode || state.runMode;
      state.shell = payload?.shell || null;
      state.remoteReadiness = payload?.remote_ready_map || {};
      if (state.activeModelId && payload?.model_type === 'remote') {
        state.remoteReadiness[state.activeModelId] = payload.remote_ready ?? false;
      }
      syncRunModeRadios();
      updateActiveModelLabel();
      if (state.activeModelId) {
        await hydrateSessions(state.activeModelId);
        // If the server's activeSessionId points to a non-existent session (e.g., remount), clear it
        const list = state.sessions[state.activeModelId] || [];
        if (state.activeSessionId && !list.some((s) => s.id === state.activeSessionId)) {
          state.activeSessionId = null;
        }
      }
    } catch (err) {
      console.warn('termux-lm: failed to refresh state', err);
    }
  }

  async function hydrateSessions(modelId) {
    try {
      const list = await API.get(api, `models/${modelId}/sessions`);
      state.sessions[modelId] = Array.isArray(list) ? list : [];
    } catch (err) {
      console.warn('termux-lm: failed to hydrate sessions', err);
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
    els.activeModelLabel.textContent = model ? displayName(model) : 'No model loaded';
  }

  function displayName(model) {
    return model?.name || model?.display_name || model?.id || 'Model';
  }

  function getModel(modelId) {
    if (!modelId) return null;
    return state.models.find((item) => item.id === modelId) || null;
  }

  function isRemoteModel(model) {
    return model?.type === 'remote';
  }

  function isModelReady(model) {
    if (!model) return false;
    if (isRemoteModel(model)) {
      const ready = state.remoteReadiness[model.id];
      if (typeof ready === 'boolean') return ready;
      return Boolean(model.remote_ready);
    }
    const shell = state.shell;
    if (!shell || !shell.stats || shell.stats.alive !== true) return false;
    if (typeof shell.label === 'string' && shell.label.includes(model.id)) return true;
    return shell.stats.alive === true;
  }

  function filename(path) {
    if (!path) return '';
    return String(path).split('/').filter(Boolean).pop() || path;
  }

  function renderModelCards() {
    if (!els.cardContainer) return;
    els.cardContainer.innerHTML = '';
    if (!state.models.length) {
      if (els.emptyState) {
        els.emptyState.hidden = false;
        els.cardContainer.appendChild(els.emptyState);
      }
      return;
    }
    if (els.emptyState) els.emptyState.hidden = true;

    const fragment = document.createDocumentFragment();
    state.models.forEach((model) => {
      const isActive = model.id === state.activeModelId;
      const remote = model?.type === 'remote';
      const remoteReady = Boolean(state.remoteReadiness[model.id] ?? model.remote_ready);
      const shellMatches = typeof state.shell?.label === 'string' && state.shell.label.includes(model.id);
      const shellAlive = Boolean(state.shell?.stats?.alive && shellMatches);
      const alive = remote ? (isActive && remoteReady) : (isActive && shellAlive);
      const status = isActive
        ? alive
          ? 'Running'
          : remote && remoteReady
            ? 'Ready'
            : 'Starting…'
        : 'Idle';
      const statusVariant = isActive
        ? alive || (remote && remoteReady)
          ? 'active'
          : 'loading'
        : 'idle';

      const card = document.createElement('article');
      card.className = 'tlm-model-card';
      if (isActive) card.dataset.active = 'true';

      card.innerHTML = `
        <header class="tlm-model-header">
          <div>
            <h3 class="tlm-model-title">${escapeHTML(displayName(model))}</h3>
            <div class="tlm-status">
              <span class="tlm-status-dot" data-status="${statusVariant}"></span>
              <span>${status}</span>
            </div>
          </div>
          <div class="tlm-card-menu" data-role="menu-wrapper">
            <button type="button" class="tlm-btn ghost tlm-btn-icon" data-action="model-menu" aria-haspopup="true" aria-expanded="false">
              <span class="tlm-icon-bars" aria-hidden="true"><span></span></span>
            </button>
            <div class="tlm-menu" hidden>
              <button type="button" data-menu-action="load">${isActive && alive ? 'Reload Model' : 'Load Model'}</button>
              ${isActive && alive ? '<button type="button" data-menu-action="unload">Unload Model</button>' : ''}
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
          ${model.type === 'local' ? `<span class="tlm-model-sub">${escapeHTML(filename(model.path))}</span>` : ''}
          ${model.type === 'remote' ? `<span class="tlm-model-sub">${escapeHTML(model.provider || 'custom')}</span>` : ''}
          ${isActive && state.shell?.stats ? renderShellStats(state.shell.stats) : ''}
        </div>
      `;

      setupCardMenu(card, model, alive);
      fragment.appendChild(card);
    });

    els.cardContainer.appendChild(fragment);
  }

  function renderShellStats(stats) {
    const cpuSource = typeof stats.cpu === 'number'
      ? stats.cpu
      : typeof stats.cpu_percent === 'number'
        ? stats.cpu_percent
        : null;
    const cpu = typeof cpuSource === 'number' ? `${cpuSource.toFixed(1)}% CPU` : null;

    let rssValue = null;
    if (typeof stats.rss_mb === 'number') {
      rssValue = stats.rss_mb;
    } else if (typeof stats.memory_rss === 'number') {
      rssValue = stats.memory_rss / (1024 * 1024);
    } else if (typeof stats.rss_bytes === 'number') {
      rssValue = stats.rss_bytes / (1024 * 1024);
    }
    const rss = typeof rssValue === 'number' ? `${rssValue.toFixed(1)} MB RSS` : null;

    if (!cpu && !rss) return '';
    const items = [cpu, rss].filter(Boolean).map((value) => `<span class="tlm-stat">${value}</span>`);
    return `<div class="tlm-shell-stats">${items.join('<span class="tlm-divider">·</span>')}</div>`;
  }

  function setupCardMenu(card, model, alive) {
    const wrapper = card.querySelector('[data-role="menu-wrapper"]');
    const trigger = card.querySelector('[data-action="model-menu"]');
    const menu = card.querySelector('.tlm-menu');
    if (!wrapper || !trigger || !menu) return;

    const onPointerDown = (event) => {
      if (!wrapper.contains(event.target)) {
        closeMenu();
      }
    };

    const closeMenu = () => {
      menu.hidden = true;
      wrapper.dataset.open = 'false';
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onPointerDown, true);
    };

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const nextHidden = !menu.hidden;
      closeActiveMenu();
      if (nextHidden) {
        closeMenu();
      } else {
        menu.hidden = false;
        wrapper.dataset.open = 'true';
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', onPointerDown, true);
        state.activeMenu = closeMenu;
      }
    });

    menu.querySelectorAll('button[data-menu-action]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        closeMenu();
        const action = btn.dataset.menuAction;
        if (action === 'load') {
          await loadModel(model.id);
        } else if (action === 'unload') {
          await unloadModel(model.id);
        } else if (action === 'edit') {
          openModelModal('edit', model);
        } else if (action === 'delete') {
          await deleteModel(model.id, displayName(model));
        } else if (action === 'session') {
          await startSession(model);
        }
      });
    });
  }

  function closeActiveMenu() {
    if (typeof state.activeMenu === 'function') {
      state.activeMenu();
      state.activeMenu = null;
    }
  }

  async function loadModel(modelId) {
    try {
      await API.post(api, `models/${encodeURIComponent(modelId)}/load`, {});
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
      await API.post(api, `models/${encodeURIComponent(modelId)}/unload`, {});
      host.toast?.('Model unloaded');
      await refreshState();
      renderModelCards();
      updateShellLogs();
    } catch (err) {
      host.toast?.(err.message || 'Failed to unload model');
    }
  }

  async function startSession(model) {
    try {
      if (!model) {
        host.toast?.('No model selected');
        return;
      }

      if (state.activeModelId !== model.id) {
        await loadModel(model.id);
      }

      const freshModel = getModel(model.id) || model;
      if (!isModelReady(freshModel)) {
        host.toast?.('Model is still loading');
        return;
      }

      const session = await API.post(api, `models/${encodeURIComponent(freshModel.id)}/sessions`, {
        run_mode: state.runMode,
      });
      upsertSession(freshModel.id, session);
      state.activeModelId = freshModel.id;
      state.activeSessionId = session?.id || null;
      host.toast?.('Session created');
      openChatOverlay(freshModel.id, state.activeSessionId);
    } catch (err) {
      host.toast?.(err.message || 'Failed to start session');
    }
  }

  function upsertSession(modelId, session) {
    if (!session || !session.id) return;
    const list = state.sessions[modelId] || [];
    const index = list.findIndex((item) => item.id === session.id);
    if (index >= 0) {
      list[index] = session;
    } else {
      list.unshift(session);
    }
    state.sessions[modelId] = list;
    renderSessionList();
  }

  async function hydrateSession(modelId, sessionId) {
    try {
      const payload = await API.get(api, `models/${encodeURIComponent(modelId)}/sessions/${encodeURIComponent(sessionId)}`);
      if (!payload) return;
      payload.id = sessionId;
      upsertSession(modelId, payload);
      if (state.activeModelId === modelId && state.activeSessionId === sessionId) {
        state.chatMessages = payload.messages || [];
        renderChatMessages();
      }
    } catch (err) {
      console.warn('termux-lm: failed to hydrate session', err);
    }
  }

  async function deleteSession(modelId, sessionId) {
    try {
      await API.del(api, `models/${encodeURIComponent(modelId)}/sessions/${encodeURIComponent(sessionId)}`);
      const list = state.sessions[modelId] || [];
      state.sessions[modelId] = list.filter((item) => item.id !== sessionId);
      if (state.activeSessionId === sessionId) {
        state.activeSessionId = null;
        state.chatMessages = [];
        renderChatMessages();
      }
      renderSessionList();
      host.toast?.('Session deleted');
    } catch (err) {
      host.toast?.(err.message || 'Failed to delete session');
    }
  }

  function applyRunMode() {
    // No-op now that run mode UI is removed
  }

  function openChatOverlay(modelId, sessionId) {
    if (!els.chatOverlay) return;
    const model = modelId ? getModel(modelId) : getModel(state.activeModelId);
    if (!model) {
      host.toast?.('Load a model before starting a chat');
      return;
    }
    if (!isModelReady(model)) {
      host.toast?.('Model is still loading');
      return;
    }
    if (modelId) state.activeModelId = modelId;
    state.activeSessionId = sessionId || null;
    state.chatMessages = [];
    const session = getCurrentSession();
    if (session?.messages) {
      state.chatMessages = [...session.messages];
    }
    els.chatOverlay.dataset.open = 'true';
    setDrawerOpen(false);
    applyRunMode();
    renderChatOverlay();
  }

  function closeChatOverlay() {
    if (els.chatOverlay) {
      els.chatOverlay.dataset.open = 'false';
      setDrawerOpen(false);
    }
  }

  function getCurrentSession() {
    if (!state.activeModelId || !state.activeSessionId) return null;
    return (state.sessions[state.activeModelId] || []).find((session) => session.id === state.activeSessionId) || null;
  }

  function renderChatOverlay() {
    if (!els.chatOverlay || els.chatOverlay.dataset.open !== 'true') return;
    const model = state.models.find((item) => item.id === state.activeModelId);
    if (model) {
      const titleEl = els.chatOverlay.querySelector('[data-role="chat-title"]');
      if (titleEl) titleEl.textContent = displayName(model);
    }
    const modeEl = els.chatOverlay.querySelector('[data-role="chat-mode"]');
    if (modeEl) modeEl.textContent = state.runMode === 'chat' ? 'Chat Interface' : 'Open Interpreter';
    renderSessionList();
    renderChatMessages();
  }

  function renderSessionList() {
    if (!els.chatSessions || !state.activeModelId) return;
    const list = state.sessions[state.activeModelId] || [];
    els.chatSessions.innerHTML = '';
    list.forEach((session) => {
      const item = document.createElement('li');
      item.className = 'tlm-session-item';
      item.dataset.sessionId = session.id;
      item.dataset.active = session.id === state.activeSessionId ? 'true' : 'false';
      item.innerHTML = `
        <button type="button" class="tlm-session-icon" data-role="delete-session" title="Delete session">×</button>
        <span class="tlm-session-title">${escapeHTML(session.title || session.id)}</span>
        <button type="button" class="tlm-session-icon" data-role="rename-session" title="Rename session">✏️</button>
      `;
      item.querySelector('[data-role="delete-session"]').addEventListener('click', (event) => {
        event.stopPropagation();
        const ok = confirm('Delete this session?');
        if (ok) deleteSession(state.activeModelId, session.id);
      });
      item.querySelector('[data-role="rename-session"]').addEventListener('click', (event) => {
        event.stopPropagation();
        promptRenameSession(session);
      });
      item.addEventListener('click', () => {
        state.activeSessionId = session.id;
        state.chatMessages = session.messages ? [...session.messages] : [];
        renderChatOverlay();
        setDrawerOpen(false);
      });
      els.chatSessions.appendChild(item);
    });
  }

  function renderChatMessages() {
    if (!els.chatLog) return;
    els.chatLog.innerHTML = '';
    state.chatMessages.forEach((message) => {
      const div = document.createElement('div');
      div.className = 'tlm-chat-bubble';
      div.classList.add(message.role === 'user' ? 'tlm-chat-user' : 'tlm-chat-assistant');
      if (message.pending) div.dataset.pending = 'true';
      div.textContent = message.content || '';
      els.chatLog.appendChild(div);
    });
    if (els.chatEmpty) els.chatEmpty.hidden = Boolean(state.chatMessages.length);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function setDrawerOpen(value) {
    state.drawerOpen = Boolean(value);
    if (els.chatPanel) {
      els.chatPanel.dataset.drawer = state.drawerOpen ? 'open' : 'closed';
    }
  }

  async function handleStartChat() {
    const model = getModel(state.activeModelId);
    if (!model) {
      host.toast?.('Load a model before starting a chat');
      return;
    }

    if (!isModelReady(model)) {
      host.toast?.('Model is still loading');
      return;
    }

    const sessions = state.sessions[state.activeModelId] || [];
    if (sessions.length) {
      openChatOverlay(state.activeModelId, sessions[0].id);
      return;
    }

    await startSession(model);
  }

  async function createSessionFromDrawer() {
    const model = getModel(state.activeModelId);
    if (!model) {
      host.toast?.('No active model');
      return;
    }
    if (!isModelReady(model)) {
      host.toast?.('Model is still loading');
      return;
    }
    await startSession(model);
  }

  async function sendChatMessage(event) {
    event.preventDefault();
    if (!els.chatInput) return;
    const text = els.chatInput.value.trim();
    if (!text) return;
    const modelId = state.activeModelId;
    if (!modelId) {
      host.toast?.('Load a model first');
      return;
    }

    // Ensure the session exists on the server; if not, create a new one transparently
    let sessionId;
    try {
      sessionId = await getOrCreateValidSession(modelId, state.activeSessionId);
    } catch (e) {
      console.error('termux-lm: failed to ensure valid session', e);
      host.toast?.('Failed to start session');
      return;
    }

    state.activeModelId = modelId;
    state.activeSessionId = sessionId;

    els.chatInput.value = '';
    appendMessage('user', text);
    appendMessage('assistant', '', { pending: true });
    await streamAssistant(modelId, sessionId, text);
  }

  async function ensureSession() {
    const model = getModel(state.activeModelId);
    if (!model) return null;
    if (!isModelReady(model)) {
      host.toast?.('Model is still loading');
      return null;
    }
    const session = await API.post(api, `models/${encodeURIComponent(model.id)}/sessions`, {
      run_mode: state.runMode,
    });
    upsertSession(model.id, session);
    state.activeSessionId = session.id;
    return session.id;
  }

  // Verify the session exists on the server; if missing (404), create a new one
  async function getOrCreateValidSession(modelId, sessionId) {
    const model = getModel(modelId);
    if (!model) throw new Error('No model');
    if (!isModelReady(model)) throw new Error('Model is still loading');

    if (sessionId) {
      try {
        const resp = await fetch(`${apiBase}models/${encodeURIComponent(modelId)}/sessions/${encodeURIComponent(sessionId)}`);
        if (resp.ok) {
          return sessionId;
        }
        if (resp.status !== 404) {
          // Unknown server error; surface it
          const text = await resp.text();
          console.warn('termux-lm: session existence check failed', resp.status, text);
        }
      } catch (err) {
        console.warn('termux-lm: session existence check error', err);
      }
    }

    // Create a fresh session
    const session = await API.post(api, `models/${encodeURIComponent(modelId)}/sessions`, {
      run_mode: state.runMode,
    });
    upsertSession(modelId, session);
    state.activeModelId = modelId;
    state.activeSessionId = session.id;
    return session.id;
  }

  function appendMessage(role, content, extras = {}) {
    const message = { role, content, ...extras };
    state.chatMessages = [...state.chatMessages, message];
    const session = getCurrentSession();
    if (session) {
      const nextMessages = session.messages ? [...session.messages, message] : [message];
      session.messages = nextMessages;
    }
    renderChatMessages();
  }

  async function promptRenameSession(session) {
    const modelId = state.activeModelId;
    if (!modelId || !session?.id) return;
    const current = session.title || '';
    const nextTitle = prompt('Rename session', current);
    if (nextTitle === null) return;
    const trimmed = nextTitle.trim();
    if (!trimmed) {
      host.toast?.('Title cannot be empty');
      return;
    }
    try {
      const updated = await API.post(api, `models/${encodeURIComponent(modelId)}/sessions/${encodeURIComponent(session.id)}`, {
        title: trimmed,
      });
      session.title = updated?.title || trimmed;
      upsertSession(modelId, session);
      renderSessionList();
      host.toast?.('Session renamed');
    } catch (err) {
      host.toast?.(err.message || 'Failed to rename session');
    }
  }

  async function appendMessageRemote(modelId, sessionId, role, message) {
    try {
      await API.post(api, `models/${encodeURIComponent(modelId)}/sessions/${encodeURIComponent(sessionId)}/messages`, {
        role,
        message,
      });
      const session = state.sessions[modelId]?.find((item) => item.id === sessionId);
      if (session) {
        const payload = session.messages ? [...session.messages, { role, content: message }] : [{ role, content: message }];
        session.messages = payload;
      }
    } catch (err) {
      console.warn('termux-lm: failed to persist message', err);
    }
  }

  function updatePendingAssistant(content) {
    const updated = [...state.chatMessages];
    for (let i = updated.length - 1; i >= 0; i -= 1) {
      if (updated[i].role === 'assistant') {
        updated[i] = { ...updated[i], content, pending: false };
        break;
      }
    }
    state.chatMessages = updated;
    renderChatMessages();
  }

  async function streamAssistant(modelId, sessionId, prompt) {
    const events = await requestStream(modelId, sessionId, prompt);
    let buffer = '';
    try {
      for await (const chunk of events) {
        if (chunk.type === 'token') {
          buffer += chunk.content || '';
          updatePendingAssistant(buffer);
        } else if (chunk.type === 'error') {
          host.toast?.(chunk.message || 'Stream error');
        }
      }
    } catch (err) {
      console.error('termux-lm: stream failure', err);
      host.toast?.(err.message || 'Stream failed');
    } finally {
      await hydrateSession(modelId, sessionId);
    }
  }

  async function requestStream(modelId, sessionId, prompt) {
    const controller = new AbortController();
    state.streamController = controller;
    state.streaming = true;

    const response = await fetch(`${apiBase}models/${encodeURIComponent(modelId)}/sessions/${encodeURIComponent(sessionId)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, stream: true }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Stream request failed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Streaming unsupported');
    const decoder = new TextDecoder();

    async function* iterate() {
      let buffer = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 2);
            if (!chunk.startsWith('data:')) continue;
            const payload = chunk.slice(5).trim();
            if (!payload) continue;
            try {
              yield JSON.parse(payload);
            } catch (err) {
              console.debug('termux-lm: bad SSE payload', err, payload);
            }
          }
        }
      } finally {
        controller.abort();
        state.streaming = false;
        state.streamController = null;
      }
    }

    return iterate();
  }

  function updateShellLogs() {
    if (!els.shellStdout || !els.shellStderr) return;
    if (!state.shell) {
      els.shellStdout.textContent = '';
      els.shellStderr.textContent = '';
      return;
    }
    const logs = state.shell.logs || {};
    els.shellStdout.textContent = (logs.stdout_tail || []).join('\n');
    els.shellStderr.textContent = (logs.stderr_tail || []).join('\n');
  }

  function openModelModal(mode, model) {
    if (!els.modal) return;
    state.modalMode = mode;
    const title = mode === 'edit' ? 'Edit Model' : 'Add Model';
    if (els.modalTitle) els.modalTitle.textContent = title;
    state.pendingModelType = model?.type || 'local';
    selectModelType(state.pendingModelType, { silent: true });

    if (model) {
      state.modalDraft = { ...model };
      populateModal(model);
    } else {
      populateModal(state.modalDraft);
    }

    openDialog(els.modal);
  }

  function populateModal(model) {
    if (!els.modalForm) return;
    els.modalForm.reset();
    if (state.modalMode === 'edit' && model?.id) {
      state.modalDraft = { ...model };
    }
    const values = model || {};
    Object.entries(values).forEach(([key, value]) => {
      const field = els.modalForm.elements.namedItem(key);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        field.value = value ?? '';
      }
    });
  }

  function closeModelModal() {
    if (!els.modal) return;
    closeDialog(els.modal);
  }

  function selectModelType(type, { silent } = {}) {
    state.pendingModelType = type === 'remote' ? 'remote' : 'local';
    els.typeButtons.forEach((btn) => {
      btn.dataset.active = btn.dataset.modelType === state.pendingModelType ? 'true' : 'false';
    });
    if (els.localSection) els.localSection.hidden = state.pendingModelType !== 'local';
    if (els.remoteSection) els.remoteSection.hidden = state.pendingModelType !== 'remote';
    if (!silent) {
      host.toast?.(state.pendingModelType === 'local' ? 'Configuring local llama.cpp' : 'Configuring remote API');
    }
  }

  async function browseModelFile(section) {
    if (!section) return;
    const field = section.querySelector('input[name="path"]');
    if (!field) return;

    let reopen = false;
    if (els.modal?.open) {
      closeDialog(els.modal);
      reopen = true;
    }

    try {
      const choice = await window.teFilePicker?.openFile?.({
        title: 'Select GGUF Model',
        startPath: field.value || '~/models',
      });
      if (choice?.path) {
        field.value = choice.path;
        field.dispatchEvent(new Event('change', { bubbles: true }));
        state.modalDraft = { ...state.modalDraft, path: choice.path };
      }
    } catch (err) {
      console.debug('termux-lm: file picker closed', err);
    } finally {
      if (reopen) openDialog(els.modal);
    }
  }

  function openDialog(dialog) {
    if (!dialog) return;
    dialog.hidden = false;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else if (typeof dialog.show === 'function') {
      dialog.show();
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      try {
        dialog.close();
        return;
      } catch (err) {
        dialog.open = false;
      }
    }
    dialog.hidden = true;
    dialog.removeAttribute('open');
  }

  async function handleModelSubmit(event) {
    event.preventDefault();
    if (!els.modalForm) return;
    const formData = new FormData(els.modalForm);
    const payload = Object.fromEntries(formData.entries());
    payload.type = state.pendingModelType;
    const editing = state.modalMode === 'edit' && state.modalDraft?.id;
    if (editing) {
      payload.id = state.modalDraft.id;
    }
    if (payload.type === 'remote') {
      payload.remote_model = payload.remote_model?.trim() || '';
      payload.reasoning_effort = payload.reasoning_effort ? Number(payload.reasoning_effort) : undefined;
      if (!payload.remote_model) {
        host.toast?.('Remote model identifier required');
        return;
      }
      if (Number.isNaN(payload.reasoning_effort)) {
        payload.reasoning_effort = undefined;
      }
    }

    try {
      let record;
      if (editing && payload.id) {
        record = await API.post(api, `models/${encodeURIComponent(payload.id)}`, payload);
        state.models = state.models.map((item) => (item.id === record.id ? record : item));
      } else {
        record = await API.post(api, 'models', payload);
        state.models.unshift(record);
      }
      host.toast?.('Model saved');
      closeModelModal();
      renderModelCards();
      updateActiveModelLabel();
    } catch (err) {
      host.toast?.(err.message || 'Failed to save model');
    }
  }

  async function deleteModel(modelId, name) {
    const ok = confirm(`Delete model "${name}"?`);
    if (!ok) return;
    try {
      await API.del(api, `models/${encodeURIComponent(modelId)}`);
      state.models = state.models.filter((item) => item.id !== modelId);
      if (state.activeModelId === modelId) {
        state.activeModelId = null;
        state.activeSessionId = null;
        state.chatMessages = [];
      }
      renderModelCards();
      updateActiveModelLabel();
      host.toast?.('Model deleted');
    } catch (err) {
      host.toast?.(err.message || 'Failed to delete model');
    }
  }

  // --- Open Interpreter Console helpers ---

  async function handleStartInterpreter() {
    const model = getModel(state.activeModelId);
    if (!model) {
      host.toast?.('Load a model before starting the interpreter');
      return;
    }
    if (!isModelReady(model)) {
      host.toast?.('Model is still loading');
      return;
    }
    try {
      await API.post(api, 'interpreter/start', {});
      host.toast?.('Interpreter server started');
      updateOIStatus();
    } catch (err) {
      host.toast?.(err.message || 'Failed to start interpreter');
    }
  }

  // --- OI direct WebSocket client ---
  const oi = { ws: null, connected: false, authed: false, assistantEl: null, codeEl: null, consoleEl: null };

  function showOIConsole(open) {
    if (!els.oiOverlay) return;
    els.oiOverlay.dataset.open = open ? 'true' : 'false';
    if (open) {
      clearOILog();
      connectOIWS();
    } else {
      disconnectOIWS();
    }
  }

  function toggleOIConsole() {
    if (!els.oiOverlay) return;
    const isOpen = els.oiOverlay.dataset.open === 'true';
    showOIConsole(!isOpen);
  }

  function clearOILog() {
    if (els.oiLog) {
      els.oiLog.innerHTML = '';
    }
    oi.assistantEl = null;
    oi.codeEl = null;
    oi.consoleEl = null;
  }

  // Generic line append helper with styling
  function appendLine(variant, text) {
    if (!els.oiLog) return;
    const div = document.createElement('div');
    div.className = 'tlm-oi-line' + (variant ? ` tlm-oi-${variant}` : '');
    div.textContent = String(text ?? '');
    els.oiLog.appendChild(div);
    els.oiLog.scrollTop = els.oiLog.scrollHeight;
  }

  // Assistant message handling without per-token newlines
  function beginAssistantLine() {
    if (!els.oiLog) return;
    if (!oi.assistantEl) {
      const div = document.createElement('div');
      div.className = 'tlm-oi-line tlm-oi-assistant';
      els.oiLog.appendChild(div);
      oi.assistantEl = div;
    }
  }
  function endAssistantLine() {
    if (oi.assistantEl) {
      oi.assistantEl = null;
      els.oiLog.scrollTop = els.oiLog.scrollHeight;
    }
  }
  function appendAssistantToken(content) {
    if (!els.oiLog) return;
    beginAssistantLine();
    oi.assistantEl.textContent += String(content || '');
    els.oiLog.scrollTop = els.oiLog.scrollHeight;
  }

  // Code block handling (stream tokens into a single code element)
  function beginCodeBlock() {
    if (!els.oiLog) return;
    if (!oi.codeEl) {
      const div = document.createElement('div');
      div.className = 'tlm-oi-line tlm-oi-code';
      els.oiLog.appendChild(div);
      oi.codeEl = div;
    }
  }
  function endCodeBlock() {
    if (oi.codeEl) {
      oi.codeEl = null;
      els.oiLog.scrollTop = els.oiLog.scrollHeight;
    }
  }
  function appendCodeToken(content) {
    if (!els.oiLog) return;
    beginCodeBlock();
    oi.codeEl.textContent += String(content || '');
    els.oiLog.scrollTop = els.oiLog.scrollHeight;
  }

  // Console block handling (stream console output into a single element)
  function beginConsoleBlock() {
    if (!els.oiLog) return;
    if (!oi.consoleEl) {
      const div = document.createElement('div');
      div.className = 'tlm-oi-line tlm-oi-console';
      els.oiLog.appendChild(div);
      oi.consoleEl = div;
    }
  }
  function endConsoleBlock() {
    if (oi.consoleEl) {
      oi.consoleEl = null;
      els.oiLog.scrollTop = els.oiLog.scrollHeight;
    }
  }
  function appendConsoleToken(content) {
    if (!els.oiLog) return;
    beginConsoleBlock();
    oi.consoleEl.textContent += String(content || '');
    els.oiLog.scrollTop = els.oiLog.scrollHeight;
  }

  // Insert user's prompt inline as its own styled line with "> " prefix
  function appendUserLine(text) {
    if (!els.oiLog) return;
    if (oi.assistantEl) endAssistantLine();
    appendLine('user', `> ${String(text || '')}`);
  }

  function appendOIFrame(frame) {
    try {
      const eventData = frame?.data ?? frame;
      if (eventData && typeof eventData === 'object') {
        const role = eventData.role;
        const type = eventData.type;
        const fmt = eventData.format;
        const content = eventData.content;

        // Suppress control markers like the active console line indicator
        if (role === 'computer' && type === 'console' && fmt === 'active_line') {
          return;
        }

        // Suppress start/end markers for code and console blocks
        if (role === 'assistant' && type === 'code') {
          if (eventData.start === true) {
            beginCodeBlock();
            return;
          }
          if (eventData.end === true) {
            endCodeBlock();
            appendLine('approve', 'do you approve?');
            return;
          }
          if (typeof content === 'string' && content) {
            appendCodeToken(content);
            return;
          }
        }

        // Console output with block handling
        if (role === 'computer' && type === 'console') {
          if (eventData.start === true) {
            beginConsoleBlock();
            return;
          }
          if (eventData.end === true) {
            endConsoleBlock();
            return;
          }
          if (fmt === 'output' && content) {
            appendConsoleToken(String(content));
            return;
          }
        }

        // Assistant streaming: no newline per token
        if (role === 'assistant' && type === 'message') {
          if (eventData.start === true) {
            beginAssistantLine();
            return;
          }
          if (eventData.end === true) {
            endAssistantLine();
            return;
          }
          if (typeof content === 'string' && content) {
            appendAssistantToken(content);
            return;
          }
        }

        // Server status line
        if (role === 'server' && type === 'status') {
          const text = typeof content === 'string' ? content : JSON.stringify(eventData);
          appendLine('status', text === 'complete' ? '***' : text);
          return;
        }
      }
      // Fallback for unknown frames
      appendLine('', JSON.stringify(eventData));
    } catch (err) {
      appendLine('', String(frame));
    }
  }

  function connectOIWS() {
    try {
      oi.ws = new WebSocket('ws://127.0.0.1:8000/');
      oi.ws.onopen = () => {
        oi.connected = true;
        if (els.oiSend) els.oiSend.disabled = !oi.authed;
        if (els.oiApprove) els.oiApprove.disabled = !oi.authed;
      };
      oi.ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (e) { data = { raw: event.data }; }
        appendOIFrame(data);
      };
      oi.ws.onclose = () => {
        oi.connected = false;
        oi.authed = false;
        if (els.oiSend) els.oiSend.disabled = true;
        if (els.oiApprove) els.oiApprove.disabled = true;
      };
      oi.ws.onerror = () => {
        host.toast?.('OI connection error');
      };
    } catch (err) {
      host.toast?.('Failed to open OI WS');
    }
  }

  function disconnectOIWS() {
    try { oi.ws?.close(); } catch (e) {}
    oi.ws = null;
    oi.connected = false;
    oi.authed = false;
  }

  async function handleOISend(event) {
    event.preventDefault();
    const text = (els.oiInput?.value || '').trim();
    if (!text) return;
    if (!oi.connected || !oi.ws) {
      host.toast?.('Not connected to OI');
      return;
    }
    if (!oi.authed) {
      host.toast?.('Click Auth first');
      return;
    }
    try {
      // Insert user prompt inline immediately
      appendUserLine(text);
      // Clear input early for responsive UX
      els.oiInput.value = '';
      const frames = [
        { role: 'user', start: true },
        { role: 'user', type: 'message', content: text },
        { role: 'user', end: true },
      ];
      frames.forEach(f => oi.ws.send(JSON.stringify(f)));
    } catch (err) {
      host.toast?.('Failed to send');
    }
  }

  async function handleOIApprove() {
    if (!oi.connected || !oi.ws) {
      host.toast?.('Not connected to OI');
      return;
    }
    if (!oi.authed) {
      host.toast?.('Click Auth first');
      return;
    }
    try {
      const frames = [
        { role: 'user', type: 'command', start: true },
        { role: 'user', type: 'command', content: 'go' },
        { role: 'user', type: 'command', end: true },
      ];
      frames.forEach(f => oi.ws.send(JSON.stringify(f)));
    } catch (err) {
      host.toast?.('Failed to approve');
    }
  }

  function handleOIAuth() {
    if (!oi.connected || !oi.ws) {
      host.toast?.('Not connected to OI');
      return;
    }
    try {
      oi.ws.send(JSON.stringify({ auth: true }));
      oi.authed = true;
      if (els.oiSend) els.oiSend.disabled = false;
      if (els.oiApprove) els.oiApprove.disabled = false;
    } catch (err) {
      host.toast?.('Auth failed');
    }
  }

  async function updateOIStatus() {
    if (!els.oiStatus) return;
    try {
      const resp = await fetch('/api/framework_shells');
      const payload = await resp.json();
      let statusHTML = '<span class="tlm-status-dot" data-status="idle"></span> Open Interpreter Inactive';
      let enableChat = false;
      if (payload && payload.ok !== false && Array.isArray(payload.data)) {
        const shells = payload.data;
        const modelId = state.activeModelId;
        const prefix = modelId ? `oi:${modelId}` : 'oi:';
        const matches = shells.filter(sh => typeof sh.label === 'string' && sh.label.startsWith(prefix) && sh.stats?.alive);
        if (matches.length > 0) {
          const shell = matches[0];
          const pid = shell.pid || shell.stats?.pid;
          const cpuVal = (typeof shell.stats?.cpu_percent === 'number') ? shell.stats.cpu_percent : (typeof shell.stats?.cpu === 'number' ? shell.stats.cpu : null);
          const cpuStr = (cpuVal !== null) ? `${cpuVal.toFixed(1)}% CPU` : '';
          const rssBytes = shell.stats?.memory_rss ?? shell.stats?.rss_bytes ?? 0;
          let memStr = '';
          if (rssBytes > 0) {
            const mbytes = rssBytes / (1024 * 1024);
            memStr = (mbytes >= 1024) ? `${(mbytes/1024).toFixed(1)} GB` : (mbytes >= 10 ? `${Math.round(mbytes)} MB` : `${mbytes.toFixed(1)} MB`);
            memStr += ' RAM';
          }
          const stateText = shell.status ? (shell.status[0].toUpperCase() + shell.status.slice(1)) : 'Running';
          statusHTML = `<span class=\"tlm-status-dot\" data-status=\"active\"></span> Open Interpreter ${stateText} – PID ${pid}${cpuStr ? `, ${cpuStr}` : ''}${memStr ? `, ${memStr}` : ''}`;
          enableChat = true;
        }
      }
      els.oiStatus.innerHTML = statusHTML;
      if (els.openInterpreterButton) {
        els.openInterpreterButton.disabled = !enableChat;
      }
    } catch (err) {
      console.warn('termux-lm: failed to update OI status', err);
    }
  }

  host.onBeforeExit?.(() => {
    cleanup.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.debug('termux-lm: cleanup failed', err);
      }
    });
    closeActiveMenu();
    return {};
  });
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
