import {
  applyTranscriptCardMetadata,
  findTranscriptCardRow,
} from '../transcript_card_metadata.ts';
import { renderShellSummary } from '../shell_render.ts';
import { mountShellOutputWindow } from '../shell_output_window.ts';
import { ansiToHtml, hasAnsiSgr } from '../terminal_ansi.ts';
import type { ToggleableRow, UnknownRecord } from '../shared_types.ts';
import type { TranscriptCardRecipe } from '../rpc/conversations/contract.ts';

interface AgentPtyReplayRecord {
  row: HTMLElement;
  termEl: HTMLDivElement;
  cmdRibbon: HTMLDivElement;
  cmd: string;
  buf: string;
  text: string;
  screenRows: string[] | null;
  renderMode: 'raw' | 'screen';
  hasRawStream: boolean;
}

interface ReplaySubagentRecord {
  row?: HTMLElement;
  body?: HTMLElement | null;
  statusEl?: HTMLElement | null;
  label?: HTMLElement | null;
}

type TranscriptEntry = UnknownRecord;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface TimelineReplayState {
  conversationSettings?: UnknownRecord;
  runtimeOptions?: UnknownRecord;
  planOverlayEl?: HTMLElement | null;
  topSpacerEl?: HTMLElement | null;
  bottomSpacerEl?: HTMLElement | null;
  transcriptTotal?: number;
  transcriptStart?: number;
  transcriptEnd?: number;
  transcriptAtStart?: boolean;
  transcriptAtTail?: boolean;
  transcriptLoading?: boolean;
  transcriptGeneration?: number;
  debugEnabled?: boolean;
}

interface TimelineReplayContext {
  getState(): TimelineReplayState;
  setState(patch: Record<string, unknown>): void;
  timelineEl: HTMLElement | null;
  counterMessagesEl: HTMLElement | null;
  counterTokensEl: HTMLElement | null;
  contextRemainingEl: HTMLElement | null;
  assistantRows: Map<string, unknown>;
  reasoningRows: Map<string, unknown>;
  diffRows: Map<string, unknown>;
  toolRows: Map<string, unknown>;
  shellRows: Map<string, unknown>;
  agentBlockRows: Map<string, AgentPtyReplayRecord>;
  documentRef: Document;
  clearPlaceholder(): void;
  setPlaceholderCleared(value: boolean): void;
  ensureActivityRow(): void;
  setCounter(el: HTMLElement | null, value: number): void;
  setActivity(label: string, active: boolean): void;
  showWaitingForEvents(): void;
  clearWaitingForEvents(): void;
  clearReasoningRibbon(): void;
  setStatusDot(status: string | null): void;
  maybeAutoScroll(force?: boolean): void;
  resetPlanState(): void;
  syncPlanOverlayUi(): void;
  timelineStickyUpdate(): void;
  currentExtensionId(): string;
  buildRow(kind: string, title: string): { row: HTMLElement; body: HTMLElement };
  appendErrorContent(body: HTMLElement, entry: TranscriptEntry): void;
  renderCommandResult(entry: TranscriptEntry, parentEl: HTMLElement, options?: UnknownRecord): void;
  renderViewCard(entry: TranscriptEntry, parentEl: HTMLElement): void;
  renderSearchCard(entry: TranscriptEntry, parentEl: HTMLElement): void;
  renderApproval(entry: TranscriptEntry, options?: UnknownRecord): void;
  buildReplayToolRow(entry: TranscriptEntry): HTMLElement;
  renderShellCmdRibbon(el: HTMLElement, cmd: string, options?: { promptPrefix?: string }): void;
  highlightCodeAlways(text: string, lang: string): string;
  highlightShellOutput(text: string, explicitLanguage: string | null): string | null;
  detectLangFromCommand(command: string): string;
  escapeHtml(text: string): string;
  toRelativePath(path: string): string;
  postTe2OpenRequest(target: { path?: unknown; line?: unknown; column?: unknown }): unknown;
  makeCollapsible(row: HTMLElement, cardId: string, startExpanded: boolean, options?: UnknownRecord): void;
  addMessage(role: string, text: string, parentEl?: HTMLElement | null, metadata?: UnknownRecord | null): void;
  finalizeReasoning(id: string | null | undefined, text: string, parentEl?: HTMLElement | null, metadata?: UnknownRecord | null): void;
  addDiff(id: string, text: string, path: string, parentEl?: HTMLElement | null, metadata?: UnknownRecord | null): void;
  renderPlanCard(steps: UnknownRecord[], parentEl?: HTMLElement | null, metadata?: UnknownRecord | null): void;
  updateTokens(total: number): void;
  updateContextRemaining(total: number, windowSize: number): void;
  applyRuntimeMode(kind: string): void;
  updateSpacerHeights(): void;
  resetVirtualizer(preserveMeasurements?: boolean): void;
  syncVirtualizer(): void;
}

