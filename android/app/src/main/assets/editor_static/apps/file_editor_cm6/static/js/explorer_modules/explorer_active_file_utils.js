export function createExplorerActiveFileUtils(deps) {
  function getTreeRoot() {
    let root = deps.getTreeElement();
    if (!root) {
      root = document.getElementById('fe-file-tree');
      if (root) deps.setTreeElement(root);
    }
    return root;
  }

  function findFileNode(root, rel) {
    let node = null;
    try {
      const esc = window.CSS && CSS.escape ? CSS.escape(rel) : null;
      if (esc) {
        node = root.querySelector(
          `li.fe-tree-node[data-kind="file"][data-rel="${esc}"]`,
        );
      }
    } catch {
      node = null;
    }
    if (node) return node;
    const nodes = root.querySelectorAll('li.fe-tree-node[data-kind="file"]');
    for (const li of nodes) {
      if ((li.dataset.rel || '') === rel) return li;
    }
    return null;
  }

  function applyActiveFileMarker() {
    const root = getTreeRoot();
    if (!root) return;
    root
      .querySelectorAll('li.fe-tree-node.fe-active-file')
      .forEach((li) => li.classList.remove('fe-active-file'));
    const activeRel = deps.getActiveFileRel();
    if (!activeRel) return;
    const node = findFileNode(root, activeRel);
    if (node) node.classList.add('fe-active-file');
  }

  function setActiveFileRel(nextRel) {
    const normalized =
      typeof nextRel === 'string' && nextRel.trim() ? nextRel : null;
    deps.setActiveFileRelValue(normalized);
    applyActiveFileMarker();
    try {
      const el = document.getElementById('fe-file-name');
      if (el && normalized) {
        const i = normalized.lastIndexOf('/');
        const name = i >= 0 ? normalized.slice(i + 1) : normalized;
        if (name && (!el.textContent || el.textContent === 'Untitled')) {
          el.textContent = name;
          el.title = normalized;
        }
      }
    } catch {}
  }

  function relFromAbsPath(absPath) {
    const projectPath = deps.getProjectPath();
    if (!absPath || !projectPath) return null;
    const root = String(projectPath).replace(/\\/g, '/');
    const normalized = String(absPath).replace(/\\/g, '/');
    if (!normalized.startsWith(root)) return null;
    let rel = normalized.slice(root.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel || '.';
  }

  function applyDraftFlag(rel, hasDraft) {
    const root = getTreeRoot();
    if (!root || !rel || rel === '.') return;
    const node = findFileNode(root, rel);
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
      let dirNode = null;
      try {
        const esc = window.CSS && CSS.escape ? CSS.escape(dirRel) : null;
        if (esc) {
          dirNode = root.querySelector(
            `li.fe-tree-node[data-kind="dir"][data-rel="${esc}"]`,
          );
        }
      } catch {
        dirNode = null;
      }
      if (!dirNode) continue;
      dirNode.dataset.hasDraft = '1';
      dirNode.classList.add('fe-dir-has-draft');
    }
    const rootNode = root.querySelector('li.fe-tree-node.fe-tree-root');
    if (rootNode) {
      rootNode.dataset.hasDraft = '1';
      rootNode.classList.add('fe-dir-has-draft');
    }
  }

  async function scrollToActiveFile() {
    const activeRel = deps.getActiveFileRel();
    if (!activeRel) {
      deps.toast('No opened file to reveal');
      return;
    }
    const root = getTreeRoot();
    if (!root) return;
    try {
      await deps.expandToFile(activeRel);
    } catch {
      deps.toast('Failed to expand tree');
      return;
    }
    applyActiveFileMarker();
    const node = findFileNode(root, activeRel);
    if (!node) {
      deps.toast('Opened file is not visible in the tree');
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
