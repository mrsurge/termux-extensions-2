import type { JsonObject } from '../../rpc/transport.ts';
import {
  EXPLORER_RPC_METHODS,
  type ExplorerRpcMethod,
} from '../rpc/contract.ts';
import type { ExplorerTreeEntry } from '../tree/types.ts';
import { renderExplorerTreeLabel } from '../tree/label.ts';
import type {
  ExplorerNameSearchItem,
  ExplorerNameSearchResults,
} from './types.ts';

const NAME_SEARCH_DEBOUNCE_MS = 500;
const SHALLOW_LIST_CONCURRENCY = 4;
const DIRECTORY_CENTER_SETTLE_MS = 350;

type ExplorerTimer = ReturnType<typeof setTimeout> | null;

interface NameSearchIdentity {
  searchId: string | null;
  jobId: string | null;
  projectGeneration: number | null;
}

export interface ExplorerNameTreeNode {
  entry: ExplorerTreeEntry;
  children: ExplorerNameTreeNode[];
  hitIndex: number | null;
}

interface ExplorerNameTreeSearchControllerDeps {
  getTreeElement(): HTMLElement | null;
  getProjectPath(): string | null;
  isStickyHeadersEnabled(): boolean;
  requestExplorer(
    method: ExplorerRpcMethod,
    payload: JsonObject,
    timeoutMs?: number,
  ): Promise<JsonObject>;
  renderEntriesInto(
    containerUl: HTMLElement | null,
    entries: unknown,
    parentRel?: string | null,
  ): void;
  closeAdvancedSearch(reason: string): void;
  focusDirectory(rel: string): Promise<void>;
  toast(message: string): void;
}

