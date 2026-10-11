import { createListingKeyboard } from './keyboard';

export interface FileEntry {
  name: string;
  path: string;
  type: string;
  size?: number;
  mtime?: number;
  mode?: number | string;
  owner?: string | number;
  group?: string | number;
}
export interface ViewportState {
  currentPath: string;
  entries: FileEntry[];
  selected: FileEntry | null;
  selectedPaths: Set<string>;
  view: string;
  sortBy: string;
  sortAsc: boolean;
}
export interface ViewportUI {
  breadcrumbs: HTMLElement | null;
  listContainer: HTMLElement | null;
  gridContainer: HTMLElement | null;
  clearSelection: HTMLElement | null;
  selectionCount: HTMLElement | null;
}
export interface SelectionModifiers { shift: boolean; additive: boolean; toggle: boolean }
export interface SelectionResult { selected: Set<string>; anchor: string | null }
export interface ListingFilter {
  apply(entries: FileEntry[], pattern: string): void;
  cancel(): void;
}
export type FilterController = ListingFilter;
export type FilterFactory = (deliver: (entries: FileEntry[], error: string) => void) => FilterController;
export interface EntryNodes { row: HTMLElement; tile: HTMLElement }
export interface ItemContextMenu {
  close(restoreFocus?: boolean): void;
  bind(element: HTMLElement, entry: FileEntry, nodes: EntryNodes): void;
}
export interface FileIcon { codicon?: string; color?: string; [key: string]: unknown }
export interface ViewportDependencies {
  container: HTMLElement;
  state: ViewportState;
  ui: ViewportUI;
  filterInput: HTMLInputElement;
  filterError: HTMLElement;
  contextMenuReady: Promise<ItemContextMenu>;
  createListingFilter: FilterFactory;
  selectPaths(selected: Set<string>, order: string[], anchor: string | null, path: string, modifiers: SelectionModifiers): SelectionResult;
  getIcon(name: string): Promise<FileIcon>;
  renderIcon(element: HTMLElement, icon: FileIcon): void;
  isArchive(name: string): boolean;
  modeToString(mode: number | string | undefined, type: string): string;
  formatOwnership(owner: string | number | undefined, group: string | number | undefined): string;
  formatSize(size: number | undefined): string;
  formatDate(mtime: number | undefined): string;
  parentPath(path: string): string;
  updateActionButtons(): void;
  closeAllMenus(): void;
  loadDirectory(path: string): void | Promise<void>;
  openSelected(): void | Promise<void>;
  followSymlink(entry: FileEntry): void | Promise<void>;
  deleteSelected(): void | Promise<void>;
}

