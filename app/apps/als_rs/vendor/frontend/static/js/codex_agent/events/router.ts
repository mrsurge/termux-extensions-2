import type { JsonObject } from '../rpc/conversations/contract.ts';

interface PendingRpcEntry {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SubagentContainer extends Record<string, unknown> {
  body?: HTMLElement | null;
}

interface ConversationPreview {
  type: 'assistant' | 'tool' | 'subagent';
  text: string;
  source_id?: string;
  raw_text?: string;
}

interface ConversationMetaState extends JsonObject {
  conversation_id?: string | null;
  draft?: string;
  settings?: JsonObject;
  pending_approvals?: JsonObject;
  pending_approvals_revision?: number;
}

interface HostUiState {
  ideMode?: boolean;
}

interface RouterState {
  clientConversationId?: string | null;
  conversationMeta?: ConversationMetaState | null;
  conversationSettings?: JsonObject | null;
  hostUi?: HostUiState | null;
  activeView?: string;
  splashTab?: string;
  conversationList: unknown[];
  conversationListRevision?: number;
  conversationPreviewCache?: Record<string, ConversationPreview | null> | null;
  appConfig?: JsonObject;
  contextWindow?: number | null;
}

interface MentionInsertOptions {
  lineNo?: number | string;
  endLineNo?: number | string;
  col?: number | string;
  endCol?: number | string;
  content?: string;
  operationId?: string;
}

interface RouterEvent extends JsonObject {
  type?: string;
  internal?: boolean | string;
  visibility?: string;
  tool?: string;
  server?: string;
  arguments?: JsonObject;
  command?: string;
  query?: string;
  role?: string;
  text?: string;
  delta?: string;
  id?: string;
  subagent_id?: string;
  path?: string;
  title?: string;
  pattern?: string;
  name?: string;
  intent?: string;
  summary?: string;
  success?: boolean;
  steps?: unknown[];
  total?: unknown;
  context_window?: unknown;
  kind?: string;
  show_close?: boolean | string | number;
  parent_origin?: string | null;
  ide_mode?: boolean | string | number;
  project_root?: string | null;
  lineNo?: number | string;
  endLineNo?: number | string;
  col?: number | string;
  endCol?: number | string;
  content?: string;
  operation_id?: string;
  draft?: string;
    status?: string;
    label?: string;
    active?: boolean | string | number;
    message?: string;
    error?: string;
    persisted_count?: number;
  transcript_count?: number;
  action?: unknown;
  items?: unknown;
  active_conversation_id?: string | null;
  active_conversation?: string | null;
  active_view?: string | null;
  revision?: number;
  result?: unknown;
  output?: string;
  stdout?: string;
  stderr?: string;
  conversation_id?: string;
  card_id?: string;
  order_id?: number;
  nid?: string;
}

interface EventRouterContext {
  getState: () => RouterState;
  setState: (patch: Partial<RouterState>) => void;
  getPending: () => Map<string | number, PendingRpcEntry>;
  debugEnabled?: boolean;
  setLastEventType: (value: string) => void;
  setActivity: (label: string, active: boolean) => void;
  finalizePlanToTranscript: (...args: unknown[]) => void;
  renderErrorCard: (event: RouterEvent) => void;
  setStatusDot: (status: string) => void;
  renderWarningCard: (message: string, action: unknown, metadata?: RouterEvent | null) => void;
  clearWaitingForEvents?: () => void;
  clearReasoningRibbon: () => void;
  setReasoningRibbon: (text: string) => void;
  addMessage: (role: string, text: string, parent?: HTMLElement | null, metadata?: RouterEvent | null) => void;
  getSubagentContainer: (id: string, name: string, intent: string, metadata?: RouterEvent | null) => SubagentContainer;
  appendAssistantDelta: (id: string | null | undefined, delta: string, parent?: HTMLElement | null, metadata?: RouterEvent | null) => void;
  finalizeAssistant: (id: string | null | undefined, text: string, parent?: HTMLElement | null, metadata?: RouterEvent | null) => void;
  appendReasoningDelta: (id: string | null | undefined, delta: string, parent?: HTMLElement | null, metadata?: RouterEvent | null) => void;
  finalizeReasoning: (id: string | null | undefined, text: string, parent?: HTMLElement | null, metadata?: RouterEvent | null) => void;
  addDiff: (id: string, text: string, path: string, parent?: HTMLElement | null, metadata?: RouterEvent | null) => void;
  addDeclinedDiff: (id: string, text: string, path: string) => void;
  renderApproval: (event: RouterEvent) => void;
  renderCommandResult: (event: RouterEvent) => void;
  renderViewCard: (event: RouterEvent) => void;
  renderSearchCard: (event: RouterEvent) => void;
  renderToolBegin: (event: RouterEvent) => void;
  renderToolDelta: (event: RouterEvent) => void;
  renderToolEnd: (event: RouterEvent) => void;
  renderToolInteraction: (event: RouterEvent) => void;
  renderAgentBlockBegin: (event: RouterEvent) => void;
  renderAgentBlockDelta: (event: RouterEvent) => void;
  renderAgentBlockEnd: (event: RouterEvent) => void;
  renderScreenDelta: (event: RouterEvent) => void;
  renderShellBegin: (event: RouterEvent) => void;
  renderShellDelta: (event: RouterEvent) => void;
  renderShellEnd: (event: RouterEvent) => void;
  finalizeSubagent: (id: string, summary: string, success: boolean) => void;
  maybeAutoScroll: () => void;
  handleLivePlanState: (event: RouterEvent) => void;
  handleLiveTodoUpdate: (event: RouterEvent) => void;
  restorePlanOverlay?: (...args: unknown[]) => void;
  renderPlanCard: (steps: Record<string, unknown>[], parent?: HTMLElement | null, metadata?: RouterEvent | null) => void;
  clearPlanOverlay: () => void;
  updateTokens: (total: number) => void;
  updateContextRemaining: (total: number, contextWindow: number) => void;
  renderContextCompactedCard: (event?: RouterEvent | null) => void;
  renderMetaEnvelopeInjected: (event: RouterEvent) => void;
  applyHostUi: () => void;
  renderSplashTabs: () => void;
  renderConversationList: (conversations: unknown[], activeConversationId: string | null) => void;
  renderMiniConversationList: (conversations: unknown[], activeConversationId: string | null) => void;
  insertMention: (path: string, options: MentionInsertOptions) => void;
  applyDraftUpdate: (event: JsonObject) => void;
  applySelectionUpdate: (event: JsonObject) => void;
  applyRuntimeMode: (kind: string) => void;
  handoffApproval?: (event: RouterEvent) => void;
  invalidateApproval?: (event: RouterEvent) => void;
  restorePendingApprovals?: () => void;
}

function asRouterEvent(value: unknown): RouterEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as RouterEvent;
}

