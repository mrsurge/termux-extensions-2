import { decode as decodeMessagePack, encode as encodeMessagePack } from '@msgpack/msgpack';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { getPageClientId } from './client_identity.ts';
import { buildTranscriptStreamUrl } from './transcript_stream_url.ts';
import {
  CONVERSATIONS_RPC_CANONICAL_EVENT_TYPE_BY_METHOD,
  CONVERSATIONS_RPC_PROJECTION_NOTIFICATION_METHOD,
  type ConversationsLiveEvent,
  type JsonObject,
  type ReplayChunkResult,
  type TranscriptCardRecipe,
  type TranscriptProjectionAction,
  type TranscriptProjectionState,
  type TurnProjectionChange,
} from './rpc/conversations/contract.ts';
import { normalizeTurnProjectionSnapshot } from './rpc/conversations/client.ts';

const PROTOCOL_VERSION = 1;
const FLAG_GZIP = 1;

const TAG_CLIENT_HELLO = 1;
const TAG_SERVER_HELLO = 2;
const TAG_WINDOW_REQUEST = 3;
const TAG_WINDOW_SNAPSHOT = 4;
const TAG_WINDOW_DELTA = 5;
const TAG_LIVE_EVENT = 6;
const TAG_SHELL_WINDOW_REQUEST = 7;
const TAG_SHELL_WINDOW = 8;
const TAG_ERROR = 255;

export type TranscriptTransportMode = 'stream' | 'rpc';

interface ProjectionOptions {
  startCard?: number;
  conversationId?: string | null;
  action: TranscriptProjectionAction;
  windowCards: number;
  shiftCards: number;
  maxBytes?: number;
  timeoutMs?: number;
}

interface PendingProjection {
  conversationId: string;
  resolve(result: ReplayChunkResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface OrderedCardVersion {
  cardId: string;
  cardIndex: number;
  version: number;
}

interface TranscriptStreamClientOptions {
  windowRef?: Window;
  getConversationId(): string | null | undefined;
  onEvent(event: ConversationsLiveEvent): void;
  onProjectionChange?(change: TurnProjectionChange): void;
  onConnectionChange?(connected: boolean): void;
  onReconnect?(): void | Promise<void>;
  onResyncRequired?(): void | Promise<void>;
}

interface TranscriptCompressionWindow {
  DecompressionStream?: new (format: 'gzip') => TransformStream<Uint8Array, Uint8Array>;
}

class StreamResyncRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamResyncRequiredError';
  }
}

export function readTranscriptTransportMode(windowRef: Window = window): TranscriptTransportMode {
  const raw = (windowRef as Window & { ALS_RS_TRANSCRIPT_TRANSPORT?: unknown })
    .ALS_RS_TRANSCRIPT_TRANSPORT;
  return String(raw || 'stream').trim().toLowerCase() === 'rpc' ? 'rpc' : 'stream';
}

