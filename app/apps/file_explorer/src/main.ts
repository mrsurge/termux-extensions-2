import { initBuiltinConsoleBridge, getConsoleBridgeStatus } from '/static/js/te2_console_bridge.js';
import { getIcon, renderIcon } from '/static/js/file_icons.js';
import { selectPaths } from '/static/js/file_explorer_selection.mjs';
import { createListingFilter } from '/static/js/file_explorer_filter.mjs';
import { createTabClient, mountIntent, tabUrl, randomTabOperation, type TabClient } from './tab_client';
import type { TabRecord, TabOptions } from './tab_protocol';
import { createTabsUI } from './tabs_ui';
import { createFileExplorerApi } from './api';
import { createFileActions } from './file_actions';
import { createOpenActions } from './open_actions';
import { createPropertiesController } from './properties';
import { jobRecordDto, actionError } from './action_types';
import { createTerminalDrawer } from '../terminal_drawer';
import { createViewport, type ViewportState, type FileEntry, type EntryNodes } from './viewport';
import { bindTerminalShortcut } from './keyboard';
import { createMenubar, createItemContextMenu } from './menubar';
import { createBookmarks } from './bookmarks';
import { createJobsController } from './jobs';
import { createDirectoryUsage } from './usage';
import { MAX_EDITOR_SIZE, isEditableFile, isArchive, joinPath, parentPath, formatSize, formatDate, modeToString, formatOwnership } from './presentation_helpers';
import { apiContract, hostContract, dialogContract, pickerContract, preferenceDto, ensureSocketIoLoaded, field, runtimeValue, uiToast, uiNotification, dismissNotification, requireElement, type RuntimeSocket } from './frontend_contracts';

const HOME_DIR = '~';
const mountedRoots = new WeakMap<HTMLElement, () => void>();
function validSort(value: string): TabOptions['sortBy'] { return value === 'size' || value === 'type' || value === 'date' ? value : 'name'; }
async function startFileExplorerConsoleBridge(options: { workerId?: string } = {}): Promise<unknown> {
  try {
    const workerId = (options.workerId ?? '').trim();
    return await initBuiltinConsoleBridge({
      prepare: async () => { await ensureSocketIoLoaded(); },
      appId: 'file_explorer', workerLabel: 'file_explorer', socketPath: '/te2_console_ws/socket.io', namespace: '/te2_console',
      ...(workerId ? { workerId } : { uniquePerWindow: true }),
    });
  } catch (error) { console.warn('[file_explorer] console bridge unavailable', error); return null; }
}

