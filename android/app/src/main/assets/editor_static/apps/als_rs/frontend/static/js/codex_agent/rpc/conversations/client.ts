import { getRpcRegistry } from '../registry.ts';
import {
  callRpcNamespace,
  type JsonRpcNotificationEnvelope,
  type RpcWindowRef,
  subscribeRpcNamespaceNotifications,
} from '../transport.ts';
import {
  type ConversationDraftResult,
  type ConversationForkResult,
  type ConversationListResult,
  type ConversationMetaRecord,
  type ConversationMetaResult,
  type ComposerSelectionState,
  CONVERSATIONS_RPC_ANCHOR_MODULES,
  CONVERSATIONS_RPC_CANONICAL_EVENT_TYPE_BY_METHOD,
  CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
  CONVERSATIONS_RPC_METHODS,
  CONVERSATIONS_RPC_NAMESPACE,
  CONVERSATIONS_RPC_NOTIFICATION_METHOD_BY_EVENT_TYPE,
  CONVERSATIONS_RPC_PROJECTION_NOTIFICATION_METHOD,
  type ConversationControlResult,
  type ConversationSendResult,
  type ConversationsLiveEvent,
  type ConversationsRpcNotificationMethod,
  type JsonObject,
  type ReplayChunkResult,
  type TranscriptCardRecipe,
  type TranscriptProjectionAction,
  type TurnProjectionChange,
  type TurnProjectionSnapshot,
} from './contract.ts';

export interface ConversationsRpcClientDescriptor {
  status: typeof CONVERSATIONS_RPC_IMPLEMENTATION_STATUS;
  namespace: typeof CONVERSATIONS_RPC_NAMESPACE;
  methods: typeof CONVERSATIONS_RPC_METHODS;
  anchorModules: readonly string[];
  notificationCount: number;
}

interface ConversationsRpcClientDeps {
  sioCall?: (event: string, payload?: JsonObject, options?: JsonObject) => Promise<unknown>;
  windowRef?: RpcWindowRef;
}

export function createConversationsRpcClientDescriptor(): ConversationsRpcClientDescriptor {
  const registry = getRpcRegistry();
  return {
    status: CONVERSATIONS_RPC_IMPLEMENTATION_STATUS,
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    methods: CONVERSATIONS_RPC_METHODS,
    anchorModules: [...CONVERSATIONS_RPC_ANCHOR_MODULES],
    notificationCount: registry.namespaces.conversations.notifications.length,
  };
}

export const createConversationsRpcClientPlaceholder = createConversationsRpcClientDescriptor;
export type ConversationsRpcClientPlaceholder = ConversationsRpcClientDescriptor;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function hasOwn<T extends object>(value: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeEventType(eventType: unknown): string {
  return typeof eventType === 'string' ? eventType.trim().toLowerCase() : '';
}

export function getConversationsRpcNotificationMethodForEventType(
  eventType: unknown,
): ConversationsRpcNotificationMethod | null {
  const normalized = normalizeEventType(eventType);
  if (!normalized || !hasOwn(CONVERSATIONS_RPC_NOTIFICATION_METHOD_BY_EVENT_TYPE, normalized)) {
    return null;
  }
  return CONVERSATIONS_RPC_NOTIFICATION_METHOD_BY_EVENT_TYPE[normalized];
}

export function isConversationsRpcBackedEventType(eventType: unknown): boolean {
  return Boolean(getConversationsRpcNotificationMethodForEventType(eventType));
}

function parseReplayJsonl(jsonl: string): JsonObject[] {
  if (!jsonl) return [];
  return jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid replay JSONL record');
      }
      return parsed as JsonObject;
    });
}

function normalizeConversationSendResult(
  result: unknown,
  transport: 'rpc' | 'legacy',
  conversationId: string | null,
): ConversationSendResult {
  const payload = asObject(result) ?? {};
  return {
    ...payload,
    conversation_id: typeof payload.conversation_id === 'string' ? payload.conversation_id : conversationId,
    accepted: payload.accepted === true || (payload.accepted == null && payload.ok === true),
    transport,
  };
}

