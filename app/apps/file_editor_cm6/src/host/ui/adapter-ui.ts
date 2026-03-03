// @ts-nocheck

/**
 * @param {{
 *   closeAllMenus: () => void,
 *   spinnerSetStep: (msg: string) => void,
 *   ensureWorkbenchAdapterReady: () => void | Promise<void>,
 *   setWorkbenchAdapterState: (next: { readyOk: boolean, connecting: any }) => void,
 *   toast: (msg: string, ms?: number) => void
 * }} deps
 */
export function createAdapterUiController(deps) {
  function closeAdapterDropdown() {
    const dd = document.getElementById('fe-adapter-dd');
    if (dd) dd.classList.remove('show');
  }

  function openAdapterDropdown() {
    const dd = document.getElementById('fe-adapter-dd');
    if (!dd) return;
    try { deps.closeAllMenus(); } catch (_) {}
    dd.innerHTML = '';
    const item = document.createElement('div');
    item.className = 'fe-dd-item';
    item.textContent = 'Reload Extension Adapter';
    item.addEventListener('click', () => {
      closeAdapterDropdown();
      requestAdapterRestart();
    });
    dd.appendChild(item);
    dd.classList.add('show');
  }

  async function requestAdapterRestart() {
    try {
      if (typeof window.__explorerBusRequest !== 'function') return;
      deps.spinnerSetStep('Restarting adapter…');
      await window.__explorerBusRequest('ext:restart_adapter', {}, 15000);
      reloadEditorIframe();
    } catch (e) {
      console.warn('[adapter_restart] request failed:', e);
    }
  }

  function reloadEditorIframe() {
    window.__adapterConnected = false;
    deps.setWorkbenchAdapterState({ readyOk: false, connecting: null });
    deps.spinnerSetStep('Reloading editor…');
    setTimeout(() => {
      try {
        const iframe = document.getElementById('editor-frame');
        if (iframe) { const frameAny = /** @type {any} */ (iframe); frameAny.src = frameAny.src; }
      } catch (_) {}
      setTimeout(() => {
        try { deps.ensureWorkbenchAdapterReady(); } catch (_) {}
      }, 2000);
    }, 1500);
  }

  function setSpinnerClass(el, cls) {
    el.classList.remove('fe-lsp-spinner', 'fe-lsp-status--ok', 'fe-lsp-status--error', 'fe-lsp-status--busy');
    el.classList.add(cls);
    el.style.display = 'inline-block';
  }

  function updateLspSpinner() {
    try {
      const spinner = document.getElementById('fe-lsp-spinner');
      if (!spinner) return;

      if (!window.__feLspSpinnerUi) {
        window.__feLspSpinnerUi = {
          lspShow: false, lspTitle: '', busyShow: false, busyTitle: '', busyLanguageId: '', busyActivity: '',
        };
      }
      const ui = window.__feLspSpinnerUi;
      const anyBusy = Boolean(ui.lspShow || ui.busyShow);
      const title = ui.busyShow ? (ui.busyTitle || ui.lspTitle) : ui.lspTitle;

      const MIN_VISIBLE_MS = 650;
      const now = Date.now();
      if (!window.__feLspSpinnerState) window.__feLspSpinnerState = { shownAtMs: 0, hideTimer: null };
      const st = window.__feLspSpinnerState;

      if (anyBusy) {
        if (st.hideTimer) {
          clearTimeout(st.hideTimer);
          st.hideTimer = null;
        }
        setSpinnerClass(spinner, 'fe-lsp-status--busy');
        spinner.title = title || 'Working…';
        st.shownAtMs = now;
        return;
      }

      const elapsed = now - (st.shownAtMs || 0);
      const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
      const applyIdle = () => {
        try {
          st.hideTimer = null;
          const statusClass = window.__adapterConnected ? 'fe-lsp-status--ok' : 'fe-lsp-status--error';
          const statusTitle = window.__adapterConnected ? 'Adapter connected' : 'Adapter disconnected';
          setSpinnerClass(spinner, statusClass);
          spinner.title = statusTitle;
        } catch { }
      };
      if (wait > 0) {
        if (st.hideTimer) return;
        st.hideTimer = setTimeout(applyIdle, wait);
        return;
      }
      applyIdle();
    } catch { }
  }

  function handleLspStatusUpdate(args = {}) {
    const { show, languageId, state, payload } = /** @type {any} */ (args);
    try {
      if (!window.__feLspSpinnerUi) {
        window.__feLspSpinnerUi = {
          lspShow: false, lspTitle: '', busyShow: false, busyTitle: '', busyLanguageId: '', busyActivity: '',
        };
      }
      const feSpinnerUi = window.__feLspSpinnerUi;
      feSpinnerUi.lspShow = Boolean(show);

      let title = 'Language server';
      if (languageId) title += ` (${languageId})`;
      if (state) title += `: ${state}`;
      if (payload && payload.error) title += ` — ${payload.error}`;
      feSpinnerUi.lspTitle = title;
      updateLspSpinner();

      try {
        if (!window.__cm6LspUi) {
          window.__cm6LspUi = {
            activeLang: '', activeAttempt: 0, loadingToastTimer: null, loadingToastShown: false, lastReadyToastAt: 0,
          };
        }
        const ui = window.__cm6LspUi;
        const langLabel = languageId ? `${languageId} LSP` : 'Language server';
        const bumpAttempt = () => {
          ui.activeAttempt = (ui.activeAttempt || 0) + 1;
          return ui.activeAttempt;
        };

        if (state === 'connecting' || (show && languageId && ui.activeLang && ui.activeLang !== languageId)) {
          ui.activeLang = languageId;
          ui.loadingToastShown = false;
          if (ui.loadingToastTimer) clearTimeout(ui.loadingToastTimer);
          const attemptId = bumpAttempt();
          ui.loadingToastTimer = setTimeout(() => {
            if (ui.activeAttempt !== attemptId) return;
            if (!feSpinnerUi || !feSpinnerUi.lspShow) return;
            if (ui.loadingToastShown) return;
            ui.loadingToastShown = true;
            deps.toast(`Loading ${langLabel}…`, 2500);
          }, 650);
        }

        if (state === 'ready') {
          if (ui.loadingToastTimer) {
            clearTimeout(ui.loadingToastTimer);
            ui.loadingToastTimer = null;
          }
          const now = Date.now();
          if (now - (ui.lastReadyToastAt || 0) > 1500) {
            if (ui.loadingToastShown || ui.activeLang === 'kotlin') {
              deps.toast(`${langLabel} loaded`, 1800);
              ui.lastReadyToastAt = now;
            }
          }
          ui.loadingToastShown = false;
        }

        if (state === 'disconnected' || state === 'error') {
          if (ui.loadingToastTimer) {
            clearTimeout(ui.loadingToastTimer);
            ui.loadingToastTimer = null;
          }
          ui.loadingToastShown = false;
        }

        if (state === 'error') {
          const msg = payload && payload.error ? String(payload.error) : `${langLabel} failed to initialize`;
          deps.toast(msg, 4500);
        }
      } catch { }
    } catch { }
  }

  function installLspStatusHandler() {
    window.__cm6HandleLspStatusUpdate = handleLspStatusUpdate;
  }

  return {
    closeAdapterDropdown,
    openAdapterDropdown,
    requestAdapterRestart,
    reloadEditorIframe,
    updateLspSpinner,
    handleLspStatusUpdate,
    installLspStatusHandler,
  };
}
