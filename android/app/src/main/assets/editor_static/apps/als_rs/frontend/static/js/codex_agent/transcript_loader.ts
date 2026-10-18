import {
  createConversationsRpcClient,
  createConversationsRpcClientPlaceholder,
} from './rpc/conversations/client.ts';
import {
  type TranscriptAnchor,
} from './transcript_card_metadata.ts';
import type {
  JsonObject,
  ReplayChunkResult,
  TranscriptCardRecipe,
  TranscriptProjectionAction,
  TurnProjectionSnapshot,
} from './rpc/conversations/contract.ts';
import { TRANSCRIPT_CARD_SHIFT } from './transcript_config.ts';

const _conversationsReplayRpcPlaceholder = createConversationsRpcClientPlaceholder;
void _conversationsReplayRpcPlaceholder;

interface TranscriptLoaderState {
  transcriptLoading?: boolean;
  transcriptStart: number;
  transcriptLimit: number;
  transcriptTotal: number;
  transcriptEnd: number;
  transcriptAtStart?: boolean;
  transcriptAtTail?: boolean;
  transcriptGeneration?: number;
  transcriptHistoryMode?: boolean;
}

interface TranscriptRangeResponse {
  conversation_id: string | null;
  total: number;
  start: number;
  end: number;
  cards: TranscriptCardRecipe[];
  runtimeState: JsonObject[];
  atStart: boolean;
  atTail: boolean;
  liveProjection: TurnProjectionSnapshot;
}

interface TranscriptLoaderContext {
  getConversationId?(): string | null | undefined;
  sioCall(event: string, payload?: Record<string, unknown>): Promise<unknown>;
  projectionClient?: TranscriptProjectionClient;
  getTranscriptState(): TranscriptLoaderState;
  isPinned(): boolean;
  getVisibleCardIndex?(): number | null;
  setTranscriptState(patch: Partial<TranscriptLoaderState>): void;
  renderTranscriptCards(cards: TranscriptCardRecipe[], options: { prepend: boolean }): void;
  applyTranscriptRuntimeState(items: JsonObject[]): void;
  renderLiveProjection?(projection: TurnProjectionSnapshot): void;
  prepareTranscriptWindow?(): void;
  prepareTranscriptProjection?(): void;
  timelineEl?: HTMLElement | null;
  scrollContainer?: HTMLElement | null;
  setScrollProgrammatic(value: boolean): void;
  isSemanticShellRibbonEnabled(): boolean;
  ensureTreeSitterRibbonReady(): Promise<unknown>;
  maybeAutoScroll(force?: boolean): void;
  setLastEventType?(value: string | null): void;
  refreshPlanSurface?(): Promise<unknown> | unknown;
  refreshRuntimeSurface?(): Promise<unknown> | unknown;
  restorePendingApprovals?(): void;
  onLiveProjectionRestored?(): void;
  captureVirtualAnchor?(edge: 'start' | 'end'): TranscriptAnchor | null;
  restoreVirtualAnchor?(anchor: TranscriptAnchor | null): void;
}

interface TranscriptProjectionClient {
  fetchReplayProjection(options: {
    conversationId?: string | null;
    action: TranscriptProjectionAction;
    windowCards: number;
    shiftCards: number;
    maxBytes?: number;
    timeoutMs?: number;
    startCard?: number;
  }): Promise<ReplayChunkResult>;
  clearProjectionCache?(preservePosition?: boolean): void;
}

