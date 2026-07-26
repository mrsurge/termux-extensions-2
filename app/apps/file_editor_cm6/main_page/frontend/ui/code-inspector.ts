type JsonObject = Record<string, unknown>;

interface CodeInspectorPanelDeps {
  openDrawer(): void;
  closeDrawer(): void;
  requestCommand(payload: JsonObject): Promise<unknown>;
  openFile(
    path: string,
    options?: {
      forceRefresh?: boolean;
      line?: number;
      column?: number;
      focus?: boolean;
      scrollY?: string;
    },
  ): Promise<unknown>;
}

interface CodeInspectorPanelController {
  show(): void;
  hide(): void;
  open(): void;
  hydrate(projection: unknown, openDrawer?: boolean): void;
  destroy(): void;
}

function isRecord(value: unknown): value is JsonObject {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function errorMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  return isRecord(value) ? asString(value.message) : '';
}

function asPositiveInt(value: unknown, fallback = 1): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing Code Inspector element: #${id}`);
  }
  return element as T;
}

function projectionFromEvent(event: Event): JsonObject | null {
  if (!(event instanceof CustomEvent) || !isRecord(event.detail)) return null;
  const projection = event.detail.projection;
  return isRecord(projection) ? projection : null;
}

function locationFromNode(node: JsonObject): {
  path: string;
  line: number;
  column: number;
} | null {
  const path = asString(node.path);
  if (!path) return null;
  const range = isRecord(node.selectionRange)
    ? node.selectionRange
    : isRecord(node.range)
      ? node.range
      : {};
  return {
    path,
    line: asPositiveInt(range.startLineNumber),
    column: asPositiveInt(range.startColumn),
  };
}

function statusMessage(projection: JsonObject | null): string {
  if (!projection) return 'Choose a code navigation action from the editor context menu.';
  switch (projection.status) {
    case 'loading':
      return 'Resolving code navigation results…';
    case 'empty':
      return 'No matching results.';
    case 'unsupported':
      return errorMessage(projection.error) || 'No provider supports this action.';
    case 'error':
      return errorMessage(projection.error) || 'Code navigation failed.';
    default:
      return '';
  }
}

