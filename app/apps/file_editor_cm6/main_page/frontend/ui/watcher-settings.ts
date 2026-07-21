
import { EXPLORER_RPC_METHODS } from '../../../src/explorer/rpc/contract.ts';
import { notifyExplorerRpc } from '../../../src/explorer/rpc/client.ts';

// ---------- Watcher modal & settings UI ----------
// Extracted from main.js. Requires `host.toast` via init().

type WatcherMode = 'ipc' | 'watchexec' | 'none';

interface WatcherConfig {
  mode: WatcherMode;
  storage_type: string;
  poll_interval_ms: number;
  watchexec_available: boolean;
}

interface WatcherLimitModalController {
  root: HTMLDivElement;
  messageEl: HTMLElement;
  passwordEl: HTMLInputElement;
  confirmBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  closeBtn: HTMLButtonElement;
}

interface WatcherErrorPayload {
  message?: string;
  limit?: number;
}

interface WatcherRaisePayload {
  ok?: boolean;
  stdout?: string;
  stderr?: string;
}

let _toast = (_msg: string) => {};

// ── Watcher limit warning modal ──

let watcherModalController: WatcherLimitModalController | null = null;

function ensureWatcherLimitModal() {
  if (watcherModalController) return watcherModalController;
  const modal = document.createElement('div');
  modal.id = 'fe-watcher-modal';
  modal.className = 'fe-modal';
  modal.dataset.teDialogSurface = 'code-te2.watcher-limit';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="fe-modal-card" style="max-width: 520px;">
      <div class="fe-modal-header">
        <strong>File watcher limit reached</strong>
        <span style="flex:1"></span>
        <button class="fe-btn" id="fe-watcher-close" aria-label="Close">✕</button>
      </div>
      <div class="fe-modal-body">
        <div id="fe-watcher-message" style="font-size:0.9rem; line-height:1.5;"></div>
        <div style="margin-top: 10px;">
          <label style="display:block; font-size: 12px; opacity: 0.85; margin-bottom: 6px;">Sudo password (optional)</label>
          <input id="fe-watcher-password" type="password" placeholder="Leave blank if sudo has no password" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--fe-border, #2c333b); background: var(--fe-panel, #0f141a); color: inherit;" />
        </div>
        <p style="margin-top:10px; font-size:12px; opacity:0.8;">
          This will run: <code>sudo sysctl -w fs.inotify.max_user_watches=524288</code>
        </p>
      </div>
      <div class="fe-modal-actions">
        <button class="fe-btn fe-btn-primary" id="fe-watcher-confirm">Raise limit</button>
        <button class="fe-btn" id="fe-watcher-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  watcherModalController = {
    root: modal,
    messageEl: modal.querySelector<HTMLElement>('#fe-watcher-message')!,
    passwordEl: modal.querySelector<HTMLInputElement>('#fe-watcher-password')!,
    confirmBtn: modal.querySelector<HTMLButtonElement>('#fe-watcher-confirm')!,
    cancelBtn: modal.querySelector<HTMLButtonElement>('#fe-watcher-cancel')!,
    closeBtn: modal.querySelector<HTMLButtonElement>('#fe-watcher-close')!,
  };
  watcherModalController.closeBtn.addEventListener('click', () => hideWatcherLimitModal());
  watcherModalController.cancelBtn.addEventListener('click', () => hideWatcherLimitModal());
  watcherModalController.root.addEventListener('click', (evt) => {
    if (evt.target === modal) {
      hideWatcherLimitModal();
    }
  });
  return watcherModalController;
}

function hideWatcherLimitModal() {
  if (!watcherModalController) return;
  watcherModalController.root.classList.remove('show');
  watcherModalController.root.setAttribute('aria-hidden', 'true');
}

export function showWatcherLimitModal(message: string, limit?: number) {
  const modal = ensureWatcherLimitModal();
  modal.messageEl.textContent = message || 'File watcher limit reached. Attempt to raise now?';
  modal.passwordEl.value = '';
  modal.root.classList.add('show');
  modal.root.setAttribute('aria-hidden', 'false');

  modal.confirmBtn.onclick = () => {
    const pwd = modal.passwordEl.value || '';
    const sent = notifyExplorerRpc(EXPLORER_RPC_METHODS.watcherLimitRaise, {
      limit: typeof limit === 'number' ? limit : 524288,
      password: pwd,
    });
    if (!sent) {
      _toast('Explorer transport not available');
    }
    hideWatcherLimitModal();
  };
}

// ── Watcher settings UI (integrated into editor-settings-modal) ──

let _watcherConfig: WatcherConfig = { mode: 'ipc', storage_type: 'ssd', poll_interval_ms: 1500, watchexec_available: false };

function _initWatcherSettingsUI() {
  const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="watcher-mode"]');
  const storageRadios = document.querySelectorAll<HTMLInputElement>('input[name="watcher-storage"]');
  const watchexecOpts = document.getElementById('watcher-watchexec-opts');
  const raiseBtn = document.getElementById('watcher-raise-btn');

  modeRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (watchexecOpts) {
        watchexecOpts.style.display = r.value === 'watchexec' && r.checked ? 'block' : '';
        if (r.value !== 'watchexec') watchexecOpts.style.display = 'none';
      }
      if (r.checked) _sendWatcherMode(r.value);
    });
  });

  storageRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) {
        const modeEl = document.querySelector<HTMLInputElement>('input[name="watcher-mode"]:checked');
        if (modeEl) _sendWatcherMode(modeEl.value);
      }
    });
  });

  if (raiseBtn) {
    raiseBtn.addEventListener('click', () => {
      showWatcherLimitModal('Raise the inotify watch limit?', 524288);
    });
  }
}