export function createTranscriptStreamClient(options: TranscriptStreamClientOptions) {
  const windowRef = options.windowRef ?? window;
  const clientId = getPageClientId(windowRef);
  const recipeCache = new Map<string, TranscriptCardRecipe>();
  let cacheConversationId: string | null = null;
  let orderedCards: OrderedCardVersion[] = [];
  let projection: TranscriptProjectionState | null = null;
  let socket: ReconnectingWebSocket | null = null;
  let readyPromise: Promise<void>;
  let resolveReady: (() => void) | null = null;
  let connectedOnce = false;
  let connectionGeneration = 0;
  let serverEpoch: string | null = null;
  let lastStreamSequence = 0;
  let requestCounter = 0;
  let decodeQueue = Promise.resolve();
  let resyncScheduled = false;
  const pending = new Map<string, PendingProjection>();
  const shellPending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

  function resetReady(): void {
    readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
  }
  resetReady();

  function clearProjectionCache(preservePosition = false): void {
    recipeCache.clear();
    orderedCards = [];
    if (!preservePosition) {
      projection = null;
      cacheConversationId = null;
    }
    lastStreamSequence = 0;
  }

  function streamUrl(): string {
    return buildTranscriptStreamUrl(windowRef.location);
  }

  function supportsGzip(): boolean {
    return typeof (windowRef as Window & TranscriptCompressionWindow).DecompressionStream === 'function';
  }

  function encodeFrame(tag: number, payload: JsonObject): Uint8Array {
    const body = encodeMessagePack([tag, payload], { ignoreUndefined: true });
    const frame = new Uint8Array(body.byteLength + 2);
    frame[0] = PROTOCOL_VERSION;
    frame[1] = 0;
    frame.set(body, 2);
    return frame;
  }

  async function bytesFromMessage(data: unknown): Promise<Uint8Array> {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    throw new TypeError('Transcript stream received a non-binary frame');
  }

  async function decodeFrame(data: unknown): Promise<unknown> {
    const bytes = await bytesFromMessage(data);
    if (bytes.byteLength < 3 || bytes[0] !== PROTOCOL_VERSION) {
      throw new Error('Unsupported transcript stream frame');
    }
    let payload = bytes.subarray(2);
    if ((bytes[1] & FLAG_GZIP) !== 0) {
      if (!supportsGzip()) throw new Error('Transcript frame requires unavailable gzip support');
      const DecompressionStreamCtor = (windowRef as Window & TranscriptCompressionWindow)
        .DecompressionStream;
      if (!DecompressionStreamCtor) throw new Error('Transcript gzip decoder disappeared');
      const compressed = new Uint8Array(payload.byteLength);
      compressed.set(payload);
      const stream = new Blob([compressed.buffer])
        .stream()
        .pipeThrough(new DecompressionStreamCtor('gzip'));
      payload = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return decodeMessagePack(payload);
  }

  function send(tag: number, payload: JsonObject): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Transcript stream is not connected');
    }
    socket.send(encodeFrame(tag, payload));
  }

  function nextRequestId(): string {
    requestCounter += 1;
    return `transcript-${Date.now()}-${requestCounter}`;
  }

  function rejectPending(message: string): void {
    for (const request of shellPending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    shellPending.clear();
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error(message));
    }
    pending.clear();
  }

  function connect(): void {
    if (socket) return;
    socket = new ReconnectingWebSocket(streamUrl(), [], {
      minReconnectionDelay: 400,
      maxReconnectionDelay: 4000,
      reconnectionDelayGrowFactor: 1.4,
      connectionTimeout: 4000,
      maxEnqueuedMessages: 0,
      minUptime: 1000,
    });
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => {
      connectionGeneration += 1;
      const conversationId = options.getConversationId() || null;
      send(TAG_CLIENT_HELLO, {
        protocol: PROTOCOL_VERSION,
        client_id: clientId,
        conversation_id: conversationId,
        supports_gzip: supportsGzip(),
        last_sequence: lastStreamSequence,
      });
    });
    socket.addEventListener('message', (event) => {
      const generation = connectionGeneration;
      decodeQueue = decodeQueue
        .then(async () => {
          if (generation !== connectionGeneration) return;
          const frame = await decodeFrame(event.data);
          if (generation === connectionGeneration) await handleFrame(frame);
        })
        .catch((error) => {
          if (generation !== connectionGeneration) return;
          console.error('transcript stream frame failed', error);
          scheduleResync();
        });
    });
    socket.addEventListener('close', () => {
      connectionGeneration += 1;
      rejectPending('Transcript stream disconnected');
      if (!resolveReady) resetReady();
      options.onConnectionChange?.(false);
    });
    socket.addEventListener('error', () => {
      options.onConnectionChange?.(false);
    });
  }

  async function waitUntilReady(timeoutMs: number): Promise<void> {
    connect();
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        readyPromise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Timed out connecting transcript stream')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function parseTaggedFrame(value: unknown): [number, JsonObject] {
    if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0])) {
      throw new Error('Transcript stream frame is not a tagged tuple');
    }
    const payload = asObject(value[1]);
    if (!payload) throw new Error('Transcript stream frame payload is invalid');
    return [Number(value[0]), payload];
  }

  async function handleFrame(value: unknown): Promise<void> {
    const [tag, payload] = parseTaggedFrame(value);
    if (tag === TAG_SHELL_WINDOW) {
      const id = stringValue(payload.request_id);
      const request = shellPending.get(id);
      if (request) {
        shellPending.delete(id);
        clearTimeout(request.timer);
        if (payload.error) request.reject(new Error(String(payload.error)));
        else request.resolve(payload.result);
      }
      return;
    }
    if (tag === TAG_SERVER_HELLO) {
      const nextEpoch = stringValue(payload.server_epoch);
      const reconnected = connectedOnce;
      if (serverEpoch && nextEpoch && serverEpoch !== nextEpoch) {
        clearProjectionCache(true);
      }
      serverEpoch = nextEpoch || serverEpoch;
      connectedOnce = true;
      resolveReady?.();
      resolveReady = null;
      options.onConnectionChange?.(true);
      if (reconnected) scheduleProjectionRefresh(options.onReconnect, 'reconnect');
      return;
    }
    if (tag === TAG_WINDOW_SNAPSHOT || tag === TAG_WINDOW_DELTA) {
      handleProjectionFrame(tag, payload);
      return;
    }
    if (tag === TAG_LIVE_EVENT) {
      handleLiveFrame(payload);
      return;
    }
    if (tag === TAG_ERROR) {
      const requestId = stringValue(payload.request_id);
      const code = stringValue(payload.code);
      const error = new Error(stringValue(payload.message) || 'Transcript stream error');
      if (requestId && pending.has(requestId)) {
        const item = pending.get(requestId)!;
        pending.delete(requestId);
        clearTimeout(item.timer);
        item.reject(error);
      } else {
        console.error(error);
      }
      if (payload.fatal === true) {
        if (code === 'client_queue_overflow') {
          socket?.reconnect(4001, 'transcript stream queue overflow');
        } else {
          socket?.close(4000, 'fatal transcript stream error');
        }
      }
      return;
    }
    throw new Error(`Unsupported transcript stream tag: ${tag}`);
  }

  function normalizeCard(candidate: unknown): TranscriptCardRecipe {
    const card = asObject(candidate);
    const cardId = stringValue(card?.card_id);
    const cardIndex = numberValue(card?.card_index, -1);
    const version = numberValue(card?.version, -1);
    const family = stringValue(card?.family);
    const events = Array.isArray(card?.events)
      ? card.events.map(asObject).filter((event): event is JsonObject => event !== null)
      : [];
    if (
      !cardId
      || !family
      || !Number.isSafeInteger(cardIndex)
      || cardIndex < 0
      || !Number.isSafeInteger(version)
      || version < 1
      || card?.scope !== 'durable'
      || events.length === 0
    ) {
      throw new Error('Invalid streamed transcript card recipe');
    }
    for (const event of events) {
      if (
        event.projection_card_id !== cardId
        || numberValue(event.projection_card_index, -1) !== cardIndex
        || numberValue(event.projection_card_version, -1) !== version
        || event.projection_card_scope !== 'durable'
      ) {
        throw new Error(`Streamed transcript metadata mismatch for ${cardId}`);
      }
    }
    return {
      card_id: cardId,
      card_index: cardIndex,
      version,
      family,
      scope: 'durable',
      ...(stringValue(card.parent_card_id) ? { parent_card_id: stringValue(card.parent_card_id) } : {}),
      events,
    };
  }

  function normalizeOrderedCards(value: unknown): OrderedCardVersion[] {
    if (!Array.isArray(value)) throw new Error('Transcript stream card order is missing');
    return value.map((candidate) => {
      const card = asObject(candidate);
      const cardId = stringValue(card?.card_id);
      const cardIndex = numberValue(card?.card_index, -1);
      const version = numberValue(card?.version, -1);
      if (!cardId || !Number.isSafeInteger(cardIndex) || cardIndex < 0 || !Number.isSafeInteger(version) || version < 1) {
        throw new Error('Invalid transcript stream card order entry');
      }
      return { cardId, cardIndex, version };
    });
  }

  function normalizeProjection(value: unknown): TranscriptProjectionState {
    const item = asObject(value);
    if (!item || item.unit !== 'transcript_card') throw new Error('Invalid stream projection metadata');
    return {
      unit: 'transcript_card',
      start_card: numberValue(item.start_card, 0),
      end_card: numberValue(item.end_card, 0),
      total_cards: numberValue(item.total_cards, 0),
      window_cards: numberValue(item.window_cards, 0),
      shift_cards: numberValue(item.shift_cards, 0),
      card_count: numberValue(item.card_count, 0),
      at_start: item.at_start === true,
      at_tail: item.at_tail === true,
      revision: numberValue(item.revision, 0),
    };
  }

  function handleProjectionFrame(tag: number, payload: JsonObject): void {
    const requestId = stringValue(payload.request_id);
    const item = pending.get(requestId);
    if (!item) return;
    pending.delete(requestId);
    clearTimeout(item.timer);
    try {
      const conversationId = stringValue(payload.conversation_id);
      if (!conversationId || conversationId !== item.conversationId) {
        throw new Error('Transcript stream response conversation mismatch');
      }
      if (tag === TAG_WINDOW_SNAPSHOT || cacheConversationId !== conversationId) {
        recipeCache.clear();
        orderedCards = [];
      }
      cacheConversationId = conversationId;
      const removedIds = Array.isArray(payload.removed_card_ids)
        ? payload.removed_card_ids.map(stringValue).filter(Boolean)
        : [];
      for (const cardId of removedIds) recipeCache.delete(cardId);
      const upserts = Array.isArray(payload.cards) ? payload.cards.map(normalizeCard) : [];
      for (const card of upserts) recipeCache.set(card.card_id, card);
      orderedCards = normalizeOrderedCards(payload.ordered_cards);
      const selectedIds = new Set(orderedCards.map((card) => card.cardId));
      for (const cardId of recipeCache.keys()) {
        if (!selectedIds.has(cardId)) recipeCache.delete(cardId);
      }
      const cards = orderedCards.map((ordered) => {
        const card = recipeCache.get(ordered.cardId);
        if (!card || card.version !== ordered.version || card.card_index !== ordered.cardIndex) {
          throw new StreamResyncRequiredError(`Transcript delta is missing ${ordered.cardId}`);
        }
        return card;
      });
      projection = normalizeProjection(payload.projection);
      if (projection.card_count !== cards.length) {
        throw new StreamResyncRequiredError('Transcript stream card count mismatch');
      }
      lastStreamSequence = Math.max(lastStreamSequence, numberValue(payload.stream_sequence, 0));
      const frame = asObject(payload.frame) ?? {};
      const runtimeState = Array.isArray(payload.runtime_state)
        ? payload.runtime_state.map(asObject).filter((entry): entry is JsonObject => entry !== null)
        : [];
      item.resolve({
        conversation_id: conversationId,
        replay_id: `als-rs-${conversationId}`,
        projection,
        live_projection: normalizeTurnProjectionSnapshot(payload.live_projection),
        frame: {
          format: 'card_recipes',
          card_count: cards.length,
          raw_event_count: cards.reduce((sum, card) => sum + card.events.length, 0),
          raw_total_count: numberValue(frame.raw_total_count, 0),
          complete: true,
        },
        items: [],
        cards,
        runtime_state: runtimeState,
        transport: 'stream',
      });
    } catch (error) {
      item.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function handleLiveFrame(payload: JsonObject): void {
    const sequence = numberValue(payload.sequence, 0);
    if (sequence <= lastStreamSequence) return;
    if (lastStreamSequence > 0 && sequence !== lastStreamSequence + 1) {
      scheduleResync();
      return;
    }
    lastStreamSequence = sequence;
    const method = stringValue(payload.method);
    const params = asObject(payload.params) ?? {};
    if (method === CONVERSATIONS_RPC_PROJECTION_NOTIFICATION_METHOD) {
      const conversationId = stringValue(params.conversation_id);
      if (!conversationId) return;
      options.onProjectionChange?.({
        ...params,
        conversation_id: conversationId,
        generation: numberValue(params.generation, 0),
        revision: numberValue(params.revision, 0),
        item_count: numberValue(params.item_count, 0),
        reason: stringValue(params.reason),
        truncated: params.truncated === true,
      });
      return;
    }
    const eventType = (CONVERSATIONS_RPC_CANONICAL_EVENT_TYPE_BY_METHOD as Record<string, string>)[method];
    if (!eventType) return;
    options.onEvent({ ...params, type: eventType } as ConversationsLiveEvent);
  }

  function scheduleProjectionRefresh(
    callback: (() => void | Promise<void>) | undefined,
    reason: 'reconnect' | 'resync',
  ): void {
    if (resyncScheduled) return;
    resyncScheduled = true;
    clearProjectionCache(true);
    queueMicrotask(() => {
      void Promise.resolve()
        .then(() => callback?.())
        .catch((error: unknown) => {
          console.warn(`transcript stream ${reason} refresh failed`, error);
        })
        .finally(() => {
          resyncScheduled = false;
        });
    });
  }

  function scheduleResync(): void {
    scheduleProjectionRefresh(options.onResyncRequired, 'resync');
  }

  async function requestProjection(optionsValue: ProjectionOptions, retry = true): Promise<ReplayChunkResult> {
    const conversationId = stringValue(optionsValue.conversationId);
    if (!conversationId) throw new Error('conversationId is required for transcript projection');
    const timeoutMs = Number.isFinite(optionsValue.timeoutMs) ? Number(optionsValue.timeoutMs) : 30000;
    await waitUntilReady(timeoutMs);
    if (cacheConversationId && cacheConversationId !== conversationId) clearProjectionCache();
    const requestId = nextRequestId();
    const result = new Promise<ReplayChunkResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Timed out waiting for transcript projection'));
      }, timeoutMs);
      pending.set(requestId, { conversationId, resolve, reject, timer });
    });
    try {
      send(TAG_WINDOW_REQUEST, {
        request_id: requestId,
        conversation_id: conversationId,
        action: optionsValue.action,
        window_cards: optionsValue.windowCards,
        shift_cards: optionsValue.shiftCards,
        max_bytes: optionsValue.maxBytes ?? 2097152,
        known: {
          start_card: optionsValue.startCard ?? projection?.start_card,
          end_card: projection?.end_card,
          revision: projection?.revision,
          cards: orderedCards.map((card) => [card.cardId, card.version]),
        },
      });
    } catch (error) {
      const item = pending.get(requestId);
      if (item) clearTimeout(item.timer);
      pending.delete(requestId);
      throw error;
    }
    try {
      return await result;
    } catch (error) {
      if (retry && error instanceof StreamResyncRequiredError) {
        clearProjectionCache(true);
        return requestProjection({ ...optionsValue, action: 'current' }, false);
      }
      throw error;
    }
  }

  function dispose(): void {
    rejectPending('Transcript stream disposed');
    socket?.close(1000, 'dispose');
    socket = null;
  }

  async function fetchShellWindow(params: JsonObject): Promise<unknown> {
    await waitUntilReady(10000);
    const requestId = nextRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        shellPending.delete(requestId);
        reject(new Error('Timed out loading shell output'));
      }, 10000);
      shellPending.set(requestId, { resolve, reject, timer });
      try { send(TAG_SHELL_WINDOW_REQUEST, { ...params, request_id: requestId }); }
      catch (error) { clearTimeout(timer); shellPending.delete(requestId); reject(error); }
    });
  }

  function reconnectForRecovery(): void {
    if (!socket) return;
    connectionGeneration += 1;
    rejectPending('Transcript stream recovery');
    resetReady();
    clearProjectionCache(true);
    socket.reconnect(4002, 'foreground/control recovery');
  }

  function debugSnapshot(): JsonObject {
    return {
      mode: 'stream',
      client_id: clientId,
      connected: socket?.readyState === WebSocket.OPEN,
      server_epoch: serverEpoch,
      conversation_id: cacheConversationId,
      start_card: projection?.start_card,
      end_card: projection?.end_card,
      total_cards: projection?.total_cards,
      cached_cards: recipeCache.size,
      ordered_cards: orderedCards.length,
      stream_sequence: lastStreamSequence,
      pending_requests: pending.size,
    };
  }

  return {
    fetchShellWindow,
    clientId,
    reconnectForRecovery,
    clearProjectionCache,
    debugSnapshot,
    dispose,
    fetchReplayProjection: requestProjection,
  };
}

function asObject(value: unknown): JsonObject | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}
