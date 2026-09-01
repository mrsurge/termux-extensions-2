import {
  EXPLORER_RPC_METHODS,
  type ExplorerRpcMethod,
} from '../rpc/contract.ts';
import type { JsonObject } from '../../rpc/transport.ts';
import type { ExplorerTreeMenuEntry } from '../tree/types.ts';
import type { ExplorerGitStatus } from '../git/footer-utils.ts';
import type {
  ExplorerStickyScopesApi,
  ExplorerStickyScopesDeps,
} from './sticky-scopes.ts';

interface ExplorerChromeBindings {
  drawerBody: HTMLElement | null;
  drawerClose: HTMLElement | null;
  drawerBackdrop: HTMLElement | null;
  drawerOpenBtn: HTMLElement | null;
  marketplaceBtn: HTMLElement | null;
  branchLabel: HTMLElement | null;
  projectMenuBtn: HTMLElement | null;
  projectMenuDropdown: HTMLElement | null;
  projectMenuNewItem: HTMLElement | null;
  projectMenuOpenItem: HTMLElement | null;
  projectMenuOpenRecentItem: HTMLElement | null;
  explorerMenuBtn: HTMLElement | null;
  explorerMenuDropdown: HTMLElement | null;
  explorerMenuSearchViewsItem: HTMLElement | null;
  explorerMenuStickyHeadersItem: HTMLElement | null;
  explorerMenuScrollActiveItem: HTMLElement | null;
}

interface ExplorerProjectChoice {
  type: 'local' | 'clone';
  url?: string;
}

