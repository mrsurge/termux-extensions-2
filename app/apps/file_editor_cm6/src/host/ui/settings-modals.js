// @ts-check

/**
 * @param {{
 *   settingsModalEl: HTMLElement,
 *   settingsCloseEl: HTMLElement,
 *   menuEditorSettingsEl: HTMLElement,
 *   extManagerModalEl: HTMLElement,
 *   extManagerCloseEl: HTMLElement,
 *   settingsExtStripEl: HTMLElement,
 *   closeAllMenus: () => void,
 *   refreshEditorSettingsModal: () => Promise<any> | void,
 *   refreshEditorExtManagerModal: () => Promise<any> | void,
 *   loadCustomSettings: () => Promise<any> | void,
 * }} deps
 */
export function createSettingsModalsController(deps) {
  function openEditorSettingsModal() {
    deps.settingsModalEl.classList.add('show');
    deps.settingsModalEl.setAttribute('aria-hidden', 'false');
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
    deps.settingsModalEl.addEventListener('click', (ev) => {
      if (ev.target === deps.settingsModalEl) closeEditorSettingsModal();
    });
    deps.menuEditorSettingsEl.addEventListener('click', () => {
      deps.closeAllMenus();
      openEditorSettingsModal();
    });

    deps.extManagerCloseEl.addEventListener('click', closeEditorExtManagerModal);
    deps.extManagerModalEl.addEventListener('click', (ev) => {
      if (ev.target === deps.extManagerModalEl) closeEditorExtManagerModal();
    });
    deps.settingsExtStripEl.addEventListener('click', () => {
      openEditorExtManagerModal();
    });
  }

  return {
    openEditorSettingsModal,
    closeEditorSettingsModal,
    openEditorExtManagerModal,
    closeEditorExtManagerModal,
    install,
  };
}
