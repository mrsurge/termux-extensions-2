import { applyTranscriptCardMetadata, type TranscriptCardMetadata } from '../transcript_card_metadata.ts';
import type { MessageCardRow } from '../shared_types.ts';

interface TimelineRowsState {
  bottomSpacerEl?: HTMLElement | null;
  placeholderCleared?: boolean;
  messageCount?: number;
  tokenCount?: number;
}

interface TimelineRowsContext {
  getState(): TimelineRowsState;
  setState(patch: Partial<TimelineRowsState>): void;
  timelineEl: HTMLElement | null;
  counterMessagesEl: HTMLElement | null;
  counterTokensEl: HTMLElement | null;
  contextRemainingEl: HTMLElement | null;
  statusRibbonEl: HTMLElement | null;
  statusLabelEl: HTMLElement | null;
  statusReasoningEl: HTMLElement | null;
  statusDotEl: HTMLElement | null;
  documentRef: Document;
  getUserDisplayName(): string;
  getAssistantDisplayName(): string;
  isMarkdownEnabled(): boolean;
  renderMarkdownItBlock(text: string): Node;
  stripCitations(text: string): string;
  maybeAutoScroll(force?: boolean): void;
  onRowInserted?(row: HTMLElement): void;
  onMessageFinalized?(row: HTMLElement, text: string): void;
  onIdle?(): void;
}

const WAITING_FOR_EVENTS_LABEL = 'Waiting for events...';