interface ExplorerChromeControllerDeps {
  getGitStatus(): ExplorerGitStatus | null;
  toast(message: string): void;
  hasExplorerRpc(): boolean;
  notifyExplorer(method: ExplorerRpcMethod, payload: JsonObject): void;
  closeDiffBaseMenus(): void;
  openSearchOverlay(): void;
  openMarketplaceOverlay(): void;
  scrollToActiveFile(): Promise<void>;
  showNewProjectModal(toast: (message: string) => void): Promise<unknown>;
  showProjectsDebugModal(): Promise<void>;
  isCancelledError(error: unknown): boolean;
  getErrorMessage(error: unknown, fallback?: string): string;
  initStickyScopes(
    deps: ExplorerStickyScopesDeps,
  ): ExplorerStickyScopesApi | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isProjectChoice(value: unknown): value is ExplorerProjectChoice {
  return (
    isRecord(value) &&
    (value.type === 'local' || value.type === 'clone') &&
    (value.url === undefined || typeof value.url === 'string')
  );
}

export function formatExplorerBranchLabel(
  status: ExplorerGitStatus | null,
): { text: string; title: string } {
  if (!status) {
    return { text: '…', title: 'Git status pending' };
  }
  if (status.isRepository === false) {
    return { text: '(no branch)', title: 'Not a Git repository' };
  }
  if (status.hasHead === false) {
    return { text: '(no commits)', title: 'Git repository has no commits' };
  }
  if (status.detached === true) {
    const short = status.head?.short || status.head?.full?.slice(0, 7) || '?';
    return {
      text: `HEAD @ ${short}`,
      title: status.head?.full || 'Detached HEAD',
    };
  }
  if (status.branch) {
    const short = status.head?.short || status.head?.full?.slice(0, 7) || '';
    const text = short ? `${status.branch} @ ${short}` : status.branch;
    const title = status.head?.full
      ? `${status.branch} @ ${status.head.full}`
      : status.branch;
    return { text, title };
  }
  return { text: '(no branch)', title: 'Git branch unavailable' };
}

export function createExplorerChromeController(
  deps: ExplorerChromeControllerDeps,
) {
  let branchLabelEl: HTMLElement | null = null;
  let drawerOpenBtn: HTMLElement | null = null;
  let projectMenuBtn: HTMLElement | null = null;
  let projectMenuDropdown: HTMLElement | null = null;
  let explorerMenuBtn: HTMLElement | null = null;
  let explorerMenuDropdown: HTMLElement | null = null;
  let explorerMenuSearchViewsItem: HTMLElement | null = null;
  let explorerMenuStickyHeadersItem: HTMLElement | null = null;
  let explorerMenuScrollActiveItem: HTMLElement | null = null;
  let explorerStickyHeadersEnabled: boolean | null = null;
  const stickyScopesContext: {
    treeElement: HTMLElement | null;
    drawerBodyEl: HTMLElement | null;
    openCardMenuForEntry:
      | ((entry: ExplorerTreeMenuEntry, anchorEl: HTMLElement) => void)
      | null;
  } = {
    treeElement: null,
    drawerBodyEl: null,
    openCardMenuForEntry: null,
  };

  function setCheckableMenuItem(
    element: HTMLElement | null,
    checked: boolean,
  ): void {
    if (!element) return;
    element.classList.toggle('fe-menu-item-checked', checked);
    element.setAttribute('aria-checked', checked ? 'true' : 'false');
  }

  function closeExplorerMenu(): void {
    explorerMenuDropdown?.classList.remove('show');
    explorerMenuBtn?.setAttribute('aria-expanded', 'false');
  }

  function closeProjectMenu(): void {
    projectMenuDropdown?.classList.remove('show');
    projectMenuBtn?.setAttribute('aria-expanded', 'false');
  }

  function isDesktopLayout(root: HTMLElement): boolean {
    return root.classList.contains('layout-desktop');
  }

  function syncDrawerOpenButton(root: HTMLElement): void {
    if (!drawerOpenBtn) return;
    const desktop = isDesktopLayout(root);
    const explorerOpen = desktop
      ? !root.classList.contains('explorer-collapsed')
      : root.classList.contains('drawer-open');
    const label = explorerOpen ? 'Close Explorer' : 'Open Explorer';
    drawerOpenBtn.setAttribute('title', label);
    drawerOpenBtn.setAttribute('aria-label', label);
    drawerOpenBtn.setAttribute('aria-expanded', explorerOpen ? 'true' : 'false');
  }

  function toggleDrawer(open?: boolean): void {
    const root = document.querySelector('.fe-root');
    if (!(root instanceof HTMLElement)) return;
    if (isDesktopLayout(root)) {
      const collapsed =
        open === undefined ? !root.classList.contains('explorer-collapsed') : !open;
      root.classList.toggle('explorer-collapsed', collapsed);
      root.classList.remove('drawer-open');
      syncDrawerOpenButton(root);
      window.dispatchEvent(new Event('resize'));
      return;
    }
    if (open === undefined) {
      root.classList.toggle('drawer-open');
    } else if (open) {
      root.classList.add('drawer-open');
    } else {
      root.classList.remove('drawer-open');
    }
    syncDrawerOpenButton(root);
  }

  function renderBranchLabel(): void {
    if (!branchLabelEl) return;
    const label = formatExplorerBranchLabel(deps.getGitStatus());
    branchLabelEl.textContent = label.text;
    branchLabelEl.title = label.title;
    branchLabelEl.classList.remove('fe-label-missing');
  }

  function setStickyHeadersEnabled(next: boolean | null): void {
    explorerStickyHeadersEnabled = next;
  }

  function isStickyHeadersEnabled(): boolean {
    return explorerStickyHeadersEnabled === true;
  }

  function syncExplorerPrefsUI(): void {
    setCheckableMenuItem(
      explorerMenuStickyHeadersItem,
      explorerStickyHeadersEnabled === true,
    );
  }

  function applyExplorerStickyScopesPreference(): void {
    const enabled = explorerStickyHeadersEnabled === true;
    const existing = window.__explorerStickyScopes;

    if (!enabled) {
      if (existing && typeof existing.destroy === 'function') {
        try {
          existing.destroy();
        } catch {
          // Ignore cleanup errors.
        }
      }
      window.__explorerStickyScopes = null;
      return;
    }

    const { treeElement, drawerBodyEl, openCardMenuForEntry } = stickyScopesContext;
    if (!treeElement || !drawerBodyEl || !openCardMenuForEntry) {
      return;
    }

    if (existing && typeof existing.update === 'function') {
      existing.update();
      return;
    }

    try {
      window.__explorerStickyScopes = deps.initStickyScopes({
        treeElement,
        drawerBodyEl,
        openCardMenuForEntry,
      });
    } catch (error) {
      console.warn('[Explorer] Sticky scopes init failed:', error);
      window.__explorerStickyScopes = null;
    }
  }

  function setStickyScopesContext(context: {
    treeElement: HTMLElement | null;
    drawerBodyEl: HTMLElement | null;
    openCardMenuForEntry:
      | ((entry: ExplorerTreeMenuEntry, anchorEl: HTMLElement) => void)
      | null;
  }): void {
    stickyScopesContext.treeElement = context.treeElement;
    stickyScopesContext.drawerBodyEl = context.drawerBodyEl;
    stickyScopesContext.openCardMenuForEntry = context.openCardMenuForEntry;
  }

  async function handleOpenProject(): Promise<void> {
    if (
      !(await window.teUI.dialog.confirm(
        'Any unsaved changes in the current project will be lost. Continue?',
      ))
    ) {
      return;
    }

    if (!window.teFilePicker) {
      deps.toast('File picker not available.');
      return;
    }

    try {
      const choice = await window.teFilePicker.openDirectory({
        title: 'Open Project Directory',
        selectLabel: 'Set as Project',
      });
      if (!choice?.path) return;
      if (!deps.hasExplorerRpc()) {
        deps.toast('Explorer connection unavailable.');
        return;
      }
      deps.notifyExplorer(EXPLORER_RPC_METHODS.projectOpen, { path: choice.path });
    } catch (error) {
      if (!deps.isCancelledError(error)) {
        deps.toast(
          `An error occurred: ${deps.getErrorMessage(error, 'unknown error')}`,
        );
      }
    }
  }

  async function handleNewProject(): Promise<void> {
    if (
      !(await window.teUI.dialog.confirm(
        'Any unsaved changes in the current project could be lost. Continue?',
      ))
    ) {
      return;
    }

    if (!window.teFilePicker) {
      deps.toast('File picker not available.');
      return;
    }

    let choice: unknown;
    try {
      choice = await deps.showNewProjectModal(deps.toast);
    } catch (error) {
      if (!deps.isCancelledError(error)) {
        deps.toast(
          `An error occurred: ${deps.getErrorMessage(error, 'unknown error')}`,
        );
      }
      return;
    }

    if (!isProjectChoice(choice)) return;

    if (choice.type === 'clone') {
      let name = 'repo';
      try {
        const parts = String(choice.url || '').split('/');
        let last = parts[parts.length - 1] || '';
        if (last.endsWith('.git')) last = last.slice(0, -4);
        if (last.trim()) name = last.trim();
      } catch {
        // Keep default name.
      }

      try {
        const result = await window.teFilePicker.saveFile({
          title: 'Clone Repository Destination',
          filename: name,
          selectLabel: 'Clone Here',
        });
        if (!result?.path) return;

        if (result.existed) {
          const okay = await window.teUI.dialog.confirm(
            `Directory "${result.path}" already exists. Clone might fail if not empty. Continue?`,
          );
          if (!okay) return;
        }

        if (!deps.hasExplorerRpc()) {
          deps.toast('Explorer connection unavailable.');
          return;
        }

        deps.notifyExplorer(EXPLORER_RPC_METHODS.gitClone, {
          url: choice.url || '',
          target_path: result.path,
        });
      } catch (error) {
        if (!deps.isCancelledError(error)) {
          deps.toast(
            `An error occurred: ${deps.getErrorMessage(error, 'unknown error')}`,
          );
        }
      }
      return;
    }

    try {
      const result = await window.teFilePicker.saveFile({
        title: 'Create New Project',
        filename: 'my-project',
        selectLabel: 'Create Project',
      });
      if (!result) return;

      if (result.existed) {
        const okay = await window.teUI.dialog.confirm(
          `Directory "${result.path}" already exists. Use it anyway?`,
        );
        if (!okay) return;
      }

      if (!deps.hasExplorerRpc()) {
        deps.toast('Explorer connection unavailable.');
        return;
      }

      deps.notifyExplorer(EXPLORER_RPC_METHODS.projectCreate, {
        parent_path: result.directory,
        name: result.name,
      });
    } catch (error) {
      if (!deps.isCancelledError(error)) {
        deps.toast(
          `An error occurred: ${deps.getErrorMessage(error, 'unknown error')}`,
        );
      }
    }
  }

  function bindUi(bindings: ExplorerChromeBindings): void {
    branchLabelEl = bindings.branchLabel;
    drawerOpenBtn = bindings.drawerOpenBtn;
    projectMenuBtn = bindings.projectMenuBtn;
    projectMenuDropdown = bindings.projectMenuDropdown;
    explorerMenuBtn = bindings.explorerMenuBtn;
    explorerMenuDropdown = bindings.explorerMenuDropdown;
    explorerMenuSearchViewsItem = bindings.explorerMenuSearchViewsItem;
    explorerMenuStickyHeadersItem = bindings.explorerMenuStickyHeadersItem;
    explorerMenuScrollActiveItem = bindings.explorerMenuScrollActiveItem;

    bindings.drawerClose?.addEventListener('click', () => toggleDrawer(false));
    bindings.drawerBackdrop?.addEventListener('click', () => toggleDrawer(false));
    bindings.drawerOpenBtn?.addEventListener('click', () => {
      const root = document.querySelector('.fe-root');
      if (root instanceof HTMLElement && isDesktopLayout(root)) {
        toggleDrawer();
      } else {
        toggleDrawer(true);
      }
    });
    bindings.marketplaceBtn?.addEventListener('click', () =>
      deps.openMarketplaceOverlay()
    );

    const root = document.querySelector('.fe-root');
    if (root instanceof HTMLElement) syncDrawerOpenButton(root);

    if (projectMenuBtn && projectMenuDropdown) {
      projectMenuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        deps.closeDiffBaseMenus();
        closeExplorerMenu();
        const open = !projectMenuDropdown?.classList.contains('show');
        projectMenuDropdown?.classList.toggle('show', open);
        projectMenuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    if (explorerMenuBtn && explorerMenuDropdown) {
      explorerMenuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        deps.closeDiffBaseMenus();
        closeProjectMenu();
        const open = !explorerMenuDropdown?.classList.contains('show');
        explorerMenuDropdown?.classList.toggle('show', open);
        explorerMenuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    bindings.projectMenuNewItem?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeProjectMenu();
      void handleNewProject();
    });

    bindings.projectMenuOpenItem?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeProjectMenu();
      void handleOpenProject();
    });

