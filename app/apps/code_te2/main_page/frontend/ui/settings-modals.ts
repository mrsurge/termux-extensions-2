// @ts-check

/**
 * @param {{
 *   settingsModalEl: HTMLElement,
 *   settingsCloseEl: HTMLElement,
 *   settingsConsoleWorkerIdEl: HTMLElement,
 *   settingsClientIdentityEl: HTMLElement,
 *   settingsClientCopyEl: HTMLButtonElement,
 *   settingsClientResetEl: HTMLButtonElement,
 *   menuEditorSettingsEl: HTMLElement,
 *   extManagerModalEl: HTMLElement,
 *   extManagerCloseEl: HTMLElement,
 *   settingsExtStripEl: HTMLElement,
 *   closeAllMenus: () => void,
 *   refreshEditorSettingsModal: () => Promise<any> | void,
 *   refreshEditorExtManagerModal: () => Promise<any> | void,
 *   loadCustomSettings: () => Promise<any> | void,
 *   getConsoleWorkerId: () => string | null,
 *   getClientIdentity: () => {clientInstanceId: string, provider: string, label: string},
 *   resetClientIdentity: () => Promise<void>,
 *   toast: (message: string, timeoutMs?: number) => void,
 * }} deps
 */
export function createSettingsModalsController(deps: any) {
  let identityResetPending = false;

  function refreshClientIdentity() {
    const identity = deps.getClientIdentity();
    deps.settingsClientIdentityEl.textContent = `${identity.label}: ${identity.clientInstanceId}`;
    deps.settingsClientIdentityEl.title = `${identity.provider} client identity: ${identity.clientInstanceId}`;
  }

  function refreshConsoleWorkerId() {
    const el = deps.settingsConsoleWorkerIdEl;
    if (!el) return;
    const workerId = deps.getConsoleWorkerId?.();
    if (typeof workerId === 'string' && workerId.trim()) {
      const value = workerId.trim();
      el.textContent = `main_page console: ${value}`;
      el.title = `TE2 console worker id: ${value}`;
      el.dataset.state = 'ready';
      return;
    }
    el.textContent = 'main_page console: pending';
    el.title = 'TE2 console worker id has not registered yet';
    el.dataset.state = 'pending';
  }

  function openEditorSettingsModal() {
    deps.settingsModalEl.classList.add('show');
    deps.settingsModalEl.setAttribute('aria-hidden', 'false');
    refreshConsoleWorkerId();
    refreshClientIdentity();
    void deps.refreshEditorSettingsModal();
  }

  function closeEditorSettingsModal() {
    deps.settingsModalEl.classList.remove('show');
    deps.settingsModalEl.setAttribute('aria-hidden', 'true');
  }

  function openEditorExtManagerModal() {
    deps.extManagerModalEl.classList.add('show');
    deps.extManagerModalEl.setAttribute('aria-hidden', 'false');
    void deps.refreshEditorExtManagerModal();
    void deps.loadCustomSettings();
  }

  function closeEditorExtManagerModal() {
    deps.extManagerModalEl.classList.remove('show');
    deps.extManagerModalEl.setAttribute('aria-hidden', 'true');
  }

  function install() {
    deps.settingsCloseEl.addEventListener('click', closeEditorSettingsModal);
    deps.settingsModalEl.addEventListener('click', (ev: MouseEvent) => {
      if (ev.target === deps.settingsModalEl) closeEditorSettingsModal();
    });
    deps.menuEditorSettingsEl.addEventListener('click', () => {
      deps.closeAllMenus();
      openEditorSettingsModal();
    });

    deps.extManagerCloseEl.addEventListener('click', closeEditorExtManagerModal);
    deps.extManagerModalEl.addEventListener('click', (ev: MouseEvent) => {
      if (ev.target === deps.extManagerModalEl) closeEditorExtManagerModal();
    });
    deps.settingsExtStripEl.addEventListener('click', () => {
      openEditorExtManagerModal();
    });
    window.addEventListener('te2:console-bridge-status', refreshConsoleWorkerId);
    deps.settingsClientCopyEl.addEventListener('click', () => {
      const identity = deps.getClientIdentity();
      void navigator.clipboard.writeText(identity.clientInstanceId)
        .then(() => deps.toast('Client identity copied', 1800))
        .catch((error: unknown) => deps.toast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, 3500));
    });
    deps.settingsClientResetEl.addEventListener('click', () => {
      if (identityResetPending) return;
      void window.teUI.dialog.confirm(
        'Reset this client identity and delete its saved extension-view reconstruction state? The editor will reload.',
      ).then(async (confirmed: boolean) => {
        if (!confirmed || identityResetPending) return;
        identityResetPending = true;
        deps.settingsClientResetEl.disabled = true;
        try {
          await deps.resetClientIdentity();
        } catch (error) {
          identityResetPending = false;
          deps.settingsClientResetEl.disabled = false;
          deps.toast(`Client identity reset failed: ${error instanceof Error ? error.message : String(error)}`, 5000);
        }
      });
    });
    refreshConsoleWorkerId();
    refreshClientIdentity();
  }

  return {
    openEditorSettingsModal,
    closeEditorSettingsModal,
    openEditorExtManagerModal,
    closeEditorExtManagerModal,
    install,
  };
}