export function bindEventRouter(ctx: EventRouterContext) {
  const {
    getState,
    setState,
    getPending,
    debugEnabled,
    setLastEventType,
    setActivity,
    finalizePlanToTranscript,
    renderErrorCard,
    setStatusDot,
    renderWarningCard,
    clearWaitingForEvents,
    clearReasoningRibbon,
    setReasoningRibbon,
    addMessage,
    getSubagentContainer,
    appendAssistantDelta,
    finalizeAssistant,
    appendReasoningDelta,
    finalizeReasoning,
    addDiff,
    addDeclinedDiff,
    renderApproval,
    renderCommandResult,
    renderViewCard,
    renderSearchCard,
    renderToolBegin,
    renderToolDelta,
    renderToolEnd,
    renderToolInteraction,
    renderAgentBlockBegin,
    renderAgentBlockDelta,
    renderAgentBlockEnd,
    renderScreenDelta,
    renderShellBegin,
    renderShellDelta,
    renderShellEnd,
    finalizeSubagent,
    maybeAutoScroll,
    handleLivePlanState,
    handleLiveTodoUpdate,
    restorePlanOverlay,
    renderPlanCard,
    clearPlanOverlay,
    updateTokens,
    updateContextRemaining,
    renderContextCompactedCard,
    renderMetaEnvelopeInjected,
    applyHostUi,
    renderSplashTabs,
    renderConversationList,
    renderMiniConversationList,
    insertMention,
    applyDraftUpdate,
    applySelectionUpdate,
    applyRuntimeMode,
    handoffApproval,
    invalidateApproval,
    restorePendingApprovals,
  } = ctx;

  function normalizePreviewText(text: unknown, maxLen = 160): string {
    if (text == null) return '';
    const normalized = String(text).replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (maxLen > 1 && normalized.length > maxLen) {
      return `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
    }
    return normalized;
  }

  function isInternalEvent(evt: RouterEvent): boolean {
    if (evt.internal === true) return true;
    if (typeof evt.internal === 'string' && ['1', 'true', 'yes', 'on'].includes(evt.internal.trim().toLowerCase())) {
      return true;
    }
    return typeof evt.visibility === 'string' && evt.visibility.trim().toLowerCase() === 'internal';
  }

  function buildToolPreviewText(evt: RouterEvent): string {
    const toolName = typeof evt?.tool === 'string' ? evt.tool.trim() : '';
    const serverName = typeof evt?.server === 'string' ? evt.server.trim() : '';
    const args = evt?.arguments && typeof evt.arguments === 'object' ? evt.arguments : {};
    if (toolName === 'command' || toolName === 'shell') {
      const command = normalizePreviewText(args.command || evt.command || '');
      return command ? `$ ${command}` : '$ command';
    }
    if (toolName === 'web_search') {
      const query = normalizePreviewText(evt.query || args.query || '');
      return query ? `web_search: ${query}` : 'web_search';
    }
    return normalizePreviewText([serverName, toolName].filter(Boolean).join(':') || toolName || serverName || 'tool', 120);
  }

  function buildPreviewFromEvent(
    evt: RouterEvent,
    currentPreview: ConversationPreview | null,
  ): ConversationPreview | null {
    const evtType = typeof evt?.type === 'string' ? evt.type : '';
    switch (evtType) {
      case 'assistant_delta': {
        const sourceId = evt.id || 'assistant';
        const rawDelta = typeof evt.delta === 'string' ? evt.delta : '';
        if (!rawDelta.trim()) return null;
        const currentRaw = currentPreview?.type === 'assistant' && currentPreview?.source_id === sourceId
          ? String(currentPreview.raw_text || '')
          : '';
        const nextRaw = `${currentRaw}${rawDelta}`.slice(0, 400);
        const text = normalizePreviewText(nextRaw);
        return text ? { type: 'assistant', text, source_id: sourceId, raw_text: nextRaw } : null;
      }
      case 'assistant_finalize': {
        const rawText = typeof evt.text === 'string' ? evt.text.slice(0, 400) : '';
        const text = normalizePreviewText(rawText);
        return text ? { type: 'assistant', text, source_id: evt.id || 'assistant', raw_text: rawText } : null;
      }
      case 'message': {
        if ((evt.role || '').toLowerCase() !== 'assistant') return null;
        const rawText = typeof evt.text === 'string' ? evt.text.slice(0, 400) : '';
        const text = normalizePreviewText(rawText);
        return text ? { type: 'assistant', text, source_id: evt.id || 'assistant', raw_text: rawText } : null;
      }
      case 'tool_begin':
      case 'tool_end': {
        const text = buildToolPreviewText(evt);
        return text ? { type: 'tool', text } : null;
      }
      case 'view': {
        const title = normalizePreviewText(evt.title || evt.path || 'view', 140);
        return title ? { type: 'tool', text: title } : null;
      }
      case 'search': {
        const title = normalizePreviewText(evt.path || evt.pattern || evt.title || 'search', 140);
        return title ? { type: 'tool', text: title } : null;
      }
      case 'shell_begin':
      case 'shell_end':
      case 'command_result': {
        const command = normalizePreviewText(evt.command || '', 140);
        if (command) return { type: 'tool', text: `$ ${command}` };
        const output = normalizePreviewText(evt.output || evt.stdout || evt.stderr || '', 140);
        return output ? { type: 'tool', text: output } : null;
      }
      case 'subagent_start': {
        const name = normalizePreviewText(evt.name || 'subagent', 48);
        const intent = normalizePreviewText(evt.intent || 'working', 120);
        return { type: 'subagent', text: `${name}: ${intent}` };
      }
      case 'subagent_end': {
        const summary = normalizePreviewText(evt.summary || '', 160);
        if (summary) return { type: 'subagent', text: summary };
        return { type: 'subagent', text: evt.success === false ? 'subagent failed' : 'subagent done' };
      }
      default:
        return null;
    }
  }

  function updateConversationPreview(evt: RouterEvent): void {
    const convoId = typeof evt?.conversation_id === 'string' ? evt.conversation_id.trim() : '';
    if (!convoId) return;
    const state = getState();
    const cache = state.conversationPreviewCache && typeof state.conversationPreviewCache === 'object'
      ? state.conversationPreviewCache
      : {};
    const currentPreview = cache[convoId] || null;
    const nextPreview = buildPreviewFromEvent(evt, currentPreview);
    if (!nextPreview?.text) return;
    if (
      currentPreview
      && currentPreview.type === nextPreview.type
      && currentPreview.text === nextPreview.text
      && currentPreview.source_id === nextPreview.source_id
    ) {
      return;
    }
    setState({ conversationPreviewCache: { ...cache, [convoId]: nextPreview } });
    const activeConversationId = state.clientConversationId || state.conversationMeta?.conversation_id || null;
    renderConversationList(state.conversationList, activeConversationId);
    renderMiniConversationList(state.conversationList, activeConversationId);
  }

  function patchConversationMeta(conversationId: string, patch: JsonObject): void {
    if (!conversationId) return;
    const state = getState();
    const nextList = Array.isArray(state.conversationList)
      ? state.conversationList.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const meta = item as JsonObject;
        return meta.conversation_id === conversationId ? { ...meta, ...patch } : item;
      })
      : [];
    const currentMeta = state.conversationMeta && typeof state.conversationMeta === 'object'
      ? state.conversationMeta
      : null;
    const clientConversationId = typeof state.clientConversationId === 'string' && state.clientConversationId.trim()
      ? state.clientConversationId.trim()
      : null;
    const currentMetaId = typeof currentMeta?.conversation_id === 'string' && currentMeta.conversation_id.trim()
      ? currentMeta.conversation_id.trim()
      : null;
    const activeConversationId = clientConversationId || currentMetaId || null;
    const nextState: Partial<RouterState> = { conversationList: nextList };
    const fullMetaPatch = patch.conversation_id === conversationId
      || (patch.settings && typeof patch.settings === 'object' && !Array.isArray(patch.settings));
    if (currentMetaId === conversationId || (clientConversationId === conversationId && fullMetaPatch)) {
      const currentApprovalRevision = Number(currentMeta?.pending_approvals_revision);
      const patchApprovalRevision = Number(patch.pending_approvals_revision);
      const preserveCurrentApprovals = Number.isSafeInteger(currentApprovalRevision)
        && currentApprovalRevision >= 0
        && (!Number.isSafeInteger(patchApprovalRevision) || patchApprovalRevision < currentApprovalRevision);
      const nextMeta = {
        ...(currentMeta || {}),
        ...patch,
        ...(preserveCurrentApprovals ? {
          pending_approvals: currentMeta?.pending_approvals,
          pending_approvals_revision: currentApprovalRevision,
        } : {}),
      };
      nextState.conversationMeta = nextMeta;
      if (nextMeta.settings && typeof nextMeta.settings === 'object' && !Array.isArray(nextMeta.settings)) {
        nextState.conversationSettings = { ...(nextMeta.settings as JsonObject) };
      }
    }
    setState(nextState);
    renderConversationList(nextList, activeConversationId);
    renderMiniConversationList(nextList, activeConversationId);
  }

  function updateConversationMetaFromEvent(evt: RouterEvent): void {
    const conversationId = typeof evt?.conversation_id === 'string' ? evt.conversation_id.trim() : '';
    if (!conversationId) return;
    if (evt.type === 'meta_updated') {
      patchConversationMeta(conversationId, evt);
      return;
    }
    if (evt.type === 'status' && typeof evt.status === 'string' && evt.status.trim()) {
      patchConversationMeta(conversationId, { status: evt.status.trim() });
    }
  }

  function updateConversationListFromEvent(evt: RouterEvent): boolean {
    if (evt.type !== 'list_updated') {
      return false;
    }
    const revision = typeof evt.revision === 'number' && Number.isFinite(evt.revision)
      ? evt.revision
      : 0;
    const state = getState();
    const currentRevision = typeof state.conversationListRevision === 'number'
      && Number.isFinite(state.conversationListRevision)
      ? state.conversationListRevision
      : 0;
    if (revision > 0 && currentRevision > 0 && revision <= currentRevision) {
      return true;
    }
    const nextList = Array.isArray(evt.items)
      ? evt.items.filter((item): item is JsonObject => (
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      ))
      : [];
    const activeConversationId = typeof evt.active_conversation_id === 'string'
      ? evt.active_conversation_id
      : (typeof evt.active_conversation === 'string' ? evt.active_conversation : null);
    setState({
      conversationList: nextList,
      conversationListRevision: Math.max(revision, currentRevision),
    });
    renderConversationList(nextList, activeConversationId);
    renderMiniConversationList(nextList, activeConversationId);
    return true;
  }

  function handleEvent(evt: unknown): void {
    const event = asRouterEvent(evt);
    if (!event) return;
    if (isInternalEvent(event)) return;
    if (updateConversationListFromEvent(event)) return;
    updateConversationPreview(event);
    updateConversationMetaFromEvent(event);
    const state = getState();

    // Filter events by conversation_id - only render events for active conversation
    const activeConvoId = state.clientConversationId || state.conversationMeta?.conversation_id || null;
    if (event.conversation_id && activeConvoId && event.conversation_id !== activeConvoId) {
      return;
    }
    if (event.type === 'meta_updated') {
      restorePendingApprovals?.();
    }
    clearWaitingForEvents?.();

    switch (event.type) {
      case 'activity':
        setLastEventType('activity');
        setActivity(event.label || 'idle', Boolean(event.active));
        return;
      case 'error':
        setLastEventType('error');
        renderErrorCard(event);
        setStatusDot('error');
        return;
      case 'warning':
        setLastEventType('warning');
        renderWarningCard(event.message || '', event.action || null, event);
        setStatusDot('warning');
        return;
      case 'import_started':
        setLastEventType('import');
        setActivity(event.message || 'Porting in transcript. This can take a while for large transcripts.', true);
        setStatusDot('working');
        window.dispatchEvent(new CustomEvent('codexagent:conversation-import-started', { detail: event }));
        return;
      case 'import_progress': {
        setLastEventType('import');
        const done = typeof event.persisted_count === 'number' ? event.persisted_count : null;
        const total = typeof event.transcript_count === 'number' ? event.transcript_count : null;
        const label = done !== null && total !== null
          ? `Porting transcript ${done}/${total}`
          : 'Porting transcript';
        setActivity(label, true);
        window.dispatchEvent(new CustomEvent('codexagent:conversation-import-progress', { detail: event }));
        return;
      }
      case 'import_completed':
        setLastEventType('import');
        setActivity('Transcript import complete', false);
        setStatusDot('success');
        window.dispatchEvent(new CustomEvent('codexagent:conversation-import-completed', { detail: event }));
        return;
      case 'import_failed':
        setLastEventType('import');
        setActivity('Transcript import failed', false);
        renderErrorCard({ ...event, type: 'error', message: event.error || event.message || 'Transcript import failed' });
        setStatusDot('error');
        window.dispatchEvent(new CustomEvent('codexagent:conversation-import-failed', { detail: event }));
        return;
      case 'extensions_updated':
        window.dispatchEvent(new CustomEvent('codexagent:extensions-updated'));
        return;
      case 'status':
        if (event.status) {
          setStatusDot(event.status);
        }
        clearReasoningRibbon();
        return;
      case 'thought':
        if (event.text) {
          setActivity(event.text, true);
          setReasoningRibbon(event.text);
        }
        return;
      case 'message':
        setLastEventType('message');
        if (event.subagent_id) {
          const sa = getSubagentContainer(event.subagent_id, '', '');
          addMessage(event.role || 'message', event.text || '', sa.body, event);
        } else {
          addMessage(event.role || 'message', event.text || '', undefined, event);
        }
        return;
      case 'assistant_delta':
        setLastEventType('assistant');
        if (debugEnabled) console.log('[LIVE-MSG-DEBUG] assistant_delta:', event.id, 'subagent_id:', event.subagent_id, 'delta:', (event.delta || '').slice(0, 50));
        if (event.subagent_id) {
          const sa = getSubagentContainer(event.subagent_id, '', '');
          appendAssistantDelta(event.id, event.delta || '', sa.body, event);
        } else {
          appendAssistantDelta(event.id, event.delta || '', undefined, event);
        }
        return;
      case 'assistant_finalize':
        setLastEventType('assistant');
        if (event.subagent_id) {
          const sa = getSubagentContainer(event.subagent_id, '', '');
          finalizeAssistant(event.id, event.text || '', sa.body, event);
        } else {
          finalizeAssistant(event.id, event.text || '', undefined, event);
        }
        setStatusDot('success');
        return;
      case 'reasoning_delta':
        setLastEventType('reasoning');
        if (event.subagent_id) {
          const sa = getSubagentContainer(event.subagent_id, '', '');
          appendReasoningDelta(event.id, event.delta || '', sa.body, event);
        } else {
          appendReasoningDelta(event.id, event.delta || '', undefined, event);
        }
        return;
      case 'reasoning_finalize':
        setLastEventType('reasoning');
        if (event.subagent_id) {
          const sa = getSubagentContainer(event.subagent_id, '', '');
          finalizeReasoning(event.id, event.text || '', sa.body, event);
        } else {
          finalizeReasoning(event.id, event.text || '', undefined, event);
        }
        return;
      case 'diff': {
        setLastEventType('diff');
        let dp = event.path || '';
        if (!dp && event.text) {
          const m = event.text.match(/^diff --git a\/.+ b\/(.+)$/m);
          if (m) dp = m[1];
        }
        if (event.subagent_id) {
          const sa = getSubagentContainer(event.subagent_id, '', '');
          addDiff(event.id || '', event.text || '', dp, sa.body, event);
        } else {
          addDiff(event.id || '', event.text || '', dp, undefined, event);
        }
        return;
      }
      case 'diff_declined':
        setLastEventType('diff');
        addDeclinedDiff(event.id || '', event.text || '', event.path || '');
        return;
      case 'approval':
        setLastEventType('approval');
        renderApproval(event);
        return;
      case 'approval_handoff':
        setLastEventType('approval');
        handoffApproval?.(event);
        return;
      case 'approval_invalidated':
        setLastEventType('approval');
        invalidateApproval?.(event);
        return;
      case 'command_result':
        renderCommandResult(event);
        return;
      case 'view':
        renderViewCard(event);
        return;
      case 'search':
        renderSearchCard(event);
        return;
      case 'tool_begin':
        renderToolBegin(event);
        return;
      case 'tool_delta':
        renderToolDelta(event);
        return;
      case 'tool_end':
        renderToolEnd(event);
        return;
      case 'tool_interaction':
        renderToolInteraction(event);
        return;
      case 'agent_block_begin':
        renderAgentBlockBegin(event);
        return;
      case 'agent_block_delta':
        renderAgentBlockDelta(event);
        return;
      case 'agent_block_end':
        renderAgentBlockEnd(event);
        return;
      case 'screen_delta':
        renderScreenDelta(event);
        return;
      case 'shell_begin':
        renderShellBegin(event);
        return;
      case 'shell_delta':
        renderShellDelta(event);
        return;
      case 'shell_end':
        renderShellEnd(event);
        return;
      case 'subagent_start':
        setLastEventType('subagent');
        getSubagentContainer(event.id || '', event.name || 'subagent', event.intent || 'working', event);
        setActivity(`subagent: ${event.intent || event.name || 'working'}`, true);
        maybeAutoScroll();
        return;
      case 'subagent_end':
        setLastEventType('subagent');
        finalizeSubagent(event.id || '', event.summary || '', Boolean(event.success));
        maybeAutoScroll();
        return;
      case 'plan_update':
        setLastEventType('plan');
        handleLiveTodoUpdate(event);
        return;
      case 'plan_state':
        setLastEventType('plan');
        handleLivePlanState(event);
        return;
      case 'plan':
        setLastEventType('plan');
        renderPlanCard(
          Array.isArray(event.steps)
            ? event.steps.filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === 'object')
            : [],
          undefined,
          event,
        );
        clearPlanOverlay();
        return;
      case 'token_count':
        setLastEventType('token');
        if (Number.isFinite(event.context_window)) {
          setState({ contextWindow: Number(event.context_window) });
        }
        if (typeof event.total === 'number' && Number.isFinite(event.total)) {
          updateTokens(event.total);
          if (Number.isFinite(event.context_window)) {
            updateContextRemaining(event.total, Number(event.context_window));
          }
        }
        return;
      case 'mode':
        if (typeof event.kind === 'string') {
          applyRuntimeMode(event.kind);
        }
        return;
      case 'context_compacted':
        setLastEventType('system');
        renderContextCompactedCard(event);
        return;
      case 'meta_envelope_injected':
        setLastEventType('system');
        renderMetaEnvelopeInjected(event);
        return;
      case 'host_ui': {
        const hostUi = {
          showClose: Boolean(event.show_close),
          parentOrigin: (typeof event.parent_origin === 'string' && event.parent_origin) ? event.parent_origin : null,
          ideMode: Boolean(event.ide_mode),
          projectRoot: (typeof event.project_root === 'string' && event.project_root) ? event.project_root : null,
        };
        setState({ hostUi });
        applyHostUi();
        const s = getState();
        if (s.activeView === 'splash' && s.hostUi?.ideMode && s.splashTab === 'project') {
          renderSplashTabs();
          renderConversationList(s.conversationList, s.clientConversationId || s.conversationMeta?.conversation_id || null);
        }
        return;
      }
      case 'mention_insert': {
        const s = getState();
        const activeConversationId = s.clientConversationId || s.conversationMeta?.conversation_id || null;
        if (!activeConversationId) return;
        if (event.conversation_id && event.conversation_id !== activeConversationId) return;
        insertMention(event.path || '', {
          lineNo: event.lineNo,
          endLineNo: event.endLineNo,
          col: event.col,
          endCol: event.endCol,
          content: event.content,
          operationId: event.operation_id,
        });
        return;
      }
      case 'draft_update': {
        applyDraftUpdate(event);
        return;
      }
      case 'draft_selection_update': {
        applySelectionUpdate(event);
        return;
      }
      case 'rpc_response': {
        const pending = getPending();
        const entry = pending.get(event.id ?? '');
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(event.id ?? '');
          entry.resolve(event.result);
        }
        return;
      }
      case 'rpc_error': {
        const pending = getPending();
        const entry = pending.get(event.id ?? '');
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(event.id ?? '');
          if (String(event.message || '').includes('Already initialized')) {
            entry.resolve(null);
          } else {
            entry.reject(new Error(event.message || 'rpc error'));
          }
        }
        return;
      }
      default:
        return;
    }
  }

  return { handleEvent };
}
