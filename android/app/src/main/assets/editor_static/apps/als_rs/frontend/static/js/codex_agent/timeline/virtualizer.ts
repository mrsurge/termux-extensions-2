import {
  layout,
  prepare,
  type PreparedText,
} from '@chenglou/pretext';
import {
  readTranscriptCardScope,
  type TranscriptAnchor,
} from '../transcript_card_metadata.ts';

const DEFAULT_ROW_HEIGHT = 42;
const MIN_OVERSCAN_PX = 480;
const DYNAMIC_ROW_GRACE_MS = 800;
const BASE_OVERSCAN_VIEWPORTS = 2;
const MAX_OVERSCAN_VIEWPORTS = 8;
const SCROLL_LOOKAHEAD_MS = 160;
const SCROLL_DELTA_LOOKAHEAD = 1.5;
const SCROLL_ACTIVE_MS = 180;
const SCROLL_WINDOW_HYSTERESIS_MS = 140;

type MessageCardElement = HTMLElement & {
  _messageText?: string;
};

interface PreparedMessageBlock {
  prepared: PreparedText;
  baselineWidth: number;
  baselineHeight: number;
  lineHeight: number;
}

interface MessageHeightPredictor {
  baselineContentWidth: number;
  baselineRowHeight: number;
  blocks: PreparedMessageBlock[];
  horizontalChrome: number;
}

interface VirtualRowRecord {
  row: HTMLElement;
  placeholder: HTMLDivElement;
  height: number;
  top: number;
  bottom: number;
  measured: boolean;
  mounted: boolean;
  streaming: boolean;
  preparing: boolean;
  alwaysMounted: boolean;
  dynamicUntil: number;
  scrollRetainedUntil: number;
  predictor: MessageHeightPredictor | null;
  pendingMessageText: string | null;
}

interface NumericLayoutAnchor {
  kind: 'row';
  record: VirtualRowRecord;
  offsetPx: number;
}

interface BottomLayoutAnchor {
  kind: 'bottom';
  distancePx: number;
}

type LayoutAnchor = NumericLayoutAnchor | BottomLayoutAnchor | null;

export interface VisibleTranscriptCardRange {
  first: number;
  last: number;
}

export interface TimelineVirtualizerDebugSnapshot {
  records: number;
  mounted: number;
  parked: number;
  durableRoots: number;
  activeRoots: number;
  unscopedRoots: number;
  first: number | null;
  last: number | null;
  visible: VisibleTranscriptCardRange | null;
  distanceToStartPx: number | null;
  distanceToEndPx: number | null;
}

export interface TranscriptProjectionViewportMetrics {
  first: number | null;
  last: number | null;
  visible: VisibleTranscriptCardRange | null;
  distanceToStartPx: number | null;
  distanceToEndPx: number | null;
}

interface TimelineVirtualizerContext {
  timelineEl: HTMLElement | null;
  scrollContainer: HTMLElement | null;
  documentRef?: Document;
  windowRef?: Window;
  isAutoScroll?(): boolean;
  setScrollProgrammatic?(value: boolean): void;
  onLayout?(): void;
}

export interface TimelineVirtualizerBinding {
  scheduleLayout(): void;
  syncRows(): void;
  reset(preserveMeasurements?: boolean): void;
  removeRow(row: Element | null | undefined): void;
  registerRow(row: HTMLElement): void;
  markMessageStreaming(row: HTMLElement, streaming: boolean): void;
  registerFinalizedMessage(row: HTMLElement, text: string): void;
  invalidateRow(row: HTMLElement, keepMountedMs?: number): void;
  mutateRow(row: HTMLElement, mutation: () => void): void;
  captureTranscriptAnchor(edge: 'start' | 'end'): TranscriptAnchor | null;
  restoreTranscriptAnchor(anchor: TranscriptAnchor | null): void;
  visibleTranscriptCardRange(): VisibleTranscriptCardRange | null;
  transcriptProjectionMetrics(): TranscriptProjectionViewportMetrics;
  debugSnapshot(): TimelineVirtualizerDebugSnapshot;
}

