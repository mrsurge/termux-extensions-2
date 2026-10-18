import {
  RPC_NAMESPACES,
  type RpcNamespaceName,
} from './namespaces.ts';

export const RPC_REQUEST_EVENT = 'rpc' as const;
export const RPC_NOTIFICATION_EVENT = 'rpc.notify' as const;
export const RPC_TRANSPORT_SESSION_STORAGE_KEY = 'codex_rpc_transport_enabled' as const;

export interface RpcTransportPlaceholderDescriptor {
  status: 'placeholder';
  compatibilityNamespace: string;
  requestEvent: typeof RPC_REQUEST_EVENT;
  notificationEvent: typeof RPC_NOTIFICATION_EVENT;
  defaultRpcEnabled: boolean;
  sessionStorageKey: typeof RPC_TRANSPORT_SESSION_STORAGE_KEY;
  publicNamespaces: {
    conversations: string;
    settings: string;
    ui: string;
  };
}

type SessionStorageWindow = Pick<Window, 'sessionStorage'> | null | undefined;
type LocationWindow = Pick<Window, 'location'> | null | undefined;
export type RpcWindowRef = (
  Pick<Window, 'location' | 'sessionStorage'>
  & {
    agentLogSocketIoOptions?: (options: Readonly<Record<string, unknown>>) => Record<string, unknown>;
    io?: IoFactory;
  }
) | null | undefined;

interface SocketEventHandlerMap {
  connect: () => void;
  disconnect: () => void;
  connect_error: (error: unknown) => void;
  [RPC_NOTIFICATION_EVENT]: (payload: unknown) => void;
}

type SocketEventName = keyof SocketEventHandlerMap;

export interface JsonRpcRequestEnvelope<TParams extends Record<string, unknown> = Record<string, unknown>> {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: TParams;
}

export interface SocketLike {
  connected?: boolean;
  emit(
    event: typeof RPC_REQUEST_EVENT,
    payload: JsonRpcRequestEnvelope,
    ack?: (response: unknown) => void,
  ): void;
  on<E extends SocketEventName>(event: E, handler: SocketEventHandlerMap[E]): void;
  off?<E extends SocketEventName>(event: E, handler: SocketEventHandlerMap[E]): void;
}

export type IoFactory = (namespace: string, options: Readonly<Record<string, unknown>>) => SocketLike;

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
    data?: Record<string, unknown>;
  };
}

export interface JsonRpcNotificationEnvelope<TParams = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: TParams;
}

export interface CallRpcNamespaceOptions<TParams extends Record<string, unknown> = Record<string, unknown>> {
  namespace: string;
  method: string;
  params?: TParams;
  requestId?: string;
  timeoutMs?: number;
  windowRef?: RpcWindowRef;
}

export interface SubscribeRpcNamespaceNotificationsOptions {
  namespace: string;
  onNotification: (notification: JsonRpcNotificationEnvelope, socket: SocketLike) => void;
  onConnectionChange?: (connected: boolean, socket: SocketLike) => void;
  windowRef?: RpcWindowRef;
}

const namespaceSockets = new Map<string, SocketLike>();
let rpcRequestCounter = 0;

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeJsonCompatibleValue(value: unknown, arrayItem = false): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return arrayItem ? null : undefined;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null;
  }
  if (typeof value === 'bigint') {
    throw new TypeError('JSON-RPC payloads cannot contain bigint values');
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonCompatibleValue(item, true));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const jsonValue = value as { toJSON?: () => unknown };
  if (typeof jsonValue.toJSON === 'function') {
    return normalizeJsonCompatibleValue(jsonValue.toJSON(), arrayItem);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedItem = normalizeJsonCompatibleValue(item);
    if (normalizedItem !== undefined) {
      normalized[key] = normalizedItem;
    }
  }
  return normalized;
}

export function normalizeJsonRpcParams(params: Record<string, unknown>): Record<string, unknown> {
  return asJsonObject(normalizeJsonCompatibleValue(params)) ?? {};
}