/** Presentation only. Directory navigation and durable tab state remain with the caller. */
export function createViewport(deps: ViewportDependencies) {
  const { container, state, ui, filterInput, filterError } = deps;
  const document = container.ownerDocument;
  let selectionAnchor: string | null = null;
  let selectionOrder: string[] = [];
  let filteredEntries: FileEntry[] | null = null;
  let restoreListingFocus = false;
  let disposed = false;
  let keyboardCleanups: (() => void)[] = [];
  const listingFilter = deps.createListingFilter((entries, error) => {
    if (disposed) return;
    filteredEntries = entries;
    filterError.textContent = error;
    filterInput.setAttribute('aria-invalid', String(Boolean(error)));
    const visible = new Set(entries.map(entry => entry.path));
    state.selectedPaths = new Set([...state.selectedPaths].filter(path => visible.has(path)));
    renderEntries();
    if (restoreListingFocus) {
      restoreListingFocus = false;
      activeList()?.querySelector<HTMLElement>('[data-path]')?.focus({ preventScroll: true });
    }
  });
  function activeList() { return state.view === 'grid' ? ui.gridContainer : ui.listContainer; }
  function refreshFilter() { listingFilter.apply(state.entries, filterInput.value); }
  function cancelFilter() { listingFilter.cancel(); filteredEntries = null; }
  function resetFilter() {
    cancelFilter();
    filterInput.value = '';
    filterError.textContent = '';
    filterInput.setAttribute('aria-invalid', 'false');
  }
  function captureListingFocus() {
    restoreListingFocus = Boolean(document.activeElement?.closest('.fx-item, .fx-tile'));
  }
  filterInput.addEventListener('input', refreshFilter);

  function updateSelectionCount() {
    if (!ui.selectionCount) return;
    const count = state.selectedPaths.size;
    ui.selectionCount.textContent = `${count} selected`;
    ui.selectionCount.style.display = count ? 'inline' : 'none';
  }
  function syncSelection() {
    state.selected = state.selectedPaths.size === 1
      ? state.entries.find(entry => state.selectedPaths.has(entry.path)) ?? null : null;
    container.querySelectorAll<HTMLElement>('.fx-item, .fx-tile').forEach(node => {
      const selected = state.selectedPaths.has(node.dataset.path ?? '');
      node.classList.toggle('selected', selected);
      node.setAttribute('aria-selected', String(selected));
      node.querySelector('[data-role="selection-icon"]')?.setAttribute('aria-pressed', String(selected));
    });
    if (ui.clearSelection) ui.clearSelection.hidden = state.selectedPaths.size === 0;
    updateSelectionCount();
    deps.updateActionButtons();
  }
  function clearSelection() { state.selectedPaths.clear(); selectionAnchor = null; syncSelection(); }
  function selectAllItems(checked: boolean) { state.selectedPaths = new Set(checked ? selectionOrder : []); syncSelection(); }
  function selectEntry(entry: FileEntry, _nodes?: EntryNodes) {
    state.selectedPaths = new Set([entry.path]); selectionAnchor = entry.path; syncSelection();
  }
  function setLoading() {
    for (const target of [ui.listContainer, ui.gridContainer]) {
      if (!target) continue;
      target.replaceChildren();
      const loading = document.createElement('div'); loading.className = 'fx-loading'; loading.textContent = 'Loading...';
      target.append(loading);
    }
  }
  function renderBreadcrumbs() {
    if (!ui.breadcrumbs) return;
    const path = state.currentPath;
    const home = path === '~' || path.startsWith('~/');
    const crumbs = [{ label: home ? 'Home' : '/', value: home ? '~' : '/' }];
    let accumulator = home ? '~' : '';
    for (const segment of (home ? path.slice(1) : path.replace(/\/+$/, '')).split('/').filter(Boolean)) {
      accumulator += `/${segment}`; crumbs.push({ label: segment, value: accumulator });
    }
    ui.breadcrumbs.replaceChildren();
    crumbs.forEach((crumb, index) => {
      if (index) { const sep = document.createElement('span'); sep.className = 'fx-crumb-sep'; sep.textContent = '/'; ui.breadcrumbs?.append(sep); }
      const span = document.createElement('span'); span.className = `fx-crumb${index === crumbs.length - 1 ? ' current' : ''}`;
      span.textContent = crumb.label;
      if (index !== crumbs.length - 1) span.addEventListener('click', () => { void deps.loadDirectory(crumb.value); });
      ui.breadcrumbs?.append(span);
    });
  }
  function sortedEntries() {
    return (filteredEntries ?? state.entries).slice().sort((a, b) => {
      const directories = Number(a.type !== 'directory') - Number(b.type !== 'directory');
      if (directories) return directories;
      let comparison: number;
      if (state.sortBy === 'size') comparison = (a.size ?? 0) - (b.size ?? 0);
      else if (state.sortBy === 'date') comparison = (a.mtime ?? 0) - (b.mtime ?? 0);
      else {
        const extension = (name: string) => name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
        comparison = state.sortBy === 'type' ? extension(a.name).localeCompare(extension(b.name)) : 0;
        if (!comparison) comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }
      return state.sortAsc ? comparison : -comparison;
    });
  }
  function renderEntries() {
    void deps.contextMenuReady.then(menu => menu.close());
    if (!ui.listContainer || !ui.gridContainer) return;
    const focused = document.activeElement?.closest<HTMLElement>('.fx-item, .fx-tile');
    const focusedPath = focused?.dataset.path;
    const focusedClass = focused?.classList.contains('fx-tile') ? 'fx-tile' : 'fx-item';
    keyboardCleanups.forEach(cleanup => cleanup()); keyboardCleanups = [];
    ui.listContainer.replaceChildren(); ui.gridContainer.replaceChildren();
    const entries = sortedEntries(); selectionOrder = entries.map(entry => entry.path);
    if (!entries.length) {
      for (const target of [ui.listContainer, ui.gridContainer]) {
        const empty = document.createElement('div'); empty.className = 'fx-empty';
        empty.textContent = filterInput.value ? 'No matching names in this directory.' : 'This directory is empty.'; target.append(empty);
      }
      syncSelection(); return;
    }
    for (const entry of entries) {
      const isDir = entry.type === 'directory', isSymlink = entry.type === 'symlink';
      const archive = entry.type === 'file' && deps.isArchive(entry.name);
      const row = document.createElement('div'), tile = document.createElement('div');
      row.className = 'fx-item'; tile.className = 'fx-tile';
      const nodes = { row, tile };
      const name = isSymlink ? `${entry.name} →` : entry.name;
      const makeText = (className: string, text: string) => { const span = document.createElement('span'); span.className = className; span.textContent = text; return span; };
      function applySelection(path: string, event: MouseEvent | KeyboardEvent, toggle = false) {
        const result = deps.selectPaths(state.selectedPaths, selectionOrder, selectionAnchor, path, { shift: event.shiftKey, additive: event.ctrlKey || event.metaKey, toggle });
        state.selectedPaths = result.selected; selectionAnchor = result.anchor; syncSelection();
      }
      function open() { selectEntry(entry); if (isSymlink) void deps.followSymlink(entry); else if (isDir) void deps.loadDirectory(entry.path); else void deps.openSelected(); }
      for (const node of [row, tile]) {
        node.tabIndex = 0; node.dataset.path = entry.path;
        if (isSymlink) node.classList.add('fx-symlink');
        const button = document.createElement('button'); button.type = 'button'; button.dataset.role = 'selection-icon'; button.className = node === row ? 'fx-icon' : 'fx-icon-lg';
        button.setAttribute('aria-label', `Toggle selection: ${entry.name}`);
        const glyph = document.createElement('span'); glyph.className = 'fx-icon-glyph'; button.append(glyph); node.append(button);
        deps.renderIcon(glyph, { codicon: isDir ? 'folder' : isSymlink ? 'link' : 'file', color: '#8293a8' });
        if (!isDir && !isSymlink) void deps.getIcon(entry.name).then(icon => { if (glyph.isConnected) deps.renderIcon(glyph, icon); });
        button.addEventListener('click', event => { event.stopPropagation(); applySelection(entry.path, event, true); });
        const group = document.createElement('div'); group.className = node === row ? 'fx-name-group' : 'fx-name-tile';
        if (node === row) group.append(makeText('fx-name', name)); else group.textContent = name;
        if (archive) group.append(makeText('fx-archive-badge', '📦 Archive')); node.append(group);
        node.addEventListener('click', event => {
          if (event.target instanceof Element && event.target.closest('[data-role="selection-icon"]')) return;
          deps.closeAllMenus(); applySelection(entry.path, event);
        });
        node.addEventListener('dblclick', event => {
          if ((event.target instanceof Element && event.target.closest('[data-role="selection-icon"]')) || event.shiftKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault(); open();
        });
        keyboardCleanups.push(createListingKeyboard(node, {
          toggleSelection: event => applySelection(entry.path, event, true), open,
          parent: () => { void deps.loadDirectory(deps.parentPath(state.currentPath)); },
          delete: () => { if (!state.selectedPaths.size) selectEntry(entry); void deps.deleteSelected(); },
          type: character => { filterInput.focus({ preventScroll: true }); filterInput.value += character; filterInput.setSelectionRange(filterInput.value.length, filterInput.value.length); refreshFilter(); },
        }));
        void deps.contextMenuReady.then(menu => { if (!disposed && node.isConnected) menu.bind(node, entry, nodes); });
      }
      row.append(makeText('fx-permissions', deps.modeToString(entry.mode, entry.type)), makeText('fx-owner', deps.formatOwnership(entry.owner, entry.group)), makeText('fx-size', isDir ? '' : deps.formatSize(entry.size)), makeText('fx-date', deps.formatDate(entry.mtime)));
      ui.listContainer.append(row); ui.gridContainer.append(tile);
    }
    syncSelection();
    if (focusedPath) { const nodes = [...container.querySelectorAll<HTMLElement>(`.${focusedClass}`)]; (nodes.find(node => node.dataset.path === focusedPath) ?? nodes[0])?.focus({ preventScroll: true }); }
  }
  function dispose() { disposed = true; listingFilter.cancel(); filterInput.removeEventListener('input', refreshFilter); keyboardCleanups.forEach(cleanup => cleanup()); keyboardCleanups = []; }
  return { setLoading, clearSelection, syncSelection, updateSelectionCount, selectAllItems, selectEntry, renderBreadcrumbs, renderEntries, refreshFilter, cancelFilter, resetFilter, captureListingFocus, dispose };
}
