type CodexAgentModuleApi = {
  helpers: Record<string, unknown>;
  state: Record<string, unknown>;
};

type WarningOptions = {
  title?: string;
  body?: string;
  confirmText?: string;
  secondaryText?: string;
  onConfirm?: () => Promise<unknown> | unknown;
  onSecondary?: () => Promise<unknown> | unknown;
  onCancel?: () => void;
};

declare global {
  interface Window {
    CodexAgentModules?: Array<(ctx: CodexAgentModuleApi | undefined) => void>;
  }
}

window.CodexAgentModules = window.CodexAgentModules || [];
window.CodexAgentModules.push((ctx: CodexAgentModuleApi | undefined) => {
  const modalEl = document.getElementById('warning-modal');
  const closeBtn = document.getElementById('warning-close');
  const cancelBtn = document.getElementById('warning-cancel');
  const confirmBtn = document.getElementById('warning-confirm');
  const bodyEl = document.getElementById('warning-body');
  const titleEl = modalEl?.querySelector('h3');
  const secondaryBtn = document.createElement('button');
  secondaryBtn.type = 'button';
  secondaryBtn.className = 'btn ghost';
  secondaryBtn.hidden = true;
  confirmBtn?.before(secondaryBtn);

  let onConfirm: (() => Promise<unknown> | unknown) | null = null;
  let onCancel: (() => void) | null = null;
  let onSecondary: (() => Promise<unknown> | unknown) | null = null;

  function close(reason = 'cancel'): void {
    if (!modalEl) return;
    modalEl.classList.add('hidden');
    const cancelHandler = reason === 'confirm' || reason === 'secondary' ? null : onCancel;
    onConfirm = null;
    onSecondary = null;
    onCancel = null;
    if (typeof cancelHandler === 'function') cancelHandler();
  }

  function open(opts: WarningOptions = {}): void {
    if (!modalEl) return;
    if (!modalEl.classList.contains('hidden')) close();
    if (titleEl) titleEl.textContent = opts.title || 'Confirm';
    if (bodyEl) bodyEl.textContent = opts.body || '';
    if (confirmBtn) confirmBtn.textContent = opts.confirmText || 'Continue';
    secondaryBtn.textContent = opts.secondaryText || '';
    secondaryBtn.hidden = !opts.secondaryText || typeof opts.onSecondary !== 'function';
    onConfirm = typeof opts?.onConfirm === 'function' ? opts.onConfirm : null;
    onSecondary = typeof opts.onSecondary === 'function' ? opts.onSecondary : null;
    onCancel = typeof opts?.onCancel === 'function' ? opts.onCancel : null;
    modalEl.classList.remove('hidden');
  }

  closeBtn?.addEventListener('click', () => close());
  cancelBtn?.addEventListener('click', () => close());
  secondaryBtn.addEventListener('click', async () => {
    const handler = onSecondary;
    close('secondary');
    if (handler) await handler();
  });
  confirmBtn?.addEventListener('click', async () => {
    const handler = onConfirm;
    close('confirm');
    if (handler) await handler();
  });

  if (ctx?.helpers) {
    ctx.helpers.openWarningModal = open;
    ctx.helpers.closeWarningModal = close;
  }
});

export {};