function _sendWatcherMode(mode: WatcherMode | string) {
  const storageEl = document.querySelector<HTMLInputElement>('input[name="watcher-storage"]:checked');
  const storageType = storageEl ? storageEl.value : 'ssd';
  notifyExplorerRpc(EXPLORER_RPC_METHODS.watcherModeSet, { mode, storage_type: storageType });
}

function coerceWatcherMode(mode: unknown): WatcherMode {
  return mode === 'watchexec' || mode === 'none' ? mode : 'ipc';
}

function _applyWatcherConfig(cfg: Partial<WatcherConfig> & Record<string, unknown>) {
  _watcherConfig = { ..._watcherConfig, ...cfg };
  const mode = coerceWatcherMode(cfg.mode);

  const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="watcher-mode"]');
  modeRadios.forEach(r => { r.checked = r.value === mode; });

  const storageRadios = document.querySelectorAll<HTMLInputElement>('input[name="watcher-storage"]');
  storageRadios.forEach(r => { r.checked = r.value === cfg.storage_type; });

  const watchexecOpts = document.getElementById('watcher-watchexec-opts');
  if (watchexecOpts) watchexecOpts.style.display = cfg.mode === 'watchexec' ? 'block' : 'none';

  const watchexecRadio = document.querySelector<HTMLInputElement>('input[name="watcher-mode"][value="watchexec"]');
  const watchexecLabel = document.getElementById('watcher-mode-watchexec-label');
  if (watchexecRadio && !cfg.watchexec_available) {
    watchexecRadio.disabled = true;
    if (watchexecLabel) watchexecLabel.style.opacity = '0.4';
  } else if (watchexecRadio) {
    watchexecRadio.disabled = false;
    if (watchexecLabel) watchexecLabel.style.opacity = '';
  }

  _updateWatcherStatusIndicator(mode);
}

function _updateWatcherStatusIndicator(mode: WatcherMode | string) {
  const indicator = document.getElementById('watcher-status-indicator');
  if (indicator) {
    const labels = { ipc: 'VS Code IPC', watchexec: 'watchexec poll', none: 'None (manual)' };
    indicator.textContent = `Active: ${labels[coerceWatcherMode(mode)] || mode}`;
  }
}

/**
 * Call once after DOM ready to wire up the watcher settings UI and
 * register the global window handlers used by the explorer socket.
 * @param {{ toast?: (msg: string) => void, host?: { toast?: (msg: string) => void } }} hostOrContext
 */
export function initWatcherUI(hostOrContext: any) {
  _toast =
    hostOrContext?.toast ||
    hostOrContext?.host?.toast ||
    _toast;

  // Wire the settings panel radios/buttons
  try { _initWatcherSettingsUI(); } catch (_) {}

  // Global handlers called by explorer socket events
  window.__cm6HandleWatcherConfig = (cfg: Partial<WatcherConfig> & Record<string, unknown>) => { _applyWatcherConfig(cfg); };

  window.__cm6HandleWatcherModeStatus = (status: Partial<WatcherConfig> & { active?: boolean }) => {
    if (status && status.mode) {
      _applyWatcherConfig(status);
      if (status.active === false) {
        _toast('Failed to activate watcher mode');
      }
    }
  };

  window.__cm6HandleWatcherError = (payload: WatcherErrorPayload | null) => {
    const msg = payload && payload.message ? payload.message : null;
    const limit = payload && typeof payload.limit === 'number' ? payload.limit : 524288;
    const warning = msg
      ? `${msg}\n\nAttempt to raise the limit now?`
      : 'File watcher limit reached. Attempt to raise now?';
    showWatcherLimitModal(warning, limit);
  };

  window.__cm6HandleWatcherRaiseResult = (payload: WatcherRaisePayload | null) => {
    if (!payload) return;
    const statusEl = document.getElementById('watcher-raise-status');
    if (payload.ok) {
      _toast(payload.stdout || 'Watcher limit updated — IPC watcher resubscribed');
      if (statusEl) statusEl.textContent = '✓ Limit raised successfully';
      _updateWatcherStatusIndicator('ipc');
    } else {
      const err = payload.stderr || payload.stdout || 'Failed to raise watcher limit';
      _toast(err);
      if (statusEl) statusEl.textContent = `✗ ${err}`;
    }
  };
}

/**
 * Drain any watcher events that arrived before this module was initialised.
 * Call after initWatcherUI().
 */
export function drainPendingWatcherEvents() {
  try {
    if (window.__cm6PendingWatcherError) {
      window.__cm6HandleWatcherError(window.__cm6PendingWatcherError);
      window.__cm6PendingWatcherError = null;
    }
    if (window.__cm6PendingWatcherRaiseResult) {
      window.__cm6HandleWatcherRaiseResult(window.__cm6PendingWatcherRaiseResult);
      window.__cm6PendingWatcherRaiseResult = null;
    }
  } catch (_) {}
}