export function createCodeInspectorPanel(
  deps: CodeInspectorPanelDeps,
): CodeInspectorPanelController {
  const panel = requireElement<HTMLElement>('code-inspector-container');
  const header = requireElement<HTMLElement>('code-inspector-header');
  const target = requireElement<HTMLElement>('code-inspector-target');
  const summary = requireElement<HTMLElement>('code-inspector-summary');
  const tree = requireElement<HTMLElement>('code-inspector-tree');
  const empty = requireElement<HTMLElement>('code-inspector-empty');
  const collapse = requireElement<HTMLButtonElement>('code-inspector-collapse');
  const expanded = new Set<string>();
  const pendingExpansions = new Set<string>();
  let projection: JsonObject | null = null;

  function setPanelVisible(visible: boolean): void {
    header.style.display = visible ? '' : 'none';
    panel.style.display = visible ? '' : 'none';
  }

  function show(): void {
    setPanelVisible(true);
    render();
  }

  function hide(): void {
    setPanelVisible(false);
  }

  function open(): void {
    const tab = document.querySelector<HTMLButtonElement>(
      '.drawer-tab[data-tab="code-inspector"]',
    );
    tab?.click();
    deps.openDrawer();
  }

  function renderNode(node: JsonObject, depth: number): HTMLElement {
    const item = document.createElement('div');
    item.className = 'code-inspector-node';
    item.style.setProperty('--code-inspector-depth', String(depth));

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'code-inspector-row';
    row.setAttribute('role', 'treeitem');
    const id = asString(node.id);
    const children = asArray(node.children);
    const nodeType = asString(node.type);
    const expandable = nodeType === 'direction' || children.length > 0;
    const isExpanded = expanded.has(id);

    const twisty = document.createElement('span');
    twisty.className = 'code-inspector-twisty';
    twisty.textContent = expandable ? (isExpanded ? '⌄' : '›') : '';
    twisty.setAttribute('aria-hidden', 'true');
    twisty.addEventListener('click', (event) => {
      if (!expandable || !id) return;
      event.stopPropagation();
      if (isExpanded) {
        expanded.delete(id);
      } else {
        expanded.add(id);
        const state = asString(node.childrenState);
        if (nodeType === 'direction' && (state === 'unloaded' || state === 'error')) {
          void requestExpansion(node);
        }
      }
      render();
    });

    const icon = document.createElement('span');
    icon.className = 'code-inspector-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = nodeType === 'file'
      ? '▤'
      : nodeType === 'direction'
        ? node.direction === 'incoming' ? '←' : '→'
        : nodeType === 'call'
          ? '☎'
          : '·';

    const label = document.createElement('span');
    label.className = 'code-inspector-label';
    label.textContent = asString(node.label) || asString(node.path) || 'Result';

    const description = document.createElement('span');
    description.className = 'code-inspector-description';
    description.textContent = asString(node.description);

    row.append(twisty, icon, label, description);
    row.title = [label.textContent, description.textContent]
      .filter(Boolean)
      .join(' — ');
    row.setAttribute('aria-expanded', expandable ? String(isExpanded) : 'false');

    row.addEventListener('click', () => {
      if (nodeType === 'direction') {
        if (!id) return;
        if (isExpanded) {
          expanded.delete(id);
          render();
          return;
        }
        expanded.add(id);
        const state = asString(node.childrenState);
        if (state === 'unloaded' || state === 'error') {
          void requestExpansion(node);
        }
        render();
        return;
      }
      if (nodeType === 'file' && children.length && id) {
        if (isExpanded) expanded.delete(id);
        else expanded.add(id);
        render();
        return;
      }
      const location = locationFromNode(node);
      if (!location) return;
      void deps.openFile(location.path, {
        forceRefresh: true,
        line: location.line,
        column: location.column,
        focus: true,
        scrollY: 'center',
      });
    });

    item.append(row);
    if (isExpanded) {
      const childContainer = document.createElement('div');
      childContainer.className = 'code-inspector-children';
      if (nodeType === 'direction' && node.childrenState === 'loading') {
        const loading = document.createElement('div');
        loading.className = 'code-inspector-branch-state';
        loading.textContent = 'Loading…';
        childContainer.append(loading);
      } else if (nodeType === 'direction' && node.childrenState === 'error') {
        const error = document.createElement('div');
        error.className = 'code-inspector-branch-state is-error';
        error.textContent = errorMessage(node.error) || 'Failed to load calls.';
        childContainer.append(error);
      } else if (nodeType === 'direction' && node.childrenState === 'loaded' && !children.length) {
        const noCalls = document.createElement('div');
        noCalls.className = 'code-inspector-branch-state';
        noCalls.textContent = 'No calls.';
        childContainer.append(noCalls);
      } else {
        children.forEach((child) => {
          childContainer.append(renderNode(child, depth + 1));
        });
      }
      item.append(childContainer);
    }
    return item;
  }

  async function requestExpansion(node: JsonObject): Promise<void> {
    const nodeId = asString(node.id);
    if (!projection || !nodeId || pendingExpansions.has(nodeId)) return;
    pendingExpansions.add(nodeId);
    try {
      await deps.requestCommand({
        action: 'expand',
        requestId: projection.requestId,
        nodeId,
        sessionId: node.sessionId,
        itemId: node.itemId,
        direction: node.direction,
      });
    } catch (error) {
      console.warn('[CodeInspector] expansion request failed', error);
    } finally {
      pendingExpansions.delete(nodeId);
    }
  }

  function render(): void {
    const current = projection;
    const targetData = current && isRecord(current.target) ? current.target : {};
    const summaryData = current && isRecord(current.summary) ? current.summary : {};
    const symbol = asString(targetData.symbol);
    const path = asString(targetData.path);
    const line = asPositiveInt(targetData.line);
    target.textContent = current
      ? `${symbol || 'symbol'} · ${path}${path ? `:${line}` : ''}`
      : 'No active inspection';
    const count = Number(summaryData.count);
    const label = asString(summaryData.label);
    summary.textContent = current && Number.isFinite(count)
      ? `${label}${label ? ' · ' : ''}${count} result${count === 1 ? '' : 's'}`
      : label;

    const nodes = current ? asArray(current.tree) : [];
    tree.replaceChildren(...nodes.map((node) => renderNode(node, 0)));
    const message = statusMessage(current);
    empty.textContent = message;
    empty.hidden = !message;
    tree.hidden = !nodes.length;
  }

  function hydrate(value: unknown, shouldOpen = false): void {
    const previousRequestId = asString(projection?.requestId);
    projection = isRecord(value) ? value : null;
    pendingExpansions.clear();
    if (asString(projection?.requestId) !== previousRequestId) {
      expanded.clear();
    }
    if (projection) {
      for (const node of asArray(projection.tree)) {
        if (node.type === 'file' || node.type === 'call') {
          const id = asString(node.id);
          if (id) expanded.add(id);
        }
      }
    } else {
      expanded.clear();
    }
    render();
    if (
      shouldOpen &&
      projection &&
      asString(projection.requestId) !== previousRequestId
    ) {
      open();
    }
  }

  const changedHandler = (event: Event) => {
    hydrate(projectionFromEvent(event), true);
  };
  const bootHydrateHandler = (event: Event) => {
    hydrate(projectionFromEvent(event), false);
  };
  const collapseHandler = () => deps.closeDrawer();
  window.addEventListener('cm6:code-inspector-changed', changedHandler);
  window.addEventListener('cm6:code-inspector-hydrate', bootHydrateHandler);
  collapse.addEventListener('click', collapseHandler);
  render();

  return {
    show,
    hide,
    open,
    hydrate,
    destroy() {
      window.removeEventListener('cm6:code-inspector-changed', changedHandler);
      window.removeEventListener('cm6:code-inspector-hydrate', bootHydrateHandler);
      collapse.removeEventListener('click', collapseHandler);
    },
  };
}
