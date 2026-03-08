export function createExplorerDirectoryStateHelpers(deps) {
  function collapseSubdirsOf(parentRel) {
    const treeElement = deps.getTreeElement();
    if (!treeElement) return;
    const parentLi = treeElement.querySelector(
      `li.fe-tree-node[data-kind="dir"][data-rel="${parentRel}"]`,
    );
    if (!parentLi) return;
    const openSubdirs = parentLi.querySelectorAll(
      'li.fe-tree-node[data-kind="dir"][data-open="true"]',
    );
    openSubdirs.forEach((li) => {
      li.dataset.open = 'false';
      const childList = li.querySelector(':scope > ul.fe-tree');
      if (childList) childList.remove();
    });
  }

  function isInSelectMode(parentRel) {
    return deps.getSelectModeDir() === parentRel;
  }

  function enableSelectMode(dirRel) {
    if (!dirRel) return;
    deps.setSelectModeDir(dirRel);
    deps.clearSelectedEntries();
    collapseSubdirsOf(dirRel);
    if (deps.hasExplorerBus()) deps.sendExplorerBus('explorer:list', { rel: dirRel });
  }

  function disableSelectMode() {
    const wasDir = deps.getSelectModeDir();
    deps.setSelectModeDir(null);
    deps.clearSelectedEntries();
    if (wasDir && deps.hasExplorerBus()) deps.sendExplorerBus('explorer:list', { rel: wasDir });
  }

  function checkAutoDisableSelectMode(collapsedRel) {
    if (deps.getSelectModeDir() && deps.getSelectModeDir() === collapsedRel) {
      deps.setSelectModeDir(null);
      deps.clearSelectedEntries();
    }
  }

  function syncOpenDirsToBackend() {
    if (!deps.hasExplorerBus()) return;
    deps.sendExplorerBus('explorer:setOpenDirs', { dirs: Array.from(deps.getOpenDirectories()) });
  }

  function scheduleOpenDirsSync() {
    const current = deps.getOpenDirsSyncTimer();
    if (current) clearTimeout(current);
    const next = setTimeout(() => {
      deps.setOpenDirsSyncTimer(null);
      syncOpenDirsToBackend();
    }, deps.getOpenDirsSyncDebounce());
    deps.setOpenDirsSyncTimer(next);
  }

  function markDirectoryOpen(rel, isOpen) {
    if (!rel || rel === '.') return;
    const openDirectories = deps.getOpenDirectories();
    if (isOpen) {
      openDirectories.add(rel);
    } else {
      openDirectories.delete(rel);
      const prefix = rel + '/';
      for (const dir of openDirectories) {
        if (dir.startsWith(prefix)) openDirectories.delete(dir);
      }
    }
    if (deps.getOpenDirsInitialized()) scheduleOpenDirsSync();
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
