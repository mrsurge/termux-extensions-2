type Awaitable = Promise<unknown> | unknown;

interface ConversationSettings extends Record<string, unknown> {
  cwd?: string;
  label?: string;
  alias?: string;
  agent?: string;
}

interface ConversationMeta extends Record<string, unknown> {
  conversation_id?: string;
  settings?: ConversationSettings;
  cwd?: string;
  status?: string;
  integrity?: string;
  integrity_error?: string;
  pinned?: boolean;
  pending_approvals?: Record<string, unknown>;
  last_preview?: unknown;
}

export interface HostUiState {
  ideMode?: boolean;
  projectRoot?: string;
}

interface ConversationDisplay {
  conversationId: string;
  titleText: string;
  labelText: string;
  statusText: string;
  pendingCount: number;
  previewText: string;
  cwdText: string;
}

interface ExtensionCatalogEntry extends Record<string, unknown> {
  id?: string;
  active?: boolean;
  dependency_message?: string;
}

export interface DrawerListState {
  conversationList?: ConversationMeta[];
  clientConversationId?: string | null;
  conversationMeta?: ConversationMeta | null;
  extensionCatalog?: ExtensionCatalogEntry[];
  rpcTransportEnabled?: boolean;
}

interface ConversationDrawerListContext {
  conversationListEl: HTMLElement | null;
  conversationMiniListEl: HTMLElement | null;
  getState(): DrawerListState;
  getHostUi(): HostUiState | null | undefined;
  getSplashTab(): string;
  getConversationPreview(conversationId: string): unknown;
  selectConversation(conversationId: string): Awaitable;
  selectConversationWithView(conversationId: string, view: string): Awaitable;
  setConversationPins?(conversationIds: string[]): Awaitable;
  openSettingsModal(): void;
  openProjectModal(path?: string | null): void;
  deleteConversation(conversationId: string): Awaitable;
  documentRef?: Document;
  windowRef?: Window;
}

interface ConversationDrawerListBinding {
  renderConversationList(list: ConversationMeta[], activeConversationId: string | null): void;
  renderMiniConversationList(list: ConversationMeta[], activeConversationId: string | null): void;
  renderSplashTabs(): void;
}

const LONG_PRESS_DRAG_MS = 420;
const LONG_PRESS_MOVE_CANCEL_PX = 8;
const LONG_PRESS_EDGE_SCROLL_ZONE_PX = 52;
const LONG_PRESS_EDGE_SCROLL_MAX_PX = 18;
const CONVERSATION_INTERACTIVE_TARGET_SELECTOR = [
  'button',
  'a',
  'input',
  'label',
  'select',
  'textarea',
  'summary',
  '.conversation-row-handle',
  '.conversation-drag-handle',
  '.conversation-card-controls',
  '.conversation-actions',
  '.conversation-row-menu',
].join(',');

interface EdgeScrollState {
  container: HTMLElement;
  frame: number | null;
  pointerY: number;
  win: Window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function getConversationSettings(meta: ConversationMeta | null | undefined): ConversationSettings {
  return isRecord(meta?.settings) ? (meta.settings as ConversationSettings) : {};
}

function conversationCwd(meta: ConversationMeta | null | undefined): string {
  const settings = getConversationSettings(meta);
  const settingsCwd = typeof settings.cwd === 'string' ? settings.cwd.trim() : '';
  if (settingsCwd) return settingsCwd;
  const metaCwd = typeof meta?.cwd === 'string' ? meta.cwd.trim() : '';
  return metaCwd;
}

function conversationMatchesProject(
  meta: ConversationMeta | null | undefined,
  hostUi: HostUiState | null | undefined,
  splashTab: string,
): boolean {
  if (conversationIntegrity(meta)) return true;
  if (splashTab !== 'project') return true;
  const projectRoot = hostUi?.projectRoot;
  if (!projectRoot || typeof projectRoot !== 'string') return false;
  const cwd = conversationCwd(meta);
  if (!cwd) return false;
  return cwd === projectRoot || cwd.startsWith(`${projectRoot}/`);
}

export function filterMiniConversations(
  list: ConversationMeta[] | null | undefined,
  hostUi: HostUiState | null | undefined,
  splashTab: string,
): ConversationMeta[] {
  const scope = hostUi?.ideMode === true && splashTab === 'project' ? 'project' : 'all';
  return Array.isArray(list)
    ? list.filter((meta) => conversationMatchesProject(meta, hostUi, scope))
    : [];
}

function conversationIntegrity(
  meta: ConversationMeta | null | undefined,
): { kind: string; error: string } | null {
  const kind = typeof meta?.integrity === 'string' ? meta.integrity.trim() : '';
  if (!kind) return null;
  const error = typeof meta?.integrity_error === 'string' ? meta.integrity_error.trim() : '';
  return { kind, error };
}

function normalizePreviewText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim().replace(/\s+/g, ' ').slice(0, 220);
  }
  if (isRecord(value) && typeof value.text === 'string') {
    return value.text.trim().replace(/\s+/g, ' ').slice(0, 220);
  }
  return '';
}