function normalizeConversationMetaResult(
  result: unknown,
  transport: 'rpc' | 'legacy',
): ConversationMetaResult {
  const payload = asObject(result) ?? {};
  return {
    ...payload,
    conversation_id: typeof payload.conversation_id === 'string' ? payload.conversation_id : null,
    active_view: typeof payload.active_view === 'string' ? payload.active_view : null,
    settings: asObject(payload.settings) ?? {},
    transport,
  };
}

function normalizeConversationListResult(
  result: unknown,
  transport: 'rpc' | 'legacy',
): ConversationListResult {
  const payload = asObject(result) ?? {};
  const items = Array.isArray(payload.items)
    ? payload.items.map((item) => asObject(item)).filter((item): item is ConversationMetaRecord => Boolean(item))
    : [];
  const pinned = Array.isArray(payload.pinned_conversations)
    ? payload.pinned_conversations.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    ...payload,
    items,
    active_conversation_id: typeof payload.active_conversation_id === 'string' ? payload.active_conversation_id : null,
    active_view: typeof payload.active_view === 'string' ? payload.active_view : null,
    pinned_conversations: pinned,
    revision: typeof payload.revision === 'number' && Number.isFinite(payload.revision)
      ? payload.revision
      : undefined,
    reason: typeof payload.reason === 'string' ? payload.reason : undefined,
    changed_conversation_id: typeof payload.changed_conversation_id === 'string'
      ? payload.changed_conversation_id
      : undefined,
    deleted_conversation_id: typeof payload.deleted_conversation_id === 'string'
      ? payload.deleted_conversation_id
      : undefined,
    transport,
  };
}

function normalizeConversationControlResult(
  result: unknown,
  transport: 'rpc' | 'legacy',
): ConversationControlResult {
  const payload = asObject(result);
  if (!payload) {
    return {
      ok: false,
      error: 'Invalid response',
      transport,
    };
  }
  return {
    ...payload,
    transport,
  };
}

function normalizeRpcObjectResult(result: unknown): JsonObject {
  return asObject(result) ?? {};
}

export function normalizeTurnProjectionSnapshot(value: unknown): TurnProjectionSnapshot {
  const payload = asObject(value) ?? {};
  const items = Array.isArray(payload.items)
    ? payload.items.flatMap((candidate) => {
        const item = asObject(candidate);
        if (!item) return [];
        if (item.scope !== 'active') {
          throw new Error('Invalid active transcript-card scope');
        }
        const events = Array.isArray(item.events)
          ? item.events.map(asObject).filter((event): event is JsonObject => event !== null)
          : [];
        const cardId = typeof item.card_id === 'string' ? item.card_id : '';
        const sequence = Number.isFinite(item.sequence) ? Number(item.sequence) : 0;
        if (
          !cardId
          || events.some((event) => (
            event.projection_card_id !== cardId
            || Number(event.projection_card_index) !== sequence
            || event.projection_card_scope !== 'active'
          ))
        ) {
          throw new Error(`Invalid active transcript-card metadata for ${cardId || 'unknown card'}`);
        }
        return [{
          key: typeof item.key === 'string' ? item.key : '',
          card_id: cardId,
          family: typeof item.family === 'string' ? item.family : '',
          scope: 'active' as const,
          source_id: typeof item.source_id === 'string' ? item.source_id : '',
          ...(typeof item.turn_id === 'string' ? { turn_id: item.turn_id } : {}),
          ...(typeof item.subagent_id === 'string' ? { subagent_id: item.subagent_id } : {}),
          ...(typeof item.parent_card_id === 'string' ? { parent_card_id: item.parent_card_id } : {}),
          sequence,
          events,
        }];
      })
    : [];
  items.sort((left, right) => left.sequence - right.sequence);
  return {
    generation: Number.isFinite(payload.generation) ? Number(payload.generation) : 0,
    revision: Number.isFinite(payload.revision) ? Number(payload.revision) : 0,
    ...(typeof payload.turn_id === 'string' ? { turn_id: payload.turn_id } : {}),
    items,
    truncated: payload.truncated === true,
  };
}

