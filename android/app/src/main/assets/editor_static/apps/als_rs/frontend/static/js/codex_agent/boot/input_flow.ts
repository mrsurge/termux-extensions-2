import {
  TRANSCRIPT_PROJECTION_EDGE_RUNWAY_MIN_PX,
  TRANSCRIPT_PROJECTION_EDGE_RUNWAY_VIEWPORTS,
  TRANSCRIPT_PROJECTION_REARM_CARDS,
  TRANSCRIPT_PROJECTION_REARM_MIN_PX,
  TRANSCRIPT_PROJECTION_REARM_VIEWPORTS,
  TRANSCRIPT_PROJECTION_TAIL_RUNWAY_MIN_PX,
  TRANSCRIPT_PROJECTION_TAIL_RUNWAY_VIEWPORTS,
  TRANSCRIPT_PROJECTION_TRIGGER_CARDS,
} from '../transcript_config.ts';
import { createConversationsRpcClient } from '../rpc/conversations/client.ts';
import type { TranscriptProjectionViewportMetrics } from '../timeline/virtualizer.ts';

const INTERRUPT_ARM_TIMEOUT_MS = 10_000;

type TextValueElement = HTMLElement & { value: string };

type ConversationSettingsState = {
  cwd?: string | null;
  markdown?: boolean;
  trackEdits?: boolean;
  lineNumbers?: boolean;
  [key: string]: unknown;
};

type ConversationMetaState = {
  conversation_id?: string | null;
};

function scopedConversationId(state: InputFlowState): string | null {
  const clientConversationId = typeof state.clientConversationId === 'string' && state.clientConversationId.trim()
    ? state.clientConversationId.trim()
    : null;
  const metaConversationId = typeof state.conversationMeta?.conversation_id === 'string' && state.conversationMeta.conversation_id.trim()
    ? state.conversationMeta.conversation_id.trim()
    : null;
  return clientConversationId || metaConversationId;
}

type InputFlowState = {
  isMobile?: boolean;
  clientConversationId?: string | null;
  applyingDraft?: boolean;
  draftDirty?: boolean;
  transcriptLoading?: boolean;
  transcriptStart?: number;
  transcriptEnd?: number;
  transcriptAtStart?: boolean;
  transcriptAtTail?: boolean;
  transcriptHistoryMode?: boolean;
  scrollProgrammatic?: boolean;
  autoScroll?: boolean;
  conversationSettings?: ConversationSettingsState | null;
  conversationMeta?: ConversationMetaState | null;
};

type InputFlowElements = {
  sendBtn?: HTMLElement | null;
  promptEl?: HTMLElement | null;
  mentionPillEl?: HTMLElement | null;
  hostCloseTopEl?: HTMLElement | null;
  hostCloseDrawerEl?: HTMLElement | null;
  contextRemainingEl?: HTMLElement | null;
  interruptBtn?: HTMLElement | null;
  scrollContainer?: HTMLElement | null;
  scrollBtn?: HTMLElement | null;
  timelineEl?: HTMLElement | null;
  markdownToggleEl?: HTMLInputElement | null;
  trackEditsToggleEl?: HTMLInputElement | null;
  lineNumbersToggleEl?: HTMLInputElement | null;
  settingsCwdEl?: TextValueElement | null;
};

type WarningModalConfig = {
  title: string;
  body: string;
  confirmText: string;
  onConfirm: () => Promise<void>;
};

type CodexAgentWindow = Window & {
  CodexAgent?: {
    helpers?: {
      openWarningModal?: (config: WarningModalConfig) => void;
    };
  };
};