function finiteCssPx(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function measuredFlowHeight(row: HTMLElement, win: Window): number {
  const rect = row.getBoundingClientRect();
  if (!(rect.height > 0)) return 0;
  const styles = win.getComputedStyle(row);
  return rect.height + finiteCssPx(styles.marginTop) + finiteCssPx(styles.marginBottom);
}

function computedLineHeight(styles: CSSStyleDeclaration): number {
  const explicit = finiteCssPx(styles.lineHeight);
  if (explicit > 0) return explicit;
  return Math.max(1, finiteCssPx(styles.fontSize) * 1.2);
}

function canvasFont(styles: CSSStyleDeclaration): string {
  return [
    styles.fontStyle || 'normal',
    styles.fontVariant || 'normal',
    styles.fontWeight || '400',
    styles.fontSize || '13px',
    styles.fontFamily || '"JetBrains Mono", monospace',
  ].join(' ');
}

function isComplexMarkdown(root: HTMLElement): boolean {
  return Boolean(root.querySelector('img, video, audio, iframe, canvas, svg, table, details'));
}

function binarySearchFirstBottomAfter(records: VirtualRowRecord[], y: number): number {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (records[mid]!.bottom > y) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

function binarySearchFirstTopAtOrAfter(records: VirtualRowRecord[], y: number): number {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (records[mid]!.top >= y) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

export function bindTimelineVirtualizer(
  ctx: TimelineVirtualizerContext,
): TimelineVirtualizerBinding {
  const {
    timelineEl,
    scrollContainer,
    documentRef = document,
    windowRef = window,
    isAutoScroll = () => false,
    setScrollProgrammatic = () => {},
    onLayout = () => {},
  } = ctx;

  if (!timelineEl || !scrollContainer) {
    return {
      scheduleLayout() {},
      syncRows() {},
      reset() {},
      removeRow(row) { row?.remove(); },
      registerRow() {},
      markMessageStreaming() {},
      registerFinalizedMessage() {},
      invalidateRow() {},
      mutateRow(_row, mutation) { mutation(); },
      captureTranscriptAnchor() { return null; },
      restoreTranscriptAnchor() {},
      visibleTranscriptCardRange() { return null; },
      transcriptProjectionMetrics() {
        return {
          first: null,
          last: null,
          visible: null,
          distanceToStartPx: null,
          distanceToEndPx: null,
        };
      },
      debugSnapshot() {
        return {
          records: 0,
          mounted: 0,
          parked: 0,
          durableRoots: 0,
          activeRoots: 0,
          unscopedRoots: 0,
          first: null,
          last: null,
          visible: null,
          distanceToStartPx: null,
          distanceToEndPx: null,
        };
      },
    };
  }

  const timeline = timelineEl;
  const scrollEl = scrollContainer;
  const recordsByRow = new Map<HTMLElement, VirtualRowRecord>();
  const recordsByPlaceholder = new Map<HTMLDivElement, VirtualRowRecord>();
  const measuredHeightCache = new Map<string, number>();
  let records: VirtualRowRecord[] = [];
  let rafId: number | null = null;
  let dynamicTimer: number | null = null;
  let disposedGeneration = 0;
  let lastTimelineWidth = 0;
  let projecting = false;
  let currentWindowRecords = new Set<VirtualRowRecord>();
  let lastObservedScrollTop = scrollEl.scrollTop;
  let lastObservedScrollAt = performance.now();
  let recentScrollDelta = 0;
  let scrollVelocity = 0;
  let scrollDirection = 0;
  let scrollActiveUntil = 0;
  let pendingProgrammaticScrollTop: number | null = null;

  const fontReady = documentRef.fonts?.ready
    ? documentRef.fonts.ready.catch(() => undefined)
    : Promise.resolve();

  function timelineContentOffset(): number {
    if (scrollEl === timeline) return 0;
    const timelineRect = timeline.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();
    return scrollEl.scrollTop + timelineRect.top - scrollRect.top;
  }

  function viewportTopInTimeline(): number {
    return scrollEl.scrollTop - timelineContentOffset();
  }

  function createRecord(row: HTMLElement): VirtualRowRecord {
    const placeholder = documentRef.createElement('div');
    placeholder.className = 'timeline-virtual-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    const record: VirtualRowRecord = {
      row,
      placeholder,
      height: DEFAULT_ROW_HEIGHT,
      top: 0,
      bottom: DEFAULT_ROW_HEIGHT,
      measured: false,
      mounted: row.parentElement === timeline,
      streaming: false,
      preparing: false,
      alwaysMounted: false,
      dynamicUntil: performance.now() + DYNAMIC_ROW_GRACE_MS,
      scrollRetainedUntil: 0,
      predictor: null,
      pendingMessageText: null,
    };
    recordsByRow.set(row, record);
    recordsByPlaceholder.set(placeholder, record);
    const cachedHeight = readCachedHeight(record);
    if (cachedHeight !== null) {
      record.height = cachedHeight;
      record.measured = true;
    }
    const messageText = (row as MessageCardElement)._messageText;
    if (
      row.classList.contains('message-card')
      && row.dataset.virtualStreaming !== 'true'
      && typeof messageText === 'string'
      && messageText.length > 0
    ) {
      scheduleMessagePreparation(record, messageText);
    }
    return record;
  }

  function measurementCacheKey(record: VirtualRowRecord): string | null {
    const rowKey = record.row.dataset.virtualRowKey;
    if (!rowKey) return null;
    const width = Math.max(1, Math.round(timeline.clientWidth));
    const state = record.row.classList.contains('expanded') ? 'expanded' : 'collapsed';
    return `${width}:${state}:${rowKey}`;
  }

  function readCachedHeight(record: VirtualRowRecord): number | null {
    const key = measurementCacheKey(record);
    if (!key) return null;
    const height = measuredHeightCache.get(key);
    return typeof height === 'number' && height > 0 ? height : null;
  }

  function cacheMeasuredHeight(record: VirtualRowRecord): void {
    const key = measurementCacheKey(record);
    if (key && record.height > 0) {
      measuredHeightCache.set(key, record.height);
    }
  }

  function recordForTopLevelRow(row: HTMLElement): VirtualRowRecord | null {
    let cursor: HTMLElement | null = row;
    while (cursor) {
      const directParent: HTMLElement | null = cursor.parentElement;
      if (directParent === timeline) {
        return recordsByRow.get(cursor) || createRecord(cursor);
      }
      if (
        directParent instanceof HTMLDivElement
        && directParent.classList.contains('timeline-virtual-placeholder')
        && directParent.parentElement === timeline
      ) {
        return recordsByRow.get(cursor) || recordsByPlaceholder.get(directParent) || null;
      }
      cursor = directParent?.closest('.timeline-row') as HTMLElement | null;
    }
    return null;
  }

  function recordForNode(node: Node | null): VirtualRowRecord | null {
    const element = node instanceof HTMLElement
      ? node
      : node?.parentElement;
    if (!(element instanceof HTMLElement)) return null;
    const row = element.matches('.timeline-row')
      ? element
      : element.closest<HTMLElement>('.timeline-row');
    return row ? recordForTopLevelRow(row) : null;
  }

  function cleanupDetachedRecord(record: VirtualRowRecord): void {
    resizeObserver.unobserve(record.row);
    recordsByRow.delete(record.row);
    recordsByPlaceholder.delete(record.placeholder);
    currentWindowRecords.delete(record);
    record.placeholder.remove();
  }

  function syncRecordOrder(): void {
    const nextRecords: VirtualRowRecord[] = [];
    for (const child of Array.from(timeline.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.classList.contains('timeline-row')) {
        const record = recordsByRow.get(child) || createRecord(child);
        record.mounted = true;
        nextRecords.push(record);
        continue;
      }
      if (child instanceof HTMLDivElement && child.classList.contains('timeline-virtual-placeholder')) {
        const record = recordsByPlaceholder.get(child);
        if (!record) {
          child.remove();
          continue;
        }
        if (record.row.parentElement !== child) {
          cleanupDetachedRecord(record);
          continue;
        }
        record.mounted = false;
        nextRecords.push(record);
      }
    }

    const retained = new Set(nextRecords);
    for (const record of records) {
      if (retained.has(record)) continue;
      if (timeline.contains(record.row) || timeline.contains(record.placeholder)) continue;
      cleanupDetachedRecord(record);
    }
    records = nextRecords;
  }

  function prepareBlock(block: HTMLElement): PreparedMessageBlock | null {
    const text = block.textContent || '';
    if (!text) return null;
    const styles = windowRef.getComputedStyle(block);
    const rect = block.getBoundingClientRect();
    if (!(rect.width > 0)) return null;
    const lineHeight = computedLineHeight(styles);
    const letterSpacing = finiteCssPx(styles.letterSpacing);
    const whiteSpace = styles.whiteSpace.includes('pre') ? 'pre-wrap' : 'normal';
    const wordBreak = styles.wordBreak === 'keep-all' ? 'keep-all' : 'normal';
    try {
      const prepared = prepare(text, canvasFont(styles), {
        whiteSpace,
        wordBreak,
        letterSpacing,
      });
      return {
        prepared,
        baselineWidth: rect.width,
        baselineHeight: layout(prepared, rect.width, lineHeight).height,
        lineHeight,
      };
    } catch (error) {
      console.warn('[timeline-virtualizer] Pretext preparation failed', error);
      return null;
    }
  }

  function prepareMessageRecord(record: VirtualRowRecord, text: string): void {
    if (record.predictor || !record.mounted) return;
    const markdownBody = record.row.querySelector<HTMLElement>(':scope > .message-body > .markdown-body');
    const contentRoot = markdownBody
      || record.row.querySelector<HTMLElement>(':scope > .message-body');
    if (!contentRoot) return;
    if (isComplexMarkdown(contentRoot)) {
      record.alwaysMounted = true;
      return;
    }

    const contentRect = contentRoot.getBoundingClientRect();
    const rowRect = record.row.getBoundingClientRect();
    if (!(contentRect.width > 0) || !(rowRect.height > 0)) return;
    const blockElements = Array.from(contentRoot.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement);
    const blocks = (blockElements.length ? blockElements : [contentRoot])
      .map(prepareBlock)
      .filter((block): block is PreparedMessageBlock => block !== null);

    if (!blocks.length && text) {
      const fallbackBlock = prepareBlock(contentRoot);
      if (fallbackBlock) blocks.push(fallbackBlock);
    }
    if (!blocks.length) return;

    record.predictor = {
      baselineContentWidth: contentRect.width,
      baselineRowHeight: measuredFlowHeight(record.row, windowRef) || rowRect.height,
      blocks,
      horizontalChrome: Math.max(0, rowRect.width - contentRect.width),
    };
  }

  function predictedMessageHeight(record: VirtualRowRecord, timelineWidth: number): number {
    const predictor = record.predictor;
    if (!predictor) return record.height;
    const contentWidth = Math.max(1, timelineWidth - predictor.horizontalChrome);
    const widthDelta = contentWidth - predictor.baselineContentWidth;
    let heightDelta = 0;
    for (const block of predictor.blocks) {
      const nextWidth = Math.max(1, block.baselineWidth + widthDelta);
      const nextHeight = layout(block.prepared, nextWidth, block.lineHeight).height;
      heightDelta += nextHeight - block.baselineHeight;
    }
    return Math.max(1, predictor.baselineRowHeight + heightDelta);
  }

  function scheduleMessagePreparation(record: VirtualRowRecord, text: string): void {
    if (record.predictor || record.preparing) return;
    record.pendingMessageText = text;
    record.preparing = true;
    scheduleLayout();
    const generation = disposedGeneration;
    void fontReady.then(() => {
      if (generation !== disposedGeneration || !recordsByRow.has(record.row)) return;
      windowRef.requestAnimationFrame(() => {
        if (generation !== disposedGeneration || !recordsByRow.has(record.row)) return;
        if (!record.mounted) {
          record.dynamicUntil = performance.now() + DYNAMIC_ROW_GRACE_MS;
          scheduleLayout();
          windowRef.requestAnimationFrame(() => {
            if (record.mounted) {
              prepareMessageRecord(record, record.pendingMessageText || '');
            }
            record.preparing = false;
            record.pendingMessageText = null;
            scheduleLayout();
          });
          return;
        }
        prepareMessageRecord(record, record.pendingMessageText || '');
        record.preparing = false;
        record.pendingMessageText = null;
        scheduleLayout();
      });
    });
  }

  function measureMountedRecords(): void {
    for (const record of records) {
      if (!record.mounted) continue;
      const nextHeight = measuredFlowHeight(record.row, windowRef);
      if (!(nextHeight > 0)) continue;
      record.height = nextHeight;
      record.measured = true;
      cacheMeasuredHeight(record);
      resizeObserver.observe(record.row);
    }
  }

  function nonRecordFlowHeight(element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    if (!(rect.height > 0)) return 0;
    const styles = windowRef.getComputedStyle(element);
    return rect.height + finiteCssPx(styles.marginTop) + finiteCssPx(styles.marginBottom);
  }

  function recomputePositions(): void {
    let cursor = 0;
    const nextRecords: VirtualRowRecord[] = [];
    for (const child of Array.from(timeline.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const record = child.classList.contains('timeline-row')
        ? recordsByRow.get(child) || null
        : (
            child instanceof HTMLDivElement
            && child.classList.contains('timeline-virtual-placeholder')
              ? recordsByPlaceholder.get(child) || null
              : null
          );
      if (!record) {
        cursor += nonRecordFlowHeight(child);
        continue;
      }
      record.top = cursor;
      record.bottom = cursor + Math.max(1, record.height);
      cursor = record.bottom;
      nextRecords.push(record);
    }
    records = nextRecords;
  }

  function recordRequiresMount(record: VirtualRowRecord, now: number): boolean {
    const row = record.row;
    if (!record.measured || record.preparing || record.streaming || record.alwaysMounted) return true;
    if (record.dynamicUntil > now) return true;
    if (row.classList.contains('plan')) return true;
    if (row.classList.contains('subagent-card') && row.classList.contains('expanded')) return true;
    if (
      row.dataset.approvalId
      && !row.classList.contains('resolved')
      && row.dataset.approvalSource !== 'replay'
    ) {
      return true;
    }
    return false;
  }

  function projectRecord(record: VirtualRowRecord, shouldMount: boolean): void {
    if (shouldMount === record.mounted) {
      if (!shouldMount) {
        const height = `${Math.max(1, record.height)}px`;
        if (record.placeholder.style.height !== height) {
          record.placeholder.style.height = height;
        }
      }
      return;
    }
    if (shouldMount) {
      record.row.hidden = false;
      record.placeholder.replaceWith(record.row);
      record.mounted = true;
      resizeObserver.observe(record.row);
      return;
    }
    record.placeholder.style.height = `${Math.max(1, record.height)}px`;
    record.row.replaceWith(record.placeholder);
    record.row.hidden = true;
    record.placeholder.replaceChildren(record.row);
    record.mounted = false;
    resizeObserver.unobserve(record.row);
  }

  function captureLayoutAnchor(): LayoutAnchor {
    if (isAutoScroll()) {
      return {
        kind: 'bottom',
        distancePx: scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight,
      };
    }
    if (!records.length) return null;
    const viewTop = viewportTopInTimeline();
    const index = Math.min(
      records.length - 1,
      binarySearchFirstBottomAfter(records, viewTop),
    );
    const record = records[index];
    if (!record) return null;
    return {
      kind: 'row',
      record,
      offsetPx: record.top - viewTop,
    };
  }

  function restoreLayoutAnchor(anchor: LayoutAnchor): void {
    if (!anchor) return;
    let nextScrollTop = scrollEl.scrollTop;
    if (anchor.kind === 'bottom') {
      nextScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight - anchor.distancePx;
    } else if (recordsByRow.has(anchor.record.row)) {
      nextScrollTop = timelineContentOffset() + anchor.record.top - anchor.offsetPx;
    }
    if (!Number.isFinite(nextScrollTop) || Math.abs(nextScrollTop - scrollEl.scrollTop) < 0.5) return;
    setScrollProgrammatic(true);
    pendingProgrammaticScrollTop = Math.max(0, nextScrollTop);
    scrollEl.scrollTop = pendingProgrammaticScrollTop;
    windowRef.requestAnimationFrame(() => {
      pendingProgrammaticScrollTop = null;
      setScrollProgrammatic(false);
    });
  }

  function scheduleDynamicExpiry(): void {
    if (dynamicTimer !== null) {
      windowRef.clearTimeout(dynamicTimer);
      dynamicTimer = null;
    }
    const now = performance.now();
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const record of records) {
      if (record.dynamicUntil > now) {
        nextExpiry = Math.min(nextExpiry, record.dynamicUntil);
      }
      if (record.scrollRetainedUntil > now) {
        nextExpiry = Math.min(nextExpiry, record.scrollRetainedUntil);
      }
    }
    if (scrollActiveUntil > now) {
      nextExpiry = Math.min(nextExpiry, scrollActiveUntil);
    }
    if (!Number.isFinite(nextExpiry)) return;
    dynamicTimer = windowRef.setTimeout(() => {
      dynamicTimer = null;
      scheduleLayout();
    }, Math.max(0, nextExpiry - now + 1));
  }

  function layoutNow(): void {
    rafId = null;
    const anchor = captureLayoutAnchor();
    syncRecordOrder();
    const timelineWidth = Math.max(1, timeline.clientWidth);
    const widthChanged = Math.abs(timelineWidth - lastTimelineWidth) >= 0.5;
    if (widthChanged) {
      for (const record of records) {
        if (!record.mounted) {
          const cachedHeight = readCachedHeight(record);
          if (cachedHeight !== null) {
            record.height = cachedHeight;
          } else if (record.predictor) {
            record.height = predictedMessageHeight(record, timelineWidth);
          }
        }
      }
      lastTimelineWidth = timelineWidth;
    }

    measureMountedRecords();
    recomputePositions();

    const now = performance.now();
    const viewTop = viewportTopInTimeline();
    const viewBottom = viewTop + scrollEl.clientHeight;
    const baseOverscan = Math.max(
      MIN_OVERSCAN_PX,
      scrollEl.clientHeight * BASE_OVERSCAN_VIEWPORTS,
    );
    const maxOverscan = Math.max(
      baseOverscan,
      scrollEl.clientHeight * MAX_OVERSCAN_VIEWPORTS,
    );
    const motionActive = now < scrollActiveUntil;
    const predictiveOverscan = motionActive
      ? Math.min(
          maxOverscan,
          Math.max(
            baseOverscan,
            recentScrollDelta * SCROLL_DELTA_LOOKAHEAD,
            Math.abs(scrollVelocity) * SCROLL_LOOKAHEAD_MS,
          ),
        )
      : baseOverscan;
    const leadingOverscan = scrollDirection < 0 ? predictiveOverscan : baseOverscan;
    const trailingOverscan = scrollDirection > 0 ? predictiveOverscan : baseOverscan;
    const start = binarySearchFirstBottomAfter(records, viewTop - leadingOverscan);
    const end = binarySearchFirstTopAtOrAfter(records, viewBottom + trailingOverscan);
    const nextWindowRecords = new Set(records.slice(start, end));

    if (motionActive) {
      for (const record of currentWindowRecords) {
        if (nextWindowRecords.has(record) || !record.mounted) continue;
        record.scrollRetainedUntil = Math.max(
          record.scrollRetainedUntil,
          now + SCROLL_WINDOW_HYSTERESIS_MS,
        );
      }
    }
    currentWindowRecords = nextWindowRecords;

    projecting = true;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      const inWindow = index >= start && index < end;
      projectRecord(
        record,
        inWindow
          || record.scrollRetainedUntil > now
          || recordRequiresMount(record, now),
      );
    }
    mutationObserver.takeRecords();
    projecting = false;

    restoreLayoutAnchor(anchor);
    scheduleDynamicExpiry();
    onLayout();
  }

  function scheduleLayout(): void {
    if (rafId !== null) return;
    rafId = windowRef.requestAnimationFrame(layoutNow);
  }

  function handleScroll(): void {
    const now = performance.now();
    const nextScrollTop = scrollEl.scrollTop;
    const delta = nextScrollTop - lastObservedScrollTop;
    const elapsed = Math.max(1, now - lastObservedScrollAt);
    lastObservedScrollTop = nextScrollTop;
    lastObservedScrollAt = now;

    const isProgrammatic = pendingProgrammaticScrollTop !== null
      && Math.abs(nextScrollTop - pendingProgrammaticScrollTop) < 1;
    if (!isProgrammatic && Math.abs(delta) >= 0.5) {
      const nextDirection = Math.sign(delta);
      const instantaneousVelocity = delta / elapsed;
      if (nextDirection !== scrollDirection) {
        scrollVelocity = instantaneousVelocity;
        recentScrollDelta = Math.abs(delta);
      } else {
        scrollVelocity = (scrollVelocity * 0.55) + (instantaneousVelocity * 0.45);
        recentScrollDelta = Math.max(Math.abs(delta), recentScrollDelta * 0.65);
      }
      scrollDirection = nextDirection;
      scrollActiveUntil = now + SCROLL_ACTIVE_MS;
    }
    scheduleLayout();
  }

  function syncRows(): void {
    if (rafId !== null) {
      windowRef.cancelAnimationFrame(rafId);
      rafId = null;
    }
    layoutNow();
  }

  function invalidateRecord(record: VirtualRowRecord, keepMountedMs = DYNAMIC_ROW_GRACE_MS): void {
    record.dynamicUntil = Math.max(record.dynamicUntil, performance.now() + keepMountedMs);
    scheduleLayout();
  }

  function registerRow(row: HTMLElement): void {
    const record = recordForTopLevelRow(row);
    if (record) invalidateRecord(record);
    else scheduleLayout();
  }

  function markMessageStreaming(row: HTMLElement, streaming: boolean): void {
    row.dataset.virtualStreaming = streaming ? 'true' : 'false';
    const record = recordForTopLevelRow(row);
    if (!record) {
      scheduleLayout();
      return;
    }
    record.streaming = streaming;
    invalidateRecord(record);
  }

  function registerFinalizedMessage(row: HTMLElement, text: string): void {
    row.dataset.virtualStreaming = 'false';
    const record = recordForTopLevelRow(row);
    if (!record) {
      scheduleLayout();
      return;
    }
    record.streaming = false;
    invalidateRecord(record);
    scheduleMessagePreparation(record, text);
  }

  function invalidateRow(row: HTMLElement, keepMountedMs = DYNAMIC_ROW_GRACE_MS): void {
    const record = recordForTopLevelRow(row);
    if (record) invalidateRecord(record, keepMountedMs);
  }

  function mutateRow(row: HTMLElement, mutation: () => void): void {
    syncRecordOrder();
    measureMountedRecords();
    recomputePositions();
    const anchor = captureLayoutAnchor();
    const record = recordForTopLevelRow(row);
    mutation();
    if (record) {
      const nextHeight = measuredFlowHeight(record.row, windowRef);
      if (nextHeight > 0) {
        record.height = nextHeight;
        record.measured = true;
        cacheMeasuredHeight(record);
      }
      record.dynamicUntil = Math.max(
        record.dynamicUntil,
        performance.now() + DYNAMIC_ROW_GRACE_MS,
      );
    }
    recomputePositions();
    restoreLayoutAnchor(anchor);
    scheduleLayout();
  }

  function removeRow(row: Element | null | undefined): void {
    if (!(row instanceof HTMLElement)) return;
    const ownRecord = recordsByRow.get(row);
    if (ownRecord) {
      resizeObserver.unobserve(ownRecord.row);
      ownRecord.row.remove();
      ownRecord.placeholder.remove();
      recordsByRow.delete(ownRecord.row);
      recordsByPlaceholder.delete(ownRecord.placeholder);
      currentWindowRecords.delete(ownRecord);
      records = records.filter((candidate) => candidate !== ownRecord);
      scheduleLayout();
      return;
    }
    const parentRecord = recordForNode(row);
    row.remove();
    if (parentRecord) invalidateRecord(parentRecord);
    else scheduleLayout();
  }

  function recordTranscriptCardId(record: VirtualRowRecord): string | null {
    const direct = record.row.dataset.transcriptCardId || '';
    if (direct) return direct;
    const nested = record.row.querySelector<HTMLElement>('[data-transcript-card-id]');
    return nested?.dataset.transcriptCardId || null;
  }

  function parseTranscriptCardIndex(value: string | null | undefined): number | null {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  function recordTranscriptCardRoots(record: VirtualRowRecord): HTMLElement[] {
    const roots = [
      record.row,
      ...Array.from(
        record.row.querySelectorAll<HTMLElement>('[data-transcript-card-id]'),
      ),
    ];
    return roots.filter((row) => Boolean(row.dataset.transcriptCardId));
  }

  function recordTranscriptCardIndexRange(
    record: VirtualRowRecord,
    scope: 'durable' | 'active' | null = 'durable',
  ): VisibleTranscriptCardRange | null {
    const indices = recordTranscriptCardRoots(record)
      .filter((row) => scope === null || readTranscriptCardScope(row) === scope)
      .map((row) => parseTranscriptCardIndex(row.dataset.transcriptCardIndex))
      .filter((index): index is number => index !== null);
    if (!indices.length) return null;
    return {
      first: Math.min(...indices),
      last: Math.max(...indices),
    };
  }

  function visibleTranscriptCardRange(): VisibleTranscriptCardRange | null {
    if (!records.length) return null;
    const viewTop = viewportTopInTimeline();
    const viewBottom = viewTop + scrollEl.clientHeight;
    const start = binarySearchFirstBottomAfter(records, viewTop);
    const end = binarySearchFirstTopAtOrAfter(records, viewBottom);
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    const viewportRect = scrollEl.getBoundingClientRect();
    for (const record of records.slice(start, end)) {
      for (const row of recordTranscriptCardRoots(record)) {
        if (readTranscriptCardScope(row) !== 'durable') continue;
        const index = parseTranscriptCardIndex(row.dataset.transcriptCardIndex);
        if (index === null) continue;
        if (row !== record.row) {
          const rect = row.getBoundingClientRect();
          if (
            row.getClientRects().length === 0
            || rect.bottom <= viewportRect.top
            || rect.top >= viewportRect.bottom
          ) {
            continue;
          }
        }
        first = Math.min(first, index);
        last = Math.max(last, index);
      }
    }
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
    return { first, last };
  }

  function transcriptProjectionMetrics(): TranscriptProjectionViewportMetrics {
    const durableRecords = records
      .map((record) => ({ record, range: recordTranscriptCardIndexRange(record) }))
      .filter((entry): entry is { record: VirtualRowRecord; range: VisibleTranscriptCardRange } => entry.range !== null);
    if (!durableRecords.length) {
      return {
        first: null,
        last: null,
        visible: null,
        distanceToStartPx: null,
        distanceToEndPx: null,
      };
    }
    const viewTop = viewportTopInTimeline();
    const viewBottom = viewTop + scrollEl.clientHeight;
    const firstRecord = durableRecords[0]!.record;
    const lastRecord = durableRecords[durableRecords.length - 1]!.record;
    return {
      first: Math.min(...durableRecords.map(({ range }) => range.first)),
      last: Math.max(...durableRecords.map(({ range }) => range.last)),
      visible: visibleTranscriptCardRange(),
      distanceToStartPx: Math.max(0, viewTop - firstRecord.bottom),
      distanceToEndPx: Math.max(0, lastRecord.top - viewBottom),
    };
  }

  function debugSnapshot(): TimelineVirtualizerDebugSnapshot {
    const metrics = transcriptProjectionMetrics();
    const roots = records.flatMap(recordTranscriptCardRoots);
    return {
      records: records.length,
      mounted: records.filter((record) => record.mounted).length,
      parked: records.filter((record) => !record.mounted).length,
      durableRoots: roots.filter((row) => readTranscriptCardScope(row) === 'durable').length,
      activeRoots: roots.filter((row) => readTranscriptCardScope(row) === 'active').length,
      unscopedRoots: roots.filter((row) => readTranscriptCardScope(row) === null).length,
      first: metrics.first,
      last: metrics.last,
      visible: metrics.visible,
      distanceToStartPx: metrics.distanceToStartPx,
      distanceToEndPx: metrics.distanceToEndPx,
    };
  }

  function captureTranscriptAnchor(edge: 'start' | 'end'): TranscriptAnchor | null {
    syncRows();
    if (!records.length) return null;
    const viewTop = viewportTopInTimeline();
    const viewBottom = viewTop + scrollEl.clientHeight;
    const candidateIndex = edge === 'start'
      ? binarySearchFirstBottomAfter(records, viewTop)
      : Math.max(0, binarySearchFirstTopAtOrAfter(records, viewBottom) - 1);
    for (let distance = 0; distance < records.length; distance += 1) {
      const indices = distance === 0
        ? [candidateIndex]
        : [candidateIndex - distance, candidateIndex + distance];
      for (const index of indices) {
        const record = records[index];
        if (!record) continue;
        const cardId = recordTranscriptCardId(record);
        if (!cardId) continue;
        return {
          cardId,
          edge,
          offsetPx: edge === 'start'
            ? record.top - viewTop
            : viewBottom - record.bottom,
        };
      }
    }
    return null;
  }

  function restoreTranscriptAnchor(anchor: TranscriptAnchor | null): void {
    if (!anchor) return;
    syncRows();
    const record = records.find((candidate) => {
      if (recordTranscriptCardId(candidate) === anchor.cardId) return true;
      return Array.from(
        candidate.row.querySelectorAll<HTMLElement>('[data-transcript-card-id]'),
      ).some((row) => row.dataset.transcriptCardId === anchor.cardId);
    });
    if (!record) return;
    const contentOffset = timelineContentOffset();
    const nextScrollTop = anchor.edge === 'start'
      ? contentOffset + record.top - anchor.offsetPx
      : contentOffset + record.bottom + anchor.offsetPx - scrollEl.clientHeight;
    setScrollProgrammatic(true);
    pendingProgrammaticScrollTop = Math.max(0, nextScrollTop);
    scrollEl.scrollTop = pendingProgrammaticScrollTop;
    windowRef.requestAnimationFrame(() => {
      pendingProgrammaticScrollTop = null;
      setScrollProgrammatic(false);
      scheduleLayout();
    });
  }

  function reset(preserveMeasurements = false): void {
    disposedGeneration += 1;
    if (rafId !== null) {
      windowRef.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (dynamicTimer !== null) {
      windowRef.clearTimeout(dynamicTimer);
      dynamicTimer = null;
    }
    resizeObserver.disconnect();
    recordsByRow.clear();
    recordsByPlaceholder.clear();
    records = [];
    currentWindowRecords.clear();
    if (!preserveMeasurements) {
      measuredHeightCache.clear();
    }
    lastTimelineWidth = 0;
    lastObservedScrollTop = scrollEl.scrollTop;
    lastObservedScrollAt = performance.now();
    recentScrollDelta = 0;
    scrollVelocity = 0;
    scrollDirection = 0;
    scrollActiveUntil = 0;
    pendingProgrammaticScrollTop = null;
  }

  const resizeObserver = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLElement)) continue;
      const record = recordsByRow.get(entry.target);
      if (!record || !record.mounted) continue;
      const nextHeight = measuredFlowHeight(record.row, windowRef);
      if (!(nextHeight > 0) || Math.abs(nextHeight - record.height) < 0.5) continue;
      record.height = nextHeight;
      record.measured = true;
      cacheMeasuredHeight(record);
      changed = true;
    }
    if (changed) scheduleLayout();
  });

  const mutationObserver = new MutationObserver((mutations) => {
    if (projecting) return;
    let needsSync = false;
    for (const mutation of mutations) {
      if (mutation.target === timeline) {
        needsSync = true;
        continue;
      }
      const targetPlaceholder = mutation.target instanceof HTMLDivElement
        ? recordsByPlaceholder.get(mutation.target)
        : null;
      const record = targetPlaceholder || recordForNode(mutation.target);
      if (record) {
        invalidateRecord(record);
        needsSync = true;
      }
    }
    if (needsSync) scheduleLayout();
  });

  mutationObserver.observe(timeline, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-approval-source'],
    characterData: true,
    childList: true,
    subtree: true,
  });
  scrollEl.addEventListener('scroll', handleScroll, { passive: true });
  const timelineResizeObserver = new ResizeObserver(scheduleLayout);
  timelineResizeObserver.observe(timeline);
  scheduleLayout();

  return {
    scheduleLayout,
    syncRows,
    reset,
    removeRow,
    registerRow,
    markMessageStreaming,
    registerFinalizedMessage,
    invalidateRow,
    mutateRow,
    captureTranscriptAnchor,
    restoreTranscriptAnchor,
    visibleTranscriptCardRange,
    transcriptProjectionMetrics,
    debugSnapshot,
  };
}
