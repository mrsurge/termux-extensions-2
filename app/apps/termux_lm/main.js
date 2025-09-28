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
  };

  const els = mapElements(root);
  const cleanup = [];
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
      oiPlaceholder: container.querySelector('[data-role="oi-placeholder"]'),
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
      syncRunModeRadios();
      updateActiveModelLabel();
      if (state.activeModelId) {
        await hydrateSessions(state.activeModelId);
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
      const alive = Boolean(state.shell?.stats?.alive && isActive);
      const status = isActive ? (alive ? 'Running' : 'Starting…') : 'Idle';
      const statusVariant = isActive ? (alive ? 'active' : 'loading') : 'idle';

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
    const cpu = typeof stats.cpu === 'number' ? `${stats.cpu.toFixed(1)}% CPU` : null;
    const rss = typeof stats.rss_mb === 'number' ? `${stats.rss_mb.toFixed(1)} MB RSS` : null;
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
      if (state.activeModelId !== model.id) {
        await loadModel(model.id);
      }
      if (!state.shell?.stats?.alive) {
        host.toast?.('Model shell not ready yet');
        return;
      }
      const session = await API.post(api, `models/${encodeURIComponent(model.id)}/sessions`, {
        run_mode: state.runMode,
      });
      upsertSession(model.id, session);
      state.activeModelId = model.id;
      state.activeSessionId = session?.id || null;
      host.toast?.('Session created');
      openChatOverlay(model.id, state.activeSessionId);
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
    if (!els.chatOverlay) return;
    els.chatOverlay.dataset.mode = state.runMode;
    if (state.runMode === 'chat') {
      if (els.chatForm) els.chatForm.hidden = false;
      if (els.oiPlaceholder) els.oiPlaceholder.hidden = true;
    } else {
      if (els.chatForm) els.chatForm.hidden = true;
      if (els.oiPlaceholder) els.oiPlaceholder.hidden = false;
      setDrawerOpen(false);
    }
  }

  function openChatOverlay(modelId, sessionId) {
    if (!els.chatOverlay) return;
    if (!state.shell?.stats?.alive) {
      host.toast?.('Load a model before starting a chat');
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
        <span>${escapeHTML(session.title || session.id)}</span>
        <button type="button" data-role="delete-session" title="Delete session">x</button>
      `;
      item.querySelector('[data-role="delete-session"]').addEventListener('click', (event) => {
        event.stopPropagation();
        const ok = confirm('Delete this session?');
        if (ok) deleteSession(state.activeModelId, session.id);
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
    if (!state.activeModelId) {
      const firstModel = state.models[0];
      if (!firstModel) {
        host.toast?.('Add a model first');
        return;
      }
      await startSession(firstModel);
      return;
    }

    if (!state.shell?.stats?.alive) {
      host.toast?.('Load a model before starting a chat');
      return;
    }

    const sessions = state.sessions[state.activeModelId] || [];
    openChatOverlay(state.activeModelId, sessions[0]?.id || null);
    if (!sessions.length) {
      const model = state.models.find((item) => item.id === state.activeModelId);
      if (model) {
        await startSession(model);
      }
    }
  }

  async function createSessionFromDrawer() {
    const model = state.models.find((item) => item.id === state.activeModelId);
    if (!model) {
      host.toast?.('No active model');
      return;
    }
    await startSession(model);
  }

  async function sendChatMessage(event) {
    event.preventDefault();
    if (!els.chatInput) return;
    const text = els.chatInput.value.trim();
    if (!text) return;
    if (!state.activeModelId) {
      host.toast?.('Load a model first');
      return;
    }
    if (!state.activeSessionId) {
      const sessionId = await ensureSession();
      if (!sessionId) {
        host.toast?.('Failed to start session');
        return;
      }
    }

    els.chatInput.value = '';
    appendMessage('user', text);
    await appendMessageRemote(state.activeModelId, state.activeSessionId, 'user', text);
    appendMessage('assistant', '', { pending: true });
    await streamAssistant(state.activeModelId, state.activeSessionId, text);
  }

  async function ensureSession() {
    const model = state.models.find((item) => item.id === state.activeModelId);
    if (!model) return null;
    const session = await API.post(api, `models/${encodeURIComponent(model.id)}/sessions`, {
      run_mode: state.runMode,
    });
    upsertSession(model.id, session);
    state.activeSessionId = session.id;
    return session.id;
  }

  function appendMessage(role, content, extras = {}) {
    state.chatMessages = [...state.chatMessages, { role, content, ...extras }];
    renderChatMessages();
  }

  async function appendMessageRemote(modelId, sessionId, role, message) {
    try {
      await API.post(api, `models/${encodeURIComponent(modelId)}/sessions/${encodeURIComponent(sessionId)}/messages`, {
        role,
        message,
      });
      await hydrateSession(modelId, sessionId);
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
      if (buffer.trim()) {
        await appendMessageRemote(modelId, sessionId, 'assistant', buffer.trim());
      }
    } catch (err) {
      console.error('termux-lm: stream failure', err);
      host.toast?.(err.message || 'Stream failed');
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

    try {
      let record;
      if (state.modalMode === 'edit' && payload.id) {
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