function normalizeTurnProjectionChange(value: unknown): TurnProjectionChange | null {
  const payload = asObject(value);
  if (!payload || typeof payload.conversation_id !== 'string') return null;
  return {
    ...payload,
    conversation_id: payload.conversation_id,
    generation: Number.isFinite(payload.generation) ? Number(payload.generation) : 0,
    revision: Number.isFinite(payload.revision) ? Number(payload.revision) : 0,
    ...(typeof payload.turn_id === 'string' ? { turn_id: payload.turn_id } : {}),
    item_count: Number.isFinite(payload.item_count) ? Number(payload.item_count) : 0,
    reason: typeof payload.reason === 'string' ? payload.reason : '',
    truncated: payload.truncated === true,
  };
}

function normalizeLiveNotificationEvent(
  notification: JsonRpcNotificationEnvelope<unknown>,
): ConversationsLiveEvent | null {
  const method = typeof notification.method === 'string' ? notification.method.trim() : '';
  if (!method) {
    return null;
  }
  if (!hasOwn(CONVERSATIONS_RPC_CANONICAL_EVENT_TYPE_BY_METHOD, method)) {
    return null;
  }
  const canonicalEventType = CONVERSATIONS_RPC_CANONICAL_EVENT_TYPE_BY_METHOD[method];
  const params = asObject(notification.params) ?? {};
  return {
    ...params,
    type: canonicalEventType,
    };
}

