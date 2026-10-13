import { applyTranscriptCardMetadata } from '../transcript_card_metadata.ts';
import { createConversationsRpcClient } from '../rpc/conversations/client.ts';
import { createPathScrollLabel } from '../path_label.ts';

type ApprovalDecisionObject = {
  acceptWithExecpolicyAmendment?: boolean;
  applyNetworkPolicyAmendment?: boolean;
  [key: string]: unknown;
};

type ApprovalDecision = string | ApprovalDecisionObject;

interface ApprovalChange {
  diff?: string;
  path?: string;
  unified_diff?: string;
  patch?: string;
  file_path?: string;
}

type ApprovalChangeMap = Record<string, ApprovalChange>;

interface ApprovalPayload {
  kind?: string;
  command?: string | string[];
  cwd?: string;
  reason?: string;
  question?: string;
  message?: string;
  warning?: string;
  diff?: string;
  path?: string;
  changes?: ApprovalChange[] | ApprovalChangeMap;
}

interface ApprovalResult {
  decision?: ApprovalDecision;
  action?: string;
  success?: boolean;
  [key: string]: unknown;
}

interface ApprovalData {
  type?: string;
  id?: unknown;
  request_id?: unknown;
  requestor_id?: unknown;
  card_id?: unknown;
  cardId?: unknown;
  item_id?: unknown;
  turn_id?: string;
  subagent_id?: string;
  kind?: string;
  payload?: ApprovalPayload;
  result?: ApprovalResult;
  status?: string;
  decision?: string;
  request_method?: string | null;
  requestMethod?: string | null;
  request_params?: ApprovalPayload;
  render_event?: ApprovalData;
  created_at?: string;
  conversation_id?: string | null;
  replay?: boolean;
  ask_user_msg_id?: unknown;
  askUserMsgId?: unknown;
  timeoutMs?: number | null;
  row?: HTMLElement;
  extensionId?: string;
  diff?: string;
  path?: string;
  file_path?: string;
  unified_diff?: string;
  patch?: string;
  changes?: ApprovalPayload['changes'];
  pending_approvals?: Record<string, ApprovalData>;
  pending_approvals_revision?: number;
  handoff_event?: ApprovalData;
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

interface ApprovalRowOptions {
  source?: string;
  readOnly?: boolean;
  parentEl?: HTMLElement | null;
  row?: HTMLElement | null;
  useExisting?: boolean;
  extensionId?: string;
}

interface ApprovalRequestOptions {
  timeoutMs?: number | null;
}

interface ApprovalSubmitMeta {
  requestMethod?: string | null;
  payload?: ApprovalPayload | null;
  extensionId?: string;
  row?: HTMLElement;
  timeoutMs?: number | null;
  diff?: string | null;
  path?: string | null;
}

interface ApprovalResponse {
  ok?: boolean;
  error?: string;
  handoff_event?: ApprovalData;
  [key: string]: unknown;
}

const AGENT_PTY_ASK_USER_REQUEST_METHOD = 'agent-pty/ask-user';

interface RequestCardRuntime {
  render: (
    evt: ApprovalData,
    context: {
      extensionId: string;
      row: HTMLElement;
      body: HTMLElement;
      helpers: ApprovalRenderHelpers;
    },
  ) => Promise<boolean>;
}

interface ApprovalRenderHelpers {
  escapeHtml: (text: string) => string;
  formatDiff: (diff: string, path: string) => string;
  toRelativePath: (path: string) => string;
  normalizeDecisionLabel: (decision: ApprovalDecision | undefined) => string;
  renderMarkdown: (container: HTMLElement, text: unknown, extraClass?: string) => void;
  readOnly: boolean;
  submitResult: (result: ApprovalResult, meta?: ApprovalSubmitMeta) => Promise<{
    ok: boolean;
    response?: ApprovalResponse;
  }>;
  respondApproval: (
    requestId: unknown,
    result: unknown,
    options?: ApprovalRequestOptions,
  ) => Promise<ApprovalResponse>;
  recordApproval: () => Promise<ApprovalResponse>;
}

interface ApprovalUiContext {
  sioCall: (
    event: string,
    payload?: Record<string, unknown>,
    options?: ApprovalRequestOptions,
  ) => Promise<unknown>;
  getConversationId: () => string | null;
  getConversationMeta?: () => ApprovalData | null | undefined;
  setConversationMeta?: (nextMeta: ApprovalData) => void;
  getCurrentExtensionId?: () => string;
  createRow: (
    rowType: string,
    metaLabel: string,
    rowId?: ChildNode | null,
    parentEl?: HTMLElement | null,
  ) => { row: HTMLElement; body: HTMLElement };
  getSubagentContainer: (
    subagentId: string,
    title: string,
    status: string,
  ) => { body?: HTMLElement | null } & Record<string, unknown>;
  escapeHtml: (text: string) => string;
  formatDiff: (diff: string, path: string) => string;
  renderDiffBlock?: (container: HTMLElement, diff: string, path: string) => void;
  renderEventMarkdownInto?: (container: HTMLElement, text: string) => void;
  toRelativePath: (path: string) => string;
  requestCardRuntime?: Partial<RequestCardRuntime> | null;
  timelineEl?: HTMLElement | null;
  onAfterRender?: () => void;
}

function asApprovalData(value: unknown): ApprovalData | null {
  return value && typeof value === 'object' ? value as ApprovalData : null;
}

function asApprovalResponse(value: unknown): ApprovalResponse | null {
  return value && typeof value === 'object' ? value as ApprovalResponse : null;
}

function normalizeDecisionLabel(decision: ApprovalDecision | undefined): string {
  if (typeof decision === 'string') {
    switch (decision) {
      case 'accept':
        return 'Accept';
      case 'acceptForSession':
        return 'Accept for session';
      case 'decline':
        return 'Decline';
      case 'cancel':
        return 'Cancel';
      default:
        return decision;
    }
  }
  if (!decision || typeof decision !== 'object') {
    return 'Submit';
  }
  if (decision.acceptWithExecpolicyAmendment) {
    return 'Accept + exec policy amendment';
  }
  if (decision.applyNetworkPolicyAmendment) {
    return 'Apply network policy amendment';
  }
  return 'Submit';
}

function decisionKey(result: ApprovalResult | null | undefined): string {
  const decision = result?.decision;
  if (typeof decision === 'string') {
    return decision;
  }
  if (!decision || typeof decision !== 'object') {
    return '';
  }
  if (decision.acceptWithExecpolicyAmendment) {
    return 'acceptWithExecpolicyAmendment';
  }
  if (decision.applyNetworkPolicyAmendment) {
    return 'applyNetworkPolicyAmendment';
  }
  return '';
}

function approvalStatusFromResult(result: ApprovalResult | null | undefined): string {
  const key = decisionKey(result);
  if (key === 'decline') return 'declined';
  if (key === 'cancel') return 'cancelled';
  const action = typeof result?.action === 'string' ? result.action.trim().toLowerCase() : '';
  if (action === 'decline') return 'declined';
  if (action === 'cancel') return 'cancelled';
  if (result && typeof result === 'object' && result.success === false) return 'declined';
  return 'accepted';
}

export function bindApprovalUi(ctx: ApprovalUiContext) {
  const {
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
  } = ctx;
  const conversationsRpcClient = createConversationsRpcClient({ sioCall });

  function approvalRowSource(options: ApprovalRowOptions = {}, evt: ApprovalData = {}) {
    if (typeof options.source === 'string' && options.source.trim()) return options.source.trim();
    if (options.readOnly) {
      if (evt.type === 'approval_handoff') return 'resolved';
      if (evt.replay === true) return 'replay';
      return 'resolved';
    }
    return 'live';
  }

  function approvalTurnId(evt: ApprovalData = {}) {
    return typeof evt?.turn_id === 'string' ? evt.turn_id.trim() : '';
  }

  function approvalRequestId(evt: ApprovalData = {}) {
    const requestId = evt?.request_id ?? evt?.id;
    if (requestId === null || requestId === undefined || requestId === '') return '';
    return String(requestId);
  }

  function approvalRequestorId(evt: ApprovalData = {}) {
    const requestorId = evt?.requestor_id;
    if (requestorId === null || requestorId === undefined || requestorId === '') return '';
    return String(requestorId);
  }

  function approvalRequestMethod(evt: ApprovalData = {}) {
    const requestMethod = evt?.request_method ?? evt?.requestMethod;
    if (requestMethod === null || requestMethod === undefined || requestMethod === '') return '';
    return String(requestMethod).trim();
  }

  function approvalCardId(evt: ApprovalData = {}) {
    const cardId = evt?.card_id ?? evt?.cardId ?? evt?.item_id ?? evt?.id ?? evt?.request_id;
    if (cardId === null || cardId === undefined || cardId === '') return '';
    return String(cardId);
  }

  function pendingApprovalsRevision(value: ApprovalData | null | undefined): number {
    const revision = Number(value?.pending_approvals_revision);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  }

  function upsertLivePendingApproval(evt: ApprovalData, options: ApprovalRowOptions): boolean {
    if (approvalRowSource(options, evt) !== 'live') return true;
    const requestId = approvalRequestId(evt);
    const conversationMeta = getConversationMeta?.();
    if (!requestId || !conversationMeta || typeof conversationMeta !== 'object') return true;
    const eventConversationId = typeof evt.conversation_id === 'string' ? evt.conversation_id.trim() : '';
    const currentConversationId = typeof conversationMeta.conversation_id === 'string'
      ? conversationMeta.conversation_id.trim()
      : '';
    if (eventConversationId && currentConversationId && eventConversationId !== currentConversationId) return false;

    const currentRevision = pendingApprovalsRevision(conversationMeta);
    const eventRevision = pendingApprovalsRevision(evt);
    if (currentRevision > eventRevision) return false;
    const currentPending = conversationMeta.pending_approvals && typeof conversationMeta.pending_approvals === 'object'
      ? conversationMeta.pending_approvals
      : {};
    const existing = currentPending[requestId] && typeof currentPending[requestId] === 'object'
      ? currentPending[requestId]
      : {};
    setConversationMeta?.({
      ...conversationMeta,
      pending_approvals: {
        ...currentPending,
        [requestId]: {
          ...existing,
          request_id: requestId,
          requestor_id: evt.requestor_id,
          request_method: evt.request_method ?? evt.requestMethod,
          request_params: evt.request_params,
          payload: evt.payload,
          conversation_id: evt.conversation_id || currentConversationId,
          created_at: evt.created_at,
          status: 'pending',
          render_event: { ...evt },
        },
      },
      pending_approvals_revision: Math.max(currentRevision, eventRevision),
    });
    return true;
  }

  function isAskUserApproval(evt: ApprovalData = {}) {
    return approvalRequestMethod(evt) === AGENT_PTY_ASK_USER_REQUEST_METHOD;
  }

  function isPendingAskUserApproval(evt: ApprovalData = {}, options: ApprovalRowOptions = {}) {
    return !options.readOnly && isAskUserApproval(evt);
  }

  function approvalRowKey(evt: ApprovalData = {}) {
    const cardId = approvalCardId(evt);
    if (!cardId) return '';
    const turnId = approvalTurnId(evt);
    return turnId ? `${turnId}::${cardId}` : cardId;
  }

  function findApprovalRow(evt: ApprovalData = {}): HTMLElement | null {
    if (!timelineEl) return null;
    const wantedRequestId = approvalRequestId(evt);
    if (!wantedRequestId) return null;
    const wantedCardId = approvalCardId(evt);
    const wantedTurnId = approvalTurnId(evt);
    const wantedKey = approvalRowKey(evt);
    const rows = Array.from((timelineEl as Element).querySelectorAll('.timeline-row[data-approval-id]')) as HTMLElement[];
    if (wantedKey) {
      const exact = rows.find((row) => row.dataset.approvalKey === wantedKey);
      if (exact) return exact;
    }
    if (wantedCardId) {
      const exactCard = rows.find((row) => row.dataset.approvalCardId === wantedCardId);
      if (exactCard) return exactCard;
    }
    if (isAskUserApproval(evt)) {
      return null;
    }
    if (wantedTurnId) {
      return rows.find((row) => (
        row.dataset.approvalId === wantedRequestId
        && String(row.dataset.turnId || '').trim() === wantedTurnId
      )) || null;
    }
    return rows.find((row) => (
      row.dataset.approvalId === wantedRequestId
      && !String(row.dataset.turnId || '').trim()
    )) || null;
  }

  function removeConflictingPendingAskUserRows(evt: ApprovalData, preserveRow: HTMLElement | null) {
    if (!timelineEl || !isAskUserApproval(evt)) return;
    const requestId = approvalRequestId(evt);
    if (!requestId) return;
    const requestorId = approvalRequestorId(evt) || requestId;
    const cardId = approvalCardId(evt);
    const rows = Array.from((timelineEl as Element).querySelectorAll('.timeline-row[data-approval-id]')) as HTMLElement[];
    rows.forEach((row) => {
      if (row === preserveRow) return;
      if (String(row.dataset.requestMethod || '').trim() !== AGENT_PTY_ASK_USER_REQUEST_METHOD) return;
      if (row.dataset.approvalSource === 'resolved' || row.dataset.approvalSource === 'replay') return;
      const rowRequestorId = row.dataset.approvalRequestorId || row.dataset.approvalId;
      if (rowRequestorId !== requestorId) return;
      if (cardId && row.dataset.approvalCardId === cardId) return;
      row.remove();
    });
  }

  function ensureApprovalRow(evt: ApprovalData, options: ApprovalRowOptions = {}) {
    const requestId = approvalRequestId(evt);
    const cardId = approvalCardId(evt);
    const parentEl = options.parentEl || (evt?.subagent_id
      ? getSubagentContainer(evt.subagent_id, '', '').body ?? null
      : null);
    const existingRow = options.row instanceof HTMLElement
      ? options.row
      : (options.useExisting === false ? null : findApprovalRow(evt));
    let row: HTMLElement;
    let body: HTMLElement;
    if (existingRow) {
      row = existingRow;
      const meta = (row.querySelector(':scope > .meta') as HTMLElement | null) || document.createElement('div');
      body = (row.querySelector(':scope > .body') as HTMLElement | null) || document.createElement('div');
      if (!meta.parentElement || !body.parentElement) {
        meta.className = 'meta';
        body.className = 'body';
        row.replaceChildren(meta, body);
      }
      meta.textContent = 'approval';
      body.textContent = '';
      const targetParent = parentEl || row.parentElement;
      if (targetParent instanceof HTMLElement) {
        if (row.parentElement !== targetParent || isPendingAskUserApproval(evt, options)) {
          targetParent.appendChild(row);
        }
      }
    } else {
      ({ row, body } = createRow(
        evt.kind === 'diff' ? 'diff' : 'approval',
        'approval',
        undefined,
        parentEl,
      ));
    }
    row.classList.add('timeline-row');
    row.classList.remove('diff', 'approval', 'resolved');
    row.classList.add(evt.kind === 'diff' ? 'diff' : 'approval');
    if (options.readOnly) {
      row.classList.add('resolved');
    }
    row.dataset.approvalId = String(requestId);
    const requestorId = approvalRequestorId(evt);
    if (requestorId) {
      row.dataset.approvalRequestorId = requestorId;
    } else {
      delete row.dataset.approvalRequestorId;
    }
    if (cardId) {
      row.dataset.approvalCardId = cardId;
    } else {
      delete row.dataset.approvalCardId;
    }
    const approvalKey = approvalRowKey(evt);
    if (approvalKey) {
      row.dataset.approvalKey = approvalKey;
    } else {
        delete row.dataset.approvalKey;
    }
    const nextSource = approvalRowSource(options, evt);
    if (!(existingRow && row.dataset.approvalSource === 'live' && nextSource === 'pending')) {
      row.dataset.approvalSource = nextSource;
    }
    if (typeof evt?.request_method === 'string' && evt.request_method.trim()) {
      row.dataset.requestMethod = evt.request_method.trim();
    } else {
      delete row.dataset.requestMethod;
    }
    const rowRevision = Number(row.dataset.approvalRevision);
    const eventRevision = pendingApprovalsRevision(evt);
    if (eventRevision > 0 || !Number.isSafeInteger(rowRevision)) {
      row.dataset.approvalRevision = String(Math.max(
        Number.isSafeInteger(rowRevision) ? rowRevision : 0,
        eventRevision,
      ));
    }
    if (typeof evt?.turn_id === 'string' && evt.turn_id.trim()) {
      row.dataset.turnId = evt.turn_id.trim();
    } else {
      delete row.dataset.turnId;
    }
    if (options.readOnly && evt.replay === true) {
      row.dataset.replay = 'true';
    } else {
      delete row.dataset.replay;
    }
    if (isPendingAskUserApproval(evt, options)) {
      const targetParent = parentEl || row.parentElement;
      if (targetParent instanceof HTMLElement) {
        targetParent.appendChild(row);
      }
      removeConflictingPendingAskUserRows(evt, row);
    }
    return { row, body };
  }

  function prunePendingApproval(requestId: unknown, revision = 0) {
    if (requestId === null || requestId === undefined || requestId === '') return;
    const currentMeta = getConversationMeta?.();
    if (!currentMeta || typeof currentMeta !== 'object') return;
    const pending = currentMeta.pending_approvals;
    const key = String(requestId);
    const currentRevision = pendingApprovalsRevision(currentMeta);
    const nextRevision = Number.isSafeInteger(revision) && revision >= 0
      ? Math.max(currentRevision, revision)
      : currentRevision;
    const nextPending = pending && typeof pending === 'object' ? { ...pending } : {};
    const removed = Object.prototype.hasOwnProperty.call(nextPending, key);
    if (removed) delete nextPending[key];
    if (!removed && nextRevision === currentRevision) return;
    setConversationMeta?.({
      ...currentMeta,
      pending_approvals: nextPending,
      pending_approvals_revision: nextRevision,
    });
  }

  function renderApprovalMarkdown(container: HTMLElement | null | undefined, text: unknown, extraClass = '') {
    if (!(container instanceof HTMLElement)) return;
    if (typeof extraClass === 'string' && extraClass.trim()) {
      extraClass.trim().split(/\s+/).forEach((cls) => {
        if (cls) container.classList.add(cls);
      });
    }
    if (typeof renderEventMarkdownInto === 'function') {
      container.classList.add('markdown-body', 'approval-markdown');
      renderEventMarkdownInto(container, String(text || ''));
      return;
    }
    container.textContent = String(text || '');
  }

  function appendMarkdownValue(container: HTMLElement, label: string, value: unknown) {
    if (!(container instanceof HTMLElement)) return;
    if (value === null || value === undefined || value === '') return;
    const row = document.createElement('div');
    const title = document.createElement('div');
    title.innerHTML = `<strong>${escapeHtml(label)}:</strong>`;
    const content = document.createElement('div');
    renderApprovalMarkdown(content, String(value));
    row.append(title, content);
    container.append(row);
  }

  async function respondApproval(
    requestId: unknown,
    result: unknown,
    options: ApprovalRequestOptions = {},
  ): Promise<ApprovalResponse> {
    if (requestId === null || requestId === undefined) {
      return { ok: false, error: 'approval failed' };
    }
    const resultPayload: ApprovalResult = typeof result === 'string'
      ? { decision: result }
      : (asApprovalData(result) ?? {});
    const payload: ApprovalData = {
      conversation_id: getConversationId() || null,
      request_id: String(requestId),
    };
    if (Object.keys(resultPayload).length) {
      payload.result = resultPayload;
    }
    if (typeof resultPayload.decision === 'string') {
      payload.decision = resultPayload.decision;
    }
    try {
      const sioOptions: ApprovalRequestOptions = {};
      if (Object.prototype.hasOwnProperty.call(options, 'timeoutMs')) {
        sioOptions.timeoutMs = options.timeoutMs;
      }
      return asApprovalResponse(await conversationsRpcClient.respondApproval({
        requestId: String(requestId),
        conversationId: getConversationId() || null,
        result: payload.result && typeof payload.result === 'object' ? payload.result as Record<string, unknown> : null,
        decision: typeof payload.decision === 'string' ? payload.decision : null,
        timeoutMs: sioOptions.timeoutMs,
      }))
        ?? { ok: false, error: 'approval failed' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error || 'approval failed') };
    }
  }

