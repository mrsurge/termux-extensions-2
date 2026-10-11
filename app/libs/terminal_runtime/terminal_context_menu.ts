/** App-neutral clipboard menu; terminal applications retain mouse ownership. */
interface TerminalClipboard {
  getSelection?(): string;
  paste?(text: string): void;
  focus(): void;
  modes?: { mouseTrackingMode?: string };
}
export function bindTerminalContextMenu(surface: HTMLElement, terminal: TerminalClipboard, report: (message: string) => void): () => void {
  const doc = surface.ownerDocument;
  let menu: HTMLElement | null = null;
  let disposed = false;
  function close(focus = false): void { menu?.remove(); menu = null; if (focus && surface.isConnected) terminal.focus(); }
  const outside = (event: Event): void => { if (menu && (!(event.target instanceof Node) || !menu.contains(event.target))) close(); };
  const keydown = (event: KeyboardEvent): void => {
    if (!menu) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  };
  const open = (event: MouseEvent): void => {
    // Always suppress the browser menu, including when the app owns mouse input.
    event.preventDefault(); event.stopImmediatePropagation();
    doc.documentElement.dataset.te2TerminalContextAt = String(Date.now());
    const mode = terminal.modes?.mouseTrackingMode;
    if (!event.shiftKey && mode && mode !== 'none') return;
    event.preventDefault(); event.stopImmediatePropagation(); close();
    const popup = doc.createElement('div'); menu = popup; popup.setAttribute('role', 'menu');
    popup.style.cssText = 'position:fixed;z-index:2147483646;min-width:140px;padding:4px;border:1px solid #596575;border-radius:5px;background:#252b33;color:#e2e8ee;box-shadow:0 4px 16px #0008;';
    const selection = terminal.getSelection?.() || '';
    for (const action of ['Copy', 'Paste'] as const) {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = action; button.setAttribute('role', 'menuitem');
      button.style.cssText = 'display:block;width:100%;padding:7px 12px;text-align:left;background:transparent;color:inherit;border:0;cursor:pointer;';
      button.disabled = action === 'Copy' ? !selection : !terminal.paste;
      button.addEventListener('click', () => {
        close(true);
        const clipboard = doc.defaultView?.navigator.clipboard;
        const operation = action === 'Copy' ? clipboard?.writeText(selection) : clipboard?.readText().then(text => { if (!disposed && surface.isConnected) terminal.paste?.(text); });
        if (!operation) report('Clipboard is unavailable.'); else void operation.catch(() => report(`${action} failed: clipboard access was denied.`));
      }); popup.append(button);
    }
    doc.body.append(popup); const box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(4, Math.min(event.clientX, (doc.defaultView?.innerWidth || 0) - box.width - 4))}px`;
    popup.style.top = `${Math.max(4, Math.min(event.clientY, (doc.defaultView?.innerHeight || 0) - box.height - 4))}px`;
    popup.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };
  surface.addEventListener('contextmenu', open, true); doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', keydown, true); doc.addEventListener('scroll', outside, true);
  return () => { disposed = true; close(); surface.removeEventListener('contextmenu', open, true); doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', keydown, true); doc.removeEventListener('scroll', outside, true); };
}
