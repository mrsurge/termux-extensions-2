interface ExplorerKeyboardDeps {
  openExplorer(): void;
  openSearch(): void;
  closeSearch(): void;
  isSearchVisible(): boolean;
}

const bindings = new WeakMap<HTMLElement, () => void>();

export function installExplorerKeyboard(tree: HTMLElement, drawer: HTMLElement, deps: ExplorerKeyboardDeps): () => void {
  bindings.get(tree)?.();
  let selectedRel = '.';
  const rows = () => Array.from(tree.querySelectorAll<HTMLElement>('li.fe-tree-node > .fe-tree-text'))
    .filter(row => row.getClientRects().length > 0);
  const node = (row: HTMLElement) => row.parentElement;
  const searchInput = () => drawer.querySelector<HTMLInputElement>('.fe-tree-search-input');
  const focusRow = (row?: HTMLElement) => {
    if (!row) { tree.focus(); return; }
    selectedRel = node(row)?.dataset.rel || '.';
    rows().forEach(candidate => { candidate.tabIndex = candidate === row ? 0 : -1; });
    row.focus();
    row.scrollIntoView({ block: 'nearest' });
  };
  const sync = () => {
    const visible = rows();
    const selected = visible.find(row => node(row)?.dataset.rel === selectedRel) || visible[0];
    visible.forEach(row => { row.tabIndex = row === selected ? 0 : -1; });
  };
  const activate = (row: HTMLElement) => {
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
  };
  const focusExplorer = (event: Event) => {
    if (!(event instanceof CustomEvent) || event.detail !== 'explorer') return;
    deps.openExplorer();
    sync();
    focusRow(rows().find(row => node(row)?.dataset.rel === selectedRel) || rows()[0]);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    if (!(target instanceof Element) || !drawer.contains(target)) return;
    // Menus/dialogs keep their own Escape and arrow ownership.
    if (target.closest('[role="menu"], [role="dialog"]')) return;
    const stop = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      stop(); deps.openSearch(); return;
    }
    if (event.key === 'Escape') {
      stop();
      if (deps.isSearchVisible()) { deps.closeSearch(); sync(); focusRow(rows().find(row => node(row)?.dataset.rel === selectedRel) || rows()[0]); }
      else window.dispatchEvent(new Event('code-te2:focus-editor'));
      return;
    }
    const visible = rows();
    if (target.matches('.fe-tree-search-input')) {
      if (event.key === 'Tab' && !event.shiftKey) { stop(); focusRow(visible[0]); }
      else if (event.key === 'ArrowDown' && !event.altKey) { stop(); focusRow(visible[0]); }
      return;
    }
    if (target.matches('input, textarea, select') || target.closest('[contenteditable="true"]')) return;
    const row = target.closest<HTMLElement>('.fe-tree-text');
    if (!row || !tree.contains(row) || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = visible.indexOf(row);
    if (index < 0) return;
    const entry = node(row);
    if (event.key === 'Tab' && event.shiftKey && index === 0) {
      stop();
      if (searchInput()) searchInput()?.focus();
      else deps.openSearch();
    }
    else if (event.key === 'ArrowDown') { stop(); focusRow(visible[Math.min(index + 1, visible.length - 1)]); }
    else if (event.key === 'ArrowUp') { stop(); focusRow(visible[Math.max(index - 1, 0)]); }
    else if (event.key === 'Home') { stop(); focusRow(visible[0]); }
    else if (event.key === 'End') { stop(); focusRow(visible.at(-1)); }
    else if (event.key === 'Enter' || event.key === ' ') { stop(); activate(row); }
    else if (event.key === 'ArrowRight') {
      stop();
      if (entry?.dataset.kind === 'dir' && entry.dataset.open !== 'true') activate(row);
      else if (entry?.dataset.kind === 'dir') {
        const child = visible[index + 1];
        if (child && entry.contains(child)) focusRow(child);
      }
    } else if (event.key === 'ArrowLeft') {
      stop();
      if (entry?.dataset.kind === 'dir' && entry.dataset.open === 'true' && entry.dataset.rel !== '.') activate(row);
      else {
        const parent = entry?.parentElement?.closest('li.fe-tree-node');
        focusRow(parent?.querySelector<HTMLElement>(':scope > .fe-tree-text') || undefined);
      }
    }
  };
  const focused = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches('.fe-tree-text')) {
      selectedRel = node(target)?.dataset.rel || '.'; sync();
    }
  };
  tree.tabIndex = -1;
  const observer = new MutationObserver(sync);
  observer.observe(tree, { childList: true, subtree: true });
  document.addEventListener('keydown', keydown, true);
  tree.addEventListener('focusin', focused);
  window.addEventListener('code-te2:palette-action', focusExplorer);
  sync();
  const dispose = () => {
    observer.disconnect();
    document.removeEventListener('keydown', keydown, true);
    tree.removeEventListener('focusin', focused);
    window.removeEventListener('code-te2:palette-action', focusExplorer);
    if (bindings.get(tree) === dispose) bindings.delete(tree);
  };
  bindings.set(tree, dispose);
  return dispose;
}
