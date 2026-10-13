import { createConversationsRpcClient } from '../rpc/conversations/client.ts';
import type { ComposerSelectionState, JsonObject } from '../rpc/conversations/contract.ts';
import { createUiRpcClient } from '../rpc/ui/client.ts';
import type {
  ClipboardWindow,
  TributeConstructor,
  TributeInstance,
  TributeItemOriginal,
  TributeLookupItem,
  UnknownRecord,
} from '../shared_types.ts';
import { getPageClientId } from '../client_identity.ts';

declare const Tribute: TributeConstructor | undefined;

interface ComposerConversationMeta {
  conversation_id?: string | null;
  draft?: string;
  draft_revision?: number;
  draft_selection?: ComposerSelectionState;
  selection_revision?: number;
  author_epoch?: number;
  author_client_id?: string;
  origin_client_id?: string;
  client_sequence?: number;
  cwd?: string;
}

interface ComposerConversationSettings {
  cwd?: string;
}

interface DraftMentionOptions {
  line?: unknown;
  lineNo?: unknown;
  endLine?: unknown;
  endLineNo?: unknown;
  col?: unknown;
  endCol?: unknown;
  content?: unknown;
  operationId?: unknown;
}

interface DraftMentionPayload {
  path: string;
  line?: string;
  endLine?: string;
  col?: string;
  endCol?: string;
  content?: string;
}

interface ComposerRuntimeState {
  conversationMeta?: ComposerConversationMeta;
  conversationSettings?: ComposerConversationSettings;
  draftSaveTimer?: ReturnType<typeof setTimeout> | null;
  lastDraftHash?: string | null;
  draftDirty?: boolean;
  applyingDraft?: boolean;
}

interface ComposerRuntimeContext {
  getState(): ComposerRuntimeState;
  setState(patch: Partial<ComposerRuntimeState>): void;
  promptEl: HTMLElement | null;
  mentionPillEl: HTMLElement | null;
  documentRef: Document;
  windowRef: Window;
  sioCall(event: string, data?: Record<string, unknown>): Promise<unknown>;
  escapeHtml(text: string): string;
}

const DRAFT_MENTION_ENVELOPE_START = '\x1eCODEX_MENTION ';
const DRAFT_MENTION_ENVELOPE_END = '\x1f';
export const COMPOSER_PAIR_GESTURE_TIMEOUT_MS = 800;
const COMPOSER_AUTO_PAIRS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  '`': '`',
};
const COMPOSER_SELECTION_PAIRS: Readonly<Record<string, string>> = {
  ...COMPOSER_AUTO_PAIRS,
  "'": "'",
};
const COMPOSER_CLOSERS = new Set(Object.values(COMPOSER_SELECTION_PAIRS));
const COMPOSER_TRIPLE_CHARACTERS = new Set(['"', "'", '`']);

export type ComposerAutoPairState =
  | {
    kind: 'fresh_pair';
    opening: string;
    closing: string;
    start: number;
    expiresAt: number;
  }
  | {
    kind: 'single_quote_start';
    start: number;
    expiresAt: number;
  }
  | {
    kind: 'single_entry';
    character: string;
    expiresAt: number;
  };

export interface ComposerAutoPairEdit {
  draft: string;
  selection: ComposerSelectionState;
  action: 'insert' | 'delete' | 'skip';
}

export interface ComposerAutoPairPlan {
  edit: ComposerAutoPairEdit | null;
  state: ComposerAutoPairState | null;
}

export interface ComposerBeforeInput {
  inputType: string;
  data: string | null;
}

function activeAutoPairState(
  state: ComposerAutoPairState | null,
  now: number,
): ComposerAutoPairState | null {
  return state && state.expiresAt >= now ? state : null;
}

function selectionBounds(
  draft: string,
  selection: ComposerSelectionState,
): { anchor: number; focus: number; start: number; end: number; collapsed: boolean } {
  const draftLength = draft.length;
  const anchor = Math.min(Math.max(0, selection.anchor), draftLength);
  const focus = Math.min(Math.max(0, selection.focus), draftLength);
  const start = Math.min(anchor, focus);
  const end = Math.max(anchor, focus);
  return { anchor, focus, start, end, collapsed: start === end };
}