function normalizeReplayChunkResult(result: unknown): ReplayChunkResult {
  const payload = asObject(result);
  const frame = asObject(payload?.frame);
  if (!frame) {
    throw new Error('Invalid conversation.replay.getChunk result');
  }

  if (frame.format === 'card_recipes') {
    const projection = asObject(payload?.projection);
    if (!projection || projection.unit !== 'transcript_card') {
      throw new Error('Invalid transcript-card projection metadata');
    }
    const cards = Array.isArray(payload?.cards)
      ? payload.cards.map((candidate) => {
          const card = asObject(candidate);
          if (!card || typeof card.card_id !== 'string' || !card.card_id) {
            throw new Error('Invalid transcript-card recipe identity');
          }
          const events = Array.isArray(card.events)
            ? card.events.map(asObject).filter((event): event is JsonObject => event !== null)
            : [];
          if (!events.length) {
            throw new Error(`Transcript-card recipe ${card.card_id} has no events`);
          }
          const cardIndex = Number.isFinite(card.card_index) ? Number(card.card_index) : -1;
          const cardVersion = Number.isFinite(card.version) ? Number(card.version) : -1;
          if (
            !Number.isSafeInteger(cardIndex)
            || cardIndex < 0
            || !Number.isSafeInteger(cardVersion)
            || cardVersion < 1
            || typeof card.family !== 'string'
            || !card.family
            || card.scope !== 'durable'
          ) {
            throw new Error(`Invalid transcript-card recipe metadata for ${card.card_id}`);
          }
          for (const event of events) {
            if (
              event.projection_card_id !== card.card_id
              || Number(event.projection_card_index) !== cardIndex
              || Number(event.projection_card_version) !== cardVersion
              || !['create', 'update'].includes(String(event.projection_card_op))
              || event.projection_card_scope !== 'durable'
            ) {
              throw new Error(`Transcript-card event metadata mismatch for ${card.card_id}`);
            }
          }
          return {
            card_id: card.card_id,
            card_index: cardIndex,
            version: cardVersion,
            family: card.family,
            scope: 'durable',
            ...(typeof card.parent_card_id === 'string'
              ? { parent_card_id: card.parent_card_id }
              : {}),
            events,
          } satisfies TranscriptCardRecipe;
        })
      : [];
    const runtimeState = Array.isArray(payload?.runtime_state)
      ? payload.runtime_state.map(asObject).filter((entry): entry is JsonObject => entry !== null)
      : [];
    const declaredCardCount = Number.isFinite(frame.card_count) ? Number(frame.card_count) : -1;
    if (declaredCardCount !== cards.length) {
      throw new Error(`Transcript-card count mismatch: expected ${declaredCardCount}, received ${cards.length}`);
    }
    const projectionCardCount = Number.isFinite(projection.card_count)
      ? Number(projection.card_count)
      : -1;
    if (projectionCardCount !== cards.length) {
      throw new Error(`Transcript projection count mismatch: expected ${projectionCardCount}, received ${cards.length}`);
    }
    return {
      conversation_id: typeof payload?.conversation_id === 'string' ? payload.conversation_id : null,
      replay_id: typeof payload?.replay_id === 'string' ? payload.replay_id : 'replay',
      projection: {
        unit: 'transcript_card',
        start_card: Number.isFinite(projection.start_card) ? Number(projection.start_card) : 0,
        end_card: Number.isFinite(projection.end_card) ? Number(projection.end_card) : 0,
        total_cards: Number.isFinite(projection.total_cards) ? Number(projection.total_cards) : 0,
        window_cards: Number.isFinite(projection.window_cards) ? Number(projection.window_cards) : 0,
        shift_cards: Number.isFinite(projection.shift_cards) ? Number(projection.shift_cards) : 0,
        card_count: projectionCardCount,
        at_start: projection.at_start === true,
        at_tail: projection.at_tail === true,
        revision: Number.isFinite(projection.revision) ? Number(projection.revision) : 0,
      },
      live_projection: normalizeTurnProjectionSnapshot(payload?.live_projection),
      frame: {
        format: 'card_recipes',
        card_count: cards.length,
        raw_event_count: Number.isFinite(frame.raw_event_count) ? Number(frame.raw_event_count) : 0,
        raw_total_count: Number.isFinite(frame.raw_total_count) ? Number(frame.raw_total_count) : 0,
        complete: frame.complete !== false,
      },
      items: [],
      cards,
      runtime_state: runtimeState,
      transport: 'rpc',
    };
  }

  if (frame.format !== 'jsonl') {
    throw new Error(`Unsupported replay frame format: ${String(frame.format)}`);
  }

  const jsonl = typeof frame.jsonl === 'string' ? frame.jsonl : '';
  const nextCursor = asObject(frame.next_cursor);
  return {
    conversation_id: typeof payload?.conversation_id === 'string' ? payload.conversation_id : null,
    replay_id: typeof payload?.replay_id === 'string' ? payload.replay_id : 'replay',
    projection: null,
    live_projection: normalizeTurnProjectionSnapshot(payload?.live_projection),
    frame: {
      format: 'jsonl',
      offset: Number.isFinite(frame.offset) ? Number(frame.offset) : 0,
      item_count: Number.isFinite(frame.item_count) ? Number(frame.item_count) : 0,
      total_count: Number.isFinite(frame.total_count) ? Number(frame.total_count) : 0,
      chunk_index: Number.isFinite(frame.chunk_index) ? Number(frame.chunk_index) : 0,
      complete: frame.complete !== false,
      next_cursor: nextCursor && Number.isFinite(nextCursor.offset)
        ? { offset: Number(nextCursor.offset) }
        : null,
      jsonl,
    },
    items: parseReplayJsonl(jsonl),
    cards: [],
    runtime_state: [],
    transport: 'rpc',
  };
}

