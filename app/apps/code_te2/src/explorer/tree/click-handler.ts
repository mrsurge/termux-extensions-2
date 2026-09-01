import { EXPLORER_RPC_METHODS } from '../rpc/contract.ts';
import type {
  ExplorerTreeEntryKind,
  ExplorerTreeMenuEntry,
} from './types.ts';
import { getCanonicalTreeNodeName } from './label.ts';

interface ExplorerTreeClickHandlerDeps {
  getTreeElement(): HTMLElement | null;
  getProjectPath(): string | null;
  getSelectModeDir(): string | null;
  hasExplorerRpc(): boolean;
  notifyExplorer(method: string, payload: Record<string, unknown>): void;
  checkAutoDisableSelectMode(rel: string): void;
  markDirectoryOpen(rel: string, isOpen: boolean): void;
  setEntrySelected(rel: string, selected: boolean): void;
  handleSearchDirectoryClick(rel: string): Promise<boolean>;
  openCardMenuForEntry(entry: ExplorerTreeMenuEntry, anchorEl: HTMLElement): void;
  openFile(rel: string): Promise<void>;
}

function getNodeName(node: HTMLLIElement): string {
  return getCanonicalTreeNodeName(node);
}

function getNodeKind(node: HTMLLIElement): ExplorerTreeEntryKind | string {
  return node.dataset.kind || 'file';
}

function buildMenuEntry(node: HTMLLIElement): ExplorerTreeMenuEntry | null {
  const rel = node.dataset.rel;
  if (!rel) {
    return null;
  }
  return {
    rel,
    name: getNodeName(node),
    kind: getNodeKind(node),
    gitStatus: node.dataset.gitStatus || '',
  };
}

function escapeRel(rel: string): string {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(rel);
  }
  return rel.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function createExplorerTreeClickHandler(
  deps: ExplorerTreeClickHandlerDeps,
) {
  function collapseDirectory(
    dirLi: HTMLLIElement,
    rel: string,
    stickySlotTop: number | null = null,
  ): void {
    const treeElement = deps.getTreeElement();
    dirLi.dataset.open = 'false';
    const childList = dirLi.querySelector<HTMLUListElement>(
      ':scope > ul.fe-tree',
    );
    childList?.remove();

    deps.checkAutoDisableSelectMode(rel);
    deps.markDirectoryOpen(rel, false);

    if (stickySlotTop !== null && treeElement) {
      const dirRect = dirLi.getBoundingClientRect();
      const delta = dirRect.top - stickySlotTop;
      if (Math.abs(delta) >= 1) {
        const maxScroll = Math.max(
          0,
          treeElement.scrollHeight - treeElement.clientHeight,
        );
        const nextTop = Math.min(
          maxScroll,
          Math.max(0, treeElement.scrollTop + delta),
        );
        treeElement.scrollTop = nextTop;
      }
      const stickyApi = window.__explorerStickyScopes;
      if (stickyApi && typeof stickyApi.update === 'function') {
        stickyApi.update();
      }
    }
  }

  function handleStickyScopeClick(event: MouseEvent): boolean {
    const treeElement = deps.getTreeElement();
    if (!treeElement) {
      return false;
    }
    const sticky = document.getElementById('fe-sticky-scopes');
    if (!sticky || sticky.style.display === 'none') {
      return false;
    }
    const stickyRect = sticky.getBoundingClientRect();
    if (event.clientY < stickyRect.top || event.clientY > stickyRect.bottom) {
      return false;
    }

    const slots = sticky.querySelectorAll<HTMLElement>('ul.fe-sticky-scope-slot');
    let bestSlot: HTMLElement | null = null;
    let bestZ = -Infinity;
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        const zIndex = Number(slot.style.zIndex || 0);
        if (zIndex > bestZ) {
          bestZ = zIndex;
          bestSlot = slot;
        }
      }
    }

    const stickyNode = bestSlot?.querySelector<HTMLLIElement>('li.fe-tree-node');
    const rel = stickyNode?.dataset.rel || null;
    if (!rel || rel === '.') {
      return true;
    }

    const dirLi = treeElement.querySelector<HTMLLIElement>(
      `li.fe-tree-node[data-kind="dir"][data-rel="${escapeRel(rel)}"]`,
    );
    if (dirLi?.dataset.open === 'true') {
      const slotRect = bestSlot?.getBoundingClientRect() || null;
      collapseDirectory(dirLi, rel, slotRect?.top ?? null);
    }
    return true;
  }

  async function handleTreeClick(event: MouseEvent): Promise<void> {
    if (handleStickyScopeClick(event)) {
      return;
    }

    const target = event.target;
    const li =
      target instanceof Element
        ? target.closest<HTMLLIElement>('li.fe-tree-node')
        : null;
    if (!li) {
      return;
    }

    const rel = li.dataset.rel;
    if (!rel) {
      return;
    }
    const kind = getNodeKind(li);

    if (target instanceof Element && target.closest('.fe-entry-checkbox')) {
      return;
    }

    const menuBtn =
      target instanceof Element
        ? target.closest<HTMLElement>('.fe-card-menu-btn')
        : null;
    if (menuBtn) {
      const entry = buildMenuEntry(li);
      if (entry) {
        deps.openCardMenuForEntry(entry, menuBtn);
      }
      return;
    }

    if (kind === 'dir') {
      if (rel === '.') {
        return;
      }
      if (
        li.closest('ul.fe-tree[data-tree-view="search"]') &&
        (await deps.handleSearchDirectoryClick(rel))
      ) {
        return;
      }
      const isOpen = li.dataset.open === 'true';
      if (isOpen) {
        collapseDirectory(li, rel);
      } else {
        li.dataset.open = 'true';
        if (deps.hasExplorerRpc()) {
          deps.notifyExplorer(EXPLORER_RPC_METHODS.list, { rel });
        }
        deps.markDirectoryOpen(rel, true);
      }
      return;
    }

    if (kind === 'file') {
      if (deps.getSelectModeDir()) {
        const checkbox = li.querySelector<HTMLInputElement>('.fe-entry-checkbox');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          deps.setEntrySelected(rel, checkbox.checked);
        }
        return;
      }
      await deps.openFile(rel);
    }
  }

  return {
    handleTreeClick,
  };
}