export function planComposerAutoPairEdit(
  beforeInput: ComposerBeforeInput,
  draft: string,
  selection: ComposerSelectionState,
  previousState: ComposerAutoPairState | null,
  now: number,
): ComposerAutoPairPlan {
  let state = activeAutoPairState(previousState, now);
  const { anchor, focus, start, end, collapsed } = selectionBounds(draft, selection);

  if (beforeInput.inputType === 'deleteContentBackward') {
    if (state?.kind !== 'fresh_pair'
      || !collapsed
      || start !== state.start + 1
      || draft.slice(state.start, state.start + 2) !== `${state.opening}${state.closing}`) {
      return { edit: null, state: state?.kind === 'single_entry' ? state : null };
    }
    if (state.opening === '"' || state.opening === '`') {
      return {
        edit: {
          draft: `${draft.slice(0, state.start)}${draft.slice(state.start + 1)}`,
          selection: { anchor: state.start + 1, focus: state.start + 1 },
          action: 'delete',
        },
        state: null,
      };
    }
    if (state.opening === "'") return { edit: null, state: null };
    return {
      edit: {
        draft: `${draft.slice(0, state.start)}${draft.slice(state.start + 2)}`,
        selection: { anchor: state.start, focus: state.start },
        action: 'delete',
      },
      state: {
        kind: 'single_entry',
        character: state.opening,
        expiresAt: now + COMPOSER_PAIR_GESTURE_TIMEOUT_MS,
      },
    };
  }

  if (beforeInput.inputType !== 'insertText') return { edit: null, state: null };
  const input = beforeInput.data || '';
  if (input.length !== 1) return { edit: null, state: null };

  if (!collapsed) {
    const closing = COMPOSER_SELECTION_PAIRS[input];
    if (!closing) return { edit: null, state: null };
    return {
      edit: {
        draft: `${draft.slice(0, start)}${input}${draft.slice(start, end)}${closing}${draft.slice(end)}`,
        selection: {
          anchor: anchor + 1,
          focus: focus + 1,
        },
        action: 'insert',
      },
      state: null,
    };
  }

  if (state?.kind === 'single_entry') {
    if (state.character === input) return { edit: null, state };
    state = null;
  }

  if (state?.kind === 'fresh_pair') {
    const pairIsIntact = start === state.start + 1
      && draft.slice(state.start, state.start + 2) === `${state.opening}${state.closing}`;
    if (pairIsIntact && input === state.opening && COMPOSER_TRIPLE_CHARACTERS.has(input)) {
      return {
        edit: {
          draft: `${draft.slice(0, state.start + 2)}${input}${draft.slice(state.start + 2)}`,
          selection: { anchor: state.start + 3, focus: state.start + 3 },
          action: 'insert',
        },
        state: null,
      };
    }
    state = null;
  }

  if (state?.kind === 'single_quote_start') {
    const firstQuoteIsIntact = input === "'"
      && start === state.start + 1
      && draft[state.start] === "'";
    if (firstQuoteIsIntact) {
      return {
        edit: {
          draft: `${draft.slice(0, start)}'${draft.slice(start)}`,
          selection: { anchor: start, focus: start },
          action: 'insert',
        },
        state: {
          kind: 'fresh_pair',
          opening: "'",
          closing: "'",
          start: state.start,
          expiresAt: now + COMPOSER_PAIR_GESTURE_TIMEOUT_MS,
        },
      };
    }
    state = null;
  }

  if (collapsed && COMPOSER_CLOSERS.has(input) && draft[start] === input) {
    return {
      edit: {
        draft,
        selection: { anchor: start + 1, focus: start + 1 },
        action: 'skip',
      },
      state: null,
    };
  }

  const closing = COMPOSER_AUTO_PAIRS[input];
  if (!closing) {
    if (input === "'") {
      return {
        edit: null,
        state: {
          kind: 'single_quote_start',
          start,
          expiresAt: now + COMPOSER_PAIR_GESTURE_TIMEOUT_MS,
        },
      };
    }
    return { edit: null, state: null };
  }

  return {
    edit: {
      draft: `${draft.slice(0, start)}${input}${closing}${draft.slice(start)}`,
      selection: { anchor: start + 1, focus: start + 1 },
      action: 'insert',
    },
    state: {
      kind: 'fresh_pair',
      opening: input,
      closing,
      start,
      expiresAt: now + COMPOSER_PAIR_GESTURE_TIMEOUT_MS,
    },
  };
}

function getDraftHash(text: string): string {
  return String(text || '').split('').reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0).toString(16);
}

function isAbsolutePath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/');
}

function joinPath(basePath: string, childPath: string): string {
  if (!basePath) return childPath || '';
  if (!childPath) return basePath || '';
  if (basePath.endsWith('/')) return basePath + childPath;
  return `${basePath}/${childPath}`;
}

function getRelativePath(absolutePath: string, cwd: string): string {
  if (!absolutePath || !cwd) return absolutePath;
  const cwdNorm = cwd.endsWith('/') ? cwd : `${cwd}/`;
  if (absolutePath.startsWith(cwdNorm)) {
    return absolutePath.slice(cwdNorm.length);
  }
  return absolutePath;
}

