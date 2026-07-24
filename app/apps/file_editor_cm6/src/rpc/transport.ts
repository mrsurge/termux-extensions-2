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
  sendBuffer?: unknown[];
  emit(event: string, payload: unknown, ack?: (response: unknown) => void): void;
  readonly volatile: {
    emit(event: string, payload: unknown, ack?: (response: unknown) => void): void;
  };
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

interface PendingRequest {
  envelope: JsonRpcRequestEnvelope;
  timeoutMs: number;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
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

function clearSocketReplayBuffer(socket: SocketLike | null | undefined): void {
  if (Array.isArray(socket?.sendBuffer)) socket.sendBuffer.length = 0;
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
  let hasConnected = false;
  const initialNotifications: JsonRpcNotificationEnvelope[] = [];
  const initialRequests: PendingRequest[] = [];
  const activeRequests = new Set<PendingRequest>();

  function nextRequestId(): string {
    requestCounter += 1;
    const prefix = options.requestIdPrefix || 'rpc';
    return `${prefix}_${Date.now()}_${requestCounter}`;
  }

  function settleRequest(request: PendingRequest, callback: () => void): void {
    if (request.settled) return;
    request.settled = true;
    if (request.timer) clearTimeout(request.timer);
    activeRequests.delete(request);
    callback();
  }

  function rejectRequest(request: PendingRequest, error: Error): void {
    settleRequest(request, () => request.reject(error));
  }

  function failInitialRequests(error: Error): void {
    initialNotifications.length = 0;
    while (initialRequests.length) {
      const request = initialRequests.shift();
      if (!request) continue;
      rejectRequest(request, error);
    }
  }

  function failActiveRequests(error: Error): void {
    for (const request of Array.from(activeRequests)) {
      rejectRequest(request, error);
    }
  }

  function emitRequest(request: PendingRequest): void {
    if (!socket?.connected) {
      rejectRequest(request, new Error(`RPC socket disconnected: ${request.envelope.method}`));
      return;
    }
    let wireEnvelope: unknown;
    try {
      wireEnvelope = codec.encode(request.envelope);
    } catch (error) {
      const normalized = normalizeError(error);
      options.onProtocolError?.(normalized);
      rejectRequest(request, normalized);
      return;
    }
    const timeoutMs = Math.max(500, Number(request.timeoutMs) || 8000);
    request.timer = setTimeout(() => {
      rejectRequest(request, new Error(`RPC request timeout: ${request.envelope.method}`));
    }, timeoutMs);
    activeRequests.add(request);

    socket.emit(RPC_REQUEST_EVENT, wireEnvelope, (wireResponse: unknown) => {
      if (request.settled) return;
      try {
        const response = codec.decode(wireResponse);
        if (isJsonRpcErrorEnvelope(response)) {
          const data = isJsonObject(response.error.data) ? response.error.data : undefined;
          rejectRequest(
            request,
            new JsonRpcCallError(response.error.code, response.error.message, data),
          );
          return;
        }
        if (!isJsonRpcSuccessEnvelope(response)) {
          rejectRequest(request, new Error('Invalid JSON-RPC response envelope'));
          return;
        }
        settleRequest(request, () => request.resolve(response.result));
      } catch (error) {
        rejectRequest(request, normalizeError(error));
      }
    });
  }

  function flushInitialQueues(): void {
    if (!socket?.connected) return;
    while (initialNotifications.length) {
      const notification = initialNotifications.shift();
      if (!notification) continue;
      try {
        socket.volatile.emit(RPC_REQUEST_EVENT, codec.encode(notification));
      } catch (error) {
        options.onProtocolError?.(normalizeError(error));
      }
    }
    while (initialRequests.length) {
      const request = initialRequests.shift();
      if (!request) continue;
      emitRequest(request);
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
          const isInitialConnection = !hasConnected;
          hasConnected = true;
          if (isInitialConnection) flushInitialQueues();
          options.onConnect?.();
        });
        socket.on('disconnect', (reason?: unknown) => {
          clearSocketReplayBuffer(socket);
          failActiveRequests(new Error('RPC socket disconnected'));
          options.onDisconnect?.(typeof reason === 'string' ? reason : undefined);
        });
        socket.on('connect_error', (error: unknown) => {
          clearSocketReplayBuffer(socket);
          failActiveRequests(normalizeError(error));
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
        failInitialRequests(normalized);
        failActiveRequests(normalized);
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
      try {
        socket.volatile.emit(RPC_REQUEST_EVENT, codec.encode(envelope));
      } catch (error) {
        options.onProtocolError?.(normalizeError(error));
      }
      return;
    }
    if (!hasConnected) {
      initialNotifications.push(envelope);
      void connect();
      return;
    }
    reconnect();
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
      const request: PendingRequest = {
        envelope,
        timeoutMs,
        resolve: (result) => {
          resolve(result as TResult);
        },
        reject,
        timer: null,
        settled: false,
      };
      if (socket?.connected) {
        emitRequest(request);
        return;
      }
      if (!hasConnected) {
        initialRequests.push(request);
        void connect();
        return;
      }
      reconnect();
      rejectRequest(request, new Error(`RPC socket disconnected: ${method}`));
    });
  }

  return {
    connect,
    disconnect(): void {
      const error = new Error('RPC socket disconnected');
      failInitialRequests(error);
      failActiveRequests(error);
      clearSocketReplayBuffer(socket);
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
