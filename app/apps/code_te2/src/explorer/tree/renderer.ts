import type { ExplorerTreeEntry } from './types.ts';
import { renderExplorerTreeLabel } from './label.ts';

interface ExplorerTreeRendererDeps {
  getTreeElement(): HTMLElement | null;
  setTreeElement(next: HTMLElement | null): void;
  getProjectPath(): string | null;
  clearElement(element: HTMLElement): void;
  basename(path: string): string;
  isInSelectMode(parentRel: string): boolean;
  isEntrySelected(rel: string): boolean;
  setEntrySelected(rel: string, selected: boolean): void;
  applySetiIconToSpan(
    span: HTMLElement,
    fileName: string,
    kind?: string,
  ): void;
  applyAggregatedGitStatusFlags(): void;
  applyAggregatedDiagnosticFlags(): void;
}

export interface ExplorerTreeRenderOptions {
  applyAggregatedDecorations?: boolean;
}

function isTreeEntry(value: unknown): value is ExplorerTreeEntry {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEntries(entries: unknown): ExplorerTreeEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.filter(isTreeEntry);
}

function getEntryRel(entry: ExplorerTreeEntry): string {
  if (typeof entry.rel === 'string' && entry.rel) {
    return entry.rel;
  }
  if (typeof entry.path === 'string' && entry.path) {
    return entry.path;
  }
  return '';
}

function getEntryKind(entry: ExplorerTreeEntry): string {
  return typeof entry.kind === 'string' && entry.kind ? entry.kind : 'file';
}

function getEntryName(entry: ExplorerTreeEntry): string {
  return typeof entry.name === 'string' ? entry.name : '';
}

function getEntryGitFlags(entry: ExplorerTreeEntry): string[] {
  return Array.isArray(entry.gitFlags)
    ? entry.gitFlags.filter((flag): flag is string => typeof flag === 'string')
    : [];
}

function getChildTreeDepth(containerUl: HTMLElement): number {
  const parent = containerUl.closest<HTMLLIElement>(
    'li.fe-tree-node[data-kind="dir"]',
  );
  const parentDepth = Number.parseInt(parent?.dataset.treeDepth || '', 10);
  if (Number.isFinite(parentDepth)) {
    return parentDepth + 1;
  }

  let depth = 0;
  let cursor = parent;
  while (cursor) {
    depth += 1;
    cursor =
      cursor.parentElement?.closest<HTMLLIElement>(
        'li.fe-tree-node[data-kind="dir"]',
      ) || null;
  }
  return depth;
}

function applyTreeDepthMetadata(
  node: HTMLLIElement,
  kind: string,
  depth: number,
): void {
  if (kind !== 'dir') {
    delete node.dataset.treeDepth;
    delete node.dataset.depthParity;
    return;
  }
  node.dataset.treeDepth = String(depth);
  node.dataset.depthParity = depth % 2 === 0 ? 'even' : 'odd';
}