  async function submitApproval(
    requestId: unknown,
    result: ApprovalResult,
    meta: ApprovalSubmitMeta = {},
  ): Promise<{ ok: boolean; response?: ApprovalResponse }> {
    const timeoutMs = meta?.requestMethod === 'agent-pty/ask-user' ? null : undefined;
    const response = await respondApproval(requestId, result, { timeoutMs });
    if (!response || response.ok === false) return { ok: false, response };
    const handoffEvent = asApprovalData(response.handoff_event);
    if (handoffEvent) {
      handoffApproval(handoffEvent, {
        row: meta.row,
        extensionId: meta.extensionId,
      });
    }
    return { ok: true, response };
  }

  function renderGenericApprovalBody(body: HTMLElement, evt: ApprovalData, helpers: ApprovalRenderHelpers) {
    const payload = evt.payload || {};
    let diffText: string | null = null;
    let filePath: string | null = null;
    let renderedAny = false;
    body.textContent = '';
    const appendPlainValue = (label: string, value: unknown) => {
      if (value === null || value === undefined || value === '') return;
      const row = document.createElement('div');
      row.innerHTML = `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value))}`;
      body.append(row);
      renderedAny = true;
    };
    const appendNarrativeValue = (label: string, value: unknown) => {
      if (value === null || value === undefined || value === '') return;
      appendMarkdownValue(body, label, value);
      renderedAny = true;
    };
    if (payload.command) {
      appendPlainValue('Command', Array.isArray(payload.command) ? payload.command.join(' ') : String(payload.command));
    }
    if (payload.cwd) {
      appendPlainValue('CWD', String(payload.cwd));
    }
    if (payload.reason) {
      appendNarrativeValue('Reason', String(payload.reason));
    }
    if (payload.question) {
      appendNarrativeValue('Question', String(payload.question));
    }
    if (payload.message) {
      appendNarrativeValue('Message', String(payload.message));
    }
    if (payload.warning) {
      const warningNode = document.createElement('div');
      renderApprovalMarkdown(warningNode, String(payload.warning), 'approval-feedback');
      body.append(warningNode);
      renderedAny = true;
    }
    if (payload.diff) {
      diffText = payload.diff;
      filePath = payload.path || filePath;
        const diffBlock = document.createElement('div');
        diffBlock.className = 'diff-block';
        if (typeof renderDiffBlock === 'function') {
          renderDiffBlock(diffBlock, payload.diff, payload.path || '');
        } else {
          diffBlock.innerHTML = formatDiff(payload.diff, payload.path || '');
        }
      body.append(diffBlock);
      renderedAny = true;
    }
    if (payload.changes && Array.isArray(payload.changes)) {
      payload.changes.forEach((change: ApprovalChange) => {
        if (change && change.diff) {
          const changePath = change.path || '';
          diffText = diffText || change.diff;
          filePath = filePath || change.path || null;
          const label = document.createElement('div');
          label.appendChild(createPathScrollLabel(document, toRelativePath(changePath) || 'file', {
            title: changePath,
            strong: true,
          }));
          const diffBlock = document.createElement('div');
          diffBlock.className = 'diff-block';
          if (typeof renderDiffBlock === 'function') {
            renderDiffBlock(diffBlock, change.diff, changePath);
          } else {
            diffBlock.innerHTML = formatDiff(change.diff, changePath);
          }
          body.append(label, diffBlock);
          renderedAny = true;
        }
      });
    }
    if (payload.changes && payload.changes.constructor === Object) {
      Object.entries(payload.changes).forEach(([changePath, change]) => {
        const changeRecord = change && typeof change === 'object' ? change as ApprovalChange : null;
        if (!changeRecord) return;
        const changeDiff = changeRecord.diff || changeRecord.unified_diff || changeRecord.patch || '';
        if (!changeDiff) return;
        const resolvedPath = changeRecord.path || changeRecord.file_path || changePath;
        diffText = diffText || changeDiff;
        filePath = filePath || resolvedPath;
        const label = document.createElement('div');
        label.appendChild(createPathScrollLabel(document, toRelativePath(resolvedPath) || 'file', {
          title: resolvedPath,
          strong: true,
        }));
        const diffBlock = document.createElement('div');
        diffBlock.className = 'diff-block';
        if (typeof renderDiffBlock === 'function') {
          renderDiffBlock(diffBlock, changeDiff, resolvedPath);
        } else {
          diffBlock.innerHTML = formatDiff(changeDiff, resolvedPath);
        }
        body.append(label, diffBlock);
        renderedAny = true;
      });
    }
    if (!renderedAny) {
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(payload, null, 2);
      body.append(pre);
    }

    if (helpers.readOnly) {
      const feedback = document.createElement('div');
      feedback.className = 'approval-feedback approval-feedback-static';
      const parts = [];
      if (typeof evt?.status === 'string' && evt.status.trim()) parts.push(evt.status.trim());
      if (typeof evt?.decision === 'string' && evt.decision.trim()) parts.push(evt.decision.trim());
      feedback.textContent = parts.length ? `Recorded response: ${parts.join(' / ')}` : 'Recorded response';
      body.append(feedback);
      if (evt?.result && typeof evt.result === 'object') {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Recorded result';
        const pre = document.createElement('pre');
        pre.className = 'approval-extra';
        pre.textContent = JSON.stringify(evt.result, null, 2);
        details.append(summary, pre);
        body.append(details);
      }
      return;
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const accept = document.createElement('button');
    accept.className = 'btn tiny approve';
    accept.textContent = 'Accept';
    const decline = document.createElement('button');
    decline.className = 'btn tiny decline';
    decline.textContent = 'Decline';
    accept.addEventListener('click', async () => {
      await helpers.submitResult({ decision: 'accept' }, { diff: diffText, path: filePath });
    });
    decline.addEventListener('click', async () => {
      await helpers.submitResult({ decision: 'decline' }, { diff: diffText, path: filePath });
    });
    actions.append(accept, decline);
    body.append(actions);
  }

  function renderApproval(evt: ApprovalData, options: ApprovalRowOptions = {}) {
    const requestId = approvalRequestId(evt);
    if (!requestId) return null;
    if (!upsertLivePendingApproval(evt, options)) return null;
    const { row, body } = ensureApprovalRow(evt, options);
    applyTranscriptCardMetadata(row, evt);

    const helpers = {
      escapeHtml,
      formatDiff,
      renderDiffBlock: (container: HTMLElement, diff: string, path = '') => {
        if (typeof renderDiffBlock === 'function') {
          renderDiffBlock(container, diff, path || '');
        } else {
          container.innerHTML = formatDiff(diff, path || '');
        }
      },
      toRelativePath,
      normalizeDecisionLabel,
      renderMarkdown: (container: HTMLElement, text: unknown, extraClass = '') => renderApprovalMarkdown(container, text, extraClass),
      readOnly: options.readOnly === true,
      submitResult: async (result: ApprovalResult, meta: ApprovalSubmitMeta = {}) => submitApproval(requestId, result, {
        requestMethod: evt?.request_method || evt?.requestMethod || null,
        payload: evt?.payload || null,
        extensionId: options.extensionId,
        ...meta,
        row,
      }),
      respondApproval,
      recordApproval: async () => ({ ok: false, error: 'approval_record is deprecated in the UI flow' }),
    };
    if (options.readOnly) {
      helpers.submitResult = async () => ({ ok: false, response: { error: 'Replayed approval is read-only' } });
      helpers.respondApproval = async () => ({ ok: false, error: 'Replayed approval is read-only' });
    }

    const extensionId = options.extensionId
      || (typeof getCurrentExtensionId === 'function' ? getCurrentExtensionId() : '');
    body.textContent = 'Loading approval…';
    const requestCardRender = requestCardRuntime?.render;

    const fallback = () => renderGenericApprovalBody(body, evt, helpers);

    if (typeof requestCardRender !== 'function') {
      fallback();
      onAfterRender?.();
      return row;
    }

    void (async () => {
      const handled = await requestCardRender(evt, {
        extensionId,
        row,
        body,
        helpers,
      }).catch(() => false);
      if (!handled) {
        fallback();
      }
      onAfterRender?.();
    })();

    return row;
  }

  function buildApprovalEventFromPending(entry: ApprovalData) {
    const conversationId = getConversationId() || null;
    const requestId = entry?.request_id || entry?.id;
    if (!requestId) return null;
    const liveEvent = entry.render_event && typeof entry.render_event === 'object'
      ? { ...entry.render_event }
      : {
          type: 'approval',
          id: requestId,
          request_id: requestId,
          kind: entry.kind || entry.payload?.kind || 'unknown',
          payload: entry.payload || {},
          turn_id: entry.turn_id || '',
          conversation_id: conversationId,
        };
    liveEvent.type = 'approval';
    liveEvent.id = liveEvent.id ?? requestId;
    liveEvent.request_id = liveEvent.request_id ?? requestId;
    liveEvent.kind = liveEvent.kind || entry.kind || liveEvent.payload?.kind || 'unknown';
    liveEvent.request_method = liveEvent.request_method || entry.request_method || null;
    liveEvent.request_params = (liveEvent.request_params && typeof liveEvent.request_params === 'object')
      ? liveEvent.request_params
      : (entry.request_params || {});
    liveEvent.payload = (liveEvent.payload && typeof liveEvent.payload === 'object') ? liveEvent.payload : (entry.payload || {});
    liveEvent.card_id = liveEvent.card_id || entry.card_id || entry.item_id || liveEvent.id || requestId;
    liveEvent.turn_id = liveEvent.turn_id || entry.turn_id || '';
    liveEvent.conversation_id = liveEvent.conversation_id || conversationId;
    return liveEvent;
  }

  function restorePendingApprovals() {
    if (!timelineEl) return;
    const conversationMeta = getConversationMeta?.();
    const pending = conversationMeta?.pending_approvals;
    const metaRevision = pendingApprovalsRevision(conversationMeta);
    const pendingIds = new Set(
      pending && typeof pending === 'object' ? Object.keys(pending) : [],
    );
    timelineEl.querySelectorAll('.timeline-row[data-approval-id]').forEach((row: Element) => {
      if (!(row instanceof HTMLElement)) return;
      const source = row.dataset.approvalSource;
      if (source === 'pending') {
        row.remove();
        return;
      }
      if (source !== 'live') return;
      const requestId = row.dataset.approvalId || '';
      const rowRevision = Number(row.dataset.approvalRevision);
      const normalizedRowRevision = Number.isSafeInteger(rowRevision) && rowRevision >= 0 ? rowRevision : 0;
      if (!pendingIds.has(requestId) && metaRevision >= normalizedRowRevision) {
        row.remove();
      }
    });
    if (!pending || typeof pending !== 'object') {
      onAfterRender?.();
      return;
    }
    const items = (Object.values(pending) as ApprovalData[])
      .filter((entry) => entry && typeof entry === 'object' && (entry.request_id || entry.id))
      .sort((a, b) => String(a?.created_at || a?.render_event?.created_at || '').localeCompare(String(b?.created_at || b?.render_event?.created_at || '')));
    items.forEach((entry) => {
      const liveEvent = buildApprovalEventFromPending(entry);
      if (!liveEvent) return;
      renderApproval(liveEvent, { source: 'pending', useExisting: true });
    });
    onAfterRender?.();
  }

  function handoffApproval(evt: ApprovalData, options: ApprovalRowOptions = {}) {
    const requestId = approvalRequestId(evt);
    if (!requestId) return null;
    const activeRow: HTMLElement | null = options.row instanceof HTMLElement ? options.row : findApprovalRow(evt);
    const parentEl = options.parentEl || activeRow?.parentElement || null;
    const nextSibling = activeRow?.nextSibling || null;
    if (activeRow) activeRow.remove();
    prunePendingApproval(requestId, pendingApprovalsRevision(evt));
    const askUserMsgId = evt?.ask_user_msg_id ?? evt?.askUserMsgId;
    const resolvedCardId = approvalCardId(evt);
    const handoffEvent = {
      ...evt,
      type: 'approval',
      request_id: requestId,
      id: evt?.id ?? requestId,
      card_id: resolvedCardId,
      ask_user_msg_id: askUserMsgId,
      replay: false,
    };
    const resolvedRow = renderApproval(handoffEvent, {
      ...options,
      parentEl,
      readOnly: true,
      useExisting: false,
      source: 'resolved',
    });
    if (resolvedRow && askUserMsgId != null) {
      resolvedRow.dataset.askUserMsgId = String(askUserMsgId);
    }
    if (resolvedRow && parentEl && nextSibling && resolvedRow.parentElement === parentEl) {
      parentEl.insertBefore(resolvedRow, nextSibling);
    }
    return resolvedRow;
  }

  function invalidateApproval(evt: ApprovalData) {
    const requestId = approvalRequestId(evt);
    if (!requestId) return false;
    if (timelineEl) {
      const rows = Array.from(timelineEl.querySelectorAll('.timeline-row[data-approval-id]')) as HTMLElement[];
      rows.forEach((row) => {
        if (row.dataset.approvalId === requestId && row.dataset.approvalSource !== 'resolved') {
          row.remove();
        }
      });
    }
    prunePendingApproval(requestId, pendingApprovalsRevision(evt));
    onAfterRender?.();
    return true;
  }

  return {
    approvalStatusFromResult,
    renderApproval,
    handoffApproval,
    invalidateApproval,
    restorePendingApprovals,
    respondApproval,
  };
}