interface InputFlowContext {
  getState: () => InputFlowState;
  setState: (patch: Partial<InputFlowState>) => void;
  elements: InputFlowElements;
  sendShellCommand: (command: string) => Promise<unknown>;
  sendUserMessage: (text: string) => Promise<unknown>;
  getPromptText: () => string;
  clearPrompt: () => void;
  clearDraft: () => void;
  saveDraftDebounced: () => void;
  handleComposerAutoPairInput: (event: InputEvent) => 'insert' | 'delete' | 'skip' | null;
  openPicker: (startPath: string, mode: string) => void;
  sendHostCloseMessage: () => void;
  bindSplashTabHandlers: () => void;
  initTribute: () => void;
  requestContextCompact: () => Promise<unknown>;
  interruptTurn: () => Promise<unknown>;
  updateScrollButton: () => void;
  maybeAutoScroll: (force?: boolean) => void;
  isNearBottom: () => boolean;
  loadOlderTranscript: () => Promise<boolean>;
  loadNewerTranscript: () => Promise<boolean>;
  getTranscriptProjectionMetrics: () => TranscriptProjectionViewportMetrics;
  snapTranscriptToLive?: () => Promise<unknown>;
  fetchConversation: (conversationId: string) => Promise<unknown>;
  restorePendingApprovals: () => void;
  refreshPlanSurface?: () => Promise<unknown> | unknown;
  postTe2OpenRequest: (target: { path: string; line: number; column: number }) => void;
  setMarkdownEnabled: (enabled: boolean) => void;
  setTrackEditsEnabled: (enabled: boolean) => void;
  resetTimeline: () => void;
  replayTranscript: () => Promise<unknown>;
  sioCall: (event: string, payload?: Record<string, unknown>) => Promise<unknown>;
  documentRef: Document;
  windowRef: CodexAgentWindow;
}

