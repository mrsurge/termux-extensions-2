import { getIcon as getSetiIcon } from '/static/vendor/seti-icons/seti-icons.js';

interface RecentFileEntry {
  path: string;
  label: string;
  opened_at: unknown;
  exists: boolean;
  scroll_line: unknown;
}

interface FileTabDecoration {
  path: string;
  gitStatus: string;
  hasDraft: boolean;
  errors: number;
  warnings: number;
}

interface FileTabsControllerDeps {
  viewport: HTMLElement;
  track: HTMLElement;
  formatFileNameDisplay: (name: string) => string;
  openFile: (path: string) => Promise<unknown>;
  closeRecentFile: (path: string) => Promise<unknown>;
  resetToNewFile: () => void;
  onActiveDraftChanged?: (path: string, hasDraft: boolean) => void;
}

interface FileTabsOpenState {
  projectPath: string;
  recents: RecentFileEntry[];
}

const ORDER_STORAGE_PREFIX = 'code-te2:file-tabs:v1:';
const GIT_STATUS_CLASSES = new Set([
  'modified',
  'staged',
  'staged_modified',
  'added',
  'deleted',
  'renamed',
  'untracked',
  'ignored',
  'conflict',
]);
const TOUCH_REORDER_LONG_PRESS_MS = 420;
const TOUCH_REORDER_MOVE_CANCEL_PX = 8;
const REORDER_EDGE_SCROLL_ZONE_PX = 52;
const REORDER_EDGE_SCROLL_MAX_PX = 18;

interface UiFrameHandle {
  kind: 'animation-frame' | 'timeout';
  id: number | ReturnType<typeof setTimeout>;
}

function requestUiFrame(callback: FrameRequestCallback): UiFrameHandle {
  if (typeof window.requestAnimationFrame === 'function') {
    return {
      kind: 'animation-frame',
      id: window.requestAnimationFrame(callback),
    };
  }
  return {
    kind: 'timeout',
    id: setTimeout(() => callback(Date.now()), 16),
  };
}

