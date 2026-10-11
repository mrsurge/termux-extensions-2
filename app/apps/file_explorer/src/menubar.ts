export interface MenubarOptions {
  container: HTMLElement;
  dispatch(command: string): void;
  opened?(group: HTMLElement): void;
}

/** Command capabilities stay on existing buttons; no duplicate capability model. */
export function createMenubar({ container, dispatch, opened }: MenubarOptions) {
  const document = container.ownerDocument;
  const groups = Array.from(container.querySelectorAll<HTMLElement>('.fx-menu-group'));
  const listeners: Array<() => void> = [];
  const close = (): void => { for (const group of groups) group.removeAttribute('data-open'); };
  for (const group of groups) {
    const toggle = group.querySelector<HTMLElement>('[data-menu-toggle]');
    if (toggle) {
      const click = (event: MouseEvent): void => {
        event.stopPropagation();
        const wasOpen = group.hasAttribute('data-open');
        close();
        if (!wasOpen) { group.setAttribute('data-open', 'true'); opened?.(group); }
      };
      toggle.addEventListener('click', click);
      listeners.push(() => toggle.removeEventListener('click', click));
    }
    for (const button of group.querySelectorAll<HTMLButtonElement>('[data-command]')) {
      const click = (event: MouseEvent): void => {
        event.stopPropagation();
        if (button.disabled || !button.dataset.command) return;
        close(); dispatch(button.dataset.command);
      };
      button.addEventListener('click', click);
      listeners.push(() => button.removeEventListener('click', click));
    }
  }
  const outside = (event: MouseEvent): void => {
    if (!(event.target instanceof Element) || !event.target.closest('.fx-menu-group')) close();
  };
  document.addEventListener('click', outside);
  return { close, dispose(): void { close(); document.removeEventListener('click', outside); for (const remove of listeners) remove(); } };
}

export interface ItemContextMenuOptions<Entry, Nodes> {
  container: HTMLElement;
  select(entry: Entry, nodes: Nodes): void;
  dispatch(command: string): void;
}

export function createItemContextMenu<Entry, Nodes>({ container, select, dispatch }: ItemContextMenuOptions<Entry, Nodes>) {
  let popup: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suppressUntil = 0;
  let opener: HTMLElement | null = null;
  function listen<K extends keyof HTMLElementEventMap>(element: HTMLElement, name: K, handler: (event: HTMLElementEventMap[K]) => void, capture = false): void {
    element.addEventListener(name, handler, capture);
  }
  function close(restoreFocus = false): void {
    clearTimeout(timer); timer = undefined;
    popup?.remove(); popup = null;
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  function open(entry: Entry, nodes: Nodes, x: number, y: number, element: HTMLElement): void {
    close(); opener = element; select(entry, nodes);
    const menu = document.createElement('div'); popup = menu;
    menu.className = 'fx-menu-dropdown fx-context-menu'; menu.setAttribute('role', 'menu');
    for (const source of container.querySelectorAll<HTMLButtonElement>('[data-menu-panel="file"] [data-command], [data-menu-panel="edit"] [data-command]')) {
      const command = source.dataset.command;
      if (source.disabled || !command) continue;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = source.textContent; button.setAttribute('role', 'menuitem');
      button.addEventListener('click', () => { close(true); dispatch(command); }); menu.append(button);
    }
    container.append(menu);
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = items.findIndex(item => item === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus({ preventScroll: true }); items[next]?.scrollIntoView({ block: 'nearest' });
      }
    });
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;
    menu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }
  const outside = (event: Event): void => { if (popup && (!(event.target instanceof Node) || !popup.contains(event.target))) close(); };
  const escape = (event: KeyboardEvent): void => { if (popup && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); } };
  const pagehide = (): void => close();
  document.addEventListener('pointerdown', outside, true); document.addEventListener('scroll', outside, true);
  document.addEventListener('keydown', escape, true); window.addEventListener('pagehide', pagehide);
  return {
    close,
    bind(element: HTMLElement, entry: Entry, nodes: Nodes): void {
      listen(element, 'contextmenu', event => {
        if (event.target instanceof Element && event.target.closest('[data-role="selection-icon"]')) return;
        event.preventDefault(); open(entry, nodes, event.clientX, event.clientY, element);
      });
      let start: { x: number; y: number } | null = null;
      listen(element, 'pointerdown', event => {
        if (event.pointerType === 'mouse' || (event.target instanceof Element && event.target.closest('input,button'))) return;
        start = { x: event.clientX, y: event.clientY };
        const origin = start;
        clearTimeout(timer);
        timer = setTimeout(() => { suppressUntil = performance.now() + 1000; open(entry, nodes, origin.x, origin.y, element); }, 600);
      });
      listen(element, 'pointermove', event => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) { clearTimeout(timer); timer = undefined; } });
      for (const name of ['pointerup', 'pointercancel'] as const) listen(element, name, () => { clearTimeout(timer); timer = undefined; start = null; });
      listen(element, 'click', event => { if (performance.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
      listen(element, 'keydown', event => {
        if (event.target instanceof Element && event.target.closest('[data-role="selection-icon"]')) return;
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const box = element.getBoundingClientRect(); open(entry, nodes, box.left + 8, box.bottom, element); }
      });
    },
    dispose(): void {
      close();
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', outside, true);
      document.removeEventListener('keydown', escape, true); window.removeEventListener('pagehide', pagehide);
    },
  };
}
