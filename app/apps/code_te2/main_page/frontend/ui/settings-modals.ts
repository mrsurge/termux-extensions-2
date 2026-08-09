// @ts-check

/**
 * @param {{
 *   settingsModalEl: HTMLElement,
 *   settingsCloseEl: HTMLElement,
 *   settingsConsoleWorkerIdEl: HTMLElement,
 *   menuEditorSettingsEl: HTMLElement,
 *   extManagerModalEl: HTMLElement,
 *   extManagerCloseEl: HTMLElement,
 *   settingsExtStripEl: HTMLElement,
 *   closeAllMenus: () => void,
 *   refreshEditorSettingsModal: () => Promise<any> | void,
 *   refreshEditorExtManagerModal: () => Promise<any> | void,
 *   loadCustomSettings: () => Promise<any> | void,
 *   getConsoleWorkerId: () => string | null,
 * }} deps
 */
export function createSettingsModalsController(deps: any) {
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
    refreshConsoleWorkerId();
  }

  return {
    openEditorSettingsModal,
    closeEditorSettingsModal,
    openEditorExtManagerModal,
    closeEditorExtManagerModal,
    install,
  };
}