export function bindComposerRuntime(ctx: ComposerRuntimeContext) {
  const {
    getState,
    setState,
    promptEl,
    mentionPillEl,
    documentRef,
    windowRef,
    sioCall,
    escapeHtml,
  } = ctx;
  const uiRpcClient = createUiRpcClient({
    sioCall,
    windowRef,
  });
  const conversationsRpcClient = createConversationsRpcClient({
    windowRef,
  });

  let tributeInstance: TributeInstance | null = null;
  let explicitMentionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let selectionSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let lastComposerSelectionRange: Range | null = null;
  let lastComposerSelectionConversationId: string | null = null;
  let lastSelectionSignature: string | null = null;
  let draftRevision = 0;
  let selectionRevision = 0;
  let clientSequence = 0;
  let authorEpoch = 0;
  let authorClientId: string | null = null;
  let authorClaimPromise: Promise<number | null> | null = null;
  let applyingRemoteSelection = false;
  let suppressSelectionPublishingUntil = 0;
  let autoPairState: ComposerAutoPairState | null = null;
  const appliedMentionOperations = new Set<string>();
  const composerClientId = getPageClientId(windowRef);

  function resetComposerAutoPairState(): void {
    autoPairState = null;
  }

  function hasFocusedComposer(): boolean {
    return Boolean(promptEl && documentRef.hasFocus() && documentRef.activeElement === promptEl);
  }

  function selectionPublishingSuppressed(): boolean {
    return Date.now() < suppressSelectionPublishingUntil;
  }

  function cancelSelectionSync(): void {
    if (selectionSyncTimer) clearTimeout(selectionSyncTimer);
    selectionSyncTimer = null;
  }

  async function claimComposerAuthorship(
    selectionOverride: ComposerSelectionState | null = null,
    allowUnfocused = false,
  ): Promise<number | null> {
    if (!promptEl) return null;
    const conversationId = getState().conversationMeta?.conversation_id;
    if (!conversationId) return null;
    if (authorClientId === composerClientId && authorEpoch > 0) return authorEpoch;
    if (!allowUnfocused && !hasFocusedComposer()) return null;
    if (authorClaimPromise) return authorClaimPromise;
    const selection = selectionOverride || getComposerSelectionState();
    if (!selection) return null;
    const sequence = ++clientSequence;
    authorClaimPromise = conversationsRpcClient.claimDraftAuthor({
      conversationId,
      clientId: composerClientId,
      clientSequence: sequence,
      selection,
    }).then((result) => {
      if (getState().conversationMeta?.conversation_id !== conversationId) return null;
      applyComposerRevisions(result);
      if (result.stale === true || authorClientId !== composerClientId || authorEpoch <= 0) {
        return null;
      }
      return authorEpoch;
    }).catch((error) => {
      console.warn('Composer authorship claim failed:', error);
      return null;
    }).finally(() => {
      authorClaimPromise = null;
    });
    return authorClaimPromise;
  }

  async function writeDraftAsAuthor(
    conversationId: string,
    draft: string,
    selection: ComposerSelectionState | null,
    allowUnfocusedClaim = false,
  ): Promise<JsonObject | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const claimedEpoch = await claimComposerAuthorship(selection, allowUnfocusedClaim);
      if (!claimedEpoch) return null;
      const sequence = ++clientSequence;
      const result = await conversationsRpcClient.setDraft({
        conversationId,
        draft,
        clientId: composerClientId,
        clientSequence: sequence,
        authorEpoch: claimedEpoch,
        selection,
      });
      applyComposerRevisions(result);
      if (result.stale !== true) return result;
    }
    return null;
  }

  function appendTextWithBreaks(parent: HTMLElement, text: unknown) {
    if (!parent || text === null || text === undefined) return;
    const parts = String(text).split('\n');
    parts.forEach((part, idx) => {
      if (part) parent.appendChild(documentRef.createTextNode(part));
      if (idx < parts.length - 1) parent.appendChild(documentRef.createElement('br'));
    });
  }

  function buildDraftMentionPayload(rawPath: unknown, opts: DraftMentionOptions = {}) {
    const resolvedOpts = opts || {};
    let pathOnly = String(rawPath || '').trim();
    let line = resolvedOpts.line ?? resolvedOpts.lineNo ?? null;
    let endLine = resolvedOpts.endLine ?? resolvedOpts.endLineNo ?? null;
    const col = resolvedOpts.col ?? null;
    const endCol = resolvedOpts.endCol ?? null;
    const content = typeof resolvedOpts.content === 'string' ? resolvedOpts.content : '';
    const lineMatch = pathOnly.match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (lineMatch) {
      pathOnly = lineMatch[1];
      if (line == null) line = lineMatch[2];
      if (endLine == null) endLine = lineMatch[3] || null;
    }
    if (!pathOnly) return null;
    const payload: DraftMentionPayload = { path: pathOnly };
    if (line != null && String(line).trim()) payload.line = String(line);
    if (endLine != null && String(endLine).trim()) payload.endLine = String(endLine);
    if (col != null && String(col).trim()) payload.col = String(col);
    if (endCol != null && String(endCol).trim()) payload.endCol = String(endCol);
    if (content) payload.content = content;
    return payload;
  }

  function encodeDraftMentionToken(rawPath: unknown, opts: DraftMentionOptions = {}) {
    const payload = buildDraftMentionPayload(rawPath, opts);
    if (!payload) return '';
    return DRAFT_MENTION_ENVELOPE_START + JSON.stringify(payload) + DRAFT_MENTION_ENVELOPE_END;
  }

  function decodeDraftMentionPayload(payloadText: string) {
    try {
      const parsed = JSON.parse(payloadText) as UnknownRecord;
      if (!parsed || typeof parsed !== 'object') return null;
      const path = typeof parsed.path === 'string' ? parsed.path.trim() : '';
      if (!path) return null;
      const payload: DraftMentionPayload = { path };
      if (parsed.line != null && String(parsed.line).trim()) payload.line = String(parsed.line);
      if (parsed.endLine != null && String(parsed.endLine).trim()) payload.endLine = String(parsed.endLine);
      if (parsed.col != null && String(parsed.col).trim()) payload.col = String(parsed.col);
      if (parsed.endCol != null && String(parsed.endCol).trim()) payload.endCol = String(parsed.endCol);
      if (typeof parsed.content === 'string' && parsed.content) payload.content = parsed.content;
      return payload;
    } catch {
      return null;
    }
  }

  function clearStoredComposerSelection() {
    lastComposerSelectionRange = null;
    lastComposerSelectionConversationId = null;
    lastSelectionSignature = null;
  }

  function isPromptRangeNode(node: Node | null): boolean {
    if (!promptEl || !node) return false;
    try {
      return node === promptEl || promptEl.contains(node);
    } catch {
      return false;
    }
  }

  function rememberComposerSelection(sync = true): boolean {
    if (!promptEl || getState().applyingDraft || applyingRemoteSelection) return false;
    const selection = windowRef.getSelection?.();
    if (!selection || selection.rangeCount < 1) return false;
    const range = selection.getRangeAt(0);
    if (!range) return false;
    if (!isPromptRangeNode(range.commonAncestorContainer) || !isPromptRangeNode(range.startContainer) || !isPromptRangeNode(range.endContainer)) {
      return false;
    }
    try {
      lastComposerSelectionRange = range.cloneRange();
      lastComposerSelectionConversationId = getState().conversationMeta?.conversation_id || null;
      if (sync) queueSelectionSync();
      return true;
    } catch {
      return false;
    }
  }

  function draftOffsetForPoint(node: Node | null, offset: number): number | null {
    if (!promptEl || !node || !isPromptRangeNode(node)) return null;
    try {
      const prefix = documentRef.createRange();
      prefix.setStart(promptEl, 0);
      prefix.setEnd(node, offset);
      const fragment = prefix.cloneContents();
      let serialized = '';
      fragment.childNodes.forEach((child) => {
        serialized += serializePromptNodeForDraft(child);
      });
      return serialized.length;
    } catch {
      return null;
    }
  }

  function getComposerSelectionState(): ComposerSelectionState | null {
    if (!promptEl) return null;
    const selection = windowRef.getSelection?.();
    if (!selection || !selection.anchorNode || !selection.focusNode) return null;
    if (!isPromptRangeNode(selection.anchorNode) || !isPromptRangeNode(selection.focusNode)) return null;
    const anchor = draftOffsetForPoint(selection.anchorNode, selection.anchorOffset);
    const focus = draftOffsetForPoint(selection.focusNode, selection.focusOffset);
    if (anchor === null || focus === null) return null;
    return { anchor, focus };
  }

  function queueSelectionSync() {
    if (getState().applyingDraft || applyingRemoteSelection) return;
    if (selectionPublishingSuppressed()) return;
    if (!hasFocusedComposer()) return;
    const conversationId = getState().conversationMeta?.conversation_id;
    const selection = getComposerSelectionState();
    if (!conversationId || !selection) return;
    const signature = `${conversationId}:${selection.anchor}:${selection.focus}`;
    if (signature === lastSelectionSignature) return;
    lastSelectionSignature = signature;
    cancelSelectionSync();
    selectionSyncTimer = setTimeout(async () => {
      selectionSyncTimer = null;
      const claimedEpoch = await claimComposerAuthorship();
      if (!claimedEpoch || !hasFocusedComposer()) return;
      const currentConversationId = getState().conversationMeta?.conversation_id;
      const currentSelection = getComposerSelectionState();
      if (!currentConversationId || currentConversationId !== conversationId || !currentSelection) return;
      const sequence = ++clientSequence;
      void conversationsRpcClient.setDraftSelection({
        conversationId,
        clientId: composerClientId,
        clientSequence: sequence,
        authorEpoch: claimedEpoch,
        selection: currentSelection,
      }).then((result) => {
        applyComposerRevisions(result);
        if (result.stale === true) {
          lastSelectionSignature = null;
          if (hasFocusedComposer()) queueSelectionSync();
        }
      }).catch((error) => {
        lastSelectionSignature = null;
        console.warn('Composer selection sync failed:', error);
      });
    }, 80);
  }

  function getStoredComposerSelectionRange(): Range | null {
    if (!lastComposerSelectionRange) return null;
    if ((getState().conversationMeta?.conversation_id || null) !== lastComposerSelectionConversationId) {
      clearStoredComposerSelection();
      return null;
    }
    try {
      if (!isPromptRangeNode(lastComposerSelectionRange.startContainer) || !isPromptRangeNode(lastComposerSelectionRange.endContainer)) {
        clearStoredComposerSelection();
        return null;
      }
      return lastComposerSelectionRange.cloneRange();
    } catch {
      clearStoredComposerSelection();
      return null;
    }
  }

  function resolveComposerInsertTarget() {
    const selection = windowRef.getSelection?.();
    if (selection && selection.rangeCount > 0) {
      const liveRange = selection.getRangeAt(0);
      if (liveRange && isPromptRangeNode(liveRange.commonAncestorContainer) && isPromptRangeNode(liveRange.startContainer) && isPromptRangeNode(liveRange.endContainer)) {
        return { selection, range: liveRange };
      }
    }
    const storedRange = getStoredComposerSelectionRange();
    if (!storedRange) return null;
    promptEl?.focus();
    const restoredSelection = windowRef.getSelection?.();
    if (!restoredSelection) return null;
    try {
      restoredSelection.removeAllRanges();
      restoredSelection.addRange(storedRange);
      return { selection: restoredSelection, range: restoredSelection.getRangeAt(0) };
    } catch {
      clearStoredComposerSelection();
      return null;
    }
  }

  function toMentionAbsAndBestPath(rawPath: unknown) {
    const state = getState();
    const cwd = state.conversationSettings?.cwd || state.conversationMeta?.cwd || '';
    const stringPath = String(rawPath || '');
    const absPath = isAbsolutePath(stringPath) ? stringPath : (cwd ? joinPath(cwd, stringPath) : stringPath);
    const bestPath = (cwd && isAbsolutePath(absPath)) ? getRelativePath(absPath, cwd) : absPath;
    return { absPath, bestPath };
  }

  function createMentionToken(rawPath: unknown, opts: DraftMentionOptions = {}) {
    let pathOnly = String(rawPath || '');
    let parsedLine: string | null = null;
    let parsedEndLine: string | null = null;
    const lineMatch = pathOnly.match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (lineMatch) {
      pathOnly = lineMatch[1];
      parsedLine = lineMatch[2];
      parsedEndLine = lineMatch[3] || null;
    }

    const { absPath, bestPath } = toMentionAbsAndBestPath(pathOnly);
    const span = documentRef.createElement('span');
    span.className = 'mention-token';
    span.dataset.abs = absPath || '';
    span.dataset.path = bestPath || '';
    span.setAttribute('contenteditable', 'false');
    span.title = absPath || bestPath || '';

    const line = opts.line || parsedLine;
    const endLine = opts.endLine || parsedEndLine;
    if (line) span.dataset.line = String(line);
    if (endLine) span.dataset.endLine = String(endLine);
    if (opts.col) span.dataset.col = String(opts.col);
    if (opts.endCol) span.dataset.endCol = String(opts.endCol);

    const display = String(bestPath || '').split('/').filter(Boolean).pop() || bestPath || absPath;
    let displayText = display;
    if (line) {
      displayText += `:${line}`;
      if (endLine && endLine !== line) displayText += `-${endLine}`;
    }

    const content = typeof opts.content === 'string' ? opts.content : '';
    if (content) {
      span.dataset.content = content;
      span.appendChild(documentRef.createTextNode(displayText));
      const codeEl = documentRef.createElement('code');
      codeEl.className = 'mention-content-preview';
      codeEl.textContent = content;
      span.appendChild(codeEl);
    } else {
      span.textContent = displayText;
    }

    const removeBtn = documentRef.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'mention-token-remove';
    removeBtn.textContent = '(x)';
    removeBtn.setAttribute('aria-label', 'Remove mention');
    removeBtn.title = 'Remove mention';
    removeBtn.setAttribute('contenteditable', 'false');
    removeBtn.tabIndex = -1;
    span.appendChild(removeBtn);

    return span;
  }

  function renderPromptFromText(text: unknown) {
    if (!promptEl) return;
    setState({ applyingDraft: true });
    try {
      clearStoredComposerSelection();
      promptEl.innerHTML = '';
      const resolvedText = String(text || '');
      let cursor = 0;

      while (cursor < resolvedText.length) {
        const startIdx = resolvedText.indexOf(DRAFT_MENTION_ENVELOPE_START, cursor);
        if (startIdx === -1) {
          const remaining = resolvedText.slice(cursor);
          if (remaining) appendTextWithBreaks(promptEl, remaining);
          break;
        }

        const before = resolvedText.slice(cursor, startIdx);
        if (before) appendTextWithBreaks(promptEl, before);

        const payloadStart = startIdx + DRAFT_MENTION_ENVELOPE_START.length;
        const endIdx = resolvedText.indexOf(DRAFT_MENTION_ENVELOPE_END, payloadStart);
        if (endIdx === -1) {
          appendTextWithBreaks(promptEl, resolvedText.slice(startIdx));
          break;
        }

        const mentionPayload = decodeDraftMentionPayload(resolvedText.slice(payloadStart, endIdx));
        if (mentionPayload) {
          promptEl.appendChild(createMentionToken(mentionPayload.path, {
            line: mentionPayload.line,
            endLine: mentionPayload.endLine,
            col: mentionPayload.col,
            endCol: mentionPayload.endCol,
            content: mentionPayload.content,
          }));
        } else {
          appendTextWithBreaks(promptEl, resolvedText.slice(startIdx, endIdx + DRAFT_MENTION_ENVELOPE_END.length));
        }
        cursor = endIdx + DRAFT_MENTION_ENVELOPE_END.length;
      }
    } finally {
      setState({ applyingDraft: false });
    }
  }

  function serializePromptNode(node: Node | null): string {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    if (el.classList.contains('mention-token')) {
      const state = getState();
      const absPath = el.dataset.abs || '';
      const fallback = el.dataset.path || el.textContent || '';
      const cwd = state.conversationSettings?.cwd || state.conversationMeta?.cwd || '';
      let pathStr = '';
      if (absPath && cwd) {
        const best = getRelativePath(absPath, cwd);
        pathStr = best !== absPath ? best : absPath;
      } else {
        pathStr = fallback;
      }
      if (!pathStr) return '';
      const line = el.dataset.line;
      const endLine = el.dataset.endLine;
      if (line) {
        pathStr += `:${line}`;
        if (endLine && endLine !== line) pathStr += `-${endLine}`;
      }
      const content = el.dataset.content || '';
      if (content) {
        return '`' + pathStr + '`\n```\n' + content + '\n```';
      }
      return '`' + pathStr + '`';
    }
    if (el.tagName === 'BR') return '\n';
    let out = '';
    el.childNodes.forEach((child) => {
      out += serializePromptNode(child);
    });
    if (el.tagName === 'DIV' || el.tagName === 'P') out += '\n';
    return out;
  }

  function serializePromptNodeForDraft(node: Node | null): string {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    if (el.classList.contains('mention-token')) {
      return encodeDraftMentionToken(el.dataset.abs || el.dataset.path || '', {
        line: el.dataset.line,
        endLine: el.dataset.endLine,
        col: el.dataset.col,
        endCol: el.dataset.endCol,
        content: el.dataset.content || '',
      });
    }
    if (el.tagName === 'BR') return '\n';
    let out = '';
    el.childNodes.forEach((child) => {
      out += serializePromptNodeForDraft(child);
    });
    if (el.tagName === 'DIV' || el.tagName === 'P') out += '\n';
    return out;
  }

  function getPromptText(): string {
    if (!promptEl) return '';
    let text = '';
    promptEl.childNodes.forEach((child) => {
      text += serializePromptNode(child);
    });
    return text;
  }

  function getPromptDraftText(): string {
    if (!promptEl) return '';
    let text = '';
    promptEl.childNodes.forEach((child) => {
      text += serializePromptNodeForDraft(child);
    });
    return text;
  }

  function locateDraftPoint(parent: Node, targetOffset: number): { node: Node; offset: number } {
    const children = Array.from(parent.childNodes);
    let consumed = 0;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const serialized = serializePromptNodeForDraft(child);
      const end = consumed + serialized.length;
      if (targetOffset > end) {
        consumed = end;
        continue;
      }
      const localOffset = Math.max(0, targetOffset - consumed);
      if (child.nodeType === Node.TEXT_NODE) {
        return {
          node: child,
          offset: Math.min(localOffset, child.textContent?.length ?? 0),
        };
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        if (element.classList.contains('mention-token') || element.tagName === 'BR') {
          return { node: parent, offset: localOffset === 0 ? index : index + 1 };
        }
        const trailingLength = element.tagName === 'DIV' || element.tagName === 'P' ? 1 : 0;
        const contentLength = Math.max(0, serialized.length - trailingLength);
        if (localOffset <= contentLength) {
          return locateDraftPoint(child, localOffset);
        }
        return { node: parent, offset: index + 1 };
      }
      return { node: parent, offset: localOffset === 0 ? index : index + 1 };
    }
    return { node: parent, offset: children.length };
  }

  function parseComposerSelection(value: unknown): ComposerSelectionState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as JsonObject;
    const anchor = Number(record.anchor);
    const focus = Number(record.focus);
    if (!Number.isSafeInteger(anchor) || anchor < 0 || !Number.isSafeInteger(focus) || focus < 0) {
      return null;
    }
    return { anchor, focus };
  }

  function applyComposerSelection(selectionState: ComposerSelectionState | null) {
    if (!promptEl || !selectionState) return;
    cancelSelectionSync();
    suppressSelectionPublishingUntil = Date.now() + 200;
    const draftLength = getPromptDraftText().length;
    const anchorPoint = locateDraftPoint(promptEl, Math.min(selectionState.anchor, draftLength));
    const focusPoint = locateDraftPoint(promptEl, Math.min(selectionState.focus, draftLength));
    const selection = windowRef.getSelection?.();
    if (!selection) return;
    applyingRemoteSelection = true;
    try {
      selection.setBaseAndExtent(
        anchorPoint.node,
        anchorPoint.offset,
        focusPoint.node,
        focusPoint.offset,
      );
    } catch {
      try {
        const range = documentRef.createRange();
        range.setStart(anchorPoint.node, anchorPoint.offset);
        range.setEnd(focusPoint.node, focusPoint.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        return;
      }
    } finally {
      applyingRemoteSelection = false;
    }
    lastSelectionSignature = `${getState().conversationMeta?.conversation_id || ''}:${selectionState.anchor}:${selectionState.focus}`;
    rememberComposerSelection(false);
  }

  function applyLocalComposerSelection(selectionState: ComposerSelectionState): boolean {
    if (!promptEl) return false;
    const draftLength = getPromptDraftText().length;
    const anchorOffset = Math.min(selectionState.anchor, draftLength);
    const focusOffset = Math.min(selectionState.focus, draftLength);
    const anchorPoint = locateDraftPoint(promptEl, anchorOffset);
    const focusPoint = locateDraftPoint(promptEl, focusOffset);
    const selection = windowRef.getSelection?.();
    if (!selection) return false;
    try {
      selection.setBaseAndExtent(
        anchorPoint.node,
        anchorPoint.offset,
        focusPoint.node,
        focusPoint.offset,
      );
    } catch {
      try {
        const range = documentRef.createRange();
        const startOffset = Math.min(anchorOffset, focusOffset);
        const endOffset = Math.max(anchorOffset, focusOffset);
        const startPoint = locateDraftPoint(promptEl, startOffset);
        const endPoint = locateDraftPoint(promptEl, endOffset);
        range.setStart(startPoint.node, startPoint.offset);
        range.setEnd(endPoint.node, endPoint.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        return false;
      }
    }
    rememberComposerSelection();
    return true;
  }

  function handleComposerAutoPairInput(event: InputEvent): 'insert' | 'delete' | 'skip' | null {
    if (!promptEl) return null;
    if (!event.cancelable || event.isComposing) {
      resetComposerAutoPairState();
      return null;
    }
    const selection = getComposerSelectionState();
    if (!selection) return null;
    const plan = planComposerAutoPairEdit(
      {
        inputType: event.inputType,
        data: typeof event.data === 'string' ? event.data : null,
      },
      getPromptDraftText(),
      selection,
      autoPairState,
      Date.now(),
    );
    autoPairState = plan.state;
    const edit = plan.edit;
    if (!edit) return null;
    event.preventDefault();
    if (edit.action !== 'skip') renderPromptFromText(edit.draft);
    applyLocalComposerSelection(edit.selection);
    return edit.action;
  }

  function applyComposerRevisions(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as JsonObject;
    const nextDraftRevision = Number(record.draft_revision);
    const nextSelectionRevision = Number(record.selection_revision);
    const nextAuthorEpoch = Number(record.author_epoch);
    if (Number.isSafeInteger(nextDraftRevision) && nextDraftRevision >= 0) {
      draftRevision = Math.max(draftRevision, nextDraftRevision);
    }
    if (Number.isSafeInteger(nextSelectionRevision) && nextSelectionRevision >= 0) {
      selectionRevision = Math.max(selectionRevision, nextSelectionRevision);
    }
    if (Number.isSafeInteger(nextAuthorEpoch) && nextAuthorEpoch >= authorEpoch) {
      authorEpoch = nextAuthorEpoch;
      authorClientId = typeof record.author_client_id === 'string' && record.author_client_id.trim()
        ? record.author_client_id.trim()
        : null;
      if (authorClientId !== composerClientId) {
        cancelSelectionSync();
      }
    }
  }

  function applyDraftUpdate(event: JsonObject) {
    if (!promptEl) return;
    const conversationId = getState().conversationMeta?.conversation_id;
    if (!conversationId || (event.conversation_id && event.conversation_id !== conversationId)) return;
    const incomingRevision = Number(event.draft_revision);
    if (Number.isSafeInteger(incomingRevision) && incomingRevision < draftRevision) return;
    const draft = event.draft;
    if (typeof draft !== 'string') return;
    const incomingHash = getDraftHash(draft);
    const sameOrigin = event.origin_client_id === composerClientId;
    const incomingSequence = Number(event.client_sequence);
    const localText = getPromptDraftText();
    const localSequenceIsNewer = (sameOrigin
      && Number.isSafeInteger(incomingSequence)
      && incomingSequence < clientSequence)
      || (sameOrigin && getState().draftDirty === true && draft !== localText);
    const rendered = draft !== localText && !localSequenceIsNewer;
    if (rendered) {
      resetComposerAutoPairState();
      renderPromptFromText(draft);
    }

    const state = getState();
    const nextMeta = state.conversationMeta ? { ...state.conversationMeta, draft } : undefined;
    if (nextMeta && Number.isSafeInteger(incomingRevision) && incomingRevision >= 0) {
      nextMeta.draft_revision = incomingRevision;
    }
    const incomingSelectionRevision = Number(event.selection_revision);
    if (nextMeta && Number.isSafeInteger(incomingSelectionRevision) && incomingSelectionRevision >= 0) {
      nextMeta.selection_revision = incomingSelectionRevision;
    }
    if (nextMeta) setState({ conversationMeta: nextMeta });
    if (!localSequenceIsNewer) {
      setState({ lastDraftHash: incomingHash, draftDirty: false });
    }
    applyComposerRevisions(event);
    const incomingSelection = parseComposerSelection(event.draft_selection);
    if (incomingSelection && (rendered || !sameOrigin) && !localSequenceIsNewer) {
      applyComposerSelection(incomingSelection);
    }
  }

  function applySelectionUpdate(event: JsonObject) {
    const conversationId = getState().conversationMeta?.conversation_id;
    if (!conversationId || (event.conversation_id && event.conversation_id !== conversationId)) return;
    const incomingRevision = Number(event.selection_revision);
    if (Number.isSafeInteger(incomingRevision) && incomingRevision < selectionRevision) return;
    applyComposerRevisions(event);
    if (event.origin_client_id === composerClientId) return;
    resetComposerAutoPairState();
    applyComposerSelection(parseComposerSelection(event.draft_selection));
  }

  function clearPrompt() {
    if (!promptEl) return;
    resetComposerAutoPairState();
    promptEl.innerHTML = '';
    clearStoredComposerSelection();
  }

  function moveCaretToEnd() {
    if (!promptEl) return;
    promptEl.focus();
    const range = documentRef.createRange();
    range.selectNodeContents(promptEl);
    range.collapse(false);
    const selection = windowRef.getSelection?.();
    selection?.removeAllRanges();
    selection?.addRange(range);
    rememberComposerSelection();
  }

  async function persistDraftNow() {
    const state = getState();
    const convoId = state.conversationMeta?.conversation_id;
    if (!convoId || !promptEl) return;
    if (state.draftSaveTimer) {
      clearTimeout(state.draftSaveTimer);
      setState({ draftSaveTimer: null });
    }
    const text = getPromptDraftText();
    const hash = getDraftHash(text);
    if (hash === state.lastDraftHash) {
      setState({ draftDirty: false });
      return;
    }
    const selection = getComposerSelectionState();
    try {
      const result = await writeDraftAsAuthor(convoId, text, selection);
      if (!result) {
        setState({ draftDirty: true });
        return;
      }
      const latestState = getState();
      if (latestState.conversationMeta && latestState.conversationMeta.conversation_id === convoId) {
        setState({ conversationMeta: { ...latestState.conversationMeta, draft: text } });
      }
      setState({ lastDraftHash: hash, draftDirty: false });
    } catch (err) {
      setState({ draftDirty: true });
      console.warn('Immediate draft save failed:', err);
    }
  }

  function queueExplicitMentionDraftSave() {
    if (getState().applyingDraft) return;
    setState({ draftDirty: true });
    if (explicitMentionSaveTimer) clearTimeout(explicitMentionSaveTimer);
    explicitMentionSaveTimer = setTimeout(() => {
      explicitMentionSaveTimer = null;
      void persistDraftNow();
    }, 0);
  }

  function saveDraftDebounced() {
    const state = getState();
    if (state.draftSaveTimer) clearTimeout(state.draftSaveTimer);
    const convoId = state.conversationMeta?.conversation_id;
    if (!convoId) return;

    const nextTimer = setTimeout(async () => {
      const currentState = getState();
      const text = getPromptDraftText();
      const hash = getDraftHash(text);
      if (hash === currentState.lastDraftHash) return;
      try {
        const selection = getComposerSelectionState();
        const result = await writeDraftAsAuthor(convoId, text, selection);
        if (!result) {
          setState({ draftDirty: true });
          return;
        }
        const latestState = getState();
        if (latestState.conversationMeta && latestState.conversationMeta.conversation_id === convoId) {
          setState({ conversationMeta: { ...latestState.conversationMeta, draft: text } });
        }
        setState({ lastDraftHash: hash, draftDirty: false });
      } catch (err) {
        setState({ draftDirty: true });
        console.warn('Draft save failed:', err);
      }
    }, 500);

    setState({ draftSaveTimer: nextTimer });
  }

  function bindComposerSelectionTracking() {
    if (!promptEl) return;
    const remember = (event: Event) => {
      rememberComposerSelection(
        event.isTrusted && hasFocusedComposer() && !selectionPublishingSuppressed(),
      );
    };
    const stopPublishing = () => cancelSelectionSync();
    documentRef.addEventListener('selectionchange', remember);
    promptEl.addEventListener('input', remember);
    promptEl.addEventListener('keyup', remember);
    promptEl.addEventListener('mouseup', remember);
    promptEl.addEventListener('focus', remember);
    mentionPillEl?.addEventListener('pointerdown', remember);
    windowRef.addEventListener('focus', remember);
    promptEl.addEventListener('blur', stopPublishing);
    windowRef.addEventListener('blur', stopPublishing);
    documentRef.addEventListener('visibilitychange', () => {
      if (documentRef.visibilityState !== 'visible') stopPublishing();
    });
  }

  function restoreDraft() {
    if (!promptEl) return;
    resetComposerAutoPairState();
    const meta = getState().conversationMeta;
    const draft = meta?.draft;
    draftRevision = Number.isSafeInteger(meta?.draft_revision) ? Number(meta?.draft_revision) : 0;
    selectionRevision = Number.isSafeInteger(meta?.selection_revision) ? Number(meta?.selection_revision) : 0;
    authorEpoch = 0;
    authorClientId = null;
    authorClaimPromise = null;
    cancelSelectionSync();
    if (typeof draft === 'string' && draft.trim()) {
      renderPromptFromText(draft);
      setState({
        draftDirty: false,
        lastDraftHash: getDraftHash(draft),
      });
      applyComposerSelection(parseComposerSelection(meta?.draft_selection));
      return;
    }
    clearPrompt();
    setState({
      draftDirty: false,
      lastDraftHash: null,
    });
  }

  function clearDraft() {
    setState({
      lastDraftHash: null,
      draftDirty: false,
    });
    const convoId = getState().conversationMeta?.conversation_id;
    if (convoId) {
      void (async () => {
        await writeDraftAsAuthor(convoId, '', { anchor: 0, focus: 0 }, true);
      })().catch(() => {});
    }
  }

  async function syncDraftFromServer(convoId: string | null | undefined) {
    if (!convoId || !promptEl) return;
    if (getState().draftDirty) return;
    try {
      const meta = await conversationsRpcClient.getConversation({ conversationId: convoId });
      if (!meta || meta.ok === false || meta.conversation_id !== convoId) return;
      const serverDraft = meta.draft;
      if (typeof serverDraft !== 'string') return;
      applyDraftUpdate(meta);
    } catch {
      // ignore
    }
  }

  function initTribute() {
    if (!promptEl || typeof Tribute === 'undefined') return;
    if (tributeInstance) {
      tributeInstance.detach(promptEl);
    }

    tributeInstance = new Tribute({
      trigger: '@',
      allowSpaces: false,
      menuShowMinLength: 1,
      noMatchTemplate: '<li class="tribute-no-match">No files found</li>',
      selectTemplate(item: TributeLookupItem | null) {
        if (!item) return '';
        const absPath = item.original.path || '';
        resetComposerAutoPairState();
        queueExplicitMentionDraftSave();
        return createMentionToken(absPath).outerHTML;
      },
      menuItemTemplate(item: TributeLookupItem) {
        const icon = item.original.type === 'directory' ? '📁' : '📄';
        const typeClass = item.original.type === 'directory' ? 'tribute-dir' : 'tribute-file';
        const cwd = getState().conversationSettings?.cwd || '';
        const originalPath = item.original.path || '';
        const relPath = getRelativePath(originalPath, cwd) || originalPath;
        const safeName = escapeHtml(item.original.name || '');
        const safePath = escapeHtml(relPath);
        return '<div class="' + typeClass + '">' +
          '<div class="tribute-item-name">' + icon + ' ' + safeName + '</div>' +
          '<div class="tribute-item-path">' + safePath + '</div>' +
          '</div>';
      },
      values: async (text: string, cb: (items: TributeItemOriginal[]) => void) => {
        if (!text || !text.trim()) {
          cb([]);
          return;
        }
        try {
          const cwd = getState().conversationSettings?.cwd || '~';
          const data = await uiRpcClient.searchFilesystem({ query: text, root: cwd, limit: 30 });
          if (!data || data.ok === false) {
            cb([]);
            return;
          }
          cb(Array.isArray(data.items) ? data.items as TributeItemOriginal[] : []);
        } catch (err) {
          console.warn('Tribute fetch error:', err);
          cb([]);
        }
      },
      lookup: 'name',
      fillAttr: 'path',
    });

    promptEl.addEventListener('tribute-active-true', () => {
      setTimeout(() => {
        const menu = documentRef.querySelector('.tribute-container ul');
        if (!(menu instanceof HTMLElement)) return;
        const items = menu.querySelectorAll<HTMLLIElement>('li');
        let lastWasDir = false;
        let firstFile: Element | null = null;
        for (const item of Array.from(items)) {
          const isDir = item.querySelector('.tribute-dir');
          if (lastWasDir && !isDir && !firstFile) {
            firstFile = item;
          }
          lastWasDir = Boolean(isDir);
        }
        const firstFileEl = firstFile;
        if (firstFileEl && !(firstFileEl.previousElementSibling instanceof HTMLElement && firstFileEl.previousElementSibling.classList.contains('tribute-separator'))) {
          const separator = documentRef.createElement('li');
          separator.className = 'tribute-separator';
          separator.innerHTML = '<hr>';
          firstFileEl.parentElement?.insertBefore(separator, firstFileEl);
        }
      }, 10);
    });

    tributeInstance.attach(promptEl);

    promptEl.addEventListener('paste', (evt: ClipboardEvent) => {
      resetComposerAutoPairState();
      evt.preventDefault();
      const clipboardData = evt.clipboardData || (windowRef as ClipboardWindow).clipboardData;
      const text = clipboardData?.getData?.('text/plain');
      if (!text) return;
      const selection = windowRef.getSelection?.();
      if (!selection || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(documentRef.createTextNode(text));
      range.collapse(false);
    });
  }

  function insertMention(path: string, opts: DraftMentionOptions = {}) {
    if (!promptEl || !path) return;
    resetComposerAutoPairState();
    const operationId = typeof opts.operationId === 'string' ? opts.operationId.trim() : '';
    if (operationId) {
      if (appliedMentionOperations.has(operationId)) return;
      appliedMentionOperations.add(operationId);
      if (appliedMentionOperations.size > 256) {
        const oldest = appliedMentionOperations.values().next().value;
        if (typeof oldest === 'string') appliedMentionOperations.delete(oldest);
      }
    }
    const token = createMentionToken(path, {
      line: opts.lineNo,
      endLine: opts.endLineNo,
      col: opts.col,
      endCol: opts.endCol,
      content: opts.content,
    });

    const insertTarget = resolveComposerInsertTarget();
    if (insertTarget) {
      const { selection, range } = insertTarget;
      range.deleteContents();
      range.insertNode(token);
      const space = documentRef.createTextNode(' ');
      range.setStartAfter(token);
      range.insertNode(space);
      range.setStartAfter(space);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      rememberComposerSelection();
    } else {
      promptEl.appendChild(token);
      promptEl.appendChild(documentRef.createTextNode(' '));
      moveCaretToEnd();
    }
    promptEl.focus();
    queueExplicitMentionDraftSave();
  }

  return {
    saveDraftDebounced,
    renderPromptFromText,
    getPromptText,
    getPromptDraftText,
    clearPrompt,
    bindComposerSelectionTracking,
    restoreDraft,
    clearDraft,
    syncDraftFromServer,
    applyDraftUpdate,
    applySelectionUpdate,
    handleComposerAutoPairInput,
    initTribute,
    insertMention,
  };
}
