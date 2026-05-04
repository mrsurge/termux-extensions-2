// @ts-check

interface AutosaveModalController {
  root: HTMLDivElement;
  messageEl: HTMLElement;
  confirmBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  closeBtn: HTMLButtonElement;
}

export function createAutosaveModalController() {
  let autosaveModalController: AutosaveModalController | null = null;
  let autosaveModalResolve: ((result: boolean) => void) | null = null;

  function hideAutosaveModal(result: boolean) {
    if (!autosaveModalController) return;
    autosaveModalController.root.classList.remove('show');
    autosaveModalController.root.setAttribute('aria-hidden', 'true');
    const resolver = autosaveModalResolve;
    autosaveModalResolve = null;
    if (resolver) resolver(result);
  }

  function ensureAutosaveModal() {
    if (autosaveModalController) return autosaveModalController;
    const modal = document.createElement('div');
    modal.id = 'fe-autosave-modal';
    modal.className = 'fe-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
    <div class="fe-modal-card" style="max-width: 460px;">
      <div class="fe-modal-header">
        <strong>Enable Autosave?</strong>
        <span style="flex:1"></span>
        <button class="fe-btn" id="fe-autosave-close" aria-label="Close">✕</button>
      </div>
      <div class="fe-modal-body">
        <p id="fe-autosave-message" style="margin:0; line-height:1.5;"></p>
      </div>
      <div class="fe-modal-actions">
        <button class="fe-btn" id="fe-autosave-cancel">Cancel</button>
        <button class="fe-btn fe-btn-primary" id="fe-autosave-confirm">Enable Autosave</button>
      </div>
    </div>
  `;
    document.body.appendChild(modal);
    autosaveModalController = {
      root: modal,
      messageEl: modal.querySelector<HTMLElement>('#fe-autosave-message')!,
      confirmBtn: modal.querySelector<HTMLButtonElement>('#fe-autosave-confirm')!,
      cancelBtn: modal.querySelector<HTMLButtonElement>('#fe-autosave-cancel')!,
      closeBtn: modal.querySelector<HTMLButtonElement>('#fe-autosave-close')!,
    };
    autosaveModalController.closeBtn.addEventListener('click', () => hideAutosaveModal(false));
    autosaveModalController.root.addEventListener('click', (evt) => {
      if (evt.target === modal) hideAutosaveModal(false);
    });
    return autosaveModalController;
  }

  function showAutosaveModal(fileLabel: string, hasOtherDrafts: boolean) {
    const modal = ensureAutosaveModal();
    const safeLabel = fileLabel ? `“${fileLabel}”` : 'this document';
    const tail = hasOtherDrafts
      ? 'Any other unsaved drafts in different files will be discarded when autosave is on.'
      : 'Autosave will overwrite the current document and discard draft caches for other files.';
    modal.messageEl.textContent = `Enabling autosave will immediately save ${safeLabel}. ${tail} Continue?`;
    modal.root.classList.add('show');
    modal.root.setAttribute('aria-hidden', 'false');
    return new Promise((resolve) => {
      autosaveModalResolve = resolve;
      modal.confirmBtn.onclick = () => hideAutosaveModal(true);
      modal.cancelBtn.onclick = () => hideAutosaveModal(false);
    });
  }

  return { showAutosaveModal };
}
