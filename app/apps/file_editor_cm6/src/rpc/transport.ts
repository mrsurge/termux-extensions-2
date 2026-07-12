import {
  identityRpcWireCodec,
  type RpcWireCodec,
} from './codec.ts';

export const RPC_REQUEST_EVENT = 'rpc' as const;
export const RPC_NOTIFICATION_EVENT = 'rpc.notify' as const;

export type JsonObject = Record<string, unknown>;

export interface JsonRpcRequestEnvelope<TParams extends JsonObject = JsonObject> {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: TParams;
}

export interface JsonRpcNotificationEnvelope<TParams extends JsonObject = JsonObject> {
  jsonrpc: '2.0';
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccessEnvelope<TResult = unknown> {
  jsonrpc: '2.0';
  id: string;
  result: TResult;
}

export interface JsonRpcErrorEnvelope {
  jsonrpc: '2.0';
  id: string | null;
  error: {
    code: number;
    message: string;
    data?: JsonObject;
  };
}

export interface SocketLike {
  connected?: boolean;
  emit(event: string, payload: unknown, ack?: (response: unknown) => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  connect?(): void;
  disconnect?(): void;
}

export type IoFactory = (
  namespace: string,
  options: Readonly<Record<string, unknown>>,
) => SocketLike;

export interface CreateSocketIoJsonRpcClientOptions {
  namespace: string;
  path: string;
  query?: JsonObject;
  auth?: JsonObject;
  codec?: RpcWireCodec;
  requestIdPrefix?: string;
  ensureSocketIoLoaded: () => Promise<IoFactory | null | undefined>;
  onConnect?: () => void;
  onDisconnect?: (reason?: string) => void;
  onConnectError?: (error: unknown) => void;
  onProtocolError?: (error: Error) => void;
  onNotification?: (notification: JsonRpcNotificationEnvelope) => void;
}

interface QueuedRequest {
  envelope: JsonRpcRequestEnvelope;
  timeoutMs: number;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonRpcNotificationEnvelope(payload: unknown): payload is JsonRpcNotificationEnvelope {
  if (!isJsonObject(payload)) return false;
  return payload.jsonrpc === '2.0' && typeof payload.method === 'string';
}

function isJsonRpcSuccessEnvelope<TResult = unknown>(
  payload: unknown,
): payload is JsonRpcSuccessEnvelope<TResult> {
  if (!isJsonObject(payload)) return false;
  return (
    payload.jsonrpc === '2.0'
    && typeof payload.id === 'string'
    && 'result' in payload
    && !('error' in payload)
  );
}

function isJsonRpcErrorEnvelope(payload: unknown): payload is JsonRpcErrorEnvelope {
  if (!isJsonObject(payload)) return false;
  if (payload.jsonrpc !== '2.0') return false;
  if (!(typeof payload.id === 'string' || payload.id === null)) return false;
  const error = payload.error;
  return (
    isJsonObject(error)
    && typeof error.code === 'number'
    && typeof error.message === 'string'
  );
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error ?? 'Unknown error'));
}

export class JsonRpcCallError extends Error {
  code: number;
  data: JsonObject | null;