function getSessionStorage(win: SessionStorageWindow): Storage | null {
  if (!win) return null;
  try {
    return win.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function getDefaultWindowRef(): RpcWindowRef {
  return typeof window !== 'undefined' ? window : null;
}

function getIoFactory(win: RpcWindowRef): IoFactory {
  const factory = win?.io ?? (globalThis as { io?: IoFactory }).io;
  if (typeof factory !== 'function') {
    throw new Error('Socket.IO client unavailable');
  }
  return factory;
}

function resolveSocketIoPath(win: LocationWindow): string {
  const pathname = win?.location?.pathname || '/';
  const proxiedMatch = pathname.match(/^\/api\/app\/[^/]+\/proxy\b/);
  if (proxiedMatch) {
    return `${proxiedMatch[0]}/socket.io`;
  }
  return '/socket.io';
}

function getNamespaceSocket(namespace: string, win: RpcWindowRef): SocketLike {
  const existing = namespaceSockets.get(namespace);
  if (existing) return existing;
  const ioFactory = getIoFactory(win);
  const baseOptions = {
    path: resolveSocketIoPath(win),
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  };
  const socketOptions = typeof win?.agentLogSocketIoOptions === 'function'
    ? win.agentLogSocketIoOptions(baseOptions)
    : baseOptions;
  const socket = ioFactory(namespace, socketOptions);
  namespaceSockets.set(namespace, socket);
  return socket;
}

function removeSocketListener(
  socket: SocketLike,
  event: SocketEventName,
  handler: SocketEventHandlerMap[SocketEventName],
): void {
  if (typeof socket.off === 'function') {
    socket.off(event, handler);
  }
}

function nextRpcRequestId(): string {
  rpcRequestCounter += 1;
  return `rpc-${Date.now()}-${rpcRequestCounter}`;
}

export class JsonRpcCallError extends Error {
  code: number;
  data: Record<string, unknown> | null;

  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'JsonRpcCallError';
    this.code = code;
    this.data = data ?? null;
  }
}

function extractRpcAckError(ack: Record<string, unknown>): string | null {
  if (!('__error' in ack)) {
    return null;
  }
  const errorValue = ack.__error;
  if (typeof errorValue === 'string' && errorValue.trim()) {
    return errorValue;
  }
  return String(errorValue || 'RPC failed');
}

function isJsonRpcErrorEnvelope(payload: unknown): payload is JsonRpcErrorEnvelope {
  const envelope = asJsonObject(payload);
  const error = asJsonObject(envelope?.error);
  return (
    envelope?.jsonrpc === '2.0'
    && (typeof envelope.id === 'string' || envelope.id === null)
    && Boolean(error)
    && typeof error?.code === 'number'
    && typeof error?.message === 'string'
  );
}

function isJsonRpcSuccessEnvelope<TResult = unknown>(
  payload: unknown,
): payload is JsonRpcSuccessEnvelope<TResult> {
  const envelope = asJsonObject(payload);
  return (
    envelope?.jsonrpc === '2.0'
    && typeof envelope.id === 'string'
    && 'result' in envelope
    && !('error' in envelope)
  );
}

export function normalizeRpcTransportEnabled(value: unknown): boolean {
  return true;
}

export function readRpcTransportEnabledPreference(
  win: SessionStorageWindow = getDefaultWindowRef(),
): boolean {
  const storage = getSessionStorage(win);
  if (!storage) return true;
  try {
    return normalizeRpcTransportEnabled(storage.getItem(RPC_TRANSPORT_SESSION_STORAGE_KEY));
  } catch {
    return true;
  }
}

export function writeRpcTransportEnabledPreference(
  enabled: unknown,
  win: SessionStorageWindow = getDefaultWindowRef(),
): boolean {
  const normalized = true;
  const storage = getSessionStorage(win);
  if (!storage) return normalized;
  try {
    storage.setItem(RPC_TRANSPORT_SESSION_STORAGE_KEY, '1');
  } catch {
    // Ignore storage failures; the in-memory UI state still works.
  }
  return normalized;
}

export function resolveRpcNamespace(name: RpcNamespaceName): string {
  return RPC_NAMESPACES[name];
}

export async function waitForRpcNamespace(
  namespace: string,
  options: {
    timeoutMs?: number;
    windowRef?: RpcWindowRef;
  } = {},
): Promise<SocketLike> {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
  const win = options.windowRef ?? getDefaultWindowRef();
  const socket = getNamespaceSocket(namespace, win);
  if (socket.connected) {
    return socket;
  }

  return await new Promise<SocketLike>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      removeSocketListener(socket, 'connect', onConnect);
      removeSocketListener(socket, 'connect_error', onConnectError);
      reject(new Error(`Timed out connecting to ${namespace}`));
    }, timeoutMs);

    const onConnect = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeSocketListener(socket, 'connect', onConnect);
      removeSocketListener(socket, 'connect_error', onConnectError);
      resolve(socket);
    };

    const onConnectError = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeSocketListener(socket, 'connect', onConnect);
      removeSocketListener(socket, 'connect_error', onConnectError);
      reject(error instanceof Error ? error : new Error(String(error || `Failed connecting to ${namespace}`)));
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    if (socket.connected) {
      onConnect();
    }
  });
}

