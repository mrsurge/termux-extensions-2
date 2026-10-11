import { objectDto } from './api';

export interface Bookmark extends Record<string, unknown> { name: string; path: string }
export interface BookmarkDependencies {
  container: HTMLElement;
  getCurrentPath(): string;
  loadDirectory(path: string): Promise<void>;
  closeMenus(): void;
  notify(message: string): void;
  fetch: typeof fetch;
}
export function bookmarkListDto(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) throw new Error('Invalid bookmarks: expected a list');
  return value.map(item => {
    const raw = objectDto(item, 'bookmark');
    if (typeof raw.name !== 'string' || typeof raw.path !== 'string') throw new Error('Invalid bookmark: expected name and path');
    return { ...raw, name: raw.name, path: raw.path };
  });
}

export function createBookmarks(deps: BookmarkDependencies) {
  const { container } = deps, document = container.ownerDocument;
  const query = <T extends HTMLElement>(selector: string): T | null => container.querySelector<T>(selector);
  const menu = query('[data-role="bookmarks-list"]');
  const edit = query('[data-modal="edit-bookmarks"]');
  const list = query('[data-role="edit-bookmarks-list"]');
  const form = query('[data-modal="bookmark-form"]');
  const title = query('#fx-bookmark-form-title');
  const nameInput = query<HTMLInputElement>('[data-role="bookmark-form-name"]');
  const pathInput = query<HTMLInputElement>('[data-role="bookmark-form-path"]');
  const saveButton = query<HTMLButtonElement>('[data-action="bookmark-form-save"]');
  let records: Bookmark[] = [], disposed = false, generation = 0, busy = false;
  let formContext: { record: Bookmark | null } | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanup: (() => void)[] = [];
  function bind(element: Element | null, action: () => void): void {
    if (!element) return;
    element.addEventListener('click', action);
    cleanup.push(() => element.removeEventListener('click', action));
  }
  function modal(node: HTMLElement | null, open: boolean): void {
    if (!node) return;
    if (open) node.dataset.open = 'true'; else delete node.dataset.open;
    node.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  const editOpen = (): boolean => edit?.dataset.open === 'true';
  const formOpen = (): boolean => form?.dataset.open === 'true';
  function notifyError(error: unknown, fallback: string): void {
    if (!disposed) deps.notify(error instanceof Error ? error.message : fallback);
  }
  async function request(next?: Bookmark[]): Promise<Bookmark[]> {
    const response = await deps.fetch('/api/bookmarks', next ? {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    } : undefined);
    const value: unknown = await response.json();
    const payload = objectDto(value, 'bookmarks response');
    if (!response.ok || payload.ok !== true) throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to load or save bookmarks');
    return bookmarkListDto(payload.data ?? []);
  }
  function renderMenu(): void {
    if (!menu || disposed) return;
    menu.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('div'); empty.textContent = 'No bookmarks';
      empty.style.padding = '8px 14px'; empty.style.color = 'var(--muted-foreground, #94a3b8)'; menu.append(empty);
    }
    for (const record of records) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = record.name; button.title = record.path;
      button.addEventListener('click', () => {
        if (disposed) return;
        void deps.loadDirectory(record.path).catch(error => notifyError(error, 'Failed to open bookmark'));
        deps.closeMenus();
      }); menu.append(button);
    }
  }
  function renderEdit(): void {
    if (!list || disposed) return;
    list.replaceChildren();
    records.forEach((record, index) => {
      const row = document.createElement('div'); row.className = 'fx-bookmark-editor-item'; row.dataset.index = String(index);
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.path = record.path;
      const name = document.createElement('span'); name.className = 'name'; name.textContent = record.name;
      const path = document.createElement('span'); path.className = 'path'; path.textContent = record.path;
      const up = document.createElement('button'), down = document.createElement('button');
      up.type = down.type = 'button'; up.dataset.action = 'move-up'; down.dataset.action = 'move-down';
      up.textContent = '↑'; down.textContent = '↓'; up.disabled = index === 0; down.disabled = index === records.length - 1;
      name.addEventListener('click', () => openBookmarkFormModal(record));
      up.addEventListener('click', () => { void move(record, -1); });
      down.addEventListener('click', () => { void move(record, 1); });
      row.append(checkbox, name, path, up, down); list.append(row);
    });
  }
  function render(): void { renderMenu(); if (editOpen()) renderEdit(); }
  async function getBookmarks(): Promise<void> {
    if (disposed || busy) return;
    const captured = ++generation;
    try { const result = await request(); if (!disposed && captured === generation) { records = result; render(); } }
    catch (error) { if (captured === generation) notifyError(error, 'Failed to load bookmarks'); }
  }
  async function mutate(next: Bookmark[], success: () => void): Promise<void> {
    if (disposed || busy) return;
    busy = true; const captured = ++generation;
    if (saveButton) saveButton.disabled = true;
    try {
      const result = await request(next);
      if (!disposed && captured === generation) { records = result; success(); }
    } catch (error) { notifyError(error, 'Failed to save bookmarks'); }
    finally { busy = false; if (saveButton && !disposed) saveButton.disabled = false; }
  }
  async function move(record: Bookmark, direction: number): Promise<void> {
    const index = records.indexOf(record), target = index + direction;
    if (index < 0 || target < 0 || target >= records.length) return;
    const next = [...records]; next.splice(index, 1); next.splice(target, 0, record);
    await mutate(next, () => {
      if (renderTimer !== null) clearTimeout(renderTimer);
      const captured = generation;
      renderTimer = setTimeout(() => { renderTimer = null; if (!disposed && captured === generation) render(); }, 500);
    });
  }
  async function deleteSelected(): Promise<void> {
    if (!list || disposed || busy) return;
    const paths = new Set([...list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map(input => input.dataset.path));
    if (!paths.size) { deps.notify('No bookmarks selected to delete.'); return; }
    await mutate(records.filter(record => !paths.has(record.path)), () => { render(); deps.notify(`Deleted ${paths.size} bookmark(s).`); });
  }
  function openEditBookmarksModal(): void { if (!disposed) { renderEdit(); modal(edit, true); } }
  function closeEditBookmarksModal(): void { modal(edit, false); }
  function openBookmarkFormModal(record: Bookmark | null = null): void {
    if (disposed || !nameInput || !pathInput) return;
    if (record && !records.includes(record)) return;
    formContext = { record };
    if (title) title.textContent = record ? 'Edit Bookmark' : 'Add Bookmark';
    nameInput.value = record ? record.name : deps.getCurrentPath().split('/').pop() || 'New Bookmark';
    pathInput.value = record ? record.path : deps.getCurrentPath();
    modal(form, true); nameInput.focus();
  }
  function closeBookmarkFormModal(): void { formContext = null; modal(form, false); }
  async function saveBookmarkForm(): Promise<void> {
    const context = formContext;
    if (!context || !nameInput || !pathInput || disposed || busy) return;
    const name = nameInput.value.trim(), path = pathInput.value.trim();
    if (!name || !path) { deps.notify('Name and path cannot be empty.'); return; }
    const next = [...records];
    if (context.record) {
      const index = next.indexOf(context.record);
      if (index < 0) { deps.notify('Bookmark changed. Reopen it before saving.'); return; }
      next[index] = { ...context.record, name, path };
    } else next.push({ name, path });
    await mutate(next, () => {
      render();
      if (formContext === context) closeBookmarkFormModal();
      deps.notify(`Bookmark "${name}" saved.`);
    });
  }
  bind(query('[data-role="edit-bookmarks-overlay"]'), closeEditBookmarksModal);
  container.querySelectorAll('[data-action="edit-bookmarks-close"]').forEach(node => bind(node, closeEditBookmarksModal));
  bind(query('[data-action="edit-bookmarks-delete-selected"]'), () => { void deleteSelected(); });
  bind(query('[data-role="bookmark-form-overlay"]'), closeBookmarkFormModal);
  bind(query('[data-action="bookmark-form-close"]'), closeBookmarkFormModal);
  bind(query('[data-action="bookmark-form-cancel"]'), closeBookmarkFormModal);
  bind(saveButton, () => { void saveBookmarkForm(); });
  function dispose(): void {
    disposed = true; generation++; formContext = null;
    if (renderTimer !== null) clearTimeout(renderTimer);
    cleanup.forEach(remove => remove()); closeEditBookmarksModal(); closeBookmarkFormModal();
  }
  return { getBookmarks, openBookmarkFormModal, openEditBookmarksModal, closeEditBookmarksModal, closeBookmarkFormModal,
    saveBookmarkForm, editOpen, formOpen, dispose };
}