  constructor(code: number, message: string, data?: JsonObject) {
    super(message);
    this.name = 'JsonRpcCallError';
    this.code = code;
    this.data = data ?? null;
  }
}

export function createSocketIoJsonRpcClient(options: CreateSocketIoJsonRpcClientOptions) {
  const codec = options.codec ?? identityRpcWireCodec;
  let socket: SocketLike | null = null;
  let connectPromise: Promise<void> | null = null;
  let requestCounter = 0;
  const queuedNotifications: JsonRpcNotificationEnvelope[] = [];
  const queuedRequests: QueuedRequest[] = [];

  function nextRequestId(): string {
    requestCounter += 1;
    const prefix = options.requestIdPrefix || 'rpc';
    return `${prefix}_${Date.now()}_${requestCounter}`;
  }

  function failQueuedRequests(error: Error): void {
    while (queuedRequests.length) {
      const queued = queuedRequests.shift();
      if (!queued) continue;
      queued.reject(error);
    }
  }

  function emitQueuedRequest(queued: QueuedRequest): void {
    if (!socket) {
      queued.reject(new Error('Socket.IO client unavailable'));
      return;
    }
    const timeoutMs = Math.max(500, Number(queued.timeoutMs) || 8000);
    const timer = setTimeout(() => {
      queued.reject(new Error(`RPC request timeout: ${queued.envelope.method}`));
    }, timeoutMs);

    socket.emit(RPC_REQUEST_EVENT, codec.encode(queued.envelope), (wireResponse: unknown) => {
      clearTimeout(timer);
      try {
        const response = codec.decode(wireResponse);
        if (isJsonRpcErrorEnvelope(response)) {
          const data = isJsonObject(response.error.data) ? response.error.data : undefined;
          throw new JsonRpcCallError(response.error.code, response.error.message, data);
        }
        if (!isJsonRpcSuccessEnvelope(response)) {
          throw new Error('Invalid JSON-RPC response envelope');
        }
        queued.resolve(response.result);
      } catch (error) {
        queued.reject(normalizeError(error));
      }
    });
  }

  function flushQueues(): void {
    if (!socket?.connected) return;
    while (queuedNotifications.length) {
      const queued = queuedNotifications.shift();
      if (!queued) continue;
      socket.emit(RPC_REQUEST_EVENT, codec.encode(queued));
    }
    while (queuedRequests.length) {
      const queued = queuedRequests.shift();
      if (!queued) continue;
      emitQueuedRequest(queued);
    }
  }

  async function connect(): Promise<void> {
    if (socket) return;
    if (connectPromise) return connectPromise;

    connectPromise = Promise.resolve(options.ensureSocketIoLoaded())
      .then((ioFactory) => {
        if (typeof ioFactory !== 'function') {
          throw new Error('Socket.IO client unavailable');
        }
        socket = ioFactory(options.namespace, {
          path: options.path,
          transports: ['websocket'],
          query: options.query || {},
          auth: options.auth || {},
        });
        socket.on('connect', () => {
          flushQueues();
          options.onConnect?.();
        });
        socket.on('disconnect', (reason?: unknown) => {
          options.onDisconnect?.(typeof reason === 'string' ? reason : undefined);
        });
        socket.on('connect_error', (error: unknown) => {
          options.onConnectError?.(error);
        });
        socket.on(RPC_NOTIFICATION_EVENT, (wirePayload: unknown) => {
          try {
            const payload = codec.decode(wirePayload);
            if (!isJsonRpcNotificationEnvelope(payload)) return;
            options.onNotification?.(payload);
          } catch (error) {
            options.onProtocolError?.(normalizeError(error));
          }
        });
      })
      .catch((error) => {
        const normalized = normalizeError(error);
        failQueuedRequests(normalized);
        options.onConnectError?.(normalized);
        throw normalized;
      })
      .finally(() => {
        connectPromise = null;
      });

    return connectPromise;
  }

  function reconnect(): void {
    if (socket && !socket.connected && typeof socket.connect === 'function') {
      socket.connect();
      return;
    }
    void connect();
  }

  function notify(method: string, params: JsonObject = {}): void {
    const envelope: JsonRpcNotificationEnvelope = {
      jsonrpc: '2.0',
      method,
      params,
    };
    if (socket?.connected) {
      socket.emit(RPC_REQUEST_EVENT, codec.encode(envelope));
      return;
    }
    queuedNotifications.push(envelope);
    void connect();
  }

  function request<TResult = JsonObject>(
    method: string,
    params: JsonObject = {},
    timeoutMs = 8000,
  ): Promise<TResult> {
    const envelope: JsonRpcRequestEnvelope = {
      jsonrpc: '2.0',
      id: nextRequestId(),
      method,
      params,
    };
    return new Promise<TResult>((resolve, reject) => {
      const queued: QueuedRequest = {
        envelope,
        timeoutMs,
        resolve: (result) => {
          resolve(result as TResult);
        },
        reject,
      };
      if (socket?.connected) {
        emitQueuedRequest(queued);
        return;
      }
      queuedRequests.push(queued);
      void connect();
    });
  }

  return {
    connect,
    disconnect(): void {
      if (socket && typeof socket.disconnect === 'function') {
        socket.disconnect();
      }
    },
    reconnect,
    isConnected(): boolean {
      return Boolean(socket?.connected);
    },
    notify,
    request,
  };
}
