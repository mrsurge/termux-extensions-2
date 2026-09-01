export function getExplorerNormalTreeList(
  treeElement: HTMLElement | null,
): HTMLUListElement | null {
  return (
    treeElement?.querySelector<HTMLUListElement>(
      ':scope > li.fe-tree-root > ul.fe-tree[data-tree-view="normal"]',
    ) || null
  );
}

export function queryExplorerNormalTreeNode(
  treeElement: HTMLElement | null,
  selector: string,
): HTMLLIElement | null {
  return getExplorerNormalTreeList(treeElement)?.querySelector<HTMLLIElement>(
    selector,
  ) || null;
}

export function getExplorerDirectoryChain(rel: string): string[] {
  const normalized = rel.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized === '.') return [];

  const chain: string[] = [];
  let current = '';
  for (const part of normalized.split('/').filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    chain.push(current);
  }
  return chain;
}

export function reconcileExplorerNormalTreeOpenDirectories(
  normalTree: HTMLUListElement | null,
  directories: readonly string[],
): void {
  if (!normalTree) return;
  const retained = new Set(
    directories
      .map((rel) => rel.replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''))
      .filter((rel) => rel && rel !== '.'),
  );

  normalTree
    .querySelectorAll<HTMLLIElement>('li.fe-tree-node[data-kind="dir"]')
    .forEach((node) => {
      const nodeRel = (node.dataset.rel || '')
        .replaceAll('\\', '/')
        .replace(/^\/+|\/+$/g, '');
      if (retained.has(nodeRel)) {
        node.dataset.open = 'true';
        return;
      }
      node.dataset.open = 'false';
      node.querySelector<HTMLUListElement>(':scope > ul.fe-tree')?.remove();
    });
}