function buildConversationDisplay(
  meta: ConversationMeta | null | undefined,
  getConversationPreview: (conversationId: string) => unknown,
): ConversationDisplay {
  const conversationId = meta?.conversation_id || '';
  const integrity = conversationIntegrity(meta);
  if (integrity) {
    const listFailed = integrity.kind === 'list_error';
    return {
      conversationId,
      titleText: listFailed ? 'Conversation list unavailable' : (conversationId || 'Unreadable conversation'),
      labelText: listFailed ? 'Conversation list unavailable' : 'Unreadable conversation metadata',
      statusText: listFailed ? 'error' : 'corrupt',
      pendingCount: 0,
      previewText: integrity.error || 'The server could not read this conversation metadata.',
      cwdText: '',
    };
  }
  const settings = getConversationSettings(meta);
  const labelRaw = typeof settings.label === 'string' ? settings.label.trim() : '';
  const aliasRaw = typeof settings.alias === 'string' ? settings.alias.trim() : '';
  const alias = aliasRaw || conversationId;
  const agent = typeof settings.agent === 'string' && settings.agent.trim()
    ? settings.agent.trim()
    : '';
  const titleText = agent ? `${alias} · ${agent}` : alias;
  const status = typeof meta?.status === 'string' && meta.status.trim()
    ? meta.status.trim()
    : 'none';
  const pendingCount = meta?.pending_approvals && typeof meta.pending_approvals === 'object'
    ? Object.keys(meta.pending_approvals).length
    : 0;
  const previewText = normalizePreviewText(
    (typeof getConversationPreview === 'function' ? getConversationPreview(conversationId) : null) || meta?.last_preview,
  );
  const cwdText = conversationCwd(meta);
  return {
    conversationId,
    titleText,
    labelText: labelRaw,
    statusText: status,
    pendingCount,
    previewText,
    cwdText,
  };
}

function getActiveConversationIdFromState(state: DrawerListState | null | undefined): string | null {
  return state?.clientConversationId || state?.conversationMeta?.conversation_id || null;
}

