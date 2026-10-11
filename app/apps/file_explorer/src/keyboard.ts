export interface ListingKeyboardActions {
  toggleSelection(event: KeyboardEvent): void;
  open(): void;
  parent(): void;
  delete(): void;
  type(character: string): void;
}

/** Capture before xterm consumes Ctrl+backtick; never steal dialog input. */
export function bindTerminalShortcut(root: HTMLElement, actions: { available(): boolean; show(): void | Promise<void> }): () => void {
  const keydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || (event.key !== '`' && event.code !== 'Backquote')) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('[role="dialog"], [data-modal][data-open="true"]') || !actions.available()) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) void actions.show();
  };
  root.addEventListener('keydown', keydown, true);
  return () => root.removeEventListener('keydown', keydown, true);
}

/** Listing-only bindings: inputs, dialogs and terminal retain their own keys. */
export function createListingKeyboard(node: HTMLElement, actions: ListingKeyboardActions): () => void {
  const keydown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.defaultPrevented || event.isComposing || target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const nodes = Array.from(node.parentElement?.children ?? []).filter((item): item is HTMLElement => item instanceof HTMLElement && Boolean(item.dataset.path));
      const index = nodes.indexOf(node);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1
        : index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1);
      const focused = nodes[Math.max(0, Math.min(nodes.length - 1, next))];
      focused?.focus({ preventScroll: true });
      focused?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && plain) {
      event.preventDefault();
      if (!event.repeat) (event.key === 'Backspace' ? actions.parent : actions.delete)();
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (event.repeat) return;
      if (event.key === ' ' || target?.closest('[data-role="selection-icon"]')) actions.toggleSelection(event);
      else actions.open();
    } else if (event.key.length === 1 && plain) {
      event.preventDefault();
      actions.type(event.key);
    }
  };
  node.addEventListener('keydown', keydown);
  return () => node.removeEventListener('keydown', keydown);
}
