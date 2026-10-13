export function showToast(message: string, doc: Document = document): void {
  if (!message || !doc.body) return;
  let container = doc.getElementById('als-toasts');
  if (!container) {
    container = doc.createElement('div');
    container.id = 'als-toasts';
    container.setAttribute('aria-live', 'polite');
    doc.body.append(container);
  }
  const toast = doc.createElement('button');
  toast.type = 'button';
  toast.className = 'als-toast';
  toast.textContent = message;
  toast.title = 'Copy message';
  const feedback = doc.createElement('span');
  feedback.className = 'als-toast-feedback';
  toast.append(feedback);
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => toast.remove(), 6000); };
  toast.addEventListener('pointerenter', () => clearTimeout(timer));
  toast.addEventListener('pointerleave', schedule);
  toast.addEventListener('focus', () => clearTimeout(timer));
  toast.addEventListener('blur', schedule);
  toast.addEventListener('click', async () => {
    clearTimeout(timer);
    try {
      await copyToastText(message, doc);
      feedback.textContent = 'Copied';
    } catch {
      feedback.textContent = 'Copy failed';
    }
    schedule();
  });
  container.append(toast);
  while (container.children.length > 4) container.firstElementChild?.remove();
  schedule();
}

async function copyToastText(text: string, doc: Document): Promise<void> {
  try {
    const clipboard = doc.defaultView?.navigator.clipboard;
    if (clipboard) { await clipboard.writeText(text); return; }
  } catch { /* HTTP and embedded clients may require the synchronous fallback. */ }
  const active = doc.activeElement as HTMLElement | null;
  const field = doc.createElement('textarea');
  field.value = text;
  field.style.cssText = 'position:fixed;left:-9999px;top:0';
  doc.body.append(field);
  try {
    field.select();
    if (!doc.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    field.remove();
    active?.focus({ preventScroll: true });
  }
}