export function bindTimelineReplay(ctx: TimelineReplayContext) {
  const {
    getState,
    setState,
    timelineEl,
    counterMessagesEl,
    counterTokensEl,
    contextRemainingEl,
    assistantRows,
    reasoningRows,
    diffRows,
    toolRows,
    shellRows,
    agentBlockRows,
    documentRef,
    clearPlaceholder,
    setPlaceholderCleared,
    ensureActivityRow,
    setCounter,
    setActivity,
    showWaitingForEvents,
    clearWaitingForEvents,
    clearReasoningRibbon,
    setStatusDot,
    maybeAutoScroll,
    resetPlanState,
    syncPlanOverlayUi,
    timelineStickyUpdate,
    currentExtensionId,
    buildRow,
    appendErrorContent,
    renderCommandResult,
    renderViewCard,
    renderSearchCard,
    renderApproval,
    buildReplayToolRow,
    renderShellCmdRibbon,
    highlightCodeAlways,
    highlightShellOutput,
    detectLangFromCommand,
    escapeHtml,
    toRelativePath,
    postTe2OpenRequest,
    makeCollapsible,
    addMessage,
    finalizeReasoning,
    addDiff,
    renderPlanCard,
    updateTokens,
    updateContextRemaining,
    applyRuntimeMode,
    updateSpacerHeights,
    resetVirtualizer,
    syncVirtualizer,
  } = ctx;
  let projectionExpandedCardIds: Set<string> | null = null;

  function resetTimeline() {
    initializeReplayWindow({ bumpGeneration: true, showPlaceholder: true });
  }

  function clearReplayRowState(): void {
    assistantRows.clear();
    reasoningRows.clear();
    diffRows.clear();
    toolRows.clear();
    shellRows.clear();
    agentBlockRows.clear();
  }

  function initializeReplayWindow(options: { bumpGeneration: boolean; showPlaceholder: boolean }) {
    if (!timelineEl) return;
    projectionExpandedCardIds = null;
    resetVirtualizer();
    timelineEl.innerHTML = '';
    clearReplayRowState();
    resetPlanState();
    const topSpacerEl = documentRef.createElement('div');
    topSpacerEl.className = 'timeline-spacer';
    const currentGeneration = Number(getState().transcriptGeneration) || 0;
    const nextState: Record<string, unknown> = {
      topSpacerEl,
      bottomSpacerEl: null,
      messageCount: 0,
      tokenCount: 0,
      lastEventType: null,
      contextWindow: null,
      transcriptHistoryMode: false,
    };
    if (options.bumpGeneration) {
      nextState.transcriptTotal = 0;
      nextState.transcriptStart = 0;
      nextState.transcriptEnd = 0;
      nextState.transcriptAtStart = true;
      nextState.transcriptAtTail = true;
      nextState.transcriptLoading = false;
      nextState.transcriptGeneration = currentGeneration + 1;
    }
    setPlaceholderCleared(!options.showPlaceholder);
    setState(nextState);
    setCounter(counterMessagesEl, 0);
    setCounter(counterTokensEl, 0);
    if (contextRemainingEl) contextRemainingEl.textContent = '—';
    if (options.showPlaceholder) {
      showWaitingForEvents();
    } else {
      setActivity('idle', false);
      setStatusDot(null);
      clearReasoningRibbon();
    }
    timelineEl.appendChild(topSpacerEl);
    ensureActivityRow();
    if (options.showPlaceholder || options.bumpGeneration) {
      maybeAutoScroll(true);
    }
    timelineStickyUpdate();
  }

  function prepareTranscriptWindow() {
    initializeReplayWindow({ bumpGeneration: false, showPlaceholder: false });
  }

  function prepareTranscriptProjection() {
    if (!timelineEl) return;
    const state = getState();
    projectionExpandedCardIds = new Set(
      Array.from(
        timelineEl.querySelectorAll<HTMLElement>(
          '.collapsible.expanded[data-transcript-card-id]',
        ),
      ).map((row) => row.dataset.transcriptCardId || '').filter(Boolean),
    );
    resetVirtualizer(true);
    clearReplayRowState();
    for (const child of Array.from(timelineEl.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child === state.topSpacerEl || child === state.planOverlayEl) continue;
      if (child.classList.contains('activity')) continue;
      child.remove();
    }
    setState({
      messageCount: 0,
      lastEventType: null,
    });
    setCounter(counterMessagesEl, 0);
    setPlaceholderCleared(true);
    clearWaitingForEvents();
  }

  function isInternalTranscriptItem(entry: TranscriptEntry) {
    if (entry.internal === true) return true;
    if (typeof entry.internal === 'string' && ['1', 'true', 'yes', 'on'].includes(entry.internal.trim().toLowerCase())) {
      return true;
    }
    return typeof entry.visibility === 'string' && entry.visibility.trim().toLowerCase() === 'internal';
  }

  function applyTranscriptRuntimeState(items: TranscriptEntry[]): void {
    for (const entry of items) {
      if (entry.role === 'token_usage') {
        const total = asNumber(entry.total, Number.NaN);
        if (Number.isFinite(total)) {
          setState({ tokenCount: total });
          updateTokens(total);
        }
        const contextWindow = asNumber(entry.context_window, Number.NaN);
        if (Number.isFinite(contextWindow)) {
          setState({ contextWindow });
          updateContextRemaining(total, contextWindow);
        }
      } else if (entry.role === 'mode' && typeof entry.kind === 'string') {
        applyRuntimeMode(entry.kind);
      } else if (entry.role === 'status') {
        const status = asString(entry.status);
        if (status) setStatusDot(status);
      }
    }
  }

  function renderTranscriptEntries(items: TranscriptEntry[], opts: UnknownRecord = {}) {
    if (!items || !items.length || !timelineEl) return;
    const state = getState();
    const fragment = documentRef.createDocumentFragment();
    const pendingAgentPtyTerms: AgentPtyReplayRecord[] = [];
    const agentPtyByBlock = new Map<string, AgentPtyReplayRecord>();
    const replaySubagents = new Map<string, ReplaySubagentRecord>();

    items.forEach((entry) => {
      if (isInternalTranscriptItem(entry)) return;
      if (!entry || !entry.role) return;

      if (entry.role === 'subagent_start') {
        const existing = timelineEl.querySelector(`.subagent-card[data-subagent-id="${entry.id}"]`);
        if (existing instanceof HTMLElement) {
          const labelEl = existing.querySelector('.subagent-header span:first-child');
          if (labelEl instanceof HTMLElement) {
            labelEl.textContent = `${entry.name || 'subagent'}: ${entry.intent || 'working'}`;
          }
          return;
        }
        const row = documentRef.createElement('div');
        row.className = 'timeline-row subagent-card';
        const subagentId = asString(entry.id);
        row.dataset.subagentId = subagentId;
        const header = documentRef.createElement('div');
        header.className = 'subagent-header command-ribbon';
        const label = documentRef.createElement('span');
        label.textContent = `${asString(entry.name, 'subagent')}: ${asString(entry.intent, 'working')}`;
        const statusEl = documentRef.createElement('span');
        statusEl.className = 'subagent-status';
        statusEl.textContent = '⏳ running';
        header.append(label, statusEl);
        row.appendChild(header);
        const body = documentRef.createElement('div');
        body.className = 'subagent-body';
        row.appendChild(body);
        makeCollapsible(row, `subagent:${subagentId}`, false, {
          headerEl: header,
          fullHeaderToggle: true,
        });
        applyTranscriptCardMetadata(row, entry);
        replaySubagents.set(subagentId, { row, body, statusEl, label });
        fragment.appendChild(row);
        return;
      }

      if (entry.role === 'subagent_end') {
        const subagentId = asString(entry.id);
        let subagent = replaySubagents.get(subagentId);
        if (!subagent) {
          const existing = timelineEl.querySelector(`.subagent-card[data-subagent-id="${subagentId}"]`);
          if (existing instanceof HTMLElement) {
            subagent = {
              row: existing,
              statusEl: existing.querySelector('.subagent-status') as HTMLElement | null,
              body: existing.querySelector('.subagent-body') as HTMLElement | null,
            };
          }
        }
        if (subagent) {
          if (subagent.statusEl instanceof HTMLElement) {
            subagent.statusEl.textContent = entry.success !== false ? '✓ done' : '✗ failed';
          }
          const summary = asString(entry.summary);
          if (summary) {
            const summaryEl = documentRef.createElement('div');
            summaryEl.className = 'subagent-summary';
            summaryEl.style.cssText = 'padding: 4px 14px; font-size: 0.85em; opacity: 0.7; font-style: italic;';
            summaryEl.textContent = summary;
            if (subagent.body instanceof HTMLElement) subagent.body.appendChild(summaryEl);
          }
        }
        return;
      }

      if (entry.projection_card_op !== 'update' && findTranscriptCardRow(timelineEl, entry)) {
        return;
      }

      function getTarget(): HTMLElement {
        const subagentId = asString(entry.subagent_id);
        if (subagentId) {
          if (state.debugEnabled) console.log('[SUBAGENT-REPLAY] entry has subagent_id:', subagentId, 'role:', entry.role, 'map has:', replaySubagents.has(subagentId));
          let subagent = replaySubagents.get(subagentId);
          if (!subagent) {
            if (state.debugEnabled) console.log('[SUBAGENT-REPLAY] Creating synthetic container for:', subagentId);
            const row = documentRef.createElement('div');
            row.className = 'timeline-row subagent-card';
            row.dataset.subagentId = subagentId;
            const header = documentRef.createElement('div');
            header.className = 'subagent-header command-ribbon';
            const label = documentRef.createElement('span');
            label.textContent = 'subagent: (earlier in transcript)';
            const statusEl = documentRef.createElement('span');
            statusEl.className = 'subagent-status';
            statusEl.textContent = '✓ done';
            header.append(label, statusEl);
            row.appendChild(header);
            const body = documentRef.createElement('div');
            body.className = 'subagent-body';
            row.appendChild(body);
            makeCollapsible(row, `subagent:${subagentId}`, false, {
              headerEl: header,
              fullHeaderToggle: true,
            });
            applyTranscriptCardMetadata(row, entry);
            subagent = { row, body, statusEl, label };
            replaySubagents.set(subagentId, subagent);
            fragment.appendChild(row);
          }
          return subagent.body instanceof HTMLElement ? subagent.body : fragment as unknown as HTMLElement;
        }
        return fragment as unknown as HTMLElement;
      }

      if (entry.role === 'reasoning') {
        finalizeReasoning(asString(entry.id, asString(entry.item_id, 'reasoning')), asString(entry.text), getTarget(), entry);
        return;
      }

      if (entry.role === 'diff') {
        const diffText = asString(entry.text);
        let diffPath = asString(entry.path);
        if (!diffPath && diffText) {
          const match = diffText.match(/^diff --git a\/.+ b\/(.+)$/m);
          if (match) diffPath = match[1];
        }
        addDiff(asString(entry.id, asString(entry.item_id, diffPath || 'diff')), diffText, diffPath, getTarget(), entry);
        return;
      }

      if (entry.role === 'view') {
        renderViewCard({
          ...entry,
          id: entry.id || entry.item_id || '',
          title: entry.title || '',
          path: entry.path || '',
          content: entry.content ?? entry.output ?? '',
          lines: Array.isArray(entry.lines) ? entry.lines : null,
          view_range: entry.view_range ?? entry.viewRange ?? null,
        }, getTarget());
        return;
      }

      if (entry.role === 'search') {
        renderSearchCard({
          ...entry,
          id: entry.id || entry.item_id || '',
          title: entry.title || '',
          mode: entry.mode || entry.tool || 'search',
          path: entry.path || '',
          pattern: entry.pattern || '',
          arguments: entry.arguments && typeof entry.arguments === 'object' ? entry.arguments : {},
          content: entry.content ?? entry.result ?? '',
        }, getTarget());
        return;
      }

      if (entry.role === 'command') {
        renderCommandResult(entry, getTarget(), {
          linkPathFromRibbon: Boolean(entry.path),
          updateLiveState: false,
          autoScroll: false,
        });
        return;
      }

      if (entry.role === 'plan') {
        renderPlanCard(Array.isArray(entry.steps) ? entry.steps.filter(isRecord) : [], getTarget(), entry);
        return;
      }

      if (entry.role === 'token_usage') {
        applyTranscriptRuntimeState([entry]);
        return;
      }

      if (entry.role === 'mode') {
        applyTranscriptRuntimeState([entry]);
        return;
      }

      if (entry.role === 'status') {
        applyTranscriptRuntimeState([entry]);
        return;
      }

      if (entry.role === 'context_compacted') {
        const row = documentRef.createElement('div');
        row.className = 'timeline-row system';
        applyTranscriptCardMetadata(row, entry);
        const meta = documentRef.createElement('div');
        meta.className = 'meta';
        meta.textContent = 'context compacted';
        const body = documentRef.createElement('div');
        body.className = 'body';
        const msg = documentRef.createElement('div');
        msg.className = 'system-message';
        msg.textContent = 'Context was compacted to fit within the model\'s context window.';
        body.appendChild(msg);
        row.append(meta, body);
        fragment.appendChild(row);
        return;
      }

      if (entry.role === 'shell') {
        const exitCode = asNumber(entry.exit_code, 0);
        const row = documentRef.createElement('div');
        row.className = 'timeline-row command-result terminal-card shell-card';
        applyTranscriptCardMetadata(row, entry);
        const body = documentRef.createElement('div');
        body.className = 'body';
        const summaryRibbon = documentRef.createElement('div');
        summaryRibbon.className = 'command-ribbon shell-card-summary';
        const summaryTextEl = documentRef.createElement('span');
        summaryTextEl.className = 'shell-card-summary-text';
        const shellCmd = asString(entry.command);
        renderShellSummary(summaryTextEl, shellCmd);
        summaryRibbon.appendChild(summaryTextEl);
        body.appendChild(summaryRibbon);
        const detailEl = documentRef.createElement('div');
        detailEl.className = 'shell-card-detail';
        const cmdRibbon = documentRef.createElement('div');
        cmdRibbon.className = 'command-ribbon shell-card-command';
        renderShellCmdRibbon(cmdRibbon, shellCmd, { promptPrefix: '' });
        if (typeof entry.path === 'string' && entry.path) {
          const path = entry.path;
          const line = asNumber(entry.line, 1);
          cmdRibbon.style.cursor = 'pointer';
          cmdRibbon.title = path;
          cmdRibbon.dataset.hasClickHandler = 'true';
          cmdRibbon.addEventListener('click', (event: MouseEvent) => {
            event.stopPropagation();
            postTe2OpenRequest({ path, line, column: 1 });
          });
        }
        detailEl.appendChild(cmdRibbon);
        const pre = documentRef.createElement('pre');
        pre.className = 'command-output';
        const stdout = asString(entry.stdout);
        const stderr = asString(entry.stderr);
        const highlighted = highlightShellOutput(stdout, detectLangFromCommand(shellCmd));
        if (stdout) {
          if (hasAnsiSgr(stdout)) {
            pre.innerHTML = ansiToHtml(stdout);
          } else if (highlighted !== null) {
            pre.innerHTML = highlighted;
          } else {
            pre.appendChild(documentRef.createTextNode(stdout));
          }
        }
        if (stderr) {
          const stderrEl = documentRef.createElement('span');
          stderrEl.className = 'shell-stderr';
          if (hasAnsiSgr(stderr)) {
            stderrEl.innerHTML = ansiToHtml(stderr);
          } else {
            stderrEl.textContent = stderr;
          }
          pre.appendChild(stderrEl);
        }
        if (!stdout && !stderr) {
          pre.textContent = '(no output)';
        }
        detailEl.appendChild(pre);
        mountShellOutputWindow(pre, entry.shell_output, shellCmd);
        if (exitCode !== 0) {
          const footer = documentRef.createElement('div');
          footer.className = 'command-footer';
          footer.textContent = `exit ${exitCode}`;
          detailEl.appendChild(footer);
        }
        body.appendChild(detailEl);
        row.appendChild(body);
        makeCollapsible(row, `shell:${asString(entry.card_id, asString(entry.id, shellCmd.slice(0, 40)))}`, false, { headerEl: summaryRibbon });
        getTarget().appendChild(row);
        setStatusDot(exitCode === 0 ? 'success' : 'error');
        return;
      }

      if (entry.role === 'agent_pty') {
        const eventType = asString(entry.event, asString(entry.type));
        const block = isRecord(entry.block) ? entry.block : {};
        const blockId = asString(entry.block_id, asString(block.block_id, asString(entry.blockId, 'agent')));
        if (eventType === 'agent_block_begin') {
          const cmd = asString(block.cmd);
          const row = documentRef.createElement('div');
          row.className = 'timeline-row command-result terminal-card';
          row.dataset.agentBlockId = blockId;
          applyTranscriptCardMetadata(row, entry);

          const body = documentRef.createElement('div');
          body.className = 'body';

          const cmdRibbon = documentRef.createElement('div');
          cmdRibbon.className = 'command-ribbon';
          cmdRibbon.textContent = cmd ? `$ ${cmd}` : '';
          body.appendChild(cmdRibbon);

          const termEl = documentRef.createElement('div');
          termEl.className = 'command-output';
          body.appendChild(termEl);

          row.appendChild(body);
          getTarget().appendChild(row);
          const rec: AgentPtyReplayRecord = { row, termEl, cmdRibbon, cmd, buf: '', text: '', screenRows: null, renderMode: 'raw', hasRawStream: false };
          agentPtyByBlock.set(blockId, rec);
          agentBlockRows.set(blockId, rec);
          pendingAgentPtyTerms.push(rec);
          return;
        }
        if (eventType === 'agent_block_delta') {
          const delta = asString(entry.delta);
          if (!delta) return;
          let rec = agentPtyByBlock.get(blockId) || agentBlockRows.get(blockId);
          if (!rec) {
            const row = documentRef.createElement('div');
            row.className = 'timeline-row command-result terminal-card';
            row.dataset.agentBlockId = blockId;
            applyTranscriptCardMetadata(row, entry);
            const body = documentRef.createElement('div');
            body.className = 'body';
            const cmdRibbon = documentRef.createElement('div');
            cmdRibbon.className = 'command-ribbon';
            cmdRibbon.textContent = '';
            body.appendChild(cmdRibbon);
            const termEl = documentRef.createElement('div');
            termEl.className = 'command-output';
            body.appendChild(termEl);
            row.appendChild(body);
            getTarget().appendChild(row);
            rec = { row, termEl, cmdRibbon, cmd: '', buf: '', text: '', screenRows: null, renderMode: 'raw', hasRawStream: false };
            agentPtyByBlock.set(blockId, rec);
            agentBlockRows.set(blockId, rec);
            pendingAgentPtyTerms.push(rec);
          }
          rec.buf += delta;
          return;
        }
        if (eventType === 'agent_block_end') {
          const rec = agentPtyByBlock.get(blockId) || agentBlockRows.get(blockId);
          const command = asString(block.cmd);
          if (rec && !rec.cmd && command) {
            rec.cmd = command;
            if (rec.cmdRibbon) {
              rec.cmdRibbon.textContent = `$ ${rec.cmd}`;
            }
          }
          const exitCode = block.exit_code ?? block.exitCode;
          if (rec && exitCode !== undefined && exitCode !== null && exitCode !== 0) {
            const footer = documentRef.createElement('div');
            footer.className = 'command-footer';
            footer.textContent = `exit ${exitCode}`;
            rec.row.querySelector('.body')?.appendChild(footer);
          }
          return;
        }
        return;
      }

      if (entry.role === 'error') {
        const { row, body } = buildRow('error', 'error');
        applyTranscriptCardMetadata(row, entry);
        appendErrorContent(body, entry);
        getTarget().appendChild(row);
        return;
      }

      if (entry.role === 'mcp_tool' || entry.role === 'tool') {
        const row = buildReplayToolRow(entry);
        getTarget().appendChild(row);
        return;
      }

      if (entry.role === 'web_search') {
        const row = documentRef.createElement('div');
        row.className = 'timeline-row command-result web-search-card';
        applyTranscriptCardMetadata(row, entry);
        const body = documentRef.createElement('div');
        body.className = 'body';
        const header = documentRef.createElement('div');
        header.className = 'command-ribbon';
        header.textContent = '🔍 web_search';
        body.appendChild(header);
        if (entry.query) {
          const queryPre = documentRef.createElement('pre');
          queryPre.textContent = asString(entry.query);
          body.appendChild(queryPre);
        }
        row.appendChild(body);
        makeCollapsible(row, `web:${asString(entry.call_id, asString(entry.id, asString(entry.query, 'search')))}`, false);
        getTarget().appendChild(row);
        return;
      }

      if (entry.role === 'approval') {
        const requestId = entry.request_id || entry.id || entry.item_id;
        const askUserMsgId = entry.ask_user_msg_id ?? entry.askUserMsgId;
        const resolvedCardId = entry.card_id || entry.item_id || entry.id || requestId;
        renderApproval({
          ...entry,
          id: entry.id || resolvedCardId,
          request_id: requestId,
          card_id: resolvedCardId,
          ask_user_msg_id: askUserMsgId,
          request_method: entry.request_method || entry.requestMethod || '',
          request_params: entry.payload && typeof entry.payload === 'object' ? entry.payload : {},
          payload: entry.payload && typeof entry.payload === 'object' ? entry.payload : {},
          replay: true,
        }, {
          parentEl: getTarget(),
          readOnly: true,
          source: 'replay',
          useExisting: false,
          extensionId: currentExtensionId(),
        });
        return;
      }

      addMessage(asString(entry.role), asString(entry.text), getTarget(), entry);
    });

    clearWaitingForEvents();
    clearPlaceholder();
    const nextState = getState();
    const insertBefore = opts.prepend
      ? ((nextState.planOverlayEl && nextState.planOverlayEl.parentElement === timelineEl) ? nextState.planOverlayEl.nextSibling : nextState.topSpacerEl?.nextSibling)
      : nextState.bottomSpacerEl;
    if (insertBefore && insertBefore.parentElement === timelineEl) {
      timelineEl.insertBefore(fragment, insertBefore);
    } else {
      timelineEl.appendChild(fragment);
    }
    syncPlanOverlayUi();

    if (pendingAgentPtyTerms.length) {
      requestAnimationFrame(() => {
        pendingAgentPtyTerms.forEach((rec) => {
          rec.termEl.textContent = rec.buf || '';
        });
      });
    }
    updateSpacerHeights();
    syncVirtualizer();
  }

  function renderTranscriptCards(cards: TranscriptCardRecipe[], opts: UnknownRecord = {}): void {
    const events = cards.flatMap((card) => card.events);
    renderTranscriptEntries(events, opts);
    if (!timelineEl) return;
    let renderedRows = Array.from(
      timelineEl.querySelectorAll<HTMLElement>('[data-transcript-card-id]'),
    );
    try {
      for (const card of cards) {
        const matches = renderedRows.filter((row) => row.dataset.transcriptCardId === card.card_id);
        if (matches.length !== 1) {
          const error = new Error(
            `Transcript card projection mismatch for ${card.card_id}: rendered ${matches.length} roots`,
          );
          console.error(error, {
            card_id: card.card_id,
            card_index: card.card_index,
            family: card.family,
            event_count: card.events.length,
          });
          for (const row of matches) {
            row.remove();
          }
          const { row, body } = buildRow('error', 'projection error');
          row.dataset.projectionContractError = 'true';
          applyTranscriptCardMetadata(row, {
            projection_card_id: card.card_id,
            projection_card_index: card.card_index,
            projection_card_op: 'create',
            projection_card_scope: 'durable',
            projection_parent_card_id: card.parent_card_id,
          });
          const message = documentRef.createElement('div');
          message.className = 'system-message';
          message.textContent = `Unable to render ${card.family} transcript card ${card.card_index}.`;
          body.appendChild(message);
          const parentRow = card.parent_card_id
            ? renderedRows.find((candidate) => candidate.dataset.transcriptCardId === card.parent_card_id)
            : null;
          const parentBody = parentRow?.querySelector<HTMLElement>('.subagent-body') || null;
          if (parentBody) {
            parentBody.appendChild(row);
          } else {
            const nextRow = renderedRows.find((candidate) => {
              const candidateIndex = Number(candidate.dataset.transcriptCardIndex);
              return candidate.parentElement === timelineEl
                && Number.isSafeInteger(candidateIndex)
                && candidateIndex > card.card_index;
            });
            const state = getState();
            const before = nextRow
              || (state.bottomSpacerEl?.parentElement === timelineEl ? state.bottomSpacerEl : null);
            timelineEl.insertBefore(row, before);
          }
          renderedRows = renderedRows
            .filter((candidate) => !matches.includes(candidate))
            .concat(row);
        }
      }
      for (const cardId of projectionExpandedCardIds || []) {
        const row = renderedRows.find(
          (candidate) => candidate.dataset.transcriptCardId === cardId,
        ) as ToggleableRow | undefined;
        if (row && !row.classList.contains('expanded')) {
          row._toggleCollapse?.(true);
        }
      }
      syncVirtualizer();
    } finally {
      projectionExpandedCardIds = null;
    }
  }

  return {
    prepareTranscriptWindow,
    prepareTranscriptProjection,
    resetTimeline,
    renderTranscriptEntries,
    renderTranscriptCards,
    applyTranscriptRuntimeState,
  };
}
