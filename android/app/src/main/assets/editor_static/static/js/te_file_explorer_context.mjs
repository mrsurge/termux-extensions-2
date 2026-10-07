// Reuse File/Edit command buttons, including their existing disabled state.
export function createItemContextMenu({ container, select, dispatch }) {
  let popup = null;
  let timer = null;
  let suppressUntil = 0;
  function close() {
    clearTimeout(timer);
    timer = null;
    popup?.remove();
    popup = null;
  }
  function open(entry, nodes, x, y) {
    close();
    select(entry, nodes);
    popup = document.createElement('div');
    popup.className = 'fx-menu-dropdown fx-context-menu';
    popup.setAttribute('role', 'menu');
    for (const source of container.querySelectorAll('[data-menu-panel="file"] [data-command], [data-menu-panel="edit"] [data-command]')) {
      if (source.disabled) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = source.textContent;
      button.setAttribute('role', 'menuitem');
      button.addEventListener('click', () => {
        const command = source.dataset.command;
        close();
        dispatch(command);
      });
      popup.appendChild(button);
    }
    container.appendChild(popup);
    const box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
    popup.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;
    popup.querySelector('button')?.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', (event) => {
    if (popup && !popup.contains(event.target)) close();
  }, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  document.addEventListener('scroll', (event) => {
    if (!popup?.contains(event.target)) close();
  }, true);
  window.addEventListener('pagehide', close);
  return {
    close,
    bind(element, entry, nodes) {
      element.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        open(entry, nodes, event.clientX, event.clientY);
      });
      let start = null;
      element.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' || event.target.closest('input,button')) return;
        start = { x: event.clientX, y: event.clientY };
        timer = setTimeout(() => {
          suppressUntil = performance.now() + 1000;
          open(entry, nodes, start.x, start.y);
        }, 600);
      });
      element.addEventListener('pointermove', (event) => {
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
          clearTimeout(timer);
          timer = null;
        }
      });
      for (const event of ['pointerup', 'pointercancel']) element.addEventListener(event, () => {
        clearTimeout(timer);
        timer = null;
      });
      element.addEventListener('click', (event) => {
        if (performance.now() < suppressUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      element.addEventListener('keydown', (event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const box = element.getBoundingClientRect();
          open(entry, nodes, box.left + 8, box.bottom);
        }
      });
    },
  };
}
