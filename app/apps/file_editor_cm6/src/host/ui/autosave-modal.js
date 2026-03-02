// @ts-check

export function createAutosaveModalController() {
  let autosaveModalController = null;
  let autosaveModalResolve = null;

  function hideAutosaveModal(result) {
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
      messageEl: modal.querySelector('#fe-autosave-message'),
      confirmBtn: modal.querySelector('#fe-autosave-confirm'),
      cancelBtn: modal.querySelector('#fe-autosave-cancel'),
      closeBtn: modal.querySelector('#fe-autosave-close'),
    };
    autosaveModalController.closeBtn.addEventListener('click', () => hideAutosaveModal(false));
    autosaveModalController.root.addEventListener('click', (evt) => {
      if (evt.target === autosaveModalController.root) hideAutosaveModal(false);
    });
    return autosaveModalController;
  }

  function showAutosaveModal(fileLabel, hasOtherDrafts) {
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