async function requestReplayChunkRpc(
  params: {
    conversationId: string | null;
    offset: number;
    maxEntries: number;
    maxBytes: number;
    timeoutMs: number;
    projection?: {
      action: TranscriptProjectionAction;
      windowCards: number;
      shiftCards: number;
    };
    windowRef?: RpcWindowRef;
  },
): Promise<ReplayChunkResult> {
  const rpcParams: JsonObject = {
    conversation_id: params.conversationId,
    cursor: { offset: params.offset },
    max_entries: params.maxEntries,
    max_bytes: params.maxBytes,
    format: 'jsonl',
  };
  if (params.projection) {
    rpcParams.projection = {
      action: params.projection.action,
      window_cards: params.projection.windowCards,
      shift_cards: params.projection.shiftCards,
    };
  }
  const result = await callRpcNamespace({
    namespace: CONVERSATIONS_RPC_NAMESPACE,
    method: CONVERSATIONS_RPC_METHODS.replayGetChunk,
    params: rpcParams,
    timeoutMs: params.timeoutMs,
    windowRef: params.windowRef ?? (typeof window !== 'undefined' ? window : null),
  });
  return normalizeReplayChunkResult(result);
}

async function fetchReplayChunkRpcAccumulated(
  params: {
    conversationId: string | null;
    offset: number;
    maxEntries: number;
    maxBytes: number;
    timeoutMs: number;
    projection?: {
      action: TranscriptProjectionAction;
      windowCards: number;
      shiftCards: number;
    };
    windowRef?: RpcWindowRef;
  },
): Promise<ReplayChunkResult> {
  const firstChunk = await requestReplayChunkRpc(params);
  if (firstChunk.frame.format !== 'jsonl') {
    throw new Error('Raw replay request returned a non-JSONL frame');
  }
  const firstOffset = firstChunk.frame.offset;
  const totalCount = firstChunk.frame.total_count;
  const remainingAvailable = Math.max(0, totalCount - firstOffset);
  const desiredCount = Math.min(Math.max(1, params.maxEntries), remainingAvailable || params.maxEntries);
  if (
    firstChunk.frame.complete
    || !firstChunk.frame.next_cursor
    || firstChunk.items.length >= desiredCount
  ) {
    return firstChunk;
  }

  const items = [...firstChunk.items];
  const jsonlParts = [firstChunk.frame.jsonl];
  const seenOffsets = new Set<number>([firstOffset]);
  let nextCursor: { offset: number } | null = firstChunk.frame.next_cursor;

  while (nextCursor && items.length < desiredCount) {
    const nextOffset = Number(nextCursor.offset);
    if (!Number.isFinite(nextOffset) || seenOffsets.has(nextOffset)) {
      break;
    }
    seenOffsets.add(nextOffset);

    const nextChunk = await requestReplayChunkRpc({
      ...params,
      offset: nextOffset,
      maxEntries: Math.max(1, desiredCount - items.length),
      projection: undefined,
    });

    if (nextChunk.frame.format !== 'jsonl') {
      throw new Error('Raw replay continuation returned a non-JSONL frame');
    }

    if (!nextChunk.items.length) {
      nextCursor = nextChunk.frame.next_cursor;
      break;
    }

    items.push(...nextChunk.items);
    if (nextChunk.frame.jsonl) {
      jsonlParts.push(nextChunk.frame.jsonl);
    }
    nextCursor = nextChunk.frame.next_cursor;
  }

  const loadedCount = Math.min(items.length, desiredCount);
  const loadedEnd = firstOffset + loadedCount;
  const complete = loadedEnd >= totalCount;
  return {
    conversation_id: firstChunk.conversation_id,
    replay_id: firstChunk.replay_id,
    projection: firstChunk.projection,
    live_projection: firstChunk.live_projection,
    frame: {
      format: 'jsonl',
      offset: firstOffset,
      item_count: loadedCount,
      total_count: totalCount,
      chunk_index: firstChunk.frame.chunk_index,
      complete,
      next_cursor: complete ? null : (nextCursor ?? { offset: loadedEnd }),
      jsonl: jsonlParts.join(''),
    },
    items: items.slice(0, loadedCount),
    cards: [],
    runtime_state: [],
    transport: 'rpc',
  };
}