export function createConversationDrawerList(
  ctx: ConversationDrawerListContext,
): ConversationDrawerListBinding {
  const {
    conversationListEl,
    conversationMiniListEl,
    getState,
    getHostUi,
    getSplashTab,
    getConversationPreview,
    selectConversation,
    selectConversationWithView,
    setConversationPins,
    openSettingsModal,
    openProjectModal,
    deleteConversation,
    documentRef,
    windowRef,
  } = ctx;

  let draggingConversationId: string | null = null;
  let longPressDragCleanup: (() => void) | null = null;
  let edgeScrollState: EdgeScrollState | null = null;
  const suppressedLongPressActivations = new WeakSet<HTMLElement>();

  function getConversationListState(): ConversationMeta[] {
    const state = getState();
    return Array.isArray(state?.conversationList) ? state.conversationList : [];
  }

  function getPinnedConversationIds(): string[] {
    return getConversationListState()
      .filter((meta) => meta?.pinned === true && typeof meta?.conversation_id === 'string' && meta.conversation_id)
      .map((meta) => (typeof meta.conversation_id === 'string' ? meta.conversation_id : ''))
      .filter((conversationId): conversationId is string => Boolean(conversationId));
  }

  function clearPinnedDragMarkers(doc: Document | null | undefined): void {
    if (!doc) return;
    doc.querySelectorAll('.conversation-row.drag-over, .conversation-row.dragging, .conversation-mini-row.drag-over, .conversation-mini-row.dragging')
      .forEach((el) => {
        el.classList.remove('drag-over');
        el.classList.remove('dragging');
      });
  }

  function clearPinnedDragState(doc: Document | null | undefined): void {
    if (longPressDragCleanup) {
      const cleanup = longPressDragCleanup;
      longPressDragCleanup = null;
      cleanup();
    }
    draggingConversationId = null;
    clearPinnedDragMarkers(doc);
  }

  async function persistPinnedConversationOrder(nextPinnedIds: string[]): Promise<void> {
    if (typeof setConversationPins !== 'function' || !Array.isArray(nextPinnedIds)) return;
    await setConversationPins(nextPinnedIds);
  }

  async function toggleConversationPinned(meta: ConversationMeta | null | undefined): Promise<void> {
    const conversationId = typeof meta?.conversation_id === 'string' ? meta.conversation_id : '';
    if (!conversationId) return;
    const pinnedIds = getPinnedConversationIds();
    let nextPinnedIds;
    if (meta?.pinned === true) {
      nextPinnedIds = pinnedIds.filter((id) => id !== conversationId);
    } else {
      nextPinnedIds = [...pinnedIds, conversationId];
    }
    await persistPinnedConversationOrder(nextPinnedIds);
  }

  function bindPinnedDragSource(
    handle: HTMLElement,
    row: HTMLDivElement,
    meta: ConversationMeta | null | undefined,
    doc: Document | null | undefined,
  ): void {
    const canPersistPins = typeof setConversationPins === 'function';
    const conversationId = typeof meta?.conversation_id === 'string' ? meta.conversation_id : '';
    const canDrag = Boolean(canPersistPins && meta?.pinned === true && conversationId);
    handle.draggable = canDrag;
    if (!canDrag) return;
    bindPinnedLongPressDragSource(handle, row, conversationId, doc);
    handle.addEventListener('dragstart', (evt) => {
      if (!evt.dataTransfer) {
        evt.preventDefault();
        return;
      }
      draggingConversationId = conversationId;
      evt.dataTransfer.effectAllowed = 'move';
      evt.dataTransfer.setData('text/plain', conversationId);
      row.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => {
      clearPinnedDragState(doc);
    });
  }

  function bindPinnedLongPressDragSurface(
    surface: HTMLElement,
    row: HTMLDivElement,
    meta: ConversationMeta | null | undefined,
    doc: Document | null | undefined,
  ): void {
    const canPersistPins = typeof setConversationPins === 'function';
    const conversationId = typeof meta?.conversation_id === 'string' ? meta.conversation_id : '';
    if (!canPersistPins || meta?.pinned !== true || !conversationId) return;
    bindPinnedLongPressDragSource(surface, row, conversationId, doc);
  }

  function reorderPinnedConversationIds(targetConversationId: string): string[] | null {
    const targetId = typeof targetConversationId === 'string' ? targetConversationId : '';
    const draggedId = typeof draggingConversationId === 'string' ? draggingConversationId : '';
    if (!draggedId || !targetId || draggedId === targetId) return null;
    const pinnedIds = getPinnedConversationIds();
    const fromIndex = pinnedIds.indexOf(draggedId);
    const toIndex = pinnedIds.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;
    const nextPinnedIds = [...pinnedIds];
    nextPinnedIds.splice(fromIndex, 1);
    nextPinnedIds.splice(toIndex, 0, draggedId);
    return nextPinnedIds;
  }

  function rowConversationId(row: Element | null | undefined): string {
    return row instanceof HTMLElement ? row.dataset.conversationId || '' : '';
  }

  function conversationRowFromPoint(doc: Document, x: number, y: number): HTMLDivElement | null {
    const target = doc.elementFromPoint(x, y);
    const row = target?.closest('.conversation-row, .conversation-mini-row');
    return row instanceof HTMLDivElement ? row : null;
  }

  function setLongPressDragTarget(doc: Document, targetRow: HTMLDivElement | null, draggedId: string): void {
    doc.querySelectorAll('.conversation-row.drag-over, .conversation-mini-row.drag-over')
      .forEach((el) => el.classList.remove('drag-over'));
    if (!targetRow) return;
    if (!targetRow.classList.contains('pinned')) return;
    const targetId = rowConversationId(targetRow);
    if (!targetId || targetId === draggedId) return;
    targetRow.classList.add('drag-over');
  }

  function getLongPressScrollContainer(row: HTMLElement): HTMLElement | null {
    const miniList = row.closest('.conversation-mini-list');
    if (miniList instanceof HTMLElement) return miniList;
    const list = row.closest('.conversation-list');
    if (list instanceof HTMLElement) {
      const scroller = list.parentElement;
      if (scroller instanceof HTMLElement && scroller.classList.contains('conversation-list-scroller')) {
        return scroller;
      }
      return list;
    }
    return null;
  }

  function stopLongPressEdgeScroll(): void {
    const state = edgeScrollState;
    edgeScrollState = null;
    if (state && state.frame !== null) {
      state.win.cancelAnimationFrame(state.frame);
      state.frame = null;
    }
  }

  function getEdgeScrollDelta(container: HTMLElement, pointerY: number): number {
    const rect = container.getBoundingClientRect();
    if (!rect.height || container.scrollHeight <= container.clientHeight) return 0;
    const topDistance = pointerY - rect.top;
    const bottomDistance = rect.bottom - pointerY;
    if (topDistance >= 0 && topDistance < LONG_PRESS_EDGE_SCROLL_ZONE_PX) {
      const ratio = 1 - (topDistance / LONG_PRESS_EDGE_SCROLL_ZONE_PX);
      return -Math.ceil(ratio * LONG_PRESS_EDGE_SCROLL_MAX_PX);
    }
    if (bottomDistance >= 0 && bottomDistance < LONG_PRESS_EDGE_SCROLL_ZONE_PX) {
      const ratio = 1 - (bottomDistance / LONG_PRESS_EDGE_SCROLL_ZONE_PX);
      return Math.ceil(ratio * LONG_PRESS_EDGE_SCROLL_MAX_PX);
    }
    return 0;
  }

  function scheduleLongPressEdgeScroll(state: EdgeScrollState): void {
    if (state.frame !== null) return;
    state.frame = state.win.requestAnimationFrame(() => {
      state.frame = null;
      if (edgeScrollState !== state) return;
      const delta = getEdgeScrollDelta(state.container, state.pointerY);
      if (!delta) return;
      state.container.scrollTop += delta;
      scheduleLongPressEdgeScroll(state);
    });
  }

  function updateLongPressEdgeScroll(pointerY: number): void {
    if (!edgeScrollState) return;
    edgeScrollState.pointerY = pointerY;
    scheduleLongPressEdgeScroll(edgeScrollState);
  }

  function startLongPressEdgeScroll(container: HTMLElement | null, pointerY: number, win: Window): void {
    stopLongPressEdgeScroll();
    if (!container) return;
    edgeScrollState = {
      container,
      frame: null,
      pointerY,
      win,
    };
    scheduleLongPressEdgeScroll(edgeScrollState);
  }

  function installLongPressScrollLock(doc: Document, scrollContainer: HTMLElement | null): () => void {
    const onTouchMove = (evt: TouchEvent): void => {
      if (!draggingConversationId) return;
      evt.preventDefault();
    };
    doc.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    doc.body?.classList.add('conversation-reorder-dragging');
    scrollContainer?.classList.add('conversation-reorder-scroll-lock');
    return () => {
      doc.removeEventListener('touchmove', onTouchMove, { capture: true });
      doc.body?.classList.remove('conversation-reorder-dragging');
      scrollContainer?.classList.remove('conversation-reorder-scroll-lock');
    };
  }

  function suppressNextLongPressActivation(surface: HTMLElement, win: Window): void {
    suppressedLongPressActivations.add(surface);
    win.setTimeout(() => {
      suppressedLongPressActivations.delete(surface);
    }, 400);
  }

  function consumeSuppressedLongPressActivation(surface: HTMLElement, evt: Event): boolean {
    if (!suppressedLongPressActivations.has(surface)) return false;
    suppressedLongPressActivations.delete(surface);
    evt.preventDefault();
    evt.stopPropagation();
    return true;
  }

  function bindPinnedLongPressDragSource(
    surface: HTMLElement,
    row: HTMLDivElement,
    conversationId: string,
    doc: Document | null | undefined,
  ): void {
    const localDoc = doc || surface.ownerDocument;
    const localWin = localDoc.defaultView || windowRef;
    if (!localWin) return;
    const dragWindow = localWin;
    surface.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0 || !evt.isPrimary) return;
      const target = evt.target;
      if (target instanceof Element && shouldIgnoreLongPressDragTarget(target, surface)) return;
      const startX = evt.clientX;
      const startY = evt.clientY;
      const pointerId = evt.pointerId;
      let active = false;
      let finished = false;
      let scrollLockCleanup: (() => void) | null = null;
      let timer: number | null = dragWindow.setTimeout(() => {
        timer = null;
        active = true;
        draggingConversationId = conversationId;
        row.classList.add('dragging');
        const scrollContainer = getLongPressScrollContainer(row);
        scrollLockCleanup = installLongPressScrollLock(localDoc, scrollContainer);
        startLongPressEdgeScroll(scrollContainer, startY, dragWindow);
        try {
          surface.setPointerCapture(pointerId);
        } catch {
          // Pointer capture is best-effort on GeckoView.
        }
        setLongPressDragTarget(localDoc, conversationRowFromPoint(localDoc, startX, startY), conversationId);
      }, LONG_PRESS_DRAG_MS);

      function removeListeners(): void {
        localDoc.removeEventListener('pointermove', onPointerMove);
        localDoc.removeEventListener('pointerup', onPointerUp);
        localDoc.removeEventListener('pointercancel', onPointerCancel);
        if (timer !== null) {
          dragWindow.clearTimeout(timer);
          timer = null;
        }
      }

      function cleanup(): void {
        if (longPressDragCleanup === cleanup) longPressDragCleanup = null;
        removeListeners();
        if (active) {
          draggingConversationId = null;
          scrollLockCleanup?.();
          scrollLockCleanup = null;
          stopLongPressEdgeScroll();
          clearPinnedDragMarkers(localDoc);
        }
      }

      function cancel(): void {
        if (finished) return;
        finished = true;
        cleanup();
      }

      function onPointerMove(moveEvt: PointerEvent): void {
        if (moveEvt.pointerId !== pointerId) return;
        const dx = Math.abs(moveEvt.clientX - startX);
        const dy = Math.abs(moveEvt.clientY - startY);
        if (!active && Math.max(dx, dy) > LONG_PRESS_MOVE_CANCEL_PX) {
          cancel();
          return;
        }
        if (!active) return;
        moveEvt.preventDefault();
        updateLongPressEdgeScroll(moveEvt.clientY);
        setLongPressDragTarget(
          localDoc,
          conversationRowFromPoint(localDoc, moveEvt.clientX, moveEvt.clientY),
          conversationId,
        );
      }

      async function onPointerUp(upEvt: PointerEvent): Promise<void> {
        if (upEvt.pointerId !== pointerId) return;
        if (finished) return;
        finished = true;
        if (!active) {
          cleanup();
          return;
        }
        upEvt.preventDefault();
        suppressNextLongPressActivation(surface, dragWindow);
        const targetRow = conversationRowFromPoint(localDoc, upEvt.clientX, upEvt.clientY);
        const nextPinnedIds = reorderPinnedConversationIds(rowConversationId(targetRow));
        cleanup();
        if (nextPinnedIds) await persistPinnedConversationOrder(nextPinnedIds);
      }

      function onPointerCancel(cancelEvt: PointerEvent): void {
        if (cancelEvt.pointerId !== pointerId) return;
        cancel();
      }

      if (longPressDragCleanup) longPressDragCleanup();
      longPressDragCleanup = cleanup;
      localDoc.addEventListener('pointermove', onPointerMove);
      localDoc.addEventListener('pointerup', onPointerUp);
      localDoc.addEventListener('pointercancel', onPointerCancel);
    });
  }

  function bindPinnedDropTarget(
    row: HTMLDivElement,
    meta: ConversationMeta | null | undefined,
    doc: Document | null | undefined,
  ): void {
    const conversationId = typeof meta?.conversation_id === 'string' ? meta.conversation_id : '';
    if (!conversationId) return;
    row.addEventListener('dragover', (evt) => {
      if (!draggingConversationId || meta?.pinned !== true || draggingConversationId === conversationId) return;
      if (!evt.dataTransfer) return;
      evt.preventDefault();
      evt.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', (evt) => {
      const nextTarget = evt.relatedTarget;
      if (nextTarget instanceof Element && row.contains(nextTarget)) return;
      row.classList.remove('drag-over');
    });
    row.addEventListener('drop', async (evt) => {
      if (!draggingConversationId || meta?.pinned !== true || draggingConversationId === conversationId) return;
      evt.preventDefault();
      const nextPinnedIds = reorderPinnedConversationIds(conversationId);
      clearPinnedDragState(doc);
      if (!nextPinnedIds) return;
      await persistPinnedConversationOrder(nextPinnedIds);
    });
  }

  function buildConversationInfo(
    doc: Document,
    meta: ConversationMeta | null | undefined,
    { compact = false }: { compact?: boolean } = {},
  ): HTMLDivElement {
    const display = buildConversationDisplay(meta, getConversationPreview);
    const info = doc.createElement('div');
    info.className = 'conversation-meta';

    const labelRow = doc.createElement('div');
    labelRow.className = 'conversation-label-line';
    labelRow.textContent = display.labelText || ' ';
    info.appendChild(labelRow);

    const title = doc.createElement('div');
    title.className = 'conversation-name';
    title.textContent = display.titleText;
    info.appendChild(title);

    const previewText = compact ? (display.previewText || display.cwdText) : display.previewText;
    const previewRow = doc.createElement('div');
    previewRow.className = `conversation-preview-line${compact ? ' compact' : ''}`;
    previewRow.textContent = previewText || '';
    if (previewText) previewRow.title = previewText;

    if (compact) {
      info.appendChild(previewRow);
      return info;
    }

    const statusRow = doc.createElement('div');
    statusRow.className = 'conversation-status';
    statusRow.textContent = `status:${display.statusText}`;
    info.appendChild(statusRow);

    if (!compact) {
      if (display.cwdText) {
        const cwd = doc.createElement('div');
        cwd.className = 'conversation-aux-line';
        cwd.textContent = display.cwdText;
        cwd.title = display.cwdText;
        info.appendChild(cwd);
      }

      if (display.pendingCount) {
        const pending = doc.createElement('div');
        pending.className = 'conversation-aux-line';
        pending.textContent = `${display.pendingCount} pending approval${display.pendingCount === 1 ? '' : 's'}`;
        info.appendChild(pending);
      }
    }

    info.appendChild(previewRow);
    return info;
  }

  function buildConversationIntegrityMarker(doc: Document, meta: ConversationMeta): HTMLDivElement {
    const integrity = conversationIntegrity(meta);
    const marker = doc.createElement('div');
    marker.className = 'conversation-integrity-marker';
    marker.textContent = '!';
    marker.title = integrity?.error || 'Conversation data is unreadable';
    marker.setAttribute('aria-hidden', 'true');
    return marker;
  }

  function buildConversationCardControls(
    doc: Document,
    meta: ConversationMeta | null | undefined,
    row: HTMLDivElement,
    { compact = false, includeDragHandle = true }: { compact?: boolean; includeDragHandle?: boolean } = {},
  ): HTMLDivElement {
    const controls = doc.createElement('div');
    controls.className = compact ? 'conversation-card-controls conversation-mini-controls' : 'conversation-card-controls';

    const canPersistPins = typeof setConversationPins === 'function';

    const pinBtn = doc.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = `btn tiny conversation-pin-btn${meta?.pinned === true ? ' active' : ''}`;
    pinBtn.textContent = meta?.pinned === true ? '📌' : 'Pin';
    pinBtn.title = meta?.pinned === true ? 'Unpin conversation' : 'Pin conversation';
    pinBtn.disabled = !canPersistPins;
    pinBtn.addEventListener('click', async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      await toggleConversationPinned(meta);
    });
    controls.appendChild(pinBtn);

    if (includeDragHandle) {
      const dragHandle = doc.createElement('button');
      dragHandle.type = 'button';
      dragHandle.className = `btn tiny conversation-drag-handle${meta?.pinned === true ? '' : ' disabled'}`;
      dragHandle.textContent = '↕';
      dragHandle.title = meta?.pinned === true
        ? 'Drag to reorder pinned conversations'
        : 'Pin this conversation to enable drag reordering';
      dragHandle.disabled = !canPersistPins || meta?.pinned !== true;
      dragHandle.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
      });
      bindPinnedDragSource(dragHandle, row, meta, doc);
      controls.appendChild(dragHandle);
    }

    bindPinnedDropTarget(row, meta, doc);
    return controls;
  }

  function buildConversationRowHandle(
    doc: Document,
    meta: ConversationMeta | null | undefined,
    row: HTMLDivElement,
  ): HTMLDivElement {
    const handle = doc.createElement('div');
    const canDrag = typeof setConversationPins === 'function' && meta?.pinned === true && meta?.conversation_id;
    handle.className = `conversation-row-handle${canDrag ? '' : ' disabled'}`;
    handle.textContent = '≡';
    handle.title = canDrag
      ? 'Drag to reorder pinned conversations'
      : 'Pin this conversation to enable drag reordering';
    bindPinnedDragSource(handle, row, meta, doc);
    return handle;
  }

  function hasActiveTextSelection(): boolean {
    const selection = windowRef?.getSelection?.();
    return Boolean(selection && !selection.isCollapsed && String(selection).trim());
  }

  function shouldIgnoreRowActivation(evt: Event): boolean {
    if (hasActiveTextSelection()) return true;
    const target = evt.target;
    if (!(target instanceof Element)) return false;
    return shouldIgnoreRowActivationTarget(target);
  }

  function shouldIgnoreRowActivationTarget(target: Element): boolean {
    return Boolean(target.closest(CONVERSATION_INTERACTIVE_TARGET_SELECTOR));
  }

  function shouldIgnoreLongPressDragTarget(target: Element, surface: HTMLElement): boolean {
    const interactiveTarget = target.closest(CONVERSATION_INTERACTIVE_TARGET_SELECTOR);
    return Boolean(interactiveTarget && interactiveTarget !== surface);
  }

  function closeConversationMenus(doc: Document): void {
    doc.querySelectorAll<HTMLElement>('.app-menu-panel').forEach((panel) => {
      panel.classList.add('hidden');
    });
    doc.querySelectorAll<HTMLElement>('.app-menu [aria-expanded="true"]').forEach((toggle) => {
      toggle.setAttribute('aria-expanded', 'false');
    });
  }

  function buildConversationRowMenu(
    doc: Document,
    meta: ConversationMeta | null | undefined,
    conversationId: string,
  ): HTMLDivElement {
    const menu = doc.createElement('div');
    menu.className = 'app-menu conversation-row-menu';

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn tiny icon-btn conversation-row-menu-toggle';
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.title = 'Conversation menu';
    toggle.textContent = '☰';

    const panel = doc.createElement('div');
    panel.className = 'app-menu-panel conversation-row-menu-panel hidden';
    panel.setAttribute('role', 'menu');

    const settingsItem = doc.createElement('button');
    settingsItem.type = 'button';
    settingsItem.className = 'app-menu-item';
    settingsItem.setAttribute('role', 'menuitem');
    settingsItem.textContent = 'Settings';
    settingsItem.addEventListener('click', async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      closeConversationMenus(doc);
      if (!conversationId) return;
      await selectConversationWithView(conversationId, 'splash');
      openSettingsModal();
    });

    const projectItem = doc.createElement('button');
    projectItem.type = 'button';
    projectItem.className = 'app-menu-item';
    projectItem.setAttribute('role', 'menuitem');
    projectItem.textContent = 'Project';
    projectItem.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      closeConversationMenus(doc);
      const cwd = conversationCwd(meta) || null;
      openProjectModal(cwd);
    });

    toggle.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const willOpen = panel.classList.contains('hidden');
      closeConversationMenus(doc);
      panel.classList.toggle('hidden', !willOpen);
      toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    panel.append(settingsItem, projectItem);
    menu.append(toggle, panel);
    return menu;
  }

  function bindConversationRowActivation(
    row: HTMLDivElement,
    conversationId: string,
  ): void {
    if (!conversationId) return;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.addEventListener('click', (evt) => {
      if (consumeSuppressedLongPressActivation(row, evt)) return;
      if (shouldIgnoreRowActivation(evt)) return;
      void selectConversation(conversationId);
    });
    row.addEventListener('keydown', (evt) => {
      if (shouldIgnoreRowActivation(evt)) return;
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      evt.preventDefault();
      void selectConversation(conversationId);
    });
  }

  function renderConversationList(list: ConversationMeta[], activeConversationId: string | null): void {
    if (!conversationListEl) return;
    const doc = documentRef || document;
    const hostUi = getHostUi();
    const splashTab = getSplashTab();
    conversationListEl.innerHTML = '';
    const items = Array.isArray(list) ? list.filter((meta) => conversationMatchesProject(meta, hostUi, splashTab)) : [];
    if (!items.length) {
      const empty = doc.createElement('div');
      empty.className = 'muted';
      empty.textContent = splashTab === 'project' ? 'No project conversations yet.' : 'No conversations yet.';
      conversationListEl.appendChild(empty);
      return;
    }

    items.forEach((meta) => {
      const conversationId = typeof meta?.conversation_id === 'string' ? meta.conversation_id : '';
      const integrity = conversationIntegrity(meta);
      const row = doc.createElement('div');
      row.className = 'conversation-row';
      if (conversationId) row.dataset.conversationId = conversationId;
      if (integrity) {
        row.classList.add('integrity-error');
        row.setAttribute('role', 'status');
        row.appendChild(buildConversationIntegrityMarker(doc, meta));
        row.appendChild(buildConversationInfo(doc, meta));
        conversationListEl.appendChild(row);
        return;
      }
      if (conversationId && conversationId === activeConversationId) row.classList.add('active');
      if (meta?.pinned === true) row.classList.add('pinned');
      bindConversationRowActivation(row, conversationId);
      bindPinnedLongPressDragSurface(row, row, meta, doc);

      row.appendChild(buildConversationRowHandle(doc, meta, row));

      const info = buildConversationInfo(doc, meta);
      row.appendChild(info);

      const actions = doc.createElement('div');
      actions.className = 'conversation-actions';
      actions.appendChild(buildConversationCardControls(doc, meta, row, { includeDragHandle: false }));

      actions.appendChild(buildConversationRowMenu(doc, meta, conversationId));

      const deleteBtn = doc.createElement('button');
      deleteBtn.className = 'btn tiny decline';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async () => {
        if (!conversationId) return;
        await deleteConversation(conversationId);
      });
      actions.appendChild(deleteBtn);

      row.appendChild(actions);
      conversationListEl.appendChild(row);
    });
  }

  function renderMiniConversationList(list: ConversationMeta[], activeConversationId: string | null): void {
    if (!conversationMiniListEl) return;
    const doc = documentRef || document;
    const hostUi = getHostUi();
    const splashTab = getSplashTab();
    const projectScoped = hostUi?.ideMode === true && splashTab === 'project';
    conversationMiniListEl.innerHTML = '';
    const items = filterMiniConversations(list, hostUi, splashTab);
    if (!items.length) {
      const empty = doc.createElement('div');
      empty.className = 'muted';
      empty.textContent = projectScoped ? 'No project conversations yet.' : 'No conversations yet.';
      conversationMiniListEl.appendChild(empty);
      return;
    }

    items.forEach((meta) => {
      const conversationId = typeof meta?.conversation_id === 'string' ? meta.conversation_id : '';
      const integrity = conversationIntegrity(meta);
      const row = doc.createElement('div');
      row.className = 'conversation-mini-row';
      if (conversationId) row.dataset.conversationId = conversationId;
      if (integrity) {
        row.classList.add('integrity-error');
        row.setAttribute('role', 'status');
        row.appendChild(buildConversationIntegrityMarker(doc, meta));
        row.appendChild(buildConversationInfo(doc, meta, { compact: true }));
        conversationMiniListEl.appendChild(row);
        return;
      }
      if (conversationId && conversationId === activeConversationId) row.classList.add('active');
      if (meta?.pinned === true) row.classList.add('pinned');

      const state = getState();
      const extensionCatalog = Array.isArray(state?.extensionCatalog) ? state.extensionCatalog : [];
      const agent = (meta?.settings || {}).agent || '';
      const extInfo = extensionCatalog.find((ext) => ext?.id === agent) || null;
      const unavailableDetail = extInfo && extInfo.active === false
        ? (extInfo.dependency_message || 'This extension is unavailable.')
        : '';

      const mainButton = doc.createElement('button');
      mainButton.type = 'button';
      mainButton.className = 'conversation-mini-main';
      if (unavailableDetail) {
        mainButton.disabled = true;
        mainButton.title = unavailableDetail;
      } else {
        mainButton.addEventListener('click', (evt) => {
          if (consumeSuppressedLongPressActivation(mainButton, evt)) return;
          if (!conversationId) return;
          void selectConversation(conversationId);
        });
      }
      bindPinnedLongPressDragSurface(mainButton, row, meta, doc);

      const info = buildConversationInfo(doc, meta, { compact: true });
      mainButton.appendChild(info);
      row.appendChild(mainButton);
      row.appendChild(buildConversationCardControls(doc, meta, row, { compact: true }));
      conversationMiniListEl.appendChild(row);
    });
  }

  function renderSplashTabs(): void {
    const doc = documentRef || document;
    const state = getState();
    const hostUi = getHostUi();
    const splashTabAllBtn = doc.getElementById('splash-tab-all');
    const splashTabProjectBtn = doc.getElementById('splash-tab-project');
    const miniTabAllBtn = doc.getElementById('conversation-mini-tab-all');
    const miniTabProjectBtn = doc.getElementById('conversation-mini-tab-project');
    const miniScopeEl = doc.getElementById('conversation-mini-scope');
    const splashGoConversationBtn = doc.getElementById('splash-go-conversation');
    const activeTab = getSplashTab();
    const activeConversationId = getActiveConversationIdFromState(state);
    splashTabAllBtn?.classList.toggle('active', activeTab === 'all');
    splashTabProjectBtn?.classList.toggle('active', activeTab === 'project');
    miniTabAllBtn?.classList.toggle('active', activeTab === 'all');
    miniTabProjectBtn?.classList.toggle('active', activeTab === 'project');
    miniTabAllBtn?.setAttribute('aria-pressed', activeTab === 'all' ? 'true' : 'false');
    miniTabProjectBtn?.setAttribute('aria-pressed', activeTab === 'project' ? 'true' : 'false');
    if (miniScopeEl instanceof HTMLElement) miniScopeEl.hidden = hostUi?.ideMode !== true;
    if (splashGoConversationBtn instanceof HTMLButtonElement) {
      splashGoConversationBtn.disabled = !activeConversationId;
      splashGoConversationBtn.title = activeConversationId
        ? 'Go to active conversation'
        : 'No active conversation selected';
    }
  }

  return {
    renderConversationList,
    renderMiniConversationList,
    renderSplashTabs,
  };
}