export async function callRpcNamespace<
  TResult = unknown,
  TParams extends Record<string, unknown> = Record<string, unknown>,
>(
  options: CallRpcNamespaceOptions<TParams>,
): Promise<TResult> {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10000;
  const requestId = options.requestId || nextRpcRequestId();
  const socket = await waitForRpcNamespace(options.namespace, {
    timeoutMs,
    windowRef: options.windowRef,
  });

  return await new Promise<TResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${options.method}`));
    }, timeoutMs);

    socket.emit(
      RPC_REQUEST_EVENT,
      {
        jsonrpc: '2.0',
        id: requestId,
        method: options.method,
        params: normalizeJsonRpcParams(options.params ?? {}),
      },
      (ack: unknown) => {
        clearTimeout(timer);
        const envelope = asJsonObject(ack);
        if (!envelope) {
          reject(new Error(`Invalid RPC ack for ${options.method}`));
          return;
        }
        const ackError = extractRpcAckError(envelope);
        if (ackError) {
          reject(new Error(ackError || `RPC failed: ${options.method}`));
          return;
        }
        if (isJsonRpcErrorEnvelope(envelope)) {
          reject(new JsonRpcCallError(
            envelope.error.code,
            envelope.error.message || `RPC failed: ${options.method}`,
            envelope.error.data,
          ));
          return;
        }
        if (!isJsonRpcSuccessEnvelope<TResult>(envelope)) {
          reject(new Error(`Invalid JSON-RPC envelope for ${options.method}`));
          return;
        }
        resolve(envelope.result);
      },
    );
  });
}

function isJsonRpcNotificationEnvelope(payload: unknown): payload is JsonRpcNotificationEnvelope {
  const envelope = asJsonObject(payload);
  return Boolean(
    envelope
      && envelope.jsonrpc === '2.0'
      && typeof envelope.method === 'string'
      && envelope.method.trim(),
  );
}

export function subscribeRpcNamespaceNotifications(
  options: SubscribeRpcNamespaceNotificationsOptions,
): () => void {
  const win = options.windowRef ?? getDefaultWindowRef();
  const socket = getNamespaceSocket(options.namespace, win);

  const onNotification = (payload: unknown) => {
    if (!isJsonRpcNotificationEnvelope(payload)) {
      return;
    }
    options.onNotification(payload, socket);
  };
  const onConnect = () => {
    options.onConnectionChange?.(true, socket);
  };
  const onDisconnect = () => {
    options.onConnectionChange?.(false, socket);
  };

  socket.on(RPC_NOTIFICATION_EVENT, onNotification);
  if (options.onConnectionChange) {
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    options.onConnectionChange(Boolean(socket.connected), socket);
  }

  return () => {
    removeSocketListener(socket, RPC_NOTIFICATION_EVENT, onNotification);
    if (options.onConnectionChange) {
      removeSocketListener(socket, 'connect', onConnect);
      removeSocketListener(socket, 'disconnect', onDisconnect);
      removeSocketListener(socket, 'connect_error', onDisconnect);
    }
  };
}

export function describeRpcTransportPlaceholder(): RpcTransportPlaceholderDescriptor {
  return {
    status: 'placeholder',
    compatibilityNamespace: '',
    requestEvent: RPC_REQUEST_EVENT,
    notificationEvent: RPC_NOTIFICATION_EVENT,
    defaultRpcEnabled: true,
    sessionStorageKey: RPC_TRANSPORT_SESSION_STORAGE_KEY,
    publicNamespaces: {
      conversations: RPC_NAMESPACES.conversations,
      settings: RPC_NAMESPACES.settings,
      ui: RPC_NAMESPACES.ui,
    },
  };
}
