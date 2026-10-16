type StickySourceRow = HTMLElement & { _timelineStickyUid?: string };
type StickySlotElement = HTMLDivElement & { _sourceRow?: StickySourceRow | null };
type StickyClickHandler = (sourceRow: StickySourceRow, event: MouseEvent) => void;

interface TimelineStickyHeadersContext {
  timelineWrapEl: HTMLElement | null;
  timelineEl: HTMLElement | null;
  getTopOffset?(): number;
  onMessageHeaderClick?: StickyClickHandler;
  onCollapsibleHeaderClick?: StickyClickHandler;
  documentRef?: Document;
  windowRef?: Window;
}

interface TimelineStickyHeadersBinding {
  update(): void;
  destroy(): void;
  getVisibleHeight(): number;
}

interface NextTimelineRowInfo {
  row: StickySourceRow;
  climbed: number;
}

function isTimelineRowElement(value: unknown): value is StickySourceRow {
  return value instanceof HTMLElement && value.classList.contains('timeline-row');
}

function isElementVisibleRect(rect: DOMRect | ClientRect | null | undefined): boolean {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function closestTimelineRow(timelineEl: HTMLElement | null, el: Element | null): StickySourceRow | null {
  if (!el || !el.closest) return null;
  const row = el.closest('.timeline-row');
  if (!isTimelineRowElement(row)) return null;
  if (!timelineEl || !timelineEl.contains(row)) return null;
  return row;
}

function isStickySourceRow(row: Element | null | undefined): boolean {
  if (!row?.classList) return false;
  return row.classList.contains('subagent-card')
    || row.classList.contains('diff')
    || row.classList.contains('message-card')
    || row.classList.contains('mcp-tool-card')
    || row.classList.contains('search-card')
    || row.classList.contains('web-search-card');
}

function getStickyType(row: Element | null | undefined): 'message' | 'collapsible' {
  if (row?.classList?.contains('message-card')) return 'message';
  return 'collapsible';
}

function getHeaderForRow(row: StickySourceRow | null): HTMLElement | null {
  if (!row) return null;
  if (row.classList.contains('message-card')) {
    return row.querySelector<HTMLElement>(':scope > .message-header');
  }
  if (row.classList.contains('subagent-card')) {
    return row.querySelector<HTMLElement>(':scope > .subagent-header');
  }
  if (row.classList.contains('diff')) {
    return row.querySelector<HTMLElement>(':scope > .body > .diff-path-label, :scope > .body > .diff-path');
  }
  if (row.classList.contains('mcp-tool-card') || row.classList.contains('search-card') || row.classList.contains('web-search-card')) {
    return row.querySelector<HTMLElement>(':scope > .body > .command-ribbon');
  }
  return null;
}

function getStickyHostClasses(row: Element | null | undefined): string[] {
  const classes = ['timeline-sticky-slot-host'];
  if (!row?.classList) return classes;
  if (row.classList.contains('message-card')) classes.push('message-card');
  if (row.classList.contains('user')) classes.push('user');
  if (row.classList.contains('subagent-card')) classes.push('subagent-card');
  if (row.classList.contains('expanded')) classes.push('expanded');
  if (row.classList.contains('expanded-mru')) classes.push('expanded-mru');
  if (row.classList.contains('diff')) classes.push('diff');
  if (row.classList.contains('declined')) classes.push('declined');
  if (row.classList.contains('command-result')) classes.push('command-result');
  if (row.classList.contains('mcp-tool-card')) classes.push('mcp-tool-card');
  if (row.classList.contains('search-card')) classes.push('search-card');
  if (row.classList.contains('web-search-card')) classes.push('web-search-card');
  return classes;
}

function getStickyChainFromRow(row: StickySourceRow | null): StickySourceRow[] {
  if (!row) return [];
  const subagents: StickySourceRow[] = [];
  let cursor = row.parentElement?.closest('.subagent-card');
  while (isTimelineRowElement(cursor)) {
    subagents.push(cursor);
    cursor = cursor.parentElement?.closest('.subagent-card');
  }
  subagents.reverse();
  const chain = [...subagents];
  if (isStickySourceRow(row) && chain[chain.length - 1] !== row) {
    chain.push(row);
  }
  return chain;
}

function findNextTimelineRowAfterSubtree(row: StickySourceRow | null): NextTimelineRowInfo | null {
  if (!row) return null;
  let cursor: StickySourceRow | null = row;
  let climbed = 0;
  while (cursor) {
    let sibling = cursor.nextElementSibling;
    while (sibling) {
      if (isTimelineRowElement(sibling)) {
        return { row: sibling, climbed };
      }
      sibling = sibling.nextElementSibling;
    }
    const parentRow: Element | null = cursor.parentElement?.closest('.timeline-row') ?? null;
    cursor = isTimelineRowElement(parentRow) ? parentRow : null;
    climbed += 1;
  }
  return null;
}

function getDirectTimelineRows(containerEl: Element | null): StickySourceRow[] {
  if (!containerEl?.children) return [];
  return Array.from(containerEl.children).filter((child): child is StickySourceRow => isTimelineRowElement(child));
}

function getHeaderHeight(row: StickySourceRow | null): number {
  const header = getHeaderForRow(row);
  if (!header) return 0;
  const rect = header.getBoundingClientRect();
  return Math.max(0, Math.round(rect.height || header.offsetHeight || 0));
}

function rowStillSpansBoundary(row: StickySourceRow | null, boundaryY: number): boolean {
  if (!row) return false;
  const rect = row.getBoundingClientRect();
  return rect.bottom > boundaryY;
}

function findActiveSourceRow(containerEl: Element | null, boundaryY: number): StickySourceRow | null {
  const rows = getDirectTimelineRows(containerEl);
  let active: StickySourceRow | null = null;
  for (const row of rows) {
    if (!isStickySourceRow(row)) continue;
    const header = getHeaderForRow(row);
    if (!header) continue;
    const headerRect = header.getBoundingClientRect();
    if (headerRect.top <= boundaryY && rowStillSpansBoundary(row, boundaryY)) {
      active = row;
    }
  }
  return active;
}

function computeStickyChain(
  boundaryY: number,
  containerEl: Element | null,
  chain: StickySourceRow[] = [],
): StickySourceRow[] {
  const activeRow = findActiveSourceRow(containerEl, boundaryY);
  if (!activeRow) return chain;
  chain.push(activeRow);
  if (!activeRow.classList.contains('subagent-card')) return chain;
  if (!activeRow.classList.contains('expanded')) return chain;
  const body = activeRow.querySelector<HTMLElement>(':scope > .subagent-body');
  if (!body) return chain;
  const headerHeight = getHeaderHeight(activeRow);
  if (!headerHeight) return chain;
  return computeStickyChain(boundaryY + headerHeight, body, chain);
}

export function bindTimelineStickyHeaders(
  ctx: TimelineStickyHeadersContext,
): TimelineStickyHeadersBinding {
  const {
    timelineWrapEl,
    timelineEl,
    getTopOffset,
    onMessageHeaderClick,
    onCollapsibleHeaderClick,
    documentRef,
    windowRef,
  } = ctx;

  if (!timelineWrapEl || !timelineEl) {
    return {
      update() {},
      destroy() {},
      getVisibleHeight() { return 0; },
    };
  }

  const wrapEl = timelineWrapEl;
  const tlEl = timelineEl;

  const doc = documentRef || document;
  const win = windowRef || window;
  let container = wrapEl.querySelector<HTMLDivElement>('.timeline-sticky-overlay');
  if (!container) {
    container = doc.createElement('div');
    container.className = 'timeline-sticky-overlay';
    wrapEl.insertBefore(container, tlEl);
  }
  const overlayEl = container;

  let disposed = false;
  let rafId: number | null = null;
  let lastKey = '';
  let pendingKey = '';
  let pendingKeyFrames = 0;
  let stabilityResampleBudget = 0;
  let stickySourceRows: StickySourceRow[] = [];
  let stickyHeights: number[] = [];
  let stickySlots: StickySlotElement[] = [];
  let stickyRows: HTMLDivElement[] = [];
  let stickyUnderlays: HTMLDivElement[] = [];
  let visibleHeight = 0;
  let rowUidCounter = 0;

  const DEFAULT_ROW_HEIGHT = 42;
  const PUSH_TRIGGER_ADJUST_PX = 8;
  const KEY_STABILITY_FRAMES = 2;
  const BOTTOM_SHADOW_PAD_PX = 8;

  function getRowUid(row: StickySourceRow | null): string {
    if (!row) return '';
    if (!row._timelineStickyUid) {
      row._timelineStickyUid = `timeline-sticky-${rowUidCounter += 1}`;
    }
    return row._timelineStickyUid;
  }

  function scheduleUpdate(): void {
    if (disposed || rafId) return;
    rafId = win.requestAnimationFrame(() => {
      rafId = null;
      updateNow();
    });
  }

  function ensureSlotCount(count: number): void {
    while (stickySlots.length < count) {
      const underlay = doc.createElement('div');
      underlay.className = 'timeline-sticky-underlay';
      overlayEl.appendChild(underlay);
      stickyUnderlays.push(underlay);

      const slot = doc.createElement('div') as StickySlotElement;
      slot.className = 'timeline-sticky-slot';
      const host = doc.createElement('div');
      host.className = 'timeline-sticky-slot-host';
      slot.appendChild(host);
      slot.addEventListener('click', (event) => {
        const sourceRow = slot._sourceRow;
        if (!sourceRow) return;
        if (slot.dataset.stickyType === 'message') {
          if (typeof onMessageHeaderClick === 'function') onMessageHeaderClick(sourceRow, event);
        } else if (typeof onCollapsibleHeaderClick === 'function') {
          onCollapsibleHeaderClick(sourceRow, event);
        }
        scheduleUpdate();
      });
      overlayEl.appendChild(slot);
      stickySlots.push(slot);
      stickyRows.push(host);
    }

    while (stickySlots.length > count) {
      const slot = stickySlots.pop();
      if (slot) slot._sourceRow = null;
      slot?.remove();
      stickyRows.pop();

      const underlay = stickyUnderlays.pop();
      underlay?.remove();
    }
  }

  function clearOverlay(): void {
    lastKey = '';
    stickySourceRows = [];
    stickyHeights = [];
    visibleHeight = 0;
    ensureSlotCount(0);
    overlayEl.style.display = 'none';
    overlayEl.style.height = '0px';
  }

  function syncSlotFromSource(srcRow: StickySourceRow, depth: number): number {
    const underlay = stickyUnderlays[depth];
    const slot = stickySlots[depth];
    const host = stickyRows[depth];
    const sourceHeader = getHeaderForRow(srcRow);
    if (!underlay || !slot || !host || !sourceHeader) return DEFAULT_ROW_HEIGHT;

    const wrapRect = wrapEl.getBoundingClientRect();
    const headerRect = sourceHeader.getBoundingClientRect();
    if (isElementVisibleRect(wrapRect) && isElementVisibleRect(headerRect)) {
      const left = Math.max(0, Math.round(headerRect.left - wrapRect.left));
      const right = Math.max(0, Math.round(wrapRect.right - headerRect.right));
      slot.style.left = `${left}px`;
      slot.style.right = `${right}px`;
      underlay.style.left = `${left}px`;
      underlay.style.right = `${right}px`;
    } else {
      slot.style.left = '0px';
      slot.style.right = '0px';
      underlay.style.left = '0px';
      underlay.style.right = '0px';
    }

    const slotZ = 1000 - depth;
    slot.style.zIndex = `${slotZ}`;
    underlay.style.zIndex = `${slotZ - 1}`;
    underlay.style.top = '0px';

    const clone = sourceHeader.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return DEFAULT_ROW_HEIGHT;
    clone.classList.add('timeline-sticky-header');
    clone.querySelectorAll<HTMLElement>('.ribbon-toggle-zone').forEach((el) => el.remove());
    clone.querySelectorAll<HTMLElement>('[id]').forEach((el) => el.removeAttribute('id'));
    clone.querySelectorAll<HTMLElement>('.twisty').forEach((el) => {
      el.style.pointerEvents = 'none';
    });
    clone.dataset.expanded = sourceHeader.dataset.expanded || (srcRow.classList.contains('expanded') ? 'true' : 'false');
    host.className = getStickyHostClasses(srcRow).join(' ');
    host.replaceChildren(clone);

    const rowStyle = win.getComputedStyle(srcRow);
    underlay.style.backgroundColor = rowStyle.backgroundColor || '';
    underlay.style.backgroundImage = rowStyle.backgroundImage || '';
    underlay.style.borderLeft = srcRow.classList.contains('subagent-card')
      ? 'none'
      : (rowStyle.borderLeft || '');
    slot.style.cursor = win.getComputedStyle(sourceHeader).cursor || '';

    slot.dataset.stickyType = getStickyType(srcRow);
    slot._sourceRow = srcRow;
    slot.dataset.rowId = getRowUid(srcRow);
    underlay.dataset.rowId = getRowUid(srcRow);

    const height = Math.max(
      24,
      Math.round(headerRect.height || sourceHeader.offsetHeight || DEFAULT_ROW_HEIGHT),
    );
    stickyHeights[depth] = height;
    slot.style.height = `${height}px`;
    return height;
  }

  function applyPushTransforms(chain: StickySourceRow[], hostTop: number): void {
    let cumulativePush = 0;
    let baseTop = 0;

    chain.forEach((srcRow, depth) => {
      const slot = stickySlots[depth];
      const underlay = stickyUnderlays[depth];
      if (!slot || !underlay) return;

      const height = stickyHeights[depth] || DEFAULT_ROW_HEIGHT;
      slot.style.top = `${baseTop}px`;
      slot.style.height = `${height}px`;
      slot.classList.toggle('timeline-sticky-slot-bottom', depth === chain.length - 1);

      let push = 0;
      const nextInfo = findNextTimelineRowAfterSubtree(srcRow);
      if (nextInfo?.row) {
        const nextRect = nextInfo.row.getBoundingClientRect();
        const anchorY = hostTop + baseTop + height + cumulativePush + PUSH_TRIGGER_ADJUST_PX;
        const overlap = nextRect.top - anchorY;
        if (overlap < 0) {
          push = Math.max(overlap, -height);
        }
      }

      const translateY = cumulativePush + push;
      slot.style.transform = `translateY(${translateY}px)`;
      underlay.style.height = `${Math.max(0, baseTop + translateY + height * 0.5)}px`;

      cumulativePush += push;
      baseTop += height;
    });
  }

  function updateNow(): void {
    if (disposed) return;

    const wrapRect = wrapEl.getBoundingClientRect();
    if (!isElementVisibleRect(wrapRect)) {
      clearOverlay();
      return;
    }

    const captureTop = wrapRect.top + (typeof getTopOffset === 'function' ? getTopOffset() : 0);
    const rawChain = computeStickyChain(captureTop, tlEl, []);
    const rawKey = rawChain.map(getRowUid).join('|');
    let chain = rawChain;
    let key = rawKey;
    let needsStabilityResample = false;

    if (rawKey && lastKey && rawKey !== lastKey && stickySourceRows.length) {
      if (rawKey === pendingKey) {
        pendingKeyFrames += 1;
      } else {
        pendingKey = rawKey;
        pendingKeyFrames = 1;
      }

      if (pendingKeyFrames < KEY_STABILITY_FRAMES) {
        chain = stickySourceRows;
        key = lastKey;
        needsStabilityResample = true;
        stabilityResampleBudget = Math.max(
          stabilityResampleBudget,
          KEY_STABILITY_FRAMES - pendingKeyFrames,
        );
      } else {
        pendingKey = '';
        pendingKeyFrames = 0;
        stabilityResampleBudget = 0;
      }
    } else {
      pendingKey = '';
      pendingKeyFrames = 0;
      stabilityResampleBudget = 0;
    }

    if (!key || !chain.length) {
      clearOverlay();
      return;
    }

    const topOffset = typeof getTopOffset === 'function' ? getTopOffset() : 0;
    const hostTop = wrapRect.top + topOffset;
    overlayEl.style.display = 'block';
    overlayEl.style.top = `${topOffset}px`;
    ensureSlotCount(chain.length);
    stickySourceRows = chain.slice();
    stickyHeights = new Array(chain.length);
    chain.forEach((srcRow, depth) => {
      syncSlotFromSource(srcRow, depth);
    });
    visibleHeight = stickyHeights.reduce((sum, height) => sum + (height || DEFAULT_ROW_HEIGHT), 0) + BOTTOM_SHADOW_PAD_PX;
    overlayEl.style.height = '0px';
    lastKey = key;
    applyPushTransforms(chain, hostTop);

    if (needsStabilityResample && stabilityResampleBudget > 0) {
      stabilityResampleBudget -= 1;
      scheduleUpdate();
    }
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(tlEl, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'data-expanded'],
  });

  function onScroll(): void {
    scheduleUpdate();
  }

  wrapEl.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', scheduleUpdate);
  scheduleUpdate();

  return {
    update: scheduleUpdate,
    destroy() {
      disposed = true;
      observer.disconnect();
      wrapEl.removeEventListener('scroll', onScroll);
      win.removeEventListener('resize', scheduleUpdate);
      if (rafId) {
        win.cancelAnimationFrame(rafId);
        rafId = null;
      }
      overlayEl.remove();
    },
    getVisibleHeight() {
      if (overlayEl.style.display === 'none') return 0;
      return visibleHeight;
    },
  };
}