export function bindTimelineRows(ctx: TimelineRowsContext) {
  const {
    getState,
    setState,
    timelineEl,
    counterMessagesEl,
    counterTokensEl,
    contextRemainingEl,
    statusRibbonEl,
    statusLabelEl,
    statusReasoningEl,
    statusDotEl,
    documentRef,
    getUserDisplayName,
    getAssistantDisplayName,
    isMarkdownEnabled,
    renderMarkdownItBlock,
    stripCitations,
    maybeAutoScroll,
    onRowInserted,
    onMessageFinalized,
  } = ctx;

  function clearPlaceholder() {
    if (getState().placeholderCleared) return;
    const placeholder = documentRef.getElementById('timeline-placeholder')
      || timelineEl?.querySelector('.timeline-row.muted');
    if (placeholder instanceof HTMLElement) placeholder.remove();
    setState({ placeholderCleared: true });
  }

  function ensureActivityRow() {
    // No longer needed - status ribbon is always present in HTML.
  }

  function insertRow(row: HTMLElement, beforeEl: ChildNode | null = null) {
    if (!timelineEl) return;
    clearPlaceholder();
    const { bottomSpacerEl } = getState();
    if (beforeEl && beforeEl.parentElement === timelineEl) {
      timelineEl.insertBefore(row, beforeEl);
    } else if (bottomSpacerEl && bottomSpacerEl.parentElement === timelineEl) {
      timelineEl.insertBefore(row, bottomSpacerEl);
    } else {
      timelineEl.appendChild(row);
    }
    onRowInserted?.(row);
    maybeAutoScroll();
  }

  function buildRow(kind: string, title: string) {
    const row = documentRef.createElement('div');
    row.className = `timeline-row ${kind || ''}`.trim();
    const meta = documentRef.createElement('div');
    meta.className = 'meta';
    meta.textContent = title || '';
    const body = documentRef.createElement('div');
    body.className = 'body';
    row.append(meta, body);
    return { row, body };
  }

  function getMessageRoleLabel(role: string) {
    if (role === 'assistant') return getAssistantDisplayName();
    if (role === 'user') return getUserDisplayName();
    return role || 'message';
  }

  function updateMessageCardHeader(row: MessageCardRow | null | undefined, role: string, text: string) {
    if (!row) return;
    row.dataset.messageRole = role || 'message';
    row._messageText = text || '';
    const headerEl = row.querySelector(':scope > .message-header');
    if (!(headerEl instanceof HTMLElement)) return;
    const titleEl = headerEl.querySelector('.message-header-title');
    if (titleEl instanceof HTMLElement) titleEl.textContent = getMessageRoleLabel(role);
    headerEl.dataset.expanded = 'true';
  }

  function refreshMessageCardHeaders() {
    if (!timelineEl) return;
    timelineEl.querySelectorAll('.message-card').forEach((row) => {
      const messageRow = row as MessageCardRow;
      updateMessageCardHeader(
        messageRow,
        messageRow.dataset.messageRole || messageRow._messageRole || 'message',
        messageRow._messageText || '',
      );
    });
  }

  function buildMessageCard(role: string, text = '') {
    const row = documentRef.createElement('div') as MessageCardRow;
    row.className = `timeline-row message message-card ${role === 'user' ? 'user' : ''}`.trim();

    const header = documentRef.createElement('div');
    header.className = 'message-header command-ribbon';
    const title = documentRef.createElement('span');
    title.className = 'message-header-title';
    header.append(title);

    const body = documentRef.createElement('div');
    body.className = 'body message-body';

    row.append(header, body);
    row._messageRole = role || 'message';
    updateMessageCardHeader(row, role, text);
    return { row, body, header, title };
  }

  function createRow(kind: string, title: string, beforeEl: ChildNode | null = null, parentEl: HTMLElement | null = null) {
    const { row, body } = buildRow(kind, title);
    if (parentEl) {
      clearPlaceholder();
      if (row.parentElement !== parentEl) parentEl.appendChild(row);
      onRowInserted?.(row);
      maybeAutoScroll();
    } else {
      insertRow(row, beforeEl);
    }
    return { row, body };
  }

  let idleLabel = '';
  let showingIdle = true;
  function setIdleLabel(label: string) {
    idleLabel = label;
    if (statusLabelEl && showingIdle) statusLabelEl.textContent = idleLabel;
  }

  function setActivity(label: string, active: boolean) {
    showingIdle = !active && (!label || label.toLowerCase() === 'idle');
    if (statusLabelEl) statusLabelEl.textContent = showingIdle ? idleLabel : label;
    if (statusRibbonEl) statusRibbonEl.classList.toggle('active', Boolean(active));
    if (showingIdle) ctx.onIdle?.();
  }

  function showWaitingForEvents() {
    setActivity(WAITING_FOR_EVENTS_LABEL, true);
    clearReasoningRibbon();
    setStatusDot(null);
  }

  function clearWaitingForEvents() {
    if (
      statusLabelEl
      && statusLabelEl.textContent === WAITING_FOR_EVENTS_LABEL
      && statusRibbonEl?.classList.contains('active')
    ) {
      setActivity('idle', false);
    }
  }

  function setReasoningRibbon(text: string) {
    if (!statusReasoningEl) return;
    if (!text) {
      clearReasoningRibbon();
      return;
    }
    statusReasoningEl.textContent = text;
    statusReasoningEl.classList.add('active');
  }

  function clearReasoningRibbon() {
    if (!statusReasoningEl) return;
    statusReasoningEl.textContent = '';
    statusReasoningEl.classList.remove('active');
  }

  function setStatusDot(status: string | null) {
    if (!statusDotEl) return;
    statusDotEl.classList.remove('success', 'error', 'warning');
    if (status) statusDotEl.classList.add(status);
  }

  function setCounter(el: HTMLElement | null, value: number) {
    if (!el) return;
    el.textContent = String(value);
  }

  function incrementMessages() {
    const nextValue = Number(getState().messageCount || 0) + 1;
    setState({ messageCount: nextValue });
    setCounter(counterMessagesEl, nextValue);
  }

  function updateTokens(total: number) {
    if (!Number.isFinite(total)) return;
    const nextValue = Number(total);
    setState({ tokenCount: nextValue });
    setCounter(counterTokensEl, nextValue);
  }

  function updateContextRemaining(total: number, windowSize: number) {
    if (!contextRemainingEl) return;
    if (!Number.isFinite(total) || !Number.isFinite(windowSize) || windowSize <= 0) {
      contextRemainingEl.textContent = '—';
      return;
    }
    const pct = Math.min(100, Math.round((Number(total) / Number(windowSize)) * 100));
    contextRemainingEl.textContent = `${pct}%`;
    if (pct >= 90) {
      contextRemainingEl.classList.add('critical');
      contextRemainingEl.classList.remove('warn');
    } else if (pct >= 70) {
      contextRemainingEl.classList.add('warn');
      contextRemainingEl.classList.remove('critical');
    } else {
      contextRemainingEl.classList.remove('warn', 'critical');
    }
  }

  function addMessage(
    role: string,
    text: string,
    parentEl: HTMLElement | null = null,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    const cleanText = role === 'assistant' ? stripCitations(text || '') : (text || '');
    const useMessageCard = role === 'assistant' || role === 'user';
    const { row, body } = useMessageCard
      ? buildMessageCard(role, cleanText)
      : buildRow('message', role === 'assistant' ? 'assistant' : role);
    applyTranscriptCardMetadata(row, metadata);
    if (!useMessageCard && role === 'user') row.classList.add('user');
    if (parentEl) {
      clearPlaceholder();
      parentEl.appendChild(row);
    } else {
      insertRow(row);
    }
    if ((role === 'assistant' || role === 'user') && isMarkdownEnabled()) {
      body.append(renderMarkdownItBlock(cleanText));
    } else {
      const pre = documentRef.createElement('pre');
      pre.textContent = cleanText;
      body.append(pre);
    }
    if (useMessageCard) onMessageFinalized?.(row, cleanText);
    incrementMessages();
    maybeAutoScroll();
  }

  return {
    clearPlaceholder,
    ensureActivityRow,
    insertRow,
    buildRow,
    updateMessageCardHeader,
    refreshMessageCardHeaders,
    buildMessageCard,
    createRow,
    setActivity,
    setIdleLabel,
    showWaitingForEvents,
    clearWaitingForEvents,
    setReasoningRibbon,
    clearReasoningRibbon,
    setStatusDot,
    setCounter,
    incrementMessages,
    updateTokens,
    updateContextRemaining,
    addMessage,
  };
}