export function createConversationsRpcClient(
  deps: ConversationsRpcClientDeps,
) {
  function fetchShellWindow(params: JsonObject): Promise<unknown> {
    return callRpcNamespace({ namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.shellOutputWindow, params, timeoutMs: 10000, windowRef: getWindowRef() });
  }
  function getWindowRef(): RpcWindowRef {
    return deps.windowRef ?? (typeof window !== 'undefined' ? window : null);
  }

  async function getConversation(options: {
    conversationId?: string | null;
    timeoutMs?: number;
  } = {}): Promise<ConversationMetaResult> {
    const conversationId = typeof options.conversationId === 'string' && options.conversationId
      ? options.conversationId
      : null;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.get,
      params: {
        conversation_id: conversationId,
      },
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationMetaResult(result, 'rpc');
  }

  async function listConversations(options: {
    timeoutMs?: number;
  } = {}): Promise<ConversationListResult> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.list,
      params: {},
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationListResult(result, 'rpc');
  }

  async function createConversation(options: {
    settings?: JsonObject | null;
    timeoutMs?: number;
  } = {}): Promise<ConversationMetaResult> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const payload = options.settings ? { settings: options.settings } : {};
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.create,
      params: payload,
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationMetaResult(result, 'rpc');
  }

  async function selectConversation(options: {
    conversationId: string;
    view?: string | null;
    timeoutMs?: number;
  }): Promise<ConversationMetaResult> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const payload: JsonObject = {
      conversation_id: options.conversationId,
    };
    if (typeof options.view === 'string' && options.view.trim()) {
      payload.view = options.view.trim();
    }
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.select,
      params: payload,
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationMetaResult(result, 'rpc');
  }

  async function updateConversation(options: {
    conversationId?: string | null;
    settings?: JsonObject | null;
    threadId?: string | null;
    timeoutMs?: number;
  }): Promise<ConversationMetaResult> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const payload: JsonObject = {};
    if (typeof options.conversationId === 'string' && options.conversationId.trim()) {
      payload.conversation_id = options.conversationId.trim();
    }
    if (options.settings && typeof options.settings === 'object') {
      payload.settings = options.settings;
    }
    if (typeof options.threadId === 'string' && options.threadId.trim()) {
      payload.thread_id = options.threadId.trim();
    }
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.update,
      params: payload,
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationMetaResult(result, 'rpc');
  }

  async function deleteConversation(options: {
    conversationId: string;
    timeoutMs?: number;
  }): Promise<ConversationControlResult> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const payload = { conversation_id: options.conversationId };
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.delete,
      params: payload,
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationControlResult(result, 'rpc');
  }

  async function forkConversation(options: {
    conversationId: string;
    title?: string | null;
    timeoutMs?: number;
  }): Promise<ConversationForkResult> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 30000;
    const payload: JsonObject = {
      conversation_id: options.conversationId,
    };
    if (typeof options.title === 'string' && options.title.trim()) {
      payload.title = options.title.trim();
    }
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.fork,
      params: payload,
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationMetaResult(result, 'rpc') as ConversationForkResult;
  }

  async function setConversationPins(options: {
    pinnedConversationIds: string[];
    timeoutMs?: number;
  }): Promise<ConversationControlResult> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const payload = { pinned_conversations: options.pinnedConversationIds };
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.pinsSet,
      params: payload,
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationControlResult(result, 'rpc');
  }

  async function setDraft(options: {
    conversationId?: string | null;
    draft: string;
    clientId?: string | null;
    clientSequence?: number;
    authorEpoch?: number;
    selection?: ComposerSelectionState | null;
    timeoutMs?: number;
  }): Promise<ConversationDraftResult> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const payload: JsonObject = {
      draft: typeof options.draft === 'string' ? options.draft : '',
    };
    if (typeof options.conversationId === 'string' && options.conversationId.trim()) {
      payload.conversation_id = options.conversationId.trim();
    }
    if (typeof options.clientId === 'string' && options.clientId.trim()) {
      payload.client_id = options.clientId.trim();
    }
    if (Number.isSafeInteger(options.clientSequence) && Number(options.clientSequence) >= 0) {
      payload.client_sequence = Number(options.clientSequence);
    }
    if (Number.isSafeInteger(options.authorEpoch) && Number(options.authorEpoch) >= 0) {
      payload.author_epoch = Number(options.authorEpoch);
    }
    if (options.selection) payload.selection = options.selection;
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.draftSet,
      params: payload,
      timeoutMs,
      windowRef: getWindowRef(),
    });
    const normalized = asObject(result) ?? {};
    return {
      ...normalized,
      conversation_id: typeof normalized.conversation_id === 'string' ? normalized.conversation_id : null,
      transport: 'rpc',
    };
  }

  async function claimDraftAuthor(options: {
    conversationId: string;
    clientId: string;
    clientSequence: number;
    selection: ComposerSelectionState;
    timeoutMs?: number;
  }): Promise<ConversationDraftResult> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.draftAuthorClaim,
      params: {
        conversation_id: options.conversationId,
        client_id: options.clientId,
        client_sequence: options.clientSequence,
        selection: options.selection,
      },
      timeoutMs,
      windowRef: getWindowRef(),
    });
    const normalized = asObject(result) ?? {};
    return {
      ...normalized,
      conversation_id: typeof normalized.conversation_id === 'string' ? normalized.conversation_id : null,
      transport: 'rpc',
    };
  }

  async function setDraftSelection(options: {
    conversationId: string;
    clientId: string;
    clientSequence: number;
    authorEpoch: number;
    selection: ComposerSelectionState;
    timeoutMs?: number;
  }): Promise<ConversationDraftResult> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.draftSelectionSet,
      params: {
        conversation_id: options.conversationId,
        client_id: options.clientId,
        client_sequence: options.clientSequence,
        author_epoch: options.authorEpoch,
        selection: options.selection,
      },
      timeoutMs,
      windowRef: getWindowRef(),
    });
    const normalized = asObject(result) ?? {};
    return {
      ...normalized,
      conversation_id: typeof normalized.conversation_id === 'string' ? normalized.conversation_id : null,
      transport: 'rpc',
    };
  }

  async function fetchReplayChunk(options: {
    conversationId?: string | null;
    offset: number;
    maxEntries: number;
    maxBytes?: number;
    timeoutMs?: number;
  }): Promise<ReplayChunkResult> {
    const {
      conversationId = null,
      offset,
      maxEntries,
      maxBytes = 524288,
      timeoutMs = 10000,
    } = options;
    return fetchReplayChunkRpcAccumulated({
      conversationId,
      offset,
      maxEntries,
      maxBytes,
      timeoutMs,
      windowRef: getWindowRef(),
    });
  }

  async function fetchReplayProjection(options: {
    conversationId?: string | null;
    action: TranscriptProjectionAction;
    windowCards: number;
    shiftCards: number;
    maxBytes?: number;
    timeoutMs?: number;
  }): Promise<ReplayChunkResult> {
    const {
      conversationId = null,
      action,
      windowCards,
      shiftCards,
      maxBytes = 2097152,
      timeoutMs = 10000,
    } = options;
    const result = await requestReplayChunkRpc({
      conversationId,
      offset: 0,
      maxEntries: windowCards,
      maxBytes,
      timeoutMs,
      projection: {
        action,
        windowCards,
        shiftCards,
      },
      windowRef: getWindowRef(),
    });
    if (result.frame.format !== 'card_recipes' || !result.projection) {
      throw new Error('Transcript projection did not return card recipes');
    }
    return result;
  }

  async function sendMessage(options: {
    conversationId?: string | null;
    text: string;
    timeoutMs?: number;
  }): Promise<ConversationSendResult> {
    const conversationId = typeof options.conversationId === 'string' && options.conversationId
      ? options.conversationId
      : null;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const params: JsonObject = {
      conversation_id: conversationId,
      text: options.text,
    };
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.send,
      params,
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationSendResult(result, 'rpc', conversationId);
  }

  async function interruptConversation(options: {
    conversationId?: string | null;
    timeoutMs?: number;
  }): Promise<ConversationControlResult> {
    const conversationId = typeof options.conversationId === 'string' && options.conversationId
      ? options.conversationId
      : null;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.interrupt,
      params: {
        conversation_id: conversationId,
      },
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationControlResult(result, 'rpc');
  }

  async function compactConversation(options: {
    conversationId?: string | null;
    timeoutMs?: number;
  }): Promise<ConversationControlResult> {
    const conversationId = typeof options.conversationId === 'string' && options.conversationId
      ? options.conversationId
      : null;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 150000;
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.compact,
      params: {
        conversation_id: conversationId,
      },
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeConversationControlResult(result, 'rpc');
  }

  async function respondApproval(options: {
    requestId: string;
    conversationId?: string | null;
    result?: JsonObject | null;
    decision?: string | null;
    timeoutMs?: number | null;
  }): Promise<JsonObject> {
    const payload: JsonObject = {
      request_id: options.requestId,
      conversation_id: options.conversationId ?? null,
    };
    if (options.result && typeof options.result === 'object') {
      payload.result = options.result;
    }
    if (typeof options.decision === 'string' && options.decision.trim()) {
      payload.decision = options.decision.trim();
    }
    const timeoutMs = options.timeoutMs === null
      ? 30000
      : (Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000);
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.approvalRespond,
      params: payload,
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeRpcObjectResult(result);
  }

  async function executeShellCommand(options: {
    conversationId: string;
    command: string;
    timeoutMs?: number;
  }): Promise<JsonObject> {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
    const result = await callRpcNamespace({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      method: CONVERSATIONS_RPC_METHODS.shellExec,
      params: {
        conversation_id: options.conversationId,
        command: options.command,
      },
      timeoutMs,
      windowRef: getWindowRef(),
    });
    return normalizeRpcObjectResult(result);
  }

  function subscribeLiveNotifications(options: {
    onEvent: (event: ConversationsLiveEvent, notification: JsonRpcNotificationEnvelope<unknown>) => void;
    onProjectionChange?: (change: TurnProjectionChange, notification: JsonRpcNotificationEnvelope<unknown>) => void;
    onError?: (error: unknown) => void;
    onConnectionChange?: (connected: boolean) => void;
  }): () => void {
    return subscribeRpcNamespaceNotifications({
      namespace: CONVERSATIONS_RPC_NAMESPACE,
      windowRef: getWindowRef(),
      onConnectionChange: (connected) => {
        options.onConnectionChange?.(connected);
      },
      onNotification: (notification) => {
        try {
          if (notification.method === CONVERSATIONS_RPC_PROJECTION_NOTIFICATION_METHOD) {
            const change = normalizeTurnProjectionChange(notification.params);
            if (change) options.onProjectionChange?.(change, notification);
            return;
          }
          const event = normalizeLiveNotificationEvent(notification);
          if (!event) {
            return;
          }
          options.onEvent(event, notification);
        } catch (error) {
          options.onError?.(error);
        }
      },
    });
  }

  function isRpcBackedLiveEvent(eventOrType: unknown): boolean {
    if (typeof eventOrType === 'string') {
      return isConversationsRpcBackedEventType(eventOrType);
    }
    return isConversationsRpcBackedEventType(asObject(eventOrType)?.type);
  }

  return {
    getConversation,
    fetchShellWindow,
    listConversations,
    createConversation,
    selectConversation,
    updateConversation,
    deleteConversation,
    forkConversation,
    setConversationPins,
    setDraft,
    claimDraftAuthor,
    setDraftSelection,
    fetchReplayChunk,
    fetchReplayProjection,
    sendMessage,
    interruptConversation,
    compactConversation,
    respondApproval,
    executeShellCommand,
    subscribeLiveNotifications,
    isRpcBackedLiveEvent,
  };
}