function cancelUiFrame(handle: UiFrameHandle | null): void {
  if (!handle) return;
  if (
    handle.kind === 'animation-frame'
    && typeof window.cancelAnimationFrame === 'function'
  ) {
    window.cancelAnimationFrame(handle.id as number);
    return;
  }
  clearTimeout(handle.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recentFileEntry(value: unknown): RecentFileEntry | null {
  if (!isRecord(value) || typeof value.path !== 'string' || !value.path) {
    return null;
  }
  return {
    path: value.path,
    label: typeof value.label === 'string' && value.label ? value.label : value.path,
    opened_at: value.opened_at,
    exists: value.exists === true,
    scroll_line: value.scroll_line,
  };
}

function normalizedOpenState(state: unknown): FileTabsOpenState {
  const record = isRecord(state) ? state : {};
  const nestedOpenState = isRecord(record.openState) ? record.openState : null;
  const projection = nestedOpenState || record;
  const recents = Array.isArray(projection.recents)
    ? projection.recents
      .map((entry) => recentFileEntry(entry))
      .filter((entry): entry is RecentFileEntry => entry !== null)
      .slice(0, 12)
    : [];
  return {
    projectPath: typeof projection.projectPath === 'string'
      ? projection.projectPath
      : !nestedOpenState && typeof record.activeProject === 'string'
        ? record.activeProject
        : '',
    recents,
  };
}

function clientForegroundPath(state: unknown): string {
  const record = isRecord(state) ? state : {};
  if (isRecord(record.clientForeground)) {
    return typeof record.clientForeground.path === 'string'
      ? record.clientForeground.path
      : '';
  }
  if (typeof record.path === 'string') return record.path;
  if (typeof record.currentPath === 'string') return record.currentPath;
  if (typeof record.lastFile === 'string') return record.lastFile;
  return '';
}

function nonnegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizedDecorations(payload: unknown): Map<string, FileTabDecoration> {
  const record = isRecord(payload) ? payload : {};
  const items = Array.isArray(record.items) ? record.items : [];
  const result = new Map<string, FileTabDecoration>();
  items.forEach((item) => {
    if (!isRecord(item) || typeof item.path !== 'string' || !item.path) return;
    const diagnostics = isRecord(item.diagnostics) ? item.diagnostics : {};
    result.set(item.path, {
      path: item.path,
      gitStatus: typeof item.gitStatus === 'string' ? item.gitStatus : '',
      hasDraft: item.hasDraft === true,
      errors: nonnegativeInteger(diagnostics.errors),
      warnings: nonnegativeInteger(diagnostics.warnings),
    });
  });
  return result;
}

export function fileTabOrderStorageKey(projectPath: string): string {
  return `${ORDER_STORAGE_PREFIX}${projectPath}`;
}

export function mergeFileTabOrder(
  backendPaths: string[],
  storedPaths: string[],
): string[] {
  const backend = new Set(backendPaths);
  const seen = new Set<string>();
  const merged: string[] = [];
  storedPaths.forEach((path) => {
    if (!backend.has(path) || seen.has(path)) return;
    seen.add(path);
    merged.push(path);
  });
  backendPaths.forEach((path) => {
    if (seen.has(path)) return;
    seen.add(path);
    merged.push(path);
  });
  return merged;
}

export function chooseFileTabCloseSuccessor(
  visualPaths: string[],
  closingPath: string,
): string | null {
  const index = visualPaths.indexOf(closingPath);
  if (index < 0) return null;
  return visualPaths[index + 1] || visualPaths[index - 1] || null;
}

export function fileTabEdgeScrollDelta(
  viewport: HTMLElement,
  pointerX: number,
): number {
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || viewport.scrollWidth <= viewport.clientWidth) return 0;
  const leftDistance = pointerX - rect.left;
  const rightDistance = rect.right - pointerX;
  if (leftDistance >= 0 && leftDistance < REORDER_EDGE_SCROLL_ZONE_PX) {
    const ratio = 1 - (leftDistance / REORDER_EDGE_SCROLL_ZONE_PX);
    return -Math.ceil(ratio * REORDER_EDGE_SCROLL_MAX_PX);
  }
  if (rightDistance >= 0 && rightDistance < REORDER_EDGE_SCROLL_ZONE_PX) {
    const ratio = 1 - (rightDistance / REORDER_EDGE_SCROLL_ZONE_PX);
    return Math.ceil(ratio * REORDER_EDGE_SCROLL_MAX_PX);
  }
  return 0;
}

export function revealFileTabInViewport(
  viewport: HTMLElement,
  tab: HTMLElement,
): void {
  const viewportRect = viewport.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  if (tabRect.left < viewportRect.left) {
    viewport.scrollLeft = Math.max(
      0,
      viewport.scrollLeft - (viewportRect.left - tabRect.left),
    );
  } else if (tabRect.right > viewportRect.right) {
    viewport.scrollLeft = Math.min(
      maxScrollLeft,
      viewport.scrollLeft + (tabRect.right - viewportRect.right),
    );
  }
}

function storedOrder(projectPath: string): string[] {
  if (!projectPath) return [];
  try {
    const value = JSON.parse(localStorage.getItem(fileTabOrderStorageKey(projectPath)) || '[]');
    return Array.isArray(value)
      ? value.filter((path): path is string => typeof path === 'string' && Boolean(path))
      : [];
  } catch {
    return [];
  }
}

function persistOrder(projectPath: string, paths: string[]): void {
  if (!projectPath) return;
  try {
    localStorage.setItem(fileTabOrderStorageKey(projectPath), JSON.stringify(paths));
  } catch {
    // Ordering persistence is optional presentation state.
  }
}

async function applyFileIcon(icon: HTMLElement, fileName: string): Promise<void> {
  icon.className = 'fe-file-tab-icon codicon codicon-file';
  try {
    const resolved = await getSetiIcon(fileName);
    if (!icon.isConnected || !resolved?.svg) return;
    icon.className = 'fe-file-tab-icon';
    icon.innerHTML = resolved.svg;
    icon.style.color = resolved.color || '';
  } catch {
    // Keep the generic Codicon fallback.
  }
}

export function createFileTabsController(deps: FileTabsControllerDeps) {
  let projectPath = '';
  let activePath = '';
  let recents: RecentFileEntry[] = [];
  let decorations = new Map<string, FileTabDecoration>();
  let installed = false;
  let pendingClosePath = '';
  let suppressClickPath = '';
  let activeTabRevealFrame: UiFrameHandle | null = null;
  let projectedDraftKey = '';

  function visualEntries(): RecentFileEntry[] {
    const byPath = new Map(recents.map((entry) => [entry.path, entry]));
    const paths = mergeFileTabOrder(
      recents.map((entry) => entry.path),
      storedOrder(projectPath),
    );
    return paths
      .map((path) => byPath.get(path))
      .filter((entry): entry is RecentFileEntry => entry !== undefined);
  }

  function persistTrackOrder(): void {
    const paths = Array.from(
      deps.track.querySelectorAll<HTMLElement>('.fe-file-tab[data-path]'),
      (tab) => tab.dataset.path || '',
    ).filter(Boolean);
    persistOrder(projectPath, paths);
  }

  function scheduleActiveTabReveal(): void {
    cancelUiFrame(activeTabRevealFrame);
    activeTabRevealFrame = null;
    const expectedPath = activePath;
    if (!expectedPath) return;
    activeTabRevealFrame = requestUiFrame(() => {
      activeTabRevealFrame = null;
      if (activePath !== expectedPath) return;
      const activeTab = Array.from(
        deps.track.querySelectorAll<HTMLElement>('.fe-file-tab[data-path]'),
      ).find((tab) => tab.dataset.path === expectedPath);
      if (activeTab) revealFileTabInViewport(deps.viewport, activeTab);
    });
  }

  function projectActiveDraftState(): void {
    if (!activePath) {
      if (projectedDraftKey) {
        projectedDraftKey = '';
        deps.onActiveDraftChanged?.('', false);
      }
      return;
    }
    const decoration = decorations.get(activePath);
    if (!decoration) return;
    const nextKey = `${activePath}\0${decoration.hasDraft ? '1' : '0'}`;
    if (nextKey === projectedDraftKey) return;
    projectedDraftKey = nextKey;
    deps.onActiveDraftChanged?.(activePath, decoration.hasDraft);
  }

  async function openEntry(entry: RecentFileEntry): Promise<void> {
    if (!entry.exists) {
      console.warn('[FileTabs] File does not exist:', entry.path);
      return;
    }
    try {
      await deps.openFile(entry.path);
    } catch (error) {
      console.error('[FileTabs] Failed to open file:', error);
    }
  }

  async function closeEntry(entry: RecentFileEntry): Promise<void> {
    if (pendingClosePath) return;
    pendingClosePath = entry.path;
    let activeSuccessor: string | null = null;
    try {
      if (entry.path === activePath) {
        const availablePaths = visualEntries()
          .filter((candidate) => candidate.exists)
          .map((candidate) => candidate.path);
        activeSuccessor = chooseFileTabCloseSuccessor(availablePaths, entry.path);
        if (activeSuccessor) {
          await deps.openFile(activeSuccessor);
        }
      }
      await deps.closeRecentFile(entry.path);
      if (entry.path === activePath && !activeSuccessor) {
        deps.resetToNewFile();
      }
    } catch (error) {
      console.error('[FileTabs] Failed to close recent file:', error);
    } finally {
      pendingClosePath = '';
    }
  }

  function render(): void {
    const entries = visualEntries();
    deps.track.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'fe-file-tabs-empty';
      empty.textContent = 'No recent files';
      deps.track.appendChild(empty);
      return;
    }

    entries.forEach((entry) => {
      const decoration = decorations.get(entry.path);
      const tab = document.createElement('div');
      tab.className = 'fe-file-tab';
      tab.dataset.path = entry.path;
      tab.dataset.exists = entry.exists ? 'true' : 'false';
      tab.title = entry.path;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', entry.path === activePath ? 'true' : 'false');
      tab.tabIndex = entry.path === activePath ? 0 : -1;
      tab.classList.toggle('active', entry.path === activePath);
      tab.classList.toggle('fe-file-tab--missing', !entry.exists);
      tab.classList.toggle('fe-draft', decoration?.hasDraft === true);
      const gitStatus = decoration?.gitStatus || '';
      if (GIT_STATUS_CLASSES.has(gitStatus)) {
        tab.classList.add(`fe-git-${gitStatus}`);
        tab.dataset.gitStatus = gitStatus;
      }

      const icon = document.createElement('span');
      void applyFileIcon(icon, entry.label);

      const label = document.createElement('span');
      label.className = 'fe-file-tab-label';
      label.textContent = deps.formatFileNameDisplay(entry.label);

      const diagnostic = document.createElement('span');
      diagnostic.className = 'fe-file-tab-diagnostic';
      diagnostic.setAttribute('aria-hidden', 'true');
      if ((decoration?.errors || 0) > 0) {
        diagnostic.textContent = '🔴';
        diagnostic.title = `${decoration?.errors} error(s)`;
      } else if ((decoration?.warnings || 0) > 0) {
        diagnostic.textContent = '🟡';
        diagnostic.title = `${decoration?.warnings} warning(s)`;
      }

      const close = document.createElement('button');
      close.className = 'fe-file-tab-close codicon codicon-close';
      close.type = 'button';
      close.title = `Close ${entry.label}`;
      close.setAttribute('aria-label', `Close ${entry.label}`);
      close.addEventListener('pointerdown', (event) => event.stopPropagation());
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        void closeEntry(entry);
      });

      tab.append(icon, label, diagnostic, close);
      tab.addEventListener('click', () => {
        if (suppressClickPath === entry.path) {
          suppressClickPath = '';
          return;
        }
        void openEntry(entry);
      });
      tab.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void openEntry(entry);
        } else if (event.key === 'Delete') {
          event.preventDefault();
          void closeEntry(entry);
        }
      });
      deps.track.appendChild(tab);
    });
  }

  function refreshOpenState(state: unknown): void {
    const next = normalizedOpenState(state);
    projectPath = next.projectPath;
    recents = next.recents;
    const order = mergeFileTabOrder(
      recents.map((entry) => entry.path),
      storedOrder(projectPath),
    );
    persistOrder(projectPath, order);
    render();
    projectActiveDraftState();
    scheduleActiveTabReveal();
  }

  function refreshClientForeground(state: unknown): void {
    activePath = clientForegroundPath(state);
    render();
    projectActiveDraftState();
    scheduleActiveTabReveal();
  }

  function refreshDecorations(payload: unknown): void {
    const record = isRecord(payload) ? payload : {};
    if (
      typeof record.projectPath === 'string'
      && projectPath
      && record.projectPath !== projectPath
    ) {
      return;
    }
    decorations = normalizedDecorations(payload);
    render();
    projectActiveDraftState();
  }

  function installReorderAndScroll(): void {
    deps.viewport.addEventListener('wheel', (event) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
      if (!delta) return;
      deps.viewport.scrollLeft += delta;
      event.preventDefault();
    }, { passive: false });

    let candidate: HTMLElement | null = null;
    let pointerId = -1;
    let pointerType = '';
    let startX = 0;
    let startY = 0;
    let reordering = false;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let scrollLockCleanup: (() => void) | null = null;
    let edgeScrollFrame: UiFrameHandle | null = null;
    let edgePointerX = 0;
    let edgePointerY = 0;

    const clearLongPress = () => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const stopEdgeScroll = () => {
      cancelUiFrame(edgeScrollFrame);
      edgeScrollFrame = null;
    };

    const reorderCandidateAtPoint = (clientX: number, clientY: number) => {
      if (!candidate || !reordering) return;
      const hit = document.elementFromPoint(clientX, clientY);
      const target = hit instanceof Element
        ? hit.closest<HTMLElement>('.fe-file-tab')
        : null;
      if (!target || target === candidate || target.parentElement !== deps.track) return;
      const rect = target.getBoundingClientRect();
      deps.track.insertBefore(
        candidate,
        clientX < rect.left + rect.width / 2
          ? target
          : target.nextSibling,
      );
    };

    const scheduleEdgeScroll = () => {
      if (!reordering || edgeScrollFrame) return;
      edgeScrollFrame = requestUiFrame(() => {
        edgeScrollFrame = null;
        if (!reordering) return;
        const delta = fileTabEdgeScrollDelta(deps.viewport, edgePointerX);
        if (!delta) return;
        const previousScrollLeft = deps.viewport.scrollLeft;
        const maxScrollLeft = Math.max(
          0,
          deps.viewport.scrollWidth - deps.viewport.clientWidth,
        );
        deps.viewport.scrollLeft = Math.min(
          maxScrollLeft,
          Math.max(0, previousScrollLeft + delta),
        );
        if (deps.viewport.scrollLeft === previousScrollLeft) return;
        reorderCandidateAtPoint(edgePointerX, edgePointerY);
        scheduleEdgeScroll();
      });
    };

    const updateEdgeScroll = (clientX: number, clientY: number) => {
      edgePointerX = clientX;
      edgePointerY = clientY;
      scheduleEdgeScroll();
    };

    const installTouchScrollLock = (): (() => void) => {
      const preventTouchScroll = (event: TouchEvent) => {
        if (reordering) event.preventDefault();
      };
      document.addEventListener('touchmove', preventTouchScroll, {
        capture: true,
        passive: false,
      });
      return () => {
        document.removeEventListener('touchmove', preventTouchScroll, {
          capture: true,
        });
      };
    };

    const beginReorder = () => {
      if (!candidate || pointerId < 0 || reordering) return;
      clearLongPress();
      reordering = true;
      candidate.classList.add('is-reordering');
      deps.viewport.classList.add('is-reordering');
      if (pointerType === 'touch') {
        scrollLockCleanup = installTouchScrollLock();
      }
      try {
        candidate.setPointerCapture(pointerId);
      } catch {}
      updateEdgeScroll(startX, startY);
    };

    const finishReorder = () => {
      clearLongPress();
      stopEdgeScroll();
      if (candidate && reordering) {
        suppressClickPath = candidate.dataset.path || '';
        persistTrackOrder();
      }
      candidate?.classList.remove('is-reordering');
      deps.viewport.classList.remove('is-reordering');
      scrollLockCleanup?.();
      scrollLockCleanup = null;
      candidate = null;
      pointerId = -1;
      pointerType = '';
      reordering = false;
    };

    deps.track.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('.fe-file-tab-close')) return;
      candidate = event.target.closest<HTMLElement>('.fe-file-tab');
      if (!candidate) return;
      pointerId = event.pointerId;
      pointerType = event.pointerType;
      startX = event.clientX;
      startY = event.clientY;
      if (pointerType === 'touch') {
        longPressTimer = setTimeout(beginReorder, TOUCH_REORDER_LONG_PRESS_MS);
      }
    });

    document.addEventListener('pointermove', (event) => {
      if (!candidate || event.pointerId !== pointerId) return;
      if (!reordering) {
        const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
        if (pointerType === 'touch') {
          if (distance > TOUCH_REORDER_MOVE_CANCEL_PX) clearLongPress();
          return;
        }
        if (distance <= 4) return;
        beginReorder();
      }
      event.preventDefault();
      updateEdgeScroll(event.clientX, event.clientY);
      reorderCandidateAtPoint(event.clientX, event.clientY);
    }, { passive: false });

    document.addEventListener('pointerup', (event) => {
      if (event.pointerId === pointerId) finishReorder();
    });
    document.addEventListener('pointercancel', (event) => {
      if (event.pointerId === pointerId) finishReorder();
    });
  }

  function installWindowHooks(): void {
    if (installed) return;
    installed = true;
    installReorderAndScroll();
    window.addEventListener('code-te2:open-state-changed', (event) => {
      if (event instanceof CustomEvent) refreshOpenState(event.detail);
    });
    window.addEventListener('code-te2:active-file-changed', (event) => {
      if (event instanceof CustomEvent) refreshClientForeground(event.detail);
    });
    window.addEventListener('code-te2:file-tabs-decorations-changed', (event) => {
      if (event instanceof CustomEvent) refreshDecorations(event.detail);
    });
  }

  function broadcastOpenState(state: unknown): void {
    if (!state) return;
    window.__codeTe2EditorState = state;
    refreshOpenState(state);
    refreshClientForeground(state);
    window.dispatchEvent(new CustomEvent('code-te2:recents-updated', { detail: state }));
  }

  return {
    refreshOpenState,
    refreshDecorations,
    installWindowHooks,
    broadcastOpenState,
  };
}
