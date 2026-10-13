import { bindAssistantStream } from '../assistant_stream.ts';
import { bindDiffRendering } from '../diff/rendering.ts';
import { bindApprovalUi } from '../approvals/ui.ts';
import {
  applyTranscriptCardMetadata,
  type TranscriptCardMetadata,
} from '../transcript_card_metadata.ts';
import { createPathScrollLabel } from '../path_label.ts';
import type { UnknownRecord } from '../shared_types.ts';

type AssistantRows = Parameters<typeof bindAssistantStream>[0]['assistantRows'];
type ApprovalBinding = ReturnType<typeof bindApprovalUi>;
type ApprovalEvent = Parameters<ApprovalBinding['renderApproval']>[0];
type ApprovalRenderOptions = Parameters<ApprovalBinding['renderApproval']>[1];
type RequestCardRuntime = Parameters<typeof bindApprovalUi>[0]['requestCardRuntime'];

interface ReasoningRowEntry {
  row: HTMLElement;
  body: HTMLElement;
  pre: HTMLPreElement;
}

interface DiffRowEntry {
  block: HTMLElement;
  row: HTMLElement;
}

interface SubagentContainerRecord {
  body?: HTMLElement | null;
  [key: string]: unknown;
}

interface AgentBlockRowEntry {
  row: HTMLElement;
  cmdRibbon: HTMLElement;
  termEl: HTMLElement;
  text: string;
  screenRows: string[] | null;
  renderMode: 'raw' | 'screen';
  hasRawStream: boolean;
  buf?: string;
  term?: { reset(): void } | null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

interface LiveItemsState {
  lastEventType?: string | null;
  activeAgentPtyBlockId?: string | null;
}

interface LiveItemsContext {
  getState(): LiveItemsState;
  setState(patch: Partial<LiveItemsState>): void;
  assistantRows: AssistantRows;
  reasoningRows: Map<string, ReasoningRowEntry>;
  diffRows: Map<string, DiffRowEntry>;
  agentBlockRows: Map<string, AgentBlockRowEntry>;
  timelineEl: HTMLElement | null;
  buildMessageCard(role: string, text?: string): { row: HTMLElement; body: HTMLElement };
  updateMessageCardHeader(row: HTMLElement, role: string, text: string): void;
  insertRow(row: HTMLElement, beforeEl?: ChildNode | null): void;
  createRow(kind: string, title: string, beforeEl?: ChildNode | null, parentEl?: HTMLElement | null): { row: HTMLElement; body: HTMLElement };
  buildRow(kind: string, title: string): { row: HTMLElement; body: HTMLElement };
  makeCollapsible(row: HTMLElement, cardId: string, startExpanded: boolean, options?: UnknownRecord): void;
  clearPlaceholder(): void;
  setActivity(label: string, active: boolean): void;
  setStatusDot(status: string | null): void;
  setCommandRunning(running: boolean): void;
  maybeAutoScroll(force?: boolean): void;
  isMarkdownEnabled(): boolean;
  createStreamingParser(target: HTMLElement): unknown;
  renderEventMarkdownInto(target: HTMLElement, markdown: string): void;
  streamWrite(parser: unknown, chunk: string): void;
  streamEnd(parser: unknown): void;
  highlightCode(target: HTMLElement): void;
  incrementMessages(): void;
  stripCitations(text: string): string;
  escapeHtml(text: string): string;
  toRelativePath(path: string): string;
  postTe2OpenRequest(target: { path?: unknown; line?: unknown; column?: unknown }): unknown;
  renderShellCmdRibbon(el: HTMLElement, cmd: string): unknown;
  highlightCodeAlways(text: string, lang: string): string;
  detectLangFromPath(path: string): string;
  resolveHljsLanguage(lang: string): string;
  detectLangFromCommand(command: string): string;
  isDiffSyntaxEnabled(): boolean;
  sioCall(event: string, data?: Record<string, unknown>): Promise<unknown>;
  getConversationId(): string | null;
  getConversationMeta(): UnknownRecord;
  setConversationMeta(nextMeta: UnknownRecord): void;
  getCurrentExtensionId(): string;
  getSubagentContainer(id: string, name: string, intent: string): SubagentContainerRecord;
  requestCardRuntime: RequestCardRuntime;
  onAfterRender(): void;
  onMessageStreaming?(row: HTMLElement): void;
  onMessageFinalized?(row: HTMLElement, text: string): void;
}

export function bindTimelineLiveItems(ctx: LiveItemsContext) {
  const {
    getState,
    setState,
    assistantRows,
    reasoningRows,
    diffRows,
    agentBlockRows,
    timelineEl,
    buildMessageCard,
    updateMessageCardHeader,
    insertRow,
    createRow,
    buildRow,
    makeCollapsible,
    clearPlaceholder,
    setActivity,
    setStatusDot,
    setCommandRunning,
    maybeAutoScroll,
    isMarkdownEnabled,
    createStreamingParser,
    renderEventMarkdownInto,
    streamWrite,
    streamEnd,
    highlightCode,
    incrementMessages,
    stripCitations,
    escapeHtml,
    toRelativePath,
    postTe2OpenRequest,
    renderShellCmdRibbon,
    highlightCodeAlways,
    detectLangFromPath,
    resolveHljsLanguage,
    detectLangFromCommand,
    isDiffSyntaxEnabled,
    sioCall,
    getConversationId,
    getConversationMeta,
    setConversationMeta,
    getCurrentExtensionId,
    getSubagentContainer,
    requestCardRuntime,
    onAfterRender,
    onMessageStreaming,
    onMessageFinalized,
  } = ctx;

  function setLastEventType(value: string) {
    setState({ lastEventType: value });
  }

  const assistantStream = bindAssistantStream({
    assistantRows,
    buildMessageCard,
    updateMessageCardHeader,
    insertRow: (row) => insertRow(row),
    isMarkdownEnabled,
    createStreamingParser,
    renderEventMarkdownInto,
    streamWrite,
    streamEnd,
    highlightCode,
    incrementMessages,
    stripCitations,
    onMessageStreaming,
    onMessageFinalized,
    maybeAutoScroll: () => {
      setLastEventType('message');
      maybeAutoScroll();
    },
  });

  function appendAssistantDelta(
    id: string | null | undefined,
    delta: string,
    parentEl?: HTMLElement | null,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    setLastEventType('message');
    assistantStream.appendAssistantDelta(id, delta, parentEl, metadata);
  }

  function finalizeAssistant(
    id: string | null | undefined,
    text: string,
    parentEl?: HTMLElement | null,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    setLastEventType('message');
    assistantStream.finalizeAssistant(id, text, parentEl, metadata);
  }

  function getReasoningRow(
    id: string | null | undefined,
    parentEl: HTMLElement | null = null,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    const key = id || 'reasoning';
    let entry = reasoningRows.get(key);
    if (!entry) {
      const { row, body } = createRow('reasoning', 'reasoning', undefined, parentEl);
      applyTranscriptCardMetadata(row, metadata);
      const pre = document.createElement('pre');
      pre.textContent = '';
      body.append(pre);
      entry = { row, body, pre };
      reasoningRows.set(key, entry);
    } else if (parentEl && entry.row && entry.row.parentElement !== parentEl) {
      parentEl.appendChild(entry.row);
    }
    applyTranscriptCardMetadata(entry.row, metadata);
    return entry;
  }

  function appendReasoningDelta(
    id: string | null | undefined,
    delta: string,
    parentEl: HTMLElement | null = null,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    if (delta === undefined || delta === null) return;
    const entry = getReasoningRow(id, parentEl, metadata);
    entry.pre.textContent += delta;
    setLastEventType('reasoning');
    maybeAutoScroll();
  }

  function finalizeReasoning(
    id: string | null | undefined,
    text: string,
    parentEl: HTMLElement | null = null,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    const entry = getReasoningRow(id, parentEl, metadata);
    if (text) entry.pre.textContent = text;
    setLastEventType('reasoning');
    maybeAutoScroll();
  }

  function getDiffRow(
    id: string | null | undefined,
    path: string,
    parentEl?: HTMLElement | null,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    const key = id || 'diff';
    let entry = diffRows.get(key);
    if (!entry) {
      const { row, body } = buildRow('diff', 'diff');
      applyTranscriptCardMetadata(row, metadata);
      const pathLabel = document.createElement('div');
      pathLabel.className = 'diff-path-label command-ribbon';
      if (path) {
        pathLabel.appendChild(createPathScrollLabel(document, toRelativePath(path), {
          title: path,
          strong: true,
          basenameClass: 'diff-filename',
        }));
        pathLabel.style.cursor = 'pointer';
        pathLabel.dataset.hasClickHandler = 'true';
        pathLabel.addEventListener('click', (evt) => {
          const target = evt.target;
          if (target instanceof Element && target.closest('.twisty')) return;
          void postTe2OpenRequest({ path, line: 1, column: 1 });
        });
      } else {
        pathLabel.innerHTML = '<strong>diff</strong>';
      }
      body.append(pathLabel);
      const block = document.createElement('div');
      block.className = 'diff-block';
      body.append(block);
      if (parentEl) {
        parentEl.appendChild(row);
      } else {
        insertRow(row);
      }
      makeCollapsible(row, `diff:${key}`, false);
      entry = { block, row };
      diffRows.set(key, entry);
    }
    applyTranscriptCardMetadata(entry.row, metadata);
    return entry;
  }

  const diffRendering = bindDiffRendering({
    getDiffRow,
    createRow,
    escapeHtml,
    toRelativePath,
    isDiffSyntaxEnabled,
    detectLangFromPath,
    resolveHljsLanguage,
    setLastEventType,
    maybeAutoScroll,
    timelineEl,
    postTe2OpenRequest,
  });

  function addDiff(
    id: string,
    text: string,
    path: string,
    parentEl?: HTMLElement | null,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    return diffRendering.addDiff(id, text, path, parentEl, metadata);
  }

  function addDeclinedDiff(id: string, text: string, path: string) {
    return diffRendering.addDeclinedDiff(id, text, path);
  }

  function formatDiff(text: string, filePath: string) {
    return diffRendering.formatDiff(text, filePath);
  }

  function renderDiffBlock(block: HTMLElement, text: string, filePath: string) {
    return diffRendering.renderDiffBlock(block, text, filePath);
  }

  function getDiffRenderState() {
    return diffRendering.getDiffRenderState();
  }

  function setDiffRenderMode(mode: string) {
    return diffRendering.setDiffRenderMode(mode);
  }

  function getAgentBlockRow(
    blockId: string | null | undefined,
    label: string,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    const key = blockId || `agent-block:${label || 'agent'}`;
    let entry = agentBlockRows.get(key);
    if (!entry) {
      clearPlaceholder();
      const row = document.createElement('div');
      row.className = 'timeline-row command-result terminal-card';
      row.dataset.agentBlockId = key;
      applyTranscriptCardMetadata(row, metadata);

      const body = document.createElement('div');
      body.className = 'body';

      const cmdRibbon = document.createElement('div');
      cmdRibbon.className = 'command-ribbon';
      cmdRibbon.textContent = label ? `[agent] ${label}` : '[agent]';
      body.appendChild(cmdRibbon);

      const termEl = document.createElement('div');
      termEl.className = 'command-output';
      body.appendChild(termEl);

      row.appendChild(body);
      insertRow(row);
      entry = { row, cmdRibbon, termEl, text: '', screenRows: null, renderMode: 'raw', hasRawStream: false };
      agentBlockRows.set(key, entry);
    } else {
      applyTranscriptCardMetadata(entry.row, metadata);
    }
    return entry;
  }

  function renderAgentBlockBegin(evt: UnknownRecord) {
    const block = isRecord(evt.block) ? evt.block : {};
    const blockId = asString(evt.block_id, asString(block.block_id, asString(evt.blockId, 'agent')));
    const cmd = asString(block.cmd);
    const label = cmd ? `$ ${cmd}` : 'agent pty';
    const entry = getAgentBlockRow(blockId, label, evt);
    entry.cmdRibbon.textContent = cmd ? `$ ${cmd}` : '';
    entry.text = '';
    entry.screenRows = null;
    entry.renderMode = 'raw';
    entry.hasRawStream = false;
    setState({ activeAgentPtyBlockId: blockId });
    entry.termEl.textContent = '';
    setLastEventType('shell');
    setActivity('agent pty', true);
    setCommandRunning(true);
    maybeAutoScroll();
  }

  function renderAgentBlockDelta(evt: UnknownRecord) {
    const blockId = asString(evt.block_id, asString(evt.blockId, 'agent'));
    const entry = agentBlockRows.get(blockId) || getAgentBlockRow(blockId, 'agent pty', evt);
    applyTranscriptCardMetadata(entry.row, evt);
    if (entry.renderMode === 'screen' || entry.hasRawStream) return;
    const delta = asString(evt.delta);
    if (!delta) return;
    entry.text += delta;
    entry.termEl.textContent = entry.text;
    setLastEventType('shell');
    maybeAutoScroll();
  }

  function renderScreenDelta(evt: UnknownRecord) {
    const blockId = asString(evt.block_id, asString(evt.blockId));
    if (!blockId) return;
    const entry = agentBlockRows.get(blockId) || getAgentBlockRow(blockId, 'agent pty', evt);
    applyTranscriptCardMetadata(entry.row, evt);
    if (entry.renderMode !== 'screen') return;
    if (entry.renderMode !== 'screen') {
      entry.renderMode = 'screen';
      entry.text = '';
      entry.buf = '';
      if (entry.term) {
        entry.term.reset();
      }
    }
    const rowCount = asFiniteNumber(evt.rows_count, 40);
    const screenRows = entry.screenRows && entry.screenRows.length === rowCount
      ? entry.screenRows
      : new Array(rowCount).fill('');
    entry.screenRows = screenRows;
    const rows = Array.isArray(evt.rows) ? evt.rows : [];
    rows.forEach((rowData) => {
      if (!isRecord(rowData)) return;
      const idx = asFiniteNumber(rowData.row, -1);
      if (idx >= 0 && idx < screenRows.length) {
        screenRows[idx] = asString(rowData.text);
      }
    });
    entry.termEl.textContent = screenRows.join('\n');
    setLastEventType('shell');
    maybeAutoScroll();
  }

  function renderAgentBlockEnd(evt: UnknownRecord) {
    const block = isRecord(evt.block) ? evt.block : {};
    const blockId = asString(evt.block_id, asString(block.block_id, asString(evt.blockId, 'agent')));
    const entry = agentBlockRows.get(blockId);
    if (!entry) return;
    applyTranscriptCardMetadata(entry.row, evt);
    const exitCode = block.exit_code ?? block.exitCode;
    if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
      const footer = document.createElement('div');
      footer.className = 'command-footer';
      footer.textContent = `exit ${exitCode}`;
      entry.row.querySelector('.body')?.appendChild(footer);
      setStatusDot('error');
    } else {
      setStatusDot('success');
    }
    setActivity('idle', false);
    setCommandRunning(false);
    setLastEventType('shell');
    maybeAutoScroll();
    if (getState().activeAgentPtyBlockId === blockId) {
      setState({ activeAgentPtyBlockId: null });
    }
  }