export function createExplorerTreeRenderer(deps: ExplorerTreeRendererDeps) {
  function applyAggregatedDecorations(): void {
    deps.applyAggregatedGitStatusFlags();
    deps.applyAggregatedDiagnosticFlags();
  }

  function renderExplorerTree(): void {
    let treeElement = deps.getTreeElement();
    if (!treeElement) {
      const next = document.getElementById('fe-file-tree');
      if (!(next instanceof HTMLElement)) {
        return;
      }
      deps.setTreeElement(next);
      treeElement = next;
    }
    deps.clearElement(treeElement);

    const rootLi = document.createElement('li');
    rootLi.className = 'fe-tree-node fe-tree-root';
    rootLi.dataset.kind = 'dir';
    rootLi.dataset.rel = '.';
    rootLi.dataset.open = 'true';
    applyTreeDepthMetadata(rootLi, 'dir', 0);

    const icon = document.createElement('span');
    icon.className = 'fe-entry-icon fe-entry-icon-dir';

    const text = document.createElement('span');
    text.className = 'fe-tree-text';
    const baseName = deps.basename(deps.getProjectPath() || '') || 'Project';
    rootLi.dataset.name = baseName;
    renderExplorerTreeLabel(text, baseName);

    const actions = document.createElement('div');
    actions.className = 'fe-tree-root-actions';

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'fe-tree-search-btn';
    searchBtn.title = 'Search files and folders';
    searchBtn.setAttribute('aria-label', 'Search files and folders');
    searchBtn.textContent = '🔍';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'fe-card-menu-btn';
    menuBtn.textContent = '⋮';

    actions.appendChild(searchBtn);
    actions.appendChild(menuBtn);

    const childList = document.createElement('ul');
    childList.className = 'fe-tree fe-tree-normal';
    childList.dataset.treeView = 'normal';

    rootLi.appendChild(icon);
    rootLi.appendChild(text);
    rootLi.appendChild(actions);
    rootLi.appendChild(childList);
    treeElement.appendChild(rootLi);
  }

  function renderEntriesInto(
    containerUl: HTMLElement | null,
    entries: unknown,
    parentRel: string | null = null,
    options: ExplorerTreeRenderOptions = {},
  ): void {
    if (!(containerUl instanceof HTMLElement)) {
      return;
    }

    let resolvedParentRel = parentRel;
    if (resolvedParentRel === null) {
      const parentLi =
        containerUl.closest<HTMLLIElement>('li.fe-tree-node[data-kind="dir"]');
      resolvedParentRel = parentLi?.dataset.rel || '.';
    }

    const inSelectMode = deps.isInSelectMode(resolvedParentRel);
    containerUl.classList.toggle('fe-tree-select-mode', inSelectMode);
    const childTreeDepth = getChildTreeDepth(containerUl);

    const list = normalizeEntries(entries);
    const newRels = new Set(list.map((entry) => getEntryRel(entry)));

    const existingNodes = new Map<string, HTMLLIElement>();
    Array.from(containerUl.children).forEach((child) => {
      if (!(child instanceof HTMLLIElement)) {
        return;
      }
      const rel = child.dataset.rel;
      if (rel) {
        existingNodes.set(rel, child);
      }
    });

    existingNodes.forEach((node, rel) => {
      if (!newRels.has(rel)) {
        node.remove();
      }
    });

    list.forEach((entry, index) => {
      const rel = getEntryRel(entry);
      let li = existingNodes.get(rel);
      const isNew = !li;

      if (!li) {
        li = document.createElement('li');
        li.className = 'fe-tree-node';
        li.dataset.rel = rel;
        if (index < containerUl.children.length) {
          containerUl.insertBefore(li, containerUl.children[index]);
        } else {
          containerUl.appendChild(li);
        }
      } else {
        const currentNodeAtIndex = containerUl.children[index];
        if (currentNodeAtIndex && currentNodeAtIndex !== li) {
          containerUl.insertBefore(li, currentNodeAtIndex);
        } else if (!currentNodeAtIndex) {
          containerUl.appendChild(li);
        }
      }

      const kind = getEntryKind(entry);
      const name = getEntryName(entry);
      li.dataset.kind = kind;
      li.dataset.name = name;
      applyTreeDepthMetadata(li, kind, childTreeDepth);

      if (typeof entry.gitStatus === 'string' && entry.gitStatus) {
        li.dataset.gitStatus = entry.gitStatus;
      } else {
        delete li.dataset.gitStatus;
      }

      const flags = getEntryGitFlags(entry);
      if (flags.length > 0) {
        li.dataset.gitFlags = flags.join(',');
      } else {
        delete li.dataset.gitFlags;
      }

      if (entry.hasDraft) {
        li.dataset.hasDraft = '1';
      } else {
        delete li.dataset.hasDraft;
      }

      const classesToRemove: string[] = [];
      li.classList.forEach((className) => {
        if (
          className.startsWith('fe-git-') ||
          className.startsWith('fe-dir-has-') ||
          className === 'fe-draft'
        ) {
          classesToRemove.push(className);
        }
      });
      classesToRemove.forEach((className) => li.classList.remove(className));

      if (li.dataset.gitStatus) {
        li.classList.add(`fe-git-${li.dataset.gitStatus}`);
      }
      if (li.dataset.gitFlags) {
        li.dataset.gitFlags.split(',').forEach((flag) => {
          if (flag) {
            li.classList.add(`fe-dir-has-${flag}`);
          }
        });
      }
      if (li.dataset.hasDraft === '1') {
        if (kind === 'file') {
          li.classList.add('fe-draft');
        } else {
          li.classList.add('fe-dir-has-draft');
        }
      }

      let iconSpan = li.querySelector<HTMLElement>('.fe-entry-icon');
      let textSpan = li.querySelector<HTMLElement>('.fe-tree-text');
      let checkbox = li.querySelector<HTMLInputElement>('.fe-entry-checkbox');
      const hasCheckbox = checkbox instanceof HTMLInputElement;
      const needsCheckbox = inSelectMode;

      if (isNew || hasCheckbox !== needsCheckbox) {
        const childUl = li.querySelector<HTMLUListElement>('ul.fe-tree');
        Array.from(li.childNodes).forEach((node) => {
          if (node !== childUl) {
            node.remove();
          }
        });

        if (inSelectMode) {
          const nextCheckbox = document.createElement('input');
          nextCheckbox.type = 'checkbox';
          nextCheckbox.className = 'fe-entry-checkbox';
          nextCheckbox.dataset.rel = rel;
          nextCheckbox.checked = deps.isEntrySelected(rel);
          nextCheckbox.addEventListener('change', (event) => {
            event.stopPropagation();
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
              return;
            }
            deps.setEntrySelected(rel, target.checked);
          });
          li.insertBefore(nextCheckbox, childUl);
          checkbox = nextCheckbox;
        } else {
          checkbox = null;
        }

        const nextIconSpan = document.createElement('span');
        nextIconSpan.className = `fe-entry-icon fe-entry-icon-${kind}`;
        li.insertBefore(nextIconSpan, childUl);
        deps.applySetiIconToSpan(nextIconSpan, name, kind);
        iconSpan = nextIconSpan;

        const nextTextSpan = document.createElement('span');
        nextTextSpan.className = 'fe-tree-text';
        renderExplorerTreeLabel(nextTextSpan, name);
        li.insertBefore(nextTextSpan, childUl);
        textSpan = nextTextSpan;

        if (!inSelectMode) {
          const menuButton = document.createElement('button');
          menuButton.className = 'fe-card-menu-btn';
          menuButton.textContent = '⋮';
          li.insertBefore(menuButton, childUl);
        }
      } else {
        if (iconSpan) {
          iconSpan.className = `fe-entry-icon fe-entry-icon-${kind}`;
          deps.applySetiIconToSpan(iconSpan, name, kind);
        }
        if (textSpan) {
          renderExplorerTreeLabel(textSpan, name);
        }
        if (checkbox) {
          checkbox.dataset.rel = rel;
          checkbox.checked = deps.isEntrySelected(rel);
        }
      }
    });

    if (options.applyAggregatedDecorations !== false) {
      applyAggregatedDecorations();
    }
  }

  return {
    renderExplorerTree,
    renderEntriesInto,
    applyAggregatedDecorations,
  };
}
