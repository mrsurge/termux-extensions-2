import { EXPLORER_RPC_METHODS, type ExplorerRpcMethod } from '../rpc/contract.ts';
import type { JsonObject } from '../../rpc/transport.ts';

type ExplorerTimer = ReturnType<typeof setTimeout> | null;

interface ExplorerDirectoryStateHelpersDeps {
  getTreeElement(): HTMLElement | null;
  getSelectModeDir(): string | null;
  setSelectModeDir(next: string | null): void;
  clearSelectedEntries(): void;
  hasExplorerBus(): boolean;
  sendExplorerBus(method: ExplorerRpcMethod, payload: JsonObject): void;
  getOpenDirectories(): Set<string>;
  getOpenDirsInitialized(): boolean;
  getOpenDirsSyncTimer(): ExplorerTimer;
  setOpenDirsSyncTimer(next: ExplorerTimer): void;
  getOpenDirsSyncDebounce(): number;
}

export function createExplorerDirectoryStateHelpers(
  deps: ExplorerDirectoryStateHelpersDeps,
) {
  function collapseSubdirsOf(parentRel: string): void {
    const treeElement = deps.getTreeElement();
    if (!treeElement) return;
    const parentLi = treeElement.querySelector<HTMLLIElement>(
      `li.fe-tree-node[data-kind="dir"][data-rel="${parentRel}"]`,
    );
    if (!parentLi) return;
    const openSubdirs = parentLi.querySelectorAll<HTMLLIElement>(
      'li.fe-tree-node[data-kind="dir"][data-open="true"]',
    );
    openSubdirs.forEach((node) => {
      node.dataset.open = 'false';
      const childList = node.querySelector<HTMLUListElement>(':scope > ul.fe-tree');
      childList?.remove();
    });
  }

  function isInSelectMode(parentRel: string): boolean {
    return deps.getSelectModeDir() === parentRel;
  }

  function enableSelectMode(dirRel: string | null): void {
    if (!dirRel) return;
    deps.setSelectModeDir(dirRel);
    deps.clearSelectedEntries();
    collapseSubdirsOf(dirRel);
    if (deps.hasExplorerBus()) {
      deps.sendExplorerBus(EXPLORER_RPC_METHODS.list, { rel: dirRel });
    }
  }

  function disableSelectMode(): void {
    const wasDir = deps.getSelectModeDir();
    deps.setSelectModeDir(null);
    deps.clearSelectedEntries();
    if (wasDir && deps.hasExplorerBus()) {
      deps.sendExplorerBus(EXPLORER_RPC_METHODS.list, { rel: wasDir });
    }
  }

  function checkAutoDisableSelectMode(collapsedRel: string): void {
    if (deps.getSelectModeDir() === collapsedRel) {
      deps.setSelectModeDir(null);
      deps.clearSelectedEntries();
    }
  }

  function syncOpenDirsToBackend(): void {
    if (!deps.hasExplorerBus()) return;
    deps.sendExplorerBus(EXPLORER_RPC_METHODS.openDirsSet, {
      dirs: Array.from(deps.getOpenDirectories()),
    });
  }

  function scheduleOpenDirsSync(): void {
    const current = deps.getOpenDirsSyncTimer();
    if (current) {
      clearTimeout(current);
    }
    const next = setTimeout(() => {
      deps.setOpenDirsSyncTimer(null);
      syncOpenDirsToBackend();
    }, deps.getOpenDirsSyncDebounce());
    deps.setOpenDirsSyncTimer(next);
  }

  function markDirectoryOpen(rel: string, isOpen: boolean): void {
    if (!rel || rel === '.') return;
    const openDirectories = deps.getOpenDirectories();
    if (isOpen) {
      openDirectories.add(rel);
    } else {
      openDirectories.delete(rel);
      const prefix = `${rel}/`;
      for (const dir of openDirectories) {
        if (dir.startsWith(prefix)) {
          openDirectories.delete(dir);
        }
      }
    }
    if (deps.getOpenDirsInitialized()) {
      scheduleOpenDirsSync();
    }
  }

  return {
    isInSelectMode,
    enableSelectMode,
    disableSelectMode,
    collapseSubdirsOf,
    checkAutoDisableSelectMode,
    markDirectoryOpen,
    scheduleOpenDirsSync,
    syncOpenDirsToBackend,
  };
}