    bindings.projectMenuOpenRecentItem?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeProjectMenu();
      void deps.showProjectsDebugModal();
    });

    explorerMenuSearchViewsItem?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeExplorerMenu();
      deps.openSearchOverlay();
    });

    explorerMenuStickyHeadersItem?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeExplorerMenu();
      if (typeof explorerStickyHeadersEnabled !== 'boolean') {
        deps.toast('Explorer preferences not loaded yet.');
        return;
      }
      if (!deps.hasExplorerRpc()) {
        deps.toast('Explorer connection unavailable.');
        return;
      }
      deps.notifyExplorer(EXPLORER_RPC_METHODS.prefsUiUpdate, {
        key: 'explorerStickyHeaders',
        value: !explorerStickyHeadersEnabled,
      });
    });

    explorerMenuScrollActiveItem?.addEventListener('click', async (event) => {
      event.stopPropagation();
      closeExplorerMenu();
      await deps.scrollToActiveFile();
    });

    document.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          closeProjectMenu();
          closeExplorerMenu();
          return;
        }
        if (!target.closest('#fe-project-menu')) closeProjectMenu();
        if (!target.closest('#fe-explorer-menu')) closeExplorerMenu();
      },
      false,
    );

    stickyScopesContext.drawerBodyEl = bindings.drawerBody;
  }

  return {
    bindUi,
    renderBranchLabel,
    toggleDrawer,
    setStickyHeadersEnabled,
    isStickyHeadersEnabled,
    syncExplorerPrefsUI,
    applyExplorerStickyScopesPreference,
    setStickyScopesContext,
  };
}
