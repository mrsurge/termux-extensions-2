import { initPyrightModals } from './extensions/pyright.js';
import { initAndroidModal } from './extensions/android.js';

export function initLspModal(ctx) {
  const {
    host,
    apiPost,
    apiGet,
    updatePreference,
    fetchEditorState,
    getEditorViewState,
    basename,
    closeAllMenus,
    updateLspSpinner,
    toAbsolute,
    HOME_DIR,
    getCachedProjectRoot,
    parentDir,
    pickFile,
    pickDirectory,
    openFile,
    getClientId,
  } = ctx;

  const lspModal = {
    root: document.getElementById('lsp-modal'),
    closeBtn: document.getElementById('lsp-modal-close'),
    globalToggleBtn: document.getElementById('lsp-global-toggle-btn'),
    statusPyright: document.getElementById('lsp-status-pyright'),
    statusTypescript: document.getElementById('lsp-status-typescript'),
    statusClangd: document.getElementById('lsp-status-clangd'),
    statusKotlin: document.getElementById('lsp-status-kotlin'),
    statusKotlinAndroid: document.getElementById('lsp-status-kotlin-android'),
    togglePyright: document.getElementById('lsp-toggle-pyright'),
    toggleTypescript: document.getElementById('lsp-toggle-typescript'),
    toggleClangd: document.getElementById('lsp-toggle-clangd'),
    toggleKotlin: document.getElementById('lsp-toggle-kotlin'),
    toggleKotlinAndroid: document.getElementById('lsp-toggle-kotlin-android'),
    startPyright: document.getElementById('lsp-start-pyright'),
    scanPyright: document.getElementById('lsp-scan-pyright'),
    startTypescript: document.getElementById('lsp-start-typescript'),
    startClangd: document.getElementById('lsp-start-clangd'),
    startKotlin: document.getElementById('lsp-start-kotlin'),
    startKotlinAndroid: document.getElementById('lsp-start-kotlin-android'),
    syncKotlinAndroid: document.getElementById('lsp-sync-kotlin-android'),
    configKotlinAndroid: document.getElementById('lsp-config-kotlin-android'),
    variantKotlinAndroidBtn: document.getElementById('lsp-variant-kotlin-android-btn'),
    variantKotlinAndroidLabel: document.getElementById('lsp-variant-kotlin-android-label'),
    variantKotlinAndroidDD: document.getElementById('lsp-variant-kotlin-android-dd'),
    pyrightModeRoot: document.getElementById('lsp-pyright-mode-root'),
    pyrightModeWorkers: document.getElementById('lsp-pyright-mode-workers'),
    pyrightWorkersBtn: document.getElementById('lsp-pyright-workers-btn'),
    rootRelPyright: document.getElementById('lsp-rootrel-pyright'),
    rootRelTypescript: document.getElementById('lsp-rootrel-typescript'),
    rootRelClangd: document.getElementById('lsp-rootrel-clangd'),
    rootRelKotlin: document.getElementById('lsp-rootrel-kotlin'),
    rootRelKotlinAndroid: document.getElementById('lsp-rootrel-kotlin-android'),
  };

  const lspSetupBanner = {
    root: document.getElementById('fe-lsp-setup-banner'),
    text: document.getElementById('fe-lsp-setup-banner-text'),
    yesBtn: document.getElementById('fe-lsp-setup-banner-yes'),
    noBtn: document.getElementById('fe-lsp-setup-banner-no'),
  };

  const pyright = initPyrightModals({
    host,
    updatePreference,
    refreshModal: () => updateLspModalUI(getEditorViewState()),
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
  });

  const android = initAndroidModal({
    host,
    openFile,
    pickFile,
    pickDirectory,
    closeAllMenus,
  });

  const LSP_SERVER_PREF_KEYS = {
    pyright: 'enableLspPyright',
    typescript: 'enableLspTypescript',
    clangd: 'enableLspClangd',
    kotlin: 'enableLspKotlin',
    'kotlin-android': 'enableLspKotlinAndroid',
  };

  const LSP_SERVER_ROOTREL_KEYS = {
    pyright: 'lspRootRelPyright',
    typescript: 'lspRootRelTypescript',
    clangd: 'lspRootRelClangd',
    kotlin: 'lspRootRelKotlin',
    'kotlin-android': 'lspRootRelKotlinAndroid',
  };

  function _lspGetServerRootRel(state, serverId) {
    const key = LSP_SERVER_ROOTREL_KEYS[serverId];
    if (!key) return '';
    return String(state?.[key] ?? '');
  }

  window.__cm6LastLspStatus = window.__cm6LastLspStatus || null;
  let _lspSetupBannerTimer = null;
  const _lspSetupPromptedProjects = new Set();

  function _lspGetServerEnabled(state, serverId) {
    const key = LSP_SERVER_PREF_KEYS[serverId];
    if (!key) return true;
    return Boolean(state?.[key] ?? true);
  }

  function _setLastLspStatus(payload) {
    const servers = payload && payload.servers ? payload.servers : {};
    window.__cm6LastLspStatus = {
      servers: {
        pyright: { running: Boolean(servers?.pyright?.running) },
        typescript: { running: Boolean(servers?.typescript?.running) },
        clangd: { running: Boolean(servers?.clangd?.running) },
        kotlin: { running: Boolean(servers?.kotlin?.running) },
        'kotlin-android': { running: Boolean(servers?.['kotlin-android']?.running) },
      },
    };
  }

  function _deriveLspStatusFromCache(cache) {
    const isRunning = (payload) => payload && payload.status === 'running' && payload.pid;
    const byLang = cache && cache.data ? cache.data : {};
    return {
      servers: {
        pyright: { running: Boolean(isRunning(byLang.python)) },
        typescript: {
          running: Boolean(
            isRunning(byLang.typescript) ||
            isRunning(byLang.javascript) ||
            isRunning(byLang.typescriptreact) ||
            isRunning(byLang.javascriptreact),
          ),
        },
        clangd: { running: Boolean(isRunning(byLang.c) || isRunning(byLang.cpp)) },
        kotlin: { running: Boolean(isRunning(byLang.kotlin)) },
        'kotlin-android': { running: Boolean(isRunning(byLang['kotlin-android'])) },
      },
    };
  }

  function updateLspModalUI(state) {
    if (!lspModal.root) return;

    const isEnabled = Boolean(state?.enableLsp);
    const pyrightMode = pyright.getModeFromState(state);

    if (lspModal.globalToggleBtn) {
      lspModal.globalToggleBtn.textContent = isEnabled ? 'Disable' : 'Enable';
      lspModal.globalToggleBtn.classList.toggle('enabled', isEnabled);
    }

    const perServer = {
      pyright: _lspGetServerEnabled(state, 'pyright'),
      typescript: _lspGetServerEnabled(state, 'typescript'),
      clangd: _lspGetServerEnabled(state, 'clangd'),
      kotlin: _lspGetServerEnabled(state, 'kotlin'),
      'kotlin-android': _lspGetServerEnabled(state, 'kotlin-android'),
    };

    try {
      if (lspModal.rootRelPyright) {
        lspModal.rootRelPyright.value = _lspGetServerRootRel(state, 'pyright');
        lspModal.rootRelPyright.disabled = !isEnabled || pyrightMode !== 'root';
      }
      if (lspModal.rootRelTypescript) {
        lspModal.rootRelTypescript.value = _lspGetServerRootRel(state, 'typescript');
        lspModal.rootRelTypescript.disabled = !isEnabled;
      }
      if (lspModal.rootRelClangd) {
        lspModal.rootRelClangd.value = _lspGetServerRootRel(state, 'clangd');
        lspModal.rootRelClangd.disabled = !isEnabled;
      }
      if (lspModal.rootRelKotlin) {
        lspModal.rootRelKotlin.value = _lspGetServerRootRel(state, 'kotlin');
        lspModal.rootRelKotlin.disabled = !isEnabled;
      }
      if (lspModal.rootRelKotlinAndroid) {
        lspModal.rootRelKotlinAndroid.value = _lspGetServerRootRel(state, 'kotlin-android');
        lspModal.rootRelKotlinAndroid.disabled = !isEnabled;
      }
    } catch (err) {
      console.warn('[LSP Modal] Failed to apply rootrel inputs', err);
    }

    try {
      pyright.applyModeRadios({
        mode: pyrightMode,
        isEnabled,
        radioRoot: lspModal.pyrightModeRoot,
        radioWorkers: lspModal.pyrightModeWorkers,
      });
      pyright.applyModeUI({
        mode: pyrightMode,
        isEnabled,
        workersBtn: lspModal.pyrightWorkersBtn,
      });
    } catch (err) {
      console.warn('[LSP Modal] Failed to apply Pyright mode', err);
    }

    try {
      if (lspModal.variantKotlinAndroidBtn && lspModal.variantKotlinAndroidDD) {
        const variants = Array.isArray(state?.lspKotlinAndroidVariants) ? state.lspKotlinAndroidVariants : [];
        const selected = String(state?.lspKotlinAndroidVariant || '');
        const currentLabel = selected ? selected : '(auto)';

        if (lspModal.variantKotlinAndroidLabel) {
          lspModal.variantKotlinAndroidLabel.textContent = currentLabel;
        } else {
          lspModal.variantKotlinAndroidBtn.textContent = currentLabel;
        }

        lspModal.variantKotlinAndroidBtn.disabled = !isEnabled;

        const dd = lspModal.variantKotlinAndroidDD;
        dd.innerHTML = '';

        const addItem = (label, value) => {
          const item = document.createElement('div');
          item.className = 'fe-dd-item';
          item.setAttribute('data-checkable', 'true');
          item.dataset.value = String(value || '');
          item.textContent = label;
          const isActive = String(value || '') === selected;
          item.classList.toggle('fe-menu-item-checked', isActive);
          item.addEventListener('click', async (e) => {
            e.stopPropagation();
            dd.classList.remove('show');
            const v = String(item.dataset.value || '');
            const ok = await updatePreference('lspKotlinAndroidVariant', v);
            if (!ok) {
              host.toast('Failed to update kotlin-android variant');
              return;
            }
            updateLspModalUI(getEditorViewState());

            const btn = lspModal.syncKotlinAndroid;
            const originalText = btn ? btn.textContent : '';
            try {
              if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing...'; }
              const resp = await fetch('/api/app/file_editor_cm6/editor/android/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'variant_change' }),
              });
              const json = await resp.json();
              if (!json.ok) host.toast('Sync failed: ' + (json.error || 'unknown error'));
            } catch (err) {
              host.toast('Sync failed: ' + (err?.message || err));
            } finally {
              if (btn) { btn.disabled = false; btn.textContent = originalText || btn.textContent; }
            }
          });
          dd.appendChild(item);
        };

        addItem('(auto)', '');
        for (const v of variants) addItem(String(v), String(v));
      }
    } catch { }

    const applyRow = (serverId, enabled, dot, toggleBtn, startBtn) => {
      if (dot) {
        dot.classList.toggle('enabled', enabled);
        dot.classList.toggle('disabled', !enabled);
      }
      if (toggleBtn) {
        toggleBtn.textContent = enabled ? 'On' : 'Off';
        toggleBtn.classList.toggle('enabled', enabled);
        toggleBtn.disabled = !isEnabled;
      }
      if (startBtn) startBtn.disabled = false;
    };

    applyRow('pyright', perServer.pyright, lspModal.statusPyright, lspModal.togglePyright, lspModal.startPyright);
    applyRow('typescript', perServer.typescript, lspModal.statusTypescript, lspModal.toggleTypescript, lspModal.startTypescript);
    applyRow('clangd', perServer.clangd, lspModal.statusClangd, lspModal.toggleClangd, lspModal.startClangd);
    applyRow('kotlin', perServer.kotlin, lspModal.statusKotlin, lspModal.toggleKotlin, lspModal.startKotlin);
    applyRow('kotlin-android', perServer['kotlin-android'], lspModal.statusKotlinAndroid, lspModal.toggleKotlinAndroid, lspModal.startKotlinAndroid);

    _applyLspActionButtons(state);
  }

  async function _updateLspRootRel(serverId, value) {
    const key = LSP_SERVER_ROOTREL_KEYS[serverId];
    if (!key) return;
    const next = String(value ?? '').trim();
    const ok = await updatePreference(key, next);
    if (!ok) {
      host.toast('Failed to update LSP project root');
      return;
    }
    updateLspModalUI(getEditorViewState());
    host.toast('LSP project root updated (server will restart on next open/start)', 2500);
  }

  function _applyLspActionButtons(state) {
    if (!lspModal.root) return;

    const globalEnabled = Boolean(state?.enableLsp);
    const status = window.__cm6LastLspStatus && window.__cm6LastLspStatus.servers ? window.__cm6LastLspStatus : { servers: {} };

    const apply = (serverId, btn) => {
      if (!btn) return;
      const running = Boolean(status?.servers?.[serverId]?.running);
      if (!globalEnabled) {
        btn.classList.remove('fe-btn-danger');
        btn.textContent = running ? 'Running' : 'Start';
        btn.disabled = true;
        btn.dataset.lspAction = '';
        return;
      }
      if (running) {
        btn.textContent = 'Stop';
        btn.disabled = false;
        btn.dataset.lspAction = 'stop';
        btn.classList.add('fe-btn-danger');
        return;
      }

      const serverEnabled = _lspGetServerEnabled(state, serverId);
      const allowed = globalEnabled && serverEnabled;
      btn.classList.remove('fe-btn-danger');
      btn.textContent = 'Start';
      btn.disabled = !allowed;
      btn.dataset.lspAction = 'start';
    };

    apply('pyright', lspModal.startPyright);
    apply('typescript', lspModal.startTypescript);
    apply('clangd', lspModal.startClangd);
    apply('kotlin', lspModal.startKotlin);
    apply('kotlin-android', lspModal.startKotlinAndroid);
  }

  window.__cm6HandleLspStatus = (payload) => {
    try {
      _setLastLspStatus(payload || {});
      if (typeof getEditorViewState() === 'object' && getEditorViewState()) {
        _applyLspActionButtons(getEditorViewState());
      }
    } catch (err) {
      console.warn('[LSP Modal] Failed to apply lsp:status', err);
    }
  };

  window.__cm6HandleLspBusy = (payload) => {
    try {
      const spinner = document.getElementById('fe-lsp-spinner');
      if (!spinner) return;

      if (!window.__feLspSpinnerUi) {
        window.__feLspSpinnerUi = {
          lspShow: false,
          lspTitle: '',
          busyShow: false,
          busyTitle: '',
          busyLanguageId: '',
          busyActivity: '',
        };
      }
      const feSpinnerUi = window.__feLspSpinnerUi;

      if (!window.__cm6BusyUi) {
        window.__cm6BusyUi = {
          tasks: new Map(),
          lastHeadline: '',
          lastEndToastAt: 0,
        };
      }
      const busyUi = window.__cm6BusyUi;

      const languageId = payload && payload.languageId ? String(payload.languageId) : '';
      const activity = payload && payload.activity ? String(payload.activity) : '';
      const detail = payload && payload.detail ? String(payload.detail) : '';
      const isBusy = Boolean(payload && payload.busy);
      const taskId = payload && payload.taskId ? String(payload.taskId) : `${languageId || 'lsp'}|${activity || 'work'}`;

      const label = activity ? activity.replace(/_/g, ' ') : 'working';
      const headline = languageId ? `${languageId}: ${label}` : label;

      const recomputeSpinner = () => {
        const anyBusy = busyUi.tasks && typeof busyUi.tasks.size === 'number' ? busyUi.tasks.size > 0 : false;
        feSpinnerUi.busyShow = anyBusy;
        feSpinnerUi.busyTitle = anyBusy ? (busyUi.lastHeadline || feSpinnerUi.busyTitle) : '';
        if (typeof updateLspSpinner === 'function') updateLspSpinner();
      };

      if (isBusy) {
        const startedAtMs = payload && typeof payload.startedAtMs === 'number' ? payload.startedAtMs : Date.now();
        busyUi.lastHeadline = detail ? `${headline} — ${detail}` : headline;
        recomputeSpinner();

        if (!busyUi.tasks.has(taskId)) {
          const rec = {
            startTimer: null,
            startToastShown: false,
            startedAtMs,
            headline,
            detail,
            activity,
            languageId,
          };
          rec.startTimer = setTimeout(() => {
            const r2 = busyUi.tasks.get(taskId);
            if (!r2) return;
            if (r2.startToastShown) return;
            r2.startToastShown = true;
            host.toast(detail ? `${headline}…` : `${headline}…`, 2500);
          }, 650);
          busyUi.tasks.set(taskId, rec);
        }
        recomputeSpinner();
        return;
      }

      const ok = payload && typeof payload.ok === 'boolean' ? payload.ok : true;
      const error = payload && payload.error ? String(payload.error) : '';
      const durationMs = payload && typeof payload.durationMs === 'number' ? payload.durationMs : null;

      const rec = busyUi.tasks.get(taskId);
      if (rec && rec.startTimer) {
        clearTimeout(rec.startTimer);
        rec.startTimer = null;
      }
      if (rec) busyUi.tasks.delete(taskId);

      const now = Date.now();
      if (now - (busyUi.lastEndToastAt || 0) > 1200) {
        const startShown = Boolean(rec && rec.startToastShown);
        if (startShown) {
          const dur = durationMs != null ? ` (${Math.round(durationMs)}ms)` : '';
          if (!ok) host.toast(error ? `${headline} failed: ${error}${dur}` : `${headline} failed${dur}`, 4500);
          else host.toast(`${headline} done${dur}`, 1800);
          busyUi.lastEndToastAt = now;
        }
      }
      recomputeSpinner();
    } catch (err) {
      console.warn('[LSP Busy] handler failed', err);
    }
  };

  try {
    if (window.__cm6PendingLspStatus) {
      window.__cm6HandleLspStatus(window.__cm6PendingLspStatus);
      delete window.__cm6PendingLspStatus;
    }
  } catch (_) { }

  try {
    if (window.__cm6PendingLspBusy) {
      window.__cm6HandleLspBusy(window.__cm6PendingLspBusy);
      delete window.__cm6PendingLspBusy;
    }
  } catch (_) { }

  function hideLspModal() {
    if (!lspModal.root) return;
    lspModal.root.classList.remove('show');
    lspModal.root.setAttribute('aria-hidden', 'true');
  }

  async function showLspModal() {
    if (!lspModal.root) {
      host.toast('Language servers modal not available');
      return;
    }

    const state = await fetchEditorState();
    updateLspModalUI(state);

    try {
      if (typeof window.__explorerBusSend === 'function') {
        window.__explorerBusSend('lsp:status', { reason: 'modal_open' });
      } else {
        const cache = await apiGet('api/lsp/debug/cache');
        _setLastLspStatus(_deriveLspStatusFromCache(cache));
        _applyLspActionButtons(getEditorViewState());
      }
    } catch { }

    lspModal.root.classList.add('show');
    lspModal.root.setAttribute('aria-hidden', 'false');
  }

  if (lspModal.closeBtn) {
    lspModal.closeBtn.addEventListener('click', hideLspModal);
  }

  if (lspModal.root) {
    lspModal.root.addEventListener('click', (evt) => {
      if (evt.target === lspModal.root) hideLspModal();
    });
  }

  if (lspModal.globalToggleBtn) {
    lspModal.globalToggleBtn.addEventListener('click', async () => {
      const state = await fetchEditorState();
      const currentValue = state?.enableLsp ?? false;
      const newValue = !currentValue;

      try {
        const success = await updatePreference('enableLsp', newValue);
        if (success) {
          updateLspModalUI(getEditorViewState());
          host.toast(newValue ? 'LSP enabled - open a file to connect' : 'LSP disabled');
        } else {
          host.toast('Failed to update LSP preference');
        }
      } catch (err) {
        console.error('[LSP Modal] Toggle failed:', err);
        host.toast('Failed to toggle LSP');
      }
    });
  }

  async function _toggleLspServer(serverId) {
    const prefKey = LSP_SERVER_PREF_KEYS[serverId];
    if (!prefKey) return;
    const state = await fetchEditorState();
    const current = Boolean(state?.[prefKey] ?? true);
    const next = !current;
    const ok = await updatePreference(prefKey, next);
    if (!ok) {
      host.toast('Failed to update LSP server preference');
      return;
    }
    updateLspModalUI(getEditorViewState());
  }

  async function _startStopLspServer(serverId) {
    const status = window.__cm6LastLspStatus && window.__cm6LastLspStatus.servers ? window.__cm6LastLspStatus : { servers: {} };
    const isRunning = Boolean(status?.servers?.[serverId]?.running);
    const btnMap = {
      pyright: lspModal.startPyright,
      typescript: lspModal.startTypescript,
      clangd: lspModal.startClangd,
      kotlin: lspModal.startKotlin,
      'kotlin-android': lspModal.startKotlinAndroid,
    };
    const btn = btnMap[serverId];

    if (isRunning) {
      if (btn) { btn.disabled = true; btn.textContent = 'Stopping…'; }
      try {
        const resp = await apiPost('api/lsp/stop', { serverId });
        if (resp?.ok === false) host.toast(resp?.error || 'Failed to stop LSP');
        else host.toast(`Stopping ${serverId}…`, 1500);
      } catch (err) {
        console.error('[LSP Modal] stop failed:', err);
        host.toast(err?.message || 'Failed to stop LSP');
      }
    } else {
      const state = await fetchEditorState();
      if (!state?.enableLsp) {
        host.toast('Enable LSP first');
        updateLspModalUI(getEditorViewState());
        return;
      }
      const prefKey = LSP_SERVER_PREF_KEYS[serverId];
      if (prefKey && !(state?.[prefKey] ?? true)) {
        host.toast('This server is disabled');
        updateLspModalUI(getEditorViewState());
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
      try {
        const resp = await apiPost('api/lsp/start', { serverId });
        if (resp?.ok === false) host.toast(resp?.error || 'Failed to start LSP');
        else host.toast(`Starting ${serverId}…`, 1500);
      } catch (err) {
        console.error('[LSP Modal] start failed:', err);
        host.toast(err?.message || 'Failed to start LSP');
      }
    }

    try {
      const cache = await apiGet('api/lsp/debug/cache');
      _setLastLspStatus(_deriveLspStatusFromCache(cache));
    } catch { }
    if (typeof getEditorViewState() === 'object' && getEditorViewState()) {
      _applyLspActionButtons(getEditorViewState());
    }
  }

  if (lspModal.togglePyright) lspModal.togglePyright.addEventListener('click', () => _toggleLspServer('pyright'));
  if (lspModal.toggleTypescript) lspModal.toggleTypescript.addEventListener('click', () => _toggleLspServer('typescript'));
  if (lspModal.toggleClangd) lspModal.toggleClangd.addEventListener('click', () => _toggleLspServer('clangd'));
  if (lspModal.toggleKotlin) lspModal.toggleKotlin.addEventListener('click', () => _toggleLspServer('kotlin'));
  if (lspModal.toggleKotlinAndroid) lspModal.toggleKotlinAndroid.addEventListener('click', () => _toggleLspServer('kotlin-android'));

  if (lspModal.startPyright) lspModal.startPyright.addEventListener('click', () => _startStopLspServer('pyright'));
  if (lspModal.startTypescript) lspModal.startTypescript.addEventListener('click', () => _startStopLspServer('typescript'));
  if (lspModal.startClangd) lspModal.startClangd.addEventListener('click', () => _startStopLspServer('clangd'));
  if (lspModal.startKotlin) lspModal.startKotlin.addEventListener('click', () => _startStopLspServer('kotlin'));
  if (lspModal.startKotlinAndroid) lspModal.startKotlinAndroid.addEventListener('click', () => _startStopLspServer('kotlin-android'));

  if (lspModal.rootRelPyright) lspModal.rootRelPyright.addEventListener('change', (e) => _updateLspRootRel('pyright', e?.target?.value));
  if (lspModal.rootRelTypescript) lspModal.rootRelTypescript.addEventListener('change', (e) => _updateLspRootRel('typescript', e?.target?.value));
  if (lspModal.rootRelClangd) lspModal.rootRelClangd.addEventListener('change', (e) => _updateLspRootRel('clangd', e?.target?.value));
  if (lspModal.rootRelKotlin) lspModal.rootRelKotlin.addEventListener('change', (e) => _updateLspRootRel('kotlin', e?.target?.value));
  if (lspModal.rootRelKotlinAndroid) lspModal.rootRelKotlinAndroid.addEventListener('change', (e) => _updateLspRootRel('kotlin-android', e?.target?.value));

  pyright.bindControls(lspModal);
  android.bindControls(lspModal);

  if (lspModal.variantKotlinAndroidBtn && lspModal.variantKotlinAndroidDD) {
    lspModal.variantKotlinAndroidBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = lspModal.variantKotlinAndroidDD;
      const wasOpen = dd.classList.contains('show');
      closeAllMenus();
      if (!wasOpen) dd.classList.add('show');
    });
  }

  if (lspModal.syncKotlinAndroid) {
    lspModal.syncKotlinAndroid.addEventListener('click', async () => {
      const btn = lspModal.syncKotlinAndroid;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ Syncing...';
      try {
        const resp = await fetch('/api/app/file_editor_cm6/editor/android/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const json = await resp.json();
        if (json.ok) {
          host.toast('Project synced successfully');
        } else {
          host.toast('Sync failed: ' + (json.error || 'unknown error'));
        }
      } catch (e) {
        host.toast('Sync failed: ' + (e.message || e));
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }

  function _hideLspSetupBanner() {
    if (!lspSetupBanner.root) return;
    if (_lspSetupBannerTimer) {
      clearTimeout(_lspSetupBannerTimer);
      _lspSetupBannerTimer = null;
    }
    lspSetupBanner.root.classList.remove('show');
    lspSetupBanner.root.setAttribute('aria-hidden', 'true');
  }

  function _showLspSetupBanner(projectPath) {
    if (!lspSetupBanner.root) return;
    const key = String(projectPath || '');
    if (!key) return;
    if (_lspSetupPromptedProjects.has(key)) return;
    _lspSetupPromptedProjects.add(key);

    if (lspSetupBanner.text) {
      const label = basename(key) || key;
      lspSetupBanner.text.textContent =
        `Project \"${label}\" is new. Configure Language Servers (LSP) for sticky scroll scopes and future diagnostics?`;
    }

    lspSetupBanner.root.classList.add('show');
    lspSetupBanner.root.setAttribute('aria-hidden', 'false');

    if (_lspSetupBannerTimer) clearTimeout(_lspSetupBannerTimer);
    _lspSetupBannerTimer = setTimeout(() => _hideLspSetupBanner(), 20000);
  }

  window.__cm6PromptLspSetup = (arg) => {
    try {
      const projectPath =
        typeof arg === 'string'
          ? arg
          : arg && typeof arg.projectPath === 'string'
            ? arg.projectPath
            : '';
      if (projectPath) _showLspSetupBanner(projectPath);
    } catch (_) { }
  };

  if (lspSetupBanner.noBtn) lspSetupBanner.noBtn.addEventListener('click', _hideLspSetupBanner);
  if (lspSetupBanner.yesBtn) {
    lspSetupBanner.yesBtn.addEventListener('click', async () => {
      _hideLspSetupBanner();
      await showLspModal();
    });
  }

  try {
    if (window.__cm6PendingLspSetupPrompt) {
      window.__cm6PromptLspSetup(window.__cm6PendingLspSetupPrompt);
      delete window.__cm6PendingLspSetupPrompt;
    }
  } catch (_) { }

  function _closeLspMenus() {
    if (lspModal.variantKotlinAndroidDD) {
      lspModal.variantKotlinAndroidDD.classList.remove('show');
    }
    try {
      pyright.closeMenus();
    } catch (_) { }
    try {
      android.closeMenus();
    } catch (_) { }
  }

  window.__cm6CloseLspMenus = _closeLspMenus;

  return {
    showLspModal,
  };
}