interface MutableProjectionNode extends ExplorerNameTreeNode {
  childMap: Map<string, MutableProjectionNode>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeRel(value: unknown): string {
  return typeof value === 'string'
    ? value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
    : '';
}

function basename(rel: string): string {
  const parts = rel.split('/').filter(Boolean);
  return parts.at(-1) || rel;
}

function parentRel(rel: string): string {
  const parts = rel.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/') || '.';
}

function entryKind(value: unknown): 'file' | 'dir' {
  return value === 'dir' ? 'dir' : 'file';
}

function normalizeSearchItems(value: unknown): ExplorerNameSearchItem[] {
  if (!isRecord(value) || !Array.isArray(value.results)) return [];
  const items: ExplorerNameSearchItem[] = [];
  for (const raw of value.results) {
    if (!isRecord(raw)) continue;
    const rel = normalizeRel(raw.rel);
    if (!rel) continue;
    items.push({
      rel,
      type: entryKind(raw.type),
      name: stringValue(raw.name) || basename(rel),
    });
  }
  return items;
}

function normalizeTreeEntries(value: unknown): ExplorerTreeEntry[] {
  if (!isRecord(value) || !Array.isArray(value.entries)) return [];
  return value.entries.filter(
    (entry): entry is ExplorerTreeEntry =>
      isRecord(entry) && Boolean(normalizeRel(entry.rel || entry.path)),
  );
}

function createMutableNode(
  rel: string,
  kind: 'file' | 'dir',
  name = basename(rel),
): MutableProjectionNode {
  return {
    entry: { rel, name, kind },
    children: [],
    childMap: new Map(),
    hitIndex: null,
  };
}

function sortNodes(nodes: MutableProjectionNode[]): void {
  nodes.sort((left, right) => {
    const leftKind = left.entry.kind === 'dir' ? 0 : 1;
    const rightKind = right.entry.kind === 'dir' ? 0 : 1;
    if (leftKind !== rightKind) return leftKind - rightKind;
    return String(left.entry.name || '').localeCompare(
      String(right.entry.name || ''),
      undefined,
      { sensitivity: 'base' },
    );
  });
  for (const node of nodes) sortNodes(node.children as MutableProjectionNode[]);
}

export function buildExplorerNameTreeProjection(
  items: readonly ExplorerNameSearchItem[],
  shallowListings: ReadonlyMap<string, readonly ExplorerTreeEntry[]>,
): ExplorerNameTreeNode[] {
  const root: MutableProjectionNode = {
    entry: { rel: '.', name: '.', kind: 'dir' },
    children: [],
    childMap: new Map(),
    hitIndex: null,
  };

  function ensureNode(
    rel: string,
    kind: 'file' | 'dir',
    name = basename(rel),
  ): MutableProjectionNode {
    const segments = rel.split('/').filter(Boolean);
    let parent = root;
    let current = '';
    for (let index = 0; index < segments.length; index += 1) {
      current = current ? `${current}/${segments[index]}` : segments[index];
      const isLeaf = index === segments.length - 1;
      let node = parent.childMap.get(current);
      if (!node) {
        node = createMutableNode(
          current,
          isLeaf ? kind : 'dir',
          isLeaf ? name : segments[index],
        );
        parent.childMap.set(current, node);
        parent.children.push(node);
      } else if (isLeaf) {
        node.entry = { ...node.entry, rel: current, kind, name };
      }
      parent = node;
    }
    return parent;
  }

  items.forEach((item, hitIndex) => {
    const rel = normalizeRel(item.rel);
    if (!rel) return;
    const kind = entryKind(item.type);
    const node = ensureNode(rel, kind, item.name || basename(rel));
    if (node.hitIndex === null) node.hitIndex = hitIndex;
  });

  items.forEach((item) => {
    const rel = normalizeRel(item.rel);
    if (!rel || item.type !== 'dir') return;
    const listing = shallowListings.get(rel) || [];
    for (const child of listing) {
      const childRel = normalizeRel(child.rel || child.path);
      if (!childRel || parentRel(childRel) !== rel) continue;
      const childKind = entryKind(child.kind);
      const node = ensureNode(
        childRel,
        childKind,
        typeof child.name === 'string' && child.name
          ? child.name
          : basename(childRel),
      );
      const hitIndex = node.hitIndex;
      node.entry = { ...child, rel: childRel, kind: childKind };
      node.hitIndex = hitIndex;
    }
  });

  sortNodes(root.children as MutableProjectionNode[]);
  return root.children;
}

let correlationSequence = 0;

function nextCorrelationId(): string {
  correlationSequence += 1;
  return `explorer-name-tree:${Date.now()}:${correlationSequence}`;
}

export function createExplorerNameTreeSearchController(
  deps: ExplorerNameTreeSearchControllerDeps,
) {
  let visible = false;
  let query = '';
  let loading = false;
  let complete = false;
  let error: string | null = null;
  let results: ExplorerNameSearchItem[] = [];
  let activeHitIndex = 0;
  let debounceTimer: ExplorerTimer = null;
  let generation = 0;
  let identity: NameSearchIdentity = {
    searchId: null,
    jobId: null,
    projectGeneration: null,
  };
  let lastAutoScrolledQuery = '';
  const shallowListings = new Map<string, ExplorerTreeEntry[]>();
  const queuedDirectories: string[] = [];
  const queuedDirectorySet = new Set<string>();
  let activeDirectoryRequests = 0;
  let boundTree: HTMLElement | null = null;

  function getRootNode(): HTMLLIElement | null {
    return deps
      .getTreeElement()
      ?.querySelector<HTMLLIElement>(':scope > li.fe-tree-root') || null;
  }

  function getNormalList(root = getRootNode()): HTMLUListElement | null {
    return (
      root?.querySelector<HTMLUListElement>(
        ':scope > ul.fe-tree[data-tree-view="normal"]',
      ) || null
    );
  }

  function getSearchList(root = getRootNode()): HTMLUListElement | null {
    return (
      root?.querySelector<HTMLUListElement>(
        ':scope > ul.fe-tree[data-tree-view="search"]',
      ) || null
    );
  }

  function clearDebounce(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  function cancelIdentity(
    target: NameSearchIdentity,
    reason: string,
  ): void {
    if (!target.searchId && !target.jobId) return;
    const payload: JsonObject = {
      dto: 'SearchJobCancelRequest',
      version: 1,
      reason,
    };
    if (target.searchId) payload.searchId = target.searchId;
    if (target.jobId) payload.jobId = target.jobId;
    if (typeof target.projectGeneration === 'number') {
      payload.projectGeneration = target.projectGeneration;
    }
    const root = deps.getProjectPath();
    if (root) payload.root = root;
    void deps
      .requestExplorer(EXPLORER_RPC_METHODS.searchCancel, payload, 5000)
      .catch(() => {});
  }

  function resetResultState(reason: string): void {
    clearDebounce();
    cancelIdentity(identity, reason);
    identity = { searchId: null, jobId: null, projectGeneration: null };
    results = [];
    loading = false;
    complete = false;
    error = null;
    activeHitIndex = 0;
    lastAutoScrolledQuery = '';
    shallowListings.clear();
    queuedDirectories.length = 0;
    queuedDirectorySet.clear();
  }

  function ensureSearchList(root: HTMLLIElement): HTMLUListElement {
    let list = getSearchList(root);
    if (!list) {
      list = document.createElement('ul');
      list.className = 'fe-tree fe-tree-search-results';
      list.dataset.treeView = 'search';
      root.appendChild(list);
    }
    return list;
  }

  function setSearchListMessage(list: HTMLUListElement, message: string): void {
    list.replaceChildren();
    const empty = document.createElement('li');
    empty.className = 'fe-tree-empty fe-tree-search-message';
    empty.textContent = message;
    list.appendChild(empty);
  }

  function renderProjectionNodes(
    container: HTMLUListElement,
    nodes: readonly ExplorerNameTreeNode[],
    parent: string,
  ): void {
    deps.renderEntriesInto(
      container,
      nodes.map((node) => node.entry),
      parent,
    );
    for (const node of nodes) {
      const rel = normalizeRel(node.entry.rel || node.entry.path);
      if (!rel) continue;
      const li = Array.from(container.children).find(
        (child): child is HTMLLIElement =>
          child instanceof HTMLLIElement && child.dataset.rel === rel,
      );
      if (!li) continue;
      li.classList.toggle('fe-tree-search-hit', node.hitIndex !== null);
      if (node.hitIndex !== null) {
        li.dataset.searchHitIndex = String(node.hitIndex);
      } else {
        delete li.dataset.searchHitIndex;
      }
      const isActive = node.hitIndex === activeHitIndex;
      li.classList.toggle('fe-tree-search-hit-active', isActive);
      if (node.children.length === 0) continue;
      li.dataset.open = 'true';
      let childList = li.querySelector<HTMLUListElement>(':scope > ul.fe-tree');
      if (!childList) {
        childList = document.createElement('ul');
        childList.className = 'fe-tree';
        li.appendChild(childList);
      }
      renderProjectionNodes(childList, node.children, rel);
    }
  }

  function renderRootChrome(root: HTMLLIElement): void {
    const label = root.querySelector<HTMLElement>(':scope > .fe-tree-text');
    const actions = root.querySelector<HTMLElement>(
      ':scope > .fe-tree-root-actions',
    );
    const searchButton = actions?.querySelector<HTMLButtonElement>(
      '.fe-tree-search-btn',
    );
    if (!label || !actions || !searchButton) return;

    if (!visible) {
      label.classList.remove('fe-tree-search-label');
      renderExplorerTreeLabel(label, root.dataset.name || 'Project');
      actions
        .querySelectorAll('.fe-tree-search-control')
        .forEach((control) => control.remove());
      searchButton.hidden = false;
      return;
    }

    label.classList.add('fe-tree-search-label');
    let input = label.querySelector<HTMLInputElement>('.fe-tree-search-input');
    if (!input) {
      label.replaceChildren();
      input = document.createElement('input');
      input.type = 'search';
      input.className = 'fe-tree-search-input';
      input.placeholder = 'Search files/folders…';
      input.autocomplete = 'off';
      input.spellcheck = false;
      label.appendChild(input);
    }
    if (input.value !== query) input.value = query;

    searchButton.hidden = true;
    let count = actions.querySelector<HTMLElement>('.fe-tree-search-count');
    if (!count) {
      count = document.createElement('span');
      count.className = 'fe-tree-search-control fe-tree-search-count';
      actions.insertBefore(count, actions.firstChild);
    }
    count.textContent = results.length
      ? `${Math.min(activeHitIndex + 1, results.length)}/${results.length}`
      : loading
        ? '…'
        : '0';

    const controls: Array<[string, string, string]> = [
      ['fe-tree-search-prev', '↑', 'Previous file or folder match'],
      ['fe-tree-search-next', '↓', 'Next file or folder match'],
      ['fe-tree-search-clear', '✕', 'Clear file and folder search'],
    ];
    for (const [className, text, title] of controls) {
      let button = actions.querySelector<HTMLButtonElement>(`.${className}`);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = `fe-tree-search-control ${className}`;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.textContent = text;
        actions.insertBefore(
          button,
          actions.querySelector('.fe-card-menu-btn'),
        );
      }
      button.disabled = className !== 'fe-tree-search-clear' && results.length < 2;
    }
  }

  function render(): void {
    const root = getRootNode();
    if (!root) return;
    renderRootChrome(root);
    const normal = getNormalList(root);
    const hasActiveQuery = visible && query.length >= 2;
    if (normal) normal.hidden = hasActiveQuery;

    if (!hasActiveQuery) {
      getSearchList(root)?.remove();
      return;
    }

    const list = ensureSearchList(root);
    if (error) {
      setSearchListMessage(list, error);
      return;
    }
    if (results.length === 0) {
      setSearchListMessage(
        list,
        loading || !complete ? 'Searching…' : 'No file or folder matches',
      );
      return;
    }

    const projection = buildExplorerNameTreeProjection(results, shallowListings);
    list.replaceChildren();
    renderProjectionNodes(list, projection, '.');
  }

  function scrollToCurrentHit(smooth = true): void {
    if (results.length === 0) return;
    activeHitIndex = Math.max(0, Math.min(activeHitIndex, results.length - 1));
    render();
    const node = getSearchList()?.querySelector<HTMLElement>(
      `[data-search-hit-index="${activeHitIndex}"]`,
    );
    node?.scrollIntoView({
      block: 'center',
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  function moveHit(delta: number): void {
    if (results.length === 0) return;
    activeHitIndex =
      (activeHitIndex + delta + results.length) % results.length;
    scrollToCurrentHit();
  }

  function centerNormalTreeDirectory(rel: string): void {
    const normal = getNormalList();
    if (!normal) return;
    const node = Array.from(
      normal.querySelectorAll<HTMLLIElement>(
        'li.fe-tree-node[data-kind="dir"]',
      ),
    ).find((candidate) => normalizeRel(candidate.dataset.rel) === rel);
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function pumpDirectoryQueue(expectedGeneration: number): void {
    while (
      activeDirectoryRequests < SHALLOW_LIST_CONCURRENCY &&
      queuedDirectories.length > 0
    ) {
      const rel = queuedDirectories.shift();
      if (!rel) continue;
      activeDirectoryRequests += 1;
      void deps
        .requestExplorer(EXPLORER_RPC_METHODS.list, { rel }, 8000)
        .then((payload) => {
          if (generation !== expectedGeneration) return;
          shallowListings.set(rel, normalizeTreeEntries(payload));
          render();
        })
        .catch(() => {
          if (generation === expectedGeneration) shallowListings.set(rel, []);
        })
        .finally(() => {
          activeDirectoryRequests -= 1;
          // Superseded requests still occupied a bounded slot. Give the
          // current generation a chance to drain when any slot is released.
          pumpDirectoryQueue(generation);
        });
    }
  }

  function queueDirectoryListings(): void {
    const expectedGeneration = generation;
    for (const item of results) {
      const rel = normalizeRel(item.rel);
      if (
        item.type !== 'dir' ||
        !rel ||
        shallowListings.has(rel) ||
        queuedDirectorySet.has(rel)
      ) {
        continue;
      }
      queuedDirectorySet.add(rel);
      queuedDirectories.push(rel);
    }
    pumpDirectoryQueue(expectedGeneration);
  }

  async function runSearch(
    expectedGeneration: number,
    expectedQuery: string,
    expectedRoot: string,
  ): Promise<void> {
    const correlationId = nextCorrelationId();
    try {
      const started = await deps.requestExplorer(
        EXPLORER_RPC_METHODS.searchRun,
        {
          mode: 'name',
          query: expectedQuery,
          root: expectedRoot,
          correlationId,
        },
        10000,
      );
      const startedIdentity: NameSearchIdentity = {
        searchId:
          stringValue(started.searchId) || stringValue(started.jobId),
        jobId: stringValue(started.jobId) || stringValue(started.opId),
        projectGeneration: numberValue(started.projectGeneration),
      };
      if (
        generation !== expectedGeneration ||
        query !== expectedQuery ||
        deps.getProjectPath() !== expectedRoot
      ) {
        cancelIdentity(startedIdentity, 'superseded');
        return;
      }
      identity = startedIdentity;
    } catch (reason) {
      if (generation !== expectedGeneration) return;
      loading = false;
      complete = true;
      error = reason instanceof Error ? reason.message : 'File search failed';
      render();
    }
  }

  function updateQuery(nextQuery: string): void {
    const next = nextQuery;
    if (next === query) return;
    generation += 1;
    resetResultState('replaced');
    query = next;
    render();
    if (query.length < 2) return;
    const root = deps.getProjectPath();
    if (!root) {
      error = 'No project open';
      complete = true;
      render();
      return;
    }
    loading = true;
    render();
    const expectedGeneration = generation;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runSearch(expectedGeneration, query, root);
    }, NAME_SEARCH_DEBOUNCE_MS);
  }

  function clearQueryKeepInput(): void {
    generation += 1;
    resetResultState('cleared');
    query = '';
    render();
    setTimeout(() => {
      getRootNode()
        ?.querySelector<HTMLInputElement>('.fe-tree-search-input')
        ?.focus();
    }, 0);
  }

  function close(reason = 'closed'): void {
    generation += 1;
    resetResultState(reason);
    query = '';
    visible = false;
    render();
  }

  function open(): void {
    if (!deps.getProjectPath()) {
      deps.toast('No project open');
      return;
    }
    deps.closeAdvancedSearch('nameSearchOpened');
    visible = true;
    render();
    setTimeout(() => {
      getRootNode()
        ?.querySelector<HTMLInputElement>('.fe-tree-search-input')
        ?.focus();
    }, 0);
  }

  function matchesIdentity(payload: JsonObject): boolean {
    const searchId = stringValue(payload.searchId);
    const jobId = stringValue(payload.jobId) || stringValue(payload.opId);
    if (identity.searchId && searchId && identity.searchId !== searchId) {
      return false;
    }
    if (identity.jobId && jobId && identity.jobId !== jobId) return false;
    return true;
  }

  function handleResultsUpdated(payload: JsonObject): boolean {
    if (payload.mode !== 'name') return false;
    if (!visible || query.length < 2) return true;
    if (stringValue(payload.query) !== query || !matchesIdentity(payload)) {
      return true;
    }
    const next = normalizeSearchItems(payload as ExplorerNameSearchResults);
    results = next;
    activeHitIndex = Math.min(activeHitIndex, Math.max(0, results.length - 1));
    loading = payload.complete === false;
    complete = payload.complete !== false;
    error = null;
    render();
    queueDirectoryListings();
    if (
      results.length > 0 &&
      deps.isStickyHeadersEnabled() &&
      lastAutoScrolledQuery !== query
    ) {
      lastAutoScrolledQuery = query;
      activeHitIndex = 0;
      setTimeout(() => scrollToCurrentHit(), 0);
    }
    return true;
  }

  function handleJobProgress(payload: JsonObject): boolean {
    if (payload.kind !== 'name') return false;
    if (!visible || !matchesIdentity(payload)) return true;
    loading = true;
    render();
    return true;
  }

  function handleJobResult(payload: JsonObject): boolean {
    return payload.kind === 'name';
  }

  function handleJobDone(payload: JsonObject): boolean {
    if (payload.kind !== 'name') return false;
    if (!visible || !matchesIdentity(payload)) return true;
    loading = false;
    complete = true;
    render();
    return true;
  }

  function handleJobError(payload: JsonObject): boolean {
    if (payload.kind !== 'name') return false;
    if (!visible || !matchesIdentity(payload)) return true;
    loading = false;
    complete = true;
    error = stringValue(payload.message) || 'File search failed';
    render();
    return true;
  }

  function bind(tree: HTMLElement | null): void {
    if (!tree || boundTree === tree) return;
    boundTree = tree;
    tree.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.fe-tree-search-btn')) {
        event.preventDefault();
        event.stopPropagation();
        open();
      } else if (target.closest('.fe-tree-search-clear')) {
        event.preventDefault();
        event.stopPropagation();
        clearQueryKeepInput();
      } else if (target.closest('.fe-tree-search-prev')) {
        event.preventDefault();
        event.stopPropagation();
        moveHit(-1);
      } else if (target.closest('.fe-tree-search-next')) {
        event.preventDefault();
        event.stopPropagation();
        moveHit(1);
      }
    });
    tree.addEventListener('input', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.matches('.fe-tree-search-input')) {
        updateQuery(target.value);
      }
    });
    tree.addEventListener('keydown', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.matches('.fe-tree-search-input')) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        clearQueryKeepInput();
      } else if (event.key === 'ArrowDown' && event.altKey) {
        event.preventDefault();
        moveHit(1);
      } else if (event.key === 'ArrowUp' && event.altKey) {
        event.preventDefault();
        moveHit(-1);
      }
    });
    tree.addEventListener('focusout', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.matches('.fe-tree-search-input')) {
        return;
      }
      setTimeout(() => {
        if (!visible || query) return;
        const root = getRootNode();
        const active = document.activeElement;
        if (root && active instanceof Element && root.contains(active)) return;
        if (
          active instanceof Element &&
          active.matches('.fe-sticky-scopes .fe-tree-search-input')
        ) {
          return;
        }
        close('emptyBlur');
      }, 0);
    });
  }

  async function handleSearchDirectoryClick(rel: string): Promise<boolean> {
    const normalized = normalizeRel(rel);
    if (!visible || query.length < 2 || !normalized || normalized === '.') {
      return false;
    }
    const projectPath = deps.getProjectPath();
    try {
      await deps.focusDirectory(normalized);
      close('directorySelected');
      await new Promise<void>((resolve) => {
        setTimeout(resolve, DIRECTORY_CENTER_SETTLE_MS);
      });
      if (visible || deps.getProjectPath() !== projectPath) return true;
      centerNormalTreeDirectory(normalized);
    } catch (reason) {
      deps.toast(
        reason instanceof Error && reason.message
          ? `Could not open directory: ${reason.message}`
          : 'Could not open directory',
      );
    }
    return true;
  }

  return {
    bind,
    open,
    close,
    render,
    isVisible: () => visible,
    handleSearchDirectoryClick,
    handleResultsUpdated,
    handleJobProgress,
    handleJobResult,
    handleJobDone,
    handleJobError,
  };
}