export function bindInputFlow(ctx: InputFlowContext) {
  const {
    getState,
    setState,
    elements,
    sendShellCommand,
    sendUserMessage,
    getPromptText,
    clearPrompt,
    clearDraft,
    saveDraftDebounced,
    handleComposerAutoPairInput,
    openPicker,
    sendHostCloseMessage,
    bindSplashTabHandlers,
    initTribute,
    requestContextCompact,
    interruptTurn,
    updateScrollButton,
    maybeAutoScroll,
    isNearBottom,
    loadOlderTranscript,
    loadNewerTranscript,
    getTranscriptProjectionMetrics,
    snapTranscriptToLive,
    fetchConversation,
    restorePendingApprovals,
    refreshPlanSurface,
    postTe2OpenRequest,
    setMarkdownEnabled,
    setTrackEditsEnabled,
    resetTimeline,
    replayTranscript,
    sioCall,
    documentRef,
    windowRef,
  } = ctx;
  let lastProjectionScrollTop = elements.scrollContainer?.scrollTop || 0;
  let projectionScrollDirection = 0;
  let projectionShiftInFlight = false;
  let olderProjectionArmed = true;
  let newerProjectionArmed = true;
  const conversationsRpcClient = createConversationsRpcClient({
    windowRef,
  });
  let interruptArmed = false;
  let interruptArmTimeout: number | null = null;

  const {
    sendBtn,
    promptEl,
    mentionPillEl,
    hostCloseTopEl,
    hostCloseDrawerEl,
    contextRemainingEl,
    interruptBtn,
    scrollContainer,
    scrollBtn,
    timelineEl,
    markdownToggleEl,
    trackEditsToggleEl,
    lineNumbersToggleEl,
    settingsCwdEl,
  } = elements;

  async function dispatchInput(text: string) {
    if (text.startsWith('!')) {
      await sendShellCommand(text.slice(1).trim());
    } else {
      await sendUserMessage(text);
    }
  }

  function restorePromptFocus(): void {
    promptEl?.focus({ preventScroll: true });
  }

  async function submitPrompt(): Promise<void> {
    const text = getPromptText().trim();
    if (!text) return;
    clearPrompt();
    clearDraft();
    restorePromptFocus();
    await dispatchInput(text);
  }

  async function handlePromptKeydown(evt: KeyboardEvent) {
    if (evt.key === 'Enter' && !evt.shiftKey) {
      if (getState().isMobile) return;
      evt.preventDefault();
      await submitPrompt();
      return;
    }
    if (evt.key === 'Enter' && evt.shiftKey) {
      evt.preventDefault();
      documentRef.execCommand('insertLineBreak');
    }
  }

  function handlePromptInput() {
    const state = getState();
    if (!state.applyingDraft) {
      setState({ draftDirty: true });
      saveDraftDebounced();
    }
  }

  function handlePromptBeforeInput(evt: InputEvent) {
    const action = handleComposerAutoPairInput(evt);
    if (action === 'insert' || action === 'delete') handlePromptInput();
  }

  function handlePromptClick(evt: MouseEvent) {
    const target = evt.target;
    if (!(target instanceof HTMLElement)) return;
    const state = getState();
    const removeBtn = target.closest('.mention-token-remove');
    if (removeBtn instanceof HTMLElement) {
      const token = removeBtn.closest('.mention-token');
      if (!(token instanceof HTMLElement)) return;
      evt.preventDefault();
      evt.stopPropagation();
      const next = token.nextSibling;
      const prev = token.previousSibling;
      token.remove();
      if (!state.applyingDraft) {
        setState({ draftDirty: true });
        saveDraftDebounced();
      }
      if (promptEl) {
        promptEl.focus();
        const selection = windowRef.getSelection?.();
        if (selection) {
          const range = documentRef.createRange();
          if (next && promptEl.contains(next)) {
            range.setStartBefore(next);
          } else if (prev && promptEl.contains(prev)) {
            range.setStartAfter(prev);
          } else {
            range.selectNodeContents(promptEl);
          }
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      return;
    }
    const mention = target.closest('.mention-token');
    if (mention instanceof HTMLElement) {
      const path = mention.dataset.path || mention.title || mention.textContent || '';
      console.log('Mention path:', path);
    }
  }

  function runProjectionShift(direction: 'older' | 'newer'): void {
    if (projectionShiftInFlight) return;
    projectionShiftInFlight = true;
    olderProjectionArmed = false;
    newerProjectionArmed = false;
    projectionScrollDirection = 0;
    const shift = direction === 'older' ? loadOlderTranscript : loadNewerTranscript;
    void shift().finally(() => {
      projectionShiftInFlight = false;
      projectionScrollDirection = 0;
      lastProjectionScrollTop = scrollContainer?.scrollTop || 0;
    });
  }

  function handleScroll() {
    const state = getState();
    if (!scrollContainer) return;
    const nextScrollTop = scrollContainer.scrollTop;
    const scrollDelta = nextScrollTop - lastProjectionScrollTop;
    lastProjectionScrollTop = nextScrollTop;
    if (!state.scrollProgrammatic && !projectionShiftInFlight && Math.abs(scrollDelta) >= 0.5) {
      projectionScrollDirection = Math.sign(scrollDelta);
    }
    const projectionMetrics = getTranscriptProjectionMetrics();
    const visibleRange = projectionMetrics.visible;
    const transcriptStart = Math.max(0, Number(state.transcriptStart) || 0);
    const transcriptEnd = Math.max(transcriptStart, Number(state.transcriptEnd) || 0);
    const olderDistance = visibleRange
      ? Math.max(0, visibleRange.first - transcriptStart)
      : Number.POSITIVE_INFINITY;
    const newerDistance = visibleRange
      ? Math.max(0, Math.max(transcriptStart, transcriptEnd - 1) - visibleRange.last)
      : Number.POSITIVE_INFINITY;
    const viewportHeight = Math.max(1, scrollContainer.clientHeight);
    const edgeRunwayPx = Math.max(
      TRANSCRIPT_PROJECTION_EDGE_RUNWAY_MIN_PX,
      viewportHeight * TRANSCRIPT_PROJECTION_EDGE_RUNWAY_VIEWPORTS,
    );
    const rearmRunwayPx = Math.max(
      TRANSCRIPT_PROJECTION_REARM_MIN_PX,
      viewportHeight * TRANSCRIPT_PROJECTION_REARM_VIEWPORTS,
    );
    const tailRunwayPx = Math.max(
      TRANSCRIPT_PROJECTION_TAIL_RUNWAY_MIN_PX,
      viewportHeight * TRANSCRIPT_PROJECTION_TAIL_RUNWAY_VIEWPORTS,
    );
    const distanceFromBottom = Math.max(
      0,
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight,
    );
    const distanceToStartPx = projectionMetrics.distanceToStartPx ?? Number.POSITIVE_INFINITY;
    const distanceToEndPx = projectionMetrics.distanceToEndPx ?? Number.POSITIVE_INFINITY;
    if (
      olderDistance >= TRANSCRIPT_PROJECTION_REARM_CARDS
      || distanceToStartPx >= rearmRunwayPx
    ) {
      olderProjectionArmed = true;
    }
    if (
      newerDistance >= TRANSCRIPT_PROJECTION_REARM_CARDS
      || distanceToEndPx >= rearmRunwayPx
    ) {
      newerProjectionArmed = true;
    }
    const hasOlderProjection = state.transcriptAtStart === false;
    const hasNewerProjection = state.transcriptAtTail === false;
    const outsideLiveTailRunway = state.transcriptAtTail === false
      || distanceFromBottom >= tailRunwayPx;
    if (
      !state.transcriptLoading
      && !state.scrollProgrammatic
      && !state.autoScroll
      && !projectionShiftInFlight
    ) {
      if (
        hasOlderProjection
        && olderProjectionArmed
        && projectionScrollDirection < 0
        && olderDistance <= TRANSCRIPT_PROJECTION_TRIGGER_CARDS
        && distanceToStartPx <= edgeRunwayPx
        && outsideLiveTailRunway
      ) {
        runProjectionShift('older');
      } else if (
        hasNewerProjection
        && newerProjectionArmed
        && projectionScrollDirection > 0
        && newerDistance <= TRANSCRIPT_PROJECTION_TRIGGER_CARDS
        && distanceToEndPx <= edgeRunwayPx
      ) {
        runProjectionShift('newer');
      }
    }
    if (!state.scrollProgrammatic && state.autoScroll && !isNearBottom()) {
      setState({
        autoScroll: false,
        transcriptHistoryMode: true,
      });
      updateScrollButton();
    }
    if (
      !state.transcriptLoading
      && !state.scrollProgrammatic
      && !state.autoScroll
      && !hasNewerProjection
      && isNearBottom()
    ) {
      repinTranscript();
    }
  }

  function repinTranscript() {
    setState({ autoScroll: true });
    updateScrollButton();
    maybeAutoScroll(true);
    if (typeof snapTranscriptToLive === 'function') {
      void snapTranscriptToLive()
        .then(() => {
          maybeAutoScroll(true);
        })
        .catch((error) => {
          console.warn('failed to repin transcript', error);
          setState({
            autoScroll: false,
            transcriptHistoryMode: true,
          });
          updateScrollButton();
        });
      return;
    }
    maybeAutoScroll(true);
  }

  function handleScrollToggle() {
    const state = getState();
    const nextAutoScroll = !(state.autoScroll === true);
    if (!nextAutoScroll) {
      setState({
        autoScroll: false,
        transcriptHistoryMode: true,
      });
      updateScrollButton();
      return;
    }
    repinTranscript();
  }

  function handleResize() {
    if (getState().autoScroll) maybeAutoScroll(true);
  }

  function handleDiffClick(evt: MouseEvent) {
    const target = evt.target;
    if (!(target instanceof HTMLElement)) return;
    const lineEl = target.closest('.diff-line');
    if (!(lineEl instanceof HTMLElement)) return;
    const path = lineEl.getAttribute('data-path') || '';
    const newLine = lineEl.getAttribute('data-new-line') || '';
    const oldLine = lineEl.getAttribute('data-old-line') || '';
    const line = parseInt(newLine || oldLine, 10);
    if (!path || !Number.isFinite(line) || line <= 0) return;
    try {
      lineEl.classList.add('tap-flash');
      setTimeout(() => lineEl.classList.remove('tap-flash'), 180);
    } catch {}
    postTe2OpenRequest({ path, line, column: 1 });
  }

  async function handleMarkdownToggle() {
    const state = getState();
    const enabled = markdownToggleEl?.checked === true;
    setMarkdownEnabled(enabled);
    if (state.conversationSettings && typeof state.conversationSettings === 'object') {
      state.conversationSettings.markdown = enabled;
    }
    const conversationId = scopedConversationId(state);
    if (conversationId) {
      await conversationsRpcClient.updateConversation({
        conversationId,
        settings: { ...state.conversationSettings, markdown: enabled },
      });
      await fetchConversation(conversationId);
    }
    resetTimeline();
    await replayTranscript();
    await refreshPlanSurface?.();
    restorePendingApprovals();
  }

  async function handleTrackEditsToggle() {
    const state = getState();
    const enabled = trackEditsToggleEl?.checked === true;
    setTrackEditsEnabled(enabled);
    if (state.conversationSettings && typeof state.conversationSettings === 'object') {
      state.conversationSettings.trackEdits = enabled;
    }
    const conversationId = scopedConversationId(state);
    if (conversationId) {
      await conversationsRpcClient.updateConversation({
        conversationId,
        settings: { ...state.conversationSettings, trackEdits: enabled },
      });
    }
  }

  async function handleLineNumbersToggle() {
    const state = getState();
    const enabled = lineNumbersToggleEl?.checked === true;
    if (state.conversationSettings && typeof state.conversationSettings === 'object') {
      state.conversationSettings.lineNumbers = enabled;
    }
    const conversationId = scopedConversationId(state);
    if (conversationId) {
      await conversationsRpcClient.updateConversation({
        conversationId,
        settings: { ...state.conversationSettings, lineNumbers: enabled },
      });
      await fetchConversation(conversationId);
    }
    resetTimeline();
    await replayTranscript();
    await refreshPlanSurface?.();
    restorePendingApprovals();
  }

  function clearInterruptArmTimeout() {
    if (interruptArmTimeout === null) return;
    windowRef.clearTimeout(interruptArmTimeout);
    interruptArmTimeout = null;
  }

  function renderInterruptArmState() {
    if (!interruptBtn) return;
    interruptBtn.classList.remove('danger');
    interruptBtn.classList.add('interrupt-safe');
    interruptBtn.classList.toggle('interrupt-armed', interruptArmed);
    interruptBtn.setAttribute('aria-pressed', interruptArmed ? 'true' : 'false');
    interruptBtn.title = interruptArmed
      ? 'Click again within 10 seconds to interrupt'
      : 'Click once to arm interrupt';
  }

  function resetInterruptArm() {
    interruptArmed = false;
    clearInterruptArmTimeout();
    renderInterruptArmState();
  }

  function armInterrupt() {
    interruptArmed = true;
    clearInterruptArmTimeout();
    renderInterruptArmState();
    interruptArmTimeout = windowRef.setTimeout(resetInterruptArm, INTERRUPT_ARM_TIMEOUT_MS);
  }

  async function handleInterruptClick() {
    if (!interruptArmed) {
      armInterrupt();
      return;
    }
    resetInterruptArm();
    await interruptTurn();
  }

  function syncMarkdownFromSettings() {
    const enabled = getState().conversationSettings?.markdown !== false;
    setMarkdownEnabled(enabled);
  }

  function bindInputHandlers() {
    sendBtn?.addEventListener('pointerdown', (evt) => {
      evt.preventDefault();
    });
    sendBtn?.addEventListener('click', async () => {
      await submitPrompt();
    });

    promptEl?.addEventListener('keydown', handlePromptKeydown);
    promptEl?.addEventListener('beforeinput', handlePromptBeforeInput);
    promptEl?.addEventListener('input', handlePromptInput);
    promptEl?.addEventListener('click', handlePromptClick);

    mentionPillEl?.addEventListener('click', () => {
      const startPath = getState().conversationSettings?.cwd || settingsCwdEl?.value || '~';
      openPicker(startPath, 'mention');
    });

    hostCloseTopEl?.addEventListener('click', () => {
      sendHostCloseMessage();
    });
    hostCloseDrawerEl?.addEventListener('click', () => {
      sendHostCloseMessage();
    });

    bindSplashTabHandlers();
    initTribute();

    contextRemainingEl?.addEventListener('click', () => {
      if (windowRef.CodexAgent?.helpers?.openWarningModal) {
        windowRef.CodexAgent.helpers.openWarningModal({
          title: 'Compact context?',
          body: 'This will summarize the current conversation history to save context window.',
          confirmText: 'Compact',
          onConfirm: async () => {
            await requestContextCompact();
          },
        });
      }
    });

    renderInterruptArmState();
    interruptBtn?.addEventListener('click', handleInterruptClick);

    scrollContainer?.addEventListener('scroll', handleScroll);
    scrollBtn?.addEventListener('click', handleScrollToggle);
    windowRef.addEventListener('resize', handleResize);
    timelineEl?.addEventListener('click', handleDiffClick);
    markdownToggleEl?.addEventListener('change', handleMarkdownToggle);
    trackEditsToggleEl?.addEventListener('change', handleTrackEditsToggle);
    lineNumbersToggleEl?.addEventListener('change', handleLineNumbersToggle);
  }

  return {
    dispatchInput,
    bindInputHandlers,
    syncMarkdownFromSettings,
  };
}
