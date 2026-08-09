interface ExplorerActiveFileUtilsDeps {
  getTreeElement(): HTMLElement | null;
  setTreeElement(next: HTMLElement | null): void;
  getActiveFileRel(): string | null;
  setActiveFileRelValue(next: string | null): void;
  getProjectPath(): string | null;
  expandToFile(rel: string): Promise<unknown>;
  toast(message: string): void;
}

interface ScrollToActiveFileOptions {
  silent?: boolean;
}

function queryFileNode(root: ParentNode, rel: string): HTMLLIElement | null {
  try {
    const escaped = window.CSS?.escape ? window.CSS.escape(rel) : null;
    if (escaped) {
      const node = root.querySelector<HTMLLIElement>(
        `li.fe-tree-node[data-kind="file"][data-rel="${escaped}"]`,
      );
      if (node) return node;
    }
  } catch {
    // Fall through to the manual scan below.
  }
  const nodes = root.querySelectorAll<HTMLLIElement>(
    'li.fe-tree-node[data-kind="file"]',
  );
  for (const node of nodes) {
    if ((node.dataset.rel || '') === rel) {
      return node;
    }
  }
  return null;
}

export function createExplorerActiveFileUtils(
  deps: ExplorerActiveFileUtilsDeps,
) {
  function getTreeRoot(): HTMLElement | null {
    let root = deps.getTreeElement();
    if (!root) {
      const fallback = document.getElementById('fe-file-tree');
      if (fallback instanceof HTMLElement) {
        root = fallback;
        deps.setTreeElement(root);
      }
    }
    return root;
  }

  function applyActiveFileMarker(): void {
    const root = getTreeRoot();
    if (!root) return;
    root
      .querySelectorAll<HTMLLIElement>('li.fe-tree-node.fe-active-file')
      .forEach((node) => node.classList.remove('fe-active-file'));
    const activeRel = deps.getActiveFileRel();
    if (!activeRel) return;
    const node = queryFileNode(root, activeRel);
    if (node) {
      node.classList.add('fe-active-file');
    }
  }

  function setActiveFileRel(nextRel: string | null): void {
    const normalized =
      typeof nextRel === 'string' && nextRel.trim() ? nextRel : null;
    deps.setActiveFileRelValue(normalized);
    applyActiveFileMarker();
  }

  function relFromAbsPath(absPath: string | null | undefined): string | null {
    const projectPath = deps.getProjectPath();
    if (!absPath || !projectPath) return null;
    const root = String(projectPath).replace(/\\/g, '/');
    const normalized = String(absPath).replace(/\\/g, '/');
    if (!normalized.startsWith(root)) return null;
    let rel = normalized.slice(root.length);
    if (rel.startsWith('/')) {
      rel = rel.slice(1);
    }
    return rel || '.';
  }

  function applyDraftFlag(rel: string | null | undefined, hasDraft: boolean): void {
    const root = getTreeRoot();
    if (!root || !rel || rel === '.') return;
    const node = queryFileNode(root, rel);
    if (node) {
      if (hasDraft) {
        node.dataset.hasDraft = '1';
        node.classList.add('fe-draft');
      } else {
        delete node.dataset.hasDraft;
        node.classList.remove('fe-draft');
      }
    }
    if (!hasDraft) return;
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      const dirRel = parts.slice(0, i).join('/');
      let dirNode: HTMLLIElement | null = null;
      try {
        const escaped = window.CSS?.escape ? window.CSS.escape(dirRel) : null;
        if (escaped) {
          dirNode = root.querySelector<HTMLLIElement>(
            `li.fe-tree-node[data-kind="dir"][data-rel="${escaped}"]`,
          );
        }
      } catch {
        dirNode = null;
      }
      if (!dirNode) continue;
      dirNode.dataset.hasDraft = '1';
      dirNode.classList.add('fe-dir-has-draft');
    }
    const rootNode = root.querySelector<HTMLLIElement>(
      'li.fe-tree-node.fe-tree-root',
    );
    if (rootNode) {
      rootNode.dataset.hasDraft = '1';
      rootNode.classList.add('fe-dir-has-draft');
    }
  }

  async function scrollToActiveFile(
    options: ScrollToActiveFileOptions = {},
  ): Promise<void> {
    const activeRel = deps.getActiveFileRel();
    if (!activeRel) {
      if (!options.silent) deps.toast('No opened file to reveal');
      return;
    }
    const root = getTreeRoot();
    if (!root) return;
    try {
      await deps.expandToFile(activeRel);
    } catch {
      if (!options.silent) deps.toast('Failed to expand tree');
      return;
    }
    if (deps.getActiveFileRel() !== activeRel) return;
    applyActiveFileMarker();
    const node = queryFileNode(root, activeRel);
    if (!node) {
      if (!options.silent) deps.toast('Opened file is not visible in the tree');
      return;
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  return {
    setActiveFileRel,
    applyActiveFileMarker,
    relFromAbsPath,
    applyDraftFlag,
    scrollToActiveFile,
  };
}