  function renderPlanCard(
    steps: UnknownRecord[],
    parentEl: HTMLElement | null = null,
    metadata: TranscriptCardMetadata | null = null,
  ) {
    if (!steps || !steps.length) return;
    const { row, body } = createRow('plan', 'plan', undefined, parentEl);
    applyTranscriptCardMetadata(row, metadata);

    const header = document.createElement('div');
    header.className = 'plan-card-header';
    let collapsed = false;

    const toggleBtn = document.createElement('span');
    toggleBtn.className = 'plan-toggle';
    toggleBtn.textContent = '[-]';

    const title = document.createElement('span');
    title.className = 'plan-title';
    title.textContent = 'Plan';

    header.append(toggleBtn, title);
    body.appendChild(header);

    const list = document.createElement('div');
    list.className = 'plan-list';

    steps.forEach((item) => {
      const status = typeof item.status === 'string' ? item.status : 'pending';
      const stepText = typeof item.step === 'string' ? item.step : '';
      const stepEl = document.createElement('div');
      stepEl.className = `plan-item ${status}`;

      const checkbox = document.createElement('span');
      checkbox.className = 'plan-checkbox';
      if (status === 'completed') {
        checkbox.textContent = '☑';
      } else if (status === 'in_progress') {
        checkbox.textContent = '◐';
      } else {
        checkbox.textContent = '☐';
      }

      const textEl = document.createElement('span');
      textEl.className = 'plan-text';
      textEl.textContent = stepText;

      stepEl.append(checkbox, textEl);
      list.appendChild(stepEl);
    });

    body.appendChild(list);

    toggleBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      toggleBtn.textContent = collapsed ? '[+]' : '[-]';
      list.style.display = collapsed ? 'none' : 'flex';
      onAfterRender();
    });

    setLastEventType('plan');
    maybeAutoScroll();
    onAfterRender();
  }

  const approvalUi = bindApprovalUi({
    sioCall,
    getConversationId,
    getConversationMeta,
    setConversationMeta,
    getCurrentExtensionId,
    createRow,
    getSubagentContainer,
    escapeHtml,
    formatDiff,
    renderDiffBlock,
    renderEventMarkdownInto,
    toRelativePath,
    requestCardRuntime,
    timelineEl,
    onAfterRender,
  });

  function renderApproval(evt: ApprovalEvent, options: ApprovalRenderOptions = {}) {
    return approvalUi.renderApproval(evt, options);
  }

  function respondApproval(requestId: string, decision: unknown) {
    return approvalUi.respondApproval(requestId, decision);
  }

  function handoffApproval(evt: ApprovalEvent) {
    return approvalUi.handoffApproval(evt);
  }

  function invalidateApproval(evt: ApprovalEvent) {
    return approvalUi.invalidateApproval(evt);
  }

  function restorePendingApprovals() {
    approvalUi.restorePendingApprovals();
  }

  return {
    getAssistantRow: assistantStream.getAssistantRow,
    appendAssistantDelta,
    finalizeAssistant,
    getReasoningRow,
    appendReasoningDelta,
    finalizeReasoning,
    getDiffRow,
    addDiff,
    addDeclinedDiff,
    formatDiff,
    renderDiffBlock,
    getDiffRenderState,
    setDiffRenderMode,
    getAgentBlockRow,
    renderAgentBlockBegin,
    renderAgentBlockDelta,
    renderScreenDelta,
    renderAgentBlockEnd,
    renderPlanCard,
    renderApproval,
    respondApproval,
    handoffApproval,
    invalidateApproval,
    restorePendingApprovals,
  };
}