export default function initFileExplorer(root: HTMLElement, rawApi: unknown, rawHost: unknown): null {
  mountedRoots.get(root)?.();
  const api = apiContract(rawApi), host = hostContract(rawHost);
  const dialog = dialogContract();
  const files = createFileExplorerApi(api);
  if (!document.querySelector('link[href="/static/vendor/codicons/codicon.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/static/vendor/codicons/codicon.css';
    document.head.appendChild(link);
  }
  const container = root.querySelector<HTMLElement>("[data-app-root]") || root;
  if (host && typeof host.setTitle === "function") {
    host.setTitle("File Explorer");
  }

  const savedState: unknown =
    host && typeof host.loadState === "function" ? host.loadState() : null;

  // Check for path in URL query params (deep linking)
  const urlParams = new URLSearchParams(window.location.search);
  const intentsReady = import('/static/js/te_file_explorer_intents.mjs').then(({ createFileExplorerIntents }) =>
    createFileExplorerIntents({ api, location: window.location, dialog,
      randomId: randomTabOperation }));
  const queryPath = urlParams.get("path");
  const statefulHostId = (urlParams.get("te2_host_id") || "").trim();
  const statefulTokenId = (urlParams.get("te2_token_id") || "").trim();
  const statefulConsoleWorkerId = (
    urlParams.get("te2_console_worker_id") ||
    urlParams.get("console_worker_id") ||
    ""
  ).trim();
  const consoleBridgeReady = startFileExplorerConsoleBridge({
    workerId: statefulHostId && statefulTokenId ? statefulConsoleWorkerId : "",
  });

  const prefs = preferenceDto(savedState, queryPath, Boolean(statefulHostId));

  const button = (action: string) => container.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  const ui = {
    breadcrumbs: container.querySelector<HTMLElement>('[data-role="breadcrumbs"]'),
    listWrapper: container.querySelector<HTMLElement>('.fx-list-view'),
    listContainer: container.querySelector<HTMLElement>('[data-role="list"]'),
    gridWrapper: container.querySelector<HTMLElement>('.fx-grid-view'),
    gridContainer: container.querySelector<HTMLElement>('[data-role="grid"]'),
    btnGoHome: button('go-home'), btnUp: button('up'), btnNewFolder: button('new-folder'),
    btnNewFile: button('new-file'), btnOpen: button('open'), btnOpenEditor: button('open-editor'),
    btnExtractArchive: button('extract-archive'), btnProperties: button('properties'), btnRename: button('rename'),
    btnDelete: button('delete'), btnCopy: button('copy'), btnMove: button('move'), btnDownload: button('download'),
    btnToggleView: button('toggle-view'), btnSortDir: button('toggle-sort-direction'),
    selectAll: button('select-all'), clearSelection: button('clear-selection'),
    toggleHidden: container.querySelector<HTMLInputElement>('[data-action="toggle-hidden"]'),
    sortSelect: container.querySelector<HTMLSelectElement>('[data-action="sort-by"]'),
    footerSelectAll: root.querySelector<HTMLButtonElement>('.fx-mobile-footer [data-action="select-all"]'),
    footerButtons: [...root.querySelectorAll<HTMLButtonElement>('.fx-mobile-footer [data-action]:not([data-action="select-all"])')],
    selectionCount: container.querySelector<HTMLElement>('.fx-selection-count'),
    viewMenuButtons: [...container.querySelectorAll<HTMLButtonElement>('[data-menu-panel="view"] [data-command]')],
    propertiesModal: container.querySelector<HTMLElement>('[data-modal="properties"]'),
  };

  const state: ViewportState = {
    currentPath: prefs.path,
    entries: [],
    selected: null,
    selectedPaths: new Set(), // For batch operations
    view: prefs.view,
    sortBy: prefs.sortBy,
    sortAsc: prefs.sortAsc,
  };

  const menuGroups = [...container.querySelectorAll<HTMLElement>('.fx-menu-group')];
  const footerButtonsByAction = new Map(ui.footerButtons.map(btn => [btn.dataset.action ?? '', btn]));
  const viewMenuByCommand = new Map(ui.viewMenuButtons.map(btn => [btn.dataset.command ?? '', btn]));
  let showHidden = !!prefs.showHidden;
  if (ui.toggleHidden) {
    ui.toggleHidden.checked = showHidden;
  }

  // Initialize sort controls
  if (ui.sortSelect) {
    ui.sortSelect.value = state.sortBy;
  }
  if (ui.btnSortDir) {
    ui.btnSortDir.textContent = state.sortAsc ? "↓" : "↑";
    ui.btnSortDir.title = state.sortAsc
      ? "Sort ascending (click for descending)"
      : "Sort descending (click for ascending)";
  }

  let tabs: TabClient | null = null;
  let tabSocket: RuntimeSocket | null = null;
  let applyingTab = 0;
  let directoryGeneration = 0;
  let directoryScopeEpoch = 0;
  let appLive = true;
  let tabsInitialized = false;
  let terminalDrawer: ReturnType<typeof createTerminalDrawer> | null = null;
  let renderedTab = '';
  let renderedTabId = '';
  let publishedTabReference: string | null = null;
  let pendingTabReference: string | null = null;
  const lastTabKey = 'te2:file-explorer:last-tab:v1';
  const footer = root.querySelector<HTMLElement>('.fx-mobile-footer');
  const tabsGroup = container.querySelector<HTMLElement>('[data-menu="tabs"]');
  const notify = (message: string) => { if (appLive) uiToast(message); };
  const jobs = createJobsController({
    client: runtimeValue('jobsClient'), eventSourceAvailable: typeof window.EventSource === 'function',
    currentPath: () => state.currentPath, refresh: () => loadDirectory(state.currentPath),
    fetch: (...args) => fetch(...args), notify: uiNotification, dismiss: dismissNotification,
    toast: notify, onError: error => console.error('[file-explorer jobs]', error),
  });
  function requireTabs(): TabClient { if (!tabs) throw new Error('Tab connection is unavailable'); return tabs; }
  const usage = createDirectoryUsage({ container, notify,
    current: () => tabs?.tab ? { tabId: tabs.tab.id, path: tabs.tab.path } : null,
    request: (method, params) => requireTabs().request(method, params),
    changed: () => { updateViewMenuState(); if (state.sortBy === 'size') renderEntries(); },
  });
  const tabsUI = createTabsUI({
    container, footer,
    list: () => requireTabs().list(),
    catalog: () => requireTabs().catalog(),
    currentTab: () => tabs?.tab || null,
    create: async () => {
      const path = statefulHostId ? (await requireTabs().request('tabs.defaultPath')).path : HOME_DIR;
      await applyTab(await requireTabs().mount({ kind: 'create', path }, tabOptions(), randomTabOperation()));
    },
    attach: async record => { await applyTab(await requireTabs().mount({ kind: 'attach', tabId: record.id })); },
    close: async record => { await requireTabs().close(record, Boolean(record.shellId)); },
    showTabs: () => showTabs(),
    closeMenus: () => closeAllMenus(),
    error: error => tabError(error),
    confirm: message => dialog.confirm(message),
    splashPublished: () => { void publishStatefulSidebarUrl(HOME_DIR); },
  });

  function tabOptions(): TabOptions {
    return { showHidden, view: state.view === "grid" ? "grid" : "list", sortBy: validSort(state.sortBy), sortAsc: state.sortAsc };
  }

  function tabError(error: unknown) { notify(actionError(error, 'Tab operation failed')); }

  function rememberTab(tab: TabRecord | null) {
    history.replaceState(history.state, '', tabUrl(window.location.href, tab?.id || ''));
    if (!statefulHostId) {
      try {
        if (tab) localStorage.setItem(lastTabKey, tab.id);
      } catch { /* Storage is an optional last-tab hint, never tab authority. */ }
    }
  }

  function showTabChrome(active: boolean) {
    tabsUI.chrome(active);
  }

  async function applyTab(tab: TabRecord | null) {
    if (!appLive) return;
    usage.sync();
    terminalDrawer?.sync(tab);
    if (!tab) { renderedTab = ''; await showTabs(); return; }
    const rendering = JSON.stringify([tab.id, tab.path, tab.options]);
    if (rendering === renderedTab) return;
    if (tab.id !== renderedTabId) {
      directoryScopeEpoch++;
      viewport.resetFilter();
    }
    renderedTabId = tab.id;
    renderedTab = rendering;
    tabsUI.invalidateSplash();
    applyingTab++;
    try {
      showHidden = tab.options.showHidden;
      Object.assign(state, { view: tab.options.view, sortBy: tab.options.sortBy, sortAsc: tab.options.sortAsc });
      if (ui.toggleHidden) ui.toggleHidden.checked = showHidden;
      if (ui.sortSelect) ui.sortSelect.value = state.sortBy;
      if (ui.btnSortDir) ui.btnSortDir.textContent = state.sortAsc ? '↓' : '↑';
      rememberTab(tab);
      showTabChrome(true);
      try { await loadDirectory(tab.path, true); }
      catch (error) { renderedTab = ''; throw error; }
    } finally { applyingTab--; }
  }

  async function showTabs() {
    if (!appLive) return;
    usage.close();
    directoryScopeEpoch++;
    terminalDrawer?.sync(null);
    renderedTab = '';
    directoryGeneration++;
    viewport.resetFilter();
    renderedTabId = '';
    rememberTab(null);
    await tabsUI.showSplash();
  }

  async function refreshTabsMenu() {
    await tabsUI.refreshMenu();
  }

  function persistState(syncTab = true): void {
    if (host && typeof host.saveState === "function") {
      host.saveState({
        path: state.currentPath,
        showHidden,
        view: state.view,
        sortBy: state.sortBy,
        sortAsc: state.sortAsc,
      });
    }
    if (syncTab && !applyingTab && tabs?.tab) {
      void tabs.update(state.currentPath, tabOptions()).catch(tabError);
    }
  }

  function buildStatefulUrl(path: string, consoleWorkerId = "") {
    const appId =
      host && typeof host.id === "string" && host.id
        ? host.id
        : "file_explorer";
    const url = new URL(
      `/app/${encodeURIComponent(appId)}`,
      window.location.origin,
    );
    url.searchParams.set("embed", "1");
    url.searchParams.set("path", path || HOME_DIR);
    if (statefulHostId) url.searchParams.set("te2_host_id", statefulHostId);
    if (statefulTokenId) url.searchParams.set("te2_token_id", statefulTokenId);
    const workerId = String(
      consoleWorkerId || statefulConsoleWorkerId || "",
    ).trim();
    if (workerId) url.searchParams.set("te2_console_worker_id", workerId);
    return `${url.pathname}${url.search}`;
  }

  async function publishStatefulSidebarUrl(path: string) {
    if (!appLive || !statefulHostId) return;
    const reference = tabs?.tab?.id || '';
    if (publishedTabReference === reference || pendingTabReference === reference) return;
    pendingTabReference = reference;
    try {
      await consoleBridgeReady;
      if (!appLive || (tabs?.tab?.id || '') !== reference) return;
      const status = getConsoleBridgeStatus();
      const consoleWorkerId =
        typeof field(status, "workerId") === "string" ? String(field(status, "workerId")) : "";
      const tokenId = statefulTokenId || "file_explorer";
      await files.sidebarState({
        host_id: statefulHostId,
        hostId: statefulHostId,
        token_id: tokenId,
        tokenId,
        console_worker_id: consoleWorkerId,
        consoleWorkerId: consoleWorkerId,
        path,
        tab_id: reference,
        splash: !reference,
        query_state: reference ? { tab_id: reference } : {},
        queryState: reference ? { tab_id: reference } : {},
        url: String(tabUrl(buildStatefulUrl(path, consoleWorkerId), reference, window.location.href)),
        activate: false,
      });
      if (appLive) publishedTabReference = reference;
    } catch (error) {
      console.warn("[file_explorer] sidebar state publish failed", error);
    } finally {
      if (pendingTabReference === reference) pendingTabReference = null;
    }
  }

  function setDisabledState(elements: (HTMLButtonElement | undefined | null)[], disabled: boolean) {
    elements.forEach((el) => {
      if (!el) return;
      if (disabled) {
        el.disabled = true;
        el.setAttribute("disabled", "");
      } else {
        el.disabled = false;
        el.removeAttribute("disabled");
      }
    });
  }

  function updateActionButtons() {
    const hasSelection = !!state.selected;
    const hasBatchSelection = state.selectedPaths.size > 0;
    const hasSingleSelection = state.selectedPaths.size === 1;
    for (const button of container.querySelectorAll<HTMLButtonElement>('[data-command="file:open-terminal"], [data-command="file:open-project"]')) {
      button.disabled = !hasSelection || state.selected?.type !== 'directory';
    }

    // Open and properties only work with single selection
    setDisabledState(
      [ui.btnOpen, footerButtonsByAction.get("open")],
      !hasSelection,
    );
    const canOpenInEditor =
      hasSelection &&
      state.selected?.type === "file" &&
      isEditableFile(state.selected?.name ?? '');
    if (ui.btnOpenEditor) ui.btnOpenEditor.disabled = !canOpenInEditor;
    const canExtract =
      hasSelection &&
      state.selected?.type === "file" &&
      isArchive(state.selected?.name ?? '');
    if (ui.btnExtractArchive) ui.btnExtractArchive.disabled = !canExtract;
    if (ui.btnProperties) ui.btnProperties.disabled = !hasSelection;

    // Rename only works with single selection (either click or checkbox)
    if (ui.btnRename)
      ui.btnRename.disabled = !(hasSelection || hasSingleSelection);

    if (ui.btnDownload) {
      let isDownloadable = false;
      if (hasSelection && state.selected?.type === "file") {
        isDownloadable = true;
      } else if (hasSingleSelection) {
        const path = Array.from(state.selectedPaths)[0];
        const entry = state.entries.find((e) => e.path === path);
        if (entry && entry.type === "file") isDownloadable = true;
      }
      ui.btnDownload.disabled = !isDownloadable;
    }

    // Copy, Move, Delete work with batch selections
    const batchDisabled = !(hasSelection || hasBatchSelection);
    if (ui.btnDelete) ui.btnDelete.disabled = batchDisabled;
    setDisabledState(
      [ui.btnCopy, footerButtonsByAction.get("copy")],
      batchDisabled,
    );
    setDisabledState(
      [ui.btnMove, footerButtonsByAction.get("move")],
      batchDisabled,
    );

    if (ui.btnToggleView) {
      ui.btnToggleView.textContent =
        state.view === "list" ? "Grid View" : "List View";
    }
    updateViewMenuState();
  }

  function applyView() {
    if (ui.listWrapper)
      ui.listWrapper.style.display = state.view === "list" ? "block" : "none";
    if (ui.gridWrapper)
      ui.gridWrapper.style.display = state.view === "grid" ? "block" : "none";
    updateActionButtons();
    persistState();
  }

  function updateViewMenuState() {
    viewMenuByCommand.forEach((btn) => {
      btn.classList.remove("fx-menu-item-checked");
      btn.dataset.checked = "false";
    });

    const hiddenBtn = viewMenuByCommand.get("view:toggle-hidden");
    const usageBtn = viewMenuByCommand.get('view:directory-usage');
    if (usageBtn && usage.isEnabled()) {
      usageBtn.classList.add('fx-menu-item-checked'); usageBtn.dataset.checked = 'true';
    }
    if (hiddenBtn && showHidden) {
      hiddenBtn.classList.add("fx-menu-item-checked");
      hiddenBtn.dataset.checked = "true";
    }

    const sortBtn = viewMenuByCommand.get(
      `view:sort-${state.sortBy || "name"}`,
    );
    if (sortBtn) {
      sortBtn.classList.add("fx-menu-item-checked");
      sortBtn.dataset.checked = "true";
    }
  }

  function setSort(sortBy: string) {
    if (!sortBy || state.sortBy === sortBy) {
      updateViewMenuState();
      return;
    }
    state.sortBy = sortBy;
    if (ui.sortSelect) {
      ui.sortSelect.value = sortBy;
    }
    renderEntries();
    persistState();
    updateViewMenuState();
  }

  const menubar = createMenubar({
    container, dispatch: handleMenuCommand,
    opened: group => { if (group === tabsGroup) void refreshTabsMenu().catch(tabError); },
  });
  function closeAllMenus() { menubar.close(); }

  const menuActions: Record<string, () => void | Promise<void>> = {
    "file:new-folder": () => createFolder(),
    "file:new-file": () => createNewFile(),
    "file:open": () => openSelected(),
    "file:open-editor": () => openSelectedInEditor(),
    "file:open-terminal": () => openSelectedInTerminal(),
    "file:open-project": () => openSelectedAsProject(),
    "file:download": () => downloadSelected(),
    "file:extract": () => extractSelectedArchive(),
    "edit:properties": () => openSelectedProperties(),
    "edit:rename": () => renameSelected(),
    "edit:delete": () => deleteSelected(),
    "edit:copy": () => copySelected(),
    "edit:move": () => moveSelected(),
    "view:grid": () => {
      state.view = "grid";
      applyView();
    },
    "view:list": () => {
      state.view = "list";
      applyView();
    },
    "view:directory-usage": () => usage.toggle(),
    "view:toggle-hidden": () => {
      showHidden = !showHidden;
      if (ui.toggleHidden) {
        ui.toggleHidden.checked = showHidden;
      }
      updateViewMenuState();
      persistState();
      loadDirectory(state.currentPath);
    },
    "view:sort-name": () => setSort("name"),
    "view:sort-size": () => setSort("size"),
    "view:sort-date": () => setSort("date"),
    "view:sort-type": () => setSort("type"),
    "bookmarks:add": () => openBookmarkFormModal(),
    "bookmarks:edit": () => openEditBookmarksModal(),
  };

  function handleMenuCommand(command: string) {
    if (!command) return;
    const action = menuActions[command];
    if (!action) return;
    try {
      const result = action();
      if (result && typeof result.then === "function") {
        result.catch(() => {});
      }
    } catch (error) {
      notify(actionError(error, "Unable to complete action"));
    }
  }

  const contextMenuReady = Promise.resolve(
    createItemContextMenu<FileEntry, EntryNodes>({ container, dispatch: handleMenuCommand, select: (entry, nodes) => {
      closeAllMenus();
      // Keep an intentional batch; an unrelated item becomes the sole target.
      if (!state.selectedPaths.has(entry.path)) selectEntry(entry, nodes);
    } }));

  const viewport = createViewport({
    container, state, ui,
    filterInput: requireElement(container, '[data-role="name-filter"]', HTMLInputElement),
    filterError: requireElement(container, '[data-role="name-filter-error"]', HTMLElement),
    contextMenuReady, createListingFilter, selectPaths, getIcon, renderIcon,
    isArchive, modeToString, formatOwnership, formatSize, formatDate, parentPath,
    updateActionButtons, closeAllMenus, loadDirectory, openSelected,
    followSymlink, deleteSelected, afterRender: () => usage.refresh(), usageSize: path => usage.sizeFor(path),
  });
  const {
    setLoading, clearSelection, syncSelection, updateSelectionCount,
    selectAllItems, selectEntry, renderBreadcrumbs, renderEntries, refreshFilter,
  } = viewport;
  // Presentation identity only: durable directory/tab state remains backend-owned.
  const actionContextKey = () => JSON.stringify([appLive, tabs?.tab?.id || '', state.currentPath, directoryScopeEpoch]);

  const navigate = (url: string) => { window.location.href = url; };
  const fileActions = createFileActions({
    files,
    getContext: () => ({ directory: state.currentPath, tabId: tabs?.tab?.id || null,
      contextKey: actionContextKey(), selected: state.selected,
      selectedPaths: state.selectedPaths, entries: state.entries }),
    dialog,
    getPicker: pickerContract,
    jobs: { available: jobs.available, create: jobs.create, track: jobs.trackBulk },
    toast: notify, navigate, clearSelection, loadDirectory, parentPath,
    onError: (label, details) => console.error(label, details),
    download: (url, filename) => {
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
    },
  });
  const openActions = createOpenActions({
    files, snapshot: () => ({ selected: state.selected, path: state.currentPath, showHidden }),
    contextKey: actionContextKey, intentsReady, loadDirectory, notify,
    closeMenus: closeAllMenus, isArchive, isEditableFile, maxEditorSize: MAX_EDITOR_SIZE,
    picker: () => { const picker = pickerContract(); return picker?.openDirectory ? { openDirectory: options => picker.openDirectory!(options) } : null; },
    hasJobSupport: jobs.available, submitExtraction, fetch: (...args) => fetch(...args), navigate,
  });
  const properties = createPropertiesController({
    container, files, selectedEntry: () => state.selected,
    currentDirectory: () => state.currentPath, refreshDirectory: loadDirectory,
    getContextKey: actionContextKey, notify, parentPath, joinPath,
  });

  const bookmarks = createBookmarks({
    container, getCurrentPath: () => state.currentPath, loadDirectory, closeMenus: closeAllMenus,
    notify, fetch: (...args) => fetch(...args),
  });
  const { openBookmarkFormModal, openEditBookmarksModal, closeEditBookmarksModal, closeBookmarkFormModal } = bookmarks;

  async function submitExtraction(entry: FileEntry, destination: string) {
    const job = jobRecordDto(await jobs.create('extract_archive', {
      archive_path: entry.path, items: [], destination,
      options: { overwrite: 'rename', password: null },
    }));
    jobs.trackArchive(job, {
      archivePath: entry.path, archiveName: entry.name, destination, itemCount: 0,
      runningMessage: destination ? `Extracting → ${destination}` : 'Extracting…',
      successMessage: () => `Extracted to ${destination}`,
      failureMessage: 'Extraction failed.', cancelMessage: 'Extraction cancelled.',
      successToast: () => `Extracted to ${destination}`,
      failureToast: info => info?.error || 'Extraction failed.',
      cancelToast: 'Extraction cancelled.', refreshOnSuccess: [destination],
    });
  }
  const disposeTerminalShortcut = bindTerminalShortcut(container, {
    available: () => Boolean(tabs?.tab && terminalDrawer),
    show: () => {
      closeAllMenus();
      if (container.ownerDocument.activeElement?.closest('.fx-terminal-drawer')) {
        const selected = state.selected?.path;
        const wrapper = state.view === 'grid' ? ui.gridContainer : ui.listContainer;
        const items = [...wrapper?.querySelectorAll<HTMLElement>('[data-path]') ?? []];
        (items.find(item => item.dataset.path === selected) ?? items[0] ?? container.querySelector<HTMLElement>('[data-role="name-filter"]'))?.focus({ preventScroll: true });
        return;
      }
      return terminalDrawer?.show();
    },
  });

  async function loadDirectory(targetPath: string, fromTab = false): Promise<void> {
    if (!appLive) return;
    if (targetPath && targetPath !== state.currentPath) usage.close();
    viewport.captureListingFocus();
    const generation = ++directoryGeneration;
    viewport.cancelFilter();
    const normalized = targetPath || state.currentPath || HOME_DIR;
    closeAllMenus();
    clearSelection();
    setLoading();
    try {
      if (!fromTab && tabs?.tab) {
        const tab = await tabs.update(normalized, tabOptions());
        if (generation !== directoryGeneration) return;
        targetPath = tab.path;
      }
      const payload = await files.list(targetPath || normalized, showHidden);
      if (generation !== directoryGeneration) return;

      const { entries, path: resolvedPath } = payload;

      if (resolvedPath !== state.currentPath) {
        directoryScopeEpoch++;
        viewport.resetFilter();
      }
      state.currentPath = resolvedPath;
      state.entries = entries;
      state.selected = null;
      renderBreadcrumbs();
      viewport.finishLoading();
      updateActionButtons();
      state.view = state.view === "grid" ? "grid" : "list";
      applyView();
      persistState(false);
      void publishStatefulSidebarUrl(state.currentPath);
      usage.directoryReady();
    } catch (error) {
      if (generation !== directoryGeneration) return;
      state.entries = [];
      viewport.finishLoading(false);
      const message = actionError(error, "Failed to load directory");
      if (ui.listContainer) {
        ui.listContainer.innerHTML = "";
        const node = document.createElement("div");
        node.className = "fx-empty";
        node.style.color = "#fca5a5";
        node.textContent = message;
        ui.listContainer.appendChild(node);
      }
      if (ui.gridContainer) {
        ui.gridContainer.innerHTML = "";
        const node = document.createElement("div");
        node.className = "fx-empty";
        node.style.color = "#fca5a5";
        node.textContent = message;
        ui.gridContainer.appendChild(node);
      }
      notify(message);
    }
  }

  function createFolder() { return fileActions.createFolder(); }
  function createNewFile() { return fileActions.createNewFile(); }
  function renameSelected() { return fileActions.renameSelected(); }
  function deleteSelected() { return fileActions.deleteSelected(); }
  function copySelected() { return fileActions.copySelected(); }
  function moveSelected() { return fileActions.moveSelected(); }
  function downloadSelected() { return fileActions.downloadSelected(); }
  function followSymlink(entry: FileEntry) { return openActions.followSymlink(entry); }
  function openSelected() { return openActions.openSelected(); }
  function openSelectedInEditor() { return openActions.openSelectedInEditor(); }
  function openSelectedAsProject() { return openActions.openSelectedAsProject(); }
  function openSelectedInTerminal() { return openActions.openSelectedInTerminal(); }
  function extractSelectedArchive() { return openActions.extractSelectedArchive(); }
  function openSelectedProperties() { return properties.openSelected(); }
  function closePropertiesModal() { properties.close(); }

  const listenerCleanup: (() => void)[] = [];
  function bindClick(element: HTMLElement | null, action: () => unknown): void {
    if (!element) return;
    const listener = () => { if (!appLive) return; try { const result = action(); if (result instanceof Promise) void result.catch(tabError); } catch (error) { tabError(error); } };
    element.addEventListener('click', listener);
    listenerCleanup.push(() => element.removeEventListener('click', listener));
  }
  const actions: Record<string, () => unknown> = {
    up: () => loadDirectory(parentPath(state.currentPath)), 'go-home': () => loadDirectory(HOME_DIR),
    'new-folder': createFolder, 'new-file': createNewFile, open: openSelected, 'open-editor': openSelectedInEditor,
    'extract-archive': extractSelectedArchive, properties: openSelectedProperties, rename: renameSelected,
    delete: deleteSelected, copy: copySelected, move: moveSelected, download: downloadSelected,
    'toggle-view': () => { state.view = state.view === 'list' ? 'grid' : 'list'; applyView(); },
    'select-all': () => selectAllItems(true), 'clear-selection': clearSelection,
    'toggle-sort-direction': () => {
      state.sortAsc = !state.sortAsc;
      if (ui.btnSortDir) { ui.btnSortDir.textContent = state.sortAsc ? '↓' : '↑'; ui.btnSortDir.title = state.sortAsc ? 'Sort ascending (click for descending)' : 'Sort descending (click for ascending)'; }
      renderEntries(); persistState();
    },
  };
  for (const [name, action] of Object.entries(actions)) bindClick(button(name), action);
  for (const item of ui.footerButtons) { const action = actions[item.dataset.action ?? '']; if (action) bindClick(item, action); }
  bindClick(ui.footerSelectAll, actions['select-all']!);
  const hiddenChange = () => { showHidden = ui.toggleHidden?.checked ?? false; updateViewMenuState(); persistState(); void loadDirectory(state.currentPath); };
  ui.toggleHidden?.addEventListener('change', hiddenChange);
  listenerCleanup.push(() => ui.toggleHidden?.removeEventListener('change', hiddenChange));
  const sortChange = () => { setSort(ui.sortSelect?.value ?? 'name'); };
  ui.sortSelect?.addEventListener('change', sortChange);
  listenerCleanup.push(() => ui.sortSelect?.removeEventListener('change', sortChange));
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !appLive) return;
    const dialogOpen = ui.propertiesModal?.dataset.open === 'true' || bookmarks.editOpen() || bookmarks.formOpen();
    const menuOpen = menuGroups.some(group => group.hasAttribute('data-open'));
    const target = event.target instanceof Element ? event.target : null;
    if (!dialogOpen && !menuOpen && !event.defaultPrevented && !target?.closest('input,textarea,[contenteditable="true"],[role="dialog"]')) clearSelection();
    if (menuOpen) { event.preventDefault(); closeAllMenus(); return; }
    if (ui.propertiesModal?.dataset.open === 'true') { event.preventDefault(); closePropertiesModal(); }
    if (bookmarks.editOpen()) { event.preventDefault(); closeEditBookmarksModal(); }
    if (bookmarks.formOpen()) { event.preventDefault(); closeBookmarkFormModal(); }
  };
  document.addEventListener('keydown', keydown);
  listenerCleanup.push(() => document.removeEventListener('keydown', keydown));

  applyView();
  tabsUI.loading();
  let cancelConnect: (() => void) | null = null;
  void (async () => {
    const io = await ensureSocketIoLoaded();
    if (!appLive) return;
    const socket = io('/tabs', { path: '/api/app/file_explorer/socket.io', transports: ['websocket'],
      autoConnect: false, auth: { codec: 'msgpack-v1', presentationId: randomTabOperation() } });
    tabSocket = socket;
    usage.bindSocket(socket);
    tabs = createTabClient(socket, tab => void applyTab(tab).catch(tabError), tabError,
      () => {
        if (!tabsInitialized) return;
        if (!tabs?.tab) void showTabs().catch(tabError);
        else if (tabsGroup?.hasAttribute('data-open')) void refreshTabsMenu().catch(tabError);
      });
    terminalDrawer = createTerminalDrawer(container, tabs, socket, tabError);
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); socket.off('connect', connected); socket.off('connect_error', failed); cancelConnect = null; };
      const connected = () => { done(); resolve(); };
      const failed = (error: unknown) => { done(); reject(error); };
      const timer = setTimeout(() => { done(); socket.disconnect(); reject(new Error('Tab connection timed out')); }, 15000);
      cancelConnect = () => { done(); reject(new Error('File Explorer closed')); };
      socket.once('connect', connected); socket.once('connect_error', failed); socket.connect();
    });
    if (!appLive) return;
    let lastTab = '';
    try { lastTab = localStorage.getItem(lastTabKey) || ''; } catch { /* optional */ }
    const url = new URL(window.location.href);
    const intent = mountIntent(url, lastTab);
    if (intent.kind === 'splash') { await showTabs(); tabsInitialized = true; return; }
    let operation = url.searchParams.get('tab_create') ?? undefined;
    if (intent.kind === 'create' && !operation) {
      operation = statefulHostId ? `sidebar:${statefulHostId}` : randomTabOperation();
      url.searchParams.set('tab_create', operation);
      history.replaceState(history.state, '', url);
    }
    await applyTab(await requireTabs().mount(intent, tabOptions(), operation));
    tabsInitialized = true;
  })().catch((error: unknown) => {
    if (!appLive) return;
    tabsUI.failed(actionError(error, 'Tabs could not be loaded'), () => window.location.reload());
    tabError(error);
  });
  function dispose(): void {
    if (!appLive) return;
    appLive = false; directoryGeneration++; directoryScopeEpoch++;
    cancelConnect?.(); cancelConnect = null;
    usage.dispose(); fileActions.dispose(); openActions.dispose(); properties.dispose(); bookmarks.dispose(); jobs.dispose();
    viewport.dispose(); menubar.dispose(); tabsUI.dispose(); disposeTerminalShortcut();
    void contextMenuReady.then(menu => menu.dispose());
    terminalDrawer?.dispose(); tabs?.dispose();
    for (const remove of listenerCleanup) remove();
    window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', pageshow);
    if (mountedRoots.get(root) === dispose) mountedRoots.delete(root);
  }
  const pagehide = (event: PageTransitionEvent) => {
    viewport.cancelFilter();
    if (event.persisted) { jobs.suspend(); tabSocket?.disconnect(); }
    else dispose();
  };
  const pageshow = (event: PageTransitionEvent) => {
    if (event.persisted && appLive) { jobs.resume(); tabSocket?.connect(); refreshFilter(); }
  };
  window.addEventListener('pagehide', pagehide); window.addEventListener('pageshow', pageshow);
  mountedRoots.set(root, dispose);
  void bookmarks.getBookmarks();
  return null;
}