export function bindTranscriptLoader(ctx: TranscriptLoaderContext) {
  const {
    getConversationId,
    sioCall,
    projectionClient,
    getTranscriptState,
    isPinned,
    getVisibleCardIndex,
    setTranscriptState,
    renderTranscriptCards,
    applyTranscriptRuntimeState,
    renderLiveProjection,
    prepareTranscriptWindow,
    prepareTranscriptProjection,
    timelineEl,
    scrollContainer,
    setScrollProgrammatic,
    isSemanticShellRibbonEnabled,
    ensureTreeSitterRibbonReady,
    maybeAutoScroll,
    setLastEventType,
    refreshPlanSurface,
    refreshRuntimeSurface,
    restorePendingApprovals,
    onLiveProjectionRestored,
    captureVirtualAnchor,
    restoreVirtualAnchor,
  } = ctx;
  const conversationsRpcClient: TranscriptProjectionClient = projectionClient ?? createConversationsRpcClient({ sioCall });

  function nextAnimationFrame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  function isStaleTranscriptResponse(
    expectedConversationId: string | null,
    expectedGeneration: number,
    responseConversationId: string | null,
  ): boolean {
    const currentGeneration = Number(getTranscriptState().transcriptGeneration) || 0;
    if (currentGeneration !== expectedGeneration) {
      return true;
    }
    const activeConversationId = getConversationId?.() || null;
    if (expectedConversationId && activeConversationId && expectedConversationId !== activeConversationId) {
      return true;
    }
    if (expectedConversationId && responseConversationId && expectedConversationId !== responseConversationId) {
      return true;
    }
    return false;
  }

  function captureTranscriptAnchor(edge: 'start' | 'end'): TranscriptAnchor | null {
    if (captureVirtualAnchor) {
      return captureVirtualAnchor(edge);
    }
    if (!scrollContainer || !timelineEl) {
      return null;
    }
    const containerRect = scrollContainer.getBoundingClientRect();
    const rows = Array.from(
      timelineEl.querySelectorAll<HTMLElement>('[data-transcript-card-id]'),
    );
    let bestRow: HTMLElement | null = null;
    let bestOffset = 0;
    if (edge === 'start') {
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const row of rows) {
        if (!row.dataset.transcriptCardId) continue;
        const rect = row.getBoundingClientRect();
        if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) continue;
        const offsetPx = rect.top - containerRect.top;
        const distance = offsetPx >= 0 ? offsetPx : Math.abs(offsetPx) + containerRect.height;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestRow = row;
          bestOffset = Math.max(0, offsetPx);
        }
      }
    } else {
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const row of rows) {
        if (!row.dataset.transcriptCardId) continue;
        const rect = row.getBoundingClientRect();
        if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) continue;
        const offsetPx = containerRect.bottom - rect.bottom;
        const distance = offsetPx >= 0 ? offsetPx : Math.abs(offsetPx) + containerRect.height;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestRow = row;
          bestOffset = Math.max(0, offsetPx);
        }
      }
    }
    const cardId = bestRow?.dataset.transcriptCardId || '';
    if (!cardId) {
      return null;
    }
    return {
      cardId,
      edge,
      offsetPx: bestOffset,
    };
  }

  function restoreTranscriptAnchor(anchor: TranscriptAnchor | null): void {
    if (restoreVirtualAnchor) {
      restoreVirtualAnchor(anchor);
      return;
    }
    if (!anchor || !scrollContainer || !timelineEl) {
      return;
    }
    const anchorRow = Array.from(
      timelineEl.querySelectorAll<HTMLElement>('[data-transcript-card-id]'),
    ).find((row) => row.dataset.transcriptCardId === anchor.cardId);
    if (!(anchorRow instanceof HTMLElement)) {
      return;
    }
    const containerRect = scrollContainer.getBoundingClientRect();
    const rowRect = anchorRow.getBoundingClientRect();
    const delta = anchor.edge === 'start'
      ? (rowRect.top - containerRect.top) - anchor.offsetPx
      : anchor.offsetPx - (containerRect.bottom - rowRect.bottom);
    setScrollProgrammatic(true);
    scrollContainer.scrollTop += delta;
    requestAnimationFrame(() => {
      setScrollProgrammatic(false);
    });
  }

  async function replaceTranscriptWindow(
    cards: TranscriptCardRecipe[],
    runtimeState: JsonObject[],
    nextState: {
      total: number;
      start: number;
      end: number;
      atStart: boolean;
      atTail: boolean;
    },
    anchor: TranscriptAnchor | null,
    options: {
      historyMode?: boolean;
      preserveRuntimeSurface?: boolean;
      liveProjection?: TurnProjectionSnapshot;
      followTail?: boolean;
    } = {},
  ): Promise<void> {
    setScrollProgrammatic(true);
    try {
      if (options.preserveRuntimeSurface) {
        prepareTranscriptProjection?.();
      } else {
        prepareTranscriptWindow?.();
      }
      setTranscriptState({
        transcriptTotal: nextState.total,
        transcriptStart: nextState.start,
        transcriptEnd: nextState.end,
        transcriptAtStart: nextState.atStart,
        transcriptAtTail: nextState.atTail,
        transcriptHistoryMode: options.historyMode === true,
      });
      renderTranscriptCards(cards, { prepend: false });
      applyTranscriptRuntimeState(runtimeState);
      restorePendingApprovals?.();
      if (options.historyMode !== true) {
        if (options.liveProjection) {
          renderLiveProjection?.(options.liveProjection);
        }
        onLiveProjectionRestored?.();
      }
      await nextAnimationFrame();
      restoreTranscriptAnchor(anchor);
      if (options.followTail && isPinned()) maybeAutoScroll(true);
      await nextAnimationFrame();
      await nextAnimationFrame();
    } finally {
      setScrollProgrammatic(false);
    }
  }

  async function loadLatestTranscriptWindow(
    requestConversationId: string | null,
    requestGeneration: number,
    options: { resetLastEventType?: boolean } = {},
  ): Promise<boolean> {
    const resetLastEventType = options.resetLastEventType === true;
    const { transcriptLimit } = getTranscriptState();
    const data = await fetchTranscriptProjection('tail', transcriptLimit);
    if (isStaleTranscriptResponse(requestConversationId, requestGeneration, data.conversation_id)) {
      return false;
    }
    if (!data || !Array.isArray(data.cards)) {
      return false;
    }
    await replaceTranscriptWindow(
      data.cards,
      data.runtimeState,
      {
        total: data.total || 0,
        start: data.start,
        end: data.end,
        atStart: data.atStart,
        atTail: data.atTail,
      },
      null,
      {
        liveProjection: data.liveProjection,
      },
    );
    if (refreshPlanSurface) {
      await refreshPlanSurface();
    }
    if (resetLastEventType && setLastEventType) {
      setLastEventType(null);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => maybeAutoScroll(true));
    });
    return true;
  }

  async function fetchTranscriptProjection(
    action: 'tail' | 'older' | 'newer' | 'current',
    windowSize: number,
    startCard?: number,
  ): Promise<TranscriptRangeResponse> {
    const convoId = getConversationId?.() || null;
    const replay = await conversationsRpcClient.fetchReplayProjection({
      conversationId: convoId,
      action,
      windowCards: windowSize,
      shiftCards: TRANSCRIPT_CARD_SHIFT,
      startCard,
    });
    if (!replay.projection || replay.frame.format !== 'card_recipes') {
      throw new Error('Transcript projection response is not card-based');
    }
    return {
      conversation_id: replay.conversation_id,
      total: replay.projection.total_cards,
      start: replay.projection.start_card,
      end: replay.projection.end_card,
      cards: replay.cards,
      runtimeState: replay.runtime_state,
      atStart: replay.projection.at_start,
      atTail: replay.projection.at_tail,
      liveProjection: replay.live_projection,
    };
  }

  async function shiftTranscriptProjection(direction: 'older' | 'newer'): Promise<boolean> {
    const state = getTranscriptState();
    if (state.transcriptLoading) return false;
    const windowSize = Math.max(1, Number(state.transcriptLimit) || 0);
    const total = Math.max(0, Number(state.transcriptTotal) || 0);
    const currentStart = Math.max(0, Number(state.transcriptStart) || 0);

    const requestConversationId = getConversationId?.() || null;
    const requestGeneration = Number(state.transcriptGeneration) || 0;
    setTranscriptState({ transcriptLoading: true });
    try {
      const data = await fetchTranscriptProjection(direction, windowSize);
      if (isStaleTranscriptResponse(requestConversationId, requestGeneration, data.conversation_id)) {
        return false;
      }
      if (data && Array.isArray(data.cards)) {
        const transcriptStart = data.start;
        if (transcriptStart === currentStart && (data.total || total) === total) {
          return false;
        }
        const anchor = captureTranscriptAnchor(direction === 'older' ? 'start' : 'end');
        await replaceTranscriptWindow(
          data.cards,
          data.runtimeState,
          {
            total: Math.max(data.total || 0, total),
            start: transcriptStart,
            end: data.end,
            atStart: data.atStart,
            atTail: data.atTail,
          },
          anchor,
          {
            historyMode: !data.atTail,
            preserveRuntimeSurface: true,
            liveProjection: data.atTail ? data.liveProjection : undefined,
          },
        );
        if (refreshRuntimeSurface) {
          void Promise.resolve(refreshRuntimeSurface()).catch((error: unknown) => {
            console.warn('failed to refresh runtime surface after transcript projection shift', error);
          });
        } else if (refreshPlanSurface) {
          void Promise.resolve(refreshPlanSurface()).catch((error: unknown) => {
            console.warn('failed to refresh plan surface after transcript projection shift', error);
          });
        }
        return true;
      }
      return false;
    } catch (error) {
      console.warn('failed to shift transcript projection', {
        conversation_id: requestConversationId,
        direction,
        error,
      });
      return false;
    } finally {
      if ((Number(getTranscriptState().transcriptGeneration) || 0) === requestGeneration) {
        setTranscriptState({ transcriptLoading: false });
      }
    }
  }

  async function loadOlderTranscript(): Promise<boolean> {
    return shiftTranscriptProjection('older');
  }

  async function loadNewerTranscript(): Promise<boolean> {
    return shiftTranscriptProjection('newer');
  }

  async function collapseTranscriptToPinned(): Promise<boolean> {
    let state = getTranscriptState();
    const waitDeadline = Date.now() + 12000;
    while (state.transcriptLoading && Date.now() < waitDeadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
      state = getTranscriptState();
    }
    if (state.transcriptLoading) return false;
    const requestConversationId = getConversationId?.() || null;
    const requestGeneration = Number(state.transcriptGeneration) || 0;
    setTranscriptState({ transcriptLoading: true });
    try {
      return await loadLatestTranscriptWindow(requestConversationId, requestGeneration);
    } finally {
      if ((Number(getTranscriptState().transcriptGeneration) || 0) === requestGeneration) {
        setTranscriptState({ transcriptLoading: false });
      }
    }
  }

  async function refreshCurrentTranscriptProjection(): Promise<boolean> {
    let state = getTranscriptState();
    const initialConversationId = getConversationId?.() || null;
    const initialGeneration = Number(state.transcriptGeneration) || 0;
    const waitDeadline = Date.now() + 12000;
    while (state.transcriptLoading && Date.now() < waitDeadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
      state = getTranscriptState();
    }
    if (state.transcriptLoading) return false;
    if (isStaleTranscriptResponse(initialConversationId, initialGeneration, initialConversationId)) return false;
    const requestConversationId = getConversationId?.() || null;
    if (!requestConversationId) return false;
    const requestGeneration = Number(state.transcriptGeneration) || 0;
    const wasPinned = isPinned();
    const visibleIndex = getVisibleCardIndex?.();
    const startCard = typeof visibleIndex === 'number'
      && (visibleIndex < state.transcriptStart || visibleIndex >= state.transcriptEnd)
      ? Math.max(0, visibleIndex - TRANSCRIPT_CARD_SHIFT)
      : state.transcriptStart;
    setTranscriptState({ transcriptLoading: true });
    try {
      conversationsRpcClient.clearProjectionCache?.(true);
      const data = await fetchTranscriptProjection(
        wasPinned ? 'tail' : 'current',
        Math.max(1, Number(state.transcriptLimit) || 0),
        wasPinned ? undefined : startCard,
      );
      if (isStaleTranscriptResponse(requestConversationId, requestGeneration, data.conversation_id)) {
        return false;
      }
      if (isPinned() !== wasPinned) return false;
      const currentVisibleIndex = getVisibleCardIndex?.();
      if (!wasPinned && typeof currentVisibleIndex === 'number'
        && currentVisibleIndex < data.total
        && (currentVisibleIndex < data.start || currentVisibleIndex >= data.end)) return false;
      // Capture after the request so scrolling during network latency is preserved.
      const anchor = wasPinned ? null : captureTranscriptAnchor('start');
      await replaceTranscriptWindow(
        data.cards,
        data.runtimeState,
        {
          total: data.total,
          start: data.start,
          end: data.end,
          atStart: data.atStart,
          atTail: data.atTail,
        },
        anchor,
        {
          historyMode: !data.atTail,
          preserveRuntimeSurface: true,
          liveProjection: data.atTail ? data.liveProjection : undefined,
          followTail: wasPinned,
        },
      );
      if (wasPinned && data.atTail) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (isPinned() && !isStaleTranscriptResponse(requestConversationId, requestGeneration, data.conversation_id)) {
              maybeAutoScroll(true);
            }
          });
        });
      }
      return true;
    } finally {
      if ((Number(getTranscriptState().transcriptGeneration) || 0) === requestGeneration) {
        setTranscriptState({ transcriptLoading: false });
      }
    }
  }

  async function replayTranscript() {
    try {
      const requestConversationId = getConversationId?.() || null;
      const requestGeneration = Number(getTranscriptState().transcriptGeneration) || 0;
      if (isSemanticShellRibbonEnabled()) {
        await ensureTreeSitterRibbonReady();
      }
      await loadLatestTranscriptWindow(requestConversationId, requestGeneration, {
        resetLastEventType: true,
      });
    } catch (err) {
      const state = getTranscriptState();
      console.error('[replayTranscript] failed', {
        error: err,
        conversation_id: getConversationId?.() || null,
        transcriptLimit: state.transcriptLimit,
      });
      // Surface a real console error instead of silently swallowing replay failures.
      setTimeout(() => {
        throw (err instanceof Error ? err : new Error(String(err)));
      }, 0);
    }
  }

  return {
    loadOlderTranscript,
    loadNewerTranscript,
    replayTranscript,
    collapseTranscriptToPinned,
    refreshCurrentTranscriptProjection,
  };
}
